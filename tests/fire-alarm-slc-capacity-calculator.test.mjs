import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { calculateSlcExpansion } from "../app/domain/fire-alarm-slc-capacity-calculator.mjs";
import { resolveCapacityDependentAccessory } from "../app/domain/fire-alarm-slc-expansion-resolver.mjs";

// Real, verified IFP-2100 / 6815 / 5815RMK evidence (Sprint 1.1 Evidence
// Matrix -- see the Sprint 1.1 report for full citations: this repo's own
// product_source_evidence catalog text for IFP-2100HV/ECSHV, corroborated by
// the official Honeywell 6815 datasheet). Used across these tests as
// realistic fixtures -- NOT baked into the calculator itself (test #14
// checks that directly).
const realPanelCapacity = { nativeLoops: 1, detectorsPerLoop: 159, modulesPerLoop: 159, systemPointCeiling: 2100 };
const realExpansionOptions = {
  loopExpansionUnit: { partNumber: "6815", loopsAddedPerUnit: 1 },
  mountingUnit: { partNumber: "5815RMK", capacityPerMountingUnit: 2 },
};

test("1. no expansion when demand fits native capacity", () => {
  const result = calculateSlcExpansion({ demand: { detectors: 100, modules: 20 }, panelCapacity: realPanelCapacity, expansionOptions: realExpansionOptions });
  assert.equal(result.status, "NO_EXPANSION_REQUIRED");
  assert.equal(result.requiredAdditionalLoops, 0);
  assert.equal(result.requiredExpansionQuantity, 0);
});

test("2. one expansion (loop) required when demand exceeds native capacity by an evidenced amount", () => {
  // Real Opera demand: 1737 addressable detectors (516 + 1221), 0 modules.
  // 1737 / 159 = 10.9... -> 11 loops required; native=1 -> 10 additional loops
  // -> 10 x 6815 -- this is a MULTI-expansion case (test #3). For a clean
  // single-expansion case, use a smaller, still-real-shaped demand that only
  // just exceeds one native loop.
  const result = calculateSlcExpansion({ demand: { detectors: 200, modules: 0 }, panelCapacity: realPanelCapacity, expansionOptions: realExpansionOptions });
  assert.equal(result.status, "EXPANSION_REQUIRED");
  assert.equal(result.requiredAdditionalLoops, 1);
  assert.equal(result.requiredExpansionQuantity, 1);
  assert.equal(result.mountingUnit.quantity, 1);
});

test("3. multiple expansion units calculate correctly (real Opera demand shape)", () => {
  const result = calculateSlcExpansion({ demand: { detectors: 1737, modules: 0 }, panelCapacity: realPanelCapacity, expansionOptions: realExpansionOptions });
  assert.equal(result.status, "EXPANSION_REQUIRED");
  assert.equal(result.requiredAdditionalLoops, 10); // CEILING(1737/159)=11 total loops; 11-1 native=10
  assert.equal(result.requiredExpansionQuantity, 10); // 10 x 6815 (1 loop each)
  assert.equal(result.mountingUnit.quantity, 5); // CEILING(10/2) = 5 x 5815RMK
});

test("4. missing verified product capacity -> INSUFFICIENT_EVIDENCE", () => {
  const result = calculateSlcExpansion({ demand: { detectors: 500, modules: 10 }, panelCapacity: { nativeLoops: 1, detectorsPerLoop: null, modulesPerLoop: 159, systemPointCeiling: 2100 }, expansionOptions: realExpansionOptions });
  assert.equal(result.status, "INSUFFICIENT_EVIDENCE");
  assert.ok(result.missingInputs.includes("panelCapacity.detectorsPerLoop"));
});

test("5. missing project demand quantity -> INSUFFICIENT_EVIDENCE", () => {
  const result = calculateSlcExpansion({ demand: { detectors: undefined, modules: 10 }, panelCapacity: realPanelCapacity, expansionOptions: realExpansionOptions });
  assert.equal(result.status, "INSUFFICIENT_EVIDENCE");
  assert.ok(result.missingInputs.includes("demand.detectors"));
});

test("6. separate detector/module limits are not incorrectly merged into one pool", () => {
  // 159 detectors + 159 modules together would wrongly need 2 loops if
  // summed into a single 159-wide pool (318/159=2). They must NOT be
  // summed: each loop independently offers 159 of EACH, so 1 loop suffices.
  const result = calculateSlcExpansion({ demand: { detectors: 159, modules: 159 }, panelCapacity: realPanelCapacity, expansionOptions: realExpansionOptions });
  assert.equal(result.status, "NO_EXPANSION_REQUIRED");
  assert.equal(result.nativeCapacity.detectors, 159);
  assert.equal(result.nativeCapacity.modules, 159);
});

test("7. unrelated demand fields never consume SLC capacity", () => {
  const withExtra = calculateSlcExpansion({ demand: { detectors: 100, modules: 20, conventionalDevices: 99999, batteries: 12 }, panelCapacity: realPanelCapacity, expansionOptions: realExpansionOptions });
  const withoutExtra = calculateSlcExpansion({ demand: { detectors: 100, modules: 20 }, panelCapacity: realPanelCapacity, expansionOptions: realExpansionOptions });
  assert.deepEqual(withExtra, withoutExtra);
});

test("8. a CAPACITY_DEPENDENT relationship does not fire from a semantic keyword alone", () => {
  const accessory = { accessoryPartNumber: "5815RMK", accessoryProductId: "product_5815rmk", quantityRule: "CAPACITY_DEPENDENT -- quantity depends on the project's SLC loop/point count; not calculated by this system", evidence: { note: "additional SLC loop expansion needed for this project" } };
  // No capacityEvidence supplied -- text alone ("expansion", "loop") must
  // never produce EXPANSION_REQUIRED.
  const resolution = resolveCapacityDependentAccessory(accessory, undefined);
  assert.equal(resolution.status, "INSUFFICIENT_EVIDENCE");
});

test("9. the maximum supported expansion limit (system point ceiling) is enforced", () => {
  const result = calculateSlcExpansion({ demand: { detectors: 2101, modules: 0 }, panelCapacity: realPanelCapacity, expansionOptions: realExpansionOptions });
  assert.equal(result.status, "CAPACITY_EXCEEDED");
});

test("10. demand beyond system maximum -> CAPACITY_EXCEEDED (not silently expanded past evidence)", () => {
  const result = calculateSlcExpansion({ demand: { detectors: 1900, modules: 300 }, panelCapacity: realPanelCapacity, expansionOptions: realExpansionOptions });
  assert.equal(result.status, "CAPACITY_EXCEEDED");
  assert.equal(result.requiredExpansionQuantity, null);
});

test("11. headroom is never an invented percentage -- exact surplus only, policy always NONE_SPECIFIED", () => {
  const result = calculateSlcExpansion({ demand: { detectors: 200, modules: 0 }, panelCapacity: realPanelCapacity, expansionOptions: realExpansionOptions });
  assert.equal(result.headroom.headroomPolicy, "NONE_SPECIFIED");
  // 2 loops x 159 = 318 detector capacity - 200 demand = 118 headroom exactly.
  assert.equal(result.headroom.detectors, 118);
});

test("12. provenance (calculationTrace) survives every status", () => {
  for (const scenario of [
    { demand: { detectors: 50, modules: 0 }, panelCapacity: realPanelCapacity, expansionOptions: realExpansionOptions },
    { demand: { detectors: 200, modules: 0 }, panelCapacity: realPanelCapacity, expansionOptions: realExpansionOptions },
    { demand: { detectors: 5000, modules: 0 }, panelCapacity: realPanelCapacity, expansionOptions: realExpansionOptions },
    { demand: {}, panelCapacity: realPanelCapacity, expansionOptions: realExpansionOptions },
  ]) {
    const result = calculateSlcExpansion(scenario);
    assert.ok(Array.isArray(result.calculationTrace) && result.calculationTrace.length > 0, `trace missing for status ${result.status}`);
  }
});

test("13. the historical final-quotation quantity is not a calculator input and is not silently reproduced by default", () => {
  // The real historical Opera quotation used 10 x 6815 / 5 x 5815RMK. The
  // calculator has no field for "historical quantity" at all -- changing the
  // REAL BOQ-derived demand must change the result away from that historical
  // figure, proving nothing historical is baked in as a fallback/default.
  const nonHistoricalDemand = calculateSlcExpansion({ demand: { detectors: 400, modules: 0 }, panelCapacity: realPanelCapacity, expansionOptions: realExpansionOptions });
  assert.notEqual(nonHistoricalDemand.requiredExpansionQuantity, 10);
  assert.equal(nonHistoricalDemand.requiredExpansionQuantity, 2); // CEILING(400/159)=3 loops total, -1 native = 2
});

test("14. no product-specific answer is hardcoded in the calculator's own source", () => {
  const source = readFileSync(fileURLToPath(new URL("../app/domain/fire-alarm-slc-capacity-calculator.mjs", import.meta.url)), "utf8");
  for (const forbidden of ["159", "2100", "6815", "5815", "IFP-2100", "IFP-300"]) {
    assert.ok(!source.includes(forbidden), `calculator source must not hardcode "${forbidden}"`);
  }
});
