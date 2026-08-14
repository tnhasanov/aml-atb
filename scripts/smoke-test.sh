#!/usr/bin/env bash
# Post-deploy verification.
#
# Run after every deploy, before telling anyone the tool is available.
# Usage:  scripts/smoke-test.sh https://aml.internal.example.az [audit-dir]
set -uo pipefail

BASE="${1:-https://localhost}"
AUDIT_DIR="${2:-/var/lib/aml-atb/audit}"
APP_PORT="${APP_PORT:-3000}"
fail=0

check() { # name, expected, actual
  if [ "$2" = "$3" ]; then printf '  ok    %-46s %s\n' "$1" "$3"
  else printf '  FAIL  %-46s got %s, want %s\n' "$1" "$3" "$2"; fail=1; fi
}

code() { curl -sk -o /dev/null -w '%{http_code}' --max-time 15 "$@"; }

echo "smoke test: $BASE"

# 1. The service is up, and says so without needing a session.
check "liveness /healthz" 200 "$(code "$BASE/healthz")"

# 2. Readiness covers the audit trail: 503 here means it is not writable, and
#    the app is refusing to answer rather than advising with no record.
check "readiness /readyz" 200 "$(code "$BASE/readyz")"

# 3. Nothing behind the auth gate is reachable without a session. 302 is a
#    sign-in redirect, 401/403 a hard refusal; all three are acceptable.
for path in / /api/health /api/chat /api/clause?id=8.1; do
  got=$(code "$BASE$path")
  case "$got" in
    302|401|403) printf '  ok    %-46s %s\n' "unauthenticated $path" "$got" ;;
    *) printf '  FAIL  %-46s got %s, want 302/401/403\n' "unauthenticated $path" "$got"; fail=1 ;;
  esac
done

# 4. A client must not be able to assert an identity.
got=$(code -H 'X-Forwarded-User: attacker' "$BASE/api/health")
case "$got" in
  302|401|403) printf '  ok    %-46s %s\n' "header spoofing rejected" "$got" ;;
  *) printf '  FAIL  %-46s got %s\n' "header spoofing rejected" "$got"; fail=1 ;;
esac

# 5. The app port must not be reachable except through the proxy.
if command -v ss >/dev/null; then
  if ss -lntH "sport = :$APP_PORT" 2>/dev/null | grep -qE '^\S+\s+\S+\s+\S+\s+(127\.0\.0\.1|\[::1\]):'; then
    printf '  ok    %-46s loopback only\n' "app bound on :$APP_PORT"
  else
    printf '  FAIL  %-46s not loopback-only\n' "app bound on :$APP_PORT"; fail=1
  fi
fi

# 6. The audit trail must verify. A break means a record was altered after
#    it was written, and is a reportable integrity failure - not a warning.
if [ -d "$AUDIT_DIR" ]; then
  if node "$(dirname "$0")/../tools/verify-audit.mjs" "$AUDIT_DIR" >/dev/null 2>&1; then
    printf '  ok    %-46s chain intact\n' "audit trail"
  else
    printf '  FAIL  %-46s CHAIN BROKEN - investigate before use\n' "audit trail"; fail=1
  fi
  perms=$(stat -c '%a' "$AUDIT_DIR" 2>/dev/null || echo '?')
  check "audit dir permissions" 700 "$perms"
fi

echo
if [ "$fail" -eq 0 ]; then echo "all checks passed"; else echo "FAILURES - do not release to users"; fi
exit $fail
