// R4 -- ONE canonical definition of a standards citation.
//
// Before R4 three independent lists existed and could drift:
//   * specification-extractor.mjs standardPattern   (what the live extractor persists),
//   * compatibility-vocabulary.mjs STANDARD_CITATION (R3 guard: what may never be a compat target),
//   * standards-semantics.mjs context regexes         (what P3 treats as a code/cable context).
// All of them now derive from this table. Pure module: no imports, no I/O.
//
// Per-body flags:
//   extracted            the live extractor recognizes the body (standardPattern)
//   guard                a body + designation is a standards citation (never a compat target)
//   productListingBody   the body issues PRODUCT listings/standards (UL/ULC/FM/EN 54): only
//                        these can make a "complies with" statement a PRODUCT_STANDARD
//   codeBody             the body publishes installation / system CODES (NFPA, NEC, BS, ...)
//   interoperabilityProfile  NOT a standard or listing at all (ONVIF): recognized by the
//                        extractor for backward compatibility only, excluded from every
//                        standards/listing semantic
// The two order lists reproduce the exact historical alternations so behaviour is
// byte-for-byte unchanged (pinned by tests/r4-standards-semantics.test.mjs).
export const STANDARD_BODIES = Object.freeze([
  { body: "NFPA", extracted: true, guard: true, productListingBody: false, codeBody: true, interoperabilityProfile: false },
  { body: "UL", extracted: true, guard: true, productListingBody: true, codeBody: false, interoperabilityProfile: false },
  { body: "ULC", extracted: true, guard: true, productListingBody: true, codeBody: false, interoperabilityProfile: false },
  { body: "FM", extracted: true, guard: true, productListingBody: true, codeBody: false, interoperabilityProfile: false },
  { body: "EN54", extracted: true, guard: false, productListingBody: true, codeBody: false, interoperabilityProfile: false, extractionSource: "EN\\s*54|EN54" },
  { body: "EN", extracted: false, guard: true, productListingBody: false, codeBody: false, interoperabilityProfile: false },
  { body: "IEC", extracted: true, guard: true, productListingBody: false, codeBody: false, interoperabilityProfile: false },
  { body: "BS", extracted: true, guard: true, productListingBody: false, codeBody: true, interoperabilityProfile: false },
  { body: "ISO", extracted: true, guard: true, productListingBody: false, codeBody: false, interoperabilityProfile: false },
  { body: "TIA", extracted: true, guard: true, productListingBody: false, codeBody: false, interoperabilityProfile: false },
  { body: "EIA", extracted: false, guard: true, productListingBody: false, codeBody: false, interoperabilityProfile: false },
  { body: "ANSI", extracted: false, guard: true, productListingBody: false, codeBody: false, interoperabilityProfile: false },
  { body: "BICSI", extracted: true, guard: true, productListingBody: false, codeBody: false, interoperabilityProfile: false },
  { body: "ONVIF", extracted: true, guard: false, productListingBody: false, codeBody: false, interoperabilityProfile: true },
  { body: "IEEE", extracted: true, guard: true, productListingBody: false, codeBody: false, interoperabilityProfile: false },
  { body: "NEC", extracted: true, guard: true, productListingBody: false, codeBody: true, interoperabilityProfile: false },
  { body: "ITU", extracted: false, guard: true, productListingBody: false, codeBody: false, interoperabilityProfile: false },
  { body: "CENELEC", extracted: false, guard: true, productListingBody: false, codeBody: false, interoperabilityProfile: false },
]);

const byName = new Map(STANDARD_BODIES.map((entry) => [entry.body, entry]));
const EXTRACTION_ORDER = Object.freeze(["NFPA", "UL", "ULC", "FM", "EN54", "IEC", "BS", "ISO", "TIA", "BICSI", "ONVIF", "IEEE", "NEC"]);
const GUARD_ORDER = Object.freeze(["NFPA", "ULC", "UL", "FM", "IEC", "BS", "EN", "ISO", "IEEE", "TIA", "EIA", "ANSI", "BICSI", "NEC", "ITU", "CENELEC"]);

// Alternation text for the live extractor (standardPattern uses it twice).
export const EXTRACTION_BODY_ALTERNATION = EXTRACTION_ORDER.map((name) => byName.get(name).extractionSource ?? name).join("|");
export const GUARD_BODY_ALTERNATION = GUARD_ORDER.join("|");

// A body followed by a designation is a standards citation (case-sensitive: specs
// write bodies in capitals; lowercase "en"/"fm"/"nec" fragments are ordinary words).
export const STANDARD_CITATION = new RegExp(`(?<![A-Za-z])(?:${GUARD_BODY_ALTERNATION})(?![A-Za-z])\\s*[-/:]?\\s*(?:[Ss]tandards?\\s+|[Ss]td\\.?\\s+)?[A-Z]?\\d[\\w.\\-:/]*`, "g");

export const normalizeStandardBody = (value) => String(value ?? "").replace(/\s+/g, "").toUpperCase();
export const isStandardsBody = (value) => { const entry = byName.get(normalizeStandardBody(value)); return Boolean(entry && !entry.interoperabilityProfile); };
export const isInteroperabilityProfile = (value) => byName.get(normalizeStandardBody(value))?.interoperabilityProfile === true;
export const isProductListingBody = (value) => byName.get(normalizeStandardBody(value))?.productListingBody === true;
export const isCodeBody = (value) => byName.get(normalizeStandardBody(value))?.codeBody === true;

// ---- LISTING / CERTIFICATION AUTHORITY -------------------------------------------
//
// A specification sometimes demands that equipment be LISTED or CERTIFIED by a
// NAMED certification body while citing NO standard number for it. The real
// Al Mousa clause (28 46 00 / 1 GENERAL / P, sequence 100075) is exactly this:
//
//   "Every component of the fire alarm system shall be listed under a single
//    manufacturer, approved by Underwriters Laboratories (UL), and clearly bear
//    the UL certification."
//
// That names an AUTHORITY and no NUMBER, which is a different assertion from "the
// product must comply with UL 864". A NUMBERED citation is satisfied only by that
// exact number; a LISTING AUTHORITY requirement is satisfied by proof that the
// authority listed or certified the product, whatever its own file number is.
//
// The governed set of authorities is therefore NOT a new list. It is derived from
// the SAME `productListingBody` flag above -- the flag that already exists
// precisely to mean "this body issues product listings/standards" -- for the same
// reason the R4 note at the top of this file exists: one canonical definition, so
// no second allowlist can drift away from the first. A body absent from this
// derived set (and a requirement naming no body at all, e.g. "an approved testing
// laboratory") yields no authority and keeps failing closed instead of matching
// arbitrary free text.
export const PRODUCT_LISTING_BODY_NAMES = Object.freeze(STANDARD_BODIES.filter((entry) => entry.productListingBody).map((entry) => entry.body));

/** Canonical listing-authority key, or null when the body does not issue product listings. */
export const normalizeProductListingBody = (value) => { const name = normalizeStandardBody(value); return isProductListingBody(name) ? name : null; };

// A body may be named in a specification by its spelled-out name rather than its
// abbreviation. These are SYNONYMS for an existing governed body, never new
// bodies: "Underwriters Laboratories (UL)" is UL.
const SPELLED_OUT_LISTING_BODY = Object.freeze({
  UL: /\bunderwriters\s+laborator(?:y|ies)\b/i,
  ULC: /\bunderwriters\s+laborator(?:y|ies)\s+of\s+canada\b/i,
  FM: /\bfactory\s+mutual\b/i,
});

const listingBodyTokenPattern = (name) => {
  const spelled = SPELLED_OUT_LISTING_BODY[name];
  // `EN54` is written "EN 54" as often as "EN54"; STANDARD_BODIES carries the same
  // alternation for the extractor, and it is reused here so both agree.
  const spaced = name.replace(/^([A-Z]+)(\d+)$/, "$1\\s*$2");
  return new RegExp(`(?<![A-Za-z])(?:${spelled ? `${spelled.source}|` : ""}${spaced})(?![A-Za-z])`, "i");
};

const LISTING_BODY_PATTERN = Object.freeze(Object.fromEntries(PRODUCT_LISTING_BODY_NAMES.map((name) => [name, listingBodyTokenPattern(name)])));

/**
 * The governed listing authority a piece of text NAMES, or null when it names none.
 * Longest body first, so "ULC" is never read as "UL".
 * @returns {string|null}
 */
export const findProductListingBodyInText = (text) => {
  const value = String(text ?? "");
  if (!value) return null;
  for (const name of [...PRODUCT_LISTING_BODY_NAMES].sort((left, right) => right.length - left.length)) {
    if (LISTING_BODY_PATTERN[name].test(value)) return name;
  }
  return null;
};

// ---- NEC ------------------------------------------------------------------------
// Whole-token / whole-phrase only. The R3 audit found /NEC/i matching inside
// "connected", "connection", "connector", "interconnection", "necessary".
export const NEC_TOKEN = /(?<![A-Za-z])NEC(?![A-Za-z])/;
export const NATIONAL_ELECTRICAL_CODE = /(?<![A-Za-z])National\s+Electrical\s+Code(?![A-Za-z])/i;
export const isNecReference = (text) => NEC_TOKEN.test(String(text ?? "")) || NATIONAL_ELECTRICAL_CODE.test(String(text ?? ""));

// ---- designation hygiene ---------------------------------------------------------
// A captured designation ("268A-listed.", "72-2016.", "7-", ".") must be reduced to
// the real designation or rejected. The extractor's number class is [A-Z0-9.-]+ with
// the i flag, so it happily swallows trailing punctuation and English suffix words.
const SUFFIX_WORD = /^[A-Za-z]{3,}$/;
export const cleanDesignation = (raw) => {
  const original = String(raw ?? "");
  if (!original) return { designation: null, artifacts: [] };
  const artifacts = [];
  const segments = original.split("-");
  const kept = [];
  for (let index = 0; index < segments.length; index += 1) {
    if (index > 0 && SUFFIX_WORD.test(segments[index].replace(/[.:;,]+$/, ""))) { artifacts.push("SUFFIX_WORD_LEAK"); break; }
    kept.push(segments[index]);
  }
  let designation = kept.join("-");
  const stripped = designation.replace(/[.:;,\-]+$/, "");
  if (stripped !== designation) {
    // A dangling hyphen ("7-", "BS7-") means the designation was cut off: truncated
    // fragment. A trailing period/colon is only sentence punctuation.
    if (/-$/.test(designation)) return { designation: null, artifacts: [...artifacts, "TRUNCATED_DESIGNATION"], truncated: true };
    artifacts.push("TRAILING_PUNCTUATION");
    designation = stripped;
  }
  return { designation: designation || null, artifacts };
};
