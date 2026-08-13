import { requireMigratedTables } from "./schema-requirements.mjs";
import {
  DOCUMENT_TYPES, DUPLICATE_ACTIONS, PROCESSING_STATUSES, documentError, secureObjectKey,
  sha256Hex, validateDocumentBytes,
} from "../app/domain/document-management.mjs";
import { ensureClassificationSchema, scheduleAutomaticClassification } from "./classification-api.mjs";
import { ensureBoqExtractionSchema } from "./boq-extraction-api.mjs";
import { ensureSpecificationJobSchema } from "./specification-extraction-background.mjs";
import { applicationActor, resolveApplicationContext } from "./application-context.mjs";

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const safeJson = (value) => JSON.stringify(value ?? null);

const DOCUMENT_SCHEMA_TABLES = ["projects", "upload_sessions", "documents", "document_versions", "document_processing_runs", "processing_history", "document_audit_events"];
let initialized = false;
const ensureSchema = async (db) => { if (!initialized) { await requireMigratedTables(db, DOCUMENT_SCHEMA_TABLES); initialized = true; } };

const requireBindings = (env) => {
  if (!env.DB || !env.FILES) throw new Error("Document management requires DB and FILES bindings.");
};

const getOwnedProject = async (db, projectId, userId) => db.prepare("SELECT * FROM projects WHERE id = ? AND owner_user_id = ? AND archived_at IS NULL").bind(projectId, userId).first();
const getOwnedDocument = async (db, documentId, userId, includeDeleted = false) => db.prepare(`SELECT d.*, v.id AS version_id, v.version_number, v.original_filename, v.stored_filename, v.extension, v.mime_type, v.byte_size, v.sha256, v.object_key, v.revision, v.uploaded_by, v.uploaded_at, v.quarantine_status, r.id AS job_id, r.status AS processing_status, r.progress, r.error_code, r.error_message, r.suggested_action, r.started_at, r.completed_at, r.last_retry_at FROM documents d JOIN projects p ON p.id=d.project_id LEFT JOIN document_versions v ON v.id=d.current_version_id LEFT JOIN document_processing_runs r ON r.id=(SELECT id FROM document_processing_runs WHERE document_version_id=v.id ORDER BY created_at DESC LIMIT 1) WHERE d.id=? AND p.owner_user_id=? ${includeDeleted ? "" : "AND d.deleted_at IS NULL"}`).bind(documentId, userId).first();

const auditStatement = (db, { projectId, documentId = null, versionId = null, actor, action, oldValue = null, newValue = null, reason = "", requestId }) => db.prepare("INSERT INTO document_audit_events (id, project_id, document_id, version_id, actor_user_id, action, old_value, new_value, reason, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id("audit"), projectId, documentId, versionId, actor, action, safeJson(oldValue), safeJson(newValue), reason, requestId);

const transitionJob = async (db, { runId, actor, fromStatus, toStatus, progress, message = "", error = null }) => {
  if (!PROCESSING_STATUSES.includes(toStatus)) throw new Error(`Invalid processing status ${toStatus}`);
  const stamp = now();
  await db.batch([
    db.prepare("UPDATE document_processing_runs SET status=?, progress=?, error_code=?, error_message=?, technical_details=?, suggested_action=?, started_at=CASE WHEN ?='Processing' AND started_at IS NULL THEN ? ELSE started_at END, completed_at=CASE WHEN ? IN ('Completed','Needs Review','Failed','Cancelled') THEN ? ELSE NULL END, last_retry_at=CASE WHEN ?='Retrying' THEN ? ELSE last_retry_at END, updated_at=? WHERE id=?").bind(toStatus, progress, error?.code || null, error?.message || null, error?.technicalDetails || null, error?.suggestedAction || null, toStatus, stamp, toStatus, stamp, toStatus, stamp, stamp, runId),
    db.prepare("INSERT INTO processing_history (id, run_id, from_status, to_status, progress, actor, error_code, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id("history"), runId, fromStatus, toStatus, progress, actor, error?.code || null, message || error?.message || null),
  ]);
};

const upload = async (request, env, ctx, projectId, user) => {
  const requestId = request.headers.get("x-request-id") || id("request");
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: { code: "FILE_REQUIRED", message: "Choose a file to upload.", suggestedAction: "Select one supported document." }, requestId }, 400);
  const projectName = String(form.get("projectName") || "Untitled Project").trim().slice(0, 160) || "Untitled Project";
  const documentType = String(form.get("documentType") || "Auto Detection");
  const duplicateAction = String(form.get("duplicateAction") || "");
  const targetDocumentId = String(form.get("targetDocumentId") || "");
  const revision = String(form.get("revision") || "").trim().slice(0, 80);
  if (!DOCUMENT_TYPES.includes(documentType)) return json({ error: { code: "INVALID_DOCUMENT_TYPE", message: "Choose a supported document category.", suggestedAction: "Select Auto Detection or a listed category." }, requestId }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let validated;
  try { validated = validateDocumentBytes({ fileName: file.name, mimeType: file.type, bytes }); }
  catch (error) { return json({ error: documentError(error), requestId }, 422); }
  const checksum = await sha256Hex(bytes);
  const existingProject = await dbProject(env.DB, projectId);
  if (existingProject && existingProject.owner_user_id !== user.id) return json({ error: { code: "PROJECT_FORBIDDEN", message: "You do not have access to this project.", suggestedAction: "Open a project you own or request access." }, requestId }, 403);
  if (!existingProject) await env.DB.prepare("INSERT INTO projects (id, name, owner_user_id) VALUES (?, ?, ?)").bind(projectId, projectName, user.id).run();
  const duplicate = await env.DB.prepare("SELECT d.id AS document_id, d.logical_name, v.id AS version_id, v.version_number, v.original_filename, v.byte_size, v.sha256, v.revision, CASE WHEN v.sha256=? THEN 'Checksum' WHEN v.original_filename=? AND v.byte_size=? THEN 'Filename and Size' WHEN ?<>'' AND v.revision=? THEN 'Revision' ELSE 'Filename' END AS duplicate_basis FROM documents d JOIN document_versions v ON v.document_id=d.id WHERE d.project_id=? AND d.deleted_at IS NULL AND (v.sha256=? OR (v.original_filename=? AND v.byte_size=?) OR (?<>'' AND v.revision=?) OR v.original_filename=?) ORDER BY v.uploaded_at DESC LIMIT 1").bind(checksum, validated.originalFilename, validated.byteSize, revision, revision, projectId, checksum, validated.originalFilename, validated.byteSize, revision, revision, validated.originalFilename).first();
  if (duplicate && !DUPLICATE_ACTIONS.includes(duplicateAction)) return json({ duplicate: true, existing: duplicate, choices: DUPLICATE_ACTIONS, requestId }, 409);
  if (duplicateAction === "cancel") return json({ cancelled: true, requestId }, 200);
  let documentId = id("doc");
  let versionNumber = 1;
  let supersedesVersionId = null;
  if (["replace", "new_version"].includes(duplicateAction)) {
    const target = targetDocumentId || duplicate?.document_id;
    const owned = target ? await getOwnedDocument(env.DB, target, user.id) : null;
    if (!owned || owned.project_id !== projectId) return json({ error: { code: "VERSION_TARGET_REQUIRED", message: "Choose an existing document for this version.", suggestedAction: "Select Replace Existing, Keep Both, or a valid version target." }, requestId }, 409);
    documentId = owned.id;
    versionNumber = Number(owned.version_number || 0) + 1;
    supersedesVersionId = owned.version_id;
  }
  const uploadSessionId = id("upload");
  const versionId = id("ver");
  const runId = id("job");
  const objectKey = secureObjectKey({ projectId, documentId, versionId, extension: validated.extension });
  const storedFilename = `${versionId}.${validated.extension}`;
  await env.FILES.put(objectKey, bytes, { httpMetadata: { contentType: validated.mimeType, contentDisposition: `attachment; filename="${validated.originalFilename.replaceAll('"', '')}"` }, customMetadata: { projectId, documentId, versionId, sha256: checksum } });
  try {
    const statements = [
      env.DB.prepare("INSERT INTO upload_sessions (id, project_id, uploaded_by, status, total_bytes, completed_at) VALUES (?, ?, ?, 'Completed', ?, ?)").bind(uploadSessionId, projectId, user.id, validated.byteSize, now()),
    ];
    if (versionNumber === 1) statements.push(env.DB.prepare("INSERT INTO documents (id, project_id, logical_name, document_type, classification_source, created_by) VALUES (?, ?, ?, ?, ?, ?)").bind(documentId, projectId, validated.originalFilename, documentType, documentType === "Auto Detection" ? "Pending Task 4" : "Manual Override", user.id));
    statements.push(
      env.DB.prepare("INSERT INTO document_versions (id, document_id, upload_session_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, revision, uploaded_by, supersedes_version_id, quarantine_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Scan Hook Pending')").bind(versionId, documentId, uploadSessionId, versionNumber, validated.originalFilename, storedFilename, validated.extension, validated.mimeType, validated.byteSize, checksum, objectKey, revision || null, user.id, supersedesVersionId),
      env.DB.prepare("UPDATE documents SET current_version_id=?, logical_name=?, document_type=?, classification_source=?, updated_at=? WHERE id=?").bind(versionId, validated.originalFilename, documentType, documentType === "Auto Detection" ? "Pending Task 4" : "Manual Override", now(), documentId),
      env.DB.prepare("INSERT INTO document_processing_runs (id, document_version_id, stage, status, progress, processor_version) VALUES (?, ?, 'Intake', 'Queued', 1, 'document-intake-v1')").bind(runId, versionId),
      env.DB.prepare("INSERT INTO processing_history (id, run_id, from_status, to_status, progress, actor, message) VALUES (?, ?, 'Uploaded', 'Queued', 1, ?, 'Upload stored and queued for downstream processing.')").bind(id("history"), runId, user.id),
      auditStatement(env.DB, { projectId, documentId, versionId, actor: user.id, action: versionNumber === 1 ? "Upload" : duplicateAction === "replace" ? "Replace" : "Create New Version", newValue: { originalFilename: validated.originalFilename, versionNumber, checksum, byteSize: validated.byteSize, documentType }, reason: String(form.get("reason") || "Document intake"), requestId }),
    );
    await env.DB.batch(statements);
  } catch (error) {
    await env.FILES.delete(objectKey);
    throw error;
  }
  scheduleAutomaticClassification(env, ctx, { documentId, userId: user.id, runId });
  return json({ document: await getOwnedDocument(env.DB, documentId, user.id), requestId }, 201);
};

const dbProject = (db, projectId) => db.prepare("SELECT * FROM projects WHERE id=?").bind(projectId).first();

export const attachExactProjectContextReview = (documents = [], reviews = []) => {
  const bySource = new Map(
    reviews.map((review) => [
      `${review.document_id}:${review.document_version_id}`,
      review,
    ]),
  );
  return documents.map((document) => {
    const review = bySource.get(`${document.id}:${document.version_id}`);
    if (!review) return document;
    return {
      ...document,
      project_context_extraction_id: review.project_context_extraction_id,
      project_context_extraction_version: review.project_context_extraction_version,
      project_context_extraction_status: review.project_context_extraction_status,
      project_context_fact_count: review.project_context_fact_count,
      project_context_facts_pending: review.project_context_facts_pending,
      project_context_facts_reviewed: review.project_context_facts_reviewed,
      project_context_facts_rejected: review.project_context_facts_rejected,
    };
  });
};

const listDocuments = async (request, db, projectId, user) => {
  await ensureBoqExtractionSchema(db);
  if (!await getOwnedProject(db, projectId, user.id)) return json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found.", suggestedAction: "Open an available project." } }, 404);
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const type = (url.searchParams.get("type") || "").trim();
  const status = (url.searchParams.get("status") || "").trim();
  const includeArchived = url.searchParams.get("includeArchived") === "true";
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") || 25)));
  const projectDocumentCount = await db.prepare("SELECT COUNT(*) AS count FROM documents WHERE project_id=? AND deleted_at IS NULL").bind(projectId).first();
  if (Number(projectDocumentCount?.count || 0) === 0) return json({ documents: [], pagination: { page, pageSize, total: 0, totalPages: 0 } });
  const conditions = ["d.project_id=?", "d.deleted_at IS NULL"];
  const values = [projectId];
  if (!includeArchived) conditions.push("d.archived_at IS NULL");
  if (query) { conditions.push("(d.logical_name LIKE ? OR d.notes LIKE ? OR v.original_filename LIKE ?)"); values.push(`%${query}%`, `%${query}%`, `%${query}%`); }
  if (type) { conditions.push("d.document_type=?"); values.push(type); }
  if (status) { conditions.push("r.status=?"); values.push(status); }
  const where = conditions.join(" AND ");
  const base = `FROM documents d JOIN document_versions v ON v.id=d.current_version_id LEFT JOIN document_processing_runs r ON r.id=(SELECT id FROM document_processing_runs WHERE document_version_id=v.id ORDER BY created_at DESC LIMIT 1) LEFT JOIN document_classifications c ON c.id=(SELECT id FROM document_classifications WHERE document_id=d.id AND superseded_at IS NULL ORDER BY classified_at DESC LIMIT 1) LEFT JOIN boq_extraction_versions bx ON bx.id=(SELECT id FROM boq_extraction_versions WHERE document_id=d.id AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1) LEFT JOIN specification_extraction_versions sx ON sx.id=(SELECT id FROM specification_extraction_versions WHERE document_id=d.id AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1) LEFT JOIN specification_extraction_jobs sj ON sj.id=(SELECT id FROM specification_extraction_jobs WHERE document_id=d.id ORDER BY created_at DESC LIMIT 1) WHERE ${where}`;
  const total = await db.prepare(`SELECT COUNT(*) AS count ${base}`).bind(...values).first();
  const rows = await db.prepare(`SELECT d.*, v.id AS version_id, v.version_number, v.original_filename, v.extension, v.mime_type, v.byte_size, v.sha256, v.revision, v.uploaded_by, v.uploaded_at, v.quarantine_status, r.id AS job_id, r.status AS processing_status, r.progress, r.error_code, r.error_message, r.suggested_action, r.started_at, r.completed_at, r.last_retry_at, c.id AS classification_id, c.primary_type AS predicted_type, c.secondary_types, c.confidence AS classification_confidence, c.confidence_state, c.status AS classification_status, c.manual_review_required, c.downstream_route, c.error_code AS classification_error_code, c.error_message AS classification_error_message, bx.id AS boq_extraction_id, bx.version_number AS boq_extraction_version, bx.status AS boq_extraction_status, bx.summary AS boq_extraction_summary, bx.error_code AS boq_extraction_error_code, bx.error_message AS boq_extraction_error_message, bx.suggested_action AS boq_extraction_suggested_action, sx.id AS specification_extraction_id, sx.version_number AS specification_extraction_version, sx.status AS specification_extraction_status, sx.summary AS specification_extraction_summary, sx.error_code AS specification_extraction_error_code, sx.error_message AS specification_extraction_error_message, sx.suggested_action AS specification_extraction_suggested_action, sj.id AS specification_job_id, sj.status AS specification_job_status, sj.total_pages AS specification_total_pages, sj.processed_pages AS specification_processed_pages, sj.current_page AS specification_current_page, sj.current_chunk AS specification_current_chunk, sj.completed_chunks AS specification_completed_chunks, sj.remaining_chunks AS specification_remaining_chunks, sj.extracted_clauses AS specification_live_clauses, sj.extracted_requirements AS specification_live_requirements, sj.elapsed_seconds AS specification_elapsed_seconds, sj.estimated_remaining_seconds AS specification_eta_seconds ${base} ORDER BY d.updated_at DESC LIMIT ? OFFSET ?`).bind(...values, pageSize, (page - 1) * pageSize).all();
  const contextReviews = await db.prepare("SELECT pcx.id AS project_context_extraction_id,pcx.document_id,pcx.document_version_id,pcx.version_number AS project_context_extraction_version,pcx.status AS project_context_extraction_status,COUNT(pcf.id) AS project_context_fact_count,SUM(CASE WHEN pcf.review_status='Needs Review' THEN 1 ELSE 0 END) AS project_context_facts_pending,SUM(CASE WHEN pcf.review_status NOT IN ('Needs Review','Rejected') THEN 1 ELSE 0 END) AS project_context_facts_reviewed,SUM(CASE WHEN pcf.review_status='Rejected' THEN 1 ELSE 0 END) AS project_context_facts_rejected FROM project_context_extraction_versions pcx LEFT JOIN project_context_facts pcf ON pcf.extraction_version_id=pcx.id WHERE pcx.project_id=? AND pcx.superseded_at IS NULL GROUP BY pcx.id,pcx.document_id,pcx.document_version_id,pcx.version_number,pcx.status").bind(projectId).all();
  return json({ documents: attachExactProjectContextReview(rows.results || [], contextReviews.results || []), pagination: { page, pageSize, total: Number(total?.count || 0), totalPages: Math.ceil(Number(total?.count || 0) / pageSize) } });
};

const updateDocument = async (request, db, documentId, user) => {
  const current = await getOwnedDocument(db, documentId, user.id);
  if (!current) return json({ error: { code: "DOCUMENT_NOT_FOUND", message: "Document not found.", suggestedAction: "Refresh the document list." } }, 404);
  const body = await request.json();
  const logicalName = body.logicalName === undefined ? current.logical_name : String(body.logicalName).trim().slice(0, 255);
  const notes = body.notes === undefined ? current.notes : String(body.notes).trim().slice(0, 4000);
  const tags = body.tags === undefined ? JSON.parse(current.tags || "[]") : Array.isArray(body.tags) ? body.tags.map((value) => String(value).trim().slice(0, 80)).filter(Boolean).slice(0, 30) : null;
  const documentType = body.documentType === undefined ? current.document_type : String(body.documentType);
  if (!logicalName || !tags || !DOCUMENT_TYPES.includes(documentType)) return json({ error: { code: "INVALID_METADATA", message: "Document metadata is invalid.", suggestedAction: "Provide a name, valid type and tag list." } }, 422);
  const stamp = now();
  const requestId = request.headers.get("x-request-id") || id("request");
  await db.batch([
    db.prepare("UPDATE documents SET logical_name=?, notes=?, tags=?, document_type=?, classification_source=?, updated_at=? WHERE id=?").bind(logicalName, notes, JSON.stringify(tags), documentType, body.documentType === undefined ? current.classification_source : "Manual Override", stamp, documentId),
    auditStatement(db, { projectId: current.project_id, documentId, versionId: current.version_id, actor: user.id, action: body.documentType !== undefined ? "Classification Change" : logicalName !== current.logical_name ? "Rename" : "Update Metadata", oldValue: { logicalName: current.logical_name, notes: current.notes, tags: JSON.parse(current.tags || "[]"), documentType: current.document_type }, newValue: { logicalName, notes, tags, documentType }, reason: String(body.reason || "Metadata updated"), requestId }),
  ]);
  return json({ document: await getOwnedDocument(db, documentId, user.id), requestId });
};

const actionDocument = async (request, db, documentId, action, user) => {
  const current = await getOwnedDocument(db, documentId, user.id, action === "restore");
  if (!current) return json({ error: { code: "DOCUMENT_NOT_FOUND", message: "Document not found.", suggestedAction: "Refresh the document list." } }, 404);
  const body = await request.json().catch(() => ({}));
  const reason = String(body.reason || "").trim();
  if (["archive", "restore", "delete", "retry", "cancel"].includes(action) && reason.length < 3) return json({ error: { code: "REASON_REQUIRED", message: "A reason is required for this action.", suggestedAction: "Enter a short audit reason." } }, 422);
  const requestId = request.headers.get("x-request-id") || id("request");
  const stamp = now();
  if (action === "archive" || action === "restore" || action === "delete") {
    const column = action === "archive" ? "archived_at" : action === "restore" ? "archived_at" : "deleted_at";
    const value = action === "restore" ? null : stamp;
    await db.batch([
      db.prepare(`UPDATE documents SET ${column}=?, updated_at=? WHERE id=?`).bind(value, stamp, documentId),
      auditStatement(db, { projectId: current.project_id, documentId, versionId: current.version_id, actor: user.id, action: action[0].toUpperCase() + action.slice(1), oldValue: { archivedAt: current.archived_at, deletedAt: current.deleted_at }, newValue: { [column]: value }, reason, requestId }),
    ]);
    return json({ ok: true, requestId });
  }
  if (action === "retry") {
    if (!current.job_id || !["Failed", "Cancelled", "Needs Review", "Waiting"].includes(current.processing_status)) return json({ error: { code: "RETRY_NOT_ALLOWED", message: "This job cannot be retried from its current status.", suggestedAction: "Refresh and review its current status." } }, 409);
    await db.prepare("UPDATE document_processing_runs SET attempt=attempt+1, status='Retrying', progress=0, error_code=NULL, error_message=NULL, technical_details=NULL, suggested_action=NULL, cancel_requested=0, available_at=?, last_retry_at=?, completed_at=NULL, updated_at=? WHERE id=? AND attempt < max_attempts").bind(stamp, stamp, stamp, current.job_id).run();
    const updated = await db.prepare("SELECT status, attempt, max_attempts FROM document_processing_runs WHERE id=?").bind(current.job_id).first();
    if (updated?.status !== "Retrying") return json({ error: { code: "RETRY_LIMIT_REACHED", message: "The retry limit has been reached.", suggestedAction: "Inspect the error and upload a corrected version." } }, 409);
    await transitionJob(db, { runId: current.job_id, actor: user.id, fromStatus: current.processing_status, toStatus: "Queued", progress: 1, message: reason });
    return json({ document: await getOwnedDocument(db, documentId, user.id), requestId });
  }
  if (action === "cancel") {
    if (!current.job_id || ["Completed", "Failed", "Cancelled"].includes(current.processing_status)) return json({ error: { code: "CANCEL_NOT_ALLOWED", message: "This job is already terminal.", suggestedAction: "Refresh its status." } }, 409);
    await db.prepare("UPDATE document_processing_runs SET cancel_requested=1 WHERE id=?").bind(current.job_id).run();
    await transitionJob(db, { runId: current.job_id, actor: user.id, fromStatus: current.processing_status, toStatus: "Cancelled", progress: Number(current.progress || 0), message: reason });
    return json({ document: await getOwnedDocument(db, documentId, user.id), requestId });
  }
  return json({ error: { code: "UNKNOWN_ACTION", message: "Unknown document action.", suggestedAction: "Use a supported action." } }, 404);
};

const documentHistory = async (db, documentId, user) => {
  const current = await getOwnedDocument(db, documentId, user.id, true);
  if (!current) return json({ error: { code: "DOCUMENT_NOT_FOUND", message: "Document not found.", suggestedAction: "Refresh the document list." } }, 404);
  const [versions, jobs, audit] = await Promise.all([
    db.prepare("SELECT id, version_number, original_filename, extension, mime_type, byte_size, sha256, revision, uploaded_by, uploaded_at, supersedes_version_id, restored_from_version_id, quarantine_status FROM document_versions WHERE document_id=? ORDER BY version_number DESC").bind(documentId).all(),
    db.prepare("SELECT r.*, h.from_status, h.to_status, h.progress AS history_progress, h.actor AS history_actor, h.message AS history_message, h.created_at AS history_at FROM document_processing_runs r LEFT JOIN processing_history h ON h.run_id=r.id WHERE r.document_version_id IN (SELECT id FROM document_versions WHERE document_id=?) ORDER BY r.created_at DESC, h.created_at DESC").bind(documentId).all(),
    db.prepare("SELECT action, actor_user_id, old_value, new_value, reason, request_id, created_at FROM document_audit_events WHERE document_id=? ORDER BY created_at DESC").bind(documentId).all(),
  ]);
  return json({ document: current, versions: versions.results || [], processing: jobs.results || [], audit: audit.results || [] });
};

const restoreDocumentVersion = async (request, db, documentId, versionId, user) => {
  const current = await getOwnedDocument(db, documentId, user.id, true);
  if (!current) return json({ error: { code: "DOCUMENT_NOT_FOUND", message: "Document not found.", suggestedAction: "Refresh the document list." } }, 404);
  const source = await db.prepare("SELECT * FROM document_versions WHERE id=? AND document_id=?").bind(versionId, documentId).first();
  if (!source) return json({ error: { code: "VERSION_NOT_FOUND", message: "Document version not found.", suggestedAction: "Open version history and choose an available version." } }, 404);
  const body = await request.json().catch(() => ({}));
  const reason = String(body.reason || "").trim();
  if (reason.length < 3) return json({ error: { code: "REASON_REQUIRED", message: "A reason is required to restore a version.", suggestedAction: "Explain why the previous version is being restored." } }, 422);
  const nextVersionId = id("ver");
  const runId = id("job");
  const nextNumber = Number(current.version_number || 0) + 1;
  const requestId = request.headers.get("x-request-id") || id("request");
  await db.batch([
    db.prepare("INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, revision, issue_date, issue_purpose, transmittal, source, uploaded_by, supersedes_version_id, restored_from_version_id, quarantine_status) SELECT ?, document_id, ?, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, revision, issue_date, issue_purpose, transmittal, 'Version Restore', ?, ?, id, quarantine_status FROM document_versions WHERE id=?").bind(nextVersionId, nextNumber, user.id, current.version_id, versionId),
    db.prepare("UPDATE documents SET current_version_id=?, archived_at=NULL, deleted_at=NULL, updated_at=? WHERE id=?").bind(nextVersionId, now(), documentId),
    db.prepare("INSERT INTO document_processing_runs (id, document_version_id, stage, status, progress, processor_version) VALUES (?, ?, 'Intake', 'Queued', 1, 'document-intake-v1')").bind(runId, nextVersionId),
    db.prepare("INSERT INTO processing_history (id, run_id, from_status, to_status, progress, actor, message) VALUES (?, ?, 'Uploaded', 'Queued', 1, ?, 'Restored version queued for downstream reprocessing.')").bind(id("history"), runId, user.id),
    auditStatement(db, { projectId: current.project_id, documentId, versionId: nextVersionId, actor: user.id, action: "Restore Previous Version", oldValue: { currentVersionId: current.version_id, versionNumber: current.version_number }, newValue: { currentVersionId: nextVersionId, versionNumber: nextNumber, restoredFromVersionId: versionId }, reason, requestId }),
  ]);
  return json({ document: await getOwnedDocument(db, documentId, user.id), requestId });
};

const downloadDocument = async (request, env, documentId, user) => {
  const current = await getOwnedDocument(env.DB, documentId, user.id);
  if (!current) return json({ error: { code: "DOCUMENT_NOT_FOUND", message: "Document not found.", suggestedAction: "Refresh the document list." } }, 404);
  const object = await env.FILES.get(current.object_key);
  if (!object) return json({ error: { code: "STORAGE_OBJECT_MISSING", message: "The stored file is unavailable.", suggestedAction: "Contact support; do not reapprove this evidence." } }, 500);
  const disposition = new URL(request.url).searchParams.get("preview") === "true" ? "inline" : "attachment";
  const headers = new Headers();
  object.writeHttpMetadata?.(headers);
  headers.set("content-type", current.mime_type);
  headers.set("content-length", String(current.byte_size));
  headers.set("content-disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(current.original_filename)}`);
  headers.set("etag", current.sha256);
  headers.set("x-content-type-options", "nosniff");
  headers.set("cache-control", "private, no-store");
  return new Response(object.body, { headers });
};

export const handleDocumentApi = async (request, env, ctx) => {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return null;
  try {
    requireBindings(env);
    await ensureSchema(env.DB);
    await ensureClassificationSchema(env.DB);
    await ensureSpecificationJobSchema(env.DB);
    const resolved = await resolveApplicationContext(request, env);
    if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
    const user = applicationActor(resolved.context);
    let match = url.pathname.match(/^\/api\/projects\/([^/]+)\/documents$/);
    if (match && request.method === "POST") return upload(request, env, ctx, decodeURIComponent(match[1]), user);
    if (match && request.method === "GET") return listDocuments(request, env.DB, decodeURIComponent(match[1]), user);
    match = url.pathname.match(/^\/api\/documents\/([^/]+)$/);
    if (match && request.method === "PATCH") return updateDocument(request, env.DB, decodeURIComponent(match[1]), user);
    if (match && request.method === "DELETE") return actionDocument(new Request(request, { method: "POST", body: JSON.stringify({ reason: request.headers.get("x-audit-reason") || "Document deleted" }), headers: { ...Object.fromEntries(request.headers), "content-type": "application/json" } }), env.DB, decodeURIComponent(match[1]), "delete", user);
    match = url.pathname.match(/^\/api\/documents\/([^/]+)\/(archive|restore|retry|cancel)$/);
    if (match && request.method === "POST") return actionDocument(request, env.DB, decodeURIComponent(match[1]), match[2], user);
    match = url.pathname.match(/^\/api\/documents\/([^/]+)\/(download|preview)$/);
    if (match && request.method === "GET") {
      const routed = match[2] === "preview" ? new Request(`${url.origin}/api/documents/${match[1]}/download?preview=true`, request) : request;
      return downloadDocument(routed, env, decodeURIComponent(match[1]), user);
    }
    match = url.pathname.match(/^\/api\/documents\/([^/]+)\/(history|status)$/);
    if (match && request.method === "GET") return documentHistory(env.DB, decodeURIComponent(match[1]), user);
    match = url.pathname.match(/^\/api\/documents\/([^/]+)\/versions\/([^/]+)\/restore$/);
    if (match && request.method === "POST") return restoreDocumentVersion(request, env.DB, decodeURIComponent(match[1]), decodeURIComponent(match[2]), user);
    return json({ error: { code: "API_NOT_FOUND", message: "Document endpoint not found.", suggestedAction: "Check the request path and method." } }, 404);
  } catch (error) {
    const requestId = request.headers.get("x-request-id") || id("request");
    return json({ error: documentError(error), requestId }, 500);
  }
};
