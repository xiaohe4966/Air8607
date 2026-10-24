--[[
@module  main
@summary air8607_puzzle15 - AirUI 数字华容道（15 拼图）
@board   Air8607 + 10寸 RGB 1024x600 + GT911
@note    显示/触摸/背光引脚与官方 factory 工程一致；游戏逻辑在 puzzle_core.lua。
]]
PROJECT = "air8607_puzzle15"
VERSION = "1.0.0"

local exd = require "exd_air8607_rgb"
local ui = require "ui_puzzle"
local audio = require "audio_click"
local gt911 = require "tp_gt911"

local SCREEN_W, SCREEN_H = 1024, 600
local SCREEN_SIZE = 10       -- 物理尺寸：9 或 10 英寸
local LCD_PIN_RST = 15
local TP_PIN_RST = 14
local TP_PIN_INT = 51

local function power_on()
    pwm.setup(3, 1000, 0)       -- 背光 PWM3 先关，防开机花屏
    pwm.start(3)
    gpio.setup(17, 0)           -- LCD 供电使能
    gpio.setup(LCD_PIN_RST, 1)  -- LCD 复位/显示使能
    gpio.setup(73, 0)           -- AUDIOPA_EN 先拉低关断功放（HT6873 高电平使能）
    i2c.setup(1, i2c.FAST)      -- GT911 触摸 I2C1 400kHz
    sys.wait(100)
end

local function backlight_on()
    if pwm.setup(3, 1000, 100) then
        pwm.start(3)
        log.info("main", "backlight on")
    else
        log.error("main", "backlight init failed")
    end
end

local function touch_init()
    local ok = gt911.init({
        port = 1, pin_rst = TP_PIN_RST, pin_int = TP_PIN_INT,
        int_type = tp.FALLING, w = SCREEN_W, h = SCREEN_H,
        i2c_speed = i2c.FAST, i2c_polling = true,
    })
    if ok then
        log.info("main", "GT911 touch ready")
        return true
    end
    log.error("main", "GT911 touch init failed")
    return false
end

sys.taskInit(function()
    power_on()

    local ok, info = exd.setup({ pin_rst = LCD_PIN_RST, screen_size = SCREEN_SIZE })
    if not ok then
        log.error("main", "display init failed", info)
        return
    end
    log.info("main", "display ready", info.backend, info.w, info.h)

    airui.init(SCREEN_W, SCREEN_H)
    airui.set_rotation(0)
    airui.font_load({ type = "hzfont", size = 16, cache_size = 2048, antialias = 1 })

    -- 音频必须在触摸初始化之前：exaudio.setup 会重配 I2C1
    audio.setup({ volume = 70 })
    ui.build()
    touch_init()
    audio.set_restore(gt911.i2c_restore)
    backlight_on()
    log.info("main", "puzzle ready:", PROJECT)
end)

sys.run()
