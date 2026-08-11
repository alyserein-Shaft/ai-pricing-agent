import test from "node:test";
import assert from "node:assert/strict";
import { commandThenRefresh } from "../app/lib/api-client.ts";
import { buildProjectLocation, parseProjectLocation, projectShellModel } from "../app/lib/project-navigation.mjs";
import { matchingCandidateModel, selectionAfterProjectChange, technicalRequirementModel, validSelectedItem } from "../app/components/workspaces/technical-matching-models.mjs";

const pendingRequirement = { id: "req_1", review_status: "Needs Review", approved_for_downstream: 0, confidence: 74, confidence_state: "Medium", original_text: "Provide compatible addressable devices", source_location: { pageFrom: 12, clause: "2.4" }, current_values: {}, };
const discoveryCandidate = { id: "candidate_1", recommendation_tier: "Discovery Only", technical_status: "Discovery Only", confidence_state: "Discovery Only" };
const blockedSafety = { technical_eligibility: "Ineligible", blocks: [{ id: "b1" }], warnings: [] };

test("Technical Requirements presents the persisted server review state and evidence", () => {
  assert.deepEqual(technicalRequirementModel(pendingRequirement), { id: "req_1", reviewStatus: "Needs Review", approvedForDownstream: 0, confidence: 74, confidenceState: "Medium", evidence: pendingRequirement.original_text, sourceLocation: pendingRequirement.source_location, currentValues: {} });
});

test("requirement approval reconciles from server truth", async () => {
  const result = await commandThenRefresh({ command: async () => ({ accepted: true }), refresh: async () => ({ ...pendingRequirement, review_status: "Approved", approved_for_downstream: 1 }) });
  assert.equal(result.readModel.review_status, "Approved");
});

test("requirement rejection failure does not invent local state", async () => {
  let refreshed = false;
  await assert.rejects(() => commandThenRefresh({ command: async () => { throw new Error("Rejected by server"); }, refresh: async () => { refreshed = true; return {}; } }), /Rejected by server/);
  assert.equal(refreshed, false);
});

test("requirement blocker remains visible after authoritative refresh", async () => {
  const refreshed = await commandThenRefresh({ command: async () => ({}), refresh: async () => pendingRequirement });
  assert.equal(technicalRequirementModel(refreshed.readModel).reviewStatus, "Needs Review");
});

test("matching candidate presents server confidence and eligibility", () => {
  const model = matchingCandidateModel({ ...discoveryCandidate, confidence_state: "Medium", recommendation_tier: "Needs Review", technical_status: "Needs Review" }, blockedSafety);
  assert.equal(model.confidence, "Medium");
  assert.equal(model.approvalEligible, false);
});

test("Discovery Only can never appear technically approved", () => {
  const apparentlyEligible = { technical_eligibility: "Eligible for Technical Approval", blocks: [], warnings: [] };
  const model = matchingCandidateModel(discoveryCandidate, apparentlyEligible);
  assert.equal(model.discoveryOnly, true);
  assert.equal(model.approvalEligible, false);
});

test("successful candidate command refetches authoritative state", async () => {
  const calls = [];
  await commandThenRefresh({ command: async () => calls.push("approve"), refresh: async () => calls.push("refetch") });
  assert.deepEqual(calls, ["approve", "refetch"]);
});

test("selected BOQ item survives refresh through canonical deep link", () => {
  const url = buildProjectLocation("project_golden", "Technical Matching", "boq_6");
  assert.equal(parseProjectLocation(url).selectedItemId, "boq_6");
});

test("back and forward locations restore different matching selections", () => {
  assert.equal(parseProjectLocation(buildProjectLocation("p1", "Technical Matching", "a")).selectedItemId, "a");
  assert.equal(parseProjectLocation(buildProjectLocation("p1", "Technical Matching", "b")).selectedItemId, "b");
});

test("invalid item IDs fail safely", () => {
  assert.equal(validSelectedItem([{ id: "boq_1" }], "foreign_boq"), null);
});

test("project switch clears an incompatible selected item", () => {
  assert.equal(selectionAfterProjectChange("project_a", "project_b", "boq_1"), null);
});

test("client-only selection cannot alter canonical workflow truth", () => {
  const workflow = { lifecycleState: "Active", workflowStage: "BOQ/spec extraction", status: "In Progress", progress: 25, blockers: [], warnings: [], nextAction: null, readyForQuotation: false };
  const before = projectShellModel({ project: { status: "In Progress" } }, workflow);
  selectionAfterProjectChange("p1", "p1", "boq_1");
  assert.deepEqual(projectShellModel({ project: { status: "In Progress" } }, workflow), before);
});
