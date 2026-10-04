import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { handleSpecificationExtractionApi } from "../specification-extraction-api.mjs";

// Spec Requirement Auto-Confirm Wiring -- narrow, route-level tests for the
// new governed operation POST /api/projects/:id/specification-requirements/
// auto-confirm. These prove the WIRING (authorization, project scoping,
// mutation boundary, audit, response shape) end-to-end against the real,
// unmodified worker/spec-requirement-auto-confirm.mjs engine -- they
// deliberately do not re-derive or re-assert every one of that engine's 12
// gates in isolation (worker/__tests__/spec-requirement-auto-confirm.test.mjs
// and tests/spec-auto-confirm.test.mjs already do that exhaustively); each
// gate category here is exercised once, at the route level, to prove the
// wiring delegates to the real gate logic rather than reimplementing it.
//
// All state lives in a fresh in-memory SQLite database per test -- no live
// project (Al Mousa or otherwise) is ever touched, per this task's explicit
// boundary.

const id = (prefix) => `${prefix}_${Math.random().toString(36).slice(2)}`;

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (args = []) => ({
      first: async () => raw.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
      run: async () => raw.prepare(sql).run(...args),
    });
    return { ...operation(), bind: (...args) => operation(args) };
  },
  async batch(statements) {
    raw.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      raw.exec("COMMIT");
      return results;
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  },
});

const schema = `
PRAGMA foreign_keys=OFF;
CREATE TABLE projects(id TEXT PRIMARY KEY, owner_user_id TEXT, organization_id TEXT, name TEXT, archived_at TEXT);
CREATE TABLE specification_extraction_jobs(id TEXT PRIMARY KEY, extraction_version_id TEXT, document_id TEXT, document_version_id TEXT, project_id TEXT, status TEXT, total_pages INTEGER DEFAULT 1, remaining_chunks INTEGER DEFAULT 0, chunk_size INTEGER DEFAULT 1, worker_version TEXT DEFAULT 'v1', source_fingerprint TEXT DEFAULT 'fp', resume_token TEXT DEFAULT 'rt', requested_by TEXT, completed_at TEXT);
CREATE TABLE specification_extraction_versions(id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, version_number INTEGER DEFAULT 1, status TEXT DEFAULT 'Completed', parser_version TEXT DEFAULT 'v1', ruleset_version TEXT DEFAULT 'v1', model_version TEXT DEFAULT 'v1', prompt_version TEXT DEFAULT 'v1', ocr_version TEXT DEFAULT 'v1', summary TEXT DEFAULT '{}', superseded_at TEXT, created_by TEXT);
CREATE TABLE technical_requirements(id TEXT PRIMARY KEY, extraction_version_id TEXT, project_id TEXT, source_document_id TEXT, clause_id TEXT, sequence INTEGER, original_text TEXT, normalized_requirement TEXT, engineering_domain TEXT DEFAULT 'Unknown', domain_source_type TEXT DEFAULT 'Explicit', system TEXT, category TEXT, subcategory TEXT, requirement_type TEXT, requirement_category TEXT, condition TEXT, exception TEXT, confidence INTEGER DEFAULT 80, confidence_state TEXT DEFAULT 'High Confidence', review_status TEXT, extraction_method TEXT DEFAULT 'test', parser_version TEXT DEFAULT 'v1', model_version TEXT DEFAULT 'v1', source_location TEXT DEFAULT '{}', original_values TEXT DEFAULT '{}', current_values TEXT DEFAULT '{}', approved_for_downstream INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE requirement_ambiguities(id TEXT PRIMARY KEY, extraction_version_id TEXT, requirement_id TEXT, status TEXT);
CREATE TABLE requirement_conflicts(id TEXT PRIMARY KEY, extraction_version_id TEXT, left_requirement_id TEXT, right_requirement_id TEXT, resolution_status TEXT);
CREATE TABLE requirement_review_decisions(id TEXT PRIMARY KEY, extraction_version_id TEXT, requirement_id TEXT, action TEXT, previous_value TEXT, new_value TEXT, reason TEXT, evidence TEXT, decided_by TEXT, decided_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE document_audit_events(id TEXT PRIMARY KEY, project_id TEXT, document_id TEXT, version_id TEXT, actor_user_id TEXT, action TEXT, old_value TEXT, new_value TEXT, reason TEXT, request_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`;

const OWNER = "local-development-user";

const makeFixture = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  // handleSpecificationExtractionApi's top-level gate requires env.FILES to
  // be present for every route in this file (document byte storage), even
  // though this operation never reads a document -- a dummy stand-in is
  // enough; nothing here ever calls .get()/.put() on it.
  return { raw, env: { DB: d1(raw), FILES: {} } };
};

const seedProject = (raw, { projectId = id("project"), ownerUserId = OWNER } = {}) => {
  raw.prepare("INSERT INTO projects (id, owner_user_id, organization_id, name) VALUES (?, ?, ?, ?)").run(projectId, ownerUserId, "org_test", "Test Project");
  const documentId = id("document"); const versionId = id("extract");
  raw.prepare("INSERT INTO specification_extraction_versions (id, document_id, document_version_id, status, created_by) VALUES (?, ?, ?, 'Completed', ?)").run(versionId, documentId, id("docversion"), ownerUserId);
  raw.prepare("INSERT INTO specification_extraction_jobs (id, extraction_version_id, document_id, document_version_id, project_id, status, completed_at) VALUES (?, ?, ?, ?, ?, 'Completed', ?)").run(id("specjob"), versionId, documentId, id("docversion"), projectId, new Date().toISOString());
  return { projectId, extractionVersionId: versionId, sourceDocumentId: documentId };
};

// A single, textbook, fully-eligible requirement: Mandatory, unambiguous,
// unconditional, normative "shall", governed system, non-excluded category.
const eligibleRequirement = ({ extractionVersionId, projectId, sourceDocumentId }, overrides = {}) => ({
  id: id("requirement"),
  extraction_version_id: extractionVersionId,
  project_id: projectId,
  source_document_id: sourceDocumentId,
  sequence: 1,
  original_text: "The fire detection and alarm system shall be addressable.",
  normalized_requirement: "The fire detection and alarm system shall be addressable.",
  system: "Fire Alarm",
  category: "Functional",
  requirement_type: "Mandatory",
  requirement_category: "Compliance",
  condition: null,
  exception: null,
  review_status: "Needs Review",
  approved_for_downstream: 0,
  ...overrides,
});

const insertRequirement = (raw, requirement) => {
  raw.prepare(
    `INSERT INTO technical_requirements (id, extraction_version_id, project_id, source_document_id, sequence, original_text, normalized_requirement, system, category, requirement_type, requirement_category, condition, exception, review_status, approved_for_downstream)
     VALUES (@id, @extraction_version_id, @project_id, @source_document_id, @sequence, @original_text, @normalized_requirement, @system, @category, @requirement_type, @requirement_category, @condition, @exception, @review_status, @approved_for_downstream)`,
  ).run(requirement);
  return requirement;
};

const request = (projectId, body) => new Request(`https://localhost/api/projects/${encodeURIComponent(projectId)}/specification-requirements/auto-confirm`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

test("A. an authorized user can invoke batch auto-confirm and receives a bounded summary", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  insertRequirement(raw, eligibleRequirement(project));
  const response = await handleSpecificationExtractionApi(request(project.projectId, { reason: "Stage 4T governed auto-confirm run" }), env, { waitUntil: () => {} });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["autoConfirmed", "eligible", "failed", "policyVersion", "project", "skipReasonCounts", "skipped", "totalScanned"]);
  assert.equal(body.totalScanned, 1);
  assert.equal(body.eligible, 1);
  assert.equal(body.autoConfirmed, 1);
});

test("B. an eligible Mandatory requirement becomes Approved / approved_for_downstream=1", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const requirement = insertRequirement(raw, eligibleRequirement(project));
  await handleSpecificationExtractionApi(request(project.projectId, { reason: "Stage 4T governed auto-confirm run" }), env, { waitUntil: () => {} });
  const row = raw.prepare("SELECT review_status, approved_for_downstream FROM technical_requirements WHERE id=?").get(requirement.id);
  assert.equal(row.review_status, "Approved");
  assert.equal(row.approved_for_downstream, 1);
});

test("C. an Informational requirement is skipped (not Mandatory)", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const requirement = insertRequirement(raw, eligibleRequirement(project, { requirement_type: "Informational" }));
  const response = await handleSpecificationExtractionApi(request(project.projectId, { reason: "Stage 4T governed auto-confirm run" }), env, { waitUntil: () => {} });
  const body = await response.json();
  assert.equal(body.autoConfirmed, 0);
  const row = raw.prepare("SELECT review_status, approved_for_downstream FROM technical_requirements WHERE id=?").get(requirement.id);
  assert.equal(row.review_status, "Needs Review");
  assert.equal(row.approved_for_downstream, 0);
});

test("D. a requirement with an open ambiguity is skipped", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const requirement = insertRequirement(raw, eligibleRequirement(project));
  raw.prepare("INSERT INTO requirement_ambiguities (id, extraction_version_id, requirement_id, status) VALUES (?, ?, ?, 'Open')").run(id("ambiguity"), project.extractionVersionId, requirement.id);
  await handleSpecificationExtractionApi(request(project.projectId, { reason: "Stage 4T governed auto-confirm run" }), env, { waitUntil: () => {} });
  const row = raw.prepare("SELECT review_status, approved_for_downstream FROM technical_requirements WHERE id=?").get(requirement.id);
  assert.equal(row.review_status, "Needs Review");
  assert.equal(row.approved_for_downstream, 0);
});

test("E. a requirement with an unresolved condition is skipped", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const requirement = insertRequirement(raw, eligibleRequirement(project, { condition: "only in kitchens and mechanical rooms" }));
  await handleSpecificationExtractionApi(request(project.projectId, { reason: "Stage 4T governed auto-confirm run" }), env, { waitUntil: () => {} });
  const row = raw.prepare("SELECT review_status, approved_for_downstream FROM technical_requirements WHERE id=?").get(requirement.id);
  assert.equal(row.review_status, "Needs Review");
  assert.equal(row.approved_for_downstream, 0);
});

test("F. non-normative descriptive prose (no shall/must/is required/are required) is skipped", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const requirement = insertRequirement(raw, eligibleRequirement(project, { original_text: "Thermal detectors employ an advanced thermistor sensing circuit to deliver fixed-temperature detection." }));
  await handleSpecificationExtractionApi(request(project.projectId, { reason: "Stage 4T governed auto-confirm run" }), env, { waitUntil: () => {} });
  const row = raw.prepare("SELECT review_status, approved_for_downstream FROM technical_requirements WHERE id=?").get(requirement.id);
  assert.equal(row.review_status, "Needs Review");
  assert.equal(row.approved_for_downstream, 0);
});

test("G. an actor who does not own the project is rejected (PROJECT_NOT_FOUND, same convention as every other governed route in this file)", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw, { ownerUserId: "someone-else" });
  insertRequirement(raw, eligibleRequirement(project));
  const response = await handleSpecificationExtractionApi(request(project.projectId, { reason: "Stage 4T governed auto-confirm run" }), env, { waitUntil: () => {} });
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error.code, "PROJECT_NOT_FOUND");
  const row = raw.prepare("SELECT review_status FROM technical_requirements LIMIT 1").get();
  assert.equal(row.review_status, "Needs Review");
});

test("H. project scoping: auto-confirm on project A never touches project B's requirements", async () => {
  const { raw, env } = makeFixture();
  const projectA = seedProject(raw);
  const projectB = seedProject(raw);
  const reqA = insertRequirement(raw, eligibleRequirement(projectA));
  const reqB = insertRequirement(raw, eligibleRequirement(projectB));
  await handleSpecificationExtractionApi(request(projectA.projectId, { reason: "Stage 4T governed auto-confirm run" }), env, { waitUntil: () => {} });
  assert.equal(raw.prepare("SELECT review_status FROM technical_requirements WHERE id=?").get(reqA.id).review_status, "Approved");
  assert.equal(raw.prepare("SELECT review_status FROM technical_requirements WHERE id=?").get(reqB.id).review_status, "Needs Review");
});

test("I. every ineligible requirement remains business-state unchanged after a mixed run", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const eligible = insertRequirement(raw, eligibleRequirement(project, { sequence: 1 }));
  const informational = insertRequirement(raw, eligibleRequirement(project, { sequence: 2, requirement_type: "Informational" }));
  const conditional = insertRequirement(raw, eligibleRequirement(project, { sequence: 3, condition: "only where noted" }));
  const descriptive = insertRequirement(raw, eligibleRequirement(project, { sequence: 4, original_text: "Detectors are engineered for reliable, long-term operation." }));
  const before = {
    informational: raw.prepare("SELECT * FROM technical_requirements WHERE id=?").get(informational.id),
    conditional: raw.prepare("SELECT * FROM technical_requirements WHERE id=?").get(conditional.id),
    descriptive: raw.prepare("SELECT * FROM technical_requirements WHERE id=?").get(descriptive.id),
  };
  await handleSpecificationExtractionApi(request(project.projectId, { reason: "Stage 4T governed auto-confirm run" }), env, { waitUntil: () => {} });
  assert.equal(raw.prepare("SELECT review_status FROM technical_requirements WHERE id=?").get(eligible.id).review_status, "Approved");
  for (const [key, id] of [["informational", informational.id], ["conditional", conditional.id], ["descriptive", descriptive.id]]) {
    const after = raw.prepare("SELECT * FROM technical_requirements WHERE id=?").get(id);
    assert.deepEqual(after, before[key], `${key} must be byte-for-byte unchanged`);
  }
});

test("J. audit/governance evidence is written for every confirmed requirement (requirement_review_decisions + document_audit_events)", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const requirement = insertRequirement(raw, eligibleRequirement(project));
  await handleSpecificationExtractionApi(request(project.projectId, { reason: "Stage 4T governed auto-confirm run" }), env, { waitUntil: () => {} });

  const decision = raw.prepare("SELECT * FROM requirement_review_decisions WHERE requirement_id=?").get(requirement.id);
  assert.ok(decision, "the existing engine's own audit row must exist");
  assert.equal(decision.action, "Auto-Confirm");
  assert.equal(decision.decided_by, "system:spec-requirement-auto-confirm");
  const previous = JSON.parse(decision.previous_value);
  const next = JSON.parse(decision.new_value);
  assert.equal(previous.reviewStatus, "Needs Review");
  assert.equal(previous.approvedForDownstream, 0);
  assert.equal(next.reviewStatus, "Approved");
  assert.equal(next.approvedForDownstream, 1);

  const events = raw.prepare("SELECT * FROM document_audit_events WHERE project_id=? ORDER BY id").all(project.projectId);
  const perRequirement = events.find((entry) => entry.action === "Specification Requirement Auto-Confirmed");
  assert.ok(perRequirement, "a per-requirement document_audit_events row must exist (the normal, project-wide audit trail every other governed mutation in this codebase also writes to)");
  assert.equal(perRequirement.actor_user_id, OWNER);
  assert.equal(perRequirement.reason, "Stage 4T governed auto-confirm run");
  const eventNext = JSON.parse(perRequirement.new_value);
  assert.equal(eventNext.reviewStatus, "Approved");
  assert.equal(eventNext.approvedForDownstream, 1);
  assert.ok(Array.isArray(eventNext.gates) && eventNext.gates.length === 12, "the full deterministic gate evaluation must be reconstructable from the audit trail");

  const summaryEvent = events.find((entry) => entry.action === "Specification Requirements Auto-Confirm Run");
  assert.ok(summaryEvent, "a run-level summary audit event must exist, matching the suggestLinks/publishApprovedEngineeringKnowledge convention");
});

test("K. response counts accurately reflect confirmed/skipped across a mixed batch", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  insertRequirement(raw, eligibleRequirement(project, { sequence: 1 }));
  insertRequirement(raw, eligibleRequirement(project, { sequence: 2 }));
  insertRequirement(raw, eligibleRequirement(project, { sequence: 3, requirement_type: "Informational" }));
  insertRequirement(raw, eligibleRequirement(project, { sequence: 4, condition: "special case only" }));
  insertRequirement(raw, eligibleRequirement(project, { sequence: 5, review_status: "Approved", approved_for_downstream: 1 }));
  const response = await handleSpecificationExtractionApi(request(project.projectId, { reason: "Stage 4T governed auto-confirm run" }), env, { waitUntil: () => {} });
  const body = await response.json();
  // The already-Approved row is outside PENDING_REVIEW scope entirely, so
  // findEligibleSpecRequirements never counts it in totalScanned (matches
  // the unmodified engine's own project-query semantics).
  assert.equal(body.totalScanned, 4);
  assert.equal(body.eligible, 2);
  assert.equal(body.autoConfirmed, 2);
  assert.equal(body.skipped, 2);
  assert.equal(body.failed, 0);
  assert.equal(body.skipReasonCounts["Requirement type is Informational"], 1);
  assert.equal(body.skipReasonCounts["Has unresolved condition"], 1);
});

test("a substantive reason is required (same MIN_GOVERNED_REASON_LENGTH convention as every other governed decision route)", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  insertRequirement(raw, eligibleRequirement(project));
  const response = await handleSpecificationExtractionApi(request(project.projectId, { reason: "x" }), env, { waitUntil: () => {} });
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.error.code, "AUTO_CONFIRM_REASON_REQUIRED");
  assert.equal(raw.prepare("SELECT review_status FROM technical_requirements LIMIT 1").get().review_status, "Needs Review");
});

test("with zero pending requirements, nothing is scanned or mutated and the response says so honestly", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const response = await handleSpecificationExtractionApi(request(project.projectId, { reason: "Stage 4T governed auto-confirm run" }), env, { waitUntil: () => {} });
  const body = await response.json();
  assert.equal(body.totalScanned, 0);
  assert.equal(body.eligible, 0);
  assert.equal(body.autoConfirmed, 0);
  assert.equal(body.note, "No pending requirements found");
});
