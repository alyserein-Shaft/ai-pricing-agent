// GOVERNED CLASSIFICATION AUTHORITY
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// `boq_items.system_confidence` is deliberate raw machine evidence. The BOQ
// extractor assigns a FIXED 78 to every system it infers by pattern match
// (`app/domain/boq-extractor.mjs`, `detectSystem`), versus 95 when the section is
// explicitly mapped. That value must never be rewritten -- it is historically
// truthful extraction output.
//
// The Requirement Profile then consumes it as a single authority:
//
//     classificationConfidence: item.system_confidence || item.extraction_confidence
//
// and gates readiness on `confidence.itemClassification >= 80`. So a row whose
// system was pattern-inferred can never clear classification readiness, EVEN
// AFTER a qualified engineer has reviewed and confirmed system, category and
// productFamily through the governed BOQ Understanding review path.
//
// That is the gap this closes. It is an AUTHORITY SUPERSESSION, not a confidence
// boost: the machine number stays exactly as extracted, and a separate, explicit
// authority state is added beside it.
//
// WHAT THIS IS NOT
//
//   * NOT `if reviewed: confidence = 100`
//   * NOT `if approved: confidence += 2`
//   * NOT `Math.max(system_confidence, 80)`
//   * NOT a project-, brand- or candidate-specific exception
//   * NOT a change to the readiness threshold
//
// The R11 safety guarantee is preserved exactly: an inference-only classification
// at 78 with no current governed confirmation still cannot reach Ready. This
// layer adds a SECOND, independent way to satisfy the classification-authority
// requirement; it never relaxes the machine-confidence path.
//
// DIRECTION OF AUTHORITY
//
// Classification authority is derived ONLY from governed BOQ Understanding review
// state -- whole-blob APPROVED interpretation, or field-level CONFIRMED/EDITED
// decisions on the row's CURRENT interpretation. It is never derived from a
// product match, a selected SKU, a price, a brand strategy, or a historical
// quotation. The direction stays classification -> requirements -> matching.
//
// EXISTING ARCHITECTURE REUSED
//
// The classification fields, the two authority paths, and the currentness binding
// all already exist in `worker/estimator-understanding-review-api.mjs`:
// `FIELD_AUTHORITY_CLASSIFICATION_KEYS = [system, category, productFamily]`,
// `currentApprovedUnderstandingFacts` (whole-blob approval wins; field-level is the
// narrower additive path), and `currentUnderstandingAttempt` (the single
// currentness resolver). This module adds no new vocabulary for those fields and
// introduces no parallel authority reader -- the caller supplies facts that were
// read through those existing canonical accessors.

/**
 * The classification fields that may ever carry governed authority.
 *
 * Deliberately a CLOSED list, and deliberately the same list the understanding
 * review layer already uses (`FIELD_AUTHORITY_CLASSIFICATION_KEYS`). Duplicating
 * that constant here would create a second definition that could drift; this
 * module exports the canonical one and the review layer is expected to keep using
 * its own -- a test pins that they agree.
 */
export const CLASSIFICATION_AUTHORITY_FIELDS = Object.freeze(["system", "category", "productFamily"]);

/**
 * Authority states. Named as AUTHORITY states, never as confidence levels, so no
 * consumer can read a state as a score.
 *
 *  RAW_INFERRED      machine classification only (the pre-existing situation)
 *  GOVERNED_PARTIAL  some, not all, required fields carry current governed authority
 *  GOVERNED_CONFIRMED every required field carries current governed authority
 *  STALE             governed authority exists but no longer binds to current evidence
 */
export const CLASSIFICATION_AUTHORITY_STATES = Object.freeze([
  "RAW_INFERRED",
  "GOVERNED_PARTIAL",
  "GOVERNED_CONFIRMED",
  "STALE",
]);

const ABSENT_ORIGINS = Object.freeze(["MISSING", "NOT_APPLICABLE"]);

/**
 * Mirrors the review layer's own value reader
 * (`understandingClassificationValue`): a fact the engine marks MISSING or
 * NOT_APPLICABLE is absent, never a confirmable value.
 */
export const classificationFactValue = (fact) => {
  if (!fact || fact.value === null || fact.value === undefined) return null;
  if (ABSENT_ORIGINS.includes(fact.origin)) return null;
  const value = typeof fact.value === "string" ? fact.value.trim() : fact.value;
  return value === "" ? null : value;
};

/**
 * Resolve the classification-authority state for one BOQ item.
 *
 * @param {object} options
 * @param {string} options.system              governed system fact, or null
 * @param {string} options.category            governed category fact, or null
 * @param {string} options.productFamily       governed productFamily fact, or null
 * @param {string[]} options.requiredFields   fields policy requires for this row/family
 * @param {boolean} options.authorityCurrent   whether the governing review state binds
 *                                             to the CURRENT interpretation/evidence
 * @param {string|null} options.machineConfidence  the untouched raw machine value
 * @param {string|null} options.machineSourceType   e.g. "Inferred" | "Extracted"
 * @param {boolean} options.machineExplicitlyStated
 * @param {string|null} options.authoritySource      e.g. "Approved BOQ Understanding"
 * @param {string|null} options.authorityActor
 * @param {string[]} options.unresolvedFields   fields the reviewer explicitly left unresolved
 */
export const resolveClassificationAuthority = ({
  system = null,
  category = null,
  productFamily = null,
  requiredFields = CLASSIFICATION_AUTHORITY_FIELDS,
  authorityCurrent = false,
  machineConfidence = null,
  machineSourceType = null,
  machineExplicitlyStated = false,
  authoritySource = null,
  authorityActor = null,
  unresolvedFields = [],
} = {}) => {
  const required = [...new Set(requiredFields)].filter((field) => CLASSIFICATION_AUTHORITY_FIELDS.includes(field));
  const facts = { system, category, productFamily };
  const governedFields = required.filter((field) => classificationFactValue(facts[field]) !== null);
  const missingFields = required.filter((field) => classificationFactValue(facts[field]) === null);

  const base = {
    // Raw machine evidence is carried through UNCHANGED, always. It is never
    // recomputed, rescaled or blended here.
    machineConfidence: machineConfidence === null ? null : Number(machineConfidence),
    machineSourceType: machineSourceType || null,
    machineExplicitlyStated: Boolean(machineExplicitlyStated),
    authoritySource: authoritySource || null,
    authorityActor: authorityActor || null,
    requiredFields: required,
    governedFields,
    missingFields,
    unresolvedFields: [...unresolvedFields],
    authorityCurrent: Boolean(authorityCurrent),
  };

  // A prior human decision must not satisfy anything once it stops binding to
  // current evidence. STALE is checked BEFORE completeness so a complete-but-stale
  // set can never be read as confirmation.
  if (!base.authorityCurrent) {
    const hadGovernedEvidence = governedFields.length > 0;
    return Object.freeze({
      ...base,
      state: hadGovernedEvidence ? "STALE" : "RAW_INFERRED",
      // Only a CURRENT, COMPLETE governed set satisfies the authority requirement.
      authoritySatisfied: false,
      reason: hadGovernedEvidence
        ? "Governed classification decisions exist but no longer bind to the current interpretation/evidence, so they cannot authorise downstream readiness."
        : "Classification authority is machine-inferred only. No current governed review of the classification fields exists.",
    });
  }

  if (missingFields.length === 0) {
    return Object.freeze({
      ...base,
      state: "GOVERNED_CONFIRMED",
      authoritySatisfied: true,
      reason: `Every classification field policy requires (${required.join(", ")}) carries current governed confirmation. The machine confidence is preserved unchanged and is superseded for classification-readiness purposes by this governed authority.`,
    });
  }

  return Object.freeze({
    ...base,
    state: "GOVERNED_PARTIAL",
    authoritySatisfied: false,
    reason: `Current governed confirmation covers ${governedFields.length} of ${required.length} required classification fields. Still unconfirmed: ${missingFields.join(", ")}.`,
  });
};

/**
 * The ONE place the classification dimension is decided.
 *
 * A satisfied governed authority meets the classification dimension
 * independently of the raw machine number. Everything else -- the machine path
 * itself, and every other confidence dimension -- is untouched.
 *
 * `overall` is then recomputed by the caller from the same `Math.min` over the
 * same dimension list, so no dimension is ever weakened: a governed authority can
 * only remove `itemClassification` from the minimum, never lower another one.
 */
export const resolveClassificationReadinessDimension = ({
  authority,
  machineConfidence,
  threshold = 80,
} = {}) => {
  if (authority?.authoritySatisfied === true) {
    return Object.freeze({
      dimension: "itemClassification",
      satisfied: true,
      satisfiedBy: "GOVERNED_CLASSIFICATION_AUTHORITY",
      machineConfidence: machineConfidence === null || machineConfidence === undefined ? null : Number(machineConfidence),
      machineConfidenceBelowThreshold: Number(machineConfidence ?? 0) < threshold,
      threshold,
      reason: "Classification authority is satisfied by current governed review of every required classification field. The raw machine confidence is preserved for observability and is not the binding authority for this dimension.",
    });
  }
  const value = machineConfidence === null || machineConfidence === undefined ? 0 : Number(machineConfidence);
  return Object.freeze({
    dimension: "itemClassification",
    satisfied: value >= threshold,
    satisfiedBy: "MACHINE_EXTRACTION_CONFIDENCE",
    machineConfidence: value,
    machineConfidenceBelowThreshold: value < threshold,
    threshold,
    reason: authority?.state === "STALE"
      ? "Governed classification authority is stale, so classification falls back to the raw machine confidence."
      : "Classification authority is not currently governed, so the raw machine confidence remains binding for this dimension.",
  });
};

/**
 * Diagnostic only. Consumers that expect a numeric confidence keep reading
 * `confidence.itemClassification`; this exists so a profile can be explained
 * without overloading one number with two meanings.
 */
export const classificationAuthorityProfile = (authority, dimension) => ({
  classificationMachineConfidence: authority?.machineConfidence ?? null,
  classificationMachineSource: authority?.machineSourceType ?? null,
  classificationMachineExplicitlyStated: Boolean(authority?.machineExplicitlyStated),
  classificationAuthority: authority?.state || "RAW_INFERRED",
  classificationAuthoritySource: authority?.authoritySource ?? null,
  classificationAuthorityActor: authority?.authorityActor ?? null,
  classificationAuthorityCurrent: Boolean(authority?.authorityCurrent),
  classificationAuthoritySatisfied: Boolean(authority?.authoritySatisfied),
  classificationAuthorityFields: {
    required: authority?.requiredFields || [],
    governed: authority?.governedFields || [],
    missing: authority?.missingFields || [],
    unresolved: authority?.unresolvedFields || [],
  },
  classificationReadinessSatisfiedBy: dimension?.satisfiedBy ?? null,
});