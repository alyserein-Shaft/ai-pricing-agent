import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { loadExportData } from "../worker/excel-export-api.mjs";

const PROJECT_ID = "project-excel-commercial-authority";
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

    CREATE TABLE pricing_scenarios (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      name TEXT,
      project_currency TEXT,
      deleted_at TEXT,
      superseded_at TEXT
    );

    CREATE TABLE pricing_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      scenario_id TEXT,
      version_number INTEGER,
      superseded_at TEXT
    );

    CREATE TABLE boq_extraction_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT,
      version_number INTEGER,
      superseded_at TEXT
    );

    CREATE TABLE boq_items (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      extraction_version_id TEXT,
      row_type TEXT,
      sequence INTEGER,
      original_quantity TEXT,
      description TEXT,
      unit TEXT,
      source_location TEXT
    );

    CREATE TABLE documents (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      logical_name TEXT,
      archived_at TEXT
    );

    CREATE TABLE product_match_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      boq_item_id TEXT,
      version_number INTEGER,
      superseded_at TEXT
    );

    CREATE TABLE product_match_candidates (
      id TEXT PRIMARY KEY,
      match_run_id TEXT,
      product_id TEXT,
      rank INTEGER,
      confidence_score REAL,
      explanation TEXT
    );

    CREATE TABLE canonical_library_products (
      requested_product_id TEXT PRIMARY KEY,
      manufacturer_id TEXT,
      brand_id TEXT,
      family_id TEXT,
      part_number TEXT,
      description TEXT,
      lifecycle_status TEXT
    );

    CREATE TABLE product_manufacturers (
      id TEXT PRIMARY KEY,
      name TEXT
    );

    CREATE TABLE product_brands (
      id TEXT PRIMARY KEY,
      name TEXT
    );

    CREATE TABLE product_families (
      id TEXT PRIMARY KEY,
      name TEXT
    );

    CREATE TABLE pricing_lines (
      id TEXT PRIMARY KEY,
      pricing_run_id TEXT,
      project_id TEXT,
      boq_item_id TEXT,
      selected_price_record_id TEXT,
      safety_decision_id TEXT,
      output TEXT,
      material_total_minor INTEGER,
      total_cost_minor INTEGER,
      margin_basis_points INTEGER,
      markup_basis_points INTEGER
    );

    CREATE TABLE price_records (
      id TEXT PRIMARY KEY,
      source_id TEXT,
      supplier_id TEXT,
      price_type TEXT,
      currency TEXT,
      amount_minor INTEGER,
      effective_from TEXT,
      valid_until TEXT,
      source_location TEXT
    );

    CREATE TABLE product_sources (
      id TEXT PRIMARY KEY,
      file_name TEXT
    );

    CREATE TABLE suppliers (
      id TEXT PRIMARY KEY,
      name TEXT
    );

    CREATE TABLE safety_decisions (
      id TEXT PRIMARY KEY,
      safety_state TEXT,
      compliance_state TEXT,
      technical_eligibility TEXT,
      missing_information TEXT
    );

    CREATE TABLE safety_approval_requests (
      id TEXT PRIMARY KEY,
      safety_decision_id TEXT,
      approval_type TEXT,
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

    CREATE TABLE pricing_cost_components (
      id TEXT PRIMARY KEY,
      pricing_line_id TEXT,
      component_type TEXT,
      description TEXT,
      method TEXT,
      formula TEXT,
      rate REAL,
      quantity REAL,
      amount_minor INTEGER,
      source TEXT,
      assumptions TEXT,
      approval_status TEXT
    );

    CREATE TABLE pricing_discount_applications (
      id TEXT PRIMARY KEY,
      pricing_line_id TEXT,
      discount_type TEXT,
      percentage_basis_points INTEGER
    );

    CREATE TABLE review_queue_items (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      boq_item_id TEXT,
      review_type TEXT,
      status TEXT,
      approval_level TEXT,
      escalation_status TEXT,
      version_number INTEGER,
      deleted_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE review_decisions (
      id TEXT PRIMARY KEY,
      review_item_id TEXT,
      decision_type TEXT,
      outcome TEXT,
      decided_by TEXT,
      decided_role TEXT,
      decided_at TEXT,
      reason TEXT,
      conditions TEXT,
      evidence TEXT,
      notes TEXT
    );

    CREATE TABLE review_clarifications (
      id TEXT PRIMARY KEY,
      review_item_id TEXT,
      project_id TEXT,
      created_at TEXT
    );

    CREATE TABLE requirement_profile_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      boq_item_id TEXT,
      version_number INTEGER,
      approved_for_matching INTEGER,
      superseded_at TEXT
    );

    INSERT INTO project_dashboard_profiles (
      project_id, selected_pricing_scenario_id, deleted_at
    ) VALUES (
      '${PROJECT_ID}', '${SCENARIO_ID}', NULL
    );

    INSERT INTO pricing_scenarios (
      id, project_id, name, project_currency, deleted_at, superseded_at
    ) VALUES (
      '${SCENARIO_ID}', '${PROJECT_ID}', 'Current Scenario', 'SAR', NULL, NULL
    );

    INSERT INTO documents (
      id, project_id, logical_name, archived_at
    ) VALUES (
      'doc-1', '${PROJECT_ID}', 'BOQ.xlsx', NULL
    );

    INSERT INTO boq_extraction_versions (
      id, document_id, version_number, superseded_at
    ) VALUES (
      'boq-version-1', 'doc-1', 1, NULL
    );

    INSERT INTO boq_items (
      id, project_id, extraction_version_id, row_type,
      sequence, original_quantity, description, unit, source_location
    ) VALUES (
      'boq-1', '${PROJECT_ID}', 'boq-version-1', 'BOQ Item',
      1, '1', 'Smoke detector', 'EA', '{}'
    );

    INSERT INTO pricing_runs (
      id, project_id, scenario_id, version_number, superseded_at
    ) VALUES (
      'run-1', '${PROJECT_ID}', '${SCENARIO_ID}', 1, NULL
    );

    INSERT INTO pricing_lines (
      id, pricing_run_id, project_id, boq_item_id,
      output, material_total_minor, total_cost_minor,
      margin_basis_points, markup_basis_points
    ) VALUES (
      'line-1', 'run-1', '${PROJECT_ID}', 'boq-1',
      '{}', 10000, 10000, 2000, 2500
    );

    INSERT INTO pricing_approvals (
      id, pricing_run_id, approval_type, status, created_at, decided_at
    ) VALUES
      (
        'approval-old',
        'run-1',
        'Commercial Price',
        'Approved',
        '2026-08-10T10:00:00Z',
        '2026-08-10T10:00:00Z'
      ),
      (
        'rejection-latest',
        'run-1',
        'Commercial Price',
        'Rejected',
        '2026-08-10T11:00:00Z',
        '2026-08-10T11:00:00Z'
      );
  `);

  return { raw, db: d1(raw) };
};

test("Excel export uses the latest commercial decision rather than any historical approval", async () => {
  const { raw, db } = fixture();

  const data = await loadExportData(
    db,
    PROJECT_ID,
    "Commercial Review Cost Sheet"
  );

  assert.equal(data.rows.length, 1);
  assert.equal(data.rows[0].commercialApprovalStatus, "Rejected");

  raw.close();
});
