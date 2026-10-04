import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import {
  FIRE_ALARM_PANEL_SIZING_ENGINE_VERSION,
  PANEL_SIZING_SNAPSHOT_STATES,
  createFireAlarmPanelSizingSnapshot,
  panelSizingFailure,
} from "../app/domain/fire-alarm-panel-sizing-snapshot.mjs";
import {
  comparePanelSizingFingerprints,
  handleFireAlarmPanelSizingApi,
} from "../worker/fire-alarm-panel-sizing-api.mjs";

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (values = []) => ({
      first: async () => raw.prepare(sql).get(...values) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...values) }),
      run: async () => raw.prepare(sql).run(...values),
    });
    return { ...operation(), bind: (...values) => operation(values) };
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
CREATE TABLE projects (
  id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, organization_id TEXT NOT NULL,
  archived_at TEXT, system_domain TEXT
);
CREATE TABLE project_members (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, user_id TEXT NOT NULL,
  role TEXT NOT NULL, status TEXT NOT NULL, revoked_at TEXT
);
CREATE TABLE documents (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, current_version_id TEXT,
  deleted_at TEXT, archived_at TEXT, logical_name TEXT
);
CREATE TABLE document_versions (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, effective_from TEXT, effective_to TEXT);
CREATE TABLE document_supersessions(id TEXT PRIMARY KEY NOT NULL,superseding_version_id TEXT NOT NULL,superseded_version_id TEXT NOT NULL,scope_type TEXT NOT NULL CHECK (scope_type IN ('FULL_DOCUMENT','SECTION','CLAUSE','BOQ_ROW','DRAWING_REGION','EVIDENCE_ENTITY')),scope_id TEXT,supersession_type TEXT NOT NULL CHECK (supersession_type IN ('REVISION','ADDENDUM','CLARIFICATION','CORRECTION')),effective_from TEXT,effective_to TEXT,created_by TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,CHECK (superseding_version_id <> superseded_version_id),CHECK ((scope_type = 'FULL_DOCUMENT' AND scope_id IS NULL) OR (scope_type <> 'FULL_DOCUMENT' AND scope_id IS NOT NULL AND length(trim(scope_id)) > 0)),CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from));
CREATE TABLE boq_extraction_versions (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL, document_version_id TEXT NOT NULL,
  version_number INTEGER NOT NULL, status TEXT NOT NULL, superseded_at TEXT
);
CREATE TABLE boq_items (
  id TEXT PRIMARY KEY, extraction_version_id TEXT NOT NULL, project_id TEXT NOT NULL,
  source_document_id TEXT NOT NULL, evidence_document_version_id TEXT,
  duplicate_of_item_id TEXT, row_type TEXT NOT NULL, sequence INTEGER NOT NULL, item_number TEXT,
  description TEXT, numeric_quantity REAL, original_quantity REAL,
  normalized_unit TEXT, original_unit TEXT, system_value TEXT, category TEXT,
  subcategory TEXT, manufacturer TEXT, model TEXT, part_number TEXT,
  current_values TEXT NOT NULL DEFAULT '{}', source_location TEXT NOT NULL DEFAULT '{}',
  review_status TEXT NOT NULL, approved_for_downstream INTEGER NOT NULL,
  specification_reference TEXT, system_confidence INTEGER, extraction_confidence INTEGER
);
CREATE TABLE boq_quantity_source_decisions (
  id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, source TEXT,
  selected_quantity REAL, boq_quantity REAL, drawing_quantity REAL,
  recognition_version_id TEXT, definition_key TEXT, reason TEXT,
  decided_by TEXT, created_at TEXT
);
CREATE TABLE requirement_profile_versions (
  id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, version_number INTEGER,
  status TEXT, input_fingerprint TEXT, profile TEXT, approved_for_matching INTEGER DEFAULT 0,
  superseded_at TEXT, created_at TEXT
);
CREATE TABLE product_match_runs (
  id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT,
  requirement_profile_version_id TEXT, version_number INTEGER,
  superseded_at TEXT
);
CREATE TABLE product_match_candidates (
  id TEXT PRIMARY KEY, match_run_id TEXT, product_id TEXT, rank INTEGER, review_status TEXT DEFAULT 'Needs Review'
);
CREATE TABLE safety_decisions (
  id TEXT PRIMARY KEY, boq_item_id TEXT, candidate_id TEXT,
  version_number INTEGER, superseded_at TEXT
);
CREATE TABLE safety_approval_requests (
  id TEXT PRIMARY KEY, safety_decision_id TEXT, approval_type TEXT,
  entity_version INTEGER, status TEXT, decided_at TEXT, created_at TEXT
);
CREATE TABLE library_products (
  id TEXT PRIMARY KEY, manufacturer_id TEXT, part_number TEXT NOT NULL,
  normalized_part_number TEXT, description TEXT, review_status TEXT,
  approved_for_discovery INTEGER, identity_status TEXT,
  superseded_by_product_id TEXT, identity_version INTEGER, product_role TEXT
);
CREATE VIEW canonical_library_products AS
WITH RECURSIVE product_chain(requested_product_id,current_product_id,depth,path) AS (
  SELECT id,id,0,'|'||id||'|' FROM library_products
  UNION ALL
  SELECT chain.requested_product_id,p.superseded_by_product_id,chain.depth+1,chain.path||p.superseded_by_product_id||'|'
  FROM product_chain chain JOIN library_products p ON p.id=chain.current_product_id
  WHERE p.identity_status='Superseded' AND p.superseded_by_product_id IS NOT NULL
    AND chain.depth<32 AND instr(chain.path,'|'||p.superseded_by_product_id||'|')=0
)
SELECT chain.requested_product_id,p.* FROM product_chain chain
JOIN library_products p ON p.id=chain.current_product_id
WHERE p.identity_status<>'Superseded';
CREATE TABLE product_source_evidence (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL, source_id TEXT,
  evidence_type TEXT, evidence_reference TEXT, confidence INTEGER
);
CREATE TABLE product_attributes (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL, attribute_name TEXT NOT NULL,
  value_json TEXT, original_value TEXT, normalized_value TEXT, unit TEXT,
  source_id TEXT, evidence_json TEXT NOT NULL DEFAULT '{}', confidence INTEGER,
  review_status TEXT NOT NULL, version_number INTEGER NOT NULL,
  created_at TEXT, superseded_at TEXT, deleted_at TEXT
);
CREATE TABLE product_accessories (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL, accessory_product_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL, quantity_rule TEXT NOT NULL,
  quantity_parameter INTEGER, condition_json TEXT NOT NULL DEFAULT '[]',
  included INTEGER, separately_priced INTEGER, source_id TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}', confidence INTEGER,
  review_status TEXT NOT NULL, version_number INTEGER NOT NULL,
  created_by TEXT, created_at TEXT, deleted_at TEXT, superseded_at TEXT
);
CREATE TABLE drawing_architecture_approved_versions (
  id TEXT PRIMARY KEY, project_id TEXT, version_number INTEGER,
  input_fingerprint TEXT, output_fingerprint TEXT, status TEXT,
  approved_fact_count INTEGER, excluded_fact_count INTEGER, created_by TEXT,
  reason TEXT, superseded_at TEXT, created_at TEXT
);
CREATE TABLE drawing_architecture_approved_rows (
  id TEXT PRIMARY KEY, approved_version_id TEXT, review_case_id TEXT,
  document_id TEXT, document_version_id TEXT, drawing_intake_version_id TEXT,
  structure_version_id TEXT, fact_type TEXT, subject TEXT, relation TEXT, object TEXT,
  scope TEXT, evidence_kind TEXT, authority_class TEXT, source_drawing_number TEXT,
  source_page INTEGER, source_region TEXT, source_fragment_ids TEXT,
  parser_version TEXT, evidence_fingerprint TEXT, review_actor_id TEXT,
  review_reason TEXT, source_snapshot TEXT, created_at TEXT
);
CREATE TABLE drawing_architecture_exception_adjudications (
  id TEXT PRIMARY KEY, project_id TEXT, exception_key TEXT, exception_type TEXT,
  raw_subject TEXT, raw_relation TEXT, raw_object TEXT,
  source_drawing_number TEXT, decision_state TEXT, decision_reasons TEXT,
  decision_policy_version TEXT, decision_actor TEXT,
  canonical_target_drawing_number TEXT, canonical_target_drawing_number_raw TEXT,
  canonical_building_asset_code TEXT, canonical_panel_identity TEXT,
  stage4_blocking_class TEXT, review_case_ids TEXT, created_by TEXT,
  created_at TEXT, superseded_at TEXT
);
CREATE TABLE drawing_architecture_stage4_readiness (
  id TEXT PRIMARY KEY, project_id TEXT, version_number INTEGER,
  architecture_status TEXT, stage4_readiness TEXT,
  stage4_blocking_class_summary TEXT, unique_exception_count INTEGER,
  cross_sheet_reference_count INTEGER, generic_facp_count INTEGER,
  remaining_engineer_review_required INTEGER,
  remaining_confirm_project_reference INTEGER, remaining_confirm_same_panel INTEGER,
  resolved_count INTEGER, mirrored_discrepancy_resolved INTEGER, stale_count INTEGER,
  real_architecture_conflict_remaining INTEGER, approved_prior_row_count INTEGER,
  approved_next_row_count INTEGER, approved_next_version_number INTEGER,
  policy_version TEXT, computed_by TEXT, evidence_fingerprint TEXT, reason TEXT,
  created_at TEXT, superseded_at TEXT
);
CREATE TABLE drawing_architecture_review_cases (
  id TEXT PRIMARY KEY, project_id TEXT, status TEXT, superseded_at TEXT,
  fact_type TEXT, subject TEXT, relation TEXT, object TEXT,
  source_drawing_number TEXT, source_page INTEGER
);
CREATE TABLE fire_alarm_panel_sizing_snapshots (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, version_number INTEGER NOT NULL,
  input_fingerprint TEXT NOT NULL, engine_version TEXT NOT NULL, status TEXT NOT NULL,
  input_json TEXT NOT NULL, calculation_json TEXT NOT NULL, dossier_json TEXT NOT NULL,
  reason TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX fire_alarm_panel_sizing_project_version_idx
  ON fire_alarm_panel_sizing_snapshots(project_id, version_number);
CREATE INDEX fire_alarm_panel_sizing_project_current_idx
  ON fire_alarm_panel_sizing_snapshots(project_id, version_number);
`;

// The seeded project approves TWO physical panels in its current architecture
// (FACP-1 and FACP-2) but carries a single control-panel BOQ line whose current
// selected quantity is 1, and `assertPanelCountMatchesSelectedQuantity` is right
// that the physical panel count is the selected quantity, not an engineer input.
// So a one-panel command is only honest about that second approved panel by
// declaring it out of scope with a governed reason. That is option (b) of the
// fixture conflict, and it is the correct one for every test in this file whose
// subject is the sizing/persistence mechanics of ONE panel. The multi-panel
// case (an SLC quantity split across two physical panels) is expressed with
// option (a) instead: both panels declared, no exclusion -- that test builds
// its own architecture literal and is not this seed's business.
const FACP2_EXCLUSION = {
  architectureIdentity: "FACP-2",
  reason: "FACP-2 is a riser-repeater panel with no locally served SLC device demand; it is deliberately not sized in this pass.",
};

const command = (overrides = {}) => ({
  allocations: [{
    boqItemId: "boq-detector",
    panelId: "FACP-1",
    quantity: 200,
    provenance: { sourceType: "Riser Diagram", reference: "FA-101 panel FA-1" },
  }],
  panels: [{
    panelId: "FACP-1",
    boqItemId: "boq-panel",
    productId: "product-panel",
    architectureIdentity: "FACP-1",
  }],
  exclusions: [FACP2_EXCLUSION],
  provenance: { sourceType: "Approved Engineering Allocation", reference: "FA-101 allocation register" },
  reason: "Allocate detector demand to the approved physical panel topology.",
  ...overrides,
});

const seed = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  const detectorProfile = {
    boqItem: {
      id: "boq-detector",
      system: "Fire Alarm",
      productFamily: "Addressable Smoke Detector",
      attributes: { addressing: { value: "Addressable" } },
    },
  };
  raw.exec(`
    INSERT INTO projects VALUES ('p1','owner1','org1',NULL,'Fire Alarm');
    INSERT INTO project_members VALUES ('member-owner','p1','owner1','Project Manager','Active',NULL);
    INSERT INTO documents VALUES ('doc1','p1','dv1',NULL,NULL,'BOQ and riser');
    INSERT INTO document_versions (id, document_id) VALUES ('dv1','doc1');
    INSERT INTO boq_extraction_versions VALUES ('ext1','doc1','dv1',1,'Completed',NULL);
    INSERT INTO boq_items VALUES
      ('boq-detector','ext1','p1','doc1','dv1',NULL,'BOQ Item',1,'1','Addressable smoke detectors',200,200,'EA','EA','Fire Alarm','Detectors','Addressable Smoke Detector',NULL,NULL,NULL,'{}','{}','Approved',1,NULL,95,95),
      ('boq-panel','ext1','p1','doc1','dv1',NULL,'BOQ Item',2,'2','Fire alarm control panel',1,1,'EA','EA','Fire Alarm','Control Equipment','Fire Alarm Control Panel','Honeywell',NULL,'IFP-2100','{}','{}','Approved',1,NULL,95,95);
    INSERT INTO requirement_profile_versions VALUES
      ('profile-detector','p1','boq-detector',1,'Ready for Matching','item-fp','${JSON.stringify(detectorProfile)}',1,NULL,'now'),
      ('profile-panel','p1','boq-panel',1,'Ready for Matching','panel-fp','{"boqItem":{"id":"boq-panel","system":"Fire Alarm","productFamily":"Fire Alarm Control Panel","attributes":{}}}',1,NULL,'now');
    INSERT INTO product_match_runs VALUES ('run-panel','p1','boq-panel','profile-panel',1,NULL);
    INSERT INTO product_match_candidates VALUES
      ('candidate-panel','run-panel','product-panel',1,'Needs Review'),
      ('candidate-alternative','run-panel','product-alternative',2,'Needs Review');
    INSERT INTO safety_decisions VALUES ('safety-panel','boq-panel','candidate-panel',1,NULL);
    INSERT INTO safety_approval_requests VALUES ('approval-panel','safety-panel','Technical',1,'Approved','now','now');
    INSERT INTO library_products VALUES
      ('product-panel','mfr1','IFP-2100','ifp-2100','Fire alarm control panel','Reviewed',0,'Active',NULL,1,'Control Panel'),
      ('product-alternative','mfr1','OTHER-PANEL','other-panel','Alternative control panel','Reviewed',0,'Active',NULL,1,'Control Panel'),
      ('product-rmk','mfr1','5815RMK','5815rmk','Remote mounting kit','Reviewed',0,'Active',NULL,1,'Enclosure'),
      ('product-expander','mfr1','6815','6815','SLC loop expander','Reviewed',0,'Active',NULL,1,'Loop Card');
    -- Every canonical product identity carries real ingestion provenance. This is
    -- the technical-identity authority the worker reads; it is independent of the
    -- business approved_for_discovery listing flag, which is deliberately 0 here
    -- to prove business review never gates engineering sizing.
    INSERT INTO product_source_evidence VALUES
      ('pse-panel','product-panel','source-1','Manufacturer Datasheet','IFP-2100 datasheet',95),
      ('pse-alternative','product-alternative','source-3','Manufacturer Datasheet','OTHER-PANEL datasheet',90),
      ('pse-rmk','product-rmk','source-1','Manufacturer Datasheet','5815RMK datasheet',90),
      ('pse-expander','product-expander','source-2','Manufacturer Datasheet','6815 datasheet',90),
      ('pse-expander-2','product-expander-2','source-2','Manufacturer Datasheet','6815-ALT datasheet',90);
    INSERT INTO product_attributes VALUES
      ('cap-panel-1','product-panel','native_slc_loops','1',NULL,NULL,'count','source-1','{"citation":"panel manual"}',95,'Approved',1,'now',NULL,NULL),
      ('cap-panel-2','product-panel','max_detectors_per_loop','100',NULL,NULL,'count','source-1','{"citation":"panel manual"}',95,'Approved',1,'now',NULL,NULL),
      ('cap-panel-3','product-panel','max_modules_per_loop','100',NULL,NULL,'count','source-1','{"citation":"panel manual"}',95,'Approved',1,'now',NULL,NULL),
      ('cap-panel-4','product-panel','max_system_points','500',NULL,NULL,'count','source-1','{"citation":"panel manual"}',95,'Approved',1,'now',NULL,NULL),
      ('cap-expander-1','product-expander','added_slc_loops','1',NULL,NULL,'count','source-2','{"citation":"expander manual"}',90,'Approved',1,'now',NULL,NULL),
      ('cap-alternative','product-alternative','max_system_points','9999',NULL,NULL,'count','source-3','{"citation":"alternative manual"}',90,'Approved',1,'now',NULL,NULL);
    INSERT INTO product_accessories VALUES
      ('rel-panel-rmk','product-panel','product-rmk','Expansion Module','CAPACITY_DEPENDENT -- governed project sizing',NULL,'[]',0,1,'source-1','{"citation":"panel expansion table"}',90,'Approved',1,'seed','now',NULL,NULL),
      ('rel-rmk-expander','product-rmk','product-expander','Expansion Module','Up to 2 per mounting unit',2,'[]',0,1,'source-2','{"citation":"mounting capacity table"}',90,'Approved',1,'seed','now',NULL,NULL);
    INSERT INTO drawing_architecture_approved_versions VALUES
      ('arch-v1','p1',1,'arch-in','arch-out','Active',1,0,'engineer1','Approved architecture',NULL,'now');
    INSERT INTO drawing_architecture_approved_rows VALUES
      ('arch-row-1','arch-v1','case-1','doc1','dv1','intake-1',NULL,'PANEL_EXISTS','FACP-1',NULL,NULL,'FIRE_ALARM','EXPLICIT','Authoritative Drawing','FA-101',1,NULL,'[]','parser-1','evidence-arch-1','engineer1','Verified panel schedule','{}','now'),
      ('arch-row-2','arch-v1','case-1','doc1','dv1','intake-1',NULL,'PANEL_EXISTS','FACP-2',NULL,NULL,'FIRE_ALARM','EXPLICIT','Authoritative Drawing','FA-101',1,NULL,'[]','parser-1','evidence-arch-1','engineer1','Verified panel schedule','{}','now');
    INSERT INTO drawing_architecture_stage4_readiness VALUES
      ('ready-1','p1',1,'COMPLETE','READY_FOR_STAGE4_BRIDGE','NONBLOCKING_DRAWING_REVIEW',0,0,0,0,0,0,0,0,0,0,0,1,1,'policy-1','system','readiness-fp','Ready','now',NULL);
  `);
  assert.equal(JSON.parse(raw.prepare("SELECT profile FROM requirement_profile_versions WHERE id='profile-detector'").get().profile).boqItem.id, "boq-detector");
  return {
    raw,
    env: {
      DB: d1(raw),
      APP_ACCESS_MODE: "single-user",
      APP_USER_ID: "owner1",
      APP_USER_ORGANIZATION_ID: "org1",
      APP_ORGANIZATION_ID: "org1",
      APP_USER_EMAIL: "owner@test.invalid",
      APP_USER_NAME: "Fixture Owner",
    },
  };
};

const post = (env, body = command(), projectId = "p1") =>
  handleFireAlarmPanelSizingApi(new Request(`http://localhost/api/projects/${projectId}/fire-alarm/panel-sizing`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), env).then(async (response) => ({ status: response.status, body: await response.json() }));

const get = (env, projectId = "p1") =>
  handleFireAlarmPanelSizingApi(new Request(`http://localhost/api/projects/${projectId}/fire-alarm/panel-sizing`), env)
    .then(async (response) => ({ status: response.status, body: await response.json() }));

const snapshotCount = (raw) => raw.prepare("SELECT COUNT(*) count FROM fire_alarm_panel_sizing_snapshots").get().count;

test("R7 production domain contract is closed, deterministic, and fail-closed", async () => {
  // 1.1.0: the governed input gained the approved required-panel enumeration
  // and the governed topology exclusions, so an old-version fingerprint is not
  // reproducible by this engine and must not be compared with a new one.
  assert.equal(FIRE_ALARM_PANEL_SIZING_ENGINE_VERSION, "fire-alarm-panel-sizing-snapshot-1.1.0");
  assert.deepEqual(PANEL_SIZING_SNAPSHOT_STATES, ["COMPLETED", "STALE"]);
  const failure = panelSizingFailure("x", "y");
  assert.equal(failure.code, "x");
  assert.match(failure.message, /x: y/);

  const dependencies = {
    architecture: { status: "CURRENT_APPROVED", versionId: "arch-v1", version: 1, fingerprint: "arch-fp", identities: { "FACP-1": [{ id: "arch-row-1", evidenceFingerprint: "evidence-arch-1" }] }, requiredPanelIdentities: ["FACP-1"] },
    items: {
      "boq-detector": {
        quantity: { value: 200, source: "BOQ", status: "VALID", decisionId: null },
        classification: { state: "SLC_DETECTOR_POOL", classifierVersion: "fire-alarm-slc-resource-classifier-1.0.0", demandUnits: 200 },
      },
    },
    panels: {
      "FACP-1": {
        selection: { status: "APPROVED", productId: "product-panel", candidateId: "candidate-panel", matchRunId: "run-panel", safetyDecisionId: "safety-panel", technicalApprovalRequestId: "approval-panel" },
        product: { id: "product-panel", identityVersion: 1, partNumber: "IFP-2100" },
        panelCapacity: { nativeLoops: 1, detectorsPerLoop: 100, modulesPerLoop: 100, systemPointCeiling: 500 },
        expansionOptions: { loopExpansionUnit: { productId: "product-expander", partNumber: "6815", loopsAddedPerUnit: 1 }, mountingUnit: { productId: "product-rmk", partNumber: "5815RMK", capacityPerMountingUnit: 2 } },
        evidence: { capacity: [], expansion: [] },
      },
    },
  };
  // This architecture approves exactly one panel, so the seed's FACP-2 exclusion
  // does not apply here: an exclusion over a panel the architecture does not
  // approve is itself rejected, which is asserted separately below.
  const singlePanelCommand = command({ exclusions: [] });
  const first = await createFireAlarmPanelSizingSnapshot({ command: singlePanelCommand, dependencies });
  const second = await createFireAlarmPanelSizingSnapshot({ command: singlePanelCommand, dependencies });
  assert.equal(first.inputFingerprint, second.inputFingerprint);
  assert.equal(first.calculation.sizing.projectTotal.requiredExpansionQuantity, 1);
  assert.equal(first.calculation.sizing.projectTotal.mountingUnitQuantity, 1);
  assert.ok(first.dossier.items.find((item) => item.type === "SYSTEM_ARCHITECTURE"));
  assert.ok(first.dossier.items.find((item) => item.type === "CAPACITY_CALCULATION"));
});

test("R7 allows an SLC quantity to be split across physical panels when the total is exact", async () => {
  // This test's subject IS a two-panel topology, so it expresses the truth the
  // other way (option (a)): both approved panels are declared and sized, and
  // there is no exclusion to declare.
  const splitCommand = {
    ...command(),
    exclusions: [],
    panels: [command().panels[0], { ...command().panels[0], panelId: "FACP-2", architectureIdentity: "FACP-2" }],
    allocations: [
      { ...command().allocations[0], panelId: "FACP-1", quantity: 100 },
      { ...command().allocations[0], panelId: "FACP-2", quantity: 100 },
    ],
  };
  const panelDependency = {
    selection: { status: "APPROVED", productId: "product-panel", candidateId: "candidate-panel", matchRunId: "run-panel", safetyDecisionId: "safety-panel", technicalApprovalRequestId: "approval-panel" },
    product: { id: "product-panel", identityVersion: 1, partNumber: "IFP-2100" },
    panelCapacity: { nativeLoops: 1, detectorsPerLoop: 100, modulesPerLoop: 100, systemPointCeiling: 500 },
    expansionOptions: { loopExpansionUnit: { productId: "product-expander", partNumber: "6815", loopsAddedPerUnit: 1 }, mountingUnit: { productId: "product-rmk", partNumber: "5815RMK", capacityPerMountingUnit: 2 } },
    evidence: { capacity: [], expansion: [] },
  };
  const result = await createFireAlarmPanelSizingSnapshot({
    command: splitCommand,
    dependencies: {
      architecture: { status: "CURRENT_APPROVED", versionId: "arch-v1", version: 1, fingerprint: "arch-fp", identities: { "FACP-1": [{ id: "arch-row-1" }], "FACP-2": [{ id: "arch-row-2" }] }, requiredPanelIdentities: ["FACP-1", "FACP-2"] },
      items: { "boq-detector": { quantity: { value: 200, source: "BOQ", status: "VALID" }, classification: { state: "SLC_DETECTOR_POOL", classifierVersion: "fire-alarm-slc-resource-classifier-1.0.0", demandUnits: 200 } } },
      panels: { "FACP-1": panelDependency, "FACP-2": panelDependency },
    },
  });
  assert.equal(result.status, "COMPLETED");
  // 200 detectors over two 100-per-loop panels is 1 loop each, which each panel
  // already has natively: the split is precisely what removes the expansion.
  assert.equal(result.calculation.sizing.projectTotal.requiredExpansionQuantity, 0);
  assert.deepEqual(result.calculation.sizing.panels.map((entry, index) => [entry.panelId, result.calculation.panels[index].demand.detectors, entry.status]), [
    ["FACP-1", 100, "NO_EXPANSION_REQUIRED"],
    ["FACP-2", 100, "NO_EXPANSION_REQUIRED"],
  ]);
  await assert.rejects(
    () => createFireAlarmPanelSizingSnapshot({
      command: command({ panels: [{ ...command().panels[0], architectureIdentity: "ALIAS-FACP-1" }], exclusions: [] }),
      dependencies: {
        architecture: { status: "CURRENT_APPROVED", versionId: "arch-v1", version: 1, fingerprint: "arch-fp", identities: { "ALIAS-FACP-1": [{ id: "arch-row-1" }] }, requiredPanelIdentities: ["ALIAS-FACP-1"] },
        items: { "boq-detector": { quantity: { value: 200, source: "BOQ", status: "VALID" }, classification: { state: "SLC_DETECTOR_POOL", demandUnits: 200 } } },
        panels: { "FACP-1": panelDependency },
      },
    }),
    (error) => error.code === "PANEL_ARCHITECTURE_IDENTITY_NOT_APPROVED",
  );
});

test("POST persists one governed version from explicit allocations, exact selected products, Approved capacity, and exact expansion path", async () => {
  const { raw, env } = seed();
  const first = await post(env);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.status, "COMPLETED");
  assert.equal(first.body.snapshot.version, 1);
  assert.equal(first.body.snapshot.current, true);
  assert.equal(first.body.snapshot.calculation.panels[0].demand.detectors, 200);
  assert.equal(first.body.snapshot.calculation.sizing.panels[0].requiredExpansionQuantity, 1);
  assert.equal(first.body.snapshot.calculation.sizing.panels[0].selectedExpansionType, "6815");
  assert.equal(first.body.snapshot.input.dependencies.panels["FACP-1"].product.id, "product-panel");
  assert.equal(JSON.stringify(first.body).includes("product-alternative"), false, "alternative candidates never enter the sizing input");
  assert.equal(snapshotCount(raw), 1);

  const repeat = await post(env);
  assert.equal(repeat.status, 200);
  assert.equal(repeat.body.snapshot.id, first.body.snapshot.id);
  assert.equal(repeat.body.idempotent, true);
  assert.equal(snapshotCount(raw), 1);

  const next = await post(env, command({ reason: "Reissue the allocation after engineering review of the same exact inputs." }));
  assert.equal(next.status, 201);
  assert.equal(next.body.snapshot.version, 2);
  assert.equal(snapshotCount(raw), 2);

  // The 201 body describes the row THIS request persisted. version_number is
  // allocated inline by the INSERT (no separate MAX read), and the read-back is
  // by the inserted id, so a concurrent writer can never make the response
  // describe somebody else's snapshot.
  const persisted = raw.prepare("SELECT id,version_number,input_fingerprint FROM fire_alarm_panel_sizing_snapshots ORDER BY version_number").all();
  assert.deepEqual(persisted.map((row) => row.version_number), [1, 2]);
  assert.equal(next.body.snapshot.id, persisted[1].id);
  assert.notEqual(next.body.snapshot.id, persisted[0].id);
  assert.equal(first.body.snapshot.id, persisted[0].id);
  assert.equal(next.body.snapshot.inputFingerprint, persisted[1].input_fingerprint);

  const current = await get(env);
  assert.equal(current.status, 200);
  assert.equal(current.body.status, "CURRENT");
  assert.equal(current.body.snapshot.status, "COMPLETED");
  assert.equal(current.body.snapshot.version, 2, "current means highest version; no mutable current flag is trusted");
});

test("a SLC-classified current BOQ item the command omits is rejected fail-closed, and the same command with the allocation succeeds", async () => {
  const { raw, env } = seed();
  raw.prepare(`INSERT INTO boq_items VALUES
    ('boq-module','ext1','p1','doc1','dv1',NULL,'BOQ Item',3,'3','Addressable monitor modules',40,40,'EA','EA','Fire Alarm','Modules','Monitor Module',NULL,NULL,NULL,'{}','{}','Approved',1,NULL,95,95)`).run();
  raw.prepare("INSERT INTO requirement_profile_versions VALUES ('profile-module','p1','boq-module',1,'Ready for Matching','module-fp','{\"boqItem\":{\"id\":\"boq-module\",\"system\":\"Fire Alarm\",\"productFamily\":\"Monitor Module\",\"attributes\":{\"addressing\":{\"value\":\"Addressable\"}}}}',1,NULL,'now')").run();

  const underAllocated = await post(env);
  assert.equal(underAllocated.status, 409, JSON.stringify(underAllocated.body));
  assert.equal(underAllocated.body.error.code, "SLC_POOL_ITEM_UNALLOCATED");
  assert.deepEqual(underAllocated.body.error.details.unallocatedBoqItemIds, ["boq-module"]);
  assert.deepEqual(underAllocated.body.error.details.currentSlcPoolBoqItemIds, ["boq-detector", "boq-module"]);
  assert.deepEqual(underAllocated.body.error.details.allocatedOutsideCurrentSlcPool, []);
  assert.equal(snapshotCount(raw), 0, "an under-allocating command never reaches a snapshot");

  const complete = await post(env, command({
    allocations: [
      command().allocations[0],
      { boqItemId: "boq-module", panelId: "FACP-1", quantity: 40, provenance: { sourceType: "Riser Diagram", reference: "FA-101 module schedule" } },
    ],
  }));
  assert.equal(complete.status, 201, JSON.stringify(complete.body));
  assert.equal(complete.body.snapshot.calculation.panels[0].demand.detectors, 200);
  assert.equal(complete.body.snapshot.calculation.panels[0].demand.modules, 40, "the omitted item now contributes its own pool demand");
  assert.equal(snapshotCount(raw), 1);
});

test("the post-insert revalidation fingerprint comparison is a pure, fail-closed rule", () => {
  assert.deepEqual(comparePanelSizingFingerprints("a".repeat(64), "a".repeat(64)), { matches: true, persistedInputFingerprint: "a".repeat(64), recomputedInputFingerprint: "a".repeat(64) });
  assert.equal(comparePanelSizingFingerprints("a".repeat(64), "b".repeat(64)).matches, false);
  assert.equal(comparePanelSizingFingerprints("a".repeat(64), null).matches, false, "an unresolvable recompute is a mismatch, never a pass");
  assert.equal(comparePanelSizingFingerprints(null, "a".repeat(64)).matches, false);
  assert.equal(panelSizingFailure("x", "y", 409, { unallocatedBoqItemIds: ["b1"] }).details.unallocatedBoqItemIds[0], "b1");
  assert.equal(panelSizingFailure("x", "y").details, undefined, "details stays optional");
});

test("allocation quantity must exactly equal current selected quantity and no snapshot is written on conflict", async () => {
  const { raw, env } = seed();
  const result = await post(env, command({
    allocations: [{ ...command().allocations[0], quantity: 201 }],
  }));
  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, "ALLOCATION_QUANTITY_CONFLICT");
  assert.equal(snapshotCount(raw), 0);
});

test("physical panel count must equal the current selected panel quantity", async () => {
  const { raw, env } = seed();
  // Two declared physical panels against a selected panel quantity of 1. The
  // exclusion is cleared because this command sizes FACP-2, and a command may
  // not both size and exclude the same approved panel.
  const result = await post(env, command({
    panels: [command().panels[0], { ...command().panels[0], panelId: "FACP-2", architectureIdentity: "FACP-2" }],
    exclusions: [],
  }));
  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, "PANEL_PANEL_QUANTITY_CONFLICT");
  assert.equal(snapshotCount(raw), 0);
});

test("unapproved exact capacity, noncurrent architecture, and ambiguous exact expansion evidence fail closed", async (t) => {
  await t.test("unapproved exact capacity", async () => {
    const { raw, env } = seed();
    raw.prepare("UPDATE product_attributes SET review_status='Needs Review' WHERE id='cap-panel-2'").run();
    const result = await post(env);
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, "APPROVED_CAPACITY_EVIDENCE_REQUIRED");
    assert.equal(snapshotCount(raw), 0);
  });

  await t.test("stale BOQ extraction is rejected before panel snapshot persistence", async () => {
    const { raw, env } = seed();
    raw.prepare("INSERT INTO boq_extraction_versions VALUES ('ext2','doc1','dv1',2,'Completed',NULL)").run();
    const result = await post(env);
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, "CURRENT_APPROVED_BOQ_ITEM_REQUIRED");
    assert.equal(snapshotCount(raw), 0);
  });

  await t.test("non-panel BOQ item is rejected as physical panel evidence", async () => {
    const { raw, env } = seed();
    raw.prepare("UPDATE requirement_profile_versions SET profile='{\"boqItem\":{\"id\":\"boq-panel\",\"system\":\"Fire Alarm\",\"productFamily\":\"Addressable Smoke Detector\",\"attributes\":{}}}' WHERE id='profile-panel'").run();
    const result = await post(env);
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, "CURRENT_PANEL_BOQ_CLASSIFICATION_REQUIRED");
    assert.equal(snapshotCount(raw), 0);
  });

  await t.test("noncurrent architecture", async () => {
    const { raw, env } = seed();
    raw.prepare("UPDATE drawing_architecture_approved_versions SET superseded_at='now' WHERE id='arch-v1'").run();
    const result = await post(env);
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, "CURRENT_APPROVED_ARCHITECTURE_REQUIRED");
    assert.equal(snapshotCount(raw), 0);
  });

  await t.test("superseded expansion relationship is not current", async () => {
    const { raw, env } = seed();
    raw.prepare("UPDATE product_accessories SET superseded_at='now' WHERE id='rel-panel-rmk'").run();
    const result = await post(env);
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, "AMBIGUOUS_EXPANSION_RELATIONSHIP");
    assert.equal(snapshotCount(raw), 0);
  });

  await t.test("two current Approved exact expansion paths", async () => {
    const { raw, env } = seed();
    raw.exec(`
      INSERT INTO library_products VALUES ('product-expander-2','mfr1','6815-ALT','6815-alt','Alternative expander','Reviewed',0,'Active',NULL,1,'Loop Card');
      INSERT INTO product_attributes VALUES ('cap-expander-2','product-expander-2','added_slc_loops','1',NULL,NULL,'count','source-x','{}',90,'Approved',1,'now',NULL,NULL);
      INSERT INTO product_accessories VALUES ('rel-rmk-expander-2','product-rmk','product-expander-2','Expansion Module','Up to 2 per mounting unit',2,'[]',0,1,'source-x','{}',90,'Approved',1,'seed','now',NULL,NULL);
    `);
    const result = await post(env);
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, "AMBIGUOUS_EXPANSION_RELATIONSHIP");
    assert.equal(snapshotCount(raw), 0);
  });
});

test("current selection and match run must be approved, exact, and nonstale", async (t) => {
  await t.test("unapproved alternative remains unavailable", async () => {
    const { env } = seed();
    const result = await post(env, command({
      panels: [{ ...command().panels[0], productId: "product-alternative" }],
    }));
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, "CURRENT_APPROVED_PANEL_SELECTION_REQUIRED");
  });

  await t.test("stale requirement profile invalidates selected match run", async () => {
    const { raw, env } = seed();
    raw.prepare("UPDATE product_match_runs SET requirement_profile_version_id='older-profile' WHERE id='run-panel'").run();
    const result = await post(env);
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, "STALE_PANEL_PRODUCT_SELECTION");
  });
});

// KN-MASTER-1 -- the governed Product Attribute loop closes through the
// canonical taxonomy. The datasheet ingestion writer stores governed names
// (slc_loop_count, detector_capacity, module_capacity) and the governed value
// shape {original, normalized, unit}. Before KN-MASTER-1 the consumer matched
// raw attribute_name only and unwrapped only a `value` key, so every row the
// production writer emits was invisible here.
test("KN-MASTER-1 governed alias-named capacity evidence resolves through the canonical taxonomy", async () => {
  const { raw, env } = seed();
  raw.exec(`
    UPDATE product_attributes SET attribute_name='slc_loop_count',
      value_json='{"original":"one SLC (signaling line circuit) loop","normalized":"1","unit":"loop"}',
      normalized_value='1', original_value='one SLC (signaling line circuit) loop', unit='loop'
      WHERE id='cap-panel-1';
    UPDATE product_attributes SET attribute_name='detector_capacity',
      value_json='{"original":"75 sensors per loop","normalized":"75","unit":"detectors per loop"}',
      normalized_value='75', original_value='75 sensors per loop', unit='detectors per loop'
      WHERE id='cap-panel-2';
    UPDATE product_attributes SET attribute_name='module_capacity',
      value_json='{"original":"75 modules per loop","normalized":"75","unit":"modules per loop"}',
      normalized_value='75', original_value='75 modules per loop', unit='modules per loop'
      WHERE id='cap-panel-3';
  `);
  const result = await post(env);
  // A 201 proves all four capacity facts resolved: a single missing or
  // conflicting fact fails closed with 409 APPROVED_CAPACITY_EVIDENCE_*.
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.ok(result.body.snapshot?.id);
  assert.equal(snapshotCount(raw), 1);
});

// The genuine dual-valued datasheet fact ("150 IDP/SK points; 75 SD points")
// is protocol-dependent and must NEVER be silently collapsed to one number:
// the alias resolves, the value does not coerce, and sizing fails closed.
test("KN-MASTER-1 dual-valued governed capacity stays fail-closed (no silent coercion)", async () => {
  const { raw, env } = seed();
  raw.exec(`
    UPDATE product_attributes SET attribute_name='panel_capacity',
      value_json='{"original":"150 points (IDP/SK) or 75 points (SD)","normalized":"150 IDP/SK points; 75 SD points","unit":"points"}',
      normalized_value='150 IDP/SK points; 75 SD points',
      original_value='150 points (IDP/SK) or 75 points (SD)', unit='points'
      WHERE id='cap-panel-4';
  `);
  const result = await post(env);
  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, "APPROVED_CAPACITY_EVIDENCE_CONFLICT");
  assert.equal(snapshotCount(raw), 0);
});

test("GET recomputes dependency fingerprint and reports STALE without mutating the current snapshot", async () => {
  const { raw, env } = seed();
  const created = await post(env);
  raw.prepare("UPDATE product_attributes SET value_json='120' WHERE id='cap-panel-2'").run();

  const result = await get(env);
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "STALE");
  assert.equal(result.body.snapshot.id, created.body.snapshot.id);
  assert.equal(result.body.snapshot.version, 1);
  assert.equal(result.body.snapshot.current, false);
  assert.equal(result.body.storedInputFingerprint, created.body.snapshot.inputFingerprint);
  assert.match(result.body.currentInputFingerprint, /^[a-f0-9]{64}$/);
  assert.notEqual(result.body.currentInputFingerprint, result.body.storedInputFingerprint);
  assert.equal(snapshotCount(raw), 1, "GET is read-only");
});

test("short reason, foreign project, and unavailable snapshot fail without mutation", async () => {
  const { raw, env } = seed();
  const short = await post(env, command({ reason: "ok" }));
  assert.equal(short.status, 422);
  assert.equal(short.body.error.code, "PANEL_SIZING_REASON_REQUIRED");

  const foreign = await post(env, command(), "p2");
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.error.code, "PROJECT_NOT_FOUND");

  const current = await get(env, "p2");
  assert.equal(current.status, 404);
  assert.equal(snapshotCount(raw), 0);
});

test("schema, worker routing, active migration, and append-only contract are wired", async () => {
  const [schemaSource, workerSource, migration, journal, snapshot] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle-active/0004_fire_alarm_panel_sizing_snapshots.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle-active/meta/_journal.json", import.meta.url), "utf8"),
    readFile(new URL("../drizzle-active/meta/0004_snapshot.json", import.meta.url), "utf8"),
  ]);
  assert.match(schemaSource, /fire_alarm_panel_sizing_snapshots/);
  assert.doesNotMatch(schemaSource, /fireAlarmPanelSizingSnapshots[\s\S]{0,1000}supersededAt/);
  assert.match(workerSource, /handleFireAlarmPanelSizingApi/);
  assert.match(migration, /CREATE TABLE `fire_alarm_panel_sizing_snapshots`/);
  assert.match(migration, /UNIQUE INDEX `fire_alarm_panel_sizing_project_version_idx`/);
  assert.doesNotMatch(migration, /superseded_at/);
  assert.match(migration, /fire_alarm_panel_sizing_snapshots_immutable_update/);
  assert.match(migration, /fire_alarm_panel_sizing_snapshots_immutable_delete/);
  assert.match(journal, /0004_fire_alarm_panel_sizing_snapshots/);
  assert.match(snapshot, /fire_alarm_panel_sizing_snapshots/);
});
