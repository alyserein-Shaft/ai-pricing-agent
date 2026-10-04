import test from "node:test";
import assert from "node:assert/strict";
import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import { currentTechnicalRequirementsFrom } from "../worker/current-evidence-scope.mjs";
import { loadInputs } from "../worker/technical-requirement-api.mjs";
import { publishApprovedEngineeringKnowledge } from "../worker/engineering-knowledge-api.mjs";

// Consolidation Fix Sprint 1, item 1: re-running specification extraction
// must not leave a previously-approved requirement from a superseded
// extraction version readable as authoritative by any current-decision
// consumer, mirroring the pattern already established for BOQ evidence
// (current-evidence-scope.mjs's currentBoqEvidenceFrom/currentBoqItemPredicate).
//
// Scenario shared by every test below: extraction v1 (superseded) approved
// a requirement ("requirement-v1"); extraction v2 (current) approved a
// different requirement ("requirement-v2") for the same document. Both rows
// remain in technical_requirements -- nothing is deleted or mutated.
//
// WHY THE CANONICAL FIXTURE INSTEAD OF A HAND-WRITTEN SCHEMA
// ---------------------------------------------------------
// This file used to hand-write its own six-table approximation plus a local
// `d1` shim whose `batch()` opened a real BEGIN/COMMIT. The
// `loadInputs` scenario died with `Error: no such table:
// canonical_library_products` -- that relation is the recursive
// supersession VIEW created by
// `drizzle-active/0000_baseline_schema_0082.sql`, joined by
// worker/technical-requirement-api.mjs's engineering-relationships query
// (COMPAT-GOV currency), so the approximation could not express the
// production contract. Both other problems were the same drift: the
// approximation's `projects` had no NOT NULL `name` and no real FK to
// `organizations`, and its `boq_requirement_links` had no real FK to
// `boq_items` at all, so the link the scenario depends on was a string the
// old schema would happily accept.
//
// So: the database is now `activeChainDatabase()` -- the ACTUAL ordered
// drizzle-active chain read from the migration journal -- and the adapter is
// the shared `d1()` from the same fixture module. That suite asserts
// NOTHING about batch atomicity, so the shared sequential-autocommit `d1`
// (documented in the fixture's MODELLING NOTE) is the right adapter and no
// local fork of it is kept. Foreign-key enforcement is left ON, because the
// real chain leaves it on, so every seed below is referentially complete.
//
// No assertion was changed, weakened, skipped or made conditional.

const PROJECT_ID = "project-spec-authority";
const DOCUMENT_ID = "doc-spec-1";
const BOQ_ITEM_ID = "boq-item-1";

// DOC-R3: `document_versions.effective_from`/`effective_to` are left NULL on
// purpose -- open-past/open-future == IN FORCE, so dv-1 is the governing
// version of doc-spec-1 (app/domain/effective-time-policy.mjs
// inForceWindowSql). `documents.current_version_id` is set too, but note the
// authority does not read it: the governing version is the unique maximum of
// the in-force, unretired set.
const specFixture = () => {
  const raw = activeChainDatabase();
  raw.exec(`
    INSERT INTO organizations (id, name) VALUES ('org-1', 'Spec Authority Org');
    INSERT INTO projects (id, name, owner_user_id, organization_id) VALUES ('${PROJECT_ID}', 'Spec Authority Project', 'local-development-user', 'org-1');
    INSERT INTO documents (id, project_id, logical_name, document_type, classification_source, created_by)
      VALUES ('${DOCUMENT_ID}', '${PROJECT_ID}', 'Specification 28 46 00', 'Technical Specification', 'Manual', 'local-development-user');
    INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by)
      VALUES ('dv-1', '${DOCUMENT_ID}', 1, 'spec.pdf', 'spec.stored', 'pdf', 'application/pdf', 4, 'sha-dv-1', 'projects/${PROJECT_ID}/spec.pdf', 'local-development-user');
    UPDATE documents SET current_version_id = 'dv-1' WHERE id = '${DOCUMENT_ID}';

    -- extraction v1: superseded
    INSERT INTO specification_extraction_versions (id, document_id, document_version_id, superseded_at, version_number, status, parser_version, ruleset_version, model_version, prompt_version, ocr_version, created_by)
      VALUES ('spec-extraction-v1', '${DOCUMENT_ID}', 'dv-1', '2026-08-10T10:00:00Z', 1, 'Completed', '1.0.0', '1.0.0', '1.0.0', '1.0.0', '1.0.0', 'local-development-user');

    -- extraction v2: current
    INSERT INTO specification_extraction_versions (id, document_id, document_version_id, superseded_at, version_number, status, parser_version, ruleset_version, model_version, prompt_version, ocr_version, created_by)
      VALUES ('spec-extraction-v2', '${DOCUMENT_ID}', 'dv-1', NULL, 2, 'Completed', '1.0.0', '1.0.0', '1.0.0', '1.0.0', '1.0.0', 'local-development-user');
  `);
  raw.prepare(`INSERT INTO technical_requirements (
      id, extraction_version_id, project_id, source_document_id, sequence,
      original_text, normalized_requirement, engineering_domain, domain_source_type,
      requirement_type, requirement_category, system, category, condition, confidence,
      confidence_state, review_status, extraction_method, parser_version, model_version,
      source_location, original_values, current_values, approved_for_downstream)
    VALUES (?, ?, ?, ?, 1, ?, ?, 'Fire Detection', 'Specification', 'Mandatory', 'Fire Detection', 'Fire Alarm', 'Detection', NULL, 90, 'High', 'Approved', 'AI', '1.0.0', '1.0.0', '{}', '{}', '{}', 1)`)
    .run(...["requirement-v1", "spec-extraction-v1", PROJECT_ID, DOCUMENT_ID, "v1 original text", "v1 normalized requirement"]);
  raw.prepare(`INSERT INTO technical_requirements (
      id, extraction_version_id, project_id, source_document_id, sequence,
      original_text, normalized_requirement, engineering_domain, domain_source_type,
      requirement_type, requirement_category, system, category, condition, confidence,
      confidence_state, review_status, extraction_method, parser_version, model_version,
      source_location, original_values, current_values, approved_for_downstream)
    VALUES (?, ?, ?, ?, 1, ?, ?, 'Fire Detection', 'Specification', 'Mandatory', 'Fire Detection', 'Fire Alarm', 'Detection', NULL, 90, 'High', 'Approved', 'AI', '1.0.0', '1.0.0', '{}', '{}', '{}', 1)`)
    .run(...["requirement-v2", "spec-extraction-v2", PROJECT_ID, DOCUMENT_ID, "v2 original text", "v2 normalized requirement"]);
  return raw;
};

// A real, in-force BOQ chain for the single item the `loadInputs` scenario
// links requirements to. On the real chain `boq_requirement_links.boq_item_id`
// is an FK to `boq_items`, so the link rows below cannot exist without this
// parent -- which is exactly the referential integrity the old approximation
// was silently missing. The item is on its OWN source document (a BOQ, not the
// specification), because the current-evidence authority joins
// `boq_extraction_versions` to `documents` and the requirement chain hangs off
// the specification document.
const seedBoqItem = (raw) => {
  raw.exec(`
    INSERT INTO documents (id, project_id, logical_name, document_type, classification_source, created_by)
      VALUES ('doc-spec-boq', '${PROJECT_ID}', 'BOQ', 'BOQ', 'Manual', 'local-development-user');
    INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by)
      VALUES ('boq-dv-1', 'doc-spec-boq', 1, 'boq.xlsx', 'boq.stored', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 4, 'sha-boq-dv-1', 'projects/${PROJECT_ID}/boq.xlsx', 'local-development-user');
    UPDATE documents SET current_version_id = 'boq-dv-1' WHERE id = 'doc-spec-boq';
    INSERT INTO boq_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, ocr_version, created_by)
      VALUES ('boq-extraction-1', 'doc-spec-boq', 'boq-dv-1', 1, 'Completed', '1.0.0', '1.0.0', '1.0.0', 'local-development-user');
    INSERT INTO boq_items (id, project_id, row_type, extraction_version_id, source_document_id, sequence, section_path, item_number, description, numeric_quantity, original_quantity, normalized_unit, original_unit, system_value, category, current_values, source_location, original_raw_values, review_status, approved_for_downstream, extraction_confidence, confidence_state)
      VALUES ('${BOQ_ITEM_ID}', '${PROJECT_ID}', 'BOQ Item', 'boq-extraction-1', 'doc-spec-boq', 1, '[]', '34', 'Addressable heat detector unit', '1', '1', 'No.', 'No.', 'Fire Alarm', 'Detector', '{}', '{"row": 3, "column": "Quantity"}', '{}', 'Approved', 1, 95, 'High Confidence');
  `);
};

// A Confirmed link from the single BOQ item to one requirement. Named columns
// only, and the real `boq_requirement_links` NOT NULL/FK set is satisfied
// (`scope_id` mirrors the item, exactly as the governed writer does).
const linkRequirement = (raw, requirementId, linkId) => {
  raw.prepare(`INSERT INTO boq_requirement_links (id, project_id, boq_item_id, requirement_id, superseded_at, status, link_method, confidence, evidence, scope_id, created_by)
    VALUES (?, ?, ?, ?, NULL, 'Confirmed', 'Manual', 100, '[]', ?, 'local-development-user')`)
    .run(linkId, PROJECT_ID, BOQ_ITEM_ID, requirementId, BOQ_ITEM_ID);
};

// Scenarios 1-5: extraction v1 -> approved; v2 supersedes v1; v1 requirement
// no longer current-authoritative; v2 requirement is; v1 row still present.
test("currentTechnicalRequirementsFrom scopes to the non-superseded extraction version only", async () => {
  const raw = specFixture();
  const db = d1(raw);

  const current = await db
    .prepare(`SELECT id FROM ${currentTechnicalRequirementsFrom("r")} WHERE r.project_id=? ORDER BY r.id`)
    .bind(PROJECT_ID)
    .all();
  assert.deepEqual(current.results.map((row) => row.id), ["requirement-v2"]);

  // v1's row is still present as history/evidence -- never deleted or mutated.
  const historical = await raw.prepare("SELECT id, approved_for_downstream, review_status FROM technical_requirements WHERE id='requirement-v1'").get();
  assert.equal(historical.id, "requirement-v1");
  assert.equal(historical.approved_for_downstream, 1);
  assert.equal(historical.review_status, "Approved");

  raw.close();
});

test("currentTechnicalRequirementsFrom excludes queued, running, failed, and cancelled extractions", async () => {
  const raw = specFixture();
  raw.prepare("UPDATE specification_extraction_versions SET status='Failed' WHERE id='spec-extraction-v2'").run();
  const db = d1(raw);
  const current = await db.prepare(`SELECT id FROM ${currentTechnicalRequirementsFrom("r")} WHERE r.project_id=?`).bind(PROJECT_ID).all();
  assert.deepEqual(current.results, []);
  raw.close();
});

// Scenario 6: current Requirement Profile (loadInputs, the function
// executeRequirementProfile/buildTechnicalRequirementProfile consumes) does
// not consume the v1 requirement even when a Confirmed link points at it.
test("loadInputs excludes a Confirmed link to a requirement from a superseded extraction version", async () => {
  const raw = specFixture();
  seedBoqItem(raw);

  // a Confirmed link to the STALE (v1) requirement
  linkRequirement(raw, "requirement-v1", "link-to-v1");

  // a Confirmed link to the CURRENT (v2) requirement
  linkRequirement(raw, "requirement-v2", "link-to-v2");

  const db = d1(raw);
  const inputs = await loadInputs(db, { id: BOQ_ITEM_ID, project_id: PROJECT_ID });
  assert.deepEqual(inputs.requirements.map((entry) => entry.id), ["requirement-v2"]);
  raw.close();
});

// Scenario 7: engineering knowledge's current publish view does not consume
// the v1 requirement even though it is still Approved/approved_for_downstream.
test("publishApprovedEngineeringKnowledge does not publish a requirement from a superseded extraction version", async () => {
  const raw = specFixture();
  // No BOQ seed here, and none is needed: the pre-migration fixture's
  // `boq-extraction-versions` row ('boq-current-version') had no `boq_items`
  // child, so it contributed nothing to the published facts -- the query joins
  // `boq_items`, and the assertion below filters on
  // entity_type='Technical Requirement' only. Dropping an inert seed row is not
  // an assertion change; every table the publish path writes
  // (engineering_facts / engineering_fact_provenance / document_audit_events) is
  // on the real active chain and present untouched.
  const db = d1(raw);
  await publishApprovedEngineeringKnowledge(db, { projectId: PROJECT_ID, userId: "user-1" });
  const facts = await raw.prepare("SELECT entity_id FROM engineering_facts WHERE entity_type='Technical Requirement'").all();
  assert.deepEqual(facts.map((row) => row.entity_id), ["requirement-v2"]);
  raw.close();
});
