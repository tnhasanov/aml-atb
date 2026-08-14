#!/usr/bin/env bash
# Install or upgrade aml-atb on a target host, idempotently.
#
# Releases are unpacked side by side and a `current` symlink is repointed, so an
# upgrade is atomic and a rollback is one symlink change plus a restart. The
# audit trail lives outside the release directory and is never touched.
#
# Usage:
#   sudo scripts/install.sh release/aml-atb-0.2.0-abc1234.tar.gz
#   sudo scripts/install.sh --rollback
#
# Env:
#   PREFIX=/opt/aml-atb   STATE=/var/lib/aml-atb   CONF=/etc/aml-atb
#   UNIT_PATH=/etc/systemd/system/aml-atb.service
#   DRY_RUN=1             print what would happen, change nothing
set -euo pipefail

PREFIX="${PREFIX:-/opt/aml-atb}"
STATE="${STATE:-/var/lib/aml-atb}"
CONF="${CONF:-/etc/aml-atb}"
SERVICE_USER="${SERVICE_USER:-aml}"
ENV_FILE="$CONF/aml-atb.env"
UNIT_PATH="${UNIT_PATH:-/etc/systemd/system/aml-atb.service}"
AUDIT_DIR="$STATE/audit"
DRY_RUN="${DRY_RUN:-}"

say()  { printf '==> %s\n' "$*"; }
run()  { if [ -n "$DRY_RUN" ]; then printf '    [dry-run] %s\n' "$*"; else eval "$@"; fi; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || [ -n "$DRY_RUN" ] || die "must run as root"

# --------------------------------------------------------------- rollback
if [ "${1:-}" = "--rollback" ]; then
  cd "$PREFIX/releases" 2>/dev/null || die "no releases directory at $PREFIX/releases"
  current=$(basename "$(readlink -f "$PREFIX/current")")
  previous=$(ls -1dt */ 2>/dev/null | sed 's#/##' | grep -v "^${current}$" | head -1)
  [ -n "$previous" ] || die "no previous release to roll back to"
  say "rolling back: $current -> $previous"
  run "ln -sfn '$PREFIX/releases/$previous' '$PREFIX/current'"
  run "systemctl restart aml-atb"
  say "rolled back. Verify: scripts/smoke-test.sh https://<host> $AUDIT_DIR"
  exit 0
fi

# --------------------------------------------------------------- install
TARBALL="${1:-}"
[ -n "$TARBALL" ] || die "usage: install.sh <release tarball> | --rollback"
[ -f "$TARBALL" ] || die "no such file: $TARBALL"

# Verify the artefact before it touches the host.
if [ -f "${TARBALL}.sha256" ]; then
  say "verifying checksum"
  ( cd "$(dirname "$TARBALL")" && sha256sum -c "$(basename "$TARBALL").sha256" ) >/dev/null \
    || die "checksum mismatch - do not install this artefact"
else
  printf 'warn: no %s.sha256 alongside the tarball; installing unverified\n' "$(basename "$TARBALL")" >&2
fi

# awk rather than `head -1`: head closes the pipe early, tar takes SIGPIPE, and
# `set -o pipefail` turns that into an aborted install.
RELEASE=$(tar -tzf "$TARBALL" | awk -F/ 'NR==1 {print $1; found=1} END {exit !found}')
[ -n "$RELEASE" ] || die "cannot determine release name from tarball"
say "installing $RELEASE"

# --- account and directories ------------------------------------------------
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  say "creating service account $SERVICE_USER"
  run "useradd --system --home '$PREFIX' --shell /usr/sbin/nologin '$SERVICE_USER'"
fi

run "mkdir -p '$PREFIX/releases' '$CONF' '$AUDIT_DIR'"
# The audit trail holds pasted customer names, FINs and PEP status.
run "chown -R '$SERVICE_USER:$SERVICE_USER' '$AUDIT_DIR'"
run "chmod 700 '$AUDIT_DIR'"

# --- unpack -----------------------------------------------------------------
if [ -d "$PREFIX/releases/$RELEASE" ]; then
  say "$RELEASE already unpacked, reusing"
else
  say "unpacking to $PREFIX/releases/$RELEASE"
  run "tar -xzf '$TARBALL' -C '$PREFIX/releases'"
  run "chown -R '$SERVICE_USER:$SERVICE_USER' '$PREFIX/releases/$RELEASE'"
fi

# --- configuration ----------------------------------------------------------
# Never overwrite an existing env file: it holds the API key and the shared
# secret, and clobbering it on upgrade would take the service down.
if [ -f "$ENV_FILE" ]; then
  say "keeping existing $ENV_FILE"
else
  say "writing $ENV_FILE template - EDIT IT BEFORE STARTING"
  SECRET=$(openssl rand -hex 32 2>/dev/null || head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  if [ -z "$DRY_RUN" ]; then
    install -m 600 /dev/stdin "$ENV_FILE" <<ENVEOF
# Set this before starting the service.
ANTHROPIC_API_KEY=
# Uncomment to route via an institutional gateway or DLP proxy:
# ANTHROPIC_BASE_URL=

BIND_HOST=127.0.0.1
AUTH_MODE=proxy
AUTH_SHARED_SECRET=$SECRET
AUDIT_DIR=$AUDIT_DIR
ENVEOF
  else
    printf '    [dry-run] write %s (mode 600, generated AUTH_SHARED_SECRET)\n' "$ENV_FILE"
  fi
fi
run "chmod 600 '$ENV_FILE'"

# --- systemd ----------------------------------------------------------------
UNIT_SRC="$PREFIX/releases/$RELEASE/deploy/aml-atb.service"
if [ -f "$UNIT_SRC" ] || [ -n "$DRY_RUN" ]; then
  say "installing systemd unit"
  # The unit hardcodes /usr/bin/node; correct it to whatever this host has.
  NODE_BIN=$(command -v node || echo /usr/bin/node)
  run "sed -e 's#^ExecStart=.*#ExecStart=$NODE_BIN $PREFIX/current/dist/src/index.js#' \
           -e 's#^ConditionPathExists=.*#ConditionPathExists=$PREFIX/current/dist/src/index.js#' \
           -e 's#^WorkingDirectory=.*#WorkingDirectory=$PREFIX/current#' \
           -e 's#^ReadWritePaths=.*#ReadWritePaths=$AUDIT_DIR#' \
           -e 's#^EnvironmentFile=.*#EnvironmentFile=$ENV_FILE#' \
           '$UNIT_SRC' > '$UNIT_PATH'"
  run "systemctl daemon-reload"
fi

# --- switch over ------------------------------------------------------------
PREVIOUS=$(readlink -f "$PREFIX/current" 2>/dev/null || true)
say "pointing current -> $RELEASE"
run "ln -sfn '$PREFIX/releases/$RELEASE' '$PREFIX/current'"

# Keep the previous two releases so a rollback is always possible.
if [ -z "$DRY_RUN" ]; then
  ( cd "$PREFIX/releases" && ls -1dt */ 2>/dev/null | sed 's#/##' | tail -n +4 | while read -r old; do
      [ "$old" = "$RELEASE" ] && continue
      say "pruning old release $old"; rm -rf "$old"
    done ) || true
fi

# --- start ------------------------------------------------------------------
if grep -q '^ANTHROPIC_API_KEY=$' "$ENV_FILE" 2>/dev/null; then
  say "ANTHROPIC_API_KEY is empty in $ENV_FILE - not starting the service"
  say "edit it, then: systemctl enable --now aml-atb"
  exit 0
fi

say "starting service"
run "systemctl enable --now aml-atb"
run "systemctl restart aml-atb"
sleep 2
if [ -z "$DRY_RUN" ] && ! systemctl is-active --quiet aml-atb; then
  printf 'error: service did not start. journalctl -u aml-atb -n 50\n' >&2
  if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$PREFIX/releases/$RELEASE" ]; then
    printf 'roll back with: %s --rollback\n' "$0" >&2
  fi
  exit 1
fi

say "installed $RELEASE"
cat <<NEXT

Next:
  1. nginx site   : cp $PREFIX/current/deploy/nginx.conf /etc/nginx/conf.d/aml-atb.conf
                    set server_name, certificates, and X-Auth-Secret to match $ENV_FILE
                    nginx -t && systemctl reload nginx
  2. identity     : cp $PREFIX/current/deploy/oauth2-proxy.cfg /etc/oauth2-proxy.cfg  (chmod 600)
  3. verify       : $PREFIX/current/scripts/smoke-test.sh https://<host> $AUDIT_DIR
  4. rollback     : $PREFIX/current/scripts/install.sh --rollback
NEXT
