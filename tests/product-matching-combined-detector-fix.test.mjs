import test from "node:test";
import assert from "node:assert/strict";
import { compareAttribute, runProductMatching } from "../app/domain/product-matching-engine.mjs";

// Downstream half of the combined smoke+heat detector fix (see
// boq-understanding-combined-detector-fix.test.mjs for the Understanding-
// layer half): once an engineer approves a Requirement Profile whose
// boqItem.attributes.detector_technology carries the preserved "Smoke and
// Heat" fact, Technical Matching's own existing loose-text comparison
// (detector_technology is in LOOSE_TEXT_MATCH_ATTRIBUTES, compared with
// "Includes" semantics) must still reject a single-function product -- no
// matching threshold or readiness rule is changed here, this only proves the
// existing mechanism actually enforces the invariant for this specific
// requirement shape.
const profile = (overrides = {}) => ({
  versionNumber: 1,
  boqItem: { id: "boq-1", description: "Combined smoke and heat detector", system: "Fire Alarm", category: "Detection Devices", productFamily: null, attributes: { detector_technology: "Smoke and Heat" } },
  readiness: { status: "Ready for Matching", blockingReasons: [] },
  consolidatedRequirements: [],
  standards: [],
  manufacturers: [],
  compatibility: [],
  accessories: [],
  derivedRequirements: [],
  clarifications: [],
  ...overrides,
});
const product = (overrides = {}) => ({
  id: "p1",
  manufacturer: "Honeywell",
  family: "Addressable Heat Detector",
  partNumber: "IDP-HEAT-IV",
  description: "Addressable heat detector",
  lifecycleStatus: "Active",
  reviewStatus: "Reviewed",
  attributes: [],
  standards: [],
  compatibility: [],
  accessories: [],
  source: { sheet: "Catalogue", row: 1 },
  ...overrides,
});

test("a heat-only product cannot become a Technically Compliant / Recommended match for a combined smoke+heat requirement", () => {
  const heatOnly = product({ attributes: [{ name: "detector_technology", normalizedValue: "Heat" }] });
  const result = runProductMatching({ profile: profile(), products: [heatOnly] });
  const candidate = result.candidates[0];
  assert.equal(candidate.technicalStatus, "Non-Compliant");
  assert.notEqual(candidate.recommendationTier, "Recommended Candidate");
  assert.ok(candidate.mandatoryFailures.some((entry) => entry.requirement?.attributeName === "detector_technology"), `mandatoryFailures: ${JSON.stringify(candidate.mandatoryFailures)}`);
  assert.equal(candidate.approvalReady, false);
});

test("a smoke-only product cannot become a Technically Compliant / Recommended match for a combined smoke+heat requirement", () => {
  const smokeOnly = product({ family: "Addressable Smoke Detector", partNumber: "IDP-PHOTO-W", attributes: [{ name: "detector_technology", normalizedValue: "Smoke" }] });
  const result = runProductMatching({ profile: profile(), products: [smokeOnly] });
  const candidate = result.candidates[0];
  assert.equal(candidate.technicalStatus, "Non-Compliant");
  assert.notEqual(candidate.recommendationTier, "Recommended Candidate");
  assert.ok(candidate.mandatoryFailures.some((entry) => entry.requirement?.attributeName === "detector_technology"));
});

test("a genuine combined-technology product (e.g. catalog text naming both functions) can pass the detector_technology gate", () => {
  const combined = product({ family: "Multi-Criteria Detector", partNumber: "IDP-PTIR", attributes: [{ name: "detector_technology", normalizedValue: "Photoelectric smoke and heat detection" }] });
  const result = runProductMatching({ profile: profile(), products: [combined] });
  const candidate = result.candidates[0];
  assert.equal(candidate.mandatoryFailures.some((entry) => entry.requirement?.attributeName === "detector_technology"), false);
});

// A specification-confirmed mandatory requirement (profile.consolidatedRequirements,
// unlike the approved-but-unverified profile.boqItem.attributes exercised
// above, which deliberately never blocks on absent catalog evidence -- see
// findAttributeByCanonicalName's own comment) must still fail closed when the
// catalog has no recorded value at all for the required attribute.
test("missing mandatory evidence cannot become a confirmed match", () => {
  const mandatoryDetectorTechnology = profile({
    consolidatedRequirements: [{ id: "r-detector-technology", normalizedRequirement: "the device shall detect both smoke and heat", priority: "Critical Mandatory", attributes: [{ name: "detector_technology", operator: "Includes", normalizedValue: "Smoke and Heat" }] }],
    boqItem: { ...profile().boqItem, attributes: {} },
  });
  const noAttribute = product({ attributes: [] });
  const result = runProductMatching({ profile: mandatoryDetectorTechnology, products: [noAttribute] });
  const candidate = result.candidates[0];
  const detectorComparison = candidate.comparisons.find((entry) => entry.requirement?.id === "r-detector-technology");
  assert.equal(detectorComparison.result, "Missing Product Data");
  assert.equal(detectorComparison.pass, false);
  assert.equal(detectorComparison.blocking, false, "TM4: missing evidence is non-blocking at comparison level");
  assert.equal(candidate.mandatoryFailures.length, 0, "TM12: missing evidence is not explicit failure");
  assert.ok(candidate.mandatoryUnresolved.length > 0, "TM12: missing Critical Mandatory evidence is mandatory unresolved");
  assert.equal(candidate.technicalStatus, "Discovery Only", "discovery precedence (null productFamily) applies before mandatory-unresolved status per existing TM12 ordering");
  assert.notEqual(candidate.recommendationTier, "Recommended Candidate");
  assert.equal(candidate.approvalReady, false);
});

test("Unknown never counts as satisfied -- compareAttribute never passes when unit conversion cannot be resolved", () => {
  const result = compareAttribute({ name: "Power", operator: "Minimum", value: 1, unit: "kW" }, { name: "Power", value: "N/A", unit: "furlongs" });
  assert.equal(result.result, "Unknown");
  assert.equal(result.pass, false);
  assert.equal(result.blocking, true);
});
