// RUN THE GOVERNED HEAT-DETECTOR RESOLUTION AGAINST REAL PROJECT DATA.
//
//   node scripts/resolve-al-mousa-heat-detectors.mjs <sqlite> [--json]
//
// READ-ONLY. Writes nothing: it produces the evidence that the governed
// decision script (scripts/decide-al-mousa-heat-detector-resolution.mjs)
// needs, and the report the human reviews before anything is persisted.
import { DatabaseSync } from "node:sqlite";
import {
  heatRequirementFromSpec, normalizeHeatRow, resolveHeatRows, matchProductForProfile,
} from "./lib/al-mousa-heat-detector-resolution.mjs";

const DB = process.argv[2];
const AS_JSON = process.argv.includes("--json");
if (!DB) { console.error("usage: node scripts/resolve-al-mousa-heat-detectors.mjs <sqlite> [--json]"); process.exit(2); }

const PROJECT = "project_ae501b85-9c12-4332-bf8e-787c90f2d388"; // Al Mousa School - Clean Golden Run
const SPEC_DOC = "doc_0ff448f7-0d2a-490a-b9ae-d3d8511c9245";      // Technical Specification 28 46 00 Rev 1
const GOVERNED_ROW = 15;

const db = new DatabaseSync(DB, { readOnly: true });

// ---- 1. BOQ rows ------------------------------------------------------------
const rawRows = db.prepare(`
  SELECT numeric_quantity, original_unit, description, section, subsection, category, system_value,
         notes, specification_reference, drawing_reference, duplicate_of_item_id, source_location
  FROM boq_items
  WHERE project_id = ? AND lower(coalesce(description,'')) = 'heat detector'
  ORDER BY json_extract(source_location,'$.row')`).all(PROJECT);

const rows = rawRows.map((r) => normalizeHeatRow({
  qty: r.numeric_quantity,
  unit: r.original_unit,
  description: r.description,
  section: r.section,
  category: r.category,
  system: r.system_value,
  notes: r.notes,
  specificationReference: r.specification_reference,
  drawingReference: r.drawing_reference,
  duplicateOfItemId: r.duplicate_of_item_id,
  row: JSON.parse(r.source_location || "{}").row,
}));

// ---- 2. Specification --------------------------------------------------------
const specClauses = db.prepare(
  "SELECT number, title, page_from, original_text FROM specification_clauses WHERE extraction_version_id = (SELECT id FROM specification_extraction_versions WHERE document_id = ?)"
).all(SPEC_DOC);
const requirement = heatRequirementFromSpec(specClauses);

// ---- 3. Product evidence -----------------------------------------------------
const rawProducts = db.prepare(
  "SELECT part_number, description, attributes, standards FROM library_products WHERE UPPER(part_number) IN ('IDP-HEAT-ROR-IV','IDP-HEAT-IV','IDP-HEAT-HT-IV')"
).all();
const products = rawProducts.map((p) => ({
  partNumber: p.part_number,
  description: p.description,
  attributes: (() => { try { return JSON.parse(p.attributes || "[]"); } catch { return []; } })(),
  standards: (() => { try { return JSON.parse(p.standards || "[]"); } catch { return []; } })(),
}));

const heatProfiles = {
  defaultProfile: { pn: "IDP-HEAT-ROR-IV", profile: "FIXED_135F_PLUS_ROR_15F_PER_MIN" },
  highTempProfile: { pn: "IDP-HEAT-HT-IV", profile: "HIGH_TEMP_135F_190F" },
};

// ---- 4. Resolve --------------------------------------------------------------
const out = resolveHeatRows({ rows, requirement, governedRow: GOVERNED_ROW, heatProfiles });
if (!out.ok) { console.error(`FAILED CLOSED: ${out.reason}`); process.exit(3); }

const match = matchProductForProfile({
  profile: "FIXED_135F_PLUS_ROR_15F_PER_MIN", products, requirement: out.requirement,
});
if (!match.ok) { console.error(`FAILED CLOSED: product match refused (${match.reason}) ${match.detail ?? ""}`); process.exit(3); }

// ---- 5. Report ---------------------------------------------------------------
const total = rows.reduce((t, r) => t + r.qty, 0);
const resolvedRows = out.rows.filter((r) => r.state === "RESOLVED");
const openRows = out.rows.filter((r) => r.state === "TECHNICAL_SELECTION_REVIEW_REQUIRED");
const governedRows = out.rows.filter((r) => r.state === "GOVERNED_EXISTING");
const newlyResolvedQty = resolvedRows.reduce((t, r) => t + r.qty, 0);
const governedQty = governedRows.reduce((t, r) => t + r.qty, 0);
const openQty = openRows.reduce((t, r) => t + r.qty, 0);
// "Resolved" for accounting purposes includes the pre-existing governed row, so
// resolvedQty + openQty must always reconcile to the 26-unit census.
const resolvedQty = newlyResolvedQty + governedQty;

if (AS_JSON) {
  console.log(JSON.stringify({ total, resolvedQty, newlyResolvedQty, governedQty, openQty, match, rows: out.rows }, null, 2));
  process.exit(0);
}

const bar = (t) => { console.log("\n" + "=".repeat(104)); console.log(t); console.log("=".repeat(104)); };
bar("GOVERNED RESOLUTION OF THE REMAINING HEAT DETECTORS  (read-only)");
console.log(`  specification : ${SPEC_DOC}`);
console.log(`  requirement  : ${out.requirement.subClause}`);
console.log(`      fixed ${out.requirement.requiredFixedSetpointF} degF (${out.requirement.requiredFixedSetpointC} degC)`
  + `  +  rate-of-rise ${out.requirement.requiredRorPerMinuteF} degF (${out.requirement.requiredRorPerMinuteC} degC) / min`);
console.log(`      variant offered: ${out.requirement.highTempSetpointF} degF (${out.requirement.highTempSetpointC} degC)`
  + `  -- trigger "applications requiring increased sensitivity"`);
console.log(`      variant offered by this spec : ${out.requirement.highTempVariantOffered ? "YES" : "NO"}`);
console.log(`      variant mapped to a location: ${out.requirement.highTempLocationAssigned ? "YES" : "NO"}`);
console.log(`      trigger resolved anywhere in project evidence: ${out.requirement.highTempTriggerResolvedInProject ? "YES" : "NO"}`);
console.log(`  match         : ${match.pn}  (${match.evidence.detectionPrinciple}, ${match.evidence.fixedSetpoint}, ${match.evidence.rateOfRise}, UL ${match.evidence.ulListing})`);
if (match.rejected) console.log(`  rejected      : ${match.rejected.pn} -- ${match.rejected.reason}`);

console.log("");
console.log("  Per-row evaluation (each row judged independently)");
console.log("  " + "-".repeat(104));
for (const r of out.rows) {
  const tag = r.state === "RESOLVED" ? `RESOLVED -> ${r.pn}`
    : r.state === "GOVERNED_EXISTING" ? "GOVERNED (existing decision kept)"
      : r.state === "TECHNICAL_SELECTION_REVIEW_REQUIRED" ? "REVIEW REQUIRED" : r.state;
  console.log(`  row ${String(r.row).padStart(4)}  qty ${String(r.qty).padStart(3)}  ${r.section.slice(0, 46).padEnd(48)}${tag}`);
  if (r.state === "RESOLVED") for (const e of r.evidenceChain) console.log(`              . ${e}`);
  if (r.state === "TECHNICAL_SELECTION_REVIEW_REQUIRED") {
    console.log(`              . ${r.reason}`);
    console.log(`              MISSING: ${r.missingDiscriminator}`);
    console.log(`              candidates if it is a high-temperature location: ${r.candidatesConsidered.join(", ")}`);
  }
}
console.log("  " + "-".repeat(104));
console.log(`  heat demand total ${total}  (census must stay visible: 26)`);
console.log(`  resolved to an exact product : ${resolvedQty}  (rows ${[...resolvedRows, ...governedRows].map((r) => r.row).join(", ") || "none"})`);
console.log(`      newly resolved           : ${newlyResolvedQty}  (rows ${resolvedRows.map((r) => r.row).join(", ") || "none"})`);
console.log(`      pre-existing governed    : ${governedQty}  (rows ${governedRows.map((r) => r.row).join(", ") || "none"})`);
console.log(`  still open                   : ${openQty}  (rows ${openRows.map((r) => r.row).join(", ") || "none"})`);
console.log("");
console.log("  NO QUANTITY IS DELETED OR ZEROED. Open rows keep their demand and stay excluded from cost.");