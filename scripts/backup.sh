#!/bin/bash
# Daily MariaDB dump, installed by deploy.sh as /usr/local/sbin/faraday-backup and run by faraday-backup.timer.
# Keeps 7 days of gzip files in /opt/faraday/backups. Runs as root (unix socket auth).
set -euo pipefail
umask 077
DIR=/opt/faraday/backups
ENV=/opt/faraday/shared/.env
DB=faraday
if [ -f "$ENV" ]; then
  url="$(grep -E '^DATABASE_URL=' "$ENV" | tail -1 | cut -d= -f2- | tr -d '"')"
  [ -n "$url" ] && DB="$(printf '%s' "$url" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"
fi
mkdir -p "$DIR"
out="$DIR/$DB-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
mariadb-dump --single-transaction --quick --routines --triggers --events --default-character-set=utf8mb4 "$DB" | gzip -6 > "$out.part"
mv "$out.part" "$out"
find "$DIR" -maxdepth 1 -name "$DB-*.sql.gz" -mtime +6 -delete
find "$DIR" -maxdepth 1 -name '*.part' -mmin +120 -delete
echo "backup written: $out ($(du -h "$out" | cut -f1))"
