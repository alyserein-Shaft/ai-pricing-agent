// Stage 10 (2026-09-01): DRAWING UI CLOSURE, Section 10/11.
//
// A drawing engineer needs one honest answer to "does this drawing affect a
// BOQ item?" without navigating to a separate Requirement screen. This is
// the ONLY new backend surface Stage 10 required (Section: "Do NOT create
// new backend architecture unless a UI action genuinely needs it") -- it
// reads the SAME requirement_profile_versions rows Stage 9 already writes,
// live, never a new persisted mapping. A drawing document has no direct FK
// to a BOQ item (Stage 9 established this is resolved live via the governed
// System Knowledge Registry link), so this endpoint reproduces that same
// read, scoped to one document, for display only -- it writes nothing.
import { applicationActor, resolveApplicationContext } from "./application-context.mjs";
import { currentSymbolRecognitionVersion } from "./drawing-symbol-recognition-api.mjs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const parse = (value, fallback = null) => { try { return JSON.parse(value || ""); } catch { return fallback; } };

const ownedDocument = (db, documentId, userId, organizationId) =>
  db.prepare("SELECT d.*, p.id project_id FROM documents d JOIN projects p ON p.id=d.project_id AND p.owner_user_id=? AND p.organization_id=? WHERE d.id=? AND d.deleted_at IS NULL")
    .bind(userId, organizationId, documentId).first();

const currentRecognitionVersionId = (db, documentId) => currentSymbolRecognitionVersion(db, documentId);

export const handleDrawingRequirementImpactApi = async (request, env) => {
  const url = new URL(request.url);
  if (!url.pathname.includes("drawing-requirement-impact")) return null;
  if (!env.DB) return json({ error: { code: "REQUIREMENT_IMPACT_UNAVAILABLE", message: "Requirement impact storage is unavailable." } }, 503);
  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
  const user = applicationActor(resolved.context);
  const match = url.pathname.match(/^\/api\/documents\/([^/]+)\/drawing-requirement-impact$/);
  if (!match || request.method !== "GET") return null;
  const document = await ownedDocument(env.DB, decodeURIComponent(match[1]), user.id, user.organizationId);
  if (!document) return json({ error: { code: "DRAWING_NOT_FOUND", message: "Drawing document not found." } }, 404);

  const currentVersion = await currentRecognitionVersionId(env.DB, document.id);
  const rows = await env.DB.prepare(
    "SELECT p.id profile_id, p.boq_item_id, p.readiness_status, p.profile, b.item_number, b.description, b.numeric_quantity FROM requirement_profile_versions p JOIN boq_items b ON b.id=p.boq_item_id WHERE p.project_id=? AND p.superseded_at IS NULL",
  ).bind(document.project_id).all();

  const items = [];
  for (const row of rows.results || []) {
    const profile = parse(row.profile, {});
    const consolidated = profile.consolidatedRequirements || [];
    const drawingGroup = consolidated.find((entry) => entry.sources?.some((source) => source.sourceType === "Drawing" && source.source?.documentId === document.id));
    if (!drawingGroup) continue;
    const drawingSource = drawingGroup.sources.find((source) => source.sourceType === "Drawing");
    const boqSide = consolidated.find((entry) => entry.sources?.some((source) => source.sourceType === "BOQ"));
    const conflict = (profile.conflicts || []).find((entry) => entry.attribute === "Family");
    items.push({
      boqItemId: row.boq_item_id,
      itemNumber: row.item_number,
      description: row.description,
      numericQuantity: row.numeric_quantity != null ? Number(row.numeric_quantity) : null,
      system: profile.boqItem?.system || null,
      family: profile.boqItem?.productFamily || null,
      drawingDescription: drawingGroup.normalizedRequirement,
      boqDescription: boqSide?.normalizedRequirement || null,
      readinessStatus: row.readiness_status,
      conflict: conflict ? { attribute: conflict.attribute, values: conflict.values, technicalImpact: conflict.technicalImpact } : null,
      stale: Boolean(currentVersion && drawingSource.source?.recognitionVersionId && drawingSource.source.recognitionVersionId !== currentVersion.id),
    });
  }
  return json({ documentId: document.id, currentRecognitionVersionId: currentVersion?.id || null, items });
};
