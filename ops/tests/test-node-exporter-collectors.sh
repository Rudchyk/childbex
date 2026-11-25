#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONF="$ROOT/ops/systemd/node_exporter-collectors.conf"

[[ -f "$CONF" ]]
[[ "$(grep -c '^\[Service\]$' "$CONF")" -eq 1 ]]
[[ "$(grep -c '^ExecStart=$' "$CONF")" -eq 1 ]]
[[ "$(grep -c '^ExecStart=/usr/local/bin/node_exporter ' "$CONF")" -eq 1 ]]

grep -Fq -- '--web.listen-address=100.117.155.53:9100' "$CONF"
grep -Fq -- '--collector.textfile.directory=/var/lib/node_exporter/textfile_collector' "$CONF"

# Must apply AFTER textfile.conf (which also resets ExecStart).
grep -Fq -- '# Install as /etc/systemd/system/node_exporter.service.d/zz-childbex-collectors.conf.' "$CONF"
[[ 'zz-childbex-collectors.conf' > 'textfile.conf' ]]

expected=(bcachefs bonding fibrechannel infiniband ipvs nfs nfsd nvme tapestats timex zfs)
actual="$(grep -oE -- '--no-collector\.[a-z0-9]+' "$CONF" | LC_ALL=C sort -u)"
expected_list="$(printf '%s\n' "${expected[@]}" | sed 's/^/--no-collector./' | LC_ALL=C sort -u)"
[[ "$actual" == "$expected_list" ]]
[[ "$(grep -oE -- '--no-collector\.[a-z0-9]+' "$CONF" | wc -l)" -eq "${#expected[@]}" ]]

# Incomplete conntrack statistics still expose useful entries/limit series.
! grep -Fq -- '--no-collector.conntrack' "$CONF"
# No service hardening or firewall options may be weakened by this drop-in.
! grep -Eq '^(ProtectClock|NoNewPrivileges|IPAddressAllow|IPAddressDeny|AmbientCapabilities|CapabilityBoundingSet)=' "$CONF"

echo 'PASS: Node Exporter collector override preserves tailnet, textfile and conntrack'
