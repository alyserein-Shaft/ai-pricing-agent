// The canonical lifecycle vocabulary is NOT defined here. It is imported from the
// lifecycle domain of record so that "which lifecycle states exist" has exactly
// one answer in the system. A second copy in this module would be free to drift
// from the authority that reads these very values, which is precisely the class
// of bug the closed vocabulary exists to prevent.
//
// `product-lifecycle-authority.mjs` has no imports of its own, so this cannot
// form a cycle.
import { LIFECYCLE_STATES as CANONICAL_LIFECYCLE_STATES } from "./product-lifecycle-authority.mjs";

export const KNOWLEDGE_PROMOTION_POLICY_VERSION =
  "knowledge-promotion-policy-v2";

const clean = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

// A canonical protocol token may be authored with an explanatory parenthetical
// gloss -- the reviewed IDP-HEAT-ROR-IV fact carries
// "IDP (Intelligent Device Protocol)". Stripping a TRAILING parenthetical is a
// narrow normalisation: it recognises one token plus its own expansion.
//
// It is deliberately NOT substring extraction. Taking "the first known token
// appearing anywhere in the string" would accept "supports IDP and Hochiki SD"
// and silently record only "IDP", losing the compound claim -- which is exactly
// the class of error the Fire Alarm protocol vocabulary is meant to prevent.
const stripTrailingGloss = (value) => clean(value).replace(/\s*\([^)]*\)\s*$/, "");

const protocolKey = (value) =>
  stripTrailingGloss(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, "")
    .replace(/\+/g, "+");

const PROTOCOL_CANONICAL_VALUES = new Map([
  ["slc", "SLC"],
  ["bacnet", "BACnet"],
  ["modbus", "Modbus"],
  ["rs485", "RS-485"],
  ["rs232", "RS-232"],
  ["ethernet", "Ethernet"],
  ["poe", "PoE"],
  ["poe+", "PoE+"],
  ["poe++", "PoE++"],
  ["nac", "NAC"],
  ["canbus", "CAN bus"],
  ["lonworks", "LonWorks"],
  ["opc", "OPC"],
  // Fire Alarm device protocols.
  //
  // The vocabulary above is building-services oriented (BACnet, Modbus,
  // LonWorks, OPC, PoE) and had no token for a Fire Alarm addressable device
  // protocol, so the IDP-HEAT-ROR-IV Protocol fact -- which passed review on
  // first-party 351630 Rev A evidence ("Addressable by device - Two-wire SLC
  // connection") -- was refused at promotion with UNSUPPORTED_ATTRIBUTE_VALUE.
  // A reviewed manufacturer protocol that the canonical model cannot name is
  // evidence the model is incomplete, not that the evidence was wrong.
  //
  // SCOPE IS DELIBERATELY TIGHT. Only tokens already carried by reviewed or
  // otherwise governed Fire Alarm evidence are admitted:
  //   IDP       - reviewed Protocol facts, and the `protocol` value on five
  //               governed engineering_relationships
  //   CLIP      - reviewed Protocol fact
  //   FlashScan - reviewed Protocol fact
  // Deliberately NOT added, because no governed fact carries them as a protocol:
  // SK, SD, D-BUS, Hochiki, Gent, Fire-Lite. In particular "IDP / SK or SD" is a
  // COMPOUND authored by research and is still held as Needs Investigation, so
  // neither SK nor SD is admitted on the strength of a string this module would
  // have to interpret.
  //
  // Adding FlashScan to a VOCABULARY asserts only that the token exists and is
  // recognised. It does not make FlashScan a project requirement: the Fire Alarm
  // brand/pre-sales policy records `FLASHSCAN_MANDATORY = NO`, and nothing here
  // reads this table as a mandate.
  ["idp", "IDP"],
  ["clip", "CLIP"],
  ["flashscan", "FlashScan"],
]);

const normalizeProtocol = (fact) => {
  const originalValue = clean(fact?.originalValue);
  // `normalizedValue` first, exactly as `normalizeAddressModel` does. The
  // research author maps the manufacturer's wording onto a canonical token, and
  // that mapping IS the reviewed human decision; keying off `originalValue`
  // alone meant the reviewed IDP-HEAT-ROR-IV fact ("Addressable by device -
  // Two-wire SLC connection") could never match the token the reviewer had
  // already approved for it.
  const candidate = clean(fact?.normalizedValue) || originalValue;
  const canonical = PROTOCOL_CANONICAL_VALUES.get(protocolKey(candidate));

  if (!originalValue || !canonical) {
    return {
      status: "UNSUPPORTED_ATTRIBUTE_VALUE",
      attributeName: "protocol",
    };
  }

  return {
    status: "SUPPORTED",
    targetTable: "product_attributes",
    attributeName: "protocol",
    originalValue,
    normalizedValue: canonical,
    unit: null,
  };
};

// ---------------------------------------------------------------------------
// PROD-001 -- the terminal policy, made explicit.
//
// A promotion asserts that a learned observation is a real, canonical, reusable
// PRODUCT ATTRIBUTE, and writes it to product_attributes under a controlled
// vocabulary. That is a narrow, high-value operation: it is only truthful when
// the observation IS an attribute of a known canonical product.
//
// The previous implementation was a single bare gate -- `if (factType !==
// "Protocol") return UNSUPPORTED_FACT_TYPE` -- with no stated rationale. That
// left the most important safety-relevant decisions invisible, and invited a
// future reader to "fix" the gate by adding a fact type without knowing why it
// would be wrong. Every fact type the extractor actually produces is therefore
// now classified DELIBERATELY below, with the reason recorded.
//
// The three distinctions that must never be collapsed here:
//
//   * a price OBSERVATION is not an approved costing price. Costing authority
//     comes only from price_records, gated by approval_status, downstream_use
//     and validity. Promoting a scraped price would make an observation look
//     like a governed cost.
//   * a part-number OBSERVATION is not a canonical product identity. Identity is
//     resolved by the governed identity resolver against canonical_library_products.
//   * an extracted standard or certification is a SAFETY-RELEVANT claim that
//     requires evidence, not a string a document happened to contain.
//
// A fact type that is absent from this table is UNCLASSIFIED and still refused
// with UNSUPPORTED_FACT_TYPE, so the policy fails closed for anything added later.
const TERMINAL = (reason) => Object.freeze({ eligible: false, reason });

// Governance classes. Every promotable entry declares WHERE the fact lands
// (destination) and WHICH path may carry it there (path):
//   path 'deterministic' -- controlled vocabulary + evidence gates, system actor.
//   path 'human'         -- human Reviewed fact + resolved link + governed reason.
//   'terminal'/'discovery' entries never reach canonical truth through this writer.
// A fact type absent from the table is UNCLASSIFIED and refused, so the policy
// fails closed for anything added later.
const HUMAN_ATTRIBUTE = (attributeName, reason) =>
  Object.freeze({
    eligible: true,
    path: "human",
    destination: "attribute",
    attributeName,
    reason,
  });

// Same governed shape as HUMAN_ATTRIBUTE, declared separately so a reader can
// tell WHICH normalizer is responsible without tracing the dispatcher. It is
// still dispatched by `attributeName`-style fact-type lookup, exactly like
// HUMAN_CAPACITY_ATTRIBUTES, so the classification table and the normalizer
// cannot drift apart.
const HUMAN_CURRENT_ATTRIBUTE = (attributeName, reason) =>
  HUMAN_ATTRIBUTE(attributeName, reason);

// KN-REL-1: the relationship destination is engineering_relationships, NOT
// product_compatibility. docs/product-compatibility-disposition.md (2026-08-31)
// deprecated product_compatibility as a duplicate of engineering_relationships:
// it has no write path, is not surfaced in the Product Library, and real
// compatibility authority is engineering_relationships -- which is exactly what
// worker/product-matching-api.mjs loadProducts() and
// worker/technical-requirement-api.mjs loadInputs() read during real matching.
// Promoting into the deprecated table would have created relationship truth no
// consumer can see.
const HUMAN_RELATIONSHIP = (relationshipType, reason) =>
  Object.freeze({
    eligible: true,
    path: "human",
    destination: "relationship",
    targetTable: "engineering_relationships",
    relationshipType,
    reason,
  });

const HUMAN_LIFECYCLE = (reason) =>
  Object.freeze({
    eligible: true,
    path: "human",
    destination: "lifecycle",
    reason,
  });

const DISCOVERY = (reason) => Object.freeze({ eligible: false, reason });

// Strict engineering numerics: a capacity is a finite non-negative number or
// it is not promotable. No unit conversion, no parsing of ranges or text.
// Closed-vocabulary lifecycle normalization.
//
// Returns the canonical token, or null when the value is not a token.
//
// WHAT IS DELIBERATELY NOT DONE HERE:
//   - Prose is not normalized, trimmed of commentary, or pattern-matched. If a
//     research author wrote a sentence, the answer is "refuse", because a
//     heuristic that extracts a state from prose will eventually extract a state
//     the author did not mean.
//   - Successor semantics are NOT encoded. "SGWLED replaces SGWL" is a
//     RELATIONSHIP, and belongs in a governed relationship row. Folding it into
//     the status value is what produced the defective row this replaces.
//     Accordingly `Superseded` is a state and says nothing about WHO superseded
//     the product.
//
// `LIFECYCLE_NOT_ESTABLISHED` is a Knowledge/RESEARCH outcome meaning "no
// lifecycle statement was found in this document". It is deliberately NOT in the
// vocabulary: promoting it would convert an absent observation into a canonical
// lifecycle truth, which is the same class of error as reading silence as
// disapproval. Absent evidence stays in Knowledge.
// Explicit, closed synonym table. `Active` is admitted because the lifecycle
// authority's own `normalizeState` resolves `/current|active/i` to "Current", so
// treating "Active" as unknown here would contradict the domain of record.
//
// WHY THIS IS NOT THE AUTHORITY'S OWN MATCHER: ingest and display are different
// jobs. `normalizeState` must map whatever is ALREADY stored to a display state,
// so it pattern-matches the whole string and will read "This product has been
// discontinued." as "Discontinued". An INGEST validator has the opposite duty --
// it decides what is allowed to be stored -- so it admits only whole tokens from
// this table plus the canonical states. Reusing the display matcher here would
// reintroduce exactly the prose acceptance this vocabulary exists to prevent.
const LIFECYCLE_SYNONYMS = Object.freeze({ ACTIVE: "Current" });

const CANONICAL_LIFECYCLE_TOKEN = new Map(
  [
    ...CANONICAL_LIFECYCLE_STATES.map((state) => [state.toUpperCase().replace(/[\s_-]+/g, ""), state]),
    ...Object.entries(LIFECYCLE_SYNONYMS),
  ],
);

export const CANONICAL_LIFECYCLE_VOCABULARY = Object.freeze([
  ...CANONICAL_LIFECYCLE_STATES,
]);

// Research-only lifecycle findings that must never become canonical truth.
export const NON_CANONICAL_LIFECYCLE_FINDINGS = Object.freeze([
  "LIFECYCLE_NOT_ESTABLISHED",
]);

const lifecycleKey = (value) =>
  clean(value)
    .toUpperCase()
    .replace(/[\s_-]+/g, "");

export const normalizeCanonicalLifecycleStatus = (value) => {
  const text = clean(value);
  if (!text) return null;
  return CANONICAL_LIFECYCLE_TOKEN.get(lifecycleKey(text)) || null;
};

const normalizeCapacity = (fact, attributeName) => {
  const originalValue = clean(fact?.originalValue);
  const numeric = Number(fact?.normalizedValue ?? fact?.originalValue);
  if (!originalValue || !Number.isFinite(numeric) || numeric < 0) {
    return { status: "UNSUPPORTED_ATTRIBUTE_VALUE", attributeName };
  }
  return {
    status: "SUPPORTED",
    targetTable: "product_attributes",
    attributeName,
    originalValue,
    normalizedValue: numeric,
    unit: null,
  };
};

// Human-only engineering capacities (KN-GOVERNANCE-REPAIR). These are the
// pilot vocabulary for internet enrichment: exact SLC/loop capacities with
// manufacturer evidence, resolved product link, and a human reviewer. The
// deterministic path must never mint them: a confident extractor is not
// engineering authority for a number that sizes panels.
const HUMAN_CAPACITY_ATTRIBUTES = Object.freeze({
  "SLC Loops": "native_slc_loops",
  "Detector Capacity": "max_detectors_per_loop",
  "Module Capacity": "max_modules_per_loop",
  "System Points": "max_system_points",
  "Network Panels": "max_network_nodes",
});

/**
 * Current figures promoted for BATTERY SIZING.
 *
 * WHY THIS EXISTS. `app/domain/calculation-requirement-engine.mjs` already maps
 * `standby_current` and `alarm_current` straight into the governed
 * `battery.standby-alarm` rule, which computes RequiredAh and BLOCKS with
 * `REQUIRED_BUT_INPUTS_MISSING` when they are absent. Those two attributes had no
 * promotion destination at all -- the fact types were TERMINAL -- so battery
 * sizing could never be satisfied from manufacturer evidence. This is a live,
 * proven bottleneck, not a hypothetical one.
 *
 * WHY UNIT-AWARE. The consumer declares `unit: "A"` and refuses anything that is
 * not a positive number, while manufacturer datasheets quote milliamps and
 * microamps ("38.5mA at 24VDC", "200uA @ 24 VDC"). Accepting the bare digits
 * would store 38.5 where 0.0385 is meant -- a 1000x battery over-sizing that a
 * sizing engine would happily compute. So the unit is parsed, converted to
 * amperes, and anything ambiguous is REFUSED rather than guessed.
 *
 * WHY THE TEST CONDITION IS NOT DISCARDED. A current figure is only true at a
 * stated condition ("at 24VDC", "with LED polling"). The condition is retained on
 * the evidence, never silently dropped, and it does NOT change the number.
 */
const CURRENT_UNIT_FACTORS = Object.freeze({
  a: 1, amp: 1, ampere: 1, amps: 1, amperes: 1,
  ma: 1e-3, milliamp: 1e-3, milliamps: 1e-3, milliampere: 1e-3,
  ua: 1e-6, "\u00b5a": 1e-6, "\u03bca": 1e-6, microamp: 1e-6, microamps: 1e-6,
});

const normalizeCurrent = (fact, attributeName) => {
  const originalValue = clean(fact?.originalValue);
  if (!originalValue) return { status: "UNSUPPORTED_ATTRIBUTE_VALUE", attributeName };

  // A COMBINED STANDBY-AND-ALARM LINE IS REFUSED, NOT SPLIT.
  //
  // Honeywell doc 350286 states, for IDP-PULL-DA: "SLC Standby and Alarm
  // Current: 350uA" -- ONE sentence, ONE figure. The extractor emits it as TWO
  // facts (`Standby Current` and `Alarm Current`) from that single line.
  //
  // Promoting both would present one measurement as two independently sourced
  // figures. That matters because `calculation-requirement-engine.mjs` computes
  // RequiredAh = MAX(standbyHours*standbyCurrent, alarmMinutes*alarmCurrent) --
  // it multiplies each by a different duration, so the same number silently
  // becomes two independent load contributions. Whether 350 uA is "the same
  // value in both states" or "a combined total" is an interpretation the
  // manufacturer did not spell out, and it must be a human's decision.
  if (/\bstandby\s+and\s+alarm\b/i.test(originalValue)) {
    return {
      status: "UNSUPPORTED_ATTRIBUTE_VALUE",
      attributeName,
      why: `"${originalValue}" is a single combined standby-and-alarm line. Splitting one measurement into two independent current figures would double-count it, so it requires a human decision that the same figure holds in both states.`,
    };
  }

  // Find a magnitude IMMEDIATELY FOLLOWED BY A RECOGNISED CURRENT UNIT.
  //
  // It must not simply be the first number in the string. Manufacturer prose
  // routinely puts the test condition first -- "Standby Current (@ 24 VDC):
  // 200UA" -- so a first-number match pairs the 24 with "VDC", finds no known
  // unit, and refuses a value that is perfectly determinate. That refusal was
  // safe but for the wrong reason. Searching for a unit-tagged magnitude finds
  // the real measurement and leaves the condition alone.
  const CURRENT_UNIT_ALTERNATIVES = Object.keys(CURRENT_UNIT_FACTORS)
    .sort((left, right) => right.length - left.length)
    .map((unit) => unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const match = new RegExp(
    `(-?\\d+(?:\\.\\d+)?)\\s*(${CURRENT_UNIT_ALTERNATIVES})(?![A-Za-z])`,
    "i",
  ).exec(originalValue);
  if (!match) {
    // No unit-tagged magnitude. Refusing is the only safe answer: an unlabelled
    // number could be mA, A or a percentage, and battery sizing multiplies it
    // by hours.
    return {
      status: "UNSUPPORTED_ATTRIBUTE_VALUE",
      attributeName,
      why: `No unit-tagged current magnitude in "${originalValue}". Refusing to guess a magnitude for battery sizing.`,
    };
  }

  const magnitude = Number(match[1]);
  if (!Number.isFinite(magnitude) || magnitude <= 0) {
    return { status: "UNSUPPORTED_ATTRIBUTE_VALUE", attributeName };
  }

  const unitToken = clean(match[2]).toLowerCase();
  const factor = CURRENT_UNIT_FACTORS[unitToken];
  if (factor === undefined) {
    return { status: "UNSUPPORTED_ATTRIBUTE_VALUE", attributeName, unit: match[2] || null };
  }

  const amps = magnitude * factor;
  // Retain the quoted condition so the reader can see what the number is true
  // at. This is evidence, not a second authority.
  const condition = originalValue.replace(match[0], "").replace(/[;:,]+$/, "").trim() || null;

  return {
    status: "SUPPORTED",
    targetTable: "product_attributes",
    attributeName,
    originalValue,
    normalizedValue: amps,
    unit: "A",
    condition,
  };
};

const HUMAN_CURRENT_ATTRIBUTES = Object.freeze({
  "Standby Current": "standby_current",
  "Alarm Current": "alarm_current",
});

// KN-ADDRESS-MODEL-NORMALIZER: the closed vocabulary the `Address Model` entry
// above promises.
//
// THE DEFECT THIS REPAIRS. The policy classified `Address Model` as a human-only
// attribute mapped to `slc_address_model`, but no normalizer existed for it. The
// attribute branch therefore fell through to `normalizeProtocol`, which answered
// `UNSUPPORTED_ATTRIBUTE_VALUE` with `attributeName: "protocol"` for every real
// value -- so all eight Batch-1 address models would have been refused at
// promotion with an error that named the wrong attribute entirely. The reviewer
// would have read "this value is not a supported protocol", which is
// category-confused rather than merely incomplete.
//
// WHY A CLOSED SET AND NOT A PATTERN. Choosing the address model is the
// engineering claim; this function only checks that the human chose one of the
// five documented behaviours. Free-text matching here would let an unseen
// spelling of a new behaviour promote as a known one, and an address model that
// is silently wrong mis-sizes every loop the device appears in. An unknown value
// is refused with a status that says so, so it surfaces as a vocabulary question
// for a human rather than as a normalization detail.
export const ADDRESS_MODEL_CANONICAL_VALUES = Object.freeze({
  STANDALONE_ADDRESS: "STANDALONE_ADDRESS",
  SHARED_WITH_DETECTOR: "SHARED_WITH_DETECTOR",
  HOUSING_NO_ADDITIONAL_ADDRESS: "HOUSING_NO_ADDITIONAL_ADDRESS",
  HOUSED_MODULE_OWN_ADDRESS: "HOUSED_MODULE_OWN_ADDRESS",
  NON_SLC: "NON_SLC",
});

const ADDRESS_MODEL_KEYS = Object.freeze(
  new Map(
    Object.keys(ADDRESS_MODEL_CANONICAL_VALUES).map((key) => [
      key.toUpperCase().replace(/[-\s]+/g, "_"),
      ADDRESS_MODEL_CANONICAL_VALUES[key],
    ]),
  ),
);

const normalizeAddressModel = (fact) => {
  const attributeName = "slc_address_model";
  const originalValue = clean(fact?.originalValue);
  // `normalizedValue` first: the research fact author already mapped the
  // manufacturer's wording onto one of the five behaviours, and that mapping is
  // the reviewed human decision. `originalValue` is accepted only when it is
  // already a vocabulary token.
  const candidate = clean(fact?.normalizedValue) || originalValue;
  const canonical = ADDRESS_MODEL_KEYS.get(candidate.toUpperCase().replace(/[-\s]+/g, "_"));
  if (!canonical) {
    return {
      status: "UNSUPPORTED_ATTRIBUTE_VALUE",
      attributeName,
      // Named explicitly so the refusal is actionable. Without this the
      // reviewer sees an opaque status and cannot tell a vocabulary gap from a
      // genuinely unsupported value.
      message: `The SLC address model must be one of ${Object.keys(ADDRESS_MODEL_CANONICAL_VALUES).join(", ")}.`,
      allowedValues: Object.freeze(Object.keys(ADDRESS_MODEL_CANONICAL_VALUES)),
    };
  }
  return {
    status: "SUPPORTED",
    targetTable: "product_attributes",
    attributeName,
    originalValue,
    // Never a scalar count. The whole point of the closed vocabulary is that
    // SHARED_WITH_DETECTOR and HOUSED_MODULE_OWN_ADDRESS are NOT "1 address".
    normalizedValue: canonical,
    unit: null,
  };
};

// Human-only compatibility (KN-GOVERNANCE-REPAIR). A compatibility fact
// promotes only to product_compatibility with an allowlisted relationship
// kind; the target product resolves through the same exactly-one discipline
// as the source link. The deterministic path must never assert compatibility.
// Governed relationship types.
//
// DIRECTIONALITY. `engineering_relationships` is already directional
// (`left_entity_type/id`, `relationship_type`, `right_entity_type/id`), so a
// lifecycle successor is expressed as ONE row:
//
//     left = the product being superseded   (SGWL)
//     "Superseded By"
//     right = the successor product         (SGWLED)
//
// The inverse ("SGWLED supersedes SGWL") is a READ-MODEL projection of this row,
// never a second canonical row. Two rows would let the two directions disagree,
// and nothing in the schema could stop them.
//
// `Compatible With` and `Superseded By` are deliberately different types, not one
// polymorphic "related to". A supersession edge says the legacy product is
// retired in favour of a successor; it does NOT say they work together. A
// compatibility consumer that treated a supersession edge as compatibility would
// offer a discontinued strobe as an alternative to its own successor.
const RELATIONSHIP_COMPATIBILITY = "Compatible With";
const RELATIONSHIP_SUPERSEDED_BY = "Superseded By";

// Only these two. Adding a broad speculative list (Part Of, Replaces, Powers,
// ...) would put unreviewed semantics into a governed vocabulary on the strength
// of nothing.
const HUMAN_RELATIONSHIP_TYPES = Object.freeze([
  RELATIONSHIP_COMPATIBILITY,
  RELATIONSHIP_SUPERSEDED_BY,
]);

// Relationship types that assert interoperability. Everything else in the
// vocabulary is a lifecycle/lineage edge and must never be read as a
// compatibility claim by a matching or BOM consumer.
export const COMPATIBILITY_RELATIONSHIP_TYPES = Object.freeze([RELATIONSHIP_COMPATIBILITY]);

// Types whose SUBJECT is the left entity and whose TARGET is the right entity.
// Used by readers that must render "X is superseded by Y".
export const SUPERSESSION_RELATIONSHIP_TYPES = Object.freeze([RELATIONSHIP_SUPERSEDED_BY]);

export const isCompatibilityRelationship = (type) =>
  COMPATIBILITY_RELATIONSHIP_TYPES.includes(clean(type));

export const isSupersessionRelationship = (type) =>
  SUPERSESSION_RELATIONSHIP_TYPES.includes(clean(type));

// KN-PILOT-1 -- terminal classes observed by the first real internet
// enrichment pilot (manufacturer datasheets/manuals for a panel, a detector, a
// module, a base and a legacy detector). These are real, useful OBSERVATIONS
// and they are deliberately NOT promotable yet, each for its own stated
// reason. They are classified explicitly so they fail closed by policy with an
// auditable reason instead of by accident as "unclassified".
//
// Two distinct reasons appear below and must not be merged:
//   (a) SAFETY/COMPLIANCE AUTHORITY -- voltage, current, temperature, humidity
//       and listing claims. These constrain installation and life safety, they
//       are quoted with conditions (test voltage, tolerance, mounting, edition),
//       and no canonical destination stores them as structured engineering
//       truth today. Promoting them would create a second, condition-free
//       copy of a safety number.
//   (b) DOCUMENTATION, NOT PRODUCT TRUTH -- device role prose, expansion
//       hardware part references, series membership. Useful context, not a
//       canonical product attribute.
const TERMINAL_SAFETY = (reason) => TERMINAL(reason);
const TERMINAL_DOCUMENTATION = (reason) => TERMINAL(reason);

export const KNOWLEDGE_PROMOTION_ELIGIBILITY = Object.freeze({
  // -- ELIGIBLE -------------------------------------------------------------
  "Protocol": Object.freeze({
    eligible: true,
    path: "deterministic",
    destination: "attribute",
    // The normalizer dispatches on `policy.attributeName` (see
    // normalizeKnowledgeFactForPromotion), so the classification entry has to
    // declare the attribute it promotes to. Without this line the dispatch
    // reached Protocol and answered UNSUPPORTED_FACT_TYPE -- the same
    // class-of-drift defect that hid Address Model, one fact type over. Declared
    // here rather than defaulted in the dispatcher, so an eligible entry with no
    // attribute name is a visible omission instead of a silent fallback.
    attributeName: "protocol",
    reason: "A protocol is a genuine product attribute with a controlled vocabulary, and normalization is a spelling decision, not an identity or safety claim.",
  }),

  // -- HUMAN-ONLY ENGINEERING CAPACITIES ------------------------------------
  // Pilot vocabulary for governed capacity facts. Each maps to one exact
  // canonical attribute consumed by panel sizing; normalization is strict
  // numeric (see normalizeCapacity). Deterministic promotion is refused for
  // all of these in normalizeKnowledgeFactForPromotion.
  "SLC Loops": HUMAN_ATTRIBUTE("native_slc_loops", "Native SLC loop count sizes panels; it requires manufacturer evidence, a resolved product link, and human review."),
  "Detector Capacity": HUMAN_ATTRIBUTE("max_detectors_per_loop", "Per-loop detector capacity sizes panels; it requires manufacturer evidence, a resolved product link, and human review."),
  "Module Capacity": HUMAN_ATTRIBUTE("max_modules_per_loop", "Per-loop module capacity sizes panels; it requires manufacturer evidence, a resolved product link, and human review."),
  "System Points": HUMAN_ATTRIBUTE("max_system_points", "System point ceiling bounds panel selection; it requires manufacturer evidence, a resolved product link, and human review."),

  // -- HUMAN-ONLY COMPATIBILITY ----------------------------------------------
  // -- HUMAN-ONLY ADDRESS / SLC RESOURCE SEMANTICS ---------------------------
  // The scalar "SLC Addresses Consumed" fact type is TERMINAL (see the
  // KN-PILOT-1 safety/documentation classes above) and cannot express WHY a
  // device consumes an address, only HOW MANY. Manufacturer evidence in the
  // Farenhyt wave established five genuinely different resource behaviours
  // across twelve products, and they are NOT interchangeable for panel sizing:
  //
  //   STANDALONE_ADDRESS           the device itself owns one loop address
  //                                (IDP-PHOTO-IV/-T-IV, IDP-HEAT-ROR-IV)
  //   SHARED_WITH_DETECTOR         the device ADOPTS the detector's address and
  //                                consumes none, while still appearing on the
  //                                loop as a unique device type
  //                                (B200S-LF-IV: "adopt the same address as the
  //                                detector, but use a unique device type on the
  //                                loop")
  //   HOUSING_NO_ADDITIONAL_ADDRESS the address is owned by the sensor HEAD; the
  //                                housing adds none (IDP-PHOTO-R-IV in a
  //                                DNR/DNRW: "None, included with
  //                                IDP-PHOTO-R/-W/-IV")
  //   HOUSED_MODULE_OWN_ADDRESS    a module housed inside the device consumes its
  //                                OWN address, and the panel permits only one
  //                                device per address
  //                                (IDP-PULL-DA: "The addressable module is
  //                                housed inside the pull station." / "Only one
  //                                device per address is allowed.")
  //   NON_SLC                      not an SLC device at all: conventional zone
  //                                device or a NAC notification appliance
  //                                (6500RSE, SGWL) -- no SLC point is consumed
  //
  // Collapsing SHARED_WITH_DETECTOR and HOUSED_MODULE_OWN_ADDRESS to a count of
  // 1, or HOUSING_NO_ADDITIONAL_ADDRESS to 0, silently mis-sizes a 159-address
  // loop. This is therefore a human-gated attribute with a CLOSED vocabulary:
  // the value is a normalization decision over manufacturer wording, but which
  // model a device uses is an engineering claim and never auto-promotes.
  "Address Model": HUMAN_ATTRIBUTE("slc_address_model", "SLC/address resource semantics drive panel sizing and must not be flattened to an address count. The value is a closed vocabulary over manufacturer-stated resource behaviour; it requires manufacturer evidence, a resolved product link, and human engineering review."),

  "Product Relationship": HUMAN_RELATIONSHIP("Compatible With", "Compatibility authority lives in product_compatibility with its own lifecycle. Promotion carries a human-reviewed relationship to exactly one resolved target product; it never invents compatibility."),

  // -- HUMAN-ONLY LIFECYCLE ---------------------------------------------------
  "Lifecycle": HUMAN_LIFECYCLE("Lifecycle status is a governed product-lifecycle decision recorded against product_lifecycle_events, never an extracted attribute. It requires human review and lands as a Needs Review lifecycle event, never as silent canonical truth."),

  // -- IDENTITY CLAIMS: an identifier or taxonomy, not an attribute ----------
  "Part Number": TERMINAL("A part number is an identifier observed in a document, not a canonical product identity. Identity is resolved by the governed identity resolver against canonical_library_products, never by attribute promotion."),
  "Manufacturer": TERMINAL("Asserting a manufacturer on a canonical product is an identity claim, not the normalization of an existing attribute."),
  "Product Family": TERMINAL("Family placement is a governed taxonomy claim about canonical identity."),
  "Category": TERMINAL("Category is a governed taxonomy claim about canonical identity."),

  // -- COMMERCIAL / DISCOVERY-ONLY --------------------------------------------
  "Price": DISCOVERY("A price observation is not an approved costing price. Costing authority comes only from a governed price_record with approval_status, downstream_use and validity; promoting a scraped price would make an observation look like a governed cost."),
  "Currency": DISCOVERY("A currency token is neither a governed rate nor a price, and converting it is a commercial decision outside knowledge promotion."),

  // -- CERTIFICATION / SAFETY-RELEVANT CLAIMS ----------------------------------
  // Human-reviewable in principle, but no governed destination is wired yet:
  // listings require certification-authority evidence the extractor does not
  // produce. Kept terminal until a listing-evidence destination exists, so no
  // string match can become a compliance claim.
  "Certification": TERMINAL("A certification is a safety-relevant claim that requires listing evidence, not a string extracted from a document."),
  "Standard": TERMINAL("Naming a standard implies a listing or compliance claim, which requires evidence rather than extraction."),
  "Region": TERMINAL("A region claim can carry compliance meaning and is not a canonical product attribute."),
  "Country of Origin": TERMINAL("Country of origin is an origin/compliance claim, not a canonical product attribute."),

  // -- DESCRIPTIVE / DOCUMENT-DERIVED ---------------------------------------
  "Product Description": TERMINAL("Free text is not a canonical attribute and cannot be normalized without inventing meaning."),
  "Unit": TERMINAL("A unit of measure is descriptive, not a canonical product attribute."),
  "Language": TERMINAL("A document language is document metadata, not product knowledge."),
  "Document Type": TERMINAL("Document type is document metadata, not product knowledge."),
  "Revision": TERMINAL("A document revision is document metadata, not product knowledge."),
  "Document Date": TERMINAL("A document date is document metadata, not product knowledge."),

  // -- QUANTITY --------------------------------------------------------------
  "BOQ Item": TERMINAL("A quantity is governed by the Quantity Source Decision, never by knowledge promotion."),
  "BOQ Section": TERMINAL("A quantity is governed by the Quantity Source Decision, never by knowledge promotion."),

  // -- (a) SAFETY / COMPLIANCE AUTHORITY: real, useful, deliberately terminal -
  "Voltage Range": TERMINAL_SAFETY("A voltage range is an installation-safety limit quoted with a test condition and tolerance. No canonical destination stores conditioned electrical limits, so promoting it would create a second, condition-free copy of a safety number."),
  // RECLASSIFIED FROM TERMINAL_SAFETY (2026-10-01 policy closure).
  //
  // These were refused because a current figure is only true at a quoted
  // condition. That reasoning is correct, and it is preserved: the condition is
  // retained as evidence and never folded into the number. But refusing them
  // outright blocked a LIVE consumer -- `calculation-requirement-engine.mjs`
  // already maps `standby_current`/`alarm_current` into the `battery.standby-alarm`
  // rule, which blocks with REQUIRED_BUT_INPUTS_MISSING. Battery sizing could
  // therefore never be satisfied from manufacturer evidence at all.
  //
  // The destination is unit-normalised to amperes by `normalizeCurrent`, which
  // REFUSES an unlabelled or unrecognised magnitude rather than guessing, so the
  // original hazard (a 1000x error from reading mA as A) cannot recur.
  "Standby Current": HUMAN_CURRENT_ATTRIBUTE("standby_current", "Battery sizing already consumes this attribute and blocks without it; normalization is unit-explicit and refuses an ambiguous magnitude."),
  "Alarm Current": HUMAN_CURRENT_ATTRIBUTE("alarm_current", "Battery sizing already consumes this attribute and blocks without it; normalization is unit-explicit and refuses an ambiguous magnitude."),
  "SLC Current": TERMINAL_SAFETY("SLC loop current is a loop-budget figure quoted per device at a stated condition; it is not a canonical product attribute."),
  "Auxiliary Power Current": TERMINAL_SAFETY("Auxiliary power current is a supervised-load budget quoted per device at a stated condition."),
  "Power Supply Input": TERMINAL_SAFETY("The panel AC input is a supply-rating condition (voltage/frequency/current variants), not a canonical attribute; it must not be collapsed to one value."),
  "Power Supply Total Current": TERMINAL_SAFETY("A total output-current ceiling constrains power supply selection and belongs to the power-supply design authority, not to product knowledge promotion."),
  "NAC Current per Circuit": TERMINAL_SAFETY("A per-circuit NAC current limit is a design constraint for circuit calculation, not a canonical product attribute."),
  "Operating Temperature": TERMINAL_SAFETY("An operating temperature range is an environmental limit quoted with mounting and humidity conditions; promoting it would drop the conditions that make it true."),
  "Relative Humidity": TERMINAL_SAFETY("Relative humidity is an environmental limit quoted with a temperature condition; it is not promotable without that condition."),
  "SLC Addresses Consumed": TERMINAL_SAFETY("Address consumption drives panel sizing, but it is quoted per device family and protocol mode (single vs multi-address); promoting one figure would silently convert a device-family statement into a sizing authority."),

  // -- (b) DOCUMENTATION, NOT PRODUCT TRUTH ---------------------------------
  "Detector Technology": TERMINAL_DOCUMENTATION("Sensing technology is descriptive product information. It matters to matching and specification reasoning, but it has no governed canonical destination and no normalization rule, so it stays an observation."),
  "Device Role": TERMINAL_DOCUMENTATION("A device role (supervised control module, monitor module, relay) is catalogue documentation; the canonical role taxonomy is not derived from extracted prose."),
  // RECLASSIFIED FROM TERMINAL_DOCUMENTATION (2026-10-01 policy closure).
  // The `network.node-capacity` rule in `calculation-requirement-engine.mjs`
  // requires `maxNetworkNodes` and blocks with REQUIRED_BUT_INPUTS_MISSING when
  // it is absent, so the declared consumer already existed while the fact type
  // was refused. A count is a count: it carries no test condition, so the
  // original objection does not apply.
  "Network Panels": HUMAN_ATTRIBUTE("max_network_nodes", "Network node-capacity sizing already consumes this attribute and blocks without it; a count needs no unit normalization."),
  "NAC Outputs": TERMINAL_DOCUMENTATION("Built-in output-circuit count is a configuration statement about the panel variant, not a canonical product attribute."),
  "Auxiliary Power Outputs": TERMINAL_DOCUMENTATION("Built-in auxiliary-power output count is a configuration statement about the panel variant, not a canonical product attribute."),
  "Compatible Base": TERMINAL_DOCUMENTATION("A base/accessory pairing is relationship authority and already has a governed owner (product_accessories via the accessory review path, and product_compatibility via human-reviewed relationship promotion). Creating a third destination here would duplicate relationship authority."),
  "Expansion Hardware": TERMINAL_DOCUMENTATION("Expansion board/kit references are documentation of how a panel is extended, not canonical product truth."),
});

export function normalizeKnowledgeFactForPromotion(fact = {}, options = {}) {
  const deterministic = options?.authorization === "deterministic";
  const factType = clean(fact.factType);
  const policy = KNOWLEDGE_PROMOTION_ELIGIBILITY[factType];

  // Unclassified types are refused rather than guessed at, so the policy fails
  // closed for any fact type introduced after this table was written.
  if (!policy || policy.eligible !== true) {
    return {
      status: "UNSUPPORTED_FACT_TYPE",
      factType,
    };
  }

  // Human-only classes are never carried by the deterministic path, no matter
  // how confident the extractor is: confidence is not engineering authority.
  if (deterministic && policy.path !== "deterministic") {
    return {
      status: "HUMAN_REVIEW_REQUIRED",
      factType,
    };
  }

  if (policy.destination === "relationship") {
    // P0 SEMANTIC-LAUNDERING FIX.
    //
    // This line previously read:
    //     const relationshipType = clean(fact.relationshipType) || policy.relationshipType;
    //
    // which was a silent semantic-class change, not a default. The extractor
    // (`app/domain/knowledge-library-engine.mjs`) writes the semantic under the
    // attribute key `relationship`, while this normalizer only ever read
    // `relationshipType`. For an engine-authored fact the read yields
    // `undefined`, `clean()` maps that to "", the `||` then substituted the
    // policy's hard-coded literal "Compatible With", and the allowlist check
    // immediately below validated that already-defaulted value -- so it could
    // never fail.
    //
    // Net effect: `Requires` and `Replacement` facts were promoted as Approved
    // `Compatible With` rows in `engineering_relationships`, which
    // `worker/product-matching-api.mjs` then consumes as interoperability
    // claims. A lifecycle/accessory statement became compatibility authority.
    //
    // The fix is to require the author's semantic explicitly and let an unknown
    // one fail closed. There is deliberately NO fallback to "Compatible With":
    // a missing semantic is not compatibility.
    const relationshipType = clean(fact.relationshipType);
    if (!relationshipType) {
      return {
        status: "UNSUPPORTED_RELATIONSHIP_TYPE",
        factType,
        relationshipType: relationshipType || null,
        why: "No explicit relationship semantic was supplied. A missing semantic is not compatibility; it is an unmapped claim.",
      };
    }
    if (!HUMAN_RELATIONSHIP_TYPES.includes(relationshipType)) {
      return {
        status: "UNSUPPORTED_RELATIONSHIP_TYPE",
        factType,
        relationshipType,
        why: `"${relationshipType}" is not a governed relationship type. It must never be silently mapped onto ${HUMAN_RELATIONSHIP_TYPES.join(" or ")}.`,
      };
    }
    const targetPartNumber = clean(fact.targetPartNumber);
    if (!targetPartNumber) {
      return { status: "MISSING_RELATIONSHIP_TARGET", factType };
    }
    return {
      status: "SUPPORTED",
      targetTable: "engineering_relationships",
      relationshipType,
      targetPartNumber,
      originalValue: clean(fact.originalValue),
      normalizedValue: clean(fact.normalizedValue) || clean(fact.originalValue),
      unit: null,
    };
  }

  if (policy.destination === "lifecycle") {
    const lifecycleStatus = normalizeCanonicalLifecycleStatus(fact.normalizedValue || fact.originalValue);
    if (!lifecycleStatus) {
      // WHY THIS IS NOW A CLOSED VOCABULARY (and why it used not to be)
      // -----------------------------------------------------------
      // This branch used to accept ANY non-empty string. That admitted
      //
      //   "SUPERSEDED - SGWLED (L-Series LED) replaces SGWL; no
      //    discontinuation statement present in this document"
      //
      // straight into `product_lifecycle_events.lifecycle_status` as canonical
      // truth. It was worse than a bad value: it combined a lifecycle STATE with
      // a SUCCESSOR CLAIM, so one column asserted two different facts, and the
      // real normalizer (`normalizeLifecycle`) silently discarded it as
      // UNKNOWN -- meaning the library displayed a lifecycle event that no
      // consumer could read and no engineer could interpret.
      //
      // A lifecycle value is therefore now a token from the canonical
      // vocabulary, matched case- and separator-insensitively so a research
      // author may write "discontinued" or "DISCONTINUED", but NEVER prose.
      return { status: "UNSUPPORTED_LIFECYCLE_VALUE", attributeName: "lifecycle_status" };
    }
    return {
      status: "SUPPORTED",
      targetTable: "product_lifecycle_events",
      attributeName: "lifecycle_status",
      originalValue: clean(fact.originalValue),
      normalizedValue: lifecycleStatus,
      unit: null,
    };
  }

  const currentAttribute = HUMAN_CURRENT_ATTRIBUTES[factType];
  if (currentAttribute) {
    return normalizeCurrent(fact, currentAttribute);
  }

  const capacityAttribute = HUMAN_CAPACITY_ATTRIBUTES[factType];
  if (capacityAttribute) {
    return normalizeCapacity(fact, capacityAttribute);
  }

  // Dispatch by the POLICY's declared attribute, not by a separate list of
  // fact types. Deriving the dispatch from the same table that classified the
  // fact is what stops the two from drifting apart again.
  if (policy.destination === "attribute") {
    if (policy.attributeName === "slc_address_model") {
      return normalizeAddressModel(fact);
    }
    if (policy.attributeName === "protocol") {
      return normalizeProtocol(fact);
    }
    return { status: "UNSUPPORTED_FACT_TYPE", factType };
  }

  return normalizeProtocol(fact);
}
