export const PROJECT_MODULES = Object.freeze({
  Dashboard: "Dashboard",
  Projects: "Projects",
  Overview: "Overview",
  Documents: "Documents",
  "Project Context": "Project Context",
  BOQ: "BOQ",
  Requirements: "Technical Matching",
  Matching: "Technical Matching",
  "Technical Matching": "Technical Matching",
  "Technical Review": "Technical Review",
  Review: "Commercial Review",
  "Commercial Review": "Commercial Review",
  Costing: "Costing",
  Pricing: "Costing",
  "Supplier RFQs": "Supplier RFQs",
  Quotation: "Quotation",
  "Product Library": "Product Library",
  "Knowledge Library": "Knowledge Library",
  "Pricing Memory": "Pricing Memory",
  "Case Studies": "Case Studies",
  Home: "Home",
  Knowledge: "Knowledge Library",
  Administration: "Administration",
  Settings: "Administration",
  "Price Sources": "Price Sources",
  Reports: "Reports",
  Activity: "Activity",
});

export const GLOBAL_WORKSPACES = Object.freeze([
  "Dashboard",
  "Projects",
  "Knowledge Library",
  "Product Library",
  "Reports",
  "Case Studies",
  "Administration",
]);

export function globalWorkspacePresentation(workspace) {
  if (workspace === "Dashboard" || workspace === "Home" || workspace === "Overview") {
    return { topLevelArea: "Dashboard", activeModule: "Overview", showAllProjects: true };
  }
  if (workspace === "Projects") {
    return { topLevelArea: "Projects", activeModule: "Overview", showAllProjects: true };
  }
  if (["Knowledge Library", "Product Library", "Case Studies", "Reports", "Administration"].includes(workspace)) {
    return { topLevelArea: "Dashboard", activeModule: workspace, showAllProjects: false };
  }
  if (workspace === "Pricing Memory") {
    return { topLevelArea: "Dashboard", activeModule: "Knowledge Library", showAllProjects: false };
  }
  return null;
}

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

export function userFacingProjectReference(value) {
  const text = String(value || "").trim();
  return /^project_[0-9a-f-]{20,}$/i.test(text)
    ? "Project reference not assigned"
    : text || "Project reference not assigned";
}

export function userFacingWorkspaceName(workspace) {
  return ({
    "Technical Matching": "Product Selection",
    Costing: "Costing & Pricing",
    "Price Sources": "Supplier Price Evidence",
    "Supplier RFQs": "Supplier Price Evidence",
    Quotation: "Prepare Quotation",
  })[workspace] || workspace;
}

const WORKSPACE_STAGE_IDS = Object.freeze({
  Overview: [],
  Documents: ["intake", "document-intake"],
  "Project Context": ["intake", "document-intake"],
  BOQ: ["extraction", "boq-extraction", "extraction-review"],
  "Technical Review": ["scope", "technical", "technical-review"],
  "Technical Matching": ["requirements", "selection", "requirement-analysis", "product-matching"],
  "Commercial Review": ["costing", "commercial-review", "final-review"],
  Costing: ["supplier", "costing", "pricing"],
  Quotation: ["quotation"],
});

export function workspaceForRoute(route = "Overview") {
  const [name, query = ""] = String(route).split("?");
  if (name === "Review") return new URLSearchParams(query).get("type") === "final" ? "Commercial Review" : "Technical Review";
  return PROJECT_MODULES[name] || "Overview";
}

export function canonicalStepperItems(workflow) {
  const stages = Array.isArray(workflow?.stages) ? workflow.stages : [];
  const userFacingStageNames = {
    requirements: "Requirements",
    selection: "Product Selection",
    "product-matching": "Product Selection",
    supplier: "Supplier Price Evidence",
    pricing: "Costing & Pricing",
    costing: "Costing & Pricing",
    quotation: "Prepare Quotation",
  };
  return [
    { id: "overview", name: "Overview", route: "Overview", workspace: "Overview", status: workflow?.status || "Waiting", progress: workflow?.progress || 0 },
    ...stages.map((stage) => ({ ...stage, name: userFacingStageNames[stage.id] || stage.name, workspace: workspaceForRoute(stage.route) })),
  ];
}

const COMPLETE = new Set(["Completed", "Not Applicable", "Skipped"]);
export function workspaceAvailability(workflow, workspace) {
  if (!workflow) return { state: "WAITING", title: "Workflow status is loading", detail: "Wait for the project status to load.", route: "Overview" };
  const ids = WORKSPACE_STAGE_IDS[workspace] || [];
  const stages = workflow.stages.filter((stage) => ids.includes(stage.id));
  if (!stages.length || workspace === "Overview" || workspace === "Documents") return { state: "READY", title: "Workspace available", detail: "", route: "Overview" };
  const blocked = stages.find((stage) => stage.status === "Blocked");
  const waiting = stages.find((stage) => ["Not Started", "Waiting"].includes(stage.status));
  const target = blocked || waiting;
  if (!target) return { state: stages.every((stage) => COMPLETE.has(stage.status)) ? "COMPLETED" : "READY", title: "Workspace available", detail: "", route: "Overview" };
  const blocker = workflow.blockers.find((entry) => entry.stageId === target.id) || workflow.blockers[0];
  return {
    state: blocked ? "BLOCKED" : "WAITING",
    title: `${target.name} ${blocked ? "is blocked" : "is waiting"}`,
    detail: blocker?.message || target.blockers?.[0] || "Complete the preceding workflow stage before continuing.",
    route: blocker?.route || workflow.nextAction?.route || "Overview",
  };
}

export function aiQuotationAvailability(workflow) {
  const boqItems = Number(workflow?.facts?.boqItems || 0);
  const pricedItems = Number(workflow?.facts?.pricedItems || 0);
  if (!boqItems) return { available: false, reason: "A reviewed BOQ is required before an advisory can be generated.", route: "BOQ" };
  if (!pricedItems) return { available: false, reason: "Approved pricing evidence is required before an advisory can be generated.", route: "Costing" };
  return { available: true, reason: "Reviewed quotation evidence is available.", route: "Quotation" };
}

export function isGoldenProject(project) {
  const explicit = project?.testMode === true || project?.isTestFixture === true || project?.operationalClassification === "Internal Validation" || project?.operationalClassification === "Fixture" || project?.metadata?.testMode === "golden";
  const goldenEnvironment = typeof process !== "undefined" && process.env?.GOLDEN_E2E === "1";
  return !goldenEnvironment && explicit;
}

export function visibleProductProjects(projects, options = {}) {
  if (options.goldenMode === true) return projects;
  return projects.filter((entry) => !isGoldenProject(entry.project || entry));
}

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
