--[[
@module  photo_client
@summary Air8607 ↔ ESP32-C3 相册客户端（UART2 行 JSON + 二进制 JPEG）
@note    命令：PHOTO RANDOM <seq> / PHOTO LIKED <seq> / PHOTO CANCEL / REACT <seq> <id> <action>
@note    ESP32-C3 先回一行 {"type":"photo","ok":true,"len":N,...}，紧接着发 N 字节 JPEG。
@note    单次下载总超时 600 秒；数据中断 15 秒也会中止，避免一直等。
]]

local M = {}

local UART_ID = 2
local BAUD = 115200
local PHOTO_TIMEOUT_MS = 600000
local REACT_TIMEOUT_MS = 120000
local RETRY_MS = 4000
local STALL_MS = 15000
local KEEPALIVE_MS = 10000
local LINK_LOST_MS = 30000
local LINK_BUSY_MS = 120000
local DISCARD_GRACE_MS = 3000
local FLUSH_QUIET_MS = 800
local FLUSH_CAP_MS = 6000
local REQUEST_RETRY_MS = 30000
local MAX_LINE = 8192

local cb
local running = false
local line_buf = ""
local mode = "line"          -- line | data | discard
local file
local recv = 0
local total = 0
local meta
local last_emit = 0
local last_rx = 0
local pending
local seq = 0
local discard_left = 0
local discard_deadline = 0
local flush_quiet = 0
local flush_cap = 0
local hello_ok = false
local wifi_up = false
local last_net_key = nil
local last_keepalive = 0
local bridge_fw = nil
local photo_supported = true
local react = { seq = 0, cb = nil, deadline = 0 }

-- Air1603 的 mcu.ticks() 约 20ms/tick（hz=50），必须按 hz 折算成毫秒
local TICKS_PER_MS = 1
if mcu and mcu.hz then
    local hz = mcu.hz()
    if type(hz) == "number" and hz > 1 then
        TICKS_PER_MS = hz / 1000
    end
end

local function now_ms()
    if mcu and mcu.ticks then
        local v = mcu.ticks()
        if v then return v / TICKS_PER_MS end
    end
    return os.time() * 1000
end

local function emit(ev, a, b, c)
    if not cb then return end
    local ok, err = pcall(cb, ev, a, b, c)
    if not ok then
        log.warn("photo", "回调异常", err)
    end
end

local function send(text)
    return uart.write(UART_ID, text)
end

local function send_request(p)
    local cmd = (p.kind == "liked") and "PHOTO LIKED " or "PHOTO RANDOM "
    send(cmd .. p.seq .. "\n")
    p.next_try = nil
    p.sent_at = now_ms()
end

local function remove_file(path)
    if path then pcall(os.remove, path) end
end

local function enter_discard(n)
    if n and n > 0 then
        mode = "discard"
        discard_left = n
        discard_deadline = now_ms() + DISCARD_GRACE_MS
    else
        mode = "line"
        discard_left = 0
        line_buf = ""
    end
end

-- 取消后对端可能还有几 KB 在途：静默一段时间再回到行模式，避免旧字节污染新帧
local function enter_flush()
    mode = "flush"
    line_buf = ""
    flush_quiet = now_ms() + FLUSH_QUIET_MS
    flush_cap = now_ms() + FLUSH_CAP_MS
end

local function abort_transfer(msg, silent)
    if mode == "data" or mode == "discard" then
        send("PHOTO CANCEL\n")
        if file then
            pcall(function() file:close() end)
            file = nil
        end
        if meta then remove_file(meta.path) end
        meta = nil
        total = 0
        recv = 0
        enter_flush()
    end
    pending = nil
    if not silent then
        emit("error", msg or "已取消", false)
    end
end

local function finish_transfer()
    if file then
        pcall(function() file:close() end)
        file = nil
    end
    local m = meta
    meta = nil
    total = 0
    recv = 0
    pending = nil
    mode = "line"
    emit("done", m)
end

local function fail_pending(err)
    if not pending then return end
    local p = pending
    if now_ms() >= p.deadline then
        pending = nil
        mode = "line"
        emit("error", err or "下载超时", true)
        return
    end
    p.next_try = now_ms() + (p.retry_delay or RETRY_MS)
    p.retry_delay = math.min((p.retry_delay or RETRY_MS) * 2, 15000)
    emit("retry", err or "稍后重试")
end

local function handle_photo(obj)
    local pseq = tonumber(obj.seq)
    if not obj.ok then
        if pending and pending.seq == pseq then
            fail_pending(obj.err or "photo_failed")
        end
        return
    end

    local len = tonumber(obj.len) or 0
    if len <= 0 then
        if pending and pending.seq == pseq then
            fail_pending("bad_length")
        end
        return
    end

    if pending and pending.seq == pseq and mode == "line" and pending.path then
        meta = {
            id = tonumber(obj.id),
            w = tonumber(obj.w),
            h = tonumber(obj.h),
            len = len,
            path = pending.path,
            kind = pending.kind,
            source = obj.src,
        }
        file = io.open(pending.path, "wb")
        if not file then
            log.error("photo", "无法写入", pending.path)
            enter_discard(len)
            fail_pending("open_failed")
            return
        end
        recv = 0
        total = len
        last_emit = 0
        last_rx = now_ms()
        mode = "data"
        emit("begin", meta)
    else
        log.warn("photo", "丢弃过期图片帧", pseq, len)
        enter_discard(len)
    end
end

local function handle_line(line)
    local ok, obj = pcall(json.decode, line)
    if not ok or type(obj) ~= "table" then
        return
    end

    local t = obj.type
    if t == "photo" then
        handle_photo(obj)
    elseif t == "hello" then
        hello_ok = true
        bridge_fw = obj.fw
        local major, minor = tostring(obj.fw or ""):match("^(%d+)%.(%d+)")
        photo_supported = (tonumber(major) or 0) > 1 or
                          ((tonumber(major) or 0) == 1 and (tonumber(minor) or 0) >= 1)
        log.info("photo", "hello", obj.fw or "-", obj.proto or "-",
                 photo_supported and "photo=1" or "photo=0")
        emit("hello", obj.fw, obj.proto, photo_supported)
    elseif t == "status" or t == "netinfo" then
        if t == "netinfo" then
            -- netinfo 没有 wifi/mode 字段，ok 表示公网请求成功
            if obj.ok == true then wifi_up = true end
        else
            wifi_up = (obj.wifi == true) and obj.mode ~= "ap"
        end
        local key = tostring(obj.mode) .. "|" .. tostring(obj.wifi) .. "|" ..
                    tostring(obj.err) .. "|" .. tostring(obj.ok)
        if key ~= last_net_key then
            last_net_key = key
            log.info("photo", "status", obj.fw or "-", obj.mode or "-",
                     wifi_up and "wifi=1" or "wifi=0", obj.err or "",
                     obj.local_ip or "")
        end
        emit("net", wifi_up, obj)
    elseif t == "pong" then
        hello_ok = true
    elseif t == "react" then
        if react.cb and tonumber(obj.seq) == react.seq then
            local fn = react.cb
            react.cb = nil
            local state = tonumber(obj.state) or 0
            pcall(fn, obj.ok == true, state, obj)
        end
    elseif t == "error" then
        local err = obj.err or "error"
        if err == "unknown_command" and not photo_supported then
            log.warn("photo", "C3 固件不支持照片命令", bridge_fw or "-")
            if pending then
                pending = nil
                mode = "line"
            end
            emit("unsupported", bridge_fw)
        else
            emit("bridge", err)
            if pending then
                fail_pending(err)
            end
        end
    end
end

local function on_receive(id, len)
    local data = uart.read(id, len)
    if not data or #data == 0 then return end
    last_rx = now_ms()

    while #data > 0 do
        if mode == "data" then
            local need = total - recv
            local take = #data
            if take > need then take = need end
            if take > 0 then
                local ok = file and file:write(data:sub(1, take))
                if not ok then
                    if file then pcall(function() file:close() end); file = nil end
                    if meta then remove_file(meta.path) end
                    meta = nil
                    total = 0
                    recv = 0
                    pending = nil
                    enter_flush()
                    emit("error", "写入失败", true)
                    return
                end
                recv = recv + take
                last_rx = now_ms()
                data = data:sub(take + 1)
                if recv == total or recv - last_emit >= 48 * 1024 then
                    last_emit = recv
                    emit("progress", recv, total)
                end
            end
            if recv >= total then
                finish_transfer()
            end
        elseif mode == "discard" then
            local take = #data
            if take > discard_left then take = discard_left end
            discard_left = discard_left - take
            data = data:sub(take + 1)
            discard_deadline = now_ms() + DISCARD_GRACE_MS
            if discard_left <= 0 then
                mode = "line"
                line_buf = ""
            end
        elseif mode == "flush" then
            data = ""
            flush_quiet = now_ms() + FLUSH_QUIET_MS
            flush_cap = now_ms() + FLUSH_CAP_MS
        else
            line_buf = line_buf .. data
            data = ""
            if #line_buf > MAX_LINE then
                line_buf = line_buf:sub(-1024)
            end
            while true do
                local pos = line_buf:find("\n", 1, true)
                if not pos then break end
                local line = line_buf:sub(1, pos - 1):gsub("\r", "")
                line_buf = line_buf:sub(pos + 1)
                if #line > 0 then
                    handle_line(line)
                end
                if mode ~= "line" then
                    -- 头部行之后就是二进制，剩余部分从头再走一遍
                    if #line_buf > 0 then
                        data = line_buf
                        line_buf = ""
                    end
                    break
                end
            end
        end
    end
end

local function tick()
    local t = now_ms()

    if mode == "discard" and t >= discard_deadline then
        mode = "line"
        discard_left = 0
        line_buf = ""
    end

    if mode == "flush" and (t >= flush_quiet or t >= flush_cap) then
        mode = "line"
        line_buf = ""
    end

    if mode == "data" and t - last_rx > STALL_MS then
        abort_transfer("下载中断", false)
    end

    if pending then
        if t >= pending.deadline then
            if mode == "data" then
                abort_transfer("下载超时", false)
            else
                pending = nil
                emit("error", "下载超时", true)
            end
        elseif mode == "line" and
               t >= (pending.next_try or ((pending.sent_at or 0) + REQUEST_RETRY_MS)) then
            if not pending.next_try and pending.sent_at then
                log.warn("photo", "请求无响应，重发", pending.seq)
            end
            send_request(pending)
        end
    end

    if react.cb and t >= react.deadline then
        local fn = react.cb
        react.cb = nil
        pcall(fn, false, 0, nil)
    end

    local lost_ms = pending and LINK_BUSY_MS or LINK_LOST_MS
    if hello_ok and t - last_rx > lost_ms then
        hello_ok = false
        wifi_up = false
        emit("offline")
    end

    if t - last_keepalive >= KEEPALIVE_MS then
        last_keepalive = t
        send(hello_ok and "STATUS\n" or "HELLO\n")
    end
end

M.now_ms = now_ms

function M.start(callback)
    if running then return true end
    cb = callback or function() end

    local ok = uart.setup(UART_ID, BAUD, 8, 1, uart.NONE, uart.LSB, 4096)
    if not ok then
        log.error("photo", "UART2 初始化失败", BAUD)
        return false, "uart"
    end

    uart.on(UART_ID, "receive", on_receive)
    running = true
    last_keepalive = now_ms()
    last_rx = last_keepalive
    send("HELLO\n")
    send("STATUS\n")
    sys.timerLoopStart(tick, 1000)
    log.info("photo", "UART2 已启动", BAUD)
    return true
end

--[[请求一张照片，成功后通过 done 事件返回 meta.path]]
function M.request(kind, path)
    if not running then return nil, "not_running" end
    if pending then
        abort_transfer("已被新请求取消", true)
    end
    seq = seq + 1
    pending = {
        seq = seq,
        kind = (kind == "liked") and "liked" or "random",
        path = path,
        deadline = now_ms() + PHOTO_TIMEOUT_MS,
        next_try = 0,
        retry_delay = RETRY_MS,
    }
    if mode == "line" then
        send_request(pending)
    end
    return seq
end

function M.react(id, action, callback)
    if not running or not id then return false end
    react.seq = react.seq + 1
    react.cb = callback
    react.deadline = now_ms() + REACT_TIMEOUT_MS
    send(string.format("REACT %d %d %s\n", react.seq, id, action))
    return true
end

function M.is_online()
    return hello_ok and wifi_up
end

return M
