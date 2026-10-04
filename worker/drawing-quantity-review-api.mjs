// HTTP surface for the printed-quantity REVIEW path.
//
// MOUNTED so the review authority is reachable and so a reviewer-facing packet
// can actually be produced. This route adds NO new review subsystem and NO new
// write path:
//
//   GET  /api/projects/:projectId/drawing-quantity-review-packets
//        Every reviewed/unreviewed printed-quantity candidate in this project,
//        with the crops, printed assets, governed class meaning and the exact
//        blocking code. Read-only. This is what makes the four decisions
//        inspectable.
//
//   POST /api/projects/:projectId/drawing-quantity-review-packets/:proposalId/promote
//        Re-reads the proposal, re-evaluates the review authority, and -- only
//        if that evaluation passes -- hands the resolved evidence to the
//        CANONICAL writer (drawing-quantity-claim-writer.mjs). There is no other
//        production INSERT into drawing_quantity_claims and no direct SQL here.
//
// The promote route deliberately re-reads everything from the database rather
// than trusting the request body. A caller cannot assert a quantity, a class, a
// review status or a fingerprint: the only thing it can assert is WHICH proposal
// it wants promoted, and even that yields nothing unless a human has already
// adjudicated that proposal through the existing review path.
//
// Attribution comes from the shared human-actor policy, never from the body.

import {
  buildPrintedQuantityReviewPacket,
  evaluatePrintedQuantityReviewAuthority,
  PRINTED_QUANTITY_PROPOSAL_TYPES,
} from "../app/domain/drawing-quantity-review-authority.mjs";
import { persistGovernedQuantityClaim, governedQuantityClaimFingerprint } from "./drawing-quantity-claim-writer.mjs";
import { requireHumanActor } from "./human-actor.mjs";
import { isSyntheticActorId } from "../app/domain/human-authority.mjs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const LIST_ROUTE = /^\/api\/projects\/([^/]+)\/drawing-quantity-review-packets$/;
const PROMOTE_ROUTE = /^\/api\/projects\/([^/]+)\/drawing-quantity-review-packets\/([^/]+)\/promote$/;

const parseJson = (raw) => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return null; }
};

/**
 * Resolve everything the authority check needs, straight from governed tables.
 * The proposal's own text is never trusted as evidence; only row identities are
 * carried forward and each is re-checked against the database.
 */
async function resolveContext(DB, projectId, proposal) {
  const document = await DB.prepare("SELECT id, logical_name, current_version_id FROM documents WHERE id=? AND project_id=?")
    .bind(proposal.document_id, projectId).first();
  const intake = proposal.intake_version_id
    ? await DB.prepare("SELECT id, document_version_id FROM drawing_intake_versions WHERE id=?")
      .bind(proposal.intake_version_id).first()
    : null;

  // Only the assets this proposal actually cites, resolved to real rows.
  const cited = (parseJson(proposal.source_references) ?? [])
    .map((r) => (typeof r === "string" ? r : r?.sourceId))
    .filter((id) => typeof id === "string" && id.length > 0);
  const sourceAssets = [];
  for (const id of cited) {
    const asset = await DB.prepare(
      "SELECT id, text_content, bounding_box, review_status FROM drawing_assets WHERE id=?",
    ).bind(id).first();
    // A cited asset that no longer exists is dropped here and refused below by
    // MISSING_SOURCE_ASSETS, rather than being passed through as an id.
    if (asset) {
      sourceAssets.push({
        id: asset.id,
        textContent: asset.text_content,
        boundingBox: parseJson(asset.bounding_box),
        reviewStatus: asset.review_status,
      });
    }
  }
  return { document, intake, sourceAssets };
}

export const handleDrawingQuantityReviewApi = async (request, env) => {
  const pathname = new URL(request.url).pathname;
  const listMatch = pathname.match(LIST_ROUTE);
  const promoteMatch = pathname.match(PROMOTE_ROUTE);
  if (!listMatch && !promoteMatch) return null;
  const projectId = decodeURIComponent((listMatch ?? promoteMatch)[1]);
  if (!env.DB) return json({ error: { code: "REVIEW_UNAVAILABLE", message: "Review storage is unavailable." } }, 503);

  // --- authentication + attribution ---------------------------------------
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

  // ---- GET: the reviewer-facing packets ------------------------------------
  if (listMatch) {
    const rows = await env.DB.prepare(
      "SELECT * FROM drawing_extraction_proposals WHERE project_id=? AND proposal_type IN ("
      + PRINTED_QUANTITY_PROPOSAL_TYPES.map(() => "?").join(",")
      + ") ORDER BY created_at",
    ).bind(projectId, ...PRINTED_QUANTITY_PROPOSAL_TYPES).all();

    const packets = [];
    for (const proposal of rows.results ?? []) {
      const { document, intake, sourceAssets } = await resolveContext(env.DB, projectId, proposal);
      packets.push(buildPrintedQuantityReviewPacket({
        proposal,
        document,
        currentDocumentVersionId: document?.current_version_id ?? null,
        intakeDocumentVersionId: intake?.document_version_id ?? null,
        sourceAssets,
        // The reviewer recorded on the proposal is what matters for authority,
        // and it is judged by that id, not by who is calling this route.
        isReviewerHuman: !isSyntheticActorId(proposal.reviewed_by),
      }));
    }
    return json({
      projectId,
      packetCount: packets.length,
      readyCount: packets.filter((p) => p.state === "READY_FOR_CLAIM").length,
      packets,
    });
  }

  // ---- POST: promote an already-adjudicated proposal into the canonical writer
  const proposalId = decodeURIComponent(promoteMatch[2]);
  const proposal = await env.DB.prepare(
    "SELECT * FROM drawing_extraction_proposals WHERE id=? AND project_id=? AND proposal_type IN ("
    + PRINTED_QUANTITY_PROPOSAL_TYPES.map(() => "?").join(",")
    + ")",
  ).bind(proposalId, projectId, ...PRINTED_QUANTITY_PROPOSAL_TYPES).first();
  if (!proposal) {
    return json({ error: { code: "PROPOSAL_NOT_FOUND", message: "No printed-quantity proposal in this project." } }, 404);
  }

  const { document, intake, sourceAssets } = await resolveContext(env.DB, projectId, proposal);

  // The reviewer of record is the actor on the proposal. It is re-checked here,
  // and a synthetic reviewer is refused with the exact code -- this route cannot
  // upgrade a development identity's decision into authority.
  const verdict = evaluatePrintedQuantityReviewAuthority({
    proposal,
    projectId,
    sheet: document?.logical_name ?? null,
    sourceAssets,
    currentDocumentVersionId: document?.current_version_id ?? null,
    intakeDocumentVersionId: intake?.document_version_id ?? null,
    isReviewerHuman: !isSyntheticActorId(proposal.reviewed_by),
  });
  if (!verdict.ok) {
    return json({
      ok: false,
      proposalId,
      code: verdict.code,
      reason: verdict.reason,
      reviewAuthorityEstablished: false,
    }, verdict.code === "PROPOSAL_NOT_FOUND" ? 404 : 422);
  }

  // The fingerprint is DERIVED here from exactly the evidence resolved above.
  // A reviewer never supplies one, so there is nothing for a caller to forge.
  const fingerprint = governedQuantityClaimFingerprint(verdict.claimInput);
  if (!fingerprint) {
    return json({ ok: false, proposalId, code: "FINGERPRINT_NOT_DERIVABLE", reason: "The reviewed evidence did not yield a derivable claim fingerprint." }, 422);
  }

  // The ONLY production write of drawing_quantity_claims.
  const result = await persistGovernedQuantityClaim(
    env.DB,
    { ...verdict.claimInput, evidenceFingerprint: fingerprint },
    { actorId },
  );
  if (!result.ok) {
    return json({ ok: false, proposalId, code: result.code, reason: result.reason }, result.status ?? 422);
  }

  const c = result.claim ?? {};
  return json({
    ok: true,
    proposalId,
    action: result.action,
    idempotent: Boolean(result.idempotent),
    previousClaimId: result.previousClaimId ?? null,
    claim: {
      id: c.id ?? null,
      versionNumber: c.version_number ?? null,
      sheet: c.sheet ?? null,
      floorOrArea: c.floor_or_area ?? null,
      deviceClass: c.device_class ?? null,
      deviceVariant: c.device_variant ?? null,
      physicalQuantity: c.quantity ?? null,
      countMethod: c.count_method ?? null,
      reviewStatus: c.review_status ?? null,
      state: c.state ?? null,
      documentVersionId: c.document_version_id ?? null,
      isCurrent: c.superseded_at === null,
      evidenceFingerprint: c.evidence_fingerprint ?? null,
      sourceAssetCount: Array.isArray(c.source_asset_ids) ? c.source_asset_ids.length : null,
    },
  }, result.idempotent ? 200 : 201);
};

export default handleDrawingQuantityReviewApi;