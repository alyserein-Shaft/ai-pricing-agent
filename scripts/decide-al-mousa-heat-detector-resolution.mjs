// PERSIST THE GOVERNED AL MOUSA HEAT-DETECTOR RESOLUTION.
//
//   node scripts/decide-al-mousa-heat-detector-resolution.mjs <sqlite> [--apply]
//
// Dry-run by default. Idempotent: one decision row per BOQ source row, keyed on
// entity_id = the BOQ source row number, so re-running is a NO-OP rather than a
// duplicate. The previous state of every row is preserved in previous_value.
//
// It writes DECISIONS ONLY. It does not touch boq_items: source BOQ text is
// never overwritten. It does not create or alter any discount rule, and it does
// not select a product for a row the evidence does not resolve.
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DB = process.argv[2];
const APPLY = process.argv.includes("--apply");
if (!DB) { console.error("usage: node scripts/decide-al-mousa-heat-detector-resolution.mjs <sqlite> [--apply]"); process.exit(2); }

const PROJECT_ID = "project_ae501b85-9c12-4332-bf8e-787c90f2d388"; // Al Mousa School - Clean Golden Run
const ENTITY = "Fire Alarm Heat Detector Resolution";
const DECIDED_BY = "governed-heat-resolution";
const DECIDED_ROLE = "Engineer";

const bar = (t) => { console.log("\n" + "=".repeat(100)); console.log(t); console.log("=".repeat(100)); };

// Reuse the read-only resolver so the persisted decision can never drift from
// the evidence that justifies it.
const raw = execFileSync("node", [join(HERE, "resolve-al-mousa-heat-detectors.mjs"), DB, "--json"], { encoding: "utf8" });
const resolution = JSON.parse(raw);

bar("GOVERNED AL MOUSA HEAT-DETECTOR DECISION");
console.log(`  mode          : ${APPLY ? "APPLY" : "DRY RUN"}`);
console.log(`  heat demand   : ${resolution.total}  (unchanged; nothing is deleted)`);
console.log(`  resolved      : ${resolution.resolvedQty} -> ${resolution.match.pn}`);
console.log(`  still open    : ${resolution.openQty}`);
console.log("");

const db = new DatabaseSync(DB);
// The LATEST decision for a row. Ordering matters: after a supersede the newest
// row is the current answer, so returning an arbitrary earlier row would make
// every subsequent run try to supersede again.
const existing = (entityId) =>
  db.prepare("SELECT id, new_value, action, reverses_decision_id FROM engineering_knowledge_decisions WHERE project_id=? AND entity_type=? AND entity_id=? ORDER BY decided_at DESC, rowid DESC LIMIT 1")
    .get(PROJECT_ID, ENTITY, entityId);

let written = 0, noop = 0, superseded = 0;
for (const r of resolution.rows) {
  const entityId = `BOQ_ROW_${r.row}`;
  const prev = existing(entityId);
  // A row whose verdict CHANGED is not overwritten in place. The prior decision
  // is marked superseded and the new one recorded against it, so the history of
  // why the answer moved stays readable.
  let reversesId = null;
  let action = "decide";
  if (prev) {
    let priorState = null;
    try { priorState = JSON.parse(prev.new_value)?.state ?? null; } catch { /* unreadable prior value */ }
    if (priorState === r.state) {
      console.log(`  [NO-OP] row ${r.row}: already decided (${prev.id.slice(0, 28)}...)`);
      noop++;
      continue;
    }
    // The verdict moved. engineering_knowledge_decisions has no superseded_at
    // column; supersession is recorded the way this table already does it --
    // action 'supersede' plus reverses_decision_id pointing at the prior row, so
    // both the old and the new answer stay readable.
    action = "supersede";
    reversesId = prev.id;
    if (!APPLY) {
      console.log(`  [DRY ] row ${r.row}: would SUPERSEDE prior ${priorState} with ${r.state}`);
    } else {
      superseded++;
      console.log(`  [SUPERSEDE] row ${r.row}: ${priorState} -> ${r.state}  (prior decision retained, not overwritten)`);
    }
  }
  const value = {
    boqSourceRow: r.row,
    quantity: r.qty,
    section: r.section,
    namedLocationScope: r.namedLocationScope,
    state: r.state,
    exactPartNumber: r.pn,
    profile: r.profile ?? null,
    reason: r.reason,
    evidenceChain: r.evidenceChain ?? null,
    missingDiscriminator: r.missingDiscriminator ?? null,
    duplicateOfItemId: r.duplicateOfItemId ?? null,
    specification: {
      clause: "28 46 00 Rev 1, 2 PRODUCTS, 2.5(b) Fixed Temperature / Rate of Rise Heat Detectors",
      fixedSetpointF: 135, fixedSetpointC: 57,
      rateOfRisePerMinuteF: 15, rateOfRisePerMinuteC: 8.3,
      highTemperatureVariantF: 190, highTemperatureVariantC: 88,
      highTemperatureTriggerResolvedInProject: false,
    },
    productEvidence: r.state === "RESOLVED" ? {
      pn: resolution.match.pn,
      detectionPrinciple: resolution.match.evidence.detectionPrinciple,
      fixedSetpoint: resolution.match.evidence.fixedSetpoint,
      rateOfRise: resolution.match.evidence.rateOfRise,
      ulListing: resolution.match.evidence.ulListing,
      rejectedFixedOnlyAlternative: resolution.match.rejected,
    } : null,
    commercialBasis: "Existing governed Farenhyt rule reused unchanged (65% off list, net multiplier 0.35). No new discount rule created.",
  };

  if (!APPLY) {
    console.log(`  [DRY ] row ${r.row}: would record ${r.state}${r.pn ? ` -> ${r.pn}` : ""}`);
    continue;
  }
  db.prepare(`INSERT INTO engineering_knowledge_decisions
      (id, project_id, entity_type, entity_id, action, previous_value, new_value, reason, evidence,
       scope_type, scope_id, reversible, reverses_decision_id, decided_by, decided_role, decided_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    `${ENTITY.toLowerCase().replace(/[^a-z0-9]+/g, "-")}_${randomUUID()}`,
    PROJECT_ID, ENTITY, entityId, action,
    JSON.stringify({ state: "UNRESOLVED", quantity: r.qty, note: "pre-decision state: no governed per-row device assignment" }),
    JSON.stringify(value),
    r.state === "RESOLVED"
      ? `Resolved to ${r.pn} on specification evidence: ${r.reason}`
      : `Held open. ${r.reason} Missing: ${r.missingDiscriminator}`,
    JSON.stringify([`Technical Specification 28 46 00 Rev 1, 2 PRODUCTS, 2.5(b)`, `BOQ MECH RFQ row ${r.row} qty ${r.qty}`, resolution.match.evidence.datasheet ?? "Farenhyt IDP-HEAT-W datasheet"]),
    "PROJECT", PROJECT_ID, 1, reversesId, DECIDED_BY, DECIDED_ROLE, new Date().toISOString(),
  );
  console.log(`  [WROTE] row ${r.row}: ${r.state}${r.pn ? ` -> ${r.pn}` : ""} (${r.qty} units)`);
  written++;
}
db.close();

console.log("");
console.log(`  written=${written}  noop=${noop}  superseded=${superseded}`);
console.log("  Source BOQ text was NOT modified. The census of 26 heat detectors is untouched.");
if (resolution.openQty > 0) {
  console.log(`  ${resolution.openQty} unit(s) remain genuinely unresolved and are NOT costed:`);
  for (const r of resolution.rows.filter((x) => x.state === "TECHNICAL_SELECTION_REVIEW_REQUIRED")) {
    console.log(`      row ${r.row} (${r.qty}) - ${r.section}: ${r.missingDiscriminator}`);
  }
}