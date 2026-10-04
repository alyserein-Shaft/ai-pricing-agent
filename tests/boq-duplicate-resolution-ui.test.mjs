// DUP-3 — Governed UI Resolution Workflow.
//
// Source-pattern + pure-function tests in this repo's established UI-test
// convention (see tests/boq-workspace-specification-cta-authority.test.mjs):
// the BOQ workspace is a 30k-line TSX file, so UI authority wiring is proven
// against exact source slices, and label semantics are proven functionally
// against the real domain module. Runtime behavior is additionally proven in
// the Golden engineer walkthrough (Stage 3).
//
// Governing rules under test:
//   - the UI owns NO duplicate authority: every decision goes through the
//     governed backend operations (not-duplicate / merge),
//   - Not Duplicate is visible ONLY on rows the SERVER flagged
//     (duplicate_of_item_id), never on ordinary rows,
//   - the governed reason policy (>= 5 chars) is enforced before submit,
//   - success state comes only from the refreshed server response,
//   - Merge for flagged rows uses the persisted relation for direction,
//   - no second/duplicate count exists in the frontend.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extractionReviewActionLabel } from "../app/domain/boq-review-reasons.mjs";

const pageSource = async () => readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// NOT DUPLICATE AFFORDANCE
// ---------------------------------------------------------------------------

test("ND-UI-1. the main BOQ table exposes Not Duplicate only for rows the server flagged as duplicates", async () => {
  const source = await pageSource();
  // The main table's More-menu: Not Duplicate must be gated on the
  // persisted duplicate_of_item_id, exactly like the "Possible duplicate"
  // badge and the quick-filter predicate.
  const moreMenuStart = source.indexOf('details className="row-actions-menu"');
  const moreMenu = source.slice(moreMenuStart, source.indexOf("</details>", moreMenuStart));
  assert.ok(moreMenuStart > 0, "main table More-menu must exist");
  assert.match(moreMenu, /item\.duplicate_of_item_id && \(/, "Not Duplicate must be conditional on the server-persisted duplicate flag");
  assert.match(moreMenu, /openBoqReviewAction\(item, "not-duplicate"\)/, "it must open the governed review-action modal, not a local toggle");
  assert.doesNotMatch(moreMenu, /duplicate_of_item_id\s*=\s*null/, "the UI must never clear the duplicate flag locally");
});

test("ND-UI-2. Not Duplicate is a governed modal operation with the standard reason policy", async () => {
  const source = await pageSource();
  assert.match(source, /operation: "update" \| "restore" \| "approve" \| "reject" \| "not-duplicate";/, "the review-action draft must include not-duplicate");
  assert.match(source, /disabled=\{boqReviewAction\.reason\.trim\(\)\.length < 5\}/, "the modal submit stays governed by the minimum reason policy");
  const submitStart = source.indexOf("const submitBoqReviewAction");
  const submit = source.slice(submitStart, source.indexOf("const loadRequirementProfile", submitStart));
  assert.ok(submitStart > 0);
  assert.match(submit, /\/\$\{encodeURIComponent\(item\.id\)\}\/\$\{operation\}/, "submit posts to the real per-item backend route for the draft operation");
  assert.match(submit, /loadAllExtractedBoqItems\(/, "success state must be refreshed from the server");
  assert.match(submit, /projectApi\.dashboard\(projectId\)/, "dashboard facts (possibleDuplicates) must be re-read from the server after the decision");
  assert.doesNotMatch(submit, /duplicate_of_item_id\s*=/);
});

test("ND-UI-3. the Not Duplicate modal states its exact governed semantics", async () => {
  const source = await pageSource();
  const modalStart = source.indexOf("boqReviewAction &&");
  const modal = source.slice(modalStart, source.indexOf("{boqBulkReviewAction &&", modalStart));
  assert.ok(modalStart > 0);
  assert.match(modal, /boqReviewAction\.operation === "not-duplicate"/, "the modal must have an explicit Not Duplicate title case");
  assert.match(modal, /Resolves only the possible-duplicate finding/, "the modal must say the duplicate resolution does not approve the row");
  assert.match(modal, /extractionReviewActionLabel\(boqReviewAction\.operation\)/, "the submit button label comes from the shared domain label map");
});

// ---------------------------------------------------------------------------
// MERGE AFFORDANCE (governed, relation-directed)
// ---------------------------------------------------------------------------

test("MG-UI-1. a flagged row offers a governed merge that follows the persisted relation direction", async () => {
  const source = await pageSource();
  const moreMenuStart = source.indexOf('details className="row-actions-menu"');
  const moreMenu = source.slice(moreMenuStart, source.indexOf("</details>", moreMenuStart));
  assert.match(moreMenu, /reviewBoqItem\(item, "merge", \{\s*urlItemId: item\.duplicate_of_item_id,\s*otherItemId: item\.id,?\s*\}\)/, "merge on a flagged row must target the flagged original as the surviving row");
  const reviewStart = source.indexOf("const reviewBoqItem = async");
  const review = source.slice(reviewStart, source.indexOf("const openBoqReviewAction", reviewStart));
  assert.ok(reviewStart > 0);
  assert.match(review, /preset\?\.otherItemId/, "the preset target suppresses the manual ID prompt");
  assert.match(review, /preset\?\.urlItemId \|\| item\.id/, "the governed route still defaults to the clicked row");
  assert.match(review, /window\s*\n?\s*\.prompt\(\s*\n?\s*"Reason \/ source evidence:/, "merge keeps its governed reason prompt");
  assert.match(review, /MERGE_SELF_INVALID|boqApprovalErrorMessage\(result\.error\)/, "server rejections must surface truthfully");
  assert.doesNotMatch(review, /review_status\s*=\s*"Merged"/, "the UI must never set Merged locally");
});

test("MG-UI-2. the per-document extraction review keeps the governed Merge action wired to the real endpoint", async () => {
  const source = await pageSource();
  assert.match(source, /<button onClick=\{\(\) => reviewBoqItem\(item, "merge"\)\}>/, "the extraction review modal keeps its Merge action");
  assert.match(source, /\/\$\{operation\}/, "reviewBoqItem posts to the real per-item backend route");
});

// ---------------------------------------------------------------------------
// NO FRONTEND AUTHORITY / NO SECOND COUNT
// ---------------------------------------------------------------------------

test("AC-UI-1. duplicate counts and filters stay server-driven — no second count, no local dismissal", async () => {
  const source = await pageSource();
  assert.match(source, /const boqPossibleDuplicateCount = Number\(boqDashboardFacts\?\.possibleDuplicates \|\| 0\)/, "Action Center reads the server fact");
  assert.match(source, /"Possible Duplicates": visible\.filter\(\(item\) => Boolean\(item\.duplicate_of_item_id\)\)\.length/, "the quick filter derives from the server-loaded flag");
  assert.match(source, /return Boolean\(item\.duplicate_of_item_id\);/, "filter membership is the server field, not a local registry");
  assert.doesNotMatch(source, /dismissDuplicate|resolveDuplicateLocally|localDuplicate/, "no local duplicate-resolution state may exist");
});

// ---------------------------------------------------------------------------
// DOMAIN LABELS (functional)
// ---------------------------------------------------------------------------

test("LBL-1. both duplicate decisions have honest action labels", () => {
  assert.equal(extractionReviewActionLabel("not-duplicate"), "Not Duplicate");
  assert.equal(extractionReviewActionLabel("merge"), "Merge");
  // regression: existing labels unchanged
  assert.equal(extractionReviewActionLabel("approve"), "Confirm Extraction");
  assert.equal(extractionReviewActionLabel("reject"), "Reject Extraction");
  assert.equal(extractionReviewActionLabel("update"), "Edit");
  assert.equal(extractionReviewActionLabel("restore"), "Restore Original");
});
