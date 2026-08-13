import assert from "node:assert/strict";
import test from "node:test";
import { deriveProjectDashboard } from "../app/domain/dashboard-workflow-engine.mjs";
import { derivePresalesWorkflow } from "../app/domain/presales-workflow-engine.mjs";
import { quotationActionState } from "../app/components/workspaces/commercial-models.mjs";
import { buildProjectLocation, globalWorkspacePresentation, parseProjectLocation, projectShellModel, reconcileFailedDocumentFilter } from "../app/lib/project-navigation.mjs";

const project = { id: "golden-project", name: "Golden", organizationId: "golden-org", systemDomain: "Fire Alarm" };
const complete = { documents: 2, classified: 2, boqItems: 2, specificationExtractions: 1, requirementProfiles: 2, matchedItems: 2, technicalApproved: 2, pricedItems: 2, commercialApproved: 2, finalReviewApproved: 2 };
const workflow = (facts = {}, projectPatch = {}) => derivePresalesWorkflow({ project: { ...project, ...projectPatch }, facts });

test("project module and selected item survive URL round trip", () => {
  const location = buildProjectLocation(project.id, "Technical Matching", "boq-2");
  assert.deepEqual(parseProjectLocation(location), { projectId: project.id, workspace: "Technical Matching", selectedItemId: "boq-2", selectedScenarioId: "", selectedRevisionId: "" });
});

test("Project Context review survives a project URL round trip", () => {
  const location = buildProjectLocation(project.id, "Project Context");
  assert.equal(parseProjectLocation(location).workspace, "Project Context");
  assert.equal(parseProjectLocation(location).projectId, project.id);
});

test("every global workspace survives URL round trip with matching presentation", () => {
  const expected = {
    Dashboard: { topLevelArea: "Dashboard", activeModule: "Overview", showAllProjects: true },
    Projects: { topLevelArea: "Projects", activeModule: "Overview", showAllProjects: true },
    "Knowledge Library": { topLevelArea: "Dashboard", activeModule: "Knowledge Library", showAllProjects: false },
    "Product Library": { topLevelArea: "Dashboard", activeModule: "Product Library", showAllProjects: false },
    Reports: { topLevelArea: "Dashboard", activeModule: "Reports", showAllProjects: false },
  };
  for (const [workspace, presentation] of Object.entries(expected)) {
    const location = parseProjectLocation(buildProjectLocation("", workspace));
    assert.equal(location.projectId, "");
    assert.equal(location.workspace, workspace);
    assert.deepEqual(globalWorkspacePresentation(location.workspace), presentation);
  }
});

test("unknown global workspace falls back explicitly to the dashboard presentation", () => {
  const location = parseProjectLocation("?workspace=not-a-workspace");
  assert.equal(location.workspace, "Overview");
  assert.deepEqual(globalWorkspacePresentation(location.workspace), {
    topLevelArea: "Dashboard",
    activeModule: "Overview",
    showAllProjects: true,
  });
});

test("dashboard and project shell expose the canonical workflow stage", () => {
  const dashboard = deriveProjectDashboard({ facts: complete, project });
  const canonical = workflow(complete);
  const shell = projectShellModel(dashboard, canonical);
  assert.equal(dashboard.project.workflowStage, canonical.workflowStage);
  assert.equal(shell.stage, canonical.workflowStage);
  assert.equal(shell.quotationReady, canonical.readyForQuotation);
});

test("lifecycle remains separate from operational workflow stage", () => {
  const result = workflow({ documents: 1, classified: 0 });
  assert.equal(result.lifecycleState, "Active");
  assert.equal(result.workflowStage, "Document intake and classification");
  assert.notEqual(result.lifecycleState, result.workflowStage);
});

test("changing a blocker changes canonical workflow and quotation readiness", () => {
  const ready = workflow(complete);
  const blocked = workflow({ ...complete, missingPrices: 1, pricedItems: 1 });
  assert.equal(ready.readyForQuotation, true);
  assert.equal(blocked.readyForQuotation, false);
  assert.equal(blocked.currentStageId, "supplier");
  assert.match(blocked.blockers.map((entry) => entry.message).join(" "), /eligible current prices/);
});

test("quotation actions consume canonical readiness instead of client selection", () => {
  const blocked = quotationActionState(workflow({ ...complete, missingPrices: 1, pricedItems: 1 }), null, false);
  const ready = quotationActionState(workflow(complete), null, false);
  assert.equal(blocked.canDraft, false);
  assert.equal(ready.canDraft, true);
});

test("On Hold suspends the canonical next action without becoming a workflow stage", () => {
  const result = workflow(complete, { manualStatus: "On Hold" });
  assert.equal(result.lifecycleState, "On Hold");
  assert.equal(result.suspended, true);
  assert.equal(result.nextAction, null);
  assert.notEqual(result.workflowStage, "On Hold");
});

test("historical learning cannot advance live workflow", () => {
  const result = workflow({ historicalPrices: 500, historicalProducts: 1000, historicalProjects: 20 });
  assert.equal(result.currentStageId, "intake");
  assert.equal(result.readyForQuotation, false);
  assert.equal(result.facts.pricedItems, 0);
});

test("failed document filter is removed only after canonical refetch reports zero failures", () => {
  const search = "?project=golden-project&workspace=Documents&status=failed";
  assert.equal(reconcileFailedDocumentFilter(search, 2), search);
  assert.equal(reconcileFailedDocumentFilter(search, 0), "?project=golden-project&workspace=Documents");
});
