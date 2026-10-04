import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import {
  computeApprovedQuantityEvidence,
  resolveGovernedLink,
  compareDrawingEvidenceToBoq,
  COVERAGE_STATES,
  DEFAULT_COVERAGE_STATE,
} from "../app/domain/drawing-quantity-evidence-engine.mjs";
import { handleDrawingQuantityEvidenceApi } from "../worker/drawing-quantity-evidence-api.mjs";
import { handleDrawingSymbolRecognitionApi } from "../worker/drawing-symbol-recognition-api.mjs";
import { parseDrawingStructure } from "../app/domain/drawing-structural-parser.mjs";
import { recognizeDrawingSymbols } from "../app/domain/drawing-symbol-recognition-engine.mjs";

const api = fs.readFileSync(new URL("../worker/drawing-quantity-evidence-api.mjs", import.meta.url), "utf8");
const engine = fs.readFileSync(new URL("../app/domain/drawing-quantity-evidence-engine.mjs", import.meta.url), "utf8");
const ui = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

// ============================================================
// Domain-level unit tests (pure, no DB)
// ============================================================

test("computeApprovedQuantityEvidence counts only Approved occurrences, never Needs Review, Rejected or unmatched", () => {
  const definitions = [{ definitionKey: "def_re", abbreviation: "RE", description: "CEILING MOUNTED DOME CAMERA" }];
  const occurrences = [
    { id: "occ1", pageNumber: 1, matchedDefinitionKey: "def_re", reviewStatus: "Approved" },
    { id: "occ2", pageNumber: 1, matchedDefinitionKey: "def_re", reviewStatus: "Approved" },
    { id: "occ3", pageNumber: 1, matchedDefinitionKey: "def_re", reviewStatus: "Needs Review" },
    { id: "occ4", pageNumber: 1, matchedDefinitionKey: "def_re", reviewStatus: "Rejected" },
    { id: "occ5", pageNumber: 1, matchedDefinitionKey: null, reviewStatus: "Approved" },
  ];
  const evidence = computeApprovedQuantityEvidence({ occurrences, definitions, recognitionVersionId: "v1", documentId: "doc1" });
  assert.equal(evidence.groups.length, 1);
  assert.equal(evidence.groups[0].approvedOccurrenceCount, 2);
  assert.deepEqual(evidence.groups[0].approvedOccurrences.map((o) => o.id).sort(), ["occ1", "occ2"]);
  assert.equal(evidence.totalApprovedOccurrenceCount, 2);
  assert.equal(evidence.isEvidence, true);
  assert.equal(evidence.isBoqTruth, false);
});

test("computeApprovedQuantityEvidence resolves System/Family through the System Knowledge Registry, never a part number", () => {
  const definitions = [{ definitionKey: "def_re", abbreviation: "RE", description: "CEILING MOUNTED DOME CAMERA" }];
  const occurrences = [{ id: "occ1", pageNumber: 1, matchedDefinitionKey: "def_re", reviewStatus: "Approved" }];
  const evidence = computeApprovedQuantityEvidence({ occurrences, definitions, recognitionVersionId: "v1", documentId: "doc1" });
  assert.equal(evidence.groups[0].system, "CCTV");
  assert.ok(evidence.groups[0].families.some((f) => f.family === "Dome Camera" && f.category === "Cameras"));
});

test("an unregistered system (Access Control) honestly reports system:null -- never fabricated", () => {
  const definitions = [{ definitionKey: "def_cr", abbreviation: "CR", description: "CARD READER" }];
  const occurrences = [{ id: "occ1", pageNumber: 1, matchedDefinitionKey: "def_cr", reviewStatus: "Approved" }];
  const evidence = computeApprovedQuantityEvidence({ occurrences, definitions, recognitionVersionId: "v1", documentId: "doc1" });
  assert.equal(evidence.groups[0].system, null);
});

test("reassignment changes grouping: an occurrence moved from one legend identity to another moves between evidence groups", () => {
  const definitions = [
    { definitionKey: "def_re", abbreviation: "RE", description: "CEILING MOUNTED DOME CAMERA" },
    { definitionKey: "def_d", abbreviation: "D", description: "WALL MOUNTED DOME CAMERA" },
  ];
  const before = computeApprovedQuantityEvidence({
    occurrences: [
      { id: "occ1", pageNumber: 1, matchedDefinitionKey: "def_re", reviewStatus: "Approved" },
      { id: "occ2", pageNumber: 1, matchedDefinitionKey: "def_re", reviewStatus: "Approved" },
    ],
    definitions,
    recognitionVersionId: "v1",
    documentId: "doc1",
  });
  assert.equal(before.groups.find((g) => g.definitionKey === "def_re").approvedOccurrenceCount, 2);
  assert.equal(before.groups.find((g) => g.definitionKey === "def_d"), undefined);
  // engineer reassigns occ1 from RE to D (a reassignment always resets to Needs Review in the real worker,
  // but once re-approved it belongs to its new identity's group, not its old one)
  const after = computeApprovedQuantityEvidence({
    occurrences: [
      { id: "occ1", pageNumber: 1, matchedDefinitionKey: "def_d", reviewStatus: "Approved" },
      { id: "occ2", pageNumber: 1, matchedDefinitionKey: "def_re", reviewStatus: "Approved" },
    ],
    definitions,
    recognitionVersionId: "v1",
    documentId: "doc1",
  });
  assert.equal(after.groups.find((g) => g.definitionKey === "def_re").approvedOccurrenceCount, 1);
  assert.equal(after.groups.find((g) => g.definitionKey === "def_d").approvedOccurrenceCount, 1);
});

test("resolveGovernedLink requires an APPROVED estimator understanding review, a matching System, and a matching (or synonymous) Family", () => {
  const evidenceGroup = { system: "CCTV", families: [{ category: "Cameras", family: "Dome Camera" }] };
  assert.equal(
    resolveGovernedLink({ evidenceGroup, canonicalInterpretation: { system: "CCTV", productFamily: "Dome Camera" }, reviewStatus: "APPROVED" }),
    true,
  );
  assert.equal(
    resolveGovernedLink({ evidenceGroup, canonicalInterpretation: { system: "CCTV", productFamily: "Dome Camera" }, reviewStatus: "AWAITING_REVIEW" }),
    false,
    "an unapproved understanding review is never a governed link",
  );
  assert.equal(
    resolveGovernedLink({ evidenceGroup, canonicalInterpretation: { system: "Fire Alarm", productFamily: "Detector" }, reviewStatus: "APPROVED" }),
    false,
    "a mismatched system is never a governed link",
  );
  assert.equal(
    resolveGovernedLink({ evidenceGroup, canonicalInterpretation: { system: "CCTV", productFamily: "Bullet Camera" }, reviewStatus: "APPROVED" }),
    false,
    "an unrelated family is never a governed link",
  );
});

test("compareDrawingEvidenceToBoq: no governed link -> not comparable, never a false conflict", () => {
  const evidenceGroup = { system: "CCTV", families: [{ category: "Cameras", family: "Dome Camera" }], approvedOccurrenceCount: 2 };
  const result = compareDrawingEvidenceToBoq({
    evidenceGroup,
    boqItem: { numeric_quantity: "4" },
    canonicalInterpretation: { system: "CCTV", productFamily: "Bullet Camera" },
    reviewStatus: "APPROVED",
    coverageState: "Complete / Engineer Confirmed",
  });
  assert.equal(result.status, "No governed link");
  assert.equal(result.comparable, false);
});

test("compareDrawingEvidenceToBoq: partial coverage with a count mismatch is PARTIAL DRAWING EVIDENCE / Needs Review, never a conflict", () => {
  const evidenceGroup = { system: "CCTV", families: [{ category: "Cameras", family: "Dome Camera" }], approvedOccurrenceCount: 2 };
  const result = compareDrawingEvidenceToBoq({
    evidenceGroup,
    boqItem: { numeric_quantity: "4" },
    canonicalInterpretation: { system: "CCTV", productFamily: "Dome Camera" },
    reviewStatus: "APPROVED",
    coverageState: "Partial",
  });
  assert.equal(result.status, "PARTIAL DRAWING EVIDENCE / Needs Review");
  assert.equal(result.drawingQuantity, 2);
  assert.equal(result.boqQuantity, 4);
  assert.notEqual(result.status, "Quantity Conflict — Needs Review", "an incomplete-coverage mismatch must never be reported as a real conflict");
});

test("compareDrawingEvidenceToBoq: conclusive coverage with a count mismatch is a real Quantity Conflict", () => {
  const evidenceGroup = { system: "CCTV", families: [{ category: "Cameras", family: "Dome Camera" }], approvedOccurrenceCount: 2 };
  const result = compareDrawingEvidenceToBoq({
    evidenceGroup,
    boqItem: { numeric_quantity: "4" },
    canonicalInterpretation: { system: "CCTV", productFamily: "Dome Camera" },
    reviewStatus: "APPROVED",
    coverageState: "Reviewed Drawing Set",
  });
  assert.equal(result.status, "Quantity Conflict — Needs Review");
  assert.equal(result.conclusive, true);
});

test("compareDrawingEvidenceToBoq: matching counts are Aligned regardless of coverage state", () => {
  const evidenceGroup = { system: "CCTV", families: [{ category: "Cameras", family: "Dome Camera" }], approvedOccurrenceCount: 4 };
  const result = compareDrawingEvidenceToBoq({
    evidenceGroup,
    boqItem: { numeric_quantity: "4" },
    canonicalInterpretation: { system: "CCTV", productFamily: "Dome Camera" },
    reviewStatus: "APPROVED",
    coverageState: "Partial",
  });
  assert.equal(result.status, "Aligned");
});

test("source carries no engineering-object or part-number creation, and evidence is explicitly distinguished from truth", () => {
  assert.doesNotMatch(engine, /partNumber\s*:|part_number\s*:|manufacturer\s*:/i);
  assert.match(engine, /isEvidence/);
  assert.match(engine, /isBoqTruth:\s*false/);
});

// ============================================================
// Worker-level D1-shim tests: real HTTP handler, real persistence
// ============================================================

const d1 = (sql) => ({
  prepare(text) {
    let values = [];
    return {
      bind(...next) {
        values = next;
        return this;
      },
      first: async () => sql.prepare(text).get(...values) ?? null,
      all: async () => ({ results: sql.prepare(text).all(...values) }),
      run: async () => sql.prepare(text).run(...values),
    };
  },
  batch: async (statements) => Promise.all(statements.map((s) => s.run())),
});

const fixture = () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`
    CREATE TABLE project_members (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), user_id TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Active', granted_by TEXT NOT NULL, granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, revoked_at TEXT);
    CREATE TABLE projects(id TEXT PRIMARY KEY,owner_user_id TEXT,organization_id TEXT);
    CREATE TABLE documents(id TEXT PRIMARY KEY,project_id TEXT,logical_name TEXT,deleted_at TEXT);
    CREATE TABLE drawing_symbol_recognition_versions(id TEXT PRIMARY KEY,project_id TEXT,document_id TEXT,version_number INTEGER,superseded_at TEXT);
    CREATE TABLE drawing_symbol_definitions(id TEXT PRIMARY KEY,project_id TEXT,recognition_version_id TEXT,definition_key TEXT,abbreviation TEXT,description TEXT);
    CREATE TABLE drawing_symbol_occurrences(id TEXT PRIMARY KEY,recognition_version_id TEXT,definition_id TEXT,original_definition_id TEXT,occurrence_key TEXT,page_number INTEGER,bounding_box TEXT,shape_signature TEXT,nearby_text TEXT,match_basis TEXT,confidence INTEGER,review_status TEXT DEFAULT 'Needs Review',source_geometry TEXT,score_components TEXT,reviewed_by TEXT,reviewed_at TEXT,review_reason TEXT);
    CREATE TABLE drawing_symbol_review_events(id TEXT PRIMARY KEY,project_id TEXT,recognition_version_id TEXT,entity_type TEXT,entity_id TEXT,action TEXT,previous_value TEXT,new_value TEXT,reason TEXT,actor_user_id TEXT,request_id TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE drawing_quantity_evidence_coverage(id TEXT PRIMARY KEY,project_id TEXT,recognition_version_id TEXT,coverage_state TEXT,reason TEXT,set_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE boq_items(id TEXT PRIMARY KEY,project_id TEXT,numeric_quantity TEXT);
    CREATE TABLE estimator_understanding_review_versions(id TEXT PRIMARY KEY,project_id TEXT,boq_item_id TEXT,version_number INTEGER,review_status TEXT,canonical_interpretation TEXT);
    INSERT INTO projects VALUES('project_1','local-development-user','organization_bd_shaft_internal_pilot');
    INSERT INTO documents VALUES('doc_1','project_1','Floor Plan',NULL);
  `);
  return sql;
};

const req = (path, init) => new Request(`http://localhost${path}`, init);

test("worker: only Approved occurrences are counted, live from current review state (not a cached number)", async () => {
  const sql = fixture();
  sql.exec(`
    INSERT INTO drawing_symbol_recognition_versions VALUES('v1','project_1','doc_1',1,NULL);
    INSERT INTO drawing_symbol_definitions VALUES('def_re','project_1','v1','def_re','RE','CEILING MOUNTED DOME CAMERA');
    INSERT INTO drawing_symbol_occurrences VALUES('occ1','v1','def_re',NULL,'k1',1,'{}','sig','','basis',60,'Approved',NULL,NULL,NULL,NULL,NULL);
    INSERT INTO drawing_symbol_occurrences VALUES('occ2','v1','def_re',NULL,'k2',1,'{}','sig','','basis',60,'Approved',NULL,NULL,NULL,NULL,NULL);
    INSERT INTO drawing_symbol_occurrences VALUES('occ3','v1','def_re',NULL,'k3',1,'{}','sig','','basis',60,'Needs Review',NULL,NULL,NULL,NULL,NULL);
    INSERT INTO drawing_symbol_occurrences VALUES('occ4','v1','def_re',NULL,'k4',1,'{}','sig','','basis',60,'Rejected',NULL,NULL,NULL,NULL,NULL);
  `);
  const env = { DB: d1(sql) };
  const response = await handleDrawingQuantityEvidenceApi(req("/api/documents/doc_1/drawing-quantity-evidence"), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.totalApprovedOccurrenceCount, 2);
  assert.equal(body.groups[0].approvedOccurrenceCount, 2);
  assert.equal(body.isEvidence, true);

  // A review action changes the count on the very next read -- no separate
  // recalculation step, because the count is always derived live.
  await sql.prepare("UPDATE drawing_symbol_occurrences SET review_status='Rejected' WHERE id='occ2'").run();
  const afterReject = await (await handleDrawingQuantityEvidenceApi(req("/api/documents/doc_1/drawing-quantity-evidence"), env)).json();
  assert.equal(afterReject.groups[0].approvedOccurrenceCount, 1, "rejecting a previously approved occurrence must immediately reduce the current count");
});

test("worker: a stale/superseded recognition version is excluded -- only the current version's approved occurrences count", async () => {
  const sql = fixture();
  sql.exec(`
    INSERT INTO drawing_symbol_recognition_versions VALUES('v1_old','project_1','doc_1',1,'2026-01-01T00:00:00.000Z');
    INSERT INTO drawing_symbol_recognition_versions VALUES('v2_current','project_1','doc_1',2,NULL);
    INSERT INTO drawing_symbol_definitions VALUES('def_old','project_1','v1_old','def_old','RE','CEILING MOUNTED DOME CAMERA');
    INSERT INTO drawing_symbol_definitions VALUES('def_new','project_1','v2_current','def_new','RE','CEILING MOUNTED DOME CAMERA');
    INSERT INTO drawing_symbol_occurrences VALUES('occ_old_1','v1_old','def_old',NULL,'k1',1,'{}','sig','','basis',60,'Approved',NULL,NULL,NULL,NULL,NULL);
    INSERT INTO drawing_symbol_occurrences VALUES('occ_old_2','v1_old','def_old',NULL,'k2',1,'{}','sig','','basis',60,'Approved',NULL,NULL,NULL,NULL,NULL);
    INSERT INTO drawing_symbol_occurrences VALUES('occ_old_3','v1_old','def_old',NULL,'k3',1,'{}','sig','','basis',60,'Approved',NULL,NULL,NULL,NULL,NULL);
    INSERT INTO drawing_symbol_occurrences VALUES('occ_new_1','v2_current','def_new',NULL,'k1',1,'{}','sig','','basis',60,'Approved',NULL,NULL,NULL,NULL,NULL);
  `);
  const env = { DB: d1(sql) };
  const body = await (await handleDrawingQuantityEvidenceApi(req("/api/documents/doc_1/drawing-quantity-evidence"), env)).json();
  assert.equal(body.recognitionVersionId, "v2_current", "the stale superseded version must never be used as the current source");
  assert.equal(body.totalApprovedOccurrenceCount, 1, "the 3 approved occurrences on the stale superseded version must not be counted");
});

test("worker: coverage state is governed (requires a substantive reason), append-only, and defaults to Partial", async () => {
  const sql = fixture();
  sql.exec(`INSERT INTO drawing_symbol_recognition_versions VALUES('v1','project_1','doc_1',1,NULL);`);
  const env = { DB: d1(sql) };
  const initial = await (await handleDrawingQuantityEvidenceApi(req("/api/documents/doc_1/drawing-quantity-evidence"), env)).json();
  assert.equal(initial.coverageState, DEFAULT_COVERAGE_STATE);

  const rejectedShortReason = await handleDrawingQuantityEvidenceApi(
    req("/api/documents/doc_1/drawing-quantity-evidence/coverage", {
      method: "POST",
      body: JSON.stringify({ coverageState: "Reviewed Sheet", reason: "ok" }),
    }),
    env,
  );
  assert.equal(rejectedShortReason.status, 422);

  const set1 = await handleDrawingQuantityEvidenceApi(
    req("/api/documents/doc_1/drawing-quantity-evidence/coverage", {
      method: "POST",
      body: JSON.stringify({ coverageState: "Reviewed Sheet", reason: "Engineer reviewed sheet EL-2L0-1253000 in full" }),
    }),
    env,
  );
  assert.equal((await set1.json()).coverageState, "Reviewed Sheet");

  const set2 = await handleDrawingQuantityEvidenceApi(
    req("/api/documents/doc_1/drawing-quantity-evidence/coverage", {
      method: "POST",
      body: JSON.stringify({ coverageState: "Reviewed Drawing Set", reason: "All sheets in this drawing set have now been reviewed" }),
    }),
    env,
  );
  assert.equal((await set2.json()).coverageState, "Reviewed Drawing Set");

  const rows = await sql.prepare("SELECT coverage_state FROM drawing_quantity_evidence_coverage ORDER BY rowid").all();
  assert.equal(rows.length, 2, "coverage history must be append-only -- the previous decision must remain a real historical row, never mutated in place");
  assert.deepEqual(
    rows.map((r) => r.coverage_state),
    ["Reviewed Sheet", "Reviewed Drawing Set"],
  );
});

test("worker: an invalid coverage state is rejected", async () => {
  const sql = fixture();
  sql.exec(`INSERT INTO drawing_symbol_recognition_versions VALUES('v1','project_1','doc_1',1,NULL);`);
  const env = { DB: d1(sql) };
  const response = await handleDrawingQuantityEvidenceApi(
    req("/api/documents/doc_1/drawing-quantity-evidence/coverage", {
      method: "POST",
      body: JSON.stringify({ coverageState: "Definitely Complete", reason: "engineer says so, trust me" }),
    }),
    env,
  );
  assert.equal(response.status, 422);
});

test("worker: BOQ comparison via /compare uses the real governed link and real coverage state, never a false conflict under partial coverage", async () => {
  const sql = fixture();
  sql.exec(`
    INSERT INTO drawing_symbol_recognition_versions VALUES('v1','project_1','doc_1',1,NULL);
    INSERT INTO drawing_symbol_definitions VALUES('def_re','project_1','v1','def_re','RE','CEILING MOUNTED DOME CAMERA');
    INSERT INTO drawing_symbol_occurrences VALUES('occ1','v1','def_re',NULL,'k1',1,'{}','sig','','basis',60,'Approved',NULL,NULL,NULL,NULL,NULL);
    INSERT INTO drawing_symbol_occurrences VALUES('occ2','v1','def_re',NULL,'k2',1,'{}','sig','','basis',60,'Approved',NULL,NULL,NULL,NULL,NULL);
    INSERT INTO boq_items VALUES('boq_1','project_1','4');
    INSERT INTO estimator_understanding_review_versions VALUES('rev_1','project_1','boq_1',1,'APPROVED','${JSON.stringify({ system: "CCTV", productFamily: "Dome Camera" }).replace(/'/g, "''")}');
  `);
  const env = { DB: d1(sql) };
  const response = await handleDrawingQuantityEvidenceApi(
    req("/api/documents/doc_1/drawing-quantity-evidence/compare?definitionKey=def_re&boqItemId=boq_1"),
    env,
  );
  const body = await response.json();
  assert.equal(body.comparison.status, "PARTIAL DRAWING EVIDENCE / Needs Review", "default Partial coverage with a 2-vs-4 mismatch must never be reported as a real conflict");
  assert.equal(body.comparison.drawingQuantity, 2);
  assert.equal(body.comparison.boqQuantity, 4);

  await handleDrawingQuantityEvidenceApi(
    req("/api/documents/doc_1/drawing-quantity-evidence/coverage", {
      method: "POST",
      body: JSON.stringify({ coverageState: "Reviewed Drawing Set", reason: "All sheets in this drawing set have now been reviewed" }),
    }),
    env,
  );
  const afterCoverage = await (
    await handleDrawingQuantityEvidenceApi(req("/api/documents/doc_1/drawing-quantity-evidence/compare?definitionKey=def_re&boqItemId=boq_1"), env)
  ).json();
  assert.equal(afterCoverage.comparison.status, "Quantity Conflict — Needs Review", "the same mismatch under conclusive coverage is now a real, reportable conflict");
});

test("worker: BOQ comparison with no APPROVED estimator understanding review is 'No governed link', never a fabricated comparison", async () => {
  const sql = fixture();
  sql.exec(`
    INSERT INTO drawing_symbol_recognition_versions VALUES('v1','project_1','doc_1',1,NULL);
    INSERT INTO drawing_symbol_definitions VALUES('def_re','project_1','v1','def_re','RE','CEILING MOUNTED DOME CAMERA');
    INSERT INTO drawing_symbol_occurrences VALUES('occ1','v1','def_re',NULL,'k1',1,'{}','sig','','basis',60,'Approved',NULL,NULL,NULL,NULL,NULL);
    INSERT INTO boq_items VALUES('boq_1','project_1','4');
  `);
  const env = { DB: d1(sql) };
  const body = await (
    await handleDrawingQuantityEvidenceApi(req("/api/documents/doc_1/drawing-quantity-evidence/compare?definitionKey=def_re&boqItemId=boq_1"), env)
  ).json();
  assert.equal(body.comparison.status, "No governed link");
  assert.equal(body.comparison.comparable, false);
});

// ============================================================
// Real proof case: the two known real approved RE (Ceiling Mounted Dome
// Camera) occurrences from the real Opera CCTV floor plan, approved through
// the REAL occurrence review endpoint, then counted through the REAL
// quantity evidence endpoint. This is a proof of the mechanism on one real
// case -- NOT a claim of sheet-wide recall (Stage 5.6 left that unknown).
// ============================================================

test("real Opera CCTV floor plan: the two known real RE occurrences, once approved, produce Approved Drawing Quantity Evidence = 2 with a real CCTV/Cameras/Dome Camera knowledge handoff", async (t) => {
  const legendPath =
    "/Users/serein-b/Downloads/Projects/Opera Block Townhouses-Diriyah/Data/Low Current/28.05 - CCTV System/DWG/00.General/BV-BSW-127-0000-OMR-DWG-SE-100-0000003-A.pdf";
  const layoutPath =
    "/Users/serein-b/Downloads/Projects/Opera Block Townhouses-Diriyah/Data/Low Current/28.05 - CCTV System/DWG/01.Security/BV-BSW-127-0000-OMR-DWG-SE-2L0-2100050-A.pdf";
  if (!fs.existsSync(legendPath) || !fs.existsSync(layoutPath)) return t.skip("real Opera project source unavailable on this machine");
  const approvedRowsFrom = (structure) =>
    structure.legendRows.map((row, index) => ({
      id: `approvedRow${index}`,
      source_page: row.sourcePage,
      symbol_geometry: row.symbolGeometry,
      bounding_box: row.boundingBox,
      abbreviation: row.abbreviation,
      description: row.description,
      notes: row.notes,
      structural_confidence: row.confidence,
    }));
  const structure = await parseDrawingStructure(new Uint8Array(await readFile(legendPath)));
  const recognition = await recognizeDrawingSymbols(new Uint8Array(await readFile(layoutPath)), { approvedStructuralRows: approvedRowsFrom(structure) });
  const knownPositives = [
    { x: 1725.76, y: 1293.77 },
    { x: 1725.76, y: 1370.31 },
  ];
  const targets = knownPositives.map((known) => {
    const occurrence = recognition.occurrences.find((o) => Math.abs(o.boundingBox.x - known.x) < 1 && Math.abs(o.boundingBox.y - known.y) < 1);
    assert.ok(occurrence, `known real occurrence near (${known.x},${known.y}) must be present in this recognition run`);
    return occurrence;
  });

  const sql = fixture();
  sql.exec(`INSERT INTO drawing_symbol_recognition_versions VALUES('v1','project_1','doc_1',1,NULL);`);
  const defRow = recognition.definitions.find((d) => d.definitionKey === targets[0].matchedDefinitionKey);
  sql
    .prepare("INSERT INTO drawing_symbol_definitions VALUES(?,?,?,?,?,?)")
    .run("def_re", "project_1", "v1", defRow.definitionKey, defRow.abbreviation, defRow.description);
  for (const occurrence of targets)
    sql
      .prepare(
        "INSERT INTO drawing_symbol_occurrences VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        `occ_${occurrence.occurrenceKey}`,
        "v1",
        "def_re",
        null,
        occurrence.occurrenceKey,
        occurrence.pageNumber,
        JSON.stringify(occurrence.boundingBox),
        occurrence.shapeSignature || "fuzzy",
        occurrence.nearbyText || "",
        occurrence.matchBasis,
        occurrence.confidence,
        "Needs Review",
        null,
        null,
        null,
        null,
        null,
      );
  const env = { DB: d1(sql) };

  // Before review: nothing counts yet -- candidates are never truth.
  const beforeReview = await (await handleDrawingQuantityEvidenceApi(req("/api/documents/doc_1/drawing-quantity-evidence"), env)).json();
  assert.equal(beforeReview.totalApprovedOccurrenceCount, 0, "unreviewed candidates must never count as quantity evidence");

  // Real governed approval through the real occurrence review endpoint.
  for (const occurrence of targets) {
    const row = await sql.prepare("SELECT id FROM drawing_symbol_occurrences WHERE occurrence_key=?").get(occurrence.occurrenceKey);
    const response = await handleDrawingSymbolRecognitionApi(
      req(`/api/symbol-occurrences/${row.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ reason: "Visually confirmed as a real ceiling-mounted dome camera against the source PDF" }),
      }),
      { DB: d1(sql), FILES: {} },
    );
    assert.equal(response.status, 200);
  }

  const afterReview = await (await handleDrawingQuantityEvidenceApi(req("/api/documents/doc_1/drawing-quantity-evidence"), env)).json();
  assert.equal(afterReview.totalApprovedOccurrenceCount, 2, '"2 approved Ceiling Mounted Dome Camera occurrences were observed" must be provable end to end');
  const reGroup = afterReview.groups.find((g) => g.abbreviation === "RE");
  assert.ok(reGroup);
  assert.equal(reGroup.approvedOccurrenceCount, 2);
  assert.equal(reGroup.system, "CCTV", "the knowledge handoff must resolve RE -> CCTV through the real System Knowledge Registry");
  assert.ok(reGroup.families.some((f) => f.family === "Dome Camera"));
  assert.equal(reGroup.approvedOccurrences.length, 2, "every approved occurrence id must be preserved behind the aggregate, never opaque");
});

// ============================================================
// UI: primary display must say evidence/coverage, never claim an
// authoritative device count.
// ============================================================

test("UI never claims drawing evidence is an authoritative device count", () => {
  assert.match(ui, /Drawing Quantity Evidence/i);
  assert.match(ui, /Coverage/);
  assert.match(ui, /approved occurrences?/i);
  assert.doesNotMatch(ui, /There are \d+ .* in the project/i);
});
