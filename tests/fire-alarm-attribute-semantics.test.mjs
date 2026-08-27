import test from "node:test";
import assert from "node:assert/strict";
import { validateFireAlarmAttributeValue } from "../app/domain/fire-alarm-taxonomy.mjs";
import { validateAttributeValue } from "../app/domain/system-knowledge-registry.mjs";
import { prepareBoqUnderstandingInput, validateAndMergeBoqInterpretation } from "../app/domain/boq-understanding-engine.mjs";

// Sprint 0.6 -- the real bug: a real BOQ item "Manual Call Point MCLP" produced
// addressing="MCLP" (EXTRACTED, confidence 100) because "MCLP" genuinely is a
// substring of the description, so the existing text-containment
// anti-hallucination check correctly left it EXTRACTED. It was never a valid
// addressing concept -- MCLP is a fragment of the product's own name. This
// suite proves the missing semantic layer that catches exactly that.

const f = (value, origin = "INFERRED", confidence = 90) => ({ value, origin, confidence });
const a = (name, value, origin = "INFERRED", confidence = 90) => ({ name, value, origin, confidence });
const row = (description, extra = {}) => ({ boqItemId: extra.boqItemId || "boq_1", description, numericQuantity: 1, normalizedUnit: "EA", ...extra });

test("a product-name acronym cannot masquerade as an addressing value (the real MCLP bug)", () => {
  assert.deepEqual(validateFireAlarmAttributeValue("addressing", "MCLP"), { valid: false, normalizedValue: null });
  assert.deepEqual(validateAttributeValue("Fire Alarm", "addressing", "MCLP"), { valid: false, normalizedValue: null });
});

test("explicit Addressable is a valid addressing value", () => {
  assert.deepEqual(validateFireAlarmAttributeValue("addressing", "Addressable"), { valid: true, normalizedValue: "Addressable" });
  assert.deepEqual(validateFireAlarmAttributeValue("addressing", "addressable"), { valid: true, normalizedValue: "Addressable" });
});

test("explicit Conventional is a valid addressing value", () => {
  assert.deepEqual(validateFireAlarmAttributeValue("addressing", "Conventional"), { valid: true, normalizedValue: "Conventional" });
});

test("Dual/Single Action validates only for action_type, not addressing or any other attribute", () => {
  assert.deepEqual(validateFireAlarmAttributeValue("action_type", "Dual Action"), { valid: true, normalizedValue: "Dual Action" });
  assert.deepEqual(validateFireAlarmAttributeValue("action_type", "Single Action"), { valid: true, normalizedValue: "Single Action" });
  assert.deepEqual(validateFireAlarmAttributeValue("addressing", "Dual Action"), { valid: false, normalizedValue: null });
});

test("invalid AI-proposed attribute values are downgraded to MISSING, never promoted as authoritative facts, in the real merge pipeline", () => {
  const input = prepareBoqUnderstandingInput(row("Manual Call Point MCLP"));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("Manual Call Point MCLP", "EXTRACTED", 100),
    taxonomyCandidateKey: f("FA-1", "INFERRED", 100),
    equipmentType: f("Manual Call Point", "EXTRACTED", 100),
    technicalAttributes: [a("addressing", "MCLP", "EXTRACTED", 100), a("product_type", "Manual Call Point", "EXTRACTED", 100)],
    confidence: "HIGH",
  });
  // Reproduces the exact real interpretation shape for item 34 (see Sprint 0.6
  // trace): productFamily resolves to a real governed candidate only if one
  // exists for "Manual Call Point" evidence -- assert on the addressing result
  // regardless of which candidate resolution path was taken.
  assert.deepEqual(result.interpretation.attributes.addressing, { value: null, origin: "MISSING", confidence: 0 });
  assert.ok(result.interpretation.reviewReasons.some((reason) => reason.startsWith("ATTRIBUTE_VALUE_REJECTED:addressing")), "the rejection must be recorded for audit, not silently dropped");
});

test("a valid Addressable value in real BOQ text flows through as an authoritative EXTRACTED fact", () => {
  const input = prepareBoqUnderstandingInput(row("Intelligent Addressable Pull Station, Dual Action, Key Reset"));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("Intelligent Addressable Pull Station, Dual Action, Key Reset", "EXTRACTED", 100),
    taxonomyCandidateKey: f("FA-1", "INFERRED", 100),
    equipmentType: f("Pull Station", "EXTRACTED", 100),
    technicalAttributes: [a("addressing", "Addressable", "EXTRACTED", 100)],
    confidence: "HIGH",
  });
  assert.equal(result.interpretation.productFamily.value, "Pull Station");
  assert.equal(result.interpretation.attributes.addressing.value, "Addressable");
  assert.equal(result.interpretation.attributes.addressing.origin, "EXTRACTED");
});

test("non-Fire-Alarm systems do not inherit Fire Alarm semantic validation rules", () => {
  assert.deepEqual(validateAttributeValue("CCTV", "addressing", "MCLP"), { valid: true, normalizedValue: "MCLP" }, "CCTV is not a registered system -- no semantic rule applies, value passes through unchanged");
  assert.deepEqual(validateAttributeValue(null, "addressing", "MCLP"), { valid: true, normalizedValue: "MCLP" });
  // End-to-end: a genuinely ungoverned system's attributes must never be run
  // through Fire Alarm's validators even when the raw text happens to look
  // like a Fire Alarm value.
  const input = prepareBoqUnderstandingInput(row("Access control card reader"));
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: f("Access control card reader", "EXTRACTED", 100),
    system: f("Access Control", "EXTRACTED", 100), category: f("Readers", "EXTRACTED", 90),
    equipmentType: f("Card Reader", "EXTRACTED", 100), productFamily: f("Card Reader", "EXTRACTED", 90),
    technicalAttributes: [a("addressing", "MCLP", "EXTRACTED", 100)],
    confidence: "HIGH",
  });
  assert.equal(result.interpretation.system.value, "Access Control");
  assert.equal(result.interpretation.attributes.addressing.value, "MCLP", "Access Control is unregistered -- Fire Alarm's addressing enum must never apply to it");
});

test("an attribute name with no defined semantics (e.g. product_type) is never rejected -- no invented rule", () => {
  assert.deepEqual(validateFireAlarmAttributeValue("product_type", "Anything At All"), { valid: true, normalizedValue: "Anything At All" });
});
