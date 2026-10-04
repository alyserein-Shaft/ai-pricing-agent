// DUP-1 — Governed Duplicate Resolution Semantics.
//
// Narrow endpoint tests against isolated :memory: fixtures (same pattern as
// tests/boq-auto-verification.test.mjs and
// tests/boq-durable-review-closure.test.mjs — no live project data).
//
// Proves both final duplicate outcomes are governable and resolvable:
//   1. False positive -> Not Duplicate (flag cleared, warning resolved,
//      governed decision + document audit evidence, safe repeat behavior).
//   2. Real duplicate -> governed Merge (self/repeat protection, atomic
//      writes, duplicate state resolved for the adjudicated pair, complete
//      governed evidence for BOTH rows, unrelated duplicate state untouched).
//
// Deliberately NOT tested here (owned by DUP-2): completion-gate semantics,
// presales-workflow boqReady, dashboard completion, UI.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { handleBoqExtractionApi } from "../worker/boq-extraction-api.mjs";
import { currentBoqEvidenceCounts } from "../worker/current-evidence-scope.mjs";

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (args = []) => ({
      first: async () => raw.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
      run: async () => raw.prepare(sql).run(...args),
    });
    return { ...operation(), bind: (...args) => operation(args) };
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
CREATE TABLE projects(id TEXT PRIMARY KEY, owner_user_id TEXT, organization_id TEXT, name TEXT, archived_at TEXT);
CREATE TABLE documents(id TEXT PRIMARY KEY, project_id TEXT, document_type TEXT, classification_source TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
CREATE TABLE document_versions(id TEXT PRIMARY KEY, document_id TEXT, original_filename TEXT, extension TEXT, object_key TEXT, revision TEXT, effective_from TEXT, effective_to TEXT);
CREATE TABLE document_supersessions(id TEXT PRIMARY KEY NOT NULL,superseding_version_id TEXT NOT NULL,superseded_version_id TEXT NOT NULL,scope_type TEXT NOT NULL CHECK (scope_type IN ('FULL_DOCUMENT','SECTION','CLAUSE','BOQ_ROW','DRAWING_REGION','EVIDENCE_ENTITY')),scope_id TEXT,supersession_type TEXT NOT NULL CHECK (supersession_type IN ('REVISION','ADDENDUM','CLARIFICATION','CORRECTION')),effective_from TEXT,effective_to TEXT,created_by TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,CHECK (superseding_version_id <> superseded_version_id),CHECK ((scope_type = 'FULL_DOCUMENT' AND scope_id IS NULL) OR (scope_type <> 'FULL_DOCUMENT' AND scope_id IS NOT NULL AND length(trim(scope_id)) > 0)),CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from));
CREATE TABLE document_classifications(id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, primary_type TEXT, status TEXT, manual_review_required INTEGER, error_code TEXT, superseded_at TEXT, classified_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE document_processing_runs(id TEXT PRIMARY KEY, document_version_id TEXT, stage TEXT, status TEXT, progress INTEGER, error_code TEXT, error_message TEXT, technical_details TEXT, suggested_action TEXT, processor_version TEXT, started_at TEXT, completed_at TEXT, updated_at TEXT);
CREATE TABLE processing_history(id TEXT PRIMARY KEY, run_id TEXT, from_status TEXT, to_status TEXT, progress INTEGER, actor TEXT, error_code TEXT, message TEXT);
CREATE TABLE document_audit_events(id TEXT PRIMARY KEY, project_id TEXT, document_id TEXT, version_id TEXT, actor_user_id TEXT, action TEXT, old_value TEXT, new_value TEXT, reason TEXT, request_id TEXT);
CREATE TABLE boq_extraction_versions(id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, classification_id TEXT, processing_run_id TEXT, version_number INTEGER, status TEXT, parser_version TEXT, ruleset_version TEXT, ocr_version TEXT, extraction_method TEXT, summary TEXT, error_code TEXT, error_message TEXT, technical_details TEXT, suggested_action TEXT, superseded_at TEXT, started_at TEXT DEFAULT CURRENT_TIMESTAMP, completed_at TEXT, created_by TEXT);
CREATE TABLE boq_items(
  id TEXT PRIMARY KEY, extraction_version_id TEXT, project_id TEXT, source_document_id TEXT, section_id TEXT, duplicate_of_item_id TEXT,
  sequence INTEGER, item_number TEXT, parent_item_number TEXT, section TEXT, subsection TEXT, hierarchy_depth INTEGER DEFAULT 0, section_path TEXT DEFAULT '[]',
  system_value TEXT, system_source_type TEXT, system_confidence INTEGER, category TEXT, subcategory TEXT,
  description TEXT, normalized_description TEXT, original_unit TEXT, normalized_unit TEXT, unit_rule TEXT, unit_confidence INTEGER,
  original_quantity TEXT, numeric_quantity TEXT, quantity_type TEXT, quantity_formula TEXT, quantity_confidence INTEGER,
  manufacturer TEXT, brand TEXT, model TEXT, part_number TEXT, specification_reference TEXT, drawing_reference TEXT, notes TEXT,
  alternates TEXT, included_accessories TEXT, excluded_scope TEXT, row_type TEXT, extraction_confidence INTEGER, confidence_state TEXT,
  review_status TEXT, source_location TEXT DEFAULT '{}', original_raw_values TEXT DEFAULT '[]', current_values TEXT DEFAULT '{}',
  approved_for_downstream INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE boq_review_decisions(id TEXT PRIMARY KEY, extraction_version_id TEXT, item_id TEXT, action TEXT, previous_value TEXT, new_value TEXT, reason TEXT, decided_by TEXT, decided_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE processing_logs(id TEXT PRIMARY KEY, run_id TEXT, level TEXT, stage TEXT, message TEXT, details TEXT);
CREATE TABLE boq_extraction_sources(id TEXT PRIMARY KEY, extraction_version_id TEXT, source_kind TEXT, label TEXT, sheet_name TEXT, page_number INTEGER, classification TEXT, hidden INTEGER, header_rows TEXT, column_mapping TEXT, merged_ranges TEXT, metadata TEXT);
CREATE TABLE boq_sections(id TEXT PRIMARY KEY);
CREATE TABLE boq_extraction_evidence(id TEXT PRIMARY KEY, extraction_version_id TEXT, item_id TEXT, field_name TEXT, source_kind TEXT, source_location TEXT, raw_value TEXT, normalized_value TEXT, confidence INTEGER, method TEXT);
CREATE TABLE boq_extraction_warnings(id TEXT PRIMARY KEY, extraction_version_id TEXT, item_id TEXT, code TEXT, severity TEXT, message TEXT, source_location TEXT, resolved_at TEXT, resolved_by TEXT, resolution TEXT);
CREATE TABLE boq_revision_comparisons(id TEXT PRIMARY KEY);
`;

const OWNER = "owner1";
const REASON = "Reviewed the repeated schedule rows against the source workbook; confirmed the duplicate finding.";

const seedFixture = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  raw.exec(`
    INSERT INTO projects VALUES ('p1','${OWNER}','org1','Duplicate Semantics',NULL);
    INSERT INTO documents VALUES ('doc1','p1','BOQ','Manual/Unclassified','dv1',NULL,NULL);
    INSERT INTO document_versions (id, document_id, original_filename, extension, object_key, revision) VALUES ('dv1','doc1','boq.csv','csv','obj1',NULL);
    INSERT INTO document_classifications VALUES ('c1','doc1','dv1','BOQ','Manually Confirmed',0,NULL,NULL,CURRENT_TIMESTAMP);
    INSERT INTO boq_extraction_versions VALUES ('ex1','doc1','dv1',NULL,NULL,1,'Completed','v1','v1','v1',NULL,'{}',NULL,NULL,NULL,NULL,NULL,CURRENT_TIMESTAMP,NULL,'${OWNER}');
  `);
  return {
    raw,
    env: {
      DB: d1(raw),
      FILES: { get: async () => null, put: async () => {}, delete: async () => {} },
      APP_ACCESS_MODE: "single-user",
      APP_USER_ID: OWNER,
      APP_ORGANIZATION_ID: "org1",
    },
  };
};

let itemSequence = 0;
const insertItem = (raw, { id, description, unit = "Each", quantity = "6", numericQuantity = "6", rowType = "BOQ Item", reviewStatus = "Needs Review", approved = 0, duplicateOf = null }) => {
  itemSequence += 1;
  const currentValues = JSON.stringify({ description, unit, normalizedUnit: unit, quantity, numericQuantity: numericQuantity === null ? null : Number(numericQuantity), rowType });
  raw.prepare(
    `INSERT INTO boq_items (id, extraction_version_id, project_id, source_document_id, duplicate_of_item_id, sequence, description, normalized_description, original_unit, normalized_unit, original_quantity, numeric_quantity, row_type, extraction_confidence, confidence_state, review_status, source_location, original_raw_values, current_values, approved_for_downstream)
     VALUES (?, 'ex1', 'p1', 'doc1', ?, ?, ?, ?, ?, ?, ?, ?, ?, 99, 'High Confidence', ?, '{}', '[]', ?, ?)`,
  ).run(id, duplicateOf, itemSequence, description, description, unit, unit, quantity, numericQuantity, rowType, reviewStatus, currentValues, approved);
};

const insertWarning = (raw, { id, itemId, code = "POSSIBLE_DUPLICATE", severity = "Medium", message = "Possible duplicate" }) =>
  raw.prepare("INSERT INTO boq_extraction_warnings (id, extraction_version_id, item_id, code, severity, message, source_location) VALUES (?, 'ex1', ?, ?, ?, ?, '{}')").run(id, itemId, code, severity, message);

const request = (path, { method = "POST", body } = {}) =>
  new Request(`https://app.example${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const itemRow = (raw, id) => raw.prepare("SELECT * FROM boq_items WHERE id=?").get(id);
const warningRow = (raw, id) => raw.prepare("SELECT * FROM boq_extraction_warnings WHERE id=?").get(id);
const decisions = (raw, { itemId = null, action = null } = {}) =>
  raw.prepare("SELECT * FROM boq_review_decisions WHERE (? IS NULL OR item_id=?) AND (? IS NULL OR action=?) ORDER BY decided_at, id").all(itemId, itemId, action, action);
const auditEvents = (raw, action) => raw.prepare("SELECT * FROM document_audit_events WHERE action=? ORDER BY id").all(action);

// ---------------------------------------------------------------------------
// NOT DUPLICATE
// ---------------------------------------------------------------------------

test("ND-1. flagged row -> Not Duplicate clears duplicate_of_item_id and resolves its POSSIBLE_DUPLICATE warning", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "Addressable smoke detector" });
  insertItem(raw, { id: "item2", description: "Addressable smoke detector", duplicateOf: "item1" });
  insertWarning(raw, { id: "w-dup", itemId: "item2", message: "Possible duplicate of sequence 1" });

  const response = await handleBoqExtractionApi(request("/api/boq-items/item2/not-duplicate", { body: { reason: REASON } }), env, { waitUntil() {} });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.item.duplicate_of_item_id, null, "API must no longer report the row as a possible duplicate");
  assert.equal(itemRow(raw, "item2").duplicate_of_item_id, null, "persisted duplicate_of_item_id must be NULL");
  const warning = warningRow(raw, "w-dup");
  assert.ok(warning.resolved_at, "the POSSIBLE_DUPLICATE warning must be resolved via resolved_at");
  assert.equal(warning.resolved_by, OWNER);
});

test("ND-2. Not Duplicate leaves unrelated review/evidence state untouched", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "Addressable smoke detector" });
  insertItem(raw, { id: "item2", description: "Addressable smoke detector", duplicateOf: "item1" });
  insertItem(raw, { id: "item3", description: "Duct detector", duplicateOf: "item1" });
  insertWarning(raw, { id: "w-dup", itemId: "item2" });
  insertWarning(raw, { id: "w-unit", itemId: "item2", code: "MISSING_UNIT", severity: "High", message: "Missing unit" });
  insertWarning(raw, { id: "w-dup3", itemId: "item3" });

  const response = await handleBoqExtractionApi(request("/api/boq-items/item2/not-duplicate", { body: { reason: REASON } }), env, { waitUntil() {} });
  assert.equal(response.status, 200);
  const row = itemRow(raw, "item2");
  assert.equal(row.review_status, "Needs Review", "the row still needs its normal extraction review decision");
  assert.equal(row.approved_for_downstream, 0, "Not Duplicate must not silently approve downstream");
  assert.equal(warningRow(raw, "w-unit").resolved_at, null, "unrelated warnings on the same row stay unresolved");
  assert.equal(warningRow(raw, "w-dup3").resolved_at, null, "other rows' duplicate warnings stay unresolved");
  assert.equal(itemRow(raw, "item3").duplicate_of_item_id, "item1", "other rows' duplicate relationships stay untouched");
});

test("ND-3. Not Duplicate writes the governed review decision and the document audit event", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "Addressable smoke detector" });
  insertItem(raw, { id: "item2", description: "Addressable smoke detector", duplicateOf: "item1" });
  insertWarning(raw, { id: "w-dup", itemId: "item2" });

  const response = await handleBoqExtractionApi(request("/api/boq-items/item2/not-duplicate", { body: { reason: REASON } }), env, { waitUntil() {} });
  assert.equal(response.status, 200);

  const [decision] = decisions(raw, { itemId: "item2", action: "not-duplicate" });
  assert.ok(decision, "a governed boq_review_decisions row must exist");
  assert.equal(decision.extraction_version_id, "ex1");
  assert.equal(decision.reason, REASON);
  assert.equal(decision.decided_by, OWNER);
  assert.equal(JSON.parse(decision.previous_value).duplicateOfItemId, "item1", "decision evidence records the adjudicated duplicate relation");
  assert.equal(JSON.parse(decision.new_value).duplicateOfItemId, null);

  const [audit] = auditEvents(raw, "BOQ not-duplicate");
  assert.ok(audit, "a document_audit_events row must exist");
  assert.equal(audit.actor_user_id, OWNER);
  assert.equal(audit.reason, REASON);
  assert.equal(audit.document_id, "doc1");
});

test("ND-4. repeat Not Duplicate is safely rejected without contradictory audit/state", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "Addressable smoke detector" });
  insertItem(raw, { id: "item2", description: "Addressable smoke detector", duplicateOf: "item1" });
  insertWarning(raw, { id: "w-dup", itemId: "item2" });

  const first = await handleBoqExtractionApi(request("/api/boq-items/item2/not-duplicate", { body: { reason: REASON } }), env, { waitUntil() {} });
  assert.equal(first.status, 200);
  const second = await handleBoqExtractionApi(request("/api/boq-items/item2/not-duplicate", { body: { reason: REASON } }), env, { waitUntil() {} });
  assert.equal(second.status, 422, "an already-resolved repeat must be rejected, not silently re-applied");
  assert.equal(decisions(raw, { itemId: "item2", action: "not-duplicate" }).length, 1, "no duplicate decision rows");
  assert.equal(auditEvents(raw, "BOQ not-duplicate").length, 1, "no duplicate audit rows");
  assert.equal(itemRow(raw, "item2").duplicate_of_item_id, null);
});

test("ND-5. a non-flagged row cannot be falsely resolved as Not Duplicate", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "Addressable smoke detector" });
  insertItem(raw, { id: "item2", description: "Beam detector" });
  insertWarning(raw, { id: "w-dup", itemId: "item2" });

  const response = await handleBoqExtractionApi(request("/api/boq-items/item2/not-duplicate", { body: { reason: REASON } }), env, { waitUntil() {} });
  const body = await response.json();
  assert.equal(response.status, 422, JSON.stringify(body));
  assert.equal(decisions(raw, { itemId: "item2" }).length, 0, "no decision may be written for a non-duplicate row");
  assert.equal(warningRow(raw, "w-dup").resolved_at, null, "a stale duplicate-shaped warning must not be silently resolved by this operation");
});

test("ND-6. Not Duplicate requires a governed reason", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "Addressable smoke detector" });
  insertItem(raw, { id: "item2", description: "Addressable smoke detector", duplicateOf: "item1" });

  const response = await handleBoqExtractionApi(request("/api/boq-items/item2/not-duplicate", { body: { reason: "ok" } }), env, { waitUntil() {} });
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, "REVIEW_REASON_REQUIRED", "the existing minimum reason policy must govern this operation");
  assert.equal(itemRow(raw, "item2").duplicate_of_item_id, "item1", "no state change without a governed reason");
});

test("ND-7. Not Duplicate removes the row from the real possibleDuplicates evidence count", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "Addressable smoke detector" });
  insertItem(raw, { id: "item2", description: "Addressable smoke detector", duplicateOf: "item1" });
  assert.equal((await currentBoqEvidenceCounts(env.DB, { projectId: "p1" })).possibleDuplicates, 1);

  const response = await handleBoqExtractionApi(request("/api/boq-items/item2/not-duplicate", { body: { reason: REASON } }), env, { waitUntil() {} });
  assert.equal(response.status, 200);
  const counts = await currentBoqEvidenceCounts(env.DB, { projectId: "p1" });
  assert.equal(counts.possibleDuplicates, 0, "the cleared flag must stop counting as duplicate review debt");
});

// ---------------------------------------------------------------------------
// GOVERNED MERGE
// ---------------------------------------------------------------------------

test("MG-1. canonical duplicate pair merges: merged-away row exits duplicate state and its warning resolves", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "Addressable smoke detector" });
  insertItem(raw, { id: "item2", description: "Addressable smoke detector spare", duplicateOf: "item1" });
  insertWarning(raw, { id: "w-dup", itemId: "item2", message: "Possible duplicate of sequence 1" });

  const response = await handleBoqExtractionApi(request("/api/boq-items/item1/merge", { body: { reason: REASON, otherItemId: "item2" } }), env, { waitUntil() {} });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.item.review_status, "Needs Review", "the materially changed survivor must be re-reviewed (existing invariant)");
  assert.match(body.item.description, /Addressable smoke detector spare/, "existing merge content behavior is preserved");

  const survivor = itemRow(raw, "item1");
  const mergedAway = itemRow(raw, "item2");
  assert.equal(survivor.description, "Addressable smoke detector Addressable smoke detector spare");
  assert.equal(survivor.approved_for_downstream, 0);
  assert.equal(mergedAway.review_status, "Merged");
  assert.equal(mergedAway.approved_for_downstream, 0);
  assert.equal(mergedAway.duplicate_of_item_id, null, "the adjudicated duplicate relationship must be resolved");
  const warning = warningRow(raw, "w-dup");
  assert.ok(warning.resolved_at, "the adjudicated POSSIBLE_DUPLICATE warning must resolve");
  assert.equal(warning.resolved_by, OWNER);
});

test("MG-2. self-merge is rejected", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "Addressable smoke detector" });

  const response = await handleBoqExtractionApi(request("/api/boq-items/item1/merge", { body: { reason: REASON, otherItemId: "item1" } }), env, { waitUntil() {} });
  const body = await response.json();
  assert.equal(response.status, 422, JSON.stringify(body));
  const row = itemRow(raw, "item1");
  assert.equal(row.description, "Addressable smoke detector", "self-merge must not concatenate the row with itself");
  assert.equal(row.review_status, "Needs Review", "self-merge must not terminally mutate the row");
  assert.equal(decisions(raw, { action: "merge" }).length, 0);
});

test("MG-3. invalid or missing merge target is rejected", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "Addressable smoke detector" });
  insertItem(raw, { id: "item2", description: "Beam detector" });

  const response = await handleBoqExtractionApi(request("/api/boq-items/item1/merge", { body: { reason: REASON, otherItemId: "does-not-exist" } }), env, { waitUntil() {} });
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, "MERGE_ITEM_INVALID");
  assert.equal(itemRow(raw, "item1").description, "Addressable smoke detector");
  assert.equal(decisions(raw, { action: "merge" }).length, 0);
});

test("MG-4. repeat merge is safely rejected and does not concatenate content again", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "Addressable smoke detector" });
  insertItem(raw, { id: "item2", description: "Addressable smoke detector spare", duplicateOf: "item1" });
  insertWarning(raw, { id: "w-dup", itemId: "item2" });

  const first = await handleBoqExtractionApi(request("/api/boq-items/item1/merge", { body: { reason: REASON, otherItemId: "item2" } }), env, { waitUntil() {} });
  assert.equal(first.status, 200);
  const survivorAfterFirst = itemRow(raw, "item1").description;

  const second = await handleBoqExtractionApi(request("/api/boq-items/item1/merge", { body: { reason: REASON, otherItemId: "item2" } }), env, { waitUntil() {} });
  assert.equal(second.status, 422, "re-merging an already-merged row must be rejected");
  assert.equal(itemRow(raw, "item1").description, survivorAfterFirst, "retry must not concatenate the same row twice");
  assert.equal(decisions(raw, { action: "merge" }).length, 2, "exactly one governed decision per row from the first merge");
});

test("MG-5. a merged-away row cannot receive a further merge", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "Addressable smoke detector" });
  insertItem(raw, { id: "item2", description: "Spare detector" });
  insertItem(raw, { id: "item3", description: "Beam detector" });
  const first = await handleBoqExtractionApi(request("/api/boq-items/item1/merge", { body: { reason: REASON, otherItemId: "item2" } }), env, { waitUntil() {} });
  assert.equal(first.status, 200);

  const response = await handleBoqExtractionApi(request("/api/boq-items/item2/merge", { body: { reason: REASON, otherItemId: "item3" } }), env, { waitUntil() {} });
  assert.equal(response.status, 422, "a terminal Merged row must not be resurrected as a merge survivor");
  assert.equal(itemRow(raw, "item3").review_status, "Needs Review", "the would-be merged-away row stays untouched");
  assert.equal(itemRow(raw, "item2").description, "Spare detector", "the merged-away row content stays frozen");
});

test("MG-6. reversed pair (survivor flagged against the merged row) also resolves duplicate state", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "Addressable smoke detector", duplicateOf: "item2" });
  insertItem(raw, { id: "item2", description: "Addressable smoke detector spare" });
  insertWarning(raw, { id: "w-dup", itemId: "item1" });

  const response = await handleBoqExtractionApi(request("/api/boq-items/item1/merge", { body: { reason: REASON, otherItemId: "item2" } }), env, { waitUntil() {} });
  assert.equal(response.status, 200);
  assert.equal(itemRow(raw, "item1").duplicate_of_item_id, null, "the survivor's adjudicated duplicate flag must clear");
  const warning = warningRow(raw, "w-dup");
  assert.ok(warning.resolved_at, "the survivor's adjudicated POSSIBLE_DUPLICATE warning must resolve");
});

test("MG-7. merge writes complete governed evidence for BOTH rows", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "Addressable smoke detector" });
  insertItem(raw, { id: "item2", description: "Addressable smoke detector spare", duplicateOf: "item1" });

  const response = await handleBoqExtractionApi(request("/api/boq-items/item1/merge", { body: { reason: REASON, otherItemId: "item2" } }), env, { waitUntil() {} });
  assert.equal(response.status, 200);

  const mergeDecisions = decisions(raw, { action: "merge" });
  assert.equal(mergeDecisions.length, 2, "both the survivor and the merged-away row get their own governed decision");
  const survivorDecision = mergeDecisions.find((row) => row.item_id === "item1");
  const mergedAwayDecision = mergeDecisions.find((row) => row.item_id === "item2");
  assert.ok(survivorDecision && mergedAwayDecision);
  for (const decision of mergeDecisions) {
    assert.equal(decision.reason, REASON);
    assert.equal(decision.decided_by, OWNER);
    assert.ok(decision.decided_at, "the decision records when it was made");
  }
  assert.equal(JSON.parse(survivorDecision.new_value).mergedFromItemId, "item2", "survivor evidence records which row was merged into it");
  const mergedAwayNew = JSON.parse(mergedAwayDecision.new_value);
  assert.equal(mergedAwayNew.mergedIntoItemId, "item1", "merged-away evidence records which row survived");
  assert.equal(mergedAwayNew.reviewStatus, "Merged");

  const events = auditEvents(raw, "BOQ merge");
  assert.equal(events.length, 2, "both rows get a document audit event");
  assert.deepEqual(new Set(events.map((event) => event.actor_user_id)), new Set([OWNER]));
  assert.ok(events.every((event) => event.reason === REASON));
});

test("MG-8. merge leaves unrelated duplicate relationships and warnings untouched", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "Addressable smoke detector" });
  insertItem(raw, { id: "item2", description: "Addressable smoke detector spare", duplicateOf: "item1" });
  insertItem(raw, { id: "item3", description: "Duct detector", duplicateOf: "item1" });
  insertItem(raw, { id: "item4", description: " unrelated target " });
  insertWarning(raw, { id: "w-dup2", itemId: "item2" });
  insertWarning(raw, { id: "w-dup3", itemId: "item3" });
  insertWarning(raw, { id: "w-unit1", itemId: "item1", code: "MISSING_UNIT", severity: "High", message: "Missing unit" });

  const response = await handleBoqExtractionApi(request("/api/boq-items/item1/merge", { body: { reason: REASON, otherItemId: "item2" } }), env, { waitUntil() {} });
  assert.equal(response.status, 200);
  assert.equal(itemRow(raw, "item3").duplicate_of_item_id, "item1", "a third row's duplicate relationship is not adjudicated by this merge");
  assert.equal(warningRow(raw, "w-dup3").resolved_at, null, "a third row's duplicate warning stays outstanding for its own review");
  assert.equal(warningRow(raw, "w-unit1").resolved_at, null, "the survivor's unrelated warnings stay outstanding");
});

test("MG-9. merged-away row does not remain as permanent duplicate review debt", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "Addressable smoke detector" });
  insertItem(raw, { id: "item2", description: "Addressable smoke detector spare", duplicateOf: "item1" });
  insertWarning(raw, { id: "w-dup", itemId: "item2" });
  assert.equal((await currentBoqEvidenceCounts(env.DB, { projectId: "p1" })).possibleDuplicates, 1);

  const response = await handleBoqExtractionApi(request("/api/boq-items/item1/merge", { body: { reason: REASON, otherItemId: "item2" } }), env, { waitUntil() {} });
  assert.equal(response.status, 200);

  assert.equal((await currentBoqEvidenceCounts(env.DB, { projectId: "p1" })).possibleDuplicates, 0, "the merged pair contributes no duplicate debt");
  assert.equal(
    raw.prepare("SELECT COUNT(*) c FROM boq_items WHERE extraction_version_id='ex1' AND row_type='BOQ Item' AND review_status='Needs Review'").get().c,
    1,
    "only the survivor remains in the actionable Needs Review review state used by version closure",
  );
  assert.equal(
    raw.prepare("SELECT COUNT(*) c FROM boq_extraction_warnings WHERE item_id='item2' AND resolved_at IS NULL").get().c,
    0,
    "the merged-away row keeps no unresolved warnings",
  );
});

test("MG-10. plain content merge of two unflagged rows still works (existing behavior preserved)", async () => {
  const { raw, env } = seedFixture();
  insertItem(raw, { id: "item1", description: "Main rack" });
  insertItem(raw, { id: "item2", description: "Rack accessories" });

  const response = await handleBoqExtractionApi(request("/api/boq-items/item1/merge", { body: { reason: REASON, otherItemId: "item2" } }), env, { waitUntil() {} });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(itemRow(raw, "item1").description, "Main rack Rack accessories");
  assert.equal(itemRow(raw, "item2").review_status, "Merged");
  assert.equal(itemRow(raw, "item1").duplicate_of_item_id, null);
  assert.equal(itemRow(raw, "item2").duplicate_of_item_id, null);
});
