# 实机验证记录

## 设备

- 开发板：Air8607（主控 `Air1603_A10`）
- 屏幕：1024×600 RGB，当前设备启动日志报告为 10 英寸
- 触摸：GT911，I2C1
- 串口：CH343（`1a86:55d3`），macOS 设备名 `/dev/cu.usbmodem5C490252851`
- 设备原有固件：LuatOS `V1027`，`Engine_Air8607_10inch_1024x600_000_V000 001.999.006`

## 验证内容

### 1. UI Studio 生成工程的脚本区烧录

用 UI Studio 生成一个 10 英寸示例工程（`air8607_test10`），共 5 个打包文件，然后执行：

```bash
./flash_project.sh /tmp/air8607_ui10 /dev/cu.usbmodem5C490252851 script
```

结果：

```text
Operation 'script' completed successfully.
```

### 2. 启动日志

烧录后通过 `luatos-cli log view-binary --baud 6000000 --probe` 读取：

```text
[0.393] I/user.exd_air8607_rgb 显示初始化完成 backend=display 1024x600
[0.393] I/user.main display ready display 1024 600
[0.397] D/airui airui_init success: 1024x600, color_format=18
[1.250] I/gt9xx TP detect read product id:0x00000911
[1.275] I/user.main GT911 touch ready
[1.275] I/user.main backlight on
[1.275] I/user.main AirUI page ready: air8607_test10
```

说明：

- `display.init` 成功，RGB 1024×600 后端为 `display`。
- AirUI 初始化成功，字体加载成功。
- GT911 产品 ID 读取为 `911`，触摸设备绑定成功。
- 背光 PWM3 打开成功。
- 生成页面 `ui_page.lua` 构建完成。

## 尚未验证

- 没有对屏幕拍照做像素级视觉检查。
- GT911 初始化成功，但没有自动化注入触摸事件；按钮/滑块/开关的实际触摸回调还需要在屏幕上点按确认。
- 本次只烧录了脚本区，使用的是设备原有的 V1027 内核；没有用仓库内 V1028 内核做全量烧录。
- 仓库 factory 工程默认仍是 9 英寸配置；本次生成工程用的是 10 英寸预设。

## 复现

```bash
cd Air8607
./flash_mac.sh ports

# 生成 10 英寸测试工程
cd ui_designer
node - <<'NODE'
const fs = require('fs');
const g = require('./js/generator.js');
const d = g.sampleProject();
d.project = 'air8607_test10';
d.screen.preset = '10';
const out = g.generateProject(d);
fs.rmSync('/tmp/air8607_ui10', { recursive: true, force: true });
for (const [name, file] of Object.entries(out.files)) {
  const p = '/tmp/air8607_ui10/' + name;
  fs.mkdirSync(require('path').dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof file === 'string' ? file : file.text);
}
NODE

cd ..
./flash_project.sh /tmp/air8607_ui10 /dev/cu.usbmodemXXXX script
./flash_mac.sh log /dev/cu.usbmodemXXXX
```

> 如果要恢复官方 factory，可用 `./flash_mac.sh full`（需要先把 `factory/main.lua` 的 `PROJECT` 改成 10 英寸配置，或使用自己的 9 英寸工程）。
