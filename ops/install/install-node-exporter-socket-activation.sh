#!/usr/bin/env bash
# ChildBEx #65: manual native systemd socket cutover; never app/ML deployed.
set -Eeuo pipefail
umask 077
export SYSTEMD_PAGER=cat SYSTEMD_COLORS=0

fail() { echo "ERROR: $*" >&2; exit 1; }
[[ "$#" -eq 1 ]] || fail 'Usage: sudo bash ops/install/install-node-exporter-socket-activation.sh --check|--install|--verify|--rollback'
action="$1"
case "$action" in --check|--install|--verify|--rollback) ;; *) fail "Unknown action: $action" ;; esac
(( EUID == 0 )) || fail 'Run as root on the ChildBEx production host.'

ops_root="$(cd -- "$(dirname -- "$0")/.." && pwd)"
source_socket="$ops_root/systemd/node_exporter.socket"
source_override="$ops_root/systemd/node_exporter-socket-activation.conf"
source_collectors="$ops_root/systemd/node_exporter-collectors.conf"
socket_unit=/etc/systemd/system/node_exporter.socket
service_dropins=/etc/systemd/system/node_exporter.service.d
socket_override="$service_dropins/zzzz-childbex-socket.conf"
collector_override="$service_dropins/zz-childbex-collectors.conf"
textfile_override="$service_dropins/textfile.conf"

for cmd in systemctl systemd-analyze install cmp rm ss awk grep; do
  command -v "$cmd" >/dev/null 2>&1 || fail "Missing command: $cmd"
done
for file in "$source_socket" "$source_override" "$source_collectors"; do
  [[ -f "$file" && ! -L "$file" ]] || fail "Missing reviewed source: $file"
done

check_existing_baseline() {
  [[ -d "$service_dropins" && ! -L "$service_dropins" ]] || fail 'Unexpected service drop-in directory'
  [[ -f "$textfile_override" && ! -L "$textfile_override" ]] || fail 'Missing textfile.conf'
  [[ -f "$collector_override" && ! -L "$collector_override" ]] || fail 'Issue #64 collector override missing'
  cmp -s "$source_collectors" "$collector_override" || fail 'Issue #64 collector config drift; STOP'
  [[ "$(systemctl --no-pager show node_exporter.service -p DropInPaths --value)" == "$textfile_override $collector_override" ]] || fail 'Unexpected service drop-ins'
  [[ "$(systemctl --no-pager show node_exporter.service -p ProtectClock --value)" == yes ]] || fail 'ProtectClock must remain enabled'
  [[ "$(systemctl --no-pager is-enabled node_exporter.service)" == enabled ]] || fail 'Existing Node Exporter service must be enabled'
  systemctl --no-pager is-active --quiet node_exporter.service || fail 'Node Exporter not active'
  [[ -x /usr/local/bin/node_exporter ]] || fail 'Missing Node Exporter binary'
  local help_text before listeners
  help_text="$(/usr/local/bin/node_exporter --help 2>&1)"
  grep -Fq -- '--[no-]web.systemd-socket' <<< "$help_text" || fail 'Installed Node Exporter lacks native socket activation'
  before="$(systemctl --no-pager show node_exporter.service -p ExecStart --value)"
  grep -Fq -- '--web.listen-address=100.117.155.53:9100' <<< "$before" || fail 'Current listener drift'
  grep -Fq -- '--collector.textfile.directory=/var/lib/node_exporter/textfile_collector' <<< "$before" || fail 'Current textfile directory drift'
  listeners="$(ss -H -ltn 'sport = :9100')"
  [[ "$(printf '%s\n' "$listeners" | grep -c .)" == 1 ]] || fail 'Expected exactly one TCP :9100 listener'
  awk '$4 == "100.117.155.53:9100" {ok=1} END {exit !ok}' <<< "$listeners" || fail 'TCP :9100 bind drift'
  [[ ! -e "$socket_unit" && ! -L "$socket_unit" ]] || fail 'node_exporter.socket already exists'
  [[ ! -e "$socket_override" && ! -L "$socket_override" ]] || fail 'Socket override already exists'
  [[ "$(systemctl --no-pager is-enabled node_exporter.socket 2>&1 || true)" == not-found ]] || fail 'Another node_exporter.socket unit already exists'
  bash "$ops_root/tests/test-node-exporter-socket-activation.sh"
  echo 'PASS: current direct-bind Node Exporter matches reviewed baseline'
}

verify_runtime() {
  [[ -f "$socket_unit" && ! -L "$socket_unit" ]] || fail 'Socket unit not installed'
  [[ -f "$socket_override" && ! -L "$socket_override" ]] || fail 'Socket override not installed'
  cmp -s "$source_socket" "$socket_unit" || fail 'Installed socket drift'
  cmp -s "$source_override" "$socket_override" || fail 'Installed socket override drift'
  cmp -s "$source_collectors" "$collector_override" || fail 'Issue #64 config drift'
  systemctl --no-pager is-enabled --quiet node_exporter.socket || fail 'Socket not enabled'
  systemctl --no-pager is-active --quiet node_exporter.socket || fail 'Socket not active'
  systemctl --no-pager is-active --quiet node_exporter.service || fail 'Node Exporter service not active'
  [[ "$(systemctl --no-pager show node_exporter.service -p ProtectClock --value)" == yes ]] || fail 'ProtectClock changed'
  local argv dropins listeners flag
  dropins="$(systemctl --no-pager show node_exporter.service -p DropInPaths --value)"
  [[ "$dropins" == "$textfile_override $collector_override $socket_override" ]] || fail 'Unexpected active drop-ins'
  argv="$(systemctl --no-pager show node_exporter.service -p ExecStart --value)"
  grep -Fq -- '--web.systemd-socket' <<< "$argv" || fail 'Node Exporter not in socket mode'
  ! grep -Fq -- '--web.listen-address=' <<< "$argv" || fail 'Direct listener still configured'
  grep -Fq -- '--collector.textfile.directory=/var/lib/node_exporter/textfile_collector' <<< "$argv" || fail 'Textfile flag lost'
  listeners="$(ss -H -ltn 'sport = :9100')"
  [[ "$(printf '%s\n' "$listeners" | grep -c .)" == 1 ]] || fail 'Unexpected :9100 listener count'
  awk '$4 == "100.117.155.53:9100" {ok=1} END {exit !ok}' <<< "$listeners" || fail 'Wrong :9100 bound address'
  # Socket admits only shared's 100.78.90.38/32. Local curl is not a valid test.
  # Validate HTTP and metrics from shared Prometheus as a separate rollout gate.
  for flag in \
    --no-collector.bcachefs --no-collector.bonding \
    --no-collector.fibrechannel --no-collector.infiniband \
    --no-collector.ipvs --no-collector.nfs --no-collector.nfsd \
    --no-collector.nvme --no-collector.tapestats \
    --no-collector.timex --no-collector.zfs; do
    grep -Fq -- "$flag" <<< "$argv" || fail "Collector flag lost: $flag"
  done
  echo 'PASS: socket and exporter active; listener and collector argv preserved'
  echo 'NEXT: verify HTTP and all metrics from shared Prometheus, not locally'
}

rollback_internal() {
  echo '=== Restore previous direct-bind Node Exporter ===' >&2
  systemctl --no-pager stop node_exporter.service || true
  systemctl --no-pager disable --now node_exporter.socket || true
  # Never delete a file modified by another operator during the cutover.
  if [[ -e "$socket_override" ]]; then
    cmp -s "$source_override" "$socket_override" || fail 'Socket override drift; manual intervention required'
    rm -- "$socket_override"
  fi
  if [[ -e "$socket_unit" ]]; then
    cmp -s "$source_socket" "$socket_unit" || fail 'Socket unit drift; manual intervention required'
    rm -- "$socket_unit"
  fi
  systemctl --no-pager daemon-reload
  systemctl --no-pager start node_exporter.service || fail 'Rollback cannot restart exporter; investigate immediately'
  systemctl --no-pager is-active --quiet node_exporter.service || fail 'Rollback exporter not active'
  echo 'PASS: original direct-bind Node Exporter restored' >&2
}

case "$action" in
  --check)
    check_existing_baseline
    ;;
  --verify)
    verify_runtime
    ;;
  --rollback)
    [[ -f "$socket_unit" && -f "$socket_override" ]] || fail 'Socket installation not found; refusing blind rollback'
    cmp -s "$source_socket" "$socket_unit" || fail 'Socket drift; stop for review'
    cmp -s "$source_override" "$socket_override" || fail 'Service override drift; stop for review'
    cmp -s "$source_collectors" "$collector_override" || fail 'Issue #64 collector config drift'
    rollback_internal
    ;;
  --install)
    check_existing_baseline
    changed=0
    done_ok=0
    on_exit() {
      local rc=$?
      trap - EXIT
      if (( rc != 0 && changed == 1 && done_ok == 0 )); then
        echo 'ERROR: cutover failed; attempting automatic rollback' >&2
        rollback_internal || echo 'ROLLBACK FAILED: manual intervention required' >&2
      fi
      exit "$rc"
    }
    trap on_exit EXIT
    trap 'exit 129' HUP
    trap 'exit 130' INT
    trap 'exit 143' TERM
    # Stage exactly two files; leave textfile/collector files and hardening intact.
    changed=1
    install -o root -g root -m 0644 "$source_socket" "$socket_unit"
    install -o root -g root -m 0644 "$source_override" "$socket_override"
    systemctl --no-pager daemon-reload
    systemd-analyze verify --man=no "$socket_unit" /etc/systemd/system/node_exporter.service
    # The original Node Exporter owns :9100. Stop it BEFORE socket activation.
    systemctl --no-pager stop node_exporter.service
    systemctl --no-pager enable --now node_exporter.socket
    systemctl --no-pager start node_exporter.service
    verify_runtime
    done_ok=1
    echo 'PASS: native socket activation installed; no reboot performed'
    ;;
esac
