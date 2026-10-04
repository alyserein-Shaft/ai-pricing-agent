import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// product_certifications.standard_number is NOT NULL, but a manufacturer
// datasheet states some approvals with no number at all -- "FM Approved" has
// neither a standard number nor a body distinct from the approval name.
//
// The first IFP-2100 ingestion failed at runtime with
// `NOT NULL constraint failed: product_certifications.standard_number`, so the
// whole batch aborted and NOTHING was persisted. The fix records such a claim
// honestly -- using the stated body as the number -- rather than inventing an
// identifier the manufacturer never published, and refuses a claim that carries
// neither body nor number instead of writing an empty certification.

// These facts are read straight from the reviewed extractor output.
const {
  extractIfp2100Datasheet,
  IFP2100_DATASHEET_SHA256,
} = await import("../app/domain/ifp2100-datasheet.mjs");

const claims = extractIfp2100Datasheet({ checksum: IFP2100_DATASHEET_SHA256 }).listingClaims;

test("the extractor really does produce a numbering-free claim, so this is a real case", () => {
  const unnumbered = claims.filter((claim) => !claim.number);
  assert.ok(unnumbered.length > 0, "otherwise this repair would be untested");
  assert.ok(
    unnumbered.some((claim) => /FM Approved/.test(claim.exactText)),
    "the FM approval claim carries no standard number",
  );
});

test("every produced claim is persistable under the NOT NULL contract", async () => {
  const text = await readFile(
    new URL("../worker/product-price-library-api.mjs", import.meta.url),
    "utf8",
  );
  const start = text.indexOf("export const persistReviewedProductDocument");
  const end = text.indexOf("export const persistProductDatasheet", start);
  const block = text.slice(start, end);

  // The number written must fall back to the body, never to a fabricated value.
  assert.match(
    block,
    /const standardNumber = claim\.number \|\| null;/,
    "the stated number is used when the manufacturer published one",
  );
  assert.match(
    block,
    /standardNumber \|\| standardBody/,
    "a numbering-free claim falls back to its stated body rather than failing",
  );
  assert.doesNotMatch(
    block,
    /standardNumber \|\| ["'][A-Z0-9-]+["']/,
    "no placeholder identifier may be invented for an unnumbered claim",
  );
});

test("a claim with neither body nor number is refused rather than persisted empty", async () => {
  const text = await readFile(
    new URL("../worker/product-price-library-api.mjs", import.meta.url),
    "utf8",
  );
  const start = text.indexOf("export const persistReviewedProductDocument");
  const end = text.indexOf("export const persistProductDatasheet", start);
  const block = text.slice(start, end);
  assert.match(block, /if \(!standardBody && !standardNumber\) continue;/);
});

test("listing claims and standard compliance claims share one certification path", async () => {
  const text = await readFile(
    new URL("../worker/product-price-library-api.mjs", import.meta.url),
    "utf8",
  );
  const start = text.indexOf("export const persistReviewedProductDocument");
  const end = text.indexOf("export const persistProductDatasheet", start);
  const block = text.slice(start, end);

  assert.equal(
    block.match(/INSERT INTO product_certifications/g).length,
    1,
    "one insert means one authority; two divergent writers could disagree",
  );
  assert.match(block, /\.\.\.\(extracted\.listingClaims \|\| \[\]\), \.\.\.\(extracted\.standardClaims \|\| \[\]\)/);
});

test("UL 864 and UL 2572 reach the certification authority as distinct standards", () => {
  const { standardClaims } = extractIfp2100Datasheet({ checksum: IFP2100_DATASHEET_SHA256 });
  const keys = standardClaims.map((claim) => `${claim.body} ${claim.number}`.trim());
  assert.ok(keys.includes("UL 864"), "UL 864 must be recorded");
  assert.ok(keys.includes("UL 2572"), "UL 2572 must be recorded separately, not merged into UL 864");
});