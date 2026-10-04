// PERSIST the two authoritative engineer decisions for Al Mousa Fire Alarm
// through the governed project-decision mechanism.
//
//  1. FlashScan / CLIP protocol interpretation:
//         FLASHSCAN_MANDATORY = NO
//     This closes the earlier PENDING_CONSULTANT_CLARIFICATION on that question.
//
//  2. Fire Alarm Brand Strategy:
//         PREFERRED_FIRE_ALARM_BRAND = FARENHYT, IN_HOUSE,
//         commercial workflow = INTERNAL_SELECTION_AND_PRICING
//
// NON-DESTRUCTIVE BY CONSTRUCTION
// -------------------------------
// A NEW entity_type is used. The existing "Project Fire Alarm Ecosystem" decision
// row -- which recorded NOTIFIER -- is NOT updated, NOT deleted and NOT reversed
// by this script. NOTIFIER's technical evidence and its decision history stay
// intact; what this records is the brand-strategy outcome that re-bases the
// project's COMMERCIAL basis and routes the workflow.
//
// IDEMPOTENT
// ---------
// Each decision carries an idempotency key derived from its content. Re-running
// detects the existing row and reports NO-OP instead of inserting a duplicate.
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  resolveFireAlarmBrandStrategy, commercialWorkflowFor, IN_HOUSE_FIRE_ALARM_POLICY,
} from "../app/domain/fire-alarm-brand-strategy.mjs";

const DB = process.argv[2];
const APPLY = process.argv.includes("--apply");
if (!DB) { console.error("usage: node scripts/record-al-mousa-fire-alarm-brand-decisions.mjs <sqlite> [--apply]"); process.exit(2); }

const PROJECT_ID = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";
const PROJECT_NAME = "Al Mousa School — Clean Golden Run";
const DECIDED_BY = "authoritative-engineer-decision";
const DECIDED_ROLE = "Project Engineer (authoritative human decision)";
const ENTITY_BRAND = "Fire Alarm Brand Strategy";
const ENTITY_PROTOCOL = "Fire Alarm Protocol Interpretation";

const idem = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 32);

const bar = (t) => { console.log(""); console.log("=".repeat(108)); console.log(t); console.log("=".repeat(108)); };

// --- Decision 1: FlashScan is NOT mandatory ---------------------------------
const FLASHSCAN_DECISION = {
  flashscanMandatory: false,
  mandatoryFireAlarmBrand: null,
  statement:
    "Authoritative engineer decision: FLASHSCAN_MANDATORY = NO. The FlashScan / CLIP references " +
    "in the Al Mousa specification are NOT interpreted as a mandatory project protocol or brand " +
    "constraint. Conditional FlashScan FEATURE wording (for example '1-159 on FlashScan systems', " +
    "or the bi-colour LED behaviour described as 'FlashScan systems only') must NOT be " +
    "reinterpreted as a mandatory ecosystem requirement.",
  closes: "PENDING_CONSULTANT_CLARIFICATION (FlashScan mandatory-protocol question)",
  decidedAt: "2026-09-30",
};
const FLASHSCAN_IDEM = idem({ p: PROJECT_ID, e: ENTITY_PROTOCOL, v: FLASHSCAN_DECISION });

// --- Decision 2: brand strategy routes to the IN-HOUSE workflow -------------
const resolved = resolveFireAlarmBrandStrategy({
  systemCategory: "FIRE_ALARM",
  mandatoryBrand: null,
  mandatoryBrandEvidence: [],
  standardsRegime: "ULF",
  addressablePointCount: 1877,
  pointCountBasis: "governed SLC classifier over the canonical commercial BOM: 1486 detector-pool + 391 module-pool",
});
const notifierRoute = commercialWorkflowFor("NOTIFIER");

const BRAND_DECISION = {
  preferredBrand: resolved.preferredBrand,
  brandRelationship: resolved.brandRelationship,
  commercialWorkflow: resolved.commercialWorkflow,
  commercialSequence: resolved.sequence,
  supplierIsSelectionAuthority: resolved.supplierIsSelectionAuthority,
  requiresSupplierRfqBeforeCosting: resolved.requiresSupplierRfqBeforeCosting,
  standardsRegime: resolved.standardsRegime,
  addressablePointCount: resolved.addressablePointCount,
  pointCountBasis: resolved.pointCountBasis,
  threshold: IN_HOUSE_FIRE_ALARM_POLICY.regimeScaleThresholds.ULF_LARGE_PROJECT_MIN_POINTS_EXCLUSIVE,
  engine: resolved.version,
  policy: resolved.policyId,
  notifierStatus: "TECHNICALLY_VALID_ALTERNATIVE / TECHNICAL_BENCHMARK",
  notifierRoute: { brandRelationship: notifierRoute.brandRelationship, commercialWorkflow: notifierRoute.commercialWorkflow },
  nextSlice: "FARENHYT_INTERNAL_DETAILED_SELECTION_AND_PRICING",
  decidedAt: "2026-09-30",
};
const BRAND_IDEM = idem({ p: PROJECT_ID, e: ENTITY_BRAND, v: BRAND_DECISION });

bar("GOVERNED DECISION PERSISTENCE");
console.log(`project        : ${PROJECT_NAME}`);
console.log(`mode           : ${APPLY ? "APPLY (writes to engineering_knowledge_decisions)" : "DRY RUN (no writes)"}`);
console.log(`entity types   : ${ENTITY_BRAND}, ${ENTITY_PROTOCOL}`);
console.log("");

const db = new DatabaseSync(DB);
// Idempotency is keyed on entity_id, which is where the content-derived key is
// stored. An earlier version searched the free-text `reason` column for the key,
// which never matched and silently duplicated rows on every re-run.
const existing = (entityType, key) =>
  db.prepare("SELECT id FROM engineering_knowledge_decisions WHERE project_id=? AND entity_type=? AND entity_id=? LIMIT 1")
    .get(PROJECT_ID, entityType, key);

const insert = (entityType, payload, idemKey, reason, evidence) =>
  db.prepare(`INSERT INTO engineering_knowledge_decisions
      (id, project_id, entity_type, entity_id, action, previous_value, new_value, reason, evidence,
       scope_type, scope_id, reversible, reverses_decision_id, decided_by, decided_role, decided_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    `${entityType.toLowerCase().replace(/[^a-z0-9]+/g, "-")}_${randomUUID()}`,
    PROJECT_ID, entityType, idemKey, "decide",
    null, JSON.stringify(payload), reason, JSON.stringify(evidence),
    "PROJECT", PROJECT_ID, 1, null, DECIDED_BY, DECIDED_ROLE, new Date().toISOString(),
  );

let written = 0, noop = 0;

// FlashScan decision
if (existing(ENTITY_PROTOCOL, FLASHSCAN_IDEM)) {
  console.log(`  [NO-OP] ${ENTITY_PROTOCOL}: already recorded (idempotency key stable)`);
  noop++;
} else if (APPLY) {
  insert(ENTITY_PROTOCOL, FLASHSCAN_DECISION, FLASHSCAN_IDEM,
    `Authoritative engineer decision recorded. Closes ${FLASHSCAN_DECISION.closes}.`,
    ["Engineer decision, 2026-09-30: FLASHSCAN_MANDATORY = NO."]);
  console.log(`  [WROTE] ${ENTITY_PROTOCOL}: FLASHSCAN_MANDATORY = NO`);
  written++;
} else {
  console.log(`  [DRY]  ${ENTITY_PROTOCOL}: would write FLASHSCAN_MANDATORY = NO`);
}

// Brand strategy decision
if (existing(ENTITY_BRAND, BRAND_IDEM)) {
  console.log(`  [NO-OP] ${ENTITY_BRAND}: already recorded (idempotency key stable)`);
  noop++;
} else if (APPLY) {
  insert(ENTITY_BRAND, BRAND_DECISION, BRAND_IDEM,
    "Company in-house Fire Alarm brand policy applied after the mandatory-brand check and the " +
    "FlashScan protocol interpretation returned FLASHSCAN_MANDATORY=NO. No mandatory brand exists, " +
    "the equipment-listing regime is UL/FM, and the governed addressable point count is 1877 (<=2000), " +
    "so the small-project in-house band applies. Routes to INTERNAL_SELECTION_AND_PRICING. " +
    "NOTIFIER is reclassified to a technically valid alternative / benchmark and is NOT deleted. " +
    "The prior 'Project Fire Alarm Ecosystem' (NOTIFIER) decision row is left untouched.",
    [
      "docs/fire-alarm-brand-and-pre-sales-policy.md sections 1, 4, 4a, 4b, 6, 8a",
      "app/domain/fire-alarm-brand-strategy.mjs (engine, policy table, company-brand registry)",
      "app/domain/fire-alarm-slc-resource-classifier.mjs (point count authority)",
      `governed point count ${resolved.addressablePointCount} <= threshold ${IN_HOUSE_FIRE_ALARM_POLICY.regimeScaleThresholds.ULF_LARGE_PROJECT_MIN_POINTS_EXCLUSIVE}`,
    ]);
  console.log(`  [WROTE] ${ENTITY_BRAND}: ${resolved.preferredBrand} / ${resolved.brandRelationship} / ${resolved.commercialWorkflow}`);
  written++;
} else {
  console.log(`  [DRY]  ${ENTITY_BRAND}: would write ${resolved.preferredBrand} / ${resolved.brandRelationship} / ${resolved.commercialWorkflow}`);
}

console.log("");
console.log(`  written=${written}  noop=${noop}`);
const ecosystemRows = db.prepare("SELECT COUNT(*) c FROM engineering_knowledge_decisions WHERE entity_type='Project Fire Alarm Ecosystem'").get().c;
console.log(`  'Project Fire Alarm Ecosystem' (NOTIFIER) rows still present, untouched: ${ecosystemRows}`);
db.close();
console.log("");
console.log(written || noop ? "  DECISION PERSISTENCE: OK" : "  DECISION PERSISTENCE: NOTHING TO DO");
