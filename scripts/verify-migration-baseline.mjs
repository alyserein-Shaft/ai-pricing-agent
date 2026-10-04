#!/usr/bin/env node
/**
 * Read-only structural verifier for the frozen MIG-BASE-3R baseline.
 *
 * This tool never applies SQL and never writes a migration ledger. It is
 * intended for a later, separately authorized disposable-database execution
 * slice. It must not be pointed at Golden unless that environment is quiesced
 * and the operator has explicitly accepted a read-only inspection.
 */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const manifestPath = resolve(root, "drizzle-active/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Usage: node scripts/verify-migration-baseline.mjs <sqlite-path>");
  process.exit(2);
}

const db = new DatabaseSync(dbPath, { readOnly: true });
const all = (sql, ...params) => db.prepare(sql).all(...params);
const one = (sql, ...params) => db.prepare(sql).get(...params);
const names = (rows) => rows.map((row) => typeof row === "string" ? row : row.name).sort();
const normalizeSql = (sql) => String(sql || "").replace(/\s+/g, " ").replace(/`/g, "").trim().toLowerCase();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const result = {
  database: dbPath,
  cutoff: manifest.target.cutoffMigration,
  manifestSha256: sha256(readFileSync(manifestPath)),
  quickCheck: one("PRAGMA quick_check"),
  foreignKeyCheck: all("PRAGMA foreign_key_check"),
  counts: {},
  missing: {},
  extra: {},
  mismatches: [],
  status: "PASS",
};

const objectRows = all("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY type, name");
const actualTables = names(objectRows.filter((row) => row.type === "table"));
const actualIndexes = names(objectRows.filter((row) => row.type === "index" && !row.name.startsWith("sqlite_autoindex_")));
const actualTriggers = names(objectRows.filter((row) => row.type === "trigger"));
const actualViews = names(objectRows.filter((row) => row.type === "view"));
const targetTables = names(manifest.tables);
const targetIndexes = names(manifest.indexes);
const targetTriggers = names(manifest.triggers);
const targetViews = names(manifest.views);

for (const [label, actual, target] of [
  ["tables", actualTables, targetTables],
  ["indexes", actualIndexes, targetIndexes],
  ["triggers", actualTriggers, targetTriggers],
  ["views", actualViews, targetViews],
]) {
  const actualSet = new Set(actual);
  const targetSet = new Set(target);
  result.counts[label] = { actual: actual.length, target: target.length };
  result.missing[label] = target.filter((name) => !actualSet.has(name));
  result.extra[label] = actual.filter((name) => !targetSet.has(name));
}

for (const table of targetTables) {
  const columns = all(`PRAGMA table_info(${JSON.stringify(table)})`).map((column) => column.name).sort();
  const targetColumns = manifest.tables.find((entry) => entry.name === table)?.columns.map((column) => column.name).sort() || [];
  if (JSON.stringify(columns) !== JSON.stringify(targetColumns)) {
    result.mismatches.push({ type: "columns", table, actual: columns, target: targetColumns });
  }
}

for (const trigger of manifest.triggers) {
  const row = objectRows.find((entry) => entry.type === "trigger" && entry.name === trigger.name);
  if (row && normalizeSql(row.sql) !== normalizeSql(trigger.sql)) {
    result.mismatches.push({ type: "trigger", name: trigger.name });
  }
}
for (const view of manifest.views) {
  const row = objectRows.find((entry) => entry.type === "view" && entry.name === view.name);
  if (row && normalizeSql(row.sql) !== normalizeSql(view.sql)) {
    result.mismatches.push({ type: "view", name: view.name });
  }
}

if (Object.values(result.quickCheck || {})[0] !== "ok") result.status = "FAIL";
if (result.foreignKeyCheck.length) result.status = "FAIL";
if (Object.values(result.missing).some((items) => items.length)) result.status = "FAIL";
if (Object.values(result.extra).some((items) => items.length)) result.status = "FAIL";
if (result.mismatches.length) result.status = "FAIL";

console.log(JSON.stringify(result, null, 2));
db.close();
process.exit(result.status === "PASS" ? 0 : 1);
