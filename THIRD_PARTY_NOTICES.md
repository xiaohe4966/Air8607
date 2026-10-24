# 第三方组件与许可

本项目包含或改编了合宙 openLuat 生态的开源内容。原始项目均使用 **MIT License**。

## LuatOS / openLuat

- 项目：LuatOS
- 地址：<https://github.com/openLuat/LuatOS>
- 许可：MIT License
- 版权：Copyright (c) 2019-2026 openLuat & AirM2M
- 本项目中的使用位置：
  - `factory/lib/` 下的标准 LuatOS 扩展库
  - `airui_showcase/code/exd_air8607_rgb.lua`、`agri_greenhouse/code/exd_air8607_rgb.lua` 显示初始化扩展
  - `factory/`、`airui_showcase/`、`agri_greenhouse/` 中来自官方示例的代码结构

## Air8607 官方 factory 工程

- 地址：<https://gitee.com/openLuat/luatos-soc-air1603> / 合宙 Air8607 资料
- 许可：MIT License
- 本项目 `factory/` 以官方 `module/Air8607/project/factory` 为基础，增加了 9 英寸配置和 Mac 烧录脚本。

## AirUI 示例与农业大棚示例

- `airui_showcase/`、`agri_greenhouse/` 来自合宙 Air8607 示例工程，MIT License。

## ESP32-C3 WiFi 网卡固件

- ESP-IDF（Apache License 2.0）：<https://github.com/espressif/esp-idf>
- cJSON（MIT License）：<https://github.com/DaveGamble/cJSON>
- 使用位置：`esp32c3_wifi_bridge/`。该目录下的 `main.c`、`CMakeLists.txt`、`partitions.csv`、
  `sdkconfig.defaults` 为本项目新增代码；ESP-IDF 和 cJSON 由构建系统按各自许可引入，
  不随本仓库提交二进制或源码副本。

## 固件与媒体资源

`firmware/*.soc` 为合宙官方发布的 Air1603 固件，未提交到 Git 仓库，而是放在 GitHub Releases 中，方便直接下载。固件版权归合宙 openLuat 所有。

`factory/res/` 中的图片、视频、字体等媒体资源来自合宙官方 factory 工程，仅用于功能演示。若要用于商业产品，请替换为自己的资源，并自行确认原始素材的授权。

## MIT License 全文

上述第三方组件的 MIT 许可全文与本仓库根目录 `LICENSE` 中的条款一致：

```text
MIT License

Copyright (c) 2019-2026 openLuat & AirM2M

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
