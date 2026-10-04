import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { derivePresalesWorkflow } from "../app/domain/presales-workflow-engine.mjs";
import { deriveWorkflow, generateActions, calculateRisks } from "../app/domain/dashboard-workflow-engine.mjs";
import { documentContentUnsupported } from "../app/lib/document-status-presentation.mjs";

// Global Workflow Resolved-Documents Fix (2026-09-15). Root cause:
// docsReady required classified === documents, and `classified` only ever
// counted document_classifications.status IN ('Classified','Confirmed',
// 'Manually Confirmed'). A document whose content genuinely cannot be read
// (classification_error_code = 'UNREADABLE_CONTENT', e.g. an Outlook .msg
// file) can never honestly reach one of those statuses -- there was never
// any content to classify. So the global "intake"/"Understand Tender"-
// equivalent workflow stage was permanently blocked by any unsupported
// file, even after the Documents workspace (previous sprint) correctly
// started reporting intake as complete. Fix: `resolved = classified +
// unsupported` is now the intake-readiness denominator. `classified` and
// `unsupported` remain separate, honest facts -- an unsupported document is
// never counted as classified, never produces BOQ/spec/drawing evidence,
// and stays visible as a non-blocking warning/risk after intake completes.

const project = { id: "p1", name: "TesT", organizationId: "org1", systemDomain: "Fire Alarm" };

test("1. all normally classified documents -> docsReady true (intake Completed)", () => {
  const result = derivePresalesWorkflow({ project, facts: { documents: 8, classified: 8 } });
  assert.equal(result.stages.find((s) => s.id === "intake").status, "Completed");
});

test("2. Central Kitchen shape -- 6 classified + 2 terminal UNREADABLE_CONTENT -> docsReady true", () => {
  const result = derivePresalesWorkflow({ project, facts: { documents: 8, classified: 6, unsupported: 2 } });
  assert.equal(result.stages.find((s) => s.id === "intake").status, "Completed");
  assert.deepEqual(result.stages.find((s) => s.id === "intake").blockers, []);
});

test("3. unsupported documents are NOT counted as classified", () => {
  const result = derivePresalesWorkflow({ project, facts: { documents: 8, classified: 6, unsupported: 2 } });
  assert.equal(result.domainSummaries.intake.classified, 6, "classified must stay honest -- it never absorbs unsupported documents");
});

test("4. unsupported documents ARE counted as resolved intake", () => {
  const result = derivePresalesWorkflow({ project, facts: { documents: 8, classified: 6, unsupported: 2 } });
  assert.equal(result.domainSummaries.intake.resolved, 8);
  assert.equal(result.domainSummaries.intake.unsupported, 2);
});

test("5. a generic processing failure still blocks docsReady, even with every document otherwise resolved", () => {
  const result = derivePresalesWorkflow({ project, facts: { documents: 8, classified: 6, unsupported: 2, failedJobs: 1 } });
  assert.notEqual(result.stages.find((s) => s.id === "intake").status, "Completed");
  assert.equal(result.stages.find((s) => s.id === "intake").status, "Failed");
});

test("6. active processing still blocks docsReady, even with every document otherwise resolved", () => {
  const result = derivePresalesWorkflow({ project, facts: { documents: 8, classified: 6, unsupported: 2, processing: 1 } });
  assert.notEqual(result.stages.find((s) => s.id === "intake").status, "Completed");
  assert.equal(result.stages.find((s) => s.id === "intake").status, "In Progress");
});

test("7. OCR_REQUIRED is not counted as resolved unsupported -- docsReady stays false", () => {
  // A document needing OCR is neither classified nor unsupported -- it is
  // a real, different, still-actionable pipeline step (Task 2/6). Modeled
  // here as one document that is neither classified nor unsupported.
  const result = derivePresalesWorkflow({ project, facts: { documents: 1, classified: 0, unsupported: 0 } });
  assert.notEqual(result.stages.find((s) => s.id === "intake").status, "Completed");

  // The live SQL that computes `unsupported` must never match OCR_REQUIRED.
  const source = readFileSync(new URL("../worker/dashboard-api.mjs", import.meta.url), "utf8");
  const unsupportedQuery = source.slice(source.indexOf("c.error_code='UNREADABLE_CONTENT'") - 50, source.indexOf("c.error_code='UNREADABLE_CONTENT'") + 40);
  assert.doesNotMatch(unsupportedQuery, /OCR_REQUIRED/);
});

test("8. low-confidence Unknown / Needs Review (genuinely ambiguous but readable) is not resolved", () => {
  // Same shape as OCR_REQUIRED: a document that is neither classified nor
  // explicitly unsupported must remain unresolved.
  const result = derivePresalesWorkflow({ project, facts: { documents: 1, classified: 0, unsupported: 0 } });
  assert.notEqual(result.stages.find((s) => s.id === "intake").status, "Completed");
  assert.deepEqual(result.stages.find((s) => s.id === "intake").blockers, ["Documents require classification."]);
});

test("9. unsupported documents contribute no BOQ/spec/drawing evidence", () => {
  // Raising `unsupported` alone (facts otherwise held constant) must not
  // move any downstream evidence-derived readiness.
  const withoutUnsupported = derivePresalesWorkflow({ project, facts: { documents: 8, classified: 8, boqItems: 0, specificationExtractions: 0 } });
  const withUnsupported = derivePresalesWorkflow({ project, facts: { documents: 8, classified: 6, unsupported: 2, boqItems: 0, specificationExtractions: 0 } });
  assert.equal(withUnsupported.stages.find((s) => s.id === "extraction").status, withoutUnsupported.stages.find((s) => s.id === "extraction").status);
  assert.equal(withUnsupported.domainSummaries.extraction.records, 0);

  // The live SQL that counts `unsupported` is a standalone query against
  // documents/document_classifications only -- it can structurally never
  // touch boq_items, technical_requirements, or drawing tables.
  const source = readFileSync(new URL("../worker/dashboard-api.mjs", import.meta.url), "utf8");
  const marker = "c.error_code='UNREADABLE_CONTENT'";
  const queryStart = source.lastIndexOf("one(db,", source.indexOf(marker));
  const query = source.slice(queryStart, source.indexOf(marker) + marker.length + 20);
  assert.doesNotMatch(query, /boq_items|technical_requirements|drawing_intake/i);
});

test("10. the unsupported warning remains visible after intake becomes Complete", () => {
  const facts = { documents: 8, classified: 6, unsupported: 2 };
  const result = derivePresalesWorkflow({ project, facts });
  assert.equal(result.stages.find((s) => s.id === "intake").status, "Completed");
  assert.equal(result.domainSummaries.intake.unsupported, 2, "the fact must not disappear once intake is resolved");

  const workflow = deriveWorkflow(facts, project);
  const actions = generateActions(facts, workflow, project);
  const risks = calculateRisks(facts, workflow, project);
  assert.ok(actions.some((a) => a.type === "unsupported-documents"), "an informational action must still surface the unsupported files");
  assert.equal(actions.find((a) => a.type === "unsupported-documents").blocking, false, "it must be non-blocking");
  assert.ok(risks.some((r) => r.type === "Unsupported content"), "a non-blocking risk entry must still surface the unsupported files");
  assert.notEqual(risks.find((r) => r.type === "Unsupported content").severity, "Critical");
});

test("11. Documents UI and global workflow agree on intake completion for the same underlying document set", () => {
  // Mirrors the exact Central Kitchen document set (Documents workspace
  // closure sprint): 6 real classification outcomes (Manually Confirmed)
  // and 2 Outlook .msg files with classification_error_code =
  // 'UNREADABLE_CONTENT'.
  const documents = [
    { predicted_type: "BOQ", classification_status: "Manually Confirmed" },
    { predicted_type: "Project Context", classification_status: "Manually Confirmed" },
    { predicted_type: "Technical Specification", classification_status: "Manually Confirmed" },
    { predicted_type: "Drawing", classification_status: "Manually Confirmed" },
    { predicted_type: "Drawing", classification_status: "Manually Confirmed" },
    { predicted_type: "Drawing", classification_status: "Manually Confirmed" },
    { predicted_type: "Unknown", classification_status: "Needs Review", classification_error_code: "UNREADABLE_CONTENT" },
    { predicted_type: "Unknown", classification_status: "Needs Review", classification_error_code: "UNREADABLE_CONTENT" },
  ];

  // Documents workspace's own truthful intake-complete rule (see
  // DocumentsWorkspace.tsx / classificationReviewDocuments in app/page.tsx):
  // a document still needs review only if it is NOT unsupported AND not
  // yet confirmed.
  const stillNeedsReview = documents.filter(
    (d) => !documentContentUnsupported(d) && d.classification_status !== "Manually Confirmed",
  );
  const documentsUiIntakeComplete = stillNeedsReview.length === 0;

  // Global workflow's own rule, fed the equivalent aggregate facts.
  const classified = documents.filter((d) => d.classification_status === "Manually Confirmed").length;
  const unsupported = documents.filter((d) => documentContentUnsupported(d)).length;
  const result = derivePresalesWorkflow({ project, facts: { documents: documents.length, classified, unsupported } });
  const globalIntakeComplete = result.stages.find((s) => s.id === "intake").status === "Completed";

  assert.equal(documentsUiIntakeComplete, true);
  assert.equal(globalIntakeComplete, true);
  assert.equal(documentsUiIntakeComplete, globalIntakeComplete, "the Documents page and the global workflow must reach the same intake-complete conclusion for the same document set");
});

test("12. Central Kitchen exact expected fact shape: total 8, classified 6, unsupported 2, resolved 8, intake complete", () => {
  const result = derivePresalesWorkflow({ project, facts: { documents: 8, classified: 6, unsupported: 2 } });
  assert.equal(result.domainSummaries.intake.records, 8);
  assert.equal(result.domainSummaries.intake.classified, 6);
  assert.equal(result.domainSummaries.intake.unsupported, 2);
  assert.equal(result.domainSummaries.intake.resolved, 8);
  assert.equal(result.domainSummaries.intake.openReviews, 0);
  assert.equal(result.stages.find((s) => s.id === "intake").status, "Completed");
});

test("13. no quotation/technical readiness gate is falsely satisfied merely because unsupported documents count as intake-resolved", () => {
  const result = derivePresalesWorkflow({ project, facts: { documents: 8, classified: 6, unsupported: 2 } });
  assert.equal(result.readyForQuotation, false);
  assert.equal(result.stages.find((s) => s.id === "technical").status, "Not Started");
  assert.equal(result.stages.find((s) => s.id === "quotation").status, "Not Started");
  assert.equal(result.currentStageId, "extraction", "the workflow correctly moves on to the NEXT real gate, not straight to quotation readiness");
});
