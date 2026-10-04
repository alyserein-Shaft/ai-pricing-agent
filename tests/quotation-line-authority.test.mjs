import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { loadCanonicalQuotationLines } from "../worker/quotation-line-authority.mjs";

function makeDb({ approvalStatus = "Approved", approvalVersion = 1 } = {}) {
  const sqlite = new DatabaseSync(":memory:");

  const db = {
    exec(sql) {
      return sqlite.exec(sql);
    },
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...args) {
          return {
            async first() {
              return statement.get(...args) ?? null;
            },
            async all() {
              return { results: statement.all(...args) };
            },
            async run() {
              return statement.run(...args);
            },
          };
        },
      };
    },
  };
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      organization_id TEXT,
      archived_at TEXT
    );

    CREATE TABLE documents (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      current_version_id TEXT,
      deleted_at TEXT,
      archived_at TEXT
    );

    CREATE TABLE document_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT,
      version_number INTEGER,
      processing_status TEXT,
      deleted_at TEXT,
      effective_from TEXT,
      effective_to TEXT
    );
    CREATE TABLE document_supersessions(id TEXT PRIMARY KEY NOT NULL,superseding_version_id TEXT NOT NULL,superseded_version_id TEXT NOT NULL,scope_type TEXT NOT NULL CHECK (scope_type IN ('FULL_DOCUMENT','SECTION','CLAUSE','BOQ_ROW','DRAWING_REGION','EVIDENCE_ENTITY')),scope_id TEXT,supersession_type TEXT NOT NULL CHECK (supersession_type IN ('REVISION','ADDENDUM','CLARIFICATION','CORRECTION')),effective_from TEXT,effective_to TEXT,created_by TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,CHECK (superseding_version_id <> superseded_version_id),CHECK ((scope_type = 'FULL_DOCUMENT' AND scope_id IS NULL) OR (scope_type <> 'FULL_DOCUMENT' AND scope_id IS NOT NULL AND length(trim(scope_id)) > 0)),CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from));

    CREATE TABLE boq_extraction_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT,
      document_version_id TEXT,
      version_number INTEGER,
      status TEXT,
      superseded_at TEXT
    );

    CREATE TABLE drawing_symbol_recognition_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT,
      version_number INTEGER,
      superseded_at TEXT
    );

    CREATE TABLE boq_items (
      id TEXT PRIMARY KEY,
      extraction_version_id TEXT,
      project_id TEXT,
      source_document_id TEXT,
      sequence INTEGER,
      item_number TEXT,
      description TEXT,
      normalized_unit TEXT,
      original_unit TEXT,
      numeric_quantity TEXT,
      row_type TEXT,
      review_status TEXT,
      approved_for_downstream INTEGER,
      excluded_scope TEXT,
      original_quantity TEXT
    );

    CREATE TABLE pricing_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      scenario_id TEXT,
      version_number INTEGER,
      input_fingerprint TEXT,
      superseded_at TEXT
    );

    CREATE TABLE pricing_lines (
      id TEXT PRIMARY KEY,
      pricing_run_id TEXT,
      project_id TEXT,
      boq_item_id TEXT,
      candidate_id TEXT,
      product_id TEXT,
      safety_decision_id TEXT,
      selected_price_record_id TEXT,
      version_number INTEGER,
      status TEXT,
      approval_ready INTEGER,
      total_cost_minor INTEGER,
      net_selling_minor INTEGER,
      final_value_minor INTEGER
    );

    CREATE TABLE price_records (
      id TEXT PRIMARY KEY,
      approval_status TEXT,
      validity_state TEXT,
      valid_until TEXT,
      reviewed_at TEXT
    );

    CREATE TABLE pricing_approvals (
      id TEXT PRIMARY KEY,
      pricing_run_id TEXT,
      approval_type TEXT,
      status TEXT,
      entity_version INTEGER,
      created_at TEXT,
      decided_at TEXT
    );

    CREATE TABLE library_products (
      id TEXT PRIMARY KEY,
      manufacturer_id TEXT,
      part_number TEXT,
      description TEXT
    );

    CREATE TABLE product_manufacturers (
      id TEXT PRIMARY KEY,
      name TEXT
    );

    CREATE TABLE boq_quantity_source_decisions (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      boq_item_id TEXT,
      source TEXT,
      selected_quantity REAL,
      boq_quantity REAL,
      drawing_quantity REAL,
      recognition_version_id TEXT,
      definition_key TEXT,
      reason TEXT,
      decided_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.exec(`
    INSERT INTO projects VALUES ('p1','org1',NULL);

    INSERT INTO documents VALUES ('d1','p1','dv1',NULL,NULL);
    INSERT INTO document_versions (id, document_id, version_number, processing_status, deleted_at) VALUES ('dv1','d1',1,'Completed',NULL);
    INSERT INTO boq_extraction_versions VALUES ('bev1','d1','dv1',1,'Completed',NULL);
    INSERT INTO drawing_symbol_recognition_versions VALUES ('recognition-current','d1',1,NULL);

    INSERT INTO boq_items VALUES (
      'b1','bev1','p1','d1',1,'1','Addressable detector','EA','EA','2','BOQ Item','Approved',1,NULL,'2'
    );

    INSERT INTO pricing_runs VALUES (
      'r1','p1','s1',1,'pricing-fingerprint-1',NULL
    );

    INSERT INTO pricing_lines VALUES (
      'pl1','r1','p1','b1','c1','prod1','sd1','price1',1,'Draft Price',1,80000,100000,115000
    );

    INSERT INTO price_records VALUES (
      'price1','Approved','Valid','2099-12-31','2026-08-29'
    );

    INSERT INTO product_manufacturers VALUES ('m1','Honeywell');

    INSERT INTO library_products VALUES (
      'prod1','m1','ABC-123','Addressable detector'
    );

    INSERT INTO pricing_approvals VALUES (
      'a1','r1','Commercial Price','${approvalStatus}',${approvalVersion},
      '2026-08-29T10:00:00Z','2026-08-29T10:01:00Z'
    );
  `);

  return db;
}

test("builds quotation line from canonical commercially approved pricing", async () => {
  const db = makeDb();

  const result = await loadCanonicalQuotationLines(db, {
    projectId: "p1",
    scenarioId: "s1",
    currency: "SAR",
  });

  assert.equal(result.ready, true);
  assert.equal(result.blockers.length, 0);
  assert.equal(result.lineCount, 1);
  assert.equal(result.subtotalMinor, 100000);

  const line = result.lines[0];

  assert.equal(line.boqItemId, "b1");
  assert.equal(line.manufacturerName, "Honeywell");
  assert.equal(line.partNumber, "ABC-123");
  assert.equal(line.pricingRunId, "r1");
  assert.equal(line.pricingRunVersion, 1);
  assert.equal(line.pricingLineId, "pl1");
  assert.equal(line.commercialApprovalId, "a1");
  assert.equal(line.commercialApprovalVersion, 1);
  assert.equal(line.totalCostMinor, 80000);
  assert.equal(line.netSellingMinor, 100000);
});

// Stage 9 Section 5: the final quotation line quantity must reflect the
// engineer's explicit Quantity Source Decision once one exists, never
// silently freeze the raw BOQ number a governed decision has since
// superseded -- proven against the SAME real loadCanonicalQuotationLines
// this whole suite already exercises.
test("quotation line quantity reflects the engineer's Quantity Source Decision, not the raw BOQ quantity", async () => {
  const db = makeDb();
  await db.prepare(
    "INSERT INTO boq_quantity_source_decisions (id,project_id,boq_item_id,source,selected_quantity,boq_quantity,drawing_quantity,recognition_version_id,reason,decided_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).bind("decision-1", "p1", "b1", "Drawing", 5, 2, 5, "recognition-current", "Approved drawing quantity evidence supersedes the BOQ count.", "engineer1").run();

  const result = await loadCanonicalQuotationLines(db, { projectId: "p1", scenarioId: "s1", currency: "SAR" });

  assert.equal(result.lines[0].quantity, "5", "the final quotation line must use the reviewed Drawing quantity decision, not the raw BOQ quantity of 2");
});

test("quotation line blocks a stale governed Drawing quantity instead of using raw BOQ quantity", async () => {
  const db = makeDb();
  await db.prepare(
    "INSERT INTO boq_quantity_source_decisions (id,project_id,boq_item_id,source,selected_quantity,boq_quantity,drawing_quantity,recognition_version_id,reason,decided_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).bind("decision-stale", "p1", "b1", "Drawing", 5, 2, 5, "old-recognition", "Stale drawing decision must block quotation.", "engineer1").run();

  const result = await loadCanonicalQuotationLines(db, { projectId: "p1", scenarioId: "s1", currency: "SAR" });
  assert.equal(result.ready, false);
  assert.deepEqual(result.lines, []);
  assert.deepEqual(result.blockers, ["CURRENT_SELECTED_QUANTITY_REQUIRED:b1"]);
});

test("blocks quotation line when commercial approval is not approved", async () => {
  const db = makeDb({ approvalStatus: "Rejected" });

  const result = await loadCanonicalQuotationLines(db, {
    projectId: "p1",
    scenarioId: "s1",
    currency: "SAR",
  });

  assert.equal(result.ready, false);
  assert.deepEqual(result.lines, []);
  assert.deepEqual(result.blockers, [
    "COMMERCIAL_APPROVAL_REQUIRED:b1",
  ]);
});

test("blocks quotation line when commercial approval version is stale", async () => {
  const db = makeDb({ approvalVersion: 0 });

  const result = await loadCanonicalQuotationLines(db, {
    projectId: "p1",
    scenarioId: "s1",
    currency: "SAR",
  });

  assert.equal(result.ready, false);
  assert.deepEqual(result.lines, []);
  assert.deepEqual(result.blockers, [
    "COMMERCIAL_APPROVAL_REQUIRED:b1",
  ]);
});

test("returns pricing scenario blocker when scenario is missing", async () => {
  const db = makeDb();

  const result = await loadCanonicalQuotationLines(db, {
    projectId: "p1",
    scenarioId: null,
    currency: "SAR",
  });

  assert.equal(result.ready, false);
  assert.equal(result.lineCount, 0);
  assert.equal(result.subtotalMinor, 0);
  assert.deepEqual(result.blockers, ["PRICING_SCENARIO_REQUIRED"]);
});
