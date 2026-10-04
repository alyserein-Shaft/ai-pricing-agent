// SYNTHETIC BOQ UNDERSTANDING BENCHMARK DATASET.
//
// DATA POLICY: every description below is FABRICATED for this benchmark. They
// imitate the *shape* of real tender wording -- abbreviations, misspellings,
// mixed language, truncated part numbers, missing or contradictory manufacturer,
// mounting and IP ambiguity -- but no sentence is copied from a project,
// supplier or commercial source, and no real manufacturer part number appears.
// All model numbers use the SYN-* namespace reserved for this benchmark.
//
// GROUND-TRUTH RULE: every `expected` block is authored from the INTENT of the
// case and is fixed before any model runs. NVIDIA validates this key; it never
// produces it.
//
// THE POINT OF THE `mustRemainUnknown` AND `forbiddenInferences` FIELDS
// ---------------------------------------------------------------------
// The most important thing to measure about a language model in this domain is
// NOT whether it can name a product. It is whether it can leave a field EMPTY.
// A model that invents a manufacturer or a model number to fill a gap produces
// a confidently wrong match downstream, which is far more dangerous than an
// honest unknown. So each case declares explicitly what must stay unknown and
// what must never be asserted.
import { buildSyntheticXlsx } from "./synthetic-xlsx-writer.mjs";

const FA = "Fire Alarm";

/** @type {Array<object>} */
export const BOQ_UNDERSTANDING_CASES = [
  // --- clean baselines -----------------------------------------------------
  { caseId: "SYN-U-001", difficulty: "clean", input: "Addressable optical smoke detector, ceiling mount",
    expected: { system: FA, category: "Detection Devices", productFamily: "Addressable Optical Smoke Detector", addressability: "addressable", medium: "optical", actionType: null, mount: "ceiling", manufacturer: null, model: null }, mustRemainUnknown: ["manufacturer", "model"], forbiddenInferences: ["addressable implies a specific manufacturer", "ceiling mount implies a particular model"], humanReviewRequired: false },
  { caseId: "SYN-U-002", difficulty: "clean", input: "Conventional heat detector",
    expected: { system: FA, category: "Detection Devices", productFamily: "Conventional Heat Detector", addressability: "conventional", medium: "heat", actionType: null, mount: null, manufacturer: null, model: null }, mustRemainUnknown: ["manufacturer", "model"], forbiddenInferences: ["conventional implies non-addressable wiring without reading the loop design"], humanReviewRequired: false },

  // --- abbreviations --------------------------------------------------------
  { caseId: "SYN-U-010", difficulty: "abbreviation", input: "Addr. opt. smoke det.",
    expected: { system: FA, category: "Detection Devices", productFamily: "Addressable Optical Smoke Detector", addressability: "addressable", medium: "optical", actionType: null, mount: null, manufacturer: null, model: null }, mustRemainUnknown: ["manufacturer", "model", "mount"], forbiddenInferences: ["expanding an abbreviation must not supply a model number"], humanReviewRequired: false },
  { caseId: "SYN-U-011", difficulty: "abbreviation", input: "Snd/Strobe assy. wall",
    expected: { system: FA, category: "Notification Devices", productFamily: "Sounder Strobe", addressability: null, medium: null, actionType: null, mount: "wall", manufacturer: null, model: null }, mustRemainUnknown: ["manufacturer", "model", "addressability"], forbiddenInferences: ["a sounder/strobe assembly may be conventional or addressable; the text does not say"], humanReviewRequired: false },
  { caseId: "SYN-U-012", difficulty: "abbreviation", input: "FACP c/w loader",
    expected: { system: FA, category: "Control Equipment", productFamily: "Fire Alarm Control Panel", addressability: null, medium: null, actionType: null, mount: null, manufacturer: null, model: null }, mustRemainUnknown: ["manufacturer", "model"], forbiddenInferences: ["loader implies a particular panel family or capacity"], humanReviewRequired: false },

  // --- misspellings ---------------------------------------------------------
  { caseId: "SYN-U-020", difficulty: "misspelling", input: "Adressable optical smooke detecor",
    expected: { system: FA, category: "Detection Devices", productFamily: "Addressable Optical Smoke Detector", addressability: "addressable", medium: "optical", actionType: null, mount: null, manufacturer: null, model: null }, mustRemainUnknown: ["manufacturer", "model"], forbiddenInferences: ["a misspelling must not lower confidence below review when the intent is unambiguous"], humanReviewRequired: false },
  { caseId: "SYN-U-021", difficulty: "misspelling", input: "Sounder strob wall mouted",
    expected: { system: FA, category: "Notification Devices", productFamily: "Sounder Strobe", addressability: null, medium: null, actionType: null, mount: "wall", manufacturer: null, model: null }, mustRemainUnknown: ["manufacturer", "model", "addressability"], forbiddenInferences: ["inferring addressability from context"], humanReviewRequired: false },

  // --- Arabic / English mixed ----------------------------------------------
  { caseId: "SYN-U-030", difficulty: "multilingual", input: "كاشف حرارة عنوني - Addressable heat detector",
    expected: { system: FA, category: "Detection Devices", productFamily: "Addressable Heat Detector", addressability: "addressable", medium: "heat", actionType: null, mount: null, manufacturer: null, model: null }, mustRemainUnknown: ["manufacturer", "model"], forbiddenInResponses: [], forbiddenInferences: ["an Arabic description must not be treated as a different system"], humanReviewRequired: false },
  { caseId: "SYN-U-031", difficulty: "multilingual", input: "جرس إنذار - fire alarm sounder",
    expected: { system: FA, category: "Notification Devices", productFamily: "Sounder", addressability: null, medium: null, actionType: null, mount: null, manufacturer: null, model: null }, mustRemainUnknown: ["manufacturer", "model", "addressability", "candela"], forbiddenInferences: ["a sounder description alone does not state candela or flash characteristics"], humanReviewRequired: false },

  // --- truncated / incomplete model numbers --------------------------------
  { caseId: "SYN-U-040", difficulty: "truncated_model", input: "Addressable heat detector model SYN-HEAT-ROR-",
    expected: { system: FA, category: "Detection Devices", productFamily: "Addressable Heat Detector", addressability: "addressable", medium: "heat", actionType: "ROR", mount: null, manufacturer: null, model: null }, mustRemainUnknown: ["model", "manufacturer"], forbiddenInferences: ["completing a truncated model number is fabrication, not normalisation", "the suffix after the dash must not be guessed"], humanReviewRequired: true },
  { caseId: "SYN-U-041", difficulty: "truncated_model", input: "Loop expander 4 ch SYN-EXP-",
    expected: { system: FA, category: "Control Equipment", productFamily: "Loop Card", addressability: "addressable", medium: null, actionType: null, channelCount: 4, mount: null, manufacturer: null, model: null }, mustRemainUnknown: ["model", "manufacturer"], forbiddenInferences: ["inferring a manufacturer from a 4-channel expander"], humanReviewRequired: true },

  // --- heat vs smoke confusion ---------------------------------------------
  { caseId: "SYN-U-050", difficulty: "confusion_heat_smoke", input: "Smoke/heat multi sensor detector",
    expected: { system: FA, category: "Detection Devices", productFamily: "Multi-Criteria Detector", addressability: null, medium: "combined", actionType: null, mount: null, manufacturer: null, model: null }, mustRemainUnknown: ["manufacturer", "model", "addressability"], forbiddenInResponses: ["reporting this as a pure smoke detector", "reporting this as a pure heat detector"], forbiddenInferences: ["a multi-sensor must not be collapsed to one sensing type"], humanReviewRequired: false },
  { caseId: "SYN-U-051", difficulty: "confusion_heat_smoke", input: "Heat detector with smoke detection",
    expected: { system: FA, category: "Detection Devices", productFamily: "Multi-Criteria Detector", addressability: null, medium: "combined", actionType: null, mount: null, manufacturer: null, model: null }, mustRemainUnknown: ["manufacturer", "model", "addressability"], forbiddenInResponses: ["reporting this as a pure heat detector"], forbiddenInferences: ["word order must not change the combined classification"], humanReviewRequired: false },

  // --- addressable vs conventional -----------------------------------------
  { caseId: "SYN-U-060", difficulty: "confusion_addressable", input: "Detector suitable for addressable and conventional systems",
    expected: { system: FA, category: "Detection Devices", productFamily: null, addressability: null, medium: null, actionType: null, mount: null, manufacturer: null, model: null }, mustRemainUnknown: ["addressability", "productFamily", "manufacturer", "model"], forbiddenInResponses: ["choosing one addressing type without evidence"], forbiddenInferences: ["a dual-suitability description does not identify the installed system"], humanReviewRequired: true },
  { caseId: "SYN-U-061", difficulty: "confusion_addressable", input: "Addressable optical detector with conventional base",
    expected: { system: FA, category: "Detection Devices", productFamily: "Addressable Optical Smoke Detector", addressability: "addressable", medium: "optical", actionType: null, mount: "base", manufacturer: null, model: null }, mustRemainUnknown: ["manufacturer", "model"], forbiddenInferences: ["the word 'conventional' describing a base does not make the system conventional"], humanReviewRequired: false },

  // --- monitor vs control module --------------------------------------------
  { caseId: "SYN-U-070", difficulty: "confusion_module", input: "Addressable monitor module",
    expected: { system: FA, category: "Modules and Interfaces", productFamily: "Monitor Module", addressability: "addressable", medium: null, actionType: null, mount: null, manufacturer: null, model: null }, mustRemainUnknown: ["manufacturer", "model"], forbiddenInResponses: ["reporting this as a control module"], forbiddenInferences: ["monitor and control modules are different products and must not be merged"], humanReviewRequired: false },
  { caseId: "SYN-U-071", difficulty: "confusion_module", input: "Addressable control module for HVAC",
    expected: { system: FA, category: "Modules and Interfaces", productFamily: "Control Module", addressability: "addressable", medium: null, actionType: null, application: "HVAC", mount: null, manufacturer: null, model: null }, mustRemainUnknown: ["manufacturer", "model"], forbiddenInResponses: ["reporting this as a monitor module"], forbiddenInferences: ["control must not be read as monitoring"], humanReviewRequired: false },

  // --- sounder vs sounder/strobe -------------------------------------------
  { caseId: "SYN-U-080", difficulty: "confusion_notification", input: "Fire alarm sounder",
    expected: { system: FA, category: "Notification Devices", productFamily: "Sounder", addressability: null, medium: null, actionType: null, mount: null, manufacturer: null, model: null, isStrobe: false }, mustRemainUnknown: ["manufacturer", "model", "candela", "addressability"], forbiddenInResponses: ["asserting a strobe is present"], forbiddenInferences: ["a sounder is not a sounder/strobe"], humanReviewRequired: false },
  { caseId: "SYN-U-081", difficulty: "confusion_notification", input: "Sounder strobe red",
    expected: { system: FA, category: "Notification Devices", productFamily: "Sounder Strobe", addressability: null, medium: null, actionType: null, mount: null, colour: "red", manufacturer: null, model: null, isStrobe: true }, mustRemainUnknown: ["manufacturer", "model", "candela", "addressability"], forbiddenInInferences: [], forbiddenInferences: ["a colour does not determine candela or model"], humanReviewRequired: false },
  { caseId: "SYN-U-082", difficulty: "confusion_notification", input: "Fire alarm bell",
    expected: { system: FA, category: "Notification Devices", productFamily: "Bell", addressability: null, medium: null, actionType: null, mount: null, manufacturer: null, model: null, isStrobe: false }, mustRemainUnknown: ["manufacturer", "model", "candela"], forbiddenInResponses: ["reporting a bell as a sounder or sounder/strobe"], forbiddenInferences: ["a bell is a distinct notification appliance"], humanReviewRequired: false },

  // --- annunciator vs panel ------------------------------------------------
  { caseId: "SYN-U-090", difficulty: "confusion_annunciator", input: "Remote annunciator panel",
    expected: { system: FA, category: null, productFamily: "Remote Annunciator", addressability: null, medium: null, actionType: null, mount: null, manufacturer: null, model: null, isControlPanel: false }, mustRemainUnknown: ["manufacturer", "model", "zoneCount"], forbiddenInResponses: ["reporting an annunciator as the fire alarm control panel"], forbiddenInferences: ["'panel' in a description does not make it a FACP"], humanReviewRequired: false },
  { caseId: "SYN-U-091", difficulty: "confusion_annunciator", input: "Fire alarm control panel 4 zone",
    expected: { system: FA, category: "Control Equipment", productFamily: "Fire Alarm Control Panel", addressability: null, medium: null, actionType: null, zoneCount: 4, mount: null, manufacturer: null, model: null, isControlPanel: true }, mustRemainUnknown: ["manufacturer", "model"], forbiddenInResponses: ["reporting a control panel as an annunciator"], forbiddenInferences: ["zone count does not identify a manufacturer"], humanReviewRequired: false },

  // --- detector + isolator wording -----------------------------------------
  { caseId: "SYN-U-100", difficulty: "accessory_ambiguity", input: "Detector with integral isolator base",
    expected: { system: FA, category: "Detection Devices", productFamily: null, addressability: "addressable", medium: null, actionType: null, includesIsolator: true, manufacturer: null, model: null }, mustRemainUnknown: ["manufacturer", "model", "medium"], forbiddenInResponses: ["billing the base as a separate accessory item when it is integral"], forbiddenInferences: ["integral does not mean separately ordered"], humanReviewRequired: false },
  { caseId: "SYN-U-101", difficulty: "accessory_ambiguity", input: "Isolator module",
    expected: { system: FA, category: "Modules and Interfaces", productFamily: "Isolator Module", addressability: "addressable", medium: null, actionType: null, manufacturer: null, model: null }, mustRemainUnknown: ["manufacturer", "model"], forbiddenInResponses: ["reporting an isolator as a monitor or control module"], forbiddenInferences: ["an isolator is a distinct module type"], humanReviewRequired: false },
  { caseId: "SYN-U-102", difficulty: "accessory_ambiguity", input: "Mounting bracket for detector",
    expected: { system: FA, category: "Accessories", productFamily: "Bracket", addressability: null, medium: null, actionType: null, manufacturer: null, model: null, isPrimaryProduct: false }, mustRemainUnknown: ["manufacturer", "model"], forbiddenInResponses: ["treating an accessory as the primary detection device"], forbiddenInferences: ["an accessory must not be priced as a detector"], humanReviewRequired: false },

  // --- missing manufacturer -------------------------------------------------
  { caseId: "SYN-U-110", difficulty: "missing_manufacturer", input: "Addressable smoke detector, approved equal",
    expected: { system: FA, category: "Detection Devices", productFamily: "Addressable Optical Smoke Detector", addressability: "addressable", medium: "optical", actionType: null, mount: null, manufacturer: null, model: null }, mustRemainUnknown: ["manufacturer", "model"], forbiddenInResponses: ["naming any manufacturer"], forbiddenInferences: ["'approved equal' is not a manufacturer"], humanReviewRequired: false },

  // --- contradictory manufacturer ------------------------------------------
  { caseId: "SYN-U-120", difficulty: "contradictory_manufacturer", input: "Addressable smoke detector, Siemens or equivalent brand accepted",
    expected: { system: FA, category: "Detection Devices", productFamily: "Addressable Optical Smoke Detector", addressability: "addressable", medium: "optical", actionType: null, mount: null, manufacturer: "CONFLICT", manufacturerCandidates: ["Siemens"], model: null }, mustRemainUnknown: ["model"], forbiddenInResponses: ["silently selecting a single manufacturer as approved", "asserting the named brand is contractually mandated"], forbiddenInferences: ["a named brand in a specification is a permitted alternative, not a mandate"], humanReviewRequired: true },

  // --- mounting ambiguity ---------------------------------------------------
  { caseId: "SYN-U-130", difficulty: "mounting_ambiguity", input: "Detector for surface or recessed mounting",
    // CORRECTION (2026-10-01): `mount` was BOTH the expected answer ("AMBIGUOUS")
    // AND declared must-remain-unknown, which made the case unpassable by ANY
    // answer -- null was a wrong field, "AMBIGUOUS" was scored as a fabrication.
    // A genuinely ambiguous value is a RESOLVED UNKNOWN, not a missing field, so
    // it must not sit in mustRemainUnknown. The real unknown here is the
    // productFamily, which the line genuinely does not identify.
    expected: { system: FA, category: "Detection Devices", productFamily: null, addressability: null, medium: null, actionType: null, mount: "AMBIGUOUS", manufacturer: null, model: null }, mustRemainUnknown: ["productFamily", "manufacturer", "model"], forbiddenInResponses: ["selecting a single mounting method without evidence"], forbiddenInferences: ["an either/or mounting statement is genuinely ambiguous, not a default"], humanReviewRequired: true },

  // --- environmental / IP ambiguity ----------------------------------------
  { caseId: "SYN-U-140", difficulty: "environmental_ambiguity", input: "Detector for wet or damp location",
    expected: { system: FA, category: "Detection Devices", productFamily: null, addressability: null, medium: null, actionType: null, environmentRating: "AMBIGUOUS", manufacturer: null, model: null }, mustRemainUnknown: ["ipRating", "productFamily", "manufacturer", "model"], forbiddenInResponses: ["asserting a specific IP rating"], forbiddenInferences: ["'wet location' does not state an IP code"], humanReviewRequired: true },
  { caseId: "SYN-U-141", difficulty: "environmental_ambiguity", input: "Sounder/strobe IP54 surface",
    expected: { system: FA, category: "Notification Devices", productFamily: "Sounder Strobe", addressability: null, medium: null, actionType: null, mount: "surface", ipRating: "IP54", manufacturer: null, model: null, isStrobe: true }, mustRemainUnknown: ["manufacturer", "model", "candela", "addressability"], forbiddenInResponses: ["upgrading the stated IP rating"], forbiddenInferences: ["IP54 must not be read as IP65"], humanReviewRequired: false },

  // --- accessory vs primary -------------------------------------------------
  { caseId: "SYN-U-150", difficulty: "accessory_ambiguity", input: "Door holder for fire alarm door release",
    expected: { system: FA, category: "Accessories", productFamily: null, addressability: null, medium: null, actionType: null, manufacturer: null, model: null, isPrimaryProduct: false }, mustRemainUnknown: ["manufacturer", "model", "categorySystem", "productFamily"], forbiddenInResponses: ["assigning a governed fire alarm product family to a door holder when the taxonomy governs none"], forbiddenInferences: ["no governed fire alarm family covers a door holder, so no family may be asserted"], humanReviewRequired: false },

  // --- protocol mismatch ----------------------------------------------------
  { caseId: "SYN-U-160", difficulty: "protocol_conflict", input: "Addressable detector, third party protocol, not for the approved panel",
    expected: { system: FA, category: "Detection Devices", productFamily: null, addressability: "addressable", medium: null, actionType: null, compatibilityStatus: "CONFLICT", manufacturer: null, model: null }, mustRemainUnknown: ["manufacturer", "model", "medium"], forbiddenInResponses: ["declaring the device compatible with the specified panel", "declaring it compatible without protocol evidence"], forbiddenInferences: ["addressable does not mean protocol compatible"], humanReviewRequired: true },

  // --- conventional vs addressable conflict in one line --------------------
  { caseId: "SYN-U-170", difficulty: "addressing_conflict", input: "Addressable module, to be used on a conventional panel",
    expected: { system: FA, category: "Modules and Interfaces", productFamily: null, addressability: "CONFLICT", manufacturer: null, model: null, compatibilityStatus: "CONFLICT" }, mustRemainUnknown: ["productFamily", "manufacturer", "model"], forbiddenInResponses: ["silently resolving the conflict by choosing addressable", "silently resolving the conflict by choosing conventional"], forbiddenInferences: ["a stated contradiction is not a decision to make"], humanReviewRequired: true },

  // --- units / malformed ----------------------------------------------------
  { caseId: "SYN-U-180", difficulty: "malformed_unit", input: "Cable FP 2 core 1.5sqmm CWZ fire resistant",
    expected: { system: FA, category: null, productFamily: null, addressability: null, medium: null, actionType: null, conductorSizeMm2: 1.5, cores: 2, manufacturer: null, model: null }, mustRemainUnknown: ["manufacturer", "model", "productFamily"], forbiddenInResponses: ["changing the stated conductor size", "reporting a cable as a cable accessory such as a gland or cleat"], forbiddenInferences: ["1.5sqmm must not be normalised to 2.5sqmm", "a cable is not a cable accessory; the taxonomy governs no cable family"], humanReviewRequired: false },

  // --- empty / non-descriptive ---------------------------------------------
  { caseId: "SYN-U-190", difficulty: "non_descriptive", input: "Fire alarm item",
    expected: { system: FA, category: null, productFamily: null, addressability: null, medium: null, actionType: null, manufacturer: null, model: null }, mustRemainUnknown: ["category", "productFamily", "manufacturer", "model", "addressability"], forbiddenInResponses: ["assigning any specific product family", "assigning a manufacturer or model"], forbiddenInferences: ["a non-descriptive line must stay unresolved"], humanReviewRequired: true },
  { caseId: "SYN-U-191", difficulty: "non_descriptive", input: "As per drawing",
    expected: { system: null, category: null, productFamily: null, addressability: null, medium: null, actionType: null, manufacturer: null, model: null }, mustRemainUnknown: ["system", "category", "productFamily", "manufacturer", "model"], forbiddenInResponses: ["inferring a system from a reference to a drawing that was not supplied"], forbiddenInferences: ["'as per drawing' carries no product information"], humanReviewRequired: true },
];

/**
 * Fields compared exactly. Deliberately excludes free text so a model cannot
 * earn credit by paraphrasing while getting the engineering wrong.
 */
export const COMPARED_FIELDS = Object.freeze([
  "system", "category", "productFamily", "addressability", "medium", "actionType",
  "mount", "manufacturer", "model", "isStrobe", "isControlPanel", "isPrimaryProduct",
  "includesIsolator", "ipRating", "environmentRating", "compatibilityStatus", "zoneCount", "channelCount", "conductorSizeMm2",
]);

export const UNDERSTANDING_CASE_COUNT = BOQ_UNDERSTANDING_CASES.length;

/** Build the XLSX bytes a model would be shown for one understanding case. */
export const buildUnderstandingFixture = (caseSpec) =>
  buildSyntheticXlsx({
    rows: [
      ["Item", "Description", "Unit", "Qty"],
      ["1", caseSpec.input, "No", 1],
    ],
    merges: [],
    name: caseSpec.caseId,
  });
