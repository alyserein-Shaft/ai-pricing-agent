// HTTP surface for the governed EXPECTED DRAWING QUANTITY SCOPE authority.
//
//   GET  /api/projects/:projectId/drawing-quantity-expected-scope?deviceClass=T
//        The reviewer-facing packet: the governed expected scope, the unresolved
//        proposals, the rejected decisions, and -- for each proposal -- why that
//        location is plausibly expected to owe quantity, with its canonical
//        identity and provenance. Read-only.
//
//   POST /api/projects/:projectId/drawing-quantity-expected-scope/proposals
//        Raise a PROPOSAL (Needs Review). Confers no authority.
//
//   POST /api/projects/:projectId/drawing-quantity-expected-scope/:scopeId/decide
//        Approve or Reject a proposal as a real human. Appends a new version and
//        supersedes the proposal; never edits it.
//
// The project and the reviewer are taken from the URL and the server-configured
// human actor. Neither can be supplied by the body, so a proposal cannot be
// re-homed and a decision cannot be attributed to someone else.
//
// SYNTHETIC ACTORS. `requireHumanActor` refuses a synthetic caller outright. A
// proposal needs no reviewer (it confers nothing), but a DECISION is refused in
// the domain too, so a synthetic identity can never approve expected scope even
// if it somehow reached the writer.

import { proposeScopeDecision, decideScopeDecision, EXPECTED_SCOPE_TABLE } from "./drawing-quantity-scope-writer.mjs";
import { loadProjectExpectedScopeAuthority } from "../app/domain/drawing-quantity-expected-scope.mjs";
import { requireHumanActor } from "./human-actor.mjs";
import { isSyntheticActorId } from "../app/domain/human-authority.mjs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const LIST_ROUTE = /^\/api\/projects\/([^/]+)\/drawing-quantity-expected-scope$/;
const PROPOSE_ROUTE = /^\/api\/projects\/([^/]+)\/drawing-quantity-expected-scope\/proposals$/;
const DECIDE_ROUTE = /^\/api\/projects\/([^/]+)\/drawing-quantity-expected-scope\/([^/]+)\/decide$/;

const parseJson = (raw, fallback = {}) => {
  if (raw && typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return fallback; }
};

export const handleDrawingQuantityExpectedScopeApi = async (request, env) => {
  const pathname = new URL(request.url).pathname;
  const listMatch = pathname.match(LIST_ROUTE);
  const proposeMatch = pathname.match(PROPOSE_ROUTE);
  const decideMatch = pathname.match(DECIDE_ROUTE);
  if (!listMatch && !proposeMatch && !decideMatch) return null;
  const projectId = decodeURIComponent((listMatch ?? proposeMatch ?? decideMatch)[1]);

  if (!env.DB) return json({ error: { code: "SCOPE_AUTHORITY_UNAVAILABLE", message: "Scope authority storage is unavailable." } }, 503);

  // --- authentication ------------------------------------------------------
  // Proposals may be raised by a human actor only; the route is a governed
  // surface, so a synthetic identity is refused before anything is read.
  const gate = requireHumanActor(env);
  if (gate.error) return json({ error: { code: gate.error, message: gate.message } }, 403);
  const actorId = gate.actor.id;

  // --- project ownership ---------------------------------------------------
  const project = await env.DB.prepare(
    "SELECT p.id, p.owner_user_id,"
    + " EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=? AND pm.status='Active' AND pm.revoked_at IS NULL) AS is_member"
    + " FROM projects p WHERE p.id=? AND p.archived_at IS NULL",
  ).bind(actorId, projectId).first();
  if (!project) return json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } }, 404);
  if (project.owner_user_id !== actorId && !project.is_member) {
    return json({ error: { code: "PROJECT_FORBIDDEN", message: "This project belongs to another user." } }, 403);
  }

  // ---- GET: the reviewer packet -------------------------------------------
  if (listMatch) {
    const deviceClass = new URL(request.url).searchParams.get("deviceClass");
    if (!deviceClass) return json({ error: { code: "DEVICE_CLASS_REQUIRED", message: "deviceClass is required; expected scope is scoped per governed device class." } }, 422);

    const versions = await env.DB.prepare(
      "SELECT d.id document_id, d.current_version_id FROM documents d WHERE d.project_id=? AND d.archived_at IS NULL",
    ).bind(projectId).all();
    const currentDocumentVersions = Object.fromEntries(
      (versions.results ?? []).map((r) => [r.document_id, r.current_version_id]),
    );

    const authority = await loadProjectExpectedScopeAuthority(env.DB, {
      projectId, deviceClass, currentDocumentVersions,
    });

    // Full current proposal set for the class, so a reviewer sees every proposal.
    const rows = (await env.DB.prepare(
      `SELECT id, document_id, document_version_id, sheet, floor_or_area, device_class, device_variant,
              display_label, proposed_reason, provenance, review_status, reviewed_by, reviewed_at,
              review_reason, version_number, previous_version_id, superseded_at, created_by, created_at
         FROM ${EXPECTED_SCOPE_TABLE}
        WHERE project_id=? AND device_class=? AND superseded_at IS NULL
        ORDER BY sheet`,
    ).bind(projectId, deviceClass).all()).results ?? [];

    return json({
      projectId,
      deviceClass,
      scopeDefinitionState: authority.scopeDefinitionState,
      // The reviewer must see the whole decision set, not just the approved part.
      proposals: rows.map((r) => ({
        id: r.id,
        canonicalLocation: { documentId: r.document_id, documentVersionId: r.document_version_id, sheet: r.sheet, floorOrArea: r.floor_or_area },
        deviceClass: r.device_class,
        deviceVariant: r.device_variant,
        // Explicitly labelled: a label is never authority.
        displayLabelIsAuthority: false,
        displayLabel: r.display_label,
        reviewStatus: r.review_status,
        proposedReason: r.proposed_reason,
        provenance: parseJson(r.provenance, r.provenance),
        isCurrentDrawingVersion: currentDocumentVersions[r.document_id] === r.document_version_id,
        currentDocumentVersionId: currentDocumentVersions[r.document_id] ?? null,
        reviewedBy: r.reviewed_by,
        reviewedAt: r.reviewed_at,
        reviewReason: r.review_reason,
        versionNumber: r.version_number,
        supersedes: r.previous_version_id,
        createdBy: r.created_by,
        createdAt: r.created_at,
      })),
      approvedExpectedLocations: authority.approvedExpectedLocations,
      pendingScopeDecisions: authority.pendingScopeDecisions,
      rejectedScopeDecisions: authority.rejectedScopeDecisions,
      // What a proposal is NOT.
      proposalConfersAuthority: false,
      reason: authority.reason,
    });
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: { code: "INVALID_JSON", message: "A JSON body is required." } }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: { code: "INVALID_BODY", message: "The body must be a JSON object." } }, 400);
  }

  // ---- POST: raise a proposal --------------------------------------------
  if (proposeMatch) {
    if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } }, 405);
    const result = await proposeScopeDecision(env.DB, { ...body, projectId }, { actorId });
    if (!result.ok) return json({ ok: false, code: result.code, reason: result.reason, authorityConferred: false }, result.status ?? 422);
    return json({
      ok: true,
      action: result.action,
      idempotent: result.idempotent,
      // Stated on every response: a proposal is not authority.
      authorityConferred: false,
      scopeId: result.scopeId ?? result.scope?.id ?? null,
      reviewStatus: result.scope?.review_status ?? "Needs Review",
      canonicalLocation: { documentId: result.scope?.document_id ?? null, sheet: result.scope?.sheet ?? null },
    }, result.idempotent ? 200 : 201);
  }

  // ---- POST: approve or reject -------------------------------------------
  if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } }, 405);
  if (isSyntheticActorId(actorId)) {
    return json({ error: { code: "SYNTHETIC_ACTOR_CANNOT_DECIDE_SCOPE", message: "A synthetic identity cannot decide expected quantity scope." } }, 403);
  }
  const scopeId = decodeURIComponent(decideMatch[2]);
  const existing = await env.DB.prepare(
    `SELECT * FROM ${EXPECTED_SCOPE_TABLE} WHERE id=? AND project_id=?`,
  ).bind(scopeId, projectId).first();
  if (!existing) return json({ error: { code: "SCOPE_PROPOSAL_NOT_FOUND", message: "No such scope proposal in this project." } }, 404);

  // The reviewer sees the proposal and decides IT. Identity, class and canonical
  // location are never taken from the body -- they are re-read from the stored
  // proposal, so a caller cannot decide a different location than the one shown.
  const result = await decideScopeDecision(env.DB, {
    projectId,
    documentId: existing.document_id,
    documentVersionId: existing.document_version_id,
    sheet: existing.sheet,
    floorOrArea: existing.floor_or_area,
    deviceClass: existing.device_class,
    deviceVariant: existing.device_variant,
    displayLabel: existing.display_label,
    proposedReason: existing.proposed_reason,
    provenance: existing.provenance,
    reviewStatus: body.reviewStatus,
    reviewReason: body.reviewReason,
    requestId: body.requestId,
    // Attribution is the server's, never the body's.
    actorId,
  }, { actorId });
  if (!result.ok) return json({ ok: false, code: result.code, reason: result.reason }, result.status ?? 422);

  return json({
    ok: true,
    action: result.action,
    scopeId: result.scope.id,
    reviewStatus: result.scope.review_status,
    versionNumber: result.scope.version_number,
    supersedes: result.scope.previous_version_id,
    reviewedBy: result.scope.reviewed_by,
    // An approved expectation is still NOT a quantity.
    quantityAuthorityConferred: false,
    canonicalLocation: { documentId: result.scope.document_id, sheet: result.scope.sheet },
  }, 201);
};

export default handleDrawingQuantityExpectedScopeApi;