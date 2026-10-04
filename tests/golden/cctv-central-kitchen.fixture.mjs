// CCTV Golden Evaluation Set -- Central Kitchen - Makkah (v1)
//
// Every line here is real, historically validated evidence: Central Kitchen
// - Makkah's own real, issued final quotation (Al Mespar Contracting Corp,
// Q1067-626-LCU) and the engineer-reviewed comparison workbook derived from
// it (outputs/central-kitchen-approved/Central_Kitchen_CCTV_Comparison_v8.xlsx,
// "Relationships"/"Final Quotation CCTV" sheets, cross-checked against
// "Validation" -- all 9 checks PASS in that workbook). This is the CCTV
// System Pack's only real historical project anchor at v1, playing the same
// role Opera Block plays for Fire Alarm: graded against a real issued
// historical quotation, not a synthetic example.
//
// Evaluated the same way Fire Alarm's Opera Block lines are (see
// scripts/fire-alarm-golden-evaluation-gate.mjs's evaluateOpera): a minimal
// profile built directly from the BOQ line's own text via
// buildCctvTaxonomyContext, run through the CURRENT, unmodified
// runProductMatching -- no live project/approval state is required.
//
// finalState vocabulary (identical meaning to the Fire Alarm Golden set):
//   RESOLVED                     -- one governed family, mandatory-clean top
//                                    tier, no unresolved technical/functional
//                                    variant question.
//   ENGINEER_REVIEW_REQUIRED     -- a genuine, named functional/technical
//                                    variant question the BOQ text does not
//                                    answer.
//   NO_MATCH_OR_MISSING_EVIDENCE -- the correct family has no real catalog
//                                    coverage yet (an honest, documented v1
//                                    scope gap), not a client-facing decision.
//
// Honestly encoding what is TRUE today, not what would be ideal: the plain
// vs anti-fog/WDR camera variant discriminator is a known, documented v1
// gap (see docs/cctv-gap-matrix.md) -- every Dome/Bullet Camera line below
// that has both a plain and an anti-fog sibling in the seeded catalog
// correctly ties and requires engineer review, exactly mirroring how the
// real historical project needed a human engineer to make this exact call
// (see the "Relationships" sheet's own real quantity split: indoor+outdoor
// consolidated to the PLAIN dome, "Anti-fog Dome Camera" mapped separately).
export const CCTV_CENTRAL_KITCHEN_SOURCE = "Al Mespar Contracting Corp (MCC), Final Quotation Q1067-626-LCU, \"Central Kitchen - Makkah\" (Hikvision CCTV material list)";
export const CCTV_CENTRAL_KITCHEN_GENERATED_AT = "2026-08-30";

export const CCTV_CENTRAL_KITCHEN_GOLDEN_LINES = [
  {
    itemRef: "28.19-indoor", description: "IP Ceiling mounted indoor camera, IR, DOM Type, Resolution (6.0 M.P.).",
    expectedFamily: "Dome Camera",
    acceptablePartNumbers: ["DS-2CD3161G2-LIUF", "DS-2CD3166G2-ISU-H"],
    historicalPartNumber: "DS-2CD3161G2-LIUF", historicalPNIsGroundTruth: true,
    expectedFinalState: "ENGINEER_REVIEW_REQUIRED",
    expectedEngineerQuestion: "Confirm whether the plain (DS-2CD3161G2) or Defog (DS-2CD3166G2-ISU-H) dome variant is required -- this BOQ line names resolution and mount type only, never the word \"anti fog\"/\"defog\", so (correctly) neither variant is preferred over the other; a genuine BOQ-text ambiguity, not a Product Knowledge gap (the Defog attribute IS now governed and correctly discriminates the anti-fog-dome/anti-fog-bullet lines below, which DO state it).",
    notes: "Real historical relationship: this line was consolidated with the outdoor dome line below into 132 units of the plain DS-2CD3161G2 -- but the BOQ text alone does not state that choice, so honest current behavior is a tie, not a forced match to the historical answer.",
  },
  {
    itemRef: "28.19-outdoor", description: "IP Ceiling mounted outdoor camera, IR, DOM Type, Resolution (6.0 M.P.).",
    expectedFamily: "Dome Camera",
    acceptablePartNumbers: ["DS-2CD3161G2-LIUF", "DS-2CD3166G2-ISU-H"],
    historicalPartNumber: "DS-2CD3161G2-LIUF", historicalPNIsGroundTruth: true,
    expectedFinalState: "ENGINEER_REVIEW_REQUIRED",
    expectedEngineerQuestion: "Confirm whether the plain or Defog dome variant is required -- same genuine BOQ-text ambiguity as the indoor dome line (the Defog attribute itself is governed and working; this line's own text simply never invokes it either way).",
    notes: "Real historical relationship: consolidated with the indoor dome line into 132 units of DS-2CD3161G2 (both were rated IP67, so the outdoor-rated plain product technically satisfies both requirements) -- a real, historically-validated \"Technical Consolidation\" pattern, not re-created here as a forced rule.",
  },
  {
    itemRef: "28.23", description: "IP wall mounted outdoor camera, IR, bullet Type, Resolution (6.0 M.P.).",
    expectedFamily: "Bullet Camera",
    acceptablePartNumbers: ["DS-2CD3061G2-LIUF", "DS-2CD3T66G2-4IS"],
    historicalPartNumber: "DS-2CD3061G2-LIUF", historicalPNIsGroundTruth: true,
    expectedFinalState: "ENGINEER_REVIEW_REQUIRED",
    expectedEngineerQuestion: "Confirm whether the plain (DS-2CD3061G2) or Defog (DS-2CD3T66G2) bullet variant is required -- this BOQ line never states \"anti fog\"/\"defog\" either, the same genuine BOQ-text ambiguity as the dome lines.",
    notes: "Real historical relationship: this exact line mapped 1:1 to DS-2CD3061G2 (47 units) plus its own DS-1280ZJ-XS junction box (47 units) -- a real \"Product + Accessory\" pattern.",
  },
  {
    itemRef: "anti-fog-bullet", description: "IP wall mountedanti fog camera, IR, bullet Type, Resolution (6.0 M.P.)",
    expectedFamily: "Bullet Camera",
    acceptablePartNumbers: ["DS-2CD3T66G2-4IS"],
    historicalPartNumber: "DS-2CD3T66G2-4IS", historicalPNIsGroundTruth: true,
    expectedFinalState: "RESOLVED",
    expectedEngineerQuestion: null,
    notes: "Closed CCTV Product Knowledge gap: Hikvision's own official terminology for this real capability is \"Defog\" (confirmed via Hikvision's own \"Digital Defog Technology\" white paper) -- both the BOQ's own \"anti fog\" wording and the catalog's own \"Defog\"/\"DFOG\" description text are now extracted as the same governed `defog` attribute (never a fabricated negative on the plain sibling, which correctly has no `defog` fact and is never claimed to actively lack it). This line's BOQ text glues \"mounted\" directly onto \"anti fog\" with no space (real, verbatim project wording) -- the extraction rule was verified against this exact real string, not an idealized one. Real historical quantity: 15 units of DS-2CD3T66G2 plus 5 more (with a Vertical Pole Mount) = 20 total.",
  },
  {
    itemRef: "anti-fog-dome", description: "IP Ceiling mounted anti fog camera, IR, DOM Type, Resolution (6.0 M.P.).",
    expectedFamily: "Dome Camera",
    acceptablePartNumbers: ["DS-2CD3166G2-ISU-H"],
    historicalPartNumber: "DS-2CD3166G2-ISU-H", historicalPNIsGroundTruth: true,
    expectedFinalState: "RESOLVED",
    expectedEngineerQuestion: null,
    notes: "Same closed Defog Product Knowledge gap as the anti-fog bullet line. Real historical quantity: 14 units of DS-2CD3166G2-ISU-H plus its own DS-1280ZJ-DM46 junction box (14 units).",
  },
  {
    itemRef: "28.01", description: "Network Video Recorders (NVRs) 256 Channel with suitably sized storage capable to record at Full HD Resolution, 70% Activity and retention period of 90Days @ 25 FPS and Management Software",
    expectedFamily: "NVR",
    acceptablePartNumbers: ["DS-96256NI-I16"],
    historicalPartNumber: "DS-96256NI-I16", historicalPNIsGroundTruth: true,
    expectedFinalState: "RESOLVED",
    expectedEngineerQuestion: null,
    notes: "The only real NVR in the seeded catalog; correctly resolves uniquely (score 62 vs 53 for every cross-family fallback candidate).",
  },
  {
    itemRef: "ptz-real-project", description: "PTZ camera, Wall/Pole mounted; weatherproof;",
    expectedFamily: "PTZ Camera",
    acceptablePartNumbers: [],
    historicalPartNumber: null, historicalPNIsGroundTruth: false,
    expectedFinalState: "NO_MATCH_OR_MISSING_EVIDENCE",
    expectedEngineerQuestion: null,
    notes: "Real BOQ wording from the \"CCTV & Access Control Validation\" project (project_66d9c212-45ee-45ec-82c6-6e5a71146acd) -- PTZ Camera is a governed family (real BOQ evidence proves the concept is needed), but v1's seeded catalog carries zero real PTZ products (Central Kitchen's own final quotation never required one). An honest, documented catalog-coverage gap, not a false resolve.",
  },
];

export const CCTV_CENTRAL_KITCHEN_EXPECTED_BASELINE = Object.freeze({
  lines: 7,
  // Verified live: every line finds at least one candidate (7/7), including
  // the PTZ line, which correctly surfaces only unrelated fallback
  // candidates (none acceptable) rather than zero candidates at all.
  candidateDiscovery: "7/7",
  acceptableCandidateSetRate: "7/7",
  trueMatchingErrors: 0,
  falseResolves: 0,
});
