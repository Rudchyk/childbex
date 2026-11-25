#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$repo_root/ops/install/install-chrony-nts-ufw.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/bin"
printf 'IPV6=yes\n' > "$tmp/ufw-defaults"
printf 'missing\n' > "$tmp/state"

cat > "$tmp/bin/ufw" <<'MOCK'
#!/usr/bin/env bash
set -Eeuo pipefail
case "$*" in
  'status verbose')
    echo 'Status: active'
    echo 'Default: deny (incoming), deny (outgoing), disabled (routed)'
    if [[ "$(cat "$TEST_UFW_STATE")" == installed ]]; then
      echo '4460/tcp                    ALLOW OUT   Anywhere                   # Chrony NTS-KE'
      echo '4460/tcp (v6)               ALLOW OUT   Anywhere (v6)              # Chrony NTS-KE'
    fi
    ;;
  "allow out 4460/tcp comment Chrony NTS-KE")
    echo installed > "$TEST_UFW_STATE"
    echo apply >> "$TEST_UFW_CALLS"
    ;;
  *) echo "Unexpected UFW invocation: $*" >&2; exit 1 ;;
esac
MOCK
chmod +x "$tmp/bin/ufw"
export TEST_UFW_STATE="$tmp/state"
export TEST_UFW_CALLS="$tmp/calls"
export CHILDBEX_UFW_DEFAULTS="$tmp/ufw-defaults"
export PATH="$tmp/bin:$PATH"

if bash "$script" --verify >/dev/null 2>&1; then
  echo 'FAIL: verify accepted a missing rule' >&2
  exit 1
fi

# Isolated UFW mock: this test never modifies the host firewall.
if [[ "$EUID" -eq 0 ]]; then
  bash "$script" --install >/dev/null
  bash "$script" --verify >/dev/null
  bash "$script" --install >/dev/null
  [[ "$(wc -l < "$tmp/calls")" -eq 1 ]]
  echo 'PASS: Chrony NTS UFW verification and idempotent install'
else
  echo installed > "$tmp/state"
  bash "$script" --verify >/dev/null
  echo 'PASS: Chrony NTS UFW verification (non-root)'
fi
