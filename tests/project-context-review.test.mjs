import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import {
  reviewProjectContextFact,
} from "../worker/project-context-api.mjs";

const d1 = raw => ({
  prepare(sql) {
    const operation = (values = []) => ({
      first: async () => raw.prepare(sql).get(...values) || null,
      all: async () => ({ results: raw.prepare(sql).all(...values) }),
      run: async () => {
        const result = raw.prepare(sql).run(...values);
        return { meta: { changes: Number(result.changes) } };
      },
    });
    return {
      ...operation(),
      bind: (...values) => operation(values),
    };
  },
  async batch(statements) {
    raw.exec("BEGIN IMMEDIATE");
    try {
      const output = [];
      for (const statement of statements) {
        output.push(await statement.run());
      }
      raw.exec("COMMIT");
      return output;
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  },
});

const migration = await readFile(
  new URL("../drizzle/0057_project_context_intake.sql", import.meta.url),
  "utf8",
);

const fixture = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT);
    CREATE TABLE documents(id TEXT PRIMARY KEY,project_id TEXT);
    CREATE TABLE document_versions(id TEXT PRIMARY KEY,document_id TEXT);
    CREATE TABLE document_classifications(id TEXT PRIMARY KEY);
    CREATE TABLE boq_items(
      id TEXT PRIMARY KEY,
      project_id TEXT,
      description TEXT
    );
  `);
  raw.exec(migration);
  raw.exec(`
    INSERT INTO projects VALUES ('project-a','Original project');
    INSERT INTO documents VALUES ('document-a','project-a');
    INSERT INTO document_versions VALUES ('version-a','document-a');
    INSERT INTO document_classifications VALUES ('classification-a');
    INSERT INTO boq_items VALUES ('boq-a','project-a','Original BOQ');
    INSERT INTO project_context_extraction_versions
      (id,project_id,document_id,document_version_id,classification_id,
       version_number,source_checksum,parser_version,input_fingerprint,
       status,review_status,summary_json,created_by)
    VALUES
      ('extraction-a','project-a','document-a','version-a',
       'classification-a',1,'sha-a','parser:1','sha-a:parser',
       'Completed','Needs Review','{}','user-a');
    INSERT INTO project_context_facts
      (id,extraction_version_id,project_id,document_id,
       document_version_id,fact_key,label,extracted_value,
       normalized_value,value_origin,confidence,source_sheet,
       source_row,source_cell,source_label_cell,
       requires_ai_interpretation,review_status)
    VALUES
      ('fact-a','extraction-a','project-a','document-a',
       'version-a','project_name','Project Name',
       'Original extracted value','Original extracted value',
       'EXTRACTED',100,'Project name ',5,'B5','A5',0,
       'Needs Review');
  `);
  return { raw, DB: d1(raw) };
};

const review = (
  DB,
  action,
  overrides = {},
) => reviewProjectContextFact(DB, {
  projectId: "project-a",
  factId: "fact-a",
  action,
  reason: "Verified against the cited source workbook cell.",
  actorId: "reviewer-a",
  requestId: `${action}-request`,
  stamp: "2026-08-12T18:45:00Z",
  ...overrides,
});

test("review requires substantive reason and durable request id", async () => {
  const { raw, DB } = fixture();

  let response = await review(DB, "approve", {
    reason: "short",
  });
  assert.equal(response.status, 422);

  response = await review(DB, "approve", {
    requestId: "",
  });
  assert.equal(response.status, 422);

  assert.equal(
    raw.prepare(
      "SELECT review_status FROM project_context_facts WHERE id='fact-a'",
    ).get().review_status,
    "Needs Review",
  );
  assert.equal(
    raw.prepare(
      "SELECT COUNT(*) count FROM project_context_review_events",
    ).get().count,
    0,
  );

  raw.close();
});

test("approve retains immutable extracted value", async () => {
  const { raw, DB } = fixture();

  const response = await review(DB, "approve");
  assert.equal(response.status, 201);

  const fact = raw.prepare(
    "SELECT * FROM project_context_facts WHERE id='fact-a'",
  ).get();

  assert.equal(fact.review_status, "Approved");
  assert.equal(fact.extracted_value, "Original extracted value");
  assert.equal(fact.reviewed_value, "Original extracted value");

  raw.close();
});

test("edit preserves extraction and records corrected reviewed value", async () => {
  const { raw, DB } = fixture();
  const projectBefore = raw.prepare(
    "SELECT * FROM projects WHERE id='project-a'",
  ).get();
  const boqBefore = raw.prepare(
    "SELECT * FROM boq_items WHERE id='boq-a'",
  ).get();

  const response = await review(DB, "edit", {
    reviewedValue: "Corrected reviewed value",
  });
  assert.equal(response.status, 201);

  const fact = raw.prepare(
    "SELECT * FROM project_context_facts WHERE id='fact-a'",
  ).get();

  assert.equal(fact.review_status, "Edited");
  assert.equal(fact.extracted_value, "Original extracted value");
  assert.equal(fact.reviewed_value, "Corrected reviewed value");

  assert.deepEqual(
    raw.prepare("SELECT * FROM projects WHERE id='project-a'").get(),
    projectBefore,
  );
  assert.deepEqual(
    raw.prepare("SELECT * FROM boq_items WHERE id='boq-a'").get(),
    boqBefore,
  );

  raw.close();
});

test("reject records no usable reviewed value", async () => {
  const { raw, DB } = fixture();

  const response = await review(DB, "reject");
  assert.equal(response.status, 201);

  const fact = raw.prepare(
    "SELECT * FROM project_context_facts WHERE id='fact-a'",
  ).get();

  assert.equal(fact.review_status, "Rejected");
  assert.equal(fact.extracted_value, "Original extracted value");
  assert.equal(fact.reviewed_value, null);

  raw.close();
});

test("review replay is idempotent and creates one audit event", async () => {
  const { raw, DB } = fixture();

  const first = await review(DB, "approve");
  const second = await review(DB, "approve");

  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).idempotent, true);
  assert.equal(
    raw.prepare(
      "SELECT COUNT(*) count FROM project_context_review_events",
    ).get().count,
    1,
  );

  raw.close();
});
