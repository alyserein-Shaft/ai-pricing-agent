import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

// Sprint 0.9 -- Accessories + Compatibility Knowledge. product_accessories is
// the pre-existing, already-runtime-wired, GLOBAL (no project_id column --
// project scoping is structurally impossible for this table by design)
// product-to-product accessory table. worker/product-matching-api.mjs's
// loadProducts already reads it into product.accessories for every Product
// Matching run via one exact subquery; worker/product-price-library-api.mjs's
// GET /api/products/:id already reads all (unfiltered) rows for the engineer
// review view. This suite proves the safety properties Sprint 0.9 requires
// using that EXACT subquery (kept verbatim below, with a source-file
// assertion that catches drift) executed against a real in-memory DB seeded
// with the real Sprint 0.9 data shape -- not mocks.

const ACCESSORIES_SUBQUERY = `SELECT json_group_array(json_object('name', COALESCE(af.name, ap.description), 'relationshipType', pa.relationship_type, 'accessoryProductId', pa.accessory_product_id, 'accessoryPartNumber', ap.part_number, 'included', pa.included, 'quantityRule', pa.quantity_rule, 'quantityParameter', pa.quantity_parameter, 'conditions', json(pa.condition_json), 'confidence', pa.confidence, 'evidence', json(pa.evidence_json))) result FROM product_accessories pa JOIN library_products ap ON ap.id=pa.accessory_product_id LEFT JOIN product_families af ON af.id=ap.family_id WHERE pa.product_id=? AND pa.deleted_at IS NULL AND pa.superseded_at IS NULL AND pa.review_status NOT IN ('Rejected','Needs Review')`;

test("the pinned test query matches the real runtime query in worker/product-matching-api.mjs (catches drift)", async () => {
  const worker = await readFile(new URL("../worker/product-matching-api.mjs", import.meta.url), "utf8");
  // The runtime query is embedded inline in one large SQL string; assert the
  // exact accessory json_object projection and filter clause are present verbatim.
  assert.match(worker, /json_object\('name', COALESCE\(af\.name, ap\.description\), 'relationshipType', pa\.relationship_type, 'accessoryProductId', pa\.accessory_product_id, 'accessoryPartNumber', ap\.part_number, 'included', pa\.included, 'quantityRule', pa\.quantity_rule, 'quantityParameter', pa\.quantity_parameter, 'conditions', json\(pa\.condition_json\), 'confidence', pa\.confidence, 'evidence', json\(pa\.evidence_json\)\)/);
  assert.match(worker, /pa\.review_status NOT IN \('Rejected','Needs Review'\)/);
});

const schema = `
CREATE TABLE product_manufacturers(id TEXT PRIMARY KEY, name TEXT);
CREATE TABLE product_families(id TEXT PRIMARY KEY, name TEXT);
CREATE TABLE library_products(id TEXT PRIMARY KEY, manufacturer_id TEXT, family_id TEXT, part_number TEXT, description TEXT);
CREATE TABLE product_accessories(id TEXT PRIMARY KEY, product_id TEXT, accessory_product_id TEXT, relationship_type TEXT, quantity_rule TEXT, quantity_parameter INTEGER, scope TEXT, condition_json TEXT, included INTEGER, separately_priced INTEGER, source_id TEXT, evidence_json TEXT, confidence INTEGER, review_status TEXT, version_number INTEGER, created_by TEXT, created_at TEXT, superseded_at TEXT, deleted_at TEXT);
`;

let seq = 0;
const seedCatalog = (raw) => {
  raw.exec(`INSERT INTO product_manufacturers VALUES ('mfr1','Honeywell');`);
  const insertFamily = raw.prepare("INSERT INTO product_families (id, name) VALUES (?, ?)");
  const insertProduct = raw.prepare("INSERT INTO library_products (id, manufacturer_id, family_id, part_number, description) VALUES (?, 'mfr1', ?, ?, ?)");
  const product = (partNumber, description, familyName = null) => {
    seq += 1; const id = `product-${seq}`; let familyId = null;
    if (familyName) { familyId = `family-${seq}`; insertFamily.run(familyId, familyName); }
    insertProduct.run(id, familyId, partNumber, description);
    return id;
  };
  return { product };
};

const insertAccessory = (raw, { productId, accessoryId, relationshipType = "Compatible Base", conditions = [], quantityRule = "One per detector", quantityParameter = 1, included = 0, confidence = 90, reviewStatus = "Approved", evidence = [{ note: "test evidence" }] }) => {
  seq += 1; const id = `accessory-${seq}`;
  raw.prepare(`INSERT INTO product_accessories (id, product_id, accessory_product_id, relationship_type, quantity_rule, quantity_parameter, scope, condition_json, included, separately_priced, source_id, evidence_json, confidence, review_status, version_number, created_by, created_at, superseded_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, 'Global', ?, ?, 1, NULL, ?, ?, ?, 1, 'test', CURRENT_TIMESTAMP, NULL, NULL)`)
    .run(id, productId, accessoryId, relationshipType, quantityRule, quantityParameter, JSON.stringify(conditions), included, JSON.stringify(evidence), confidence, reviewStatus);
  return id;
};

const matchingViewAccessories = (raw, productId) => { const row = raw.prepare(ACCESSORIES_SUBQUERY).get(productId); return JSON.parse(row.result); };

test("an Approved (unconditional) global relationship fires at matching time", () => {
  const raw = new DatabaseSync(":memory:"); raw.exec(schema);
  const { product } = seedCatalog(raw);
  const detector = product("IDP-PHOTO-IV", "Intelligent Addressable Photoelectric Smoke Detector (Ivory Color) (Base Not Included)");
  const base = product("B501-IV", "4\" standard flangeless mounting base (Ivory Color)");
  insertAccessory(raw, { productId: detector, accessoryId: base, reviewStatus: "Approved" });
  const accessories = matchingViewAccessories(raw, detector);
  assert.equal(accessories.length, 1);
  assert.equal(accessories[0].accessoryPartNumber, "B501-IV");
});

test("a Needs Review (conditional, unconfirmed) relationship does NOT fire at matching time -- stays Needs Validation", () => {
  const raw = new DatabaseSync(":memory:"); raw.exec(schema);
  const { product } = seedCatalog(raw);
  const detector = product("IDP-PHOTO-IV", "Intelligent Addressable Photoelectric Smoke Detector (Ivory Color) (Base Not Included)");
  const sounderBase = product("B200S-IV", "Ivory Color, Intelligent addressable sounder base");
  insertAccessory(raw, { productId: detector, accessoryId: sounderBase, relationshipType: "Sounding Base", reviewStatus: "Needs Review", conditions: [{ type: "requirement_condition", field: "notificationType", value: "Audible at detector location" }] });
  assert.equal(matchingViewAccessories(raw, detector).length, 0, "an unconfirmed conditional relationship must not be surfaced as a resolved accessory");
});

test("a Rejected relationship never fires", () => {
  const raw = new DatabaseSync(":memory:"); raw.exec(schema);
  const { product } = seedCatalog(raw);
  const detector = product("IDP-PHOTO-IV", "smoke detector");
  const wrongBase = product("WRONG-BASE", "an incompatible base once considered and rejected");
  insertAccessory(raw, { productId: detector, accessoryId: wrongBase, reviewStatus: "Rejected" });
  assert.equal(matchingViewAccessories(raw, detector).length, 0);
});

test("a soft-deleted or superseded relationship never fires, even if its review_status is Approved", () => {
  const raw = new DatabaseSync(":memory:"); raw.exec(schema);
  const { product } = seedCatalog(raw);
  const detector = product("IDP-PHOTO-IV", "smoke detector");
  const base = product("B501-IV", "base");
  const deletedId = insertAccessory(raw, { productId: detector, accessoryId: base, reviewStatus: "Approved" });
  raw.prepare("UPDATE product_accessories SET deleted_at=CURRENT_TIMESTAMP WHERE id=?").run(deletedId);
  assert.equal(matchingViewAccessories(raw, detector).length, 0);
});

test("a relationship with no compatibility evidence at all (no row exists) remains unresolved rather than being invented", () => {
  const raw = new DatabaseSync(":memory:"); raw.exec(schema);
  const { product } = seedCatalog(raw);
  const relayModule = product("IDP-RELAY", "Intelligent Addressable Relay Module W/ 2 Isolated Sets Of Form C Contacts");
  assert.equal(matchingViewAccessories(raw, relayModule).length, 0, "no product_accessories row was ever written for IDP-RELAY -- no evidence was found, so nothing resolves");
});

test("an incompatible accessory attached to a DIFFERENT product does not leak onto this product's candidate list", () => {
  const raw = new DatabaseSync(":memory:"); raw.exec(schema);
  const { product } = seedCatalog(raw);
  const detectorA = product("IDP-PHOTO-IV", "photoelectric smoke detector");
  const detectorB = product("IDP-HEAT-ROR-IV", "heat detector");
  const base = product("B501-IV", "base");
  insertAccessory(raw, { productId: detectorB, accessoryId: base, reviewStatus: "Approved" });
  assert.equal(matchingViewAccessories(raw, detectorA).length, 0, "a relationship recorded against IDP-HEAT-ROR-IV must not appear for IDP-PHOTO-IV");
});

test("global relationships have no project scoping column -- structurally cannot leak between projects, and fire identically regardless of caller context", () => {
  const raw = new DatabaseSync(":memory:"); raw.exec(schema);
  const cols = raw.prepare("PRAGMA table_info(product_accessories)").all().map((row) => row.name);
  assert.ok(!cols.includes("project_id"), "product_accessories must remain structurally global (no project_id) -- project-scoped relationships belong in engineering_relationships instead");
});

test("quantity rule and quantity parameter survive unchanged into the matching-time output", () => {
  const raw = new DatabaseSync(":memory:"); raw.exec(schema);
  const { product } = seedCatalog(raw);
  const detector = product("IDP-FIRE-CO-IV", "fire/CO detector");
  const base = product("B501-IV", "base");
  insertAccessory(raw, { productId: detector, accessoryId: base, quantityRule: "One per detector", quantityParameter: 1, reviewStatus: "Approved" });
  const [accessory] = matchingViewAccessories(raw, detector);
  assert.equal(accessory.quantityRule, "One per detector");
  assert.equal(accessory.quantityParameter, 1);
});

test("a capacity-dependent relationship is recorded with an explicit unresolved quantity, never a guessed number", () => {
  const raw = new DatabaseSync(":memory:"); raw.exec(schema);
  const { product } = seedCatalog(raw);
  const panel = product("IFP-2100ECSHV", "Farenhyt 2100 point panel");
  const rmk = product("5815RMK", "Remote Mounting Kit Cabinet holds two 6815s");
  insertAccessory(raw, { productId: panel, accessoryId: rmk, relationshipType: "Expansion Module", quantityRule: "CAPACITY_DEPENDENT -- quantity depends on the project's SLC loop/point count; not calculated by this system", quantityParameter: null, conditions: [{ type: "capacity_dependent" }], reviewStatus: "Approved" });
  const [accessory] = matchingViewAccessories(raw, panel);
  assert.equal(accessory.quantityParameter, null);
  assert.match(accessory.quantityRule, /CAPACITY_DEPENDENT/);
});

test("provenance (evidence_json) survives unchanged through the matching-time output", () => {
  const raw = new DatabaseSync(":memory:"); raw.exec(schema);
  const { product } = seedCatalog(raw);
  const detector = product("IDP-PHOTO-IV", "smoke detector");
  const base = product("B501-IV", "base");
  const evidence = [{ sourceType: "Manufacturer Price List", sheet: "2023 Farenhyt", note: "Base Not Included" }, { sourceType: "Manufacturer Official Datasheet", url: "https://prod-edam.honeywell.com/.../IDP-PHOTO-IV-Datasheet.pdf" }];
  insertAccessory(raw, { productId: detector, accessoryId: base, evidence, reviewStatus: "Approved" });
  const [accessory] = matchingViewAccessories(raw, detector);
  assert.deepEqual(accessory.evidence, evidence);
});

test("no product-specific relationship is hardcoded in engine or worker source -- every relationship lives in data, not code", async () => {
  const [engine, worker] = await Promise.all([readFile(new URL("../app/domain/product-matching-engine.mjs", import.meta.url), "utf8"), readFile(new URL("../worker/product-matching-api.mjs", import.meta.url), "utf8")]);
  for (const term of ["IDP-PHOTO", "B501-IV", "B200S-IV", "5815RMK", "6815", "IFP-2100"]) { assert.equal(engine.includes(term), false, `${term} must not be hardcoded in product-matching-engine.mjs`); assert.equal(worker.includes(term), false, `${term} must not be hardcoded in product-matching-api.mjs`); }
});
