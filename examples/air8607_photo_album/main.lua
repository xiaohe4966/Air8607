--[[
@module  main
@summary air8607_photo_album - AirUI 电子相册
@board   Air8607 + 10寸 RGB 1024x600 + GT911
@note    照片经 ESP32-C3（UART2）从 img.he66.cn 下载到 /ram 后显示。
]]
PROJECT = "air8607_photo_album"
VERSION = "1.0.0"

local exd = require "exd_air8607_rgb"
local ui = require "ui_album"
local gt911 = require "tp_gt911"

local SCREEN_W, SCREEN_H = 1024, 600
local SCREEN_SIZE = 10       -- 物理尺寸：9 或 10 英寸
local LCD_PIN_RST = 15
local TP_PIN_RST = 14
local TP_PIN_INT = 51
local SD_PIN_EN = 74         -- TF 卡供电使能
local SD_SPI_ID = 1          -- TF 卡走 SPI1
local SD_PIN_CS = 8
local SD_SPI_SPEED = 20 * 1000 * 1000

local function power_on()
    pwm.setup(3, 1000, 0)       -- 背光 PWM3 先关，防开机花屏
    pwm.start(3)
    gpio.setup(17, 0)           -- LCD 供电使能
    gpio.setup(LCD_PIN_RST, 1)  -- LCD 复位/显示使能
    gpio.setup(73, 0)           -- AUDIOPA_EN 拉低，避免功放空载噪声
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

local function sd_init()
    if type(fatfs) == "nil" then
        log.warn("sd", "固件没有 fatfs 库")
        return false
    end
    gpio.setup(SD_PIN_EN, 1)
    sys.wait(50)
    spi.setup(SD_SPI_ID, nil, 0, 0, 8, SD_SPI_SPEED)
    gpio.setup(SD_PIN_CS, 1)
    local ok, err = fatfs.mount(fatfs.SPI, "/sd/", SD_SPI_ID, SD_PIN_CS, SD_SPI_SPEED)
    if not ok then
        log.warn("sd", "mount fail", err)
        return false
    end
    local good, total, used, blk, fstype = io.fsstat("/sd/")
    log.info("sd", "fsstat", tostring(good), tostring(total), tostring(used),
             tostring(blk), tostring(fstype))
    local f = io.open("/sd/probe.txt", "wb")
    if f then
        f:write("air8607")
        f:close()
        local g = io.open("/sd/probe.txt", "rb")
        local data = g and g:read(7)
        if g then g:close() end
        log.info("sd", "write/read", data == "air8607" and "ok" or "fail")
        os.remove("/sd/probe.txt")
    else
        log.warn("sd", "write open fail")
    end
    return true
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
    _G.SD_READY = sd_init()

    local ok, info = exd.setup({ pin_rst = LCD_PIN_RST, screen_size = SCREEN_SIZE })
    if not ok then
        log.error("main", "display init failed", info)
        return
    end
    log.info("main", "display ready", info.backend, info.w, info.h)

    airui.init(SCREEN_W, SCREEN_H)
    airui.set_rotation(0)
    airui.font_load({ type = "hzfont", size = 16, cache_size = 2048, antialias = 1 })

    log.info("main", "control bar:", type(airui.bar), "slider:", type(airui.slider))

    ui.build()
    touch_init()
    backlight_on()
    log.info("main", "album ready:", PROJECT)
end)

sys.run()
