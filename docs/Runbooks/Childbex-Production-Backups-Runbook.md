# ChildBEx production backups runbook

Server: `childbex`

Purpose: operate, verify, restore, and troubleshoot the ChildBEx production backup system without exposing medical data or secrets.

> **Medical-data handling**
>
> Backups include DICOM and other production data. Do not copy patient identifiers, filenames that reveal patient identity, backup contents, tokens, passwords, or secret configuration into chats, issue bodies, CI logs, or third-party services.

## Source-of-truth status

This runbook describes **procedures and operational expectations**. It is not the source of truth for server configuration.

Current transitional state:

- until the ChildBEx `ops/` migration is complete, the live production server remains the effective source of truth for server-local scripts, units, and configuration;
- after the `ops/` migration, repository-managed files under `ops/` must become authoritative;
- secrets and runtime state remain outside Git;
- configuration snapshots are disaster-recovery/reference artifacts, not the primary configuration source.

When this runbook conflicts with the live server before the ops migration, stop and verify the live state rather than blindly applying commands from this document.

## Backup scope

Automatically protected:

- PostgreSQL database `app_childbex`
- PostgreSQL database `keycloak_db`
- SHA256 files for PostgreSQL dumps
- `/srv/data/childbex/app/uploads` — production DICOM
- `/srv/data/childbex/app/archives` — uploaded raw archives

Configuration snapshots are created separately and the latest valid snapshot may be included in the next off-site backup.

Off-site Restic repository:

```text
rclone:childbex-gdrive-custom:Childbex Production Backups/restic
```

Backup service account:

```text
childbex-backup
```

## Schedule

Expected schedule:

```text
PostgreSQL backup       daily around 03:00, RandomizedDelaySec=5m
Off-site Restic backup  daily around 03:30, RandomizedDelaySec=5m
Restic repository check weekly around 04:30 Sunday, RandomizedDelaySec=5m
Backup metrics          every 5 minutes
```

Verify actual production timers instead of relying on this document alone:

```bash
systemctl list-timers --all --no-pager \
  | grep -E 'childbex-(postgres-backup|offsite-backup|offsite-backup-check|backup-metrics)'
```

## Quick health check

Run on `childbex`:

```bash
systemctl --failed --no-pager
```

```bash
systemctl list-timers --all --no-pager \
  | grep -E 'childbex-(postgres-backup|offsite-backup|offsite-backup-check|backup-metrics)'
```

Check exported metrics:

```bash
curl -s http://100.117.155.53:9100/metrics \
  | grep '^childbex_backup_'
```

Run the repository check when required:

```bash
sudo systemctl start childbex-offsite-backup-check.service
sudo systemctl status childbex-offsite-backup-check.service --no-pager
```

Expected successful Restic check output includes:

```text
no errors were found
```

Central Prometheus alerts are owned by `shared-infrastructure`. From the shared server, verify ChildBEx backup alerts are not active:

```bash
curl -s 'http://127.0.0.1:9090/api/v1/query?query=ALERTS%7Balertname%3D~%22Childbex.%2A%22%7D' \
  | python3 -m json.tool
```

## Local PostgreSQL backup

Current production paths to verify during the ops audit:

```text
/usr/local/sbin/childbex-postgres-backup
/etc/systemd/system/childbex-postgres-backup.service
/etc/systemd/system/childbex-postgres-backup.timer
/srv/data/childbex/backups/postgres/
```

Expected local retention is 14 days.

Expected dump naming:

```text
app_childbex_YYYY-MM-DD_HH-MM-SS.dump
app_childbex_YYYY-MM-DD_HH-MM-SS.dump.sha256
keycloak_db_YYYY-MM-DD_HH-MM-SS.dump
keycloak_db_YYYY-MM-DD_HH-MM-SS.dump.sha256
```

Both database dumps from one run should share the same timestamp.

Manual run:

```bash
sudo systemctl start childbex-postgres-backup.service
sudo systemctl status childbex-postgres-backup.service --no-pager
```

## Off-site backup

Manual run:

```bash
sudo systemctl start childbex-offsite-backup.service
sudo systemctl status childbex-offsite-backup.service --no-pager
```

Inspect recent logs if it fails:

```bash
sudo journalctl -u childbex-offsite-backup.service -n 100 --no-pager
```

List production snapshots:

```bash
sudo -u childbex-backup env \
  HOME=/var/lib/childbex-backup \
  RCLONE_CONFIG=/var/lib/childbex-backup/rclone/rclone.conf \
  RESTIC_PASSWORD_FILE=/etc/childbex-backup/restic-password \
  restic \
    -r 'rclone:childbex-gdrive-custom:Childbex Production Backups/restic' \
    -o rclone.timeout=5m \
    snapshots --tag production
```

Expected production snapshot content includes:

```text
/srv/data/childbex/app/uploads
/srv/data/childbex/app/archives
/srv/data/childbex/backups/postgres/*.dump
/srv/data/childbex/backups/postgres/*.dump.sha256
```

A valid configuration snapshot may also be present.

## Retention

Expected Restic production retention:

```text
7 daily
5 weekly
12 monthly
grouped by host,tags
```

Never run a manual prune first. Review with `--dry-run`:

```bash
sudo -u childbex-backup env \
  HOME=/var/lib/childbex-backup \
  RCLONE_CONFIG=/var/lib/childbex-backup/rclone/rclone.conf \
  RESTIC_PASSWORD_FILE=/etc/childbex-backup/restic-password \
  restic \
    -r 'rclone:childbex-gdrive-custom:Childbex Production Backups/restic' \
    -o rclone.timeout=5m \
    forget \
    --tag production \
    --group-by host,tags \
    --keep-daily 7 \
    --keep-weekly 5 \
    --keep-monthly 12 \
    --dry-run
```

## Configuration snapshots

Current command:

```bash
sudo /usr/local/sbin/childbex-config-snapshot
```

Expected output directory:

```text
/srv/data/childbex/backups/config-snapshots/
```

Expected files:

```text
childbex-config-snapshot-YYYY-MM-DD_HH-MM-SS.tar.gz
childbex-config-snapshot-YYYY-MM-DD_HH-MM-SS.tar.gz.sha256
```

Verify the newest snapshot:

```bash
sudo bash -Eeuo pipefail <<'EOS'
DIR='/srv/data/childbex/backups/config-snapshots'
SNAP="$(find "$DIR" -maxdepth 1 -type f -name 'childbex-config-snapshot-*.tar.gz' -printf '%T@ %p\n' | sort -nr | head -n1 | cut -d' ' -f2-)"
test -n "$SNAP"
cd "$DIR"
sha256sum -c "$(basename "${SNAP}.sha256")"
tar -tzf "$SNAP" >/dev/null
echo 'CONFIG SNAPSHOT OK'
EOS
```

### Snapshot safety boundary

The snapshot must not contain live secret material or runtime identities.

Examples that must remain outside the snapshot as raw files:

```text
/srv/secrets/auth.childbex.com
/srv/secrets/childbex
/etc/childbex-backup/restic-password
/var/lib/childbex-backup/rclone/rclone.conf
/etc/postgres_exporter.env
/var/lib/tailscale
SSH private keys
SSH host private keys
TLS private keys
Let's Encrypt private key material
Google OAuth token
Keycloak database password
```

Redacted configuration may be retained for reference where appropriate.

Configuration snapshot contents and responsibilities must be reassessed after repository-owned `ops/` becomes authoritative.

## Google Drive OAuth / rclone

Current remote:

```text
childbex-gdrive-custom:
```

Reconnect only when necessary:

```bash
sudo -u childbex-backup \
  env HOME=/var/lib/childbex-backup \
      RCLONE_CONFIG=/var/lib/childbex-backup/rclone/rclone.conf \
  rclone config reconnect childbex-gdrive-custom:
```

Connectivity check:

```bash
sudo -u childbex-backup rclone lsd childbex-gdrive-custom: \
  --config /var/lib/childbex-backup/rclone/rclone.conf
```

Expected top-level directory:

```text
Childbex Production Backups
```

Current OAuth metadata:

```text
Google Cloud project: Childbex Backups
OAuth client: Childbex Backups rclone
Publishing status: In production
Scope: drive.file
```

Do not expose the client secret, OAuth token, `rclone.conf`, or Restic password.

Because the OAuth scope is `drive.file`, do not replace the OAuth application/client casually; a replacement client may not have access to files created by the previous application.

## Monitoring ownership

ChildBEx owns the production metric producer on the ChildBEx server.

Current paths to verify during the ops audit:

```text
/usr/local/sbin/childbex-backup-metrics
/var/lib/node_exporter/textfile_collector/childbex_backup.prom
/etc/systemd/system/node_exporter.service.d/textfile.conf
```

Expected metrics:

```text
childbex_backup_last_success_timestamp_seconds{backup="postgres"}
childbex_backup_last_success_timestamp_seconds{backup="offsite"}
childbex_backup_last_success_timestamp_seconds{backup="offsite_check"}
childbex_backup_last_run_success{backup="postgres"}
childbex_backup_last_run_success{backup="offsite"}
childbex_backup_last_run_success{backup="offsite_check"}
```

Central Prometheus backup alert policy remains owned by `Rudchyk/shared-infrastructure`, not by the ChildBEx repository.

## Restore drill

> **Never restore over production databases or production files during a drill.**

Create isolated target:

```bash
sudo install -d \
  -o childbex-backup \
  -g childbex-backups \
  -m 0750 \
  /srv/data/childbex/backups/restore-drill
```

Restore latest production snapshot:

```bash
sudo -u childbex-backup env \
  HOME=/var/lib/childbex-backup \
  RCLONE_CONFIG=/var/lib/childbex-backup/rclone/rclone.conf \
  RESTIC_PASSWORD_FILE=/etc/childbex-backup/restic-password \
  restic \
    -r 'rclone:childbex-gdrive-custom:Childbex Production Backups/restic' \
    -o rclone.timeout=5m \
    restore latest \
    --tag production \
    --target /srv/data/childbex/backups/restore-drill
```

Validate PostgreSQL backup files:

```bash
sudo -u childbex-backup bash -Eeuo pipefail <<'EOS'
DIR='/srv/data/childbex/backups/restore-drill/srv/data/childbex/backups/postgres'
cd "$DIR"
for f in *.dump.sha256; do sha256sum -c "$f"; done
for f in "$DIR"/*.dump; do pg_restore --list "$f" >/dev/null; done
echo 'POSTGRES RESTORE FILES OK'
EOS
```

For DICOM/uploads and archives, compare file counts, byte totals, and aggregate hashes without printing patient filenames.

For a full drill, restore dumps into temporary databases only:

```text
app_childbex -> childbex_restore_drill
keycloak_db  -> keycloak_restore_drill
```

Production databases must not be modified.

After the drill, remove temporary databases and restore files.

## Emergency configuration recovery

Configuration snapshots are reference/recovery artifacts, not full VM snapshots.

They do not restore:

```text
PostgreSQL data
DICOM uploads
raw archives
secrets
OAuth tokens
Restic password
TLS private keys
Tailscale identity
```

Never extract a configuration snapshot directly into `/`.

Recovery sequence:

1. If the server is still operational, capture the current state with a new config snapshot.
2. Verify the target snapshot SHA256.
3. Extract it into a temporary directory.
4. Diff only the component that needs recovery.
5. Restore only the required file/component.
6. Validate before reload/restart.
7. Verify production health.
8. Capture a new post-recovery snapshot.

Validation examples:

```text
Nginx      -> sudo nginx -t
SSH        -> sudo /usr/sbin/sshd -t
Netplan    -> sudo netplan try
fstab      -> sudo findmnt --verify --verbose
systemd    -> sudo systemctl daemon-reload
PostgreSQL -> pg_lsclusters
```

Do not blindly restore redacted Keycloak, network, Tailscale, exporter, SSH, firewall, PostgreSQL, or mount configuration.

After the `ops/` migration, normal recovery of repository-managed files should use Git + repository installers; config snapshots should remain only for explicitly defined disaster-recovery/reference purposes.

## Current operational paths to audit

These paths are **inventory hints, not repository truth**. Verify them against production during the ops audit:

```text
/usr/local/sbin/childbex-postgres-backup
/usr/local/sbin/childbex-config-snapshot
/usr/local/sbin/childbex-offsite-backup
/usr/local/sbin/childbex-offsite-backup-check
/usr/local/sbin/childbex-backup-metrics

/etc/systemd/system/childbex-postgres-backup.service
/etc/systemd/system/childbex-postgres-backup.timer
/etc/systemd/system/childbex-offsite-backup.service
/etc/systemd/system/childbex-offsite-backup.timer
/etc/systemd/system/childbex-offsite-backup-check.service
/etc/systemd/system/childbex-offsite-backup-check.timer
/etc/systemd/system/childbex-backup-metrics.service
/etc/systemd/system/childbex-backup-metrics.timer

/etc/childbex-backup/restic-password
/var/lib/childbex-backup/rclone/rclone.conf

/srv/data/childbex/backups/postgres/
/srv/data/childbex/backups/config-snapshots/
/srv/data/childbex/app/uploads
/srv/data/childbex/app/archives
```

Secret paths are listed only to define ownership boundaries. Their contents must never be committed.

## Follow-up

This runbook must be reviewed again after:

1. the production operational inventory is complete;
2. repository-owned `ops/` files and installers are established;
3. configuration snapshot responsibilities are reassessed.

At that point, replace transitional live-server path references with authoritative repository paths wherever possible.
