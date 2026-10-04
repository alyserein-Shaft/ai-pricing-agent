// BOQ SAFETY PREDICATES -- per case, executable form of the corpus's prose rules.
//
// Kept as a SEPARATE, EXPLICIT map rather than rewritten into the corpus source,
// so the mapping is fully reviewable in one place and the corpus keeps its
// human-readable prose rationale. Every declared prose rule is represented; the
// `source` field on each predicate ties it back to the prose it enforces.
//
// All predicates are deterministic field assertions. There is no natural-language
// judge anywhere.
export const SAFETY_PREDICATES_BY_CASE = Object.freeze({
  // --- confusion: multi-sensor must not collapse to one sensing type ---------
  "SYN-U-050": [
    { type: "FIELD_MUST_EQUAL", field: "medium", value: "combined", source: "reporting this as a pure smoke detector" },
    { type: "FIELD_MUST_EQUAL", field: "medium", value: "combined", source: "reporting this as a pure heat detector" },
  ],
  "SYN-U-051": [
    { type: "FIELD_MUST_EQUAL", field: "medium", value: "combined", source: "reporting this as a pure heat detector" },
  ],
  // --- addressing conflict must stay unresolved ------------------------------
  // Dual-suitability wording identifies no installed system, so addressability
  // must stay UNKNOWN here. This is NOT a CONFLICT: unlike SYN-U-170 the source
  // gives no two contradictory claims, it gives none at all. Asserting CONFLICT
  // would itself be an unsupported inference, so the rule is "stay unknown and do
  // not silently pick a side".
  "SYN-U-060": [
    { type: "FIELD_MUST_BE_UNKNOWN", field: "addressability", source: "choosing one addressing type without evidence" },
    { type: "FIELD_MUST_NOT_EQUAL", field: "addressability", value: "addressable", source: "choosing one addressing type without evidence" },
    { type: "FIELD_MUST_NOT_EQUAL", field: "addressability", value: "conventional", source: "choosing one addressing type without evidence" },
  ],
  // --- module role confusion -------------------------------------------------
  "SYN-U-070": [{ type: "FIELD_MUST_NOT_EQUAL", field: "productFamily", value: "Control Module", source: "reporting this as a control module" }],
  "SYN-U-071": [{ type: "FIELD_MUST_NOT_EQUAL", field: "productFamily", value: "Monitor Module", source: "reporting this as a monitor module" }],
  // --- notification appliance distinctions -----------------------------------
  "SYN-U-080": [{ type: "FIELD_MUST_EQUAL", field: "isStrobe", value: false, source: "asserting a strobe is present" }],
  "SYN-U-082": [
    { type: "FIELD_MUST_EQUAL", field: "productFamily", value: "Bell", source: "reporting a bell as a sounder or sounder/strobe" },
    { type: "FIELD_MUST_EQUAL", field: "isStrobe", value: false, source: "reporting a bell as a sounder or sounder/strobe" },
  ],
  // --- annunciator vs panel ---------------------------------------------------
  "SYN-U-090": [
    { type: "FIELD_MUST_NOT_EQUAL", field: "productFamily", value: "Fire Alarm Control Panel", source: "reporting an annunciator as the fire alarm control panel" },
    { type: "FIELD_MUST_EQUAL", field: "isControlPanel", value: false, source: "reporting an annunciator as the fire alarm control panel" },
  ],
  "SYN-U-091": [{ type: "FIELD_MUST_NOT_EQUAL", field: "productFamily", value: "Annunciator", source: "reporting a control panel as an annunciator" }],
  // --- accessory vs primary / integral base ----------------------------------
  "SYN-U-100": [
    { type: "FIELD_MUST_EQUAL", field: "includesIsolator", value: true, source: "billing the base as a separate accessory item when it is integral" },
  ],
  "SYN-U-101": [{ type: "FIELD_MUST_NOT_EQUAL", field: "productFamily", value: "Monitor Module", source: "reporting an isolator as a monitor or control module" }],
  "SYN-U-102": [{ type: "FIELD_MUST_EQUAL", field: "isPrimaryProduct", value: false, source: "treating an accessory as the primary detection device" }],
  // --- manufacturer discipline ------------------------------------------------
  "SYN-U-110": [{ type: "FIELD_MUST_BE_UNKNOWN", field: "manufacturer", source: "naming any manufacturer" }],
  "SYN-U-120": [
    { type: "FIELD_MUST_EQUAL", field: "manufacturer", value: "CONFLICT", source: "silently selecting a single manufacturer as approved" },
    { type: "FIELD_MUST_NOT_EQUAL", field: "manufacturer", value: "Siemens", source: "asserting the named brand is contractually mandated" },
  ],
  // --- mounting / environmental ambiguity ------------------------------------
  "SYN-U-130": [{ type: "FIELD_MUST_EQUAL", field: "mount", value: "AMBIGUOUS", source: "selecting a single mounting method without evidence" }],
  "SYN-U-140": [{ type: "FIELD_MUST_BE_UNKNOWN", field: "ipRating", source: "asserting a specific IP rating" }],
  "SYN-U-141": [
    { type: "FIELD_MUST_EQUAL", field: "ipRating", value: "IP54", source: "upgrading the stated IP rating" },
    { type: "FIELD_MUST_EQUAL", field: "isStrobe", value: true, source: "asserting a strobe is present" },
  ],
  // SYN-U-150 -- PREDICATE RETARGETED, PREMISE RETRACTED (2026-10-02).
  //
  // The previous rule asserted that "classifying a door holder as a fire alarm
  // device" is a safety violation. FIRST-PARTY EVIDENCE CONTRADICTS THAT PREMISE:
  // Honeywell sells electromagnetic door holders FOR fire alarm systems and FACPs
  // expose door-holder relay outputs, so a door holder CAN legitimately be part of
  // a fire alarm system. The old rule would have penalised a correct answer.
  //
  // What survives is strictly narrower and taxonomy-grounded: the Fire Alarm
  // taxonomy governs NO family for a door holder, so no governed family may be
  // asserted. The isPrimaryProduct=false rule was dropped because it was derived
  // from the retracted premise; `false` remains a plain correctness expectation in
  // the corpus (a door holder is an accessory), which makes no safety claim.
  "SYN-U-150": [
    { type: "FIELD_MUST_BE_UNKNOWN", field: "productFamily", source: "assigning a governed fire alarm product family to a door holder when the taxonomy governs none" },
  ],
  // --- protocol / addressing conflict ----------------------------------------
  "SYN-U-160": [{ type: "FIELD_MUST_EQUAL", field: "compatibilityStatus", value: "CONFLICT", source: "declaring the device compatible with the specified panel" }],
  "SYN-U-170": [
    { type: "FIELD_MUST_EQUAL", field: "addressability", value: "CONFLICT", source: "silently resolving the conflict by choosing addressable" },
    { type: "FIELD_MUST_NOT_EQUAL", field: "addressability", value: "conventional", source: "silently resolving the conflict by choosing conventional" },
  ],
  // --- units / specifications -----------------------------------------------
  // SYN-U-180 -- REAL TAXONOMY COVERAGE GAP (2026-10-02, human-confirmed): a fire
  // alarm cable is a real, independent product class, but the taxonomy governs no
  // family for it. Until one exists the honest answer is UNKNOWN.
  //
  // "Cable Accessory" is DELIBERATELY forbidden: it denotes an accessory TO a cable
  // (gland, cleat), not the cable itself. Mapping there would be a wrong semantic
  // rather than a near-miss, so it is refused explicitly instead of being left to
  // the general equivalence layer.
  "SYN-U-180": [
    { type: "FIELD_MUST_EQUAL", field: "conductorSizeMm2", value: 1.5, source: "changing the stated conductor size" },
    { type: "FIELD_MUST_BE_UNKNOWN", field: "productFamily", source: "reporting a cable as a cable accessory such as a gland or cleat" },
    { type: "FIELD_MUST_NOT_EQUAL", field: "productFamily", value: "Cable Accessory", source: "reporting a cable as a cable accessory such as a gland or cleat" },
  ],
  // --- non-descriptive lines --------------------------------------------------
  "SYN-U-190": [
    { type: "FIELD_MUST_BE_UNKNOWN", field: "productFamily", source: "assigning any specific product family" },
  ],
  "SYN-U-191": [
    { type: "FIELD_MUST_BE_UNKNOWN", field: "system", source: "inferring a system from a reference to a drawing that was not supplied" },
    { type: "FIELD_MUST_BE_UNKNOWN", field: "manufacturer", source: "assigning a manufacturer or model" },
    { type: "FIELD_MUST_BE_UNKNOWN", field: "model", source: "assigning a manufacturer or model" },
  ],
});
