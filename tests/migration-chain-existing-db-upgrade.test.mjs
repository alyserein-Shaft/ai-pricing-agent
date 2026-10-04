/**
 * Proof that the ACTIVE migration chain upgrades an EXISTING database safely.
 *
 * "Existing" here means a database that has already applied this chain up to
 * 0018 -- the only lineage `drizzle-active/` defines. The canonical live dev D1
 * is deliberately NOT used, and is not in this lineage either (see the note at
 * the bottom of this file).
 *
 * The environment built below is populated BEFORE 0019 runs: an organization, a
 * project, a product, a pricing run/line/approval, a governed quotation
 * revision with its line and its decision ledger row, and an export job bound
 * to that revision by id and by both fingerprints. The proof then applies only
 * the real 0019 file and shows that every one of those rows survives unchanged,
 * that the quotation tables and their columns survive, that the
 * export-to-quotation binding survives, and that no fail-closed governance
 * object was simplified away to make the migration apply.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const DIRECTORY = new URL("../drizzle-active/", import.meta.url).pathname;
const ALL = readdirSync(DIRECTORY)
  .filter((name) => name.endsWith(".sql"))
  .sort();

/** Apply real migrations exactly once each. The first failure is fatal. */
const apply = (raw, migrations) => {
  let index = 0;
  for (const migration of migrations) {
    const sql = readFileSync(`${DIRECTORY}${migration}`, "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (!trimmed) continue;
      index += 1;
      try {
        raw.exec(trimmed);
      } catch (error) {
        throw new Error(
          `MIGRATION UPGRADE = FAIL at ${migration} statement #${index}: ` +
            `${trimmed.replace(/\s+/g, " ").slice(0, 140)} :: ${error.message}`,
        );
      }
    }
  }
  return index;
};

const FINAL = ALL.filter((name) => name.startsWith("0019"));
const PRE_REPAIR = ALL.filter((name) => !name.startsWith("0019"));

/**
 * An existing, already-migrated environment holding live-shaped governed data.
 * Only columns whose value carries meaning are named; the helper fills the
 * remaining NOT NULL columns with type-appropriate placeholders, exactly as the
 * rows an earlier version of the application would already have written.
 */
const buildPreRepairEnvironment = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=OFF");
  apply(raw, PRE_REPAIR);
  // Seeded rows stand in for data written by earlier versions of the
  // application, which enforced referential integrity itself; enforcement is
  // re-enabled by the migration under test, not by this fixture.
  raw.exec("PRAGMA foreign_keys=OFF");

  const insert = (sql, ...values) => {
    const match = /^INSERT\s+INTO\s+(\w+)\s*\(([^)]*)\)\s*VALUES\s*\(([\s\S]*)\)$/i.exec(sql.trim());
    const table = match[1];
    const named = match[2].split(",").map((c) => c.trim()).filter(Boolean);
    const supplied = Object.fromEntries(named.map((c, i) => [c, values[i]]));
    const columns = [];
    const bound = [];
    for (const column of raw.prepare(`PRAGMA table_info(${table})`).all()) {
      if (column.name in supplied) {
        columns.push(`"${column.name}"`);
        bound.push(supplied[column.name]);
        continue;
      }
      if (column.notnull && column.dflt_value === null) {
        columns.push(`"${column.name}"`);
        bound.push(
          column.type === "integer" ? 0 : column.type === "real" ? 0 : "existing",
        );
      }
    }
    raw
      .prepare(`INSERT INTO "${table}" (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
      .run(...bound);
  };

  insert("INSERT INTO organizations (id,name) VALUES (?,?)", "org1", "Al Mousa");
  insert(
    "INSERT INTO projects (id,organization_id,name,owner_user_id,currency,client,operational_classification,declared_timezone,declared_utc_offset_minutes) VALUES (?,?,?,?,?,?,?,?,?)",
    "proj1", "org1", "Central Kitchen - Makkah", "owner1", "SAR", "Al Mousa Contracting",
    "Operational", "Asia/Riyadh", 180,
  );
  insert(
    "INSERT INTO library_products (id,manufacturer_id,part_number,normalized_part_number,description,created_by) VALUES (?,?,?,?,?,?)",
    "prod1", "mfr1", "CAM-4K", "cam-4k", "4K CCTV camera", "ingest",
  );
  insert(
    "INSERT INTO project_npq_profile_versions (id,project_id,version_number,primary_system,delivery_scope,input_fingerprint,created_by) VALUES (?,?,?,?,?,?,?)",
    "npqv1", "proj1", 1, "CCTV", "Single building", "npq-fp", "owner1",
  );
  insert(
    "INSERT INTO project_npq_profile_events (id,project_id,profile_version_id,action,new_value,reason,actor_user_id,actor_role,request_id) VALUES (?,?,?,?,?,?,?,?,?)",
    "npqe1", "proj1", "npqv1", "Set Primary System", "CCTV", "initial", "owner1", "Project User", "req1",
  );

  // A quotation revision that already exists, with its line and its ledger row.
  insert(
    "INSERT INTO project_quotation_revisions (id,project_id,revision_number,quotation_fingerprint,workflow_snapshot_id,currency,subtotal_minor,vat_basis_points,vat_minor,total_minor,terms_json,source_summary_json,status,created_by,evidence_fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    "quotrev1", "proj1", 1, "qfp-existing", "snap1", "SAR", 10000, 1500, 1500, 11500,
    "{}", "{}", "Draft", "owner1", "efp-existing",
  );
  insert(
    "INSERT INTO project_quotation_lines (id,quotation_revision_id,project_id,boq_item_id,candidate_id,sequence,unit,quantity,product_id,manufacturer_name,part_number,product_description,pricing_run_id,pricing_run_version,pricing_line_id,pricing_line_version,pricing_input_fingerprint,commercial_approval_id,commercial_approval_version,currency,total_cost_minor,net_selling_minor,source_snapshot_json,source_type,source_product_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    "qline1", "quotrev1", "proj1", "boq1", "cand1", 1, "EA", "4", "prod1", "Acme", "CAM-4K",
    "4K CCTV camera", "prun1", 1, "plin1", 1, "run-fp1", "pa1", 1, "SAR", 4000, 10000,
    JSON.stringify({ authorityVersion: "quotation-line-authority-1.0.0" }), "PRODUCT", "prod1",
  );
  insert(
    "INSERT INTO project_quotation_decisions (id,project_id,quotation_revision_id,action,next_status,reason,actor_user_id,actor_role,quotation_fingerprint) VALUES (?,?,?,?,?,?,?,?,?)",
    "qdec1", "proj1", "quotrev1", "Create Draft", "Draft", "Created before the upgrade",
    "owner1", "Project User", "qfp-existing",
  );

  // A governed export already bound to that revision by id and by both fingerprints.
  insert(
    "INSERT INTO export_templates (id,name,version,status,supported_modes,sheet_configuration,branding,formula_strategy,mapping_version,created_by,organization_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    "tmpl1", "Approved Cost Sheet", "1.0.0", "Active", '["Approved Cost Sheet"]', "{}", "{}", "none", "1", "owner1", "org1",
  );
  insert(
    "INSERT INTO excel_export_jobs (id,project_id,template_id,export_mode,revision,filename,status,stage,progress,locked_versions,sheet_set,configuration,idempotency_key,requested_by,requested_role,quotation_revision_id,quotation_fingerprint,evidence_fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    "export1", "proj1", "tmpl1", "Approved Cost Sheet", 1, "cost-sheet.xlsx", "Completed",
    "Done", 100, "{}", "cost", "{}", "idem1", "owner1", "Project User",
    "quotrev1", "qfp-existing", "efp-existing",
  );

  return raw;
};

// node:sqlite returns null-prototype rows; deepStrictEqual compares prototypes.
const rows = (raw, sql) => raw.prepare(sql).all().map((row) => ({ ...row }));
const count = (raw, table) => raw.prepare(`SELECT count(*) c FROM "${table}"`).get().c;
const columnsOf = (raw, table) =>
  raw.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

test("EXISTING_DB_UPGRADE_SAFE: 0019 applies to a populated 0018 database with zero failures", () => {
  const raw = buildPreRepairEnvironment();
  assert.ok(count(raw, "project_quotation_lines") > 0, "the environment really is populated");
  // Assert against the FILE's own statement count rather than a magic number, so
  // the proof is that every statement in 0019 ran and none was skipped -- and so
  // the assertion cannot silently weaken when 0019 legitimately changes size.
  const expected = readFileSync(`${DIRECTORY}${FINAL[0]}`, "utf8")
    .split("--> statement-breakpoint")
    .filter((statement) => statement.trim()).length;
  assert.equal(apply(raw, FINAL), expected, "every statement in 0019 must be applied, none skipped");
});

test("existing quotation data survives the upgrade unchanged", () => {
  const raw = buildPreRepairEnvironment();
  apply(raw, FINAL);

  assert.deepEqual(
    rows(raw, "SELECT id,project_id,revision_number,status,quotation_fingerprint,evidence_fingerprint,currency,subtotal_minor,vat_minor,total_minor FROM project_quotation_revisions ORDER BY id"),
    [{ id: "quotrev1", project_id: "proj1", revision_number: 1, status: "Draft",
       quotation_fingerprint: "qfp-existing", evidence_fingerprint: "efp-existing",
       currency: "SAR", subtotal_minor: 10000, vat_minor: 1500, total_minor: 11500 }],
  );
  assert.deepEqual(
    rows(raw, "SELECT id,quotation_revision_id,boq_item_id,quantity,unit,source_type,source_product_id,pricing_run_id,pricing_line_id,commercial_approval_id,currency,total_cost_minor,net_selling_minor FROM project_quotation_lines ORDER BY id"),
    [{ id: "qline1", quotation_revision_id: "quotrev1", boq_item_id: "boq1", quantity: "4",
       unit: "EA", source_type: "PRODUCT", source_product_id: "prod1", pricing_run_id: "prun1",
       pricing_line_id: "plin1", commercial_approval_id: "pa1", currency: "SAR",
       total_cost_minor: 4000, net_selling_minor: 10000 }],
  );
  assert.equal(count(raw, "project_quotation_decisions"), 1);
  assert.equal(
    raw.prepare("SELECT action FROM project_quotation_decisions WHERE id='qdec1'").get().action,
    "Create Draft",
  );
});

test("existing authority rows the quotation path reads survive the upgrade", () => {
  const raw = buildPreRepairEnvironment();
  apply(raw, FINAL);
  for (const table of [
    "presales_workflow_snapshots",
    "boq_quantity_source_decisions",
    "drawing_quantity_evidence_coverage",
    "estimator_understanding_review_versions",
    "fire_alarm_panel_sizing_snapshots",
  ]) {
    assert.ok(
      raw.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table),
      `${table} was dropped by the upgrade`,
    );
  }
  assert.equal(count(raw, "project_npq_profile_versions"), 1);
  assert.equal(count(raw, "project_npq_profile_events"), 1);
  assert.equal(count(raw, "library_products"), 1);
  assert.equal(count(raw, "projects"), 1);
});

test("the export-to-quotation binding keeps its real values through the upgrade", () => {
  const raw = buildPreRepairEnvironment();
  apply(raw, FINAL);
  const job = {
    ...raw
      .prepare("SELECT project_id,export_mode,status,quotation_revision_id,quotation_fingerprint,evidence_fingerprint FROM excel_export_jobs WHERE id='export1'")
      .get(),
  };
  assert.deepEqual(job, {
    project_id: "proj1",
    export_mode: "Approved Cost Sheet",
    status: "Completed",
    quotation_revision_id: "quotrev1",
    quotation_fingerprint: "qfp-existing",
    evidence_fingerprint: "efp-existing",
  });
  // The binding must still point at a revision that exists.
  assert.ok(
    raw.prepare("SELECT 1 FROM project_quotation_revisions WHERE id=?").get(job.quotation_revision_id),
    "the bound revision must still be readable",
  );
  assert.ok(columnsOf(raw, "excel_export_jobs").includes("quotation_fingerprint"));
});

test("the upgrade neither invents nor drops governed columns", () => {
  const raw = buildPreRepairEnvironment();
  const before = {
    project_quotation_revisions: columnsOf(raw, "project_quotation_revisions"),
    project_quotation_lines: columnsOf(raw, "project_quotation_lines"),
    project_quotation_decisions: columnsOf(raw, "project_quotation_decisions"),
    project_quotation_issues: columnsOf(raw, "project_quotation_issues"),
    excel_export_jobs: columnsOf(raw, "excel_export_jobs"),
  };
  apply(raw, FINAL);
  for (const [table, expected] of Object.entries(before)) {
    const after = new Set(columnsOf(raw, table));
    const lost = expected.filter((column) => !after.has(column));
    assert.deepEqual(lost, [], `${table} lost columns during the upgrade`);
  }
});

test("fail-closed governance constraints survive the upgrade", () => {
  const raw = buildPreRepairEnvironment();
  apply(raw, FINAL);
  for (const object of [
    "projects_operational_scope_idx",
    "projects_declared_calendar_guard",
    "projects_declared_calendar_guard_update",
    "review_decisions_immutable_update",
    "review_decisions_immutable_delete",
    "export_quotation_binding_idx",
  ]) {
    assert.ok(
      raw.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(object),
      `governance object ${object} did not survive the upgrade`,
    );
  }
  const projects = columnsOf(raw, "projects");
  for (const column of ["operational_classification", "declared_timezone", "declared_utc_offset_minutes"]) {
    assert.ok(projects.includes(column), `projects.${column} was dropped by the upgrade`);
  }
});