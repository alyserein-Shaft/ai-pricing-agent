import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { handlePricingApi, loadPricingInput } from "../worker/pricing-api.mjs";

const PROJECT_ID = "project-pricing-input-authority";

const fixture = () => {
  const raw = new DatabaseSync(":memory:");

  raw.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL
    );

    CREATE TABLE project_members (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT,
      revoked_at TEXT
    );

    CREATE TABLE pricing_scenarios (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      project_currency TEXT NOT NULL,
      settings TEXT NOT NULL,
      deleted_at TEXT,
      superseded_at TEXT
    );

    CREATE TABLE boq_extraction_versions (
      id TEXT PRIMARY KEY,
      superseded_at TEXT
    );

    CREATE TABLE boq_items (
      id TEXT PRIMARY KEY,
      extraction_version_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      numeric_quantity REAL,
      normalized_unit TEXT,
      updated_at TEXT
    );

    CREATE TABLE product_match_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      boq_item_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      superseded_at TEXT
    );

    CREATE TABLE product_match_candidates (
      id TEXT PRIMARY KEY,
      match_run_id TEXT NOT NULL,
      product_id TEXT NOT NULL
    );

    CREATE TABLE canonical_library_products (
      id TEXT PRIMARY KEY,
      requested_product_id TEXT NOT NULL,
      manufacturer_id TEXT NOT NULL,
      part_number TEXT,
      lifecycle_status TEXT
    );

    CREATE TABLE product_manufacturers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE safety_decisions (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      superseded_at TEXT
    );

    CREATE TABLE safety_approval_requests (
      id TEXT PRIMARY KEY,
      safety_decision_id TEXT NOT NULL,
      approval_type TEXT NOT NULL,
      status TEXT NOT NULL,
      decided_at TEXT
    );

    CREATE TABLE price_records (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      supplier_id TEXT,
      project_id TEXT,
      amount_minor INTEGER,
      currency TEXT,
      price_type TEXT,
      approval_status TEXT,
      downstream_use TEXT,
      effective_from TEXT,
      valid_until TEXT,
      minimum_quantity REAL,
      source_id TEXT,
      source_location TEXT,
      terms TEXT,
      reviewed_at TEXT,
      created_at TEXT
    );

    CREATE TABLE suppliers (
      id TEXT PRIMARY KEY,
      name TEXT
    );

    CREATE TABLE pricing_exchange_rates (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      from_currency TEXT,
      to_currency TEXT,
      rate TEXT,
      source TEXT,
      version_number INTEGER,
      approval_status TEXT,
      valid_until TEXT,
      superseded_at TEXT
    );

    CREATE TABLE pricing_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      scenario_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      input_fingerprint TEXT,
      locked_versions TEXT,
      created_by TEXT,
      created_at TEXT,
      superseded_at TEXT
    );

    CREATE TABLE pricing_lines (
      id TEXT PRIMARY KEY,
      pricing_run_id TEXT NOT NULL,
      boq_item_id TEXT NOT NULL,
      status TEXT,
      approval_ready INTEGER
    );

    INSERT INTO projects (id, owner_user_id)
    VALUES ('${PROJECT_ID}', 'local-development-user');

    INSERT INTO pricing_scenarios (
      id, project_id, version_number, project_currency, settings, deleted_at, superseded_at
    ) VALUES
      ('scenario-current', '${PROJECT_ID}', 2, 'SAR', '{}', NULL, NULL),
      ('scenario-old', '${PROJECT_ID}', 1, 'SAR', '{}', NULL, '2026-08-10T12:00:00Z');

    INSERT INTO boq_extraction_versions (id, superseded_at) VALUES
      ('boq-version-current', NULL),
      ('boq-version-old', '2026-08-10T12:00:00Z');

    INSERT INTO boq_items (
      id, extraction_version_id, project_id, numeric_quantity, normalized_unit, updated_at
    ) VALUES
      ('boq-current', 'boq-version-current', '${PROJECT_ID}', 1, 'EA', '2026-08-10T12:00:00Z'),
      ('boq-old', 'boq-version-old', '${PROJECT_ID}', 1, 'EA', '2026-08-10T12:00:00Z');

    INSERT INTO product_manufacturers (id, name)
    VALUES ('manufacturer-1', 'Honeywell');

    INSERT INTO canonical_library_products (
      id, requested_product_id, manufacturer_id, part_number, lifecycle_status
    ) VALUES (
      'product-1', 'product-1', 'manufacturer-1', 'FA-001', 'Active'
    );

    INSERT INTO product_match_runs (
      id, project_id, boq_item_id, version_number, superseded_at
    ) VALUES
      ('match-current', '${PROJECT_ID}', 'boq-current', 2, NULL),
      ('match-old', '${PROJECT_ID}', 'boq-current', 1, '2026-08-10T12:00:00Z'),
      ('match-old-boq', '${PROJECT_ID}', 'boq-old', 1, NULL);

    INSERT INTO product_match_candidates (id, match_run_id, product_id) VALUES
      ('candidate-current', 'match-current', 'product-1'),
      ('candidate-old-run', 'match-old', 'product-1'),
      ('candidate-old-boq', 'match-old-boq', 'product-1');

    INSERT INTO pricing_runs (
      id, project_id, scenario_id, version_number, input_fingerprint,
      locked_versions, created_by, created_at, superseded_at
    ) VALUES
      (
        'pricing-run-old',
        '${PROJECT_ID}',
        'scenario-current',
        1,
        'fingerprint-old',
        '{}',
        'local-development-user',
        '2026-08-10T12:00:00Z',
        '2026-08-10T13:00:00Z'
      ),
      (
        'pricing-run-current-v1',
        '${PROJECT_ID}',
        'scenario-current',
        2,
        'fingerprint-current-v1',
        '{}',
        'local-development-user',
        '2026-08-10T14:00:00Z',
        NULL
      ),
      (
        'pricing-run-current-v2',
        '${PROJECT_ID}',
        'scenario-current',
        3,
        'fingerprint-current-v2',
        '{}',
        'local-development-user',
        '2026-08-10T15:00:00Z',
        NULL
      ),
      (
        'pricing-run-old-scenario',
        '${PROJECT_ID}',
        'scenario-old',
        4,
        'fingerprint-old-scenario',
        '{}',
        'local-development-user',
        '2026-08-10T16:00:00Z',
        NULL
      );

    INSERT INTO pricing_lines (
      id, pricing_run_id, boq_item_id, status, approval_ready
    ) VALUES
      (
        'pricing-line-old',
        'pricing-run-old',
        'boq-current',
        'Draft Price',
        1
      ),
      (
        'pricing-line-current-v1',
        'pricing-run-current-v1',
        'boq-current',
        'Draft Price',
        1
      ),
      (
        'pricing-line-current-v2',
        'pricing-run-current-v2',
        'boq-current',
        'Draft Price',
        1
      ),
      (
        'pricing-line-old-scenario',
        'pricing-run-old-scenario',
        'boq-current',
        'Draft Price',
        1
      );

    INSERT INTO safety_decisions (
      id, candidate_id, version_number, superseded_at
    ) VALUES
      ('safety-current', 'candidate-current', 1, NULL),
      ('safety-old-run', 'candidate-old-run', 1, NULL),
      ('safety-old-boq', 'candidate-old-boq', 1, NULL);

    INSERT INTO safety_approval_requests (
      id, safety_decision_id, approval_type, status, decided_at
    ) VALUES
      ('approval-current', 'safety-current', 'Technical', 'Approved', '2026-08-10T12:10:00Z'),
      ('approval-old-run', 'safety-old-run', 'Technical', 'Approved', '2026-08-10T12:10:00Z'),
      ('approval-old-boq', 'safety-old-boq', 'Technical', 'Approved', '2026-08-10T12:10:00Z');
  `);

  const operation = (sql, args = []) => ({
    first: async () => raw.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: raw.prepare(sql).all(...args) }),
  });

  const DB = {
    prepare(sql) {
      return {
        ...operation(sql),
        bind: (...args) => operation(sql, args),
      };
    },
    async batch() {
      return [];
    },
  };

  return { raw, DB };
};

const scenario = {
  id: "scenario-1",
  version_number: 1,
  project_currency: "SAR",
  settings: "{}",
};

const body = {
  selectedPriceSourceId: null,
  discounts: [],
  costComponents: [],
  sellingRule: { method: "Markup", rate: 0, minimumMargin: 0 },
  customerDiscount: { percentage: 0 },
  vatRule: { rate: 0 },
};

test("pricing input rejects BOQ items from superseded extraction versions", async () => {
  const { raw, DB } = fixture();

  await assert.rejects(
    loadPricingInput(DB, {
      projectId: PROJECT_ID,
      boqItemId: "boq-old",
      candidateId: "candidate-old-boq",
      scenario,
      body,
    }),
    (error) => error?.code === "BOQ_ITEM_NOT_FOUND",
  );

  raw.close();
});

test("pricing input rejects candidates from superseded match runs", async () => {
  const { raw, DB } = fixture();

  await assert.rejects(
    loadPricingInput(DB, {
      projectId: PROJECT_ID,
      boqItemId: "boq-current",
      candidateId: "candidate-old-run",
      scenario,
      body,
    }),
    (error) => error?.code === "CANDIDATE_NOT_FOUND",
  );

  raw.close();
});


test("pricing input uses the latest technical safety decision rather than any historical approval", async () => {
  const { raw, DB } = fixture();

  raw.prepare(`
    INSERT INTO safety_approval_requests (
      id, safety_decision_id, approval_type, status, decided_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    "approval-current-rejected-latest",
    "safety-current",
    "Technical",
    "Rejected",
    "2026-08-10T12:20:00Z",
  );

  const input = await loadPricingInput(DB, {
    projectId: PROJECT_ID,
    boqItemId: "boq-current",
    candidateId: "candidate-current",
    scenario,
    body,
  });

  assert.equal(input.technicalApproval, null);
  assert.equal(
    input.safetyDecision?.priceEligibility,
    "Price Approval Disabled",
  );

  raw.close();
});

test("pricing calculation rejects superseded pricing scenarios", async () => {
  const { raw, DB } = fixture();

  const response = await handlePricingApi(
    new Request(
      `http://localhost/api/pricing/items/boq-current/calculate`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "pricing-input-authority-test",
        },
        body: JSON.stringify({
          scenarioId: "scenario-old",
          candidateId: "candidate-does-not-matter",
          reason: "Superseded scenario must not reach calculation",
        }),
      },
    ),
    { DB },
  );

  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.error.code, "SCENARIO_NOT_FOUND");

  raw.close();
});

const manualPriceBody = (candidateId) => ({
  candidateId,
  productId: "product-1",
  source: "authority-regression-supplier-quote.csv",
  effectiveFrom: "2026-08-10",
  validUntil: "2099-08-10",
  price: 125,
  currency: "SAR",
  unit: "EA",
  scope: "Project item",
  reason: "Current supplier evidence submitted for governed manual price review",
});

test("manual price rejects BOQ items from superseded extraction versions", async () => {
  const { raw, DB } = fixture();

  const response = await handlePricingApi(
    new Request(
      "http://localhost/api/pricing/items/boq-old/manual-price?scenarioId=scenario-current",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "manual-price-authority-test",
        },
        body: JSON.stringify(manualPriceBody("candidate-old-boq")),
      },
    ),
    { DB },
  );

  const result = await response.json();

  assert.equal(response.status, 404);
  assert.equal(result.error.code, "BOQ_ITEM_NOT_FOUND");

  raw.close();
});

test("manual price rejects technically approved candidates from superseded match runs", async () => {
  const { raw, DB } = fixture();

  const response = await handlePricingApi(
    new Request(
      "http://localhost/api/pricing/items/boq-current/manual-price?scenarioId=scenario-current",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "manual-price-authority-test",
        },
        body: JSON.stringify(manualPriceBody("candidate-old-run")),
      },
    ),
    { DB },
  );

  const result = await response.json();

  assert.equal(response.status, 422);
  assert.equal(result.error.code, "MANUAL_PRICE_NOT_PERMITTED");

  raw.close();
});


test("manual price uses the latest technical safety decision rather than any historical approval", async () => {
  const { raw, DB } = fixture();

  raw.prepare(`
    INSERT INTO safety_approval_requests (
      id, safety_decision_id, approval_type, status, decided_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    "manual-price-rejected-latest",
    "safety-current",
    "Technical",
    "Rejected",
    "2026-08-10T12:30:00Z",
  );

  const currentScenario = raw.prepare(
    "SELECT id FROM pricing_scenarios WHERE deleted_at IS NULL AND superseded_at IS NULL ORDER BY id LIMIT 1",
  ).get();

  assert.ok(currentScenario?.id, "fixture must contain a current pricing scenario");

  const response = await handlePricingApi(
    new Request(
      `http://localhost/api/pricing/items/boq-current/manual-price?scenarioId=${currentScenario.id}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "manual-price-latest-technical-authority",
        },
        body: JSON.stringify(manualPriceBody("candidate-current")),
      },
    ),
    { DB },
  );

  const responseBody = await response.json();

  assert.equal(response.status, 422);
  assert.equal(responseBody.error.code, "MANUAL_PRICE_NOT_PERMITTED");
  assert.equal(responseBody.error.validation.technicalApproved, false);

  raw.close();
});

test("operational pricing breakdown rejects superseded pricing scenarios", async () => {
  const { raw, DB } = fixture();

  const response = await handlePricingApi(
    new Request(
      "http://localhost/api/pricing/items/boq-current?scenarioId=scenario-old",
      {
        headers: {
          "x-request-id": "pricing-read-authority-test",
        },
      },
    ),
    { DB },
  );

  const result = await response.json();

  assert.equal(response.status, 404);
  assert.equal(result.error.code, "SCENARIO_NOT_FOUND");

  raw.close();
});

test("commercial approval rejects superseded pricing runs", async () => {
  const { raw, DB } = fixture();

  const response = await handlePricingApi(
    new Request(
      "http://localhost/api/pricing/runs/pricing-run-old/approve",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "pricing-run-authority-test",
        },
        body: JSON.stringify({
          entityVersion: 1,
          reason: "Commercial approval must apply only to the current pricing run",
        }),
      },
    ),
    { DB },
  );

  const result = await response.json();

  assert.equal(response.status, 404);
  assert.equal(result.error.code, "PRICING_RUN_NOT_FOUND");

  raw.close();
});

test("commercial approval rejects a non-latest current pricing run for the BOQ item", async () => {
  const { raw, DB } = fixture();

  const response = await handlePricingApi(
    new Request(
      "http://localhost/api/pricing/runs/pricing-run-current-v1/approve",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "pricing-run-latest-authority-test",
        },
        body: JSON.stringify({
          entityVersion: 2,
          reason: "Commercial approval must apply only to the latest current pricing run",
        }),
      },
    ),
    { DB },
  );

  const result = await response.json();

  assert.equal(response.status, 409);
  assert.equal(result.error.code, "STALE_PRICING_RUN");

  raw.close();
});

test("commercial approval rejects pricing runs from superseded scenarios", async () => {
  const { raw, DB } = fixture();

  const response = await handlePricingApi(
    new Request(
      "http://localhost/api/pricing/runs/pricing-run-old-scenario/approve",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "pricing-run-scenario-authority-test",
        },
        body: JSON.stringify({
          entityVersion: 4,
          reason: "Commercial approval must apply only to pricing runs in current scenarios",
        }),
      },
    ),
    { DB },
  );

  const result = await response.json();

  assert.equal(response.status, 409);
  assert.equal(result.error.code, "PRICING_SCENARIO_NOT_AVAILABLE");

  raw.close();
});
