import { requireMigratedTables } from "./schema-requirements.mjs";
import { inspectPdfReadiness } from "../app/document-parsers/pdf-readiness.mjs";
import { extractSpecificationDocumentChunk, extractSpecificationDocumentChunkFromRangeSource, inspectSpecificationDocumentMap, SPEC_MODEL_VERSION, SPEC_OCR_VERSION, SPEC_PARSER_VERSION, SPEC_PROMPT_VERSION, SPEC_RULESET_VERSION } from "../app/domain/specification-extractor.mjs";
import { buildSpecificationChunks, DEFAULT_SPECIFICATION_CHUNK_SIZE, mapSpecificationPages, progressSnapshot, SPECIFICATION_JOB_VERSION } from "../app/domain/specification-extraction-jobs.mjs";

const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const json = (value) => JSON.stringify(value ?? null);
const sha = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value))))).map((byte) => byte.toString(16).padStart(2, "0")).join("");

const SPECIFICATION_JOB_SCHEMA_TABLES = ["specification_extraction_jobs", "specification_extraction_chunks", "specification_extraction_pages", "specification_chunk_entities", "specification_extraction_failures", "specification_extraction_checkpoints", "specification_document_map_entries", "specification_document_map_details", "specification_chunk_metrics"];
let initialized = false;
export const ensureSpecificationJobSchema = async (db) => { if (!initialized) { await requireMigratedTables(db, SPECIFICATION_JOB_SCHEMA_TABLES); initialized = true; } };

const jobDocument = (db, documentId, userId) => db.prepare(`SELECT d.id, d.project_id, d.current_version_id AS version_id, p.system_domain, p.owner_user_id, v.original_filename, v.extension, v.object_key, v.sha256, v.revision, c.id AS classification_id, c.primary_type, c.status AS classification_status, c.manual_review_required FROM documents d JOIN projects p ON p.id=d.project_id AND p.owner_user_id=? JOIN document_versions v ON v.id=d.current_version_id LEFT JOIN document_classifications c ON c.id=(SELECT id FROM document_classifications WHERE document_id=d.id AND superseded_at IS NULL ORDER BY classified_at DESC LIMIT 1) WHERE d.id=? AND d.deleted_at IS NULL`).bind(userId, documentId).first();

const activeJob = (db, documentId) => db.prepare("SELECT * FROM specification_extraction_jobs WHERE document_id=? AND status IN ('Queued','Running','Paused') ORDER BY created_at DESC LIMIT 1").bind(documentId).first();

export const createSpecificationJob = async (env, { documentId, userId, reason, chunkSize = DEFAULT_SPECIFICATION_CHUNK_SIZE, force = false }) => {
  await ensureSpecificationJobSchema(env.DB);
  const document = await jobDocument(env.DB, documentId, userId);
  if (!document) throw Object.assign(new Error("Document not found."), { code: "DOCUMENT_NOT_FOUND" });
  if (document.primary_type !== "Technical Specification" || (document.manual_review_required && document.classification_status !== "Manually Confirmed")) throw Object.assign(new Error("Confirm the Technical Specification classification before extraction."), { code: "SPECIFICATION_CLASSIFICATION_CONFIRMATION_REQUIRED" });
  const active = await activeJob(env.DB, documentId);
  // An active run is always the authoritative run. A rerun request cannot create
  // a second writer while the first job is queued, running, or paused.
  if (active) return { job: active, idempotent: true };
  const object = await env.FILES.get(document.object_key);
  if (!object) throw Object.assign(new Error("Stored source object is missing."), { code: "STORAGE_OBJECT_MISSING" });
  const bytes = new Uint8Array(await object.arrayBuffer());
  const extension = String(document.extension || "").toLowerCase();

  let totalPages = 1;

  if (extension === "pdf") {
    const readiness = inspectPdfReadiness(bytes, {
      fileName: document.original_filename,
    });

    if (!readiness.valid) {
      throw Object.assign(
        new Error(readiness.error.message),
        { code: readiness.error.code },
      );
    }

    totalPages = Math.max(1, readiness.pageCount || 1);
  }
  const previous = await env.DB.prepare("SELECT MAX(version_number) AS version_number FROM specification_extraction_versions WHERE document_id=?").bind(document.id).first();
  const extractionId = id("specextract");
  const runId = id("job");
  const jobId = id("specjob");
  const resumeToken = crypto.randomUUID();
  let documentMap = { entries: [] };
  if (String(document.extension).toLowerCase() === "pdf") try { documentMap = await inspectSpecificationDocumentMap(bytes, { fileName: document.original_filename }); } catch { documentMap = { entries: [] }; }
  const mapped = mapSpecificationPages(documentMap.entries.map((entry) => ({ page: entry.startPage || entry.page || 0, lines: [entry.title || ""] })).filter((entry) => entry.page > 0), document.system_domain || "Unspecified");
  const relevantPages = [];
  for (const entry of documentMap.entries) {
    const mappedEntry = mapped.find((item) => item.page === (entry.startPage || entry.page) && item.title === entry.title);
    if (entry.method === "Unmapped Range" || mappedEntry?.relevant === false) continue;
    for (let page = Number(entry.startPage || entry.page || 0); page <= Number(entry.endPage || entry.startPage || entry.page || 0); page += 1) if (page > 0) relevantPages.push(page);
  }
  const chunks = buildSpecificationChunks({ totalPages, chunkSize, relevantPages });
  const stamp = now();
  const sourceFingerprint = await sha(`${document.sha256}|${SPEC_PARSER_VERSION}|${SPEC_RULESET_VERSION}|${chunks[0]?.pageCount || chunkSize}`);
  const statements = [
    env.DB.prepare("INSERT INTO document_processing_runs (id,document_version_id,stage,status,progress,processor_version) VALUES (?,?,'Specification Extraction','Queued',1,?)").bind(runId, document.version_id, SPECIFICATION_JOB_VERSION),
    env.DB.prepare("INSERT INTO processing_history (id,run_id,from_status,to_status,progress,actor,message) VALUES (?,?,NULL,'Queued',1,?,?)").bind(id("history"), runId, userId, reason || "Specification extraction queued"),
    env.DB.prepare("INSERT INTO specification_extraction_versions (id,document_id,document_version_id,classification_id,processing_run_id,version_number,status,parser_version,ruleset_version,model_version,prompt_version,ocr_version,created_by) VALUES (?,?,?,?,?,?,'Queued',?,?,?,?,?,?)").bind(extractionId, document.id, document.version_id, document.classification_id, runId, Number(previous?.version_number || 0) + 1, SPEC_PARSER_VERSION, SPEC_RULESET_VERSION, SPEC_MODEL_VERSION, SPEC_PROMPT_VERSION, SPEC_OCR_VERSION, userId),
    env.DB.prepare("INSERT INTO specification_extraction_jobs (id,extraction_version_id,document_id,document_version_id,project_id,status,total_pages,remaining_chunks,chunk_size,worker_version,source_fingerprint,resume_token,project_system,requested_by) VALUES (?,?,?,?,?,'Queued',?,?,?,?,?,?,?,?)").bind(jobId, extractionId, document.id, document.version_id, document.project_id, totalPages, chunks.length, chunks[0]?.pageCount || chunkSize, SPECIFICATION_JOB_VERSION, sourceFingerprint, resumeToken, document.system_domain || "Unspecified", userId),
    env.DB.prepare("INSERT INTO document_audit_events (id,project_id,document_id,version_id,actor_user_id,action,old_value,new_value,reason,request_id) VALUES (?,?,?,?,?,'Specification Extraction Queued',NULL,?,?,?)").bind(id("audit"), document.project_id, document.id, document.version_id, userId, json({ jobId, extractionId, totalPages, chunkSize: chunks[0]?.pageCount || chunkSize }), reason || "Large specification extraction", id("request")),
  ];
  for (const chunk of chunks) {
    const chunkId = `${jobId}_chunk_${String(chunk.chunkNumber).padStart(6, "0")}`;
    statements.push(env.DB.prepare("INSERT INTO specification_extraction_chunks (id,job_id,chunk_number,page_from,page_to,page_count,priority,relevance,input_fingerprint) VALUES (?,?,?,?,?,?,?,?,?)").bind(chunkId, jobId, chunk.chunkNumber, chunk.pageFrom, chunk.pageTo, chunk.pageCount, chunk.priority, chunk.relevance, await sha(`${sourceFingerprint}|${chunk.pageFrom}|${chunk.pageTo}`)));
  }
  for (let index = 0; index < documentMap.entries.length; index += 1) {
    const entry = documentMap.entries[index]; const entryId = `${jobId}_map_${index + 1}`; const mappedEntry = mapped.find((item) => item.page === (entry.startPage || entry.page) && item.title === entry.title);
    const disciplines = entry.discipline ? String(entry.discipline).split(/,\s*/) : mappedEntry?.disciplines || [];
    statements.push(env.DB.prepare("INSERT INTO specification_document_map_entries (id,job_id,title,page_number,depth,disciplines,relevant,method,confidence) VALUES (?,?,?,?,?,?,?,?,?)").bind(entryId, jobId, entry.title, entry.startPage || entry.page, entry.depth || 0, json(disciplines), entry.method === "Unmapped Range" || mappedEntry?.relevant === false ? 0 : 1, entry.method, entry.confidence));
    statements.push(env.DB.prepare("INSERT INTO specification_document_map_details (entry_id,job_id,document_version_id,source_page,printed_page_reference,section_number,section_title,discipline,start_page,end_page,evidence_text,review_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(entryId, jobId, document.version_id, entry.sourcePage, entry.printedPageReference, entry.sectionNumber, entry.sectionTitle, entry.discipline || disciplines.join(", ") || "Unknown/Mixed", entry.startPage || entry.page, entry.endPage, entry.evidenceText, entry.reviewStatus || "Needs Review"));
  }
  for (let index = 0; index < statements.length; index += 80) await env.DB.batch(statements.slice(index, index + 80));
  return { job: await env.DB.prepare("SELECT * FROM specification_extraction_jobs WHERE id=?").bind(jobId).first(), idempotent: false };
};

const persistChunkEntities = async (db, job, chunk, result, map) => {
  const statements = [];
  const sequenceBase = Number(chunk.page_from) * 100000;
  const sectionIds = new Map((result.sections || []).map((section, index) => [section.sequence, `${chunk.id}_section_${index + 1}`]));
  const clauseIds = new Map((result.clauses || []).map((clause, index) => [clause.sequence, `${chunk.id}_clause_${index + 1}`]));
  const requirementIds = new Map((result.requirements || []).map((requirement, index) => [requirement.sequence, `${chunk.id}_requirement_${index + 1}`]));
  for (const page of result.pages || []) {
    const pageMap = map.find((entry) => entry.page === page.page) || {};
    statements.push(db.prepare("INSERT OR IGNORE INTO specification_extraction_pages (id,job_id,chunk_id,page_number,status,title,disciplines,relevant,text_content,ocr_text,extraction_method,confidence) VALUES (?,?,?,?,?,?,?,?,?,NULL,?,?)").bind(`${job.id}_page_${page.page}`, job.id, chunk.id, page.page, "Completed", pageMap.title || null, json(pageMap.disciplines || []), pageMap.relevant === false ? 0 : 1, (page.lines || []).join("\n"), result.extractionMethod, Math.round((page.extractionQuality || 0) * 100)));
  }
  const entityGroups = [["Section", result.sections], ["Clause", result.clauses], ["Requirement", result.requirements], ["Conflict", result.conflicts], ["Ambiguity", result.ambiguities], ["Missing Information", result.missingInformation]];
  for (const [type, entities] of entityGroups) for (let index = 0; index < (entities || []).length; index += 1) {
    const entity = entities[index];
    const pageFrom = entity.page || entity.pageFrom || entity.source?.pageFrom || null;
    const pageTo = entity.pageTo || entity.source?.pageTo || pageFrom;
    const fingerprint = await sha(`${job.source_fingerprint}|${type}|${pageFrom}|${pageTo}|${json(entity)}`);
    statements.push(db.prepare("INSERT OR IGNORE INTO specification_chunk_entities (id,job_id,chunk_id,entity_type,entity_key,page_from,page_to,payload,fingerprint,review_status) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(`${chunk.id}_${type.replaceAll(" ", "_")}_${index}`, job.id, chunk.id, type, `${chunk.chunk_number}:${index + 1}`, pageFrom, pageTo, json(entity), fingerprint, "Needs Review"));
  }
  for (let index = 0; index < (result.sections || []).length; index += 1) {
    const section = result.sections[index];
    statements.push(db.prepare("INSERT OR IGNORE INTO specification_sections (id,extraction_version_id,sequence,kind,number,title,level,page,path,source_text) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(sectionIds.get(section.sequence), job.extraction_version_id, sequenceBase + index + 1, section.kind, section.number, section.title, section.level, section.page, json(section.path), section.sourceText));
  }
  for (let index = 0; index < (result.clauses || []).length; index += 1) {
    const clause = result.clauses[index];
    statements.push(db.prepare("INSERT OR IGNORE INTO specification_clauses (id,extraction_version_id,sequence,kind,number,title,page_from,page_to,path,original_text) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(clauseIds.get(clause.sequence), job.extraction_version_id, sequenceBase + index + 1, clause.kind, clause.number, clause.title, clause.pageFrom, clause.pageTo, json(clause.path), clause.text));
  }
  for (let index = 0; index < (result.requirements || []).length; index += 1) {
    const requirement = result.requirements[index];
    const requirementId = requirementIds.get(requirement.sequence);
    const clause = (result.clauses || []).find((entry) => entry.number && entry.number === requirement.source?.clause) || result.clauses?.[requirement.sequence - 1];
    const current = { normalizedRequirement: requirement.normalizedRequirement, requirementType: requirement.requirementType, requirementCategory: requirement.requirementCategory, domain: requirement.domain?.value, category: requirement.category, condition: requirement.condition, exception: requirement.exception };
    statements.push(db.prepare("INSERT OR IGNORE INTO technical_requirements (id,extraction_version_id,project_id,source_document_id,clause_id,sequence,source_revision,original_text,normalized_requirement,engineering_domain,domain_source_type,system,category,subcategory,requirement_type,requirement_category,condition,exception,confidence,confidence_state,review_status,extraction_method,parser_version,model_version,source_location,original_values,current_values) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(requirementId, job.extraction_version_id, job.project_id, job.document_id, clause ? clauseIds.get(clause.sequence) : null, sequenceBase + index + 1, null, requirement.originalText, requirement.normalizedRequirement, requirement.domain?.value || "Unknown", requirement.domain?.sourceType || "Explicit", requirement.system, requirement.category, requirement.subcategory, requirement.requirementType, requirement.requirementCategory, requirement.condition, requirement.exception, requirement.confidence, requirement.confidenceState, requirement.reviewStatus, result.extractionMethod, SPEC_PARSER_VERSION, SPEC_MODEL_VERSION, json(requirement.source), json(requirement), json(current)));
    statements.push(db.prepare("INSERT OR IGNORE INTO requirement_evidence (id,extraction_version_id,requirement_id,evidence_type,source_location,original_text,extraction_method,confidence) VALUES (?,?,?,'Source Clause',?,?,?,?)").bind(`${requirementId}_evidence`, job.extraction_version_id, requirementId, json(requirement.source), requirement.originalText, result.extractionMethod, requirement.confidence));
    for (let item = 0; item < (requirement.attributes || []).length; item += 1) { const value = requirement.attributes[item]; statements.push(db.prepare("INSERT OR IGNORE INTO requirement_attributes (id,requirement_id,name,operator,original_value,parsed_value,original_unit,normalized_value,normalized_unit,confidence,source_location) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(`${requirementId}_attribute_${item + 1}`, requirementId, value.name, value.operator, value.originalValue, json(value.parsedValue), value.originalUnit, json(value.normalizedValue), value.normalizedUnit, value.confidence, json(requirement.source))); }
    for (let item = 0; item < (requirement.standards || []).length; item += 1) { const value = requirement.standards[item]; statements.push(db.prepare("INSERT OR IGNORE INTO requirement_standards (id,requirement_id,body,number,part,year,original_text,status,confidence) VALUES (?,?,?,?,?,?,?,?,?)").bind(`${requirementId}_standard_${item + 1}`, requirementId, value.body, value.number, value.part, value.year, value.originalText, value.status, value.confidence)); }
    for (let item = 0; item < (requirement.manufacturers || []).length; item += 1) { const value = requirement.manufacturers[item]; statements.push(db.prepare("INSERT OR IGNORE INTO requirement_manufacturers (id,requirement_id,manufacturer,status,scope,conditions,product_family,confidence) VALUES (?,?,?,?,NULL,NULL,NULL,?)").bind(`${requirementId}_manufacturer_${item + 1}`, requirementId, value.manufacturer, value.status, value.confidence)); }
    for (let item = 0; item < (requirement.compatibility || []).length; item += 1) { const value = requirement.compatibility[item]; statements.push(db.prepare("INSERT OR IGNORE INTO requirement_compatibility (id,requirement_id,source_item,target_item,relationship_type,conditions,exceptions,mandatory,confidence) VALUES (?,?,?,?,?,NULL,NULL,?,?)").bind(`${requirementId}_compatibility_${item + 1}`, requirementId, value.sourceItem, value.targetItem, value.type, value.mandatory ? 1 : 0, value.confidence)); }
    for (let item = 0; item < (requirement.accessories || []).length; item += 1) { const value = requirement.accessories[item]; statements.push(db.prepare("INSERT OR IGNORE INTO requirement_accessories (id,requirement_id,accessory,source_type,quantity_rule,confidence) VALUES (?,?,?,?,NULL,?)").bind(`${requirementId}_accessory_${item + 1}`, requirementId, value.accessory, value.sourceType, value.confidence)); }
    for (let item = 0; item < (requirement.ambiguities || []).length; item += 1) { const value = requirement.ambiguities[item]; statements.push(db.prepare("INSERT OR IGNORE INTO requirement_ambiguities (id,extraction_version_id,requirement_id,original_text,reason,technical_impact,commercial_impact,clarification_question,blocking) VALUES (?,?,?,?,?,?,?,?,?)").bind(`${requirementId}_ambiguity_${item + 1}`, job.extraction_version_id, requirementId, value.originalText, value.why, value.technicalImpact, value.commercialImpact, value.clarificationQuestion, value.blocking ? 1 : 0)); }
  }
  for (let index = 0; index < (result.missingInformation || []).length; index += 1) { const value = result.missingInformation[index]; statements.push(db.prepare("INSERT OR IGNORE INTO requirement_missing_information (id,extraction_version_id,requirement_id,field,reason_required,technical_impact,commercial_impact,blocking,clarification_question) VALUES (?,?,NULL,?,?,?,?,?,?)").bind(`${chunk.id}_missing_${index + 1}`, job.extraction_version_id, value.field, value.reasonRequired, value.technicalImpact, value.commercialImpact, value.blocking ? 1 : 0, value.clarificationQuestion)); }
  for (let index = 0; index < statements.length; index += 60) await db.batch(statements.slice(index, index + 60));
};

const checkpoint = async (db, jobId, chunkId) => {
  const job = await db.prepare("SELECT * FROM specification_extraction_jobs WHERE id=?").bind(jobId).first();
  const rows = await db.prepare("SELECT * FROM specification_extraction_chunks WHERE job_id=? ORDER BY priority,chunk_number").bind(jobId).all();
  const chunks = rows.results || [];
  const metrics = progressSnapshot({ totalPages: Number(job.total_pages), chunks, startedAt: job.started_at });
  const terminalChunks = chunks.filter((item) => ["Completed", "Needs Review"].includes(item.status));
  const currentProcessedPage = terminalChunks.length ? Number(terminalChunks.at(-1).page_to) : null;
  const nextChunk = chunks.find((item) => ["Running", "Retrying", "Queued"].includes(item.status));
  const totals = await db.prepare("SELECT COALESCE(SUM(clause_count),0) AS clauses,COALESCE(SUM(requirement_count),0) AS requirements FROM specification_extraction_chunks WHERE job_id=? AND status IN ('Completed','Needs Review')").bind(jobId).first();
  const resumeToken = crypto.randomUUID();
  await db.batch([
    db.prepare("UPDATE specification_extraction_jobs SET processed_pages=?,current_page=?,current_chunk=?,completed_chunks=?,remaining_chunks=?,extracted_clauses=?,extracted_requirements=?,elapsed_seconds=?,estimated_remaining_seconds=?,resume_token=?,last_checkpoint_at=? WHERE id=?").bind(metrics.processedPages, currentProcessedPage, Number(nextChunk?.chunk_number || 0) || null, metrics.completedChunks, metrics.remainingChunks, Number(totals?.clauses || 0), Number(totals?.requirements || 0), metrics.elapsedSeconds, metrics.estimatedRemainingSeconds, resumeToken, now(), jobId),
    db.prepare("INSERT INTO specification_extraction_checkpoints (id,job_id,chunk_id,processed_pages,completed_chunks,current_page,current_chunk,resume_token,worker_version,metrics) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(id("speccheckpoint"), jobId, chunkId, metrics.processedPages, metrics.completedChunks, currentProcessedPage, Number(nextChunk?.chunk_number || 0) || null, resumeToken, SPECIFICATION_JOB_VERSION, json({ ...metrics, currentPage: currentProcessedPage, currentChunk: Number(nextChunk?.chunk_number || 0) || null, clauses: Number(totals?.clauses || 0), requirements: Number(totals?.requirements || 0) })),
    db.prepare("UPDATE document_processing_runs SET status='Processing',stage='Specification Extraction',progress=?,updated_at=? WHERE id=(SELECT processing_run_id FROM specification_extraction_versions WHERE id=?)").bind(metrics.progress, now(), job.extraction_version_id),
  ]);
  return { ...metrics, clauses: Number(totals?.clauses || 0), requirements: Number(totals?.requirements || 0) };
};

const finalize = async (db, jobId) => {
  const job = await db.prepare("SELECT * FROM specification_extraction_jobs WHERE id=?").bind(jobId).first();
  const remaining = await db.prepare("SELECT COUNT(*) AS count FROM specification_extraction_chunks WHERE job_id=? AND status IN ('Queued','Running','Retrying')").bind(jobId).first();
  if (Number(remaining?.count || 0)) return false;
  const failures = await db.prepare("SELECT COUNT(*) AS count FROM specification_extraction_chunks WHERE job_id=? AND status IN ('Needs Review','Failed')").bind(jobId).first();
  const hardFailures = await db.prepare("SELECT COUNT(*) AS count FROM specification_extraction_chunks WHERE job_id=? AND status='Failed'").bind(jobId).first();
  const status = Number(hardFailures?.count || 0) > 0 && Number(job.processed_pages || 0) === 0 ? "Failed" : Number(failures?.count || 0) ? "Needs Review" : "Completed";
  const summary = { totalPagesReviewed: job.total_pages, totalClausesDetected: job.extracted_clauses, totalRequirementsExtracted: job.extracted_requirements, failedChunks: Number(failures?.count || 0), hardFailedChunks: Number(hardFailures?.count || 0), incremental: true, workerVersion: SPECIFICATION_JOB_VERSION };
  const run = await db.prepare("SELECT processing_run_id FROM specification_extraction_versions WHERE id=?").bind(job.extraction_version_id).first();
  await db.batch([
    db.prepare("UPDATE specification_extraction_jobs SET status=?,completed_at=?,failed_at=?,remaining_chunks=0,last_checkpoint_at=? WHERE id=?").bind(status, status === "Failed" ? null : now(), status === "Failed" ? now() : null, now(), jobId),
    db.prepare("UPDATE specification_extraction_versions SET status=?,extraction_method='pdfjs-coordinate-layout-chunks',summary=?,completed_at=? WHERE id=?").bind(status, json(summary), now(), job.extraction_version_id),
    db.prepare("UPDATE document_processing_runs SET status=?,progress=100,completed_at=?,updated_at=? WHERE id=(SELECT processing_run_id FROM specification_extraction_versions WHERE id=?)").bind(status, now(), now(), job.extraction_version_id),
    db.prepare("INSERT INTO processing_history (id,run_id,from_status,to_status,progress,actor,message) VALUES (?,?,?,?,100,?,'Specification extraction reached a terminal state')").bind(id("history"), run.processing_run_id, job.status, status, job.requested_by),
    db.prepare("UPDATE specification_extraction_versions SET superseded_at=? WHERE document_id=? AND id<>? AND superseded_at IS NULL").bind(now(), job.document_id, job.extraction_version_id),
  ]);
  return true;
};

export const processSpecificationJob = async (env, { jobId, dispatch } = {}) => {
  await ensureSpecificationJobSchema(env.DB);
  const job = await env.DB.prepare("SELECT * FROM specification_extraction_jobs WHERE id=?").bind(jobId).first();
  if (!job || ["Completed", "Failed", "Cancelled"].includes(job.status)) return { terminal: true, job };
  if (job.status === "Paused") return { terminal: false, paused: true, job };
  const cancelled = await env.DB.prepare("SELECT cancel_requested FROM document_processing_runs WHERE id=(SELECT processing_run_id FROM specification_extraction_versions WHERE id=?)").bind(job.extraction_version_id).first();
  if (cancelled?.cancel_requested) {
    await env.DB.prepare("UPDATE specification_extraction_jobs SET status='Cancelled',cancelled_at=?,last_checkpoint_at=? WHERE id=?").bind(now(), now(), jobId).run();
    return { terminal: true, cancelled: true };
  }
  // Recover work abandoned by a terminated worker. The persisted lease is the
  // restart boundary; completed chunks and their entities are never repeated.
  await env.DB.prepare("UPDATE specification_extraction_chunks SET status='Retrying',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE job_id=? AND status='Running' AND lease_expires_at IS NOT NULL AND lease_expires_at < datetime('now')").bind(now(), jobId).run();
  const chunk = await env.DB.prepare("SELECT * FROM specification_extraction_chunks WHERE job_id=? AND status IN ('Queued','Retrying') ORDER BY priority,chunk_number LIMIT 1").bind(jobId).first();
  if (!chunk) return { terminal: await finalize(env.DB, jobId) };
  const leaseOwner = id("specworker");
  const claim = await env.DB.prepare("UPDATE specification_extraction_chunks SET status='Running',attempt=attempt+1,lease_owner=?,lease_expires_at=datetime('now','+10 minutes'),started_at=COALESCE(started_at,?),updated_at=? WHERE id=? AND status IN ('Queued','Retrying')").bind(leaseOwner, now(), now(), chunk.id).run();
  if (!Number(claim.meta?.changes || 0)) return { claimed: false };
  const run = await env.DB.prepare("SELECT processing_run_id FROM specification_extraction_versions WHERE id=?").bind(job.extraction_version_id).first();
  await env.DB.batch([
    env.DB.prepare("UPDATE specification_extraction_jobs SET status='Running',current_chunk=?,current_page=?,last_checkpoint_at=? WHERE id=?").bind(chunk.chunk_number, chunk.page_from, now(), jobId),
    env.DB.prepare("INSERT INTO processing_history (id,run_id,from_status,to_status,progress,actor,message) VALUES (?,?,?,?,?,?,?)").bind(id("history"), run.processing_run_id, job.status, "Running", Math.round(Number(job.processed_pages || 0) / Number(job.total_pages || 1) * 100), job.requested_by, `Processing pages ${chunk.page_from}-${chunk.page_to}`),
  ]);
  const source = await env.DB.prepare("SELECT v.object_key,v.original_filename,v.extension,v.revision FROM specification_extraction_jobs j JOIN document_versions v ON v.id=j.document_version_id WHERE j.id=?").bind(jobId).first();
  const rss = () => globalThis.process?.memoryUsage?.().rss ?? null;
  const started = Date.now();
  const rssBefore = rss();
  const sourceStarted = Date.now();
  const rangeStats = { reads: 0, bytes: 0 };
  const sourceHead = String(source.extension).toLowerCase() === "pdf" && typeof env.FILES.head === "function" ? await env.FILES.head(source.object_key) : null;
  const rangeSource = sourceHead?.size ? {
    length: Number(sourceHead.size),
    fileName: source.original_filename,
    readRange: async (begin, end) => {
      const object = await env.FILES.get(source.object_key, { range: { offset: begin, length: end - begin } });
      if (!object) throw Object.assign(new Error("Stored source range is missing."), { code: "STORAGE_RANGE_MISSING" });
      const chunkBytes = new Uint8Array(await object.arrayBuffer());
      rangeStats.reads += 1; rangeStats.bytes += chunkBytes.byteLength;
      return chunkBytes;
    },
  } : null;
  const object = rangeSource ? null : await env.FILES.get(source.object_key);
  try {
    if (!rangeSource && !object) throw Object.assign(new Error("Stored source object is missing."), { code: "STORAGE_OBJECT_MISSING" });
    const bytes = rangeSource ? null : new Uint8Array(await object.arrayBuffer());
    const sourceBytes = Number(rangeSource?.length || bytes?.byteLength || 0);
    const sourceLoadMs = Date.now() - sourceStarted;
    const rssAfterLoad = rss();
    let result;
    const pageFailures = [];
    try {
      result = rangeSource
        ? await extractSpecificationDocumentChunkFromRangeSource(rangeSource, { extension: source.extension, fileName: source.original_filename, documentId: job.document_id, projectId: job.project_id, revision: source.revision }, { pageFrom: chunk.page_from, pageTo: chunk.page_to })
        : await extractSpecificationDocumentChunk(bytes, { extension: source.extension, fileName: source.original_filename, documentId: job.document_id, projectId: job.project_id, revision: source.revision }, { pageFrom: chunk.page_from, pageTo: chunk.page_to });
    } catch (rangeError) {
      const successful = [];
      for (let page = chunk.page_from; page <= chunk.page_to; page += 1) {
        try { successful.push(rangeSource ? await extractSpecificationDocumentChunkFromRangeSource(rangeSource, { extension: source.extension, fileName: source.original_filename, documentId: job.document_id, projectId: job.project_id, revision: source.revision }, { pageFrom: page, pageTo: page }) : await extractSpecificationDocumentChunk(bytes, { extension: source.extension, fileName: source.original_filename, documentId: job.document_id, projectId: job.project_id, revision: source.revision }, { pageFrom: page, pageTo: page })); }
        catch (error) { pageFailures.push({ page, error }); await env.DB.batch([env.DB.prepare("INSERT OR REPLACE INTO specification_extraction_pages (id,job_id,chunk_id,page_number,status,disciplines,relevant,extraction_method,confidence,error_code,error_message) VALUES (?,?,?,?,?,'[]',1,'page-isolation',0,?,?)").bind(`${job.id}_page_${page}`, job.id, chunk.id, page, "Needs Manual Review", error.code || "PAGE_EXTRACTION_FAILED", error.message), env.DB.prepare("INSERT INTO specification_extraction_failures (id,job_id,chunk_id,page_number,error_code,error_message,technical_details,attempt,retryable) VALUES (?,?,?,?,?,?,?,?,0)").bind(id("specfailure"), job.id, chunk.id, page, error.code || "PAGE_EXTRACTION_FAILED", error.message, error.technicalDetails || null, chunk.attempt + 1)]); }
      }
      result = { pages: successful.flatMap((item) => item.pages || []), sections: successful.flatMap((item) => item.sections || []), clauses: successful.flatMap((item) => item.clauses || []), requirements: successful.flatMap((item) => item.requirements || []), conflicts: successful.flatMap((item) => item.conflicts || []), ambiguities: successful.flatMap((item) => item.ambiguities || []), missingInformation: successful.flatMap((item) => item.missingInformation || []), extractionMethod: "pdfjs-coordinate-layout-page-isolation" };
      if (!successful.length) throw rangeError;
    }
    const pageMap = mapSpecificationPages(result.pages || [], job.project_system);
    const persistenceStarted = Date.now();
    await persistChunkEntities(env.DB, job, chunk, result, pageMap);
    const persistenceMs = Date.now() - persistenceStarted;
    const outputFingerprint = await sha(json({ pages: result.pages?.map((page) => page.page), clauses: result.clauses, requirements: result.requirements }));
    const terminalStatus = pageFailures.length ? "Needs Review" : "Completed";
    await env.DB.prepare("UPDATE specification_extraction_chunks SET status=?,output_fingerprint=?,extraction_method=?,clause_count=?,requirement_count=?,warning_count=?,duration_ms=?,error_code=NULL,error_message=NULL,technical_details=NULL,completed_at=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND lease_owner=?").bind(terminalStatus, outputFingerprint, result.extractionMethod, result.clauses?.length || 0, result.requirements?.length || 0, pageFailures.length, Date.now() - started, now(), now(), chunk.id, leaseOwner).run();
    await env.DB.prepare("INSERT OR REPLACE INTO specification_chunk_metrics (id,job_id,chunk_id,source_load_ms,parser_ms,segmentation_ms,persistence_ms,checkpoint_ms,total_ms,source_bytes,source_access_method,source_read_count,source_read_bytes,rss_before,rss_after_load,rss_peak,rss_after) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(`${chunk.id}_metrics`, job.id, chunk.id, sourceLoadMs, result.timing?.parserMs ?? null, result.timing?.segmentationMs ?? null, persistenceMs, null, Date.now() - started, sourceBytes, rangeSource ? "R2 Range" : "Full Object", rangeStats.reads, rangeStats.bytes, rssBefore, rssAfterLoad, Math.max(rssBefore || 0, rssAfterLoad || 0, rss() || 0) || null, rss()).run();
  } catch (error) {
    const latest = await env.DB.prepare("SELECT attempt,max_attempts FROM specification_extraction_chunks WHERE id=?").bind(chunk.id).first();
    const retry = Number(latest.attempt) < Number(latest.max_attempts);
    await env.DB.batch([
      env.DB.prepare("UPDATE specification_extraction_chunks SET status=?,error_code=?,error_message=?,technical_details=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?").bind(retry ? "Retrying" : "Failed", error.code || "SPECIFICATION_CHUNK_FAILED", error.message, error.technicalDetails || null, now(), chunk.id),
      env.DB.prepare("INSERT INTO specification_extraction_failures (id,job_id,chunk_id,error_code,error_message,technical_details,attempt,retryable) VALUES (?,?,?,?,?,?,?,?)").bind(id("specfailure"), job.id, chunk.id, error.code || "SPECIFICATION_CHUNK_FAILED", error.message, error.technicalDetails || null, Number(latest.attempt), retry ? 1 : 0),
    ]);
  }
  const checkpointStarted = Date.now();
  const metrics = await checkpoint(env.DB, jobId, chunk.id);
  await env.DB.prepare("UPDATE specification_chunk_metrics SET checkpoint_ms=?,total_ms=?,rss_peak=MAX(COALESCE(rss_peak,0),COALESCE(?,0)),rss_after=? WHERE chunk_id=?").bind(Date.now() - checkpointStarted, Date.now() - started, rss(), rss(), chunk.id).run();
  const done = await finalize(env.DB, jobId);
  if (!done && dispatch) await dispatch({ jobId });
  return { terminal: done, metrics };
};

export const specificationJobPayload = async (db, documentId) => {
  await ensureSpecificationJobSchema(db);
  const job = await db.prepare("SELECT * FROM specification_extraction_jobs WHERE document_id=? ORDER BY created_at DESC LIMIT 1").bind(documentId).first();
  if (!job) return null;
  const chunks = await db.prepare("SELECT id,chunk_number,page_from,page_to,page_count,relevance,status,attempt,max_attempts,clause_count,requirement_count,warning_count,duration_ms,error_code,error_message,updated_at FROM specification_extraction_chunks WHERE job_id=? ORDER BY chunk_number").bind(job.id).all();
  const failures = await db.prepare("SELECT id,chunk_id,page_number,error_code,error_message,attempt,retryable,created_at FROM specification_extraction_failures WHERE job_id=? ORDER BY created_at DESC LIMIT 100").bind(job.id).all();
  const map = await db.prepare("SELECT e.id,e.title,e.page_number,e.depth,e.disciplines,e.relevant,e.method,e.confidence,d.document_version_id,d.source_page,d.printed_page_reference,d.section_number,d.section_title,d.discipline,d.start_page,d.end_page,d.evidence_text,d.review_status FROM specification_document_map_entries e LEFT JOIN specification_document_map_details d ON d.entry_id=e.id WHERE e.job_id=? ORDER BY COALESCE(e.page_number,2147483647),e.depth,e.id").bind(job.id).all();
  const runtimeMetrics = await db.prepare("SELECT chunk_id,source_load_ms,parser_ms,segmentation_ms,persistence_ms,checkpoint_ms,total_ms,source_bytes,source_access_method,source_read_count,source_read_bytes,rss_before,rss_after_load,rss_peak,rss_after FROM specification_chunk_metrics WHERE job_id=? ORDER BY created_at,chunk_id").bind(job.id).all();
  const checkpoint = await db.prepare("SELECT id,processed_pages,completed_chunks,current_page,current_chunk,resume_token,worker_version,metrics,created_at FROM specification_extraction_checkpoints WHERE job_id=? ORDER BY created_at DESC,id DESC LIMIT 1").bind(job.id).first();
  return { ...job, chunks: chunks.results || [], failures: failures.results || [], documentMap: (map.results || []).map((entry) => ({ ...entry, disciplines: JSON.parse(entry.disciplines || "[]") })), runtimeMetrics: runtimeMetrics.results || [], checkpoint: checkpoint ? { ...checkpoint, metrics: JSON.parse(checkpoint.metrics || "{}") } : null };
};

export const retrySpecificationChunk = async (db, jobId, chunkId) => {
  const result = await db.prepare("UPDATE specification_extraction_chunks SET status='Retrying',error_code=NULL,error_message=NULL,technical_details=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND job_id=? AND status IN ('Needs Review','Failed')").bind(now(), chunkId, jobId).run();
  if (!Number(result.meta?.changes || 0)) return false;
  await db.prepare("UPDATE specification_extraction_jobs SET status='Running',completed_at=NULL,failed_at=NULL,last_checkpoint_at=? WHERE id=?").bind(now(), jobId).run();
  return true;
};
