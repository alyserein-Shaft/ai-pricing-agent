// GOVERNED TAXONOMY EQUIVALENCE -- production-authority resolution for benchmark
// scoring, for BOTH `productFamily` and `category`.
//
// (The module predates the category work and keeps its original filename; it now
// covers the two governed taxonomy fields the benchmark scores.)
//
// WHY THIS EXISTS
// ---------------
// `productFamily` was scored as free text, so the benchmark penalised a model for
// writing "Addressable Smoke Detector" when the answer key said
// "Addressable Optical Smoke Detector" -- two strings that PRODUCTION resolves to
// the same governed family. That is a benchmark-contract error, not a model error,
// and it inflated attributeAccuracy's denominator with my own naming preference.
//
// PRODUCTION IS THE ONLY AUTHORITY HERE
// ------------------------------------
// This module imports the real taxonomy resolvers. It invents no aliases, applies
// no fuzzy matching, no embeddings and no LLM judgement. If production cannot
// resolve two strings to the same family, they are NOT equivalent -- full stop.
//
// THE COLLAPSE HAZARD, AND WHY IT IS BLOCKED EXPLICITLY
// -----------------------------------------------------
// `normalizeFireAlarmFamily` is deliberately lossy in places. Measured:
//   "conventional smoke detector" -> "Conventional Detector"
//   "conventional heat detector"  -> "Conventional Detector"
// and "Snd/Strobe assy." -> null, while the phrase classifier maps it to plain
// "Strobe" -- DROPPING the sounder, which is a different device.
//
// So production's canonical form alone is NOT sufficient to decide equivalence:
// blindly trusting it would credit a model that answered "conventional SMOKE
// detector" against a key of "conventional HEAT detector". `DISTINGUISHING_TOKENS`
// therefore vetoes equivalence whenever the two raw forms disagree on a token that
// carries engineering meaning. This is the §3 guard, and it is what stops alias
// normalisation from collapsing substantive classification differences.
import {
  classifyFireAlarmFamilyFromText,
  FIRE_ALARM_TAXONOMY,
  fireAlarmCategoryForFamily,
  isFireAlarmFamilySynonym,
  normalizeFireAlarmCategory,
  normalizeFireAlarmFamily,
} from "../../../app/domain/fire-alarm-taxonomy.mjs";

/**
 * Tokens that carry engineering meaning. Two family strings that disagree on any
 * of these are DIFFERENT families, even if production's lossy canonical form
 * collapses them to one value.
 *
 * Sourced from the distinctions production itself refuses to merge:
 *  - sensing technology: production keeps Addressable Smoke / Addressable Heat
 *    distinct even though it merges Conventional smoke/heat, so the technology
 *    token is treated as decisive in BOTH cases.
 *  - addressing mode: a conventional device is explicitly not an addressable one
 *    (see the SLC classifier's addressable-evidence requirement).
 *  - notification composition: a sounder/strobe is an audible+visual appliance;
 *    a bare strobe has no audible output. Production files these as separate
 *    families and `isFireAlarmFamilySynonym` does NOT relate them.
 */
export const DISTINGUISHING_TOKENS = Object.freeze([
  "smoke", "heat", "thermal", "flame", "beam", "duct", "carbon", "co",
  "multicriteria", "criteria",
  "addressable", "conventional",
  "sounder", "strobe", "horn", "siren", "bell", "speaker", "beacon", "flasher",
  "monitor", "control", "relay", "input", "output", "zone", "isolator", "interface",
  "annunciator", "panel", "call", "point", "pull", "station", "glass",
]);

/**
 * Tokens deliberately ABSENT from the list above, with the measured reason.
 * Production is the authority: a token that production itself collapses is a
 * qualifier, not an engineering distinction, and treating it as one would
 * re-create the very over-strictness this module exists to remove.
 *   "optical"  -- MEASURED: `classifyFireAlarmFamilyFromText("optical smoke
 *                 detector")` is null and "addressable optical smoke detector"
 *                 resolves to "Addressable Smoke Detector". Production governs no
 *                 optical/photoelectric family, so "Addressable Optical Smoke
 *                 Detector" and "Addressable Smoke Detector" are the SAME family.
 *   "bell"/"siren" family names ARE listed, because production files Bell, Sounder
 *                 and Sounder/Strobe as three separate governed families.
 */

/** Presentation-only words that carry no engineering meaning. */
const PRESENTATION_NOISE = new Set([
  "assy", "assembly", "assemblies", "type", "model", "kit", "set", "unit", "w",
  "with", "and", "or", "the", "of", "for", "a", "an", "ea", "each", "nos",
]);

const tokenize = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const significantTokens = (value) => new Set(tokenize(value).filter((t) => !PRESENTATION_NOISE.has(t)));

const stripNoise = (value) => [...significantTokens(value)].sort().join(" ");

/**
 * Resolve one family string to its production canonical form.
 * @returns {{canonical:string|null, basis:string, category:string|null, raw:string}}
 */
export function canonicalizeFamily(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { canonical: null, basis: "EMPTY", category: null, raw: text };

  // 1. Exact-alias / canonical-name resolver (the production fast path).
  const exact = normalizeFireAlarmFamily(text);
  if (exact) return { canonical: exact, basis: "PRODUCTION_EXACT_ALIAS", category: fireAlarmCategoryForFamily(exact), raw: text };

  // 2. Governed phrase classifier. Used ONLY to resolve the MODEL's free text;
  //    it is not consulted to invent an equivalence the taxonomy does not have.
  let classified = null;
  try {
    classified = classifyFireAlarmFamilyFromText(text);
  } catch {
    classified = null;
  }
  const phraseFamily = classified && typeof classified.family === "string" ? classified.family : null;
  if (phraseFamily) return { canonical: phraseFamily, basis: "PRODUCTION_PHRASE", category: classified.category ?? fireAlarmCategoryForFamily(phraseFamily), raw: text };

  return { canonical: null, basis: "UNRESOLVED_BY_PRODUCTION", category: null, raw: text };
}

/** Do the two forms disagree on any engineering-meaningful token? */
function conflictingDistinguishingTokens(a, b) {
  const left = new Set(tokenize(a));
  const right = new Set(tokenize(b));
  const conflicts = [];
  for (const token of DISTINGUISHING_TOKENS) {
    if (left.has(token) !== right.has(token)) conflicts.push(token);
  }
  return conflicts;
}

/**
 * Decide whether two family strings denote the same production family.
 *
 * @returns {{equivalent:boolean, basis:string, reason:string,
 *            expectedCanonical:string|null, gotCanonical:string|null,
 *            conflictingTokens:string[]}}
 */
export function familyEquivalence(expected, got) {
  const e = canonicalizeFamily(expected);
  const g = canonicalizeFamily(got);

  const result = (equivalent, basis, reason, conflictingTokens = []) => ({
    equivalent, basis, reason,
    expectedCanonical: e.canonical, gotCanonical: g.canonical,
    conflictingTokens,
  });

  // Unknown/absent never equals a known family. This must hold BEFORE any
  // canonical comparison, or "UNKNOWN" could normalise into something real.
  const isBlankish = (v) => v === null || v === undefined || String(v).trim() === "" ||
    ["unknown", "n/a", "na", "none", "null", "not specified", "not stated", "-", "?"]
      .includes(String(v).trim().toLowerCase());
  if (isBlankish(expected) && isBlankish(got)) return result(false, "BOTH_UNKNOWN", "Two unknown values are not a correct family identification.");
  if (isBlankish(got)) return result(false, "GOT_UNKNOWN", "The model returned no family where one was required.");
  if (isBlankish(expected)) return result(false, "EXPECTED_UNKNOWN", "Ground truth declares no family, so any concrete family is an unsupported inference.");

  // Rule 1 -- identical presentation.
  if (stripNoise(expected) === stripNoise(got) && stripNoise(expected) !== "") {
    return result(true, "IDENTICAL_AFTER_NOISE_STRIP", "Identical once presentation-only words are removed.");
  }

  // Rule 2 -- production's DECLARED synonym group, tested on CANONICAL forms.
  //
  // This must precede the raw-token veto. `isFireAlarmFamilySynonym` is the one
  // predicate that states two different canonical families are the same device
  // (measured: only "Manual Call Point" / "Pull Station"), and it takes canonical
  // names -- comparing the raw strings made the veto fire on "call/point" vs
  // "pull/station" and wrongly separated a pair production explicitly equates.
  if (e.canonical && g.canonical && isFireAlarmFamilySynonym(e.canonical, g.canonical)) {
    return result(true, "PRODUCTION_SYNONYM_GROUP", `${e.canonical} and ${g.canonical} are a declared production synonym pair.`);
  }

  // Rule 3 -- the distinguishing-token veto, applied BEFORE same-canonical
  // comparison because production's canonical form is lossy for technology and
  // composition (measured: "conventional smoke detector" and "conventional heat
  // detector" BOTH resolve to "Conventional Detector").
  const conflicts = conflictingDistinguishingTokens(expected, got);
  if (conflicts.length) {
    return result(false, "DISTINGUISHING_TOKEN_CONFLICT",
      `The two forms disagree on engineering-meaningful token(s): ${conflicts.join(", ")}.`, conflicts);
  }

  // Rule 4 -- production resolves both to the same governed family.
  if (e.canonical && g.canonical && e.canonical === g.canonical) {
    return result(true, "PRODUCTION_SAME_CANONICAL", `Both resolve to the governed family "${e.canonical}".`);
  }

  // Rule 5 -- both unresolved: fall back to noise-stripped token identity only.
  // No fuzzy threshold, no similarity score, no inferred synonym.
  if (!e.canonical && !g.canonical && stripNoise(expected) === stripNoise(got) && stripNoise(expected) !== "") {
    return result(true, "UNRESOLVED_BUT_TOKEN_IDENTICAL", "Neither string is governed, but they are token-identical once presentation words are removed.");
  }

  return result(false, e.canonical || g.canonical ? "DIFFERENT_CANONICAL_FAMILY" : "UNRESOLVED_AND_DIFFERENT",
    e.canonical || g.canonical
      ? `Production resolves these differently (${e.canonical ?? "unresolved"} vs ${g.canonical ?? "unresolved"}).`
      : "Neither string resolves to a governed family and they are not token-identical.");
}

/**
 * The FIELD-SCORING verdict for `productFamily` -- deliberately NOT the same
 * question as `familyEquivalence`.
 *
 * `familyEquivalence` answers "do these two strings denote the same family?" and
 * must answer NO when both are UNKNOWN, because declining to name a family is not
 * an identification. Field scoring asks a different question: "did the model get
 * this field right?". When ground truth declares no family and the model also
 * declined, that is a CORRECT answer.
 *
 * The scorer already has a separate axis for the opposite mistake:
 * `mustRemainUnknown` / `fabricatedFields` penalises a fabricated value. Charging
 * the correctness axis for the same preservation as well would double-count one
 * event. Conflating the two questions made 6 correct cases
 * (SYN-U-060/130/140/170/190/191) fail and broke the 36/36 winnability invariant.
 */
export function familyScoringVerdict(expected, got) {
  const blankish = (v) => v === null || v === undefined || String(v).trim() === "" ||
    ["unknown", "n/a", "na", "none", "null", "not specified", "not stated", "-", "?"]
      .includes(String(v).trim().toLowerCase());
  if (blankish(expected) && blankish(got)) {
    return Object.freeze({ correct: true, basis: "BOTH_UNKNOWN_CORRECTLY_PRESERVED", equivalence: null });
  }
  const eq = familyEquivalence(expected, got);
  return Object.freeze({ correct: eq.equivalent, basis: eq.basis, equivalence: eq });
}

/**
 * The governed family vocabulary, read from PRODUCTION rather than restated here.
 *
 * A benchmark that hardcodes its own family list would immediately drift from the
 * taxonomy it claims to measure, and the contract gate in boq-benchmark-contract.mjs
 * asserts this function's output equals what the prompt actually discloses. So the
 * prompt can never offer a model a family production does not govern.
 */
export function governedFamilyVocabulary() {
  const entries = [];
  for (const [category, families] of Object.entries(FIRE_ALARM_TAXONOMY)) {
    for (const family of families) entries.push({ category, family });
  }
  entries.sort((a, b) => a.family.localeCompare(b.family) || a.category.localeCompare(b.category));
  return Object.freeze(entries);
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY -- a CLOSED 7-value governed vocabulary, narrower still than family.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The governed category vocabulary, read from PRODUCTION.
 *
 * MEASURED: `normalizeFireAlarmCategory` accepts ONLY the exact governed names plus
 * a deliberately small alias set ("detection device", "notification device",
 * "notification appliance", and the names themselves). Every one of the eight
 * category values the benchmark used -- Detector, Notification, Control Panel,
 * Peripheral, Module, Annunciator, Accessory, Cable -- returns `null`, i.e. all
 * eight were OFF-CONTRACT. Two of them ("Annunciator", "Control Panel") are
 * actually FAMILY names, so the benchmark had conflated the two levels.
 */
export function governedCategoryVocabulary() {
  return Object.freeze(Object.keys(FIRE_ALARM_TAXONOMY));
}

/** Resolve a category string through production's own alias/normaliser. */
export function canonicalizeCategory(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { canonical: null, basis: "EMPTY", raw: text };
  const canonical = normalizeFireAlarmCategory(text);
  if (canonical) return { canonical, basis: "PRODUCTION_CATEGORY_ALIAS", raw: text };
  if (Object.hasOwn(FIRE_ALARM_TAXONOMY, text)) return { canonical: text, basis: "PRODUCTION_CATEGORY_NAME", raw: text };
  return { canonical: null, basis: "OFF_CONTRACT", raw: text };
}

/**
 * Field-scoring verdict for `category`.
 *
 * There is deliberately NO veto list here, unlike `productFamily`. The category
 * vocabulary is 7 disjoint engineering domains with no technology or composition
 * axis, so production's exact-name/alias resolution is already lossless: two
 * different categories can never collapse. An empty-vs-empty answer is a correct
 * preserved unknown, scored on the correctness axis only -- the
 * `mustRemainUnknown` axis is what penalises a fabricated value.
 */
export function categoryScoringVerdict(expected, got) {
  const e = canonicalizeCategory(expected);
  const g = canonicalizeCategory(got);
  const blankish = (v) => v === null || v === undefined || String(v).trim() === "" ||
    ["unknown", "n/a", "na", "none", "null", "not specified", "not stated", "-", "?"]
      .includes(String(v).trim().toLowerCase());
  if (blankish(expected) && blankish(got)) {
    return Object.freeze({ correct: true, basis: "BOTH_UNKNOWN_CORRECTLY_PRESERVED", expectedCanonical: null, gotCanonical: null, reason: null });
  }
  if (blankish(got)) {
    return Object.freeze({ correct: false, basis: "GOT_UNKNOWN", expectedCanonical: e.canonical, gotCanonical: null, reason: "The model returned no category where one was required." });
  }
  if (blankish(expected)) {
    return Object.freeze({ correct: false, basis: "EXPECTED_UNKNOWN", expectedCanonical: null, gotCanonical: g.canonical, reason: "Ground truth declares no governed category, so any concrete category is off-contract." });
  }
  if (e.canonical && g.canonical && e.canonical === g.canonical) {
    return Object.freeze({ correct: true, basis: "PRODUCTION_SAME_CATEGORY", expectedCanonical: e.canonical, gotCanonical: g.canonical, reason: null });
  }
  return Object.freeze({
    correct: false,
    basis: e.canonical || g.canonical ? "DIFFERENT_CATEGORY" : "OFF_CONTRACT_CATEGORY",
    expectedCanonical: e.canonical, gotCanonical: g.canonical,
    reason: e.canonical || g.canonical
      ? `Production resolves these to different categories (${e.canonical ?? "off-contract"} vs ${g.canonical ?? "off-contract"}).`
      : "At least one side is not a governed production category.",
  });
}

export { classifyFireAlarmFamilyFromText, normalizeFireAlarmFamily, isFireAlarmFamilySynonym, fireAlarmCategoryForFamily, normalizeFireAlarmCategory };
