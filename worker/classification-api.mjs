import { requireMigratedTables } from "./schema-requirements.mjs";
import {
  CLASSIFICATION_TAXONOMY, CLASSIFIER_VERSION, DOWNSTREAM_ROUTES, PROMPT_VERSION, RULESET_VERSION,
  classifyDocumentBytes,
} from "../app/domain/document-classifier.mjs";
import { executeBoqExtraction } from "./boq-extraction-api.mjs";
import { createSpecificationJob, processSpecificationJob } from "./specification-extraction-background.mjs";
import { applicationActor, resolveApplicationContext } from "./application-context.mjs";
import { executeSupplierQuoteExtraction } from "./supplier-price-intake-api.mjs";
import { executeProjectContextExtraction } from "./project-context-api.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

const CLASSIFICATION_SCHEMA_TABLES = ["classification_model_versions", "document_classifications", "classification_candidates", "classification_evidence", "classification_segments", "classification_overrides", "downstream_routing_handoffs"];
let initialized = false;
export const ensureClassificationSchema = async (db) => { if (!initialized) { await requireMigratedTables(db, CLASSIFICATION_SCHEMA_TABLES); initialized = true; } };

const ownedDocument = (db, documentId, userId) => db.prepare("SELECT d.*, p.name AS project_name, p.owner_user_id, v.id AS version_id, v.original_filename, v.extension, v.mime_type, v.byte_size, v.sha256, v.object_key, v.quarantine_status, v.revision, r.id AS job_id, r.status AS job_status, r.progress, r.attempt, r.max_attempts FROM documents d JOIN projects p ON p.id=d.project_id JOIN document_versions v ON v.id=d.current_version_id LEFT JOIN document_processing_runs r ON r.id=(SELECT id FROM document_processing_runs WHERE document_version_id=v.id ORDER BY created_at DESC LIMIT 1) WHERE d.id=? AND p.owner_user_id=? AND d.deleted_at IS NULL").bind(documentId, userId).first();
const currentClassification = (db, documentId) => db.prepare("SELECT * FROM document_classifications WHERE document_id=? AND superseded_at IS NULL ORDER BY classified_at DESC LIMIT 1").bind(documentId).first();

const updateJob = async (db, runId, { fromStatus, toStatus, progress, stage = "Classification", actor = "Classification Worker", error = null, message = "" }) => {
  const stamp = now();
  await db.batch([
    db.prepare("UPDATE document_processing_runs SET stage=?, status=?, progress=?, error_code=?, error_message=?, technical_details=?, suggested_action=?, started_at=CASE WHEN started_at IS NULL THEN ? ELSE started_at END, completed_at=CASE WHEN ? IN ('Completed','Needs Review','Failed','Cancelled') THEN ? ELSE NULL END, updated_at=? WHERE id=?").bind(stage, toStatus, progress, error?.code || null, error?.userMessage || null, error?.technicalDetails || null, error?.suggestedAction || null, stamp, toStatus, stamp, stamp, runId),
    db.prepare("INSERT INTO processing_history (id, run_id, from_status, to_status, progress, actor, error_code, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id("history"), runId, fromStatus || null, toStatus, progress, actor, error?.code || null, message || error?.userMessage || null),
  ]);
};

const modelVersion = async (db) => {
  let model = await db.prepare("SELECT id FROM classification_model_versions WHERE classifier_version=? AND ruleset_version=? AND prompt_version=?").bind(CLASSIFIER_VERSION, RULESET_VERSION, PROMPT_VERSION).first();
  if (model) return model.id;
  const modelId = id("classmodel");
  await db.prepare("INSERT INTO classification_model_versions (id, classifier_version, ruleset_version, prompt_version, ai_model_version, configuration) VALUES (?, ?, ?, ?, NULL, ?)").bind(modelId, CLASSIFIER_VERSION, RULESET_VERSION, PROMPT_VERSION, JSON.stringify({ deterministicRules: true, lexicalStatisticalModel: true, aiEscalation: "Not configured", filenameWeight: "supporting-only" })).run();
  return modelId;
};

const persistResult = async (env, document, runId, result, actor) => {
  const classificationId = id("class");
  const modelVersionId = await modelVersion(env.DB);
  const previous = await currentClassification(env.DB, document.id);
  const stamp = now();
  const statements = [];
  if (previous) statements.push(env.DB.prepare("UPDATE document_classifications SET superseded_at=? WHERE id=?").bind(stamp, previous.id));
  statements.push(env.DB.prepare("INSERT INTO document_classifications (id, document_id, document_version_id, processing_run_id, model_version_id, primary_type, secondary_types, confidence, confidence_state, status, method, extraction_method, extraction_quality_basis_points, mixed, manual_review_required, downstream_route, error_code, error_message, technical_details, suggested_action, classified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(classificationId, document.id, document.version_id, runId, modelVersionId, result.primaryType, JSON.stringify(result.secondaryTypes || []), result.confidence, result.confidenceState, result.status, result.method, result.extractionMethod || null, Math.round((result.extractionQuality || 0) * 10000), result.mixed ? 1 : 0, result.manualReviewRequired ? 1 : 0, result.downstreamRoute, result.error?.code || null, result.error?.userMessage || null, result.error?.technicalDetails || null, result.error?.suggestedAction || null, stamp));
  (result.alternatives || []).forEach((candidate, index) => statements.push(env.DB.prepare("INSERT INTO classification_candidates (id, classification_id, document_type, rank, confidence, score_basis_points) VALUES (?, ?, ?, ?, ?, ?)").bind(id("candidate"), classificationId, candidate.type, index + 2, candidate.confidence, Math.round((candidate.score || 0) * 100))));
  (result.evidence || []).forEach((evidence) => statements.push(env.DB.prepare("INSERT INTO classification_evidence (id, classification_id, category, evidence_kind, label, excerpt, weight, method, page_from, page_to, sheet_name, section) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id("evidence"), classificationId, evidence.category, evidence.kind, evidence.label, evidence.excerpt || null, evidence.weight, evidence.method, evidence.pageFrom, evidence.pageTo, evidence.sheetName, evidence.section)));
  (result.segments || []).forEach((segment) => statements.push(env.DB.prepare("INSERT INTO classification_segments (id, classification_id, segment_kind, label, page_from, page_to, sheet_name, section, primary_type, confidence, evidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id("segment"), classificationId, segment.kind, segment.label, segment.pageFrom, segment.pageTo, segment.sheetName, segment.section, segment.primaryType, segment.confidence, JSON.stringify(segment.evidence || []))));
  const eligible = !result.manualReviewRequired && result.primaryType !== "Unknown";
  statements.push(
    env.DB.prepare("INSERT INTO downstream_routing_handoffs (id, classification_id, document_version_id, route, status, eligible, blocker) VALUES (?, ?, ?, ?, 'Decision Only', ?, ?)").bind(id("route"), classificationId, document.version_id, result.downstreamRoute, eligible ? 1 : 0, eligible ? null : result.error?.userMessage || "Human classification confirmation required"),
    env.DB.prepare("UPDATE documents SET document_type=?, classification_source=?, updated_at=? WHERE id=?").bind(result.primaryType, result.method, stamp, document.id),
    env.DB.prepare("INSERT INTO document_audit_events (id, project_id, document_id, version_id, actor_user_id, action, old_value, new_value, reason, request_id) VALUES (?, ?, ?, ?, ?, 'Classification Completed', ?, ?, ?, ?)").bind(id("audit"), document.project_id, document.id, document.version_id, actor, JSON.stringify(previous ? { primaryType: previous.primary_type, confidence: previous.confidence } : null), JSON.stringify({ primaryType: result.primaryType, confidence: result.confidence, status: result.status, route: result.downstreamRoute }), result.manualReviewRequired ? "Automated result requires human review" : "Evidence-backed classification completed", id("request")),
  );
  await env.DB.batch(statements);
  return classificationId;
};

export const executeClassification = async (env, { documentId, userId, runId = null, reason = "Automatic classification after upload" }) => {
  await ensureClassificationSchema(env.DB);
  const document = await ownedDocument(env.DB, documentId, userId);
  if (!document) throw Object.assign(new Error("Document is unavailable or not owned by this user."), { code: "DOCUMENT_FORBIDDEN" });
  let jobId = runId || document.job_id;
  if (!jobId || ["Completed", "Needs Review", "Failed", "Cancelled"].includes(document.job_status)) {
    jobId = id("job");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO document_processing_runs (id, document_version_id, stage, status, progress, processor_version) VALUES (?, ?, 'Classification', 'Queued', 1, ?)").bind(jobId, document.version_id, CLASSIFIER_VERSION),
      env.DB.prepare("INSERT INTO processing_history (id, run_id, from_status, to_status, progress, actor, message) VALUES (?, ?, NULL, 'Queued', 1, ?, ?)").bind(id("history"), jobId, userId, reason),
    ]);
  }
  await updateJob(env.DB, jobId, { fromStatus: document.job_status || "Queued", toStatus: "Processing", progress: 20, actor: "Classification Worker", message: "Reading stored content and document structure." });
  try {
    const object = await env.FILES.get(document.object_key);
    if (!object) throw Object.assign(new Error("Stored source object is missing."), { code: "STORAGE_OBJECT_MISSING" });
    const bytes = new Uint8Array(await object.arrayBuffer());
    await updateJob(env.DB, jobId, { fromStatus: "Processing", toStatus: "Processing", progress: 55, actor: "Classification Worker", message: "Scoring content, structure and project context." });
    const classificationStarted = Date.now();
    const result = classifyDocumentBytes(bytes, { extension: document.extension, fileName: document.original_filename, declaredType: document.classification_source === "Manual Override" ? document.document_type : "Auto Detection", projectContext: `${document.project_name || ""}` });
    if (Date.now() - classificationStarted > 25_000) throw Object.assign(new Error("Classification exceeded the 25 second worker budget."), { code: "CLASSIFICATION_TIMEOUT" });
    const classificationId = await persistResult(env, document, jobId, result, "Classification Worker");
    await updateJob(env.DB, jobId, { fromStatus: "Processing", toStatus: result.manualReviewRequired ? "Needs Review" : "Completed", progress: 100, actor: "Classification Worker", error: result.error, message: result.error?.userMessage || `${result.primaryType} classified at ${result.confidence}% confidence.` });
    return { classificationId, result };
  } catch (error) {
    const detail = { code: error.code || "CLASSIFICATION_FAILED", userMessage: "The document could not be classified.", technicalDetails: error instanceof Error ? error.message : String(error), suggestedAction: "Retry classification or select a document type manually." };
    await updateJob(env.DB, jobId, { fromStatus: "Processing", toStatus: "Failed", progress: 100, actor: "Classification Worker", error: detail });
    throw Object.assign(new Error(detail.userMessage), detail);
  }
};

const executeConfirmedDownstreamExtraction = async (env, ctx, { documentId, userId, primaryType, reason }) => {
  if (primaryType === "BOQ") return executeBoqExtraction(env, { documentId, userId, reason });
  if (primaryType === "Technical Specification") {
    const created = await createSpecificationJob(env, { documentId, userId, reason });
    if (!created.idempotent) {
      if (env.SPECIFICATION_QUEUE?.send) await env.SPECIFICATION_QUEUE.send({ jobId: created.job.id });
      else { const run = (message) => processSpecificationJob(env, { ...message, dispatch: run }); ctx.waitUntil(run({ jobId: created.job.id }).catch(() => undefined)); }
    }
    return created;
  }
  if (["Supplier Quotation", "Supplier Quote"].includes(primaryType)) return executeSupplierQuoteExtraction(env, { documentId, userId });
  if (primaryType === "Project Context") return executeProjectContextExtraction(env, { documentId, userId });
  return undefined;
};

const recordDownstreamFailure = async (env, { classificationId, error }) => {
  const classification = await env.DB.prepare(
    "SELECT processing_run_id FROM document_classifications WHERE id=?",
  ).bind(classificationId).first();
  if (!classification?.processing_run_id) return;

  const detail = {
    code: error?.code || "DOWNSTREAM_EXTRACTION_FAILED",
    userMessage: "The document was classified, but its downstream extraction failed.",
    technicalDetails: error instanceof Error ? error.message : String(error),
    suggestedAction: "Retry document processing or open the governed downstream review.",
  };

  await updateJob(env.DB, classification.processing_run_id, {
    fromStatus: "Completed",
    toStatus: "Failed",
    progress: 100,
    stage: "Downstream Extraction",
    actor: "Automatic Downstream Router",
    error: detail,
    message: detail.userMessage,
  });
};

export const scheduleAutomaticClassification = (env, ctx, { documentId, userId, runId }) => ctx.waitUntil(
  executeClassification(env, { documentId, userId, runId })
    .then(async ({ classificationId, result }) => {
      if (result.manualReviewRequired) return undefined;
      try {
        return await executeConfirmedDownstreamExtraction(env, ctx, {
          documentId,
          userId,
          primaryType: result.primaryType,
          reason: `Automatic extraction after confirmed high-confidence ${result.primaryType} classification`,
        });
      } catch (error) {
        await recordDownstreamFailure(env, { classificationId, error });
        return undefined;
      }
    }),
);

const resultPayload = async (db, documentId) => {
  const classification = await currentClassification(db, documentId);
  if (!classification) return null;
  const [candidates, evidence, segments, route] = await Promise.all([
    db.prepare("SELECT document_type AS type, rank, confidence, score_basis_points FROM classification_candidates WHERE classification_id=? ORDER BY rank").bind(classification.id).all(),
    db.prepare("SELECT category, evidence_kind AS kind, label, excerpt, weight, method, page_from, page_to, sheet_name, section FROM classification_evidence WHERE classification_id=? ORDER BY weight DESC").bind(classification.id).all(),
    db.prepare("SELECT * FROM classification_segments WHERE classification_id=? ORDER BY COALESCE(page_from, 0), sheet_name, label").bind(classification.id).all(),
    db.prepare("SELECT * FROM downstream_routing_handoffs WHERE classification_id=? ORDER BY created_at DESC LIMIT 1").bind(classification.id).first(),
  ]);
  return { ...classification, secondary_types: JSON.parse(classification.secondary_types || "[]"), candidates: candidates.results || [], evidence: evidence.results || [], segments: (segments.results || []).map((segment) => ({ ...segment, evidence: JSON.parse(segment.evidence || "[]") })), route };
};


const createManualClassification = async (request, env, ctx, document, user) => {
  const db = env.DB;
  const body = await request.json();
  const selectedType = String(body.selectedType || "").trim();
  const secondaryTypes = Array.isArray(body.secondaryTypes)
    ? body.secondaryTypes
        .filter((type) => CLASSIFICATION_TAXONOMY.includes(type) && type !== selectedType)
        .slice(0, 10)
    : [];
  const reason = String(body.reason || "").trim();

  if (!CLASSIFICATION_TAXONOMY.includes(selectedType)) {
    return json({
      error: {
        code: "INVALID_CLASSIFICATION",
        message: "Select a supported document type.",
        suggestedAction: "Choose from the classification taxonomy.",
      },
    }, 422);
  }

  if (reason.length < 3) {
    return json({
      error: {
        code: "MANUAL_CLASSIFICATION_REASON_REQUIRED",
        message: "Provide a substantive reason for the manual classification.",
        suggestedAction: "Describe the visible file content that identifies the document type.",
      },
    }, 422);
  }

  const classificationId = id("class");
  const modelVersionId = await modelVersion(db);
  const stamp = now();
  const route = DOWNSTREAM_ROUTES[selectedType] || DOWNSTREAM_ROUTES.Unknown;
  const requestId = request.headers.get("x-request-id") || id("request");

  await db.batch([
    db.prepare(
      "INSERT INTO document_classifications (id, document_id, document_version_id, processing_run_id, model_version_id, primary_type, secondary_types, confidence, confidence_state, status, method, extraction_method, extraction_quality_basis_points, mixed, manual_review_required, downstream_route, confirmed_by, confirmed_at, classified_at) VALUES (?, ?, ?, NULL, ?, ?, ?, 0, 'Human Confirmed', 'Manually Confirmed', 'Manual Confirmation', NULL, NULL, 0, 0, ?, ?, ?, ?)"
    ).bind(
      classificationId,
      document.id,
      document.version_id,
      modelVersionId,
      selectedType,
      JSON.stringify(secondaryTypes),
      route,
      user.id,
      stamp,
      stamp,
    ),
    db.prepare(
      "INSERT INTO downstream_routing_handoffs (id, classification_id, document_version_id, route, status, eligible, blocker) VALUES (?, ?, ?, ?, 'Decision Only', 1, NULL)"
    ).bind(id("route"), classificationId, document.version_id, route),
    db.prepare(
      "UPDATE documents SET document_type=?, classification_source='Manual Confirmation', updated_at=? WHERE id=?"
    ).bind(selectedType, stamp, document.id),
    db.prepare(
      "INSERT INTO classification_overrides (id, classification_id, document_id, previous_type, selected_type, secondary_types, reason, overridden_by) VALUES (?, ?, ?, 'Unknown', ?, ?, ?, ?)"
    ).bind(
      id("override"),
      classificationId,
      document.id,
      selectedType,
      JSON.stringify(secondaryTypes),
      reason,
      user.id,
    ),
    db.prepare(
      "INSERT INTO document_audit_events (id, project_id, document_id, version_id, actor_user_id, action, old_value, new_value, reason, request_id) VALUES (?, ?, ?, ?, ?, 'Manual Classification Recovery', ?, ?, ?, ?)"
    ).bind(
      id("audit"),
      document.project_id,
      document.id,
      document.version_id,
      user.id,
      JSON.stringify({
        primaryType: "Unknown",
        processingStatus: document.job_status || "Not Classified",
      }),
      JSON.stringify({
        primaryType: selectedType,
        secondaryTypes,
        confidence: 0,
        confidenceState: "Human Confirmed",
        status: "Manually Confirmed",
        route,
      }),
      reason,
      requestId,
    ),
  ]);

  if (
    body.startExtraction === true &&
    ["BOQ", "Technical Specification", "Supplier Quotation", "Supplier Quote", "Project Context"].includes(selectedType)
  ) {
    ctx.waitUntil(
      Promise.resolve(
        executeConfirmedDownstreamExtraction(env, ctx, {
          documentId: document.id,
          userId: user.id,
          primaryType: selectedType,
          reason: `Explicit extraction after manual ${selectedType} classification`,
        }),
      ).catch(() => undefined),
    );
  }

  return json({
    classification: await resultPayload(db, document.id),
    requestId,
    manualRecovery: true,
  });
};

const confirmOrOverride = async (request, env, ctx, document, classification, user, mode) => {
  const db = env.DB;
  const body = await request.json();
  const selectedType = mode === "confirm" ? classification.primary_type : String(body.selectedType || "");
  const secondaryTypes = Array.isArray(body.secondaryTypes) ? body.secondaryTypes.filter((type) => CLASSIFICATION_TAXONOMY.includes(type) && type !== selectedType).slice(0, 10) : JSON.parse(classification.secondary_types || "[]");
  const reason = String(body.reason || "").trim();
  if (!CLASSIFICATION_TAXONOMY.includes(selectedType)) return json({ error: { code: "INVALID_CLASSIFICATION", message: "Select a supported document type.", suggestedAction: "Choose from the classification taxonomy." } }, 422);
  if (mode === "override" && ["High Confidence", "Verified"].includes(classification.confidence_state) && reason.length < 10) return json({ error: { code: "OVERRIDE_REASON_REQUIRED", message: "A substantive reason is required to override this high-confidence result.", suggestedAction: "Explain the contradictory evidence." } }, 422);
  const stamp = now();
  const route = DOWNSTREAM_ROUTES[selectedType] || DOWNSTREAM_ROUTES.Unknown;
  const requestId = request.headers.get("x-request-id") || id("request");
  await db.batch([
    db.prepare("UPDATE document_classifications SET primary_type=?, secondary_types=?, confidence_state=?, status='Manually Confirmed', manual_review_required=0, downstream_route=?, confirmed_by=?, confirmed_at=? WHERE id=?").bind(selectedType, JSON.stringify(secondaryTypes), mode === "confirm" ? classification.confidence_state : "Manually Confirmed", route, user.id, stamp, classification.id),
    db.prepare("UPDATE documents SET document_type=?, classification_source='Manual Confirmation', updated_at=? WHERE id=?").bind(selectedType, stamp, document.id),
    db.prepare("UPDATE downstream_routing_handoffs SET route=?, eligible=1, blocker=NULL WHERE classification_id=?").bind(route, classification.id),
    db.prepare("INSERT INTO classification_overrides (id, classification_id, document_id, previous_type, selected_type, secondary_types, reason, overridden_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id("override"), classification.id, document.id, classification.primary_type, selectedType, JSON.stringify(secondaryTypes), reason || null, user.id),
    db.prepare("INSERT INTO document_audit_events (id, project_id, document_id, version_id, actor_user_id, action, old_value, new_value, reason, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id("audit"), document.project_id, document.id, document.version_id, user.id, mode === "confirm" ? "Classification Confirmed" : "Classification Override", JSON.stringify({ primaryType: classification.primary_type, status: classification.status }), JSON.stringify({ primaryType: selectedType, secondaryTypes, status: "Manually Confirmed", route }), reason || "Classification confirmed", requestId),
  ]);
  if (body.startExtraction === true && ["BOQ", "Technical Specification", "Supplier Quotation", "Supplier Quote", "Project Context"].includes(selectedType)) ctx.waitUntil(Promise.resolve(executeConfirmedDownstreamExtraction(env, ctx, { documentId: document.id, userId: user.id, primaryType: selectedType, reason: `Explicit extraction after ${selectedType} classification confirmation` })).catch(() => undefined));
  return json({ classification: await resultPayload(db, document.id), requestId });
};

const classifySegment = async (request, db, document, classification, user, kind) => {
  const body = await request.json();
  const selectedType = String(body.selectedType || "");
  const reason = String(body.reason || "").trim();
  if (!CLASSIFICATION_TAXONOMY.includes(selectedType) || reason.length < 3) return json({ error: { code: "INVALID_SEGMENT_OVERRIDE", message: "Select a valid type and provide a reason.", suggestedAction: `Identify the ${kind === "page" ? "page range" : "worksheet"} and supporting evidence.` } }, 422);
  const pageFrom = kind === "page" ? Number(body.pageFrom) : null; const pageTo = kind === "page" ? Number(body.pageTo) : null; const sheetName = kind === "sheet" ? String(body.sheetName || "").trim() : null;
  if (kind === "page" && (!Number.isInteger(pageFrom) || !Number.isInteger(pageTo) || pageFrom < 1 || pageTo < pageFrom)) return json({ error: { code: "INVALID_PAGE_RANGE", message: "Enter a valid inclusive page range.", suggestedAction: "Use positive page numbers with the end after the start." } }, 422);
  if (kind === "sheet" && !sheetName) return json({ error: { code: "SHEET_REQUIRED", message: "Select a worksheet.", suggestedAction: "Enter the exact sheet name shown in evidence." } }, 422);
  await db.batch([
    db.prepare("INSERT INTO classification_segments (id, classification_id, segment_kind, label, page_from, page_to, sheet_name, primary_type, confidence, evidence, manually_set) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 100, ?, 1)").bind(id("segment"), classification.id, kind, kind === "page" ? `Pages ${pageFrom}-${pageTo}` : sheetName, pageFrom, pageTo, sheetName, selectedType, JSON.stringify([{ kind: "Manual", label: reason, method: "human-review" }])),
    db.prepare("INSERT INTO document_audit_events (id, project_id, document_id, version_id, actor_user_id, action, old_value, new_value, reason, request_id) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)").bind(id("audit"), document.project_id, document.id, document.version_id, user.id, kind === "page" ? "Page Classification Override" : "Worksheet Classification Override", JSON.stringify({ pageFrom, pageTo, sheetName, selectedType }), reason, request.headers.get("x-request-id") || id("request")),
  ]);
  return json({ classification: await resultPayload(db, document.id) });
};

export const handleClassificationApi = async (request, env, ctx) => {
  const url = new URL(request.url);
  if (!url.pathname.includes("/classification")) return null;
  if (!env.DB || !env.FILES) return json({ error: { code: "CLASSIFIER_UNAVAILABLE", message: "Classification storage is unavailable.", suggestedAction: "Verify DB and FILES bindings." } }, 503);
  await ensureClassificationSchema(env.DB);
  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
  const user = applicationActor(resolved.context);
  const match = url.pathname.match(/^\/api\/documents\/([^/]+)\/classification(?:\/(start|status|result|evidence|confirm|override|rerun|history|page|sheet))?$/);
  if (!match) return null;
  const document = await ownedDocument(env.DB, decodeURIComponent(match[1]), user.id);
  if (!document) return json({ error: { code: "DOCUMENT_NOT_FOUND", message: "Document not found.", suggestedAction: "Refresh the project document register." } }, 404);
  const operation = match[2] || "result";
  if (["status", "result", "evidence"].includes(operation) && request.method === "GET") {
    const result = await resultPayload(env.DB, document.id);
    const pendingStatus = document.job_status === "Queued" ? "Classification Queued" : document.job_status === "Processing" ? "Classifying" : document.job_status === "Failed" ? "Classification Failed" : "Not Classified";
    return result ? json({ classification: result }) : json({ classification: { status: pendingStatus, primary_type: "Unknown", confidence: 0, processing_progress: document.progress || 0 } });
  }
  if (operation === "history" && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT c.*, m.classifier_version, m.ruleset_version, m.prompt_version, m.ai_model_version FROM document_classifications c JOIN classification_model_versions m ON m.id=c.model_version_id WHERE c.document_id=? ORDER BY c.classified_at DESC").bind(document.id).all();
    const overrides = await env.DB.prepare("SELECT * FROM classification_overrides WHERE document_id=? ORDER BY overridden_at DESC").bind(document.id).all();
    return json({ history: rows.results || [], overrides: overrides.results || [] });
  }
  if (["start", "rerun"].includes(operation) && request.method === "POST") {
    const existing = await currentClassification(env.DB, document.id);
    if (operation === "start" && existing && !existing.superseded_at) return json({ classification: await resultPayload(env.DB, document.id), idempotent: true });
    scheduleAutomaticClassification(env, ctx, {
      documentId: document.id,
      userId: user.id,
    });
    return json({ status: "Classification Queued", documentId: document.id }, 202);
  }
  const classification = await currentClassification(env.DB, document.id);
  if (!classification && operation === "override" && request.method === "POST") {
    return createManualClassification(request, env, ctx, document, user);
  }
  if (!classification) return json({ error: { code: "CLASSIFICATION_REQUIRED", message: "Run classification first.", suggestedAction: "Start classification and wait for a result." } }, 409);
  if (operation === "confirm" && request.method === "POST") return confirmOrOverride(request, env, ctx, document, classification, user, "confirm");
  if (operation === "override" && request.method === "POST") return confirmOrOverride(request, env, ctx, document, classification, user, "override");
  if (operation === "page" && request.method === "POST") return classifySegment(request, env.DB, document, classification, user, "page");
  if (operation === "sheet" && request.method === "POST") return classifySegment(request, env.DB, document, classification, user, "sheet");
  return json({ error: { code: "CLASSIFICATION_API_NOT_FOUND", message: "Classification operation not found.", suggestedAction: "Check the request method and operation." } }, 404);
};
