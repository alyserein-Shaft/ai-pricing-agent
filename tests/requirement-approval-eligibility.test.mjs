import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateRequirementApprovalEligibility } from "../app/domain/requirement-approval-eligibility.mjs";

const base = (overrides = {}) => ({
  id: "requirement_1",
  review_status: "Needs Review",
  requirement_type: "Mandatory",
  original_text: "The fire detection and alarm system shall be addressable and utilize microprocessor technology.",
  extraction_version_id: "specextract_active",
  condition: "",
  exception: "",
  system: "Fire Alarm",
  category: "Functional",
  ...overrides,
});
const ctx = { activeExtractionId: "specextract_active", ambiguityRequirementIds: [], conflictRequirementIds: [] };

describe("requirement-approval-eligibility", () => {
  it("confirms an explicit normative mandatory requirement", () => {
    const result = evaluateRequirementApprovalEligibility(base(), ctx);
    assert.equal(result.eligible, true);
    assert.deepEqual(result.reasons, []);
  });

  it("rejects non-pending review states", () => {
    for (const review_status of ["Approved", "Rejected"]) {
      const result = evaluateRequirementApprovalEligibility(base({ review_status }), ctx);
      assert.equal(result.eligible, false);
      assert.ok(result.reasons.includes("review-not-pending"));
    }
  });

  it("accepts Pending Approval as still pending", () => {
    const result = evaluateRequirementApprovalEligibility(base({ review_status: "Pending Approval" }), ctx);
    assert.equal(result.eligible, true);
  });

  it("rejects non-mandatory types", () => {
    for (const requirement_type of ["Informational", "Preferred", "Optional", "Conditional", "Prohibited"]) {
      const result = evaluateRequirementApprovalEligibility(base({ requirement_type }), ctx);
      assert.equal(result.eligible, false);
      assert.ok(result.reasons.includes("not-mandatory-type"));
    }
  });

  it("requires an exact normative modal", () => {
    const result = evaluateRequirementApprovalEligibility(
      base({ original_text: "Heat detectors are generally provided in kitchens." }), ctx);
    assert.equal(result.eligible, false);
    assert.ok(result.reasons.includes("no-normative-modal"));
  });

  it("rejects weak phrasing even with a modal", () => {
    const result = evaluateRequirementApprovalEligibility(
      base({ original_text: "The detector shall be suitable as required by the engineer." }), ctx);
    assert.equal(result.eligible, false);
    assert.ok(result.reasons.includes("weak-phrasing"));
  });

  it("rejects stale extractions", () => {
    const result = evaluateRequirementApprovalEligibility(base({ extraction_version_id: "specextract_old" }), ctx);
    assert.equal(result.eligible, false);
    assert.ok(result.reasons.includes("stale-extraction"));
  });

  it("rejects unresolved conditions and exceptions", () => {
    assert.ok(evaluateRequirementApprovalEligibility(base({ condition: "subject to approval" }), ctx).reasons.includes("has-unresolved-condition"));
    assert.ok(evaluateRequirementApprovalEligibility(base({ exception: "except kitchens" }), ctx).reasons.includes("has-exception"));
  });

  it("rejects open ambiguity or conflict flags", () => {
    assert.ok(evaluateRequirementApprovalEligibility(base(), { ...ctx, ambiguityRequirementIds: ["requirement_1"] }).reasons.includes("open-ambiguity"));
    assert.ok(evaluateRequirementApprovalEligibility(base(), { ...ctx, conflictRequirementIds: ["requirement_1"] }).reasons.includes("open-conflict"));
  });

  it("rejects unknown system attribution", () => {
    for (const system of ["", "Unknown", "unknown"]) {
      assert.ok(evaluateRequirementApprovalEligibility(base({ system }), ctx).reasons.includes("system-unknown"));
    }
  });

  it("rejects non-technical categories and commercial boilerplate", () => {
    assert.ok(evaluateRequirementApprovalEligibility(base({ category: "Documentation" }), ctx).reasons.includes("non-technical-category"));
    assert.ok(evaluateRequirementApprovalEligibility(
      base({ original_text: "The contractor shall have at least 10 years of experience." }), ctx).reasons.includes("commercial-qualification-boilerplate"));
  });

  it("rejects delegated design choices", () => {
    const result = evaluateRequirementApprovalEligibility(
      base({ original_text: "The panel shall provide alarm verification subject to facility management requirements." }), ctx);
    assert.equal(result.eligible, false);
    assert.ok(result.reasons.includes("delegated-design-choice"));
  });

  it("never consults confidence scores", () => {
    const low = evaluateRequirementApprovalEligibility(base({ confidence: 12 }), ctx);
    const high = evaluateRequirementApprovalEligibility(base({ confidence: 99 }), ctx);
    assert.equal(low.eligible, true);
    assert.equal(high.eligible, true);
  });

  it("accumulates every failed gate", () => {
    const result = evaluateRequirementApprovalEligibility(
      base({ requirement_type: "Optional", original_text: "Provide suitable extras as required." }), ctx);
    assert.equal(result.eligible, false);
    assert.ok(result.reasons.includes("not-mandatory-type"));
    assert.ok(result.reasons.includes("weak-phrasing"));
  });
});
