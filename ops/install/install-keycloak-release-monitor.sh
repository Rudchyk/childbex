#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# ChildBEx-only version monitoring. Never starts Keycloak, the checker, or a timer.
# Does not install central Prometheus rules (they run on the shared server).
die() { echo "ERROR: $*" >&2; exit 1; }
(( EUID == 0 )) || die "Run with sudo as root."
(( $# == 0 )) || die "Usage: sudo bash ops/install/install-keycloak-release-monitor.sh"

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
src="$repo_root/ops/keycloak"
runner='/usr/local/sbin/childbex-keycloak-release-check'
service='/etc/systemd/system/childbex-keycloak-release-check.service'
timer='/etc/systemd/system/childbex-keycloak-release-check.timer'
textfile_dir='/var/lib/node_exporter/textfile_collector'

for cmd in python3 bash systemctl systemd-analyze install runuser id grep cmp rm; do
  command -v "$cmd" >/dev/null 2>&1 || die "Missing required command: $cmd"
done
for file in release-check.py childbex-keycloak-release-check.service childbex-keycloak-release-check.timer; do
  [[ -f "$src/$file" && ! -L "$src/$file" ]] || die "Missing reviewed source: $file"
done
for dest in "$runner" "$service" "$timer"; do
  [[ ! -e "$dest" && ! -L "$dest" ]] ||
    die "Already installed: $dest. Refusing unreviewed replacement."
done

[[ -f /opt/keycloak/bin/kc.sh && -x /opt/keycloak/bin/kc.sh ]] ||
  die "Expected executable /opt/keycloak/bin/kc.sh absent; audit actual ChildBEx layout."
id keycloak >/dev/null 2>&1 || die "Expected Keycloak OS user does not exist."
[[ -x /usr/sbin/runuser ]] || die "Expected /usr/sbin/runuser absent."
[[ -d "$textfile_dir" && ! -L "$textfile_dir" ]] ||
  die "Textfile collector directory absent or symlinked: $textfile_dir"
systemctl is-active --quiet node_exporter.service ||
  die "Existing node_exporter.service is not active; verify production layout."
systemctl cat node_exporter.service |
  grep -Fq -- "--collector.textfile.directory=$textfile_dir" ||
  die "Expected Node Exporter textfile collector flag is not in the service unit."

echo "==> Offline checker tests"
python3 -B "$src/release-check.py" --self-test
echo "==> Verify installed Keycloak version via unprivileged kc.sh --version"
python3 -B - "$src/release-check.py" <<'PY'
import runpy, sys
installed = runpy.run_path(sys.argv[1])["installed_version"]()
print("Detected installed ChildBEx Keycloak version:", installed)
PY

staged=0
committed=0
cleanup() {
  local rc=$?
  trap - EXIT
  if (( staged && !committed )); then
    rm -f -- "$runner" "$service" "$timer"
    systemctl daemon-reload || true
    echo "Only newly staged release-monitoring files were rolled back." >&2
  fi
  exit "$rc"
}
trap cleanup EXIT

staged=1
echo "==> Installing checker and dedicated units only"
install -o root -g root -m 0755 "$src/release-check.py" "$runner"
install -o root -g root -m 0644 "$src/childbex-keycloak-release-check.service" "$service"
install -o root -g root -m 0644 "$src/childbex-keycloak-release-check.timer" "$timer"
systemd-analyze verify "$service" "$timer"
python3 -B "$runner" --self-test
cmp -s "$src/release-check.py" "$runner" ||
  die "Installed runner does not match reviewed source"
systemctl daemon-reload

committed=1
echo "ChildBEx Keycloak release checker: STAGED."
echo "No service or timer enabled/started. Central Prometheus rules not installed."
