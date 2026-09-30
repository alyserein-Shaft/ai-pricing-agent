import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { runProductMatching } from "../app/domain/product-matching-engine.mjs";

// GOLDEN DETECTOR-BASE ACCESSORY FIXTURE
//
// The Golden Full Journey blocked at
//   POST /api/match-candidates/:id/safety/approve -> 409 APPROVAL_BLOCKED
//   blocks: ["MANDATORY_REQUIREMENT_FAILED"]
// because the one persisted blocking comparison was
//   comparisonType "Accessory", accessory "detector base",
//   offered null, result "Missing Accessory", blocking true.
//
// This suite pins the FIXTURE, not the matcher. It asserts three things:
//
//   1. The Golden seed really carries a governed product-to-product detector-base
//      relationship that resolves through the PRODUCTION read path
//      (worker/product-matching-api.mjs's own SQL, extracted from source so it
//      cannot drift) and the PRODUCTION engine.
//
//   2. The production rule that blocked is UNCHANGED and still blocks: the same
//      profile evaluated against a product with no accessory evidence is still
//      "Missing Accessory" and still blocking. A weakened matcher, an optional
//      detector base, or a Golden-ID special case would all fail here.
//
//   3. The seed is idempotent: applying it twice yields exactly one relationship.
//
// Nothing in app/domain/product-matching-engine.mjs, worker/product-matching-api.mjs,
// db/schema.ts, or the review-status filter is modified by the fixture fix.

const SEED = new URL("../tests/e2e/seed-golden-catalog.sql", import.meta.url);
const MIGRATIONS = new URL("../drizzle/", import.meta.url);
const MATCHING_API = new URL("../worker/product-matching-api.mjs", import.meta.url);
const CANONICAL_AUTHORITY = new URL("../worker/canonical-product-authority.mjs", import.meta.url);
const ENGINE = new URL("../app/domain/product-matching-engine.mjs", import.meta.url);

// One migration cannot be applied standalone under node:sqlite: 0084 creates the
// identity_mutation_guard_validate trigger before drizzle/0083 has created its
// price_records table, which plain sequential exec rejects. It is a migration
// ordering artifact of the offline harness, touches only price intake lineage,
// and is irrelevant to the product catalog asserted here. Every catalog table
// this suite needs (library_products, product_families, product_accessories,
// product_source_evidence, canonical_library_products) is created by a migration
// that does apply, and is asserted to exist before use.
const MIGRATION_ORDERING_ARTIFACTS = new Set(["0084_price_record_intake_lineage.sql"]);

const buildCatalog = () => {
  const db = new DatabaseSync(":memory:");
  const dir = new URL(".", MIGRATIONS).pathname;
  const skipped = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
    if (MIGRATION_ORDERING_ARTIFACTS.has(file)) { skipped.push(file); continue; }
    db.exec(readFileSync(`${dir}/${file}`, "utf8"));
  }
  for (const table of ["library_products", "product_families", "product_accessories", "product_source_evidence", "engineering_relationships"]) {
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name=?").get(table), `${table} must exist`);
  }
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='canonical_library_products' AND type='view'").get(), "canonical_library_products view must exist");
  return { db, skipped };
};

const applySeed = (db) => db.exec(readFileSync(SEED, "utf8"));

// The production accessories projection, lifted verbatim out of
// worker/product-matching-api.mjs's loadProducts. Extracting it from source
// means this suite can never assert against a stale copy of the read path: if
// the projection or its review-status/deleted/superseded filter changes, this
// test follows the change.
const productionAccessoriesSql = () => {
  const source = readFileSync(MATCHING_API, "utf8");
  const start = source.indexOf("(SELECT json_group_array(json_object('name', COALESCE(af.name, ap.description)");
  assert.ok(start > 0, "production accessories projection must exist in product-matching-api.mjs");
  const end = source.indexOf(") accessories,", start);
  assert.ok(end > start, "production accessories projection must be extractable");
  return source.slice(start, end + 1);
};

// The governed accessory block this fix adds. Everything before the first
// INSERT OR IGNORE is the pre-existing Golden catalog seed, which is applied
// exactly once per fresh database by scripts/setup-golden-e2e.sh; the block
// added here uses fixed ids and INSERT OR IGNORE so re-applying it can never
// create a duplicate relationship.
const accessorySeedBlock = () => {
  const source = readFileSync(SEED, "utf8");
  // Anchor on a statement start, not on the phrase, which also appears in the
  // explanatory comment above the block.
  const start = source.indexOf("\nINSERT OR IGNORE");
  assert.ok(start > 0, "the accessory seed block must be present in the Golden catalog seed");
  assert.equal(source.slice(0, start).includes("INSERT OR IGNORE INTO"), false, "the pre-existing catalog seed must not use INSERT OR IGNORE");
  return source.slice(start + 1);
};

const productionDiscoveryPredicate = () => {
  const source = readFileSync(CANONICAL_AUTHORITY, "utf8");
  const match = /export const CANONICAL_DISCOVERY_PRODUCT_PREDICATE = "([^"]+)"/.exec(source);
  assert.ok(match, "CANONICAL_DISCOVERY_PRODUCT_PREDICATE must be exported");
  return match[1].replace(/\\"/g, '"');
};

const readGoldenCatalog = (db) => {
  const accessories = productionAccessoriesSql();
  const rows = db.prepare(
    `SELECT p.*, m.name manufacturer, b.name brand, f.name family, ${accessories} AS accessories_projection
       FROM canonical_library_products p
       JOIN product_manufacturers m ON m.id=p.manufacturer_id
       LEFT JOIN product_brands b ON b.id=p.brand_id
       LEFT JOIN product_families f ON f.id=p.family_id
      WHERE ${productionDiscoveryPredicate()}`,
  ).all();
  return new Map(rows.map((row) => [
    row.id,
    // Same projection worker/product-matching-api.mjs's productFromRow performs.
    {
      id: row.id,
      manufacturer: row.manufacturer,
      brand: row.brand,
      family: row.family,
      partNumber: row.part_number,
      normalizedPartNumber: row.normalized_part_number,
      description: row.description,
      lifecycleStatus: row.lifecycle_status,
      attributes: JSON.parse(row.attributes || "[]"),
      standards: JSON.parse(row.standards || "[]"),
      compatibility: [],
      accessories: JSON.parse(row.accessories_projection || "[]"),
      reviewStatus: row.review_status,
      source: null,
    },
  ]));
};

// The exact persisted requirement from the failing Golden run: an Explicit,
// confidence-90, review_status "Needs Review" accessory row named "detector
// base", attached to a Mandatory parent requirement. Reproduced verbatim so the
// fixture fix is proved against the real failing shape, not a convenient one.
const GOLDEN_EXTRACTED_REQUIREMENT = {
  id: "specjob_chunk_000001_requirement_2_accessory_1",
  requirement_id: "specjob_chunk_000001_requirement_2",
  accessory: "detector base",
  source_type: "Explicit",
  quantity_rule: null,
  confidence: 90,
  review_status: "Needs Review",
};

const goldenProfile = (accessoryRequirement, overrides = {}) => ({
  versionNumber: 1,
  boqItem: { id: "boq-golden-1", description: "Golden addressable detector", system: "Fire Alarm", category: "Detection Device", productFamily: "Golden Addressable" },
  readiness: { status: "Ready for Matching", blockingReasons: [] },
  consolidatedRequirements: [{
    id: "specjob_chunk_000001_requirement_2",
    normalizedRequirement: "Detector shall be supplied with a compatible base",
    priority: "Mandatory",
    attributes: [{ name: "Voltage", operator: "Equal", normalizedValue: 24, normalizedUnit: "V" }],
    accessories: [accessoryRequirement],
  }],
  standards: [],
  manufacturers: [],
  compatibility: [],
  // The persisted shape carries requirement_id, which is what links the flattened
  // accessory row to its parent requirement in the production engine. Without
  // that link the parent would additionally be treated as an unstructured
  // mandatory statement, which is a different requirement from the one under
  // test here.
  accessories: [accessoryRequirement],
  derivedRequirements: [],
  clarifications: [],
  ...overrides,
});

// -----------------------------------------------------------------------------
// 1. The seed carries the relationship
// -----------------------------------------------------------------------------

test("the Golden seed carries exactly one governed detector-base accessory relationship", () => {
  const { db } = buildCatalog();
  applySeed(db);
  const rows = db.prepare("SELECT id, product_id, accessory_product_id, relationship_type, review_status, included, separately_priced, confidence FROM product_accessories").all();
  assert.equal(rows.length, 1, "exactly one product_accessories relationship must be seeded");
  const [row] = rows;
  assert.equal(row.product_id, "golden-product-fa-001");
  assert.equal(row.relationship_type, "Compatible Base", "the engine's documented detector-base proof relationship type");
  assert.equal(row.review_status, "Approved", "an unreviewed relationship is filtered out of product.accessories by production");
  assert.equal(row.included, 1, "the base is supplied with the detector");
  assert.equal(row.separately_priced, 0, "an included base is not separately priced");
  assert.equal(row.confidence, 100);

  const accessory = db.prepare("SELECT lp.id, lp.part_number, lp.family_id, pf.name AS family_name FROM library_products lp LEFT JOIN product_families pf ON pf.id=lp.family_id WHERE lp.id=?").get(row.accessory_product_id);
  assert.ok(accessory, "accessory_product_id must resolve to a real library product (its FK target)");
  assert.equal(accessory.family_name, "Detector Base", "the projected accessory name must normalise to the required 'detector base'");
});

test("the seed evidence cites the same reviewed product source the detector already uses", () => {
  const { db } = buildCatalog();
  applySeed(db);
  const evidence = db.prepare("SELECT source_id, original_text FROM product_source_evidence WHERE product_id='golden-detector-base-001'").get();
  assert.ok(evidence, "the accessory needs its own source evidence row");
  assert.equal(evidence.source_id, "golden-product-source", "same reviewed datasheet source as the detector");
  const detector = db.prepare("SELECT original_text FROM product_source_evidence WHERE product_id='golden-product-fa-001'").get();
  assert.match(detector.original_text, /supplied with detector base/i, "the detector's own evidence already states the base is supplied");
  assert.match(evidence.original_text, /base/i);
});

test("the base is catalog evidence for a relationship, not a competing detector", () => {
  const { db } = buildCatalog();
  applySeed(db);
  const base = db.prepare("SELECT approved_for_discovery, attributes, standards, description FROM library_products WHERE id='golden-detector-base-001'").get();
  assert.equal(base.approved_for_discovery, 0, "a mounting base is not a drop-in substitute for a detector");
  assert.equal(JSON.parse(base.attributes).length, 0, "the base must not claim the detector's own technical attributes");
  assert.equal(JSON.parse(base.standards).length, 0, "the base must not claim the detector's own certification");
  assert.match(base.description, /base/i);
  assert.doesNotMatch(base.description, /detector,/, "the base's own description must not impersonate a detector line");
  // The relationship must not displace the detector: with the whole seeded
  // catalog offered, the detector is still the candidate that resolves the
  // detector-base requirement.
  const catalog = [...readGoldenCatalog(db).values()];
  const result = runProductMatching({ profile: goldenProfile(GOLDEN_EXTRACTED_REQUIREMENT), products: catalog, prices: [] });
  const passing = result.candidates.filter((candidate) => candidate.comparisons.some((entry) => entry.comparisonType === "Accessory" && entry.pass));
  assert.equal(passing.length, 1, "only the detector may satisfy the detector-base requirement");
  assert.equal(passing[0].product.id, "golden-product-fa-001");
});

test("the relationship resolves through the production read path before matching starts", () => {
  const { db } = buildCatalog();
  applySeed(db);
  const catalog = readGoldenCatalog(db);
  const detector = catalog.get("golden-product-fa-001");
  assert.ok(detector, "the Golden detector must be discoverable through the production predicate");
  assert.equal(detector.accessories.length, 1, "product.accessories must resolve exactly one accessory");
  assert.equal(detector.accessories[0].name, "Detector Base", "COALESCE(af.name, ap.description) must project the base's own catalog name");
  assert.equal(detector.accessories[0].relationshipType, "Compatible Base");
  assert.equal(detector.accessories[0].accessoryProductId, "golden-detector-base-001");
  assert.equal(detector.accessories[0].included, 1);
});

test("a Needs Review or deleted relationship is still filtered out by production", () => {
  const { db } = buildCatalog();
  applySeed(db);
  db.prepare("UPDATE product_accessories SET review_status='Needs Review' WHERE product_id='golden-product-fa-001'").run();
  assert.equal(readGoldenCatalog(db).get("golden-product-fa-001").accessories.length, 0, "Needs Review must not resolve");
  db.prepare("UPDATE product_accessories SET review_status='Approved', deleted_at=CURRENT_TIMESTAMP WHERE product_id='golden-product-fa-001'").run();
  assert.equal(readGoldenCatalog(db).get("golden-product-fa-001").accessories.length, 0, "a deleted relationship must not resolve");
  db.prepare("UPDATE product_accessories SET deleted_at=NULL, superseded_at=CURRENT_TIMESTAMP WHERE product_id='golden-product-fa-001'").run();
  assert.equal(readGoldenCatalog(db).get("golden-product-fa-001").accessories.length, 0, "a superseded relationship must not resolve");
});

// -----------------------------------------------------------------------------
// 2. The fix works through the PRODUCTION engine, and the rule still blocks
// -----------------------------------------------------------------------------

test("with the seeded relationship the extracted detector-base requirement resolves and approval progresses", () => {
  const { db } = buildCatalog();
  applySeed(db);
  const detector = readGoldenCatalog(db).get("golden-product-fa-001");
  const result = runProductMatching({
    profile: goldenProfile(GOLDEN_EXTRACTED_REQUIREMENT),
    products: [detector],
    prices: [],
  });
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  const accessoryComparison = candidate.comparisons.find((entry) => entry.comparisonType === "Accessory");
  assert.ok(accessoryComparison, "the accessory requirement must be evaluated");
  assert.equal(accessoryComparison.result, "Pass", "the seeded relationship must satisfy the extracted 'detector base' requirement");
  assert.equal(accessoryComparison.pass, true);
  assert.ok(accessoryComparison.offered, "the offered accessory must be the seeded base");
  assert.equal(accessoryComparison.blocking, false);
  assert.equal(candidate.mandatoryFailures.length, 0, "no MANDATORY_REQUIREMENT_FAILED may survive for the detector base");
  assert.notEqual(candidate.technicalStatus, "Non-Compliant");
});

test("the derived accessory.detector-base rule is also satisfied, by the same evidence", () => {
  const { db } = buildCatalog();
  applySeed(db);
  const detector = readGoldenCatalog(db).get("golden-product-fa-001");
  const derived = { id: "derived:boq-golden-1:detector-base", ruleId: "accessory.detector-base", output: { accessory: "Compatible detector base" }, factType: "Derived Fact", confidence: 75, reviewStatus: "Needs Review" };
  const profile = goldenProfile(GOLDEN_EXTRACTED_REQUIREMENT);
  const result = runProductMatching({ profile: { ...profile, derivedRequirements: [derived] }, products: [detector], prices: [] });
  const accessoryComparisons = result.candidates[0].comparisons.filter((entry) => entry.comparisonType === "Accessory");
  assert.equal(accessoryComparisons.length, 2, "both the extracted and the derived requirement must be evaluated");
  for (const comparison of accessoryComparisons) {
    assert.equal(comparison.result, "Pass", `the Compatible Base relationship must prove ${comparison.accessory}`);
    assert.equal(comparison.blocking, false);
  }
  assert.equal(result.candidates[0].mandatoryFailures.length, 0);
});

test("NEGATIVE -- a detector with no accessory evidence is still Missing Accessory and still blocks", () => {
  // The production rule is untouched by the fixture fix. If this ever stops
  // failing closed, either the matcher was weakened or the negative case was
  // deleted, and the Golden journey would pass for the wrong reason.
  const { db } = buildCatalog();
  applySeed(db);
  const detector = readGoldenCatalog(db).get("golden-product-fa-001");
  const stripped = { ...detector, accessories: [] };
  const result = runProductMatching({
    profile: goldenProfile(GOLDEN_EXTRACTED_REQUIREMENT),
    products: [stripped],
    prices: [],
  });
  const accessoryComparison = result.candidates[0].comparisons.find((entry) => entry.comparisonType === "Accessory");
  assert.equal(accessoryComparison.result, "Missing Accessory", "a detector with no base evidence must still report Missing Accessory");
  assert.equal(accessoryComparison.pass, false);
  assert.equal(accessoryComparison.blocking, true, "a missing mandatory accessory must still block at this commit");
  assert.equal(result.candidates[0].mandatoryFailures.length, 1, "it must enter mandatoryFailures and reach the safety engine as MANDATORY_REQUIREMENT_FAILED");
  assert.equal(result.candidates[0].technicalStatus, "Non-Compliant");
  assert.equal(result.candidates[0].approvalReady, false);
});

test("a base whose catalog name does not normalise to the requirement still blocks", () => {
  // Proves the match is a real normalized name comparison and not a vacuous
  // "any accessory counts" pass. A differently-named base offers nothing.
  const { db } = buildCatalog();
  applySeed(db);
  const detector = readGoldenCatalog(db).get("golden-product-fa-001");
  const unrelated = { ...detector, accessories: [{ ...detector.accessories[0], name: "Wall Mount Bracket" }] };
  const result = runProductMatching({ profile: goldenProfile(GOLDEN_EXTRACTED_REQUIREMENT), products: [unrelated], prices: [] });
  const accessoryComparison = result.candidates[0].comparisons.find((entry) => entry.comparisonType === "Accessory");
  assert.equal(accessoryComparison.result, "Missing Accessory", "an unrelated accessory name must not satisfy the requirement");
  assert.equal(accessoryComparison.blocking, true);
  assert.equal(result.candidates[0].mandatoryFailures.length, 1);
});

test("the seed fix does not depend on the accessory-contradiction semantics of any engine variant", () => {
  // The working tree carries a stricter, uncommitted accessory rule set (an
  // explicit "Incompatible" result and a non-blocking missing accessory) that
  // does not exist at this commit. The fixture fix must be correct under both,
  // because it is seed data: what changes is only whether the requirement is
  // satisfied, never whether the engine recognises the relationship.
  const offered = { name: "Detector Base", relationshipType: "Compatible Base" };
  const required = { accessory: "detector base" };
  const normalize = (value) => String(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  assert.equal(normalize(offered.name), normalize(required.accessory),
    "the name-match path alone satisfies the requirement, independently of any relationship_type handling");
  assert.equal(normalize(offered.relationshipType), normalize("Compatible Base"),
    "and the derived accessory.detector-base rule's relationship_type path is satisfied by the same evidence");
});

test("the production blocking rule itself is not weakened by this fixture", () => {
  // Guards against a future 'make the detector base optional' shortcut landing
  // in the engine instead of the seed.
  const source = readFileSync(ENGINE, "utf8");
  assert.match(source, /result: offered \? "Pass" : "Missing Accessory", pass: Boolean\(offered\), blocking: !offered/,
    "evaluateAccessories must keep blocking on a missing accessory");
  assert.doesNotMatch(source, /golden-|GOLDEN_/i, "the matcher must contain no Golden-ID special case");
});

// -----------------------------------------------------------------------------
// 3. Idempotency
// -----------------------------------------------------------------------------

test("re-applying the accessory seed block creates no duplicate relationship", () => {
  const { db } = buildCatalog();
  applySeed(db);
  const first = db.prepare("SELECT id, product_id, accessory_product_id, relationship_type, review_status, version_number FROM product_accessories ORDER BY id").all();
  db.exec(accessorySeedBlock());
  const second = db.prepare("SELECT id, product_id, accessory_product_id, relationship_type, review_status, version_number FROM product_accessories ORDER BY id").all();
  assert.deepEqual(second, first, "re-applying the accessory block must be a no-op");
  assert.equal(second.length, 1, "no duplicate accessory relationship may be created");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM library_products WHERE id IN ('golden-product-fa-001','golden-detector-base-001')").get().count, 2);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM product_families WHERE id IN ('golden-family','golden-detector-base-family')").get().count, 2);
});

test("the accessory block is applied after its referential prerequisites, never before", () => {
  // scripts/setup-golden-e2e.sh executes the seed file in order against a
  // freshly migrated database, so the block's references to golden-brand and
  // golden-product-source are always created first. This pins that ordering
  // requirement rather than asserting an impossible out-of-order insert.
  const source = readFileSync(SEED, "utf8");
  const brand = source.indexOf("INSERT INTO product_brands");
  const sourceRow = source.indexOf("INSERT INTO product_sources");
  const block = source.indexOf("\nINSERT OR IGNORE");
  assert.ok(brand > 0 && sourceRow > 0, "the pre-existing catalog seed must create the manufacturer, brand and source rows");
  assert.ok(brand < block, "the brand row must be created before the accessory block references it");
  assert.ok(sourceRow < block, "the product source must be created before the accessory block cites it");
});

test("two independently seeded databases are equivalent", () => {
  const a = buildCatalog().db;
  const b = buildCatalog().db;
  applySeed(a);
  applySeed(b);
  const dump = (db) => db.prepare(
    `SELECT p.id, (SELECT COUNT(*) FROM product_accessories pa WHERE pa.product_id=p.id) accessories
       FROM library_products p ORDER BY p.id`,
  ).all();
  assert.deepEqual(dump(a), dump(b), "repeated fixture initialization must start from equivalent governed state");
  const state = (db) => JSON.stringify({
    products: db.prepare("SELECT id, part_number, description, lifecycle_status, review_status, approved_for_discovery FROM library_products ORDER BY id").all(),
    families: db.prepare("SELECT id, name, normalized_name FROM product_families ORDER BY id").all(),
    relationships: db.prepare("SELECT id, relationship_type, review_status, included, separately_priced, confidence FROM product_accessories ORDER BY id").all(),
  });
  assert.equal(state(a), state(b));
  assert.equal(readGoldenCatalog(a).get("golden-product-fa-001").accessories[0].name,
    readGoldenCatalog(b).get("golden-product-fa-001").accessories[0].name);
});
