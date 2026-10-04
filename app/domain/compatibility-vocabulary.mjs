// P2 compatibility-target knowledge pack -- governed vocabulary.
//
// Canonical compatibility concepts with semantic types. Single source for:
//   (a) parser classification (specification-extractor.mjs consults this),
//   (b) governed data rows (engineering_taxonomy_terms seed mirrors it),
//   (c) negative guards (standards/vendors/topology can never be protocol).
//
// Semantic types: PROTOCOL | CIRCUIT_BUS | TOPOLOGY | PANEL_ROLE |
// AMBIGUOUS | GUARD_STANDARD | GUARD_VENDOR.
//
// PROJECT FACTS (Al Mousa requires FlashScan+CLIP) stay in requirement
// rows. What is reusable here is only the term representation
// ("FlashScan is a PROTOCOL term"), never the project selection.
//
// IDP is deliberately AMBIGUOUS: product-side evidence uses it as a
// protocol value while catalog text also uses it as a family prefix.
// No occurrence resolves without explicit role evidence.
import { STANDARD_CITATION } from "./standards-citations.mjs";
export const COMPAT_TERM_TYPES = ["PROTOCOL", "CIRCUIT_BUS", "TOPOLOGY", "PANEL_ROLE", "AMBIGUOUS", "GUARD_STANDARD", "GUARD_VENDOR"];

export const COMPATIBILITY_VOCABULARY = Object.freeze([
  { term: "FlashScan", aliases: ["Flash Scan", "FlashScan®", "Flash Scan®"], type: "PROTOCOL", provenance: "Al Mousa 28 46 00 cl.5(b): 'Flash Scan® (U.S. Patent 5,539,389) is a communication protocol'" },
  { term: "CLIP", aliases: ["Classic Loop Interface Protocol"], type: "PROTOCOL", provenance: "Al Mousa 28 46 00 cl.5(b,f): 'Compatible with Flash Scan® and CLIP protocol systems'; uppercase-only match, the lowercase verb 'clip' is never a protocol" },
  { term: "SLC", aliases: ["Signaling Line Circuit", "two-wire SLC"], type: "CIRCUIT_BUS", provenance: "Al Mousa 28 46 00 cl.9 (req314): SLC wiring configurations; circuit/bus concept, not a protocol" },
  { term: "NAC", aliases: ["Notification Appliance Circuit", "NAC LOOP", "NAC Loop"], type: "CIRCUIT_BUS", provenance: "Al Mousa riser/schematic loop vocabulary; notification circuit, not a protocol" },
  { term: "Class A", aliases: [], type: "TOPOLOGY", provenance: "Al Mousa 28 46 00 cl.9: wiring configuration class" },
  { term: "Class B", aliases: [], type: "TOPOLOGY", provenance: "Al Mousa 28 46 00 cl.9: wiring configuration class" },
  { term: "Style 4", aliases: [], type: "TOPOLOGY", provenance: "Al Mousa 28 46 00 cl.9: NFPA 72 wiring terminology" },
  { term: "Style 6", aliases: [], type: "TOPOLOGY", provenance: "Al Mousa 28 46 00 cl.9: NFPA 72 wiring terminology" },
  { term: "Style 7", aliases: [], type: "TOPOLOGY", provenance: "Al Mousa 28 46 00 cl.9: NFPA 72 wiring terminology" },
  { term: "FACP", aliases: ["Fire Alarm Control Panel", "F.A.C.P."], type: "PANEL_ROLE", provenance: "Al Mousa spec/drawings: functional panel role; a role label, never a manufacturer or family identity" },
  { term: "MFACP", aliases: ["Main Fire Alarm Control Panel", "Main FACP"], type: "PANEL_ROLE", provenance: "Al Mousa spec/drawings: functional main-panel role; never a manufacturer identity" },
  { term: "IDP", aliases: [], type: "AMBIGUOUS", provenance: "Stage 4V finding: product-side protocol value AND catalog family prefix; no occurrence resolves without explicit role evidence" },
  { term: "UL", aliases: ["Underwriters Laboratories"], type: "GUARD_STANDARD", provenance: "Listing body; never a compatibility target" },
  { term: "NFPA", aliases: ["National Fire Protection Association"], type: "GUARD_STANDARD", provenance: "Code body; never a compatibility target" },
  { term: "EN54", aliases: ["EN 54"], type: "GUARD_STANDARD", provenance: "Standard body; never a compatibility target" },
  { term: "BS", aliases: ["British Standard"], type: "GUARD_STANDARD", provenance: "Code body; never a compatibility target" },
  { term: "IEC", aliases: [], type: "GUARD_STANDARD", provenance: "Code body; never a compatibility target" },
  { term: "FM", aliases: ["Factory Mutual"], type: "GUARD_STANDARD", provenance: "Listing body; never a compatibility target" },
  { term: "ULC", aliases: [], type: "GUARD_STANDARD", provenance: "Listing body; never a compatibility target" },
  { term: "Honeywell", aliases: [], type: "GUARD_VENDOR", provenance: "Parent brand; never interoperability evidence (Stage 4V)" },
  { term: "Notifier", aliases: [], type: "GUARD_VENDOR", provenance: "Brand name alone never proves product compatibility" },
  { term: "Farenhyt", aliases: [], type: "GUARD_VENDOR", provenance: "Brand name alone never proves product compatibility" },
  { term: "Simplex", aliases: [], type: "GUARD_VENDOR", provenance: "Vendor-list name; never a compatibility target" },
  { term: "Siemens", aliases: [], type: "GUARD_VENDOR", provenance: "Vendor-list name; never a compatibility target" },
]);

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function classifyCompatibilityTarget(text) {
  const value = String(text ?? "");
  for (const entry of COMPATIBILITY_VOCABULARY) {
    const names = [entry.term, ...entry.aliases];
    for (const name of names) {
      const pattern = entry.term === "CLIP" && name === "CLIP"
        ? /\bCLIP\b/
        : new RegExp(`(?<!\\p{L})${escapeRegExp(name)}(?!\\p{L})`, "iu");
      if (pattern.test(value)) return { term: entry.term, type: entry.type };
    }
  }
  return null;
}

// True only for terms that may populate requirement compatibility rows:
// today that is PROTOCOL only. PANEL_ROLE / CIRCUIT_BUS / TOPOLOGY terms
// are governed knowledge (terms table + in-memory classification) but have
// no matchable product-side channel yet, so they must not become rows.
// GUARD_* and AMBIGUOUS never become rows by construction.
export const isMatchableCompatType = (type) => type === "PROTOCOL";

// ---------------------------------------------------------------------------
// R3 -- live compatibility persistence: typed targets, relationship sets, guards.
//
// requirement_compatibility has NO column for target type, relationship mode or
// set identity (see R3 report, "schema gap"). Without overloading unrelated
// columns the live path can therefore persist ONLY:
//   * one row per target, whose target_item is the CANONICAL governed term
//     ("FlashScan", "CLIP", "FACP"), so the semantic type stays recoverable at
//     read time through resolveStoredCompatibilityType(); and
//   * relationship sets whose meaning is preserved by independent per-target
//     rows (ALL_REQUIRED). ANY_OF needs a mode column and is evidence-only.
// Everything else is classified but never becomes an actionable compat row.
// ---------------------------------------------------------------------------

// Explicit persistence eligibility per governed target type.
//   PERSIST        a true compatibility target with a product-side meaning
//   EVIDENCE_ONLY  classified, kept out of the compat channel (wiring/topology
//                  properties are not compatibility targets)
//   NEVER          standards, vendors and ambiguous terms are never actionable
export const COMPAT_PERSISTENCE_POLICY = Object.freeze({
  PROTOCOL: "PERSIST",
  PANEL_ROLE: "PERSIST",
  CIRCUIT_BUS: "EVIDENCE_ONLY",
  TOPOLOGY: "EVIDENCE_ONLY",
  AMBIGUOUS: "NEVER",
  GUARD_STANDARD: "NEVER",
  GUARD_VENDOR: "NEVER",
});
export const RELATIONSHIP_MODES = Object.freeze(["SINGLE", "ALL_REQUIRED", "ANY_OF", "UNRESOLVED"]);

// null (unrecognized by the vocabulary) is legacy free-text evidence and keeps
// persisting, flagged untyped; an unknown type string never persists.
export const persistencePolicyForType = (type) => (type === null || type === undefined ? "PERSIST_UNTYPED" : (COMPAT_PERSISTENCE_POLICY[type] ?? "NEVER"));
const persists = (policy) => policy === "PERSIST" || policy === "PERSIST_UNTYPED";

const matcherFor = (entry, name) => (entry.term === "CLIP" && name === "CLIP" ? /\bCLIP\b/g : new RegExp(`(?<!\\p{L})${escapeRegExp(name)}(?!\\p{L})`, "giu"));

// EVERY recognized governed term in a phrase, in text order (classifyCompatibilityTarget
// returns only the first). Overlaps resolve to the earliest, then longest match, so
// "two-wire SLC" is one CIRCUIT_BUS hit and "Main FACP" is one MFACP hit.
// Standards citations are never compatibility targets. The 24-term vocabulary only
// guards UL/NFPA/EN54/BS/IEC/FM/ULC, but real specs leak "IEEE Standard 802",
// "ISO 11801:2002, ... EN 50173-1" into the compat channel (the matcher carries a
// one-off `^ieee standard` filter). A body followed by a designation is a
// GUARD_STANDARD hit here; no taxonomy row is added or changed. ONVIF is
// deliberately absent: it is an interoperability profile, not a listing.
// R4: the citation definition now lives in standards-citations.mjs (shared with the extractor and P3).
export { STANDARD_CITATION };

export function classifyCompatibilityTargets(text) {
  const value = String(text ?? "");
  const hits = [];
  for (const match of value.matchAll(STANDARD_CITATION)) hits.push({ term: match[0].trim(), type: "GUARD_STANDARD", index: match.index, end: match.index + match[0].length, matched: match[0], source: "STANDARD_CITATION" });
  for (const entry of COMPATIBILITY_VOCABULARY) {
    for (const name of [entry.term, ...entry.aliases]) {
      for (const match of value.matchAll(matcherFor(entry, name))) hits.push({ term: entry.term, type: entry.type, index: match.index, end: match.index + match[0].length, matched: match[0] });
    }
  }
  hits.sort((left, right) => left.index - right.index || (right.end - right.index) - (left.end - left.index));
  const kept = [];
  let lastEnd = -1;
  for (const hit of hits) { if (hit.index >= lastEnd) { kept.push(hit); lastEnd = hit.end; } }
  return kept;
}

// Read-time typed view of a STORED row (the schema has no target_type column).
export const resolveStoredCompatibilityType = (targetItem) => classifyCompatibilityTarget(targetItem)?.type ?? null;

const GENERIC_ONLY = /^(?:(?:the|all|any|other|both|either)\s+)*(?:(?:fire alarm|protocol|communication|network|compatible)\s+)*(?:protocols?|systems?|equipment|devices?|components?|products?|panels?)$/i;
export const isGenericTargetPhrase = (phrase) => GENERIC_ONLY.test(String(phrase ?? "").trim());

// Relationship-set grammar over the text BETWEEN consecutive recognized terms.
// Only an explicit conjunction proves a set: "A and B" -> ALL_REQUIRED, "A or B"
// -> ANY_OF. Bare adjacency, "and/or", mixed connectors or any other words leave
// the set UNRESOLVED -- vague plural language never becomes ALL_REQUIRED.
const HEAD_NOUN = "(?:\\s+(?:protocols?|systems?|loops?|devices?|panels?))*";
const AND_GAP = new RegExp(`^${HEAD_NOUN}\\s*,?\\s*and\\s+(?:the\\s+)?$`, "i");
const OR_GAP = new RegExp(`^${HEAD_NOUN}\\s*,?\\s*or\\s+(?:the\\s+)?$`, "i");
const COMMA_GAP = new RegExp(`^${HEAD_NOUN}\\s*,\\s*(?:the\\s+)?$`, "i");
const MODEL_TOKEN = /(?<![A-Za-z0-9-])(?=[A-Za-z0-9-]*[A-Za-z])(?=[A-Za-z0-9-]*\d)[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+(?![A-Za-z0-9-])|(?<![A-Za-z0-9-])[A-Z]{2,6}\d{2,}[A-Z0-9-]*(?![A-Za-z0-9-])/;

export function decomposeCompatibilityTarget(phrase) {
  const verbatim = String(phrase ?? "").trim();
  const hits = classifyCompatibilityTargets(verbatim);
  const terms = hits.map((hit) => ({ ...hit, policy: persistencePolicyForType(hit.type) }));
  if (hits.length === 0) return { verbatim, terms, mode: "SINGLE", connector: null, reason: isGenericTargetPhrase(verbatim) ? "GENERIC_TARGET_PHRASE" : "UNTYPED_TARGET" };
  if (hits.length === 1) return { verbatim, terms, mode: "SINGLE", connector: null, reason: null };
  const connectors = [];
  for (let index = 0; index < hits.length - 1; index += 1) {
    const gap = verbatim.slice(hits[index].end, hits[index + 1].index);
    connectors.push(AND_GAP.test(gap) ? "AND" : OR_GAP.test(gap) ? "OR" : COMMA_GAP.test(gap) ? "COMMA" : "OTHER");
  }
  const lead = verbatim.slice(0, hits[0].index).toLowerCase();
  const hasAnd = connectors.includes("AND");
  const hasOr = connectors.includes("OR");
  let mode = "UNRESOLVED";
  let reason = "NO_EXPLICIT_CONJUNCTION";
  if (connectors.includes("OTHER")) reason = "UNRECOGNIZED_CONNECTOR";
  else if (hasAnd && hasOr) reason = "MIXED_CONNECTORS";
  else if (hasAnd && /\beither\b/.test(lead)) reason = "CONTRADICTORY_QUANTIFIER";
  else if (hasOr && /\bboth\b/.test(lead)) reason = "CONTRADICTORY_QUANTIFIER";
  else if (hasAnd) { mode = "ALL_REQUIRED"; reason = null; }
  else if (hasOr) { mode = "ANY_OF"; reason = null; }
  return { verbatim, terms, mode, connector: hasAnd ? "AND" : hasOr ? "OR" : null, reason };
}

// A vendor / ambiguous term that merely QUALIFIES a specific model number
// ("Notifier NFS-3030") still names a concrete target; the term alone never does.
const specificModelPhrase = (decomposition) => {
  if (!decomposition.terms.length || !decomposition.terms.every((term) => term.type === "GUARD_VENDOR" || term.type === "AMBIGUOUS")) return false;
  let rest = decomposition.verbatim;
  for (const term of [...decomposition.terms].reverse()) rest = `${rest.slice(0, term.index)} ${rest.slice(term.end)}`;
  return MODEL_TOKEN.test(rest);
};

// Turns one parsed relationship into persistable rows plus everything that was
// deliberately NOT persisted (with the reason), so no classification is lost.
export function planCompatibilityPersistence({ sourceItem, targetPhrase, relationshipType, mandatory, confidence, negated = false }) {
  const decomposition = decomposeCompatibilityTarget(targetPhrase);
  const rows = [];
  const notPersisted = [];
  const base = { sourceItem, type: relationshipType, mandatory, confidence };
  if (negated) return { decomposition, rows, notPersisted: [{ reason: "NEGATED_RELATIONSHIP", targets: decomposition.terms.map((term) => term.term) }] };
  if (decomposition.mode === "UNRESOLVED") return { decomposition, rows, notPersisted: [{ reason: decomposition.reason, targets: decomposition.terms.map((term) => ({ term: term.term, targetType: term.type })) }] };
  if (decomposition.mode === "ANY_OF") return { decomposition, rows, notPersisted: [{ reason: "ANY_OF_NOT_REPRESENTABLE_WITHOUT_MODE_COLUMN", targets: decomposition.terms.map((term) => ({ term: term.term, targetType: term.type })) }] };
  if (decomposition.terms.length === 0) {
    if (decomposition.reason === "GENERIC_TARGET_PHRASE") return { decomposition, rows, notPersisted: [{ reason: "GENERIC_TARGET_PHRASE", verbatim: decomposition.verbatim }] };
    rows.push({ ...base, targetItem: decomposition.verbatim, targetType: null, relationshipMode: "SINGLE", targetVerbatim: decomposition.verbatim });
    return { decomposition, rows, notPersisted };
  }
  if (specificModelPhrase(decomposition)) {
    rows.push({ ...base, targetItem: decomposition.verbatim, targetType: null, relationshipMode: "SINGLE", targetVerbatim: decomposition.verbatim, note: "VENDOR_OR_AMBIGUOUS_TERM_QUALIFIES_SPECIFIC_MODEL" });
    return { decomposition, rows, notPersisted };
  }
  const seen = new Set();
  for (const term of decomposition.terms) {
    if (persists(term.policy) && !seen.has(term.term)) {
      seen.add(term.term);
      rows.push({ ...base, targetItem: term.term, targetType: term.type, relationshipMode: decomposition.mode, targetVerbatim: term.matched });
    } else if (!persists(term.policy)) notPersisted.push({ reason: `TARGET_TYPE_${term.type}_${term.policy}`, term: term.term, targetType: term.type });
  }
  return { decomposition, rows, notPersisted };
}

// Defense at the persistence choke point: workers filter every entry through
// this before INSERT, so a foreign producer (or a stale extractor) cannot slip a
// guarded / ambiguous / evidence-only / generic / negated target into the channel.
export const isPersistableCompatibilityEntry = (entry) => {
  const target = String(entry?.targetItem ?? "").trim();
  if (!target || entry?.polarity === "NEGATED") return false;
  if (isGenericTargetPhrase(target)) return false;
  if (entry.targetType !== undefined && entry.targetType !== null && !persists(persistencePolicyForType(entry.targetType))) return false;
  const decomposition = decomposeCompatibilityTarget(target); // derive from ALL terms, whatever the producer declared
  if (decomposition.terms.length === 0) return true;
  if (specificModelPhrase(decomposition)) return true;
  return decomposition.terms.every((term) => persists(term.policy));
};

// The exact column tuple both workers write. targetType is deliberately absent:
// it is recoverable from the canonical target_item (resolveStoredCompatibilityType).
export const toCompatibilityRowShape = (entry) => ({
  source_item: entry.sourceItem,
  target_item: entry.targetItem,
  relationship_type: entry.type,
  mandatory: entry.mandatory ? 1 : 0,
  confidence: entry.confidence,
});
