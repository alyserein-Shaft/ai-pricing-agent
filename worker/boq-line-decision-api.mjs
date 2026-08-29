// Phase 5 workflow-continuity fix -- the single unified per-BOQ-line
// engineer decision read model. This is a COMPOSITE layer only: every field
// below is read straight from an existing authoritative source (Understanding
// Review, the requirement profile, persisted match candidates, the safety
// decision, and this session's own recalculation-cascade audit trail) --
// nothing here is a new review table, and answering a question here reuses
// the exact same governed EDIT_AND_APPROVE mutation and cascade that already
// exist, never a bypass.
import { applicationActor, resolveApplicationContext } from "./application-context.mjs";
import { currentBoqEvidenceFrom, currentBoqItemPredicate } from "./current-evidence-scope.mjs";
import {
  currentApprovedUnderstandingFacts,
  loadUnderstandingReviewRows,
  mutateUnderstandingReview,
  safeUnderstandingReviewItem,
  understandingReviewSelectionAuthority,
} from "./estimator-understanding-review-api.mjs";
import { cascadeUnderstandingApproval } from "./pipeline-orchestration.mjs";
import { MATCH_ENGINE_VERSION } from "../app/domain/product-matching-engine.mjs";
import { findDiscriminatingAttribute, selectFallbackQuestion, deriveCompositeLineState } from "../app/domain/boq-line-decision-model.mjs";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const parse = (value, fallback) => { try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; } };

const ownedItem = (db, itemId, userId) => db.prepare(
  `SELECT i.id, i.project_id FROM ${currentBoqEvidenceFrom("i")} JOIN projects p ON p.id=i.project_id WHERE i.id=? AND ${currentBoqItemPredicate("i")} AND p.owner_user_id=?`,
).bind(itemId, userId).first();

const currentRequirementProfile = (db, itemId) => db.prepare(
  "SELECT * FROM requirement_profile_versions WHERE boq_item_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1",
).bind(itemId).first();

const currentMatchRun = (db, itemId) => db.prepare(
  "SELECT * FROM product_match_runs WHERE boq_item_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1",
).bind(itemId).first();

const loadCandidates = async (db, matchRunId) => {
  if (!matchRunId) return [];
  const rows = await db.prepare(
    `SELECT c.*, p.attributes product_attributes, p.part_number, p.description, m.name manufacturer, f.name family
     FROM product_match_candidates c
     JOIN canonical_library_products p ON p.requested_product_id=c.product_id
     JOIN product_manufacturers m ON m.id=p.manufacturer_id
     LEFT JOIN product_families f ON f.id=p.family_id
     WHERE c.match_run_id=? ORDER BY c.rank LIMIT 10`,
  ).bind(matchRunId).all();
  return (rows.results || []).map((row) => {
    const scoreComponents = parse(row.score_components, {});
    return {
      candidateId: row.id,
      productId: row.product_id,
      rank: row.rank,
      manufacturer: row.manufacturer,
      partNumber: row.part_number,
      family: row.family,
      technicalStatus: row.technical_status,
      recommendationTier: row.recommendation_tier,
      confidence: row.confidence_state,
      confidenceScore: row.confidence_score,
      explanation: row.explanation,
      matchingBasis: parse(row.matching_basis, []),
      mandatoryFailures: parse(row.mandatory_failures, []),
      familyMatchTier: scoreComponents.familyMatchTier ?? null,
      isFallbackCandidate: Boolean(scoreComponents.isFallbackCandidate),
      rankingReason: scoreComponents.rankingReason || null,
      attributes: parse(row.product_attributes, []),
    };
  });
};

const currentSafetyDecision = (db, itemId) => db.prepare(
  "SELECT id, safety_state, compliance_state, technical_eligibility, overall_confidence, explanation FROM safety_decisions WHERE boq_item_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1",
).bind(itemId).first();

const latestMatchProcessingRun = (db, item) => db.prepare(
  "SELECT id, stage, status, updated_at FROM document_processing_runs WHERE document_version_id=? AND processor_version=? AND json_extract(technical_details, '$.boqItemId')=? ORDER BY created_at DESC, id DESC LIMIT 1",
).bind(item.source_document_version_id || "", MATCH_ENGINE_VERSION, item.id).first();

const latestCascadeEvent = (db, projectId, itemId) => db.prepare(
  "SELECT new_value FROM document_audit_events WHERE project_id=? AND action='Downstream Recalculation Cascade' AND json_extract(new_value,'$.boqItemId')=? ORDER BY created_at DESC, id DESC LIMIT 1",
).bind(projectId, itemId).first();

// A single, honest, non-invented signal for "is downstream still current":
// an actively Queued/Processing job (created only when a manual
// recalculate button posts one -- see product-matching-api.mjs) always wins
// as "Recalculating"; failing that, this session's own cascade audit trail
// (persisted by cascadeUnderstandingApproval) reports whether the LAST
// automatic cascade for this item completed or failed; absent both, the
// persisted results are treated as current -- never a fabricated status.
const recalculationStatus = async (db, item, projectId) => {
  const job = await latestMatchProcessingRun(db, item).catch(() => null);
  if (job && ["Queued", "Processing"].includes(job.status)) return "Recalculating";
  if (job && job.status === "Failed") return "Failed";
  const cascade = await latestCascadeEvent(db, projectId, item.id).catch(() => null);
  const cascadeValue = cascade ? parse(cascade.new_value, {}) : null;
  if (cascadeValue?.status === "Failed") return "Failed";
  return "Current";
};

const isViableCandidate = (candidate) => !candidate.mandatoryFailures.length && candidate.recommendationTier !== "Discovery Candidate";

export const buildLineDecisionModel = async (env, { projectId, itemId, userId }) => {
  const item = await ownedItem(env.DB, itemId, userId);
  if (!item) return { error: { code: "BOQ_ITEM_NOT_FOUND", message: "BOQ item not found." } };
  const rows = await loadUnderstandingReviewRows(env.DB, projectId);
  const row = rows.find((entry) => entry.boqItemId === itemId);
  if (!row) return { error: { code: "UNDERSTANDING_NOT_AVAILABLE", message: "AI understanding is not available for this item yet." } };
  const understanding = safeUnderstandingReviewItem(row);
  const approvedFacts = await currentApprovedUnderstandingFacts(env.DB, projectId, itemId);
  const approvedAttributes = Object.fromEntries(Object.entries(approvedFacts?.attributes || {}));

  const requirementProfileRow = await currentRequirementProfile(env.DB, itemId);
  const requirementProfile = requirementProfileRow ? parse(requirementProfileRow.profile, {}) : null;

  const matchRun = await currentMatchRun(env.DB, itemId);
  const candidates = await loadCandidates(env.DB, matchRun?.id);
  const hasViableCandidate = candidates.some(isViableCandidate);

  const safety = await currentSafetyDecision(env.DB, itemId).catch(() => null);
  const hasOpenSafetyBlock = Boolean(safety) && safety.safety_state !== "Approval Ready";

  const recalculation = await recalculationStatus(env.DB, item, projectId);

  let engineerQuestion = null;
  if (understanding.review.status === "APPROVED") {
    // Pass every persisted candidate, not a pre-filtered "viable" subset --
    // findDiscriminatingAttribute already restricts itself to the
    // best-ranked family tier internally (the same familyMatchTier the
    // frozen v1 ranking sort uses), which is the correct scope regardless of
    // whether those same-tier candidates are currently mandatory-clean. A
    // Discovery-Only item (readiness blocked precisely BECAUSE the
    // discriminator is missing) would otherwise have zero "viable"
    // candidates and incorrectly fall through to comparing unrelated,
    // wrong-family fallback candidates instead.
    engineerQuestion = findDiscriminatingAttribute({
      system: understanding.classification?.system || approvedFacts?.system?.value || null,
      approvedAttributes,
      candidates,
    }) || selectFallbackQuestion({
      clarifications: requirementProfile?.clarifications || [],
      classificationBlockers: understanding.classificationBlockers || [],
      matchingBlockers: understanding.matchingBlockers || [],
    });
  }

  const composite = deriveCompositeLineState({
    understandingReviewStatus: understanding.review.status,
    recalculationStatus: recalculation,
    hasViableCandidate,
    hasOpenEngineerQuestion: Boolean(engineerQuestion),
    hasOpenSafetyBlock,
  });

  return {
    boqItemId: itemId,
    itemReference: understanding.itemReference,
    description: understanding.description,
    quantity: understanding.quantity,
    unit: understanding.unit,
    sourceEvidence: understanding.source,
    understanding: {
      status: understanding.review.status,
      aiProposal: understanding.aiProposal,
      canonicalReview: understanding.canonicalReview,
      familyClassification: understanding.familyClassification,
      governedTaxonomy: understanding.governedTaxonomy,
    },
    requirements: {
      readiness: requirementProfile?.readiness || null,
      applicableCount: requirementProfile?.applicableRequirements?.length || 0,
      consolidated: (requirementProfile?.consolidatedRequirements || []).map((entry) => ({ id: entry.id, normalizedRequirement: entry.normalizedRequirement, priority: entry.priority, requirementCategory: entry.requirementCategory })),
      openClarifications: (requirementProfile?.clarifications || []).filter((entry) => entry.status === "Open"),
    },
    candidates: candidates.map((candidate) => ({ ...candidate, isViable: isViableCandidate(candidate) })),
    safety: safety ? { safetyState: safety.safety_state, complianceState: safety.compliance_state, technicalEligibility: safety.technical_eligibility, explanation: safety.explanation } : null,
    recalculation: { status: recalculation },
    currentBlocker: !hasViableCandidate ? "No technically viable candidate has been found." : engineerQuestion ? engineerQuestion.question : hasOpenSafetyBlock ? "An open safety/compliance block requires engineer resolution." : null,
    engineerQuestion,
    composite,
  };
};

export async function handleBoqLineDecisionApi(request, env) {
  const url = new URL(request.url);
  const readMatch = url.pathname.match(/^\/api\/boq-items\/([^/]+)\/decision$/);
  const answerMatch = url.pathname.match(/^\/api\/boq-items\/([^/]+)\/decision\/answer$/);
  if (!readMatch && !answerMatch) return null;
  if (!env.DB) return json({ error: { code: "DECISION_MODEL_UNAVAILABLE", message: "Decision model storage is unavailable." } }, 503);
  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
  const user = applicationActor(resolved.context);
  const itemId = decodeURIComponent((readMatch || answerMatch)[1]);

  if (readMatch) {
    if (request.method !== "GET") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET." } }, 405);
    const item = await ownedItem(env.DB, itemId, user.id);
    if (!item) return json({ error: { code: "BOQ_ITEM_NOT_FOUND", message: "BOQ item not found." } }, 404);
    const model = await buildLineDecisionModel(env, { projectId: item.project_id, itemId, userId: user.id });
    return model.error ? json(model, model.error.code === "BOQ_ITEM_NOT_FOUND" ? 404 : 409) : json(model);
  }

  if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST to answer." } }, 405);
  let body; try { body = await request.json(); } catch { return json({ error: { code: "DECISION_ANSWER_INVALID", message: "Use the governed decision-answer contract." } }, 400); }
  const result = await answerAttributeDecision(env, resolved.context, {
    itemId, userId: user.id,
    attributeName: String(body.attributeName || "").trim(),
    value: body.value == null ? "" : String(body.value).trim(),
    reason: String(body.reason || "").trim(),
  });
  return json(result.error ? { error: result.error, missing: result.missing || [] } : result, result.error ? result.status || 409 : 200);
}

// Phase 5 BOM-continuity fix -- extracted so the BOM decision surface
// (worker/boq-line-bom-api.mjs) can answer its own ATTRIBUTE_ANSWER-kind
// questions (e.g. "is a sounder required?") through this EXACT SAME governed
// path -- the same EDIT_AND_APPROVE mutation, the same
// return-to-review-first handling for an already-approved item, the same
// synchronous cascade -- rather than a second, parallel implementation.
export async function answerAttributeDecision(env, context, { itemId, userId, attributeName, value, reason }) {
  if (!attributeName || !value) return { error: { code: "DECISION_ANSWER_VALUE_REQUIRED", message: "An attribute name and a value are required." }, status: 422 };
  if (reason.length < 5) return { error: { code: "DECISION_ANSWER_REASON_REQUIRED", message: "Provide a substantive engineering reason for this decision." }, status: 422 };
  const item = await ownedItem(env.DB, itemId, userId);
  if (!item) return { error: { code: "BOQ_ITEM_NOT_FOUND", message: "BOQ item not found." }, status: 404 };

  let rows = await loadUnderstandingReviewRows(env.DB, item.project_id);
  let row = rows.find((entry) => entry.boqItemId === itemId);
  if (!row) return { error: { code: "UNDERSTANDING_NOT_AVAILABLE", message: "AI understanding is not available for this item yet." }, status: 409 };
  let current = safeUnderstandingReviewItem(row, { actorAuthorized: true });
  // An already-APPROVED interpretation only ever allows RETURN_TO_REVIEW
  // (the existing governed transition matrix's own safety gate against
  // silently re-editing an approved decision -- see
  // buildUnderstandingReviewActionPolicy). Answering a decision-surface
  // question on an already-approved item performs the SAME two governed
  // steps an engineer would otherwise click through by hand -- return to
  // review, then edit-and-approve -- each still its own versioned, audited
  // event; this is orchestration of existing governance, never a bypass of it.
  if (!current.allowedActions.includes("EDIT_AND_APPROVE") && current.allowedActions.includes("RETURN_TO_REVIEW")) {
    const returned = await mutateUnderstandingReview(env.DB, context, item.project_id, row, {
      action: "RETURN_TO_REVIEW",
      expectedVersion: Number(row.reviewVersion || 0),
      selectionAuthority: understandingReviewSelectionAuthority(item.project_id, row),
      requestId: id("decisionanswer-return"),
      reason: `Returned to review to record an engineer decision: ${reason}`,
    });
    if (returned.error) return { error: { code: returned.error, message: "This item could not be returned to review before recording the decision." }, status: returned.status || 409 };
    rows = await loadUnderstandingReviewRows(env.DB, item.project_id);
    row = rows.find((entry) => entry.boqItemId === itemId);
    current = safeUnderstandingReviewItem(row, { actorAuthorized: true });
  }
  if (!current.allowedActions.includes("EDIT_AND_APPROVE")) return { error: { code: current.denialReasons?.EDIT_AND_APPROVE || "DECISION_ANSWER_NOT_ALLOWED", message: "This item cannot be edited and approved in its current state." }, status: 409 };

  const source = parse(row.canonicalInterpretation, null) || row.effective?.proposal || {};
  const canonicalInterpretation = {
    ...source,
    attributes: { ...(source.attributes || {}), [attributeName]: { value, origin: "EXTRACTED", confidence: 100 } },
  };
  const mutation = await mutateUnderstandingReview(env.DB, context, item.project_id, row, {
    action: "EDIT_AND_APPROVE",
    expectedVersion: Number(row.reviewVersion || 0),
    selectionAuthority: understandingReviewSelectionAuthority(item.project_id, row),
    requestId: id("decisionanswer"),
    reason,
    canonicalInterpretation,
  });
  if (mutation.error) return { error: { code: mutation.error, message: "The engineering decision could not be recorded." }, missing: mutation.missing || [], status: mutation.status || 409 };

  // Synchronous, not backgrounded -- the whole point of this endpoint is to
  // hand back the RESULT of the decision (updated candidates, updated
  // composite state) in the same round trip, per the "Result" section of the
  // unified decision surface.
  const cascade = await cascadeUnderstandingApproval(env, { projectId: item.project_id, itemId, userId, trigger: "Engineer Decision Answer" });
  const model = await buildLineDecisionModel(env, { projectId: item.project_id, itemId, userId });
  return { decision: { attributeName, value, reason }, cascade, model };
}
