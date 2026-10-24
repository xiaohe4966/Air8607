#!/usr/bin/env bash
# Build and flash the Air8607 ESP32-C3 WiFi bridge.
# Usage: ./flash_c3.sh /dev/cu.wchusbserialXXXX
set -euo pipefail

PORT="${1:-}"
if [[ -z "$PORT" ]]; then
  echo "用法: ./flash_c3.sh /dev/cu.wchusbserialXXXX" >&2
  echo "可用串口:" >&2
  ls /dev/cu.* 2>/dev/null >&2 || true
  exit 1
fi

ROOT="$(cd "$(dirname "$0")" && pwd)"
IDF_PATH="${IDF_PATH:-$HOME/esp/v5.4/esp-idf}"
if [[ -f "$IDF_PATH/export.sh" ]]; then
  # shellcheck disable=SC1090
  source "$IDF_PATH/export.sh" >/dev/null
fi

if ! command -v idf.py >/dev/null 2>&1; then
  echo "找不到 idf.py，请先安装 ESP-IDF 或设置 IDF_PATH" >&2
  exit 1
fi

cd "$ROOT"
idf.py build

python -m esptool --chip esp32c3 -p "$PORT" \
  -b 115200 --no-stub --before default_reset --after hard_reset \
  write_flash --no-compress --flash_mode dio --flash_size 4MB --flash_freq 40m \
  0x0 build/bootloader/bootloader.bin \
  0x8000 build/partition_table/partition-table.bin \
  0x10000 build/air8607_c3_wifi_bridge.bin
