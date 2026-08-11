import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { technicalApproved } from "../worker/review-workflow-api.mjs";

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (args = []) => ({
      first: async () => raw.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
      run: async () => raw.prepare(sql).run(...args),
    });
    return {
      ...operation(),
      bind(...args) {
        return operation(args);
      },
    };
  },
});

test("technical review authority uses the latest technical decision rather than any historical approval", async () => {
  const raw = new DatabaseSync(":memory:");

  raw.exec(`
    CREATE TABLE review_decisions (
      id TEXT PRIMARY KEY,
      review_item_id TEXT NOT NULL,
      decision_type TEXT NOT NULL,
      outcome TEXT NOT NULL,
      decided_at TEXT NOT NULL
    );

    INSERT INTO review_decisions (
      id, review_item_id, decision_type, outcome, decided_at
    ) VALUES
      (
        'technical-approved-old',
        'review-1',
        'Approve Technical Match',
        'Approved',
        '2026-08-10T10:00:00Z'
      ),
      (
        'technical-rejected-latest',
        'review-1',
        'Approve Technical Match',
        'Rejected',
        '2026-08-10T11:00:00Z'
      );
  `);

  const approved = await technicalApproved(d1(raw), "review-1");

  assert.equal(approved, false);

  raw.close();
});
