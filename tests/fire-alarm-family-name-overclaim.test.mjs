import assert from "node:assert/strict";
import test from "node:test";

// Real Al Mousa advisory finding (read-only pilot). A returned productFamily can
// be perfectly IN-VOCABULARY and still assert engineering the source evidence
// never established: "Addressable Smoke Detector" was returned for the BOQ line
// "Smoke detectors (above ceiling)", which never states an addressing mode.
// These tests pin the generic detection of that class. They deliberately do NOT
// pin any pilot phrase, and the guard must not null a production-derived family.
import {
  assessFireAlarmFamilySupport,
  fireAlarmFamilyNameClaims,
} from "../app/domain/fire-alarm-taxonomy.mjs";
import { assessFamilyNameClaimSupport } from "../app/domain/system-knowledge-registry.mjs";
import { prepareBoqUnderstandingInput, validateAndMergeBoqInterpretation } from "../app/domain/boq-understanding-engine.mjs";

const fact = (value, origin = "INFERRED", confidence = 80) => ({ value, origin, confidence });

// Schema-valid compact response asserting `family` through the candidate key.
// `additionalProperties:false`, so only the canonical compact fields appear.
function modelSelectingFamily(selectionKey, { family = null, category = null } = {}) {
  return {
    normalizedDescription: fact("Smoke detectors"),
    system: fact("Fire Alarm"),
    category: fact(category),
    equipmentType: fact(family),
    productFamily: fact(family),
    taxonomyCandidateKey: fact(selectionKey),
    technicalAttributes: [],
    standards: [],
    manufacturerEvidence: [],
    compatibilityRequirements: [],
    requiredAccessories: [],
    searchTerms: [],
    missingInformation: [],
    ambiguities: [],
    confidence: "MEDIUM",
  };
}

// The governed context a model would have been shown for a row whose own text
// yields no phrase candidate.
const contextFor = (family, selectionKey = "FA-1") => ({
  version: "fire-alarm-taxonomy-1.0.0",
  system: "Fire Alarm",
  families: [{ selectionKey, category: "Detection Devices", family }],
  attributeNames: [],
});

test("claims are derived from the governed family name, never from a phrase list", () => {
  assert.deepEqual(fireAlarmFamilyNameClaims("Addressable Smoke Detector"), [
    { attribute: "addressing", value: "Addressable", token: "addressable" },
    { attribute: "detection_principle", value: "Smoke", token: "smoke" },
  ]);
  assert.deepEqual(fireAlarmFamilyNameClaims("Duct Detector").map((c) => c.attribute), ["detection_principle"]);
  // Families whose name asserts no governed attribute value have nothing to
  // overclaim -- absence of claims is NOT the same as being supported.
  assert.deepEqual(fireAlarmFamilyNameClaims("Manual Call Point"), []);
  assert.deepEqual(fireAlarmFamilyNameClaims("Fire Alarm Control Panel"), []);
});

test("a family name claim is UNSUPPORTED when the evidence does not establish it", () => {
  const unsupported = assessFireAlarmFamilySupport("Addressable Smoke Detector", "Smoke detectors (above ceiling)");
  assert.equal(unsupported.supported, false);
  // Only the addressing claim is missing; the hazard claim IS established.
  assert.deepEqual(unsupported.unsupported.map((c) => c.attribute), ["addressing"]);
});

test("support may legitimately come from established project evidence, not only the BOQ line", () => {
  const bare = assessFireAlarmFamilySupport("Addressable Smoke Detector", "Smoke detectors (below ceiling)");
  assert.equal(bare.supported, false);
  const withProject = assessFireAlarmFamilySupport("Addressable Smoke Detector", "Smoke detectors (below ceiling)", {
    additionalEvidence: ["the fire detection and alarm system shall be addressable"],
  });
  assert.equal(withProject.supported, true, "approved project evidence must be able to resolve the claim legitimately");
});

test("registry: an unregistered system is always supported (never invents a stricter rule)", () => {
  const result = assessFamilyNameClaimSupport("Not A System", "Addressable Smoke Detector", "anything");
  assert.equal(result.supported, true);
  assert.deepEqual(result.unsupported, []);
});

test("ENGINE: an overclaiming family becomes reviewable and NEVER completes silently", () => {
  const family = "Addressable Smoke Detector";
  const input = {
    ...prepareBoqUnderstandingInput({ id: "row-1", description: "Smoke detectors (above ceiling)", rowType: "BOQ Item" }),
    taxonomyContext: contextFor(family),
  };

  const { interpretation, status } = validateAndMergeBoqInterpretation(input, modelSelectingFamily("FA-1"));

  const overclaim = interpretation.reviewReasons.find((r) => r.startsWith("UNSUPPORTED_FAMILY_OVERCLAIM"));
  assert.ok(overclaim, "must be reported as an unsupported family overclaim");
  assert.match(overclaim, /addressing=Addressable/);
  assert.equal(status, "NEEDS_REVIEW", "an unestablished claim can never auto-complete");
  assert.ok(
    interpretation.ambiguities.some((entry) => /does not establish/.test(entry.value)),
    "the unestablished claim must be visible to a reviewer",
  );
  // CRITICAL: the family itself is retained -- production-derived, already
  // evidence-backed, and clearing it would be a silent downgrade.
  assert.equal(interpretation.productFamily.value, family);
});

test("MUTATION: evidence that DOES establish the claim removes the review reason", () => {
  const family = "Addressable Smoke Detector";
  // Same governed context and same model answer; only the row evidence differs.
  const unsupported = validateAndMergeBoqInterpretation(
    { ...prepareBoqUnderstandingInput({ id: "r", description: "smoke detectors", rowType: "BOQ Item" }), taxonomyContext: contextFor(family) },
    modelSelectingFamily("FA-1"),
  );
  assert.ok(unsupported.interpretation.reviewReasons.some((r) => r.startsWith("UNSUPPORTED_FAMILY_OVERCLAIM")));

  const supported = validateAndMergeBoqInterpretation(
    { ...prepareBoqUnderstandingInput({ id: "r", description: "addressable smoke detector", rowType: "BOQ Item" }), taxonomyContext: contextFor(family) },
    modelSelectingFamily("FA-1"),
  );
  assert.ok(
    !supported.interpretation.reviewReasons.some((r) => r.startsWith("UNSUPPORTED_FAMILY_OVERCLAIM")),
    "the assertion is load-bearing: established evidence must clear it",
  );
});

test("REGRESSION: a production phrase-derived family with a bare-noun description is NOT flagged", () => {
  // "Heat detector" is real live Al Mousa data, already Approved downstream. Its
  // registered phrase reaches Addressable Heat Detector without stating
  // "addressable"; the deterministic path must stay exactly as it was.
  const input = prepareBoqUnderstandingInput({ id: "h", description: "Heat detector", rowType: "BOQ Item" });
  assert.equal(input.taxonomyContext.families[0].family, "Addressable Heat Detector");

  // Model silent -> deterministic sole-candidate acceptance, unchanged.
  const silent = validateAndMergeBoqInterpretation(input, {
    ...modelSelectingFamily(null),
    taxonomyCandidateKey: fact(null, "MISSING", 0),
  });
  assert.equal(silent.interpretation.productFamily.value, "Addressable Heat Detector");
  assert.ok(silent.interpretation.reviewReasons.includes("GOVERNED_CANDIDATE_ACCEPTED_OVER_SILENT_MODEL_NULL"));
  assert.ok(!silent.interpretation.reviewReasons.some((r) => r.startsWith("UNSUPPORTED_FAMILY_OVERCLAIM")));
});

test("REGRESSION: a supported family in the free-text path is untouched", () => {
  const input = prepareBoqUnderstandingInput({ id: "d", description: "Duct detector", rowType: "BOQ Item" });
  const { interpretation } = validateAndMergeBoqInterpretation(input, {
    ...modelSelectingFamily(null),
    taxonomyCandidateKey: fact(null, "MISSING", 0),
  });
  assert.equal(interpretation.productFamily.value, "Duct Detector");
  assert.ok(!interpretation.reviewReasons.some((r) => r.startsWith("UNSUPPORTED_FAMILY_OVERCLAIM")));
});