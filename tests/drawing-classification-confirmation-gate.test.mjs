import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { strToU8, zlibSync } from "fflate";
import { handleDrawingIntakeApi } from "../worker/drawing-intake-api.mjs";

// Drawing Classification Confirmation Gate (2026-09-17). Root cause: every
// other content-dependent processor (BOQ, Technical Specification, Project
// Context, Supplier Quote) already required the CURRENT governed
// classification to be primary_type-matched AND status='Manually Confirmed'
// before starting -- Drawing intake checked only file extension and content
// readability, never classification confirmation at all. A direct API call
// could therefore start Drawing Analysis on a document still sitting at
// "Detected: Drawing - Needs confirmation", even though the Documents UI
// correctly hid the button for that exact state. AI detected != human
// confirmed != downstream authorized -- Drawing now follows the identical
// rule the other four routes already enforce.

// Builds a real, valid, single-page, FlateDecode-compressed PDF -- copied
// from tests/drawing-intake-engine.test.mjs's buildDrawingPdf (not
// exported there) so the "allowed" path exercises the real
// extractDrawingStructure engine end to end, not a mock.
const buildDrawingPdf = (lines) => {
  const chunks = []; let offset = 0;
  const push = (piece) => { const bytes = strToU8(piece); chunks.push(bytes); offset += bytes.length; };
  push("%PDF-1.7\n%\xFF\xFF\xFF\xFF\n");
  const objects = [];
  objects.push({ id: 1, offset }); push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objects.push({ id: 2, offset }); push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  objects.push({ id: 3, offset }); push("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 3000 792] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 4 0 R >>\nendobj\n");
  const esc = (value) => value.replace(/[()\\]/g, "\\$&");
  const content = lines.map((line, index) => {
    const y = 190 - index * 14;
    return `BT /F1 10 Tf 20 ${y} Td (${esc(line)}) Tj ET`;
  }).join(" ");
  const compressed = zlibSync(strToU8(content));
  objects.push({ id: 4, offset }); push(`4 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`);
  chunks.push(compressed); offset += compressed.length;
  push("\nendstream\nendobj\n");
  const xrefOffset = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const entry of objects) xref += `${String(entry.offset).padStart(10, "0")} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total); let cursor = 0;
  for (const chunk of chunks) { merged.set(chunk, cursor); cursor += chunk.length; }
  return merged;
};

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (args = []) => ({
      first: async () => raw.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
      run: async () => raw.prepare(sql).run(...args),
    });
    return { ...operation(), bind: (...args) => operation(args) };
  },
  async batch(statements) {
    raw.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      raw.exec("COMMIT");
      return results;
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  },
});

const schema = `
PRAGMA foreign_keys=OFF;
CREATE TABLE projects(id TEXT PRIMARY KEY, owner_user_id TEXT, organization_id TEXT, name TEXT, archived_at TEXT);
CREATE TABLE documents(id TEXT PRIMARY KEY, project_id TEXT, document_type TEXT, classification_source TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
CREATE TABLE document_versions(id TEXT PRIMARY KEY, document_id TEXT, version_number INTEGER, original_filename TEXT, extension TEXT, sha256 TEXT, object_key TEXT, revision TEXT);
CREATE TABLE document_classifications(id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, primary_type TEXT, status TEXT, manual_review_required INTEGER, error_code TEXT, superseded_at TEXT, classified_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE drawing_intake_versions(id TEXT PRIMARY KEY, project_id TEXT, document_id TEXT, document_version_id TEXT, version_number INTEGER, input_fingerprint TEXT, output_fingerprint TEXT, parser_version TEXT, status TEXT, summary TEXT, review_status TEXT DEFAULT 'Needs Review', superseded_at TEXT, created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE drawing_document_classifications(id TEXT PRIMARY KEY, intake_version_id TEXT, classification_type TEXT, confidence INTEGER, extraction_method TEXT, review_status TEXT DEFAULT 'Needs Review', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE drawing_pages(id TEXT PRIMARY KEY, intake_version_id TEXT, page_number INTEGER, width REAL, height REAL, rotation INTEGER DEFAULT 0, coordinate_mode TEXT, classifications TEXT, text_count INTEGER, source_review_status TEXT, review_status TEXT DEFAULT 'Needs Review', extraction_method TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE drawing_metadata(id TEXT PRIMARY KEY, intake_version_id TEXT, drawing_number TEXT, revision TEXT, sheet_name TEXT, discipline TEXT, scale TEXT, issue_date TEXT, consultant TEXT, contractor TEXT, client TEXT, project_name TEXT, sheet_size TEXT, confidence INTEGER, extraction_method TEXT, review_status TEXT DEFAULT 'Needs Review', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE drawing_assets(id TEXT PRIMARY KEY, intake_version_id TEXT, page_id TEXT, asset_type TEXT, text_content TEXT, bounding_box TEXT, coordinates_available INTEGER, detection_confidence INTEGER, detection_method TEXT, review_status TEXT DEFAULT 'Needs Review', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE drawing_legends(id TEXT PRIMARY KEY, intake_version_id TEXT, page_id TEXT, legend_version TEXT, confidence INTEGER, detection_method TEXT, review_status TEXT DEFAULT 'Needs Review', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE drawing_legend_entries(id TEXT PRIMARY KEY, legend_id TEXT, sequence INTEGER, entry_type TEXT, label TEXT, description TEXT, confidence INTEGER, review_status TEXT DEFAULT 'Needs Review', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE drawing_search_entries(id TEXT PRIMARY KEY, intake_version_id TEXT, page_id TEXT, page_number INTEGER, text_content TEXT, drawing_number TEXT, sheet_name TEXT, tags TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE drawing_intake_audit_events(id TEXT PRIMARY KEY, project_id TEXT, document_id TEXT, intake_version_id TEXT, action TEXT, previous_value TEXT, new_value TEXT, reason TEXT, actor_user_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`;

const PDF_BYTES = buildDrawingPdf(["FIRE ALARM SYSTEM", "GROUND FLOOR PLAN"]);

const seedFixture = ({ primaryType = "Drawing", status = "Manually Confirmed", errorCode = null } = {}) => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  raw.exec(`
    INSERT INTO projects VALUES ('p1','owner1','org1','TesT',NULL);
    INSERT INTO documents VALUES ('doc1','p1','Drawing','Manual/Unclassified','dv1',NULL,NULL);
    INSERT INTO document_versions VALUES ('dv1','doc1',1,'YALJ-R-002-R00.pdf','pdf','sha1','obj1',NULL);
  `);
  raw.prepare(
    "INSERT INTO document_classifications VALUES ('c1','doc1','dv1',?,?,0,?,NULL,'2026-09-01T10:00:00Z')",
  ).run(primaryType, status, errorCode);
  return {
    raw,
    env: {
      DB: d1(raw),
      FILES: {
        // Real object storage returns a fresh readable body on every .get()
        // -- return a fresh copy of the bytes each call so consuming the
        // ArrayBuffer once (as extractDrawingStructure does) never detaches
        // it for a later call in the same test.
        get: async (key) => (key === "obj1" ? { arrayBuffer: async () => PDF_BYTES.slice().buffer } : null),
      },
      APP_ACCESS_MODE: "single-user",
      APP_USER_ID: "owner1",
      APP_ORGANIZATION_ID: "org1",
    },
  };
};

const request = (documentId, op) =>
  new Request(`https://app.example/api/documents/${documentId}/drawing-intake/${op}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: "Test drawing analysis start" }),
  });

test("1. readable + Manually Confirmed Drawing -> analysis allowed", async () => {
  const { raw, env } = seedFixture({ primaryType: "Drawing", status: "Manually Confirmed" });
  const response = await handleDrawingIntakeApi(request("doc1", "start"), env);
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(raw.prepare("SELECT COUNT(*) count FROM drawing_intake_versions").get().count, 1);
});

test("2. readable + Drawing proposal only (Needs Review, not confirmed) -> blocked with DRAWING_CLASSIFICATION_CONFIRMATION_REQUIRED", async () => {
  const { raw, env } = seedFixture({ primaryType: "Drawing", status: "Needs Review" });
  const response = await handleDrawingIntakeApi(request("doc1", "start"), env);
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, "DRAWING_CLASSIFICATION_CONFIRMATION_REQUIRED");
  assert.equal(body.error.message, "Confirm this document as a Drawing before starting drawing analysis.");
  assert.equal(body.error.suggestedAction, "Review and confirm the document classification first.");
  assert.equal(raw.prepare("SELECT COUNT(*) count FROM drawing_intake_versions").get().count, 0);
});

test("3. readable + confirmed as another type (e.g. BOQ) -> blocked with the same governance error", async () => {
  const { raw, env } = seedFixture({ primaryType: "BOQ", status: "Manually Confirmed" });
  const response = await handleDrawingIntakeApi(request("doc1", "start"), env);
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, "DRAWING_CLASSIFICATION_CONFIRMATION_REQUIRED");
  assert.equal(raw.prepare("SELECT COUNT(*) count FROM drawing_intake_versions").get().count, 0);
});

test("4. unreadable + Manually Confirmed Drawing -> DOCUMENT_CONTENT_UNREADABLE (not the classification error), and still creates no rows", async () => {
  const { raw, env } = seedFixture({ primaryType: "Drawing", status: "Manually Confirmed", errorCode: "UNREADABLE_CONTENT" });
  const response = await handleDrawingIntakeApi(request("doc1", "start"), env);
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, "DOCUMENT_CONTENT_UNREADABLE");
  assert.notEqual(body.error.code, "DRAWING_CLASSIFICATION_CONFIRMATION_REQUIRED", "classification IS confirmed here -- the readability gate, not the classification gate, is what must fire");
  assert.equal(raw.prepare("SELECT COUNT(*) count FROM drawing_intake_versions").get().count, 0);
});

test("5. start and rerun both enforce the identical classification gate", async () => {
  const { env: envUnconfirmed } = seedFixture({ primaryType: "Drawing", status: "Needs Review" });
  for (const op of ["start", "rerun"]) {
    const response = await handleDrawingIntakeApi(request("doc1", op), envUnconfirmed);
    const body = await response.json();
    assert.equal(response.status, 422, `${op} must be blocked`);
    assert.equal(body.error.code, "DRAWING_CLASSIFICATION_CONFIRMATION_REQUIRED", `${op} must use the same error contract`);
  }
});

test("6. no drawing processing rows/evidence are created on any blocked request", async () => {
  for (const fixtureArgs of [
    { primaryType: "Drawing", status: "Needs Review" },
    { primaryType: "BOQ", status: "Manually Confirmed" },
    { primaryType: "Drawing", status: "Manually Confirmed", errorCode: "UNREADABLE_CONTENT" },
  ]) {
    const { raw, env } = seedFixture(fixtureArgs);
    await handleDrawingIntakeApi(request("doc1", "start"), env);
    for (const table of ["drawing_intake_versions", "drawing_pages", "drawing_metadata", "drawing_assets", "drawing_intake_audit_events"]) {
      assert.equal(raw.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count, 0, `${table} must stay empty for ${JSON.stringify(fixtureArgs)}`);
    }
  }
});

test("7. current live R002/R003 behavior remains valid once confirmed (Detected -> Manually Confirmed -> allowed)", async () => {
  // Reproduces the exact live shape: R002/R003 start as "Detected: Drawing
  // - Needs confirmation" (blocked), and once an estimator manually
  // confirms them, analysis becomes allowed -- the classification itself
  // is never touched by this gate, only read.
  const { raw, env } = seedFixture({ primaryType: "Drawing", status: "Needs Review" });
  const blocked = await handleDrawingIntakeApi(request("doc1", "start"), env);
  assert.equal(blocked.status, 422);
  assert.equal((await blocked.json()).error.code, "DRAWING_CLASSIFICATION_CONFIRMATION_REQUIRED");

  raw.prepare("UPDATE document_classifications SET status='Manually Confirmed' WHERE id='c1'").run();
  const allowed = await handleDrawingIntakeApi(request("doc1", "start"), env);
  const body = await allowed.json();
  assert.equal(allowed.status, 201, JSON.stringify(body));
  assert.equal(raw.prepare("SELECT COUNT(*) count FROM drawing_intake_versions").get().count, 1);
});
