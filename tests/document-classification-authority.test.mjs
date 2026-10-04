import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import {
  executeClassification,
  createManualClassification,
  handleClassificationApi,
} from "../worker/classification-api.mjs";
import { handleDocumentApi } from "../worker/document-api.mjs";
import { handleProductPriceLibraryApi } from "../worker/product-price-library-api.mjs";

// Targeted Document Classification Authority Fix. Covers: upload never
// creates classification authority (item 1/3), createManualClassification's
// current-version bug (item 6), the product library ingestion gate now
// requiring the governed current classification (item 8), and that stale
// documents.document_type cannot route real decisions (item 9), across a
// real in-memory D1-shaped database -- not mocks.
//
// WHY THE CANONICAL FIXTURE INSTEAD OF A HAND-WRITTEN SCHEMA
// ---------------------------------------------------------
// This file used to carry its own `d1` shim and a ~35-table CREATE TABLE
// approximation, opened with `PRAGMA foreign_keys=OFF`. That approximation drifts
// in both directions: it is missing tables the governed paths read (DOC-R3's
// `documents.document_family_id`, `document_versions.effective_from/
// effective_to`, `document_supersessions`), AND it is missing constraints the
// real chain enforces (`classification_model_versions.configuration` is NOT NULL,
// `document_classifications.*` are NOT NULL, FKs from classifications back to
// documents / document_versions / model versions). Turning foreign keys OFF hid
// the second half of that drift rather than fixing it.
//
// Every database below is now `activeChainDatabase()` -- the ACTUAL ordered
// drizzle-active chain read from the migration journal -- wrapped in the shared
// D1-shaped `d1()` adapter (see tests/fixtures/active-chain-fixture.mjs), with FK
// enforcement left ON because the real chain leaves it on
// (drizzle-active/0002_governing_source_fk.sql). Every seed row below therefore
// has to be an honest row against the REAL schema. All INSERTs are by named
// column: a positional INSERT into `document_classifications` is a silent trap
// against a 23-column real table, and is exactly how a hand-written fixture
// drifts. :memory: only; no live data.

const FILES_STUB = { put: async () => {}, get: async () => null, delete: async () => {} };

// `organizations` is a real FK parent of `projects` on the active chain, so it
// is seeded rather than bypassed by disabling foreign keys.
const seedOrganizationAndProject = (raw, { projectName = "Test Project" } = {}) => {
  raw.exec(`
    INSERT INTO organizations (id,name) VALUES ('org1','Organization One');
    INSERT INTO projects (id,name,owner_user_id,organization_id)
      VALUES ('p1','${projectName}','owner1','org1');
  `);
};

const seedProjectAndDocument = (raw, { documentType = "Auto Detection", classificationSource = "Pending Task 4", fileName = "file.pdf", extension = "pdf", mimeType = "application/pdf" } = {}) => {
  raw.exec(`
    INSERT INTO organizations (id,name) VALUES ('org1','Organization One');
    INSERT INTO projects (id,name,owner_user_id,organization_id)
      VALUES ('p1','Test Project','owner1','org1');
    INSERT INTO documents (id,project_id,logical_name,notes,tags,document_type,classification_source,current_version_id,created_by)
      VALUES ('doc1','p1','${fileName}','','[]','${documentType}','${classificationSource}','dv1','owner1');
    INSERT INTO document_versions (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by,quarantine_status)
      VALUES ('dv1','doc1',1,'${fileName}','${fileName}','${extension}','${mimeType}',100,'sha1','key1','owner1','Clear');
  `);
};
// ---------------------------------------------------------------------------
// UPLOAD
// ---------------------------------------------------------------------------

test("UPLOAD: no documentType is sent by the normal upload UI", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const persistStart = page.indexOf("const persistManagedFile = async (");
  const sendEnd = page.indexOf("return new Promise<{", persistStart);
  const sendBlock = page.slice(persistStart, sendEnd);
  assert.doesNotMatch(sendBlock, /form\.set\("documentType"/, "the normal upload flow must never send documentType");
  assert.doesNotMatch(page, /managedTypeForRole/, "the role-to-documentType mapping must be fully removed, not just unused");
});

test("UPLOAD: backend ignores any client-supplied documentType and always creates Auto Detection / Pending Task 4", async () => {
  const raw = activeChainDatabase();
  seedOrganizationAndProject(raw);
  const bytes = new TextEncoder().encode("Item No,Description,Unit,Quantity\n1,Test,No,1");
  const env = {
    DB: d1(raw),
    FILES: FILES_STUB,
    APP_ACCESS_MODE: "single-user",
    APP_USER_ID: "owner1",
    APP_ORGANIZATION_ID: "org1",
  };
  const form = new FormData();
  form.set("file", new File([bytes], "test.csv", { type: "text/csv" }));
  form.set("projectName", "Test Project");
  // Even a caller that DOES try to send documentType (a stale client build,
  // a script, a malicious request) must be ignored -- this is the real
  // defense, not just removing the UI control.
  form.set("documentType", "BOQ");
  const response = await handleDocumentApi(
    new Request("https://app.example/api/projects/p1/documents", { method: "POST", body: form }),
    env,
    { waitUntil() {} },
  );
  assert.equal(response.status, 201, JSON.stringify(await response.json()));
  const document = raw.prepare("SELECT document_type, classification_source FROM documents WHERE project_id='p1'").get();
  assert.equal(document.document_type, "Auto Detection");
  assert.equal(document.classification_source, "Pending Task 4");
  assert.notEqual(document.classification_source, "Manual Override", "upload must never claim Manual Override authority");
});

// ---------------------------------------------------------------------------
// AUTOMATIC CLASSIFICATION
// ---------------------------------------------------------------------------

test("AUTOMATIC CLASSIFICATION: proposal persists and creates zero downstream rows before confirmation", async () => {
  const raw = activeChainDatabase();
  seedProjectAndDocument(raw, { fileName: "file.csv", extension: "csv", mimeType: "text/csv" });
  const csvBytes = new TextEncoder().encode("Item No,Description,Unit,Quantity\n1,Smoke detector,No,20\n2,Panel,No,1\n3,Manual call point,No,15\n4,Sounder,No,10");
  const env = { DB: d1(raw), FILES: { ...FILES_STUB, get: async (key) => (key === "key1" ? { arrayBuffer: async () => csvBytes.buffer } : null) } };
  const { result } = await executeClassification(env, { documentId: "doc1", userId: "owner1", reason: "test" });
  assert.equal(result.primaryType, "BOQ");
  const classification = raw.prepare("SELECT * FROM document_classifications WHERE document_id='doc1' AND superseded_at IS NULL").get();
  assert.ok(classification, "the proposal must be persisted");
  assert.equal(classification.confirmed_by, null, "an automatic proposal is never self-confirming");
  assert.equal(raw.prepare("SELECT COUNT(*) count FROM boq_items").get().count, 0, "no extraction may run before a human confirms");
});

// ---------------------------------------------------------------------------
// CONFIRMATION
// ---------------------------------------------------------------------------

test("CONFIRMATION: confirm updates the canonical current classification and mirrors the confirmed result only", async () => {
  const raw = activeChainDatabase();
  seedProjectAndDocument(raw);
  // Named columns only: the real `document_classifications` has 23 columns and
  // most of them NOT NULL, so a positional INSERT here is a silent trap.
  // `classification_model_versions.configuration` is NOT NULL on the real chain
  // (the old hand-rolled schema let it be NULL), so it carries a real value.
  raw.exec(`
    INSERT INTO classification_model_versions (id,classifier_version,ruleset_version,prompt_version,ai_model_version,configuration)
      VALUES ('model1','v1','v1','v1',NULL,'{}');
    INSERT INTO document_classifications (id,document_id,document_version_id,processing_run_id,model_version_id,primary_type,secondary_types,confidence,confidence_state,status,method,extraction_method,extraction_quality_basis_points,mixed,manual_review_required,downstream_route,error_code,error_message,technical_details,suggested_action,confirmed_by,confirmed_at,classified_at,superseded_at)
      VALUES ('c1','doc1','dv1',NULL,'model1','Drawing','[]',60,'Low Confidence','Needs Review','Hybrid',NULL,NULL,0,1,'Drawing Analysis',NULL,NULL,NULL,NULL,NULL,NULL,'2026-08-01T00:00:00Z',NULL);
  `);
  const env = { DB: d1(raw), FILES: FILES_STUB, APP_ACCESS_MODE: "single-user", APP_USER_ID: "owner1", APP_ORGANIZATION_ID: "org1" };
  const response = await handleClassificationApi(
    new Request("https://app.example/api/documents/doc1/classification/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "Confirmed after visual review of the file" }),
    }),
    env,
    { waitUntil() {} },
  );
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  const classification = raw.prepare("SELECT * FROM document_classifications WHERE document_id='doc1' AND superseded_at IS NULL").get();
  assert.equal(classification.status, "Manually Confirmed");
  assert.notEqual(classification.confirmed_by, null);
  const document = raw.prepare("SELECT document_type, classification_source FROM documents WHERE id='doc1'").get();
  assert.equal(document.document_type, "Drawing");
  assert.equal(document.classification_source, "Manual Confirmation");
});

test("CONFIRMATION: a manual change to a different type updates the canonical current classification", async () => {
  const raw = activeChainDatabase();
  seedProjectAndDocument(raw);
  raw.exec(`
    INSERT INTO classification_model_versions (id,classifier_version,ruleset_version,prompt_version,ai_model_version,configuration)
      VALUES ('model1','v1','v1','v1',NULL,'{}');
    INSERT INTO document_classifications (id,document_id,document_version_id,processing_run_id,model_version_id,primary_type,secondary_types,confidence,confidence_state,status,method,extraction_method,extraction_quality_basis_points,mixed,manual_review_required,downstream_route,error_code,error_message,technical_details,suggested_action,confirmed_by,confirmed_at,classified_at,superseded_at)
      VALUES ('c1','doc1','dv1',NULL,'model1','Drawing','[]',90,'High Confidence','Classified','Hybrid',NULL,NULL,0,0,'Drawing Analysis',NULL,NULL,NULL,NULL,NULL,NULL,'2026-08-01T00:00:00Z',NULL);
  `);
  const env = { DB: d1(raw), FILES: FILES_STUB, APP_ACCESS_MODE: "single-user", APP_USER_ID: "owner1", APP_ORGANIZATION_ID: "org1" };
  const response = await handleClassificationApi(
    new Request("https://app.example/api/documents/doc1/classification/override", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selectedType: "Technical Specification", reason: "This is actually the spec, not a drawing" }),
    }),
    env,
    { waitUntil() {} },
  );
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  const classification = raw.prepare("SELECT * FROM document_classifications WHERE document_id='doc1' AND superseded_at IS NULL").get();
  assert.equal(classification.primary_type, "Technical Specification");
  assert.equal(classification.status, "Manually Confirmed");
  const document = raw.prepare("SELECT document_type FROM documents WHERE id='doc1'").get();
  assert.equal(document.document_type, "Technical Specification");
});

// ---------------------------------------------------------------------------
// VERSIONING -- createManualClassification's current-version bug
// ---------------------------------------------------------------------------

test("VERSIONING: createManualClassification supersedes an existing current classification instead of creating a second current row", async () => {
  const raw = activeChainDatabase();
  seedProjectAndDocument(raw);
  raw.exec(`
    INSERT INTO classification_model_versions (id,classifier_version,ruleset_version,prompt_version,ai_model_version,configuration)
      VALUES ('model1','v1','v1','v1',NULL,'{}');
    INSERT INTO document_classifications (id,document_id,document_version_id,processing_run_id,model_version_id,primary_type,secondary_types,confidence,confidence_state,status,method,extraction_method,extraction_quality_basis_points,mixed,manual_review_required,downstream_route,error_code,error_message,technical_details,suggested_action,confirmed_by,confirmed_at,classified_at,superseded_at)
      VALUES ('v1','doc1','dv1',NULL,'model1','Drawing','[]',55,'Low Confidence','Needs Review','Hybrid',NULL,NULL,0,1,'Drawing Analysis',NULL,NULL,NULL,NULL,NULL,NULL,'2026-08-01T00:00:00Z',NULL);
  `);
  const env = { DB: d1(raw), FILES: FILES_STUB };
  const document = { id: "doc1", version_id: "dv1", project_id: "p1", job_status: "Completed" };
  const user = { id: "owner1" };
  const request = new Request("https://app.example/api/documents/doc1/classification/override", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selectedType: "Technical Specification", reason: "The classifier misread this; it is the spec document" }),
  });
  const response = await createManualClassification(request, env, { waitUntil() {} }, document, user);
  assert.equal(response.status, 200, JSON.stringify(await response.json()));

  const current = raw.prepare("SELECT * FROM document_classifications WHERE document_id='doc1' AND superseded_at IS NULL").all();
  assert.equal(current.length, 1, "exactly one current classification must remain");
  assert.equal(current[0].primary_type, "Technical Specification");
  assert.equal(current[0].status, "Manually Confirmed");
  assert.notEqual(current[0].confirmed_by, null);

  const v1 = raw.prepare("SELECT * FROM document_classifications WHERE id='v1'").get();
  assert.notEqual(v1.superseded_at, null, "the automatic v1 row must be superseded, not orphaned as a second current row");

  const history = raw.prepare("SELECT * FROM document_classifications WHERE document_id='doc1' ORDER BY classified_at").all();
  assert.equal(history.length, 2, "both v1 and v2 must remain queryable in history");

  const override = raw.prepare("SELECT * FROM classification_overrides WHERE document_id='doc1'").get();
  assert.equal(override.previous_type, "Drawing", "previous_type must reflect the real prior classification, not a hardcoded 'Unknown'");

  const audit = raw.prepare("SELECT * FROM document_audit_events WHERE document_id='doc1' AND action='Manual Classification Recovery'").get();
  assert.equal(JSON.parse(audit.old_value).primaryType, "Drawing", "old_value must reflect the real previous classification, not a hardcoded 'Unknown'");
});

test("VERSIONING: createManualClassification still works correctly with no prior classification at all (the genuine recovery case)", async () => {
  const raw = activeChainDatabase();
  seedProjectAndDocument(raw);
  const env = { DB: d1(raw), FILES: FILES_STUB };
  const document = { id: "doc1", version_id: "dv1", project_id: "p1", job_status: "Failed" };
  const user = { id: "owner1" };
  const request = new Request("https://app.example/api/documents/doc1/classification/override", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selectedType: "BOQ", reason: "Automatic classification failed; this is visibly a BOQ" }),
  });
  const response = await createManualClassification(request, env, { waitUntil() {} }, document, user);
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  const current = raw.prepare("SELECT * FROM document_classifications WHERE document_id='doc1' AND superseded_at IS NULL").all();
  assert.equal(current.length, 1);
  const override = raw.prepare("SELECT * FROM classification_overrides WHERE document_id='doc1'").get();
  assert.equal(override.previous_type, "Unknown", "with no prior classification, previous_type correctly falls back to Unknown");
});

// ---------------------------------------------------------------------------
// STALE MIRROR SAFETY / PRODUCT LIBRARY (item 8)
// ---------------------------------------------------------------------------

test("PRODUCT LIBRARY SAFETY: an unconfirmed Price List proposal cannot bypass the ingestion gate", async () => {
  const raw = activeChainDatabase();
  // Stale-mirror scenario: the mirror says Price List, but the current
  // governed classification is only a proposal (not confirmed).
  seedProjectAndDocument(raw, { documentType: "Price List", classificationSource: "Automatic Classifier" });
  raw.exec(`
    INSERT INTO classification_model_versions (id,classifier_version,ruleset_version,prompt_version,ai_model_version,configuration)
      VALUES ('model1','v1','v1','v1',NULL,'{}');
    INSERT INTO document_classifications (id,document_id,document_version_id,processing_run_id,model_version_id,primary_type,secondary_types,confidence,confidence_state,status,method,extraction_method,extraction_quality_basis_points,mixed,manual_review_required,downstream_route,error_code,error_message,technical_details,suggested_action,confirmed_by,confirmed_at,classified_at,superseded_at)
      VALUES ('c1','doc1','dv1',NULL,'model1','Price List','[]',85,'High Confidence','Classified','Hybrid',NULL,NULL,0,0,'Product Library Ingestion',NULL,NULL,NULL,NULL,NULL,NULL,'2026-08-01T00:00:00Z',NULL);
  `);
  const env = { DB: d1(raw), FILES: FILES_STUB, APP_ACCESS_MODE: "single-user", APP_USER_ID: "owner1", APP_ORGANIZATION_ID: "org1" };
  const response = await handleProductPriceLibraryApi(
    new Request("https://app.example/api/library/document-versions/dv1/ingest", { method: "POST" }),
    env,
  );
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error.code, "SOURCE_CLASSIFICATION_REQUIRED");
});

test("PRODUCT LIBRARY SAFETY: a stale document_type mirror disagreeing with the current classification cannot bypass the gate", async () => {
  const raw = activeChainDatabase();
  // The mirror says Price List (stale/left over), but the CURRENT governed
  // classification is now something else entirely (confirmed as Drawing).
  seedProjectAndDocument(raw, { documentType: "Price List", classificationSource: "Manual Confirmation" });
  raw.exec(`
    INSERT INTO classification_model_versions (id,classifier_version,ruleset_version,prompt_version,ai_model_version,configuration)
      VALUES ('model1','v1','v1','v1',NULL,'{}');
    INSERT INTO document_classifications (id,document_id,document_version_id,processing_run_id,model_version_id,primary_type,secondary_types,confidence,confidence_state,status,method,extraction_method,extraction_quality_basis_points,mixed,manual_review_required,downstream_route,error_code,error_message,technical_details,suggested_action,confirmed_by,confirmed_at,classified_at,superseded_at)
      VALUES ('c1','doc1','dv1',NULL,'model1','Drawing','[]',0,'Human Confirmed','Manually Confirmed','Manual Confirmation',NULL,NULL,0,0,'Drawing Analysis','owner1','2026-08-01T00:00:00Z',NULL,NULL,'owner1','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z',NULL);
  `);
  const env = { DB: d1(raw), FILES: FILES_STUB, APP_ACCESS_MODE: "single-user", APP_USER_ID: "owner1", APP_ORGANIZATION_ID: "org1" };
  const response = await handleProductPriceLibraryApi(
    new Request("https://app.example/api/library/document-versions/dv1/ingest", { method: "POST" }),
    env,
  );
  const body = await response.json();
  assert.equal(response.status, 409, "the stale Price List mirror must not authorize ingestion once the real current classification is Drawing");
  assert.equal(body.error.code, "SOURCE_CLASSIFICATION_REQUIRED");
});

test("PRODUCT LIBRARY SAFETY: human confirmation of Price List allows ingestion to proceed past the classification gate", async () => {
  const raw = activeChainDatabase();
  seedProjectAndDocument(raw, { documentType: "Price List", classificationSource: "Manual Confirmation" });
  raw.exec(`
    INSERT INTO classification_model_versions (id,classifier_version,ruleset_version,prompt_version,ai_model_version,configuration)
      VALUES ('model1','v1','v1','v1',NULL,'{}');
    INSERT INTO document_classifications (id,document_id,document_version_id,processing_run_id,model_version_id,primary_type,secondary_types,confidence,confidence_state,status,method,extraction_method,extraction_quality_basis_points,mixed,manual_review_required,downstream_route,error_code,error_message,technical_details,suggested_action,confirmed_by,confirmed_at,classified_at,superseded_at)
      VALUES ('c1','doc1','dv1',NULL,'model1','Price List','[]',0,'Human Confirmed','Manually Confirmed','Manual Confirmation',NULL,NULL,0,0,'Product Library Ingestion','owner1','2026-08-01T00:00:00Z',NULL,NULL,'owner1','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z',NULL);
  `);
  // FILES.get returns null -- proves the request got PAST the classification
  // gate (a different, later error) rather than being blocked by it.
  const env = { DB: d1(raw), FILES: FILES_STUB, APP_ACCESS_MODE: "single-user", APP_USER_ID: "owner1", APP_ORGANIZATION_ID: "org1" };
  const response = await handleProductPriceLibraryApi(
    new Request("https://app.example/api/library/document-versions/dv1/ingest", { method: "POST" }),
    env,
  );
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error.code, "SOURCE_OBJECT_MISSING", "a confirmed Price List classification must clear the classification gate entirely");
});

// ---------------------------------------------------------------------------
// STALE MIRROR SAFETY / EXTRACTION ROUTING (item 9) -- source-level proof
// that BOQ, Technical Specification, Supplier Quotation and Project Context
// extraction all gate on the governed document_classifications join, never
// on documents.document_type.
// DOC-R1A.3: all governed-role consumers now use normalizeDocumentType()
// for canonical interpretation instead of raw literal matching.
// ---------------------------------------------------------------------------

test("STALE MIRROR SAFETY: BOQ extraction eligibility never reads documents.document_type", async () => {
  const source = await readFile(new URL("../worker/boq-extraction-api.mjs", import.meta.url), "utf8");
  const fn = source.slice(source.indexOf("const extractionEligibility"), source.indexOf("const updateJob"));
  assert.doesNotMatch(fn, /document\.document_type/);
  assert.match(fn, /normalizeDocumentType\(document\.primary_type\) === "BOQ" && document\.classification_status === "Manually Confirmed"/);
});

test("STALE MIRROR SAFETY: Technical Specification extraction eligibility never reads documents.document_type", async () => {
  const source = await readFile(new URL("../worker/specification-extraction-background.mjs", import.meta.url), "utf8");
  assert.match(source, /normalizeDocumentType\(document\.primary_type\) !== "Technical Specification" \|\| document\.classification_status !== "Manually Confirmed"/);
});

test("STALE MIRROR SAFETY: Supplier Quotation extraction eligibility never reads documents.document_type", async () => {
  const source = await readFile(new URL("../worker/supplier-price-intake-api.mjs", import.meta.url), "utf8");
  const fn = source.slice(source.indexOf("const supplierQuoteClassificationEligible"), source.indexOf("export const executeSupplierQuoteExtraction"));
  assert.doesNotMatch(fn, /document\.document_type/);
  assert.match(fn, /classification\.status === "Manually Confirmed"/);
  assert.match(fn, /normalizeDocumentType\(classification\.primary_type\) === "Supplier Quotation"/);
});

test("STALE MIRROR SAFETY: Project Context extraction eligibility never reads documents.document_type", async () => {
  const source = await readFile(new URL("../worker/project-context-api.mjs", import.meta.url), "utf8");
  assert.match(source, /normalizeDocumentType\(classification\.primary_type\) !== "Project Context" \|\|[\s\S]{0,30}classification\.status !== "Manually Confirmed"/);
});

// ---------------------------------------------------------------------------
// VERSIONING -- consolidated authority helper
// ---------------------------------------------------------------------------

test("all extraction routes and the listing/ingestion readers share one current-classification helper, not repeated copies", async () => {
  const files = [
    "worker/classification-api.mjs",
    "worker/boq-extraction-api.mjs",
    "worker/specification-extraction-api.mjs",
    "worker/specification-extraction-background.mjs",
    "worker/supplier-price-intake-api.mjs",
    "worker/project-context-api.mjs",
    "worker/document-api.mjs",
    "worker/product-price-library-api.mjs",
  ];
  for (const path of files) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(source, /document-classification-authority\.mjs/, `${path} should import the shared classification-authority helper`);
  }
});

// ---------------------------------------------------------------------------
// UI (item 10)
// ---------------------------------------------------------------------------

test("UI: the upload/intake step has no document-type picker", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const gridStart = page.indexOf('<div className="upload-intent-grid">');
  const gridEnd = page.indexOf("{backupPreview &&", gridStart);
  const grid = page.slice(gridStart, gridEnd);
  // The intake grid registers a role (which review queue this lands in,
  // explicitly framed as "Registration is not approval") -- it must never
  // present itself as choosing the document's classification.
  assert.doesNotMatch(grid, /<select/, "no dropdown type picker in the intake step");
  assert.match(page, /Registration is not approval/);
});

test("UI: one governed current type is shown per document -- the mirror is only a fallback for the governed predicted_type, never shown alongside it", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  // Both the type badge and the type line prefer the governed field
  // (predicted_type, sourced from document_classifications) and only fall
  // back to the documents.document_type mirror when no classification has
  // run yet -- never rendered as two separate, potentially-disagreeing
  // "current" values on the same row.
  assert.match(page, /document\.predicted_type \|\|\s*\n\s*document\.document_type \|\|\s*\n\s*"FILE"/);
  assert.match(page, /\{document\.predicted_type \|\| document\.document_type\} · v/);
});

test("UI: normal document list does not expose raw classification_source enum values or internal mirror terminology", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const documentsWorkspaceSource = page.slice(page.indexOf("<DocumentsWorkspace"), page.indexOf("</DocumentsWorkspace>"));
  for (const rawEnum of ["Pending Task 4", "Manual Override", "Manual Confirmation", "Automatic Classifier"]) {
    assert.doesNotMatch(documentsWorkspaceSource, new RegExp(rawEnum.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `"${rawEnum}" is an internal classification_source enum value and must not be shown to the user`);
  }
});

test("UI: documentClassificationPresentation is the single governed confirmed/needs-confirmation rule, and the price library gate now matches it exactly", async () => {
  const presentation = await readFile(new URL("../app/lib/document-status-presentation.mjs", import.meta.url), "utf8");
  assert.match(presentation, /humanConfirmedClassificationStatuses = new Set\(\["Manually Confirmed"\]\)/);
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /isPriceLibraryClassificationConfirmed = \(document: ManagedDocument\) =>\s*\n\s*document\.classification_status === "Manually Confirmed";/);
});

// ---------------------------------------------------------------------------
// REGRESSION
// ---------------------------------------------------------------------------

test("REGRESSION: the manual confirm/override flow still requires a substantive reason for high-confidence overrides", async () => {
  const source = await readFile(new URL("../worker/classification-api.mjs", import.meta.url), "utf8");
  assert.match(source, /mode === "override" && \["High Confidence", "Verified"\]\.includes\(classification\.confidence_state\) && reason\.length < MIN_GOVERNED_REASON_LENGTH/);
});

test("REGRESSION: classification evidence/candidates/history remain intact and queryable", async () => {
  const source = await readFile(new URL("../worker/classification-api.mjs", import.meta.url), "utf8");
  assert.match(source, /SELECT c\.\*, m\.classifier_version, m\.ruleset_version, m\.prompt_version, m\.ai_model_version FROM document_classifications c JOIN classification_model_versions m ON m\.id=c\.model_version_id WHERE c\.document_id=\? ORDER BY c\.classified_at DESC/);
  assert.match(source, /SELECT \* FROM classification_overrides WHERE document_id=\? ORDER BY overridden_at DESC/);
});

test("REGRESSION: classification confirm/override with explicit startExtraction still reaches governed downstream extraction, unaffected by the upload-authority fix", async () => {
  const source = await readFile(new URL("../worker/classification-api.mjs", import.meta.url), "utf8");
  const confirmBlock = source.slice(source.indexOf("const confirmOrOverride"), source.indexOf("const classifySegment"));
  assert.match(confirmBlock, /normalizeDocumentType\(selectedType\)/);
  assert.match(confirmBlock, /body\.startExtraction === true/);
  assert.match(source, /executeConfirmedDownstreamExtraction/);
});
