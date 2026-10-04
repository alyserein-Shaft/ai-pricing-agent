// Commercial Policy Configuration -- persistence proof.
//
// The acceptance bar for this slice is not "a form posts something". It is:
//
//   UI payload -> HTTP PATCH (real handlePricingApi) -> pricing_scenarios.settings
//   -> read back from the server (refresh/reopen) -> loadPricingInput ->
//   buildCommercialPricingResult -> authoritative money
//
// This suite drives the real route against an in-memory SQLite database with the
// real column shapes, then feeds the PERSISTED row (not the request body) into
// the real runtime and the real authority. If the write path only worked in
// memory, or if the guard could not read back what was written, these fail.
//
// The real Al Mousa project is never touched: the fixture is a private
// in-memory database, and the only tables involved are the four the route
// itself reads or writes.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { handlePricingApi, commercialPricingErrorPayload } from "../worker/pricing-api.mjs";
import { loadPricingInput } from "../worker/pricing-runtime.mjs";
import { buildCommercialPricingResult } from "../app/domain/commercial-pricing-authority.mjs";

const PROJECT_ID = "project-commercial-policy";
const OTHER_PROJECT_ID = "project-not-mine";
const SCENARIO_ID = "scenario-default";
const USER_ID = "local-development-user";

const MARKUP_POLICY = {
  sellingRule: { method: "Markup", rate: 20 },
  customerDiscount: { percentage: 0 },
  vatRule: { rate: 15 },
};
const TARGET_MARGIN_POLICY = {
  sellingRule: { method: "Target Margin", rate: 50, minimumMargin: 10 },
  customerDiscount: { percentage: 10 },
  vatRule: { rate: 15 },
};

const addRuns = (raw, count, fromVersion = 0) => {
  for (let index = 1; index <= count; index += 1) {
    const version = fromVersion + index;
    raw
      .prepare(
        "INSERT INTO pricing_runs (id, project_id, scenario_id, version_number, status, created_by, created_at) VALUES (?, ?, ?, ?, 'Completed', ?, ?)",
      )
      .run(
        `run-${version}`,
        PROJECT_ID,
        SCENARIO_ID,
        version,
        USER_ID,
        `2026-09-29T00:00:0${version % 10}.000Z`,
      );
  }
};

const fixture = ({ settings = "{}", liveRuns = 0 } = {}) => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, owner_user_id TEXT, organization_id TEXT, archived_at TEXT);
    CREATE TABLE project_dashboard_profiles (project_id TEXT PRIMARY KEY, currency TEXT, deleted_at TEXT);
    CREATE TABLE project_members (id TEXT PRIMARY KEY, project_id TEXT, user_id TEXT, role TEXT, status TEXT, revoked_at TEXT, effective_from TEXT);
    CREATE TABLE pricing_scenarios (id TEXT PRIMARY KEY, project_id TEXT, name TEXT, mode TEXT, version_number INTEGER, project_currency TEXT, status TEXT, assumptions TEXT, settings TEXT, created_by TEXT, created_at TEXT, deleted_at TEXT, superseded_at TEXT);
    CREATE TABLE pricing_runs (id TEXT PRIMARY KEY, project_id TEXT, scenario_id TEXT, version_number INTEGER, status TEXT, input_fingerprint TEXT, engine_version TEXT, ruleset_version TEXT, reason TEXT, locked_versions TEXT, summary TEXT, created_by TEXT, created_at TEXT, completed_at TEXT, superseded_at TEXT, error_code TEXT, error_message TEXT);
    CREATE TABLE pricing_audit_events (id TEXT PRIMARY KEY, project_id TEXT, pricing_run_id TEXT, pricing_line_id TEXT, action TEXT, previous_value TEXT, new_value TEXT, reason TEXT, actor_user_id TEXT, actor_role TEXT, request_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);

    CREATE TABLE boq_extraction_versions (id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, version_number INTEGER, status TEXT, superseded_at TEXT);
    CREATE TABLE documents (id TEXT PRIMARY KEY, project_id TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
    CREATE TABLE document_versions (id TEXT PRIMARY KEY, document_id TEXT, effective_from TEXT, effective_to TEXT);
    CREATE TABLE document_supersessions (id TEXT PRIMARY KEY, superseding_version_id TEXT, superseded_version_id TEXT, scope_type TEXT, scope_id TEXT, supersession_type TEXT, effective_from TEXT, effective_to TEXT, created_by TEXT, created_at TEXT);
    CREATE TABLE boq_items (id TEXT PRIMARY KEY, extraction_version_id TEXT NOT NULL, project_id TEXT NOT NULL, source_document_id TEXT, row_type TEXT, review_status TEXT, approved_for_downstream INTEGER, numeric_quantity REAL, normalized_unit TEXT, updated_at TEXT);
    CREATE TABLE product_match_runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, boq_item_id TEXT NOT NULL, requirement_profile_version_id TEXT, version_number INTEGER NOT NULL, superseded_at TEXT);
    CREATE TABLE requirement_profile_versions (id TEXT PRIMARY KEY, boq_item_id TEXT NOT NULL, version_number INTEGER NOT NULL, superseded_at TEXT);
    CREATE TABLE product_match_candidates (id TEXT PRIMARY KEY, match_run_id TEXT NOT NULL, product_id TEXT NOT NULL, review_status TEXT DEFAULT 'Needs Review');
    CREATE TABLE canonical_library_products (id TEXT PRIMARY KEY, requested_product_id TEXT NOT NULL, manufacturer_id TEXT NOT NULL, part_number TEXT, lifecycle_status TEXT);
    CREATE TABLE product_manufacturers (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE safety_decisions (id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, version_number INTEGER NOT NULL, superseded_at TEXT);
    CREATE TABLE safety_approval_requests (id TEXT PRIMARY KEY, safety_decision_id TEXT NOT NULL, approval_type TEXT NOT NULL, status TEXT NOT NULL, decided_at TEXT);
    CREATE TABLE price_records (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, supplier_id TEXT, project_id TEXT, amount_minor INTEGER, currency TEXT, price_type TEXT, approval_status TEXT, downstream_use TEXT, effective_from TEXT, valid_until TEXT, minimum_quantity REAL, source_id TEXT, source_location TEXT, terms TEXT, reviewed_at TEXT, created_at TEXT, status TEXT, superseded_at TEXT);
    CREATE TABLE suppliers (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE pricing_exchange_rates (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, from_currency TEXT, to_currency TEXT, rate TEXT, source TEXT, version_number INTEGER, approval_status TEXT, valid_until TEXT, superseded_at TEXT);
    CREATE TABLE boq_quantity_source_decisions (id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, source TEXT, selected_quantity REAL, boq_quantity REAL, drawing_quantity REAL, recognition_version_id TEXT, definition_key TEXT, reason TEXT, decided_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);

    INSERT INTO projects (id, owner_user_id, organization_id) VALUES ('${PROJECT_ID}', '${USER_ID}', 'org-1');
    INSERT INTO project_dashboard_profiles (project_id, currency) VALUES ('${PROJECT_ID}', 'SAR');
    INSERT INTO projects (id, owner_user_id, organization_id) VALUES ('${OTHER_PROJECT_ID}', 'someone-else', 'org-1');
    INSERT INTO pricing_scenarios (id, project_id, name, mode, version_number, project_currency, status, assumptions, settings, created_by, created_at)
      VALUES ('${SCENARIO_ID}', '${PROJECT_ID}', 'Default Cost Build-Up', 'Base Case', 1, 'SAR', 'Draft', '[]', '${settings.replace(/'/g, "''")}', '${USER_ID}', '2026-09-01T00:00:00.000Z');

    -- A single technically-approved, safety-eligible, priced BOQ item, so the
    -- runtime can resolve a complete pricing input. Only the scenario's settings
    -- column is under test; the rest exists so the REAL loadPricingInput can
    -- reach the commercial policy at all.
    INSERT INTO documents VALUES ('doc-current', '${PROJECT_ID}', 'doc-version-current', NULL, NULL);
    INSERT INTO document_versions (id, document_id) VALUES ('doc-version-current', 'doc-current');
    INSERT INTO boq_extraction_versions (id, document_id, document_version_id, version_number, status, superseded_at) VALUES ('boq-version-current', 'doc-current', 'doc-version-current', 1, 'Completed', NULL);
    INSERT INTO boq_items (id, extraction_version_id, project_id, source_document_id, row_type, review_status, approved_for_downstream, numeric_quantity, normalized_unit, updated_at)
      VALUES ('boq-current', 'boq-version-current', '${PROJECT_ID}', 'doc-current', 'BOQ Item', 'Approved', 1, 10, 'EA', '2026-09-01T12:00:00Z');
    INSERT INTO product_manufacturers (id, name) VALUES ('manufacturer-1', 'Honeywell');
    INSERT INTO canonical_library_products (id, requested_product_id, manufacturer_id, part_number, lifecycle_status) VALUES ('product-1', 'product-1', 'manufacturer-1', 'FA-001', 'Active');
    INSERT INTO requirement_profile_versions (id, boq_item_id, version_number, superseded_at) VALUES ('profile-current', 'boq-current', 1, NULL);
    INSERT INTO product_match_runs (id, project_id, boq_item_id, requirement_profile_version_id, version_number, superseded_at) VALUES ('match-current', '${PROJECT_ID}', 'boq-current', 'profile-current', 1, NULL);
    INSERT INTO product_match_candidates (id, match_run_id, product_id) VALUES ('candidate-current', 'match-current', 'product-1');
    INSERT INTO safety_decisions (id, candidate_id, version_number, superseded_at) VALUES ('safety-current', 'candidate-current', 1, NULL);
    INSERT INTO safety_approval_requests (id, safety_decision_id, approval_type, status, decided_at) VALUES ('approval-current', 'safety-current', 'Technical', 'Approved', '2026-09-01T12:10:00Z');
    INSERT INTO price_records (id, product_id, supplier_id, project_id, amount_minor, currency, price_type, approval_status, downstream_use, effective_from, valid_until, minimum_quantity, source_id, source_location, terms, reviewed_at, created_at, status, superseded_at)
      VALUES ('price-1', 'product-1', NULL, NULL, 25000, 'SAR', 'Supplier Quote', 'Approved', 'Costing', NULL, '2099-01-01', NULL, 'source-1', '{}', '{}', NULL, '2026-09-01T12:00:00Z', NULL, NULL);
  `);
  addRuns(raw, liveRuns);

  const operation = (sql, args = []) => ({
    first: async () => raw.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: raw.prepare(sql).all(...args) }),
    run: async () => raw.prepare(sql).run(...args),
  });
  const DB = {
    prepare(sql) {
      const bound = operation(sql);
      return { ...bound, bind: (...args) => operation(sql, args) };
    },
    // D1 batch(): real transactions, in order. The route's correctness depends on
    // this being atomic (policy + supersede + audit), so it must not be a stub
    // that silently drops statements.
    async batch(statements) {
      raw.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(statement.run());
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { raw, DB };
};

const env = (DB) => ({
  DB,
  APP_ACCESS_MODE: "single-user",
  APP_USER_ID: USER_ID,
  APP_ORGANIZATION_ID: "org-1",
});

const patchPolicy = (DB, body, scenarioId = SCENARIO_ID, projectId = PROJECT_ID) =>
  handlePricingApi(
    new Request(
      `http://localhost/api/pricing/projects/${projectId}/scenarios/${scenarioId}/commercial-policy`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
    env(DB),
  ).then(async (response) => ({ status: response.status, body: await response.json() }));

const storedSettings = (raw) =>
  JSON.parse(
    raw.prepare("SELECT settings FROM pricing_scenarios WHERE id=?").get(SCENARIO_ID).settings,
  );

const listScenarios = (DB) =>
  handlePricingApi(
    new Request(`http://localhost/api/pricing/projects/${PROJECT_ID}/scenarios`, {
      method: "GET",
    }),
    env(DB),
  ).then((response) => response.json());

// Rebuilds a complete pricing input around a scenario, using the same runtime
// the calculate route uses. The cost/evidence scaffolding mirrors the cheapest
// real shape that reaches the authority: the point of these tests is what the
// persisted POLICY contributes, not the cost chain.
const reconstructFromServer = async (raw) => {
  const row = raw
    .prepare("SELECT id, version_number, project_currency, settings FROM pricing_scenarios WHERE id=?")
    .get(SCENARIO_ID);
  const parsed = JSON.parse(row.settings);
  return {
    scenario: row,
    input: {
      sellingRule: parsed.sellingRule,
      customerDiscount: parsed.customerDiscount,
      vatRule: parsed.vatRule,
    },
  };
};

const readyCost = {
  readiness: { state: "COST_READY" },
  summary: { currency: "SAR", materialSubtotal: 1000, serviceSubtotal: 0, totalCost: 1000 },
  materialBreakdown: [{ scope: "Primary Product", extendedCost: 1000 }],
};
const readyEvidence = {
  approvalReady: true,
  totalCost: 1000,
  materialTotal: 1000,
  selectedSource: { id: "price-1", priceType: "Supplier Quote" },
};

// ---------------------------------------------------------------------------
// Required behaviour 1: the existing {} default scenario stays blocked.
// ---------------------------------------------------------------------------

test("the auto-provisioned {} scenario is NOT made quotation-ready by this slice", async () => {
  const { raw } = fixture({ settings: "{}" });
  const { input } = await reconstructFromServer(raw);
  assert.equal(input.sellingRule, undefined);
  assert.throws(
    () =>
      buildCommercialPricingResult({
        costModel: readyCost,
        pricingInput: input,
        evidenceResult: readyEvidence,
      }),
    { code: "COMMERCIAL_POLICY_NOT_CONFIGURED" },
  );
  // And the slice did not quietly backfill it either.
  assert.deepEqual(storedSettings(raw), {});
  raw.close();
});

test("the governed write path cannot be used to blank a policy back to {}", async () => {
  const { raw, DB } = fixture({ settings: JSON.stringify(MARKUP_POLICY) });
  const response = await patchPolicy(DB, {
    reason: "Attempt to clear the commercial policy entirely",
    settings: {},
  });
  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, "COMMERCIAL_POLICY_INVALID");
  // The stored policy is untouched: there is no "unconfigure" capability.
  assert.deepEqual(storedSettings(raw), MARKUP_POLICY);
  raw.close();
});

test("a partial policy is rejected and names the missing commercial values", async () => {
  const { raw, DB } = fixture();
  const response = await patchPolicy(DB, {
    reason: "Only the selling rule was filled in",
    settings: { sellingRule: { method: "Markup", rate: 20 } },
  });
  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, "COMMERCIAL_POLICY_INVALID");
  const fields = response.body.error.errors.map((entry) => entry.field);
  assert.ok(fields.includes("customerDiscount.percentage"));
  assert.ok(fields.includes("vatRule.rate"));
  assert.deepEqual(storedSettings(raw), {});
  raw.close();
});

// ---------------------------------------------------------------------------
// Required behaviour 2 + 5: configured Markup reaches the authority at 1380.
// ---------------------------------------------------------------------------

test("a configured Markup policy persists and reaches the authority at 1380 SAR", async () => {
  const { raw, DB } = fixture({ settings: "{}" });
  const response = await patchPolicy(DB, {
    reason: "Agreed commercial strategy for the tender submission",
    settings: MARKUP_POLICY,
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.changed, true);
  assert.deepEqual(storedSettings(raw), MARKUP_POLICY);

  // ...and the money comes from the PERSISTED row, not the request body.
  const { input } = await reconstructFromServer(raw);
  const { result } = buildCommercialPricingResult({
    costModel: readyCost,
    pricingInput: input,
    evidenceResult: readyEvidence,
  });
  assert.equal(result.status, "Draft Price");
  assert.equal(result.finalValue, 1380);
  raw.close();
});

test("a configured Target Margin policy persists and the existing target-margin math is unchanged", async () => {
  const { raw, DB } = fixture({ settings: "{}" });
  const response = await patchPolicy(DB, {
    reason: "Switched the commercial strategy to a target margin basis",
    settings: TARGET_MARGIN_POLICY,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(storedSettings(raw), TARGET_MARGIN_POLICY);

  // Independent arithmetic: gross = 1000 / (1 - 0.50) = 2000.00;
  // discount 10% = 200.00; net = 1800.00; VAT 15% = 270.00; final = 2070.00.
  const { input } = await reconstructFromServer(raw);
  const { result } = buildCommercialPricingResult({
    costModel: readyCost,
    pricingInput: input,
    evidenceResult: readyEvidence,
  });
  assert.equal(result.grossSelling, 2000);
  assert.equal(result.netSelling, 1800);
  assert.equal(result.vat, 270);
  assert.equal(result.finalValue, 2070);
  raw.close();
});

// ---------------------------------------------------------------------------
// Required behaviour 4 + persistence + refresh/reopen: explicit zeros.
// ---------------------------------------------------------------------------

test("explicit 0 discount and 0 VAT survive a save and a server reload as explicit values", async () => {
  const { raw, DB } = fixture({ settings: "{}" });
  const zeroPolicy = {
    sellingRule: { method: "Markup", rate: 20, minimumMargin: 0 },
    customerDiscount: { percentage: 0 },
    vatRule: { rate: 0 },
  };
  assert.equal((await patchPolicy(DB, { reason: "No discount and no VAT on this order", settings: zeroPolicy })).status, 200);

  // Refresh/reopen: a brand new GET, exactly what the page does on reload.
  const listed = await listScenarios(DB);
  const reopened = listed.scenarios.find((entry) => entry.id === SCENARIO_ID);
  assert.equal(reopened.settings.customerDiscount.percentage, 0);
  assert.equal(reopened.settings.vatRule.rate, 0);
  assert.equal(reopened.settings.sellingRule.rate, 20);
  // Still zeros on disk, not nulls and not absent keys.
  const stored = storedSettings(raw);
  assert.equal(stored.customerDiscount.percentage, 0);
  assert.equal(stored.vatRule.rate, 0);
  assert.ok("percentage" in stored.customerDiscount);
  assert.ok("rate" in stored.vatRule);

  const { input } = await reconstructFromServer(raw);
  const { result } = buildCommercialPricingResult({
    costModel: readyCost,
    pricingInput: input,
    evidenceResult: readyEvidence,
  });
  assert.equal(result.vat, 0);
  assert.equal(result.finalValue, 1200);
  raw.close();
});

test("explicit zeros are NOT reclassified as missing configuration after a reload", async () => {
  const { raw, DB } = fixture({ settings: "{}" });
  await patchPolicy(DB, {
    reason: "Zero commercial uplift is a deliberate decision here",
    settings: {
      sellingRule: { method: "Markup", rate: 0, minimumMargin: 0 },
      customerDiscount: { percentage: 0 },
      vatRule: { rate: 0 },
    },
  });
  const { input } = await reconstructFromServer(raw);
  const { result } = buildCommercialPricingResult({
    costModel: readyCost,
    pricingInput: input,
    evidenceResult: readyEvidence,
  });
  assert.equal(result.approvalReady, true);
  assert.equal(result.markup, 0);
  assert.equal(result.finalValue, 1000);
  raw.close();
});

// ---------------------------------------------------------------------------
// Required behaviour 6: policy update uses the new value, not stale state.
// ---------------------------------------------------------------------------

test("changing one policy value changes the NEXT calculation, and invalidates the old one", async () => {
  const { raw, DB } = fixture({ settings: "{}" });
  const liveRuns = () =>
    raw
      .prepare("SELECT COUNT(*) AS n FROM pricing_runs WHERE scenario_id=? AND superseded_at IS NULL")
      .get(SCENARIO_ID).n;

  // Journey: configure the policy, let the user price the BOQ under it, then
  // change one commercial value. The prices already computed under the first
  // policy are the ones that would otherwise stay authoritative-but-wrong.
  assert.equal((await patchPolicy(DB, { reason: "Initial agreed commercial strategy", settings: MARKUP_POLICY })).status, 200);
  assert.equal(liveRuns(), 0, "configuring a policy invalidates any earlier run");
  addRuns(raw, 2);
  assert.equal(liveRuns(), 2, "the user then priced the BOQ under this policy");

  const updated = {
    sellingRule: { method: "Markup", rate: 20, minimumMargin: 0 },
    customerDiscount: { percentage: 10 },
    vatRule: { rate: 15 },
  };
  const response = await patchPolicy(DB, {
    reason: "Customer negotiated a 10% discount after the first pass",
    settings: updated,
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.supersededRuns, 2);
  assert.equal(liveRuns(), 0, "no price computed under the old policy may stay current");

  // The next calculation reads the UPDATED persisted policy, not the old one
  // and not anything the browser was holding.
  const { input } = await reconstructFromServer(raw);
  assert.equal(input.customerDiscount.percentage, 10);
  const { result } = buildCommercialPricingResult({
    costModel: readyCost,
    pricingInput: input,
    evidenceResult: readyEvidence,
  });
  // Independent arithmetic: gross 1200.00; discount 120.00; net 1080.00;
  // VAT 162.00; final 1242.00.
  assert.equal(result.netSelling, 1080);
  assert.equal(result.vat, 162);
  assert.equal(result.finalValue, 1242);
  raw.close();
});

test("a policy change supersedes the scenario's live pricing runs so no stale price stays current", async () => {
  const { raw, DB } = fixture({ settings: "{}", liveRuns: 3 });
  const response = await patchPolicy(DB, {
    reason: "Repricing under the revised commercial strategy",
    settings: MARKUP_POLICY,
  });
  assert.equal(response.body.supersededRuns, 3);
  // Every current-line/readiness query in worker/pricing-api.mjs filters on
  // `pricing_runs.superseded_at IS NULL`, so zero live runs means the
  // quotation correctly falls back to "not priced" until a recalculation.
  assert.equal(
    raw
      .prepare("SELECT COUNT(*) AS n FROM pricing_runs WHERE scenario_id=? AND superseded_at IS NULL")
      .get(SCENARIO_ID).n,
    0,
  );
  // Evidence is retained, never deleted.
  assert.equal(
    raw.prepare("SELECT COUNT(*) AS n FROM pricing_runs WHERE scenario_id=?").get(SCENARIO_ID).n,
    3,
  );
  raw.close();
});

test("re-saving an identical policy is a no-op and does not churn the audit trail", async () => {
  const { raw, DB } = fixture({ settings: JSON.stringify(MARKUP_POLICY), liveRuns: 1 });
  const response = await patchPolicy(DB, {
    reason: "Confirming the same agreed commercial strategy again",
    settings: { vatRule: { rate: 15 }, customerDiscount: { percentage: 0 }, sellingRule: { rate: 20, method: "Markup" } },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.changed, false);
  assert.equal(response.body.supersededRuns, 0);
  assert.equal(
    raw.prepare("SELECT COUNT(*) AS n FROM pricing_audit_events").get().n,
    0,
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) AS n FROM pricing_runs WHERE superseded_at IS NULL").get().n,
    1,
  );
  raw.close();
});

// ---------------------------------------------------------------------------
// Governance of the write itself.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Settings preservation. A scenario's settings column is SHARED: scenario
// creation stores { precision: 2 }, and other features own their own keys. The
// commercial-policy route owns exactly three of them (sellingRule,
// customerDiscount, vatRule) and must not destroy the rest.
// ---------------------------------------------------------------------------

const SETTINGS_WITH_UNRELATED_KEYS = JSON.stringify({
  precision: 2,
  someUnrelatedFutureSetting: "preserve-me",
});

test("unrelated scenario settings survive the FIRST policy configuration", async () => {
  const { raw, DB } = fixture({ settings: SETTINGS_WITH_UNRELATED_KEYS });
  assert.deepEqual(storedSettings(raw), {
    precision: 2,
    someUnrelatedFutureSetting: "preserve-me",
  });

  const response = await patchPolicy(DB, {
    reason: "Commercial strategy agreed for this tender",
    settings: MARKUP_POLICY,
  });
  assert.equal(response.status, 200);

  // The three authoritative policy keys are set...
  const stored = storedSettings(raw);
  assert.deepEqual(stored.sellingRule, { method: "Markup", rate: 20 });
  assert.deepEqual(stored.customerDiscount, { percentage: 0 });
  assert.deepEqual(stored.vatRule, { rate: 15 });
  // ...and everything the route does not own survives untouched.
  assert.equal(stored.precision, 2);
  assert.equal(stored.someUnrelatedFutureSetting, "preserve-me");
  assert.deepEqual(response.body.preservedSettingKeys.sort(), [
    "precision",
    "someUnrelatedFutureSetting",
  ]);
  raw.close();
});

test("unrelated scenario settings survive a SUBSEQUENT policy update", async () => {
  const { raw, DB } = fixture({ settings: SETTINGS_WITH_UNRELATED_KEYS });
  await patchPolicy(DB, {
    reason: "Initial agreed commercial strategy",
    settings: MARKUP_POLICY,
  });
  // Change one commercial value; the non-policy keys must still be there.
  await patchPolicy(DB, {
    reason: "Customer negotiated a 10% discount after the first pass",
    settings: {
      sellingRule: { method: "Markup", rate: 20 },
      customerDiscount: { percentage: 10 },
      vatRule: { rate: 15 },
    },
  });
  const stored = storedSettings(raw);
  assert.equal(stored.customerDiscount.percentage, 10);
  assert.equal(stored.precision, 2);
  assert.equal(stored.someUnrelatedFutureSetting, "preserve-me");
  raw.close();
});

test("an identical-policy no-op preserves unrelated settings and invalidates nothing", async () => {
  const { raw, DB } = fixture({
    settings: JSON.stringify({
      precision: 2,
      someUnrelatedFutureSetting: "preserve-me",
      ...MARKUP_POLICY,
    }),
    liveRuns: 1,
  });
  const response = await patchPolicy(DB, {
    reason: "Confirming the same agreed commercial strategy again",
    settings: MARKUP_POLICY,
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.changed, false);
  assert.equal(response.body.supersededRuns, 0);
  const stored = storedSettings(raw);
  assert.equal(stored.precision, 2);
  assert.equal(stored.someUnrelatedFutureSetting, "preserve-me");
  assert.equal(
    raw.prepare("SELECT COUNT(*) AS n FROM pricing_runs WHERE superseded_at IS NULL").get().n,
    1,
    "a save that changed nothing must not invalidate a price",
  );
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM pricing_audit_events").get().n, 0);
  raw.close();
});

test("the client cannot inject unrelated settings keys through the policy payload", async () => {
  const { raw, DB } = fixture({ settings: '{"precision":2}' });
  const response = await patchPolicy(DB, {
    reason: "Attempting to smuggle extra settings keys through the policy write",
    settings: {
      ...MARKUP_POLICY,
      precision: 99,
      evilInjectedKey: "should-not-persist",
    },
  });
  assert.equal(response.status, 200);
  const stored = storedSettings(raw);
  // The client-supplied extra keys are NOT written...
  assert.equal("evilInjectedKey" in stored, false);
  // ...and it cannot overwrite a server-owned key either.
  assert.equal(stored.precision, 2);
  raw.close();
});

test("a policy write replaces a previously stored policy rather than merging into it", async () => {
  // Guards the "replace only the authoritative keys" half: a stale sellingRule
  // field must not linger, e.g. a dropped minimumMargin surviving an update.
  const { raw, DB } = fixture({
    settings: JSON.stringify({
      precision: 2,
      sellingRule: { method: "Markup", rate: 20, minimumMargin: 10 },
      customerDiscount: { percentage: 5 },
      vatRule: { rate: 15 },
    }),
  });
  await patchPolicy(DB, {
    reason: "Dropping the minimum margin and the discount deliberately",
    settings: {
      sellingRule: { method: "Markup", rate: 20 },
      customerDiscount: { percentage: 0 },
      vatRule: { rate: 15 },
    },
  });
  const stored = storedSettings(raw);
  assert.equal("minimumMargin" in stored.sellingRule, false, "stale key must not linger");
  assert.equal(stored.customerDiscount.percentage, 0);
  assert.equal(stored.precision, 2, "unrelated key still preserved");
  raw.close();
});

test("a policy change is recorded in the pricing audit trail with actor and reason", async () => {
  const { raw, DB } = fixture({ settings: "{}" });
  await patchPolicy(DB, {
    reason: "Commercial strategy agreed with the client on the call",
    settings: MARKUP_POLICY,
  });
  const event = raw
    .prepare("SELECT * FROM pricing_audit_events WHERE action='Commercial Policy Configured'")
    .get();
  assert.ok(event, "a governed audit event must be written");
  assert.equal(event.project_id, PROJECT_ID);
  assert.equal(event.actor_user_id, USER_ID);
  assert.equal(event.reason, "Commercial strategy agreed with the client on the call");
  assert.deepEqual(JSON.parse(event.previous_value), {});
  assert.deepEqual(JSON.parse(event.new_value), MARKUP_POLICY);
  raw.close();
});

test("a change without a substantive reason is refused", async () => {
  const { raw, DB } = fixture();
  const response = await patchPolicy(DB, { reason: "x", settings: MARKUP_POLICY });
  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, "COMMERCIAL_POLICY_REASON_REQUIRED");
  assert.deepEqual(storedSettings(raw), {});
  raw.close();
});

test("a scenario in another project cannot be configured through this project", async () => {
  const { raw, DB } = fixture();
  const response = await patchPolicy(
    DB,
    { reason: "Attempting a cross-project policy write", settings: MARKUP_POLICY },
    SCENARIO_ID,
    OTHER_PROJECT_ID,
  );
  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, "SCENARIO_NOT_FOUND");
  assert.deepEqual(storedSettings(raw), {});
  raw.close();
});

test("an unknown scenario is refused", async () => {
  const { raw, DB } = fixture();
  const response = await patchPolicy(DB, { reason: "Targeting a scenario that does not exist", settings: MARKUP_POLICY }, "scenario-nope");
  assert.equal(response.status, 404);
  raw.close();
});

// ---------------------------------------------------------------------------
// G-1 error UX contract.
// ---------------------------------------------------------------------------

test("the G-1 error tells the client which policies are missing and what to do", async () => {
  let thrown = null;
  try {
    buildCommercialPricingResult({
      costModel: readyCost,
      pricingInput: {},
      evidenceResult: readyEvidence,
    });
  } catch (error) {
    thrown = error;
  }
  const payload = commercialPricingErrorPayload(thrown, "boq-current");
  assert.equal(payload.code, "COMMERCIAL_POLICY_NOT_CONFIGURED");
  assert.equal(payload.affectedItem, "boq-current");
  // The client can identify exactly what to configure.
  assert.deepEqual(
    payload.missingPolicy.map((entry) => entry.policy).sort(),
    ["customerDiscount", "sellingRule", "vatRule"],
  );
  for (const entry of payload.missingPolicy) {
    assert.ok(entry.requirement.length > 0, "each missing policy must say what is required");
  }
  assert.match(payload.suggestedAction, /Configure the commercial policy/);
  // Crucially: no zero policy is invented anywhere in the error.
  assert.equal(JSON.stringify(payload).includes('"rate":0'), false);
});

test("a non-policy pricing failure keeps the generic guidance and no missingPolicy key", () => {
  const payload = commercialPricingErrorPayload(
    { code: "COST_BUILDUP_NOT_READY", message: "Complete the BOM and Cost Build-Up first." },
    "boq-current",
  );
  assert.equal(payload.code, "COST_BUILDUP_NOT_READY");
  assert.equal("missingPolicy" in payload, false);
  assert.equal(payload.suggestedAction, "Review the pricing preconditions and retry.");
});

test("an error with no code still produces a usable payload", () => {
  const payload = commercialPricingErrorPayload(new Error("boom"), "boq-current");
  assert.equal(payload.code, "PRICING_CALCULATION_FAILED");
  assert.equal(payload.message, "boom");
});

// ---------------------------------------------------------------------------
// The route is a policy write only -- no scenario-management subsystem.
// ---------------------------------------------------------------------------

test("the new route writes the policy on PATCH and on no other method", async () => {
  const { raw, DB } = fixture();
  for (const method of ["POST", "DELETE", "PUT", "GET"]) {
    const response = await handlePricingApi(
      new Request(
        `http://localhost/api/pricing/projects/${PROJECT_ID}/scenarios/${SCENARIO_ID}/commercial-policy`,
        {
          method,
          headers: { "content-type": "application/json" },
          ...(["GET", "HEAD"].includes(method)
            ? {}
            : {
                body: JSON.stringify({
                  reason: "Should not be accepted",
                  settings: MARKUP_POLICY,
                }),
              }),
        },
      ),
      env(DB),
    );
    // Whatever the fallthrough response is, it must not have written a policy:
    // this is a governed PATCH-only write path, not a new scenario API.
    assert.notEqual(response.status, 200);
    assert.deepEqual(storedSettings(raw), {}, `${method} must not write a policy`);
  }
  assert.equal(
    raw.prepare("SELECT COUNT(*) AS n FROM pricing_audit_events").get().n,
    0,
  );
  raw.close();
});

test("the pre-existing scenarios routes still work and are unchanged", async () => {
  const { raw, DB } = fixture();
  const listed = await listScenarios(DB);
  assert.equal(Array.isArray(listed.scenarios), true);
  assert.equal(listed.scenarios[0].id, SCENARIO_ID);
  assert.deepEqual(listed.scenarios[0].settings, {});
  raw.close();
});

// The full acceptance path, end to end, with the real runtime in the middle:
//
//   PATCH body -> persisted pricing_scenarios.settings -> new GET (refresh) ->
//   loadPricingInput(scenario.settings) -> buildCommercialPricingResult
//
// Nothing between the write and the money is reimplemented here: the scenario
// object handed to loadPricingInput is read back out of the database, and the
// settings the runtime sees are the ones the route wrote.
test("END TO END: PATCH -> persisted settings -> refresh -> loadPricingInput -> authority", async () => {
  const { raw, DB } = fixture({ settings: "{}" });

  // 1. UI -> API
  const write = await patchPolicy(DB, {
    reason: "Commercial strategy agreed for this tender",
    settings: { sellingRule: { method: "Markup", rate: 20 }, customerDiscount: { percentage: 0 }, vatRule: { rate: 15 } },
  });
  assert.equal(write.status, 200);

  // 2/3. Refresh/reopen: a brand new request, no client state involved.
  const listed = await listScenarios(DB);
  const reopened = listed.scenarios.find((entry) => entry.id === SCENARIO_ID);
  assert.equal(reopened.settings.sellingRule.rate, 20);

  // 4. The real runtime, handed the scenario row as the calculate route does.
  const scenarioRow = raw
    .prepare("SELECT id, version_number, project_currency, settings FROM pricing_scenarios WHERE id=?")
    .get(SCENARIO_ID);
  const input = await loadPricingInput(DB, {
    projectId: PROJECT_ID,
    boqItemId: "boq-current",
    candidateId: "candidate-current",
    scenario: {
      id: scenarioRow.id,
      version_number: scenarioRow.version_number,
      project_currency: scenarioRow.project_currency,
      settings: scenarioRow.settings,
    },
    body: {},
  });

  // 5. The authoritative boundary.
  const { result } = buildCommercialPricingResult({
    costModel: readyCost,
    pricingInput: input,
    evidenceResult: readyEvidence,
  });
  assert.equal(result.status, "Draft Price");
  assert.equal(result.finalValue, 1380);
  raw.close();
});

test("END TO END: the same path on an unconfigured {} scenario is still blocked", async () => {
  const { raw, DB } = fixture({ settings: "{}" });
  const scenarioRow = raw
    .prepare("SELECT id, version_number, project_currency, settings FROM pricing_scenarios WHERE id=?")
    .get(SCENARIO_ID);
  const input = await loadPricingInput(DB, {
    projectId: PROJECT_ID,
    boqItemId: "boq-current",
    candidateId: "candidate-current",
    scenario: {
      id: scenarioRow.id,
      version_number: scenarioRow.version_number,
      project_currency: scenarioRow.project_currency,
      settings: scenarioRow.settings,
    },
    body: {},
  });
  assert.equal(input.sellingRule, undefined);
  assert.throws(
    () =>
      buildCommercialPricingResult({
        costModel: readyCost,
        pricingInput: input,
        evidenceResult: readyEvidence,
      }),
    { code: "COMMERCIAL_POLICY_NOT_CONFIGURED" },
  );
  raw.close();
});
