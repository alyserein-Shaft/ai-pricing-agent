// Conformance fixtures for ATTRIBUTE_COMPARISON_MAP_VERSION 2.0.0.
//
// Each fixture names the contract mapping key it exercises (or null for a
// governed exclusion / refusal with no mapping), its inputs, and:
//   expected          the outcome the contract requires TODAY (readiness-gated)
//   rule              the UNSUPPORTED_ENCODING_RULES id that decides it, when one applies
//   expectedWhenReady the outcome the semantics yield once the mapping is READY
//                     (only where the pair is genuinely decidable arithmetic)
// These fixtures MUST NOT call the production matcher; the conformance test
// validates them against the contract structure and the contract's own pure
// reference decoders.
export const CONTRACT_VERSION = "2.0.0";

export const CONFORMANCE_FIXTURES = Object.freeze([
  // ---- Golden Heat Detector case (must stay intact) ----------------------------
  { id: "C01-setpoint-equality", mapping: "fixed_temperature_setpoint", inputs: { required: "135°F", offered: "135°F", operator: "Equal" }, expected: "PASS", note: "Golden 135°F verbatim equality" },
  { id: "C02-ror-exact", mapping: "rate_of_rise_sensitivity", inputs: { required: "15°F/min", offered: "15°F/min", operator: "Equal" }, expected: "PASS", note: "Golden exact 15°F/min; exact equality is the only proven ROR semantics" },
  { id: "C03-flashscan-clip-missing", mapping: "protocol", inputs: { required: ["FlashScan", "CLIP"], offered: [], relationship: "both-mandatory" }, expected: "UNKNOWN_PRODUCT", rule: "MAPPING_NOT_READY", note: "Golden protocol case: missing product evidence, never fabricated support, never FAIL" },
  { id: "C03b-flashscan-clip-vs-idp", mapping: "protocol", inputs: { required: ["FlashScan", "CLIP"], offered: ["IDP"], relationship: "both-mandatory" }, expected: "UNKNOWN_PRODUCT", rule: "MAPPING_NOT_READY", note: "real Farenhyt IDP-HEAT-ROR-IV evidence: IDP is ambiguous and the product set is not exhaustive, so this is UNKNOWN_PRODUCT, not FAIL" },
  { id: "C04-golden-190F", mapping: null, inputs: { required: "190°F", context: "Golden 9xROR / 0xHT decision" }, expected: "NOT_APPLICABLE", note: "no comparison is built under governed exclusion" },
  // ---- ROR exact-only / verbatim-scalar unit policy -----------------------------
  { id: "C02b-ror-threshold-refused", mapping: "rate_of_rise_sensitivity", inputs: { required: "15°F/min", offered: "15°F/min", operator: "Minimum" }, expected: "NOT_COMPARABLE", rule: "REQUIREMENT_OPERATOR_UNSUPPORTED", note: "threshold semantics are DEFERRED: a Minimum ROR is refused, not evaluated" },
  { id: "C02c-setpoint-cross-unit", mapping: "fixed_temperature_setpoint", inputs: { required: "57°C", offered: "135°F", operator: "Equal" }, expected: "NOT_COMPARABLE", rule: "UNIT_MISSING_OR_UNCONVERTIBLE", note: "no conversion rule; 135°F is not exactly 57°C" },
  // ---- environmental envelope ----------------------------------------------------
  { id: "C05-envelope-fail", mapping: "temperature_range", inputs: { required: { lo: 0, hi: 60, unit: "°C" }, offered: { lo: -10, hi: 55, unit: "°C" } }, expected: "UNKNOWN_PRODUCT", rule: "MAPPING_NOT_READY", expectedWhenReady: "FAIL", note: "required upper bound exceeds capability -- but the mapping is not READY, so no verdict today" },
  { id: "C06-envelope-pass", mapping: "temperature_range", inputs: { required: { lo: 0, hi: 49, unit: "°C" }, offered: { lo: -10, hi: 55, unit: "°C" } }, expected: "UNKNOWN_PRODUCT", rule: "MAPPING_NOT_READY", expectedWhenReady: "PASS", note: "containment holds -- but the mapping is not READY, so no verdict today" },
  { id: "C07-unitless-range", mapping: "temperature_range", inputs: { required: { lo: 12, hi: 200, unit: null }, offered: { lo: -10, hi: 55, unit: "°C" } }, expected: "NOT_COMPARABLE", rule: "UNIT_MISSING_OR_UNCONVERTIBLE", note: "unit-less endpoints never guessed" },
  { id: "C22-humidity-point-with-tolerance", mapping: "humidity_range", inputs: { required: { operator: "Maximum", value: "95%" }, offered: "93 ± 2" }, expected: "UNKNOWN_PRODUCT", rule: "PRODUCT_VALUE_UNDECODABLE", note: "product operating_humidity is a tested point with tolerance, not an interval" },
  // ---- subject-bound -------------------------------------------------------------
  { id: "C08-voltage-subject", mapping: "Voltage", inputs: { required: "24 VDC operating", offered: "24 VDC contact", subject: null }, expected: "NOT_COMPARABLE", rule: "SUBJECT_UNKNOWN_OR_MISMATCHED", note: "missing subject metadata blocks comparison" },
  { id: "C19-voltage-excludes", mapping: "Voltage", inputs: { required: { operator: "Excludes", value: 16 }, offered: 24 }, expected: "NOT_COMPARABLE", rule: "REQUIREMENT_OPERATOR_UNSUPPORTED", note: "Excludes is not a supported attribute operator; it must not fall through to FAIL" },
  // ---- listings / protocol vs circuit vocabulary --------------------------------
  { id: "C09-ul268-not-protocol", mapping: null, inputs: { text: "Detectors must be UL certified to UL 268", asProtocolTarget: true }, expected: "NOT_COMPARABLE", note: "listings are never protocol targets" },
  { id: "C10-slc-class-style-not-protocol", mapping: null, inputs: { texts: ["two-wire SLC", "Class A wiring", "Style 6"] }, expected: "NOT_COMPARABLE", note: "circuit/topology vocabulary is not protocol evidence" },
  { id: "C20-listing-ul268-product-evidence-missing", mapping: "listing", inputs: { required: "UL 268", relationship: "LISTED_TO", offered: null }, expected: "UNKNOWN_PRODUCT", rule: "MAPPING_NOT_READY", note: "no product listing evidence is missing evidence, never proof the product is unlisted" },
  { id: "C21-listing-installation-code", mapping: "listing", inputs: { required: "NFPA 72", relationship: "IN_ACCORDANCE_WITH", role: "INSTALLATION_CODE" }, expected: "NOT_COMPARABLE", note: "installing per NFPA 72 is not a product listing comparison" },
  // ---- sound output --------------------------------------------------------------
  { id: "C11-sound-product-prose", mapping: "sound_output", inputs: { required: { operator: "Minimum", value: "85 dBA" }, offered: "Horn rated at 88+ dBA at 16 volts" }, expected: "UNKNOWN_PRODUCT", rule: "PRODUCT_VALUE_UNDECODABLE", note: "the real product value is prose with a measurement basis; it is not parsed here" },
  { id: "C12-sound-dB-vs-dBA", mapping: "sound_output", inputs: { required: { operator: "Minimum", value: 85, unit: "dBA" }, offered: { value: 83, unit: "dB" } }, expected: "NOT_COMPARABLE", rule: "UNIT_MISSING_OR_UNCONVERTIBLE", note: "A-weighted dBA vs unweighted dB (SPSRK 83 dB): no conversion exists" },
  { id: "C18-sound-between-deferred", mapping: "sound_output", inputs: { required: { operator: "Between", value: [65, 110], unit: "dBA" }, offered: { value: 90, unit: "dBA" } }, expected: "NOT_COMPARABLE", rule: "REQUIREMENT_OPERATOR_UNSUPPORTED", note: "Between on sound output is ambiguous (bound vs capability) and deferred" },
  // ---- candela option sets -------------------------------------------------------
  { id: "C13-candela-minimum-on-option-set", mapping: "candela_rating", inputs: { required: { operator: "Minimum", value: "75 cd" }, offered: "15, 30, 75, 95, 110, 135, 185 cd" }, expected: "NOT_COMPARABLE", rule: "REQUIREMENT_OPERATOR_UNSUPPORTED", note: "an option set is not a scalar minimum" },
  { id: "C14-candela-token-vs-prose-list", mapping: "candela_rating", inputs: { required: { operator: "Equals", value: "15/75 cd" }, offered: "Standard cd: 15, 15/75, 30, 75, 95, 110, 115; High cd: 135, 150, 177, 185" }, expected: "UNKNOWN_PRODUCT", rule: "PRODUCT_VALUE_UNDECODABLE", note: "token membership is the correct semantics, but the product list is untokenized prose" },
  // ---- battery capacity ------------------------------------------------------------
  { id: "C15-battery-charger-range-subject", mapping: "battery_capacity", inputs: { required: { operator: "Minimum", value: "12 AH", subject: "battery_unit_capacity" }, offered: { attribute: "battery_charger_capacity", value: "7–35", unit: "Ah", subject: "charger_supported_battery_range" } }, expected: "NOT_COMPARABLE", rule: "SUBJECT_UNKNOWN_OR_MISMATCHED", note: "same unit Ah, different subject" },
  { id: "C16-battery-subject-unknown", mapping: "battery_capacity", inputs: { required: { operator: "Minimum", value: "12 AH", subject: "battery_unit_capacity" }, offered: { attribute: "battery_capacity", value: "12 AH", subject: null } }, expected: "NOT_COMPARABLE", rule: "SUBJECT_UNKNOWN_OR_MISMATCHED", note: "no product row carries a subject flag" },
  // ---- Between encoding -----------------------------------------------------------
  { id: "C17-between-scalar", mapping: null, inputs: { operator: "Between", value: 48, unit: "V", side: "requirement" }, expected: "NOT_COMPARABLE", rule: "BETWEEN_NOT_A_PAIR", note: "22 of 42 stored Between rows are single numbers (Voltage 5, Current 16, Bandwidth 1)" },
]);
