// Deterministic system-confirmation eligibility for technical requirements.
//
// Stage 4B policy. Pure function: decides whether a technical_requirements
// row may be approved through the existing governed requirement-approval path
// without human review. It NEVER writes, links, or confirms anything itself.
//
// A requirement is ELIGIBLE only when ALL gates pass:
// - review is still pending (Needs Review / Pending Approval)
// - requirement_type is Mandatory (normative force)
// - exact normative modal present (shall / must / is|are required)
// - no weak phrasing (suitable / as required / where necessary / ...)
// - exact source text present on the ACTIVE extraction version
// - no unresolved condition or exception narrowing the obligation
// - not flagged by any open ambiguity or conflict record
// - system attribution present (applicability anchored, never Unknown)
// - not commercial/qualification boilerplate (experience, ISO entity cert,
//   supplier agency, priced proposals, maintenance contracts)
// - not a delegated design choice (subject to / as directed / ...)
// Confidence scores are deliberately NOT consulted: eligibility is evidence
// presence, never a numeric threshold.

export const REQUIREMENT_APPROVAL_POLICY_VERSION = "requirement-approval-eligibility-v1";

const text = (value) => String(value ?? "");

const NORMATIVE_MODAL = /\b(shall|must|is required|are required)\b/i;
const WEAK_PHRASING = /suitable|as required|where necessary|where applicable|as necessary/i;
const DESIGN_CHOICE = /subject to|as directed|at the (sole )?discretion|if deemed|as may be required/i;
const COMMERCIAL_QUALIFICATION =
  /years? of experience|iso\s?9001|ministry of commerce|agency agreement|priced proposal|maintenance.{0,20}(contract|testing)|inspection.{0,20}testing/i;
const EXCLUDED_TECHNICAL_CATEGORIES = new Set(["Documentation", "Maintenance", "Training"]);

const PENDING_REVIEW = new Set(["Needs Review", "Pending Approval"]);

export const evaluateRequirementApprovalEligibility = (requirement = {}, context = {}) => {
  const reasons = [];
  const original = text(requirement.original_text);
  const activeExtractionId = text(context.activeExtractionId);
  const ambiguityIds = context.ambiguityRequirementIds || [];
  const conflictIds = context.conflictRequirementIds || [];

  if (!PENDING_REVIEW.has(requirement.review_status)) {
    reasons.push("review-not-pending");
  }
  if (requirement.requirement_type !== "Mandatory") {
    reasons.push("not-mandatory-type");
  }
  if (!NORMATIVE_MODAL.test(original)) {
    reasons.push("no-normative-modal");
  }
  if (WEAK_PHRASING.test(original)) {
    reasons.push("weak-phrasing");
  }
  if (original.trim().length === 0) {
    reasons.push("missing-source-text");
  }
  if (activeExtractionId && text(requirement.extraction_version_id) !== activeExtractionId) {
    reasons.push("stale-extraction");
  }
  if (text(requirement.condition).trim().length > 0) {
    reasons.push("has-unresolved-condition");
  }
  if (text(requirement.exception).trim().length > 0) {
    reasons.push("has-exception");
  }
  if (ambiguityIds.includes(requirement.id)) {
    reasons.push("open-ambiguity");
  }
  if (conflictIds.includes(requirement.id)) {
    reasons.push("open-conflict");
  }
  const system = text(requirement.system).trim();
  if (!system || /^unknown$/i.test(system)) {
    reasons.push("system-unknown");
  }
  if (EXCLUDED_TECHNICAL_CATEGORIES.has(requirement.category)) {
    reasons.push("non-technical-category");
  }
  if (COMMERCIAL_QUALIFICATION.test(original)) {
    reasons.push("commercial-qualification-boilerplate");
  }
  if (DESIGN_CHOICE.test(original)) {
    reasons.push("delegated-design-choice");
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    policyVersion: REQUIREMENT_APPROVAL_POLICY_VERSION,
  };
};
