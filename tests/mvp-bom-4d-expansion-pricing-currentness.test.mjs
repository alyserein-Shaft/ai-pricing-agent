// MVP-BOM-4D -- repair the invalid expansion-coverage pricing-currentness query.
//
// The defect: worker/quotation-line-authority.mjs :: expansionCoverageBlockers
// queried `pricing_lines ... AND superseded_at IS NULL`, but `pricing_lines`
// has NO `superseded_at` column. The expansion coverage authority path threw
// `no such column: superseded_at` at runtime.
//
// The existing bom-001 suite does NOT catch this because its D1 double answers
// every statement generically and never validates SQL against a real schema.
// This file builds a REAL isolated database from the active migration chain, so
// the query either executes against the true schema or fails loudly.
//
// The repair reuses the canonical pricing-currentness semantics already defined
// in worker/pricing-authority.mjs (CURRENT_PRICING_PREDICATE): the run is
// non-superseded, approval_ready=1, status not in (Invalid/Expired/Rejected),
// and the run version is the MAX for that project+scenario. It is keyed on
// product_id because a SCOPE product is not a BOQ item.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { projectPanelSizingBlockers } from "../worker/quotation-line-authority.mjs";

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

// A one-panel command whose native capacity cannot serve its demand, so the
// sizing engine proves an expansion requirement. The expansion chain resolves
// to product-expander (loop) and product-rmk (mounting).
const seed = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=OFF");
  applyActiveChain(raw);

  raw.prepare("INSERT INTO organizations (id,name,owner_user_id) VALUES (?,?,?)").run("org1", "Fixture Organization", "owner1");
  raw.prepare("INSERT INTO projects (id,name,owner_user_id,organization_id,system_domain,initial_status) VALUES (?,?,?,?,?,?)")
    .run("p1", "MVP-BOM-4D project", "owner1", "org1", "Fire Alarm", "Active");
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
  // pricing_lines.boq_item_id is NOT NULL in the current schema, so the
  // expansion commercial line must still be anchored to a real BOQ line. This
  // is the exact constraint MVP-BOM-4C recorded as blocking a pure SCOPE line.
  boqItem("boq-expander", 3, "3", "SLC loop expander", 1, "Expansion", "Loop Expansion Module");
  boqItem("boq-rmk", 4, "4", "Remote mounting kit", 1, "Expansion", "Remote Mounting Kit");

  const profile = (id, boqItemId, family) => raw.prepare(`INSERT INTO requirement_profile_versions
    (id,project_id,boq_item_id,version_number,status,engine_version,ruleset_version,model_version,input_fingerprint,profile,explanation,readiness_status,confidence_summary,approved_for_matching,superseded_at,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    `profile-${id}`, "p1", boqItemId, 1, "Ready for Matching", "engine-v1", "rules-v1", "model-v1",
    `fp-${id}`, JSON.stringify({ boqItem: { id: boqItemId, system: "Fire Alarm", productFamily: family, attributes: {} } }),
    "fixture profile", "Ready", "{}", 1, null, "owner1", "now",
  );
  profile("detector", "boq-detector", "Addressable Smoke Detector");
  profile("panel", "boq-panel", "Fire Alarm Control Panel");
  profile("expander", "boq-expander", "Loop Expansion Module");
  profile("rmk", "boq-rmk", "Remote Mounting Kit");

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
  attribute("cap-panel-2", "product-panel", "max_detectors_per_loop", 100);
  attribute("cap-panel-3", "product-panel", "max_modules_per_loop", 100);
  attribute("cap-panel-4", "product-panel", "max_system_points", 500);
  attribute("cap-expander-1", "product-expander", "added_slc_loops", 1);

  const accessory = (id, productId, accessoryId, quantityParameter) => raw.prepare(`INSERT INTO product_accessories
    (id,product_id,accessory_product_id,relationship_type,quantity_rule,quantity_parameter,condition_json,included,separately_priced,source_id,evidence_json,confidence,review_status,version_number,created_by,superseded_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, productId, accessoryId, "Expansion Module", "CAPACITY_DEPENDENT -- governed project sizing", quantityParameter,
    "[]", 0, 1, "source-1", "{}", 90, "Approved", 1, "ingest", null, "now",
  );
  accessory("rel-panel-rmk", "product-panel", "product-rmk", null);
  accessory("rel-rmk-expander", "product-rmk", "product-expander", 2);

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

// The governed sizing snapshot: 50 detectors, 1 native loop x 100/loop.
// requiredTotalLoops = ceil(50/100) = 1 -> requiredAdditionalLoops = 0.
// To force expansion we use 150 detectors -> 2 loops -> 1 additional.
const SNAPSHOT_CALCULATION = {
  engineVersion: "fire-alarm-panel-sizing-snapshot-1.1.0",
  sizing: {
    status: "AUTHORITATIVE_PANEL_SIZING",
    panels: [],
    projectTotal: { requiredExpansionQuantity: 1, mountingUnitQuantity: 0, anyInsufficientEvidence: false, anyCapacityExceeded: false, anyConflict: false },
  },
  panels: [
    {
      panelId: "FACP-1",
      demand: { detectors: 150, modules: 0 },
      panelCapacity: { nativeLoops: 1, detectorsPerLoop: 100, modulesPerLoop: 100, systemPointCeiling: 500 },
      expansionOptions: {
        loopExpansionUnit: { productId: "product-expander", partNumber: "6815", loopsAddedPerUnit: 1 },
        mountingUnit: { productId: "product-rmk", partNumber: "5815RMK", capacityPerMountingUnit: 2 },
      },
      requiredAdditionalLoops: 1,
      requiredExpansionQuantity: 1,
      status: "EXPANSION_REQUIRED",
    },
  ],
};

const command = () => ({
  allocations: [{
    boqItemId: "boq-detector",
    panelId: "FACP-1",
    quantity: 150,
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

// product_match_runs is UNIQUE on (boq_item_id, version_number), so every
// fixture selection chain needs a distinct version number.
let matchRunVersionCounter = 0;
const nextMatchRunVersion = () => ++matchRunVersionCounter;

// A pricing run + line for one product, in a given state.
//
// Fully self-contained per `suffix`: it creates its own pricing scenario, match
// run, candidate, safety decision, pricing run and pricing line. The real
// schema enforces NOT NULL foreign keys that a sizing-derived product has no
// governed selection chain for in the base fixture:
//   pricing_runs.scenario_id         -> pricing_scenarios(id)        NOT NULL
//   pricing_lines.boq_item_id        -> boq_items(id)                NOT NULL
//   pricing_lines.candidate_id       -> product_match_candidates(id) NOT NULL
//   pricing_lines.safety_decision_id -> safety_decisions(id)         NOT NULL
// The expansion line is therefore anchored to its own expansion BOQ line, which
// is precisely the constraint MVP-BOM-4C recorded as blocking a pure SCOPE line.
//
// NOTE pricing_runs is UNIQUE on (scenario_id, version_number): one scenario
// version is ONE run holding MANY lines. `lines` therefore takes a list of
// {productId, status, approvalReady} so a test can price several products in a
// single current run, which is how real pricing output is shaped.
const BOQ_ITEM_FOR_PRODUCT = {
  "product-expander": "boq-expander",
  "product-rmk": "boq-rmk",
  "product-panel": "boq-panel",
};

const seedPricing = (raw, {
  lines,
  runVersion = 1,
  suffix = "1",
  runSupersededAt = null,
  scenarioId = null,
  runStatus = "Completed",
} = {}) => {
  const scenarioIdFinal = scenarioId ?? `scenario-${suffix}`;
  // A shared scenario may already exist from an earlier call in the same test.
  if (!raw.prepare("SELECT id FROM pricing_scenarios WHERE id=?").get(scenarioIdFinal)) {
    raw.prepare(`INSERT INTO pricing_scenarios
      (id,project_id,name,mode,version_number,project_currency,status,assumptions,settings,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      scenarioIdFinal, "p1", `Fixture scenario ${scenarioIdFinal}`, "Base", 1, "SAR", "Active", "[]", "{}", "owner1", "now",
    );
  }
  const runId = `pr-${suffix}`;
  raw.prepare(`INSERT INTO pricing_runs
    (id,project_id,scenario_id,version_number,status,input_fingerprint,engine_version,ruleset_version,reason,locked_versions,summary,created_by,created_at,completed_at,superseded_at,error_code,error_message)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    runId, "p1", scenarioIdFinal, runVersion, runStatus, `run-fp-${suffix}`, "engine-v1", "rules-v1",
    `Fixture run ${suffix}`, "{}", "{}", "owner1", "now", "now", runSupersededAt, null, null,
  );

  lines.forEach(({ productId, status = "Approved", approvalReady = 1 }, i) => {
    const tag = `${suffix}-${i}`;
    const boqItemId = BOQ_ITEM_FOR_PRODUCT[productId] ?? "boq-panel";
    const profileId = `profile-${boqItemId.replace(/^boq-/, "")}`;
    const matchRunId = `pmr-${tag}`;
    const candidateId = `pmc-${tag}`;
    const safetyId = `sd-${tag}`;

    raw.prepare(`INSERT INTO product_match_runs
      (id,project_id,boq_item_id,requirement_profile_version_id,version_number,status,input_fingerprint,engine_version,ruleset_version,search_version,model_version,search_scope,summary,created_by,started_at,completed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      matchRunId, "p1", boqItemId, profileId, nextMatchRunVersion(), "Completed", `fp-pmr-${tag}`,
      "engine-v1", "rules-v1", "search-v1", "model-v1", "Project", "{}", "owner1", "now", "now",
    );
    raw.prepare(`INSERT INTO product_match_candidates
      (id,match_run_id,product_id,rank,search_stage,score,score_components,technical_status,recommendation_tier,confidence_state,confidence_score,matching_basis,commercial_availability,explanation,mandatory_failures,lifecycle_result)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      candidateId, matchRunId, productId, 1, "Recall", 1, "{}", "Eligible", "Recommended", "Resolved", 95,
      "Fixture", "Available", "fixture", "[]", "Active",
    );
    raw.prepare(`INSERT INTO safety_decisions
      (id,project_id,boq_item_id,requirement_profile_version_id,match_run_id,candidate_id,version_number,input_fingerprint,safety_state,compliance_state,confidence_level,overall_confidence,confidence_components,technical_eligibility,price_eligibility,missing_information,provenance_status,explanation,engine_version,ruleset_version,model_version,recalculation_reason,created_by,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      safetyId, "p1", boqItemId, profileId, matchRunId, candidateId, 1, `fp-sd-${tag}`,
      "Safe", "Compliant", "High", 95, "{}", "Eligible", "Eligible", "[]", "Verified", "fixture",
      "engine-v1", "rules-v1", "model-v1", "initial", "owner1", "now",
    );
    raw.prepare(`INSERT INTO pricing_lines
      (id,pricing_run_id,project_id,boq_item_id,candidate_id,product_id,safety_decision_id,selected_price_record_id,version_number,status,quantity,unit,source_currency,project_currency,original_list_price_minor,net_material_unit_minor,material_total_minor,direct_cost_minor,total_cost_minor,gross_selling_minor,customer_discount_minor,net_selling_minor,vat_minor,final_value_minor,margin_basis_points,markup_basis_points,output,explanation,approval_ready,created_at,source_type,engineering_scope_kind,system,source_role,source_snapshot_id,source_fingerprint,source_product_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      `pl-${tag}`, runId, "p1", boqItemId, candidateId, productId, safetyId, null, 1, status, 1, "EA", "SAR", "SAR",
      100, 100, 100, 100, 100, 100, 0, 100, 0, 100, 0, 0, "{}", "fixture", approvalReady, "now",
      "PRODUCT", null, null, null, null, null, productId,
    );
  });
};

const envFor = (raw) => ({
  DB: {
    prepare(sql) {
      const operation = (values = []) => ({
        first: async () => raw.prepare(sql).get(...values) ?? null,
        all: async () => ({ results: raw.prepare(sql).all(...values) }),
        run: async () => raw.prepare(sql).run(...values),
      });
      return { ...operation(), bind: (...values) => operation(values) };
    },
    async batch(statements) { raw.exec("BEGIN IMMEDIATE"); try { const r = []; for (const s of statements) { r.push(await s.run()); } raw.exec("COMMIT"); return r; } catch (e) { raw.exec("ROLLBACK"); throw e; } },
  },
  APP_ACCESS_MODE: "single-user",
  APP_USER_ID: "owner1",
  APP_USER_ORGANIZATION_ID: "org1",
  APP_ORGANIZATION_ID: "org1",
  APP_USER_EMAIL: "owner@test.invalid",
  APP_USER_NAME: "Fixture Owner",
});

const writeSnapshot = (raw) => raw.prepare(`INSERT INTO fire_alarm_panel_sizing_snapshots
  (id,project_id,version_number,input_fingerprint,engine_version,status,input_json,calculation_json,dossier_json,reason,created_by,created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
  "ps-1", "p1", 1, "snap-fp-v1", "engine-v1", "COMPLETED", JSON.stringify(command()), JSON.stringify(SNAPSHOT_CALCULATION), "{}", "Fixture snapshot", "owner1", "now",
);

// The governed snapshot requires TWO distinct expansion product identities:
// the loop expander and the mounting kit. Full coverage therefore needs a
// current approved line for each of them.
const REQUIRED_PRODUCTS = ["product-expander", "product-rmk"];

// One current pricing run holding an approved line for every required product.
const coverAll = (raw, { runVersion = 1, suffix = "a", ...rest } = {}) =>
  seedPricing(raw, {
    runVersion, suffix, ...rest,
    lines: REQUIRED_PRODUCTS.map((productId) => ({ productId, status: "Approved", approvalReady: 1 })),
  });

test("MVP-BOM-4D the expansion coverage query executes against the real schema", async () => {
  const raw = seed();
  writeSnapshot(raw);
  // No pricing line for any expansion product: the query must run and the
  // blocker must stay. Before the repair this threw `no such column:
  // superseded_at` and the coverage check could not be evaluated at all.
  const blockers = await projectPanelSizingBlockers(envFor(raw).DB, "p1");
  assert.ok(Array.isArray(blockers), "the coverage check must execute without a schema error");
  assert.deepEqual(blockers, ["PANEL_SIZING_EXPANSION_REQUIRED"]);
});

test("MVP-BOM-4D a stale pricing version does not count as coverage", async () => {
  const raw = seed();
  writeSnapshot(raw);
  // Run 1 holds approved lines for both required products. Run 2, the later
  // version of the same scenario, holds Draft lines for the same products.
  // Under the canonical currentness semantics the LATEST line for a source is
  // current, so run 1's approved lines are stale and coverage stays blocked.
  coverAll(raw, { runVersion: 1, suffix: "a", scenarioId: "scenario-stale" });
  seedPricing(raw, {
    runVersion: 2, suffix: "b", scenarioId: "scenario-stale",
    lines: REQUIRED_PRODUCTS.map((productId) => ({ productId, status: "Draft Price", approvalReady: 0 })),
  });
  const blockers = await projectPanelSizingBlockers(envFor(raw).DB, "p1");
  assert.deepEqual(blockers, ["PANEL_SIZING_EXPANSION_REQUIRED"], "an older run version must not satisfy current coverage");
});

test("MVP-BOM-4D a superseded pricing run does not count as coverage", async () => {
  const raw = seed();
  writeSnapshot(raw);
  // The approved lines live only in a run that has itself been superseded, and
  // the later run of the scenario does not price the expansion products.
  coverAll(raw, { runVersion: 1, suffix: "a", scenarioId: "scenario-sup", runSupersededAt: "2026-01-02T00:00:00.000Z" });
  seedPricing(raw, {
    runVersion: 2, suffix: "b", scenarioId: "scenario-sup",
    lines: [{ productId: "product-panel", status: "Approved", approvalReady: 1 }],
  });
  const blockers = await projectPanelSizingBlockers(envFor(raw).DB, "p1");
  assert.deepEqual(blockers, ["PANEL_SIZING_EXPANSION_REQUIRED"], "a superseded run must not satisfy coverage");
});

test("MVP-BOM-4D current but not-yet-eligible pricing does not count as coverage", async () => {
  const raw = seed();
  writeSnapshot(raw);
  // Current latest version, but approval_ready=0 and not Approved.
  seedPricing(raw, {
    runVersion: 1, suffix: "a",
    lines: REQUIRED_PRODUCTS.map((productId) => ({ productId, status: "Draft Price", approvalReady: 0 })),
  });
  const blockers = await projectPanelSizingBlockers(envFor(raw).DB, "p1");
  assert.deepEqual(blockers, ["PANEL_SIZING_EXPANSION_REQUIRED"], "approval_ready=0 must not satisfy coverage");
});

test("MVP-BOM-4D a rejected, expired or invalid current line does not count as coverage", async () => {
  for (const status of ["Rejected", "Expired", "Invalid"]) {
    const raw = seed();
    writeSnapshot(raw);
    seedPricing(raw, {
      runVersion: 1, suffix: "a",
      lines: REQUIRED_PRODUCTS.map((productId) => ({ productId, status, approvalReady: 1 })),
    });
    const blockers = await projectPanelSizingBlockers(envFor(raw).DB, "p1");
    assert.deepEqual(blockers, ["PANEL_SIZING_EXPANSION_REQUIRED"], `status ${status} must not satisfy coverage`);
  }
});

test("MVP-BOM-4D current approved exact-product coverage counts", async () => {
  const raw = seed();
  writeSnapshot(raw);
  coverAll(raw, { runVersion: 1, suffix: "a" });
  const blockers = await projectPanelSizingBlockers(envFor(raw).DB, "p1");
  assert.deepEqual(blockers, [], "current approved lines for every required product clear the blocker");
});

test("MVP-BOM-4D partial required-product coverage stays blocked", async () => {
  const raw = seed();
  writeSnapshot(raw);
  // Only the loop expander is covered; the mounting kit is not.
  seedPricing(raw, {
    runVersion: 1, suffix: "a",
    lines: [{ productId: "product-expander", status: "Approved", approvalReady: 1 }],
  });
  const blockers = await projectPanelSizingBlockers(envFor(raw).DB, "p1");
  assert.deepEqual(blockers, ["PANEL_SIZING_EXPANSION_REQUIRED"], "covering one of two required products must stay blocked");
});

test("MVP-BOM-4D coverage for a different product identity does not count", async () => {
  const raw = seed();
  writeSnapshot(raw);
  // Approved and current, but for the panel product rather than an expansion
  // product. Identity is exact; a different product never covers.
  seedPricing(raw, {
    runVersion: 1, suffix: "a",
    lines: [{ productId: "product-panel", status: "Approved", approvalReady: 1 }],
  });
  const blockers = await projectPanelSizingBlockers(envFor(raw).DB, "p1");
  assert.deepEqual(blockers, ["PANEL_SIZING_EXPANSION_REQUIRED"], "a non-expansion product must not satisfy expansion coverage");
});
