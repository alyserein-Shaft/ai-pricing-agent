// Agent 8 -- focused regression tests for the governed review-reason gate.
//
// These exist because an accidental validation click once recorded a real
// REJECT_INTERPRETATION against the Golden project: the UI passed a hard-coded
// reason into the mutation call, so no reason was ever confirmed by a human.
//
// The tests prove, without a browser and without a running server:
//   1. all four human decisions are gated;
//   2. no mutation may be issued with a blank/short reason (gate refuses);
//     3. cancel/empty-reason cannot produce a submittable reason;
//   4. the component contains NO canned reason literal passed into action();
//   5. the backend validator independently still refuses the decisions it gates.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  MAX_GOVERNED_REASON_LENGTH,
  MIN_GOVERNED_REASON_LENGTH,
  REASON_GATED_REVIEW_DECISIONS,
  composeGovernedReason,
  evaluateReasonGate,
  requiresGovernedReason,
  reviewDecisionLabel,
} from "../app/domain/review-reason-gate.mjs";
import { validateUnderstandingReviewCommand } from "../app/domain/estimator-understanding-review.mjs";

const WORKSPACE = "app/components/workspaces/AiUnderstandingReviewWorkspace.tsx";
const DECISIONS = ["APPROVE_INTERPRETATION", "EDIT_AND_APPROVE", "REJECT_INTERPRETATION", "RETURN_TO_REVIEW"];

test("all four human review decisions require a governed reason", () => {
  assert.equal(REASON_GATED_REVIEW_DECISIONS.length, 4);
  for (const decision of DECISIONS) {
    assert.ok(requiresGovernedReason(decision), `${decision} must be gated`);
    assert.equal(reviewDecisionLabel(decision).length > 0, true);
  }
});

test("an unknown or empty decision is not silently treated as gated", () => {
  assert.equal(requiresGovernedReason(""), false);
  assert.equal(requiresGovernedReason(undefined), false);
  assert.equal(requiresGovernedReason("SOME_FUTURE_ACTION"), false);
});

test("blank, whitespace-only and too-short reasons are refused for every decision", () => {
  for (const decision of DECISIONS) {
    for (const reason of [undefined, null, "", "   ", "\n\t", "a", "abcde".slice(0, MIN_GOVERNED_REASON_LENGTH - 1)]) {
      const gate = evaluateReasonGate({ decision, reason });
      assert.equal(gate.ok, false, `${decision} accepted ${JSON.stringify(reason)}`);
      assert.equal(gate.gated, true);
      assert.equal(gate.reason, null, "a refused gate must never hand back a reason to send");
      assert.equal(gate.code, "REVIEW_REASON_REQUIRED");
      assert.match(gate.message, /No decision was recorded/);
    }
  }
});

test("a reason at the canonical minimum is accepted for every decision", () => {
  const reason = "x".repeat(MIN_GOVERNED_REASON_LENGTH);
  for (const decision of DECISIONS) {
    const gate = evaluateReasonGate({ decision, reason });
    assert.equal(gate.ok, true, `${decision} refused a minimum-length reason`);
    assert.equal(gate.reason, reason);
  }
});

test("optional source context is composed without dangling separators", () => {
  assert.equal(composeGovernedReason("Capacity verified", "spec p.19"), "Capacity verified — spec p.19");
  assert.equal(composeGovernedReason("Capacity verified", ""), "Capacity verified");
  assert.equal(composeGovernedReason("Capacity verified", "   "), "Capacity verified");
  assert.equal(composeGovernedReason("  ", "spec p.19"), "");
  assert.equal(composeGovernedReason(null, null), "");
});

test("source context alone cannot satisfy the gate", () => {
  const gate = evaluateReasonGate({ decision: "APPROVE_INTERPRETATION", reason: "", source: "spec p.19" });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, null);
});

test("composed reason is trimmed and capped at the backend limit", () => {
  const gate = evaluateReasonGate({ decision: "APPROVE_INTERPRETATION", reason: `  ${"y".repeat(MAX_GOVERNED_REASON_LENGTH + 50)}  ` });
  assert.equal(gate.ok, true);
  assert.equal(gate.reason.length, MAX_GOVERNED_REASON_LENGTH);
});

test("a non-gated decision passes through with a null reason", () => {
  const gate = evaluateReasonGate({ decision: "SOME_FUTURE_ACTION", reason: "" });
  assert.equal(gate.ok, true);
  assert.equal(gate.gated, false);
  assert.equal(gate.reason, null);
});

test("backend validator independently refuses the decisions it gates", () => {
  const base = {
    expectedVersion: 1,
    requestId: "review:gate-test-0001",
    selectionAuthority: "a".repeat(64),
  };
  for (const action of ["EDIT_AND_APPROVE", "REJECT_INTERPRETATION", "RETURN_TO_REVIEW"]) {
    const refused = validateUnderstandingReviewCommand({ ...base, action, reason: "" });
    assert.equal(refused.ok, false, `${action} accepted an empty reason`);
    assert.equal(refused.code, "UNDERSTANDING_REVIEW_REASON_REQUIRED");
    const accepted = validateUnderstandingReviewCommand({ ...base, action, reason: "Capacity verified against panel data sheet" });
    assert.equal(accepted.ok, true, `${action} refused a substantive reason`);
    assert.equal(accepted.value.reason, "Capacity verified against panel data sheet");
  }
});

test("the workspace passes no canned reason into action()", () => {
  const source = readFileSync(WORKSPACE, "utf8");
  // Any action("DECISION", "literal") call with a non-empty second argument
  // would re-introduce the exact defect: a reason nobody confirmed.
  const calls = source.match(/action\(\s*"[A-Z_]+"\s*,\s*[^)]*\)/g) || [];
  assert.ok(calls.length >= 4, `expected the four decision buttons to call action(), found ${calls.length}`);
  for (const call of calls) {
    const [, second] = call.match(/action\(\s*"[A-Z_]+"\s*,\s*(.*)\)/) || [];
    const literal = (second || "").trim();
    assert.ok(
      literal === '""' || literal === "",
      `action() call carries a canned reason: ${call}`,
    );
  }
});

test("cancelling the reason form cannot reach a mutation", () => {
  const source = readFileSync(WORKSPACE, "utf8");
  // Cancel must only clear the form state. If it called action() or a request
  // directly, a cancel would be a silent write.
  assert.ok(
    /onCancel=\{\(\) => setReasonForm\(null\)\}/.test(source),
    "cancel must only clear the reason form",
  );
  const form = readFileSync("app/components/commercial/ReasonForm.tsx", "utf8");
  assert.equal((form.match(/fetch\(/g) || []).length, 0, "ReasonForm must never issue a request itself");
  // The only onSubmit call must sit inside submit() and be unreachable until
  // both the blank and the minimum-length checks have passed.
  const submitBody = form.slice(form.indexOf("const submit"), form.indexOf("return <div"));
  const blankGuard = submitBody.indexOf("if (!trimmed)");
  const lengthGuard = submitBody.indexOf("trimmed.length < MIN_GOVERNED_REASON_LENGTH");
  const handOff = submitBody.indexOf("onSubmit(");
  assert.ok(blankGuard > -1, "blank-reason guard missing from submit()");
  assert.ok(lengthGuard > -1, "minimum-length guard missing from submit()");
  assert.ok(blankGuard < lengthGuard && lengthGuard < handOff, "onSubmit must be reachable only after both guards");
});

test("the workspace gates before any fetch is issued", () => {
  const source = readFileSync(WORKSPACE, "utf8");
  const gateIndex = source.indexOf("requiresGovernedReason(operation)");
  // The mutating request is the only POST; the list GET and the per-item
  // detail GET both appear earlier in the file and are irrelevant here.
  const mutationIndex = source.indexOf('method: "POST"');
  assert.ok(gateIndex > -1, "gate call is missing from the workspace");
  assert.ok(mutationIndex > -1, "mutation request is missing from the workspace");
  assert.ok(gateIndex < mutationIndex, "the reason gate must precede the mutation request");
  assert.equal((source.match(/method: "POST"/g) || []).length, 1, "there must be exactly one mutating request");
  assert.ok(/if \(!gate\.ok\)/.test(source), "a failing gate must return before mutating");
  assert.ok(/reason: reviewReason/.test(source), "the mutation must send the gated reason, not the raw argument");
});
