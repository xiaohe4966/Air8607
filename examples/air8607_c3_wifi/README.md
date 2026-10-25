# air8607_c3_wifi

Air8607 + ESP32-C3 的 WiFi 网卡示例。Air8607 通过 UART2 向 ESP32-C3 请求网络信息，
ESP32-C3 连接 WiFi 并访问一次：

```text
https://tool.he4966.cn/api/tool/get_my_ip
```

然后把公网 IP 和服务器时间显示在控制台页的「设备信息」卡片中。

- 屏幕：10 英寸 RGB 1024×600
- 触摸：GT911（I2C1，RST=GPIO14，INT=GPIO51）
- 显示：LCD_RST=GPIO15，背光 PWM3（GPIO13），LCD 供电 GPIO17
- UI：LuatOS AirUI，多页面（2 页）
- 网络：ESP32-C3 UART1 ↔ Air8607 UART2（J110 RX2/TX2），115200 8N1

## 接线

![Air8607 与 ESP32-C3 接线图](../../docs/wiring/air8607-c3-wiring.png)

Air8607 的 J110 排针（`1 RX1`、`2 TX1`、`3 GND`、`4 VBAT`、`5 RX2`、`6 TX2`、`7 GND`、`8 VDD_EXT`）：

| Air8607 J110 | 方向 | ESP32-C3 |
| --- | --- | --- |
| pin 5 `RX2` | ← | GPIO4 `UART1_TX` |
| pin 6 `TX2` | → | GPIO5 `UART1_RX` |
| pin 3 或 7 `GND` | ↔ | GND |

注意事项：

- 两边都是 3.3 V 逻辑，不需要电平转换。
- **不要接 C3 板上 USB 口旁边的 `TX`/`RX`**，那是 UART0 调试口，必须用 **GPIO4/GPIO5**。
- 调试阶段 ESP32-C3 用 USB 供电；不要用 Air1603 的 `VDD_EXT` 给 ESP32-C3 供电，
  该引脚只适合接口上拉，带不动 WiFi 峰值电流。
- 必须共地。TX/RX 交叉连接。
- ESP32-C3 只支持 2.4 GHz WiFi，配网请选 2.4 GHz 的 SSID。

## 文件

| 文件 | 说明 |
| --- | --- |
| `main.lua` | 入口：显示、触摸、背光、AirUI 初始化、启动网络客户端 |
| `ui_page.lua` | 多页面 UI；新增 `infoTime` 标签和 `M.set_network_info`（收到时间后每秒本地递增） |
| `net_bridge.lua` | UART2 行协议客户端，轮询 ESP32-C3 并更新 UI |
| `exd_air8607_rgb.lua` | Air8607 RGB 屏初始化扩展库 |
| `flash.sh` | Mac/Linux 烧录脚本 |
| `design.json` | 设计稿，可重新导入 UI Studio 修改 |

ESP32-C3 固件在仓库的 `esp32c3_wifi_bridge/` 目录。

## 烧录 Air8607

需要先安装合宙 `luatos-cli`，并准备 `LuatOS-SoC_V1028_Air1603_102.soc`。
把 `.soc` 放到本目录，或者用 `SOC=/path/to/LuatOS-SoC_V1028_Air1603_102.soc` 指定。

```bash
chmod +x flash.sh

# 首次：全量刷内核 + 本项目
./flash.sh /dev/cu.usbmodemXXXX full

# 以后只改脚本：只刷脚本区
./flash.sh /dev/cu.usbmodemXXXX script
```

也可以使用仓库根目录的 `flash_project.sh`。

## 配网

ESP32-C3 第一次启动、或者保存的 WiFi 连接失败时，会进入配网模式：

- 热点：`Air8607-C3`
- 密码：`air8607wifi`
- 配置页：`http://192.168.4.1/`

用手机连接热点，填写 WiFi 名称和密码，保存后 ESP32-C3 自动重启并连接。
连接成功后，Air8607 会在几秒内显示：

```text
IP 180.113.152.47
时间 2026-10-24 11:26:02
```

如果 ESP32-C3 没有接好，界面会显示 `IP 等待网卡...` 或 `IP 获取中...`。

## 串口协议

Air8607 → ESP32-C3（按行发送 ASCII 命令）：

| 命令 | 作用 |
| --- | --- |
| `HELLO` | 查询固件版本 |
| `STATUS` | 查询 WiFi / 请求状态 |
| `FETCH` | 获取开机时缓存的网络信息 |
| `PING` | 心跳 |
| `REBOOT` | 重启 ESP32-C3 |

ESP32-C3 → Air8607（每行一个 JSON）：

```json
{"type":"netinfo","ok":true,"code":1,"msg":"ok","ip":"180.113.152.47","date":"2026-10-24 11:26:02","time":1792812362,"local_ip":"192.168.1.23"}
```

请求只在 ESP32-C3 启动连接 WiFi 后执行一次，后续 `FETCH` 返回缓存结果。
需要重新请求时，重启 ESP32-C3 即可。

Air8607 收到 `date` 后只在本地用 `mcu.ticks()` 每秒递增显示，不会每秒重新走串口或 HTTPS。
因此如果只重启 Air8607、C3 一直运行，时间会从 C3 最近一次同步的结果开始走；
两边一起断电重启时，时间与服务器同步。

实机日志（Air8607，2026-10-25）：

```text
I/user.net_bridge UART2 已启动，等待 ESP32-C3 网络信息
I/user.net_bridge 公网 IP: 112.21.22.155  时间: 2026-10-25 09:12:10  local: 172.22.22.119
I/user.net_bridge 已取得网络结果，停止轮询
```

## 注意

- 生成的控件坐标基于 1024×600 画布。
- `design.json` 已加入 `infoTime` 控件，重新导入 UI Studio 后仍保留。
- 如果重新用 UI Studio 导出，记得把 `net_bridge.lua`、`main.lua` 中的网络启动代码
  和 `ui_page.lua` 的 `M.set_network_info` 合并回新工程。
