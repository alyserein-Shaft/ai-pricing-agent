import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { handleQuantitySourceDecisionApi, currentSelectedQuantity } from "../worker/quantity-source-decision-api.mjs";
import { buildLineBomModel } from "../worker/boq-line-bom-api.mjs";

// Stage 9 (2026-09-01) Section 5: the Quantity Source Decision worker API --
// a single compact engineer decision (Use BOQ Qty / Use Drawing Qty / Enter
// Reviewed Qty), append-only, never overwriting boq_items.numeric_quantity
// itself.
//
// DRAW-QTY-1 (2026-09-27): "Use Drawing Qty" is now refused. It could only
// ever fill selected_quantity from the approved-occurrence count, and an
// approved occurrence is a recognised legend row, not an installed device.
// "Enter Reviewed Qty" remains the governed path for a quantity an engineer
// establishes from a drawing review.

const d1 = (sql) => ({
  prepare(text) {
    let values = [];
    return {
      bind(...next) { values = next; return this; },
      first: async () => sql.prepare(text).get(...values) ?? null,
      all: async () => ({ results: sql.prepare(text).all(...values) }),
      run: async () => sql.prepare(text).run(...values),
    };
  },
  batch: async (statements) => Promise.all(statements.map((s) => s.run())),
});

const req = (path, init) => new Request(`http://localhost${path}`, init);

const fixture = () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`
    CREATE TABLE projects(id TEXT PRIMARY KEY,owner_user_id TEXT,organization_id TEXT,archived_at TEXT);
    CREATE TABLE documents(id TEXT PRIMARY KEY,project_id TEXT,logical_name TEXT,current_version_id TEXT,deleted_at TEXT,archived_at TEXT);
    CREATE TABLE document_versions(id TEXT PRIMARY KEY,document_id TEXT,effective_from TEXT,effective_to TEXT);
    CREATE TABLE document_supersessions(id TEXT PRIMARY KEY NOT NULL,superseding_version_id TEXT NOT NULL,superseded_version_id TEXT NOT NULL,scope_type TEXT NOT NULL CHECK (scope_type IN ('FULL_DOCUMENT','SECTION','CLAUSE','BOQ_ROW','DRAWING_REGION','EVIDENCE_ENTITY')),scope_id TEXT,supersession_type TEXT NOT NULL CHECK (supersession_type IN ('REVISION','ADDENDUM','CLARIFICATION','CORRECTION')),effective_from TEXT,effective_to TEXT,created_by TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,CHECK (superseding_version_id <> superseded_version_id),CHECK ((scope_type = 'FULL_DOCUMENT' AND scope_id IS NULL) OR (scope_type <> 'FULL_DOCUMENT' AND scope_id IS NOT NULL AND length(trim(scope_id)) > 0)),CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from));
    CREATE TABLE boq_extraction_versions(id TEXT PRIMARY KEY,document_id TEXT,document_version_id TEXT,version_number INTEGER,status TEXT,superseded_at TEXT);
    CREATE TABLE drawing_symbol_recognition_versions(id TEXT PRIMARY KEY,project_id TEXT,document_id TEXT,version_number INTEGER,superseded_at TEXT);
    CREATE TABLE drawing_symbol_definitions(id TEXT PRIMARY KEY,project_id TEXT,recognition_version_id TEXT,definition_key TEXT,abbreviation TEXT,description TEXT);
    CREATE TABLE drawing_symbol_occurrences(id TEXT PRIMARY KEY,recognition_version_id TEXT,definition_id TEXT,original_definition_id TEXT,occurrence_key TEXT,page_number INTEGER,bounding_box TEXT,shape_signature TEXT,nearby_text TEXT,match_basis TEXT,confidence INTEGER,review_status TEXT DEFAULT 'Needs Review',source_geometry TEXT,score_components TEXT,reviewed_by TEXT,reviewed_at TEXT,review_reason TEXT);
    CREATE TABLE drawing_quantity_evidence_coverage(id TEXT PRIMARY KEY,project_id TEXT,recognition_version_id TEXT,coverage_state TEXT,reason TEXT,set_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE boq_items(id TEXT PRIMARY KEY,project_id TEXT,source_document_id TEXT,extraction_version_id TEXT,row_type TEXT,review_status TEXT,approved_for_downstream INTEGER,numeric_quantity TEXT,original_quantity TEXT,normalized_unit TEXT,original_unit TEXT);
    CREATE TABLE estimator_understanding_review_versions(id TEXT PRIMARY KEY,project_id TEXT,boq_item_id TEXT,version_number INTEGER,review_status TEXT,canonical_interpretation TEXT);
    CREATE TABLE boq_quantity_source_decisions(id TEXT PRIMARY KEY,project_id TEXT,boq_item_id TEXT,source TEXT,selected_quantity REAL,boq_quantity REAL,drawing_quantity REAL,recognition_version_id TEXT,definition_key TEXT,reason TEXT,decided_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE safety_decisions(id TEXT PRIMARY KEY,boq_item_id TEXT,candidate_id TEXT,superseded_at TEXT,technical_eligibility TEXT,version_number INTEGER);
    -- Fixture completeness against db/schema.ts:613 and :635, for
    -- worker/primary-selection-authority.mjs (GOV-AUTH-1), which
    -- buildLineBomModel now calls on every BOM read. review_status excludes
    -- rejected candidates from the primary selection; both tables stay empty
    -- so these fixtures continue to assert the governed QUANTITY path
    -- (currentSelectedQuantity) and are not coupled to product matching.
    CREATE TABLE product_match_candidates(id TEXT PRIMARY KEY,match_run_id TEXT,product_id TEXT,rank INTEGER,review_status TEXT NOT NULL DEFAULT 'Needs Review');
    CREATE TABLE product_match_runs(id TEXT PRIMARY KEY,boq_item_id TEXT,requirement_profile_version_id TEXT,superseded_at TEXT);
    CREATE TABLE requirement_profile_versions (id TEXT PRIMARY KEY, boq_item_id TEXT, version_number INTEGER, superseded_at TEXT);
    CREATE TABLE safety_approval_requests(id TEXT PRIMARY KEY,project_id TEXT,safety_decision_id TEXT,approval_type TEXT,approval_level INTEGER,status TEXT,entity_version INTEGER,decided_at TEXT,created_at TEXT);
    CREATE TABLE project_members(project_id TEXT,user_id TEXT,role TEXT,status TEXT,revoked_at TEXT);
    INSERT INTO projects VALUES('project_1','local-development-user','organization_bd_shaft_internal_pilot',NULL);
    INSERT INTO documents VALUES('doc_1','project_1','Floor Plan','dv_1',NULL,NULL);
    INSERT INTO document_versions (id, document_id) VALUES('dv_1','doc_1');
    INSERT INTO boq_extraction_versions VALUES('bev_1','doc_1','dv_1',1,'Completed',NULL);
    INSERT INTO boq_items VALUES('boq_1','project_1','doc_1','bev_1','BOQ Item','Approved',1,'4','4','Each','Each');
  `);
  return sql;
};

const seedGovernedDrawingEvidence = (sql) => {
  sql.exec(`
    INSERT INTO drawing_symbol_recognition_versions VALUES('v1','project_1','doc_1',1,NULL);
    INSERT INTO drawing_symbol_definitions VALUES('def_re','project_1','v1','def_re','RE','CEILING MOUNTED DOME CAMERA');
    INSERT INTO drawing_symbol_occurrences VALUES('occ1','v1','def_re',NULL,'k1',1,'{}','sig','','basis',60,'Approved',NULL,NULL,NULL,NULL,NULL);
    INSERT INTO drawing_symbol_occurrences VALUES('occ2','v1','def_re',NULL,'k2',1,'{}','sig','','basis',60,'Approved',NULL,NULL,NULL,NULL,NULL);
    INSERT INTO estimator_understanding_review_versions VALUES('rev_1','project_1','boq_1',1,'APPROVED','${JSON.stringify({ system: "CCTV", productFamily: "Dome Camera" }).replace(/'/g, "''")}');
  `);
};

test("GET with no decision ever made reports the raw BOQ quantity as current, with an empty append-only history", async () => {
  const sql = fixture();
  const env = { DB: d1(sql) };
  const response = await handleQuantitySourceDecisionApi(req("/api/boq-items/boq_1/quantity-source-decision"), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.boqQuantity, 4);
  assert.equal(body.current, null);
  assert.deepEqual(body.history, []);
});

test("POST source=BOQ selects the current BOQ quantity, with a governed reason required", async () => {
  const sql = fixture();
  const env = { DB: d1(sql) };
  const shortReason = await handleQuantitySourceDecisionApi(
    req("/api/boq-items/boq_1/quantity-source-decision", { method: "POST", body: JSON.stringify({ source: "BOQ", reason: "ok" }) }),
    env,
  );
  assert.equal(shortReason.status, 422);

  const response = await handleQuantitySourceDecisionApi(
    req("/api/boq-items/boq_1/quantity-source-decision", { method: "POST", body: JSON.stringify({ source: "BOQ", reason: "Confirmed against the tender BOQ." }) }),
    env,
  );
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.decision.source, "BOQ");
  assert.equal(body.decision.selected_quantity, 4);
});

test("POST source=Drawing is refused even with real governed evidence: a printed count is the only device quantity", async () => {
  const sql = fixture();
  const env = { DB: d1(sql) };
  const noEvidence = await handleQuantitySourceDecisionApi(
    req("/api/boq-items/boq_1/quantity-source-decision", { method: "POST", body: JSON.stringify({ source: "Drawing", reason: "Use the drawing count.", documentId: "doc_1", definitionKey: "def_re" }) }),
    env,
  );
  assert.equal(noEvidence.status, 409);

  seedGovernedDrawingEvidence(sql);
  const response = await handleQuantitySourceDecisionApi(
    req("/api/boq-items/boq_1/quantity-source-decision", { method: "POST", body: JSON.stringify({ source: "Drawing", reason: "Approved drawing occurrences reviewed and counted.", documentId: "doc_1", definitionKey: "def_re" }) }),
    env,
  );
  const body = await response.json();
  // DRAW-QTY-1: governed evidence is necessary but not sufficient. The only
  // number the server could derive is the approved-occurrence count (2), and
  // an approved occurrence is a recognised legend ROW, not an installed
  // device. Promoting it would persist a recognition metric into
  // boq_quantity_source_decisions.selected_quantity, which BOM, costing,
  // pricing, quotation and export all read back. So it must be refused --
  // with the count still reported, labelled as a count, for recognition
  // reporting. This also preserves the original intent of this test: the
  // selected quantity is never a number the caller supplied.
  assert.equal(response.status, 409);
  assert.equal(body.error.code, "DRAWING_PRINTED_QUANTITY_REQUIRED");
  assert.equal(body.error.approvedOccurrenceCount, 2, "the count stays visible for recognition reporting");
  assert.equal(body.error.approvedOccurrenceCountIsDeviceQuantity, false, "and is explicitly not a device quantity");
  assert.ok(
    body.error.blockers.some((b) => b.code === "PRINTED_COUNT_MISSING"),
    "the refusal must name the missing printed-count authority, not merely fail",
  );
  assert.equal(
    sql.prepare("SELECT COUNT(*) AS n FROM boq_quantity_source_decisions").get().n,
    0,
    "a refused Drawing decision must leave no governed row behind",
  );
});

test("a legacy Drawing decision row is reported STALE once its recognition version is superseded", async () => {
  // DRAW-QTY-1: the API can no longer CREATE a Drawing decision, but the
  // append-only ledger may already hold one written before the gate existed,
  // so the read-path staleness check must still hold for it. The row is seeded
  // directly, exactly as history would contain it.
  const sql = fixture();
  const env = { DB: d1(sql) };
  seedGovernedDrawingEvidence(sql);
  sql.exec(`
    INSERT INTO boq_quantity_source_decisions VALUES('qd_legacy','project_1','boq_1','Drawing',2,4,2,'v1','def_re','Pre-DRAW-QTY-1 decision written from the approved occurrence count.','local-development-user',CURRENT_TIMESTAMP);
  `);
  sql.exec("UPDATE drawing_symbol_recognition_versions SET superseded_at='2026-09-22T00:00:00Z' WHERE id='v1'; INSERT INTO drawing_symbol_recognition_versions VALUES('v2','project_1','doc_1',2,NULL);");
  const current = await currentSelectedQuantity(env.DB, { id: "boq_1", source_document_id: "doc_1", numeric_quantity: 4, original_quantity: 4 });
  assert.equal(current.value, null);
  assert.equal(current.status, "STALE");
  assert.equal(current.source, "Drawing");
});

test("POST source=Reviewed requires a valid non-negative engineer-entered quantity", async () => {
  const sql = fixture();
  const env = { DB: d1(sql) };
  const invalid = await handleQuantitySourceDecisionApi(
    req("/api/boq-items/boq_1/quantity-source-decision", { method: "POST", body: JSON.stringify({ source: "Reviewed", reason: "Engineer site-verified count.", selectedQuantity: -1 }) }),
    env,
  );
  assert.equal(invalid.status, 422);

  const response = await handleQuantitySourceDecisionApi(
    req("/api/boq-items/boq_1/quantity-source-decision", { method: "POST", body: JSON.stringify({ source: "Reviewed", reason: "Engineer site-verified count after joint walk-through.", selectedQuantity: 3 }) }),
    env,
  );
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.decision.selected_quantity, 3);
});

test("decisions are append-only -- the previous decision remains a real historical row, never mutated, and the latest one wins", async () => {
  const sql = fixture();
  const env = { DB: d1(sql) };
  await handleQuantitySourceDecisionApi(req("/api/boq-items/boq_1/quantity-source-decision", { method: "POST", body: JSON.stringify({ source: "BOQ", reason: "Initial confirmation against BOQ." }) }), env);
  await handleQuantitySourceDecisionApi(req("/api/boq-items/boq_1/quantity-source-decision", { method: "POST", body: JSON.stringify({ source: "Reviewed", reason: "Revised after a later site walk-through.", selectedQuantity: 9 }) }), env);

  const get = await (await handleQuantitySourceDecisionApi(req("/api/boq-items/boq_1/quantity-source-decision"), env)).json();
  assert.equal(get.current.source, "Reviewed");
  assert.equal(get.current.selected_quantity, 9);
  assert.equal(get.history.length, 2, "both decisions must remain real historical rows");

  const rawItem = sql.prepare("SELECT numeric_quantity FROM boq_items WHERE id='boq_1'").get();
  assert.equal(rawItem.numeric_quantity, "4", "boq_items.numeric_quantity itself must never be overwritten by a quantity decision");
});

// ============================================================
// Section 5/14: the decision, once made, becomes the quantity downstream
// BOM/Costing/Quotation actually consumes -- proven here for BOM via the
// same real currentSelectedQuantity/buildLineBomModel this stage wired.
// (Costing and Quotation are proven identically in
// tests/pricing-input-authority.test.mjs and
// tests/quotation-line-authority.test.mjs, against their own real fixtures.)
// ============================================================

test("currentSelectedQuantity falls back to the raw BOQ quantity when no decision exists, and reflects the latest decision once one does", async () => {
  const sql = fixture();
  const env = { DB: d1(sql) };
  const boqItem = { id: "boq_1", numeric_quantity: "4", original_quantity: "4" };
  const before = await currentSelectedQuantity(env.DB, boqItem);
  assert.equal(before.value, 4);
  assert.equal(before.source, "BOQ");
  assert.equal(before.decisionId, null);

  await handleQuantitySourceDecisionApi(req("/api/boq-items/boq_1/quantity-source-decision", { method: "POST", body: JSON.stringify({ source: "Reviewed", reason: "Engineer site-verified count.", selectedQuantity: 6 }) }), env);
  const after = await currentSelectedQuantity(env.DB, boqItem);
  assert.equal(after.value, 6);
  assert.equal(after.source, "Reviewed");
  assert.ok(after.decisionId);
});

test("BOM's primary quantity reflects the Quantity Source Decision, not the raw BOQ quantity", async () => {
  const sql = fixture();
  const env = { DB: d1(sql) };
  await handleQuantitySourceDecisionApi(req("/api/boq-items/boq_1/quantity-source-decision", { method: "POST", body: JSON.stringify({ source: "Reviewed", reason: "Engineer site-verified count.", selectedQuantity: 6 }) }), env);

  const bom = await buildLineBomModel(env, { itemId: "boq_1", userId: "local-development-user" });
  assert.equal(bom.primaryQuantity.value, 6);
  assert.equal(bom.primaryQuantity.origin, "ENGINEER_REVIEWED");
  assert.match(bom.primaryQuantity.source, /Quantity Source Decision/);
});
