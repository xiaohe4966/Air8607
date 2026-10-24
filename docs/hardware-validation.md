# 实机验证记录

## 设备

- 开发板：Air8607（主控 `Air1603_A10`）
- 屏幕：1024×600 RGB，当前设备为 10 英寸
- 触摸：GT911，I2C1
- 串口：CH343（`1a86:55d3`），macOS 设备名 `/dev/cu.usbmodem5C490252851`
- 设备原有固件：LuatOS `V1027`，`Engine_Air8607_10inch_1024x600_000_V000 001.999.006`
- 当前验证固件：仓库内 LuatOS `V1028` 内核（`firmware/LuatOS-SoC_V1028_Air1603_102.soc`）

## 1. V1028 内核全量烧录与恢复

先尝试用仓库内核做一次全量烧录。第一次在写入内核约 50.3% 时失败：

```text
SOC send code data failed after 10 retries: Broken pipe
```

失败后设备停留在 bootloader/重启循环。随后做了两个排查：

1. 把 `.soc` 元数据里的 `download.force_br` 改成 `1000000` 后重新打包，SOC 阶段握手可以完成，但读取块大小失败：
   ```text
   Error: Failed to get download block size from device
   ```
   说明该 SOC 协议在 1 Mbps 下不可用，不能靠降低 `force_br` 解决。
2. CH343 串口随后从 macOS 完全消失，重新插拔 USB 数据线后恢复。

**最终恢复方式**：重新插拔 USB 后，使用原始 6 Mbps `.soc` 再次全量烧录，成功完成 bootloader、内核和脚本区写入：

```bash
luatos-cli flash run \
  --soc firmware/LuatOS-SoC_V1028_Air1603_102.soc \
  --port /dev/cu.usbmodem5C490252851 \
  --script /tmp/air8607_touch_nav_project
```

关键日志：

```text
ISP handshake OK: "CC Bootloader Version 1.0:2024-09-26"
Connecting SOC protocol at 6000000
Download block size: 262144 (0x40000)
Bootloader [bootloader] — Downloading bootloader
Core [core] — Downloading core firmware
Script [script] — Downloading script
Done — Flash completed successfully
CCM4211 flash completed successfully.
```

结论：这次失败更可能是 USB 链路/接口瞬时不稳，而不是固件或 6 Mbps 参数本身。遇到 `Broken pipe` 时，优先换稳定的 USB 数据口/线，并重新插拔后再试；不建议把 `force_br` 改成 1 Mbps。

## 2. 启动日志与多页面构建

烧录 10 英寸多页面示例 `air8607_touch_nav_test10` 后，通过：

```bash
luatos-cli log view-binary \
  --port /dev/cu.usbmodem5C490252851 \
  --baud 6000000 --probe
```

读取到：

```text
[0.393] I/user.exd_air8607_rgb 显示初始化完成 backend=display 1024x600
[0.397] I/user.main display ready display 1024 600
[0.400] D/airui airui_init success: 1024x600, color_format=18
[1.186] I/user.ui_page page built: page_1 控制台
[1.186] I/user.ui_page page: page_1 控制台
[1.244] I/gt9xx TP detect read product id:0x00000911
[1.269] I/user.main GT911 touch ready
[1.269] I/user.main backlight on
[1.269] I/user.main AirUI page ready: air8607_touch_nav_test10
```

说明：

- 显示、AirUI、GT911、背光全部初始化成功。
- 启动时只构建启动页 `page_1`；第二页是按需构建的，没有在开机时创建。
- 生成工程使用 10 英寸预设，`main.lua` 中 `SCREEN_SIZE = 10`。

## 3. 多页面路由验证

### 3.1 程序化路由冒烟测试

在临时测试工程里给 `main.lua` 增加两个定时器，开机后自动执行 `ui.go("page_2")` 和 `ui.back()`，不依赖触摸：

```text
[3.687] I/user.router_test go page_2
[4.154] I/user.ui_page page built: page_2 设置
[4.154] I/user.ui_page page: page_2 设置
[6.188] I/user.router_test back to page_1
[6.188] I/user.ui_page page: page_1 控制台
```

结果：

- `M.go("page_2")` 首次调用时才构建第二页，构建后切换到第二页。
- `M.back()` 返回启动页。
- 页面切换使用隐藏/显示已有页面根容器，没有销毁后重建。
- 往返切换后程序继续运行，没有崩溃或重启。

### 3.2 真实触摸导航

最终版本（`air8607_dashboard_10inch`，10 英寸预设）烧录后，人工在屏幕上依次点击：

1. 控制台右上角「更多设置 →」
2. 设置页右上角「← 返回控制台」

串口日志出现：

```text
[1.187] I/user.ui_page page built: page_1 控制台
[1.187] I/user.ui_page page: page_1 控制台
[185.136] I/user.ui_page page_1 click settingsBtn
[185.600] I/user.ui_page page built: page_2 设置
[185.600] I/user.ui_page page: page_2 设置
[188.361] I/user.ui_page page_2 click backBtn
[188.362] I/user.ui_page page: page_1 控制台
```

这说明完整链路已打通：

```text
GT911 触摸
  -> AirUI button on_click
  -> 生成的 M.go("page_2") / M.back()
  -> 页面容器 set_hidden
  -> 第二页按需构建并切换
  -> 返回启动页
```

## 尚未验证

- 没有对屏幕拍照做像素级视觉检查。
- 9 英寸预设没有在 9 英寸实机上测试；本次实机是 10 英寸 1024×600。
- 按钮跳转/返回已经实机点按验证；滑块、开关等控件的触摸回调没有逐项做人工验收（日志中能看到滑块值变化，但未单独作为验收项）。
- 仓库 factory 工程默认仍是 9 英寸配置；本次验证使用 UI Studio 生成的 10 英寸工程直接覆盖脚本区。

## 复现

```bash
cd Air8607
./flash_mac.sh ports

# 1. 生成 10 英寸多页面测试工程
cd ui_designer
node - <<'NODE'
const fs = require('fs');
const path = require('path');
const g = require('./js/generator.js');
const d = g.sampleProject();
d.project = 'air8607_touch_nav_test10';
d.screen.preset = '10';
const out = g.generateProject(d);
fs.rmSync('/tmp/air8607_touch_nav_project', { recursive: true, force: true });
for (const [name, file] of Object.entries(out.files)) {
  const p = path.join('/tmp/air8607_touch_nav_project', name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof file === 'string' ? file : file.text);
}
NODE

# 2. 只刷脚本区（日常开发）
cd ..
./flash_project.sh /tmp/air8607_touch_nav_project /dev/cu.usbmodemXXXX script

# 3. 查看日志
./flash_mac.sh log /dev/cu.usbmodemXXXX
```

如果需要恢复 V1028 内核：

```bash
luatos-cli flash run \
  --soc firmware/LuatOS-SoC_V1028_Air1603_102.soc \
  --port /dev/cu.usbmodemXXXX \
  --script /tmp/air8607_touch_nav_project
```

> 如果全量烧录中途出现 `Broken pipe`，先更换 USB 数据线/接口并重新插拔开发板，再重试原始 6 Mbps 固件。不要使用 1 Mbps 的 `force_br`，该速率在 SOC 协议阶段会读不到块大小。
