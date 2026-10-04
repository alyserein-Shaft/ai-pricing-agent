import test from "node:test";
import assert from "node:assert/strict";
import { documentDownstreamState } from "../app/domain/document-downstream-state.mjs";

// Documents Workspace Truth Fix (2026-09-06): fixtures below that test
// pipeline/extraction/review computation (not the confirmation gate
// itself) now use classification_status: "Manually Confirmed" instead of
// the classifier's own automatic "Classified" status. "Classified" is not
// human confirmation -- classificationConfirmed() in
// document-downstream-state.mjs was previously (incorrectly) accepting it,
// which meant an automatically-classified-but-never-reviewed document
// could be recommended straight into "Start X extraction" instead of
// "Review type" first. Matches the single governed definition already
// established in app/lib/document-status-presentation.mjs.

test("unconfirmed classification is a classification action, not downstream processing", () => {
  assert.deepEqual(
    documentDownstreamState({
      document_type: "Drawing",
      classification_id: "c1",
      classification_status: "Needs Review",
      manual_review_required: 1,
    }),
    {
      kind: "Drawing",
      pipelineStatus: "Not Started",
      reviewStatus: "Not Applicable",
      totalCount: 0,
      pendingCount: 0,
      approvedCount: 0,
      autoVerifiedCount: 0,
      humanApprovedCount: 0,
      readyForDownstream: false,
      workspace: null,
      recommendedAction: "Review type",
    },
  );
});

test("confirmed drawing with no intake is truthfully Not Started", () => {
  const state = documentDownstreamState({
    document_type: "Drawing",
    classification_id: "c1",
    classification_status: "Manually Confirmed",
    manual_review_required: 0,
  });

  assert.equal(state.pipelineStatus, "Not Started");
  assert.equal(state.reviewStatus, "Not Applicable");
  assert.equal(state.recommendedAction, "Open drawing workspace");
});

test("completed drawing intake with review pending is not downstream-ready", () => {
  const state = documentDownstreamState({
    document_type: "Drawing",
    classification_id: "c1",
    classification_status: "Manually Confirmed",
    manual_review_required: 0,
    drawing_intake_id: "di1",
    drawing_intake_status: "Completed",
    drawing_intake_review_status: "Needs Review",
  });

  assert.equal(state.pipelineStatus, "Completed");
  assert.equal(state.reviewStatus, "Needs Review");
  assert.equal(state.readyForDownstream, false);
  assert.equal(state.recommendedAction, "Review drawing analysis");
});

test("BOQ state separates extraction completion from row review", () => {
  const state = documentDownstreamState({
    document_type: "BOQ",
    classification_id: "c1",
    classification_status: "Manually Confirmed",
    manual_review_required: 0,
    boq_extraction_id: "bx1",
    boq_extraction_status: "Completed",
    boq_item_count: 12,
    boq_items_pending: 12,
    boq_items_approved: 0,
  });

  assert.equal(state.pipelineStatus, "Completed");
  assert.equal(state.reviewStatus, "Needs Review");
  assert.equal(state.pendingCount, 12);
  assert.equal(state.readyForDownstream, false);
  assert.equal(state.recommendedAction, "Review extracted rows");
});

test("running specification job remains Processing regardless of extracted count", () => {
  const state = documentDownstreamState({
    document_type: "Technical Specification",
    classification_id: "c1",
    classification_status: "Manually Confirmed",
    manual_review_required: 0,
    specification_extraction_id: "sx1",
    specification_extraction_status: "Processing",
    specification_job_status: "Processing",
    specification_requirement_count: 645,
    specification_requirements_pending: 645,
    specification_requirements_approved: 0,
  });

  assert.equal(state.pipelineStatus, "Processing");
  assert.equal(state.reviewStatus, "Needs Review");
  assert.equal(state.readyForDownstream, false);
});

test("fully reviewed BOQ can become downstream-ready", () => {
  const state = documentDownstreamState({
    document_type: "BOQ",
    classification_id: "c1",
    classification_status: "Manually Confirmed",
    manual_review_required: 0,
    boq_extraction_id: "bx1",
    boq_extraction_status: "Completed",
    boq_item_count: 12,
    boq_items_pending: 0,
    boq_items_approved: 12,
  });

  assert.equal(state.pipelineStatus, "Completed");
  assert.equal(state.reviewStatus, "Reviewed");
  assert.equal(state.readyForDownstream, true);
});


test("BOQ Needs Review is terminal extraction with separate review work", () => {
  const state = documentDownstreamState({
    document_type: "BOQ",
    classification_id: "c1",
    classification_status: "Manually Confirmed",
    manual_review_required: 0,
    boq_extraction_id: "bx1",
    boq_extraction_status: "Needs Review",
    boq_item_count: 17,
    boq_items_pending: 17,
    boq_items_approved: 0,
  });

  assert.equal(state.pipelineStatus, "Completed");
  assert.equal(state.reviewStatus, "Needs Review");
  assert.equal(state.pendingCount, 17);
  assert.equal(state.readyForDownstream, false);
});

test("Specification Needs Review is terminal extraction with separate requirement review", () => {
  const state = documentDownstreamState({
    document_type: "Technical Specification",
    classification_id: "c1",
    classification_status: "Manually Confirmed",
    manual_review_required: 0,
    specification_extraction_id: "sx1",
    specification_extraction_status: "Needs Review",
    specification_requirement_count: 645,
    specification_requirements_pending: 631,
    specification_requirements_approved: 14,
  });

  assert.equal(state.pipelineStatus, "Completed");
  assert.equal(state.reviewStatus, "Partially Reviewed");
  assert.equal(state.pendingCount, 631);
  assert.equal(state.readyForDownstream, false);
});


test("Supplier Quote downstream routes to Price Sources", () => {
  const notStarted = documentDownstreamState({
    document_type: "Supplier Quotation",
    classification_status: "Manually Confirmed",
    manual_review_required: 0,
  });

  assert.equal(notStarted.kind, "Supplier Quote");
  assert.equal(notStarted.workspace, "Price Sources");
  assert.equal(notStarted.pipelineStatus, "Not Started");

  const review = documentDownstreamState({
    document_type: "Supplier Quotation",
    classification_status: "Manually Confirmed",
    manual_review_required: 0,
    supplier_quote_intake_id: "sqi-1",
    supplier_quote_intake_status: "NEEDS REVIEW",
    supplier_quote_line_count: 3,
    supplier_quote_lines_pending: 1,
    supplier_quote_lines_approved: 1,
  });

  assert.equal(review.workspace, "Price Sources");
  assert.equal(review.pipelineStatus, "Completed");
  assert.equal(review.reviewStatus, "Partially Reviewed");
  assert.equal(review.recommendedAction, "Review supplier quote");
});
