import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { strToU8, zlibSync } from "fflate";

// Phase 4D RED: approved-link geometry captured by the Phase-4C recovery is
// raw pdfjs path fragments ({operators, coordinates, sourceBounds, transform,
// fill, stroke, boundingBox}) with NO per-fragment signature fields. The
// recognition engine assumes parser-shaped items (shapeSignature/signature,
// rawGeometry/geometry) and the persistence layer binds
// geometry.shapeSignature directly -- undefined crashes real D1 (422
// SYMBOL_RECOGNITION_FAILED: D1_TYPE_ERROR, measured on the Clean Golden WLC
// production start). These tests reproduce the failure with generalized
// fixtures (no benchmark classes, no benchmark coordinates).
//
// Two documented design semantics are PINNED, not changed:
//  - fragments with trivial coordinate streams stay excluded from acting as
//    EXACT-match anchors (generic-primitive guard); such definitions use the
//    text fallback while remaining Approximate-eligible;
//  - structurally distinctive fragments must hash identically to the same
//    shape on a target page (representation parity for Exact).
import { handleDrawingSymbolRecognitionApi } from "../worker/drawing-symbol-recognition-api.mjs";
import { recognizeDrawingSymbols } from "../app/domain/drawing-symbol-recognition-engine.mjs";
import { captureLegendGeometry } from "../app/domain/drawing-legend-geometry-engine.mjs";

const buildPositionedPdf = (fragments, rects = [], polygons = [], prefix = "") => {
  const chunks = [];
  let offset = 0;
  const push = (text) => { const bytes = strToU8(text); chunks.push(bytes); offset += bytes.length; };
  const esc = (value) => value.replace(/[()\\]/g, "\\$&");
  push("%PDF-1.7\n%\xFF\xFF\xFF\xFF\n");
  const objects = [];
  objects.push({ id: 1, offset }); push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objects.push({ id: 2, offset }); push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  objects.push({ id: 3, offset }); push("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 3000 1000] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 4 0 R >>\nendobj\n");
  const text = fragments.map((fragment) => `BT /F1 12 Tf ${fragment.x} ${fragment.y} Td (${esc(fragment.text)}) Tj ET`).join(" ");
  const shapes = rects.map((rect) => `${rect.x} ${rect.y} ${rect.w} ${rect.h} re f`).join(" ");
  const polygonOps = polygons.map((points) => `${points[0].x} ${points[0].y} m ${points.slice(1).map((p) => `${p.x} ${p.y} l`).join(" ")} h f`).join(" ");
  const content = `${prefix} ${shapes} ${polygonOps} ${text}`;
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
  const merged = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) { merged.set(chunk, cursor); cursor += chunk.length; }
  return merged;
};
const pentagon = (cx, cy, r) => [0, 1, 2, 3, 4].map((i) => { const angle = -Math.PI / 2 + i * (2 * Math.PI / 5); return { x: Math.round((cx + r * Math.cos(angle)) * 100) / 100, y: Math.round((cy + r * Math.sin(angle)) * 100) / 100 }; });

// Governed non-empty symbol cell row for theCode "QQ".
const codeBox = { x: 100, y: 450, width: 10, height: 5 };
const legendRow = {
  id: "row_qq",
  source_page: 1,
  source_row: "7",
  symbol_geometry: [],
  bounding_box: { x: codeBox.x, y: codeBox.y - 6, width: codeBox.width + 2, height: 90 },
  abbreviation: "QQ",
  description: "QUALIFICATION QUOTA",
  source_snapshot: {
    cells: [
      { id: "qq-sym", column_number: 1, bounding_box: { ...codeBox }, raw_content: "QQ", reconstructed_content: "QQ", original_fragments: [{ id: "qq-frag", text: "QQ", boundingBox: { ...codeBox } }] },
      { id: "qq-desc", column_number: 2, bounding_box: { x: codeBox.x, y: codeBox.y + 80, width: codeBox.width, height: 50 }, raw_content: "QUALIFICATION QUOTA", reconstructed_content: "QUALIFICATION QUOTA", original_fragments: [] },
    ],
  },
};

// FIXTURE A -- trivial fragments (small rects): the generic-primitive guard
// legitimately keeps them out of Exact anchoring. The contract under test is
// persistence-safety (no undefined bindings) with the text fallback intact.
const legendPdfA = buildPositionedPdf(
  [{ text: "QQ", x: 100, y: 450 }, { text: "QUALIFICATION QUOTA", x: 100, y: 530 }],
  [
    { x: 98.5, y: 448, w: 1.8, h: 1.8 },
    { x: 111, y: 452, w: 1.5, h: 2.2 },
    { x: 104, y: 454.5, w: 2.2, h: 1.2 },
  ],
);
const targetPdfA = buildPositionedPdf([{ text: "QQ", x: 900, y: 450 }]);

// FIXTURE B -- distinctive fragments (two pentagons): structurally rich
// enough to anchor Exact matching; the same icon displaced on the target
// page must hash identically through the normalized representation.
const legendPdfB = buildPositionedPdf(
  [{ text: "QQ", x: 100, y: 450 }, { text: "QUALIFICATION QUOTA", x: 100, y: 530 }],
  [],
  [pentagon(104, 452, 4), pentagon(112, 452, 4)],
);
const targetPdfB = buildPositionedPdf(
  [{ text: "QQ", x: 900, y: 450 }],
  [],
  [pentagon(904, 452, 4), pentagon(912, 452, 4)],
);

const capturedA = await captureLegendGeometry(new Uint8Array(legendPdfA), [legendRow]);
assert.equal(capturedA.missing.length, 0, "fixture A legend must capture");
const linkGeometryA = capturedA.candidates[0].geometry;
assert.ok(linkGeometryA.length >= 2, "fixture A must be multi-fragment");
assert.ok(linkGeometryA.every((f) => !("shapeSignature" in f) && !("signature" in f)), "fixture A must reproduce the signature-less capture representation");

const legendPdfC = buildPositionedPdf(
  [{ text: "QQ", x: 100, y: 450 }, { text: "QUALIFICATION QUOTA", x: 100, y: 530 }],
  [],
  [pentagon(104, 452, 4), pentagon(112, 452, 4), pentagon(108, 456, 4)],
);
const capturedC = await captureLegendGeometry(new Uint8Array(legendPdfC), [{ ...legendRow, id: "row_qq_c" }]);
assert.equal(capturedC.missing.length, 0, "fixture C legend must capture");
const linkGeometryC = capturedC.candidates[0].geometry;
assert.ok(linkGeometryC.length >= 3, "fixture C must yield an Approximate-eligible definition");
assert.ok(linkGeometryC.every((f) => !("shapeSignature" in f) && !("signature" in f)), "fixture C must reproduce the signature-less capture representation");

const capturedB = await captureLegendGeometry(new Uint8Array(legendPdfB), [{ ...legendRow, id: "row_qq_b" }]);
assert.equal(capturedB.missing.length, 0, "fixture B legend must capture");
const linkGeometryB = capturedB.candidates[0].geometry;
assert.ok(linkGeometryB.length >= 2, "fixture B must be multi-fragment");
assert.ok(linkGeometryB.every((f) => !("shapeSignature" in f) && !("signature" in f)), "fixture B must reproduce the signature-less capture representation");
assert.ok(linkGeometryB.some((f) => Array.isArray(f.coordinates) && f.coordinates.length > 13), "fixture B must carry structurally distinctive fragments");

const approxEligible = (definition) => definition.sourceGeometry.length >= 3;

// ENGINE A: trivial link fragments persist safely, keep the text fallback,
// and stay Approximate-eligible (multi-fragment icon).
test("engine persists signature-less trivial link fragments with the documented text fallback", async () => {
  const result = await recognizeDrawingSymbols(new Uint8Array(targetPdfA), {
    targetDocumentId: "doc_wlc",
    approvedStructuralRows: [{ id: "row_qq", source_page: 1, sourceDocumentId: "doc_t00", abbreviation: "QQ", description: "QUALIFICATION QUOTA", symbol_geometry: linkGeometryA, bounding_box: {}, structural_confidence: 88 }],
  });
  const definition = result.definitions.find((d) => d.abbreviation === "QQ");
  assert.ok(definition, "the QQ definition must exist");
  assert.deepEqual(definition.shapeSignatures, ["text:QQ"], "trivial fragments stay out of Exact anchoring by design");
  for (const g of definition.sourceGeometry) {
    assert.equal(typeof g.shapeSignature, "string", "every source geometry must carry a string signature for persistence");
    assert.ok(g.geometry && typeof g.geometry === "object", "every source geometry must carry defined raw geometry for feature scoring");
    assert.ok(g.fill === null || typeof g.fill === "string", "fill must be canonical (null or hex string), never a raw operator value");
  }
  assert.ok(approxEligible(definition), "the multi-fragment icon stays Approximate-eligible");
});

// ENGINE B: distinctive link fragments hash identically to the displaced
// target icon and Exact-match.
test("engine Exact-matches distinctive signature-less link fragments across displacement", async () => {
  const result = await recognizeDrawingSymbols(new Uint8Array(targetPdfB), {
    targetDocumentId: "doc_wlc",
    approvedStructuralRows: [{ id: "row_qq", source_page: 1, sourceDocumentId: "doc_t00", abbreviation: "QQ", description: "QUALIFICATION QUOTA", symbol_geometry: linkGeometryB, bounding_box: {}, structural_confidence: 88 }],
  });
  const definition = result.definitions.find((d) => d.abbreviation === "QQ");
  assert.ok(definition, "the QQ definition must exist");
  assert.ok(definition.shapeSignatures.some((s) => s.startsWith("shape:")), "distinctive link fragments must produce shape signatures");
  for (const g of definition.sourceGeometry) {
    assert.equal(typeof g.shapeSignature, "string");
    assert.ok(g.geometry && typeof g.geometry === "object");
  }
  assert.ok(result.occurrences.some((o) => o.matchType === "Exact" && o.matchedDefinitionKey === definition.definitionKey), "the displaced identical icon must Exact-match through the normalized representation");
});

// PRODUCTION: the real start route must persist signature-less link geometry
// instead of failing with D1_TYPE_ERROR.
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

test("production recognition start persists signature-less approved-link geometry (no D1_TYPE_ERROR)", async () => {
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
    INSERT INTO drawing_legend_geometry_approved_versions VALUES('agv_t00','project_1','doc_t00','gv_t00',1,'fi','fo','Approved',1,0,'local-development-user','fixture publication',NULL,CURRENT_TIMESTAMP);
    INSERT INTO drawing_structure_approved_rows(id,approved_version_id,source_page,source_row,symbol_geometry,abbreviation,description,bounding_box,structural_confidence) VALUES('row_qq','approvedStructure_t00',1,'7','[]','QQ','QUALIFICATION QUOTA','{}',88);
    INSERT INTO drawing_legend_geometry_approved_links(id,approved_geometry_version_id,approved_row_id,source_page,source_row,symbol_cell_bbox,geometry,geometry_signature,confidence,review_actor_id,review_reason) VALUES('link_qq','agv_t00','row_qq',1,'7','{}','[]','sig',88,'local-development-user','fixture');
  `);
  sql.prepare("UPDATE drawing_legend_geometry_approved_links SET geometry=? WHERE id='link_qq'").run(JSON.stringify(linkGeometryB));
  const env = {
    DB: d1(sql),
    FILES: { get: async (key) => key === "objects/wlc.pdf" ? { arrayBuffer: async () => targetPdfB.buffer.slice(targetPdfB.byteOffset, targetPdfB.byteOffset + targetPdfB.byteLength) } : null },
  };
  const post = (path, body) => new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const established = await handleDrawingSymbolRecognitionApi(post("/api/documents/doc_wlc/symbol-recognition/legend-context", { sourceDocumentId: "doc_t00", reason: "Link-shaped geometry must flow through the governed cross-document context." }), env);
  assert.equal(established.status, 201);
  const started = await handleDrawingSymbolRecognitionApi(post("/api/documents/doc_wlc/symbol-recognition/start", { reason: "Persist link-shaped approved geometry without D1 binding failure." }), env);
  assert.equal(started.status, 201, "production start must persist normalized link geometry instead of failing");
  const body = await started.json();
  const definition = body.definitions.find((d) => d.abbreviation === "QQ");
  assert.ok(definition && definition.shape_signatures.some((s) => String(s).startsWith("shape:")), "persisted definition must carry shape signatures");
  assert.ok(body.occurrences.some((o) => String(o.match_basis || "").startsWith("Exact")), "the displaced identical icon must be Exact-matched on the production path");
  const stored = sql.prepare("SELECT shape_signature, geometry FROM drawing_symbol_source_geometries").all();
  assert.ok(stored.length >= 2, "source geometries must be persisted");
  for (const row of stored) {
    assert.equal(typeof row.shape_signature, "string");
    assert.ok(JSON.parse(row.geometry), "stored raw geometry must be defined");
  }
});

// PRODUCTION-FUZZY: an Approximate occurrence deliberately carries no single
// exact signature (engine emits null), but the occurrences table requires
// shape_signature NOT NULL -- measured on the Clean Golden WLC production
// start as D1_ERROR SQLITE_CONSTRAINT. The same three-pentagon icon printed
// with a fill color defeats Exact matching while staying geometrically
// similar enough to fire the Approximate pass; the run must persist it.
// Same three-pentagon layout displaced and printed with a red fill: fill
// defeats Exact signature matching while aggregate geometry stays similar
// enough to fire the Approximate pass.
const filledTargetPdf = buildPositionedPdf(
  [{ text: "QQ", x: 900, y: 450 }],
  [],
  [pentagon(904, 452, 4), pentagon(912, 452, 4), pentagon(908, 456, 4)],
  "1 0 0 rg",
);

test("production recognition persists Approximate occurrences despite null engine shapeSignature", async () => {
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
    INSERT INTO drawing_legend_geometry_approved_versions VALUES('agv_t00','project_1','doc_t00','gv_t00',1,'fi','fo','Approved',1,0,'local-development-user','fixture publication',NULL,CURRENT_TIMESTAMP);
    INSERT INTO drawing_structure_approved_rows(id,approved_version_id,source_page,source_row,symbol_geometry,abbreviation,description,bounding_box,structural_confidence) VALUES('row_qq','approvedStructure_t00',1,'7','[]','QQ','QUALIFICATION QUOTA','{}',88);
    INSERT INTO drawing_legend_geometry_approved_links(id,approved_geometry_version_id,approved_row_id,source_page,source_row,symbol_cell_bbox,geometry,geometry_signature,confidence,review_actor_id,review_reason) VALUES('link_qq','agv_t00','row_qq',1,'7','{}','[]','sig',88,'local-development-user','fixture');
  `);
  sql.prepare("UPDATE drawing_legend_geometry_approved_links SET geometry=? WHERE id='link_qq'").run(JSON.stringify(linkGeometryC));
  const env = {
    DB: d1(sql),
    FILES: { get: async (key) => key === "objects/wlc.pdf" ? { arrayBuffer: async () => filledTargetPdf.buffer.slice(filledTargetPdf.byteOffset, filledTargetPdf.byteOffset + filledTargetPdf.byteLength) } : null },
  };
  const post = (path, body) => new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const established = await handleDrawingSymbolRecognitionApi(post("/api/documents/doc_wlc/symbol-recognition/legend-context", { sourceDocumentId: "doc_t00", reason: "Approximate occurrences must persist through the governed cross-document context." }), env);
  assert.equal(established.status, 201);
  const started = await handleDrawingSymbolRecognitionApi(post("/api/documents/doc_wlc/symbol-recognition/start", { reason: "Persist Approximate occurrences without NOT NULL violation." }), env);
  assert.equal(started.status, 201, "production start must persist fuzzy matches instead of failing");
  const body = await started.json();
  const fuzzy = body.occurrences.filter((o) => String(o.match_basis || "").startsWith("Approximate"));
  assert.ok(fuzzy.length >= 1, "the similar-but-filled icon cluster must be Approximate-matched");
  const stored = sql.prepare("SELECT occurrence_key, shape_signature, match_basis FROM drawing_symbol_occurrences WHERE match_basis LIKE 'Approximate%'").all();
  assert.equal(stored.length, fuzzy.length, "every Approximate occurrence must be persisted");
  for (const row of stored) {
    assert.equal(typeof row.shape_signature, "string", "stored shape_signature must satisfy NOT NULL");
    assert.ok(row.shape_signature.length > 0, "stored shape_signature must be non-empty");
  }
});
