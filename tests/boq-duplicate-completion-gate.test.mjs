// DUP-2 — Completion Authority / Truthful 0/0 Gate.
//
// Proves the canonical BOQ completion authority is coherent:
//   boqReady <=> boqItems > 0 AND extractionReview == 0 AND possibleDuplicates == 0
//
// Three layers, narrowest first:
//   A. pure workflow-engine truth table (the gate itself),
//   B. evidence-count lifecycle truth (Merged/Rejected terminal decisions vs
//      genuine outstanding review debt),
//   C. end-to-end: the real governed Not Duplicate / Merge operations drive
//      the real counting authority, which drives the gate,
//   D. cross-predicate agreement: the canonical gate input and the
//      document-api per-version pending predicate agree on reachable states.
//
// No completion-gate UI, dashboard semantics beyond the engine facts, or
// unrelated review statuses are tested or changed here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { derivePresalesWorkflow } from "../app/domain/presales-workflow-engine.mjs";
import { currentBoqEvidenceCounts } from "../worker/current-evidence-scope.mjs";
import { handleBoqExtractionApi } from "../worker/boq-extraction-api.mjs";

const COMPLETE_FACTS = {
  documents: 2, classified: 2, processing: 0, failedJobs: 0,
  boqItems: 3, extractionReview: 0, possibleDuplicates: 0,
  specificationExtractions: 1, requirementProfiles: 3, requirementReview: 0,
  matchedItems: 3, technicalPending: 0, technicalApproved: 3, openSafetyBlocks: 0,
  pricedItems: 3, missingPrices: 0, commercialPending: 0, commercialApproved: 3,
  finalReviewApproved: 3, openClarifications: 0, blockingClarifications: 0,
  exportsCompleted: 0, exportFailures: 0,
};
const PROJECT = { id: "p1", name: "Gate Project", organizationId: "org1", systemDomain: "Fire Alarm" };
const workflowWith = (facts) => derivePresalesWorkflow({ project: PROJECT, facts: { ...COMPLETE_FACTS, ...facts } });
const extractionStage = (workflow) => workflow.stages.find((stage) => stage.id === "extraction");

// ---------------------------------------------------------------------------
// A. GATE TRUTH TABLE
// ---------------------------------------------------------------------------

test("G-1. unresolved duplicates + extractionReview > 0 -> not ready", () => {
  const workflow = workflowWith({ boqItems: 3, extractionReview: 2, possibleDuplicates: 2 });
  assert.equal(workflow.stages.find((stage) => stage.id === "extraction").status, "Needs Review");
  assert.equal(workflow.readyForQuotation, false);
});

test("G-2. unresolved duplicates + extractionReview = 0 -> STILL not ready", () => {
  const workflow = workflowWith({ boqItems: 3, extractionReview: 0, possibleDuplicates: 2 });
  assert.equal(extractionStage(workflow).status, "Needs Review", "duplicates alone must block BOQ readiness");
  assert.equal(workflow.readyForQuotation, false);
  assert.ok(
    extractionStage(workflow).blockers.some((message) => /possible duplicate/i.test(message)),
    "the extraction stage must say why: unresolved duplicates",
  );
});

test("G-3. possibleDuplicates = 0 + extractionReview > 0 -> not ready", () => {
  const workflow = workflowWith({ boqItems: 3, extractionReview: 2, possibleDuplicates: 0 });
  assert.equal(extractionStage(workflow).status, "Needs Review");
  assert.equal(workflow.readyForQuotation, false);
});

test("G-4. possibleDuplicates = 0 + extractionReview = 0 -> ready (truthful 0/0)", () => {
  const workflow = workflowWith({ boqItems: 3, extractionReview: 0, possibleDuplicates: 0 });
  assert.equal(extractionStage(workflow).status, "Completed");
  assert.equal(workflow.readyForQuotation, true);
});

test("G-5. no boq items is never ready, with or without duplicates", () => {
  assert.equal(workflowWith({ boqItems: 0, extractionReview: 0, possibleDuplicates: 0 }).stages.find((stage) => stage.id === "extraction").status, "Ready", "docs ready but nothing extracted yet: waiting, not completed");
  assert.equal(workflowWith({ boqItems: 0, extractionReview: 0, possibleDuplicates: 0 }).readyForQuotation, false);
  assert.equal(workflowWith({ boqItems: 0, extractionReview: 0, possibleDuplicates: 5 }).readyForQuotation, false);
});

test("G-6. downstream Understanding cannot bypass the duplicate gate (canonical cascade)", () => {
  const blocked = workflowWith({ boqItems: 3, extractionReview: 0, possibleDuplicates: 2 });
  for (const stageId of ["requirements", "selection", "technical", "supplier", "costing", "quotation"]) {
    assert.notEqual(blocked.stages.find((stage) => stage.id === stageId).status, "Completed", `${stageId} must not be Completed while duplicates are unresolved`);
  }
  assert.equal(blocked.readyForQuotation, false);
  assert.equal(blocked.readyForIssue, false);
  const released = workflowWith({ boqItems: 3, extractionReview: 0, possibleDuplicates: 0 });
  assert.equal(released.readyForQuotation, true, "the same facts at truthful 0/0 release the downstream chain");
});

test("G-7. facts builders without a possibleDuplicates key default to zero (no regression for other facts sources)", () => {
  const facts = { ...COMPLETE_FACTS };
  delete facts.possibleDuplicates;
  const workflow = derivePresalesWorkflow({ project: PROJECT, facts });
  assert.equal(workflow.readyForQuotation, true, "missing duplicate facts must behave as zero duplicates, not as blocked");
});

// ---------------------------------------------------------------------------
// B. EVIDENCE-COUNT LIFECYCLE TRUTH (Merged / Rejected terminal decisions)
// ---------------------------------------------------------------------------

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
      for (const statement of statements) await statement.run();
      raw.exec("COMMIT");
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  },
});

const lifecycleFixture = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    PRAGMA foreign_keys=OFF;
    CREATE TABLE projects(id TEXT PRIMARY KEY, owner_user_id TEXT, organization_id TEXT, name TEXT, archived_at TEXT);
    CREATE TABLE documents(id TEXT PRIMARY KEY, project_id TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
    CREATE TABLE document_versions(id TEXT PRIMARY KEY, document_id TEXT, effective_from TEXT, effective_to TEXT);
    CREATE TABLE document_supersessions(id TEXT PRIMARY KEY NOT NULL,superseding_version_id TEXT NOT NULL,superseded_version_id TEXT NOT NULL,scope_type TEXT NOT NULL CHECK (scope_type IN ('FULL_DOCUMENT','SECTION','CLAUSE','BOQ_ROW','DRAWING_REGION','EVIDENCE_ENTITY')),scope_id TEXT,supersession_type TEXT NOT NULL CHECK (supersession_type IN ('REVISION','ADDENDUM','CLARIFICATION','CORRECTION')),effective_from TEXT,effective_to TEXT,created_by TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,CHECK (superseding_version_id <> superseded_version_id),CHECK ((scope_type = 'FULL_DOCUMENT' AND scope_id IS NULL) OR (scope_type <> 'FULL_DOCUMENT' AND scope_id IS NOT NULL AND length(trim(scope_id)) > 0)),CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from));
    CREATE TABLE boq_extraction_versions(id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, version_number INTEGER, status TEXT, superseded_at TEXT);
    CREATE TABLE boq_items(id TEXT PRIMARY KEY, extraction_version_id TEXT, project_id TEXT, source_document_id TEXT, duplicate_of_item_id TEXT, sequence INTEGER, row_type TEXT, review_status TEXT, approved_for_downstream INTEGER, description TEXT, current_values TEXT);
    CREATE TABLE boq_extraction_warnings(id TEXT PRIMARY KEY, extraction_version_id TEXT, item_id TEXT, code TEXT, severity TEXT, message TEXT, source_location TEXT, resolved_at TEXT, resolved_by TEXT, resolution TEXT);
    INSERT INTO projects VALUES ('p1','owner1','org1','Lifecycle',NULL);
    INSERT INTO documents VALUES ('doc1','p1','dv1',NULL,NULL);
    INSERT INTO document_versions (id, document_id) VALUES ('dv1','doc1');
    INSERT INTO boq_extraction_versions VALUES ('ex1','doc1','dv1',1,'Needs Review',NULL);
  `);
  const insertItem = (raw, { id, status, approved = 0, duplicateOf = null, rowType = "BOQ Item" }) =>
    raw.prepare("INSERT INTO boq_items VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(id, "ex1", "p1", "doc1", duplicateOf, 1, rowType, status, approved, `row ${id}`, JSON.stringify({ description: `row ${id}` }));
  insertItem(raw, { id: "approved", status: "Approved", approved: 1 });
  insertItem(raw, { id: "accepted", status: "Accepted", approved: 1 });
  insertItem(raw, { id: "autoverified", status: "Auto Verified", approved: 1 });
  insertItem(raw, { id: "rejected", status: "Rejected" });
  insertItem(raw, { id: "merged", status: "Merged" });
  insertItem(raw, { id: "needsreview", status: "Needs Review" });
  insertItem(raw, { id: "flagged", status: "Needs Review", duplicateOf: "approved" });
  insertItem(raw, { id: "mergedflagged", status: "Merged", duplicateOf: "accepted" });
  insertItem(raw, { id: "header", status: "Needs Review", rowType: "Section Header" });
  return raw;
};

test("L-1. terminally decided Merged/Rejected rows owe no extraction review debt", async () => {
  const raw = lifecycleFixture();
  const counts = await currentBoqEvidenceCounts(d1(raw), { projectId: "p1" });
  assert.equal(counts.currentBoqItems, 8, "every current BOQ Item row is in scope");
  assert.equal(counts.extractionNeedsReview, 2, "only the genuinely outstanding rows (needsreview, flagged) remain; Rejected/Merged are terminal decisions, not debt");
  assert.equal(counts.extractionConfirmed, 3);
  assert.equal(counts.possibleDuplicates, 2, "flag-based duplicate questions stay visible until adjudicated, including on a merged row whose third-party flag was never adjudicated");
});

test("L-2. an approved-family row that lost downstream approval still counts (invalidation fail-safe preserved)", async () => {
  const raw = lifecycleFixture();
  raw.prepare("UPDATE boq_items SET approved_for_downstream=0 WHERE id='approved'").run();
  const counts = await currentBoqEvidenceCounts(d1(raw), { projectId: "p1" });
  assert.equal(counts.extractionNeedsReview, 3, "the invalidated approved row must re-enter review debt");
});

test("L-3. Rejected and Merged rows stop blocking extraction completion once decided", async () => {
  const raw = lifecycleFixture();
  raw.prepare("UPDATE boq_items SET review_status='Rejected' WHERE id='needsreview'").run();
  raw.prepare("UPDATE boq_items SET review_status='Merged', duplicate_of_item_id=NULL WHERE id='flagged'").run();
  raw.prepare("UPDATE boq_items SET duplicate_of_item_id=NULL WHERE id='mergedflagged'").run();
  const counts = await currentBoqEvidenceCounts(d1(raw), { projectId: "p1" });
  assert.equal(counts.extractionNeedsReview, 0, "no reachable lifecycle state may leave phantom extraction debt");
  assert.equal(counts.possibleDuplicates, 0);
  const workflow = derivePresalesWorkflow({ project: PROJECT, facts: { boqItems: counts.currentBoqItems, extractionReview: counts.extractionNeedsReview, possibleDuplicates: counts.possibleDuplicates, specificationExtractions: 1, documents: 1, classified: 1 } });
  assert.equal(extractionStage(workflow).status, "Completed", "a fully decided extraction must reach workflow completion");
});

// ---------------------------------------------------------------------------
// C. END-TO-END: governed operations drive the counting authority, then the gate
// ---------------------------------------------------------------------------

const appEnv = (raw) => ({
  DB: d1(raw),
      // Fixture server-configured human identity: these suites exercise
      // human-authority mutations, which fail closed without it (see
      // tests/human-actor-attribution.test.mjs). The values are fixture-only.
      APP_HUMAN_ID: "op-test-human-01",
      APP_HUMAN_NAME: "Test Human Operator",
      APP_HUMAN_EMAIL: "human-operator@example.test",
  FILES: { get: async () => null, put: async () => {}, delete: async () => {} },
  APP_ACCESS_MODE: "single-user",
  APP_USER_ID: "owner1",
  APP_ORGANIZATION_ID: "org1",
});

const request = (path, { method = "POST", body } = {}) =>
  new Request(`https://app.example${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

const REASON = "Reviewed the flagged duplicate rows against the source workbook evidence.";

const FULL_SCHEMA = `
PRAGMA foreign_keys=OFF;
CREATE TABLE projects(id TEXT PRIMARY KEY, owner_user_id TEXT, organization_id TEXT, name TEXT, archived_at TEXT);
CREATE TABLE documents(id TEXT PRIMARY KEY, project_id TEXT, document_type TEXT, classification_source TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
CREATE TABLE document_versions(id TEXT PRIMARY KEY, document_id TEXT, original_filename TEXT, extension TEXT, object_key TEXT, revision TEXT, effective_from TEXT, effective_to TEXT);
CREATE TABLE document_supersessions(id TEXT PRIMARY KEY NOT NULL,superseding_version_id TEXT NOT NULL,superseded_version_id TEXT NOT NULL,scope_type TEXT NOT NULL CHECK (scope_type IN ('FULL_DOCUMENT','SECTION','CLAUSE','BOQ_ROW','DRAWING_REGION','EVIDENCE_ENTITY')),scope_id TEXT,supersession_type TEXT NOT NULL CHECK (supersession_type IN ('REVISION','ADDENDUM','CLARIFICATION','CORRECTION')),effective_from TEXT,effective_to TEXT,created_by TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,CHECK (superseding_version_id <> superseded_version_id),CHECK ((scope_type = 'FULL_DOCUMENT' AND scope_id IS NULL) OR (scope_type <> 'FULL_DOCUMENT' AND scope_id IS NOT NULL AND length(trim(scope_id)) > 0)),CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from));
CREATE TABLE document_classifications(id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, primary_type TEXT, status TEXT, manual_review_required INTEGER, error_code TEXT, superseded_at TEXT, classified_at TEXT DEFAULT CURRENT_TIMESTAMP);
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

const e2eFixture = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(FULL_SCHEMA);
  raw.exec(`
    INSERT INTO projects VALUES ('p1','owner1','org1','E2E',NULL);
    INSERT INTO documents VALUES ('doc1','p1','BOQ','Manual/Unclassified','dv1',NULL,NULL);
    INSERT INTO document_versions (id, document_id, original_filename, extension, object_key, revision) VALUES ('dv1','doc1','boq.csv','csv','obj1',NULL);
    INSERT INTO document_classifications VALUES ('c1','doc1','dv1','BOQ','Manually Confirmed',0,NULL,NULL,CURRENT_TIMESTAMP);
    INSERT INTO boq_extraction_versions VALUES ('ex1','doc1','dv1',NULL,NULL,1,'Needs Review','v1','v1','v1',NULL,'{}',NULL,NULL,NULL,NULL,NULL,CURRENT_TIMESTAMP,NULL,'owner1');
  `);
  const insertItem = (id, description, duplicateOf) =>
    raw.prepare(
      `INSERT INTO boq_items (id, extraction_version_id, project_id, source_document_id, duplicate_of_item_id, sequence, description, normalized_description, original_unit, normalized_unit, original_quantity, numeric_quantity, row_type, extraction_confidence, confidence_state, review_status, source_location, original_raw_values, current_values, approved_for_downstream)
       VALUES (?, 'ex1', 'p1', 'doc1', ?, ?, ?, ?, 'No', 'Each', '6', '6', 'BOQ Item', 99, 'High Confidence', 'Needs Review', '{}', '[]', ?, 0)`,
    ).run(id, duplicateOf, id === "first" ? 1 : 2, description, description, JSON.stringify({ description, unit: "No", normalizedUnit: "Each", quantity: "6", numericQuantity: 6 }));
  insertItem("first", "Addressable smoke detector", null);
  insertItem("dupe", "Addressable smoke detector", "first");
  raw.prepare("INSERT INTO boq_extraction_warnings (id, extraction_version_id, item_id, code, severity, message, source_location) VALUES ('w-dup','ex1','dupe','POSSIBLE_DUPLICATE','Medium','Possible duplicate of sequence 1','{}')").run();
  return raw;
};

test("C-1. Not Duplicate decreases possibleDuplicates; the row still owes its normal extraction review", async () => {
  const raw = e2eFixture();
  const env = appEnv(raw);
  const before = await currentBoqEvidenceCounts(env.DB, { projectId: "p1" });
  assert.deepEqual([before.possibleDuplicates, before.extractionNeedsReview], [1, 2]);

  const response = await handleBoqExtractionApi(request("/api/boq-items/dupe/not-duplicate", { body: { reason: REASON } }), env, { waitUntil() {} });
  assert.equal(response.status, 200);

  const after = await currentBoqEvidenceCounts(env.DB, { projectId: "p1" });
  assert.equal(after.possibleDuplicates, 0, "Not Duplicate resolves the duplicate question");
  assert.equal(after.extractionNeedsReview, 2, "Not Duplicate must NOT erase the normal extraction review debt of either row");

  const workflow = derivePresalesWorkflow({ project: PROJECT, facts: { boqItems: after.currentBoqItems, extractionReview: after.extractionNeedsReview, possibleDuplicates: after.possibleDuplicates, specificationExtractions: 1, documents: 1, classified: 1 } });
  assert.equal(extractionStage(workflow).status, "Needs Review", "still not ready: extraction review honestly remains");
  assert.ok(extractionStage(workflow).blockers.some((message) => /2 BOQ item\(s\) require review/.test(message)));
});

test("C-2. governed Merge decreases possibleDuplicates AND removes the merged-away row's review debt; the survivor honestly remains", async () => {
  const raw = e2eFixture();
  const env = appEnv(raw);
  const before = await currentBoqEvidenceCounts(env.DB, { projectId: "p1" });
  assert.deepEqual([before.possibleDuplicates, before.extractionNeedsReview], [1, 2]);

  const response = await handleBoqExtractionApi(request("/api/boq-items/first/merge", { body: { reason: REASON, otherItemId: "dupe" } }), env, { waitUntil() {} });
  assert.equal(response.status, 200);

  const after = await currentBoqEvidenceCounts(env.DB, { projectId: "p1" });
  assert.equal(after.possibleDuplicates, 0);
  assert.equal(after.extractionNeedsReview, 1, "only the materially changed survivor still owes review — the merged-away row is terminal");

  const workflow = derivePresalesWorkflow({ project: PROJECT, facts: { boqItems: after.currentBoqItems, extractionReview: after.extractionNeedsReview, possibleDuplicates: after.possibleDuplicates, specificationExtractions: 1, documents: 1, classified: 1 } });
  assert.equal(extractionStage(workflow).status, "Needs Review");
});

test("C-3. truthful 0/0 is reachable through the governed path: Not Duplicate then normal extraction review", async () => {
  const raw = e2eFixture();
  const env = appEnv(raw);
  await handleBoqExtractionApi(request("/api/boq-items/dupe/not-duplicate", { body: { reason: REASON } }), env, { waitUntil() {} });
  for (const itemId of ["first", "dupe"]) {
    const response = await handleBoqExtractionApi(request(`/api/boq-items/${itemId}/approve`, { body: { reason: REASON } }), env, { waitUntil() {} });
    assert.equal(response.status, 200);
  }
  const counts = await currentBoqEvidenceCounts(env.DB, { projectId: "p1" });
  assert.deepEqual([counts.extractionNeedsReview, counts.possibleDuplicates], [0, 0]);
  const workflow = workflowWith({ boqItems: counts.currentBoqItems, extractionReview: counts.extractionNeedsReview, possibleDuplicates: counts.possibleDuplicates });
  assert.equal(extractionStage(workflow).status, "Completed");
  assert.equal(workflow.readyForQuotation, true);
});

// ---------------------------------------------------------------------------
// D. CROSS-PREDICATE AGREEMENT (canonical gate input vs document-api pending)
// ---------------------------------------------------------------------------

test("D-1. the canonical extractionNeedsReview predicate and the document-api pending predicate agree on terminal statuses", () => {
  const evidenceScope = readFileSync("worker/current-evidence-scope.mjs", "utf8");
  const documentApi = readFileSync("worker/document-api.mjs", "utf8");
  const scopeList = evidenceScope.match(/extractionNeedsReview[\s\S]*?review_status NOT IN \(([^)]+)\)/)?.[1];
  // boq_items_pending is the ALIAS at the end of its subquery, so anchor on
  // the subquery itself (FROM boq_items ... NOT IN ...) rather than the name.
  const documentList = documentApi.match(/FROM boq_items bi\s*WHERE bi\.extraction_version_id=bx\.id[\s\S]*?review_status NOT IN \(([^)]+)\)/)?.[1];
  assert.ok(scopeList, "current-evidence-scope must keep an explicit terminal-status list for extractionNeedsReview");
  assert.ok(documentList, "document-api must keep its boq_items_pending terminal-status list");
  const scopeStatuses = new Set(scopeList.split(",").map((value) => value.trim().replace(/['"]/g, "")));
  const documentStatuses = new Set(documentList.split(",").map((value) => value.trim().replace(/['"]/g, "")));
  assert.deepEqual([...documentStatuses].sort(), [...scopeStatuses].sort(), "both authorities must treat exactly the same statuses as terminally decided");
});

test("D-2. no second completion predicate re-introduces Merged/Rejected as extraction review debt", () => {
  const scope = readFileSync("worker/current-evidence-scope.mjs", "utf8");
  const needsReviewMatch = scope.match(/extractionNeedsReview,/) ? scope.match(/SUM\(CASE WHEN[\s\S]*?extractionNeedsReview,/)?.[0] : null;
  assert.ok(needsReviewMatch, "extractionNeedsReview projection must exist");
  assert.match(needsReviewMatch, /'Merged'/, "Merged must be explicitly terminal in the canonical gate input");
  assert.match(needsReviewMatch, /'Rejected'/, "Rejected must be explicitly terminal in the canonical gate input");
  assert.match(needsReviewMatch, /approved_for_downstream=0\)\)/, "the invalidation fail-safe must remain scoped to the approved family");
});
