# Chrony NTS egress (ChildBEx)

## Incident and ownership

On 2026-11-24, Chrony on `childbex` was running but not synchronised (`Stratum: 0`, `Leap status: Not synchronised`). NTS key exchange to Ubuntu time servers repeatedly timed out. The server's UFW baseline was `deny (outgoing)` with UDP 123 allowed but **TCP 4460 omitted**. After allowing outbound TCP 4460, Chrony selected an authenticated NTS source and corrected a clock error of about 308 seconds. Keycloak OIDC and an interactive login were checked afterwards.

**ChildBEx owns this narrow UFW exception** in `ops/install/install-chrony-nts-ufw.sh`. Other UFW rules and the default policy remain server-managed until the wider ops source-of-truth work in issue #9. This script is deliberately **not called by the main ops installer or application deploys**. Shared Prometheus/Alertmanager policy remains in `shared-infrastructure`.

- NTS key exchange: **outbound TCP 4460**.
- NTP time packets: **outbound UDP 123** (already present in the production UFW baseline; the script does not alter it).
- No incoming ports, broad egress policy changes, or service restarts are required by this UFW installer.

## Read-only verification

From an up-to-date checkout on `childbex`:

```bash
sudo bash ops/install/install-chrony-nts-ufw.sh --verify
sudo ufw status verbose
chronyc tracking
sudo chronyc -N authdata
```

Expected: an `ALLOW OUT` rule for `4460/tcp` (IPv4 and IPv6 if UFW IPv6 is enabled), `Leap status: Normal`, and NTS authentication information. Network reachability alone does not establish that Chrony is synchronised.

## Controlled installation (new or rebuilt host only)

**Production already has this rule as of 2026-11-24.** Do not run this without checking the existing firewall configuration. The operation is idempotent and modifies only the outbound 4460/tcp exception:

```bash
sudo bash ops/install/install-chrony-nts-ufw.sh --install
sudo bash ops/install/install-chrony-nts-ufw.sh --verify
```

Chrony may have backed off retrying NTS after earlier failures. Inspect `journalctl -u chrony.service`, `chronyc sources -v`, and `chronyc tracking` before deciding whether intervention is necessary.

**Production safety:** the existing `/etc/chrony/chrony.conf` contains `makestep 1 3`. After NTS starts working, Chrony can automatically step the system clock if the error is large; this happened on 2026-11-24. A large time jump can affect Keycloak/OIDC tokens, session validation, logs, and scheduled jobs. For a future incident involving significant drift, schedule the change appropriately and verify OIDC and interactive authentication afterwards. This script itself does not invoke `makestep` or restart Chrony.

## Troubleshooting and rollback

If `--verify` fails, inspect `sudo ufw status verbose` and `/etc/default/ufw` (`IPV6=yes` controls whether a v6 rule is expected). If network connectivity succeeds but Chrony still says `Not synchronised`, inspect `sudo chronyc -N authdata` and `sudo journalctl -u chrony.service`; do not conclude success based solely on an open TCP port.

Only remove the rule if intentionally retiring NTS or replacing it with a proven alternate clock-synchronisation path. Review `sudo ufw status numbered` before any deletion; **do not disable the exception while Chrony still depends on it**. Removing it reintroduces the known failure on a `deny outgoing` host.

Validation of repository script syntax:

```bash
bash -n ops/install/install-chrony-nts-ufw.sh
bash ops/tests/test-chrony-nts-ufw.sh
```
