#!/usr/bin/env bash
# Check a target host is ready BEFORE anything is installed.
#
# Every check here corresponds to a way the install or the first request fails.
# Run it on the target host; it changes nothing.
#
# Usage:  sudo scripts/preflight.sh [/etc/aml-atb/aml-atb.env]
set -uo pipefail

ENV_FILE="${1:-/etc/aml-atb/aml-atb.env}"
APP_PORT="${APP_PORT:-3000}"
warn=0
fail=0

ok()   { printf '  ok    %s\n' "$1"; }
bad()  { printf '  FAIL  %s\n' "$1"; fail=1; }
soft() { printf '  warn  %s\n' "$1"; warn=1; }

echo "preflight for aml-atb"
echo

# --- interpreter ------------------------------------------------------------
# The unit hardcodes an absolute path; a distro package and an nvm install put
# node in different places, and a mismatch fails at start with status 203.
if NODE=$(command -v node); then
  MAJOR=$(node -p 'process.versions.node.split(".")[0]')
  if [ "$MAJOR" -ge 22 ]; then ok "node $(node -v) at $NODE"
  else bad "node $(node -v) is too old; needs >= 22.6 (node:test, --env-file-if-exists)"; fi
  if [ "$NODE" != "/usr/bin/node" ]; then
    soft "node is at $NODE but deploy/aml-atb.service says /usr/bin/node - update ExecStart"
  fi
else
  bad "node not found on PATH"
fi

# --- service account and paths ---------------------------------------------
id aml >/dev/null 2>&1 && ok "service account 'aml' exists" || soft "service account 'aml' missing (install.sh creates it)"

for d in /opt/aml-atb /var/lib/aml-atb/audit; do
  if [ -d "$d" ]; then ok "$d exists"; else soft "$d missing (install.sh creates it)"; fi
done

if [ -d /var/lib/aml-atb/audit ]; then
  perms=$(stat -c '%a' /var/lib/aml-atb/audit)
  [ "$perms" = "700" ] && ok "audit dir is 0700" || bad "audit dir is $perms, must be 0700 (it holds customer data)"
fi

# The audit trail is append-only and never rotated; a full disk stops the
# service answering, by design.
avail=$(df -Pk /var/lib 2>/dev/null | awk 'NR==2{print int($4/1024)}')
[ "${avail:-0}" -ge 1024 ] && ok "free space on /var/lib: ${avail} MiB" || soft "only ${avail:-?} MiB free on /var/lib"

# --- ports ------------------------------------------------------------------
if command -v ss >/dev/null; then
  if ss -lntH "sport = :$APP_PORT" 2>/dev/null | grep -q .; then
    if ss -lntH "sport = :$APP_PORT" | grep -qE '(127\.0\.0\.1|\[::1\]):'; then
      ok "port $APP_PORT in use, loopback only (existing install)"
    else
      bad "port $APP_PORT is bound on a public interface by something else"
    fi
  else
    ok "port $APP_PORT free"
  fi
fi

# --- proxy ------------------------------------------------------------------
if command -v nginx >/dev/null; then
  NV=$(nginx -v 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
  ok "nginx $NV"
  # deploy/nginx.conf ships `listen ... http2`, deprecated from 1.25.1.
  if [ "$(printf '%s\n1.25.1\n' "$NV" | sort -V | head -1)" = "1.25.1" ] && [ "$NV" != "1.25.1" ]; then
    soft "nginx >= 1.25.1: replace 'listen 443 ssl http2;' with 'listen 443 ssl;' + 'http2 on;'"
  fi
  nginx -t >/dev/null 2>&1 && ok "existing nginx config valid" || soft "nginx -t currently fails - fix before adding the site"
else
  bad "nginx not installed (this deployment relies on it for TLS and authentication)"
fi

command -v oauth2-proxy >/dev/null && ok "oauth2-proxy present" \
  || soft "oauth2-proxy not found - required unless you authenticate with mTLS instead"

# --- configuration ----------------------------------------------------------
if [ -f "$ENV_FILE" ]; then
  perms=$(stat -c '%a' "$ENV_FILE")
  [ "$perms" = "600" ] && ok "$ENV_FILE is 0600" || bad "$ENV_FILE is $perms, must be 0600 (holds the API key)"

  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a

  [ -n "${ANTHROPIC_API_KEY:-}" ] && ok "ANTHROPIC_API_KEY set" || bad "ANTHROPIC_API_KEY not set in $ENV_FILE"
  case "${ANTHROPIC_API_KEY:-}" in
    *[[:space:]]*) bad "ANTHROPIC_API_KEY contains whitespace - the app refuses to start" ;;
  esac

  [ "${AUTH_MODE:-proxy}" = "none" ] && bad "AUTH_MODE=none must never be used in production" \
    || ok "AUTH_MODE=${AUTH_MODE:-proxy}"

  if [ -n "${AUTH_SHARED_SECRET:-}" ]; then
    [ "${#AUTH_SHARED_SECRET}" -ge 32 ] && ok "AUTH_SHARED_SECRET set (${#AUTH_SHARED_SECRET} chars)" \
      || bad "AUTH_SHARED_SECRET is only ${#AUTH_SHARED_SECRET} chars; use: openssl rand -hex 32"
  else
    bad "AUTH_SHARED_SECRET not set - anyone reaching port $APP_PORT could assert an identity"
  fi

  case "${BIND_HOST:-127.0.0.1}" in
    127.0.0.1|::1|localhost) ok "BIND_HOST=${BIND_HOST:-127.0.0.1} (loopback)" ;;
    *) bad "BIND_HOST=${BIND_HOST} exposes the app directly; it must sit behind the proxy" ;;
  esac

  [ "${AUDIT_DIR:-}" = "/var/lib/aml-atb/audit" ] && ok "AUDIT_DIR is the service-managed path" \
    || soft "AUDIT_DIR=${AUDIT_DIR:-unset}; ensure it is absolute, 0700 and owned by aml"
else
  soft "$ENV_FILE not present (install.sh writes a template)"
fi

# --- outbound reachability --------------------------------------------------
# A bank egress policy that blocks this is the most common first-request failure.
TARGET="${ANTHROPIC_BASE_URL:-https://api.anthropic.com}"
if command -v curl >/dev/null; then
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$TARGET/v1/models" \
         -H "x-api-key: ${ANTHROPIC_API_KEY:-none}" -H 'anthropic-version: 2023-06-01' 2>/dev/null)
  case "$code" in
    200) ok "reached $TARGET and authenticated" ;;
    401|403) bad "reached $TARGET but the key was rejected ($code)" ;;
    000) bad "cannot reach $TARGET - check egress policy, or set ANTHROPIC_BASE_URL to your gateway" ;;
    *) soft "$TARGET returned $code" ;;
  esac
fi

echo
if [ "$fail" -ne 0 ]; then echo "NOT READY - resolve the FAIL items above"; exit 1; fi
[ "$warn" -ne 0 ] && echo "ready, with warnings" || echo "ready"
exit 0
