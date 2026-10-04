import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { documentDownstreamState } from "../app/domain/document-downstream-state.mjs";

// CTA Authority Fix (2026-09-07). Root cause: the Documents workspace's
// executable extraction buttons (Start BOQ extraction, Start specification
// extraction) gated only on `document.predicted_type === X && !extraction_id`
// -- an AUTOMATIC classification proposal (never human-confirmed) satisfied
// that exactly as well as a real "Manually Confirmed" one, so the button
// rendered as clickable while the backend (which already correctly requires
// classification_status === "Manually Confirmed") would reject the request.
// The "Next action" text, computed separately via documentDownstreamState,
// already correctly said "Review type" in that same case -- so the card
// could show a contradictory pair: "Next action: Review type" next to an
// active "Start BOQ extraction" button.
//
// Fix: every extraction-start button in the Documents workspace now derives
// its visibility from the exact same `document.downstream_state` object
// (documentDownstreamState's output) that produces the "Next action" text
// -- `downstreamState?.recommendedAction === "Start BOQ extraction"` etc. --
// instead of a second, independently-computed condition. Since
// documentDownstreamState only ever returns those recommendedAction strings
// once classificationConfirmed(document) is true (checked once, at the top
// of the function, before any type branch), text and CTA can no longer
// disagree.

const boqNotConfirmed = (extra = {}) => ({
  predicted_type: "BOQ",
  document_type: "BOQ",
  classification_status: "Classified", // automatic, never human-confirmed
  classification_id: "c1",
  manual_review_required: 0,
  ...extra,
});

test("1. unconfirmed BOQ: next action is Review type, and the recommendedAction the CTA would key on is not the extraction string", () => {
  const state = documentDownstreamState(boqNotConfirmed());
  assert.equal(state.recommendedAction, "Review type");
  assert.notEqual(state.recommendedAction, "Start BOQ extraction");
});

test("2. confirmed BOQ with no extraction yet: Start BOQ extraction appears", () => {
  const state = documentDownstreamState(
    boqNotConfirmed({ classification_status: "Manually Confirmed" }),
  );
  assert.equal(state.recommendedAction, "Start BOQ extraction");
});

test("3. unconfirmed Technical Specification: no extraction CTA, confirmation is next action", () => {
  const state = documentDownstreamState({
    predicted_type: "Technical Specification",
    document_type: "Technical Specification",
    classification_status: "Classified",
    classification_id: "c1",
    manual_review_required: 0,
  });
  assert.equal(state.recommendedAction, "Review type");
  assert.notEqual(state.recommendedAction, "Start specification extraction");
});

test("4. confirmed Technical Specification: specification extraction CTA appears", () => {
  const state = documentDownstreamState({
    predicted_type: "Technical Specification",
    document_type: "Technical Specification",
    classification_status: "Manually Confirmed",
  });
  assert.equal(state.recommendedAction, "Start specification extraction");
});

test("5. unconfirmed Project Context: no Project Context extraction CTA", () => {
  const state = documentDownstreamState({
    predicted_type: "Project Context",
    document_type: "BOQ", // stale mirror, must be ignored
    classification_status: "Classified",
    classification_id: "c1",
    manual_review_required: 0,
  });
  assert.equal(state.recommendedAction, "Review type");
  assert.notEqual(state.recommendedAction, "Start project context extraction");
  assert.notEqual(state.recommendedAction, "Start BOQ extraction");
});

test("6. confirmed Project Context: correct downstream action appears", () => {
  const state = documentDownstreamState({
    predicted_type: "Project Context",
    document_type: "BOQ",
    classification_status: "Manually Confirmed",
  });
  assert.equal(state.kind, "Project Context");
  assert.equal(state.recommendedAction, "Start project context extraction");
});

test("7. Unknown: no extraction CTA", () => {
  const state = documentDownstreamState({
    predicted_type: "Unknown",
    document_type: "BOQ",
    classification_status: "Needs Review",
  });
  assert.equal(state.recommendedAction, "Review type");
  for (const forbidden of [
    "Start BOQ extraction",
    "Start specification extraction",
    "Start project context extraction",
    "Start supplier quote extraction",
    "Open drawing workspace",
  ]) {
    assert.notEqual(state.recommendedAction, forbidden);
  }
});

test("8. Supplier Quotation follows the same human-confirmation gate as the other types", () => {
  const unconfirmed = documentDownstreamState({
    predicted_type: "Supplier Quotation",
    classification_status: "Classified",
    classification_id: "c1",
    manual_review_required: 0,
  });
  assert.equal(unconfirmed.recommendedAction, "Review type");
  assert.notEqual(unconfirmed.recommendedAction, "Start supplier quote extraction");

  const confirmed = documentDownstreamState({
    predicted_type: "Supplier Quotation",
    classification_status: "Manually Confirmed",
  });
  assert.equal(confirmed.recommendedAction, "Start supplier quote extraction");
});

test("9. a stale document_type mirror cannot surface any wrong downstream CTA, for any real current type", () => {
  for (const [predictedType, expectedKind] of [
    ["Drawing", "Drawing"],
    ["Technical Specification", "Specification"],
    ["Supplier Quotation", "Supplier Quote"],
    ["Project Context", "Project Context"],
  ]) {
    const confirmed = documentDownstreamState({
      predicted_type: predictedType,
      document_type: "BOQ", // stale mirror, disagreeing with the real type
      classification_status: "Manually Confirmed",
    });
    assert.equal(confirmed.kind, expectedKind);
    assert.notEqual(confirmed.recommendedAction, "Start BOQ extraction");

    const unconfirmed = documentDownstreamState({
      predicted_type: predictedType,
      document_type: "BOQ",
      classification_status: "Classified",
      classification_id: "c1",
      manual_review_required: 0,
    });
    assert.equal(unconfirmed.recommendedAction, "Review type");
  }
});

test("10a. app/page.tsx's extraction-start CTAs derive from downstream_state.recommendedAction, not an independently-computed predicted_type check -- so the CTA and the Next action text share one source and can never contradict", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  // The two previously-buggy CTAs no longer gate on predicted_type alone.
  assert.doesNotMatch(
    page,
    /\{document\.predicted_type === "BOQ" &&\s*\n\s*!document\.boq_extraction_id/,
    "the BOQ start CTA must no longer be an independently-computed condition",
  );
  assert.doesNotMatch(
    page,
    /\{document\.predicted_type === "Technical Specification" &&\s*\n\s*!document\.specification_extraction_id/,
    "the Specification start CTA must no longer be an independently-computed condition",
  );

  // All four extraction/workspace CTAs now key off the shared downstream_state.
  assert.match(page, /downstreamState\?\.recommendedAction ===\s*\n?\s*"Start BOQ extraction"/);
  assert.match(page, /downstreamState\?\.recommendedAction ===\s*\n?\s*"Start specification extraction"/);
  assert.match(page, /downstreamState\?\.recommendedAction ===\s*\n?\s*"Start supplier quote extraction"/);
  // CTA Authority Fix round 3 (2026-09-09): kind is NOT confirmation-aware
  // (documentDownstreamState's unconfirmed early return also sets
  // `kind: type || null`), so kind === "Drawing" let an unconfirmed
  // Drawing proposal still show the workspace button -- a real live
  // defect. workspace IS confirmation-aware (null until confirmed; see
  // tests/document-cta-drawing-project-context.test.mjs for the full
  // proof), so the gate now uses that field instead.
  assert.match(page, /downstreamState\?\.workspace === "Drawing"/);
});

test("10b. every recommendedAction string the CTAs key on is one documentDownstreamState actually produces -- proves the two can never diverge by construction", async () => {
  const engineSource = await readFile(new URL("../app/domain/document-downstream-state.mjs", import.meta.url), "utf8");
  for (const action of [
    "Start BOQ extraction",
    "Start specification extraction",
    "Start supplier quote extraction",
  ]) {
    assert.match(engineSource, new RegExp(`recommendedAction: "${action}"`), `${action} must be a real recommendedAction the engine produces`);
  }
  assert.match(engineSource, /kind: "Drawing"/);
});
