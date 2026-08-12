import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("duplicate supplier intake backfills memory from persisted rows without reparsing", async () => {
  const source = await readFile(
    new URL("../worker/supplier-price-intake-api.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /persistSupplierQuoteKnowledgeMemoryFromRun/);
  assert.match(
    source,
    /if\s*\(duplicate\)[\s\S]*persistSupplierQuoteKnowledgeMemoryFromRun[\s\S]*idempotent:\s*true/,
  );
});

test("supplier memory replay does not duplicate learned event", async () => {
  const source = await readFile(
    new URL("../worker/supplier-price-memory.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /existingLearnEvent/);
  assert.match(source, /if\s*\(!existingLearnEvent\)/);
  assert.match(source, /knowledgeFileAlreadyExisted/);
});

test("persisted intake rows are reconstructed without changing monetary values", async () => {
  const source = await readFile(
    new URL("../worker/supplier-price-memory.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /row\.unit_price_minor\s*\/\s*100/);
  assert.match(source, /row\.net_price_minor\s*\/\s*100/);
  assert.match(source, /row\.quotation_reference/);
  assert.match(source, /row\.raw_values/);
});
