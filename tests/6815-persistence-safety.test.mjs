import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("6815 uses generic reviewed persistence without auto-governing family or compatibility", async () => {
  const source = await readFile(
    new URL("../worker/product-price-library-api.mjs", import.meta.url),
    "utf8"
  );

  const start = source.indexOf("export const persistReviewedProductDocument");
  // The generic persistence function is now bounded by the next export. The
  // original anchor named `persistIfp75Datasheet`, which was the SKU-specific
  // implementation this slice replaced with the registry-driven generic path;
  // the SAFETY INVARIANTS below are unchanged and still binding.
  const end = source.indexOf("export const persistProductDatasheet", start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const block = source.slice(start, end);

  // The generic persistence block must decide nothing about the SKU family it
  // happens to be writing: family, protocol and compatibility relationships are
  // governed elsewhere and must never be inferred by a datasheet ingestion.
  // No SKU family may be named in executable code. The only permitted mention
  // is in prose that documents the hazard, so comments are stripped first.
  const code = block.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /IFP-?75|IFP-?2100|IFP2100|6815/i);

  assert.doesNotMatch(
    block,
    /UPDATE\s+library_products[\s\S]*family_id/i
  );

  assert.doesNotMatch(
    block,
    /INSERT INTO product_compatibility/i
  );

  // Nothing this path writes may be pre-approved: attributes and certifications
  // always land at 'Needs Review' / 'Unverified'.
  assert.doesNotMatch(
    block,
    /'Verified'/
  );
  assert.doesNotMatch(block, /'Approved'/);
});

test("generic datasheet dispatcher persists reviewed parsers through one shared path", async () => {
  const source = await readFile(
    new URL("../worker/product-price-library-api.mjs", import.meta.url),
    "utf8"
  );

  const start = source.indexOf("export const persistProductDatasheet");
  const end = source.indexOf("export const handleProductPriceLibraryApi", start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  const block = source.slice(start, end);

  assert.match(block, /resolveProductDatasheetParser/);
  assert.match(block, /persistReviewedProductDocument/);
  assert.doesNotMatch(block, /HONEYWELL_6815/);
  assert.doesNotMatch(block, /IFP75/);
});
