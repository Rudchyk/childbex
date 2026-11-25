#!/usr/bin/env bash
# Static integration test: native socket activation must preserve Issue #64.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOCKET="$ROOT/ops/systemd/node_exporter.socket"
DROPIN="$ROOT/ops/systemd/node_exporter-socket-activation.conf"
COLLECTORS="$ROOT/ops/systemd/node_exporter-collectors.conf"
INSTALLER="$ROOT/ops/install/install-node-exporter-socket-activation.sh"
fail() { echo "FAIL: $*" >&2; exit 1; }

bash -n "$INSTALLER"
grep -qx 'ListenStream=100.117.155.53:9100' "$SOCKET" || fail 'tailnet-only listener'
[[ "$(grep -c '^ListenStream=' "$SOCKET")" == 1 ]] || fail 'multiple socket listeners'
grep -qx 'FreeBind=yes' "$SOCKET" || fail 'no FreeBind'
grep -qx 'Accept=no' "$SOCKET" || fail 'no Accept=no'
grep -qx 'IPAddressDeny=any' "$SOCKET" || fail 'socket not default-deny'
grep -qx 'IPAddressAllow=100.78.90.38/32' "$SOCKET" || fail 'unexpected Prometheus source'
[[ "$(grep -c '^IPAddressAllow=' "$SOCKET")" == 1 ]] || fail 'multiple source allow rules'
! grep -Eq '^(BindToDevice|PrivateNetwork|ExecStartPre)=' "$SOCKET" || fail 'socket depends on device or network'
! grep -Eq '^ListenStream=(0\.0\.0\.0|\[::\]|\*|[0-9]+$)' "$SOCKET" || fail 'wildcard listener'
[[ 'zzzz-childbex-socket.conf' > 'zz-childbex-collectors.conf' ]] || fail 'override sorting'
[[ 'zzzz-childbex-socket.conf' > 'textfile.conf' ]] || fail 'override sorting'
grep -Fq -- 'zzzz-childbex-socket.conf' "$DROPIN" || fail 'drop-in filename'
grep -qx 'Requires=node_exporter.socket' "$DROPIN" || fail 'service does not require socket'
grep -qx 'After=node_exporter.socket' "$DROPIN" || fail 'service does not wait for socket'
grep -qx 'ExecStart=' "$DROPIN" || fail 'missing reset'
grep -q '^ExecStart=/usr/local/bin/node_exporter ' "$DROPIN" || fail 'unexpected executable'
grep -Eq -- '^  --web.systemd-socket( \\)?$' "$DROPIN" || fail 'native socket flag missing'
! grep -Fq -- '--web.listen-address' "$DROPIN" || fail 'direct IP bind still configured'
grep -Fq -- '--collector.textfile.directory=/var/lib/node_exporter/textfile_collector' "$DROPIN" || fail 'textfile lost'

expected="$(grep -oE -- '--no-collector\.[a-z0-9]+' "$COLLECTORS" | LC_ALL=C sort)"
actual="$(grep -oE -- '--no-collector\.[a-z0-9]+' "$DROPIN" | LC_ALL=C sort)"
[[ "$expected" == "$actual" ]] || fail 'Issue #64 collector flags changed'
[[ "$(printf '%s\n' "$actual" | wc -l)" -eq 11 ]] || fail 'not exactly 11 excluded collectors'
! grep -Fq -- '--no-collector.conntrack' "$DROPIN" || fail 'conntrack disabled'
! grep -Eq '^(User|Group|ProtectClock|NoNewPrivileges|IPAddressAllow|IPAddressDeny|CapabilityBoundingSet|AmbientCapabilities|ExecStartPre)=' "$DROPIN" || fail 'service hardening changed'
! grep -Ei '^[[:space:]]*[^#].*(ip_nonlocal_bind|sysctl[[:space:]]+-w)' "$SOCKET" "$DROPIN" "$INSTALLER" || fail 'global sysctl modified'
! grep -Eq 'BEGIN [A-Z ]+PRIVATE KEY|tskey-|\.dcm\b' "$SOCKET" "$DROPIN" "$INSTALLER" || fail 'secret or medical data'

# Stub service lets systemd-analyze check socket syntax on a CI runner.
if command -v systemd-analyze >/dev/null; then
  tmp="$(mktemp -d)"
  trap 'rm -rf -- "$tmp"' EXIT
  cp -- "$SOCKET" "$tmp/node_exporter.socket"
  printf '[Unit]\nDescription=CI stub service\n[Service]\nExecStart=/bin/true\n' > "$tmp/node_exporter.service"
  systemd-analyze verify --man=no "$tmp/node_exporter.socket" "$tmp/node_exporter.service" || fail 'invalid systemd socket unit'
  rm -rf -- "$tmp"
  trap - EXIT
fi

echo 'PASS: Node Exporter native socket activation preserves Issue #64 and tailnet restrictions'
