import { extractSupplierQuote, exactProductCandidates, supplierPriceEligibility, SUPPLIER_PRICE_INTAKE_VERSION } from "../app/domain/supplier-price-intake.mjs";
import { applicationActor, resolveApplicationContext } from "./application-context.mjs";
import { requireMigratedTables } from "./schema-requirements.mjs";
import { CANONICAL_DISCOVERY_PRODUCT_PREDICATE } from "./canonical-product-authority.mjs";

const TABLES = ["supplier_quote_intake_runs", "supplier_quote_intake_rows", "supplier_quote_intake_events", "library_products", "product_sources", "price_records", "suppliers"];
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const makeId = prefix => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const minor = value => value === null || value === undefined ? null : Math.round(Number(value) * 100);
const basisPoints = value => value === null || value === undefined ? null : Math.round(Number(value) * 100);
const projectPath = pathname => pathname.match(/^\/api\/projects\/([^/]+)\/supplier-price-intake(?:\/([^/]+))?(?:\/([^/]+))?$/);

const context = async (request, env) => {
  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return { error: json({ error: { code: resolved.error.code, message: resolved.error.message } }, resolved.error.status) };
  return { actor: applicationActor(resolved.context) };
};

const ownedProject = (db, projectId, userId) => db.prepare("SELECT id, organization_id FROM projects WHERE id=? AND owner_user_id=?").bind(projectId, userId).first();
const ownedDocument = (db, projectId, documentId, userId) => db.prepare("SELECT d.id,d.project_id,d.current_version_id,v.original_filename,v.extension,v.sha256,v.object_key FROM documents d JOIN projects p ON p.id=d.project_id JOIN document_versions v ON v.id=d.current_version_id WHERE d.id=? AND d.project_id=? AND p.owner_user_id=? AND d.deleted_at IS NULL").bind(documentId, projectId, userId).first();

export const executeSupplierQuoteExtraction = async (env, { documentId, userId }) => {
  await requireMigratedTables(env.DB, TABLES);
  const document = await env.DB.prepare("SELECT d.id,d.project_id,d.current_version_id,v.original_filename,v.extension,v.sha256,v.object_key FROM documents d JOIN projects p ON p.id=d.project_id JOIN document_versions v ON v.id=d.current_version_id WHERE d.id=? AND p.owner_user_id=? AND d.deleted_at IS NULL").bind(documentId, userId).first();
  if (!document) throw Object.assign(new Error("Supplier quotation document was not found in this project."), { code: "DOCUMENT_NOT_FOUND" });
  if (!["xls", "xlsx", "csv"].includes(String(document.extension).toLowerCase())) throw Object.assign(new Error("Structured supplier quote extraction supports XLS, XLSX and CSV only."), { code: "UNSUPPORTED_SUPPLIER_QUOTE_FORMAT" });
  const fingerprint = `${document.sha256}:${SUPPLIER_PRICE_INTAKE_VERSION}`;
  const duplicate = await env.DB.prepare("SELECT * FROM supplier_quote_intake_runs WHERE project_id=? AND document_version_id=? AND input_fingerprint=?").bind(document.project_id, document.current_version_id, fingerprint).first();
  if (duplicate) return { run: duplicate, idempotent: true };
  const object = await env.FILES.get(document.object_key);
  if (!object) throw Object.assign(new Error("Stored supplier quotation is unavailable."), { code: "STORAGE_OBJECT_MISSING" });
  const result = extractSupplierQuote(new Uint8Array(await object.arrayBuffer()), { extension: document.extension, fileName: document.original_filename });
  const runId = makeId("supplierquoteintake");
  const candidateCount = result.rows.filter(row => row.rowType === "SUPPLIER_LINE").length;
  const statements = [env.DB.prepare("INSERT INTO supplier_quote_intake_runs (id,project_id,document_id,document_version_id,source_checksum,parser_version,input_fingerprint,status,supplier_name,quotation_reference,issue_date,valid_until,currency,row_count,candidate_count,created_by,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(runId, document.project_id, document.id, document.current_version_id, document.sha256, `${result.parser}:${result.parserVersion}`, fingerprint, "NEEDS REVIEW", result.metadata.supplier, result.metadata.quotationReference, result.metadata.issueDate, result.metadata.validUntil, result.metadata.currency, result.rows.length, candidateCount, userId, now())];
  for (const row of result.rows) statements.push(env.DB.prepare("INSERT INTO supplier_quote_intake_rows (id,intake_run_id,project_id,document_id,document_version_id,row_type,sheet_name,row_number,item_number,supplier_name,quotation_reference,manufacturer,part_number,description,unit,quantity,currency,list_price_minor,unit_price_minor,discount_basis_points,net_price_minor,issue_date,valid_until,raw_values,review_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'Needs Review')").bind(makeId("supplierquoteline"), runId, document.project_id, document.id, document.current_version_id, row.rowType, row.sheet, row.rowNumber, row.itemNumber, row.supplier, row.quotationReference, row.manufacturer, row.partNumber, row.description, row.unit, row.quantity, row.currency, minor(row.listPrice), minor(row.unitPrice), basisPoints(row.discount), minor(row.netUnitPrice), row.issueDate, row.validUntil, JSON.stringify(row.raw)));
  statements.push(env.DB.prepare("INSERT INTO supplier_quote_intake_events (id,project_id,intake_run_id,action,new_value,reason,actor_user_id,request_id) VALUES (?,?,?,?,?,?,?,?)").bind(makeId("supplierquoteevent"), document.project_id, runId, "EXTRACT", JSON.stringify({ rowCount: result.rows.length, candidateCount, parser: result.parser }), "Structured supplier quotation extraction", userId, makeId("request")));
  await env.DB.batch(statements);
  return { run: await env.DB.prepare("SELECT * FROM supplier_quote_intake_runs WHERE id=?").bind(runId).first(), idempotent: false };
};

const lineView = row => {
  const eligibility = supplierPriceEligibility({ rowType: row.row_type, productId: row.product_id, mappingActorId: row.mapped_by, mappingBasis: row.mapping_basis, currency: row.currency, netUnitPrice: row.net_price_minor, unitPrice: row.unit_price_minor, supplier: row.supplier_name, supplierId: row.supplier_id, documentId: row.document_id, documentVersionId: row.document_version_id, issueDate: row.issue_date, validUntil: row.valid_until, reviewStatus: row.review_status, downstreamUse: row.promoted_price_record_id ? "Costing Eligible" : "Discovery Only" });
  return { ...row, raw_values: JSON.parse(row.raw_values || "{}"), eligibility };
};

const listIntake = async (db, projectId) => {
  const runs = await db.prepare("SELECT r.*,d.logical_name,v.original_filename FROM supplier_quote_intake_runs r JOIN documents d ON d.id=r.document_id JOIN document_versions v ON v.id=r.document_version_id WHERE r.project_id=? AND r.superseded_at IS NULL ORDER BY r.created_at DESC").bind(projectId).all();
  const rows = await db.prepare("SELECT q.*,p.part_number AS mapped_part_number,p.description AS mapped_product_description,sq.supplier_id,sq.quote_version FROM supplier_quote_intake_rows q LEFT JOIN canonical_library_products p ON p.requested_product_id=q.product_id LEFT JOIN supplier_quotes sq ON sq.id=q.promoted_supplier_quote_id WHERE q.project_id=? ORDER BY q.created_at DESC,q.sheet_name,q.row_number").bind(projectId).all();
  return { runs: runs.results || [], rows: (rows.results || []).map(lineView) };
};

export const canonicalSupplierProductCandidates = async (db, row) => {
  const products = await db.prepare(`SELECT p.*,m.name AS manufacturer FROM canonical_library_products p JOIN product_manufacturers m ON m.id=p.manufacturer_id WHERE ${CANONICAL_DISCOVERY_PRODUCT_PREDICATE}`).all();
  const links = await db.prepare("SELECT * FROM supplier_products WHERE deleted_at IS NULL").all();
  return exactProductCandidates({ partNumber: row.part_number, manufacturer: row.manufacturer }, products.results || [], links.results || []);
};

const reviewRow = async (request, env, projectId, rowId, action, actor) => {
  const body = await request.json();
  const reason = String(body.reason || "").trim();
  if (reason.length < 3) return json({ error: { code: "REVIEW_REASON_REQUIRED", message: "Provide a review reason." } }, 422);
  const row = await env.DB.prepare("SELECT * FROM supplier_quote_intake_rows WHERE id=? AND project_id=?").bind(rowId, projectId).first();
  if (!row) return json({ error: { code: "SUPPLIER_LINE_NOT_FOUND", message: "Supplier quotation line was not found." } }, 404);
  const stamp = now(); const requestId = request.headers.get("x-request-id") || makeId("request");
  if (action === "map") {
    const productId = String(body.productId || "");
    const available = await canonicalSupplierProductCandidates(env.DB, row);
    const candidate = available.find(entry => entry.productId === productId);
    if (!candidate) return json({ error: { code: "EXACT_MAPPING_REQUIRED", message: "Only an exact canonical model candidate can be mapped in this MVP." } }, 422);
    await env.DB.batch([
      env.DB.prepare("UPDATE supplier_quote_intake_rows SET product_id=?,mapping_basis=?,mapped_by=?,mapped_at=?,review_status='Needs Review',review_reason=? WHERE id=? AND project_id=?").bind(productId, candidate.basis, actor.id, stamp, reason, rowId, projectId),
      env.DB.prepare("INSERT INTO supplier_quote_intake_events (id,project_id,intake_run_id,row_id,action,previous_value,new_value,reason,actor_user_id,request_id) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(makeId("supplierquoteevent"), projectId, row.intake_run_id, rowId, "MAP_PRODUCT", JSON.stringify({ productId: row.product_id, mappingBasis: row.mapping_basis }), JSON.stringify({ productId, mappingBasis: candidate.basis }), reason, actor.id, requestId),
    ]);
  } else if (["reject", "clarify"].includes(action)) {
    const status = action === "reject" ? "Rejected" : "Needs Clarification";
    await env.DB.batch([
      env.DB.prepare("UPDATE supplier_quote_intake_rows SET review_status=?,review_reason=?,reviewed_by=?,reviewed_at=? WHERE id=? AND project_id=?").bind(status, reason, actor.id, stamp, rowId, projectId),
      env.DB.prepare("INSERT INTO supplier_quote_intake_events (id,project_id,intake_run_id,row_id,action,previous_value,new_value,reason,actor_user_id,request_id) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(makeId("supplierquoteevent"), projectId, row.intake_run_id, rowId, action === "reject" ? "REJECT" : "NEEDS_CLARIFICATION", JSON.stringify({ reviewStatus: row.review_status }), JSON.stringify({ reviewStatus: status }), reason, actor.id, requestId),
    ]);
  } else if (action === "approve") return approveSupplierPriceRow(env, { row, projectId, actor, reason, requestId, stamp });
  return json({ intake: await listIntake(env.DB, projectId) });
};

export const approveSupplierPriceRow = async (env, { row, projectId, actor, reason, requestId, stamp = now() }) => {
  if (row.review_status === "Approved" && row.promoted_price_record_id) {
    const existing = await env.DB.prepare("SELECT id,source_id FROM price_records WHERE id=? AND project_id=?").bind(row.promoted_price_record_id, projectId).first();
    if (existing) return json({ approved: true, idempotent: true, sourceId: existing.source_id, priceRecordId: existing.id, supplierQuoteId: row.promoted_supplier_quote_id });
  }
  const sourceLine = { rowType: row.row_type, productId: row.product_id, mappingActorId: row.mapped_by, mappingBasis: row.mapping_basis, currency: row.currency, netUnitPrice: row.net_price_minor, unitPrice: row.unit_price_minor, supplier: row.supplier_name, quotationReference: row.quotation_reference, documentId: row.document_id, documentVersionId: row.document_version_id, issueDate: row.issue_date, validUntil: row.valid_until, reviewStatus: "Approved", downstreamUse: "Costing Eligible" };
  const supplier = row.supplier_name ? await env.DB.prepare("SELECT * FROM suppliers WHERE normalized_name=? AND status!='Rejected'").bind(row.supplier_name.toLowerCase().replace(/[^a-z0-9]/g, "")).first() : null;
  sourceLine.supplierId = supplier?.id;
  const eligibility = supplierPriceEligibility(sourceLine);
  if (!eligibility.eligible) return json({ error: { code: "PRICE_EVIDENCE_INCOMPLETE", message: "This line is not eligible for costing.", blockers: eligibility.blockers } }, 422);
  const run = await env.DB.prepare("SELECT * FROM supplier_quote_intake_runs WHERE id=?").bind(row.intake_run_id).first();
  let source = await env.DB.prepare("SELECT * FROM product_sources WHERE checksum=? AND scope_type='Project' AND project_id=?").bind(run.source_checksum, projectId).first();
  const sourceId = source?.id || `source_${run.id}`; const priceId = `price_${row.id}`;
  const quoteNumber = row.quotation_reference || run.quotation_reference;
  let quote = await env.DB.prepare("SELECT * FROM supplier_quotes WHERE project_id=? AND supplier_id=? AND quote_number=? AND source_document_version_id=? AND deleted_at IS NULL").bind(projectId, supplier.id, quoteNumber, row.document_version_id).first();
  const quoteId = quote?.id || `supplierquote_${run.id}`;
  const nextQuoteVersion = quote ? quote.quote_version : Number((await env.DB.prepare("SELECT COALESCE(MAX(quote_version),0) AS version FROM supplier_quotes WHERE supplier_id=? AND quote_number=?").bind(supplier.id, quoteNumber).first())?.version || 0) + 1;
  const amount = row.net_price_minor ?? row.unit_price_minor;
  const sourceLocation = `${row.sheet_name || "Sheet"}!${row.row_number}`;
  const provenance = { projectId, supplierId: supplier.id, supplier: supplier.name, supplierQuoteId: quoteId, supplierQuoteVersion: nextQuoteVersion, quotationReference: quoteNumber, sourceDocumentId: row.document_id, sourceDocumentVersionId: row.document_version_id, checksum: run.source_checksum, sheet: row.sheet_name, row: row.row_number, itemNumber: row.item_number, rawValues: JSON.parse(row.raw_values || "{}"), mappingBasis: row.mapping_basis, mappingActorId: row.mapped_by, mappingAt: row.mapped_at, approvalActorId: actor.id, approvalAt: stamp, approvalReason: reason, issueDate: row.issue_date, validUntil: row.valid_until };
  const statements = [];
  if (!quote) {
    statements.push(env.DB.prepare("UPDATE supplier_quotes SET superseded_at=? WHERE project_id=? AND supplier_id=? AND quote_number=? AND source_document_version_id<>? AND superseded_at IS NULL").bind(stamp, projectId, supplier.id, quoteNumber, row.document_version_id));
    statements.push(env.DB.prepare("UPDATE product_sources SET validity_state='Superseded',downstream_use='Discovery Only' WHERE project_id=? AND document_version_id IN (SELECT source_document_version_id FROM supplier_quotes WHERE project_id=? AND supplier_id=? AND quote_number=? AND source_document_version_id<>?)").bind(projectId, projectId, supplier.id, quoteNumber, row.document_version_id));
    statements.push(env.DB.prepare("UPDATE price_records SET validity_state='Superseded',downstream_use='Discovery Only' WHERE project_id=? AND source_id IN (SELECT id FROM product_sources WHERE project_id=? AND document_version_id IN (SELECT source_document_version_id FROM supplier_quotes WHERE project_id=? AND supplier_id=? AND quote_number=? AND source_document_version_id<>?))").bind(projectId, projectId, projectId, supplier.id, quoteNumber, row.document_version_id));
  }
  if (!source) statements.push(env.DB.prepare("INSERT OR IGNORE INTO product_sources (id,project_id,document_id,document_version_id,checksum,source_type,authority,scope_type,file_name,release_version,effective_from,valid_until,currency,validity_state,review_status,downstream_use,metadata,created_by) SELECT ?,?,?,?,?, 'Supplier Quote','Supplier','Project',v.original_filename,?,?,?,?,'Current','Approved','Costing Eligible',?,? FROM document_versions v WHERE v.id=?").bind(sourceId, projectId, row.document_id, row.document_version_id, run.source_checksum, quoteNumber, row.issue_date, row.valid_until, row.currency, JSON.stringify(provenance), actor.id, row.document_version_id));
  if (!quote) statements.push(env.DB.prepare("INSERT OR IGNORE INTO supplier_quotes (id,supplier_id,project_id,quote_number,quote_version,quote_date,valid_until,currency,source_document_id,source_document_version_id,review_status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,'Approved',?)").bind(quoteId, supplier.id, projectId, quoteNumber, nextQuoteVersion, row.issue_date, row.valid_until, row.currency, row.document_id, row.document_version_id, actor.id));
  statements.push(env.DB.prepare("INSERT OR IGNORE INTO supplier_quote_lines (id,supplier_quote_id,line_number,product_id,supplier_product_code,manufacturer,part_number,description,quantity,unit_price_minor,discount_basis_points,net_price_minor,currency,source_location,mapping_confidence,review_status,original_values,source_intake_row_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,100,'Approved',?,?)").bind(`supplierquoteline_${row.id}`, quoteId, row.row_number, row.product_id, row.part_number, row.manufacturer, row.part_number, row.description || row.part_number, row.quantity === null ? null : String(row.quantity), row.unit_price_minor, row.discount_basis_points, row.net_price_minor, row.currency, sourceLocation, row.raw_values, row.id));
  statements.push(env.DB.prepare("INSERT OR IGNORE INTO price_records (id,product_id,source_id,supplier_id,project_id,amount_minor,currency,price_type,unit,minimum_quantity,discount_basis_points,effective_from,valid_until,validity_state,approval_status,downstream_use,terms,source_location,reviewed_by,reviewed_at) VALUES (?,?,?,?,?,?,?,'Project Supplier Quote',?,?,?,?,?,'Current','Approved','Costing Eligible',?,?,?,?)").bind(priceId, row.product_id, sourceId, supplier.id, projectId, amount, row.currency, row.unit || "EA", row.quantity ? Math.ceil(row.quantity) : null, row.discount_basis_points, row.issue_date, row.valid_until, JSON.stringify(provenance), sourceLocation, actor.id, stamp));
  statements.push(env.DB.prepare("UPDATE supplier_quote_intake_rows SET review_status='Approved',review_reason=?,reviewed_by=?,reviewed_at=?,promoted_supplier_quote_id=?,promoted_price_record_id=? WHERE id=? AND project_id=? AND promoted_price_record_id IS NULL").bind(reason, actor.id, stamp, quoteId, priceId, row.id, projectId));
  statements.push(env.DB.prepare("INSERT INTO supplier_quote_intake_events (id,project_id,intake_run_id,row_id,action,previous_value,new_value,reason,actor_user_id,request_id) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(makeId("supplierquoteevent"), projectId, row.intake_run_id, row.id, "APPROVE_FOR_COSTING", JSON.stringify({ reviewStatus: row.review_status }), JSON.stringify({ reviewStatus: "Approved", sourceId, priceRecordId: priceId }), reason, actor.id, requestId));
  await env.DB.batch(statements);
  const promoted = await env.DB.prepare("SELECT promoted_supplier_quote_id,promoted_price_record_id FROM supplier_quote_intake_rows WHERE id=?").bind(row.id).first();
  return json({ approved: true, idempotent: false, sourceId, supplierQuoteId: promoted?.promoted_supplier_quote_id, priceRecordId: promoted?.promoted_price_record_id, eligibility });
};

export const handleSupplierPriceIntakeApi = async (request, env) => {
  const url = new URL(request.url); const match = projectPath(url.pathname);
  if (!match) return null;
  if (!env.DB || !env.FILES) return json({ error: { code: "SUPPLIER_PRICE_INTAKE_UNAVAILABLE", message: "Supplier price intake storage is unavailable." } }, 503);
  await requireMigratedTables(env.DB, TABLES);
  const auth = await context(request, env); if (auth.error) return auth.error;
  const projectId = decodeURIComponent(match[1]); const segment = match[2]; const action = match[3];
  if (!await ownedProject(env.DB, projectId, auth.actor.id)) return json({ error: { code: "PROJECT_ACCESS_DENIED", message: "This project is not available to the authenticated application user." } }, 403);
  if (request.method === "GET" && !segment) return json({ intake: await listIntake(env.DB, projectId) });
  if (request.method === "POST" && segment === "extract") {
    const body = await request.json(); const document = await ownedDocument(env.DB, projectId, String(body.documentId || ""), auth.actor.id);
    if (!document) return json({ error: { code: "DOCUMENT_NOT_FOUND", message: "Supplier quotation document was not found." } }, 404);
    try { return json(await executeSupplierQuoteExtraction(env, { documentId: document.id, userId: auth.actor.id }), 202); }
    catch (error) { return json({ error: { code: error.code || "SUPPLIER_QUOTE_EXTRACTION_FAILED", message: error.message } }, 422); }
  }
  if (request.method === "GET" && segment) {
    const row = await env.DB.prepare("SELECT * FROM supplier_quote_intake_rows WHERE id=? AND project_id=?").bind(segment, projectId).first();
    if (!row) return json({ error: { code: "SUPPLIER_LINE_NOT_FOUND", message: "Supplier line was not found." } }, 404);
    return json({ row: lineView(row), candidates: await canonicalSupplierProductCandidates(env.DB, row) });
  }
  if (request.method === "POST" && segment && ["map", "approve", "reject", "clarify"].includes(action)) return reviewRow(request, env, projectId, segment, action, auth.actor);
  return json({ error: { code: "ROUTE_NOT_FOUND", message: "Supplier price intake route was not found." } }, 404);
};
