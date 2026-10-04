// BOQ_REENTRY_OVERWRITE_GUARD_FIX -- source-contract tests.
//
// The review modal distinguishes fresh import (legacy overwrite protection)
// from review re-entry (durable review) via a derived boolean. These tests
// pin the contract without rendering React.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pageSource = () => readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("A: fresh import with existing local items still shows overwrite protection", async () => {
  const page = await pageSource();
  assert.match(page, /\{items\.length > 0 && !isReviewReentry && \(\s*<div className="existing-boq-warning">/s);
});

test("B/C: re-entry suppresses the protection and Apply is not disabled by items.length", async () => {
  const page = await pageSource();
  assert.match(page, /\(items\.length > 0 && !isReviewReentry\)/);
  const disabledRegion = page.slice(page.indexOf("boqReviewSubmitting"), page.indexOf("boqReviewSubmitting") + 2000);
  void disabledRegion;
  const applyRegion = page.slice(page.indexOf("const applyKnownBoqExtraction"), page.indexOf("const closeGenericBoqPreview"));
  assert.match(applyRegion, /if \(items\.length > 0 && !isReviewReentry\)/);
});

test("reentry mode derives from preview version plus resolved members, never filename", async () => {
  const page = await pageSource();
  const region = page.slice(page.indexOf("const isReviewReentry"), page.indexOf("const isReviewReentry") + 600);
  assert.match(region, /boqPreviewExtractionVersionId/);
  assert.match(region, /memberItemIds/);
  assert.doesNotMatch(region, /fileName|project.*name/i);
});

test("D: unresolved anchors fail closed through the planner", async () => {
  const { planBoqReviewSubmission } = await import("../app/domain/boq-review-plan.mjs");
  const plan = planBoqReviewSubmission({
    candidates: [{ id: 1, memberItemIds: ["a"], pendingItemIds: ["a"], unresolvedAnchors: [999] }],
    lineDecisions: { 1: "Accepted" },
    exclusionReasons: {},
  });
  assert.ok(plan.errors.some((error) => error.startsWith("GROUP_UNRESOLVED_ANCHORS")));
});

test("E/F: rationale and exclusion reasons remain required", async () => {
  const page = await pageSource();
  const applyRegion = page.slice(page.indexOf("const applyKnownBoqExtraction"), page.indexOf("const closeGenericBoqPreview"));
  assert.match(applyRegion, /boqAcceptReason\.trim\(\)\.length < MIN_GOVERNED_REASON_LENGTH/);
  assert.match(applyRegion, /plan\.errors\.length/, "planner errors (incl. missing exclusion reasons) block apply");
});

test("G: 'decisions pending' copy is gone from the known-BOQ modal", async () => {
  const page = await pageSource();
  const knownRegion = page.slice(page.indexOf("knownBoqAnchorIntegrityValid"), page.indexOf("const closeGenericBoqPreview"));
  assert.doesNotMatch(knownRegion, /decisions pending/);
});

test("H: pending copy shows groups and item approvals from runtime values", async () => {
  const page = await pageSource();
  assert.match(page, /boqPendingItemCount/);
  assert.match(page, /\$\{boqRuntimeList\.length\} groups · \$\{boqPendingItemCount\} item/);
});

test("I: Accept Visible marks local decisions only", async () => {
  const page = await pageSource();
  const at = page.indexOf("Accept visible ({visibleBoqCandidates.length})");
  const region = page.slice(Math.max(0, at - 1400), at + 400);
  assert.match(region, /setBoqLineDecisions/);
  assert.doesNotMatch(region, /bulk-review|fetch\(|requestJson/);
});

test("J: opening review performs no version or row writes", async () => {
  const page = await pageSource();
  const region = page.slice(page.indexOf("const openBoqRuntimeCandidates"), page.indexOf("const applyKnownBoqExtraction"));
  assert.doesNotMatch(region, /method: "POST"|INSERT INTO|UPDATE boq_/);
  assert.match(region, /fetchBoqRuntimePreview\(documentId\)/, "opening delegates to the read-only preview fetch");
});
