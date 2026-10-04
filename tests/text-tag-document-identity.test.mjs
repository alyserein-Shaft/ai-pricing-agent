import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { strToU8, zlibSync } from "fflate";

// PHASE 3 -- TEXT-TAG DOCUMENT-IDENTITY VERIFICATION.
//
// This suite is the behavioral proof for the ORIGINAL defect:
// the text-tag pass once skipped a target page whenever
// `definition.sourcePage === page.pageNumber`, conflating T-00 page 1 with
// WLC page 1 because source-document identity did not exist. Phase 2
// introduced sourceDocumentId/targetDocumentId and the sameSourceLocation
// rule (engine line ~167). These tests verify -- at engine level (A-D) and
// through the REAL production dispatcher (E) -- that identity semantics are
// correct, without touching classification quality (a tag that classifies
// nothing on a given page is fine here; whether it SHOULD classify is the
// next phase's question).
import { handleDrawingSymbolRecognitionApi } from "../worker/drawing-symbol-recognition-api.mjs";
import { recognizeDrawingSymbols } from "../app/domain/drawing-symbol-recognition-engine.mjs";

// Same positioned-PDF convention as tests/recognition-legend-context.test.mjs.
const buildPositionedPdf = (fragments, rects = [], mediaBox = [0, 0, 3000, 3000], polygons = []) => {
  const chunks = []; let offset = 0;
  const push = (text) => { const bytes = strToU8(text); chunks.push(bytes); offset += bytes.length; };
  const esc = (value) => value.replace(/[()\\]/g, "\\$&");
  push("%PDF-1.7\n%\xFF\xFF\xFF\xFF\n");
  const objects = [];
  objects.push({ id: 1, offset }); push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objects.push({ id: 2, offset }); push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  objects.push({ id: 3, offset }); push(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [${mediaBox.join(" ")}] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 4 0 R >>\nendobj\n`);
  const text = fragments.map((f) => `BT /F1 12 Tf ${f.x} ${f.y} Td (${esc(f.text)}) Tj ET`).join(" ");
  const shapes = rects.map((r) => `${r.x} ${r.y} ${r.w} ${r.h} re f`).join(" ");
  const polygonOps = polygons.map((points) => `${points[0].x} ${points[0].y} m ${points.slice(1).map((p) => `${p.x} ${p.y} l`).join(" ")} h f`).join(" ");
  const content = `${shapes} ${polygonOps} ${text}`;
  const compressed = zlibSync(strToU8(content));
  objects.push({ id: 4, offset }); push("4 0 obj\n<< /Length " + compressed.length + " /Filter /FlateDecode >>\nstream\n");
  chunks.push(compressed); offset += compressed.length;
  push("\nendstream\nendobj\n");
  const xrefOffset = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const entry of objects) xref += `${String(entry.offset).padStart(10, "0")} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Uint8Array(total); let cursor = 0;
  for (const chunk of chunks) { merged.set(chunk, cursor); cursor += chunk.length; }
  return merged;
};
// A target page carrying only the abbreviation tag "H" -- no SYMBOL/DESCRIPTION
// anchors, so localLegendBands never interferes; the text-tag pass is the only
// thing that can fire.
const targetPagePdf = buildPositionedPdf([{ text: "H", x: 500, y: 500 }]);

const textRow = (overrides = {}) => ({
  id: "row_h",
  source_page: 1,
  abbreviation: "H",
  description: "HEAT DETECTOR",
  symbol_geometry: [], // text-tag-eligible: no geometry signatures
  bounding_box: {},
  structural_confidence: 96,
  ...overrides,
});

// ============================================================
// CASE A -- different document, SAME page number: the original defect.
// T-00 page 1 legend vs WLC page 1 target: must NOT be excluded.
// ============================================================
test("A: source T-00 page 1 vs target WLC page 1 -- text tag is allowed to evaluate the target page", async () => {
  const result = await recognizeDrawingSymbols(new Uint8Array(targetPagePdf), {
    targetDocumentId: "doc_wlc",
    approvedStructuralRows: [textRow({ sourceDocumentId: "doc_t00" })],
  });
  const tags = result.occurrences.filter((o) => o.matchType === "Text Tag");
  assert.equal(tags.length, 1, "cross-document same page number must NOT trigger the same-source exclusion");
  assert.equal(result.definitions[0].sourceDocumentId, "doc_t00");
});

// ============================================================
// CASE B -- same document, same page: exclusion still applies.
// ============================================================
test("B: source T-00 page 1 vs target T-00 page 1 -- same-source-location exclusion still applies", async () => {
  const result = await recognizeDrawingSymbols(new Uint8Array(targetPagePdf), {
    targetDocumentId: "doc_t00",
    approvedStructuralRows: [textRow({ sourceDocumentId: "doc_t00" })],
  });
  assert.equal(result.occurrences.filter((o) => o.matchType === "Text Tag").length, 0, "same document AND same page is still the legend's own page");
});

// ============================================================
// CASE C -- same document, DIFFERENT page: not excluded merely
// because the document identity matches.
// ============================================================
test("C: same document but different page -- the tag on the other page is still evaluated", async () => {
  const result = await recognizeDrawingSymbols(new Uint8Array(targetPagePdf), {
    targetDocumentId: "doc_t00",
    approvedStructuralRows: [textRow({ sourceDocumentId: "doc_t00", source_page: 2 })], // legend lives on page 2 of the same document
  });
  const tags = result.occurrences.filter((o) => o.matchType === "Text Tag");
  assert.equal(tags.length, 1, "document identity alone must never exclude a page; only the SAME page of the SAME document does");
});

// ============================================================
// CASE D -- different document, same page number, identities
// swapped (source=WLC-page document, target=T-00-page document):
// never excluded merely because page numbers match.
// ============================================================
test("D: identities swapped, different documents, same page number -- never excluded", async () => {
  const result = await recognizeDrawingSymbols(new Uint8Array(targetPagePdf), {
    targetDocumentId: "doc_t00",
    approvedStructuralRows: [textRow({ sourceDocumentId: "doc_wlc" })],
  });
  assert.equal(result.occurrences.filter((o) => o.matchType === "Text Tag").length, 1, "the exclusion requires BOTH identities to match -- page numbers alone never suffice");
});

// Legacy composition (no identities at all) keeps the historical
// same-document page comparison byte-for-byte.
test("legacy: absent identities keep the historical page-number skip (no regression to the old defect)", async () => {
  const samePage = await recognizeDrawingSymbols(new Uint8Array(targetPagePdf), { approvedStructuralRows: [textRow()] });
  assert.equal(samePage.occurrences.filter((o) => o.matchType === "Text Tag").length, 0, "legacy callers: page 1 === sourcePage 1 still skips");
  assert.equal(samePage.definitions[0].sourceDocumentId, null, "legacy definitions carry no identity");
  const otherPage = await recognizeDrawingSymbols(new Uint8Array(targetPagePdf), { approvedStructuralRows: [textRow({ source_page: 2 })] });
  assert.equal(otherPage.occurrences.filter((o) => o.matchType === "Text Tag").length, 1, "legacy callers: a different page still evaluates");
});

// ============================================================
// CASE E -- PRODUCTION PATH: the identity values reaching the
// text-tag logic arrive through the real Phase-2 recognition
// route (context establishment -> start -> persist), not only via
// a direct engine fixture.
// ============================================================
const d1 = (sql) => ({
  prepare(text) {
    let values = [];
    return {
      bind(...next) { values = next; return this; },
      first: async () => sql.prepare(text).get(...values) ?? null,
      all: async () => ({ results: sql.prepare(text).all(...values) }),
      run: async () => sql.prepare(text).run(...values),
    };
  },
  batch: async (statements) => { const out = []; for (const s of statements) out.push(await s.run()); return out; },
});
test("E: a production-loaded cross-document text-tag definition classifies the target page through the real route", async () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`
    CREATE TABLE projects(id TEXT PRIMARY KEY, owner_user_id TEXT, organization_id TEXT);
    CREATE TABLE documents(id TEXT PRIMARY KEY, project_id TEXT, logical_name TEXT, current_version_id TEXT, deleted_at TEXT);
    CREATE TABLE document_versions(id TEXT PRIMARY KEY, document_id TEXT, object_key TEXT, sha256 TEXT, extension TEXT, revision TEXT);
    CREATE TABLE drawing_intake_versions(id TEXT PRIMARY KEY, project_id TEXT, document_id TEXT, document_version_id TEXT, version_number INTEGER, status TEXT, superseded_at TEXT);
    CREATE TABLE drawing_recognition_legend_contexts(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, target_document_id TEXT NOT NULL, source_document_id TEXT NOT NULL, source_document_version_id TEXT, approved_geometry_version_id TEXT NOT NULL, reason TEXT NOT NULL, created_by TEXT NOT NULL, superseded_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE drawing_legend_geometry_approved_versions(id TEXT PRIMARY KEY, project_id TEXT, document_id TEXT, source_geometry_version_id TEXT, version_number INTEGER, input_fingerprint TEXT, output_fingerprint TEXT, status TEXT, approved_link_count INTEGER, missing_row_count INTEGER, created_by TEXT, reason TEXT, superseded_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE drawing_legend_geometry_approved_links(id TEXT PRIMARY KEY, approved_geometry_version_id TEXT, approved_row_id TEXT, source_page INTEGER, source_row TEXT, symbol_cell_bbox TEXT, geometry TEXT, geometry_signature TEXT, confidence INTEGER, review_actor_id TEXT, review_reason TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE drawing_structure_approved_rows(id TEXT PRIMARY KEY, approved_version_id TEXT, review_case_id TEXT, source_legend_row_id TEXT, source_page INTEGER, source_row TEXT, symbol_geometry TEXT, abbreviation TEXT, description TEXT, notes TEXT, bounding_box TEXT, structural_confidence INTEGER, review_actor_id TEXT, review_reason TEXT, source_snapshot TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE drawing_symbol_recognition_versions(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, document_id TEXT NOT NULL, document_version_id TEXT NOT NULL, drawing_intake_version_id TEXT NOT NULL, version_number INTEGER NOT NULL, input_fingerprint TEXT NOT NULL, output_fingerprint TEXT NOT NULL, engine_version TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL, source_document_id TEXT, source_legend_geometry_version_id TEXT, superseded_at TEXT, created_by TEXT NOT NULL);
    CREATE TABLE drawing_symbol_definitions(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, recognition_version_id TEXT NOT NULL, definition_key TEXT NOT NULL, abbreviation TEXT, explicit_label TEXT, description TEXT, original_abbreviation TEXT, original_explicit_label TEXT, original_description TEXT, source_page INTEGER NOT NULL, source_document_id TEXT, bounding_box TEXT, shape_signatures TEXT NOT NULL, confidence INTEGER NOT NULL, evidence_text TEXT NOT NULL, extraction_method TEXT NOT NULL, review_status TEXT DEFAULT 'Needs Review' NOT NULL, reviewed_by TEXT, reviewed_at TEXT, review_reason TEXT, merged_into_definition_id TEXT, derived_from_definition_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL);
    CREATE TABLE drawing_symbol_source_geometries(id TEXT PRIMARY KEY, definition_id TEXT NOT NULL, shape_signature TEXT NOT NULL, source_page INTEGER NOT NULL, bounding_box TEXT NOT NULL, geometry TEXT NOT NULL, geometry_fingerprint TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL);
    CREATE TABLE drawing_symbol_occurrences(id TEXT PRIMARY KEY, recognition_version_id TEXT NOT NULL, definition_id TEXT, original_definition_id TEXT, occurrence_key TEXT NOT NULL, page_number INTEGER NOT NULL, bounding_box TEXT NOT NULL, shape_signature TEXT NOT NULL, nearby_text TEXT, match_basis TEXT NOT NULL, confidence INTEGER NOT NULL, review_status TEXT DEFAULT 'Needs Review' NOT NULL, source_geometry TEXT, score_components TEXT, reviewed_by TEXT, reviewed_at TEXT, review_reason TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL);
    CREATE TABLE drawing_symbol_review_events(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, recognition_version_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL, previous_value TEXT, new_value TEXT NOT NULL, reason TEXT NOT NULL, actor_user_id TEXT NOT NULL, request_id TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL);
    INSERT INTO projects VALUES('project_1','local-development-user','organization_bd_shaft_internal_pilot');
    INSERT INTO documents VALUES('doc_wlc','project_1','WLC Schematic','ver_wlc',NULL);
    INSERT INTO document_versions VALUES('ver_wlc','doc_wlc','objects/wlc.pdf','sha_wlc','pdf',NULL);
    INSERT INTO documents VALUES('doc_t00','project_1','T-00 ELV Legends','ver_t00',NULL);
    INSERT INTO document_versions VALUES('ver_t00','doc_t00','objects/t00.pdf','sha_t00','pdf',NULL);
    INSERT INTO drawing_intake_versions VALUES('intake_wlc','project_1','doc_wlc','ver_wlc',1,'Completed',NULL);
    INSERT INTO drawing_intake_versions VALUES('intake_t00','project_1','doc_t00','ver_t00',1,'Completed',NULL);
    -- T-00's governed approved geometry: a TEXT-TAG-ONLY legend row (no
    -- geometry fragments, abbreviation H) -- exactly the definition shape
    -- whose cross-document evaluation the original defect blocked.
    INSERT INTO drawing_legend_geometry_approved_versions VALUES('agv_t00','project_1','doc_t00','gv_t00',1,'fi','fo','Approved',1,0,'local-development-user','fixture',NULL,CURRENT_TIMESTAMP);
    INSERT INTO drawing_structure_approved_rows(id,approved_version_id,source_page,source_row,symbol_geometry,abbreviation,description,bounding_box,structural_confidence) VALUES('row_h','approvedStructure_t00',1,'2','[]','H','HEAT DETECTOR','{}',96);
    INSERT INTO drawing_legend_geometry_approved_links(id,approved_geometry_version_id,approved_row_id,source_page,source_row,symbol_cell_bbox,geometry,geometry_signature,confidence,review_actor_id,review_reason) VALUES('link_h','agv_t00','row_h',1,'2','{}','[]','sig',96,'local-development-user','fixture');
  `);
  const env = {
    DB: d1(sql),
    FILES: { get: async (key) => key === "objects/wlc.pdf" ? { arrayBuffer: async () => targetPagePdf.buffer.slice(targetPagePdf.byteOffset, targetPagePdf.byteOffset + targetPagePdf.byteLength) } : null },
  };
  const post = (path, body) => new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  const established = await handleDrawingSymbolRecognitionApi(post("/api/documents/doc_wlc/symbol-recognition/legend-context", { sourceDocumentId: "doc_t00", reason: "T-00 is the governed legend authority for this WLC sheet." }), env);
  assert.equal(established.status, 201);
  const started = await handleDrawingSymbolRecognitionApi(post("/api/documents/doc_wlc/symbol-recognition/start", { reason: "Recognize the WLC sheet against the governed T-00 legend context." }), env);
  assert.equal(started.status, 201);
  const body = await started.json();

  // The Text Tag classification reached the target page through the real route.
  const tag = body.occurrences.find((o) => String(o.match_basis || "").startsWith("Exact nearby explicit tag"));
  assert.ok(tag, "the cross-document text-tag classification must be produced by the production path");
  assert.equal(tag.page_number, 1, "the classified tag sits on the TARGET page");
  assert.equal(tag.nearby_text, "H");

  // Persisted provenance proves the identities that reached the engine.
  const version = sql.prepare("SELECT * FROM drawing_symbol_recognition_versions WHERE superseded_at IS NULL").get();
  assert.equal(version.document_id, "doc_wlc");
  assert.equal(version.source_document_id, "doc_t00");
  const defRow = sql.prepare("SELECT * FROM drawing_symbol_definitions WHERE abbreviation='H'").get();
  assert.equal(defRow.source_document_id, "doc_t00", "the text-tag definition retains its SOURCE document identity in persistence");
  assert.equal(defRow.source_page, 1, "source page stays distinct from the target page");
  const occRow = sql.prepare("SELECT * FROM drawing_symbol_occurrences").get();
  assert.equal(occRow.page_number, 1, "occurrence target page provenance retained");
  assert.ok(String(occRow.match_basis).startsWith("Exact nearby explicit tag"));
});
