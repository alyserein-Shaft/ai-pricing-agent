// MVP-SIZING-1 -- expansion evidence is required ONLY when expansion is needed.
//
// The defect this file closes (D-F / B4): the panel-sizing dependency loader
// demanded the two-hop Expansion Module accessory chain and an Approved
// `added_slc_loops` attribute for EVERY physical panel, eagerly, before any
// capacity arithmetic ran. A panel whose verified native capacity already
// satisfied its validated allocations therefore could not produce a snapshot
// unless it also carried expansion hardware it did not need.
//
// The contract after this file:
//   * native capacity sufficient  -> NO_EXPANSION_REQUIRED, no expansion evidence
//   * expansion genuinely needed  -> complete current Approved evidence, else fail closed
//   * ambiguous / rejected / stale relationships -> fail closed
//   * unknown demand, missing capacity, conflicting topology -> never "no expansion"
//
// The fixture is built on the ACTUAL active migration chain, so the real UNIQUE
// indexes and the real append-only snapshot triggers are in force, and the real
// route handler is exercised end to end.
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

const d1 = (raw) => {
  const db = { writes: 0, prepare(sql) {
    const mutating = /^\s*(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE)\b/i.test(sql);
    const operation = (values = []) => ({
      first: async () => raw.prepare(sql).get(...values) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...values) }),
      run: async () => { if (mutating) db.writes += 1; return raw.prepare(sql).run(...values); },
    });
    return { ...operation(), bind: (...values) => operation(values) };
  } };
  db.async = { batch: async (statements) => { raw.exec("BEGIN IMMEDIATE"); try { const r = []; for (const s of statements) { db.writes += 1; r.push(await s.run()); } raw.exec("COMMIT"); return r; } catch (e) { raw.exec("ROLLBACK"); throw e; } } };
  return db;
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
), env);

// Capacity basis: 1 native loop, 100 detectors AND 100 modules per loop, 500 points.
// 50 detectors  -> ceil(50/100)  = 1 loop  -> 0 additional  -> NO_EXPANSION_REQUIRED
// 200 detectors -> ceil(200/100) = 2 loops -> 1 additional  -> EXPANSION_REQUIRED
const CAPACITY = [
  ["native_slc_loops", 1],
  ["max_detectors_per_loop", 100],
  ["max_modules_per_loop", 100],
  ["max_system_points", 500],
];

const seed = ({ detectorDemand = 50, withExpansionChain = false, ambiguous = false, rejected = false, superseded = false, omitCapacity = false, conflict = false, capacityExceeded = false, withSecondPanel = false } = {}) => {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=OFF");
  applyActiveChain(raw);

  raw.prepare("INSERT INTO organizations (id,name,owner_user_id) VALUES (?,?,?)").run("org1", "Fixture Organization", "owner1");
  raw.prepare("INSERT INTO projects (id,name,owner_user_id,organization_id,system_domain,initial_status) VALUES (?,?,?,?,?,?)")
    .run("p1", "MVP-SIZING-1 project", "owner1", "org1", "Fire Alarm", "Active");
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
  boqItem("boq-detector", 1, "1", "Addressable smoke detectors", detectorDemand, detectorDemand, "EA", "Fire Alarm", "Detectors", "Addressable Smoke Detector");
  boqItem("boq-panel", 2, "2", "Fire alarm control panel", 1, 1, "EA", "Fire Alarm", "Control Equipment", "Fire Alarm Control Panel");

  const profile = (id, boqItemId, family, attributes = {}) => raw.prepare(`INSERT INTO requirement_profile_versions
    (id,project_id,boq_item_id,version_number,status,engine_version,ruleset_version,model_version,input_fingerprint,profile,explanation,readiness_status,confidence_summary,approved_for_matching,superseded_at,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    `profile-${id}`, "p1", boqItemId, 1, "Ready for Matching", "engine-v1", "rules-v1", "model-v1",
    `fp-${id}`, JSON.stringify({ boqItem: { id: boqItemId, system: "Fire Alarm", productFamily: family, attributes } }),
    "fixture profile", "Ready", "{}", 1, null, "owner1", "now",
  );
  profile("detector", "boq-detector", "Addressable Smoke Detector", { addressing: { value: "Addressable" } });
  profile("panel", "boq-panel", "Fire Alarm Control Panel");

  // The panel's current selected quantity is a governed decision, not an input.
  raw.prepare(`INSERT INTO boq_quantity_source_decisions
    (id,project_id,boq_item_id,source,selected_quantity,boq_quantity,drawing_quantity,reason,decided_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run("qsd-panel", "p1", "boq-panel", "Reviewed", 1, 1, null, "Panel quantity reviewed and confirmed.", "owner1", "now");

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
  if (!omitCapacity) {
    for (const [name, value] of CAPACITY) {
      if (conflict && name === "max_detectors_per_loop") { attribute(`cap-${name}`, "product-panel", name, 0); continue; }
      if (capacityExceeded && name === "max_system_points") { attribute(`cap-${name}`, "product-panel", name, 10); continue; }
      attribute(`cap-${name}`, "product-panel", name, value);
    }
  }

  const accessory = (id, productId, accessoryId, quantityParameter) => raw.prepare(`INSERT INTO product_accessories
    (id,product_id,accessory_product_id,relationship_type,quantity_rule,quantity_parameter,condition_json,included,separately_priced,source_id,evidence_json,confidence,review_status,version_number,created_by,superseded_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, productId, accessoryId, "Expansion Module", "CAPACITY_DEPENDENT -- governed project sizing", quantityParameter,
    "[]", 0, 1, "source-1", "{}", 90, rejected ? "Rejected" : "Approved", 1, "ingest", superseded ? "now" : null, "now",
  );
  if (withExpansionChain) {
    if (ambiguous) accessory("rel-panel-rmk-2", "product-panel", "product-rmk", null);
    accessory("rel-panel-rmk", "product-panel", "product-rmk", null);
    accessory("rel-rmk-expander", "product-rmk", "product-expander", 2);
    attribute("cap-expander-1", "product-expander", "added_slc_loops", 1);
  }

  const selectionChain = (suffix, boqItemId, profileId, productId = "product-panel") => {
    raw.prepare(`INSERT INTO product_match_runs
      (id,project_id,boq_item_id,requirement_profile_version_id,version_number,status,input_fingerprint,engine_version,ruleset_version,search_version,model_version,search_scope,summary,created_by,started_at,completed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `run-${suffix}`, "p1", boqItemId, profileId, 1, "Completed", `fp-run-${suffix}`, "engine-v1", "rules-v1", "search-v1", "model-v1", "Project", "{}", "owner1", "now", "now",
    );
    raw.prepare(`INSERT INTO product_match_candidates
      (id,match_run_id,product_id,rank,search_stage,score,score_components,technical_status,recommendation_tier,confidence_state,confidence_score,matching_basis,commercial_availability,explanation,mandatory_failures,lifecycle_result)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `candidate-${suffix}`, `run-${suffix}`, productId, 1, "Recall", 1, "{}", "Eligible", "Recommended", "Resolved", 95, "Fixture", "Available", "fixture", "[]", "Active",
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

  // A second physical panel with its OWN product identity and capacity basis.
  // Its native capacity (1 loop x 50/loop) cannot serve 100 detectors, so it
  // genuinely needs expansion -- while the first panel does not. The expansion
  // chain is shared (panel -> mounting -> loop), so only the panel->mounting hop
  // is added here.
  if (withSecondPanel) {
    boqItem("boq-detector-2", 4, "4", "Second addressable smoke detectors", 100, 100, "EA", "Fire Alarm", "Detectors", "Addressable Smoke Detector");
    profile("detector-2", "boq-detector-2", "Addressable Smoke Detector", { addressing: { value: "Addressable" } });
    boqItem("boq-panel-2", 3, "3", "Second fire alarm control panel", 1, 1, "EA", "Fire Alarm", "Control Equipment", "Fire Alarm Control Panel");
    profile("panel-2", "boq-panel-2", "Fire Alarm Control Panel");
    raw.prepare(`INSERT INTO boq_quantity_source_decisions
      (id,project_id,boq_item_id,source,selected_quantity,boq_quantity,drawing_quantity,reason,decided_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run("qsd-panel-2", "p1", "boq-panel-2", "Reviewed", 1, 1, null, "Second panel quantity reviewed.", "owner1", "now");
    product("product-panel-2", "IFP-2100-2", "Second fire alarm control panel", "Control Panel");
    raw.prepare("INSERT INTO product_source_evidence (id,product_id,source_id,original_text,parser_version,created_at) VALUES (?,?,?,?,?,?)")
      .run("pse-panel-2", "product-panel-2", "source-1", "product-panel-2 datasheet", "parser-v1", "now");
    attribute("cap2-panel-1", "product-panel-2", "native_slc_loops", 1);
    attribute("cap2-panel-2", "product-panel-2", "max_detectors_per_loop", 50);
    attribute("cap2-panel-3", "product-panel-2", "max_modules_per_loop", 50);
    attribute("cap2-panel-4", "product-panel-2", "max_system_points", 500);
    accessory("rel2-panel-rmk", "product-panel-2", "product-rmk", null);
    selectionChain("panel-2", "boq-panel-2", "profile-panel-2", "product-panel-2");
  }

  raw.prepare(`INSERT INTO drawing_intake_versions
    (id,project_id,document_id,document_version_id,version_number,input_fingerprint,output_fingerprint,parser_version,status,summary,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "intake-1", "p1", "doc1", "dv1", 1, "intake-in", "intake-out", "parser-1", "Completed", "{}", "owner1", "now",
  );
  raw.prepare(`INSERT INTO drawing_architecture_review_cases
    (id,project_id,document_id,document_version_id,drawing_intake_version_id,fact_key,fact_type,subject,scope,evidence_kind,parser_version,evidence_fingerprint,status,original_snapshot,current_snapshot,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "case-1", "p1", "doc1", "dv1", "intake-1", "PANEL_EXISTS:FACP-1", "PANEL_EXISTS", "FACP-1",
    "FIRE_ALARM", "EXPLICIT", "parser-1", "evidence-case-1", "Approved", "{}", "{}", "now", "now",
  );
  if (withSecondPanel) {
    raw.prepare(`INSERT INTO drawing_architecture_review_cases
      (id,project_id,document_id,document_version_id,drawing_intake_version_id,fact_key,fact_type,subject,scope,evidence_kind,parser_version,evidence_fingerprint,status,original_snapshot,current_snapshot,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "case-2", "p1", "doc1", "dv1", "intake-1", "PANEL_EXISTS:FACP-2", "PANEL_EXISTS", "FACP-2",
      "FIRE_ALARM", "EXPLICIT", "parser-1", "evidence-case-2", "Approved", "{}", "{}", "now", "now",
    );
  }
  raw.prepare(`INSERT INTO drawing_architecture_approved_versions
    (id,project_id,version_number,input_fingerprint,output_fingerprint,status,approved_fact_count,excluded_fact_count,created_by,reason,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    "arch-v1", "p1", 1, "arch-in", "arch-out", "Active", withSecondPanel ? 2 : 1, 0, "owner1", "Approved architecture", "now",
  );
  raw.prepare(`INSERT INTO drawing_architecture_approved_rows
    (id,approved_version_id,review_case_id,document_id,document_version_id,drawing_intake_version_id,fact_type,subject,relation,object,scope,evidence_kind,authority_class,source_drawing_number,source_page,parser_version,evidence_fingerprint,review_actor_id,review_reason,source_snapshot,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "arch-row-1", "arch-v1", "case-1", "doc1", "dv1", "intake-1", "PANEL_EXISTS", "FACP-1", null, null,
    "FIRE_ALARM", "EXPLICIT", "Authoritative Drawing", "FA-101", 1, "parser-1", "evidence-case-1",
    "owner1", "Verified panel schedule", "{}", "now",
  );
  if (withSecondPanel) {
    raw.prepare(`INSERT INTO drawing_architecture_approved_rows
      (id,approved_version_id,review_case_id,document_id,document_version_id,drawing_intake_version_id,fact_type,subject,relation,object,scope,evidence_kind,authority_class,source_drawing_number,source_page,parser_version,evidence_fingerprint,review_actor_id,review_reason,source_snapshot,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "arch-row-2", "arch-v1", "case-2", "doc1", "dv1", "intake-1", "PANEL_EXISTS", "FACP-2", null, null,
      "FIRE_ALARM", "EXPLICIT", "Authoritative Drawing", "FA-101", 1, "parser-1", "evidence-case-2",
      "owner1", "Verified panel schedule", "{}", "now",
    );
  }
  raw.prepare(`INSERT INTO drawing_architecture_stage4_readiness
    (id,project_id,version_number,architecture_status,stage4_readiness,approved_next_row_count,approved_next_version_number,policy_version,computed_by,evidence_fingerprint,reason,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "ready-1", "p1", 1, "COMPLETE", "READY_FOR_STAGE4_BRIDGE", 1, 1, "policy-1", "system", "readiness-fp", "Ready", "now",
  );
  return raw;
};

const command = ({ detectorDemand = 50, ...overrides } = {}) => ({
  allocations: [{
    boqItemId: "boq-detector",
    panelId: "FACP-1",
    quantity: detectorDemand,
    provenance: { sourceType: "Riser Diagram", reference: "FA-101 panel FA-1" },
  }],
  panels: [{
    panelId: "FACP-1",
    boqItemId: "boq-panel",
    productId: "product-panel",
    architectureIdentity: "FACP-1",
  }],
  provenance: { sourceType: "Approved Engineering Allocation", reference: "FA-101 allocation register" },
  reason: "Allocate detector demand to the approved physical panel topology.",
  ...overrides,
});

test("MVP-SIZING-1 native capacity sufficient + no expansion evidence -> NO_EXPANSION_REQUIRED", async () => {
  const env = envFor(seed({ detectorDemand: 50, withExpansionChain: false }));
  const response = await post(env, command());
  const text = await response.text();
  assert.equal(response.status, 201, `expected 201, got ${response.status}: ${text}`);
  const body = JSON.parse(text);
  assert.equal(body.snapshot.status, "COMPLETED");
  assert.equal(body.snapshot.calculation.panels[0].status, "NO_EXPANSION_REQUIRED");
  assert.equal(body.snapshot.calculation.panels[0].requiredExpansionQuantity, 0);
  assert.equal(body.snapshot.calculation.panels[0].expansionOptions, null);
});

test("MVP-SIZING-1 expansion required + missing evidence -> fails closed", async () => {
  const env = envFor(seed({ detectorDemand: 200, withExpansionChain: false }));
  const response = await post(env, command({ detectorDemand: 200 }));
  const text = await response.text();
  assert.equal(response.status, 409, `expected 409, got ${response.status}: ${text}`);
  const body = JSON.parse(text);
  assert.equal(body.error.code, "AMBIGUOUS_EXPANSION_RELATIONSHIP");
});

test("MVP-SIZING-1 expansion required + complete evidence -> succeeds with correct quantity", async () => {
  const env = envFor(seed({ detectorDemand: 200, withExpansionChain: true }));
  const response = await post(env, command({ detectorDemand: 200 }));
  const text = await response.text();
  assert.equal(response.status, 201, `expected 201, got ${response.status}: ${text}`);
  const body = JSON.parse(text);
  assert.equal(body.snapshot.calculation.panels[0].status, "EXPANSION_REQUIRED");
  assert.equal(body.snapshot.calculation.panels[0].requiredExpansionQuantity, 1);
  assert.equal(body.snapshot.calculation.panels[0].selectedExpansionType, "6815");
});

test("MVP-SIZING-1 ambiguous expansion relationship -> fails closed", async () => {
  const env = envFor(seed({ detectorDemand: 200, withExpansionChain: true, ambiguous: true }));
  const response = await post(env, command({ detectorDemand: 200 }));
  const text = await response.text();
  assert.equal(response.status, 409, `expected 409, got ${response.status}: ${text}`);
  const body = JSON.parse(text);
  assert.equal(body.error.code, "AMBIGUOUS_EXPANSION_RELATIONSHIP");
});

test("MVP-SIZING-1 rejected expansion relationship -> fails closed", async () => {
  const env = envFor(seed({ detectorDemand: 200, withExpansionChain: true, rejected: true }));
  const response = await post(env, command({ detectorDemand: 200 }));
  const text = await response.text();
  assert.equal(response.status, 409, `expected 409, got ${response.status}: ${text}`);
  const body = JSON.parse(text);
  assert.equal(body.error.code, "AMBIGUOUS_EXPANSION_RELATIONSHIP");
});

test("MVP-SIZING-1 missing capacity evidence -> fails closed, never no-expansion", async () => {
  const env = envFor(seed({ detectorDemand: 50, omitCapacity: true }));
  const response = await post(env, command());
  const text = await response.text();
  assert.equal(response.status, 409, `expected 409, got ${response.status}: ${text}`);
  const body = JSON.parse(text);
  assert.equal(body.error.code, "APPROVED_CAPACITY_EVIDENCE_REQUIRED");
});

test("MVP-SIZING-1 conflicting capacity evidence -> fails closed", async () => {
  const env = envFor(seed({ detectorDemand: 50, conflict: true }));
  const response = await post(env, command());
  const text = await response.text();
  assert.equal(response.status, 409, `expected 409, got ${response.status}: ${text}`);
  const body = JSON.parse(text);
  assert.equal(body.error.code, "PANEL_SIZING_CALCULATION_CONFLICT");
});

test("MVP-SIZING-1 capacity exceeded -> fails closed", async () => {
  const env = envFor(seed({ detectorDemand: 50, capacityExceeded: true }));
  const response = await post(env, command());
  const text = await response.text();
  assert.equal(response.status, 409, `expected 409, got ${response.status}: ${text}`);
  const body = JSON.parse(text);
  assert.equal(body.error.code, "PANEL_SIZING_CALCULATION_CONFLICT");
});

// Mixed multi-panel: expansion need is assessed SEPARATELY per physical panel.
// Panel 1 fits natively (50 detectors, 100/loop); panel 2 does not (100 detectors,
// 50/loop). Both must be sized in one snapshot, each on its own evidence.
test("MVP-SIZING-1 mixed multi-panel validates expansion need per physical panel", async () => {
  const env = envFor(seed({ detectorDemand: 50, withSecondPanel: true, withExpansionChain: true }));
  const response = await post(env, {
    allocations: [
      { boqItemId: "boq-detector", panelId: "FACP-1", quantity: 50, provenance: { sourceType: "Riser Diagram", reference: "FA-101 panel FA-1" } },
      { boqItemId: "boq-detector-2", panelId: "FACP-2", quantity: 100, provenance: { sourceType: "Riser Diagram", reference: "FA-101 panel FA-2" } },
    ],
    panels: [
      { panelId: "FACP-1", boqItemId: "boq-panel", productId: "product-panel", architectureIdentity: "FACP-1" },
      { panelId: "FACP-2", boqItemId: "boq-panel-2", productId: "product-panel-2", architectureIdentity: "FACP-2" },
    ],
    provenance: { sourceType: "Approved Engineering Allocation", reference: "FA-101 allocation register" },
    reason: "Allocate detector demand across both approved physical panels.",
  });
  const text = await response.text();
  assert.equal(response.status, 201, `expected 201, got ${response.status}: ${text}`);
  const body = JSON.parse(text);
  const [first, second] = body.snapshot.calculation.panels;
  assert.equal(first.status, "NO_EXPANSION_REQUIRED", "panel 1 fits natively");
  assert.equal(first.expansionOptions, null, "panel 1 must not load an expansion chain");
  assert.equal(second.status, "EXPANSION_REQUIRED", "panel 2 genuinely needs expansion");
  assert.equal(second.requiredExpansionQuantity, 1, "panel 2 expansion quantity follows from its own evidence");
  assert.equal(second.selectedExpansionType, "6815");
});

// A snapshot is pinned to the dependency fingerprint. When the capacity evidence
// changes underneath it, the GET path must report the snapshot STALE rather than
// silently re-serving it as current.
test("MVP-SIZING-1 a capacity change after the write invalidates the snapshot", async () => {
  const env = envFor(seed({ detectorDemand: 50, withExpansionChain: false }));
  const created = await post(env, command());
  const createdText = await created.text();
  assert.equal(created.status, 201, `setup write failed: ${createdText}`);
  const snapshotId = JSON.parse(createdText).snapshot.id;

  // Mutate the Approved capacity evidence the snapshot was pinned to.
  env.DB.prepare("UPDATE product_attributes SET value_json=? WHERE product_id='product-panel' AND attribute_name='native_slc_loops'")
    .run(JSON.stringify(99));

  const response = await handleFireAlarmPanelSizingApi(new Request(
    `http://localhost/api/projects/p1/fire-alarm/panel-sizing`,
  ), env);
  const text = await response.text();
  const body = JSON.parse(text);
  // The GET path reports a stale snapshot as status "STALE" with the stored and
  // current fingerprints, so a changed dependency is visible rather than silently
  // re-served as current.
  assert.equal(body.status, "STALE", `expected STALE, got ${JSON.stringify(body).slice(0, 300)}`);
  assert.equal(body.snapshot.current, false);
  assert.notEqual(body.storedInputFingerprint, body.currentInputFingerprint, "the dependency fingerprint must have changed");
  assert.ok(text.includes(snapshotId), "the stale snapshot id must be named");
});
