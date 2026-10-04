// Compute the exact delta between drizzle-active/manifest.json and the object
// inventory of the post-0010 active chain (disposable sqlite, 0000..0010 applied).
// Read-only against the canonical tree; disposable DB lives in TMPDIR.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const CANON = resolve("../../../drizzle-active");
const TMP = process.env.TMPDIR || "/tmp";
const CHAIN = resolve(TMP, "laneA-inventory.sqlite");
if (existsSync(CHAIN)) rmSync(CHAIN);
for (const f of readdirSync(CANON).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort()) {
  execFileSync("/usr/bin/sqlite3", [CHAIN], { input: readFileSync(resolve(CANON, f), "utf8") });
}
const db = new DatabaseSync(CHAIN, { readOnly: true });
const objects = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'").all();
const names = (rows) => rows.map((r) => (typeof r === "string" ? r : r.name)).sort();

const actual = {
  tables: names(objects.filter((o) => o.type === "table")),
  indexes: names(objects.filter((o) => o.type === "index" && !o.name.startsWith("sqlite_autoindex_"))),
  triggers: names(objects.filter((o) => o.type === "trigger")),
  views: names(objects.filter((o) => o.type === "view")),
};
const manifest = JSON.parse(readFileSync(resolve(CANON, "manifest.json"), "utf8"));
const target = {
  tables: names(manifest.tables),
  indexes: names(manifest.indexes),
  triggers: names(manifest.triggers),
  views: names(manifest.views),
};

console.log("=== OBJECT COUNT / NAME DELTA (manifest -> post-0010 chain) ===");
for (const kind of ["tables", "indexes", "triggers", "views"]) {
  const t = new Set(target[kind]); const a = new Set(actual[kind]);
  const missing = actual[kind].filter((n) => !t.has(n));
  const extra = target[kind].filter((n) => !a.has(n));
  console.log(`${kind}: manifest=${target[kind].length} chain=${actual[kind].length}`);
  console.log(`  missing from manifest (chain-only): ${JSON.stringify(missing)}`);
  console.log(`  extra in manifest (not in chain):   ${JSON.stringify(extra)}`);
}

console.log("\n=== COLUMN DELTA PER TABLE ===");
let changed = 0;
for (const name of actual.tables) {
  const actualCols = db.prepare(`PRAGMA table_info(${JSON.stringify(name)})`).all().map((c) => c.name).sort();
  const m = manifest.tables.find((t) => t.name === name);
  const manifestCols = (m?.columns ?? []).map((c) => c.name).sort();
  if (JSON.stringify(actualCols) !== JSON.stringify(manifestCols)) {
    changed += 1;
    console.log(`${name}:`);
    console.log(`  chain only:    ${JSON.stringify(actualCols.filter((c) => !manifestCols.includes(c)))}`);
    console.log(`  manifest only: ${JSON.stringify(manifestCols.filter((c) => !actualCols.includes(c)))}`);
  }
}
console.log(`tables whose column list differs: ${changed} of ${actual.tables.length}`);

console.log("\n=== TRIGGER / VIEW SQL DIFF ===");
const norm = (s) => String(s || "").replace(/\s+/g, " ").replace(/`/g, "").trim().toLowerCase();
for (const kind of ["triggers", "views"]) {
  for (const entry of manifest[kind]) {
    const row = objects.find((o) => o.name === entry.name);
    if (!row) { console.log(`${kind} ${entry.name}: NOT IN CHAIN`); continue; }
    if (norm(row.sql) !== norm(entry.sql)) console.log(`${kind} ${entry.name}: SQL DIFFERS\n  chain:   ${norm(row.sql)}\n  manifest:${norm(entry.sql)}`);
  }
}

db.close();
rmSync(CHAIN, { force: true });
