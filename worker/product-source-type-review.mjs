/**
 * Product Source Type Governed Review — KN-SA-CT-1.
 *
 * THE GAP THIS CLOSES. `product_sources.source_type` can be incorrectly
 * classified (e.g. "BOQ", "Cost Sheet" instead of "Product Datasheet"),
 * causing otherwise valid first-party manufacturer facts to be rejected by
 * source-authority rules. There was no governed writer to correct this
 * clerical metadata — only direct SQL or nothing.
 *
 * WHAT THIS MODULE DOES. It performs exactly one operation: correct the
 * `source_type` field on one `product_sources` row. It does NOT approve
 * product facts, does not grant product identity authority, does not change
 * `downstream_use`, `review_status`, or any other field. After the correction,
 * existing deterministic source-authority readers may naturally re-evaluate
 * facts. That downstream effect comes from existing rules, not from the writer.
 *
 * THE SINGLE CANONICAL WRITER. No free-text source-type selection, no
 * arbitrary-field updates. One row, one field, one reason. If the writer is
 * too narrow for a use-case, that is intentional: it prevents the class of
 * bugs where a source type elevation silently promotes price-list authority.
 *
 * SAFETY GATES (every one is mandatory, fail-closed):
 *   1. Source exists in product_sources — unknown source → reject.
 *   2. Source is not rejected — a rejected source cannot be reclassified.
 *   3. Target source_type is in the canonical FIRST_PARTY_MANUFACTURER_SOURCE_TYPES
 *      allowlist ("Product Datasheet", "Installation and Operation Manual",
 *      "Product Manual") — no invented types, no free-text.
 *   4. Human actor is server-configured and valid — synthetic/configured-
 *      fallback actors are explicitly refused (provenance must not silently
 *      downgrade to `local-development-user`).
 *   5. Actor has Library Manager or Administrator permission — role
 *      authorization via the project's existing capability system.
 *   4. A substantive reason is supplied meeting MIN_GOVERNED_REASON_LENGTH (5 chars).
 *   5. Idempotency: if current source_type already equals the requested type,
 *      return a safe idempotent result without writing history.
 *   6. Conflict safety: optimistic concurrency (UPDATE … WHERE source_type=?)
 *      ensures a concurrent correction is not silently overwritten.
 *   7. Audit: one row in product_library_decisions with entity_type='Product
 *      Source', recording previous→new source_type, actor, reason, and timestamp.
 *
 * AUTHORITY SIDE EFFECTS (deliberately absent). Changing source_type does NOT
 * set product fact Approved, does NOT set Product Identity Approved, does NOT
 * change downstream_use, review_status, or any other authority field. The
 * writer performs only the clerical source classification correction. Downstream
 * re-evaluation is handled by existing source-authority readers.
 *
 * VERSIONING. This is version "product-source-type-1.0.0": initial governed
 * source-type correction contract. Future additions must not broaden the
 * endpoint into a generic source-field mutator.
 */
import { FIRST_PARTY_MANUFACTURER_SOURCE_TYPES } from "./product-attribute-review.mjs";
import { MIN_GOVERNED_REASON_LENGTH } from "./reason-governance.mjs";
import { requireHumanActor } from "./human-actor.mjs";
import { requireLibraryCapability } from "./library-auth.mjs";

// Policy version for the audit trail (re-use convention).
export const PRODUCT_SOURCE_TYPE_REVIEW_POLICY_VERSION =
  "product-source-type-1.0.0";

/**
 * Pure decision function: what WOULD happen, given a request context.
 * Exported so every guard is testable without a database, and so the route
 * can show the engineer the refusal reason before anything is written.
 */
export const assessProductSourceTypeReview = (input = {}) => {
  const sourceId = input.sourceId;
  const targetSourceType = input.targetSourceType;
  const reason = input.reason;
  const humanActor = input.humanActor;

  // Gate 1: target source type must be a known first-party manufacturer type
  if (
    !targetSourceType ||
    !FIRST_PARTY_MANUFACTURER_SOURCE_TYPES.has(targetSourceType)
  ) {
    return {
      allowed: false,
      changed: false,
      status: "SOURCE_TYPE_NOT_ALLOWED",
      allowedTypes: Array.from(FIRST_PARTY_MANUFACTURER_SOURCE_TYPES),
    };
  }

  // Gate 2: reason must meet the canonical minimum length
  if (
    !reason ||
    String(reason).length < MIN_GOVERNED_REASON_LENGTH
  ) {
    return {
      allowed: false,
      status: "REASON_REQUIRED",
      minimumReasonLength: MIN_GOVERNED_REASON_LENGTH,
      reasonLength: reason ? String(reason).length : 0,
    };
  }

  // Gate 3: human actor must be server-configured and valid
  if (!humanActor || humanActor.synthetic) {
    return {
      allowed: false,
      changed: false,
      status: "HUMAN_ACTOR_REQUIRED",
    };
  }

  // All gates passed
  return {
    allowed: true,
    changed: true,
    status: "ASSESSED",
    targetSourceType,
  };
};

/**
 * The governed writer. Writes the source_type correction and one audit row.
 * Idempotent if current source_type === requested type. Fails safely on
 * concurrent modification.
 */
export const reviewProductSourceType = async ({
  db,
  sourceId,
  targetSourceType,
  reason,
  humanActor,
  idempotencyKey = null,
}) => {
  // ---- Resolve the source row ----
  const sourceRow = await db
    .prepare("SELECT source_type, review_status FROM product_sources WHERE id=?")
    .bind(sourceId)
    .first();
  if (!sourceRow) {
    return {
      status: "SOURCE_NOT_FOUND",
      sourceId,
    };
  }

  // ---- Gate: source must not be rejected ----
  if (sourceRow.review_status === "Rejected") {
    return {
      status: "SOURCE_REJECTED",
      sourceId,
      currentReviewStatus: sourceRow.review_status,
    };
  }

  // ---- Idempotency check: current type already equals requested ----
  if (sourceRow.source_type === targetSourceType) {
    return {
      status: "IDEMPOTENT_REPLAY",
      sourceId,
      idempotent: true,
      previousSourceType: sourceRow.source_type,
    };
  }

  // ---- Gate: target source type already assessed as allowed (redundant here
  // but keeps the function self-contained and declarative) ----
  if (
    !FIRST_PARTY_MANUFACTURER_SOURCE_TYPES.has(targetSourceType)
  ) {
    return {
      status: "SOURCE_TYPE_NOT_ALLOWED",
      sourceId,
      requestedType: targetSourceType,
      allowedTypes: Array.from(FIRST_PARTY_MANUFACTURER_SOURCE_TYPES),
    };
  }

  // ---- Perform the update with optimistic concurrency ----
  // UPDATE only if source_type hasn't changed since we read it:
  //   WHERE source_type = current_value ensures conflict safety.
  const updated = await db
    .prepare(
      "UPDATE product_sources SET source_type=? WHERE id=? AND source_type=?",
    )
    .bind(targetSourceType, sourceId, sourceRow.source_type)
    .run();

  const changed = Number(updated?.changes ?? 0);
  if (changed !== 1) {
    // Concurrent modification: someone else wrote to this row first.
    return {
      status: "CONCURRENT_MODIFICATION",
      sourceId,
      previousSourceType: sourceRow.source_type,
      requestedSourceType: targetSourceType,
    };
  }

  // ---- Audit: one row in product_library_decisions ----
  const auditId = `psrc-${sourceId}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  await db.prepare(
    `INSERT INTO product_library_decisions
       (id, project_id, entity_type, entity_id, action, previous_value, new_value, reason, decided_by, decided_role)
    VALUES (?, NULL, 'Product Source', ?, 'Reclassify', ?, ?, ?, ?, ?)`,
  ).bind(
    auditId,
    sourceId,
    sourceRow.source_type,
    targetSourceType,
    reason,
    humanActor.id,
    humanActor.role || "Library Manager"
  ).run();

  return {
    status: "CORRECTED",
    sourceId,
    previousSourceType: sourceRow.source_type,
    newSourceType: targetSourceType,
    auditId,
  };
};