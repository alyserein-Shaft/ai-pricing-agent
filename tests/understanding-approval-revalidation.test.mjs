import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import { loadUnderstandingReviewRows, mutateUnderstandingReview, understandingReviewSelectionAuthority, safeUnderstandingReviewItem } from "../worker/estimator-understanding-review-api.mjs";
import { prepareBoqUnderstandingInput, validateAndMergeBoqInterpretation, interpretationInputFingerprint } from "../app/domain/boq-understanding-engine.mjs";
import { confirmedSpecifications } from "../worker/estimator-understanding-api.mjs";

// Sprint 1.9 -- proves the real gap found on the Opera golden run: items 28,
// 29 and 34 were genuinely APPROVED at some point, but a LATER confirmed
// specification link silently downgraded them to "NOT_ANALYZED" -- as if
// they had never been touched, with no trace of the real approval. This
// suite proves the fix: such an item is now reported as
// REVALIDATION_REQUIRED (a real, distinct, honest state), stale detection
// fires exactly when new evidence changes the effective input (never
// otherwise), and re-approval through the normal governed path (a fresh
// interpretation + a real APPROVE_INTERPRETATION decision) restores APPROVED.

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (values = []) => ({
      first: async () => raw.prepare(sql).get(...values) || null,
      all: async () => ({ results: raw.prepare(sql).all(...values) }),
      run: async () => raw.prepare(sql).run(...values),
    });
    return { ...operation(), bind: (...values) => operation(values) };
  },
  async batch(statements) {
    raw.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      raw.exec("COMMIT");
      return results;
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  },
});

const schema = `
PRAGMA foreign_keys=OFF;
CREATE TABLE projects(id TEXT PRIMARY KEY, owner_user_id TEXT, organization_id TEXT, archived_at TEXT);
CREATE TABLE documents(id TEXT PRIMARY KEY, project_id TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
CREATE TABLE document_versions(id TEXT PRIMARY KEY, document_id TEXT);
CREATE TABLE boq_extraction_versions(id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, version_number INTEGER, status TEXT, superseded_at TEXT);
CREATE TABLE boq_items(id TEXT PRIMARY KEY, project_id TEXT, row_type TEXT, extraction_version_id TEXT, source_document_id TEXT, sequence INTEGER, item_number TEXT, description TEXT, numeric_quantity REAL, original_quantity REAL, normalized_unit TEXT, original_unit TEXT, system_value TEXT, category TEXT, subcategory TEXT, manufacturer TEXT, model TEXT, part_number TEXT, current_values TEXT, source_location TEXT, review_status TEXT, approved_for_downstream INTEGER, specification_reference TEXT, system_confidence INTEGER, extraction_confidence INTEGER);
CREATE TABLE estimator_understanding_runs(id TEXT PRIMARY KEY, run_mode TEXT, parent_run_id TEXT);
CREATE TABLE estimator_item_interpretations(id TEXT PRIMARY KEY, boq_item_id TEXT, run_id TEXT, project_id TEXT, version_number INTEGER, input_fingerprint TEXT, config_fingerprint TEXT, status TEXT, validated_interpretation TEXT, error_code TEXT, model TEXT, raw_response TEXT, created_at TEXT);
CREATE TABLE boq_requirement_links(id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, requirement_id TEXT, superseded_at TEXT, status TEXT);
CREATE TABLE technical_requirements(id TEXT PRIMARY KEY, approved_for_downstream INTEGER, normalized_requirement TEXT, source_location TEXT, review_status TEXT);
`;

const buildDatabase = async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  const migration = await readFile(new URL("../drizzle/0060_estimator_understanding_review.sql", import.meta.url), "utf8");
  raw.exec(migration);
  return raw;
};

const PROJECT_ID = "p1";
const ITEM_ID = "boq-mcp-1";
const rawItemFixture = { system_value: "28.01 - Fire Alarm System", category: null, subcategory: null, description: "Manual Call Point MCLP", model: null, part_number: null };

const seedProjectAndItem = (raw) => {
  raw.exec(`
    INSERT INTO projects VALUES ('${PROJECT_ID}','owner1','org1',NULL);
    INSERT INTO documents VALUES ('doc1','${PROJECT_ID}','dv1',NULL,NULL);
    INSERT INTO document_versions VALUES ('dv1','doc1');
    INSERT INTO boq_extraction_versions VALUES ('ext1','doc1','dv1',1,'Completed',NULL);
  `);
  raw.prepare(`INSERT INTO boq_items (id,project_id,row_type,extraction_version_id,source_document_id,sequence,item_number,description,numeric_quantity,original_quantity,normalized_unit,original_unit,system_value,category,subcategory,manufacturer,model,part_number,current_values,source_location,review_status,approved_for_downstream,specification_reference,system_confidence,extraction_confidence)
    VALUES (?,'${PROJECT_ID}','BOQ Item','ext1','doc1',1,'34',?,16,16,'Each','Each',?,NULL,NULL,NULL,NULL,NULL,'{}',NULL,'Approved',1,NULL,95,60)`)
    .run(ITEM_ID, rawItemFixture.description, rawItemFixture.system_value);
};

// Approves the item with whatever confirmedSpecification currently applies
// (via the real prepareBoqUnderstandingInput + validateAndMergeBoqInterpretation
// + mutateUnderstandingReview -- the real governed path, no shortcuts).
const approveWithEvidence = async (raw, DB, confirmedSpecification) => {
  const input = prepareBoqUnderstandingInput({ id: ITEM_ID, rowType: "BOQ Item", description: rawItemFixture.description, numericQuantity: 16, originalQuantity: 16, normalizedUnit: "Each", originalUnit: "Each", system: rawItemFixture.system_value, category: null, subcategory: null, manufacturer: null, model: null, partNumber: null, currentValues: {}, sourceLocation: null }, confirmedSpecification);
  const inputFingerprint = interpretationInputFingerprint(input);
  const response = {
    normalizedDescription: { value: rawItemFixture.description, origin: "EXTRACTED", confidence: 100 },
    system: { value: "Fire Alarm", origin: "EXTRACTED", confidence: 95 },
    category: { value: "Manual Initiation", origin: "EXTRACTED", confidence: 90 },
    equipmentType: { value: "Manual Call Point", origin: "EXTRACTED", confidence: 90 },
    productFamily: { value: "Manual Call Point", origin: "EXTRACTED", confidence: 90 },
    technicalAttributes: [], standards: [], manufacturerEvidence: [], compatibilityRequirements: [], requiredAccessories: [],
    searchTerms: [{ value: "manual call point", origin: "EXTRACTED", confidence: 90 }], missingInformation: [], ambiguities: [], confidence: "HIGH",
  };
  const merged = validateAndMergeBoqInterpretation(input, response);
  raw.exec(`INSERT INTO estimator_understanding_runs VALUES ('run-${inputFingerprint.slice(0, 8)}',NULL,NULL)`);
  raw.prepare(`INSERT INTO estimator_item_interpretations (id,boq_item_id,run_id,project_id,version_number,input_fingerprint,config_fingerprint,status,validated_interpretation,error_code,model,raw_response,created_at)
    VALUES (?,?,?,?,(SELECT COALESCE(MAX(version_number),0)+1 FROM estimator_item_interpretations WHERE boq_item_id=?),?,'cfg1',?,?,NULL,'test-model',NULL,CURRENT_TIMESTAMP)`)
    .run(`interp-${inputFingerprint.slice(0, 8)}`, ITEM_ID, `run-${inputFingerprint.slice(0, 8)}`, PROJECT_ID, ITEM_ID, inputFingerprint, merged.status, JSON.stringify(merged.interpretation));
  const row = (await loadUnderstandingReviewRows(DB, PROJECT_ID)).find((entry) => entry.boqItemId === ITEM_ID);
  const approval = await mutateUnderstandingReview(DB, { userId: "engineer1" }, PROJECT_ID, row, { action: "APPROVE_INTERPRETATION", expectedVersion: Number(row.reviewVersion || 0), requestId: `req-${inputFingerprint.slice(0, 8)}`, selectionAuthority: understandingReviewSelectionAuthority(PROJECT_ID, row), reason: null });
  return { approval, inputFingerprint };
};

const currentRawRow = async (DB) => (await loadUnderstandingReviewRows(DB, PROJECT_ID)).find((entry) => entry.boqItemId === ITEM_ID);
const currentRow = async (DB) => safeUnderstandingReviewItem(await currentRawRow(DB));

test("unchanged evidence stays current -- an approved item with no new confirmed specification remains APPROVED", async () => {
  const raw = await buildDatabase();
  seedProjectAndItem(raw);
  const DB = d1(raw);
  const { approval } = await approveWithEvidence(raw, DB, []);
  assert.equal(approval.review.status, "APPROVED");

  const row = await currentRow(DB);
  assert.equal(row.review.status, "APPROVED", "no new evidence was linked -- the approval must still be reported as current");
});

test("approved item + new confirmed spec -- stale detection reports REVALIDATION_REQUIRED, not NOT_ANALYZED", async () => {
  const raw = await buildDatabase();
  seedProjectAndItem(raw);
  const DB = d1(raw);
  const { approval } = await approveWithEvidence(raw, DB, []);
  assert.equal(approval.review.status, "APPROVED");

  // A new, real, Confirmed+Approved specification link is added AFTER
  // approval -- exactly the real Opera scenario.
  raw.exec(`INSERT INTO technical_requirements VALUES ('req-1', 1, 'manual pull stations shall be individually addressable', NULL, 'Approved');`);
  raw.exec(`INSERT INTO boq_requirement_links VALUES ('link-1','${PROJECT_ID}','${ITEM_ID}','req-1',NULL,'Confirmed');`);

  const row = await currentRow(DB);
  assert.equal(row.review.status, "REVALIDATION_REQUIRED", "a real, previously-approved item must be reported distinctly from one that was never analyzed");
  assert.notEqual(row.review.status, "NOT_ANALYZED", "must never silently look like the approval never happened");
  assert.equal(row.review.status === "APPROVED", false, "the stale approval must not still be reported as current/authoritative");
});

test("stale item cannot be approved directly -- REVALIDATION_REQUIRED blocks every review action, same as any other unreviewable state (no weakened check)", async () => {
  const raw = await buildDatabase();
  seedProjectAndItem(raw);
  const DB = d1(raw);
  await approveWithEvidence(raw, DB, []);
  raw.exec(`INSERT INTO technical_requirements VALUES ('req-1', 1, 'manual pull stations shall be individually addressable', NULL, 'Approved');`);
  raw.exec(`INSERT INTO boq_requirement_links VALUES ('link-1','${PROJECT_ID}','${ITEM_ID}','req-1',NULL,'Confirmed');`);

  const row = await currentRawRow(DB);
  const attempt = await mutateUnderstandingReview(DB, { userId: "engineer1" }, PROJECT_ID, row, { action: "APPROVE_INTERPRETATION", expectedVersion: Number(row.reviewVersion || 0), requestId: "req-stale-approve", selectionAuthority: understandingReviewSelectionAuthority(PROJECT_ID, row), reason: null });
  assert.equal(attempt.error, "REVALIDATION_REQUIRED");
  assert.notEqual((await currentRow(DB)).review.status, "APPROVED");
});

test("revalidation/re-approval -- submitting a fresh interpretation against the new evidence and re-approving restores APPROVED through the normal governed path", async () => {
  const raw = await buildDatabase();
  seedProjectAndItem(raw);
  const DB = d1(raw);
  await approveWithEvidence(raw, DB, []);
  raw.exec(`INSERT INTO technical_requirements VALUES ('req-1', 1, 'manual pull stations shall be individually addressable', NULL, 'Approved');`);
  raw.exec(`INSERT INTO boq_requirement_links VALUES ('link-1','${PROJECT_ID}','${ITEM_ID}','req-1',NULL,'Confirmed');`);
  assert.equal((await currentRow(DB)).review.status, "REVALIDATION_REQUIRED");

  // The normal governed path: a fresh interpretation is submitted against
  // the CURRENT confirmedSpecification (matching what confirmedSpecifications()
  // would now return), then approved through the real mutateUnderstandingReview.
  const confirmedSpecification = [{ id: "req-1", normalizedRequirement: "manual pull stations shall be individually addressable", sourceLocation: null }];
  const { approval } = await approveWithEvidence(raw, DB, confirmedSpecification);
  assert.equal(approval.review.status, "APPROVED");

  const row = await currentRow(DB);
  assert.equal(row.review.status, "APPROVED", "re-approval through the normal governed path must restore a current, authoritative approval");
});

// Sprint 1.13 -- real Opera gap: /requirement-links/:id/supersede (the new
// governed correction path) never rewrites the original link row -- it stays
// status='Confirmed' forever, only superseded_at gets stamped, so history is
// never lost. confirmedSpecifications only filtered on status='Confirmed'
// with no superseded_at check, so a corrected (superseded) confirmation kept
// feeding Understanding's confirmedSpecification input as if it were still
// current -- exactly what happened to item 30's requirement_390 correction.
test("Sprint 1.13 -- a superseded Confirmed link (status stays 'Confirmed' on its own row, only superseded_at is stamped) no longer reaches confirmedSpecifications", async () => {
  const raw = await buildDatabase();
  seedProjectAndItem(raw);
  raw.exec(`INSERT INTO technical_requirements VALUES ('req-mistaken', 1, 'low frequency sounder base shall be listed to ul 268 and ul 464', NULL, 'Approved');`);
  raw.exec(`INSERT INTO technical_requirements VALUES ('req-correct', 1, 'manual pull stations shall be individually addressable', NULL, 'Approved');`);
  raw.exec(`INSERT INTO boq_requirement_links VALUES ('link-mistaken','${PROJECT_ID}','${ITEM_ID}','req-mistaken',NULL,'Confirmed');`);
  raw.exec(`INSERT INTO boq_requirement_links VALUES ('link-correct','${PROJECT_ID}','${ITEM_ID}','req-correct',NULL,'Confirmed');`);

  const beforeSpecs = await confirmedSpecifications(d1(raw), PROJECT_ID);
  assert.deepEqual(new Set((beforeSpecs[ITEM_ID] || []).map((entry) => entry.id)), new Set(["req-mistaken", "req-correct"]));

  // The governed correction: mark the mistaken link superseded, its status
  // column deliberately left untouched (exactly what /supersede does).
  raw.exec(`UPDATE boq_requirement_links SET superseded_at='2026-08-24T20:00:00.000Z' WHERE id='link-mistaken'`);
  assert.equal(raw.prepare(`SELECT status FROM boq_requirement_links WHERE id='link-mistaken'`).get().status, "Confirmed", "the original row's status must never be rewritten -- history is preserved, not deleted");

  const afterSpecs = await confirmedSpecifications(d1(raw), PROJECT_ID);
  assert.deepEqual((afterSpecs[ITEM_ID] || []).map((entry) => entry.id), ["req-correct"], "a superseded link must stop reaching confirmedSpecification immediately, on the very next read, even though its row still says status='Confirmed'");
});
