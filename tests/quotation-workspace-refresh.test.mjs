import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("quotation workspace refreshes commercial and preview data when staleness changes without a status change", async () => {
  const source = await readFile(new URL("../app/components/workspaces/QuotationWorkspace.tsx", import.meta.url), "utf8");
  assert.match(source, /\[props\.projectId,props\.quotation\?\.status,props\.stale\]/);
  assert.match(source, /\[props\.projectId,props\.quotation\?\.id,props\.quotation\?\.status,props\.stale\]/);
});
