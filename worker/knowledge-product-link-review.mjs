// KN-DECISION-1 -- the two governed Knowledge write primitives that a manual
// review and a decision packet both need, factored out of the HTTP layer.
//
// WHY THIS FILE EXISTS. `POST /api/knowledge/review/{file|fact}/:id` and
// `POST /api/knowledge/link/fact/:id` each carried their SQL inline in the
// route. That was fine while a human performed each step by hand in the UI. It
// stops being fine the moment a decision packet has to perform the same
// governed sequence in one transaction: re-implementing those statements in a
// new orchestrator would create a second, drifting copy of the review and link
// rules, and the copy is exactly where an unguarded trust elevation would hide.
//
// So the statements move here, unchanged, and BOTH the routes and the packet
// orchestrator call them. One implementation, two callers. The rules preserved
// verbatim:
//
//   * a fact review is only legal from `Needs Review` or `Learned` -- a fact
//     that already carries a decision cannot be silently re-decided;
//   * a link asserts canonical identity, so the fact must be a `Part Number`
//     fact, must itself be `Reviewed`, the product must be visible in scope,
//     and identity is proven on the punctuation-preserving comparison form
//     (stripping would merge genuinely distinct variants);
//   * exactly one visible non-superseded product may carry the part number, or
//     the answer is AMBIGUOUS_TARGET rather than an arbitrary pick;
//   * an existing link to the same product is idempotent success; to a
//     different product it is a conflict, never an overwrite.
//
// Every mutation writes a `knowledge_file_events` audit row naming the human.

import { canonicalScopeVisible } from "./knowledge-product-resolver-runtime.mjs";
import {
  comparisonPartNumber,
  searchPartNumberKey,
} from "../app/domain/knowledge-product-identity-resolver.mjs";
import { MIN_GOVERNED_REASON_LENGTH } from "../app/domain/reason-governance.mjs";

const clean = (value) => String(value ?? "").trim();
const failure = (httpStatus, code, message, extra = {}) => ({
  ok: false,
  httpStatus,
  code,
  message,
  ...extra,
});

export const KNOWLEDGE_REVIEW_DECISION_EVENT_TYPE = "Knowledge Review Decision";
export const KNOWLEDGE_LINK_DECISION_EVENT_TYPE = "Knowledge Product Link Decision";

/**
 * States a human review may act on. Anything else is already decided.
 *
 * KN-SCALE-2: BOTH machine states are reviewable, and that is deliberate.
 * "Needs Review" is a low-confidence extraction; "Learned" is a confidently
 * extracted observation that still carries no human decision. Restricting review
 * to "Needs Review" meant a researched fact authored with high confidence could
 * never be human-reviewed at all, while the deterministic promotion path promoted
 * exactly those states without review. Both states are the same gate: a human
 * decision must be possible on each, and each still requires a configured human
 * identity and a substantive reason.
 */
export const REVIEWABLE_STATES = Object.freeze(["Needs Review", "Learned"]);

export const confirmKnowledgeFactReview = async (
  db,
  {
    organizationId,
    itemId,
    kind = "fact",
    action,
    reason,
    humanActor,
    actorPermission = null,
    eventId,
    stamp = () => new Date().toISOString(),
  } = {},
) => {
  const org = clean(organizationId);
  const id = clean(itemId);
  const normalizedAction = clean(action).toLowerCase();
  const cleanReason = clean(reason);

  if (!["confirm", "reject"].includes(normalizedAction)) {
    return failure(422, "KNOWLEDGE_REVIEW_ACTION_INVALID", "Choose Confirm or Reject.");
  }
  if (cleanReason.length < MIN_GOVERNED_REASON_LENGTH) {
    return failure(422, "KNOWLEDGE_REVIEW_REASON_REQUIRED", "Provide a clear review reason.");
  }

  const item = kind === "file"
    ? await db
        .prepare(
          "SELECT id,classification_status review_status,detected_type,summary FROM knowledge_files WHERE id=? AND organization_id=?",
        )
        .bind(id, org)
        .first()
    : await db
        .prepare(
          "SELECT id,knowledge_file_id,review_status,fact_type,original_value FROM knowledge_facts WHERE id=? AND organization_id=?",
        )
        .bind(id, org)
        .first();

  if (!item) {
    return failure(404, "KNOWLEDGE_REVIEW_ITEM_NOT_FOUND", "This review item is unavailable.");
  }
  if (!REVIEWABLE_STATES.includes(item.review_status)) {
    return failure(409, "KNOWLEDGE_REVIEW_ALREADY_DECIDED", "This item has already been reviewed.");
  }

  const nextStatus = normalizedAction === "confirm" ? "Reviewed" : "Rejected";
  const fileId = kind === "file" ? item.id : item.knowledge_file_id;
  const details = {
    itemKind: kind === "file" ? "File Classification" : "Knowledge Fact",
    itemId: id,
    action: normalizedAction === "confirm" ? "Confirmed" : "Rejected",
    previousStatus: item.review_status,
    newStatus: nextStatus,
    reason: cleanReason,
    actorPermission,
    decidedBy: clean(humanActor?.id),
    decidedByName: clean(humanActor?.name),
    humanActorSource: clean(humanActor?.source),
  };

  // The guarded UPDATE is the concurrency check: if a concurrent review landed
  // first it matches zero rows, and the audit INSERT must not fire on a
  // decision that did not happen.
  const update = kind === "file"
    ? db
        .prepare(
          "UPDATE knowledge_files SET classification_status=? WHERE id=? AND organization_id=? AND classification_status IN ('Needs Review','Classified')",
        )
        .bind(nextStatus, id, org)
    : db
        .prepare(
          "UPDATE knowledge_facts SET review_status=? WHERE id=? AND organization_id=? AND review_status IN ('Needs Review','Learned')",
        )
        .bind(nextStatus, id, org);

  const applied = await update.run();
  if (Number(applied?.meta?.changes ?? 0) !== 1) {
    return failure(409, "KNOWLEDGE_REVIEW_ALREADY_DECIDED", "This item has already been reviewed.");
  }
  await db
    .prepare(
      "INSERT INTO knowledge_file_events (id,organization_id,knowledge_file_id,event_type,details,actor_user_id) VALUES (?,?,?,?,?,?)",
    )
    .bind(
      eventId,
      org,
      fileId,
      KNOWLEDGE_REVIEW_DECISION_EVENT_TYPE,
      JSON.stringify(details),
      clean(humanActor?.id),
    )
    .run();

  return {
    ok: true,
    itemId: id,
    kind,
    status: nextStatus,
    action: details.action,
    previousStatus: item.review_status,
    fileId,
  };
};

/**
 * Assert that a document part number IS a canonical product. Identity-affecting
 * and therefore Library Manager + configured-human + substantive reason.
 */
export const linkKnowledgeFactToProduct = async (
  db,
  {
    organizationId,
    factId,
    productId,
    reason,
    humanActor,
    actorPermission = null,
    linkId,
    eventId,
    stamp = () => new Date().toISOString(),
  } = {},
) => {
  const org = clean(organizationId);
  const id = clean(factId);
  const cleanReason = clean(reason);
  const targetProductId = clean(productId);

  if (!cleanReason) {
    return failure(422, "REASON_REQUIRED", "A substantive reason is required.");
  }
  if (cleanReason.length < MIN_GOVERNED_REASON_LENGTH) {
    return failure(422, "REASON_REASON_REQUIRED", "Provide a substantive reason.");
  }
  if (!targetProductId) {
    return failure(422, "PRODUCT_ID_REQUIRED", "Product ID is required.");
  }

  const fact = await db
    .prepare("SELECT * FROM knowledge_facts WHERE id=? AND organization_id=?")
    .bind(id, org)
    .first();
  if (!fact) {
    return failure(404, "KNOWLEDGE_FACT_NOT_FOUND", "Knowledge fact not found.");
  }
  if (fact.fact_type !== "Part Number") {
    return failure(400, "KNOWLEDGE_FACT_WRONG_TYPE", 'Fact type must be "Part Number".');
  }
  if (fact.review_status !== "Reviewed") {
    return failure(400, "KNOWLEDGE_FACT_NOT_REVIEWED", "Fact must be reviewed.");
  }

  const candidate = await db
    .prepare("SELECT * FROM library_products WHERE id=? LIMIT 1")
    .bind(targetProductId)
    .first();
  const product = candidate && canonicalScopeVisible(candidate, org, []) ? candidate : null;
  if (!product) {
    return failure(404, "PRODUCT_NOT_FOUND", "Product not found.");
  }

  const comparisonProductPartNumber = comparisonPartNumber(product.part_number);
  const comparisonFactPartNumber = comparisonPartNumber(fact.normalized_value);
  if (comparisonProductPartNumber !== comparisonFactPartNumber) {
    return failure(
      400,
      "PART_NUMBER_MISMATCH",
      "Product part number does not match fact part number.",
    );
  }

  const searchFactPartNumber = searchPartNumberKey(fact.normalized_value);
  const ambiguityCheck = await db
    .prepare(
      "SELECT COUNT(DISTINCT p.id) as count FROM library_products p WHERE (UPPER(p.normalized_part_number) = ? OR UPPER(REPLACE(p.normalized_part_number, '-', '')) = ?) AND p.superseded_by_product_id IS NULL AND (p.library_scope = 'Global Library' OR (p.library_scope = 'Organization Library' AND p.organization_id = ?))",
    )
    .bind(comparisonFactPartNumber, searchFactPartNumber, org)
    .first();
  if (Number(ambiguityCheck?.count) !== 1) {
    return failure(409, "AMBIGUOUS_TARGET", "Ambiguous product target for part number.");
  }

  const existingLink = await db
    .prepare("SELECT * FROM knowledge_product_links WHERE knowledge_fact_id=?")
    .bind(id)
    .first();
  if (existingLink) {
    if (existingLink.existing_product_id === product.id) {
      return {
        ok: true,
        itemId: id,
        kind: "fact",
        status: "Linked",
        action: "Linked",
        idempotent: true,
        linkId: existingLink.id,
        productId: product.id,
      };
    }
    return failure(409, "EXISTING_LINK_CONFLICT", "Existing link points to a different product.");
  }

  await db.batch([
    db
      .prepare(
        "INSERT INTO knowledge_product_links (id, organization_id, knowledge_fact_id, part_number, existing_product_id, link_state, new_information, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(linkId, org, id, fact.original_value, product.id, "Existing Product — Additive Learning Only", "{}", stamp()),
    db
      .prepare(
        "INSERT INTO knowledge_file_events (id,organization_id,knowledge_file_id,event_type,details,actor_user_id) VALUES (?,?,?,?,?,?)",
      )
      .bind(
        eventId,
        org,
        fact.knowledge_file_id,
        KNOWLEDGE_LINK_DECISION_EVENT_TYPE,
        JSON.stringify({
          factId: id,
          productId: product.id,
          reason: cleanReason,
          actorId: clean(humanActor?.id),
          actorName: clean(humanActor?.name),
          actorRole: actorPermission,
          humanActorSource: clean(humanActor?.source),
        }),
        clean(humanActor?.id),
      ),
  ]);

  return {
    ok: true,
    itemId: id,
    kind: "fact",
    status: "Linked",
    action: "Linked",
    linkId,
    productId: product.id,
  };
};
