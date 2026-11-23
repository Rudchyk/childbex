#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODE="${1:---check}"
SRC_SCRIPT="$REPO_ROOT/ops/monitoring/childbex-origin-ssl-metrics"
DST_SCRIPT=/usr/local/sbin/childbex-origin-ssl-metrics
SERVICE=childbex-origin-ssl-metrics.service
TIMER=childbex-origin-ssl-metrics.timer
OUTPUT_DIR=/var/lib/node_exporter/textfile_collector

case "$MODE" in
  --check|--verify|--install) ;;
  *) echo "Usage: $0 [--check|--verify|--install]" >&2; exit 2 ;;
esac

bash -n "$SRC_SCRIPT"
command -v openssl >/dev/null
command -v date >/dev/null

if [[ "$MODE" == --install ]]; then
  [[ $EUID -eq 0 ]] || { echo "ERROR: install requires root" >&2; exit 1; }
  [[ -d "$OUTPUT_DIR" && ! -L "$OUTPUT_DIR" ]] || {
    echo "ERROR: Node Exporter textfile directory is missing or a symlink" >&2; exit 1;
  }
fi

check_file() {
  local src="$1" dst="$2" mode="$3"
  if [[ -L "$dst" || ( -e "$dst" && ! -f "$dst" ) ]]; then
    echo "STOP: unsafe destination $dst" >&2
    return 1
  elif [[ -f "$dst" ]]; then
    if ! cmp -s "$src" "$dst"; then
      echo "STOP: $dst differs from Git; review drift before installing" >&2
      return 1
    fi
    if [[ $MODE == --install || $MODE == --verify ]]; then
      local perms
      perms="$(stat -c '%a %U:%G' "$dst")"
      if [[ "$perms" != "$mode root:root" ]]; then
        echo "STOP: unexpected ownership/mode ($perms) on $dst" >&2
        return 1
      fi
    fi
    echo "OK: $dst matches Git"
  elif [[ "$MODE" == --verify ]]; then
    echo "STOP: missing $dst" >&2
    return 1
  else
    echo "PENDING: $dst is not installed"
  fi
}

# All preflight checks run before any production writes.
check_file "$SRC_SCRIPT" "$DST_SCRIPT" 755
check_file "$REPO_ROOT/ops/systemd/$SERVICE" "/etc/systemd/system/$SERVICE" 644
check_file "$REPO_ROOT/ops/systemd/$TIMER" "/etc/systemd/system/$TIMER" 644

if [[ "$MODE" == --install ]]; then
  install -o root -g root -m 0755 "$SRC_SCRIPT" "$DST_SCRIPT"
  install -o root -g root -m 0644 "$REPO_ROOT/ops/systemd/$SERVICE" "/etc/systemd/system/$SERVICE"
  install -o root -g root -m 0644 "$REPO_ROOT/ops/systemd/$TIMER" "/etc/systemd/system/$TIMER"
  systemctl daemon-reload
  systemctl enable --now "$TIMER"
  systemctl start "$SERVICE"
  bash "$0" --verify
  echo "INSTALLED: origin TLS collector, service and hourly timer"
fi
