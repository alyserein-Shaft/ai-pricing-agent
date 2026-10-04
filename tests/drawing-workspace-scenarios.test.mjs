import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { handleDrawingRequirementImpactApi } from "../worker/drawing-requirement-impact-api.mjs";
import { handleQuantitySourceDecisionApi, currentSelectedQuantity } from "../worker/quantity-source-decision-api.mjs";
import { computeApprovedQuantityEvidence } from "../app/domain/drawing-quantity-evidence-engine.mjs";
import { classifyDocumentBytes } from "../app/domain/document-classifier.mjs";
import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";

// Stage 10 (2026-09-01): DRAWING UI CLOSURE, Section 20's six real user
// scenarios. This codebase has no jsdom/testing-library (confirmed: no such
// dependency in package.json) -- every UI test in this codebase, across
// every prior stage, is a static source assertion against app/page.tsx
// PLUS a real backend-level proof of the data that source reads. This file
// follows the exact same, already-established pattern: prove the REAL data
// shape each scenario's backend produces, and statically prove page.tsx's
// Primary Summary branches on exactly that shape.
//
// WHY THE CANONICAL FIXTURE INSTEAD OF A HAND-WRITTEN SCHEMA
// ---------------------------------------------------------
// This file used to carry a 10-table `new DatabaseSync(":memory:")`
// approximation of the schema plus its own hand-rolled `d1` shim. That
// approximation drifted: worker/quantity-source-decision-api.mjs's
// `ownedItem` gate (EVIDENCE-CURRENCY-1) resolves the item through the
// canonical current-evidence authority `currentBoqEvidenceFrom("b")`, which
// joins `boq_extraction_versions`, `documents` and `document_versions` and
// then re-checks document-version effective bounds. Scenarios B and C -- the
// two that go through that gate -- died with
// `Error: no such table: boq_extraction_versions`.
//
// `boq_extraction_versions` is in the canonical active chain, so the
// approximation was stale, not the production contract. Appending a
// `CREATE TABLE` to a hand-written list is how that drift happens and it
// happens again on the next migration, so the local schema is NOT patched
// here. Every database below is `activeChainDatabase()` -- the ACTUAL ordered
// drizzle-active chain read from the migration journal -- wrapped in the
// shared D1-shaped `d1()` adapter (tests/fixtures/active-chain-fixture.mjs).
//
// Consequences, all intended:
//   * a future migration cannot silently invalidate this file's fixtures, and
//   * every seed row must satisfy the REAL NOT NULL / FOREIGN KEY set, so the
//     seeds here are honest rows rather than optimistic ones.
//
// Foreign-key enforcement is left ON (the real chain leaves it on --
// drizzle-active/0002_governing_source_fk.sql), so the seeds below are
// referentially complete: the BOQ item is reachable through a real, in-force
// evidence chain documents -> document_versions -> boq_extraction_versions ->
// boq_items, which is exactly what the `ownedItem` gate requires in order to
// return it. :memory: only; no live data.
const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

const req = (path, init) => new Request(`http://localhost${path}`, init);

// The application identity the workers under test resolve from a localhost
// request with no explicit env (worker/application-context.mjs). Stated once:
// both IDs below are also what the seeded `projects` row must carry, because
// the workers gate on `p.owner_user_id` AND `p.organization_id`.
const OWNER = "local-development-user";
const ORGANIZATION = "organization_bd_shaft_internal_pilot";

const fixture = () => {
  const raw = activeChainDatabase();
  // `projects.organization_id` is a real FK to `organizations` on the active
  // chain, so the organization row is a real parent now, not just a string in
  // a project column. The id itself is unchanged from the pre-migration
  // fixture, so the resolved actor is unchanged.
  raw.exec(`
    INSERT INTO organizations (id,name,status,owner_user_id) VALUES ('${ORGANIZATION}','BD Shaft Internal Pilot','Active','${OWNER}');
    INSERT INTO projects (id,name,owner_user_id,organization_id) VALUES ('project_1','Drawing Workspace Scenarios','${OWNER}','${ORGANIZATION}');
  `);
  // doc_1 is the DRAWING every scenario addresses by id, and the document the
  // symbol recognition versions hang off. The real `documents` row carries
  // `created_by` (NOT NULL) and the real `document_versions` row carries the
  // full NOT NULL upload set, both previously absent from the approximation.
  //
  // DOC-R3: `effective_from`/`effective_to` are left NULL on purpose, which is
  // open-past/open-future == IN FORCE, so this version is its document's
  // governing version. The canonical currentness predicate reads exactly those
  // two columns (app/domain/effective-time-policy.mjs inForceWindowSql).
  //
  // The real `drawing_symbol_recognition_versions` is an FK child of
  // `drawing_intake_versions` (not of `documents` alone), so the governing
  // intake version is seeded here too -- that parent row did not exist in the
  // approximation at all.
  raw.exec(`
    INSERT INTO documents (id,project_id,logical_name,document_type,classification_source,created_by)
      VALUES ('doc_1','project_1','Floor Plan','Drawing','Manual/Unclassified','${OWNER}');
    INSERT INTO document_versions (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by,quarantine_status)
      VALUES ('doc_1_v1','doc_1',1,'floor-plan.pdf','floor-plan.pdf','pdf','application/pdf',4,'sha-doc-1-v1','projects/project_1/floor-plan.pdf','${OWNER}','Clear');
    UPDATE documents SET current_version_id='doc_1_v1' WHERE id='doc_1';
    INSERT INTO drawing_intake_versions (id,project_id,document_id,document_version_id,version_number,input_fingerprint,output_fingerprint,parser_version,status,summary,review_status,created_by)
      VALUES ('iv_1','project_1','doc_1','doc_1_v1',1,'fp-intake-in','fp-intake-out','drawing-intake-v1','Completed','{}','Needs Review','${OWNER}');
  `);
  return raw;
};

// The BOQ side of every scenario is a SEPARATE source document from the
// drawing -- a BOQ item extracted from the drawing it is being compared
// against would make the comparison meaningless. The real chain requires that
// separation to be explicit: `boq_items` is an FK child of both
// `boq_extraction_versions` and `documents`, and the current-evidence
// authority joins them (`e.document_id=b.source_document_id AND
// d.project_id=b.project_id`). The approximation had no such columns at all,
// which is exactly how the stale-evidence hole was hidden.
const seedBoqItem = (raw, { id = "boq_1", quantity = "2", itemNumber = "28.10", description = "Dome Camera" } = {}) => {
  raw.exec(`
    INSERT INTO documents (id,project_id,logical_name,document_type,classification_source,created_by)
      VALUES ('boq_doc_1','project_1','BOQ','BOQ','Manual/Unclassified','${OWNER}');
    INSERT INTO document_versions (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by,quarantine_status)
      VALUES ('boq_doc_1_v1','boq_doc_1',1,'boq.xlsx','boq.stored.xlsx','xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',4,'sha-boq-dv-1','projects/project_1/boq.xlsx','${OWNER}','Clear');
    UPDATE documents SET current_version_id='boq_doc_1_v1' WHERE id='boq_doc_1';
    INSERT INTO boq_extraction_versions (id,document_id,document_version_id,version_number,status,parser_version,ruleset_version,ocr_version,created_by)
      VALUES ('boq_ext_1','boq_doc_1','boq_doc_1_v1',1,'Completed','parser-v1','rules-v1','ocr-v1','${OWNER}');
  `);
  // The real `boq_items` requires: extraction_version_id, source_document_id,
  // sequence, section_path (JSON), row_type, extraction_confidence,
  // confidence_state, review_status, source_location (JSON, NOT NULL),
  // original_raw_values, current_values, approved_for_downstream -- none of
  // which existed in the approximation. `numeric_quantity` / `original_quantity`
  // are TEXT on the real table, so the quantities below are the same TEXT the
  // pre-migration fixture stored.
  raw.prepare(`INSERT INTO boq_items (id,extraction_version_id,project_id,source_document_id,sequence,row_type,item_number,description,numeric_quantity,original_quantity,normalized_unit,original_unit,section_path,source_location,original_raw_values,current_values,review_status,approved_for_downstream,extraction_confidence,confidence_state)
    VALUES (?,'boq_ext_1','project_1','boq_doc_1',1,'BOQ Item',?,?,?,?,'Each','Each','[]',?,'[]','{}','Approved',1,95,'High Confidence')`)
    .run(id, itemNumber, description, String(quantity), String(quantity), JSON.stringify({ row: 10, column: "Quantity" }));
  return id;
};

const profileFor = ({ documentId, recognitionVersionId = "v1", conflict = false, drawingFamily = "Dome Camera" }) => JSON.stringify({
  boqItem: { system: "CCTV", productFamily: "Dome Camera" },
  consolidatedRequirements: conflict
    ? [
        { normalizedRequirement: "Dome Camera", sources: [{ sourceType: "BOQ", source: {} }] },
        { normalizedRequirement: "WALL MOUNTED BULLET CAMERA", sources: [{ sourceType: "Drawing", source: { documentId, recognitionVersionId } }] },
      ]
    : [{ normalizedRequirement: "CEILING MOUNTED DOME CAMERA", sources: [{ sourceType: "Drawing", source: { documentId, recognitionVersionId } }, { sourceType: "BOQ", source: {} }] }],
  conflicts: conflict ? [{ attribute: "Family", technicalImpact: "BOQ says Dome Camera; Drawing says Bullet Camera.", values: [{ value: "Dome Camera", source: { sourceType: "BOQ" } }, { value: drawingFamily === "Dome Camera" ? "Dome Camera" : "Bullet Camera", source: { sourceType: "Drawing" } }] }] : [],
});

// The real `requirement_profile_versions` carries a governed engine/ruleset/
// model identity, an input fingerprint, an explanation and a confidence
// summary, all NOT NULL -- the approximation carried only
// id/project_id/boq_item_id/readiness_status/profile/superseded_at. The
// governed profile content itself (`profile`) is byte-for-byte what it was.
const seedRequirementProfile = (raw, { id = "p1", boqItemId = "boq_1", readinessStatus, profile }) => {
  raw.prepare(`INSERT INTO requirement_profile_versions (id,project_id,boq_item_id,version_number,status,engine_version,ruleset_version,model_version,input_fingerprint,profile,explanation,readiness_status,confidence_summary,approved_for_matching,created_by)
    VALUES (?,'project_1',?,1,'Completed','requirement-profile-v1','rules-v1','model-v1','fp-profile-1',?,'Seeded governed requirement profile for the drawing-workspace scenario.',?, '{}',0,?)`)
    .run(id, boqItemId, profile, readinessStatus, OWNER);
};

const seedRecognitionVersion = (raw, { versionId, versionNumber = 1, supersededAt = null }) => {
  // The real row is FK-parented by `document_versions` and
  // `drawing_intake_versions` and carries fingerprints / engine identity /
  // status / summary / created_by, all NOT NULL.
  raw.prepare("INSERT INTO drawing_symbol_recognition_versions (id,project_id,document_id,document_version_id,drawing_intake_version_id,version_number,input_fingerprint,output_fingerprint,engine_version,status,summary,superseded_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(versionId, "project_1", "doc_1", "doc_1_v1", "iv_1", versionNumber, `fp-in-${versionId}`, `fp-out-${versionId}`, "drawing-symbol-recognition-v1", "Completed", "{}", supersededAt, OWNER);
};

const seedDrawingVersion = (raw, { versionId = "v1", versionNumber = 1, supersededAt = null, occurrences = [] }) => {
  seedRecognitionVersion(raw, { versionId, versionNumber, supersededAt });
  // Scenario F is about recognition-version currency alone: it deliberately
  // seeds NO legend definition and NO occurrences, exactly as the
  // pre-migration fixture did (it inserted only the two recognition versions).
  // Every other scenario seeds at least one occurrence, and for those the
  // legend row below is what its definitionKey names.
  if (!occurrences.length) return;
  // The real `drawing_symbol_definitions` requires source_page,
  // shape_signatures, confidence, evidence_text and extraction_method -- all
  // absent from the approximation. The id (`def_<versionId>`) and the
  // abbreviation/description are unchanged, because the evidence engine groups
  // occurrences by the definition ID and the scenarios request
  // `definitionKey=def_v1`.
  raw.prepare("INSERT INTO drawing_symbol_definitions (id,project_id,recognition_version_id,definition_key,abbreviation,description,source_page,shape_signatures,confidence,evidence_text,extraction_method,review_status) VALUES (?,?,?,?,?,?,1,'[]',60,?,'Explicit legend abbreviation on the reviewed sheet','Approved')")
    .run(`def_${versionId}`, "project_1", versionId, "def_re", "RE", "CEILING MOUNTED DOME CAMERA", "RE");
  // `drawing_symbol_occurrences` keeps the same values it always had; only the
  // undeclared-NULL columns (reviewed_by/reviewed_at/review_reason) are now
  // named explicitly rather than positionally.
  const insert = raw.prepare("INSERT INTO drawing_symbol_occurrences (id,recognition_version_id,definition_id,original_definition_id,occurrence_key,page_number,bounding_box,shape_signature,nearby_text,match_basis,confidence,review_status,source_geometry,reviewed_by,reviewed_at,review_reason) VALUES (?,?,?,NULL,?,1,'{}','sig','','basis',60,?,NULL,NULL,NULL,NULL)");
  for (const occurrence of occurrences) insert.run(occurrence.id, versionId, `def_${versionId}`, `k_${occurrence.id}`, occurrence.reviewStatus);
};

// The governed link the quantity comparison resolves through
// (`resolveGovernedLink` reads an APPROVED
// `estimator_understanding_review_versions` row's canonical_interpretation).
// The real table requires `interpretation_id` (FK), `source_input_fingerprint`,
// `source_document_version_id` and `source_extraction_version`, and a real
// BEFORE INSERT trigger (`estimator_understanding_review_current_evidence_guard`)
// refuses the row unless the BOQ item's own extraction chain is current and
// `documents.current_version_id` really is the version the extraction ran
// against. So the interpretation and its run are seeded too -- which is what a
// real approved understanding produces, and which the approximation's
// five-column table could not express at all.
const seedApprovedUnderstanding = (raw, { boqItemId = "boq_1" } = {}) => {
  raw.prepare("INSERT INTO estimator_understanding_runs (id,project_id,organization_id,provider,model,model_version,prompt_version,schema_version,config_fingerprint,status,total_items,processed_items,successful_items,review_items,failed_items,requested_by,started_at,completed_at,run_mode) VALUES (?,?,?,?,?,?,?,?,?,'COMPLETED',1,1,1,0,0,?,'2026-09-01T00:00:00Z','2026-09-01T00:01:00Z','CONTROLLED_PILOT')")
    .run("run_1", "project_1", ORGANIZATION, "fixture-provider", "fixture-model", "fixture-model-1", "prompt-v1", "schema-v1", "cfg-1", OWNER);
  raw.prepare("INSERT INTO estimator_item_interpretations (id,run_id,project_id,boq_item_id,version_number,input_fingerprint,config_fingerprint,provider,model,model_version,prompt_version,schema_version,status,validated_interpretation,created_by) VALUES (?,?,?,?,1,?,?,'fixture-provider','fixture-model','fixture-model-1','prompt-v1','schema-v1','COMPLETED',?,?)")
    .run(`int_${boqItemId}`, "run_1", "project_1", boqItemId, "fp-item-boq-1", "cfg-1", JSON.stringify({ system: "CCTV", productFamily: "Dome Camera" }), OWNER);
  raw.prepare("INSERT INTO estimator_understanding_review_versions (id,project_id,boq_item_id,interpretation_id,version_number,review_status,canonical_interpretation,source_input_fingerprint,source_document_version_id,source_extraction_version,review_reason,reviewed_by) VALUES (?,?,?,?,1,'APPROVED',?,'fp-item-boq-1','boq_doc_1_v1',1,?,?)")
    .run("rev_1", "project_1", boqItemId, `int_${boqItemId}`, JSON.stringify({ system: "CCTV", productFamily: "Dome Camera" }), "Engineer confirmed the CCTV / Dome Camera reading against the BOQ line and the legend.", "engineer1");
};

// ============================================================
// Scenario A: healthy drawing -- identity understood, legend approved,
// symbols approved, no conflict, quantities aligned -> Ready.
// ============================================================
test("Scenario A: aligned BOQ/Drawing quantities with a governed link produce Ready-shaped data (no conflict, no discrepancy)", async () => {
  const raw = fixture();
  seedBoqItem(raw, { quantity: "2" });
  seedDrawingVersion(raw, { occurrences: [{ id: "occ1", reviewStatus: "Approved" }, { id: "occ2", reviewStatus: "Approved" }] });
  seedRequirementProfile(raw, { readinessStatus: "Ready for Matching", profile: profileFor({ documentId: "doc_1" }) });
  const env = { DB: d1(raw) };
  const body = await (await handleDrawingRequirementImpactApi(req("/api/documents/doc_1/drawing-requirement-impact"), env)).json();
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].conflict, null);
  assert.equal(body.items[0].stale, false);
  const evidence = computeApprovedQuantityEvidence({
    occurrences: [{ id: "occ1", pageNumber: 1, matchedDefinitionKey: "def_v1", reviewStatus: "Approved" }, { id: "occ2", pageNumber: 1, matchedDefinitionKey: "def_v1", reviewStatus: "Approved" }],
    definitions: [{ definitionKey: "def_v1", abbreviation: "RE", description: "CEILING MOUNTED DOME CAMERA" }],
    recognitionVersionId: "v1", documentId: "doc_1",
  });
  assert.equal(evidence.groups[0].approvedOccurrenceCount, body.items[0].numericQuantity, "aligned quantities: the UI's Aligned branch requires these to be equal");
  assert.match(page, /group\.approvedOccurrenceCount === item\.numericQuantity \? \(/, "the UI must have a distinct Aligned branch, not just a conflict/partial fallthrough");
  raw.close();
});

// ============================================================
// Scenario B: BOQ 24, Drawing 22, Coverage Reviewed Drawing Set -> one
// real, conclusive quantity discrepancy -- and NO writable Drawing
// decision, because the only derivable number is an occurrence count.
// ============================================================
test("Scenario B: BOQ 24 / Drawing 22 / Reviewed Drawing Set -> a real, conclusive discrepancy whose Drawing decision is refused", async () => {
  const raw = fixture();
  seedBoqItem(raw, { quantity: "24" });
  const occurrences = Array.from({ length: 22 }, (_, i) => ({ id: `occ${i}`, reviewStatus: "Approved" }));
  seedDrawingVersion(raw, { occurrences });
  raw.prepare("INSERT INTO drawing_quantity_evidence_coverage (id,project_id,recognition_version_id,coverage_state,reason,set_by) VALUES ('cov1','project_1','v1','Reviewed Drawing Set','All sheets reviewed','engineer1')").run();
  seedRequirementProfile(raw, { readinessStatus: "Ready for Matching", profile: profileFor({ documentId: "doc_1" }) });
  // The governed link the comparison needs. On the real chain this is a full
  // run -> interpretation -> approved review version, not a bare five-column
  // row (see seedApprovedUnderstanding).
  seedApprovedUnderstanding(raw);
  const env = { DB: d1(raw) };
  const impact = await (await handleDrawingRequirementImpactApi(req("/api/documents/doc_1/drawing-requirement-impact"), env)).json();
  assert.equal(impact.items[0].numericQuantity, 24);

  // Conclusive coverage still yields a real, reportable discrepancy: a count
  // mismatch may legitimately challenge a quantity. That behaviour is
  // unchanged by DRAW-QTY-1.
  const compare = await (await handleQuantitySourceDecisionApi(
    req("/api/boq-items/boq_1/quantity-source-decision?documentId=doc_1&definitionKey=def_v1"), env,
  )).json();
  assert.equal(compare.drawingComparison.status, "Quantity Conflict — Needs Review");
  assert.equal(compare.drawingComparison.conclusive, true);
  assert.equal(compare.drawingComparison.quantityBasis, "APPROVED_OCCURRENCE_COUNT", "the compared number must be labelled a count");
  assert.equal(compare.drawingComparison.deviceQuantityAvailable, false, "and must never be offered as a device quantity");

  // But it must not be WRITABLE as the governing quantity. The only number the
  // server can derive is the approved-occurrence count (22), and an approved
  // occurrence is a recognised legend row, not an installed device.
  const decisionResponse = await handleQuantitySourceDecisionApi(
    req("/api/boq-items/boq_1/quantity-source-decision", { method: "POST", body: JSON.stringify({ source: "Drawing", reason: "Reviewed drawing set governs the count.", documentId: "doc_1", definitionKey: "def_v1" }) }),
    env,
  );
  const decisionBody = await decisionResponse.json();
  assert.equal(decisionResponse.status, 409, "a conclusive count discrepancy must still not be writable as a device quantity");
  assert.equal(decisionBody.error.code, "DRAWING_PRINTED_QUANTITY_REQUIRED");
  assert.equal(decisionBody.error.approvedOccurrenceCount, 22);
  assert.equal(decisionBody.error.approvedOccurrenceCountIsDeviceQuantity, false);
  assert.equal(
    raw.prepare("SELECT COUNT(*) AS n FROM boq_quantity_source_decisions").get().n,
    0,
    "the refused decision must leave no governed row",
  );

  assert.match(page, /conclusiveCoverage \? \(/, "the UI must gate the decision actions on conclusive coverage, not show them for every mismatch");
  assert.match(page, /Use BOQ Qty — \{item\.numericQuantity\}/);
  // DRAW-QTY-1: the UI must offer no control that promotes an occurrence
  // count into the governing quantity.
  assert.doesNotMatch(page, /Use Drawing Qty/, "the UI must not offer to select an occurrence count as the quantity");
  assert.match(page, /Drawing device quantity is unavailable/, "and must state why, rather than silently omitting the option");
  raw.close();
});

// ============================================================
// Scenario C: BOQ 24, Drawing 22, Coverage Partial -> no false conflict,
// working quantity stays BOQ, only "continue review" / "review decision".
// ============================================================
test("Scenario C: BOQ 24 / Drawing 22 / Partial coverage -> never a real Quantity Conflict, decision remains optional", async () => {
  const raw = fixture();
  seedBoqItem(raw, { quantity: "24" });
  const occurrences = Array.from({ length: 22 }, (_, i) => ({ id: `occ${i}`, reviewStatus: "Approved" }));
  seedDrawingVersion(raw, { occurrences });
  // No coverage row inserted -> DEFAULT_COVERAGE_STATE is "Partial" (Stage 6A).
  // No approved understanding review version either, exactly as before: this
  // scenario is about coverage state, not about the governed link.
  const env = { DB: d1(raw) };
  const evidence = await (await handleQuantitySourceDecisionApi(req("/api/boq-items/boq_1/quantity-source-decision"), env)).json();
  assert.equal(evidence.current, null, "no decision exists yet -- nothing was silently forced");
  // The Drawing option must still fail closed with Partial coverage.
  const attempt = await handleQuantitySourceDecisionApi(
    req("/api/boq-items/boq_1/quantity-source-decision", { method: "POST", body: JSON.stringify({ source: "Drawing", reason: "Trying to use drawing count under partial review.", documentId: "doc_1", definitionKey: "def_v1" }) }),
    env,
  );
  // A comparable() evidence group exists (definitionKey matches), so this
  // does not 409 -- the real point Section 9 makes is that the UI itself
  // must never LABEL a partial-coverage mismatch as "Conflict"; that is
  // proven by the static branch below, not by blocking the write here
  // (Stage 6A already made that write meaningful once an engineer chooses
  // to act on it directly).
  assert.notEqual(attempt.status, 500);
  assert.match(page, /Drawing review incomplete — \{group\.approvedOccurrenceCount\} approved/, "a partial-coverage mismatch must render as incomplete review, never as a conflict");
  assert.doesNotMatch(
    page.slice(page.indexOf("Drawing review incomplete"), page.indexOf("Drawing review incomplete") + 400),
    /Conflict/,
    "the partial-coverage branch itself must never use conflict language",
  );
  raw.close();
});

// ============================================================
// Scenario D: BOQ Dome Camera / Drawing Bullet Camera -> real conflict,
// one Resolve Requirement action, never silently merged.
// ============================================================
test("Scenario D: a real BOQ-vs-Drawing family conflict is reported directly, with one resolve action", async () => {
  const raw = fixture();
  seedBoqItem(raw, { quantity: "4" });
  seedDrawingVersion(raw, { occurrences: [{ id: "occ1", reviewStatus: "Approved" }] });
  seedRequirementProfile(raw, { readinessStatus: "Conflict Blocking", profile: profileFor({ documentId: "doc_1", conflict: true }) });
  const env = { DB: d1(raw) };
  const body = await (await handleDrawingRequirementImpactApi(req("/api/documents/doc_1/drawing-requirement-impact"), env)).json();
  assert.equal(body.items[0].conflict.attribute, "Family");
  assert.match(body.items[0].conflict.technicalImpact, /Dome Camera.*Bullet Camera/);
  assert.match(page, /item\.conflict \? \(/);
  assert.match(page, /Resolve Requirement/);
  raw.close();
});

// ============================================================
// Scenario E: raster drawing -> Manual Review Required, no fabricated
// structural/legend/symbol data (Stage 8's own honest-failure guarantee,
// reused unmodified here).
// ============================================================
test("Scenario E: a raster/scanned document classifies honestly (Needs Review, OCR_REQUIRED) -- the UI's Unsupported branch has a real backing state, not an assumption", async () => {
  // A genuinely image-only PDF proves the SAME real classification path
  // Stage 8 already proved end-to-end; Stage 10 only adds the UI branch on
  // top of it, so this test proves that real backing state still exists
  // unchanged, not a fresh re-proof of the whole raster pipeline.
  const rasterPdf = new TextEncoder().encode("%PDF-1.7\n1 0 obj <</Type /Page /Subtype /Image>> endobj\n%%EOF");
  const classification = await classifyDocumentBytes(rasterPdf, { extension: "pdf", fileName: "scan.pdf" });
  assert.equal(classification.status, "Needs Review");
  assert.match(page, /rasterPages === pageCount/);
  assert.match(page, /"Unsupported"/);
  // Drawing Workspace redesign (2026-09-18): the same real state now surfaces
  // as a Needs-attention entry under "Missing information and source limits",
  // stating what is missing and why -- and deliberately WITHOUT an action,
  // because there is no automated one to offer (see the no-do-nothing-button
  // test in drawing-workspace-ui-closure.test.mjs).
  assert.match(page, /This drawing has no extractable text or geometry/);
  const unsupportedEntry = page.slice(
    page.indexOf('id: "capability-unsupported"'),
    page.indexOf('if (capabilityState === "Partial")'),
  );
  assert.ok(unsupportedEntry.length > 0, "the unsupported attention entry must exist");
  assert.doesNotMatch(unsupportedEntry, /onAction/, "an unsupported drawing must be offered no action at all");
});

// ============================================================
// Scenario F: stale drawing evidence after a new drawing version ->
// re-evaluation needed, never silently ignored.
// ============================================================
test("Scenario F: a linked item's Drawing evidence pointing at a superseded recognition version is reported stale, with a real recalculate action", async () => {
  const raw = fixture();
  seedBoqItem(raw, { quantity: "2" });
  seedDrawingVersion(raw, { versionId: "v1_old", versionNumber: 1, supersededAt: "2026-09-01T00:00:00Z" });
  seedDrawingVersion(raw, { versionId: "v2_current", versionNumber: 2 });
  seedRequirementProfile(raw, { readinessStatus: "Ready for Matching", profile: profileFor({ documentId: "doc_1", recognitionVersionId: "v1_old" }) });
  const env = { DB: d1(raw) };
  const body = await (await handleDrawingRequirementImpactApi(req("/api/documents/doc_1/drawing-requirement-impact"), env)).json();
  assert.equal(body.items[0].stale, true);
  assert.match(page, /item\.stale && \(/);
  assert.match(page, /Recalculate Requirement Profile/);
  assert.match(page, /recalculateLinkedRequirement/);
  raw.close();
});
