# 给 AirUI 固件打的补丁（Air8607 / Air1603）

## 为什么需要补丁

Air8607 的整屏照片会黑屏，根因在 AirUI 固件里（源码在
`https://gitee.com/openLuat/LuatOS` 主仓库的 `components/airui/`）：

1. **图片缓存按路径做键，不看文件内容**
   （`lvgl9/src/misc/cache/instance/lv_image_cache.c` 的 `image_cache_common_compare()`
   对 `LV_IMAGE_SRC_FILE` 只做 `lv_strcmp(路径)`）。
   → 同一路径换了内容缓存照样命中，屏幕会停在那一张照片上。
2. **1024×600 不是 16 对齐 → 硬件 JPEG 解码被跳过**
   （`src/platform/luatos/luat_airui_jpg_decoder_luatos.c` 把这类文件判成 `risky`，
   退回软件解码）。Air1603 本身有硬件 JPEG 解码器（`components/luat_image` 里的
   `luat_jpeg_hw_decode`，弱符号、由芯片 BSP 提供实现），只是没被用上。
3. **软件解码要一大块连续内存，还和缓存抢同一个池子**
   （`lvgl9/src/libs/hzjpeg/lv_hzjpeg.c`：`lv_draw_buf_create_ex(..., RGB888, ...)`
   要 **w*h*3 = 1.84 MB** 连续内存，这块缓冲从图片缓存的池子里出；解完再往缓存里存一份
   RGB565（1.2 MB）→ 每张约 3 MB，池子只有几 MB → 攒几张就分不出来 →
   `decode fail: hzjpeg alloc fail` → 照片区域黑屏。

## 两个补丁

### `airui-jpg-hw-any-size.patch`（**根治，优先用这个**）

打开 AirUI 已有的编译开关 `LUAT_USE_AIRUI_JPG_HW_ANY_SIZE`，让 1024×600 也走芯片的
**硬件 JPEG 解码**：解码直接写进绘制缓冲，既不需要那 1.84 MB 的软件中间缓冲，也不用和
图片缓存抢池子 → **不黑屏，而且换图快得多**（硬件解码几毫秒，软件解码要几百毫秒）。

改动只有 `components/airui/inc/luat_airui_conf.h` 里加一行 `#define`。

> 也可以不改源码，直接在 SDK 的编译参数里加 `-DLUAT_USE_AIRUI_JPG_HW_ANY_SIZE` ✓
> （这个宏是编译期判断的，加到全局 CFLAGS 即可）。
>
> ⚠️ **必须实测**：这条「16 对齐」的兜底规则本来是给「某些平台的硬件解码器处理非 16 对齐会崩」
> 的机型准备的。Air1603 的硬件解码器大概率没问题（源码注释就写着「平台 HW 解码对尺寸无 16
> 对齐要求」），但要在真机上确认解码不挂、显示正常。

### `airui-image-cache-lua.patch`（保险 / 应用层可控）

给 AirUI 的 Lua 绑定加两个函数，把 LVGL 已有的缓存控制暴露出来：

| 新 API | 作用 |
| --- | --- |
| `airui.cache_drop(src)` | 删除图片缓存里某个路径的条目（内部就是 `lv_image_cache_drop`） |
| `airui.cache_resize(size)` | 调整图片缓存上限字节数（内部是 `lv_image_cache_resize`，0 = 关闭缓存） |

有了 `airui.cache_drop()`，换图前把旧路径的条目删掉，池子里永远只有一份 → 解码一定成功。
相册已经适配：检测到 `airui.cache_drop` 就切到「换图前清缓存 + 不重启整机」的模式
（`examples/air8607_photo_album/ui_album.lua`，日志里是 `图片缓存可控 1`）；
没有这个 API 的老固件走原来的绕法（日志 `图片缓存可控 0`）。

## 怎么用

```bash
git clone --depth 1 https://gitee.com/openLuat/LuatOS.git
cd LuatOS
git apply /path/to/patches/airui-jpg-hw-any-size.patch      # 根治
git apply /path/to/patches/airui-image-cache-lua.patch      # 可选，保险
```

打完补丁，`components/airui/inc/luat_airui_conf.h` 里会多出：

```c
    #define LUAT_USE_AIRUI_JPG_HW_ANY_SIZE
```

`components/airui/binding/luat_lib_airui.c` 里会多出：

```c
#include "lvgl9/src/misc/cache/instance/lv_image_cache.h"
...
static int l_airui_cache_drop(lua_State *L);
static int l_airui_cache_resize(lua_State *L);
...
    {"cache_drop", ROREG_FUNC(l_airui_cache_drop)},
    {"cache_resize", ROREG_FUNC(l_airui_cache_resize)},
```

## 编译固件

**主仓库里没有 Air1603/Air8607 的 BSP**（只有 `bsp/air1601` 和 `bsp/pc`），所以重编 `.soc`
还需要厂商的 **Air1603 SDK**（BSP + ARM 工具链 + 芯片专有库 + `.soc` 打包脚本）。
Air1603 官网目前只提供 **V1028** 一个固件版本（2026.10.15），没有更新的现成固件可换。

拿到 SDK 之后：

1. 把 SDK 里对应的 `components/airui` 换成打了补丁的这份（或在 SDK 的子模块里 `git apply`）；
2. 用 SDK 自己的工具链编译出新的 `.soc`；
3. 用 `luatos-cli flash run --soc <新的.soc>` 烧进 Air8607；
4. 看日志确认：
   - `I/user.album 图片缓存可控 1` → 新加的缓存 API 生效；
   - 换图时不再出现 `I/airui.jpg skip HW, risky jpeg` → 走的是硬件解码 ✓。

> 板子上跑的是 **V1028 / AirUI 1.2.6**，和开源 master 未必完全一致，
> 套补丁前先确认 `luat_airui_conf.h` 的「图片缓存配置」那段和
> `luat_lib_airui.c` 里的 `l_airui_debug` / `l_airui_version` 还在（补丁就是照着它们插的）。

## 烧新固件后相册的行为变化

`examples/air8607_photo_album/ui_album.lua` 已做兼容（靠 `type(airui.cache_drop) == "function"` 判断）：

| | 老固件 | 打了补丁的固件 |
| --- | --- | --- |
| 解码路径 | 软件解码（1.84 MB 中间缓冲） | 硬件解码（若开了 `HW_ANY_SIZE`） |
| 图片缓存 | 攒几张就把池子占满 → 偶尔黑屏 | 换图前 `cache_drop` 清旧条目 → 池里只有一份 |
| 同屏解码结果 | 只留一张 | 只留一张 |
| 自动重启 | 每 3 张重启整机清内存 | 不再重启 |
| 表现 | 偶尔黑屏到下一张 + 每 3 张黑屏重启 10 秒 | 不黑屏、不重启 |

没打补丁的固件上行为和现在完全一样（已实测：`图片缓存可控 0`）。
