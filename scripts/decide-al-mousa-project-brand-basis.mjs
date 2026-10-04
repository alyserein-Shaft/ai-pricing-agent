// Supersede the historical NOTIFIER / INSPIRE_N16 project-basis decision.
//
// The NOTIFIER record is PRESERVED, never edited and never deleted. What
// changes is its PROJECT-BASIS ROLE: the newer Fire Alarm Brand Strategy
// (FARENHYT / IN_HOUSE, threshold 2000, project scale 1,894 <= 2000) makes
// NOTIFIER a technically valid alternative and technical benchmark only.
//
// Uses the existing governed mechanism already present in this repository:
// engineering_knowledge_decisions has NO superseded_at column. Reversal is
// recorded as a NEW row with action='supersede' and reverses_decision_id
// pointing at the row being superseded. Readers take the latest decision per
// entity, so a superseded verdict is never re-read as current.
//
// Idempotent: re-running finds the existing supersede row and NO-OPs.
import { DatabaseSync } from "node:sqlite";

const DB = process.argv[2];
const APPLY = process.argv.includes("--apply");
const db = new DatabaseSync(DB);
const text = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

const P = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";

// The historical NOTIFIER project-basis row.
const notifier = db.prepare(
  "SELECT * FROM engineering_knowledge_decisions WHERE entity_type='Project Fire Alarm Ecosystem' AND project_id=? ORDER BY decided_at DESC LIMIT 1",
).get(P);
if (!notifier) throw new Error("no Project Fire Alarm Ecosystem decision found -- nothing to supersede");

const brand = db.prepare(
  "SELECT * FROM engineering_knowledge_decisions WHERE entity_type='Fire Alarm Brand Strategy' AND project_id=? ORDER BY decided_at DESC LIMIT 1",
).get(P);
if (!brand) throw new Error("no Fire Alarm Brand Strategy decision found -- the brand basis must exist first");

const brandValue = JSON.parse(brand.new_value);
if (brandValue.preferredBrand !== "FARENHYT" || brandValue.brandRelationship !== "IN_HOUSE") {
  throw new Error(`refusing to supersede: brand strategy is not FARENHYT/IN_HOUSE (got ${brandValue.preferredBrand}/${brandValue.brandRelationship})`);
}

// The supersede row is keyed on this stable entity_id.
const ENTITY_ID = "al-mousa-fire-alarm-project-brand-basis";

const existing = db.prepare(
  "SELECT * FROM engineering_knowledge_decisions WHERE entity_type='Fire Alarm Project Brand Basis' AND entity_id=? AND action='supersede'",
).get(ENTITY_ID);

const newValue = {
  projectBrandBasis: "FARENHYT",
  brandRelationship: "IN_HOUSE",
  commercialWorkflow: "INTERNAL_SELECTION_AND_PRICING",
  panelFamilyBasis: "FARENHYT_IFP",
  standardsRegime: text(brandValue.standardsRegime),
  addressablePointCount: brandValue.addressablePointCount,
  threshold: brandValue.threshold,
  notifierStatus: "TECHNICALLY_VALID_ALTERNATIVE / TECHNICAL_BENCHMARK",
  notifierRoleRetained: true,
  notifierKnowledgeRetained: true,
  notifierProductBasisSuperseded: {
    decisionId: notifier.id,
    decidedAt: notifier.decided_at,
    supersededField: "preliminaryPanelFamily (INSPIRE N16 / N16e / N16x / N16-XUPG)",
    reason: "panel family is a technical selection downstream of brand; the later authoritative brand strategy selects FARENHYT for this project's point scale",
  },
  supersedesDecisionId: notifier.id,
  decidedBy: "authoritative-engineer-decision",
  decidedRole: "fire-alarm-engineer",
  engine: "fire-alarm-project-brand-basis-1.0.0",
  policy: "company-fire-alarm-brand-policy-v1",
};

const id = `fire-alarm-project-brand-basis_${text(newValue.projectBrandBasis).toLowerCase()}_${notifier.id.slice(0, 8)}`;

if (existing) {
  console.log(`NO-OP: supersede already recorded (${existing.id})`);
} else {
  const reason = "Retire the NOTIFIER / INSPIRE_N16 record's PROJECT-BASIS role only. The NOTIFIER technical corpus, product knowledge and technical-benchmark value are fully retained; the historical row is left untouched and is reversed by reference, not edited.";
  if (!APPLY) {
    console.log("(dry run) would insert:");
    console.log(`  entity_type = Fire Alarm Project Brand Basis`);
    console.log(`  entity_id   = ${ENTITY_ID}`);
    console.log(`  action      = supersede`);
    console.log(`  reverses    = ${notifier.id}  (${text(notifier.decided_at)})`);
    console.log(`  new_value   = ${JSON.stringify(newValue).slice(0, 200)}...`);
  } else {
    db.prepare(`INSERT INTO engineering_knowledge_decisions
      (id, project_id, entity_type, entity_id, action, previous_value, new_value, reason, evidence, scope_type, scope_id, reversible, reverses_decision_id, decided_by, decided_role, decided_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
      .run(
        id, P, "Fire Alarm Project Brand Basis", ENTITY_ID, "supersede",
        JSON.stringify({ projectBrandBasis: "NOTIFIER", panelFamily: "INSPIRE_N16" }),
        JSON.stringify(newValue), reason,
        JSON.stringify({
          supersededDecisionId: notifier.id,
          supersededDecisionEntityType: notifier.entity_type,
          brandDecisionId: brand.id,
          brandDecisionAt: brand.decided_at,
          brandPreferred: brandValue.preferredBrand,
          brandRelationship: brandValue.brandRelationship,
          notifierHistoricalEvidenceRetained: true,
        }),
        "Project", P, 1, notifier.id, "authoritative-engineer-decision", "fire-alarm-engineer",
      );
    console.log(`WROTE ${id}`);
  }
}

// Verify the historical record is intact and the supersede is now current.
const rows = db.prepare(
  "SELECT id, entity_type, action, reverses_decision_id, decided_at FROM engineering_knowledge_decisions WHERE entity_id=? ORDER BY decided_at",
).all(notifier.entity_id);
console.log(`\nHistorical '${notifier.entity_type}' rows for this entity (${rows.length}, all preserved):`);
for (const r of rows) console.log(`  ${r.decided_at}  ${r.action.padEnd(10)} rev=${r.reverses_decision_id ?? "-"}  ${r.id}`);
const original = rows.find((r) => r.id === notifier.id);
if (!original) throw new Error("the historical NOTIFIER decision row is missing -- history was rewritten");
console.log(`\nNOTIFIER product knowledge check: N16/SLM-318/N16-XUPG references remain in the superseded row's new_value: ${/N16|SLM-318|N16-XUPG/.test(notifier.new_value) ? "YES (preserved)" : "NO"}`);