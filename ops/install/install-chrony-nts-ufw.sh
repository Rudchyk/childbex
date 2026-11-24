#!/usr/bin/env bash
# Repository-owned ChildBEx UFW exception for Chrony NTS key exchange.
set -Eeuo pipefail

usage() {
  echo "Usage: $0 --verify|--install" >&2
  exit 2
}

[[ $# -eq 1 ]] || usage
mode="$1"
[[ "$mode" == "--verify" || "$mode" == "--install" ]] || usage
command -v ufw >/dev/null 2>&1 || { echo "FAIL: ufw is not installed" >&2; exit 1; }

# Keep IPv6 behavior consistent with /etc/default/ufw. Override is for tests.
ufw_defaults="${CHILDBEX_UFW_DEFAULTS:-/etc/default/ufw}"

active_status() {
  local status
  status="$(ufw status verbose)"
  grep -Eq '^Status:[[:space:]]+active$' <<< "$status"
}

verify_rule() {
  local status
  status="$(ufw status verbose)"
  grep -Eq '^Status:[[:space:]]+active$' <<< "$status" || {
    echo "FAIL: UFW is not active" >&2
    return 1
  }
  grep -Eq '^4460/tcp[[:space:]]+ALLOW OUT[[:space:]]+Anywhere([[:space:]]|$)' <<< "$status" || {
    echo "FAIL: missing outbound TCP 4460 IPv4 allow rule" >&2
    return 1
  }
  if [[ -f "$ufw_defaults" ]] && grep -Eq '^[[:space:]]*IPV6=yes[[:space:]]*$' "$ufw_defaults"; then
    grep -Eq '^4460/tcp \(v6\)[[:space:]]+ALLOW OUT[[:space:]]+Anywhere \(v6\)([[:space:]]|$)' <<< "$status" || {
      echo "FAIL: missing outbound TCP 4460 IPv6 allow rule" >&2
      return 1
    }
  fi
}

if [[ "$mode" == "--install" ]]; then
  [[ "$EUID" -eq 0 ]] || { echo "FAIL: --install requires root" >&2; exit 1; }
  active_status || { echo "FAIL: UFW must already be active" >&2; exit 1; }
  if verify_rule >/dev/null 2>&1; then
    echo "PASS: Chrony NTS-KE UFW rule already present"
    exit 0
  fi
  # UFW automatically creates IPv6 equivalent when IPV6=yes.
  ufw allow out 4460/tcp comment 'Chrony NTS-KE'
fi

verify_rule
echo 'PASS: outbound TCP 4460 allowed for Chrony NTS-KE'
