#!/usr/bin/env bash
# ZERO-LOSS COPY VALIDATION for the repaired 0019.
#
# Operates ONLY on a disposable backup made with `sqlite3 .backup` AFTER writers
# are stopped. A plain `cp` of the canonical D1 while workerd is running yields a
# torn file that reports `database disk image is malformed`, which looks like
# migration damage but is really an inconsistent copy.
#
# Usage: prove-copy-zero-loss.sh <canonical-sqlite> <migration.sql> [migration2 ...]
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

LIVE="${1:?usage: prove-copy-zero-loss.sh <canonical-sqlite> <migration.sql> [...]}"
shift
MIGRATIONS=("$@")
[ "${#MIGRATIONS[@]}" -gt 0 ] || { echo "no migration given"; exit 3; }

WORK="$(mktemp -d)"
COPY="$WORK/copy.sqlite"
SNAP=/tmp/reconciliation
FAIL=0

echo "ZERO-LOSS COPY VALIDATION"
echo "  live       : $LIVE"
echo "  migrations : ${MIGRATIONS[*]}"
echo

echo "[1/6] writer-safe backup (sqlite3 .backup, NOT cp)"
if pgrep -f "workerd serve" >/dev/null 2>&1; then
  echo "  FAIL: workerd is running; the backup may be torn. Stop writers first."
  exit 1
fi
sqlite3 "$LIVE" ".backup '$COPY'" || { echo "  backup FAILED"; exit 1; }
INTEGRITY="$(sqlite3 "$COPY" 'PRAGMA integrity_check;' | head -1)"
echo "  copy integrity_check: $INTEGRITY"
[ "$INTEGRITY" = "ok" ] || { echo "  ABORT: copy is not consistent"; exit 1; }

echo "[2/6] snapshot BEFORE"
node "$SNAP/db-shape-snapshot.mjs" "$COPY" "$WORK/before.json" || exit 1

echo "[3/6] apply migrations (atomic, all-or-nothing)"
for m in "${MIGRATIONS[@]}"; do
  echo "  -> $m"
  node scripts/apply-migration-atomic.mjs "$COPY" "$m" || { FAIL=1; break; }
done
[ "$FAIL" = "0" ] || { echo "  ABORT: a migration failed; the copy was rolled back"; rm -rf "$WORK"; exit 1; }

echo "[4/6] snapshot AFTER + compare"
node "$SNAP/db-shape-snapshot.mjs" "$COPY" "$WORK/after.json" || exit 1
node "$SNAP/db-shape-compare.mjs" "$WORK/before.json" "$WORK/after.json" \
  /tmp/reconciliation/destructive27.json /tmp/reconciliation/dropcols.json || FAIL=1

echo "[5/6] foreign_key_check + integrity_check"
FK="$(sqlite3 "$COPY" 'PRAGMA foreign_key_check;' | head -5)"
IC="$(sqlite3 "$COPY" 'PRAGMA integrity_check;' | head -1)"
echo "  foreign_key_check: $([ -z "$FK" ] && echo clean || echo "$FK")"
echo "  integrity_check  : $IC"
[ -z "$FK" ] || FAIL=1
[ "$IC" = "ok" ] || FAIL=1

echo "[6/6] canonical D1 untouched (never opened for write)"
echo "  canonical sha256 prefix: $(shasum -a 256 "$LIVE" | cut -c1-32)"

rm -rf "$WORK"
echo
[ "$FAIL" = "0" ] && echo "RESULT: PASS" || echo "RESULT: FAIL"
exit "$FAIL"
