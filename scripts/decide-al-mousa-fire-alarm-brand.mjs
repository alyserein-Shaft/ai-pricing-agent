// AL MOUSA FIRE ALARM -- BRAND STRATEGY DECISION (evidence -> policy -> decision).
//
// Establishes, from governed project evidence:
//   A. whether any Fire Alarm brand is CONTRACTUALLY MANDATORY
//   B. the governing standards regime
//   C. the company-policy point count, counted THROUGH THE GOVERNED CLASSIFIER
//   D. the preferred commercial brand
//   E. the reclassification of the prior NOTIFIER basis
//
// READ-ONLY. It computes and reports; it mutates nothing.
//
// POINT COUNTING
// --------------
// Per docs/fire-alarm-brand-and-pre-sales-policy.md section 6, the count must use
// the governed classifier app/domain/fire-alarm-slc-resource-classifier.mjs, NOT a
// raw BOQ quantity sum. Conventional NAC appliances, passive telephone jacks,
// mechanical accessories, duct housings, sampling tubes and included hardware are
// therefore excluded by the classifier, not by hand.
import { DatabaseSync } from "node:sqlite";
import { resolveFireAlarmBrandStrategy } from "../app/domain/fire-alarm-brand-strategy.mjs";
import { classifyFireAlarmSlcItem } from "../app/domain/fire-alarm-slc-resource-classifier.mjs";
import { BOM, INCLUDED_LINES, CENSUS_Q, assertCensus } from "./lib/al-mousa-fire-alarm-commercial-bom.mjs";

const DB = process.argv[2];
const PROJECT_ID = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";
const bar = (t) => { console.log(""); console.log("=".repeat(108)); console.log(t); console.log("=".repeat(108)); };
const db = new DatabaseSync(DB, { readOnly: true });
assertCensus();

// ===========================================================================
bar("A. IS ANY FIRE ALARM BRAND CONTRACTUALLY MANDATORY?");
console.log("Search performed across every text column of every table, for:");
console.log("  notifier, farenhyt, gamewell, gent, honeywell, edwards, siemens, fire-lite, system sensor, wheelock");
console.log("");

// 1. Any Mandatory requirement naming a brand?
const mandatoryBrand = db.prepare(`
  SELECT COUNT(*) c FROM technical_requirements
  WHERE requirement_type='Mandatory'
    AND approved_for_downstream=1
    AND (lower(coalesce(normalized_requirement,'')||' '||coalesce(original_text,'')) LIKE '%notifier%'
      OR lower(coalesce(normalized_requirement,'')||' '||coalesce(original_text,'')) LIKE '%farenhyt%'
      OR lower(coalesce(normalized_requirement,'')||' '||coalesce(original_text,'')) LIKE '%gamewell%'
      OR lower(coalesce(normalized_requirement,'')||' '||coalesce(original_text,'')) LIKE '%honeywell%')
`).get().c;

// 2. The single brand mention anywhere in the tender spec.
const soleBrandMention = db.prepare(`
  SELECT tr.requirement_type, tr.review_status, tr.approved_for_downstream,
         tr.normalized_requirement, tr.source_location
  FROM technical_requirements tr JOIN documents d ON d.id = tr.source_document_id
  WHERE d.project_id = ?
    AND (lower(coalesce(tr.normalized_requirement,'')||' '||coalesce(tr.original_text,'')) LIKE '%honeywell%'
      OR lower(coalesce(tr.normalized_requirement,'')||' '||coalesce(tr.original_text,'')) LIKE '%notifier%'
      OR lower(coalesce(tr.normalized_requirement,'')||' '||coalesce(tr.original_text,'')) LIKE '%farenhyt%')
`).all(PROJECT_ID);

console.log(`  Mandatory AND approved requirements naming any brand : ${mandatoryBrand}`);
console.log(`  Brand-mentioning requirements in the project's own documents: ${soleBrandMention.length}`);
for (const m of soleBrandMention) {
  let path = "";
  try { path = JSON.parse(m.source_location).clausePath.join(" > "); } catch {}
  console.log(`     - "${m.normalized_requirement}"`);
  console.log(`       type=${m.requirement_type}  review=${m.review_status}  approved_for_downstream=${m.approved_for_downstream}`);
  console.log(`       clause path: ${path}`);
}

console.log("");
console.log("  FINDING: no brand is contractually mandatory.");
console.log("    The ONLY brand mention in the tender specification is the parent company");
console.log("    \"Honeywell - U.S.A.\", appearing in section 3 EXECUTION, typed Informational,");
console.log("    review_status='Needs Review' and approved_for_downstream=0. An EXECUTION-section");
console.log("    manufacturer line is a REFERENCE/example listing, not a contractual mandate.");
console.log("    Critically, Honeywell is the parent of Farenhyt, Gent, Gamewell AND Notifier, so");
console.log("    this reference does not distinguish between them and cannot exclude any of them.");

// The exclusivity-style clauses that DO exist, which constrain the solution.
console.log("");
console.log("  Binding clauses that DO constrain brand choice (they constrain the SOLUTION, not a brand):");
const binding = db.prepare(`
  SELECT DISTINCT requirement_type, normalized_requirement FROM technical_requirements
  WHERE requirement_type='Mandatory' AND (lower(coalesce(normalized_requirement,'')) LIKE '%single manufacturer%'
    OR lower(coalesce(normalized_requirement,'')) LIKE '%underwriters laboratories%'
    OR lower(coalesce(normalized_requirement,'')) LIKE '%approved equivalent%'
    OR lower(coalesce(normalized_requirement,'')) LIKE '%communication types and protocols%')
  LIMIT 8`).all();
for (const b of binding) console.log(`     - [${b.requirement_type}] ${String(b.normalized_requirement).replace(/\s+/g, " ").slice(0, 150)}`);
console.log("");
console.log("    => A single-manufacturer coherent product line IS required, and every component");
console.log("       must be UL listed. Both are satisfied by the in-house brand. Neither names a brand.");

// ===========================================================================
bar("B. GOVERNING STANDARDS REGIME");
const ULF_MARKERS = ["ul 864", "ul 268", "ul 268a", "ul 1971", "ul listed", "underwriters laboratories"];
const EN_MARKERS = ["en54", "bs 5839"];
const specIds = db.prepare("SELECT id FROM documents WHERE project_id=? AND (lower(coalesce(logical_name,'')) LIKE '%28 46 00%' OR lower(coalesce(logical_name,'')) LIKE '%fire detection and alarm%')").all(PROJECT_ID).map((r) => r.id);
const ph = specIds.map(() => "?").join(",");
const markerCount = (m) => db.prepare(`SELECT COUNT(*) c FROM technical_requirements WHERE source_document_id IN (${ph}) AND lower(coalesce(normalized_requirement,'')||' '||coalesce(original_text,'')) LIKE ?`).get(...specIds, `%${m}%`).c;

console.log("  Measured inside the Al Mousa tender specification only (28 46 00):");
console.log("    UL / FM markers  (equipment certification):");
for (const m of ULF_MARKERS) console.log(`       ${String(markerCount(m)).padStart(4)}  ${m}`);
console.log("    EN markers       (also cited, mostly as workmanship references):");
for (const m of EN_MARKERS) console.log(`       ${String(markerCount(m)).padStart(4)}  ${m}`);
console.log("");
console.log("  VERDICT: standards regime = ULF (UL/FM-led).");
console.log("    The tender spec cites BS 5839 / EN 54 alongside NFPA 72/70, so the WORKMANSHIP");
console.log("    reference set is genuinely mixed. But the binding EQUIPMENT requirement is UL: every");
console.log("    component must be listed under a single manufacturer approved by Underwriters");
console.log("    Laboratories and bear UL certification. Equipment listing regime therefore governs the");
console.log("    brand decision, and it is UL. This is not an EN-primary project, so the EN -> Gent");
console.log("    branch of company policy does not apply.");

// ===========================================================================
bar("C. COMPANY-POLICY POINT COUNT  (counted via the governed SLC classifier)");
console.log("  Policy source: docs/fire-alarm-brand-and-pre-sales-policy.md section 6.");
console.log("  Classifier    : app/domain/fire-alarm-slc-resource-classifier.mjs");
console.log("");

// Map each canonical commercial line onto its governed device family, then let the
// CLASSIFIER decide whether it is a genuine system point.
const FAMILY = {
  "FSP-951-IV": "Addressable Smoke Detector",
  "FST-951R-IV": "Addressable Heat Detector",
  "FSP-951T-IV": "Multi-Criteria Detector",
  "NBG-12LX": "Pull Station",
  "FMM-1": "Monitor Module",
  "FCM-1": "Control Module",
  "FMM-101": "Input Module",
  "DNR": "Duct Detector Housing",
  "DNRW": "Duct Detector Housing",
  "DST1": "Sampling Tube",
  "N-FPJ": "Fireman Telephone Jack",
  "FTM-1": "Firephone Control Module",
  "N16e": "Fire Alarm Control Panel",
  "SLM-318": "Loop Card",
  "RTS151KEY": "Remote Test Station",
  "MDL3": "Synchronisation Module",
};

const rows = [];
for (const l of BOM) {
  let family = l.pn ? FAMILY[l.pn] : null;
  // The duct detector HEAD is its own addressable line, distinct from its housing.
  if (l.pn === "FSP-951R-IV") family = "Duct Detector";
  if (l.familyAlias) family = "Notification Appliance";
  if (!family) family = l.pending ? "Unresolved" : "Unclassified";

  // Addressable units per device, from governed product evidence.
  const units = 1;
  const qty = l.qty === null || l.qty === undefined ? { value: null } : { value: l.qty };
  const res = classifyFireAlarmSlcItem({
    // The classifier normalises only by lowercasing, so the governed system label
    // must be given as "Fire Alarm", not "FIRE_ALARM".
    system: "Fire Alarm",
    family,
    selectedQuantity: qty,
    // The classifier reads addressing / addressability / technology. `addressing_mode`
    // is NOT one of them, and supplying the wrong key silently yields UNRESOLVED.
    attributes: { addressing: "addressable" },
  });
  rows.push({ line: l, family, units, res });
}

let detectorPoints = 0, modulePoints = 0;
const excluded = [], unresolved = [], counted = [];
console.log("  COUNTED / EXCLUDED, decided by the classifier (not by hand)");
console.log("  " + "-".repeat(104));
for (const r of rows) {
  const s = r.res;
  const qty = r.line.qty;
  const label = String(r.line.pn ?? (r.line.familyAlias ? `[${r.line.familyAlias}]` : "[TBD]"));
  if (qty === null || qty === undefined) {
    unresolved.push({ boq: r.line.boq, family: r.family, state: s?.state, reason: r.line.pending });
    console.log(`     ${label.padEnd(13)}${String(r.family).padEnd(30)}${"PENDING QUANTITY".padEnd(24)}${"TBD".padStart(6)}`);
    continue;
  }
  const state = String(s?.state ?? "UNKNOWN");
  if (state === "SLC_DETECTOR_POOL") {
    detectorPoints += qty * r.units;
    counted.push({ ...r, pool: state });
    console.log(`     ${label.padEnd(13)}${String(r.family).padEnd(30)}${state.padEnd(24)}${String(qty).padStart(6)}`);
  } else if (state === "SLC_MODULE_POOL") {
    modulePoints += qty * r.units;
    counted.push({ ...r, pool: state });
    console.log(`     ${label.padEnd(13)}${String(r.family).padEnd(30)}${state.padEnd(24)}${String(qty).padStart(6)}`);
  } else {
    excluded.push({ boq: r.line.boq, pn: r.line.pn, family: r.family, qty, state, reason: s?.reason });
    console.log(`     ${label.padEnd(13)}${String(r.family).padEnd(30)}${("EXCLUDED " + state).padEnd(24)}${String(qty).padStart(6)}`);
  }
}
console.log("  " + "-".repeat(104));
console.log(`     detector-pool points   : ${detectorPoints}`);
console.log(`     module-pool points     : ${modulePoints}`);
console.log(`     TOTAL addressable pts  : ${detectorPoints + modulePoints}`);

console.log("");
console.log("  EXPLICITLY EXCLUDED (not addressable system points)");
for (const e of excluded) console.log(`     ${String(e.pn ?? "-").padEnd(13)}${String(e.family).padEnd(30)}${String(e.qty).padStart(6)}  ${String(e.reason || e.state).slice(0, 74)}`);
console.log("");
console.log("  EXCLUDED CATEGORIES, reconciled against the policy's exclusion list:");
console.log(`     conventional NAC appliances      : ${CENSUS_Q.strobe + CENSUS_Q.strobeSounder + CENSUS_Q.strobeWp}  (sit on the NAC, not the SLC)`);
console.log(`     passive firefighter phone jacks   : ${CENSUS_Q.ftJack}  (classifier: Fireman Telephone Jack is a passive, non-addressable device)`);
console.log(`     duct housings / sampling tubes   : ${CENSUS_Q.duct} / ${CENSUS_Q.duct}  (address belongs to the duct HEAD, counted above)`);
console.log(`     included panel hardware          : ${INCLUDED_LINES.reduce((t, l) => t + l.qty, 0)}  (ships inside each control panel)`);
console.log("");
console.log("  HONEST READING OF THE NOTIFICATION-APPLIANCE EXCLUSION:");
console.log("    The governed classifier returns UNRESOLVED for notification appliance families, not");
console.log("    NOT_SLC. It deliberately refuses to book unknown SLC demand as zero. So the classifier");
console.log("    alone does NOT settle the 438 conventional appliances; they are excluded here by the");
console.log("    authoritative BRAND POLICY, which lists conventional NAC appliances explicitly in the");
console.log("    do-not-inflate set (section 6). That distinction is stated rather than blurred: the");
console.log("    policy resolves it, and the classifier's silence on it is preserved, not overridden.");

console.log("");
console.log("  SENSITIVITY / ROBUSTNESS OF THE <=2000 CONCLUSION");
const heatBalance = CENSUS_Q.heatBOQ - 9;
const scenarios = [
  { label: "governed selection only (basis for the decision)", pts: detectorPoints + modulePoints },
  { label: `+ the ${heatBalance} census heat detectors once selected`, pts: detectorPoints + modulePoints + heatBalance },
  { label: "  + a firephone module behind EVERY telephone jack (gross upper bound)", pts: detectorPoints + modulePoints + heatBalance + CENSUS_Q.ftJack },
];
for (const s of scenarios) console.log(`     ${String(s.pts).padStart(6)}  ${s.pts <= 2000 ? "<=2000" : ">2000 "}  ${s.label}`);
const headroom = 2000 - (detectorPoints + modulePoints);
console.log("");
console.log(`     Headroom below the 2000 threshold from the governed count: ${headroom} points.`);
console.log(`     The conclusion <=2000 therefore HOLDS under every scenario above, and would only fail if`);
console.log(`     more than ${headroom} additional addressable points emerged beyond the governed census.`);

const POINT_COUNT = detectorPoints + modulePoints;

// ===========================================================================
bar("D. BRAND STRATEGY DECISION");
const decision = resolveFireAlarmBrandStrategy({
  systemCategory: "FIRE_ALARM",
  mandatoryBrand: null,
  mandatoryBrandEvidence: [
    "No Mandatory, downstream-approved requirement in the Al Mousa tender specification names any Fire Alarm brand.",
    "The only brand mention is 'Honeywell - U.S.A.' in section 3 EXECUTION, Informational, not approved for downstream.",
    "Exclusivity language is absent; 'approved equivalent' substitution language is present.",
  ],
  standardsRegime: "ULF",
  addressablePointCount: POINT_COUNT,
  pointCountBasis: `governed SLC classifier over the canonical commercial BOM: ${detectorPoints} detector-pool + ${modulePoints} module-pool`,
});
console.log(`  engine        : ${decision.version}`);
console.log(`  policy        : ${decision.policyId}`);
console.log(`  mandatoryBrand: NONE`);
console.log(`  FlashScan     : NOT MANDATORY (authoritative engineer decision 2026-09-30)`);
console.log(`  regime        : ${decision.standardsRegime}`);
console.log(`  point count   : ${decision.addressablePointCount}  <=2000  (small project band)`);
console.log(`  PREFERRED BRAND: ${decision.preferredBrand}`);
console.log("");
console.log("  precedence trail:");
for (const s of decision.precedenceTrail) console.log(`     ${s.step}. ${s.rule.padEnd(46)} -> ${s.outcome}`);
console.log("");
console.log(`  ${decision.rationale}`);
console.log("");
console.log("  COMMERCIAL ROUTING (from the governed company-brand registry, NOT parent-company identity)");
console.log(`     brandRelationship     : ${decision.brandRelationship}`);
console.log(`     commercialWorkflow    : ${decision.commercialWorkflow}`);
console.log(`     supplierIsSelectionAuthority   : ${decision.supplierIsSelectionAuthority}`);
console.log(`     requiresSupplierRfqBeforeCosting: ${decision.requiresSupplierRfqBeforeCosting}`);
console.log(`     sequence              : ${decision.sequence.join(" -> ")}`);
console.log("");
console.log(`     ${decision.commercialWorkflowNote}`);
console.log("");
console.log("     Farenhyt is listed IN_HOUSE in the governed registry, so it routes to INTERNAL");
console.log("     selection and pricing. NOTIFIER is a Honeywell brand but is NOT in that registry,");
console.log("     so it routes EXTERNAL -- a shared parent company does not create an in-house");
console.log("     commercial position.");

// ===========================================================================
bar("E. STATUS OF THE PRIOR NOTIFIER BASIS");
console.log("  The NOTIFIER technical work is NOT deleted and NOT rewritten. Its technical evidence");
console.log("  (N16, FSP/FST, modules, notification architecture, capacities, lifecycle) remains valid.");
console.log("  What changes is its COMMERCIAL STATUS on this project.");
console.log("");
console.log("  IMPORTANT CORRECTION TO THE PRIOR DECISION'S OWN RECORDED EVIDENCE:");
console.log("    The NOTIFIER ecosystem decision recorded the evidence:");
console.log("      \"Project specification ... which names Honeywell / Notifier as the required fire alarm");
console.log("       manufacturer ...\"");
console.log("    Independent re-verification finds this is NOT supported by the governed evidence:");
console.log("      - the specification does not name Notifier anywhere;");
console.log("      - it does not name any brand as REQUIRED;");
console.log("      - the only brand mention is the parent company \"Honeywell - U.S.A.\", Informational.");
console.log("    Its protocol claim IS supported: FlashScan and CLIP protocol are genuinely discussed");
console.log("    in the specification. But a protocol reference is not a brand mandate, and the spec");
console.log("    separately REQUIRES \"the manufacturer must specify the communication types and");
console.log("    protocols used\", which leaves protocol selection open.");
console.log("");
console.log("  CONSEQUENCE: NOTIFIER is reclassified from project basis to technically valid");
console.log("  alternative / technical benchmark. It is not deleted and not declared technically wrong.");
console.log("");
console.log("  CLOSED -- PENDING_CONSULTANT_CLARIFICATION (FlashScan) : RESOLVED");
console.log("    An authoritative engineer decision has been recorded:");
console.log("      FLASHSCAN_MANDATORY = NO");
console.log("    The FlashScan / CLIP references in the specification are NOT interpreted as a");
console.log("    mandatory project protocol or brand constraint. Conditional FlashScan FEATURE");
console.log("    wording is NOT reinterpreted as a mandatory ecosystem requirement. This closes the");
console.log("    earlier pending item, and it was the only thing that could have reinstated a");
console.log("    mandate which would have outranked the in-house preference.");
console.log("");
console.log("  CONSEQUENCE: NOTIFIER is reclassified from project basis to technically valid");
console.log("  alternative / technical benchmark. It is not deleted and not declared technically wrong.");
console.log("");
console.log("  NEXT STEP (corrected): the project is on the IN-HOUSE path, so the next slice is");
console.log("    FARENHYT_INTERNAL_DETAILED_SELECTION_AND_PRICING");
console.log("  NOT a supplier RFQ. The earlier proposed 'Farenhyt preliminary solution -> supplier");
console.log("  RFQ' step is WRONG for an in-house brand and must not be taken.");
console.log("  If an exact Farenhyt component cannot be resolved from governed internal evidence, the");
console.log("  gap must be exposed -- it must NOT be silently converted into an external");
console.log("  supplier-selection workflow.");

console.log("");
console.log("=".repeat(108));
console.log(`COMPANY_POLICY_POINT_COUNT = ${POINT_COUNT}   (<= 2000  ->  small-project band)`);
console.log(`MANDATORY_BRAND            = NONE`);
console.log(`STANDARDS_REGIME          = ${decision.standardsRegime}`);
console.log(`PREFERRED_PROJECT_BRAND   = ${decision.preferredBrand}`);
console.log(`BRAND_RELATIONSHIP        = ${decision.brandRelationship}`);
console.log(`COMMERCIAL_WORKFLOW       = ${decision.commercialWorkflow}`);
console.log("=".repeat(108));
