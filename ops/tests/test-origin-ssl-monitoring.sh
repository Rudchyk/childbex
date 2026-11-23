#!/usr/bin/env bash
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COLLECTOR="$REPO_ROOT/ops/monitoring/childbex-origin-ssl-metrics"
INSTALLER="$REPO_ROOT/ops/install/install-origin-ssl-monitoring.sh"
TMP="$(mktemp -d)"
trap 'rm -rf -- "$TMP"' EXIT

bash -n "$COLLECTOR"
bash -n "$INSTALLER"
bash -n "$REPO_ROOT/ops/install/install-production-deploy.sh"
bash "$INSTALLER" --check

mkdir -p "$TMP/metrics"
/usr/bin/openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
  -nodes -keyout "$TMP/key1.pem" -out "$TMP/cert1.pem" \
  -days 30 -subj '/CN=test-one' >/dev/null 2>&1
/usr/bin/openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
  -nodes -keyout "$TMP/key2.pem" -out "$TMP/cert2.pem" \
  -days 60 -subj '/CN=test-two' >/dev/null 2>&1
export CHILDBEX_ORIGIN_SSL_OUTPUT_DIR="$TMP/metrics"
export CHILDBEX_ORIGIN_SSL_APP_CERT="$TMP/cert1.pem"
export CHILDBEX_ORIGIN_SSL_SITE_CERT="$TMP/cert1.pem"
export CHILDBEX_ORIGIN_SSL_AUTH_NGINX_CERT="$TMP/cert1.pem"
export CHILDBEX_ORIGIN_SSL_AUTH_CERTBOT_CERT="$TMP/cert1.pem"

bash "$COLLECTOR"
grep -q '^childbex_origin_ssl_collector_success 1$' "$TMP/metrics/childbex_origin_ssl.prom"
grep -q '^childbex_origin_ssl_auth_matches_certbot 1$' "$TMP/metrics/childbex_origin_ssl.prom"
[[ "$(grep -c '^childbex_origin_ssl_certificate_expiry_timestamp_seconds{' "$TMP/metrics/childbex_origin_ssl.prom")" -eq 4 ]]

export CHILDBEX_ORIGIN_SSL_AUTH_CERTBOT_CERT="$TMP/cert2.pem"
if bash "$COLLECTOR"; then
  echo "FAIL: mismatched auth copy was not rejected" >&2
  exit 1
fi
grep -q '^childbex_origin_ssl_collector_success 0$' "$TMP/metrics/childbex_origin_ssl.prom"
grep -q '^childbex_origin_ssl_auth_matches_certbot 0$' "$TMP/metrics/childbex_origin_ssl.prom"

export CHILDBEX_ORIGIN_SSL_APP_CERT="$TMP/missing-cert.pem"
if bash "$COLLECTOR"; then
  echo "FAIL: missing certificate was not rejected" >&2
  exit 1
fi
grep -q '^childbex_origin_ssl_certificate_read_success{certificate="app.childbex.com",source="nginx"} 0$' "$TMP/metrics/childbex_origin_ssl.prom"

echo "PASS: origin SSL collector success, mismatch, missing certificate, atomic output"
