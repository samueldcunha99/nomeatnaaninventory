#!/bin/sh
# Nightly database dump. Runs on the VPS, from cron, beside docker-compose.prod.yml.
#
#   0 2 * * *  cd /srv/cafe && ./backup.sh >> /var/log/cafe-backup.log 2>&1
#
# Custom format (-Fc), not plain SQL: it restores selectively, restores in parallel, and
# is compressed already. `pg_restore` reads it; `psql` does not.
#
# The dump is taken INSIDE the db container, so this box needs no postgres client and no
# published database port.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/srv/cafe/backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
DB_USER="${POSTGRES_USER:-cafe}"
DB_NAME="${POSTGRES_DB:-cafe}"
COMPOSE="${COMPOSE:-docker compose -f docker-compose.prod.yml}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/cafe-$STAMP.dump"

mkdir -p "$BACKUP_DIR"

# Write to .partial first and move on success: a half-written file that looks like a
# backup is worse than no file, because it is the one someone reaches for in a crisis.
$COMPOSE exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$OUT.partial"
mv "$OUT.partial" "$OUT"

SIZE="$(wc -c < "$OUT")"
# An empty or near-empty dump means the command failed in a way that still exited 0.
# 5 KB is far below a real dump of even an empty schema.
if [ "$SIZE" -lt 5120 ]; then
  echo "FAILED: $OUT is only $SIZE bytes; keeping it for inspection and exiting non-zero"
  exit 1
fi

echo "$STAMP  wrote $OUT ($SIZE bytes)"

# Off-site copy. A backup on the same disk as the database survives a bad migration and
# nothing else - not a failed disk, not a deleted droplet, not ransomware.
if [ -n "${R2_REMOTE:-}" ]; then
  rclone copy "$OUT" "$R2_REMOTE" && echo "$STAMP  copied to $R2_REMOTE"
else
  echo "$STAMP  WARNING: R2_REMOTE is not set, this backup exists only on this machine"
fi

# Prune last, so a failure above never deletes the older copies that still work.
find "$BACKUP_DIR" -name 'cafe-*.dump' -mtime "+$KEEP_DAYS" -print -delete
