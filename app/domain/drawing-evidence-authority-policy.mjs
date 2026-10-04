// DRAWING INTELLIGENCE GOVERNANCE -- field-level evidence authority + the
// engineer-approved 5-status model (AI_Pre_Sales_Drawing_Interpretation_
// Rules.docx, Sections A and E).
//
// This is a DIFFERENT question from drawing-authority-policy.mjs's
// evaluateDrawingAuthority(), which answers "how much do we trust this
// DRAWING VERSION as a whole" (its revision/issue status). This module
// answers "for THIS SPECIFIC KIND OF FACT (device placement, quantity,
// connectivity, cable type, ...), is THIS SOURCE the right authority to
// have produced it, and does the evidence clear the hard-review bar" --
// Rule A's per-field authority table, never a single global "most
// authoritative drawing" answer. The two modules compose: a caller may pass
// evaluateDrawingAuthority()'s output in as this module's revisionState.
//
// Pure domain logic: no DOM, no fetch, no DB. Conservative by default -- an
// unrecognized field/source/drawing type, a missing legend, a non-explicit
// (inferred) value, or any hard-review trigger all route to Needs Review,
// never to Verified. Confidence score is never an input to this module on
// purpose: Rule E is explicit that a confidence percentage alone is not
// sufficient approval authority.

export const FIELD_TYPES = Object.freeze([
  "DevicePlacement",
  "DeviceQuantity",
  "SystemConnectivity",
  "CableTypeSize",
  "LoopCircuitAssignment",
  "DeviceIdentity",
  "MountingInstallation",
  "PanelIO",
  "FunctionalOperation",
  "SymbolsAbbreviations",
  "TechnicalRequirements",
  "CommercialQuantity",
]);

export const GOVERNED_STATUSES = Object.freeze(["Verified", "Verified with Assumption", "Needs Review", "Conflict", "Not Found"]);

// Rule E's named hard-review cases (AI_Pre_Sales_Drawing_Interpretation_
// Rules.docx Section 5 / the task's Section E list) as a closed vocabulary
// callers select from -- this module does not infer these situations
// itself (it has no access to the semantic content that would let it), it
// only ever turns a caller-asserted trigger into a forced Needs Review
// status and a human-readable reason.
export const HARD_REVIEW_TRIGGERS = Object.freeze([
  "BOQ_DRAWING_CONFLICT",
  "QUANTITY_DISAGREEMENT_ACROSS_DRAWINGS",
  "LAYOUT_ONLY_CONNECTIVITY",
  "ALIAS_MERGE_WITHOUT_MATCH",
  "MISSING_OR_AMBIGUOUS_LEGEND",
  "DUPLICATE_EQUIPMENT_TAGS",
  "OCR_UNCERTAINTY",
  "MIXED_REVISIONS",
  "CROSSING_LINES_NO_JUNCTION",
  "INFERRED_SCOPE_BOUNDARY",
  "AFFECTS_PRODUCT_SELECTION_LICENSE_CAPACITY",
  "LIFE_SAFETY_OR_CODE_COMPLIANCE",
  "AFFECTS_PRICE",
  "RFI_REQUIRED_DISCREPANCY",
  "TYPICAL_DETAIL_AS_QUANTITY",
  "SOO_SCHEMATIC_CONFLICT",
]);

const HARD_REVIEW_REASON_TEXT = {
  BOQ_DRAWING_CONFLICT: "Conflict between BOQ and drawing evidence",
  QUANTITY_DISAGREEMENT_ACROSS_DRAWINGS: "Quantity disagrees across more than one drawing",
  LAYOUT_ONLY_CONNECTIVITY: "Connectivity is inferred from layout geometry alone, without legend/tag/riser corroboration",
  ALIAS_MERGE_WITHOUT_MATCH: "Equipment alias merge proposed without a matching tag/location",
  MISSING_OR_AMBIGUOUS_LEGEND: "Applicable legend is missing or ambiguous",
  DUPLICATE_EQUIPMENT_TAGS: "Duplicate equipment tag detected",
  OCR_UNCERTAINTY: "OCR/text extraction uncertainty",
  MIXED_REVISIONS: "Evidence spans mixed or non-latest-valid revisions",
  CROSSING_LINES_NO_JUNCTION: "Crossing lines with no junction evidence",
  INFERRED_SCOPE_BOUNDARY: "Scope boundary is inferred, not explicit",
  AFFECTS_PRODUCT_SELECTION_LICENSE_CAPACITY: "Affects product selection, license, or panel capacity",
  LIFE_SAFETY_OR_CODE_COMPLIANCE: "Touches life safety, cause & effect, or code compliance",
  AFFECTS_PRICE: "Can affect price by addition or deletion",
  RFI_REQUIRED_DISCREPANCY: "Discrepancy requires an RFI",
  TYPICAL_DETAIL_AS_QUANTITY: "A typical/detail drawing is being used to imply actual quantity without explicit reference",
  SOO_SCHEMATIC_CONFLICT: "Conflict between Sequence of Operation and schematic/I/O schedule",
};

// Rule A's field -> primary/verification source table. drawingType values
// are drawn from the SAME governed vocabulary drawing-intake-engine.mjs
// already classifies sheets into (DRAWING_CLASSIFICATIONS) -- this table
// does not invent a second drawing-type vocabulary. Non-drawing sources
// (Specification, BOQ) are matched via sourceType instead of drawingType.
const FIELD_AUTHORITY_TABLE = {
  DevicePlacement: { primary: ["Floor Plan", "Device Layout"], verification: ["Installation Detail", "Typical Detail"] },
  DeviceQuantity: {
    primary: [],
    verification: ["Floor Plan", "Device Layout", "Schedule"],
    projectTypeOverride: {
      TENDER: { primarySourceType: "BOQ" },
      ON_HAND: { primary: ["Floor Plan", "Device Layout"] },
    },
  },
  SystemConnectivity: {
    primary: ["Riser Diagram", "Single Line Diagram (SLD)", "Wiring Diagram"],
    verification: ["Floor Plan", "Device Layout"],
    verificationRequiresCorroboration: true,
  },
  CableTypeSize: { primary: ["Schedule", "Wiring Diagram", "Notes Sheet"], verification: [], verificationSourceType: "Specification" },
  LoopCircuitAssignment: { primary: ["Riser Diagram", "Single Line Diagram (SLD)"], verification: ["Schedule"] },
  DeviceIdentity: { primary: ["Schedule"], verification: ["Floor Plan", "Device Layout"] },
  MountingInstallation: { primary: ["Typical Detail", "Installation Detail"], verification: [], verificationSourceType: "Specification" },
  PanelIO: { primary: ["Schedule"], verification: ["Sequence of Operation"] },
  FunctionalOperation: { primary: ["Sequence of Operation"], verification: ["Wiring Diagram", "Single Line Diagram (SLD)", "Schedule"] },
  SymbolsAbbreviations: { primary: ["Legend Sheet"], verification: ["Legend Sheet"] },
  TechnicalRequirements: { primary: [], verification: ["Notes Sheet", "Typical Detail", "Installation Detail"], primarySourceType: "Specification" },
  CommercialQuantity: {
    primary: [],
    verification: ["Floor Plan", "Device Layout", "Schedule"],
    primarySourceType: "BOQ",
    verificationIsDiscrepancyOnly: true,
  },
};

const resolveAuthorityRole = (rules, { drawingType, sourceType, projectType }) => {
  let role = "Unsupported";
  if (sourceType === "Drawing" && drawingType) {
    if ((rules.primary || []).includes(drawingType)) role = "Primary";
    else if ((rules.verification || []).includes(drawingType)) role = "Verification";
  } else if (sourceType && rules.primarySourceType && sourceType === rules.primarySourceType) {
    role = "Primary";
  } else if (sourceType && rules.verificationSourceType && sourceType === rules.verificationSourceType) {
    role = "Verification";
  }
  const override = projectType ? rules.projectTypeOverride?.[projectType] : null;
  if (override) {
    if (override.primarySourceType && sourceType === override.primarySourceType) role = "Primary";
    if (override.primary && drawingType && override.primary.includes(drawingType)) role = "Primary";
  }
  return role;
};

// evaluateDrawingEvidenceAuthority -- the task's requested conceptual API,
// implemented against this codebase's real conventions rather than
// speculative ones. Every argument is optional except fieldType; omitted
// evidence is treated conservatively (as absent), never assumed favorable.
export const evaluateDrawingEvidenceAuthority = ({
  fieldType,
  drawingType = null,
  sourceType = "Drawing",
  projectType = null,
  revisionState = null, // e.g. the output of drawing-authority-policy.mjs's evaluateDrawingAuthority(), or { isLatestValid }
  applicableLegend = null, // { defined, sheetSpecific, revisionCompatible } | null
  corroboratingEvidence = [],
  conflicts = [],
  hardReviewTriggers = [],
  explicit = true,
  notFound = false,
  assumption = null,
} = {}) => {
  const provenanceRequirements = ["drawingNumber", "revision", "sheetNumber", "page", "source"];

  if (notFound) {
    return { authorityRole: "Unsupported", approvalEligibility: false, hardReviewReasons: ["Required information not found"], finalStatus: "Not Found", provenanceRequirements };
  }

  const rules = FIELD_AUTHORITY_TABLE[fieldType];
  if (!rules) {
    return {
      authorityRole: "Unsupported",
      approvalEligibility: false,
      hardReviewReasons: [`Unrecognized field type "${fieldType}"`],
      finalStatus: "Needs Review",
      provenanceRequirements,
    };
  }

  if (conflicts.length > 0) {
    return {
      authorityRole: resolveAuthorityRole(rules, { drawingType, sourceType, projectType }),
      approvalEligibility: false,
      hardReviewReasons: conflicts.map((conflict) => `Conflict: ${conflict}`),
      finalStatus: "Conflict",
      provenanceRequirements,
    };
  }

  const authorityRole = resolveAuthorityRole(rules, { drawingType, sourceType, projectType });
  const triggers = new Set(hardReviewTriggers.filter((trigger) => HARD_REVIEW_TRIGGERS.includes(trigger)));
  const reasons = [];

  if (authorityRole === "Unsupported") {
    reasons.push(`${drawingType || sourceType || "This source"} is not a recognized Primary or Verification source for ${fieldType}`);
  }
  if (rules.verificationRequiresCorroboration && authorityRole === "Verification" && corroboratingEvidence.length === 0) {
    triggers.add("LAYOUT_ONLY_CONNECTIVITY");
  }
  if (rules.verificationIsDiscrepancyOnly && authorityRole === "Verification") {
    reasons.push(`${drawingType || sourceType} count is discrepancy evidence only, not authoritative for ${fieldType}`);
  }
  if (!explicit) {
    reasons.push("Value is inferred, not explicitly stated in the source");
  }
  if (applicableLegend && applicableLegend.defined === false) triggers.add("MISSING_OR_AMBIGUOUS_LEGEND");
  if (applicableLegend && applicableLegend.revisionCompatible === false) triggers.add("MIXED_REVISIONS");
  if (revisionState && revisionState.isLatestValid === false) triggers.add("MIXED_REVISIONS");

  for (const trigger of triggers) reasons.push(HARD_REVIEW_REASON_TEXT[trigger] || trigger);
  if (assumption) reasons.push(`Assumption: ${assumption}`);

  // The decision ladder is deliberately linear and each rung is a hard
  // stop -- no combination of favorable signals below a rung can promote
  // past a blocking one above it (Rule E's own framing: hard rules
  // "override any high score").
  let finalStatus;
  if (authorityRole === "Unsupported" || triggers.size > 0 || !explicit) {
    finalStatus = "Needs Review";
  } else if (authorityRole === "Primary") {
    finalStatus = assumption ? "Verified with Assumption" : "Verified";
  } else if (authorityRole === "Verification" && assumption) {
    finalStatus = "Verified with Assumption";
  } else {
    finalStatus = "Needs Review";
  }

  return {
    authorityRole,
    approvalEligibility: finalStatus === "Verified" || finalStatus === "Verified with Assumption",
    hardReviewReasons: reasons,
    finalStatus,
    provenanceRequirements,
  };
};
