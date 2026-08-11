import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { latestSafety } from "../worker/review-workflow-api.mjs";

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

test("latestSafety uses the latest Technical approval decision rather than any historical approval", async () => {
  const raw = new DatabaseSync(":memory:");

  raw.exec(`
    CREATE TABLE safety_decisions (
      id TEXT PRIMARY KEY,
      boq_item_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      technical_eligibility TEXT NOT NULL,
      superseded_at TEXT
    );

    CREATE TABLE safety_approval_requests (
      id TEXT PRIMARY KEY,
      safety_decision_id TEXT NOT NULL,
      approval_type TEXT NOT NULL,
      status TEXT NOT NULL,
      decided_at TEXT
    );

    INSERT INTO safety_decisions (
      id,
      boq_item_id,
      version_number,
      technical_eligibility,
      superseded_at
    ) VALUES (
      'safety-current',
      'boq-1',
      1,
      'Blocked',
      NULL
    );

    INSERT INTO safety_approval_requests (
      id,
      safety_decision_id,
      approval_type,
      status,
      decided_at
    ) VALUES
      (
        'technical-approved-old',
        'safety-current',
        'Technical',
        'Approved',
        '2026-08-10T10:00:00Z'
      ),
      (
        'technical-rejected-latest',
        'safety-current',
        'Technical',
        'Rejected',
        '2026-08-10T11:00:00Z'
      );
  `);

  const safety = await latestSafety(
    d1(raw),
    {
      boq_item_id: "boq-1",
    },
  );

  assert.ok(safety);

  assert.equal(
    safety.technical_eligibility,
    "Blocked",
    "latest Rejected must prevent an older Approved from overriding current technical eligibility",
  );

  raw.close();
});
