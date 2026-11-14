#!/bin/bash
# Deploys the main site (faraday.watch) to Vercel from client/. The project is linked in client/.vercel.
# Usage: scripts/deploy-site.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/sync-spec.sh" --check
cd "$ROOT/client"
vercel deploy --prod --yes
