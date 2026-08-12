import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("product identity idempotency includes materialization implementation version", async () => {
  const source = await readFile(
    new URL("../worker/product-identity-api.mjs", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /PRODUCT_IDENTITY_MATERIALIZATION_VERSION="product-identity-materializer-v1\.2"/,
  );
  assert.match(
    source,
    /materializationFingerprint=`\$\{analysis\.inputFingerprint\}:\$\{PRODUCT_IDENTITY_MATERIALIZATION_VERSION\}`/,
  );
  assert.match(
    source,
    /bind\(org\.id,materializationFingerprint\)\.first\(\)/,
  );
  assert.match(
    source,
    /bind\(runId,org\.id,rulesetId,materializationFingerprint/,
  );
});

test("unit conflict persistence still clears stale materialized unit", async () => {
  const source = await readFile(
    new URL("../worker/product-identity-api.mjs", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /unit=CASE WHEN \?=1 THEN NULL ELSE COALESCE\(product_identities\.unit,excluded\.unit\) END/,
  );
});
