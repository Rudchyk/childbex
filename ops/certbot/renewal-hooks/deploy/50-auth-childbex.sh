#!/bin/bash
set -euo pipefail

# Keycloak's certificate lives outside /etc/letsencrypt; keep this
# deployment behavior unchanged when migrating the hook into Git.
if [ "${RENEWED_LINEAGE:-}" != "/etc/letsencrypt/live/auth.childbex.com" ]; then
    exit 0
fi

install -o keycloak -g keycloak -m 0644     "$RENEWED_LINEAGE/fullchain.pem"     /srv/secrets/auth.childbex.com/auth.childbex.com.pem

install -o keycloak -g keycloak -m 0600     "$RENEWED_LINEAGE/privkey.pem"     /srv/secrets/auth.childbex.com/auth.childbex.com.key

nginx -t
systemctl reload nginx
