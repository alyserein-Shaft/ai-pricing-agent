import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { ingestHoneywellFarenhytWorkbook, normalizePartNumber } from "../app/domain/product-price-library.mjs";

const workbook = "/Users/serein-b/Downloads/KSA Honeywell Farenhyt Series Price List -2023.xlsx";

test("Phase 1 backfill source remains 504 rows, 504 historical prices and 82 lifecycle rows", async () => {
  const result = ingestHoneywellFarenhytWorkbook(new Uint8Array(await readFile(workbook)));
  assert.equal(result.products.length, 504);
  assert.equal(result.prices.length, 504);
  assert.equal(result.lifecycle.length, 82);
  assert.ok(result.prices.every((price) => price.downstreamUse === "Discovery Only"));
});

test("Phase 1 contains exact IFP-75HV and IFP-75HVB identities but not 120V IFP-75 variants", async () => {
  const result = ingestHoneywellFarenhytWorkbook(new Uint8Array(await readFile(workbook)));
  const parts = new Set(result.products.map((product) => product.partNumber));
  assert.equal(parts.has("IFP-75HV"), true);
  assert.equal(parts.has("IFP-75HVB"), true);
  assert.equal(parts.has("IFP-75"), false);
  assert.equal(parts.has("IFP-75B"), false);
});

test("collision scan remains explicit rather than silently canonicalizing source identities", async () => {
  const result = ingestHoneywellFarenhytWorkbook(new Uint8Array(await readFile(workbook)));
  const groups = new Map();
  for (const product of result.products) {
    const key = normalizePartNumber(product.partNumber);
    groups.set(key, [...(groups.get(key) || []), product]);
  }
  assert.equal([...groups.values()].filter((records) => records.length > 1).length, 30);
  assert.ok(groups.get("REL47K").some((product) => product.partNumber === "REL-4.7K"));
  assert.ok(groups.get("REL47K").some((product) => product.partNumber === "REL-47K"));
});

test("controlled importer enriches an exact existing part number before inserting", async () => {
  const source = await readFile(new URL("../worker/product-price-library-api.mjs", import.meta.url), "utf8");
  assert.match(source, /upper\(part_number\)=upper\(\?\)/);
  assert.match(source, /resolvedKeys\.set\(product\.id, resolvedKey\)/);
});
