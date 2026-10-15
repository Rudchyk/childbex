# ChildBEx DICOM download rate-limit remediation

## Status and ownership

- Incident: #29; production smoke-test follow-up: #27; broader ops migration: #9.
- The production Nginx configuration is currently server-local. This PR adds versioned, **proposed** sources for the rate-limit zones and one route-specific location; it does **not** take ownership of the entire Certbot-managed vhost.
- Nothing here is installed automatically by `ops/install/install-production-deploy.sh` or by the `app` / `ml` GitHub Actions deploy workflows.
- Apply to production **only after explicit approval**. Do not install or restart services as part of PR validation.

## Observed cause

On 2026-10-15, a production CT Series presented 361 images but only 239 loaded. Browser requests for authenticated DICOM files returned HTTP 503. The Nginx error log showed 122 rate-limit rejections by `req_per_ip` in the sampled log window (strong correlation, not proof of a one-to-one request mapping).

The live Nginx HTTPS host has server-level and `location /` request limiting at 10r/s with `burst=40 nodelay`. The authenticated file route is:

```text
GET /api/v1/patients/:id/images/:imageId/file
```

DWV currently submits the image URL list via `app.loadURLs(...)`, so a large Series can overwhelm the generic request limit.

## Proposed Nginx sources

- `ops/nginx/conf.d/99-ratelimit.conf` mirrors the observed global and upload zones unchanged and adds `dicom_per_ip` at 30r/s.
- `ops/nginx/snippets/childbex-dicom-location.conf` adds an anchored regex location for **only** the authenticated DICOM GET URL shape and uses `limit_req zone=dicom_per_ip burst=400 delay=40;`.
- The DICOM location is independently rate-limited; Nginx does not inherit the server-level `limit_req` when the selected location defines its own.
- The exact route preserves original URI through `proxy_pass` without a URI suffix. Authorization remains verified by the backend. The proxy explicitly passes the `Authorization` header.
- The existing `/uploads/` zone remains 50r/s, `burst=500 nodelay`; other API routes remain 10r/s, `burst=40 nodelay`.

These are **initial tuning values**, not guaranteed safe or optimal. `burst=400` can queue large request bursts, potentially increasing latency or origin load; inspect request durations, concurrency, CPU/memory and error counts in the controlled rollout. If a smaller burst and bounded DWV concurrency/retries are needed, change them in a separate reviewed follow-up.

### Security note: client IP behind Cloudflare

The configuration intentionally preserves `$binary_remote_addr` from the current live setup. When traffic arrives through a Cloudflare proxy, this may represent a proxy IP rather than a unique client and the rate-limit bucket may be shared. **Do not trust `CF-Connecting-IP` or `X-Forwarded-For` by merely switching a variable.** Set `set_real_ip_from` only after confirming trusted Cloudflare egress ranges, direct-origin access protection and whether this host is proxied; treat Real-IP hardening as a separate security-reviewed change.

## Read-only preflight on the production server

```bash
sudo nginx -T 2>/dev/null | grep -nE 'configuration file /etc/nginx/(conf.d/99-ratelimit|sites-enabled/app.childbex.com)|limit_req|limit_conn'
sudo readlink -f /etc/nginx/sites-enabled/app.childbex.com.conf
sudo systemctl is-active nginx childbex-app childbex-ml
```

Verify these files and zone definitions match the intended server. A drift or missing expected vhost is a **stop condition**. Do not overwrite unrelated production changes.

## Approved change procedure (manual only)

Run these steps in the existing ChildBEx repository checkout **on the production host**, after PR merge and explicit change approval. Do not create a new clone/worktree.

1. Identify the live vhost target, and back up the exact current files to a root-only location:

   ```bash
   SITE=$(sudo readlink -f /etc/nginx/sites-enabled/app.childbex.com.conf)
   test -n "$SITE" && sudo test -f "$SITE" || { echo 'STOP: unexpected vhost path'; exit 1; }
   sudo cp -a /etc/nginx/conf.d/99-ratelimit.conf /root/childbex-ratelimit.pre-dicom.conf.bak
   sudo cp -a "$SITE" /root/childbex-app-vhost.pre-dicom.conf.bak
   ```

2. Review differences; stop if live config differs in unrelated ways:

   ```bash
   sudo diff -u /etc/nginx/conf.d/99-ratelimit.conf ops/nginx/conf.d/99-ratelimit.conf || true
   ```

3. Once reviewed, install the rate-limit zones and the separate route snippet:

   ```bash
   sudo install -m 0644 ops/nginx/conf.d/99-ratelimit.conf /etc/nginx/conf.d/99-ratelimit.conf
   sudo install -D -m 0644 ops/nginx/snippets/childbex-dicom-location.conf /etc/nginx/snippets/childbex-dicom-location.conf
   ```

4. In the **HTTPS** `server` block of the vhost identified in step 1, add the following include **before** the existing `location /` (leave all Certbot-managed TLS directives untouched):

   ```nginx
   include /etc/nginx/snippets/childbex-dicom-location.conf;
   ```

5. Validate and then perform a reload only if validation succeeds:

   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   sudo systemctl is-active nginx childbex-app childbex-ml
   ```

   No app, ML, Keycloak, or database deployment is required for this Nginx-only change.

## Production validation

- In an authenticated radiologist browser, reopen the **same** 361-image Series with DevTools Network open (disable browser cache for this check). Confirm **361/361** loaded, no corresponding DICOM 503 responses, and no DWV stuck spinner.
- Compare rate-limit logs in the exact test time window; count by zone only. Avoid copying medical URLs, patient identifiers, tokens or full Nginx request lines to GitHub:

  ```bash
  sudo tail -n 10000 /var/log/nginx/error.log | grep -E 'limiting requests|limiting connections' | sed -E 's/.*by zone "([^"]+)".*/zone=\1/' | sort | uniq -c
  ```

- Check a small Series, one ordinary API route, `/uploads/`, and that unauthorized DICOM requests still fail with the backend's expected authentication/authorization response.
- Confirm Complete Review is not enabled if image loading remains partial/failed and that switching patient/Series does not mix slices/votes.
- Check `systemctl is-active nginx childbex-app childbex-ml`. Verify Tailscale metrics listener remains restricted/reachable as previously configured; do not change the metrics vhost.
- If 361/361 is not achieved or latency is excessive, **stop and roll back** rather than increasing global limits.
- Separately investigate Cloudflare Access CORS errors and request concurrency/retry behavior in DWV; neither is fixed by this Nginx configuration alone.

## Rollback

Restore both exact pre-change files, test, and reload Nginx:

```bash
SITE=$(sudo readlink -f /etc/nginx/sites-enabled/app.childbex.com.conf)
test -n "$SITE" && sudo test -f "$SITE" || { echo 'STOP: unexpected vhost path'; exit 1; }
sudo cp -a /root/childbex-app-vhost.pre-dicom.conf.bak "$SITE"
sudo cp -a /root/childbex-ratelimit.pre-dicom.conf.bak /etc/nginx/conf.d/99-ratelimit.conf
sudo nginx -t && sudo systemctl reload nginx
sudo systemctl is-active nginx childbex-app childbex-ml
```

The unused snippet may remain on disk because the restored vhost does not include it. Do not delete files or restart other services during rollback. Record the result in #29, and keep #27 open until full production smoke validation.
