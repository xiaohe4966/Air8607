--[[
@module  ui_album
@summary 电子相册 AirUI 界面（1024x600）
@note    播放源是本地照片库：TF 卡上按 id 存 p_<id>.jpg，photos.txt 记索引，断网也能照常轮播。
@note    ESP32-C3 只在后台补新照片（/api/photo/list 分页 + 按 id 下载），网络是辅助不是前提。
@note    存储目录不可用时退回 /ram，只保留最近两张；TF 卡不自动删，空间满了就停下不下载。
@note    全屏照片 + 底部控制栏；旋转按 90 度循环，亮度用 PWM3 调节。
]]
local client = require "photo_client"
local now_ms = client.now_ms

local M = {}
M.w = {}

local SCREEN_W, SCREEN_H = 1024, 600
local BL_PWM_CH = 3
local BRIGHT_MIN, BRIGHT_MAX = 10, 100
local INTERVAL_MIN, INTERVAL_MAX, INTERVAL_DEFAULT = 10, 300, 300
-- 整屏解码要 ~1.8 MB 连续内存，固件连着解几张之后就用不出来了（照片区域会黑）。
-- 显示满这么多张就重启一次设备，把解码内存清干净。
local REBOOT_AFTER = 3
local PAGE_RETRY_MS = 15000
local SYNC_IDLE_MS = 300000
local SYNC_MAX_PAGES = 12
local DEMO = "/luadb/demo.jpg"

local DIR_SD = "/sd/album"
local DIR_RAM = "/ram"
local store_dir = DIR_RAM
local VIEW_PATHS = {}
local VIEW_CUR = 1
local last_write = {}

-- 打了 patches/airui-image-cache-lua.patch 的新固件能主动删图片缓存条目，
-- 那就不用轮换显示路径、不用等 2 秒桶、也不用重启整机了；
-- 老固件（缓存按路径记、且从 Lua 侧作废不了）走下面那套绕法。
local HAVE_CACHE_DROP = type(airui.cache_drop) == "function"
log.info("album", "图片缓存可控", HAVE_CACHE_DROP and 1 or 0)

local C = {
    bg = 0x000000,
    surface = 0x0F1E31,
    surface2 = 0x12324A,
    line = 0x203550,
    line2 = 0x1E4A66,
    track = 0x1E3A55,
    text = 0xE6EEFC,
    dim = 0x7F98B8,
    dim2 = 0x4A6A8A,
    accent = 0x22D3EE,
    green = 0x22C55E,
    mask = 0x000000,
}

local BTN = {
    bg_color = C.surface2, bg_opa = 255,
    text_color = C.text,
    radius = 10,
    border_width = 1, border_color = C.line2,
    pressed_bg_color = 0x1B4A66,
}

local BTN_ON = {
    bg_color = 0x0E4E63, bg_opa = 255,
    text_color = C.accent,
    radius = 10,
    border_width = 1, border_color = C.accent,
    pressed_bg_color = 0x1B4A66,
}

local SRC = {
    liked = { name = "喜欢照片", filter = client.FILTER_LIKE },
    all = { name = "全部照片", filter = client.FILTER_ANY },
}

local ui = {
    root = nil,
    layer = nil,
    img = nil,
    img_back = nil,
    top = nil,
    bottom = nil,
    panel = nil,
    panel_open = false,
    bars_visible = true,
    rotation = 0,
    interval = INTERVAL_DEFAULT,
    brightness = BRIGHT_MAX,
    paused = false,
    source = "liked",
    current = nil,
    listing = false,
    fetching = false,
    requesting = nil,
    progress_step = -1,
    -- 本地照片库（播放源）
    library = {},
    lib_count = 0,
    lib_bytes = 0,
    playlist = {},
    play_idx = 0,
    history = {},
    play_round = 1,
    store_max = nil,
    -- 网络同步（后台补新）
    dlq = {},
    dlq_head = 1,
    syncing = false,
    downloading = false,
    sync_cursor = { liked = 0, all = 0 },
    sync_more = { liked = true, all = true },
    sync_from_zero = { liked = false, all = false },
    sync_page = 0,
    total = 0,
    online = false,
    stopped_full = false,
    msg_until = 0,
    waiting = false,
    show_pending = false,
    decoded = 0,
    deadline = 0,
    paused_remain = 0,
    retry_at = nil,
    pump = false,
    shown = 0,
    like_busy = false,
    unsupported = false,
}

local function fmt_sec(sec)
    sec = math.max(0, math.floor(sec))
    return string.format("%02d:%02d", math.floor(sec / 60), sec % 60)
end

-- 文本没变就不要调 set_text：控件一脏，整屏就要重绘，全屏 JPEG 会被重新软解一次，
-- 既拖慢帧率又要在解码瞬间挤出 ~1.8 MB 连续内存（解码失败时照片会发黑）
local TXT = setmetatable({}, { __mode = "k" })
local function set_text(w, text)
    if not w or TXT[w] == text then return end
    TXT[w] = text
    w:set_text(text)
end

local function set_status(text)
    set_text(M.w.status, text)
end

local function set_bar(v)
    if M.w.bar then
        v = math.max(0, math.min(1000, math.floor(v)))
        if TXT[M.w.bar] == v then return end
        TXT[M.w.bar] = v
        M.w.bar:set_value(v, false)
    end
end

local function apply_brightness(v)
    v = math.max(BRIGHT_MIN, math.min(BRIGHT_MAX, math.floor(v)))
    ui.brightness = v
    pcall(pwm.setDuty, BL_PWM_CH, v)
    set_text(M.w.brightVal, v .. "%")
    return v
end

local function update_like()
    if not M.w.like then return end
    if ui.like_busy then
        set_text(M.w.like, "处理中")
    elseif ui.current and ui.current.liked then
        set_text(M.w.like, "取消喜欢")
    else
        set_text(M.w.like, "喜欢")
    end
end

local function update_source()
    if M.w.source then
        set_text(M.w.source, "来源：" .. SRC[ui.source].name)
        M.w.source:set_style(ui.source == "liked" and BTN_ON or BTN)
    end
    if M.w.srcAll then M.w.srcAll:set_style(ui.source == "all" and BTN_ON or BTN) end
    if M.w.srcLiked then M.w.srcLiked:set_style(ui.source == "liked" and BTN_ON or BTN) end
end

local function image_zoom(w, h)
    if ui.rotation % 180 == 0 or not w or not h or w <= 0 or h <= 0 then
        return 256
    end
    local s = math.min(SCREEN_W / w, SCREEN_H / h)
    local bw, bh = w * s, h * s
    local k = math.min(SCREEN_W / bh, SCREEN_H / bw, 1)
    return math.max(32, math.floor(k * 256))
end

local function psram_free()
    local total, used = rtos.meminfo("psram")
    if type(total) == "number" and type(used) == "number" then
        return total - used
    end
end

local function destroy_image(obj)
    if not obj then return end
    pcall(obj.destroy, obj)
end

-- 下载中断或对端发错内容时文件可能只有半张，完整 JPEG 必须 SOI 开头、EOI 结尾
local function valid_jpeg(path)
    local f = io.open(path, "rb")
    if not f then return false end
    local ok, good = pcall(function()
        local size = f:seek("end")
        if not size or size < 4 then return false end
        f:seek("set", 0)
        local head = f:read(2)
        f:seek("set", size - 2)
        local tail = f:read(2)
        return head == "\255\216" and tail == "\255\217"
    end)
    pcall(function() f:close() end)
    return ok and good == true
end

-- 显示用的两条路径轮换着写，照片从本地库**就地覆盖**过去。
-- 为什么这么绕：
-- 1) AirUI 的图片缓存是按「路径」记解码后的像素。同一张照片一直用同一个路径，
--    缓存就不会重新读文件，屏幕会一直停在那一张；每张照片各用一个路径又会让
--    缓存越攒越多（4 张左右就再也分配不出整屏解码要的 ~1.8 MB 连续内存，之后全黑）。
--    两条路径轮换，缓存里最多留两份，内存够，路径上的内容也一直在变。
-- 2) 必须就地写：先写临时文件再改名的话，目标文件的修改时间不会更新。
-- 3) FAT 的修改时间只有 2 秒精度（秒数存的是 >>1）。两次写落在同一个 2 秒桶里，
--    缓存同样认不出来，所以同一条路径的两次写入要隔开 2 秒。
local function next_view_path()
    if HAVE_CACHE_DROP then
        -- 能主动清缓存就只用一条路径：缓存里永远只有一份，内存够
        return VIEW_PATHS[1]
    end
    VIEW_CUR = 3 - VIEW_CUR
    return VIEW_PATHS[VIEW_CUR]
end

local function stage_delay(path)
    if HAVE_CACHE_DROP then
        return 0   -- 缓存能主动清掉，写入间隔不用管 2 秒桶
    end
    local lw = last_write[path]
    if not lw then return 0 end
    local t = os.time()
    local earliest = math.floor(lw / 2) * 2 + 2
    if t >= earliest then return 0 end
    return (earliest - t) * 1000
end

local function stage_view(src, path)
    local fi = io.open(src, "rb")
    if not fi then return false end
    local fo = io.open(path, "wb")
    if not fo then
        pcall(function() fi:close() end)
        return false
    end
    local ok = true
    pcall(function()
        while true do
            local chunk = fi:read(16384)
            if not chunk or #chunk == 0 then break end
            if not fo:write(chunk) then ok = false break end
        end
    end)
    pcall(function() fo:close() end)
    pcall(function() fi:close() end)
    if not ok or not valid_jpeg(path) then
        log.warn("album", "复制到显示路径失败", src)
        return false
    end
    last_write[path] = os.time()
    return true
end

local function render_image(meta, path, staged)
    local demo = meta.demo == true
    if not demo and not staged then
        -- 先把新照片写进这条路径（另一条路径上的那张还在屏上，不会黑）
        if not stage_view(meta.path, path) then return false end
    end
    -- 旧图先删：AirUI 的图片缓存/图池是有限的，整屏解码要 ~1.8 MB 连续内存，
    -- 同时留着两张解码结果就分不出来了（实测第 5 次换图起就开始 decode fail）。
    destroy_image(ui.img)
    if ui.img_back then destroy_image(ui.img_back) end
    ui.img_back = nil
    if HAVE_CACHE_DROP and path then
        -- 旧控件已经删了（它还指着缓存里的条目），现在把这条路径的缓存条目也删掉：
        -- 池子里腾出位置，这次解码一定分配得到 1.8 MB 连续内存
        pcall(airui.cache_drop, path)
    end
    ui.img = airui.image({
        parent = ui.layer,
        x = 0, y = 0, w = SCREEN_W, h = SCREEN_H,
        src = demo and meta.path or path,
        fit = "contain",
        rotation = ui.rotation * 10,
        zoom = image_zoom(meta.w, meta.h),
        on_click = function() M.toggle_bars() end,
    })
    if not ui.img then
        log.warn("album", "创建图片失败", meta.path)
        return false
    end
    ui.img:set_rotation(ui.rotation * 10)
    ui.img:set_zoom(image_zoom(meta.w, meta.h))
    return true
end

--[[本地照片库：TF 卡上按 id 存 p_<id>.jpg，photos.txt 记索引。
     播放源永远是本地库，ESP32-C3 只在后台补新照片，所以断网也能照常轮播。]]
local function photo_path(id)
    return store_dir .. "/p_" .. tostring(id) .. ".jpg"
end

local function shuffle(list)
    for i = #list, 2, -1 do
        local j = math.random(i)
        list[i], list[j] = list[j], list[i]
    end
end

-- io.fsstat 在 fatfs 下的数字不可信（报的 total 明明小于卡上已有照片的体积），
-- 只用来打日志参考；真正的「满了」靠写入失败来判断
local function free_bytes()
    local ok, total, free = io.fsstat(store_dir)
    if not ok then return nil end
    total = tonumber(total) or 0
    free = tonumber(free) or 0
    if free > total and free >= 0x80000000 then
        free = total - (0x100000000 - free)
    end
    if free < 0 then free = 0 end
    return free, total
end

local function lib_line(e)
    return string.format("%d %d %d %d %d %s\n", e.id, e.w or 0, e.h or 0,
        e.bytes or 0, e.like or 0, e.at or "")
end

local function load_library()
    ui.library = {}
    ui.lib_count = 0
    ui.lib_bytes = 0
    local f = io.open(store_dir .. "/photos.txt", "rb")
    if not f then return end
    local buf = ""
    pcall(function()
        while true do
            local chunk = f:read(4096)
            if not chunk or #chunk == 0 then break end
            buf = buf .. chunk
            local pos = buf:find("\n", 1, true)
            while pos do
                local line = buf:sub(1, pos - 1)
                buf = buf:sub(pos + 1)
                local id, w, h, bytes, like, at = line:match(
                    "^(%d+)%s+(%d+)%s+(%d+)%s+(%d+)%s+(%-?%d+)%s*(.*)$")
                if id then
                    local e = { id = tonumber(id), w = tonumber(w), h = tonumber(h),
                        bytes = tonumber(bytes), like = tonumber(like), at = at }
                    e.path = photo_path(e.id)
                    e.liked = (e.like or 0) == 1
                    if not ui.library[e.id] then
                        ui.lib_count = ui.lib_count + 1
                    end
                    ui.library[e.id] = e
                    ui.lib_bytes = ui.lib_bytes + (e.bytes or 0)
                end
                pos = buf:find("\n", 1, true)
            end
        end
    end)
    pcall(function() f:close() end)
    log.info("album", "本地照片库", ui.lib_count, ui.lib_bytes)
end

local function library_append(e)
    local f = io.open(store_dir .. "/photos.txt", "ab")
    if not f then return false end
    pcall(function() f:write(lib_line(e)) end)
    pcall(function() f:close() end)
    return true
end

local function library_rewrite()
    local f = io.open(store_dir .. "/photos.txt", "wb")
    if not f then return end
    pcall(function()
        for _, e in pairs(ui.library) do f:write(lib_line(e)) end
    end)
    pcall(function() f:close() end)
end

-- RAM 太小只留最近两张；TF 卡按用户要求不自动删，满了就停下不下载
local function evict_old()
    if not ui.store_max then return end
    while ui.lib_count > ui.store_max do
        local victim
        for _, e in pairs(ui.library) do
            if (not ui.current or e.id ~= ui.current.id)
               and (victim == nil or tostring(e.at or "") < tostring(victim.at or "")) then
                victim = e
            end
        end
        if not victim then break end
        ui.library[victim.id] = nil
        ui.lib_count = ui.lib_count - 1
        ui.lib_bytes = ui.lib_bytes - (victim.bytes or 0)
        pcall(os.remove, victim.path)
        for i, p in ipairs(ui.playlist) do
            if p.id == victim.id then table.remove(ui.playlist, i) break end
        end
    end
    library_rewrite()
end

local function source_ok(e)
    if ui.source == "liked" then return (e.like or 0) == 1 end
    return (e.like or 0) ~= -1
end

local function build_playlist()
    local list = {}
    for _, e in pairs(ui.library) do
        if source_ok(e) then table.insert(list, e) end
    end
    shuffle(list)
    ui.playlist = list
    ui.play_idx = 0
    log.info("album", "播放列表", #list, ui.source)
end

local function playlist_has(id)
    for _, e in ipairs(ui.playlist) do
        if e.id == id then return true end
    end
    return false
end

-- 取下一张本地照片；文件坏了就剔出库继续下一张
local function next_local()
    for _ = 1, 200 do
        if #ui.playlist == 0 then
            build_playlist()
            if #ui.playlist == 0 then return nil end
        end
        ui.play_idx = ui.play_idx + 1
        if ui.play_idx > #ui.playlist then
            ui.play_round = ui.play_round + 1
            build_playlist()
            ui.play_idx = 1
            if #ui.playlist == 0 then return nil end
        end
        local e = ui.playlist[ui.play_idx]
        if e and valid_jpeg(e.path) then return e end
        if e then
            log.warn("album", "本地照片损坏", e.id)
            pcall(os.remove, e.path)
            if ui.library[e.id] then
                ui.library[e.id] = nil
                ui.lib_count = ui.lib_count - 1
                ui.lib_bytes = ui.lib_bytes - (e.bytes or 0)
                library_rewrite()
            end
        end
    end
    return nil
end

-- 状态栏平时显示本地库和网络同步情况，临时提示用 flash() 顶几秒
local function sync_status()
    local parts = { string.format("本地 %d 张", ui.lib_count) }
    if ui.stopped_full then
        parts[#parts + 1] = "空间已满 · 已停止下载"
    elseif ui.downloading then
        parts[#parts + 1] = "后台补新中"
    elseif ui.syncing then
        parts[#parts + 1] = "正在取索引"
    elseif ui.online then
        parts[#parts + 1] = "已同步"
    else
        parts[#parts + 1] = "离线 · 只播本地"
    end
    local waiting = #ui.dlq - ui.dlq_head + 1
    if waiting > 0 then parts[#parts + 1] = string.format("待下 %d", waiting) end
    set_status(table.concat(parts, " · "))
end

local function flash(msg, ms)
    ui.msg_until = now_ms() + (ms or 3000)
    set_status(msg)
end

-- 状态：轮次 + 每个来源的同步游标
local function save_state()
    local f = io.open(store_dir .. "/state.txt", "wb")
    if not f then return end
    pcall(function()
        f:write(string.format("pass=%d\nliked=%d\nall=%d\n",
            ui.play_round, ui.sync_cursor.liked, ui.sync_cursor.all))
    end)
    pcall(function() f:close() end)
end

local function load_state()
    local f = io.open(store_dir .. "/state.txt", "rb")
    if f then
        local data = f:read("a") or ""
        pcall(function() f:close() end)
        local v = tonumber(data:match("pass=(%d+)"))
        if v and v > 0 then ui.play_round = v end
        v = tonumber(data:match("liked=(%d+)"))
        if v then ui.sync_cursor.liked = v end
        v = tonumber(data:match("all=(%d+)"))
        if v then ui.sync_cursor.all = v end
    end
    log.info("album", "状态", ui.play_round, ui.sync_cursor.liked, ui.sync_cursor.all)
end

-- 下载队列：网络只负责补新照片，下完存进本地库
local function pump_download()
    if ui.downloading or ui.stopped_full then return end
    while ui.dlq_head <= #ui.dlq do
        local item = ui.dlq[ui.dlq_head]
        ui.dlq_head = ui.dlq_head + 1
        local id = tonumber(item and item.id) or 0
        if id > 0 and not ui.library[id] then
            local seq = client.fetch(id, photo_path(id), item.key)
            if seq then
                ui.downloading = true
                ui.requesting = item
                log.info("album", "后台下载", id)
                return
            end
            ui.retry_at = now_ms() + PAGE_RETRY_MS
            return
        end
    end
end

local request_page

local function on_page(ok, info, err)
    ui.syncing = false
    if not ok then
        ui.retry_at = now_ms() + PAGE_RETRY_MS
        flash("取索引失败：" .. tostring(err))
        log.warn("album", "索引失败", tostring(err))
        return
    end
    ui.online = true
    ui.sync_page = ui.sync_page + 1
    local src = ui.source
    local before = ui.sync_cursor[src]
    local nxt = tonumber(info.next_after_id) or 0
    if nxt > 0 then ui.sync_cursor[src] = nxt end
    local items = info.items or {}
    local more = info.has_more == true
    if ui.sync_cursor[src] == before then more = false end
    if ui.sync_page >= SYNC_MAX_PAGES then more = false end

    if not more and not ui.sync_from_zero[src] then
        -- 这一轮还没从 0 扫过（可能是老版本留下的末尾游标），归零从头扫一遍
        log.warn("album", "同步游标到末尾，归零重扫", ui.sync_cursor[src])
        ui.sync_cursor[src] = 0
        ui.sync_more[src] = true
        ui.sync_from_zero[src] = true
        ui.sync_page = 0
        save_state()
        request_page()
        return
    end

    ui.sync_more[src] = more
    if not more then
        -- 这一轮扫到头了：等几分钟再从头扫一遍，把新照片收进来
        ui.retry_at = now_ms() + SYNC_IDLE_MS
    end

    local fresh = 0
    for _, item in ipairs(items) do
        local id = tonumber(item.id) or 0
        if id > 0 and not ui.library[id] then
            table.insert(ui.dlq, item)
            fresh = fresh + 1
        end
    end
    ui.total = tonumber(info.total) or ui.total
    log.info("album", "索引第", ui.sync_page, "收到", #items,
             "待下", fresh, "游标", ui.sync_cursor[src], "还有", more and 1 or 0)
    save_state()
    pump_download()
end

request_page = function()
    if ui.unsupported or ui.syncing then return end
    if ui.stopped_full then
        -- 卡满了：不再要索引，等用户清理后按刷新
        ui.retry_at = now_ms() + SYNC_IDLE_MS
        return
    end
    local src = ui.source
    if not ui.sync_more[src] or ui.sync_page >= SYNC_MAX_PAGES then
        -- 上一轮扫完了：归零重扫，把新照片收进来
        ui.sync_page = 0
        ui.sync_cursor[src] = 0
        ui.sync_more[src] = true
        ui.sync_from_zero[src] = true
        save_state()
    end
    ui.syncing = true
    local seq = client.list(ui.sync_cursor[src], client.LIST_MAX_LIMIT,
                            SRC[src].filter, on_page)
    if not seq then
        ui.syncing = false
        ui.retry_at = now_ms() + PAGE_RETRY_MS
        flash("索引请求发不出去，15 秒后重试")
        return
    end
end

local function ensure_flow()
    if ui.unsupported then return end
    if ui.retry_at and now_ms() < ui.retry_at then return end
    ui.retry_at = nil
    pump_download()
    if not ui.downloading then
        request_page()
    end
end

-- 整屏解码的内存用完之前重启一次设备：固件没法回收整屏解码的连续内存，
-- 重启是最干脆的清法（照片库在卡上，重启不丢，接着上次的位置继续）
local function reboot_soon()
    if HAVE_CACHE_DROP then
        return   -- 能清缓存就不用重启整机了
    end
    ui.decoded = ui.decoded + 1
    if ui.decoded < REBOOT_AFTER then return end
    log.info("album", "已显示", ui.decoded, "张，准备重启设备")
    sys.timerStart(function()
        if sys and sys.reboot then pcall(sys.reboot) return end
        if rtos and rtos.reboot then pcall(rtos.reboot) return end
        if os and os.reboot then pcall(os.reboot) return end
        log.warn("album", "找不到重启接口")
    end, 8000)
end

local pending_show = nil

local function show_at(meta, keep_history, path)
    if not render_image(meta, path) then
        flash("这张显示不出来，先换下一张")
        return false
    end
    ui.current = meta
    ui.shown = ui.shown + 1
    if not meta.demo then reboot_soon() end
    if not keep_history then
        table.insert(ui.history, meta)
        if #ui.history > 64 then table.remove(ui.history, 1) end
    end
    ui.waiting = false
    ui.paused = false
    ui.paused_remain = 0
    ui.deadline = now_ms() + ui.interval * 1000
    log.info("album", "显示照片", meta.id or 0, meta.w or 0, meta.h or 0, meta.path)

    if M.w.title then
        set_text(M.w.title, string.format("%s #%s", SRC[ui.source].name,
            tostring(meta.id or "-")))
    end
    if M.w.sub then
        local when = meta.at and (" · " .. tostring(meta.at):sub(1, 10)) or ""
        set_text(M.w.sub, string.format("%d × %d · 第 %d 张 · 第 %d 轮%s · 点击画面隐藏控制栏",
            meta.w or 0, meta.h or 0, ui.shown, ui.play_round, when))
    end
    set_text(M.w.pause, "暂停")
    update_like()
    update_source()
    set_bar(0)

    ensure_flow()
    sync_status()
    return true
end


local function show_photo(meta, keep_history)
    if meta.demo then
        return show_at(meta, keep_history, nil)
    end
    local path = next_view_path()
    local delay = stage_delay(path)
    if delay > 0 then
        -- 同一条路径离上次写入不到 2 秒，修改时间可能落在同一个桶里，
        -- 缓存认不出文件变了。等一下再换，屏幕上就一定会更新。
        pending_show = { meta = meta, history = keep_history, path = path }
        ui.show_pending = true
        sys.timerStart(function()
            local p = pending_show
            pending_show = nil
            ui.show_pending = false
            if p then show_at(p.meta, p.history, p.path) end
        end, delay + 60)
        return false
    end
    return show_at(meta, keep_history, path)
end

-- 换下一张：本地相册里往后走一张
local function do_switch()
    if ui.show_pending then return end
    local e = next_local()
    if e then
        show_photo(e)
        return true
    end
    ui.waiting = true
    flash("本地没有更多照片了，正在等网络补新…", 5000)
    ensure_flow()
    return false
end


local function on_event(ev, a, b)
    if ev == "hello" then
        set_text(M.w.net, "ESP32-C3 已连接")
        ui.online = true
        if b == false then
            ui.unsupported = true
            ui.syncing = false
            ui.downloading = false
            ui.retry_at = nil
            flash("C3 固件 " .. tostring(a) .. " 不支持分页，请升级到 1.2 以上", 8000)
        elseif ui.unsupported then
            ui.unsupported = false
            flash("C3 固件 " .. tostring(a) .. " 已支持分页")
            ensure_flow()
        end
    elseif ev == "net" then
        local up = a == true
        ui.online = up
        if M.w.net then
            if up then
                set_text(M.w.net, "WiFi 已连接")
            elseif type(b) == "table" and b.mode == "ap" then
                set_text(M.w.net, "配网热点已开")
            else
                set_text(M.w.net, "C3 未联网")
            end
        end
        if up then ensure_flow() end
    elseif ev == "offline" then
        set_text(M.w.net, "网卡无响应")
        ui.online = false
        flash("ESP32-C3 无响应，正在重连…（本地照片照常播放）")
    elseif ev == "begin" then
        ui.progress_step = -1
        log.info("album", "开始下载", a.id or 0, a.w or 0, a.h or 0, a.len or 0, a.path)
    elseif ev == "progress" then
        local recv, total = a, b
        -- 每 25% 才刷一次文字：刷得勤会让整屏照片反复重解
        local step = math.floor(recv * 4 / math.max(total, 1))
        if step ~= ui.progress_step then
            ui.progress_step = step
            local pct = total > 0 and math.floor(recv * 100 / total) or 0
            flash(string.format("后台补新 %d%% · %d / %d KB",
                pct, math.floor(recv / 1024), math.floor(total / 1024)), 2000)
        end
    elseif ev == "done" then
        ui.downloading = false
        local item = ui.requesting
        ui.requesting = nil
        log.info("album", "下载完成", a.id or 0, a.len or 0, a.w or 0, a.h or 0, a.path)
        if not valid_jpeg(a.path) then
            -- 文件不完整就丢掉，绝不切到解不出来的图
            log.warn("album", "照片文件不完整", a.len or 0, a.path)
            pcall(os.remove, a.path)
            ui.retry_at = now_ms() + PAGE_RETRY_MS
            flash("照片文件不完整 · 15 秒后重试")
            pump_download()
            return
        end
        local e = { id = a.id, w = a.w, h = a.h, bytes = a.len,
            like = (item and item.lk) or 0, at = item and item.at, path = a.path }
        e.liked = e.like == 1
        if not ui.library[e.id] then
            ui.lib_count = ui.lib_count + 1
            ui.lib_bytes = ui.lib_bytes + (e.bytes or 0)
        end
        local dup = ui.library[e.id] ~= nil
        ui.library[e.id] = e
        if dup then
            library_rewrite()
        else
            library_append(e)
        end
        evict_old()
        if source_ok(e) and not playlist_has(e.id) then
            table.insert(ui.playlist, e)
        end
        log.info("album", "入库", e.id, ui.lib_count, ui.lib_bytes)
        -- 先接着下载下一张，再决定要不要切画面：下载和索引用的是同一条串口，
        -- 反过来会让正在跑的索引请求被顶掉
        if not ui.current or ui.current.demo then
            show_photo(e)
        else
            flash(string.format("已存 %d 张 · 新增 #%s", ui.lib_count, tostring(e.id)), 2000)
        end
        pump_download()
        if not ui.downloading then ensure_flow() end
    elseif ev == "retry" then
        log.warn("album", "重试", tostring(a))
    elseif ev == "error" then
        ui.downloading = false
        local item = ui.requesting
        ui.requesting = nil
        local msg = tostring(a or "下载失败")
        log.warn("album", "下载失败", msg, b and "final" or "interrupted")
        if msg:find("open_failed") then
            -- 写不进去了：卡满了或者掉卡，按用户定的口径停下不下载
            ui.stopped_full = true
            flash("本地空间不足，已停止下载新照片（仍可离线播放）", 8000)
            log.warn("album", "写不进去，停止下载", msg)
            return
        end
        if b then
            -- 这张确认取不到：跳过，继续下一张
            ui.retry_at = now_ms() + PAGE_RETRY_MS
            flash("有一张取不到，已跳过")
            pump_download()
            if not ui.downloading then ensure_flow() end
        else
            flash("下载中断：" .. msg)
        end
    elseif ev == "unsupported" then
        ui.unsupported = true
        ui.syncing = false
        ui.downloading = false
        ui.retry_at = nil
        flash("C3 固件 " .. tostring(a) .. " 不支持分页，请升级到 1.2 以上", 8000)
    elseif ev == "bridge" then
        flash("网卡返回错误：" .. tostring(a))
    end
end

local function toggle_pause()
    if ui.paused then
        ui.paused = false
        ui.deadline = now_ms() + ui.paused_remain
        set_text(M.w.pause, "暂停")
    else
        ui.paused = true
        ui.paused_remain = math.max(0, ui.deadline - now_ms())
        set_text(M.w.pause, "继续")
    end
end

local function do_react(action)
    local cur = ui.current
    if not cur or cur.demo or not cur.id then
        flash("演示图片不能标记")
        return
    end
    if ui.like_busy then return end
    ui.like_busy = true
    update_like()
    flash("正在提交标记…")
    client.react(cur.id, action, function(ok, state)
        ui.like_busy = false
        if ok then
            cur.liked = (state == 1)
            local e = ui.library[cur.id]
            if e then
                e.like = state or 0
                library_rewrite()
            end
            if state == 1 then
                flash("已标记喜欢")
            elseif state == -1 then
                flash("已标记不喜欢")
            else
                flash("已取消标记")
            end
        else
            flash("标记失败，请稍后重试")
        end
        update_like()
    end)
end

local function rotate()
    ui.rotation = (ui.rotation + 90) % 360
    set_text(M.w.rot, "旋转 " .. ui.rotation)
    if ui.current and not ui.current.demo then
        render_image(ui.current, VIEW_PATHS[VIEW_CUR], true)
    end
end

local function switch_source(src)
    if ui.source == src then return end
    ui.source = src
    ui.waiting = false
    ui.retry_at = nil
    ui.sync_page = 0
    ui.sync_more[src] = true
    ui.sync_from_zero[src] = false
    ui.total = 0
    build_playlist()
    update_source()
    flash("切换到" .. SRC[src].name)
    ensure_flow()
    local e = next_local()
    if e then show_photo(e) end
end

local function button(parent, x, y, w, h, text, on_click, style)
    return airui.button({
        parent = parent, x = x, y = y, w = w, h = h,
        text = text, font_size = 15,
        style = style or BTN,
        on_click = on_click,
    })
end

local function slider(parent, x, y, w, min, max, value, on_change)
    local h = 26
    local pad = 3
    local over = math.floor(h / 2) - pad
    return airui.slider({
        parent = parent, x = x + over, y = y, w = w - over * 2, h = h,
        min = min, max = max, value = value,
        style = {
            bg_color = C.line, bg_opa = 255,
            border_color = C.line, border_width = 0,
            indicator_color = C.accent, indicator_opa = 255,
            knob_color = C.text, knob_opa = 255,
            knob_border_color = C.text, knob_border_width = 0,
            radius = 13, pad = pad,
        },
        on_change = on_change,
    })
end

local function build_bars()
    ui.top = airui.container({
        parent = ui.root, x = 0, y = 0, w = SCREEN_W, h = 66,
        color = C.mask, color_opacity = 255, radius = 0,
        border_width = 0, scrollable = false,
    })
    M.w.title = airui.label({
        parent = ui.top, x = 24, y = 8, w = 660, h = 28,
        text = "电子相册", font_size = 22, color = C.text,
        align = airui.TEXT_ALIGN_LEFT,
    })
    M.w.sub = airui.label({
        parent = ui.top, x = 24, y = 38, w = 760, h = 18,
        text = "等待 Wi-Fi 网卡", font_size = 12, color = C.dim,
        align = airui.TEXT_ALIGN_LEFT,
    })
    M.w.net = airui.label({
        parent = ui.top, x = 700, y = 22, w = 300, h = 22,
        text = "等待网卡", font_size = 13, color = C.accent,
        align = airui.TEXT_ALIGN_RIGHT,
    })

    ui.bottom = airui.container({
        parent = ui.root, x = 0, y = 498, w = SCREEN_W, h = 102,
        color = C.mask, color_opacity = 255, radius = 0,
        border_width = 0, scrollable = false,
    })
    M.w.status = airui.label({
        parent = ui.bottom, x = 24, y = 4, w = 720, h = 20,
        text = "准备中", font_size = 13, color = C.dim,
        align = airui.TEXT_ALIGN_LEFT,
    })
    M.w.next = airui.label({
        parent = ui.bottom, x = 740, y = 4, w = 260, h = 20,
        text = "下一张 --:--", font_size = 13, color = C.text,
        align = airui.TEXT_ALIGN_RIGHT,
    })

    M.w.bar = airui.bar and airui.bar({
        parent = ui.bottom, x = 24, y = 94, w = 976, h = 6,
        min = 0, max = 1000, value = 0, radius = 3,
        bg_color = C.track, indicator_color = C.accent,
        border_width = 0,
    }) or nil

    button(ui.bottom, 16, 46, 108, 44, "上一张", function() M.prev() end)
    button(ui.bottom, 132, 46, 108, 44, "下一张", function() M.next() end)
    M.w.pause = button(ui.bottom, 248, 46, 100, 44, "暂停", toggle_pause)
    M.w.rot = button(ui.bottom, 356, 46, 100, 44, "旋转 0", rotate)
    M.w.like = button(ui.bottom, 464, 46, 120, 44, "喜欢", function()
        do_react(ui.current and ui.current.liked and "none" or "like")
    end)
    M.w.source = button(ui.bottom, 592, 46, 150, 44, "来源：喜欢照片", function()
        switch_source(ui.source == "liked" and "all" or "liked")
    end)
    button(ui.bottom, 750, 46, 100, 44, "设置", function() M.toggle_panel() end)
    button(ui.bottom, 858, 46, 110, 44, "刷新", function() M.reload() end)
end

local function build_panel()
    ui.panel = airui.container({
        parent = ui.root, x = 596, y = 84, w = 404, h = 408,
        color = C.surface, color_opacity = 255, radius = 16,
        border_color = C.accent, border_width = 1,
        scrollable = false,
        on_click = function() end,
    })
    airui.label({
        parent = ui.panel, x = 24, y = 14, w = 220, h = 26,
        text = "设置", font_size = 20, color = C.text,
        align = airui.TEXT_ALIGN_LEFT,
    })
    button(ui.panel, 324, 12, 56, 32, "关闭", function() M.toggle_panel() end)
    airui.container({
        parent = ui.panel, x = 24, y = 52, w = 356, h = 1,
        color = C.line, color_opacity = 255, radius = 0,
        border_width = 0, scrollable = false,
    })

    airui.label({
        parent = ui.panel, x = 24, y = 64, w = 240, h = 20,
        text = "自动切换间隔", font_size = 14, color = C.dim,
        align = airui.TEXT_ALIGN_LEFT,
    })
    M.w.intervalVal = airui.label({
        parent = ui.panel, x = 280, y = 64, w = 100, h = 20,
        text = ui.interval .. " 秒", font_size = 14, color = C.accent,
        align = airui.TEXT_ALIGN_RIGHT,
    })
    slider(ui.panel, 24, 88, 356, INTERVAL_MIN, INTERVAL_MAX, ui.interval, function(self)
        local v = math.floor(self:get_value() + 0.5)
        ui.interval = v
        set_text(M.w.intervalVal, v .. " 秒")
        if not ui.paused then
            ui.deadline = now_ms() + v * 1000
        else
            ui.paused_remain = v * 1000
        end
    end)

    airui.label({
        parent = ui.panel, x = 24, y = 132, w = 240, h = 20,
        text = "屏幕亮度", font_size = 14, color = C.dim,
        align = airui.TEXT_ALIGN_LEFT,
    })
    M.w.brightVal = airui.label({
        parent = ui.panel, x = 280, y = 132, w = 100, h = 20,
        text = ui.brightness .. "%", font_size = 14, color = C.accent,
        align = airui.TEXT_ALIGN_RIGHT,
    })
    slider(ui.panel, 24, 156, 356, BRIGHT_MIN, BRIGHT_MAX, ui.brightness, function(self)
        apply_brightness(self:get_value())
    end)

    airui.label({
        parent = ui.panel, x = 24, y = 200, w = 240, h = 20,
        text = "照片来源", font_size = 14, color = C.dim,
        align = airui.TEXT_ALIGN_LEFT,
    })
    M.w.srcAll = button(ui.panel, 24, 224, 160, 40, "全部照片", function()
        switch_source("all")
    end)
    M.w.srcLiked = button(ui.panel, 196, 224, 184, 40, "喜欢照片", function()
        switch_source("liked")
    end)

    airui.label({
        parent = ui.panel, x = 24, y = 276, w = 240, h = 20,
        text = "标记当前照片", font_size = 14, color = C.dim,
        align = airui.TEXT_ALIGN_LEFT,
    })
    button(ui.panel, 24, 300, 104, 40, "喜欢", function() do_react("like") end)
    button(ui.panel, 140, 300, 104, 40, "不喜欢", function() do_react("dislike") end)
    button(ui.panel, 256, 300, 124, 40, "取消标记", function() do_react("none") end)

    airui.label({
        parent = ui.panel, x = 24, y = 352, w = 356, h = 36,
        text = "照片存在 " .. store_dir .. "（按 id 存档，断网也能播）；网络只负责后台补新",
        font_size = 12, color = C.dim2,
        align = airui.TEXT_ALIGN_LEFT,
    })
    ui.panel:set_hidden(true)
end

function M.toggle_bars()
    ui.bars_visible = not ui.bars_visible
    ui.top:set_hidden(not ui.bars_visible)
    ui.bottom:set_hidden(not ui.bars_visible)
    if not ui.bars_visible and ui.panel then
        ui.panel_open = false
        ui.panel:set_hidden(true)
    end
end

function M.toggle_panel()
    if not ui.panel then return end
    ui.panel_open = not ui.panel_open
    ui.panel:set_hidden(not ui.panel_open)
end

function M.next()
    if ui.unsupported then
        flash("C3 固件 " .. tostring(client.firmware() or "-") .. " 不支持分页，请升级到 1.2 以上")
        return
    end
    do_switch()
end

function M.prev()
    if #ui.history < 2 then
        flash("已经是第一张了")
        return
    end
    table.remove(ui.history)
    local e = ui.history[#ui.history]
    show_photo(e, true)
end

function M.reload()
    if ui.unsupported then
        flash("C3 固件不支持分页，请升级到 1.2 以上")
        return
    end
    ui.dlq = {}
    ui.dlq_head = 1
    ui.waiting = false
    ui.retry_at = nil
    ui.stopped_full = false
    ui.sync_page = 0
    ui.sync_cursor[ui.source] = 0
    ui.sync_more[ui.source] = true
    ui.sync_from_zero[ui.source] = false
    build_playlist()
    flash("重新扫描索引…")
    ensure_flow()
end

local function tick()
    local t = now_ms()

    if (ui.pump or (ui.retry_at and t >= ui.retry_at))
       and not ui.syncing and not ui.downloading then
        ui.pump = false
        ensure_flow()
    end

    if ui.current and not ui.current.demo then
        if ui.paused then
            set_text(M.w.next, "已暂停 · " .. fmt_sec(ui.paused_remain / 1000))
        else
            local remain = ui.deadline - t
            if remain <= 0 then
                do_switch()
            else
                set_text(M.w.next, "下一张 " .. fmt_sec(remain / 1000))
                set_bar((ui.interval * 1000 - remain) / (ui.interval * 1000) * 1000)
            end
        end
    elseif ui.current and ui.current.demo then
        set_text(M.w.next, "演示图片")
        set_bar(0)
        ensure_flow()
    end

    if t >= (ui.msg_until or 0) then
        sync_status()
    end
end

local function mount_store()
    if _G.SD_READY ~= true then
        log.warn("album", "TF 卡没挂上，照片写在 /ram")
        return DIR_RAM
    end
    pcall(io.mkdir, DIR_SD)
    local f = io.open(DIR_SD .. "/.probe", "wb")
    if not f then
        log.warn("album", "TF 卡不可写，照片写在 /ram")
        return DIR_RAM
    end
    pcall(function() f:write("x") end)
    pcall(function() f:close() end)
    pcall(os.remove, DIR_SD .. "/.probe")
    return DIR_SD
end

function M.build(parent)
    math.randomseed(os.time())

    store_dir = mount_store()
    VIEW_PATHS[1] = store_dir .. "/view_a.jpg"
    VIEW_PATHS[2] = store_dir .. "/view_b.jpg"
    -- RAM 太小只留最近两张；TF 卡按用户要求不自动删，满了就停下不下载
    if store_dir == DIR_SD then
        ui.store_max = nil
    else
        ui.store_max = 2
    end

    ui.root = airui.container({
        parent = parent, x = 0, y = 0, w = SCREEN_W, h = SCREEN_H,
        color = C.bg, color_opacity = 255, radius = 0,
        border_width = 0, scrollable = false,
    })

    log.info("album", "可用空间", free_bytes())
    load_library()
    load_state()
    build_playlist()

    -- 照片层先于顶栏/底栏创建：换图时重建 image 也不会盖住按钮
    ui.layer = airui.container({
        parent = ui.root, x = 0, y = 0, w = SCREEN_W, h = SCREEN_H,
        color = C.bg, color_opacity = 0, radius = 0,
        border_width = 0, scrollable = false,
    })

    ui.current = { path = DEMO, w = 1024, h = 768, demo = true }
    render_image(ui.current)

    build_bars()
    build_panel()

    set_text(M.w.title, "电子相册")
    set_text(M.w.sub, "演示图片 · 等待 ESP32-C3 网卡")
    set_status("等待 ESP32-C3 网卡")
    update_like()
    update_source()
    apply_brightness(ui.brightness)

    local ok = client.start(on_event)
    log.info("album", "psram free", psram_free() or -1)
    if not ok then
        flash("UART2 不可用，只能播本地照片", 8000)
        set_text(M.w.net, "串口异常")
    else
        ensure_flow()
    end

    -- 本地已经有照片就直接播，不用等网络
    local e = next_local()
    if e then show_photo(e) end

    sys.timerLoopStart(tick, 500)
    log.info("album", "ui ready", store_dir, ui.lib_count, ui.play_round)
    return ui.root
end

return M
