import test from "node:test";
import assert from "node:assert/strict";
import { compareAttribute, generateCandidates, runProductMatching } from "../app/domain/product-matching-engine.mjs";

const profile = (overrides = {}) => ({ versionNumber: 1, boqItem: { id: "boq-1", description: "Addressable smoke detector", system: "Fire Alarm", category: "Detection Device", productFamily: "Addressable Smoke Detector" }, readiness: { status: "Ready for Matching", blockingReasons: [] }, consolidatedRequirements: [{ id: "r-voltage", normalizedRequirement: "24 V operation", priority: "Critical Mandatory", attributes: [{ name: "Voltage", operator: "Equal", normalizedValue: 24, normalizedUnit: "V" }] }], standards: [{ body: "EN54", number: "7" }], manufacturers: [], compatibility: [{ targetItem: "Farenhyt protocol" }], accessories: [{ accessory: "Detector base" }], derivedRequirements: [], clarifications: [], ...overrides });
const product = (overrides = {}) => ({ id: "p1", manufacturer: "Honeywell", family: "Addressable Smoke Detector", partNumber: "IDP-PHOTO-W", description: "Addressable photoelectric smoke detector", lifecycleStatus: "Active", reviewStatus: "Reviewed", attributes: [{ name: "Voltage", normalizedValue: 24, normalizedUnit: "V" }], standards: [{ body: "EN54", number: "7", evidence: { documentId: "d1" } }], compatibility: [{ targetItem: "Farenhyt protocol", relationshipType: "Compatible With" }], accessories: [{ name: "Detector base" }], source: { sheet: "Catalogue", row: 12 }, ...overrides });

test("compares numeric requirements with canonical unit conversion", () => { const result = compareAttribute({ name: "Power", operator: "Minimum", value: 1, unit: "kW" }, { name: "Power", value: 1200, unit: "W" }); assert.equal(result.result, "Pass"); assert.equal(result.conversion.product.normalizedValue, 1.2); });
test("exact identity search is staged ahead of structured discovery", () => { const exactProfile = profile({ boqItem: { ...profile().boqItem, partNumber: "IDP-PHOTO-W" } }); const result = generateCandidates({ profile: exactProfile, products: [product(), product({ id: "p2", partNumber: "OTHER" })] }); assert.equal(result.candidates[0].stage, "Exact Identity"); assert.deepEqual(result.candidates[0].basis, ["Exact Part Number"]); });
test("mandatory technical failure overrides commercial availability", () => { const result = runProductMatching({ profile: profile(), products: [product({ attributes: [{ name: "Voltage", normalizedValue: 12, normalizedUnit: "V" }] })], prices: [{ productId: "p1", approvalStatus: "Approved", downstreamUse: "Costing", validUntil: "2099-01-01" }] }); assert.equal(result.candidates[0].technicalStatus, "Non-Compliant"); assert.equal(result.candidates[0].recommendationTier, "Rejected Candidate"); assert.equal(result.candidates[0].components.mandatoryCompliance, 0); assert.equal(result.noMatch.reason.includes("mandatory"), true); });
test("missing certification and compatibility cannot produce high confidence", () => { const result = runProductMatching({ profile: profile(), products: [product({ standards: [], compatibility: [] })] }); assert.ok(result.candidates[0].mandatoryFailures.length >= 2); assert.notEqual(result.candidates[0].confidence, "High Confidence"); assert.equal(result.candidates[0].approvalReady, false); });
test("an unstructured mandatory statement fails closed as missing product evidence", () => { const result = runProductMatching({ profile: profile({ consolidatedRequirements: [{ id: "r-text", normalizedRequirement: "Device shall be authority approved", priority: "Mandatory", attributes: [] }], standards: [], compatibility: [], accessories: [] }), products: [product()] }); assert.equal(result.candidates[0].technicalStatus, "Non-Compliant"); assert.ok(result.candidates[0].comparisons.some((entry) => entry.result === "Missing Product Data")); });
test("a compliant candidate is ranked with decomposable scoring and explanation", () => { const result = runProductMatching({ profile: profile(), products: [product()] }); const candidate = result.candidates[0]; assert.equal(candidate.technicalStatus, "Technically Compliant"); assert.equal(candidate.recommendationTier, "Recommended Candidate"); assert.equal(candidate.rank, 1); assert.ok(candidate.components.mandatoryCompliance > 0); assert.match(candidate.explanation, /Commercial state/); assert.equal(candidate.approvalReady, false); });
test("a classified but technically unready item remains discovery-only", () => { const result = runProductMatching({ profile: profile({ readiness: { status: "Missing Critical Information", blockingReasons: ["Compatibility target missing"] } }), products: [product()] }); assert.equal(result.status, "Discovery Only"); assert.equal(result.candidates[0].recommendationTier, "Discovery Candidate"); assert.equal(result.candidates[0].approvalReady, false); });
test("an unclassified item cannot enter product discovery", () => { const result = runProductMatching({ profile: profile({ boqItem: { description: "Unclassified equipment" }, readiness: { status: "Classification Required", blockingReasons: ["Discipline missing"] } }), products: [product()] }); assert.equal(result.status, "Not Ready"); assert.equal(result.candidates.length, 0); assert.deepEqual(result.noMatch.blockers, ["Discipline missing"]); });
test("semantic-only discovery cannot become recommended", () => { const discoveryProduct = product({ family: "Other", category: "Other", description: "Addressable smoke detector device" }); const result = runProductMatching({ profile: profile(), products: [discoveryProduct] }); assert.equal(result.candidates[0].recommendationTier, "Discovery Candidate"); assert.equal(result.candidates[0].confidence, "Discovery Only"); });

test("compareAttribute accepts canonical Equals operator", () => {
  const result = compareAttribute(
    {
      name: "Voltage",
      operator: "Equals",
      value: 24,
      unit: "V",
    },
    {
      name: "Voltage",
      originalValue: "24 V DC",
      normalizedValue: 24,
      normalizedUnit: "V",
    },
  );

  assert.equal(result.pass, true);
  assert.equal(result.result, "Pass");
  assert.equal(result.blocking, false);
  assert.equal(result.difference, 0);
});
