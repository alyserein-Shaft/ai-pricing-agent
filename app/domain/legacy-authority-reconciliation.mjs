// KN-GOVERNANCE-REPAIR (§10 legacy authority reconciliation).
//
// Historical CLI scripts minted canonical Approved rows (accessories,
// compatibilities) without human review. Those rows are load-bearing
// downstream and are NOT deleted or downgraded here. This module provides the
// two governed operations the reconciliation path needs:
//
//   1. classifyLegacyAuthorityRow -- deterministic triage of one canonical
//      row into RECOVERABLE (manufacturer-documented evidence exists or can
//      be recovered through the normal fact/review/link/promote chain) or
//      REVIEW_REQUIRED_LEGACY_AUTHORITY (price-list, quotation, or missing
//      evidence: usable downstream as before, but never citable as newly
//      verified evidence for automation).
//   2. reconfirmLegacyAuthority -- records a governed human re-confirmation
//      decision (product_library_decisions, action 'Reconfirmed Legacy
//      Authority') against an existing Approved current row, without
//      rewriting history: the original created_by/evidence/audit trail is
//      untouched; the decision row is the new authority statement.
//
// Both are pure w.r.t. policy; only (2) writes, and only one decision row.
import { MIN_GOVERNED_REASON_LENGTH } from "./reason-governance.mjs";

export const LEGACY_AUTHORITY_POLICY_VERSION = "legacy-authority-reconciliation-v1";
export const LEGACY_RECONFIRM_ACTION = "Reconfirmed Legacy Authority";

const CANONICAL_RECONCILABLE_TABLES = Object.freeze([
  "product_accessories",
  "product_compatibility",
  "product_attributes",
]);

const text = (value) => String(value ?? "").trim();

const parseJson = (value, fallback) => {
  try {
    if (value === null || value === undefined || value === "") return fallback;
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
};

// Evidence kinds, strongest first. A row is RECOVERABLE when its provenance
// names manufacturer documentation that a future enrichment pass (or a human
// reviewer today) can re-verify: datasheet/manual/compatibility-guide
// citations, document numbers, or exact quoted text with a source title.
// Price lists, quotations, RFQs, and absent evidence stay review-required:
// they prove a commercial observation, not engineering authority.
const manufacturerEvidence = (evidence) => {
  const texts = [];
  const collect = (value) => {
    if (typeof value === "string") texts.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(evidence);
  const haystack = texts.join("\n");
  return {
    hasManufacturerDoc: /datasheet|manual|compatibility guide|DN-\d+|UL\s*\d+|EN\s*\d+/i.test(haystack),
    hasUrl: /https?:\/\//i.test(haystack),
    hasCommercialOnly: /price list|quotation|RFQ/i.test(haystack),
  };
};

export const classifyLegacyAuthorityRow = ({ table, row, knowledgeFactExists = false } = {}) => {
  if (!CANONICAL_RECONCILABLE_TABLES.includes(table)) {
    return { status: "OUT_OF_SCOPE", reason: `${table} is not a reconcilable canonical table.` };
  }
  if (!row || row.review_status !== "Approved") {
    return { status: "NOT_LEGACY_APPROVED", reason: "Only current Approved rows reconcile; anything else is governed by its own lifecycle." };
  }
  const evidence = parseJson(row.evidence_json, null);
  const signals = manufacturerEvidence(evidence);
  if (signals.hasManufacturerDoc) {
    return {
      status: "RECOVERABLE",
      reason: "Provenance cites manufacturer documentation; recover the Knowledge fact and review through the normal chain.",
      knowledgeFactExists,
    };
  }
  return {
    status: "REVIEW_REQUIRED_LEGACY_AUTHORITY",
    reason: "Provenance is commercial, missing, or unrecoverable: downstream use continues, but the row must never be cited as newly verified evidence.",
    knowledgeFactExists,
  };
};

const uid = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;

export const reconfirmLegacyAuthority = async (
  db,
  { canonicalTable, rowId, actor, reason } = {}
) => {
  if (!CANONICAL_RECONCILABLE_TABLES.includes(canonicalTable)) {
    return { status: "TABLE_NOT_RECONCILABLE", canonicalTable };
  }
  const actorId = text(actor?.id);
  const actorRole = text(actor?.permission || actor?.role);
  if (!actorId || !actorRole) {
    return { status: "ACTOR_REQUIRED", canonicalTable, rowId };
  }
  if (text(reason).length < MIN_GOVERNED_REASON_LENGTH) {
    return { status: "REASON_REQUIRED", canonicalTable, rowId };
  }
  const row = await db
    .prepare(`SELECT * FROM ${canonicalTable} WHERE id=? LIMIT 1`)
    .bind(rowId)
    .first();
  if (!row) {
    return { status: "ROW_NOT_FOUND", canonicalTable, rowId };
  }
  if (row.review_status !== "Approved") {
    return { status: "ROW_NOT_APPROVED", canonicalTable, rowId };
  }
  if (row.superseded_at != null || row.deleted_at != null) {
    return { status: "ROW_NOT_CURRENT", canonicalTable, rowId };
  }
  const existing = await db
    .prepare(
      `SELECT * FROM product_library_decisions
       WHERE entity_type=? AND entity_id=? AND action=?
       ORDER BY decided_at DESC, id DESC LIMIT 1`
    )
    .bind(canonicalTable, rowId, LEGACY_RECONFIRM_ACTION)
    .first();
  if (existing) {
    return { status: "RECONFIRMED", idempotent: true, decisionId: existing.id, canonicalTable, rowId };
  }
  const decisionId = uid("librarydecision");
  const stamp = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO product_library_decisions
       (id, project_id, entity_type, entity_id, action, previous_value, new_value, reason, decided_by, decided_role, decided_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      decisionId,
      null,
      canonicalTable,
      rowId,
      LEGACY_RECONFIRM_ACTION,
      JSON.stringify({ review_status: row.review_status, created_by: row.created_by ?? null }),
      JSON.stringify({ review_status: "Approved", reconfirmed: true, policyVersion: LEGACY_AUTHORITY_POLICY_VERSION }),
      text(reason),
      actorId,
      actorRole,
      stamp
    )
    .run();
  return { status: "RECONFIRMED", idempotent: false, decisionId, canonicalTable, rowId };
};
