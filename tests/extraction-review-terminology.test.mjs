import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Extraction Review uses stage-specific estimator terminology", async () => {
  const page = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  for (const label of [
    "Confirm Extraction",
    "Restore Original",
    "Reject Extraction",
    "Extraction-confirmed BOQ items only",
  ]) {
    assert.match(page, new RegExp(label));
  }
  assert.doesNotMatch(page, /Approve BOQ item/);
  assert.match(page, /reviewBoqItem\(item, "approve"\)/);
  assert.match(page, /No technical, product, pricing, commercial/);
});
