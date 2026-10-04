/**
 * COMPAT-GOV — compatibility evidence is governed, traceable, current, and
 * product-specific.
 *
 * Closed here:
 *   1. Resolution vocabulary: every material relation resolves to CONFIRMED /
 *      NOT_COMPATIBLE / CONFLICTING / UNKNOWN (additive compatibilityState
 *      alongside the historical result strings, which are untouched).
 *      Conflicting offers no longer resolve by array order: incompatibility
 *      wins (fail-closed) and the dispute is recorded.
 *   2. Currency at read: both the matching loader and the profile loader
 *      exclude relationships whose Product-type target identity is not
 *      current (Active + not superseded). Family targets carry no identity
 *      lifecycle and pass through.
 *   3. Auto-confirm conflict-blindness (UNRESOLVED-SEMANTICS finding, closed
 *      under this phase's authority): Gate 3 refuses same-pair different-type
 *      Approved rows (tested in worker/__tests__/compatibility-auto-confirm).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { evaluateCandidate } from "../app/domain/product-matching-engine.mjs";
import { loadProducts } from "../worker/product-matching-api.mjs";
import { loadInputs } from "../worker/technical-requirement-api.mjs";

const d1 = (sql) => ({
  prepare(text) {
    let values = [];
    return {
      bind(...next) {
        values = next;
        return this;
      },
      first: async () => sql.prepare(text).get(...values) ?? null,
      all: async () => ({ results: sql.prepare(text).all(...values) }),
      run: async () => sql.prepare(text).run(...values),
    };
  },
  batch: async (statements) => Promise.all(statements.map((statement) => statement.run())),
});

// ---------------------------------------------------------------------------
// 1. Resolution vocabulary.
// ---------------------------------------------------------------------------
const profileWith = (targets) => ({
  boqItem: { system: "Fire Alarm" },
  compatibility: targets.map((targetItem) => ({ targetItem })),
  consolidatedRequirements: [],
  standards: [],
  accessories: [],
  manufacturers: [],
});
const productWith = (compatibility) => ({
  product: {
    id: "p1", manufacturer: "Honeywell", partNumber: "D1", description: "Detector",
    family: "Detector", compatibility,
  },
  basis: ["test"],
  matchingBasis: ["test"],
  searchScore: 80,
  stage: "Structured",
  discoveryOnly: false,
  comparisons: [],
  standards: [],
  accessories: [],
  lifecycle: { state: "ok" },
  commercialAvailability: "x",
  mandatoryFailures: [],
  mandatoryUnresolved: [],
});
const compatOf = (output) => {
  const rows = output.comparisons.filter((entry) => entry.comparisonType === "Compatibility");
  assert.equal(rows.length, 1);
  return rows[0];
};

test("COMPAT-GOV no offer resolves UNKNOWN and never passes", () => {
  const row = compatOf(evaluateCandidate({ profile: profileWith(["Panel X"]), generated: productWith([]), prices: [], projectId: "p1" }));
  assert.equal(row.result, "Evidence Missing");
  assert.equal(row.compatibilityState, "UNKNOWN");
  assert.equal(row.conflicting, false);
  assert.equal(row.pass, false);
  assert.equal(row.blocking, false);
});

test("COMPAT-GOV a compatible offer resolves CONFIRMED", () => {
  const row = compatOf(evaluateCandidate({
    profile: profileWith(["Panel X"]),
    generated: productWith([{ targetItem: "Panel X", relationshipType: "Compatible With" }]),
    prices: [], projectId: "p1",
  }));
  assert.equal(row.result, "Verified Compatible");
  assert.equal(row.compatibilityState, "CONFIRMED");
  assert.equal(row.pass, true);
});

test("COMPAT-GOV an incompatible offer resolves NOT_COMPATIBLE and blocks", () => {
  const row = compatOf(evaluateCandidate({
    profile: profileWith(["Panel X"]),
    generated: productWith([{ targetItem: "Panel X", relationshipType: "does not support" }]),
    prices: [], projectId: "p1",
  }));
  assert.equal(row.result, "Incompatible");
  assert.equal(row.compatibilityState, "NOT_COMPATIBLE");
  assert.equal(row.pass, false);
  assert.equal(row.blocking, true);
});

test("COMPAT-GOV conflicting offers resolve CONFLICTING with incompatibility winning", () => {
  const row = compatOf(evaluateCandidate({
    profile: profileWith(["Panel X"]),
    generated: productWith([
      { targetItem: "Panel X", relationshipType: "Compatible With" },
      { targetItem: "Panel X", relationshipType: "Incompatible With" },
    ]),
    prices: [], projectId: "p1",
  }));
  assert.equal(row.compatibilityState, "CONFLICTING");
  assert.equal(row.conflicting, true);
  assert.equal(row.pass, false);
  assert.equal(row.blocking, true);
});

// ---------------------------------------------------------------------------
// 2. Currency at read: superseded target identities are not current evidence.
// ---------------------------------------------------------------------------
const productTables = `
    CREATE TABLE canonical_library_products (id TEXT PRIMARY KEY, requested_product_id TEXT, manufacturer_id TEXT, brand_id TEXT, family_id TEXT, part_number TEXT, identity_status TEXT, review_status TEXT, superseded_by_product_id TEXT);
    CREATE TABLE product_manufacturers (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE product_brands (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE product_families (id TEXT PRIMARY KEY, name TEXT, engineering_domain TEXT);
    CREATE TABLE product_attributes (id TEXT PRIMARY KEY, product_id TEXT, attribute_name TEXT, value_json TEXT, original_value TEXT, normalized_value TEXT, unit TEXT, source_id TEXT, evidence_json TEXT, confidence REAL, review_status TEXT, created_at TEXT, deleted_at TEXT, superseded_at TEXT);
    CREATE TABLE product_source_evidence (id TEXT PRIMARY KEY, product_id TEXT, source_id TEXT, sheet TEXT, row_number INTEGER, cells TEXT, created_at TEXT);
    CREATE TABLE engineering_relationships (id TEXT PRIMARY KEY, left_entity_type TEXT, left_entity_id TEXT, relationship_type TEXT, right_entity_type TEXT, right_entity_id TEXT, status TEXT, project_id TEXT, scope_type TEXT, scope_id TEXT, conditions TEXT);
    CREATE TABLE product_accessories (id TEXT PRIMARY KEY, product_id TEXT, accessory_product_id TEXT, relationship_type TEXT, included INTEGER, quantity_rule TEXT, quantity_parameter TEXT, condition_json TEXT, confidence REAL, evidence_json TEXT, superseded_at TEXT, deleted_at TEXT, review_status TEXT);
    CREATE TABLE library_products (id TEXT PRIMARY KEY, description TEXT, part_number TEXT, family_id TEXT);
`;

test("COMPAT-GOV matching loader excludes relationships to superseded target products", async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    ${productTables}
    INSERT INTO product_manufacturers VALUES ('m1','Honeywell');
    INSERT INTO canonical_library_products VALUES
      ('det1','det1','m1',NULL,NULL,'D1','Active','Reviewed',NULL),
      ('panel-live','panel-live','m1',NULL,NULL,'P1','Active','Reviewed',NULL),
      ('panel-dead','panel-dead','m1',NULL,NULL,'P0','Active','Reviewed','panel-live');
    INSERT INTO product_source_evidence VALUES ('e1','det1',NULL,NULL,NULL,NULL,NULL);
    INSERT INTO engineering_relationships VALUES
      ('rel-live','Product','det1','Compatible With','Product','panel-live','Approved',NULL,'Global',NULL,'[]'),
      ('rel-dead','Product','det1','Compatible With','Product','panel-dead','Approved',NULL,'Global',NULL,'[]');
  `);
  try {
    const products = await loadProducts(d1(raw), "p1");
    assert.equal(products.length, 1);
    assert.deepEqual(
      products[0].compatibility.map((entry) => entry.targetItem).sort(),
      ["panel-live"],
    );
  } finally {
    raw.close();
  }
});

test("COMPAT-GOV profile loader excludes relationships to non-Active target products", async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, archived_at TEXT);
    CREATE TABLE documents (id TEXT PRIMARY KEY, project_id TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
    CREATE TABLE document_versions (id TEXT PRIMARY KEY, document_id TEXT, effective_from TEXT, effective_to TEXT);
    CREATE TABLE document_supersessions (id TEXT PRIMARY KEY, superseding_version_id TEXT, superseded_version_id TEXT, effective_from TEXT, effective_to TEXT);
    CREATE TABLE boq_extraction_versions (id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, version_number INTEGER, status TEXT, superseded_at TEXT);
    CREATE TABLE specification_extraction_versions (id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, version_number INTEGER, status TEXT, superseded_at TEXT);
    -- MVP-CLOSE-14: review_status added to this double. The real
    -- technical_requirements table has always carried it, and loadInputs now
    -- filters on the canonical eligibility predicate which references it. The
    -- 'req1' row below is already asserting an approved-for-downstream
    -- requirement (approved_for_downstream=1), which in the real schema is
    -- written together with review_status='Approved' by every governed path.
    CREATE TABLE technical_requirements (id TEXT PRIMARY KEY, extraction_version_id TEXT, project_id TEXT, source_document_id TEXT, approved_for_downstream INTEGER, review_status TEXT);
    CREATE TABLE boq_requirement_links (id TEXT PRIMARY KEY, boq_item_id TEXT, requirement_id TEXT, status TEXT, superseded_at TEXT);
    CREATE TABLE engineering_facts (id TEXT PRIMARY KEY, project_id TEXT, fact_type TEXT, status TEXT, scope_type TEXT, scope_id TEXT);
    ${productTables}
    CREATE TABLE requirement_attributes (id TEXT PRIMARY KEY, requirement_id TEXT);
    CREATE TABLE requirement_standards (id TEXT PRIMARY KEY, requirement_id TEXT);
    CREATE TABLE requirement_manufacturers (id TEXT PRIMARY KEY, requirement_id TEXT);
    CREATE TABLE requirement_compatibility (id TEXT PRIMARY KEY, requirement_id TEXT);
    CREATE TABLE requirement_accessories (id TEXT PRIMARY KEY, requirement_id TEXT);
    CREATE TABLE requirement_intelligence_facts (id TEXT PRIMARY KEY, profile_version_id TEXT, requirement_id TEXT, review_status TEXT, reviewed_at TEXT);
    CREATE TABLE requirement_profile_versions (id TEXT PRIMARY KEY, boq_item_id TEXT, version_number INTEGER, superseded_at TEXT);
    INSERT INTO projects VALUES ('p1',NULL);
    INSERT INTO documents VALUES ('doc1','p1','dv1',NULL,NULL);
    INSERT INTO document_versions VALUES ('dv1','doc1',NULL,NULL);
    INSERT INTO boq_extraction_versions VALUES ('ex1','doc1','dv1',1,'Completed',NULL);
    INSERT INTO specification_extraction_versions VALUES ('sx1','doc1','dv1',1,'Completed',NULL);
    INSERT INTO technical_requirements VALUES ('req1','sx1','p1','doc1',1,'Approved');
    INSERT INTO boq_requirement_links VALUES ('link1','item1','req1','Confirmed',NULL);
    INSERT INTO product_manufacturers VALUES ('m1','Honeywell');
    INSERT INTO canonical_library_products VALUES
      ('panel-live','panel-live','m1',NULL,NULL,'P1','Active','Reviewed',NULL),
      ('panel-dead','panel-dead','m1',NULL,NULL,'P0','Superseded','Reviewed','panel-live');
    INSERT INTO engineering_relationships VALUES
      ('rel-live',NULL,NULL,NULL,'Product','panel-live','Approved',NULL,'Global',NULL,'[]'),
      ('rel-dead',NULL,NULL,NULL,'Product','panel-dead','Approved',NULL,'Global',NULL,'[]');
  `);
  try {
    const { relationships } = await loadInputs(d1(raw), { id: "item1", project_id: "p1" });
    assert.deepEqual(
      relationships.map((entry) => entry.right_entity_id).sort(),
      ["panel-live"],
    );
  } finally {
    raw.close();
  }
});
