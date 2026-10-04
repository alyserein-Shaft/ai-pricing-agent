// Product conflict WRITE path -- governance tests.
//
// The point of this file is the boundary it locks down: RECORDING an unresolved
// condition is allowed to an analysis-capability operator and asserts nothing
// about who is right; RESOLVING is human-governed and is not reachable here.
// A conflict is a LABEL. It must never gate matching, and it must never mutate
// canonical product identity.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCT_CONFLICT_TYPES,
  PRODUCT_CONFLICT_ERRORS,
  PRODUCT_CONFLICT_AUTHORITY_VERSION,
  assessProductConflictReport,
  recordProductConflict,
  productConflictIdempotencyKey,
} from "../app/domain/product-conflict-authority.mjs";
import { evaluateProductLifecycle } from "../app/domain/product-lifecycle-authority.mjs";

const REGIME = "Identity Collision — Brand / Standards Regime Conflict";

const validReport = (over = {}) => ({
  productId: "product_0c2a497f-11df-4c53-a870-544969f9dd5c",
  conflictType: REGIME,
  subject: "Brand and standards regime",
  description:
    "First-party documentation identifies this product as System Sensor Europe / NOTIFIER / Morley-IAS, a conventional zone device, CPR-approved to EN 54-12:2015, while the catalogue files it under Farenhyt.",
  reason: "Manufacturer documentation contradicts the canonical brand and standards regime assignment.",
  evidence: [{ url: "https://buildings.honeywell.com/", document: "product page", page: "lifecycle" }],
  actor: "internet-research-agent",
  ...over,
});

const stubDb = ({ product = null, existing = null } = {}) => {
  const calls = { prepare: [], run: [] };
  const resolved = product ?? { id: validReport().productId, part_number: "6500RSE" };
  return {
    calls,
    prepare(sql) {
      calls.prepare.push(sql);
      if (/FROM library_products/.test(sql)) {
        return { bind: (...b) => ({ first: async () => (b[0] === resolved.id ? resolved : null) }) };
      }
      if (/FROM product_conflicts/.test(sql)) {
        return { bind: () => ({ first: async () => existing }) };
      }
      if (/INSERT INTO product_conflicts/.test(sql)) {
        return { bind: (...b) => ({ run: async () => { calls.run.push(b); return { success: true }; } }) };
      }
      return { bind: () => ({ first: async () => null, run: async () => ({ success: true }) }) };
    },
  };
};

test("1 -- the governed vocabulary reuses the identity-conflict types", () => {
  assert.ok(PRODUCT_CONFLICT_TYPES.includes(REGIME));
  assert.ok(PRODUCT_CONFLICT_TYPES.includes("Identity Collision — Description Difference"));
  assert.equal(PRODUCT_CONFLICT_AUTHORITY_VERSION, "product-conflict-authority-1.0.0");
});

test("2 -- an authorized, evidence-backed report is accepted and is always Open", () => {
  const assessed = assessProductConflictReport(validReport());
  assert.equal(assessed.ok, true);
  assert.equal(assessed.value.status, "Open", "recording can only ever create an Open conflict");
  assert.equal(assessed.value.discovery, "SYSTEM_RESEARCH_DISCOVERY");
  assert.equal(assessed.value.reportedBy, "internet-research-agent",
    "the real actor is preserved verbatim and is not a human approval");
  assert.ok(assessed.value.idempotencyKey);
});

test("3 -- an unsupported / free-form conflict type is refused", () => {
  const assessed = assessProductConflictReport(validReport({ conflictType: "Price Source Conflict" }));
  assert.equal(assessed.ok, false);
  assert.equal(assessed.code, PRODUCT_CONFLICT_ERRORS.TYPE_UNSUPPORTED);
});

test("4 -- a missing conflict type is refused", () => {
  const assessed = assessProductConflictReport(validReport({ conflictType: "" }));
  assert.equal(assessed.ok, false);
  assert.equal(assessed.code, PRODUCT_CONFLICT_ERRORS.TYPE_REQUIRED);
});

test("5 -- a conflict cannot be created from an unsupported assertion", () => {
  for (const over of [{ description: "looks wrong" }, { description: "" }, { reason: "no" }]) {
    const assessed = assessProductConflictReport(validReport(over));
    assert.equal(assessed.ok, false, `must refuse ${JSON.stringify(over)}`);
  }
});

test("6 -- a missing actor is refused", () => {
  const assessed = assessProductConflictReport(validReport({ actor: "" }));
  assert.equal(assessed.ok, false);
  assert.equal(assessed.code, PRODUCT_CONFLICT_ERRORS.ACTOR_REQUIRED);
});

test("7 -- an out-of-scope product is refused by the scope predicate", () => {
  const assessed = assessProductConflictReport(
    validReport({ knownConflictType: () => false, organizationId: "org-a" }),
  );
  assert.equal(assessed.ok, false);
  assert.equal(assessed.code, PRODUCT_CONFLICT_ERRORS.PRODUCT_OUT_OF_SCOPE);
});

test("8 -- an unknown product is rejected at the store, before any write", async () => {
  const db = stubDb({ product: { id: "someone-else", part_number: "X" } });
  const result = await recordProductConflict(db, validReport());
  assert.equal(result.ok, false);
  assert.equal(result.code, PRODUCT_CONFLICT_ERRORS.PRODUCT_UNKNOWN);
  assert.equal(db.calls.run.length, 0, "no INSERT may be attempted for an unknown product");
});

test("9 -- creating a conflict writes ONLY product_conflicts, never library_products", async () => {
  const db = stubDb();
  const result = await recordProductConflict(db, validReport());
  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  const mutations = db.calls.prepare.filter((s) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(s));
  assert.equal(mutations.length, 1, `expected exactly one mutation, got ${mutations.length}`);
  assert.match(mutations[0], /^\s*INSERT INTO product_conflicts\b/i);
  // No mutation may name a canonical product table.
  assert.ok(!mutations.some((s) => /library_products|product_attributes|product_compatibility|product_accessories|product_lifecycle_events/i.test(s)),
    "a conflict write must never mutate canonical product, attribute, relationship or lifecycle state");
});

test("10 -- idempotent replay returns the existing row and creates nothing", async () => {
  const existing = { id: "conflict_existing", status: "Open", conflict_type: REGIME };
  const db = stubDb({ existing });
  const result = await recordProductConflict(db, validReport());
  assert.equal(result.ok, true);
  assert.equal(result.created, false);
  assert.equal(result.idempotent, true);
  assert.equal(result.conflict.id, "conflict_existing");
  assert.equal(db.calls.run.length, 0, "a replay must not insert a duplicate Open row");
});

test("11 -- the idempotency key is stable across casing and whitespace", () => {
  const a = productConflictIdempotencyKey({ productId: "P1", conflictType: REGIME, subject: "Brand  Regime" });
  const b = productConflictIdempotencyKey({ productId: "p1", conflictType: REGIME, subject: "brand regime" });
  assert.equal(a, b);
  // Genuinely different conflict types must NOT collapse together.
  const c = productConflictIdempotencyKey({ productId: "p1", conflictType: "Possible Duplicate Identity", subject: "brand regime" });
  assert.notEqual(a, c);
});

test("12 -- READ AFTER WRITE: the conflict is visible to the read model", async () => {
  // Proves the existing reader consumes what this writer produces: an Open row
  // of the governed type must surface as identityConflictOpen.
  const db = stubDb();
  const written = await recordProductConflict(db, validReport());
  const conflict = {
    conflictType: written.conflict.conflict_type,
    status: written.conflict.status,
  };
  const evaluation = evaluateProductLifecycle({
    id: "product_0c2a497f-11df-4c53-a870-544969f9dd5c",
    lifecycleStatus: "Unknown — Review Required",
    openConflicts: [conflict],
  });
  assert.equal(evaluation.selectionPosture, "IDENTITY_CONFLICT_BLOCKED");
});

test("13 -- LABEL, DO NOT GATE: a recorded conflict never blocks matching", async () => {
  const evaluation = evaluateProductLifecycle({
    id: "product_0c2a497f-11df-4c53-a870-544969f9dd5c",
    lifecycleStatus: "CURRENT",
    openConflicts: [{ conflictType: REGIME, status: "Open" }],
  });
  assert.equal(evaluation.selectionPosture, "IDENTITY_CONFLICT_BLOCKED");
  assert.equal(evaluation.blocking, false, "a conflict is a label, not an eligibility gate");
  assert.equal(evaluation.pass, true);
  assert.equal(evaluation.excludesTechnicalCompatibility, true);
});

test("14 -- recording never resolves: a Resolved row is not treated as open", () => {
  const assessment = evaluateProductLifecycle({
    lifecycleStatus: "CURRENT",
    openConflicts: [{ conflictType: REGIME, status: "Resolved" }],
  });
  assert.equal(assessment.selectionPosture, "CURRENT_PREFERRED",
    "a resolved conflict must not keep the product labelled");
});
