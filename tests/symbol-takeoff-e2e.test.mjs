import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

// Single-document drawing takeoff E2E (this slice's Part F). Everything runs
// through the REAL production handlers -- the symbol recognition
// listing/review API, the approved-only quantity evidence API, the coverage
// API, and the quantity-source decision API -- against an isolated
// :memory: fixture that mirrors the real table contracts. No live project
// data is touched; the historical Al Mousa School projects are never
// modified. The real Opera-PDF recognition->approve->evidence proof lives in
// tests/drawing-quantity-evidence.test.mjs; this file proves the FULL
// workflow wiring in one continuous flow, including the reassign-group-move
// and restore semantics that previously had no real-handler coverage.
//
// Explicitly out of scope (separate slices): detection recall validation,
// room/zone association, cross-sheet dedup, project-wide aggregation.
import { handleDrawingSymbolRecognitionApi } from "../worker/drawing-symbol-recognition-api.mjs";
import { handleDrawingQuantityEvidenceApi } from "../worker/drawing-quantity-evidence-api.mjs";
import { handleQuantitySourceDecisionApi, currentSelectedQuantity } from "../worker/quantity-source-decision-api.mjs";
import { buildLineBomModel } from "../worker/boq-line-bom-api.mjs";

const d1 = (sql) => ({
  prepare(text) {
    let values = [];
    return {
      bind(...next) { values = next; return this; },
      first: async () => sql.prepare(text).get(...values) ?? null,
      all: async () => ({ results: sql.prepare(text).all(...values) }),
      run: async () => sql.prepare(text).run(...values),
    };
  },
  batch: async (statements) => Promise.all(statements.map((s) => s.run())),
});

const req = (path, init) => new Request(`http://localhost${path}`, init);

const fixture = () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`
    CREATE TABLE projects(id TEXT PRIMARY KEY,owner_user_id TEXT,organization_id TEXT,archived_at TEXT);
    CREATE TABLE documents(id TEXT PRIMARY KEY,project_id TEXT,logical_name TEXT,current_version_id TEXT,deleted_at TEXT,archived_at TEXT);
    CREATE TABLE document_versions(id TEXT PRIMARY KEY,document_id TEXT,object_key TEXT,sha256 TEXT,extension TEXT,effective_from TEXT,effective_to TEXT);
    CREATE TABLE document_supersessions(id TEXT PRIMARY KEY NOT NULL,superseding_version_id TEXT NOT NULL,superseded_version_id TEXT NOT NULL,scope_type TEXT NOT NULL CHECK (scope_type IN ('FULL_DOCUMENT','SECTION','CLAUSE','BOQ_ROW','DRAWING_REGION','EVIDENCE_ENTITY')),scope_id TEXT,supersession_type TEXT NOT NULL CHECK (supersession_type IN ('REVISION','ADDENDUM','CLARIFICATION','CORRECTION')),effective_from TEXT,effective_to TEXT,created_by TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,CHECK (superseding_version_id <> superseded_version_id),CHECK ((scope_type = 'FULL_DOCUMENT' AND scope_id IS NULL) OR (scope_type <> 'FULL_DOCUMENT' AND scope_id IS NOT NULL AND length(trim(scope_id)) > 0)),CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from));
    CREATE TABLE boq_extraction_versions(id TEXT PRIMARY KEY,document_id TEXT,document_version_id TEXT,version_number INTEGER,status TEXT,superseded_at TEXT);
    CREATE TABLE drawing_symbol_recognition_versions(id TEXT PRIMARY KEY,project_id TEXT,document_id TEXT,version_number INTEGER,superseded_at TEXT);
    CREATE TABLE drawing_symbol_definitions(id TEXT PRIMARY KEY,project_id TEXT,recognition_version_id TEXT,definition_key TEXT,abbreviation TEXT,explicit_label TEXT,description TEXT,original_abbreviation TEXT,original_explicit_label TEXT,original_description TEXT,source_page INTEGER,bounding_box TEXT,shape_signatures TEXT,confidence INTEGER,evidence_text TEXT,extraction_method TEXT,review_status TEXT,merged_into_definition_id TEXT,reviewed_by TEXT,reviewed_at TEXT,review_reason TEXT,derived_from_definition_id TEXT);
    CREATE TABLE drawing_symbol_source_geometries(id TEXT PRIMARY KEY,definition_id TEXT,shape_signature TEXT,source_page INTEGER,bounding_box TEXT,geometry TEXT,geometry_fingerprint TEXT);
    CREATE TABLE drawing_symbol_occurrences(id TEXT PRIMARY KEY,recognition_version_id TEXT,definition_id TEXT,original_definition_id TEXT,occurrence_key TEXT,page_number INTEGER,bounding_box TEXT,shape_signature TEXT,nearby_text TEXT,match_basis TEXT,confidence INTEGER,review_status TEXT DEFAULT 'Needs Review',source_geometry TEXT,score_components TEXT,reviewed_by TEXT,reviewed_at TEXT,review_reason TEXT);
    CREATE TABLE drawing_symbol_review_events(id TEXT PRIMARY KEY,project_id TEXT,recognition_version_id TEXT,entity_type TEXT,entity_id TEXT,action TEXT,previous_value TEXT,new_value TEXT,reason TEXT,actor_user_id TEXT,request_id TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE drawing_quantity_evidence_coverage(id TEXT PRIMARY KEY,project_id TEXT,recognition_version_id TEXT,coverage_state TEXT,reason TEXT,set_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE boq_items(id TEXT PRIMARY KEY,project_id TEXT,source_document_id TEXT,extraction_version_id TEXT,row_type TEXT,review_status TEXT,approved_for_downstream INTEGER,numeric_quantity TEXT,original_quantity TEXT,normalized_unit TEXT,original_unit TEXT);
    CREATE TABLE estimator_understanding_review_versions(id TEXT PRIMARY KEY,project_id TEXT,boq_item_id TEXT,version_number INTEGER,review_status TEXT,canonical_interpretation TEXT);
    CREATE TABLE boq_quantity_source_decisions(id TEXT PRIMARY KEY,project_id TEXT,boq_item_id TEXT,source TEXT,selected_quantity REAL,boq_quantity REAL,drawing_quantity REAL,recognition_version_id TEXT,definition_key TEXT,reason TEXT,decided_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE safety_decisions(id TEXT PRIMARY KEY,boq_item_id TEXT,candidate_id TEXT,superseded_at TEXT,technical_eligibility TEXT,version_number INTEGER);
    -- Fixture completeness against db/schema.ts:613 and :635, for
    -- worker/primary-selection-authority.mjs (GOV-AUTH-1), which
    -- buildLineBomModel now calls on every BOM read. review_status excludes
    -- rejected candidates from the primary selection; both tables stay empty
    -- so this end-to-end flow keeps asserting the governed QUANTITY path
    -- (currentSelectedQuantity) end to end and stays uncoupled from product
    -- matching.
    CREATE TABLE product_match_candidates(id TEXT PRIMARY KEY,match_run_id TEXT,product_id TEXT,rank INTEGER,review_status TEXT NOT NULL DEFAULT 'Needs Review');
    CREATE TABLE product_match_runs(id TEXT PRIMARY KEY,boq_item_id TEXT,requirement_profile_version_id TEXT,superseded_at TEXT);
    CREATE TABLE requirement_profile_versions (id TEXT PRIMARY KEY, boq_item_id TEXT, version_number INTEGER, superseded_at TEXT);
    CREATE TABLE safety_approval_requests(id TEXT PRIMARY KEY,project_id TEXT,safety_decision_id TEXT,approval_type TEXT,approval_level INTEGER,status TEXT,entity_version INTEGER,decided_at TEXT,created_at TEXT);
    CREATE TABLE project_members(project_id TEXT,user_id TEXT,status TEXT,revoked_at TEXT);
    INSERT INTO projects VALUES('project_1','local-development-user','organization_bd_shaft_internal_pilot',NULL);
    INSERT INTO documents VALUES('doc_1','project_1','CCTV Floor Plan','dv_1',NULL,NULL);
    INSERT INTO document_versions (id, document_id, object_key, sha256, extension) VALUES('dv_1','doc_1','objects/doc_1.pdf','sha256_doc_1','pdf');
    INSERT INTO boq_extraction_versions VALUES('bev_1','doc_1','dv_1',1,'Completed',NULL);
    -- Recognition v1 has detected 5 occurrences: three matched to the RE dome
    -- camera legend definition, one matched to the D wall-camera definition,
    -- and one unmatched (unknown). None are reviewed yet.
    INSERT INTO drawing_symbol_recognition_versions VALUES('v1','project_1','doc_1',1,NULL);
    INSERT INTO drawing_symbol_definitions (id,project_id,recognition_version_id,definition_key,abbreviation,description,source_page,confidence,extraction_method,review_status) VALUES('def_re','project_1','v1','approved:row_re','RE','CEILING MOUNTED DOME CAMERA',1,96,'Explicit legend row · Approved Drawing Structural Review row','Approved');
    INSERT INTO drawing_symbol_definitions (id,project_id,recognition_version_id,definition_key,abbreviation,description,source_page,confidence,extraction_method,review_status) VALUES('def_d','project_1','v1','approved:row_d','D','WALL MOUNTED DOME CAMERA',1,96,'Explicit legend row · Approved Drawing Structural Review row','Approved');
    INSERT INTO drawing_symbol_occurrences VALUES('occ1','v1','def_re','def_re','k1',1,'{"x":100,"y":200,"width":12,"height":12}','sig:re','RE','Exact normalized vector shape signature from explicit legend definition',92,'Needs Review',NULL,NULL,NULL,NULL,NULL);
    INSERT INTO drawing_symbol_occurrences VALUES('occ2','v1','def_re','def_re','k2',1,'{"x":400,"y":600,"width":12,"height":12}','sig:re','RE','Exact normalized vector shape signature from explicit legend definition',92,'Needs Review',NULL,NULL,NULL,NULL,NULL);
    INSERT INTO drawing_symbol_occurrences VALUES('occ3','v1','def_re','def_re','k3',1,'{"x":900,"y":200,"width":12,"height":12}','sig:re','RE','Exact normalized vector shape signature from explicit legend definition',92,'Needs Review',NULL,NULL,NULL,NULL,NULL);
    INSERT INTO drawing_symbol_occurrences VALUES('occ4','v1','def_d','def_d','k4',1,'{"x":1500,"y":200,"width":12,"height":12}','sig:d','D','Approximate geometric similarity',58,'Needs Review',NULL,NULL,NULL,NULL,NULL);
    INSERT INTO drawing_symbol_occurrences VALUES('occ5','v1',NULL,NULL,'k5',1,'{"x":150,"y":900,"width":10,"height":10}','sig:unknown','FX','Repeated vector shape has no explicit legend definition',55,'Needs Review',NULL,NULL,NULL,NULL,NULL);
    -- The BOQ item (tender quantity 4) with its own APPROVED governed
    -- understanding review -- the only real governed link the comparison
    -- and Use-Drawing decision accept.
    INSERT INTO boq_items VALUES('boq_1','project_1','doc_1','bev_1','BOQ Item','Approved',1,'4','4','Each','Each');
    INSERT INTO estimator_understanding_review_versions VALUES('rev_1','project_1','boq_1',1,'APPROVED','${JSON.stringify({ system: "CCTV", productFamily: "Dome Camera" }).replace(/'/g, "''")}');
  `);
  return sql;
};

const occurrenceAction = (id, action, body = {}) =>
  req(`/api/symbol-occurrences/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: "Engineer visually confirmed this occurrence against the source drawing.", ...body }),
  });

test("single-document takeoff flow: detect -> review -> approved evidence -> coverage -> BOQ comparison -> quantity decision -> downstream consumption", async () => {
  const sql = fixture();
  const env = { DB: d1(sql), FILES: {} };
  const boqItem = { id: "boq_1", source_document_id: "doc_1", numeric_quantity: "4", original_quantity: "4" };
  const rawBoqQuantity = () => sql.prepare("SELECT numeric_quantity FROM boq_items WHERE id='boq_1'").get().numeric_quantity;

  // 1. Recognition has detected symbol occurrences and the UI's data source
  //    (GET /symbol-recognition) lists them with their review state.
  const recognition = await (await handleDrawingSymbolRecognitionApi(req("/api/documents/doc_1/symbol-recognition"), env)).json();
  assert.equal(recognition.occurrences.length, 5, "all five detected occurrences must be listed for engineer review");
  assert.ok(recognition.occurrences.every((row) => row.review_status === "Needs Review"), "detections start unreviewed, never pre-approved");
  assert.equal(recognition.unknownSymbols.length, 1, "the unmatched occurrence is visible as an unknown symbol, not hidden");

  // 2. Before any review, NOTHING counts: detected is not trusted quantity.
  const beforeReview = await (await handleDrawingQuantityEvidenceApi(req("/api/documents/doc_1/drawing-quantity-evidence"), env)).json();
  assert.equal(beforeReview.totalApprovedOccurrenceCount, 0, "unreviewed occurrences must never contribute to governed quantity evidence");
  assert.equal(beforeReview.coverageState, "Partial", "coverage defaults to Partial and is never auto-promoted");
  assert.equal(beforeReview.isEvidence, true);
  assert.equal(beforeReview.isBoqTruth, false);

  // 3. Engineer reviews occurrences through the real governed endpoints.
  for (const id of ["occ1", "occ2"]) {
    const approved = await handleDrawingSymbolRecognitionApi(occurrenceAction(id, "approve"), env);
    assert.equal(approved.status, 200);
    assert.equal((await approved.json()).status, "Approved");
  }
  const rejected = await handleDrawingSymbolRecognitionApi(occurrenceAction("occ3", "reject"), env);
  assert.equal((await rejected.json()).status, "Rejected");

  const afterApprovals = await (await handleDrawingQuantityEvidenceApi(req("/api/documents/doc_1/drawing-quantity-evidence"), env)).json();
  const reGroup = afterApprovals.groups.find((group) => group.definitionKey === "def_re");
  assert.equal(reGroup.approvedOccurrenceCount, 2, "only the two APPROVED occurrences count -- the rejected one is excluded");
  assert.deepEqual(reGroup.approvedOccurrences.map((o) => o.id).sort(), ["occ1", "occ2"], "every counted occurrence id stays traceable");
  assert.equal(reGroup.system, "CCTV", "the evidence group resolves through the real System Knowledge Registry");

  // 4. Reassignment moves an occurrence to another governed identity -- and
  //    never auto-approves: it lands Needs Review in its new group first.
  const reassigned = await handleDrawingSymbolRecognitionApi(
    occurrenceAction("occ4", "reassign", { targetDefinitionId: "def_re" }),
    env,
  );
  assert.equal(reassigned.status, 200);
  assert.equal((await reassigned.json()).status, "Needs Review", "reassignment resets to Needs Review, never auto-approves");
  const afterReassign = await (await handleDrawingQuantityEvidenceApi(req("/api/documents/doc_1/drawing-quantity-evidence"), env)).json();
  assert.equal(afterReassign.groups.find((g) => g.definitionKey === "def_re").approvedOccurrenceCount, 2, "an unreviewed reassigned occurrence must not count yet");
  assert.equal(afterReassign.groups.find((g) => g.definitionKey === "def_d"), undefined, "the old identity has no approved occurrences left");
  const approveReassigned = await handleDrawingSymbolRecognitionApi(occurrenceAction("occ4", "approve"), env);
  assert.equal((await approveReassigned.json()).status, "Approved");
  const afterReassignApprove = await (await handleDrawingQuantityEvidenceApi(req("/api/documents/doc_1/drawing-quantity-evidence"), env)).json();
  assert.equal(afterReassignApprove.groups.find((g) => g.definitionKey === "def_re").approvedOccurrenceCount, 3, "once approved, the reassigned occurrence counts in its NEW identity's group");

  // 5. Restore returns the occurrence to exactly the backend-defined state
  //    (Needs Review, original definition) and the evidence reflects it live.
  const restored = await handleDrawingSymbolRecognitionApi(occurrenceAction("occ2", "restore"), env);
  const restoredBody = await restored.json();
  assert.equal(restoredBody.status, "Needs Review");
  assert.equal(restoredBody.definitionId, "def_re", "restore returns to the original definition, never invents one");
  const afterRestore = await (await handleDrawingQuantityEvidenceApi(req("/api/documents/doc_1/drawing-quantity-evidence"), env)).json();
  assert.equal(afterRestore.groups.find((g) => g.definitionKey === "def_re").approvedOccurrenceCount, 2, "a restored (unreviewed) occurrence immediately stops counting");
  const reapprove = await handleDrawingSymbolRecognitionApi(occurrenceAction("occ2", "approve"), env);
  assert.equal((await reapprove.json()).status, "Approved");

  // 6. Coverage stays explicit and engineer-governed. Under PARTIAL coverage
  //    a count mismatch is honestly inconclusive -- never a false conflict.
  const partialCompare = await (await handleDrawingQuantityEvidenceApi(
    req("/api/documents/doc_1/drawing-quantity-evidence/compare?definitionKey=def_re&boqItemId=boq_1"),
    env,
  )).json();
  assert.equal(partialCompare.comparison.status, "PARTIAL DRAWING EVIDENCE / Needs Review");
  assert.equal(partialCompare.comparison.conclusive, false, "partial coverage must never generate a false conclusive mismatch");
  assert.equal(partialCompare.comparison.drawingQuantity, 3);
  assert.equal(partialCompare.comparison.boqQuantity, 4);

  const shortReason = await handleDrawingQuantityEvidenceApi(
    req("/api/documents/doc_1/drawing-quantity-evidence/coverage", { method: "POST", body: JSON.stringify({ coverageState: "Complete / Engineer Confirmed", reason: "ok" }) }),
    env,
  );
  assert.equal(shortReason.status, 422, "coverage requires a substantive reason");

  await handleDrawingQuantityEvidenceApi(
    req("/api/documents/doc_1/drawing-quantity-evidence/coverage", { method: "POST", body: JSON.stringify({ coverageState: "Complete / Engineer Confirmed", reason: "Engineer reviewed every sheet in this drawing set in full against the source." }) }),
    env,
  );

  // 7. Under conclusive coverage the same mismatch becomes a real conflict
  //    according to the existing policy -- and only now.
  const conclusiveCompare = await (await handleDrawingQuantityEvidenceApi(
    req("/api/documents/doc_1/drawing-quantity-evidence/compare?definitionKey=def_re&boqItemId=boq_1"),
    env,
  )).json();
  assert.equal(conclusiveCompare.comparison.status, "Quantity Conflict — Needs Review");
  assert.equal(conclusiveCompare.comparison.conclusive, true);

  // 8. DRAW-QTY-1 (2026-09-27): the Drawing decision is REFUSED. The only
  //    number the server could derive is the approved-occurrence count (3),
  //    and an approved occurrence is a recognised legend row, not an
  //    installed device. Promoting it would have written the count into
  //    boq_quantity_source_decisions.selected_quantity and from there into
  //    BOM, costing, pricing, quotation and export. So the flow must fail
  //    closed, name the missing printed-count authority, and leave the BOQ
  //    quantity untouched.
  const useDrawing = await handleQuantitySourceDecisionApi(
    req("/api/boq-items/boq_1/quantity-source-decision", {
      method: "POST",
      body: JSON.stringify({ source: "Drawing", reason: "Drawing evidence reviewed; the confirmed count governs.", documentId: "doc_1", definitionKey: "def_re" }),
    }),
    env,
  );
  const useDrawingBody = await useDrawing.json();
  assert.equal(useDrawing.status, 409);
  assert.equal(useDrawingBody.error.code, "DRAWING_PRINTED_QUANTITY_REQUIRED");
  assert.equal(useDrawingBody.error.approvedOccurrenceCount, 3, "the count stays visible for recognition reporting");
  assert.equal(useDrawingBody.error.approvedOccurrenceCountIsDeviceQuantity, false, "and is never presented as a device quantity");
  assert.equal(rawBoqQuantity(), "4", "a refused Drawing decision must leave the BOQ quantity untouched");

  // 8b. With no decision of any kind, the governed read falls back to the
  //     BOQ quantity -- not to the occurrence count.
  const afterRefusal = await currentSelectedQuantity(env.DB, boqItem);
  assert.equal(afterRefusal.value, 4, "the approved-occurrence count must never be substituted for the BOQ quantity");
  assert.equal(afterRefusal.source, "BOQ");

  // 8c. The engineer's governed path is a Reviewed quantity, entered with a
  //     reason and audited exactly as before.

  // 9. Downstream BOM consumes the governed quantity, which after the refused
  //    Drawing decision is the BOQ quantity -- never the occurrence count.
  const bom = await buildLineBomModel(env, { itemId: "boq_1", userId: "local-development-user" });
  assert.equal(bom.primaryQuantity.value, 4, "BOM must consume the governed quantity, not the approved-occurrence count");
  assert.notEqual(bom.primaryQuantity.origin, "DRAWING_EVIDENCE", "a refused Drawing decision must leave no drawing origin on the BOM line");

  // 10. Use BOQ decision: the original tender quantity is re-selected.
  const useBoq = await handleQuantitySourceDecisionApi(
    req("/api/boq-items/boq_1/quantity-source-decision", { method: "POST", body: JSON.stringify({ source: "BOQ", reason: "Re-confirmed against the tender BOQ after review." }) }),
    env,
  );
  assert.equal(useBoq.status, 201);
  assert.equal((await useBoq.json()).decision.selected_quantity, 4);
  assert.equal(rawBoqQuantity(), "4", "boq_items.numeric_quantity must remain unchanged by a BOQ decision");
  const selectedBoq = await currentSelectedQuantity(env.DB, boqItem);
  assert.equal(selectedBoq.value, 4);
  assert.equal(selectedBoq.source, "BOQ");

  // 11. Reviewed quantity decision: the engineer's explicit number is used.
  const useReviewed = await handleQuantitySourceDecisionApi(
    req("/api/boq-items/boq_1/quantity-source-decision", { method: "POST", body: JSON.stringify({ source: "Reviewed", reason: "Site walk-through established the final count.", selectedQuantity: 5 }) }),
    env,
  );
  assert.equal(useReviewed.status, 201);
  assert.equal((await useReviewed.json()).decision.selected_quantity, 5);
  const selectedReviewed = await currentSelectedQuantity(env.DB, boqItem);
  assert.equal(selectedReviewed.value, 5);
  assert.equal(selectedReviewed.source, "Reviewed");

  // 11b. DRAW-QTY-1: a Reviewed decision records the engineer's own number.
  //      It must NOT also write the approved-occurrence count into
  //      drawing_quantity -- a real number in a column named for a drawing
  //      device quantity must never carry a recognition metric.
  const reviewedRow = sql.prepare("SELECT selected_quantity,boq_quantity,drawing_quantity FROM boq_quantity_source_decisions WHERE source='Reviewed'").get();
  assert.equal(reviewedRow.selected_quantity, 5);
  assert.equal(reviewedRow.boq_quantity, 4);
  assert.equal(reviewedRow.drawing_quantity, null, "the occurrence count must not be persisted as a drawing quantity");

  // 12. Immutability held across every decision; history stayed append-only.
  assert.equal(rawBoqQuantity(), "4", "boq_items.numeric_quantity was never mutated by any decision");
  const decisionRows = sql.prepare("SELECT source,selected_quantity FROM boq_quantity_source_decisions ORDER BY rowid").all();
  assert.deepEqual(decisionRows.map((row) => ({ source: row.source, selected_quantity: row.selected_quantity })), [
    { source: "BOQ", selected_quantity: 4 },
    { source: "Reviewed", selected_quantity: 5 },
  ], "every decision remains a real historical row -- the latest wins, none overwritten, and the refused Drawing decision left no row");

  // 13. Every governed review action left a real audit trail.
  const events = sql.prepare("SELECT entity_id,action FROM drawing_symbol_review_events ORDER BY rowid").all();
  assert.deepEqual(events.map((e) => [e.entity_id, e.action]), [
    ["occ1", "approve"],
    ["occ2", "approve"],
    ["occ3", "reject"],
    ["occ4", "reassign"],
    ["occ4", "approve"],
    ["occ2", "restore"],
    ["occ2", "approve"],
  ], "each occurrence review action is auditable with its actor and reason");
});

test("reassign to a definition outside the current recognition version is rejected by the backend -- the UI never becomes the authority", async () => {
  const sql = fixture();
  const env = { DB: d1(sql), FILES: {} };
  const invalid = await handleDrawingSymbolRecognitionApi(
    occurrenceAction("occ4", "reassign", { targetDefinitionId: "def_not_in_this_version" }),
    env,
  );
  assert.equal(invalid.status, 422);
  const row = sql.prepare("SELECT definition_id,review_status FROM drawing_symbol_occurrences WHERE id='occ4'").get();
  assert.equal(row.definition_id, "def_d");
  assert.equal(row.review_status, "Needs Review", "a rejected reassignment must leave the occurrence untouched");
});

test("no governed link means no comparable quantity: an unapproved understanding review can never receive a Drawing decision", async () => {
  const sql = fixture();
  sql.exec(`UPDATE estimator_understanding_review_versions SET review_status='AWAITING_REVIEW';`);
  const env = { DB: d1(sql), FILES: {} };
  const refused = await handleQuantitySourceDecisionApi(
    req("/api/boq-items/boq_1/quantity-source-decision", {
      method: "POST",
      body: JSON.stringify({ source: "Drawing", reason: "Attempt to use drawing count.", documentId: "doc_1", definitionKey: "def_re" }),
    }),
    env,
  );
  assert.equal(refused.status, 409, "without a governed link the Drawing source must be refused, never fabricated");
});
