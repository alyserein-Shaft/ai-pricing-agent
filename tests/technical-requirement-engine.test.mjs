import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildTechnicalRequirementProfile, consolidateRequirements, detectAttributeValueConflicts, detectRequirementConflicts, generateDerivedRequirements, resolveApplicability } from "../app/domain/technical-requirement-engine.mjs";

const item = { id: "boq-1", itemNumber: "FA-01", description: "Addressable smoke detector", system: "Fire Alarm", category: "Detection Device", unit: "No.", quantity: 20, productFamily: "Addressable Smoke Detector", classificationConfidence: 95 };
const req = (overrides = {}) => ({ id: "r1", originalText: "Smoke detectors shall comply with EN 54-7.", normalizedRequirement: "smoke detectors shall comply with en 54 7", requirementType: "Mandatory", requirementCategory: "Standards", system: "Fire Alarm", category: "Detection Device", confidence: 92, sourceType: "Specification", source: { pageFrom: 4, clause: "2.3" }, attributes: [], standards: [{ body: "EN54", number: "7", confidence: 94 }], manufacturers: [], compatibility: [{ targetItem: "Addressable control panel protocol", confidence: 80 }], accessories: [], ...overrides });
test("separates suggested applicability from confirmed applicability", () => { assert.equal(resolveApplicability({ boqItem: item, requirement: req(), link: { status: "Suggested", confidence: 80 } }).status, "Suggested Applicable"); assert.equal(resolveApplicability({ boqItem: item, requirement: req(), link: { status: "Confirmed", evidence: ["Engineer review"] } }).status, "Confirmed Applicable"); });
test("consolidates equivalent requirements without losing source provenance", () => { const result = consolidateRequirements([req(), req({ id: "r2", sourceType: "BOQ", source: { row: 12 }, confidence: 80 })]); assert.equal(result.length, 1); assert.equal(result[0].sources.length, 2); assert.equal(result[0].governingSourceId, "r1"); });
test("detects blocking structured value conflicts", () => { const groups = consolidateRequirements([req({ attributes: [{ name: "Voltage", normalizedValue: 24, normalizedUnit: "V" }] }), req({ id: "r2", attributes: [{ name: "Voltage", normalizedValue: 12, normalizedUnit: "V" }] })]); const conflicts = detectRequirementConflicts(groups); assert.equal(conflicts[0].severity, "Critical"); assert.equal(conflicts[0].blocking, true); });
test("builds a traceable profile and blocks missing compatibility", () => { const profile = buildTechnicalRequirementProfile({ boqItem: item, requirements: [req({ compatibility: [] })], links: [{ requirementId: "r1", status: "Confirmed", evidence: ["Reviewed clause 2.3"] }] }); assert.equal(profile.applicableRequirements.length, 1); assert.equal(profile.suggestedRequirements.length, 0); assert.equal(profile.readiness.status, "Missing Critical Information"); assert.ok(profile.clarifications.some((entry) => /compatibility target/i.test(entry.question))); assert.match(profile.explanation, /matching readiness/i); });
test("marks derived accessories as derived and review-only", () => { const profile = buildTechnicalRequirementProfile({ boqItem: item, requirements: [req()], links: [{ requirementId: "r1", status: "Confirmed" }] }); const base = profile.derivedRequirements.find((entry) => /base/i.test(entry.statement)); assert.equal(base.factType, "Derived Fact"); assert.equal(base.reviewStatus, "Needs Review"); });
// Sprint 1.14 -- real Opera gap: item 30 (Sounder/Strobe) stayed Needs Review
// solely because compatibilityTarget was blocking for every Fire Alarm
// family uniformly, with no approved evidence in the whole project proving
// any notification appliance sits on the addressable loop. A Sounder/Strobe
// with everything else present must now reach Ready -- compatibilityTarget's
// absence is still reported (informational), never silently dropped, but it
// no longer blocks a family the system pack says has no proven panel lock-in.
test("Sprint 1.14 -- a Notification Devices item (Sounder/Strobe) reaches Ready without compatibilityTarget evidence; a Detection Devices item still requires it", () => {
  const sounderStrobe = { id: "boq-30", itemNumber: "30", description: "Sounder with Strobe Wall Mounted", system: "Fire Alarm", category: "Notification Devices", unit: "Each", quantity: 7, productFamily: "Sounder/Strobe", classificationConfidence: 95 };
  const sounderReq = req({ id: "r-sounder", originalText: "Sounders shall produce an audible signal.", normalizedRequirement: "sounders shall produce an audible signal", category: "Notification Devices", compatibility: [] });
  const profile = buildTechnicalRequirementProfile({ boqItem: sounderStrobe, requirements: [sounderReq], links: [{ requirementId: "r-sounder", status: "Confirmed", evidence: ["Reviewed"] }] });
  assert.notEqual(profile.readiness.status, "Missing Critical Information", "compatibilityTarget must not block a family with no proven panel lock-in");
  assert.ok(["Ready for Matching", "Ready with Warnings"].includes(profile.readiness.status), `expected Ready, got ${profile.readiness.status}`);
  assert.ok(profile.missingInformation.some((entry) => entry.field === "compatibilityTarget" && entry.blocking === false), "absence is still reported, just not blocking");

  // Same shape, Detection Devices family: compatibilityTarget still blocks.
  const smokeDetector = { ...item };
  const detectorProfile = buildTechnicalRequirementProfile({ boqItem: smokeDetector, requirements: [req({ compatibility: [] })], links: [{ requirementId: "r1", status: "Confirmed", evidence: ["Reviewed clause 2.3"] }] });
  assert.equal(detectorProfile.readiness.status, "Missing Critical Information");
  assert.ok(detectorProfile.missingInformation.some((entry) => entry.field === "compatibilityTarget" && entry.blocking === true));
});
// Fire Alarm E2E fix (family-aware derived detector-base requirement) --
// real Central Kitchen - Makkah gap: generateDerivedRequirements used to
// derive a mandatory "compatible detector base" for ANY BOQ item whose
// description merely contained the word "detector", wrongly penalizing Beam
// Detector (a bracket-mounted, line-of-sight optical device with no plug-in
// base). It now derives only from each family's real, evidenced product
// architecture (see fire-alarm-taxonomy.mjs's fireAlarmRequiresDetectorBase),
// never from description text alone.
const derivedBaseFor = (family, description = `${family} test item`) => generateDerivedRequirements({ boqItem: { id: "boq-x", system: "Fire Alarm", category: "Detection Devices", productFamily: family, description }, consolidated: [] }).find((entry) => entry.ruleId === "accessory.detector-base");
test("family-aware detector-base requirement -- Addressable Smoke Detector still derives a base requirement (proven plug-in base architecture)", () => {
  const base = derivedBaseFor("Addressable Smoke Detector");
  assert.ok(base, "Addressable Smoke Detector must still get the derived base requirement");
  assert.equal(base.factType, "Derived Fact");
});
test("family-aware detector-base requirement -- Addressable Heat Detector still derives a base requirement", () => {
  assert.ok(derivedBaseFor("Addressable Heat Detector"), "Addressable Heat Detector must still get the derived base requirement");
});
test("family-aware detector-base requirement -- Conventional Detector derives from its own proven base-mount evidence, not from the word \"detector\"", () => {
  assert.ok(derivedBaseFor("Conventional Detector"), "Conventional Detector's own real catalog evidence (2151/5151-series -> B401 bases) supports a base requirement");
});
test("family-aware detector-base requirement -- Beam Detector never derives a base requirement, even though its description contains the word \"detector\"", () => {
  const base = derivedBaseFor("Beam Detector", "Beam detector");
  assert.equal(base, undefined, "Beam Detector has no plug-in base architecture in any real catalog evidence and must never be assumed to need one");
});
test("family-aware detector-base requirement -- an unregistered/unrecognized family never derives a base requirement merely because its description contains the word \"detector\"", () => {
  const base = generateDerivedRequirements({ boqItem: { id: "boq-x", system: "Fire Alarm", category: "Detection Devices", productFamily: "Not A Real Family", description: "Some new kind of detector" }, consolidated: [] }).find((entry) => entry.ruleId === "accessory.detector-base");
  assert.equal(base, undefined, "an unproven family must never get this requirement from description text alone -- Duct Detector's own real evidence (not the word 'detector') is what makes it eligible, not text matching");
});
test("family-aware detector-base requirement -- explicit project evidence can still require a base for a family with no governed base-mount architecture", () => {
  const projectOverride = [{ normalizedRequirement: "beam detectors shall be provided with a compatible mounting base per manufacturer instructions", accessories: [] }];
  const base = generateDerivedRequirements({ boqItem: { id: "boq-x", system: "Fire Alarm", category: "Detection Devices", productFamily: "Beam Detector", description: "Beam detector" }, consolidated: projectOverride }).find((entry) => entry.ruleId === "accessory.detector-base");
  assert.ok(base, "explicit, confirmed project evidence may still require a base even for a family with no proven default architecture");
});
test("family-aware detector-base requirement -- already-confirmed accessory evidence suppresses the derived duplicate regardless of family", () => {
  const consolidated = [{ normalizedRequirement: "smoke detectors shall comply with en 54 7", accessories: [{ accessory: "Compatible detector base" }] }];
  const base = generateDerivedRequirements({ boqItem: { id: "boq-x", system: "Fire Alarm", category: "Detection Devices", productFamily: "Addressable Smoke Detector", description: "Addressable smoke detector" }, consolidated }).find((entry) => entry.ruleId === "accessory.detector-base");
  assert.equal(base, undefined, "a real confirmed accessory already covers the need; the derived duplicate must not also appear");
});
test("family-aware detector-base requirement -- Duct Detector's own real catalog architecture (not the word \"detector\") is what makes it eligible", () => {
  assert.ok(derivedBaseFor("Duct Detector", "Duct smoke detector"), "Duct Detector's own real catalog evidence (IDP-PHOTO-R-IV/-W -> B300-6-IV/B501-IV) proves plug-in base architecture inside the duct housing");
});
test("flags a cross-requirement attribute conflict when two DIFFERENT specification sources assert different values for the same attribute, but not when they agree", () => {
  const conflicting = consolidateRequirements([req({ id: "r1", originalText: "Stations shall use single action.", normalizedRequirement: "stations shall use single action", attributes: [{ name: "action_type", normalizedValue: "Single Action" }] }), req({ id: "r2", originalText: "Elsewhere, stations shall use dual action.", normalizedRequirement: "elsewhere stations shall use dual action", attributes: [{ name: "action_type", normalizedValue: "Dual Action" }] })]);
  const conflicts = detectAttributeValueConflicts(conflicting);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].attribute, "action_type");
  assert.equal(conflicts[0].blocking, true);

  const agreeing = consolidateRequirements([req({ id: "r1", originalText: "Stations shall use single action.", normalizedRequirement: "stations shall use single action", attributes: [{ name: "action_type", normalizedValue: "Single Action" }] }), req({ id: "r2", originalText: "Elsewhere, stations shall also use single action.", normalizedRequirement: "elsewhere stations shall also use single action", attributes: [{ name: "action_type", normalizedValue: "Single Action" }] })]);
  assert.equal(detectAttributeValueConflicts(agreeing).length, 0, "the same value from two sources is corroboration, not a conflict");
});
test("does not duplicate a same-requirement conflict already reported by detectRequirementConflicts", () => {
  const groups = consolidateRequirements([req({ attributes: [{ name: "Voltage", normalizedValue: 24, normalizedUnit: "V" }] }), req({ id: "r2", attributes: [{ name: "Voltage", normalizedValue: 12, normalizedUnit: "V" }] })]);
  assert.equal(detectAttributeValueConflicts(groups).length, 0);
});
test("wires versioned persistence, APIs, audit, decisions and review UI", async () => { const [schema, worker, index, page] = await Promise.all([readFile(new URL("../db/schema.ts", import.meta.url), "utf8"), readFile(new URL("../worker/technical-requirement-api.mjs", import.meta.url), "utf8"), readFile(new URL("../worker/index.ts", import.meta.url), "utf8"), readFile(new URL("../app/page.tsx", import.meta.url), "utf8")]); for (const entity of ["requirementProfileVersions", "profileRequirementApplicability", "consolidatedProfileRequirements", "profileIssues", "requirementRules", "requirementRuleExecutions", "requirementProfileDecisions", "requirementProfileComparisons"]) assert.match(schema, new RegExp(`export const ${entity}`)); for (const contract of ["approve-readiness", "profile-applicability", "profile-issues", "Requirement Profile Generated", "input_fingerprint", "compare"]) assert.match(worker, new RegExp(contract)); assert.match(index, /handleTechnicalRequirementApi/); assert.match(page, /Generate profile/); });
