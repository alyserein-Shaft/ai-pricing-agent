// PL-REPAIR-3 — PRODUCT LIBRARY SEARCH NORMALIZATION tests.
//
// Proves the contract established by PL_REPAIR_3_SEARCH_NORMALIZATION_REPORT:
//
//   normalizeProductCodeSearchKey(input) = trim -> UPPERCASE -> remove
//   hyphens/slashes/underscores/whitespace. PERIODS ARE PRESERVED so REL-4.7K
//   (4.7 kΩ) and REL-47K (47 kΩ) can never collapse to one result.
//
//   The search path normalizes part_number / alias / original_order_code with
//   this code-aware key, keeps description and manufacturer as ordinary
//   case-insensitive text matches, and ranks literal exact > normalized exact
//   > normalized prefix > substring. Discovery and commercial state never
//   alter ordinary search results.
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { queryLibraryProducts } from "../worker/product-price-library-api.mjs";
import { normalizeProductCodeSearchKey, productCodeNormalizedSql, codeSearchStripCharacters } from "../worker/product-search-normalization.mjs";

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

// Faithful minimal library fixture: same tables the worker SQL touches, with
// the SAME recursive canonical_library_products view as the live D1 database
// so superseded requested rows resolve to their terminal canonical product.
const fixture = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE product_manufacturers (id TEXT PRIMARY KEY, name TEXT, normalized_name TEXT);
    CREATE TABLE product_brands (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE product_families (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE library_products (
      id TEXT PRIMARY KEY, manufacturer_id TEXT, brand_id TEXT, family_id TEXT,
      part_number TEXT, description TEXT, identity_status TEXT, lifecycle_status TEXT, review_status TEXT,
      approved_for_discovery INTEGER, attributes TEXT, standards TEXT, superseded_by_product_id TEXT
    );
    CREATE TABLE product_source_evidence (id TEXT PRIMARY KEY, product_id TEXT, source_id TEXT);
    CREATE TABLE product_aliases (product_id TEXT, alias TEXT, deleted_at TEXT);
    CREATE TABLE manufacturer_order_code_observations (canonical_product_id TEXT, original_order_code TEXT, status TEXT);
    CREATE TABLE product_lifecycle_events (product_id TEXT, lifecycle_status TEXT);
    CREATE TABLE price_records (
      id TEXT PRIMARY KEY, product_id TEXT, source_id TEXT, amount_minor INTEGER,
      currency TEXT, price_type TEXT, unit TEXT, effective_from TEXT, valid_until TEXT,
      validity_state TEXT, approval_status TEXT, downstream_use TEXT, source_location TEXT, created_at TEXT
    );
    CREATE VIEW canonical_library_products AS
      WITH RECURSIVE product_chain(requested_product_id,current_product_id,depth,path) AS (
        SELECT id,id,0,'|'||id||'|' FROM library_products
        UNION ALL
        SELECT chain.requested_product_id,p.superseded_by_product_id,chain.depth+1,chain.path||p.superseded_by_product_id||'|'
        FROM product_chain chain JOIN library_products p ON p.id=chain.current_product_id
        WHERE p.identity_status='Superseded' AND p.superseded_by_product_id IS NOT NULL
          AND chain.depth<32 AND instr(chain.path,'|'||p.superseded_by_product_id||'|')=0
      )
      SELECT chain.requested_product_id,p.* FROM product_chain chain JOIN library_products p ON p.id=chain.current_product_id
      WHERE p.identity_status<>'Superseded';
    INSERT INTO product_manufacturers VALUES ('mfr','Honeywell Fire','HONEYWELL FIRE');
    INSERT INTO product_manufacturers VALUES ('mfr-net','Cisco Systems','CISCO SYSTEMS');
  `);
  const insertProduct = db.prepare("INSERT INTO library_products VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const insertEvidence = db.prepare("INSERT INTO product_source_evidence VALUES (?,?,?)");
  const priceInsert = db.prepare("INSERT INTO price_records VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const insertPrice = (...values) => priceInsert.run(...values);
  const insertOne = (id, pn, { status = "Active", supersededBy = null, flag = 0, review = "Needs Review", mfr = "mfr", description = null } = {}) => {
    const row = [id, mfr, null, null, pn, description ?? `${pn} description`, status, "Active", review, flag, "[]", "[]", supersededBy];
    insertProduct.run(...row);
    insertEvidence.run(`evidence-${id}`, id, "source-a");
  };
  const alias = (productId, alias) => db.prepare("INSERT INTO product_aliases VALUES (?,?,NULL)").run(productId, alias);
  const orderCode = (canonicalProductId, originalOrderCode) => db.prepare("INSERT INTO manufacturer_order_code_observations VALUES (?,?,?)").run(canonicalProductId, originalOrderCode, "Active");
  return {
    db,
    d1: d1(db),
    raw: { insertOne, alias, orderCode, insertPrice },
    sqlite: db,
  };
};

test("contract helper — normalized key is deterministic, period-preserving, and strip set is explicit", () => {
  for (const variant of ["IFP-75HV", "ifp-75hv", "IFP75HV", "ifp75hv", "IFP 75 HV", "ifp 75 hv"]) {
    assert.equal(normalizeProductCodeSearchKey(variant), "IFP75HV");
  }
  // Periods are load-bearing: REL-4.7K and REL-47K never share a key.
  assert.equal(normalizeProductCodeSearchKey("REL-4.7K"), "REL4.7K");
  assert.equal(normalizeProductCodeSearchKey("REL-47K"), "REL47K");
  assert.notEqual(normalizeProductCodeSearchKey("REL-4.7K"), normalizeProductCodeSearchKey("REL-47K"));
  // Punctuation/whitespace-only inputs produce an empty key (never match-all).
  assert.equal(normalizeProductCodeSearchKey("---"), "");
  assert.equal(normalizeProductCodeSearchKey("   "), "");
  assert.deepEqual(codeSearchStripCharacters(), ["-", "/", "_", " "]);
  // SQL expression mirrors the JS helper for the same input.
  assert.equal(productCodeNormalizedSql("c.part_number"), "upper(replace(replace(replace(replace(trim(c.part_number),'-',''),'/',''),'_',''),' ',''))");
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE t (part_number TEXT); INSERT INTO t VALUES ('IFP-75HV');");
  assert.equal(db.prepare(`SELECT ${productCodeNormalizedSql("part_number")} v FROM t`).get().v, "IFP75HV");
  db.close();
});

test("M1-M5 — exact, lowercase, hyphenless, compact and space-separated forms all resolve the same canonical product", async () => {
  const f = fixture();
  f.raw.insertOne("ifp-a", "IFP-75HV", { review: "Reviewed" });
  f.raw.insertOne("ifp-b", "IFP-75HVB", { review: "Reviewed" });
  for (const query of ["IFP-75HV", "ifp-75hv", "IFP75HV", "ifp75hv", "IFP 75 HV"]) {
    const r = await queryLibraryProducts(f.d1, { query, pageSize: 50 });
    assert.ok(r.totalProducts >= 1, `query ${query} must return at least one product`);
    assert.equal(r.products[0].requestedPartNumber, "IFP-75HV", `query ${query} must rank the exact product first`);
    const found = r.products.find((p) => p.requestedPartNumber === "IFP-75HV");
    assert.ok(found, `query ${query} must contain IFP-75HV`);
    assert.equal(found.canonicalPartNumber, "IFP-75HV");
    assert.equal(found.resolvesToCanonical, false);
  }
});

test("M6 — normalized exact outranks normalized prefix and substring matches", async () => {
  const f = fixture();
  f.raw.insertOne("exact", "302-EPM-135", { review: "Reviewed" });
  f.raw.insertOne("prefix-neighbour", "302-EPM-1350", { review: "Reviewed" });
  const r = await queryLibraryProducts(f.d1, { query: "302EPM135", pageSize: 50 });
  assert.equal(r.products[0].requestedPartNumber, "302-EPM-135");
  const order = r.products.map((p) => p.requestedPartNumber);
  assert.ok(order.indexOf("302-EPM-135") < order.indexOf("302-EPM-1350"));
});

test("M7 — alias normalized matching is structurally valid on fixture rows", async () => {
  const f = fixture();
  f.raw.insertOne("prod", "IFP-1000", { review: "Reviewed" });
  f.raw.alias("prod", "IFP1000"); // compact alias, no punctuation in the raw alias
  f.raw.alias("prod", "IFP-1000-HV"); // punctuation variant alias
  const exact = await queryLibraryProducts(f.d1, { query: "IFP1000", pageSize: 50 });
  assert.ok(exact.products.some((p) => p.requestedPartNumber === "IFP-1000"));
  const variant = await queryLibraryProducts(f.d1, { query: "ifp1000hv", pageSize: 50 });
  assert.ok(variant.products.some((p) => p.requestedPartNumber === "IFP-1000"));
});

test("M8 — original order code normalized matching works on fixture observations", async () => {
  const f = fixture();
  // Part number does NOT normalize to the query — only the order-code
  // observation can satisfy "2151ch", so this genuinely exercises the branch.
  f.raw.insertOne("prod", "XFR-500", { review: "Reviewed" });
  f.raw.orderCode("prod", "2151 CH"); // space-separated original code from a customer PO
  const r = await queryLibraryProducts(f.d1, { query: "2151ch", pageSize: 50 });
  assert.ok(r.products.some((p) => p.requestedPartNumber === "XFR-500"));
});

test("M9/M10 — description and manufacturer search remain plain case-insensitive text matching", async () => {
  const f = fixture();
  f.raw.insertOne("fa-1", "FA-001", { review: "Reviewed", description: "Addressable smoke detector" });
  f.raw.insertOne("fa-2", "FA-002", { review: "Reviewed", description: "Duct smoke detector" });
  f.raw.insertOne("net-1", "AIR-DNA-A-3Y", { review: "Reviewed", mfr: "mfr-net", description: "Cisco DNA subscription" });
  const desc = await queryLibraryProducts(f.d1, { query: "smoke detector", pageSize: 50 });
  assert.equal(desc.totalProducts, 2);
  assert.ok(desc.products.every((p) => /smoke detector/i.test(p.description)));
  const mfr = await queryLibraryProducts(f.d1, { query: "cisco", pageSize: 50 });
  assert.ok(mfr.products.some((p) => p.manufacturer === "Cisco Systems"));
  assert.ok(!mfr.products.some((p) => p.manufacturer === "Honeywell Fire"));
});

test("M11 — no-results queries stay empty", async () => {
  const f = fixture();
  f.raw.insertOne("a", "AAA-1", { review: "Reviewed" });
  const r = await queryLibraryProducts(f.d1, { query: "ZZZ-NO-SUCH-PRODUCT", pageSize: 50 });
  assert.equal(r.totalProducts, 0);
  assert.equal(r.products.length, 0);
});

test("M12 — collision safety: REL-4.7K and REL-47K never cross-return (periods preserved)", async () => {
  const f = fixture();
  f.raw.insertOne("r47k", "REL-47K", { review: "Reviewed" });
  f.raw.insertOne("r47kbp", "REL-47K-BP", { review: "Reviewed" });
  f.raw.insertOne("r47", "REL-4.7K", { review: "Reviewed" });
  f.raw.insertOne("r47bp", "REL-4.7K-BP", { review: "Reviewed" });
  const a = await queryLibraryProducts(f.d1, { query: "REL-4.7K", pageSize: 50 });
  assert.ok(a.products.some((p) => p.requestedPartNumber === "REL-4.7K"));
  assert.ok(!a.products.some((p) => /^REL-?47K(-BP)?$/.test(p.requestedPartNumber)), `REL-4.7K search must not return ${a.products.map((p) => p.requestedPartNumber).join(",")}`);
  const b = await queryLibraryProducts(f.d1, { query: "rel47k", pageSize: 50 });
  assert.ok(b.products.some((p) => p.requestedPartNumber === "REL-47K"));
  assert.ok(!b.products.some((p) => p.requestedPartNumber === "REL-4.7K"), "compact 47K search must not return REL-4.7K");
});

test("M13 — active/superseded: a superseded punctuation variant resolves through canonical authority without changing identity", async () => {
  const f = fixture();
  f.raw.insertOne("canonical", "B501-BL", { review: "Reviewed", status: "Active" });
  f.raw.insertOne("dot", "B501-BL.", { review: "Reviewed", status: "Superseded", supersededBy: "canonical" });
  const dotted = await queryLibraryProducts(f.d1, { query: "B501-BL.", pageSize: 50 });
  const dotRow = dotted.products.find((p) => p.requestedPartNumber === "B501-BL.");
  assert.ok(dotRow, "searching the dotted superseded variant must find it");
  assert.equal(dotRow.canonicalPartNumber, "B501-BL", "superseded variant must resolve to the canonical part number");
  assert.equal(dotRow.requestedIdentityStatus, "Superseded", "the requested row remembers its own identity status");
  assert.equal(dotRow.canonicalProductId, "canonical", "both rows land on the same canonical product");
  const compact = await queryLibraryProducts(f.d1, { query: "b501bl", pageSize: 50 });
  const canonical = compact.products.find((p) => p.requestedPartNumber === "B501-BL");
  assert.ok(canonical, "compact search must find canonical");
  assert.equal(canonical.canonicalPartNumber, "B501-BL");
  assert.equal(canonical.requestedIdentityStatus, "Active");
  // The compact key matches the canonical product (and the superseded row via
  // its canonical side) but never invents a third distinct product.
  const distinctCanonical = new Set(compact.products.map((p) => p.canonicalProductId));
  assert.deepEqual([...distinctCanonical], ["canonical"]);
});

test("M14 — pagination remains correct with normalized search", async () => {
  const f = fixture();
  f.raw.insertOne("p1", "PART-001", { review: "Reviewed" });
  f.raw.insertOne("p2", "PART-002", { review: "Reviewed" });
  f.raw.insertOne("p3", "PART-003", { review: "Reviewed" });
  f.raw.insertOne("p4", "PART-004", { review: "Reviewed" });
  f.raw.insertOne("p5", "PART-005", { review: "Reviewed" });
  f.raw.insertOne("p6", "PART-006", { review: "Reviewed" });
  const page1 = await queryLibraryProducts(f.d1, { query: "part", page: 1, pageSize: 4 });
  const page2 = await queryLibraryProducts(f.d1, { query: "part", page: 2, pageSize: 4 });
  assert.equal(page1.totalProducts, 6);
  assert.equal(page1.products.length, 4);
  assert.equal(page2.products.length, 2);
  const ids1 = new Set(page1.products.map((p) => p.requestedProductId));
  assert.ok(page2.products.every((p) => !ids1.has(p.requestedProductId)), "no overlap across pages");
});

test("M15 — discovery flag does not alter ordinary Product Library search", async () => {
  const f = fixture();
  f.raw.insertOne("listed", "LISTED-1", { review: "Reviewed", flag: 1 });
  f.raw.insertOne("plain", "PLAIN-1", { review: "Needs Review", flag: 0 });
  const plain = await queryLibraryProducts(f.d1, { query: "plain", pageSize: 50 });
  assert.ok(plain.products.some((p) => p.requestedPartNumber === "PLAIN-1"), "flag=0 product is still findable in ordinary search");
  assert.equal(plain.products.find((p) => p.requestedPartNumber === "PLAIN-1").approvedForDiscovery, false);
  const listed = await queryLibraryProducts(f.d1, { query: "listed", pageSize: 50 });
  assert.ok(listed.products.some((p) => p.requestedPartNumber === "LISTED-1"));
  // The discovery browse keeps its own gate, independently.
  const browse = await queryLibraryProducts(f.d1, { query: "plain", discovery: true, pageSize: 50 });
  assert.equal(browse.totalProducts, 0);
});

test("M16 — commercial state does not affect search results", async () => {
  const f = fixture();
  f.raw.insertOne("with-price", "PRICED-1", { review: "Reviewed" });
  f.raw.insertOne("no-price", "UNPRICED-1", { review: "Reviewed" });
  f.raw.insertPrice("price-1", "with-price", "source-a", 1000, "USD", "List", "EA", null, "2099-12-31", "Current Approved", "Approved", "Costing", "{}", "2026-01-01");
  const withPrice = await queryLibraryProducts(f.d1, { query: "priced", pageSize: 50 });
  const noPrice = await queryLibraryProducts(f.d1, { query: "unpriced", pageSize: 50 });
  assert.ok(withPrice.products.some((p) => p.requestedPartNumber === "PRICED-1"));
  assert.ok(noPrice.products.some((p) => p.requestedPartNumber === "UNPRICED-1"));
  assert.equal(withPrice.products.find((p) => p.requestedPartNumber === "PRICED-1").priceEvidenceCount, 1);
  assert.equal(noPrice.products.find((p) => p.requestedPartNumber === "UNPRICED-1").priceEvidenceCount, 0);
});

test("Part L — search normalization stays scoped: only the Product Library search worker may import it, and identity/matching never reuse it", async () => {
  const workerDir = new URL("../worker/", import.meta.url);
  const files = (await readdir(workerDir)).filter((name) => name.endsWith(".mjs"));
  let importers = [];
  for (const name of files) {
    const source = await readFile(new URL(name, workerDir), "utf8");
    if (source.includes("product-search-normalization")) importers.push(name);
  }
  assert.deepEqual(importers.sort(), ["product-price-library-api.mjs"]);
  // Identity authority keeps its own stricter [^A-Z0-9] strip — and must not
  // adopt the period-preserving search key as identity.
  const identity = await readFile(new URL("../worker/product-identity-api.mjs", import.meta.url), "utf8");
  assert.match(identity, /replace\(\/\[\^A-Z0-9\]\+\/g,""\)/);
  assert.doesNotMatch(identity, /normalizeProductCodeSearchKey/);
  const matching = await readFile(new URL("../worker/product-matching-api.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(matching, /normalizeProductCodeSearchKey/);
  assert.doesNotMatch(matching, /product-search-normalization/);
});