// R7 residual closure: APPROVED PANEL TOPOLOGY COMPLETENESS, with explicit
// governed exclusions.
//
// The residual this file closes: `assertArchitectureIdentity` checked MEMBERSHIP
// ONLY. For each panel the command DECLARES it looked the identity up in
// `architecture.identities` and failed if absent. There was no reverse
// assertion, so a snapshot could be authored and persisted as an authoritative,
// dossier-verified project sizing while an approved architecture panel was
// entirely unsized -- and nothing in the persisted record distinguished that
// from a project that has one panel.
//
// The fix is fail-closed completeness WITH EXPRESSIBLE SCOPE REDUCTION:
//   * every approved physical panel must be either DECLARED (sized) or covered
//     by a GOVERNED EXCLUSION carrying a substantive reason;
//   * absence is never implicitly acceptable;
//   * an exclusion may not invent scope: naming something the architecture does
//     not approve as a physical panel is rejected.
//
// The fixture is built on the ACTUAL active migration chain
// (drizzle-active/meta/_journal.json, split on '--> statement-breakpoint'), so
// the real UNIQUE INDEX on (approved_version_id, review_case_id), the real
// fire_alarm_panel_sizing_snapshots append-only triggers, and the real
// project/version UNIQUE INDEX are all in force.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { handleFireAlarmPanelSizingApi } from "../worker/fire-alarm-panel-sizing-api.mjs";

const ACTIVE_ROOT = new URL("../drizzle-active", import.meta.url).pathname.replace(/\/$/, "");

const applyActiveChain = (db) => {
  const journal = JSON.parse(readFileSync(join(ACTIVE_ROOT, "meta", "_journal.json"), "utf8"));
  for (const entry of journal.entries) {
    const sql = readFileSync(join(ACTIVE_ROOT, `${entry.tag}.sql`), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) db.exec(trimmed);
    }
  }
};

// A D1-shaped proxy over a node:sqlite handle. `writes` counts every statement
// that actually mutates, so read purity can be asserted behaviourally rather
// than by reading the source.
const d1 = (raw) => {
  const db = {
    writes: 0,
    prepare(sql) {
      const mutating = /^\s*(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE)\b/i.test(sql);
      const operation = (values = []) => ({
        first: async () => raw.prepare(sql).get(...values) ?? null,
        all: async () => ({ results: raw.prepare(sql).all(...values) }),
        run: async () => {
          if (mutating) db.writes += 1;
          return raw.prepare(sql).run(...values);
        },
      });
      return { ...operation(), bind: (...values) => operation(values) };
    },
    async batch(statements) {
      raw.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const statement of statements) { db.writes += 1; results.push(await statement.run()); }
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return db;
};

const FACP2_REASON = "FACP-2 is a riser-repeater panel with no locally served SLC device demand; it is deliberately not sized in this pass.";

// A one-panel command: the seed approves two panels, this sizes one and excludes
// the other with a reason.
const onePanelCommand = (overrides = {}) => ({
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
  exclusions: [{ architectureIdentity: "FACP-2", reason: FACP2_REASON }],
  provenance: { sourceType: "Approved Engineering Allocation", reference: "FA-101 allocation register" },
  reason: "Allocate detector demand to the approved physical panel topology.",
  ...overrides,
});

// The "engineer said nothing at all about the second approved panel" command:
// the `exclusions` key is genuinely absent from the posted body, not empty.
const silentTopologyCommand = () => {
  const command = onePanelCommand();
  delete command.exclusions;
  return command;
};

// The two-panel command: each approved panel gets its OWN panel BOQ line with a
// current selected quantity of 1, because the physical panel count is the
// selected quantity of the panel BOQ line, never an engineer input.
const twoPanelCommand = () => ({
  allocations: [
    { boqItemId: "boq-detector", panelId: "FACP-1", quantity: 100, provenance: { sourceType: "Riser Diagram", reference: "FA-101 panel FA-1" } },
    { boqItemId: "boq-detector", panelId: "FACP-2", quantity: 100, provenance: { sourceType: "Riser Diagram", reference: "FA-101 panel FA-2" } },
  ],
  panels: [
    { panelId: "FACP-1", boqItemId: "boq-panel", productId: "product-panel", architectureIdentity: "FACP-1" },
    { panelId: "FACP-2", boqItemId: "boq-panel-2", productId: "product-panel", architectureIdentity: "FACP-2" },
  ],
  provenance: { sourceType: "Approved Engineering Allocation", reference: "FA-101 two-panel allocation register" },
  reason: "Allocate the detector population across both approved physical panels.",
});

const seedActualChain = ({ withSecondPanelBoqItem = false, withPanelLabelRow = false, withInferredPanelRow = false } = {}) => {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=OFF");
  applyActiveChain(raw);

  raw.prepare("INSERT INTO organizations (id,name,owner_user_id) VALUES (?,?,?)").run("org1", "Fixture Organization", "owner1");
  raw.prepare("INSERT INTO projects (id,name,owner_user_id,organization_id,system_domain,initial_status) VALUES (?,?,?,?,?,?)")
    .run("p1", "R7 topology completeness project", "owner1", "org1", "Fire Alarm", "Active");
  raw.prepare("INSERT INTO project_members (id,project_id,user_id,role,status,granted_by,granted_at) VALUES (?,?,?,?,?,?,?)")
    .run("member-owner", "p1", "owner1", "Project Manager", "Active", "owner1", "now");
  raw.prepare("INSERT INTO documents (id,project_id,logical_name,created_by,created_at) VALUES (?,?,?,?,?)")
    .run("doc1", "p1", "BOQ and riser", "owner1", "now");
  raw.prepare(`INSERT INTO document_versions
    (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by,effective_from)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run("dv1", "doc1", 1, "boq.pdf", "boq.stored", "pdf", "application/pdf", 4, "sha-dv1", "projects/boq.pdf", "owner1", "2020-01-01T00:00:00.000Z");
  raw.prepare("UPDATE documents SET current_version_id='dv1' WHERE id='doc1'").run();
  raw.prepare(`INSERT INTO boq_extraction_versions
    (id,document_id,document_version_id,version_number,status,parser_version,ruleset_version,ocr_version,created_by,started_at,completed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run("ext1", "doc1", "dv1", 1, "Completed", "parser-v1", "rules-v1", "ocr-v1", "owner1", "now", "now");

  const boqItem = (id, sequence, itemNumber, description, numeric, original, unit, systemValue, category, subcategory) =>
    raw.prepare(`INSERT INTO boq_items
      (id,extraction_version_id,project_id,source_document_id,duplicate_of_item_id,row_type,sequence,item_number,hierarchy_depth,section_path,system_value,category,subcategory,description,normalized_unit,original_unit,numeric_quantity,original_quantity,extraction_confidence,confidence_state,review_status,source_location,original_raw_values,current_values,approved_for_downstream,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, "ext1", "p1", "doc1", null, "BOQ Item", sequence, itemNumber, 0, "1", systemValue, category, subcategory,
      description, unit, unit, numeric, original, 95, "Resolved", "Approved", "{}", "{}", "{}", 1, "now", "now",
    );
  boqItem("boq-detector", 1, "1", "Addressable smoke detectors", 200, 200, "EA", "Fire Alarm", "Detectors", "Addressable Smoke Detector");
  boqItem("boq-panel", 2, "2", "Fire alarm control panel", 1, 1, "EA", "Fire Alarm", "Control Equipment", "Fire Alarm Control Panel");
  // A SECOND control-panel BOQ line with its own selected quantity of 1: the
  // only honest way for the architecture's second approved panel to be sized.
  if (withSecondPanelBoqItem) boqItem("boq-panel-2", 3, "3", "Fire alarm control panel (riser repeater)", 1, 1, "EA", "Fire Alarm", "Control Equipment", "Fire Alarm Control Panel");

  const profile = (id, boqItemId, family, attributes = {}) => raw.prepare(`INSERT INTO requirement_profile_versions
    (id,project_id,boq_item_id,version_number,status,engine_version,ruleset_version,model_version,input_fingerprint,profile,explanation,readiness_status,confidence_summary,approved_for_matching,superseded_at,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    `profile-${id}`, "p1", boqItemId, 1, "Ready for Matching", "engine-v1", "rules-v1", "model-v1",
    `fp-${id}`, JSON.stringify({ boqItem: { id: boqItemId, system: "Fire Alarm", productFamily: family, attributes } }),
    "fixture profile", "Ready", "{}", 1, null, "owner1", "now",
  );
  profile("detector", "boq-detector", "Addressable Smoke Detector", { addressing: { value: "Addressable" } });
  profile("panel", "boq-panel", "Fire Alarm Control Panel");
  if (withSecondPanelBoqItem) profile("panel-2", "boq-panel-2", "Fire Alarm Control Panel");

  raw.prepare("INSERT INTO product_manufacturers (id,name,normalized_name,created_by,created_at) VALUES (?,?,?,?,?)")
    .run("mfr1", "Honeywell", "honeywell", "ingest", "now");
  for (const [id, sourceType] of [["source-1", "Manufacturer Datasheet"], ["source-2", "Manufacturer Installation Manual"]]) {
    raw.prepare(`INSERT INTO product_sources
      (id,checksum,source_type,authority,scope_type,file_name,validity_state,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(id, `sum-${id}`, sourceType, "Manufacturer", "Global", `${id}.pdf`, "Current", "ingest", "now");
  }
  const product = (id, partNumber, description, role) => raw.prepare(`INSERT INTO library_products
    (id,manufacturer_id,part_number,normalized_part_number,description,created_by,created_at,review_status,approved_for_discovery,identity_status,identity_version,product_role)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, "mfr1", partNumber, partNumber.toLowerCase(), description, "ingest", "now", "Reviewed", 0, "Active", 1, role,
  );
  product("product-panel", "IFP-2100", "Fire alarm control panel", "Control Panel");
  product("product-rmk", "5815RMK", "Remote mounting kit", "Enclosure");
  product("product-expander", "6815", "SLC loop expander", "Loop Card");
  for (const [id, productId, sourceId] of [
    ["pse-panel", "product-panel", "source-1"],
    ["pse-rmk", "product-rmk", "source-1"],
    ["pse-expander", "product-expander", "source-2"],
  ]) raw.prepare("INSERT INTO product_source_evidence (id,product_id,source_id,original_text,parser_version,created_at) VALUES (?,?,?,?,?,?)")
    .run(id, productId, sourceId, `${productId} datasheet`, "parser-v1", "now");

  const attribute = (id, productId, name, value) => raw.prepare(`INSERT INTO product_attributes
    (id,product_id,attribute_name,value_json,unit,source_id,evidence_json,confidence,review_status,version_number,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, productId, name, JSON.stringify(value), "count", "source-1", "{}", 95, "Approved", 1, "ingest", "now",
  );
  attribute("cap-panel-1", "product-panel", "native_slc_loops", 1);
  attribute("cap-panel-2", "product-panel", "max_detectors_per_loop", 100);
  attribute("cap-panel-3", "product-panel", "max_modules_per_loop", 100);
  attribute("cap-panel-4", "product-panel", "max_system_points", 500);
  attribute("cap-expander-1", "product-expander", "added_slc_loops", 1);

  const accessory = (id, productId, accessoryId, quantityRule, quantityParameter, sourceId) => raw.prepare(`INSERT INTO product_accessories
    (id,product_id,accessory_product_id,relationship_type,quantity_rule,quantity_parameter,condition_json,included,separately_priced,source_id,evidence_json,confidence,review_status,version_number,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, productId, accessoryId, "Expansion Module", quantityRule, quantityParameter,
    "[]", 0, 1, sourceId, "{}", 90, "Approved", 1, "ingest", "now",
  );
  accessory("rel-panel-rmk", "product-panel", "product-rmk", "CAPACITY_DEPENDENT -- governed project sizing", null, "source-1");
  accessory("rel-rmk-expander", "product-rmk", "product-expander", "Up to 2 per mounting unit", 2, "source-2");

  // One full selection authority chain per panel BOQ line: match run, candidate,
  // safety decision, technical approval. The second chain exists only when the
  // second panel is actually sized.
  const selectionChain = (suffix, boqItemId, profileId) => {
    raw.prepare(`INSERT INTO product_match_runs
      (id,project_id,boq_item_id,requirement_profile_version_id,version_number,status,input_fingerprint,engine_version,ruleset_version,search_version,model_version,search_scope,summary,created_by,started_at,completed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `run-${suffix}`, "p1", boqItemId, profileId, 1, "Completed", `fp-run-${suffix}`, "engine-v1", "rules-v1", "search-v1", "model-v1", "Project", "{}", "owner1", "now", "now",
    );
    raw.prepare(`INSERT INTO product_match_candidates
      (id,match_run_id,product_id,rank,search_stage,score,score_components,technical_status,recommendation_tier,confidence_state,confidence_score,matching_basis,commercial_availability,explanation,mandatory_failures,lifecycle_result)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `candidate-${suffix}`, `run-${suffix}`, "product-panel", 1, "Recall", 1, "{}", "Eligible", "Recommended", "Resolved", 95, "Fixture", "Available", "fixture", "[]", "Active",
    );
    raw.prepare(`INSERT INTO safety_decisions
      (id,project_id,boq_item_id,requirement_profile_version_id,match_run_id,candidate_id,version_number,input_fingerprint,safety_state,compliance_state,confidence_level,overall_confidence,confidence_components,technical_eligibility,price_eligibility,missing_information,provenance_status,explanation,engine_version,ruleset_version,model_version,recalculation_reason,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `safety-${suffix}`, "p1", boqItemId, profileId, `run-${suffix}`, `candidate-${suffix}`, 1, `fp-safety-${suffix}`,
      "Safe", "Compliant", "High", 95, "{}", "Eligible", "Eligible", "[]", "Verified", "fixture",
      "engine-v1", "rules-v1", "model-v1", "initial", "owner1", "now",
    );
    raw.prepare(`INSERT INTO safety_approval_requests
      (id,project_id,safety_decision_id,approval_type,approval_level,status,requested_by,requested_role,request_reason,evidence,entity_version,ruleset_version,decided_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `approval-${suffix}`, "p1", `safety-${suffix}`, "Technical", "Technical", "Approved", "owner1", "Project Manager",
      "Approved against the panel datasheet.", "{}", 1, "rules-v1", "now", "now",
    );
  };
  selectionChain("panel", "boq-panel", "profile-panel");
  if (withSecondPanelBoqItem) selectionChain("panel-2", "boq-panel-2", "profile-panel-2");

  raw.prepare(`INSERT INTO drawing_intake_versions
    (id,project_id,document_id,document_version_id,version_number,input_fingerprint,output_fingerprint,parser_version,status,summary,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "intake-1", "p1", "doc1", "dv1", 1, "intake-in", "intake-out", "parser-1", "Completed", "{}", "owner1", "now",
  );

  // The approved architecture rows under test. One review case per approved row
  // (UNIQUE approved_version_id, review_case_id).
  const architectureRows = [
    ["case-1", "arch-row-1", "FACP-1", "PANEL_EXISTS", "EXPLICIT"],
    ["case-2", "arch-row-2", "FACP-2", "PANEL_EXISTS", "EXPLICIT"],
  ];
  // A PANEL_LABEL row shares the PANEL_INVENTORY channel with PANEL_EXISTS (see
  // BRIDGE_FACT_SEMANTICS) and its subject is a drawing TAG, not a panel. If the
  // completeness check were built on the `identities` membership map, this tag
  // string would become a phantom required physical panel.
  if (withPanelLabelRow) architectureRows.push(["case-3", "arch-row-3", "FACP-1 CONTROL PANEL TAG", "PANEL_LABEL", "EXPLICIT"]);
  // An INFERRED PANEL_EXISTS row. Inferred evidence may never verify anything
  // (see authorityCheckForDossierEvidence), so it must never REQUIRE a sizing
  // decision -- it is a suggestion, not an approved panel.
  if (withInferredPanelRow) architectureRows.push(["case-4", "arch-row-4", "FACP-9", "PANEL_EXISTS", "INFERRED"]);

  for (const [caseId, , subject, factType, evidenceKind] of architectureRows) {
    raw.prepare(`INSERT INTO drawing_architecture_review_cases
      (id,project_id,document_id,document_version_id,drawing_intake_version_id,fact_key,fact_type,subject,scope,evidence_kind,parser_version,evidence_fingerprint,status,original_snapshot,current_snapshot,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      caseId, "p1", "doc1", "dv1", "intake-1", `${factType}:${subject}`, factType, subject,
      "FIRE_ALARM", evidenceKind, "parser-1", `evidence-${caseId}`, "Approved", "{}", "{}", "now", "now",
    );
  }
  raw.prepare(`INSERT INTO drawing_architecture_approved_versions
    (id,project_id,version_number,input_fingerprint,output_fingerprint,status,approved_fact_count,excluded_fact_count,created_by,reason,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    "arch-v1", "p1", 1, "arch-in", "arch-out", "Active", architectureRows.length, 0, "owner1", "Approved architecture", "now",
  );
  for (const [caseId, rowId, subject, factType, evidenceKind] of architectureRows) {
    raw.prepare(`INSERT INTO drawing_architecture_approved_rows
      (id,approved_version_id,review_case_id,document_id,document_version_id,drawing_intake_version_id,fact_type,subject,relation,object,scope,evidence_kind,authority_class,source_drawing_number,source_page,parser_version,evidence_fingerprint,review_actor_id,review_reason,source_snapshot,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      rowId, "arch-v1", caseId, "doc1", "dv1", "intake-1", factType, subject, null, null,
      "FIRE_ALARM", evidenceKind, "Authoritative Drawing", "FA-101", 1, "parser-1", `evidence-${caseId}`,
      "owner1", "Verified panel schedule", "{}", "now",
    );
  }
  raw.prepare(`INSERT INTO drawing_architecture_stage4_readiness
    (id,project_id,version_number,architecture_status,stage4_readiness,approved_next_row_count,approved_next_version_number,policy_version,computed_by,evidence_fingerprint,reason,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "ready-1", "p1", 1, "COMPLETE", "READY_FOR_STAGE4_BRIDGE", architectureRows.length, 1, "policy-1", "system", "readiness-fp", "Ready", "now",
  );

  return raw;
};

const envFor = (raw) => ({
  DB: d1(raw),
  APP_ACCESS_MODE: "single-user",
  APP_USER_ID: "owner1",
  APP_USER_ORGANIZATION_ID: "org1",
  APP_ORGANIZATION_ID: "org1",
  APP_USER_EMAIL: "owner@test.invalid",
  APP_USER_NAME: "Fixture Owner",
});

const post = (env, body) => handleFireAlarmPanelSizingApi(new Request(
  "http://localhost/api/projects/p1/fire-alarm/panel-sizing",
  { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
), env).then(async (response) => ({ status: response.status, body: await response.json() }));

const get = (env) => handleFireAlarmPanelSizingApi(new Request(
  "http://localhost/api/projects/p1/fire-alarm/panel-sizing",
), env).then(async (response) => ({ status: response.status, body: await response.json() }));

const snapshotRows = (raw) => raw.prepare("SELECT id,version_number,engine_version,input_fingerprint FROM fire_alarm_panel_sizing_snapshots ORDER BY version_number").all();

const tableCounts = (raw) => Object.fromEntries(raw.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
).all().map((row) => [row.name, raw.prepare(`SELECT COUNT(*) count FROM "${row.name}"`).get().count]));

// ---------------------------------------------------------------------------
// 1 + 2 + 3 -- incomplete, declared, excluded
// ---------------------------------------------------------------------------
test("an approved PANEL_EXISTS identity that is neither declared nor excluded is rejected 409 and named in details", async () => {
  const raw = seedActualChain();
  const env = envFor(raw);

  // The engineer said NOTHING about FACP-2. Under membership-only checking this
  // persisted a COMPLETED, dossier-verified snapshot of a two-panel project that
  // sized one panel.
  const silent = await post(env, silentTopologyCommand());
  assert.equal(silent.status, 409, JSON.stringify(silent.body));
  assert.equal(silent.body.error.code, "PANEL_TOPOLOGY_INCOMPLETE");
  assert.deepEqual(silent.body.error.details.unsizedPanelIdentities, ["FACP-2"]);
  assert.deepEqual(silent.body.error.details.requiredPanelIdentities, ["FACP-1", "FACP-2"]);
  assert.deepEqual(silent.body.error.details.declaredPanelIdentities, ["FACP-1"]);
  assert.deepEqual(silent.body.error.details.excludedPanelIdentities, []);
  assert.match(silent.body.error.message, /FACP-2/);
  assert.equal(snapshotRows(raw).length, 0, "an incomplete topology never reaches a snapshot");

  // (2) The same architecture, with FACP-2 actually declared and each approved
  // panel carrying its own panel BOQ line whose selected quantity is 1.
  const rawTwo = seedActualChain({ withSecondPanelBoqItem: true });
  const envTwo = envFor(rawTwo);
  const declared = await post(envTwo, twoPanelCommand());
  assert.equal(declared.status, 201, JSON.stringify(declared.body));
  assert.deepEqual(
    declared.body.snapshot.calculation.sizing.panels.map((panel) => panel.panelId),
    ["FACP-1", "FACP-2"],
  );
  const architectureEvidence = declared.body.snapshot.dossier.items.find((item) => item.type === "SYSTEM_ARCHITECTURE").evidence[0];
  assert.deepEqual(architectureEvidence.provenance.requiredPanelIdentities, ["FACP-1", "FACP-2"]);
  assert.deepEqual(architectureEvidence.provenance.declaredPanelIdentities, ["FACP-1", "FACP-2"]);
  assert.deepEqual(architectureEvidence.provenance.excludedPanelIdentities, []);

  // (3) The same architecture with FACP-2 covered by a governed exclusion.
  const rawOne = seedActualChain();
  const envOne = envFor(rawOne);
  const excluded = await post(envOne, onePanelCommand());
  assert.equal(excluded.status, 201, JSON.stringify(excluded.body));
  const excludedArchitectureEvidence = excluded.body.snapshot.dossier.items.find((item) => item.type === "SYSTEM_ARCHITECTURE").evidence[0];
  // The scope decision is AUDITABLE, not invisible: the persisted dossier carries
  // the reason the second approved panel was left out, verbatim.
  assert.deepEqual(excludedArchitectureEvidence.provenance.excludedPanelIdentities, [{ architectureIdentity: "FACP-2", reason: FACP2_REASON }]);
  assert.deepEqual(excludedArchitectureEvidence.provenance.declaredPanelIdentities, ["FACP-1"]);
  assert.deepEqual(excludedArchitectureEvidence.provenance.requiredPanelIdentities, ["FACP-1", "FACP-2"]);
  assert.match(excludedArchitectureEvidence.claim, /1 governed exclusion/);
  // ...and it is durable in the row, not only in the response body.
  const stored = JSON.parse(rawOne.prepare("SELECT dossier_json FROM fire_alarm_panel_sizing_snapshots").get().dossier_json);
  assert.deepEqual(
    stored.items.find((item) => item.type === "SYSTEM_ARCHITECTURE").evidence[0].provenance.excludedPanelIdentities,
    [{ architectureIdentity: "FACP-2", reason: FACP2_REASON }],
  );
  assert.equal(JSON.parse(rawOne.prepare("SELECT input_json FROM fire_alarm_panel_sizing_snapshots").get().input_json).command.exclusions[0].reason, FACP2_REASON);
});

// ---------------------------------------------------------------------------
// 4 + 5 + 6 -- the governed-exclusion contract itself
// ---------------------------------------------------------------------------
test("exclusions are governed: a short reason, an invented identity, and a duplicate are all rejected", async (t) => {
  await t.test("a too-short reason is rejected 422", async () => {
    const raw = seedActualChain();
    const env = envFor(raw);
    const result = await post(env, onePanelCommand({ exclusions: [{ architectureIdentity: "FACP-2", reason: "n/a" }] }));
    assert.equal(result.status, 422, JSON.stringify(result.body));
    assert.equal(result.body.error.code, "PANEL_TOPOLOGY_EXCLUSION_REASON_REQUIRED");
    assert.equal(snapshotRows(raw).length, 0);
  });

  await t.test("an exclusion naming a non-approved identity is rejected 422 UNKNOWN_PANEL_TOPOLOGY_EXCLUSION", async () => {
    const raw = seedActualChain();
    const env = envFor(raw);
    const result = await post(env, onePanelCommand({
      exclusions: [
        { architectureIdentity: "FACP-2", reason: FACP2_REASON },
        // FACP-77 exists nowhere in the approved architecture. An exclusion may
        // not invent a scope reduction, and it certainly may not be used to
        // excuse a panel that was never approved in the first place.
        { architectureIdentity: "FACP-77", reason: "Reduce scope over a panel the architecture never approved." },
      ],
    }));
    assert.equal(result.status, 422, JSON.stringify(result.body));
    assert.equal(result.body.error.code, "UNKNOWN_PANEL_TOPOLOGY_EXCLUSION");
    assert.match(result.body.error.message, /FACP-77/);
    assert.equal(snapshotRows(raw).length, 0);
  });

  await t.test("a duplicate exclusion is rejected 422", async () => {
    const raw = seedActualChain();
    const env = envFor(raw);
    const result = await post(env, onePanelCommand({
      exclusions: [
        { architectureIdentity: "FACP-2", reason: FACP2_REASON },
        { architectureIdentity: "FACP-2", reason: "A second, contradictory justification for the same panel." },
      ],
    }));
    assert.equal(result.status, 422, JSON.stringify(result.body));
    assert.equal(result.body.error.code, "PANEL_TOPOLOGY_EXCLUSION_CONFLICT");
    assert.equal(snapshotRows(raw).length, 0);
  });

  await t.test("a panel may not be both sized and excluded", async () => {
    const raw = seedActualChain({ withSecondPanelBoqItem: true });
    const env = envFor(raw);
    const result = await post(env, { ...twoPanelCommand(), exclusions: [{ architectureIdentity: "FACP-1", reason: "Contradictorily exclude a panel this command sizes." }] });
    assert.equal(result.status, 422, JSON.stringify(result.body));
    assert.equal(result.body.error.code, "PANEL_TOPOLOGY_EXCLUSION_CONFLICT");
    assert.equal(snapshotRows(raw).length, 0);
  });

  await t.test("a malformed exclusion payload is rejected 422", async () => {
    const raw = seedActualChain();
    const env = envFor(raw);
    for (const exclusions of [[{ reason: "No identity named at all in this entry." }], ["FACP-2"], [{ architectureIdentity: "FACP-2" }]]) {
      const result = await post(env, onePanelCommand({ exclusions }));
      assert.equal(result.status, 422, JSON.stringify({ exclusions, body: result.body }));
      assert.ok(["INVALID_PANEL_TOPOLOGY_EXCLUSION", "PANEL_TOPOLOGY_EXCLUSION_REASON_REQUIRED"].includes(result.body.error.code), result.body.error.code);
    }
    assert.equal(snapshotRows(raw).length, 0);
  });
});

// ---------------------------------------------------------------------------
// 7 + 8 -- the two traps the requiredPanelIdentities split exists to avoid
// ---------------------------------------------------------------------------
test("a PANEL_LABEL evidence row never becomes a required physical panel", async () => {
  const raw = seedActualChain({ withPanelLabelRow: true });
  const env = envFor(raw);

  // "FACP-1 CONTROL PANEL TAG" is an approved EXPLICIT row in the SAME
  // PANEL_INVENTORY channel. It is a drawing tag, not a panel, so the one-panel
  // command must still succeed without covering it.
  const result = await post(env, onePanelCommand());
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const evidence = result.body.snapshot.dossier.items.find((item) => item.type === "SYSTEM_ARCHITECTURE").evidence[0];
  assert.deepEqual(evidence.provenance.requiredPanelIdentities, ["FACP-1", "FACP-2"], "the label string is not a required panel");
  // The label is still in the MEMBERSHIP index -- it was never removed from the
  // architecture, only excluded from the required-topology enumeration.
  assert.ok(Object.hasOwn(result.body.snapshot.input.dependencies.architecture.identities, "FACP-1 CONTROL PANEL TAG"));

  // And it is not a panel, so it may not be EXCLUDED either: an exclusion over
  // a label is a scope reduction over something that was never in scope.
  const rawTwo = seedActualChain({ withPanelLabelRow: true });
  const excluded = await post(envFor(rawTwo), onePanelCommand({
    exclusions: [
      { architectureIdentity: "FACP-2", reason: FACP2_REASON },
      { architectureIdentity: "FACP-1 CONTROL PANEL TAG", reason: "Try to exclude a drawing tag as if it were a panel." },
    ],
  }));
  assert.equal(excluded.status, 422, JSON.stringify(excluded.body));
  assert.equal(excluded.body.error.code, "UNKNOWN_PANEL_TOPOLOGY_EXCLUSION");
});

test("an INFERRED PANEL_EXISTS row never becomes a required physical panel", async () => {
  const raw = seedActualChain({ withInferredPanelRow: true });
  const env = envFor(raw);

  // FACP-9 is present as an approved PANEL_EXISTS row whose evidenceKind is
  // INFERRED. Inferred evidence can never verify anything, so it cannot require
  // the engineer to size a panel either.
  const result = await post(env, onePanelCommand());
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const evidence = result.body.snapshot.dossier.items.find((item) => item.type === "SYSTEM_ARCHITECTURE").evidence[0];
  assert.deepEqual(evidence.provenance.requiredPanelIdentities, ["FACP-1", "FACP-2"], "FACP-9 is not required");
  assert.equal(Object.hasOwn(result.body.snapshot.input.dependencies.architecture.identities, "FACP-9"), false, "inferred panel evidence is not even a membership candidate");

  const rawTwo = seedActualChain({ withInferredPanelRow: true });
  const excluded = await post(envFor(rawTwo), onePanelCommand({
    exclusions: [
      { architectureIdentity: "FACP-2", reason: FACP2_REASON },
      { architectureIdentity: "FACP-9", reason: "Try to exclude an inferred panel as if it were approved." },
    ],
  }));
  assert.equal(excluded.status, 422, JSON.stringify(excluded.body));
  assert.equal(excluded.body.error.code, "UNKNOWN_PANEL_TOPOLOGY_EXCLUSION");
});

// ---------------------------------------------------------------------------
// 9 -- read purity
// ---------------------------------------------------------------------------
test("the topology checks introduce no write on any read path", async () => {
  const raw = seedActualChain();
  const env = envFor(raw);
  const created = await post(env, onePanelCommand());
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.ok(env.DB.writes > 0, "the POST really did write, so a zero-write read is a real observation");
  const before = tableCounts(raw);

  env.DB.writes = 0;
  const read = await get(env);
  assert.equal(env.DB.writes, 0, `GET issued ${env.DB.writes} mutating statement(s)`);
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.equal(read.body.status, "CURRENT", "a complete topology is CURRENT, not STALE");
  assert.deepEqual(tableCounts(raw), before, "GET changed no table in the whole schema");

  // The GET recompute runs the SAME completeness rule against the persisted
  // command. If the architecture later grows a third approved panel, the read
  // path must report STALE rather than silently accept the newly unsized panel.
  raw.prepare(`INSERT INTO drawing_architecture_review_cases
    (id,project_id,document_id,document_version_id,drawing_intake_version_id,fact_key,fact_type,subject,scope,evidence_kind,parser_version,evidence_fingerprint,status,original_snapshot,current_snapshot,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "case-5", "p1", "doc1", "dv1", "intake-1", "PANEL_EXISTS:FACP-3", "PANEL_EXISTS", "FACP-3",
    "FIRE_ALARM", "EXPLICIT", "parser-1", "evidence-case-5", "Approved", "{}", "{}", "now", "now",
  );
  raw.prepare(`INSERT INTO drawing_architecture_approved_rows
    (id,approved_version_id,review_case_id,document_id,document_version_id,drawing_intake_version_id,fact_type,subject,relation,object,scope,evidence_kind,authority_class,source_drawing_number,source_page,parser_version,evidence_fingerprint,review_actor_id,review_reason,source_snapshot,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "arch-row-5", "arch-v1", "case-5", "doc1", "dv1", "intake-1", "PANEL_EXISTS", "FACP-3", null, null,
    "FIRE_ALARM", "EXPLICIT", "Authoritative Drawing", "FA-101", 1, "parser-1", "evidence-case-5",
    "owner1", "Verified panel schedule", "{}", "now",
  );
  env.DB.writes = 0;
  const stale = await get(env);
  assert.equal(env.DB.writes, 0, "the STALE read is still read-only");
  assert.equal(stale.status, 200);
  assert.equal(stale.body.status, "STALE");
  assert.match(stale.body.reason, /FACP-3/);
  assert.equal(stale.body.snapshot.id, created.body.snapshot.id);
  assert.equal(snapshotRows(raw).length, 1, "no new snapshot row was written by either read");
});
