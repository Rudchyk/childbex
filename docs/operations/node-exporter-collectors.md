# ChildBEx Node Exporter collector selection (Issue #64)

## Rationale and scope

Before and after the Ubuntu maintenance (#52), 12/49 default-enabled collectors returned `node_scrape_collector_success=0`. Ten optional subsystem interfaces are absent on this Hetzner VPS. `timex` emits no metrics and is likely blocked by existing `ProtectClock=yes` hardening. `conntrack` emits two useful series (`node_nf_conntrack_entries`, `node_nf_conntrack_entries_limit`) even though it reports `success=0` because `/proc/net/stat/nf_conntrack` is absent.

This opt-in service drop-in disables **11** collectors: `bcachefs`, `bonding`, `fibrechannel`, `infiniband`, `ipvs`, `nfs`, `nfsd`, `nvme`, `tapestats`, `timex`, `zfs`. It **retains** `conntrack`, the tailnet-only listener `100.117.155.53:9100`, and the existing textfile directory. No sandbox hardening is weakened.

The operator confirmed Grafana has no dashboards/monitoring configured. Active central Prometheus rule expressions have no direct references to these three metric families. A future dashboard/alert should be reviewed before changing this selection.

**This does not fix Issue #65**, the Node Exporter/Tailscale bind-on-boot race. If #65 changes the listener architecture, update this override rather than installing stale settings.

## Preflight (read-only on `childbex`)

Run from the matching reviewed Git checkout:

```bash
bash ops/tests/test-node-exporter-collectors.sh
systemctl cat node_exporter.service
systemctl is-active node_exporter.service
systemctl show node_exporter.service -p ExecStart -p ProtectClock -p DropInPaths
/usr/local/bin/node_exporter --version
/usr/local/bin/node_exporter --help 2>&1 | grep -F 'collector.timex'
sudo test ! -e /etc/systemd/system/node_exporter.service.d/zz-childbex-collectors.conf
sudo test ! -L /etc/systemd/system/node_exporter.service.d/zz-childbex-collectors.conf
```

**STOP on drift or unexpected systemd drop-ins.** The target system must still use the documented `/usr/local/bin/node_exporter`, `--web.listen-address=100.117.155.53:9100`, `--collector.textfile.directory=/var/lib/node_exporter/textfile_collector`, and `ProtectClock=yes`. Do not overwrite an existing override.

## Controlled install (requires separate production approval)

A Node Exporter restart briefly interrupts telemetry; no server reboot is necessary.

```bash
sudo install -d -o root -g root -m 0755 /etc/systemd/system/node_exporter.service.d
sudo install -o root -g root -m 0644 \
  ops/systemd/node_exporter-collectors.conf \
  /etc/systemd/system/node_exporter.service.d/zz-childbex-collectors.conf
sudo systemctl daemon-reload
sudo systemctl restart node_exporter.service
systemctl is-active node_exporter.service
systemctl cat node_exporter.service
```

The `ExecStart=` reset **overrides** the previous `textfile.conf` command, so the repository file intentionally repeats both original essential options. The drop-in filename **must sort after `textfile.conf`**: systemd applies drop-ins lexicographically; an earlier `90-*.conf` would silently be overridden by the existing `textfile.conf`. The test checks this required filename. Recheck all deployed drop-ins, especially if #65 was implemented in the meantime.

From `shared`, check:

```bash
curl -fsSG --data-urlencode 'query=up{job="childbex-node"}' http://127.0.0.1:9090/api/v1/query
curl -fsSG --data-urlencode 'query=node_scrape_collector_success{job="childbex-node"} == 0' http://127.0.0.1:9090/api/v1/query
curl -fsSG --data-urlencode 'query={job="childbex-node",__name__=~"node_nf_conntrack_(entries|entries_limit)|server_apt_collector_success|server_reboot_required|node_textfile_scrape_error"}' http://127.0.0.1:9090/api/v1/query
```

Expect `up=1`; only the preexisting `conntrack` collector reports `success=0`; both `node_nf_conntrack_*` series and APT/textfile metrics remain. If validation fails, inspect `journalctl -u node_exporter.service` and roll back.

## Rollback (requires separate production approval)

Verify the production file still matches the reviewed Git version. **Stop if it has drifted.**

```bash
sudo cmp -s \
  ops/systemd/node_exporter-collectors.conf \
  /etc/systemd/system/node_exporter.service.d/zz-childbex-collectors.conf \
  || { echo 'STOP: collector override differs from Git'; exit 1; }
sudo rm -- /etc/systemd/system/node_exporter.service.d/zz-childbex-collectors.conf
sudo systemctl daemon-reload
sudo systemctl restart node_exporter.service
systemctl is-active node_exporter.service
```

Only the Issue #64 drop-in is removed; the original service and `textfile.conf` are preserved. The original 12 failed collector results may reappear. Verify the shared scrape after rollback.
