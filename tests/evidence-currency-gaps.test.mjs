/**
 * EVIDENCE-CURRENCY-1 — downstream readers connected to canonical authority.
 *
 * Each test pins a CONNECTION_GAP or freshness gap closed by reusing an
 * existing authority (never a new predicate): quantity decisions scoped to
 * current evidence, pricing/selection refusing stale-profile runs via the
 * shared matchRunStaleness, and safety signals scoped to the current run's
 * candidates.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { loadPricingInput } from "../worker/pricing-runtime.mjs";
import { resolveCurrentPrimarySelection } from "../worker/primary-selection-authority.mjs";
import { handleQuantitySourceDecisionApi } from "../worker/quantity-source-decision-api.mjs";

const d1 = (sql) => ({
  prepare(text) {
    let values = [];
    return {
      bind(...next) {
        values = next;
        return this;
      },
      first: async () => sql.prepare(text).get(...values) ?? null,
      all: async () => ({ results: sql.prepare(text).all(...values) }),
      run: async () => sql.prepare(text).run(...values),
    };
  },
  batch: async (statements) => Promise.all(statements.map((statement) => statement.run())),
});

// ---------------------------------------------------------------------------
// Quantity decisions address current evidence only.
// ---------------------------------------------------------------------------
const quantityFixture = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, owner_user_id TEXT, organization_id TEXT, archived_at TEXT);
    CREATE TABLE documents (id TEXT PRIMARY KEY, project_id TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
    CREATE TABLE document_versions (id TEXT PRIMARY KEY, document_id TEXT, effective_from TEXT, effective_to TEXT);
    CREATE TABLE document_supersessions (id TEXT PRIMARY KEY, superseding_version_id TEXT, superseded_version_id TEXT, effective_from TEXT, effective_to TEXT);
    CREATE TABLE boq_extraction_versions (id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, version_number INTEGER, status TEXT, superseded_at TEXT);
    CREATE TABLE boq_items (id TEXT PRIMARY KEY, extraction_version_id TEXT, project_id TEXT, source_document_id TEXT, row_type TEXT, item_number TEXT, description TEXT, numeric_quantity REAL);
    CREATE TABLE boq_quantity_source_decisions (id TEXT PRIMARY KEY, boq_item_id TEXT);
    CREATE TABLE drawing_symbol_recognition_versions (id TEXT PRIMARY KEY, document_id TEXT, version_number INTEGER, superseded_at TEXT);
    INSERT INTO projects VALUES ('p1','u1','org1',NULL);
    INSERT INTO documents VALUES ('doc1','p1','dv1',NULL,NULL);
    INSERT INTO document_versions VALUES ('dv1','doc1',NULL,NULL);
    INSERT INTO boq_extraction_versions VALUES
      ('ex-old','doc1','dv1',1,'Completed','2026-08-10T12:00:00Z'),
      ('ex-new','doc1','dv1',2,'Completed',NULL);
    INSERT INTO boq_items VALUES
      ('item-stale','ex-old','p1','doc1','BOQ Item','1','Detector',10),
      ('item-current','ex-new','p1','doc1','BOQ Item','1','Detector',10);
  `);
  const env = {
    DB: d1(raw),
    FILES: { get: async () => null },
    APP_ACCESS_MODE: "single-user",
    APP_USER_ID: "u1",
    APP_ORGANIZATION_ID: "org1",
  };
  return { raw, env };
};

test("EVIDENCE-CURRENCY-1 quantity GET 404s a superseded-extraction item", async () => {
  const { raw, env } = quantityFixture();
  try {
    const response = await handleQuantitySourceDecisionApi(
      new Request("http://localhost/api/boq-items/item-stale/quantity-source-decision", { method: "GET" }),
      env,
    );
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "BOQ_ITEM_NOT_FOUND");
  } finally {
    raw.close();
  }
});

test("EVIDENCE-CURRENCY-1 quantity GET serves a current item", async () => {
  const { raw, env } = quantityFixture();
  try {
    const response = await handleQuantitySourceDecisionApi(
      new Request("http://localhost/api/boq-items/item-current/quantity-source-decision", { method: "GET" }),
      env,
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).boqItemId, "item-current");
  } finally {
    raw.close();
  }
});

test("EVIDENCE-CURRENCY-1 quantity POST refuses a superseded-extraction item", async () => {
  const { raw, env } = quantityFixture();
  try {
    const response = await handleQuantitySourceDecisionApi(
      new Request("http://localhost/api/boq-items/item-stale/quantity-source-decision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "Reviewed", reason: "Engineer reviewed quantity value", value: 7 }),
      }),
      env,
    );
    assert.equal(response.status, 404);
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM boq_quantity_source_decisions").get().n, 0);
  } finally {
    raw.close();
  }
});

// ---------------------------------------------------------------------------
// Pricing / selection refuse stale-profile runs (DFG-A).
// ---------------------------------------------------------------------------
const staleFixture = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, owner_user_id TEXT, organization_id TEXT, archived_at TEXT);
    CREATE TABLE documents (id TEXT PRIMARY KEY, project_id TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
    CREATE TABLE document_versions (id TEXT PRIMARY KEY, document_id TEXT, effective_from TEXT, effective_to TEXT);
    CREATE TABLE document_supersessions (id TEXT PRIMARY KEY, superseding_version_id TEXT, superseded_version_id TEXT, effective_from TEXT, effective_to TEXT);
    CREATE TABLE boq_extraction_versions (id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, version_number INTEGER, status TEXT, superseded_at TEXT);
    CREATE TABLE boq_items (id TEXT PRIMARY KEY, extraction_version_id TEXT, project_id TEXT, source_document_id TEXT, row_type TEXT, item_number TEXT, review_status TEXT, approved_for_downstream INTEGER, numeric_quantity REAL, normalized_unit TEXT);
    CREATE TABLE requirement_profile_versions (id TEXT PRIMARY KEY, boq_item_id TEXT, version_number INTEGER, superseded_at TEXT);
    CREATE TABLE product_match_runs (id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, requirement_profile_version_id TEXT, version_number INTEGER, superseded_at TEXT);
    CREATE TABLE product_match_candidates (id TEXT PRIMARY KEY, match_run_id TEXT, product_id TEXT, rank INTEGER, review_status TEXT DEFAULT 'Needs Review');
    CREATE TABLE canonical_library_products (id TEXT PRIMARY KEY, requested_product_id TEXT, manufacturer_id TEXT, part_number TEXT, lifecycle_status TEXT);
    CREATE TABLE product_manufacturers (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE safety_decisions (id TEXT PRIMARY KEY, boq_item_id TEXT, candidate_id TEXT, version_number INTEGER, superseded_at TEXT, technical_eligibility TEXT, price_eligibility TEXT);
    CREATE TABLE safety_approval_requests (id TEXT PRIMARY KEY, safety_decision_id TEXT, approval_type TEXT, status TEXT, entity_version INTEGER, decided_at TEXT, created_at TEXT);
    CREATE TABLE price_records (id TEXT PRIMARY KEY, product_id TEXT, supplier_id TEXT, project_id TEXT, approval_status TEXT, downstream_use TEXT, currency TEXT, amount_minor INTEGER);
    CREATE TABLE suppliers (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE boq_quantity_source_decisions (id TEXT PRIMARY KEY, boq_item_id TEXT, source TEXT, selected_quantity REAL, recognition_version_id TEXT);
    INSERT INTO projects VALUES ('p1','u1','org1',NULL);
    INSERT INTO documents VALUES ('doc1','p1','dv1',NULL,NULL);
    INSERT INTO document_versions VALUES ('dv1','doc1',NULL,NULL);
    INSERT INTO boq_extraction_versions VALUES ('ex1','doc1','dv1',1,'Completed',NULL);
    INSERT INTO boq_items VALUES ('item1','ex1','p1','doc1','BOQ Item','1','Approved',1,10,'Each');
    INSERT INTO requirement_profile_versions VALUES ('prof-old','item1',1,'2026-08-10T12:00:00Z'),('prof-new','item1',2,NULL);
    INSERT INTO product_manufacturers VALUES ('m1','Honeywell');
    INSERT INTO canonical_library_products VALUES ('p1','p1','m1','FA-001','Active');
    INSERT INTO product_match_runs VALUES ('run-stale','p1','item1','prof-old',1,NULL);
    INSERT INTO product_match_candidates (id,match_run_id,product_id,rank,review_status) VALUES ('cand1','run-stale','p1',1,'Needs Review');
    INSERT INTO safety_decisions VALUES ('s1','item1','cand1',1,NULL,'Eligible','Eligible');
    INSERT INTO safety_approval_requests VALUES ('a1','s1','Technical','Approved',1,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z');
    INSERT INTO price_records VALUES ('price1','p1',NULL,'p1','Approved','Costing','SAR',1000);
  `);
  return { raw, DB: d1(raw) };
};

test("EVIDENCE-CURRENCY-1 pricing refuses a run pinned to a superseded requirement profile", async () => {
  const { raw, DB } = staleFixture();
  try {
    await assert.rejects(
      loadPricingInput(DB, { projectId: "p1", boqItemId: "item1", candidateId: "cand1" }),
      (error) => error?.code === "REQUIREMENT_PROFILE_CHANGED",
    );
  } finally {
    raw.close();
  }
});

test("EVIDENCE-CURRENCY-1 selection stays profile-agnostic; pricing and domain checks refuse stale runs", async () => {
  // Layering pin: the resolver deliberately does NOT enforce profile staleness
  // (panel sizing carries STALE_PANEL_PRODUCT_SELECTION; pricing refuses
  // REQUIREMENT_PROFILE_CHANGED). Refusing here would mask those domain codes,
  // so this test pins that a stale-pinned run still resolves -- the refusal
  // lives downstream, where the domain authority sits.
  const { raw, DB } = staleFixture();
  try {
    const selection = await resolveCurrentPrimarySelection(DB, "item1");
    assert.equal(selection.approved, true);
    assert.equal(selection.selection.candidateId, "cand1");
  } finally {
    raw.close();
  }
});

test("EVIDENCE-CURRENCY-1 pricing proceeds when the run tracks the current profile", async () => {
  const { raw, DB } = staleFixture();
  try {
    raw.exec(`UPDATE product_match_runs SET requirement_profile_version_id='prof-new' WHERE id='run-stale'`);
    const input = await loadPricingInput(DB, {
      projectId: "p1", boqItemId: "item1", candidateId: "cand1",
      scenario: { project_currency: "SAR", settings: "{}" }, body: {},
    });
    assert.equal(input.candidateId, "cand1");
    const selection = await resolveCurrentPrimarySelection(DB, "item1");
    assert.equal(selection.approved, true);
    assert.equal(selection.selection.candidateId, "cand1");
  } finally {
    raw.close();
  }
});

// ---------------------------------------------------------------------------
// Safety signals scoped to the current run's candidates.
// ---------------------------------------------------------------------------
test("EVIDENCE-CURRENCY-1 a stale-run verdict never masks the current run's state", async () => {
  const { currentSafetyDecision } = await import("../worker/boq-line-decision-api.mjs");
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE product_match_runs (id TEXT PRIMARY KEY, boq_item_id TEXT, version_number INTEGER, superseded_at TEXT);
    CREATE TABLE product_match_candidates (id TEXT PRIMARY KEY, match_run_id TEXT);
    CREATE TABLE safety_decisions (id TEXT PRIMARY KEY, boq_item_id TEXT, candidate_id TEXT, version_number INTEGER, superseded_at TEXT, safety_state TEXT, compliance_state TEXT, technical_eligibility TEXT, overall_confidence REAL, confidence_level TEXT, explanation TEXT);
    INSERT INTO product_match_runs VALUES
      ('run-old','item1',1,'2026-08-10T12:00:00Z'),
      ('run-new','item1',2,NULL);
    INSERT INTO product_match_candidates VALUES ('cand-old','run-old'),('cand-new','run-new');
    INSERT INTO safety_decisions VALUES
      ('s-old','item1','cand-old',9,NULL,'Approval Ready','Compliant','Eligible',95,'High',NULL),
      ('s-new','item1','cand-new',1,NULL,'Blocked','Non-Compliant','Human Review Required',40,'Low',NULL);
  `);
  try {
    // Cross-candidate MAX would return v9 Eligible (fail-open); scoped to the
    // current run it returns v1 Blocked.
    const scoped = await currentSafetyDecision(d1(raw), "item1", "run-new");
    assert.equal(scoped.id, "s-new");
    assert.equal(scoped.safety_state, "Blocked");
    // No run -> null -> callers read "not yet eligible", never stale truth.
    assert.equal(await currentSafetyDecision(d1(raw), "item1", null), null);
    assert.equal(await currentSafetyDecision(d1(raw), "item1", undefined), null);
  } finally {
    raw.close();
  }
});
