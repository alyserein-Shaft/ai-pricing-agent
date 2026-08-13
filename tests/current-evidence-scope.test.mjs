import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { currentBoqEvidenceCounts, diagnoseBoqEvidence } from "../worker/current-evidence-scope.mjs";

const d1 = (sqlite) => ({
  prepare(sql) {
    let values = [];
    return {
      bind(...next) { values = next; return this; },
      first() { return sqlite.prepare(sql).get(...values); },
      all() { return { results: sqlite.prepare(sql).all(...values) }; },
    };
  },
});

function fixture() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`
    CREATE TABLE projects(id TEXT PRIMARY KEY,organization_id TEXT,archived_at TEXT);
    CREATE TABLE documents(id TEXT PRIMARY KEY,project_id TEXT,current_version_id TEXT,deleted_at TEXT,archived_at TEXT);
    CREATE TABLE document_versions(id TEXT PRIMARY KEY,document_id TEXT);
    CREATE TABLE boq_extraction_versions(id TEXT PRIMARY KEY,document_id TEXT,document_version_id TEXT,version_number INTEGER,status TEXT,superseded_at TEXT);
    CREATE TABLE boq_items(id TEXT PRIMARY KEY,extraction_version_id TEXT,project_id TEXT,source_document_id TEXT,row_type TEXT,review_status TEXT,approved_for_downstream INTEGER);
    INSERT INTO projects VALUES('project','org',NULL);
  `);
  const doc = sql.prepare("INSERT INTO documents VALUES(?,?,?,?,NULL)");
  const version = sql.prepare("INSERT INTO document_versions VALUES(?,?)");
  const extraction = sql.prepare("INSERT INTO boq_extraction_versions VALUES(?,?,?,?,?,?)");
  const item = sql.prepare("INSERT INTO boq_items VALUES(?,?,?,?,?,?,?)");
  const addGroup = ({ name, itemCount, structuralCount = 0, deleted = null, stale = false, superseded = false, status = "Completed", confirmed = 0 }) => {
    const documentId = `doc_${name}`, currentVersion = `version_${name}_current`, extractionVersion = stale ? `version_${name}_old` : currentVersion;
    doc.run(documentId, "project", currentVersion, deleted);
    version.run(currentVersion, documentId);
    if (stale) version.run(extractionVersion, documentId);
    extraction.run(`extraction_${name}`, documentId, extractionVersion, 1, status, superseded ? "2026-01-01" : null);
    for (let index = 0; index < itemCount; index += 1) item.run(`${name}_item_${index}`, `extraction_${name}`, "project", documentId, "BOQ Item", index < confirmed ? "Approved" : "Needs Review", index < confirmed ? 1 : 0);
    for (let index = 0; index < structuralCount; index += 1) item.run(`${name}_header_${index}`, `extraction_${name}`, "project", documentId, "Header", "Needs Review", 0);
  };
  addGroup({ name: "current", itemCount: 204, structuralCount: 47, confirmed: 4 });
  addGroup({ name: "deleted", itemCount: 173, deleted: "2026-08-01" });
  addGroup({ name: "stale", itemCount: 47, structuralCount: 32, stale: true });
  addGroup({ name: "superseded", itemCount: 47, structuralCount: 33, superseded: true });
  return sql;
}

test("authoritative scope reconciles 583 historical rows to 251 current rows", async () => {
  const sql = fixture();
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM boq_items").get().count, 583);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM boq_items WHERE row_type='BOQ Item'").get().count, 471);
  const counts = await currentBoqEvidenceCounts(d1(sql), { projectId: "project", organizationId: "org" });
  assert.deepEqual(counts, { currentExtractedRows: 251, currentBoqItems: 204, structuralRows: 47, extractionConfirmed: 4, extractionNeedsReview: 200 });
});

test("diagnostics preserve history and explain fail-closed exclusions", async () => {
  const sql = fixture();
  const rows = await diagnoseBoqEvidence(d1(sql), { projectId: "project", organizationId: "org" });
  const reasons = new Set(rows.map((row) => row.exclusionReason));
  assert.deepEqual([...reasons].sort(), ["current BOQ item", "deleted document", "stale document version", "structural row", "superseded extraction"].sort());
  assert.equal(rows.length, 583);
});

test("operational consumers import the shared scope instead of defining a weaker current extraction", () => {
  for (const file of [
    "dashboard-api.mjs", "product-matching-api.mjs", "estimator-understanding-api.mjs",
    "estimator-readiness-api.mjs", "project-pricing-learning-api.mjs", "quotation-evidence.mjs",
    "pricing-authority.mjs", "pricing-api.mjs", "review-workflow-api.mjs", "excel-export-api.mjs",
  ]) {
    const source = readFileSync(new URL(`../worker/${file}`, import.meta.url), "utf8");
    assert.match(source, /current-evidence-scope\.mjs/, `${file} must use the shared current-evidence scope`);
  }
  const authority = readFileSync(new URL("../worker/current-evidence-scope.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(authority, /583|471|251|204|Phase 6|Golden|\.xlsx/i);
});
