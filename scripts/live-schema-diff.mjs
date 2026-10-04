/**
 * Structural diff between a live/dev D1 file and the repaired drizzle-active head.
 *
 * The live database has no trustworthy lineage metadata, so this compares
 * SCHEMA, not migration bookkeeping: tables, columns (type / NOT NULL / default /
 * CHECK), foreign keys, indexes (including uniqueness and partial predicates),
 * triggers and views. Differences are classified so that only real conflicts are
 * acted on.
 *
 *   LIVE_EXTRA_VALID    live has an object the head does not (extra history)
 *   LIVE_LEGACY_STALE   live has an object the chain deliberately retired
 *   CHAIN_MISSING_VALID live lacks an object the head defines
 *   CHAIN_DIFFERENT     same object, different shape
 *   DANGEROUS_CONFLICT  live has a column the head turned NOT NULL, or an index
 *                       the head defines over a column live lacks -- applying the
 *                       head's rebuild to such a table can destroy live data
 *
 * Usage: node scripts/live-schema-diff.mjs [path-to-sqlite] [--json]
 * Read-only: the database is opened immutable and never written.
 */
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const DIRECTORY = new URL("../drizzle-active/", import.meta.url).pathname;
const target = process.argv[2];
const asJson = process.argv.includes("--json");

/** The repaired chain, applied from zero with no repairs and no skips. */
const buildHead = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys=OFF");
  for (const name of readdirSync(DIRECTORY).filter((n) => n.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${DIRECTORY}${name}`, "utf8").split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (!trimmed) throw new Error(`chain statement failed: ${trimmed.slice(0, 80)}`);
      raw.exec(trimmed);
    }
  }
  return raw;
};

const tableNames = (raw) =>
  raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
const objects = (raw, type) =>
  raw.prepare("SELECT name,tbl_name,sql FROM sqlite_master WHERE type=? AND sql IS NOT NULL ORDER BY name").all(type);
const columnsOf = (raw, table) => raw.prepare(`PRAGMA table_info("${table}")`).all();
const foreignKeysOf = (raw, table) => raw.prepare(`PRAGMA foreign_key_list("${table}")`).all();
const checkOf = (raw, table) => {
  const sql = raw.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql || "";
  return [...sql.matchAll(/CHECK\s*\(/gi)].length;
};

const columnShape = (column) => ({
  type: (column.type || "").toUpperCase(),
  notNull: Boolean(column.notnull),
  default: column.dflt_value ?? null,
});

const snapshot = (raw) => {
  const tables = new Map();
  for (const name of tableNames(raw)) {
    tables.set(name, {
      columns: new Map(columnsOf(raw, name).map((c) => [c.name, columnShape(c)])),
      checks: checkOf(raw, name),
      foreignKeys: new Set(
        foreignKeysOf(raw, name).map((f) => `${f.table}.${f.from}->${f.to} on ${f.on_delete}`),
      ),
    });
  }
  return {
    tables,
    indexes: new Map(objects(raw, "index").map((i) => [i.name, { table: i.tbl_name, sql: (i.sql || "").replace(/\s+/g, " ").trim() }])),
    triggers: new Map(objects(raw, "trigger").map((t) => [t.name, t.sql.replace(/\s+/g, " ").trim()])),
    views: new Map(objects(raw, "view").map((v) => [v.name, v.sql.replace(/\s+/g, " ").trim()])),
  };
};

const head = snapshot(buildHead());
const liveRaw = new DatabaseSync(target, { readOnly: true });
const live = snapshot(liveRaw);
liveRaw.close();

const differences = [];
const note = (kind, area, object, detail) => differences.push({ kind, area, object, detail });

for (const [name, shape] of live.tables) {
  const headShape = head.tables.get(name);
  if (!headShape) {
    note("LIVE_EXTRA_VALID", "table", name, "present in live, absent from the repaired head");
    continue;
  }
  for (const [column, liveColumn] of shape.columns) {
    const headColumn = headShape.columns.get(column);
    if (!headColumn) {
      note("CHAIN_DIFFERENT", "column", `${name}.${column}`, "live column is not in the head");
      continue;
    }
    if (liveColumn.notNull && !headColumn.notNull) {
      note("DANGEROUS_CONFLICT", "column", `${name}.${column}`, "live is NOT NULL, head allows NULL");
    } else if (!liveColumn.notNull && headColumn.notNull) {
      note("CHAIN_DIFFERENT", "column", `${name}.${column}`, "live allows NULL, head is NOT NULL");
    }
    if (String(liveColumn.type) !== String(headColumn.type)) {
      note("CHAIN_DIFFERENT", "column", `${name}.${column}`, `type ${liveColumn.type} vs head ${headColumn.type}`);
    }
    if (String(liveColumn.default) !== String(headColumn.default)) {
      note("CHAIN_DIFFERENT", "column", `${name}.${column}`, `default ${liveColumn.default} vs head ${headColumn.default}`);
    }
  }
  const missingColumns = [...headShape.columns.keys()].filter((c) => !shape.columns.has(c));
  if (missingColumns.length) {
    note("CHAIN_MISSING_VALID", "table", name, `live lacks head columns: ${missingColumns.join(", ")}`);
  }
  const missingForeignKeys = [...headShape.foreignKeys].filter((f) => !shape.foreignKeys.has(f));
  if (missingForeignKeys.length) {
    note("CHAIN_MISSING_VALID", "foreign_key", name, `live lacks: ${missingForeignKeys.join("; ")}`);
  }
}

for (const name of head.tables.keys()) {
  if (!live.tables.has(name)) note("CHAIN_MISSING_VALID", "table", name, "table exists in the head, absent from live");
}
for (const [name, index] of live.indexes) {
  if (!head.indexes.has(name)) note("LIVE_LEGACY_STALE", "index", name, `live index on ${index.table} is not in the head`);
}
for (const [name, trigger] of live.triggers) {
  if (!head.triggers.has(name)) note("LIVE_LEGACY_STALE", "trigger", name, "live trigger is not in the head");
  else if (head.triggers.get(name) !== trigger) note("CHAIN_DIFFERENT", "trigger", name, "definition differs");
}
for (const [name, view] of live.views) {
  if (!head.views.has(name)) note("LIVE_LEGACY_STALE", "view", name, "live view is not in the head");
  else if (head.views.get(name) !== view) note("CHAIN_DIFFERENT", "view", name, "definition differs");
}
for (const name of head.views.keys()) {
  if (!live.views.has(name)) note("CHAIN_MISSING_VALID", "view", name, "view exists in the head, absent from live");
}
for (const name of head.triggers.keys()) {
  if (!live.triggers.has(name)) note("CHAIN_MISSING_VALID", "trigger", name, "trigger exists in the head, absent from live");
}

const summary = differences.reduce((acc, d) => ({ ...acc, [d.kind]: (acc[d.kind] || 0) + 1 }), {});

if (asJson) {
  console.log(JSON.stringify({ target, summary, differences }, null, 1));
} else {
  console.log(`structural diff: ${target}`);
  console.log(`live tables ${live.tables.size} | head tables ${head.tables.size}`);
  console.log("summary:", JSON.stringify(summary));
  const order = ["DANGEROUS_CONFLICT", "CHAIN_MISSING_VALID", "CHAIN_DIFFERENT", "LIVE_LEGACY_STALE", "LIVE_EXTRA_VALID"];
  for (const kind of order) {
    const rows = differences.filter((d) => d.kind === kind);
    if (!rows.length) continue;
    console.log(`\n## ${kind} (${rows.length})`);
    for (const row of rows.slice(0, 60)) console.log(`  ${row.area} ${row.object} — ${row.detail}`);
    if (rows.length > 60) console.log(`  ... ${rows.length - 60} more`);
  }
}