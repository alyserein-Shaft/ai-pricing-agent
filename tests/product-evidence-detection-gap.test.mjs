// AIU-4E — Product-Evidence Detection Gap (narrow repair).
//
// Proves the two real, catalog-backed physical device lines that were silently
// excluded from AI Understanding are now recognized, WITHOUT widening the
// evidence vocabulary so far that interface/control obligations or generic
// prose become product rows:
//
//   A. Positive detection — the real Golden device lines
//   B. Manifest progression — they become selectable, eligibility unchanged
//   C. False-positive protection — the 12 legitimate LS interface/function rows
//      stay excluded, and bare telephone/contact prose stays non-evidence
//   D. Regression — existing equipment still recognized, terminal BOQ rows
//      still excluded, nothing fabricated
//
// The real Golden source lines under test are exactly:
//   "Fireman telephone jack"  (4 rows, unit "No", system "Fire Alarm")
//   "Door contact"            (3 rows, unit "No", system "Fire Alarm")
import test from "node:test";
import assert from "node:assert/strict";

import { activeRows, loadUnderstandingProgression } from "../worker/estimator-understanding-api.mjs";
import { buildBoqUnderstandingPilotManifest } from "../app/domain/boq-understanding-pilot.mjs";
import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";

const PROJECT = "p1";
const ORG = "org1";

// WHY THE CANONICAL FIXTURE INSTEAD OF A HAND-WRITTEN SCHEMA
// ---------------------------------------------------------
// This file used to hand-roll a 12-table CREATE TABLE approximation opened with
// `PRAGMA foreign_keys=OFF`, plus a `raw.exec()` of `drizzle/0060_*.sql` on top.
// Both halves are now wrong in ways this file's own assertions expose:
//
//   * `drizzle/0060_estimator_understanding_review.sql` is ALREADY folded into
//     the active chain, so re-applying it fails with "table already exists" --
//     the `estimator_understanding_review_versions/events` tables this file
//     counts in D-14 come from the chain, not from that stray file.
//   * The approximation declared `boq_items.numeric_quantity REAL`. On the real
//     chain it is TEXT (quantities carry unit-bearing forms, so they are not
//     losslessly numeric), and `boq_items.source_location` is NOT NULL and must
//     be JSON. Disabling foreign keys hid that the estimate tables are real FK
//     children of `projects` / `organizations` / `boq_items`.
//
// The database below is therefore `activeChainDatabase()` -- the ACTUAL ordered
// drizzle-active chain read from the migration journal -- wrapped in the shared
// D1-shaped `d1()` adapter (tests/fixtures/active-chain-fixture.mjs), with FK
// enforcement left ON because the real chain leaves it on
// (drizzle-active/0002_governing_source_fk.sql). Every seed row below is an
// honest row against the REAL schema. :memory: only; no live data.

// The 7 repaired device rows (real Golden spellings/units), the 12 legitimate
// LS interface/function rows that must stay excluded, and terminal/ineligible
// rows that must never appear.
const DEVICES = [
  "Fireman telephone jack",
  "Fireman telephone jack",
  "Fireman telephone jack",
  "Fireman telephone jack",
  "Door contact",
  "Door contact",
  "Door contact Door contact", // persisted duplicate-description form
];
const FUNCTIONS = [
  "Control and monitor element as required for interfacing with access doors, sliding door, fire fighting and HVAC system for proper operation",
  "Control and monitor element as required for interfacing with access doors, sliding door, fire fighting and HVAC system for proper operation",
  "Control of HVAC equipment, smoke exhaust fans, duct heaters and interfacing with BMS system",
  "Control of HVAC equipment, smoke exhaust fans, duct heaters and interfacing with BMS system",
  "Signals to elevators with all required accessories",
  "Signals to elevators with all required accessories",
  "Signals to elevators with all required accessories",
];

const ROWS = [];
let seq = 0;
for (const [index, description] of DEVICES.entries()) {
  seq += 1;
  ROWS.push({ id: `dev-${index}`, seq, itemNumber: String.fromCharCode(75 + index), description, qty: 6 + index, unit: "No", system: "28.01 - Fire Alarm System", reviewStatus: "Auto Verified", downstream: 1 });
}
for (const [index, description] of FUNCTIONS.entries()) {
  seq += 1;
  ROWS.push({ id: `fun-${index}`, seq, itemNumber: String.fromCharCode(65 + index), description, qty: 1, unit: "LS", system: "28.01 - Fire Alarm System", reviewStatus: "Auto Verified", downstream: 1 });
}
ROWS.push({ id: "x-mg", seq: ++seq, itemNumber: "X1", description: "Door contact", qty: 4, unit: "No", system: "28.01 - Fire Alarm System", reviewStatus: "Merged", downstream: 0 });
ROWS.push({ id: "x-rj", seq: ++seq, itemNumber: "X2", description: "Fireman telephone jack", qty: 4, unit: "No", system: null, reviewStatus: "Rejected", downstream: 0 });
ROWS.push({ id: "x-inv", seq: ++seq, itemNumber: "X3", description: "Door contact", qty: 4, unit: "No", system: null, reviewStatus: "Approved", downstream: 0 });

// `numeric_quantity`/`original_quantity` are TEXT on the real chain, `source_location`
// is NOT NULL and must be JSON, and `boq_extraction_versions` carries a governed
// engine identity (parser/ruleset/ocr) plus a NOT NULL created_by. Every INSERT
// below is by named column.
const SOURCE_LOCATION = JSON.stringify({ rowIndex: 1, sheet: "Fixture", column: "A" });

const seed = async () => {
  const raw = activeChainDatabase();
  raw.exec(`
    INSERT INTO organizations (id,name) VALUES ('${ORG}','Organization One');
    INSERT INTO projects (id,name,owner_user_id,organization_id) VALUES ('${PROJECT}','Detection Gap Test','owner1','${ORG}');
    INSERT INTO documents (id,project_id,logical_name,document_type,classification_source,current_version_id,created_by)
      VALUES ('doc1','${PROJECT}','boq-1.xlsx','BOQ','Manual Confirmation','dv1','owner1');
    INSERT INTO document_versions (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by,quarantine_status)
      VALUES ('dv1','doc1',1,'boq-1.xlsx','boq-1.xlsx','xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',4,'sha-dv1','projects/${PROJECT}/boq-1.xlsx','owner1','Clear');
    INSERT INTO boq_extraction_versions (id,document_id,document_version_id,version_number,status,parser_version,ruleset_version,ocr_version,created_by)
      VALUES ('ext1','doc1','dv1',1,'Completed','parser-v1','rules-v1','ocr-v1','owner1');
    -- run_mode is NOT NULL DEFAULT 'CONTROLLED_PILOT' on the real chain; the
    -- old hand-rolled table had no such column and the seed wrote a literal NULL
    -- for it. The real default is the truthful value for this seed, so it is
    -- left to the chain.
    INSERT INTO estimator_understanding_runs (id,parent_run_id,authorization_fingerprint,project_id,organization_id,provider,model,model_version,prompt_version,schema_version,config_fingerprint,status,total_items,processed_items,successful_items,review_items,failed_items,requested_by,started_at,completed_at)
      VALUES ('run0',NULL,NULL,'${PROJECT}','${ORG}','p','m','mv','pv','sv','cfg0','COMPLETED',0,0,0,0,0,'owner1','2026-09-01',NULL);
  `);
  const insert = raw.prepare(`INSERT INTO boq_items (id,project_id,row_type,extraction_version_id,source_document_id,sequence,item_number,description,numeric_quantity,original_quantity,normalized_unit,original_unit,system_value,category,subcategory,manufacturer,model,part_number,section_path,confidence_state,source_location,original_raw_values,current_values,review_status,approved_for_downstream,specification_reference,system_confidence,extraction_confidence)
    VALUES (?,?,'BOQ Item','ext1','doc1',?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,NULL,'[]','High Confidence',?,'[]','{}',?,?,NULL,95,60)`);
  for (const row of ROWS) insert.run(row.id, PROJECT, row.seq, row.itemNumber, row.description, String(row.qty), String(row.qty), row.unit, row.unit, row.system, SOURCE_LOCATION, row.reviewStatus, row.downstream);
  return raw;
};

const laneOf = async (raw) => {
  const rows = await activeRows(d1(raw), PROJECT);
  const lanes = {};
  for (const row of rows) {
    const one = buildBoqUnderstandingPilotManifest(PROJECT, [row], { alreadyInterpretedItemIds: new Set() });
    lanes[row.boqItemId] = one.excludedDataQualityCount > 0 ? "DATA_QUALITY_EXCLUDED" : one.selectedPrimaryCount > 0 ? "GOVERNED_PRIMARY" : "CROSS_SYSTEM_EXPLORATORY";
  }
  return { rows, lanes };
};

test("A-1/A-2: all 4 'Fireman telephone jack' variants are recognized as product evidence", async () => {
  const raw = await seed();
  const { lanes } = await laneOf(raw);
  for (let index = 0; index < 4; index += 1) {
    assert.notEqual(lanes[`dev-${index}`], "DATA_QUALITY_EXCLUDED", `Fireman telephone jack row dev-${index} must not be data-quality excluded`);
  }
});

test("A-3/A-4: all 3 'Door contact' variants (incl. duplicated description) are recognized", async () => {
  const raw = await seed();
  const { lanes } = await laneOf(raw);
  for (let index = 4; index < 7; index += 1) {
    assert.notEqual(lanes[`dev-${index}`], "DATA_QUALITY_EXCLUDED", `Door contact row dev-${index} must not be data-quality excluded`);
  }
});

test("B-5/B-6: repaired rows become selectable through the existing lane rules and progression", async () => {
  const raw = await seed();
  const progression = await loadUnderstandingProgression(d1(raw), PROJECT);
  const rows = await activeRows(d1(raw), PROJECT);
  const manifest = buildBoqUnderstandingPilotManifest(PROJECT, rows, { alreadyInterpretedItemIds: new Set() });
  // Only the legitimate function rows remain excluded; the 7 repaired device
  // rows now occupy executable lanes (primary or exploratory -- never forced).
  assert.equal(manifest.excludedDataQualityCount, FUNCTIONS.length, "only the legitimate function rows remain excluded");
  const executable = manifest.eligiblePrimaryCount + manifest.eligibleExploratoryCount;
  assert.equal(executable, DEVICES.length, "all 7 repaired rows are now in an executable lane");
  assert.equal(progression.unAnalysable, FUNCTIONS.length, "unAnalysable is now exactly the legitimate function population");
  assert.equal(progression.hasMoreSelectable, true);
});

test("B-7: eligibility still depends on the canonical AI eligibility predicate (Merged/Rejected/invalidated stay out)", async () => {
  const raw = await seed();
  const { rows } = await laneOf(raw);
  const ids = new Set(rows.map((row) => row.boqItemId));
  for (const excluded of ["x-mg", "x-rj", "x-inv"]) {
    assert.ok(!ids.has(excluded), `${excluded} must remain outside the AI-eligible population`);
  }
});

test("C-8/C-9: the 12 legitimate LS interface/function obligations remain excluded", async () => {
  const raw = await seed();
  const { lanes } = await laneOf(raw);
  for (let index = 0; index < FUNCTIONS.length; index += 1) {
    assert.equal(lanes[`fun-${index}`], "DATA_QUALITY_EXCLUDED", `function row fun-${index} must remain excluded`);
  }
});

// NOTE on the two phrases below that DO match: "Contact interface signal..."
// and "Door interface/control function" already produced product evidence
// BEFORE this slice, via the pre-existing `interfaces?` term in equipmentNoun
// (verified by direct old-vs-new regex comparison). That pre-existing
// behaviour is deliberately NOT changed here -- it is a separate, unrelated
// detection question. What this slice must guarantee is that the NEW
// door-contact/telephone terms did not cause them, and that contact-specific
// prose with no interface noun stays non-evidence.
test("C-10: contact-specific prose without an interface noun is not product evidence", async () => {
  const raw = await seed();
  const mustStayExcluded = [
    "Contact client / contact person for coordination",
    "Integration with door system",
    "Isolated sets of form C contacts",
  ];
  for (const [index, phrase] of mustStayExcluded.entries()) {
    raw.prepare("INSERT INTO boq_items (id,project_id,row_type,extraction_version_id,source_document_id,sequence,item_number,description,numeric_quantity,original_quantity,normalized_unit,original_unit,system_value,section_path,confidence_state,source_location,original_raw_values,current_values,review_status,approved_for_downstream,extraction_confidence) VALUES (?,?,'BOQ Item','ext1','doc1',?,?,?,?,?,? ,? ,?, '[]','High Confidence',?, '[]','{}','Auto Verified',1,60)")
      .run(`prose-${index}`, PROJECT, 900 + index, "P", phrase, "1", "1", "No", "No", "28.01 - Fire Alarm System", SOURCE_LOCATION);
  }
  const rows = await activeRows(d1(raw), PROJECT);
  for (const row of rows) {
    if (!row.boqItemId.startsWith("prose-")) continue;
    const one = buildBoqUnderstandingPilotManifest(PROJECT, [row], { alreadyInterpretedItemIds: new Set() });
    assert.equal(one.excludedDataQualityCount, 1, `"${row.description}" must NOT become product evidence`);
  }
});

test("C-11: bare telephone wording stays rejected (office-phone collision guard preserved)", async () => {
  const raw = await seed();
  // These must remain NON-evidence. The taxonomy pack deliberately rejects
  // bare "telephone" / "telephone jack" for an office-phone collision
  // (KX-AT7730 Panasonic Master Telephone; fire-alarm-taxonomy.mjs:503-505,
  // :519), so the fire-qualification added by AIU-4E must never be dropped.
  const phrases = [
    "Telephone communication functionality",
    "Master telephone",
    "Bare telephone jack",
  ];
  for (const [index, phrase] of phrases.entries()) {
    raw.prepare("INSERT INTO boq_items (id,project_id,row_type,extraction_version_id,source_document_id,sequence,item_number,description,numeric_quantity,original_quantity,normalized_unit,original_unit,system_value,section_path,confidence_state,source_location,original_raw_values,current_values,review_status,approved_for_downstream,extraction_confidence) VALUES (?,?,'BOQ Item','ext1','doc1',?,?,?,?,?,? ,? ,?, '[]','High Confidence',?, '[]','{}','Auto Verified',1,60)")
      .run(`tel-${index}`, PROJECT, 800 + index, "T", phrase, "1", "1", "No", "No", "28.01 - Fire Alarm System", SOURCE_LOCATION);
  }
  const rows = await activeRows(d1(raw), PROJECT);
  for (const row of rows) {
    if (!row.boqItemId.startsWith("tel-")) continue;
    const one = buildBoqUnderstandingPilotManifest(PROJECT, [row], { alreadyInterpretedItemIds: new Set() });
    assert.equal(one.excludedDataQualityCount, 1, `"${row.description}" must NOT become product evidence (office-phone collision guard)`);
  }
});

test("C-11b: 'remote handset' stays taxonomy-resolved (pre-existing, not an AIU-4E effect)", async () => {
  // "remote handset" is a GOVERNED Firefighter Telephone alias, so the
  // taxonomy -- not the AIU-4E equipmentNoun terms -- is what admits this row.
  // Asserted explicitly so nobody later mistakes it for this slice's work.
  const raw = await seed();
  raw.prepare("INSERT INTO boq_items (id,project_id,row_type,extraction_version_id,source_document_id,sequence,item_number,description,numeric_quantity,original_quantity,normalized_unit,original_unit,system_value,section_path,confidence_state,source_location,original_raw_values,current_values,review_status,approved_for_downstream,extraction_confidence) VALUES (?,'p1','BOQ Item','ext1','doc1',?,'RH','Remote handsets for the intercom','1','1','No','No','28.01 - Fire Alarm System','[]','High Confidence',?, '[]','{}','Auto Verified',1,60)")
    .run("remote-handset", 701, SOURCE_LOCATION);
  const rows = await activeRows(d1(raw), PROJECT);
  const row = rows.find((entry) => entry.boqItemId === "remote-handset");
  const one = buildBoqUnderstandingPilotManifest(PROJECT, [row], { alreadyInterpretedItemIds: new Set() });
  assert.equal(one.excludedDataQualityCount, 0, "taxonomy-governed alias keeps this row admitted");
});

test("D-12: existing recognized equipment remains recognized (no regression)", async () => {
  const raw = await seed();
  const known = [
    "Addressable Smoke Detector",
    "Manual Call Point",
    "Interface Module",
    "Loop powered strobe",
    "Fire Alarm Control Panel",
    "Heat Detector",
  ];
  for (const [index, description] of known.entries()) {
    raw.prepare("INSERT INTO boq_items (id,project_id,row_type,extraction_version_id,source_document_id,sequence,item_number,description,numeric_quantity,original_quantity,normalized_unit,original_unit,system_value,section_path,confidence_state,source_location,original_raw_values,current_values,review_status,approved_for_downstream,extraction_confidence) VALUES (?,?,'BOQ Item','ext1','doc1',?,?,?,?,?,? ,? ,?, '[]','High Confidence',?, '[]','{}','Auto Verified',1,60)")
      .run(`known-${index}`, PROJECT, 700 + index, "N", description, "2", "2", "Each", "Each", "28.01 - Fire Alarm System", SOURCE_LOCATION);
  }
  const rows = await activeRows(d1(raw), PROJECT);
  for (const row of rows) {
    if (!row.boqItemId.startsWith("known-")) continue;
    const one = buildBoqUnderstandingPilotManifest(PROJECT, [row], { alreadyInterpretedItemIds: new Set() });
    assert.equal(one.excludedDataQualityCount, 0, `"${row.description}" must remain product evidence`);
  }
});

test("D-13: the relay 'Form C Contacts' phrasing is still NOT product evidence", async () => {
  const raw = await seed();
  raw.prepare("INSERT INTO boq_items (id,project_id,row_type,extraction_version_id,source_document_id,sequence,item_number,description,numeric_quantity,original_quantity,normalized_unit,original_unit,system_value,section_path,confidence_state,source_location,original_raw_values,current_values,review_status,approved_for_downstream,extraction_confidence) VALUES (?,'p1','BOQ Item','ext1','doc1',699,'R','Intelligent Addressable Relay Module W/ 2 Isolated Sets Of Form C Contacts','1','1','No','No','28.01 - Fire Alarm System','[]','High Confidence',?, '[]','{}','Auto Verified',1,60)")
    .run("relay-contacts", SOURCE_LOCATION);
  const rows = await activeRows(d1(raw), PROJECT);
  const relay = rows.find((row) => row.boqItemId === "relay-contacts");
  // This row is legitimately a device via "module", so assert the guard is
  // specifically about 'contact' not being the trigger: it must not be
  // recognized BECAUSE of contacts. Assert via a contacts-only variant.
  assert.ok(relay);
  raw.prepare("INSERT INTO boq_items (id,project_id,row_type,extraction_version_id,source_document_id,sequence,item_number,description,numeric_quantity,original_quantity,normalized_unit,original_unit,system_value,section_path,confidence_state,source_location,original_raw_values,current_values,review_status,approved_for_downstream,extraction_confidence) VALUES (?,'p1','BOQ Item','ext1','doc1',698,'R2','Isolated sets of form C contacts','1','1','No','No','28.01 - Fire Alarm System','[]','High Confidence',?, '[]','{}','Auto Verified',1,60)")
    .run("contacts-only", SOURCE_LOCATION);
  const rows2 = await activeRows(d1(raw), PROJECT);
  const contactsOnly = rows2.find((row) => row.boqItemId === "contacts-only");
  const one = buildBoqUnderstandingPilotManifest(PROJECT, [contactsOnly], { alreadyInterpretedItemIds: new Set() });
  assert.equal(one.excludedDataQualityCount, 1, "bare 'contacts' must not be product evidence");
});

test("D-14: no interpretation or review decision is fabricated by detection", async () => {
  const raw = await seed();
  await loadUnderstandingProgression(d1(raw), PROJECT);
  const interpretations = raw.prepare("SELECT COUNT(*) c FROM estimator_item_interpretations").get();
  const versions = raw.prepare("SELECT COUNT(*) c FROM estimator_understanding_review_versions").get();
  const events = raw.prepare("SELECT COUNT(*) c FROM estimator_understanding_review_events").get();
  assert.equal(Number(interpretations.c), 0, "detection must not create interpretations");
  assert.equal(Number(versions.c), 0);
  assert.equal(Number(events.c), 0);
});
