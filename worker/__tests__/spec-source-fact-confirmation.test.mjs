import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  handleSpecSourceFactApi,
  confirmSourceFact,
  rejectSourceFact,
  batchConfirmSourceFacts,
  listPendingSourceFacts,
  SOURCE_FACT_PREDICATE_LABELS,
} from "../spec-source-fact-promotion.mjs";

// Source Fact Authority Slice 2 -- fixture-only tests for the confirmation
// governance layer (Pending Review -> Active / Rejected). Reuses Slice 1's
// exact fixture schema/shim; adds nothing to the Source Fact detection or
// promotion policy itself. No live project is ever touched.

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
CREATE TABLE specification_extraction_jobs(id TEXT PRIMARY KEY, extraction_version_id TEXT, document_id TEXT, document_version_id TEXT, project_id TEXT, status TEXT, completed_at TEXT);
CREATE TABLE specification_extraction_versions(id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, version_number INTEGER DEFAULT 1, status TEXT DEFAULT 'Completed', parser_version TEXT DEFAULT 'v1', ruleset_version TEXT DEFAULT 'v1', model_version TEXT DEFAULT 'v1', prompt_version TEXT DEFAULT 'v1', ocr_version TEXT DEFAULT 'v1', summary TEXT DEFAULT '{}', superseded_at TEXT, created_by TEXT);
CREATE TABLE technical_requirements(id TEXT PRIMARY KEY, extraction_version_id TEXT, project_id TEXT, source_document_id TEXT, clause_id TEXT, sequence INTEGER, original_text TEXT, normalized_requirement TEXT, engineering_domain TEXT DEFAULT 'Fire Alarm', domain_source_type TEXT DEFAULT 'Explicit', system TEXT, category TEXT, subcategory TEXT, requirement_type TEXT DEFAULT 'Mandatory', requirement_category TEXT DEFAULT 'Environmental', condition TEXT, exception TEXT, confidence INTEGER DEFAULT 90, confidence_state TEXT DEFAULT 'High Confidence', review_status TEXT DEFAULT 'Needs Review', extraction_method TEXT DEFAULT 'test', parser_version TEXT DEFAULT 'v1', model_version TEXT DEFAULT 'v1', source_location TEXT DEFAULT '{}', original_values TEXT DEFAULT '{}', current_values TEXT DEFAULT '{}', approved_for_downstream INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE requirement_attributes(id TEXT PRIMARY KEY, requirement_id TEXT, name TEXT, operator TEXT DEFAULT 'Equal', original_value TEXT, parsed_value TEXT, original_unit TEXT, normalized_value TEXT, normalized_unit TEXT, confidence INTEGER, source_location TEXT DEFAULT '{}');
CREATE TABLE requirement_standards(id TEXT PRIMARY KEY, requirement_id TEXT, body TEXT, number TEXT, part TEXT, year TEXT, original_text TEXT, status TEXT, confidence INTEGER);
CREATE TABLE requirement_profile_versions(id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, status TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE engineering_facts(id TEXT PRIMARY KEY, project_id TEXT, entity_type TEXT, entity_id TEXT, predicate TEXT, value TEXT, data_type TEXT, operator TEXT, fact_type TEXT, scope_type TEXT, scope_id TEXT, source_fact_id TEXT, derivation TEXT, status TEXT, confidence INTEGER, version_number INTEGER DEFAULT 1, effective_from TEXT DEFAULT CURRENT_TIMESTAMP, effective_to TEXT, previous_version_id TEXT, superseded_by_id TEXT, change_reason TEXT, changed_by TEXT, model_version TEXT, deleted_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE engineering_fact_provenance(id TEXT PRIMARY KEY, fact_id TEXT, source_type TEXT, source_id TEXT, evidence_id TEXT, document_id TEXT, document_version_id TEXT, extraction_version_id TEXT, page INTEGER, page_to INTEGER, sheet TEXT, section TEXT, clause TEXT, row_number INTEGER, cell TEXT, bounding_box TEXT, original_text TEXT, extraction_method TEXT, parser_version TEXT, model_version TEXT, prompt_version TEXT, rule_version TEXT, confidence INTEGER, user_id TEXT, user_role TEXT, human_reason TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE engineering_knowledge_conflicts(id TEXT PRIMARY KEY, project_id TEXT, conflict_type TEXT, left_entity_type TEXT, left_entity_id TEXT, right_entity_type TEXT, right_entity_id TEXT, left_value TEXT, right_value TEXT, severity TEXT, impact TEXT, blocking INTEGER DEFAULT 1, resolution_status TEXT DEFAULT 'Open', resolution_decision_id TEXT, evidence TEXT DEFAULT '[]', created_at TEXT DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT);
CREATE TABLE engineering_knowledge_decisions(id TEXT PRIMARY KEY, project_id TEXT, entity_type TEXT, entity_id TEXT, action TEXT, previous_value TEXT, new_value TEXT, reason TEXT, evidence TEXT, scope_type TEXT, scope_id TEXT, reversible INTEGER DEFAULT 1, reverses_decision_id TEXT, decided_by TEXT, decided_role TEXT, decided_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE document_audit_events(id TEXT PRIMARY KEY, project_id TEXT, document_id TEXT, version_id TEXT, actor_user_id TEXT, action TEXT, old_value TEXT, new_value TEXT, reason TEXT, request_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`;

const OWNER = "local-development-user";

const makeFixture = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  return { raw, env: { DB: d1(raw), FILES: {} } };
};

const seedProject = (raw, { projectId = id("project"), ownerUserId = OWNER, organizationId = "org_test" } = {}) => {
  raw.prepare("INSERT INTO projects (id, owner_user_id, organization_id, name) VALUES (?, ?, ?, ?)").run(projectId, ownerUserId, organizationId, "Test Project");
  return { projectId };
};

// Seeds an engineering_facts row directly (bypassing promotion, for a
// precise, fast confirmation-layer fixture) plus optional provenance rows.
const seedFact = (raw, project, overrides = {}) => {
  const fact = {
    id: id("fact"), project_id: project.projectId, entity_type: "Technical Requirement", entity_id: id("requirement"),
    predicate: "fixed_temperature_setpoint", value: JSON.stringify({ value: "135°F", unit: null }),
    data_type: "Text", operator: "Equal", fact_type: "Source Fact", scope_type: "Product Family", scope_id: "Heat Detector",
    status: "Pending Review", confidence: 94, changed_by: "system:spec-source-fact-promotion", model_version: "spec-source-fact-promotion-1.0.0",
    ...overrides,
  };
  raw.prepare(
    `INSERT INTO engineering_facts (id, project_id, entity_type, entity_id, predicate, value, data_type, operator, fact_type, scope_type, scope_id, status, confidence, changed_by, model_version)
     VALUES (@id, @project_id, @entity_type, @entity_id, @predicate, @value, @data_type, @operator, @fact_type, @scope_type, @scope_id, @status, @confidence, @changed_by, @model_version)`,
  ).run(fact);
  return fact;
};

const seedProvenance = (raw, factId, overrides = {}) => {
  const row = { id: id("provenance"), fact_id: factId, source_type: "Requirement Attribute", source_id: id("requirement"), document_id: id("document"), page: 11, section: "28 46 00", clause: "5", confidence: 94, user_id: "system:spec-source-fact-promotion", ...overrides };
  raw.prepare("INSERT INTO engineering_fact_provenance (id, fact_id, source_type, source_id, document_id, page, section, clause, confidence, user_id) VALUES (@id, @fact_id, @source_type, @source_id, @document_id, @page, @section, @clause, @confidence, @user_id)").run(row);
  return row;
};

const confirmRequest = (factId, body) => new Request(`https://localhost/api/engineering-facts/${encodeURIComponent(factId)}/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const rejectRequest = (factId, body) => new Request(`https://localhost/api/engineering-facts/${encodeURIComponent(factId)}/reject`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const batchConfirmRequest = (projectId, body) => new Request(`https://localhost/api/projects/${encodeURIComponent(projectId)}/specification-source-facts/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const REASON = "Slice 2 governed confirmation review";

const factStatus = (raw, factId) => raw.prepare("SELECT status FROM engineering_facts WHERE id=?").get(factId).status;

// -------------------------------------------------------------------------
// A/B -- state transitions
// -------------------------------------------------------------------------

test("A. Pending Review Source Fact -> Active via single confirm", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const fact = seedFact(raw, project);
  seedProvenance(raw, fact.id);
  const response = await handleSpecSourceFactApi(confirmRequest(fact.id, { reason: REASON }), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "Active");
  assert.equal(factStatus(raw, fact.id), "Active");
});

test("B. Pending Review Source Fact -> Rejected via single reject", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const fact = seedFact(raw, project);
  seedProvenance(raw, fact.id);
  const response = await handleSpecSourceFactApi(rejectRequest(fact.id, { reason: REASON }), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "Rejected");
  assert.equal(factStatus(raw, fact.id), "Rejected");
});

// -------------------------------------------------------------------------
// C/D -- audit
// -------------------------------------------------------------------------

test("C. confirmation writes an engineering_knowledge_decisions row and a document_audit_events row", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const fact = seedFact(raw, project);
  seedProvenance(raw, fact.id);
  await handleSpecSourceFactApi(confirmRequest(fact.id, { reason: REASON }), env);
  const decision = raw.prepare("SELECT * FROM engineering_knowledge_decisions WHERE entity_id=? AND action='confirm'").get(fact.id);
  assert.ok(decision);
  assert.equal(decision.entity_type, "Engineering Fact");
  assert.equal(decision.decided_by, OWNER);
  assert.deepEqual(JSON.parse(decision.previous_value), { status: "Pending Review" });
  assert.deepEqual(JSON.parse(decision.new_value), { status: "Active" });
  const event = raw.prepare("SELECT * FROM document_audit_events WHERE action='Specification Source Fact Confirmed'").get();
  assert.ok(event);
  assert.equal(event.actor_user_id, OWNER);
});

test("D. rejection writes an engineering_knowledge_decisions row and a document_audit_events row", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const fact = seedFact(raw, project);
  seedProvenance(raw, fact.id);
  await handleSpecSourceFactApi(rejectRequest(fact.id, { reason: REASON }), env);
  const decision = raw.prepare("SELECT * FROM engineering_knowledge_decisions WHERE entity_id=? AND action='reject'").get(fact.id);
  assert.ok(decision);
  const event = raw.prepare("SELECT * FROM document_audit_events WHERE action='Specification Source Fact Rejected'").get();
  assert.ok(event);
});

// -------------------------------------------------------------------------
// E/F -- safety gates
// -------------------------------------------------------------------------

test("E. an open blocking conflict prevents confirmation", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const fact = seedFact(raw, project);
  seedProvenance(raw, fact.id);
  raw.prepare("INSERT INTO engineering_knowledge_conflicts (id, project_id, conflict_type, left_entity_type, left_entity_id, right_entity_type, right_entity_id, left_value, right_value, severity, impact, blocking, resolution_status) VALUES (?, ?, 'Source Fact Value Conflict', 'Engineering Fact', ?, 'Requirement Attribute', ?, '\"135\"', '\"190\"', 'High', 'test', 1, 'Open')")
    .run(id("conflict"), project.projectId, fact.id, id("attribute"));
  const response = await handleSpecSourceFactApi(confirmRequest(fact.id, { reason: REASON }), env);
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.error.code, "SOURCE_FACT_CONFLICT_BLOCKING");
  assert.equal(factStatus(raw, fact.id), "Pending Review");
});

test("F. missing supporting provenance prevents confirmation", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const fact = seedFact(raw, project); // deliberately no seedProvenance call
  const response = await handleSpecSourceFactApi(confirmRequest(fact.id, { reason: REASON }), env);
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.error.code, "SOURCE_FACT_PROVENANCE_MISSING");
  assert.equal(factStatus(raw, fact.id), "Pending Review");
});

test("G. a non-Source-Fact (e.g. Supplier Claim) cannot use this route", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const fact = seedFact(raw, project, { fact_type: "Supplier Claim" });
  seedProvenance(raw, fact.id);
  const response = await handleSpecSourceFactApi(confirmRequest(fact.id, { reason: REASON }), env);
  assert.equal(response.status, 404);
  assert.equal(factStatus(raw, fact.id), "Pending Review");
});

// -------------------------------------------------------------------------
// H/I -- authorization and scoping
// -------------------------------------------------------------------------

test("H. an actor who does not own the project is rejected", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw, { ownerUserId: "someone-else" });
  const fact = seedFact(raw, project);
  seedProvenance(raw, fact.id);
  const response = await handleSpecSourceFactApi(confirmRequest(fact.id, { reason: REASON }), env);
  assert.equal(response.status, 404);
  assert.equal(factStatus(raw, fact.id), "Pending Review");
});

test("I. cross-project access is rejected: a fact id from project B cannot be confirmed through project A's batch route", async () => {
  const { raw, env } = makeFixture();
  const projectA = seedProject(raw, { organizationId: "org_a" });
  const projectB = seedProject(raw, { organizationId: "org_b" });
  const factB = seedFact(raw, projectB);
  seedProvenance(raw, factB.id);
  const response = await handleSpecSourceFactApi(batchConfirmRequest(projectA.projectId, { reason: REASON, factIds: [factB.id] }), env);
  const body = await response.json();
  assert.equal(body.confirmed, 0);
  assert.equal(body.failed, 1);
  assert.equal(body.results[0].code, "SOURCE_FACT_NOT_FOUND");
  assert.equal(factStatus(raw, factB.id), "Pending Review");
});

// -------------------------------------------------------------------------
// J/K -- idempotency
// -------------------------------------------------------------------------

test("J. repeated confirm is idempotent: no duplicate decision/audit rows", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const fact = seedFact(raw, project);
  seedProvenance(raw, fact.id);
  const first = await handleSpecSourceFactApi(confirmRequest(fact.id, { reason: REASON }), env);
  assert.equal((await first.json()).idempotent, false);
  const second = await handleSpecSourceFactApi(confirmRequest(fact.id, { reason: REASON }), env);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).idempotent, true);
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM engineering_knowledge_decisions WHERE entity_id=?").get(fact.id).c, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM document_audit_events WHERE action='Specification Source Fact Confirmed'").get().c, 1);
});

test("K. repeated reject is idempotent: no duplicate decision/audit rows", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const fact = seedFact(raw, project);
  seedProvenance(raw, fact.id);
  await handleSpecSourceFactApi(rejectRequest(fact.id, { reason: REASON }), env);
  const second = await handleSpecSourceFactApi(rejectRequest(fact.id, { reason: REASON }), env);
  assert.equal((await second.json()).idempotent, true);
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM engineering_knowledge_decisions WHERE entity_id=?").get(fact.id).c, 1);
});

test("rejecting an already-Active fact is refused, not silently accepted", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const fact = seedFact(raw, project);
  seedProvenance(raw, fact.id);
  await handleSpecSourceFactApi(confirmRequest(fact.id, { reason: REASON }), env);
  const response = await handleSpecSourceFactApi(rejectRequest(fact.id, { reason: REASON }), env);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "SOURCE_FACT_NOT_PENDING");
  assert.equal(factStatus(raw, fact.id), "Active");
});

// -------------------------------------------------------------------------
// L/M/N -- batch confirmation
// -------------------------------------------------------------------------

test("L. batch confirmation activates exactly the explicit selected eligible ids", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const factA = seedFact(raw, project, { predicate: "fixed_temperature_setpoint" });
  seedProvenance(raw, factA.id);
  const factB = seedFact(raw, project, { predicate: "rate_of_rise_sensitivity" });
  seedProvenance(raw, factB.id);
  const response = await handleSpecSourceFactApi(batchConfirmRequest(project.projectId, { reason: REASON, factIds: [factA.id, factB.id] }), env);
  const body = await response.json();
  assert.equal(body.confirmed, 2);
  assert.equal(factStatus(raw, factA.id), "Active");
  assert.equal(factStatus(raw, factB.id), "Active");
});

test("M. batch confirmation does NOT activate an unselected Pending Review fact", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const selected = seedFact(raw, project, { predicate: "fixed_temperature_setpoint" });
  seedProvenance(raw, selected.id);
  const unselected = seedFact(raw, project, { predicate: "rate_of_rise_sensitivity" });
  seedProvenance(raw, unselected.id);
  await handleSpecSourceFactApi(batchConfirmRequest(project.projectId, { reason: REASON, factIds: [selected.id] }), env);
  assert.equal(factStatus(raw, selected.id), "Active");
  assert.equal(factStatus(raw, unselected.id), "Pending Review");
});

test("N. a conflicted item selected in a batch remains inactive while the rest still confirm", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const clean = seedFact(raw, project, { predicate: "fixed_temperature_setpoint" });
  seedProvenance(raw, clean.id);
  const conflicted = seedFact(raw, project, { predicate: "rate_of_rise_sensitivity" });
  seedProvenance(raw, conflicted.id);
  raw.prepare("INSERT INTO engineering_knowledge_conflicts (id, project_id, conflict_type, left_entity_type, left_entity_id, right_entity_type, right_entity_id, left_value, right_value, severity, impact, blocking, resolution_status) VALUES (?, ?, 'Source Fact Value Conflict', 'Engineering Fact', ?, 'Requirement Attribute', ?, '\"a\"', '\"b\"', 'High', 'test', 1, 'Open')")
    .run(id("conflict"), project.projectId, conflicted.id, id("attribute"));
  const response = await handleSpecSourceFactApi(batchConfirmRequest(project.projectId, { reason: REASON, factIds: [clean.id, conflicted.id] }), env);
  const body = await response.json();
  assert.equal(body.confirmed, 1);
  assert.equal(body.blocked, 1);
  assert.equal(factStatus(raw, clean.id), "Active");
  assert.equal(factStatus(raw, conflicted.id), "Pending Review");
});

// -------------------------------------------------------------------------
// R -- the Golden six, one batch.
// -------------------------------------------------------------------------

test("R. six Golden-like deterministic facts can be selected and submitted in one batch confirmation", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const golden = [
    { predicate: "fixed_temperature_setpoint", value: { value: "135°F", unit: null } },
    { predicate: "rate_of_rise_sensitivity", value: { value: "15°F/min", unit: null } },
    { predicate: "applicable_standard", value: { value: { body: "UL", number: "521" }, unit: null } },
    { predicate: "protocol_compatibility", value: { value: "Flash Scan, CLIP", unit: null } },
    { predicate: "base_architecture", value: { value: "Modular", unit: null } },
    { predicate: "high_temp_alternative_available", value: { value: "190°F", unit: null } },
  ].map((entry) => {
    const fact = seedFact(raw, project, { predicate: entry.predicate, value: JSON.stringify(entry.value) });
    seedProvenance(raw, fact.id);
    return fact;
  });
  const response = await handleSpecSourceFactApi(batchConfirmRequest(project.projectId, { reason: "Golden batch confirmation", factIds: golden.map((f) => f.id) }), env);
  const body = await response.json();
  assert.equal(body.confirmed, 6);
  for (const fact of golden) assert.equal(factStatus(raw, fact.id), "Active");
});

// -------------------------------------------------------------------------
// S -- high-temp wording safety.
// -------------------------------------------------------------------------

test("S. the 190°F alternative is labeled 'High-temperature alternative available', never a selected value", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const fact = seedFact(raw, project, { predicate: "high_temp_alternative_available", value: JSON.stringify({ value: "190°F", unit: null }) });
  seedProvenance(raw, fact.id);
  const list = await listPendingSourceFacts(env.DB, project.projectId);
  assert.equal(list[0].label, "High-temperature alternative available");
  assert.equal(SOURCE_FACT_PREDICATE_LABELS.high_temp_alternative_available, "High-temperature alternative available");
  assert.doesNotMatch(list[0].label, /selected/i);
  const allLabels = Object.values(SOURCE_FACT_PREDICATE_LABELS).join(" ");
  assert.doesNotMatch(allLabels, /selected temperature/i);
});

// -------------------------------------------------------------------------
// T -- no downstream side effects.
// -------------------------------------------------------------------------

test("T. confirming/rejecting Source Facts never triggers Requirement Profile generation", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const fact = seedFact(raw, project);
  seedProvenance(raw, fact.id);
  await handleSpecSourceFactApi(confirmRequest(fact.id, { reason: REASON }), env);
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM requirement_profile_versions").get().c, 0);
});

// -------------------------------------------------------------------------
// Read model
// -------------------------------------------------------------------------

test("read model: GET /api/projects/:id/specification-source-facts returns a compact, non-provenance-dumping list", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const fact = seedFact(raw, project);
  seedProvenance(raw, fact.id);
  seedProvenance(raw, fact.id, { id: id("provenance"), page: 12 });
  const response = await handleSpecSourceFactApi(new Request(`https://localhost/api/projects/${project.projectId}/specification-source-facts`), env);
  const body = await response.json();
  assert.equal(body.facts.length, 1);
  const entry = body.facts[0];
  assert.deepEqual(Object.keys(entry).sort(), ["confidence", "factId", "hasBlockingConflict", "label", "predicate", "scopeId", "scopeType", "sourceCount", "sources", "status", "unit", "value"].sort());
  assert.equal(entry.sourceCount, 2);
  assert.equal(entry.value, "135°F");
  assert.equal(entry.status, "Pending Review");
  assert.equal(entry.hasBlockingConflict, false);
});

test("normative-engine boundary: the module still never imports spec-requirement-auto-confirm.mjs", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../spec-source-fact-promotion.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from\s+["'].*spec-requirement-auto-confirm/);
  assert.doesNotMatch(source, /UPDATE technical_requirements/);
  assert.doesNotMatch(source, /(INSERT INTO|UPDATE|FROM|JOIN)\s+boq_requirement_links/);
});
