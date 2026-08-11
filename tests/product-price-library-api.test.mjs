import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { handleProductPriceLibraryApi } from "../worker/product-price-library-api.mjs";

test("library API fails closed when the server single-user context is unavailable", async () => {
  const response = await handleProductPriceLibraryApi(new Request("https://local/api/library/products"), { DB: {}, IDENTITY_AUTH_MODE: "sites" });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "APPLICATION_CONTEXT_UNAVAILABLE");
});

test("client-controlled identity and role headers cannot replace missing server context", async () => {
  const request = new Request("https://local/api/library/document-versions/v1/ingest", { method: "POST", headers: { "x-user-id": "u1", "x-user-role": "Estimator" } });
  const response = await handleProductPriceLibraryApi(request, { DB: {}, IDENTITY_AUTH_MODE: "sites" });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "APPLICATION_CONTEXT_UNAVAILABLE");
});

test("Task 9 schema separates products, sources, lifecycle and prices", async () => {
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  for (const table of ["product_sources", "library_products", "product_source_evidence", "product_lifecycle_events", "suppliers", "price_records", "product_library_decisions"]) assert.match(schema, new RegExp(`sqliteTable\\(\"${table}\"`));
  assert.match(schema, /approvedForDiscovery/);
  assert.match(schema, /validUntil/);
  assert.match(schema, /downstreamUse/);
});

test("API exposes explicit safety gates rather than product matching", async () => {
  const source = await readFile(new URL("../worker/product-price-library-api.mjs", import.meta.url), "utf8");
  assert.match(source, /matchingPerformed: false/);
  assert.match(source, /PRICE_VALIDITY_REQUIRED/);
  assert.match(source, /approval_status === "Approved"/);
  assert.match(source, /downstream_use === "Costing"/);
});
