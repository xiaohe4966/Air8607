#!/usr/bin/env python3
"""
给 Air1603/Air8607 的 .soc 打补丁：把 AirUI 的图片缓存上限调小。

背景
----
AirUI（components/airui）把整屏 JPEG 解码成 RGB565 放进 LVGL 的图片缓存，
每张 1024×600 的照片约 1.17 MB。固件里图片缓存的预算是 **3 MB**
（lv_init 里 `mov.w r0, #0x300000`），但 LVGL 的堆只有约 1.5 MB
（.psram_ll_heap）—— 缓存比堆还大，攒到第 3、4 张照片时就再也分配不出解码需要的
连续内存，日志是 `decode fail: hzjpeg alloc fail ... 连续内存不足`，照片区域黑屏。

补丁做的事
----------
把那个缓存上限从 3 MB 改成 2 MB（可指定）。只改 1 个字节。

**不能改成 1 MB**：AirUI 的 jpg 解码器在 decoder_open 里有一道校验
`w*h*3 > 图片缓存上限` 就直接拒绝（日志 `open fail: 图片 1024x600 过大，解码需
w*h*3=1843200 字节，超过单图上限 1048576 字节`），而且解码用的 RGB888 缓冲
（1024×600 要 1.84 MB）也是从图片缓存的池子里分配的。1 MB 等于所有整屏照片都显示不出来。
2 MB 才装得下 1.84 MB 的解码缓冲，同时缓存只能驻留 1 张解码结果（1.17 MB），
不会像 3 MB 那样攒到两三张把连续内存挤爆。

用法
----
    pip install py7zr
    python3 patch_soc.py LuatOS-SoC_V1028_Air1603_102.soc [-o 输出.soc] [--cache-size 2097152]

刷固件仍用官方工具：

    luatos-cli flash run --soc <改好的.soc> --port <串口> --script <脚本目录>

出问题时把原始 .soc 再刷回去即可（只改了应用区的一个字节，bootloader 没动）。
"""

import argparse
import os
import shutil
import struct
import sys
import tempfile

# lv_init 里的 "mov.w r0, #0x300000"（图片缓存上限 3 MB）
CACHE_SIZE_PATTERN = bytes.fromhex("4ff44010")
CACHE_SIZE_OFFSET = 0x126952          # luatos.bin 内偏移（vaddr 0x14126952 - 0x14000000）
CACHE_SIZE_ENCODINGS = {
    0x100000: "4ff48010",   # 1 MB
    0x180000: "4ff4c010",   # 1.5 MB
    0x200000: "4ff40010",   # 2 MB
    0x280000: "4ff42010",   # 2.5 MB
    0x300000: "4ff44010",   # 3 MB（原始值）
}

def disasm_note(old_bytes, new_bytes):
    try:
        from capstone import Cs, CS_ARCH_ARM, CS_MODE_THUMB
        md = Cs(CS_ARCH_ARM, CS_MODE_THUMB)
        out = []
        for buf, tag in ((old_bytes, "改前"), (new_bytes, "改后")):
            out.append(f"  {tag}:")
            for i in md.disasm(buf, 0x14126952):
                out.append(f"    {i.address:#x}  {i.bytes.hex():12s} {i.mnemonic:8s} {i.op_str}")
                break
        return "\n".join(out)
    except Exception:
        return "  (没装 capstone，跳过反汇编对比)"

def patch_bin(data, size):
    if CACHE_SIZE_PATTERN not in data:
        raise SystemExit("没找到图片缓存大小的指令，这个 .soc 可能不是 Air1603/Air8607 的 V1028 固件")
    if data.count(CACHE_SIZE_PATTERN) != 1:
        raise SystemExit("找到多处匹配，无法确定改哪一处")
    enc = CACHE_SIZE_ENCODINGS.get(size)
    if not enc:
        raise SystemExit(f"{size} 不是可编码的大小，可用：{[hex(k) for k in CACHE_SIZE_ENCODINGS]}")
    out = bytearray(data)
    off = CACHE_SIZE_OFFSET
    old = bytes(out[off:off + 4])
    out[off:off + 4] = bytes.fromhex(enc)
    return bytes(out), off, old

def main():
    ap = argparse.ArgumentParser(description="给 .soc 打上「调小 AirUI 图片缓存」的补丁")
    ap.add_argument("soc", help="原始 .soc 文件")
    ap.add_argument("-o", "--output", help="输出 .soc（默认 <原名>_cache2m.soc）")
    ap.add_argument("--cache-size", type=lambda v: int(v, 0), default=0x200000,
                    help="新的图片缓存上限字节数，默认 0x200000（2 MB，1024×600 至少要这个）")
    args = ap.parse_args()

    try:
        import py7zr
    except ImportError:
        raise SystemExit("缺少 py7zr：pip install py7zr")

    src = os.path.abspath(args.soc)
    out = os.path.abspath(args.output or src.replace(".soc", "_cache2m.soc"))
    tmp = tempfile.mkdtemp(prefix="socpatch")
    try:
        with py7zr.SevenZipFile(src, "r") as z:
            names = z.getnames()
            z.extractall(tmp)

        binpath = os.path.join(tmp, "luatos.bin")
        if not os.path.exists(binpath):
            raise SystemExit("包里没有 luatos.bin，不是预期的 .soc 结构")
        data = open(binpath, "rb").read()
        patched, off, old = patch_bin(data, args.cache_size)
        open(binpath, "wb").write(patched)

        with py7zr.SevenZipFile(out, "w", filters=[{"id": py7zr.FILTER_LZMA2, "preset": 7}]) as z:
            for n in names:
                z.write(os.path.join(tmp, n), n)

        print(f"已改 1 个字节：luatos.bin 偏移 {hex(off)}（vaddr {hex(0x14000000 + off)}）")
        print(f"  图片缓存上限 {args.cache_size} 字节（{args.cache_size / 1024 / 1024:.1f} MB）")
        print(disasm_note(old, patched[off:off + 4]))
        print(f"输出：{out}")
        print(f"刷写：luatos-cli flash run --soc {out} --port <串口> --script <脚本目录>")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == "__main__":
    main()
