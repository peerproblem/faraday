#!/bin/bash
# Runs the engine api and worker together for development. Needs DATABASE_URL (the Aiven for MySQL service,
# mysql://...?ssl-mode=REQUIRED) and DATABASE_CA (base64 of the Aiven CA PEM) in the root .env.
set -euo pipefail
cd "$(dirname "$0")/../server"
trap 'kill 0' EXIT
npx tsx watch --env-file-if-exists=../.env src/api.ts &
npx tsx watch --env-file-if-exists=../.env src/worker.ts &
wait
