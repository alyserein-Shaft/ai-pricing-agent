import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

// KN-GOVERNANCE-REPAIR (§12 downstream proof): promoted canonical facts must
// be visible to existing consumers through their own predicates, with no
// Knowledge-only code. Each read below mirrors the exact governed conjuncts
// of the consumer cited in comments. The sizing assessment runs the real
// production calculator over promoted capacities.
import { promoteKnowledgeFact } from "../worker/knowledge-promotion.mjs";
import { calculateSlcExpansion } from "../app/domain/fire-alarm-slc-capacity-calculator.mjs";

const ORG = "org-downstream";
const REASON = "Governed downstream proof promotion with manufacturer datasheet evidence.";

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
CREATE TABLE library_products (
  id TEXT PRIMARY KEY, part_number TEXT NOT NULL, normalized_part_number TEXT NOT NULL,
  identity_status TEXT NOT NULL, superseded_by_product_id TEXT,
  library_scope TEXT NOT NULL, organization_id TEXT, library_project_id TEXT,
  manufacturer_id TEXT);
CREATE TABLE product_manufacturers (id TEXT PRIMARY KEY, name TEXT NOT NULL);
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
CREATE TABLE knowledge_promotions (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, knowledge_fact_id TEXT NOT NULL,
  knowledge_file_id TEXT NOT NULL, canonical_product_id TEXT NOT NULL,
  canonical_entity_type TEXT NOT NULL, canonical_entity_id TEXT NOT NULL,
  product_source_id TEXT NOT NULL, action TEXT NOT NULL,
  policy_version TEXT NOT NULL, source_checksum TEXT NOT NULL,
  previous_snapshot_json TEXT NOT NULL, new_snapshot_json TEXT NOT NULL,
  reason TEXT NOT NULL, decided_by TEXT NOT NULL, decided_role TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  UNIQUE(organization_id, idempotency_key), UNIQUE(organization_id, knowledge_fact_id));`;

const fixture = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  raw.exec(`INSERT INTO organizations VALUES ('${ORG}','Downstream','Active')`);
  raw.exec(`INSERT INTO product_manufacturers VALUES ('mfr-honeywell','Honeywell')`);
  raw.exec(`INSERT INTO knowledge_files VALUES ('file-a','${ORG}','s3-datasheet.pdf','sha-s3','Product Datasheet','Completed','v1','{}')`);
  raw.exec(`INSERT INTO library_products VALUES ('panel-s3','S3','S3','Active',NULL,'Organization Library','${ORG}',NULL,'mfr-honeywell')`);
  raw.exec(`INSERT INTO library_products VALUES ('det-100','DET-100','DET-100','Active',NULL,'Organization Library','${ORG}',NULL,'mfr-honeywell')`);
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
  const obs = (pn) => JSON.stringify({ observationKey: `Products:1:${pn}`, partNumber: pn });
  const loc = JSON.stringify({ page: 3, fileName: "s3-datasheet.pdf" });
  const addFact = (id, factType, key, value, extra = {}) =>
    raw.prepare("INSERT INTO knowledge_facts VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
      id, ORG, "file-a", factType, key, value, value,
      JSON.stringify({ observationKey: `Products:1:${extra.pn || "S3"}`, partNumber: extra.pn || "S3", ...extra.attrs }),
      95, "Reviewed", loc,
    );
  const linkFor = (factId, pn, productId) =>
    raw.prepare("INSERT INTO knowledge_product_links VALUES (?,?,?,?,?,?,?)").run(
      `link-${factId}`, ORG, factId, pn, productId, "Existing Product — Additive Learning Only", "{}",
    );
  // Part-number anchors for both products (Reviewed, linked).
  for (const [pn, pid] of [["S3", "panel-s3"], ["DET-100", "det-100"]]) {
    raw.prepare("INSERT INTO knowledge_facts VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
      `fact-pn-${pid}`, ORG, "file-a", "Part Number", `pn-${pid}`, pn, pn, obs(pn), 99, "Reviewed", loc);
    linkFor(`fact-pn-${pid}`, pn, pid);
  }
  return { raw, DB, addFact };
};

const ACTOR = { id: "engineer-1", permission: "Library Manager" };
const promote = (DB, factId, key) =>
  promoteKnowledgeFact(DB, {
    factId, organizationId: ORG, actor: ACTOR, reason: REASON, idempotencyKey: key,
    authorization: "human",
  });

test("promoted capacities satisfy the panel-sizing loader predicate", async () => {
  const { raw, DB, addFact } = fixture();
  try {
    const capacities = [["cap-loops", "SLC Loops", "1"], ["cap-det", "Detector Capacity", "159"], ["cap-mod", "Module Capacity", "159"], ["cap-sys", "System Points", "636"]];
    for (const [id, type, value] of capacities) {
      addFact(id, type, "k", value);
      assert.equal((await promote(DB, id, `key-${id}`)).status, "PROMOTED");
    }
    // worker/fire-alarm-panel-sizing-api.mjs loadCapacityEvidence shape:
    // Approved + current + exact governed names.
    const rows = (await DB.prepare(
      `SELECT attribute_name, normalized_value FROM product_attributes
       WHERE product_id=? AND review_status='Approved' AND superseded_at IS NULL AND deleted_at IS NULL
       AND attribute_name IN ('native_slc_loops','max_detectors_per_loop','max_modules_per_loop','max_system_points')
       ORDER BY attribute_name`).bind("panel-s3").all()).results || [];
    assert.deepEqual(
      rows.map((row) => [row.attribute_name, Number(row.normalized_value)]),
      [["max_detectors_per_loop", 159], ["max_modules_per_loop", 159], ["max_system_points", 636], ["native_slc_loops", 1]],
    );
  } finally {
    raw.close();
  }
});

test("production sizing math consumes promoted capacities with no special code", async () => {
  const { raw, DB, addFact } = fixture();
  try {
    for (const [id, type, value] of [["cap-loops", "SLC Loops", "1"], ["cap-det", "Detector Capacity", "159"], ["cap-mod", "Module Capacity", "159"], ["cap-sys", "System Points", "636"]]) {
      addFact(id, type, "k", value);
      await promote(DB, id, `key-${id}`);
    }
    const rows = (await DB.prepare(
      "SELECT attribute_name, normalized_value FROM product_attributes WHERE product_id=? AND review_status='Approved' AND superseded_at IS NULL AND deleted_at IS NULL").bind("panel-s3").all()).results || [];
    const capacity = Object.fromEntries(rows.map((row) => [row.attribute_name, Number(row.normalized_value)]));
    const panelCapacity = {
      nativeLoops: capacity.native_slc_loops,
      detectorsPerLoop: capacity.max_detectors_per_loop,
      modulesPerLoop: capacity.max_modules_per_loop,
      systemPointCeiling: capacity.max_system_points,
    };
    const need = calculateSlcExpansion({ demand: { detectors: 2, modules: 0 }, panelCapacity });
    assert.equal(need.status, "NO_EXPANSION_REQUIRED");
    assert.equal(need.requiredAdditionalLoops, 0);
  } finally {
    raw.close();
  }
});

test("a Product Relationship with NO explicit semantic is REFUSED, not laundered into compatibility", async () => {
  // THE P0 REFUTATION. Same fixture, same target, same Reviewed+Linked state --
  // but the fact carries no `relationshipType`. Before the policy closure this
  // promoted as an Approved "Compatible With" row, because the missing semantic
  // was defaulted. It must now fail closed, and it must write NOTHING.
  const { raw, DB, addFact } = fixture();
  try {
    addFact("fact-nosem", "Product Relationship", "k", "Requires S3", { pn: "DET-100", attrs: { targetPartNumber: "S3" } });
    const outcome = await promote(DB, "fact-nosem", "key-nosem");
    assert.equal(outcome.status, "UNSUPPORTED_RELATIONSHIP_TYPE");
    assert.equal(
      raw.prepare("SELECT COUNT(*) c FROM engineering_relationships WHERE left_entity_id='det-100'").get().c,
      0,
      "a refused semantic must write no relationship row at all",
    );
    // And an explicitly WRONG semantic is refused with the reason naming it,
    // rather than being coerced to the policy default.
    addFact("fact-requires", "Product Relationship", "k2", "Requires S3", {
      pn: "DET-100", attrs: { targetPartNumber: "S3", relationshipType: "Requires" },
    });
    const required = await promote(DB, "fact-requires", "key-requires");
    assert.equal(required.status, "UNSUPPORTED_RELATIONSHIP_TYPE");
    assert.equal(required.relationshipType, "Requires");
    assert.equal(raw.prepare("SELECT COUNT(*) c FROM engineering_relationships").get().c, 0);
  } finally {
    raw.close();
  }
});

test("promoted compatibility satisfies the REAL product-matching loader predicate (KN-REL-1)", async () => {
  const { raw, DB, addFact } = fixture();
  try {
    // CHANGED 2026-10-01 (policy closure). This fact previously carried NO
    // `relationshipType` and asserted that it still promoted as "Compatible
    // With". That assertion ENCODED THE P0 DEFECT: the old normalizer read
    //     clean(fact.relationshipType) || policy.relationshipType
    // so a missing semantic silently became "Compatible With". The fact now
    // asserts the semantic EXPLICITLY, which is what the governance requires.
    addFact("fact-rel", "Product Relationship", "k", "Compatible With", {
      pn: "DET-100",
      attrs: { targetPartNumber: "S3", relationshipType: "Compatible With" },
    });
    assert.equal((await promote(DB, "fact-rel", "key-rel")).status, "PROMOTED");
    // Verbatim predicate from worker/product-matching-api.mjs loadProducts()
    // (the `compatibility` sub-select), with a NULL project scope:
    const rows = raw.prepare(
      `SELECT json_object('targetItem', r.right_entity_id, 'relationshipType', r.relationship_type, 'conditions', r.conditions) AS c
       FROM engineering_relationships r
       WHERE r.left_entity_type='Product' AND r.left_entity_id=?
         AND r.status='Approved' AND (r.project_id IS NULL OR r.project_id IS NULL)
         AND (r.right_entity_type<>'Product' OR EXISTS (
              SELECT 1 FROM library_products t
              WHERE t.id=r.right_entity_id AND t.identity_status='Active' AND t.superseded_by_product_id IS NULL))`
    ).all("det-100");
    assert.equal(rows.length, 1);
    const c = JSON.parse(rows[0].c);
    assert.equal(c.relationshipType, "Compatible With");
    assert.equal(c.targetItem, "panel-s3");
    assert.equal(JSON.parse(c.conditions)[0].knowledgeFactId, "fact-rel");
  } finally {
    raw.close();
  }
});

test("promoted attributes satisfy the matching attribute loader predicate", async () => {
  const { raw, DB, addFact } = fixture();
  try {
    addFact("fact-cap", "Detector Capacity", "k", "159");
    await promote(DB, "fact-cap", "key-cap");
    // worker/product-matching-api.mjs attribute shape: Approved + current,
    // newest-first.
    const rows = (await DB.prepare(
      `SELECT attribute_name, normalized_value FROM product_attributes
       WHERE product_id=? AND superseded_at IS NULL AND review_status='Approved'
       ORDER BY created_at DESC`).bind("panel-s3").all()).results || [];
    assert.ok(rows.some((row) => row.attribute_name === "max_detectors_per_loop" && Number(row.normalized_value) === 159));
  } finally {
    raw.close();
  }
});
