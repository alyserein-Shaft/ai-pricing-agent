/**
 * RECONCILIATION PROOF -- run against an isolated copy of a dev/live D1 file.
 *
 * The canonical live database is never opened for writing here. The proof:
 *
 *   1. takes an inventory of the sensitive governed tables BEFORE anything runs;
 *   2. applies the real repaired chain to the copy, statement by statement,
 *      failing closed on the first error;
 *   3. re-inventories and proves that every project, BOQ item, requirement
 *      profile, library product, pricing run/line/approval, safety and review
 *      decision, quotation revision/line, export job, panel-sizing snapshot and
 *      quantity decision survived with the same ids and the same row count.
 *
 * It also reports exactly which objects the chain retired, so a destructive step
 * can never be invisible.
 *
 * Usage: node scripts/live-reconciliation-proof.mjs <copy.sqlite> [--json] [--only <migration,migration,...>]
 */
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DIRECTORY = new URL("../drizzle-active/", import.meta.url).pathname;
const copyPath = process.argv[2];
const asJson = process.argv.includes("--json");
if (!copyPath) {
  console.error("usage: node scripts/live-reconciliation-proof.mjs <copy.sqlite> [--json]");
  process.exit(2);
}

/** Tables whose rows and ids must survive reconciliation, with the id column. */
const GOVERNED = [
  ["projects", "id"],
  ["organizations", "id"],
  ["documents", "id"],
  ["document_versions", "id"],
  ["boq_extraction_versions", "id"],
  ["boq_items", "id"],
  ["product_match_runs", "id"],
  ["product_match_candidates", "id"],
  ["safety_decisions", "id"],
  ["safety_approval_requests", "id"],
  ["review_queue_items", "id"],
  ["review_decisions", "id"],
  ["requirement_profile_versions", "id"],
  ["consolidated_profile_requirements", "id"],
  ["profile_requirement_applicability", "id"],
  ["library_products", "id"],
  ["price_records", "id"],
  ["pricing_scenarios", "id"],
  ["pricing_runs", "id"],
  ["pricing_lines", "id"],
  ["pricing_approvals", "id"],
  ["project_quotation_revisions", "id"],
  ["project_quotation_lines", "id"],
  ["project_quotation_decisions", "id"],
  ["project_quotation_issues", "id"],
  ["excel_export_jobs", "id"],
  ["presales_workflow_snapshots", "id"],
  ["fire_alarm_panel_sizing_snapshots", "id"],
  ["boq_quantity_source_decisions", "id"],
];

const raw = new DatabaseSync(copyPath);
raw.exec("PRAGMA foreign_keys=OFF");
const has = (table) => Boolean(raw.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));

const inventory = () => {
  const before = new Map();
  for (const [table, idColumn] of GOVERNED) {
    if (!has(table)) { before.set(table, null); continue; }
    before.set(table, {
      rows: raw.prepare(`SELECT count(*) c FROM "${table}"`).get().c,
      ids: new Set(raw.prepare(`SELECT "${idColumn}" FROM "${table}"`).all().map((r) => r[idColumn])),
      versions: has(`${table}`)
        ? raw.prepare(`SELECT count(*) c FROM "${table}"`).get().c
        : 0,
    });
  }
  return before;
};

const before = inventory();

// A live/dev database already carries the baseline, so reconciliation applies the
// DELTA from `--from` (default: the head migration) rather than replaying the
// whole chain, which would collide with the objects the database already has.
// The live database's lineage is not linear (it carries objects from later
// migrations while lacking earlier ones), so a blind replay is wrong and a
// single "from" is not enough either. `--only` applies an EXPLICIT, verified
// delta: the migrations this database is genuinely missing, then the head. The
// list is an input to a runbook, not a guess made by this tool.
// DIAGNOSTIC ONLY: `--exclude-rebuild <table,...>` skips the rebuild of a named
// table so the rest of a reconciliation can be proved while a data decision is
// pending for that one table. It is a proof aid, never a migration path: the real
// runbook has no such switch, and skipping a rebuild would leave the table on its
// older shape.
const excludeIndex = process.argv.indexOf("--exclude-rebuild");
const excluded = new Set(excludeIndex === -1 ? [] : process.argv[excludeIndex + 1].split(",").map((t) => t.trim()));
const onlyIndex = process.argv.indexOf("--only");
const allMigrations = readdirSync(DIRECTORY).filter((n) => n.endsWith(".sql")).sort();
const migrations = onlyIndex === -1
  ? allMigrations.slice(allMigrations.indexOf("0019_fixed_angel.sql"))
  : process.argv[onlyIndex + 1].split(",").map((name) => name.trim());
for (const name of migrations) {
  if (!allMigrations.includes(name)) {
    console.error(`RECONCILIATION = FAIL: no migration named ${name}`);
    process.exit(2);
  }
}

// The head rebuilds two requirement-intelligence tables with `requirement_id NOT
// NULL`. Legacy rows with a NULL requirement_id cannot satisfy it. Those rows
// belong to their owning lane, so this tool refuses to start rather than dropping,
// backfilling or loosening the constraint.
if (migrations.includes("0019_fixed_angel.sql") && !process.argv.includes("--exclude-rebuild")) {
  const { countNullRequirementIdRows } = await import("./check-live-reconciliation-preconditions.mjs");
  const { total } = countNullRequirementIdRows(copyPath);
  if (total > 0) {
    console.error(
      `RECONCILIATION = BLOCKED: NULL_REQUIREMENT_ID_ROWS = ${total}. ` +
        `Run: node scripts/check-live-reconciliation-preconditions.mjs ${copyPath}`,
    );
    process.exit(4);
  }
}

const applied = [];
const skippedRebuilds = [];
let retiredTables = 0;
let retiredRows = 0;
for (const migration of migrations) {
  const sql = readFileSync(`${DIRECTORY}${migration}`, "utf8");
  const statements = sql.split("--> statement-breakpoint").filter((s) => s.trim());
  for (const statement of statements) {
    const trimmed = statement.trim();
    // Skip every statement that names an excluded table, so the table keeps its
    // current shape and its indexes instead of being dropped and renamed away.
    const excludedTable = [...excluded].find((table) => new RegExp(`\\b${table}\\b`).test(trimmed));
    if (excludedTable) {
      skippedRebuilds.push(excludedTable);
      continue;
    }
    const drop = /^DROP TABLE `?(\w+)`?;$/.exec(trimmed);
    if (drop && !sql.includes(`__new_${drop[1]}`)) {
      if (has(drop[1])) {
        const rows = raw.prepare(`SELECT count(*) c FROM "${drop[1]}"`).get().c;
        retiredTables += 1;
        retiredRows += rows;
        applied.push({ kind: "retired", object: drop[1], rows });
      }
    }
    try {
      raw.exec(trimmed);
    } catch (error) {
      console.error(
        `RECONCILIATION = FAIL at ${migration}: ${trimmed.replace(/\s+/g, " ").slice(0, 120)} :: ${error.message}`,
      );
      process.exit(1);
    }
  }
}

const after = inventory();
const results = [];
for (const [table] of GOVERNED) {
  const b = before.get(table);
  const a = after.get(table);
  if (b === null && a === null) { results.push({ table, status: "absent_both" }); continue; }
  if (b === null || a === null) { results.push({ table, status: "MISSING", before: !!b, after: !!a }); continue; }
  const lost = [...b.ids].filter((id) => !a.ids.has(id));
  results.push({
    table,
    rows_before: b.rows,
    rows_after: a.rows,
    ids_before: b.ids.size,
    ids_after: a.ids.size,
    lost_ids: lost.length,
    status: b.rows === a.rows && lost.length === 0 ? "PRESERVED" : "CHANGED",
  });
}
const broken = results.filter((r) => r.status === "MISSING" || r.status === "CHANGED");

if (asJson) {
  console.log(JSON.stringify({ applied, retiredTables, retiredRows, results, broken }, null, 1));
} else {
  console.log(`reconciliation proof on ${copyPath}`);
  console.log(`applied ${migrations.length} migrations; retired ${retiredTables} legacy tables holding ${retiredRows} rows`);
  if (skippedRebuilds.length) {
    console.log(`DIAGNOSTIC: rebuild of ${[...new Set(skippedRebuilds)].join(", ")} was skipped (a data decision is pending for it)`);
  }
  if (retiredTables) {
    for (const r of applied.filter((x) => x.kind === "retired" && x.rows > 0)) {
      console.log(`  retired ${r.object} (${r.rows} rows)`);
    }
  }
  for (const r of results) {
    if (r.status === "absent_both") continue;
    console.log(`  ${r.status.padEnd(9)} ${r.table}: rows ${r.rows_before ?? "n/a"} -> ${r.rows_after ?? "n/a"}, lost ids ${r.lost_ids ?? "n/a"}`);
  }
  console.log(`\nLIVE_COPY_RECONCILED = ${broken.length === 0 ? "PASS" : `FAIL (${broken.map((b) => b.table).join(", ")})`}`);
}