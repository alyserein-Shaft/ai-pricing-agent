import { DatabaseSync } from "node:sqlite";
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
    try {
      const results = statements.map((statement) => statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  close() { this.sqlite.close(); }
}

const [databasePath, projectId] = process.argv.slice(2);
if (!databasePath || !projectId) throw new Error("database and project required");

const DB = new D1(databasePath);
try {
  const items = DB.sqlite.prepare("SELECT id, sequence, item_number, description FROM boq_items WHERE project_id=? AND sequence IN (156,172,359,594,632) ORDER BY sequence").all(projectId);
  const results = [];
  for (const item of items) {
    const match = await executeProductMatching({ DB }, {
      itemId: item.id,
      user: { id: "local-development-user", role: "Technical Reviewer" },
    });
    results.push({
      sequence: item.sequence,
      itemNumber: item.item_number,
      description: item.description,
      matchRunId: match.matchRunId,
      status: match.status,
      candidates: match.result?.candidates?.length ?? null,
      idempotent: match.idempotent,
      noMatch: match.result?.noMatch?.reason || null,
    });
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  DB.close();
}
