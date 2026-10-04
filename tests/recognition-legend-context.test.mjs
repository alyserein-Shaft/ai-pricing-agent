import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { strToU8, zlibSync } from "fflate";

// Phase 2 — GOVERNED CROSS-DOCUMENT LEGEND CONTEXT.
//
// RED-first suite: proves the missing production capability before (and
// after) implementation. Every handler-level test drives the REAL
// production dispatcher (handleDrawingSymbolRecognitionApi) with an
// isolated :memory: D1 shim, mirroring the production table contracts --
// never direct engine composition. Engine-level tests pin the identity
// semantics (TEST E/F) where the semantics live.
import { handleDrawingSymbolRecognitionApi } from "../worker/drawing-symbol-recognition-api.mjs";
import { recognizeDrawingSymbols } from "../app/domain/drawing-symbol-recognition-engine.mjs";
import { parseDrawingStructure } from "../app/domain/drawing-structural-parser.mjs";

const api = readFileSync(new URL("../worker/drawing-symbol-recognition-api.mjs", import.meta.url), "utf8");

// Same positioned-PDF convention as tests/drawing-symbol-recognition-engine.test.mjs.
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
const pentagon = (cx, cy, r) => [0, 1, 2, 3, 4].map((i) => { const angle = -Math.PI / 2 + i * (2 * Math.PI / 5); return { x: Math.round((cx + r * Math.cos(angle)) * 100) / 100, y: Math.round((cy + r * Math.sin(angle)) * 100) / 100 }; });

// The legend-authority PDF (T-00 stand-in): one real legend row whose
// pentagon icon geometry the structural parser captures with real
// signatures. The target PDF (WLC stand-in) is a DIFFERENT document
// containing the same pentagon placed elsewhere -- the canonical
// cross-document shape of the T-00 -> WLC relationship.
const legendPdf = buildPositionedPdf(
  [{ text: "SYMBOL", x: 2900, y: 600 }, { text: "CR", x: 150, y: 560 }, { text: "CARD READER", x: 150, y: 500 }, { text: "DESCRIPTION", x: 2900, y: 470 }],
  [], [0, 0, 3000, 3000],
  [pentagon(150, 545, 8)],
);
const targetPdf = buildPositionedPdf(
  [{ text: "CR", x: 2250, y: 940 }],
  [], [0, 0, 3000, 3000],
  [pentagon(2200, 900, 8)],
);
const legendStructure = await parseDrawingStructure(new Uint8Array(legendPdf));
assert.ok(legendStructure.legendRows.length === 1, "fixture legend must parse to one governed row");
const legendRow = legendStructure.legendRows[0];

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

const SCHEMA = `
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
`;

const fixture = () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec(SCHEMA);
  sql.exec(`
    INSERT INTO projects VALUES('project_1','local-development-user','organization_bd_shaft_internal_pilot');
    INSERT INTO projects VALUES('project_2','local-development-user','organization_bd_shaft_internal_pilot');
    INSERT INTO projects VALUES('project_other_owner','someone-else','organization_bd_shaft_internal_pilot');
    -- TARGET: WLC stand-in (project_1)
    INSERT INTO documents VALUES('doc_wlc','project_1','WLC Schematic','ver_wlc',NULL);
    INSERT INTO document_versions VALUES('ver_wlc','doc_wlc','objects/wlc.pdf','sha_wlc','pdf',NULL);
    -- SOURCE: T-00 legend stand-in (project_1)
    INSERT INTO documents VALUES('doc_t00','project_1','T-00 ELV Legends','ver_t00',NULL);
    INSERT INTO document_versions VALUES('ver_t00','doc_t00','objects/t00.pdf','sha_t00','pdf',NULL);
    -- Decoy target in the same project with NO geometry of its own
    INSERT INTO documents VALUES('doc_decoy','project_1','Decoy Target','ver_decoy',NULL);
    INSERT INTO document_versions VALUES('ver_decoy','doc_decoy','objects/decoy.pdf','sha_decoy','pdf',NULL);
    -- Same-project-2 source (must be rejected: different project)
    INSERT INTO documents VALUES('doc_other_project','project_2','Foreign Legend','ver_other_project',NULL);
    INSERT INTO document_versions VALUES('ver_other_project','doc_other_project','objects/other.pdf','sha_other','pdf',NULL);
    -- Cross-owner source (must be invisible to the scoped query)
    INSERT INTO documents VALUES('doc_other_owner','project_other_owner','Foreign Owner Legend','ver_other_owner',NULL);
    INSERT INTO document_versions VALUES('ver_other_owner','doc_other_owner','objects/other-owner.pdf','sha_other_owner','pdf',NULL);
    -- Both WLC and T-00 have completed intake (the target needs its own)
    INSERT INTO drawing_intake_versions VALUES('intake_wlc','project_1','doc_wlc','ver_wlc',1,'Completed',NULL);
    INSERT INTO drawing_intake_versions VALUES('intake_t00','project_1','doc_t00','ver_t00',1,'Completed',NULL);
    INSERT INTO drawing_intake_versions VALUES('intake_decoy','project_1','doc_decoy','ver_decoy',1,'Completed',NULL);
    -- T-00's governed approved geometry: one link to one approved row
    -- carrying the REAL parser-captured pentagon geometry.
    INSERT INTO drawing_legend_geometry_approved_versions VALUES('agv_t00','project_1','doc_t00','gv_t00',1,'fi','fo','Approved',1,0,'local-development-user','fixture publication',NULL,CURRENT_TIMESTAMP);
    INSERT INTO drawing_structure_approved_rows(id,approved_version_id,source_page,source_row,symbol_geometry,abbreviation,description,bounding_box,structural_confidence) VALUES('row_re','approvedStructure_t00',1,'1',?,'CR','CARD READER','{}',96);
    INSERT INTO drawing_legend_geometry_approved_links(id,approved_geometry_version_id,approved_row_id,source_page,source_row,symbol_cell_bbox,geometry,geometry_signature,confidence,review_actor_id,review_reason) VALUES('link_re','agv_t00','row_re',1,'1','{}',?,?,96,'local-development-user','fixture');
  `);
  sql.prepare("UPDATE drawing_structure_approved_rows SET symbol_geometry=?").run(JSON.stringify(legendRow.symbolGeometry));
  sql.prepare("UPDATE drawing_legend_geometry_approved_links SET geometry=?").run(JSON.stringify(legendRow.symbolGeometry));
  return sql;
};

const env = (sql) => ({
  DB: d1(sql),
  FILES: {
    get: async (key) => key === "objects/wlc.pdf" ? { arrayBuffer: async () => targetPdf.buffer.slice(targetPdf.byteOffset, targetPdf.byteOffset + targetPdf.byteLength) } : null,
  },
});
const req = (path, init) => new Request(`http://localhost${path}`, init);
const post = (path, body) => req(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// ============================================================
// TEST A -- explicit cross-document governed source works through
// the PRODUCTION route, with both identities distinct end to end.
// ============================================================
test("A: production recognition consumes T-00 approved legend geometry for the WLC target when an explicit governed context exists", async () => {
  const sql = fixture();
  // Establish the governed relationship through its own production route.
  const established = await handleDrawingSymbolRecognitionApi(post("/api/documents/doc_wlc/symbol-recognition/legend-context", { sourceDocumentId: "doc_t00", reason: "T-00 is the governed ELV legend authority for this WLC schematic." }), env(sql));
  assert.equal(established.status, 201);
  const contextBody = await established.json();
  assert.equal(contextBody.legendContext.sourceDocumentId, "doc_t00");
  assert.equal(contextBody.legendContext.targetDocumentId, "doc_wlc");
  assert.equal(contextBody.legendContext.approvedGeometryVersionId, "agv_t00");

  // Production recognition start.
  const started = await handleDrawingSymbolRecognitionApi(post("/api/documents/doc_wlc/symbol-recognition/start", { reason: "Recognize WLC symbols against the governed T-00 legend context." }), env(sql));
  assert.equal(started.status, 201);
  const body = await started.json();

  // T-00's definitions loaded; WLC remained the recognition target.
  const definition = body.definitions.find((d) => d.abbreviation === "CR");
  assert.ok(definition, "the T-00 legend definition must be loaded into the recognition run");
  assert.equal(definition.source_document_id, "doc_t00", "definition provenance must retain the SOURCE document identity");
  const exact = body.occurrences.find((o) => String(o.match_basis || "").startsWith("Exact"));
  assert.ok(exact, "the placed pentagon on the WLC page must be matched");
  assert.ok(Math.round(exact.bounding_box.x) > 2000, "the matched occurrence must be on the WLC target PDF, not the legend sheet");
  assert.equal(exact.page_number, 1, "target page provenance retained");

  // Persisted provenance.
  const version = sql.prepare("SELECT * FROM drawing_symbol_recognition_versions WHERE superseded_at IS NULL").get();
  assert.equal(version.document_id, "doc_wlc", "the recognition version belongs to the TARGET document");
  assert.equal(version.source_document_id, "doc_t00", "the recognition version must record the legend SOURCE document");
  assert.equal(version.source_legend_geometry_version_id, "agv_t00", "the recognition version must record the governed approved geometry version");
  const defRow = sql.prepare("SELECT * FROM drawing_symbol_definitions WHERE abbreviation='CR'").get();
  assert.equal(defRow.source_document_id, "doc_t00");
  assert.equal(defRow.source_page, 1);
  const occRow = sql.prepare("SELECT * FROM drawing_symbol_occurrences WHERE match_basis LIKE 'Exact%'").get();
  assert.ok(occRow, "matched occurrence persisted");
  assert.equal(occRow.page_number, 1, "occurrence target page retained");
});

// ============================================================
// TEST B -- implicit cross-document lookup is forbidden.
// ============================================================
test("B: with no explicit context, recognition never searches other project documents for geometry (decoy rejected)", async () => {
  const sql = fixture();
  // doc_decoy has completed intake, no own approved geometry, and the SAME
  // project contains doc_t00 WITH approved geometry. No context exists.
  const refused = await handleDrawingSymbolRecognitionApi(post("/api/documents/doc_decoy/symbol-recognition/start", { reason: "No context and no own geometry must fail closed." }), env(sql));
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error.code, "APPROVED_SYMBOL_GEOMETRY_REQUIRED");
  const versions = sql.prepare("SELECT COUNT(*) n FROM drawing_symbol_recognition_versions").get().n;
  assert.equal(versions, 0, "no recognition version may be created from an implicit lookup");
});

// Backward compatibility: same-document recognition keeps working exactly as
// before, now with explicit self provenance.
test("B2: same-document recognition still works with the target's own approved geometry (backward compatible)", async () => {
  const sql = fixture();
  sql.exec(`
    INSERT INTO drawing_legend_geometry_approved_versions VALUES('agv_self','project_1','doc_wlc','gv_self',1,'fi','fo','Approved',1,0,'local-development-user','fixture',NULL,CURRENT_TIMESTAMP);
    INSERT INTO drawing_legend_geometry_approved_links(id,approved_geometry_version_id,approved_row_id,source_page,source_row,symbol_cell_bbox,geometry,geometry_signature,confidence,review_actor_id,review_reason) VALUES('link_self','agv_self','row_re',1,'1','{}',(SELECT symbol_geometry FROM drawing_structure_approved_rows WHERE id='row_re'),'sig',96,'local-development-user','fixture');
  `);
  const started = await handleDrawingSymbolRecognitionApi(post("/api/documents/doc_wlc/symbol-recognition/start", { reason: "Same-document recognition against the target's own approved geometry." }), env(sql));
  assert.equal(started.status, 201);
  const body = await started.json();
  const definition = body.definitions.find((d) => d.abbreviation === "CR");
  assert.ok(definition);
  assert.equal(definition.source_document_id, "doc_wlc", "same-document definitions carry explicit self provenance");
  const version = sql.prepare("SELECT * FROM drawing_symbol_recognition_versions WHERE superseded_at IS NULL").get();
  assert.equal(version.source_document_id, "doc_wlc");
  assert.equal(version.source_legend_geometry_version_id, "agv_self");
  assert.ok(body.occurrences.some((o) => String(o.match_basis || "").startsWith("Exact")), "same-document exact matching still works");
});

// ============================================================
// TEST C -- cross-project / cross-ownership sources are forbidden.
// ============================================================
test("C: a legend source in a different project is rejected at context creation and at recognition time", async () => {
  const sql = fixture();
  const crossProject = await handleDrawingSymbolRecognitionApi(post("/api/documents/doc_wlc/symbol-recognition/legend-context", { sourceDocumentId: "doc_other_project", reason: "Attempt to use a foreign project legend." }), env(sql));
  assert.equal(crossProject.status, 409);
  assert.equal((await crossProject.json()).error.code, "LEGEND_SOURCE_PROJECT_MISMATCH");

  const crossOwner = await handleDrawingSymbolRecognitionApi(post("/api/documents/doc_wlc/symbol-recognition/legend-context", { sourceDocumentId: "doc_other_owner", reason: "Attempt to use another owner's legend." }), env(sql));
  assert.equal(crossOwner.status, 404, "a foreign-ownership source must be invisible to the scoped query");
  assert.equal((await crossOwner.json()).error.code, "LEGEND_SOURCE_NOT_FOUND");

  // Defense in depth: a context row that points cross-project (seeded
  // directly) is re-validated and refused at recognition time.
  sql.exec(`INSERT INTO drawing_recognition_legend_contexts (id,project_id,target_document_id,source_document_id,approved_geometry_version_id,reason,created_by) VALUES('ctx_bad','project_1','doc_wlc','doc_other_project','agv_t00','seeded directly','local-development-user');`);
  const refused = await handleDrawingSymbolRecognitionApi(post("/api/documents/doc_wlc/symbol-recognition/start", { reason: "Recognition must re-validate the governed context." }), env(sql));
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error.code, "LEGEND_CONTEXT_PROJECT_MISMATCH");
});

// ============================================================
// TEST D -- version authority: only the pinned, still-current,
// approved geometry version may feed recognition.
// ============================================================
test("D: a superseded, unapproved, or missing pinned geometry version cannot feed recognition", async () => {
  const sql = fixture();
  await handleDrawingSymbolRecognitionApi(post("/api/documents/doc_wlc/symbol-recognition/legend-context", { sourceDocumentId: "doc_t00", reason: "Pin the T-00 approved geometry version for WLC." }), env(sql));

  sql.prepare("UPDATE drawing_legend_geometry_approved_versions SET superseded_at=CURRENT_TIMESTAMP WHERE id='agv_t00'").run();
  const superseded = await handleDrawingSymbolRecognitionApi(post("/api/documents/doc_wlc/symbol-recognition/start", { reason: "The pinned version was superseded." }), env(sql));
  assert.equal(superseded.status, 409);
  assert.equal((await superseded.json()).error.code, "LEGEND_CONTEXT_VERSION_STALE");

  sql.prepare("UPDATE drawing_legend_geometry_approved_versions SET superseded_at=NULL, status='Processing' WHERE id='agv_t00'").run();
  const unapproved = await handleDrawingSymbolRecognitionApi(post("/api/documents/doc_wlc/symbol-recognition/start", { reason: "The pinned version is not Approved." }), env(sql));
  assert.equal(unapproved.status, 409);
  assert.equal((await unapproved.json()).error.code, "LEGEND_CONTEXT_VERSION_STALE");

  sql.prepare("UPDATE drawing_recognition_legend_contexts SET approved_geometry_version_id='agv_missing' WHERE superseded_at IS NULL").run();
  sql.prepare("UPDATE drawing_legend_geometry_approved_versions SET status='Approved' WHERE id='agv_t00'").run();
  const missing = await handleDrawingSymbolRecognitionApi(post("/api/documents/doc_wlc/symbol-recognition/start", { reason: "The pinned version no longer exists." }), env(sql));
  assert.equal(missing.status, 409);
  assert.equal((await missing.json()).error.code, "LEGEND_CONTEXT_VERSION_STALE");
});

// ============================================================
// Context governance: reason required, append-only supersedes, GET current.
// ============================================================
test("context creation is reason-governed, append-only, and readable", async () => {
  const sql = fixture();
  const shortReason = await handleDrawingSymbolRecognitionApi(post("/api/documents/doc_wlc/symbol-recognition/legend-context", { sourceDocumentId: "doc_t00", reason: "ok" }), env(sql));
  assert.equal(shortReason.status, 422);
  assert.equal((await shortReason.json()).error.code, "LEGEND_CONTEXT_REASON_REQUIRED");

  const selfSource = await handleDrawingSymbolRecognitionApi(post("/api/documents/doc_wlc/symbol-recognition/legend-context", { sourceDocumentId: "doc_wlc", reason: "A context must be cross-document; same-document stays implicit." }), env(sql));
  assert.equal(selfSource.status, 422);
  assert.equal((await selfSource.json()).error.code, "LEGEND_SOURCE_MUST_DIFFER");

  await handleDrawingSymbolRecognitionApi(post("/api/documents/doc_wlc/symbol-recognition/legend-context", { sourceDocumentId: "doc_t00", reason: "First governed legend context for WLC." }), env(sql));
  const second = await handleDrawingSymbolRecognitionApi(post("/api/documents/doc_wlc/symbol-recognition/legend-context", { sourceDocumentId: "doc_t00", reason: "Re-established after a legend republication." }), env(sql));
  assert.equal(second.status, 201);
  const rows = sql.prepare("SELECT id, superseded_at FROM drawing_recognition_legend_contexts ORDER BY rowid").all();
  assert.equal(rows.length, 2, "contexts are append-only -- the previous decision remains a historical row");
  assert.ok(rows[0].superseded_at && !rows[1].superseded_at, "exactly the latest context is current");

  const current = await handleDrawingSymbolRecognitionApi(req("/api/documents/doc_wlc/symbol-recognition/legend-context"), env(sql));
  assert.equal(current.status, 200);
  const body = await current.json();
  assert.equal(body.legendContext.sourceDocumentId, "doc_t00");
  assert.ok(!body.legendContext.supersededAt);
  const none = await handleDrawingSymbolRecognitionApi(req("/api/documents/doc_decoy/symbol-recognition/legend-context"), env(sql));
  assert.equal((await none.json()).legendContext, null);
});

// ============================================================
// TEST E -- identity survives into the engine.
// ============================================================
test("E: the engine receives and retains distinct source and target document identities", async () => {
  const result = await recognizeDrawingSymbols(new Uint8Array(targetPdf), {
    targetDocumentId: "doc_wlc",
    approvedStructuralRows: [{ id: "row_re", source_page: 1, sourceDocumentId: "doc_t00", abbreviation: "CR", description: "CARD READER", symbol_geometry: legendRow.symbolGeometry, bounding_box: {}, structural_confidence: 96 }],
  });
  assert.equal(result.definitions.length, 1);
  assert.equal(result.definitions[0].sourceDocumentId, "doc_t00", "definition provenance carries the source identity");
  assert.ok(result.occurrences.some((o) => o.matchType === "Exact"), "cross-document exact matching works at engine level");

  // Legacy composition (no identities) keeps the historical default.
  const legacy = await recognizeDrawingSymbols(new Uint8Array(targetPdf), {
    approvedStructuralRows: [{ id: "row_re", source_page: 1, abbreviation: "CR", description: "CARD READER", symbol_geometry: legendRow.symbolGeometry, bounding_box: {}, structural_confidence: 96 }],
  });
  assert.equal(legacy.definitions[0].sourceDocumentId, null, "absence of identity falls back to the historical same-document default");
  assert.ok(legacy.occurrences.some((o) => o.matchType === "Exact"));
});

// ============================================================
// TEST F -- same-page collision semantics.
// ============================================================
test("F: source page 1 of another document is never the target's page 1 -- but same-document page equality still skips", async () => {
  const rows = (sourceDocumentId) => [{ id: "row_tag", source_page: 1, abbreviation: "CR", description: "CARD READER", symbol_geometry: [], bounding_box: {}, structural_confidence: 96, ...(sourceDocumentId ? { sourceDocumentId } : {}) }];
  // Cross-document: legend on T-00 page 1, target WLC page 1 -> NOT the same
  // source location, so the text-tag pass must run and find the "CR" tag.
  const cross = await recognizeDrawingSymbols(new Uint8Array(targetPdf), { targetDocumentId: "doc_wlc", approvedStructuralRows: rows("doc_t00") });
  const crossTag = cross.occurrences.find((o) => o.matchType === "Text Tag");
  assert.ok(crossTag, "cross-document same page number must not be treated as the legend's own page");

  // Same-document (explicit identities): page 1 === source page 1 -> the
  // legend's own page, so the text-tag pass must skip it.
  const sameExplicit = await recognizeDrawingSymbols(new Uint8Array(targetPdf), { targetDocumentId: "doc_wlc", approvedStructuralRows: rows("doc_wlc") });
  assert.ok(!sameExplicit.occurrences.some((o) => o.matchType === "Text Tag"), "same document + same page is still the legend's own page");

  // Legacy (no identities): historical page-number comparison preserved.
  const legacy = await recognizeDrawingSymbols(new Uint8Array(targetPdf), { approvedStructuralRows: rows(null) });
  assert.ok(!legacy.occurrences.some((o) => o.matchType === "Text Tag"), "legacy callers keep the historical same-document skip");
});

// ============================================================
// TEST G -- static: the production route actually wires the identities
// (guards against composition-only regressions).
// ============================================================
test("G: the production loader supplies both identities and persists source provenance", () => {
  assert.match(api, /targetDocumentId:\s*document\.id/, "the production engine call must pass the target identity");
  assert.match(api, /sourceDocumentId/, "the production loader must pass per-row source identity");
  assert.match(api, /source_document_id/, "persistence must retain source-document provenance");
  assert.match(api, /drawing_recognition_legend_contexts/, "a governed context relationship must exist");
  assert.doesNotMatch(api, /WHERE document_id=\? AND superseded_at IS NULL AND status='Approved' ORDER BY version_number DESC LIMIT 1",?\s*\)\s*\n\s*\.bind\(document\.id\)\s*\n\s*\.first\(\);\s*\n\s*const approvedRows/, "the same-document query must not silently remain the only source resolution");
});
