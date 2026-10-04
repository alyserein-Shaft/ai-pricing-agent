// ATTRIBUTE COMPARISON MAP CONTRACT v2.0.0 -- frozen specification.
//
// Single source of truth for requirement-attribute -> product-capability
// comparison semantics. READ-ONLY design artifact: the future Technical
// Matching lane implements against this contract; nothing in this file
// executes matching, mutates data, or approves anything. No import here may
// touch a database, the production matcher, or the Product Library.
//
// v2.0.0 supersedes v1.0.0 (independent closure audit, repair R2). v1.0.0
// declared 7 mappings READY_FOR_MATCHER_IMPLEMENTATION; the audit proved 3 of
// them (sound_output, candela_rating, battery_capacity) were not executable
// against the real value encodings, and that protocol and ROR were overclaimed.
// v2 grades every mapping from the CURRENT real requirement-side and
// product-side encodings (VALUE_ENCODING_INVENTORY) and adds explicit
// value-kind, operator, range and unsupported-encoding semantics.
//
// Governing rules:
//   * A mapping may produce PASS or FAIL only when it is READY* AND both
//     stored encodings decode under the mapping's value kind AND the operator
//     is supported. Otherwise the outcome is one of the non-verdict results.
//   * FAIL is NEVER a default. Unsupported / undecodable / unit-less /
//     subject-less input maps to NOT_COMPARABLE or UNKNOWN_*.
//   * MISSING EVIDENCE != INCOMPATIBILITY.
//
// Any change to this file requires a versioned successor (the fingerprint
// pinned in tests/attribute-comparison-contract.test.mjs detects drift).
export const ATTRIBUTE_COMPARISON_MAP_VERSION = "2.0.0";
export const SUPERSEDED_VERSION = "1.0.0";

const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
};

export const COMPARISON_TYPES = deepFreeze({
  EQUALS: "value equality after normalization (same unit only; no implicit unit conversion)",
  MINIMUM_REQUIRED: "product value must meet or exceed the required minimum",
  MAXIMUM_ALLOWED: "product value must not exceed the required maximum",
  REQUIRED_RANGE_WITHIN_CAPABILITY_RANGE: "required interval must be contained within proven capability interval",
  SET_CONTAINS: "product set must contain every mandatorily required member",
  SET_INTERSECTS: "product set must intersect the required set (partial coverage recorded, never silent)",
  BOOLEAN_REQUIRED: "required flag must hold on the product side",
  ENUM_MATCH: "equality over a controlled vocabulary value",
  SUBJECT_BOUND_COMPARISON: "gated wrapper: allowed only with full subject metadata (subject, mode, operator, unit, family context)",
  NOT_COMPARABLE: "explicit refusal: no comparison is built for this pair",
});

export const RESULT_SEMANTICS = deepFreeze({
  PASS: "evidence proves the requirement",
  FAIL: "evidence proves non-satisfaction (explicit mismatch only; never a default)",
  UNKNOWN_PRODUCT: "product evidence missing or unusable -- blocking, truthfully labeled, never called incompatibility",
  UNKNOWN_PROJECT: "requirement-side information missing or undecodable",
  NOT_APPLICABLE: "governed exclusion (e.g. Golden 190°F vs 9xROR decision); no comparison built",
  APPLICATION_REVIEW: "application-suitability judgment required",
  NOT_COMPARABLE: "no comparison exists for this pair; must not be built ad hoc",
});

export const MISSING_IS_NOT_INCOMPATIBLE = true;
export const FAIL_IS_NEVER_DEFAULT = true;

// Ordered vocabulary. READY* states may yield PASS/FAIL; every other state is a
// blocker and yields only non-verdict results (see allowedOutcomes).
export const READINESS_STATES = deepFreeze([
  "READY_FOR_MATCHER_IMPLEMENTATION",
  "READY_EXACT_ONLY",
  "NEEDS_VALUE_NORMALIZATION",
  "NEEDS_PRODUCT_VOCABULARY_ALIGNMENT",
  "NEEDS_PRODUCT_SUBJECT_METADATA",
  "NEEDS_PRODUCT_LIBRARY_EVIDENCE",
  "NEEDS_MATCHER_CAPABILITY",
  "DEFERRED_SEMANTICS",
  "UNSAFE_TO_COMPARE",
]);
export const READY_STATES = deepFreeze(["READY_FOR_MATCHER_IMPLEMENTATION", "READY_EXACT_ONLY"]);

export const VALUE_KINDS = deepFreeze({
  SCALAR: "one number (or one unit-bearing verbatim value) with a required unit",
  ENUM: "one member of a closed controlled vocabulary",
  SET: "an unordered set of option tokens",
  RANGE: "a closed interval [lower, upper] with one unit; see RANGE_VALUE_CONTRACT",
  BOOLEAN: "true / false capability flag",
  SUBJECT_BOUND: "a number that only has meaning together with its subject, mode and unit dimension",
  RELATIONSHIP_SET: "a set of protocol/compatibility targets together with the relationship that binds them (all-of vs any-of)",
});

// Canonical operator vocabulary. Stored rows use aliases; anything that does not
// resolve through this table is UNSUPPORTED (-> NOT_COMPARABLE, never FAIL).
export const OPERATORS = deepFreeze({
  EQUALS: { aliases: ["Equal", "Equals", "Exact"], valueKinds: ["SCALAR", "ENUM", "SET", "RELATIONSHIP_SET", "SUBJECT_BOUND"] },
  MINIMUM: { aliases: ["Minimum", "Greater Than or Equal"], valueKinds: ["SCALAR", "SUBJECT_BOUND"] },
  MAXIMUM: { aliases: ["Maximum", "Less Than or Equal"], valueKinds: ["SCALAR", "SUBJECT_BOUND", "RANGE"] },
  GREATER_THAN: { aliases: ["Greater Than"], valueKinds: ["SCALAR", "SUBJECT_BOUND"] },
  LESS_THAN: { aliases: ["Less Than"], valueKinds: ["SCALAR", "SUBJECT_BOUND"] },
  BETWEEN: { aliases: ["Between"], valueKinds: ["RANGE"] },
  INFORMATIONAL: { aliases: ["Informational"], valueKinds: [], note: "product-side marker: a value is present but carries no comparison operator" },
});
export const UNSUPPORTED_OPERATORS = deepFreeze(["Excludes", "Compatible With", "Not Equal", "Interface"]);

export const canonicalOperator = (stored) => {
  const text = String(stored ?? "").trim();
  for (const [canonical, spec] of Object.entries(OPERATORS)) if (spec.aliases.includes(text)) return canonical;
  return null;
};
export const operatorSupport = (entry, stored) => {
  const canonical = canonicalOperator(stored);
  if (canonical === null || UNSUPPORTED_OPERATORS.includes(String(stored))) return { supported: false, canonical: null, result: "NOT_COMPARABLE", reason: "OPERATOR_UNSUPPORTED" };
  if (canonical === "INFORMATIONAL") return { supported: false, canonical, result: "NOT_COMPARABLE", reason: "INFORMATIONAL_HAS_NO_COMPARISON" };
  if (!entry.requirementOperators.includes(canonical)) return { supported: false, canonical, result: "NOT_COMPARABLE", reason: entry.deferredOperators?.includes(canonical) ? "OPERATOR_SEMANTICS_DEFERRED" : "OPERATOR_NOT_DEFINED_FOR_MAPPING" };
  return { supported: true, canonical, result: null, reason: null };
};

// ---- range encoding ----------------------------------------------------------
// R1 stores two-sided facts as operator "Between". The audit found 22 of the 42
// stored Between rows are single numbers, and the matcher's compareAttribute has
// no Between branch (unknown operators fall through to Fail). The contract
// therefore fixes ONE canonical range shape and names every other stored form.
export const RANGE_VALUE_CONTRACT = deepFreeze({
  canonicalShape: { operator: "Between", lower: "finite number", upper: "finite number (>= lower)", unit: "non-empty string (never guessed)", lowerInclusive: true, upperInclusive: true, qualifiers: "string[] e.g. ['non-condensing']" },
  acceptedStoredForms: [
    { id: "PAIR_ARRAY", stored: "normalized_value JSON [lo,hi] with normalized_unit", examples: ["[65,110] dBA", "[89,99] dBA", "[0,60] °C"] },
    { id: "OBJECT_RANGE", stored: "normalized_value JSON {\"range\":[lo,hi],\"unit\":u}", examples: ["{\"range\":[0,60],\"unit\":\"°C\"}"] },
  ],
  rejectedStoredForms: [
    { id: "BETWEEN_WITH_SCALAR", example: "operator Between, value 48 (Voltage) / 6 (Current)", result: "NOT_COMPARABLE" },
    { id: "PROSE_RANGE_STRING", example: "operating_temperature \"0–49\" (en dash text)", result: "UNKNOWN_PRODUCT (product side) / UNKNOWN_PROJECT (requirement side)" },
    { id: "POINT_WITH_TOLERANCE", example: "operating_humidity \"93 ± 2\"", result: "UNKNOWN_PRODUCT" },
    { id: "UNIT_LESS_ENDPOINTS", example: "[12,200] without a unit", result: "NOT_COMPARABLE" },
    { id: "REVERSED_ENDPOINTS", example: "[110,65]", result: "NOT_COMPARABLE" },
  ],
  matcherCapabilityRequired: "Between is NOT evaluable by the current matcher; no mapping may be READY on a Between requirement until an explicit range comparison exists downstream.",
});

// Reference decoder for the range contract (pure; used by conformance tests).
export const decodeRangeValue = ({ operator, value, unit = null, side = "requirement", qualifiers = [] } = {}) => {
  const undecodable = side === "product" ? "UNKNOWN_PRODUCT" : "UNKNOWN_PROJECT";
  if (canonicalOperator(operator) !== "BETWEEN") return { ok: false, result: "NOT_COMPARABLE", reason: "OPERATOR_NOT_BETWEEN" };
  let decoded = value;
  if (typeof value === "string") { try { decoded = JSON.parse(value); } catch { return { ok: false, result: undecodable, reason: "PROSE_OR_UNPARSEABLE_VALUE" }; } }
  let pair = null;
  let rangeUnit = unit;
  if (Array.isArray(decoded)) pair = decoded;
  else if (decoded && typeof decoded === "object" && Array.isArray(decoded.range)) { pair = decoded.range; rangeUnit = decoded.unit ?? unit; }
  if (!pair || pair.length !== 2 || !pair.every((entry) => typeof entry === "number" && Number.isFinite(entry))) return { ok: false, result: "NOT_COMPARABLE", reason: "BETWEEN_WITHOUT_TWO_ENDPOINTS" };
  if (typeof rangeUnit !== "string" || rangeUnit.trim() === "") return { ok: false, result: "NOT_COMPARABLE", reason: "UNIT_MISSING" };
  if (pair[0] > pair[1]) return { ok: false, result: "NOT_COMPARABLE", reason: "REVERSED_ENDPOINTS" };
  return { ok: true, range: { operator: "Between", lower: pair[0], upper: pair[1], unit: rangeUnit, lowerInclusive: true, upperInclusive: true, qualifiers: [...qualifiers] } };
};

// Reference decoder for verbatim unit-bearing scalars (fixed setpoint, ROR).
export const decodeVerbatimScalar = (entry, text) => {
  const grammar = entry.valueGrammar?.source;
  if (!grammar) return { ok: false, result: "NOT_COMPARABLE", reason: "NO_GRAMMAR_FOR_MAPPING" };
  const match = new RegExp(grammar).exec(String(text ?? "").trim());
  if (!match) return { ok: false, result: "NOT_COMPARABLE", reason: "VALUE_OUTSIDE_GRAMMAR" };
  return { ok: true, value: Number(match[1]), unit: match[2] ?? entry.valueGrammar.impliedUnit ?? null };
};
// Unit policy shared by verbatim scalars: same unit compares; anything else is refused.
export const compareUnitPolicy = (left, right) => (left && right && left === right ? { comparable: true } : { comparable: false, result: "NOT_COMPARABLE", reason: "UNIT_DIFFERS_NO_CONVERSION_RULE" });

// ---- unsupported-encoding semantics ------------------------------------------
// Rules are evaluated IN THE LISTED ORDER; the first that applies decides the
// outcome. FAIL is reachable only through the last rule.
export const UNSUPPORTED_ENCODING_RULES = deepFreeze([
  { id: "REQUIREMENT_OPERATOR_UNSUPPORTED", when: "requirement operator does not resolve to a canonical operator allowed for the mapping (e.g. Excludes, Compatible With, Minimum on an option set)", result: "NOT_COMPARABLE" },
  { id: "BETWEEN_NOT_A_PAIR", when: "operator Between whose value is not two finite ordered endpoints with a unit", result: "NOT_COMPARABLE" },
  { id: "UNIT_MISSING_OR_UNCONVERTIBLE", when: "either side lacks a unit, or units differ and no conversion rule exists (°F vs °C, dB vs dBA)", result: "NOT_COMPARABLE" },
  { id: "SUBJECT_UNKNOWN_OR_MISMATCHED", when: "subject-bound value without subject/mode metadata on both sides, or different subjects", result: "NOT_COMPARABLE" },
  { id: "PRODUCT_VALUE_UNDECODABLE", when: "product value is prose, a point-with-tolerance, an option list under a scalar mapping, or otherwise outside the mapping's value grammar", result: "UNKNOWN_PRODUCT" },
  { id: "REQUIREMENT_VALUE_UNDECODABLE", when: "requirement value cannot be decoded under the mapping's value kind", result: "UNKNOWN_PROJECT" },
  { id: "MAPPING_NOT_READY", when: "mapping status is not READY*", result: "entry.resultWhileNotReady (never PASS or FAIL)" },
  { id: "EXPLICIT_MISMATCH", when: "mapping READY AND both encodings decode AND operator supported AND values provably violate the requirement", result: "FAIL" },
]);
export const DEFAULT_RESULT_ON_UNSUPPORTED = "NOT_COMPARABLE";

const NON_VERDICT_OUTCOMES = ["UNKNOWN_PRODUCT", "UNKNOWN_PROJECT", "NOT_APPLICABLE", "APPLICATION_REVIEW", "NOT_COMPARABLE"];
export const isReady = (entry) => READY_STATES.includes(entry.status);
export const allowedOutcomes = (entry) => (isReady(entry) ? ["PASS", "FAIL", ...NON_VERDICT_OUTCOMES] : [...NON_VERDICT_OUTCOMES]);

// ---- known downstream gaps (documented, NOT repaired by this contract) ---------
export const DOWNSTREAM_MATCHER_GAPS = deepFreeze([
  { id: "UNKNOWN_OPERATOR_FALLS_TO_FAIL", location: "app/domain/product-matching-engine.mjs compareAttribute, lines 158-168", detail: "`let pass = false` is only set by the listed operators (Equal/Equals/Exact, Minimum, Maximum, Greater Than, Less Than, Includes/Supports, One Of, All Of, Not Equal/Excludes); any other operator returns result 'Fail' (blocking).", requiredFix: "unknown operator -> NOT_COMPARABLE, never Fail", status: "OPEN (downstream)" },
  { id: "BETWEEN_NOT_EVALUATED", location: "app/domain/product-matching-engine.mjs compareAttribute", detail: "no Between / range-containment branch; a stored Between row therefore evaluates as Fail.", requiredFix: "explicit REQUIRED_RANGE_WITHIN_CAPABILITY_RANGE comparison", status: "OPEN (downstream)" },
  { id: "MISSING_EVIDENCE_LABELLED_NON_COMPLIANT", location: "matchrun_ad500e07-b013-4aa0-9d93-c16bee6472a6 candidate_a5816df5 (IDP-HEAT-ROR-IV)", detail: "all four findings are 'Missing Product Data' / 'Evidence Missing' yet technical_status is 'Non-Compliant' / recommendation 'Rejected Candidate'.", requiredFix: "surface UNKNOWN_PRODUCT distinct from incompatibility", status: "OPEN (downstream)" },
  { id: "NO_SET_COMPARATOR_FOR_OPTION_LISTS", location: "app/domain/product-matching-engine.mjs compareAttribute", detail: "'Includes' is a normalized substring test over text; there is no comparator for tokenized option sets (candela lists).", requiredFix: "explicit SET_CONTAINS over tokenized options", status: "OPEN (downstream)" },
]);

// Pairs that must never be compared, whatever the mapping status says.
export const UNSAFE_PAIRS = deepFreeze([
  { id: "SOUND_DB_VS_DBA", state: "UNSAFE_TO_COMPARE", detail: "requirement dBA (A-weighted) vs product numeric 'dB' rows (SPSWL 80, SPSRK 83): weighting differs; no conversion exists." },
  { id: "SOUND_MEASUREMENT_BASIS", state: "UNSAFE_TO_COMPARE", detail: "product sound values carry measurement basis (anechoic vs reverberant, distance, drive voltage, tap); a requirement without the same basis is not comparable to them." },
  { id: "BATTERY_SUBJECTS", state: "UNSAFE_TO_COMPARE", detail: "battery_capacity (a battery SKU) vs battery_capacity_in_cabinet (\"2 × 7\" Ah) vs battery_charger_capacity (\"7–35\" Ah range a charger supports) are different subjects that share the unit Ah." },
  { id: "HUMIDITY_POINT_WITH_TOLERANCE", state: "UNSAFE_TO_COMPARE", detail: "operating_humidity \"93 ± 2\" (% RH, at 32°C) is a tested point, not an interval; no capability range can be derived." },
  { id: "PROTOCOL_IDP_AMBIGUOUS", state: "UNSAFE_TO_COMPARE", detail: "product protocol \"IDP\" is AMBIGUOUS (P2); it is neither evidence for nor against FlashScan/CLIP." },
  { id: "BETWEEN_WITH_SCALAR", state: "UNSAFE_TO_COMPARE", detail: "stored Between rows holding one number (Voltage 5, Current 16, Bandwidth 1) are malformed ranges." },
  { id: "CROSS_SUBJECT_ELECTRICAL", state: "UNSAFE_TO_COMPARE", detail: "operating vs contact vs supply voltage/current, standby vs alarm current, loop vs zone vs device vs battery capacity." },
]);

// ---- the map -----------------------------------------------------------------
// status is the blocker that must be cleared FIRST (it is always one of
// `blockers`); READY_EXACT_ONLY entries list what is deferred in `blockers`.
// resultWhileNotReady is the ONLY outcome a non-READY mapping may report;
// mismatchResultWhenReady is what a provable mismatch yields once (and only
// once) the mapping is READY.
export const ATTRIBUTE_MAP = deepFreeze([
  {
    key: "fixed_temperature_setpoint", requirementAttribute: "fixed_temperature_setpoint", productAttribute: "fixed_temperature_setpoint",
    comparisonType: "EQUALS", valueKind: "SCALAR", requirementOperators: ["EQUALS"], unitDimension: "temperature",
    valueGrammar: { source: "^(-?\\d+(?:\\.\\d+)?)°([FC])$", impliedUnit: null },
    unitPolicy: "same unit only; °F vs °C is NOT_COMPARABLE (no conversion rule: 135°F is not exactly 57°C)",
    normalization: "verbatim '<number>°<F|C>' on both sides (requirement rows JSON-quoted string; product legacy attribute string)",
    operatorSelect: null, qualifierPolicy: "none", missingEvidenceResult: "UNKNOWN_PRODUCT", mismatchResultWhenReady: "FAIL", unsupportedEncodingResult: "NOT_COMPARABLE", resultWhileNotReady: null,
    status: "READY_FOR_MATCHER_IMPLEMENTATION", blockers: [], provenance: "P0 verbatim pattern; both stores hold the identical verbatim grammar", v1Status: "READY_FOR_MATCHER_IMPLEMENTATION",
  },
  {
    key: "rate_of_rise_sensitivity", requirementAttribute: "rate_of_rise_sensitivity", productAttribute: "rate_of_rise_sensitivity",
    comparisonType: "EQUALS", valueKind: "SCALAR", requirementOperators: ["EQUALS"], unitDimension: "temperature-per-time",
    valueGrammar: { source: "^(\\d+(?:\\.\\d+)?)°(F/min)$", impliedUnit: null },
    unitPolicy: "same unit only", normalization: "verbatim '<number>°F/min' on both sides",
    deferred: ["threshold / direction semantics (does a product's trip rate satisfy 'at least N °F/min'?)"],
    operatorSelect: null, qualifierPolicy: "none", missingEvidenceResult: "UNKNOWN_PRODUCT", mismatchResultWhenReady: "FAIL", unsupportedEncodingResult: "NOT_COMPARABLE", resultWhileNotReady: null,
    status: "READY_EXACT_ONLY", blockers: ["DEFERRED_SEMANTICS"], provenance: "P0 verbatim pattern; EXACT equality only is proven; every non-equality operator is refused (NOT_COMPARABLE)", v1Status: "READY_FOR_MATCHER_IMPLEMENTATION",
  },
  {
    key: "addressing", requirementAttribute: "addressing", productAttribute: "addressing",
    comparisonType: "ENUM_MATCH", valueKind: "ENUM", requirementOperators: ["EQUALS"], unitDimension: null,
    vocabulary: ["Addressable", "Conventional"],
    normalization: "decode: JSON-decode when valid JSON, else use the raw text (requirement rows exist in both forms: \"Addressable\" and Addressable); value must be in the closed vocabulary else NOT_COMPARABLE",
    operatorSelect: null, qualifierPolicy: "none", missingEvidenceResult: "UNKNOWN_PRODUCT", mismatchResultWhenReady: "FAIL", unsupportedEncodingResult: "NOT_COMPARABLE", resultWhileNotReady: null,
    status: "READY_FOR_MATCHER_IMPLEMENTATION", blockers: [], provenance: "P0 explicit-statement pattern; product legacy values are exactly Addressable/Conventional", v1Status: "READY_FOR_MATCHER_IMPLEMENTATION",
  },
  {
    key: "protocol", requirementAttribute: "protocol", productAttribute: "protocol",
    comparisonType: "SET_CONTAINS", valueKind: "RELATIONSHIP_SET", requirementOperators: ["EQUALS"], unitDimension: null,
    normalization: "requirement side is NOT a stored set: it is free text in requirement_compatibility.target_item (\"Flash Scan® and CLIP protocol systems\", mandatory=0, 2 of 5 rows with trailing clause text) and must first be decomposed into a protocol set + relationship; product side is a single scalar (\"IDP\", ambiguous)",
    operatorSelect: "SET_CONTAINS vs SET_INTERSECTS chosen by the requirement's relationship (both-mandatory AND vs open plural); relationship must be persisted, not inferred",
    qualifierPolicy: "none", missingEvidenceResult: "UNKNOWN_PRODUCT",
    mismatchResultWhenReady: "UNKNOWN_PRODUCT", mismatchNote: "a product protocol set is not proven exhaustive, so absence of FlashScan/CLIP is never a provable mismatch; FAIL is not permitted until a product-side exhaustive-set flag exists",
    unsupportedEncodingResult: "NOT_COMPARABLE", resultWhileNotReady: "UNKNOWN_PRODUCT",
    status: "NEEDS_VALUE_NORMALIZATION", blockers: ["NEEDS_VALUE_NORMALIZATION", "NEEDS_PRODUCT_LIBRARY_EVIDENCE"], provenance: "P2 vocabulary; relationship-aware set rule; requirement decomposition and product protocol evidence both missing", v1Status: "READY_FOR_MATCHER_IMPLEMENTATION",
  },
  {
    key: "sound_output", requirementAttribute: "sound_output", productAttribute: "sound_output",
    comparisonType: "MINIMUM_REQUIRED", valueKind: "SCALAR", requirementOperators: ["MINIMUM", "MAXIMUM", "EQUALS"], deferredOperators: ["BETWEEN"], unitDimension: "sound-pressure-level (dBA)",
    unitPolicy: "dBA only; requirement rows are 'N dBA' strings (unit inside the string), a legacy numeric with unit dB, and Between pairs with unit dBA; product numeric rows are dB; dB vs dBA is refused",
    normalization: "requires a numeric product value with unit dBA AND its measurement basis (distance, room type, drive voltage); the real product values are prose",
    operatorSelect: "row operator selects EQUALS / MINIMUM_REQUIRED / MAXIMUM_ALLOWED; Between on sound output is ambiguous (bound vs capability, e.g. '89 – 99 dBA range') and DEFERRED",
    qualifierPolicy: "measurement basis must match or be absent on both sides; otherwise UNKNOWN_PRODUCT", missingEvidenceResult: "UNKNOWN_PRODUCT", mismatchResultWhenReady: "FAIL", unsupportedEncodingResult: "NOT_COMPARABLE", resultWhileNotReady: "UNKNOWN_PRODUCT",
    status: "NEEDS_VALUE_NORMALIZATION", blockers: ["NEEDS_VALUE_NORMALIZATION", "NEEDS_MATCHER_CAPABILITY", "DEFERRED_SEMANTICS"], provenance: "P6 dBA pattern (R1-corrected); product side 73 of 76 rows prose", v1Status: "READY_FOR_MATCHER_IMPLEMENTATION",
  },
  {
    key: "candela_rating", requirementAttribute: "candela_rating", productAttribute: "candela_rating",
    comparisonType: "SET_CONTAINS", valueKind: "SET", requirementOperators: ["EQUALS"], unitDimension: "luminous-intensity (cd)",
    normalization: "product value is a comma-separated OPTION SET in prose (\"15, 30, 75, 95 …\", some with 'Standard cd:' / 'High cd:' groups and slash pairs like 15/75); requirement value is an option token ('15/75 cd'); the correct semantics is token membership, NOT a scalar minimum",
    operatorSelect: "EQUALS is token membership; Minimum/Maximum on an option set is NOT defined -> NOT_COMPARABLE",
    qualifierPolicy: "group labels (Standard / High) must be preserved when tokenizing", missingEvidenceResult: "UNKNOWN_PRODUCT", mismatchResultWhenReady: "FAIL", unsupportedEncodingResult: "NOT_COMPARABLE", resultWhileNotReady: "UNKNOWN_PRODUCT",
    status: "NEEDS_VALUE_NORMALIZATION", blockers: ["NEEDS_VALUE_NORMALIZATION"], provenance: "P6 explicit-cd pattern (R1: alternatives are unresolved); v1 MINIMUM_REQUIRED replaced by SET_CONTAINS", v1Status: "READY_FOR_MATCHER_IMPLEMENTATION",
  },
  {
    key: "battery_capacity", requirementAttribute: "battery_capacity", productAttribute: "battery_capacity",
    comparisonType: "SUBJECT_BOUND_COMPARISON", innerComparisonType: "MINIMUM_REQUIRED", valueKind: "SUBJECT_BOUND", requirementOperators: ["MINIMUM", "EQUALS"], unitDimension: "charge-capacity (Ah)",
    subject: { compared: "battery_unit_capacity", excluded: ["charger_supported_battery_range", "cabinet_battery_capacity", "loop_capacity", "device_capacity"] },
    normalization: "requirement rows: none currently (R1 removed the false one); product: 5 'N AH' scalars on battery SKUs whose role is 'Unclassified', 2 'NNV / NNAH @ 20hr rate' prose values; separate modern attributes battery_capacity_in_cabinet (\"2 × 7\") and battery_charger_capacity (\"7–35\") are different subjects sharing Ah",
    operatorSelect: "row operator selects EQUALS / MINIMUM_REQUIRED, only within subject battery_unit_capacity", qualifierPolicy: "discharge-rate condition ('@ 20hr rate') must be recorded on the product value",
    missingEvidenceResult: "UNKNOWN_PRODUCT", mismatchResultWhenReady: "FAIL", unsupportedEncodingResult: "NOT_COMPARABLE", resultWhileNotReady: "NOT_COMPARABLE",
    status: "NEEDS_PRODUCT_SUBJECT_METADATA", blockers: ["NEEDS_PRODUCT_SUBJECT_METADATA", "NEEDS_VALUE_NORMALIZATION"], provenance: "P6 AH pattern (R1: capability ranges excluded); no subject flag on any product row", v1Status: "READY_FOR_MATCHER_IMPLEMENTATION",
  },
  {
    key: "temperature_range", requirementAttribute: "temperature_range", productAttribute: "operating_temperature",
    comparisonType: "REQUIRED_RANGE_WITHIN_CAPABILITY_RANGE", valueKind: "RANGE", requirementOperators: ["BETWEEN"], unitDimension: "temperature",
    normalization: "requirement side has three encodings (legacy 'Temperature' pair array with unit °C x16, 'temperature_range' object x2, and stored Between scalars elsewhere); product side exists only as modern operating_temperature \"0–49\" (prose en-dash string, unit °C) x5 and in no legacy attribute; see RANGE_VALUE_CONTRACT",
    operatorSelect: null, qualifierPolicy: "unsupported required qualifier forces UNKNOWN_PRODUCT, never PASS", missingEvidenceResult: "UNKNOWN_PRODUCT", mismatchResultWhenReady: "FAIL", unsupportedEncodingResult: "NOT_COMPARABLE", resultWhileNotReady: "UNKNOWN_PRODUCT",
    status: "NEEDS_PRODUCT_VOCABULARY_ALIGNMENT", blockers: ["NEEDS_PRODUCT_VOCABULARY_ALIGNMENT", "NEEDS_VALUE_NORMALIZATION", "NEEDS_MATCHER_CAPABILITY"], provenance: "P7 envelope semantics; requirement-vs-capability pair, not an equality alias", v1Status: "NEEDS_PRODUCT_VOCABULARY_ALIGNMENT",
  },
  {
    key: "humidity_range", requirementAttribute: "humidity_range", productAttribute: "operating_humidity",
    comparisonType: "REQUIRED_RANGE_WITHIN_CAPABILITY_RANGE", valueKind: "RANGE", requirementOperators: ["MAXIMUM", "BETWEEN"], unitDimension: "humidity",
    normalization: "requirement rows: Maximum \"95%\" (unit %) x2, Between pair via R1 grammar; product operating_humidity is \"93 ± 2\" (unit '% RH non-condensing', tested at 32°C): a point with tolerance, not an interval, so no capability range is derivable",
    operatorSelect: null, qualifierPolicy: "non-condensing and test-temperature qualifiers must be preserved and matched; unsupported required qualifier forces UNKNOWN_PRODUCT", missingEvidenceResult: "UNKNOWN_PRODUCT", mismatchResultWhenReady: "FAIL", unsupportedEncodingResult: "NOT_COMPARABLE", resultWhileNotReady: "UNKNOWN_PRODUCT",
    status: "NEEDS_PRODUCT_VOCABULARY_ALIGNMENT", blockers: ["NEEDS_PRODUCT_VOCABULARY_ALIGNMENT", "NEEDS_VALUE_NORMALIZATION", "NEEDS_MATCHER_CAPABILITY"], provenance: "P7 envelope semantics; requirement-vs-capability pair", v1Status: "NEEDS_PRODUCT_VOCABULARY_ALIGNMENT",
  },
  {
    key: "Voltage", requirementAttribute: "Voltage", productAttribute: null,
    comparisonType: "SUBJECT_BOUND_COMPARISON", valueKind: "SUBJECT_BOUND", requirementOperators: ["EQUALS", "MINIMUM", "MAXIMUM"], unitDimension: "voltage",
    normalization: "numeric rows with unit V on both sides (requirement x280, product legacy x82) but NO subject/mode on either side; requirement operators include malformed Between-with-scalar (5), Compatible With (1), Excludes (1)",
    operatorSelect: null, qualifierPolicy: "subject/mode required (operating vs contact vs supply)", missingEvidenceResult: "UNKNOWN_PRODUCT", mismatchResultWhenReady: "NOT_COMPARABLE", unsupportedEncodingResult: "NOT_COMPARABLE", resultWhileNotReady: "NOT_COMPARABLE",
    status: "NEEDS_PRODUCT_SUBJECT_METADATA", blockers: ["NEEDS_PRODUCT_SUBJECT_METADATA"], provenance: "P8: context decides; requirement rows also lack subject metadata", v1Status: "NEEDS_PRODUCT_SUBJECT_METADATA",
  },
  {
    key: "Current", requirementAttribute: "Current", productAttribute: null,
    comparisonType: "SUBJECT_BOUND_COMPARISON", valueKind: "SUBJECT_BOUND", requirementOperators: ["EQUALS", "MINIMUM", "MAXIMUM", "GREATER_THAN", "LESS_THAN"], unitDimension: "current",
    normalization: "numeric rows, units A (287) and mA (17) on the requirement side x304 with 16 malformed Between-with-scalar; product legacy x17 numeric plus prose standby/alarm current; no mode on either side",
    operatorSelect: null, qualifierPolicy: "standby vs alarm mode required", missingEvidenceResult: "UNKNOWN_PRODUCT", mismatchResultWhenReady: "NOT_COMPARABLE", unsupportedEncodingResult: "NOT_COMPARABLE", resultWhileNotReady: "NOT_COMPARABLE",
    status: "NEEDS_PRODUCT_SUBJECT_METADATA", blockers: ["NEEDS_PRODUCT_SUBJECT_METADATA"], provenance: "P8: standby_current vs alarm_current undecidable without mode", v1Status: "NEEDS_PRODUCT_SUBJECT_METADATA",
  },
  {
    key: "Capacity", requirementAttribute: "Capacity", productAttribute: null,
    comparisonType: "SUBJECT_BOUND_COMPARISON", valueKind: "SUBJECT_BOUND", requirementOperators: ["EQUALS", "MINIMUM", "MAXIMUM"], unitDimension: "count (subject-typed)",
    normalization: "requirement x15 numbers whose units are the subject (POINTS 6, DEVICES 4, CHANNELS 3, DETECTORS 1, NODES 1); product has numeric Capacity x14 plus differently-named modern capacities (detector/module/panel/network capacity, slc_loop_count)",
    operatorSelect: null, qualifierPolicy: "subject required (loop/zone/device/battery)", missingEvidenceResult: "UNKNOWN_PRODUCT", mismatchResultWhenReady: "NOT_COMPARABLE", unsupportedEncodingResult: "NOT_COMPARABLE", resultWhileNotReady: "NOT_COMPARABLE",
    status: "NEEDS_PRODUCT_SUBJECT_METADATA", blockers: ["NEEDS_PRODUCT_SUBJECT_METADATA"], provenance: "P8: loop vs zone vs device vs battery capacities are different dimensions", v1Status: "NEEDS_PRODUCT_SUBJECT_METADATA",
  },
  {
    key: "Power", requirementAttribute: "Power", productAttribute: null,
    comparisonType: "SUBJECT_BOUND_COMPARISON", valueKind: "SUBJECT_BOUND", requirementOperators: ["EQUALS", "MINIMUM", "MAXIMUM", "LESS_THAN"], unitDimension: "power",
    normalization: "requirement x80 numbers with units W/KW/VA/KVA and no subject; product numeric Power x13; acoustic wattage and electrical power share the unit W",
    operatorSelect: null, qualifierPolicy: "subject required", missingEvidenceResult: "UNKNOWN_PRODUCT", mismatchResultWhenReady: "NOT_COMPARABLE", unsupportedEncodingResult: "NOT_COMPARABLE", resultWhileNotReady: "NOT_COMPARABLE",
    status: "NEEDS_PRODUCT_SUBJECT_METADATA", blockers: ["NEEDS_PRODUCT_SUBJECT_METADATA"], provenance: "P8: power_rating vs acoustic output wattage differ", v1Status: "NEEDS_PRODUCT_SUBJECT_METADATA",
  },
  {
    key: "listing", requirementAttribute: "listing", productAttribute: "standards",
    comparisonType: "SET_CONTAINS", valueKind: "SET", requirementOperators: ["EQUALS"], unitDimension: null,
    normalization: "requirement side: requirement_standards rows (body, number, part, year, status) carrying parser artifacts (null numbers, 'BS' + 'EN', 'UL' + 'listed'); product side: library_products.standards JSON on 170 of 951 products (86 distinct designations incl. file numbers like 'UL S2101' and generic 'UL Listed') plus product_certifications; canonical identities come from P3 standard identities",
    operatorSelect: "compare only LISTED_TO / CERTIFIED_TO / APPROVED / TESTED_TO requirements against product LISTING evidence; installation codes (NFPA 72), quality certification (ISO 9001) and reference entries are NOT product-listing comparisons (NOT_COMPARABLE)",
    qualifierPolicy: "standard edition/year must match when stated", missingEvidenceResult: "UNKNOWN_PRODUCT", mismatchResultWhenReady: "UNKNOWN_PRODUCT", mismatchNote: "absence of a listing in the library is missing evidence, never proof the product is unlisted",
    unsupportedEncodingResult: "NOT_COMPARABLE", resultWhileNotReady: "UNKNOWN_PRODUCT",
    status: "NEEDS_PRODUCT_LIBRARY_EVIDENCE", blockers: ["NEEDS_PRODUCT_LIBRARY_EVIDENCE", "NEEDS_VALUE_NORMALIZATION"], provenance: "P3 standards semantics: listing != compatibility; product listing evidence is incomplete (UL 268 on 13 products, UL 864 on 8, UL 217 on 0; IDP-HEAT-ROR-IV carries only file number 'UL S2101')", v1Status: null,
  },
]);

// v1.0.0 readiness claims, kept for audit traceability (not part of the map).
export const SUPERSEDED_V1_READINESS = deepFreeze({
  fixed_temperature_setpoint: "READY_FOR_MATCHER_IMPLEMENTATION", rate_of_rise_sensitivity: "READY_FOR_MATCHER_IMPLEMENTATION", addressing: "READY_FOR_MATCHER_IMPLEMENTATION",
  protocol: "READY_FOR_MATCHER_IMPLEMENTATION", sound_output: "READY_FOR_MATCHER_IMPLEMENTATION", candela_rating: "READY_FOR_MATCHER_IMPLEMENTATION", battery_capacity: "READY_FOR_MATCHER_IMPLEMENTATION",
  temperature_range: "NEEDS_PRODUCT_VOCABULARY_ALIGNMENT", humidity_range: "NEEDS_PRODUCT_VOCABULARY_ALIGNMENT",
  Voltage: "NEEDS_PRODUCT_SUBJECT_METADATA", Current: "NEEDS_PRODUCT_SUBJECT_METADATA", Capacity: "NEEDS_PRODUCT_SUBJECT_METADATA", Power: "NEEDS_PRODUCT_SUBJECT_METADATA",
});

// Dated evidence snapshot behind the grades (NOT part of the fingerprint: it is
// measured data, not contract semantics). Source: runtime D1, read-only copy,
// 2026-09-21, after the R1 data correction.
export const INVENTORY_MEASURED_AT = "2026-09-21";
export const VALUE_ENCODING_INVENTORY = deepFreeze({
  fixed_temperature_setpoint: { requirement: { rows: 4, operators: { Equal: 4 }, form: "JSON string with unit inside, e.g. \"135°F\" (3), \"190°F\" (1); normalized_unit null" }, product: { legacyJson: { rows: 5, form: "string \"135°F\"", operators: "none/Equal" }, modern: { rows: 0 } }, normalized: true, directlyComparable: true, why: "identical verbatim grammar on both sides; same-unit equality is executable" },
  rate_of_rise_sensitivity: { requirement: { rows: 1, operators: { Equal: 1 }, form: "JSON string \"15°F/min\"" }, product: { legacyJson: { rows: 2, form: "string \"15°F/min\"", operators: "Informational/none" }, modern: { rows: 0 } }, normalized: true, directlyComparable: true, why: "identical verbatim grammar; only equality is proven, threshold semantics undefined" },
  addressing: { requirement: { rows: 4, operators: { Equal: 4 }, form: "\"Addressable\" JSON string (3) and raw Addressable (1)" }, product: { legacyJson: { rows: 64, form: "\"Addressable\" 47 / \"Conventional\" 17", operators: "none/Equal/Informational" }, modern: { rows: 0, note: "device_addressing_method x1 is a different name" } }, normalized: true, directlyComparable: true, why: "closed two-value vocabulary on both sides" },
  protocol: { requirement: { rows: 0, form: "not in requirement_attributes; requirement_compatibility.target_item free text, 5 PROTOCOL-typed rows, mandatory=0, 2 with trailing clause text" }, product: { legacyJson: { rows: 26, form: "scalar \"IDP\" only" }, modern: { rows: 0 } }, normalized: false, directlyComparable: false, why: "requirement is an undecomposed string; product is one ambiguous scalar; no FlashScan/CLIP product evidence" },
  sound_output: { requirement: { rows: 5, operators: { Minimum: 3, Between: 2 }, form: "Minimum \"75 dBA\"/\"85 dBA\" (unit in string), legacy Minimum 82 unit dB, Between [65,110] and [89,99] unit dBA" }, product: { legacyJson: { rows: 76, form: "73 prose (70 with measurement-condition wording, 21 with >1 dBA figure, 16 distinct strings), 3 numeric 'dB' Equal", operators: "Informational x73, Equal x3" }, modern: { rows: 0 } }, normalized: false, directlyComparable: false, why: "product values are prose; the only numeric product rows are dB, not dBA; Between semantics on sound output are ambiguous" },
  candela_rating: { requirement: { rows: 0, form: "none after R1 (alternatives unresolved); single 'N/M cd' tokens would be option tokens" }, product: { legacyJson: { rows: 66, form: "comma-separated option lists in prose, 7 distinct; 32 with Standard/High group labels; 31 with slash pairs", operators: "Informational x66" }, modern: { rows: 0 } }, normalized: false, directlyComparable: false, why: "an option SET is not a scalar minimum; product lists are untokenized prose" },
  battery_capacity: { requirement: { rows: 0, form: "none after R1" }, product: { legacyJson: { rows: 7, form: "5 'N AH' on role-Unclassified battery SKUs; 2 'NNV / NNAH @ 20hr rate' on Primary Equipment", operators: "none/Equal" }, modern: { rows: 8, form: "battery_capacity_in_cabinet \"2 × 7\" Ah x4; battery_charger_capacity \"7–35\" Ah x4" } }, normalized: false, directlyComparable: false, why: "same unit, different subjects; no subject flag; some values carry discharge-rate prose" },
  temperature_range: { requirement: { rows: 18, operators: { Between: 18 }, form: "legacy Temperature pair [lo,hi] unit °C x16; temperature_range object {range,unit} x2" }, product: { legacyJson: { rows: 0 }, modern: { rows: 5, form: "operating_temperature \"0–49\" (en dash string) unit °C" } }, normalized: false, directlyComparable: false, why: "different attribute names, three encodings, product side prose range in the modern store only" },
  humidity_range: { requirement: { rows: 2, operators: { Maximum: 2 }, form: "Maximum \"95%\" unit %" }, product: { legacyJson: { rows: 0 }, modern: { rows: 4, form: "operating_humidity \"93 ± 2\" unit '% RH non-condensing', original '93% ± 2% RH (non-condensing) at 32°C ± 2°C'" } }, normalized: false, directlyComparable: false, why: "requirement is a one-sided bound, product is a tolerance point at a test temperature" },
  Voltage: { requirement: { rows: 280, operators: { Equals: 254, Minimum: 19, Between: 5, "Compatible With": 1, Excludes: 1 }, form: "number, unit V; Between rows hold one number" }, product: { legacyJson: { rows: 82, form: "number + unit field", operators: "Equals 68 / Maximum 8 / Minimum 6" }, modern: { rows: 1, form: "operating_voltage unit VDC" } }, normalized: true, directlyComparable: false, why: "numeric and unit-normalized but subject/mode absent on both sides" },
  Current: { requirement: { rows: 304, operators: { Equals: 263, Between: 16, Minimum: 12, "Greater Than": 8, Maximum: 4, Excludes: 1 }, form: "number, unit A (287) / mA (17); Between rows hold one number" }, product: { legacyJson: { rows: 17, form: "number + unit field; plus prose standby_current x5 / alarm_current x3" }, modern: { rows: 2, form: "standby_current, alarm_current unit mA" } }, normalized: true, directlyComparable: false, why: "standby vs alarm mode absent" },
  Capacity: { requirement: { rows: 15, operators: { Equals: 8, Maximum: 6, Minimum: 1 }, form: "number; unit is the subject (POINTS/DEVICES/CHANNELS/DETECTORS/NODES)" }, product: { legacyJson: { rows: 14, form: "number + unit field" }, modern: { rows: 20, form: "detector/module/panel/network capacity, slc_loop_count" } }, normalized: true, directlyComparable: false, why: "different capacity dimensions share one attribute name" },
  Power: { requirement: { rows: 80, operators: { Equals: 67, Minimum: 9, Maximum: 2, "Less Than": 1, Excludes: 1 }, form: "number, unit W/KW/VA/KVA" }, product: { legacyJson: { rows: 13, form: "number + unit field" }, modern: { rows: 0 } }, normalized: true, directlyComparable: false, why: "electrical vs acoustic power share the unit; no subject" },
  listing: { requirement: { rows: 2911, form: "requirement_standards (body, number, part, year, status) incl. parser artifacts (null numbers, BS+EN, UL+listed)" }, product: { legacyJson: { rows: 170, form: "library_products.standards JSON on 170/951 products, 86 distinct designations (UL 268: 13, UL 864: 8, UL 217: 0, UL 1971: 56; file numbers 'UL S####'; generic 'UL Listed')" }, modern: { rows: 16, form: "product_certifications" } }, normalized: false, directlyComparable: false, why: "library evidence is partial and un-normalized; requirement side needs P3 identity resolution" },
});

// ---- freeze / drift detection --------------------------------------------------
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
};
export const contractSnapshot = () => ({
  version: ATTRIBUTE_COMPARISON_MAP_VERSION,
  supersedes: SUPERSEDED_VERSION,
  comparisonTypes: COMPARISON_TYPES,
  resultSemantics: RESULT_SEMANTICS,
  readinessStates: READINESS_STATES,
  readyStates: READY_STATES,
  valueKinds: VALUE_KINDS,
  operators: OPERATORS,
  unsupportedOperators: UNSUPPORTED_OPERATORS,
  rangeValueContract: RANGE_VALUE_CONTRACT,
  unsupportedEncodingRules: UNSUPPORTED_ENCODING_RULES,
  downstreamMatcherGaps: DOWNSTREAM_MATCHER_GAPS,
  unsafePairs: UNSAFE_PAIRS,
  supersededV1Readiness: SUPERSEDED_V1_READINESS,
  failIsNeverDefault: FAIL_IS_NEVER_DEFAULT,
  missingIsNotIncompatible: MISSING_IS_NOT_INCOMPATIBLE,
  attributeMap: ATTRIBUTE_MAP,
});
export const canonicalContractJson = () => JSON.stringify(canonicalize(contractSnapshot()));
// cyrb53: dependency-free deterministic drift detector (NOT a security hash; the
// test suite additionally pins a SHA-256 of the same canonical JSON).
export const contractFingerprint = () => {
  const text = canonicalContractJson();
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
};
