# Runbook — Childbex Production Backups

Сервер: `childbex`

Призначення: production backup системи Childbex, включно з PostgreSQL, медичними DICOM-файлами, сирими завантаженими архівами та snapshot конфігурації сервера.

> **Важливо:** backup містить медичні дані. Не виводити назви/ідентифікатори пацієнтів у логи, діагностику або сторонні сервіси без потреби.

---

## Що резервується

Автоматично:

- PostgreSQL `app_childbex`
- PostgreSQL `keycloak_db`
- `.sha256` для кожного PostgreSQL dump
- `/srv/data/childbex/app/uploads` — production DICOM
- `/srv/data/childbex/app/archives` — raw archives

Вручну створюється:

- snapshot конфігурації production-сервера

Останній валідний config snapshot автоматично додається до наступного off-site backup.

Off-site repository:

```text
rclone:childbex-gdrive-custom:Childbex Production Backups/restic
```

Backup user:

```text
childbex-backup
```

Google OAuth:

```text
Google Cloud project: Childbex Backups
OAuth client: Childbex Backups rclone
Publishing status: In production
Scope: drive.file
```

---

## 1. Автоматичний розклад

```text
PostgreSQL backup       щодня близько 03:00, RandomizedDelaySec=5m
Off-site Restic backup  щодня близько 03:30, RandomizedDelaySec=5m
Restic repository check щонеділі близько 04:30, RandomizedDelaySec=5m
Backup metrics          кожні 5 хвилин
```

Перевірити:

```bash
systemctl list-timers --all --no-pager \
  | grep -E 'childbex-(postgres-backup|offsite-backup|offsite-backup-check|backup-metrics)'
```

---

## 2. Після зміни production-конфігурації

Після суттєвих змін Nginx, Keycloak, systemd, PostgreSQL, UFW, fail2ban, SSH, network, Tailscale, exporters, backup scripts, metrics, `/etc/fstab` або mounts створити новий config snapshot:

```bash
sudo /usr/local/sbin/childbex-config-snapshot
```

Файли з'являться тут:

```text
/srv/data/childbex/backups/config-snapshots/
```

Формат:

```text
childbex-config-snapshot-YYYY-MM-DD_HH-MM-SS.tar.gz
childbex-config-snapshot-YYYY-MM-DD_HH-MM-SS.tar.gz.sha256
```

За потреби одразу відправити off-site:

```bash
sudo systemctl start childbex-offsite-backup.service
```

---

## 3. Перевірити config snapshot

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

Очікувано:

```text
...tar.gz: OK
CONFIG SNAPSHOT OK
```

---

## 4. Що входить у config snapshot

Основні компоненти:

```text
Nginx:
  nginx.conf
  conf.d/*
  sites-available/app.childbex.com.conf
  sites-available/auth.childbex.com.conf
  sites-available/childbex.com.conf
  sites-available/default
  список sites-enabled symlink-ів

systemd:
  keycloak.service
  node_exporter.service
  postgres_exporter.service
  childbex-postgres-backup.service/.timer
  childbex-offsite-backup.service/.timer
  childbex-offsite-backup-check.service/.timer
  childbex-backup-metrics.service/.timer
  tailscaled.service
  node_exporter.service.d/*

PostgreSQL:
  postgresql.conf
  pg_hba.conf
  pg_ident.conf
  start.conf
  pg_ctl.conf
  conf.d/*

Security/network:
  sshd_config + sshd_config.d/*
  /etc/ufw/*
  custom/local fail2ban rules
  /etc/fstab
  redacted netplan
  redacted /etc/default/tailscaled

Monitoring/backup:
  redacted postgres_exporter env
  backup scripts
  backup metrics script

Diagnostics:
  hostname/OS
  mounts
  listening ports
  UFW/fail2ban/Tailscale status
  relevant units/timers
  failed units
```

---

## 5. Що НЕ повинно потрапити в config snapshot

Не копіюються секрети або state:

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
Keycloak db-password
```

Config snapshot може містити лише metadata/path/owner/permissions або redacted-версію.

Швидка перевірка:

```bash
sudo bash -Eeuo pipefail <<'EOS'
DIR='/srv/data/childbex/backups/config-snapshots'
SNAP="$(find "$DIR" -maxdepth 1 -type f -name 'childbex-config-snapshot-*.tar.gz' -printf '%T@ %p\n' | sort -nr | head -n1 | cut -d' ' -f2-)"
tar -tzf "$SNAP" \
  | grep -E '(^|/)rclone\.conf$|(^|/)restic-password$|(^|/)postgres_exporter\.env$|(^|/)var/lib/tailscale|auth\.childbex\.com\.key$|privkey\.pem$' \
  && { echo 'ERROR: forbidden file found'; exit 1; } \
  || echo 'NO FORBIDDEN FILES'
EOS
```

---

## 6. Локальний PostgreSQL backup

```text
Script:  /usr/local/sbin/childbex-postgres-backup
Service: /etc/systemd/system/childbex-postgres-backup.service
Timer:   /etc/systemd/system/childbex-postgres-backup.timer
Dir:     /srv/data/childbex/backups/postgres/
Retention: 14 days
```

Dump-и:

```text
app_childbex_YYYY-MM-DD_HH-MM-SS.dump
app_childbex_YYYY-MM-DD_HH-MM-SS.dump.sha256
keycloak_db_YYYY-MM-DD_HH-MM-SS.dump
keycloak_db_YYYY-MM-DD_HH-MM-SS.dump.sha256
```

Обидві БД повинні мати однаковий timestamp.

Ручний запуск:

```bash
sudo systemctl start childbex-postgres-backup.service
sudo systemctl status childbex-postgres-backup.service --no-pager
```

---

## 7. Примусово запустити off-site backup

```bash
sudo systemctl start childbex-offsite-backup.service
```

Перевірити:

```bash
sudo systemctl status childbex-offsite-backup.service --no-pager
```

або:

```bash
sudo journalctl -u childbex-offsite-backup.service --since '30 minutes ago' --no-pager
```

Успішний запуск:

```text
Childbex off-site backup completed successfully.
```

Якщо додано config snapshot:

```text
Including config snapshot: childbex-config-snapshot-....tar.gz
```

---

## 8. Перевірити Restic snapshots

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

В актуальному snapshot мають бути:

```text
/srv/data/childbex/app/uploads
/srv/data/childbex/app/archives
/srv/data/childbex/backups/postgres/app_childbex_*.dump
/srv/data/childbex/backups/postgres/app_childbex_*.dump.sha256
/srv/data/childbex/backups/postgres/keycloak_db_*.dump
/srv/data/childbex/backups/postgres/keycloak_db_*.dump.sha256
/srv/data/childbex/backups/config-snapshots/*.tar.gz      # якщо snapshot створювався
/srv/data/childbex/backups/config-snapshots/*.sha256     # якщо snapshot створювався
```

> `restic snapshots --latest 1` може показати більше одного запису при різних groups за paths. Для production history використовувати `snapshots --tag production`.

---

## 9. Retention policy

```text
7 daily
5 weekly
12 monthly
```

Критично:

```text
--group-by host,tags
```

Production:

```bash
restic -r "$RESTIC_REPOSITORY" forget \
  --tag production \
  --group-by host,tags \
  --keep-daily 7 \
  --keep-weekly 5 \
  --keep-monthly 12 \
  --prune
```

Перед ручним prune спочатку `--dry-run`:

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

---

## 10. Якщо off-site backup падає

```bash
sudo systemctl status childbex-offsite-backup.service --no-pager
```

```bash
sudo journalctl -u childbex-offsite-backup.service -n 100 --no-pager
```

Потім перевірити доступ до repository командою `restic snapshots` з пункту 8.

---

## 11. Якщо проблема з Google Drive OAuth

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
Project: Childbex Backups
Client: Childbex Backups rclone
Publishing status: In production
Scope: drive.file
```

> Через `drive.file` не видаляти і не створювати заново OAuth client без окремого плану міграції: інший OAuth app/client може не бачити файли, створені попереднім app.

Не виводити в чат/логи Client secret, OAuth token, `rclone.conf` або Restic password.

---

## 12. Якщо config snapshot відсутній або пошкоджений

Відсутність config snapshot **не повинна ламати** основний backup PostgreSQL/uploads/archives.

Можливі warnings:

```text
[WARN] No config snapshot found; continuing with production data backup only.
[WARN] Latest config snapshot checksum failed; omitting it from this off-site backup.
[WARN] Latest config snapshot has no SHA256 file; omitting it from this off-site backup.
```

Створити новий:

```bash
sudo /usr/local/sbin/childbex-config-snapshot
sudo systemctl start childbex-offsite-backup.service
```

---

## 13. Weekly Restic check

```text
Script:  /usr/local/sbin/childbex-offsite-backup-check
Service: /etc/systemd/system/childbex-offsite-backup-check.service
Timer:   /etc/systemd/system/childbex-offsite-backup-check.timer
```

Ручний запуск:

```bash
sudo systemctl start childbex-offsite-backup-check.service
sudo systemctl status childbex-offsite-backup-check.service --no-pager
```

Успішно:

```text
no errors were found
Childbex Restic repository check completed successfully.
```

---

## 14. Backup monitoring

```text
Metrics script: /usr/local/sbin/childbex-backup-metrics
Metrics file:   /var/lib/node_exporter/textfile_collector/childbex_backup.prom
Node drop-in:   /etc/systemd/system/node_exporter.service.d/textfile.conf
Node exporter:  100.117.155.53:9100
Prometheus job: childbex-node
```

Перевірити локально:

```bash
curl -s http://100.117.155.53:9100/metrics | grep '^childbex_backup_'
```

Метрики:

```text
childbex_backup_last_success_timestamp_seconds{backup="postgres"}
childbex_backup_last_success_timestamp_seconds{backup="offsite"}
childbex_backup_last_success_timestamp_seconds{backup="offsite_check"}
childbex_backup_last_run_success{backup="postgres"}
childbex_backup_last_run_success{backup="offsite"}
childbex_backup_last_run_success{backup="offsite_check"}
```

`last_run_success`: `1` = success, `0` = failed.

---

## 15. Prometheus alerts на shared

Rules:

```text
/etc/prometheus/rules/70-backups.yml
```

Alerts:

```text
ChildbexBackupFailed               == 0 for 5m, critical
ChildbexPostgresBackupStale        > 30h for 10m, critical
ChildbexOffsiteBackupStale         > 30h for 10m, critical
ChildbexOffsiteBackupCheckStale    > 8d for 10m, warning
ChildbexBackupMetricsMissing       absent for 10m, warning
```

Перевірити rules:

```bash
sudo promtool check rules /etc/prometheus/rules/70-backups.yml
```

Після зміни:

```bash
sudo systemctl reload prometheus
```

Перевірити, що Childbex alerts не активні:

```bash
curl -s 'http://127.0.0.1:9090/api/v1/query?query=ALERTS%7Balertname%3D~%22Childbex.%2A%22%7D' \
  | python3 -m json.tool
```

Нормально:

```json
"result": []
```

---

## 16. Основні файли

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

---

# 17. Restore drill

> **Ніколи не тестувати restore поверх production DB або production files.**

## 17.1. Створити isolated target

```bash
sudo install -d -o childbex-backup -g childbex-backups -m 0750 \
  /srv/data/childbex/backups/restore-drill
```

## 17.2. Відновити latest production snapshot

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

Restic відтворить paths під target:

```text
/srv/data/childbex/backups/restore-drill/srv/data/childbex/...
```

## 17.3. Перевірити DB checksum + catalog

```bash
sudo -u childbex-backup bash -Eeuo pipefail <<'EOS'
DIR='/srv/data/childbex/backups/restore-drill/srv/data/childbex/backups/postgres'
cd "$DIR"
for f in *.dump.sha256; do sha256sum -c "$f"; done
for f in "$DIR"/*.dump; do pg_restore --list "$f" >/dev/null; done
echo 'POSTGRES RESTORE FILES OK'
EOS
```

## 17.4. Перевірити config snapshot

```bash
sudo -u childbex-backup bash -Eeuo pipefail <<'EOS'
DIR='/srv/data/childbex/backups/restore-drill/srv/data/childbex/backups/config-snapshots'
cd "$DIR"
for f in childbex-config-snapshot-*.tar.gz.sha256; do sha256sum -c "$f"; done
for f in childbex-config-snapshot-*.tar.gz; do tar -tzf "$f" >/dev/null; done
echo 'CONFIG SNAPSHOT RESTORE OK'
EOS
```

## 17.5. Перевірити uploads/archives без patient filenames

Кількість + bytes:

```bash
sudo bash -Eeuo pipefail <<'EOS'
for d in uploads archives; do
  SRC="/srv/data/childbex/app/$d"
  DST="/srv/data/childbex/backups/restore-drill/srv/data/childbex/app/$d"
  echo "=== $d ==="
  printf 'SOURCE files='; find "$SRC" -type f | wc -l
  du -sb "$SRC"
  printf 'RESTORED files='; find "$DST" -type f | wc -l
  du -sb "$DST"
done
EOS
```

Byte-for-byte aggregate SHA256:

```bash
sudo bash -Eeuo pipefail <<'EOS'
for d in uploads archives; do
  SRC="/srv/data/childbex/app/$d"
  DST="/srv/data/childbex/backups/restore-drill/srv/data/childbex/app/$d"
  src_hash="$(cd "$SRC" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}')"
  dst_hash="$(cd "$DST" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}')"
  [[ "$src_hash" == "$dst_hash" ]] && echo "$d: CONTENT MATCH" || { echo "$d: CONTENT MISMATCH"; exit 1; }
done
EOS
```

## 17.6. Реально відновити DB у temporary databases

Test DB names:

```text
childbex_restore_drill
keycloak_restore_drill
```

Створити app test DB:

```bash
sudo -u postgres createdb --template=template0 --owner=childbex_admin childbex_restore_drill
```

Через права restore-dir скопіювати app dump у захищений temporary file:

```bash
sudo install -o postgres -g postgres -m 0600 \
  /srv/data/childbex/backups/restore-drill/srv/data/childbex/backups/postgres/app_childbex_TIMESTAMP.dump \
  /var/lib/postgresql/childbex_restore_drill_app.dump
```

Відновити:

```bash
sudo -u postgres pg_restore --exit-on-error \
  --dbname=childbex_restore_drill \
  /var/lib/postgresql/childbex_restore_drill_app.dump
```

Keycloak аналогічно:

```bash
sudo -u postgres createdb --template=template0 --owner=keycloak_admin keycloak_restore_drill
```

```bash
sudo install -o postgres -g postgres -m 0600 \
  /srv/data/childbex/backups/restore-drill/srv/data/childbex/backups/postgres/keycloak_db_TIMESTAMP.dump \
  /var/lib/postgresql/childbex_restore_drill_keycloak.dump
```

```bash
sudo -u postgres pg_restore --exit-on-error \
  --dbname=keycloak_restore_drill \
  /var/lib/postgresql/childbex_restore_drill_keycloak.dump
```

Порівняти кількість user tables:

```bash
sudo -u postgres bash -Eeuo pipefail <<'EOS'
for db in app_childbex childbex_restore_drill keycloak_db keycloak_restore_drill; do
  printf '%-28s ' "$db"
  psql -d "$db" -Atc "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema');"
done
EOS
```

Production/test для кожної БД мають збігатися.

Cleanup:

```bash
sudo -u postgres dropdb childbex_restore_drill
sudo -u postgres dropdb keycloak_restore_drill
sudo rm -f \
  /var/lib/postgresql/childbex_restore_drill_app.dump \
  /var/lib/postgresql/childbex_restore_drill_keycloak.dump
sudo rm -rf /srv/data/childbex/backups/restore-drill
```

---

# 18. Відкат production-конфігурації з config snapshot

> `childbex-config-snapshot` — це snapshot конфігурації, **не повний snapshot VM**.
>
> Він не відкочує PostgreSQL data, DICOM uploads, raw archives або secrets.
>
> **Не розпаковувати snapshot напряму в `/`.**

Redacted-файли не можна blindly копіювати поверх production:

```text
snapshot/keycloak/keycloak.conf.redacted
snapshot/network/*.redacted
snapshot/tailscale/tailscaled.default.redacted
snapshot/monitoring/postgres_exporter.env.redacted
```

## 18.1. Перед rollback зафіксувати поточний стан

```bash
sudo /usr/local/sbin/childbex-config-snapshot
```

## 18.2. Вибрати snapshot

```bash
sudo ls -lht /srv/data/childbex/backups/config-snapshots/
```

## 18.3. Перевірити checksum і розпакувати у `/tmp`

```bash
sudo bash -Eeuo pipefail <<'EOS'
SNAP='/srv/data/childbex/backups/config-snapshots/childbex-config-snapshot-YYYY-MM-DD_HH-MM-SS.tar.gz'
WORK='/tmp/childbex-config-rollback'
test -f "$SNAP"
test -f "${SNAP}.sha256"
cd "$(dirname "$SNAP")"
sha256sum -c "$(basename "${SNAP}.sha256")"
rm -rf "$WORK"
install -d -m 0700 "$WORK"
tar -xzf "$SNAP" -C "$WORK"
test -d "$WORK/snapshot"
printf '%s\n' "$WORK/snapshot" > "$WORK/SNAPSHOT_ROOT"
echo "Snapshot extracted to: $WORK/snapshot"
EOS
```

```bash
ROOT="$(sudo cat /tmp/childbex-config-rollback/SNAPSHOT_ROOT)"
printf '%s\n' "$ROOT"
```

Структура:

```text
$ROOT/nginx/
$ROOT/systemd/
$ROOT/keycloak/
$ROOT/postgresql/
$ROOT/ssh/
$ROOT/ufw/
$ROOT/fail2ban/
$ROOT/network/
$ROOT/tailscale/
$ROOT/monitoring/
$ROOT/backup/
$ROOT/metadata/
$ROOT/diagnostics/
```

## 18.4. Спочатку diff

```bash
sudo diff -u /etc/nginx/nginx.conf "$ROOT/nginx/nginx.conf" || true
```

```bash
sudo diff -u \
  /etc/nginx/sites-available/app.childbex.com.conf \
  "$ROOT/nginx/sites-available/app.childbex.com.conf" \
  || true
```

```bash
sudo diff -u \
  /etc/systemd/system/keycloak.service \
  "$ROOT/systemd/keycloak.service" \
  || true
```

## 18.5. Rollback конкретного Nginx файла

Backup current:

```bash
sudo cp -a \
  /etc/nginx/sites-available/app.childbex.com.conf \
  "/etc/nginx/sites-available/app.childbex.com.conf.pre-rollback-$(date +%Y%m%d-%H%M%S)"
```

Restore:

```bash
sudo cp -a \
  "$ROOT/nginx/sites-available/app.childbex.com.conf" \
  /etc/nginx/sites-available/app.childbex.com.conf
```

Validation:

```bash
sudo nginx -t
```

Лише якщо OK:

```bash
sudo systemctl reload nginx
```

## 18.6. Rollback systemd unit

Приклад Keycloak:

```bash
sudo cp -a \
  /etc/systemd/system/keycloak.service \
  "/etc/systemd/system/keycloak.service.pre-rollback-$(date +%Y%m%d-%H%M%S)"
```

```bash
sudo cp -a "$ROOT/systemd/keycloak.service" /etc/systemd/system/keycloak.service
sudo systemctl daemon-reload
sudo systemctl restart keycloak.service
systemctl status keycloak.service --no-pager
```

## 18.7. Keycloak/netplan/Tailscale/postgres_exporter redacted config

`keycloak.conf.redacted` містить `<redacted>` замість секретів. Його **не копіювати напряму** в `/opt/keycloak/conf/keycloak.conf`.

Так само не копіювати blindly:

```text
$ROOT/network/*.redacted
$ROOT/tailscale/tailscaled.default.redacted
$ROOT/monitoring/postgres_exporter.env.redacted
```

Використовувати їх як reference/diff і вручну повертати non-secret settings; secret values брати з окремого secret source.

## 18.8. Компоненти, які не можна відкочувати всліпу

```text
SSH
UFW
fail2ban
Netplan
/etc/fstab
PostgreSQL config
Tailscale
Keycloak config
```

SSH:

```bash
sudo /usr/sbin/sshd -t
```

Потім reload і перевірка другою SSH-сесією.

Netplan:

```bash
sudo netplan generate
sudo netplan try
```

`fstab`:

```bash
sudo findmnt --verify --verbose
```

PostgreSQL:

```bash
pg_lsclusters
```

---

## 19. Якщо config snapshot вже немає локально

Знайти snapshot у Restic:

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

Перевірити конкретний snapshot:

```bash
sudo -u childbex-backup env \
  HOME=/var/lib/childbex-backup \
  RCLONE_CONFIG=/var/lib/childbex-backup/rclone/rclone.conf \
  RESTIC_PASSWORD_FILE=/etc/childbex-backup/restic-password \
  restic \
    -r 'rclone:childbex-gdrive-custom:Childbex Production Backups/restic' \
    -o rclone.timeout=5m \
    ls SNAPSHOT_ID | grep 'config-snapshots'
```

Відновити потрібний `.tar.gz` і `.sha256` у temporary dir, а далі виконати процедуру з пункту 18.3.

---

# 20. Коротка emergency-процедура rollback config

```text
1. sudo /usr/local/sbin/childbex-config-snapshot
2. вибрати старий snapshot
3. перевірити .sha256
4. розпакувати у /tmp, НЕ у /
5. diff потрібного компонента
6. відновити ТІЛЬКИ потрібний файл
7. validation:
   nginx      -> sudo nginx -t
   ssh        -> sudo sshd -t
   netplan    -> sudo netplan try
   fstab      -> sudo findmnt --verify --verbose
   systemd    -> sudo systemctl daemon-reload
   PostgreSQL -> pg_lsclusters
8. reload/restart тільки потрібного service
9. перевірити production + systemctl --failed
10. після стабілізації створити новий childbex-config-snapshot
```

---

# 21. Фінальний health check backup-системи

На `childbex`:

```bash
systemctl --failed --no-pager
```

```bash
systemctl list-timers --all --no-pager \
  | grep -E 'childbex-(postgres-backup|offsite-backup|offsite-backup-check|backup-metrics)'
```

```bash
curl -s http://100.117.155.53:9100/metrics | grep '^childbex_backup_'
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

На `shared`:

```bash
curl -s 'http://127.0.0.1:9090/api/v1/query?query=ALERTS%7Balertname%3D~%22Childbex.%2A%22%7D' \
  | python3 -m json.tool
```

Очікувано:

```json
"result": []
```

Якщо все чисто — Childbex backup subsystem healthy.
