#!/usr/bin/env bash
# 烧录任意 Air8607 独立工程（例如 UI Studio 导出的 ZIP 解压目录）。
# 会自动把工程文件平铺到临时目录，绕开 Air1603 LuaDB 的 27 字节文件名限制。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

find_cli() {
  if [[ -n "${LUATOS_CLI:-}" ]]; then
    echo "$LUATOS_CLI"
    return 0
  fi
  if command -v luatos-cli >/dev/null 2>&1; then
    command -v luatos-cli
    return 0
  fi
  local p
  for p in "$ROOT/tools/luatos-cli" "$ROOT/../tools/luatos-cli"; do
    if [[ -x "$p" ]]; then
      echo "$p"
      return 0
    fi
  done
  return 1
}

find_port() {
  ls /dev/cu.usbmodem* /dev/cu.wchusbserial* /dev/cu.usbserial* /dev/cu.SLAB_USBtoUART* 2>/dev/null | head -n 1 || true
}

usage() {
  cat <<'EOF'
用法:
  ./flash_project.sh <工程目录> [串口] [script|full]

  script  只刷脚本/资源区，适合日常改 UI（默认）
  full    刷内核 + 工程，适合首次烧录或换固件

示例:
  ./flash_project.sh ~/Downloads/air8607_dashboard-air8607
  ./flash_project.sh ./my-ui /dev/cu.usbmodem1101 full

固件默认查找:
  ./firmware/LuatOS-SoC_V1028_Air1603_102.soc
也可以设置 SOC=/path/to/LuatOS-SoC_V1028_Air1603_102.soc
EOF
}

PROJECT="${1:-}"
PORT="${2:-}"
MODE="${3:-script}"

if [[ -z "$PROJECT" || "$PROJECT" == "-h" || "$PROJECT" == "--help" ]]; then
  usage
  exit 0
fi
if [[ ! -d "$PROJECT" ]]; then
  echo "工程目录不存在: $PROJECT" >&2
  exit 1
fi
if [[ ! -f "$PROJECT/main.lua" ]]; then
  echo "警告: $PROJECT 下没有 main.lua，确认这是独立工程目录。" >&2
fi

CLI="$(find_cli || true)"
if [[ -z "$CLI" || ! -x "$CLI" ]]; then
  echo "找不到 luatos-cli。" >&2
  echo "安装后把 luatos-cli 加入 PATH，或设置 LUATOS_CLI=/path/to/luatos-cli" >&2
  echo "下载: https://github.com/openLuat/luatos-cli/releases" >&2
  exit 1
fi

SOC="${SOC:-$ROOT/firmware/LuatOS-SoC_V1028_Air1603_102.soc}"
if [[ ! -f "$SOC" ]]; then
  echo "缺少内核固件: $SOC" >&2
  echo "从 Releases 下载 LuatOS-SoC_V1028_Air1603_102.soc 放到 firmware/：" >&2
  echo "https://github.com/xiaohe4966/Air8607/releases/latest" >&2
  exit 1
fi

if [[ -z "$PORT" ]]; then
  PORT="$(find_port)"
fi
if [[ -z "$PORT" ]]; then
  echo "没找到串口。请插好 Type-C 数据线（要能传数据）。" >&2
  echo "当前串口：" >&2
  "$CLI" serial list >&2 || true
  echo "如果仍然没有，安装 WCH CH343 驱动后重试：" >&2
  echo "https://www.wch.cn/downloads/CH34XSER_MAC_ZIP.html" >&2
  exit 1
fi

if [[ "$MODE" != "script" && "$MODE" != "full" ]]; then
  usage
  exit 1
fi

FLAT="$(mktemp -d "${TMPDIR:-/tmp}/air8607-project.XXXXXX")"
trap 'rm -rf "$FLAT"' EXIT

DUPES="$(cd "$PROJECT" && find . -type f ! -path '*/.git/*' ! -name '.DS_Store' ! -name 'flash.sh' -exec basename {} \; | sort | uniq -d)"
if [[ -n "$DUPES" ]]; then
  echo "错误：工程中存在同名文件，平铺后会冲突：" >&2
  echo "$DUPES" >&2
  exit 1
fi

find "$PROJECT" -type f ! -path '*/.git/*' ! -name '.DS_Store' ! -name 'flash.sh' -exec cp {} "$FLAT/" \;

COUNT="$(find "$FLAT" -type f | wc -l | tr -d ' ')"
echo "工程: $PROJECT (平铺 $COUNT 个文件)"
echo "串口: $PORT"
echo "固件: $SOC / 模式: $MODE"

if [[ "$MODE" == "full" ]]; then
  "$CLI" flash run --soc "$SOC" --port "$PORT" --script "$FLAT" --tail-log-secs 20
else
  "$CLI" flash script --soc "$SOC" --port "$PORT" --script "$FLAT"
fi
