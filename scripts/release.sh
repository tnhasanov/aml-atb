#!/usr/bin/env bash
# Build a deployable artefact.
#
# Produces dist/aml-atb-<version>-<git sha>.tar.gz containing everything the
# service needs and nothing else. Build here, ship the tarball, unpack there -
# the target host needs no toolchain, no network and no npm registry access,
# which is usually what a bank's change process requires.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
SHA=$(git rev-parse --short HEAD 2>/dev/null || echo nogit)
NAME="aml-atb-${VERSION}-${SHA}"
OUT="release/${NAME}"

echo "==> building ${NAME}"
rm -rf release && mkdir -p "$OUT"

# The corpus must match the source document, or the tool cites text the
# regulation does not contain.
echo "==> regenerating corpus from the source document"
python3 tools/extract_rules.py
if ! git diff --quiet data/rules.json 2>/dev/null; then
  echo "FAIL: data/rules.json does not match what the .docx yields - commit the regenerated corpus" >&2
  exit 1
fi

echo "==> typecheck + tests"
npm run typecheck
npm test

echo "==> compiling"
rm -rf dist && npx tsc

echo "==> installing production dependencies"
npm ci --omit=dev --prefix "$OUT" --no-audit --no-fund >/dev/null 2>&1 || {
  cp package.json package-lock.json "$OUT/"
  (cd "$OUT" && npm ci --omit=dev --no-audit --no-fund >/dev/null)
}

cp -r dist data public "$OUT/"
cp package.json package-lock.json "$OUT/"
mkdir -p "$OUT/tools" && cp tools/verify-audit.mjs "$OUT/tools/"
cp -r deploy "$OUT/"

cat > "$OUT/VERSION" <<META
version=${VERSION}
git=${SHA}
built=$(date -u +%Y-%m-%dT%H:%M:%SZ)
node=$(node -v)
corpus_sha256=$(sha256sum data/rules.json | cut -d' ' -f1)
source_sha256=$(sha256sum data/source/*.docx | cut -d' ' -f1)
META

tar -czf "release/${NAME}.tar.gz" -C release "$NAME"
rm -rf "$OUT"
# Write the checksum relative to release/, so `cd release && sha256sum -c`
# works on the target host without rewriting paths.
(cd release && sha256sum "${NAME}.tar.gz" | tee "${NAME}.tar.gz.sha256")

echo
echo "==> release/${NAME}.tar.gz"
echo "    ship this plus its .sha256 to the target host"
