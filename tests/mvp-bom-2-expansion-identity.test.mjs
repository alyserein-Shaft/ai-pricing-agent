// MVP-BOM-2 -- the resolved expansion product identity and its calculated
// quantity must survive into the governed BOM flow, and the quotation blocker
// must clear only on valid current commercial coverage.
//
// The defect this file closes (BOM-002): panel sizing resolves the expansion
// chain all the way to a canonical product identity (loop expander + mounting
// unit) and a calculated quantity, then the project aggregation persists only
// the NUMBER. The productId is discarded at the boundary, so the BOM read model
// and the quotation gate cannot see which product is required, how it is
// evidenced, or whether it is covered.
//
// The fixture is built on the ACTUAL active migration chain and drives the real
// route handlers end to end.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { handleFireAlarmPanelSizingApi } from "../worker/fire-alarm-panel-sizing-api.mjs";
import { buildProjectBomSummary } from "../worker/boq-line-bom-api.mjs";

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

// Capacity: panel 1 native loop x 100/loop serves 50 detectors (no expansion).
//           panel 2 native loop x 50/loop serves 100 detectors (1 expansion).
const seed = ({ withExpansionChain = true, requireExpansion = false } = {}) => {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=OFF");
  applyActiveChain(raw);

  raw.prepare("INSERT INTO organizations (id,name,owner_user_id) VALUES (?,?,?)").run("org1", "Fixture Organization", "owner1");
  raw.prepare("INSERT INTO projects (id,name,owner_user_id,organization_id,system_domain,initial_status) VALUES (?,?,?,?,?,?)")
    .run("p1", "MVP-BOM-2 project", "owner1", "org1", "Fire Alarm", "Active");
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

  const boqItem = (id, sequence, itemNumber, description, numeric, category, subcategory) =>
    raw.prepare(`INSERT INTO boq_items
      (id,extraction_version_id,project_id,source_document_id,duplicate_of_item_id,row_type,sequence,item_number,hierarchy_depth,section_path,system_value,category,subcategory,description,normalized_unit,original_unit,numeric_quantity,original_quantity,extraction_confidence,confidence_state,review_status,source_location,original_raw_values,current_values,approved_for_downstream,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, "ext1", "p1", "doc1", null, "BOQ Item", sequence, itemNumber, 0, "1", "Fire Alarm", category, subcategory,
      description, "EA", "EA", numeric, numeric, 95, "Resolved", "Approved", "{}", "{}", "{}", 1, "now", "now",
    );
  boqItem("boq-detector", 1, "1", "Addressable smoke detectors", 50, "Detectors", "Addressable Smoke Detector");
  boqItem("boq-panel", 2, "2", "Fire alarm control panel", 1, "Control Equipment", "Fire Alarm Control Panel");

  const profile = (id, boqItemId, family, attributes = {}) => raw.prepare(`INSERT INTO requirement_profile_versions
    (id,project_id,boq_item_id,version_number,status,engine_version,ruleset_version,model_version,input_fingerprint,profile,explanation,readiness_status,confidence_summary,approved_for_matching,superseded_at,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    `profile-${id}`, "p1", boqItemId, 1, "Ready for Matching", "engine-v1", "rules-v1", "model-v1",
    `fp-${id}`, JSON.stringify({ boqItem: { id: boqItemId, system: "Fire Alarm", productFamily: family, attributes } }),
    "fixture profile", "Ready", "{}", 1, null, "owner1", "now",
  );
  profile("detector", "boq-detector", "Addressable Smoke Detector", { addressing: { value: "Addressable" } });
  profile("panel", "boq-panel", "Fire Alarm Control Panel");

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
  attribute("cap-panel-1", "product-panel", "native_slc_loops", 1);
  attribute("cap-panel-2", "product-panel", "max_detectors_per_loop", requireExpansion ? 25 : 100);
  attribute("cap-panel-3", "product-panel", "max_modules_per_loop", 100);
  attribute("cap-panel-4", "product-panel", "max_system_points", 500);
  attribute("cap-expander-1", "product-expander", "added_slc_loops", 1);

  const accessory = (id, productId, accessoryId, quantityParameter) => raw.prepare(`INSERT INTO product_accessories
    (id,product_id,accessory_product_id,relationship_type,quantity_rule,quantity_parameter,condition_json,included,separately_priced,source_id,evidence_json,confidence,review_status,version_number,created_by,superseded_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, productId, accessoryId, "Expansion Module", "CAPACITY_DEPENDENT -- governed project sizing", quantityParameter,
    "[]", 0, 1, "source-1", "{}", 90, "Approved", 1, "ingest", null, "now",
  );
  if (withExpansionChain) {
    accessory("rel-panel-rmk", "product-panel", "product-rmk", null);
    accessory("rel-rmk-expander", "product-rmk", "product-expander", 2);
  }

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
  raw.prepare(`INSERT INTO drawing_architecture_approved_versions
    (id,project_id,version_number,input_fingerprint,output_fingerprint,status,approved_fact_count,excluded_fact_count,created_by,reason,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    "arch-v1", "p1", 1, "arch-in", "arch-out", "Active", 1, 0, "owner1", "Approved architecture", "now",
  );
  raw.prepare(`INSERT INTO drawing_architecture_approved_rows
    (id,approved_version_id,review_case_id,document_id,document_version_id,drawing_intake_version_id,fact_type,subject,relation,object,scope,evidence_kind,authority_class,source_drawing_number,source_page,parser_version,evidence_fingerprint,review_actor_id,review_reason,source_snapshot,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "arch-row-1", "arch-v1", "case-1", "doc1", "dv1", "intake-1", "PANEL_EXISTS", "FACP-1", null, null,
    "FIRE_ALARM", "EXPLICIT", "Authoritative Drawing", "FA-101", 1, "parser-1", "evidence-case-1",
    "owner1", "Verified panel schedule", "{}", "now",
  );
  raw.prepare(`INSERT INTO drawing_architecture_stage4_readiness
    (id,project_id,version_number,architecture_status,stage4_readiness,approved_next_row_count,approved_next_version_number,policy_version,computed_by,evidence_fingerprint,reason,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "ready-1", "p1", 1, "COMPLETE", "READY_FOR_STAGE4_BRIDGE", 1, 1, "policy-1", "system", "readiness-fp", "Ready", "now",
  );
  return raw;
};

const command = () => ({
  allocations: [{
    boqItemId: "boq-detector",
    panelId: "FACP-1",
    quantity: 50,
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
});

test("MVP-BOM-2 expansion required: exact resolved product and quantity reach the BOM", async () => {
  const env = envFor(seed({ withExpansionChain: true, requireExpansion: true }));
  const created = await post(env, command());
  const createdText = await created.text();
  assert.equal(created.status, 201, `setup write failed: ${createdText}`);

  const summary = await buildProjectBomSummary(env, { projectId: "p1", userId: "owner1" });
  assert.ok(summary.expansion, "the BOM summary must carry an expansion section");
  assert.equal(summary.expansion.status, "CALCULATED_REQUIREMENT");
  assert.equal(summary.expansion.requiredExpansionQuantity, 1);
  const loop = summary.expansion.products.find((entry) => entry.productId === "product-expander");
  assert.ok(loop, "the exact resolved loop-expander product identity must reach the BOM");
  assert.equal(loop.partNumber, "6815");
  assert.equal(loop.quantity, 1);
  assert.ok(Array.isArray(loop.provenance) && loop.provenance.length > 0, "per-panel provenance must accompany the identity");
  assert.ok(loop.provenance[0].snapshotId, "the originating sizing snapshot must be named");
  assert.ok(loop.provenance[0].snapshotFingerprint, "the snapshot fingerprint must be carried for currentness");
});

test("MVP-BOM-2 no expansion required: no expansion BOM line", async () => {
  const env = envFor(seed({ withExpansionChain: false, requireExpansion: false }));
  const created = await post(env, command());
  const createdText = await created.text();
  assert.equal(created.status, 201, `setup write failed: ${createdText}`);

  const summary = await buildProjectBomSummary(env, { projectId: "p1", userId: "owner1" });
  assert.ok(summary.expansion, "the BOM summary must carry an expansion section");
  assert.equal(summary.expansion.status, "NO_EXPANSION_REQUIRED");
  assert.equal(summary.expansion.products.length, 0, "no expansion product may appear when none is needed");
});

test("MVP-BOM-2 missing expansion identity stays blocked", async () => {
  const env = envFor(seed({ withExpansionChain: false, requireExpansion: true }));
  const response = await post(env, command());
  const text = await response.text();
  assert.equal(response.status, 409, `expected 409, got ${response.status}: ${text}`);
  const body = JSON.parse(text);
  assert.equal(body.error.code, "AMBIGUOUS_EXPANSION_RELATIONSHIP");
});
