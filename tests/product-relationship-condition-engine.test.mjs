import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRelationshipCondition, resolveRelationshipApplicability } from "../app/domain/product-relationship-condition-engine.mjs";

// Sprint 1.0 -- Conditional Relationship Evaluation. Proves the pure
// SATISFIED/NOT_SATISFIED/UNKNOWN/CONFLICT contract using the real Opera
// IDP-PHOTO-IV -> B200S-IV (Sounding Base) condition shape.
const soundingBaseCondition = [{ attribute: "notification_feature", operator: "equals", value: "Sounder Required" }];
const fact = (attribute, value, source = "Approved BOQ Understanding") => ({ attribute, value, source });

test("1. a plain smoke detector (no notification_feature fact at all) evaluates UNKNOWN, not SATISFIED", () => {
  const result = evaluateRelationshipCondition(soundingBaseCondition, []);
  assert.equal(result.status, "UNKNOWN");
});

test("2. an explicit approved sounder requirement satisfies the condition", () => {
  const result = evaluateRelationshipCondition(soundingBaseCondition, [fact("notification_feature", "Sounder Required")]);
  assert.equal(result.status, "SATISFIED");
});

test("3. missing sounder evidence (facts present for other attributes, but not this one) is UNKNOWN", () => {
  const result = evaluateRelationshipCondition(soundingBaseCondition, [fact("addressing", "Addressable")]);
  assert.equal(result.status, "UNKNOWN");
});

test("4. contradictory approved evidence (two different values from two sources) is CONFLICT", () => {
  const result = evaluateRelationshipCondition(soundingBaseCondition, [fact("notification_feature", "Sounder Required", "Approved BOQ Understanding"), fact("notification_feature", "No Sounder", "Specification page 12, clause B")]);
  assert.equal(result.status, "CONFLICT");
  assert.equal(result.conditions[0].sources.length, 2);
});

test("6. a fact absent from the approved-facts list (e.g. rejected/unapproved) does not satisfy the condition", () => {
  // The caller is responsible for only ever passing approved facts; simulating
  // an unapproved fact by simply not including it proves the evaluator has no
  // fallback that invents a value.
  const result = evaluateRelationshipCondition(soundingBaseCondition, []);
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.conditions[0].status, "UNKNOWN");
});

test("9. an unconditional relationship (no conditions) is always SATISFIED regardless of facts", () => {
  assert.equal(evaluateRelationshipCondition([], []).status, "SATISFIED");
  assert.equal(evaluateRelationshipCondition([], [fact("notification_feature", "Sounder Required")]).status, "SATISFIED");
  assert.equal(evaluateRelationshipCondition(undefined, []).status, "SATISFIED");
});

test("10. a capacity-dependent condition shape (no attribute/operator/value) evaluates UNKNOWN, never crashes, never auto-applies", () => {
  const capacityCondition = [{ type: "capacity_dependent", note: "quantity depends on project SLC loop count" }];
  const result = evaluateRelationshipCondition(capacityCondition, [fact("notification_feature", "Sounder Required")]);
  assert.equal(result.status, "UNKNOWN");
});

test("resolveRelationshipApplicability: both the relationship AND the condition must be governed before auto-apply", () => {
  const satisfied = { status: "SATISFIED", reason: "ok" };
  assert.equal(resolveRelationshipApplicability({ reviewStatus: "Approved", conditionResult: satisfied }).applicable, true);
  assert.equal(resolveRelationshipApplicability({ reviewStatus: "Needs Review", conditionResult: satisfied }).applicable, false, "an unapproved relationship must never auto-apply even if its condition is satisfied");
  assert.equal(resolveRelationshipApplicability({ reviewStatus: "Approved", conditionResult: { status: "NOT_SATISFIED" } }).applicable, false);
  assert.equal(resolveRelationshipApplicability({ reviewStatus: "Approved", conditionResult: { status: "UNKNOWN" } }).status, "Needs Validation");
  assert.equal(resolveRelationshipApplicability({ reviewStatus: "Approved", conditionResult: { status: "CONFLICT" } }).status, "Requirement Conflict");
});

test("operator 'contains' matches a substring, 'equals' requires an exact normalized match", () => {
  assert.equal(evaluateRelationshipCondition([{ attribute: "x", operator: "equals", value: "Sounder Required" }], [fact("x", "Sounder Required Urgently")]).status, "NOT_SATISFIED");
  assert.equal(evaluateRelationshipCondition([{ attribute: "x", operator: "contains", value: "sounder" }], [fact("x", "Sounder Required Urgently")]).status, "SATISFIED");
});

test("an unsupported operator throws rather than silently passing or failing", () => {
  assert.throws(() => evaluateRelationshipCondition([{ attribute: "x", operator: "greater_than", value: 5 }], [fact("x", 10)]), /Unsupported condition operator/);
});
