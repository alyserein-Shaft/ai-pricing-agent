import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeDocumentType, CLASSIFICATION_TAXONOMY, LEGACY_DOCUMENT_TYPE_ALIASES } from "../app/domain/document-classifier.mjs";

test("canonical_classifications view mirrors normalizeDocumentType exactly (exact-case, 7 aliases, no LOWER)", () => {
  const sql = readFileSync(new URL("../drizzle/0082_canonical_classifications.sql", import.meta.url), "utf8");
  const body = sql.slice(sql.indexOf("CREATE VIEW"));
  assert.match(sql, /CREATE VIEW `canonical_classifications`/);
  assert.match(body, /WHEN TRIM\(dc\.primary_type\) = 'Specification' THEN 'Technical Specification'/);
  assert.match(body, /WHEN TRIM\(dc\.primary_type\) = 'Supplier Quote' THEN 'Supplier Quotation'/);
  assert.equal((body.match(/WHEN TRIM\(dc\.primary_type\) = '/g) || []).length, 7);
  assert.doesNotMatch(body, /LOWER\s*\(/);
  assert.doesNotMatch(body, /UPPER\s*\(/);
  assert.doesNotMatch(body, /COLLATE NOCASE/);
  assert.match(body, /WHEN dc\.primary_type IS NULL OR TRIM\(dc\.primary_type\) = '' THEN 'Unknown'/);
});

test("normalizeDocumentType contract is frozen: 7 aliases exact-case only", () => {
  assert.equal(Object.keys(LEGACY_DOCUMENT_TYPE_ALIASES).length, 7);
  for (const [legacy, canonical] of Object.entries(LEGACY_DOCUMENT_TYPE_ALIASES)) {
    assert.equal(normalizeDocumentType(legacy), canonical);
    assert.equal(normalizeDocumentType(` ${legacy} `), canonical);
    // case variants must NOT normalize (narrow)
    assert.notEqual(normalizeDocumentType(legacy.toLowerCase()), canonical);
  }
  for (const canonical of CLASSIFICATION_TAXONOMY) {
    assert.equal(normalizeDocumentType(canonical), canonical);
  }
  assert.equal(normalizeDocumentType(null), "Unknown");
  assert.equal(normalizeDocumentType(""), "Unknown");
  assert.equal(normalizeDocumentType("   "), "Unknown");
  assert.equal(normalizeDocumentType("Unknown"), "Unknown");
  assert.equal(normalizeDocumentType("Auto Detection"), "Auto Detection");
  assert.equal(normalizeDocumentType("Something Else"), "Something Else");
  assert.equal(normalizeDocumentType("supplier quote"), "supplier quote");
});

test("view is all-history projection and preserves raw primary_type", async () => {
  const sql = readFileSync(new URL("../drizzle/0082_canonical_classifications.sql", import.meta.url), "utf8");
  const body = sql.slice(sql.indexOf("CREATE VIEW"));
  // all-history: view selects FROM document_classifications without WHERE superseded_at IS NULL
  assert.doesNotMatch(sql, /WHERE.*superseded_at IS NULL/);
  // raw column preserved via explicit column list plus canonical_type alias
  assert.match(body, /dc\.`primary_type`/);
  assert.match(body, /canonical_type/);
  // dc.* is NOT used in SELECT clause (view hardening)
  assert.doesNotMatch(body, /dc\.\*/);
});
