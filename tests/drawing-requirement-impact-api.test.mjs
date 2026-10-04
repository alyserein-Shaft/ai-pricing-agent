import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { handleDrawingRequirementImpactApi } from "../worker/drawing-requirement-impact-api.mjs";

// Stage 10 Section 10/11: a drawing's Requirement Impact is read LIVE from
// the same requirement_profile_versions rows Stage 9 already writes -- no
// new persisted drawing->BOQ-item mapping.

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
});

const req = (path) => new Request(`http://localhost${path}`);

const fixture = () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`
    CREATE TABLE projects(id TEXT PRIMARY KEY,owner_user_id TEXT,organization_id TEXT);
    CREATE TABLE documents(id TEXT PRIMARY KEY,project_id TEXT,deleted_at TEXT);
    CREATE TABLE boq_items(id TEXT PRIMARY KEY,item_number TEXT,description TEXT,numeric_quantity TEXT);
    CREATE TABLE requirement_profile_versions(id TEXT PRIMARY KEY,project_id TEXT,boq_item_id TEXT,readiness_status TEXT,profile TEXT,superseded_at TEXT);
    CREATE TABLE drawing_symbol_recognition_versions(id TEXT PRIMARY KEY,document_id TEXT,version_number INTEGER,superseded_at TEXT);
    INSERT INTO projects VALUES('project_1','local-development-user','organization_bd_shaft_internal_pilot');
    INSERT INTO documents VALUES('doc_1','project_1',NULL);
    INSERT INTO boq_items VALUES('boq_1','28.10','Dome Camera','24');
    INSERT INTO boq_items VALUES('boq_2','28.20','Manual Call Point','5');
  `);
  return sql;
};

const profileFor = ({ documentId, recognitionVersionId = "v1", conflict = false }) => JSON.stringify({
  boqItem: { system: "CCTV", productFamily: "Dome Camera" },
  consolidatedRequirements: [
    { normalizedRequirement: "CEILING MOUNTED DOME CAMERA", sources: [{ sourceType: "Drawing", source: { documentId, recognitionVersionId } }, { sourceType: "BOQ", source: {} }] },
  ],
  conflicts: conflict ? [{ attribute: "Family", technicalImpact: "Family disagreement", values: [{ value: "Dome Camera", source: { sourceType: "BOQ" } }, { value: "Bullet Camera", source: { sourceType: "Drawing" } }] }] : [],
});

test("a BOQ item with a governed Drawing-sourced requirement for this document is reported as linked", async () => {
  const sql = fixture();
  sql.exec(`INSERT INTO drawing_symbol_recognition_versions VALUES('v1','doc_1',1,NULL);`);
  sql.prepare("INSERT INTO requirement_profile_versions VALUES (?,?,?,?,?,NULL)").run("p1", "project_1", "boq_1", "Ready for Matching", profileFor({ documentId: "doc_1" }));
  const env = { DB: d1(sql) };
  const response = await handleDrawingRequirementImpactApi(req("/api/documents/doc_1/drawing-requirement-impact"), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].boqItemId, "boq_1");
  assert.equal(body.items[0].family, "Dome Camera");
  assert.equal(body.items[0].numericQuantity, 24);
  assert.equal(body.items[0].conflict, null);
  assert.equal(body.items[0].stale, false);
});

test("a BOQ item with a requirement profile for a DIFFERENT document is never reported as linked to this one", async () => {
  const sql = fixture();
  sql.exec(`INSERT INTO drawing_symbol_recognition_versions VALUES('v1','doc_1',1,NULL);`);
  sql.prepare("INSERT INTO requirement_profile_versions VALUES (?,?,?,?,?,NULL)").run("p1", "project_1", "boq_1", "Ready for Matching", profileFor({ documentId: "doc_other" }));
  const env = { DB: d1(sql) };
  const body = await (await handleDrawingRequirementImpactApi(req("/api/documents/doc_1/drawing-requirement-impact"), env)).json();
  assert.deepEqual(body.items, []);
});

test("a real family conflict on a linked item is surfaced directly", async () => {
  const sql = fixture();
  sql.exec(`INSERT INTO drawing_symbol_recognition_versions VALUES('v1','doc_1',1,NULL);`);
  sql.prepare("INSERT INTO requirement_profile_versions VALUES (?,?,?,?,?,NULL)").run("p1", "project_1", "boq_1", "Conflict Blocking", profileFor({ documentId: "doc_1", conflict: true }));
  const env = { DB: d1(sql) };
  const body = await (await handleDrawingRequirementImpactApi(req("/api/documents/doc_1/drawing-requirement-impact"), env)).json();
  assert.equal(body.items[0].conflict.attribute, "Family");
});

test("a linked item whose Drawing evidence points at a superseded recognition version is honestly reported stale", async () => {
  const sql = fixture();
  sql.exec(`
    INSERT INTO drawing_symbol_recognition_versions VALUES('v1_old','doc_1',1,'2026-09-01T00:00:00Z');
    INSERT INTO drawing_symbol_recognition_versions VALUES('v2_current','doc_1',2,NULL);
  `);
  sql.prepare("INSERT INTO requirement_profile_versions VALUES (?,?,?,?,?,NULL)").run("p1", "project_1", "boq_1", "Ready for Matching", profileFor({ documentId: "doc_1", recognitionVersionId: "v1_old" }));
  const env = { DB: d1(sql) };
  const body = await (await handleDrawingRequirementImpactApi(req("/api/documents/doc_1/drawing-requirement-impact"), env)).json();
  assert.equal(body.currentRecognitionVersionId, "v2_current");
  assert.equal(body.items[0].stale, true);
});

test("a superseded requirement profile version is never included", async () => {
  const sql = fixture();
  sql.exec(`INSERT INTO drawing_symbol_recognition_versions VALUES('v1','doc_1',1,NULL);`);
  sql.prepare("INSERT INTO requirement_profile_versions VALUES (?,?,?,?,?,?)").run("p1", "project_1", "boq_1", "Ready for Matching", profileFor({ documentId: "doc_1" }), "2026-09-01T00:00:00Z");
  const env = { DB: d1(sql) };
  const body = await (await handleDrawingRequirementImpactApi(req("/api/documents/doc_1/drawing-requirement-impact"), env)).json();
  assert.deepEqual(body.items, []);
});
