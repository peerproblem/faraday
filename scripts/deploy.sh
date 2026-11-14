#!/bin/bash
# Ships the working tree to the Vultr box as a new release, builds it there, migrates the DB and switches over.
#   /opt/faraday/releases/<ts>/   one directory per deploy, the newest 3 are kept
#   /opt/faraday/app              symlink to the live release (the units run from here)
#   /opt/faraday/shared/.env      the production env, linked into every release as .env
# The first run converts the old layout (a plain /opt/faraday/app directory and faraday-engine.service).
# If the new release fails its health checks, the symlink, units and Caddyfile go back to the previous release.
# DB migrations only add things, so they are not rolled back.
# Usage: scripts/deploy.sh [ssh-host]   (default host alias: faraday)
set -euo pipefail
HOST="${1:-faraday}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TS="$(date -u +%Y%m%d%H%M%S)"
REL="/opt/faraday/releases/$TS"

echo "[deploy] release $TS -> $HOST"
ssh "$HOST" "mkdir -p /opt/faraday/releases /opt/faraday/shared /opt/faraday/backups"
rsync -az --delete \
  --exclude .git --exclude .env --exclude AGENTS.md --exclude CLAUDE.md --exclude node_modules --exclude .next \
  --exclude '*.tsbuildinfo' --exclude next-env.d.ts --exclude .vercel --exclude .hov --exclude .eval \
  --exclude e2e/out --exclude .vscode --exclude .DS_Store \
  "$ROOT/" "$HOST:$REL/"

ssh "$HOST" "REL='$REL' TS='$TS' bash -s" <<'REMOTE'
set -Eeuo pipefail
BASE=/opt/faraday
APP=$BASE/app
SHARED=$BASE/shared
UNITS="faraday-worker faraday-api faraday-web"
log() { echo "[deploy] $*"; }
as_app() { runuser -u faraday -- env HOME=$BASE bash -c "$1"; }

# 1. Shared env. The first run copies it out of the old app directory.
if [ ! -f "$SHARED/.env" ]; then
  if [ -f "$APP/.env" ]; then
    cp -pL "$APP/.env" "$SHARED/.env"
    log "moved the production .env to $SHARED/.env"
  else
    echo "Missing $SHARED/.env (and no $APP/.env to take it from)"; exit 1
  fi
fi
chown faraday:faraday "$SHARED" "$SHARED/.env" "$BASE/releases" "$BASE/backups"
chmod 600 "$SHARED/.env"
chmod 750 "$BASE/backups"
ln -sfn "$SHARED/.env" "$REL/.env"
chown -R faraday:faraday "$REL"

# 2. Build in the release directory. Nothing live changes until step 4. A failure here drops the release.
trap 'log "build failed, removing $REL"; rm -rf "$REL"' ERR
log "installing and building"
as_app "cd '$REL/server' && npm ci --no-audit --no-fund --loglevel=error"
as_app "cd '$REL/client' && npm ci --no-audit --no-fund --loglevel=error && npx next build"

# 3. Migrate. Additive only, so the running old release keeps working against the new schema.
log "migrating the database"
as_app "cd '$REL/server' && npm run migrate"

# 4. Switch.
PREV=""
LEGACY=0
if [ -L "$APP" ]; then
  PREV="$(readlink -f "$APP")"
elif [ -d "$APP" ]; then
  LEGACY=1
  PREV="$BASE/releases/00000000000000-legacy"
fi

[ -f /etc/caddy/Caddyfile ] && cp -p /etc/caddy/Caddyfile /etc/caddy/Caddyfile.prev
install -m 644 "$REL/scripts/Caddyfile" /etc/caddy/Caddyfile.next
caddy validate --config /etc/caddy/Caddyfile.next --adapter caddyfile >/dev/null
mkdir -p "$SHARED/units.prev"
for u in faraday-api faraday-worker faraday-web faraday-engine; do
  [ -f "/etc/systemd/system/$u.service" ] && cp -p "/etc/systemd/system/$u.service" "$SHARED/units.prev/"
done

rollback() {
  set +e
  log "health checks failed, rolling back to ${PREV:-nothing}"
  journalctl -u faraday-api -u faraday-worker -u faraday-web -n 40 --no-pager
  [ -f /etc/caddy/Caddyfile.prev ] && cp -p /etc/caddy/Caddyfile.prev /etc/caddy/Caddyfile
  if [ -z "$PREV" ]; then
    systemctl stop $UNITS
  elif [ "$LEGACY" = 1 ]; then
    systemctl stop faraday-worker faraday-api
    systemctl disable faraday-worker faraday-api >/dev/null 2>&1
    ln -sfn "$PREV" "$BASE/app.next" && mv -T "$BASE/app.next" "$APP"
    cp -p "$SHARED/units.prev/faraday-engine.service" "$SHARED/units.prev/faraday-web.service" /etc/systemd/system/
    systemctl daemon-reload
    systemctl enable --now faraday-engine >/dev/null 2>&1
    systemctl restart faraday-web
  else
    ln -sfn "$PREV" "$BASE/app.next" && mv -T "$BASE/app.next" "$APP"
    cp -p "$SHARED/units.prev/"faraday-{api,worker,web}.service /etc/systemd/system/ 2>/dev/null
    systemctl daemon-reload
    systemctl restart $UNITS
  fi
  systemctl reload caddy || systemctl restart caddy
  systemctl is-active faraday-engine faraday-api faraday-worker faraday-web caddy
  exit 1
}

trap rollback ERR
if [ "$LEGACY" = 1 ]; then
  log "converting the old layout: stopping faraday-engine, moving $APP to $PREV"
  systemctl stop faraday-engine 2>/dev/null || true
  systemctl disable faraday-engine >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/faraday-engine.service
  rm -rf "$PREV"
  mv "$APP" "$PREV"
fi

ln -sfn "$REL" "$BASE/app.next"
mv -T "$BASE/app.next" "$APP"
install -m 644 "$REL/scripts/faraday-api.service" "$REL/scripts/faraday-worker.service" "$REL/scripts/faraday-web.service" \
  "$REL/scripts/faraday-backup.service" "$REL/scripts/faraday-backup.timer" /etc/systemd/system/
install -m 750 "$REL/scripts/backup.sh" /usr/local/sbin/faraday-backup
mv /etc/caddy/Caddyfile.next /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable $UNITS faraday-backup.timer >/dev/null 2>&1
systemctl start faraday-backup.timer
log "restarting worker, api, web"
systemctl restart faraday-worker
systemctl restart faraday-api
systemctl restart faraday-web
systemctl reload caddy || systemctl restart caddy

# 5. Health checks.
wait_for() { # url, seconds
  for _ in $(seq 1 "$2"); do curl -fsS --max-time 5 -o /dev/null "$1" 2>/dev/null && return 0; sleep 1; done
  echo "timed out waiting for $1"; return 1
}
wait_for http://127.0.0.1:4000/health 40
curl -fsS --max-time 5 http://127.0.0.1:4000/health && echo
wait_for http://127.0.0.1:3000/ 60
restarts_before="$(systemctl show -p NRestarts --value faraday-worker)"
sleep 10
systemctl is-active --quiet faraday-worker faraday-api faraday-web
[ "$(systemctl show -p NRestarts --value faraday-worker)" = "$restarts_before" ] || { echo "faraday-worker is restarting"; false; }
trap - ERR

# Optional: one real board through Caddy and its certificate. A failure here only warns.
DOMAIN="$(grep -E '^FARADAY_DOMAIN=' "$SHARED/.env" | tail -1 | cut -d= -f2- | tr -d '"' || true)"
DBNAME="$(grep -E '^DATABASE_URL=' "$SHARED/.env" | tail -1 | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#' || true)"
SLUG="$(mariadb -N -e "SELECT slug FROM \`${DBNAME:-faraday}\`.boards WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1" 2>/dev/null || true)"
if [ -n "$DOMAIN" ] && [ -n "$SLUG" ]; then
  if curl -fsS --max-time 15 -o /dev/null --resolve "$SLUG.$DOMAIN:443:127.0.0.1" "https://$SLUG.$DOMAIN/"; then
    log "board host ok: https://$SLUG.$DOMAIN/"
  else
    log "warning: https://$SLUG.$DOMAIN/ did not answer 200 through Caddy"
  fi
fi

# 6. Keep the newest 3 releases (never the live one).
LIVE="$(readlink -f "$APP")"
ls -1d "$BASE"/releases/*/ 2>/dev/null | sed 's#/$##' | sort -r | tail -n +4 | while read -r old; do
  [ "$old" = "$LIVE" ] || { rm -rf "$old"; log "removed old release $(basename "$old")"; }
done

systemctl is-active faraday-api faraday-worker faraday-web caddy mariadb faraday-backup.timer
log "live: $(basename "$LIVE")"
REMOTE
