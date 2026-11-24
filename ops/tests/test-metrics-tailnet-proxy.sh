#!/usr/bin/env bash
# Issue #24: the metrics tailnet socket, the loopback Nginx vhost and their
# installer. Runs the real installer against a temporary root with stateful
# mocks of systemctl, nginx, ss, curl, ufw and systemd-analyze; nothing on
# this machine is touched.
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALLER="$REPO_ROOT/ops/install/install-metrics-tailnet-proxy.sh"
SOCKET_UNIT="$REPO_ROOT/ops/systemd/childbex-metrics-tailnet.socket"
SERVICE_UNIT="$REPO_ROOT/ops/systemd/childbex-metrics-tailnet.service"
NGINX_SRC="$REPO_ROOT/ops/nginx/conf.d/childbex-app-metrics.conf"
NGINX_LEGACY="$REPO_ROOT/ops/nginx/legacy/childbex-app-metrics.tailnet.conf"
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT

TAILNET=100.117.155.53:9200
LOOPBACK=127.0.0.1:9200
passed=0

fail() { echo "FAIL: $*" >&2; [[ -n "${OUT:-}" ]] && printf '%s\n' "--- installer output ---" "$OUT" >&2; exit 1; }
ok() { passed=$((passed + 1)); echo "ok - $*"; }

# --- Static checks of the repository files ---------------------------------

bash -n "$INSTALLER"
bash -n "$REPO_ROOT/ops/install/install-production-deploy.sh"

# 1. Socket address, FreeBind and activation model.
grep -qx 'ListenStream=100.117.155.53:9200' "$SOCKET_UNIT" || fail "socket address"
[[ "$(grep -c '^ListenStream=' "$SOCKET_UNIT")" -eq 1 ]] || fail "exactly one ListenStream"
grep -qx 'FreeBind=yes' "$SOCKET_UNIT" || fail "FreeBind=yes"
grep -qx 'Accept=no' "$SOCKET_UNIT" || fail "Accept=no"
grep -Eq '^ListenStream=(0\.0\.0\.0|\[::\]|\*|[0-9]+$)' "$SOCKET_UNIT" && fail "wildcard listener"
grep -rqE '^[^#]*ip_nonlocal_bind' "$SOCKET_UNIT" "$SERVICE_UNIT" "$INSTALLER" && fail "ip_nonlocal_bind set"
ok "socket binds only $TAILNET with FreeBind=yes and Accept=no"

# 2. No ordering or requirement on Tailscale readiness.
for unit in "$SOCKET_UNIT" "$SERVICE_UNIT"; do
  if grep -Ei '^(After|Wants|Requires|BindsTo|PartOf|Requisite|ExecStartPre)=' "$unit" \
    | grep -Eiq 'tailscale|network-online|sys-subsystem-net'; then
    fail "$(basename "$unit") depends on Tailscale or network readiness"
  fi
done
grep -Eq '^ExecStartPre=' "$SERVICE_UNIT" && fail "ExecStartPre in the proxy service"
ok "no dependency on tailscaled, network-online or the tailscale0 device"

# 3. Proxy target and sandbox that keeps loopback reachable.
grep -qx 'ExecStart=/usr/lib/systemd/systemd-socket-proxyd --exit-idle-time=5min --connections-max=16 127.0.0.1:9200' \
  "$SERVICE_UNIT" || fail "proxy target"
grep -Eq '^PrivateNetwork=(yes|true)' "$SERVICE_UNIT" && fail "PrivateNetwork would cut loopback"
grep -qx 'Requires=childbex-metrics-tailnet.socket' "$SERVICE_UNIT" || fail "service requires its socket"
grep -qx 'IPAddressAllow=localhost' "$SERVICE_UNIT" || fail "proxy egress restricted to loopback"
ok "proxy forwards to 127.0.0.1:9200 with loopback-only egress"

# 4. Loopback Nginx listener; otherwise identical to the legacy vhost.
listens="$(grep -E '^[[:space:]]*listen[[:space:]]' "$NGINX_SRC")"
[[ "$(echo "$listens" | wc -l)" -eq 1 && "$listens" =~ listen\ 127\.0\.0\.1:9200\; ]] || fail "loopback listen"
grep -q 'proxy_pass http://127.0.0.1:3111/metrics;' "$NGINX_SRC" || fail "backend target kept"
grep -Eq '^[[:space:]]*auth_basic' "$NGINX_SRC" && fail "no duplicate Nginx auth"
strip() { sed -e 's/#.*$//' -e '/^[[:space:]]*$/d' "$1"; }
diff <(strip "$NGINX_SRC" | sed 's/listen 127\.0\.0\.1:9200;/listen 100.117.155.53:9200;/') \
  <(strip "$NGINX_LEGACY") >/dev/null || fail "repository vhost differs from legacy beyond the listen line"
ok "Nginx metrics vhost listens on 127.0.0.1:9200 only, otherwise unchanged"

# 5. Restricted socket access.
grep -qx 'IPAddressDeny=any' "$SOCKET_UNIT" || fail "IPAddressDeny=any"
grep -qx 'IPAddressAllow=100.78.90.38/32' "$SOCKET_UNIT" || fail "IPAddressAllow shared only"
[[ "$(grep -c '^IPAddressAllow=' "$SOCKET_UNIT")" -eq 1 ]] || fail "single allow entry"
ok "socket accepts only 100.78.90.38/32"

# 13. No credentials or medical data in the tracked files of this change.
for f in "$SOCKET_UNIT" "$SERVICE_UNIT" "$NGINX_SRC" "$NGINX_LEGACY" "$INSTALLER" \
  "$REPO_ROOT/docs/operations/metrics-tailnet-proxy.md"; do
  if grep -EIn 'Basic [A-Za-z0-9+/]{12,}={0,2}|BEGIN [A-Z ]*PRIVATE KEY|password_file|auth_basic_user_file|BASIC_AUTH=|tskey-|\.dcm\b' "$f"; then
    fail "possible secret or medical data in $f"
  fi
done
ok "no credentials, keys or medical data in tracked files"

# Real unit syntax check where systemd is available (e.g. the Ubuntu CI runner).
if command -v systemd-analyze >/dev/null && [[ -x /usr/lib/systemd/systemd-socket-proxyd ]]; then
  systemd-analyze verify --man=no "$SOCKET_UNIT" "$SERVICE_UNIT" || fail "systemd-analyze verify"
  ok "systemd-analyze verify accepts both units"
else
  echo "skip - systemd-analyze verify (systemd not available here)"
fi

grep -q 'install-metrics-tailnet-proxy' "$REPO_ROOT/ops/install/install-production-deploy.sh" \
  && fail "the main installer must not call the metrics proxy installer"
ok "main production installer does not activate this change"

# --- Mocks -------------------------------------------------------------------

BIN="$TMP/bin"
mkdir -p "$BIN"

cat >"$BIN/ss" <<'EOF'
#!/usr/bin/env bash
S="$MOCK_STATE"
echo "ss $*" >>"$S/calls"
while read -r a o; do
  [[ -n "$a" ]] && printf 'LISTEN 0 511 %s 0.0.0.0:* users:(("%s",pid=10,fd=6))\n' "$a" "$o"
done <"$S/listeners"
# Old Nginx workers: still listening for the next N calls.
if [[ -s "$S/stale" ]]; then
  read -r a o n <"$S/stale"
  printf 'LISTEN 0 511 %s 0.0.0.0:* users:(("%s",pid=11,fd=6))\n' "$a" "$o"
  n=$((n - 1))
  if ((n <= 0)); then : >"$S/stale"; else echo "$a $o $n" >"$S/stale"; fi
fi
EOF

cat >"$BIN/systemctl" <<'EOF'
#!/usr/bin/env bash
S="$MOCK_STATE"
echo "systemctl $*" >>"$S/calls"
CONF="$CHILDBEX_METRICS_PROXY_ROOT/etc/nginx/conf.d/childbex-app-metrics.conf"
UNITS="$CHILDBEX_METRICS_PROXY_ROOT/etc/systemd/system"
TAILNET=100.117.155.53:9200
held() { grep -q "^$1 " "$S/listeners" || { [[ -s "$S/stale" ]] && grep -q "^$1 " "$S/stale"; }; }
drop() { grep -v "^$1 $2\$" "$S/listeners" >"$S/l.tmp" || true; mv "$S/l.tmp" "$S/listeners"; }
start_socket() {
  [[ -e "$S/fail_socket_start" ]] && exit 1
  held "$TAILNET" && exit 1
  echo "$TAILNET systemd" >>"$S/listeners"; touch "$S/socket_active"
}
stop_socket() { drop "$TAILNET" systemd; rm -f "$S/socket_active"; }
unit_value() { sed -n "s/^$1=//p" "$UNITS/childbex-metrics-tailnet.socket" | tail -n 1; }
conf_listen() { sed -n 's/^[[:space:]]*listen[[:space:]]\{1,\}\([^;]*\);.*/\1/p' "$CONF" | head -n 1; }
case "$1" in
  daemon-reload) ;;
  reload)
    new="$(conf_listen)"
    # Injected failures when Nginx is asked to take the tailnet address back.
    if [[ "$new" == "$TAILNET" && -e "$S/reload_kills_nginx_to_tailnet" ]]; then
      drop "$(awk '$2 == "nginx" { print $1; exit }' "$S/listeners")" nginx
      rm -f "$S/nginx_active"; exit 1
    fi
    [[ "$new" == "$TAILNET" && -e "$S/fail_reload_to_tailnet" ]] && exit 1
    old="$(awk '$2 == "nginx" { print $1; exit }' "$S/listeners")"
    [[ "$new" == "$old" ]] && exit 0
    held "$new" && exit 1
    drop "$old" nginx; echo "$new nginx" >>"$S/listeners"; touch "$S/reloaded"
    delay="$(cat "$S/release_delay" 2>/dev/null || echo 0)"
    [[ -n "$old" ]] && ((delay > 0)) && echo "$old nginx $delay" >"$S/stale"
    ;;
  cat)
    unit="$2"
    [[ -f "$UNITS/$unit" ]] || exit 1
    echo "# /etc/systemd/system/$unit"; cat "$UNITS/$unit"
    [[ -e "$S/cat_extra-$unit" ]] && { echo; cat "$S/cat_extra-$unit"; }
    ;;
  is-active)
    case "${@: -1}" in
      nginx.service) [[ -e "$S/nginx_active" ]] && exit 0 ;;
      childbex-metrics-tailnet.socket) [[ -e "$S/socket_active" ]] && exit 0 ;;
    esac
    exit 3 ;;
  is-enabled) [[ -e "$S/socket_enabled" ]] && echo enabled || { echo disabled; exit 1; } ;;
  enable)
    touch "$S/socket_enabled"
    [[ "$2" == --now ]] && start_socket ;;
  disable) rm -f "$S/socket_enabled"; [[ "$2" == --now ]] && stop_socket ;;
  start)
    case "$2" in
      childbex-metrics-tailnet.socket) start_socket ;;
      nginx.service)
        held "$(conf_listen)" && exit 1
        echo "$(conf_listen) nginx" >>"$S/listeners"; touch "$S/nginx_active" ;;
    esac ;;
  stop) [[ "$2" == childbex-metrics-tailnet.socket ]] && stop_socket ;;
  show)
    # systemctl show -p PROP --value UNIT [UNIT...]
    prop="$3"; shift 4
    case "$prop" in
      DropInPaths) cat "$S/dropins" 2>/dev/null; for u in "$@"; do cat "$S/dropins-$u" 2>/dev/null; done ;;
      LoadState) echo loaded ;;
      FragmentPath) cat "$S/fragment-$1" 2>/dev/null || echo "/etc/systemd/system/$1" ;;
      NeedDaemonReload) [[ -e "$S/need_reload-$1" ]] && echo yes || echo no ;;
      ExecStart)
        argv="$(cat "$S/exec_override" 2>/dev/null || sed -n 's/^ExecStart=//p' "$UNITS/$1")"
        echo "{ path=${argv%% *} ; argv[]=$argv ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }" ;;
      FreeBind|Accept|IPAddressAllow) unit_value "$prop" ;;
      Listen) echo "$(unit_value ListenStream) (Stream)" ;;
      IPAddressDeny) [[ "$(unit_value IPAddressDeny)" == any ]] && echo "0.0.0.0/0 ::/0" ;;
    esac ;;
  *) echo "unexpected systemctl $*" >&2; exit 1 ;;
esac
exit 0
EOF

cat >"$BIN/nginx" <<'EOF'
#!/usr/bin/env bash
S="$MOCK_STATE"
echo "nginx $*" >>"$S/calls"
CONF="$CHILDBEX_METRICS_PROXY_ROOT/etc/nginx/conf.d/childbex-app-metrics.conf"
[[ -e "$S/fail_nginx_t_loopback" ]] && grep -q 'listen 127.0.0.1:9200;' "$CONF" && exit 1
# Tailscale has no address yet: binding the legacy listener fails.
[[ -e "$S/no_tailnet_addr" ]] && grep -q 'listen 100.117.155.53:9200;' "$CONF" && exit 1
exit 0
EOF

cat >"$BIN/curl" <<'EOF'
#!/usr/bin/env bash
S="$MOCK_STATE"
echo "curl $*" >>"$S/calls"
url="${@: -1}"
owner() { awk -v a="$1" '$1 == a { print $2; exit }' "$S/listeners"; }
case "$url" in
  https://childbex.com/)
    code="$(cat "$S/public_code")"
    [[ -e "$S/public_fail_after_reload" && -e "$S/reloaded" ]] && code=502
    # --resolve pins the connection; the peer address shows where it went.
    [[ "$*" == *'%{remote_ip}'* ]] && code="$code $(cat "$S/public_remote_ip")"
    printf '%s' "$code"; exit 0 ;;
  http://127.0.0.1:9200/metrics)
    [[ "$(owner 127.0.0.1:9200)" == nginx ]] && code=401 || code=000 ;;
  http://100.117.155.53:9200/metrics)
    case "$(owner 100.117.155.53:9200)" in
      nginx) code=401 ;;
      systemd) code="$(cat "$S/tailnet_probe_code")" ;;
      *) code=000 ;;
    esac ;;
  *) code=000 ;;
esac
printf '%s' "$code"
[[ "$code" == 000 ]] && exit 7
exit 0
EOF

cat >"$BIN/ufw" <<'EOF'
#!/usr/bin/env bash
S="$MOCK_STATE"
[[ "$*" == "status verbose" ]] && { cat "$S/ufw"; exit 0; }
echo "ufw $*" >>"$S/calls"
echo "UFW-MODIFY $*" >>"$S/ufw_writes"
exit 1
EOF

cat >"$BIN/systemd-analyze" <<'EOF'
#!/usr/bin/env bash
echo "systemd-analyze $*" >>"$MOCK_STATE/calls"
[[ ! -e "$MOCK_STATE/fail_analyze" ]]
EOF
chmod +x "$BIN"/*

# --- Fake host ----------------------------------------------------------------

# `ufw status verbose` as on production; the 9200 line is the exact observed
# production rule (destination-qualified).
UFW_HEAD='Status: active
Logging: on (low)
Default: deny (incoming), allow (outgoing), deny (routed)
New profiles: skip

To                         Action      From
--                         ------      ----'
UFW_PROD_RULE='100.117.155.53 9200/tcp on tailscale0 ALLOW IN 100.78.90.38'
UFW_OK="$UFW_HEAD
22/tcp                     ALLOW IN    Anywhere
80,443/tcp                 ALLOW IN    Anywhere
$UFW_PROD_RULE
22/tcp (v6)                ALLOW IN    Anywhere (v6)
80,443/tcp (v6)            ALLOW IN    Anywhere (v6)"

setup() {
  ROOT="$TMP/host-$1"; S="$TMP/state-$1"
  rm -rf -- "$ROOT" "$S"
  mkdir -p "$ROOT/etc/nginx/conf.d" "$ROOT/etc/nginx/sites-enabled" "$ROOT/etc/systemd/system" \
    "$ROOT/usr/lib/systemd" "$S"
  printf '#!/bin/sh\n' >"$ROOT/usr/lib/systemd/systemd-socket-proxyd"
  chmod +x "$ROOT/usr/lib/systemd/systemd-socket-proxyd"
  printf 'http {\n    include /etc/nginx/conf.d/*.conf;\n    include /etc/nginx/sites-enabled/*;\n}\n' \
    >"$ROOT/etc/nginx/nginx.conf"
  printf 'server {\n    listen 443 ssl;\n    server_name app.childbex.com;\n}\n' \
    >"$ROOT/etc/nginx/sites-enabled/app.childbex.com.conf"
  cp "$REPO_ROOT/ops/nginx/conf.d/99-ratelimit.conf" "$ROOT/etc/nginx/conf.d/99-ratelimit.conf"
  cp "$NGINX_LEGACY" "$ROOT/etc/nginx/conf.d/childbex-app-metrics.conf"
  cp "$NGINX_LEGACY" "$TMP/original-$1.conf"
  echo "$TAILNET nginx" >"$S/listeners"
  : >"$S/calls"; : >"$S/stale"
  touch "$S/nginx_active"
  echo 200 >"$S/public_code"
  echo 127.0.0.1 >"$S/public_remote_ip"
  echo 000 >"$S/tailnet_probe_code"
  printf '%s\n' "$UFW_OK" >"$S/ufw"
  export CHILDBEX_METRICS_PROXY_ROOT="$ROOT" MOCK_STATE="$S"
  export CHILDBEX_METRICS_PROXY_WAIT_SECONDS=5 CHILDBEX_METRICS_PROXY_POLL_SECONDS=0
}

run() {
  set +e
  OUT="$(PATH="$BIN:$PATH" bash "$INSTALLER" "$@" 2>&1)"
  RC=$?
  set -e
}
expect_rc() { [[ "$RC" -eq "$1" ]] || fail "expected exit $1, got $RC ($2)"; }
expect_out() { grep -Eq "$1" <<<"$OUT" || fail "output lacks /$1/ ($2)"; }
unrelated_sum() {
  cat "$ROOT/etc/nginx/nginx.conf" "$ROOT/etc/nginx/sites-enabled/app.childbex.com.conf" \
    "$ROOT/etc/nginx/conf.d/99-ratelimit.conf" | cksum
}
owner() { awk -v a="$1" '$1 == a { print $2; exit }' "$S/listeners"; }
count() { grep -c -- "$1" "$S/calls" || true; }
line_of() { grep -n -- "$1" "$S/calls" | tail -n 1 | cut -d: -f1; }
backups() { find "$ROOT/var/backups/childbex/metrics-tailnet-proxy" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l; }
assert_legacy_restored() {
  cmp -s "$TMP/original-$1.conf" "$ROOT/etc/nginx/conf.d/childbex-app-metrics.conf" || fail "original vhost not restored"
  [[ ! -e "$ROOT/etc/systemd/system/childbex-metrics-tailnet.socket" ]] || fail "socket unit left installed"
  [[ "$(owner "$TAILNET")" == nginx ]] || fail "Nginx does not serve $TAILNET again"
  [[ -z "$(owner "$LOOPBACK")" ]] || fail "loopback listener left behind"
}
assert_no_writes() {
  cmp -s "$TMP/original-$1.conf" "$ROOT/etc/nginx/conf.d/childbex-app-metrics.conf" || fail "vhost changed"
  [[ -z "$(ls -A "$ROOT/etc/systemd/system")" ]] || fail "unit files written"
  [[ "$(backups)" -eq 0 ]] || fail "backup written"
  [[ "$(count 'systemctl reload')" -eq 0 ]] || fail "Nginx reloaded"
}

# --- Install, verify, idempotency, rollback ------------------------------------

setup happy
echo 2 >"$S/release_delay"
before="$(unrelated_sum)"

run --check; expect_rc 0 "check"; expect_out "state 'legacy'" "legacy detected"
run --verify; [[ "$RC" -ne 0 ]] || fail "verify must fail before installing"

run --install; expect_rc 0 "install"; expect_out '^INSTALLED: ' "install summary"
cmp -s "$NGINX_SRC" "$ROOT/etc/nginx/conf.d/childbex-app-metrics.conf" || fail "loopback vhost installed"
cmp -s "$SOCKET_UNIT" "$ROOT/etc/systemd/system/childbex-metrics-tailnet.socket" || fail "socket unit installed"
cmp -s "$SERVICE_UNIT" "$ROOT/etc/systemd/system/childbex-metrics-tailnet.service" || fail "service unit installed"
[[ "$(owner "$LOOPBACK")" == nginx && "$(owner "$TAILNET")" == systemd ]] || fail "listener handover"
[[ "$(backups)" -eq 1 ]] || fail "one backup"
cmp -s "$TMP/original-happy.conf" \
  "$(find "$ROOT/var/backups" -name childbex-app-metrics.conf | head -n 1)" || fail "backup equals original"
(( $(line_of 'systemctl reload nginx.service') < $(line_of 'systemctl start childbex-metrics-tailnet.socket') )) \
  || fail "socket must start after Nginx released the tailnet address"
ls -A "$ROOT/etc/nginx/conf.d" | grep -q childbex-tmp && fail "temporary file left in conf.d"
ok "install hands $TAILNET to systemd after old Nginx workers release it (delayed release)"

run --verify; expect_rc 0 "verify after install"; expect_out '^VERIFIED: ' "verify summary"
ok "verify passes on the installed state"

reloads="$(count 'systemctl reload')"
run --install; expect_rc 0 "second install"
[[ "$(count 'systemctl reload')" -eq "$reloads" ]] || fail "second install reloaded Nginx"
[[ "$(backups)" -eq 1 ]] || fail "second install created another backup"
cmp -s "$NGINX_SRC" "$ROOT/etc/nginx/conf.d/childbex-app-metrics.conf" || fail "idempotent vhost"
ok "repeated install is idempotent (no reload, no new backup)"

[[ "$(unrelated_sum)" == "$before" ]] || fail "unrelated Nginx files changed by install"
[[ ! -e "$S/ufw_writes" ]] || fail "installer modified UFW"
cmp -s <(printf '%s\n' "$UFW_OK") "$S/ufw" || fail "UFW rules changed"
ok "unrelated Nginx files and UFW rules unchanged by install"

run --rollback; expect_rc 0 "rollback"; expect_out '^ROLLED BACK: ' "rollback summary"
assert_legacy_restored happy
(( $(line_of 'systemctl disable --now childbex-metrics-tailnet.socket') < $(line_of 'systemctl reload nginx.service') )) \
  || fail "rollback must stop the socket before Nginx takes the address back"
[[ "$(unrelated_sum)" == "$before" ]] || fail "unrelated Nginx files changed by rollback"
[[ ! -e "$S/ufw_writes" ]] || fail "rollback modified UFW"
run --check; expect_rc 0 "check after rollback"; expect_out "state 'legacy'" "legacy after rollback"
ok "rollback stops the socket first and restores the original vhost byte for byte"

# --- Drift ----------------------------------------------------------------------

setup drift
sed -i 's/server_name _;/server_name _;\n    allow 10.0.0.0\/8;/' "$ROOT/etc/nginx/conf.d/childbex-app-metrics.conf"
cp "$ROOT/etc/nginx/conf.d/childbex-app-metrics.conf" "$TMP/original-drift.conf"
run --check; [[ "$RC" -ne 0 ]] || fail "drift not detected by --check"; expect_out 'drift' "drift message"
run --install; [[ "$RC" -ne 0 ]] || fail "drift not detected by --install"
assert_no_writes drift
grep -q 'allow 10.0.0.0' <<<"$OUT" && fail "configuration content printed"
ok "unexpected live vhost content stops --check and --install without writes"

setup whitespace
sed -i 's/^    /\t/' "$ROOT/etc/nginx/conf.d/childbex-app-metrics.conf"
run --check; expect_rc 0 "re-indented legacy vhost"; expect_out "state 'legacy'" "whitespace-only difference"
ok "whitespace-only differences in the legacy vhost are accepted"

setup unitdrift
printf '[Socket]\nListenStream=0.0.0.0:9200\n' >"$ROOT/etc/systemd/system/childbex-metrics-tailnet.socket"
run --install; [[ "$RC" -ne 0 ]] || fail "unit drift not detected"; expect_out 'drift' "unit drift"
ok "a different pre-existing socket unit stops the install"

setup dropin
echo /etc/systemd/system/childbex-metrics-tailnet.socket.d/override.conf >"$S/dropins"
run --check; [[ "$RC" -ne 0 ]] || fail "drop-in not detected"; expect_out 'drop-ins' "drop-in"
ok "drop-ins that could override the socket stop the check"

# --- Port conflicts ---------------------------------------------------------------

for conflict in "127.0.0.1:9200 python3" "0.0.0.0:9200 node" "[::]:9200 node"; do
  setup conflict
  echo "$conflict" >>"$S/listeners"
  run --install; [[ "$RC" -ne 0 ]] || fail "conflict '$conflict' not detected"
  expect_out 'CONFLICT' "conflict '$conflict'"
  assert_no_writes conflict
done
setup foreign
echo "$TAILNET socat" >"$S/listeners"
run --check; [[ "$RC" -ne 0 ]] || fail "foreign owner of $TAILNET not detected"
for line in 'listen 100.117.155.53:443 ssl;' 'listen 9200;' 'listen [::]:9200;'; do
  setup othervhost
  printf 'server {\n    %s\n}\n' "$line" >"$ROOT/etc/nginx/sites-enabled/other.conf"
  run --install; [[ "$RC" -ne 0 ]] || fail "other vhost '$line' not detected"
  assert_no_writes othervhost
done
ok "port 9200 conflicts (other processes, wildcard listeners, other vhosts) stop before writes"

# --- UFW ------------------------------------------------------------------------------

# The exact production format (destination-qualified rule) is accepted; the
# happy path above already installed with it. Also aligned columns.
setup ufwaligned
printf '%s\n100.117.155.53 9200/tcp on tailscale0  ALLOW IN    100.78.90.38\nNginx Full                 ALLOW IN    Anywhere\n9200/udp                   ALLOW IN    Anywhere\n9200/tcp                   DENY IN     Anywhere\n' \
  "$UFW_HEAD" >"$S/ufw"
run --check; expect_rc 0 "aligned production rule, profile, udp and DENY rules"
expect_out "OK: UFW allows 100.117.155.53 9200/tcp on tailscale0 from 100.78.90.38 only" "UFW ok"
expect_out 'application-profile rule not evaluated' "profile warning"
ok "UFW: the exact production rule format is accepted (UDP and DENY rules are not conflicts)"

ufw_rejects() {
  local label="$1" rules="$2"
  setup ufwreject
  printf '%s\n%s\n' "$UFW_HEAD" "$rules" >"$S/ufw"
  run --install; [[ "$RC" -ne 0 ]] || fail "UFW: $label not rejected"
  assert_no_writes ufwreject
}
ufw_rejects "missing rule" '22/tcp                     ALLOW IN    Anywhere'
ufw_rejects "wildcard destination (simplified form)" '9200/tcp on tailscale0     ALLOW IN    100.78.90.38'
ufw_rejects "wildcard destination and source" "$UFW_PROD_RULE
9200/tcp                   ALLOW IN    Anywhere"
ufw_rejects "additional source" "$UFW_PROD_RULE
100.117.155.53 9200/tcp on tailscale0 ALLOW IN 100.64.0.7"
ufw_rejects "other interface only" '100.117.155.53 9200/tcp on eth0 ALLOW IN 100.78.90.38'
ufw_rejects "other interface in addition" "$UFW_PROD_RULE
100.117.155.53 9200/tcp on eth0 ALLOW IN 100.78.90.38"
ufw_rejects "port range" "$UFW_PROD_RULE
9000:9300/tcp              ALLOW IN    Anywhere"
ufw_rejects "port list" "$UFW_PROD_RULE
80,443,9200/tcp            ALLOW IN    Anywhere"
ufw_rejects "all ports on tailscale0" "$UFW_PROD_RULE
Anywhere on tailscale0     ALLOW IN    Anywhere"
ufw_rejects "all ports from a network" "$UFW_PROD_RULE
Anywhere                   ALLOW IN    100.64.0.0/10"
ufw_rejects "IPv6 rule" "$UFW_PROD_RULE
9200/tcp (v6) on tailscale0 ALLOW IN   Anywhere (v6)"
ufw_rejects "LIMIT rule" "$UFW_PROD_RULE
9200/tcp                   LIMIT IN    Anywhere"
ufw_rejects "duplicate approved rule" "$UFW_PROD_RULE
$UFW_PROD_RULE"
setup ufwdefault
sed 's/^Default: deny (incoming)/Default: allow (incoming)/' <<<"$UFW_OK" >"$S/ufw"
run --install; [[ "$RC" -ne 0 ]] || fail "default allow incoming not rejected"; assert_no_writes ufwdefault
setup ufwinactive
printf 'Status: inactive\n' >"$S/ufw"
run --install; [[ "$RC" -ne 0 ]] || fail "inactive UFW not detected"; assert_no_writes ufwinactive
ok "UFW: wildcard destinations, extra sources or interfaces, ranges, lists, all-port, IPv6, LIMIT and duplicate rules are rejected"

# --- Failed activation and rollback ---------------------------------------------------

setup socketfail
touch "$S/fail_socket_start"
run --install; [[ "$RC" -ne 0 ]] || fail "failed socket start not reported"; expect_out 'ROLLBACK' "rollback ran"
assert_legacy_restored socketfail
ok "a socket that fails to start rolls back to the original vhost"

setup nginxtfail
touch "$S/fail_nginx_t_loopback"
run --install; [[ "$RC" -ne 0 ]] || fail "nginx -t failure not reported"
assert_legacy_restored nginxtfail
[[ "$(count 'systemctl reload')" -eq 1 ]] || fail "Nginx reloaded with an invalid configuration"
ok "nginx -t failure restores the original vhost before any reload"

setup publicfail
touch "$S/public_fail_after_reload"
run --install; [[ "$RC" -ne 0 ]] || fail "public failure not reported"; expect_out 'public site check' "reason"
assert_legacy_restored publicfail
ok "a failed public health check after reload rolls back"

setup filterfail
echo 401 >"$S/tailnet_probe_code"
run --install; [[ "$RC" -ne 0 ]] || fail "ineffective IP filter not reported"
expect_out 'IP filtering is not effective' "filter verification"
assert_legacy_restored filterfail
ok "an IP filter that does not take effect fails verification and rolls back"

# --- Delayed release beyond the wait ----------------------------------------------------

setup slowrelease
echo 1000000 >"$S/release_delay"
export CHILDBEX_METRICS_PROXY_WAIT_SECONDS=1
run --install; expect_rc 3 "old workers still holding the socket"; expect_out '^PENDING: ' "pending message"
cmp -s "$NGINX_SRC" "$ROOT/etc/nginx/conf.d/childbex-app-metrics.conf" || fail "loopback vhost kept"
[[ "$(count 'systemctl start childbex-metrics-tailnet.socket')" -eq 0 ]] || fail "socket started while port busy"
[[ "$(owner "$LOOPBACK")" == nginx ]] || fail "public Nginx left on loopback config"
: >"$S/stale"   # the old workers exit
run --install; expect_rc 0 "resume after release"
[[ "$(owner "$TAILNET")" == systemd && "$(backups)" -eq 1 ]] || fail "resumed handover"
ok "old workers holding the port beyond the wait leave Nginx healthy; re-running completes"

# --- Rollback guard: legacy vhost cannot bind (no Tailscale address) ----------------------

setup notailnet
export CHILDBEX_METRICS_PROXY_WAIT_SECONDS=5
run --install; expect_rc 0 "install"
touch "$S/no_tailnet_addr"
run --rollback; [[ "$RC" -ne 0 ]] || fail "rollback without Tailscale address must fail"
expect_out 'ROLLBACK FAILED' "guarded rollback"
expect_out '^RECOVERED: ' "recovery reported"
cmp -s "$NGINX_SRC" "$ROOT/etc/nginx/conf.d/childbex-app-metrics.conf" || fail "loopback vhost kept"
[[ "$(owner "$TAILNET")" == systemd ]] || fail "socket restarted"
ok "rollback never leaves Nginx with a vhost that fails nginx -t"

# --- Nginx reload failures during rollback -------------------------------------------------

assert_recovered_installed() {
  cmp -s "$NGINX_SRC" "$ROOT/etc/nginx/conf.d/childbex-app-metrics.conf" || fail "loopback vhost not restored"
  [[ -e "$S/nginx_active" ]] || fail "nginx.service not active"
  [[ "$(owner "$LOOPBACK")" == nginx ]] || fail "Nginx not on $LOOPBACK"
  [[ -e "$ROOT/etc/systemd/system/childbex-metrics-tailnet.socket" ]] || fail "socket unit removed"
  grep -q '^ROLLED BACK' <<<"$OUT" && fail "claimed a completed rollback"
  return 0
}

setup reloadfail
run --install; expect_rc 0 "install"
touch "$S/fail_reload_to_tailnet"
run --rollback; expect_rc 1 "explicit rollback with failing reload"
expect_out 'ROLLBACK FAILED: nginx reload' "reason"; expect_out '^RECOVERED: ' "recovered"
assert_recovered_installed
[[ "$(owner "$TAILNET")" == systemd ]] || fail "socket not restored"
rm -f "$S/fail_reload_to_tailnet"
run --verify; expect_rc 0 "verify after recovery"
ok "explicit rollback: failed reload recovers the consistent installed state (verify passes)"

setup reloaddies
run --install; expect_rc 0 "install"
touch "$S/reload_kills_nginx_to_tailnet"
run --rollback; expect_rc 1 "rollback where the reload kills Nginx"
expect_out '^RECOVERED: ' "recovered"
assert_recovered_installed
grep -q 'systemctl start nginx.service' "$S/calls" || fail "Nginx not started during recovery"
ok "explicit rollback: Nginx stopped by a failed reload is started again on the loopback vhost"

setup autoreloadfail
echo 401 >"$S/tailnet_probe_code"            # verification fails → automatic rollback
touch "$S/fail_reload_to_tailnet"            # … whose reload fails
run --install; expect_rc 1 "automatic rollback with failing reload"
expect_out 'post-install verification failed' "trigger"; expect_out '^RECOVERED: ' "recovered"
assert_recovered_installed
[[ "$(owner "$TAILNET")" == systemd ]] || fail "socket not restored"
ok "automatic rollback: failed reload recovers the installed state and says the rollback did not complete"

setup autoincomplete
touch "$S/fail_socket_start" "$S/fail_reload_to_tailnet"
run --install; expect_rc 1 "automatic rollback, reload and socket both failing"
expect_out '^RECOVERY INCOMPLETE: .*childbex-metrics-tailnet.socket' "incomplete recovery named"
grep -q '^RECOVERED' <<<"$OUT" && fail "claimed recovery with the socket down"
assert_recovered_installed
ok "recovery reports exactly which component stays inconsistent (never claims success)"

# --- Effective systemd configuration -------------------------------------------------------

# One install; each case injects one effective-configuration fault, checks
# that --verify rejects it, then removes it (verify passes again).
setup effective
run --install; expect_rc 0 "install"
effective_rejects() {
  local label="$1" message="$2" knob="$S/$3" content="$4"
  printf '%s\n' "$content" >"$knob"
  run --verify; [[ "$RC" -ne 0 ]] || fail "verify accepted: $label"
  expect_out "$message" "$label"
  rm -f -- "$knob"
}
effective_rejects "service drop-in" 'has drop-ins' dropins-childbex-metrics-tailnet.service \
  /etc/systemd/system/childbex-metrics-tailnet.service.d/x.conf
effective_rejects "socket drop-in" 'has drop-ins' dropins-childbex-metrics-tailnet.socket \
  /etc/systemd/system/childbex-metrics-tailnet.socket.d/x.conf
effective_rejects "fragment elsewhere" 'is loaded from' fragment-childbex-metrics-tailnet.socket \
  /run/systemd/system/childbex-metrics-tailnet.socket
effective_rejects "pending daemon-reload" 'since the last daemon-reload' \
  need_reload-childbex-metrics-tailnet.service yes
effective_rejects "other proxy command" 'expected systemd-socket-proxyd command' exec_override \
  '/usr/lib/systemd/systemd-socket-proxyd 10.0.0.1:9200'
effective_rejects "loaded content differs" 'differs from Git' cat_extra-childbex-metrics-tailnet.socket \
  "$(printf '# /etc/systemd/system/x.conf\n[Socket]\nIPAddressAllow=any')"
run --verify; expect_rc 0 "verify after removing every injected fault"
ok "verify checks the effective units: drop-ins, fragment, daemon-reload, ExecStart, loaded content"

# --- HTTP probes ----------------------------------------------------------------------------

setup probes
run --install; expect_rc 0 "install"
probes="$(grep '^curl ' "$S/calls")"
[[ -n "$probes" ]] || fail "no HTTP probes recorded"
if grep -v -- "--noproxy \*" <<<"$probes" | grep -q .; then fail "probe without --noproxy '*'"; fi
grep -q -- "--resolve childbex.com:443:127.0.0.1" <<<"$probes" || fail "public probe not pinned to 127.0.0.1"
grep -Eq -- ' -v | --verbose| -i | --include| -D ' <<<"$probes" && fail "a probe could print headers"
grep -q -- '-o /dev/null' <<<"$probes" || fail "response bodies not discarded"
ok "every HTTP probe bypasses proxies and discards bodies; the public probe is pinned to 127.0.0.1"

setup notlocal
echo 203.0.113.10 >"$S/public_remote_ip"
run --install; [[ "$RC" -ne 0 ]] || fail "public probe that did not reach 127.0.0.1 accepted"
expect_out 'public site check' "reason"; assert_no_writes notlocal
ok "a public probe answered by anything other than the local Nginx stops the install"

# --- Root requirement ---------------------------------------------------------------------

if [[ $EUID -ne 0 ]]; then
  set +e
  OUT="$(env -u CHILDBEX_METRICS_PROXY_ROOT PATH="$BIN:$PATH" bash "$INSTALLER" --install 2>&1)"; RC=$?
  set -e
  [[ "$RC" -ne 0 ]] && grep -q 'requires root' <<<"$OUT" || fail "--install without root"
  ok "--install refuses to run without root"
fi

echo "PASS: metrics tailnet proxy ($passed checks)"
