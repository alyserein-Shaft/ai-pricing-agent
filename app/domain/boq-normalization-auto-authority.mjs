// GOVERNED BOQ NORMALIZATION AUTO-AUTHORITY.
//
// Removes unnecessary manual Accept/Apply work when DETERMINISTIC evidence already
// establishes that a normalization is non-material and safe. It is a POLICY LAYER over
// the existing normalization review; it does not replace the canonical Apply, does not
// weaken any gate, and never impersonates a human.
//
// THE CENTRAL RULE: AI confidence alone can NEVER grant authority. Every eligibility
// condition is a deterministic check against persisted project evidence. AI semantic
// reasoning may SUPPORT a classification only after the deterministic checks pass, and a
// terminology ambiguity that changes no quantity, no unit and no scope is DEFERRED to
// BOQ Understanding rather than silently resolved here.
//
// A decision recorded under this policy is explicitly NON-HUMAN:
//   decision_actor_type = 'SYSTEM_POLICY'
//   decision_mode       = 'AUTO_APPROVED'
//   policy_id           = 'BOQ_NORMALIZATION_AUTO_AUTHORITY_V1'
// It is never recorded under `omair` / `Omair`, and `local-development-user` is never
// quoted as a decision-maker.

export const BOQ_NORMALIZATION_AUTO_AUTHORITY_VERSION = "BOQ_NORMALIZATION_AUTO_AUTHORITY_V1";
export const BOQ_NORMALIZATION_AUTO_DECISION_ACTOR_TYPE = "SYSTEM_POLICY";
export const BOQ_NORMALIZATION_AUTO_DECISION_MODE = "AUTO_APPROVED";
export const BOQ_NORMALIZATION_HUMAN_REVIEW_REQUIRED = "HUMAN_REVIEW_REQUIRED";
export const BOQ_NORMALIZATION_SEMANTIC_AMBIGUITY_DEFERRED = "SEMANTIC_AMBIGUITY_DEFERRED_TO_UNDERSTANDING";

// The closed unit vocabulary the normalization layer is allowed to rewrite. Anything
// outside it is a genuine UNIT_CONFLICT and is never auto-equated.
const UNIT_EQUIVALENCE = new Map([
  ["no", "each"], ["no.", "each"], ["nos", "each"], ["no's", "each"], ["each", "each"],
  ["ls", "lump sum"], ["lump sum", "lump sum"], ["lumpsum", "lump sum"], ["lump", "lump sum"],
]);
export const canonicalUnitFor = (value) => UNIT_EQUIVALENCE.get(String(value ?? "").trim().toLowerCase()) ?? null;

const isNonEmpty = (value) => Array.isArray(value) ? value.length > 0 : value != null && value !== false && value !== "";

// ── Deterministic eligibility ────────────────────────────────────────────────
// Every condition is a check against persisted evidence. Nothing here reads a model
// confidence, a provider score, or any AI output.
//
// Failures are ACCUMULATED, never short-circuited with an early `continue`. An earlier
// failure must never be able to mask a later governance check: ordering the checks
// would otherwise decide whether, say, a deleted source row is caught.
export const evaluateNormalizationAutoApproval = ({
  review = null,
  candidates = [],
  sourceRows = [],
  currentExtractionId = null,
  currentDocumentVersionId = null,
  sourceSha256 = null,
} = {}) => {
  const blockers = [];
  const deferredAmbiguities = [];
  const checks = {};
  const addBlocker = (code) => { if (!blockers.includes(code)) blockers.push(code); };

  // -- Identity / currency ---------------------------------------------------
  if (!review) addBlocker("NORMALIZATION_REVIEW_MISSING");
  if (review && review.status !== "OPEN") addBlocker("NORMALIZATION_REVIEW_NOT_OPEN");
  if (currentExtractionId && review && review.source_extraction_id !== currentExtractionId) {
    addBlocker("SOURCE_EXTRACTION_NOT_CURRENT");
  }
  if (currentDocumentVersionId && review && review.source_document_version_id !== currentDocumentVersionId) {
    addBlocker("SOURCE_VERSION_NOT_CURRENT");
  }
  if (sourceSha256 && review && review.source_sha256 !== sourceSha256) {
    addBlocker("SOURCE_CONTENT_CHANGED");
  }
  checks.identityAndCurrency = blockers.length === 0;

  const rowsByAnchor = new Map(sourceRows.map((row) => [Number(row.sourceRow), row]));
  const failures = { anchors: 0, quantity: 0, unit: 0, provenance: 0, deletion: 0, split: 0, merge: 0, uncovered: 0 };
  // Which candidate(s) claim each source row. A row claimed by more than one candidate is
  // an unresolved DUPLICATE: normalization would count the same raw evidence twice.
  const owners = new Map();

  // -- Per-candidate deterministic checks ------------------------------------
  for (const candidate of candidates) {
    const anchors = [...new Set((candidate.sources || []).map((s) => Number(s.source_row)).filter(Number.isFinite))];

    // -- Provenance and deletion are checked FIRST and unconditionally, so that no
    //    other failure can mask them.
    if (!anchors.length) {
      failures.anchors += 1;
      failures.provenance += 1;
    }
    for (const anchor of anchors) {
      const row = rowsByAnchor.get(anchor);
      if (!row) {
        // An anchor that resolves to no live raw row is a provenance conflict.
        failures.anchors += 1;
        failures.provenance += 1;
        continue;
      }
      if (row.deleted || row.superseded) failures.deletion += 1;
      if (!owners.has(anchor)) owners.set(anchor, new Set());
      owners.get(anchor).add(String(candidate.id));
    }
    const linked = anchors.map((a) => rowsByAnchor.get(a)).filter(Boolean);
    if (anchors.length && linked.length !== anchors.length) {
      failures.anchors += 1;
      failures.provenance += 1;
    }

    // -- Quantity must be deterministically derivable from this candidate's OWN rows.
    const declaredQuantity = Number(candidate.normalized_quantity);
    const derivedQuantity = linked.reduce((total, row) => total + Number(row.quantity || 0), 0);
    if (!anchors.length || !Number.isFinite(declaredQuantity) || Math.abs(derivedQuantity - declaredQuantity) > 1e-6) {
      failures.quantity += 1;
    }

    // -- Unit normalization must be deterministic. BOTH sides are canonicalized before
    //    comparison: a candidate may legitimately declare a raw surface form (`no`,
    //    `ls`) while its source rows carry the normalized form (`each`, `lump sum`).
    //    That is a labeling difference, not a disagreement about what the quantity means.
    //    Comparing a canonical form against a raw string would report a conflict where
    //    the two sides agree exactly, which would be a false blocker. A REAL conflict is
    //    when the canonical forms differ, or when either side falls outside the closed
    //    vocabulary (`canonicalUnitFor` returns null and nothing is ever guessed).
    const units = [...new Set(linked.map((row) => String(row.unit || "").trim().toLowerCase()))];
    const declaredRaw = String(candidate.normalized_unit || "").trim().toLowerCase();
    const declaredCanonical = canonicalUnitFor(declaredRaw);
    if (units.length !== 1 || declaredCanonical === null) {
      failures.unit += 1;
    } else if (canonicalUnitFor(units[0]) !== declaredCanonical) {
      failures.unit += 1;
    }

    // -- A candidate merging a lump-sum anchor with unit-bearing anchors is an
    //    unresolved semantic merge: the quantities are not commensurable, so which
    //    rows the total is meant to cover is a human judgement.
    const lumpSumUnits = units.filter((unit) => canonicalUnitFor(unit) === "lump sum").length;
    if (units.length > 1 && lumpSumUnits > 0 && lumpSumUnits < units.length) {
      failures.merge += 1;
    }

    // -- A wording difference between contributing rows is a TERMINOLOGY question, not
    //    a scope question -- but only once quantity, unit and anchors are deterministic.
    const descriptions = [...new Set(linked.map((row) => String(row.description || "").trim().toLowerCase()))];
    if (descriptions.length > 1) {
      deferredAmbiguities.push({
        candidateId: candidate.id,
        normalizedDescription: candidate.normalized_description,
        sourceDescriptions: descriptions,
        status: BOQ_NORMALIZATION_SEMANTIC_AMBIGUITY_DEFERRED,
        reason: "Terminology varies between contributing source rows; quantity, unit and anchors are deterministic and unchanged, so this belongs to BOQ Understanding rather than blocking normalization.",
      });
    }
  }

  // -- Cross-candidate coverage: MATERIAL SCOPE -------------------------------
  // Every live raw row must be claimed by EXACTLY ONE candidate. Zero claims means the
  // normalization DROPPED source evidence; more than one means it DOUBLE-COUNTED. Either
  // is a material change to commercial/technical scope and is always human-owned.
  for (const row of sourceRows) {
    const owner = owners.get(Number(row.sourceRow));
    if (!owner || owner.size === 0) failures.uncovered += 1;
    else if (owner.size > 1) failures.split += 1;
  }

  if (failures.anchors) addBlocker("SOURCE_ANCHOR_CONFLICT");
  if (failures.provenance) addBlocker("SOURCE_PROVENANCE_UNCERTAIN");
  if (failures.quantity) addBlocker("QUANTITY_CONFLICT");
  if (failures.unit) addBlocker("UNIT_CONFLICT");
  if (failures.split) addBlocker("UNRESOLVED_DUPLICATE");
  if (failures.merge) addBlocker("MERGE_REQUIRED_SEMANTIC_SCOPE_UNRESOLVED");
  if (failures.deletion) addBlocker("SOURCE_ROW_DELETION");
  if (failures.uncovered) addBlocker("MATERIAL_SCOPE_CHANGE");

  checks.anchorsResolve = failures.anchors === 0;
  checks.quantityDerivable = failures.quantity === 0;
  checks.unitDeterministic = failures.unit === 0;
  checks.noDuplicateConflict = failures.split === 0;
  checks.provenanceIntact = failures.provenance === 0;
  checks.noSourceRowDeletion = failures.deletion === 0;
  checks.noScopeChange = failures.uncovered === 0 && failures.merge === 0;
  checks.allSourceRowsPreserved = failures.uncovered === 0;
  checks.everySourceRowClaimedExactlyOnce = failures.uncovered === 0 && failures.split === 0;

  const eligible = blockers.length === 0;
  return {
    policyId: BOQ_NORMALIZATION_AUTO_AUTHORITY_VERSION,
    eligible,
    blockers,
    deferredAmbiguities,
    checks,
    candidateCount: candidates.length,
    sourceRowCount: sourceRows.length,
    // Explicitly non-human. Recorded so a reviewer can tell a policy decision from a
    // human one without guessing.
    decisionActorType: eligible ? BOQ_NORMALIZATION_AUTO_DECISION_ACTOR_TYPE : null,
    decisionMode: eligible ? BOQ_NORMALIZATION_AUTO_DECISION_MODE : null,
    humanReviewRequired: !eligible,
    humanReviewReason: eligible ? null : BOQ_NORMALIZATION_HUMAN_REVIEW_REQUIRED,
  };
};

export const buildNormalizationAutoDecision = ({ review, evaluation, reason, ai = null }) => ({
  policyId: BOQ_NORMALIZATION_AUTO_AUTHORITY_VERSION,
  decisionActorType: BOQ_NORMALIZATION_AUTO_DECISION_ACTOR_TYPE,
  decisionMode: BOQ_NORMALIZATION_AUTO_DECISION_MODE,
  projectId: review.project_id,
  sourceDocumentId: review.source_document_id,
  sourceDocumentVersionId: review.source_document_version_id,
  sourceExtractionId: review.source_extraction_id,
  sourceSha256: review.source_sha256,
  generationNumber: review.generation_number,
  generationFingerprint: review.generation_fingerprint,
  checks: evaluation.checks,
  blockers: evaluation.blockers,
  deferredAmbiguities: evaluation.deferredAmbiguities,
  reason,
  // AI provenance is recorded ONLY when AI was actually invoked, and it is evidence
  // about a classification -- never the basis for authority.
  aiProvenance: ai
    ? { provider: ai.provider, model: ai.model, attempt: ai.attempt, latency: ai.latency, schemaValid: ai.schemaValid, evidenceValidationResult: ai.evidenceValidationResult, fallbackUsed: false }
    : null,
  humanActor: null,
});

export { isNonEmpty };