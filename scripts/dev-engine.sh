#!/bin/bash
# Runs the engine api and worker together for development. Needs DATABASE_URL (e.g. the SSH tunnel to the VPS).
set -euo pipefail
cd "$(dirname "$0")/../server"
trap 'kill 0' EXIT
npx tsx watch --env-file-if-exists=../.env src/api.ts &
npx tsx watch --env-file-if-exists=../.env src/worker.ts &
wait
