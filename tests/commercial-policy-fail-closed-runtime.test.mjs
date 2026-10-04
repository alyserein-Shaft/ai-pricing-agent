// G-1 repair -- runtime proof.
//
// worker/pricing-runtime.mjs used to invent { Markup, 0, 0 } / { percentage: 0 }
// / { rate: 0 } when a scenario supplied no commercial policy, which made an
// unconfigured scenario reach the authoritative money path as an approval-ready
// price with zero margin. This suite pins the runtime contract that replaced it:
// absence is passed through as absence, and the authoritative boundary is what
// fails closed.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { loadPricingInput } from "../worker/pricing-runtime.mjs";
import { buildCommercialPricingResult } from "../app/domain/commercial-pricing-authority.mjs";

// direct calculatePricingLine(input) call downstream (exactly what
// worker/boq-line-cost-api.mjs and worker/pricing-api.mjs do) receives it
// too, without each caller having to pass it twice.
// ---------------------------------------------------------------------------

const PROJECT_ID = "project-expiry-policy";

const fixture = ({ validUntil, effectiveFrom = null, approvalStatus = "Approved", downstreamUse = "Costing", status = null } = {}) => {
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

const scenario = {
  id: "scenario-current",
  version_number: 1,
  project_currency: "SAR",
  settings: "{}",
};

const loadInput = async (body, settings = "{}") => {
  const { raw, DB } = fixture({ validUntil: "2099-01-01" });
  const input = await loadPricingInput(DB, {
    projectId: PROJECT_ID,
    boqItemId: "boq-current",
    candidateId: "candidate-current",
    scenario: { ...scenario, settings },
    body,
  });
  raw.close();
  return input;
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

test("G-1 runtime: an unconfigured scenario produces NO commercial policy at all", async () => {
  const input = await loadInput({});
  assert.equal(input.sellingRule, undefined);
  assert.equal(input.customerDiscount, undefined);
  assert.equal(input.vatRule, undefined);
});

test("G-1 runtime: scenario settings carrying only unrelated fields still yield no policy", async () => {
  const input = await loadInput({}, JSON.stringify({ precision: 2, region: "KSA" }));
  assert.equal(input.sellingRule, undefined);
  assert.equal(input.customerDiscount, undefined);
  assert.equal(input.vatRule, undefined);
});

test("G-1 runtime: an unconfigured input cannot become an approval-ready commercial price", async () => {
  const input = await loadInput({});
  assert.throws(
    () =>
      buildCommercialPricingResult({
        costModel: readyCost,
        pricingInput: input,
        evidenceResult: readyEvidence,
      }),
    { code: "COMMERCIAL_POLICY_NOT_CONFIGURED" },
  );
});

test("G-1 runtime: a policy stored in scenario settings is honoured, not overridden", async () => {
  const input = await loadInput(
    {},
    JSON.stringify({
      sellingRule: { method: "Markup", rate: 20, minimumMargin: 0 },
      customerDiscount: { percentage: 0 },
      vatRule: { rate: 15 },
    }),
  );
  assert.deepEqual(input.sellingRule, { method: "Markup", rate: 20, minimumMargin: 0 });
  const { result } = buildCommercialPricingResult({
    costModel: readyCost,
    pricingInput: input,
    evidenceResult: readyEvidence,
  });
  assert.equal(result.finalValue, 1380);
});

test("G-1 runtime: EXPLICIT zeros supplied by a cost-only caller survive and stay valid", async () => {
  // worker/boq-line-cost-api.mjs asks for cost, not price, and expresses that by
  // passing explicit zero rules. An explicit 0 is a decision and must not be
  // reclassified as missing configuration.
  const input = await loadInput({
    sellingRule: { method: "Markup", rate: 0, minimumMargin: 0 },
    customerDiscount: { percentage: 0 },
    vatRule: { rate: 0 },
  });
  assert.deepEqual(input.sellingRule, { method: "Markup", rate: 0, minimumMargin: 0 });
  const { result } = buildCommercialPricingResult({
    costModel: readyCost,
    pricingInput: input,
    evidenceResult: readyEvidence,
  });
  assert.equal(result.markup, 0);
  assert.equal(result.vat, 0);
  assert.equal(result.finalValue, 1000);
  assert.equal(result.approvalReady, true);
});

test("G-1 persistence safety: the guard throws BEFORE any result exists, so nothing can be persisted", async () => {
  const input = await loadInput({});
  let produced = null;
  let thrown = null;
  try {
    produced = buildCommercialPricingResult({
      costModel: readyCost,
      pricingInput: input,
      evidenceResult: readyEvidence,
    });
  } catch (error) {
    thrown = error;
  }
  // No result object was produced at all, so worker/pricing-api.mjs cannot reach
  // persistRun (which runs strictly after buildCommercialPricingResult and
  // serialises `result` into pricing_lines). An unconfigured policy therefore
  // cannot leave an approval-ready or quotation-eligible pricing_lines row.
  assert.equal(produced, null);
  assert.equal(thrown.code, "COMMERCIAL_POLICY_NOT_CONFIGURED");
});
