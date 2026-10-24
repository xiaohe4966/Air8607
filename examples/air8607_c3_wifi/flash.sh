#!/usr/bin/env bash
# air8607_c3_wifi - Air8607 烧录脚本
# 依赖：luatos-cli；同目录或指定路径下要有 LuatOS-SoC_V1028_Air1603_102.soc
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
CLI="${LUATOS_CLI:-luatos-cli}"
SOC="${SOC:-$ROOT/LuatOS-SoC_V1028_Air1603_102.soc}"
PORT="${1:-}"
MODE="${2:-script}"

if ! command -v "$CLI" >/dev/null 2>&1; then
  echo "找不到 luatos-cli，请先安装或设置 LUATOS_CLI" >&2
  exit 1
fi
if [[ ! -f "$SOC" ]]; then
  echo "缺少固件: $SOC" >&2
  echo "下载: https://docs.openluat.com/air8607/software/debug/" >&2
  exit 1
fi
if [[ -z "$PORT" ]]; then
  PORT="$(ls /dev/cu.usbmodem* /dev/cu.wchusbserial* /dev/cu.usbserial* 2>/dev/null | head -n1 || true)"
fi
if [[ -z "$PORT" ]]; then
  echo "用法: ./flash.sh <串口> [script|full]" >&2
  echo "可用串口:" >&2
  "$CLI" serial list >&2 || true
  exit 1
fi

FLAT="$(mktemp -d "${TMPDIR:-/tmp}/air8607-ui.XXXXXX")"
trap 'rm -rf "$FLAT"' EXIT
dupes="$(cd "$ROOT" && find . -type f ! -name ".DS_Store" ! -name "*.soc" -exec basename {} \; | sort | uniq -d)"
if [[ -n "$dupes" ]]; then
  echo "文件名冲突，无法平铺:" >&2
  echo "$dupes" >&2
  exit 1
fi
find "$ROOT" -type f ! -name ".DS_Store" ! -name "flash.sh" ! -name "*.soc" -exec cp {} "$FLAT/" \;

if [[ "$MODE" == "full" ]]; then
  "$CLI" flash run --soc "$SOC" --port "$PORT" --script "$FLAT" --tail-log-secs 20
else
  "$CLI" flash script --soc "$SOC" --port "$PORT" --script "$FLAT"
fi
