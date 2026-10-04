#!/usr/bin/env node
/**
 * Mini Sprint 1.8 -- fully-structured SLC sizing proof. Read-only against
 * the real live D1 file.
 *
 * Unlike scripts/sprint-1.3-structured-capacity-live-proof.mjs (which still
 * hardcoded expansionOptions.loopExpansionUnit.loopsAddedPerUnit=1 and
 * expansionOptions.mountingUnit.capacityPerMountingUnit=2 in the caller),
 * this script reads EVERY capacity input from structured, provenance-backed
 * Product Knowledge / relationship data:
 *   - panel capacity: library_products.attributes (IFP-2100HV) -- unchanged
 *     from Sprint 1.3.
 *   - 6815's own loops-added-per-unit: library_products.attributes (6815),
 *     written this sprint from the official Honeywell 6815 datasheet.
 *   - 5815RMK's mounting capacity: product_accessories.quantity_parameter
 *     (the real, Sprint-0.9-approved governed relationship row), not a
 *     caller-side constant.
 *
 * Zero expansion-capacity numbers are hardcoded anywhere in this script.
 */
import { DatabaseSync } from "node:sqlite";
import { calculateSlcExpansion } from "../app/domain/fire-alarm-slc-capacity-calculator.mjs";

const dbPath = process.argv[2];
if (!dbPath) throw new Error("Usage: sprint-1.8-fully-structured-sizing-proof.mjs <db-path>");
const raw = new DatabaseSync(dbPath, { readOnly: true });
const IFP_2100HV_ID = "product_ec9dcbb1-39fe-4d24-b369-8b3d271604a7";

const panelRow = raw.prepare("SELECT part_number, attributes FROM library_products WHERE id = ?").get(IFP_2100HV_ID);
const panelAttributes = JSON.parse(panelRow.attributes);
const byName = (attributes, name) => attributes.find((a) => a.name === name);

console.log(`Panel: ${panelRow.part_number}`);
console.log("Panel capacity attributes (structured, library_products.attributes):");
for (const name of ["native_slc_loops", "max_detectors_per_loop", "max_modules_per_loop", "max_system_points"]) {
  const entry = byName(panelAttributes, name);
  if (!entry) throw new Error(`Missing structured attribute "${name}" on the panel.`);
  console.log(`  ${name} = ${entry.value}`);
}

const expansionUnitRow = raw.prepare("SELECT part_number, attributes FROM library_products WHERE part_number = '6815'").get();
const expansionUnitAttributes = JSON.parse(expansionUnitRow.attributes);
const addedLoops = byName(expansionUnitAttributes, "added_slc_loops");
if (!addedLoops) throw new Error("6815 is missing structured added_slc_loops -- this proof requires it, no caller-side fallback.");
console.log(`\nExpansion unit: ${expansionUnitRow.part_number}`);
console.log(`  added_slc_loops = ${addedLoops.value} (confidence ${addedLoops.confidence})`);
console.log(`  source: ${addedLoops.sourceText.slice(0, 140)}...`);

const mountingRow = raw.prepare(`
  SELECT p.part_number mounting_pn, pa.quantity_parameter, pa.review_status
  FROM product_accessories pa
  JOIN library_products p ON p.id = pa.product_id
  JOIN library_products ap ON ap.id = pa.accessory_product_id
  WHERE p.part_number = '5815RMK' AND ap.part_number = '6815' AND pa.deleted_at IS NULL AND pa.superseded_at IS NULL
`).get();
if (!mountingRow || mountingRow.review_status !== "Approved" || !mountingRow.quantity_parameter) {
  throw new Error("5815RMK->6815 governed relationship is missing/unapproved -- this proof requires it, no caller-side fallback.");
}
console.log(`\nMounting unit: ${mountingRow.mounting_pn} (governed relationship, review_status=${mountingRow.review_status})`);
console.log(`  quantity_parameter (capacity per mounting unit) = ${mountingRow.quantity_parameter}`);

const panelCapacity = {
  nativeLoops: byName(panelAttributes, "native_slc_loops").value,
  detectorsPerLoop: byName(panelAttributes, "max_detectors_per_loop").value,
  modulesPerLoop: byName(panelAttributes, "max_modules_per_loop").value,
  systemPointCeiling: byName(panelAttributes, "max_system_points").value,
};
const expansionOptions = {
  loopExpansionUnit: { partNumber: expansionUnitRow.part_number, loopsAddedPerUnit: addedLoops.value },
  mountingUnit: { partNumber: mountingRow.mounting_pn, capacityPerMountingUnit: mountingRow.quantity_parameter },
};

const result = calculateSlcExpansion({ demand: { detectors: 1737, modules: 0 }, panelCapacity, expansionOptions });
console.log(`\nCalculator result using ONLY structured Product Knowledge + governed relationship data (zero hardcoded expansion constants):`);
console.log(`  status: ${result.status}`);
for (const step of result.calculationTrace) console.log(`  - ${step}`);
console.log(`\n  requiredExpansionQuantity (${expansionOptions.loopExpansionUnit.partNumber}): ${result.requiredExpansionQuantity}`);
console.log(`  mountingUnit (${expansionOptions.mountingUnit.partNumber}) quantity: ${result.mountingUnit?.quantity}`);
console.log(`\nMatches Sprint 1.1's original result (10 x 6815, 5 x 5815RMK): ${result.requiredExpansionQuantity === 10 && result.mountingUnit?.quantity === 5}`);
console.log("Note: this remains a NON_AUTHORITATIVE_AGGREGATE_CHECK at project level -- panel topology evidence is still incomplete (Sprint 1.2/1.6/1.7).");
