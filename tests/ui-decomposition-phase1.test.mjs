import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProjectLocation,
  parseProjectLocation,
  projectShellModel,
  workflowPresentation,
} from "../app/lib/project-navigation.mjs";

const goldenWorkflow = {
  lifecycleState: "Active",
  workflowStage: "extraction",
  status: "In Progress",
  progress: 25,
  currentStageId: "extraction-review",
  readyForQuotation: false,
  nextAction: { title: "Review extracted BOQ", route: "BOQ", owner: "Estimator", stageId: "extraction-review" },
  blockers: [{ stageId: "extraction-review", message: "Confirm extracted rows" }],
  warnings: [],
  stages: [
    { id: "document-intake", status: "Completed", progress: 100 },
    { id: "extraction-review", status: "In Progress", progress: 50 },
    { id: "quotation", status: "Locked", progress: 0 },
  ],
};
const goldenDashboard = { project: { status: "In Progress" } };

test("project shell presents canonical workflow without recalculation", () => {
  const model = projectShellModel(goldenDashboard, goldenWorkflow);
  assert.deepEqual(model, {
    lifecycle: "Active",
    stage: "extraction",
    status: "In Progress",
    progress: 25,
    blockers: goldenWorkflow.blockers,
    warnings: [],
    nextAction: goldenWorkflow.nextAction,
    quotationReady: false,
    projectStatus: "In Progress",
  });
});

test("workspace presentation uses explicit stage identity, not tab array position", () => {
  assert.deepEqual(workflowPresentation(goldenWorkflow, "BOQ"), {
    status: "In Progress",
    progress: 50,
  });
  assert.deepEqual(workflowPresentation(goldenWorkflow, "Quotation"), {
    status: "Locked",
    progress: 0,
  });
});

test("project deep links survive refresh and preserve selected item", () => {
  const url = buildProjectLocation("project_golden", "BOQ", "boq_42");
  assert.deepEqual(parseProjectLocation(url), {
    projectId: "project_golden",
    workspace: "BOQ",
    selectedItemId: "boq_42",
    selectedScenarioId: "",
    selectedRevisionId: "",
  });
});

test("legacy module links remain readable during migration", () => {
  assert.equal(
    parseProjectLocation("?project=p1&module=Matching").workspace,
    "Technical Matching",
  );
});

test("unknown deep-link workspaces fail safely to Overview", () => {
  assert.equal(parseProjectLocation("?project=p1&workspace=Invented").workspace, "Overview");
});
