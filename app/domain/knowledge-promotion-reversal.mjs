// GOVERNED REVERSAL OF A KNOWLEDGE PROMOTION.
//
// WHY THIS EXISTS
// A promotion mints canonical truth from a reviewed Knowledge fact. Until this
// module existed there was no way to withdraw that truth, so a promotion that
// turned out to be wrong was permanent: the only corrections available were a
// direct canonical write (unaudited, prohibited) or leaving bad canonical data in
// place and hoping a later review overwrote it. Both are worse than a governed
// reversal, and the absence is why a defective promotion had to be reported
// rather than corrected.
//
// WHERE THE AUDIT LIVES, AND WHY NOT IN `knowledge_promotions`
// `knowledge_promotions` is the wrong table for a reversal, structurally:
//   - `action` carries CHECK(action IN ('Promoted','Evidence Only')), so a
//     'Reversed' row cannot be written;
//   - UNIQUE(organization_id, knowledge_fact_id) permits exactly ONE promotion
//     row per fact, so a second row for the same fact cannot be written either.
// It is an append-only record of PROMOTIONS and must stay exactly that: it is the
// evidence that the promotion happened, and reversing must never erase or edit
// it. This module therefore leaves it untouched and writes the reversal to
// `knowledge_file_events`, the Knowledge library's existing audit stream, which
// is FK-free on the payload, carries an unconstrained `event_type`, and already
// holds every other Knowledge governance decision.
//
// THE SAFETY RULE THAT MAKES REVERSAL TRUSTWORTHY
// Reversal is only safe when it can prove it is undoing exactly one promotion and
// nothing else. Three things are therefore verified before any write:
//   1. the promotion exists and is not already reversed;
//   2. the canonical row it created still EXISTS and still carries the values the
//      promotion recorded -- if another governed decision has since changed it,
//      reversal fails closed rather than clobbering that decision;
//   3. the Knowledge fact itself is preserved and untouched.
//
// Canonical state is REMOVED, never silently rewritten, and the removal is
// recorded in the same transaction as the audit row.

import { isHumanDecisionActor } from "./human-authority.mjs";

export const KNOWLEDGE_PROMOTION_REVERSAL_VERSION = "knowledge-promotion-reversal-1.0.0";

export const PROMOTION_REVERSAL_EVENT_TYPE = "Knowledge Promotion Reversed";

export const PROMOTION_REVERSAL_ERRORS = Object.freeze({
  PROMOTION_REQUIRED: "PROMOTION_NOT_FOUND",
  ALREADY_REVERSED: "PROMOTION_ALREADY_REVERSED",
  HUMAN_ACTOR_REQUIRED: "PROMOTION_REVERSAL_HUMAN_ACTOR_REQUIRED",
  REASON_REQUIRED: "PROMOTION_REVERSAL_REASON_REQUIRED",
  IDEMPOTENCY_KEY_REQUIRED: "PROMOTION_REVERSAL_IDEMPOTENCY_KEY_REQUIRED",
  IDEMPOTENCY_KEY_REUSED: "PROMOTION_REVERSAL_IDEMPOTENCY_KEY_REUSED",
  CANONICAL_ROW_MISSING: "PROMOTION_REVERSAL_CANONICAL_ROW_MISSING",
  CANONICAL_ROW_CHANGED: "PROMOTION_REVERSAL_CANONICAL_ROW_CHANGED",
  DESTINATION_UNSUPPORTED: "PROMOTION_REVERSAL_DESTINATION_UNSUPPORTED",
});

// Longer than a routine promotion reason: withdrawing canonical truth is a more
// consequential act than creating it, because downstream consumers may already
// have read it.
const MIN_REASON_CHARS = 40;

const clean = (value) => String(value ?? "").trim();
const parseJson = (value, fallback) => {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};
const error = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

// Which table each promoted entity type lives in, and the columns that identify
// the row uniquely enough to prove it is still the row this promotion made.
//
// This map is the whole reversal surface. A canonical entity type absent from it
// is refused rather than guessed at: reversing a destination whose provenance
// contract is unknown is how a reversal deletes the wrong row.
// Which table each promoted entity type lives in, and how the canonical ROW's
// columns map onto the KEYS the promotion actually recorded in
// `new_snapshot_json`.
//
// The explicit mapping matters: `new_snapshot_json` is camelCase
// (`productId`, `normalizedValue`, `attributeName`) while the table columns are
// snake_case. Guessing the correspondence -- rather than declaring it -- made
// this check compare `row.product_id` against a snapshot that has no such key,
// so every genuine reversal was refused as "the row has changed". A drift check
// that always fires is worse than none: it trains an operator to treat a real
// stale-state refusal as routine.
const REVERSIBLE_DESTINATIONS = Object.freeze({
  "Product Attribute": Object.freeze({
    table: "product_attributes",
    // [canonical row column, key in new_snapshot_json]
    identityColumns: Object.freeze([
      Object.freeze(["product_id", "productId"]),
      Object.freeze(["attribute_name", "attributeName"]),
      Object.freeze(["normalized_value", "normalizedValue"]),
    ]),
    label: "attribute",
  }),
  "Product Lifecycle Event": Object.freeze({
    table: "product_lifecycle_events",
    identityColumns: Object.freeze([
      Object.freeze(["product_id", "productId"]),
      // A lifecycle event's promoted value is its status.
      Object.freeze(["lifecycle_status", "normalizedValue"]),
    ]),
    label: "lifecycle event",
  }),
  "Engineering Relationship": Object.freeze({
    table: "engineering_relationships",
    identityColumns: Object.freeze([
      Object.freeze(["left_entity_id", "leftEntityId"]),
      Object.freeze(["relationship_type", "relationshipType"]),
      Object.freeze(["right_entity_id", "rightEntityId"]),
    ]),
    label: "relationship",
  }),
});

/**
 * Pure validation of a reversal request. Kept pure so the governance rules are
 * testable without a database and so a route can never be the only place a rule
 * is enforced.
 *
 * The human check is FIRST: this removes canonical truth, which is the single
 * most consequential act in the Knowledge pipeline.
 */
export const assessKnowledgePromotionReversal = ({
  promotion,
  decision,
  reason,
  humanActor,
} = {}) => {
  if (!isHumanDecisionActor(humanActor)) {
    return error(
      PROMOTION_REVERSAL_ERRORS.HUMAN_ACTOR_REQUIRED,
      "A promotion reversal must be made by a configured human decision-maker.",
    );
  }
  if (!promotion) {
    return error(PROMOTION_REVERSAL_ERRORS.PROMOTION_REQUIRED, "A promotion is required.");
  }
  if (clean(decision) !== "Reversed") {
    return error(
      PROMOTION_REVERSAL_ERRORS.DESTINATION_UNSUPPORTED,
      'The only supported reversal decision is "Reversed".',
    );
  }
  const destination = REVERSIBLE_DESTINATIONS[clean(promotion.canonical_entity_type)];
  if (!destination) {
    return error(
      PROMOTION_REVERSAL_ERRORS.DESTINATION_UNSUPPORTED,
      `No governed reversal exists for canonical entity type "${clean(promotion.canonical_entity_type)}".`,
      { canonicalEntityType: clean(promotion.canonical_entity_type), reversibleTypes: Object.keys(REVERSIBLE_DESTINATIONS) },
    );
  }
  const why = clean(reason);
  if (why.length < MIN_REASON_CHARS) {
    return error(
      PROMOTION_REVERSAL_ERRORS.REASON_REQUIRED,
      `Provide a substantive reversal reason of at least ${MIN_REASON_CHARS} characters.`,
    );
  }
  return {
    ok: true,
    value: {
      outcome: "Reversed",
      reason: why,
      decidedBy: humanActor.id,
      decidedByName: clean(humanActor.name),
      humanActorSource: clean(humanActor.source),
      destination: destination.label,
      authorityVersion: KNOWLEDGE_PROMOTION_REVERSAL_VERSION,
    },
  };
};

// Compare the canonical row's identifying columns against what the promotion
// recorded. Any difference means another governed decision has since written to
// this row, and reversal must refuse rather than remove someone else's work.
//
// A snapshot missing a key we are asked to verify is treated as UNVERIFIABLE
// rather than as "no change": silently skipping the check would let a reversal
// remove a row it could not prove it owns.
const canonicalDrift = (row, snapshot, destination) => {
  if (!row) return "CANONICAL_ROW_MISSING";
  const recorded = snapshot && typeof snapshot === "object" ? snapshot : null;
  if (!recorded) return "CANONICAL_SNAPSHOT_UNREADABLE";
  for (const [column, snapshotKey] of destination.identityColumns) {
    if (!Object.prototype.hasOwnProperty.call(recorded, snapshotKey)) {
      return `CANONICAL_SNAPSHOT_UNREADABLE:${snapshotKey}`;
    }
    const now = row[column] ?? null;
    const then = recorded[snapshotKey] ?? null;
    if (String(now ?? "") !== String(then ?? "")) {
      return `CANONICAL_ROW_CHANGED:${column}`;
    }
  }
  return null;
};

/**
 * Reverse ONE promotion, governed, verified and idempotently.
 *
 * Returns `{ ok: true, idempotent: true }` when the same idempotency key has
 * already been used, writing nothing.
 */
export const reverseKnowledgePromotion = async (
  db,
  {
    promotionId,
    decision = "Reversed",
    reason,
    evidence = null,
    humanActor,
    actorRole = null,
    idempotencyKey = null,
    newId = null,
    now = new Date().toISOString(),
  } = {},
) => {
  const id = clean(promotionId);
  if (!id) return error(PROMOTION_REVERSAL_ERRORS.PROMOTION_REQUIRED, "A promotion id is required.");

  const key = clean(idempotencyKey);
  if (!key) {
    return error(
      PROMOTION_REVERSAL_ERRORS.IDEMPOTENCY_KEY_REQUIRED,
      "Provide an idempotency key: withdrawing canonical truth must be replay-safe.",
    );
  }

  // Idempotency first, keyed on the event stream this module writes.
  const priorEvent = await db
    .prepare("SELECT * FROM knowledge_file_events WHERE event_type=? AND json_extract(details,'$.idempotencyKey')=?")
    .bind(PROMOTION_REVERSAL_EVENT_TYPE, key)
    .first();
  if (priorEvent) {
    const priorDetails = parseJson(priorEvent.details, {});
    return {
      ok: true,
      idempotent: true,
      eventId: priorEvent.id,
      promotionId: id,
      // Echoed so a caller can confirm the replay concerns the promotion it
      // thinks it does, without re-reading the event row.
      canonicalEntityId: clean(priorDetails.canonicalEntityId) || null,
      outcome: "Reversed",
      previousEventId: priorEvent.id,
      message: "This exact promotion reversal was already recorded; nothing was written again.",
    };
  }

  const promotion = await db.prepare("SELECT * FROM knowledge_promotions WHERE id=?").bind(id).first();
  if (!promotion) {
    return error(PROMOTION_REVERSAL_ERRORS.PROMOTION_REQUIRED, "Unknown promotion.");
  }

  // A promotion that recorded no canonical change ("Evidence Only") has nothing
  // to remove, so it is refused rather than "reversed" as a no-op.
  if (clean(promotion.action) !== "Promoted") {
    return error(
      PROMOTION_REVERSAL_ERRORS.DESTINATION_UNSUPPORTED,
      `Promotion action is "${clean(promotion.action)}", which wrote no canonical state to reverse.`,
      { action: clean(promotion.action) },
    );
  }

  // A second reversal under a DIFFERENT key must also be refused: the canonical
  // row is already gone, and reporting success would double-count a withdrawal.
  const existingReversal = await db
    .prepare("SELECT id FROM knowledge_file_events WHERE event_type=? AND json_extract(details,'$.promotionId')=?")
    .bind(PROMOTION_REVERSAL_EVENT_TYPE, id)
    .first();
  if (existingReversal) {
    return {
      ok: true,
      idempotent: true,
      alreadyReversed: true,
      eventId: existingReversal.id,
      promotionId: id,
      outcome: "Reversed",
      message: "This promotion was already reversed under an earlier idempotency key; nothing was written again.",
    };
  }

  const assessed = assessKnowledgePromotionReversal({ promotion, decision, reason, humanActor });
  if (!assessed.ok) return assessed;
  const value = assessed.value;

  const destination = REVERSIBLE_DESTINATIONS[clean(promotion.canonical_entity_type)];
  const entityId = clean(promotion.canonical_entity_id);
  const snapshot = parseJson(promotion.new_snapshot_json, {});

  const current = await db
    .prepare(`SELECT * FROM ${destination.table} WHERE id=?`)
    .bind(entityId)
    .first();

  const drift = canonicalDrift(current, snapshot, destination);
  if (drift) {
    // Fail closed, and distinguish the three cases. "The row vanished", "the row
    // now holds someone else's value" and "the promotion recorded too little to
    // verify" need different operator responses, so they are reported
    // differently rather than collapsed into one refusal.
    const missing = drift === "CANONICAL_ROW_MISSING";
    const unverifiable = drift.startsWith("CANONICAL_SNAPSHOT_UNREADABLE");
    return error(
      missing
        ? PROMOTION_REVERSAL_ERRORS.CANONICAL_ROW_MISSING
        : PROMOTION_REVERSAL_ERRORS.CANONICAL_ROW_CHANGED,
      missing
        ? "The canonical row this promotion created no longer exists; there is nothing left to reverse."
        : unverifiable
          ? `The promotion did not record enough to verify the canonical row is unchanged (${drift.split(":")[1] ?? drift}); refusing rather than removing a row it cannot prove it owns.`
          : `The canonical row has been changed since the promotion (${drift.split(":")[1]}); refusing to remove another decision's work.`,
      { drift, table: destination.table, entityId },
    );
  }

  const beforeSnapshot = { table: destination.table, row: current };

  // The Knowledge fact is explicitly NOT touched: the observation remains true
  // and reviewable. Only the canonical projection of it is withdrawn.
  const statements = [
    db.prepare(`DELETE FROM ${destination.table} WHERE id=?`).bind(entityId),
  ];

  const eventId = newId ? await newId("knowledgeEvent") : `knowledgeEvent_${Math.random().toString(16).slice(2)}`;

  statements.push(
    db
      .prepare(
        "INSERT INTO knowledge_file_events (id,organization_id,knowledge_file_id,event_type,details,actor_user_id) VALUES (?,?,?,?,?,?)",
      )
      .bind(
        eventId,
        promotion.organization_id,
        promotion.knowledge_file_id,
        PROMOTION_REVERSAL_EVENT_TYPE,
        JSON.stringify({
          packetKind: "promotion-reversal",
          promotionId: id,
          promotionAction: clean(promotion.action),
          knowledgeFactId: promotion.knowledge_fact_id,
          canonicalEntityType: clean(promotion.canonical_entity_type),
          canonicalEntityId: entityId,
          canonicalProductId: promotion.canonical_product_id,
          destination: destination.label,
          // The removed row is preserved in full inside the audit event, so the
          // reversal is fully reconstructible rather than a bare deletion.
          removedCanonicalRow: beforeSnapshot,
          previousSnapshot: parseJson(promotion.previous_snapshot_json, {}),
          promotedSnapshot: snapshot,
          outcome: "Reversed",
          reason: value.reason,
          decidedBy: value.decidedBy,
          decidedByName: value.decidedByName,
          humanActorSource: value.humanActorSource,
          actorRole: clean(actorRole),
          supportingEvidence: evidence,
          knowledgeFactPreserved: true,
          authorityVersion: value.authorityVersion,
          idempotencyKey: key,
          reversedAt: now,
        }),
        value.decidedBy,
      ),
  );

  try {
    await db.batch(statements);
  } catch (cause) {
    return error(
      PROMOTION_REVERSAL_ERRORS.CANONICAL_ROW_CHANGED,
      "The canonical row changed while the reversal was being committed; nothing was written.",
      { cause: String(cause?.message || cause) },
    );
  }

  return {
    ok: true,
    idempotent: false,
    eventId,
    promotionId: id,
    outcome: "Reversed",
    knowledgeFactId: promotion.knowledge_fact_id,
    canonicalEntityType: clean(promotion.canonical_entity_type),
    canonicalEntityId: entityId,
    destination: destination.label,
    removedCanonicalRow: beforeSnapshot,
    knowledgeFactPreserved: true,
    message:
      "Promotion reversed. The canonical row this promotion created was removed, the Knowledge observation is preserved, and the removal is recorded in full.",
  };
};
