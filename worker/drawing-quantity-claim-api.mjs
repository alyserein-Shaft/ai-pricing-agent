// HTTP surface for the governed Drawing Quantity claim writer.
//
// MOUNTED so the writer is reachable from the application. A writer that is not
// mounted is not a writer, which is the gap this closes.
//
// POST /api/projects/:projectId/drawing-quantity-claims
//   Body is a governed claim. Requires authentication and project ownership.
//   The actor is resolved through the shared human-actor policy, so attribution
//   cannot be forged by putting a name in the request body.
//
// Response shape is stable and review/debug friendly: claim id, version,
// identity, physical quantity, review/authority state, currentness, evidence
// fingerprint, previous version when superseded, idempotent flag, and the
// blocking reason when refused. Foreign-project row identities are never
// returned.

import { persistGovernedQuantityClaim, validateGovernedQuantityClaimInput } from "./drawing-quantity-claim-writer.mjs";
import { requireHumanActor } from "./human-actor.mjs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const ROUTE = /^\/api\/projects\/([^/]+)\/drawing-quantity-claims$/;

/** Project the claim for a caller without leaking foreign-project identities. */
const present = (result, projectId) => {
  if (!result.ok) {
    return { ok: false, code: result.code, reason: result.reason };
  }
  const c = result.claim ?? {};
  return {
    ok: true,
    action: result.action,               // CREATED | SUPERSEDED | NO_OP
    idempotent: Boolean(result.idempotent),
    previousClaimId: result.previousClaimId ?? null,
    claim: {
      id: c.id ?? null,
      versionNumber: c.version_number ?? null,
      projectId: c.project_id === projectId ? c.project_id : null,
      documentVersionId: c.document_version_id ?? null,
      sheet: c.sheet ?? null,
      floorOrArea: c.floor_or_area ?? null,
      deviceClass: c.device_class ?? null,
      deviceVariant: c.device_variant ?? null,
      physicalQuantity: c.quantity ?? null,
      countMethod: c.count_method ?? null,
      state: c.state ?? null,
      reviewStatus: c.review_status ?? c.review?.status ?? null,
      authorityVersion: c.authority_version ?? null,
      evidenceFingerprint: c.evidence_fingerprint ?? null,
      supersededAt: c.superseded_at ?? null,
      current: c.superseded_at === null || c.superseded_at === undefined,
    },
  };
};

export const handleDrawingQuantityClaimApi = async (request, env) => {
  const pathname = new URL(request.url).pathname;
  if (!ROUTE.test(pathname)) return null;
  const projectId = decodeURIComponent(pathname.match(ROUTE)[1]);

  // --- authentication ------------------------------------------------------
  // Attribution comes from server configuration only, never from the body, so
  // a claim's reviewer cannot be forged by a caller naming themselves.
  const gate = requireHumanActor(env);
  if (gate.error) {
    return json({ error: { code: gate.error, message: gate.message } }, 403);
  }
  const actorId = gate.actor.id;

  // --- project ownership ---------------------------------------------------
  // Same rule as the rest of the governed API surface: the owner, or an Active,
  // non-revoked project member. Membership is data, so it is checked, not assumed.
  const DB = env.DB;
  const project = await DB.prepare(
    "SELECT p.id, p.owner_user_id,"
    + " EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=? AND pm.status='Active' AND pm.revoked_at IS NULL) AS is_member"
    + " FROM projects p WHERE p.id=? AND p.archived_at IS NULL",
  ).bind(actorId, projectId).first();
  if (!project) return json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } }, 404);
  if (project.owner_user_id !== actorId && !project.is_member) {
    return json({ error: { code: "PROJECT_FORBIDDEN", message: "This project belongs to another user." } }, 403);
  }

  // --- validation ----------------------------------------------------------
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: { code: "INVALID_JSON", message: "A JSON body is required." } }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: { code: "INVALID_BODY", message: "A claim body must be a JSON object." } }, 400);
  }

  // The route owns project identity and attribution; a caller cannot supply
  // either, so a claim can never be written against a project it did not target.
  const input = { ...body, projectId, reviewedBy: actorId, createdBy: actorId };
  const pre = validateGovernedQuantityClaimInput(input);
  if (!pre.ok) {
    return json({ error: { code: pre.code, message: pre.reason } }, pre.code === "EVIDENCE_FINGERPRINT_MISMATCH" ? 409 : 422);
  }

  // --- persistence ---------------------------------------------------------
  const result = await persistGovernedQuantityClaim(DB, input, { actorId });
  const status = result.ok ? (result.idempotent ? 200 : 201) : (result.status ?? 422);
  return json(present(result, projectId), status);
};

export default handleDrawingQuantityClaimApi;
