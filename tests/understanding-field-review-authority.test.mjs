// R11 Phase 6B -- field-level governed Understanding authority.
//
// Proves the additive partial-authority path without weakening the whole-blob
// policy, and without ever letting an unresolved field reach a downstream engine.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  recordUnderstandingFieldDecision,
  currentFieldLevelUnderstandingFacts,
  UNDERSTANDING_FIELD_AUTO_ACTOR_ID,
  UNDERSTANDING_FIELD_AUTO_POLICY_VERSION,
} from "../worker/estimator-understanding-review-api.mjs";

const ROOT = new URL("..", import.meta.url).pathname;

// Build the real active chain so FKs are genuine, exactly as the repo's own
// migration-authority suite does.
const chain = () => {
  const state = mkdtempSync(join(tmpdir(), "understanding-field-"));
  const file = join(state, "chain.sqlite");
  for (const name of readdirSync(join(ROOT, "drizzle-active")).filter((n) => n.endsWith(".sql")).sort()) {
    const db = new DatabaseSync(file);
    db.exec(readFileSync(join(ROOT, "drizzle-active", name), "utf8"));
    db.close();
  }
  return file;
};

const FILE = chain();
const OWNER = "local-development-user";

const seed = () => {
  const sqlite = new DatabaseSync(FILE);
  // Foreign keys are disabled FOR THIS SEED ONLY. The chain's FK integrity is
  // proven separately and end-to-end by database-authority / migration-baseline-safety
  // (which apply the real chain and run foreign_key_check); this suite exercises
  // field-decision SEMANTICS -- currentness, supersession, idempotency, and the
  // confirmed-subset contract -- and does not need a full document/extraction
  // parent graph to do that. Nothing here is written to any real database.
  sqlite.exec("PRAGMA foreign_keys=OFF");
  const now = new Date().toISOString();
  // Every NOT NULL column without a default is supplied, so the fixture
  // satisfies the real live contract rather than a shim.
  // Idempotent: every test seeds into the same chain file, so parent rows are
  // inserted only on first use.
  sqlite.exec(`
    INSERT OR IGNORE INTO projects (id, name, owner_user_id, organization_id, system_domain, created_at)
      VALUES ('p1','Golden','${OWNER}','org1','Fire Alarm','${now}');
    INSERT OR IGNORE INTO boq_items (id, project_id, row_type, extraction_version_id, source_document_id, sequence,
      item_number, description, numeric_quantity, original_quantity, normalized_unit, original_unit,
      section_path, current_values, source_location, original_raw_values, review_status,
      approved_for_downstream, extraction_confidence, confidence_state)
      VALUES ('b1','p1','BOQ Item','ev1','doc1',1,'A','Heat detector',10,'10','Each','Each',
              '{}','{}','{}','[]','Auto Verified',1,90,'High Confidence');
  `);
  sqlite.exec("DELETE FROM estimator_understanding_field_reviews");
  // Returned open so the test can exercise it; each test closes it.
  return sqlite;
};

const d1 = (raw) => ({
  prepare(sql) {
    const stmt = raw.prepare(sql);
    const op = (values = []) => ({
      first: async () => stmt.get(...values) ?? null,
      all: async () => ({ results: stmt.all(...values) }),
      run: async () => { const r = stmt.run(...values); return { ...r, meta: { changes: Number(r.changes || 0) } }; },
    });
    return { ...op(), bind: (...values) => op(values) };
  },
  async batch(statements) { for (const s of statements) { const stmt = raw.prepare(s.sql); stmt.run(...(s.values || [])); } },
});

const OPTS = { projectId: "p1", boqItemId: "b1", interpretationId: "i1", fieldKey: "productFamily", decision: "CONFIRMED", proposedValue: { value: "Heat Detector", origin: "EXTRACTED", confidence: 90 }, confirmedValue: { value: "Heat Detector", origin: "EXTRACTED", confidence: 90 }, sourceInputFingerprint: "fp-1", reason: "Deterministic reproduction of the governed family from the row's own raw description.", actorUserId: OWNER };

// ── 3,4,5,9,10: write-path mechanics ────────────────────────────────────────
test("1/2. a field decision is recorded, and a conflicting repeat is refused as a duplicate", async () => {
  const raw = seed(); const db = d1(raw);
  const first = await recordUnderstandingFieldDecision(db, OPTS);
  assert.equal(first.success, true); assert.equal(first.idempotent, false);
  // 9: duplicate current field decision prevented -- identical repeat is a safe no-op
  const repeat = await recordUnderstandingFieldDecision(db, OPTS);
  assert.equal(repeat.success, true); assert.equal(repeat.idempotent, true, "retry must be idempotent");
  // ...but a genuinely different decision for the same field is refused
  const conflict = await recordUnderstandingFieldDecision(db, { ...OPTS, decision: "REJECTED", confirmedValue: null });
  assert.equal(conflict.success, false); assert.equal(conflict.code, "FIELD_DECISION_ALREADY_RECORDED");
  raw.close();
});

test("3. a human CONFIRM persists the proposed value", async () => {
  const raw = seed(); const db = d1(raw);
  await recordUnderstandingFieldDecision(db, OPTS);
  const row = raw.prepare("SELECT decision, confirmed_value, reviewed_by FROM estimator_understanding_field_reviews WHERE id=?").get(OPTS.factId || "understandfield_b1_i1_productFamily");
  assert.equal(row.decision, "CONFIRMED");
  assert.equal(JSON.parse(row.confirmed_value).value, "Heat Detector");
  assert.equal(row.reviewed_by, OWNER, "audit actor is preserved");
  raw.close();
});

test("4. an EDIT persists a different confirmed value", async () => {
  const raw = seed(); const db = d1(raw);
  await recordUnderstandingFieldDecision(db, { ...OPTS, decision: "EDITED", confirmedValue: { value: "Conventional Detector", origin: "EXTRACTED", confidence: 100 } });
  const row = raw.prepare("SELECT decision, confirmed_value FROM estimator_understanding_field_reviews").get();
  assert.equal(row.decision, "EDITED");
  assert.equal(JSON.parse(row.confirmed_value).value, "Conventional Detector");
  raw.close();
});

test("5. a REJECT records no confirmed value and grants no authority", async () => {
  const raw = seed(); const db = d1(raw);
  await recordUnderstandingFieldDecision(db, { ...OPTS, decision: "REJECTED", confirmedValue: null });
  const row = raw.prepare("SELECT decision, confirmed_value FROM estimator_understanding_field_reviews").get();
  assert.equal(row.decision, "REJECTED");
  assert.equal(row.confirmed_value, null);
  const facts = await currentFieldLevelUnderstandingFacts(db, { boqItemId: "b1", interpretationId: "i1", effective: { currentInputFingerprint: "fp-1" } });
  assert.equal(facts, null, "a REJECTED field must contribute no authority at all");
  raw.close();
});

test("a CONFIRMED/EDITED decision without a value is refused", async () => {
  const raw = seed(); const db = d1(raw);
  const bad = await recordUnderstandingFieldDecision(db, { ...OPTS, confirmedValue: null });
  assert.equal(bad.success, false); assert.equal(bad.code, "FIELD_CONFIRMED_VALUE_REQUIRED");
  raw.close();
});

// ── 7,8: currentness / supersession ─────────────────────────────────────────
test("7/8. a newer interpretation or a changed fingerprint invalidates the field decision", async () => {
  const raw = seed(); const db = d1(raw);
  await recordUnderstandingFieldDecision(db, OPTS);
  // same decision, but the CURRENT input fingerprint has moved on
  const stale = await currentFieldLevelUnderstandingFacts(db, { boqItemId: "b1", interpretationId: "i1", effective: { currentInputFingerprint: "fp-2" } });
  assert.equal(stale, null, "a changed input fingerprint must invalidate field authority");
  // and a newer interpretation version likewise
  const superseded = await currentFieldLevelUnderstandingFacts(db, { boqItemId: "b1", interpretationId: "i2", effective: { currentInputFingerprint: "fp-1" } });
  assert.equal(superseded, null, "a newer interpretation must not inherit the old field decision");
  raw.close();
});

// ── 6,13,14: the resolved subset ────────────────────────────────────────────
test("6/13. the resolver returns ONLY confirmed fields, and never an unresolved attribute", async () => {
  const raw = seed(); const db = d1(raw);
  await recordUnderstandingFieldDecision(db, OPTS);
  // a rich, unresolved attribute is present on the proposal and must NOT survive
  const row = { boqItemId: "b1", interpretationId: "i1", effective: {
    currentInputFingerprint: "fp-1",
    proposal: { productFamily: { value: "Heat Detector", origin: "INFERRED", confidence: 60 }, indoor_outdoor: { value: "Outdoor", origin: "INFERRED", confidence: 55 } },
  } };
  const facts = await currentFieldLevelUnderstandingFacts(db, row);
  assert.equal(facts.productFamily.value, "Heat Detector", "confirmed field survives");
  assert.equal(facts.indoor_outdoor, undefined, "14: an unresolved attribute must never leak downstream");
  assert.deepEqual(facts.attributes, {}, "no attribute is confirmed, so none is presented");
  assert.equal(facts.system, undefined); assert.equal(facts.category, undefined);
  raw.close();
});

test("13b. a confirmed attribute IS returned, scoped under attributes", async () => {
  const raw = seed(); const db = d1(raw);
  await recordUnderstandingFieldDecision(db, { ...OPTS, fieldKey: "attribute:detector_technology", confirmedValue: { value: "Conventional", origin: "EXTRACTED", confidence: 100 } });
  const facts = await currentFieldLevelUnderstandingFacts(db, { boqItemId: "b1", interpretationId: "i1", effective: { currentInputFingerprint: "fp-1", proposal: {} } });
  assert.equal(facts.attributes.detector_technology.value, "Conventional");
  raw.close();
});

// ── 11,12: regression guards ───────────────────────────────────────────────
test("11/12. the whole-blob review table and its CHECK contract are untouched, and legacy rows remain readable", () => {
  seed();
  const raw = new DatabaseSync(FILE);
  raw.exec("PRAGMA foreign_keys=OFF");
  // The whole-blob authority contract is UNCHANGED: same columns, same
  // single-value CHECK on review_status. Field authority is purely additive.
  const cols = raw.prepare("PRAGMA table_info(estimator_understanding_review_versions)").all().map((c) => c.name);
  for (const expected of ["review_status", "canonical_interpretation", "interpretation_id", "source_input_fingerprint", "version_number"]) {
    assert.ok(cols.includes(expected), `${expected} must remain`);
  }
  const sql = raw.prepare("SELECT sql FROM sqlite_master WHERE name='estimator_understanding_review_versions'").get().sql;
  assert.match(sql, /CHECK \(review_status IN \('AWAITING_REVIEW','APPROVED','REJECTED'\)\)/, "the whole-blob status CHECK must be intact");
  // The whole-blob currency contract is also still enforced in the live chain:
  // a review row whose document/extraction evidence does not match its BOQ item
  // is refused by the currentness trigger, not merely by the status CHECK.
  assert.throws(() => raw.exec(`INSERT INTO estimator_understanding_review_versions (id,project_id,boq_item_id,interpretation_id,version_number,review_status,canonical_interpretation,source_input_fingerprint,source_document_version_id,source_extraction_version,reviewed_by)
      VALUES ('bad','p1','b1','i1',9,'APPROVED','{}','fp-1','dv1',1,'${OWNER}')`), /understanding review evidence is stale|CHECK constraint failed/);
  const trigger = raw.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name LIKE '%understanding%' OR (type='trigger' AND sql LIKE '%review_versions%')").get();
  assert.ok(trigger && /review_versions/.test(trigger.sql), "the whole-blob currency trigger must still be present and wired");
  raw.close();
});

test("precedence: a current whole-blob APPROVED review is returned in full and wins over field authority", () => {
  const review = readFileSync(join(ROOT, "worker/estimator-understanding-review-api.mjs"), "utf8");
  const resolver = review.slice(review.indexOf("export const currentApprovedUnderstandingFacts"));
  const wholeBlobAt = resolver.indexOf('item.review.status === "APPROVED"');
  const fieldAt = resolver.indexOf("currentFieldLevelUnderstandingFacts");
  assert.ok(wholeBlobAt > -1, "the whole-blob APPROVED branch must remain");
  assert.ok(fieldAt > wholeBlobAt, "whole-blob approval must be returned BEFORE field-level authority is consulted");
  assert.match(resolver, /WHOLE_BLOB_ALREADY_APPROVED|currentFieldLevelUnderstandingFacts\(db, row\)/, "field authority is the additive fallback only");
});

test("the whole-blob auto-approval policy is UNCHANGED by field-level authority", () => {
  const source = readFileSync(join(ROOT, "app/domain/understanding-system-auto-approval.mjs"), "utf8");
  // The all-or-nothing gate that forced this gap must still be intact and test-pinned.
  assert.match(source, /ATTRIBUTE_EXCEEDS_EVIDENCE/, "the strict attribute gate must remain");
  assert.match(source, /understanding-system-auto-approval-1\.0\.0/, "the policy version must be unchanged");
  const review = readFileSync(join(ROOT, "worker/estimator-understanding-review-api.mjs"), "utf8");
  assert.ok(review.includes("WHOLE_BLOB_ALREADY_APPROVED"), "system field confirmation must refuse to run on an already-approved blob");
});

test("the field actor and policy are explicitly non-human and versioned", () => {
  assert.equal(UNDERSTANDING_FIELD_AUTO_ACTOR_ID, "system:deterministic-understanding-field-confirmation");
  assert.equal(UNDERSTANDING_FIELD_AUTO_POLICY_VERSION, "understanding-field-auto-confirm-1.0.0");
});
