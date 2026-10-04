// AIU-4C — Full-Population Run Progression.
//
// Proves the canonical progression authority (loadUnderstandingProgression)
// can advance the ENTIRE eligible population across bounded batches, and that
// the per-run caps behave as BATCH SIZE rather than a total-coverage ceiling:
//
//   A. Selection        — only eligible, never-attempted, executable-lane rows
//                         are selectable (A-1..A-8)
//   B. Batch progression— repeated runs draw DIFFERENT remaining rows and
//                         cover the whole pool, then stop (B-9..B-12)
//   C. Currentness      — a current interpretation blocks a new attempt; a
//                         stale one does not (C-13..C-14)
//   D. Lanes            — primary and exploratory both advance; data-quality
//                         exclusion is explicit, never silent (D-15..D-17)
//   E. Retry separation — FAILED is retry debt, never silently new work
//                         (E-18..E-19)
//   F. Idempotency      — repeated continuation is safe and terminating
//                         (F-20..F-21)
//   G. Completion       — AIU-4A authority stays authoritative and is never
//                         short-circuited by progression (G-22..G-25)
//
// No hardcoded counts beyond this fixture's own derivable state. No engineer
// review decision is ever created by these tests.
import test from "node:test";
import assert from "node:assert/strict";

import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import { activeRows, loadUnderstandingProgression, runUnderstandingBatch } from "../worker/estimator-understanding-api.mjs";
import { currentUnderstandingCompletion } from "../worker/estimator-understanding-review-api.mjs";
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
//     chain, so the DB yields "7" where the fixture row says 7 -- a numeric 7
//     recomputes a different input_fingerprint and every row would read
//     NOT_ANALYZED instead of attempted.
//   * boq_items.source_location is NOT NULL JSON, so a missing value cannot be
//     represented and the parsed object has to be what the read path sees.
const quantityText = (value) => (value == null ? null : String(value));
const sourceLocationFor = (row) => ({ sheet: "BOQ", row: row.seq });

const proposal = {
  normalizedDescription: { value: "Manual Call Point MCLP", origin: "EXTRACTED", confidence: 95 },
  system: { value: "Fire Alarm", origin: "EXTRACTED", confidence: 95 },
  category: { value: "Manual Initiation", origin: "EXTRACTED", confidence: 90 },
  subcategory: { value: null, origin: "MISSING", confidence: 0 },
  equipmentType: { value: "Manual Call Point", origin: "EXTRACTED", confidence: 90 },
  productFamily: { value: "Manual Call Point", origin: "EXTRACTED", confidence: 90 },
  attributes: {}, manufacturerPreferences: [], manufacturerRestrictions: [], standards: [],
  compatibilityRequirements: [], requiredAccessories: [], searchTerms: [], missingInformation: [],
  ambiguities: [], engineeringNotes: [], confidence: "HIGH", reviewReasons: [],
};

// A population large enough to require SEVERAL bounded batches: 30 eligible
// equipment rows (clearly analyzable) + 4 data-quality rows that selection can
// never make executable + terminal/ineligible rows that must never appear.
const ROWS = [];
for (let index = 1; index <= 30; index += 1) {
  ROWS.push({ id: `p-${index}`, seq: index, description: `Manual Call Point MCLP type ${index}`, qty: index, unit: "Each", system: "28.01 - Fire Alarm System", reviewStatus: "Auto Verified", downstream: 1 });
}
ROWS.push({ id: "dq-1", seq: 31, description: "Signals to elevators with all required accessories", qty: 1, unit: "LS", system: "28.01 - Fire Alarm System", reviewStatus: "Auto Verified", downstream: 1 });
ROWS.push({ id: "dq-2", seq: 32, description: "Control of HVAC equipment and interfacing as required", qty: 1, unit: "LS", system: "28.01 - Fire Alarm System", reviewStatus: "Auto Verified", downstream: 1 });
ROWS.push({ id: "x-mg", seq: 33, description: "Manual Call Point MCLP", qty: 5, unit: "Each", system: "28.01 - Fire Alarm System", reviewStatus: "Merged", downstream: 0 });
ROWS.push({ id: "x-rj", seq: 34, description: "Cable Tray CT-9", qty: 5, unit: "Each", system: null, reviewStatus: "Rejected", downstream: 0 });
ROWS.push({ id: "x-inv", seq: 35, description: "Junction Box JB-2", qty: 6, unit: "Each", system: null, reviewStatus: "Approved", downstream: 0 });
const ROW = Object.fromEntries(ROWS.map((row) => [row.id, row]));

const inputFor = (row) => prepareBoqUnderstandingInput({
  id: row.id, rowType: "BOQ Item", description: row.description,
  numericQuantity: quantityText(row.qty), originalQuantity: quantityText(row.qty),
  normalizedUnit: row.unit, originalUnit: row.unit,
  system: row.system, category: null, subcategory: null,
  manufacturer: null, model: null, partNumber: null,
  currentValues: {}, sourceLocation: sourceLocationFor(row),
});
const fpFor = (row) => interpretationInputFingerprint(inputFor(row));

const seed = async () => {
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
    INSERT INTO estimator_understanding_runs (id, project_id, organization_id, provider, model, model_version, prompt_version, schema_version, config_fingerprint, status, total_items, processed_items, successful_items, review_items, failed_items, requested_by, started_at, completed_at, run_mode, authorization_fingerprint)
      VALUES ('run0','${PROJECT}','org1','p','m','mv','pv','sv','cfg0','COMPLETED',0,0,0,0,0,'owner1','2026-09-01',NULL,'CONTROLLED_PILOT',NULL);
  `);
  const insert = raw.prepare(`INSERT INTO boq_items (id,project_id,row_type,extraction_version_id,source_document_id,sequence,item_number,description,numeric_quantity,original_quantity,normalized_unit,original_unit,system_value,category,subcategory,manufacturer,model,part_number,section_path,current_values,source_location,original_raw_values,review_status,approved_for_downstream,specification_reference,system_confidence,extraction_confidence,confidence_state)
    VALUES (?,?,'BOQ Item','ext1','doc1',?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,NULL,'[]','{}',?,'[]',?,?,NULL,95,60,'High Confidence')`);
  for (const row of ROWS) insert.run(row.id, PROJECT, row.seq, row.id, row.description, quantityText(row.qty), quantityText(row.qty), row.unit, row.unit, row.system, JSON.stringify(sourceLocationFor(row)), row.reviewStatus, row.downstream);
  return raw;
};

// Persist an interpretation exactly the way a real run does, so the
// currentness-aware already-interpreted filter sees it as covered.
const attempt = (raw, itemId, { status = "COMPLETED", fingerprint = null, version = 1 } = {}) =>
  raw.prepare(`INSERT INTO estimator_item_interpretations (id,boq_item_id,run_id,project_id,version_number,input_fingerprint,config_fingerprint,provider,model,model_version,prompt_version,schema_version,status,validated_interpretation,error_code,raw_response,created_by,created_at)
    VALUES (?,?,'run0','${PROJECT}',?,?,'cfg0','p','m','mv','pv','sv',?,? ,NULL,NULL,'owner1','2026-09-24T00:00:00Z')`)
    .run(`int-${itemId}-${version}`, itemId, version, fingerprint || fpFor(ROW[itemId]), status, JSON.stringify(proposal));

const review = (raw, itemId, interpretationId, status) =>
  raw.prepare(`INSERT INTO estimator_understanding_review_versions (id,project_id,boq_item_id,interpretation_id,version_number,review_status,canonical_interpretation,source_input_fingerprint,source_document_version_id,source_extraction_version,review_reason,reviewed_by,created_at)
    VALUES (?,? ,? ,? ,1,? ,? ,? ,'dv1',1,NULL,'eng1','2026-09-24T00:00:00Z')`)
    .run(`rv-${itemId}-${interpretationId}`, PROJECT, itemId, interpretationId, status, JSON.stringify(proposal), fpFor(ROW[itemId]));

const progression = (raw) => loadUnderstandingProgression(d1(raw), PROJECT);
const completion = (raw) => currentUnderstandingCompletion(d1(raw), PROJECT);

// Run one governed batch for real, through the production batch engine, with a
// stub provider (NO network). Rows come from the REAL activeRows read --
// exactly as executeRun passes authorized manifest rows -- so the persisted
// input fingerprints are the same ones the currentness-aware
// already-interpreted filter recomputes, which is what makes a repeated run
// genuinely exclude the rows it just attempted.
const runBatch = async (raw, itemIds) => {
  const live = await activeRows(d1(raw), PROJECT);
  const byId = new Map(live.map((row) => [row.boqItemId, row]));
  const rows = itemIds.map((id) => byId.get(id)).filter(Boolean);
  assert.equal(rows.length, itemIds.length, "every selected id must resolve to a current eligible row");
  await runUnderstandingBatch(rows, {
    provider: { metadata: { provider: "stub", model: "stub", modelVersion: "v1" } },
    configFingerprint: "cfg0",
    save: async (record) => {
      const prior = raw.prepare(`SELECT COALESCE(MAX(version_number),0) v FROM estimator_item_interpretations WHERE boq_item_id=?`).get(record.boqItemId);
      raw.prepare(`INSERT INTO estimator_item_interpretations (id,boq_item_id,run_id,project_id,version_number,input_fingerprint,config_fingerprint,provider,model,model_version,prompt_version,schema_version,status,validated_interpretation,error_code,raw_response,created_by,created_at)
        VALUES (?,?,'run0','${PROJECT}',?,? ,? ,'stub','stub','v1','prompt-v1','schema-v1',? ,? ,NULL,NULL,'owner1','2026-09-24T00:00:00Z')`)
        .run(`b-${record.boqItemId}-${prior.v + 1}`, record.boqItemId, prior.v + 1, record.inputFingerprint, record.configFingerprint, record.status, JSON.stringify(proposal));
    },
  });
  return itemIds;
};

test("A-1: eligible + never attempted is selectable", async () => {
  const raw = await seed();
  const p = await progression(raw);
  assert.ok(p.selectableNew > 0);
  assert.equal(p.attempted, 0);
  assert.equal(p.hasMoreSelectable, true);
});

test("A-2/A-3/A-4: Merged, Rejected-extraction and approved_for_downstream=0 rows are never selectable", async () => {
  const raw = await seed();
  const p = await progression(raw);
  for (const excluded of ["x-mg", "x-rj", "x-inv"]) {
    assert.ok(!p.nextBatchItemIds.includes(excluded), `${excluded} must not be selectable`);
  }
  // eligible excludes all three terminal/invalidated rows
  assert.equal(p.eligible, ROWS.filter((r) => ["Auto Verified"].includes(r.reviewStatus) && r.downstream === 1).length);
});

test("A-5/A-6: COMPLETED and NEEDS_REVIEW current interpretations are not selectable as new attempts", async () => {
  const raw = await seed();
  attempt(raw, "p-1", { status: "COMPLETED" });
  attempt(raw, "p-2", { status: "NEEDS_REVIEW" });
  const p = await progression(raw);
  assert.ok(!p.nextBatchItemIds.includes("p-1"));
  assert.ok(!p.nextBatchItemIds.includes("p-2"));
  assert.equal(p.attempted, 2);
});

test("A-7/A-8: APPROVED and REJECTED reviewed rows stay excluded from new attempts", async () => {
  const raw = await seed();
  attempt(raw, "p-1", { status: "COMPLETED" });
  attempt(raw, "p-2", { status: "COMPLETED" });
  review(raw, "p-1", "int-p-1-1", "APPROVED");
  review(raw, "p-2", "int-p-2-1", "REJECTED");
  const p = await progression(raw);
  assert.ok(!p.nextBatchItemIds.includes("p-1"));
  assert.ok(!p.nextBatchItemIds.includes("p-2"));
  assert.equal(p.terminalReviewed, 2);
});

test("B-9: a run selects at most the configured batch size", async () => {
  const raw = await seed();
  const p = await progression(raw);
  assert.ok(p.nextBatchSize <= 13, `batch ${p.nextBatchSize} must respect the 10+3 caps`);
  assert.ok(p.selectableNew > p.nextBatchSize, "selectable pool must exceed one batch (proves caps are batch size, not a ceiling)");
});

test("B-10/B-11: repeated runs draw different remaining rows and cover the whole pool", async () => {
  const raw = await seed();
  const seen = new Set();
  let runs = 0;
  for (;;) {
    const p = await progression(raw);
    if (!p.hasMoreSelectable) break;
    const batch = await runBatch(raw, p.nextBatchItemIds);
    for (const id of batch) {
      assert.ok(!seen.has(id), `row ${id} was selected twice across runs`);
      seen.add(id);
    }
    runs += 1;
    assert.ok(runs < 20, "progression must terminate, not loop forever");
  }
  assert.equal(seen.size, 30, "every analyzable eligible row must eventually be attempted");
  assert.ok(runs >= 3, `population should require several bounded batches (took ${runs})`);
});

test("B-12: once selectable=0, the next invocation selects 0 and performs no work", async () => {
  const raw = await seed();
  for (let guard = 0; guard < 20; guard += 1) {
    const p = await progression(raw);
    if (!p.hasMoreSelectable) break;
    await runBatch(raw, p.nextBatchItemIds);
  }
  const p = await progression(raw);
  assert.equal(p.selectableNew, 0);
  assert.equal(p.nextBatchSize, 0);
  assert.deepEqual(p.nextBatchItemIds, []);
  assert.equal(p.hasMoreSelectable, false);
  assert.equal(p.continuation.available, false);
  assert.equal(p.runsRemaining, 0);
});

test("C-13: a current interpretation correctly blocks a duplicate new attempt", async () => {
  const raw = await seed();
  attempt(raw, "p-5", { status: "COMPLETED" });
  const p = await progression(raw);
  assert.ok(!p.nextBatchItemIds.includes("p-5"));
});

test("C-14: a stale (input-changed) interpretation does not permanently block a new attempt", async () => {
  const raw = await seed();
  // Interpretation persisted against an OLD input fingerprint: the row's
  // current input no longer matches, so it is not covered and must be
  // selectable again (re-analysis after evidence change).
  attempt(raw, "p-6", { status: "COMPLETED", fingerprint: "stale-fingerprint" });
  const p = await progression(raw);
  assert.equal(p.attempted, 0, "a stale interpretation is not a current attempt");
  assert.ok(p.selectableNew > 0);
});

test("D-15/D-16: primary and exploratory lanes both advance across runs", async () => {
  const raw = await seed();
  const first = await progression(raw);
  assert.ok(first.primarySelectable > 0, "primary lane must offer selectable work");
  assert.ok(first.nextBatchSize > 0);
  await runBatch(raw, first.nextBatchItemIds);
  const second = await progression(raw);
  assert.ok(second.selectableNew < first.selectableNew, "selectable pool must shrink after a run");
  assert.ok(second.runsRemaining <= first.runsRemaining);
});

test("D-17: data-quality-excluded rows are reported explicitly, never as ordinary backlog", async () => {
  const raw = await seed();
  const p = await progression(raw);
  assert.equal(p.unAnalysable, 2, "both data-quality rows must be reported as un-analysable");
  // They are NOT selectable, and NOT counted in the selectable pool.
  assert.equal(p.selectableNew + p.unAnalysable, p.notAnalyzed);
  assert.ok(!p.nextBatchItemIds.includes("dq-1"));
  assert.ok(!p.nextBatchItemIds.includes("dq-2"));
});

test("E-18/E-19: FAILED attempts are retry debt, never silently re-run as new work", async () => {
  const raw = await seed();
  attempt(raw, "p-7", { status: "FAILED" });
  const p = await progression(raw);
  // A current FAILED attempt is covered -> excluded from NEW-attempt selection.
  assert.ok(!p.nextBatchItemIds.includes("p-7"));
  // It is reported as debt by the AIU-4A authority, not as fresh backlog.
  assert.equal(p.analysisDebt, 1);
  assert.equal(p.notAnalyzed, p.eligible - 1);
});

test("F-20: repeated continuation is idempotent — an already-attempted row is never re-selected", async () => {
  const raw = await seed();
  const first = await progression(raw);
  const batch = await runBatch(raw, first.nextBatchItemIds);
  const second = await progression(raw);
  const overlap = batch.filter((id) => second.nextBatchItemIds.includes(id));
  assert.deepEqual(overlap, [], "the next batch must not repeat the previous batch");
});

test("F-21: a full drain is stable — re-invoking after termination changes nothing", async () => {
  const raw = await seed();
  for (let guard = 0; guard < 20; guard += 1) {
    const p = await progression(raw);
    if (!p.hasMoreSelectable) break;
    await runBatch(raw, p.nextBatchItemIds);
  }
  const before = await progression(raw);
  const after = await progression(raw);
  assert.deepEqual(after.nextBatchItemIds, before.nextBatchItemIds);
  assert.equal(after.selectableNew, 0);
});

test("G-22: notAnalyzed decreases as attempts are persisted", async () => {
  const raw = await seed();
  const before = await completion(raw);
  const p = await progression(raw);
  await runBatch(raw, p.nextBatchItemIds);
  const after = await completion(raw);
  assert.ok(after.notAnalyzed < before.notAnalyzed, "attempting rows must reduce notAnalyzed");
});

test("G-23: review debt increases truthfully after a successful batch, with no review decision created", async () => {
  const raw = await seed();
  const before = await completion(raw);
  const p = await progression(raw);
  const batchSize = p.nextBatchItemIds.length;
  await runBatch(raw, p.nextBatchItemIds);
  const after = await completion(raw);
  assert.equal(after.reviewDebt, before.reviewDebt + batchSize, "each new attempt becomes review debt");
  assert.equal(after.approved, 0, "progression must never auto-approve");
  assert.equal(after.rejected, 0, "progression must never auto-reject");
  assert.equal(after.terminalReviewed, 0);
  // No review version/event rows were created by progression.
  const versions = raw.prepare(`SELECT COUNT(*) c FROM estimator_understanding_review_versions`).get();
  const events = raw.prepare(`SELECT COUNT(*) c FROM estimator_understanding_review_events`).get();
  assert.equal(Number(versions.c), 0);
  assert.equal(Number(events.c), 0);
});

test("G-24: completion authority remains authoritative and false throughout progression", async () => {
  const raw = await seed();
  for (let guard = 0; guard < 20; guard += 1) {
    const p = await progression(raw);
    if (!p.hasMoreSelectable) break;
    await runBatch(raw, p.nextBatchItemIds);
    const c = await completion(raw);
    assert.equal(c.completion, false, "completion must stay false while review debt exists");
    assert.equal(c.approved, 0);
  }
  const final = await completion(raw);
  // Even with every analyzable row attempted, the un-analysable remainder keeps
  // completion honestly false rather than fabricating a finished stage.
  assert.equal(final.completion, false);
  assert.equal(final.notAnalyzed, 2, "only the data-quality rows remain not analyzed");
});

test("G-25: progression never mutates eligibility or the completion authority's own semantics", async () => {
  const raw = await seed();
  const before = await completion(raw);
  const p = await progression(raw);
  await runBatch(raw, p.nextBatchItemIds);
  const after = await completion(raw);
  assert.equal(after.eligible, before.eligible, "eligible population must be unchanged by progression");
  assert.equal(after.version, before.version);
});
