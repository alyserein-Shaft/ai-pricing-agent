const numberOrZero = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

// Documents Workspace Truth Fix (2026-09-06): this used to check
// document.document_type (the compatibility mirror) BEFORE
// document.predicted_type (the governed current classification), so a
// stale mirror left over from before a document was reclassified always
// won -- e.g. a document whose stale mirror said "BOQ" but whose real
// current document_classifications proposal was "Project Context" had its
// downstream state (and therefore its "next action" text) computed as if
// it were a BOQ. Matches the governed-first rule already established in
// app/lib/document-status-presentation.mjs: the mirror is consulted only
// when no classification has ever run at all (predicted_type is
// null/undefined) -- never as an alternative to a real governed value.
import { normalizeDocumentType } from "./document-classifier.mjs";

const normalizedType = (document = {}) =>
  normalizeDocumentType(
    document.predicted_type ??
    document.document_type ??
    "",
  );

// Documents Workspace Truth Fix (2026-09-06): "Classified" and "Verified"
// are the classifier's OWN automatic statuses -- computed with zero human
// involvement on every upload/re-run -- not proof a human confirmed
// anything. Treating them as "confirmed" here meant an automatically
// (never human-reviewed) classified document could be recommended straight
// into "Start X extraction" instead of "Review type" first. Matches the
// single governed definition already established and tested in
// app/lib/document-status-presentation.mjs's
// humanConfirmedClassificationStatuses: only "Manually Confirmed" counts.
const classificationConfirmed = (document = {}) =>
  document.classification_status === "Manually Confirmed";

// Content-Readability Authority Fix (2026-09-16): classification authority
// ("what category does this document belong to") and content-readability
// authority ("can the system actually read this file's bytes") are
// deliberately independent. A human may validly, manually classify an
// unreadable file (e.g. an Outlook .msg genuinely known to be a Drawing) --
// that only means "the user says this belongs to the Drawing category," it
// never means "the system successfully read the file contents." Mirrors
// app/lib/document-status-presentation.mjs's documentContentUnsupported --
// same canonical persisted signal (classification_error_code), independent
// implementation on purpose: this file has zero imports by design, so it
// stays trivially importable from both the worker and the frontend.
// Deliberately narrow: only UNREADABLE_CONTENT is a genuine format
// limitation. OCR_REQUIRED (a real, different, still-actionable pipeline
// step) and any other classification error are NOT included -- see Task
// 2/6 of this sprint. transient/generic processing failures are a
// different axis entirely (pipelineStatus "Failed"), not modeled here.
export const contentReadableForDownstream = (document = {}) =>
  document.classification_error_code !== "UNREADABLE_CONTENT";

const baseState = ({
  kind = null,
  pipelineStatus = "Not Started",
  reviewStatus = "Not Applicable",
  totalCount = 0,
  pendingCount = 0,
  approvedCount = 0,
  // Documents Workspace Closure Sprint (2026-09-14): approvedCount stays
  // the combined "downstream-ready" total (every existing consumer --
  // aggregateReview, readyForDownstream -- already only cares whether it's
  // >0). autoVerifiedCount/humanApprovedCount split it honestly for
  // presentation ONLY where a caller wants to show the two apart; a machine
  // decision must never be labeled or counted as a human one. Only the BOQ
  // branch below can currently produce a nonzero autoVerifiedCount --
  // every other kind leaves it 0 and humanApprovedCount equal to
  // approvedCount, which is exactly correct (nothing else has an
  // Auto-Verified-equivalent state today).
  autoVerifiedCount = 0,
  humanApprovedCount = approvedCount,
  readyForDownstream = false,
  workspace = null,
  recommendedAction = null,
} = {}) => ({
  kind,
  pipelineStatus,
  reviewStatus,
  totalCount,
  pendingCount,
  approvedCount,
  autoVerifiedCount,
  humanApprovedCount,
  readyForDownstream,
  workspace,
  recommendedAction,
});

const aggregateReview = ({ total, pending, approved }) => {
  if (!total) return "Not Applicable";
  if (pending === total) return "Needs Review";
  if (pending > 0) return "Partially Reviewed";
  if (approved > 0) return "Reviewed";
  return "Not Applicable";
};

export const documentDownstreamState = (document = {}) => {
  const type = normalizedType(document);

  if (!classificationConfirmed(document)) {
    return baseState({
      kind: type || null,
      pipelineStatus: "Not Started",
      reviewStatus: "Not Applicable",
      recommendedAction: "Review type",
    });
  }

  if (type === "Drawing") {
    if (!contentReadableForDownstream(document)) {
      return baseState({
        kind: "Drawing",
        pipelineStatus: "Unavailable",
        reviewStatus: "Not Applicable",
        workspace: null,
        recommendedAction: null,
      });
    }
    if (!document.drawing_intake_id) {
      return baseState({
        kind: "Drawing",
        pipelineStatus: "Not Started",
        reviewStatus: "Not Applicable",
        workspace: "Drawing",
        recommendedAction: "Open drawing workspace",
      });
    }

    const status = String(document.drawing_intake_status || "Completed");
    const review = String(
      document.drawing_intake_review_status || "Needs Review",
    );

    return baseState({
      kind: "Drawing",
      pipelineStatus:
        ["Completed", "Needs Review"].includes(status)
          ? "Completed"
          : status === "Failed"
            ? "Failed"
            : status === "Queued"
              ? "Queued"
              : "Processing",
      reviewStatus:
        review === "Needs Review" ? "Needs Review" : "Reviewed",
      readyForDownstream:
        status === "Completed" && review !== "Needs Review",
      workspace: "Drawing",
      recommendedAction:
        status === "Failed"
          ? "Retry drawing analysis"
          : review === "Needs Review"
            ? "Review drawing analysis"
            : "Open drawing workspace",
    });
  }

  if (type === "BOQ") {
    if (!contentReadableForDownstream(document)) {
      return baseState({
        kind: "BOQ",
        pipelineStatus: "Unavailable",
        reviewStatus: "Not Applicable",
        workspace: null,
        recommendedAction: null,
      });
    }
    if (!document.boq_extraction_id) {
      return baseState({
        kind: "BOQ",
        pipelineStatus: "Not Started",
        workspace: "BOQ",
        recommendedAction: "Start BOQ extraction",
      });
    }

    const total = numberOrZero(document.boq_item_count);
    const pending = numberOrZero(document.boq_items_pending);
    const approved = numberOrZero(document.boq_items_approved);
    const autoVerified = numberOrZero(document.boq_items_auto_verified);
    const status = String(document.boq_extraction_status || "Completed");

    return baseState({
      kind: "BOQ",
      pipelineStatus:
        ["Completed", "Needs Review"].includes(status)
          ? "Completed"
          : status === "Failed"
            ? "Failed"
            : status === "Queued"
              ? "Queued"
              : "Processing",
      reviewStatus: aggregateReview({ total, pending, approved }),
      totalCount: total,
      pendingCount: pending,
      approvedCount: approved,
      autoVerifiedCount: autoVerified,
      humanApprovedCount: Math.max(0, approved - autoVerified),
      readyForDownstream:
        ["Completed", "Needs Review"].includes(status) &&
        total > 0 &&
        pending === 0 &&
        approved > 0,
      workspace: "BOQ",
      recommendedAction:
        status === "Failed"
          ? "Retry BOQ extraction"
          : pending > 0
            ? "Review extracted rows"
            : "Open BOQ workspace",
    });
  }

  if (type === "Technical Specification") {
    if (!contentReadableForDownstream(document)) {
      return baseState({
        kind: "Specification",
        pipelineStatus: "Unavailable",
        reviewStatus: "Not Applicable",
        workspace: null,
        recommendedAction: null,
      });
    }
    if (!document.specification_extraction_id) {
      return baseState({
        kind: "Specification",
        pipelineStatus: "Not Started",
        workspace: "Requirements",
        recommendedAction: "Start specification extraction",
      });
    }

    const total = numberOrZero(document.specification_requirement_count);
    const pending = numberOrZero(document.specification_requirements_pending);
    const approved = numberOrZero(document.specification_requirements_approved);
    const jobStatus = String(document.specification_job_status || "");
    const extractionStatus = String(
      document.specification_extraction_status || "",
    );

    const running = [
      "Queued",
      "Processing",
      "Running",
      "Extracting",
      "Validating",
    ].includes(jobStatus);

    const failed =
      jobStatus === "Failed" || extractionStatus === "Failed";

    const pipelineStatus = failed
      ? "Failed"
      : running
        ? jobStatus === "Queued"
          ? "Queued"
          : "Processing"
        : ["Completed", "Needs Review"].includes(extractionStatus)
          ? "Completed"
          : "Processing";

    return baseState({
      kind: "Specification",
      pipelineStatus,
      reviewStatus: aggregateReview({ total, pending, approved }),
      totalCount: total,
      pendingCount: pending,
      approvedCount: approved,
      readyForDownstream:
        pipelineStatus === "Completed" &&
        total > 0 &&
        pending === 0 &&
        approved > 0,
      workspace: "Requirements",
      recommendedAction:
        failed
          ? "Retry specification extraction"
          : running
            ? "View extraction progress"
            : pending > 0
              ? "Review requirements"
              : "Open requirements",
    });
  }

  if (type === "Project Context") {
    if (!contentReadableForDownstream(document)) {
      return baseState({
        kind: "Project Context",
        pipelineStatus: "Unavailable",
        reviewStatus: "Not Applicable",
        workspace: null,
        recommendedAction: null,
      });
    }
    if (!document.project_context_extraction_id) {
      return baseState({
        kind: "Project Context",
        pipelineStatus: "Not Started",
        workspace: "Project Context",
        recommendedAction: "Start project context extraction",
      });
    }

    const total = numberOrZero(document.project_context_fact_count);
    const pending = numberOrZero(document.project_context_facts_pending);
    const approved = numberOrZero(document.project_context_facts_reviewed);
    const status = String(
      document.project_context_extraction_status || "Completed",
    );

    return baseState({
      kind: "Project Context",
      pipelineStatus:
        status === "Completed"
          ? "Completed"
          : status === "Failed"
            ? "Failed"
            : "Processing",
      reviewStatus: aggregateReview({ total, pending, approved }),
      totalCount: total,
      pendingCount: pending,
      approvedCount: approved,
      readyForDownstream:
        status === "Completed" && total > 0 && pending === 0,
      workspace: "Project Context",
      recommendedAction:
        status === "Failed"
          ? "Retry project context extraction"
          : pending > 0
            ? "Review project context"
            : "Open project context",
    });
  }

  if (normalizeDocumentType(type) === "Supplier Quotation") {
    if (!contentReadableForDownstream(document)) {
      return baseState({
        kind: "Supplier Quote",
        pipelineStatus: "Unavailable",
        reviewStatus: "Not Applicable",
        workspace: null,
        recommendedAction: null,
      });
    }
    if (!document.supplier_quote_intake_id) {
      return baseState({
        kind: "Supplier Quote",
        pipelineStatus: "Not Started",
        workspace: "Price Sources",
        recommendedAction: "Start supplier quote extraction",
      });
    }

    const total = numberOrZero(document.supplier_quote_line_count);
    const pending = numberOrZero(document.supplier_quote_lines_pending);
    const approved = numberOrZero(document.supplier_quote_lines_approved);
    const status = String(
      document.supplier_quote_intake_status || "Completed",
    ).trim();
    const normalizedStatus = status.toUpperCase().replaceAll(" ", "_");

    return baseState({
      kind: "Supplier Quote",
      pipelineStatus:
        ["COMPLETED", "NEEDS_REVIEW"].includes(normalizedStatus)
          ? "Completed"
          : normalizedStatus === "FAILED"
            ? "Failed"
            : normalizedStatus === "QUEUED"
              ? "Queued"
              : "Processing",
      reviewStatus: aggregateReview({ total, pending, approved }),
      totalCount: total,
      pendingCount: pending,
      approvedCount: approved,
      readyForDownstream:
        ["COMPLETED", "NEEDS_REVIEW"].includes(normalizedStatus) &&
        total > 0 &&
        pending === 0 &&
        approved > 0,
      workspace: "Price Sources",
      recommendedAction:
        normalizedStatus === "FAILED"
          ? "Retry supplier quote extraction"
          : pending > 0
            ? "Review supplier quote"
            : "Open supplier quote",
    });
  }

  return baseState({
    kind: type || null,
    pipelineStatus: "Not Started",
    reviewStatus: "Not Applicable",
    workspace: null,
    recommendedAction: null,
  });
};
