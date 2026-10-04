import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  documentContentUnsupported,
  documentUnsupportedPresentation,
} from "../app/lib/document-status-presentation.mjs";
import { documentDownstreamState } from "../app/domain/document-downstream-state.mjs";
import { derivePresalesWorkflow } from "../app/domain/presales-workflow-engine.mjs";

// Documents Workspace Closure Sprint (2026-09-14). Documents is intake +
// routing + processing status only: upload -> classify -> identify
// unsupported/unreadable files -> confirm type where required -> launch the
// correct downstream processor -> show whether that processor produced
// evidence. It must never make a user think all downstream engineering
// review (BOQ rows, requirements, drawing analysis) has to finish inside
// Documents -- that belongs to BOQ, Requirements, and the Drawing
// workspace respectively.

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// 1-3: unsupported/unreadable content (e.g. Outlook .msg) is a distinct,
// truthful state, never ordinary "needs type confirmation" work.
// ---------------------------------------------------------------------------

test("1. unreadable .msg is NOT counted as ordinary type-confirmation work", () => {
  const msgDocument = {
    predicted_type: "Unknown",
    classification_status: "Needs Review",
    classification_error_code: "UNREADABLE_CONTENT",
    logical_name: "RE_ Central Kitchen Project- ELV Systems.msg",
  };
  assert.equal(documentContentUnsupported(msgDocument), true);

  // The Documents page's own type-confirmation bucket must explicitly
  // exclude documentContentUnsupported(document) -- see
  // classificationReviewDocuments in app/page.tsx.
  const filterSite = page.slice(
    page.indexOf("const classificationReviewDocuments = managedDocuments.filter("),
    page.indexOf("const classificationReviewDocuments = managedDocuments.filter(") + 400,
  );
  assert.match(filterSite, /!documentContentUnsupported\(document\)/);
});

test("2. unreadable .msg presentation says unsupported/unreadable", () => {
  const presentation = documentUnsupportedPresentation({
    extension: "msg",
    logical_name: "FW_ Central Kitchen Project- ELV Systems.msg",
    classification_error_code: "UNREADABLE_CONTENT",
  });
  assert.equal(presentation.unsupported, true);
  assert.match(presentation.label, /unsupported/i);
  assert.match(presentation.label, /unreadable/i);
  assert.match(presentation.primaryMessage, /cannot be read/i);
  assert.match(presentation.secondaryMessage, /Outlook MSG/i);
  assert.match(presentation.secondaryMessage, /converter|parser/i);
});

test("3. unreadable file presentation does not imply manual type confirmation will make content readable", () => {
  const presentation = documentUnsupportedPresentation({
    extension: "msg",
    logical_name: "x.msg",
    classification_error_code: "UNREADABLE_CONTENT",
  });
  // The primary/secondary truthful messages must never suggest picking a
  // type is the fix.
  assert.doesNotMatch(presentation.primaryMessage, /confirm|choose|select.*type/i);
  assert.doesNotMatch(presentation.secondaryMessage, /confirm|choose|select.*type/i);

  // "Confirm type" (the quick agree-with-AI action) must never render for
  // an Unknown-type document -- there is no real suggested type to agree
  // with, readable or not.
  const confirmButtonSite = page.slice(
    page.indexOf('"Confirm type" is the quick "I agree with the AI'),
    page.indexOf('"Confirm type" is the quick "I agree with the AI') + 900,
  );
  assert.match(confirmButtonSite, /document\.predicted_type &&/);
  assert.match(confirmButtonSite, /document\.predicted_type !== "Unknown"/);
});

// ---------------------------------------------------------------------------
// 4: R002/R003-style Drawing proposals remain genuine confirmation tasks.
// ---------------------------------------------------------------------------

test("4. a detected-but-unconfirmed Drawing proposal (e.g. R002/R003) remains a genuine confirmation task, distinct from unsupported content", () => {
  const drawingProposal = {
    predicted_type: "Drawing",
    classification_status: "Needs Review",
    classification_id: "c1",
  };
  assert.equal(documentContentUnsupported(drawingProposal), false);
  const state = documentDownstreamState(drawingProposal);
  assert.equal(state.recommendedAction, "Review type");
  assert.equal(state.workspace, null, "no Drawing workspace CTA before confirmation");
});

// ---------------------------------------------------------------------------
// 5-7: Documents intake completion is not blocked by downstream review
// backlogs (drawing review, BOQ row review, requirement review).
// ---------------------------------------------------------------------------

const baseProject = { id: "p1", name: "TesT", organizationId: "org1", systemDomain: "Fire Alarm" };

test("5. a confirmed Drawing with completed analysis awaiting review does not block Documents intake completion", () => {
  const workflow = derivePresalesWorkflow({
    project: baseProject,
    facts: { documents: 1, classified: 1, processing: 0, failedJobs: 0 },
  });
  const intake = workflow.stages.find((stage) => stage.id === "intake");
  assert.equal(intake.status, "Completed");
  assert.deepEqual(intake.blockers, []);
});

test("6. completed BOQ extraction with pending BOQ row review does not block Documents intake completion", () => {
  const workflow = derivePresalesWorkflow({
    project: baseProject,
    facts: {
      documents: 1,
      classified: 1,
      processing: 0,
      failedJobs: 0,
      boqItems: 46,
      extractionReview: 44,
    },
  });
  const intake = workflow.stages.find((stage) => stage.id === "intake");
  assert.equal(intake.status, "Completed", "intake completion must not depend on BOQ row review count");
  assert.deepEqual(intake.blockers, []);
});

test("7. completed specification extraction with pending requirement review does not block Documents intake completion", () => {
  const workflow = derivePresalesWorkflow({
    project: baseProject,
    facts: {
      documents: 1,
      classified: 1,
      processing: 0,
      failedJobs: 0,
      specificationExtractions: 1,
      requirementReview: 2623,
    },
  });
  const intake = workflow.stages.find((stage) => stage.id === "intake");
  assert.equal(intake.status, "Completed", "intake completion must not depend on requirement review count");
  assert.deepEqual(intake.blockers, []);
});

// ---------------------------------------------------------------------------
// 8: Auto Verified BOQ rows display truthfully.
// ---------------------------------------------------------------------------

test("8. Auto Verified BOQ rows display truthfully -- separate from, and never labeled as, Human Approved", () => {
  const state = documentDownstreamState({
    document_type: "BOQ",
    classification_id: "c1",
    classification_status: "Manually Confirmed",
    manual_review_required: 0,
    boq_extraction_id: "bx1",
    boq_extraction_status: "Completed",
    boq_item_count: 46,
    boq_items_pending: 2,
    boq_items_approved: 46, // 44 auto-verified + 2 human-approved, downstream-ready either way
    boq_items_auto_verified: 44,
  });
  assert.equal(state.autoVerifiedCount, 44);
  assert.equal(state.humanApprovedCount, 2);
  assert.equal(state.approvedCount, 46, "the combined downstream-ready total is preserved for existing consumers");

  // The frontend must never render autoVerifiedCount under a "Human
  // Approved" label.
  const reviewLineSite = page.slice(
    page.indexOf("downstreamState.autoVerifiedCount"),
    page.indexOf("downstreamState.autoVerifiedCount") + 900,
  );
  assert.match(reviewLineSite, /auto-verified/);
  assert.match(reviewLineSite, /human approved/i);
  // The auto-verified figure itself is never wrapped in "human approved" text.
  assert.doesNotMatch(reviewLineSite, /\$\{downstreamState\.autoVerifiedCount\}[^`]*human approved/i);
});

// ---------------------------------------------------------------------------
// 9-10: Project Context CTA correctness.
// ---------------------------------------------------------------------------

test("9. a confirmed Project Context document with no extraction yet produces the Start extraction CTA", () => {
  const state = documentDownstreamState({
    predicted_type: "Project Context",
    classification_status: "Manually Confirmed",
  });
  assert.equal(state.recommendedAction, "Start project context extraction");
  assert.equal(state.workspace, "Project Context");
});

test("10. a processed Project Context routes review downstream, to the real Project Context workspace, not an in-Documents review", () => {
  const state = documentDownstreamState({
    predicted_type: "Project Context",
    classification_status: "Manually Confirmed",
    project_context_extraction_id: "pcx1",
    project_context_extraction_status: "Completed",
    project_context_fact_count: 40,
    project_context_facts_pending: 0,
    project_context_facts_reviewed: 40,
  });
  assert.equal(state.recommendedAction, "Open project context");
  assert.equal(state.workspace, "Project Context");
  assert.equal(state.readyForDownstream, true);

  // The card's CTA for an existing Project Context extraction navigates to
  // the real workspace module -- it does not open an in-Documents-page
  // review surface.
  const ctaSite = page.slice(
    page.indexOf("Boolean(document.project_context_extraction_id)"),
    page.indexOf("Boolean(document.project_context_extraction_id)") + 300,
  );
  assert.match(ctaSite, /navigate\("Project Context"\)/);
});

// ---------------------------------------------------------------------------
// 11: top summary distinguishes needs-type-confirmation / unsupported /
// processing-failure.
// ---------------------------------------------------------------------------

test("11. the top summary distinguishes needs type confirmation, unsupported files, and processing failure as three separate truthful signals", () => {
  const component = readFileSync(
    new URL("../app/components/workspaces/DocumentsWorkspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(component, /need\s*\{reviewCount === 1 \? "s" : ""\} type confirmation/);
  assert.match(component, /unsupported in this build/);
  assert.match(component, /failed\s+processing/);
  // Three independent conditions, not one combined count.
  assert.match(component, /reviewCount > 0 &&/);
  assert.match(component, /unsupportedCount > 0 &&/);
  assert.match(component, /failedCount > 0 &&/);
});

// ---------------------------------------------------------------------------
// 12: unsupported files do not prevent Documents-page progression.
// ---------------------------------------------------------------------------

test("12. unsupported files do not prevent Documents-page intake completion (no existing governance rule requires fixing them first)", () => {
  const component = readFileSync(
    new URL("../app/components/workspaces/DocumentsWorkspace.tsx", import.meta.url),
    "utf8",
  );
  const intakeCompleteLine = component.match(/const intakeComplete = ([^;]+);/)?.[1] || "";
  assert.ok(intakeCompleteLine, "expected an intakeComplete computation");
  assert.doesNotMatch(intakeCompleteLine, /unsupportedCount/, "intake completion must not depend on unsupportedCount");
});

// ---------------------------------------------------------------------------
// 13-14: no duplicate status presentation, one truthful primary next action.
// ---------------------------------------------------------------------------

test("13. no duplicate current classification/status presentation for an unsupported document -- the generic classification-summary block and the unsupported-file block are mutually exclusive", () => {
  const genericBlockSite = page.slice(
    page.indexOf('!isSupplierQuoteDocument && unsupportedPresentation && (\n                    <div className="classification-summary unsupported-file-summary">'),
    page.indexOf('!isSupplierQuoteDocument && !unsupportedPresentation && (\n                    <div className="classification-summary">') + 200,
  );
  assert.match(genericBlockSite, /unsupportedPresentation && \(/);
  assert.match(genericBlockSite, /!unsupportedPresentation && \(/);
});

test("14. each Documents card exposes exactly one truthful primary next-action line", () => {
  const occurrences = [...page.matchAll(/Next action: \{managedDocumentNextAction\(document\)\}/g)];
  assert.equal(occurrences.length, 1, "expected exactly one \"Next action\" line per document card template");
});
