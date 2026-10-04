#!/usr/bin/env node
/**
 * CCTV System Pack v1 -- re-runs the REAL, unmodified production requirement-
 * profile + product-matching pipeline (worker/technical-requirement-api.mjs's
 * executeRequirementProfile, worker/product-matching-api.mjs's
 * executeProductMatching -- the exact same functions the live app calls)
 * against a small, explicitly-named set of real camera BOQ items in the
 * "CCTV & Access Control Validation" project, now that a real CCTV catalog
 * exists to match against. Scoped to only the named item IDs -- never a
 * blind whole-project re-match (this project also contains many unrelated
 * Access Control lines this session must not touch).
 *
 * Usage: node scripts/rematch-cctv-camera-lines.mjs <path-to-d1-sqlite> <boqItemId> [<boqItemId> ...]
 */
import { DatabaseSync } from "node:sqlite";
import { executeRequirementProfile } from "../worker/technical-requirement-api.mjs";
import { executeProductMatching } from "../worker/product-matching-api.mjs";

const [dbPath, ...itemIds] = process.argv.slice(2);
if (!dbPath || !itemIds.length) throw new Error("Usage: rematch-cctv-camera-lines.mjs <db-path> <boqItemId> [<boqItemId> ...]");
const ACTOR_ID = "local-development-user";

class D1Statement {
  constructor(db, sql, values = []) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values) { return new D1Statement(this.db, this.sql, values); }
  async first() { return this.db.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.values) }; }
  async run() { const result = this.db.prepare(this.sql).run(...this.values); return { success: true, meta: { changes: result.changes } }; }
}
class D1Database {
  constructor(path) { this.sqlite = new DatabaseSync(path); this.sqlite.exec("PRAGMA foreign_keys=ON"); }
  prepare(sql) { return new D1Statement(this.sqlite, sql); }
  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.sqlite.exec("COMMIT"); return results; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}
const db = new D1Database(dbPath);
const env = { DB: db };

const results = [];
for (const itemId of itemIds) {
  const item = db.sqlite.prepare("SELECT id, description FROM boq_items WHERE id=?").get(itemId);
  if (!item) { results.push({ itemId, error: "NOT_FOUND" }); continue; }
  const profileResult = await executeRequirementProfile(env, { itemId, userId: ACTOR_ID });
  const matchResult = await executeProductMatching(env, { itemId, user: { id: ACTOR_ID, role: "Estimator" } });
  results.push({ itemId, description: item.description, profileResult, matchResult });
}
console.log(JSON.stringify(results, null, 2));
