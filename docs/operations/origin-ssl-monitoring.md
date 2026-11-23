# ChildBEx origin SSL monitoring

## Why

Blackbox on the shared server probes the **public Cloudflare edge**, not necessarily Nginx's origin TLS. In November 2026 the origin `app.childbex.com` certificate expired while the edge certificate remained valid. These metrics monitor certificates **on ChildBEx** and supplement, not replace, `blackbox-http`.

## Git ownership

- Collector: `ops/monitoring/childbex-origin-ssl-metrics` -> `/usr/local/sbin/childbex-origin-ssl-metrics` on ChildBEx.
- Service/timer: `ops/systemd/childbex-origin-ssl-metrics.{service,timer}` -> `/etc/systemd/system/`.
- Installer: `ops/install/install-origin-ssl-monitoring.sh` (also invoked by `ops/install/install-production-deploy.sh`).
- Project-specific alert rules: `ops/prometheus/rules/21-childbex-origin-ssl.yml` -> **only this file** in `/etc/prometheus/rules/` on **shared**, after review.
- Generic Blackbox scrape jobs, edge TLS alerts and shared alert routing remain owned by `Rudchyk/shared-infrastructure`; this PR does not edit them.

This implementation deliberately does not manage existing server-local `childbex-keycloak-release-check` or backup collectors, which were not yet imported into the repo.

## Certificate paths

The service reads X.509 certificate public content, **never private keys**, with root-only access to restricted Certbot paths:

| Metric certificate label | Source | Live path |
| --- | --- | --- |
| `app.childbex.com` | `nginx` | `/etc/letsencrypt/live/app.childbex.com/fullchain.pem` |
| `childbex.com` | `nginx` | `/etc/letsencrypt/live/childbex.com/fullchain.pem` |
| `auth.childbex.com` | `nginx` | `/srv/secrets/auth.childbex.com/auth.childbex.com.pem` |
| `auth.childbex.com` | `certbot` | `/etc/letsencrypt/live/auth.childbex.com/fullchain.pem` |

The auth comparison uses the SHA-256 fingerprint of the leaf certificate, not file-text equality; PEM bundles can differ while their leaf certificate is identical. Never output certificate content or secret keys in metric labels.

## Metrics and alerts

The collector atomically publishes `/var/lib/node_exporter/textfile_collector/childbex_origin_ssl.prom` once per hour; Node Exporter already scrapes this directory on `childbex-node`.

Metrics:
- `childbex_origin_ssl_certificate_expiry_timestamp_seconds{certificate,source}`: `notAfter` as epoch.
- `childbex_origin_ssl_certificate_read_success{certificate,source}`: 1 when parsed, 0 on failure.
- `childbex_origin_ssl_auth_matches_certbot`: 1 on identical auth leaf certificates, 0 otherwise.
- `childbex_origin_ssl_collector_success`: 1 only if every certificate is parsed and auth copies match.
- `childbex_origin_ssl_collector_last_run_timestamp_seconds`: timestamp of most recent completed collection.

Alerts: warning at 30 days, critical at 7 days, read failures, auth copy mismatch, collector failures, or missing/stale metrics (over two hours). Failures intentionally publish a 0 status and then exit nonzero. A failed atomic write leaves old metrics in place, caught by the stale rule.

## Controlled rollout (one host at a time)

**ChildBEx**, from a reviewed and merged `main` checkout:

```bash
bash ops/tests/test-origin-ssl-monitoring.sh
sudo bash ops/install/install-origin-ssl-monitoring.sh --check
sudo bash ops/install/install-origin-ssl-monitoring.sh --install
sudo bash ops/install/install-origin-ssl-monitoring.sh --verify
sudo systemctl status childbex-origin-ssl-metrics.service --no-pager
systemctl list-timers childbex-origin-ssl-metrics.timer
sudo grep -E '^(childbex_origin_ssl_|# TYPE childbex_origin_ssl_)' /var/lib/node_exporter/textfile_collector/childbex_origin_ssl.prom
```

**Stop on unexpected drift:** installer refuses overwrite of modified files and symlinked destinations. Any failed install requires examining systemd logs before retrying. The installer needs root to read restricted certs; it only writes its own metric, script, and service/timer. No app/ML/Keycloak/Postgres restart occurs.

Confirm metrics reach the shared Prometheus at `job="childbex-node"` **before** enabling alerts.

**Shared**, separately and only after checking the active rules location and ownership:

1. Obtain the exact **merged** `21-childbex-origin-ssl.yml` from Git (not a manually edited version). Compare target file; stop on drift. Never delete/replace other projects' alert rules.
2. Back up any existing target file outside Prometheus's rules directory.
3. `promtool check rules <staged-file>`.
4. Install **only** to `/etc/prometheus/rules/21-childbex-origin-ssl.yml` as root:root mode 0644.
5. `promtool check config /etc/prometheus/prometheus.yml`; reload Prometheus through the host's existing supported reload procedure.
6. Confirm `prometheus_config_last_reload_successful == 1`, metric presence, and alert rules in Prometheus; inspect Alertmanager routing for `severity: warning` and `severity: critical`.

The shared repository already owns central Blackbox rules in `prometheus/rules/60-blackbox.yml`. Don't edit them or duplicate edge alerts.

## Rollback

On ChildBEx, disable/stop only `childbex-origin-ssl-metrics.timer`, restore any preexisting managed files from a root-only backup (or remove newly added files), `systemctl daemon-reload`, and optionally remove only `childbex_origin_ssl.prom`. Do not touch the other textfile collector metrics or Certbot hooks.

On shared, restore only the project-specific `21-childbex-origin-ssl.yml` from its backup (or remove that one file), validate rules/config and reload Prometheus. Existing Blackbox monitoring remains intact.

## Verification caveat

`certbot renew --dry-run` tests DNS-01 renewal, not the monitoring collector. The collector checks file expiry and deployed auth parity. It does not prove that Nginx has reloaded a newer in-memory certificate: a future enhancement may probe Nginx's **origin TLS directly** with trusted SNI, independently of Cloudflare, if needed.
