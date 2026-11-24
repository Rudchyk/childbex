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
# Any failure not handled explicitly: say so instead of exiting silently.
trap 'echo "ERROR: unexpected failure at line $LINENO; production state may be partial. Run --check, then --verify or --rollback." >&2' ERR
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
    # ss may list multiple processes holding one socket after the first
    # scrape: systemd-socket-proxyd inherits the listening fd from PID 1
    # and can appear BEFORE systemd. Inspect every owner, not just the first.
    owner="$(grep -oE '\("[^"]+",pid=' <<<"$rest" | sed -E 's/^\("([^"]+)",pid=$/\1/' | LC_ALL=C sort -u | paste -sd, - || true)"
    # Allow only the expected pair, including a Linux-truncated comm name.
    # Unknown/extra co-owners must still fail the normal conflict checks.
    if [[ "$owner" =~ ^systemd,systemd-socket-[A-Za-z0-9_-]*$ ]]; then
      owner=systemd
    fi
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

ufw_status() { ufw status verbose 2>/dev/null; }

# "9200/tcp", "9200", "80,443/tcp", "9000:9300/tcp"
ufw_is_port() { [[ "$1" =~ ^[0-9]+([,:][0-9]+)*(/(tcp|udp))?$ ]]; }
# "Anywhere", an IPv4 or IPv6 address or network
ufw_is_addr() { [[ "$1" == Anywhere || "$1" =~ ^[0-9.]+(/[0-9]+)?$ || "$1" =~ ^[0-9a-fA-F:]*:[0-9a-fA-F:]*(/[0-9]+)?$ ]]; }

# Whether a UFW port spec (single, list or range; tcp or any) includes $PORT/tcp.
ufw_port_covers() {
  local spec="$1" item low high
  [[ "$spec" == */udp ]] && return 1
  local -a items
  IFS=, read -r -a items <<<"${spec%%/*}"
  for item in "${items[@]}"; do
    if [[ "$item" == *:* ]]; then
      low="${item%%:*}"; high="${item#*:}"
      (( low <= PORT && PORT <= high )) && return 0
    elif (( item == PORT )); then
      return 0
    fi
  done
  return 1
}

# Classifies one UFW rule line: approved | conflict | other | profile | ignore.
# Approved is exactly the production rule, destination-qualified:
#   100.117.155.53 9200/tcp on tailscale0   ALLOW IN   100.78.90.38
# A conflict is any other incoming ALLOW/LIMIT rule that can reach port 9200:
# an explicit port, list or range including it, or no port at all (all
# ports), whatever its destination, interface or source.
ufw_rule_class() {
  local line="${1%%#*}" to action direction from iface="" v6=0 dest="" port=""
  local re='^(.*[^[:space:]])[[:space:]]+(ALLOW|DENY|REJECT|LIMIT)([[:space:]]+(IN|OUT|FWD))?[[:space:]]+(.*[^[:space:]])[[:space:]]*$'
  [[ "$line" =~ $re ]] || { echo ignore; return; }
  to="${BASH_REMATCH[1]}"; action="${BASH_REMATCH[2]}"
  direction="${BASH_REMATCH[4]:-IN}"; from="${BASH_REMATCH[5]}"
  [[ "$action" == ALLOW || "$action" == LIMIT ]] && [[ "$direction" == IN ]] || { echo ignore; return; }
  [[ "$to" == *"(v6)"* ]] && v6=1
  to="${to//(v6)/}"; from="${from//(v6)/}"
  if [[ "$to" =~ ^(.*[^[:space:]])[[:space:]]+on[[:space:]]+([^[:space:]]+)[[:space:]]*$ ]]; then
    to="${BASH_REMATCH[1]}"; iface="${BASH_REMATCH[2]}"
  fi
  read -r from _ <<<"$from"
  local -a parts
  read -r -a parts <<<"$to"
  if (( ${#parts[@]} == 2 )) && ufw_is_addr "${parts[0]}" && ufw_is_port "${parts[1]}"; then
    dest="${parts[0]}"; port="${parts[1]}"
  elif (( ${#parts[@]} == 1 )) && ufw_is_port "${parts[0]}"; then
    port="${parts[0]}"
  elif (( ${#parts[@]} == 1 )) && ufw_is_addr "${parts[0]}"; then
    dest="${parts[0]}"
  else
    echo profile; return   # an application profile name (e.g. "Nginx Full")
  fi
  if (( v6 == 0 )) && [[ "$dest" == "$TAILNET_ADDR" && "$port" == "$PORT/tcp" \
    && "$iface" == tailscale0 && "$from" == "$SHARED_ADDR" && "$action" == ALLOW ]]; then
    echo approved
  elif [[ -z "$port" ]] || ufw_port_covers "$port"; then
    echo conflict
  else
    echo other
  fi
}

check_ufw() {
  local status line approved=0 conflicts=0
  if ! status="$(ufw_status)" || [[ -z "$status" ]]; then
    [[ "$MODE" == --check ]] && { warn "UFW status not readable; run with sudo"; return 0; }
    stop "UFW status not readable"
  fi
  grep -q '^Status: active' <<<"$status" || stop "UFW is not active"
  grep -Eq '^Default: deny \(incoming\)' <<<"$status" || stop "UFW default incoming policy is not deny"
  while IFS= read -r line; do
    [[ -n "${line//[[:space:]]/}" ]] || continue
    case "$(ufw_rule_class "$line")" in
      approved) approved=$((approved + 1)) ;;
      conflict) echo "CONFLICT: UFW rule can allow port $PORT: $line" >&2; conflicts=$((conflicts + 1)) ;;
      profile) warn "UFW application-profile rule not evaluated for port $PORT: $line" ;;
    esac
  done < <(sed '1,/^--/d' <<<"$status")
  (( conflicts == 0 )) || stop "UFW rules other than the approved one can reach port $PORT; review before installing"
  (( approved == 1 )) || stop "expected exactly one UFW rule '$TAILNET_ADDR $PORT/tcp on tailscale0 ALLOW IN $SHARED_ADDR' (found $approved)"
  echo "OK: UFW allows $TAILNET_ADDR $PORT/tcp on tailscale0 from $SHARED_ADDR only"
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

# Direct requests only (--noproxy '*': environment proxies are ignored). The
# body goes to /dev/null; only the status code (and the peer address) is used.
http_code() {
  curl -s -o /dev/null --noproxy '*' -w '%{http_code}' --max-time "${2:-10}" "${@:3}" "$1" || true
}

# Health probe of the public site on the local Nginx: --resolve pins the
# connection to 127.0.0.1:443, and the peer address reported by curl proves
# it got there. -k: certificate checks are not the point of this probe.
public_ok() {
  local result
  result="$(curl -s -o /dev/null --noproxy '*' -k --max-time 10 \
    --resolve "$PUBLIC_HOST:443:127.0.0.1" -w '%{http_code} %{remote_ip}' \
    "https://$PUBLIC_HOST/" || true)"
  [[ "$result" == "200 127.0.0.1" ]]
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

EXPECTED_ARGV="/usr/lib/systemd/systemd-socket-proxyd --exit-idle-time=5min --connections-max=16 $LOOPBACK_ADDR:$PORT"

verify_effective_unit() {
  local unit="$1" src="$2" dst="$3" fragment dropins body
  dropins="$(systemctl show -p DropInPaths --value "$unit" | tr -d '[:space:]')"
  [[ -z "$dropins" ]] || stop "$unit has drop-ins; they may override the repository unit"
  fragment="$(systemctl show -p FragmentPath --value "$unit")"
  [[ "$ROOT$fragment" == "$dst" ]] || stop "$unit is loaded from '$fragment', not $dst"
  [[ "$(systemctl show -p NeedDaemonReload --value "$unit")" == no ]] \
    || stop "$unit changed on disk since the last daemon-reload"
  # `systemctl cat` prints "# <path>" and then the file; drop-ins would follow.
  body="$(systemctl cat "$unit" 2>/dev/null | tail -n +2)"
  [[ "$body" == "$(cat "$src")" ]] || stop "the loaded $unit differs from Git"
}

verify_installed() {
  [[ "$(nginx_state)" == installed ]] || stop "$DST_NGINX does not match Git"
  [[ "$(unit_state "$SRC_SOCKET" "$DST_SOCKET")" == installed ]] || stop "$SOCKET not installed"
  [[ "$(unit_state "$SRC_SERVICE" "$DST_SERVICE")" == installed ]] || stop "$SERVICE not installed"
  systemctl is-active --quiet nginx.service || stop "nginx.service is not active"
  [[ "$(systemctl is-enabled "$SOCKET" 2>/dev/null)" == enabled ]] || stop "$SOCKET is not enabled"
  systemctl is-active --quiet "$SOCKET" || stop "$SOCKET is not active"

  # Effective (loaded) units, not only the files on disk: no drop-ins, no
  # other fragment taking precedence (e.g. /run/systemd/system), loaded
  # content identical to Git, no pending daemon-reload.
  verify_effective_unit "$SOCKET" "$SRC_SOCKET" "$DST_SOCKET"
  verify_effective_unit "$SERVICE" "$SRC_SERVICE" "$DST_SERVICE"
  # The forwarder command as systemd will run it (`systemctl show` ExecStart
  # format: "{ path=... ; argv[]=... ; ... }").
  local exec_start argv
  exec_start="$(systemctl show -p ExecStart --value "$SERVICE")"
  [[ "$(grep -o 'argv\[\]=' <<<"$exec_start" | wc -l)" -eq 1 ]] || stop "$SERVICE must have exactly one ExecStart"
  argv="$(sed -n 's/.*argv\[\]=\([^;]*\) ;.*/\1/p' <<<"$exec_start")"
  [[ "$argv" == "${EXPECTED_ARGV}" ]] || stop "$SERVICE does not run the expected systemd-socket-proxyd command"

  # Effective socket settings.
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
  local -a owner=(-o root -g root)
  [[ -n "$ROOT" ]] && owner=()
  if install "${owner[@]}" -m 0644 "$src" "$tmp" && mv -f "$tmp" "$dst"; then
    return 0
  fi
  rm -f -- "$tmp"
  echo "ERROR: could not replace $dst" >&2
  return 1
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

# Best effort back to the installed (loopback) state after a rollback step
# failed: loopback vhost, Nginx serving it, socket on the tailnet address.
# Reports each component; never claims success unless all are consistent.
# Always exits 1 (the rollback itself did not complete).
recover_installed() {
  local reason="$1" problems=()
  echo "ROLLBACK FAILED: $reason" >&2
  echo "RECOVERY: restoring the loopback configuration and the socket" >&2
  install_atomic "$SRC_NGINX" "$DST_NGINX" || problems+=("vhost could not be written")
  if [[ "$(nginx_state)" != installed ]]; then
    problems+=("vhost does not match Git")
  elif ! nginx -t -q; then
    problems+=("loopback vhost fails nginx -t")
  elif systemctl is-active --quiet nginx.service; then
    # The running configuration may already be the loopback one (a failed
    # reload keeps the previous configuration); reload to be sure.
    systemctl reload nginx.service || warn "nginx reload failed during recovery"
  else
    systemctl start nginx.service || problems+=("nginx.service could not be started")
  fi
  wait_for "Nginx listening on $LOOPBACK_ADDR:$PORT" nginx_on_loopback \
    || problems+=("Nginx does not listen on $LOOPBACK_ADDR:$PORT")
  if ! socket_on_tailnet; then
    if wait_for "release of $TAILNET_ADDR:$PORT" tailnet_free; then
      systemctl enable --now "$SOCKET" >/dev/null 2>&1 || problems+=("$SOCKET could not be started")
      wait_for "$SOCKET listening" socket_on_tailnet || problems+=("$SOCKET does not hold $TAILNET_ADDR:$PORT")
    else
      problems+=("$TAILNET_ADDR:$PORT is still held by another listener")
    fi
  fi
  systemctl is-active --quiet nginx.service || problems+=("nginx.service is not active")
  public_ok || problems+=("public site check is not HTTP 200")
  if (( ${#problems[@]} == 0 )); then
    echo "RECOVERED: installed state restored (Nginx on $LOOPBACK_ADDR:$PORT, socket on $TAILNET_ADDR:$PORT); the rollback did NOT complete" >&2
  else
    printf 'RECOVERY INCOMPLETE: %s\n' "${problems[@]}" >&2
    echo "Manual action required: see docs/operations/metrics-tailnet-proxy.md (Rollback)" >&2
  fi
  exit 1
}

# Stops the socket BEFORE Nginx takes the tailnet address back, restores the
# backed-up vhost and reloads Nginx. If a later step fails (the restored vhost
# fails `nginx -t`, e.g. Tailscale has no address yet; the reload fails; Nginx
# does not take the address), recover_installed returns to the consistent
# loopback state and reports what is left.
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

  install_atomic "$backup/$NGINX_NAME" "$DST_NGINX" \
    || recover_installed "the backed-up vhost could not be written"
  nginx -t -q || recover_installed "the restored vhost fails nginx -t (Tailscale address missing?)"
  systemctl reload nginx.service || recover_installed "nginx reload with the restored vhost failed"
  wait_for "Nginx listening on $TAILNET_ADDR:$PORT" nginx_on_tailnet \
    || recover_installed "Nginx did not take $TAILNET_ADDR:$PORT back"
  # The legacy vhost is back; a public failure now is not caused by this change.
  public_ok || warn "public site check is not HTTP 200 after rollback; investigate"
  remove_units_if_ours || { echo "ROLLBACK INCOMPLETE: unit files could not be removed; Nginx serves the legacy vhost" >&2; exit 1; }
  echo "ROLLED BACK: Nginx serves $TAILNET_ADDR:$PORT again from $backup"
}

# An install step failed after production files changed: roll back to the
# backed-up legacy vhost, or say plainly that no rollback is possible.
install_failed() {
  if [[ -n "${BACKUP_DIR:-}" ]]; then
    restore_legacy "$BACKUP_DIR" "$1"
  else
    echo "FAILED: $1. No backup to roll back to; Nginx keeps the loopback vhost." \
      "Run --check and see the runbook (Rollback, manual steps)." >&2
  fi
  exit 1
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

    # Units are inert until the socket is started; Nginx is unchanged so far.
    for pair in "$SRC_SOCKET:$DST_SOCKET" "$SRC_SERVICE:$DST_SERVICE"; do
      [[ -e "${pair#*:}" ]] || install_atomic "${pair%%:*}" "${pair#*:}" \
        || stop "could not install ${pair#*:}; Nginx unchanged"
    done
    systemctl daemon-reload || stop "systemctl daemon-reload failed; Nginx unchanged"
    install_atomic "$SRC_NGINX" "$DST_NGINX" || stop "could not replace the vhost; Nginx unchanged"
    echo "INSTALLED FILES: $DST_NGINX, $DST_SOCKET, $DST_SERVICE"

    nginx -t -q || install_failed "nginx -t failed for the loopback vhost"
    systemctl reload nginx.service || install_failed "nginx reload failed"
    wait_for "Nginx listening on $LOOPBACK_ADDR:$PORT" nginx_on_loopback \
      || install_failed "Nginx did not take $LOOPBACK_ADDR:$PORT"
    public_ok || install_failed "public site check failed after reload"
    metrics_unauthorized_at "$LOOPBACK_ADDR" || install_failed "loopback metrics did not answer 401"
  else
    BACKUP_DIR="$(latest_backup || true)"
    [[ -n "$BACKUP_DIR" ]] || warn "no backup found under $BACKUP_ROOT; automatic rollback unavailable"
    for pair in "$SRC_SOCKET:$DST_SOCKET" "$SRC_SERVICE:$DST_SERVICE"; do
      [[ -e "${pair#*:}" ]] || install_atomic "${pair%%:*}" "${pair#*:}" \
        || stop "could not install ${pair#*:}"
    done
    systemctl daemon-reload || stop "systemctl daemon-reload failed"
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
    systemctl enable "$SOCKET" >/dev/null 2>&1 || install_failed "enabling $SOCKET failed"
    systemctl start "$SOCKET" || install_failed "starting $SOCKET failed"
    wait_for "$SOCKET listening on $TAILNET_ADDR:$PORT" socket_on_tailnet \
      || install_failed "$SOCKET did not listen"
  fi

  (verify_installed) || install_failed "post-install verification failed"
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
