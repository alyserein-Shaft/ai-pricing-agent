import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

// product_compatibility Disposition (2026-08-31, see
// docs/product-compatibility-disposition.md): zero real rows, no write path
// anywhere, and two existing ingestion test suites already assert against
// writing to it. Real compatibility is governed by engineering_relationships.
// Confirmed decision: DEPRECATE the always-empty UI surface, keep the
// schema/API/tests intact.

test("the always-empty Compatibility count is removed from the Product Library detail panel", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");
  assert.doesNotMatch(
    page,
    /selectedLibraryProduct\.compatibility/,
    "product_compatibility's always-zero count must no longer be displayed as if it were real product state",
  );
  // Attributes/Certifications/Accessories are real, populated fields and must remain untouched
  for (const field of ["attributes", "certifications", "accessories", "documents"]) {
    assert.match(page, new RegExp(`selectedLibraryProduct\\.${field}`));
  }
});

test("nothing was deleted -- the product_compatibility read API and schema remain fully intact", async () => {
  const [api, schema] = await Promise.all([
    readFile(new URL("worker/product-price-library-api.mjs", root), "utf8"),
    readFile(new URL("db/schema.ts", root), "utf8"),
  ]);
  assert.match(api, /SELECT \* FROM product_compatibility WHERE source_product_id=\?/);
  assert.match(api, /compatibility: \["product_compatibility", "source_product_id"\]/);
  assert.match(schema, /export const productCompatibility = sqliteTable\("product_compatibility"/);
});

test("no write path to product_compatibility exists anywhere in the app", async () => {
  const [schema, api] = await Promise.all([
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("worker/product-price-library-api.mjs", root), "utf8"),
  ]);
  assert.doesNotMatch(schema, /INSERT INTO product_compatibility/);
  assert.doesNotMatch(api, /INSERT INTO product_compatibility|UPDATE product_compatibility/);
});

test("deprecation notices are present and point to the durable decision record", async () => {
  const [schema, api] = await Promise.all([
    readFile(new URL("db/schema.ts", root), "utf8"),
    readFile(new URL("worker/product-price-library-api.mjs", root), "utf8"),
  ]);
  const flatten = (source) => source.split("\n").map((line) => line.trim().replace(/^\/\/\s?/, "")).join(" ").replace(/\s+/g, " ");
  const flatSchema = flatten(schema);
  assert.match(flatSchema, /DEPRECATED/);
  assert.match(flatSchema, /docs\/product-compatibility-disposition\.md/);
  assert.match(flatSchema, /engineering_relationships/);
  assert.match(api, /docs\/product-compatibility-disposition\.md/);
});

test("the disposition decision is recorded durably", async () => {
  const doc = await readFile(new URL("docs/product-compatibility-disposition.md", root), "utf8");
  assert.match(doc, /DEPRECATE/);
  assert.match(doc, /Nothing was deleted/);
  assert.match(doc, /engineering_relationships/);
});
