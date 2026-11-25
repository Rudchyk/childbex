#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

[[ $EUID -eq 0 ]] || { echo "ERROR: run as root" >&2; exit 1; }

for user in childbex-build nodeapp childbex-ml; do
  id "$user" >/dev/null 2>&1 || {
    echo "ERROR: required user '$user' does not exist" >&2
    exit 1
  }
done

# Stop on unexpected Certbot hook drift BEFORE changing production files.
bash "$REPO_ROOT/ops/install/install-certbot-hooks.sh" --check
bash "$REPO_ROOT/ops/install/install-origin-ssl-monitoring.sh" --check

install -d -o childbex-build -g childbex-deployers -m 2770 /srv/childbex/releases
install -d -o childbex-build -g childbex-deployers -m 2770 /srv/childbex/ml-releases

setfacl -m u:nodeapp:--x /srv/childbex /srv/childbex/releases
setfacl -m u:childbex-ml:--x /srv/childbex /srv/childbex/ml-releases

install -o root -g root -m 0755   "$REPO_ROOT/ops/deploy/childbex-app-deploy"   /usr/local/sbin/childbex-app-deploy

install -o root -g root -m 0755   "$REPO_ROOT/ops/deploy/childbex-ml-deploy"   /usr/local/sbin/childbex-ml-deploy

install -o root -g root -m 0644   "$REPO_ROOT/ops/systemd/childbex-app.service"   /etc/systemd/system/childbex-app.service

install -o root -g root -m 0644   "$REPO_ROOT/ops/systemd/childbex-ml.service"   /etc/systemd/system/childbex-ml.service

systemctl daemon-reload
systemctl enable childbex-app.service childbex-ml.service

bash "$REPO_ROOT/ops/install/install-certbot-hooks.sh" --install
bash "$REPO_ROOT/ops/install/install-origin-ssl-monitoring.sh" --install

echo "Installed ChildBEx production deploy scripts, systemd units, Certbot hooks and origin SSL monitoring."
echo "No deployment was triggered."
