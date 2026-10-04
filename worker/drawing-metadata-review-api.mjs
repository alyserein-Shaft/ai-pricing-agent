// GOVERNED DRAWING METADATA -- drawing-number confirmation.
//
// WHY THIS EXISTS. Cross-sheet references read "REFER DWG NO. <number>". Binding
// one to a target document requires a governed drawing number for that target.
// Nothing owned that column, so no symbol identity could become governable
// outside its own legend sheet. This route is the single governed writer for it.
//
// GOVERNANCE RULES ENFORCED HERE (not by prompt, not by convention):
//   * Human actor required (requireHumanActor): provenance may not quote the
//     synthetic single-user identity.
//   * The value must arrive with EVIDENCE: native source asset ids, or a
//     title-block crop transcription digest. A bare number is refused.
//   * A FILENAME IS NOT EVIDENCE. The route has no filename input at all, so it
//     cannot be used to launder `logical_name` into the drawing number.
//   * Currentness: the target intake must be the document's current Completed
//     intake and the caller's document version must still be current.
//   * Every write is audited in drawing_intake_audit_events with full provenance.

import { requireHumanActor } from "./human-actor.mjs";
import { resolveApplicationContext, applicationActor } from "./application-context.mjs";
import { normalizeDrawingNumberToken } from "../app/domain/drawing-title-block-metadata.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-cache": "no-store", "cache-control": "no-store" } });
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

const ownedDocument = (db, documentId, userId, organizationId) => db.prepare(
  "SELECT d.*, p.id AS project_id FROM documents d JOIN projects p ON p.id = d.project_id AND p.owner_user_id = ? AND p.organization_id = ? WHERE d.id = ? AND d.deleted_at IS NULL",
).bind(userId, organizationId, documentId).first();

const currentIntake = (db, documentId) => db.prepare(
  "SELECT * FROM drawing_intake_versions WHERE document_id = ? AND status = 'Completed' AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1",
).bind(documentId).first();

const readMetadata = async (db, document) => {
  const intake = await currentIntake(db, document.id);
  const metadata = intake
    ? await db.prepare("SELECT * FROM drawing_metadata WHERE intake_version_id = ?").bind(intake.id).first()
    : null;
  return {
    projectId: document.project_id,
    documentId: document.id,
    documentVersionId: document.current_version_id,
    drawingIntakeVersionId: intake?.id ?? null,
    drawingNumber: metadata?.drawing_number ?? null,
    sheetName: metadata?.sheet_name ?? null,
    reviewStatus: metadata?.review_status ?? null,
    extractionMethod: metadata?.extraction_method ?? null,
  };
};

export const handleDrawingMetadataReviewApi = async (request, env) => {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/documents\/([^/]+)\/drawing-metadata(?:\/(drawing-number))?$/);
  if (!match) return null;
  if (!env.DB) return json({ error: { code: "DRAWING_METADATA_STORE_UNAVAILABLE", message: "Drawing metadata storage is unavailable." } }, 503);

  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
  const user = applicationActor(resolved.context);
  const document = await ownedDocument(env.DB, decodeURIComponent(match[1]), user.id, user.organizationId);
  if (!document) return json({ error: { code: "DRAWING_NOT_FOUND", message: "Drawing document not found." } }, 404);

  if (request.method === "GET" || !match[2]) return json(await readMetadata(env.DB, document));
  if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } }, 405);

  const human = requireHumanActor(env);
  if (human.error) {
    return json({
      error: {
        code: human.error,
        message: `${human.message} A governed drawing number is a human decision; the synthetic development identity cannot be quoted as its decision-maker.`,
      },
    }, 403);
  }

  const body = await request.json().catch(() => ({}));
  const reason = String(body.reason || "").trim();
  if (reason.length < 5) {
    return json({ error: { code: "DRAWING_METADATA_REASON_REQUIRED", message: "Provide a substantive review reason." } }, 422);
  }

  // Evidence is mandatory. There is deliberately no filename input.
  const sourceAssetIds = Array.isArray(body.sourceAssetIds) ? body.sourceAssetIds.map(String).filter(Boolean) : [];
  const transcriptionDigest = String(body.transcriptionDigest || "").trim();
  const extractionMethod = String(body.extractionMethod || "").trim();
  const cropArtifact = String(body.cropArtifact || "").trim();
  if (!sourceAssetIds.length && !transcriptionDigest) {
    return json({
      error: {
        code: "DRAWING_NUMBER_EVIDENCE_REQUIRED",
        message: "A governed drawing number requires native source asset ids or a title-block crop transcription digest. A filename is not evidence.",
      },
    }, 422);
  }
  if (sourceAssetIds.length && extractionMethod === "TITLE_BLOCK_CROP_VISION_TRANSCRIPTION") {
    return json({ error: { code: "DRAWING_NUMBER_EVIDENCE_CONFLICT", message: "Provide either native asset provenance or a crop transcription digest, not both." } }, 422);
  }

  const drawingNumber = normalizeDrawingNumberToken(body.drawingNumber);
  if (!drawingNumber) {
    return json({ error: { code: "DRAWING_NUMBER_INVALID", message: "The drawing number is not a structured identifier (expected hyphenated segments with digits)." } }, 422);
  }

  const intake = await currentIntake(env.DB, document.id);
  if (!intake) {
    return json({ error: { code: "DRAWING_INTAKE_REQUIRED", message: "Complete Drawing Intake first." } }, 409);
  }
  if (body.documentVersionId && body.documentVersionId !== document.current_version_id) {
    return json({ error: { code: "STALE_DOCUMENT_VERSION_REFUSED", message: "The supplied document version is no longer current." } }, 409);
  }

  const existing = await env.DB.prepare("SELECT * FROM drawing_metadata WHERE intake_version_id = ?").bind(intake.id).first();
  if (!existing) {
    return json({ error: { code: "DRAWING_METADATA_MISSING", message: "Drawing Intake produced no metadata row for this intake." } }, 409);
  }
  if (String(existing.drawing_number || "").trim() === drawingNumber && existing.review_status === "Approved") {
    return json({ ...(await readMetadata(env.DB, document)), idempotent: true });
  }

  const provenance = {
    drawingNumber,
    projectId: document.project_id,
    documentId: document.id,
    documentVersionId: document.current_version_id,
    drawingIntakeVersionId: intake.id,
    pageNumber: Number.isFinite(Number(body.pageNumber)) ? Number(body.pageNumber) : null,
    boundingBox: body.boundingBox ?? null,
    cropRect: body.cropRect ?? null,
    cropArtifact: cropArtifact || null,
    sourceAssetIds,
    transcriptionDigest: transcriptionDigest || null,
    extractionMethod: extractionMethod || "Explicit title-block evidence",
    decidedBy: human.actor.id,
  };

  await env.DB.batch([
    env.DB.prepare(
      "UPDATE drawing_metadata SET drawing_number = ?, confidence = ?, extraction_method = ?, review_status = 'Approved' WHERE id = ?",
    ).bind(drawingNumber, Number(body.confidence || 90), extractionMethod || "Explicit title-block evidence", existing.id),
    env.DB.prepare(
      "INSERT INTO drawing_intake_audit_events (id, project_id, document_id, intake_version_id, action, previous_value, new_value, reason, actor_user_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)",
    ).bind(
      id("drawingAudit"),
      document.project_id,
      document.id,
      intake.id,
      "Drawing Number Confirmed",
      JSON.stringify({ drawingNumber: existing.drawing_number ?? null, reviewStatus: existing.review_status ?? null }),
      JSON.stringify(provenance),
      reason,
      human.actor.id,
    ),
  ]);

  return json({ ...(await readMetadata(env.DB, document)), provenance, decidedBy: human.actor.id, idempotent: false });
};
