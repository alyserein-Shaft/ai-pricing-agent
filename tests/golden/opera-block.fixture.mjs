// Fire Alarm Golden Evaluation Set -- Opera Block Townhouses (Diriyah),
// frozen v1.
//
// This is the FIRST Golden project: graded against a REAL, external,
// independently-issued ground truth (the final client quotation
// Q1039-426-LCU, Al Mespar Contracting Corp, Rev00, 22-Apr-26, SAR
// 695,984.00 material + service) -- not a synthetic fixture and not this
// agent's own prior output. 26 material line items (S/N 1-26); S/N 27
// "Fire Alarm System Testing & Commissioning" is a labor/service line and is
// excluded from product-matching scoring.
//
// Ground truth transcription, integrity check against the independently
// recorded total, and the live per-line evaluation this fixture's expected
// values are drawn from all live in scripts/regression-opera-block-fas.mjs
// -- this file adds the richer per-line expectation shape the Golden
// Evaluation Gate needs (family, acceptable set, final state, engineer
// question) on top of that script's own transcribed GROUND_TRUTH array. It
// does not re-transcribe the source document; see that script's own header
// comment for full provenance (tmp/opera/render/final-03.jpg, final-04.jpg).
//
// historicalPNIsGroundTruth is false wherever the issued quotation itself
// used a generic label ("Battery", "Batt") rather than citing a specific
// manufacturer part number -- that is real historical EVIDENCE a battery was
// supplied, not proof of which exact SKU, so it is never treated as forced
// truth for a Top-1/Top-3 hit.
//
// finalState here is graded against the CURRENT evaluation methodology this
// project has always used (a minimal, description-only search profile built
// via the same deterministic taxonomy classifier the real pipeline uses
// before AI understanding runs, per buildProfile() in
// scripts/regression-opera-block-fas.mjs) -- NOT the fuller, requirement-
// profile-aware pipeline Central Kitchen was evaluated through. Several
// accessory/hardware lines (batteries, cabinets, SLC expander cards, phone
// jacks) have no governed family entry in the current Fire Alarm taxonomy at
// all (taxonomyClassifiedFamily: null) -- this is an honest, pre-existing
// taxonomy coverage gap for non-detection/notification hardware, reported as
// backlog in docs/fire-alarm-mvp-v1-baseline.md, not silently hidden by
// marking these lines RESOLVED.
export const OPERA_BLOCK_GENERATED_AT = "2026-08-28";

export const OPERA_BLOCK_GOLDEN_LINES = [
  { sn: 1, description: "Farenhyt 2100 point Integrated Fire Alarm & Emergency Communication System...", expectedFamily: "Fire Alarm Control Panel", historicalPartNumber: "IFP-2100ECSHV", historicalPNIsGroundTruth: true, acceptablePartNumbers: ["IFP-2100ECSHV"], expectedFinalState: "ENGINEER_REVIEW_REQUIRED", expectedEngineerQuestion: "Confirm the panel requires the ECS (Emergency Communication System) variant specifically -- the governed family match alone (IFP-2100HVB) does not distinguish the ECS-integrated SKU from the base HVB panel.", notes: "Real gap: IFP-2100ECSHV is a distinct, ECS-capable SKU Product Knowledge does not yet carry as a separate identity from IFP-2100HVB." },
  { sn: 2, description: "BATTERY BACKBOX-MOUNTS UP TO 2, BAT-12260 BATTERIES", expectedFamily: null, historicalPartNumber: "BB-26", historicalPNIsGroundTruth: true, acceptablePartNumbers: ["BB-26"], expectedFinalState: "RESOLVED", expectedEngineerQuestion: null, notes: "Accessory/hardware line -- no governed Fire Alarm family entry exists for battery backboxes; matched via exact part-number/semantic retrieval, not family classification." },
  { sn: 3, description: "12V, 26AH Battery", expectedFamily: null, historicalPartNumber: null, historicalPNIsGroundTruth: false, acceptablePartNumbers: [], expectedFinalState: "NO_MATCH_OR_MISSING_EVIDENCE", expectedEngineerQuestion: "Confirm the exact battery SKU for 12V/26AH -- the issued quotation cites only a generic \"Battery\" label, not a manufacturer part number, and Product Knowledge does not currently carry a matching catalog entry.", notes: "historicalPNIsGroundTruth=false: the source document itself never named a specific PN for this line." },
  { sn: 4, description: "High voltage (240V) Intelligent Distributed Power Module", expectedFamily: null, historicalPartNumber: "RPS-1000HV", historicalPNIsGroundTruth: true, acceptablePartNumbers: ["RPS-1000HV"], expectedFinalState: "NO_MATCH_OR_MISSING_EVIDENCE", expectedEngineerQuestion: null, notes: "Real gap: RPS-1000HV is not currently retrieved as Top-1/Top-3 by description alone -- a genuine retrieval-stage gap for this power-module family, reported as backlog." },
  { sn: 5, description: "12V, 7AH Battery", expectedFamily: null, historicalPartNumber: null, historicalPNIsGroundTruth: false, acceptablePartNumbers: [], expectedFinalState: "NO_MATCH_OR_MISSING_EVIDENCE", expectedEngineerQuestion: "Confirm the exact battery SKU for 12V/7AH -- same generic-label gap as S/N 3.", notes: null },
  { sn: 6, description: "ECS 50 Watt Amplifier 220vac 50/60Hz", expectedFamily: null, historicalPartNumber: "ECS-50WHV", historicalPNIsGroundTruth: true, acceptablePartNumbers: ["ECS-50WHV"], expectedFinalState: "RESOLVED", expectedEngineerQuestion: null, notes: null },
  { sn: 7, description: "Remote Mounting Kit Cabinet holds two 6815s. Red Cabinet", expectedFamily: null, historicalPartNumber: "5815RMK", historicalPNIsGroundTruth: true, acceptablePartNumbers: ["5815RMK", "5815RMKB"], expectedFinalState: "ENGINEER_REVIEW_REQUIRED", expectedEngineerQuestion: "Confirm 5815RMK vs 5815RMKB (color/finish or capacity variant) -- description-only retrieval currently returns the -B suffix variant.", notes: null },
  { sn: 8, description: "SLC Loop Expander which supports 159 Detectors and 159 Modules", expectedFamily: null, historicalPartNumber: "6815", historicalPNIsGroundTruth: true, acceptablePartNumbers: ["6815"], expectedFinalState: "NO_MATCH_OR_MISSING_EVIDENCE", expectedEngineerQuestion: null, notes: "Real gap: no governed family entry for SLC loop expander cards; description-only retrieval currently surfaces an unrelated Fire Alarm Control Panel candidate -- reported as taxonomy-coverage backlog, not silently accepted." },
  { sn: 9, description: "Intelligent Addressable Photoelectric Smoke Detector (Ivory Color) (Base Not Included)", expectedFamily: "Addressable Smoke Detector", historicalPartNumber: "IDP-PHOTO-IV", historicalPNIsGroundTruth: true, acceptablePartNumbers: ["IDP-PHOTO-IV"], expectedFinalState: "RESOLVED", expectedEngineerQuestion: null, notes: null },
  { sn: 10, description: "4\" standard flangeless mounting base (Ivory Color)", expectedFamily: null, historicalPartNumber: "B501-IV", historicalPNIsGroundTruth: true, acceptablePartNumbers: ["B501-IV"], expectedFinalState: "RESOLVED", expectedEngineerQuestion: null, notes: null },
  { sn: 11, description: "Intelligent Addressable Photoelectric Smoke Detector (Ivory Color) (Base Not Included)", expectedFamily: "Addressable Smoke Detector", historicalPartNumber: "IDP-PHOTO-IV", historicalPNIsGroundTruth: true, acceptablePartNumbers: ["IDP-PHOTO-IV"], expectedFinalState: "RESOLVED", expectedEngineerQuestion: null, notes: "Same SKU as S/N 9, different location/quantity line in the source document." },
  { sn: 12, description: "Ivory Color, Intelligent addressable sounder base... ANSI Temporal 3/4, continuous, marching, custom tone.", expectedFamily: "Sounder Base", historicalPartNumber: "B200S-IV", historicalPNIsGroundTruth: true, acceptablePartNumbers: ["B200S-IV", "B200S-LF-IV"], expectedFinalState: "ENGINEER_REVIEW_REQUIRED", expectedEngineerQuestion: "Confirm B200S-IV vs the -LF (low-frequency sounder) variant -- description-only retrieval currently returns the -LF variant.", notes: null },
  { sn: 13, description: "Advanced multi-criteria fire/CO detector, Ivory color. (Base Not Included)", expectedFamily: "Multi-Criteria Detector", historicalPartNumber: "IDP-FIRE-CO-IV", historicalPNIsGroundTruth: true, acceptablePartNumbers: ["IDP-FIRE-CO-IV"], expectedFinalState: "RESOLVED", expectedEngineerQuestion: null, notes: null },
  { sn: 14, description: "4\" standard flangeless mounting base (Ivory Color)", expectedFamily: null, historicalPartNumber: "B501-IV", historicalPNIsGroundTruth: true, acceptablePartNumbers: ["B501-IV"], expectedFinalState: "RESOLVED", expectedEngineerQuestion: null, notes: null },
  { sn: 15, description: "Intelligent Addressable Fixed temperature and rate-of-rise thermal detector...(Base Not Included) (Ivory Color)", expectedFamily: "Addressable Heat Detector", historicalPartNumber: "IDP-HEAT-ROR-IV", historicalPNIsGroundTruth: true, acceptablePartNumbers: ["IDP-HEAT-ROR-IV"], expectedFinalState: "RESOLVED", expectedEngineerQuestion: null, notes: null },
  { sn: 16, description: "4\" standard flangeless mounting base (Ivory Color)", expectedFamily: null, historicalPartNumber: "B501-IV", historicalPNIsGroundTruth: true, acceptablePartNumbers: ["B501-IV"], expectedFinalState: "RESOLVED", expectedEngineerQuestion: null, notes: null },
  { sn: 17, description: "Intelligent Addressable Pull Station, Dual Action, Key Reset", expectedFamily: "Pull Station", historicalPartNumber: "IDP-PULL-DA", historicalPNIsGroundTruth: true, acceptablePartNumbers: ["IDP-PULL-SA", "IDP-PULL-DA"], expectedFinalState: "ENGINEER_REVIEW_REQUIRED", expectedEngineerQuestion: "Confirm Single Action vs Dual Action -- the SAME genuine action-type ambiguity class frozen for Central Kitchen 28.22. This project's engineer chose Dual Action; that is real historical evidence for THIS project, not proof Dual Action is universally correct.", notes: "Cross-project confirmation that the action-type ambiguity is a genuine, recurring engineering decision, not an artifact of one project's evidence." },
  { sn: 18, description: "Weather Stopper II, surface mount.", expectedFamily: null, historicalPartNumber: "STI3150", historicalPNIsGroundTruth: true, acceptablePartNumbers: ["STI3150"], expectedFinalState: "RESOLVED", expectedEngineerQuestion: null, notes: null },
  { sn: 19, description: "HORN STROBE 2W RED WALL", expectedFamily: "Sounder/Strobe", historicalPartNumber: "P2RL", historicalPNIsGroundTruth: true, acceptablePartNumbers: ["P2RL", "P4WK"], expectedFinalState: "ENGINEER_REVIEW_REQUIRED", expectedEngineerQuestion: "Confirm the required wattage/candela class -- \"2W\" in the description implies P2RL, but description-only retrieval currently favors a different wattage-class SKU (P4WK).", notes: "Same variant-ambiguity class frozen for Central Kitchen's Flasher/Sounder-Strobe lines." },
  { sn: 20, description: "SPEAKER STROBE RED CEILING", expectedFamily: "Speaker/Strobe", historicalPartNumber: "SPSCRL", historicalPNIsGroundTruth: true, acceptablePartNumbers: ["SPSCRL"], expectedFinalState: "NO_MATCH_OR_MISSING_EVIDENCE", expectedEngineerQuestion: null, notes: "Real gap: SPSCRL is not currently retrieved in Top-3 by description alone -- reported as backlog." },
  { sn: 21, description: "SPEAKER STROBE RED WALL", expectedFamily: "Speaker/Strobe", historicalPartNumber: "SPSRL", historicalPNIsGroundTruth: true, acceptablePartNumbers: ["SPSRL"], expectedFinalState: "NO_MATCH_OR_MISSING_EVIDENCE", expectedEngineerQuestion: null, notes: "Same retrieval-stage gap as S/N 20." },
  { sn: 22, description: "Intelligent Addressable Relay Module W/ 2 Isolated Sets Of Form C Contacts", expectedFamily: "Relay Module", historicalPartNumber: "IDP-RELAY", historicalPNIsGroundTruth: true, acceptablePartNumbers: ["IDP-RELAY", "IDP-RELAY-6"], expectedFinalState: "ENGINEER_REVIEW_REQUIRED", expectedEngineerQuestion: "Confirm the required relay/contact count -- description-only retrieval currently favors the 6-relay variant (IDP-RELAY-6) over the base IDP-RELAY.", notes: "Same channel/count-ambiguity class frozen for Central Kitchen's Monitor Module lines." },
  { sn: 23, description: "4\" Square Surface Mount Electrical Box for use with IDP modules", expectedFamily: null, historicalPartNumber: "SMB500", historicalPNIsGroundTruth: true, acceptablePartNumbers: ["SMB500"], expectedFinalState: "RESOLVED", expectedEngineerQuestion: null, notes: null },
  { sn: 24, description: "Farenhyt Fire Fighter Telephone Control Panel", expectedFamily: null, historicalPartNumber: "IFP-FFT", historicalPNIsGroundTruth: true, acceptablePartNumbers: ["IFP-FFT"], expectedFinalState: "RESOLVED", expectedEngineerQuestion: null, notes: null },
  { sn: 25, description: "Remote Handset", expectedFamily: null, historicalPartNumber: "FFT-RHS", historicalPNIsGroundTruth: true, acceptablePartNumbers: ["FFT-RHS"], expectedFinalState: "ENGINEER_REVIEW_REQUIRED", expectedEngineerQuestion: "Confirm FFT-RHS vs FFT-STSS (both firefighter-telephone-system accessories) -- description-only retrieval currently favors FFT-STSS.", notes: null },
  { sn: 26, description: "Fire Fighter Phone Jack", expectedFamily: null, historicalPartNumber: "FFT-FPJ", historicalPNIsGroundTruth: true, acceptablePartNumbers: ["FFT-FPJ"], expectedFinalState: "RESOLVED", expectedEngineerQuestion: null, notes: null },
];

// S/N 27 "Fire Alarm System Testing & Commissioning" (labor/service line,
// SAR 42,075.00) is intentionally excluded from all product-matching lines
// above -- included only in the pricing integrity cross-check inside
// scripts/regression-opera-block-fas.mjs.
export const OPERA_BLOCK_EXPECTED_BASELINE = Object.freeze({
  groundTruthLines: 26,
  catalogCoverage: "24/26",
  resolvedLines: OPERA_BLOCK_GOLDEN_LINES.filter((l) => l.expectedFinalState === "RESOLVED").length,
  engineerReviewLines: OPERA_BLOCK_GOLDEN_LINES.filter((l) => l.expectedFinalState === "ENGINEER_REVIEW_REQUIRED").length,
  missingEvidenceLines: OPERA_BLOCK_GOLDEN_LINES.filter((l) => l.expectedFinalState === "NO_MATCH_OR_MISSING_EVIDENCE").length,
});
