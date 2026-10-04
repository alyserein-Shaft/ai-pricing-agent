import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  ATTRIBUTE_COMPARISON_MAP_VERSION, SUPERSEDED_VERSION, ATTRIBUTE_MAP, COMPARISON_TYPES, RESULT_SEMANTICS, MISSING_IS_NOT_INCOMPATIBLE, FAIL_IS_NEVER_DEFAULT,
  READINESS_STATES, READY_STATES, VALUE_KINDS, OPERATORS, UNSUPPORTED_OPERATORS, RANGE_VALUE_CONTRACT, UNSUPPORTED_ENCODING_RULES, DEFAULT_RESULT_ON_UNSUPPORTED,
  DOWNSTREAM_MATCHER_GAPS, UNSAFE_PAIRS, SUPERSEDED_V1_READINESS, VALUE_ENCODING_INVENTORY, INVENTORY_MEASURED_AT,
  canonicalOperator, operatorSupport, decodeRangeValue, decodeVerbatimScalar, compareUnitPolicy, isReady, allowedOutcomes, canonicalContractJson, contractFingerprint,
} from "../app/domain/attribute-comparison-contract.mjs";
import { CONTRACT_VERSION, CONFORMANCE_FIXTURES } from "./fixtures/attribute-comparison-contract.fixture.mjs";

// P10 contract conformance (R2). Never calls the production matcher: validates
// fixtures against the frozen contract and its own pure reference decoders.

const entryOf = (key) => ATTRIBUTE_MAP.find((entry) => entry.key === key);
const fixtureOf = (id) => CONFORMANCE_FIXTURES.find((entry) => entry.id === id);
const ruleResult = (fixture) => {
  const rule = UNSUPPORTED_ENCODING_RULES.find((candidate) => candidate.id === fixture.rule);
  return rule.id === "MAPPING_NOT_READY" ? entryOf(fixture.mapping).resultWhileNotReady : rule.result;
};

// ---- 10. exact freeze --------------------------------------------------------------
const PINNED_CYRB53 = "170e5374e14768";
const PINNED_SHA256 = "6ad34df98c214658610ea46e58f09627272aed4e8da80672d97f4982a43efdb1";

test("10. contract version, supersession and fixture pin", () => {
  assert.equal(ATTRIBUTE_COMPARISON_MAP_VERSION, "2.0.0");
  assert.equal(SUPERSEDED_VERSION, "1.0.0");
  assert.equal(CONTRACT_VERSION, ATTRIBUTE_COMPARISON_MAP_VERSION, "fixtures pin the contract version");
  assert.match(INVENTORY_MEASURED_AT, /^\d{4}-\d{2}-\d{2}$/);
});

test("10. exact map count, identity and order are frozen", () => {
  assert.equal(ATTRIBUTE_MAP.length, 14);
  assert.deepEqual(ATTRIBUTE_MAP.map((entry) => entry.key), [
    "fixed_temperature_setpoint", "rate_of_rise_sensitivity", "addressing", "protocol", "sound_output", "candela_rating", "battery_capacity",
    "temperature_range", "humidity_range", "Voltage", "Current", "Capacity", "Power", "listing",
  ]);
  assert.deepEqual(ATTRIBUTE_MAP.map((entry) => `${entry.requirementAttribute}->${entry.productAttribute}`), [
    "fixed_temperature_setpoint->fixed_temperature_setpoint", "rate_of_rise_sensitivity->rate_of_rise_sensitivity", "addressing->addressing", "protocol->protocol",
    "sound_output->sound_output", "candela_rating->candela_rating", "battery_capacity->battery_capacity", "temperature_range->operating_temperature",
    "humidity_range->operating_humidity", "Voltage->null", "Current->null", "Capacity->null", "Power->null", "listing->standards",
  ]);
});

test("10. exact readiness counts and per-mapping statuses are frozen", () => {
  const counts = {};
  for (const entry of ATTRIBUTE_MAP) counts[entry.status] = (counts[entry.status] || 0) + 1;
  assert.deepEqual(counts, { READY_FOR_MATCHER_IMPLEMENTATION: 2, READY_EXACT_ONLY: 1, NEEDS_VALUE_NORMALIZATION: 3, NEEDS_PRODUCT_VOCABULARY_ALIGNMENT: 2, NEEDS_PRODUCT_SUBJECT_METADATA: 5, NEEDS_PRODUCT_LIBRARY_EVIDENCE: 1 });
  assert.deepEqual(Object.fromEntries(ATTRIBUTE_MAP.map((entry) => [entry.key, entry.status])), {
    fixed_temperature_setpoint: "READY_FOR_MATCHER_IMPLEMENTATION", rate_of_rise_sensitivity: "READY_EXACT_ONLY", addressing: "READY_FOR_MATCHER_IMPLEMENTATION",
    protocol: "NEEDS_VALUE_NORMALIZATION", sound_output: "NEEDS_VALUE_NORMALIZATION", candela_rating: "NEEDS_VALUE_NORMALIZATION", battery_capacity: "NEEDS_PRODUCT_SUBJECT_METADATA",
    temperature_range: "NEEDS_PRODUCT_VOCABULARY_ALIGNMENT", humidity_range: "NEEDS_PRODUCT_VOCABULARY_ALIGNMENT",
    Voltage: "NEEDS_PRODUCT_SUBJECT_METADATA", Current: "NEEDS_PRODUCT_SUBJECT_METADATA", Capacity: "NEEDS_PRODUCT_SUBJECT_METADATA", Power: "NEEDS_PRODUCT_SUBJECT_METADATA",
    listing: "NEEDS_PRODUCT_LIBRARY_EVIDENCE",
  });
});

test("10. vocabularies are exact and every map entry is deeply immutable", () => {
  assert.deepEqual(READINESS_STATES, ["READY_FOR_MATCHER_IMPLEMENTATION", "READY_EXACT_ONLY", "NEEDS_VALUE_NORMALIZATION", "NEEDS_PRODUCT_VOCABULARY_ALIGNMENT", "NEEDS_PRODUCT_SUBJECT_METADATA", "NEEDS_PRODUCT_LIBRARY_EVIDENCE", "NEEDS_MATCHER_CAPABILITY", "DEFERRED_SEMANTICS", "UNSAFE_TO_COMPARE"]);
  assert.deepEqual(READY_STATES, ["READY_FOR_MATCHER_IMPLEMENTATION", "READY_EXACT_ONLY"]);
  assert.deepEqual(Object.keys(RESULT_SEMANTICS), ["PASS", "FAIL", "UNKNOWN_PRODUCT", "UNKNOWN_PROJECT", "NOT_APPLICABLE", "APPLICATION_REVIEW", "NOT_COMPARABLE"]);
  assert.deepEqual(Object.keys(COMPARISON_TYPES), ["EQUALS", "MINIMUM_REQUIRED", "MAXIMUM_ALLOWED", "REQUIRED_RANGE_WITHIN_CAPABILITY_RANGE", "SET_CONTAINS", "SET_INTERSECTS", "BOOLEAN_REQUIRED", "ENUM_MATCH", "SUBJECT_BOUND_COMPARISON", "NOT_COMPARABLE"]);
  assert.deepEqual(Object.keys(VALUE_KINDS), ["SCALAR", "ENUM", "SET", "RANGE", "BOOLEAN", "SUBJECT_BOUND", "RELATIONSHIP_SET"]);
  const frozen = (value) => !value || typeof value !== "object" || (Object.isFrozen(value) && Object.values(value).every(frozen));
  for (const value of [ATTRIBUTE_MAP, READINESS_STATES, READY_STATES, RESULT_SEMANTICS, COMPARISON_TYPES, VALUE_KINDS, OPERATORS, UNSUPPORTED_OPERATORS, RANGE_VALUE_CONTRACT, UNSUPPORTED_ENCODING_RULES, DOWNSTREAM_MATCHER_GAPS, UNSAFE_PAIRS, SUPERSEDED_V1_READINESS, VALUE_ENCODING_INVENTORY]) assert.ok(frozen(value));
  assert.throws(() => { ATTRIBUTE_MAP[0].status = "READY_FOR_MATCHER_IMPLEMENTATION"; }, TypeError);
  assert.throws(() => { ATTRIBUTE_MAP[0].blockers.push("X"); }, TypeError);
  assert.throws(() => { READINESS_STATES.push("X"); }, TypeError);
  assert.throws(() => { RESULT_SEMANTICS.NEW = "x"; }, TypeError);
});

test("10. contract fingerprint pins the whole contract (any semantic change is a drift)", () => {
  assert.equal(contractFingerprint(), PINNED_CYRB53);
  assert.equal(createHash("sha256").update(canonicalContractJson()).digest("hex"), PINNED_SHA256);
  assert.equal(canonicalContractJson(), canonicalContractJson(), "deterministic");
});

// ---- structural invariants --------------------------------------------------------------
test("every mapping is complete, vocabulary-typed and internally consistent", () => {
  for (const entry of ATTRIBUTE_MAP) {
    for (const key of ["key", "requirementAttribute", "comparisonType", "valueKind", "requirementOperators", "missingEvidenceResult", "mismatchResultWhenReady", "unsupportedEncodingResult", "provenance", "status", "blockers", "normalization"]) assert.ok(entry[key] !== undefined, `${entry.key}:${key}`);
    assert.ok(READINESS_STATES.includes(entry.status), entry.key);
    assert.ok(entry.comparisonType in COMPARISON_TYPES, entry.key);
    assert.ok(entry.valueKind in VALUE_KINDS, entry.key);
    for (const operator of [...entry.requirementOperators, ...(entry.deferredOperators || [])]) assert.ok(operator in OPERATORS, `${entry.key}:${operator}`);
    for (const operator of entry.requirementOperators) assert.ok(OPERATORS[operator].valueKinds.includes(entry.valueKind), `${entry.key}: ${operator} not defined for ${entry.valueKind}`);
    for (const blocker of entry.blockers) assert.ok(READINESS_STATES.includes(blocker), `${entry.key}:${blocker}`);
    if (entry.status === "READY_FOR_MATCHER_IMPLEMENTATION") { assert.deepEqual(entry.blockers, [], entry.key); assert.equal(entry.resultWhileNotReady, null); }
    else if (entry.status === "READY_EXACT_ONLY") assert.deepEqual(entry.blockers, ["DEFERRED_SEMANTICS"]);
    else { assert.ok(entry.blockers.includes(entry.status), `${entry.key}: status must be one of its blockers`); assert.ok(NON_VERDICT.includes(entry.resultWhileNotReady), `${entry.key}: not-ready result must be a non-verdict`); }
  }
});
const NON_VERDICT = ["UNKNOWN_PRODUCT", "UNKNOWN_PROJECT", "NOT_APPLICABLE", "APPLICATION_REVIEW", "NOT_COMPARABLE"];

test("every readiness state is exercised (as a status, a blocker or an unsafe pair) and none is decorative", () => {
  const used = new Set([...ATTRIBUTE_MAP.map((entry) => entry.status), ...ATTRIBUTE_MAP.flatMap((entry) => entry.blockers), ...UNSAFE_PAIRS.map((pair) => pair.state)]);
  for (const state of READINESS_STATES) assert.ok(used.has(state), state);
});

test("the old v1 readiness claims are preserved only as audit history: 4 were withdrawn and ROR was narrowed", () => {
  const withdrawn = Object.entries(SUPERSEDED_V1_READINESS).filter(([key, v1]) => v1 === "READY_FOR_MATCHER_IMPLEMENTATION" && !isReady(entryOf(key)) ).map(([key]) => key);
  assert.deepEqual(withdrawn.sort(), ["battery_capacity", "candela_rating", "protocol", "sound_output"]);
  assert.equal(entryOf("rate_of_rise_sensitivity").status, "READY_EXACT_ONLY", "ROR narrowed, not withdrawn");
  for (const key of ["fixed_temperature_setpoint", "addressing"]) assert.equal(entryOf(key).status, SUPERSEDED_V1_READINESS[key], `${key} unchanged`);
});

test("inventory covers every mapping and records why each pair is or is not directly comparable", () => {
  for (const entry of ATTRIBUTE_MAP) {
    const row = VALUE_ENCODING_INVENTORY[entry.key];
    assert.ok(row, entry.key);
    assert.ok(row.requirement && row.product && typeof row.normalized === "boolean" && typeof row.directlyComparable === "boolean" && row.why, entry.key);
    if (isReady(entry)) assert.equal(row.directlyComparable, true, `${entry.key}: READY requires a directly comparable inventory`);
    else assert.equal(row.directlyComparable, false, `${entry.key}: not-ready must be not directly comparable`);
  }
});

// ---- 1. sound_output --------------------------------------------------------------------------
test("1. sound_output is NOT READY while product values are prose (and dB != dBA)", () => {
  const entry = entryOf("sound_output");
  assert.equal(isReady(entry), false);
  assert.ok(entry.blockers.includes("NEEDS_VALUE_NORMALIZATION"));
  assert.match(VALUE_ENCODING_INVENTORY.sound_output.product.legacyJson.form, /73 prose/);
  assert.match(VALUE_ENCODING_INVENTORY.sound_output.why, /prose/);
  assert.ok(UNSAFE_PAIRS.some((pair) => pair.id === "SOUND_DB_VS_DBA"));
  assert.ok(UNSAFE_PAIRS.some((pair) => pair.id === "SOUND_MEASUREMENT_BASIS"));
  assert.equal(ruleResult(fixtureOf("C11-sound-product-prose")), "UNKNOWN_PRODUCT");
  assert.equal(fixtureOf("C11-sound-product-prose").expected, "UNKNOWN_PRODUCT");
  assert.equal(fixtureOf("C12-sound-dB-vs-dBA").expected, "NOT_COMPARABLE");
  assert.equal(compareUnitPolicy("dBA", "dB").comparable, false);
  assert.deepEqual([...entry.requirementOperators].sort(), ["EQUALS", "MAXIMUM", "MINIMUM"]);
});

// ---- 2. candela --------------------------------------------------------------------------------
test("2. candela option-set is SET semantics, never a scalar minimum", () => {
  const entry = entryOf("candela_rating");
  assert.equal(entry.comparisonType, "SET_CONTAINS");
  assert.equal(entry.valueKind, "SET");
  assert.notEqual(entry.comparisonType, "MINIMUM_REQUIRED");
  assert.deepEqual(entry.requirementOperators, ["EQUALS"]);
  assert.equal(operatorSupport(entry, "Minimum").supported, false);
  assert.equal(operatorSupport(entry, "Minimum").result, "NOT_COMPARABLE");
  assert.equal(operatorSupport(entry, "Equals").supported, true);
  assert.equal(isReady(entry), false);
  assert.match(VALUE_ENCODING_INVENTORY.candela_rating.product.legacyJson.form, /option lists/);
  assert.equal(fixtureOf("C13-candela-minimum-on-option-set").expected, "NOT_COMPARABLE");
  assert.equal(fixtureOf("C14-candela-token-vs-prose-list").expected, "UNKNOWN_PRODUCT");
});

// ---- 3. battery ---------------------------------------------------------------------------------
test("3. battery capacity requires a compatible subject and encoding", () => {
  const entry = entryOf("battery_capacity");
  assert.equal(entry.comparisonType, "SUBJECT_BOUND_COMPARISON");
  assert.equal(entry.innerComparisonType, "MINIMUM_REQUIRED");
  assert.equal(entry.status, "NEEDS_PRODUCT_SUBJECT_METADATA");
  assert.equal(entry.subject.compared, "battery_unit_capacity");
  for (const excluded of ["charger_supported_battery_range", "cabinet_battery_capacity", "loop_capacity", "device_capacity"]) assert.ok(entry.subject.excluded.includes(excluded), excluded);
  assert.ok(UNSAFE_PAIRS.some((pair) => pair.id === "BATTERY_SUBJECTS"));
  assert.equal(isReady(entry), false);
  assert.equal(fixtureOf("C15-battery-charger-range-subject").expected, "NOT_COMPARABLE");
  assert.equal(fixtureOf("C16-battery-subject-unknown").expected, "NOT_COMPARABLE");
  assert.equal(ruleResult(fixtureOf("C16-battery-subject-unknown")), "NOT_COMPARABLE");
});

// ---- 4. Between ---------------------------------------------------------------------------------
test("4. Between is one explicit range shape; every other stored form is refused, never guessed", () => {
  assert.deepEqual(Object.keys(RANGE_VALUE_CONTRACT.canonicalShape), ["operator", "lower", "upper", "unit", "lowerInclusive", "upperInclusive", "qualifiers"]);
  assert.deepEqual(RANGE_VALUE_CONTRACT.acceptedStoredForms.map((form) => form.id), ["PAIR_ARRAY", "OBJECT_RANGE"]);
  const pair = decodeRangeValue({ operator: "Between", value: "[65,110]", unit: "dBA" });
  assert.deepEqual(pair, { ok: true, range: { operator: "Between", lower: 65, upper: 110, unit: "dBA", lowerInclusive: true, upperInclusive: true, qualifiers: [] } });
  assert.deepEqual(decodeRangeValue({ operator: "Between", value: [89, 99], unit: "dBA" }).range.lower, 89);
  assert.deepEqual(decodeRangeValue({ operator: "Between", value: "{\"range\":[0,60],\"unit\":\"°C\"}" }).range, { operator: "Between", lower: 0, upper: 60, unit: "°C", lowerInclusive: true, upperInclusive: true, qualifiers: [] });
  assert.deepEqual(decodeRangeValue({ operator: "Between", value: [10, 93], unit: "%", qualifiers: ["non-condensing"] }).range.qualifiers, ["non-condensing"]);
  const refused = (input) => decodeRangeValue(input);
  assert.deepEqual([refused({ operator: "Between", value: 48, unit: "V" }).result, refused({ operator: "Between", value: 48, unit: "V" }).reason], ["NOT_COMPARABLE", "BETWEEN_WITHOUT_TWO_ENDPOINTS"]);
  assert.equal(refused({ operator: "Between", value: [12, 200] }).reason, "UNIT_MISSING");
  assert.equal(refused({ operator: "Between", value: [110, 65], unit: "dBA" }).reason, "REVERSED_ENDPOINTS");
  assert.equal(refused({ operator: "Maximum", value: [1, 2], unit: "V" }).reason, "OPERATOR_NOT_BETWEEN");
  assert.deepEqual([refused({ operator: "Between", value: "0–49", unit: "°C", side: "product" }).result, refused({ operator: "Between", value: "0–49", unit: "°C", side: "requirement" }).result], ["UNKNOWN_PRODUCT", "UNKNOWN_PROJECT"]);
  assert.equal(refused({ operator: "Between", value: "93 ± 2", unit: "%", side: "product" }).result, "UNKNOWN_PRODUCT");
  assert.equal(fixtureOf("C17-between-scalar").expected, decodeRangeValue({ operator: "Between", value: 48, unit: "V" }).result);
});

test("4. Between is never READY: no mapping may be READY on a range/Between requirement until the matcher can evaluate it", () => {
  for (const entry of ATTRIBUTE_MAP) if (entry.requirementOperators.includes("BETWEEN") || entry.valueKind === "RANGE") assert.equal(isReady(entry), false, entry.key);
  assert.ok(entryOf("sound_output").deferredOperators.includes("BETWEEN"), "sound Between semantics deferred");
  assert.equal(operatorSupport(entryOf("sound_output"), "Between").reason, "OPERATOR_SEMANTICS_DEFERRED");
  assert.equal(fixtureOf("C18-sound-between-deferred").expected, "NOT_COMPARABLE");
  assert.match(RANGE_VALUE_CONTRACT.matcherCapabilityRequired, /NOT evaluable by the current matcher/);
  const gap = DOWNSTREAM_MATCHER_GAPS.find((item) => item.id === "UNKNOWN_OPERATOR_FALLS_TO_FAIL");
  assert.match(gap.detail, /returns result 'Fail'/);
  assert.equal(gap.status, "OPEN (downstream)");
  assert.ok(DOWNSTREAM_MATCHER_GAPS.some((item) => item.id === "BETWEEN_NOT_EVALUATED"));
  assert.ok(entryOf("temperature_range").blockers.includes("NEEDS_MATCHER_CAPABILITY"));
});

// ---- 5. unsupported never FAIL -----------------------------------------------------------------
test("5. unsupported operator / encoding never defaults to FAIL", () => {
  assert.equal(FAIL_IS_NEVER_DEFAULT, true);
  assert.equal(DEFAULT_RESULT_ON_UNSUPPORTED, "NOT_COMPARABLE");
  const failing = UNSUPPORTED_ENCODING_RULES.filter((rule) => rule.result === "FAIL");
  assert.deepEqual(failing.map((rule) => rule.id), ["EXPLICIT_MISMATCH"], "FAIL is reachable through exactly one rule");
  assert.equal(UNSUPPORTED_ENCODING_RULES.at(-1).id, "EXPLICIT_MISMATCH", "evaluated last");
  for (const entry of ATTRIBUTE_MAP) assert.notEqual(entry.unsupportedEncodingResult, "FAIL", entry.key);
  for (const stored of ["Excludes", "Compatible With", "Not Equal", "Interface", "SomethingNew", "", null, undefined]) {
    for (const entry of ATTRIBUTE_MAP) { const support = operatorSupport(entry, stored); assert.equal(support.supported, false, `${entry.key}:${stored}`); assert.equal(support.result, "NOT_COMPARABLE"); }
  }
  assert.equal(operatorSupport(entryOf("Voltage"), "Informational").result, "NOT_COMPARABLE");
  assert.equal(canonicalOperator("Equal"), "EQUALS");
  assert.equal(canonicalOperator("Greater Than or Equal"), "MINIMUM");
  assert.equal(fixtureOf("C19-voltage-excludes").expected, "NOT_COMPARABLE");
});

test("5. every fixture that names a rule agrees with that rule's result and is a legal outcome for its mapping", () => {
  for (const fixture of CONFORMANCE_FIXTURES) {
    if (fixture.rule) assert.equal(fixture.expected, ruleResult(fixture), fixture.id);
    if (fixture.mapping) assert.ok(allowedOutcomes(entryOf(fixture.mapping)).includes(fixture.expected), `${fixture.id}: ${fixture.expected} not allowed for ${fixture.mapping}`);
    if (fixture.expected === "PASS" || fixture.expected === "FAIL") assert.ok(isReady(entryOf(fixture.mapping)), `${fixture.id}: verdict from a non-READY mapping`);
  }
});

test("5. non-READY mappings can never yield PASS or FAIL; READY ones can", () => {
  for (const entry of ATTRIBUTE_MAP) {
    const outcomes = allowedOutcomes(entry);
    if (isReady(entry)) assert.ok(outcomes.includes("PASS") && outcomes.includes("FAIL"), entry.key);
    else { assert.ok(!outcomes.includes("PASS") && !outcomes.includes("FAIL"), entry.key); assert.ok(outcomes.includes(entry.resultWhileNotReady)); }
  }
});

// ---- 6. ROR -------------------------------------------------------------------------------------
test("6. ROR is explicitly exact-only with threshold semantics deferred", () => {
  const entry = entryOf("rate_of_rise_sensitivity");
  assert.equal(entry.status, "READY_EXACT_ONLY");
  assert.deepEqual(entry.blockers, ["DEFERRED_SEMANTICS"]);
  assert.equal(entry.comparisonType, "EQUALS");
  assert.ok(entry.deferred[0].includes("threshold"));
  assert.deepEqual(entry.requirementOperators, ["EQUALS"]);
  for (const operator of ["Minimum", "Maximum", "Greater Than", "Less Than", "Between"]) assert.equal(operatorSupport(entry, operator).supported, false, operator);
  assert.equal(fixtureOf("C02b-ror-threshold-refused").expected, "NOT_COMPARABLE");
  assert.equal(fixtureOf("C02-ror-exact").expected, "PASS");
});

// ---- 7. listing -----------------------------------------------------------------------------------
test("7. the listing mapping is gated by product library evidence and never proves a product unlisted", () => {
  const entry = entryOf("listing");
  assert.equal(entry.status, "NEEDS_PRODUCT_LIBRARY_EVIDENCE");
  assert.equal(entry.comparisonType, "SET_CONTAINS");
  assert.equal(entry.mismatchResultWhenReady, "UNKNOWN_PRODUCT");
  assert.match(entry.mismatchNote, /never proof the product is unlisted/);
  assert.match(entry.operatorSelect, /installation codes \(NFPA 72\).*NOT product-listing comparisons/);
  assert.equal(isReady(entry), false);
  assert.match(VALUE_ENCODING_INVENTORY.listing.product.legacyJson.form, /UL 217: 0/);
  assert.equal(fixtureOf("C20-listing-ul268-product-evidence-missing").expected, "UNKNOWN_PRODUCT");
  assert.equal(fixtureOf("C21-listing-installation-code").expected, "NOT_COMPARABLE");
  assert.equal(fixtureOf("C09-ul268-not-protocol").expected, "NOT_COMPARABLE");
});

// ---- 8. missing evidence != incompatibility --------------------------------------------------------
test("8. missing evidence is never incompatibility, by constant, by entries and by fixtures", () => {
  assert.equal(MISSING_IS_NOT_INCOMPATIBLE, true);
  assert.ok(RESULT_SEMANTICS.UNKNOWN_PRODUCT.includes("never called incompatibility"));
  for (const entry of ATTRIBUTE_MAP) {
    assert.notEqual(entry.missingEvidenceResult, "FAIL", entry.key);
    if (!isReady(entry)) assert.notEqual(entry.resultWhileNotReady, "FAIL", `${entry.key}: a non-READY mapping can never report FAIL`);
    else assert.equal(entry.resultWhileNotReady, null);
  }
  for (const key of ["protocol", "listing"]) assert.equal(entryOf(key).mismatchResultWhenReady, "UNKNOWN_PRODUCT", `${key}: absence is not provable mismatch`);
  for (const id of ["C03-flashscan-clip-missing", "C03b-flashscan-clip-vs-idp", "C20-listing-ul268-product-evidence-missing"]) assert.equal(fixtureOf(id).expected, "UNKNOWN_PRODUCT", id);
  assert.ok(UNSAFE_PAIRS.some((pair) => pair.id === "PROTOCOL_IDP_AMBIGUOUS"));
  const gap = DOWNSTREAM_MATCHER_GAPS.find((item) => item.id === "MISSING_EVIDENCE_LABELLED_NON_COMPLIANT");
  assert.match(gap.detail, /'Missing Product Data' \/ 'Evidence Missing' yet technical_status is 'Non-Compliant'/);
});

// ---- 9. Golden ------------------------------------------------------------------------------------------
test("9. Golden 135°F / 15°F-min semantics stay intact and 190°F stays governed-out", () => {
  const setpoint = entryOf("fixed_temperature_setpoint");
  const ror = entryOf("rate_of_rise_sensitivity");
  assert.ok(isReady(setpoint) && isReady(ror) && isReady(entryOf("addressing")));
  const required135 = decodeVerbatimScalar(setpoint, "135°F");
  const offered135 = decodeVerbatimScalar(setpoint, "135°F");
  assert.deepEqual(required135, { ok: true, value: 135, unit: "F" });
  assert.equal(required135.value === offered135.value && compareUnitPolicy(required135.unit, offered135.unit).comparable, true);
  assert.equal(fixtureOf("C01-setpoint-equality").expected, "PASS");
  assert.deepEqual(decodeVerbatimScalar(ror, "15°F/min"), { ok: true, value: 15, unit: "F/min" });
  assert.equal(fixtureOf("C02-ror-exact").expected, "PASS");
  assert.equal(decodeVerbatimScalar(setpoint, "57°C").unit, "C");
  assert.equal(compareUnitPolicy("F", "C").result, "NOT_COMPARABLE");
  assert.equal(fixtureOf("C02c-setpoint-cross-unit").expected, "NOT_COMPARABLE");
  assert.equal(decodeVerbatimScalar(setpoint, "about 135 F").result, "NOT_COMPARABLE");
  assert.equal(fixtureOf("C04-golden-190F").mapping, null);
  assert.equal(fixtureOf("C04-golden-190F").expected, "NOT_APPLICABLE");
  assert.equal(fixtureOf("C03-flashscan-clip-missing").expected, "UNKNOWN_PRODUCT", "missing FlashScan/CLIP product evidence never becomes support");
  assert.equal(fixtureOf("C03b-flashscan-clip-vs-idp").expected, "UNKNOWN_PRODUCT");
  assert.equal(entryOf("addressing").comparisonType, "ENUM_MATCH");
  assert.deepEqual(entryOf("addressing").vocabulary, ["Addressable", "Conventional"]);
});

// ---- environmental containment arithmetic (kept from v1, now gated) -------------------------------------
const contained = (required, offered) => required.unit === offered.unit && required.lo >= offered.lo && required.hi <= offered.hi;

test("envelope containment arithmetic is pinned, but the mapping is gated so it yields no verdict today", () => {
  const fail = fixtureOf("C05-envelope-fail");
  const pass = fixtureOf("C06-envelope-pass");
  assert.equal(contained(fail.inputs.required, fail.inputs.offered), false);
  assert.equal(fail.expectedWhenReady, "FAIL");
  assert.equal(contained(pass.inputs.required, pass.inputs.offered), true);
  assert.equal(pass.expectedWhenReady, "PASS");
  for (const fixture of [fail, pass]) assert.equal(fixture.expected, "UNKNOWN_PRODUCT");
  const map = entryOf("temperature_range");
  assert.equal(map.comparisonType, "REQUIRED_RANGE_WITHIN_CAPABILITY_RANGE");
  assert.equal(map.productAttribute, "operating_temperature", "requirement-vs-capability pair, not an equality alias");
  assert.equal(entryOf("humidity_range").productAttribute, "operating_humidity");
  assert.equal(fixtureOf("C07-unitless-range").expected, "NOT_COMPARABLE");
  assert.equal(fixtureOf("C22-humidity-point-with-tolerance").expected, "UNKNOWN_PRODUCT");
});

test("subject-bound electrical mappings stay gated on subject metadata", () => {
  for (const key of ["Voltage", "Current", "Capacity", "Power"]) {
    const entry = entryOf(key);
    assert.equal(entry.comparisonType, "SUBJECT_BOUND_COMPARISON");
    assert.equal(entry.status, "NEEDS_PRODUCT_SUBJECT_METADATA");
    assert.equal(entry.mismatchResultWhenReady, "NOT_COMPARABLE");
  }
  assert.equal(fixtureOf("C08-voltage-subject").expected, "NOT_COMPARABLE");
  assert.ok(UNSAFE_PAIRS.some((pair) => pair.id === "CROSS_SUBJECT_ELECTRICAL"));
  assert.ok(UNSAFE_PAIRS.some((pair) => pair.id === "BETWEEN_WITH_SCALAR"));
});

test("protocol is a relationship set that needs decomposition and product evidence before it can be READY", () => {
  const entry = entryOf("protocol");
  assert.equal(entry.valueKind, "RELATIONSHIP_SET");
  assert.equal(entry.status, "NEEDS_VALUE_NORMALIZATION");
  assert.ok(entry.blockers.includes("NEEDS_PRODUCT_LIBRARY_EVIDENCE"));
  assert.match(entry.normalization, /free text in requirement_compatibility\.target_item/);
  assert.match(entry.mismatchNote, /not proven exhaustive/);
  assert.equal(fixtureOf("C10-slc-class-style-not-protocol").expected, "NOT_COMPARABLE");
});
