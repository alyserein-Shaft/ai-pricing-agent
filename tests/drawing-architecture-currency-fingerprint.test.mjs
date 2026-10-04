import test from "node:test";
import assert from "node:assert/strict";

import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import { executeRequirementProfile } from "../worker/technical-requirement-api.mjs";

// The fixture is the ACTUAL ordered active migration chain (drizzle-active
// journal), not a hand-written approximation -- see tests/fixtures/
// active-chain-fixture.mjs. Every seed row below therefore has to satisfy the
// REAL NOT NULL set, and FK enforcement is on because the real chain leaves it
// on (drizzle-active/0002_governing_source_fk.sql) -- so the approved
// architecture rows hang off real review cases and a real drawing intake
// version rather than dangling ids.
const buildDatabase = () => activeChainDatabase();

const seedItem = async () => {
  const raw = buildDatabase();
  raw.exec(`
    INSERT INTO organizations (id, name) VALUES ('org1','Org One');
    INSERT INTO projects (id, name, owner_user_id, organization_id) VALUES ('p1','P','owner1','org1');
    INSERT INTO documents (id, project_id, logical_name, created_by) VALUES ('doc1','p1','BOQ','owner1');
    -- DOC-R3: both effective bounds NULL == open-past/open-future == IN FORCE, so
    -- dv1 is this document's governing version. Stated deliberately: the
    -- canonical currentness predicate reads exactly these two columns.
    INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by)
      VALUES ('dv1','doc1',1,'boq.xlsx','boq.stored','xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',4,'sha-dv1','projects/p1/boq.xlsx','owner1');
    UPDATE documents SET current_version_id='dv1' WHERE id='doc1';
    INSERT INTO boq_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, ocr_version, created_by)
      VALUES ('ext1','doc1','dv1',1,'Completed','parser-v1','rules-v1','ocr-v1','owner1');
    INSERT INTO boq_items (id,project_id,row_type,extraction_version_id,source_document_id,sequence,item_number,description,numeric_quantity,original_quantity,normalized_unit,original_unit,system_value,category,subcategory,section_path,source_location,original_raw_values,current_values,review_status,approved_for_downstream,system_confidence,extraction_confidence,confidence_state)
      VALUES ('boq-1','p1','BOQ Item','ext1','doc1',1,'1','Dome Camera','2','2','Each','Each','CCTV','Cameras','Dome Camera','[]','{}','[]','{}','Auto Verified',1,90,90,'High Confidence');
  `);
  return { raw, DB: d1(raw) };
};

const seedReadyArchitecture = (raw) => {
  // The real approved-architecture chain is
  // drawing_intake_versions -> drawing_architecture_review_cases ->
  // drawing_architecture_approved_versions -> drawing_architecture_approved_rows,
  // and the real approved-row / review-case tables carry a NOT NULL governed
  // evidence identity each. All of it is written explicitly, by name, rather
  // than positionally against an assumed column list.
  raw.prepare("INSERT INTO drawing_intake_versions (id, project_id, document_id, document_version_id, version_number, input_fingerprint, output_fingerprint, parser_version, status, summary, created_by) VALUES ('intake-1','p1','doc1','dv1',1,'intake-in-1','intake-out-1','parser-1','Completed','{}','engineer1')").run();
  raw.prepare("INSERT INTO drawing_architecture_review_cases (id, project_id, document_id, document_version_id, drawing_intake_version_id, fact_key, fact_type, subject, scope, evidence_kind, authority_class, source_drawing_number, source_page, parser_version, evidence_fingerprint, status, original_snapshot, current_snapshot) VALUES ('case-1','p1','doc1','dv1','intake-1','panel_exists','PANEL_EXISTS','FACP','FIRE_ALARM','Explicit Drawing Label','Authoritative Drawing','FA-001',1,'parser-1','evidence-1','Approved','{}','{}')").run();
  raw.prepare("INSERT INTO drawing_architecture_approved_versions (id, project_id, version_number, input_fingerprint, output_fingerprint, status, approved_fact_count, excluded_fact_count, created_by, reason, superseded_at, created_at) VALUES ('arch-v1','p1',1,'input-1','output-1','Approved',1,0,'engineer1','Architecture approved',NULL,'2026-09-25T00:00:00Z')").run();
  raw.prepare("INSERT INTO drawing_architecture_approved_rows (id, approved_version_id, review_case_id, document_id, document_version_id, drawing_intake_version_id, structure_version_id, fact_type, subject, relation, object, scope, evidence_kind, authority_class, source_drawing_number, source_page, source_region, source_fragment_ids, parser_version, evidence_fingerprint, review_actor_id, review_reason, source_snapshot, created_at) VALUES ('arch-row-1','arch-v1','case-1','doc1','dv1','intake-1',NULL,'PANEL_EXISTS','FACP',NULL,NULL,'FIRE_ALARM','Explicit Drawing Label','Authoritative Drawing','FA-001',1,NULL,'[]','parser-1','evidence-1','engineer1','Verified on drawing','{}','2026-09-25T00:00:00Z')").run();
  raw.prepare("INSERT INTO drawing_architecture_stage4_readiness (id, project_id, version_number, architecture_status, stage4_readiness, stage4_blocking_class_summary, unique_exception_count, cross_sheet_reference_count, generic_facp_count, remaining_engineer_review_required, remaining_confirm_project_reference, remaining_confirm_same_panel, resolved_count, mirrored_discrepancy_resolved, stale_count, real_architecture_conflict_remaining, approved_prior_row_count, approved_next_row_count, approved_next_version_number, policy_version, computed_by, evidence_fingerprint, reason, created_at, superseded_at, superseding_readiness_id) VALUES ('ready-1','p1',1,'COMPLETE','READY_FOR_STAGE4_BRIDGE','NONBLOCKING_DRAWING_REVIEW',0,0,0,0,0,0,0,0,0,0,0,1,1,'policy-1','system','ready-evidence-1','Ready','2026-09-25T00:00:00Z',NULL,NULL)").run();
};

const currentProfile = (raw) => {
  const row = raw.prepare("SELECT * FROM requirement_profile_versions WHERE boq_item_id='boq-1' AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1").get();
  return row ? { ...row, profile: JSON.parse(row.profile) } : null;
};

test("drawing-architecture-currency: architecture context is loaded before fingerprinting and a newly ready architecture version creates a new profile", async () => {
  const { raw, DB } = await seedItem();

  await executeRequirementProfile({ DB }, { itemId: "boq-1", userId: "owner1" });
  const before = currentProfile(raw);
  assert.equal(before.profile.drawingArchitectureContext.available, false);

  seedReadyArchitecture(raw);
  const rerun = await executeRequirementProfile({ DB }, { itemId: "boq-1", userId: "owner1" });
  const after = currentProfile(raw);

  assert.equal(rerun.idempotent, false, "a changed current architecture must not be treated as an idempotent profile refresh");
  assert.notEqual(after.id, before.id);
  assert.notEqual(after.input_fingerprint, before.input_fingerprint);
  assert.equal(after.profile.drawingArchitectureContext.available, true);
  assert.equal(after.profile.drawingArchitectureContext.architectureVersion, 1);
  assert.equal(after.profile.drawingArchitectureContext.evidenceCount, 1);
  assert.match(after.profile.drawingArchitectureContext.fingerprint, /^[a-f0-9]{64}$/);
});
