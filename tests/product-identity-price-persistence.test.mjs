import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("product identity persistence preserves source price type and repairs existing rows", async () => {
  const source = await readFile(
    new URL("../worker/product-identity-api.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /price\.priceType/);
  assert.match(
    source,
    /ON CONFLICT\(product_identity_id,knowledge_fact_id\) DO UPDATE/,
  );
  assert.match(source, /price_type=excluded\.price_type/);
  assert.match(source, /costing_eligible=0/);
  assert.doesNotMatch(
    source,
    /price\.validity,"Historical Catalogue Price"/,
  );
});
