import { isCanonicalFireAlarmPair } from "./fire-alarm-taxonomy.mjs";
import { governedAttributeProfile, mandatoryMatchingAttributes } from "./engineering-attribute-profiles.mjs";
import { stableStringify } from "./boq-understanding-engine.mjs";

export const UNDERSTANDING_REVIEW_ACTIONS = Object.freeze([
  "APPROVE_INTERPRETATION", "EDIT_AND_APPROVE", "REJECT_INTERPRETATION", "RETURN_TO_REVIEW",
]);
export const UNDERSTANDING_REVIEW_STATUSES = Object.freeze(["AWAITING_REVIEW", "APPROVED", "REJECTED"]);
export const ESSENTIAL_UNDERSTANDING_FIELDS = Object.freeze(["system", "category", "equipmentType", "productFamily"]);
const SAFE_ORIGINS = new Set(["EXTRACTED", "INFERRED", "MISSING", "NOT_APPLICABLE"]);
const SAFE_FACT_KEYS = new Set(["value", "origin", "confidence"]);
const SAFE_INTERPRETATION_KEYS = new Set([
  "normalizedDescription", "system", "category", "subcategory", "equipmentType", "productFamily", "attributes",
  "manufacturerPreferences", "manufacturerRestrictions", "standards", "compatibilityRequirements", "requiredAccessories",
  "searchTerms", "missingInformation", "ambiguities", "engineeringNotes", "confidence", "reviewReasons",
]);

const plain = (value) => value && typeof value === "object" && !Array.isArray(value);
const safeText = (value, max = 240) => typeof value === "string" ? value.trim().slice(0, max) : value;
const safeFact = (fact) => {
  if (!plain(fact) || Object.keys(fact).some((key) => !SAFE_FACT_KEYS.has(key))) return null;
  const origin = SAFE_ORIGINS.has(fact.origin) ? fact.origin : "MISSING";
  const value = fact.value == null ? null : safeText(fact.value);
  const confidence = Number.isInteger(fact.confidence) && fact.confidence >= 0 && fact.confidence <= 100 ? fact.confidence : 0;
  return { value, origin: value == null && origin !== "NOT_APPLICABLE" ? "MISSING" : origin, confidence: value == null ? 0 : confidence };
};

export function sanitizeReviewedInterpretation(input) {
  if (!plain(input) || Object.keys(input).some((key) => !SAFE_INTERPRETATION_KEYS.has(key))) return null;
  const output = {};
  for (const key of ["normalizedDescription", "system", "category", "subcategory", "equipmentType", "productFamily"]) {
    const fact = safeFact(input[key]);
    if (fact) output[key] = fact;
  }
  const attributes = plain(input.attributes) ? input.attributes : {};
  output.attributes = Object.fromEntries(Object.entries(attributes).slice(0, 40).flatMap(([name, fact]) => {
    const safe = safeFact(fact);
    return safe && /^[a-zA-Z0-9_ -]{1,80}$/.test(name) ? [[name, safe]] : [];
  }));
  for (const key of ["manufacturerPreferences", "manufacturerRestrictions", "standards", "compatibilityRequirements", "requiredAccessories", "searchTerms", "missingInformation", "ambiguities", "engineeringNotes", "reviewReasons"]) {
    output[key] = Array.isArray(input[key]) ? [...new Set(input[key].filter((value) => typeof value === "string").map((value) => value.slice(0, 180)))].slice(0, 20) : [];
  }
  output.confidence = ["LOW", "MEDIUM", "HIGH"].includes(input.confidence) ? input.confidence : "LOW";
  return output;
}

export function sanitizePersistedAiInterpretation(input) {
  if (!plain(input)) return null;
  const { boqItemId: _serverOwnedBoqItemId, ...contract } = input;
  return sanitizeReviewedInterpretation(contract);
}

const REVIEW_CLASSIFICATION_FIELDS = Object.freeze(["system", "category", "equipmentType", "productFamily", "subcategory"]);

export function buildUnderstandingReviewLayers(aiInput, canonicalInput, review = null) {
  const aiProposal = sanitizeReviewedInterpretation(aiInput);
  const canonicalInterpretation = review?.hasVersion ? sanitizeReviewedInterpretation(canonicalInput) : null;
  const changedFields = canonicalInterpretation && aiProposal
    ? REVIEW_CLASSIFICATION_FIELDS.filter((key) => JSON.stringify(canonicalInterpretation[key] || null) !== JSON.stringify(aiProposal[key] || null))
    : [];
  return {
    aiProposal,
    proposalClassification: aiProposal ? Object.fromEntries(REVIEW_CLASSIFICATION_FIELDS.map((key) => [key, aiProposal[key]?.value ?? null])) : null,
    canonicalReview: review?.hasVersion ? {
      status: review.status,
      version: review.version,
      interpretation: canonicalInterpretation,
      changedFields,
    } : null,
  };
}

export function validateUnderstandingForApproval(interpretation) {
  const value = sanitizeReviewedInterpretation(interpretation);
  if (!value) return { ok: false, code: "UNDERSTANDING_REVIEW_PAYLOAD_INVALID", missing: [] };
  const missing = ESSENTIAL_UNDERSTANDING_FIELDS.filter((key) => !value[key]?.value || ["MISSING", "NOT_APPLICABLE"].includes(value[key]?.origin));
  if (missing.length) return { ok: false, code: "ESSENTIAL_UNDERSTANDING_MISSING", missing };
  if (value.system.value === "Fire Alarm" && !isCanonicalFireAlarmPair(value.category.value, value.productFamily.value)) {
    return { ok: false, code: "FIRE_ALARM_TAXONOMY_INVALID", missing: [] };
  }
  return { ok: true, value, missing: [] };
}

const missingFact = (fact) => !fact || fact.value == null || fact.origin === "MISSING";
const fieldEntry = (field, state, reason) => ({ field, state, reason });

export function evaluateUnderstandingAuthority({ interpretation, reviewStatus = "AWAITING_REVIEW", taxonomyValid = false } = {}) {
  const value = sanitizeReviewedInterpretation(interpretation);
  const classificationBlockers = value ? ESSENTIAL_UNDERSTANDING_FIELDS
    .filter((field) => missingFact(value[field]) || value[field]?.origin === "NOT_APPLICABLE")
    .map((field) => fieldEntry(field, "MISSING_CURRENT_EVIDENCE", "Required to confirm the canonical item classification.")) : ESSENTIAL_UNDERSTANDING_FIELDS.map((field) => fieldEntry(field, "MISSING_CURRENT_EVIDENCE", "A valid understanding proposal is unavailable."));
  const system = value?.system?.value || null;
  const family = value?.productFamily?.value || null;
  const profile = governedAttributeProfile(system, family);
  const matchingNames = profile ? mandatoryMatchingAttributes(system, family) : [];
  const matchingBlockers = profile ? matchingNames.filter((name) => missingFact(value?.attributes?.[name]) || value?.attributes?.[name]?.origin === "NOT_APPLICABLE")
    .map((name) => fieldEntry(`attributes.${name}`, "REQUIRED_FOR_MATCHING", "Required by the governed family profile before technical match approval."))
    : [fieldEntry("governed_attribute_profile", "REQUIRED_FOR_MATCHING", "A governed family-specific matching profile is not available.")];
  const laterProjectEvidenceNeeded = matchingBlockers.filter((entry) => entry.field !== "governed_attribute_profile")
    .map((entry) => fieldEntry(entry.field, "AWAITING_PROJECT_EVIDENCE", "A specification, drawing, schedule, legend, vendor list, or later project document may supply this evidence."));
  const informationalMissing = value?.subcategory?.value == null ? [fieldEntry("subcategory", "MISSING_CURRENT_EVIDENCE", "Subcategory is informational and does not block understanding approval.")] : [];
  const understandingApprovalEligible = Boolean(value && taxonomyValid && classificationBlockers.length === 0);
  const understandingApproved = reviewStatus === "APPROVED";
  return {
    classificationBlockers,
    matchingBlockers,
    laterProjectEvidenceNeeded,
    informationalMissing,
    understandingApprovalEligible,
    discoveryReadiness: understandingApproved
      ? { state: "DISCOVERY_ONLY", eligible: true, permittedUse: "Discovery Only", label: "Eligible for product discovery — Discovery Only", missingConstraints: matchingBlockers.map((entry) => entry.field) }
      : { state: understandingApprovalEligible ? "ELIGIBLE_AFTER_UNDERSTANDING_APPROVAL" : "BLOCKED_CLASSIFICATION", eligible: false, permittedUse: "Discovery Only", label: understandingApprovalEligible ? "Eligible after understanding approval" : "Complete classification review before product discovery", missingConstraints: matchingBlockers.map((entry) => entry.field) },
    technicalMatchReadiness: matchingBlockers.length === 0
      ? { state: "READY_FOR_TECHNICAL_REVIEW", ready: true, label: "Required matching evidence is present" }
      : { state: "BLOCKED", ready: false, label: `Resolve ${matchingBlockers.length} required matching ${matchingBlockers.length === 1 ? "requirement" : "attributes"}`, reason: profile ? "Additional project documents may supply this evidence." : "A governed family-specific matching profile is required." },
    profile: profile ? { version: profile.version, system: profile.system, family: profile.family } : null,
  };
}

export function authorizeTechnicalMatchApproval(input = {}) {
  const authority = evaluateUnderstandingAuthority(input);
  return authority.technicalMatchReadiness.ready
    ? { allowed: true, readiness: authority.technicalMatchReadiness }
    : { allowed: false, code: "TECHNICAL_MATCH_EVIDENCE_INCOMPLETE", readiness: authority.technicalMatchReadiness, missing: authority.matchingBlockers.map((entry) => entry.field) };
}

const ACTION_DENIALS = Object.freeze({
  APPROVE_INTERPRETATION: "APPROVAL_NOT_ALLOWED",
  EDIT_AND_APPROVE: "EDIT_APPROVAL_NOT_ALLOWED",
  REJECT_INTERPRETATION: "REJECTION_NOT_ALLOWED",
  RETURN_TO_REVIEW: "RETURN_TO_REVIEW_NOT_ALLOWED",
});

/** One deterministic action policy used by API responses and mutation authorization. */
export function buildUnderstandingReviewActionPolicy({
  reviewStatus = "NOT_ANALYZED",
  proposalState = "UNAVAILABLE_OR_STALE",
  classificationBlockers = [],
  taxonomyValid = false,
  authorityValid = false,
  actorAuthorized = false,
} = {}) {
  const blockers = [...new Set((Array.isArray(classificationBlockers) ? classificationBlockers : []).map((entry) => typeof entry === "string" ? entry : entry.field))];
  const allowedActions = [];
  const denialReasons = { ...ACTION_DENIALS };
  let stateReason = null;

  if (!actorAuthorized) stateReason = "ROLE_FORBIDDEN";
  else if (proposalState !== "AVAILABLE") stateReason = proposalState === "FAILED" ? "AI_ATTEMPT_FAILED" : "INTERPRETATION_NOT_REVIEWABLE";
  else if (!authorityValid) stateReason = "CURRENT_AUTHORITY_INVALID";
  else if (reviewStatus === "AWAITING_REVIEW") {
    allowedActions.push("EDIT_AND_APPROVE", "REJECT_INTERPRETATION");
    if (taxonomyValid && blockers.length === 0) allowedActions.unshift("APPROVE_INTERPRETATION");
    else stateReason = !taxonomyValid ? "TAXONOMY_INVALID" : "BLOCKING_FIELDS_UNRESOLVED";
  } else if (["APPROVED", "REJECTED"].includes(reviewStatus)) {
    allowedActions.push("RETURN_TO_REVIEW");
    stateReason = "NEW_CANONICAL_REVIEW_REQUIRED";
  } else stateReason = "INTERPRETATION_NOT_REVIEWABLE";

  for (const action of allowedActions) delete denialReasons[action];
  if (stateReason) for (const action of Object.keys(denialReasons)) denialReasons[action] = stateReason;
  const approvalDenialMessage = stateReason === "BLOCKING_FIELDS_UNRESOLVED"
    ? `Resolve ${blockers.length} classification ${blockers.length === 1 ? "field" : "fields"} before approval.`
    : stateReason === "TAXONOMY_INVALID" ? "Resolve the governed classification before approval."
      : stateReason === "AI_ATTEMPT_FAILED" ? "The failed AI attempt cannot be reviewed as a proposal."
        : stateReason === "CURRENT_AUTHORITY_INVALID" ? "Selection changed — reload the current item."
          : null;
  return { allowedActions, denialReasons, approvalDenialMessage, stateReason };
}

export function summarizeUnderstandingReviewItems(items = []) {
  const count = (status) => items.filter((item) => item.review?.status === status).length;
  return {
    authoritativeCurrentBoqItems: items.length,
    aiAttempted: items.filter((item) => item.aiAttempted).length,
    aiAnalyzed: items.filter((item) => item.aiAttempted).length,
    awaitingReview: count("AWAITING_REVIEW"),
    approved: count("APPROVED"),
    rejected: count("REJECTED"),
    failed: count("FAILED"),
    notAnalyzed: count("NOT_ANALYZED"),
  };
}

export function validateUnderstandingReviewCommand(body) {
  if (!plain(body)) return { ok: false, code: "UNDERSTANDING_REVIEW_REQUEST_INVALID" };
  const allowed = new Set(["action", "expectedVersion", "requestId", "selectionAuthority", "reason", "canonicalInterpretation"]);
  if (Object.keys(body).some((key) => !allowed.has(key)) || !UNDERSTANDING_REVIEW_ACTIONS.includes(body.action) || !Number.isInteger(body.expectedVersion) || body.expectedVersion < 0 || typeof body.requestId !== "string" || !/^[a-zA-Z0-9:_-]{8,120}$/.test(body.requestId) || typeof body.selectionAuthority !== "string" || !/^[a-f0-9]{64}$/.test(body.selectionAuthority)) return { ok: false, code: "UNDERSTANDING_REVIEW_REQUEST_INVALID" };
  if (["EDIT_AND_APPROVE", "REJECT_INTERPRETATION", "RETURN_TO_REVIEW"].includes(body.action) && !(typeof body.reason === "string" && body.reason.trim().length >= 3)) return { ok: false, code: "UNDERSTANDING_REVIEW_REASON_REQUIRED" };
  if (body.action !== "EDIT_AND_APPROVE" && body.canonicalInterpretation != null) return { ok: false, code: "UNDERSTANDING_REVIEW_REQUEST_INVALID" };
  return { ok: true, value: { ...body, reason: body.reason?.trim().slice(0, 500) || null } };
}

export const understandingReviewRequestFingerprint = (command) => stableStringify({ action: command.action, expectedVersion: command.expectedVersion, selectionAuthority: command.selectionAuthority, reason: command.reason || null, canonicalInterpretation: command.canonicalInterpretation || null });

export function understandingDiscoveryState(reviewStatus, interpretationStatus) {
  if (reviewStatus === "APPROVED") return { eligible: true, label: "Understanding approved — ready for product discovery" };
  if (interpretationStatus === "FAILED") return { eligible: false, label: "AI understanding failed — engineer review required" };
  return { eligible: false, label: "AI understanding review required before product discovery" };
}
