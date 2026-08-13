import { derivePresalesWorkflow, PRESALES_WORKFLOW_VERSION } from "./presales-workflow-engine.mjs";

export const DASHBOARD_MODEL_VERSION = `dashboard-read-model:${PRESALES_WORKFLOW_VERSION}`;

export const PROJECT_STATUSES = ["Draft", "Documents Pending", "Documents Processing", "Extraction Review", "Technical Requirements Review", "Matching in Progress", "Technical Review", "Pricing in Progress", "Commercial Review", "Clarifications Pending", "Supplier Pricing Pending", "Ready for Quotation", "Quotation Draft", "Submitted", "Won", "Lost", "On Hold", "Archived", "Cancelled"];
export const STAGE_STATUSES = ["Not Started", "Ready", "Queued", "In Progress", "Completed", "Completed with Warnings", "Needs Review", "Blocked", "Failed", "Skipped", "Not Applicable"];
export const TERMINAL_MANUAL_STATUSES = new Set(["Won", "Lost", "On Hold", "Archived", "Cancelled"]);
export const ACTIVE_PROCESSING = new Set(["Queued", "Processing", "Retrying", "In Progress"]);
export const CLOSED_REVIEWS = new Set(["Approved", "Rejected", "Superseded", "Cancelled"]);

export const WORKFLOW_STAGES = [
  ["setup", "Project Setup", 5, "Overview"], ["upload", "Document Upload", 10, "Documents"],
  ["classification", "Document Classification", 5, "Documents?status=needs-review"], ["boq", "BOQ Extraction", 10, "BOQ"],
  ["specification", "Specification Extraction", 10, "Requirements"], ["requirements", "Requirement Analysis", 10, "Requirements?status=needs-review"],
  ["matching", "Product Matching", 15, "Matching"], ["technical", "Technical Review", 10, "Review?type=technical&status=open"],
  ["pricing", "Pricing and Costing", 10, "Costing?status=missing-price"], ["commercial", "Commercial Review", 10, "Review?type=commercial&status=open"],
  ["export", "Export", 3, "Reports"], ["readiness", "Quotation Readiness", 2, "Overview?panel=readiness"],
].map(([id, name, weight, route]) => ({ id, name, weight: Number(weight), route, owner: id === "technical" ? "Technical Reviewer" : id === "commercial" ? "Commercial Reviewer" : id === "pricing" ? "Estimator / Commercial Reviewer" : "Estimator" }));

export const METRIC_REGISTRY = [
  ["active_projects", "Active Projects", "organization", "projects", "Non-archived, non-cancelled projects", "/projects?status=active", "Management"],
  ["projects_due_soon", "Projects Due Soon", "organization", "projects.due_date", "Active projects due within seven days", "/projects?due=soon", "Management"],
  ["projects_overdue", "Projects Overdue", "organization", "projects.due_date", "Active projects past due", "/projects?due=overdue", "Management"],
  ["projects_blocked", "Projects Blocked", "organization", "project_risks", "Projects with open critical blockers", "/projects?risk=blocked", "Management"],
  ["documents_processing", "Documents Processing", "both", "document_processing_runs", "Latest current-version runs in an active state", "Documents?status=processing", "Estimator"],
  ["failed_processing_jobs", "Failed Processing Jobs", "both", "document_processing_runs", "Latest current-version runs with Failed status", "Documents?status=failed", "Estimator"],
  ["boq_items", "BOQ Items", "project", "boq_items", "Current non-superseded Item rows", "BOQ", "Estimator"],
  ["review_required", "Review Required", "both", "review_queue_items", "Current non-deleted reviews not in a closed state", "Review?status=open", "Review Lead"],
  ["missing_prices", "Missing Prices", "both", "pricing_lines", "Current BOQ items without an eligible current pricing line", "Costing?status=missing-price", "Estimator"],
  ["ready_for_quotation", "Ready for Quotation", "both", "derived workflow gates", "Projects with every required technical, commercial, safety and export gate passed", "Overview?panel=readiness", "Commercial Reviewer"],
  ["estimated_cost", "Estimated Cost", "both", "pricing_runs", "Sum of current completed pricing-run total cost", "Costing", "Commercial Reviewer"],
  ["quoted_value", "Quoted Value", "both", "pricing_runs", "Sum of current completed pricing-run net selling value", "Costing", "Commercial Reviewer"],
].map(([id, name, scope, source, formula, route, owner]) => ({ id, name, description: formula, scope, source, formula, filters: "Current, authorized records only", exclusions: "Deleted, superseded and archived records where applicable", refresh: "On navigation and 15-second polling while processing", permission: owner === "Commercial Reviewer" ? "commercial.read" : "project.read", route, owner, version: DASHBOARD_MODEL_VERSION }));

export const deriveWorkflow = (facts, project = {}) => {
  const canonical = derivePresalesWorkflow({ project: { id: project.id || "dashboard-project", name: project.name || "Project", organizationId: project.organizationId || "organization", systemDomain: project.systemDomain || "Unspecified", manualStatus: project.manualStatus, archivedAt: project.archivedAt }, facts });
  return { ...canonical, version: canonical.modelVersion, ready: canonical.readyForQuotation, stages: canonical.stages.map((item) => ({ ...item, blockingIssues: item.blockers.length, warningCount: item.warnings.length, nextAction: item.action })) };
};

export const generateActions = (facts, workflow, project = {}) => {
  const actions = [];
  const add = (type, priority, severity, title, description, route, role, blocking = false, entity = null) => actions.push({ id: `${project.id || "project"}:${type}:${entity || "summary"}`, projectId: project.id, projectName: project.name, entity, type, priority, severity, title, description, reason: description, owner: role, requiredRole: role, dueDate: project.dueDate || null, blocking, route, createdAt: project.updatedAt || null, updatedAt: project.updatedAt || null });
  if (!facts.documents) add("upload-documents", 100, "Critical", "Upload required project documents", "No current tender documents are available.", "Documents?action=upload", "Estimator", true);
  if (facts.failedJobs) add("retry-processing", 98, "Critical", `Review ${facts.failedJobs} failed document job${facts.failedJobs === 1 ? "" : "s"}`, "Processing failed and downstream records may be incomplete. Retry is available on each failed document after reviewing its error.", "Documents?status=failed", "Estimator", true);
  if (facts.documents > facts.classified) add("classify-documents", 90, "High", `Classify ${facts.documents - facts.classified} document${facts.documents - facts.classified === 1 ? "" : "s"}`, "Unknown document types cannot enter the correct extraction route.", "Documents?status=needs-review", "Estimator", true);
  if (facts.extractionReview) add("review-extraction", 88, "High", `Review ${facts.extractionReview} extraction issue${facts.extractionReview === 1 ? "" : "s"}`, "Extracted BOQ evidence requires confirmation.", "BOQ?status=needs-review", "Estimator", true);
  if (facts.requirementReview) add("review-requirements", 84, "High", `Resolve ${facts.requirementReview} requirement profile${facts.requirementReview === 1 ? "" : "s"}`, "Technical requirements remain incomplete or ambiguous.", "Requirements?status=needs-review", "Technical Reviewer", true);
  if (facts.openSafetyBlocks) add("resolve-safety", 99, "Critical", `Resolve ${facts.openSafetyBlocks} technical safety block${facts.openSafetyBlocks === 1 ? "" : "s"}`, "A technical conflict prevents approval and quotation readiness.", "Review?type=technical&status=blocked", "Technical Reviewer", true);
  if (facts.technicalPending) add("technical-approval", 80, "High", `Review ${facts.technicalPending} pending technical approval${facts.technicalPending === 1 ? "" : "s"}`, "Matched items require an authorized technical decision.", "Review?type=technical&status=open", "Technical Reviewer", true);
  if (facts.technicalApproved > facts.pricedItems) add("missing-price", 78, "High", `Add prices for ${facts.technicalApproved - facts.pricedItems} technically approved item${facts.technicalApproved - facts.pricedItems === 1 ? "" : "s"}`, "Technically eligible items do not have current approved price evidence.", "Costing?status=missing-price", "Estimator", true);
  if (facts.blockingClarifications) add("clarification", 96, "Critical", `Resolve ${facts.blockingClarifications} blocking clarification${facts.blockingClarifications === 1 ? "" : "s"}`, "A required external or internal response is outstanding.", "Review?status=clarification&blocking=true", "Estimator", true);
  if (facts.commercialPending) add("commercial-approval", 74, "High", `Complete ${facts.commercialPending} commercial approval${facts.commercialPending === 1 ? "" : "s"}`, "Pricing exists but is not commercially approved.", "Review?type=commercial&status=open", "Commercial Reviewer", true);
  if (workflow.ready && !facts.exportsCompleted) add("generate-export", 60, "Medium", "Generate the governed cost sheet", "All required quotation-readiness gates have passed.", "Reports?action=export&mode=approved", "Commercial Reviewer");
  if (facts.exportFailures) add("resolve-export", 82, "High", `Resolve ${facts.exportFailures} failed export${facts.exportFailures === 1 ? "" : "s"}`, "A requested workbook did not complete.", "Reports?status=failed", "Commercial Reviewer", true);
  return actions.sort((a, b) => b.priority - a.priority || String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")));
};

export const calculateRisks = (facts, workflow, project = {}, now = new Date()) => {
  const risks = []; const due = project.dueDate ? Math.ceil((new Date(`${project.dueDate}T00:00:00Z`) - now) / 86400000) : null;
  const add = (type, severity, trigger, impact, route, owner) => risks.push({ id: `${project.id || "project"}:${type}`, type, severity, trigger, impact, module: route.split("?")[0], recommendedAction: route, owner, dueDate: project.dueDate || null, source: "Task 15 verified workflow facts" });
  if (due != null && due < 0) add("Deadline", "Critical", `${Math.abs(due)} day(s) overdue`, "Tender response may miss its submission date.", "Overview?panel=deadline", "Project Owner");
  else if (due != null && due <= 7 && workflow.progress < 80) add("Deadline", "High", `${due} day(s) remaining at ${workflow.progress}% progress`, "Required workflow may not complete before submission.", "Overview?panel=workflow", "Project Owner");
  if (facts.failedJobs) add("Processing", "High", `${facts.failedJobs} failed processing job(s)`, "Document evidence and downstream counts may be incomplete.", "Documents?status=failed", "Estimator");
  if (facts.openSafetyBlocks) add("Technical conflict", "Critical", `${facts.openSafetyBlocks} open safety block(s)`, "Unsafe or unsupported selection cannot be approved.", "Review?type=technical&status=blocked", "Technical Reviewer");
  if (facts.technicalApproved > facts.pricedItems) add("Pricing coverage", "Medium", `${facts.technicalApproved - facts.pricedItems} technically approved item(s) missing eligible price`, "Cost and quotation values are incomplete.", "Costing?status=missing-price", "Estimator");
  if (facts.blockingClarifications) add("Clarification", "High", `${facts.blockingClarifications} blocking clarification(s)`, "Dependent technical or commercial decisions are paused.", "Review?status=clarification&blocking=true", "Project Owner");
  return risks;
};

export const deriveProjectDashboard = ({ facts, project, role = "Estimator", totals = {}, updatedAt = new Date().toISOString() }) => {
  const workflow = deriveWorkflow(facts, project), actions = workflow.terminal || workflow.suspended ? [] : generateActions(facts, workflow, project), risks = calculateRisks(facts, workflow, project);
  const status = workflow.lifecycleState;
  const commercialVisible = ["Commercial Reviewer", "Management", "Administrator", "Project Manager"].includes(role);
  return { modelVersion: DASHBOARD_MODEL_VERSION, project: { ...project, status, lifecycleState: workflow.lifecycleState, workflowStage: workflow.workflowStage }, workflow, nextAction: workflow.nextAction ? { id: `${project.id}:canonical-next-action`, projectId: project.id, projectName: project.name, type: "canonical-next-action", priority: 100, severity: workflow.blockers.length ? "High" : "Medium", title: workflow.nextAction.title, description: workflow.blockers.find((item) => item.stageId === workflow.currentStageId)?.message || "Continue the governed pre-sales workflow.", reason: workflow.blockers.find((item) => item.stageId === workflow.currentStageId)?.message || "Continue the governed pre-sales workflow.", owner: workflow.nextAction.owner, requiredRole: workflow.nextAction.owner, blocking: workflow.blockers.some((item) => item.stageId === workflow.currentStageId), route: workflow.nextAction.route } : null, actions, risks, facts, totals: commercialVisible ? totals : undefined, commercialRestricted: !commercialVisible, updatedAt, refreshAfterMs: facts.processing ? 5000 : 15000 };
};
