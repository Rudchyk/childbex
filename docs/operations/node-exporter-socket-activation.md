# ChildBEx Node Exporter native socket activation (Issue #65)

## Purpose and scope

**Status: Git-only / not deployed.** This change is manual and opt-in. Merging it does not install anything, change a running service or reboot production. A service cutover requires separate explicit approval, and a controlled reboot requires a **second** separate approval.

On 2026-11-24 the Node Exporter 1.12.1 direct bind to `100.117.155.53:9100` failed briefly at boot because the Tailscale address had not yet been assigned. `Restart=on-failure` recovered approximately five seconds later. Read-only checks on 2026-11-25 confirmed service enabled, `tailscaled` active, `tailscale0` eventually assigned `100.117.155.53/32`, `net.ipv4.ip_nonlocal_bind=0`, and the installed Node Exporter advertises `--[no-]web.systemd-socket`.

`network-online.target` or simply `After=tailscaled.service` do not guarantee the specific IP is assigned. Instead, the native systemd socket with `FreeBind=yes` binds **only** `100.117.155.53:9100` even before the interface has that IP, without changing the global sysctl. Node Exporter inherits the listening FD via `--web.systemd-socket`, avoiding any additional proxy process. See [upstream example](https://github.com/prometheus/node_exporter/tree/master/examples/systemd) and [systemd.socket reference](https://www.freedesktop.org/software/systemd/man/latest/systemd.socket).

## Repository-owned configuration

- `ops/systemd/node_exporter.socket` → `/etc/systemd/system/node_exporter.socket`: `ListenStream=100.117.155.53:9100`, `FreeBind=yes`, `Accept=no`. Source access is default-deny with only `IPAddressAllow=100.78.90.38/32` (the central `shared` Prometheus host). Existing Tailscale ACLs and UFW are unchanged. Do not add a wildcard listener or `BindToDevice=tailscale0`.
- `ops/systemd/node_exporter-socket-activation.conf` → `/etc/systemd/system/node_exporter.service.d/zzzz-childbex-socket.conf`: `Requires=node_exporter.socket` and `After=node_exporter.socket` ensure the socket is created before the **still-enabled** service begins, even at boot. The effective command switches to `--web.systemd-socket`.
- The pre-existing `textfile.conf` and `zz-childbex-collectors.conf` (Issue #64) remain untouched. `zzzz-` sorts after both and retains the textfile path and **all 11** `--no-collector.*` options. `conntrack` remains enabled for `node_nf_conntrack_entries` and `node_nf_conntrack_entries_limit`. No existing systemd hardening, including `ProtectClock=yes`, is relaxed.
- `ops/install/install-node-exporter-socket-activation.sh` provides guarded `--check`, `--install`, `--verify` and `--rollback` modes; never invoked by app/ML deployment or the general ops installer.

The separate ChildBEx app metrics socket at port 9200, Keycloak, PostgreSQL, Nginx, ML, DICOM data and backups are outside this task.

## Offline validation

Run in the **reviewed and pinned commit** of the Issue #65 branch (not a moving branch or production checkout with drift):

~~~bash
bash -n ops/install/install-node-exporter-socket-activation.sh
bash ops/tests/test-node-exporter-socket-activation.sh
bash ops/tests/test-node-exporter-collectors.sh
~~~

CI executes these checks. The socket test validates a temporary stub service using `systemd-analyze verify` on compatible systems.

## Read-only production preflight

Do not proceed until independent review and successful CI. On `childbex`, in the exact approved checkout:

~~~bash
sudo bash ops/install/install-node-exporter-socket-activation.sh --check
systemctl --no-pager cat node_exporter.service
systemctl --no-pager show node_exporter.service -p DropInPaths -p ExecStart -p ProtectClock
sudo ss -H -ltnp 'sport = :9100'
~~~

Expected: exactly one direct-bind listener at `100.117.155.53:9100`; existing exporter active and enabled; only `textfile.conf` and `zz-childbex-collectors.conf`; collector file exactly matches the approved Issue #64 source; no `node_exporter.socket` or conflicting drop-in; installed binary supports native activation. **Stop on any drift.** Do not change Tailscale, firewall or global `ip_nonlocal_bind` to pass preflight.

## Controlled cutover — separate owner authorization required

**Brief telemetry interruption. No reboot.** The installer stages exactly two new files, reloads systemd, checks units, stops the direct-binding exporter **before** enabling/starting the new socket on port 9100, then starts the exporter with native FD inheritance. It validates the active units, effective command, selected collectors and exact listening address. Any failure triggers a best-effort automatic rollback to the original direct-binding service; loss of host power or SIGKILL can interrupt cleanup, so always inspect state before re-running.

~~~bash
sudo bash ops/install/install-node-exporter-socket-activation.sh --install
sudo bash ops/install/install-node-exporter-socket-activation.sh --verify
~~~

**Important security detail:** the new socket intentionally accepts only the `shared` host `100.78.90.38/32`. A local HTTP request originating from `childbex` itself may legitimately be blocked. **Do not** add the local address to the allowlist merely to make a local curl pass. The installer therefore verifies socket/service state locally; actual HTTP metrics must be checked **from `shared`** before accepting deployment.

Read-only post-cutover state checks on `childbex`:

~~~bash
systemctl --no-pager is-enabled node_exporter.service node_exporter.socket
systemctl --no-pager is-active node_exporter.service node_exporter.socket
systemctl --no-pager show node_exporter.service -p DropInPaths -p ExecStart -p ProtectClock
systemctl --no-pager show node_exporter.socket -p Listen -p IPAddressAllow -p IPAddressDeny
sudo ss -H -ltnp 'sport = :9100'
sudo journalctl --no-pager -u node_exporter.service -u node_exporter.socket -n 50
~~~

Expected: service and socket enabled and active; port bound **only** at `100.117.155.53:9100`; service effective command contains `--web.systemd-socket`, the textfile collector and 11 disabled collectors; sandbox unchanged.

From `shared`, verify via Prometheus `http://127.0.0.1:9090/api/v1/query`:

~~~promql
up{job="childbex-node"}
node_textfile_scrape_error{job="childbex-node"}
keycloak_release_check_success{job="childbex-node",deployment="childbex"}
server_apt_collector_success{job="childbex-node"}
node_scrape_collector_success{job="childbex-node"} == 0
node_nf_conntrack_entries{job="childbex-node"}
node_nf_conntrack_entries_limit{job="childbex-node"}
~~~

Expected: `up=1`, textfile errors `0`, Keycloak/APT success `1`, both conntrack gauges present and only `conntrack` unsuccessful. Also verify `shared` can fetch the Node Exporter endpoint and **an unauthorized Tailscale client cannot**. Socket-filter enforcement must be proved on the actual host, not inferred solely from a unit file. If central metrics do not recover, stop and use the guarded rollback.

## Scoped rollback — separate approval

The rollback refuses to remove files if either installed file differs from the reviewed Git source. It stops Node Exporter, disables/stops only `node_exporter.socket`, removes only the two Issue #65 files, reloads systemd and restarts the unmodified direct-binding service (retaining Issue #64 collector selection).

~~~bash
sudo bash ops/install/install-node-exporter-socket-activation.sh --rollback
~~~

Verify Node Exporter and `shared` Prometheus again. Rollback restores the **original boot race**, so Issue #65 remains open if rolled back.

## Second acceptance gate: separately approved reboot

A successful cutover does **not** close Issue #65. Once independently authorized, perform a controlled reboot and validate:

~~~bash
systemctl --no-pager is-active node_exporter.service node_exporter.socket
systemctl --no-pager show node_exporter.service -p Result -p ExecMainStatus -p DropInPaths
sudo journalctl --no-pager -b -u node_exporter.service -u node_exporter.socket
sudo ss -H -ltnp 'sport = :9100'
~~~

No `bind: cannot assign requested address`; no manual startup; the same shared Prometheus target, all Issue #64 selected collector metrics and textfile sources remain healthy, and IP restrictions remain enforced. **Only then close #65.**
