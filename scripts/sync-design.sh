#!/bin/bash
# Pins the design system (@sw3/ui) to one commit of peerproblem/sw3.0-ui-sdk.
# Builds the SDK at that commit, packs it and puts the tarball in client/vendor, where the client
# installs it from. Vercel and the Vultr box need no access to the SDK repository this way.
#
# Usage: scripts/sync-design.sh <tag or commit>     (needs gh, signed in with access to the SDK repo)
# Patches in scripts/sw3-patches/*.patch are applied on top of the commit before the build, in name order.
# The SDK repository is frozen, so fixes Faraday needs live there.
# After it runs: read client/src/components/ui/MIGRATION.md, then typecheck, test and run the sweep.
set -euo pipefail
REF="${1:?Usage: scripts/sync-design.sh <tag or commit>}"
REPO="${SW3_REPO:-peerproblem/sw3.0-ui-sdk}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/client/vendor"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

gh repo clone "$REPO" "$WORK/sdk" -- --quiet
cd "$WORK/sdk"
git checkout --quiet "$REF"
SHA="$(git rev-parse HEAD)"
PATCHES=""
for p in "$ROOT"/scripts/sw3-patches/*.patch; do
  [ -e "$p" ] || continue
  git apply "$p"
  PATCHES="$PATCHES $(basename "$p")"
done
npm ci --ignore-scripts --no-audit --no-fund --loglevel=error
npm run build -w @sw3/ui >/dev/null
VERSION="$(node -p "require('./packages/ui/package.json').version")"
(cd packages/ui && npm pack --ignore-scripts --pack-destination "$WORK" >/dev/null 2>&1)

NAME="sw3-ui-$VERSION-${SHA:0:7}.tgz"
mkdir -p "$VENDOR"
rm -f "$VENDOR"/sw3-ui-*.tgz
cp "$WORK/sw3-ui-$VERSION.tgz" "$VENDOR/$NAME"
printf 'repo: %s\nref: %s\ncommit: %s\nversion: %s\npatches:%s\n' "$REPO" "$REF" "$SHA" "$VERSION" "${PATCHES:- none}" > "$VENDOR/SW3_VERSION"

cd "$ROOT/client"
# Naming the tarball re-reads it and refreshes its lockfile integrity. A rebuilt tarball can keep its
# name (same commit, new patches), and a plain install would keep the old copy.
rm -rf node_modules/@sw3/ui
npm install --no-audit --no-fund --loglevel=error "@sw3/ui@file:vendor/$NAME"
echo "@sw3/ui pinned to $REPO@${SHA:0:7} ($VERSION) as client/vendor/$NAME"
