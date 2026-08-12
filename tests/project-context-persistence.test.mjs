import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import {
  persistProjectContextExtraction,
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
      const results = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      raw.exec("COMMIT");
      return results;
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
    CREATE TABLE projects(
      id TEXT PRIMARY KEY,
      name TEXT,
      owner_user_id TEXT,
      system_domain TEXT
    );
    CREATE TABLE documents(
      id TEXT PRIMARY KEY,
      project_id TEXT,
      current_version_id TEXT,
      document_type TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );
    CREATE TABLE document_versions(
      id TEXT PRIMARY KEY,
      document_id TEXT,
      original_filename TEXT,
      sha256 TEXT,
      FOREIGN KEY(document_id) REFERENCES documents(id)
    );
    CREATE TABLE document_classifications(
      id TEXT PRIMARY KEY,
      document_id TEXT,
      primary_type TEXT
    );
    CREATE TABLE boq_items(
      id TEXT PRIMARY KEY,
      project_id TEXT,
      description TEXT
    );
  `);
  raw.exec(migration);
  raw.exec(`
    INSERT INTO projects VALUES
      ('project-a','Original Project','user-a','Fire Alarm');
    INSERT INTO documents VALUES
      ('document-a','project-a','version-a','Project Context');
    INSERT INTO document_versions VALUES
      ('version-a','document-a','context.xlsx','sha-a');
    INSERT INTO document_classifications VALUES
      ('classification-a','document-a','Project Context');
    INSERT INTO boq_items VALUES
      ('boq-a','project-a','Existing immutable BOQ item');
  `);
  return { raw, DB: d1(raw) };
};

const document = {
  id: "document-a",
  project_id: "project-a",
  current_version_id: "version-a",
  sha256: "sha-a",
};

const result = {
  parser: "native-openxml",
  parserVersion: "project-context-xlsx-1.0.0",
  sourceSheet: "Project name ",
  missingFields: ["budget_range"],
  summary: {
    extractedFacts: 2,
    approvedFacts: 0,
    needsReview: 2,
    aiInterpretationRequired: 1,
    missingFields: 1,
  },
  facts: [
    {
      key: "project_name",
      label: "Project Name:",
      value: "Bab Al-Khair Hospital",
      normalizedValue: "Bab Al-Khair Hospital",
      origin: "EXTRACTED",
      confidence: 100,
      reviewStatus: "Needs Review",
      requiresAiInterpretation: false,
      source: {
        sheet: "Project name ",
        row: 5,
        cell: "B5",
        labelCell: "A5",
      },
    },
    {
      key: "commercial_instruction",
      label: "Budget:",
      value: "Use cheapest compliant brand.",
      normalizedValue: "Use cheapest compliant brand.",
      origin: "EXTRACTED",
      confidence: 100,
      reviewStatus: "Needs Review",
      requiresAiInterpretation: true,
      source: {
        sheet: "Project name ",
        row: 12,
        cell: "E12",
        labelCell: "B12",
      },
    },
  ],
};

test("persists source-backed Project Context facts without applying them", async () => {
  const { raw, DB } = fixture();

  const projectBefore = raw.prepare(
    "SELECT * FROM projects WHERE id='project-a'",
  ).get();
  const boqBefore = raw.prepare(
    "SELECT * FROM boq_items WHERE id='boq-a'",
  ).get();

  const output = await persistProjectContextExtraction(DB, {
    document,
    classificationId: "classification-a",
    result,
    userId: "user-a",
    requestId: "request-a",
    stamp: "2026-08-12T18:30:00Z",
  });

  assert.equal(output.idempotent, false);

  const facts = raw.prepare(
    "SELECT * FROM project_context_facts ORDER BY fact_key",
  ).all();

  assert.equal(facts.length, 2);
  assert.deepEqual(
    facts.map(fact => fact.review_status),
    ["Needs Review", "Needs Review"],
  );
  assert.equal(
    facts.find(fact => fact.fact_key === "project_name").source_cell,
    "B5",
  );
  assert.equal(
    facts.find(
      fact => fact.fact_key === "commercial_instruction",
    ).requires_ai_interpretation,
    1,
  );

  assert.deepEqual(
    raw.prepare("SELECT * FROM projects WHERE id='project-a'").get(),
    projectBefore,
  );
  assert.deepEqual(
    raw.prepare("SELECT * FROM boq_items WHERE id='boq-a'").get(),
    boqBefore,
  );

  assert.equal(
    raw.prepare(
      "SELECT COUNT(*) AS count FROM project_context_review_events",
    ).get().count,
    1,
  );

  raw.close();
});

test("replaying the same document and parser is idempotent", async () => {
  const { raw, DB } = fixture();

  const first = await persistProjectContextExtraction(DB, {
    document,
    classificationId: "classification-a",
    result,
    userId: "user-a",
    requestId: "request-a",
  });

  const second = await persistProjectContextExtraction(DB, {
    document,
    classificationId: "classification-a",
    result,
    userId: "user-a",
    requestId: "request-b",
  });

  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(
    raw.prepare(
      "SELECT COUNT(*) AS count FROM project_context_extraction_versions",
    ).get().count,
    1,
  );
  assert.equal(
    raw.prepare(
      "SELECT COUNT(*) AS count FROM project_context_facts",
    ).get().count,
    2,
  );
  assert.equal(
    raw.prepare(
      "SELECT COUNT(*) AS count FROM project_context_review_events",
    ).get().count,
    1,
  );

  raw.close();
});
