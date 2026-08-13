import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { collectProjectFacts } from "../worker/dashboard-api.mjs";

const PROJECT_ID = "project-dashboard-technical-authority";

const fixture = () => {
  const raw = new DatabaseSync(":memory:");

  raw.exec(`
    CREATE TABLE documents (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      current_version_id TEXT,
      archived_at TEXT
    );

    CREATE TABLE projects (id TEXT PRIMARY KEY, organization_id TEXT, archived_at TEXT);

    CREATE TABLE document_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT
    );

    CREATE TABLE document_processing_runs (
      id TEXT PRIMARY KEY,
      document_version_id TEXT,
      stage TEXT,
      status TEXT,
      created_at TEXT
    );

    CREATE TABLE boq_extraction_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT,
      document_version_id TEXT,
      version_number INTEGER,
      status TEXT,
      superseded_at TEXT
    );

    CREATE TABLE boq_items (
      id TEXT PRIMARY KEY,
      extraction_version_id TEXT,
      project_id TEXT,
      source_document_id TEXT,
      row_type TEXT,
      review_status TEXT,
      approved_for_downstream INTEGER
    );

    CREATE TABLE specification_extraction_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT,
      superseded_at TEXT,
      status TEXT
    );

    CREATE TABLE requirement_profile_versions (
      id TEXT PRIMARY KEY,
      boq_item_id TEXT,
      project_id TEXT,
      superseded_at TEXT,
      readiness_status TEXT,
      approved_for_matching INTEGER
    );

    CREATE TABLE product_match_runs (
      id TEXT PRIMARY KEY,
      boq_item_id TEXT,
      project_id TEXT,
      version_number INTEGER,
      candidate_count INTEGER,
      superseded_at TEXT
    );

    CREATE TABLE safety_decisions (
      id TEXT PRIMARY KEY,
      boq_item_id TEXT,
      project_id TEXT,
      superseded_at TEXT
    );

    CREATE TABLE safety_approval_requests (
      id TEXT PRIMARY KEY,
      safety_decision_id TEXT,
      approval_type TEXT,
      status TEXT,
      decided_at TEXT
    );

    CREATE TABLE project_dashboard_profiles (
      project_id TEXT PRIMARY KEY,
      selected_pricing_scenario_id TEXT,
      deleted_at TEXT
    );

    CREATE TABLE pricing_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      scenario_id TEXT,
      version_number INTEGER,
      superseded_at TEXT
    );

    CREATE TABLE pricing_lines (
      id TEXT PRIMARY KEY,
      pricing_run_id TEXT,
      project_id TEXT,
      boq_item_id TEXT,
      approval_ready INTEGER,
      status TEXT
    );

    CREATE TABLE pricing_approvals (
      id TEXT PRIMARY KEY,
      pricing_run_id TEXT,
      approval_type TEXT,
      status TEXT,
      created_at TEXT,
      decided_at TEXT
    );

    CREATE TABLE review_queue_items (
      id TEXT PRIMARY KEY,
      boq_item_id TEXT,
      project_id TEXT,
      review_type TEXT,
      deleted_at TEXT,
      status TEXT,
      blocking INTEGER,
      updated_at TEXT
    );

    CREATE TABLE review_clarifications (
      id TEXT PRIMARY KEY,
      review_item_id TEXT,
      project_id TEXT,
      status TEXT
    );

    CREATE TABLE safety_blocks (
      id TEXT PRIMARY KEY,
      safety_decision_id TEXT,
      status TEXT
    );

    CREATE TABLE excel_export_jobs (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      status TEXT,
      cancelled_at TEXT
    );

    INSERT INTO projects VALUES ('${PROJECT_ID}','org',NULL);
    INSERT INTO documents (id,project_id,current_version_id,archived_at) VALUES ('doc-1','${PROJECT_ID}','doc-version-1',NULL);
    INSERT INTO document_versions VALUES ('doc-version-1','doc-1');
    INSERT INTO boq_extraction_versions (id,document_id,document_version_id,version_number,status,superseded_at)
    VALUES ('boq-current-version','doc-1','doc-version-1',1,'Completed',NULL);

    INSERT INTO boq_items (
      id, extraction_version_id, project_id, source_document_id, row_type,
      review_status, approved_for_downstream
    ) VALUES (
      'boq-1',
      'boq-current-version',
      '${PROJECT_ID}',
      'doc-1',
      'BOQ Item',
      'Approved',
      1
    );

    INSERT INTO product_match_runs (
      id, boq_item_id, project_id, version_number,
      candidate_count, superseded_at
    ) VALUES (
      'match-run-1',
      'boq-1',
      '${PROJECT_ID}',
      1,
      1,
      NULL
    );

    INSERT INTO safety_decisions (
      id, boq_item_id, project_id, superseded_at
    ) VALUES (
      'safety-1',
      'boq-1',
      '${PROJECT_ID}',
      NULL
    );

    INSERT INTO safety_approval_requests (
      id, safety_decision_id, approval_type, status, decided_at
    ) VALUES
      (
        'technical-approved-old',
        'safety-1',
        'Technical',
        'Approved',
        '2026-08-10T10:00:00Z'
      ),
      (
        'technical-rejected-latest',
        'safety-1',
        'Technical',
        'Rejected',
        '2026-08-10T11:00:00Z'
      );
  `);

    raw.exec("ALTER TABLE documents ADD COLUMN deleted_at TEXT");

const operation = (sql, args = []) => ({
    first: async () => raw.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: raw.prepare(sql).all(...args) }),
    run: async () => raw.prepare(sql).run(...args),
  });

  const db = {
    prepare(sql) {
      return {
        ...operation(sql),
        bind: (...args) => operation(sql, args),
      };
    },
  };

  return { raw, db };
};

test("dashboard technical facts use the latest technical decision rather than any historical approval", async () => {
  const { raw, db } = fixture();

  const facts = await collectProjectFacts(db, PROJECT_ID);

  assert.equal(facts.boqItems, 1);
  assert.equal(facts.technicalApproved, 0);
  assert.equal(facts.technicalPending, 1);

  raw.close();
});
