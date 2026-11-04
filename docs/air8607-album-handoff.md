# Air8607 电子相册 · 交接说明

> 这份文档写给**要接手继续优化这套代码的另一个 AI 工具**。
> 目标是：**本地相册连续自动播放、不黑屏**。下面第 6 节「不能踩的坑」是这个目标能不能达成的关键，
> 每一条都是 2026-11-01 在实机（Air8607 + ESP32-C3 SuperMini）上反复对照测出来的，不要凭直觉推翻它。
>
> 涉及文件：
> - `examples/air8607_photo_album/` — Air8607 端（LuatOS / AirUI）
> - `esp32c3_wifi_bridge/` — ESP32-C3 端（ESP-IDF，串口 WiFi 网卡 + 照片代理）
> - `docs/air8607-c3-wifi.md`、`docs/wiring/` — 接线和开发环境
> - `docs/hardware-validation.md` — 实机验证记录

---

## 1. 当前的功能

| 功能 | 说明 |
| --- | --- |
| 本地相册 | 照片按 id 存在 TF 卡上（`/sd/album/p_<id>.jpg`），索引 `/sd/album/photos.txt`，**播放源永远是本地库，断网照常看** |
| 网络是辅助 | ESP32-C3 只在后台按 25 条一页拉索引，和本地库比对，只下载没见过的 id；卡满就停下并提示，不自动删旧照片 |
| 上一张 / 下一张 | 只读本地文件，**完全不碰网络**；「上一张」沿播放历史往回走（历史记 64 张） |
| 暂停 | 冻结倒计时，进度条停在当前值 |
| 自动轮播 | 默认 **5 分钟（300 s）**一张，设置面板可拖 10–300 s |
| 旋转 | 90° 循环（0/90/180/270） |
| 亮度 | PWM3 背光 10–100%，滑块松手即生效 |
| 喜欢 / 不喜欢 / 取消标记 | 走 `REACT` 命令写回服务端，结果同时写进 `photos.txt` |
| 来源切换 | 「喜欢照片」(`like_state=1`) / 「全部照片」（不过滤），切换只播该来源的本地照片 |
| 刷新 | 清空待下队列、同步游标归零、重新扫一遍索引（库里已有的不会重下） |
| 自动重启 | **每显示 3 张就重启一次设备**，把固件不回收的整屏解码内存清掉（见 6.2） |

---

## 2. UI 逻辑

### 2.1 界面结构（1024×600）

```text
┌──────────────────────────────────────────────────────────┐
│ ▌喜欢照片 #29845                          ● Wi-Fi 已连接  │  顶栏 66px
│  1024 × 600 · 第 3 张 · 第 1 轮 · 2025-06-01              │
│                                                          │
│                  [        照片全屏显示        ]          │
│                                                          │
│ 本地 128 张 · 已同步 · 待下 12                  下一张 00:42 │  底栏 102px
│ [上一张][下一张][暂停][旋转 0][喜欢][来源：喜欢][设置][刷新] │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━     │
└──────────────────────────────────────────────────────────┘
```

- 照片层 `ui.layer` **先于**顶栏/底栏创建（`M.build`），所以换图重建 image 也不会盖住按钮。
- 顶栏/底栏都是**完全不透明**（`color_opacity = 255`）：半透明控件每次刷新都会让整屏 JPEG
  重新软解一次，是黑屏的放大器。
- 底栏按钮坐标：`上一张(16)`、`下一张(132)`、`暂停(248)`、`旋转(356)`、`喜欢(464)`、
  `来源(592)`、`设置(750)`、`刷新(858)`，都是 44px 高。
- 设置面板（右上 404×408）：切换间隔滑块、亮度滑块、旋转、来源二选一、三种标记按钮。
- 点照片区域 = 隐藏/恢复顶栏底栏（`on_click` → `M.toggle_bars()`）。

### 2.2 状态机（`ui_album.lua`）

```
M.build(parent)
 ├─ mount_store()          挂 TF 卡 → store_dir="/sd/album"；挂不上/写不进 → "/ram"
 ├─ ui.store_max           SD 卡为 nil（不删），RAM 兜底为 2（只留最近两张）
 ├─ load_library()         读 photos.txt → ui.library（id→条目）
 ├─ load_state()           读 state.txt → ui.play_round / ui.sync_cursor
 ├─ build_playlist()       按来源过滤 + 洗牌 → ui.playlist
 ├─ 建演示图 → build_bars() → build_panel()
 ├─ client.start(on_event) 开 UART2 客户端
 ├─ next_local() + show_photo()   库里有照片就直接播，不等网络
 └─ sys.timerLoopStart(tick, 500)
```

- `tick`（每 500 ms）：倒计时到点 → `do_switch()` → `next_local()` 取播放列表下一张
  → `show_at()` → `stage_view()` 把库里的照片**就地覆盖**到显示路径 → `render_image()`。
- `show_photo(meta, keep_history)`：挑一条显示路径（两条轮换），检查该路径的
  「2 秒桶」是否可用（见 6.3），不可用就延迟到下一个桶再换（`pending_show` + `sys.timerStart`）。
- `on_event(ev, a, b)` 事件：`hello / net / offline / begin / progress / done / error /
  retry / unsupported / bridge`。
  - `done`：校验落盘文件是完整 JPEG（`FF D8`…`FF D9`），不合格就删文件不入库；
    合格则写 `photos.txt`、加入播放列表、**接着下载下一张**，最后才考虑切画面。
  - `error`：确定失败（`bad_id`/`no_token`/HTTP 4xx/超时）就跳过这张；
    `open_failed` 判定为**卡满**，停止下载并提示。
- 状态栏文案：`本地 N 张`、`已同步 / 后台补新中 / 正在取索引 / 离线 · 只播本地`、
  `空间已满 · 已停止下载`、`待下 N`。
- 播放列表：`build_playlist()` 每轮洗牌一次，一轮播完 `ui.play_round += 1` 再洗牌。

### 2.3 关键文件职责

| 文件 | 职责 |
| --- | --- |
| `examples/air8607_photo_album/main.lua` | 上电时序、TF 卡挂载（`_G.SD_READY`）、RGB 屏、GT911 触摸、背光、AirUI 启动 |
| `examples/air8607_photo_album/ui_album.lua` | 界面 + 本地库（`photos.txt`/`state.txt` 读写）+ 播放列表 + 后台同步状态机 |
| `examples/air8607_photo_album/photo_client.lua` | UART2 行协议客户端：`LIST`/`PHOTO`/`REACT` 发送、JSON 行解析、JPEG 二进制落盘、重试/取消/保活 |
| `esp32c3_wifi_bridge/main/main.c` | C3 固件：WiFi/配网/HTTPS/UART 协议 + 照片代理 |

---

## 3. 接口地址与协议

### 3.1 照片接口（由 ESP32-C3 代理，Air8607 不直接联网）

| 用途 | 地址 | 说明 |
| --- | --- | --- |
| 索引分页 | `http://img.he66.cn/api/photo/list?limit=25&after_id=<id>&like_state=<f>` | `like_state`：1=喜欢、0=未标记、-1=不喜欢、-2=不过滤。C3 端把 `limit` 钳到 25 |
| 取图 | `http://img.he66.cn/api/photo/show?id=<id>` | 返回 JPEG 二进制，响应头带 `X-Photo-Id/Width/Height` |
| 标记 | `http://img.he66.cn/api/photo/react` | `POST`，body `id=<id>&action=like|dislike|none` |
| 时间/公网 IP | `http://tool.he4966.cn/api/tool/get_my_ip` | 仅 C3 启动时用一次 |

- **token 只放在 `esp32c3_wifi_bridge/main/secrets.h`（已 git-ignore）**，只作为 `X-API-Key` 请求头；
  不进 URL、不进日志、**绝不提交仓库**。新环境先 `cp secrets.h.example secrets.h`。
- 服务端**永远返回 1024×600**（`w/width/height/size/thumb/quality/resize` 全部被忽略），
  所以整屏解码的内存需求是固定的，见 6.2。
- `next_after_id` 是下一页游标；**翻过头会返回 0 条且 `next_after_id` 等于请求的 `after_id`**，
  客户端要靠「游标没动」判断到尾部。索引是**按 id 从大到小**（新的在前），所以新照片在游标**上面**，
  要定期把游标归零重扫才能收新照片。

### 3.2 Air8607 ↔ ESP32-C3（UART2，115200 8N1，逐行文本）

Air → C3：

```text
LIST <seq> <after_id> <limit> <filter>
PHOTO <seq> <id>
PHOTO CANCEL
REACT <seq> <id> <like|dislike|none>
HELLO
STATUS
```

C3 → Air（一行 JSON）：

```json
{"type":"hello","fw":"1.2.1","proto":3}
{"type":"list","ok":true,"total":229,"has_more":true,"next_after_id":29845}
{"type":"item","seq":3,"id":29845,"key":"<content_hash>","lk":1,"t":"2025-06-01 08:12:33"}
{"type":"list_end","seq":3,"count":25}
{"type":"photo","ok":true,"seq":4,"id":29845,"len":74163,"w":1024,"h":600}
{"type":"photo","ok":false,"seq":4,"err":"cancelled"}
{"type":"react","ok":true,"seq":5,"id":29845,"state":1}
{"type":"status","wifi":true,"mode":"sta","local_ip":"172.22.22.199","fetch_ok":true, ...}
```

- 照片回包是**一行 JSON 紧跟定长二进制**（恰好 `len` 字节），只有收满才算下载完成。
- **同一时刻只有一个请求在飞**（`pending` 单槽）：新的 `LIST`/`PHOTO` 会先取消旧的
  （`preempt()` → 被取消的 LIST 回调收到失败）。所以 `LIST` 和 `PHOTO` 不能并发，
  代码里「下载队列」和「索引请求」必须串行（见 `pump_download()` / `ensure_flow()`）。
- 超时（Air 侧）：单张 90 s、索引页 60 s、标记 120 s；断流后按 4 s → 8 s → 15 s 退避重发；
  35 s 没有任何回包就重发一次请求。保活每 10 s 一次 `STATUS`。
- C3 侧 HTTP 超时都是 30 s（照片和索引），超时/取消后双方要重新对齐：
  C3 用一行 `{"type":"photo","ok":false,"err":"cancelled"}` 结束半截数据流，
  Air 侧先「静默排空」再回行模式。

---

## 4. 现在的接线

### 4.1 信号线（3 根，必须共地）

| Air8607 J110（1×8 2.54 mm） | 方向 | ESP32-C3 SuperMini |
| --- | --- | --- |
| pin 5 `RX2` | ← | `GPIO4`（UART1 TX） |
| pin 6 `TX2` | → | `GPIO5`（UART1 RX） |
| pin 3 或 pin 7 `GND` | ↔ | `GND` |

J110 全部针脚：`1 RX1`、`2 TX1`、`3 GND`、`4 VBAT`、`5 RX2`、`6 TX2`、`7 GND`、`8 VDD_EXT`。

- **TX/RX 必须交叉**；两边都是 3.3 V 逻辑，**不要接 5 V，也不要加电平转换**。
- **不要用 USB 口旁边的 TX/RX**，那是 UART0 调试口，固件日志用它。
- 找针脚以丝印为准（`RX2`/`TX2`/`GND`），从另一端数 RX2/TX2 是第 5/6 个。
- 接线图：`docs/wiring/air8607-c3-wiring.png`（矢量 `.svg` 同目录）。

### 4.2 供电（当前是两路）

- **Air8607 开发板插自己的 USB-C**（Type-C）：屏、背光（PWM3）、TF 卡都要电。
- **ESP32-C3 SuperMini 插自己的 USB-C**：原生 USB（`USB JTAG/serial`，VID 0x303A），
  板上稳压出 3.3 V；WiFi 发射峰值 300–400 mA，要一路干净的 5 V。
- 只有一根 Type-C 时用**双口充电头或 Y 型分线**（两个 USB 分别接两块板）。
- **不要**从 J110 `pin8 VDD_EXT`（3.3 V 辅助电源，带不动 WiFi）给 C3 供电，
  **不要**用 `pin4 VBAT`（3.3–4.35 V 电池输入）给 C3 供电，
  **不要**把 5 V 灌进 SuperMini 的 `3V3` 排针（那是稳压器输出）。
- C3 不上电时，相册退化成纯本地播放（屏和卡正常，只是不能联网补新照片）。

---

## 5. C3 固件版本逻辑

- 固件版本 `FW_VERSION "1.2.1"`，协议版本 `proto 3`（`esp32c3_wifi_bridge/main/main.c`）。
- C3 上电发 `{"type":"hello","fw":"1.2.1","proto":3}`；Air 侧据此判断**是否支持分页**：
  `fw` 主版本 >1，或主版本 ==1 且次版本 ≥2 → `list_supported = true`。
  **1.1.x 只有旧的 `PHOTO LIKED/RANDOM`，不支持分页** → Air 停止重试并提示
  「C3 固件 x 不支持分页，请升级到 1.2 以上」；C3 升级后重新上报 `hello`，Air 自动恢复。
- Air 侧的版本判断在 `photo_client.lua` 的 `handle_line()`（`hello` 分支），
  提示文案在 `ui_album.lua` 的 `on_event`（`hello`/`unsupported` 分支）。
- C3 的其它能力：配网热点 `Air8607-C3` / `air8607wifi`（http://192.168.4.1/）、
  SNTP 对时（`ntp.aliyun.com` 等，超时退回编译时间）、`STATUS`/`HELLO` 保活。
- **C3 固件必须 ≥1.2**，否则相册只能本地播放。

---

## 6. 不能踩的坑（实机实测结论，改代码前务必读完）

### 6.1 AirUI 的图片缓存按「路径」记，Lua 侧作废不了

- 缓存里存的是**解码后的像素**，键是图片的 `src` 路径。
- **试过并且都无效**：改文件内容、改文件修改时间、改文件大小、`airui.full_refresh()`、
  挪动控件位置（`set_pos`）、隐藏再显示（`set_hidden`）——解码器都**不会**重新读文件。
- 后果：
  - **固定用一个显示路径 → 屏幕永远停在那一张照片**（用户报「上一张/下一张都是同一张」就是这个）。
  - 每张照片一个路径 → 缓存越攒越多 → 见 6.2。
- **唯一有效的办法：用会变的路径。** 现在用两条显示路径轮换：
  `/sd/album/view_a.jpg`、`/sd/album/view_b.jpg`，照片从库里**就地覆盖**上去。
  - 必须**就地写**（`io.open(path,"wb")`）：先写临时文件再 `os.rename` 的话，
    目标文件的修改时间不会更新，缓存认不出来。
- 缓存**确实**会因为文件内容变化重新读（把文件改成同样大小的垃圾会报 `open fail: jd_prepare`），
  但那是「新建 image 对象 + 内容变了」的组合；同一路径的对象复用时缓存照样命中。

### 6.2 整屏解码要 1.8 MB 连续 PSRAM，固件不回收

- 1024×600 不是 16 的倍数 → 固件打印 `skip HW, risky jpeg … not 16-aligned` → 走**软件解码**，
  解码缓冲约 1.8 MB（3 字节/像素）。
- AirUI 的图池装不下太多份解码结果：实测
  - 同一时刻留**两张**解码结果 → 第 4–5 次换图就开始 `decode fail: hzjpeg alloc fail … 连续内存不足`
    （8 次换图失败 7 次）
  - 只留**一张** → 失败率降到约 1/8
  - 所以**换图时必须先 `destroy_image(旧图)` 再建新图**（现在就是这么做的）。
- PSRAM 空闲总量全程稳定在 5.47 MB（`rtos.meminfo("psram")`）——**不是泄漏，是连续块不够**，
  而且固件**不回收**这块内存，解码几次之后整个会话就分不出来了。
- 因此现在的兜底是：**每显示 3 张自动重启一次设备**（`rtos.reboot()` 实测可用），
  默认间隔改成 5 分钟 → 约 15 分钟重启一次。重启后照片库和游标都在卡上，直接接着播。
  想调就把 `ui_album.lua` 里的 `REBOOT_AFTER`（当前 3）和 `INTERVAL_DEFAULT`（当前 300）改掉。

### 6.2a 根因在固件源码里（AirUI 是开源的）

`https://gitee.com/openLuat/LuatOS` 主仓库里 **`components/airui/` 就是 AirUI 的全部源码**
（自带 LVGL9 内核、hzjpeg 解码器、图片缓存），另有 `components/lvgl`、`components/hzfont`。
按源码可以把两个现象解释到函数级别：

- **缓存按路径，不看文件内容**：`components/airui/lvgl9/src/misc/cache/instance/lv_image_cache.c`
  里 `image_cache_common_compare()` 对 `LV_IMAGE_SRC_FILE` 只做 `lv_strcmp(路径)`。
  → 同一路径改了内容缓存照样命中 → 屏幕停在那一张（6.1）。
  LVGL 本来就有 `lv_image_cache_drop(src)` / `lv_image_cache_resize(size, evict_now)`，
  但 **AirUI 没暴露给 Lua**（`binding/luat_lib_airui.c` 里只有字体的 `cache_size`）。
- **解码缓冲和缓存抢同一个池子**：`components/airui/lvgl9/src/libs/hzjpeg/lv_hzjpeg.c`
  用 `lv_draw_buf_create_ex(image_cache_draw_buf_handlers, w, h, LV_COLOR_FORMAT_RGB888, ...)`
  分配 **w*h*3** 的中间缓冲（1024×600 = 1.84 MB），解完再存一份 RGB565（1.2 MB）进缓存
  → 每张照片约 3 MB；缓存池上限 `LV_CACHE_DEF_SIZE`（`components/airui/inc/luat_airui_conf.h`）
  默认 4 MB，可用 `LUAT_USE_AIRUI_IMAGE_CACHE_SIZE` 覆盖 → 缓存里有 2 张时就分不出 1.84 MB
  → `decode fail` → 黑屏（6.2）。
  注意：主仓库是新版，板子上跑的 V1028 `.soc` 未必一致，具体数值以手上的 `.soc` 为准。

**如果有人要重编固件**，最小改动是给 AirUI 加两个 Lua 绑定（暴露已有的
`lv_image_cache_drop(src)` / `lv_image_cache_resize(n)`），换图前把旧路径的缓存条目删掉，
池里就永远只有一张 → 每张都解得出来 → 不黑屏也不用重启整机；
或者把 `LUAT_USE_AIRUI_IMAGE_CACHE_SIZE` 调大 / 让解码直接出 RGB565。
但注意：主仓库只有 `bsp/air1601` 和 `bsp/pc`，**没有 Air1603/Air8607 的 BSP**，
重编还需要厂商的 Air1603 SDK（BSP + 打包工具链 + 芯片专有库）。

### 6.2b 试过并且走不通的路：重置 AirUI 引擎

想用 `airui.deinit()` + `airui.init()` 把固件不回收的解码内存就地还回去（比重启整机轻得多），
2026-11-01 实测**有两个硬伤，不要再走这条**：

1. **GT911 不允许二次初始化**：重置后再调 `tp_gt911.init()` 会报
   `E/tp tp has been initialized!!! / 初始化失败` → **第一次重置后触摸就废了**。
2. **固件自己会崩**：连续重置 5 次后 assert 死机
   （`heap is already free can not free again / assert!!! / 断言死机`）→ AirUI 的
   deinit/init 有重复释放的 bug。

结论：能清内存的只有**整机重启**（`rtos.reboot()`），所以现在是每 3 张照片重启一次。

### 6.3 FAT 的修改时间只有 2 秒精度

- FAT 的秒字段存的是 `>>1`，所以同一路径的两次写入如果落在同一个 2 秒桶里，
  缓存认不出文件变了 → 照片不换。
- 现在 `stage_delay(path)` 会等到下一个桶再写（最多等 2 s），所以**连着按上一张/下一张时
  最多等 2 秒**才换图。这是故意的，不要为了「快」去掉。

### 6.4 其它实测坑

- **`io.fsstat` 不可信**：报 `total=15254528`、`free=4294959168`，但卡上实际存了 17.9 MB 还在写。
  **不要用它判断容量**，用真实写入失败（`open_failed`）判定卡满。
- **TF 卡只有约 14.5 MB 可用**，约能存 110 张 130 KB 的照片。
  挂载参数：`fatfs.mount(fatfs.SPI, "/sd/", 1, 8, 20000000)`，
  SPI1、CS=GPIO8、SD_EN=GPIO74（先 `gpio.setup(74,1)` 再延时）。
  **卡不自动删照片**（用户口径）：满了就停下并提示。
- **`mcu.ticks()` 在 Air1603 上约 20 ms/tick**，计时必须按 `mcu.hz()` 折算
  （`photo_client.lua` 里的 `now_ms()` 已经处理，照它写）。
- **半透明控件会放大黑屏**：顶栏/底栏必须 `color_opacity = 255`；
  文字同值不要再 `set_text`（会触发整屏重绘 → 整屏 JPEG 重解）。
- **`airui.image` 没有 `is_destroyed()`**（文档里写了但固件没有这方法），
  删对象一律 `pcall(obj.destroy, obj)`。
- **下载和索引请求不能并发**（UART 单槽）：`done` 事件里先 `pump_download()` 再切画面，
  反过来会把正在跑的索引请求顶掉。
- **C3 重启后 DNS 可能短时间解析不了**（`getaddrinfo() returns 202`），Air 侧 15 s 退避重试即可恢复。
- **C3 在传大图时可能触发 task_wdt**（`IDLE` 没跑到），实测不影响功能，会自己恢复。
- **pyserial 打开 C3 的串口会把芯片复位**（USB-UART-JTAG 等价于 `USB_UART_CHIP_RESET`），
  看 C3 日志前先把 DTR/RTS 置 False（monkey-patch `serial.serialposix.Serial.open`）。
- **C3 换了板或清过 NVS 就没有 WiFi 凭据**：状态变成 `ap wifi=0 wifi_config_required`，
  Air 侧会一直报「索引失败 wifi_not_ready」（本地播放不受影响）。
  重新配网：手机连 `Air8607-C3` / `air8607wifi`，开 http://192.168.4.1/ 填 2.4 GHz WiFi。
- **Air 的二进制日志是攒够才刷的**：设备安静 ≠ 卡死；判断是否在跑看 C3 侧有没有每 10 秒一次的
  `STATUS`，或在 `tick` 里临时加心跳日志。

---

## 7. 开发、烧录、看日志

```bash
# 语法检查
~/.local/bin/luatos-cli build luac --src examples/air8607_photo_album --output /tmp/luac_check

# 烧 Air8607 脚本区（.soc 放在 firmware/ 下，仓库里不存）
cd examples/air8607_photo_album
SOC=../../firmware/LuatOS-SoC_V1028_Air1603_102.soc ./flash.sh /dev/cu.usbmodemXXXX
# 首次要连内核一起：./flash.sh /dev/cu.usbmodemXXXX full

# 看 Air 日志（注意：打开串口会复位板子）
~/.local/bin/luatos-cli log view-binary --port /dev/cu.usbmodemXXXX --baud 6000000 --probe --rts-reset --format jsonl

# 编译/烧 C3（ESP-IDF 5.4.4，SuperMini 原生 USB，idf.py flash 直接可用）
cd esp32c3_wifi_bridge
source ~/esp/v5.4/esp-idf/export.sh
IDF_SKIP_CHECK_SUBMODULES=1 idf.py build
IDF_SKIP_CHECK_SUBMODULES=1 idf.py flash
```

- 串口名会随插拔变，用 `ls /dev/cu.usbmodem*` 确认；Air 的那颗是 `/dev/cu.usbmodem5C490252851`。
- C3 换过板 → NVS 是空的，**要重新配网**（连 `Air8607-C3` / `air8607wifi`）。
- C3 只支持 2.4 GHz WiFi。

---

## 8. 给接手者的任务

**目标：本地相册能连续自动播放，且任何情况下都不黑屏。**

现状基线（已实机验证，2026-11-01）：

- 开机 1.5 秒左右就播 TF 卡上的本地照片，不需要网络；
- 切换正常，照片会换（验证时用 60 秒/张跑的，正式默认是 5 分钟一张）；
- 连续 7 次换图只有 1 次 `decode fail`（约 1/8），照片区域在解码失败时会黑到下一张；
- 每 3 张自动重启一次设备，重启后接着播。

可以继续优化的方向（按性价比排序）：

1. **把偶发的黑屏彻底消掉**。当前黑屏只发生在「解码拿不到 1.8 MB 连续内存」时。
   6.2 说明固件不回收这块内存；现在的解法是重启。可以试：
   - 让自动重启更早触发（例如每 2 张）；
   - 或者换图失败时**立刻触发一次重启**（而不是等 3 张）——需要能识别解码失败，
     目前 Lua 侧拿不到解码失败的回调（`airui` 没有暴露），所以要另想办法
     （例如定时轮询、或者用 `airui.debug()` 的内存占用变化来间接判断）；
   - 或者干脆把显示区域改小（但解码尺寸由源图 1024×600 决定，缩放不省内存，见 6.1 末尾）。
2. **别破坏 6.1/6.2/6.3 这三条**：显示路径必须轮换、同一时刻只留一张解码结果、
   同路径写入间隔 ≥2 秒。这三条是「照片会换且不黑」的前提。
3. **减少不必要的解码**：目前每次换图都必然重新解码整屏（缓存按路径记，路径一变就重解）。
   如果想更流畅，方向是让相邻两张共用一条路径——但那样内容一变缓存就命中、会显示旧照片，
   与 6.1 冲突，需要先确认固件的缓存判定规则。
4. **别动 token 的存放方式**：只能放在 git-ignore 的 `esp32c3_wifi_bridge/main/secrets.h`。
5. 保持「卡满就停、不自动删」「断网照常播」「上一张/下一张只读本地」这三条用户口径。

改完请在实机上验证：连续 10 分钟以上、覆盖 ≥15 次换图，记录 `decode fail` 次数，
并确认换图后屏幕内容确实变了（日志里的 `显示照片` id 变了不等于屏幕变了，
6.1 说缓存可能让屏幕停在旧照片）。
