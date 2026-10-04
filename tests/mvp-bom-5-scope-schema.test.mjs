import assert from "node:assert/strict";
import test from "node:test";

import { applyActiveChain, openEmptyDatabase } from "./helpers/active-chain.mjs";
import {
  IDS,
  insertProductPricingLine,
  insertProductQuotationLine,
  insertScopePricingLine,
  insertScopeQuotationLine,
  seedProductGraph,
} from "./fixtures/mvp-bom-5-seed.mjs";

/**
 * MVP-BOM-5 Phases 2-3 contract: a pure SCOPE source (a sizing/engineering
 * requirement with NO boq/candidate/safety provenance) must be representable on
 * the pricing and quotation line model, while PRODUCT provenance stays strict.
 *
 * Failing-before evidence: on the pre-0015 active chain these SCOPE acceptance
 * tests fail because the generalized source identity does not exist and the
 * provenance columns are NOT NULL. After 0015 lands they pass; the rejection
 * and immutability tests pass on both sides (stability contract).
 */
const buildChain = () => {
  const opened = openEmptyDatabase();
  applyActiveChain(opened.db);
  seedProductGraph(opened.db);
  return opened;
};

test("MVP-BOM-5: valid PRODUCT pricing row remains accepted", () => {
  const { db, close } = buildChain();
  try {
    insertProductPricingLine(db, { id: "pl-prod-1" });
    const row = db.prepare("SELECT * FROM pricing_lines WHERE id='pl-prod-1'").get();
    assert.equal(row.boq_item_id, IDS.BOQ_ITEM);
    assert.equal(row.candidate_id, IDS.CANDIDATE);
    assert.equal(row.safety_decision_id, IDS.SAFETY);
    assert.equal(row.source_type, "PRODUCT");
    assert.equal(row.source_product_id, IDS.PRODUCT);
  } finally {
    close();
  }
});

test("MVP-BOM-5: pure SCOPE pricing row is accepted (NULL provenance, full scope identity)", () => {
  const { db, close } = buildChain();
  try {
    insertScopePricingLine(db, { id: "pl-scope-1" });
    const row = db.prepare("SELECT * FROM pricing_lines WHERE id='pl-scope-1'").get();
    assert.equal(row.boq_item_id, null);
    assert.equal(row.candidate_id, null);
    assert.equal(row.safety_decision_id, null);
    assert.equal(row.source_type, "SCOPE");
    assert.equal(row.engineering_scope_kind, "Sizing");
    assert.equal(row.system, "Fire Alarm");
    assert.equal(row.source_role, "Panel Sizing");
    assert.equal(row.source_snapshot_id, "snap-1");
    assert.equal(row.source_fingerprint, "fingerprint-scope-1");
    assert.equal(row.source_product_id, IDS.PRODUCT);
    // A second SCOPE line in the same run with a DIFFERENT scope identity is
    // accepted (proves the partial UNIQUE is scoped, not global).
    insertScopePricingLine(db, { id: "pl-scope-2", sourceRole: "Riser Diagram", sourceFingerprint: "fingerprint-scope-2" });
    assert.equal(db.prepare("SELECT count(*) AS c FROM pricing_lines WHERE source_type='SCOPE'").get().c, 2);
  } finally {
    close();
  }
});

test("MVP-BOM-5: SCOPE pricing row with source product mismatch is rejected", () => {
  const { db, close } = buildChain();
  try {
    assert.throws(
      () => insertScopePricingLine(db, { id: "pl-mismatch", sourceProductId: IDS.PRODUCT_2 }),
      /constraint/i,
    );
    assert.equal(db.prepare("SELECT count(*) AS c FROM pricing_lines WHERE id='pl-mismatch'").get().c, 0);
  } finally {
    close();
  }
});

test("MVP-BOM-5: incomplete SCOPE pricing identity is rejected", () => {
  const { db, close } = buildChain();
  try {
    assert.throws(
      () => insertScopePricingLine(db, { id: "pl-incomplete", sourceFingerprint: null }),
      /constraint/i,
    );
    assert.equal(db.prepare("SELECT count(*) AS c FROM pricing_lines WHERE id='pl-incomplete'").get().c, 0);
  } finally {
    close();
  }
});

test("MVP-BOM-5: duplicate SCOPE pricing row (same run, kind, system, product, role) is rejected", () => {
  const { db, close } = buildChain();
  try {
    insertScopePricingLine(db, { id: "pl-scope-1" });
    assert.throws(
      () => insertScopePricingLine(db, { id: "pl-scope-dup" }),
      /constraint/i,
    );
    assert.equal(db.prepare("SELECT count(*) AS c FROM pricing_lines WHERE id='pl-scope-dup'").get().c, 0);
  } finally {
    close();
  }
});

test("MVP-BOM-5: PRODUCT pricing row without BOQ provenance is rejected", () => {
  const { db, close } = buildChain();
  try {
    assert.throws(
      () => insertProductPricingLine(db, { id: "pl-noboq", boqItemId: null }),
      /constraint/i,
    );
    assert.equal(db.prepare("SELECT count(*) AS c FROM pricing_lines WHERE id='pl-noboq'").get().c, 0);
  } finally {
    close();
  }
});

test("MVP-BOM-5: PRODUCT pricing row without candidate provenance is rejected", () => {
  const { db, close } = buildChain();
  try {
    assert.throws(
      () => insertProductPricingLine(db, { id: "pl-nocandidate", candidateId: null }),
      /constraint/i,
    );
    assert.equal(db.prepare("SELECT count(*) AS c FROM pricing_lines WHERE id='pl-nocandidate'").get().c, 0);
  } finally {
    close();
  }
});

test("MVP-BOM-5: PRODUCT pricing row without safety provenance is rejected", () => {
  const { db, close } = buildChain();
  try {
    assert.throws(
      () => insertProductPricingLine(db, { id: "pl-nosafety", safetyDecisionId: null }),
      /constraint/i,
    );
    assert.equal(db.prepare("SELECT count(*) AS c FROM pricing_lines WHERE id='pl-nosafety'").get().c, 0);
  } finally {
    close();
  }
});

test("MVP-BOM-5: legacy-shaped SCOPE pricing row (omitting the source columns) is rejected", () => {
  const { db, close } = buildChain();
  try {
    assert.throws(() => db.prepare(
      "INSERT INTO pricing_lines (id,pricing_run_id,project_id,boq_item_id,candidate_id,safety_decision_id,version_number,status,quantity,unit,project_currency,output,explanation,approval_ready) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run("pl-legacy", IDS.RUN, IDS.PROJECT, null, null, null, 1, "Approved", 1, "EA", "SAR", "{}", "fixture", 1), /constraint|source_type/i);
    assert.equal(db.prepare("SELECT count(*) AS c FROM pricing_lines WHERE id='pl-legacy'").get().c, 0);
  } finally {
    close();
  }
});

test("MVP-BOM-5: valid PRODUCT quotation row is accepted", () => {
  const { db, close } = buildChain();
  try {
    insertProductPricingLine(db, { id: "pl-prod-1" });
    insertProductQuotationLine(db, { id: "ql-prod-1" });
    const row = db.prepare("SELECT * FROM project_quotation_lines WHERE id='ql-prod-1'").get();
    assert.equal(row.boq_item_id, IDS.BOQ_ITEM);
    assert.equal(row.candidate_id, IDS.CANDIDATE);
    assert.equal(row.source_type, "PRODUCT");
    assert.equal(row.source_product_id, IDS.PRODUCT);
  } finally {
    close();
  }
});

test("MVP-BOM-5: pure SCOPE quotation row is accepted", () => {
  const { db, close } = buildChain();
  try {
    insertScopePricingLine(db, { id: "pl-scope-1" });
    insertScopeQuotationLine(db, { id: "ql-scope-1" });
    const row = db.prepare("SELECT * FROM project_quotation_lines WHERE id='ql-scope-1'").get();
    assert.equal(row.boq_item_id, null);
    assert.equal(row.candidate_id, null);
    assert.equal(row.source_type, "SCOPE");
    assert.equal(row.engineering_scope_kind, "Sizing");
    assert.equal(row.source_fingerprint, "fingerprint-scope-1");
    assert.equal(row.source_product_id, IDS.PRODUCT);
  } finally {
    close();
  }
});

test("MVP-BOM-5: duplicate SCOPE quotation row is rejected", () => {
  const { db, close } = buildChain();
  try {
    insertScopePricingLine(db, { id: "pl-scope-1" });
    insertScopeQuotationLine(db, { id: "ql-scope-1" });
    assert.throws(
      () => insertScopeQuotationLine(db, { id: "ql-scope-dup" }),
      /constraint/i,
    );
    assert.equal(db.prepare("SELECT count(*) AS c FROM project_quotation_lines WHERE id='ql-scope-dup'").get().c, 0);
  } finally {
    close();
  }
});

test("MVP-BOM-5: quotation lines remain immutable (UPDATE and DELETE rejected)", () => {
  const { db, close } = buildChain();
  try {
    insertProductPricingLine(db, { id: "pl-prod-1" });
    insertProductQuotationLine(db, { id: "ql-prod-1" });
    assert.throws(
      () => db.prepare("UPDATE project_quotation_lines SET quantity=? WHERE id='ql-prod-1'").run("99"),
      /QUOTATION_LINE_SNAPSHOT_IMMUTABLE/,
    );
    assert.throws(
      () => db.prepare("DELETE FROM project_quotation_lines WHERE id='ql-prod-1'").run(),
      /QUOTATION_LINE_SNAPSHOT_IMMUTABLE/,
    );
    const row = db.prepare("SELECT quantity FROM project_quotation_lines WHERE id='ql-prod-1'").get();
    assert.equal(row.quantity, "1");
  } finally {
    close();
  }
});