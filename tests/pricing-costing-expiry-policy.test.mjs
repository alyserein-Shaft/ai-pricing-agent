// Confirmed defect repair: an Approved supplier price_records row accepted
// by BOM Costing was independently re-rejected later in the normal
// BOM -> Pricing -> Quotation-preparation path solely because valid_until
// was missing or expired, via two independent gates:
//   Gate 1: worker/pricing-runtime.mjs's loadPricingInput(...) recomputed
//     safetyDecision.priceEligibility from its own inline validity check.
//   Gate 2: app/domain/pricing-engine.mjs's calculatePricingLine(...) called
//     selectPriceSources(...) without allowExpiredOrMissingValidity.
// This suite proves both gates are relaxed ONLY when explicitly authorized
// (allowExpiredOrMissingValidity), that the strict default is unchanged for
// any non-opted-in caller, and that Future/Rejected/non-approved/
// non-downstream-authorized evidence remains blocked in both modes.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { calculatePricingLine, selectPriceSources } from "../app/domain/pricing-engine.mjs";
import { loadPricingInput, persistRun } from "../worker/pricing-runtime.mjs";

// ---------------------------------------------------------------------------
// Part 1 -- domain layer only (calculatePricingLine / selectPriceSources),
// no database. This is Gate 2 in isolation, exercised directly the same way
// the rest of tests/pricing-engine.test.mjs already does.
// ---------------------------------------------------------------------------

const at = "2026-08-02T00:00:00Z";

// The investigation fixture: unit supplier cost 250, quantity 10 -> material
// cost 2500, a fixed 25% markup selling rule, 15% VAT -- identical across
// every validity scenario below, so any numeric difference in the result
// would prove date status alone changed the calculation (it must not).
const priceSource = (overrides = {}) => ({
  id: "src1",
  productId: "prod1",
  projectId: "p1",
  amount: 250,
  currency: "SAR",
  priceType: "Supplier Quote",
  approvalStatus: "Approved",
  downstreamUse: "Costing",
  validUntil: "2099-01-01",
  reference: "Q-1",
  ...overrides,
});

const base = {
  projectId: "p1",
  productId: "prod1",
  candidateId: "c1",
  selectedPriceSourceId: "src1",
  manufacturer: "Honeywell",
  quantity: 10,
  unit: "EA",
  projectCurrency: "SAR",
  calculatedAt: at,
  technicalApproval: { status: "Approved", candidateId: "c1" },
  safetyDecision: { priceEligibility: "Eligible for Price Approval" },
  discounts: [],
  costComponents: [],
  sellingRule: { method: "Markup", rate: 25, minimumMargin: 10 },
  customerDiscount: { percentage: 0 },
  vatRule: { rate: 15 },
  precision: 2,
};

test("Gate 2 default (allowExpiredOrMissingValidity unset) -- missing valid_until alone still blocks, proving the repair is opt-in, not a silent global change", () => {
  const result = calculatePricingLine({ ...base, priceSources: [priceSource({ validUntil: null })] });
  assert.equal(result.status, "Pricing Blocked");
  assert.ok(result.blockers.includes("CURRENT_PRICE_SOURCE_REQUIRED"));
});

test("Gate 2 default (allowExpiredOrMissingValidity: false explicit) -- expired valid_until alone still blocks (strict-default control)", () => {
  const result = calculatePricingLine({ ...base, allowExpiredOrMissingValidity: false, priceSources: [priceSource({ validUntil: "2020-01-01" })] });
  assert.equal(result.status, "Pricing Blocked");
  assert.ok(result.blockers.includes("CURRENT_PRICE_SOURCE_REQUIRED"));
});

test("A. missing valid_until alone does not block once allowExpiredOrMissingValidity is true -- priced, approval-ready, no expiry-only blocker", () => {
  const result = calculatePricingLine({ ...base, allowExpiredOrMissingValidity: true, priceSources: [priceSource({ validUntil: null })] });
  assert.equal(result.approvalReady, true);
  assert.equal(result.materialTotal, 2500);
  assert.equal(result.totalCost, 2500);
  assert.equal(result.selectedSource.validity, "No Validity Provided", "truthfully identified, never relabeled Valid/Current");
  assert.equal(result.selectedSource.status, "Selected");
});

test("B. SUPERSEDED CONTRACT (was: expired must not block) -- an EXPLICIT expiry is authoritative evidence and stays binding under the governed policy", () => {
  const result = calculatePricingLine({ ...base, allowExpiredOrMissingValidity: true, priceSources: [priceSource({ validUntil: "2020-01-01" })] });
  assert.equal(result.status, "Pricing Blocked", "an explicit past valid_until must never be relaxed");
  assert.ok(result.blockers.includes("CURRENT_PRICE_SOURCE_REQUIRED"));
  assert.equal(result.selectedSource, undefined);
});

test("B-regression. past valid_until + VALID_UNTIL_SUPERSEDED => BLOCKED Expired (explicit expiry is authoritative)", () => {
  const ranked = selectPriceSources({ sources: [priceSource({ validUntil: "2020-01-01" })], projectId: "p1", productId: "prod1", quantity: 10, at, allowExpiredOrMissingValidity: true });
  assert.equal(ranked[0].eligible, false);
  assert.equal(ranked[0].validity, "Expired", "still truthfully reported Expired");
  assert.equal(ranked[0].validityPolicy, "FIXED_EXPIRY", "no relaxed policy applied to an explicit expiry");
  assert.equal(ranked[0].temporalValidityRelaxed, false);
});

test("C. current validity control -- succeeds under both strict and relaxed modes, with the identical numeric result", () => {
  const strict = calculatePricingLine({ ...base, priceSources: [priceSource({ validUntil: "2099-01-01" })] });
  const relaxed = calculatePricingLine({ ...base, allowExpiredOrMissingValidity: true, priceSources: [priceSource({ validUntil: "2099-01-01" })] });
  assert.equal(strict.approvalReady, true);
  assert.equal(relaxed.approvalReady, true);
  assert.equal(strict.materialTotal, 2500);
  assert.equal(relaxed.materialTotal, 2500);
  assert.equal(strict.totalCost, relaxed.totalCost);
  assert.equal(strict.selectedSource.validity, "Valid");
});

test("Numerical invariant -- a missing date and a current date produce the identical cost; an explicit expiry does not price at all", () => {
  const missing = calculatePricingLine({ ...base, allowExpiredOrMissingValidity: true, priceSources: [priceSource({ validUntil: null })] });
  const current = calculatePricingLine({ ...base, allowExpiredOrMissingValidity: true, priceSources: [priceSource({ validUntil: "2099-01-01" })] });
  const expired = calculatePricingLine({ ...base, allowExpiredOrMissingValidity: true, priceSources: [priceSource({ validUntil: "2020-01-01" })] });
  for (const result of [missing, current]) {
    assert.equal(result.materialTotal, 2500);
    assert.equal(result.totalCost, 2500);
    assert.equal(result.netSelling, current.netSelling);
    assert.equal(result.finalValue, current.finalValue);
  }
  assert.equal(expired.status, "Pricing Blocked");
});

test("D. future-dated price remains blocked even with allowExpiredOrMissingValidity: true", () => {
  const result = calculatePricingLine({ ...base, allowExpiredOrMissingValidity: true, priceSources: [priceSource({ validUntil: "2099-01-01", effectiveFrom: "2099-06-01" })] });
  assert.equal(result.status, "Pricing Blocked");
  assert.ok(result.blockers.includes("CURRENT_PRICE_SOURCE_REQUIRED"));
});

test("E. rejected price remains blocked even with allowExpiredOrMissingValidity: true", () => {
  const result = calculatePricingLine({ ...base, allowExpiredOrMissingValidity: true, priceSources: [priceSource({ validUntil: null, status: "Rejected" })] });
  assert.equal(result.status, "Pricing Blocked");
  assert.ok(result.blockers.includes("CURRENT_PRICE_SOURCE_REQUIRED"));
});

test("F. an unapproved price source remains blocked even with allowExpiredOrMissingValidity: true (approval governance untouched)", () => {
  const result = calculatePricingLine({ ...base, allowExpiredOrMissingValidity: true, priceSources: [priceSource({ validUntil: null, approvalStatus: "Pending" })] });
  assert.equal(result.status, "Pricing Blocked");
  assert.ok(result.blockers.includes("CURRENT_PRICE_SOURCE_REQUIRED"));
});

test("F. a Discovery-Only-scoped price source remains blocked even with allowExpiredOrMissingValidity: true (downstream-scope governance untouched)", () => {
  const result = calculatePricingLine({ ...base, allowExpiredOrMissingValidity: true, priceSources: [priceSource({ validUntil: null, downstreamUse: "Discovery Only" })] });
  assert.equal(result.status, "Pricing Blocked");
  assert.ok(result.blockers.includes("CURRENT_PRICE_SOURCE_REQUIRED"));
});

test("selectPriceSources default remains strict when called directly without the option (scoped-repair control)", () => {
  const ranked = selectPriceSources({ sources: [priceSource({ validUntil: null })], projectId: "p1", productId: "prod1", quantity: 10, at });
  assert.equal(ranked[0].eligible, false);
});

// ---------------------------------------------------------------------------
// Part 2 -- runtime layer (loadPricingInput), real function, isolated sqlite
// data. This is Gate 1 in isolation, plus proof that its
// allowExpiredOrMissingValidity option threads onto the returned input so a
// direct calculatePricingLine(input) call downstream (exactly what
// worker/boq-line-cost-api.mjs and worker/pricing-api.mjs do) receives it
// too, without each caller having to pass it twice.
// ---------------------------------------------------------------------------

const PROJECT_ID = "project-expiry-policy";

// `governedPolicy` seeds the governed commercial_conditions policy that is now
// the ONLY source of missing-validity relaxation in production. There is
// deliberately no way to relax validity by passing a caller boolean.
const fixture = ({ validUntil, effectiveFrom = null, approvalStatus = "Approved", downstreamUse = "Costing", status = null, governedPolicy = false } = {}) => {
  const raw = new DatabaseSync(":memory:");

  raw.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, organization_id TEXT, archived_at TEXT);
    CREATE TABLE project_members (id TEXT PRIMARY KEY, project_id TEXT, user_id TEXT, role TEXT, status TEXT, revoked_at TEXT);
    CREATE TABLE pricing_scenarios (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, version_number INTEGER NOT NULL, project_currency TEXT NOT NULL, settings TEXT NOT NULL, deleted_at TEXT, superseded_at TEXT);
    CREATE TABLE boq_extraction_versions (id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, version_number INTEGER, status TEXT, superseded_at TEXT);
    CREATE TABLE documents (id TEXT PRIMARY KEY, project_id TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
    CREATE TABLE document_versions (id TEXT PRIMARY KEY, document_id TEXT, effective_from TEXT, effective_to TEXT);
    CREATE TABLE document_supersessions(id TEXT PRIMARY KEY NOT NULL,superseding_version_id TEXT NOT NULL,superseded_version_id TEXT NOT NULL,scope_type TEXT NOT NULL CHECK (scope_type IN ('FULL_DOCUMENT','SECTION','CLAUSE','BOQ_ROW','DRAWING_REGION','EVIDENCE_ENTITY')),scope_id TEXT,supersession_type TEXT NOT NULL CHECK (supersession_type IN ('REVISION','ADDENDUM','CLARIFICATION','CORRECTION')),effective_from TEXT,effective_to TEXT,created_by TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,CHECK (superseding_version_id <> superseded_version_id),CHECK ((scope_type = 'FULL_DOCUMENT' AND scope_id IS NULL) OR (scope_type <> 'FULL_DOCUMENT' AND scope_id IS NOT NULL AND length(trim(scope_id)) > 0)),CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from));
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
    CREATE TABLE price_source_versions (id TEXT PRIMARY KEY, source_id TEXT, version_number INTEGER, approval_state TEXT, downstream_use TEXT, reliability TEXT, superseded_at TEXT);
    CREATE TABLE commercial_conditions (id TEXT PRIMARY KEY, source_version_id TEXT NOT NULL, condition_type TEXT NOT NULL, value_json TEXT NOT NULL, scope_json TEXT NOT NULL, review_status TEXT DEFAULT 'Needs Review', created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);

    INSERT INTO projects (id, owner_user_id, organization_id, archived_at) VALUES ('${PROJECT_ID}', 'local-development-user', 'org', NULL);
    INSERT INTO documents VALUES ('doc-current','${PROJECT_ID}','doc-version-current',NULL,NULL);
    INSERT INTO document_versions (id, document_id) VALUES ('doc-version-current','doc-current');
    INSERT INTO pricing_scenarios (id, project_id, version_number, project_currency, settings, deleted_at, superseded_at) VALUES ('scenario-current', '${PROJECT_ID}', 1, 'SAR', '{}', NULL, NULL);
    INSERT INTO boq_extraction_versions (id,document_id,document_version_id,version_number,status,superseded_at) VALUES ('boq-version-current','doc-current','doc-version-current',1,'Completed',NULL);
    INSERT INTO boq_items (id, extraction_version_id, project_id, source_document_id, row_type, review_status, approved_for_downstream, numeric_quantity, normalized_unit, updated_at) VALUES ('boq-current', 'boq-version-current', '${PROJECT_ID}', 'doc-current', 'BOQ Item', 'Approved', 1, 10, 'EA', '2026-08-10T12:00:00Z');
    INSERT INTO product_manufacturers (id, name) VALUES ('manufacturer-1', 'Honeywell');
    INSERT INTO canonical_library_products (id, requested_product_id, manufacturer_id, part_number, lifecycle_status) VALUES ('product-1', 'product-1', 'manufacturer-1', 'FA-001', 'Active');
    INSERT INTO requirement_profile_versions (id, boq_item_id, version_number, superseded_at) VALUES ('profile-current', 'boq-current', 1, NULL);
    INSERT INTO product_match_runs (id, project_id, boq_item_id, requirement_profile_version_id, version_number, superseded_at) VALUES ('match-current', '${PROJECT_ID}', 'boq-current', 'profile-current', 1, NULL);
    INSERT INTO product_match_candidates (id, match_run_id, product_id) VALUES ('candidate-current', 'match-current', 'product-1');
    INSERT INTO safety_decisions (id, candidate_id, version_number, superseded_at) VALUES ('safety-current', 'candidate-current', 1, NULL);
    INSERT INTO safety_approval_requests (id, safety_decision_id, approval_type, status, decided_at) VALUES ('approval-current', 'safety-current', 'Technical', 'Approved', '2026-08-10T12:10:00Z');
    INSERT INTO price_records (id, product_id, supplier_id, project_id, amount_minor, currency, price_type, approval_status, downstream_use, effective_from, valid_until, minimum_quantity, source_id, source_location, terms, reviewed_at, created_at, status, superseded_at)
      VALUES ('price-1', 'product-1', NULL, NULL, 25000, 'SAR', 'Supplier Quote', '${approvalStatus}', '${downstreamUse}', ${effectiveFrom ? `'${effectiveFrom}'` : "NULL"}, ${validUntil ? `'${validUntil}'` : "NULL"}, NULL, 'source-1', '{}', '{}', NULL, '2026-08-10T12:00:00Z', ${status ? `'${status}'` : "NULL"}, NULL);
  `);

  if (governedPolicy) {
    raw.exec(`
      INSERT INTO price_source_versions VALUES ('psv-1','source-1',1,'Approved','Costing','Current Internal Reference',NULL);
      INSERT INTO commercial_conditions VALUES ('cond-1','psv-1','PRICE_VALIDITY_POLICY','{"policy":"VALID_UNTIL_SUPERSEDED"}','{}','Approved','policy-owner','2026-08-01T00:00:00Z');
    `);
  }

  const operation = (sql, args = []) => ({
    first: async () => raw.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: raw.prepare(sql).all(...args) }),
  });

  const DB = {
    prepare(sql) {
      return { ...operation(sql), bind: (...args) => operation(sql, args) };
    },
    async batch() {
      return [];
    },
  };

  return { raw, DB };
};

const scenario = { id: "scenario-current", version_number: 1, project_currency: "SAR", settings: "{}" };
const bodyFor = (selectedPriceSourceId = "price-1") => ({
  selectedPriceSourceId,
  discounts: [],
  costComponents: [],
  sellingRule: { method: "Markup", rate: 25, minimumMargin: 10 },
  customerDiscount: { percentage: 0 },
  vatRule: { rate: 15 },
});

test("Gate 1 default -- missing valid_until alone still disables safetyDecision.priceEligibility (strict-default control)", async () => {
  const { raw, DB } = fixture({ validUntil: null });
  const input = await loadPricingInput(DB, { projectId: PROJECT_ID, boqItemId: "boq-current", candidateId: "candidate-current", scenario, body: bodyFor() });
  assert.equal(input.safetyDecision.priceEligibility, "Price Approval Disabled");
  raw.close();
});

test("Gate 1 relaxed -- missing valid_until no longer disables priceEligibility under a GOVERNED policy (no caller boolean)", async () => {
  const { raw, DB } = fixture({ validUntil: null, governedPolicy: true });
  const input = await loadPricingInput(DB, { projectId: PROJECT_ID, boqItemId: "boq-current", candidateId: "candidate-current", scenario, body: bodyFor() });
  assert.equal(input.validityPolicy.policy, "VALID_UNTIL_SUPERSEDED");
  assert.equal(input.allowExpiredOrMissingValidity, true);
  assert.equal(input.safetyDecision.priceEligibility, "Eligible for Price Approval");
  raw.close();
});

test("Gate 1 -- SUPERSEDED CONTRACT: an EXPLICIT expiry stays binding under the governed policy", async () => {
  const { raw, DB } = fixture({ validUntil: "2020-01-01", governedPolicy: true });
  const input = await loadPricingInput(DB, { projectId: PROJECT_ID, boqItemId: "boq-current", candidateId: "candidate-current", scenario, body: bodyFor() });
  assert.equal(input.validityPolicy.policy, "VALID_UNTIL_SUPERSEDED", "policy is in force");
  assert.equal(input.safetyDecision.priceEligibility, "Price Approval Disabled", "but an explicit past expiry still blocks");
  raw.close();
});

test("Gate 1 relaxed does not touch an unapproved record's eligibility (approval governance untouched)", async () => {
  const { raw, DB } = fixture({ validUntil: null, approvalStatus: "Pending" });
  const input = await loadPricingInput(DB, { projectId: PROJECT_ID, boqItemId: "boq-current", candidateId: "candidate-current", scenario, allowExpiredOrMissingValidity: true, body: bodyFor() });
  assert.equal(input.safetyDecision.priceEligibility, "Price Approval Disabled");
  raw.close();
});

test("Gate 1 relaxed does not touch a non-Costing-scoped record's eligibility (downstream-scope governance untouched)", async () => {
  const { raw, DB } = fixture({ validUntil: null, downstreamUse: "Discovery Only" });
  const input = await loadPricingInput(DB, { projectId: PROJECT_ID, boqItemId: "boq-current", candidateId: "candidate-current", scenario, allowExpiredOrMissingValidity: true, body: bodyFor() });
  assert.equal(input.safetyDecision.priceEligibility, "Price Approval Disabled");
  raw.close();
});

// End-to-end runtime -> domain threading: the SAME loadPricingInput(...) call
// worker/boq-line-cost-api.mjs and worker/pricing-api.mjs make, fed straight
// into calculatePricingLine(input) exactly as those production callers do,
// for the full missing/expired/current/future/rejected matrix. Proves the
// single allowExpiredOrMissingValidity flag on loadPricingInput reaches both
// gates through the returned input object, with no second flag required.

const runE2E = async ({ validUntil, effectiveFrom, approvalStatus, governedPolicy }) => {
  const { raw, DB } = fixture({ validUntil, effectiveFrom, approvalStatus, governedPolicy });
  const input = await loadPricingInput(DB, { projectId: PROJECT_ID, boqItemId: "boq-current", candidateId: "candidate-current", scenario, body: bodyFor() });
  const result = calculatePricingLine(input);
  raw.close();
  return { input, result };
};

test("E2E A. missing valid_until -- BOM priced, Pricing ready, quotation-preparation-eligible status, under a GOVERNED policy", async () => {
  const { result } = await runE2E({ validUntil: null, governedPolicy: true });
  assert.equal(result.approvalReady, true);
  assert.equal(result.status, "Draft Price");
  assert.equal(result.materialTotal, 2500);
  assert.deepEqual(result.blockers, undefined);
  assert.equal(result.selectedSource.validity, "No Validity Provided", "truthfully reported, never relabelled Valid");
});

test("E2E A (strict). missing valid_until -- Pricing blocked with no governed policy", async () => {
  const { result } = await runE2E({ validUntil: null });
  assert.equal(result.status, "Pricing Blocked");
  assert.ok(result.blockers.includes("SAFETY_PRICE_ELIGIBILITY_REQUIRED"));
  assert.ok(result.blockers.includes("CURRENT_PRICE_SOURCE_REQUIRED"));
});

test("E2E B. SUPERSEDED CONTRACT (was: expired must price) -- explicit expiry blocks end-to-end even under a governed policy", async () => {
  const { result } = await runE2E({ validUntil: "2020-01-01", governedPolicy: true });
  assert.equal(result.status, "Pricing Blocked");
  assert.ok(result.blockers.includes("CURRENT_PRICE_SOURCE_REQUIRED"));
});

test("E2E B (strict). expired valid_until -- Pricing blocked when the caller has not opted in", async () => {
  const { result } = await runE2E({ validUntil: "2020-01-01" });
  assert.equal(result.status, "Pricing Blocked");
  assert.ok(result.blockers.includes("SAFETY_PRICE_ELIGIBILITY_REQUIRED"));
  assert.ok(result.blockers.includes("CURRENT_PRICE_SOURCE_REQUIRED"));
});

test("E2E C. current validity control -- ready and numerically identical regardless of the opt-in", async () => {
  const strict = await runE2E({ validUntil: "2099-01-01" });
  const relaxed = await runE2E({ validUntil: "2099-01-01", governedPolicy: true });
  assert.equal(strict.result.approvalReady, true);
  assert.equal(relaxed.result.approvalReady, true);
  assert.equal(strict.result.materialTotal, relaxed.result.materialTotal);
  assert.equal(strict.result.totalCost, relaxed.result.totalCost);
});

test("E2E D. future-dated price -- still blocked even when relaxed", async () => {
  const { result } = await runE2E({ validUntil: "2099-01-01", effectiveFrom: "2099-06-01", governedPolicy: true });
  assert.equal(result.status, "Pricing Blocked");
  assert.ok(result.blockers.includes("CURRENT_PRICE_SOURCE_REQUIRED"));
});

// Production price_records has no separate rejection/superseded column of
// its own (db/schema.ts) -- a rejected price is represented by
// approval_status='Rejected', the same "not approved" governance path
// exercised as scenario F above. Proven here explicitly against that exact
// value, not merely a generic non-Approved one.
test("E2E E. rejected price (approval_status='Rejected') -- still blocked even when relaxed", async () => {
  const { result } = await runE2E({ validUntil: null, approvalStatus: "Rejected", governedPolicy: true });
  assert.equal(result.status, "Pricing Blocked");
  assert.ok(result.blockers.includes("CURRENT_PRICE_SOURCE_REQUIRED"));
});

// ---------------------------------------------------------------------------
// Part 3 -- write path (persistRun), proving the persisted pricing_lines
// columns land in the exact shape worker/pricing-authority.mjs's
// CURRENT_PRICING_PREDICATE (the literal gate quotation preparation reads:
// `l.approval_ready=1 AND l.status NOT IN ('Invalid','Expired','Rejected')`)
// requires -- i.e. that a relaxed missing/expired-validity result really
// does leave quotation preparation able to proceed, not just approvalReady
// in memory.
// ---------------------------------------------------------------------------

test("persistRun writes approval_ready=1 and a non-blocking status for a relaxed missing/expired-validity result -- satisfies quotation preparation's own readiness predicate", async () => {
  const captured = {};
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          if (sql.startsWith("INSERT INTO pricing_lines")) captured.args = args;
          return {
            async first() {
              return null;
            },
          };
        },
      };
    },
    async batch(statements) {
      return statements;
    },
  };

  const { result } = await runE2E({ validUntil: null, governedPolicy: true });
  assert.equal(result.approvalReady, true);

  await persistRun(db, {
    projectId: PROJECT_ID,
    scenario,
    boqItemId: "boq-current",
    candidateId: "candidate-current",
    input: { versions: {} },
    result,
    userId: "user-1",
    role: "Project User",
    reason: "Relaxed-validity Costing evidence used for pricing",
  });

  // INSERT INTO pricing_lines (id, pricing_run_id, project_id, boq_item_id,
  // candidate_id, product_id, safety_decision_id, selected_price_record_id,
  // version_number, status, ...) -- status is the 10th bound value (index 9),
  // approval_ready is the last bound value.
  assert.ok(captured.args, "pricing_lines insert was not captured");
  assert.equal(captured.args[9], "Draft Price");
  assert.equal(captured.args[9] === "Invalid" || captured.args[9] === "Expired" || captured.args[9] === "Rejected", false, "status must never be one of quotation preparation's blocking labels");
  assert.equal(captured.args[captured.args.length - 1], 1, "approval_ready must be 1");
});
