import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { handleQuotationApi } from "../worker/quotation-api.mjs";

const d1 = (raw) => ({
  prepare(sql) {
    const state = { values: [] };
    return {
      bind(...values) {
        state.values = values;
        return this;
      },
      first() {
        return raw.prepare(sql).get(...state.values) || null;
      },
      all() {
        return { results: raw.prepare(sql).all(...state.values) };
      },
    };
  },
});

const makeEnv = () => {
  const raw = new DatabaseSync(":memory:");

  raw.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      organization_id TEXT,
      owner_user_id TEXT
    );

    CREATE TABLE project_members (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      user_id TEXT,
      status TEXT,
      revoked_at TEXT
    );

    CREATE TABLE project_quotation_revisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      revision_number INTEGER NOT NULL,
      quotation_fingerprint TEXT NOT NULL,
      workflow_snapshot_id TEXT NOT NULL,
      currency TEXT NOT NULL,
      subtotal_minor INTEGER NOT NULL,
      vat_basis_points INTEGER NOT NULL,
      vat_minor INTEGER NOT NULL,
      total_minor INTEGER NOT NULL,
      terms_json TEXT NOT NULL,
      source_summary_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      approved_at TEXT,
      issued_at TEXT,
      superseded_at TEXT,
      evidence_fingerprint TEXT,
      evidence_manifest_json TEXT,
      terms_provenance_json TEXT
    );

    CREATE TABLE project_quotation_lines (
      id TEXT PRIMARY KEY,
      quotation_revision_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      boq_item_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      item_number TEXT,
      description TEXT,
      unit TEXT NOT NULL,
      quantity TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      manufacturer_name TEXT NOT NULL,
      part_number TEXT NOT NULL,
      product_description TEXT NOT NULL,
      pricing_run_id TEXT NOT NULL,
      pricing_run_version INTEGER NOT NULL,
      pricing_line_id TEXT NOT NULL,
      pricing_line_version INTEGER NOT NULL,
      pricing_input_fingerprint TEXT NOT NULL,
      commercial_approval_id TEXT NOT NULL,
      commercial_approval_version INTEGER NOT NULL,
      currency TEXT NOT NULL,
      total_cost_minor INTEGER NOT NULL,
      net_selling_minor INTEGER NOT NULL,
      source_snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    INSERT INTO projects VALUES
      ('p1','organization_bd_shaft_internal_pilot','local-development-user'),
      ('p2','organization_bd_shaft_internal_pilot','other-user');

    INSERT INTO project_quotation_revisions VALUES (
      'q1','p1',1,'qf1','s1','SAR',
      250000,1500,37500,287500,
      '{"validityDays":30,"warrantyMonths":12,"delivery":"4-6 weeks","paymentTerms":"50% advance","exclusions":["Civil works"],"client":"Client A"}',
      '{"quotationHeader":{"projectName":"Central Kitchen","client":"Client A","tenderNumber":"T-100","location":"Makkah","packageName":"Fire Alarm","currency":"SAR","quotationDate":"2026-08-29T19:00:00.000Z"}}',
      'Approved','local-development-user',
      '2026-08-29T19:00:00.000Z',
      '2026-08-29T19:20:00.000Z',
      NULL,
      NULL,
      'ef1',
      '{"internal":true}',
      '{"internal":true}'
    );

    INSERT INTO project_quotation_revisions VALUES (
      'q2','p2',1,'qf2','s2','SAR',
      100000,1500,15000,115000,
      '{"client":"Other Client"}',
      '{"quotationHeader":{"projectName":"Other Project","client":"Other Client","currency":"SAR","quotationDate":"2026-08-29T19:00:00.000Z"}}',
      'Approved','other-user',
      '2026-08-29T19:00:00.000Z',
      NULL,NULL,NULL,
      'ef2',
      '{}',
      '{}'
    );

    INSERT INTO project_quotation_lines VALUES (
      'ql1','q1','p1','b1',
      1,'FA-01','Addressable smoke detector','EA','10',
      'candidate1','product1','Honeywell','ABC-123',
      'Addressable Photoelectric Smoke Detector',
      'run1',3,'pricingLine1',1,'pricing-fp',
      'approval1',3,
      'SAR',150000,250000,'{"internal":true}',
      '2026-08-29T19:00:00.000Z'
    );

    INSERT INTO project_quotation_lines VALUES (
      'ql2','q2','p2','b2',
      1,'X-01','Other line','EA','1',
      'candidate2','product2','Other','X-1',
      'Other product',
      'run2',1,'pricingLine2',1,'fp2',
      'approval2',1,
      'SAR',50000,100000,'{}',
      '2026-08-29T19:00:00.000Z'
    );
  `);

  return {
    DB: d1(raw),
    APP_ACCESS_MODE: "single-user",
    APP_USER_ID: "local-development-user",
    APP_ORGANIZATION_ID: "organization_bd_shaft_internal_pilot",
    APP_USER_EMAIL: "local@test.invalid",
    APP_USER_NAME: "Local Test User",
  };
};

test("returns a client-safe historical quotation revision", async () => {
  const env = makeEnv();

  const response = await handleQuotationApi(
    new Request("http://localhost/api/projects/p1/quotations/q1"),
    env,
  );

  assert.equal(response.status, 200);

  const body = await response.json();

  assert.equal(body.quotation.header.projectName, "Central Kitchen");
  assert.equal(body.quotation.header.status, "Approved");
  assert.equal(body.quotation.lines.length, 1);
  assert.equal(body.quotation.lines[0].manufacturer, "Honeywell");
  assert.equal(body.quotation.lines[0].partNumber, "ABC-123");
  assert.equal(body.quotation.lines[0].lineTotalMinor, 250000);
  assert.equal(body.quotation.summary.totalMinor, 287500);

  const serialized = JSON.stringify(body);

  for (const forbidden of [
    "total_cost_minor",
    "commercial_approval_id",
    "pricing_run_id",
    "pricing_line_id",
    "quotation_fingerprint",
    "evidence_fingerprint",
    "source_snapshot_json",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("does not expose a quotation revision through the wrong project", async () => {
  const env = makeEnv();

  const response = await handleQuotationApi(
    new Request("http://localhost/api/projects/p1/quotations/q2"),
    env,
  );

  assert.equal(response.status, 404);

  const body = await response.json();
  assert.equal(body.error.code, "QUOTATION_REVISION_NOT_FOUND");
});

test("project access blocks quotation reads outside the current user boundary", async () => {
  const env = makeEnv();

  const response = await handleQuotationApi(
    new Request("http://localhost/api/projects/p2/quotations/q2"),
    env,
  );

  assert.equal(response.status, 404);

  const body = await response.json();
  assert.equal(body.error.code, "PROJECT_NOT_FOUND");
});

test("quotation read API depends only on stored revision and quotation lines", async () => {
  const env = makeEnv();

  const response = await handleQuotationApi(
    new Request("http://localhost/api/projects/p1/quotations/q1"),
    env,
  );

  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.quotation.lines[0].productDescription, "Addressable Photoelectric Smoke Detector");
});
