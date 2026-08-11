import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { safetyTechnicalApproved } from "../worker/review-workflow-api.mjs";

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

test("safety technical authority uses the latest decision rather than any historical approval", async () => {
  const raw = new DatabaseSync(":memory:");

  raw.exec(`
    CREATE TABLE safety_approval_requests (
      id TEXT PRIMARY KEY,
      safety_decision_id TEXT NOT NULL,
      approval_type TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT,
      decided_at TEXT
    );

    INSERT INTO safety_approval_requests (
      id, safety_decision_id, approval_type, status, created_at, decided_at
    ) VALUES
      (
        'safety-approved-old',
        'safety-1',
        'Technical',
        'Approved',
        '2026-08-10T10:00:00Z',
        '2026-08-10T10:00:00Z'
      ),
      (
        'safety-rejected-latest',
        'safety-1',
        'Technical',
        'Rejected',
        '2026-08-10T11:00:00Z',
        '2026-08-10T11:00:00Z'
      );
  `);

  const approved = await safetyTechnicalApproved(d1(raw), "safety-1");

  assert.equal(approved, false);

  raw.close();
});
