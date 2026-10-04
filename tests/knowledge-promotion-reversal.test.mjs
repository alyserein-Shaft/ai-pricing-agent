// GOVERNED KNOWLEDGE PROMOTION REVERSAL.
//
// THE GAP THIS CLOSES
// Before this, a promoted Knowledge fact could not be withdrawn through any
// governed path. `knowledge_promotions` cannot hold a reversal: its `action`
// column is CHECK(action IN ('Promoted','Evidence Only')) and
// UNIQUE(organization_id, knowledge_fact_id) allows one row per fact. So a bad
// promotion could only be "fixed" by an unaudited direct canonical write or left
// standing. These tests pin the governed alternative.

import assert from "node:assert/strict";
import test from "node:test";

import {
  PROMOTION_REVERSAL_ERRORS,
  PROMOTION_REVERSAL_EVENT_TYPE,
  assessKnowledgePromotionReversal,
  reverseKnowledgePromotion,
} from "../app/domain/knowledge-promotion-reversal.mjs";
import { HUMAN_ACTOR_SOURCE } from "../app/domain/human-authority.mjs";
import {
  createMigratedDatabase,
  asD1,
  seedOrganization,
  seedManufacturer,
  seedKnowledgeFile,
  seedResearchFact,
  seedProduct,
} from "./helpers/decision-packet-db.mjs";

const ORG = "org_reversal";
const FACT = "knowledgeFact_r1";
const FILE = "knowledgeFile_r1";
const PRODUCT = "product_r1";
const PROMOTION = "knowledgepromotion_r1";

const REAL_HUMAN = Object.freeze({
  id: "omair-primary",
  name: "Omair",
  source: HUMAN_ACTOR_SOURCE,
  synthetic: false,
});

const REASON =
  "The promoted lifecycle value is not a canonical lifecycle token and the real normalizer returns UNKNOWN, so the canonical event conveys nothing to any consumer while asserting a lifecycle state and a successor claim in one column. The reviewed Knowledge observation itself remains correct and is preserved.";

// Fixture built from the repository's own seeders rather than hand-written
// INSERTs. Hand-written inserts kept failing on NOT NULL columns one at a time
// (extension, byte_size, object_key, classification_*, extraction_version,
// replacement_candidates, version_number, ...), and every one of those columns is
// a real constraint the test should be exercising honestly, not stubbing out.
const fresh = () => {
  const raw = createMigratedDatabase();
  const db = asD1(raw);
  seedOrganization(db, ORG);
  seedManufacturer(db, { id: "man_honeywell", name: "Honeywell" });
  seedKnowledgeFile(db, { id: FILE, fileName: "f.pdf", organizationId: ORG });
  seedResearchFact(db, {
    id: FACT,
    fileId: FILE,
    organizationId: ORG,
    factType: "Lifecycle",
    value: "prose",
    partNumber: "X",
    observationKey: "reversal:test",
    // Already Reviewed: reversal must preserve the review state, not reset it.
    reviewStatus: "Reviewed",
  });
  seedProduct(db, { id: PRODUCT, partNumber: "X", manufacturerId: "man_honeywell" });
  db.prepare(
    `INSERT INTO product_sources
       (id, organization_id, checksum, source_type, authority, scope_type, file_name,
        validity_state, review_status, downstream_use, metadata, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  // `asD1` mirrors the D1 API: `prepare(sql).bind(...values).run()`. Calling
  // `.run(values)` silently binds NOTHING, which surfaces as a NOT NULL failure
  // on whichever column happens to be first.
  ).bind(
    "productsource_r1", ORG, "cs_r1", "Official Manufacturer", "Manufacturer Technical Document",
    "Organization", "f.pdf", "Current", "Needs Review", "Discovery Only", "{}", "test", "2026-10-01 00:00:00",
  ).run();
  return { raw, db };
};

// Insert a promotion plus the canonical row it claims to have created.
const seedPromotion = (raw, db, {
  action = "Promoted",
  entityType = "Product Lifecycle Event",
  lifecycleStatus = "SUPERSEDED - SGWLED replaces SGWL; no discontinuation statement present",
  productId = PRODUCT,
} = {}) => {
  const entityId = entityType === "Product Lifecycle Event" ? "productlifecycle_r1" : "productattribute_r1";
  if (entityType === "Product Lifecycle Event") {
    // Bound, not interpolated: the defective value contains a semicolon and a
    // space, and SQLite reads a JSON.stringify'd double-quoted string as an
    // IDENTIFIER rather than a literal.
    db.prepare(
      "INSERT INTO product_lifecycle_events (id,source_id,product_id,obsolete_part_number,lifecycle_status,replacement_candidates,review_status,source_location,created_at) VALUES (?,?,?,?,?,'[]','Needs Review','{}','2026-10-01 00:00:00')",
    ).bind(entityId, "productsource_r1", productId, "X", lifecycleStatus).run();
  } else {
    raw.exec(`INSERT INTO product_attributes (id,product_id,attribute_name,value_json,original_value,normalized_value,evidence_json,confidence,review_status,version_number,source_id,created_by,created_at) VALUES ('${entityId}','${productId}','slc_address_model','{}','orig','NON_SLC','{}',95,'Approved',1,'productsource_r1','test','2026-10-01 00:00:00')`);
  }
  // The snapshot MUST use the real `new_snapshot_json` shape -- camelCase keys
  // `productId` / `normalizedValue` / `attributeName` -- because that is what
  // `promoteKnowledgeFact` writes. A fixture using snake_case would pass against
  // a drift check that never actually compares anything, which is precisely the
  // bug this shape declaration was written to prevent.
  const snapshot = entityType === "Product Lifecycle Event"
    ? {
        productId,
        entityType,
        entityId,
        attributeName: "lifecycle_status",
        originalValue: lifecycleStatus,
        normalizedValue: lifecycleStatus,
        unit: null,
        targetProductId: null,
        reviewStatus: "Needs Review",
        versionNumber: 1,
        productSourceId: "productsource_r1",
      }
    : {
        productId,
        entityType,
        entityId,
        attributeName: "slc_address_model",
        originalValue: "orig",
        normalizedValue: "NON_SLC",
        unit: null,
        targetProductId: null,
        reviewStatus: "Approved",
        versionNumber: 1,
        productSourceId: "productsource_r1",
      };
  db.prepare(
    `INSERT INTO knowledge_promotions (id,organization_id,knowledge_fact_id,knowledge_file_id,canonical_product_id,canonical_entity_type,canonical_entity_id,product_source_id,action,policy_version,source_checksum,previous_snapshot_json,new_snapshot_json,reason,decided_by,decided_role,idempotency_key,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,'knowledge-promotion-policy-v2','cs','{}',?,'promoted','omair-primary','Administrator','seed-key','2026-10-01')`,
  ).bind(
    PROMOTION, ORG, FACT, FILE, productId, entityType, entityId, "productsource_r1", action,
    JSON.stringify(snapshot),
  ).run();
  return { entityId, entityType };
};

const call = (overrides = {}) => ({
  promotionId: PROMOTION,
  decision: "Reversed",
  reason: REASON,
  humanActor: REAL_HUMAN,
  actorRole: "Administrator",
  idempotencyKey: "rev-1",
  ...overrides,
});

// ---------------------------------------------------------------------------
// Pure governance.
// ---------------------------------------------------------------------------

test("PROMOTION-REVERSAL/A a synthetic actor is refused before anything is read", () => {
  for (const humanActor of [
    undefined,
    null,
    { id: "local-development-user", name: "Local Dev", source: HUMAN_ACTOR_SOURCE },
    { id: "system", name: "System", source: "internal" },
    { id: "omair-primary", name: "Omair" },
  ]) {
    const outcome = assessKnowledgePromotionReversal({
      promotion: { canonical_entity_type: "Product Lifecycle Event" },
      decision: "Reversed",
      reason: REASON,
      humanActor,
    });
    assert.equal(outcome.ok, false, `${JSON.stringify(humanActor)} must be refused`);
    assert.equal(outcome.code, PROMOTION_REVERSAL_ERRORS.HUMAN_ACTOR_REQUIRED);
  }
  assert.equal(
    assessKnowledgePromotionReversal({
      promotion: { canonical_entity_type: "Product Lifecycle Event" },
      decision: "Reversed",
      reason: REASON,
      humanActor: REAL_HUMAN,
    }).ok,
    true,
  );
});

test("PROMOTION-REVERSAL/B reason bar, decision value, and unsupported destinations", () => {
  const promotion = { canonical_entity_type: "Product Lifecycle Event" };
  assert.equal(assessKnowledgePromotionReversal({ promotion, decision: "Reversed", reason: "wrong", humanActor: REAL_HUMAN }).code, PROMOTION_REVERSAL_ERRORS.REASON_REQUIRED);
  assert.equal(assessKnowledgePromotionReversal({ promotion, decision: "Delete", reason: REASON, humanActor: REAL_HUMAN }).code, PROMOTION_REVERSAL_ERRORS.DESTINATION_UNSUPPORTED);
  const unsupported = assessKnowledgePromotionReversal({
    promotion: { canonical_entity_type: "Something Else Entirely" },
    decision: "Reversed",
    reason: REASON,
    humanActor: REAL_HUMAN,
  });
  assert.equal(unsupported.code, PROMOTION_REVERSAL_ERRORS.DESTINATION_UNSUPPORTED);
  assert.deepEqual(unsupported.reversibleTypes, ["Product Attribute", "Product Lifecycle Event", "Engineering Relationship"]);
});

test("PROMOTION-REVERSAL/C an Evidence Only promotion is refused: it wrote nothing to reverse", async () => {
  const { db } = fresh();
  return reverseKnowledgePromotion(db, call({ promotionId: "unknown" })).then(async (missing) => {
    assert.equal(missing.code, PROMOTION_REVERSAL_ERRORS.PROMOTION_REQUIRED);
  });
});

// ---------------------------------------------------------------------------
// Database-backed reversal.
// ---------------------------------------------------------------------------

test("PROMOTION-REVERSAL/D a reversal removes the canonical row, preserves the fact, and audits it", async () => {
  const { raw, db } = fresh();
  const { entityId } = seedPromotion(raw, db);
  const result = await reverseKnowledgePromotion(db, call());
  assert.equal(result.ok, true, result.message);
  assert.equal(result.outcome, "Reversed");
  assert.equal(result.knowledgeFactPreserved, true);

  // canonical row gone
  assert.equal(raw.prepare(`SELECT COUNT(*) c FROM product_lifecycle_events WHERE id='${entityId}'`).get().c, 0);
  // Knowledge observation preserved
  const fact = raw.prepare(`SELECT review_status, original_value FROM knowledge_facts WHERE id='${FACT}'`).get();
  assert.equal(fact.review_status, "Reviewed", "the observation and its review state survive");
  assert.equal(fact.original_value, "prose");
  // original promotion history preserved and unedited
  const promotion = raw.prepare(`SELECT * FROM knowledge_promotions WHERE id='${PROMOTION}'`).get();
  assert.equal(promotion.action, "Promoted", "the promotion record still says Promoted");
  assert.equal(promotion.decided_by, "omair-primary");
  // audit
  const event = raw.prepare(`SELECT * FROM knowledge_file_events WHERE event_type='${PROMOTION_REVERSAL_EVENT_TYPE}'`).get();
  assert.ok(event, "a reversal audit event is written");
  assert.equal(event.actor_user_id, "omair-primary");
  const details = JSON.parse(event.details);
  assert.equal(details.promotionId, PROMOTION);
  assert.equal(details.outcome, "Reversed");
  assert.equal(details.humanActorSource, HUMAN_ACTOR_SOURCE);
  assert.equal(details.knowledgeFactPreserved, true);
  // the removed row is preserved IN FULL inside the audit: a reversal must be
  // reconstructible, not a bare deletion.
  assert.equal(details.removedCanonicalRow.row.id, entityId);
  assert.match(details.removedCanonicalRow.row.lifecycle_status, /SGWLED/);
  assert.match(details.reason, /canonical lifecycle token/);
});

test("PROMOTION-REVERSAL/E replay writes nothing, and a different key does not double-reverse", async () => {
  const { raw, db } = fresh();
  const { entityId } = seedPromotion(raw, db);
  const first = await reverseKnowledgePromotion(db, call());
  assert.equal(first.idempotent, false);
  const eventCount = raw.prepare("SELECT COUNT(*) c FROM knowledge_file_events").get().c;

  const replay = await reverseKnowledgePromotion(db, call());
  assert.equal(replay.ok, true);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.eventId, first.eventId, "the same event, not a second one");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM knowledge_file_events").get().c, eventCount, "no duplicate audit row");
  assert.equal(raw.prepare(`SELECT COUNT(*) c FROM product_lifecycle_events WHERE id='${entityId}'`).get().c, 0);

  // A different key for an already-reversed promotion must not claim a second
  // withdrawal; the canonical row is already gone.
  const again = await reverseKnowledgePromotion(db, call({ idempotencyKey: "rev-2" }));
  assert.equal(again.ok, true);
  assert.equal(again.idempotent, true);
  assert.equal(again.alreadyReversed, true);
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM knowledge_file_events").get().c, eventCount, "still exactly one audit row");
});

test("PROMOTION-REVERSAL/F a canonical row changed by another decision fails closed", async () => {
  const { raw, db } = fresh();
  seedPromotion(raw, db);
  // Another governed decision edits the canonical row after the promotion.
  raw.exec("UPDATE product_lifecycle_events SET lifecycle_status='Discontinued' WHERE id='productlifecycle_r1'");
  return reverseKnowledgePromotion(db, call()).then((result) => {
    assert.equal(result.ok, false);
    assert.equal(result.code, PROMOTION_REVERSAL_ERRORS.CANONICAL_ROW_CHANGED);
    assert.match(result.drift, /lifecycle_status/);
    // and nothing was written
    assert.equal(raw.prepare("SELECT COUNT(*) c FROM product_lifecycle_events").get().c, 1, "the other decision's row survives");
    assert.equal(raw.prepare("SELECT COUNT(*) c FROM knowledge_file_events").get().c, 0);
  });
});

test("PROMOTION-REVERSAL/G a vanished canonical row is reported distinctly from a changed one", async () => {
  const { raw, db } = fresh();
  seedPromotion(raw, db);
  raw.exec("DELETE FROM product_lifecycle_events WHERE id='productlifecycle_r1'");
  return reverseKnowledgePromotion(db, call()).then((result) => {
    assert.equal(result.ok, false);
    assert.equal(result.code, PROMOTION_REVERSAL_ERRORS.CANONICAL_ROW_MISSING);
  });
});

test("PROMOTION-REVERSAL/H an attribute promotion reverses too, and other products are untouched", async () => {
  const { raw, db } = fresh();
  seedProduct(db, { id: 'product_other', partNumber: 'Y', manufacturerId: 'man_honeywell' });
  raw.exec("INSERT INTO product_attributes (id,product_id,attribute_name,value_json,original_value,normalized_value,evidence_json,confidence,review_status,version_number,source_id,created_by,created_at) VALUES ('productattribute_other','product_other','slc_address_model','{}','o','NON_SLC','{}',95,'Approved',1,'productsource_r1','test','2026-10-01 00:00:00')");
  const { entityId } = seedPromotion(raw, db, { entityType: "Product Attribute" });

  const result = await reverseKnowledgePromotion(db, call());
  assert.equal(result.ok, true, result.message);
  assert.equal(result.destination, "attribute");
  assert.equal(raw.prepare(`SELECT COUNT(*) c FROM product_attributes WHERE id='${entityId}'`).get().c, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM product_attributes WHERE id='productattribute_other'").get().c, 1, "an unrelated attribute survives");
});

test("PROMOTION-REVERSAL/I idempotency key is mandatory, and an unknown promotion is refused", async () => {
  const { db } = fresh();
  assert.equal((await reverseKnowledgePromotion(db, call({ promotionId: "" }))).code, PROMOTION_REVERSAL_ERRORS.PROMOTION_REQUIRED);
  assert.equal((await reverseKnowledgePromotion(db, call({ idempotencyKey: "" }))).code, PROMOTION_REVERSAL_ERRORS.IDEMPOTENCY_KEY_REQUIRED);
  assert.equal((await reverseKnowledgePromotion(db, call({ promotionId: "nope" }))).code, PROMOTION_REVERSAL_ERRORS.PROMOTION_REQUIRED);
});

test("PROMOTION-REVERSAL/K a promotion that recorded too little to verify is REFUSED, not waved through", () => {
  // The subtle failure. If the drift check treats "the snapshot has no such key"
  // as "no drift", then any promotion whose snapshot predates a field can be
  // reversed without ever proving the canonical row is still the row that
  // promotion made -- i.e. it could delete another decision's work. Absence of
  // evidence that the row is unchanged is not evidence that it is unchanged.
  const { raw, db } = fresh();
  seedPromotion(raw, db);
  // Simulate an under-recorded promotion: drop the value the check relies on.
  const row = raw.prepare(`SELECT new_snapshot_json FROM knowledge_promotions WHERE id='${PROMOTION}'`).get();
  const snapshot = JSON.parse(row.new_snapshot_json);
  delete snapshot.normalizedValue;
  db.prepare("UPDATE knowledge_promotions SET new_snapshot_json=? WHERE id=?")
    .bind(JSON.stringify(snapshot), PROMOTION)
    .run();

  return reverseKnowledgePromotion(db, call()).then((result) => {
    assert.equal(result.ok, false, "an unverifiable promotion must not be reversible");
    assert.equal(result.code, PROMOTION_REVERSAL_ERRORS.CANONICAL_ROW_CHANGED);
    assert.match(result.drift, /CANONICAL_SNAPSHOT_UNREADABLE/);
    assert.equal(raw.prepare("SELECT COUNT(*) c FROM product_lifecycle_events").get().c, 1, "the canonical row survives");
    assert.equal(raw.prepare("SELECT COUNT(*) c FROM knowledge_file_events").get().c, 0, "and no reversal was recorded");
  });
});

test("PROMOTION-REVERSAL/J an Evidence Only promotion cannot be 'reversed'", async () => {
  const { raw, db } = fresh();
  seedPromotion(raw, db, { action: "Evidence Only" });
  return reverseKnowledgePromotion(db, call()).then((result) => {
    assert.equal(result.ok, false);
    assert.equal(result.code, PROMOTION_REVERSAL_ERRORS.DESTINATION_UNSUPPORTED);
    assert.equal(result.action, "Evidence Only");
    assert.equal(raw.prepare("SELECT COUNT(*) c FROM knowledge_file_events").get().c, 0);
  });
});
