# 给 AirUI 固件打的补丁（Air8607 / Air1603）

## 结论先说

整屏照片黑屏有两层原因：

1. **3 MB 的图片缓存上限比 LVGL 的堆还大**：每张 1024×600 的照片解码成 RGB565 要 1.17 MB
   常驻缓存，解码瞬间还要一块 ~1.84 MB 的连续内存，两块都从同一个池子里出 → 攒到第 3、4 张
   就分不出来 → 日志 `decode fail: hzjpeg alloc fail … 连续内存不足` → 照片区域黑到下次换图。
2. **缓存上限同时是「单图上限」**：jpg 解码器的 `decoder_open` 里有
   `w*h*3 > 图片缓存上限` 就直接拒绝的校验，日志是
   `open fail: 图片 1024x600 过大，解码需 w*h*3=1843200 字节，超过单图上限 … 无法显示`。
   所以把上限改成 1 MB 会让**每张** 1024×600 都显示不出来（2026-11-05 实机复现）。

**修法：把图片缓存上限调到 2 MB**（`patches/patch_soc.py`）。2 MB 装得下 1.84 MB 的解码缓冲，
又只能驻留 1 张 1.17 MB 的解码结果，不会像 3 MB 那样攒两张把连续内存挤爆。
2026-11-05 实机：1 MB 时每张都 `open fail`；2 MB 后日志无 `open fail`、无 `decode fail`。

## 用法

```bash
pip install py7zr
python3 patches/patch_soc.py firmware/LuatOS-SoC_V1028_Air1603_102.soc \
    -o firmware/LuatOS-SoC_V1028_Air1603_102_cache2m.soc
luatos-cli flash run --soc firmware/LuatOS-SoC_V1028_Air1603_102_cache2m.soc \
    --port <串口> --script examples/air8607_photo_album
```

脚本会打印改前/改后的反汇编：

```text
已改 1 个字节：luatos.bin 偏移 0x126952（vaddr 0x14126952）
  图片缓存上限 2097152 字节（2.0 MB）
  改前:  0x14126952  4ff44010  mov.w  r0, #0x300000      ; 3 MB
  改后:  0x14126952  4ff40010  mov.w  r0, #0x200000      ; 2 MB
```

只改应用区（`.soc` 里 `luatos.bin`，刷在 0x14000000）的 1 个字节，bootloader、NVM、文件系统都没动；
出问题把原始 `.soc` 再刷回去即可。

可用的缓存上限：1 MB / 1.5 MB / 2 MB / 2.5 MB / 3 MB（`--cache-size` 指定，3 MB 是原值）。
**1 MB / 1.5 MB 小于 1024×600 需要的 1.84 MB，会被单图校验拒掉，不要用。**

## 原理（源码位置）

`.soc` 是个 7-zip 包，解开后有 `luatos.bin`（可烧镜像）、`luatos.elf`（**带符号**）和
`luatos.map`（链接映射），所以不用厂商 SDK 也能精确定位并改二进制。

- `components/airui/lvgl9/src/draw/lv_image_decoder.c` → `lv_image_cache_init(image_cache_size)`
- 这个 size 来自 `lv_init()`（`components/airui/lvgl9/src/core/lv_init.c`），
  在固件里就是 `lv_init` 里那条 `mov.w r0, #0x300000`（`lvgl9/src/misc/cache/instance/lv_image_cache.c`
  里 `lv_cache_create` 的 max_size）
- 缓存里存的是**解码后的像素**，键是图片的 `src` 路径（`lv_image_cache.c` 的
  `image_cache_common_compare()` 对 `LV_IMAGE_SRC_FILE` 只做 `lv_strcmp(路径)`）
  → 同一路径换了内容缓存照样命中，屏幕会停在那一张照片上；这也是为什么显示源要用
  每张不同的路径（`p_<id>.jpg`）
- 解码缓冲：`components/airui/lvgl9/src/libs/hzjpeg/lv_hzjpeg.c` 里
  `lv_draw_buf_create_ex(image_cache_draw_buf_handlers, w, h, LV_COLOR_FORMAT_RGB888, ...)`
  要 **w*h*3 = 1.84 MB 连续内存**，而且是从图片缓存的池子里出的

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
把上面的结论告诉厂商，他们改一行 `LV_CACHE_DEF_SIZE` 就能根治。
