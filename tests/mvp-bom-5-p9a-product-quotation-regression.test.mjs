/**
 * MVP-BOM-5 P9a -- restore PRODUCT quotation draft creation after migration 0015.
 *
 * Migration 0015 made `source_type` and `source_product_id` NOT NULL (with no
 * default) on `project_quotation_lines`, and left the PRODUCT writer in
 * worker/presales-workflow-api.mjs naming neither column. Every PRODUCT
 * quotation draft therefore failed at the real INSERT with
 *
 *   NOT NULL constraint failed: project_quotation_lines.source_type
 *
 * The defect was invisible to the suite because NO Node test drives
 * `quotation/draft`: the only coverage is a Playwright journey that is itself
 * blocked upstream at Quotation by PANEL_SIZING_SNAPSHOT_REQUIRED.
 *
 * This suite closes that blind spot. It builds the REAL applied migration chain
 * and drives the REAL exported route handler end to end -- `handlePresalesWorkflowApi`
 * with `operation === "quotation/draft"` -- through authentication, project
 * access, project authority, workflow readiness, canonical quotation-line
 * authority, totals reconciliation and the quotation-line INSERT. There is no
 * SQL mock anywhere in this file, and success is never inferred from a 200: every
 * generalized identity field is read back out of the inserted row.
 *
 * SCOPE is deliberately NOT exercised. `project_quotation_lines` is asserted to
 * contain exactly one line, of type PRODUCT. No SCOPE population, sequencing,
 * readiness, fingerprint generalization, totals, overlap or export change is in
 * scope here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import { handlePresalesWorkflowApi } from "../worker/presales-workflow-api.mjs";

const OWNER = "p9a-owner";
const PROJECT = "p9a-project";

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (args = []) => ({
      first: async () => raw.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
      run: async () => {
        const result = raw.prepare(sql).run(...args);
        return { ...result, meta: { changes: Number(result.changes || 0), last_insert_rowid: result.lastInsertRowid } };
      },
    });
    return { ...operation(), bind: (...args) => operation(args) };
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

const activeChain = async () => {
  const directory = new URL("../drizzle-active/", import.meta.url).pathname;
  const migrations = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=OFF");
  for (const migration of migrations) {
    const sql = await readFile(`${directory}${migration}`, "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) raw.exec(trimmed);
    }
  }
  return raw;
};

/**
 * One fully-priced, technically-approved, finally-reviewed PRODUCT BOQ item in a
 * CCTV project.
 *
 * CCTV rather than Fire Alarm is a deliberate fixture choice, not a shortcut:
 * `projectPanelSizingBlockers` returns [] immediately for a non-Fire-Alarm
 * domain, so this suite proves the 0015 defect without also depending on the
 * panel-sizing snapshot chain that another lane owns. Every OTHER prerequisite
 * is real.
 */
const seedReadyProductProject = async () => {
  const raw = await activeChain();
  const now = new Date().toISOString();

  // Schema-aware seeder. A dozen governed tables are seeded here whose exact
  // NOT NULL shape is owned by the migration chain, not by this test, so any
  // required column the caller omits is filled with a type-appropriate
  // placeholder. Every column that carries MEANING for the quotation contract
  // -- boq_item_id, candidate_id, product_id, pricing and approval references,
  // money, quantity, and the generalized source identity -- is always supplied
  // explicitly by the call site, and this helper only ever appends columns the
  // caller did not name, so a test can never accidentally assert on a value
  // this helper invented.
  const run = (sql, ...values) => {
    try { return runInner(sql, ...values); }
    catch (error) { throw new Error('SEED FAILED: ' + String(sql).slice(0, 90) + ' :: ' + error.message); }
  };
  const runInner = (sql, ...values) => {
    const match = /^INSERT\s+INTO\s+(\w+)\s*\(([^)]*)\)\s*VALUES\s*\(([\s\S]*)\)$/i.exec(sql.trim());
    if (!match) return raw.prepare(sql).run(...values);
    const table = match[1];
    const named = match[2].split(",").map((c) => c.trim()).filter(Boolean);
    const info = raw.prepare(`PRAGMA table_info(${table})`).all();
    const supplied = Object.fromEntries(named.map((c, i) => [c, values[i]]));
    // A foreign key is a REAL reference to another row. This helper must never
    // invent one, so a NOT NULL FK column the call site omitted is left absent
    // and the constraint is allowed to speak for itself.
    const foreignKeys = new Set(
      raw.prepare(`PRAGMA foreign_key_list(${table})`).all().map((fk) => fk.from),
    );
    let added = false;
    for (const column of info) {
      if (column.name in supplied) continue;
      if (!column.notnull || column.dflt_value !== null) continue;
      if (foreignKeys.has(column.name)) continue;
      const type = String(column.type || "").toLowerCase();
      supplied[column.name] = /int|real|floa|doub/.test(type) ? 0 : "{}";
      added = true;
    }
    // Only rewrite when a required column was genuinely absent. A call site that
    // already names every required column is passed through byte-for-byte, so
    // this helper can never change the shape of a deliberately-exact insert.
    if (!added) return raw.prepare(sql).run(...values);
    const names = info.map((c) => c.name).filter((n) => n in supplied);
    return raw.prepare(`INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`)
      .run(...names.map((n) => supplied[n]));
  };

  run("INSERT INTO organizations (id,name) VALUES (?,?)", "org1", "P9a Org");
  run("INSERT INTO projects (id,name,owner_user_id,organization_id,system_domain,initial_status) VALUES (?,?,?,?,?,?)",
    PROJECT, "P9a Project", OWNER, "org1", "CCTV", "Active");
  run("INSERT INTO project_members (id,project_id,user_id,role,status,granted_by,granted_at) VALUES (?,?,?,?,?,?,?)",
    "member1", PROJECT, OWNER, "Commercial Manager", "Active", OWNER, now);
  // The selected pricing scenario is a real foreign key, so the scenario must
  // exist before the dashboard profile that points at it.
  run(`INSERT INTO pricing_scenarios
    (id,project_id,name,mode,version_number,project_currency,status,assumptions,settings,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`, "scenario1", PROJECT, "Base", "Base", 1, "SAR", "Active", "[]", "{}", OWNER, now);
  run("INSERT INTO project_dashboard_profiles (project_id,selected_pricing_scenario_id,currency,client,updated_by,updated_at) VALUES (?,?,?,?,?,?)",
    PROJECT, "scenario1", "SAR", "P9a Client", OWNER, now);

  // Document + classification: documents>0 and classified==documents.
  run("INSERT INTO documents (id,project_id,logical_name,document_type,classification_source,created_by,current_version_id) VALUES (?,?,?,?,?,?,?)",
    "doc1", PROJECT, "CCTV Specification", "BOQ", "Manual", OWNER, "dv1");
  run(`INSERT INTO document_versions
    (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`, "dv1", "doc1", 1, "boq.pdf", "boq.stored", "pdf", "application/pdf", 10, "sha-dv1", "projects/boq.pdf", OWNER);
  run(`INSERT INTO classification_model_versions
    (id,classifier_version,ruleset_version,prompt_version,configuration)
    VALUES (?,?,?,?,?)`, "cmv1", "c1", "r1", "p1", "{}");
  run(`INSERT INTO document_classifications
    (id,document_id,document_version_id,model_version_id,primary_type,secondary_types,confidence,confidence_state,status,method,mixed,manual_review_required,downstream_route)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, "dc1", "doc1", "dv1", "cmv1", "BOQ", "[]", 99, "High", "Manually Confirmed", "Manual", 0, 0, "boq");

  // BOQ: one current, engineering-eligible item.
  run(`INSERT INTO boq_extraction_versions
    (id,document_id,document_version_id,version_number,status,parser_version,ruleset_version,ocr_version,created_by)
    VALUES (?,?,?,?,?,?,?,?,?)`, "bx1", "doc1", "dv1", 1, "Completed", "p1", "r1", "o1", OWNER);
  run(`INSERT INTO boq_items
    (id,extraction_version_id,project_id,source_document_id,sequence,hierarchy_depth,section_path,row_type,
     item_number,description,normalized_unit,numeric_quantity,original_quantity,
     extraction_confidence,confidence_state,review_status,source_location,original_raw_values,current_values,
     approved_for_downstream,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    "boq1", "bx1", PROJECT, "doc1", 1, 0, "1", "Item",
    "1", "CCTV camera", "EA", 4, 4,
    95, "High Confidence", "Approved", "{}", "{}", "{}", 1, now, now);

  // specificationExtractions>0.
  run(`INSERT INTO specification_extraction_versions
    (id,document_id,document_version_id,version_number,status,parser_version,ruleset_version,model_version,prompt_version,ocr_version,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`, "sx1", "doc1", "dv1", 1, "Completed", "p1", "r1", "m1", "pr1", "o1", OWNER);

  // requirement profile: Ready for Matching and approved_for_matching=1.
  run(`INSERT INTO requirement_profile_versions
    (id,project_id,boq_item_id,version_number,status,engine_version,ruleset_version,model_version,input_fingerprint,profile,explanation,readiness_status,
     approved_for_matching,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, "rpv1", PROJECT, "boq1", 1, "Current", "e1", "r1", "m1", "rpv-fp1", "{}", "fixture", "Ready for Matching", 1, OWNER, now);

  // Library product for the line's commercial identity. Inserted BEFORE the
  // match candidate, which carries a real product_id foreign key.
  run("INSERT INTO product_manufacturers (id,name,normalized_name,created_by,created_at) VALUES (?,?,?,?,?)", "mfr1", "Acme", "acme", "ingest", now);
  run(`INSERT INTO library_products (id,manufacturer_id,part_number,normalized_part_number,description,created_by,created_at,review_status,identity_status,identity_version)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, "prod1", "mfr1", "CAM-4K", "cam-4k", "4K CCTV camera", "ingest", now, "Reviewed", "Active", 1);

  // matchedItems: a current match run with candidates.
  run(`INSERT INTO product_match_runs
    (id,project_id,boq_item_id,requirement_profile_version_id,version_number,status,input_fingerprint,engine_version,ruleset_version,search_version,model_version,search_scope,summary,candidate_count,created_by,started_at,completed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, "pmr1", PROJECT, "boq1", "rpv1", 1, "Completed", "pmr-fp1", "e1", "r1", "s1", "m1", "Project", "{}", 1, OWNER, now, now);
  run("UPDATE product_match_runs SET candidate_count=1 WHERE id='pmr1'");
  run(`INSERT INTO product_match_candidates
    (id,match_run_id,product_id,rank,search_stage,score,score_components,technical_status,recommendation_tier,confidence_state,confidence_score,matching_basis,commercial_availability,explanation,mandatory_failures,lifecycle_result)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, "pmc1", "pmr1", "prod1", 1, "Recall", 1, "{}", "Eligible", "Recommended", "Resolved", 95, "Fixture", "Available", "fixture", "[]", "Active");

  // technicalApproved: a safety decision whose latest Technical approval is Approved.
  run(`INSERT INTO safety_decisions
    (id,project_id,boq_item_id,requirement_profile_version_id,match_run_id,candidate_id,version_number,input_fingerprint,safety_state,compliance_state,confidence_level,
     overall_confidence,confidence_components,technical_eligibility,price_eligibility,missing_information,provenance_status,explanation,
     engine_version,ruleset_version,model_version,recalculation_reason,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    "sd1", PROJECT, "boq1", "rpv1", "pmr1", "pmc1", 1, "sd-fp1", "Safe", "Compliant", "High", 95, "{}", "Eligible", "Eligible", "[]", "Verified", "fixture",
    "e1", "r1", "m1", "initial", OWNER, now);
  run(`INSERT INTO safety_approval_requests
    (id,project_id,safety_decision_id,approval_type,approval_level,status,requested_by,requested_role,request_reason,evidence,entity_version,ruleset_version,decided_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, "sar1", PROJECT, "sd1", "Technical", "Technical", "Approved", OWNER, "Technical Reviewer", "Approved.", "{}", 1, "r1", now, now);

  // pricedItems AND commercialApproved: one current, approved pricing line.
  run(`INSERT INTO pricing_runs
    (id,project_id,scenario_id,version_number,status,input_fingerprint,engine_version,ruleset_version,reason,locked_versions,summary,created_by,created_at,completed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, "prun1", PROJECT, "scenario1", 1, "Completed", "run-fp1", "e1", "r1", "Fixture run", "{}", "{}", OWNER, now, now);
  run(`INSERT INTO pricing_lines
    (id,pricing_run_id,project_id,boq_item_id,candidate_id,product_id,safety_decision_id,version_number,status,quantity,unit,source_currency,project_currency,
     total_cost_minor,net_selling_minor,margin_basis_points,markup_basis_points,output,explanation,approval_ready,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    "plin1", "prun1", PROJECT, "boq1", "pmc1", "prod1", "sd1", 1, "Priced", 4, "EA", "SAR", "SAR",
    4000, 10000, 0, 0, "{}", "fixture", 1, now);
  run(`INSERT INTO pricing_approvals
    (id,project_id,pricing_run_id,approval_type,status,entity_version,request_reason,evidence,requested_by,decided_by,decided_role,decision_reason,decided_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    "pa1", PROJECT, "prun1", "Commercial Price", "Approved", 1, "Reviewed.", "{}", OWNER, OWNER, "Commercial Manager", "Approved.", now, now);

  // finalReviewApproved: an approved Final Estimation Review queue item.
  run(`INSERT INTO review_queue_items
    (id,project_id,boq_item_id,review_type,priority,priority_score,severity,status,required_role,blocking,source_module,reason_for_review,required_decision,
     approval_level,safety_state,entity_version,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    "rqi1", PROJECT, "boq1", "Final Estimation Review", "High", 90, "Standard", "Approved", "Commercial Manager", 0, "Estimating", "Final review", "Approve price", 1, "Safe", 1, OWNER, now, now);

  return raw;
};

const envFor = (raw) => ({
  DB: d1(raw),
  FILES: { get: async () => null, head: async () => null },
  APP_ACCESS_MODE: "single-user",
  APP_USER_ID: OWNER,
  APP_USER_ORGANIZATION_ID: "org1",
  APP_ORGANIZATION_ID: "org1",
  APP_USER_EMAIL: "p9a@test.invalid",
  APP_USER_NAME: "P9a Owner",
});

/**
 * Schema-aware insert helper.
 *
 * This fixture seeds a dozen governed tables whose exact NOT NULL shape is owned
 * by the migration chain, not by this test. Rather than hand-listing every
 * required column and re-editing this file on every unrelated migration, any
 * NOT NULL column the caller did not supply is filled with a type-appropriate
 * placeholder. The columns that carry MEANING for the quotation contract --
 * boq_item_id, candidate_id, product_id, pricing references, approval
 * references, money, quantity, and the generalized source identity -- are always
 * supplied explicitly and are never auto-filled, so a test can never accidentally
 * assert on an auto-filled value.
 */
const draft = (raw) => handlePresalesWorkflowApi(
  new Request(`https://localhost/api/projects/${PROJECT}/presales-workflow/quotation/draft`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ vatBasisPoints: 1500, reason: "P9a PRODUCT draft regression" }),
  }),
  envFor(raw),
);

const linesOf = (raw) => raw.prepare("SELECT * FROM project_quotation_lines ORDER BY sequence,id").all();
const revisionsOf = (raw) => raw.prepare("SELECT * FROM project_quotation_revisions ORDER BY revision_number").all();

/* ------------------------------------------------------------------ *
 * Phase 1 -- red
 * ------------------------------------------------------------------ */

test("P9a the quotation-line writer names BOTH generalized PRODUCT source columns", async () => {
  // MVP-BOM-5 P9a defect-class guard.
  //
  // The red-before state, captured by executing this suite against the pre-repair
  // writer, was:
  //
  //   Error: NOT NULL constraint failed: project_quotation_lines.source_type
  //
  // reached by driving the REAL exported route handler with a fully-ready
  // PRODUCT project -- every prerequisite fact asserted satisfied first -- so the
  // failure could only be the missing generalized identity and never a missing
  // fixture row.
  //
  // A behavioural test alone cannot keep that closed, because a future writer
  // that dropped the columns again would simply fail at runtime with no suite
  // exercising the path -- which is exactly how this regression survived 0015 in
  // the first place. So the writer's own statement shape is pinned here as well:
  // migration 0015 made both columns NOT NULL with NO default, so omitting
  // either one is a guaranteed runtime failure, and that must be visible in a
  // test rather than in production.
  const source = await readFile(new URL("../worker/presales-workflow-api.mjs", import.meta.url), "utf8");
  const statement = /INSERT INTO project_quotation_lines \(([\s\S]*?)\)/.exec(source);
  assert.ok(statement, "the quotation-line INSERT must remain findable in the writer");
  const columns = statement[1].split(",").map((c) => c.trim()).filter(Boolean);
  for (const column of ["source_type", "source_product_id"]) {
    assert.ok(columns.includes(column), `the writer must name ${column}; migration 0015 made it NOT NULL with no default`);
  }
  // The generalized identity is bound, not defaulted: the writer must supply
  // both values so the 0015 CHECK is satisfied by a real value. This used to be
  // asserted with a formatting-dependent regex over the writer's source
  // (/"PRODUCT",\s*\n\s*line\.productId/), which broke the moment the module was
  // minified onto one line even though the behaviour never changed. It now
  // checks the same thing structurally: the value actually bound to source_type
  // and to source_product_id in the one INSERT the writer issues.
  const insertAt = source.indexOf("INSERT INTO project_quotation_lines");
  const bindAt = source.indexOf(".bind(", insertAt);
  const prepared = source.slice(insertAt, bindAt);
  const bindList = source.slice(source.indexOf("(", bindAt) + 1, source.indexOf(");", bindAt));
  const insertColumns = /project_quotation_lines \(([^)]*)\)/.exec(prepared)[1].split(",").map((c) => c.trim());
  // Split the bind arguments on top-level commas only, so a nested call such as
  // JSON.stringify(...) is never torn apart.
  const args = [];
  let depth = 0;
  let current = "";
  for (const character of bindList) {
    if (character === "(" || character === "[") depth += 1;
    if (character === ")" || character === "]") depth -= 1;
    if (character === "," && depth === 0) { args.push(current.trim()); current = ""; continue; }
    current += character;
  }
  if (current.trim()) args.push(current.trim());
  assert.equal(args.length, insertColumns.length, "the writer must bind exactly one value per named column");
  assert.equal(args[insertColumns.indexOf("source_type")], '"PRODUCT"', "source_type must be bound to the PRODUCT literal");
  assert.equal(args[insertColumns.indexOf("source_product_id")], "line.productId", "source_product_id must be bound to the selected product identity");
});

/* ------------------------------------------------------------------ *
 * Phase 4/5 -- green, with real schema inspection
 * ------------------------------------------------------------------ */

test("P9a a fully-ready PRODUCT project creates a quotation draft carrying truthful generalized identity", async () => {
  const raw = await seedReadyProductProject();

  const response = await draft(raw);
  const body = await response.json();
  // 201 is the route's established creation status; this slice does not change it.
  assert.equal(response.status, 201, `draft creation must succeed, got ${JSON.stringify(body)}`);

  const revisions = revisionsOf(raw);
  assert.equal(revisions.length, 1, "exactly one quotation revision");
  assert.equal(revisions[0].status, "Draft");
  assert.equal(revisions[0].revision_number, 1);

  const lines = linesOf(raw);
  assert.equal(lines.length, 1, "exactly one quotation line -- this slice must not create SCOPE lines");
  const line = lines[0];

  // Phase 5: every generalized identity field read back from the real row.
  assert.equal(line.source_type, "PRODUCT", "source_type must be the truthful PRODUCT marker");
  assert.equal(line.source_product_id, "prod1", "source_product_id must equal the selected product identity");
  assert.equal(line.source_product_id, line.product_id, "source_product_id must equal product_id for PRODUCT");

  // SCOPE-only metadata stays NULL where the schema permits it. The 0015 CHECK
  // requires this; asserting it proves nothing was faked.
  for (const column of ["engineering_scope_kind", "system", "source_role", "source_snapshot_id", "source_fingerprint"]) {
    assert.equal(line[column], null, `${column} must remain NULL for a PRODUCT line`);
  }

  // Phase 4: PRODUCT provenance unchanged.
  assert.equal(line.boq_item_id, "boq1", "boq_item_id remains populated");
  assert.equal(line.candidate_id, "pmc1", "candidate_id remains populated");
  assert.equal(line.pricing_line_id, "plin1", "pricing line reference unchanged");
  assert.equal(line.pricing_run_id, "prun1", "pricing run reference unchanged");
  assert.equal(line.pricing_run_version, 1);
  assert.equal(line.pricing_line_version, 1);
  assert.equal(line.commercial_approval_id, "pa1", "commercial approval reference unchanged");
  assert.equal(line.commercial_approval_version, 1);
  assert.equal(line.pricing_input_fingerprint, "run-fp1", "pricing fingerprint unchanged");
  assert.equal(line.manufacturer_name, "Acme");
  assert.equal(line.part_number, "CAM-4K");
  assert.equal(line.product_description, "4K CCTV camera");
  assert.equal(line.description, "CCTV camera");
  assert.equal(line.item_number, "1");
  assert.equal(line.sequence, 1, "line sequence unchanged");
  assert.equal(line.quantity, "4");
  assert.equal(line.unit, "EA");
  assert.equal(line.currency, "SAR");
  assert.equal(line.total_cost_minor, 4000);
  assert.equal(line.net_selling_minor, 10000);
  assert.equal(line.quotation_revision_id, revisions[0].id);
  assert.equal(line.project_id, PROJECT);
  assert.ok(line.source_snapshot_json && line.source_snapshot_json.length > 2, "source snapshot JSON preserved");
});

test("P9a totals and the quotation fingerprint are unchanged by the repair", async () => {
  const raw = await seedReadyProductProject();
  await draft(raw);
  const revision = revisionsOf(raw)[0];
  // The single priced line drives the revision totals exactly as before.
  assert.equal(revision.subtotal_minor, 10000, "subtotal is the PRODUCT line's net selling value");
  assert.equal(revision.vat_basis_points, 1500);
  assert.equal(revision.vat_minor, Math.round(10000 * 1500 / 10000));
  assert.equal(revision.total_minor, revision.subtotal_minor + revision.vat_minor);
  assert.ok(revision.quotation_fingerprint && revision.quotation_fingerprint.length === 64, "quotation fingerprint still produced");
  assert.ok(revision.evidence_fingerprint && revision.evidence_fingerprint.length === 64, "evidence fingerprint still produced");
});

test("P9a repeated draft creation stays idempotent under the existing contract", async () => {
  const raw = await seedReadyProductProject();
  const first = await draft(raw);
  assert.equal(first.status, 201);
  const second = await draft(raw);
  const body = await second.json();
  assert.equal(second.status, 200, "an idempotent repeat is a 200 under the existing contract");
  assert.equal(body.idempotent, true, "the existing idempotency contract is preserved");
  assert.equal(revisionsOf(raw).length, 1, "no extra revision is created");
  assert.equal(linesOf(raw).length, 1, "no duplicate line is created");
});

test("P9a the 0015 CHECK constraints still reject an invalid generalized PRODUCT row", async () => {
  const raw = await seedReadyProductProject();
  await draft(raw);
  const revision = revisionsOf(raw)[0];
  const statement = raw.prepare(`INSERT INTO project_quotation_lines
    (id,quotation_revision_id,project_id,boq_item_id,sequence,item_number,description,unit,quantity,candidate_id,product_id,manufacturer_name,part_number,product_description,
     pricing_run_id,pricing_run_version,pricing_line_id,pricing_line_version,pricing_input_fingerprint,commercial_approval_id,commercial_approval_version,
     currency,total_cost_minor,net_selling_minor,source_snapshot_json,source_type,source_product_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  const base = (id, boqItemId, candidateId, productId, sourceProductId, sourceType) => [
    id, revision.id, PROJECT, boqItemId, 99, "99", "forged", "EA", "1",
    candidateId, productId, "Acme", "X", "X", "prun1", 1, "plin1", 1, "run-fp1", "pa1", 1,
    "SAR", 0, 0, "{}", sourceType, sourceProductId,
  ];

  // A PRODUCT row that is actually SCOPE-shaped: no BOQ or candidate provenance.
  assert.throws(
    () => statement.run(...base("forged-1", null, null, "prod1", "prod1", "PRODUCT")),
    /CHECK constraint failed/,
    "a PRODUCT row without BOQ provenance must still be refused",
  );
  // A PRODUCT row whose source_product_id disagrees with product_id: the exact
  // product-substitution prohibition.
  assert.throws(
    () => statement.run(...base("forged-2", "boq1", "pmc1", "prod1", "prod-other", "PRODUCT")),
    /CHECK constraint failed/,
    "source_product_id must be constrained to product_id for PRODUCT",
  );
  // A SCOPE row missing its required engineering identity.
  assert.throws(
    () => statement.run(...base("forged-3", null, null, "prod1", "prod1", "SCOPE")),
    /CHECK constraint failed/,
    "an incomplete SCOPE row must still be refused",
  );

  assert.equal(linesOf(raw).length, 1, "no forged row is persisted");
});

test("P9a the repair creates no SCOPE line and no scope metadata anywhere", async () => {
  const raw = await seedReadyProductProject();
  await draft(raw);
  const scoped = raw.prepare("SELECT COUNT(*) count FROM project_quotation_lines WHERE source_type='SCOPE'").get();
  assert.equal(scoped.count, 0, "this slice must not create any SCOPE quotation line");
  // The generalized source identity lives on project_quotation_lines. The active
  // chain no longer carries a source_type column on pricing_lines (this
  // assertion used to query one), so the scope-metadata check runs against the
  // quotation line itself, which is where the CONTRACT states the identity.
  for (const column of ["engineering_scope_kind", "system", "source_role", "source_snapshot_id", "source_fingerprint"]) {
    const populated = raw
      .prepare(`SELECT COUNT(*) count FROM project_quotation_lines WHERE ${column} IS NOT NULL`)
      .get();
    assert.equal(populated.count, 0, `a PRODUCT line must carry no ${column} scope metadata`);
  }
  const product = raw
    .prepare("SELECT COUNT(*) count FROM project_quotation_lines WHERE source_type='PRODUCT'")
    .get();
  assert.equal(product.count, 1, "the single materialized line states its PRODUCT source identity");
});
