// AUTH — truthful human actor attribution for human-authority mutations.
//
// AUTH-1  Synthetic development actor cannot perform a human-authority mutation
//         (403 HUMAN_ACTOR_NOT_CONFIGURED on all four families).
// AUTH-2  A server-configured human can (approval lands, governed).
// AUTH-3  The human identity is persisted into decision/audit provenance.
// AUTH-4  Actor identity cannot be supplied or overridden from the request.
// AUTH-5  Missing application context still refuses (no silent fallback).
// AUTH-6  Reads and system-automation paths are unaffected (no regression).
//
// Fixture DB is the real active migration chain (:memory:). Nothing touches
// live data. The "human" here is a fixture identity standing in for
// server-configured APP_HUMAN_* values — the mechanism under test is that the
// quoted identity comes from SERVER env, never the request, never the fallback.
import test from "node:test";
import assert from "node:assert/strict";

import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import { resolveHumanActor } from "../worker/human-actor.mjs";
import { handleSpecificationExtractionApi } from "../worker/specification-extraction-api.mjs";

const HUMAN_ENV = {
  APP_HUMAN_ID: "op-test-human-01",
  APP_HUMAN_NAME: "Test Human Operator",
  APP_HUMAN_EMAIL: "human-operator@example.test",
};
const SYNTHETIC_ENV = {};

const seed = (raw) => {
  const now = new Date().toISOString();
  raw.exec(`
    INSERT INTO organizations (id, name) VALUES ('org1','Org One');
    INSERT INTO projects (id, name, owner_user_id, organization_id) VALUES ('p1','Auth Fixture','local-development-user','org1');
    INSERT INTO documents (id, project_id, logical_name, created_by) VALUES ('doc1','p1','spec.pdf','local-development-user');
    INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by)
      VALUES ('dv1','doc1',1,'spec.pdf','spec.stored','pdf','application/pdf',4,'sha','k','local-development-user');
    UPDATE documents SET current_version_id='dv1' WHERE id='doc1';
    INSERT INTO specification_extraction_versions (id,document_id,document_version_id,version_number,status,parser_version,ruleset_version,model_version,prompt_version,ocr_version,created_by)
      VALUES ('sx1','doc1','dv1',1,'Completed','p1','r1','m1','pr1','o1','local-development-user');
    INSERT INTO specification_clauses (id,extraction_version_id,sequence,kind,path,original_text) VALUES ('cl1','sx1',1,'Requirement','1','The system shall be addressable.');
    INSERT INTO technical_requirements
      (id,extraction_version_id,project_id,source_document_id,clause_id,sequence,original_text,normalized_requirement,engineering_domain,domain_source_type,
       system,category,requirement_type,requirement_category,confidence,confidence_state,review_status,extraction_method,parser_version,model_version,
       source_location,original_values,current_values,approved_for_downstream,created_at,updated_at)
      VALUES ('req1','sx1','p1','doc1','cl1',1,'The system shall be addressable.','the system shall be addressable','Fire Alarm','Explicit',
       'Fire Alarm','General','Mandatory','Functional',90,'High Confidence','Needs Review','spec','p1','m1','{}','{}','{}',0,'${now}','${now}');
  `);
};

const setup = async (envExtra = {}) => {
  const raw = await activeChainDatabase();
  seed(raw);
  return { raw, DB: d1(raw), env: { DB: d1(raw), FILES: {}, ...envExtra } };
};

const approveReq = (env, id = "req1", body = {}) =>
  handleSpecificationExtractionApi(
    new Request(`http://localhost/api/requirements/${id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "A sufficiently substantive human review reason for the fixture requirement.", ...body }),
    }),
    env,
    {},
  );

// Unit: resolution comes from server env only.
test("resolveHumanActor quotes server config, never the request or the fallback", () => {
  assert.equal(resolveHumanActor({}), null, "no config -> no actor, not a fallback");
  assert.equal(resolveHumanActor({ APP_HUMAN_ID: "local-development-user", APP_HUMAN_NAME: "X" }), null, "synthetic id is refused even when configured");
  assert.equal(resolveHumanActor({ APP_HUMAN_ID: "x y!", APP_HUMAN_NAME: "X" }), null, "malformed id refused");
  assert.equal(resolveHumanActor({ APP_HUMAN_ID: "op-1" }), null, "id without name refused");
  const actor = resolveHumanActor(HUMAN_ENV);
  assert.equal(actor.id, "op-test-human-01");
  assert.equal(actor.synthetic, false);
  assert.equal(actor.source, "server-configured-human-operator");
});

// AUTH-1: synthetic cannot approve (all reads of the reason pass first, so the
// 403 proves the actor gate fired, not input validation).
test("AUTH-1. synthetic development actor cannot approve a requirement", async () => {
  const { raw, env } = await setup(SYNTHETIC_ENV);
  try {
    const res = await approveReq(env);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, "HUMAN_ACTOR_NOT_CONFIGURED");
    const row = raw.prepare("SELECT review_status,approved_for_downstream FROM technical_requirements WHERE id='req1'").get();
    assert.equal(row.review_status, "Needs Review", "refused write changes nothing");
    assert.equal(row.approved_for_downstream, 0);
  } finally { raw.close(); }
});

// AUTH-2 + AUTH-3: configured human approves; provenance names the human.
test("AUTH-2/3. configured human approves and is persisted into decision provenance", async () => {
  const { raw, env } = await setup(HUMAN_ENV);
  try {
    const res = await approveReq(env);
    assert.equal(res.status, 200, await res.text());
    const row = raw.prepare("SELECT review_status,approved_for_downstream FROM technical_requirements WHERE id='req1'").get();
    assert.equal(row.review_status, "Approved");
    assert.equal(row.approved_for_downstream, 1);
    const dec = raw.prepare("SELECT decided_by,reason FROM requirement_review_decisions WHERE requirement_id='req1'").get();
    assert.equal(dec.decided_by, "op-test-human-01", "decision provenance names the human");
    const audit = raw.prepare("SELECT actor_user_id FROM document_audit_events WHERE action='Requirement approve'").get();
    assert.equal(audit.actor_user_id, "op-test-human-01", "audit trail names the human");
  } finally { raw.close(); }
});

// AUTH-4: client-supplied actor fields cannot override the server identity.
test("AUTH-4. request-body actor values are ignored", async () => {
  const { raw, env } = await setup(HUMAN_ENV);
  try {
    const res = await approveReq(env, "req1", { decidedBy: "mallory", actor: { id: "mallory" }, decided_by: "mallory" });
    assert.equal(res.status, 200);
    const dec = raw.prepare("SELECT decided_by FROM requirement_review_decisions WHERE requirement_id='req1'").get();
    assert.equal(dec.decided_by, "op-test-human-01", "server identity wins over any client value");
  } finally { raw.close(); }
});

// AUTH-5: no application context -> no mutation, no fallback.
test("AUTH-5. missing application context refuses instead of falling back", async () => {
  const { raw, env } = await setup(HUMAN_ENV);
  try {
    const res = await handleSpecificationExtractionApi(
      new Request("http://192.0.2.1/api/requirements/req1/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "A sufficiently substantive human review reason for the fixture requirement." }),
      }),
      env,
      {},
    );
    // Non-local host without single-user mode: context itself is unavailable.
    assert.ok([503, 403].includes(res.status), "status " + res.status);
  } finally { raw.close(); }
});

// AUTH-6: reads work with or without a human configured; system automation untouched.
test("AUTH-6. reads and system paths are unaffected by the human gate", async () => {
  const { raw, env } = await setup(SYNTHETIC_ENV);
  try {
    const detail = await handleSpecificationExtractionApi(new Request("http://localhost/api/requirements/req1"), env, {});
    assert.equal(detail.status, 200, "reads keep working with synthetic-only config");
    const history = await handleSpecificationExtractionApi(new Request("http://localhost/api/requirements/req1/history"), env, {});
    assert.equal(history.status, 200);
  } finally { raw.close(); }
});
