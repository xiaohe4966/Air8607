# 给 AirUI 固件打的补丁

## `airui-image-cache-lua.patch`

给 AirUI 的 Lua 绑定加两个函数，把 LVGL 已有的图片缓存控制暴露出来：

| 新 API | 作用 |
| --- | --- |
| `airui.cache_drop(src)` | 删除图片缓存里某个路径的条目（内部就是 LVGL 的 `lv_image_cache_drop`） |
| `airui.cache_resize(size)` | 调整图片缓存上限字节数（内部是 `lv_image_cache_resize`，0 = 关闭缓存） |

### 为什么需要它

AirUI 的图片缓存**只按文件路径做键**（`lv_image_cache.c` 里 `image_cache_common_compare()`
对 `LV_IMAGE_SRC_FILE` 只比路径字符串，不看修改时间和大小），而且：

- 整屏 JPEG 解码的中间缓冲是 `lv_draw_buf_create_ex(..., LV_COLOR_FORMAT_RGB888, ...)`，
  要 **w*h*3 = 1.84 MB 连续内存**，这个缓冲是从**图片缓存的池子**里出的；
- 解完再往缓存里存一份 RGB565（1.2 MB）；
- 缓存池上限 `LV_CACHE_DEF_SIZE`（`components/airui/inc/luat_airui_conf.h`）默认 4 MB。

→ 缓存里有 2 张照片时，池子就分不出那 1.84 MB → `decode fail: hzjpeg alloc fail` → 照片区域黑。

有了 `airui.cache_drop()`，换图前把旧路径的条目删掉，池子里永远只有一份，整屏解码就一定
分配得到内存——**不黑屏，也不用再靠重启整机来清内存**。

### 适用哪个源码版本

`https://gitee.com/openLuat/LuatOS` 主仓库的 `components/airui/`（AirUI 全部源码，含 LVGL9
内核、hzjpeg 解码器、图片缓存）。补丁是按主仓库 master 生成的 diff。

> 板子上跑的 `.soc` 是 **V1028**，和 master 未必完全一致，套补丁前先确认
> `components/airui/binding/luat_lib_airui.c` 里 `l_airui_debug` / `l_airui_version`
> 那几段还在（补丁就是照着它们插的）。

### 怎么用

```bash
git clone --depth 1 https://gitee.com/openLuat/LuatOS.git
cd LuatOS
git apply /path/to/patches/airui-image-cache-lua.patch
```

打完补丁，`components/airui/binding/luat_lib_airui.c` 里会多出：

```c
#include "lvgl9/src/misc/cache/instance/lv_image_cache.h"
...
static int l_airui_cache_drop(lua_State *L);
static int l_airui_cache_resize(lua_State *L);
...
    {"cache_drop", ROREG_FUNC(l_airui_cache_drop)},
    {"cache_resize", ROREG_FUNC(l_airui_cache_resize)},
```

### 编译固件

**主仓库里没有 Air1603/Air8607 的 BSP**（只有 `bsp/air1601` 和 `bsp/pc`），所以重编 `.soc`
还需要厂商的 **Air1603 SDK**（BSP + 打包工具链 + 芯片专有库）。拿到 SDK 之后：

1. 把 SDK 里对应的 `components/airui` 换成打了补丁的这份（或确认 SDK 直接引用主仓库的这份）；
2. 用 SDK 自己的工具链编译出新的 `.soc`；
3. 用 `luatos-cli flash run --soc <新的.soc>` 烧进 Air8607；
4. 相册日志里出现 `I/user.album 图片缓存可控 1` 就说明新 API 生效了。

### 烧新固件后相册的行为变化

`examples/air8607_photo_album/ui_album.lua` 里已经做了兼容（靠 `type(airui.cache_drop) == "function"` 判断）：

| | 老固件 | 打了补丁的固件 |
| --- | --- | --- |
| 显示路径 | 两条轮换（缓存里最多两份 → 解码容易失败） | 只用一条，换图前 `cache_drop` 清掉旧条目 |
| 同路径写入间隔 | 要等 2 秒桶（FAT 修改时间只有 2 秒精度） | 不用等 |
| 自动重启 | 每 3 张重启整机 | 不再重启 |
| 表现 | 偶尔黑屏到下一张 | 应该彻底不黑 |

没打补丁的固件上行为和现在完全一样（已实测：`图片缓存可控 0`）。
