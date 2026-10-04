import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { MIN_GOVERNED_REASON_LENGTH } from "../worker/reason-governance.mjs";
import { MIN_GOVERNED_REASON_LENGTH as DOMAIN_MIN, MIN_SAFETY_OVERRIDE_REASON_LENGTH } from "../app/domain/reason-governance.mjs";
import { validateOverride } from "../app/domain/confidence-safety-engine.mjs";
import { validateUnderstandingReviewCommand } from "../app/domain/estimator-understanding-review.mjs";

// Consolidation Fix Sprint 1, item 5: reason-length minimums varied 3, 5,
// or 10 characters across different governance endpoints for what is meant
// to be the same rule. Now a single shared constant. Representative files
// from each named category (BOQ, drawing, classification, BOM/cost,
// override) are checked below -- some previously at 3 or 10 (a real value
// change), some already at 5 (now provably sharing the same constant
// rather than a coincidentally-matching literal).

test("the canonical minimum is exactly 5, and the boundary behaves as specified", () => {
  assert.equal(MIN_GOVERNED_REASON_LENGTH, 5);
  assert.ok("abcd".length < MIN_GOVERNED_REASON_LENGTH, "4 characters must be rejected");
  assert.ok("abcde".length >= MIN_GOVERNED_REASON_LENGTH, "5 characters must be accepted");
});

const read = (relative) => fs.readFileSync(new URL(`../worker/${relative}`, import.meta.url), "utf8");

test("BOQ review (previously <3) now uses the shared constant", () => {
  const worker = read("boq-extraction-api.mjs");
  assert.match(worker, /import \{ MIN_GOVERNED_REASON_LENGTH \} from "\.\/reason-governance\.mjs";/);
  assert.match(worker, /reason\.length < MIN_GOVERNED_REASON_LENGTH\) return json\(\{ error: \{ code: "REVIEW_REASON_REQUIRED"/);
  assert.doesNotMatch(worker, /reason\.length < 3\b/);
});

test("drawing structural review (already 5) now shares the same constant, not a coincidental literal", () => {
  const worker = read("drawing-structural-review-api.mjs");
  assert.match(worker, /import \{ MIN_GOVERNED_REASON_LENGTH \} from "\.\/reason-governance\.mjs";/);
  assert.match(worker, /reason\.length < MIN_GOVERNED_REASON_LENGTH/);
  assert.doesNotMatch(worker, /reason\.length ?< ?5\b/);
});

test("classification overrides (previously <3 and <10 in the same file) now share one constant", () => {
  const worker = read("classification-api.mjs");
  assert.match(worker, /import \{ MIN_GOVERNED_REASON_LENGTH \} from "\.\/reason-governance\.mjs";/);
  const matches = worker.match(/reason\.length < MIN_GOVERNED_REASON_LENGTH/g) || [];
  assert.ok(matches.length >= 3, "expected all three classification reason checks to use the shared constant");
  assert.doesNotMatch(worker, /reason\.length ?< ?(3|10)\b/);
});

test("BOM/cost decisions (already 5) share the same constant", () => {
  const bom = read("boq-line-bom-api.mjs");
  const cost = read("boq-line-cost-api.mjs");
  const decision = read("boq-line-decision-api.mjs");
  for (const worker of [bom, cost, decision]) {
    assert.match(worker, /import \{ MIN_GOVERNED_REASON_LENGTH \} from "\.\/reason-governance\.mjs";/);
    assert.match(worker, /reason\.length < MIN_GOVERNED_REASON_LENGTH/);
  }
});

test("the safety override decision (previously the highest-risk <10) now uses the shared base gate", () => {
  const worker = read("confidence-safety-api.mjs");
  assert.match(worker, /import \{ MIN_GOVERNED_REASON_LENGTH \} from "\.\/reason-governance\.mjs";/);
  assert.match(worker, /!status \|\| reason\.length < MIN_GOVERNED_REASON_LENGTH\) return json\(\{ error: \{ code: "OVERRIDE_DECISION_REQUIRED"/);
  assert.doesNotMatch(worker, /reason\.length ?< ?10\b/);
  // The extra domain-specific gate for this high-risk action (validateOverride,
  // a separate structured eligibility check) is untouched -- only the base
  // length gate was unified.
  assert.match(worker, /validateOverride\(/);
});

test("the deliberately-excluded deprecated Engineering Graph endpoint is left as-is, not silently forced", () => {
  const worker = read("engineering-knowledge-graph-api.mjs");
  assert.doesNotMatch(worker, /reason-governance\.mjs/);
  assert.match(worker, /reason\.length<5/);
});

test("frontend validation for the two backend thresholds that actually changed (BOQ review, requirement review) now matches the new minimum", () => {
  const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /boqReviewAction\.reason\.trim\(\)\.length < 3/);
  assert.doesNotMatch(page, /boqBulkReviewAction\.reason\.trim\(\)\.length < 3/);
  assert.doesNotMatch(page, /technicalRequirementAction\.reason\.trim\(\)\.length < 3/);
  assert.match(page, /boqReviewAction\.reason\.trim\(\)\.length < 5/);
  assert.match(page, /boqBulkReviewAction\.reason\.trim\(\)\.length < 5/);
  assert.match(page, /technicalRequirementAction\.reason\.trim\(\)\.length < 5/);
});

// Backend & Codebase Consolidation Sprint, item 2: finishing the
// consolidation -- two pure domain engines (app/domain/*.mjs, no I/O
// access) had their own hardcoded reason-length literals (confidence-
// safety-engine.mjs's validateOverride at <10, estimator-understanding-
// review.mjs's validateUnderstandingReviewCommand at >=3) that could not
// import worker/reason-governance.mjs (domain must never depend on
// worker/*.mjs). The canonical constant was relocated to
// app/domain/reason-governance.mjs; worker/reason-governance.mjs now
// re-exports it unchanged so its 31 existing worker importers needed no
// changes.

test("worker/reason-governance.mjs re-exports the same canonical constant now defined in app/domain -- one source of truth, not two copies", () => {
  assert.equal(MIN_GOVERNED_REASON_LENGTH, DOMAIN_MIN);
  assert.equal(DOMAIN_MIN, 5);
});

test("estimator-understanding-review's base reason gate (previously the weakest at >=3) now uses the canonical minimum: 4 rejected, 5 accepted", () => {
  const base = { expectedVersion: 0, requestId: "review_request_123", selectionAuthority: "a".repeat(64), action: "REJECT_INTERPRETATION" };
  const tooShort = validateUnderstandingReviewCommand({ ...base, reason: "shrt" });
  assert.equal(tooShort.ok, false);
  assert.equal(tooShort.code, "UNDERSTANDING_REVIEW_REASON_REQUIRED");
  const accepted = validateUnderstandingReviewCommand({ ...base, reason: "short" });
  assert.equal(accepted.ok, true);
});

test("safety-override justification is an intentionally stricter, named exception (MIN_SAFETY_OVERRIDE_REASON_LENGTH=10), not the base rule", () => {
  assert.equal(MIN_SAFETY_OVERRIDE_REASON_LENGTH, 10);
  const request = { approvalLevel: 1, blockCodes: ["X"], evidence: {}, scope: "item", expiresAt: "2027-01-01" };
  const safetyDecision = { blocks: [{ code: "X", overridable: true }] };
  const user = { id: "user-1" };
  // A reason meeting the BASE rule (5) but not the stricter override rule (10) must still be rejected here.
  const belowStricter = validateOverride({ safetyDecision, request: { ...request, reason: "short", technicalJustification: "short" }, user });
  assert.ok(belowStricter.missing.includes("reason"));
  const meetsStricter = validateOverride({ safetyDecision, request: { ...request, reason: "a substantive override reason", technicalJustification: "a substantive technical justification" }, user });
  assert.ok(!meetsStricter.missing.includes("reason"));
  assert.equal(meetsStricter.permitted, true);
});

test("the two domain engines import the canonical constants rather than hardcoding the policy", async () => {
  const safetyEngine = await (await import("node:fs/promises")).readFile(new URL("../app/domain/confidence-safety-engine.mjs", import.meta.url), "utf8");
  const understandingReview = await (await import("node:fs/promises")).readFile(new URL("../app/domain/estimator-understanding-review.mjs", import.meta.url), "utf8");
  assert.match(safetyEngine, /import \{ MIN_SAFETY_OVERRIDE_REASON_LENGTH \} from "\.\/reason-governance\.mjs";/);
  assert.doesNotMatch(safetyEngine, /trim\(\)\.length < 10/);
  assert.match(understandingReview, /import \{ MIN_GOVERNED_REASON_LENGTH \} from "\.\/reason-governance\.mjs";/);
  assert.doesNotMatch(understandingReview, /reason\.trim\(\)\.length >= 3/);
});
