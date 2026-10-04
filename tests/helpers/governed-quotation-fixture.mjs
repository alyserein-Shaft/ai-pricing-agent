/**
 * Shared isolated fixture for the governed quotation and export suites.
 *
 * Builds an in-memory SQLite from the REAL applied migration chain
 * (drizzle-active), seeds the smallest valid governed project the quotation
 * path accepts, and exposes the real route handlers over a D1 shim. Nothing
 * here bypasses an authority function, patches DDL, or touches any real
 * database: every schema object comes from the chain itself.
 */
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import { handlePresalesWorkflowApi } from "../../worker/presales-workflow-api.mjs";
export const OWNER = "p9a-owner";
export const PROJECT = "p9a-project";

export const d1 = (raw) => ({
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

/**
 * The tables the governed quotation lifecycle writes and reads. Migration 0019
 * DROPs every one of them (project_quotation_revisions, _lines, _decisions,
 * _issues, excel_export_jobs) and never recreates them, so they are carried into
 * the fixture from the chain's own last definition of them. See activeChain.
 */
/**
 * The isolated database for the governed quotation acceptance suite: the REAL
 * drizzle-active migration chain, applied from zero to head with NO fixture
 * surgery of any kind.
 *
 * There is deliberately no repair, retry, skip, carry-forward or DDL patching
 * here. Every statement is executed exactly once and the first failure is
 * reported verbatim with its migration file and statement index, so this suite
 * cannot pass against a schema the chain does not actually produce:
 *
 *   MIGRATION_CHAIN_FRESH_APPLY = PASS is asserted below by `activeChain`, which
 *   throws `MIGRATION_CHAIN_FRESH_APPLY = FAIL` naming the offending statement.
 *
 * Migrations are applied in filename order, statement by statement on
 * `--> statement-breakpoint`, which is how a D1 migrator executes them. The
 * applier holds no opinion about which statements "should" work: the chain is
 * the only source of truth, and a defect in it fails the quotation suite loudly
 * instead of being papered over locally.
 */
export const activeChain = async () => {
  const directory = new URL("../../drizzle-active/", import.meta.url).pathname;
  const migrations = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=OFF");
  let applied = 0;
  for (const migration of migrations) {
    const sql = await readFile(`${directory}${migration}`, "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (!trimmed) continue;
      applied += 1;
      try {
        raw.exec(trimmed);
      } catch (error) {
        throw new Error(
          `MIGRATION_CHAIN_FRESH_APPLY = FAIL: ${migration} statement #${applied} ` +
            `(${trimmed.replace(/\s+/g, " ").slice(0, 120)}) :: ${error.message}`,
        );
      }
    }
  }
  return raw;
};

/**
 * The governed quotation contract in the migrated schema. These assertions run
 * against the chain's own output, so they fail if the chain ever stops
 * providing what the single writer and the issue gate require.
 */
export const assertQuotationSchemaContract = (raw) => {
  const tableExists = (name) =>
    Boolean(raw.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  for (const table of [
    "presales_workflow_snapshots",
    "project_quotation_revisions",
    "project_quotation_lines",
    "project_quotation_decisions",
    "project_quotation_issues",
    "excel_export_jobs",
    "export_templates",
    "boq_quantity_source_decisions",
    "drawing_quantity_evidence_coverage",
    "estimator_understanding_review_versions",
    "fire_alarm_panel_sizing_snapshots",
    "project_npq_profile_versions",
    "project_npq_profile_events",
    // Read by collectProjectFacts, which the quotation draft path calls.
    "pricing_runs",
    "pricing_lines",
    "pricing_approvals",
    "projects",
    "library_products",
    "product_match_candidates",
  ]) {
    if (!tableExists(table)) throw new Error(`QUOTATION SCHEMA INCOMPLETE: missing table ${table}`);
  }

  // Every column the one quotation-line writer inserts.
  const lineColumns = new Set(
    raw.prepare("PRAGMA table_info(project_quotation_lines)").all().map((column) => column.name),
  );
  for (const column of [
    "quotation_revision_id",
    "boq_item_id",
    "product_id",
    "source_type",
    "source_product_id",
    "pricing_run_id",
    "pricing_run_version",
    "pricing_line_id",
    "pricing_line_version",
    "pricing_input_fingerprint",
    "commercial_approval_id",
    "commercial_approval_version",
    "currency",
    "total_cost_minor",
    "net_selling_minor",
    "source_snapshot_json",
  ]) {
    if (!lineColumns.has(column)) throw new Error(`QUOTATION LINE COLUMN MISSING: ${column}`);
  }
  // The 0015 identity constraints must still be fail closed: NOT NULL, no
  // default, so a line cannot materialize without a truthful product identity.
  for (const name of ["source_type", "source_product_id"]) {
    const column = raw
      .prepare("PRAGMA table_info(project_quotation_lines)")
      .all()
      .find((candidate) => candidate.name === name);
    if (!column.notnull || column.dflt_value !== null) {
      throw new Error(`QUOTATION IDENTITY CONSTRAINT WEAKENED: ${name}`);
    }
  }

  // The export-to-quotation binding the issue gate reads.
  const exportColumns = new Set(
    raw.prepare("PRAGMA table_info(excel_export_jobs)").all().map((column) => column.name),
  );
  for (const column of [
    "quotation_revision_id",
    "quotation_fingerprint",
    "evidence_fingerprint",
    "export_mode",
    "status",
    "stage",
    "cancelled_at",
    "superseded_by_id",
  ]) {
    if (!exportColumns.has(column)) throw new Error(`EXPORT BINDING COLUMN MISSING: ${column}`);
  }

  // The fail-closed governance constraints the quotation chain depends on must
  // survive the chain, not be simplified away to make a migration apply.
  for (const object of [
    "projects_operational_scope_idx",
    "projects_declared_calendar_guard",
    "projects_declared_calendar_guard_update",
    "review_decisions_immutable_update",
    "review_decisions_immutable_delete",
  ]) {
    if (!raw.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(object)) {
      throw new Error(`GOVERNANCE OBJECT MISSING AFTER CHAIN: ${object}`);
    }
  }
};

export const seedReadyProductProject = async () => {
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
  // `effective_from` is absent by design: migration 0019 drops it (together with
  // `effective_to` and `drawing_status`), and this fixture seeds the real
  // migrated schema rather than a hand-patched one.
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
  // NOTE: `product_role` is deliberately absent. The P9a seeder this fixture
  // was copied from still names it, but migration 0019 rebuilds
  // library_products without that column, so the copied insert can no longer
  // apply to the current chain. Every identity column the quotation contract
  // depends on is still supplied explicitly.
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
  // The material cost columns the governed export reads through `l.*` carry
  // real values, consistent with total_cost_minor / net_selling_minor. Without a
  // material unit cost every export row reports "Missing Price", which fails
  // APPROVED_EXPORT_WARNINGS_BLOCKED for a governed export -- so this is what
  // makes the export -> issue pipeline provable. It is fixture data, not a change
  // to any pricing readiness rule.
  run(`INSERT INTO pricing_lines
    (id,pricing_run_id,project_id,boq_item_id,candidate_id,product_id,safety_decision_id,version_number,status,quantity,unit,source_currency,project_currency,
     original_list_price_minor,net_material_unit_minor,material_total_minor,direct_cost_minor,total_cost_minor,gross_selling_minor,customer_discount_minor,net_selling_minor,vat_minor,final_value_minor,
     margin_basis_points,markup_basis_points,output,explanation,approval_ready,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    "plin1", "prun1", PROJECT, "boq1", "pmc1", "prod1", "sd1", 1, "Priced", 4, "EA", "SAR", "SAR",
    4500, 1000, 4000, 4000, 4000, 10000, 0, 10000, 1500, 11500,
    0, 0, "{}", "fixture", 1, now);
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

  // The fixture must run against the REAL applied chain with zero surgery: every
  // table, column, constraint and governance object the quotation contract needs
  // must be present in the schema the chain itself produces.
  assertQuotationSchemaContract(raw);

  return raw;
};

/**
 * In-memory R2-shaped storage, one per isolated database, so a handler that
 * writes an object and a later request that reads it see the same store --
 * exactly like a real binding. Nothing leaves the process and no real bucket is
 * ever contacted.
 */
const storages = new WeakMap();
const filesFor = (raw) => {
  if (!storages.has(raw)) storages.set(raw, new Map());
  const objects = storages.get(raw);
  return {
    async put(key, bytes) { objects.set(key, bytes); return { key }; },
    async get(key) {
      if (!objects.has(key)) return null;
      return {
        body: objects.get(key),
        httpMetadata: { contentType: "application/octet-stream" },
        customMetadata: {},
      };
    },
    async head(key) { return objects.has(key) ? { key, size: Number(objects.get(key).byteLength || 0) } : null; },
  };
};

/** The objects a handler stored through the in-memory R2 binding, for assertions. */
export const storedObjects = (raw) => [...(storages.get(raw)?.entries() || [])];

export const envFor = (raw) => ({
  DB: d1(raw),
  FILES: filesFor(raw),
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
export const draft = (raw) => handlePresalesWorkflowApi(
  new Request(`https://localhost/api/projects/${PROJECT}/presales-workflow/quotation/draft`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ vatBasisPoints: 1500, reason: "P9a PRODUCT draft regression" }),
  }),
  envFor(raw),
);

export const linesOf = (raw) => raw.prepare("SELECT * FROM project_quotation_lines ORDER BY sequence,id").all();
export const revisionsOf = (raw) => raw.prepare("SELECT * FROM project_quotation_revisions ORDER BY revision_number").all();

/* ------------------------------------------------------------------ *
 * Governed-path request helpers -- identical routing to the draft call
 * above, only the operation and payload differ. No handler is called
 * directly and no authority function is stubbed.
 * ------------------------------------------------------------------ */

export const REASON = "Governed acceptance pass";
export const post = (raw, operation, payload) =>
  handlePresalesWorkflowApi(
    new Request(`https://localhost/api/projects/${PROJECT}/presales-workflow/${operation}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
    envFor(raw),
  );

export const draftRevision = (raw) => revisionsOf(raw)[0];
export const decisionsOf = (raw) =>
  raw.prepare("SELECT * FROM project_quotation_decisions ORDER BY rowid").all();
export const issuesOf = (raw) => raw.prepare("SELECT * FROM project_quotation_issues ORDER BY id").all();
export const jobsOf = (raw) => raw.prepare("SELECT * FROM excel_export_jobs ORDER BY id").all();

// The governed export prerequisite, satisfied ONLY inside this isolated
// fixture and only through the real contract read by
// app/domain/quotation-authority.mjs#exportEligibleForQuotationIssue: same
// project, Completed, a governed export mode, not cancelled, not superseded,
// and bound to this exact quotation revision, quotation fingerprint and
// current evidence fingerprint.
export const seedGovernedExport = async (raw, revision, { status = "Completed", exportMode = "Approved Cost Sheet" } = {}) => {
  raw
    .prepare(
      `INSERT INTO export_templates (id,organization_id,name,version,status,supported_modes,sheet_configuration,branding,formula_strategy,mapping_version,created_by,created_at)
       VALUES ('etpl1','org1','Acceptance Template','1','Active','["Approved Cost Sheet"]','{}','{}','Values',1,?,'2026-01-01T00:00:00.000Z')`,
    )
    .run(OWNER);
  raw
    .prepare(
      `INSERT INTO excel_export_jobs
        (id,project_id,template_id,export_mode,revision,filename,status,stage,progress,locked_versions,sheet_set,configuration,warning_count,blocking_issue_count,idempotency_key,requested_by,requested_role,requested_at,completed_at,quotation_revision_id,quotation_fingerprint,evidence_fingerprint)
       VALUES ('export1',?,'etpl1',?,1,'quotation.xlsx',?,'Completed',100,'{}','{}','{}',0,0,'idem-1',?,'Project User','2026-01-01T00:00:00.000Z','2026-01-01T00:05:00.000Z',?,?,?)`,
    )
    .run(PROJECT, exportMode, status, OWNER, revision.id, revision.quotation_fingerprint, revision.evidence_fingerprint);
  return jobsOf(raw)[0];
};

export const json = async (response) => JSON.parse(await response.text());

/* ------------------------------------------------------------------ *
 * A. draft -- one revision, one decision, one line, full provenance
 * ------------------------------------------------------------------ */
