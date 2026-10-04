// Async Muse vision shadow handoff + status + retry endpoints, and the queue
// producer/consumer pair. Mirrors worker/specification-extraction-api.mjs.
//
// SHADOW MODE: the handoff requires an explicit opt-in (`mode:
// "muse-shadow"`). Without it the request is refused; the LLaVA production
// path is never displaced by default.
//
// Route mount: worker/index.ts dispatches handleDrawingVisionQueueApi (the
// legacy visual-analysis handler was never mounted there; this new handler is
// mounted explicitly and does not alter any existing route).
import { assertProjectScope, createOrGetVisionJob, processVisionRun, retryVisionRun, visionRunStatus } from "./drawing-vision-background.mjs";

const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

const MAX_CROP_IMAGES = 8;
const MAX_IMAGE_BASE64_LENGTH = 6_000_000;

export const dispatchVisionWork = async (env, ctx, message) => {
  if (env.VISION_QUEUE?.send) return env.VISION_QUEUE.send(message);
  const run = (payload) => processVisionRun(env, { ...payload, dispatch: async (next) => run(next) });
  ctx.waitUntil(run(message).catch(() => undefined));
};

export const handleDrawingVisionQueue = async (batch, env) => {
  for (const message of batch.messages || []) {
    // Queues share one worker entrypoint; only claim vision-shaped messages.
    // Anything else belongs to another consumer and is left for it.
    if (!message.body || typeof message.body.runId !== "string" || !message.body.runId.startsWith("drawingVisualRun_")) continue;
    try {
      await processVisionRun(env, { ...message.body, dispatch: (next) => env.VISION_QUEUE.send(next) });
      message.ack();
    } catch {
      message.retry();
    }
  }
};

const base64ToBytes = (base64) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

export const handleDrawingVisionQueueApi = async (request, env, ctx) => {
  const url = new URL(request.url);
  const submit = url.pathname.match(/^\/api\/documents\/([^/]+)\/drawing-vision\/async$/);
  const statusRoute = url.pathname.match(/^\/api\/documents\/([^/]+)\/drawing-vision\/runs\/([^/]+)$/);
  const retryRoute = url.pathname.match(/^\/api\/documents\/([^/]+)\/drawing-vision\/runs\/([^/]+)\/retry$/);
  if (!submit && !statusRoute && !retryRoute) return null;

  const documentId = (submit || statusRoute || retryRoute)[1];
  if (request.method === "POST" && submit) {
    const body = await request.json().catch(() => null);
    // SHADOW GATE: explicit opt-in only. Production default is unchanged.
    if (body?.mode !== "muse-shadow") {
      return json({ error: { code: "VISION_SHADOW_MODE_REQUIRED", message: "Async Muse vision requires explicit mode 'muse-shadow'. Production LLaVA flow is unchanged." } }, 400);
    }
    const pageNumber = Number(body.pageNumber ?? 1);
    const images = Array.isArray(body.images) ? body.images.slice(0, MAX_CROP_IMAGES) : [];
    if (!Number.isFinite(pageNumber) || !images.length) {
      return json({ error: { code: "AI_VISUAL_INPUT_MISSING", message: "At least one client-rendered crop image is required." } }, 400);
    }
    for (const image of images) {
      if (typeof image.base64 !== "string" || !image.base64 || image.base64.length > MAX_IMAGE_BASE64_LENGTH) {
        return json({ error: { code: "AI_VISUAL_INPUT_INVALID", message: "Each image must be a non-empty, reasonably sized base64-encoded PNG/JPEG." } }, 400);
      }
    }
    let scope;
    try {
      scope = await assertProjectScope(env.DB, { documentId });
    } catch (scopeError) {
      const code = scopeError.code || "DOCUMENT_NOT_FOUND";
      return json({ error: { code, message: scopeError.message } }, code === "FOREIGN_PROJECT_EVIDENCE" ? 403 : 404);
    }
    if (!env.FILES?.put) {
      return json({ error: { code: "AI_TRACE_STORAGE_REQUIRED", message: "Protected file storage is required to preserve analysis inputs." } }, 503);
    }
    // Persist client-rendered bytes first (Worker cannot rasterize PDFs), then
    // fingerprint. A placeholder runId namespaces the objects; the durable run
    // row is created idempotently below.
    const uploadId = id("drawingVisionUpload");
    const crops = [];
    for (const [index, image] of images.entries()) {
      const bytes = base64ToBytes(image.base64);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const sha256 = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
      const objectKey = `projects/${scope.projectId}/documents/${documentId}/vision-shadow/${uploadId}/image-${index}.png`;
      await env.FILES.put(objectKey, bytes, { httpMetadata: { contentType: "image/png" } });
      crops.push({ index, kind: image.kind === "crop" ? "crop" : "overview", cropRect: image.cropRect ?? null, pageNumber, sha256, objectKey });
    }
    const { run, idempotent } = await createOrGetVisionJob(env.DB, {
      projectId: scope.projectId, documentId,
      documentVersionId: scope.document.current_version_id, intakeVersionId: scope.intake.id,
      pageNumber, crops,
    });
    if (!idempotent) await dispatchVisionWork(env, ctx, { runId: run.id });
    return json({
      runId: run.id, status: run.status, idempotent,
      statusUrl: `/api/documents/${documentId}/drawing-vision/runs/${run.id}`,
    }, idempotent ? 200 : 202);
  }

  if (request.method === "GET" && statusRoute) {
    const row = await env.DB.prepare("SELECT document_id FROM drawing_visual_runs WHERE id=?").bind(statusRoute[2]).first().catch(() => null);
    if (!row) return json({ error: { code: "VISION_RUN_NOT_FOUND", message: "Vision run not found." } }, 404);
    if (row.document_id !== documentId) {
      return json({ error: { code: "FOREIGN_PROJECT_EVIDENCE", message: "Run does not belong to this document." } }, 403);
    }
    return json(await visionRunStatus(env.DB, statusRoute[2]));
  }

  if (request.method === "POST" && retryRoute) {
    const row = await env.DB.prepare("SELECT document_id FROM drawing_visual_runs WHERE id=?").bind(retryRoute[2]).first().catch(() => null);
    if (!row) return json({ error: { code: "VISION_RUN_NOT_FOUND", message: "Vision run not found." } }, 404);
    if (row.document_id !== documentId) return json({ error: { code: "FOREIGN_PROJECT_EVIDENCE", message: "Run does not belong to this document." } }, 403);
    try {
      const retried = await retryVisionRun(env.DB, retryRoute[2]);
      await dispatchVisionWork(env, ctx, { runId: retryRoute[2] });
      return json(retried, 202);
    } catch (retryError) {
      return json({ error: { code: retryError.code || "VISION_RETRY_FAILED", message: retryError.message } }, 409);
    }
  }

  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Unsupported method for this vision route." } }, 405);
};
