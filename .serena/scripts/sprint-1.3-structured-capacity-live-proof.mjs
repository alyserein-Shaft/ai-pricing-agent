#!/usr/bin/env node
/**
 * Sprint 1.3 -- Task 8 live proof. Read-only against the real live D1 file.
 *
 * Re-runs the Sprint 1.1 calculator's exact real Opera demand (1737 detectors)
 * against the panel capacity evidence read STRUCTURALLY from
 * library_products.attributes (native_slc_loops, max_detectors_per_loop,
 * max_modules_per_loop, max_system_points) instead of hand-transcribed from
 * raw description text, proving the Sprint 1.3 extraction closes that gap.
 */
import { DatabaseSync } from "node:sqlite";
import { calculateSlcExpansion } from "../app/domain/fire-alarm-slc-capacity-calculator.mjs";

const dbPath = process.argv[2];
if (!dbPath) throw new Error("Usage: sprint-1.3-structured-capacity-live-proof.mjs <db-path>");
const raw = new DatabaseSync(dbPath, { readOnly: true });
const IFP_2100HV_ID = "product_ec9dcbb1-39fe-4d24-b369-8b3d271604a7";

const row = raw.prepare("SELECT part_number, attributes FROM library_products WHERE id = ?").get(IFP_2100HV_ID);
const attributes = JSON.parse(row.attributes);
const byName = (name) => attributes.find((a) => a.name === name);

console.log(`Panel: ${row.part_number}`);
console.log("Structured capacity attributes read from library_products.attributes (no raw description parsing at proof time):");
for (const name of ["native_slc_loops", "max_detectors_per_loop", "max_modules_per_loop", "max_system_points"]) {
  const entry = byName(name);
  if (!entry) throw new Error(`Missing structured attribute "${name}" -- Sprint 1.3 extraction did not populate it.`);
  console.log(`  ${name} = ${entry.value}  (source: "${entry.sourceText}", extractionMethod: ${entry.extractionMethod})`);
}

const panelCapacity = {
  nativeLoops: byName("native_slc_loops").value,
  detectorsPerLoop: byName("max_detectors_per_loop").value,
  modulesPerLoop: byName("max_modules_per_loop").value,
  systemPointCeiling: byName("max_system_points").value,
};
const expansionOptions = {
  loopExpansionUnit: { partNumber: "6815", loopsAddedPerUnit: 1 },
  mountingUnit: { partNumber: "5815RMK", capacityPerMountingUnit: 2 },
};

const result = calculateSlcExpansion({ demand: { detectors: 1737, modules: 0 }, panelCapacity, expansionOptions });
console.log(`\nCalculator result using ONLY structured Product Knowledge attributes:`);
console.log(`  status: ${result.status}`);
for (const step of result.calculationTrace) console.log(`  - ${step}`);
console.log(`\n  requiredExpansionQuantity (6815): ${result.requiredExpansionQuantity}`);
console.log(`  mountingUnit (5815RMK) quantity: ${result.mountingUnit?.quantity}`);
console.log(`\nMatches Sprint 1.1's raw-description-derived result (10 x 6815, 5 x 5815RMK): ${result.requiredExpansionQuantity === 10 && result.mountingUnit?.quantity === 5}`);
console.log("Note: this remains a NON_AUTHORITATIVE_AGGREGATE_CHECK at project level per Sprint 1.2 (no panel topology evidence is ingested yet).");
