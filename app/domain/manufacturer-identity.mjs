// Shared, explicit-alias-only manufacturer identity resolution.
//
// This is deliberately NOT a fuzzy matcher and NOT a brand/division table.
// `product_brands` already models a real sub-brand/division relationship
// under a manufacturer (e.g. a specific product line marketed under a
// distinct name) and is untouched by this module. This module only
// resolves confirmed spelling/naming variants of the SAME manufacturer
// legal entity (e.g. "Honeywell Fire Systems" vs "Honeywell") to one
// canonical form for comparison purposes.
//
// Callers must keep using the original/raw manufacturer string for storage
// and display; `canonicalManufacturerName`/`sameManufacturerIdentity` exist
// only to be used at comparison/linking points (dedup, matching gates,
// supplier price linkage), never to overwrite recorded data.

const clean = (value) => String(value ?? "").trim();
const normalizeKey = (value) => clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

// Curated alias -> canonical manufacturer name. Keys are matched after
// normalizeKey (case/punctuation-insensitive). Add entries only for a
// confirmed variant of the same manufacturer entity -- never for a
// brand/division unless it has been explicitly confirmed interchangeable
// with the parent manufacturer name for identity purposes.
const MANUFACTURER_ALIASES = new Map([
  ["HONEYWELL FIRE SYSTEMS", "Honeywell"],
  ["HONEYWELL FIRE", "Honeywell"],
]);

export const MANUFACTURER_IDENTITY_VERSION = "manufacturer-identity-v1.0.0";

export function canonicalManufacturerName(rawValue) {
  const raw = clean(rawValue);
  if (!raw) return { raw, canonical: null, matchedAlias: false };
  const key = normalizeKey(raw);
  const aliasTarget = MANUFACTURER_ALIASES.get(key);
  return { raw, canonical: aliasTarget || raw, matchedAlias: Boolean(aliasTarget) };
}

export function sameManufacturerIdentity(left, right) {
  const leftCanonical = canonicalManufacturerName(left).canonical;
  const rightCanonical = canonicalManufacturerName(right).canonical;
  if (!leftCanonical || !rightCanonical) return false;
  return normalizeKey(leftCanonical) === normalizeKey(rightCanonical);
}
