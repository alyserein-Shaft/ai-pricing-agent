import test from "node:test";
import assert from "node:assert/strict";
import { handleDrawingExtractionApi } from "../worker/drawing-extraction-api.mjs";
import { buildDrawingIntelligenceOverlayItems } from "../app/domain/drawing-intelligence-view-model.mjs";
import { KGS_SCHEMATIC_PAGES, KGS_SCHEMATIC_ASSETS } from "./golden/kgs-fire-alarm-schematic.fixture.mjs";
import { AMS_ELV_LEGEND_PAGES, AMS_ELV_LEGEND_ASSETS, AMS_ELV_LEGEND_LEGEND_ENTRIES } from "./golden/ams-elv-legend-notes.fixture.mjs";
import { FCC_ROOM_DETAILS_PAGES, FCC_ROOM_DETAILS_ASSETS } from "./golden/fcc-room-details.fixture.mjs";
import { AMS_CAUSE_EFFECT_PAGES, AMS_CAUSE_EFFECT_ASSETS } from "./golden/ams-cause-and-effect.fixture.mjs";
import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";

// PRODUCT INTEGRATION -- type-specific Drawing Intelligence now flows
// through the SAME persistence/review API as General Drawing Extraction
// v0 (see worker/drawing-extraction-api.mjs's intelligenceContext() +
// buildDrawingIntelligenceProposals()).
//
// WHY THE CANONICAL FIXTURE INSTEAD OF A HAND-WRITTEN SCHEMA
// ---------------------------------------------------------
// This file used to carry a 9-table CREATE TABLE approximation plus a second
// hand-copied `migration` block for `drawing_extraction_proposals` /
// `drawing_extraction_review_events`, opened with `PRAGMA foreign_keys=OFF`.
//
// Both halves are now wrong against the real chain:
//   * `drawing_extraction_proposals` and `drawing_extraction_review_events` are
//     ALREADY in the active chain -- and the real tables carry extra columns the
//     copy did not (`visual_run_id`, `superseded_at`, `superseded_by_run_id`,
//     `history_warning`) which `worker/drawing-extraction-api.mjs` genuinely
//     reads and writes. Re-declaring them hid that.
//   * The approximation was missing every NOT NULL column the real drawing
//     tables carry: `drawing_intake_versions.input_fingerprint/
//     output_fingerprint/parser_version`, `drawing_pages.coordinate_mode/
//     classifications/text_count/source_review_status/extraction_method`,
//     `drawing_metadata.confidence/extraction_method`,
//     `drawing_legends.detection_method`,
//     `drawing_document_classifications.extraction_method`. It also had no
//     `drawing_visual_runs` at all, which the same worker route reads.
//   * `PRAGMA foreign_keys=OFF` hid that the drawing tables are real FK children
//     of `documents` / `drawing_intake_versions` / `drawing_pages`.
//
// Every database below is therefore `activeChainDatabase()` -- the ACTUAL ordered
// drizzle-active chain read from the migration journal -- wrapped in the shared
// D1-shaped `d1()` adapter (tests/fixtures/active-chain-fixture.mjs), with FK
// enforcement left ON because the real chain leaves it on
// (drizzle-active/0002_governing_source_fk.sql). Every seed row is an honest row
// against the REAL schema. :memory: only; no live data.

const box = (x, y, width, height, pageWidth = 1000, pageHeight = 1000) => JSON.stringify({ x, y, width, height, pageWidth, pageHeight });

// The real `projects` row is FK-parented by `organizations` on the active chain.
const seedProject = (raw) => {
  raw.exec(`
    INSERT INTO organizations (id,name) VALUES ('org1','Organization One');
    INSERT INTO projects (id,name,owner_user_id,organization_id) VALUES ('p1','Test','owner1','org1');
  `);
};

const seedDocumentAndVersion = (raw, docId, dvId) => {
  raw.prepare("INSERT INTO documents (id,project_id,logical_name,document_type,classification_source,current_version_id,created_by) VALUES (?,'p1','test.pdf','Drawing','Manual/Unclassified',?,'owner1')").run(docId, dvId);
  raw.prepare("INSERT INTO document_versions (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by,quarantine_status) VALUES (?,?,1,'test.pdf','test.pdf','pdf','application/pdf',4,'sha1','obj1','owner1','Clear')").run(dvId, docId);
};

// The real `drawing_intake_versions` carries a governed fingerprint/parser
// identity; the hand-rolled version had no such columns at all.
const seedIntakeVersion = (raw, { ivId, docId, dvId }) => {
  raw.prepare("INSERT INTO drawing_intake_versions (id,project_id,document_id,document_version_id,version_number,input_fingerprint,output_fingerprint,parser_version,status,summary,review_status,created_by) VALUES (?,'p1',?,?,1,'fp-in','fp-out','drawing-intake-v1','Completed','{}','Needs Review','owner1')").run(ivId, docId, dvId);
};

// The real `drawing_pages` carries coordinate_mode / classifications /
// text_count / source_review_status / extraction_method, all NOT NULL. They are
// seeded with the same truthful values the real intake pipeline records for the
// Golden PDFs these fixtures are taken from.
const seedPage = (raw, { pageId, ivId, pageNumber, width, height, textCount }) => {
  raw.prepare("INSERT INTO drawing_pages (id,intake_version_id,page_number,width,height,coordinate_mode,classifications,text_count,source_review_status,extraction_method) VALUES (?,?,?,?,?,'PDF Points','[]',?,'Needs Review','PDF text item geometry')").run(pageId, ivId, pageNumber, width, height, textCount);
};

const insertAssets = (raw, ivId, assets) => {
  const insertAsset = raw.prepare(
    "INSERT INTO drawing_assets (id,intake_version_id,page_id,asset_type,text_content,bounding_box,coordinates_available,detection_confidence,detection_method) VALUES (?,?,?,?,?,?,?,?,?)",
  );
  for (const asset of assets) {
    insertAsset.run(asset.id, ivId, asset.page_id, asset.asset_type, asset.text_content, JSON.stringify(asset.bounding_box), asset.coordinates_available, asset.detection_confidence, asset.detection_method);
  }
};

const baseEnv = (raw) => ({ DB: d1(raw), APP_ACCESS_MODE: "single-user", APP_USER_ID: "owner1", APP_ORGANIZATION_ID: "org1" });

const req = (path, method = "GET", body = null) =>
  new Request(`https://app.example${path}`, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });

// ---- Synthetic per-family persistence/governance fixture (Riser/Schematic) ----

const seedRiserFixture = () => {
  const raw = activeChainDatabase();
  seedProject(raw);
  seedDocumentAndVersion(raw, "doc1", "dv1");
  seedIntakeVersion(raw, { ivId: "iv1", docId: "doc1", dvId: "dv1" });
  seedPage(raw, { pageId: "page1", ivId: "iv1", pageNumber: 1, width: 1000, height: 1000, textCount: 4 });
  raw.prepare("INSERT INTO drawing_metadata (id,intake_version_id,drawing_number,revision,sheet_name,confidence,extraction_method) VALUES ('meta1','iv1','2401232-PC-TEST-DR-T-00-ZZZ-001','0','FIRE DETECTION & ALARM SCHEMATIC',90,'PDF text item geometry')").run();
  raw.prepare("INSERT INTO drawing_document_classifications (id,intake_version_id,classification_type,confidence,extraction_method) VALUES ('c1','iv1','Mixed Drawing',90,'PDF text item geometry')").run();
  insertAssets(raw, "iv1", [
    { id: "a1", page_id: "page1", asset_type: "Text", text_content: "LOOP-1", bounding_box: JSON.parse(box(100, 500, 40, 12)), coordinates_available: 1, detection_confidence: 99, detection_method: "PDF text item geometry" },
    { id: "a2", page_id: "page1", asset_type: "Text", text_content: "2 X 1.5 sq.mm CWZ CABLE", bounding_box: JSON.parse(box(100, 460, 150, 12)), coordinates_available: 1, detection_confidence: 99, detection_method: "PDF text item geometry" },
    { id: "a3", page_id: "page1", asset_type: "Text", text_content: "INTERFACE TO ELEVATORS", bounding_box: JSON.parse(box(100, 420, 150, 12)), coordinates_available: 1, detection_confidence: 99, detection_method: "PDF text item geometry" },
    { id: "a4", page_id: "page1", asset_type: "Text", text_content: "TO FACP @BOS BUILDING", bounding_box: JSON.parse(box(100, 380, 150, 12)), coordinates_available: 1, detection_confidence: 99, detection_method: "PDF text item geometry" },
  ]);
  return { raw, env: baseEnv(raw) };
};

test("PERSISTENCE -- Riser/Schematic proposal families (Loop, CableSpec, SystemInterface, Connection) all persist with stable keys", async () => {
  const { raw, env } = seedRiserFixture();
  const response = await handleDrawingExtractionApi(req("/api/documents/doc1/drawing-extraction/sync", "POST"), env);
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.drawingType, "Schematic / Single-Line");

  const byType = (t) => raw.prepare("SELECT * FROM drawing_extraction_proposals WHERE proposal_type=?").all(t);
  assert.equal(byType("Loop Candidate").length, 1);
  assert.equal(byType("Cable Spec Candidate").length, 1);
  assert.equal(byType("System Interface Candidate").length, 1);
  assert.equal(byType("Possible Connection").length, 1);

  const loop = byType("Loop Candidate")[0];
  assert.equal(loop.governed_status, "Verified"); // explicit tag on an authoritative Schematic sheet
  const connection = byType("Possible Connection")[0];
  assert.equal(connection.governed_status, "Needs Review"); // never geometry/text-only confirmed
  assert.ok(JSON.parse(connection.hard_review_reasons).length > 0);

  const evidence = JSON.parse(connection.evidence);
  assert.equal(evidence.drawingType, "Schematic / Single-Line");
  assert.equal(evidence.sourceDrawingNumber, "2401232-PC-TEST-DR-T-00-ZZZ-001");
});

test("PERSISTENCE -- idempotent sync: a second sync against unchanged evidence does not create duplicate rows", async () => {
  const { raw, env } = seedRiserFixture();
  await handleDrawingExtractionApi(req("/api/documents/doc1/drawing-extraction/sync", "POST"), env);
  const countAfterFirst = raw.prepare("SELECT COUNT(*) count FROM drawing_extraction_proposals").get().count;
  await handleDrawingExtractionApi(req("/api/documents/doc1/drawing-extraction/sync", "POST"), env);
  const countAfterSecond = raw.prepare("SELECT COUNT(*) count FROM drawing_extraction_proposals").get().count;
  assert.equal(countAfterSecond, countAfterFirst);
});

test("PERSISTENCE -- rerunning extraction refreshes governed_status but does not silently discard an engineer's prior review_status on a type-specific proposal", async () => {
  const { raw, env } = seedRiserFixture();
  await handleDrawingExtractionApi(req("/api/documents/doc1/drawing-extraction/sync", "POST"), env);
  const loop = raw.prepare("SELECT * FROM drawing_extraction_proposals WHERE proposal_type='Loop Candidate'").get();
  await handleDrawingExtractionApi(req(`/api/documents/doc1/drawing-extraction/${loop.id}/reject`, "POST", { reason: "Engineer determined this loop tag is a duplicate label" }), env);

  await handleDrawingExtractionApi(req("/api/documents/doc1/drawing-extraction/sync", "POST"), env);
  const afterRerun = raw.prepare("SELECT * FROM drawing_extraction_proposals WHERE id=?").get(loop.id);
  assert.equal(afterRerun.review_status, "Rejected"); // human decision preserved
  assert.equal(afterRerun.governed_status, "Verified"); // system's own reference computation still refreshed
});

test("GOVERNANCE -- approve/reject/correct/conflict/restore all work on a type-specific (Loop) proposal, with full audit trail", async () => {
  const { raw, env } = seedRiserFixture();
  await handleDrawingExtractionApi(req("/api/documents/doc1/drawing-extraction/sync", "POST"), env);
  const loop = raw.prepare("SELECT * FROM drawing_extraction_proposals WHERE proposal_type='Loop Candidate'").get();

  const approve = await handleDrawingExtractionApi(req(`/api/documents/doc1/drawing-extraction/${loop.id}/approve`, "POST", { reason: "Confirmed LOOP-1 against the printed schematic" }), env);
  assert.equal(approve.status, 200);
  const correct = await handleDrawingExtractionApi(req(`/api/documents/doc1/drawing-extraction/${loop.id}/correct`, "POST", { reason: "Corrected loop number after cross-checking the riser", correctedValue: { loopNumber: 2 } }), env);
  assert.equal(correct.status, 200);
  const conflict = await handleDrawingExtractionApi(req(`/api/documents/doc1/drawing-extraction/${loop.id}/conflict`, "POST", { reason: "Disagrees with the loop schedule on another sheet" }), env);
  assert.equal(conflict.status, 200);
  const restore = await handleDrawingExtractionApi(req(`/api/documents/doc1/drawing-extraction/${loop.id}/restore`, "POST", { reason: "Re-reviewed, restoring to system default" }), env);
  const restoreBody = await restore.json();
  assert.equal(restoreBody.reviewStatus, "Verified"); // the loop's own governed_status

  const events = raw.prepare("SELECT action FROM drawing_extraction_review_events WHERE proposal_id=? ORDER BY created_at").all(loop.id);
  assert.deepEqual(events.map((e) => e.action), ["approve", "correct", "conflict", "restore"]);
  // Review history is retained after restore -- restore does not delete or
  // truncate prior audit events.
  assert.equal(events.length, 4);
});

test("GOVERNANCE -- a Connection Candidate cannot be silently promoted to Verified by sync alone; a subsequent Conflict blocks a later approve", async () => {
  const { raw, env } = seedRiserFixture();
  await handleDrawingExtractionApi(req("/api/documents/doc1/drawing-extraction/sync", "POST"), env);
  const connection = raw.prepare("SELECT * FROM drawing_extraction_proposals WHERE proposal_type='Possible Connection'").get();
  assert.equal(connection.governed_status, "Needs Review");
  assert.equal(connection.review_status, "Needs Review");

  await handleDrawingExtractionApi(req(`/api/documents/doc1/drawing-extraction/${connection.id}/conflict`, "POST", { reason: "Destination panel tag does not match any known panel in this project" }), env);
  const approveAttempt = await handleDrawingExtractionApi(req(`/api/documents/doc1/drawing-extraction/${connection.id}/approve`, "POST", { reason: "Trying to approve despite the open conflict" }), env);
  const body = await approveAttempt.json();
  assert.equal(approveAttempt.status, 422);
  assert.equal(body.error.code, "DRAWING_EXTRACTION_CONFLICT_BLOCKS_APPROVAL");
});

test("API -- GET retrieves a mix of general-extraction AND type-specific proposal families in one response", async () => {
  const { env } = seedRiserFixture();
  await handleDrawingExtractionApi(req("/api/documents/doc1/drawing-extraction/sync", "POST"), env);
  const response = await handleDrawingExtractionApi(req("/api/documents/doc1/drawing-extraction"), env);
  const body = await response.json();
  const types = new Set(body.proposals.map((p) => p.proposalType));
  assert.ok(types.has("Loop Candidate"));
  assert.ok(types.has("Cable Spec Candidate"));
  assert.ok(types.has("System Interface Candidate"));
  assert.ok(types.has("Possible Connection"));
});

test("API -- proposals can be filtered client-side by proposalType and governedStatus from the returned mixed list", async () => {
  const { env } = seedRiserFixture();
  await handleDrawingExtractionApi(req("/api/documents/doc1/drawing-extraction/sync", "POST"), env);
  const response = await handleDrawingExtractionApi(req("/api/documents/doc1/drawing-extraction"), env);
  const body = await response.json();
  const verified = body.proposals.filter((p) => p.governedStatus === "Verified");
  const needsReview = body.proposals.filter((p) => p.governedStatus === "Needs Review");
  assert.ok(verified.length > 0);
  assert.ok(needsReview.length > 0);
  assert.equal(verified.length + needsReview.length, body.proposals.length);
});

// ---- Legend/Notes family (reuses real drawing_legend_entries) ----

const seedLegendFixture = () => {
  const raw = activeChainDatabase();
  seedProject(raw);
  seedDocumentAndVersion(raw, "doc1", "dv1");
  seedIntakeVersion(raw, { ivId: "iv1", docId: "doc1", dvId: "dv1" });
  seedPage(raw, { pageId: "page1", ivId: "iv1", pageNumber: 1, width: 1000, height: 1000, textCount: 2 });
  raw.prepare("INSERT INTO drawing_metadata (id,intake_version_id,drawing_number,revision,sheet_name,confidence,extraction_method) VALUES ('meta1','iv1','2401232-PC-TEST-DR-T-00-ZZZ-002','0','ELV LEGENDS, NOTES AND ABBREVIATIONS',68,'PDF text item geometry')").run();
  raw.prepare("INSERT INTO drawing_document_classifications (id,intake_version_id,classification_type,confidence,extraction_method) VALUES ('c1','iv1','Legend Sheet',68,'PDF text item geometry')").run();
  raw.prepare("INSERT INTO drawing_legends (id,intake_version_id,page_id,confidence,detection_method) VALUES ('legend1','iv1','page1',70,'PDF text item geometry')").run();
  raw.prepare("INSERT INTO drawing_legend_entries (id,legend_id,sequence,entry_type,label,description,confidence) VALUES ('entry1','legend1',1,'Abbreviation','SD','SMOKE DETECTOR',70)").run();
  raw.prepare("INSERT INTO drawing_legend_entries (id,legend_id,sequence,entry_type,label,description,confidence) VALUES ('entry2','legend1',2,'Abbreviation','MCP','MANUAL CALL POINT',70)").run();
  insertAssets(raw, "iv1", [
    { id: "a1", page_id: "page1", asset_type: "Text", text_content: "1.", bounding_box: JSON.parse(box(100, 500, 20, 12)), coordinates_available: 1, detection_confidence: 99, detection_method: "PDF text item geometry" },
    { id: "a2", page_id: "page1", asset_type: "Text", text_content: "DIMENSIONS ARE NOT TO BE SCALED FROM THIS DRAWING.", bounding_box: JSON.parse(box(130, 500, 200, 12)), coordinates_available: 1, detection_confidence: 99, detection_method: "PDF text item geometry" },
  ]);
  return { raw, env: baseEnv(raw) };
};

test("PERSISTENCE -- Legend/Notes family (LegendDefinition reusing real drawing_legend_entries, GeneralNote) persists", async () => {
  const { raw, env } = seedLegendFixture();
  const response = await handleDrawingExtractionApi(req("/api/documents/doc1/drawing-extraction/sync", "POST"), env);
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.drawingType, "Legend / Notes");

  const legendDefs = raw.prepare("SELECT * FROM drawing_extraction_proposals WHERE proposal_type='Legend Definition'").all();
  assert.equal(legendDefs.length, 2);
  assert.equal(legendDefs[0].governed_status, "Verified"); // same-sheet legend is Primary authority

  const notes = raw.prepare("SELECT * FROM drawing_extraction_proposals WHERE proposal_type='General Note'").all();
  assert.equal(notes.length, 1);
  assert.match(JSON.parse(notes[0].evidence).normalizedValue, /DIMENSIONS ARE NOT TO BE SCALED/);
});

// ---- REGRESSION: FCC schedule/callout persistence still works unchanged ----

test("REGRESSION -- FCC schedule/callout extraction (General Drawing Extraction v0) still persists correctly alongside the new intelligence pipeline", async () => {
  const raw = activeChainDatabase();
  seedProject(raw);
  seedDocumentAndVersion(raw, "doc1", "dv1");
  seedIntakeVersion(raw, { ivId: "iv1", docId: "doc1", dvId: "dv1" });
  seedPage(raw, { pageId: FCC_ROOM_DETAILS_PAGES[0].id, ivId: "iv1", pageNumber: FCC_ROOM_DETAILS_PAGES[0].page_number, width: FCC_ROOM_DETAILS_PAGES[0].width, height: FCC_ROOM_DETAILS_PAGES[0].height, textCount: FCC_ROOM_DETAILS_ASSETS.length });
  raw.prepare("INSERT INTO drawing_metadata (id,intake_version_id,drawing_number,revision,sheet_name,confidence,extraction_method) VALUES ('meta1','iv1','2401232-PC-KGS-DR-T-91-ZZZ-002','0','FCC ROOM DETAILS',90,'PDF text item geometry')").run();
  raw.prepare("INSERT INTO drawing_document_classifications (id,intake_version_id,classification_type,confidence,extraction_method) VALUES ('c1','iv1','Mixed Drawing',90,'PDF text item geometry')").run();
  insertAssets(raw, "iv1", FCC_ROOM_DETAILS_ASSETS);
  const env = baseEnv(raw);
  const response = await handleDrawingExtractionApi(req("/api/documents/doc1/drawing-extraction/sync", "POST"), env);
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.drawingType, "Detail / Enlarged Detail");

  const scheduleRows = raw.prepare("SELECT * FROM drawing_extraction_proposals WHERE proposal_type='Equipment Schedule Item'").all();
  assert.equal(scheduleRows.length, 14); // 14/14 still holds through the integrated sync path

  const panelCandidates = raw.prepare("SELECT * FROM drawing_extraction_proposals WHERE proposal_type='Panel Candidate'").all();
  const facp = panelCandidates.find((row) => JSON.parse(row.evidence).alias === "FACP");
  assert.ok(facp);
  assert.equal(JSON.parse(facp.evidence).identityStatus, "Potential Alias");
  assert.equal(facp.governed_status, "Needs Review"); // FACP/MFACP remains safe -- never auto-merged

  assert.doesNotMatch(JSON.stringify(raw.prepare("SELECT * FROM drawing_extraction_proposals").all()), /SystemConnection/);
});

// ---- GOLDEN SET INTEGRATION: real fixture data flows domain -> sync -> API -> UI view model ----

const seedGoldenDocument = (raw, { docId, pages, assets, drawingNumber, sheetName, revision, classifications, legendEntries }) => {
  seedDocumentAndVersion(raw, docId, `${docId}-dv`);
  seedIntakeVersion(raw, { ivId: `${docId}-iv`, docId, dvId: `${docId}-dv` });
  for (const page of pages) {
    seedPage(raw, {
      pageId: page.id,
      ivId: `${docId}-iv`,
      pageNumber: page.page_number,
      width: page.width,
      height: page.height,
      textCount: assets.filter((asset) => asset.page_id === page.id).length,
    });
  }
  raw.prepare("INSERT INTO drawing_metadata (id,intake_version_id,drawing_number,revision,sheet_name,confidence,extraction_method) VALUES (?,?,?,?,?,90,'PDF text item geometry')").run(`${docId}-meta`, `${docId}-iv`, drawingNumber, revision, sheetName);
  for (const c of classifications) raw.prepare("INSERT INTO drawing_document_classifications (id,intake_version_id,classification_type,confidence,extraction_method) VALUES (?,?,?,?,'PDF text item geometry')").run(`${docId}-${c.type}`, `${docId}-iv`, c.type, c.confidence);
  if (legendEntries) {
    raw.prepare("INSERT INTO drawing_legends (id,intake_version_id,page_id,confidence,detection_method) VALUES (?,?,?,70,'PDF text item geometry')").run(`${docId}-legend`, `${docId}-iv`, pages[0].id);
    for (const entry of legendEntries) {
      raw.prepare("INSERT INTO drawing_legend_entries (id,legend_id,sequence,entry_type,label,description,confidence) VALUES (?,?,?,?,?,?,?)").run(entry.id, `${docId}-legend`, entry.sequence, entry.entry_type, entry.label, entry.description, entry.confidence);
    }
  }
  insertAssets(raw, `${docId}-iv`, assets);
};

test("GOLDEN SET INTEGRATION -- real FCC + AMS Legend + KGS Riser + AMS Cause&Effect all flow domain -> persistence -> API read model", async () => {
  const raw = activeChainDatabase();
  seedProject(raw);

  seedGoldenDocument(raw, {
    docId: "doc_fcc",
    pages: FCC_ROOM_DETAILS_PAGES,
    assets: FCC_ROOM_DETAILS_ASSETS,
    drawingNumber: "2401232-PC-KGS-DR-T-91-ZZZ-002",
    sheetName: "FCC ROOM DETAILS",
    revision: "0",
    classifications: [{ type: "Mixed Drawing", confidence: 90 }],
  });
  seedGoldenDocument(raw, {
    docId: "doc_legend",
    pages: AMS_ELV_LEGEND_PAGES,
    assets: AMS_ELV_LEGEND_ASSETS,
    // The seed here previously read `2401232-PC-AMS-DR-T-00-ZZZ-002`, which is
    // the AMSTERDAM BUILDING's legend sheet. The KGS riser sheet under test
    // literally cites `2401232-PC-AMS-T-00-ZZZ-002` -- no `DR` segment -- in
    // both its per-item and its composite title-block asset (see
    // tests/golden/kgs-fire-alarm-schematic.fixture.mjs:2902 and :2932).
    //
    // app/domain/drawing-cross-sheet-references.mjs resolves targets by EXACT
    // drawing-number match and deliberately does NOT normalize away the `DR`
    // segment; tests/drawing-cross-sheet-references.test.mjs:88-91 pins that
    // `2401232-PC-AMS-DR-T-00-ZZZ-002` and `2401232-PC-AMS-T-00-ZZZ-002` must
    // NOT match each other. So the old seed made the assertion below
    // unachievable by seeding a number the source sheet never writes.
    //
    // This is a SEED correction, not a weakening: the seed now carries the
    // drawing number the real cited sheet actually publishes, so the governed
    // exact-match resolution is exercised as intended. The assertion itself is
    // unchanged.
    drawingNumber: "2401232-PC-AMS-T-00-ZZZ-002",
    sheetName: "ELV LEGENDS, NOTES AND ABBREVIATIONS",
    revision: null,
    classifications: [{ type: "Legend Sheet", confidence: 68 }],
    legendEntries: AMS_ELV_LEGEND_LEGEND_ENTRIES,
  });
  seedGoldenDocument(raw, {
    docId: "doc_riser",
    pages: KGS_SCHEMATIC_PAGES,
    assets: KGS_SCHEMATIC_ASSETS,
    drawingNumber: "2401232-PC-KGS-DR-T-93-ZZZ-005",
    sheetName: "FIRE DETECTION & ALARM SCHEMATIC",
    revision: "1",
    classifications: [{ type: "Mixed Drawing", confidence: 90 }],
  });
  seedGoldenDocument(raw, {
    docId: "doc_ce",
    pages: AMS_CAUSE_EFFECT_PAGES,
    assets: AMS_CAUSE_EFFECT_ASSETS,
    drawingNumber: "2401232-PC-AMS-DR-T-94-ZZZ-001",
    sheetName: "FIRE ALARM SYSTEM CAUSE AND EFFECT MATRIX",
    revision: null,
    classifications: [{ type: "Sequence of Operation", confidence: 68 }],
  });

  const env = baseEnv(raw);

  // FCC -- domain -> sync -> API.
  const fccSync = await handleDrawingExtractionApi(req("/api/documents/doc_fcc/drawing-extraction/sync", "POST"), env);
  const fccBody = await fccSync.json();
  assert.equal(fccSync.status, 201);
  assert.equal(fccBody.proposals.filter((p) => p.proposalType === "Equipment Schedule Item").length, 14);

  // AMS Legend -- domain -> sync -> API.
  const legendSync = await handleDrawingExtractionApi(req("/api/documents/doc_legend/drawing-extraction/sync", "POST"), env);
  const legendBody = await legendSync.json();
  assert.equal(legendSync.status, 201);
  assert.ok(legendBody.proposals.some((p) => p.proposalType === "Legend Definition"));
  assert.ok(legendBody.proposals.some((p) => p.proposalType === "General Note"));

  // KGS Riser -- domain -> sync -> API.
  const riserSync = await handleDrawingExtractionApi(req("/api/documents/doc_riser/drawing-extraction/sync", "POST"), env);
  const riserBody = await riserSync.json();
  assert.equal(riserSync.status, 201);
  assert.ok(riserBody.proposals.some((p) => p.proposalType === "Loop Candidate"));
  // The real KGS sheet's explicit ELV-legend reference resolves to the
  // real AMS legend document seeded above -- exact cross-sheet resolution
  // survives the full domain -> persistence -> API path.
  assert.ok(riserBody.proposals.some((p) => p.proposalType === "Cross-Sheet Reference" && JSON.parse(raw.prepare("SELECT evidence FROM drawing_extraction_proposals WHERE id=?").get(p.id).evidence).resolvedTargetDocumentId === "doc_legend"));

  // AMS Cause & Effect -- honest empty state, not fabricated.
  const ceSync = await handleDrawingExtractionApi(req("/api/documents/doc_ce/drawing-extraction/sync", "POST"), env);
  const ceBody = await ceSync.json();
  assert.equal(ceSync.status, 201);
  assert.equal(ceBody.proposals.filter((p) => p.proposalType === "Matrix Relationship Candidate").length, 0);
  assert.equal(ceBody.proposals.filter((p) => p.proposalType === "Matrix Header Candidate").length, 0);

  // API read model -> UI view model: GET returns the exact same shape a
  // client would feed into DrawingVisualReviewPanel's overlay rendering.
  const riserGet = await handleDrawingExtractionApi(req("/api/documents/doc_riser/drawing-extraction"), env);
  const riserGetBody = await riserGet.json();
  assert.equal(riserGetBody.synced, true);
  for (const proposal of riserGetBody.proposals) {
    assert.ok(proposal.id);
    assert.ok(proposal.governedStatus);
    assert.ok(typeof proposal.evidence === "object");
  }
});
