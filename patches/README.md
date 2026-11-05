# 给 AirUI 固件打的补丁（Air8607 / Air1603）

## 结论先说

整屏照片黑屏的根因是**图片缓存把解码缓冲留在池子里，换图时新旧两块同时存在**：

- 1024×600 的 JPEG 解码出来是一块 **RGB888 = 1.84 MB** 的缓冲
  （`lv_hzjpeg.c` 里 `lv_draw_buf_create_ex(... LV_COLOR_FORMAT_RGB888 ...)`）。
- 解出来的这块缓冲**同时被塞进 LVGL 的图片缓存**，键是文件路径，上限就是
  `lv_init` 里那条 `mov.w r0, #0x300000`（3 MB）。
- 换下一张时，旧照片的缓存条目要等新条目 `lv_cache_add` 时才会被淘汰，而新照片的
  1.84 MB 解码缓冲在**淘汰之前**就已经申请了 → 瞬时占用 **1.84 × 2 = 3.69 MB** 连续内存。
- 连点几次「下一张」（或缓存里攒了别的图），PSRAM 里凑不出这么大的连续块：
  `decode fail: hzjpeg alloc fail … 连续内存不足` → 照片区域黑到下次换图。

另外，**这个缓存上限同时还是「单图上限」**：jpg 解码器 `decoder_open` 里有
`w*h*3 > 图片缓存上限` 就直接拒绝的校验，日志是
`open fail: 图片 1024x600 过大，解码需 w*h*3=1843200 字节，超过单图上限 …`。
所以：

- **1 MB / 1.5 MB 不能用**：小于 1024×600 需要的 1.84 MB，**每张**都显示不出来（实机复现）。
- **2 MB 只是缓解**：单图校验能过、缓存只驻留 1 张，但换图瞬间仍是旧条目 + 新缓冲 =
  3.69 MB，连点「下一张」到第 3、4 张照样 `decode fail`（2026-11-05 实机复现）。
- **0 才是根治**：整个图片缓存关掉，解码缓冲由这次绘制持有、画完就释放，
  池子里任何时刻最多只有一块 1.84 MB。

**修法：把图片缓存上限改成 0**（`patches/patch_soc.py`，默认值）。只改 1 个字节。

2026-11-05 实机（打 0 补丁）：开机后连点 20 次「下一张」（1 秒一次）——
**21 次解码（开机 1 次 + 每次换图 1 次）、0 次 `decode fail`、0 次 `open fail`、
PSRAM 空闲稳定在 7.31 MB**；之后静置 30 秒没有多余的解码。

## 用法

```bash
pip install py7zr
python3 patches/patch_soc.py firmware/LuatOS-SoC_V1028_Air1603_102.soc
# 默认输出 firmware/LuatOS-SoC_V1028_Air1603_102_nocache.soc
luatos-cli flash run --soc firmware/LuatOS-SoC_V1028_Air1603_102_nocache.soc \
    --port <串口> --script examples/air8607_photo_album
```

脚本会打印改前/改后的反汇编：

```text
已改 1 个字节：luatos.bin 偏移 0x126952（vaddr 0x14126952）
  图片缓存：关闭（换图时解码缓冲画完即释放）
  改前:
    0x14126952  4ff44010     mov.w    r0, #0x300000
  改后:
    0x14126952  4ff00000     mov.w    r0, #0
```

只改应用区（`.soc` 里 `luatos.bin`，刷在 0x14000000）的 1 个字节，bootloader、NVM、文件系统都没动；
出问题把原始 `.soc` 再刷回去即可。

`--cache-size` 可选：`0`（默认，关闭缓存）/ 1 MB / 1.5 MB / 2 MB / 2.5 MB / 3 MB。
**只有 0 能扛住连点换图**；2 MB 比原来的 3 MB 好一点但连点仍会黑；1 MB / 1.5 MB 会被单图校验全拒。

## 代价：关缓存后照片每次重绘要重新解码

关掉缓存后，照片**每次重绘**都会重新解一次 JPEG。相册里的照片只在换图、
显示/隐藏控制栏、打开设置面板时重绘，实测静置时不会反复解码（顶栏/底栏是不透明的，
每秒更新进度条不会让下面的照片重画），所以可以接受。

如果是「图片频繁重绘」的场景（滚动、动画），可以改用 `--cache-size 2097152`（2 MB），
代价是连点换图仍可能失败。

## 原理（源码位置）

`.soc` 是个 7-zip 包，解开后有 `luatos.bin`（可烧镜像）、`luatos.elf`（**带符号**）和
`luatos.map`（链接映射），所以不用厂商 SDK 也能精确定位并改二进制。

- `lv_init()`（`lvgl9/src/core/lv_init.c`）里的 `lv_image_decoder_init(size, 0x40)`，
  在固件里就是 `lv_init` 末尾那条 `mov.w r0, #0x300000`（r1 = 0x40 是图片头缓存条数）
- 这个 size 一路传到 `lv_image_cache_init()` 的 `lv_cache_create(max_size)`
  （`lvgl9/src/misc/cache/instance/lv_image_cache.c`）
- 解码缓冲：`components/airui/lvgl9/src/libs/hzjpeg/lv_hzjpeg.c` 里
  `lv_draw_buf_create_ex(image_cache_draw_buf_handlers, w, h, LV_COLOR_FORMAT_RGB888, ...)`
  要 **w*h*3 = 1.84 MB 连续内存**，而且是从图片缓存的池子里出的
- 缓存条目大小 = `decoded->data_size`（1.84 MB），键是图片的 `src` 路径
  （`image_cache_common_compare()` 对 `LV_IMAGE_SRC_FILE` 只做 `lv_strcmp(路径)`）
- 缓存上限为 0 时 AirUI 有明确分支：
  - 单图校验 `cache_max > 0` 才执行 → 不拒图（`lv_hzjpeg.c`）
  - `!lv_image_cache_is_enabled()` 时解码结果不写缓存（`decoder_open` 直接返回）
  - `decoder_close` 里 `no_cache || !lv_image_cache_is_enabled()` 时 `lv_draw_buf_destroy`
    → 画完即释放

## 另一条路：硬件 JPEG 解码（**别用**）

Air1603 的芯片（Air1101）带 **JPG/PNG 硬解码**，AirUI 也接了
（`components/airui/src/platform/luatos/luat_airui_jpg_decoder_luatos.c` 里
`luat_image_probe` + `LUAT_IMG_DECODE_HW`），只是把「尺寸不是 16 的倍数」的文件判成 risky
（1024×600 的 600 不是 16 的倍数）→ 退回软件解码。
源码里有开关 `LUAT_USE_AIRUI_JPG_HW_ANY_SIZE`（`components/airui/inc/luat_airui_conf.h`），
也可以直接改二进制里那条 `beq` 分支。

**实测这条路在这块板子上不可用**：放开之后第一张照片之后整个 UI 卡住约 36 秒
（触摸轮询被拖垮），随后批量冒出幽灵点击（相册自己在刷下一张），会连成重启循环。
AirUI 那条「16 对齐」的兜底规则就是为「某些平台硬件解码器处理非 16 对齐会崩」准备的——
这条规则不要绕过，除非厂商确认 Air1101 的硬件解码器能吃 1024×600。

## 如果要正规修固件

源码在 `https://gitee.com/openLuat/LuatOS` 的 `components/airui/`（AirUI 全部源码，含 LVGL9 内核、
hzjpeg 解码器、图片缓存），但**主仓库没有 Air1603/Air8607 的 BSP**（只有 `bsp/air1601` 和 `bsp/pc`），
重编 `.soc` 还需要厂商的 Air1603 SDK（BSP + 工具链 + 芯片专有库 + `.soc` 打包）。
把上面的结论告诉厂商：最省事的改法是把 `LV_CACHE_DEF_SIZE` 设成 0（或给 jpg 解码加
`no_cache`），再干脆一点就是把整屏 JPEG 解码成 RGB565（1.23 MB）而不是 RGB888，
峰值得以下降。
