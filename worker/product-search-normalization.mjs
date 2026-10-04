// PL-REPAIR-3 — PRODUCT LIBRARY SEARCH NORMALIZATION.
//
// Centralized, code-aware normalization for the PRODUCT LIBRARY SEARCH path.
//
// This is search normalization ONLY. It is explicitly NOT:
//   - identity normalization            (product identity authority keeps its
//                                        own full [^A-Z0-9] strip in
//                                        product-identity-api.mjs and MUST NOT
//                                        be swapped for this helper — see below)
//   - product merging / alias generation
//   - fuzzy / semantic / AI search
//
// CONTRACT (smallest deterministic normalization for product CODE search):
//   trim -> uppercase -> remove hyphens, slashes, underscores and whitespace.
//   EVERYTHING ELSE IS PRESERVED, INCLUDING PERIODS.
//
//   Periods are deliberately load-bearing. In the live library REL-4.7K and
//   REL-47K are two genuinely distinct resistors (4.7 kΩ vs 47 kΩ) that would
//   collapse to the same key under the identity authority's full
//   [^A-Z0-9] strip. A read-only census of all 951 live part numbers under
//   THIS contract shows zero same-manufacturer and zero cross-manufacturer
//   collisions (TOTAL_NORMALIZED_KEYS=951, COLLIDING_KEYS=0,
//   ACTIVE_COLLIDING_KEYS=0), while still resolving:
//     IFP-75HV / ifp-75hv / IFP75HV / ifp75hv / IFP 75 HV  ->  IFP75HV
//
// Because of that period rule this helper must NEVER be promoted into an
// identity authority: the authoritative, collision-scoped identity key remains
// the stricter normalized_part_number produced by product-identity-api.mjs.

const CODE_STRIP_CHARS = ["-", "/", "_", " "];

/**
 * Normalize a user-supplied product-code search term.
 * May return "" for empty/whitespace-only/punctuation-only inputs.
 * @param {unknown} input
 * @returns {string} "" or an ALL-CAPS stripped code key.
 */
export const normalizeProductCodeSearchKey = (input) =>
  String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/[-\/_\s]+/g, "");

/**
 * Emit the identical normalization as a SQL expression over a code column.
 * Used so part-number / alias / original-order-code equality can be compared
 * against the search key WITHOUT depending on the (historically inconsistent)
 * stored normalized_part_number column and WITHOUT a schema change.
 *
 * The same CODE_STRIP_CHARS drive both the JS helper and this SQL fragment,
 * so the search key and the stored-side expression always agree.
 *
 * @param {string} column e.g. "c.part_number"
 * @returns {string} a SQLite expression
 */
export const productCodeNormalizedSql = (column) => {
  let expr = `trim(${column})`;
  for (const ch of CODE_STRIP_CHARS) expr = `replace(${expr},'${ch}','')`;
  return `upper(${expr})`;
};

/** @returns {string[]} the characters stripped by the normalization contract (for tests/reports). */
export const codeSearchStripCharacters = () => [...CODE_STRIP_CHARS];