import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { handlePricingApi } from "../worker/pricing-api.mjs";

const USER_ID = "local-development-user";
const PROJECT_ID = "project-pricing-authority";

const fixture = () => {
  const raw = new DatabaseSync(":memory:");

  raw.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      organization_id TEXT,
      system_domain TEXT NOT NULL DEFAULT 'Unspecified',
      initial_status TEXT NOT NULL DEFAULT 'Draft',
      archived_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE project_members (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT DEFAULT 'Active',
      granted_by TEXT,
      granted_at TEXT DEFAULT CURRENT_TIMESTAMP,
      revoked_at TEXT
    );

    CREATE TABLE pricing_scenarios (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mode TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      project_currency TEXT NOT NULL,
      status TEXT NOT NULL,
      assumptions TEXT NOT NULL,
      settings TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      superseded_at TEXT,
      deleted_at TEXT
    );

    CREATE TABLE project_dashboard_profiles (
      project_id TEXT PRIMARY KEY,
      currency TEXT NOT NULL DEFAULT 'SAR',
      selected_pricing_scenario_id TEXT,
      selected_pricing_scenario_at TEXT,
      selected_pricing_scenario_by TEXT,
      selected_pricing_scenario_reason TEXT,
      updated_by TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );

    CREATE TABLE dashboard_audit_log (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      action TEXT NOT NULL,
      previous_value TEXT,
      new_value TEXT,
      reason TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      request_id TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE boq_extraction_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT,
      document_version_id TEXT,
      version_number INTEGER,
      status TEXT,
      superseded_at TEXT
    );

    CREATE TABLE documents (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, current_version_id TEXT,
      deleted_at TEXT, archived_at TEXT
    );

    CREATE TABLE document_versions (id TEXT PRIMARY KEY, document_id TEXT NOT NULL);

    CREATE TABLE boq_items (
      id TEXT PRIMARY KEY,
      extraction_version_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      source_document_id TEXT NOT NULL,
      row_type TEXT NOT NULL
    );

    CREATE TABLE pricing_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      scenario_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      status TEXT NOT NULL,
      input_fingerprint TEXT NOT NULL,
      engine_version TEXT NOT NULL,
      ruleset_version TEXT NOT NULL,
      reason TEXT NOT NULL,
      locked_versions TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      superseded_at TEXT
    );

    CREATE TABLE pricing_lines (
      id TEXT PRIMARY KEY,
      pricing_run_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      boq_item_id TEXT NOT NULL,
      approval_ready INTEGER NOT NULL DEFAULT 0,
      material_total_minor INTEGER,
      total_cost_minor INTEGER,
      gross_selling_minor INTEGER,
      customer_discount_minor INTEGER,
      net_selling_minor INTEGER,
      vat_minor INTEGER,
      final_value_minor INTEGER
    );

    CREATE TABLE pricing_approvals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      pricing_run_id TEXT NOT NULL,
      approval_type TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE project_quotation_revisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      revision_number INTEGER NOT NULL,
      currency TEXT NOT NULL,
      total_minor INTEGER,
      status TEXT NOT NULL,
      source_summary_json TEXT,
      approved_at TEXT,
      issued_at TEXT,
      created_at TEXT,
      superseded_at TEXT
    );
  `);

  raw.exec(`
    INSERT INTO projects (
      id, name, owner_user_id, organization_id, system_domain, initial_status
    ) VALUES (
      '${PROJECT_ID}',
      'Pricing Authority Fixture',
      '${USER_ID}',
      'organization_bd_shaft_internal_pilot',
      'Fire Alarm',
      'Draft'
    );

    INSERT INTO project_dashboard_profiles (
      project_id, currency, updated_by
    ) VALUES (
      '${PROJECT_ID}', 'SAR', '${USER_ID}'
    );

    INSERT INTO pricing_scenarios (
      id, project_id, name, mode, version_number, project_currency,
      status, assumptions, settings, created_by
    ) VALUES
      (
        'scenario-a',
        '${PROJECT_ID}',
        'Scenario A',
        'Base Case',
        1,
        'SAR',
        'Draft',
        '[]',
        '{}',
        '${USER_ID}'
      ),
      (
        'scenario-b',
        '${PROJECT_ID}',
        'Scenario B',
        'Value Engineering',
        1,
        'SAR',
        'Draft',
        '[]',
        '{}',
        '${USER_ID}'
      ),
      (
        'scenario-old',
        '${PROJECT_ID}',
        'Scenario Historical',
        'Base Case',
        1,
        'SAR',
        'Draft',
        '[]',
        '{}',
        '${USER_ID}'
      );

    UPDATE pricing_scenarios
    SET superseded_at='2026-08-10T12:00:00Z'
    WHERE id='scenario-old';

    INSERT INTO documents VALUES
      ('doc-current', '${PROJECT_ID}', 'doc-version-current', NULL, NULL),
      ('doc-old', '${PROJECT_ID}', 'doc-version-old', NULL, NULL);
    INSERT INTO document_versions VALUES
      ('doc-version-current', 'doc-current'),
      ('doc-version-old', 'doc-old');

    INSERT INTO boq_extraction_versions (id, document_id, document_version_id, version_number, status, superseded_at)
    VALUES
      ('boq-version-current', 'doc-current', 'doc-version-current', 1, 'Completed', NULL),
      ('boq-version-old', 'doc-old', 'doc-version-old', 1, 'Completed', '2026-08-10T12:00:00Z');

    INSERT INTO boq_items (id, extraction_version_id, project_id, source_document_id, row_type)
    VALUES
      ('boq-1', 'boq-version-current', '${PROJECT_ID}', 'doc-current', 'BOQ Item'),
      ('boq-2', 'boq-version-current', '${PROJECT_ID}', 'doc-current', 'BOQ Item'),
      ('boq-old', 'boq-version-old', '${PROJECT_ID}', 'doc-old', 'BOQ Item');

    INSERT INTO pricing_runs (
      id, project_id, scenario_id, version_number, status,
      input_fingerprint, engine_version, ruleset_version,
      reason, locked_versions, summary, created_by, superseded_at
    ) VALUES
      ('run-a1', '${PROJECT_ID}', 'scenario-a', 1, 'Calculated',
       'fp-a1', 'test', 'test', 'first item one price', '{}', '{}', '${USER_ID}', NULL),

      ('run-a2', '${PROJECT_ID}', 'scenario-a', 2, 'Calculated',
       'fp-a2', 'test', 'test', 'latest item one price', '{}', '{}', '${USER_ID}', NULL),

      ('run-a3', '${PROJECT_ID}', 'scenario-a', 3, 'Calculated',
       'fp-a3', 'test', 'test', 'item two price', '{}', '{}', '${USER_ID}', NULL),

      ('run-a4-superseded', '${PROJECT_ID}', 'scenario-a', 4, 'Calculated',
       'fp-a4', 'test', 'test', 'superseded item one price', '{}', '{}', '${USER_ID}', '2026-08-10T12:00:00Z'),

      ('run-b1', '${PROJECT_ID}', 'scenario-b', 1, 'Calculated',
       'fp-b1', 'test', 'test', 'scenario b item one', '{}', '{}', '${USER_ID}', NULL),

      ('run-a5-old-boq', '${PROJECT_ID}', 'scenario-a', 5, 'Calculated',
       'fp-a5-old', 'test', 'test', 'superseded BOQ pricing must not enter summary', '{}', '{}', '${USER_ID}', NULL);

    INSERT INTO pricing_lines (
      id, pricing_run_id, project_id, boq_item_id, approval_ready,
      material_total_minor, total_cost_minor, gross_selling_minor,
      customer_discount_minor, net_selling_minor, vat_minor, final_value_minor
    ) VALUES
      ('line-a1', 'run-a1', '${PROJECT_ID}', 'boq-1', 1,
       800, 1000, 1300, 0, 1300, 195, 1495),

      ('line-a2', 'run-a2', '${PROJECT_ID}', 'boq-1', 1,
       1200, 1500, 2000, 0, 2000, 300, 2300),

      ('line-a3', 'run-a3', '${PROJECT_ID}', 'boq-2', 1,
       1700, 2000, 2600, 100, 2500, 375, 2875),

      ('line-a4-superseded', 'run-a4-superseded', '${PROJECT_ID}', 'boq-1', 1,
       900000, 999900, 1200000, 0, 1200000, 180000, 1380000),

      ('line-b1', 'run-b1', '${PROJECT_ID}', 'boq-1', 1,
       400, 500, 700, 0, 700, 105, 805),

      ('line-a5-old-boq', 'run-a5-old-boq', '${PROJECT_ID}', 'boq-old', 1,
       900000, 999900, 1200000, 0, 1200000, 180000, 1380000);
  `);

  const operation = (sql, args = []) => ({
    first: async () => raw.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: raw.prepare(sql).all(...args) }),
    run: async () => {
      const result = raw.prepare(sql).run(...args);
      return { success: true, meta: { changes: result.changes } };
    },
  });

  const DB = {
    prepare(sql) {
      return {
        ...operation(sql),
        bind: (...args) => operation(sql, args),
      };
    },
    async batch(statements) {
      raw.exec("BEGIN");
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
  };

  return { raw, env: { DB } };
};

const request = (path, method = "GET", body) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: body
      ? {
          "content-type": "application/json",
          "x-request-id": "pricing-authority-test",
        }
      : {
          "x-request-id": "pricing-authority-test",
        },
    body: body ? JSON.stringify(body) : undefined,
  });

const jsonCall = async (env, path, method = "GET", body) => {
  const response = await handlePricingApi(request(path, method, body), env);
  assert.ok(response instanceof Response, `Pricing API did not handle ${method} ${path}`);
  return { response, body: await response.json() };
};

test("selected pricing scenario is durable and fully audited", async () => {
  const { raw, env } = fixture();

  let result = await jsonCall(
    env,
    `/api/pricing/projects/${PROJECT_ID}/selected-scenario`,
    "POST",
    {
      scenarioId: "scenario-a",
      reason: "Scenario A is the governed base quotation scenario",
    },
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.selectedScenario.id, "scenario-a");

  let profile = raw.prepare(`
    SELECT
      selected_pricing_scenario_id,
      selected_pricing_scenario_by,
      selected_pricing_scenario_reason
    FROM project_dashboard_profiles
    WHERE project_id=?
  `).get(PROJECT_ID);

  assert.equal(profile.selected_pricing_scenario_id, "scenario-a");
  assert.equal(profile.selected_pricing_scenario_by, USER_ID);
  assert.equal(
    profile.selected_pricing_scenario_reason,
    "Scenario A is the governed base quotation scenario",
  );

  result = await jsonCall(
    env,
    `/api/pricing/projects/${PROJECT_ID}/selected-scenario`,
    "POST",
    {
      scenarioId: "scenario-b",
      reason: "Scenario B is selected to verify durable authority switching",
    },
  );

  assert.equal(result.response.status, 200);
  assert.equal(result.body.selectedScenario.id, "scenario-b");

  profile = raw.prepare(`
    SELECT selected_pricing_scenario_id
    FROM project_dashboard_profiles
    WHERE project_id=?
  `).get(PROJECT_ID);

  assert.equal(profile.selected_pricing_scenario_id, "scenario-b");

  const audits = raw.prepare(`
    SELECT action, previous_value, new_value, actor_user_id, actor_role
    FROM dashboard_audit_log
    WHERE project_id=?
    ORDER BY created_at, rowid
  `).all(PROJECT_ID);

  assert.equal(audits.length, 2);
  assert.equal(audits[0].action, "Pricing Scenario Selected for Quotation");
  assert.deepEqual(JSON.parse(audits[0].previous_value), { scenarioId: null });
  assert.deepEqual(JSON.parse(audits[0].new_value), {
    scenarioId: "scenario-a",
    scenarioName: "Scenario A",
    scenarioVersion: 1,
  });

  assert.deepEqual(JSON.parse(audits[1].previous_value), {
    scenarioId: "scenario-a",
  });
  assert.deepEqual(JSON.parse(audits[1].new_value), {
    scenarioId: "scenario-b",
    scenarioName: "Scenario B",
    scenarioVersion: 1,
  });

  assert.equal(audits[1].actor_user_id, USER_ID);
  assert.equal(audits[1].actor_role, "Admin");

  raw.close();
});

test("scenario comparison returns one aggregate per scenario using latest current run per BOQ item", async () => {
  const { raw, env } = fixture();

  const { response, body } = await jsonCall(
    env,
    `/api/pricing/projects/${PROJECT_ID}/scenarios/compare`,
    "POST",
    {
      scenarioIds: ["scenario-a", "scenario-b"],
    },
  );

  assert.equal(response.status, 200);
  assert.equal(body.comparison.length, 2);

  const byId = Object.fromEntries(
    body.comparison.map((entry) => [entry.id, entry]),
  );

  assert.ok(byId["scenario-a"]);
  assert.ok(byId["scenario-b"]);

  assert.equal(byId["scenario-a"].summary.itemCount, 2);
  assert.equal(byId["scenario-a"].summary.pricedItemCount, 2);

  assert.equal(byId["scenario-a"].summary.material, 29);
  assert.equal(byId["scenario-a"].summary.totalCost, 35);
  assert.equal(byId["scenario-a"].summary.grossSelling, 46);
  assert.equal(byId["scenario-a"].summary.customerDiscount, 1);
  assert.equal(byId["scenario-a"].summary.netSelling, 45);
  assert.equal(byId["scenario-a"].summary.vat, 6.75);
  assert.equal(byId["scenario-a"].summary.finalValue, 51.75);
  assert.equal(byId["scenario-a"].summary.grossProfit, 10);

  assert.equal(byId["scenario-b"].summary.itemCount, 1);
  assert.equal(byId["scenario-b"].summary.pricedItemCount, 1);
  assert.equal(byId["scenario-b"].summary.totalCost, 5);
  assert.equal(byId["scenario-b"].summary.netSelling, 7);
  assert.equal(byId["scenario-b"].summary.finalValue, 8.05);

  assert.ok(
    byId["scenario-a"].summary.totalCost < 1000,
    "Superseded pricing run leaked into scenario comparison",
  );

  raw.close();
});

test("pricing project summary excludes pricing attached only to superseded BOQ extractions", async () => {
  const { raw, env } = fixture();

  const { response, body } = await jsonCall(
    env,
    `/api/pricing/projects/${PROJECT_ID}/summary?scenarioId=scenario-a`,
  );

  assert.equal(response.status, 200);
  assert.equal(body.status, "Calculated");

  assert.equal(body.summary.itemCount, 2);
  assert.equal(body.summary.pricedItemCount, 2);
  assert.equal(body.summary.material, 29);
  assert.equal(body.summary.totalCost, 35);
  assert.equal(body.summary.netSelling, 45);
  assert.equal(body.summary.finalValue, 51.75);

  raw.close();
});

test("operational pricing scenario list excludes superseded scenarios", async () => {
  const { raw, env } = fixture();

  const { response, body } = await jsonCall(
    env,
    `/api/pricing/projects/${PROJECT_ID}/scenarios`,
  );

  assert.equal(response.status, 200);

  const ids = body.scenarios.map((entry) => entry.id).sort();

  assert.deepEqual(ids, ["scenario-a", "scenario-b"]);

  raw.close();
});

test("commercial summary rejects superseded requested pricing scenarios", async () => {
  const { raw, env } = fixture();

  const { response, body } = await jsonCall(
    env,
    `/api/pricing/projects/${PROJECT_ID}/commercial-summary?scenarioId=scenario-old`,
  );

  assert.equal(response.status, 409);
  assert.equal(body.error.code, "PRICING_SCENARIO_NOT_AVAILABLE");

  raw.close();
});

test("commercial summary uses the latest commercial decision, not any historical approval", async () => {
  const { raw, env } = fixture();

  raw.exec(`
    ALTER TABLE pricing_approvals ADD COLUMN entity_version INTEGER;
    ALTER TABLE pricing_approvals ADD COLUMN created_at TEXT;
    ALTER TABLE pricing_approvals ADD COLUMN decided_at TEXT;

    INSERT INTO pricing_approvals (
      id, project_id, pricing_run_id, approval_type, status,
      entity_version, created_at, decided_at
    ) VALUES
      (
        'approval-a2-approved-old',
        '${PROJECT_ID}',
        'run-a2',
        'Commercial Price',
        'Approved',
        2,
        '2026-08-10T10:00:00Z',
        '2026-08-10T10:00:00Z'
      ),
      (
        'approval-a2-rejected-latest',
        '${PROJECT_ID}',
        'run-a2',
        'Commercial Price',
        'Rejected',
        2,
        '2026-08-10T11:00:00Z',
        '2026-08-10T11:00:00Z'
      ),
      (
        'approval-a3-approved-latest',
        '${PROJECT_ID}',
        'run-a3',
        'Commercial Price',
        'Approved',
        3,
        '2026-08-10T11:30:00Z',
        '2026-08-10T11:30:00Z'
      );
  `);

  const { response, body } = await jsonCall(
    env,
    `/api/pricing/projects/${PROJECT_ID}/commercial-summary?scenarioId=scenario-a`,
  );

  assert.equal(response.status, 200);

  assert.equal(
    body.commercialSummary.commerciallyApproved.amountMinor,
    2875,
  );

  assert.equal(
    body.commercialSummary.commerciallyApproved.includedLineCount,
    1,
  );

  raw.close();
});
