const confirmedClassificationStatuses = new Set([
  "Classified",
  "Confirmed",
  "Manually Confirmed",
  "Verified",
]);

export function documentClassificationPresentation(document = {}) {
  const type = document.predicted_type || document.document_type || "Unknown";
  const confirmed = confirmedClassificationStatuses.has(
    document.classification_status,
  );
  return {
    confirmed,
    label: confirmed
      ? `Classification: Confirmed — ${type}`
      : `Classification: ${document.classification_status || "Queued"} — ${type}`,
    confidence: `Classification confidence: ${Number(document.classification_confidence || 0)}%`,
  };
}

export function documentProcessingPresentation(document = {}) {
  const rawStatus = document.processing_status || "Uploaded";
  const progress = Number(document.progress || 0);
  const status = document.archived_at
    ? "Archived"
    : rawStatus === "Needs Review" && progress >= 100
      ? "Completed"
      : rawStatus;
  return {
    status,
    label: `Processing: ${status}`,
    progress,
  };
}

export function extractedContentReviewPresentation(
  document = {},
  { boqSummary = {}, specificationSummary = {} } = {},
) {
  const type = document.predicted_type || document.document_type || "";

  if (type === "Project Context" || document.project_context_extraction_id) {
    if (!document.project_context_extraction_id) {
      return {
        kind: "Project Context",
        total: 0,
        pending: 0,
        reviewed: 0,
        rejected: 0,
        label: "Content review unavailable",
      };
    }
    const pending = Number(document.project_context_facts_pending || 0);
    const reviewed = Number(document.project_context_facts_reviewed || 0);
    const rejected = Number(document.project_context_facts_rejected || 0);
    const total = Number(document.project_context_fact_count || 0);
    return {
      kind: "Project Context",
      total,
      pending,
      reviewed,
      rejected,
      label: pending
        ? `Content review: ${pending} pending`
        : total
          ? `Content review: ${reviewed} reviewed${rejected ? ` · ${rejected} rejected` : ""}`
          : "Content review: Not extracted",
    };
  }

  if (type === "BOQ" || document.boq_extraction_id) {
    const total = Number(boqSummary.validBoqItems || 0);
    const pending = Number(boqSummary.itemsNeedingReview || 0);
    return {
      kind: "BOQ",
      total,
      pending,
      reviewed: Math.max(0, total - pending),
      rejected: 0,
      label: pending
        ? `Content review: ${pending} BOQ item${pending === 1 ? "" : "s"} pending`
        : total
          ? `Content review: ${total} BOQ item${total === 1 ? "" : "s"} reviewed`
          : "Content review: Not extracted",
    };
  }

  if (
    type === "Technical Specification" ||
    document.specification_extraction_id
  ) {
    const total = Number(specificationSummary.requirements || 0);
    const pending = Number(specificationSummary.itemsNeedingReview || 0);
    return {
      kind: "Technical Specification",
      total,
      pending,
      reviewed: Math.max(0, total - pending),
      rejected: 0,
      label: pending
        ? `Content review: ${pending} requirement${pending === 1 ? "" : "s"} pending`
        : total
          ? `Content review: ${total} requirement${total === 1 ? "" : "s"} reviewed`
          : "Content review: Not extracted",
    };
  }

  return null;
}
