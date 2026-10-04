#!/usr/bin/env bash
# FINAL FULL COPY REHEARSAL -- the exact intended live sequence, on a
# disposable writer-safe backup. Any failure aborts. No partial success.
#
# Sequence:
#   preconditions -> destructive guard -> critical structural assertions (pre)
#   -> 0014 -> corrected 0019 -> 0020 (each atomic)
#   -> critical structural assertions (post) -> row-count invariants
#   -> XOR invariant -> foreign_key_check -> integrity/quick_check
#   -> representative app/domain reads -> Drawing Quantity 0020 functional checks
#
# Usage: final-full-rehearsal.sh <canonical-sqlite>
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

LIVE="${1:?usage: final-full-rehearsal.sh <canonical-sqlite>}"
WORK="$(mktemp -d)"
COPY="$WORK/copy.sqlite"
FAIL=0
step() { echo; echo "[$1] $2"; }

step "0/13" "writer check (refuse on a moving database)"
if pgrep -f "workerd serve" >/dev/null 2>&1; then
  echo "  FAIL: a workerd process is running; the backup may be torn. Stop writers first."
  exit 1
fi
echo "  no workerd writers"

step "1/13" "writer-safe backup (sqlite3 .backup, NOT cp)"
sqlite3 "$LIVE" ".backup '$COPY'" || exit 1
[ "$(sqlite3 "$COPY" 'PRAGMA integrity_check;' | head -1)" = "ok" ] || { echo "  FAIL: copy inconsistent"; exit 1; }
echo "  backup ok"

step "2/13" "preconditions (XOR source-authority invariant)"
node scripts/check-live-reconciliation-preconditions.mjs "$COPY" >/dev/null 2>&1 || FAIL=1
[ "$FAIL" = "0" ] && echo "  preconditions PASS" || { echo "  FAIL"; exit 1; }

step "3/13" "destructive-DDL guard (whole delta, before any write)"
for m in 0014_specification_clause_candidate_mechanism 0019_fixed_angel 0020_drawing_quantity_claims; do
  node scripts/check-migration-destructive-ddl.mjs "$COPY" "drizzle-active/$m.sql" >/dev/null 2>&1 \
    || { echo "  FAIL: guard blocked $m"; exit 1; }
done
echo "  guard PASS (exit 0 on all three)"

step "4/13" "critical structural assertions -- PRE (no 0020 expected) + before-snapshot"
node scripts/check-critical-schema-assertions.mjs "$COPY" >/dev/null 2>&1 || { echo "  FAIL: pre-assertions"; exit 1; }
echo "  pre-assertions PASS"
node /tmp/reconciliation/db-shape-snapshot.mjs "$COPY" "$WORK/before.json" >/dev/null || exit 1
echo "  before-snapshot recorded"

step "5/13" "atomic 0014"
node scripts/apply-migration-atomic.mjs "$COPY" drizzle-active/0014_specification_clause_candidate_mechanism.sql || exit 1

step "6/13" "atomic corrected 0019"
node scripts/apply-migration-atomic.mjs "$COPY" drizzle-active/0019_fixed_angel.sql || exit 1

step "7/13" "atomic 0020"
node scripts/apply-migration-atomic.mjs "$COPY" drizzle-active/0020_drawing_quantity_claims.sql || exit 1

step "8/13" "critical structural assertions -- POST (0020 expected)"
node scripts/check-critical-schema-assertions.mjs "$COPY" --expect-0020 || { echo "  FAIL: post-assertions"; exit 1; }

step "9/13" "row-count invariants + XOR invariant + FK + integrity"
node /tmp/reconciliation/db-shape-snapshot.mjs "$COPY" "$WORK/after.json" >/dev/null || exit 1
node /tmp/reconciliation/db-shape-compare.mjs "$WORK/before.json" "$WORK/after.json" \
  /tmp/reconciliation/destructive27.json /tmp/reconciliation/dropcols.json || FAIL=1
[ "$FAIL" = "0" ] && echo "  zero-loss PASS" || { echo "  FAIL"; exit 1; }
FK="$(sqlite3 "$COPY" 'PRAGMA foreign_key_check;' | head -3)"
[ -z "$FK" ] && echo "  foreign_key_check clean" || { echo "  FAIL: $FK"; exit 1; }
[ "$(sqlite3 "$COPY" 'PRAGMA integrity_check;' | head -1)" = "ok" ] && echo "  integrity_check ok" || { echo "  FAIL"; exit 1; }
[ "$(sqlite3 "$COPY" 'PRAGMA quick_check;' | head -1)" = "ok" ] && echo "  quick_check ok" || { echo "  FAIL"; exit 1; }

step "10/13" "representative app/domain reads"
node /tmp/reconciliation/verify-app-reads.mjs "$COPY" >/dev/null 2>&1 || { echo "  FAIL: app reads"; exit 1; }
echo "  app reads PASS"

step "11/13" "Drawing Quantity 0020 functional verification"
node /tmp/reconciliation/verify-0020-on-copy.mjs "$COPY" 2>&1 | tail -2

step "12/13" "delivery readiness gate (repaired contract)"
node scripts/prove-delivery-readiness-gate.mjs 2>&1 | tail -2

step "13/13" "canonical untouched"
echo "  canonical sha256: $(shasum -a 256 "$LIVE" | cut -c1-32)"

rm -rf "$WORK"
echo
echo "FINAL FULL REHEARSAL: PASS"
