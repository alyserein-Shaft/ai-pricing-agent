import { DatabaseSync } from "node:sqlite";
import { executeRequirementProfile } from "../worker/technical-requirement-api.mjs";
import { executeProductMatching } from "../worker/product-matching-api.mjs";

class Statement {
  constructor(db, sql, values = []) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.db, this.sql, values); }
  run() { const result = this.db.prepare(this.sql).run(...this.values); return { meta: { changes: Number(result.changes || 0) } }; }
  first() { return this.db.prepare(this.sql).get(...this.values) || null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.values) }; }
}

class D1 {
  constructor(path) { this.sqlite = new DatabaseSync(path); }
  prepare(sql) { return new Statement(this.sqlite, sql); }
  batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try { const results = statements.map((statement) => statement.run()); this.sqlite.exec("COMMIT"); return results; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
  close() { this.sqlite.close(); }
}

const [databasePath, projectId] = process.argv.slice(2);
if (!databasePath || !projectId) throw new Error("database and project required");
const sample = new Map([
  [3, "Smoke Detector"],
  [5, "Heat Detector"],
  [9, "Fire Alarm Control Panel"],
  [13, "Control Module"],
  [14, "Monitor Module"],
  [16, "Sounder Strobe"],
]);

const DB = new D1(databasePath);
try {
  const items = DB.sqlite.prepare(`SELECT * FROM boq_items WHERE project_id=? AND sequence IN (${[...sample.keys()].map(() => "?").join(",")}) ORDER BY sequence`).all(projectId, ...sample.keys());
  if (items.length !== sample.size) throw new Error("Representative sample is incomplete");
  DB.sqlite.exec("BEGIN IMMEDIATE");
  try {
    for (const item of items) {
      DB.sqlite.prepare("UPDATE boq_items SET system_value='Fire Alarm', system_source_type='Source Description', system_confidence=100, category=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(sample.get(item.sequence), item.id);
    }
    DB.sqlite.exec("COMMIT");
  } catch (error) { DB.sqlite.exec("ROLLBACK"); throw error; }

  const output = [];
  for (const item of items) {
    const profile = await executeRequirementProfile({ DB }, { itemId: item.id, userId: "local-development-user" });
    const matching = await executeProductMatching({ DB }, { itemId: item.id, user: { id: "local-development-user", role: "Technical Reviewer" } });
    output.push({
      sequence: item.sequence,
      itemNumber: item.item_number,
      description: item.description,
      unit: item.original_unit,
      quantity: item.original_quantity,
      category: sample.get(item.sequence),
      profileId: profile.profileId,
      readiness: profile.profile?.readiness?.status || profile.status,
      matchRunId: matching.matchRunId,
      matchStatus: matching.status,
      candidates: matching.result?.candidates?.length ?? 0,
      matchingIdempotent: matching.idempotent,
    });
  }
  console.log(JSON.stringify(output, null, 2));
} finally { DB.close(); }

