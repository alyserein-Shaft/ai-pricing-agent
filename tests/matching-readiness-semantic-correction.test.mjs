import test from "node:test";
import assert from "node:assert/strict";
import { runProductMatching } from "../app/domain/product-matching-engine.mjs";
import { governedAttributeProfile, mandatoryMatchingAttributes } from "../app/domain/engineering-attribute-profiles.mjs";
import { evaluateUnderstandingAuthority } from "../app/domain/estimator-understanding-review.mjs";
import { requiresPanelCompatibility } from "../app/domain/system-knowledge-registry.mjs";
import { detectMissingInformation } from "../app/domain/technical-requirement-engine.mjs";

// Matching-readiness semantic correction -- product_type/protocol/
// compatible_panel_family/loop_compatibility/operating_voltage were
// reclassified from "Mandatory" to "Comparison" importance
// (fire-alarm-taxonomy.mjs). The Al Mousa School Heat Detector audit proved
// this blanket rule was never enforced by any real matching execution path:
// buildSearchScope() never reads these five, executeProductMatching() never
// checks matchingBlockers/readiness before searching, and
// authorizeTechnicalMatchApproval() (the one function that would turn the
// label into a real refusal) is still, deliberately, never called from any
// execution path. This file proves: (1) the readiness label is now honest,
// (2) the actual comparison mechanism these attributes feed is completely
// untouched -- present values are still compared, absent values remain
// genuinely unknown (never silently satisfied), and a real mismatch still
// fails exactly as before.

test("1. Heat Detector with all five attributes missing receives zero pre-discovery matching blockers", () => {
  const f = (value, origin = "INFERRED", confidence = 70) => ({ value, origin, confidence });
  const interpretation = {
    system: f("Fire Alarm", "INFERRED", 70),
    category: f("Detection Devices", "INFERRED", 70),
    productFamily: f("Heat Detector", "INFERRED", 70),
    subcategory: f(null, "MISSING", 0),
    equipmentType: f("Heat Detector", "EXTRACTED", 100),
    attributes: {
      operating_voltage: f(null, "MISSING", 0),
      detector_technology: f("heat detector", "EXTRACTED", 100),
      product_type: f(null, "MISSING", 0),
      addressing: f(null, "MISSING", 0),
      protocol: f(null, "MISSING", 0),
      compatible_panel_family: f(null, "MISSING", 0),
      loop_compatibility: f(null, "MISSING", 0),
    },
    manufacturerPreferences: [], manufacturerRestrictions: [], standards: [], compatibilityRequirements: [], requiredAccessories: [],
    searchTerms: [], missingInformation: [], ambiguities: [], engineeringNotes: [], reviewReasons: [], confidence: "LOW",
  };
  const authority = evaluateUnderstandingAuthority({ interpretation, reviewStatus: "APPROVED", taxonomyValid: true });
  assert.deepEqual(authority.matchingBlockers, []);
  assert.equal(authority.technicalMatchReadiness.ready, true);
  assert.equal(mandatoryMatchingAttributes("Fire Alarm", "Heat Detector").length, 0);
  const profile = governedAttributeProfile("Fire Alarm", "Heat Detector");
  assert.equal(profile.matchingImportance.product_type, "Comparison");
  assert.equal(profile.matchingImportance.protocol, "Comparison");
  assert.equal(profile.matchingImportance.compatible_panel_family, "Comparison");
  assert.equal(profile.matchingImportance.loop_compatibility, "Comparison");
  assert.equal(profile.matchingImportance.operating_voltage, "Comparison");
});

const profile = (overrides = {}) => ({
  versionNumber: 1,
  boqItem: { id: "boq-15", description: "Heat detector", system: "Fire Alarm", category: "Detection Devices", productFamily: "Heat Detector", attributes: {} },
  readiness: { status: "Ready for Matching", blockingReasons: [] },
  consolidatedRequirements: [], standards: [], manufacturers: [], compatibility: [], accessories: [], derivedRequirements: [], clarifications: [],
  ...overrides,
});
const product = (overrides = {}) => ({
  id: "p1", manufacturer: "Honeywell", family: "Heat Detector", partNumber: "IDP-HEAT-IV", description: "Addressable heat detector",
  lifecycleStatus: "Active", reviewStatus: "Reviewed", attributes: [], standards: [], compatibility: [], accessories: [],
  source: { sheet: "Catalogue", row: 1 }, ...overrides,
});

test("2. a comparison attribute genuinely absent on the BOQ side is never evaluated -- remains unknown, not silently satisfied", () => {
  const result = runProductMatching({ profile: profile(), products: [product({ attributes: [] })] });
  const candidate = result.candidates[0];
  const protocolComparison = candidate.comparisons.find((entry) => entry.requirement?.attributeName === "protocol");
  assert.equal(protocolComparison, undefined, "no comparison entry should exist for an attribute the BOQ side never asserted a value for");
  // Absence must never count as a mandatory failure either -- distinct from
  // a real, present-but-mismatched requirement (test 4 below).
  assert.equal(candidate.mandatoryFailures.some((entry) => entry.requirement?.attributeName === "protocol"), false);
});

test("3. a project/BOQ-side value that IS present is still compared against the candidate's own value", () => {
  const withProtocolRequirement = profile({ boqItem: { ...profile().boqItem, attributes: { protocol: "Farenhyt CLIP" } } });
  const matchingCandidate = product({ attributes: [{ name: "protocol", normalizedValue: "Farenhyt CLIP" }] });
  const result = runProductMatching({ profile: withProtocolRequirement, products: [matchingCandidate] });
  const candidate = result.candidates[0];
  const protocolComparison = candidate.comparisons.find((entry) => entry.requirement?.attributeName === "protocol");
  assert.ok(protocolComparison, "a present BOQ-side value must still produce a real comparison");
  assert.equal(protocolComparison.result, "Pass");
  assert.equal(protocolComparison.pass, true);
});

test("4. a present requirement compared against a conflicting candidate value still fails, exactly as before", () => {
  const withProtocolRequirement = profile({ boqItem: { ...profile().boqItem, attributes: { protocol: "Farenhyt CLIP" } } });
  const conflictingCandidate = product({ attributes: [{ name: "protocol", normalizedValue: "Notifier CLIP" }] });
  const result = runProductMatching({ profile: withProtocolRequirement, products: [conflictingCandidate] });
  const candidate = result.candidates[0];
  const protocolComparison = candidate.comparisons.find((entry) => entry.requirement?.attributeName === "protocol");
  assert.equal(protocolComparison.result, "Fail");
  assert.equal(protocolComparison.blocking, true);
  assert.ok(candidate.mandatoryFailures.some((entry) => entry.requirement?.attributeName === "protocol"));
  assert.equal(candidate.technicalStatus, "Non-Compliant");
});

test("5. missing compatibility evidence on any of the five attributes never fabricates a pass -- operating_voltage behaves identically to protocol", () => {
  const withVoltageRequirement = profile({ boqItem: { ...profile().boqItem, attributes: { operating_voltage: "24 VDC" } } });
  const noEvidenceCandidate = product({ attributes: [] });
  const result = runProductMatching({ profile: withVoltageRequirement, products: [noEvidenceCandidate] });
  const candidate = result.candidates[0];
  const voltageComparison = candidate.comparisons.find((entry) => entry.requirement?.attributeName === "operating_voltage");
  assert.equal(voltageComparison.result, "Missing Product Data");
  assert.equal(voltageComparison.pass, false);
});

test("6. candidate discovery scope is unchanged -- buildSearchScope/candidate universe never reads any of the five attributes", () => {
  // A BOQ item with no productFamily-defining attributes at all still
  // retrieves the same family-scoped candidates as one with them populated --
  // discovery is driven by system/category/productFamily/manufacturer/
  // partNumber only, never by product_type/protocol/compatible_panel_family/
  // loop_compatibility/operating_voltage.
  const bare = runProductMatching({ profile: profile(), products: [product()] });
  const withExtraAttrs = runProductMatching({ profile: profile({ boqItem: { ...profile().boqItem, attributes: { protocol: "Farenhyt CLIP", operating_voltage: "24 VDC" } } }), products: [product()] });
  assert.equal(bare.candidates.length, withExtraAttrs.candidates.length);
  assert.equal(bare.candidates[0].product.id, withExtraAttrs.candidates[0].product.id);
  assert.equal(bare.candidates[0].searchStage, withExtraAttrs.candidates[0].searchStage);
});

test("7. compatibilityTarget is untouched by this change -- still blocking for Heat Detector (Detection Devices) when no project compatibility evidence exists", () => {
  // fireAlarmRequiresPanelCompatibility / PANEL_COMPATIBILITY_REQUIRED_CATEGORIES
  // is a completely separate mechanism from matchingImportance/mandatory --
  // untouched by this change. Still true for the neutral Heat Detector family.
  assert.equal(requiresPanelCompatibility("Fire Alarm", "Detection Devices", "Heat Detector"), true);
  const missing = detectMissingInformation({
    boqItem: { system: "Fire Alarm", category: "Detection Devices", description: "Heat detector", unit: "Each", quantity: "9", productFamily: "Heat Detector", itemNumber: "C" },
    consolidated: [], standards: [], compatibility: [], // no confirmed compatibility relationship/link exists
  });
  const compatibilityTargetEntry = missing.find((entry) => entry.field === "compatibilityTarget");
  assert.ok(compatibilityTargetEntry, "compatibilityTarget must still be reported as missing");
  assert.equal(compatibilityTargetEntry.blocking, true, "compatibilityTarget must still block readiness for Detection Devices, unlike the five reclassified attributes");
});
