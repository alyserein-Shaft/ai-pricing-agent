import test from "node:test";
import assert from "node:assert/strict";
import { canonicalManufacturerName, sameManufacturerIdentity, MANUFACTURER_IDENTITY_VERSION } from "../app/domain/manufacturer-identity.mjs";

test("known explicit alias resolves to its canonical manufacturer", () => {
  const result = canonicalManufacturerName("Honeywell Fire Systems");
  assert.equal(result.canonical, "Honeywell");
  assert.equal(result.matchedAlias, true);
  assert.equal(result.raw, "Honeywell Fire Systems", "raw string must be preserved unchanged");
});

test("casing and punctuation normalization does not require a curated alias", () => {
  assert.equal(sameManufacturerIdentity("HONEYWELL", "Honeywell"), true);
  assert.equal(sameManufacturerIdentity("  honeywell  ", "Honeywell"), true);
  assert.equal(sameManufacturerIdentity("Honeywell.", "Honeywell"), true);
  assert.equal(canonicalManufacturerName("HONEYWELL").matchedAlias, false, "plain casing variants are not aliases, just normalized comparisons");
});

test("an unknown manufacturer remains distinct from Honeywell", () => {
  assert.equal(sameManufacturerIdentity("Hikvision", "Honeywell"), false);
  assert.equal(sameManufacturerIdentity("Bosch", "Honeywell"), false);
  const result = canonicalManufacturerName("Hikvision");
  assert.equal(result.canonical, "Hikvision", "unmapped manufacturers pass through unchanged, never coerced toward an existing name");
  assert.equal(result.matchedAlias, false);
});

test("no fuzzy merging: a near-miss spelling is not silently treated as the same manufacturer", () => {
  // "Honeywel" (missing a letter) is a plausible typo, not a curated alias.
  // Explicit-alias-only design must NOT match it via edit distance or
  // substring heuristics.
  assert.equal(sameManufacturerIdentity("Honeywel", "Honeywell"), false);
  assert.equal(canonicalManufacturerName("Honeywel").matchedAlias, false);
});

test("brand/division is not silently treated as a manufacturer alias unless explicitly configured", () => {
  // Farenhyt is a real Honeywell brand/division (see product_brands table),
  // not a spelling variant of the manufacturer name. This module must not
  // conflate the two: an alias resolution is scoped to legal-entity naming
  // variants only. Since "Farenhyt" is not in the curated alias map, it must
  // remain distinct from "Honeywell" as far as this module is concerned.
  assert.equal(sameManufacturerIdentity("Farenhyt", "Honeywell"), false);
  const result = canonicalManufacturerName("Farenhyt");
  assert.equal(result.canonical, "Farenhyt");
  assert.equal(result.matchedAlias, false, "brand/division names must never be silently folded into the manufacturer identity without an explicit curated entry");
});

test("empty or missing manufacturer values never claim a match", () => {
  assert.equal(sameManufacturerIdentity("", "Honeywell"), false);
  assert.equal(sameManufacturerIdentity(null, "Honeywell"), false);
  assert.equal(sameManufacturerIdentity(undefined, undefined), false);
  assert.equal(canonicalManufacturerName("").canonical, null);
});

test("module exposes a version identifier for provenance tracking", () => {
  assert.equal(typeof MANUFACTURER_IDENTITY_VERSION, "string");
  assert.ok(MANUFACTURER_IDENTITY_VERSION.length > 0);
});
