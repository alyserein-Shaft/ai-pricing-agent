// BOQ BENCHMARK CONTRACT -- the single authority binding prompt, schema, corpus
// and scorer together.
//
// WHY A SEPARATE CONTRACT
// ----------------------
// The production engine (app/domain/boq-understanding-engine.mjs) serves a much
// richer governed contract than this benchmark needs, and its prompt is built
// from live taxonomy context per row. A benchmark must pin ONE frozen, disclosed
// contract that is identical across every tier, or a tier comparison measures
// prompt differences instead of model differences.
//
// THE DEFECT THIS PREVENTS
// ------------------------
// The earlier harness asked the model for 9 fields and scored 18. Fourteen cases
// were therefore unpassable and the hardest ones were silently dropped -- with no
// error anywhere. The same class of bug hid the safety axis. A scorer may not
// compare a field the prompt never requested. That invariant is enforced here, at
// import-time-verifiable declarations, and re-checked by verifyBenchmarkContract()
// BEFORE any provider call is made.
//
// SENTINELS ARE DISCLOSED, NOT SECRET
// -----------------------------------
// Ground truth uses "CONFLICT" and "AMBIGUOUS" to mean "the evidence supports more
// than one reading" and "the evidence supports no single reading". A model cannot
// be expected to emit a vocabulary it was never told. Both sentinels are stated
// verbatim in the prompt below.
import { createHash } from "node:crypto";

import { BOQ_UNDERSTANDING_CASES, COMPARED_FIELDS } from "./boq-understanding-corpus.mjs";
import { PREDICATE_VERSION } from "./boq-safety-predicates.mjs";
import { canonicalizeCategory, canonicalizeFamily, governedCategoryVocabulary, governedFamilyVocabulary } from "./boq-family-equivalence.mjs";

export const CONTRACT_VERSION = "boq-benchmark-contract-v1";
export const PROMPT_VERSION = "boq-benchmark-prompt-v1";

// Closed vocabularies. Disclosed to the model verbatim AND enforced locally.
export const SENTINELS = Object.freeze({
  UNKNOWN: "UNKNOWN",
  CONFLICT: "CONFLICT",
  AMBIGUOUS: "AMBIGUOUS",
});

export const ENUMS = Object.freeze({
  system: ["Fire Alarm"],
  medium: ["optical", "heat", "combined"],
  addressability: ["addressable", "conventional"],
  mount: ["base", "ceiling", "surface", "wall"],
  manufacturer: ["Siemens", "Honeywell", "Farenhyt", "Gamewell", "Gent"],
});

/**
 * `productFamily` IS a closed governed taxonomy in production
 * (`app/domain/fire-alarm-taxonomy.mjs` -> `FIRE_ALARM_TAXONOMY`), so the
 * benchmark discloses the SAME vocabulary rather than inviting free text.
 *
 * The list is read from production, never restated here: a hand-copied list would
 * drift from the taxonomy it claims to measure, and `verifyBenchmarkContract()`
 * fails if this and the prompt text ever disagree.
 */
export const PRODUCT_FAMILY_VOCABULARY = Object.freeze(
  governedFamilyVocabulary().map((entry) => entry.family),
);

/**
 * `category` IS a closed governed vocabulary in production -- 7 disjoint
 * engineering domains -- and is disclosed here read live from production.
 *
 * MEASURED: `normalizeFireAlarmCategory` accepts only the exact governed names
 * plus a small alias set ("detection device", "notification device",
 * "notification appliance"). All EIGHT category values the benchmark previously
 * used returned `null`, i.e. every one was off-contract, and two of them
 * ("Annunciator", "Control Panel") are FAMILY names -- the benchmark had conflated
 * the two taxonomy levels.
 */
export const CATEGORY_VOCABULARY = Object.freeze(governedCategoryVocabulary());

/**
 * KNOWN CATEGORY GAP (1 case) -- deliberately NOT forced.
 *
 * SYN-U-180 is a fire alarm cable. Production governs no category for a cable:
 * the only cable-adjacent name is the FAMILY "Cable Accessory", which lives under
 * "Accessories" and denotes an accessory TO a cable (gland, cleat), not the cable.
 * Assigning "Accessories" would be a guess, so the honest answer under the current
 * taxonomy is UNKNOWN, pinned here exactly as the productFamily gap was.
 *
 * The check is RETAINED so a future off-contract category fails the pre-flight
 * gate instead of silently re-opening an unwinnable corpus.
 */
export const KNOWN_UNGOVERNED_EXPECTED_CATEGORIES = Object.freeze([]);

/** Numeric fields are numbers or null; never the string "4". */
export const NUMERIC_FIELDS = Object.freeze(["zoneCount", "channelCount", "conductorSizeMm2"]);
/** Boolean fields are true/false or null. */
export const BOOLEAN_FIELDS = Object.freeze(["isStrobe", "isControlPanel", "isPrimaryProduct", "includesIsolator"]);

/**
 * Fields the SCORER reads that the MODEL must never be asked for.
 *
 * `reviewState` is governance metadata derived from corpus annotations, not a
 * fact about the document. Asking a model to emit it would create a hidden field:
 * the scorer would read something the prompt never requested, and a compliant
 * model would be marked unsafe for omitting it. That is exactly the defect class
 * this contract exists to prevent, so the value is derived deterministically here
 * and injected after the raw output has been schema-validated.
 */
export const DERIVED_FIELDS = Object.freeze(["reviewState"]);

export const REVIEW_STATES = Object.freeze({ READY: "READY", NEEDS_REVIEW: "NEEDS_REVIEW" });

/**
 * Every field the scorer reads off a prediction object. Maintained explicitly
 * rather than inferred, so that adding a scorer read without declaring it here
 * fails the contract gate instead of silently becoming a hidden field.
 */
export const SCORER_READ_FIELDS = Object.freeze([...COMPARED_FIELDS, "reviewState"]);

/**
 * KNOWN CORPUS GAP — **NOW EMPTY** (closed 2026-10-02 by human decision).
 *
 * This list previously held 6 distinct ungoverned ground-truth families across 8
 * cases, which made 22.2% of the corpus unwinnable by a compliant model: the
 * contract correctly discloses only production-governed families, so a model could
 * not return a family it was never offered.
 *
 * All 8 case-instances were resolved against first-party evidence:
 *   SYN-U-041 "Loop Expander"  -> `Loop Card`. Farenhyt SLC expanders ARE panel
 *       loop-expansion cards/modules; being in-panel and NOT_SLC does not
 *       distinguish them from the governed Loop Card concept.
 *   SYN-U-050/051 "Multi Sensor Detector" -> `Multi-Criteria Detector`. Production
 *       governs that family for exactly this device (its own parts are
 *       "Multi-criteria photoelectric, thermal and infrared smoke detector").
 *   SYN-U-100/160 "Addressable Detector"  -> `null`. `medium` is deliberately
 *       mustRemainUnknown, so no specific detector family is determinable.
 *   SYN-U-102 "Mounting Bracket" -> `Bracket`. A naming variant of a governed
 *       Accessories family, not a separate device.
 *   SYN-U-150 "Door Holder" -> `null`, and its safety PREDICATE was retracted
 *       because its premise was false: Honeywell sells electromagnetic door holders
 *       FOR fire alarm systems, so "a door holder is not a fire alarm device" is
 *       not a safety fact. The surviving rule is taxonomy-grounded only.
 *   SYN-U-180 "Fire Alarm Cable" -> `null`, retained as a REAL TAXONOMY COVERAGE
 *       GAP (a cable is a real product class with no governed family). Deliberately
 *       NOT mapped to `Cable Accessory`, which is an accessory TO a cable.
 *
 * The constant is kept, and the gate check is kept, because the property must stay
 * enforced: if a future ground-truth family is ungoverned again, the contract must
 * FAIL rather than quietly re-open a 22% unwinnable corpus. An empty list is the
 * healthy state, not a disabled check.
 */
export const KNOWN_UNGOVERNED_GROUND_TRUTH_FAMILIES = Object.freeze([]);

/** Populated by each `verifyBenchmarkContract()` call, for reporting. */
export let lastProductFamilyAudit = null;
/** Populated by each `verifyBenchmarkContract()` call, for reporting. */
export let lastCategoryAudit = null;

/**
 * Inject benchmark-derived governance fields. Call ONLY after validating the raw
 * model output, so a derived key can never mask a schema violation.
 */
export function deriveForScoring(caseSpec, modelOutput) {
  return {
    ...(modelOutput && typeof modelOutput === "object" ? modelOutput : {}),
    reviewState: caseSpec?.humanReviewRequired ? REVIEW_STATES.NEEDS_REVIEW : REVIEW_STATES.READY,
  };
}

/**
 * The canonical response schema. Used twice, deliberately:
 *   1. stated in the prompt so the model is told exactly what to return, and
 *   2. enforced locally by validateCanonicalPrediction() so a well-JSON'd but
 *      wrong-shaped answer fails as SCHEMA_INVALID rather than as a wrong answer.
 * "category" is intentionally free-text-permissive: an unrecognised family must be
 * reportable, and the scorer judges it wrong, rather than the schema forbidding it.
 */
export const CANONICAL_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  required: Object.freeze([...COMPARED_FIELDS]),
  additionalProperties: false,
  properties: Object.freeze(
    Object.fromEntries(
      COMPARED_FIELDS.map((f) => {
        if (f === "category") return [f, { type: "string", enum: [...CATEGORY_VOCABULARY, ...Object.values(SENTINELS)] }];
        if (ENUMS[f]) return [f, { type: "string", enum: [...ENUMS[f], ...Object.values(SENTINELS)] }];
        if (NUMERIC_FIELDS.includes(f)) return [f, { type: ["number", "null"] }];
        if (BOOLEAN_FIELDS.includes(f)) return [f, { type: ["boolean", "null"] }];
        return [f, { type: ["string", "null"] }];
      }),
    ),
  ),
});

const INSTRUCTIONS = [
  "You are extracting structured attributes from ONE line of a Bill of Quantities.",
  "Return ONE JSON object and nothing else. No prose, no markdown fence, no explanation.",
  "",
  "Return exactly these keys, all of them, every time:",
  COMPARED_FIELDS.join(", "),
  "",
  "Rules:",
  `- Text keys: if the line does not state a value, return the string "${SENTINELS.UNKNOWN}". Never guess, never infer a typical value.`,
  `- Numeric keys (${NUMERIC_FIELDS.join(", ")}) and boolean keys (${BOOLEAN_FIELDS.join(", ")}): if the line does not state a value, return null. Never use the string "${SENTINELS.UNKNOWN}" for these -- it is not a valid number or boolean.`,
  `- If the line states two values that contradict each other, return "${SENTINELS.CONFLICT}" for that key. Do NOT pick one.`,
  `- If the line offers alternatives without choosing between them, return "${SENTINELS.AMBIGUOUS}" for that key.`,
  "- Never invent a manufacturer or model. Only quote one that appears in the text.",
  "- Numeric keys are JSON numbers, not strings. Boolean keys are true/false or null.",
  "",
  "Allowed values:",
  `  system: ${ENUMS.system.join(", ")}`,
  `  category (a closed governed list -- use one of these exactly, or ${SENTINELS.UNKNOWN}):`,
  ...CATEGORY_VOCABULARY.map((c) => `      - ${c}`),
  `  medium: ${ENUMS.medium.join(", ")}`,
  `  addressability: ${ENUMS.addressability.join(", ")}`,
  `  mount: ${ENUMS.mount.join(", ")}`,
  `  manufacturer: ${ENUMS.manufacturer.join(", ")}`,
  `  productFamily (a closed governed list -- use one of these exactly, or ${SENTINELS.UNKNOWN}):`,
  ...PRODUCT_FAMILY_VOCABULARY.map((f) => `      - ${f}`),
  `  model, ipRating, environmentRating, compatibilityStatus: free text, or ${SENTINELS.UNKNOWN}`,
  "",
  "Schema:",
  JSON.stringify(CANONICAL_RESPONSE_SCHEMA),
].join("\n");

/** The one canonical prompt. Identical for every tier -- that is the whole point. */
export function buildCanonicalBenchmarkPrompt(caseSpec) {
  return [
    INSTRUCTIONS,
    "",
    "--- BOQ LINE ---",
    String(caseSpec?.input ?? ""),
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic local validation (no dependency, no network, no judgement).
// ─────────────────────────────────────────────────────────────────────────────

/** Tokens accepted as a correct, deliberately-preserved unknown. */
const UNKNOWNISH = new Set(["", "unknown", "n/a", "na", "none", "null", "not specified", "not stated", "-", "?"]);

/**
 * Validate a parsed prediction against the canonical schema.
 * @returns {{valid:boolean, problems:string[]}}
 */
export function validateCanonicalPrediction(predicted) {
  const problems = [];
  if (!predicted || typeof predicted !== "object" || Array.isArray(predicted)) {
    return { valid: false, problems: ["prediction is not a JSON object"] };
  }
  const allowed = new Set(COMPARED_FIELDS);
  for (const key of Object.keys(predicted)) {
    if (!allowed.has(key)) problems.push(`unexpected key "${key}"`);
  }
  for (const field of COMPARED_FIELDS) {    if (!(field in predicted)) {
      problems.push(`missing key "${field}"`);
      continue;
    }
    const value = predicted[field];
    if (NUMERIC_FIELDS.includes(field)) {
      if (value !== null && typeof value !== "number") problems.push(`"${field}" must be a number or null, got ${typeof value}`);
      continue;
    }
    if (BOOLEAN_FIELDS.includes(field)) {
      if (value !== null && typeof value !== "boolean") problems.push(`"${field}" must be boolean or null, got ${typeof value}`);
      continue;
    }
    if (value === null) continue;
    if (typeof value !== "string") {
      problems.push(`"${field}" must be a string or null, got ${typeof value}`);
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed) continue; // blank is a legitimate unknown
    if (UNKNOWNISH.has(trimmed.toLowerCase())) continue;
    const enumValues = ENUMS[field];
    if (enumValues) {
      const permitted = new Set([...enumValues, ...Object.values(SENTINELS)]);
      if (!permitted.has(trimmed)) problems.push(`"${field}" value "${trimmed}" is outside the disclosed vocabulary`);
    }
  }
  return { valid: problems.length === 0, problems };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-flight gate: fail BEFORE any provider call on any drift.
// ─────────────────────────────────────────────────────────────────────────────

const sha = (v) => createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");

/**
 * Verify prompt, schema, corpus and scorer still agree. Throws on drift.
 * A benchmark that cannot prove its own instrument must not spend money on it.
 */
export function verifyBenchmarkContract({ corpus = BOQ_UNDERSTANDING_CASES, comparedFields = COMPARED_FIELDS } = {}) {
  const problems = [];

  // 1. Every scored field is actually requested by the schema (no hidden fields).
  for (const field of comparedFields) {
    if (!(field in CANONICAL_RESPONSE_SCHEMA.properties)) problems.push(`scored field "${field}" is not in the canonical schema`);
    if (!buildCanonicalBenchmarkPrompt({ input: "x" }).includes(field)) problems.push(`scored field "${field}" is not named in the canonical prompt`);
  }
  // 2. The schema asks for nothing the scorer ignores (no unmeasured drift).
  for (const field of Object.keys(CANONICAL_RESPONSE_SCHEMA.properties)) {
    if (!comparedFields.includes(field)) problems.push(`schema requests "${field}" but the scorer does not compare it`);
  }
  // 3. Every sentinel used anywhere in ground truth is disclosed in the prompt.
  const promptText = buildCanonicalBenchmarkPrompt({ input: "x" });
  const gtSentinels = new Set();
  for (const c of corpus) {
    for (const field of comparedFields) {
      const v = c.expected?.[field];
      if (typeof v === "string" && Object.values(SENTINELS).includes(v)) gtSentinels.add(v);
    }
  }
  for (const s of gtSentinels) {
    if (!promptText.includes(s)) problems.push(`ground truth uses sentinel "${s}" but the prompt never discloses it`);
  }
  // 4. Every ground-truth non-null value must be inside the declared vocabulary,
  //    otherwise a compliant model cannot reproduce the answer key.
  for (const c of corpus) {
    for (const field of comparedFields) {
      const v = c.expected?.[field];
      if (v == null) continue;
      const enumValues = ENUMS[field];
      if (!enumValues) continue;
      if (typeof v !== "string") { problems.push(`${c.caseId}.${field} is ${typeof v} but ${field} is an enum field`); continue; }
      const permitted = new Set([...enumValues, ...Object.values(SENTINELS)]);
      if (!permitted.has(v)) problems.push(`${c.caseId}.${field} = "${v}" is outside the disclosed vocabulary`);
    }
  }
  // 5. Case identity is unique -- a duplicate id would silently merge two cases.
  const ids = corpus.map((c) => c.caseId);
  if (new Set(ids).size !== ids.length) problems.push("corpus contains duplicate caseId values");
  // 5A. productFamily is a GOVERNED taxonomy field, so the prompt must disclose
  //     the production vocabulary and every ground-truth family must either BE
  //     governed or resolve to one. A ground-truth family production does not
  //     govern is a corpus defect -- the answer key is naming equipment the
  //     application itself has no family for -- and is surfaced, never hidden.
  const governed = new Set(PRODUCT_FAMILY_VOCABULARY);
  for (const family of PRODUCT_FAMILY_VOCABULARY) {
    if (!promptText.includes(family)) problems.push(`governed family "${family}" is not disclosed in the prompt`);
  }
  const ungoverned = new Set();
  for (const c of corpus) {
    const family = c.expected?.productFamily;
    if (family == null) continue;
    if (governed.has(family)) continue;
    if (canonicalizeFamily(family).canonical) continue;
    ungoverned.add(`${family} (${c.caseId})`);
  }
  // Disclosed, not silently permitted: the known gap is pinned so any CHANGE to
  // it fails the gate and must be reviewed, while a stable known gap does not
  // block every run.
  const knownUngoverned = KNOWN_UNGOVERNED_GROUND_TRUTH_FAMILIES;
  const unexpected = [...ungoverned].filter((entry) => !knownUngoverned.some((k) => entry.startsWith(k)));
  const resolved = [...ungoverned].filter((entry) => knownUngoverned.some((k) => entry.startsWith(k)));
  if (unexpected.length) {
    problems.push(`ground truth names productFamily values production does not govern, and they are not the disclosed known set: ${unexpected.join("; ")}`);
  }
  // 5B. `category` is governed too, so the same no-silent-drift rule applies.
  const governedCategories = new Set(CATEGORY_VOCABULARY);
  const ungovernedCategories = new Set();
  for (const c of corpus) {
    const cat = c.expected?.category;
    if (cat == null) continue;
    if (governedCategories.has(cat)) continue;
    if (canonicalizeCategory(cat).canonical) continue;
    ungovernedCategories.add(`${cat} (${c.caseId})`);
  }
  const unexpectedCategories = [...ungovernedCategories].filter(
    (entry) => !KNOWN_UNGOVERNED_EXPECTED_CATEGORIES.some((k) => entry.startsWith(k)),
  );
  if (unexpectedCategories.length) {
    problems.push(`ground truth names category values production does not govern: ${unexpectedCategories.join("; ")}`);
  }
  for (const cat of CATEGORY_VOCABULARY) {
    if (!promptText.includes(cat)) problems.push(`governed category "${cat}" is not disclosed in the prompt`);
  }
  lastCategoryAudit = Object.freeze({
    governedCount: CATEGORY_VOCABULARY.length,
    disclosedKnownGap: Object.freeze([...ungovernedCategories].filter((e) => KNOWN_UNGOVERNED_EXPECTED_CATEGORIES.some((k) => e.startsWith(k)))),
    unexpected: Object.freeze(unexpectedCategories),
  });

  lastProductFamilyAudit = Object.freeze({
    governedCount: PRODUCT_FAMILY_VOCABULARY.length,
    disclosedKnownGap: Object.freeze([...resolved]),
    unexpected: Object.freeze(unexpected),
  });
  // 6. NO HIDDEN FIELDS. A field the scorer reads must be either requested by the
  //    schema (model-produced) or declared derived and injected by the benchmark.
  //    Anything else is a field a compliant model can never supply.
  for (const field of SCORER_READ_FIELDS) {
    const inSchema = field in CANONICAL_RESPONSE_SCHEMA.properties;
    const isDerived = DERIVED_FIELDS.includes(field);
    if (!inSchema && !isDerived) {
      problems.push(`scorer reads "${field}" but it is neither in the canonical schema nor declared in DERIVED_FIELDS`);
    }
    if (inSchema && isDerived) {
      problems.push(`"${field}" is both requested from the model and declared derived -- contradictory`);
    }
  }
  // 7. Derived fields must actually be produced, or the scorer reads null.
  const probe = deriveForScoring({ humanReviewRequired: true }, {});
  for (const field of DERIVED_FIELDS) {
    if (!(field in probe)) problems.push(`derived field "${field}" is not produced by deriveForScoring()`);
  }

  if (problems.length) {
    const err = new Error(`BENCHMARK CONTRACT VIOLATED (refusing to call any provider):\n  - ${problems.join("\n  - ")}`);
    err.code = "BENCHMARK_CONTRACT_VIOLATION";
    err.problems = problems;
    throw err;
  }
  return Object.freeze({ version: CONTRACT_VERSION, promptVersion: PROMPT_VERSION, fields: comparedFields.length, ok: true });
}

/** Stable fingerprint of everything that determines a result's meaning. */
export function contractFingerprint() {
  return Object.freeze({
    contract: CONTRACT_VERSION,
    prompt: PROMPT_VERSION,
    promptSha: sha(INSTRUCTIONS),
    schemaSha: sha(CANONICAL_RESPONSE_SCHEMA),
    sentinels: SENTINELS,
    enums: ENUMS,
    predicates: PREDICATE_VERSION,
    corpusSha: sha(BOQ_UNDERSTANDING_CASES.map((c) => c.caseId)),
    fields: [...COMPARED_FIELDS],
  });
}

export const FINGERPRINT_SHA = sha(contractFingerprint());
