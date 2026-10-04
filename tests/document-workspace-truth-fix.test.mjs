import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { documentTypePanels } from "../app/lib/document-status-presentation.mjs";
import { documentDownstreamState } from "../app/domain/document-downstream-state.mjs";

// Documents Workspace Truth Fix (2026-09-06). Two live bugs found after the
// duplicate-classification fix:
//
// 1. The DRAWING badge/type identity (documentTypePanels.isDrawingDocument)
//    also matched DRAWING_CLASSIFICATIONS.includes(type) -- a PAGE-level
//    structural taxonomy for classifying pages WITHIN an already-known
//    drawing PDF, which legitimately includes "Unknown" for a page whose
//    structural type can't be determined. Reused for DOCUMENT-level type
//    identity, that meant any document whose real classification was the
//    string "Unknown" (a correct, common outcome) got a false DRAWING
//    badge. Fixed: document-level Drawing identity now matches only the
//    literal type "Drawing". DRAWING_CLASSIFICATIONS itself (with
//    "Unknown" intact) is untouched -- it still exists for its real,
//    tested, page-level purpose.
//
// 2. app/domain/document-downstream-state.mjs's normalizedType() checked
//    document.document_type (the stale compatibility mirror) BEFORE
//    document.predicted_type (the real governed classification) -- backwards
//    from the governed-first rule established everywhere else. A document
//    whose stale mirror said "BOQ" but whose real current classification
//    was "Project Context" had its "next action" computed as if it were a
//    BOQ ("Start BOQ extraction"). Separately, classificationConfirmed()
//    accepted the classifier's own automatic "Classified"/"Verified"
//    statuses as if they were human confirmation, which would have masked
//    the fix (the NPQ document's real classification_status is "Classified",
//    never "Manually Confirmed" -- it should show "Review type", not jump
//    straight to an extraction action). Both are fixed in tandem.

const staleBoqMirror = (predictedType, extra = {}) => ({
  document_type: "BOQ",
  classification_source: "Manual Override",
  predicted_type: predictedType,
  classification_status: "Classified",
  classification_confidence: 98,
  classification_id: "c1",
  manual_review_required: 0,
  ...extra,
});

// ---------------------------------------------------------------------------
// A. current Unknown + stale BOQ mirror (RE_/FW_ ...ELV Systems.msg)
// ---------------------------------------------------------------------------

test("A. current Unknown + stale BOQ mirror: classification shows Unknown, header badge does NOT say Drawing, route is Manual Classification, next action is Review/Select type", () => {
  const document = staleBoqMirror("Unknown");

  const panels = documentTypePanels(document);
  assert.equal(panels.isDrawingDocument, false, "Unknown must never render a Drawing badge");
  assert.equal(panels.isBoqDocument, false, "the stale BOQ mirror must not win either");

  const state = documentDownstreamState(document);
  assert.equal(state.recommendedAction, "Review type", "an unconfirmed classification always routes to type review/selection, regardless of what type it is");
});

// ---------------------------------------------------------------------------
// B. current Project Context + stale BOQ mirror (the NPQ xlsx)
// ---------------------------------------------------------------------------

test("B. current Project Context + stale BOQ mirror: header/category reflects Project Context, route is Project Context, next action never says Start BOQ extraction", () => {
  const document = staleBoqMirror("Project Context");

  const panels = documentTypePanels(document);
  assert.equal(panels.isBoqDocument, false, "the stale BOQ mirror must not route this document as BOQ");

  const state = documentDownstreamState(document);
  assert.notEqual(state.recommendedAction, "Start BOQ extraction");
  assert.equal(state.kind, "Project Context");
  // Not yet human-confirmed (classification_status is the classifier's own
  // "Classified", not "Manually Confirmed") -- correctly asks for
  // confirmation first, exactly like every other unconfirmed type.
  assert.equal(state.recommendedAction, "Review type");

  // Once genuinely human-confirmed, the real Project Context action appears
  // -- never BOQ.
  const confirmed = documentDownstreamState({
    ...document,
    classification_status: "Manually Confirmed",
  });
  assert.equal(confirmed.kind, "Project Context");
  assert.equal(confirmed.workspace, "Project Context");
  assert.equal(confirmed.recommendedAction, "Start project context extraction");
  assert.notEqual(confirmed.recommendedAction, "Start BOQ extraction");
});

// ---------------------------------------------------------------------------
// C. current Drawing: badge/type remains correct
// ---------------------------------------------------------------------------

test("C. current Drawing: the Drawing badge/type remains correct (this fix does not regress the real case)", () => {
  const document = { predicted_type: "Drawing", document_type: "Drawing" };
  const panels = documentTypePanels(document);
  assert.equal(panels.isDrawingDocument, true);
  assert.equal(panels.isBoqDocument, false);
});

// ---------------------------------------------------------------------------
// D. confirmed BOQ: Start BOQ extraction remains available when appropriate
// ---------------------------------------------------------------------------

test("D. confirmed BOQ with no extraction yet: Start BOQ extraction remains available", () => {
  const document = {
    predicted_type: "BOQ",
    document_type: "BOQ",
    classification_status: "Manually Confirmed",
  };
  const panels = documentTypePanels(document);
  assert.equal(panels.isBoqDocument, true);

  const state = documentDownstreamState(document);
  assert.equal(state.kind, "BOQ");
  assert.equal(state.recommendedAction, "Start BOQ extraction");
});

// ---------------------------------------------------------------------------
// E. Technical Specification: BOQ action is never shown
// ---------------------------------------------------------------------------

test("E. confirmed Technical Specification: BOQ action is never shown, even with a stale BOQ mirror", () => {
  const document = staleBoqMirror("Technical Specification", {
    classification_status: "Manually Confirmed",
  });
  const panels = documentTypePanels(document);
  assert.equal(panels.isBoqDocument, false);
  assert.equal(panels.isSpecificationDocument, true);

  const state = documentDownstreamState(document);
  assert.equal(state.kind, "Specification");
  assert.notEqual(state.recommendedAction, "Start BOQ extraction");
  assert.equal(state.recommendedAction, "Start specification extraction");
});

// ---------------------------------------------------------------------------
// F. all visible type/action derivation ignores the stale mirror whenever a
// governed classification exists
// ---------------------------------------------------------------------------

test("F. type/action derivation is governed-first for every type, not just the two reported cases", () => {
  for (const [predictedType, expectedKind] of [
    ["Drawing", "Drawing"],
    ["Technical Specification", "Specification"],
    ["Supplier Quotation", "Supplier Quote"],
    ["Project Context", "Project Context"],
  ]) {
    const document = staleBoqMirror(predictedType, {
      classification_status: "Manually Confirmed",
    });
    const state = documentDownstreamState(document);
    assert.equal(state.kind, expectedKind, `predicted_type ${predictedType} must win over the stale BOQ mirror`);
    assert.notEqual(state.recommendedAction, "Start BOQ extraction", `${predictedType} must never suggest starting BOQ extraction`);
  }
});

test("F. document-downstream-state.mjs reads predicted_type before document_type -- source proof of the fix, not just its effect", async () => {
  const source = await readFile(new URL("../app/domain/document-downstream-state.mjs", import.meta.url), "utf8");
  const normalizedTypeFn = source.slice(source.indexOf("const normalizedType"), source.indexOf("const classificationConfirmed"));
  const predictedIndex = normalizedTypeFn.indexOf("document.predicted_type");
  const mirrorIndex = normalizedTypeFn.indexOf("document.document_type");
  assert.ok(predictedIndex >= 0 && mirrorIndex >= 0);
  assert.ok(predictedIndex < mirrorIndex, "predicted_type (governed) must be checked before document_type (mirror)");
  assert.match(source, /document\.classification_status === "Manually Confirmed"/, "only a real human confirmation may satisfy classificationConfirmed");
  assert.doesNotMatch(source, /"Classified", "Confirmed", "Manually Confirmed", "Verified"/, "the classifier's own automatic statuses must not count as confirmed");
});
