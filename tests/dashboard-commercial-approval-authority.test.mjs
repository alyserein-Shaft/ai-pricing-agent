import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { collectProjectFacts } from "../worker/dashboard-api.mjs";

const PROJECT_ID = "project-dashboard-commercial-authority";
const SCENARIO_ID = "scenario-current";

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (args = []) => ({
      first: async () => raw.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
      run: async () => raw.prepare(sql).run(...args),
    });
    return {
      ...operation(),
      bind(...args) {
        return operation(args);
      },
    };
  },
});

const fixture = () => {
  const raw = new DatabaseSync(":memory:");

  raw.exec(`
    CREATE TABLE project_dashboard_profiles (
      project_id TEXT PRIMARY KEY,
      selected_pricing_scenario_id TEXT,
      deleted_at TEXT
    );

    CREATE TABLE documents (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      archived_at TEXT,
      deleted_at TEXT,
      current_version_id TEXT
    );

    CREATE TABLE document_classifications (
      document_id TEXT,
      superseded_at TEXT,
      status TEXT
    );

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
      superseded_at TEXT
    );

    CREATE TABLE boq_items (
      id TEXT PRIMARY KEY,
      extraction_version_id TEXT,
      project_id TEXT,
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
      superseded_at TEXT,
      candidate_count INTEGER
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

    INSERT INTO project_dashboard_profiles (
      project_id, selected_pricing_scenario_id, deleted_at
    ) VALUES (
      '${PROJECT_ID}', '${SCENARIO_ID}', NULL
    );

    INSERT INTO boq_extraction_versions (id, superseded_at)
    VALUES ('boq-version-current', NULL);

    INSERT INTO boq_items (
      id, extraction_version_id, project_id, row_type,
      review_status, approved_for_downstream
    ) VALUES (
      'boq-1',
      'boq-version-current',
      '${PROJECT_ID}',
      'BOQ Item',
      'Approved',
      1
    );

    INSERT INTO pricing_runs (
      id, project_id, scenario_id, version_number, superseded_at
    ) VALUES (
      'pricing-run-1',
      '${PROJECT_ID}',
      '${SCENARIO_ID}',
      1,
      NULL
    );

    INSERT INTO pricing_lines (
      id, pricing_run_id, project_id, boq_item_id,
      approval_ready, status
    ) VALUES (
      'pricing-line-1',
      'pricing-run-1',
      '${PROJECT_ID}',
      'boq-1',
      1,
      'Calculated'
    );

    INSERT INTO pricing_approvals (
      id, pricing_run_id, approval_type, status, created_at, decided_at
    ) VALUES
      (
        'approval-old',
        'pricing-run-1',
        'Commercial Price',
        'Approved',
        '2026-08-10T10:00:00Z',
        '2026-08-10T10:00:00Z'
      ),
      (
        'rejection-latest',
        'pricing-run-1',
        'Commercial Price',
        'Rejected',
        '2026-08-10T11:00:00Z',
        '2026-08-10T11:00:00Z'
      );
  `);

  return { raw, db: d1(raw) };
};

test("dashboard facts use the latest commercial decision rather than any historical approval", async () => {
  const { raw, db } = fixture();

  const facts = await collectProjectFacts(db, PROJECT_ID);

  assert.equal(facts.pricedItems, 1);
  assert.equal(facts.commercialApproved, 0);
  assert.equal(facts.commercialPending, 1);

  raw.close();
});
