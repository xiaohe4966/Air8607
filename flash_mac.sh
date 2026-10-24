#!/usr/bin/env bash
# Air8607 Mac 烧录/日志助手（Apple Silicon / Intel 通用）
# 依赖: luatos-cli（PATH、LUATOS_CLI 或仓库旁边的 tools/luatos-cli）
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

CLI="$(find_cli || true)"
FACTORY_SOC="$ROOT/firmware/Air8607_Factory_001.999.001_LuatOS-SoC_V1028_Air1603_102.soc"
KERNEL_SOC="$ROOT/firmware/LuatOS-SoC_V1028_Air1603_102.soc"
SRC="$ROOT/factory"
BAUD="${BAUD:-6000000}"

usage() {
  cat <<'EOF'
用法:
  ./flash_mac.sh full   [串口]   全量烧录出厂固件 + 当前 factory 脚本/资源（首次用）
  ./flash_mac.sh script [串口]   只刷脚本/资源区（日常改代码用，快）
  ./flash_mac.sh log    [串口]   查看二进制日志（6Mbps）
  ./flash_mac.sh ports           列出串口

不传串口时自动查找 /dev/cu.usbmodem*、/dev/cu.wchusbserial* 等。
示例:
  ./flash_mac.sh full
  ./flash_mac.sh script /dev/cu.wchusbserial1420
  BAUD=6000000 ./flash_mac.sh log
EOF
}

find_port() {
  local p
  p="$(ls /dev/cu.usbmodem* /dev/cu.wchusbserial* /dev/cu.usbserial* /dev/cu.SLAB_USBtoUART* 2>/dev/null | head -n 1 || true)"
  if [[ -n "$p" ]]; then
    echo "$p"
    return 0
  fi
  return 1
}

require_file() {
  [[ -f "$1" ]] || { echo "缺少文件: $1" >&2; exit 1; }
}

make_flat_dir() {
  # Air1603 的 LuaDB 文件名上限 27 字节，且工厂资源按 basename 访问；
  # 所以烧录前把 factory 下所有文件平铺到一个临时目录（保留资源，避免路径超长）。
  # factory/lib 下是工厂工程需要的标准 LuatOS 扩展库（exwin/exapp/exaudio 等），
  # 必须一起打包，否则只刷脚本区会丢模块。
  local flat dupes
  flat="$(mktemp -d "${TMPDIR:-/tmp}/air8607-flat.XXXXXX")"
  dupes="$(cd "$SRC" && find . -type f ! -path './.git/*' ! -name '.DS_Store' -exec basename {} \; | sort | uniq -d)"
  if [[ -n "$dupes" ]]; then
    echo "错误：factory 中存在同名文件，平铺后会冲突：" >&2
    echo "$dupes" >&2
    rm -rf "$flat"
    exit 1
  fi
  find "$SRC" -type f ! -path '*/.git/*' ! -name '.DS_Store' -exec cp {} "$flat/" \;
  echo "$flat"
}

CMD="${1:-}"
PORT="${2:-}"

if [[ -z "$CMD" || "$CMD" == "-h" || "$CMD" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "$CLI" || ! -x "$CLI" ]]; then
  echo "找不到 luatos-cli。" >&2
  echo "安装后把 luatos-cli 加入 PATH，或设置 LUATOS_CLI=/path/to/luatos-cli" >&2
  echo "下载: https://github.com/openLuat/luatos-cli/releases" >&2
  exit 1
fi

if [[ "$CMD" == "ports" ]]; then
  "$CLI" serial list
  exit 0
fi

if [[ -z "$PORT" ]]; then
  if ! PORT="$(find_port)"; then
    echo "没找到串口。请插好 Type-C 数据线（要能传数据，不是纯充电线）。" >&2
    echo "当前串口：" >&2
    "$CLI" serial list >&2 || true
    echo "如果还是看不到，安装 WCH CH343 驱动后重试：https://www.wch.cn/downloads/CH34XSER_MAC_ZIP.html" >&2
    exit 1
  fi
fi

case "$CMD" in
  full)
    require_file "$FACTORY_SOC"
    FLAT="$(make_flat_dir)"
    trap 'rm -rf "$FLAT"' EXIT
    echo "全量烧录: $FACTORY_SOC"
    echo "脚本/资源: $SRC (平铺 $(ls "$FLAT" | wc -l | tr -d ' ') 个文件)"
    echo "串口: $PORT"
    "$CLI" flash run --soc "$FACTORY_SOC" --port "$PORT" --script "$FLAT" --tail-log-secs 20
    ;;
  script)
    require_file "$KERNEL_SOC"
    FLAT="$(make_flat_dir)"
    trap 'rm -rf "$FLAT"' EXIT
    echo "只刷脚本/资源区: $SRC (平铺 $(ls "$FLAT" | wc -l | tr -d ' ') 个文件)"
    echo "串口: $PORT"
    "$CLI" flash script --soc "$KERNEL_SOC" --port "$PORT" --script "$FLAT"
    ;;
  log)
    "$CLI" log view-binary --port "$PORT" --baud "$BAUD" --probe
    ;;
  *)
    usage
    exit 1
    ;;
esac
