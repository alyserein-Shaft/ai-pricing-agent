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


test("Excel export uses the latest technical decision rather than any historical approval", async () => {
  const { raw, db } = fixture();

  const approvalColumns = raw
    .prepare("PRAGMA table_info(safety_approval_requests)")
    .all()
    .map((entry) => entry.name);

  for (const required of [
    "id",
    "safety_decision_id",
    "approval_type",
    "status",
  ]) {
    assert.ok(
      approvalColumns.includes(required),
      `known-good fixture must expose safety_approval_requests.${required}`,
    );
  }

  // The production authority orders by decided_at.
  // Add it only to this isolated fixture if the older known-good
  // fixture predates that metadata column.
  if (!approvalColumns.includes("decided_at")) {
    raw.exec(
      "ALTER TABLE safety_approval_requests ADD COLUMN decided_at TEXT"
    );
  }

  const pricingLineColumns = raw
    .prepare("PRAGMA table_info(pricing_lines)")
    .all()
    .map((entry) => entry.name);

  for (const required of ["id", "safety_decision_id"]) {
    assert.ok(
      pricingLineColumns.includes(required),
      `known-good Excel fixture must expose pricing_lines.${required}`,
    );
  }

  const pricingSelectColumns = [
    "id",
    ...(pricingLineColumns.includes("boq_item_id") ? ["boq_item_id"] : []),
    "safety_decision_id",
  ];

  const pricingLine = raw
    .prepare(
      `SELECT ${pricingSelectColumns.join(",")}
       FROM pricing_lines
       ORDER BY id
       LIMIT 1`
    )
    .get();

  assert.ok(
    pricingLine?.id,
    "known-good Excel fixture must contain a pricing line",
  );

  let safetyDecisionId = pricingLine.safety_decision_id;

  // The Commercial authority fixture does not need a durable safety link.
  // The Technical regression creates one only when required.
  if (!safetyDecisionId) {
    const safetyInfo = raw
      .prepare("PRAGMA table_info(safety_decisions)")
      .all();

    const safetyColumns = safetyInfo.map((entry) => entry.name);

    assert.ok(
      safetyColumns.includes("id"),
      "safety_decisions fixture must expose id",
    );

    // Do not assume candidate_id exists on pricing_lines.
    // If the safety table requires a candidate, use an existing governed
    // candidate from the fixture directly.
    const candidate =
      safetyColumns.includes("candidate_id")
        ? raw
            .prepare(
              "SELECT id FROM product_match_candidates ORDER BY id LIMIT 1"
            )
            .get()
        : null;

    const syntheticId = "safety-technical-authority";

    const valueForSafetyColumn = (column) => {
      const values = {
        id: syntheticId,
        project_id: PROJECT_ID,
        boq_item_id:
          pricingLineColumns.includes("boq_item_id")
            ? pricingLine.boq_item_id || null
            : null,
        candidate_id: candidate?.id || null,
        version_number: 1,
        safety_state: "Eligible",
        technical_eligibility: "Eligible",
        price_eligibility: "Eligible for Price Approval",
        confidence_level: "High",
        confidence_score: 1,
        confidence_basis_points: 10000,
        compliance_state: "Compliant",
        missing_information: "[]",
        confidence_components: "{}",
        ruleset_version: "fixture",
        created_by: "fixture",
        created_at: "2026-08-10T09:00:00Z",
        updated_at: "2026-08-10T09:00:00Z",
        superseded_at: null,
      };

      if (column in values) return values[column];

      const schema = safetyInfo.find((entry) => entry.name === column);

      if (schema?.dflt_value != null) return undefined;
      if (!schema?.notnull) return null;

      const type = String(schema?.type || "").toUpperCase();

      if (type.includes("INT")) return 1;
      if (
        type.includes("REAL") ||
        type.includes("NUM") ||
        type.includes("DEC")
      ) return 1;

      return "fixture";
    };

    const usedColumns = [];
    const usedValues = [];

    for (const column of safetyColumns) {
      const value = valueForSafetyColumn(column);

      // undefined => let SQLite use DEFAULT
      if (value === undefined) continue;

      usedColumns.push(column);
      usedValues.push(value);
    }

    raw.prepare(
      `INSERT INTO safety_decisions (${usedColumns.join(",")})
       VALUES (${usedColumns.map(() => "?").join(",")})`
    ).run(...usedValues);

    safetyDecisionId = syntheticId;

    raw.prepare(
      "UPDATE pricing_lines SET safety_decision_id=? WHERE id=?"
    ).run(safetyDecisionId, pricingLine.id);

    console.log(
      "FIXTURE: created and linked synthetic current safety decision",
    );
  }

  const safetyDecision = raw
    .prepare("SELECT id FROM safety_decisions WHERE id=?")
    .get(safetyDecisionId);

  assert.ok(
    safetyDecision?.id,
    "pricing line must resolve to a durable safety decision",
  );

  assert.equal(
    raw
      .prepare("SELECT safety_decision_id FROM pricing_lines WHERE id=?")
      .get(pricingLine.id)?.safety_decision_id,
    safetyDecisionId,
    "pricing line must persist the Technical regression safety link",
  );

  // Remove only Technical approvals for this isolated fixture record.
  raw.prepare(
    "DELETE FROM safety_approval_requests WHERE safety_decision_id=? AND approval_type='Technical'"
  ).run(safetyDecisionId);

  const info = raw
    .prepare("PRAGMA table_info(safety_approval_requests)")
    .all();

  const columns = info.map((entry) => entry.name);

  const valueFor = (column, status, id, time) => {
    const values = {
      id,
      project_id: PROJECT_ID,
      safety_decision_id: safetyDecisionId,
      approval_type: "Technical",
      approval_level: 1,
      status,
      requested_by: "fixture",
      requested_role: "Technical Reviewer",
      request_reason: "Excel technical authority regression",
      evidence: "{}",
      entity_version: 1,
      ruleset_version: "fixture",
      decided_by: "fixture",
      decided_role: "Technical Reviewer",
      decision_reason: "Excel technical authority regression",
      created_at: time,
      decided_at: time,
    };

    if (column in values) return values[column];

    const schema = info.find((entry) => entry.name === column);

    if (schema?.dflt_value != null) return undefined;
    if (!schema?.notnull) return null;

    const type = String(schema?.type || "").toUpperCase();

    if (type.includes("INT")) return 1;
    if (
      type.includes("REAL") ||
      type.includes("NUM") ||
      type.includes("DEC")
    ) return 1;

    return "fixture";
  };

  const insertApproval = (status, id, time) => {
    const usedColumns = [];
    const values = [];

    for (const column of columns) {
      const value = valueFor(column, status, id, time);

      // undefined means allow SQLite DEFAULT.
      if (value === undefined) continue;

      usedColumns.push(column);
      values.push(value);
    }

    const placeholders = usedColumns.map(() => "?").join(",");

    raw.prepare(
      `INSERT INTO safety_approval_requests (${usedColumns.join(",")})
       VALUES (${placeholders})`
    ).run(...values);
  };

  insertApproval(
    "Approved",
    "technical-approved-old",
    "2026-08-10T10:00:00Z",
  );

  insertApproval(
    "Rejected",
    "technical-rejected-latest",
    "2026-08-10T11:00:00Z",
  );

  const data = await loadExportData(
    db,
    PROJECT_ID,
    "Commercial Review Cost Sheet",
  );

  assert.ok(data.rows.length > 0);

  const row = data.rows.find(
    (entry) => entry.technicalApprovalStatus != null
  ) || data.rows[0];

  assert.equal(
    row.technicalApprovalStatus,
    "Rejected",
    "latest Rejected Technical decision must override historical Approved",
  );

  raw.close();
});
