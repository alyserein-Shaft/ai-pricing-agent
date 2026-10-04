// KN-SA-CT-1 — Product Source Type governed review contract.
//
// Mirrors the established governance suite pattern (real SQLite, never a mock)
// so the SQL bindings, gate logic, and audit writes are exercised against the
// same statements production runs.
//
// The contract under test:
//   * product_sources.source_type may be corrected ONLY through the governed
//     writer reviewedProductSourceType — direct SQL or arbitrary field edits are
//     refused fail-closed.
//   * Every correction writes a product_library_decisions row with
//     entity_type='Product Source', so source debt is exception-driven.
//   * Fail-closed everywhere: unknown source, rejected source, invented source
//     type, synthetic actor, unauthorized role, missing reason, concurrent
//     modification — all refuse. Idempotent when current type already matches.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import {
  assessProductSourceTypeReview,
  reviewProductSourceType,
} from "../worker/product-source-type-review.mjs";
import { FIRST_PARTY_MANUFACTURER_SOURCE_TYPES } from "../worker/product-attribute-review.mjs";
import { MIN_GOVERNED_REASON_LENGTH } from "../worker/reason-governance.mjs";
import { HUMAN_ACTOR_SOURCE } from "../worker/human-actor.mjs";

// ---- In-memory SQLite schema (matches the production D1 contract) ----
// Copy of the real product_sources schema from D1, with the same column names
// and defaults, so the writer's SQL queries succeed.
const schema = `
  CREATE TABLE IF NOT EXISTS "product_sources" (
    "id" text PRIMARY KEY NOT NULL,
    "project_id" text,
    "document_id" text,
    "document_version_id" text,
    "checksum" text NOT NULL,
    "source_type" text NOT NULL,
    "authority" text NOT NULL,
    "scope_type" text NOT NULL,
    "file_name" text NOT NULL,
    "release_version" text,
    "effective_from" text,
    "valid_until" text,
    "currency" text,
    "validity_state" text NOT NULL,
    "review_status" DEFAULT 'Needs Review' NOT NULL,
    "downstream_use" DEFAULT 'Discovery Only' NOT NULL,
    "metadata" DEFAULT '{}' NOT NULL,
    "created_by" text NOT NULL,
    "created_at" DEFAULT CURRENT_TIMESTAMP NOT NULL
  );

  CREATE TABLE IF NOT EXISTS "product_library_decisions" (
    "id" text PRIMARY KEY NOT NULL,
    "project_id" text,
    "entity_type" text NOT NULL,
    "entity_id" text NOT NULL,
    "action" text NOT NULL,
    "previous_value" text NOT NULL,
    "new_value" text NOT NULL,
    "reason" text NOT NULL,
    "decided_by" text NOT NULL,
    "decided_role" text NOT NULL,
    "created_at" text NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`;

// ---- Test DB adapter: real SQLite in-memory ----
const raw = new DatabaseSync(":memory:");
raw.exec(schema);

const d1 = (raw) => ({
  prepare(sql) {
    const stmt = raw.prepare(sql);
    return {
      first: () => stmt.get() ?? null,
      all: () => ({ results: stmt.all() }),
      run: () => stmt.run(),
      bind: (...values) => {
        const boundStmt = raw.prepare(sql);
        return {
          first: () => boundStmt.get(...values) ?? null,
          all: () => ({ results: boundStmt.all(...values) }),
          run: () => boundStmt.run(...values),
        };
      },
    };
  },
});

// ---- Test state ----
let testSourceId = null;

const createTestSource = (id, sourceType) => {
  raw.exec(
    `INSERT INTO product_sources
       (id, checksum, source_type, authority, scope_type, file_name, validity_state, review_status, downstream_use, metadata, created_by)
    VALUES ('${id}', 'sha256-test-abc', '${sourceType}', 'Official Manufacturer', 'Project', 'test.pdf', 'Current', 'Needs Review', 'Discovery Only', '{}', 'local-development-user')`
  );
  testSourceId = id;
};

const deleteTestSource = () => {
  raw.exec(`DELETE FROM product_library_decisions WHERE entity_id='${testSourceId}'`);
  raw.exec(`DELETE FROM product_sources WHERE id='${testSourceId}'`);
};

// ---- TESTS ----

// --- assessProductSourceTypeReview gates ---

test("assess: valid target source type passes", () => {
  createTestSource("psrc-1", "Cost Sheet");
  const result = assessProductSourceTypeReview({
    sourceId: testSourceId,
    targetSourceType: "Product Datasheet",
    reason: "correct classification",
    humanActor: { id: "human-1", source: HUMAN_ACTOR_SOURCE, synthetic: false },
  });
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.status, "ASSESSED");
});

test("assess: unknown source type rejected — BOQ not in allowlist", () => {
  createTestSource("psrc-2", "Cost Sheet");
  const result = assessProductSourceTypeReview({
    sourceId: testSourceId,
    targetSourceType: "BOQ",
    reason: "correct classification",
    humanActor: { id: "human-1", source: HUMAN_ACTOR_SOURCE, synthetic: false },
  });
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.status, "SOURCE_TYPE_NOT_ALLOWED");
  assert.strictEqual(Array.from(result.allowedTypes).includes("BOQ"), false);
});

test("assess: reason too short rejected", () => {
  createTestSource("psrc-3", "Cost Sheet");
  const result = assessProductSourceTypeReview({
    sourceId: testSourceId,
    targetSourceType: "Product Datasheet",
    reason: "fix",
    humanActor: { id: "human-1", source: HUMAN_ACTOR_SOURCE, synthetic: false },
  });
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.status, "REASON_REQUIRED");
  assert.strictEqual(result.minimumReasonLength, MIN_GOVERNED_REASON_LENGTH);
});

test("assess: reason at minimum length passes", () => {
  createTestSource("psrc-4", "Cost Sheet");
  const result = assessProductSourceTypeReview({
    sourceId: testSourceId,
    targetSourceType: "Product Datasheet",
    reason: "fix it",
    humanActor: { id: "human-1", source: HUMAN_ACTOR_SOURCE, synthetic: false },
  });
  assert.strictEqual(result.allowed, true);
});

test("assess: synthetic actor rejected", () => {
  createTestSource("psrc-5", "Cost Sheet");
  const result = assessProductSourceTypeReview({
    sourceId: testSourceId,
    targetSourceType: "Product Datasheet",
    reason: "correct classification",
    humanActor: { id: "local-development-user", source: "request", synthetic: true },
  });
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.status, "HUMAN_ACTOR_REQUIRED");
});

test("assess: null reason rejected", () => {
  createTestSource("psrc-6", "Cost Sheet");
  const result = assessProductSourceTypeReview({
    sourceId: testSourceId,
    targetSourceType: "Product Datasheet",
    reason: null,
    humanActor: { id: "human-1", source: HUMAN_ACTOR_SOURCE, synthetic: false },
  });
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.status, "REASON_REQUIRED");
});

test("assess: undefined reason rejected", () => {
  createTestSource("psrc-7", "Cost Sheet");
  const result = assessProductSourceTypeReview({
    sourceId: testSourceId,
    targetSourceType: "Product Datasheet",
    reason: undefined,
    humanActor: { id: "human-1", source: HUMAN_ACTOR_SOURCE, synthetic: false },
  });
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.status, "REASON_REQUIRED");
});

// --- reviewProductSourceType gates ---

test("review: valid human correction — Cost Sheet → Product Datasheet", () => {
  createTestSource("psrc-8", "Cost Sheet");
  const result = reviewProductSourceType({
    db: d1(raw),
    sourceId: testSourceId,
    targetSourceType: "Product Datasheet",
    reason: "Q9 source reclassification: DNR/DNRW datasheet is manufacturer document not cost sheet",
    humanActor: { id: "human-1", name: "Human Operator", source: HUMAN_ACTOR_SOURCE, synthetic: false },
  });
  assert.strictEqual(result.status, "CORRECTED");
  assert.strictEqual(result.previousSourceType, "Cost Sheet");
  assert.strictEqual(result.newSourceType, "Product Datasheet");
  assert.ok(result.auditId);

  // Verify DB was updated
  const row = d1(raw).prepare(
    `SELECT source_type FROM product_sources WHERE id='${testSourceId}'`
  ).first();
  assert.strictEqual(row.source_type, "Product Datasheet");
});

test("review: idempotent when current type already matches", () => {
  createTestSource("psrc-9", "Product Datasheet"); // already correct type

  const result = reviewProductSourceType({
    db: d1(raw),
    sourceId: testSourceId,
    targetSourceType: "Product Datasheet",
    reason: "should be idempotent",
    humanActor: { id: "human-1", name: "Human Operator", source: HUMAN_ACTOR_SOURCE, synthetic: false },
  });
  assert.strictEqual(result.status, "IDEMPOTENT_REPLAY");
  assert.strictEqual(result.idempotent, true);
  assert.strictEqual(result.previousSourceType, "Product Datasheet");

  // No audit row should be created for idempotent replay
  const auditCount = d1(raw).prepare(
    `SELECT count(*) as c FROM product_library_decisions WHERE entity_id='${testSourceId}' AND action='Reclassify'`
  ).first();
  assert.strictEqual(auditCount.c, 0);
});

test("review: concurrent modification fails safely", () => {
  createTestSource("psrc-10", "Installation and Operation Manual");

  // First correction succeeds
  reviewProductSourceType({
    db: d1(raw),
    sourceId: testSourceId,
    targetSourceType: "Product Datasheet",
    reason: "first correction",
    humanActor: { id: "human-1", name: "Human Operator", source: HUMAN_ACTOR_SOURCE, synthetic: false },
  });

  // Second correction with stale source_type should fail
  const result = reviewProductSourceType({
    db: d1(raw),
    sourceId: testSourceId,
    targetSourceType: "Product Datasheet",
    reason: "second correction — stale",
    humanActor: { id: "human-1", name: "Human Operator", source: HUMAN_ACTOR_SOURCE, synthetic: false },
  });
  assert.strictEqual(result.status, "CONCURRENT_MODIFICATION");
  assert.strictEqual(result.previousSourceType, "Installation and Operation Manual");
});

test("review: unknown source rejected", () => {
  const result = reviewProductSourceType({
    db: d1(raw),
    sourceId: "nonexistent-psrc",
    targetSourceType: "Product Datasheet",
    reason: "correct classification",
    humanActor: { id: "human-1", name: "Human Operator", source: HUMAN_ACTOR_SOURCE, synthetic: false },
  });
  assert.strictEqual(result.status, "SOURCE_NOT_FOUND");
});

test("review: source rejected — review_status is Rejected", () => {
  createTestSource("psrc-11", "Cost Sheet");
  raw.exec(`UPDATE product_sources SET review_status='Rejected' WHERE id='${testSourceId}'`);

  const result = reviewProductSourceType({
    db: d1(raw),
    sourceId: testSourceId,
    targetSourceType: "Product Datasheet",
    reason: "correct classification",
    humanActor: { id: "human-1", name: "Human Operator", source: HUMAN_ACTOR_SOURCE, synthetic: false },
  });
  assert.strictEqual(result.status, "SOURCE_REJECTED");
});

test("review: reason required when missing", () => {
  createTestSource("psrc-12", "Cost Sheet");
  const result = reviewProductSourceType({
    db: d1(raw),
    sourceId: testSourceId,
    targetSourceType: "Product Datasheet",
    reason: "",
    humanActor: { id: "human-1", name: "Human Operator", source: HUMAN_ACTOR_SOURCE, synthetic: false },
  });
  assert.strictEqual(result.status, "REASON_REQUIRED");
});

test("review: full correction flow with audit trail", () => {
  createTestSource("psrc-13", "Cost Sheet");
  // Clean any prior audit rows
  raw.exec(`DELETE FROM product_library_decisions WHERE entity_id='${testSourceId}'`);

  const result = reviewProductSourceType({
    db: d1(raw),
    sourceId: testSourceId,
    targetSourceType: "Product Datasheet",
    reason: "Q9 source reclassification: DNR/DNRW datasheet is manufacturer document not cost sheet",
    humanActor: { id: "human-1", name: "Human Operator", source: HUMAN_ACTOR_SOURCE, synthetic: false },
  });

  // Correction succeeds
  assert.strictEqual(result.status, "CORRECTED");
  assert.strictEqual(result.previousSourceType, "Cost Sheet");
  assert.strictEqual(result.newSourceType, "Product Datasheet");
  assert.ok(result.auditId);

  // Audit row exists with correct data
  const auditRow = d1(raw).prepare(
    `SELECT * FROM product_library_decisions WHERE id='${result.auditId}'`
  ).first();
  assert.ok(auditRow);
  assert.strictEqual(auditRow.previous_value, "Cost Sheet");
  assert.strictEqual(auditRow.new_value, "Product Datasheet");
  assert.ok(auditRow.reason.includes("Q9 source reclassification"));
  assert.strictEqual(auditRow.decided_by, "human-1");
  assert.strictEqual(auditRow.decided_role, "Library Manager");

  // Source type updated in DB
  const sourceRow = d1(raw).prepare(
    `SELECT source_type FROM product_sources WHERE id='${testSourceId}'`
  ).first();
  assert.strictEqual(sourceRow.source_type, "Product Datasheet");
});

test("review: Installation and Operation Manual target type allowed", () => {
  createTestSource("psrc-14", "Cost Sheet");
  const result = reviewProductSourceType({
    db: d1(raw),
    sourceId: testSourceId,
    targetSourceType: "Installation and Operation Manual",
    reason: "source is installation manual not datasheet",
    humanActor: { id: "human-1", name: "Human Operator", source: HUMAN_ACTOR_SOURCE, synthetic: false },
  });
  // "Installation and Operation Manual" is in FIRST_PARTY_MANUFACTURER_SOURCE_TYPES
  assert.ok(result.status === "CORRECTED" || result.status === "ASSESSED");
});