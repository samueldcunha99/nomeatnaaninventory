#!/bin/sh
# Prove the newest backup restores. PROJECT-SPEC § 10.5: test the restore, not the backup.
#
#   ./restore-check.sh                      # newest dump in BACKUP_DIR
#   ./restore-check.sh backups/cafe-x.dump  # a specific one
#
# Restores into a scratch database beside the live one, counts what came back, and drops
# the scratch database again. The live database is never written to - the only statements
# that touch it are CREATE DATABASE and DROP DATABASE for the scratch copy, by a name that
# includes a timestamp.
#
# Monthly, and once before go-live with the output kept. A restore nobody has run is a
# hope, not a backup.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/srv/cafe/backups}"
DB_USER="${POSTGRES_USER:-cafe}"
DB_NAME="${POSTGRES_DB:-cafe}"
COMPOSE="${COMPOSE:-docker compose -f docker-compose.prod.yml}"
SCRATCH="restore_check_$(date -u +%Y%m%d%H%M%S)"

DUMP="${1:-$(ls -1t "$BACKUP_DIR"/cafe-*.dump 2>/dev/null | head -1)}"
[ -n "$DUMP" ] || { echo "no dump found in $BACKUP_DIR"; exit 1; }
echo "restoring $DUMP into $SCRATCH"

psql_scratch() { $COMPOSE exec -T db psql -U "$DB_USER" -d "$SCRATCH" -tAc "$1"; }

cleanup() {
  $COMPOSE exec -T db dropdb -U "$DB_USER" --if-exists "$SCRATCH" >/dev/null 2>&1 || true
}
trap cleanup EXIT

$COMPOSE exec -T db createdb -U "$DB_USER" "$SCRATCH"

# --exit-on-error, or pg_restore reports a pile of warnings and still exits 0, and this
# check passes on a dump that restored half a database.
$COMPOSE exec -T db pg_restore -U "$DB_USER" -d "$SCRATCH" --exit-on-error < "$DUMP"

echo
echo "table                 live    restored"
FAIL=0
for t in tenants users ingredients stock_movements ingredient_stock recipes recipe_lines menu_items suppliers audit_log production_runs; do
  LIVE=$($COMPOSE exec -T db psql -U "$DB_USER" -d "$DB_NAME" -tAc "select count(*) from $t" | tr -d '\r')
  BACK=$(psql_scratch "select count(*) from $t" | tr -d '\r')
  printf '%-20s %6s %11s' "$t" "$LIVE" "$BACK"
  # The dump is older than the live database, so live may legitimately have MORE rows.
  # Fewer means rows did not come back, which is the failure this exists to catch.
  if [ "$BACK" -gt "$LIVE" ] 2>/dev/null; then echo "  (newer than live - check the dump date)"
  elif [ "$BACK" -eq "$LIVE" ]; then echo "  ok"
  else echo "  $((LIVE - BACK)) row(s) newer than this backup"
  fi
  [ "$BACK" -eq 0 ] && [ "$LIVE" -gt 0 ] && { echo "  ^ RESTORED EMPTY"; FAIL=1; }
done

# The ledger and the production runs paired with it are the tables where a partial
# restore is unrecoverable, so they get their own check: both append-only triggers must
# exist in the restored copy too. A restore that brings the rows back without the
# trigger leaves history editable and passes every row count above.
echo
for trig in stock_movements_no_update production_runs_no_update; do
  TRIG=$(psql_scratch "select count(*) from pg_trigger where tgname = '$trig'")
  if [ "$TRIG" = "1" ]; then echo "append-only trigger $trig: present in the restored copy"
  else echo "append-only trigger $trig: MISSING from the restored copy"; FAIL=1; fi
done

[ "$FAIL" -eq 0 ] && echo "RESTORE OK  ($DUMP)" || { echo "RESTORE FAILED"; exit 1; }
