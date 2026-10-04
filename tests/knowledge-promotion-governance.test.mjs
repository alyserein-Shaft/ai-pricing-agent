import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

// KN-GOVERNANCE-REPAIR: per-type promotion governance beyond Protocol-only.
// Pins: deterministic path refuses human-only classes and commercial sources;
// human capacity/relationship/lifecycle promote through review+link into the
// correct canonical structures; conflicts/ambiguity fail closed; repeats are
// idempotent; the Knowledge fact row is never rewritten by promotion.
import {
  evaluateKnowledgePromotion,
  promoteKnowledgeFact,
} from "../worker/knowledge-promotion.mjs";

const ORG = "org-gov";
const REASON = "Governed test promotion with manufacturer datasheet evidence and resolved product identity.";

const schema = `
PRAGMA foreign_keys=ON;
CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL);
CREATE TABLE knowledge_files (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, file_name TEXT NOT NULL,
  sha256 TEXT NOT NULL, detected_type TEXT NOT NULL, processing_status TEXT NOT NULL,
  extraction_version TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '{}');
CREATE TABLE knowledge_facts (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, knowledge_file_id TEXT NOT NULL,
  fact_type TEXT NOT NULL, fact_key TEXT NOT NULL, original_value TEXT NOT NULL,
  normalized_value TEXT NOT NULL, attributes TEXT NOT NULL DEFAULT '{}',
  confidence INTEGER NOT NULL, review_status TEXT NOT NULL,
  source_location TEXT NOT NULL DEFAULT '{}');
CREATE TABLE knowledge_product_links (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, knowledge_fact_id TEXT NOT NULL,
  part_number TEXT NOT NULL, existing_product_id TEXT,
  link_state TEXT NOT NULL, new_information TEXT NOT NULL DEFAULT '{}');
CREATE TABLE knowledge_file_events (
  id TEXT PRIMARY KEY, organization_id TEXT, knowledge_file_id TEXT,
  event_type TEXT, details TEXT, actor_user_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE library_products (
  id TEXT PRIMARY KEY, part_number TEXT NOT NULL, normalized_part_number TEXT NOT NULL,
  identity_status TEXT NOT NULL, superseded_by_product_id TEXT,
  library_scope TEXT NOT NULL, organization_id TEXT, library_project_id TEXT);
CREATE VIEW canonical_library_products AS SELECT id AS requested_product_id, id AS id, part_number, normalized_part_number, identity_status, superseded_by_product_id, library_scope, organization_id, library_project_id FROM library_products WHERE identity_status<>'Superseded';
CREATE TABLE product_sources (
  id TEXT PRIMARY KEY, project_id TEXT, document_id TEXT, document_version_id TEXT,
  checksum TEXT NOT NULL, source_type TEXT NOT NULL, authority TEXT NOT NULL,
  scope_type TEXT NOT NULL, file_name TEXT NOT NULL, release_version TEXT,
  effective_from TEXT, valid_until TEXT, currency TEXT, validity_state TEXT NOT NULL,
  review_status TEXT NOT NULL, downstream_use TEXT NOT NULL, metadata TEXT NOT NULL,
  created_by TEXT NOT NULL, organization_id TEXT);
CREATE TABLE product_source_evidence (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL, source_id TEXT NOT NULL,
  sheet TEXT, row_number INTEGER, page INTEGER, cells TEXT NOT NULL DEFAULT '[]',
  original_text TEXT, parser_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE product_attributes (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL, variant_id TEXT,
  attribute_definition_id TEXT, attribute_name TEXT NOT NULL, value_json TEXT,
  original_value TEXT, normalized_value TEXT, unit TEXT, source_id TEXT,
  evidence_json TEXT NOT NULL, confidence INTEGER NOT NULL DEFAULT 0,
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  version_number INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TEXT, deleted_at TEXT);
CREATE TABLE product_compatibility (
  id TEXT PRIMARY KEY, source_product_id TEXT NOT NULL, target_product_id TEXT,
  target_family_id TEXT, relationship_type TEXT NOT NULL,
  conditions_json TEXT NOT NULL DEFAULT '{}', exceptions_json TEXT NOT NULL DEFAULT '{}',
  required_firmware TEXT, required_protocol TEXT, source_id TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}', confidence INTEGER NOT NULL DEFAULT 0,
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  version_number INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TEXT, deleted_at TEXT);
CREATE TABLE engineering_relationships (
  id TEXT PRIMARY KEY, project_id TEXT, left_entity_type TEXT NOT NULL,
  left_entity_id TEXT NOT NULL, relationship_type TEXT NOT NULL,
  right_entity_type TEXT NOT NULL, right_entity_id TEXT NOT NULL,
  conditions TEXT NOT NULL DEFAULT '[]', exceptions TEXT NOT NULL DEFAULT '[]',
  quantity_rule TEXT, fact_type TEXT NOT NULL, scope_type TEXT NOT NULL,
  scope_id TEXT, provenance_fact_id TEXT, confidence INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL, version_number INTEGER NOT NULL DEFAULT 1,
  effective_from TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, effective_to TEXT,
  reviewed_by TEXT, reviewed_at TEXT, created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE product_lifecycle_events (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL, product_id TEXT,
  obsolete_part_number TEXT NOT NULL, lifecycle_status TEXT NOT NULL,
  replacement_candidates TEXT NOT NULL DEFAULT '[]',
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  source_location TEXT NOT NULL DEFAULT '{}', reviewed_by TEXT, reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE knowledge_promotions (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, knowledge_fact_id TEXT NOT NULL,
  knowledge_file_id TEXT NOT NULL, canonical_product_id TEXT NOT NULL,
  canonical_entity_type TEXT NOT NULL, canonical_entity_id TEXT NOT NULL,
  product_source_id TEXT NOT NULL, action TEXT NOT NULL,
  policy_version TEXT NOT NULL, source_checksum TEXT NOT NULL,
  previous_snapshot_json TEXT NOT NULL, new_snapshot_json TEXT NOT NULL,
  reason TEXT NOT NULL, decided_by TEXT NOT NULL, decided_role TEXT NOT NULL,
  idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, idempotency_key), UNIQUE(organization_id, knowledge_fact_id));
`;

const fixture = ({ detectedType = "Product Datasheet" } = {}) => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  raw.exec(`INSERT INTO organizations VALUES ('${ORG}','Gov','Active')`);
  raw.exec(`INSERT INTO knowledge_files VALUES ('file-a','${ORG}','datasheet.pdf','sha-real','${detectedType}','Completed','v1','{}')`);
  raw.exec(`INSERT INTO library_products VALUES ('product-a','PART-100','PART-100','Active',NULL,'Organization Library','${ORG}',NULL)`);
  raw.exec(`INSERT INTO library_products VALUES ('product-b','PANEL-1','PANEL-1','Active',NULL,'Organization Library','${ORG}',NULL)`);
  const obs = JSON.stringify({ observationKey: "Products:12:PART-100", partNumber: "PART-100" });
  const loc = JSON.stringify({ sheet: "Products", row: 12, fileName: "datasheet.pdf" });
  raw.exec(`INSERT INTO knowledge_facts VALUES ('fact-part','${ORG}','file-a','Part Number','part-100','PART-100','part-100','${obs.replace(/'/g, "''")}',99,'Reviewed','${loc.replace(/'/g, "''")}')`);
  raw.exec(`INSERT INTO knowledge_product_links VALUES ('link-part','${ORG}','fact-part','PART-100','product-a','Existing Product — Additive Learning Only','{}')`);
  const DB = {
    prepare: (sql) => {
      const bound = (...args) => ({
        first: async () => raw.prepare(sql).get(...args) ?? null,
        all: async () => ({ results: raw.prepare(sql).all(...args) }),
        run: async () => raw.prepare(sql).run(...args),
      });
      return { ...bound(), bind: (...args) => bound(...args) };
    },
    batch: async (statements) => {
      raw.exec("BEGIN");
      try {
        for (const statement of statements) await statement.run();
        raw.exec("COMMIT");
      } catch (error) {
        try { raw.exec("ROLLBACK"); } catch { /* already unwound */ }
        throw error;
      }
      return [];
    },
  };
  const addFact = (id, factType, key, value, reviewStatus = "Reviewed", attributes = {}) =>
    raw.prepare("INSERT INTO knowledge_facts VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
      id, ORG, "file-a", factType, key, value, value,
      JSON.stringify({ observationKey: "Products:12:PART-100", partNumber: "PART-100", ...attributes }),
      95, reviewStatus, loc,
    );
  return { raw, DB, addFact };
};

const HUMAN = { authorization: "human" };
const DETERMINISTIC = { authorization: "deterministic" };
const ACTOR = { id: "engineer-1", permission: "Library Manager" };

test("deterministic path refuses human-only capacity classes", async () => {
  const { raw, DB, addFact } = fixture();
  try {
    for (const [factType, value] of [["SLC Loops", "1"], ["Detector Capacity", "159"], ["Module Capacity", "159"], ["System Points", "636"]]) {
      addFact(`fact-${factType}`, factType, "k", value, "Learned");
      const result = await evaluateKnowledgePromotion(DB, `fact-${factType}`, ORG, DETERMINISTIC);
      assert.equal(result.status, "HUMAN_REVIEW_REQUIRED", `${factType} must never promote deterministically`);
    }
  } finally {
    raw.close();
  }
});

test("deterministic path refuses relationship and lifecycle classes", async () => {
  const { raw, DB, addFact } = fixture();
  try {
    addFact("fact-rel", "Product Relationship", "k", "Compatible With", "Learned", { targetPartNumber: "PANEL-1" });
    assert.equal((await evaluateKnowledgePromotion(DB, "fact-rel", ORG, DETERMINISTIC)).status, "HUMAN_REVIEW_REQUIRED");
    addFact("fact-life", "Lifecycle", "k", "Discontinued", "Learned");
    assert.equal((await evaluateKnowledgePromotion(DB, "fact-life", ORG, DETERMINISTIC)).status, "HUMAN_REVIEW_REQUIRED");
  } finally {
    raw.close();
  }
});

test("deterministic path refuses commercial and unknown sources", async () => {
  for (const detectedType of ["Price List", "Supplier Quotation", "Supplier RFQ", "BOQ", "Unknown"]) {
    const { raw, DB, addFact } = fixture({ detectedType });
    try {
      addFact("fact-proto", "Protocol", "k", "SLC", "Learned");
      const result = await evaluateKnowledgePromotion(DB, "fact-proto", ORG, DETERMINISTIC);
      assert.equal(result.status, "SOURCE_AUTHORITY_INSUFFICIENT", `${detectedType} must not feed deterministic promotion`);
    } finally {
      raw.close();
    }
  }
});

test("deterministic path still promotes technical-source Protocol", async () => {
  const { raw, DB, addFact } = fixture({ detectedType: "Product Catalogue" });
  try {
    addFact("fact-proto", "Protocol", "k", "SLC", "Learned");
    const result = await evaluateKnowledgePromotion(DB, "fact-proto", ORG, DETERMINISTIC);
    assert.equal(result.status, "PROMOTABLE");
    assert.equal(result.attributeName, "protocol");
  } finally {
    raw.close();
  }
});

test("non-reviewed capacity cannot promote on the human path", async () => {
  const { raw, DB, addFact } = fixture();
  try {
    addFact("fact-cap", "Detector Capacity", "k", "159", "Learned");
    assert.equal((await evaluateKnowledgePromotion(DB, "fact-cap", ORG, HUMAN)).status, "NOT_APPROVED");
  } finally {
    raw.close();
  }
});

test("non-numeric capacity fails closed, never guessed", async () => {
  const { raw, DB, addFact } = fixture();
  try {
    for (const value of ["lots", "159-318", "", "-5"]) {
      addFact(`fact-cap-${value || "empty"}`, "Detector Capacity", "k", value || "x");
      const result = await evaluateKnowledgePromotion(DB, `fact-cap-${value || "empty"}`, ORG, HUMAN);
      assert.equal(result.status, "UNSUPPORTED_ATTRIBUTE_VALUE", JSON.stringify(value));
    }
  } finally {
    raw.close();
  }
});

test("human capacity promotes into an Approved canonical attribute; fact row untouched", async () => {
  const { raw, DB, addFact } = fixture();
  try {
    addFact("fact-cap", "Detector Capacity", "k", "159");
    const before = raw.prepare("SELECT review_status, original_value, normalized_value FROM knowledge_facts WHERE id='fact-cap'").get();
    const evaluation = await evaluateKnowledgePromotion(DB, "fact-cap", ORG, HUMAN);
    assert.equal(evaluation.status, "PROMOTABLE");
    assert.equal(evaluation.attributeName, "max_detectors_per_loop");
    assert.equal(evaluation.normalizedValue, 159);
    const promotion = await promoteKnowledgeFact(DB, {
      factId: "fact-cap", organizationId: ORG, actor: ACTOR, reason: REASON, idempotencyKey: "key-cap-1", ...HUMAN,
    });
    assert.equal(promotion.status, "PROMOTED");
    assert.equal(promotion.canonicalEntityType, "Product Attribute");
    const attribute = raw.prepare("SELECT attribute_name, normalized_value, review_status FROM product_attributes WHERE product_id='product-a'").get();
    assert.deepEqual([attribute.attribute_name, Number(attribute.normalized_value), attribute.review_status], ["max_detectors_per_loop", 159, "Approved"]);
    const after = raw.prepare("SELECT review_status, original_value, normalized_value FROM knowledge_facts WHERE id='fact-cap'").get();
    assert.deepEqual(after, before, "promotion must never rewrite the Knowledge observation");
  } finally {
    raw.close();
  }
});

test("human relationship promotes into an Approved engineering_relationships row (KN-REL-1)", async () => {
  const { raw, DB, addFact } = fixture();
  try {
    addFact("fact-rel", "Product Relationship", "k", "Compatible With", "Reviewed", { targetPartNumber: "PANEL-1" });
    const evaluation = await evaluateKnowledgePromotion(DB, "fact-rel", ORG, HUMAN);
    assert.equal(evaluation.status, "PROMOTABLE");
    assert.equal(evaluation.targetTable, "engineering_relationships");
    assert.equal(evaluation.targetProductId, "product-b");
    const promotion = await promoteKnowledgeFact(DB, {
      factId: "fact-rel", organizationId: ORG, actor: ACTOR, reason: REASON, idempotencyKey: "key-rel-1", ...HUMAN,
    });
    assert.equal(promotion.status, "PROMOTED");
    assert.equal(promotion.canonicalEntityType, "Engineering Relationship");
    const rel = raw.prepare(
      "SELECT left_entity_id, right_entity_type, right_entity_id, relationship_type, status, project_id, fact_type, provenance_fact_id, conditions FROM engineering_relationships",
    ).get();
    // provenance_fact_id stays NULL: it is an FK to engineering_facts, and the
    // Knowledge provenance lives in `conditions`.
    assert.deepEqual(
      [rel.left_entity_id, rel.right_entity_type, rel.right_entity_id, rel.relationship_type, rel.status, rel.project_id, rel.fact_type, rel.provenance_fact_id],
      ["product-a", "Product", "product-b", "Compatible With", "Approved", null, "Manufacturer Rule", null],
    );
    const conditions = JSON.parse(rel.conditions || "[]");
    assert.equal(conditions[0].knowledgeFactId, "fact-rel");
    assert.equal(conditions[0].decidedBy, "engineer-1");
  } finally {
    raw.close();
  }
});

test("relationship with missing or ambiguous target fails closed", async () => {
  const { raw, DB, addFact } = fixture();
  try {
    addFact("fact-rel-missing", "Product Relationship", "k", "Compatible With", "Reviewed", { targetPartNumber: "NOPE-404" });
    assert.equal((await evaluateKnowledgePromotion(DB, "fact-rel-missing", ORG, HUMAN)).status, "MISSING_TARGET");
    raw.exec("INSERT INTO library_products VALUES ('product-b2','PANEL-1B','PANEL-1','Active',NULL,'Organization Library','org-gov',NULL)");
    addFact("fact-rel-amb", "Product Relationship", "k", "Compatible With", "Reviewed", { targetPartNumber: "PANEL-1" });
    // product-b (PANEL-1) and product-b2 (PANEL-1B share normalized PANEL-1): ambiguous
    assert.equal((await evaluateKnowledgePromotion(DB, "fact-rel-amb", ORG, HUMAN)).status, "AMBIGUOUS_TARGET");
  } finally {
    raw.close();
  }
});

test("an identical relationship repeats as Evidence Only without duplicating (KN-REL-1)", async () => {
  const { raw, DB, addFact } = fixture();
  try {
    addFact("fact-rel", "Product Relationship", "k", "Compatible With", "Reviewed", { targetPartNumber: "PANEL-1" });
    const first = await promoteKnowledgeFact(DB, {
      factId: "fact-rel", organizationId: ORG, actor: ACTOR, reason: REASON, idempotencyKey: "key-rel-1", ...HUMAN,
    });
    assert.equal(first.status, "PROMOTED");
    addFact("fact-rel-2", "Product Relationship", "k", "Compatible With", "Reviewed", { targetPartNumber: "PANEL-1" });
    const second = await promoteKnowledgeFact(DB, {
      factId: "fact-rel-2", organizationId: ORG, actor: ACTOR, reason: REASON, idempotencyKey: "key-rel-2", ...HUMAN,
    });
    assert.equal(second.status, "EVIDENCE_ONLY");
    assert.equal(raw.prepare("SELECT COUNT(*) c FROM engineering_relationships").get().c, 1);
  } finally {
    raw.close();
  }
});

test("the seeded ('System','the control unit') relationship shape stays canonical AND is ledgered (KN-LEDGER-1)", async () => {
  const { raw, DB, addFact } = fixture();
  try {
    // The live catalogue already holds Approved rows of this older shape, e.g.
    // IDP-PHOTO-IV -> ('System','the control unit'), seeded by
    // sprint-7-farenhyt-compat-seed from the same manufacturer device list.
    raw.exec(
      "INSERT INTO engineering_relationships (id,left_entity_type,left_entity_id,relationship_type,right_entity_type,right_entity_id,conditions,exceptions,fact_type,scope_type,confidence,status,created_by) VALUES ('rel-legacy','Product','product-a','Compatible With','System','the control unit','[]','[]','Manufacturer Rule','Product',96,'Approved','sprint-7-farenhyt-compat-seed')",
    );
    addFact("fact-rel", "Product Relationship", "k", "Compatible With", "Reviewed", { targetPartNumber: "PANEL-1" });
    const result = await promoteKnowledgeFact(DB, {
      factId: "fact-rel", organizationId: ORG, actor: ACTOR, reason: REASON, idempotencyKey: "key-rel-legacy", ...HUMAN,
    });
    assert.equal(result.status, "EVIDENCE_ONLY");
    assert.equal(result.canonicalEntityId, "rel-legacy");
    assert.equal(raw.prepare("SELECT COUNT(*) c FROM engineering_relationships").get().c, 1, "no second relationship row may be written");

    // KN-LEDGER-1: the outcome must be audit-visible.
    // knowledge_promotions has no decided_at column: the timestamp is
    // knowledge_promotions.created_at. The ledger must still carry the decision
    // moment, so assert on the real column rather than inventing one.
    const promotion = raw.prepare(
      "SELECT knowledge_fact_id, canonical_product_id, canonical_entity_type, canonical_entity_id, action, policy_version, reason, decided_by, created_at FROM knowledge_promotions WHERE knowledge_fact_id='fact-rel'",
    ).get();
    assert.ok(promotion, "an EVIDENCE_ONLY outcome must still write a promotion ledger row");
    assert.equal(promotion.canonical_entity_type, "Engineering Relationship");
    assert.equal(promotion.canonical_entity_id, "rel-legacy");
    assert.equal(promotion.action, "Evidence Only");
    assert.equal(promotion.policy_version, "knowledge-promotion-policy-v2");
    assert.equal(promotion.decided_by, "engineer-1");
    assert.ok(promotion.created_at, "the ledger row must carry its decision timestamp");
    const snapshot = JSON.parse(
      raw.prepare("SELECT new_snapshot_json FROM knowledge_promotions WHERE knowledge_fact_id='fact-rel'").get().new_snapshot_json,
    );
    assert.match(snapshot.evidenceOnlyNote || "", /already exists/);

    // Repeat promotion stays idempotent: one ledger row, no new entity.
    const replay = await promoteKnowledgeFact(DB, {
      factId: "fact-rel", organizationId: ORG, actor: ACTOR, reason: REASON, idempotencyKey: "key-rel-legacy", ...HUMAN,
    });
    assert.equal(replay.status, "EVIDENCE_ONLY");
    assert.equal(replay.idempotent, true);
    assert.equal(raw.prepare("SELECT COUNT(*) c FROM knowledge_promotions").get().c, 1);
    assert.equal(raw.prepare("SELECT COUNT(*) c FROM engineering_relationships").get().c, 1);
  } finally {
    raw.close();
  }
});

test("lifecycle promotes into a Needs Review lifecycle event; conflicting status fails closed", async () => {
  const { raw, DB, addFact } = fixture();
  try {
    addFact("fact-life", "Lifecycle", "k", "Discontinued");
    const promotion = await promoteKnowledgeFact(DB, {
      factId: "fact-life", organizationId: ORG, actor: ACTOR, reason: REASON, idempotencyKey: "key-life-1", ...HUMAN,
    });
    assert.equal(promotion.status, "PROMOTED");
    assert.equal(promotion.canonicalEntityType, "Product Lifecycle Event");
    const event = raw.prepare("SELECT lifecycle_status, review_status, obsolete_part_number FROM product_lifecycle_events").get();
    assert.deepEqual([event.lifecycle_status, event.review_status, event.obsolete_part_number], ["Discontinued", "Needs Review", "PART-100"]);
    addFact("fact-life-2", "Lifecycle", "k", "Current");
    const conflict = await promoteKnowledgeFact(DB, {
      factId: "fact-life-2", organizationId: ORG, actor: ACTOR, reason: REASON, idempotencyKey: "key-life-2", ...HUMAN,
    });
    assert.equal(conflict.status, "CONFLICT");
    assert.equal(conflict.existingValue, "Discontinued");
    assert.equal(raw.prepare("SELECT COUNT(*) c FROM product_lifecycle_events").get().c, 1);
  } finally {
    raw.close();
  }
});

test("deterministic promotion writes Reviewed, never Approved", async () => {
  const { raw, DB, addFact } = fixture({ detectedType: "Product Catalogue" });
  try {
    addFact("fact-proto", "Protocol", "k", "SLC", "Learned");
    const promotion = await promoteKnowledgeFact(DB, {
      factId: "fact-proto", organizationId: ORG,
      actor: { id: "system:knowledge-fact-deterministic-promotion", permission: "Library Manager" },
      reason: "Deterministic governed promotion: knowledge-promotion-policy-v2 gates satisfied; no engineer exception review required.",
      idempotencyKey: "key-det-1", ...DETERMINISTIC,
    });
    assert.equal(promotion.status, "PROMOTED");
    const attribute = raw.prepare("SELECT review_status, created_by FROM product_attributes").get();
    // Controlled vocabulary plus evidence gates: visible where Reviewed
    // suffices, upgradeable through attribute review -- but never born Approved.
    assert.equal(attribute.review_status, "Reviewed");
  } finally {
    raw.close();
  }
});

test("repeated promotion is idempotent across destinations", async () => {
  const { raw, DB, addFact } = fixture();
  try {
    addFact("fact-cap", "Detector Capacity", "k", "159");
    const first = await promoteKnowledgeFact(DB, {
      factId: "fact-cap", organizationId: ORG, actor: ACTOR, reason: REASON, idempotencyKey: "key-cap-1", ...HUMAN,
    });
    assert.equal(first.status, "PROMOTED");
    const replay = await promoteKnowledgeFact(DB, {
      factId: "fact-cap", organizationId: ORG, actor: ACTOR, reason: REASON, idempotencyKey: "key-cap-1", ...HUMAN,
    });
    assert.equal(replay.status, "PROMOTED");
    assert.equal(replay.idempotent, true);
    assert.equal(raw.prepare("SELECT COUNT(*) c FROM product_attributes").get().c, 1);
    assert.equal(raw.prepare("SELECT COUNT(*) c FROM knowledge_promotions").get().c, 1);
  } finally {
    raw.close();
  }
});
