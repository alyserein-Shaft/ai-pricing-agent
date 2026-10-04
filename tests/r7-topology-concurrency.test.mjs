// R7 residual closure: SLC pool allocation completeness, snapshot version
// allocation under concurrency, post-insert dependency revalidation, and the
// downstream quotation panel-sizing authority.
//
// The panel-sizing half of this file is built on the ACTUAL active migration
// chain (drizzle-active/meta/_journal.json, split on '--> statement-breakpoint'),
// not on a hand-written approximation, so the real UNIQUE INDEX
// fire_alarm_panel_sizing_project_version_idx and the real
// fire_alarm_panel_sizing_snapshots_immutable_* abort triggers are in force.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  comparePanelSizingFingerprints,
  handleFireAlarmPanelSizingApi,
  revalidatePanelSizingWrite,
} from "../worker/fire-alarm-panel-sizing-api.mjs";
import { loadCanonicalQuotationLines, projectPanelSizingBlockers } from "../worker/quotation-line-authority.mjs";

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

// A D1-shaped proxy over a node:sqlite handle. `afterRun(sql, fn)` fires
// immediately AFTER a matching statement commits, which is how the
// post-insert dependency race below is constructed deterministically in-process:
// a concurrent committed change lands in the exact window between the INSERT and
// the revalidation re-read.
const d1 = (raw, { afterRun } = {}) => ({
  prepare(sql) {
    const operation = (values = []) => ({
      first: async () => raw.prepare(sql).get(...values) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...values) }),
      run: async () => {
        const result = raw.prepare(sql).run(...values);
        if (afterRun && afterRun.match(sql)) afterRun.run(raw);
        return result;
      },
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

// This seed approves TWO physical panels (FACP-1, FACP-2) in the current
// architecture but its control-panel BOQ line has a current selected quantity
// of 1, and the selected quantity -- not an engineer input -- is the only
// authority for the physical panel count. Every test in this file is about the
// SLC pool, version allocation, revalidation, or quotation authority of a
// ONE-panel project, so the honest expression is the governed topology
// exclusion for the second approved panel (option (b) of the fixture conflict).
const command = (overrides = {}) => ({
  allocations: [
    {
      boqItemId: "boq-detector",
      panelId: "FACP-1",
      quantity: 200,
      provenance: { sourceType: "Riser Diagram", reference: "FA-101 panel FA-1" },
    },
  ],
  panels: [{
    panelId: "FACP-1",
    boqItemId: "boq-panel",
    productId: "product-panel",
    architectureIdentity: "FACP-1",
  }],
  exclusions: [{
    architectureIdentity: "FACP-2",
    reason: "FACP-2 is a riser-repeater panel with no locally served SLC device demand; it is deliberately not sized in this pass.",
  }],
  provenance: { sourceType: "Approved Engineering Allocation", reference: "FA-101 allocation register" },
  reason: "Allocate detector demand to the approved physical panel topology.",
  ...overrides,
});

const detectorProfile = {
  boqItem: {
    id: "boq-detector",
    system: "Fire Alarm",
    productFamily: "Addressable Smoke Detector",
    attributes: { addressing: { value: "Addressable" } },
  },
};

const moduleProfile = {
  boqItem: {
    id: "boq-module",
    system: "Fire Alarm",
    productFamily: "Monitor Module",
    attributes: { addressing: { value: "Addressable" } },
  },
};

// Seeds a project whose CURRENT engineering-eligible BOQ population carries
// exactly one SLC pool item (boq-detector) plus the control panel, and an
// optional second SLC pool item (boq-module) when withModuleItem is true.
const seedActualChain = ({ withModuleItem = false, systemDomain = "Fire Alarm" } = {}) => {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=OFF");
  applyActiveChain(raw);

  const boqItems = [
    ["boq-detector", 1, "1", "Addressable smoke detectors", 200, 200, "EA", "Fire Alarm", "Detectors", "Addressable Smoke Detector"],
    ["boq-panel", 2, "2", "Fire alarm control panel", 1, 1, "EA", "Fire Alarm", "Control Equipment", "Fire Alarm Control Panel"],
  ];
  if (withModuleItem) boqItems.push(["boq-module", 3, "3", "Addressable monitor modules", 40, 40, "EA", "Fire Alarm", "Modules", "Monitor Module"]);

  raw.prepare("INSERT INTO organizations (id,name,owner_user_id) VALUES (?,?,?)").run("org1", "Fixture Organization", "owner1");
  raw.prepare("INSERT INTO projects (id,name,owner_user_id,organization_id,system_domain,initial_status) VALUES (?,?,?,?,?,?)")
    .run("p1", "R7 topology project", "owner1", "org1", systemDomain, "Active");
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

  for (const [id, sequence, itemNumber, description, numeric, original, unit, systemValue, category, subcategory] of boqItems) {
    raw.prepare(`INSERT INTO boq_items
      (id,extraction_version_id,project_id,source_document_id,duplicate_of_item_id,row_type,sequence,item_number,hierarchy_depth,section_path,system_value,category,subcategory,description,normalized_unit,original_unit,numeric_quantity,original_quantity,extraction_confidence,confidence_state,review_status,source_location,original_raw_values,current_values,approved_for_downstream,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, "ext1", "p1", "doc1", null, "BOQ Item", sequence, itemNumber, 0, "1", systemValue, category, subcategory,
      description, unit, unit, numeric, original, 95, "Resolved", "Approved", "{}", "{}", "{}", 1, "now", "now",
    );
  }

  const profile = (id, boqItemId, profileJson) => raw.prepare(`INSERT INTO requirement_profile_versions
    (id,project_id,boq_item_id,version_number,status,engine_version,ruleset_version,model_version,input_fingerprint,profile,explanation,readiness_status,confidence_summary,approved_for_matching,superseded_at,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    `profile-${id}`, "p1", boqItemId, 1, "Ready for Matching", "engine-v1", "rules-v1", "model-v1",
    `fp-${id}`, JSON.stringify(profileJson), "fixture profile", "Ready", "{}", 1, null, "owner1", "now",
  );
  profile("detector", "boq-detector", detectorProfile);
  profile("panel", "boq-panel", { boqItem: { id: "boq-panel", system: "Fire Alarm", productFamily: "Fire Alarm Control Panel", attributes: {} } });
  if (withModuleItem) profile("module", "boq-module", moduleProfile);

  raw.prepare("INSERT INTO product_manufacturers (id,name,normalized_name,created_by,created_at) VALUES (?,?,?,?,?)")
    .run("mfr1", "Honeywell", "honeywell", "ingest", "now");
  // Every canonical product identity carries real ingestion provenance. This is
  // the technical-identity authority the panel-sizing worker reads; the
  // business approved_for_discovery listing flag is deliberately 0 to prove
  // business review never gates engineering sizing.
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

  raw.prepare(`INSERT INTO product_match_runs
    (id,project_id,boq_item_id,requirement_profile_version_id,version_number,status,input_fingerprint,engine_version,ruleset_version,search_version,model_version,search_scope,summary,created_by,started_at,completed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "run-panel", "p1", "boq-panel", "profile-panel", 1, "Completed", "fp-run", "engine-v1", "rules-v1", "search-v1", "model-v1", "Project", "{}", "owner1", "now", "now",
  );
  raw.prepare(`INSERT INTO product_match_candidates
    (id,match_run_id,product_id,rank,search_stage,score,score_components,technical_status,recommendation_tier,confidence_state,confidence_score,matching_basis,commercial_availability,explanation,mandatory_failures,lifecycle_result)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "candidate-panel", "run-panel", "product-panel", 1, "Recall", 1, "{}", "Eligible", "Recommended", "Resolved", 95, "Fixture", "Available", "fixture", "[]", "Active",
  );
  raw.prepare(`INSERT INTO safety_decisions
    (id,project_id,boq_item_id,requirement_profile_version_id,match_run_id,candidate_id,version_number,input_fingerprint,safety_state,compliance_state,confidence_level,overall_confidence,confidence_components,technical_eligibility,price_eligibility,missing_information,provenance_status,explanation,engine_version,ruleset_version,model_version,recalculation_reason,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "safety-panel", "p1", "boq-panel", "profile-panel", "run-panel", "candidate-panel", 1, "fp-safety",
    "Safe", "Compliant", "High", 95, "{}", "Eligible", "Eligible", "[]", "Verified", "fixture",
    "engine-v1", "rules-v1", "model-v1", "initial", "owner1", "now",
  );
  raw.prepare(`INSERT INTO safety_approval_requests
    (id,project_id,safety_decision_id,approval_type,approval_level,status,requested_by,requested_role,request_reason,evidence,entity_version,ruleset_version,decided_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "approval-panel", "p1", "safety-panel", "Technical", "Technical", "Approved", "owner1", "Project Manager",
    "Approved against the panel datasheet.", "{}", 1, "rules-v1", "now", "now",
  );

  raw.prepare(`INSERT INTO drawing_intake_versions
    (id,project_id,document_id,document_version_id,version_number,input_fingerprint,output_fingerprint,parser_version,status,summary,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "intake-1", "p1", "doc1", "dv1", 1, "intake-in", "intake-out", "parser-1", "Completed", "{}", "owner1", "now",
  );
  // One approved row per review case per approved version (UNIQUE
  // approved_version_id, review_case_id), so each approved panel identity needs
  // its own review case.
  for (const [caseId, subject] of [["case-1", "FACP-1"], ["case-2", "FACP-2"]]) {
    raw.prepare(`INSERT INTO drawing_architecture_review_cases
      (id,project_id,document_id,document_version_id,drawing_intake_version_id,fact_key,fact_type,subject,scope,evidence_kind,parser_version,evidence_fingerprint,status,original_snapshot,current_snapshot,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      caseId, "p1", "doc1", "dv1", "intake-1", `PANEL_EXISTS:${subject}`, "PANEL_EXISTS", subject,
      "FIRE_ALARM", "EXPLICIT", "parser-1", "evidence-arch-1", "Approved", "{}", "{}", "now", "now",
    );
  }
  raw.prepare(`INSERT INTO drawing_architecture_approved_versions
    (id,project_id,version_number,input_fingerprint,output_fingerprint,status,approved_fact_count,excluded_fact_count,created_by,reason,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    "arch-v1", "p1", 1, "arch-in", "arch-out", "Active", 2, 0, "owner1", "Approved architecture", "now",
  );
  for (const [id, caseId, subject] of [["arch-row-1", "case-1", "FACP-1"], ["arch-row-2", "case-2", "FACP-2"]]) {
    raw.prepare(`INSERT INTO drawing_architecture_approved_rows
      (id,approved_version_id,review_case_id,document_id,document_version_id,drawing_intake_version_id,fact_type,subject,relation,object,scope,evidence_kind,authority_class,source_drawing_number,source_page,parser_version,evidence_fingerprint,review_actor_id,review_reason,source_snapshot,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, "arch-v1", caseId, "doc1", "dv1", "intake-1", "PANEL_EXISTS", subject, null, null,
      "FIRE_ALARM", "EXPLICIT", "Authoritative Drawing", "FA-101", 1, "parser-1", "evidence-arch-1",
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

const envFor = (raw, hooks) => ({
  DB: d1(raw, hooks),
  APP_ACCESS_MODE: "single-user",
  APP_USER_ID: "owner1",
  APP_USER_ORGANIZATION_ID: "org1",
  APP_ORGANIZATION_ID: "org1",
  APP_USER_EMAIL: "owner@test.invalid",
  APP_USER_NAME: "Fixture Owner",
});

const post = (env, body = command()) => handleFireAlarmPanelSizingApi(new Request(
  "http://localhost/api/projects/p1/fire-alarm/panel-sizing",
  { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
), env).then(async (response) => ({ status: response.status, body: await response.json() }));

const get = (env) => handleFireAlarmPanelSizingApi(new Request(
  "http://localhost/api/projects/p1/fire-alarm/panel-sizing",
), env).then(async (response) => ({ status: response.status, body: await response.json() }));

const rows = (raw, sql) => raw.prepare(sql).all();

// ---------------------------------------------------------------------------
// FIX 1 -- SLC pool allocation completeness
// ---------------------------------------------------------------------------
test("an SLC-classified current BOQ item omitted from allocations is rejected; the same command with the allocation succeeds", async () => {
  const raw = seedActualChain({ withModuleItem: true });
  const env = envFor(raw);

  const underAllocated = await post(env);
  assert.equal(underAllocated.status, 409, JSON.stringify(underAllocated.body));
  assert.equal(underAllocated.body.error.code, "SLC_POOL_ITEM_UNALLOCATED");
  assert.deepEqual(underAllocated.body.error.details.unallocatedBoqItemIds, ["boq-module"]);
  assert.deepEqual(underAllocated.body.error.details.currentSlcPoolBoqItemIds, ["boq-detector", "boq-module"]);
  assert.equal(rows(raw, "SELECT COUNT(*) count FROM fire_alarm_panel_sizing_snapshots")[0].count, 0, "no snapshot is written for an under-allocating command");

  const complete = await post(env, command({
    allocations: [
      command().allocations[0],
      { boqItemId: "boq-module", panelId: "FACP-1", quantity: 40, provenance: { sourceType: "Riser Diagram", reference: "FA-101 module schedule" } },
    ],
  }));
  assert.equal(complete.status, 201, JSON.stringify(complete.body));
  assert.equal(complete.body.snapshot.calculation.sizing.panels[0].demand.detectors, 200);
  assert.equal(complete.body.snapshot.calculation.sizing.panels[0].demand.modules, 40, "the omitted item now contributes its own pool demand");

  // The GET path re-runs the same completeness rule, so a snapshot that was
  // complete when written goes STALE the moment a NEW SLC pool item appears.
  raw.prepare(`INSERT INTO boq_items
    (id,extraction_version_id,project_id,source_document_id,row_type,sequence,item_number,hierarchy_depth,section_path,system_value,category,subcategory,description,normalized_unit,original_unit,numeric_quantity,original_quantity,extraction_confidence,confidence_state,review_status,source_location,original_raw_values,current_values,approved_for_downstream,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "boq-module-2", "ext1", "p1", "doc1", "BOQ Item", 4, "4", 0, "1", "Fire Alarm", "Modules", "Monitor Module",
    "Addressable output modules", "EA", "EA", 12, 12, 95, "Resolved", "Approved", "{}", "{}", "{}", 1, "now", "now",
  );
  raw.prepare(`INSERT INTO requirement_profile_versions
    (id,project_id,boq_item_id,version_number,status,engine_version,ruleset_version,model_version,input_fingerprint,profile,explanation,readiness_status,confidence_summary,approved_for_matching,superseded_at,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "profile-module-2", "p1", "boq-module-2", 1, "Ready for Matching", "engine-v1", "rules-v1", "model-v1", "fp-module-2",
    JSON.stringify({ boqItem: { id: "boq-module-2", system: "Fire Alarm", productFamily: "Output Module", attributes: { addressing: { value: "Addressable" } } } }),
    "fixture profile", "Ready", "{}", 1, null, "owner1", "now",
  );
  const stale = await get(env);
  assert.equal(stale.status, 200);
  assert.equal(stale.body.status, "STALE");
  assert.equal(stale.body.snapshot.id, complete.body.snapshot.id);
  assert.equal(stale.body.snapshot.current, false);
  assert.equal(rows(raw, "SELECT COUNT(*) count FROM fire_alarm_panel_sizing_snapshots")[0].count, 1, "GET stays read-only");
});

// ---------------------------------------------------------------------------
// FIX 2 -- version allocation and correct-row response, on the real chain
// ---------------------------------------------------------------------------
test("version_number is allocated inline by the INSERT and the response body describes the row this request persisted", async () => {
  const raw = seedActualChain();
  const env = envFor(raw);

  const first = await post(env);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.snapshot.version, 1);
  const persistedFirst = rows(raw, "SELECT id,version_number,input_fingerprint FROM fire_alarm_panel_sizing_snapshots ORDER BY version_number");
  assert.equal(persistedFirst.length, 1);
  assert.equal(first.body.snapshot.id, persistedFirst[0].id, "the 201 body describes the row this request persisted, not merely the newest row");
  assert.equal(first.body.snapshot.inputFingerprint, persistedFirst[0].input_fingerprint);

  const second = await post(env, command({ reason: "Reissue the allocation after engineering review of the same exact inputs." }));
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.equal(second.body.snapshot.version, 2);
  const persistedSecond = rows(raw, "SELECT id,version_number FROM fire_alarm_panel_sizing_snapshots ORDER BY version_number");
  assert.deepEqual(persistedSecond.map((row) => row.version_number), [1, 2]);
  assert.equal(second.body.snapshot.id, persistedSecond[1].id);
  assert.notEqual(second.body.snapshot.id, persistedSecond[0].id);

  // The UNIQUE INDEX on (project_id, version_number) is the real one from the
  // active chain, and the rows really are append-only.
  assert.throws(
    () => raw.prepare("UPDATE fire_alarm_panel_sizing_snapshots SET reason='rewritten' WHERE id=?").run(persistedSecond[0].id),
    /FIRE_ALARM_PANEL_SIZING_SNAPSHOTS_IMMUTABLE/,
  );

  // An identical re-issue is idempotent and returns the row that HOLDS the
  // fingerprint, reporting honestly that it is no longer the head.
  const repeat = await post(env);
  assert.equal(repeat.status, 200);
  assert.equal(repeat.body.idempotent, true);
  assert.equal(repeat.body.snapshot.id, persistedSecond[0].id);
  assert.equal(repeat.body.snapshot.current, false, "an older row that holds the fingerprint is not the current head");
  assert.equal(rows(raw, "SELECT COUNT(*) count FROM fire_alarm_panel_sizing_snapshots")[0].count, 2, "an idempotent re-issue writes nothing");
});

// ---------------------------------------------------------------------------
// FIX 3 -- post-insert dependency revalidation
// ---------------------------------------------------------------------------
test("a dependency that lands between the pre-insert load and the post-insert recompute yields 409 and no 201", async () => {
  const raw = seedActualChain();
  let mutated = 0;
  const env = envFor(raw, {
    afterRun: {
      // Fires only once, immediately after the immutable snapshot INSERT commits
      // and BEFORE the revalidation re-read: exactly the window the check exists
      // for. A concurrent writer changing an Approved capacity attribute is the
      // realistic shape of that race.
      match: (sql) => /INSERT INTO fire_alarm_panel_sizing_snapshots/.test(sql),
      run: (db) => {
        mutated += 1;
        db.prepare("UPDATE product_attributes SET value_json=? WHERE id='cap-panel-2'").run(JSON.stringify(120));
      },
    },
  });

  const result = await post(env);
  assert.equal(mutated, 1, "the race was actually staged");
  assert.equal(result.status, 409, JSON.stringify(result.body));
  assert.equal(result.body.error.code, "PANEL_SIZING_DEPENDENCIES_CHANGED_DURING_WRITE");
  assert.deepEqual(result.body.error.details.changedDependencies, ["panels"]);
  assert.equal(result.body.error.details.unresolvableReason, null, "the recompute resolved cleanly and merely differed");
  assert.match(result.body.error.details.storedInputFingerprint, /^[a-f0-9]{64}$/);
  assert.match(result.body.error.details.currentInputFingerprint, /^[a-f0-9]{64}$/);
  assert.notEqual(result.body.error.details.storedInputFingerprint, result.body.error.details.currentInputFingerprint);
  assert.equal(rows(raw, "SELECT COUNT(*) count FROM fire_alarm_panel_sizing_snapshots")[0].count, 1, "the immutable row is not deleted or corrected");
  assert.equal(rows(raw, "SELECT version_number FROM fire_alarm_panel_sizing_snapshots")[0].version_number, 1, "and it is not renumbered");

  // The row is now known-stale, which is the only correction an append-only
  // table can offer: the GET path's recompute reports STALE against it.
  const stale = await get(envFor(raw));
  assert.equal(stale.status, 200);
  assert.equal(stale.body.status, "STALE");
  assert.equal(stale.body.snapshot.version, 1);
});

test("revalidatePanelSizingWrite and the pure fingerprint comparison are directly assertable", async () => {
  const raw = seedActualChain();
  const env = envFor(raw);
  const created = await post(env);
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const quiet = await revalidatePanelSizingWrite(env.DB, {
    projectId: "p1",
    command: command(),
    persistedInputFingerprint: created.body.snapshot.inputFingerprint,
    persistedDependencies: created.body.snapshot.input.dependencies,
  });
  assert.equal(quiet.matches, true, JSON.stringify(quiet));
  assert.equal(quiet.persistedInputFingerprint, created.body.snapshot.inputFingerprint);
  assert.equal(quiet.recomputedInputFingerprint, created.body.snapshot.inputFingerprint);
  assert.deepEqual(quiet.changedDependencies, []);
  assert.equal(quiet.unresolvableReason, null);

  raw.prepare("UPDATE product_attributes SET value_json=? WHERE id='cap-panel-2'").run(JSON.stringify(120));
  const moved = await revalidatePanelSizingWrite(env.DB, {
    projectId: "p1",
    command: command(),
    persistedInputFingerprint: created.body.snapshot.inputFingerprint,
    persistedDependencies: created.body.snapshot.input.dependencies,
  });
  assert.equal(moved.matches, false);
  assert.equal(moved.persistedInputFingerprint, quiet.recomputedInputFingerprint, "the persisted side is the fingerprint that was written");
  assert.notEqual(moved.recomputedInputFingerprint, moved.persistedInputFingerprint);
  assert.match(moved.recomputedInputFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(moved.changedDependencies, ["panels"], "only the Approved panel capacity moved");
  assert.equal(moved.unresolvableReason, null);

  // A dependency that can no longer be resolved at all is a mismatch, never a
  // silent pass: a snapshot whose inputs cannot be reproduced is not current.
  raw.prepare("UPDATE product_attributes SET review_status='Needs Review' WHERE id='cap-panel-2'").run();
  const unresolvable = await revalidatePanelSizingWrite(env.DB, {
    projectId: "p1",
    command: command(),
    persistedInputFingerprint: created.body.snapshot.inputFingerprint,
    persistedDependencies: created.body.snapshot.input.dependencies,
  });
  assert.equal(unresolvable.matches, false);
  assert.equal(unresolvable.recomputedInputFingerprint, null);
  assert.match(unresolvable.unresolvableReason, /APPROVED_CAPACITY_EVIDENCE_REQUIRED/);
  assert.equal(unresolvable.changedDependencies, null);

  // Without the pre-write dependencies the section diff is honestly "not
  // diffable" rather than a false "everything changed".
  const undiffable = await revalidatePanelSizingWrite(env.DB, {
    projectId: "p1",
    command: command(),
    persistedInputFingerprint: created.body.snapshot.inputFingerprint,
  });
  assert.equal(undiffable.changedDependencies, null);

  assert.deepEqual(comparePanelSizingFingerprints("abc", "abc"), { matches: true, persistedInputFingerprint: "abc", recomputedInputFingerprint: "abc" });
  assert.deepEqual(comparePanelSizingFingerprints("abc", "abd"), { matches: false, persistedInputFingerprint: "abc", recomputedInputFingerprint: "abd" });
  assert.deepEqual(comparePanelSizingFingerprints("abc", null), { matches: false, persistedInputFingerprint: "abc", recomputedInputFingerprint: null });
  assert.deepEqual(comparePanelSizingFingerprints(null, "abc"), { matches: false, persistedInputFingerprint: null, recomputedInputFingerprint: "abc" });
});

// ---------------------------------------------------------------------------
// FIX 4 -- downstream quotation panel-sizing authority
// ---------------------------------------------------------------------------
const quotationDb = ({ systemDomain }) => {
  const sqlite = new DatabaseSync(":memory:");
  const db = {
    exec: (sql) => sqlite.exec(sql),
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...args) {
          return {
            async first() { return statement.get(...args) ?? null; },
            async all() { return { results: statement.all(...args) }; },
            async run() { return statement.run(...args); },
          };
        },
      };
    },
  };
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, organization_id TEXT, archived_at TEXT, system_domain TEXT);
    CREATE TABLE documents (id TEXT PRIMARY KEY, project_id TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
    CREATE TABLE document_versions (id TEXT PRIMARY KEY, document_id TEXT, version_number INTEGER, processing_status TEXT, deleted_at TEXT, effective_from TEXT, effective_to TEXT);
    CREATE TABLE document_supersessions(id TEXT PRIMARY KEY NOT NULL,superseding_version_id TEXT NOT NULL,superseded_version_id TEXT NOT NULL,scope_type TEXT NOT NULL CHECK (scope_type IN ('FULL_DOCUMENT','SECTION','CLAUSE','BOQ_ROW','DRAWING_REGION','EVIDENCE_ENTITY')),scope_id TEXT,supersession_type TEXT NOT NULL CHECK (supersession_type IN ('REVISION','ADDENDUM','CLARIFICATION','CORRECTION')),effective_from TEXT,effective_to TEXT,created_by TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,CHECK (superseding_version_id <> superseded_version_id),CHECK ((scope_type = 'FULL_DOCUMENT' AND scope_id IS NULL) OR (scope_type <> 'FULL_DOCUMENT' AND scope_id IS NOT NULL AND length(trim(scope_id)) > 0)),CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from));
    CREATE TABLE boq_extraction_versions (id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, version_number INTEGER, status TEXT, superseded_at TEXT);
    CREATE TABLE boq_items (id TEXT PRIMARY KEY, extraction_version_id TEXT, project_id TEXT, source_document_id TEXT, sequence INTEGER, item_number TEXT, description TEXT, normalized_unit TEXT, original_unit TEXT, numeric_quantity TEXT, row_type TEXT, review_status TEXT, approved_for_downstream INTEGER, original_quantity TEXT);
    CREATE TABLE pricing_runs (id TEXT PRIMARY KEY, project_id TEXT, scenario_id TEXT, version_number INTEGER, input_fingerprint TEXT, superseded_at TEXT);
    CREATE TABLE pricing_lines (id TEXT PRIMARY KEY, pricing_run_id TEXT, project_id TEXT, boq_item_id TEXT, candidate_id TEXT, product_id TEXT, safety_decision_id TEXT, selected_price_record_id TEXT, version_number INTEGER, status TEXT, approval_ready INTEGER, total_cost_minor INTEGER, net_selling_minor INTEGER, final_value_minor INTEGER);
    CREATE TABLE price_records (id TEXT PRIMARY KEY, approval_status TEXT, validity_state TEXT, valid_until TEXT, reviewed_at TEXT);
    CREATE TABLE pricing_approvals (id TEXT PRIMARY KEY, pricing_run_id TEXT, approval_type TEXT, status TEXT, entity_version INTEGER, created_at TEXT, decided_at TEXT);
    CREATE TABLE library_products (id TEXT PRIMARY KEY, manufacturer_id TEXT, part_number TEXT, description TEXT);
    CREATE TABLE product_manufacturers (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE boq_quantity_source_decisions (id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, source TEXT, selected_quantity REAL, boq_quantity REAL, drawing_quantity REAL, recognition_version_id TEXT, definition_key TEXT, reason TEXT, decided_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE fire_alarm_panel_sizing_snapshots (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, version_number INTEGER NOT NULL, input_fingerprint TEXT NOT NULL, engine_version TEXT NOT NULL, status TEXT NOT NULL, input_json TEXT NOT NULL, calculation_json TEXT NOT NULL, dossier_json TEXT NOT NULL, reason TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
    INSERT INTO projects VALUES ('p1','org1',NULL,'${systemDomain}');
    INSERT INTO documents VALUES ('d1','p1','dv1',NULL,NULL);
    INSERT INTO document_versions (id, document_id, version_number, processing_status, deleted_at) VALUES ('dv1','d1',1,'Completed',NULL);
    INSERT INTO boq_extraction_versions VALUES ('bev1','d1','dv1',1,'Completed',NULL);
    INSERT INTO boq_items VALUES ('b1','bev1','p1','d1',1,'1','Addressable detector','EA','EA','2','BOQ Item','Approved',1,'2');
    INSERT INTO pricing_runs VALUES ('r1','p1','s1',1,'pricing-fingerprint-1',NULL);
    INSERT INTO pricing_lines VALUES ('pl1','r1','p1','b1','c1','prod1','sd1','price1',1,'Draft Price',1,80000,100000,115000);
    INSERT INTO price_records VALUES ('price1','Approved','Valid','2099-12-31','2026-08-29');
    INSERT INTO product_manufacturers VALUES ('m1','Honeywell');
    INSERT INTO library_products VALUES ('prod1','m1','ABC-123','Addressable detector');
    INSERT INTO pricing_approvals VALUES ('a1','r1','Commercial Price','Approved',1,'2026-08-29T10:00:00Z','2026-08-29T10:01:00Z');
  `);
  return db;
};

test("a Fire Alarm project with no panel-sizing snapshot carries PANEL_SIZING_SNAPSHOT_REQUIRED and is not ready", async () => {
  const db = quotationDb({ systemDomain: "Fire Alarm" });
  const result = await loadCanonicalQuotationLines(db, { projectId: "p1", scenarioId: "s1", currency: "SAR" });
  assert.equal(result.lineCount, 1, "the commercial line itself is unaffected by the project-level panel blocker");
  assert.ok(result.blockers.includes("PANEL_SIZING_SNAPSHOT_REQUIRED"));
  assert.equal(result.ready, false);
  assert.deepEqual(await projectPanelSizingBlockers(db, "p1"), ["PANEL_SIZING_SNAPSHOT_REQUIRED"]);
});

test("a present COMPLETED panel-sizing snapshot that proves no required expansion clears the Fire Alarm blocker", async () => {
  const db = quotationDb({ systemDomain: "Fire Alarm" });
  // BOM-001: the fixture must carry a REALISTIC governed calculation. A real
  // snapshot always persists { engineVersion, sizing, panels }; the previous
  // "{}" placeholder could not prove the absence of a capacity requirement, so
  // the gate now fails it closed as PANEL_SIZING_EVIDENCE_UNREADABLE (asserted
  // separately in tests/bom-001-r7-expansion-bridge.test.mjs). This test keeps
  // its original intent: a governed COMPLETED snapshot with
  // requiredExpansionQuantity = 0 clears the project-level blocker.
  const noExpansionRequired = JSON.stringify({
    engineVersion: "fire-alarm-panel-sizing-engine-v1",
    sizing: {
      status: "AUTHORITATIVE_PANEL_SIZING",
      panels: [],
      projectTotal: {
        requiredExpansionQuantity: 0,
        mountingUnitQuantity: 0,
        anyInsufficientEvidence: false,
        anyCapacityExceeded: false,
        anyConflict: false,
      },
      unallocatedDemand: null,
    },
    panels: [],
  });
  await db.prepare("INSERT INTO fire_alarm_panel_sizing_snapshots VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind("ps1", "p1", 3, "panel-input-fp", "engine-v1", "COMPLETED", "{}", noExpansionRequired, "{}", "reason", "owner1", "now").run();
  const result = await loadCanonicalQuotationLines(db, { projectId: "p1", scenarioId: "s1", currency: "SAR" });
  assert.equal(result.blockers.some((blocker) => blocker.startsWith("PANEL_SIZING_")), false);
  assert.equal(result.ready, true);
  assert.deepEqual(await projectPanelSizingBlockers(db, "p1"), []);
});

test("a non-COMPLETED panel-sizing snapshot blocks as PANEL_SIZING_EVIDENCE_STALE", async () => {
  const db = quotationDb({ systemDomain: "Fire Alarm" });
  await db.prepare("INSERT INTO fire_alarm_panel_sizing_snapshots VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind("ps1", "p1", 1, "panel-input-fp", "engine-v1", "STALE", "{}", "{}", "{}", "reason", "owner1", "now").run();
  assert.deepEqual(await projectPanelSizingBlockers(db, "p1"), ["PANEL_SIZING_EVIDENCE_STALE"]);
  const result = await loadCanonicalQuotationLines(db, { projectId: "p1", scenarioId: "s1", currency: "SAR" });
  assert.ok(result.blockers.includes("PANEL_SIZING_EVIDENCE_STALE"));
  assert.equal(result.ready, false);
});

test("a non-Fire-Alarm project never carries a panel-sizing blocker", async () => {
  for (const systemDomain of ["CCTV", "Data & Structured Cabling", "Unspecified", null]) {
    const db = quotationDb({ systemDomain: systemDomain ?? "" });
    const result = await loadCanonicalQuotationLines(db, { projectId: "p1", scenarioId: "s1", currency: "SAR" });
    assert.deepEqual(result.blockers, [], `system domain ${JSON.stringify(systemDomain)} must not block on panel sizing`);
    assert.equal(result.ready, true);
  }
});

test("a Fire Alarm project whose active chain predates the panel-sizing table fails closed", async () => {
  const db = quotationDb({ systemDomain: "Fire Alarm" });
  db.exec("DROP TABLE fire_alarm_panel_sizing_snapshots");
  assert.deepEqual(await projectPanelSizingBlockers(db, "p1"), ["PANEL_SIZING_SNAPSHOT_REQUIRED"]);
});
