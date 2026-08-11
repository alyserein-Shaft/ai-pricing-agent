import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readinessForProject } from "../worker/excel-export-api.mjs";

const PROJECT_ID = "project-export-scope";

const fixture = () => {
  const raw = new DatabaseSync(":memory:");

  raw.exec(`
    CREATE TABLE boq_extraction_versions (
      id TEXT PRIMARY KEY,
      superseded_at TEXT
    );

    CREATE TABLE boq_items (
      id TEXT PRIMARY KEY,
      extraction_version_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      row_type TEXT NOT NULL
    );

    CREATE TABLE review_queue_items (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      boq_item_id TEXT,
      review_type TEXT NOT NULL,
      status TEXT NOT NULL,
      blocking INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT
    );

    CREATE TABLE review_clarifications (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      review_item_id TEXT NOT NULL,
      status TEXT NOT NULL
    );

    INSERT INTO boq_extraction_versions (id, superseded_at) VALUES
      ('boq-current-version', NULL),
      ('boq-old-version', '2026-08-10T12:00:00Z');

    INSERT INTO boq_items (id, extraction_version_id, project_id, row_type) VALUES
      ('boq-current', 'boq-current-version', '${PROJECT_ID}', 'BOQ Item'),
      ('boq-old', 'boq-old-version', '${PROJECT_ID}', 'BOQ Item');

    INSERT INTO review_queue_items (
      id, project_id, boq_item_id, review_type, status, blocking, deleted_at
    ) VALUES
      ('review-current', '${PROJECT_ID}', 'boq-current', 'Technical Review', 'Approved', 0, NULL),
      ('review-old-blocked', '${PROJECT_ID}', 'boq-old', 'Technical Review', 'Blocked', 1, NULL);

    INSERT INTO review_clarifications (
      id, project_id, review_item_id, status
    ) VALUES
      ('clarification-old', '${PROJECT_ID}', 'review-old-blocked', 'Open');
  `);

  const operation = (sql, args = []) => ({
    first: async () => raw.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: raw.prepare(sql).all(...args) }),
    run: async () => raw.prepare(sql).run(...args),
  });

  const db = {
    prepare(sql) {
      return {
        ...operation(sql),
        bind: (...args) => operation(sql, args),
      };
    },
  };

  return { raw, db };
};

test("superseded BOQ review and clarification do not block current export readiness", async () => {
  const { raw, db } = fixture();

  const readiness = await readinessForProject(db, PROJECT_ID);

  assert.equal(readiness, "Ready for Quotation");

  raw.close();
});

test("project-level blocking review remains authoritative", async () => {
  const { raw, db } = fixture();

  raw.prepare(`
    INSERT INTO review_queue_items (
      id, project_id, boq_item_id, review_type, status, blocking, deleted_at
    ) VALUES (?, ?, NULL, 'Commercial Review', 'Blocked', 1, NULL)
  `).run("project-level-block", PROJECT_ID);

  const readiness = await readinessForProject(db, PROJECT_ID);

  assert.equal(readiness, "Exceptions Pending");

  raw.close();
});
