// Agent 8 -- focused tests for the staged matching decision model.
//
// These assert the presentation-governance properties that matter, not the
// markup: axes are separated, unknowns stay unknown, a brand is never
// hard-coded, and a blocked stage always names one concrete next action.

import test from "node:test";
import assert from "node:assert/strict";

import {
  DIMENSION_TONE,
  MATCHING_DIMENSIONS,
  candidateDimensionPanel,
  contractualAcceptanceDimension,
  evidenceConfidenceDimension,
  matchingDecisionModel,
  matchingNextAction,
  stagedCandidates,
} from "../app/domain/matching-decision-presentation.mjs";

const candidate = (over = {}) => ({
  id: "c1",
  rank: 1,
  part_number: "NFS2-3030",
  manufacturer: "Notifier",
  family: "IDNet2",
  technical_status: "Compatible",
  confidence_state: "High Confidence",
  confidence_score: 82,
  matchingBasis: ["address capacity", "loop capacity"],
  mandatoryFailures: [],
  commercial_availability: "Available",
  ...over,
});

test("every candidate exposes all six axes", () => {
  const panel = candidateDimensionPanel(candidate());
  assert.deepEqual(Object.keys(panel.dimensions).sort(), [...MATCHING_DIMENSIONS].sort());
});

test("missing evidence is NOT_EVIDENCED, never a pass and never a number", () => {
  const panel = candidateDimensionPanel(candidate({ lifecycleState: undefined, regionalAvailability: undefined }));
  for (const key of ["lifecycle", "regionalAvailability"]) {
    assert.equal(panel.dimensions[key].state, "NOT_EVIDENCED");
    assert.equal(panel.dimensions[key].tone, DIMENSION_TONE.NOT_EVIDENCED);
  }
  assert.match(panel.dimensions.lifecycle.detail, /No lifecycle/i);
  assert.ok(panel.unknownDimensions.includes("lifecycle"));
});

test("a zero or absent confidence never renders as an approval", () => {
  const panel = candidateDimensionPanel(candidate({ confidence_state: "", confidence_score: 0 }));
  assert.equal(panel.dimensions.evidenceConfidence.state, "NOT_EVIDENCED");
});

test("mandatory failures block technical compatibility and approval", () => {
  const panel = candidateDimensionPanel(candidate({ mandatoryFailures: ["loop capacity exceeded"] }));
  assert.equal(panel.dimensions.technicalCompatibility.state, "BLOCKED");
  assert.equal(panel.approvalBlocked, true);
  assert.ok(panel.blockedDimensions.includes("technicalCompatibility"));
});

test("Discovery Only is reported as not evidence of compatibility", () => {
  const panel = candidateDimensionPanel(candidate({ technical_status: "Discovery Only" }));
  assert.equal(panel.dimensions.technicalCompatibility.state, "NOT_EVIDENCED");
});

test("unacknowledged safety warnings make evidence confidence conflicted, not merely high", () => {
  const dimension = evidenceConfidenceDimension(candidate(), { warnings: [{ code: "W1", message: "lifecycle", acknowledged_at: null }] });
  assert.equal(dimension.state, "CONFLICT");
  assert.match(dimension.detail, /not yet acknowledged/);
});

test("commercial availability never changes the technical axis", () => {
  const before = candidateDimensionPanel(candidate({ commercial_availability: "Available" }));
  const after = candidateDimensionPanel(candidate({ commercial_availability: "Unavailable" }));
  assert.deepEqual(before.dimensions.technicalCompatibility, after.dimensions.technicalCompatibility);
  assert.equal(after.dimensions.commercialAvailability.state, "BLOCKED");
  assert.equal(before.dimensions.commercialAvailability.state, "EVIDENCED");
});

test("a commercial block alone does not silently block technical compatibility", () => {
  const panel = candidateDimensionPanel(candidate({ commercial_availability: "Restricted" }));
  assert.equal(panel.dimensions.technicalCompatibility.state, "EVIDENCED");
  assert.ok(panel.blockedDimensions.includes("commercialAvailability"));
});

test("with no governed project strategy, contractual acceptance is unknown", () => {
  const dimension = contractualAcceptanceDimension(candidate(), null);
  assert.equal(dimension.state, "NOT_EVIDENCED");
  assert.match(dimension.detail, /not a mandate/i);
});

test("a mandated brand blocks a different manufacturer and never auto-accepts it", () => {
  const dimension = contractualAcceptanceDimension(candidate(), { targetBrand: "Farenhyt", contractuallyMandated: true });
  assert.equal(dimension.state, "BLOCKED");
  assert.match(dimension.label, /Outside the contractually mandated brand/);
});

test("a non-mandatory project brand target is a conflict, not a rejection", () => {
  const dimension = contractualAcceptanceDimension(candidate(), { targetBrand: "Farenhyt", contractuallyMandated: false });
  assert.equal(dimension.state, "CONFLICT");
});

test("the model hard-codes no brand when no strategy is supplied", () => {
  const panel = candidateDimensionPanel(candidate({ manufacturer: "Notifier" }), {});
  const serialized = JSON.stringify(panel).toLowerCase();
  for (const forbidden of ["farenhyt", "gamewell", "gent"]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must never appear without a governed strategy`);
  }
});

test("a mandated brand only marks EVIDENCED when the candidate actually matches", () => {
  const dimension = contractualAcceptanceDimension(candidate({ manufacturer: "Farenhyt" }), { targetBrand: "Farenhyt", contractuallyMandated: true });
  assert.equal(dimension.state, "EVIDENCED");
  assert.match(dimension.detail, /Consultant question/);
});

test("stage promotes the first non-fallback candidate and keeps the rest as alternatives", () => {
  const staged = stagedCandidates([
    candidate({ id: "fb", rank: 1, isFallbackCandidate: true }),
    candidate({ id: "real", rank: 2, isFallbackCandidate: false }),
  ]);
  assert.equal(staged.recommended.id, "real");
  assert.equal(staged.fallbackPromoted, false);
  assert.deepEqual(staged.alternatives.map((c) => c.id), ["fb"]);
});

test("a fallback candidate is only promoted when nothing else exists, and says so", () => {
  const staged = stagedCandidates([candidate({ id: "fb", rank: 1, isFallbackCandidate: true })]);
  assert.equal(staged.recommended.id, "fb");
  assert.equal(staged.fallbackPromoted, true);
});

test("no candidates yields no recommendation rather than an invented one", () => {
  const staged = stagedCandidates([]);
  assert.equal(staged.recommended, null);
  assert.deepEqual(staged.alternatives, []);
  const model = matchingDecisionModel({ candidates: [] });
  assert.equal(model.recommended, null);
  assert.equal(model.emptyState, true);
});

test("a blocked stage always yields exactly one actionable next step", () => {
  const cases = [
    { input: { blockers: ["AI understanding review required"], itemCount: 3, awaitingUnderstanding: 4 }, workspace: "AI Understanding Review", kind: "BLOCKED" },
    { input: { blockers: ["requirement approval pending"], itemCount: 3, pendingRequirements: 2 }, workspace: "Requirements", kind: "BLOCKED" },
    { input: { blockers: [], itemCount: 0 }, workspace: "Technical Matching", kind: "BLOCKED" },
    { input: { blockers: ["an unclassified internal blocker"], itemCount: 3 }, workspace: "Technical Matching", kind: "BLOCKED" },
    { input: { blockers: [], itemCount: 3, matchStale: true }, workspace: "Technical Matching", kind: "STALE" },
  ];
  for (const { input, workspace, kind } of cases) {
    const action = matchingNextAction(input);
    assert.equal(action.kind, kind);
    assert.equal(action.workspace, workspace);
    assert.ok(action.label && action.detail, "a next action must be labelled and explained");
    assert.ok(action.action, "a next action must name a concrete action id");
  }
});

test("an unclassified blocker is passed through verbatim, not paraphrased", () => {
  const action = matchingNextAction({ blockers: ["internal blocker 4711"], itemCount: 2 });
  assert.equal(action.detail, "internal blocker 4711");
});

test("a stale match is reported as not current and not approvable", () => {
  const action = matchingNextAction({ blockers: [], itemCount: 2, matchStale: true });
  assert.equal(action.action, "RERUN_MATCHING");
  assert.match(action.detail, /not current/i);
});

test("stale state outranks a generic blocker", () => {
  const action = matchingNextAction({ blockers: ["some blocker"], itemCount: 2, matchStale: true });
  assert.equal(action.action, "RERUN_MATCHING");
});

test("the full model keeps the governed strategy untouched and attaches panels to every candidate", () => {
  const model = matchingDecisionModel({
    candidates: [candidate({ id: "a", rank: 1 }), candidate({ id: "b", rank: 2 })],
    safetyFor: () => null,
    projectStrategy: { targetBrand: "Farenhyt", standardRegime: "UL 864", contractuallyMandated: false },
  });
  assert.equal(model.recommended.candidate.id, "a");
  assert.equal(model.alternatives.length, 1);
  assert.equal(model.alternatives[0].panel.candidateId, "b");
  assert.equal(model.projectStrategy.targetBrand, "Farenhyt");
  assert.match(model.recommended.panel.dimensions.contractualAcceptance.detail, /Farenhyt/);
  assert.equal(model.recommended.panel.dimensions.contractualAcceptance.state, "CONFLICT");
});
