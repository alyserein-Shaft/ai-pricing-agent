// P3 standards/listings semantics pack -- occurrence-level classification.
//
// Pure derivation over already-parsed standards rows + requirement context.
// Separates three things that must never collapse:
//   STANDARD IDENTITY (e.g. "UL 268" -- what the designation is),
//   REQUIREMENT ROLE (what this occurrence demands),
//   COMPATIBILITY TARGET (never a standard -- enforced, not merely stated).
//
// No database access, no mutation, no review changes. Canonical standard
// identities live as governed rows in engineering_taxonomy_terms
// (term_type STANDARD); occurrence semantics live only here, because the
// same designation plays different roles in different clauses.
//
// R4 (independent closure audit repair):
//   * every context is WORD-BOUNDED: /NEC/i used to match "connected"/"connection",
//     and an un-anchored "mount" matched "amount";
//   * role and relationship are inferred from the CLAUSE around the citation, not the
//     whole sentence, so "UL listed to UL 268 and mounted per NFPA 72" gives each
//     standard its own role;
//   * a family/equipment noun never turns a general code reference into
//     PRODUCT_STANDARD: that needs a listing verb, or a compliance verb on a body
//     that actually issues product listings (UL/ULC/FM/EN 54);
//   * negation ("shall not be UL listed") is never a positive listing fact;
//   * ONVIF is an interoperability profile, not a standard or listing;
//   * NEC / NFPA 70 are installation codes by identity, never product listings;
//   * malformed identities (suffix leaks, truncated fragments, punctuation) are
//     UNRESOLVED, never a role;
//   * body/code knowledge comes from standards-citations.mjs, the same table the
//     extractor and the R3 compatibility guard use.
import { cleanDesignation, isInteroperabilityProfile, isNecReference, isProductListingBody, isStandardsBody, normalizeStandardBody } from "./standards-citations.mjs";

export const STANDARD_RELATIONSHIPS = ["LISTED_TO", "CERTIFIED_TO", "APPROVED", "TESTED_TO", "COMPLIES_WITH", "IN_ACCORDANCE_WITH", "MENTIONED"];

export const STANDARD_SEMANTICS = ["PRODUCT_STANDARD", "SYSTEM_STANDARD", "INSTALLATION_CODE", "TESTING_STANDARD", "QUALITY_CERTIFICATION", "CABLE_WIRING_STANDARD", "APPROVAL_CERTIFICATION", "REFERENCE_ENTRY", "UNRESOLVED"];

const REL_PATTERNS = [
  [/\blisted\s+(to|under|for)\b|\bUL Listed\b|[\w-]*\blisted\b/i, "LISTED_TO"],
  [/\bcertified\s+to\b/i, "CERTIFIED_TO"],
  [/\bapproved\s+(to|by)\b/i, "APPROVED"],
  [/\btested\s+(to|in accordance with)\b/i, "TESTED_TO"],
  [/\bcompl(?:y|ies|iant|iance)(?:\s+with)?\b|\bin compliance with/i, "COMPLIES_WITH"],
  [/\bin accordance with|\badhere(?:nce)?\s+to|\bcarried out as per|\bas per\b/i, "IN_ACCORDANCE_WITH"],
];
const LISTING_VERBS = ["LISTED_TO", "CERTIFIED_TO", "APPROVED", "TESTED_TO"];

// ---- clause-local context ---------------------------------------------------------
// A citation's context is the clause that contains it: bounded by ';', a sentence
// stop, "but/while/whereas", and an " and " that introduces a NEW predicate ("... and
// mounted per ...", "... and shall ..."). A plain list ("NFPA 70, NFPA 72 and BS 5839")
// stays one clause so it shares its cue.
const CLAUSE_BREAK = /;|\.\s|\b(?:but|while|whereas)\b|\s+and\s+(?=(?:shall|must|should|will|is|are|be|mounted|installed|tested|listed|certified|approved|located|wired|terminated|labell?ed|connected|provided|supplied)\b)/gi;

export const localStandardClause = (text, citation) => {
  const value = String(text ?? "");
  const needle = String(citation ?? "");
  if (!needle) return value;
  const at = value.indexOf(needle) >= 0 ? value.indexOf(needle) : value.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return value;
  let start = 0;
  let end = value.length;
  for (const match of value.matchAll(CLAUSE_BREAK)) {
    if (match.index + match[0].length <= at) start = match.index + match[0].length;
    else if (match.index >= at + needle.length) { end = match.index; break; }
  }
  return value.slice(start, end);
};

// ---- negation ------------------------------------------------------------------------
// A cue that follows not / never / cannot / no / without (within three words), or carries a "non-" prefix,
// is not a positive relationship. The representation has no negative relationship
// type, so a negated statement is left non-positive (MENTIONED / UNRESOLVED).
// A negation word must sit within three words of the cue ("shall not be UL listed", "never be UL 268 listed");
// a distant "non" ("non - maintained ... as per") is unrelated. "non-" only counts attached to the cue word.
const NEGATION_BEFORE = /\b(?:not|never|cannot|no|without)\b(?:\s+[\w.-]+){0,3}\s*$/i;
export const isNegatedStandardRelationship = (text, citation) => {
  const clause = localStandardClause(text, citation);
  for (const [pattern] of REL_PATTERNS) {
    const match = pattern.exec(clause);
    if (!match) continue;
    const before = clause.slice(0, match.index);
    if (NEGATION_BEFORE.test(before) || /\bnon[-\s]?$/i.test(before)) return true;
  }
  return false;
};

export function classifyStandardRelationship(text, citation) {
  const clause = localStandardClause(text, citation);
  if (isNegatedStandardRelationship(text, citation)) return "MENTIONED";
  for (const [pattern, name] of REL_PATTERNS) if (pattern.test(clause)) return name;
  return "MENTIONED";
}

// ---- word-bounded contexts ------------------------------------------------------------
const CABLE_CTX = /\bcables?\b|\bwiring\b|\bconductors?\b|\bcircuit\s+wiring\b/i;
const INSTALL_CTX = /\binstall(?:s|ed|ing|ation|ations)?\b|\bmount(?:s|ed|ing)?\b|\bexecution\b|\bterminat(?:e|es|ed|ing|ion|ions)\b|\blabel(?:s|led|ed|ling|ing)?\b/i;
// A designation that is by its own nature a cable standard (BS 6387: fire-resistant cables).
const CABLE_IDENTITIES = new Set(["BS 6387"]);

export const resolveStandardIdentity = ({ body, number, text = "" } = {}) => {
  const normalizedBody = normalizeStandardBody(body);
  const cleaned = cleanDesignation(number).designation;
  if (normalizedBody === "NEC" || (!normalizedBody && isNecReference(text))) return "NEC";
  if (normalizedBody && cleaned) return `${normalizedBody} ${cleaned}`;
  return normalizedBody || null;
};
const isInstallationIdentity = (identity) => identity === "NEC" || identity === "NFPA 70";

// Identity hygiene for a parsed / persisted row (also used by the read-only census).
export function validateStandardIdentity({ body, number = null, part = null } = {}) {
  const reasons = [];
  const normalizedBody = normalizeStandardBody(body);
  if (isInteroperabilityProfile(normalizedBody)) reasons.push("NOT_A_STANDARD_INTEROPERABILITY_PROFILE");
  else if (!isStandardsBody(normalizedBody)) reasons.push("BODY_UNRECOGNIZED");
  for (const [label, value] of [["NUMBER", number], ["PART", part]]) {
    if (value === null || value === undefined || value === "") continue;
    const raw = String(value);
    if (/^[.:;,\-]+$/.test(raw)) { reasons.push(`${label}_PUNCTUATION_ONLY`); continue; }
    if (/^[A-Za-z]{2,}$/.test(raw)) { reasons.push(`${label}_IS_A_WORD`); continue; } // "listed", "EN", "standard"
    if (/-$/.test(raw)) { reasons.push(`${label}_TRUNCATED`); continue; }
    const cleaned = cleanDesignation(raw);
    if (cleaned.artifacts.includes("SUFFIX_WORD_LEAK")) reasons.push(`${label}_SUFFIX_WORD_LEAK`);
    if (cleaned.artifacts.includes("TRAILING_PUNCTUATION")) reasons.push(`${label}_TRAILING_PUNCTUATION`);
  }
  const hasNumber = number !== null && number !== undefined && number !== "";
  return { valid: reasons.length === 0, resolved: reasons.length === 0 && (hasNumber || normalizedBody === "NEC"), bodyOnly: !hasNumber && normalizedBody !== "NEC", reasons };
}

export function classifyStandardOccurrence({ body, number, relationship, category, family = null, text = "", citation = null } = {}) {
  const clause = localStandardClause(text, citation);
  const normalizedBody = normalizeStandardBody(body);
  const identity = resolveStandardIdentity({ body, number, text: clause });
  const code = `${normalizedBody} ${number || ""}`.trim();
  // 1. Negated wording is never a positive standards fact (no negative relationship type exists).
  if (isNegatedStandardRelationship(text, citation)) return { semantic: "UNRESOLVED", basis: "NEGATED_RELATIONSHIP" };
  // 2. ONVIF & co: an interoperability profile is not a standard or a listing.
  if (isInteroperabilityProfile(normalizedBody)) return { semantic: "UNRESOLVED", basis: "INTEROPERABILITY_PROFILE_NOT_A_STANDARD" };
  // 3. A malformed identity (suffix leak, truncated fragment, punctuation, word-as-number) has no role.
  if (normalizedBody && !validateStandardIdentity({ body, number }).valid) return { semantic: "UNRESOLVED", basis: "MALFORMED_STANDARD_IDENTITY" };
  // 4. Manufacturer quality-management certification is never product evidence.
  if (/^ISO\s*9001\b/i.test(code)) return { semantic: "QUALITY_CERTIFICATION", basis: "ISO_9001_QUALITY_CONTEXT" };
  // 5. Category is the strong testing signal; raw "test" wording is NOT used
  // (product features like "remotely testable" must never route to testing).
  if (category === "Testing" || category === "Commissioning") return { semantic: "TESTING_STANDARD", basis: "TESTING_CATEGORY" };
  // 6. NEC / NFPA 70 are installation codes by identity, never product listings.
  if (isInstallationIdentity(identity)) return CABLE_CTX.test(clause) ? { semantic: "CABLE_WIRING_STANDARD", basis: "CABLE_WIRING_CONTEXT" } : { semantic: "INSTALLATION_CODE", basis: "INSTALLATION_CODE_IDENTITY" };
  // 7. Cable / wiring wording in THIS clause (or a cable-only designation).
  if (CABLE_CTX.test(clause) || CABLE_IDENTITIES.has(identity)) return { semantic: "CABLE_WIRING_STANDARD", basis: "CABLE_WIRING_CONTEXT" };
  // 8. An explicit listing verb on a body that issues product listings outranks a lexical
  // installation word in the same clause ("Detectors mounted on ceilings shall be UL 268 listed").
  const listingClaim = LISTING_VERBS.includes(relationship) && isProductListingBody(normalizedBody);
  if (listingClaim) return family ? { semantic: "PRODUCT_STANDARD", basis: "LISTING_VERB_WITH_FAMILY" } : { semantic: "SYSTEM_STANDARD", basis: "LISTING_VERB_NO_FAMILY" };
  if (category === "Installation" || INSTALL_CTX.test(clause)) return { semantic: "INSTALLATION_CODE", basis: "INSTALLATION_CONTEXT" };
  if (relationship === "MENTIONED") return { semantic: "REFERENCE_ENTRY", basis: "NO_OPERATIVE_VERB" };
  if ([...LISTING_VERBS, "COMPLIES_WITH", "IN_ACCORDANCE_WITH"].includes(relationship)) {
    // A family noun alone never makes a general code reference a PRODUCT_STANDARD: the body must
    // issue product listings (UL / ULC / FM / EN 54). NFPA, BS, IEEE, ISO ... stay system/code.
    return family && isProductListingBody(normalizedBody)
      ? { semantic: "PRODUCT_STANDARD", basis: "PRODUCT_LISTING_BODY_WITH_FAMILY" }
      : { semantic: "SYSTEM_STANDARD", basis: family ? "CODE_BODY_NOT_A_PRODUCT_LISTING" : "LISTING_VERB_NO_FAMILY" };
  }
  return { semantic: "UNRESOLVED", basis: "INSUFFICIENT_SEMANTIC_EVIDENCE" };
}

// Conservative P1 refinement: only fills UNKNOWN routes with practice/
// reference semantics. Never changes a decided route, never assigns
// PRODUCT_MATCHING, never touches the P1 module itself.
export function refineRouteWithStandardSemantics(route, semanticsList = []) {
  if (!route?.unknown) return route;
  const sems = new Set(semanticsList.map((entry) => entry.semantic));
  if (sems.has("INSTALLATION_CODE") || sems.has("CABLE_WIRING_STANDARD")) {
    return { ...route, scope: "PROJECT_WIDE", role: "INSTALLATION_COMPLIANCE", basis: [...(route.basis || []), "P3_STANDARD_REFINEMENT"], unknown: false };
  }
  if (sems.has("TESTING_STANDARD")) {
    return { ...route, scope: "PROJECT_WIDE", role: "TESTING_COMMISSIONING", basis: [...(route.basis || []), "P3_STANDARD_REFINEMENT"], unknown: false };
  }
  if (sems.has("QUALITY_CERTIFICATION")) {
    return { ...route, scope: "PROJECT_WIDE", role: "COMMERCIAL", basis: [...(route.basis || []), "P3_STANDARD_REFINEMENT"], unknown: false };
  }
  if (sems.has("REFERENCE_ENTRY") && sems.size === 1) {
    return { ...route, scope: "PROJECT_WIDE", role: "INFORMATIONAL", basis: [...(route.basis || []), "P3_STANDARD_REFINEMENT"], unknown: false };
  }
  return route;
}

