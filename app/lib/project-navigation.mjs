export const PROJECT_MODULES = Object.freeze({
  Overview: "Overview",
  Documents: "Documents",
  BOQ: "BOQ",
  Requirements: "Technical Matching",
  Matching: "Technical Matching",
  "Technical Matching": "Technical Matching",
  Review: "Review",
  Costing: "Costing",
  Pricing: "Costing",
  "Supplier RFQs": "Supplier RFQs",
  Quotation: "Quotation",
  "Product Library": "Product Library",
  "Knowledge Library": "Knowledge Library",
  "Pricing Memory": "Pricing Memory",
  "Case Studies": "Case Studies",
  "Price Sources": "Price Sources",
  Reports: "Reports",
  Activity: "Activity",
});

export function parseProjectLocation(search) {
  const query = new URLSearchParams(search);
  const requested = query.get("workspace") || query.get("module") || "Overview";
  return {
    projectId: query.get("project")?.trim() || "",
    workspace: PROJECT_MODULES[requested] || "Overview",
    selectedItemId: query.get("item") || "",
    selectedScenarioId: query.get("scenario") || "",
    selectedRevisionId: query.get("revision") || "",
  };
}

export function buildProjectLocation(projectId, workspace, selectedItemId = "") {
  const query = new URLSearchParams();
  if (projectId) query.set("project", projectId);
  query.set("workspace", workspace);
  if (selectedItemId) query.set("item", selectedItemId);
  return `?${query.toString()}`;
}

const WORKSPACE_STAGE_IDS = Object.freeze({
  Overview: [],
  Documents: ["document-intake"],
  BOQ: ["boq-extraction", "extraction-review"],
  Review: ["technical-review", "requirement-analysis"],
  "Technical Matching": ["product-matching"],
  Costing: ["pricing", "commercial-review"],
  Quotation: ["quotation"],
});

export function workflowPresentation(workflow, workspace) {
  if (!workflow) return { status: "Loading", progress: 0 };
  if (workspace === "Overview") {
    return { status: workflow.status, progress: workflow.progress };
  }
  const ids = WORKSPACE_STAGE_IDS[workspace] || [];
  const stages = workflow.stages.filter((stage) => ids.includes(stage.id));
  if (!stages.length) return { status: "Waiting", progress: 0 };
  const active = stages.find((stage) => stage.id === workflow.currentStageId);
  const stage = active || stages.at(-1);
  return { status: stage.status, progress: stage.progress };
}

export function projectShellModel(dashboard, workflow) {
  if (!dashboard || !workflow) return null;
  return Object.freeze({
    lifecycle: workflow.lifecycleState,
    stage: workflow.workflowStage,
    status: workflow.status,
    progress: workflow.progress,
    blockers: workflow.blockers,
    warnings: workflow.warnings,
    nextAction: workflow.nextAction,
    quotationReady: workflow.readyForQuotation,
    projectStatus: dashboard.project.status,
  });
}

export function reconcileFailedDocumentFilter(search, failedJobs) {
  const query = new URLSearchParams(search);
  if (Number(failedJobs || 0) === 0 && query.get("status") === "failed") {
    query.delete("status");
  }
  const value = query.toString();
  return value ? `?${value}` : "";
}
