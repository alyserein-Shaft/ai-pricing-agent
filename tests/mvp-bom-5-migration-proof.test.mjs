import assert from "node:assert/strict";
import test from "node:test";

import { applyActiveChain, applyChainAround, openEmptyDatabase } from "./helpers/active-chain.mjs";
import {
  IDS,
  insertProductPricingLine,
  insertProductQuotationLine,
  insertScopePricingLine,
  insertScopeQuotationLine,
  seedProductGraph,
} from "./fixtures/mvp-bom-5-seed.mjs";

/**
 * MVP-BOM-5 Phase 5: migration proof for
 * `0015_pricing_quotation_scope_source_model`.
 *
 * Two execution shapes are proven here, matching the two shapes the harness and
 * a production migrator actually use:
 *
 *  1. FRESH CHAIN (reconstruction): apply 0000..0015 with the transactional
 *     `applyTag` helper, then assert the rebuilt pricing_lines and
 *     project_quotation_lines contracts: column set + NOT NULL flags, the FK
 *     set (all preserved, including the quotation table's FK back into
 *     pricing_lines and pricing_approvals), the named UNIQUE/partial-UNIQUE
 *     index set (`PRAGMA index_list` unique+partial flags), the quotation
 *     immutability triggers recreated after the rebuild, and the behavioral
 *     CHECK enforcement.
 *
 *  2. UPGRADE WITH LIVE LEGACY ROWS: hold 0015 back, seed a pre-migration
 *     database with a legacy-shaped pricing line (30 columns, no source
 *     identity), a legacy quotation line (26 columns), and CHILD rows that
 *     reference pricing_lines(id) -- pricing_cost_components (NOT NULL FK) and
 *     pricing_approvals (nullable FK). Apply 0015 and assert: rows preserved
 *     under their original ids and counts, deterministic PRODUCT backfill
 *     (source_type='PRODUCT', source_product_id=product_id, scope identity
 *     NULL), `PRAGMA foreign_key_check` clean, FK enforcement still ON, child
 *     references resolved against the renamed table, the generalized model
 *     usable on the same upgraded database, and quotation immutability guards
 *     recreated (UPDATE/DELETE rejected after the rebuild).
 */
const FRESH = Object.freeze({ pricing: "pricing_lines", quotation: "project_quotation_lines" });
const TAG_0015 = "0015_pricing_quotation_scope_source_model";

const freshChain = () => {
  const opened = openEmptyDatabase();
  applyActiveChain(opened.db);
  seedProductGraph(opened.db);
  return opened;
};

const tableColumns = (db, table) => {
  const info = db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all();
  return Object.fromEntries(info.map((column) => [column.name, column]));
};

const fkMap = (db, table) => {
  const rows = db.prepare(`PRAGMA foreign_key_list(${JSON.stringify(table)})`).all();
  return Object.fromEntries(rows.map((row) => [row.from, `${row.table}.${row.to}`]));
};

const indexFacts = (db, table) => {
  const rows = db.prepare(`PRAGMA index_list(${JSON.stringify(table)})`).all();
  return Object.fromEntries(rows.map((row) => [row.name, { unique: row.unique, origin: row.origin, partial: row.partial }]));
};

const count = (db, sql) => Number(db.prepare(sql).get().c);

/** Seed a PRE-0015 database as it would look in production: legacy column
 * shapes only, plus children that reference pricing_lines(id). */
const legacySeed = (db) => {
  seedProductGraph(db);

  // Legacy-shaped pricing line: the pre-migration 30-column shape has NOT NULL
  // boq/candidate/safety provenance and carries no source identity columns.
  db.prepare(`INSERT INTO pricing_lines
    (id,pricing_run_id,project_id,boq_item_id,candidate_id,product_id,safety_decision_id,selected_price_record_id,
     version_number,status,quantity,unit,source_currency,project_currency,original_list_price_minor,
     net_material_unit_minor,material_total_minor,direct_cost_minor,total_cost_minor,gross_selling_minor,
     customer_discount_minor,net_selling_minor,vat_minor,final_value_minor,margin_basis_points,markup_basis_points,
     output,explanation,approval_ready,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "pl-legacy-1", IDS.RUN, IDS.PROJECT, IDS.BOQ_ITEM, IDS.CANDIDATE, IDS.PRODUCT, IDS.SAFETY, null,
    1, "Approved", "1", "EA", "SAR", "SAR", 100, 100, 100, 100, 100, 100, 0, 100, 0, 100, 0, 0,
    "{}", "fixture", 1, "now",
  );

  // Child rows referencing pricing_lines(id): one with a NOT NULL FK
  // (pricing_cost_components) and one with a nullable FK (pricing_approvals).
  // Both must survive the transactional DELETE -> DROP -> RENAME rebuild via
  // the deferred foreign-key mechanism.
  db.prepare(`INSERT INTO pricing_cost_components
    (id,pricing_line_id,component_type,description,method,formula,rate,quantity,amount_minor,source,scope,assumptions,approval_status,rule_version,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "pcc-1", "pl-legacy-1", "Material", "Fixture component", "Fixture", "line", null, null, 100,
    "Fixture", "Pricing", "{}", "Approved", "rule-v1", "owner1", "now",
  );
  db.prepare(`INSERT INTO pricing_approvals
    (id,project_id,pricing_run_id,pricing_line_id,approval_type,status,entity_version,request_reason,evidence,requested_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    "pa-child", IDS.PROJECT, IDS.RUN, "pl-legacy-1", "Commercial Price", "Approved", 1, "child fixture", "{}", "owner1", "now",
  );

  // Legacy-shaped quotation line: the pre-migration 26-column shape also
  // requires boq/candidate provenance and references the legacy pricing line.
  db.prepare(`INSERT INTO project_quotation_lines
    (id,quotation_revision_id,project_id,boq_item_id,sequence,item_number,description,unit,quantity,
     candidate_id,product_id,manufacturer_name,part_number,product_description,
     pricing_run_id,pricing_run_version,pricing_line_id,pricing_line_version,pricing_input_fingerprint,
     commercial_approval_id,commercial_approval_version,currency,total_cost_minor,net_selling_minor,
     source_snapshot_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "ql-legacy-1", IDS.QUOTATION_REVISION, IDS.PROJECT, IDS.BOQ_ITEM, 1, "1", "Legacy line", "EA", "1",
    IDS.CANDIDATE, IDS.PRODUCT, "Honeywell", "P-001", "Fixture product",
    IDS.RUN, 1, "pl-legacy-1", 1, "fp-legacy-1", IDS.COMMERCIAL_APPROVAL, 1, "SAR", 100, 100, "{}", "now",
  );
};

// ---------------------------------------------------------------------------
// 1. FRESH CHAIN -- reconstruction proof
// ---------------------------------------------------------------------------

test("MVP-BOM-5 0015: rebuilt pricing_lines keeps the complete contract", () => {
  const { db, close } = freshChain();
  try {
    const columns = tableColumns(db, FRESH.pricing);
    assert.equal(Object.keys(columns).length, 37, "pricing_lines must carry 37 columns after 0015");

    // Provenance columns generalized (nullable), source identity enforced.
    for (const name of ["boq_item_id", "candidate_id", "safety_decision_id"]) {
      assert.equal(columns[name].notnull, 0, `${name} must be nullable`);
    }
    for (const name of ["source_type", "source_product_id"]) {
      assert.equal(columns[name].notnull, 1, `${name} must be NOT NULL`);
    }
    for (const name of ["engineering_scope_kind", "system", "source_role", "source_snapshot_id", "source_fingerprint"]) {
      assert.ok(columns[name], `${name} must exist`);
      assert.equal(columns[name].notnull, 0, `${name} must be nullable`);
    }

    // FK set fully recreated.
    assert.deepEqual(fkMap(db, FRESH.pricing), {
      pricing_run_id: "pricing_runs.id",
      project_id: "projects.id",
      boq_item_id: "boq_items.id",
      candidate_id: "product_match_candidates.id",
      product_id: "library_products.id",
      safety_decision_id: "safety_decisions.id",
      selected_price_record_id: "price_records.id",
    });

    // Named index set: the 3 historical + the SCOPE partial UNIQUE, plus the
    // PRIMARY KEY autoindex that SQLite manages for `id`.
    const indexes = indexFacts(db, FRESH.pricing);
    assert.deepEqual(Object.keys(indexes).sort(), [
      "pricing_lines_candidate_idx",
      "pricing_lines_project_status_idx",
      "pricing_lines_run_item_idx",
      "pricing_lines_scope_uniq",
      "sqlite_autoindex_pricing_lines_1",
    ]);
    assert.equal(indexes.sqlite_autoindex_pricing_lines_1.origin, "pk", "pricing_lines PK must be an autoindex");
    assert.equal(indexes.pricing_lines_run_item_idx.unique, 1);
    assert.equal(indexes.pricing_lines_run_item_idx.partial, 0);
    assert.equal(indexes.pricing_lines_scope_uniq.unique, 1);
    assert.equal(indexes.pricing_lines_scope_uniq.partial, 1, "pricing_lines_scope_uniq must be a partial UNIQUE");

    // CHECK constraints exist in the rebuilt DDL and are behaviorally live.
    const createSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='pricing_lines'").get().sql;
    assert.match(createSql, /CHECK\s*\(/);
    assert.match(createSql, /source_type = 'PRODUCT'/);
    assert.match(createSql, /source_type = 'SCOPE'/);

    assert.throws(() => insertScopePricingLine(db, { id: "pl-mismatch", sourceProductId: IDS.PRODUCT_2 }), /constraint/i);
    assert.throws(() => insertProductPricingLine(db, { id: "pl-noboq", boqItemId: null }), /constraint/i);
    assert.throws(() => insertScopePricingLine(db, { id: "pl-nofp", sourceFingerprint: null }), /constraint/i);
  } finally {
    close();
  }
});

test("MVP-BOM-5 0015: rebuilt project_quotation_lines keeps the complete contract", () => {
  const { db, close } = freshChain();
  try {
    const columns = tableColumns(db, FRESH.quotation);
    assert.equal(Object.keys(columns).length, 33, "project_quotation_lines must carry 33 columns after 0015");

    for (const name of ["boq_item_id", "candidate_id"]) {
      assert.equal(columns[name].notnull, 0, `${name} must be nullable`);
    }
    for (const name of ["source_type", "source_product_id"]) {
      assert.equal(columns[name].notnull, 1, `${name} must be NOT NULL`);
    }

    assert.deepEqual(fkMap(db, FRESH.quotation), {
      quotation_revision_id: "project_quotation_revisions.id",
      project_id: "projects.id",
      boq_item_id: "boq_items.id",
      candidate_id: "product_match_candidates.id",
      product_id: "library_products.id",
      pricing_run_id: "pricing_runs.id",
      pricing_line_id: "pricing_lines.id",
      commercial_approval_id: "pricing_approvals.id",
    });

    const indexes = indexFacts(db, FRESH.quotation);
    assert.deepEqual(Object.keys(indexes).sort(), [
      "quotation_lines_pricing_idx",
      "quotation_lines_product_idx",
      "quotation_lines_project_idx",
      "quotation_lines_revision_idx",
      "quotation_lines_scope_uniq",
      "sqlite_autoindex_project_quotation_lines_1",
      "sqlite_autoindex_project_quotation_lines_2",
    ]);
    assert.equal(indexes.quotation_lines_scope_uniq.unique, 1);
    assert.equal(indexes.quotation_lines_scope_uniq.partial, 1, "quotation_lines_scope_uniq must be a partial UNIQUE");
    assert.equal(indexes.sqlite_autoindex_project_quotation_lines_1.origin, "pk", "quotation PK must be an autoindex");
    assert.equal(indexes.sqlite_autoindex_project_quotation_lines_2.origin, "u", "table-level UNIQUE(revision,boq) must survive");

    // table-level UNIQUE(quotation_revision_id, boq_item_id) still enforced.
    insertProductPricingLine(db, { id: "pl-prod-1" });
    insertProductQuotationLine(db, { id: "ql-prod-1" });
    assert.throws(
      () => db.prepare("INSERT INTO project_quotation_lines (id,quotation_revision_id,project_id,boq_item_id,sequence,candidate_id,unit,quantity,product_id,manufacturer_name,part_number,product_description,pricing_run_id,pricing_run_version,pricing_line_id,pricing_line_version,pricing_input_fingerprint,commercial_approval_id,commercial_approval_version,currency,total_cost_minor,net_selling_minor,source_snapshot_json,created_at,source_type,source_product_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run("ql-prod-dup", IDS.QUOTATION_REVISION, IDS.PROJECT, IDS.BOQ_ITEM, 3, IDS.CANDIDATE, "EA", "1",
          IDS.PRODUCT, "Honeywell", "P-001", "Fixture product", IDS.RUN, 1, "pl-prod-1", 1,
          "fp-dup", IDS.COMMERCIAL_APPROVAL, 1, "SAR", 100, 100, "{}", "now", "PRODUCT", IDS.PRODUCT),
      /UNIQUE constraint failed/i,
    );

    // Immutability triggers recreated after the rebuild: UPDATE and DELETE
    // are rejected, INSERT is still possible.
    assert.throws(
      () => db.prepare("UPDATE project_quotation_lines SET quantity=? WHERE id='ql-prod-1'").run("99"),
      /QUOTATION_LINE_SNAPSHOT_IMMUTABLE/,
    );
    assert.throws(
      () => db.prepare("DELETE FROM project_quotation_lines WHERE id='ql-prod-1'").run(),
      /QUOTATION_LINE_SNAPSHOT_IMMUTABLE/,
    );
    assert.equal(count(db, "SELECT count(*) AS c FROM project_quotation_lines WHERE id='ql-prod-1'"), 1);
  } finally {
    close();
  }
});

// ---------------------------------------------------------------------------
// 2. UPGRADE WITH LIVE LEGACY ROWS -- preservation + backfill proof
// ---------------------------------------------------------------------------

test("MVP-BOM-5 0015: upgrade preserves legacy rows, backfills PRODUCT identity, keeps FK enforcement", () => {
  const opened = applyChainAround(TAG_0015, legacySeed);
  const { db, close } = opened;
  try {
    assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1, "FK enforcement must be ON after the upgrade");
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), [], "no orphan rows after the rebuild");

    // The legacy pricing line: same id, full PRODUCT backfill, scope NULL.
    const pl = db.prepare("SELECT * FROM pricing_lines WHERE id='pl-legacy-1'").get();
    assert.ok(pl, "legacy pricing line must survive under its original id");
    assert.equal(pl.boq_item_id, IDS.BOQ_ITEM);
    assert.equal(pl.candidate_id, IDS.CANDIDATE);
    assert.equal(pl.safety_decision_id, IDS.SAFETY);
    assert.equal(pl.source_type, "PRODUCT");
    assert.equal(pl.source_product_id, IDS.PRODUCT);
    assert.equal(pl.source_product_id, pl.product_id);
    assert.equal(pl.engineering_scope_kind, null);
    assert.equal(pl.system, null);
    assert.equal(pl.source_role, null);
    assert.equal(pl.source_snapshot_id, null);
    assert.equal(pl.source_fingerprint, null);

    // The legacy quotation line: preserved with the same PRODUCT backfill.
    const ql = db.prepare("SELECT * FROM project_quotation_lines WHERE id='ql-legacy-1'").get();
    assert.ok(ql, "legacy quotation line must survive under its original id");
    assert.equal(ql.boq_item_id, IDS.BOQ_ITEM);
    assert.equal(ql.candidate_id, IDS.CANDIDATE);
    assert.equal(ql.source_type, "PRODUCT");
    assert.equal(ql.source_product_id, IDS.PRODUCT);

    // Children referencing pricing_lines still resolve against the renamed table.
    assert.equal(count(db, "SELECT count(*) AS c FROM pricing_cost_components WHERE id='pcc-1' AND pricing_line_id='pl-legacy-1'"), 1);
    assert.equal(count(db, "SELECT count(*) AS c FROM pricing_approvals WHERE id='pa-child' AND pricing_line_id='pl-legacy-1'"), 1);

    // Counts intact: the rebuild must copy, not duplicate or drop.
    assert.equal(count(db, "SELECT count(*) AS c FROM pricing_lines"), 1);
    assert.equal(count(db, "SELECT count(*) AS c FROM project_quotation_lines"), 1);

    // The generalized model is usable on the SAME upgraded database.
    insertScopePricingLine(db, { id: "pl-scope-1" });
    insertScopeQuotationLine(db, { id: "ql-scope-1" });
    assert.equal(count(db, "SELECT count(*) AS c FROM pricing_lines WHERE id='pl-scope-1' AND source_type='SCOPE' AND boq_item_id IS NULL"), 1);
    assert.equal(count(db, "SELECT count(*) AS c FROM project_quotation_lines WHERE id='ql-scope-1' AND source_type='SCOPE' AND boq_item_id IS NULL"), 1);

    // Rejection specificity survives the upgrade too.
    assert.throws(() => insertScopePricingLine(db, { id: "pl-scope-dup" }), /constraint/i);
    assert.throws(() => insertScopePricingLine(db, { id: "pl-mismatch", sourceProductId: IDS.PRODUCT_2 }), /constraint/i);
    assert.throws(() => insertProductPricingLine(db, { id: "pl-noboq", boqItemId: null }), /constraint/i);
    assert.equal(count(db, "SELECT count(*) AS c FROM pricing_lines"), 2, "only the two accepted lines may exist");

    // Quotation immutability guards were recreated on the renamed table.
    assert.throws(
      () => db.prepare("UPDATE project_quotation_lines SET quantity=? WHERE id='ql-legacy-1'").run("99"),
      /QUOTATION_LINE_SNAPSHOT_IMMUTABLE/,
    );
    assert.throws(
      () => db.prepare("DELETE FROM project_quotation_lines WHERE id='ql-legacy-1'").run(),
      /QUOTATION_LINE_SNAPSHOT_IMMUTABLE/,
    );

    // Every legacy row is still there at the end of the whole proof.
    assert.equal(count(db, "SELECT count(*) AS c FROM pricing_lines WHERE id='pl-legacy-1'"), 1);
  } finally {
    close();
  }
});