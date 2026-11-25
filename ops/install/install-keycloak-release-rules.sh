#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Run only on the shared Prometheus host after the ChildBEx exporter is observed.
# Installs exactly ONE ChildBEx-specific rules file; never touches other rules.
die() { echo "ERROR: $*" >&2; exit 1; }
(( EUID == 0 )) || die "Run as root on the shared monitoring server."
(( $# == 0 )) || die "Usage: sudo bash ops/install/install-keycloak-release-rules.sh"

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
src="$repo_root/ops/prometheus/rules/76-childbex-keycloak-release.yml"
dest="/etc/prometheus/rules/76-childbex-keycloak-release.yml"

[[ -f "$src" && ! -L "$src" ]] || die "Missing reviewed ChildBEx rules file."
[[ ! -e "$dest" && ! -L "$dest" ]] ||
  die "Rules file already installed. Refusing unreviewed replacement."
for cmd in promtool systemctl install rm python3; do
  command -v "$cmd" >/dev/null 2>&1 || die "Missing $cmd"
done
systemctl is-active --quiet prometheus || die "Prometheus is not active."
promtool check rules "$src"
promtool check config /etc/prometheus/prometheus.yml

# Probe Prometheus itself, not merely Node Exporter's local /metrics output.
python3 - <<'PY'
import json
from urllib.parse import urlencode
from urllib.request import urlopen

query = 'keycloak_release_check_success{job="childbex-node",deployment="childbex"}'
url = "http://127.0.0.1:9090/api/v1/query?" + urlencode({"query": query})
with urlopen(url, timeout=10) as response:
    body = json.load(response)
if body.get("status") != "success":
    raise SystemExit("Prometheus query unsuccessful")
series = body.get("data", {}).get("result", [])
if len(series) != 1 or series[0]["value"][1] != "1":
    raise SystemExit("Expected exactly one successful ChildBEx release checker series")
print("ChildBEx Keycloak release metric present in central Prometheus.")
PY

installed=0
complete=0
cleanup() {
  local rc=$?
  trap - EXIT
  if (( installed && !complete )); then
    rm -f -- "$dest"
    systemctl reload prometheus || true
    echo "New ChildBEx rules rolled back; other rules untouched." >&2
  fi
  exit "$rc"
}
trap cleanup EXIT

install -o root -g root -m 0644 "$src" "$dest"
installed=1
promtool check rules "$dest"
promtool check config /etc/prometheus/prometheus.yml
systemctl reload prometheus
systemctl is-active --quiet prometheus || die "Prometheus failed after reload"
complete=1
echo "ChildBEx Keycloak release alerts installed on shared Prometheus."
echo "Only /etc/prometheus/rules/76-childbex-keycloak-release.yml was added."
