import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { scoreRequirementLink } from "../app/domain/engineering-knowledge.mjs";
import { executeRequirementProfile } from "../worker/technical-requirement-api.mjs";
import { executeProductMatching } from "../worker/product-matching-api.mjs";

const PROJECT_ID = "project_66d9c212-45ee-45ec-82c6-6e5a71146acd";
const ACTOR_ID = "local-development-user";
const DB_PATH = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";

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
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

const db = new D1Database(DB_PATH);
const id = (prefix) => `${prefix}_${randomUUID()}`;
const parse = (value, fallback = {}) => { try { return JSON.parse(value || ""); } catch { return fallback; } };
const source = (requirement) => parse(requirement.source_location, {});

const items = db.sqlite.prepare(`
  SELECT * FROM boq_items
  WHERE project_id=? AND row_type='BOQ Item' AND review_status='Approved'
  ORDER BY sequence
`).all(PROJECT_ID);
const requirements = db.sqlite.prepare(`
  SELECT * FROM technical_requirements
  WHERE project_id=? AND review_status NOT IN ('Rejected','Superseded')
  ORDER BY created_at, id
`).all(PROJECT_ID);

let suggestionsCreated = 0;
const shortlistCounts = [];
for (const item of items) {
  const shortlist = requirements.map((requirement) => ({
    requirement,
    suggestion: scoreRequirementLink({
      boqItem: { description: item.description, system: item.system_value, category: item.category, specificationReference: item.specification_reference },
      requirement: { originalText: requirement.original_text, system: requirement.system, category: requirement.category, source: source(requirement) },
    }),
  })).filter(({ requirement, suggestion }) => suggestion.confidence >= 25 || (/mandatory|required/i.test(requirement.requirement_type || "") && suggestion.confidence >= 15))
    .sort((left, right) => Number(/mandatory|required/i.test(right.requirement.requirement_type || "")) - Number(/mandatory|required/i.test(left.requirement.requirement_type || "")) || right.suggestion.confidence - left.suggestion.confidence)
    .slice(0, 40);

  shortlistCounts.push({ itemId: item.id, itemNumber: item.item_number, count: shortlist.length });
  for (const { requirement, suggestion } of shortlist) {
    const existing = db.sqlite.prepare("SELECT id FROM boq_requirement_links WHERE boq_item_id=? AND requirement_id=? AND superseded_at IS NULL").get(item.id, requirement.id);
    if (existing) continue;
    db.sqlite.prepare(`INSERT INTO boq_requirement_links
      (id, project_id, boq_item_id, requirement_id, link_method, confidence, evidence, status, scope_id, created_by)
      VALUES (?, ?, ?, ?, 'Deterministic bounded shortlist', ?, ?, 'Suggested', ?, ?)`)
      .run(id("boqRequirementLink"), PROJECT_ID, item.id, requirement.id, suggestion.confidence,
        JSON.stringify([...(suggestion.basis || []), `Requirement review status: ${requirement.review_status}`, `Approved for downstream: ${Boolean(requirement.approved_for_downstream)}`]), item.id, ACTOR_ID);
    suggestionsCreated += 1;
  }
}

const profileResults = [];
for (const item of items) profileResults.push({ itemId: item.id, ...(await executeRequirementProfile({ DB: db }, { itemId: item.id, userId: ACTOR_ID })) });

const matchResults = [];
for (const item of items) matchResults.push({ itemId: item.id, ...(await executeProductMatching({ DB: db }, { itemId: item.id, user: { id: ACTOR_ID, role: "Estimator" } })) });

const summary = {
  projectId: PROJECT_ID,
  confirmedItems: items.length,
  requirementsConsidered: requirements.length,
  suggestionsCreated,
  shortlist: {
    total: shortlistCounts.reduce((sum, row) => sum + row.count, 0),
    minimum: Math.min(...shortlistCounts.map((row) => row.count)),
    maximum: Math.max(...shortlistCounts.map((row) => row.count)),
    average: Number((shortlistCounts.reduce((sum, row) => sum + row.count, 0) / shortlistCounts.length).toFixed(1)),
  },
  profiles: profileResults.reduce((counts, row) => ({ ...counts, [row.profile?.readiness?.status || row.status]: (counts[row.profile?.readiness?.status || row.status] || 0) + 1 }), {}),
  matching: matchResults.reduce((counts, row) => ({ ...counts, [row.result?.status || row.status]: (counts[row.result?.status || row.status] || 0) + 1 }), {}),
  idempotentProfiles: profileResults.filter((row) => row.idempotent).length,
  idempotentMatches: matchResults.filter((row) => row.idempotent).length,
};
console.log(JSON.stringify(summary, null, 2));
