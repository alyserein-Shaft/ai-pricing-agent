import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// The datasheet persistence path resolved an existing product by matching
// `normalized_part_number` against a PUNCTUATION-STRIPPED key
// (candidate.code.replace(/[^A-Z0-9]/g, "")). The live library is not stored
// that way: `IFP-2100HV` exists punctuation-PRESERVING, while the IFP-75-family
// identities are stored stripped.
//
// Measured consequence on the real Al Mousa library: ingesting Honeywell 351602
// created a SECOND product row `IFP-2100` (normalized `IFP2100`) instead of
// linking to the canonical one, so none of the 46 correctly-extracted attributes
// or the listing claims ever reached the intended SKU. That is a silent
// misattribution of first-party evidence.
//
// Identity is proven on the punctuation-PRESERVING form per DEC-2026-10-01-4c15
// (`REL-4.7K` and `REL-47K` are distinct ratings); the stripped key may only be a
// FALLBACK after the exact form misses.

const source = async () =>
  readFile(new URL("../worker/product-price-library-api.mjs", import.meta.url), "utf8");

const block = async () => {
  const text = await source();
  const start = text.indexOf("export const persistReviewedProductDocument");
  const end = text.indexOf("export const persistProductDatasheet", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return text.slice(start, end);
};

test("identity lookup tries the punctuation-PRESERVING key first", async () => {
  const code = await block();

  assert.match(
    code,
    /bind\(manufacturerId, candidate\.code\)\.first\(\)/,
    "the FIRST lookup must use the exact, punctuation-preserving SKU",
  );
  assert.match(
    code,
    /const existingProduct = exact \|\| stripped;/,
    "the stripped key may only ever be a fallback, never the primary identity",
  );
});

test("a new product stores the punctuation-preserving part number it was given", async () => {
  const code = await block();

  assert.match(
    code,
    /candidate\.code, candidate\.code, candidate\.description/,
    "a new product must store the verbatim SKU in both the part number and its normalized key",
  );
  assert.doesNotMatch(
    code,
    /candidate\.code\.replace\(\/\[\^A-Z0-9\]\/g, ""\), candidate\.description/,
    "inserting a stripped key alongside the verbatim part number would recreate the two-convention defect",
  );
});

test("the stripped key is used for lookup only, never for identity creation", async () => {
  const code = await block();

  // Exactly one stripped lookup is permitted: the documented fallback. Any
  // second use would mean the stripped key had leaked into a write.
  const strippedLookups = code.match(/normalized_part_number=\?"\)\.bind\(manufacturerId, candidate\.code\.replace/g) || [];
  assert.equal(strippedLookups.length, 1, "exactly one punctuation-stripped fallback lookup");
  assert.doesNotMatch(code, /const normalized = /, "no derived identity key may be computed at all");
});

test("every persisted product is identified by its own SKU from the reviewed parser", async () => {
  const code = await block();
  assert.match(code, /for \(const candidate of extracted\.products\)/);
});