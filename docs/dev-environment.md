# 开发环境与继续开发指南

这份文档写给「换一台电脑继续做 Air8607 + ESP32-C3 WiFi 网卡」的人。
所有代码、接线图、说明都在仓库里，克隆下来按顺序走一遍即可恢复开发环境。

```bash
git clone https://github.com/xiaohe4966/Air8607.git
cd Air8607
```

## 1. 需要装的工具

| 工具 | 版本 | 用途 | 备注 |
| --- | --- | --- | --- |
| ESP-IDF | 5.4.x（验证过 5.4.3） | 编译/烧录 ESP32-C3 固件 | macOS / Linux / Windows 都有官方安装包 |
| `luatos-cli` | 任意近期版本 | 编译 Lua、烧录 Air8607 | 合宙官方工具 |
| Python 3 | ≥ 3.9 | 串口日志小脚本 | 需 `pip install pyserial` |
| 浏览器 | 任意 | 打开 UI Studio | `python3 -m http.server 8000` 后访问 `http://127.0.0.1:8000/ui_designer/` |

安装 ESP-IDF（macOS / Linux 示例）：

```bash
mkdir -p ~/esp && cd ~/esp
git clone -b v5.4 --recursive https://github.com/espressif/esp-idf.git
cd esp-idf && ./install.sh esp32c3
```

安装 `luatos-cli`：见 <https://docs.openluat.com/air1603/software/debug/>。

## 2. 仓库结构（本次新增的部分）

```text
Air8607/
├── esp32c3_wifi_bridge/         # ← ESP32-C3 网卡固件（ESP-IDF 工程）
│   ├── main/main.c              #    WiFi + 配网 HTTP + HTTPS + UART 协议
│   ├── sdkconfig.defaults       #    可复现的编译配置（sdkconfig 本身不入库）
│   ├── partitions.csv           #    4 MB Flash 分区表（NVS 24 KB + app 1.9 MB）
│   ├── flash_c3.sh              #    一键编译 + 烧录
│   └── README.md
├── examples/air8607_c3_wifi/    # ← Air8607 侧工程（AirUI + UART2 客户端）
│   ├── main.lua                 #    显示/触摸/背光 + 启动 net_bridge
│   ├── net_bridge.lua           #    UART2 行协议客户端
│   ├── ui_page.lua              #    多页面 UI + infoTime 标签
│   ├── design.json              #    设计稿，可重新导入 UI Studio
│   └── flash.sh                 #    烧录脚本
├── docs/
│   ├── air8607-c3-wifi.md       # ← 方案总文档（接线/配网/协议/排错）
│   ├── dev-environment.md       #    本文件
│   └── wiring/                  # ← 接线图（PNG + SVG 矢量原图）
│       ├── air8607-c3-wiring.png
│       └── air8607-c3-wiring.svg
└── firmware/                    # Air8607 内核 .soc（从 Releases 下载）
```

## 3. 硬件：只需要 3 根线

完整接线图：[`docs/wiring/air8607-c3-wiring.png`](./wiring/air8607-c3-wiring.png)

| Air8607 J110 | ESP32-C3 | 说明 |
| --- | --- | --- |
| pin 5 `RX2` | GPIO4（UART1_TX） | 数据进 Air8607 |
| pin 6 `TX2` | GPIO5（UART1_RX） | 数据进 C3 |
| pin 3 或 7 `GND` | GND | 必须共地 |

J110 完整针脚：`1 RX1`、`2 TX1`、`3 GND`、`4 VBAT`、`5 RX2`、`6 TX2`、`7 GND`、`8 VDD_EXT`。

要点：

- **不要接 C3 板上 USB 口旁边的 `TX`/`RX`**（那是 UART0 调试口），必须用 **GPIO4/GPIO5**。
- **不要用 `VDD_EXT`(pin 8) 或 `VBAT`(pin 4) 给 C3 供电**；C3 用 USB 或独立 3.3 V/5 V 电源。
- 两边都是 3.3 V 逻辑，不需要电平转换。
- ESP32-C3 只支持 **2.4 GHz** WiFi，配网请选 2.4 GHz 的 SSID。

## 4. 编译并烧录 ESP32-C3

```bash
cd esp32c3_wifi_bridge
source ~/esp/v5.4/esp-idf/export.sh
idf.py set-target esp32c3      # 首次
idf.py build

# 烧录（macOS）
./flash_c3.sh /dev/cu.wchusbserialXXXX
```

不想装 ESP-IDF 也可以：Release 里带了预编译固件
`esp32c3_wifi_bridge_prebuilt.zip`（bootloader + 分区表 + app），用 `esptool` 直接写：

```bash
unzip esp32c3_wifi_bridge_prebuilt.zip -d c3fw
python -m esptool --chip esp32c3 -p /dev/cu.wchusbserialXXXX \
  -b 115200 --no-stub --before default_reset --after hard_reset \
  write_flash --no-compress --flash_mode dio --flash_size 4MB --flash_freq 40m \
  0x0 c3fw/bootloader.bin 0x8000 c3fw/partition-table.bin 0x10000 c3fw/air8607_c3_wifi_bridge.bin
```

macOS 串口坑（本机实测）：

- CH343 会枚举出两个接口：`/dev/cu.usbmodemXXXX` 和 `/dev/cu.wchusbserialXXXX`。
  **本机 `usbmodem` 写入会失败**（`0107 Checksum error` / `0105 format invalid`），`wchusbserial` 正常。
- `idf.py flash` 默认会先上传 stub；stub 上传失败时用 `--no-stub` 走 ROM loader。
- 换 USB 口/线、避免无源 Hub 能恢复 `idf.py flash`。

Linux / Windows 的端口名一般是 `/dev/ttyUSB0`、`COM3` 之类，`flash_c3.sh` 传端口参数即可。

## 5. 烧录 Air8607

1. 从 [Releases](https://github.com/xiaohe4966/Air8607/releases/latest) 下载
   `LuatOS-SoC_V1028_Air1603_102.soc`，放进仓库根目录的 `firmware/`。
2. 烧录本仓库的 C3 示例工程（只刷脚本区，几秒）：

   ```bash
   ./flash_project.sh examples/air8607_c3_wifi /dev/cu.usbmodemXXXX script
   ```

   或进到示例目录用自带脚本：

   ```bash
   cd examples/air8607_c3_wifi
   SOC=../../firmware/LuatOS-SoC_V1028_Air1603_102.soc ./flash.sh /dev/cu.usbmodemXXXX script
   ```

3. 首次上板 / 换固件版本时用 `full` 模式（内核 + 工程一起刷）。
4. 看日志：

   ```bash
   ./flash_mac.sh log /dev/cu.usbmodemXXXX
   ```

   正常日志应该出现：

   ```text
   I/user.main display ready display 1024 600
   I/user.ui_page page built: page_1 控制台
   I/user.main GT911 touch ready
   I/user.net_bridge UART2 已启动，等待 ESP32-C3 网络信息
   I/user.main AirUI page ready: air8607_c3_wifi
   ```

## 6. 联调自检

```bash
# 监听 C3 串口，应该能看到 Air8607 发来的 FETCH
python3 - <<'PY'
import serial, time
s = serial.Serial('/dev/cu.wchusbserialXXXX', 115200, timeout=0.2)
end = time.time() + 8
while time.time() < end:
    d = s.read(4096)
    if d:
        print(d.decode('utf-8', 'replace'))
PY
```

期望：

```text
I (xxx) air8607-c3: UART RX[1]: FETCH
```

看到这行说明 UART 通了，接着：

1. 手机连 `Air8607-C3` / `air8607wifi`，打开 <http://192.168.4.1/> 填 2.4 GHz WiFi。
2. C3 重启 → 连 WiFi → SNTP 对时 → 请求一次 `https://tool.he4966.cn/api/tool/get_my_ip`。
3. Air8607 屏幕显示：

   ```text
   IP 180.113.152.47
   时间 2026-10-24 11:26:02
   ```

排错见 [`docs/air8607-c3-wifi.md`](./air8607-c3-wifi.md) 的「排错」一节。

## 7. 当前进度与待办

已完成：

- ESP32-C3 固件：NVS 存 WiFi、SoftAP 配网 HTTP、HTTPS 抓取、JSON 解析、开机一次取数、UART1 行协议。
- Air8607 示例：UART2 客户端 + AirUI 标签（`infoIp` / `infoTime`）+ 状态提示。
- 接线图、协议文档、排错文档、CI 校验（`ci.yml` 里会检查示例工程和 C3 固件的关键内容）。
- 已在实机验证：C3 编译/烧录/启动/配网热点、Air8607 示例编译/烧录/UART2 客户端启动。

待办（接手后按这个顺序做）：

- [ ] 接好 3 根线，跑通 `UART RX: FETCH`。
- [ ] 手机配网，验证 HTTPS 取到公网 IP 和时间，屏幕显示正确。
- [ ] 补一张屏幕实拍照片到 `docs/`。
- [ ] 生产化：改默认热点密码、配网完成后关闭 AP、断线重连后重新取数（协议里加 `FETCH FORCE`）。
- [ ] 把 C3 固件加进 CI（ESP-IDF 构建 + `esptool` 静态检查）。

## 8. 相关链接

- 仓库：<https://github.com/xiaohe4966/Air8607>
- UI Studio（在线）：<https://xiaohe4966.github.io/Air8607/>
- 方案文档：[`docs/air8607-c3-wifi.md`](./air8607-c3-wifi.md)
- Releases（含 `.soc` 与 C3 预编译固件）：<https://github.com/xiaohe4966/Air8607/releases/latest>
- 合宙 Air1603 硬件文档：<https://docs.openluat.com/air1603/luatos/hardware/>
- 合宙 LuatOS 文档：<https://wiki.luatos.com/>
