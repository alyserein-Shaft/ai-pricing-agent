import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { evaluationInput } from "../worker/confidence-safety-api.mjs";

const PROJECT_ID = "project-safety-authority";

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

const fixture = () => {
  const raw = new DatabaseSync(":memory:");

  raw.exec(`
    CREATE TABLE requirement_profile_versions (
      id TEXT PRIMARY KEY,
      profile TEXT
    );

    CREATE TABLE product_match_comparisons (
      id TEXT PRIMARY KEY,
      candidate_id TEXT,
      comparison_type TEXT,
      blocking INTEGER
    );

    CREATE TABLE price_records (
      id TEXT PRIMARY KEY,
      product_id TEXT,
      project_id TEXT,
      approval_status TEXT,
      valid_until TEXT,
      currency TEXT
    );

    CREATE TABLE safety_decisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      superseded_at TEXT
    );

    CREATE TABLE safety_approval_requests (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      safety_decision_id TEXT NOT NULL,
      approval_type TEXT NOT NULL,
      status TEXT NOT NULL,
      decided_at TEXT
    );

    INSERT INTO requirement_profile_versions (
      id, profile
    ) VALUES (
      'requirement-1',
      '{}'
    );

    INSERT INTO safety_decisions (
      id, project_id, candidate_id, version_number, superseded_at
    ) VALUES
      (
        'safety-candidate-a',
        '${PROJECT_ID}',
        'candidate-a',
        1,
        NULL
      ),
      (
        'safety-candidate-b',
        '${PROJECT_ID}',
        'candidate-b',
        1,
        NULL
      );

    INSERT INTO safety_approval_requests (
      id,
      project_id,
      safety_decision_id,
      approval_type,
      status,
      decided_at
    ) VALUES
      (
        'candidate-a-approved-old',
        '${PROJECT_ID}',
        'safety-candidate-a',
        'Technical',
        'Approved',
        '2026-08-10T10:00:00Z'
      ),
      (
        'candidate-a-rejected-latest',
        '${PROJECT_ID}',
        'safety-candidate-a',
        'Technical',
        'Rejected',
        '2026-08-10T11:00:00Z'
      ),
      (
        'candidate-b-approved',
        '${PROJECT_ID}',
        'safety-candidate-b',
        'Technical',
        'Approved',
        '2026-08-10T12:00:00Z'
      );
  `);

  return { raw, db: d1(raw) };
};

const row = (candidateId) => ({
  id: candidateId,
  project_id: PROJECT_ID,
  requirement_profile_version_id: "requirement-1",

  current_values: "{}",

  product_id: "product-1",
  part_number: "PART-1",
  product_review_status: "Reviewed",

  recommendation_tier: "Primary",
  confidence_state: "High",
  search_stage: "Structured",
  technical_status: "Eligible",

  mandatory_failures: "[]",
  lifecycle_result: "{}",
  commercial_availability: "Available",

  system_value: "Fire Alarm",
  item_category: "Detector",
  item_description: "Smoke detector",
  normalized_unit: "EA",
  numeric_quantity: 1,
  product_family: "Detector",

  source_document_id: "doc-1",
  source_location: "{}",
  extraction_confidence: 100,
  confidence_score: 100,
});

const user = {
  id: "local-development-user",
  role: "Admin",
};

test("safety evaluation uses latest Technical decision for the exact candidate", async () => {
  const { raw, db } = fixture();

  const input = await evaluationInput(
    db,
    row("candidate-a"),
    user,
  );

  assert.equal(
    input.technicalApproval,
    null,
    "latest Rejected must override candidate A's historical Approved",
  );

  raw.close();
});

test("safety evaluation cannot inherit Technical approval from another candidate in the project", async () => {
  const { raw, db } = fixture();

  raw.prepare(`
    DELETE FROM safety_approval_requests
    WHERE safety_decision_id='safety-candidate-a'
  `).run();

  const input = await evaluationInput(
    db,
    row("candidate-a"),
    user,
  );

  assert.equal(
    input.technicalApproval,
    null,
    "candidate B approval must never authorize candidate A",
  );

  raw.close();
});
