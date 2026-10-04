import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

// KN-GOVERNANCE-REPAIR (§10): legacy authority reconciliation is triage plus
// a governed re-confirmation record -- never deletion, downgrade, or history
// rewrite.
import {
  LEGACY_RECONFIRM_ACTION,
  classifyLegacyAuthorityRow,
  reconfirmLegacyAuthority,
} from "../app/domain/legacy-authority-reconciliation.mjs";

const ACTOR = { id: "engineer-1", permission: "Library Manager" };
const REASON = "Reconfirmed against the cited manufacturer datasheet after evidence review.";

const fixture = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE product_accessories (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL, review_status TEXT NOT NULL,
      evidence_json TEXT NOT NULL DEFAULT '{}', confidence INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      superseded_at TEXT, deleted_at TEXT);
    CREATE TABLE product_library_decisions (
      id TEXT PRIMARY KEY, project_id TEXT, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      action TEXT NOT NULL, previous_value TEXT, new_value TEXT, reason TEXT NOT NULL,
      decided_by TEXT NOT NULL, decided_role TEXT NOT NULL,
      decided_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
  const DB = {
    prepare: (sql) => {
      const bound = (...args) => ({
        first: async () => raw.prepare(sql).get(...args) ?? null,
        all: async () => ({ results: raw.prepare(sql).all(...args) }),
        run: async () => raw.prepare(sql).run(...args),
      });
      return { ...bound(), bind: (...args) => bound(...args) };
    },
    batch: async (statements) => { for (const s of statements) await s.run(); return []; },
  };
  return { raw, DB };
};

const seedRow = (raw, id, evidence, reviewStatus = "Approved") =>
  raw.prepare("INSERT INTO product_accessories VALUES (?,?,?,?,?,?,?,?,?)").run(
    id, "product-a", reviewStatus, JSON.stringify(evidence), 82, "sprint-1.31-heat-detector-family-seed",
    "2026-08-01T00:00:00.000Z", null, null,
  );

test("manufacturer-documented rows classify RECOVERABLE", () => {
  assert.equal(classifyLegacyAuthorityRow({
    table: "product_accessories",
    row: { review_status: "Approved", evidence_json: JSON.stringify({ source: "Honeywell DN-60054 detector bases" }) },
    knowledgeFactExists: false,
  }).status, "RECOVERABLE");
});

test("price-list-only rows classify REVIEW_REQUIRED_LEGACY_AUTHORITY", () => {
  assert.equal(classifyLegacyAuthorityRow({
    table: "product_accessories",
    row: { review_status: "Approved", evidence_json: JSON.stringify([{ sourceType: "Manufacturer Price List", fileName: "price.xlsx" }]) },
  }).status, "REVIEW_REQUIRED_LEGACY_AUTHORITY");
});

test("missing evidence classifies REVIEW_REQUIRED_LEGACY_AUTHORITY", () => {
  for (const evidence of [null, "", "{}", "[]"]) {
    assert.equal(classifyLegacyAuthorityRow({
      table: "product_accessories",
      row: { review_status: "Approved", evidence_json: evidence },
    }).status, "REVIEW_REQUIRED_LEGACY_AUTHORITY");
  }
});

test("non-approved rows and unknown tables are out of scope", () => {
  assert.equal(classifyLegacyAuthorityRow({ table: "product_accessories", row: { review_status: "Needs Review", evidence_json: "{}" } }).status, "NOT_LEGACY_APPROVED");
  assert.equal(classifyLegacyAuthorityRow({ table: "price_records", row: { review_status: "Approved" } }).status, "OUT_OF_SCOPE");
});

test("reconfirm records a governed decision without touching the row", async () => {
  const { raw, DB } = fixture();
  try {
    seedRow(raw, "acc-1", { source: "Honeywell DN-60054" });
    const before = raw.prepare("SELECT review_status, created_by, evidence_json FROM product_accessories WHERE id='acc-1'").get();
    const result = await reconfirmLegacyAuthority(DB, {
      canonicalTable: "product_accessories", rowId: "acc-1", actor: ACTOR, reason: REASON,
    });
    assert.equal(result.status, "RECONFIRMED");
    assert.equal(result.idempotent, false);
    const after = raw.prepare("SELECT review_status, created_by, evidence_json FROM product_accessories WHERE id='acc-1'").get();
    assert.deepEqual(after, before, "re-confirmation must never rewrite history");
    const decision = raw.prepare("SELECT action, decided_by, decided_role, reason FROM product_library_decisions").get();
    assert.deepEqual(
      [decision.action, decision.decided_by, decision.decided_role, decision.reason],
      [LEGACY_RECONFIRM_ACTION, "engineer-1", "Library Manager", REASON],
    );
  } finally {
    raw.close();
  }
});

test("reconfirm is idempotent and refuses bad inputs", async () => {
  const { raw, DB } = fixture();
  try {
    seedRow(raw, "acc-1", { source: "Honeywell DN-60054" });
    const first = await reconfirmLegacyAuthority(DB, {
      canonicalTable: "product_accessories", rowId: "acc-1", actor: ACTOR, reason: REASON,
    });
    const second = await reconfirmLegacyAuthority(DB, {
      canonicalTable: "product_accessories", rowId: "acc-1", actor: ACTOR, reason: REASON,
    });
    assert.equal(second.idempotent, true);
    assert.equal(second.decisionId, first.decisionId);
    assert.equal(raw.prepare("SELECT COUNT(*) c FROM product_library_decisions").get().c, 1);
    assert.equal((await reconfirmLegacyAuthority(DB, { canonicalTable: "price_records", rowId: "x", actor: ACTOR, reason: REASON })).status, "TABLE_NOT_RECONCILABLE");
    assert.equal((await reconfirmLegacyAuthority(DB, { canonicalTable: "product_accessories", rowId: "missing", actor: ACTOR, reason: REASON })).status, "ROW_NOT_FOUND");
    assert.equal((await reconfirmLegacyAuthority(DB, { canonicalTable: "product_accessories", rowId: "acc-1", actor: ACTOR, reason: "no" })).status, "REASON_REQUIRED");
    assert.equal((await reconfirmLegacyAuthority(DB, { canonicalTable: "product_accessories", rowId: "acc-1", actor: {}, reason: REASON })).status, "ACTOR_REQUIRED");
  } finally {
    raw.close();
  }
});

test("non-approved and non-current rows cannot be reconfirmed", async () => {
  const { raw, DB } = fixture();
  try {
    seedRow(raw, "acc-nr", { source: "x" }, "Needs Review");
    assert.equal((await reconfirmLegacyAuthority(DB, { canonicalTable: "product_accessories", rowId: "acc-nr", actor: ACTOR, reason: REASON })).status, "ROW_NOT_APPROVED");
    raw.exec("UPDATE product_accessories SET superseded_at='2026-01-01T00:00:00.000Z' WHERE id='acc-nr'");
    raw.exec("UPDATE product_accessories SET review_status='Approved' WHERE id='acc-nr'");
    assert.equal((await reconfirmLegacyAuthority(DB, { canonicalTable: "product_accessories", rowId: "acc-nr", actor: ACTOR, reason: REASON })).status, "ROW_NOT_CURRENT");
  } finally {
    raw.close();
  }
});
