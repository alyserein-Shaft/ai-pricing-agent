import test from "node:test";
import assert from "node:assert/strict";
import { runProductMatching } from "../app/domain/product-matching-engine.mjs";

// Stage 4W -- Golden Heat Detector engineering closure (Al Mousa, Qty 9).
// Mirrors the governed Requirement 197 structure (addressing / 135F fixed /
// 15F-min ROR attributes + FlashScan/CLIP compatibility, 190F HT absent by
// engineer decision) against synthetic catalog products. Pure unit tests:
// no database, no network, no pricing writes.

const REQ_197 = "specjob_golden_requirement_197";

const req197Attributes = () => ([
  { name: "addressing", operator: "Equal", normalizedValue: "Addressable", confidence: 95 },
  { name: "fixed_temperature_setpoint", operator: "Equal", normalizedValue: "135°F", confidence: 95 },
  { name: "rate_of_rise_sensitivity", operator: "Equal", normalizedValue: "15°F/min", confidence: 95 },
]);

const req197Requirement = () => ({
  // Consolidated requirements carry engine-generated IDs
  // (consolidated:<category>|<key>), not source requirement IDs -- the
  // same shape buildTechnicalRequirementProfile persists, so coverage
  // behavior here mirrors production exactly.
  id: "consolidated:Compliance|fixed temperature rate of rise heat detectors",
  governingSourceId: REQ_197,
  requirementType: "Mandatory",
  requirementCategory: "Compliance",
  priority: "Mandatory",
  applicability: { status: "Confirmed Applicable" },
  attributes: req197Attributes(),
  standards: [],
  manufacturers: [],
  compatibility: [],
  accessories: [],
  confidence: 83,
});

const goldenProfile = (overrides = {}) => ({
  versionNumber: 10,
  boqItem: { id: "boqitem_golden", itemNumber: "C", description: "Heat detector", system: "Fire Alarm", category: "Detection Devices", productFamily: "Heat Detector", attributes: {} },
  readiness: { status: "Ready with Warnings", blockingReasons: [] },
  consolidatedRequirements: [req197Requirement()],
  standards: [],
  manufacturers: [],
  compatibility: [{ requirementId: REQ_197, targetItem: "Flash Scan® and CLIP protocol systems", relationshipType: "Compatible With", confidence: 84 }],
  accessories: [],
  derivedRequirements: [],
  ...overrides,
});

const product = (overrides = {}) => ({
  id: "p1", manufacturer: "Honeywell", family: "Heat Detector", partNumber: "IDP-HEAT-ROR-IV",
  description: "Addressable ROR heat detector", lifecycleStatus: "Active", reviewStatus: "Reviewed",
  attributes: [
    { name: "addressing", normalizedValue: "Addressable" },
    { name: "fixed_temperature_setpoint", normalizedValue: "135°F" },
    { name: "rate_of_rise_sensitivity", normalizedValue: "15°F/min" },
  ],
  standards: [],
  compatibility: [{ targetItem: "the control unit", relationshipType: "Compatible With" }],
  accessories: [],
  source: { sheet: "Catalogue", row: 1 },
  ...overrides,
});

const attributeComparisons = (candidate) =>
  candidate.comparisons.filter((entry) => entry.comparisonType === "Attribute");

test("1-3. Requirement 197 structured dimensions are consumed: addressing, 135F and ROR each produce a real attribute comparison", () => {
  const { candidates } = runProductMatching({ profile: goldenProfile(), products: [product()], prices: [], projectId: "project-1" });
  const names = attributeComparisons(candidates[0]).map((entry) => entry.required?.name);
  assert.ok(names.includes("addressing"), JSON.stringify(names));
  assert.ok(names.includes("fixed_temperature_setpoint"), JSON.stringify(names));
  assert.ok(names.includes("rate_of_rise_sensitivity"), JSON.stringify(names));
});

test("functionally correct ROR product passes all three structured dimensions", () => {
  const { candidates } = runProductMatching({ profile: goldenProfile(), products: [product()], prices: [], projectId: "project-1" });
  for (const entry of attributeComparisons(candidates[0])) {
    assert.equal(entry.result, "Pass", `${entry.required?.name}: ${entry.result}`);
    assert.equal(entry.pass, true);
  }
});

test("4-5. FlashScan/CLIP compatibility is consumed as a Compatibility comparison, not silently dropped", () => {
  const { candidates } = runProductMatching({ profile: goldenProfile(), products: [product()], prices: [], projectId: "project-1" });
  const compat = candidates[0].comparisons.filter((entry) => entry.comparisonType === "Compatibility");
  assert.equal(compat.length, 1);
  assert.match(compat[0].requirement?.targetItem || "", /Flash Scan/);
});

test("6. two-wire SLC has no structured product evidence to consume: no SLC comparison is fabricated", () => {
  const { candidates } = runProductMatching({ profile: goldenProfile(), products: [product()], prices: [], projectId: "project-1" });
  const slc = candidates[0].comparisons.filter((entry) => /two.?wire|slc/i.test(entry.required?.name || ""));
  assert.equal(slc.length, 0, "the matcher must not invent an SLC comparison without product evidence");
});

test("7. 190F high-temperature absence never fails a standard ROR product", () => {
  const { candidates } = runProductMatching({ profile: goldenProfile(), products: [product()], prices: [], projectId: "project-1" });
  const ht = candidates[0].comparisons.filter((entry) => /190|high.?temp/i.test(JSON.stringify(entry.required)));
  assert.equal(ht.length, 0, "NOT_APPLICABLE-by-absence must produce no comparison at all");
  // HT variant has 190°F setpoint (not 135°F) → genuine attribute mismatch
  const htProduct = product({ id: "p-ht", partNumber: "IDP-HEAT-HT-W", attributes: [
    { name: "addressing", normalizedValue: "Addressable" },
    { name: "fixed_temperature_setpoint", normalizedValue: "190°F" },
    { name: "rate_of_rise_sensitivity", normalizedValue: "15°F/min" },
  ] });
  const again = runProductMatching({ profile: goldenProfile(), products: [htProduct], prices: [], projectId: "project-1" });
  assert.ok(again.candidates[0].mandatoryFailures.length > 0, "an HT variant with 190°F setpoint fails on genuine 135°F mismatch, not on a 190F gate");
});

test("8. functional match plus no FlashScan/CLIP evidence does NOT pass overall", () => {
  const { candidates } = runProductMatching({ profile: goldenProfile(), products: [product()], prices: [], projectId: "project-1" });
  const candidate = candidates[0];
  // TM12: missing mandatory compatibility evidence is "Technical Review Required"
  // (mandatory unresolved), NOT "Non-Compliant" (explicit failure).
  assert.equal(candidate.technicalStatus, "Technical Review Required");
  assert.equal(candidate.recommendationTier, "Pending Evidence");
  assert.equal(candidate.mandatoryFailures.length, 0, "no explicit failure — evidence is missing, not contradictory");
  assert.ok(candidate.mandatoryUnresolved.length > 0, "missing mandatory FlashScan/CLIP evidence is mandatory unresolved");
  assert.equal(candidate.approvalReady, false);
});

test("9. same Honeywell parent company does not imply protocol compatibility", () => {
  const { candidates } = runProductMatching({ profile: goldenProfile(), products: [product({ manufacturer: "Honeywell" })], prices: [], projectId: "project-1" });
  const compat = candidates[0].comparisons.find((entry) => entry.comparisonType === "Compatibility");
  assert.equal(compat.result, "Evidence Missing");
  assert.equal(compat.pass, false);
  assert.notEqual(compat.result, "Verified Compatible");
});

test("evidence-missing is preserved as distinct from explicitly incompatible", () => {
  const incompatible = product({ compatibility: [{ targetItem: "Flash Scan® and CLIP protocol systems", relationshipType: "Does not support" }] });
  const { candidates } = runProductMatching({ profile: goldenProfile(), products: [incompatible], prices: [], projectId: "project-1" });
  assert.equal(candidates[0].comparisons.find((entry) => entry.comparisonType === "Compatibility").result, "Incompatible");
});

test("10. complete requirements plus zero compliant products: every candidate has mandatory unresolved evidence, none is explicitly Non-Compliant", () => {
  const products = [
    product(),
    product({ id: "p2", partNumber: "IDP-HEAT-W", attributes: [{ name: "addressing", normalizedValue: "Addressable" }, { name: "fixed_temperature_setpoint", normalizedValue: "135°F" }] }),
    product({ id: "p3", partNumber: "IDP-PHOTO-IV", attributes: [{ name: "addressing", normalizedValue: "Addressable" }] }),
  ];
  const { candidates } = runProductMatching({ profile: goldenProfile(), products, prices: [], projectId: "project-1" });
  assert.ok(candidates.length > 0);
  for (const candidate of candidates) {
    // TM12: missing mandatory product data is "Technical Review Required"
    // (mandatory unresolved), NOT "Non-Compliant" (explicit failure).
    assert.equal(candidate.technicalStatus, "Technical Review Required");
    assert.equal(candidate.mandatoryFailures.length, 0, "no explicit failures — evidence is missing, not contradictory");
    assert.ok(candidate.mandatoryUnresolved.length > 0, "missing mandatory evidence is mandatory unresolved");
    assert.equal(candidate.approvalReady, false);
  }
  const missingData = candidates.flatMap((candidate) => candidate.comparisons).filter((entry) => entry.comparisonType === "Technical Requirement" && entry.result === "Missing Product Data");
  assert.equal(missingData.length, 0, "fully-structured requirements must leave no requirement-side Missing Product Data; the blocker is library-side");
});

test("11. an unstructured mandatory requirement still reports Missing Product Data (never confused with a library gap)", () => {
  const unstructured = req197Requirement();
  unstructured.attributes = [];
  const { candidates } = runProductMatching({ profile: goldenProfile({ consolidatedRequirements: [unstructured] }), products: [product()], prices: [], projectId: "project-1" });
  const missing = candidates[0].comparisons.filter((entry) => entry.result === "Missing Product Data");
  assert.ok(missing.length > 0, "structure absence must stay visible as Missing Product Data");
});

test("12. no compliant candidate means no Technical Approval path: approval flags stay negative", () => {
  const { candidates } = runProductMatching({ profile: goldenProfile(), products: [product()], prices: [], projectId: "project-1" });
  for (const candidate of candidates) {
    assert.equal(candidate.approvalReady, false);
    assert.notEqual(candidate.recommendationTier, "Recommended Candidate");
  }
});

test("13. matching is side-effect free: no pricing input is consumed or mutated", () => {
  const profile = goldenProfile();
  const before = JSON.stringify(profile);
  const { candidates } = runProductMatching({ profile, products: [product()], prices: [], projectId: "project-1" });
  assert.equal(JSON.stringify(profile), before, "the input profile must be unmutated");
  assert.equal(candidates[0].commercialAvailability, "Supplier RFQ Required");
});

test("vocabulary rule: requirement values must mirror catalog normalization (degree-sign incident lock)", () => {
  const ascii = req197Requirement();
  ascii.attributes = ascii.attributes.map((entry) => ({ ...entry, normalizedValue: String(entry.normalizedValue).replace("°", "") }));
  const { candidates } = runProductMatching({ profile: goldenProfile({ consolidatedRequirements: [ascii] }), products: [product()], prices: [], projectId: "project-1" });
  const failed = attributeComparisons(candidates[0]).filter((entry) => !entry.pass);
  assert.ok(failed.length > 0, "ASCII-flattened values must not silently match degree-sign catalog values");
});
