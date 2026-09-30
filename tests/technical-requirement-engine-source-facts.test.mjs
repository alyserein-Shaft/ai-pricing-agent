import assert from "node:assert/strict";
import test from "node:test";
import { buildTechnicalRequirementProfile } from "../app/domain/technical-requirement-engine.mjs";

// Source Fact Authority Slice 3 -- domain-level tests for
// buildTechnicalRequirementProfile's new sourceFacts input / technicalFacts
// output. Pure function tests (no DB), matching this file's established
// sibling tests/technical-requirement-engine.test.mjs style exactly.

const boqItem = { id: "boq-golden", itemNumber: "C", description: "Heat detector", system: "Fire Alarm", category: "Detector", unit: "Each", quantity: 9, productFamily: "Heat Detector", classificationConfidence: 78, projectId: "project-golden" };

const sourceFact = (overrides = {}) => ({
  factId: "fact-1", predicate: "fixed_temperature_setpoint", value: "135°F", unit: null, confidence: 94,
  scopeType: "Product Family", scopeId: "Heat Detector", factType: "Source Fact", status: "Active",
  provenance: [{ documentId: "doc-1", page: 11, section: "28 46 00", clause: "5" }], modelVersion: "spec-source-fact-promotion-1.0.0",
  ...overrides,
});

const goldenSourceFacts = () => [
  sourceFact({ factId: "fact-temp", predicate: "fixed_temperature_setpoint", value: "135°F" }),
  sourceFact({ factId: "fact-ror", predicate: "rate_of_rise_sensitivity", value: "15°F/min" }),
  sourceFact({ factId: "fact-standard", predicate: "applicable_standard", value: { body: "UL", number: "521", part: null, year: null } }),
  sourceFact({ factId: "fact-protocol", predicate: "protocol_compatibility", value: "Flash Scan, CLIP" }),
  sourceFact({ factId: "fact-base", predicate: "base_architecture", value: "Modular" }),
  sourceFact({ factId: "fact-hightemp", predicate: "high_temp_alternative_available", value: "190°F" }),
];

// A single approved, confirmed normative requirement -- used across tests to
// prove normative behavior is unaffected by Source Facts.
const normativeReq = { id: "r1", originalText: "The fire detection and alarm system shall be addressable.", normalizedRequirement: "the fire detection and alarm system shall be addressable", requirementType: "Mandatory", requirementCategory: "Compliance", system: "Fire Alarm", category: "Detector", confidence: 92, sourceType: "Specification", source: { pageFrom: 3, clause: "1" }, attributes: [], standards: [], manufacturers: [], compatibility: [], accessories: [] };
const normativeLink = { requirementId: "r1", status: "Confirmed", evidence: ["Reviewed"] };

test("A. an Active Source Fact is consumed into technicalFacts", () => {
  const profile = buildTechnicalRequirementProfile({ boqItem, sourceFacts: [sourceFact()] });
  assert.equal(profile.technicalFacts.length, 1);
  assert.equal(profile.technicalFacts[0].predicate, "fixed_temperature_setpoint");
  assert.equal(profile.technicalFacts[0].value, "135°F");
});

test("B. a Pending Review Source Fact is ignored", () => {
  const profile = buildTechnicalRequirementProfile({ boqItem, sourceFacts: [sourceFact({ status: "Pending Review" })] });
  assert.equal(profile.technicalFacts.length, 0);
});

test("C. a Rejected Source Fact is ignored", () => {
  const profile = buildTechnicalRequirementProfile({ boqItem, sourceFacts: [sourceFact({ status: "Rejected" })] });
  assert.equal(profile.technicalFacts.length, 0);
});

test("D. all six Golden Source Facts appear in profile.technicalFacts, none as fake Mandatory requirements", () => {
  const profile = buildTechnicalRequirementProfile({ boqItem, sourceFacts: goldenSourceFacts() });
  assert.equal(profile.technicalFacts.length, 6);
  const predicates = profile.technicalFacts.map((fact) => fact.predicate).sort();
  assert.deepEqual(predicates, ["applicable_standard", "base_architecture", "fixed_temperature_setpoint", "high_temp_alternative_available", "protocol_compatibility", "rate_of_rise_sensitivity"].sort());
});

test("E. Source Facts never appear in applicableRequirements", () => {
  const profile = buildTechnicalRequirementProfile({ boqItem, requirements: [normativeReq], links: [normativeLink], sourceFacts: goldenSourceFacts() });
  assert.equal(profile.applicableRequirements.length, 1);
  assert.equal(profile.applicableRequirements[0].id, "r1");
  assert.ok(!profile.applicableRequirements.some((entry) => entry.factType === "Source Fact"));
});

test("F. Source Facts never appear in consolidatedRequirements", () => {
  const profile = buildTechnicalRequirementProfile({ boqItem, requirements: [normativeReq], links: [normativeLink], sourceFacts: goldenSourceFacts() });
  assert.equal(profile.consolidatedRequirements.length, 1);
  assert.ok(!profile.consolidatedRequirements.some((entry) => /135|190|UL521|Flash Scan|Modular/i.test(entry.normalizedRequirement || "")));
});

test("G. Active applicable_standard=UL521 satisfies the 'standard' missing-information gap", () => {
  const withoutFact = buildTechnicalRequirementProfile({ boqItem, requirements: [normativeReq], links: [normativeLink] });
  assert.ok(withoutFact.missingInformation.some((entry) => entry.field === "standard"), "sanity: standard is genuinely missing without any evidence");
  const withFact = buildTechnicalRequirementProfile({ boqItem, requirements: [normativeReq], links: [normativeLink], sourceFacts: [sourceFact({ factId: "fact-standard", predicate: "applicable_standard", value: { body: "UL", number: "521" } })] });
  assert.ok(!withFact.missingInformation.some((entry) => entry.field === "standard"), "an Active UL521 Source Fact must satisfy the standard gap");
  assert.ok(withFact.standards.some((entry) => entry.body === "UL" && entry.number === "521"));
});

test("H. protocol_compatibility Source Fact appears as compatibility evidence, without dishonestly satisfying compatibilityTarget", () => {
  const profile = buildTechnicalRequirementProfile({ boqItem, requirements: [normativeReq], links: [normativeLink], sourceFacts: [sourceFact({ factId: "fact-protocol", predicate: "protocol_compatibility", value: "Flash Scan, CLIP" })] });
  assert.ok(profile.compatibility.some((entry) => entry.relationshipType === "Protocol Compatibility" && entry.value === "Flash Scan, CLIP"), "protocol evidence must be visible in profile.compatibility");
  // Detection Devices genuinely requires compatibilityTarget (a named
  // compatible panel/product) -- a protocol NAME alone must not be treated
  // as satisfying that different, stricter gap.
  assert.ok(profile.missingInformation.some((entry) => entry.field === "compatibilityTarget"), "a protocol name is not a compatible-panel target -- the real gap must remain honestly reported");
});

test("I. high_temp_alternative_available does not overwrite the 135°F default and both are visible simultaneously", () => {
  const profile = buildTechnicalRequirementProfile({ boqItem, sourceFacts: [
    sourceFact({ factId: "fact-temp", predicate: "fixed_temperature_setpoint", value: "135°F" }),
    sourceFact({ factId: "fact-hightemp", predicate: "high_temp_alternative_available", value: "190°F" }),
  ] });
  const temp = profile.technicalFacts.find((fact) => fact.predicate === "fixed_temperature_setpoint");
  const alt = profile.technicalFacts.find((fact) => fact.predicate === "high_temp_alternative_available");
  assert.equal(temp.value, "135°F");
  assert.equal(alt.value, "190°F");
  assert.equal(profile.technicalFacts.length, 2, "both must be visible simultaneously, neither overwriting the other");
});

test("J. a BOQ-Item-scoped fact takes precedence over a Product-Family-scoped fact for the same predicate, without deleting the family fact from the input set", () => {
  const familyFact = sourceFact({ factId: "fact-family", predicate: "fixed_temperature_setpoint", value: "135°F", scopeType: "Product Family", scopeId: "Heat Detector" });
  const itemFact = sourceFact({ factId: "fact-item-override", predicate: "fixed_temperature_setpoint", value: "OVERRIDE", scopeType: "BOQ Item", scopeId: boqItem.id });
  const profile = buildTechnicalRequirementProfile({ boqItem, sourceFacts: [familyFact, itemFact] });
  const matches = profile.technicalFacts.filter((fact) => fact.predicate === "fixed_temperature_setpoint");
  assert.equal(matches.length, 1, "only one authoritative value per predicate is consumed");
  assert.equal(matches[0].factId, "fact-item-override", "the more specific BOQ Item scope must win");
  // The family fact was never deleted -- it simply was not selected as
  // authoritative once a more specific scope existed for the same input set.
});

test("K. a fact named in an Open blocking conflict is excluded from technicalFacts and surfaced as a profile conflict instead, never silently resolved", () => {
  const factA = sourceFact({ factId: "fact-a", predicate: "fixed_temperature_setpoint", value: "135°F" });
  const factB = sourceFact({ factId: "fact-b", predicate: "fixed_temperature_setpoint", value: "190°F" });
  const profile = buildTechnicalRequirementProfile({ boqItem, sourceFacts: [factA, factB], sourceFactConflicts: [{ factId: "fact-a" }, { factId: "fact-b" }] });
  assert.equal(profile.technicalFacts.filter((fact) => fact.predicate === "fixed_temperature_setpoint").length, 0, "neither conflicting value is selected as authoritative");
  assert.ok(profile.conflicts.some((entry) => entry.type === "Source Fact Value Conflict" && entry.blocking === true));
});

test("L. normative requirement behavior (counts, ids, applicability) is unchanged by adding Source Facts", () => {
  const without = buildTechnicalRequirementProfile({ boqItem, requirements: [normativeReq], links: [normativeLink] });
  const withFacts = buildTechnicalRequirementProfile({ boqItem, requirements: [normativeReq], links: [normativeLink], sourceFacts: goldenSourceFacts() });
  assert.equal(without.applicableRequirements.length, withFacts.applicableRequirements.length);
  assert.deepEqual(without.applicableRequirements.map((r) => r.id), withFacts.applicableRequirements.map((r) => r.id));
  assert.equal(without.consolidatedRequirements.length, withFacts.consolidatedRequirements.length);
  assert.deepEqual(without.consolidatedRequirements.map((r) => r.id), withFacts.consolidatedRequirements.map((r) => r.id));
});

test("M. Supplier Claim / Manufacturer Rule / Human Decision / Product-scoped facts never become project Source Facts", () => {
  const supplierClaim = sourceFact({ factId: "fact-supplier", factType: "Supplier Claim", scopeType: "Product", scopeId: "product-x" });
  const manufacturerRule = sourceFact({ factId: "fact-manufacturer", factType: "Manufacturer Rule", scopeType: "Manufacturer", scopeId: "acme" });
  const humanDecision = sourceFact({ factId: "fact-human", factType: "Human Decision" });
  const profile = buildTechnicalRequirementProfile({ boqItem, sourceFacts: [supplierClaim, manufacturerRule, humanDecision] });
  assert.equal(profile.technicalFacts.length, 0, "only fact_type='Source Fact' + status='Active' may ever be consumed");
});

test("readiness: Source Facts improve evidence completeness but never bypass an unresolved blocking normative requirement gap", () => {
  // No confirmed normative requirement at all -- Source Facts alone must
  // not manufacture a "Ready" readiness state.
  const profile = buildTechnicalRequirementProfile({ boqItem, sourceFacts: goldenSourceFacts() });
  assert.notEqual(profile.readiness.status, "Ready for Matching");
  assert.ok(profile.readiness.blockingReasons.length > 0);
});

test("readiness: Source Facts never resolve a genuine engineering decision (the 190°F location question stays open)", () => {
  const profile = buildTechnicalRequirementProfile({ boqItem, sourceFacts: goldenSourceFacts() });
  // No predicate in this design ever answers "which locations need 190°F" --
  // proven structurally: no technicalFacts entry carries a boq-item-specific
  // selected-temperature value, and the family default (135°F) and the
  // alternative's mere existence (190°F) both remain visible, unresolved.
  assert.ok(!profile.technicalFacts.some((fact) => fact.scopeType === "BOQ Item"), "no per-location decision exists yet in this fixture -- correctly absent, not invented");
});
