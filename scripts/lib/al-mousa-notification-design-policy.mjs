// AL MOUSA -- NOTIFICATION DESIGN POLICY (HUMAN ENGINEERING DECISION) + POWER SCENARIOS.
//
// WHY THIS FILE EXISTS
// --------------------
// A human engineer has decided that there is NO project-wide default candela
// that represents final compliant design. Final candela is determined by the
// actual protected space under NFPA 72 visual-notification rules.
//
// That decision creates a genuine OBLIGATION on the data model, and the whole
// risk of this slice is encoding the decision as a single `candela` number. If
// the quotation assumption (75 cd) is stored in one field and the design policy
// is stored in another, some downstream consumer will eventually read the wrong
// one and treat a pre-sales assumption as engineering authority. So the two are
// stored as DISTINCT, separately-named fields, and the model refuses to let the
// quotation assumption flow into final design.
//
// THE THREE RPS QUANTITIES ARE ALSO DISTINCT
// ------------------------------------------
//   QUOTATION_BASIS_RPS_QUANTITY      -- priced/estimated basis, 75 cd
//   CONSERVATIVE_CAPACITY_RPS_QUANTITY -- power-capacity basis, highest supported
//   FINAL_DESIGN_RPS_QUANTITY          -- not computable until photometric inputs exist
//
// They are reported side by side and never merged into one "the" RPS number,
// because they answer different questions and are approved by different people.

/**
 * FINAL DESIGN CANDELA POLICY -- the human engineering decision.
 * There is deliberately NO `defaultFinalCandelaCd` field in this object. Its
 * absence is the enforcement: a global design candela cannot be expressed.
 */
export const NOTIFICATION_DESIGN_POLICY = Object.freeze({
  policyId: "FINAL_DESIGN_CANDELA_POLICY",
  designCandelaPolicy: "CANDELA_BY_SPACE_REQUIRED",
  authority: "HUMAN_ENGINEERING_DECISION",
  noGlobalDefaultCandela: true,
  rationale:
    "Final notification appliance candela must be determined by the actual protected space: room dimensions, " +
    "corridor geometry, appliance mounting location, wall vs ceiling mounting, number and spacing of appliances, " +
    "and the applicable NFPA 72 visual-notification rules.",
  explicitlyForbidden: "DEFAULT_FINAL_CANDELA = 75 cd (or any equivalent global design rule)",
  perSpaceDeterminants: Object.freeze([
    "room dimensions", "corridor geometry", "appliance mounting location",
    "wall vs ceiling mounting", "number and spacing of appliances", "NFPA 72 visual-notification rules",
  ]),
});

/**
 * PRE-SALES / QUOTATION ASSUMPTION -- human-approved, and explicitly NOT design
 * authority. This is what the brand/pre-sales policy means by a labelled
 * preliminary assumption, applied to notification candela.
 */
export const QUOTATION_ASSUMPTION = Object.freeze({
  quotationCandelaAssumption: 75,
  quotationCandelaAssumptionAuthority: "HUMAN_ENGINEERING_DECISION",
  quotationCandelaAssumptionStatus: "PRELIMINARY_COMMERCIAL_ASSUMPTION",
  condition: "SUBJECT_TO_FINAL_NFPA72_SPACE_BY_SPACE_SIZING",
  productBasis: "FIELD_SELECTABLE_MULTI_CANDELA_APPLIANCE",
  isFinalDesignAuthority: false,
  isCodeDefault: false,
  notAStatementThat:
    "It is NOT a statement that every device will ultimately operate at 75 cd, NOT a code default, and NOT " +
    "final design authority. It is the price/estimate basis only, valid while room-by-room photometric design " +
    "is unavailable.",
  semanticBoundary:
    "quotationCandelaAssumption may feed commercial estimation and the quotation-basis power case. It may " +
    "NEVER feed finalPhotometricDesignStatus, and it may never be promoted into designCandelaPolicy.",
});

/**
 * CANDELA SCENARIOS for power sizing. The quotation case is NOT the only case:
 * sizing power on the commercial assumption alone would understate the supply
 * whenever the space-by-space design lands on a higher setting.
 */
export const POWER_SIZING_SCENARIO = Object.freeze({
  CASE_Q: "CASE_Q__QUOTATION_BASIS_75CD",
  CASE_C: "CASE_C__CONSERVATIVE_CAPACITY_BASIS",
});

/**
 * The manufacturer's supported indoor candela selections, from the first-party
 * UL maximum current table. 60 cd is ABSENT and must stay absent.
 */
export const SUPPORTED_INDOOR_CANDELA = Object.freeze({
  standardRange: Object.freeze([15, 30, 75, 95, 110, 115]),
  dualSetting: Object.freeze([15]),            // the "15/75" dual-candela option
  highRange: Object.freeze([135, 150, 177, 185]),
  all: Object.freeze([15, 30, 75, 95, 110, 115, 135, 150, 177, 185]),
  notOffered: Object.freeze([60]),
  proposition:
    "Standard Candela Range 15, 15/75, 30, 75, 95, 110, 115; High Candela Range 135, 150, 177, 185. " +
    "SpectrAlert Advance Indoor Wall Horns, Strobes, Horn Strobes data sheet, UL Max. Strobe Current Draw table.",
  selectedApplianceCandelaOptions: "FIELD_SELECTABLE_MULTI_CANDELA_APPLIANCE",
});

/**
 * The 60 cd mismatch. The project specification names a candela set including
 * 60 cd; the selected appliance family does not offer 60 cd. This is recorded as
 * a REQUIREMENT-TO-SETTING MISMATCH, not as a specification error, and it is
 * never silently mapped onto 75 cd or any other setting.
 */
export const PROJECT_60CD_MISMATCH = Object.freeze({
  mismatchId: "PROJECT_REQUIREMENT_TO_PRODUCT_SETTING_MISMATCH",
  state: "OPEN__AWAITING_CONSULTANT_CLARIFICATION",
  requirementSource:
    "Technical Specification 28 46 00 Rev 1 -- the specification names a nominal field-selectable set that " +
    "includes 60 cd (recorded verbatim elsewhere in this project as 'field-selectable 15, 30, 60, 75, 110').",
  productEvidence:
    "The selected System Sensor / Honeywell Farenhyt SpectrAlert Advance family does not offer a 60 cd " +
    "selection in any first-party document inspected. The printed set is 15, 15/75, 30, 75, 95, 110, 115 / " +
    "135, 150, 177, 185.",
  isSpecificationWrong: null,          // NOT determined -- we do not call the spec wrong
  sixtyCdFabricated: false,
  sixtyCdMappedToAnotherSetting: null, // explicitly NOT mapped
  candidateInterpretations: Object.freeze([
    "DESCRIPTIVE_GENERIC_SPECIFICATION_LANGUAGE -- the list enumerates the family's capability generically rather than mandating an exact setting",
    "MANDATORY_EXACT_SETTING_REQUIREMENT -- 60 cd is contractually required and the product cannot satisfy it as written",
    "SATISFIABLE_THROUGH_APPROVED_HIGHER_SETTING -- the consultant accepts a higher supported setting (e.g. 75 cd) as compliant for the affected spaces",
    "REQUIRES_CONSULTANT_CLARIFICATION -- the specification must be corrected or the requirement confirmed",
  ]),
  effectOnPreliminarySizing:
    "NONE_BLOCKING. The requirement is NOT proven contractually exact, so it does not block preliminary sizing. " +
    "Every power case uses only manufacturer-supported settings, and the 60 cd question is carried as an open " +
    "specification action.",
});

/**
 * PHOTOMETRIC DESIGN INPUT READINESS.
 *
 * Assessed by exhaustive search of the governed project package, not assumed.
 */
export const PHOTOMETRIC_INPUT_READINESS = Object.freeze({
  finalPhotometricDesignStatus: "BLOCKED_BY_PHOTOMETRIC_INPUTS",
  photometricDesignInputs: "INSUFFICIENT",
  searched: Object.freeze([
    "architectural plans", "reflected ceiling plans (RCP)", "room dimensions",
    "corridor dimensions", "notification appliance locations", "mounting heights", "wall/ceiling notation",
  ]),
  projectPackageComposition:
    "15 governed documents: 1 BOQ, 14 Fire Alarm / ELV discipline drawings (all prefixed DR), and Technical " +
    "Specification 28 46 00 Rev 1. There is NO architectural drawing of any kind in the package.",
  decisiveEvidence: Object.freeze([
    "The Fire Alarm drawing itself defers corridor device layout to a document that is not supplied: the " +
    "general note on sheet 2401232-PC-AMS-DR-T-00-ZZZ-002 states 'IN THE CORRIDORS TO BE COORDINATED WITH " +
    "ARCHITECT RCP LAYOUT.' The architect's RCP is absent from the package.",
    "No room dimensions, room areas, corridor widths or mounting heights appear on any Fire Alarm sheet. An " +
    "exhaustive pattern search over every ingested drawing asset found zero room-area tokens and zero " +
    "architectural dimension tokens.",
    "The two sheets that could carry other-discipline information (2401232-PC-KGS-DR-T-91-ZZZ-002 and " +
    "2401232-PC-BOS-DR-T-94-ZZZ-001) are registered as documents but have NO ingested drawing assets at all.",
    "The Fire Alarm general note states 'DIMENSIONS ARE NOT TO BE SCALED FROM THIS DRAWING', which forbids " +
    "deriving any dimension from the sheet geometry.",
    "The only mounting notation in the package (RECESSED / CEILING MOUNT / SURFACE MOUNT) is on the " +
    "electrical luminaire and socket schedule 2401232-PC-AMS-DR-E-00-ZZZ-002 and describes DOWNLIGHTS, " +
    "EMERGENCY LUMINAIRES and SOCKET OUTLETS -- not fire alarm notification appliances. Wall vs ceiling " +
    "mounting for the notification appliances therefore remains UNRESOLVED.",
  ]),
  consequence:
    "Room-by-room and corridor candela cannot be derived. Per NFPA 72 the candela depends on the space, so " +
    "no final candela setting is produced for any appliance. The quotation assumption and the conservative " +
    "capacity case are reported instead, as separately-labelled bases.",
  notFabricated:
    "No room dimension, area, corridor width, mounting height or candela-per-space value is invented. " +
    "Straight-line or scaled geometry from the schematic is NOT substituted for architectural data.",
});

/**
 * The three RPS quantities. They are different questions with different
 * approvers and must never be collapsed.
 */
export const RPS_QUANTITY_BASIS = Object.freeze({
  QUOTATION_BASIS_RPS_QUANTITY: Object.freeze({
    basis: "QUOTATION_BASIS_RPS_QUANTITY",
    candelaBasis: "75 cd (human-approved pre-sales assumption)",
    purpose: "commercial estimation / quotation",
    authority: QUOTATION_ASSUMPTION.quotationCandelaAssumptionAuthority,
    isFinalDesign: false,
  }),
  CONSERVATIVE_CAPACITY_RPS_QUANTITY: Object.freeze({
    basis: "CONSERVATIVE_CAPACITY_RPS_QUANTITY",
    candelaBasis: "highest reasonably applicable provisional setting within the appliance/project envelope",
    purpose: "power capacity adequacy",
    authority: "ENGINEERING_CAPACITY_BASIS",
    isFinalDesign: false,
  }),
  FINAL_DESIGN_RPS_QUANTITY: Object.freeze({
    basis: "FINAL_DESIGN_RPS_QUANTITY",
    candelaBasis: "space-by-space per NFPA 72 -- NOT AVAILABLE",
    purpose: "final engineered design",
    authority: null,
    isFinalDesign: true,
    state: "NOT_COMPUTABLE",
    blocking: Object.freeze([
      "space-by-space candela unresolved (PHOTOMETRIC_DESIGN_INPUTS = INSUFFICIENT)",
      "NAC circuit distribution unresolved (drawings state one NAC circuit per panel; no device schedule)",
      "voltage drop unproven (route length absent from every governed sheet)",
    ]),
  }),
});

/**
 * Build one power-sizing scenario. Every candela passed here must be a
 * manufacturer-supported selection; 60 cd is rejected rather than coerced.
 */
export function buildPowerScenario({ id, interiorCandelaCd, interiorVolume, label, purpose }) {
  const all = SUPPORTED_INDOOR_CANDELA.all;
  if (!all.includes(interiorCandelaCd)) {
    return {
      id, label, purpose, state: "REJECTED_UNSUPPORTED_CANDELA",
      interiorCandelaCd,
      reason: interiorCandelaCd === 60
        ? "60 cd is named by the project specification but is NOT a manufacturer-supported selection. It is " +
          "recorded as PROJECT_REQUIREMENT_TO_PRODUCT_SETTING_MISMATCH and is never fabricated or mapped onto " +
          "another setting."
        : `${interiorCandelaCd} cd is not in the manufacturer's supported selectable set (${all.join(", ")}).`,
      supportedAlternatives: all,
    };
  }
  return {
    id, label, purpose, state: "COMPUTABLE",
    interiorCandelaCd,
    interiorVolume: interiorVolume ?? null,
    exteriorCandelaCd: 75,
    exteriorBasis: "spec-fixed 75 cd (Technical Specification 28 46 00 Rev 1, EXTERIOR AV signals)",
    isQuotationAssumption: id === POWER_SIZING_SCENARIO.CASE_Q,
    designAuthority: false,
  };
}

/** The scenario set the brand/pre-sales policy and this decision require. */
export function requiredPowerScenarios() {
  return [
    buildPowerScenario({
      id: POWER_SIZING_SCENARIO.CASE_Q, label: "CASE Q -- quotation basis",
      interiorCandelaCd: QUOTATION_ASSUMPTION.quotationCandelaAssumption,
      interiorVolume: "Temporal High", purpose: "commercial estimation",
    }),
    buildPowerScenario({
      id: POWER_SIZING_SCENARIO.CASE_C, label: "CASE C -- conservative capacity basis",
      interiorCandelaCd: Math.max(...SUPPORTED_INDOOR_CANDELA.standardRange),
      interiorVolume: "Temporal High", purpose: "power capacity adequacy",
    }),
  ];
}

/** Guard: a quotation assumption must never be promoted to design authority. */
export function assertNoDesignPromotion(scenario) {
  if (scenario.isQuotationAssumption && scenario.designAuthority === true) {
    return { ok: false, reason: "QUOTATION_ASSUMPTION_PROMOTED_TO_DESIGN_AUTHORITY" };
  }
  return { ok: true };
}
