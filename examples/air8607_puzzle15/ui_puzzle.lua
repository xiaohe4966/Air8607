--[[
@module  ui_puzzle
@summary 数字华容道（15 Puzzle）Air8607 1024x600 触摸界面
@note    棋盘 4x4，点击与空格相邻的数字块即可滑动；逻辑在 puzzle_core.lua。
]]
local core = require "puzzle_core"
local audio = require "audio_click"

local M = {}
M.w = {}             -- 需要动态改文字的控件
M.overlay = nil      -- 完成弹窗

local SCREEN_W, SCREEN_H = 1024, 600
local N = 4
local TILE = 100
local GAP = 10
local PAD = 9
local BOARD_X, BOARD_Y = 48, 96
local BOARD_W = TILE * N + GAP * (N - 1) + PAD * 2

local BL_PWM_CH = 3
local BRIGHT_MIN, BRIGHT_MAX = 10, 100
local brightness = BRIGHT_MAX
local volume = 70

local C = {
    bg = 0x07111F,
    surface = 0x0F1E31,
    surface2 = 0x12324A,
    tile = 0x12324A,
    tile_press = 0x1B4A66,
    line = 0x203550,
    line2 = 0x1E4A66,
    ready = 0x2E6A8A,
    text = 0xE6EEFC,
    dim = 0x7F98B8,
    dim2 = 0x4A6A8A,
    accent = 0x22D3EE,
    green = 0x22C55E,
    mask = 0x02060C,
}

local TILE_STYLE = {
    bg_color = C.tile, bg_opa = 255,
    text_color = C.text,
    radius = 14,
    border_width = 1, border_color = C.line2,
    pressed_bg_color = C.tile_press,
}

local TILE_READY_STYLE = {
    bg_color = C.tile, bg_opa = 255,
    text_color = C.text,
    radius = 14,
    border_width = 1, border_color = C.ready,
    pressed_bg_color = C.tile_press,
}

local BLANK_STYLE = {
    bg_color = 0x0A1625, bg_opa = 255,
    text_color = 0x0A1625,
    radius = 14,
    border_width = 0, border_color = 0x0A1625,
    pressed_bg_color = 0x0A1625,
}

local game = core.new(N)
local tiles = {}
local status = { won = false, started = 0, elapsed = 0, timer = nil }

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

local function fmt_time(ms)
    local sec = math.floor(math.max(0, ms) / 1000)
    return string.format("%02d:%02d", math.floor(sec / 60), sec % 60)
end

local function apply_brightness(v)
    v = math.max(BRIGHT_MIN, math.min(BRIGHT_MAX, math.floor(v)))
    brightness = v
    pcall(pwm.setDuty, BL_PWM_CH, v)
    return v
end

local function render()
    for i = 1, N * N do
        local v = game.tiles[i]
        local obj = tiles[i]
        if obj then
            if v == 0 then
                obj:set_text("")
                obj:set_style(BLANK_STYLE)
            else
                obj:set_text(tostring(v))
                obj:set_style(core.can_move(game, i) and TILE_READY_STYLE or TILE_STYLE)
            end
        end
    end
end

local function win()
    status.won = true
    status.elapsed = now_ms() - status.started
    if M.w.time then M.w.time:set_text(fmt_time(status.elapsed)) end
    if M.w.status then M.w.status:set_text("● 已完成") end
    if M.w.winText then
        M.w.winText:set_text(string.format("共 %d 步 · 用时 %s", game.moves, fmt_time(status.elapsed)))
    end
    if M.overlay then M.overlay:set_hidden(false) end
    log.info("puzzle", "solved", game.moves, fmt_time(status.elapsed))
end

local function start_game()
    core.shuffle(game)
    status.won = false
    status.elapsed = 0
    status.started = now_ms()
    if M.overlay then M.overlay:set_hidden(true) end
    if M.w.status then M.w.status:set_text("● 进行中") end
    if M.w.moves then M.w.moves:set_text(tostring(game.moves)) end
    if M.w.time then M.w.time:set_text("00:00") end
    render()
    log.info("puzzle", "new game, manhattan:", core.manhattan(game))
end

local function try_move(idx)
    if status.won then return end
    if not core.move(game, idx) then return end
    audio.click()
    if M.w.moves then M.w.moves:set_text(tostring(game.moves)) end
    render()
    if core.is_solved(game) then win() end
end

local function button(parent, x, y, w, h, text, font_size, style, on_click)
    return airui.button({
        parent = parent, x = x, y = y, w = w, h = h,
        text = text, font_size = font_size or 16,
        style = style,
        on_click = on_click,
    })
end

local function build_header(root)
    airui.container({
        parent = root, x = 0, y = 0, w = SCREEN_W, h = 72,
        color = C.surface, color_opacity = 255, radius = 0,
        border_width = 0, scrollable = false,
    })
    airui.container({
        parent = root, x = 24, y = 20, w = 6, h = 32,
        color = C.accent, color_opacity = 255, radius = 3,
        border_width = 0, scrollable = false,
    })
    airui.label({
        parent = root, x = 44, y = 12, w = 520, h = 34,
        text = "数字华容道", font_size = 26, color = C.text,
        align = airui.TEXT_ALIGN_LEFT,
    })
    airui.label({
        parent = root, x = 44, y = 44, w = 640, h = 18,
        text = "15 PUZZLE · 点击与空格相邻的数字块", font_size = 13, color = C.dim,
        align = airui.TEXT_ALIGN_LEFT,
    })

    airui.container({
        parent = root, x = 824, y = 20, w = 176, h = 32,
        color = C.surface2, color_opacity = 255, radius = 16,
        border_color = C.line2, border_width = 1, scrollable = false,
    })
    M.w.status = airui.label({
        parent = root, x = 824, y = 20, w = 176, h = 32,
        text = "● 进行中", font_size = 15, color = C.accent,
        align = airui.TEXT_ALIGN_CENTER,
    })
end

local function build_board(root)
    local board = airui.container({
        parent = root, x = BOARD_X, y = BOARD_Y, w = BOARD_W, h = BOARD_W,
        color = 0x0A1625, color_opacity = 255, radius = 16,
        border_color = C.line, border_width = 1, scrollable = false,
    })
    for row = 1, N do
        for col = 1, N do
            local idx = (row - 1) * N + col
            tiles[idx] = button(
                board,
                PAD + (col - 1) * (TILE + GAP),
                PAD + (row - 1) * (TILE + GAP),
                TILE, TILE, "", 36, TILE_STYLE,
                function() try_move(idx) end
            )
        end
    end
end

local function slider(parent, x, y, w, min, max, value, on_change)
    local h = 28
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
            radius = 14, pad = pad,
        },
        on_change = on_change,
    })
end

local function build_panel(root)
    local panel = airui.container({
        parent = root, x = 520, y = 96, w = 456, h = 448,
        color = C.surface, color_opacity = 255, radius = 16,
        border_color = C.line, border_width = 1, scrollable = false,
    })
    airui.label({
        parent = panel, x = 28, y = 18, w = 400, h = 26,
        text = "本局数据", font_size = 18, color = C.text,
        align = airui.TEXT_ALIGN_LEFT,
    })
    airui.label({
        parent = panel, x = 28, y = 54, w = 160, h = 18,
        text = "步数", font_size = 13, color = C.dim,
        align = airui.TEXT_ALIGN_LEFT,
    })
    M.w.moves = airui.label({
        parent = panel, x = 28, y = 70, w = 160, h = 44,
        text = "0", font_size = 36, color = C.accent,
        align = airui.TEXT_ALIGN_LEFT,
    })
    airui.label({
        parent = panel, x = 228, y = 54, w = 200, h = 18,
        text = "用时", font_size = 13, color = C.dim,
        align = airui.TEXT_ALIGN_LEFT,
    })
    M.w.time = airui.label({
        parent = panel, x = 228, y = 74, w = 200, h = 40,
        text = "00:00", font_size = 30, color = C.text,
        align = airui.TEXT_ALIGN_LEFT,
    })
    airui.container({
        parent = panel, x = 28, y = 128, w = 400, h = 1,
        color = C.line, color_opacity = 255, radius = 0,
        border_width = 0, scrollable = false,
    })

    airui.label({
        parent = panel, x = 28, y = 144, w = 400, h = 26,
        text = "设置", font_size = 18, color = C.text,
        align = airui.TEXT_ALIGN_LEFT,
    })

    airui.label({
        parent = panel, x = 28, y = 176, w = 220, h = 20,
        text = "屏幕亮度", font_size = 14, color = C.dim,
        align = airui.TEXT_ALIGN_LEFT,
    })
    M.w.brightVal = airui.label({
        parent = panel, x = 328, y = 176, w = 100, h = 20,
        text = brightness .. "%", font_size = 14, color = C.accent,
        align = airui.TEXT_ALIGN_RIGHT,
    })
    slider(panel, 28, 200, 400, BRIGHT_MIN, BRIGHT_MAX, brightness, function(self)
        local v = apply_brightness(self:get_value())
        if M.w.brightVal then M.w.brightVal:set_text(v .. "%") end
    end)

    airui.label({
        parent = panel, x = 28, y = 236, w = 220, h = 20,
        text = "音量", font_size = 14, color = C.dim,
        align = airui.TEXT_ALIGN_LEFT,
    })
    volume = audio.get_volume()
    M.w.volVal = airui.label({
        parent = panel, x = 328, y = 236, w = 100, h = 20,
        text = volume .. "%", font_size = 14, color = C.accent,
        align = airui.TEXT_ALIGN_RIGHT,
    })
    slider(panel, 28, 260, 400, 0, 100, volume, function(self)
        volume = audio.set_volume(self:get_value())
        if M.w.volVal then M.w.volVal:set_text(volume .. "%") end
    end)

    airui.label({
        parent = panel, x = 28, y = 300, w = 400, h = 20,
        text = "点击空格旁的数字块滑动 · 目标 1 → 15",
        font_size = 13, color = C.dim2,
        align = airui.TEXT_ALIGN_LEFT,
    })
    button(
        panel, 28, 344, 400, 52, "重新开始", 18,
        {
            bg_color = C.surface2, bg_opa = 255,
            text_color = C.accent,
            radius = 10,
            border_width = 1, border_color = C.line2,
            pressed_bg_color = C.tile_press,
        },
        function()
            audio.click()
            start_game()
        end
    )
end

local function build_overlay(root)
    M.overlay = airui.container({
        parent = root, x = 0, y = 0, w = SCREEN_W, h = SCREEN_H,
        color = C.mask, color_opacity = 215, radius = 0,
        border_width = 0, scrollable = false,
        on_click = function() end,
    })
    airui.container({
        parent = M.overlay, x = 280, y = 150, w = 464, h = 300,
        color = C.surface, color_opacity = 255, radius = 18,
        border_color = C.accent, border_width = 1, scrollable = false,
    })
    airui.label({
        parent = M.overlay, x = 300, y = 184, w = 424, h = 56,
        text = "完成！", font_size = 40, color = C.green,
        align = airui.TEXT_ALIGN_CENTER,
    })
    M.w.winText = airui.label({
        parent = M.overlay, x = 300, y = 252, w = 424, h = 28,
        text = "共 0 步 · 用时 00:00", font_size = 18, color = C.text,
        align = airui.TEXT_ALIGN_CENTER,
    })
    airui.label({
        parent = M.overlay, x = 300, y = 288, w = 424, h = 22,
        text = "点击下方按钮重新挑战", font_size = 13, color = C.dim,
        align = airui.TEXT_ALIGN_CENTER,
    })
    button(
        M.overlay, 412, 340, 200, 52, "再来一局", 18,
        {
            bg_color = C.surface2, bg_opa = 255,
            text_color = C.accent,
            radius = 10,
            border_width = 1, border_color = C.line2,
            pressed_bg_color = C.tile_press,
        },
        function()
            audio.click()
            M.overlay:set_hidden(true)
            start_game()
        end
    )
    M.overlay:set_hidden(true)
end

function M.build(parent)
    math.randomseed(os.time())

    local root = airui.container({
        parent = parent, x = 0, y = 0, w = SCREEN_W, h = SCREEN_H,
        color = C.bg, color_opacity = 255, radius = 0,
        border_width = 0, scrollable = false,
    })

    build_header(root)
    build_board(root)
    build_panel(root)
    airui.label({
        parent = root, x = 48, y = 560, w = 928, h = 20,
        text = "提示：数字块只能滑入相邻的空格", font_size = 13, color = C.dim2,
        align = airui.TEXT_ALIGN_CENTER,
    })
    build_overlay(root)

    start_game()

    if status.timer then sys.timerStop(status.timer) end
    status.timer = sys.timerLoopStart(function()
        if not status.won and M.w.time then
            M.w.time:set_text(fmt_time(now_ms() - status.started))
        end
    end, 500)

    log.info("puzzle", "ui ready")
    return root
end

return M
