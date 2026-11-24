#!/usr/bin/env bash
# Moves the ChildBEx app metrics listener off the Tailscale address (Issue #24).
#
# Nginx listens on 127.0.0.1:9200 only; childbex-metrics-tailnet.socket
# (systemd, FreeBind) owns 100.117.155.53:9200 and forwards to it through
# systemd-socket-proxyd. Public Nginx then starts whether or not Tailscale has
# assigned its address.
#
# Opt-in: NOT called by install-production-deploy.sh.
#   --check     read-only preflight (drift, units, listeners, UFW); run with sudo
#               to see listener owners and UFW rules
#   --verify    read-only: the installed state is complete and working (root)
#   --install   root: back up, install units and the loopback vhost, hand port
#               9200 over to systemd; rolls back automatically on failure
#   --rollback [BACKUP_DIR]
#               root: stop the socket first, then restore the backed-up
#               Tailscale-bound vhost (latest backup by default)
#
# Never prints configuration contents, credentials or response bodies.
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODE="${1:---check}"
ROLLBACK_FROM="${2:-}"

# Tests only: every system path is placed under this directory and root and
# ownership checks are skipped. Production runs leave it unset.
ROOT="${CHILDBEX_METRICS_PROXY_ROOT:-}"
# Old Nginx workers keep the previous listening socket until they exit.
WAIT_SECONDS="${CHILDBEX_METRICS_PROXY_WAIT_SECONDS:-120}"
POLL_SECONDS="${CHILDBEX_METRICS_PROXY_POLL_SECONDS:-1}"

TAILNET_ADDR=100.117.155.53
SHARED_ADDR=100.78.90.38
LOOPBACK_ADDR=127.0.0.1
PORT=9200
PUBLIC_HOST=childbex.com
SOCKET=childbex-metrics-tailnet.socket
SERVICE=childbex-metrics-tailnet.service
NGINX_NAME=childbex-app-metrics.conf

SRC_NGINX="$REPO_ROOT/ops/nginx/conf.d/$NGINX_NAME"
LEGACY_NGINX="$REPO_ROOT/ops/nginx/legacy/childbex-app-metrics.tailnet.conf"
SRC_SOCKET="$REPO_ROOT/ops/systemd/$SOCKET"
SRC_SERVICE="$REPO_ROOT/ops/systemd/$SERVICE"

NGINX_DIR="$ROOT/etc/nginx"
DST_NGINX="$NGINX_DIR/conf.d/$NGINX_NAME"
UNIT_DIR="$ROOT/etc/systemd/system"
DST_SOCKET="$UNIT_DIR/$SOCKET"
DST_SERVICE="$UNIT_DIR/$SERVICE"
BACKUP_ROOT="$ROOT/var/backups/childbex/metrics-tailnet-proxy"
PROXYD="$ROOT/usr/lib/systemd/systemd-socket-proxyd"

case "$MODE" in
  --check|--verify|--install|--rollback) ;;
  *) echo "Usage: $0 [--check|--verify|--install|--rollback [BACKUP_DIR]]" >&2; exit 2 ;;
esac

if [[ -n "$ROOT" ]]; then
  [[ "$ROOT" == /* && "$ROOT" != / && -d "$ROOT" ]] || {
    echo "ERROR: CHILDBEX_METRICS_PROXY_ROOT must be an existing test directory" >&2; exit 2;
  }
fi

stop() { echo "STOP: $*" >&2; exit 1; }
warn() { echo "WARN: $*" >&2; }
is_root() { [[ -n "$ROOT" || $EUID -eq 0 ]]; }
require_root() { is_root || stop "$MODE requires root"; }

# --- File states -------------------------------------------------------------

# Nginx syntax without comments, indentation or blank lines.
normalize() {
  sed -e 's/#.*$//' -e 's/[[:space:]]\{1,\}/ /g' -e 's/^ //' -e 's/ $//' "$1" | grep -v '^$' || true
}

# legacy | installed | missing | drift | unsafe
nginx_state() {
  if [[ -L "$DST_NGINX" || ( -e "$DST_NGINX" && ! -f "$DST_NGINX" ) ]]; then
    echo unsafe
  elif [[ ! -e "$DST_NGINX" ]]; then
    echo missing
  elif cmp -s "$SRC_NGINX" "$DST_NGINX"; then
    echo installed
  elif [[ "$(normalize "$DST_NGINX")" == "$(normalize "$LEGACY_NGINX")" ]]; then
    echo legacy
  else
    echo drift
  fi
}

# installed | missing | drift | unsafe
unit_state() {
  local src="$1" dst="$2"
  if [[ -L "$dst" || ( -e "$dst" && ! -f "$dst" ) ]]; then
    echo unsafe
  elif [[ ! -e "$dst" ]]; then
    echo missing
  elif cmp -s "$src" "$dst"; then
    echo installed
  else
    echo drift
  fi
}

check_owner_mode() {
  local path="$1" perms
  [[ -n "$ROOT" ]] && return 0
  perms="$(stat -c '%a %U:%G' "$path")"
  [[ "$perms" == "644 root:root" ]] || stop "unexpected ownership/mode ($perms) on $path"
}

# --- Listeners on port 9200 --------------------------------------------------

# One "ADDRESS:PORT OWNER" line per listening TCP socket on $PORT ("?" when
# the owner is not visible, e.g. without root).
listeners() {
  local _state _recv _send local_addr _peer rest owner
  ss -H -l -t -n -p "sport = :$PORT" | while read -r _state _recv _send local_addr _peer rest; do
    owner="$(sed -n 's/.*users:(("\([^"]*\)".*/\1/p' <<<"$rest")"
    echo "$local_addr ${owner:-?}"
  done
}

owner_of() { listeners | awk -v a="$1:$PORT" '$1 == a { print $2; exit }'; }
tailnet_free() { [[ -z "$(owner_of "$TAILNET_ADDR")" ]]; }
nginx_on_loopback() { [[ "$(owner_of "$LOOPBACK_ADDR")" == nginx ]]; }
nginx_on_tailnet() { [[ "$(owner_of "$TAILNET_ADDR")" == nginx ]]; }
socket_on_tailnet() { [[ "$(owner_of "$TAILNET_ADDR")" == systemd ]]; }
socket_released() { ! socket_on_tailnet; }

# Only Nginx (old or new listener) and the systemd socket may use port 9200,
# and only on the two expected addresses.
check_listeners() {
  local addr owner failed=0 unknown=0
  while read -r addr owner; do
    [[ -n "$addr" ]] || continue
    case "$addr" in
      "$TAILNET_ADDR:$PORT")
        [[ "$owner" == nginx || "$owner" == systemd ]] || {
          [[ "$owner" == '?' ]] && unknown=1 || { echo "CONFLICT: $addr is held by '$owner'" >&2; failed=1; }
        } ;;
      "$LOOPBACK_ADDR:$PORT")
        [[ "$owner" == nginx ]] || {
          [[ "$owner" == '?' ]] && unknown=1 || { echo "CONFLICT: $addr is held by '$owner'" >&2; failed=1; }
        } ;;
      *) echo "CONFLICT: unexpected listener on $addr (${owner})" >&2; failed=1 ;;
    esac
  done < <(listeners)
  (( unknown == 0 )) || {
    [[ "$MODE" == --check ]] || stop "listener owners are not visible; run as root"
    warn "listener owners are not visible; run with sudo for a complete check"
  }
  (( failed == 0 )) || stop "port $PORT conflicts; review the listeners above"
}

# Other Nginx files must not listen on the tailnet address or port 9200.
check_other_nginx_files() {
  local found
  found="$(grep -rIlE \
    -e "^[[:space:]]*listen[[:space:]][^#;]*${TAILNET_ADDR//./\\.}" \
    -e "^[[:space:]]*listen([^#;]*[:[:space:]])?${PORT}([[:space:];]|$)" \
    "$NGINX_DIR" --exclude="$NGINX_NAME" 2>/dev/null || true)"
  [[ -z "$found" ]] || { echo "$found" >&2; stop "other Nginx files listen on $TAILNET_ADDR or port $PORT"; }
}

# --- UFW (read-only: this installer never changes firewall rules) ------------

ufw_rule_re="^${PORT}(/tcp)?[[:space:]]+on[[:space:]]+tailscale0[[:space:]]+ALLOW([[:space:]]+IN)?[[:space:]]+${SHARED_ADDR//./\\.}([[:space:]]|$)"

ufw_status() { ufw status 2>/dev/null; }

check_ufw() {
  local status
  if ! status="$(ufw_status)" || [[ -z "$status" ]]; then
    [[ "$MODE" == --check ]] && { warn "UFW status not readable; run with sudo"; return 0; }
    stop "UFW status not readable"
  fi
  grep -q '^Status: active' <<<"$status" || stop "UFW is not active"
  grep -Eq "$ufw_rule_re" <<<"$status" || stop "UFW rule '$PORT/tcp on tailscale0 from $SHARED_ADDR' is missing"
  # Any other ALLOW rule mentioning the port would broaden metrics access.
  if grep -E "(^|[^0-9])${PORT}([^0-9]|$).*ALLOW" <<<"$status" | grep -Evq "$ufw_rule_re"; then
    stop "another UFW rule allows port $PORT; review before installing"
  fi
  echo "OK: UFW allows $PORT/tcp on tailscale0 from $SHARED_ADDR only"
}

ufw_fingerprint() { ufw_status | cksum; }

# --- Units --------------------------------------------------------------------

check_units() {
  local state src dst
  for pair in "$SRC_SOCKET:$DST_SOCKET" "$SRC_SERVICE:$DST_SERVICE"; do
    src="${pair%%:*}"; dst="${pair#*:}"
    state="$(unit_state "$src" "$dst")"
    case "$state" in
      installed) check_owner_mode "$dst"; echo "OK: $dst matches Git" ;;
      missing) [[ "$MODE" == --verify ]] && stop "missing $dst"; echo "PENDING: $dst is not installed" ;;
      *) stop "$dst is $state; review drift before installing" ;;
    esac
  done
  # Drop-ins could override the address, FreeBind or the IP filters.
  local dropins
  dropins="$(systemctl show -p DropInPaths --value "$SOCKET" "$SERVICE" 2>/dev/null | tr -d '[:space:]')"
  [[ -z "$dropins" ]] || stop "drop-ins exist for $SOCKET or $SERVICE; review them first"
  [[ "$(systemctl show -p LoadState --value nginx.service)" == loaded ]] || stop "nginx.service is not loaded"
}

check_sources() {
  local f
  for f in "$SRC_NGINX" "$LEGACY_NGINX" "$SRC_SOCKET" "$SRC_SERVICE"; do
    [[ -f "$f" ]] || stop "missing repository file $f"
  done
  for cmd in systemctl nginx ss curl cmp install; do
    command -v "$cmd" >/dev/null || stop "required command '$cmd' is not available"
  done
  [[ -x "$PROXYD" ]] || stop "systemd-socket-proxyd is not installed at $PROXYD"
  if command -v systemd-analyze >/dev/null; then
    systemd-analyze verify --man=no "$SRC_SOCKET" "$SRC_SERVICE" >/dev/null \
      || stop "systemd-analyze rejects the repository units"
  else
    warn "systemd-analyze not available; unit syntax not verified"
  fi
}

# --- HTTP probes (status codes only) ------------------------------------------

http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time "${2:-10}" "${@:3}" "$1" || true; }

# Loopback health probe of the public site: status only (-k: the request is
# to 127.0.0.1, certificate checks are not the point here).
public_ok() {
  [[ "$(http_code "https://$PUBLIC_HOST/" 10 -k --resolve "$PUBLIC_HOST:443:127.0.0.1")" == 200 ]]
}
# Anonymous request: the backend must answer 401 through the chain.
metrics_unauthorized_at() { [[ "$(http_code "http://$1:$PORT/metrics" 10)" == 401 ]]; }

wait_for() {
  local description="$1"; shift
  local deadline=$((SECONDS + WAIT_SECONDS))
  until "$@"; do
    (( SECONDS < deadline )) || { echo "TIMEOUT: $description after ${WAIT_SECONDS}s" >&2; return 1; }
    sleep "$POLL_SECONDS"
  done
}

# --- Preflight ----------------------------------------------------------------

preflight() {
  check_sources
  STATE="$(nginx_state)"
  case "$STATE" in
    legacy) echo "OK: $DST_NGINX is the expected Tailscale-bound legacy configuration" ;;
    installed) check_owner_mode "$DST_NGINX"; echo "OK: $DST_NGINX matches Git (loopback)" ;;
    missing) stop "$DST_NGINX is missing; expected the legacy or repository version" ;;
    *) stop "$DST_NGINX is $STATE (neither the legacy nor the repository version); review drift" ;;
  esac
  check_other_nginx_files
  check_units
  check_listeners
  check_ufw
}

# --- Verify -------------------------------------------------------------------

verify_installed() {
  [[ "$(nginx_state)" == installed ]] || stop "$DST_NGINX does not match Git"
  [[ "$(unit_state "$SRC_SOCKET" "$DST_SOCKET")" == installed ]] || stop "$SOCKET not installed"
  [[ "$(unit_state "$SRC_SERVICE" "$DST_SERVICE")" == installed ]] || stop "$SERVICE not installed"
  systemctl is-active --quiet nginx.service || stop "nginx.service is not active"
  [[ "$(systemctl is-enabled "$SOCKET" 2>/dev/null)" == enabled ]] || stop "$SOCKET is not enabled"
  systemctl is-active --quiet "$SOCKET" || stop "$SOCKET is not active"

  # Effective (loaded) socket settings, not only the file on disk.
  [[ "$(systemctl show -p FreeBind --value "$SOCKET")" == yes ]] || stop "FreeBind is not effective"
  [[ "$(systemctl show -p Accept --value "$SOCKET")" == no ]] || stop "Accept is not 'no'"
  [[ "$(systemctl show -p Listen --value "$SOCKET")" == "$TAILNET_ADDR:$PORT (Stream)" ]] \
    || stop "the socket does not listen on exactly $TAILNET_ADDR:$PORT"
  [[ "$(systemctl show -p IPAddressAllow --value "$SOCKET")" == "$SHARED_ADDR/32" ]] \
    || stop "IPAddressAllow is not exactly $SHARED_ADDR/32"
  grep -q '0\.0\.0\.0/0' <<<"$(systemctl show -p IPAddressDeny --value "$SOCKET")" \
    || stop "IPAddressDeny does not deny all"

  nginx_on_loopback || stop "Nginx does not listen on $LOOPBACK_ADDR:$PORT"
  socket_on_tailnet || stop "systemd does not hold $TAILNET_ADDR:$PORT"
  check_listeners
  nginx -t -q || stop "nginx -t failed"
  public_ok || stop "public site check (https://$PUBLIC_HOST/ via loopback) is not HTTP 200"
  metrics_unauthorized_at "$LOOPBACK_ADDR" || stop "anonymous loopback metrics request is not HTTP 401"
  # From this host the source is not $SHARED_ADDR: the socket filter must drop it.
  [[ "$(http_code "http://$TAILNET_ADDR:$PORT/metrics" 3)" == 000 ]] \
    || stop "the tailnet socket answered a non-allowed source; IP filtering is not effective"
  check_ufw
  echo "VERIFIED: Nginx on $LOOPBACK_ADDR:$PORT, systemd socket on $TAILNET_ADDR:$PORT (allow $SHARED_ADDR)"
}

# --- Writes ---------------------------------------------------------------------

# Atomic replacement: a temporary file in the destination directory (a name
# no include glob matches), then rename.
install_atomic() {
  local src="$1" dst="$2" tmp
  tmp="$(dirname "$dst")/.$(basename "$dst").childbex-tmp.$$"
  if [[ -n "$ROOT" ]]; then
    install -m 0644 "$src" "$tmp"
  else
    install -o root -g root -m 0644 "$src" "$tmp"
  fi
  mv -f "$tmp" "$dst"
}

create_backup() {
  BACKUP_DIR="$BACKUP_ROOT/$(date -u +%Y%m%dT%H%M%SZ)"
  if [[ -n "$ROOT" ]]; then
    mkdir -p "$BACKUP_DIR"
  else
    install -d -o root -g root -m 0700 "$BACKUP_DIR"
  fi
  cp -p "$DST_NGINX" "$BACKUP_DIR/$NGINX_NAME"
  cmp -s "$DST_NGINX" "$BACKUP_DIR/$NGINX_NAME" || stop "backup copy differs from the original"
  echo "BACKUP: $BACKUP_DIR/$NGINX_NAME"
}

latest_backup() {
  local dir
  dir="$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | tail -n 1)"
  [[ -n "$dir" ]] && echo "$dir"
}

remove_units_if_ours() {
  local src dst
  for pair in "$SRC_SOCKET:$DST_SOCKET" "$SRC_SERVICE:$DST_SERVICE"; do
    src="${pair%%:*}"; dst="${pair#*:}"
    if [[ "$(unit_state "$src" "$dst")" == installed ]]; then
      rm -f -- "$dst"
    elif [[ -e "$dst" ]]; then
      warn "$dst differs from Git; left in place"
    fi
  done
  systemctl daemon-reload
}

# Stops the socket BEFORE Nginx takes the tailnet address back, restores the
# backed-up vhost and reloads Nginx. If the restored vhost fails `nginx -t`
# (e.g. Tailscale has no address yet), the loopback vhost is put back and the
# socket restarted: Nginx is never left with a configuration that fails.
restore_legacy() {
  local backup="$1" reason="$2"
  echo "ROLLBACK: $reason" >&2
  [[ -f "$backup/$NGINX_NAME" ]] || stop "backup $backup/$NGINX_NAME not found"
  [[ "$(normalize "$backup/$NGINX_NAME")" == "$(normalize "$LEGACY_NGINX")" ]] \
    || stop "backup $backup is not the expected legacy configuration"

  systemctl disable --now "$SOCKET" >/dev/null 2>&1 || true
  systemctl stop "$SERVICE" >/dev/null 2>&1 || true
  if nginx_on_loopback; then
    # Running Nginx already uses the loopback vhost: the tailnet address must
    # be completely free (socket stopped, old workers exited) to bind again.
    wait_for "release of $TAILNET_ADDR:$PORT" tailnet_free \
      || stop "ROLLBACK FAILED: $TAILNET_ADDR:$PORT is still held; Nginx left on the loopback configuration"
  else
    # Not reloaded yet: the running Nginx still owns the legacy listener.
    wait_for "release of $TAILNET_ADDR:$PORT by the socket" socket_released \
      || stop "ROLLBACK FAILED: the socket still holds $TAILNET_ADDR:$PORT"
  fi

  install_atomic "$backup/$NGINX_NAME" "$DST_NGINX"
  if ! nginx -t -q; then
    install_atomic "$SRC_NGINX" "$DST_NGINX"
    systemctl enable --now "$SOCKET" >/dev/null 2>&1 || true
    stop "ROLLBACK FAILED: the restored vhost fails nginx -t (Tailscale address missing?); loopback configuration and socket kept"
  fi
  systemctl reload nginx.service || stop "ROLLBACK FAILED: nginx reload failed"
  wait_for "Nginx listening on $TAILNET_ADDR:$PORT" nginx_on_tailnet \
    || stop "ROLLBACK INCOMPLETE: Nginx does not listen on $TAILNET_ADDR:$PORT"
  remove_units_if_ours
  public_ok || warn "public site check is not HTTP 200 after rollback; investigate"
  echo "ROLLED BACK: Nginx serves $TAILNET_ADDR:$PORT again from $backup"
}

install_mode() {
  require_root
  preflight
  systemctl is-active --quiet nginx.service || stop "nginx.service is not active"
  public_ok || stop "public site check is not HTTP 200 before installing"
  local before_ufw
  before_ufw="$(ufw_fingerprint)"

  BACKUP_DIR=""
  if [[ "$STATE" == legacy ]]; then
    nginx_on_tailnet || stop "Nginx does not hold the legacy listener $TAILNET_ADDR:$PORT"
    nginx_on_loopback && stop "$LOOPBACK_ADDR:$PORT is already in use"
    metrics_unauthorized_at "$TAILNET_ADDR" || stop "baseline: anonymous metrics request is not HTTP 401"
    create_backup

    [[ -e "$DST_SOCKET" ]] || install_atomic "$SRC_SOCKET" "$DST_SOCKET"
    [[ -e "$DST_SERVICE" ]] || install_atomic "$SRC_SERVICE" "$DST_SERVICE"
    systemctl daemon-reload
    install_atomic "$SRC_NGINX" "$DST_NGINX"
    echo "INSTALLED FILES: $DST_NGINX, $DST_SOCKET, $DST_SERVICE"

    nginx -t -q || { restore_legacy "$BACKUP_DIR" "nginx -t failed for the loopback vhost"; exit 1; }
    systemctl reload nginx.service || { restore_legacy "$BACKUP_DIR" "nginx reload failed"; exit 1; }
    wait_for "Nginx listening on $LOOPBACK_ADDR:$PORT" nginx_on_loopback \
      || { restore_legacy "$BACKUP_DIR" "Nginx did not take $LOOPBACK_ADDR:$PORT"; exit 1; }
    public_ok || { restore_legacy "$BACKUP_DIR" "public site check failed after reload"; exit 1; }
    metrics_unauthorized_at "$LOOPBACK_ADDR" \
      || { restore_legacy "$BACKUP_DIR" "loopback metrics did not answer 401"; exit 1; }
  else
    BACKUP_DIR="$(latest_backup || true)"
    [[ -n "$BACKUP_DIR" ]] || warn "no backup found under $BACKUP_ROOT; automatic rollback unavailable"
    for pair in "$SRC_SOCKET:$DST_SOCKET" "$SRC_SERVICE:$DST_SERVICE"; do
      [[ -e "${pair#*:}" ]] || install_atomic "${pair%%:*}" "${pair#*:}"
    done
    systemctl daemon-reload
    nginx_on_loopback || stop "Nginx does not listen on $LOOPBACK_ADDR:$PORT"
  fi

  # Handover: old Nginx workers may still hold the tailnet socket after the
  # graceful reload. Never assume it is free: wait, and stop safely if not.
  if ! socket_on_tailnet; then
    if ! wait_for "old Nginx workers releasing $TAILNET_ADDR:$PORT" tailnet_free; then
      echo "PENDING: public Nginx is healthy on the loopback configuration; metrics over" \
        "Tailscale stay unavailable until old workers exit. Re-run --install to finish," \
        "or --rollback." >&2
      exit 3
    fi
    systemctl enable "$SOCKET" >/dev/null 2>&1 \
      || { [[ -n "$BACKUP_DIR" ]] && restore_legacy "$BACKUP_DIR" "enabling $SOCKET failed"; exit 1; }
    systemctl start "$SOCKET" \
      || { [[ -n "$BACKUP_DIR" ]] && restore_legacy "$BACKUP_DIR" "starting $SOCKET failed"; exit 1; }
    wait_for "$SOCKET listening on $TAILNET_ADDR:$PORT" socket_on_tailnet \
      || { [[ -n "$BACKUP_DIR" ]] && restore_legacy "$BACKUP_DIR" "$SOCKET did not listen"; exit 1; }
  fi

  if ! (verify_installed); then
    [[ -n "$BACKUP_DIR" ]] && restore_legacy "$BACKUP_DIR" "post-install verification failed"
    exit 1
  fi
  [[ "$(ufw_fingerprint)" == "$before_ufw" ]] || warn "UFW rules changed during the install (not by this installer); review"
  echo "INSTALLED: metrics tailnet socket active; Nginx is no longer bound to a Tailscale address"
}

rollback_mode() {
  require_root
  check_sources
  local backup="${ROLLBACK_FROM:-$(latest_backup || true)}"
  [[ -n "$backup" ]] || stop "no backup found under $BACKUP_ROOT"
  case "$(nginx_state)" in
    installed) ;;
    legacy)
      systemctl is-active --quiet "$SOCKET" && stop "$SOCKET is active although the vhost is legacy; review manually"
      echo "OK: already on the legacy configuration"; remove_units_if_ours; exit 0 ;;
    *) stop "$DST_NGINX is neither the repository nor the legacy version; review drift" ;;
  esac
  restore_legacy "$backup" "requested by operator"
}

case "$MODE" in
  --check)
    preflight
    echo "CHECKED: state '$STATE'; no changes made" ;;
  --verify)
    require_root
    check_sources
    verify_installed ;;
  --install) install_mode ;;
  --rollback) rollback_mode ;;
esac
