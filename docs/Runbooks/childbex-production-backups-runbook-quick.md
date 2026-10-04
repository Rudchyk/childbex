# Childbex production backups — quick runbook

Сервер: `childbex`

## Що робиться автоматично

Щодня резервуються:

- PostgreSQL `app_childbex`
- PostgreSQL `keycloak_db`
- `.sha256` для обох dump
- `/srv/data/childbex/app/uploads` — DICOM
- `/srv/data/childbex/app/archives` — raw archives

Off-site repository:

```text
rclone:childbex-gdrive-custom:Childbex Production Backups/restic
```

Retention:

```text
7 daily
5 weekly
12 monthly
--group-by host,tags
```

Розклад:

```text
PostgreSQL     ~03:00 daily
Off-site       ~03:30 daily
Restic check   ~04:30 Sunday
Metrics        every 5 minutes
```

---

## Після важливих змін production-конфігурації

```bash
sudo /usr/local/sbin/childbex-config-snapshot
```

Якщо потрібно одразу відправити snapshot off-site:

```bash
sudo systemctl start childbex-offsite-backup.service
```

Перевірити:

```bash
sudo journalctl \
  -u childbex-offsite-backup.service \
  --since '30 minutes ago' \
  --no-pager
```

Головне правило:

```text
змінив Nginx / Keycloak / systemd / PostgreSQL / UFW / fail2ban /
SSH / network / Tailscale / exporters / backup / metrics / fstab / mounts
→ створи childbex-config-snapshot
```

---

## Швидка перевірка backup system

```bash
systemctl --failed --no-pager
```

```bash
systemctl list-timers --all --no-pager \
  | grep -E 'childbex-(postgres-backup|offsite-backup|offsite-backup-check|backup-metrics)'
```

Restic snapshots:

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

Restic check:

```bash
sudo systemctl start childbex-offsite-backup-check.service
sudo systemctl status childbex-offsite-backup-check.service --no-pager
```

Очікувано:

```text
no errors were found
```

---

## Backup monitoring

Локально на `childbex`:

```bash
curl -s http://100.117.155.53:9100/metrics \
  | grep '^childbex_backup_'
```

Метрики:

```text
childbex_backup_last_success_timestamp_seconds
childbex_backup_last_run_success
```

На `shared` alerts:

```text
ChildbexBackupFailed
ChildbexPostgresBackupStale
ChildbexOffsiteBackupStale
ChildbexOffsiteBackupCheckStale
ChildbexBackupMetricsMissing
```

Перевірити, що alerts не активні:

```bash
curl -s 'http://127.0.0.1:9090/api/v1/query?query=ALERTS%7Balertname%3D~%22Childbex.%2A%22%7D' \
  | python3 -m json.tool
```

Нормально:

```json
"result": []
```

---

## Emergency rollback Childbex config

`childbex-config-snapshot` — **не snapshot усього сервера**.

Він не відкочує:

```text
PostgreSQL data
DICOM uploads
raw archives
secrets
OAuth token
Restic password
TLS private keys
Tailscale identity
```

1. Якщо сервер ще працездатний — спочатку зафіксувати поточний стан:

```bash
sudo /usr/local/sbin/childbex-config-snapshot
```

2. Вибрати snapshot:

```bash
sudo ls -lht /srv/data/childbex/backups/config-snapshots/
```

3. Перевірити `.sha256`.

4. Розпакувати snapshot у `/tmp` і зробити `diff` потрібного config-файла.

**Не робити:**

```bash
tar -xzf SNAPSHOT.tar.gz -C /
```

5. Відновити **лише потрібний файл/компонент**.

Validation:

```text
Nginx      -> sudo nginx -t
SSH        -> sudo sshd -t
Netplan    -> sudo netplan try
fstab      -> sudo findmnt --verify --verbose
systemd    -> sudo systemctl daemon-reload
PostgreSQL -> pg_lsclusters
```

6. Перевірити production:

```bash
systemctl --failed --no-pager
systemctl status nginx --no-pager
systemctl status keycloak.service --no-pager
curl -I https://childbex.com/
curl -I https://app.childbex.com/
curl -I https://auth.childbex.com/
```

7. Після стабілізації створити новий snapshot:

```bash
sudo /usr/local/sbin/childbex-config-snapshot
```

> `keycloak.conf.redacted`, netplan `.redacted`, `tailscaled.default.redacted` та `postgres_exporter.env.redacted` **не копіювати напряму поверх production**.

---

## Якщо проблема з Google OAuth

Remote:

```text
childbex-gdrive-custom:
```

Reconnect:

```bash
sudo -u childbex-backup \
  env HOME=/var/lib/childbex-backup \
      RCLONE_CONFIG=/var/lib/childbex-backup/rclone/rclone.conf \
  rclone config reconnect childbex-gdrive-custom:
```

Перевірити:

```bash
sudo -u childbex-backup rclone lsd childbex-gdrive-custom: \
  --config /var/lib/childbex-backup/rclone/rclone.conf
```

Має бути:

```text
Childbex Production Backups
```

OAuth app:

```text
Google Cloud project: Childbex Backups
OAuth client: Childbex Backups rclone
Publishing status: In production
Scope: drive.file
```

Не публікувати Client secret, OAuth token, `rclone.conf` або Restic password.

---

## Restore drill — коротко

Створити isolated target:

```bash
sudo install -d \
  -o childbex-backup \
  -g childbex-backups \
  -m 0750 \
  /srv/data/childbex/backups/restore-drill
```

Відновити latest production snapshot:

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

Перевірити:

```text
PostgreSQL dump SHA256
pg_restore --list
config snapshot SHA256
tar -tzf config snapshot
uploads file count + bytes
archives file count + bytes
aggregate SHA256 CONTENT MATCH
```

Для повного drill реально відновити:

```text
app_childbex -> childbex_restore_drill
keycloak_db  -> keycloak_restore_drill
```

Production DB при цьому не чіпати.

Після тесту cleanup:

```bash
sudo -u postgres dropdb childbex_restore_drill
sudo -u postgres dropdb keycloak_restore_drill
sudo rm -f \
  /var/lib/postgresql/childbex_restore_drill_app.dump \
  /var/lib/postgresql/childbex_restore_drill_keycloak.dump
sudo rm -rf /srv/data/childbex/backups/restore-drill
```

---

## Основні файли

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
