import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("supplier intake line eligibility includes persisted quotation reference", async () => {
  const source = await readFile(
    new URL("../worker/supplier-price-intake-api.mjs", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /quotationReference:\s*row\.quotation_reference/,
  );
});
