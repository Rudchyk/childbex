# ChildBEx Keycloak: stable release availability alert

Status: **proposed / Git-only**. This PR does **not** install, run or enable anything on production. Apply only after explicit review, preflight and operator approval.

Reference implementation: [shared-infrastructure PR #18](https://github.com/Rudchyk/shared-infrastructure/pull/18), proven manually against the shared Keycloak 26.8.1. This is an independent ChildBEx deployment; its application and ML services are out of scope.

## Ownership and boundaries

- **ChildBEx repo owns:** `ops/keycloak/release-check.py`, the two `ops/keycloak/childbex-keycloak-release-check.*` units, the dedicated installer, the project-specific `ops/prometheus/rules/76-childbex-keycloak-release.yml` and its guarded installer.
- **ChildBEx production host:** runs the release checker; existing Node Exporter textfile collector scrapes the new `childbex_keycloak_release.prom`. Do **not** change Keycloak, its database, Nginx, Tailscale, application, ML, backup service or exporter settings to install this.
- **Shared monitoring host:** existing central Prometheus scrapes `job="childbex-node"`. Install the dedicated alert rule on shared **only after** a successful scrape. Alertmanager routes existing `severity=warning,category=maintenance` to email with 24h repeat. Do not edit the shared `70-backups.yml` or other server-specific rules.
- **No auto-update:** any Keycloak upgrade requires separate compatibility review, backup, manual migration, validation and rollback plan. A newer major release is only a maintenance notification, not a command to upgrade immediately.

## Important unverified production assumptions

ChildBEx operational inventory remains in [Issue #8](https://github.com/Rudchyk/childbex/issues/8), and broader ops ownership in [Issue #9](https://github.com/Rudchyk/childbex/issues/9). Do **not** assume its actual Keycloak install matches shared server paths.

This implementation currently **requires**:
- `/opt/keycloak/current` is a symlink directly into `/opt/keycloak/releases/X.Y.Z`, with `bin/kc.sh` in that directory. The checker reads installed version from this symlink; it never launches Keycloak or accesses its DB.
- `node_exporter.service` is active with `--collector.textfile.directory=/var/lib/node_exporter/textfile_collector`. This path is suggested by [production backups runbook](backups.md); the installer refuses to proceed if the actual unit does not confirm it.
- existing shared Prometheus target `job="childbex-node"` is scraping those textfile metrics. The shared Prometheus installer explicitly verifies `check_success=1`.

**Read-only preflight on the ChildBEx host:**

```bash
readlink -f /opt/keycloak/current
systemctl is-active node_exporter.service
systemctl cat node_exporter.service | grep -- '--collector.textfile.directory='
stat -c '%a %U:%G %n' /var/lib/node_exporter/textfile_collector
systemctl list-timers --all 'childbex-keycloak-release-check*'
```

Do not paste secrets or dump unrelated systemd EnvironmentFiles. If the symlink path or collector differs, update and review this PR before installation. Do not create a new second exporter, overwrite existing collector settings, or change Keycloak layout merely to satisfy this implementation.

## Metrics

A root-owned isolated oneshot contacts the **official GitHub Keycloak release API**, reads at most 8 MB JSON for 50 releases (the shared monitor's original 1 MB cap was too small), ignores draft/prerelease/non-`X.Y.Z` releases and selects the numerically highest stable version. The network request times out after 15s. Six-hour timer is staggered from shared at 00:37, 06:37, 12:37, 18:37 local (+ 0–10m jitter).

Atomic write to `/var/lib/node_exporter/textfile_collector/childbex_keycloak_release.prom`:

```promql
keycloak_release_check_success{deployment="childbex"}
keycloak_release_check_timestamp_seconds{deployment="childbex"}
keycloak_release_update_available{deployment="childbex",installed_version="X.Y.Z",latest_version="X.Y.Z"}
```

On upstream failure: `check_success=0` and updated check-attempt timestamp, **no stale update-availability gauge**. This distinguishes failure to check from `update_available=0` (successfully checked; no update).

The four alerts are `ChildbexKeycloakUpdateAvailable`, `ChildbexKeycloakReleaseCheckFailed`, `ChildbexKeycloakReleaseCheckStale` (>9h) and `ChildbexKeycloakReleaseMetricsMissing` (absence). All match `job="childbex-node"` and `deployment="childbex"`, distinct from shared Keycloak. They use the existing nonurgent `warning,category=maintenance` routing.

## Offline validation (no server changes)

From a reviewed checkout on any system with Python 3 and Bash:

```bash
python3 -B ops/keycloak/release-check.py --self-test
bash -n ops/install/install-keycloak-release-monitor.sh
bash -n ops/install/install-keycloak-release-rules.sh
```

Self-test covers version ordering, exclusion of drafts/prereleases, responses over 1 MB, >8 MB rejection, update-available labels, and failure metrics. GitHub Actions Ops job also runs these tests. On shared, additionally validate the rule file with `promtool check rules ops/prometheus/rules/76-childbex-keycloak-release.yml`.

## Controlled rollout (separate approval and checkpoints)

**1. ChildBEx host — install only, no activation.** First inspect actual production paths above and make sure no destination already exists. After owner approval, on a verified ChildBEx checkout:

```bash
sudo bash ops/install/install-keycloak-release-monitor.sh
systemctl is-enabled childbex-keycloak-release-check.timer || true
systemctl is-active childbex-keycloak-release-check.timer || true
```

The dedicated installer validates the local symlink, active textfile exporter/collector flag and offline tests, refuses overwrites, installs exactly one executable and two systemd units, and executes `systemctl daemon-reload` only. It does not run a release check or enable the timer. The normal app/ML deployment does not include this installer.

**2. ChildBEx host — manually run once.** After installation:

```bash
sudo systemctl start childbex-keycloak-release-check.service
systemctl show childbex-keycloak-release-check.service -p Result -p ExecMainStatus -p ActiveState
sudo journalctl -u childbex-keycloak-release-check.service -n 15 --no-pager
sudo grep '^keycloak_release_' /var/lib/node_exporter/textfile_collector/childbex_keycloak_release.prom
```

A success must show `Result=success`, `ExecMainStatus=0`, `check_success=1`, and exactly one `update_available=0|1`. The installed version label must match the checked symlink. On failure **stop**; do not enable the timer or forge a success metric.

**3. Shared server — verify scrape, then install rules separately.** The shared monitoring host already scrapes ChildBEx via Tailscale. Before installing the rules, require exactly one current `keycloak_release_check_success{job="childbex-node",deployment="childbex"} == 1` metric in its Prometheus API. Use a reviewed ChildBEx checkout or a file-only `git archive` of the approved PR commit on the shared server. Then, with explicit approval:

```bash
sudo bash ops/install/install-keycloak-release-rules.sh
```

The guarded installer installs **only** `/etc/prometheus/rules/76-childbex-keycloak-release.yml` after checking the source rules, whole Prometheus configuration, and live success metric; it refuses overwrite, reloads **only Prometheus** and reverts that new file if validation/reload fails. No delete/rsync of other rule files.

Check `/api/v1/rules?type=alert` for all four rules with `health=ok`; account for the fact `ChildbexKeycloakUpdateAvailable` may genuinely be firing if ChildBEx still runs an older stable release. Do not mask it.

**4. ChildBEx host — enable schedule only after verified scrape and rules:**

```bash
sudo systemctl enable --now childbex-keycloak-release-check.timer
systemctl is-enabled childbex-keycloak-release-check.timer
systemctl is-active childbex-keycloak-release-check.timer
systemctl list-timers --all childbex-keycloak-release-check.timer
```

`Persistent=true` may trigger an immediate catch-up; inspect the oneshot result afterward. Verify first scheduled run the following day. On any release-check failure inspect its journal and GitHub API reachability; never restart Keycloak to fix a release-check failure.

**5. Email routing test, no fake update:** submit a short-lived synthetic `ChildbexKeycloakReleaseNotificationTest` (`severity=warning,category=maintenance,job=childbex-node,deployment=childbex`) to Alertmanager `/api/v2/alerts` with explicit `TEST` annotations and a 5-minute expiry, only after operator approval. Confirm the email actually arrives. Do not inject a false real `ChildbexKeycloakUpdateAvailable` alert. Shared Alertmanager maintenance transport has previously been tested for shared Keycloak, but ChildBEx routing should be independently verified.

## Acceptance criteria before marking complete

- [ ] Production Keycloak symlink and actual textfile collector verified with no drift.
- [ ] Checker tests and dedicated installer review completed.
- [ ] Manual stable-release API check succeeded and Node Exporter reported current/available versions accurately.
- [ ] Prometheus ingested the metric under `job=childbex-node` and four rules evaluated healthy.
- [ ] Actual warning/maintenance test email arrived.
- [ ] Six-hour timer enabled, next scheduled run displayed and first automatic run verified.
- [ ] No Keycloak, Nginx, PostgreSQL, app/ML, patient data, backups, secrets or shared non-ChildBEx alert rules changed.
