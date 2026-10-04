// SUCCESSOR READ MODEL -- advisory, label-don't-gate.
//
// WHAT THIS IS
// A single governed canonical relationship row (`Subject "Superseded By"
// Target`) is stored. This module projects it into the two things a consumer
// actually needs:
//
//   successorOf(productId)  -> "what replaced this?"     (the inverse view)
//   supersededBy(productId) -> "what did this replace?"  (the forward view)
//
// The INVERSE IS DERIVED, NOT STORED. `SGWL SUPERSEDED_BY SGWLED` is one row;
// "SGWLED supersedes SGWL" is read off the same row by swapping the ends. Two
// canonical rows would let the two directions drift apart with nothing able to
// detect it.
//
// LABEL, DO NOT GATE -- the whole point.
// A supersession edge is manufacturer lifecycle TRUTH. It is not:
//
//   - a compatibility claim (the legacy product is not an alternative to its
//     successor; it is the thing the successor replaced);
//   - an availability, stock or supplier-availability statement;
//   - a reason to refuse a match.
//
// An installed, working SGWL must remain selectable by an engineer who chooses
// it. Every field here is therefore descriptive, and `advisory` is the only
// signal any consumer may use: there is deliberately no `blocking`, no
// `excluded` and no eligibility field on this result at all. Absence of a field
// is the guarantee -- a consumer cannot gate on what is not offered.

import {
  isCompatibilityRelationship,
  isSupersessionRelationship,
} from "./knowledge-promotion-policy.mjs";

export const SUCCESSOR_READ_MODEL_VERSION = "successor-read-model-1.0.0";

// A supersession edge is only meaningful between canonical, non-superseded
// products. Anything else is reported as unresolved rather than presented as a
// successor, because a relationship pointing at a retired or foreign identity is
// not a successor an engineer can act on.
const SUCCESSOR_ELIGIBLE_STATUSES = Object.freeze(["Active"]);

const clean = (value) => String(value ?? "").trim();

const describe = (row) => ({
  relationshipId: row.id,
  subjectProductId: row.left_entity_id,
  subjectPartNumber: clean(row.subject_part_number) || null,
  targetProductId: row.right_entity_id,
  targetPartNumber: clean(row.target_part_number) || null,
  targetIdentityStatus: clean(row.target_identity_status) || null,
  status: clean(row.status) || null,
  confidence: Number(row.confidence ?? 0) || null,
  effectiveFrom: row.effective_from ?? null,
  factType: row.fact_type ?? null,
  createdAt: row.created_at ?? null,
});

const SELECT_SUCCESSOR_EDGES = `
  SELECT r.id, r.left_entity_id, r.right_entity_id, r.relationship_type, r.status,
         r.confidence, r.effective_from, r.fact_type, r.created_at,
         sp.part_number AS subject_part_number,
         tp.part_number AS target_part_number,
         tp.identity_status AS target_identity_status
  FROM engineering_relationships r
  LEFT JOIN library_products sp ON sp.id = r.left_entity_id
  LEFT JOIN library_products tp ON tp.id = r.right_entity_id
  WHERE r.left_entity_type='Product'
    AND r.right_entity_type='Product'
    AND r.status<>'Rejected'
    AND (r.project_id IS NULL OR r.project_id=?)
  ORDER BY r.created_at DESC, r.id DESC`;

const resolveRows = (rows) =>
  (rows || [])
    .filter((row) => isSupersessionRelationship(row.relationship_type))
    .map((row) => ({
      ...describe(row),
      // A retired target is not an actionable successor, so it is reported as
      // such rather than presented to an engineer as a replacement to order.
      targetUsable: SUCCESSOR_ELIGIBLE_STATUSES.includes(clean(row.target_identity_status)),
    }));

const loadEdges = (db, projectId) =>
  db.prepare(`${SELECT_SUCCESSOR_EDGES}`).bind(projectId).all().results || [];

/**
 * "What replaced this product?" — the inverse projection of the stored edge.
 * Returns `null` when there is no governed successor, never a guess.
 */
export const successorOf = async (db, { productId, projectId = null } = {}) => {
  const id = clean(productId);
  if (!id) return null;
  const edges = await loadEdges(db, projectId);
  const candidates = edges.filter(
    (row) => row.left_entity_id === id && isSupersessionRelationship(row.relationship_type),
  );
  if (!candidates.length) return null;
  const [newest] = candidates.map((row) => ({ ...describe(row), targetUsable: SUCCESSOR_ELIGIBLE_STATUSES.includes(clean(row.target_identity_status)) }));
  return {
    ...newest,
    advisory: `Superseded — successor: ${newest.targetPartNumber ?? newest.targetProductId}`,
    advisoryOnly: true,
    readModelVersion: SUCCESSOR_READ_MODEL_VERSION,
  };
};

/**
 * "What did this product replace?" — the forward projection.
 */
export const supersededBy = async (db, { productId, projectId = null } = {}) => {
  const id = clean(productId);
  if (!id) return [];
  const edges = await loadEdges(db, projectId);
  return edges
    .filter((row) => row.right_entity_id === id && isSupersessionRelationship(row.relationship_type))
    .map((row) => describe(row));
};

/**
 * Split a product's governed relationship edges for a consumer that must not
 * confuse the two kinds.
 *
 * `compatibility` and `succession` are returned as SEPARATE lists precisely so
 * no consumer can read a supersession edge as a compatibility claim. Callers
 * that only understand compatibility receive an empty `succession` they cannot
 * misinterpret, and callers that render lifecycle get the successor without
 * being handed a compatibility-shaped array.
 */
export const splitRelationshipEdges = async (db, { productId, projectId = null } = {}) => {
  const id = clean(productId);
  if (!id) return { compatibility: [], succession: [] };
  const rows = await db
    .prepare(
      `SELECT r.*, tp.part_number AS target_part_number, tp.identity_status AS target_identity_status
       FROM engineering_relationships r
       LEFT JOIN library_products tp ON tp.id = r.right_entity_id
       WHERE r.left_entity_type='Product' AND r.left_entity_id=? AND r.status<>'Rejected'
         AND (r.project_id IS NULL OR r.project_id=?)
       ORDER BY r.created_at DESC, r.id DESC`,
    )
    .bind(id, projectId)
    .all()
    .results || [];
  return {
    compatibility: rows
      .filter((row) => isCompatibilityRelationship(row.relationship_type))
      .map((row) => ({ ...row, target_part_number: clean(row.target_part_number) || null })),
    succession: resolveRows(rows),
  };
};

/**
 * Compatibility edges only.
 *
 * This is the function a matching or BOM consumer must use if it wants
 * interoperability. It exists so the type filter is written down once, in one
 * place, instead of being re-derived (and eventually forgotten) at each call
 * site -- which is exactly how a supersession edge would end up being read as
 * "these two work together".
 */
export const compatibilityEdgesFor = async (db, { productId, projectId = null } = {}) => {
  const { compatibility } = await splitRelationshipEdges(db, { productId, projectId });
  return compatibility;
};
