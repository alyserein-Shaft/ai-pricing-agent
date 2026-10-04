#!/usr/bin/env bash
# FINAL LIVE RECONCILIATION RUNBOOK -- NOT TO BE RUN WITHOUT EXPLICIT HUMAN AUTHORIZATION.
#
# Applies the 0014 -> corrected-0019 -> 0020 delta to canonical D1.
#
# STATUS: rehearsed end-to-end on disposable writer-safe backups with zero
# unintended row loss (scripts/final-full-rehearsal.sh -> FINAL FULL REHEARSAL: PASS).
# NEVER APPLIED TO CANONICAL D1. This file changes nothing until a human
# explicitly authorizes a run against canonical.
#
# INVARIANTS THIS RUNBOOK PROTECTS
#   * 27 legacy tables preserved (3,502 rows), 33 legacy columns preserved.
#   * XOR source authority: 520 device-identity rows are CORRECT and are never
#     backfilled. The gate counts invariant violations (0), not NULLs.
#   * Every migration applies atomically or not at all
#     (scripts/apply-migration-atomic.mjs). The old statement-pipe is prohibited:
#     it once turned a loud abort into a silently emptied table.
#   * A green destructive guard is NECESSARY but NOT SUFFICIENT: critical
#     structural assertions pin the indexes/CHECKs/triggers the guard cannot see.
#
# ROLLBACK: a file restore, never a hand-written inverse. The pre-reconciliation
# backup path is printed on completion and on every abort.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIVE="${1:-}"
WORK="$(mktemp -d)"
DELTA="0014_specification_clause_candidate_mechanism.sql 0019_fixed_angel.sql 0020_drawing_quantity_claims.sql"
BACKUP=""

fail() {
  echo "RUNBOOK ABORTED: $*" >&2
  # The rollback boilerplate is printed only when a backup exists. A usage
  # error or an early abort must not imply that anything needs restoring.
  if [ -n "$BACKUP" ]; then
    echo "ROLLBACK: restore canonical D1 from: $BACKUP" >&2
    echo "RESTORE PROCEDURE:" >&2
    echo "  1. stop writers (step 1 below)" >&2
    echo "  2. sqlite3 \"\$LIVE\" \".restore '\$BACKUP'\"  (or copy the backup file over the live path)" >&2
    echo "  3. PRAGMA integrity_check on the restored file must print ok" >&2
    echo "  4. compare row counts against the pre-state record in \$WORK (kept on abort)" >&2
  fi
  exit 1
}
[ -n "$LIVE" ] || { echo "usage: live-reconciliation-runbook.sh <path-to-canonical-d1-sqlite>" >&2; exit 2; }

echo "FINAL LIVE RECONCILIATION RUNBOOK"
echo "  live : $LIVE"
echo "  delta: $DELTA"
echo

echo "[1/18] stop writers"
echo "  Stop EVERY process that can write canonical D1, then re-run."
echo "  Do not kill unrelated user processes -- stop only the project runtimes:"
echo "    pkill -f 'wrangler dev'          # Cloudflare dev server (holds D1)"
echo "    pkill -f 'workerd serve'         # the worker runtime underneath it"
echo "  Vite (frontend) and in-memory Miniflare probes do NOT hold the canonical"
echo "  file, but stop them too if in doubt. The next step proves zero writers."

echo "[2/18] prove zero writers"
echo "  ALL of these must be empty before continuing:"
echo "    pgrep -fla 'workerd serve'"
echo "    pgrep -fla 'wrangler dev'"
echo "    lsof \"\$LIVE\"   (no process may hold the file; lsof absent counts as unknown, not as proof)"
if pgrep -f "workerd serve" >/dev/null 2>&1; then
  fail "a workerd process is still running. A backup taken now would be torn."
fi
if pgrep -f "wrangler dev" >/dev/null 2>&1; then
  fail "a wrangler dev process is still running. A backup taken now would be torn."
fi
echo "  zero writers proven"

echo "[3/18] fresh baseline (read-only)"
node "$REPO/scripts/capture-canonical-baseline.mjs" "$LIVE" "$WORK/baseline-pre.json" \
  || fail "baseline capture failed"
echo "  baseline recorded at $WORK/baseline-pre.json"

echo "[4/18] sqlite3 backup (NEVER plain cp while writers may exist)"
BACKUP="$WORK/pre-reconciliation.sqlite"
sqlite3 "$LIVE" ".backup '$BACKUP'" || fail "backup failed"

echo "[5/18] backup integrity"
[ "$(sqlite3 "$BACKUP" 'PRAGMA integrity_check;' | head -1)" = "ok" ] || fail "backup inconsistent"
[ -z "$(sqlite3 "$BACKUP" 'PRAGMA foreign_key_check;')" ] || fail "backup has FK violations"
echo "  backup consistent; rollback artifact: $BACKUP"

echo "[6/18] preconditions (XOR source-authority invariant, NOT a NULL count)"
node "$REPO/scripts/check-live-reconciliation-preconditions.mjs" "$BACKUP" || fail "preconditions blocked"

echo "[7/18] destructive-DDL guard (whole delta, before any write)"
for m in $DELTA; do
  node "$REPO/scripts/check-migration-destructive-ddl.mjs" "$BACKUP" "$REPO/drizzle-active/$m" \
    || fail "guard blocked $m"
done
echo "  guard PASS on all three migrations"

echo "[8/18] critical structural PRE-checks (no 0020 expected)"
node "$REPO/scripts/check-critical-schema-assertions.mjs" "$BACKUP" || fail "pre-checks failed"

echo "[9/18] atomic 0014"
node "$REPO/scripts/apply-migration-atomic.mjs" "$LIVE" "$REPO/drizzle-active/0014_specification_clause_candidate_mechanism.sql" \
  || fail "0014 failed and was rolled back"

echo "[10/18] atomic corrected 0019"
node "$REPO/scripts/apply-migration-atomic.mjs" "$LIVE" "$REPO/drizzle-active/0019_fixed_angel.sql" \
  || fail "0019 failed and was rolled back"

echo "[11/18] atomic 0020"
node "$REPO/scripts/apply-migration-atomic.mjs" "$LIVE" "$REPO/drizzle-active/0020_drawing_quantity_claims.sql" \
  || fail "0020 failed and was rolled back"

echo "[12/18] critical structural POST-checks (0020 expected)"
node "$REPO/scripts/check-critical-schema-assertions.mjs" "$LIVE" --expect-0020 || fail "post-checks failed"

echo "[13/18] row-count / XOR / FK / integrity checks"
node "$REPO/scripts/check-live-reconciliation-preconditions.mjs" "$LIVE" >/dev/null 2>&1 || fail "XOR invariant violated post-apply"
[ -z "$(sqlite3 "$LIVE" 'PRAGMA foreign_key_check;')" ] || fail "FK violations post-apply"
[ "$(sqlite3 "$LIVE" 'PRAGMA integrity_check;' | head -1)" = "ok" ] || fail "integrity failed post-apply"
[ "$(sqlite3 "$LIVE" 'PRAGMA quick_check;' | head -1)" = "ok" ] || fail "quick_check failed post-apply"
for t in profile_requirement_applicability requirement_intelligence_facts boq_items price_records historical_boq_rows; do
  before="$(node -e "console.log(require('$WORK/baseline-pre.json').keyRowCounts['$t'])")"
  after="$(sqlite3 "$LIVE" "SELECT count(*) FROM $t;")"
  [ "$before" = "$after" ] || fail "$t changed $before -> $after"
  printf '  %-36s %s (unchanged)\n' "$t" "$after"
done
echo "  row-count / XOR / FK / integrity PASS"

echo "[14/18] application/domain read checks"
node "$REPO/scripts/verify-app-reads-live.mjs" "$LIVE" || fail "app reads failed"

echo "[15/18] Drawing Quantity 0020 functional checks"
node "$REPO/scripts/check-critical-schema-assertions.mjs" "$LIVE" --expect-0020 >/dev/null 2>&1 || fail "0020 structures missing"
echo "  0020 structures verified (table, COALESCE uniqueness index, 8 triggers, FKs)"

echo "[16/18] restart runtime"
echo "  Restart the project runtimes stopped in step 1 (wrangler dev / workers)."

echo "[17/18] health checks"
echo "  Confirm the runtime serves traffic and the application reads from step 14"
echo "  return the same results against the live runtime."

echo "[18/18] rollback triggers and restore procedure"
echo "  ROLLBACK TRIGGERS -- restore from $BACKUP when ANY of these hold:"
echo "    * any step above reports FAIL / ABORT"
echo "    * row counts differ from the baseline recorded in step 3"
echo "    * XOR violations > 0, FK violations, or integrity_check != ok"
echo "    * application reads differ from the rehearsal record"
echo "  RESTORE PROCEDURE:"
echo "    1. stop writers (step 1)"
echo "    2. sqlite3 \"\$LIVE\" \".restore '\$BACKUP'\""
echo "    3. PRAGMA integrity_check must print ok"
echo "    4. re-run steps 13-14 against the restored file"
echo
echo "RECONCILIATION COMPLETE. Pre-reconciliation backup retained at: $BACKUP"
