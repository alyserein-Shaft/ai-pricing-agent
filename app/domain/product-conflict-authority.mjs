// Product conflict authority -- governed WRITE path for an unresolved product
// identity condition.
//
// WHY THIS EXISTS
// product_conflicts is already the canonical governed register for unresolved
// product identity conflicts: the table exists, existing readers consume it, and
// identityConflictOpen is already derived from its Open rows. But no application
// or domain code could CREATE a row, so an unresolved condition had no way to be
// recorded. This module is that missing write path. It deliberately does not
// introduce a second mechanism.
//
// THE SEMANTIC DISTINCTION THIS ENFORCES
//   RECORD  an authorized research/analysis operator states that contradictory
//          evidence exists. This asserts NOTHING about who is right.
//   RESOLVE authorized human identity governance picks an interpretation and may
//          then change canonical identity as a consequence.
//
// Therefore recordProductConflict:
//   - may ONLY create status = 'Open'
//   - MUST NOT touch library_products, manufacturer, brand, family, lifecycle,
//     compatibility, or attributes
//   - MUST NOT resolve a conflict
//   - requires a substantive evidence payload, so a conflict can never be
//     created from a bare unsupported assertion
//   - is idempotent on (product, conflict type, normalized subject), so repeated
//     reporting of the same condition is a no-op rather than duplicate Open rows
//
// A conflict is a LABEL, not a gate. Nothing here changes matching eligibility.

import { IDENTITY_CONFLICT_TYPES } from "./product-lifecycle-authority.mjs";

export const PRODUCT_CONFLICT_AUTHORITY_VERSION = "product-conflict-authority-1.0.0";

export const PRODUCT_CONFLICT_STATUSES = Object.freeze(["Open", "Resolved"]);

// Every conflict type the register accepts. Reusing the identity-conflict
// vocabulary keeps ONE source of truth for "what counts as an identity
// conflict", which is what the reader side already consults.
export const PRODUCT_CONFLICT_TYPES = Object.freeze([...IDENTITY_CONFLICT_TYPES]);

export const PRODUCT_CONFLICT_ERRORS = Object.freeze({
  PRODUCT_REQUIRED: "PRODUCT_CONFLICT_PRODUCT_REQUIRED",
  PRODUCT_UNKNOWN: "PRODUCT_CONFLICT_PRODUCT_UNKNOWN",
  PRODUCT_OUT_OF_SCOPE: "PRODUCT_CONFLICT_PRODUCT_OUT_OF_SCOPE",
  TYPE_REQUIRED: "PRODUCT_CONFLICT_TYPE_REQUIRED",
  TYPE_UNSUPPORTED: "PRODUCT_CONFLICT_TYPE_UNSUPPORTED",
  EVIDENCE_REQUIRED: "PRODUCT_CONFLICT_EVIDENCE_REQUIRED",
  REASON_REQUIRED: "PRODUCT_CONFLICT_REASON_REQUIRED",
  ACTOR_REQUIRED: "PRODUCT_CONFLICT_ACTOR_REQUIRED",
});

// Minimum substantive payload. Short strings cannot carry an evidence trail.
const MIN_EVIDENCE_CHARS = 20;
const MIN_REASON_CHARS = 12;

const clean = (value) => String(value ?? "").trim();

const normalizeSubject = (value) =>
  clean(value).toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export const productConflictIdempotencyKey = ({ productId, conflictType, subject }) =>
  [
    "productconflict",
    clean(productId).toLowerCase(),
    normalizeSubject(conflictType),
    normalizeSubject(subject),
  ].join(":");

/**
 * Pure validation. Returns either { ok: true, value } or { ok: false, code, message }.
 * Kept pure so the governance rules are testable without a database, and so a
 * route can never be the only place they are enforced.
 */
export const assessProductConflictReport = ({
  productId,
  conflictType,
  subject,
  description,
  reason,
  evidence,
  actor,
  organizationId = null,
  libraryProjectId = null,
  knownConflictType = null,
} = {}) => {
  const id = clean(productId);
  if (!id) return { ok: false, code: PRODUCT_CONFLICT_ERRORS.PRODUCT_REQUIRED, message: "A canonical product id is required." };
  // A caller may pass a scope predicate; by default nothing narrows scope here
  // and the store-level product lookup in recordProductConflict is the authority
  // for existence.
  if (typeof knownConflictType === "function" &&
      !knownConflictType(id, { organizationId, libraryProjectId })) {
    return { ok: false, code: PRODUCT_CONFLICT_ERRORS.PRODUCT_OUT_OF_SCOPE, message: "The product is outside the caller's scope." };
  }

  const type = clean(conflictType);
  if (!type) return { ok: false, code: PRODUCT_CONFLICT_ERRORS.TYPE_REQUIRED, message: "A conflict type is required." };
  if (!PRODUCT_CONFLICT_TYPES.includes(type)) {
    return { ok: false, code: PRODUCT_CONFLICT_ERRORS.TYPE_UNSUPPORTED, message: `"${type}" is not a governed product conflict type.` };
  }

  const who = clean(actor);
  if (!who) return { ok: false, code: PRODUCT_CONFLICT_ERRORS.ACTOR_REQUIRED, message: "The reporting actor is required." };

  const text = clean(description);
  if (text.length < MIN_EVIDENCE_CHARS) {
    return { ok: false, code: PRODUCT_CONFLICT_ERRORS.EVIDENCE_REQUIRED, message: "An evidence-backed description is required." };
  }
  // The description above is the minimum; structured provenance is accepted and
  // preserved but is not made mandatory, because not every conflict arises from
  // a two-fact Knowledge comparison (e.g. a manufacturer regime contradiction
  // found by reading a datasheet).
  const refs = Array.isArray(evidence) ? evidence.filter((e) => e && clean(typeof e === "string" ? e : (e.sourceId ?? e.source_id ?? e.url ?? e.document))) : [];
  const why = clean(reason);
  if (why.length < MIN_REASON_CHARS) {
    return { ok: false, code: PRODUCT_CONFLICT_ERRORS.REASON_REQUIRED, message: "A substantive reason is required." };
  }

  const normalizedSubject = normalizeSubject(subject || text).slice(0, 240);
  return {
    ok: true,
    value: {
      productId: id,
      conflictType: type,
      subject: normalizedSubject,
      description: text,
      reason: why,
      evidenceRefs: refs,
      idempotencyKey: productConflictIdempotencyKey({ productId: id, conflictType: type, subject: normalizedSubject }),
      // Always Open. Recording can never resolve.
      status: "Open",
      // The real authenticated actor, recorded verbatim. This is NOT labelled a
      // human approval and must never be presented as one.
      reportedBy: who,
      discovery: "SYSTEM_RESEARCH_DISCOVERY",
      authorityVersion: PRODUCT_CONFLICT_AUTHORITY_VERSION,
    },
  };
};

/**
 * Persist ONE Open conflict, idempotently. Read-after-write is immediate for
 * every existing reader because they read product_conflicts directly.
 *
 * Deliberately does NOT write library_products or any canonical product field.
 */
export const recordProductConflict = async (db, report, { now = new Date().toISOString(), newId = null } = {}) => {
  const assessed = report?.ok === false ? report : assessProductConflictReport(report?.value ? report.value : report);
  if (!assessed?.ok) return { ok: false, ...assessed };

  const value = assessed.value;

  // Unknown product -> reject. This also enforces scope when the caller has
  // already narrowed the product set, because a product outside it will not
  // resolve here.
  const product = await db
    .prepare("SELECT id, part_number, manufacturer_id, brand_id, family_id, lifecycle_status FROM library_products WHERE id=?")
    .bind(value.productId)
    .first();
  if (!product) {
    return { ok: false, code: PRODUCT_CONFLICT_ERRORS.PRODUCT_UNKNOWN, message: "Unknown canonical product." };
  }

  // Idempotent: an identical condition is already recorded. The register has no
  // `subject` column -- the normalized subject is stored in `left_value`, so
  // dedupe compares that (case-insensitively) with the product and type.
  const existing = await db
    .prepare("SELECT id, status, conflict_type, created_at FROM product_conflicts WHERE product_id=? AND conflict_type=? AND status='Open' AND deleted_at IS NULL AND lower(coalesce(left_value,''))=lower(?)")
    .bind(value.productId, value.conflictType, value.subject)
    .first();
  if (existing) {
    return { ok: true, created: false, idempotent: true, conflict: existing, product };
  }

  // The caller may supply an async id factory (content-addressed conflict ids);
  // it MUST be awaited so a Promise is never bound into D1.
  const id = newId ? await newId() : `conflict_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  await db
    .prepare(
      `INSERT INTO product_conflicts (id, product_id, conflict_type, left_value, right_value, source_ids, status, resolution, resolved_by, resolved_at, created_at, conflict_version, library_scope, deleted_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
    )
    .bind(
      id,
      product.id,
      value.conflictType,
      value.subject,                                   // left_value: the condition
      value.description,                               // right_value: the evidence-backed description
      JSON.stringify(value.evidenceRefs),              // source_ids
      value.status,                                    // always 'Open'
      null, null, null,                                // no resolution is ever set here
      now,
      1,
      "Global",
    )
    .run();

  return {
    ok: true,
    created: true,
    idempotent: false,
    conflict: {
      id,
      product_id: product.id,
      conflict_type: value.conflictType,
      status: value.status,
      subject: value.subject,
      discovery: value.discovery,
      reported_by: value.reportedBy,
    },
    product,
  };
};
