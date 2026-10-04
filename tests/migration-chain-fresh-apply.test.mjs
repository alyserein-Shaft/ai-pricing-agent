/**
 * Proof that the ACTIVE migration chain is applicable from zero to head with no
 * skips, no repairs and no fixture surgery.
 *
 * This suite is deliberately the dumbest possible applier: it executes every
 * statement of every drizzle-active migration exactly once, in filename order,
 * and fails on the first error naming the migration and the statement. It
 * performs no dependency guessing, no retries, no dropping of "dangling"
 * objects, and no carry-forward of tables from an earlier point in the chain. If
 * the chain has a defect this suite fails and names it; it cannot pass against a
 * schema the chain does not actually produce.
 *
 * It then asserts that the schema the chain produces is the schema the governed
 * quotation path requires, so a later migration cannot silently remove the
 * quotation subsystem or the export-to-quotation binding again.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const DIRECTORY = new URL("../drizzle-active/", import.meta.url).pathname;
const MIGRATIONS = readdirSync(DIRECTORY)
  .filter((name) => name.endsWith(".sql"))
  .sort();

/**
 * Apply the real chain from zero to head. Any failure is fatal and is reported
 * verbatim with its migration file and statement number.
 */
const applyChainFromZero = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=OFF");
  let index = 0;
  for (const migration of MIGRATIONS) {
    const sql = readFileSync(`${DIRECTORY}${migration}`, "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (!trimmed) continue;
      index += 1;
      try {
        raw.exec(trimmed);
      } catch (error) {
        throw new Error(
          `MIGRATION_CHAIN_FRESH_APPLY = FAIL at ${migration} statement #${index}: ` +
            `${trimmed.replace(/\s+/g, " ").slice(0, 140)} :: ${error.message}`,
        );
      }
    }
  }
  return { raw, statements: index };
};

const tableExists = (raw, name) =>
  Boolean(raw.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));

const columnsOf = (raw, table) =>
  new Set(raw.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));

test("MIGRATION_CHAIN_FRESH_APPLY = PASS: every statement of the whole active chain applies from zero", () => {
  const { statements } = applyChainFromZero();
  assert.ok(statements > 1000, `expected the full chain, applied only ${statements} statements`);
  assert.ok(MIGRATIONS.length >= 20, `expected every migration, found ${MIGRATIONS.length}`);
});

test("the migrated schema provides the governed quotation subsystem and its authority tables", () => {
  const { raw } = applyChainFromZero();
  for (const table of [
    // The governed quotation lifecycle.
    "project_quotation_revisions",
    "project_quotation_lines",
    "project_quotation_decisions",
    "project_quotation_issues",
    "presales_workflow_snapshots",
    // The governed export prerequisite for issue.
    "excel_export_jobs",
    "export_templates",
    // Authority tables the quotation path reads.
    "pricing_runs",
    "pricing_lines",
    "pricing_approvals",
    "boq_quantity_source_decisions",
    "drawing_quantity_evidence_coverage",
    "estimator_understanding_review_versions",
    "fire_alarm_panel_sizing_snapshots",
    "project_npq_profile_versions",
    "project_npq_profile_events",
    "library_products",
    "product_match_candidates",
    "projects",
  ]) {
    assert.ok(tableExists(raw, table), `the chain no longer provides ${table}`);
  }
});

test("project_quotation_lines carries every column the single writer persists", () => {
  const { raw } = applyChainFromZero();
  const columns = columnsOf(raw, "project_quotation_lines");
  // Exactly the column list of the one INSERT in worker/presales-workflow-api.mjs.
  for (const column of [
    "id", "quotation_revision_id", "project_id", "boq_item_id", "sequence", "item_number",
    "description", "unit", "quantity", "candidate_id", "product_id", "manufacturer_name",
    "part_number", "product_description", "pricing_run_id", "pricing_run_version",
    "pricing_line_id", "pricing_line_version", "pricing_input_fingerprint",
    "commercial_approval_id", "commercial_approval_version", "currency", "total_cost_minor",
    "net_selling_minor", "source_snapshot_json", "created_at", "source_type",
    "engineering_scope_kind", "system", "source_role", "source_snapshot_id",
    "source_fingerprint", "source_product_id",
  ]) {
    assert.ok(columns.has(column), `project_quotation_lines is missing writer column ${column}`);
  }
});

test("the generalized PRODUCT source identity stays fail closed (NOT NULL, no default)", () => {
  const { raw } = applyChainFromZero();
  for (const name of ["source_type", "source_product_id"]) {
    const column = raw
      .prepare("PRAGMA table_info(project_quotation_lines)")
      .all()
      .find((candidate) => candidate.name === name);
    assert.ok(column, `project_quotation_lines is missing ${name}`);
    assert.equal(column.notnull, 1, `${name} must remain NOT NULL`);
    assert.equal(column.dflt_value, null, `${name} must not gain a default`);
  }
});

test("the export-to-quotation binding the issue gate reads survives the chain", () => {
  const { raw } = applyChainFromZero();
  const columns = columnsOf(raw, "excel_export_jobs");
  for (const column of [
    "quotation_revision_id",
    "quotation_fingerprint",
    "evidence_fingerprint",
    "project_id",
    "template_id",
    "export_mode",
    "status",
    "stage",
    "progress",
    "data_hash",
    "completed_at",
    "failed_at",
    "error_code",
    "cancelled_at",
    "superseded_by_id",
  ]) {
    assert.ok(columns.has(column), `excel_export_jobs is missing ${column}`);
  }
});

test("the fail-closed governance constraints the chain must not simplify away survive", () => {
  const { raw } = applyChainFromZero();
  for (const object of [
    "projects_operational_scope_idx",
    "projects_declared_calendar_guard",
    "projects_declared_calendar_guard_update",
    "review_decisions_immutable_update",
    "review_decisions_immutable_delete",
    "review_audit_log_immutable_update",
    "review_audit_log_immutable_delete",
    "export_quotation_binding_idx",
  ]) {
    assert.ok(
      raw.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(object),
      `governance object ${object} did not survive the chain`,
    );
  }
});

test("columns current production code still reads were not dropped by the chain", () => {
  const { raw } = applyChainFromZero();
  // projects.operational_classification is read by collectProjectFacts in
  // worker/dashboard-api.mjs, which the quotation draft path calls;
  // declared_timezone / declared_utc_offset_minutes are read by
  // worker/project-effective-time-calendar.mjs and app/domain/effective-time-policy.mjs.
  const projects = columnsOf(raw, "projects");
  for (const column of ["operational_classification", "declared_timezone", "declared_utc_offset_minutes"]) {
    assert.ok(projects.has(column), `projects.${column} was dropped but is still read`);
  }
});