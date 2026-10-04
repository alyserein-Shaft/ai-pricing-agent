import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { handleDrawingExtractionApi } from "../worker/drawing-extraction-api.mjs";

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (values = []) => ({
      first: async () => raw.prepare(sql).get(...values) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...values) }),
      run: async () => raw.prepare(sql).run(...values),
    });
    return { ...operation(), bind: (...values) => operation(values) };
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
CREATE TABLE drawing_intake_versions(id TEXT PRIMARY KEY, project_id TEXT, document_id TEXT, document_version_id TEXT, version_number INTEGER, status TEXT, summary TEXT, review_status TEXT, superseded_at TEXT, created_by TEXT, created_at TEXT);
CREATE TABLE drawing_pages(id TEXT PRIMARY KEY, intake_version_id TEXT, page_number INTEGER, width REAL, height REAL);
CREATE TABLE drawing_assets(id TEXT PRIMARY KEY, intake_version_id TEXT, page_id TEXT, asset_type TEXT, text_content TEXT, bounding_box TEXT, coordinates_available INTEGER, detection_confidence INTEGER, detection_method TEXT, review_status TEXT, created_at TEXT);
CREATE TABLE drawing_document_classifications(id TEXT PRIMARY KEY, intake_version_id TEXT, classification_type TEXT, confidence INTEGER);
CREATE TABLE drawing_metadata(id TEXT PRIMARY KEY, intake_version_id TEXT, drawing_number TEXT, revision TEXT, sheet_name TEXT);
CREATE TABLE drawing_legends(id TEXT PRIMARY KEY, intake_version_id TEXT, page_id TEXT, confidence INTEGER);
CREATE TABLE drawing_legend_entries(id TEXT PRIMARY KEY, legend_id TEXT, sequence INTEGER, entry_type TEXT, label TEXT, description TEXT, confidence INTEGER);
CREATE TABLE drawing_extraction_proposals(id TEXT PRIMARY KEY, project_id TEXT, document_id TEXT, intake_version_id TEXT, page_number INTEGER, proposal_key TEXT, proposal_type TEXT, raw_label TEXT, normalized_value TEXT, bounding_box TEXT, confidence INTEGER, authority_role TEXT, governed_status TEXT, hard_review_reasons TEXT, evidence TEXT, source_references TEXT, extraction_method TEXT, extraction_version TEXT, review_status TEXT, created_at TEXT, updated_at TEXT);
CREATE UNIQUE INDEX drawing_extraction_proposal_key_idx ON drawing_extraction_proposals(intake_version_id, proposal_key);
CREATE TABLE drawing_extraction_review_events(id TEXT PRIMARY KEY, project_id TEXT, document_id TEXT, proposal_id TEXT, action TEXT, previous_value TEXT, new_value TEXT, reason TEXT, actor_user_id TEXT, request_id TEXT, created_at TEXT);
CREATE TABLE drawing_visual_runs(id TEXT PRIMARY KEY, project_id TEXT, document_id TEXT, document_version_id TEXT, intake_version_id TEXT, page_number INTEGER, status TEXT, input_manifest TEXT, raw_responses TEXT, result TEXT, model_info TEXT, created_at TEXT, completed_at TEXT, superseded_at TEXT, superseded_by_run_id TEXT, error_code TEXT);
`;

const request = (path, method = "POST") => new Request(`https://app.example${path}`, {
  method,
  headers: { "content-type": "application/json" },
});

const seedMultiLegendDocument = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  raw.exec(`
    INSERT INTO projects VALUES ('p1','owner1','org1','Test',NULL);
    INSERT INTO documents VALUES ('doc1','p1','Drawing','Manual/Unclassified','dv1',NULL,NULL);
    INSERT INTO document_versions VALUES ('dv1','doc1',1,'legend.pdf','pdf','sha1','obj1',NULL);
    INSERT INTO drawing_intake_versions VALUES ('iv1','p1','doc1','dv1',1,'Completed','{}','Needs Review',NULL,'owner1',CURRENT_TIMESTAMP);
    INSERT INTO drawing_pages VALUES ('page-1','iv1',1,1000,1000);
    INSERT INTO drawing_pages VALUES ('page-2','iv1',2,1000,1000);
    INSERT INTO drawing_document_classifications VALUES ('class-1','iv1','Legend Sheet',95);
    INSERT INTO drawing_metadata VALUES ('meta-1','iv1','FA-T-00','0','FIRE ALARM LEGEND');
    INSERT INTO drawing_legends VALUES ('legend-1','iv1','page-1',91);
    INSERT INTO drawing_legends VALUES ('legend-2','iv1','page-2',87);
    INSERT INTO drawing_legend_entries VALUES ('entry-1','legend-1',1,'Abbreviation','SD','SMOKE DETECTOR',90);
    INSERT INTO drawing_legend_entries VALUES ('entry-2','legend-1',2,'Abbreviation','HD','HEAT DETECTOR',89);
    INSERT INTO drawing_legend_entries VALUES ('entry-3','legend-2',1,'Abbreviation','MCP','MANUAL CALL POINT',86);
  `);
  return { raw, env: { DB: d1(raw), APP_ACCESS_MODE: "single-user", APP_USER_ID: "owner1", APP_ORGANIZATION_ID: "org1" } };
};

test("drawing-multi-legend: sync retains every current intake legend entry on its defining page", async () => {
  const { raw, env } = seedMultiLegendDocument();

  const response = await handleDrawingExtractionApi(request("/api/documents/doc1/drawing-extraction/sync"), env);
  assert.equal(response.status, 201);

  const definitions = raw.prepare("SELECT page_number,raw_label,confidence,authority_role,governed_status FROM drawing_extraction_proposals WHERE proposal_type='Legend Definition' ORDER BY page_number,raw_label").all();
  assert.deepEqual(definitions.map((row) => [row.page_number, row.raw_label, row.confidence]), [
    [1, "HD", 91],
    [1, "SD", 91],
    [2, "MCP", 87],
  ]);
  assert.ok(definitions.every((row) => row.authority_role === "Primary"), "legend evidence keeps Primary authority");
  assert.ok(definitions.every((row) => row.governed_status === "Verified"), "same-sheet legend definitions keep Verified governance");
});
