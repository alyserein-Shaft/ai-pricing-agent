import test from "node:test";
import assert from "node:assert/strict";

import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import { loadCurrentBoqItems, resolveBoqItemContext, resolveRequirementProfile, resolveProductMatchingStatus } from "../worker/ai-presales-agent-tools.mjs";

// Phase A1 Slice 2: the REAL SQL-backed item resolver, proven against a
// real in-memory SQLite database using the SAME schema fragments and D1-shim
// pattern already established throughout this codebase's worker-level
// tests (e.g. tests/technical-requirement-drawing-handoff.test.mjs). This
// is what proves resolveBoqItemContext genuinely reuses
// currentBoqEvidenceFrom/currentBoqItemPredicate -- the single existing
// "current BOQ item" authority -- not a hand-mocked shortcut.

// The fixture is the ACTUAL ordered active migration chain (drizzle-active
// journal), not a hand-written approximation -- see tests/fixtures/
// active-chain-fixture.mjs. Every seed row below therefore has to satisfy the
// REAL NOT NULL set, and FK enforcement is on because the real chain leaves it
// on (drizzle-active/0002_governing_source_fk.sql) -- which is how the retired
// fixture's `specification_extraction_versions` (no document_version_id, and
// that is exactly the column the canonical currentness query reads) is caught.
const buildDatabase = async () => activeChainDatabase();

// DOC-R3: effective_from/effective_to both NULL == open-past/open-future == IN
// FORCE, so dv1/dv2 are their documents' governing versions. Stated
// deliberately: the canonical currentness predicate reads exactly these columns
// through documentVersionGoverningPredicate.
const seedProject = (raw, { projectId = "p1", documentId = "doc1", versionId = "dv1", extractionId = "ext1" } = {}) => {
  if (!raw.prepare("SELECT 1 FROM organizations WHERE id='org1'").get()) raw.exec(`INSERT INTO organizations (id, name) VALUES ('org1','Org One');`);
  raw.exec(`
    INSERT INTO projects (id, name, owner_user_id, organization_id) VALUES ('${projectId}','P','owner1','org1');
    INSERT INTO documents (id, project_id, logical_name, created_by) VALUES ('${documentId}','${projectId}','BOQ.xlsx','owner1');
    INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by)
      VALUES ('${versionId}','${documentId}',1,'boq.xlsx','boq.stored','xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',4,'sha-${versionId}','projects/${projectId}/boq.xlsx','owner1');
    UPDATE documents SET current_version_id='${versionId}' WHERE id='${documentId}';
    INSERT INTO boq_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, ocr_version, created_by)
      VALUES ('${extractionId}','${documentId}','${versionId}',1,'Completed','parser-v1','rules-v1','ocr-v1','owner1');
  `);
};

const insertItem = (raw, item) => {
  // Real chain fidelity, not fixture convenience: boq_items.original_quantity /
  // numeric_quantity are TEXT and source_location/original_raw_values/
  // section_path are NOT NULL JSON on the real table.
  raw.prepare(
    `INSERT INTO boq_items (id,project_id,row_type,extraction_version_id,source_document_id,sequence,item_number,description,numeric_quantity,original_quantity,normalized_unit,original_unit,system_value,category,subcategory,manufacturer,model,part_number,section_path,source_location,original_raw_values,current_values,review_status,approved_for_downstream,specification_reference,system_confidence,extraction_confidence,confidence_state)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    item.id, "p1", "BOQ Item", "ext1", "doc1", item.sequence, item.item_number ?? null, item.description, String(item.numeric_quantity), String(item.numeric_quantity), "Each", "Each",
    item.system_value ?? null, item.category ?? null, item.subcategory ?? null, null, null, null, "[]", "{}", "[]", "{}", "Approved", 1, null, null, 60, "Medium Confidence",
  );
};

test("loadCurrentBoqItems returns only the project's real current items, via the single existing 'current' authority boundary", async () => {
  const raw = await buildDatabase();
  seedProject(raw);
  insertItem(raw, { id: "boqitem_1", sequence: 1, item_number: "28.19", description: "Dome Camera", numeric_quantity: 24, system_value: "CCTV", subcategory: "Dome Camera" });
  insertItem(raw, { id: "boqitem_2", sequence: 2, item_number: "28.20", description: "Bullet Camera", numeric_quantity: 6 });
  const DB = d1(raw);
  const items = await loadCurrentBoqItems(DB, "p1");
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.item_number).sort(), ["28.19", "28.20"]);
});

test("resolveBoqItemContext resolves a real item by its displayed item number and returns the honest compact contract", async () => {
  const raw = await buildDatabase();
  seedProject(raw);
  insertItem(raw, { id: "boqitem_1", sequence: 1, item_number: "28.19", description: "Ceiling Mounted Dome Camera", numeric_quantity: 24, system_value: "CCTV", subcategory: "Dome Camera" });
  const DB = d1(raw);
  const result = await resolveBoqItemContext(DB, { projectId: "p1", reference: "28.19" });
  assert.equal(result.found, true);
  assert.equal(result.item.itemId, "boqitem_1");
  assert.equal(result.item.itemReference, "28.19");
  assert.equal(result.item.description, "Ceiling Mounted Dome Camera");
  assert.equal(result.item.boqQuantity, 24);
  assert.equal(result.item.selectedQuantity, 24, "no quantity decision exists yet -- falls back to the real BOQ quantity, exactly like Stage 9's currentSelectedQuantity");
  assert.equal(result.item.selectedQuantitySource, "BOQ");
  assert.equal(result.item.system, "CCTV");
  assert.equal(result.item.family, "Dome Camera");
  assert.equal(result.item.reviewStatus, "Approved");
});

test("resolveBoqItemContext resolves by 'Row N' when item_number is null", async () => {
  const raw = await buildDatabase();
  seedProject(raw);
  insertItem(raw, { id: "boqitem_1", sequence: 7, item_number: null, description: "Unlabeled row", numeric_quantity: 1 });
  const DB = d1(raw);
  const result = await resolveBoqItemContext(DB, { projectId: "p1", reference: "Row 7" });
  assert.equal(result.found, true);
  assert.equal(result.item.itemReference, "Row 7");
});

test("resolveBoqItemContext resolves by the internal item id", async () => {
  const raw = await buildDatabase();
  seedProject(raw);
  insertItem(raw, { id: "boqitem_abcdef12-3456-7890-abcd-ef1234567890", sequence: 1, item_number: "1.1", description: "x", numeric_quantity: 1 });
  const DB = d1(raw);
  const result = await resolveBoqItemContext(DB, { projectId: "p1", reference: "boqitem_abcdef12-3456-7890-abcd-ef1234567890" });
  assert.equal(result.found, true);
  assert.equal(result.item.itemId, "boqitem_abcdef12-3456-7890-abcd-ef1234567890");
});

test("resolveBoqItemContext honestly reports ITEM_NOT_FOUND -- never a guessed nearest item", async () => {
  const raw = await buildDatabase();
  seedProject(raw);
  insertItem(raw, { id: "boqitem_1", sequence: 1, item_number: "28.19", description: "x", numeric_quantity: 1 });
  const DB = d1(raw);
  const result = await resolveBoqItemContext(DB, { projectId: "p1", reference: "99.99" });
  assert.equal(result.found, false);
  assert.equal(result.reason, "ITEM_NOT_FOUND");
  assert.equal(result.candidateReference, "99.99");
});

test("resolveBoqItemContext honestly reports ITEM_REFERENCE_AMBIGUOUS for a real duplicate item_number -- never guesses a selection", async () => {
  const raw = await buildDatabase();
  seedProject(raw);
  insertItem(raw, { id: "boqitem_1", sequence: 1, item_number: "9.1", description: "first 9.1", numeric_quantity: 1 });
  insertItem(raw, { id: "boqitem_2", sequence: 15, item_number: "9.1", description: "duplicate 9.1 from a split row", numeric_quantity: 2 });
  const DB = d1(raw);
  const result = await resolveBoqItemContext(DB, { projectId: "p1", reference: "9.1" });
  assert.equal(result.found, false);
  assert.equal(result.reason, "ITEM_REFERENCE_AMBIGUOUS");
});

test("resolveBoqItemContext scopes strictly to the requested project -- an identical item_number in another project is never matched", async () => {
  const raw = await buildDatabase();
  seedProject(raw);
  seedProject(raw, { projectId: "p2", documentId: "doc2", versionId: "dv2", extractionId: "ext2" });
  insertItem(raw, { id: "boqitem_p1", sequence: 1, item_number: "28.19", description: "project 1 item", numeric_quantity: 1 });
  raw.prepare(
    `INSERT INTO boq_items (id,project_id,row_type,extraction_version_id,source_document_id,sequence,item_number,description,numeric_quantity,original_quantity,normalized_unit,original_unit,system_value,category,subcategory,manufacturer,model,part_number,section_path,source_location,original_raw_values,current_values,review_status,approved_for_downstream,specification_reference,system_confidence,extraction_confidence,confidence_state)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run("boqitem_p2", "p2", "BOQ Item", "ext2", "doc2", 1, "28.19", "project 2 item", "1", "1", "Each", "Each", null, null, null, null, null, null, "[]", "{}", "[]", "{}", "Approved", 1, null, null, 60, "Medium Confidence");
  const DB = d1(raw);
  const result = await resolveBoqItemContext(DB, { projectId: "p1", reference: "28.19" });
  assert.equal(result.found, true);
  assert.equal(result.item.itemId, "boqitem_p1", "must resolve within project p1 only, never leak project p2's identically-numbered item");
});

// ============================================================
// Section 2/Stage 9 reuse proof: an existing Quantity Source Decision and
// an existing APPROVED AI Understanding Review family are both correctly
// preferred over the raw BOQ row -- proving real reuse, not
// reimplementation, of Stage 9's currentSelectedQuantity and the same
// approved-understanding authority technical-requirement-api.mjs already
// treats as canonical.
// ============================================================
test("resolveBoqItemContext prefers a real Quantity Source Decision over the raw BOQ quantity", async () => {
  const raw = await buildDatabase();
  seedProject(raw);
  insertItem(raw, { id: "boqitem_1", sequence: 1, item_number: "28.19", description: "x", numeric_quantity: 24 });
  // A Drawing-sourced quantity decision is only honoured when it names the
  // CURRENT symbol recognition version for the item's source document --
  // worker/quantity-source-decision-api.mjs reports STALE (and refuses the
  // decision) otherwise. A decision with no recognition version at all is
  // exactly that case, so the seed records the real governed lineage.
  //
  // FAILING (2026-09-27, real chain): the assertion below is the ORIGINAL pin
  // and is left as written. It fails with selectedQuantity null even though the
  // decision names the current recognition version, because
  // worker/ai-presales-agent-tools.mjs's loadCurrentBoqItems projects
  //   SELECT b.id, b.item_number, b.sequence, b.description, b.numeric_quantity,
  //          b.original_quantity, b.system_value, b.subcategory, b.category,
  //          b.review_status
  // and never selects `b.source_document_id`. currentSelectedQuantity's
  // Drawing branch starts with `if (!boqItem.source_document_id) return STALE`,
  // so EVERY Drawing-sourced quantity decision reached through this reader is
  // reported STALE and its selected quantity is dropped -- the reader cannot
  // honour a governed Drawing decision at all. Observed shape:
  //   { boqQuantity: 24, selectedQuantity: null, selectedQuantitySource: "Drawing" }
  // This was masked before the fixture repair: the test used to die earlier on
  // "no such column: newer.document_version_id". The one-word fix is to project
  // b.source_document_id in loadCurrentBoqItems; worker/ is not owned by this
  // repair, so it is reported rather than applied.
  raw.prepare("INSERT INTO drawing_intake_versions (id,project_id,document_id,document_version_id,version_number,input_fingerprint,output_fingerprint,parser_version,status,summary,created_by) VALUES ('intake-1','p1','doc1','dv1',1,'i','o','parser-1','Completed','{}','engineer1')").run();
  raw.prepare("INSERT INTO drawing_symbol_recognition_versions (id,project_id,document_id,document_version_id,drawing_intake_version_id,version_number,input_fingerprint,output_fingerprint,engine_version,status,summary,created_by) VALUES ('recog_current','p1','doc1','dv1','intake-1',1,'i','o','r','Completed','{}','engineer1')").run();
  raw.prepare(
    "INSERT INTO boq_quantity_source_decisions (id,project_id,boq_item_id,source,selected_quantity,boq_quantity,recognition_version_id,definition_key,reason,decided_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run("decision1", "p1", "boqitem_1", "Drawing", 22, 24, "recog_current", "def_re", "Reviewed drawing set governs.", "engineer1");
  const DB = d1(raw);
  const result = await resolveBoqItemContext(DB, { projectId: "p1", reference: "28.19" });
  assert.equal(result.item.boqQuantity, 24, "the raw BOQ quantity itself is never overwritten");
  assert.equal(result.item.selectedQuantity, 22);
  assert.equal(result.item.selectedQuantitySource, "Drawing");
});

// ============================================================
// Slice 3: resolveRequirementProfile -- the REAL SQL-backed requirement
// profile reader, proven against currentRequirementProfileRow (the SAME
// "current profile" query technical-requirement-api.mjs and requirement-
// profile-currency.mjs already use) and shapeRequirementProfile (pure,
// tested separately in tests/ai-presales-agent-engine.test.mjs).
// ============================================================
const insertProfile = (raw, { id, boqItemId, versionNumber = 1, status = "Completed", readinessStatus = "Ready for Matching", profile, superseded_at = null }) => {
  raw.prepare(
    "INSERT INTO requirement_profile_versions (id,project_id,boq_item_id,version_number,status,engine_version,ruleset_version,model_version,input_fingerprint,profile,explanation,readiness_status,confidence_summary,created_by,superseded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(id, "p1", boqItemId, versionNumber, status, "engine-1", "rules-1", "model-1", "fp1", JSON.stringify(profile), "explanation", readinessStatus, "{}", "user1", superseded_at);
};

test("resolveRequirementProfile honestly reports REQUIREMENT_PROFILE_NOT_FOUND -- never a fabricated profile", async () => {
  const raw = await buildDatabase();
  seedProject(raw);
  insertItem(raw, { id: "boqitem_1", sequence: 1, item_number: "28.19", description: "x", numeric_quantity: 24 });
  const DB = d1(raw);
  const result = await resolveRequirementProfile(DB, { projectId: "p1", itemId: "boqitem_1" });
  assert.equal(result.found, false);
  assert.equal(result.reason, "REQUIREMENT_PROFILE_NOT_FOUND");
});

test("resolveRequirementProfile returns the real, current profile's readiness/blockers/requirements/missing/conflicts -- reusing the engine's own computed readiness, never recomputing it", async () => {
  const raw = await buildDatabase();
  seedProject(raw);
  insertItem(raw, { id: "boqitem_1", sequence: 1, item_number: "28.19", description: "x", numeric_quantity: 24 });
  const profile = {
    boqItem: { system: "Fire Alarm", productFamily: "Detector" },
    consolidatedRequirements: [
      { key: "Protocol", normalizedRequirement: "Protocol", attributes: [{ name: "Protocol", normalizedValue: "Addressable" }], sources: [{ sourceType: "Specification", source: {} }] },
      { key: "Panel Compatibility", normalizedRequirement: "Panel Compatibility", attributes: [], sources: [{ sourceType: "Specification", source: {} }] },
    ],
    missingInformation: [{ field: "Panel Compatibility", whyNeeded: "Required for safe matching." }],
    conflicts: [],
    readiness: { status: "Missing Critical Information", blockingReasons: ["Panel Compatibility is required."] },
  };
  insertProfile(raw, { id: "reqprofile_1", boqItemId: "boqitem_1", readinessStatus: "Missing Critical Information", profile });
  const DB = d1(raw);
  const result = await resolveRequirementProfile(DB, { projectId: "p1", itemId: "boqitem_1" });
  assert.equal(result.found, true);
  assert.equal(result.profileVersionId, "reqprofile_1");
  assert.equal(result.readinessStatus, "Missing Critical Information");
  assert.deepEqual(result.blockers, ["Panel Compatibility is required."]);
  assert.deepEqual(result.missingRequirements, ["Panel Compatibility"]);
  assert.equal(result.stale, false, "no Drawing-sourced requirements exist -- nothing to be stale relative to");
  assert.equal(result.system, "Fire Alarm");
  assert.equal(result.family, "Detector");
});

test("resolveRequirementProfile uses the CURRENT (non-superseded) profile version only, ignoring an older superseded version", async () => {
  const raw = await buildDatabase();
  seedProject(raw);
  insertItem(raw, { id: "boqitem_1", sequence: 1, item_number: "28.19", description: "x", numeric_quantity: 24 });
  insertProfile(raw, { id: "reqprofile_old", boqItemId: "boqitem_1", versionNumber: 1, readinessStatus: "Missing Critical Information", profile: { readiness: { status: "Missing Critical Information", blockingReasons: ["old blocker"] }, missingInformation: [], conflicts: [], consolidatedRequirements: [] }, superseded_at: "2026-01-01T00:00:00.000Z" });
  insertProfile(raw, { id: "reqprofile_new", boqItemId: "boqitem_1", versionNumber: 2, readinessStatus: "Ready for Matching", profile: { readiness: { status: "Ready for Matching", blockingReasons: [] }, missingInformation: [], conflicts: [], consolidatedRequirements: [] } });
  const DB = d1(raw);
  const result = await resolveRequirementProfile(DB, { projectId: "p1", itemId: "boqitem_1" });
  assert.equal(result.profileVersionId, "reqprofile_new");
  assert.equal(result.readinessStatus, "Ready for Matching");
  assert.deepEqual(result.blockers, []);
});

test("resolveRequirementProfile honestly detects staleness -- a Drawing-sourced requirement whose recognitionVersionId no longer matches the document's current version", async () => {
  const raw = await buildDatabase();
  seedProject(raw);
  insertItem(raw, { id: "boqitem_1", sequence: 1, item_number: "28.19", description: "x", numeric_quantity: 24 });
  raw.exec(`
    INSERT INTO drawing_intake_versions (id,project_id,document_id,document_version_id,version_number,input_fingerprint,output_fingerprint,parser_version,status,summary,created_by) VALUES ('intake-1','p1','doc1','dv1',1,'i','o','parser-1','Completed','{}','engineer1');
    INSERT INTO drawing_symbol_recognition_versions (id,project_id,document_id,document_version_id,drawing_intake_version_id,version_number,input_fingerprint,output_fingerprint,engine_version,status,summary,created_by,superseded_at) VALUES ('recog_old','p1','doc1','dv1','intake-1',1,'i','o','r','Completed','{}','engineer1','2026-01-01T00:00:00.000Z');
    INSERT INTO drawing_symbol_recognition_versions (id,project_id,document_id,document_version_id,drawing_intake_version_id,version_number,input_fingerprint,output_fingerprint,engine_version,status,summary,created_by) VALUES ('recog_new','p1','doc1','dv1','intake-1',2,'i2','o2','r','Completed','{}','engineer1');
  `);
  const profile = {
    boqItem: { system: "CCTV", productFamily: "Dome Camera" },
    consolidatedRequirements: [
      { key: "Family", normalizedRequirement: "Family", attributes: [], sources: [{ sourceType: "Drawing", source: { documentId: "doc1", recognitionVersionId: "recog_old" } }] },
    ],
    missingInformation: [],
    conflicts: [],
    readiness: { status: "Ready for Matching", blockingReasons: [] },
  };
  insertProfile(raw, { id: "reqprofile_1", boqItemId: "boqitem_1", profile });
  const DB = d1(raw);
  const result = await resolveRequirementProfile(DB, { projectId: "p1", itemId: "boqitem_1" });
  assert.equal(result.stale, true, "the profile's embedded recognitionVersionId (recog_old) no longer matches the document's current recognition version (recog_new)");
});

test("resolveRequirementProfile reports NOT stale when the Drawing-sourced requirement's recognitionVersionId still matches the current version", async () => {
  const raw = await buildDatabase();
  seedProject(raw);
  insertItem(raw, { id: "boqitem_1", sequence: 1, item_number: "28.19", description: "x", numeric_quantity: 24 });
  raw.exec(`
    INSERT INTO drawing_intake_versions (id,project_id,document_id,document_version_id,version_number,input_fingerprint,output_fingerprint,parser_version,status,summary,created_by) VALUES ('intake-1','p1','doc1','dv1',1,'i','o','parser-1','Completed','{}','engineer1');
    INSERT INTO drawing_symbol_recognition_versions (id,project_id,document_id,document_version_id,drawing_intake_version_id,version_number,input_fingerprint,output_fingerprint,engine_version,status,summary,created_by) VALUES ('recog_current','p1','doc1','dv1','intake-1',1,'i','o','r','Completed','{}','engineer1');
  `);
  const profile = {
    boqItem: {},
    consolidatedRequirements: [
      { key: "Family", normalizedRequirement: "Family", attributes: [], sources: [{ sourceType: "Drawing", source: { documentId: "doc1", recognitionVersionId: "recog_current" } }] },
    ],
    missingInformation: [],
    conflicts: [],
    readiness: { status: "Ready for Matching", blockingReasons: [] },
  };
  insertProfile(raw, { id: "reqprofile_1", boqItemId: "boqitem_1", profile });
  const DB = d1(raw);
  const result = await resolveRequirementProfile(DB, { projectId: "p1", itemId: "boqitem_1" });
  assert.equal(result.stale, false);
});

// ============================================================
// Slice 4: resolveProductMatchingStatus -- the REAL SQL-backed matching
// reader, proven against currentMatchRunRow (the SAME "current match run"
// query worker/product-matching-api.mjs's own currentRun() already uses)
// and worker/product-matching-api.mjs's OWN exported matchRunStaleness().
// ============================================================
const insertManufacturer = (raw, { id, name }) => raw.prepare("INSERT INTO product_manufacturers (id,name,normalized_name,status,created_by) VALUES (?,?,?,'Approved','user1')").run(id, name, name.toLowerCase());
const insertFamily = (raw, { id, name }) => raw.prepare("INSERT INTO product_families (id,name,normalized_name,review_status) VALUES (?,?,?,'Approved')").run(id, name, name.toLowerCase());
// On the real chain `canonical_library_products` is a VIEW over
// library_products (identity-chain projection), not a table: the retired
// fixture declared it as a table, so it wrote a row that does not exist in
// production and left product_match_candidates.product_id dangling. Writing the
// governed library_products row is what actually makes the canonical projection
// -- and therefore the reader's join -- resolve.
const insertCanonicalProduct = (raw, { id, partNumber, manufacturerId, familyId = null }) => {
  raw.prepare("INSERT INTO library_products (id,manufacturer_id,brand_id,family_id,part_number,normalized_part_number,description,created_by) VALUES (?,?,NULL,?,?,?,?,'user1')")
    .run(id, manufacturerId, familyId, partNumber, partNumber, `Library product ${partNumber}`);
};
const insertMatchRun = (raw, { id, boqItemId, requirementProfileVersionId, versionNumber = 1, status = "Needs Review", noMatch = null, candidateCount = 0, superseded_at = null }) =>
  // The real product_match_runs row carries a governed engine/search identity.
  raw.prepare("INSERT INTO product_match_runs (id,project_id,boq_item_id,requirement_profile_version_id,version_number,status,input_fingerprint,engine_version,ruleset_version,search_version,model_version,search_scope,summary,no_match,candidate_count,superseded_at,created_by) VALUES (?,?,?,?,?,?,'fp1','engine-1','rules-1','search-1','model-1','{}','{}',?,?,?,'user1')")
    .run(id, "p1", boqItemId, requirementProfileVersionId, versionNumber, status, noMatch ? JSON.stringify(noMatch) : null, candidateCount, superseded_at);
const insertCandidate = (raw, { id, matchRunId, productId, rank, technicalStatus, reviewStatus = "Needs Review", matchingBasis = [], mandatoryFailures = [] }) =>
  // The real candidate row carries the governed scoring/search-stage identity.
  raw.prepare("INSERT INTO product_match_candidates (id,match_run_id,product_id,rank,search_stage,score,score_components,technical_status,recommendation_tier,confidence_state,confidence_score,matching_basis,commercial_availability,explanation,mandatory_failures,lifecycle_result,review_status) VALUES (?,?,?,?,'Library',1,'{}',?,'Recommended','High Confidence',90,?,'Available','Matched',?,'Verified',?)")
    .run(id, matchRunId, productId, rank, technicalStatus, JSON.stringify(matchingBasis), JSON.stringify(mandatoryFailures), reviewStatus);

// A clean, always-current requirement profile -- resolveProductMatchingStatus's
// staleness check (matchRunStaleness) compares the match run's stored
// requirement_profile_version_id against THIS row's id via
// currentRequirementProfileId.
// The real requirement_profile_versions table enforces
// UNIQUE(boq_item_id, version_number), so a SECOND current profile for the same
// item is version 2, exactly as regeneration numbers it.
const seedCurrentProfile = (raw, boqItemId, id = "reqprofile_current", versionNumber = 1) => insertProfile(raw, {
  id, boqItemId, versionNumber, readinessStatus: "Ready for Matching",
  profile: { readiness: { status: "Ready for Matching", blockingReasons: [] }, missingInformation: [], conflicts: [], consolidatedRequirements: [] },
});

test("resolveProductMatchingStatus honestly reports MATCH_RUN_NOT_FOUND -- never interprets absence as 'no compatible product exists'", async () => {
  const raw = await buildDatabase();
  seedProject(raw);
  insertItem(raw, { id: "boqitem_1", sequence: 1, item_number: "28.19", description: "x", numeric_quantity: 24 });
  const DB = d1(raw);
  const result = await resolveProductMatchingStatus(DB, { projectId: "p1", itemId: "boqitem_1" });
  assert.equal(result.found, false);
  assert.equal(result.reason, "MATCH_RUN_NOT_FOUND");
});

test("resolveProductMatchingStatus returns the real status/candidateCount/counts/candidates, with failedCriteria/missingEvidence correctly split from mandatory_failures", async () => {
  const raw = await buildDatabase();
  seedProject(raw);
  insertItem(raw, { id: "boqitem_1", sequence: 1, item_number: "28.19", description: "x", numeric_quantity: 24 });
  seedCurrentProfile(raw, "boqitem_1");
  insertManufacturer(raw, { id: "mfr1", name: "Honeywell" });
  insertFamily(raw, { id: "fam1", name: "Dome Camera" });
  insertCanonicalProduct(raw, { id: "prod_eligible", partNumber: "IDP-EAGLE", manufacturerId: "mfr1", familyId: "fam1" });
  insertCanonicalProduct(raw, { id: "prod_discovery", partNumber: "IDP-PHOTO-IV", manufacturerId: "mfr1", familyId: "fam1" });
  insertCanonicalProduct(raw, { id: "prod_noncompliant", partNumber: "IDP-BAD", manufacturerId: "mfr1", familyId: "fam1" });
  insertMatchRun(raw, { id: "matchrun_1", boqItemId: "boqitem_1", requirementProfileVersionId: "reqprofile_current", status: "Needs Review", candidateCount: 3 });
  insertCandidate(raw, { id: "cand_eligible", matchRunId: "matchrun_1", productId: "prod_eligible", rank: 1, technicalStatus: "Technically Compliant", matchingBasis: ["Manufacturer + Product Family"], mandatoryFailures: [] });
  insertCandidate(raw, { id: "cand_discovery", matchRunId: "matchrun_1", productId: "prod_discovery", rank: 2, technicalStatus: "Discovery Only", matchingBasis: ["Semantic Discovery"], mandatoryFailures: [{ type: "Evidence", result: "Evidence Missing" }] });
  insertCandidate(raw, { id: "cand_noncompliant", matchRunId: "matchrun_1", productId: "prod_noncompliant", rank: 3, technicalStatus: "Non-Compliant", mandatoryFailures: [{ type: "Voltage", result: "Voltage mismatch" }] });
  const DB = d1(raw);
  const result = await resolveProductMatchingStatus(DB, { projectId: "p1", itemId: "boqitem_1" });
  assert.equal(result.found, true);
  assert.equal(result.matchRunId, "matchrun_1");
  assert.equal(result.status, "Needs Review");
  assert.equal(result.stale, false);
  assert.equal(result.candidateCount, 3);
  assert.deepEqual(result.counts, { technicallyEligible: 1, discoveryOnly: 1, nonCompliant: 1, needsReview: 3 });
  assert.equal(result.candidates.length, 3);
  assert.deepEqual(result.candidates.map((c) => c.candidateId), ["cand_eligible", "cand_discovery", "cand_noncompliant"], "candidate order must come straight from rank, never re-sorted");

  const eligible = result.candidates.find((c) => c.candidateId === "cand_eligible");
  assert.deepEqual(eligible.matchedCriteria, ["Manufacturer + Product Family"]);
  assert.deepEqual(eligible.failedCriteria, []);
  assert.deepEqual(eligible.missingEvidence, []);

  const discovery = result.candidates.find((c) => c.candidateId === "cand_discovery");
  assert.deepEqual(discovery.failedCriteria, [], "an Evidence Missing failure is missingEvidence, never failedCriteria");
  assert.deepEqual(discovery.missingEvidence, ["Evidence Missing"]);

  const nonCompliant = result.candidates.find((c) => c.candidateId === "cand_noncompliant");
  assert.deepEqual(nonCompliant.failedCriteria, ["Voltage mismatch"]);
  assert.deepEqual(nonCompliant.missingEvidence, []);

  assert.equal(result.selectedCandidate, null, "no candidate has a confirmed review_status -- selection must never be inferred from rank #1");
});

test("resolveProductMatchingStatus uses the CURRENT (non-superseded) match run only, ignoring an older superseded run", async () => {
  const raw = await buildDatabase();
  seedProject(raw);
  insertItem(raw, { id: "boqitem_1", sequence: 1, item_number: "28.19", description: "x", numeric_quantity: 24 });
  seedCurrentProfile(raw, "boqitem_1");
  insertMatchRun(raw, { id: "matchrun_old", boqItemId: "boqitem_1", requirementProfileVersionId: "reqprofile_current", versionNumber: 1, status: "No Match", superseded_at: "2026-01-01T00:00:00.000Z" });
  insertMatchRun(raw, { id: "matchrun_new", boqItemId: "boqitem_1", requirementProfileVersionId: "reqprofile_current", versionNumber: 2, status: "Discovery Only" });
  const DB = d1(raw);
  const result = await resolveProductMatchingStatus(DB, { projectId: "p1", itemId: "boqitem_1" });
  assert.equal(result.matchRunId, "matchrun_new");
  assert.equal(result.status, "Discovery Only");
});

test("resolveProductMatchingStatus honestly detects staleness -- the match run's requirement_profile_version_id no longer matches the item's CURRENT requirement profile", async () => {
  const raw = await buildDatabase();
  seedProject(raw);
  insertItem(raw, { id: "boqitem_1", sequence: 1, item_number: "28.19", description: "x", numeric_quantity: 24 });
  // The match run points to an OLDER profile version...
  insertProfile(raw, { id: "reqprofile_old", boqItemId: "boqitem_1", versionNumber: 1, readinessStatus: "Ready for Matching", profile: { readiness: { status: "Ready for Matching", blockingReasons: [] }, missingInformation: [], conflicts: [], consolidatedRequirements: [] }, superseded_at: "2026-01-01T00:00:00.000Z" });
  // ...but the item's requirement profile has since been edited/re-approved, producing a NEWER current version.
  seedCurrentProfile(raw, "boqitem_1", "reqprofile_new", 2);
  insertMatchRun(raw, { id: "matchrun_1", boqItemId: "boqitem_1", requirementProfileVersionId: "reqprofile_old", status: "Needs Review" });
  const DB = d1(raw);
  const result = await resolveProductMatchingStatus(DB, { projectId: "p1", itemId: "boqitem_1" });
  assert.equal(result.stale, true, "the match run was generated against reqprofile_old, but the item's current profile is now reqprofile_new");
});

test("resolveProductMatchingStatus reports NOT stale when the match run's requirement_profile_version_id still matches the item's current profile", async () => {
  const raw = await buildDatabase();
  seedProject(raw);
  insertItem(raw, { id: "boqitem_1", sequence: 1, item_number: "28.19", description: "x", numeric_quantity: 24 });
  seedCurrentProfile(raw, "boqitem_1", "reqprofile_current");
  insertMatchRun(raw, { id: "matchrun_1", boqItemId: "boqitem_1", requirementProfileVersionId: "reqprofile_current", status: "Needs Review" });
  const DB = d1(raw);
  const result = await resolveProductMatchingStatus(DB, { projectId: "p1", itemId: "boqitem_1" });
  assert.equal(result.stale, false);
});

test("resolveProductMatchingStatus reports the real selectedCandidate ONLY when a candidate's review_status is an actual engineer-confirmed status -- never inferred from rank", async () => {
  const raw = await buildDatabase();
  seedProject(raw);
  insertItem(raw, { id: "boqitem_1", sequence: 1, item_number: "28.19", description: "x", numeric_quantity: 24 });
  seedCurrentProfile(raw, "boqitem_1");
  insertManufacturer(raw, { id: "mfr1", name: "Honeywell" });
  insertCanonicalProduct(raw, { id: "prod_1", partNumber: "IDP-EAGLE", manufacturerId: "mfr1" });
  insertCanonicalProduct(raw, { id: "prod_2", partNumber: "IDP-PHOTO-IV", manufacturerId: "mfr1" });
  insertMatchRun(raw, { id: "matchrun_1", boqItemId: "boqitem_1", requirementProfileVersionId: "reqprofile_current", status: "Needs Review", candidateCount: 2 });
  // rank #1 is NOT the selected one -- rank #2 is, via a real confirmed review_status.
  insertCandidate(raw, { id: "cand_1", matchRunId: "matchrun_1", productId: "prod_1", rank: 1, technicalStatus: "Technically Compliant", reviewStatus: "Needs Review" });
  insertCandidate(raw, { id: "cand_2", matchRunId: "matchrun_1", productId: "prod_2", rank: 2, technicalStatus: "Discovery Only", reviewStatus: "Approved" });
  const DB = d1(raw);
  const result = await resolveProductMatchingStatus(DB, { projectId: "p1", itemId: "boqitem_1" });
  assert.deepEqual(result.selectedCandidate, { candidateId: "cand_2", productId: "prod_2", partNumber: "IDP-PHOTO-IV", reviewStatus: "Approved" }, "the LOWER-ranked candidate is the real selection -- rank #1 must never be assumed selected");
});

test("resolveProductMatchingStatus surfaces the matching engine's own real no_match reason as a blocker when the run genuinely has zero valid candidates", async () => {
  const raw = await buildDatabase();
  seedProject(raw);
  insertItem(raw, { id: "boqitem_1", sequence: 1, item_number: "28.19", description: "x", numeric_quantity: 24 });
  seedCurrentProfile(raw, "boqitem_1");
  insertMatchRun(raw, {
    id: "matchrun_1", boqItemId: "boqitem_1", requirementProfileVersionId: "reqprofile_current", status: "No Match", candidateCount: 0,
    noMatch: { reason: "No product was found within the controlled search scope." },
  });
  const DB = d1(raw);
  const result = await resolveProductMatchingStatus(DB, { projectId: "p1", itemId: "boqitem_1" });
  assert.equal(result.candidateCount, 0);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.blockers, ["No product was found within the controlled search scope."]);
});
