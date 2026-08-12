import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("materialization clears a stale unit only when analysis reports an explicit unit conflict", async () => {
  const source = await readFile(
    new URL("../worker/product-identity-api.mjs", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /unit=CASE WHEN \?=1 THEN NULL ELSE COALESCE\(product_identities\.unit,excluded\.unit\) END/,
  );

  assert.match(
    source,
    /identity\.blockers\.includes\("Unit observations conflict\."\)\?1:0/,
  );
});
