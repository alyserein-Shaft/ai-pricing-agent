// GOVERNED SPECIFICATION AUTO-AUTHORITY.
//
// SPEC_AUTO_AUTHORITY_V1 removes the false manual approval gate from DETERMINISTICALLY
// extracted specification requirements.
//
// DESIGN NOTE -- WHY THIS IS AN INTERSECTION, NOT A REPLACEMENT:
// `worker/spec-requirement-auto-confirm.mjs` already implements a proven, tested
// 12-gate deterministic policy (`spec-requirement-auto-confirm-1.0.0`) that is stricter
// than provenance alone. Among other things it requires `requirement_type = Mandatory`
// AND an exact normative modal in the ORIGINAL TEXT, and it refuses weak phrasing,
// commercial/qualification boilerplate, delegated design-choice language and
// Documentation/Maintenance/Training categories.
//
// Those refusals are deliberate and are NOT overturned here. Approving a sentence that
// merely says a system "as required" shall be "suitable", or that carries supplier
// qualification boilerplate, would assert non-binding or non-technical language as
// approved downstream technical truth. This policy therefore REUSES the canonical
// evaluator as a mandatory floor and ADDS the provenance/currentness gates below.
// Anything the canonical floor refuses is NOT thereby human-required -- it is routed to
// SEMANTIC_REASONING_REQUIRED for the AI Project Evidence Reasoner.
//
// THE CENTRAL RULE: AI confidence is never authority. `confidence` and
// `confidence_state` are never read by this module. AI may later SUPPORT a
// classification for the SEMANTIC_REASONING_REQUIRED population, but authority here
// rests only on deterministic evidence.
//
// Authority is explicitly NON-HUMAN. It is never recorded as Omair, and the execution
// session identity is never a decision-maker.

import {
  evaluateSpecRequirementAutoConfirmation,
  autoConfirmSpecRequirement,
  SPEC_REQUIREMENT_AUTO_CONFIRM_ACTOR,
  SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION,
} from "../../worker/spec-requirement-auto-confirm.mjs";

export const SPEC_AUTO_AUTHORITY_POLICY = "SPEC_AUTO_AUTHORITY_V1";
export const SPEC_AUTO_AUTHORITY_ACTOR_TYPE = "SYSTEM_POLICY";
export const SPEC_AUTO_AUTHORITY_ACTOR = "system:spec-auto-authority-v1";
export const SPEC_SEMANTIC_REASONING_REQUIRED = "SEMANTIC_REASONING_REQUIRED";
export const SPEC_AMBIGUOUS_OR_CONFLICTED = "AMBIGUOUS_OR_CONFLICTED";
export const SPEC_STALE_OR_REFUSED = "STALE_OR_REFUSED";

// Requirement types that carry unresolved ambiguity or an explicit instruction NOT to
// treat the text as settled. These can never pass a deterministic auto-authority.
const AMBIGUOUS_TYPES = new Set(["Conditional", "Clarification Required", "Prohibited"]);

// The ONLY domain provenance a deterministic policy may accept. `Inferred` means a
// semantic classification was applied, which by definition requires reasoning.
const DETERMINISTIC_DOMAIN_SOURCE = "Inherited From Document";

// ── Revision binding ────────────────────────────────────────────────────────
// Revision identity is RESOLVED through requirement -> extraction_version_id ->
// document_version -> document. It is never accepted from a client-provided string and
// never bulk-copied onto the requirement row. If the chain cannot be resolved, the row
// fails closed.
export const resolveSpecificationRevisionBinding = async (db, { extractionVersionId }) => {
  if (!extractionVersionId) {
    return { resolved: false, code: "EXTRACTION_VERSION_MISSING", reason: "The requirement has no extraction_version_id, so its revision cannot be resolved." };
  }
  const extraction = await db.prepare(
    "SELECT id, document_id, document_version_id, version_number, status, superseded_at, parser_version FROM specification_extraction_versions WHERE id=?",
  ).bind(extractionVersionId).first();
  if (!extraction) {
    return { resolved: false, code: "EXTRACTION_VERSION_NOT_FOUND", reason: "The requirement's extraction version does not exist." };
  }
  if (extraction.superseded_at) {
    return { resolved: false, code: "EXTRACTION_VERSION_SUPERSEDED", reason: "The requirement's extraction version has been superseded." };
  }
  if (extraction.status !== "Completed") {
    return { resolved: false, code: "EXTRACTION_VERSION_NOT_COMPLETED", reason: `The requirement's extraction version is ${extraction.status}, not Completed.` };
  }
  const document = await db.prepare("SELECT id, logical_name, current_version_id, deleted_at, archived_at FROM documents WHERE id=?").bind(extraction.document_id).first();
  if (!document) return { resolved: false, code: "SOURCE_DOCUMENT_NOT_FOUND", reason: "The requirement's source document does not exist." };
  if (document.deleted_at || document.archived_at) {
    return { resolved: false, code: "SOURCE_DOCUMENT_NOT_CURRENT", reason: "The requirement's source document is deleted or archived." };
  }
  const isCurrent = extraction.document_version_id === document.current_version_id;
  return {
    resolved: true,
    isCurrent,
    code: isCurrent ? "REVISION_CURRENT" : "REVISION_STALE",
    extractionVersionId,
    documentId: document.id,
    documentVersionId: extraction.document_version_id,
    currentDocumentVersionId: document.current_version_id,
    documentLogicalName: document.logical_name,
    extractionVersionNumber: extraction.version_number,
    parserVersion: extraction.parser_version,
    reason: isCurrent
      ? `Revision bound through extraction ${extractionVersionId} to the current document version ${extraction.document_version_id}.`
      : "The requirement's extraction is bound to a superseded document version.",
  };
};

const parseSourceLocation = (raw) => {
  if (!raw) return null;
  try { const parsed = JSON.parse(raw); return parsed && typeof parsed === "object" ? parsed : null; } catch { return null; }
};

// ── Evaluation ──────────────────────────────────────────────────────────────
// Pure decision function. `canonical` is the reused canonical evaluation;
// `revision` is the resolved binding. Nothing here reads model confidence.
export const evaluateSpecAutoAuthority = ({ requirement, canonical, revision, openAmbiguity = false, openConflict = false }) => {
  const gates = [];
  const add = (name, pass, reason) => { gates.push({ name, pass, reason }); return pass; };

  // -- Provenance -------------------------------------------------------------
  const location = parseSourceLocation(requirement.source_location);
  add("clause_id_present", Boolean(String(requirement.clause_id || "").trim()), "clause_id anchors the requirement to a source clause.");
  add("source_location_present", Boolean(location), "source_location must parse as a provenance object.");
  add("source_page_present", Boolean(location && Number(location.pageFrom) > 0), "source_location must carry a real page number.");
  add("original_text_present", Boolean(String(requirement.original_text || "").trim()), "original_text is the verbatim source fact.");
  add("extraction_version_present", Boolean(String(requirement.extraction_version_id || "").trim()), "extraction_version_id is the revision anchor.");

  // -- Revision / currentness -------------------------------------------------
  add("revision_resolved", Boolean(revision?.resolved), revision?.reason || "Revision could not be resolved.");
  add("revision_current", Boolean(revision?.resolved && revision?.isCurrent), revision?.reason || "Revision is not current.");

  // -- Deterministic (non-semantic) classification ----------------------------
  add("domain_source_deterministic", requirement.domain_source_type === DETERMINISTIC_DOMAIN_SOURCE,
    `domain_source_type is ${requirement.domain_source_type}; only '${DETERMINISTIC_DOMAIN_SOURCE}' is deterministic.`);

  // -- Extraction doubt withheld (fail-closed, NOT authority) ----------------
  // `confidence_state = 'Needs Review'` is the extractor's own explicit flag that it
  // doubts this row. It is used ONLY to REFUSE, never to grant: a doubt signal can
  // withhold authority but can never confer it. This is the opposite of letting AI
  // confidence decide, and it is why reading `confidence` here would be wrong.
  add("extraction_doubt_cleared", requirement.confidence_state !== "Needs Review",
    `confidence_state is ${requirement.confidence_state}; a flagged extraction doubt blocks auto-authority.`);

  // -- Ambiguity / conflict ---------------------------------------------------
  const ambiguousType = AMBIGUOUS_TYPES.has(requirement.requirement_type);
  add("not_ambiguous_type", !ambiguousType, `requirement_type is ${requirement.requirement_type}.`);
  add("no_open_ambiguity", !openAmbiguity, "No open ambiguity record exists for this requirement.");
  add("no_open_conflict", !openConflict, "No open conflict record exists for this requirement.");

  // -- Canonical floor (reused, never weakened) -------------------------------
  add("canonical_policy_eligible", Boolean(canonical?.eligible), canonical?.reason || "The canonical spec auto-confirm policy refused this requirement.");

  const failed = gates.filter((gate) => !gate.pass);

  // Classification is explicit so nothing is silently parked as human-required.
  let classification;
  if (!failed.length) classification = "AUTO_AUTHORITY_ELIGIBLE";
  else if (!revision?.resolved || revision?.code === "REVISION_STALE" || revision?.code === "EXTRACTION_VERSION_MISSING") classification = SPEC_STALE_OR_REFUSED;
  else if (ambiguousType || openAmbiguity || openConflict) classification = SPEC_AMBIGUOUS_OR_CONFLICTED;
  else classification = SPEC_SEMANTIC_REASONING_REQUIRED;

  return {
    policyId: SPEC_AUTO_AUTHORITY_POLICY,
    canonicalPolicyVersion: SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION,
    eligible: failed.length === 0,
    gates,
    failedGates: failed.map((gate) => gate.name),
    classification,
    decisionActorType: failed.length === 0 ? SPEC_AUTO_AUTHORITY_ACTOR_TYPE : null,
    decisionActor: failed.length === 0 ? SPEC_AUTO_AUTHORITY_ACTOR : null,
    humanActor: null,
    revision: revision ?? null,
  };
};

// The governed provenance recorded alongside every auto-approved requirement. Extracted
// so the live apply path and any idempotent backfill produce byte-identical evidence.
export const buildSpecAutoAuthorityEvidence = ({ evaluation, projectId }) => JSON.stringify({
  governingPolicy: SPEC_AUTO_AUTHORITY_POLICY,
  canonicalPolicy: SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION,
  decisionActorType: SPEC_AUTO_AUTHORITY_ACTOR_TYPE,
  decisionActor: SPEC_AUTO_AUTHORITY_ACTOR,
  humanActor: null,
  projectId,
  sourceDocumentId: evaluation.revision.documentId,
  sourceDocumentVersionId: evaluation.revision.documentVersionId,
  sourceExtractionVersionId: evaluation.revision.extractionVersionId,
  clauseId: evaluation.clauseId,
  requirementType: evaluation.requirementType,
  domainSourceType: evaluation.domainSourceType,
  currentness: evaluation.revision.code,
  gates: evaluation.gates.map((gate) => ({ name: gate.name, pass: gate.pass })),
});

// ── Orchestration ───────────────────────────────────────────────────────────
// Evaluates the project's whole current requirement population, then persists the
// eligible subset through the CANONICAL governed writer (`autoConfirmSpecRequirement`),
// which performs a real compare-and-swap against the current-requirements predicate
// and writes the audit row only after the transition commits. No parallel writer is
// created and no requirement text is ever rewritten.
export const runSpecAutoAuthority = async (db, { projectId, apply = false }) => {
  const requirements = (await db.prepare(
    "SELECT * FROM technical_requirements WHERE project_id=? ORDER BY sequence",
  ).bind(projectId).all()).results || [];

  // One canonical extraction version per project population; resolve per requirement so
  // a mixed population can never launder a stale binding.
  const revisionCache = new Map();
  const resolveRevision = async (extractionVersionId) => {
    if (!revisionCache.has(extractionVersionId)) {
      revisionCache.set(extractionVersionId, await resolveSpecificationRevisionBinding(db, { extractionVersionId }));
    }
    return revisionCache.get(extractionVersionId);
  };

  const activeExtractionVersionIds = [...new Set(requirements.map((r) => r.extraction_version_id).filter(Boolean))];
  const evaluations = [];
  for (const requirement of requirements) {
    const revision = await resolveRevision(requirement.extraction_version_id);
    const canonical = await evaluateSpecRequirementAutoConfirmation(db, {
      requirementId: requirement.id,
      activeExtractionVersionId: revision?.resolved && revision?.isCurrent ? requirement.extraction_version_id : null,
    });
    const openAmbiguity = Boolean(await db.prepare("SELECT id FROM requirement_ambiguities WHERE requirement_id=? AND status='Open'").bind(requirement.id).first());
    const openConflict = Boolean(await db.prepare(
      "SELECT id FROM requirement_conflicts WHERE (left_requirement_id=? OR right_requirement_id=?) AND resolution_status='Open'",
    ).bind(requirement.id, requirement.id).first());

    const evaluation = evaluateSpecAutoAuthority({ requirement, canonical, revision, openAmbiguity, openConflict });
    evaluations.push({
      requirementId: requirement.id,
      clauseId: requirement.clause_id,
      requirementType: requirement.requirement_type,
      domainSourceType: requirement.domain_source_type,
      originalTextHash: null,
      ...evaluation,
    });
  }

  const counts = {
    total: evaluations.length,
    eligible: evaluations.filter((e) => e.eligible).length,
    semanticReasoningRequired: evaluations.filter((e) => e.classification === SPEC_SEMANTIC_REASONING_REQUIRED).length,
    ambiguousOrConflicted: evaluations.filter((e) => e.classification === SPEC_AMBIGUOUS_OR_CONFLICTED).length,
    staleOrRefused: evaluations.filter((e) => e.classification === SPEC_STALE_OR_REFUSED).length,
    revisionResolved: evaluations.filter((e) => e.revision?.resolved).length,
  };

  const results = { counts, evaluations, applied: [] };
  if (!apply) return results;

  for (const evaluation of evaluations.filter((e) => e.eligible)) {
    const outcome = await autoConfirmSpecRequirement(db, {
      requirementId: evaluation.requirementId,
      activeExtractionVersionId: evaluation.revision.extractionVersionId,
      // Written atomically with the transition. The audit table is append-only, so this
      // provenance can never be attached afterwards.
      evidence: buildSpecAutoAuthorityEvidence({ evaluation, projectId }),
    });
    results.applied.push({ requirementId: evaluation.requirementId, success: Boolean(outcome.success), code: outcome.code ?? null, reason: outcome.reason ?? null });
  }
  results.counts.applied = results.applied.filter((a) => a.success).length;
  results.counts.refusedAtWrite = results.applied.filter((a) => !a.success).length;
  return results;
};