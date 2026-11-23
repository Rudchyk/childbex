# ChildBEx Certbot renewal — repository-owned hooks

## Scope / source of truth

- Git manages only the **hook scripts** in `ops/certbot/renewal-hooks/deploy/`, their installer and this runbook.
- The production installer is `ops/install/install-production-deploy.sh`, which preflights and installs the hooks. The targeted installer is `ops/install/install-certbot-hooks.sh`.
- This work is an incremental part of [operations source-of-truth #9](https://github.com/Rudchyk/childbex/issues/9); it does **not** take ownership of the full server-local Nginx vhosts, Cloudflare dashboard or the other server configuration.
- Never commit Cloudflare API tokens, `/etc/letsencrypt/secrets/`, renewal private keys, issued certificates, or patient data.
- Preserve the existing `50-auth-childbex.sh` behavior: its source here mirrors the already installed production script, copying the renewed auth certificate to Keycloak-owned storage before an Nginx reload.

## Certificate ownership

| Lineage | Validation method | Post-renewal action |
| --- | --- | --- |
| `app.childbex.com` | DNS-01 using `dns-cloudflare` | `30-childbex-web.sh`: `nginx -t` then reload |
| `childbex.com` (and `www`) | Existing Certbot renewal configuration | `30-childbex-web.sh`: `nginx -t` then reload |
| `auth.childbex.com` | Existing Certbot renewal configuration | `50-auth-childbex.sh`: copy certificate/key for Keycloak, test and reload Nginx |

The `app.childbex.com` renewal configuration must remain on the server under
`/etc/letsencrypt/renewal/app.childbex.com.conf` with:
`authenticator = dns-cloudflare`, `dns_cloudflare_credentials = /etc/letsencrypt/secrets/cloudflare.ini`.
The credential file is **server-only**, owned by root with mode `0600`. The Cloudflare token needs `Zone:DNS:Edit` scoped to the `childbex.com` zone.

Certbot's existing `certbot.timer` schedules renewals. Its native hook directory runs `deploy/` scripts **after a successful renewal**; the web hook does not replace the certificate issuance process.

## Review, test and apply

From a checked-out reviewed `main` commit on the production host:

```bash
bash ops/tests/test-certbot-hooks.sh
bash ops/install/install-certbot-hooks.sh --check
sudo bash ops/install/install-certbot-hooks.sh --install
sudo bash ops/install/install-certbot-hooks.sh --verify
sudo certbot renew --cert-name app.childbex.com --dry-run
```

The full ops installer (`sudo bash ops/install/install-production-deploy.sh`) also preflights and installs these hooks. Prefer the targeted installer if only Certbot hooks changed.

**Stop condition:** preflight/installer fails when an installed hook is a symlink, unexpected file type or its bytes differ from Git. Review `sudo diff -u` locally before proceeding; do not paste paths containing credentials or any secret values. There is intentionally no force overwrite. If you approve a managed hook change in a later PR, use a reviewed migration procedure that backs up the actual production hook first.

Verify file modes/owners and expected lineage:

```bash
sudo ls -l /etc/letsencrypt/renewal-hooks/deploy/{30-childbex-web.sh,50-auth-childbex.sh}
sudo certbot certificates
sudo systemctl is-active nginx cloudflared childbex-app
```

Optionally verify the web hook without renewing a certificate (causes a **graceful Nginx reload**):

```bash
sudo env RENEWED_LINEAGE=/etc/letsencrypt/live/app.childbex.com \
  /etc/letsencrypt/renewal-hooks/deploy/30-childbex-web.sh
sudo journalctl -t certbot-nginx -n 5 --no-pager
```

`certbot renew --dry-run` validates DNS issuance in staging but does **not** by itself prove the deploy hook ran; use the explicit hook check above. Monitor certificate expiry and alert before 30/14/7 days.

## Production rollout and rollback

1. Compare the existing production `50-auth-childbex.sh` with its exact Git copy; preserve it on drift, don't overwrite.
2. Back up installed hook files to root-only storage before initial install, even when they match.
3. Run preflight, targeted install and verify as above.
4. Confirm a valid HTTPS certificate is served by Nginx, public unauthenticated `app.childbex.com` redirects to Cloudflare Access, and an authenticated DICOM Series is usable.
5. Roll back only the newly managed web hook by restoring its prior backup, or by removing it if it did not exist before. Leave the original auth hook untouched. A rollback of Certbot hooks does not require restarting the app, ML, Keycloak or database.

## Separate incident settings and temporary diagnostics

The November 2026 DICOM delivery slowdown improved when **HTTP/3 was disabled at Cloudflare's zone-level edge** while leaving HTTP/2 enabled; this is a temporary Cloudflare dashboard setting affecting the whole zone, **not** applied by these installers. The Tunnel's own QUIC connection is independent.

A temporary server-local diagnostic file `/etc/nginx/conf.d/90-childbex-dicom-diagnostics.conf` was used to measure transfer times. This file is **not** a Git-managed permanent Nginx configuration. After inspecting its contents against the original diagnostic `map`, `log_format` and conditional `access_log`, remove it in a separately reviewed cleanup, validate `nginx -t`, reload and verify production. Do not automatically remove unknown files or patient data from installers.
