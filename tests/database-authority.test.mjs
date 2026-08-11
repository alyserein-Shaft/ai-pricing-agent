import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { requireMigratedTables } from "../worker/schema-requirements.mjs";

const root = new URL("..", import.meta.url).pathname;

test("runtime workers contain no business schema DDL", () => {
  const files = readdirSync(join(root, "worker")).filter((name) => name.endsWith(".mjs"));
  const ddl = /\b(?:CREATE\s+(?:TABLE|INDEX|VIEW|TRIGGER)|ALTER\s+TABLE|DROP\s+TABLE)\b/i;
  for (const file of files) assert.doesNotMatch(readFileSync(join(root, "worker", file), "utf8"), ddl, file);
});

test("migration prefixes are unique from authority closure onward", () => {
  const files = readdirSync(join(root, "drizzle")).filter((name) => name.endsWith(".sql"));
  const current = files.filter((name) => Number(name.slice(0, 4)) >= 21);
  const prefixes = current.map((name) => name.slice(0, 4));
  assert.equal(new Set(prefixes).size, prefixes.length);
  assert.ok(files.includes("0050_database_authority_closure.sql"));
});

test("ordered migrations recreate the authoritative database with critical foreign keys", () => {
  const state = mkdtempSync(join(tmpdir(), "database-authority-"));
  const database = join(state, "clean.sqlite");
  const migrations = readdirSync(join(root, "drizzle")).filter((name) => name.endsWith(".sql")).sort();
  for (const migration of migrations) execFileSync("sqlite3", [database, `.read ${join(root, "drizzle", migration)}`]);
  const count = Number(execFileSync("sqlite3", [database, "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"], { encoding: "utf8" }).trim());
  assert.equal(count, 282);
  const relation = (table, parent, column) => JSON.parse(execFileSync("sqlite3", ["-json", database, `PRAGMA foreign_key_list('${table}')`], { encoding: "utf8" }) || "[]").some((row) => row.table === parent && row.from === column);
  assert.ok(relation("documents", "projects", "project_id"));
  assert.ok(relation("case_study_sources", "case_studies", "case_study_id"));
  assert.ok(relation("case_ground_truth_records", "case_studies", "case_study_id"));
  assert.ok(relation("case_knowledge_items", "case_studies", "case_study_id"));
  assert.ok(relation("product_match_candidates", "product_match_runs", "match_run_id"));
  assert.ok(relation("pricing_lines", "pricing_runs", "pricing_run_id"));
  assert.ok(relation("estimator_understanding_runs", "projects", "project_id"));
  assert.ok(relation("estimator_item_interpretations", "boq_items", "boq_item_id"));
  assert.equal(execFileSync("sqlite3", [database, "PRAGMA foreign_key_check"], { encoding: "utf8" }).trim(), "");
});

test("schema preflight reports missing migrations without mutating schema", async () => {
  const calls = [];
  const db = { prepare(sql) { calls.push(sql); return { bind() { return this; }, async all() { return { results: [{ name: "projects" }] }; } }; } };
  await assert.rejects(requireMigratedTables(db, ["projects", "documents"]), (error) => error.code === "DATABASE_SCHEMA_MISSING" && error.missingTables[0] === "documents");
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0], /CREATE|ALTER|DROP/i);
});
