--[[
@module  ui_album
@summary 电子相册 AirUI 界面（1024x600）
@note    全屏照片 + 底部控制栏；照片经 ESP32-C3 下载到 /ram，单张最多等 600 秒。
@note    旋转按 90 度循环，亮度用 PWM3 调节，自动切换间隔可设 10-300 秒。
]]
local client = require "photo_client"
local now_ms = client.now_ms

local M = {}
M.w = {}

local SCREEN_W, SCREEN_H = 1024, 600
local BL_PWM_CH = 3
local BRIGHT_MIN, BRIGHT_MAX = 10, 100
local INTERVAL_MIN, INTERVAL_MAX, INTERVAL_DEFAULT = 10, 300, 60
local NEXT_TIMEOUT_MS = 600000

local PATH_A = "/ram/album_a.jpg"
local PATH_B = "/ram/album_b.jpg"
local DEMO = "/luadb/demo.jpg"

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

local ui = {
    root = nil,
    layer = nil,
    img = nil,
    prev = nil,
    top = nil,
    bottom = nil,
    panel = nil,
    panel_open = false,
    bars_visible = true,
    rotation = 0,
    interval = INTERVAL_DEFAULT,
    brightness = BRIGHT_MAX,
    paused = false,
    source = "random",
    current = nil,
    next = nil,
    fetching = false,
    waiting = false,
    deadline = 0,
    paused_remain = 0,
    retry_at = nil,
    download = nil,
    shown = 0,
    like_busy = false,
    unsupported = false,
}

local function fmt_sec(sec)
    sec = math.max(0, math.floor(sec))
    return string.format("%02d:%02d", math.floor(sec / 60), sec % 60)
end

local function set_status(text)
    if M.w.status then M.w.status:set_text(text) end
end

local function set_bar(v)
    if M.w.bar then
        v = math.max(0, math.min(1000, math.floor(v)))
        M.w.bar:set_value(v, false)
    end
end

local function apply_brightness(v)
    v = math.max(BRIGHT_MIN, math.min(BRIGHT_MAX, math.floor(v)))
    ui.brightness = v
    pcall(pwm.setDuty, BL_PWM_CH, v)
    if M.w.brightVal then M.w.brightVal:set_text(v .. "%") end
    return v
end

local function update_like()
    if not M.w.like then return end
    if ui.like_busy then
        M.w.like:set_text("处理中")
    elseif ui.current and ui.current.liked then
        M.w.like:set_text("取消喜欢")
    else
        M.w.like:set_text("喜欢")
    end
end

local function update_source()
    if M.w.source then
        M.w.source:set_text(ui.source == "liked" and "来源：喜欢" or "来源：随机")
        M.w.source:set_style(ui.source == "liked" and BTN_ON or BTN)
    end
    if M.w.srcRandom then M.w.srcRandom:set_style(ui.source == "random" and BTN_ON or BTN) end
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

local function destroy_image(obj)
    if not obj then return end
    pcall(function()
        if not obj:is_destroyed() then obj:destroy() end
    end)
end

local function render_image(meta)
    local old = ui.img
    if ui.prev and ui.prev ~= old then
        destroy_image(ui.prev)
    end
    ui.prev = nil
    ui.img = airui.image({
        parent = ui.layer,
        x = 0, y = 0, w = SCREEN_W, h = SCREEN_H,
        src = meta.path,
        fit = "contain",
        rotation = ui.rotation * 10,
        zoom = image_zoom(meta.w, meta.h),
        on_click = function() M.toggle_bars() end,
    })
    if ui.img then
        ui.img:set_rotation(ui.rotation * 10)
        ui.img:set_zoom(image_zoom(meta.w, meta.h))
    end
    -- JPEG 在首次绘制时才解码，先销毁旧图会黑屏到解码完成；旧图垫底几秒再删
    if old then
        ui.prev = old
        sys.timerStart(function()
            if ui.prev == old then
                ui.prev = nil
                destroy_image(old)
            end
        end, 3000)
    end
end

local function prefetch()
    if ui.unsupported or ui.fetching or ui.next then return end
    local path = PATH_A
    if ui.current and ui.current.path == PATH_A then
        path = PATH_B
    end
    ui.download = nil
    local seq = client.request(ui.source, path)
    ui.fetching = seq ~= nil
    log.info("album", "请求照片", ui.source, path, seq)
end

local function show_photo(meta)
    ui.current = meta
    ui.shown = ui.shown + 1
    ui.waiting = false
    ui.paused = false
    ui.paused_remain = 0
    ui.deadline = now_ms() + ui.interval * 1000
    render_image(meta)
    log.info("album", "显示照片", meta.id or 0, meta.w or 0, meta.h or 0, meta.path)

    if M.w.title then
        local name = (meta.kind == "liked") and "喜欢照片" or "随机照片"
        M.w.title:set_text(string.format("%s #%s", name, tostring(meta.id or "-")))
    end
    if M.w.sub then
        M.w.sub:set_text(string.format("%d × %d · 第 %d 张 · 点击画面隐藏控制栏",
            meta.w or 0, meta.h or 0, ui.shown))
    end
    if M.w.pause then M.w.pause:set_text("暂停") end
    update_like()
    update_source()
    set_bar(0)
    set_status("已显示")

    prefetch()
end

local function on_event(ev, a, b)
    if ev == "hello" then
        if M.w.net then M.w.net:set_text("ESP32-C3 已连接") end
        if b == false then
            ui.unsupported = true
            ui.fetching = false
            ui.retry_at = nil
            set_status("C3 固件 " .. tostring(a) ..
                       " 不支持照片，请升级到 1.1.0")
        elseif ui.unsupported then
            ui.unsupported = false
            set_status("C3 固件 " .. tostring(a) .. " 已支持照片")
            if not ui.current or ui.current.demo then prefetch() end
        end
    elseif ev == "net" then
        local up = a == true
        if M.w.net then
            if up then
                M.w.net:set_text("WiFi 已连接")
            elseif type(b) == "table" and b.mode == "ap" then
                M.w.net:set_text("配网热点已开")
            else
                M.w.net:set_text("C3 未联网")
            end
        end
        if up and not ui.current then
            prefetch()
        end
    elseif ev == "offline" then
        if M.w.net then M.w.net:set_text("网卡无响应") end
        set_status("ESP32-C3 无响应，正在重连…")
    elseif ev == "begin" then
        ui.download = { recv = 0, total = a.len or 0 }
        set_status(string.format("开始下载 #%s", tostring(a.id or "-")))
        log.info("album", "开始下载", a.id or 0, a.w or 0, a.h or 0, a.len or 0, a.path)
    elseif ev == "progress" then
        local recv, total = a, b
        ui.download = { recv = recv, total = total }
        local pct = total > 0 and math.floor(recv * 100 / total) or 0
        set_status(string.format("下载中 %d%% · %d / %d KB",
            pct, math.floor(recv / 1024), math.floor(total / 1024)))
    elseif ev == "done" then
        ui.fetching = false
        ui.download = nil
        log.info("album", "下载完成", a.id or 0, a.len or 0, a.w or 0, a.h or 0, a.path)
        if ui.current and a.path == ui.current.path then
            return
        end
        if a.kind ~= ui.source then
            pcall(os.remove, a.path)
            prefetch()
            return
        end
        ui.next = a
        if not ui.current or ui.current.demo or ui.waiting then
            ui.next = nil
            show_photo(a)
        else
            set_status(string.format("下一张已就绪 · %d KB", math.floor((a.len or 0) / 1024)))
        end
    elseif ev == "retry" then
        set_status(string.format("网络未就绪（%s），自动重试…", tostring(a)))
        log.warn("album", "重试", tostring(a))
    elseif ev == "error" then
        ui.fetching = false
        ui.download = nil
        local msg = tostring(a or "下载失败")
        log.warn("album", "下载失败", msg, b and "final" or "interrupted")
        if b then
            ui.retry_at = now_ms() + 30000
            set_status("下载失败：" .. msg .. " · 30 秒后重试")
        else
            set_status("下载中断：" .. msg)
        end
    elseif ev == "unsupported" then
        ui.unsupported = true
        ui.fetching = false
        ui.download = nil
        ui.retry_at = nil
        set_status("C3 固件 " .. tostring(a) ..
                   " 不支持照片，请升级到 1.1.0")
    elseif ev == "bridge" then
        set_status("网卡返回错误：" .. tostring(a))
    end
end

local function toggle_pause()
    if ui.paused then
        ui.paused = false
        ui.deadline = now_ms() + ui.paused_remain
        if M.w.pause then M.w.pause:set_text("暂停") end
    else
        ui.paused = true
        ui.paused_remain = math.max(0, ui.deadline - now_ms())
        if M.w.pause then M.w.pause:set_text("继续") end
    end
end

local function do_react(action)
    local cur = ui.current
    if not cur or cur.demo or not cur.id then
        set_status("演示图片不能标记")
        return
    end
    if ui.like_busy then return end
    ui.like_busy = true
    update_like()
    set_status("正在提交标记…")
    client.react(cur.id, action, function(ok, state)
        ui.like_busy = false
        if ok then
            cur.liked = (state == 1)
            if state == 1 then
                set_status("已标记喜欢")
            elseif state == -1 then
                set_status("已标记不喜欢")
            else
                set_status("已取消标记")
            end
        else
            set_status("标记失败，请稍后重试")
        end
        update_like()
    end)
end

local function rotate()
    ui.rotation = (ui.rotation + 90) % 360
    if M.w.rot then M.w.rot:set_text("旋转 " .. ui.rotation) end
    if ui.current then
        render_image(ui.current)
    end
end

local function switch_source(src)
    if ui.source == src then return end
    ui.source = src
    ui.next = nil
    ui.waiting = false
    update_source()
    set_status(src == "liked" and "切换到喜欢照片" or "切换到随机照片")
    if not ui.fetching then
        prefetch()
    end
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
        color = C.mask, color_opacity = 155, radius = 0,
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
        color = C.mask, color_opacity = 172, radius = 0,
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
        parent = ui.bottom, x = 24, y = 28, w = 976, h = 6,
        min = 0, max = 1000, value = 0, radius = 3,
        bg_color = C.track, indicator_color = C.accent,
        border_width = 0,
    }) or nil

    button(ui.bottom, 24, 46, 110, 44, "下一张", function() M.next() end)
    M.w.pause = button(ui.bottom, 144, 46, 110, 44, "暂停", toggle_pause)
    M.w.rot = button(ui.bottom, 264, 46, 110, 44, "旋转 0", rotate)
    M.w.like = button(ui.bottom, 384, 46, 140, 44, "喜欢", function()
        do_react(ui.current and ui.current.liked and "none" or "like")
    end)
    M.w.source = button(ui.bottom, 534, 46, 150, 44, "来源：随机", function()
        switch_source(ui.source == "random" and "liked" or "random")
    end)
    button(ui.bottom, 694, 46, 100, 44, "设置", function() M.toggle_panel() end)
    button(ui.bottom, 804, 46, 110, 44, "刷新", function() M.reload() end)
end

local function build_panel()
    ui.panel = airui.container({
        parent = ui.root, x = 596, y = 84, w = 404, h = 408,
        color = C.surface, color_opacity = 250, radius = 16,
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
        if M.w.intervalVal then M.w.intervalVal:set_text(v .. " 秒") end
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
    M.w.srcRandom = button(ui.panel, 24, 224, 160, 40, "随机照片", function()
        switch_source("random")
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
        text = "照片经 ESP32-C3 下载到 RAM，单张最长等待 600 秒",
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
        set_status("C3 固件不支持照片，请升级到 1.1.0")
        return
    end
    if ui.next then
        local n = ui.next
        ui.next = nil
        show_photo(n)
    else
        ui.waiting = true
        set_status("下一张还没下载好，正在等待…")
        if not ui.fetching then prefetch() end
    end
end

function M.reload()
    if ui.unsupported then
        set_status("C3 固件不支持照片，请升级到 1.1.0")
        return
    end
    if ui.fetching then
        set_status("正在下载，请稍候")
        return
    end
    ui.next = nil
    ui.waiting = false
    ui.retry_at = nil
    prefetch()
end

local function tick()
    local t = now_ms()

    if ui.retry_at and t >= ui.retry_at then
        ui.retry_at = nil
        prefetch()
    end

    if ui.current and not ui.current.demo then
        if ui.paused then
            if M.w.next then M.w.next:set_text("已暂停 · " .. fmt_sec(ui.paused_remain / 1000)) end
        else
            local remain = ui.deadline - t
            if remain <= 0 then
                if ui.next then
                    local n = ui.next
                    ui.next = nil
                    show_photo(n)
                else
                    if not ui.waiting then
                        ui.waiting = true
                        set_status("下一张还没下载好，正在等待…")
                    end
                    if not ui.fetching then prefetch() end
                    if M.w.next then M.w.next:set_text("等待下一张") end
                    set_bar(0)
                end
            else
                if M.w.next then
                    M.w.next:set_text("下一张 " .. fmt_sec(remain / 1000))
                end
                set_bar((ui.interval * 1000 - remain) / (ui.interval * 1000) * 1000)
            end
        end
    elseif ui.current and ui.current.demo then
        if M.w.next then M.w.next:set_text("演示图片") end
        set_bar(0)
        if not ui.fetching and not ui.retry_at then prefetch() end
    end
end

function M.build(parent)
    math.randomseed(os.time())

    ui.root = airui.container({
        parent = parent, x = 0, y = 0, w = SCREEN_W, h = SCREEN_H,
        color = C.bg, color_opacity = 255, radius = 0,
        border_width = 0, scrollable = false,
    })

    pcall(os.remove, PATH_A)
    pcall(os.remove, PATH_B)

    -- 照片层先于顶栏/底栏创建：换图时重建 image 也不会盖住按钮
    ui.layer = airui.container({
        parent = ui.root, x = 0, y = 0, w = SCREEN_W, h = SCREEN_H,
        color = C.bg, color_opacity = 0, radius = 0,
        border_width = 0, scrollable = false,
    })

    ui.current = { path = DEMO, w = 1024, h = 768, demo = true, kind = "demo" }
    render_image(ui.current)

    build_bars()
    build_panel()

    if M.w.title then M.w.title:set_text("电子相册") end
    if M.w.sub then M.w.sub:set_text("演示图片 · 等待 ESP32-C3 网卡") end
    set_status("等待 ESP32-C3 网卡")
    update_like()
    update_source()
    apply_brightness(ui.brightness)

    local ok = client.start(on_event)
    if not ok then
        set_status("UART2 不可用，只能显示演示图片")
        if M.w.net then M.w.net:set_text("串口异常") end
    else
        prefetch()
    end

    sys.timerLoopStart(tick, 500)
    log.info("album", "ui ready")
    return ui.root
end

return M
