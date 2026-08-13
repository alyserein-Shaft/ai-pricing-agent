export const VISIBLE_PROJECT_PHASES = Object.freeze([
  { id: "set-up", label: "Set up", stageIds: ["setup"], workspace: "Overview" },
  { id: "understand-tender", label: "Understand tender", stageIds: ["upload", "classification", "intake", "extraction", "boq", "specification"], workspace: "Documents" },
  { id: "confirm-scope", label: "Confirm scope", stageIds: ["scope", "requirements", "technical"], workspace: "Technical Review" },
  { id: "select-products", label: "Select products", stageIds: ["selection", "matching"], workspace: "Technical Matching" },
  { id: "build-price", label: "Build price", stageIds: ["supplier", "costing", "pricing"], workspace: "Costing" },
  { id: "review-offer", label: "Review offer", stageIds: ["commercial", "quotation", "readiness"], workspace: "Quotation" },
  { id: "issue-quotation", label: "Issue quotation", stageIds: ["issue", "export"], workspace: "Quotation" },
]);

const COMPLETE = new Set(["Completed", "Not Applicable", "Skipped"]);
const BLOCKED = new Set(["Blocked", "Failed"]);
const ATTENTION = new Set(["Needs Review", "Completed with Warnings"]);
const ACTIVE = new Set(["Ready", "Queued", "In Progress"]);

export function visiblePhaseState(stages) {
  if (!stages.length || stages.every((stage) => ["Not Started", "Waiting"].includes(stage.status))) return "Not started";
  if (stages.some((stage) => BLOCKED.has(stage.status))) return "Blocked";
  if (stages.some((stage) => ATTENTION.has(stage.status))) return "Needs attention";
  if (stages.every((stage) => COMPLETE.has(stage.status))) return "Complete";
  if (stages.some((stage) => ACTIVE.has(stage.status)) || stages.some((stage) => COMPLETE.has(stage.status))) return "In progress";
  return "Not started";
}

export function visibleProjectPhases(workflow) {
  const stages = Array.isArray(workflow?.stages) ? workflow.stages : [];
  return VISIBLE_PROJECT_PHASES.map((phase) => {
    const members = stages.filter((stage) => phase.stageIds.includes(stage.id));
    return {
      ...phase,
      state: visiblePhaseState(members),
      progress: members.length ? Math.round(members.reduce((sum, stage) => sum + Number(stage.progress || 0), 0) / members.length) : 0,
      current: members.some((stage) => stage.id === workflow?.currentStageId),
    };
  });
}

export function currentVisiblePhase(workflow) {
  const phases = visibleProjectPhases(workflow);
  return phases.find((phase) => phase.current) || phases.find((phase) => phase.state !== "Complete") || phases.at(-1);
}
