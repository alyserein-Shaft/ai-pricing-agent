// GOVERNED REVIEWED-FACT WITHDRAWAL -- the smallest path that lets a human
// retract an observation they previously CONFIRMED.
//
// WHY THIS EXISTS (2026-10-01, pre-Batch-3B address closure).
// `confirmKnowledgeFactReview` deliberately acts only on `Needs Review` and
// `Learned`: "a fact that already carries a decision cannot be silently
// re-decided". That is correct for the ordinary case, but it left a real hole.
// A deliberately fabricated conflict probe -- `knowledgeFact_pilot_A-det-conflict`,
// a 250-detector value whose own quote reads "(none - deliberate conflict probe,
// no source supports 250)" -- was left in the live Knowledge base marked
// `Reviewed` at confidence 99, HIGHER than the genuine 159's 96. It could not be
// Rejected through any governed path: the review primitive refuses it, and the
// decision-packet orchestrator routes Reject through that same primitive. A
// fabricated fact marked Reviewed is indistinguishable from evidence.
//
// WHAT THIS IS NOT.
//   * It is NOT arbitrary historical rewriting. It only moves `Reviewed` ->
//     `Rejected`, never the reverse, and only with a configured human.
//   * It does NOT delete the fact. The row, its attributes, its source location
//     and its original probe metadata are all retained; only its review state
//     changes, and the change is audited with before/after.
//   * It does NOT touch canonical authority. If the withdrawn fact has an ACTIVE
//     promotion, the withdrawal is REFUSED and the caller must first run the
//     governed `reverseKnowledgePromotion`. Canonical truth is never left
//     pointing at evidence a human has just withdrawn.
//
// GUARANTEES
//   * configured real human actor only; synthetic placeholders refused
//   * substantive reason (MIN_FACT_WITHDRAWAL_REASON_LENGTH = 40)
//   * guarded UPDATE: the status precondition IS the concurrency check, and the
//     audit row is written only if the UPDATE actually applied
//   * idempotent on replay via the knowledge_file_events idempotency key
//   * fails closed on an active promotion

import { isHumanDecisionActor } from "./human-authority.mjs";

export const KNOWLEDGE_FACT_WITHDRAWAL_VERSION = "knowledge-fact-withdrawal-1.0.0";
export const WITHDRAWAL_EVENT_TYPE = "Knowledge Fact Withdrawn";

// A withdrawal retracting a decision a human ALREADY CONFIRMED is more
// consequential than recording that review in the first place, so the shared
// 5-character `MIN_GOVERNED_REASON_LENGTH` is too weak here: it would accept
// "wrong". The audit row for this action is the only place the reasoning survives,
// so the bar is raised to the same standard already used for elevating a source
// authority (MIN_SOURCE_AUTHORITY_ELEVATION_REASON_LENGTH = 40).
export const MIN_FACT_WITHDRAWAL_REASON_LENGTH = 40;

export const FACT_WITHDRAWAL_ERRORS = Object.freeze({
  FACT_REQUIRED: "KNOWLEDGE_FACT_REQUIRED",
  FACT_NOT_FOUND: "KNOWLEDGE_FACT_NOT_FOUND",
  NOT_REVIEWED: "KNOWLEDGE_FACT_NOT_REVIEWED",
  ACTIVE_PROMOTION: "KNOWLEDGE_FACT_ACTIVE_PROMOTION",
  HUMAN_ACTOR_REQUIRED: "KNOWLEDGE_WITHDRAWAL_HUMAN_ACTOR_REQUIRED",
  REASON_REQUIRED: "KNOWLEDGE_WITHDRAWAL_REASON_REQUIRED",
  IDEMPOTENCY_KEY_REQUIRED: "KNOWLEDGE_WITHDRAWAL_IDEMPOTENCY_KEY_REQUIRED",
  NOT_WITHDRAWN: "KNOWLEDGE_FACT_NOT_WITHDRAWN",
});

const clean = (value) => String(value ?? "").trim();
const error = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

/**
 * Decide whether a Reviewed fact may be withdrawn. Pure; no database access.
 *
 * @param {object} input
 * @param {object|null} input.fact the knowledge_facts row
 * @param {Array} input.activePromotions promotions that still carry canonical
 *   authority derived from this fact (see `activePromotionsForFact`)
 * @param {object} input.humanActor must satisfy `isHumanDecisionActor`
 * @param {string} input.reason substantive human justification
 */
export const assessFactWithdrawal = ({ fact, activePromotions = [], humanActor, reason } = {}) => {
  if (!isHumanDecisionActor(humanActor)) {
    return error(
      FACT_WITHDRAWAL_ERRORS.HUMAN_ACTOR_REQUIRED,
      "A fact withdrawal must be made by a configured human decision-maker, not a synthetic or asserted identity.",
    );
  }
  const id = clean(fact?.id);
  if (!id) return error(FACT_WITHDRAWAL_ERRORS.FACT_REQUIRED, "A fact is required.");

  const cleanReason = clean(reason);
  if (cleanReason.length < MIN_FACT_WITHDRAWAL_REASON_LENGTH) {
    return error(
      FACT_WITHDRAWAL_ERRORS.REASON_REQUIRED,
      "Provide a substantive reason: a human is retracting a decision they made, and the record must say why.",
    );
  }

  // A fact that was never confirmed cannot be "withdrawn" -- that is a Reject,
  // which the ordinary review path already handles. Keeping the states distinct
  // stops this path from becoming a back door around that guard.
  if (clean(fact.review_status) !== "Reviewed") {
    return error(
      FACT_WITHDRAWAL_ERRORS.NOT_REVIEWED,
      `This fact is "${clean(fact.review_status) || "(none)"}", not Reviewed. A fact that was never confirmed must be Rejected through the ordinary review path, not withdrawn.`,
    );
  }

  // Canonical authority first. A withdrawn fact must not remain the basis of an
  // Approved attribute, relationship or lifecycle row.
  const active = (activePromotions || []).filter(
    (p) => p && new Set(["Promoted", "Promote"]).has(clean(p.action)),
  );
  if (active.length) {
    return error(
      FACT_WITHDRAWAL_ERRORS.ACTIVE_PROMOTION,
      "This fact still carries active canonical authority. Reverse the governed promotion first, then withdraw the fact; canonical truth must never rest on withdrawn evidence.",
      { promotions: active.map((p) => clean(p.id)) },
    );
  }

  return {
    ok: true,
    factId: id,
    partNumber: clean(JSON.parse(fact.attributes || "{}").partNumber) || null,
    previousStatus: "Reviewed",
    nextStatus: "Rejected",
    reason: cleanReason,
  };
};

/**
 * Read the promotions a fact still carries. Called by the writer so the
 * assessment is never performed against a stale caller-supplied list.
 */
export const activePromotionsForFact = async (db, factId) => {
  const id = clean(factId);
  if (!id) return [];
  // The REAL action vocabulary in `knowledge_promotions` is "Promoted" and
  // "Evidence Only" -- NOT "Promote". An earlier version of this function
  // compared against "Promote", which never matched, so the active-promotion
  // guard was INERT and a fact carrying live canonical authority could be
  // withdrawn. That was caught by its own negative control and is recorded in
  // the slice evidence. Both spellings are accepted so the guard cannot be
  // silently disarmed again by a vocabulary change in one direction.
  const PROMOTED_ACTIONS = new Set(["Promoted", "Promote"]);
  const rows = (await db
    .prepare("SELECT id, action, canonical_entity_id FROM knowledge_promotions WHERE knowledge_fact_id=? ORDER BY created_at")
    .bind(id)
    .all()).results || [];
  const reversed = new Set(
    ((await db
      .prepare("SELECT id, canonical_entity_id FROM knowledge_promotions WHERE action='Reversed'")
      .all()).results || []).map((r) => clean(r.canonical_entity_id)),
  );
  return rows
    .filter((r) => PROMOTED_ACTIONS.has(clean(r.action)))
    .filter((r) => !reversed.has(clean(r.canonical_entity_id)))
    .map((r) => ({ id: clean(r.id), action: clean(r.action), canonicalEntityId: clean(r.canonical_entity_id) }));
};

/**
 * Perform the governed withdrawal.
 *
 * The guarded UPDATE is the concurrency check: `review_status='Reviewed'` in the
 * WHERE clause means a concurrent withdrawal matches zero rows, and the audit
 * INSERT must not fire on a decision that did not happen.
 */
export const withdrawKnowledgeFact = async (
  db,
  {
    organizationId,
    factId,
    reason,
    humanActor,
    actorRole = null,
    idempotencyKey,
    eventId,
  } = {},
) => {
  const org = clean(organizationId);
  const id = clean(factId);
  const key = clean(idempotencyKey);
  if (!id) return error(FACT_WITHDRAWAL_ERRORS.FACT_REQUIRED, "A fact id is required.");
  if (!org) return error(FACT_WITHDRAWAL_ERRORS.FACT_REQUIRED, "An organization is required.");

  if (!key) {
    return error(
      FACT_WITHDRAWAL_ERRORS.IDEMPOTENCY_KEY_REQUIRED,
      "Provide an idempotency key: retracting a human decision must be replay-safe.",
    );
  }

  // Idempotency first, keyed on the event stream this module writes.
  const priorEvent = await db
    .prepare("SELECT * FROM knowledge_file_events WHERE event_type=? AND json_extract(details,'$.idempotencyKey')=?")
    .bind(WITHDRAWAL_EVENT_TYPE, key)
    .first();
  if (priorEvent) {
    return {
      ok: true,
      idempotent: true,
      factId: id,
      eventId: clean(priorEvent.id),
      outcome: "Rejected",
      message: "This exact withdrawal was already recorded; nothing was written again.",
    };
  }

  const fact = await db
    .prepare("SELECT id, knowledge_file_id, review_status, fact_type, original_value, attributes FROM knowledge_facts WHERE id=? AND organization_id=?")
    .bind(id, org)
    .first();
  if (!fact) return error(FACT_WITHDRAWAL_ERRORS.FACT_NOT_FOUND, "Knowledge fact not found.");

  const activePromotions = await activePromotionsForFact(db, id);
  const assessment = assessFactWithdrawal({ fact, activePromotions, humanActor, reason });
  if (!assessment.ok) return assessment;

  const applied = await db
    .prepare(
      "UPDATE knowledge_facts SET review_status='Rejected' WHERE id=? AND organization_id=? AND review_status='Reviewed'",
    )
    .bind(id, org)
    .run();
  if (Number(applied?.meta?.changes ?? 0) !== 1) {
    return error(
      FACT_WITHDRAWAL_ERRORS.NOT_WITHDRAWN,
      "This fact was not in the Reviewed state when the withdrawal was applied; nothing was written.",
    );
  }

  const details = {
    itemKind: "Knowledge Fact",
    itemId: id,
    factType: clean(fact.fact_type),
    originalValue: clean(fact.original_value),
    partNumber: assessment.partNumber,
    action: "Withdrawn",
    previousStatus: "Reviewed",
    newStatus: "Rejected",
    reason: assessment.reason,
    actorId: clean(humanActor?.id),
    actorName: clean(humanActor?.name),
    humanActorSource: clean(humanActor?.source),
    actorRole: clean(actorRole),
    authorityVersion: KNOWLEDGE_FACT_WITHDRAWAL_VERSION,
    // The probe's own metadata is RETAINED, not scrubbed: its usefulness as a
    // conflict-guard regression input depends on it staying readable.
    retainedMetadata: true,
    evidenceRetained: true,
    idempotencyKey: key,
    withdrawnPromotions: activePromotions.map((p) => p.id),
  };

  await db
    .prepare(
      "INSERT INTO knowledge_file_events (id,organization_id,knowledge_file_id,event_type,details,actor_user_id) VALUES (?,?,?,?,?,?)",
    )
    .bind(
      clean(eventId) || `knowledgeEvent_withdraw_${crypto.randomUUID().replaceAll("-", "")}`,
      org,
      clean(fact.knowledge_file_id),
      WITHDRAWAL_EVENT_TYPE,
      JSON.stringify(details),
      clean(humanActor?.id),
    )
    .run();

  return {
    ok: true,
    idempotent: false,
    factId: id,
    factType: clean(fact.fact_type),
    partNumber: assessment.partNumber,
    previousStatus: "Reviewed",
    outcome: "Rejected",
    message: "The observation is withdrawn. The fact row, its source location and its original metadata are retained; only its review state changed.",
  };
};