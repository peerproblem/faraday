#!/bin/bash
# Ships the working tree to the Vultr box, builds it there and restarts the services.
# The server keeps its own /opt/faraday/app/.env, which this script never overwrites.
# Usage: scripts/deploy.sh [ssh-host]   (default host alias: faraday)
set -euo pipefail
HOST="${1:-faraday}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

rsync -az --delete \
  --exclude .git --exclude .env --exclude AGENTS.md --exclude node_modules --exclude .next \
  --exclude '*.tsbuildinfo' --exclude next-env.d.ts --exclude .vercel \
  "$ROOT/" "$HOST:/opt/faraday/app/"

ssh "$HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
cd /opt/faraday/app
test -f .env || { echo "Missing /opt/faraday/app/.env"; exit 1; }
chown -R faraday:faraday /opt/faraday
chmod 600 .env
sudo -u faraday -H bash -c 'cd server && npm ci --no-audit --no-fund --loglevel=error'
sudo -u faraday -H bash -c 'cd client && npm ci --no-audit --no-fund --loglevel=error && npx next build'
install -m 644 scripts/faraday-engine.service scripts/faraday-web.service /etc/systemd/system/
install -m 644 scripts/Caddyfile /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl daemon-reload
systemctl enable --now faraday-engine faraday-web >/dev/null 2>&1
systemctl restart faraday-engine
sleep 2
systemctl restart faraday-web
systemctl reload caddy || systemctl restart caddy
sleep 3
systemctl is-active faraday-engine faraday-web caddy
curl -fsS http://127.0.0.1:4000/health && echo
REMOTE
