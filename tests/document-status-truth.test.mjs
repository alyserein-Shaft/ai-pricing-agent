import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  documentClassificationPresentation,
  documentProcessingPresentation,
  extractedContentReviewPresentation,
} from "../app/lib/document-status-presentation.mjs";
import { attachExactProjectContextReview } from "../worker/document-api.mjs";

test("completed Project Context processing remains separate from 18 pending facts", () => {
  const document = {
    predicted_type: "Project Context",
    classification_status: "Verified",
    classification_confidence: 100,
    processing_status: "Completed",
    progress: 100,
    project_context_extraction_id: "context-1",
    project_context_fact_count: 18,
    project_context_facts_pending: 18,
    project_context_facts_reviewed: 0,
    project_context_facts_rejected: 0,
  };

  assert.equal(
    documentProcessingPresentation(document).label,
    "Processing: Completed",
  );
  assert.deepEqual(documentClassificationPresentation(document), {
    confirmed: true,
    label: "Classification: Confirmed — Project Context",
    confidence: "Classification confidence: 100%",
  });
  assert.equal(
    extractedContentReviewPresentation(document).label,
    "Content review: 18 pending",
  );
  assert.doesNotMatch(documentClassificationPresentation(document).label, /Verified/);
});

test("completed BOQ extraction does not imply pending rows are approved", () => {
  const document = {
    predicted_type: "BOQ",
    classification_status: "Classified",
    classification_confidence: 92,
    processing_status: "Completed",
    progress: 100,
    boq_extraction_id: "boq-extraction-1",
  };
  const content = extractedContentReviewPresentation(document, {
    boqSummary: { validBoqItems: 90, itemsNeedingReview: 86 },
  });

  assert.equal(content.label, "Content review: 86 BOQ items pending");
  assert.equal(content.reviewed, 4);
  assert.equal(documentProcessingPresentation(document).label, "Processing: Completed");
  assert.equal(
    documentClassificationPresentation(document).confidence,
    "Classification confidence: 92%",
  );
});

test("legacy pending-review terminal state renders completed processing and separate review", () => {
  const priceList = {
    logical_name: "Data System OH ( newwww).xlsx",
    predicted_type: "Price List",
    classification_status: "Manually Confirmed",
    classification_confidence: 84,
    processing_status: "Needs Review",
    progress: 100,
  };

  assert.deepEqual(documentProcessingPresentation(priceList), {
    status: "Completed",
    label: "Processing: Completed",
    progress: 100,
  });
  assert.notEqual(
    documentProcessingPresentation(priceList).label,
    "Processing: Needs Review",
  );
});

test("shared presenter never mixes processing, classification and content review", () => {
  const fixtures = [
    {
      document: {
        predicted_type: "Project Context",
        classification_status: "Classified",
        classification_confidence: 98,
        processing_status: "Needs Review",
        progress: 100,
        project_context_extraction_id: "pcx",
        project_context_fact_count: 18,
        project_context_facts_pending: 18,
      },
      summaries: {},
      review: "Content review: 18 pending",
    },
    {
      document: {
        predicted_type: "BOQ",
        classification_status: "Classified",
        classification_confidence: 90,
        processing_status: "Needs Review",
        progress: 100,
        boq_extraction_id: "bx",
      },
      summaries: { boqSummary: { validBoqItems: 90, itemsNeedingReview: 86 } },
      review: "Content review: 86 BOQ items pending",
    },
    {
      document: {
        predicted_type: "Technical Specification",
        classification_status: "Classified",
        classification_confidence: 91,
        processing_status: "Needs Review",
        progress: 100,
        specification_extraction_id: "sx",
      },
      summaries: {
        specificationSummary: { requirements: 458, itemsNeedingReview: 456 },
      },
      review: "Content review: 456 requirements pending",
    },
  ];

  for (const fixture of fixtures) {
    const processing = documentProcessingPresentation(fixture.document);
    const classification = documentClassificationPresentation(fixture.document);
    const review = extractedContentReviewPresentation(
      fixture.document,
      fixture.summaries,
    );
    assert.equal(processing.label, "Processing: Completed");
    assert.match(classification.label, /^Classification:/);
    assert.match(classification.confidence, /^Classification confidence:/);
    assert.equal(review.label, fixture.review);
    assert.doesNotMatch(processing.label, /Review/);
  }
});

test("Price List and Project Context in one project cannot borrow classification or review state", () => {
  const priceList = {
    id: "document-price-list",
    version_id: "version-price-list",
    predicted_type: "Price List",
    classification_status: "Manually Confirmed",
    classification_confidence: 64,
    downstream_route: "Price Library Import",
    import_summary: { productObservationsProcessed: 591 },
  };
  const projectContext = {
    id: "document-project-context",
    version_id: "version-project-context",
    predicted_type: "Project Context",
    classification_status: "Classified",
    classification_confidence: 98,
    downstream_route: "Project Context Extraction",
  };
  const reviews = [{
    project_context_extraction_id: "context-extraction-1",
    document_id: projectContext.id,
    document_version_id: projectContext.version_id,
    project_context_extraction_version: 1,
    project_context_extraction_status: "Completed",
    project_context_fact_count: 18,
    project_context_facts_pending: 18,
    project_context_facts_reviewed: 0,
    project_context_facts_rejected: 0,
  }];

  const [scopedPriceList, scopedProjectContext] =
    attachExactProjectContextReview([priceList, projectContext], reviews);

  assert.equal(scopedPriceList.predicted_type, "Price List");
  assert.equal(scopedPriceList.downstream_route, "Price Library Import");
  assert.equal(scopedPriceList.import_summary.productObservationsProcessed, 591);
  assert.equal(scopedPriceList.project_context_extraction_id, undefined);
  assert.equal(
    documentClassificationPresentation(scopedPriceList).label,
    "Classification: Confirmed — Price List",
  );
  assert.equal(scopedProjectContext.predicted_type, "Project Context");
  assert.equal(scopedProjectContext.downstream_route, "Project Context Extraction");
  assert.equal(scopedProjectContext.project_context_facts_pending, 18);
  assert.equal(
    extractedContentReviewPresentation(scopedProjectContext).label,
    "Content review: 18 pending",
  );
});

test("Project Context without an exact document-version association fails closed", () => {
  const document = {
    predicted_type: "Project Context",
    classification_status: "Classified",
  };
  assert.equal(
    extractedContentReviewPresentation(document).label,
    "Content review unavailable",
  );
});

test("document register labels all three status dimensions explicitly", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const api = await readFile(new URL("../worker/document-api.mjs", import.meta.url), "utf8");

  assert.match(page, /classificationPresentation\.label/);
  assert.match(page, /classificationPresentation\.confidence/);
  assert.match(page, /processingPresentation\.label/);
  assert.match(page, /processingPresentation\.status === "Completed"/);
  assert.match(page, /value=\{processingPresentation\.progress\}/);
  assert.match(page, /contentReviewPresentation\.label/);
  assert.match(page, /Processing route:/);
  assert.doesNotMatch(page, /document\.confidence_state \|\| "Pending evidence"/);
  assert.match(page, /Extraction:\{" "\}/);
  assert.match(page, /Successful processing and extraction do not approve the/);
  assert.match(api, /attachExactProjectContextReview/);
  assert.match(api, /\$\{document\.id\}:\$\{document\.version_id\}/);
});
