# Air8607 UI Studio

纯静态网页版 AirUI 设计器，针对 **Air8607 + 9/10 寸 1024×600 RGB 屏 + GT911 触摸**。

## 本地运行

```bash
# 在仓库根目录
python3 -m http.server 8000
# 打开 http://127.0.0.1:8000/ui_designer/
```

也可以直接双击 `index.html`。所有依赖都在本目录，不需要 npm、构建或联网。

## 使用

1. 左侧点击组件添加；拖动移动，拖 8 个控制点缩放。
2. 右侧属性面板改文字、颜色、圆角、数值、图片。
3. 图层列表可显示/隐藏、锁定、调整层级。
4. 点击 **预览** 隐藏选择框，按钮/开关可点击测试。
5. 点击 **导出工程 ZIP**，解压后按 `README.md` / `flash.sh` 烧录。

## 生成工程结构

```text
main.lua               # 显示 + 触摸 + 背光 + AirUI 初始化
ui_page.lua            # 生成的控件树，事件在 TODO 处修改
exd_air8607_rgb.lua    # 1024x600 RGB 屏驱动
flash.sh               # 平铺文件并调用 luatos-cli
README.md
design.json            # 设计稿，可重新导入
res/                   # 上传的图片资源
```

## 设计数据

- 自动保存到浏览器 `localStorage`（键名 `air8607-ui-studio-v1`）。
- **导出 JSON** 可备份/版本管理；**导入** 可恢复。
- 设计稿里的图片以 Data URL 保存在 `assets` 中，导出时写入 `res/`。

## 已知限制

- 画布固定 1024×600；9 寸和 10 寸共用分辨率，生成代码里只有 `SCREEN_SIZE` 不同。
- 控件使用绝对坐标，容器不裁剪子控件；复杂分组建议用面板做背景。
- 二维码预览是示意图，真实二维码由设备端 AirUI 生成。
- 图片格式建议 PNG/JPG；脚本区 4096 KB，图片不要太大。
- 事件回调只生成 `log.info` 桩，业务逻辑需要在 `ui_page.lua` 里补。

## 文件

- `js/generator.js`：Lua 代码生成 + 最小 ZIP 打包（浏览器/Node 均可运行）
- `js/exd_template.js`：屏驱动模板
- `js/app-core.js`：状态、历史、画布渲染、导入导出
- `js/app-ui.js`：组件面板、属性面板、图层
- `js/app-events.js`：DOM 事件、拖拽缩放、快捷键、初始化
- `css/style.css`：界面样式
