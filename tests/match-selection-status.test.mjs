import test from "node:test";
import assert from "node:assert/strict";
import { deriveMatchSelectionStatus } from "../app/domain/match-selection-status.mjs";

// This module surfaces an existing selection mechanism (safety_decisions +
// an Approved Technical safety_approval_requests row -- the same state
// pricing-runtime.mjs's loadPricingInput already requires) rather than
// inventing a new one. These are isolated fixtures, no DB, matching the
// exact shape the worker layer already derives from
// safety_decisions.technical_eligibility / .price_eligibility and the
// latest Technical safety_approval_requests.status.

test("no candidates at all", () => {
  const result = deriveMatchSelectionStatus({ candidates: [] });
  assert.equal(result.verdict, "NO_CANDIDATES");
  assert.equal(result.selectedCandidateId, null);
});

test("eligible selection -- exactly one candidate with an Approved Technical decision is SELECTED", () => {
  const result = deriveMatchSelectionStatus({
    candidates: [
      { candidateId: "c1", technicalEligibility: "Eligible for Technical Approval", priceEligibility: "Eligible for Price Approval", technicalApproved: true },
      { candidateId: "c2", technicalEligibility: "Human Review Required", priceEligibility: "Price Approval Disabled", technicalApproved: false },
    ],
  });
  assert.equal(result.verdict, "SELECTED");
  assert.equal(result.selectedCandidateId, "c1");
  assert.equal(result.candidates.find((c) => c.candidateId === "c1").status, "Selected");
  assert.equal(result.candidates.find((c) => c.candidateId === "c2").status, "Not Eligible");
});

test("ranking/confidence alone never authorizes selection -- an eligible top-rank candidate with no Approved decision is PENDING_DECISION, not SELECTED", () => {
  const result = deriveMatchSelectionStatus({
    candidates: [
      { candidateId: "top-rank", technicalEligibility: "Eligible for Technical Approval", priceEligibility: "Price Approval Disabled", technicalApproved: false },
    ],
  });
  assert.equal(result.verdict, "PENDING_DECISION");
  assert.equal(result.selectedCandidateId, null);
  assert.deepEqual(result.eligibleCandidateIds, ["top-rank"]);
  assert.match(result.reason, /No automatic-selection policy exists/);
});

test("ambiguous candidates -- more than one Approved Technical decision is flagged, never silently resolved by rank", () => {
  const result = deriveMatchSelectionStatus({
    candidates: [
      { candidateId: "c1", technicalEligibility: "Eligible for Technical Approval", priceEligibility: "Eligible for Price Approval", technicalApproved: true },
      { candidateId: "c2", technicalEligibility: "Eligible for Technical Approval", priceEligibility: "Eligible for Price Approval", technicalApproved: true },
    ],
  });
  assert.equal(result.verdict, "AMBIGUOUS");
  assert.equal(result.selectedCandidateId, null);
  assert.deepEqual(result.ambiguousCandidateIds.sort(), ["c1", "c2"]);
  assert.match(result.reason, /2 candidates/);
});

test("missing compatibility evidence -- a candidate with mandatory technical gaps is Not Eligible / BLOCKED, never Selected", () => {
  const result = deriveMatchSelectionStatus({
    candidates: [
      { candidateId: "c1", technicalEligibility: "Blocked", priceEligibility: "Price Approval Disabled", technicalApproved: false },
    ],
  });
  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.candidates[0].status, "Not Eligible");
  assert.equal(result.selectedCandidateId, null);
});

test("a candidate with no safety decision evaluated yet is Not Evaluated, distinct from Not Eligible", () => {
  const result = deriveMatchSelectionStatus({
    candidates: [{ candidateId: "c1", technicalEligibility: null, priceEligibility: null, technicalApproved: false }],
  });
  assert.equal(result.candidates[0].status, "Not Evaluated");
  assert.equal(result.verdict, "BLOCKED");
});

test("missing price never affects technical selection -- price_eligibility is reported but does not change the verdict or block Selected", () => {
  const result = deriveMatchSelectionStatus({
    candidates: [
      { candidateId: "c1", technicalEligibility: "Eligible for Technical Approval", priceEligibility: "Price Approval Disabled", technicalApproved: true },
    ],
  });
  assert.equal(result.verdict, "SELECTED");
  assert.equal(result.candidates[0].priceEligibility, "Price Approval Disabled", "price ineligibility must remain a visible, separate fact -- never silently invented or hidden");
});

// Rerun preservation: a rerun produces a NEW match run with NEW candidate
// ids. The worker layer scopes the safety-decision lookup to
// c.match_run_id=? (the current, non-superseded run) before calling this
// function, so a superseded run's old candidate/decision must never leak
// into the new run's projection. Modeled here by simply never passing the
// old candidate through -- the function has no state and cannot "remember"
// a candidate it was not given, which is the guarantee that matters.
test("rerun preservation -- a prior run's approved candidate does not leak into a new run's projection", () => {
  const oldRunProjection = deriveMatchSelectionStatus({
    candidates: [{ candidateId: "old-run-c1", technicalEligibility: "Eligible for Technical Approval", priceEligibility: "Eligible for Price Approval", technicalApproved: true }],
  });
  assert.equal(oldRunProjection.verdict, "SELECTED");

  const newRunProjection = deriveMatchSelectionStatus({
    candidates: [{ candidateId: "new-run-c1", technicalEligibility: "Eligible for Technical Approval", priceEligibility: null, technicalApproved: false }],
  });
  assert.equal(newRunProjection.verdict, "PENDING_DECISION");
  assert.equal(newRunProjection.selectedCandidateId, null);
  assert.ok(!newRunProjection.candidates.some((c) => c.candidateId === "old-run-c1"), "the new run's projection must never reference the prior run's candidate");
});
