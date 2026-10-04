#!/usr/bin/env bash
# Disposable migration-chain verification for 0008. Touches NO live database.
set -euo pipefail
cd /Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an
T=/private/var/folders/vn/h7zfhtk92h3c0kw_d2bz_chr0000gn/T/opencode
CHAIN=$T/chain.sqlite
rm -f "$CHAIN"

echo "=== 1. FRESH CHAIN 0000..0008 ==="
for f in 0000_baseline_schema_0082 0001_price_record_intake_lineage 0002_governing_source_fk \
         0003_review_decision_immutability 0004_fire_alarm_panel_sizing_snapshots \
         0005_document_revision_addendum 0006_project_effective_time_calendar \
         0007_project_calendar_evidence_repair 0008_profile_applicability_source_authority; do
  sqlite3 "$CHAIN" < "drizzle-active/$f.sql" || { echo "FAILED at $f"; exit 1; }
  echo "  applied $f"
done

echo
echo "=== 2. OBJECT PARITY ==="
sqlite3 "$CHAIN" "SELECT '  '||type||'='||COUNT(*) FROM sqlite_master GROUP BY type ORDER BY type;"

echo
echo "=== 3. INTEGRITY + FK ==="
echo "  integrity_check   : $(sqlite3 "$CHAIN" 'PRAGMA integrity_check;')"
echo "  foreign_key_check : $(sqlite3 "$CHAIN" 'PRAGMA foreign_key_check;' | wc -l | tr -d ' ') violations"

echo
echo "=== 4. INDEXES ON THE REBUILT TABLE ==="
sqlite3 "$CHAIN" "SELECT '  '||name FROM sqlite_master WHERE type='index' AND tbl_name='profile_requirement_applicability' AND name NOT LIKE 'sqlite_%';"

echo
echo "=== 5. CONSTRAINTS PRESENT ==="
sqlite3 "$CHAIN" "SELECT sql FROM sqlite_master WHERE name='profile_requirement_applicability';" | grep -E "CHECK|requirement_source" | sed 's/^/  /'

echo
echo "=== 6. IDEMPOTENCY: re-applying 0008 must be refused, not silently corrupt ==="
if sqlite3 "$CHAIN" < drizzle-active/0008_profile_applicability_source_authority.sql 2>/tmp/err8; then
  echo "  WARNING: re-apply exited 0"
else
  echo "  re-apply refused (expected): $(head -c 90 /tmp/err8)"
fi
echo "  rows after re-apply attempt: $(sqlite3 "$CHAIN" 'SELECT COUNT(*) FROM profile_requirement_applicability;')"
