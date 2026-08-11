export const ENGINEERING_REQUIREMENT_CLASSES = Object.freeze({
  SYSTEM: "System architecture",
  AUTHORITY: "Authority approval",
  STANDARD: "Codes and standards",
  CAPACITY: "Capacity calculation",
  CALCULATION: "Engineering calculation",
  COMMERCIAL_TECHNICAL: "Technical warranty",
});

const FIRE_ALARM_REQUIREMENT_POLICY = Object.freeze({
  r1: { classification: ENGINEERING_REQUIREMENT_CLASSES.SYSTEM, evidenceKind: "Manufacturer system architecture and selected-product schedule", deliverable: "Approved system architecture" },
  r2: { classification: ENGINEERING_REQUIREMENT_CLASSES.AUTHORITY, evidenceKind: "Current Saudi Civil Defense approval naming manufacturer and model", deliverable: "Authority approval register" },
  r3: { classification: ENGINEERING_REQUIREMENT_CLASSES.STANDARD, evidenceKind: "Model-level UL/EN54 certificate schedule and applicable standard parts", deliverable: "Codes and certification matrix" },
  r4: { classification: ENGINEERING_REQUIREMENT_CLASSES.CAPACITY, evidenceKind: "Project network topology and manufacturer capacity evidence", deliverable: "Network and node calculation" },
  r5: { classification: ENGINEERING_REQUIREMENT_CLASSES.CALCULATION, evidenceKind: "Project battery calculation with loads, duration, derating and 20% margin", deliverable: "Signed battery calculation" },
  r6: { classification: ENGINEERING_REQUIREMENT_CLASSES.COMMERCIAL_TECHNICAL, evidenceKind: "Supplier or manufacturer warranty commitment tied to offered models", deliverable: "Warranty compliance record" },
});

const meaningful = (value) => typeof value === "string" && value.trim().length >= 3;

export const requirementPolicyFor = (requirementId) => FIRE_ALARM_REQUIREMENT_POLICY[requirementId] || {
  classification: "Unclassified requirement",
  evidenceKind: "Source-linked technical evidence",
  deliverable: "Reviewed compliance record",
};

export const assessEngineeringRequirement = (requirement) => {
  const policy = requirementPolicyFor(requirement?.id);
  const evidencePresent = meaningful(requirement?.evidence);
  const reviewerNotePresent = meaningful(requirement?.reviewerNote);
  const humanDecisionPresent = meaningful(requirement?.reviewedBy) && meaningful(requirement?.reviewedAt);
  const compliant = requirement?.status === "Compliant";
  const deviation = requirement?.status === "Deviation";
  const passed = compliant && evidencePresent && reviewerNotePresent && humanDecisionPresent;
  const reasons = [];

  if (requirement?.status === "Review") reasons.push("Engineering decision pending");
  if (deviation) reasons.push("Technical deviation requires resolution or formal qualification");
  if (!evidencePresent) reasons.push(`Missing ${policy.evidenceKind.toLowerCase()}`);
  if (!reviewerNotePresent) reasons.push("Reviewer rationale missing");
  if (!humanDecisionPresent) reasons.push("Named reviewer and decision time missing");

  return { ...policy, passed, hardBlocker: !passed, reasons };
};

export const buildEngineeringDossier = ({ technicalProfileLoaded, requirements = [], drawingCount = 0, boqLineCount = 0 }) => {
  const assessments = requirements.map((requirement) => ({ requirement, ...assessEngineeringRequirement(requirement) }));
  const passed = assessments.filter((assessment) => assessment.passed).length;
  const deviations = requirements.filter((requirement) => requirement.status === "Deviation").length;
  const open = assessments.length - passed;
  const blockers = [];

  if (!technicalProfileLoaded) blockers.push("No controlled technical requirement baseline");
  if (!requirements.length) blockers.push("No atomic requirements available for review");
  if (drawingCount < 1) blockers.push("No drawing package available for engineering reconciliation");
  if (boqLineCount < 1) blockers.push("No reviewed BOQ scope available");
  if (open) blockers.push(`${open} requirement${open === 1 ? "" : "s"} lack a complete compliant evidence decision`);

  return {
    assessments,
    totals: { requirements: requirements.length, passed, open, deviations },
    sourceBaseline: technicalProfileLoaded && drawingCount > 0 && boqLineCount > 0,
    approvalReady: blockers.length === 0,
    blockers,
    sections: [
      { id: "basis", label: "Design basis", status: technicalProfileLoaded ? "Established" : "Missing" },
      { id: "compliance", label: "Compliance matrix", status: open ? `${open} open` : requirements.length ? "Complete" : "Missing" },
      { id: "drawings", label: "Drawing reconciliation", status: drawingCount ? "Source present · takeoff verification pending" : "Missing" },
      { id: "scope", label: "BOQ reconciliation", status: boqLineCount ? `${boqLineCount} reviewed lines` : "Missing" },
      { id: "calculations", label: "Engineering calculations", status: assessments.some((assessment) => assessment.classification === ENGINEERING_REQUIREMENT_CLASSES.CALCULATION && assessment.passed) ? "Evidence accepted" : "Open" },
    ],
  };
};
