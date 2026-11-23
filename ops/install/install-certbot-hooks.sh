#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_DIR="$REPO_ROOT/ops/certbot/renewal-hooks/deploy"
DEST_DIR="${CHILDBEX_CERTBOT_HOOKS_DIR:-/etc/letsencrypt/renewal-hooks/deploy}"
MODE="${1:---check}"
HOOKS=(30-childbex-web.sh 50-auth-childbex.sh)

case "$MODE" in
  --check|--verify|--install) ;;
  *) echo "Usage: $0 [--check|--verify|--install]" >&2; exit 2 ;;
esac

# --check detects drift and permits missing files before first install.
# --verify additionally requires both installed files to exist.
# A different destination is supported for non-privileged read-only tests only.
if [[ "$MODE" == --install ]]; then
  [[ "$EUID" -eq 0 ]] || { echo "ERROR: --install requires root" >&2; exit 1; }
  [[ "$DEST_DIR" == /etc/letsencrypt/renewal-hooks/deploy ]] || {
    echo "ERROR: refusing to install to a non-production directory" >&2; exit 1;
  }
fi

[[ ! -L "$DEST_DIR" ]] || { echo "ERROR: hooks directory is a symlink" >&2; exit 1; }

failed=0
for name in "${HOOKS[@]}"; do
  src="$SOURCE_DIR/$name"
  dst="$DEST_DIR/$name"
  bash -n "$src" || exit 1

  if [[ -L "$dst" || ( -e "$dst" && ! -f "$dst" ) ]]; then
    echo "ERROR: unexpected destination type for $name" >&2
    failed=1
  elif [[ -f "$dst" ]] && ! cmp -s "$src" "$dst"; then
    echo "ERROR: $name differs from repository. Review drift before installing." >&2
    failed=1
  elif [[ ! -e "$dst" && "$MODE" == --verify ]]; then
    echo "ERROR: $name is missing" >&2
    failed=1
  elif [[ ! -e "$dst" ]]; then
    echo "PENDING: $name is not yet installed"
  else
    if [[ "$DEST_DIR" == /etc/letsencrypt/renewal-hooks/deploy ]]; then
      owner_mode="$(stat -c '%a %U:%G' "$dst")"
      if [[ "$owner_mode" != "755 root:root" ]]; then
        echo "ERROR: $name has unexpected owner or permissions ($owner_mode)" >&2
        failed=1
      fi
    fi
    echo "OK: $name matches repository"
  fi
done
(( failed == 0 )) || exit 1

if [[ "$MODE" == --install ]]; then
  install -d -o root -g root -m 0755 "$DEST_DIR"
  for name in "${HOOKS[@]}"; do
    install -o root -g root -m 0755 "$SOURCE_DIR/$name" "$DEST_DIR/$name"
    cmp -s "$SOURCE_DIR/$name" "$DEST_DIR/$name"
    [[ "$(stat -c '%a %U:%G' "$DEST_DIR/$name")" == "755 root:root" ]]
    echo "INSTALLED: $name"
  done
fi
