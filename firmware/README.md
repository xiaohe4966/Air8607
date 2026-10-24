# 固件下载

仓库不提交 `.soc` 二进制（约 23 MB），请在 **Releases** 下载：

- <https://github.com/xiaohe4966/Air8607/releases/latest>

## 需要的两个文件

| 文件 | 用途 | SHA-256 |
| --- | --- | --- |
| `Air8607_Factory_001.999.001_LuatOS-SoC_V1028_Air1603_102.soc` | 首次全量烧录出厂工程（`./flash_mac.sh full`） | `cb53446f805679ac76b480dfc09a93a0b17852dfec732741a88a2415d36e1e2c` |
| `LuatOS-SoC_V1028_Air1603_102.soc` | 只刷脚本区（`./flash_mac.sh script` / `flash_project.sh`） | `92d5f2c86fb7ca97a84f0774894ec70654de3106b03406df15f2f3d533d781c6` |

下载后放到本目录：

```text
firmware/
├── Air8607_Factory_001.999.001_LuatOS-SoC_V1028_Air1603_102.soc
├── LuatOS-SoC_V1028_Air1603_102.soc
└── README.md
```

## 官方来源

- Air8607 文档：<https://docs.openluat.com/air8607/>
- 固件/调试资料：<https://docs.openluat.com/air8607/software/debug/>
- LuatOS 固件仓库：<https://gitee.com/openLuat/luatos-soc-air1603>

如果官方更新了固件版本，以上文件名和哈希可能变化；以合宙文档为准。
