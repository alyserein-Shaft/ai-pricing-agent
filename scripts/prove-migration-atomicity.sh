#!/usr/bin/env bash
# PROVE the migration executor is atomic.
#
# Builds a disposable database whose rows are counted before and after a
# migration that is guaranteed to fail partway through. The proof is that the
# row count and table shape are UNCHANGED -- i.e. the failure did not leave a
# half-applied DROP/RENAME behind.
#
# This is the exact defect that made 0019 dangerous: a failing copy-in followed
# by a DROP + RENAME emptied a 1,121-row table on live-shaped data.
set -uo pipefail

WORK="$(mktemp -d)"
DB="$WORK/atomicity-probe.sqlite"
# Resolve the executor to an ABSOLUTE path: the probe runs from a temp
# directory's perspective once it cds, so a relative path silently fails and
# the probe would report a false negative.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXEC="$ROOT/scripts/apply-migration-atomic.mjs"
cd "$ROOT" || exit 1
# The executor exits 2 when invoked with no arguments, so only a syntax error
# (status 1 from node itself, or a non-2/0 code) means it is unusable.
node --check "$EXEC" || { echo "PROOF FAILED: executor has a syntax error"; exit 1; }

sqlite3 "$DB" "
  CREATE TABLE victims (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
  INSERT INTO victims (id,payload)
    SELECT 'row_' || value, 'data-' || value FROM generate_series(1,50);
"
BEFORE_ROWS="$(sqlite3 "$DB" 'SELECT count(*) FROM victims;')"
BEFORE_SQL="$(sqlite3 "$DB" "SELECT sql FROM sqlite_master WHERE name='victims';")"

# The migration rebuilds `victims` with a NOT NULL column the copy-in cannot
# satisfy, then DROPs and RENAMEs. The copy-in is statement 2 of 5 and MUST
# abort -- proving that the preceding CREATE and everything after it (including
# the destructive DROP + RENAME) is rolled back.
#
# The `--> statement-breakpoint` markers matter: without them the executor sees
# ONE statement, and the probe would appear to pass without ever testing
# mid-sequence rollback.
cat > "$WORK/bad.sql" <<'SQL'
CREATE TABLE `__new_victims` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`required_missing` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_victims`("id", "payload") SELECT "id", "payload" FROM `victims`;
--> statement-breakpoint
DROP TABLE `victims`;
--> statement-breakpoint
ALTER TABLE `__new_victims` RENAME TO `victims`;
--> statement-breakpoint
CREATE INDEX `victims_payload_idx` ON `victims` (`payload`);
SQL

echo "Atomicity probe"
echo "  rows before            : $BEFORE_ROWS"
echo "  migration statements   : 5"
echo "  must abort at statement 2 (NOT NULL on required_missing)"
echo "  proving statements 1 and 3-5 never take effect"
echo

node "$EXEC" "$DB" "$WORK/bad.sql" > "$WORK/out.txt" 2>&1
STATUS=$?

AFTER_ROWS="$(sqlite3 "$DB" 'SELECT count(*) FROM victims;' 2>/dev/null || echo "TABLE-GONE")"
AFTER_SQL="$(sqlite3 "$DB" "SELECT sql FROM sqlite_master WHERE name='victims';" 2>/dev/null || echo "")"

echo "  executor exit    : $STATUS   (expect 1)"
echo "  rows after       : $AFTER_ROWS   (expect $BEFORE_ROWS)"
echo "  shape unchanged  : $([ "$BEFORE_SQL" = "$AFTER_SQL" ] && echo YES || echo NO)   (expect YES)"
echo "  new_ residue     : $(sqlite3 "$DB" "SELECT count(*) FROM sqlite_master WHERE name='__new_victims';" 2>/dev/null || echo 0)   (expect 0)"
echo "  payload index    : $(sqlite3 "$DB" "SELECT count(*) FROM sqlite_master WHERE name='victims_payload_idx';" 2>/dev/null || echo 0)   (expect 0)"
echo
sed 's/^/  | /' "$WORK/out.txt"

echo
FAIL=0
[ "$STATUS" = "1" ] || { echo "PROOF FAILED: expected exit 1"; FAIL=1; }
[ "$AFTER_ROWS" = "$BEFORE_ROWS" ] || { echo "PROOF FAILED: row count changed $BEFORE_ROWS -> $AFTER_ROWS"; FAIL=1; }
[ "$BEFORE_SQL" = "$AFTER_SQL" ] || { echo "PROOF FAILED: table shape changed"; FAIL=1; }
[ "$(sqlite3 "$DB" "SELECT count(*) FROM sqlite_master WHERE name='__new_victims';")" = "0" ] || { echo "PROOF FAILED: __new_ residue left behind"; FAIL=1; }
[ "$(sqlite3 "$DB" "SELECT count(*) FROM sqlite_master WHERE name='victims_payload_idx';")" = "0" ] || { echo "PROOF FAILED: post-failure index exists"; FAIL=1; }

rm -rf "$WORK"
[ "$FAIL" = "0" ] && echo "ATOMICITY PROVEN: one failed statement -> abort, zero partial migration." || echo "ATOMICITY NOT PROVEN"
exit "$FAIL"
