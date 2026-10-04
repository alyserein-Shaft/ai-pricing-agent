// AIU-4A — Governed AI Understanding Completion Authority.
//
// Proves the ONE canonical backend completion authority
// (currentUnderstandingCompletion) classifies every eligible row by the SAME
// item-level lifecycle the review screen exposes (safeUnderstandingReviewItem's
// own review.status), and that the workflow engine consumes it rather than
// inventing its own rule:
//
//   A. Population — only AI-eligible rows participate; Merged, Rejected BOQ
//      extraction rows, approved_for_downstream=0 and header rows excluded
//      (A-1..A-4).
//   B. Completion states — NOT_ANALYZED and AWAITING_REVIEW prevent
//      completion; APPROVED is terminal; REJECTED is a governed terminal
//      outcome ("review finished, no approved interpretation"); FAILED and
//      stale attempts are unresolved analysis debt, never terminal-complete
//      (B-5..B-10).
//   C. Separation of concepts — workflow-complete does not imply all rows
//      APPROVED; approved coverage stays distinct from terminal-reviewed;
//      downstream approved facts still expose only APPROVED rows
//      (C-11..C-13).
//   D. Mixed-state population — exact bucket arithmetic across a realistic
//      mixture (D-14..D-15).
//   E. Workflow — derivePresalesWorkflow surfaces understanding debt instead
//      of claiming completion, and reports Completed only under proven
//      terminal conditions (E-16..E-17).
//   F. API/UI — dashboard facts and workflow consume the same canonical
//      authority (F-18..F-19).
//
// No hardcoded population counts beyond this fixture's own derivable state.
// No historical interpretation/review record is deleted or mutated.
import test from "node:test";
import assert from "node:assert/strict";

import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import { currentBoqEvidenceFrom, currentBoqEligibleForUnderstandingPredicate } from "../worker/current-evidence-scope.mjs";
import {
  currentApprovedUnderstandingFacts,
  currentUnderstandingCompletion,
  loadUnderstandingReviewRows,
  safeUnderstandingReviewItem,
  UNDERSTANDING_COMPLETION_VERSION,
} from "../worker/estimator-understanding-review-api.mjs";
import { derivePresalesWorkflow } from "../app/domain/presales-workflow-engine.mjs";
import { interpretationInputFingerprint, prepareBoqUnderstandingInput } from "../app/domain/boq-understanding-engine.mjs";

const PROJECT = "p1";

// The fixture is the ACTUAL ordered active migration chain (drizzle-active
// journal), not a hand-written approximation -- see tests/fixtures/
// active-chain-fixture.mjs. Every seed row below therefore has to satisfy the
// REAL NOT NULL set, and FK enforcement is on because the real chain leaves it
// on (drizzle-active/0002_governing_source_fk.sql). :memory: only; no live data.
//
// Two REAL column types are load-bearing for the fingerprints this file
// computes, so the seed and the test's own prepareBoqUnderstandingInput inputs
// are derived from the SAME helpers rather than restated:
//   * boq_items.numeric_quantity / .original_quantity are TEXT on the real
//     chain, so the DB yields "9" where the fixture row says 9 -- a numeric 9
//     recomputes a different input_fingerprint and every row would read
//     NOT_ANALYZED instead of approved/awaiting.
//   * boq_items.source_location is NOT NULL JSON, so a missing value cannot be
//     represented and the parsed object has to be what the read path sees.
const quantityText = (value) => (value == null ? null : String(value));
const sourceLocationFor = (row) => ({ sheet: "BOQ", row: row.seq });

// Manual Call Point proposal: the exact shape already proven to pass governed
// Fire Alarm taxonomy acceptance in tests/product-matching-understanding-authority.
const mcpProposal = {
  normalizedDescription: { value: "Manual Call Point MCLP", origin: "EXTRACTED", confidence: 95 },
  system: { value: "Fire Alarm", origin: "EXTRACTED", confidence: 95 },
  category: { value: "Manual Initiation", origin: "EXTRACTED", confidence: 90 },
  subcategory: { value: null, origin: "MISSING", confidence: 0 },
  equipmentType: { value: "Manual Call Point", origin: "EXTRACTED", confidence: 90 },
  productFamily: { value: "Manual Call Point", origin: "EXTRACTED", confidence: 90 },
  attributes: {},
  manufacturerPreferences: [], manufacturerRestrictions: [], standards: [], compatibilityRequirements: [],
  requiredAccessories: [], searchTerms: ["manual call point"], missingInformation: [], ambiguities: [],
  engineeringNotes: [], confidence: "HIGH", reviewReasons: [],
};

// 5 ELIGIBLE rows (Auto Verified + downstream=1) driving every completion
// state, plus 1 Merged + 1 Rejected-BOQ + 1 downstream=0 + 1 Header row that
// must all stay OUTSIDE the eligible population.
const ROWS = [
  { id: "c-av", seq: 1, description: "Manual Call Point MCLP", qty: 12, unit: "Each", system: "28.01 - Fire Alarm System", reviewStatus: "Auto Verified", downstream: 1 },
  { id: "c-ap", seq: 2, description: "Manual Call Point MCLP", qty: 16, unit: "Each", system: "28.01 - Fire Alarm System", reviewStatus: "Auto Verified", downstream: 1 },
  { id: "c-rj", seq: 3, description: "Manual Call Point MCLP", qty: 8, unit: "Each", system: "28.01 - Fire Alarm System", reviewStatus: "Auto Verified", downstream: 1 },
  { id: "c-fa", seq: 4, description: "Manual Call Point MCLP", qty: 6, unit: "Each", system: "28.01 - Fire Alarm System", reviewStatus: "Auto Verified", downstream: 1 },
  { id: "c-na", seq: 5, description: "Heat Detector HD-4", qty: 9, unit: "Each", system: "28.01 - Fire Alarm System", reviewStatus: "Auto Verified", downstream: 1 },
  { id: "x-mg", seq: 6, description: "Manual Call Point MCLP", qty: 12, unit: "Each", system: "28.01 - Fire Alarm System", reviewStatus: "Merged", downstream: 0 },
  { id: "x-rj", seq: 7, description: "Cable Tray CT-9", qty: 5, unit: "Each", system: null, reviewStatus: "Rejected", downstream: 0 },
  { id: "x-inv", seq: 8, description: "Junction Box JB-2", qty: 6, unit: "Each", system: null, reviewStatus: "Approved", downstream: 0 },
  { id: "x-hd", seq: 9, description: "Fire Alarm System Items", qty: null, unit: null, system: null, reviewStatus: "Auto Verified", downstream: 1, rowType: "Header" },
];
const ROW = Object.fromEntries(ROWS.map((row) => [row.id, row]));

const inputFor = (row) => prepareBoqUnderstandingInput({
  id: row.id, rowType: row.rowType || "BOQ Item", description: row.description,
  numericQuantity: quantityText(row.qty), originalQuantity: quantityText(row.qty),
  normalizedUnit: row.unit, originalUnit: row.unit,
  system: row.system, category: null, subcategory: null,
  manufacturer: null, model: null, partNumber: null,
  currentValues: {}, sourceLocation: sourceLocationFor(row),
});
const fpFor = (row) => interpretationInputFingerprint(inputFor(row));

const seedDatabase = async () => {
  const raw = activeChainDatabase();
  raw.exec(`
    INSERT INTO organizations (id, name) VALUES ('org1','Org One');
    INSERT INTO projects (id, name, owner_user_id, organization_id) VALUES ('${PROJECT}','Understanding Fixture','owner1','org1');
    INSERT INTO documents (id, project_id, logical_name, created_by) VALUES ('doc1','${PROJECT}','boq-1.xlsx','owner1');
    INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by)
      VALUES ('dv1','doc1',1,'boq-1.xlsx','boq-1.stored','xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',4,'sha-dv1','projects/${PROJECT}/boq-1.xlsx','owner1');
    UPDATE documents SET current_version_id='dv1' WHERE id='doc1';
    INSERT INTO boq_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, ocr_version, created_by)
      VALUES ('ext1','doc1','dv1',1,'Completed','parser-v1','rules-v1','ocr-v1','owner1');
    INSERT INTO estimator_understanding_runs (id, project_id, organization_id, provider, model, model_version, prompt_version, schema_version, config_fingerprint, status, requested_by, started_at, run_mode)
      VALUES ('run1','${PROJECT}','org1','test-provider','test-model','model-v1','prompt-v1','schema-v1','cfg1','COMPLETED','owner1','2026-09-01T00:00:00Z','CONTROLLED_PILOT');
  `);
  const insertRow = raw.prepare(`INSERT INTO boq_items (id,project_id,row_type,extraction_version_id,source_document_id,sequence,item_number,description,numeric_quantity,original_quantity,normalized_unit,original_unit,system_value,category,subcategory,manufacturer,model,part_number,section_path,current_values,source_location,original_raw_values,review_status,approved_for_downstream,specification_reference,system_confidence,extraction_confidence,confidence_state)
    VALUES (?, ?,? ,'ext1','doc1',? ,? ,? ,? ,? ,? ,? ,? ,NULL,NULL,NULL,NULL,NULL,'[]','{}',? ,'[]',? ,? ,NULL,95,60,'High Confidence')`);
  for (const row of ROWS) {
    insertRow.run(row.id, PROJECT, row.rowType || "BOQ Item", row.seq, row.id, row.description, quantityText(row.qty), quantityText(row.qty), row.unit, row.unit, row.system, JSON.stringify(sourceLocationFor(row)), row.reviewStatus, row.downstream);
  }
  return raw;
};

const insertInterpretation = (raw, { id, itemId, status = "COMPLETED", fingerprint = null, proposal = mcpProposal }) =>
  raw.prepare(`INSERT INTO estimator_item_interpretations (id,boq_item_id,run_id,project_id,version_number,input_fingerprint,config_fingerprint,provider,model,model_version,prompt_version,schema_version,status,validated_interpretation,error_code,raw_response,created_by,created_at)
    VALUES (? ,? ,'run1','${PROJECT}',1,? ,'cfg1','test-provider','test-model','model-v1','prompt-v1','schema-v1',? ,? ,NULL,NULL,'owner1','2026-09-24T00:00:00Z')`)
    .run(id, itemId, fingerprint || fpFor(ROW[itemId]), status, JSON.stringify(proposal));

const insertReview = (raw, { itemId, interpretationId, status }) =>
  raw.prepare(`INSERT INTO estimator_understanding_review_versions (id,project_id,boq_item_id,interpretation_id,version_number,review_status,canonical_interpretation,source_input_fingerprint,source_document_version_id,source_extraction_version,review_reason,reviewed_by,created_at)
    VALUES (? ,'${PROJECT}',? ,? ,1,? ,? ,? ,'dv1',1,NULL,'engineer1','2026-09-24T00:00:00Z')`)
    .run(`rv-${itemId}`, itemId, interpretationId, status, JSON.stringify(mcpProposal), fpFor(ROW[itemId]));

const completion = async (raw) => currentUnderstandingCompletion(d1(raw), PROJECT);

test("A-1: only AI-eligible BOQ rows participate in the completion population", async () => {
  const raw = await seedDatabase();
  const result = await completion(raw);
  // 5 eligible rows (c-av, c-ap, c-rj, c-fa, c-na). Merged x-mg, Rejected
  // extraction x-rj, downstream=0 x-inv and Header x-hd are all outside.
  assert.equal(result.eligible, 5);
});

test("A-2: Merged terminal rows are excluded", async () => {
  const raw = await seedDatabase();
  const rows = await loadUnderstandingReviewRows(d1(raw), PROJECT);
  assert.ok(!rows.some((row) => row.boqItemId === "x-mg"));
});

test("A-3: Rejected BOQ extraction rows are excluded", async () => {
  const raw = await seedDatabase();
  const rows = await loadUnderstandingReviewRows(d1(raw), PROJECT);
  assert.ok(!rows.some((row) => row.boqItemId === "x-rj"));
});

test("A-4: approved_for_downstream=0 rows are excluded", async () => {
  const raw = await seedDatabase();
  const rows = await loadUnderstandingReviewRows(d1(raw), PROJECT);
  assert.ok(!rows.some((row) => row.boqItemId === "x-inv"));
});

test("B-5: NOT_ANALYZED prevents completion", async () => {
  const raw = await seedDatabase();
  // c-av: current attempt awaiting review. c-na: never analyzed.
  insertInterpretation(raw, { id: "i-av", itemId: "c-av" });
  const result = await completion(raw);
  assert.equal(result.notAnalyzed, 4);
  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.completion, false);
});

test("B-6: AWAITING_REVIEW prevents completion", async () => {
  const raw = await seedDatabase();
  for (const itemId of ["c-av", "c-ap", "c-rj", "c-fa"]) insertInterpretation(raw, { id: `i-${itemId}`, itemId });
  const result = await completion(raw);
  // 4 rows have current interpretations awaiting review; 1 (c-na) not analyzed.
  assert.equal(result.reviewDebt, 4);
  assert.equal(result.notAnalyzed, 1);
  assert.equal(result.status, "INCOMPLETE");
});

test("B-7: APPROVED behaves as terminal", async () => {
  const raw = await seedDatabase();
  for (const itemId of ["c-av", "c-ap", "c-rj", "c-fa"]) {
    insertInterpretation(raw, { id: `i-${itemId}`, itemId });
    insertReview(raw, { itemId, interpretationId: `i-${itemId}`, status: "APPROVED" });
  }
  const result = await completion(raw);
  // 4 terminal-approved + 1 never analyzed -> still incomplete (analysis debt).
  assert.equal(result.approved, 4);
  assert.equal(result.terminalReviewed, 4);
  assert.equal(result.notAnalyzed, 1);
  assert.equal(result.status, "INCOMPLETE");
});

test("B-8: REJECTED is a governed terminal outcome — review finished, no approved interpretation", async () => {
  const raw = await seedDatabase();
  for (const itemId of ["c-av", "c-ap", "c-rj", "c-fa", "c-na"]) {
    insertInterpretation(raw, { id: `i-${itemId}`, itemId });
    insertReview(raw, { itemId, interpretationId: `i-${itemId}`, status: "REJECTED" });
  }
  const result = await completion(raw);
  // ALL eligible rows terminal-reviewed (rejected) -> COMPLETE, with zero
  // approved intelligence coverage. This is the AIU-4A core semantic.
  assert.equal(result.rejected, 5);
  assert.equal(result.terminalReviewed, 5);
  assert.equal(result.approved, 0);
  assert.equal(result.approvedCoverage, 0);
  assert.equal(result.completion, true);
  assert.equal(result.status, "COMPLETE");
  assert.deepEqual(result.blockers, []);
});

test("B-9: FAILED is unresolved analysis debt, never terminal-complete", async () => {
  const raw = await seedDatabase();
  for (const itemId of ["c-av", "c-ap", "c-rj", "c-fa", "c-na"]) {
    insertInterpretation(raw, { id: `i-${itemId}`, itemId, status: "FAILED", proposal: null });
  }
  const result = await completion(raw);
  // FAILED rows carry an attempt but reached no review decision -> analysis debt.
  assert.equal(result.analysisDebt, 5);
  assert.equal(result.completion, false);
  assert.equal(result.status, "INCOMPLETE");
  assert.ok(result.blockers.some((message) => message.includes("failed AI Understanding attempt")));
});

test("B-10: a stale (superseded-fingerprint) attempt leaves the row NOT_ANALYZED, not complete", async () => {
  const raw = await seedDatabase();
  // Interpretation whose input fingerprint cannot match the current row input
  // (poisoned fingerprint) — the same terminal-row semantics AIU-2 proved.
  insertInterpretation(raw, { id: "i-poison", itemId: "c-av", fingerprint: "poisoned-fingerprint-value" });
  const result = await completion(raw);
  assert.equal(result.notAnalyzed, 5);
  assert.equal(result.completion, false);
});

test("C-11: workflow-complete does not imply all rows APPROVED", async () => {
  const raw = await seedDatabase();
  for (const itemId of ["c-av", "c-ap", "c-rj", "c-fa", "c-na"]) {
    insertInterpretation(raw, { id: `i-${itemId}`, itemId });
    insertReview(raw, { itemId, interpretationId: `i-${itemId}`, status: itemId === "c-na" ? "REJECTED" : "APPROVED" });
  }
  const result = await completion(raw);
  assert.equal(result.completion, true);
  assert.equal(result.approved, 4);
  assert.equal(result.rejected, 1);
  assert.ok(result.terminalReviewed > result.approvedCoverage);
});

test("C-12: approved coverage remains distinct from terminal-reviewed count", async () => {
  const raw = await seedDatabase();
  for (const itemId of ["c-av", "c-ap"]) {
    insertInterpretation(raw, { id: `i-${itemId}`, itemId });
    insertReview(raw, { itemId, interpretationId: `i-${itemId}`, status: "APPROVED" });
  }
  insertInterpretation(raw, { id: "i-rj", itemId: "c-rj" });
  insertReview(raw, { itemId: "c-rj", interpretationId: "i-rj", status: "REJECTED" });
  const result = await completion(raw);
  assert.equal(result.approvedCoverage, 2);
  assert.equal(result.terminalReviewed, 3);
  assert.notEqual(result.approvedCoverage, result.terminalReviewed);
});

test("C-13: downstream approved facts still expose only APPROVED rows", async () => {
  const raw = await seedDatabase();
  for (const itemId of ["c-av", "c-ap"]) {
    insertInterpretation(raw, { id: `i-${itemId}`, itemId });
    insertReview(raw, { itemId, interpretationId: `i-${itemId}`, status: "APPROVED" });
  }
  insertInterpretation(raw, { id: "i-rj", itemId: "c-rj" });
  insertReview(raw, { itemId: "c-rj", interpretationId: "i-rj", status: "REJECTED" });
  // Rejected row: no approved facts, even though Understanding is partially terminal.
  const rejectedFacts = await currentApprovedUnderstandingFacts(d1(raw), PROJECT, "c-rj");
  assert.equal(rejectedFacts, null);
  // Approved row: facts available.
  const approvedFacts = await currentApprovedUnderstandingFacts(d1(raw), PROJECT, "c-av");
  assert.ok(approvedFacts);
});

test("D-14: mixed-state population buckets sum exactly to eligible", async () => {
  const raw = await seedDatabase();
  // c-av approved; c-ap awaiting; c-rj FAILED; c-fa + c-na not analyzed.
  insertInterpretation(raw, { id: "i-av", itemId: "c-av" });
  insertReview(raw, { itemId: "c-av", interpretationId: "i-av", status: "APPROVED" });
  insertInterpretation(raw, { id: "i-ap", itemId: "c-ap" });
  insertInterpretation(raw, { id: "i-rj", itemId: "c-rj", status: "FAILED", proposal: null });
  const result = await completion(raw);
  assert.equal(result.approved, 1);
  assert.equal(result.reviewDebt, 1);
  assert.equal(result.analysisDebt, 1);
  assert.equal(result.notAnalyzed, 2);
  assert.equal(result.approved + result.reviewDebt + result.analysisDebt + result.notAnalyzed, result.eligible);
});

test("D-15: empty eligible population reports INCOMPLETE, never COMPLETE", async () => {
  const raw = await seedDatabase();
  raw.exec(`DELETE FROM boq_items WHERE review_status='Auto Verified' AND approved_for_downstream=1`);
  const result = await completion(raw);
  assert.equal(result.eligible, 0);
  assert.equal(result.completion, false);
  assert.equal(result.status, "INCOMPLETE");
});

test("E-16: workflow surfaces Understanding debt instead of claiming completion", async () => {
  const raw = await seedDatabase();
  insertInterpretation(raw, { id: "i-av", itemId: "c-av" });
  const result = await completion(raw);
  const workflow = derivePresalesWorkflow({
    project: { id: PROJECT, name: "P", organizationId: "org1", systemDomain: "Fire Alarm" },
    facts: { boqItems: 5, documents: 1, classified: 1, understanding: result },
  });
  assert.equal(workflow.understandingComplete, false);
  assert.equal(workflow.domainSummaries.understanding.complete, false);
  assert.notEqual(workflow.domainSummaries.understanding.status, "Completed");
  assert.ok(workflow.domainSummaries.understanding.reviewDebt >= 1);
});

test("E-17: workflow reports Completed only under proven terminal conditions", async () => {
  const raw = await seedDatabase();
  for (const itemId of ["c-av", "c-ap", "c-rj", "c-fa", "c-na"]) {
    insertInterpretation(raw, { id: `i-${itemId}`, itemId });
    insertReview(raw, { itemId, interpretationId: `i-${itemId}`, status: "APPROVED" });
  }
  const result = await completion(raw);
  const workflow = derivePresalesWorkflow({
    project: { id: PROJECT, name: "P", organizationId: "org1", systemDomain: "Fire Alarm" },
    facts: { boqItems: 5, documents: 1, classified: 1, understanding: result },
  });
  assert.equal(workflow.understandingComplete, true);
  assert.equal(workflow.domainSummaries.understanding.status, "Completed");
  assert.deepEqual(workflow.domainSummaries.understanding.blockers, []);
});

test("E-18: workflow without understanding facts stays backward compatible", async () => {
  const workflow = derivePresalesWorkflow({
    project: { id: PROJECT, name: "P", organizationId: "org1", systemDomain: "Fire Alarm" },
    facts: { boqItems: 5, documents: 1, classified: 1 },
  });
  assert.equal(workflow.understandingComplete, false);
  assert.equal(workflow.domainSummaries.understanding, null);
});

test("F-19: completion population is exactly the canonical AIU-2 eligibility predicate scope", async () => {
  const raw = await seedDatabase();
  const result = await completion(raw);
  assert.equal(result.version, UNDERSTANDING_COMPLETION_VERSION);
  // Independent population count computed directly through the canonical
  // predicate over the same current-BOQ evidence scope. The completion
  // authority's eligible count must equal it exactly -- proving AI eligibility
  // was reused, never redefined, and that Merged/Rejected/downstream=0/Header
  // rows are structurally outside the population.
  const counted = Number(raw.prepare(`SELECT COUNT(*) count
    FROM ${currentBoqEvidenceFrom("b")}
    WHERE b.project_id=? AND ${currentBoqEligibleForUnderstandingPredicate("b")}`).get(PROJECT).count);
  assert.equal(result.eligible, counted);
  assert.equal(result.eligible, 5);
});

test("F-20: safeUnderstandingReviewItem review.status is the single lifecycle source for buckets", async () => {
  const raw = await seedDatabase();
  insertInterpretation(raw, { id: "i-av", itemId: "c-av" });
  const rows = await loadUnderstandingReviewRows(d1(raw), PROJECT);
  const avRow = rows.find((row) => row.boqItemId === "c-av");
  const item = safeUnderstandingReviewItem(avRow);
  // Awaiting review — the same status currentUnderstandingCompletion buckets.
  assert.equal(item.review.status, "AWAITING_REVIEW");
  const result = await completion(raw);
  assert.equal(result.reviewDebt, 1);
});
