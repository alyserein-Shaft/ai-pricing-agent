import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { queryLibraryProducts, visibleLibrarySource } from "../worker/product-price-library-api.mjs";

const d1 = (database) => ({
  prepare(sql) {
    return {
      bind(...values) {
        const statement = database.prepare(sql);
        return {
          first: async () => statement.get(...values),
          all: async () => ({ results: statement.all(...values) }),
        };
      },
    };
  },
});

const fixture = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, owner_user_id TEXT);
    CREATE TABLE product_sources (id TEXT PRIMARY KEY, scope_type TEXT, project_id TEXT);
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
    CREATE TABLE product_lifecycle_events (product_id TEXT, lifecycle_status TEXT);
    INSERT INTO projects VALUES ('project-a','user-a'),('project-b','user-b');
    INSERT INTO product_sources VALUES ('source-591','Global',NULL),('source-other','Global',NULL),('source-private','Project','project-b');
    INSERT INTO product_manufacturers VALUES ('manufacturer','Manufacturer');
  `);
  const insertProduct = db.prepare("INSERT INTO library_products VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const insertCanonical = db.prepare("INSERT INTO canonical_library_products VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const insertEvidence = db.prepare("INSERT INTO product_source_evidence VALUES (?,?,?)");
  for (let index = 1; index <= 591; index += 1) {
    const id = `product-${index}`;
    const row = [id, id, "manufacturer", null, null, `PART-${String(index).padStart(3, "0")}`, `Scoped product ${index}`, "Active", "Unknown — Review Required", "Needs Review", 0, "[]", "[]"];
    insertProduct.run(...row);
    insertCanonical.run(...row);
    insertEvidence.run(`evidence-${index}`, id, "source-591");
  }
  insertEvidence.run("duplicate-evidence", "product-1", "source-591");
  const unrelated = ["unrelated", "unrelated", "manufacturer", null, null, "OTHER-1", "Unrelated global product", "Active", "Active", "Reviewed", 1, "[]", "[]"];
  insertProduct.run(...unrelated);
  insertCanonical.run(...unrelated);
  insertEvidence.run("evidence-other", "unrelated", "source-other");
  return { sqlite: db, db: d1(db) };
};

test("source scope excludes unrelated products, de-duplicates evidence, and reports all 591 source-linked identities", async () => {
  const { db } = fixture();
  const first = await queryLibraryProducts(db, { sourceId: "source-591", page: 1, pageSize: 200 });
  assert.equal(first.totalProducts, 591);
  assert.equal(first.totalPages, 3);
  assert.equal(first.products.length, 200);
  assert.equal(new Set(first.products.map((product) => product.requestedProductId)).size, 200);
  assert.ok(first.products.every((product) => product.requestedPartNumber.startsWith("PART-")));
});

test("search and pagination remain source scoped while no-source browsing stays compatible", async () => {
  const { db } = fixture();
  const scoped = await queryLibraryProducts(db, { sourceId: "source-591", query: "PART-591", page: 1, pageSize: 50 });
  assert.equal(scoped.totalProducts, 1);
  assert.equal(scoped.products[0].requestedPartNumber, "PART-591");
  const pageThree = await queryLibraryProducts(db, { sourceId: "source-591", page: 3, pageSize: 200 });
  assert.equal(pageThree.products.length, 191);
  const global = await queryLibraryProducts(db, { page: 1, pageSize: 200 });
  assert.equal(global.totalProducts, 592);
  assert.ok(global.products.some((product) => product.requestedPartNumber === "OTHER-1"));
});

test("invalid or inaccessible project source fails closed", async () => {
  const { db } = fixture();
  assert.equal(await visibleLibrarySource(db, { sourceId: "missing", userId: "user-a" }), null);
  assert.equal(await visibleLibrarySource(db, { sourceId: "source-private", projectId: "project-a", userId: "user-a" }), null);
  assert.equal(await visibleLibrarySource(db, { sourceId: "source-private", projectId: "project-b", userId: "user-a" }), null);
  assert.equal((await visibleLibrarySource(db, { sourceId: "source-private", projectId: "project-b", userId: "user-b" }))?.id, "source-private");
});
