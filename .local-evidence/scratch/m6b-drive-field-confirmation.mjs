// R11 Phase 6B live run -- drive the governed deterministic FIELD-level
// confirmation across the current Understanding queue. Read-only decision-making
// is delegated entirely to the server policy; this only POSTs the route and
// tallies the governed outcomes.
const PROJECT = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";
const BASE = "http://localhost:4183";
const { DatabaseSync } = await import("node:sqlite");

const db = new DatabaseSync(process.argv[2], { readOnly: true });
const itemIds = db.prepare(`SELECT DISTINCT b.id FROM boq_items b
  WHERE b.project_id=? AND b.row_type IN ('Item','BOQ Item')
    AND b.review_status IN ('Approved','Accepted','Auto Verified') AND b.approved_for_downstream=1`).all(PROJECT).map((r) => r.id);
db.close();
console.log(`driving field-auto-approval across ${itemIds.length} current items\n`);

const tally = {};
let confirmedFields = 0, itemsChanged = 0;
for (const id of itemIds) {
  const res = await fetch(`${BASE}/api/boq-items/${encodeURIComponent(id)}/estimator-understanding-review/field-auto-approval`, { method: "POST" });
  let body = {};
  try { body = await res.json(); } catch {}
  const key = body.applied ? "APPLIED" : (body.code || `HTTP_${res.status}`);
  tally[key] = (tally[key] || 0) + 1;
  if (body.applied) { itemsChanged++; confirmedFields += body.confirmedFields || 0; }
}
console.log("outcome tally:");
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}x  ${k}`);
console.log(`\nitems with field authority now: ${itemsChanged}  (total confirmed fields: ${confirmedFields})`);
