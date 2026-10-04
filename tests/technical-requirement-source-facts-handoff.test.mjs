import test from "node:test";
import assert from "node:assert/strict";
import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import { executeRequirementProfile, loadInputs } from "../worker/technical-requirement-api.mjs";

// Source Fact Authority Slice 3 -- worker-level :memory: proof that Active
// Source Facts flow through the SAME existing loadInputs/executeRequirementProfile
// pipeline (fingerprint, versioning, persistence) every other requirement
// input already uses.
//
// WHY THE CANONICAL FIXTURE INSTEAD OF A HAND-WRITTEN SCHEMA
// ---------------------------------------------------------
// This file used to carry a 37-table `new DatabaseSync(":memory:")`
// approximation plus its own `d1` shim, and it additionally raw-exec'd
// `drizzle/0060_estimator_understanding_review.sql` on top of that
// approximation. Every test here failed with
// `Error: no such table: canonical_library_products`.
//
// `canonical_library_products` is not a table: it is the recursive
// supersession VIEW created by
// `drizzle-active/0000_baseline_schema_0082.sql`, and
// worker/technical-requirement-api.mjs's `loadInputs` engineering-relationships
// query (COMPAT-GOV currency) joins it. The approximation could not express the
// production contract at all, and appending a CREATE VIEW/TABLE to a
// hand-written list is exactly how that drift returns on the next migration.
// So the local schema is NOT patched here: every database below is
// `activeChainDatabase()` -- the ACTUAL ordered drizzle-active chain read from
// the migration journal, which already carries the view, the 0060 review
// tables, and everything else -- wrapped in the shared D1-shaped `d1()` adapter
// from the same fixture module.
//
// No assertion was changed. The one deliberate structural change is that the
// 0060 migration is no longer exec'd by hand, because it is part of the real
// chain now. The row that exec existed for
// (`estimator_understanding_review_versions`) is still never seeded, so AI
// Understanding Review stays un-approved throughout and `boqItem` still falls
// back to the raw BOQ extraction system/category/productFamily, exactly as the
// fixture comment states.
//
// Foreign-key enforcement is ON (the real chain leaves it on --
// drizzle-active/0002_governing_source_fk.sql), so the seed is referentially
// complete: organizations -> projects -> documents -> document_versions ->
// boq_extraction_versions -> boq_items is a real in-force chain, which is
// precisely what `ownedItem`'s current-evidence gate requires in order to
// return the item at all. :memory: only; no live data.
const OWNER = "owner1";

// The fixture is the ACTUAL ordered active migration chain (drizzle-active
// journal) -- see tests/fixtures/active-chain-fixture.mjs -- not a hand-written
// approximation, for the reason stated at the top of this file. Foreign-key
// enforcement is on (the real chain leaves it on), so the seed below is
// referentially complete: `projects.organization_id` is a real FK to
// `organizations`, and the BOQ item is reachable through a real, in-force
// evidence chain documents -> document_versions -> boq_extraction_versions ->
// boq_items, which is exactly what `ownedItem`'s current-evidence gate
// requires before it will return the item at all.
//
// DOC-R3: `document_versions.effective_from`/`effective_to` are left NULL on
// purpose -- open-past/open-future == IN FORCE, so dv1 is the governing version
// of doc1 (app/domain/effective-time-policy.mjs inForceWindowSql).
const buildDatabase = () => {
  const raw = activeChainDatabase();
  raw.exec(`
    INSERT INTO organizations (id, name) VALUES ('org1', 'Org One');
    INSERT INTO projects (id, name, owner_user_id, organization_id) VALUES ('project-golden', 'Golden Target Project', '${OWNER}', 'org1');
    INSERT INTO documents (id, project_id, logical_name, document_type, classification_source, created_by)
      VALUES ('doc1', 'project-golden', 'Spec 28 46 00', 'Technical Specification', 'Manual', '${OWNER}');
    INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by)
      VALUES ('dv1', 'doc1', 1, 'spec.pdf', 'spec.stored', 'pdf', 'application/pdf', 4, 'sha-dv1', 'projects/project-golden/spec.pdf', '${OWNER}');
    UPDATE documents SET current_version_id = 'dv1' WHERE id = 'doc1';
    INSERT INTO boq_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, ocr_version, created_by)
      VALUES ('ext1', 'doc1', 'dv1', 1, 'Completed', 'parser-v1', 'rules-v1', 'ocr-v1', '${OWNER}');
    -- The real boq_items additionally requires section_path (JSON),
    -- original_raw_values and confidence_state, all NOT NULL, and its
    -- numeric_quantity / original_quantity are TEXT -- so the quantities below
    -- are the same "9" the approximation stored, as TEXT.
    INSERT INTO boq_items (id, project_id, row_type, extraction_version_id, source_document_id, sequence, section_path, item_number, description, numeric_quantity, original_quantity, normalized_unit, original_unit, system_value, category, subcategory, current_values, source_location, original_raw_values, review_status, approved_for_downstream, extraction_confidence, confidence_state)
      VALUES ('boq-golden', 'project-golden', 'BOQ Item', 'ext1', 'doc1', 1, '[]', 'C', 'Heat detector', '9', '9', 'Each', 'Each', 'Fire Alarm', 'Detector', 'Heat Detector', '{}', '{"row": 3, "column": "Quantity"}', '{}', 'Approved', 1, 90, 'High Confidence');
  `);
  return raw;
};

// Golden Target Fixture (mission section 18): all six Golden Source Facts,
// Product-Family scoped exactly as Slice 1/2 promotion would produce them,
// with real provenance rows -- no per-location human decision yet.
const GOLDEN_FACTS = [
  { id: "fact-temp", predicate: "fixed_temperature_setpoint", value: { value: "135°F", unit: null } },
  { id: "fact-ror", predicate: "rate_of_rise_sensitivity", value: { value: "15°F/min", unit: null } },
  { id: "fact-standard", predicate: "applicable_standard", value: { value: { body: "UL", number: "521" }, unit: null } },
  { id: "fact-protocol", predicate: "protocol_compatibility", value: { value: "Flash Scan, CLIP", unit: null } },
  { id: "fact-base", predicate: "base_architecture", value: { value: "Modular", unit: null } },
  { id: "fact-hightemp", predicate: "high_temp_alternative_available", value: { value: "190°F", unit: null } },
];

const seedGoldenSourceFacts = (raw, { status = "Active" } = {}) => {
  for (const fact of GOLDEN_FACTS) {
    raw.prepare(`INSERT INTO engineering_facts (id,project_id,entity_type,entity_id,predicate,value,data_type,operator,fact_type,scope_type,scope_id,status,confidence,model_version)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      fact.id, "project-golden", "Product Family", "Heat Detector", fact.predicate, JSON.stringify(fact.value), "text", "Equal", "Source Fact", "Product Family", "Heat Detector", status, 92, "spec-source-fact-promotion-1.0.0",
    );
    raw.prepare(`INSERT INTO engineering_fact_provenance (id,fact_id,source_type,source_id,document_id,document_version_id,page,section,clause,confidence)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      `prov-${fact.id}`, fact.id, "Specification", "doc1", "doc1", "dv1", 11, "28 46 00", "5", 92,
    );
  }
};

test("N. fingerprint changes (a new profile version is produced) when an Active Source Fact's value changes", async () => {
  const raw = buildDatabase();
  const DB = d1(raw);
  raw.prepare(`INSERT INTO engineering_facts (id,project_id,entity_type,entity_id,predicate,value,data_type,operator,fact_type,scope_type,scope_id,status,confidence,model_version)
    VALUES ('fact-temp','project-golden','Product Family','Heat Detector','fixed_temperature_setpoint',?,'text','Equal','Source Fact','Product Family','Heat Detector','Active',92,'spec-source-fact-promotion-1.0.0')`)
    .run(JSON.stringify({ value: "135°F", unit: null }));

  await executeRequirementProfile({ DB }, { itemId: "boq-golden", userId: "owner1", runId: null });
  const v1 = raw.prepare("SELECT * FROM requirement_profile_versions WHERE boq_item_id='boq-golden' AND superseded_at IS NULL").get();
  assert.ok(v1);

  // Idempotent re-run: nothing changed, so no new version.
  await executeRequirementProfile({ DB }, { itemId: "boq-golden", userId: "owner1", runId: null });
  const stillV1 = raw.prepare("SELECT * FROM requirement_profile_versions WHERE boq_item_id='boq-golden' AND superseded_at IS NULL").get();
  assert.equal(stillV1.id, v1.id, "an unchanged Active Source Fact set must not force a new profile version");

  raw.prepare("UPDATE engineering_facts SET value=? WHERE id='fact-temp'").run(JSON.stringify({ value: "140°F", unit: null }));
  await executeRequirementProfile({ DB }, { itemId: "boq-golden", userId: "owner1", runId: null });
  const v2 = raw.prepare("SELECT * FROM requirement_profile_versions WHERE boq_item_id='boq-golden' AND superseded_at IS NULL").get();
  assert.notEqual(v2.id, v1.id, "changing an Active Source Fact's value must change the input fingerprint and force a new profile version");
  assert.notEqual(v2.input_fingerprint, v1.input_fingerprint);
  raw.close();
});

test("N (state transition). activating a previously Pending Review Source Fact also changes the fingerprint", async () => {
  const raw = buildDatabase();
  const DB = d1(raw);
  raw.prepare(`INSERT INTO engineering_facts (id,project_id,entity_type,entity_id,predicate,value,data_type,operator,fact_type,scope_type,scope_id,status,confidence,model_version)
    VALUES ('fact-temp','project-golden','Product Family','Heat Detector','fixed_temperature_setpoint',?,'text','Equal','Source Fact','Product Family','Heat Detector','Pending Review',92,'spec-source-fact-promotion-1.0.0')`)
    .run(JSON.stringify({ value: "135°F", unit: null }));

  await executeRequirementProfile({ DB }, { itemId: "boq-golden", userId: "owner1", runId: null });
  const v1 = raw.prepare("SELECT * FROM requirement_profile_versions WHERE boq_item_id='boq-golden' AND superseded_at IS NULL").get();
  assert.equal(JSON.parse(v1.profile).technicalFacts.length, 0, "a Pending Review fact must not be consumed yet");

  raw.prepare("UPDATE engineering_facts SET status='Active' WHERE id='fact-temp'").run();
  await executeRequirementProfile({ DB }, { itemId: "boq-golden", userId: "owner1", runId: null });
  const v2 = raw.prepare("SELECT * FROM requirement_profile_versions WHERE boq_item_id='boq-golden' AND superseded_at IS NULL").get();
  assert.notEqual(v2.id, v1.id, "Pending Review -> Active must force a new profile version");
  assert.equal(JSON.parse(v2.profile).technicalFacts.length, 1, "the now-Active fact must be consumed");
  raw.close();
});

test("O. profile regeneration creates a genuinely new version and never overwrites historical profile rows", async () => {
  const raw = buildDatabase();
  const DB = d1(raw);
  seedGoldenSourceFacts(raw);

  await executeRequirementProfile({ DB }, { itemId: "boq-golden", userId: "owner1", runId: null });
  const v1 = raw.prepare("SELECT * FROM requirement_profile_versions WHERE boq_item_id='boq-golden' AND superseded_at IS NULL").get();

  raw.prepare("UPDATE engineering_facts SET value=? WHERE id='fact-ror'").run(JSON.stringify({ value: "20°F/min", unit: null }));
  await executeRequirementProfile({ DB }, { itemId: "boq-golden", userId: "owner1", runId: null });
  const v2 = raw.prepare("SELECT * FROM requirement_profile_versions WHERE boq_item_id='boq-golden' AND superseded_at IS NULL").get();

  assert.notEqual(v1.id, v2.id);
  assert.equal(v2.version_number, v1.version_number + 1, "version_number must genuinely increment");

  const historicalV1 = raw.prepare("SELECT * FROM requirement_profile_versions WHERE id=?").get(v1.id);
  assert.ok(historicalV1.superseded_at, "the old row is superseded, never deleted");
  const historicalRorFact = JSON.parse(historicalV1.profile).technicalFacts.find((fact) => fact.predicate === "rate_of_rise_sensitivity");
  assert.equal(historicalRorFact.value, "15°F/min", "historical profile content itself must never be rewritten in place");
  const currentRorFact = JSON.parse(v2.profile).technicalFacts.find((fact) => fact.predicate === "rate_of_rise_sensitivity");
  assert.equal(currentRorFact.value, "20°F/min");
  raw.close();
});

test("P. a technicalFacts entry is traceable back to its originating document/page/section/clause via bounded provenance", async () => {
  const raw = buildDatabase();
  const DB = d1(raw);
  seedGoldenSourceFacts(raw);

  await executeRequirementProfile({ DB }, { itemId: "boq-golden", userId: "owner1", runId: null });
  const v1 = raw.prepare("SELECT * FROM requirement_profile_versions WHERE boq_item_id='boq-golden' AND superseded_at IS NULL").get();
  const profile = JSON.parse(v1.profile);
  const tempFact = profile.technicalFacts.find((fact) => fact.predicate === "fixed_temperature_setpoint");
  assert.ok(Array.isArray(tempFact.provenance) && tempFact.provenance.length >= 1, "each technical fact must carry its own provenance array");
  assert.deepEqual(tempFact.provenance[0], { documentId: "doc1", page: 11, section: "28 46 00", clause: "5" });
  raw.close();
});

test("Q. Active Source Facts alone never trigger or imply any downstream Matching/commercial operation", async () => {
  const raw = buildDatabase();
  const DB = d1(raw);
  seedGoldenSourceFacts(raw);

  await executeRequirementProfile({ DB }, { itemId: "boq-golden", userId: "owner1", runId: null });
  const v1 = raw.prepare("SELECT * FROM requirement_profile_versions WHERE boq_item_id='boq-golden' AND superseded_at IS NULL").get();

  // No product_match_runs row was ever created as a side effect of profile
  // generation -- Matching remains a fully separate, explicitly-triggered
  // process that this slice never touches or calls.
  const matchRuns = raw.prepare("SELECT COUNT(*) AS n FROM product_match_runs").get();
  assert.equal(matchRuns.n, 0);
  // The profile itself is not auto-approved for matching by Source Facts.
  assert.notEqual(v1.approved_for_matching, 1);
  const profile = JSON.parse(v1.profile);
  assert.notEqual(profile.readiness.status, "Ready for Matching", "six evidence facts alone, with zero confirmed normative requirements, must not manufacture matching-readiness");
  raw.close();
});

test("Golden Target Fixture (mission section 18): BOQ Heat Detector Qty 9 + all six Active Source Facts, no per-location human decision yet", async () => {
  const raw = buildDatabase();
  const DB = d1(raw);
  seedGoldenSourceFacts(raw);

  await executeRequirementProfile({ DB }, { itemId: "boq-golden", userId: "owner1", runId: null });
  const row = raw.prepare("SELECT * FROM requirement_profile_versions WHERE boq_item_id='boq-golden' AND superseded_at IS NULL").get();
  const profile = JSON.parse(row.profile);

  assert.equal(profile.technicalFacts.length, 6, "all six Golden Source Facts must appear");
  const byPredicate = Object.fromEntries(profile.technicalFacts.map((fact) => [fact.predicate, fact.value]));
  assert.equal(byPredicate.fixed_temperature_setpoint, "135°F");
  assert.equal(byPredicate.rate_of_rise_sensitivity, "15°F/min");
  assert.deepEqual(byPredicate.applicable_standard, { body: "UL", number: "521" });
  assert.equal(byPredicate.protocol_compatibility, "Flash Scan, CLIP");
  assert.equal(byPredicate.base_architecture, "Modular");
  assert.equal(byPredicate.high_temp_alternative_available, "190°F");

  // The mission requires this fixture to "preserve one unresolved
  // engineering question conceptually" -- whether any of the 9 Qty
  // locations need the 190°F alternative. buildTechnicalRequirementProfile
  // (app/domain/technical-requirement-engine.mjs) currently has NO explicit
  // "pending engineering decision" output field of any kind -- no
  // profile.pendingDecisions, no profile.openQuestions, nothing similar.
  // Per the mission's explicit instruction, this is reported accurately
  // rather than invented: the fixture proves the absence structurally
  // (both values are visible and neither is silently applied per-location),
  // and the report below states this gap honestly as a finding, not a
  // fabricated field.
  assert.equal(profile.pendingDecisions, undefined);
  assert.equal(profile.openQuestions, undefined);
  assert.ok(!("locationDecision" in profile));
  assert.ok(!profile.technicalFacts.some((fact) => fact.scopeType === "BOQ Item"), "no per-location override exists in this fixture -- correctly absent, not invented");
  raw.close();
});

test("loadInputs itself returns the sourceFacts/sourceFactConflicts shape executeRequirementProfile depends on", async () => {
  const raw = buildDatabase();
  const DB = d1(raw);
  seedGoldenSourceFacts(raw);
  const item = raw.prepare("SELECT *, project_id FROM boq_items WHERE id='boq-golden'").get();
  const inputs = await loadInputs(DB, item);
  assert.equal(inputs.sourceFacts.length, 6);
  assert.deepEqual(inputs.sourceFactConflicts, []);
  raw.close();
});
