// Async Muse vision shadow worker. Mirrors the proven
// specification-extraction-background.mjs pattern: atomic lease claim,
// stale-lease recovery, attempt-bounded retry, atomic finalize.
//
// SHADOW INVARIANT: runs created here carry vision_generation "muse-shadow-1"
// and proposals use extraction_method "Muse visual analysis (shadow)", which
// deliberately does NOT match the production "AI visual analysis%" prefix, so
// shadow output can never leak into production proposal reads. Production
// LLaVA flow is untouched.
import { callMusePerception, isTransportFailure, MUSE_VISION_MODEL_CONFIG_VERSION } from "./drawing-vision-muse-provider.mjs";
import { normalizeEvidenceRecord, buildEvidenceChain } from "../app/domain/project-evidence-corroboration.mjs";

export const VISION_CONTRACT_VERSION = "drawing-visual-async-1.0.0";
export const VISION_ACTIVE_PRODUCTION_GENERATION = "llava-production-1";
export const VISION_MUSE_SHADOW_GENERATION = "muse-shadow-1";
export const VISION_MAX_LOGICAL_ATTEMPTS = 3;
const LEASE_MINUTES = 10;

const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const json = (value) => JSON.stringify(value ?? null);

// Canonical fingerprint serialization. Crop semantics (kind, rect, page,
// stable order) are part of the key: same bytes with a different role or
// region MUST NOT collapse into one job.
export function visionJobFingerprint({ projectId, documentId, documentVersionId, intakeVersionId, pageNumber, crops, contractVersion, modelConfigVersion }) {
  const manifest = (crops || []).map((crop, index) => ({
    index,
    kind: crop.kind === "crop" ? "crop" : "overview",
    pageNumber: crop.pageNumber ?? pageNumber,
    cropRect: crop.cropRect ?? null,
    sha256: crop.sha256,
  }));
  return { key: `vision-job|${projectId}|${documentId}|${documentVersionId}|${intakeVersionId}|${pageNumber}|${json(manifest)}|${contractVersion}|${modelConfigVersion}` };
}

export async function sha256Hex(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// A run is current for downstream ONLY when every dimension matches: live
// document + intake heads, not superseded, AND the active production
// generation. A shadow-generation run therefore can never be current, and an
// old LLaVA run cannot masquerade as current after a future cutover changes
// the active generation.
export function isCurrentVisionRun(run, { currentDocumentVersionId, currentIntakeVersionId, activeGeneration } = {}) {
  if (!run || run.superseded_at) return false;
  if (run.document_version_id !== currentDocumentVersionId) return false;
  if (run.intake_version_id !== currentIntakeVersionId) return false;
  return run.vision_generation === activeGeneration;
}

const docProject = (db, documentId) =>
  db.prepare("SELECT d.id, d.project_id, d.current_version_id FROM documents d WHERE d.id=? AND d.deleted_at IS NULL").bind(documentId).first();

const intakeFor = (db, documentId) =>
  db.prepare("SELECT * FROM drawing_intake_versions WHERE document_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1").bind(documentId).first();

// Foreign-project guard: project scope is derived through the intake/document
// chain (drawing tables carry no project_id of their own for this check).
export async function assertProjectScope(db, { documentId, intakeVersionId }) {
  const document = await docProject(db, documentId);
  if (!document) throw Object.assign(new Error("Document not found."), { code: "DOCUMENT_NOT_FOUND" });
  const intake = intakeVersionId
    ? await db.prepare("SELECT * FROM drawing_intake_versions WHERE id=?").bind(intakeVersionId).first()
    : await intakeFor(db, documentId);
  if (!intake || intake.document_id !== documentId) {
    throw Object.assign(new Error("Drawing intake is not current for this document."), { code: "DRAWING_INTAKE_REQUIRED" });
  }
  if (intake.project_id !== document.project_id) {
    throw Object.assign(new Error("Intake project does not match document project."), { code: "FOREIGN_PROJECT_EVIDENCE" });
  }
  return { document, intake, projectId: document.project_id };
}

export async function createOrGetVisionJob(db, { projectId, documentId, documentVersionId, intakeVersionId, pageNumber, crops, generation = VISION_MUSE_SHADOW_GENERATION }) {
  const { key } = visionJobFingerprint({
    projectId, documentId, documentVersionId, intakeVersionId, pageNumber,
    crops, contractVersion: VISION_CONTRACT_VERSION, modelConfigVersion: MUSE_VISION_MODEL_CONFIG_VERSION,
  });
  const fingerprint = await sha256Hex(key);
  const active = await db.prepare(
    "SELECT * FROM drawing_visual_runs WHERE fingerprint=? AND status IN ('Queued','Running','Retrying') ORDER BY created_at DESC LIMIT 1",
  ).bind(fingerprint).first();
  if (active) return { run: active, idempotent: true };
  const runId = id("drawingVisualRun");
  await db.prepare(
    "INSERT INTO drawing_visual_runs (id,project_id,document_id,document_version_id,intake_version_id,page_number,status,input_manifest,model_info,fingerprint,vision_generation,model_config_version,attempt,max_attempts,created_at) VALUES (?,?,?,?,?,?,'Queued',?,?,?,?,?,0,3,?)",
  ).bind(runId, projectId, documentId, documentVersionId, intakeVersionId, pageNumber,
    json({ purpose: "MuseShadowUnderstanding", crops, contractVersion: VISION_CONTRACT_VERSION }),
    json({ provider: "nvidia-nim", model: "meta/muse-glimmer-30b", generation }),
    fingerprint, generation, MUSE_VISION_MODEL_CONFIG_VERSION, now()).run();
  const run = await db.prepare("SELECT * FROM drawing_visual_runs WHERE id=?").bind(runId).first();
  return { run, idempotent: false };
}

const claimRun = async (db, runId) => {
  const leaseOwner = `visionworker_${crypto.randomUUID()}`;
  // ISO-8601 expiry: SQLite datetime('now') renders space-separated timestamps
  // that miscompare against JS ISO strings (lease would read as always
  // expired). Compute the expiry in JS so both sides share one format.
  const leaseExpiresAt = new Date(Date.now() + LEASE_MINUTES * 60_000).toISOString();
  const claim = await db.prepare(
    "UPDATE drawing_visual_runs SET status='Running',attempt=attempt+1,lease_owner=?,lease_expires_at=? WHERE id=? AND status IN ('Queued','Retrying')",
  ).bind(leaseOwner, leaseExpiresAt, runId).run();
  if (!Number(claim.meta?.changes ?? claim.changes ?? 0)) return null;
  return leaseOwner;
};

// Normalize Muse prose into governed evidence + deterministic gates. Raw text
// is preserved verbatim with provenance; NOTHING here asserts quantity,
// product identity, or connections.
function normalizePerception({ text, run, imageProvenance }) {
  const normalized = normalizeEvidenceRecord({
    documentId: run.document_id, documentVersionId: run.document_version_id,
    page: run.page_number, section: "MuseShadowPerception",
    extractedText: String(text).slice(0, 4000),
    entityKeys: {},
    documentType: "Drawing", sourceType: "AI Inference", reviewState: "Needs Review",
  });
  return { ...normalized, imageProvenance };
}

async function corroborate(db, run, normalizedRecord) {
  // Project-scope guard: legend context is read through THIS run's own intake
  // chain only. A foreign project's legends can never enter this packet.
  const legends = await db.prepare(
    "SELECT e.label, e.description FROM drawing_legend_entries e JOIN drawing_legends l ON l.id=e.legend_id WHERE l.intake_version_id=? ORDER BY e.sequence LIMIT 200",
  ).bind(run.intake_version_id).all().catch(() => ({ results: [] }));
  const rows = legends.results || [];
  const text = String(normalizedRecord.record.extractedText);
  const corroborated = rows.filter((row) =>
    (row.label && text.includes(row.label)) || (row.description && text.toUpperCase().includes(String(row.description).toUpperCase())));
  return { legendEntryCount: rows.length, corroboratedCount: corroborated.length };
}

function applyGates({ text }) {
  const reasons = [];
  // Quantity boundary: transcribed counts stay evidence; nothing becomes a
  // governed quantity claim here (no quantity column is ever written).
  const quantityLike = /\b\d+\s*(nos?\.?|pcs?|units?)\b/i.test(String(text));
  if (quantityLike) reasons.push("QUANTITY_TEXT_QUARANTINED_AS_EVIDENCE_ONLY");
  return { pass: true, reasons, needsReview: true };
}

export async function processVisionRun(env, { runId, dispatch } = {}) {
  const run = await env.DB.prepare("SELECT * FROM drawing_visual_runs WHERE id=?").bind(runId).first();
  if (!run || ["Completed", "Failed"].includes(run.status)) return { terminal: true, run };
  // Stale-lease recovery: a worker that died mid-call releases its claim.
  if (run.status === "Running" && run.lease_expires_at && run.lease_expires_at < now()) {
    await env.DB.prepare("UPDATE drawing_visual_runs SET status='Retrying',lease_owner=NULL,lease_expires_at=NULL WHERE id=?").bind(runId).run();
    return processVisionRun(env, { runId, dispatch });
  }
  const leaseOwner = await claimRun(env.DB, runId);
  if (!leaseOwner) return { claimed: false };
  const live = await env.DB.prepare("SELECT * FROM drawing_visual_runs WHERE id=?").bind(runId).first();

  // Stale-job check BEFORE the provider call: heads may have moved while queued.
  let scope;
  try {
    scope = await assertProjectScope(env.DB, { documentId: live.document_id, intakeVersionId: live.intake_version_id });
    const headsCurrent = scope.document.current_version_id === live.document_version_id
      && scope.intake.id === live.intake_version_id
      && !scope.intake.superseded_at;
    if (!headsCurrent) throw Object.assign(new Error("Job went stale while queued."), { code: "VISION_JOB_STALE" });
  } catch (scopeError) {
    await env.DB.prepare("UPDATE drawing_visual_runs SET status='Failed',error_code=?,completed_at=?,lease_owner=NULL,lease_expires_at=NULL WHERE id=? AND lease_owner=?")
      .bind(scopeError.code || "VISION_JOB_STALE", now(), runId, leaseOwner).run();
    return { terminal: true, stale: true };
  }

  const manifest = JSON.parse(live.input_manifest || "{}");

  try {
    // Load stored crops (never re-render; Worker cannot rasterize PDFs).
    const stored = [];
    for (const crop of manifest.crops || []) {
      const object = await env.FILES.get(crop.objectKey);
      if (!object) throw Object.assign(new Error("Stored crop object is missing."), { code: "STORAGE_OBJECT_MISSING" });
      stored.push({ ...crop, bytes: new Uint8Array(await object.arrayBuffer()) });
    }
    if (!stored.length) throw Object.assign(new Error("No stored crops on this job."), { code: "AI_VISUAL_INPUT_MISSING" });

    // One Muse call per claimed work item. No parallel calls inside a job.
    const perceptions = [];
    for (const crop of stored) {
      const started = Date.now();
      const outcome = await callMusePerception(env, { imageBytes: crop.bytes });
      perceptions.push({ ...outcome, durationMs: Date.now() - started, cropIndex: crop.index });
      await env.DB.prepare("UPDATE drawing_visual_runs SET raw_responses=? WHERE id=?")
        .bind(json(perceptions.map(({ text, finishReason, durationMs, cropIndex }) => ({ text, finishReason, durationMs, cropIndex }))), runId).run();
    }

    const normalized = normalizePerception({
      text: perceptions.map((p) => p.text).join("\n\n"),
      run: live, imageProvenance: stored.map(({ index, kind, cropRect, pageNumber, sha256, objectKey }) => ({ index, kind, cropRect, pageNumber, sha256, objectKey })),
    });
    if (!normalized.ok) throw Object.assign(new Error(normalized.error), { code: "EVIDENCE_NORMALIZE_FAILED" });
    const corroboration = await corroborate(env.DB, live, normalized);
    const gates = applyGates({ text: normalized.record.extractedText });
    const chain = buildEvidenceChain({
      conclusion: `Muse shadow perception for page ${live.page_number} (proposal only)`,
      supports: [{ ...normalized.record }],
    });

    // Re-check currentness + lease immediately before persistence: a job that
    // went stale DURING the Muse call keeps auditable history but publishes
    // nothing current.
    const fresh = await env.DB.prepare("SELECT * FROM drawing_visual_runs WHERE id=?").bind(runId).first();
    const rescope = await assertProjectScope(env.DB, { documentId: live.document_id, intakeVersionId: live.intake_version_id }).catch(() => null);
    const stillCurrent = rescope
      && rescope.document.current_version_id === live.document_version_id
      && rescope.intake.id === live.intake_version_id
      && !rescope.intake.superseded_at
      && !fresh.superseded_at
      && fresh.lease_owner === leaseOwner;
    const timestamp = now();
    // At-least-once safety: a redelivered queue message that already finalized
    // finds existing shadow proposals for this run and publishes nothing twice.
    const existing = await env.DB.prepare(
      "SELECT id FROM drawing_extraction_proposals WHERE visual_run_id=? AND extraction_method='Muse visual analysis (shadow)' LIMIT 1",
    ).bind(runId).first();
    const statements = [];
    if (stillCurrent && !existing) {
      // Shadow proposals deliberately do NOT match the production
      // "AI visual analysis%" prefix, so production reads never see them.
      perceptions.forEach((perception, i) => {
        statements.push(env.DB.prepare(
          "INSERT INTO drawing_extraction_proposals (id,project_id,document_id,intake_version_id,page_number,proposal_key,proposal_type,raw_label,normalized_value,bounding_box,confidence,authority_role,governed_status,hard_review_reasons,evidence,source_references,extraction_method,extraction_version,review_status,created_at,updated_at,visual_run_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ).bind(id("drawingExtractionProposal"), live.project_id, live.document_id, live.intake_version_id, live.page_number,
          `${runId}:muse-shadow:${i}`, "VisualObservation", String(perception.text).slice(0, 120), null, null, null,
          "Unsupported", "Needs Review", json(["Muse shadow perception: human review required", ...gates.reasons]),
          json({ visualRunId: runId, fullText: String(perception.text).slice(0, 4000), corroboration, chain: chain.ok ? chain : null, finishReason: perception.finishReason }),
          json([]), "Muse visual analysis (shadow)", VISION_CONTRACT_VERSION, "Needs Review", timestamp, timestamp, runId));
      });
    }
    statements.push(env.DB.prepare(
      "UPDATE drawing_visual_runs SET status='Completed',result=?,completed_at=?,lease_owner=NULL,lease_expires_at=NULL,retryable=NULL WHERE id=? AND lease_owner=?",
    ).bind(json({ perceptions: perceptions.length, corroboration, gates, stalePublished: !stillCurrent }), timestamp, runId, leaseOwner));
    await env.DB.batch(statements);
    return { terminal: true, published: stillCurrent && !existing };
  } catch (error) {
    // Semantic NEEDS_REVIEW-style outcomes arrive as Completed runs, never as
    // errors; only transport/provider/worker failures land here.
    const current = await env.DB.prepare("SELECT attempt,max_attempts FROM drawing_visual_runs WHERE id=?").bind(runId).first();
    const transportFailure = isTransportFailure(error.code) || ["AI_PROVIDER_ERROR", "STORAGE_OBJECT_MISSING", "AI_VISUAL_INPUT_MISSING"].includes(error.code);
    const retry = transportFailure && Number(current.attempt) < Number(current.max_attempts);
    await env.DB.prepare("UPDATE drawing_visual_runs SET status=?,error_code=?,completed_at=?,lease_owner=NULL,lease_expires_at=NULL,retryable=? WHERE id=? AND lease_owner=?")
      .bind(retry ? "Retrying" : "Failed", error.code || "VISION_WORKER_FAILED", retry ? null : now(), retry ? 1 : 0, runId, leaseOwner).run();
    if (retry && dispatch) await dispatch({ runId }).catch(() => undefined);
    return { terminal: !retry, retried: retry, error: error.code };
  }
}

export async function retryVisionRun(db, runId) {
  const run = await db.prepare("SELECT * FROM drawing_visual_runs WHERE id=?").bind(runId).first();
  if (!run) throw Object.assign(new Error("Run not found."), { code: "VISION_RUN_NOT_FOUND" });
  if (run.status !== "Failed" || !run.retryable) {
    throw Object.assign(new Error("Only failed retryable runs may be retried."), { code: "VISION_RETRY_NOT_ALLOWED" });
  }
  await db.prepare("UPDATE drawing_visual_runs SET status='Retrying',error_code=NULL,lease_owner=NULL,lease_expires_at=NULL WHERE id=?").bind(runId).run();
  return { runId, status: "Retrying" };
}

export async function visionRunStatus(db, runId) {
  const run = await db.prepare("SELECT * FROM drawing_visual_runs WHERE id=?").bind(runId).first();
  if (!run) return null;
  const proposals = await db.prepare("SELECT COUNT(*) AS n FROM drawing_extraction_proposals WHERE visual_run_id=?").bind(runId).first();
  return {
    runId: run.id, status: run.status, attempt: run.attempt, maxAttempts: run.max_attempts,
    retryable: Boolean(run.retryable), errorCode: run.error_code,
    current: null, // resolved by the caller against live heads via isCurrentVisionRun
    superseded: Boolean(run.superseded_at),
    completedAt: run.completed_at, proposalsAvailable: Number(proposals?.n || 0),
    modelConfigVersion: run.model_config_version, visionGeneration: run.vision_generation,
  };
}
