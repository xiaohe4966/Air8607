--[[
@module  audio_click
@summary 点击音效与音量控制（Air8607 内置 DAC + HT6873 功放）
@note    音效文件为 res/click.wav，烧录后位于 /luadb/click.wav；exaudio 不可用时自动静音，不影响界面。
]]
local M = {}

local exaudio = nil
local ready = false
local volume = 70
local restore_fn = nil
local last_click = nil
local CLICK_FILE = "/luadb/click.wav"
local CLICK_MIN_GAP_MS = 60

local function now_ms()
    if mcu and mcu.ticks then
        local v = mcu.ticks()
        if v then return v end
    end
    return os.time() * 1000
end

local function restore_bus()
    if restore_fn then pcall(restore_fn) end
end

function M.setup(opts)
    opts = opts or {}
    local ok, lib = pcall(require, "exaudio")
    if not ok or not lib then
        log.warn("audio_click", "exaudio 不可用，点击音效关闭")
        return false
    end
    local ok2 = pcall(lib.setup, {
        model = "dac",
        pa_ctrl = 73,
        pa_on_level = 1,
        channels = 1,
    })
    if not ok2 then
        log.error("audio_click", "exaudio.setup 失败，点击音效关闭")
        return false
    end
    exaudio = lib
    ready = true
    M.set_volume(opts.volume or volume)
    log.info("audio_click", "音效就绪，音量", volume)
    return true
end

--[[main.lua 在触摸初始化后注入 gt911.i2c_restore：
音频通路会重配 I2C1，每次播放/调音量后恢复触摸总线。]]
function M.set_restore(fn)
    restore_fn = fn
end

function M.set_volume(v)
    v = tonumber(v) or volume
    if v < 0 then v = 0 elseif v > 100 then v = 100 end
    volume = math.floor(v)
    if ready then
        pcall(exaudio.vol, volume)
        restore_bus()
    end
    return volume
end

function M.get_volume()
    return volume
end

function M.is_ready()
    return ready
end

function M.click()
    if not ready then return end
    local t = now_ms()
    if last_click and t - last_click < CLICK_MIN_GAP_MS then return end
    last_click = t
    pcall(exaudio.play_start, {
        type = 0,
        content = CLICK_FILE,
        priority = 1,
        cbfnc = function() restore_bus() end,
    })
    restore_bus()
end

return M
