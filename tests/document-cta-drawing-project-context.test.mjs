import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { documentDownstreamState } from "../app/domain/document-downstream-state.mjs";

// CTA Authority Fix, round 3 (2026-09-09). Two live defects:
//
// 1. Unconfirmed Drawing still showed an executable "Open drawing
//    workspace" button. Root cause: the prior fix keyed the button on
//    `downstreamState.kind === "Drawing"`, but `kind` is NOT
//    confirmation-aware -- documentDownstreamState's UNCONFIRMED early
//    return also sets `kind: type || null` (kind describes the detected
//    type regardless of confirmation). `workspace` IS confirmation-aware:
//    baseState() defaults it to null, and every type branch only sets
//    `workspace: "Drawing"` inside the `type === "Drawing"` branch, which
//    is only reached once classificationConfirmed(document) is true.
//
// 2. A confirmed Project Context document with
//    downstream_state.recommendedAction === "Start project context
//    extraction" had NO executable CTA at all -- the governed backend
//    route (POST /api/projects/:id/project-context/extract, verified to
//    require classification_status === "Manually Confirmed", the same
//    gate every other type enforces) existed but was never called from
//    the Documents workspace card.

const confirmedType = (predictedType, extra = {}) => ({
  predicted_type: predictedType,
  classification_status: "Manually Confirmed",
  ...extra,
});

const unconfirmedType = (predictedType, mirrorType, extra = {}) => ({
  predicted_type: predictedType,
  document_type: mirrorType,
  classification_status: "Classified", // automatic, never human-confirmed
  classification_id: "c1",
  manual_review_required: 0,
  ...extra,
});

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

test("unconfirmed Drawing: workspace stays null -- no Open drawing workspace CTA, even though kind still reports Drawing", () => {
  const document = unconfirmedType("Drawing", "Drawing");
  const state = documentDownstreamState(document);
  assert.equal(state.kind, "Drawing", "kind still reports the detected type -- this is expected, and exactly why kind alone was the wrong gate");
  assert.equal(state.workspace, null, "workspace must stay null until confirmed -- this is the field the CTA must key on");
  assert.equal(state.recommendedAction, "Review type");
});

test("confirmed Drawing, no intake yet: workspace is Drawing, CTA available", () => {
  const state = documentDownstreamState(confirmedType("Drawing"));
  assert.equal(state.workspace, "Drawing");
  assert.equal(state.recommendedAction, "Open drawing workspace");
});

test("confirmed Drawing with completed-but-needs-review intake: workspace remains Drawing (CTA available), recommendedAction reflects the real sub-state", () => {
  const state = documentDownstreamState(
    confirmedType("Drawing", {
      drawing_intake_id: "di1",
      drawing_intake_status: "Completed",
      drawing_intake_review_status: "Needs Review",
    }),
  );
  assert.equal(state.workspace, "Drawing");
  assert.equal(state.recommendedAction, "Review drawing analysis");
});

// ---------------------------------------------------------------------------
// Project Context
// ---------------------------------------------------------------------------

test("unconfirmed Project Context: no extraction CTA", () => {
  const document = unconfirmedType("Project Context", "BOQ"); // stale mirror, must be ignored
  const state = documentDownstreamState(document);
  assert.equal(state.recommendedAction, "Review type");
  assert.notEqual(state.recommendedAction, "Start project context extraction");
});

test("confirmed Project Context, no extraction yet: Start project context extraction CTA exists", () => {
  const state = documentDownstreamState(confirmedType("Project Context"));
  assert.equal(state.kind, "Project Context");
  assert.equal(state.workspace, "Project Context");
  assert.equal(state.recommendedAction, "Start project context extraction");
});

test("completed Project Context extraction: correct post-extraction state, no false Start action", () => {
  const state = documentDownstreamState(
    confirmedType("Project Context", {
      project_context_extraction_id: "pcx1",
      project_context_extraction_status: "Completed",
      project_context_fact_count: 18,
      project_context_facts_pending: 0,
      project_context_facts_reviewed: 18,
    }),
  );
  assert.notEqual(state.recommendedAction, "Start project context extraction");
  assert.equal(state.recommendedAction, "Open project context");
  assert.equal(state.readyForDownstream, true);
});

test("completed Project Context extraction with pending facts: Review, not a false Start action", () => {
  const state = documentDownstreamState(
    confirmedType("Project Context", {
      project_context_extraction_id: "pcx1",
      project_context_extraction_status: "Completed",
      project_context_fact_count: 18,
      project_context_facts_pending: 4,
      project_context_facts_reviewed: 14,
    }),
  );
  assert.notEqual(state.recommendedAction, "Start project context extraction");
  assert.equal(state.recommendedAction, "Review project context");
});

// ---------------------------------------------------------------------------
// Alignment sweep across all 5 types
// ---------------------------------------------------------------------------

test("recommendedAction and the CTA it should authorize remain aligned across BOQ / Technical Specification / Supplier Quotation / Project Context / Drawing", () => {
  const cases = [
    ["BOQ", "Start BOQ extraction"],
    ["Technical Specification", "Start specification extraction"],
    ["Supplier Quotation", "Start supplier quote extraction"],
    ["Project Context", "Start project context extraction"],
  ];
  for (const [predictedType, expectedAction] of cases) {
    const confirmed = documentDownstreamState(confirmedType(predictedType));
    assert.equal(confirmed.recommendedAction, expectedAction, `${predictedType} confirmed with no extraction must recommend "${expectedAction}"`);

    const unconfirmed = documentDownstreamState(unconfirmedType(predictedType, "BOQ"));
    assert.equal(unconfirmed.recommendedAction, "Review type", `${predictedType} unconfirmed must recommend "Review type", never "${expectedAction}"`);
  }

  // Drawing uses `workspace`, not a literal "Start" recommendedAction string.
  const drawingConfirmed = documentDownstreamState(confirmedType("Drawing"));
  assert.equal(drawingConfirmed.workspace, "Drawing");
  const drawingUnconfirmed = documentDownstreamState(unconfirmedType("Drawing", "BOQ"));
  assert.equal(drawingUnconfirmed.workspace, null);
});

// ---------------------------------------------------------------------------
// Stale mirror safety
// ---------------------------------------------------------------------------

test("stale documents.document_type cannot create any CTA -- for every real current type", () => {
  const expectedKind = {
    Drawing: "Drawing",
    BOQ: "BOQ",
    "Technical Specification": "Specification",
    "Supplier Quotation": "Supplier Quote",
    "Project Context": "Project Context",
    Unknown: "Unknown",
  };
  for (const predictedType of Object.keys(expectedKind)) {
    for (const staleMirror of ["BOQ", "Drawing", "Technical Specification"]) {
      if (staleMirror === predictedType) continue;
      const confirmed = documentDownstreamState({
        predicted_type: predictedType,
        document_type: staleMirror,
        classification_status: "Manually Confirmed",
      });
      assert.equal(confirmed.kind, expectedKind[predictedType], `predicted_type ${predictedType} with stale mirror ${staleMirror} must resolve kind from the governed type only`);
      if (predictedType === "Drawing") {
        assert.equal(confirmed.workspace, "Drawing");
      }
      if (staleMirror !== predictedType) {
        assert.notEqual(confirmed.recommendedAction, `Start ${staleMirror} extraction`, "the stale mirror's type must never be the recommended action");
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Source-level proof: the two CTAs are actually wired to the shared state
// ---------------------------------------------------------------------------

test("app/page.tsx: the Drawing and Project Context CTAs derive from document.downstream_state, not an independent condition", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /downstreamState\?\.workspace === "Drawing" && \(/);
  assert.doesNotMatch(page, /downstreamState\?\.kind === "Drawing"/, "the confirmation-unsafe kind-based gate must be fully removed");

  assert.match(
    page,
    /downstreamState\?\.recommendedAction ===\s*\n?\s*"Start project context extraction" && \(/,
  );
  assert.match(page, /void projectContextExtractionCommand\(document\)/);
  assert.match(
    page,
    /\/api\/projects\/\$\{encodeURIComponent\(projectId\)\}\/project-context\/extract/,
  );
});

test("worker/project-context-api.mjs: the extract route requires Manually Confirmed classification, matching every other extraction route", async () => {
  const source = await readFile(new URL("../worker/project-context-api.mjs", import.meta.url), "utf8");
  assert.match(source, /classification\.status !== "Manually Confirmed"/);
  assert.match(source, /PROJECT_CONTEXT_CLASSIFICATION_REQUIRED/);
});
