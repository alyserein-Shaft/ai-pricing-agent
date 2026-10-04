import test from "node:test";
import assert from "node:assert/strict";

import {
  repairKnowledgeProductLink,
  IDENTITY_REPAIR_LINK_STATE,
  IDENTITY_REPAIR_AUDIT_TYPE,
} from "../worker/knowledge-product-repair.mjs";

const ORG = "organization_bd_shaft_internal_pilot";
const CANONICAL = "product_0c4c8db3-674b-4564-8249-463c00885317";
const DOT_VARIANT = "product_918ff5e3-2edb-4918-a29d-7ebf37dff322";
const FACT_ID = "knowledgeFact_6dbbd08f-4e40-48b5-8601-e644b2b2c556";
const LINK_ID = "knowledgeLink_a2bc1e97-9287-497e-934b-1d9c2ba83b39";

const stripJs = (value) => String(value ?? "").toUpperCase().replace(/[- _./:]/g, "");

const factRow = (overrides = {}) => ({
  id: FACT_ID,
  organization_id: ORG,
  knowledge_file_id: "knowledgeFile_1",
  fact_type: "Part Number",
  original_value: "IDP-PHOTO-IV",
  normalized_value: "idp-photo-iv",
  attributes: "{}",
  review_status: "Learned",
  ...overrides,
});

const linkRow = (overrides = {}) => ({
  id: LINK_ID,
  organization_id: ORG,
  knowledge_fact_id: FACT_ID,
  part_number: "IDP-PHOTO-IV",
  existing_product_id: null,
  link_state: "New Product Candidate",
  new_information: JSON.stringify({ originalField: "preserved" }),
  created_at: "2026-08-04 13:54:16",
  ...overrides,
});

const productRow = (overrides = {}) => ({
  id: CANONICAL,
  manufacturer_id: "manufacturer_honeywell",
  manufacturer_name: "Honeywell",
  part_number: "IDP-PHOTO-IV",
  normalized_part_number: "IDP-PHOTO-IV",
  description: "Photoelectric smoke detector",
  attributes: JSON.stringify([{ name: "protocol", value: "FlashScan" }]),
  library_scope: "Global Library",
  organization_id: null,
  library_project_id: null,
  identity_status: "Active",
  superseded_by_product_id: null,
  review_status: "Needs Review",
  approved_for_discovery: 0,
  ...overrides,
});

const dotRow = () => productRow({
  id: DOT_VARIANT,
  part_number: "IDP-PHOTO-IV.",
  normalized_part_number: "IDP-PHOTO-IV.",
  identity_status: "Superseded",
  superseded_by_product_id: CANONICAL,
});

function makeDb({ facts, links, products, conflicts = [], prices, hooks = {} } = {}) {
  const tables = {
    knowledge_facts: facts ?? [factRow()],
    knowledge_product_links: links ?? [linkRow()],
    library_products: products ?? [productRow(), dotRow()],
    product_conflicts: conflicts,
    knowledge_file_events: [],
    knowledge_files: [{ id: "knowledgeFile_1", organization_id: ORG }],
    price_records: prices ?? [{ id: "price_1", product_id: CANONICAL, amount_minor: 100 }],
  };
  const productsById = () => new Map(tables.library_products.map((row) => [row.id, row]));
  const calls = { statements: [], linkUpdates: 0, eventInserts: 0, batches: [] };
  // Per-batch SQLite changes() emulation: the guarded UPDATE advances this
  // "connection's" lastChanges; the audit INSERT only fires when lastChanges
  // is exactly 1 (this invocation's own mutation) AND the link row actually
  // carries the intended target (the real SQL's EXISTS integrity check). This
  // makes the concurrency-causality tests real rather than row-state checks.
  const conn = { lastChanges: 0 };
  const snapshot = () => JSON.parse(JSON.stringify(tables));

  const applyFirst = (sql, args) => {
    if (sql.includes("FROM organizations")) return { id: args[0], name: "Test Org" };
    if (sql.includes("FROM knowledge_facts WHERE id=?")) {
      const row = tables.knowledge_facts.find((entry) => entry.id === args[0]);
      return row && row.organization_id === args[1] ? row : null;
    }
    if (sql.includes("JOIN product_manufacturers m ON m.id=p.manufacturer_id")) {
      return productsById().get(args[0]) || null;
    }
    throw new Error(`Unexpected .first(): ${sql}`);
  };

  const applyAll = (sql, args) => {
    if (sql.includes("sqlite_master")) return { results: args.map((name) => ({ name })) };
    if (sql.includes("FROM knowledge_product_links WHERE knowledge_fact_id=?")) {
      return {
        results: tables.knowledge_product_links
          .filter((row) => row.knowledge_fact_id === args[0] && row.organization_id === args[1])
          .slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1)),
      };
    }
    if (sql.includes("FROM knowledge_product_links WHERE id=?")) {
      return { results: tables.knowledge_product_links.filter((row) => row.id === args[0] && row.organization_id === args[1]) };
    }
    if (sql.includes("FROM library_products p")) {
      const partForms = args.slice(0, 3);
      const normForms = args.slice(3, 7);
      const upperForm = args[7];
      const stripForm = args[8];
      const orgId = args[9];
      const projectIds = args.slice(10);
      return {
        results: tables.library_products.filter((row) => {
          const scope = row.library_scope;
          const visible = scope === "Global Library"
            || (scope === "Organization Library" && row.organization_id === orgId)
            || (scope === "Project Library" && projectIds.includes(row.library_project_id));
          if (!visible) return false;
          return partForms.includes(row.part_number)
            || normForms.includes(row.normalized_part_number)
            || String(row.part_number).trim().toUpperCase() === upperForm
            || stripJs(row.part_number) === stripForm;
        }),
      };
    }
    if (sql.includes("FROM product_conflicts")) return { results: tables.product_conflicts };
    throw new Error(`Unexpected .all(): ${sql}`);
  };

  const applyWrite = (sql, args) => {
    if (sql.includes("UPDATE knowledge_product_links")) {
      if (hooks.updateNoopOnce) {
        hooks.updateNoopOnce = false;
        conn.lastChanges = 0;
        return { meta: { changes: 0 } };
      }
      const [target, state, info, id, orgId, factId, partNumber] = args;
      const row = tables.knowledge_product_links.find((entry) =>
        entry.id === id && entry.organization_id === orgId && entry.knowledge_fact_id === factId
        && entry.existing_product_id === null && entry.link_state === "New Product Candidate"
        && entry.part_number === partNumber);
      if (!row) {
        conn.lastChanges = 0;
        return { meta: { changes: 0 } };
      }
      row.existing_product_id = target;
      row.link_state = state;
      row.new_information = info;
      calls.linkUpdates += 1;
      conn.lastChanges = 1;
      return { meta: { changes: 1 } };
    }
    if (sql.includes("INSERT OR IGNORE INTO knowledge_file_events")) {
      if (hooks.failAudit) throw new Error("Simulated audit write failure.");
      const [id] = args;
      if (tables.knowledge_file_events.some((entry) => entry.id === id)) {
        return { meta: { changes: 0 } };
      }
      if (hooks.failAuditAfterUpdate) throw new Error("Simulated audit failure after link update.");
      // Conditional audit mirrors the real SQL: (SELECT changes()) = 1 AND
      // EXISTS(link row carries the exact target). A lost race (guarded UPDATE
      // changed 0 rows -> lastChanges 0) concedes ZERO audit rows.
      const [linkId, orgId, target] = args.slice(6, 9);
      const applied = tables.knowledge_product_links.some((entry) =>
        entry.id === linkId && entry.organization_id === orgId && entry.existing_product_id === target);
      if (conn.lastChanges !== 1 || !applied) return { meta: { changes: 0 } };
      tables.knowledge_file_events.push({
        id,
        organization_id: args[1],
        knowledge_file_id: args[2],
        event_type: args[3],
        details: args[4],
        actor_user_id: args[5],
      });
      calls.eventInserts += 1;
      return { meta: { changes: 1 } };
    }
    throw new Error(`Unexpected write: ${sql}`);
  };

  const db = {
    calls,
    tables,
    snapshot,
    hooks,
    prepare(sql) {
      calls.statements.push(sql);
      return {
        bind(...args) {
          return {
            _sql: sql,
            first: () => applyFirst(sql, args),
            all: () => applyAll(sql, args),
            run: () => applyWrite(sql, args),
            _batchExec: () => applyWrite(sql, args),
          };
        },
      };
    },
    async batch(statements) {
      if (hooks.onBeforeBatch) {
        const hook = hooks.onBeforeBatch;
        hooks.onBeforeBatch = null;
        hook();
      }
      calls.batches.push(statements.map((statement) => statement._sql));
      return statements.map((statement) => statement._batchExec());
    },
  };
  return db;
}

const repairInput = (overrides = {}) => ({
  factId: FACT_ID,
  organizationId: ORG,
  expectedLinkId: LINK_ID,
  expectedTarget: CANONICAL,
  actor: { id: "test-engineer", role: "Administrator", context: "test" },
  ...overrides,
});

const auditOf = (db) => db.tables.knowledge_file_events.find(
  (entry) => entry.event_type === IDENTITY_REPAIR_AUDIT_TYPE,
);

// R1-R6: golden repair succeeds with exact state + audit.
test("R1 golden NPC/null repair succeeds", async () => {
  const db = makeDb();
  const result = await repairKnowledgeProductLink(db, repairInput());
  assert.equal(result.ok, true);
  assert.equal(result.outcome, "REPAIRED");
  assert.equal(result.target, CANONICAL);
  assert.equal(result.writes.linkWrites, 1);
  assert.equal(result.writes.auditWrites, 1);
});

test("R2-R5 link row is UPDATED in place with exact target and state", async () => {
  const db = makeDb();
  await repairKnowledgeProductLink(db, repairInput());
  const rows = db.tables.knowledge_product_links.filter((row) => row.knowledge_fact_id === FACT_ID);
  assert.equal(rows.length, 1, "link COUNT for the fact remains exactly 1 (no duplicate INSERT)");
  assert.equal(rows[0].id, LINK_ID, "same row updated, not replaced");
  assert.equal(rows[0].existing_product_id, CANONICAL);
  assert.equal(rows[0].link_state, "Existing Product — Additive Learning Only");
  assert.equal(rows[0].link_state, IDENTITY_REPAIR_LINK_STATE);
  assert.equal(rows[0].part_number, "IDP-PHOTO-IV", "link row part number never erased by identity repair");
});

test("R6-R12 audit event written with identity-only boundary and preserved prior content", async () => {
  const db = makeDb();
  await repairKnowledgeProductLink(db, repairInput());
  const audit = auditOf(db);
  assert.ok(audit, "audit event written");
  assert.ok(audit.id.includes(LINK_ID) && audit.id.includes(CANONICAL), "deterministic id from link + target");
  const details = JSON.parse(audit.details);
  assert.equal(details.canonicalTarget, CANONICAL);
  assert.equal(details.originalPartNumber, "IDP-PHOTO-IV", "original observed/source part number preserved in audit");
  assert.equal(details.safety.approvedForDiscovery, false);
  assert.equal(details.safety.costingEligible, false);
  assert.equal(details.safety.technicalEvaluation, "NOT_PERFORMED");
  const link = db.tables.knowledge_product_links[0];
  const info = JSON.parse(link.new_information);
  assert.equal(info.identityRepair.identityDecisionOnly, true);
  assert.equal(info.identityRepair.technicalSuitabilityEvaluated, false);
  assert.equal(info.originalField, "preserved", "prior new_information content preserved");
  assert.equal(info.identityRepair.previousExistingProductId, null);
  assert.equal(info.identityRepair.canonicalProductId, CANONICAL);
  assert.equal(info.identityRepair.originalPartNumber, "IDP-PHOTO-IV", "original observed/source part number preserved in repaired link provenance");
});

// R13-R17: governance invariants.
test("R13-R17 product, fact, price, and supersession state unchanged", async () => {
  const db = makeDb();
  const before = db.snapshot();
  await repairKnowledgeProductLink(db, repairInput());
  const after = db.snapshot();
  assert.deepEqual(after.library_products, before.library_products, "products incl. review/discovery/attributes/supersession unchanged");
  assert.deepEqual(after.knowledge_facts, before.knowledge_facts, "fact review state unchanged");
  assert.deepEqual(after.price_records, before.price_records, "prices/costing unchanged");
  assert.deepEqual(after.product_conflicts, before.product_conflicts, "conflicts unchanged");
});

// R18: immediate retry is an idempotent no-op.
test("R18 retry after repair resolves ALREADY_LINKED with zero writes and one audit", async () => {
  const db = makeDb();
  const first = await repairKnowledgeProductLink(db, repairInput());
  assert.equal(first.outcome, "REPAIRED");
  db.calls.linkUpdates = 0;
  db.calls.eventInserts = 0;
  const second = await repairKnowledgeProductLink(db, repairInput());
  assert.equal(second.ok, true);
  assert.equal(second.outcome, "ALREADY_LINKED");
  assert.equal(second.writes.linkWrites, 0);
  assert.equal(second.writes.auditWrites, 0);
  assert.equal(db.calls.linkUpdates, 0);
  assert.equal(db.calls.eventInserts, 0);
  assert.equal(db.tables.knowledge_file_events.length, 1, "no duplicate audit");
});

// R19: true race, same target wins first.
test("R19 zero-row guard with same-target winner returns ALREADY_LINKED without overwrite", async () => {
  const db = makeDb();
  db.hooks.onBeforeBatch = () => {
    const row = db.tables.knowledge_product_links[0];
    row.existing_product_id = CANONICAL;
    row.link_state = IDENTITY_REPAIR_LINK_STATE;
    row.new_information = JSON.stringify({ winner: "concurrent" });
  };
  const result = await repairKnowledgeProductLink(db, repairInput());
  assert.equal(result.outcome, "ALREADY_LINKED");
  assert.equal(result.ok, true);
  assert.equal(result.writes.linkWrites, 0);
  // Causality, not id convergence: the losing invocation's guarded UPDATE
  // changed 0 rows, so changes() is 0 and its audit INSERT is skipped
  // entirely — ZERO audit rows are attributable to the loser.
  const audits = db.tables.knowledge_file_events.filter(
    (entry) => entry.event_type === IDENTITY_REPAIR_AUDIT_TYPE,
  );
  assert.equal(audits.length, 0, "losing invocation writes ZERO audit rows");
  assert.equal(result.writes.auditWrites, 0, "loser reports zero audit writes");
  assert.equal(db.calls.eventInserts, 0, "no audit INSERT conceded by the loser");
  const retry = await repairKnowledgeProductLink(db, repairInput());
  assert.equal(retry.outcome, "ALREADY_LINKED");
  assert.equal(
    db.tables.knowledge_file_events.filter((entry) => entry.event_type === IDENTITY_REPAIR_AUDIT_TYPE).length,
    0,
    "retry creates zero duplicate audit",
  );
  const row = db.tables.knowledge_product_links[0];
  assert.equal(row.existing_product_id, CANONICAL);
  assert.equal(JSON.parse(row.new_information).winner, "concurrent", "competitor state never overwritten");
});

// R20: true race, different target wins first.
test("R20 zero-row guard with different-target winner returns EXISTING_LINK_CONFLICT", async () => {
  const db = makeDb();
  db.hooks.onBeforeBatch = () => {
    const row = db.tables.knowledge_product_links[0];
    row.existing_product_id = "product_competitor-1";
    row.link_state = IDENTITY_REPAIR_LINK_STATE;
  };
  const result = await repairKnowledgeProductLink(db, repairInput());
  assert.equal(result.ok, false);
  assert.equal(result.outcome, "EXISTING_LINK_CONFLICT");
  assert.equal(result.storedTarget, "product_competitor-1");
  assert.equal(result.proposedTarget, CANONICAL);
  assert.equal(db.tables.knowledge_file_events.length, 0, "lost race writes no audit");
  assert.equal(db.tables.knowledge_product_links[0].existing_product_id, "product_competitor-1", "never overwritten");
});

// R21-R25: ineligible outcomes never write.
test("R21 multiple links refuse repair", async () => {
  const db = makeDb({ links: [linkRow({ id: "knowledgeLink_1" }), linkRow({ id: "knowledgeLink_2" })] });
  const result = await repairKnowledgeProductLink(db, repairInput());
  assert.equal(result.ok, false);
  assert.equal(result.outcome, "MULTIPLE_EXISTING_LINKS");
  assert.equal(db.calls.linkUpdates, 0);
});

test("R22 ambiguous target refuses repair", async () => {
  const db = makeDb({ products: [
    productRow({ id: "product_h-1", manufacturer_name: "Honeywell" }),
    productRow({ id: "product_b-1", manufacturer_name: "Bosch" }),
  ] });
  const result = await repairKnowledgeProductLink(db, repairInput());
  assert.equal(result.ok, false);
  assert.equal(result.outcome, "AMBIGUOUS_TARGET");
  assert.equal(db.calls.linkUpdates, 0);
});

test("R23 broken canonical chain refuses repair", async () => {
  const db = makeDb({ products: [
    productRow({ id: "product_broken-1", identity_status: "Superseded", superseded_by_product_id: "product_missing-1" }),
  ] });
  const result = await repairKnowledgeProductLink(db, repairInput());
  assert.equal(result.ok, false);
  assert.equal(result.outcome, "BROKEN_CANONICAL_CHAIN");
  assert.equal(db.calls.linkUpdates, 0);
});

test("R24 search-key-only candidate refuses repair", async () => {
  const db = makeDb({
    products: [productRow({ id: DOT_VARIANT, part_number: "IDP-PHOTO-IV.", normalized_part_number: "IDP-PHOTO-IV.", identity_status: "Active", superseded_by_product_id: null })],
  });
  const result = await repairKnowledgeProductLink(db, repairInput());
  assert.equal(result.ok, false);
  assert.equal(result.outcome, "AMBIGUOUS_TARGET");
  assert.equal(db.calls.linkUpdates, 0);
});

test("R25 cross-organization canonical target refuses repair", async () => {
  const db = makeDb({ products: [
    productRow({ id: "product_org-b-1", library_scope: "Organization Library", organization_id: "org-other" }),
  ] });
  const result = await repairKnowledgeProductLink(db, repairInput());
  assert.equal(result.ok, false);
  assert.equal(result.outcome, "NO_TARGET");
  assert.equal(db.calls.linkUpdates, 0);
});

test("R26 repaired target is canonical Active, never the superseded row id", async () => {
  const db = makeDb();
  const result = await repairKnowledgeProductLink(db, repairInput());
  assert.equal(result.target, CANONICAL);
  assert.notEqual(result.target, DOT_VARIANT);
});

test("R27 adapter fabricates no commercial relationships; identity evidence only", async () => {
  const db = makeDb();
  const result = await repairKnowledgeProductLink(db, repairInput());
  assert.equal(result.ok, true);
  for (const entry of result.decision.candidatesConsidered) {
    assert.ok(!("relationshipType" in entry) || entry.relationshipType == null);
  }
});

// R28: audit failure never reports false success.
test("R28 audit failure is never reported as successful repair", async () => {
  const db = makeDb({});
  db.batch = (() => async () => { throw new Error("Simulated batch failure."); })();
  const result = await repairKnowledgeProductLink(db, repairInput());
  assert.equal(result.ok, false);
  assert.equal(result.outcome, "REPAIR_FAILED");
  assert.equal(result.auditWritten, false);
  assert.equal(db.tables.knowledge_product_links[0].existing_product_id, null);
});

test("R28b partial apply surfaces supportable claim and retry stays a no-op", async () => {
  const hooks = { failAuditAfterUpdate: true };
  const db = makeDb({ hooks });
  const result = await repairKnowledgeProductLink(db, repairInput());
  assert.equal(result.ok, true, "re-read row supports the repaired claim");
  assert.equal(result.outcome, "REPAIRED_UNLOGGED");
  assert.equal(result.auditWritten, false);
  hooks.failAuditAfterUpdate = false;
  const retry = await repairKnowledgeProductLink(db, repairInput());
  assert.equal(retry.outcome, "ALREADY_LINKED");
  assert.equal(retry.writes.linkWrites, 0);
  assert.equal(db.tables.knowledge_file_events.length, 0, "no audit fabricated on retry");
});

// R29-R30: no task artifacts; conflict is an engineer exception.
test("R29 successful repair touches only the link row and one audit row", async () => {
  const db = makeDb();
  await repairKnowledgeProductLink(db, repairInput());
  const writes = db.calls.statements.filter((sql) => /^\s*(UPDATE|INSERT|DELETE)/i.test(sql));
  assert.equal(writes.length, 2);
  assert.ok(writes[0].includes("UPDATE knowledge_product_links"));
  assert.ok(writes[1].includes("INSERT OR IGNORE INTO knowledge_file_events"));
  // SQL-shape: the audit INSERT predicates causality on SQLite changes() and
  // appears IMMEDIATELY after the guarded UPDATE inside the SAME single batch.
  // Statement order is a correctness requirement of the changes() guard.
  assert.ok(
    /\(SELECT changes\(\)\) = 1/.test(writes[1]),
    "audit INSERT predicates causality on SQLite changes()",
  );
  assert.equal(db.calls.batches.length, 1, "repair executes exactly one batch");
  assert.equal(db.calls.batches[0].length, 2, "batch is exactly [guarded UPDATE, audit INSERT]");
  assert.ok(db.calls.batches[0][0].includes("UPDATE knowledge_product_links"), "UPDATE is batch[0]");
  assert.ok(db.calls.batches[0][1].includes("INSERT OR IGNORE INTO knowledge_file_events"), "audit INSERT is batch[1], immediately after UPDATE");
  // No engineer-review / technical-matching task artifact is ever created.
  assert.ok(
    !writes.some((sql) => /INSERT/i.test(sql) && !sql.includes("knowledge_file_events")),
    "the only INSERT is the identity audit event — no review task, no second link",
  );
});

test("R30 stored different target is an engineer exception with both evidence bundles", async () => {
  const db = makeDb({ links: [linkRow({ existing_product_id: "product_other-1", link_state: "Existing Product — Additive Learning Only" })] });
  const result = await repairKnowledgeProductLink(db, repairInput());
  assert.equal(result.ok, false);
  assert.equal(result.outcome, "EXISTING_LINK_CONFLICT");
  assert.equal(db.calls.linkUpdates, 0);
});

// Engineering safety regression (plan section 12).
test("SAFETY identity repair contains no affirmative technical claims", async () => {
  const db = makeDb();
  await repairKnowledgeProductLink(db, repairInput());
  const link = db.tables.knowledge_product_links[0];
  const audit = auditOf(db);
  const serialized = JSON.stringify([JSON.parse(link.new_information), JSON.parse(audit.details)]);
  assert.match(serialized, /"identityDecisionOnly":true/);
  assert.match(serialized, /"technicalSuitabilityEvaluated":false/);
  assert.match(serialized, /"technicalEvaluation":"NOT_PERFORMED"/);
  assert.doesNotMatch(serialized, /\bFACP\b/i);
  assert.doesNotMatch(serialized, /\bSLC\b/i);
  assert.doesNotMatch(serialized, /\bcompatible\b/i);
  assert.doesNotMatch(serialized, /\bcompliant\b/i);
  assert.doesNotMatch(serialized, /\bcertified\b/i);
  assert.doesNotMatch(serialized, /\bsuitable\b/i);
  assert.doesNotMatch(serialized, /technically approved/i);
  assert.doesNotMatch(serialized, /approved for costing/i);
  assert.doesNotMatch(serialized, /"approved":true/i);
});
