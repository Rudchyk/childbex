#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALLER="$REPO_ROOT/ops/install/install-certbot-hooks.sh"
SRC="$REPO_ROOT/ops/certbot/renewal-hooks/deploy"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
export CHILDBEX_CERTBOT_HOOKS_DIR="$TMP_DIR/deploy"
mkdir -p "$CHILDBEX_CERTBOT_HOOKS_DIR"

bash -n "$INSTALLER"
bash -n "$REPO_ROOT/ops/install/install-production-deploy.sh"
bash -n "$SRC/30-childbex-web.sh"
bash -n "$SRC/50-auth-childbex.sh"

# Missing hooks are allowed only during preflight, not final verification.
bash "$INSTALLER" --check
if bash "$INSTALLER" --verify; then
  echo "FAIL: verification should reject missing hooks" >&2
  exit 1
fi

cp "$SRC/30-childbex-web.sh" "$SRC/50-auth-childbex.sh" "$CHILDBEX_CERTBOT_HOOKS_DIR/"
bash "$INSTALLER" --verify

# Existing server edits must not be silently replaced.
printf '\n# simulated server-local drift\n' >> "$CHILDBEX_CERTBOT_HOOKS_DIR/50-auth-childbex.sh"
if bash "$INSTALLER" --check; then
  echo "FAIL: preflight did not reject auth hook drift" >&2
  exit 1
fi

# Non-target lineages must not trigger privileged side effects.
RENEWED_LINEAGE=/etc/letsencrypt/live/unrelated.example   bash "$SRC/30-childbex-web.sh"
RENEWED_LINEAGE=/etc/letsencrypt/live/unrelated.example   bash "$SRC/50-auth-childbex.sh"

echo "PASS: Certbot hook syntax, preflight, verification and lineage isolation"
