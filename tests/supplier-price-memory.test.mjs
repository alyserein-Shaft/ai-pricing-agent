import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("supplier price intake publishes governed knowledge memory without auto approval", async () => {
  const memory = await readFile(
    new URL("../worker/supplier-price-memory.mjs", import.meta.url),
    "utf8",
  );
  const intake = await readFile(
    new URL("../worker/supplier-price-intake-api.mjs", import.meta.url),
    "utf8",
  );

  assert.match(memory, /Supplier Quotation Price/);
  assert.match(memory, /New Product Candidate/);
  assert.match(memory, /costingEligible:\s*false/);
  assert.match(memory, /Discovery Only/);
  assert.match(memory, /knowledge_product_links/);
  assert.match(intake, /persistSupplierQuoteKnowledgeMemory/);
  assert.doesNotMatch(memory, /approved_for_discovery\s*=\s*1/);
});

test("supplier memory keeps supplier identity separate from manufacturer identity", async () => {
  const source = await readFile(
    new URL("../worker/supplier-price-memory.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /manufacturer:\s*row\.manufacturer\s*\|\|\s*"Unknown"/);
  assert.doesNotMatch(source, /manufacturer:\s*row\.supplier/);
});
