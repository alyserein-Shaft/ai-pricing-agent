import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { DOCUMENT_TYPES } from "../app/domain/document-management.mjs";

// The ingest gate must accept the document types the REAL intake route can
// produce. Before this repair it matched a free-text phrase
// (/price list|product catalogue|product datasheet/i) against
// documents.document_type, but the governed upload vocabulary
// (app/domain/document-management.mjs DOCUMENT_TYPES) offers "Datasheet" and
// "Catalogue" -- never "Product Datasheet" or "Product Catalogue".
//
// Consequence measured on the live project: uploading the official Honeywell
// 351602 IFP-2100 datasheet through the governed intake route classified it
// "Datasheet" and the ingest route then answered 409
// SOURCE_CLASSIFICATION_REQUIRED, so a correctly classified document could never
// reach ingestion. Only legacy rows seeded outside the vocabulary could.
//
// These tests assert the contract rather than the implementation string: the
// accepted set is derived from the governed vocabulary itself.

const source = async () =>
  readFile(new URL("../worker/product-price-library-api.mjs", import.meta.url), "utf8");

const acceptedSet = async () => {
  const text = await source();
  const match = text.match(/const INGESTIBLE_DOCUMENT_TYPES = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(match, "the ingestible set must be declared as a set literal");
  const listed = [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
  const spread = /LEGACY_INGESTIBLE_DOCUMENT_TYPES/.test(match[1]);
  return { listed, spread };
};

test("the governed upload vocabulary can actually reach the ingest route", async () => {
  const { listed, spread } = await acceptedSet();

  // Every governed type an operator can select that names a product source must
  // be ingestible, or the operator is dead-ended by a correctly-classified file.
  const required = ["Price List", "Catalogue", "Datasheet"];
  for (const type of required) {
    assert.ok(
      DOCUMENT_TYPES.includes(type),
      `${type} must exist in the governed vocabulary for this test to mean anything`,
    );
    assert.ok(listed.includes(type), `"${type}" is a governed document type but was not ingestible`);
  }
  // The legacy values arrive through a spread of
  // LEGACY_INGESTIBLE_DOCUMENT_TYPES rather than as literal entries, so their
  // presence is asserted separately in the next test against that declaration.
  assert.equal(spread, true, "legacy seeded values must still be spread into the ingestible set");
});

test("the legacy seeded values stay honoured so no existing source regresses", async () => {
  const text = await source();
  // Rows seeded before the governed vocabulary existed carry these values; they
  // must keep working, so the legacy list must still be referenced.
  assert.match(text, /LEGACY_INGESTIBLE_DOCUMENT_TYPES = \["Product Datasheet", "Product Catalogue"\]/);
  assert.match(text, /INGESTIBLE_DOCUMENT_TYPES = new Set\(\[[\s\S]*\.\.\.LEGACY_INGESTIBLE_DOCUMENT_TYPES/);
});

test("a datasheet-typed document routes to the registry-driven parser, not a family-specific one", async () => {
  const text = await source();
  assert.match(text, /DATASHEET_DOCUMENT_TYPES = new Set\(\["Datasheet", "Product Datasheet"\]\)/);
  assert.match(text, /if \(DATASHEET_DOCUMENT_TYPES\.has\(document\.document_type\)\) \{ const persisted = await persistProductDatasheet\(/);
});

test("the gate no longer matches a free-text phrase against the document type", async () => {
  const text = await source();
  assert.doesNotMatch(
    text,
    /if \(!\/price list\|product catalogue\|product datasheet\/i\.test\(document\.document_type\)/,
    "the phrase-matching gate is exactly the defect this repair removes",
  );
  assert.match(text, /if \(!INGESTIBLE_DOCUMENT_TYPES\.has\(document\.document_type\)\)/);
});

test("an unregistered datasheet is refused by the parser, never parsed best-effort", async () => {
  const text = await source();
  assert.match(text, /const parser = resolveProductDatasheetParser\(\{ checksum: document\.sha256 \}\);/);
  assert.match(text, /if \(!parser\) \{[\s\S]*DATASHEET_PARSER_NOT_REVIEWED/);
});