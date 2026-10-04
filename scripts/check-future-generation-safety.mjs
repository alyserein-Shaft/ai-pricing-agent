// Determine what a future `drizzle-kit generate` would emit, WITHOUT running
// drizzle-kit's interactive flow.
//
// drizzle-kit generates a migration by diffing db/schema.ts against the LAST
// snapshot. So the question "is future regeneration safe?" reduces to:
//   for every table in the snapshot but NOT in db/schema.ts  -> would emit DROP TABLE
//   for every column in the snapshot but NOT in db/schema.ts -> would emit DROP COLUMN
//   for every table in db/schema.ts but NOT in the snapshot -> would emit CREATE TABLE
//
// This computes that diff directly. Read-only; imports nothing from drizzle-kit.
import fs from "node:fs";

// `drizzle-kit generate` diffs db/schema.ts against the NEWEST snapshot in
// meta/, so that is the file this must analyse. Hardcoding a snapshot index
// would silently validate against a stale baseline.
const metaDir = "drizzle-active/meta";
const snapshots = fs.readdirSync(metaDir).filter((f) => /^\d{4}_snapshot\.json$/.test(f)).sort();
if (snapshots.length === 0) { console.error("no snapshots found in " + metaDir); process.exit(3); }
const newestSnapshot = snapshots[snapshots.length - 1];

const schemaSrc = fs.readFileSync("db/schema.ts", "utf8");
const snap = JSON.parse(fs.readFileSync(`${metaDir}/${newestSnapshot}`, "utf8"));

// Table names declared in db/schema.ts, in declaration order.
const declaredTables = [...schemaSrc.matchAll(/sqliteTable\(\s*"([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
const declaredSet = new Set(declaredTables);

// Columns declared per table.
//
// The column map must be extracted per `sqliteTable(...)` CALL, not by regexing
// the whole file: db/schema.ts is written in two styles (a compact one-line
// form and a multi-line form) and a naive global regex silently misses whole
// tables, which then look like "every column is being dropped".
const declaredColumns = {};
const tableStarts = [...schemaSrc.matchAll(/sqliteTable\(\s*"([A-Za-z0-9_]+)"/g)];
for (const m of tableStarts) {
  const name = m[1];
  const from = m.index + m[0].length;
  // The body ends at the NEXT `sqliteTable(` occurrence, not at a paren count.
  //
  // Paren counting is unsafe here: this schema file embeds SQL in template
  // literals (sql`CURRENT_TIMESTAMP`), and an unbalanced paren inside a
  // backtick-quoted SQL fragment throws the depth off, letting one table's scan
  // swallow the rest of the file. Bounding by the next declaration start is
  // exact, because every table body lies between two `sqliteTable(` markers.
  const nextIdx = schemaSrc.indexOf("sqliteTable(", from);
  const body = schemaSrc.slice(from, nextIdx === -1 ? schemaSrc.length : nextIdx);
  // Compare on DATABASE column names, not TypeScript property names.
  //
  // db/schema.ts declares `extractionVersionId: text("extraction_version_id")`,
  // while the snapshot stores `extraction_version_id`. Diffing the camelCase
  // property against the snake_case snapshot entry reports every column as
  // being dropped -- a false positive of ~1,900 columns that would send an
  // engineer chasing a nonexistent catastrophe.
  declaredColumns[name] = [...body.matchAll(/:\s*(?:text|integer|real|blob|numeric|bigint|boolean)\s*\(\s*"([A-Za-z0-9_]+)"/g)].map((c) => c[1]);
}

const snapTables = Object.keys(snap.tables);

const wouldDropTable = snapTables.filter((t) => !declaredSet.has(t));
const wouldCreateTable = declaredTables.filter((t) => !snap.tables[t]);

const wouldDropColumn = [];
for (const [table, def] of Object.entries(snap.tables)) {
  if (!declaredSet.has(table)) continue; // already counted as a table drop
  const cols = declaredColumns[table];
  if (!cols) continue;
  const declaredColSet = new Set(cols);
  for (const col of Object.keys(def.columns || {})) {
    if (!declaredColSet.has(col)) wouldDropColumn.push(`${table}.${col}`);
  }
}

const d27 = JSON.parse(fs.readFileSync("/tmp/reconciliation/destructive27.json", "utf8"));
const dropCols = JSON.parse(fs.readFileSync("/tmp/reconciliation/dropcols.json", "utf8"));

console.log(`FUTURE GENERATION SAFETY ANALYSIS (diff of db/schema.ts vs ${newestSnapshot})`);
console.log("=".repeat(100));
console.log(`tables in db/schema.ts        : ${declaredTables.length}`);
console.log(`tables in ${newestSnapshot} : ${snapTables.length}`);
console.log();
console.log(`WOULD EMIT DROP TABLE        : ${wouldDropTable.length}`);
if (wouldDropTable.length) {
  for (const t of wouldDropTable) console.log(`     ${t}${d27.includes(t) ? "   <-- one of the 27 PRESERVED legacy tables" : ""}`);
}
console.log(`WOULD EMIT DROP COLUMN       : ${wouldDropColumn.length}`);
for (const c of wouldDropColumn.slice(0, 40)) {
  const isPreserved = dropCols.some((d) => `${d.table}.${d.column}` === c);
  console.log(`     ${c}${isPreserved ? "   <-- one of the 33 PRESERVED columns" : ""}`);
}
if (wouldDropColumn.length > 40) console.log(`     ... and ${wouldDropColumn.length - 40} more`);
console.log(`WOULD EMIT CREATE TABLE      : ${wouldCreateTable.length}`);
for (const t of wouldCreateTable.slice(0, 20)) console.log(`     ${t}`);
console.log("=".repeat(100));

const dropTableRisk = wouldDropTable.length;
const preservedAtRisk = wouldDropTable.filter((t) => d27.includes(t)).length;
const colRisk = wouldDropColumn.length;
const preservedColAtRisk = wouldDropColumn.filter((c) => dropCols.some((d) => `${d.table}.${d.column}` === c)).length;

console.log();
console.log(`DROP_TABLE_RISK               = ${dropTableRisk} (of which ${preservedAtRisk} are the preserved legacy 27)`);
console.log(`DROP_COLUMN_RISK              = ${colRisk} (of which ${preservedColAtRisk} are the preserved 33)`);
console.log(`XOR regression risk           = ${snap.tables.profile_requirement_applicability?.columns?.requirement_id?.notNull ? "YES (requirement_id NOT NULL re-emitted)" : "no (requirement_id nullable, XOR columns present)"}`);
console.log();
const safe = dropTableRisk === 0 && preservedColAtRisk === 0;
console.log(safe ? "FUTURE GENERATION: SAFE against the preserved objects" : "FUTURE GENERATION: WOULD REINTRODUCE DESTRUCTIVE DDL");
process.exit(safe ? 0 : 1);
