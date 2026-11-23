#!/bin/sh
set -eu

# Nginx reads these Let's Encrypt lineages directly. Reload only after
# a successful renewal of either web certificate.
case "${RENEWED_LINEAGE:-}" in
  /etc/letsencrypt/live/app.childbex.com|/etc/letsencrypt/live/childbex.com)
    /usr/sbin/nginx -t
    /usr/bin/systemctl reload nginx
    /usr/bin/logger -t certbot-nginx "Nginx reloaded after ChildBEx web certificate renewal"
    ;;
esac
