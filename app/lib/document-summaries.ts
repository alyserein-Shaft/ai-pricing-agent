// Backend & Codebase Consolidation Sprint, item 6 (Phase 1 page.tsx
// decomposition): pure derived-state helpers with zero closure dependencies
// -- each is a plain function of one document's own stored JSON summary
// field, with no other coupling to page.tsx's state or handlers. Moved out
// verbatim; behavior is unchanged and covered by app/page.tsx's existing
// consumers plus tests/boq-line-cost-summary.test.mjs-style JSON-shape
// assertions that already exercise these summary fields end to end.

export type BoqExtractionSummary = {
  validBoqItems?: number;
  itemsNeedingReview?: number;
  sectionsDetected?: number;
  sectionHeaders?: number;
  totalsAndSubtotals?: number;
  averageConfidence?: number;
  structuralRecordsNeedingReview?: number;
};

export const boqSummaryFor = (document: {
  boq_extraction_summary?: string | null;
}): BoqExtractionSummary => {
  try {
    const summary = JSON.parse(document.boq_extraction_summary || "{}") as {
      validBoqItems?: number;
      itemsNeedingReview?: number;
      sectionsDetected?: number;
      sectionHeaders?: number;
      totalsAndSubtotals?: number;
      averageConfidence?: number;
    };
    const itemReviewCount = Math.min(
      Number(summary.validBoqItems || 0),
      Number(summary.itemsNeedingReview || 0),
    );
    return {
      ...summary,
      itemsNeedingReview: itemReviewCount,
      structuralRecordsNeedingReview: Math.max(
        0,
        Number(summary.itemsNeedingReview || 0) - itemReviewCount,
      ),
    };
  } catch {
    return {};
  }
};

export type SpecificationExtractionSummary = {
  requirements?: number;
  clauses?: number;
  totalRequirementsExtracted?: number;
  totalClausesDetected?: number;
  totalPagesReviewed?: number;
  mandatoryRequirements?: number;
  itemsNeedingReview?: number;
  conflicts?: number;
  missingInformation?: number;
  averageConfidence?: number;
};

export const specificationSummaryFor = (document: {
  specification_extraction_summary?: string | null;
}): SpecificationExtractionSummary => {
  try {
    const summary = JSON.parse(
      document.specification_extraction_summary || "{}",
    ) as SpecificationExtractionSummary;
    return {
      ...summary,
      requirements:
        summary.totalRequirementsExtracted ?? summary.requirements,
      clauses: summary.totalClausesDetected ?? summary.clauses,
    };
  } catch {
    return {};
  }
};
