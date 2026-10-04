// PL-REPAIR-2 — DISCOVERY SEMANTICS CONTRACT tests.
//
// Proves the contract established by PL_REPAIR_2_DISCOVERY_SEMANTICS_CONTRACT_REPORT:
//
//   DISCOVERY_READY  = review_status='Reviewed' AND approved_for_discovery=1
//                      (canonical product listed in the reviewed Discovery
//                      index browse — the ONLY consumer is the `discovery=true`
//                      product list filter; the flag is written only by the
//                      governed approve-discovery route or the deterministic
//                      auto-approve policy, never by ingestion/promotion).
//
//   MATCH_READY      = CANONICAL_DISCOVERY_PRODUCT_PREDICATE
//                      (canonical identity + Active + not Rejected + source
//                      evidence) — deliberately independent of DISCOVERY_READY.
//
//   COMMERCIAL_READY = per price_records row: approval_status='Approved' AND
//                      downstream_use='Costing' AND current explicit valid_until
//                      — an independent axis from both flags above.
//
// The two predicates must never converge: gating Technical Matching on the
// business-review flag must not silently convert ~930 technically usable
// products into 8 discovery-listed products.
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { queryLibraryProducts } from "../worker/product-price-library-api.mjs";
import { CANONICAL_DISCOVERY_PRODUCT_PREDICATE, DISCOVERY_READY_PRODUCT_PREDICATE } from "../worker/canonical-product-authority.mjs";

const d1 = (database) => ({
  prepare(sql) {
    const statement = database.prepare(sql);
    return {
      bind(...values) {
        return {
          first: async () => statement.get(...values),
          all: async () => ({ results: statement.all(...values) }),
        };
      },
      first: async () => statement.get(),
      all: async () => ({ results: statement.all() }),
    };
  },
});

const fixture = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE product_manufacturers (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE product_brands (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE product_families (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE library_products (
      id TEXT PRIMARY KEY, requested_product_id TEXT, manufacturer_id TEXT, brand_id TEXT, family_id TEXT,
      part_number TEXT, description TEXT, identity_status TEXT, lifecycle_status TEXT, review_status TEXT,
      approved_for_discovery INTEGER, attributes TEXT, standards TEXT
    );
    CREATE TABLE canonical_library_products AS SELECT * FROM library_products;
    CREATE TABLE product_source_evidence (id TEXT PRIMARY KEY, product_id TEXT, source_id TEXT);
    CREATE TABLE product_aliases (product_id TEXT, alias TEXT, deleted_at TEXT);
    CREATE TABLE manufacturer_order_code_observations (canonical_product_id TEXT, original_order_code TEXT, status TEXT);
    CREATE TABLE price_records (
      id TEXT PRIMARY KEY, product_id TEXT, source_id TEXT, amount_minor INTEGER,
      currency TEXT, price_type TEXT, unit TEXT, effective_from TEXT, valid_until TEXT,
      validity_state TEXT, approval_status TEXT, downstream_use TEXT, source_location TEXT, created_at TEXT
    );
    CREATE TABLE product_lifecycle_events (product_id TEXT, lifecycle_status TEXT);
    INSERT INTO product_manufacturers VALUES ('manufacturer','Manufacturer');
  `);
  const insertProduct = db.prepare("INSERT INTO library_products VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const insertCanonical = db.prepare("INSERT INTO canonical_library_products VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const insertEvidence = db.prepare("INSERT INTO product_source_evidence VALUES (?,?,?)");
  const insertPrice = db.prepare("INSERT INTO price_records VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const insertOne = (id, pn, flag, review) => {
    const row = [id, id, "manufacturer", null, null, pn, `${pn} description`, "Active", "Active", review, flag, "[]", "[]"];
    insertProduct.run(...row);
    insertCanonical.run(...row);
    insertEvidence.run(`evidence-${id}`, id, "source-591");
  };
  return {
    db,
    d1: d1(db),
    raw: {
      insertPrice: (...values) => insertPrice.run(...values),
      insertOne,
    },
  };
};

test("J1/J2 -- MATCH_READY predicate never includes the DISCOVERY_READY business-review flag, and flag=false implies no technical invalidity", async () => {
  const f = fixture();
  // Discovery-approved (listed) product + technically matchable but NOT
  // discovery-listed product + a Rejected product (the one identity-integrity
  // signal that DOES still exclude from matching).
  f.raw.insertOne("product-listed", "LISTED-1", 1, "Reviewed");
  f.raw.insertOne("product-plain", "PLAIN-1", 0, "Needs Review");
  f.raw.insertOne("product-rejected", "REJECTED-1", 0, "Rejected");

  // The two contract predicates are distinct strings.
  assert.match(CANONICAL_DISCOVERY_PRODUCT_PREDICATE, /identity_status='Active'/);
  assert.match(CANONICAL_DISCOVERY_PRODUCT_PREDICATE, /product_source_evidence/);
  assert.doesNotMatch(CANONICAL_DISCOVERY_PRODUCT_PREDICATE, /approved_for_discovery/);
  assert.doesNotMatch(CANONICAL_DISCOVERY_PRODUCT_PREDICATE, /review_status='Reviewed'/);
  assert.match(DISCOVERY_READY_PRODUCT_PREDICATE, /approved_for_discovery=1/);
  assert.notEqual(CANONICAL_DISCOVERY_PRODUCT_PREDICATE, DISCOVERY_READY_PRODUCT_PREDICATE);

  // Behaviorally: evaluating MATCH_READY against the fixture yields the plain
  // (flag=0) product and the listed product, but never the Rejected one —
  // approved_for_discovery=false does NOT make a product technically invalid.
  const matchable = f.db.prepare(
    `SELECT id FROM library_products p WHERE ${CANONICAL_DISCOVERY_PRODUCT_PREDICATE} ORDER BY id`,
  ).all().map((row) => row.id);
  assert.deepEqual(matchable, ["product-listed", "product-plain"]);
  const ready = f.db.prepare(
    `SELECT id FROM canonical_library_products c WHERE c.${DISCOVERY_READY_PRODUCT_PREDICATE} ORDER BY id`,
  ).all().map((row) => row.id);
  assert.deepEqual(ready, ["product-listed"]);
});

test("J3/J4/J5 -- the discovery browse respects approved_for_discovery; the default list does not", async () => {
  const f = fixture();
  f.raw.insertOne("product-listed", "LISTED-1", 1, "Reviewed");
  f.raw.insertOne("product-plain", "PLAIN-1", 0, "Needs Review");

  const discoveryOnly = await queryLibraryProducts(f.d1, { discovery: true, pageSize: 200 });
  const defaultList = await queryLibraryProducts(f.d1, { discovery: false, pageSize: 200 });

  // J3: with discovery=true the flag is the governing gate.
  assert.deepEqual(discoveryOnly.products.map((p) => p.requestedProductId), ["product-listed"]);
  // J4: the discovery-approved product is present and reported as approved.
  assert.equal(discoveryOnly.products[0].approvedForDiscovery, true);
  // J5: the discovery-unapproved product is excluded from the discovery browse
  // but fully present in the default (Technical Matching-era) list.
  assert.deepEqual(defaultList.products.map((p) => p.requestedProductId).sort(), ["product-listed", "product-plain"]);
  assert.equal(defaultList.products.find((p) => p.requestedProductId === "product-plain").approvedForDiscovery, false);
});

test("J6 -- commercial approval is an independent axis from Discovery: a discovery-unapproved product can still be costing-eligible", async () => {
  const f = fixture();
  f.raw.insertOne("product-listed", "LISTED-1", 1, "Reviewed");
  f.raw.insertOne("product-plain", "PLAIN-1", 0, "Needs Review");
  // product-plain carries the ONLY approved, current, explicitly Costing price.
  f.raw.insertPrice("price-cost", "product-plain", "source-591", 1234, "USD", "List", "each", "2026-01-01", "2030-01-01", "Current Approved", "Approved", "Costing", "{}", "2026-01-01");

  const discoveryOnly = await queryLibraryProducts(f.d1, { discovery: true, pageSize: 200 });
  const defaultList = await queryLibraryProducts(f.d1, { discovery: false, pageSize: 200 });

  // The costing-eligible product is NOT in the discovery browse…
  assert.ok(!discoveryOnly.products.some((p) => p.requestedProductId === "product-plain"));
  // …but is costable in the default list while remaining discovery-unlisted.
  const plain = defaultList.products.find((p) => p.requestedProductId === "product-plain");
  assert.equal(plain.approvedForDiscovery, false);
  assert.equal(plain.priceEvidenceCount, 1);
  assert.equal(plain.costingEligiblePrices, 1);
  // And the discovery-listed product has no commercial approval just from being listed.
  const listed = defaultList.products.find((p) => p.requestedProductId === "product-listed");
  assert.equal(listed.approvedForDiscovery, true);
  assert.equal(listed.priceEvidenceCount, 0);
  assert.equal(listed.costingEligiblePrices, 0);
});

test("J1/J2 regression -- the running matching, supplier-intake and knowledge surfaces never read the flag", async () => {
  const [matching, supplierIntake, knowledgeRepair] = await Promise.all([
    readFile(new URL("../worker/product-matching-api.mjs", import.meta.url), "utf8"),
    readFile(new URL("../worker/supplier-price-intake-api.mjs", import.meta.url), "utf8"),
    readFile(new URL("../worker/knowledge-product-repair.mjs", import.meta.url), "utf8"),
  ]);
  // Technical matching uses only CANONICAL_DISCOVERY_PRODUCT_PREDICATE — the
  // business-review flag must never appear in the matching engine.
  assert.match(matching, /CANONICAL_DISCOVERY_PRODUCT_PREDICATE/);
  assert.doesNotMatch(matching, /approved_for_discovery/);
  // Supplier candidate discovery is also flag-independent (see
  // tests/supplier-price-intake-db.test.mjs which asserts the same behavior).
  assert.match(supplierIntake, /canonicalSupplierProductCandidates/);
  assert.doesNotMatch(supplierIntake, /approved_for_discovery/);
  // Knowledge repair only ever reports the flag as false (no discovery
  // approval is ever granted by a knowledge repair) — never reads it as a gate.
  assert.match(knowledgeRepair, /approvedForDiscovery:\s*false/);
  assert.doesNotMatch(knowledgeRepair, /approved_for_discovery\s*=\s*1/);
  assert.doesNotMatch(knowledgeRepair, /approved_for_discovery\s*=\s*0/);
});

test("J7 -- the flag consumer map is closed: only the five governed worker files may mention approved_for_discovery", async () => {
  const workerDir = new URL("../worker/", import.meta.url);
  const allowedConsumers = new Set([
    "canonical-product-authority.mjs", // contract predicate definition
    "product-identity-api.mjs", // promotion writes 0 + safety reports false
    "product-price-library-api.mjs", // discovery browse filter + label mapping + approve-discovery write
    "product-auto-review.mjs", // deterministic auto-approve write path (requires Reviewed)
    "knowledge-product-repair.mjs", // safety report false only — never a gate
  ]);
  const files = (await readdir(workerDir)).filter((name) => name.endsWith(".mjs"));
  assert.ok(files.length > 10, `expected a real worker directory, got ${files.length} files`);
  let scanned = 0;
  for (const name of files) {
    const source = await readFile(new URL(name, workerDir), "utf8");
    // knowledge-product-repair.mjs writes the flag only as a camelCase safety
    // payload (approvedForDiscovery:false), never as the snake_case column, so
    // it is legitimately absent from this scan; it stays in the allowlist so a
    // future snake_case use of the flag would fail this guard.
    if (!source.includes("approved_for_discovery")) continue;
    scanned += 1;
    assert.ok(
      allowedConsumers.has(name),
      `${name} must not read/write approved_for_discovery (consumer map violated)`,
    );
  }
  assert.ok(scanned >= 4, `expected at least the four governed worker files to mention the column, scanned ${scanned}`);
});

test("Part G -- product-row wording states listing state without implying use is prohibited, and stays orthogonal to Commercial", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /"Discovery listing: Approved"/);
  assert.match(page, /"Discovery listing: Not approved"/);
  // The two falsehoods are gone from the product row…
  assert.doesNotMatch(page, /Permitted use: Product discovery/);
  assert.doesNotMatch(page, /Permitted use: Not approved for discovery/);
  // …and the discovery-listing line and the Commercial line render from
  // independent fields in the same row (approvedForDiscovery vs
  // costingEligiblePrices), so a discovery-unlisted product can still be shown
  // as costing-eligible.
  assert.match(page, /product\.approvedForDiscovery\s*\n\s*\? "Discovery listing: Approved"/);
  assert.match(page, /product\.costingEligiblePrices > 0\s*\n\s*\? "Commercial: Costing eligible"/);
});