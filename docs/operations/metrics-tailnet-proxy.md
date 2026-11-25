# Metrics over Tailscale without an Nginx boot race (Issue #24)

Purpose: make production Nginx start after a reboot whether or not Tailscale is
ready, while Prometheus on Shared keeps scraping the ChildBEx app metrics at
`http://100.117.155.53:9200/metrics` exactly as before.

## Problem

`/etc/nginx/conf.d/childbex-app-metrics.conf` contained
`listen 100.117.155.53:9200;`. When Nginx starts before Tailscale has assigned
that address, `nginx -t` fails with `bind() ... (99: Cannot assign requested
address)` and the whole public Nginx stays down until someone starts it by hand.
Ordering on `tailscaled.service` does not help: tailscaled reports "started"
long before the address is assigned (login and coordination server first).

## Design

```text
Shared Prometheus (100.78.90.38)
   │  HTTP + Basic Auth, target 100.117.155.53:9200 (unchanged)
   ▼
childbex-metrics-tailnet.socket   systemd, ListenStream=100.117.155.53:9200,
   │                              FreeBind=yes, IPAddressAllow=100.78.90.38/32
   ▼  (socket-activated, plain TCP)
childbex-metrics-tailnet.service  systemd-socket-proxyd → 127.0.0.1:9200
   ▼
Nginx  listen 127.0.0.1:9200      location = /metrics → 127.0.0.1:3111/metrics
   ▼
Backend                           Basic Auth (basicAuthValidator), 401 without it
```

- **No boot race.** Nginx only binds loopback and public addresses. The socket
  uses `FreeBind=yes` (IP_FREEBIND on this one socket; the global
  `net.ipv4.ip_nonlocal_bind` is not used), so it binds before the Tailscale
  address exists and accepts connections as soon as it does. Neither unit
  orders on `tailscaled.service`, `network-online.target` or the `tailscale0`
  device.
- **Contract unchanged.** Same target, scheme, path, labels (`job`,
  `instance`), response and alerting (`TargetDown`). The shared Prometheus
  configuration is not edited.
- **Authentication unchanged.** Nginx has no `auth_basic` here and none is
  added. The proxy forwards bytes without parsing them, so Prometheus'
  `Authorization` header reaches the backend unchanged.
- **Source IP.** Nginx now sees `127.0.0.1` (the proxy) instead of
  `100.78.90.38`; `X-Real-IP` sent to the backend changes accordingly. The
  backend's Basic Auth reads only the `Authorization` header, and Express
  already saw Nginx (`127.0.0.1`) as the peer because this vhost sets no
  `X-Forwarded-For`. Access logs of the metrics vhost show `127.0.0.1`.
- **Access control, two independent layers.** UFW (default deny, `9200/tcp on
  tailscale0` from `100.78.90.38` only, unchanged) and the socket's
  `IPAddressDeny=any` / `IPAddressAllow=100.78.90.38/32` (cgroup BPF). The
  systemd filter must be verified at runtime (below); do not rely on it alone.
- **Tailscale.** Serve/Funnel configuration is not used or changed.

Files (repository-owned):

| File | Installed as |
|---|---|
| `ops/nginx/conf.d/childbex-app-metrics.conf` | `/etc/nginx/conf.d/childbex-app-metrics.conf` |
| `ops/systemd/childbex-metrics-tailnet.socket` | `/etc/systemd/system/childbex-metrics-tailnet.socket` |
| `ops/systemd/childbex-metrics-tailnet.service` | `/etc/systemd/system/childbex-metrics-tailnet.service` |
| `ops/nginx/legacy/childbex-app-metrics.tailnet.conf` | not installed: the observed pre-change vhost, used for drift detection |
| `ops/install/install-metrics-tailnet-proxy.sh` | run from a reviewed checkout; **not** called by `install-production-deploy.sh` |

Tests: `bash ops/tests/test-metrics-tailnet-proxy.sh` (mocks and temporary
directories only; also run in CI).

## Approval boundary

Everything up to and including **Preflight** is read-only. **Install**,
**Rollback** and the **Controlled reboot** change production and each needs
explicit owner approval for a stated maintenance window. Expect a few seconds
without metrics during the handover (and one missed scrape is possible);
public sites are not interrupted (graceful reload).

## 1. Baseline and backups (read-only)

On ChildBEx:

```bash
systemctl is-active nginx childbex-app childbex-ml
sudo ss -Hltnp 'sport = :9200'          # expect: 100.117.155.53:9200 nginx only
sudo sha256sum /etc/nginx/conf.d/childbex-app-metrics.conf
sudo ufw status | grep -E '^Status|9200'
sudo tailscale serve status             # record; this change must not alter it
for u in https://childbex.com/ https://app.childbex.com/ https://auth.childbex.com/; do
  printf '%s ' "$u"; curl -s -o /dev/null -w '%{http_code}\n' "$u"
done                                    # expect 200, 302, 302
```

Confirm a recent configuration snapshot exists and verifies, as described in
[backups](backups.md#snapshot-safety-boundary). The installer additionally
keeps its own copy of the original vhost under
`/var/backups/childbex/metrics-tailnet-proxy/<UTC timestamp>/` (mode 0700).

On Shared:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://100.117.155.53:9200/metrics   # 401
```

and in Prometheus: `up{job="childbex-app"}` is `1`.

## 2. Preflight (read-only)

From the reviewed checkout of this branch/commit on ChildBEx:

```bash
sudo bash ops/install/install-metrics-tailnet-proxy.sh --check
```

It stops, without changing anything, when:

- required commands are missing, or `/usr/lib/systemd/systemd-socket-proxyd`
  is absent;
- `systemd-analyze verify` rejects the units;
- the live vhost is neither the documented legacy version (comments and
  whitespace ignored) nor the repository version;
- unit files or drop-ins already exist and differ;
- another Nginx file listens on `100.117.155.53` or port 9200;
- anything other than Nginx or the systemd socket listens on port 9200 (any
  address, including wildcards);
- UFW (`ufw status verbose`) is inactive, its default incoming policy is not
  deny, or the rules are not exactly one approved rule in the production
  format `100.117.155.53 9200/tcp on tailscale0 ALLOW IN 100.78.90.38` plus
  rules that cannot reach TCP/9200. Rejected as conflicts: the same port
  without the destination address (wildcard destination), other sources or
  interfaces, IPv6 variants, `LIMIT`, port lists or ranges including 9200,
  and rules without a port (all ports, e.g. `Anywhere on tailscale0`).
  Application-profile rules (e.g. `Nginx Full`) are listed as warnings, not
  evaluated; DENY and UDP rules are ignored.

Expected output ends with `CHECKED: state 'legacy'; no changes made`.

## 3. Install (approval required)

```bash
sudo bash ops/install/install-metrics-tailnet-proxy.sh --install
```

Order of operations:

1. Preflight again; `nginx.service` active; public site HTTP 200 (loopback
   probe); anonymous metrics HTTP 401 through the legacy listener.
2. Back up the original vhost (byte copy, verified).
3. Install both units atomically (temp file + rename), `daemon-reload`. The
   socket is **not** started yet.
4. Replace the vhost atomically with the loopback version.
5. `nginx -t`, then `systemctl reload nginx`.
6. Wait for Nginx on `127.0.0.1:9200`; public site 200; loopback metrics 401.
7. **Handover:** after a graceful reload, old Nginx workers keep the previous
   `100.117.155.53:9200` socket until they finish. The installer waits (up to
   120 s, `CHILDBEX_METRICS_PROXY_WAIT_SECONDS`) until nothing listens there.
8. `systemctl enable` and `start childbex-metrics-tailnet.socket`; wait until
   systemd holds the address.
9. Full `--verify` (below); UFW rules compared with the pre-install state.

Exit codes:

- `0`: installed and verified. Running it again changes nothing.
- `1`: stopped. Failures from step 5 on roll back automatically (socket
  stopped first, original vhost restored, Nginx reloaded, units removed); the
  output says `ROLLBACK`.
- `3`: old workers still held the port after the wait. Public Nginx is healthy
  on the loopback vhost; metrics over Tailscale are unavailable. Check
  `sudo ss -Hltnp 'sport = :9200'`, then run `--install` again (it resumes at
  step 7) or `--rollback`.

## 4. Verify on ChildBEx

```bash
sudo bash ops/install/install-metrics-tailnet-proxy.sh --verify
```

It checks the files against Git, `nginx.service` active, the socket enabled
and active, the **effective** units (no drop-ins, loaded from
`/etc/systemd/system`, `systemctl cat` identical to Git, no pending
`daemon-reload`, the service's `ExecStart` exactly
`/usr/lib/systemd/systemd-socket-proxyd --exit-idle-time=5min --connections-max=16 127.0.0.1:9200`),
the **effective** socket settings (`systemctl show`: `FreeBind=yes`,
`Accept=no`, `Listen=100.117.155.53:9200 (Stream)`,
`IPAddressAllow=100.78.90.38/32`, deny-all), the listeners (Nginx on
`127.0.0.1:9200`, systemd on `100.117.155.53:9200`, nothing else), `nginx -t`,
the public site (200), anonymous loopback metrics (401), and that a request from
ChildBEx itself to `100.117.155.53:9200` gets **no** HTTP answer (its source
is not `100.78.90.38`, and UFW accepts loopback traffic, so only the socket
filter can drop it): this is the runtime proof that the systemd IP filter works.
All HTTP probes use `--noproxy '*'`, discard bodies and print only status
codes; the public probe uses `--resolve childbex.com:443:127.0.0.1` and must
report `127.0.0.1` as the peer, so it really reached the local Nginx.

**Output formats to confirm on the host (systemd 259) before the first
install.** The tests use mocks; `--verify` fails closed (stops) if a format
differs, but confirm once with:

```bash
systemctl show childbex-metrics-tailnet.socket -p Listen -p FreeBind -p Accept -p IPAddressAllow -p IPAddressDeny
#   expected: Listen=100.117.155.53:9200 (Stream), FreeBind=yes, Accept=no,
#             IPAddressAllow=100.78.90.38/32, IPAddressDeny=0.0.0.0/0 ::/0
systemctl show childbex-metrics-tailnet.service -p ExecStart -p DropInPaths -p FragmentPath -p NeedDaemonReload
#   expected ExecStart: { path=... ; argv[]=/usr/lib/systemd/systemd-socket-proxyd ... ; ... }
systemctl cat childbex-metrics-tailnet.socket | head -n 1   # "# /etc/systemd/system/childbex-metrics-tailnet.socket"
```

These units can be checked without starting anything: copy them to a scratch
directory and run `systemd-analyze verify` there, or run `--install` only
after these outputs match.

Manual equivalents:

```bash
sudo ss -Hltnp 'sport = :9200'
systemctl show childbex-metrics-tailnet.socket -p Listen -p FreeBind -p Accept -p IPAddressAllow -p IPAddressDeny
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9200/metrics              # 401
curl -s -o /dev/null -w '%{http_code}\n' -m 3 http://100.117.155.53:9200/metrics   # 000 (dropped)
systemd-analyze security childbex-metrics-tailnet.service                           # review score
journalctl -u childbex-metrics-tailnet.socket -u childbex-metrics-tailnet.service -n 50 --no-pager
```

## 5. Verify from Shared

```bash
# Anonymous: the backend answers 401 through the whole chain.
curl -s -o /dev/null -w '%{http_code}\n' http://100.117.155.53:9200/metrics

# With the Prometheus credentials, without putting the password on a command
# line (printf is a shell builtin; curl reads the config from stdin):
printf 'user = "childbex:%s"\n' "$(sudo cat /etc/prometheus/childbex_metrics.pass)" \
  | curl -s -o /dev/null -w '%{http_code}\n' -K - http://100.117.155.53:9200/metrics   # 200
```

In Prometheus, `up{job="childbex-app"}` returns to `1` within one or two scrape
intervals, with the same `instance="100.117.155.53:9200"` label, and no
`TargetDown` alert fires afterwards.

## 6. Negative access test

From any **other** tailnet node (not Shared):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -m 5 http://100.117.155.53:9200/metrics   # 000
```

Expected: no HTTP answer (UFW and the socket filter both drop it). An HTTP
code here means metrics are reachable beyond Shared: roll back and investigate.

## 7. UFW and Nginx checks

```bash
sudo ufw status verbose | grep 9200   # unchanged: 100.117.155.53 9200/tcp on tailscale0 ALLOW IN 100.78.90.38
sudo nginx -t
systemctl is-active nginx
sudo journalctl -u nginx -b --no-pager | grep -E 'emerg|bind\(\)' || echo 'no bind errors'
```

Repeat the public endpoint checks from the baseline (200 / 302 / 302).

## 8. Rollback (approval required)

```bash
sudo bash ops/install/install-metrics-tailnet-proxy.sh --rollback
# or from a specific backup:
sudo bash ops/install/install-metrics-tailnet-proxy.sh --rollback /var/backups/childbex/metrics-tailnet-proxy/<UTC timestamp>
```

Order: disable and stop the socket and the proxy service **first**, wait until
`100.117.155.53:9200` is free, restore the backed-up vhost atomically,
`nginx -t`, reload, wait for Nginx on the tailnet address, remove the two unit
files (only if they still match Git), `daemon-reload`.

Rollback reintroduces the original boot race.

If a rollback step fails after the socket was stopped (the restored vhost fails
`nginx -t`, e.g. Tailscale has no address at that moment; the reload fails;
Nginx does not take the address back), the installer reports
`ROLLBACK FAILED: <reason>` and recovers the installed state: loopback vhost
written and validated, Nginx reloaded (or started, if the failed reload
stopped it), socket restarted. It then prints either

- `RECOVERED: installed state restored ...; the rollback did NOT complete`
  (consistent; metrics work; retry the rollback later), or
- `RECOVERY INCOMPLETE: <component>` for each part that is still wrong
  (manual action required, see below).

It never prints `ROLLED BACK` unless the legacy vhost is active again. The same
recovery runs when an automatic rollback during `--install` fails. Any other
unexpected failure prints `ERROR: unexpected failure at line N` instead of
exiting silently; run `--check` before anything else.

Manual rollback if the script cannot be used:

```bash
sudo systemctl disable --now childbex-metrics-tailnet.socket
sudo systemctl stop childbex-metrics-tailnet.service
sudo ss -Hltnp 'sport = :9200'                # wait until 100.117.155.53:9200 is gone
sudo install -o root -g root -m 0644 /var/backups/childbex/metrics-tailnet-proxy/<ts>/childbex-app-metrics.conf \
  /etc/nginx/conf.d/childbex-app-metrics.conf
sudo nginx -t && sudo systemctl reload nginx
sudo rm /etc/systemd/system/childbex-metrics-tailnet.{socket,service} && sudo systemctl daemon-reload
```

## 9. Controlled reboot (final acceptance of #24; approval required)

A successful install or reload does **not** close #24. Only a real reboot does.

Before:

1. Owner approval and a maintenance window; Shared monitoring watched.
2. `--verify` passes; Shared scrape returns 200 (section 5).
3. Note the boot ID: `cat /proc/sys/kernel/random/boot_id`.
4. No deployment, package upgrade or other change in the same window.

Reboot: `sudo systemctl reboot`.

After (without any manual Nginx action):

```bash
cat /proc/sys/kernel/random/boot_id                     # different from before
systemctl is-active nginx childbex-app childbex-ml childbex-metrics-tailnet.socket
systemctl show nginx -p NRestarts -p ActiveEnterTimestamp
sudo journalctl -b -u nginx --no-pager | grep -E 'emerg|bind\(\)' || echo 'no bind errors'
sudo ss -Hltnp 'sport = :9200'                          # nginx on 127.0.0.1, systemd on 100.117.155.53
sudo bash ops/install/install-metrics-tailnet-proxy.sh --verify
```

- Public: `https://childbex.com/` 200, `https://app.childbex.com/` 302 (Cloudflare
  Access), `https://auth.childbex.com/` 302 (Keycloak).
- Shared: authenticated scrape 200, anonymous 401, `up{job="childbex-app"}` 1.
- Negative test from another tailnet node: no answer.

If Nginx is not active after the reboot: collect
`journalctl -b -u nginx -u tailscaled -u childbex-metrics-tailnet.socket`,
start Nginx manually to restore service (`sudo systemctl start nginx`), and
keep #24 open. Record the result (pass or fail, timestamps, boot IDs) on the
Issue.
