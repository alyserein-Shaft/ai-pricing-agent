// PRODUCTION WRITER for governed expected-quantity scope.
//
// Mirrors worker/drawing-quantity-claim-writer.mjs deliberately: one writer per
// authority, append-only, one new version per decision, currentness expressed by
// superseding the previous row rather than editing it.
//
//   proposeScopeDecision()  -> inserts a `Needs Review` row (v1)
//   decideScopeDecision()   -> inserts a NEW Approved/Rejected row (vN+1) carrying
//                              previous_version_id, and stamps superseded_at on vN
//
// A proposal confers NO authority. Only a current `Approved` row does, and only
// the scope authority reader treats it as expected scope.
//
// EXPECTED LOCATION != QUANTITY. This file writes no quantity, no count, no
// total and no BOQ reference. It records which locations owe a quantity, which
// is a separate and much weaker statement.

import {
  validateExpectedScopeDecision,
  SCOPE_REVIEW_STATUSES,
} from "../app/domain/drawing-quantity-expected-scope.mjs";

export const EXPECTED_SCOPE_TABLE = "drawing_quantity_expected_scope";
export const EXPECTED_SCOPE_EVENTS_TABLE = "drawing_quantity_expected_scope_events";

const newId = () => `dqes_${crypto.randomUUID().replace(/-/g, "").slice(0, 32)}`;

const isNonEmpty = (v) => typeof v === "string" && v.trim().length > 0;

/** Read the current (non-superseded) scope row for one identity, if any. */
async function readCurrentScopeRow(db, { projectId, deviceClass, deviceVariant, documentId, sheet, floorOrArea }) {
  return db.prepare(
    `SELECT * FROM ${EXPECTED_SCOPE_TABLE}
      WHERE project_id=? AND device_class=? AND COALESCE(device_variant,'')=COALESCE(?,'')
        AND document_id=? AND COALESCE(sheet,'')=COALESCE(?,'') AND COALESCE(floor_or_area,'')=COALESCE(?,'')
        AND superseded_at IS NULL`,
  ).bind(projectId, deviceClass, deviceVariant, documentId, sheet, floorOrArea).first();
}

/**
 * The canonical sheet key MUST come from the governed document. A caller-supplied
 * sheet string is refused rather than trusted, because the whole point of the
 * registry is that it is directly comparable with 0020 claims -- and a
 * reviewer-typed alias would break that silently.
 */
async function resolveCanonicalSheet(db, documentId, projectId) {
  const doc = await db.prepare("SELECT id, project_id, logical_name FROM documents WHERE id=? AND archived_at IS NULL")
    .bind(documentId).first();
  if (!doc) return { ok: false, code: "UNKNOWN_DOCUMENT", reason: "Document not found or archived." };
  if (projectId && doc.project_id !== projectId) {
    return { ok: false, code: "CROSS_PROJECT_DOCUMENT", reason: "This document belongs to another project." };
  }
  return { ok: true, sheet: doc.logical_name };
}

/** Confirm the document version is real, belongs to the document, and is current. */
async function assertDocumentVersionIsCurrent(db, { documentId, documentVersionId, projectId }) {
  const row = await db.prepare(
    `SELECT d.id doc_id, d.current_version_id, dv.id ver_id
       FROM documents d JOIN document_versions dv ON dv.id=? AND dv.document_id=d.id
      WHERE d.id=? AND d.archived_at IS NULL`,
  ).bind(documentVersionId, documentId).first();
  if (!row) return { ok: false, code: "UNKNOWN_DOCUMENT_VERSION", reason: "That document version does not exist for this document." };
  if (projectId) {
    const project = await db.prepare("SELECT project_id FROM documents WHERE id=?").bind(documentId).first();
    if (project?.project_id !== projectId) {
      return { ok: false, code: "CROSS_PROJECT_DOCUMENT", reason: "This document belongs to another project." };
    }
  }
  if (row.current_version_id !== row.ver_id) {
    return {
      ok: false,
      code: "STALE_DOCUMENT_VERSION",
      reason: `Document version ${documentVersionId} is not the current head (${row.current_version_id}). `
        + "Expected scope must be decided against the current drawing revision.",
    };
  }
  return { ok: true };
}

const toRow = (decision, { versionNumber = 1, previousVersionId = null, id = null } = {}) => ({
  id: id ?? newId(),
  project_id: decision.projectId,
  document_id: decision.documentId,
  document_version_id: decision.documentVersionId,
  sheet: decision.sheet,
  floor_or_area: decision.floorOrArea,
  device_class: decision.deviceClass,
  device_variant: decision.deviceVariant,
  display_label: decision.displayLabel,
  decision_group: decision.decisionGroup,
  proposed_reason: decision.proposedReason,
  provenance: decision.provenance,
  authority_version: decision.authorityVersion,
  review_status: decision.reviewStatus,
  reviewed_by: decision.reviewedBy,
  reviewed_at: decision.reviewedAt,
  review_reason: decision.reviewReason,
  version_number: versionNumber,
  previous_version_id: previousVersionId,
  superseded_at: null,
  created_by: decision.reviewedBy ?? decision.proposedBy ?? "unknown",
  created_at: new Date().toISOString(),
});

/**
 * Propose an expected location. Inserts a `Needs Review` row.
 *
 * A proposal is explicitly NOT authority: it is the machine/human-offered
 * candidate that the review step exists to judge. Repeating an identical
 * proposal is an idempotent no-op rather than a duplicate row.
 */
export async function proposeScopeDecision(db, input, { actorId = null } = {}) {
  const validated = validateExpectedScopeDecision({
    ...input,
    reviewStatus: "Needs Review",
    // A proposal needs no reviewer: it confers nothing. The actor is recorded as
    // the proposer for provenance only.
    actorId: null,
  });
  if (!validated.ok) return { ok: false, status: 422, ...validated };

  const sheet = await resolveCanonicalSheet(db, validated.decision.documentId, validated.decision.projectId);
  if (!sheet.ok) return { ok: false, status: 404, ...sheet };
  // The canonical sheet is the DOCUMENT's identity, never the caller's string.
  const decision = { ...validated.decision, sheet: sheet.sheet };

  const version = await assertDocumentVersionIsCurrent(db, decision);
  if (!version.ok) return { ok: false, status: 409, ...version };

  const existing = await readCurrentScopeRow(db, decision);
  if (existing) {
    // An identical live proposal is a no-op. A live decision is never silently
    // downgraded back to a proposal.
    if (existing.review_status === "Needs Review") {
      return { ok: true, idempotent: true, action: "NO_OP", scopeId: existing.id, reason: "This exact proposal is already the current scope decision." };
    }
    return {
      ok: false,
      status: 409,
      code: "SCOPE_ALREADY_DECIDED",
      reason: `This location already has a current '${existing.review_status}' scope decision. Use the review action to change it.`,
    };
  }

  const row = toRow(decision, { id: newId() });
  row.created_by = actorId ?? "unknown";
  await db.prepare(
    `INSERT INTO ${EXPECTED_SCOPE_TABLE}
      (id,project_id,document_id,document_version_id,sheet,floor_or_area,device_class,device_variant,
       display_label,decision_group,proposed_reason,provenance,authority_version,review_status,reviewed_by,reviewed_at,
       review_reason,version_number,previous_version_id,superseded_at,created_by,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    row.id, row.project_id, row.document_id, row.document_version_id, row.sheet, row.floor_or_area,
    row.device_class, row.device_variant, row.display_label, row.decision_group, row.proposed_reason, row.provenance,
    row.authority_version, row.review_status, row.reviewed_by, row.reviewed_at, row.review_reason,
    row.version_number, row.previous_version_id, row.superseded_at, row.created_by, row.created_at,
  ).run();

  return { ok: true, idempotent: false, action: "PROPOSED", scope: row };
}

/**
 * Approve or REJECT a proposed expected location.
 *
 * This is the human decision. It never edits the proposal: it INSERTS a new
 * version carrying the verdict and supersedes the proposal, so the trail of what
 * was proposed and what was decided both survive.
 */
export async function decideScopeDecision(db, input, { actorId, now = new Date().toISOString() } = {}) {
  const status = input?.reviewStatus;
  if (!SCOPE_REVIEW_STATUSES.includes(status) || status === "Needs Review") {
    return {
      ok: false,
      status: 422,
      code: "SCOPE_DECISION_STATUS_INVALID",
      reason: `A scope decision must be 'Approved' or 'Rejected', not '${status ?? "nothing"}'. Proposals are created by proposeScopeDecision.`,
    };
  }

  // The actor is taken from the server-supplied option, never from the body, and
  // is merged into the validated input because the decision validator reads it
  // there. A decision with no recorded actor is refused.
  const reviewerId = input.actorId ?? actorId;
  const validated = validateExpectedScopeDecision({
    ...input,
    actorId: reviewerId,
    reviewStatus: status,
    reviewedAt: now,
  });
  if (!validated.ok) return { ok: false, status: 422, ...validated };

  const sheet = await resolveCanonicalSheet(db, validated.decision.documentId, validated.decision.projectId);
  if (!sheet.ok) return { ok: false, status: 404, ...sheet };
  const decision = { ...validated.decision, sheet: sheet.sheet };

  const version = await assertDocumentVersionIsCurrent(db, decision);
  if (!version.ok) return { ok: false, status: 409, ...version };

  const previous = await readCurrentScopeRow(db, decision);
  if (previous) {
    // The decision group is part of the PROPOSAL's identity, and the
    // superseding row must carry it forward verbatim.
    //
    // WHY THIS IS NOT OPTIONAL. The governed route deliberately re-reads the
    // proposal's identity from the stored row and never forwards a caller-
    // supplied group, so a writer that took the group from the request dropped
    // it on the superseding row. Every Approved decision then stored
    // decision_group = NULL, which the 0022 partial index explicitly excludes
    // (`AND decision_group IS NOT NULL`) -- so BOTH competing candidates of one
    // location became current Approved authority with the mutual-exclusion
    // backstop silently disarmed. Reproduced through the real route before this
    // line existed; the direct-writer test could not catch it because it handed
    // `decisionGroup` to the writer itself.
    //
    // Reading it from the stored proposal rather than the input is also the
    // correct authority direction: the group belongs to the candidate being
    // decided, so a caller cannot re-group a proposal to escape exclusion.
    decision.decisionGroup = isNonEmpty(previous.decision_group) ? previous.decision_group : decision.decisionGroup;
  }
  if (!previous) {
    // The decision group is part of the PROPOSAL's identity, and the
    // superseding row must carry it forward verbatim.
    //
    // WHY THIS IS NOT OPTIONAL. The governed route deliberately re-reads the
    // proposal's identity from the stored row and never forwards a caller-
    // supplied group, so a writer that took the group from the request dropped
    // it on the superseding row. Every Approved decision then stored
    // decision_group = NULL, which the 0022 partial index explicitly excludes
    // (`AND decision_group IS NOT NULL`) -- so BOTH competing candidates of one
    // location became current Approved authority with the mutual-exclusion
    // backstop silently disarmed. Reproduced through the real route before this
    // line existed; the direct-writer test could not catch it because it handed
    // `decisionGroup` to the writer itself.
    //
    // Reading it from the stored proposal rather than the input is also the
    // correct authority direction: the group belongs to the candidate being
    // decided, so a caller cannot re-group a proposal to escape exclusion.
    decision.decisionGroup = isNonEmpty(previous.decision_group) ? previous.decision_group : decision.decisionGroup;
  }
  if (!previous) {
    return {
      ok: false,
      status: 404,
      code: "SCOPE_PROPOSAL_NOT_FOUND",
      reason: "There is no current scope decision for this location. A decision must decide an existing proposal.",
    };
  }
  if (previous.review_status !== "Needs Review") {
    // Re-deciding an already-decided identity is refused unless it is a
    // supersession of a NEWER version, which cannot happen here.
    return {
      ok: false,
      status: 409,
      code: "SCOPE_ALREADY_DECIDED",
      reason: `This location's current scope decision is already '${previous.review_status}'.`,
    };
  }

  const row = toRow(decision, {
    versionNumber: (previous.version_number ?? 1) + 1,
    previousVersionId: previous.id,
  });
  row.created_by = reviewerId;

  const requestId = input.requestId ?? newId();

  // ORDER MATTERS, and follows drawing-quantity-claim-writer.mjs exactly.
  //
  // The partial unique index admits only ONE current row per scope identity, so
  // the proposal must be retired BEFORE its replacement is inserted. Inserting
  // first transiently holds two current rows for one identity and the index
  // refuses it. Retiring first also means a refused insert leaves the location
  // with no current scope (UNKNOWN_SCOPE, which fails closed) rather than with
  // a stale proposal masquerading as authority.
  const stamped = await db.prepare(
    `UPDATE ${EXPECTED_SCOPE_TABLE} SET superseded_at=? WHERE id=? AND superseded_at IS NULL`,
  ).bind(now, previous.id).run();
  if (!stamped.meta?.changes) {
    // Another writer retired it first. Refuse rather than race.
    return { ok: false, status: 409, code: "CONCURRENT_SCOPE_SUPERSESSION", reason: "The current scope proposal was superseded concurrently. Re-read and retry." };
  }

  // The mutual-exclusion index is the BACKSTOP for competing candidate sheets:
  // if another candidate in the same decision group was approved first, this
  // insert cannot succeed. Translate that into an exact governed refusal rather
  // than letting a raw SQLite error escape.
  let inserted;
  try {
    inserted = await db.prepare(
      `INSERT INTO ${EXPECTED_SCOPE_TABLE}
        (id,project_id,document_id,document_version_id,sheet,floor_or_area,device_class,device_variant,
         display_label,decision_group,proposed_reason,provenance,authority_version,review_status,reviewed_by,reviewed_at,
         review_reason,version_number,previous_version_id,superseded_at,created_by,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      row.id, row.project_id, row.document_id, row.document_version_id, row.sheet, row.floor_or_area,
      row.device_class, row.device_variant, row.display_label, row.decision_group, row.proposed_reason, row.provenance,
      row.authority_version, row.review_status, row.reviewed_by, row.reviewed_at, row.review_reason,
      row.version_number, row.previous_version_id, row.superseded_at, row.created_by, row.created_at,
    ).run();
  } catch (error) {
    const message = String(error?.message ?? error);
    if (/UNIQUE constraint failed/i.test(message)) {
      return {
        ok: false,
        status: 409,
        code: "DECISION_GROUP_ALREADY_APPROVED",
        reason: `Another candidate sheet in decision group "${decision.decisionGroup}" is already the current Approved expected-scope authority for class ${decision.deviceClass}. `
          + "These candidates are alternatives for ONE location decision, so exactly one may be approved. "
          + "Reject this candidate, or supersede the approved one first.",
      };
    }
    throw error;
  }
  if (!inserted.meta?.changes) {
    return { ok: false, status: 409, code: "SCOPE_DECISION_NOT_INSERTED", reason: "The scope guards refused the decision; the previous proposal remains retired and this location has no current scope." };
  }

  await db.prepare(
    `INSERT INTO ${EXPECTED_SCOPE_EVENTS_TABLE}
      (id,project_id,scope_id,action,previous_status,new_status,reason,actor_user_id,request_id,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    newId(), row.project_id, row.id, status === "Approved" ? "approve" : "reject",
    previous.review_status, row.review_status, row.review_reason, row.reviewed_by, requestId, now,
  ).run();

  return { ok: true, idempotent: false, action: status === "Approved" ? "SCOPE_APPROVED" : "SCOPE_REJECTED", scope: row };
}