--[[
@module  net_bridge
@summary Air8607 与 ESP32-C3 WiFi 网卡的最小串口协议
@note    UART2 = J110 RX2/TX2，115200 8N1，按行传输 JSON。
@note    ESP32-C3 负责 WiFi 和 HTTPS；Air8607 只负责发命令、解析结果、更新 UI。
]]

local M = {}

local UART_ID = 2
local BAUD = 115200
local POLL_MS = 2000

local ui_ref
local rx_buf = ""
local started = false
local got_result = false

local function set_status(text)
    if ui_ref and ui_ref.set_network_status then
        ui_ref.set_network_status(text)
    end
end

local function handle_netinfo(obj)
    if obj.ok then
        local ip = obj.ip or ""
        local date = obj.date or ""
        got_result = true
        if ui_ref and ui_ref.set_network_info then
            ui_ref.set_network_info(ip, date)
        end
        log.info("net_bridge", "公网 IP:", ip, "时间:", date,
                 "local:", obj.local_ip or "-")
        return
    end

    local err = obj.err or "not_ready"
    if obj.mode == "ap" or err == "wifi_config_required" then
        set_status("IP 配网中...")
    elseif err == "not_ready" or err == "wifi_connecting" then
        set_status("IP 获取中...")
    elseif err == "http_open" or err == "http_status" or err == "json_parse" then
        set_status("IP 获取失败")
    else
        set_status("IP 获取失败")
    end
    if obj.fetch_done then
        got_result = true
    end
    log.warn("net_bridge", "网络信息未就绪:", err,
             "wifi:", obj.wifi and "up" or "down", "mode:", obj.mode or "?")
end

local function handle_line(line)
    local ok, obj = pcall(json.decode, line)
    if not ok or type(obj) ~= "table" then
        log.warn("net_bridge", "JSON 解析失败:", line)
        return
    end

    if obj.type == "netinfo" then
        handle_netinfo(obj)
    elseif obj.type == "status" then
        if obj.fetch_done then
            got_result = true
        end
        if obj.fetch_ok then
            if ui_ref and ui_ref.set_network_info then
                ui_ref.set_network_info(obj.ip or "", obj.date or "")
            end
            got_result = true
        elseif obj.mode == "ap" then
            set_status("IP 配网中...")
        elseif obj.wifi then
            set_status("IP 获取中...")
        else
            set_status("IP 等待网卡...")
        end
    elseif obj.type == "hello" then
        log.info("net_bridge", "ESP32-C3 已连接:", obj.fw or "?", "proto", obj.proto or "?")
    elseif obj.type == "error" then
        log.warn("net_bridge", "ESP32-C3 错误:", obj.err or "unknown")
    end
end

local function on_uart_receive(id, len)
    local data = uart.read(id, len)
    if not data or #data == 0 then
        return
    end

    rx_buf = rx_buf .. data
    if #rx_buf > 4096 then
        rx_buf = rx_buf:sub(-2048)
    end

    while true do
        local pos = rx_buf:find("\n", 1, true)
        if not pos then
            break
        end
        local line = rx_buf:sub(1, pos - 1):gsub("\r", "")
        rx_buf = rx_buf:sub(pos + 1)
        if #line > 0 then
            handle_line(line)
        end
    end
end

--[[启动 UART2 网卡客户端
@param table ui ui_page 模块，需提供 set_network_info / set_network_status
@return boolean 是否初始化成功
]]
function M.start(ui)
    if started then
        return true
    end
    ui_ref = ui

    local ok = uart.setup(UART_ID, BAUD, 8, 1, uart.NONE, uart.LSB, 2048)
    if not ok then
        log.error("net_bridge", "UART2 初始化失败", BAUD)
        set_status("IP 串口不可用")
        return false
    end

    uart.on(UART_ID, "receive", on_uart_receive)
    started = true
    set_status("IP 获取中...")
    log.info("net_bridge", "UART2 已启动，等待 ESP32-C3 网络信息")

    sys.taskInit(function()
        sys.wait(1200)
        local tries = 0
        while not got_result do
            local written = uart.write(UART_ID, "FETCH\n")
            tries = tries + 1
            if tries == 4 then
                set_status("IP 等待网卡...")
                log.warn("net_bridge", "未收到 ESP32-C3 响应，请检查 UART2 接线和共地",
                         "TX bytes:", written)
            end
            sys.wait(POLL_MS)
        end
        log.info("net_bridge", "已取得网络结果，停止轮询")
    end)

    return true
end

return M
