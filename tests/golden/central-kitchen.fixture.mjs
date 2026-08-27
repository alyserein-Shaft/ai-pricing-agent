// Fire Alarm Golden Evaluation Set -- Central Kitchen - Makkah (frozen v1)
//
// This is the SECOND Golden project: a genuinely UNSEEN project at the start
// of the Fire Alarm E2E fix arc, never used to train or tune any Fire Alarm
// rule, taxonomy entry, or Product Knowledge fact. Its role in the Golden set
// is different from Opera's: Opera is graded against a REAL historical
// quotation (external ground truth); Central Kitchen is graded against the
// AGENT'S OWN evidence-aware framework (family correctness, acceptable
// candidate set, mandatory-requirement correctness, and honest escalation) --
// because for several of these lines, the BOQ text genuinely does not carry
// enough information to name one single correct historical part number, and
// the historical quotation is EVIDENCE of one engineer's choice, not proof
// that no other choice was ever valid (see the "historical quotation is
// evaluation evidence, not matching truth" frozen principle in
// docs/fire-alarm-mvp-v1-baseline.md).
//
// Every candidate set / mandatory-outcome fact below was read directly from
// the live, currently-persisted product_match_runs/product_match_candidates
// for this project (project_62553bdf-a06f-4951-8503-d058ac2d1a94) after the
// family-tier ranking fix, not invented. Where a field would require
// evidence this project's real data does not have (e.g. a historical PN this
// session never verified against the issued quotation), it is left
// explicitly null rather than guessed -- "missing evidence is never
// fabricated" applies to this fixture file itself, not only to the agent.
//
// finalState vocabulary:
//   RESOLVED                    -- one governed family, mandatory-clean top
//                                   tier, no unresolved technical/functional
//                                   variant question (a same-family color/
//                                   finish tie, e.g. Ivory vs White, is still
//                                   RESOLVED -- that is a commercial choice,
//                                   not an engineering ambiguity).
//   ENGINEER_REVIEW_REQUIRED    -- a genuine, named functional/technical
//                                   variant question the BOQ text does not
//                                   answer (action type, sensing combination,
//                                   candela/model, channel count, panel
//                                   capacity, mounting/accessory evidence).
//   NO_MATCH_OR_MISSING_EVIDENCE -- the correct family's own candidates carry
//                                   an open PRODUCT KNOWLEDGE gap (e.g. a
//                                   real SKU with no recorded value for an
//                                   attribute a confirmed requirement needs),
//                                   not a client-facing decision.
export const CENTRAL_KITCHEN_PROJECT_ID = "project_62553bdf-a06f-4951-8503-d058ac2d1a94";
export const CENTRAL_KITCHEN_GENERATED_AT = "2026-08-28";

export const CENTRAL_KITCHEN_GOLDEN_LINES = [
  {
    itemRef: "28.19", boqItemId: "boqitem_cf582ac9-4422-4dc0-a2ca-377087d85715",
    description: "Smoke detector Addressable type .",
    expectedFamily: "Addressable Smoke Detector",
    acceptablePartNumbers: ["IDP-PHOTO-IV", "IDP-PHOTO-T-W", "IDP-PHOTO-T-IV"],
    historicalPartNumber: null, historicalPNIsGroundTruth: false,
    expectedMandatoryOutcomes: [{ partNumber: "2151-CH", family: "Conventional Detector", mustFailAddressing: true }],
    expectedAccessories: [{ accessory: "Compatible detector base", required: true }],
    expectedFinalState: "RESOLVED",
    expectedEngineerQuestion: null,
    notes: "Top-3 tied on family + mandatory-clean status, differing only by color/finish suffix -- a commercial choice, not an engineering ambiguity.",
  },
  {
    itemRef: "28.20", boqItemId: "boqitem_063986a0-fde5-481d-b3f0-1dbb3254a842",
    description: "Heat detector Addressable type .",
    expectedFamily: "Addressable Heat Detector",
    acceptablePartNumbers: ["IDP-HEAT-ROR-IV"],
    historicalPartNumber: null, historicalPNIsGroundTruth: false,
    expectedMandatoryOutcomes: [
      { partNumber: "WIDP-HEAT", family: "Addressable Heat Detector", note: "Missing Product Data on addressing -- Product Knowledge gap, not a rejection of the family." },
    ],
    expectedAccessories: [{ accessory: "Compatible detector base", required: true }],
    expectedFinalState: "RESOLVED",
    expectedEngineerQuestion: null,
    notes: null,
  },
  {
    itemRef: "28.21", boqItemId: "boqitem_384409ef-f263-45a4-af4a-654ce64f019d",
    description: "Smoke detector Addressable type, with short circuit isolator.",
    expectedFamily: "Addressable Smoke Detector",
    acceptablePartNumbers: ["IDP-PHOTO-IV", "IDP-PHOTO-T-W", "IDP-PHOTO-T-IV"],
    historicalPartNumber: null, historicalPNIsGroundTruth: false,
    expectedMandatoryOutcomes: [],
    expectedAccessories: [{ accessory: "Compatible detector base", required: true }, { accessory: "Isolator", required: true, note: "short circuit isolator -- catalog-level isolator base/module distinction not independently re-verified this cycle." }],
    expectedFinalState: "RESOLVED",
    expectedEngineerQuestion: null,
    notes: null,
  },
  {
    itemRef: "28.22", boqItemId: "boqitem_ab70eb60-3db0-4614-b52b-d6884d26c4d9",
    description: "Manual call point Addressable type.",
    expectedFamily: "Manual Call Point",
    acceptablePartNumbers: ["IDP-PULL-SA", "IDP-PULL-DA"],
    historicalPartNumber: null, historicalPNIsGroundTruth: false,
    expectedMandatoryOutcomes: [],
    expectedAccessories: [],
    expectedFinalState: "ENGINEER_REVIEW_REQUIRED",
    expectedEngineerQuestion: "Confirm whether the Manual Call Point must be Single Action (IDP-PULL-SA) or Dual Action (IDP-PULL-DA) -- the BOQ text states addressable type only, not the action mechanism.",
    notes: "IDP-PULL-SA and IDP-PULL-DA are the governed-family (Pull Station, a registered synonym of Manual Call Point) mandatory-clean candidates; both are members of the acceptable candidate set.",
  },
  {
    itemRef: "28.24", boqItemId: "boqitem_95727496-c6f0-4af2-aa10-81b4fd8fce7d",
    description: "dual monitor moudule",
    expectedFamily: "Monitor Module",
    acceptablePartNumbers: ["IDP-MONITOR-2", "IDP-MINIMON", "IDP-MONITOR", "IDP-MONITOR-10"],
    historicalPartNumber: null, historicalPNIsGroundTruth: false,
    expectedMandatoryOutcomes: [{ partNumber: "WIDP-MONITOR", family: "Monitor Module", mustFail: true, note: "wireless variant -- fails the wired-loop-implied requirement." }],
    expectedAccessories: [],
    expectedFinalState: "ENGINEER_REVIEW_REQUIRED",
    expectedEngineerQuestion: "Confirm the required input channel count -- \"dual\" in the BOQ text suggests IDP-MONITOR-2 (2-channel), but IDP-MINIMON/IDP-MONITOR/IDP-MONITOR-10 remain plausible depending on the point count actually being monitored.",
    notes: null,
  },
  {
    itemRef: "28.25", boqItemId: "boqitem_9abafdd7-ea1f-4d64-a84b-663221a53d91",
    description: "Above ceilng , smoke detector Addressable type, with short circuit isolator.",
    expectedFamily: "Addressable Smoke Detector",
    acceptablePartNumbers: ["IDP-PHOTO-IV", "IDP-PHOTO-T-W", "IDP-PHOTO-T-IV"],
    historicalPartNumber: null, historicalPNIsGroundTruth: false,
    expectedMandatoryOutcomes: [],
    expectedAccessories: [{ accessory: "Compatible detector base", required: true }],
    expectedFinalState: "ENGINEER_REVIEW_REQUIRED",
    expectedEngineerQuestion: "Confirm whether \"above ceiling\" names a mounting/orientation accessory (e.g. a remote/duct-style sampling accessory) beyond the standard detector base -- the catalog does not carry a distinct above-ceiling mounting SKU, and the BOQ text alone does not resolve whether one is required.",
    notes: "The underlying candidate ranking is identical to an ordinary ceiling-mounted smoke detector (28.19/28.21) -- this line's open question is about accessory/mounting evidence, not family or technical-attribute correctness.",
  },
  {
    itemRef: "28.26", boqItemId: "boqitem_274bc985-6805-4dd9-90aa-87383237d64c",
    description: "Flasher",
    expectedFamily: "Strobe",
    acceptablePartNumbers: ["SWL-P", "SGWL", "SWK-P", "SRK-R", "SWL"],
    historicalPartNumber: null, historicalPNIsGroundTruth: false,
    expectedMandatoryOutcomes: [],
    expectedAccessories: [],
    expectedFinalState: "ENGINEER_REVIEW_REQUIRED",
    expectedEngineerQuestion: "Confirm the required candela rating, mounting (wall/ceiling), and environment (indoor/outdoor) -- \"Flasher\" alone names the family but not which of the many governed Strobe variants is required.",
    notes: null,
  },
  {
    itemRef: "28.27", boqItemId: "boqitem_2b374649-d461-4b9d-bddb-3b575d5a90e0",
    description: "Indoor siren with built flasher",
    expectedFamily: "Sounder/Strobe",
    acceptablePartNumbers: ["P4WK", "P2RHK", "P2RL-LF", "PC2WK", "P2RHK-P"],
    historicalPartNumber: null, historicalPNIsGroundTruth: false,
    expectedMandatoryOutcomes: [],
    expectedAccessories: [],
    expectedFinalState: "ENGINEER_REVIEW_REQUIRED",
    expectedEngineerQuestion: "Confirm the required candela rating, sound output, and mounting for this Sounder/Strobe -- the BOQ text confirms indoor + combined sounder/strobe function only.",
    notes: null,
  },
  {
    itemRef: "28.28", boqItemId: "boqitem_4a16ebf4-b5b9-4751-a452-82ea923d3f00",
    description: "Monitor module Addressable type.",
    expectedFamily: "Monitor Module",
    acceptablePartNumbers: ["IDP-MONITOR-2", "IDP-MINIMON", "IDP-MONITOR", "IDP-MONITOR-10"],
    historicalPartNumber: null, historicalPNIsGroundTruth: false,
    expectedMandatoryOutcomes: [{ partNumber: "WIDP-MONITOR", family: "Monitor Module", mustFail: true, note: "wireless variant -- fails the wired-loop-implied requirement." }],
    expectedAccessories: [],
    expectedFinalState: "ENGINEER_REVIEW_REQUIRED",
    expectedEngineerQuestion: "Confirm the required input channel count -- the BOQ text does not state single vs. dual (or 10-point) monitoring.",
    notes: null,
  },
  {
    itemRef: "28.29", boqItemId: "boqitem_be2b5ae1-1c0a-410d-ab02-21f261cf2c5f",
    description: "Beam detector",
    expectedFamily: "Beam Detector",
    acceptablePartNumbers: ["OSI-RI-FH"],
    historicalPartNumber: null, historicalPNIsGroundTruth: false,
    expectedMandatoryOutcomes: [
      { partNumber: "6500RSE", family: "Beam Detector", mustFailAddressing: true },
      { partNumber: "OSI-R-SS", family: "Beam Detector", mustFailAddressing: true },
      { partNumber: "6500RE", family: "Beam Detector", mustFailAddressing: true },
    ],
    expectedAccessories: [],
    expectedFinalState: "RESOLVED",
    expectedEngineerQuestion: null,
    notes: "The Turn E/F/G freeze target: the project's own confirmed \"entire fire detection system shall be analogue addressable type\" requirement must reject every conventional Beam Detector candidate while OSI-RI-FH (the only addressable Beam Detector in Product Knowledge) remains the sole mandatory-clean, correct-family candidate and must rank #1 -- no Duct/Smoke/Heat Detector candidate may outrank it.",
  },
  {
    itemRef: "28.30", boqItemId: "boqitem_cb7fd179-6482-4760-a782-28ecb48c44ab",
    description: "Multi detector",
    // Real, verified CURRENT behavior, not the aspirationally-correct family:
    // BOQ Understanding itself classifies "Multi detector" as Addressable
    // Smoke Detector, not Multi-Criteria Detector. This is a genuine,
    // accepted backlog item (see docs/fire-alarm-mvp-v1-baseline.md) --
    // encoded honestly here so the gate freezes what is TRUE today, not what
    // would be ideal, per this freeze's "missing evidence is never
    // fabricated" principle.
    expectedFamily: "Addressable Smoke Detector",
    acceptablePartNumbers: [],
    historicalPartNumber: null, historicalPNIsGroundTruth: false,
    expectedMandatoryOutcomes: [],
    expectedAccessories: [],
    expectedFinalState: "ENGINEER_REVIEW_REQUIRED",
    expectedEngineerQuestion: "Confirm the required sensing combination (e.g. photoelectric + heat, photoelectric + CO) -- \"Multi detector\" alone does not name which criteria the device must sense. Separately: BOQ Understanding currently classifies this line as Addressable Smoke Detector rather than Multi-Criteria Detector, a known, accepted family-classification gap for this specific wording, not a resolved match.",
    notes: "acceptablePartNumbers intentionally empty: this line's true governed family is itself disputed (Understanding says Addressable Smoke Detector; the correct family is almost certainly Multi-Criteria Detector) -- see remaining backlog in docs/fire-alarm-mvp-v1-baseline.md. Not re-classified this freeze: STOP explicitly forbids additional Fire Alarm enrichment.",
  },
  {
    itemRef: "28.31", boqItemId: "boqitem_5c22b811-4cc9-4b8c-8a17-db1f83ae8c6d",
    description: "Multi detector.with short circuit isolator.",
    expectedFamily: "Addressable Smoke Detector",
    acceptablePartNumbers: [],
    historicalPartNumber: null, historicalPNIsGroundTruth: false,
    expectedMandatoryOutcomes: [],
    expectedAccessories: [],
    expectedFinalState: "ENGINEER_REVIEW_REQUIRED",
    expectedEngineerQuestion: "Same open question as 28.30 (sensing combination, plus the same accepted family-classification gap), plus isolator accessory confirmation.",
    notes: "Same accepted family-classification gap as 28.30.",
  },
  {
    itemRef: "28.32", boqItemId: "boqitem_2bb04c6f-3e13-41f1-a764-4d0331f8e1e9",
    description: "Heat detector Addressable type, with short circuit isolator.",
    expectedFamily: "Addressable Heat Detector",
    acceptablePartNumbers: ["IDP-HEAT-ROR-IV"],
    historicalPartNumber: null, historicalPNIsGroundTruth: false,
    expectedMandatoryOutcomes: [{ partNumber: "WIDP-HEAT", family: "Addressable Heat Detector", note: "Missing Product Data on addressing -- Product Knowledge gap." }],
    expectedAccessories: [{ accessory: "Compatible detector base", required: true }, { accessory: "Isolator", required: true }],
    expectedFinalState: "RESOLVED",
    expectedEngineerQuestion: null,
    notes: null,
  },
  {
    itemRef: "28.33", boqItemId: "boqitem_da17ee8c-7c5b-4779-b667-e784ee689d86",
    description: "siren with bult in flusher , IP-65",
    expectedFamily: "Sounder/Strobe",
    acceptablePartNumbers: ["P4WK", "P2RHK", "P2RL-LF", "PC2WK", "P2RHK-P"],
    historicalPartNumber: null, historicalPNIsGroundTruth: false,
    expectedMandatoryOutcomes: [],
    expectedAccessories: [],
    expectedFinalState: "ENGINEER_REVIEW_REQUIRED",
    expectedEngineerQuestion: "IP-65 narrows the field to Outdoor-rated Sounder/Strobe SKUs (e.g. the P2RK-class Outdoor variants) -- confirm the exact candela/sound-output model within that narrowed, IP-65-eligible set.",
    notes: "IP-65 evidence narrows the acceptable set more than 28.27's plain \"Indoor siren\" wording does -- do not treat this line as equally unconstrained as 28.27 in future review.",
  },
  {
    itemRef: "28.34", boqItemId: "boqitem_a3030d31-a7fe-45b2-9115-66b3f3d852d9",
    description: "Smoke wall mounted , addresable type",
    expectedFamily: "Addressable Smoke Detector",
    acceptablePartNumbers: ["IDP-PHOTO-IV", "IDP-PHOTO-T-W", "IDP-PHOTO-T-IV"],
    historicalPartNumber: null, historicalPNIsGroundTruth: false,
    expectedMandatoryOutcomes: [],
    expectedAccessories: [{ accessory: "Compatible detector base", required: true }],
    expectedFinalState: "RESOLVED",
    expectedEngineerQuestion: null,
    notes: null,
  },
  {
    itemRef: "28.35", boqItemId: "boqitem_548f982a-a6b5-4eb6-be51-b4ed6c196423",
    description: "FARP Addressable type.",
    expectedFamily: "Annunciator",
    acceptablePartNumbers: ["RA-2000", "RA-2000GRAY"],
    historicalPartNumber: null, historicalPNIsGroundTruth: false,
    expectedMandatoryOutcomes: [{ partNumber: "RA-2000", family: "Annunciator", note: "Missing Product Data on addressing -- Product Knowledge has never recorded this attribute for the Annunciator family; a real, open gap, not a rejection." }],
    expectedAccessories: [],
    expectedFinalState: "NO_MATCH_OR_MISSING_EVIDENCE",
    expectedEngineerQuestion: null,
    notes: "Genuinely different governed family (Annunciator, correctly synonymous with the project's own \"FARP\"/Fire Alarm Repeater Panel wording) correctly outranks the wrong-family Fire Alarm Control Panel candidates -- the open item is Product Knowledge completeness (addressing attribute never recorded for RA-2000/RA-2000GRAY), out of this freeze's scope to enrich.",
  },
  {
    itemRef: "28.36", boqItemId: "boqitem_3595b712-9931-4687-9440-bbf53b1ce03f",
    description: "FACP Addressable type.",
    expectedFamily: "Fire Alarm Control Panel",
    acceptablePartNumbers: ["IFP-2100HVB", "IFP-75HVB", "IFP-75B", "RFP-2100HVB", "IFP-75HV"],
    historicalPartNumber: null, historicalPNIsGroundTruth: false,
    expectedMandatoryOutcomes: [],
    expectedAccessories: [],
    expectedFinalState: "ENGINEER_REVIEW_REQUIRED",
    expectedEngineerQuestion: "Confirm the required panel capacity (loop/zone count) -- the BOQ text names the family (FACP, addressable) but not the size, and the 75-series and 2100-series panels are genuinely different capacities, not interchangeable variants of the same SKU.",
    notes: "A freshly-observed residual finding beyond the six user-named ambiguity categories -- reported honestly rather than silently marked RESOLVED on a 5-way capacity tie.",
  },
];

// 17 classifiable Fire Alarm lines total (the project's 18th Fire Alarm-
// tagged row is a non-product/service line and is excluded from candidate
// discovery scoring, matching the frozen 17/18 discovery baseline).
export const CENTRAL_KITCHEN_EXPECTED_BASELINE = Object.freeze({
  classifiableFireAlarmLines: 17,
  candidateDiscovery: "17/17",
  acceptableCandidateSetRate: "17/17",
  trueMatchingErrors: 0,
  falseResolves: 0,
});
