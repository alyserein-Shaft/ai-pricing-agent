// AIU-2 — Eligible Population & Stale Interpretation Reconciliation.
//
// Proves the single shared canonical AI Understanding eligibility predicate
// (currentBoqEligibleForUnderstandingPredicate) governs every active path:
//
//   A. the predicate itself (include/exclude truth table, A-1..A-8),
//   B. pilot/run scope via activeRows + buildBoqUnderstandingPilotManifest
//      (B-9..B-12),
//   C. review-queue population incl. the fingerprint-twin and
//      own-historical-interpretation terminal rows (C-13..C-18),
//   D. summary count derivations from exactly the eligible universe
//      (D-19..D-22),
//   E. downstream approved-understanding safety + historical preservation
//      (E-23..E-25).
//
// Seeded BOQ rows carry REAL extraction decisions (the production invariant:
// Understanding runs only after extraction is fully reviewed). No numbers are
// hardcoded beyond this fixture's own derivable state. No historical
// interpretation/review record is ever deleted or mutated by these tests.
import test from "node:test";
import assert from "node:assert/strict";

import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import { currentBoqEvidenceCounts, currentBoqEvidenceFrom, currentBoqEligibleForUnderstandingPredicate, currentBoqItemPredicate } from "../worker/current-evidence-scope.mjs";
import { activeRows } from "../worker/estimator-understanding-api.mjs";
import {
  currentApprovedUnderstandingFacts,
  loadUnderstandingReviewRows,
  mutateUnderstandingReview,
  safeUnderstandingReviewItem,
  understandingReviewSelectionAuthority,
} from "../worker/estimator-understanding-review-api.mjs";
import { buildBoqUnderstandingPilotManifest } from "../app/domain/boq-understanding-pilot.mjs";
import { summarizeUnderstandingReviewItems } from "../app/domain/estimator-understanding-review.mjs";
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
//     chain, so the DB yields "12" where the fixture row says 12 -- a numeric
//     12 recomputes a different input_fingerprint and every row would read
//     NOT_ANALYZED instead of attempted/awaiting.
//   * boq_items.source_location is NOT NULL JSON, so a missing value cannot be
//     represented and the parsed object has to be what the read path sees.
const quantityText = (value) => (value == null ? null : String(value));
const sourceLocationFor = (row) => ({ sheet: "BOQ", row: row.seq });

// Manual Call Point fixture: the exact shape already proven to pass governed
// Fire Alarm taxonomy acceptance + mutateUnderstandingReview APPROVE in
// tests/product-matching-understanding-authority.test.mjs.
const mcpProposal = {
  normalizedDescription: { value: "Manual Call Point MCLP", origin: "EXTRACTED", confidence: 95 },
  system: { value: "Fire Alarm", origin: "EXTRACTED", confidence: 95 },
  category: { value: "Manual Initiation", origin: "EXTRACTED", confidence: 90 },
  subcategory: { value: null, origin: "MISSING", confidence: 0 },
  equipmentType: { value: "Manual Call Point", origin: "EXTRACTED", confidence: 90 },
  productFamily: { value: "Manual Call Point", origin: "EXTRACTED", confidence: 90 },
  attributes: { "Mounting Type": { value: "Surface", origin: "INFERRED", confidence: 60 } },
  manufacturerPreferences: [], manufacturerRestrictions: [], standards: [], compatibilityRequirements: [],
  requiredAccessories: [], searchTerms: ["manual call point"], missingInformation: [], ambiguities: [],
  engineeringNotes: [], confidence: "HIGH", reviewReasons: [],
};

// 9 BOQ rows: 3 eligible (Auto Verified/Approved/Accepted + downstream=1),
// 2 Merged (one with its own historical interpretation, one content-identical
// twin of the eligible survivor), 1 Rejected, 1 extraction Needs Review,
// 1 invalidated approved-family row (downstream=0), 1 Header row.
const ROWS = [
  { id: "it-av", seq: 1, itemNumber: "27.1", description: "Manual Call Point MCLP", qty: 12, unit: "Each", system: "28.01 - Fire Alarm System", manufacturer: "Apollo", model: "MCP-100", partNumber: "MCP-100", reviewStatus: "Auto Verified", downstream: 1 },
  { id: "it-ap", seq: 2, itemNumber: "27.2", description: "Manual Call Point MCLP", qty: 16, unit: "Each", system: "28.01 - Fire Alarm System", manufacturer: "Apollo", model: "MCP-100", partNumber: "MCP-100", reviewStatus: "Approved", downstream: 1 },
  { id: "it-ac", seq: 3, itemNumber: "27.3", description: "Manual Call Point MCLP", qty: 8, unit: "Each", system: "28.01 - Fire Alarm System", manufacturer: "Apollo", model: "MCP-100", partNumber: "MCP-100", reviewStatus: "Accepted", downstream: 1 },
  { id: "it-mg", seq: 4, itemNumber: "27.1", description: "Manual Call Point MCLP", qty: 12, unit: "Each", system: "28.01 - Fire Alarm System", manufacturer: "Apollo", model: "MCP-100", partNumber: "MCP-100", reviewStatus: "Merged", downstream: 0 },
  { id: "it-mg2", seq: 5, itemNumber: "27.9", description: "Manual Call Point MCLP", qty: 12, unit: "Each", system: "28.01 - Fire Alarm System", manufacturer: "Apollo", model: "MCP-100", partNumber: "MCP-100", reviewStatus: "Merged", downstream: 0 },
  { id: "it-rj", seq: 6, itemNumber: "27.4", description: "Cable Tray CT-9", qty: 5, unit: "Each", system: null, manufacturer: null, model: null, partNumber: null, reviewStatus: "Rejected", downstream: 0 },
  { id: "it-nr", seq: 7, itemNumber: "27.5", description: "Conduit Pipe CP-4", qty: 20, unit: "Each", system: null, manufacturer: null, model: null, partNumber: null, reviewStatus: "Needs Review", downstream: 0 },
  { id: "it-inv", seq: 8, itemNumber: "27.6", description: "Junction Box JB-2", qty: 6, unit: "Each", system: null, manufacturer: null, model: null, partNumber: null, reviewStatus: "Approved", downstream: 0 },
  { id: "it-hd", seq: 9, itemNumber: "27", description: "Fire Alarm System Items", qty: null, unit: null, system: null, manufacturer: null, model: null, partNumber: null, reviewStatus: "Auto Verified", downstream: 1, rowType: "Header" },
];
const ROW = Object.fromEntries(ROWS.map((row) => [row.id, row]));

// Builds exactly the same prepared input worker's currentInputFor would build
// from a persisted row, so fingerprints match the production read path.
const inputFor = (row) => prepareBoqUnderstandingInput({
  id: row.id, rowType: row.rowType || "BOQ Item", description: row.description,
  numericQuantity: quantityText(row.qty), originalQuantity: quantityText(row.qty),
  normalizedUnit: row.unit, originalUnit: row.unit,
  system: row.system, category: null, subcategory: null,
  manufacturer: row.manufacturer, model: row.model, partNumber: row.partNumber,
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
    VALUES (? ,? ,? ,'ext1','doc1',? ,? ,? ,? ,? ,? ,? ,? ,NULL,NULL,? ,? ,? ,'[]','{}',? ,'[]',? ,? ,NULL,95,60,'High Confidence')`);
  for (const row of ROWS) {
    insertRow.run(
      row.id, PROJECT, row.rowType || "BOQ Item", row.seq, row.itemNumber, row.description,
      quantityText(row.qty), quantityText(row.qty), row.unit, row.unit, row.system,
      row.manufacturer, row.model, row.partNumber, JSON.stringify(sourceLocationFor(row)),
      row.reviewStatus, row.downstream,
    );
  }
  const insertInterp = raw.prepare(`INSERT INTO estimator_item_interpretations (id,boq_item_id,run_id,project_id,version_number,input_fingerprint,config_fingerprint,provider,model,model_version,prompt_version,schema_version,status,validated_interpretation,error_code,raw_response,created_by,created_at)
    VALUES (? ,? ,'run1','${PROJECT}',1,? ,'cfg1','test-provider','test-model','model-v1','prompt-v1','schema-v1','NEEDS_REVIEW',? ,NULL,NULL,'owner1','2026-09-24T00:00:00Z')`);
  // it-av and it-ap: current attempts on ELIGIBLE rows (attempted).
  insertInterp.run("interp-av", "it-av", fpFor(ROW["it-av"]), JSON.stringify(mcpProposal));
  insertInterp.run("interp-ap", "it-ap", fpFor(ROW["it-ap"]), JSON.stringify(mcpProposal));
  // it-mg: the Merged row's own HISTORICAL interpretation (must stay in the
  // database forever, never in active scope).
  insertInterp.run("interp-mg", "it-mg", fpFor(ROW["it-mg"]), JSON.stringify(mcpProposal));
  return { raw, DB: d1(raw) };
};

const decide = async (DB, row, action, { reason = null, requestId = `req-${action}` } = {}) => mutateUnderstandingReview(
  DB, { userId: "owner1" }, PROJECT, row,
  { action, expectedVersion: Number(row.reviewVersion || 0), requestId, selectionAuthority: understandingReviewSelectionAuthority(PROJECT, row), reason },
);

// ---------------------------------------------------------------------------
// A. ELIGIBILITY PREDICATE (A-1..A-8)
// ---------------------------------------------------------------------------

test("A. the shared predicate includes the approved family with downstream approval and excludes every terminal, unresolved, invalidated, and non-item row (A-1..A-8)", async () => {
  const { DB } = await seedDatabase();
  const eligible = (await DB.prepare(`SELECT b.id id FROM ${currentBoqEvidenceFrom("b")} WHERE b.project_id=? AND ${currentBoqEligibleForUnderstandingPredicate("b")} ORDER BY b.sequence`).bind(PROJECT).all()).results.map((row) => row.id);
  assert.deepEqual(eligible, ["it-av", "it-ap", "it-ac"], "eligible universe is exactly the three confirmed rows");
  assert.ok(eligible.includes("it-av"), "A-1 Auto Verified + downstream=1 included");
  assert.ok(eligible.includes("it-ap"), "A-2 Approved + downstream=1 included");
  assert.ok(eligible.includes("it-ac"), "A-3 Accepted + downstream=1 included");
  assert.ok(!eligible.includes("it-mg") && !eligible.includes("it-mg2"), "A-4 Merged excluded");
  assert.ok(!eligible.includes("it-rj"), "A-5 Rejected excluded");
  assert.ok(!eligible.includes("it-nr"), "A-6 extraction Needs Review excluded");
  assert.ok(!eligible.includes("it-inv"), "A-7 approved-family row with approved_for_downstream=0 excluded");
  assert.ok(!eligible.includes("it-hd"), "A-8 Header/non-item row excluded");

  // extractionConfirmed authority and Understanding eligibility are literally
  // the same shared predicate (AIU-1R semantic reconciliation).
  const counts = await currentBoqEvidenceCounts(DB, { projectId: PROJECT });
  assert.equal(counts.extractionConfirmed, eligible.length, "extractionConfirmed derives from the identical shared predicate");

  // currentBoqItemPredicate keeps its broader, valid meaning (all current
  // BOQ item rows) -- proving the new predicate is a distinct downstream
  // authority, not a global redefinition.
  const allItems = (await DB.prepare(`SELECT b.id id FROM ${currentBoqEvidenceFrom("b")} WHERE b.project_id=? AND ${currentBoqItemPredicate("b")}`).bind(PROJECT).all()).results.map((row) => row.id);
  assert.equal(allItems.length, 8, "row_type-only scope still sees all 8 item rows");
  assert.ok(allItems.includes("it-mg") && allItems.includes("it-rj") && allItems.includes("it-nr") && allItems.includes("it-inv"));
});

// ---------------------------------------------------------------------------
// B. PILOT / RUN SCOPE (B-9..B-12)
// ---------------------------------------------------------------------------

test("B-9/B-10. activeRows and the pilot manifest are scoped to the eligible population; Merged rows never enter or count", async () => {
  const { DB } = await seedDatabase();
  const rows = await activeRows(DB, PROJECT);
  const ids = rows.map((row) => row.boqItemId).sort();
  assert.deepEqual(ids, ["it-ac", "it-ap", "it-av"], "B-9 only eligible rows enter activeRows");
  assert.ok(!ids.includes("it-mg") && !ids.includes("it-mg2"), "B-9 Merged rows are absent");
  const manifest = buildBoqUnderstandingPilotManifest(PROJECT, rows, {});
  assert.equal(manifest.authoritativeCurrentItemCount, 3, "B-10 authoritative count = eligible universe, not all 9 rows");
});

test("B-11/B-12. confirmed rows remain selectable and the primary/exploratory lane partition still functions on eligible rows", async () => {
  const { DB } = await seedDatabase();
  const rows = await activeRows(DB, PROJECT);
  const manifest = buildBoqUnderstandingPilotManifest(PROJECT, rows, {});
  const eligible = new Set(rows.map((row) => row.boqItemId));
  assert.ok(manifest.itemIds.length >= 1, "B-11 at least one confirmed row is selectable");
  assert.ok(manifest.itemIds.every((id) => eligible.has(id)), "B-11 selection never escapes the eligible population");
  assert.equal(
    manifest.eligiblePrimaryCount + manifest.eligibleExploratoryCount + manifest.excludedDataQualityCount,
    manifest.authoritativeCurrentItemCount,
    "B-12 lanes still partition exactly the eligible rows",
  );
});

// ---------------------------------------------------------------------------
// C. REVIEW QUEUE POPULATION (C-13..C-18)
// ---------------------------------------------------------------------------

test("C-13..C-16. the review queue contains only current eligible confirmed rows", async () => {
  const { DB } = await seedDatabase();
  const rows = await loadUnderstandingReviewRows(DB, PROJECT);
  const ids = rows.map((row) => row.boqItemId).sort();
  assert.deepEqual(ids, ["it-ac", "it-ap", "it-av"], "queue = eligible universe");
  assert.ok(!ids.includes("it-mg") && !ids.includes("it-mg2"), "C-13 Merged rows absent");
  assert.ok(!ids.includes("it-rj"), "C-14 Rejected row absent");
  assert.ok(!ids.includes("it-nr"), "C-15 extraction Needs Review row absent");
  assert.ok(!ids.includes("it-inv"), "C-15 invalidated approved-family row absent");
  assert.ok(ids.includes("it-ac"), "C-16 confirmed survivor rows remain present");
  for (const row of rows) {
    assert.ok(["Approved", "Accepted", "Auto Verified"].includes(row.extractionReviewStatus), "every queued row carries a confirmed extraction decision");
    assert.equal(row.extractionApproved, 1, "every queued row is approved_for_downstream");
  }
});

test("C-17. a content-identical Merged twin cannot inherit the survivor's interpretation into active review, even with a poisoned survivor-fingerprint attempt stored on it", async () => {
  const { DB, raw } = await seedDatabase();
  // Structural impossibility #1: the input fingerprint hashes boqItemId, so
  // two rows can never share a fingerprint just by sharing content.
  assert.notEqual(fpFor(ROW["it-av"]), fpFor(ROW["it-mg2"]), "identical content still yields distinct per-row fingerprints");
  // Structural impossibility #2 (adversarial): even if a terminal row carries
  // an interpretation stamped with the SURVIVOR's exact fingerprint (a
  // simulated legacy/phantom inheritance artifact), the population predicate
  // keeps it out of active review and the count cannot inflate.
  raw.prepare(`INSERT INTO estimator_item_interpretations (id,boq_item_id,run_id,project_id,version_number,input_fingerprint,config_fingerprint,provider,model,model_version,prompt_version,schema_version,status,validated_interpretation,error_code,raw_response,created_by,created_at)
    VALUES ('interp-mg2','it-mg2','run1','${PROJECT}',1,?,'cfg1','test-provider','test-model','model-v1','prompt-v1','schema-v1','NEEDS_REVIEW',?,NULL,NULL,'owner1','2026-09-24T00:00:01Z')`)
    .run(fpFor(ROW["it-av"]), JSON.stringify(mcpProposal));
  const rows = await loadUnderstandingReviewRows(DB, PROJECT);
  const ids = rows.map((row) => row.boqItemId);
  assert.ok(ids.includes("it-av"), "survivor keeps its own attempt");
  assert.ok(!ids.includes("it-mg2"), "C-17 Merged twin with survivor-fingerprint attempt never enters active review");
  const summary = summarizeUnderstandingReviewItems(rows.map((row) => safeUnderstandingReviewItem(row)));
  assert.equal(summary.aiAttempted, 2, "attempted count cannot be inflated by a terminal row's inherited-fingerprint attempt");
});

test("C-18. a Merged row's own historical interpretation stays persisted but stays out of active review", async () => {
  const { DB, raw } = await seedDatabase();
  const kept = raw.prepare(`SELECT COUNT(*) c FROM estimator_item_interpretations WHERE boq_item_id='it-mg'`).get().c;
  assert.equal(Number(kept), 1, "C-18 historical interpretation preserved, never deleted");
  const rows = await loadUnderstandingReviewRows(DB, PROJECT);
  assert.ok(!rows.some((row) => row.boqItemId === "it-mg"), "C-18 the owning Merged row is absent from active review");
});

// ---------------------------------------------------------------------------
// D. COUNTS (D-19..D-22)
// ---------------------------------------------------------------------------

test("D-19..D-22. summary counts derive from exactly the eligible universe", async () => {
  const { DB } = await seedDatabase();
  const rows = await loadUnderstandingReviewRows(DB, PROJECT);
  const summary = summarizeUnderstandingReviewItems(rows.map((row) => safeUnderstandingReviewItem(row)));
  assert.equal(summary.authoritativeCurrentBoqItems, 3, "D-19 authoritative count = eligible population");
  assert.equal(summary.aiAttempted, 2, "D-20 only eligible rows with current attempts count (it-mg's own interpretation must not)");
  assert.equal(summary.awaitingReview, 2, "D-21 awaiting-review counts only eligible rows");
  assert.equal(summary.notAnalyzed, summary.authoritativeCurrentBoqItems - summary.aiAttempted, "D-22 notAnalyzed = eligible - attempted (identity, not hardcoding)");
  assert.equal(summary.notAnalyzed, 1, "D-22 concrete fixture value");
  assert.equal(summary.approved + summary.rejected + summary.failed + summary.revalidationRequired + summary.awaitingReview + summary.notAnalyzed, summary.authoritativeCurrentBoqItems, "states fully reconcile to the eligible population");
});

// ---------------------------------------------------------------------------
// E. DOWNSTREAM SAFETY (E-23..E-25)
// ---------------------------------------------------------------------------

test("E-23. an APPROVED interpretation attached to a Merged BOQ row is never returned by currentApprovedUnderstandingFacts", async () => {
  const { DB, raw } = await seedDatabase();
  // Adversarial hand-insert: an APPROVED review version on the terminal row,
  // satisfying the real evidence-guard trigger (correct fingerprint, current
  // extraction/document version).
  raw.prepare(`INSERT INTO estimator_understanding_review_versions (id,project_id,boq_item_id,interpretation_id,version_number,review_status,canonical_interpretation,source_input_fingerprint,source_document_version_id,source_extraction_version,review_reason,reviewed_by)
    VALUES ('rv-mg','${PROJECT}','it-mg','interp-mg',1,'APPROVED',?,?,'dv1',1,NULL,'owner1')`)
    .run(JSON.stringify(mcpProposal), fpFor(ROW["it-mg"]));
  assert.equal(await currentApprovedUnderstandingFacts(DB, PROJECT, "it-mg"), null, "E-23 approval alone is not sufficient while the source row is ineligible");
  const rows = await loadUnderstandingReviewRows(DB, PROJECT);
  assert.ok(!rows.some((row) => row.boqItemId === "it-mg"), "E-23 the terminal row is not in the active queue");
  assert.equal(Number(raw.prepare(`SELECT COUNT(*) c FROM estimator_understanding_review_versions WHERE boq_item_id='it-mg'`).get().c), 1, "E-23 the historical decision record itself is preserved");
});

test("E-24. an eligible row's governed approval remains available to downstream reuse", async () => {
  const { DB } = await seedDatabase();
  const rows = await loadUnderstandingReviewRows(DB, PROJECT);
  const row = rows.find((entry) => entry.boqItemId === "it-ap");
  await decide(DB, row, "APPROVE_INTERPRETATION");
  const facts = await currentApprovedUnderstandingFacts(DB, PROJECT, "it-ap");
  assert.ok(facts, "E-24 approved interpretation on an eligible Auto-Verified/Approved-family row is returned");
  assert.equal(facts.productFamily?.value, "Manual Call Point", "E-24 the returned facts are the approved canonical interpretation");
});

test("E-25. the current source becoming ineligible removes active downstream reuse without deleting the historical interpretation or decision", async () => {
  const { DB, raw } = await seedDatabase();
  const rows = await loadUnderstandingReviewRows(DB, PROJECT);
  const row = rows.find((entry) => entry.boqItemId === "it-ap");
  await decide(DB, row, "APPROVE_INTERPRETATION");
  assert.ok(await currentApprovedUnderstandingFacts(DB, PROJECT, "it-ap"), "precondition: approved facts available while eligible");
  // Extraction authority makes the row terminal (governed merge) afterwards.
  raw.prepare(`UPDATE boq_items SET review_status='Merged', approved_for_downstream=0 WHERE id='it-ap'`).run();
  assert.equal(await currentApprovedUnderstandingFacts(DB, PROJECT, "it-ap"), null, "E-25 ineligible current source removes active reuse");
  assert.ok(!(await loadUnderstandingReviewRows(DB, PROJECT)).some((entry) => entry.boqItemId === "it-ap"), "E-25 the row left the active queue");
  assert.equal(Number(raw.prepare(`SELECT COUNT(*) c FROM estimator_item_interpretations WHERE boq_item_id='it-ap'`).get().c), 1, "E-25 interpretation history preserved");
  assert.equal(Number(raw.prepare(`SELECT COUNT(*) c FROM estimator_understanding_review_versions WHERE boq_item_id='it-ap'`).get().c), 1, "E-25 approved review version preserved");
  assert.equal(Number(raw.prepare(`SELECT COUNT(*) c FROM estimator_understanding_review_events WHERE boq_item_id='it-ap'`).get().c), 1, "E-25 audit event preserved");
});
