import { requireMigratedTables } from "./schema-requirements.mjs";
import { BOQ_OCR_VERSION, BOQ_PARSER_VERSION, BOQ_ROW_TYPES, BOQ_RULESET_VERSION, compareBoqRevisions, extractBoqBytes } from "../app/domain/boq-extractor.mjs";
import { QUALIFIED_BOQ_ROW_TYPES } from "../app/domain/boq-row-qualification.mjs";
import { applicationActor, resolveApplicationContext } from "./application-context.mjs";
import { currentBoqEvidenceFrom } from "./current-evidence-scope.mjs";

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const parseJson = (value, fallback) => { try { return JSON.parse(value ?? ""); } catch { return fallback; } };
const normalized = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const BOQ_SCHEMA_TABLES = ["processing_logs", "boq_extraction_versions", "boq_extraction_sources", "boq_sections", "boq_items", "boq_extraction_evidence", "boq_extraction_warnings", "boq_review_decisions", "boq_revision_comparisons"];
let initialized = false;
export const ensureBoqExtractionSchema = async (db) => { if (!initialized) { await requireMigratedTables(db, BOQ_SCHEMA_TABLES); initialized = true; } };

const ownedDocument = (db, documentId, userId) => db.prepare(`SELECT d.id, d.project_id, d.document_type, d.classification_source, d.current_version_id AS version_id, p.name AS project_name, v.original_filename, v.extension, v.object_key, v.revision, c.id AS classification_id, c.primary_type, c.status AS classification_status, c.manual_review_required FROM documents d JOIN projects p ON p.id=d.project_id AND p.owner_user_id=? JOIN document_versions v ON v.id=d.current_version_id LEFT JOIN document_classifications c ON c.id=(SELECT id FROM document_classifications WHERE document_id=d.id AND superseded_at IS NULL ORDER BY classified_at DESC LIMIT 1) WHERE d.id=? AND d.deleted_at IS NULL`).bind(userId, documentId).first();
const currentExtraction = (db, documentId) => db.prepare(`SELECT e.* FROM boq_extraction_versions e JOIN documents d ON d.id=e.document_id AND d.current_version_id=e.document_version_id AND d.deleted_at IS NULL AND d.archived_at IS NULL JOIN document_versions v ON v.id=e.document_version_id AND v.document_id=d.id WHERE e.document_id=? AND e.superseded_at IS NULL AND e.status IN ('Completed','Needs Review') ORDER BY e.version_number DESC,e.id DESC LIMIT 1`).bind(documentId).first();
const extractionEligibility = (document) => document && document.primary_type === "BOQ" && (!document.manual_review_required || document.classification_status === "Manually Confirmed");

const updateJob = async (db, runId, fromStatus, status, progress, error = null) => {
  const stamp = now(); await db.batch([
    db.prepare("UPDATE document_processing_runs SET stage='BOQ Extraction', status=?, progress=?, error_code=?, error_message=?, technical_details=?, suggested_action=?, started_at=COALESCE(started_at, ?), completed_at=CASE WHEN ? IN ('Completed','Needs Review','Failed','Cancelled') THEN ? ELSE NULL END, updated_at=? WHERE id=?").bind(status, progress, error?.code || null, error?.userMessage || null, error?.technicalDetails || null, error?.suggestedAction || null, stamp, status, stamp, stamp, runId),
    db.prepare("INSERT INTO processing_history (id, run_id, from_status, to_status, progress, actor, error_code, message) VALUES (?, ?, ?, ?, ?, 'BOQ Extraction Worker', ?, ?)").bind(id("history"), runId, fromStatus, status, progress, error?.code || null, error?.userMessage || status),
    db.prepare("INSERT INTO processing_logs (id, run_id, level, stage, message, details) VALUES (?, ?, ?, 'BOQ Extraction', ?, ?)").bind(id("log"), runId, error ? "Error" : "Info", error?.technicalDetails || status, JSON.stringify({ progress, errorCode: error?.code || null })),
  ]);
};

const persistExtraction = async (env, document, extractionId, result) => {
  const itemIds = new Map(result.rows.map((row) => [row.sequence, id("boqitem")])); const statements = [];
  for (const source of result.sources) statements.push(env.DB.prepare("INSERT INTO boq_extraction_sources (id, extraction_version_id, source_kind, label, sheet_name, page_number, classification, hidden, header_rows, column_mapping, merged_ranges, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id("boqsource"), extractionId, source.kind, source.label, source.kind === "Sheet" ? source.label : null, source.page || null, source.classification, source.hidden ? 1 : 0, JSON.stringify(source.header?.sourceRows || []), JSON.stringify(source.header?.columns || {}), JSON.stringify(source.mergedRanges || []), JSON.stringify({ frozenRows: source.frozenRows || 0 })));
  for (const row of result.rows) {
    const itemId = itemIds.get(row.sequence); const current = { itemNumber: row.itemNumber, description: row.description, unit: row.unit.original, normalizedUnit: row.unit.normalized, quantity: row.quantity.original, numericQuantity: row.quantity.numeric, rowType: row.rowType, section: row.section, subsection: row.subsection, manufacturer: row.manufacturer, partNumber: row.partNumber, notes: row.notes };
    statements.push(env.DB.prepare(`INSERT INTO boq_items (id, extraction_version_id, project_id, source_document_id, duplicate_of_item_id, sequence, item_number, parent_item_number, section, subsection, hierarchy_depth, section_path, system_value, system_source_type, system_confidence, category, subcategory, description, normalized_description, original_unit, normalized_unit, unit_rule, unit_confidence, original_quantity, numeric_quantity, quantity_type, quantity_formula, quantity_confidence, manufacturer, brand, model, part_number, specification_reference, drawing_reference, notes, alternates, included_accessories, excluded_scope, row_type, extraction_confidence, confidence_state, review_status, source_location, original_raw_values, current_values, approved_for_downstream) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`).bind(itemId, extractionId, document.project_id, document.id, row.duplicateOfSequence ? itemIds.get(row.duplicateOfSequence) : null, row.sequence, row.itemNumber, row.parentItemNumber, row.section, row.subsection, row.hierarchyDepth, JSON.stringify(row.sectionPath), row.system.value, row.system.sourceType, row.system.confidence, row.category, row.subcategory, row.description, row.normalizedDescription, row.unit.original, row.unit.normalized, row.unit.rule, row.unit.confidence, row.quantity.original, row.quantity.numeric === null ? null : String(row.quantity.numeric), row.quantity.type, row.quantity.formula, row.quantity.confidence, row.manufacturer, row.brand, row.model, row.partNumber, row.specificationReference, row.drawingReference, row.notes, row.alternates, row.includedAccessories, row.excludedScope, row.rowType, row.confidence, row.confidenceState, row.reviewStatus, JSON.stringify(row.source), JSON.stringify(row.source.rawValues), JSON.stringify(current)));
    for (const field of ["description", "unit", "quantity", "itemNumber", "manufacturer", "partNumber"]) { const raw = field === "unit" ? row.unit.original : field === "quantity" ? row.quantity.original : row[field]; const normal = field === "unit" ? row.unit.normalized : field === "quantity" ? row.quantity.numeric : field === "description" ? row.normalizedDescription : row[field]; if (raw !== null && raw !== "") statements.push(env.DB.prepare("INSERT INTO boq_extraction_evidence (id, extraction_version_id, item_id, field_name, source_kind, source_location, raw_value, normalized_value, confidence, method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id("boqevidence"), extractionId, itemId, field, row.source.kind, JSON.stringify(row.source), String(raw), normal === null ? null : String(normal), field === "unit" ? row.unit.confidence : field === "quantity" ? row.quantity.confidence : row.confidence, "deterministic-source-parser")); }
    for (const warning of row.warnings) statements.push(env.DB.prepare("INSERT INTO boq_extraction_warnings (id, extraction_version_id, item_id, code, severity, message, source_location) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id("boqwarning"), extractionId, itemId, warning.code, ["MISSING_DESCRIPTION", "QUANTITY_REVIEW"].includes(warning.code) ? "High" : "Medium", warning.message, JSON.stringify(row.source)));
  }
  for (let index = 0; index < statements.length; index += 75) await env.DB.batch(statements.slice(index, index + 75));
  await env.DB.prepare("UPDATE boq_extraction_versions SET status=?, extraction_method=?, summary=?, completed_at=? WHERE id=?").bind(result.summary.itemsNeedingReview ? "Needs Review" : "Completed", result.extractionMethod, JSON.stringify(result.summary), now(), extractionId).run();
};

export const executeBoqExtraction = async (env, { documentId, userId, reason = "Automatic BOQ extraction" }) => {
  await ensureBoqExtractionSchema(env.DB); const document = await ownedDocument(env.DB, documentId, userId);
  if (!document) throw Object.assign(new Error("Document is unavailable or not owned by this user."), { code: "DOCUMENT_FORBIDDEN" });
  if (!extractionEligibility(document)) throw Object.assign(new Error("Confirm the BOQ classification before extraction."), { code: "BOQ_CLASSIFICATION_CONFIRMATION_REQUIRED" });
  const previous = await currentExtraction(env.DB, document.id); const versionNumber = Number(previous?.version_number || 0) + 1; const runId = id("job"); const extractionId = id("boqextract"); const stamp = now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO document_processing_runs (id, document_version_id, stage, status, progress, processor_version) VALUES (?, ?, 'BOQ Extraction', 'Queued', 1, ?)").bind(runId, document.version_id, BOQ_PARSER_VERSION),
    env.DB.prepare("INSERT INTO processing_history (id, run_id, from_status, to_status, progress, actor, message) VALUES (?, ?, NULL, 'Queued', 1, ?, ?)").bind(id("history"), runId, userId, reason),
    env.DB.prepare("INSERT INTO boq_extraction_versions (id, document_id, document_version_id, classification_id, processing_run_id, version_number, status, parser_version, ruleset_version, ocr_version, created_by) VALUES (?, ?, ?, ?, ?, ?, 'Queued', ?, ?, ?, ?)").bind(extractionId, document.id, document.version_id, document.classification_id, runId, versionNumber, BOQ_PARSER_VERSION, BOQ_RULESET_VERSION, BOQ_OCR_VERSION, userId),
  ]);
  try {
    await updateJob(env.DB, runId, "Queued", "Loading File", 8); const object = await env.FILES.get(document.object_key); if (!object) throw Object.assign(new Error("Stored source object is missing."), { code: "STORAGE_OBJECT_MISSING" });
    const workbook = ["xls", "xlsx"].includes(document.extension); const bytes = new Uint8Array(await object.arrayBuffer()); await updateJob(env.DB, runId, "Loading File", workbook ? "Reading Sheets" : "Reading Pages", 28);
    const started = Date.now(); await updateJob(env.DB, runId, workbook ? "Reading Sheets" : "Reading Pages", "Detecting Tables", 45);
    const result = extractBoqBytes(bytes, { extension: document.extension, fileName: document.original_filename, projectId: document.project_id, documentId: document.id, revision: document.revision });
    if (Date.now() - started > 25_000) throw Object.assign(new Error("Extraction exceeded the 25 second local worker budget."), { code: "BOQ_EXTRACTION_TIMEOUT" });
    await updateJob(env.DB, runId, "Detecting Tables", "Validating", 76); await persistExtraction(env, document, extractionId, result); if (previous) await env.DB.prepare("UPDATE boq_extraction_versions SET superseded_at=? WHERE id=?").bind(stamp, previous.id).run();
    const finalStatus = result.summary.itemsNeedingReview ? "Needs Review" : "Completed"; await updateJob(env.DB, runId, "Saving", finalStatus, 100);
    await env.DB.prepare("INSERT INTO document_audit_events (id, project_id, document_id, version_id, actor_user_id, action, old_value, new_value, reason, request_id) VALUES (?, ?, ?, ?, ?, 'BOQ Extraction Completed', ?, ?, ?, ?)").bind(id("audit"), document.project_id, document.id, document.version_id, userId, JSON.stringify(previous ? { extractionVersionId: previous.id } : null), JSON.stringify({ extractionId, versionNumber, status: finalStatus, summary: result.summary }), reason, id("request")).run();
    return { extractionId, status: finalStatus, summary: result.summary };
  } catch (error) {
    const detail = { code: error.code || "BOQ_EXTRACTION_FAILED", userMessage: error.userMessage || "The BOQ could not be extracted.", technicalDetails: error.technicalDetails || error.message, suggestedAction: error.suggestedAction || "Retry or review the source manually." };
    await env.DB.prepare("UPDATE boq_extraction_versions SET status='Failed', error_code=?, error_message=?, technical_details=?, suggested_action=?, completed_at=? WHERE id=?").bind(detail.code, detail.userMessage, detail.technicalDetails, detail.suggestedAction, now(), extractionId).run(); await updateJob(env.DB, runId, "Loading File", "Failed", 100, detail); throw Object.assign(new Error(detail.userMessage), detail);
  }
};

export const scheduleAutomaticBoqExtraction = (env, ctx, { documentId, userId, reason }) => ctx.waitUntil(executeBoqExtraction(env, { documentId, userId, reason }).catch(() => undefined));

const extractionPayload = async (db, documentId) => { const extraction = await currentExtraction(db, documentId); if (!extraction) return null; return { ...extraction, summary: parseJson(extraction.summary, {}) }; };
const itemPayload = (row) => ({ ...row, section_path: parseJson(row.section_path, []), source_location: parseJson(row.source_location, {}), original_raw_values: parseJson(row.original_raw_values, []), current_values: parseJson(row.current_values, {}) });
const getItem = (db, itemId, userId) => db.prepare(`SELECT i.* FROM ${currentBoqEvidenceFrom("i")} JOIN projects p ON p.id=i.project_id WHERE i.id=? AND p.owner_user_id=?`).bind(itemId, userId).first();
const auditDecision = async (db, item, user, action, previous, next, reason) => db.batch([
  db.prepare("INSERT INTO boq_review_decisions (id, extraction_version_id, item_id, action, previous_value, new_value, reason, decided_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id("boqdecision"), item.extraction_version_id, item.id, action, JSON.stringify(previous), JSON.stringify(next), reason, user.id),
  db.prepare("INSERT INTO document_audit_events (id, project_id, document_id, version_id, actor_user_id, action, old_value, new_value, reason, request_id) SELECT ?, i.project_id, i.source_document_id, e.document_version_id, ?, ?, ?, ?, ?, ? FROM boq_items i JOIN boq_extraction_versions e ON e.id=i.extraction_version_id WHERE i.id=?").bind(id("audit"), user.id, `BOQ ${action}`, JSON.stringify(previous), JSON.stringify(next), reason, id("request"), item.id),
]);

const csvCell = (value) => { const safe = /^[=+\-@]/.test(String(value ?? "")) ? `'${value}` : String(value ?? ""); return `"${safe.replaceAll('"', '""')}"`; };

export const handleBoqExtractionApi = async (request, env, ctx) => {
  const url = new URL(request.url); if (!url.pathname.includes("/boq-extraction") && !url.pathname.includes("/boq-items")) return null;
  if (!env.DB || !env.FILES) return json({ error: { code: "BOQ_ENGINE_UNAVAILABLE", message: "BOQ extraction storage is unavailable.", suggestedAction: "Verify DB and FILES bindings." } }, 503);
  await ensureBoqExtractionSchema(env.DB); const resolved = await resolveApplicationContext(request, env); if (resolved.error) return json({ error: resolved.error }, resolved.error.status); const user = applicationActor(resolved.context);
  if (url.pathname === "/api/boq-items/bulk-review" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const itemIds = [...new Set((Array.isArray(body.itemIds) ? body.itemIds : []).map((value) => String(value || "").trim()).filter(Boolean))];
    if (!itemIds.length) return json({ error: { code: "BULK_REVIEW_ITEMS_REQUIRED", message: "Select at least one BOQ row.", suggestedAction: "Select the source rows that share this review decision." } }, 422);
    if (itemIds.length > 50) return json({ error: { code: "BULK_REVIEW_LIMIT_EXCEEDED", message: "A bulk review is limited to 50 rows.", suggestedAction: "Review a smaller source section or sequence range." } }, 422);
    const reason = String(body.reason || "").trim();
    if (reason.length < 3) return json({ error: { code: "REVIEW_REASON_REQUIRED", message: "Provide a reason for this bulk decision.", suggestedAction: "Explain the shared source evidence or exclusion basis." } }, 422);
    const operation = String(body.operation || "");
    if (!["approve", "reject"].includes(operation)) return json({ error: { code: "INVALID_BULK_REVIEW_OPERATION", message: "Choose bulk approve or bulk reject." } }, 422);

    const items = [];
    for (const itemId of itemIds) {
      const item = await getItem(env.DB, itemId, user.id);
      if (!item) return json({ error: { code: "BOQ_ITEM_NOT_FOUND", message: "A selected BOQ row is unavailable or not owned by this user.", suggestedAction: "Refresh the extraction review before retrying." } }, 404);
      items.push(item);
    }
    if (new Set(items.map((item) => item.extraction_version_id)).size !== 1) return json({ error: { code: "BULK_REVIEW_EXTRACTION_MISMATCH", message: "Bulk decisions must belong to one extraction version.", suggestedAction: "Review one source document at a time." } }, 422);
    if (operation === "approve" && items.some((item) => item.row_type !== "BOQ Item")) return json({ error: { code: "NON_ITEM_APPROVAL_BLOCKED", message: "Only BOQ Item rows can be approved downstream.", suggestedAction: "Remove headers, notes and totals from the approval selection." } }, 422);

    const stamp = now();
    const statements = [];
    for (const item of items) {
      const previous = parseJson(item.current_values, {});
      const next = { ...previous };
      const reviewStatus = operation === "approve" ? "Approved" : "Rejected";
      statements.push(
        env.DB.prepare("UPDATE boq_items SET review_status=?, approved_for_downstream=?, updated_at=? WHERE id=? AND extraction_version_id=?").bind(reviewStatus, operation === "approve" ? 1 : 0, stamp, item.id, item.extraction_version_id),
        env.DB.prepare("INSERT INTO boq_review_decisions (id, extraction_version_id, item_id, action, previous_value, new_value, reason, decided_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id("boqdecision"), item.extraction_version_id, item.id, operation, JSON.stringify(previous), JSON.stringify(next), reason, user.id),
        env.DB.prepare("INSERT INTO document_audit_events (id, project_id, document_id, version_id, actor_user_id, action, old_value, new_value, reason, request_id) SELECT ?, i.project_id, i.source_document_id, e.document_version_id, ?, ?, ?, ?, ?, ? FROM boq_items i JOIN boq_extraction_versions e ON e.id=i.extraction_version_id WHERE i.id=?").bind(id("audit"), user.id, `BOQ bulk ${operation}`, JSON.stringify(previous), JSON.stringify(next), reason, id("request"), item.id),
      );
    }
    await env.DB.batch(statements);
    return json({ operation, reviewed: items.length, itemIds });
  }
  const itemMatch = url.pathname.match(/^\/api\/boq-items\/([^/]+)(?:\/(update|restore|row-type|approve|reject|merge|split|evidence|warnings))?$/);
  if (itemMatch) {
    const item = await getItem(env.DB, decodeURIComponent(itemMatch[1]), user.id); if (!item) return json({ error: { code: "BOQ_ITEM_NOT_FOUND", message: "BOQ item not found.", suggestedAction: "Refresh the extraction review." } }, 404);
    const operation = itemMatch[2] || "detail";
    if (operation === "detail" && request.method === "GET") return json({ item: itemPayload(item) });
    if (["evidence", "warnings"].includes(operation) && request.method === "GET") { const table = operation === "evidence" ? "boq_extraction_evidence" : "boq_extraction_warnings"; const rows = await env.DB.prepare(`SELECT * FROM ${table} WHERE item_id=?`).bind(item.id).all(); return json({ [operation]: rows.results || [] }); }
    if (["update", "restore", "row-type", "approve", "reject", "split", "merge"].includes(operation) && request.method === "POST") {
      const body = await request.json(); const reason = String(body.reason || "").trim(); if (reason.length < 3) return json({ error: { code: "REVIEW_REASON_REQUIRED", message: "Provide a reason for this change.", suggestedAction: "Explain the source evidence or correction." } }, 422);
      const previous = parseJson(item.current_values, {}); let next = { ...previous }; let reviewStatus = item.review_status; let rowTypeValue = item.row_type;
      if (operation === "update") { const allowed = ["itemNumber", "description", "unit", "normalizedUnit", "quantity", "numericQuantity", "section", "subsection", "manufacturer", "partNumber", "notes", "system", "category", "subcategory"]; next = { ...next, ...Object.fromEntries(Object.entries(body.values || {}).filter(([key]) => allowed.includes(key))) }; reviewStatus = "Needs Review"; }
      if (operation === "restore") { const original = parseJson(item.original_raw_values, []); const source = parseJson(item.source_location, {}); const requestedField = String(body.field || ""); const cellReference = source.cells?.[requestedField]; if (!cellReference) return json({ error: { code: "ORIGINAL_FIELD_NOT_FOUND", message: "The original source field cannot be located.", suggestedAction: "Open the extraction evidence and select a mapped field." } }, 422); const columnLetters = String(cellReference).match(/^[A-Z]+/)?.[0] || ""; const columnIndex = [...columnLetters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1; const map = { itemNumber: "itemNumber", description: "description", unit: "unit", quantity: "quantity", manufacturer: "manufacturer", partNumber: "partNumber", notes: "notes" }; if (!map[requestedField] || columnIndex < 0) return json({ error: { code: "ORIGINAL_FIELD_NOT_FOUND", message: "The original source field cannot be located." } }, 422); next[map[requestedField]] = original[columnIndex] ?? ""; reviewStatus = "Needs Review"; }
      if (operation === "row-type") { if (![...BOQ_ROW_TYPES, ...QUALIFIED_BOQ_ROW_TYPES].includes(body.rowType)) return json({ error: { code: "INVALID_ROW_TYPE", message: "Choose a supported row type." } }, 422); rowTypeValue = body.rowType; next.rowType = body.rowType; reviewStatus = "Needs Review"; }
      if (operation === "approve") { if (rowTypeValue !== "BOQ Item") return json({ error: { code: "NON_ITEM_APPROVAL_BLOCKED", message: "Only BOQ Item rows can be approved downstream." } }, 422); reviewStatus = "Approved"; }
      if (operation === "reject") reviewStatus = "Rejected";
      if (operation === "split") { const descriptions = Array.isArray(body.descriptions) ? body.descriptions.map(String).map((value) => value.trim()).filter(Boolean) : []; if (descriptions.length < 2) return json({ error: { code: "SPLIT_VALUES_REQUIRED", message: "Provide at least two description fragments." } }, 422); const max = await env.DB.prepare("SELECT MAX(sequence) AS maximum FROM boq_items WHERE extraction_version_id=?").bind(item.extraction_version_id).first(); for (let index = 1; index < descriptions.length; index += 1) await env.DB.prepare("INSERT INTO boq_items SELECT ?, extraction_version_id, project_id, source_document_id, section_id, NULL, ? + ?, item_number, parent_item_number, section, subsection, hierarchy_depth, section_path, system_value, system_source_type, system_confidence, category, subcategory, ?, ?, original_unit, normalized_unit, unit_rule, unit_confidence, original_quantity, numeric_quantity, quantity_type, quantity_formula, quantity_confidence, manufacturer, brand, model, part_number, specification_reference, drawing_reference, notes, alternates, included_accessories, excluded_scope, row_type, MIN(extraction_confidence, 69), 'Needs Review', 'Needs Review', source_location, original_raw_values, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM boq_items WHERE id=?").bind(id("boqitem"), Number(max?.maximum || 0), index, descriptions[index], normalized(descriptions[index]), JSON.stringify({ ...next, description: descriptions[index] }), item.id).run(); next.description = descriptions[0]; reviewStatus = "Needs Review"; }
      if (operation === "merge") { const other = await getItem(env.DB, String(body.otherItemId || ""), user.id); if (!other || other.extraction_version_id !== item.extraction_version_id) return json({ error: { code: "MERGE_ITEM_INVALID", message: "Select another row from this extraction." } }, 422); const otherValues = parseJson(other.current_values, {}); next.description = [next.description, otherValues.description].filter(Boolean).join(" "); await env.DB.prepare("UPDATE boq_items SET review_status='Merged', approved_for_downstream=0, updated_at=? WHERE id=?").bind(now(), other.id).run(); }
      await env.DB.prepare("UPDATE boq_items SET row_type=?, review_status=?, current_values=?, description=?, normalized_description=?, original_unit=?, normalized_unit=?, original_quantity=?, numeric_quantity=?, section=?, subsection=?, manufacturer=?, part_number=?, notes=?, system_value=?, system_source_type=CASE WHEN ? IS NOT NULL THEN 'Reviewed BOQ Classification' ELSE system_source_type END, system_confidence=CASE WHEN ? IS NOT NULL THEN 100 ELSE system_confidence END, category=?, subcategory=?, approved_for_downstream=?, updated_at=? WHERE id=?").bind(rowTypeValue, reviewStatus, JSON.stringify(next), next.description || null, normalized(next.description), next.unit || null, next.normalizedUnit || null, next.quantity || null, next.numericQuantity === null || next.numericQuantity === undefined ? null : String(next.numericQuantity), next.section || null, next.subsection || null, next.manufacturer || null, next.partNumber || null, next.notes || null, next.system || item.system_value || null, next.system ?? null, next.system ?? null, next.category || item.category || null, next.subcategory || item.subcategory || null, reviewStatus === "Approved" && rowTypeValue === "BOQ Item" ? 1 : 0, now(), item.id).run(); await auditDecision(env.DB, item, user, operation, previous, next, reason); return json({ item: itemPayload(await getItem(env.DB, item.id, user.id)) });
    }
  }
  const match = url.pathname.match(/^\/api\/documents\/([^/]+)\/boq-extraction(?:\/(start|status|summary|items|evidence|warnings|rerun|compare|export|history|approved-items))?$/); if (!match) return null;
  const document = await ownedDocument(env.DB, decodeURIComponent(match[1]), user.id); if (!document) return json({ error: { code: "DOCUMENT_NOT_FOUND", message: "Document not found." } }, 404); const operation = match[2] || "summary";
  if (["start", "rerun"].includes(operation) && request.method === "POST") { const existing = await currentExtraction(env.DB, document.id); if (operation === "start" && existing && !existing.superseded_at) return json({ extraction: await extractionPayload(env.DB, document.id), idempotent: true }); ctx.waitUntil(executeBoqExtraction(env, { documentId: document.id, userId: user.id, reason: operation === "rerun" ? "User requested BOQ re-extraction" : "User started BOQ extraction" }).catch(() => undefined)); return json({ status: "Queued", documentId: document.id }, 202); }
  const extraction = await currentExtraction(env.DB, document.id); if (!extraction) return json({ error: { code: "BOQ_EXTRACTION_REQUIRED", message: "No BOQ extraction exists.", suggestedAction: "Confirm the BOQ classification and start extraction." } }, 409);
  if (["status", "summary"].includes(operation) && request.method === "GET") return json({ extraction: await extractionPayload(env.DB, document.id) });
  if (operation === "history" && request.method === "GET") { const rows = await env.DB.prepare("SELECT * FROM boq_extraction_versions WHERE document_id=? ORDER BY version_number DESC").bind(document.id).all(); return json({ history: (rows.results || []).map((row) => ({ ...row, summary: parseJson(row.summary, {}) })) }); }
  if (["items", "approved-items"].includes(operation) && request.method === "GET") {
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 50)));
    const filter = operation === "approved-items" ? "AND approved_for_downstream=1 AND row_type='BOQ Item'" : url.searchParams.get("reviewStatus") ? "AND review_status=?" : "";
    const params = filter.includes("?") ? [extraction.id, url.searchParams.get("reviewStatus"), limit, (page - 1) * limit] : [extraction.id, limit, (page - 1) * limit];
    const [rows, warnings, decisions] = await Promise.all([
      env.DB.prepare(`SELECT * FROM boq_items WHERE extraction_version_id=? ${filter} ORDER BY sequence LIMIT ? OFFSET ?`).bind(...params).all(),
      env.DB.prepare("SELECT id, item_id, code, severity, message FROM boq_extraction_warnings WHERE extraction_version_id=? AND resolved_at IS NULL ORDER BY CASE severity WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END, id").bind(extraction.id).all(),
      env.DB.prepare("SELECT item_id, action, reason, decided_by, decided_at FROM boq_review_decisions WHERE extraction_version_id=? ORDER BY decided_at DESC, id DESC").bind(extraction.id).all(),
    ]);
    const warningsByItem = new Map();
    for (const warning of warnings.results || []) {
      const itemWarnings = warningsByItem.get(warning.item_id) || [];
      itemWarnings.push(warning);
      warningsByItem.set(warning.item_id, itemWarnings);
    }
    const latestReviewByItem = new Map();
    for (const decision of decisions.results || []) {
      if (!latestReviewByItem.has(decision.item_id)) latestReviewByItem.set(decision.item_id, decision);
    }
    return json({
      items: (rows.results || []).map((row) => ({
        ...itemPayload(row),
        warnings: warningsByItem.get(row.id) || [],
        latest_review: latestReviewByItem.get(row.id) || null,
      })),
      page,
      limit,
    });
  }
  if (["evidence", "warnings"].includes(operation) && request.method === "GET") { const table = operation === "evidence" ? "boq_extraction_evidence" : "boq_extraction_warnings"; const rows = await env.DB.prepare(`SELECT * FROM ${table} WHERE extraction_version_id=? LIMIT 1000`).bind(extraction.id).all(); return json({ [operation]: rows.results || [] }); }
  if (operation === "compare" && request.method === "POST") { const body = await request.json(); const previousId = String(body.previousExtractionVersionId || ""); const previousRows = await env.DB.prepare("SELECT * FROM boq_items WHERE extraction_version_id=? ORDER BY sequence").bind(previousId).all(); const currentRows = await env.DB.prepare("SELECT * FROM boq_items WHERE extraction_version_id=? ORDER BY sequence").bind(extraction.id).all(); const comparison = compareBoqRevisions((previousRows.results || []).map((row) => ({ ...row, normalizedDescription: row.normalized_description, itemNumber: row.item_number, rowType: row.row_type, quantity: { original: row.original_quantity }, unit: { original: row.original_unit } })), (currentRows.results || []).map((row) => ({ ...row, normalizedDescription: row.normalized_description, itemNumber: row.item_number, rowType: row.row_type, quantity: { original: row.original_quantity }, unit: { original: row.original_unit } }))); await env.DB.prepare("INSERT OR REPLACE INTO boq_revision_comparisons (id, project_id, previous_extraction_version_id, current_extraction_version_id, added_count, removed_count, changed_count, changes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id("boqcompare"), document.project_id, previousId, extraction.id, comparison.added, comparison.removed, comparison.changed, JSON.stringify(comparison.changes), user.id).run(); return json({ comparison }); }
  if (operation === "export" && request.method === "GET") { const rows = await env.DB.prepare("SELECT * FROM boq_items WHERE extraction_version_id=? ORDER BY sequence").bind(extraction.id).all(); const header = ["Sequence", "Item Number", "Row Type", "Description", "Unit", "Quantity", "Section", "Review Status", "Source"]; const lines = [header, ...(rows.results || []).map((row) => [row.sequence, row.item_number, row.row_type, row.description, row.original_unit, row.original_quantity, row.section, row.review_status, row.source_location])].map((row) => row.map(csvCell).join(",")); return new Response(lines.join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="boq-extraction-v${extraction.version_number}.csv"`, "cache-control": "no-store" } }); }
  return json({ error: { code: "BOQ_API_NOT_FOUND", message: "BOQ extraction operation not found." } }, 404);
};
