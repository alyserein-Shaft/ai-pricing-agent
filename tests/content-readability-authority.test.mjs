import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { documentDownstreamState, contentReadableForDownstream } from "../app/domain/document-downstream-state.mjs";
import { derivePresalesWorkflow } from "../app/domain/presales-workflow-engine.mjs";
import { executeBoqExtraction } from "../worker/boq-extraction-api.mjs";

// Content-Readability Authority Fix (2026-09-16). Confirmed live audit: the
// two Central Kitchen .msg files were correctly, intentionally manually
// classified as Drawing (status=Manually Confirmed, error_code=
// UNREADABLE_CONTENT) -- there is no wrong-document-ID bug. The defect is
// that documentDownstreamState() granted `workspace`/`recommendedAction`
// (e.g. "Open drawing workspace") the moment classification was confirmed,
// with zero check on content readability -- so a human's honest "this
// belongs to the Drawing category" label was misread as "the system read
// this file" and the UI offered a downstream CTA over content that was
// never actually read. Classification authority (what type) and
// content-readability authority (can the bytes be read) are now
// independent: contentReadableForDownstream()/classificationContentReadable()
// gate every content-dependent CTA and every backend extraction/analysis
// start route, without touching classification_status, confirmed_by,
// confirmed_at, or error_code at all.

const readable = { classification_status: "Manually Confirmed" };
const unreadable = { classification_status: "Manually Confirmed", classification_error_code: "UNREADABLE_CONTENT" };

test("1. unreadable + manually confirmed Drawing keeps the classification, but grants no Drawing workspace CTA", () => {
  const state = documentDownstreamState({ predicted_type: "Drawing", ...unreadable });
  assert.equal(state.kind, "Drawing", "the manual classification itself is preserved and reported");
  assert.equal(state.pipelineStatus, "Unavailable");
  assert.equal(state.workspace, null);
  assert.notEqual(state.recommendedAction, "Open drawing workspace");
  assert.equal(state.recommendedAction, null);
});

test("2. unreadable + manually confirmed BOQ grants no Start BOQ extraction CTA", () => {
  const state = documentDownstreamState({ predicted_type: "BOQ", ...unreadable });
  assert.equal(state.kind, "BOQ");
  assert.equal(state.workspace, null);
  assert.notEqual(state.recommendedAction, "Start BOQ extraction");
});

test("3. unreadable + manually confirmed Technical Specification grants no specification extraction CTA", () => {
  const state = documentDownstreamState({ predicted_type: "Technical Specification", ...unreadable });
  assert.equal(state.kind, "Specification");
  assert.equal(state.workspace, null);
  assert.notEqual(state.recommendedAction, "Start specification extraction");
});

test("4. unreadable + manually confirmed Project Context grants no project-context extraction CTA", () => {
  const state = documentDownstreamState({ predicted_type: "Project Context", ...unreadable });
  assert.equal(state.kind, "Project Context");
  assert.equal(state.workspace, null);
  assert.notEqual(state.recommendedAction, "Start project context extraction");
});

test("5. unreadable + manually confirmed Supplier Quotation grants no supplier extraction CTA", () => {
  const state = documentDownstreamState({ predicted_type: "Supplier Quotation", ...unreadable });
  assert.equal(state.kind, "Supplier Quote");
  assert.equal(state.workspace, null);
  assert.notEqual(state.recommendedAction, "Start supplier quote extraction");
});

test("7. readable + manually confirmed Drawing keeps the Drawing workspace CTA available", () => {
  const state = documentDownstreamState({ predicted_type: "Drawing", ...readable });
  assert.equal(state.workspace, "Drawing");
  assert.equal(state.recommendedAction, "Open drawing workspace");
});

test("8a. readable + manually confirmed BOQ keeps normal extraction behavior available", () => {
  const state = documentDownstreamState({ predicted_type: "BOQ", ...readable });
  assert.equal(state.workspace, "BOQ");
  assert.equal(state.recommendedAction, "Start BOQ extraction");
});

// ---------------------------------------------------------------------------
// 6, 8b, 9, 11: real backend integration -- a direct API-level call is
// blocked before any content processing, and the human's manual
// classification (status/confirmed_by/confirmed_at/error_code) is left
// completely untouched by the rejection.
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
CREATE TABLE document_supersessions(id TEXT PRIMARY KEY, superseding_version_id TEXT, superseded_version_id TEXT, effective_from TEXT, effective_to TEXT);
CREATE TABLE document_classifications(id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, primary_type TEXT, status TEXT, manual_review_required INTEGER, error_code TEXT, confirmed_by TEXT, confirmed_at TEXT, superseded_at TEXT, classified_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE document_processing_runs(id TEXT PRIMARY KEY, document_version_id TEXT, stage TEXT, status TEXT, progress INTEGER, error_code TEXT, error_message TEXT, technical_details TEXT, suggested_action TEXT, processor_version TEXT, started_at TEXT, completed_at TEXT, updated_at TEXT);
CREATE TABLE processing_history(id TEXT PRIMARY KEY, run_id TEXT, from_status TEXT, to_status TEXT, progress INTEGER, actor TEXT, error_code TEXT, message TEXT);
CREATE TABLE document_audit_events(id TEXT PRIMARY KEY, project_id TEXT, document_id TEXT, version_id TEXT, actor_user_id TEXT, action TEXT, old_value TEXT, new_value TEXT, reason TEXT, request_id TEXT);
CREATE TABLE boq_extraction_versions(id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, classification_id TEXT, processing_run_id TEXT, version_number INTEGER, status TEXT, parser_version TEXT, ruleset_version TEXT, ocr_version TEXT, extraction_method TEXT, summary TEXT, error_code TEXT, error_message TEXT, technical_details TEXT, suggested_action TEXT, superseded_at TEXT, started_at TEXT DEFAULT CURRENT_TIMESTAMP, completed_at TEXT, created_by TEXT);
CREATE TABLE boq_items(id TEXT PRIMARY KEY, extraction_version_id TEXT, project_id TEXT, source_document_id TEXT, section_id TEXT, duplicate_of_item_id TEXT, sequence INTEGER, item_number TEXT, parent_item_number TEXT, section TEXT, subsection TEXT, hierarchy_depth INTEGER DEFAULT 0, section_path TEXT DEFAULT '[]', system_value TEXT, system_source_type TEXT, system_confidence INTEGER, category TEXT, subcategory TEXT, description TEXT, normalized_description TEXT, original_unit TEXT, normalized_unit TEXT, unit_rule TEXT, unit_confidence INTEGER, original_quantity TEXT, numeric_quantity TEXT, quantity_type TEXT, quantity_formula TEXT, quantity_confidence INTEGER, manufacturer TEXT, brand TEXT, model TEXT, part_number TEXT, specification_reference TEXT, drawing_reference TEXT, notes TEXT, alternates TEXT, included_accessories TEXT, excluded_scope TEXT, row_type TEXT, extraction_confidence INTEGER, confidence_state TEXT, review_status TEXT, source_location TEXT DEFAULT '{}', original_raw_values TEXT DEFAULT '[]', current_values TEXT DEFAULT '{}', approved_for_downstream INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE boq_review_decisions(id TEXT PRIMARY KEY, extraction_version_id TEXT, item_id TEXT, action TEXT, previous_value TEXT, new_value TEXT, reason TEXT, decided_by TEXT, decided_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE processing_logs(id TEXT PRIMARY KEY, run_id TEXT, level TEXT, stage TEXT, message TEXT, details TEXT);
CREATE TABLE boq_extraction_sources(id TEXT PRIMARY KEY, extraction_version_id TEXT, source_kind TEXT, label TEXT, sheet_name TEXT, page_number INTEGER, classification TEXT, hidden INTEGER, header_rows TEXT, column_mapping TEXT, merged_ranges TEXT, metadata TEXT);
CREATE TABLE boq_sections(id TEXT PRIMARY KEY);
CREATE TABLE boq_extraction_evidence(id TEXT PRIMARY KEY, extraction_version_id TEXT, item_id TEXT, field_name TEXT, source_kind TEXT, source_location TEXT, raw_value TEXT, normalized_value TEXT, confidence INTEGER, method TEXT);
CREATE TABLE boq_extraction_warnings(id TEXT PRIMARY KEY, extraction_version_id TEXT, item_id TEXT, code TEXT, severity TEXT, message TEXT, source_location TEXT);
CREATE TABLE boq_revision_comparisons(id TEXT PRIMARY KEY);
`;

const seedFixture = ({ errorCode = null, extension = "msg" } = {}) => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  raw.prepare(
    `INSERT INTO document_classifications VALUES ('c1','doc1','dv1','BOQ','Manually Confirmed',0,?,'estimator_1','2026-09-01T10:00:00Z',NULL,'2026-09-01T10:00:00Z')`,
  ).run(errorCode);
  raw.prepare(
    `INSERT INTO document_versions VALUES ('dv1','doc1',?,?,'obj1',NULL,NULL,NULL)`,
  ).run(`file.${extension}`, extension);
  raw.exec(`
    INSERT INTO projects VALUES ('p1','owner1','org1','TesT',NULL);
    INSERT INTO documents VALUES ('doc1','p1','BOQ','Manual/Unclassified','dv1',NULL,NULL);
  `);
  return {
    raw,
    env: {
      DB: d1(raw),
      FILES: { get: async () => ({ arrayBuffer: async () => new TextEncoder().encode("Item,Description,Unit,Quantity\n1,Addressable smoke detector,Each,50").buffer }) },
    },
  };
};

test("6 & 11. a direct backend call for an unreadable, manually-confirmed document is blocked before any content processing, and produces no extracted evidence", async () => {
  const { raw, env } = seedFixture({ errorCode: "UNREADABLE_CONTENT" });
  await assert.rejects(
    () => executeBoqExtraction(env, { documentId: "doc1", userId: "owner1" }),
    (error) => {
      assert.equal(error.code, "DOCUMENT_CONTENT_UNREADABLE");
      assert.match(error.message, /manually classified.*content cannot be read/i);
      assert.match(error.suggestedAction, /readable version/i);
      return true;
    },
  );
  const extractionCount = raw.prepare("SELECT COUNT(*) count FROM boq_extraction_versions").get().count;
  const itemCount = raw.prepare("SELECT COUNT(*) count FROM boq_items").get().count;
  assert.equal(extractionCount, 0, "no extraction version may be created for unreadable content");
  assert.equal(itemCount, 0, "no BOQ items -- no extracted evidence -- may be created for unreadable content");
});

test("8b. readable + manually confirmed BOQ extraction proceeds normally end to end (unchanged behavior)", async () => {
  const { raw, env } = seedFixture({ errorCode: null, extension: "csv" });
  const result = await executeBoqExtraction(env, { documentId: "doc1", userId: "owner1" });
  assert.ok(result.extractionId);
  const itemCount = raw.prepare("SELECT COUNT(*) count FROM boq_items").get().count;
  assert.ok(itemCount > 0, "a readable document must still extract normally");
});

test("9. rejecting an unreadable document leaves the human's manual classification audit trail completely untouched", async () => {
  const { raw, env } = seedFixture({ errorCode: "UNREADABLE_CONTENT" });
  const before = raw.prepare("SELECT * FROM document_classifications WHERE id='c1'").get();
  await assert.rejects(() => executeBoqExtraction(env, { documentId: "doc1", userId: "owner1" }));
  const after = raw.prepare("SELECT * FROM document_classifications WHERE id='c1'").get();
  assert.deepEqual(after, before, "no field of the classification row -- status, error_code, confirmed_by, confirmed_at -- may change as a side effect of the rejected extraction attempt");
  assert.equal(after.status, "Manually Confirmed");
  assert.equal(after.primary_type, "BOQ");
  assert.equal(after.error_code, "UNREADABLE_CONTENT");
  assert.equal(after.confirmed_by, "estimator_1");
});

// ---------------------------------------------------------------------------
// 10: global intake behavior preserved (no regression of the prior sprint's
// resolved-document fix).
// ---------------------------------------------------------------------------

test("10. an unsupported/unreadable document still counts as intake-resolved (global Document Intake stays Complete)", () => {
  const result = derivePresalesWorkflow({
    project: { id: "p1", name: "TesT", organizationId: "org1", systemDomain: "Fire Alarm" },
    facts: { documents: 8, classified: 6, unsupported: 2 },
  });
  assert.equal(result.stages.find((s) => s.id === "intake").status, "Completed");
  // ...while the SPECIFIC unreadable document's own Drawing analysis is
  // separately, correctly Unavailable -- these are deliberately different
  // truths (Task 8).
  const drawingState = documentDownstreamState({ predicted_type: "Drawing", ...unreadable });
  assert.equal(drawingState.pipelineStatus, "Unavailable");
});

// ---------------------------------------------------------------------------
// 12: UI displays manual type and unreadable content as separate truths.
// ---------------------------------------------------------------------------

test("12. the Documents UI displays the manual type and the unreadable content state as two separate, non-competing truths", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const drawingPanel = page.slice(page.indexOf("{isDrawingDocument && ("), page.indexOf("{isBoqDocument && ("));
  // Classification line is untouched/still present (manual type preserved).
  assert.match(drawingPanel, /classificationStatusLine\.text/);
  // A distinct Content line appears only for unreadable documents.
  assert.match(drawingPanel, /\{unsupported && \(/);
  assert.match(drawingPanel, /Unsupported \/ unreadable/);
  // Analysis truthfully reflects "Unavailable" (from pipelineStatus), not a
  // fallback "Not Started" -- pipelineStatus is always a real, truthy
  // string ("Unavailable" included) once downstream_state exists.
  assert.match(drawingPanel, /downstreamState\?\.pipelineStatus \|\| "Not Started"/);
});

// ---------------------------------------------------------------------------
// Backend route wiring: the other 4 extraction/analysis start routes each
// reuse the one shared helper/error contract, not ad hoc duplicated gates.
// ---------------------------------------------------------------------------

test("backend: specification, project context, supplier quote and drawing intake routes all reuse the shared classificationContentReadable/DOCUMENT_CONTENT_UNREADABLE_ERROR contract", () => {
  const files = [
    "../worker/specification-extraction-api.mjs",
    "../worker/project-context-api.mjs",
    "../worker/supplier-price-intake-api.mjs",
    "../worker/drawing-intake-api.mjs",
  ];
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /classificationContentReadable/, `${file} must call the shared readability gate`);
    assert.match(source, /DOCUMENT_CONTENT_UNREADABLE_ERROR/, `${file} must use the shared error contract`);
  }
});

test("contentReadableForDownstream / classificationContentReadable agree on the canonical field and are independent of classification status", () => {
  assert.equal(contentReadableForDownstream({}), true);
  assert.equal(contentReadableForDownstream({ classification_error_code: "UNREADABLE_CONTENT" }), false);
  assert.equal(contentReadableForDownstream({ classification_error_code: "OCR_REQUIRED" }), true, "OCR_REQUIRED is a different, still-actionable state");
  assert.equal(contentReadableForDownstream({ classification_status: "Needs Review" }), true, "an unconfirmed classification is not, by itself, an unreadable one");
});
