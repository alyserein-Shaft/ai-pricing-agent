import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  evaluateSourceFactCandidate,
  batchPromoteSourceFacts,
  handleSpecSourceFactApi,
  SOURCE_FACT_PROMOTION_POLICY_VERSION,
  SOURCE_FACT_PROMOTION_ACTOR,
} from "../spec-source-fact-promotion.mjs";

// Source Fact Authority Slice 1 -- fixture-only tests. Proves the
// deterministic promotion engine and its one governed route
// (POST /api/projects/:id/specification-source-facts/promote) against the
// exact Golden evidence shapes proven real in the prior read-only audits
// (135°F/57°C fixed temperature, 15°F/min rate-of-rise, UL521, Flash Scan/
// CLIP, modular base, the 190°F alternative), entirely in an in-memory
// SQLite fixture. No live project (Al Mousa or otherwise) is ever touched.

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
  const documentId = id("document"); const versionId = id("extract");
  raw.prepare("INSERT INTO specification_extraction_versions (id, document_id, document_version_id, status, created_by) VALUES (?, ?, ?, 'Completed', ?)").run(versionId, documentId, id("docversion"), ownerUserId);
  raw.prepare("INSERT INTO specification_extraction_jobs (id, extraction_version_id, document_id, document_version_id, project_id, status, completed_at) VALUES (?, ?, ?, ?, ?, 'Completed', ?)").run(id("specjob"), versionId, documentId, id("docversion"), projectId, new Date().toISOString());
  return { projectId, extractionVersionId: versionId, sourceDocumentId: documentId };
};

const insertRequirement = (raw, project, overrides = {}) => {
  const requirement = {
    id: id("requirement"), extraction_version_id: project.extractionVersionId, project_id: project.projectId,
    source_document_id: project.sourceDocumentId, clause_id: "clause_heat_detector", sequence: 1,
    original_text: "Heat detector.", normalized_requirement: "Heat detector.",
    engineering_domain: "Fire Alarm", system: "Fire Alarm", category: "Environmental",
    condition: null, exception: null, requirement_type: "Mandatory",
    ...overrides,
  };
  raw.prepare(
    `INSERT INTO technical_requirements (id, extraction_version_id, project_id, source_document_id, clause_id, sequence, original_text, normalized_requirement, engineering_domain, system, category, condition, exception, requirement_type)
     VALUES (@id, @extraction_version_id, @project_id, @source_document_id, @clause_id, @sequence, @original_text, @normalized_requirement, @engineering_domain, @system, @category, @condition, @exception, @requirement_type)`,
  ).run(requirement);
  return requirement;
};

const insertAttribute = (raw, requirementId, { name, normalizedValue, normalizedUnit = null, confidence = 94 }) => {
  const attributeId = id("attribute");
  raw.prepare("INSERT INTO requirement_attributes (id, requirement_id, name, original_value, normalized_value, normalized_unit, confidence) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(attributeId, requirementId, name, String(normalizedValue), JSON.stringify(normalizedValue), normalizedUnit, confidence);
  return attributeId;
};

const insertStandard = (raw, requirementId, { body, number, part = null, year = null, confidence = 90 }) => {
  const standardId = id("standard");
  raw.prepare("INSERT INTO requirement_standards (id, requirement_id, body, number, part, year, confidence) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(standardId, requirementId, body, number, part, year, confidence);
  return standardId;
};

const request = (projectId, body) => new Request(`https://localhost/api/projects/${encodeURIComponent(projectId)}/specification-source-facts/promote`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const promote = (projectId, env) => handleSpecSourceFactApi(request(projectId, { reason: "Slice 1 governed Source Fact promotion run" }), env);

const factsFor = (raw, projectId) => raw.prepare("SELECT * FROM engineering_facts WHERE project_id=? ORDER BY predicate").all(projectId);

// -------------------------------------------------------------------------
// A/B/C/D/E -- Golden fixtures: each deterministic candidate promotes to
// exactly one Pending Review Source Fact.
// -------------------------------------------------------------------------

test("A. 135°F structured Heat Detector attribute promotes to one Pending Review Source Fact", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const req = insertRequirement(raw, project, { original_text: "Thermal detectors employ an advanced thermistor sensing circuit to deliver fixed-temperature detection at 135°F and rate-of-rise thermal detection." });
  insertAttribute(raw, req.id, { name: "fixed_temperature_setpoint", normalizedValue: "135°F" });
  const response = await promote(project.projectId, env);
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.promoted, 1);
  const facts = factsFor(raw, project.projectId);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].predicate, "fixed_temperature_setpoint");
  assert.equal(facts[0].status, "Pending Review");
  assert.equal(facts[0].scope_type, "Product Family");
  assert.equal(facts[0].scope_id, "Heat Detector");
  assert.deepEqual(JSON.parse(facts[0].value), { value: "135°F", unit: null });
});

test("B. 15°F/min rate-of-rise promotes to one Pending Review Source Fact", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const req = insertRequirement(raw, project, { original_text: "Thermal detectors provide rate-of-rise thermal detection at 15°F per minute." });
  insertAttribute(raw, req.id, { name: "rate_of_rise_sensitivity", normalizedValue: "15°F/min" });
  const response = await promote(project.projectId, env);
  const body = await response.json();
  assert.equal(body.promoted, 1);
  const facts = factsFor(raw, project.projectId);
  assert.equal(facts[0].predicate, "rate_of_rise_sensitivity");
  assert.equal(facts[0].status, "Pending Review");
});

test("C. UL521 structured standard promotes to one Pending Review Source Fact", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const req = insertRequirement(raw, project, { original_text: "UL521 – UL Standard for Heat Detectors for Fire Protective Signaling Systems.", requirement_type: "Informational" });
  insertStandard(raw, req.id, { body: "UL", number: "521" });
  const response = await promote(project.projectId, env);
  const body = await response.json();
  assert.equal(body.promoted, 1);
  const facts = factsFor(raw, project.projectId);
  assert.equal(facts[0].predicate, "applicable_standard");
  assert.deepEqual(JSON.parse(facts[0].value).value, { body: "UL", number: "521", part: null, year: null });
});

test("D. Flash Scan / CLIP evidence promotes to one Pending Review Source Fact", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const heading = insertRequirement(raw, project, { sequence: 1, original_text: "Fixed Temperature / Rate of Rise Heat Detectors." });
  const req = insertRequirement(raw, project, { sequence: 2, original_text: "Compatible with Flash Scan and CLIP protocol systems for two-wire SLC connectivity." });
  insertAttribute(raw, req.id, { name: "protocol_compatibility", normalizedValue: "Flash Scan, CLIP" });
  const response = await promote(project.projectId, env);
  const body = await response.json();
  assert.equal(body.promoted, 1, JSON.stringify(body));
  const facts = factsFor(raw, project.projectId);
  assert.equal(facts[0].predicate, "protocol_compatibility");
  assert.equal(facts[0].scope_id, "Heat Detector");
});

test("E. modular-base evidence promotes to one Pending Review Source Fact", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const req = insertRequirement(raw, project, { original_text: "Modular base system facilitates installation and maintenance of the heat detector." });
  insertAttribute(raw, req.id, { name: "base_architecture", normalizedValue: "Modular" });
  const response = await promote(project.projectId, env);
  const body = await response.json();
  assert.equal(body.promoted, 1);
  assert.equal(factsFor(raw, project.projectId)[0].predicate, "base_architecture");
});

// -------------------------------------------------------------------------
// F -- the critical high-temperature safety rule.
// -------------------------------------------------------------------------

test("F. explicit 190°F high-temp alternative reroutes to high_temp_alternative_available, never overrides fixed_temperature_setpoint", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const heading = insertRequirement(raw, project, { sequence: 1, original_text: "Fixed Temperature / Rate of Rise Heat Detectors." });
  const req = insertRequirement(raw, project, { sequence: 2, original_text: "For applications requiring increased sensitivity, a high-temperature model provides fixed detection at 190°F." });
  insertAttribute(raw, req.id, { name: "fixed_temperature_setpoint", normalizedValue: "190°F" });
  const response = await promote(project.projectId, env);
  const body = await response.json();
  assert.equal(response.status, 201);
  const facts = factsFor(raw, project.projectId);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].predicate, "high_temp_alternative_available");
  assert.notEqual(facts[0].predicate, "fixed_temperature_setpoint");
  assert.equal(body.conflicts, 0, "must not fabricate a conflict against a fact that was never created");
});

// -------------------------------------------------------------------------
// G -- deduplication / convergence.
// -------------------------------------------------------------------------

test("G. req_191-shaped and req_196-shaped requirements supporting the same 135°F fact converge on one engineering_facts row with two provenance rows", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const req191 = insertRequirement(raw, project, { sequence: 1, original_text: "Thermal detectors employ an advanced thermistor sensing circuit to deliver fixed-temperature detection at 135°F and rate-of-rise thermal detection." });
  insertAttribute(raw, req191.id, { name: "fixed_temperature_setpoint", normalizedValue: "135°F" });
  const req196 = insertRequirement(raw, project, { sequence: 2, original_text: "Features: a) Sleek design b) Advanced thermistor technology c) Rate-of-rise detection at 15°F per minute d) Factory-set fixed temperature at 135°F." });
  insertAttribute(raw, req196.id, { name: "fixed_temperature_setpoint", normalizedValue: "135°F" });
  insertAttribute(raw, req196.id, { name: "rate_of_rise_sensitivity", normalizedValue: "15°F/min" });

  const response = await promote(project.projectId, env);
  const body = await response.json();
  const facts = factsFor(raw, project.projectId);
  const tempFacts = facts.filter((f) => f.predicate === "fixed_temperature_setpoint");
  assert.equal(tempFacts.length, 1, "exactly one authoritative fact row for the converging 135°F evidence");
  assert.equal(body.promoted, 2, "one new fact for fixed_temperature_setpoint + one new fact for rate_of_rise_sensitivity");
  assert.equal(body.deduplicated, 1, "req_196's own fixed_temperature_setpoint=135°F converges onto req_191's fact instead of creating a second one");
  const provenance = raw.prepare("SELECT * FROM engineering_fact_provenance WHERE fact_id=?").all(tempFacts[0].id);
  assert.equal(provenance.length, 2);
  assert.deepEqual(new Set(provenance.map((p) => p.source_id)), new Set([req191.id, req196.id]));
});

// -------------------------------------------------------------------------
// H -- conflict handling.
// -------------------------------------------------------------------------

test("H. conflicting selected/default temperatures open a blocking engineering_knowledge_conflicts row, never a silent overwrite", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const req135 = insertRequirement(raw, project, { sequence: 1, original_text: "The heat detector fixed temperature setpoint is 135°F as tested and certified." });
  insertAttribute(raw, req135.id, { name: "fixed_temperature_setpoint", normalizedValue: "135°F" });
  const req190 = insertRequirement(raw, project, { sequence: 2, original_text: "The heat detector fixed temperature setpoint is 190°F per this revised particular specification section." });
  insertAttribute(raw, req190.id, { name: "fixed_temperature_setpoint", normalizedValue: "190°F" });

  const response = await promote(project.projectId, env);
  const body = await response.json();
  const facts = factsFor(raw, project.projectId).filter((f) => f.predicate === "fixed_temperature_setpoint");
  assert.equal(facts.length, 1, "the first-seen value stands; no second fact row is fabricated for the conflicting value");
  assert.equal(JSON.parse(facts[0].value).value, "135°F", "the existing fact's value is never silently overwritten");
  assert.equal(body.conflicts, 1);
  const conflicts = raw.prepare("SELECT * FROM engineering_knowledge_conflicts WHERE project_id=?").all(project.projectId);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].blocking, 1);
  assert.equal(conflicts[0].resolution_status, "Open");
});

// -------------------------------------------------------------------------
// I/J/K/L -- gate-level skip proofs.
// -------------------------------------------------------------------------

test("I. ambiguous/unresolved equipment subject is skipped", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const req = insertRequirement(raw, project, { clause_id: "clause_isolated_no_context", original_text: "General equipment characteristics apply across multiple systems." });
  insertAttribute(raw, req.id, { name: "fixed_temperature_setpoint", normalizedValue: "135°F" });
  const response = await promote(project.projectId, env);
  const body = await response.json();
  assert.equal(body.promoted, 0);
  assert.equal(body.skipped, 1);
  assert.equal(factsFor(raw, project.projectId).length, 0);
});

test("J. an unresolved condition/exception is skipped", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const req = insertRequirement(raw, project, { original_text: "Heat detector rate-of-rise applies only where explicitly noted on the drawings.", condition: "only where explicitly noted on the drawings" });
  insertAttribute(raw, req.id, { name: "rate_of_rise_sensitivity", normalizedValue: "15°F/min" });
  const response = await promote(project.projectId, env);
  const body = await response.json();
  assert.equal(body.promoted, 0);
  assert.equal(body.skipped, 1);
});

test("K. manufacturer/product-domain evidence is not eligible", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const req = insertRequirement(raw, project, { original_text: "Manufacturer heat detector literature states 135°F fixed temperature.", engineering_domain: "Manufacturer" });
  insertAttribute(raw, req.id, { name: "fixed_temperature_setpoint", normalizedValue: "135°F" });
  const response = await promote(project.projectId, env);
  const body = await response.json();
  assert.equal(body.promoted, 0);
  assert.equal(body.skipped, 1);
  assert.ok(Object.keys(body.skipReasonCounts).some((reason) => /manufacturer|product evidence/i.test(reason)));
});

test("K (structural). the module never queries a Product Library or manufacturer-scoped table", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../spec-source-fact-promotion.mjs", import.meta.url), "utf8");
  for (const table of ["canonical_library_products", "library_products", "product_compatibility", "requirement_manufacturers"]) {
    assert.doesNotMatch(source, new RegExp(table));
  }
});

test("L. a requirement from a stale/superseded extraction version is skipped", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  // A second, OLDER extraction version, superseded by the active one seeded
  // in seedProject -- the requirement below belongs to this stale version.
  const staleVersionId = id("extract");
  raw.prepare("INSERT INTO specification_extraction_versions (id, document_id, document_version_id, status, superseded_at, created_by) VALUES (?, ?, ?, 'Completed', ?, ?)")
    .run(staleVersionId, id("document"), id("docversion"), new Date().toISOString(), OWNER);
  const req = insertRequirement(raw, project, { extraction_version_id: staleVersionId, original_text: "Thermal detectors deliver fixed-temperature detection at 135°F." });
  insertAttribute(raw, req.id, { name: "fixed_temperature_setpoint", normalizedValue: "135°F" });
  // batchPromoteSourceFacts scans by the ACTIVE extraction version id only
  // (resolved from specification_extraction_jobs), so a requirement filed
  // under a stale version is never even selected for evaluation -- proving
  // the same outcome the explicit gate proves for a requirement that IS
  // selected but whose own extraction_version_id has since gone stale.
  const response = await promote(project.projectId, env);
  const body = await response.json();
  assert.equal(body.totalScanned, 0);
  assert.equal(body.promoted, 0);
  assert.equal(factsFor(raw, project.projectId).length, 0);

  // Direct gate proof: evaluateSourceFactCandidate against an explicitly
  // different activeExtractionVersionId than the requirement's own.
  const { evaluateSourceFactCandidate: evaluate } = await import("../spec-source-fact-promotion.mjs");
  const evaluation = await evaluate(env.DB, { requirementId: req.id, activeExtractionVersionId: project.extractionVersionId });
  assert.equal(evaluation.candidates[0].eligible, false);
  assert.match(evaluation.candidates[0].reason, /stale|superseded/i);
});

// -------------------------------------------------------------------------
// M/N -- authorization and scoping.
// -------------------------------------------------------------------------

test("M. an actor who does not own the project is rejected", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw, { ownerUserId: "someone-else" });
  const req = insertRequirement(raw, project, { original_text: "Thermal detectors deliver fixed-temperature detection at 135°F." });
  insertAttribute(raw, req.id, { name: "fixed_temperature_setpoint", normalizedValue: "135°F" });
  const response = await promote(project.projectId, env);
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error.code, "PROJECT_NOT_FOUND");
  assert.equal(factsFor(raw, project.projectId).length, 0);
});

test("N. cross-project (cross-organization) isolation: promoting on project A never creates facts for project B", async () => {
  const { raw, env } = makeFixture();
  const projectA = seedProject(raw, { organizationId: "org_a" });
  const projectB = seedProject(raw, { organizationId: "org_b" });
  const reqA = insertRequirement(raw, projectA, { original_text: "Thermal detectors deliver fixed-temperature detection at 135°F." });
  insertAttribute(raw, reqA.id, { name: "fixed_temperature_setpoint", normalizedValue: "135°F" });
  const reqB = insertRequirement(raw, projectB, { original_text: "Thermal detectors deliver fixed-temperature detection at 135°F." });
  insertAttribute(raw, reqB.id, { name: "fixed_temperature_setpoint", normalizedValue: "135°F" });

  await promote(projectA.projectId, env);
  assert.equal(factsFor(raw, projectA.projectId).length, 1);
  assert.equal(factsFor(raw, projectB.projectId).length, 0, "project B's identical evidence must remain untouched by a run scoped to project A");
});

// -------------------------------------------------------------------------
// O -- idempotency.
// -------------------------------------------------------------------------

test("O. a second identical execution is fully idempotent", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const req191 = insertRequirement(raw, project, { sequence: 1, original_text: "Thermal detectors employ an advanced thermistor sensing circuit to deliver fixed-temperature detection at 135°F." });
  insertAttribute(raw, req191.id, { name: "fixed_temperature_setpoint", normalizedValue: "135°F" });
  const req196 = insertRequirement(raw, project, { sequence: 2, original_text: "Features: d) Factory-set fixed temperature at 135°F." });
  insertAttribute(raw, req196.id, { name: "fixed_temperature_setpoint", normalizedValue: "135°F" });

  const first = await (await promote(project.projectId, env)).json();
  const factsAfterFirst = factsFor(raw, project.projectId);
  const provenanceAfterFirst = raw.prepare("SELECT * FROM engineering_fact_provenance").all();
  const versionAfterFirst = factsAfterFirst[0].version_number;

  const second = await (await promote(project.projectId, env)).json();
  const factsAfterSecond = factsFor(raw, project.projectId);
  const provenanceAfterSecond = raw.prepare("SELECT * FROM engineering_fact_provenance").all();

  assert.equal(factsAfterSecond.length, factsAfterFirst.length, "no duplicate engineering_facts rows");
  assert.equal(provenanceAfterSecond.length, provenanceAfterFirst.length, "no duplicate provenance rows for the same source requirement");
  assert.equal(factsAfterSecond[0].version_number, versionAfterFirst, "no version bump without a real reason");
  assert.equal(second.promoted, 0, "nothing new to promote the second time");
  assert.equal(second.deduplicated, 2, "both candidates are recognized as already-recorded on the second run");
  assert.equal(second.conflicts, 0);
});

// -------------------------------------------------------------------------
// P/Q -- authority boundary.
// -------------------------------------------------------------------------

test("P. every newly created fact is status='Pending Review'", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const req1 = insertRequirement(raw, project, { sequence: 1, original_text: "Thermal detectors deliver fixed-temperature detection at 135°F." });
  insertAttribute(raw, req1.id, { name: "fixed_temperature_setpoint", normalizedValue: "135°F" });
  const req2 = insertRequirement(raw, project, { sequence: 2, original_text: "UL521 – UL Standard for Heat Detectors.", requirement_type: "Informational" });
  insertStandard(raw, req2.id, { body: "UL", number: "521" });
  await promote(project.projectId, env);
  const facts = factsFor(raw, project.projectId);
  assert.ok(facts.length >= 2);
  for (const fact of facts) assert.equal(fact.status, "Pending Review");
});

test("Q. zero Active Source Facts are ever created by this operation", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const req = insertRequirement(raw, project, { original_text: "Thermal detectors deliver fixed-temperature detection at 135°F." });
  insertAttribute(raw, req.id, { name: "fixed_temperature_setpoint", normalizedValue: "135°F" });
  await promote(project.projectId, env);
  const active = raw.prepare("SELECT COUNT(*) c FROM engineering_facts WHERE status='Active'").get();
  assert.equal(active.c, 0);
});

// -------------------------------------------------------------------------
// Audit
// -------------------------------------------------------------------------

test("audit: document_audit_events and engineering_fact_provenance together reconstruct project/fact/scope/predicate/value/source/policyVersion/actor/timestamp", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const req = insertRequirement(raw, project, { original_text: "Thermal detectors deliver fixed-temperature detection at 135°F." });
  insertAttribute(raw, req.id, { name: "fixed_temperature_setpoint", normalizedValue: "135°F" });
  await promote(project.projectId, env);

  const events = raw.prepare("SELECT * FROM document_audit_events WHERE project_id=? ORDER BY id").all(project.projectId);
  const factEvent = events.find((e) => e.action === "Specification Source Fact Promoted");
  assert.ok(factEvent);
  assert.equal(factEvent.actor_user_id, OWNER);
  const detail = JSON.parse(factEvent.new_value);
  assert.equal(detail.policyVersion, SOURCE_FACT_PROMOTION_POLICY_VERSION);
  assert.ok(detail.factId);
  assert.equal(detail.predicate, "fixed_temperature_setpoint");

  const summaryEvent = events.find((e) => e.action === "Specification Source Facts Promotion Run");
  assert.ok(summaryEvent);

  const provenance = raw.prepare("SELECT * FROM engineering_fact_provenance WHERE source_id=?").get(req.id);
  assert.ok(provenance);
  assert.equal(provenance.user_id, OWNER);
  assert.equal(provenance.rule_version, SOURCE_FACT_PROMOTION_POLICY_VERSION);
});

test("a substantive reason is required", async () => {
  const { raw, env } = makeFixture();
  const project = seedProject(raw);
  const response = await handleSpecSourceFactApi(request(project.projectId, { reason: "x" }), env);
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.error.code, "SOURCE_FACT_PROMOTION_REASON_REQUIRED");
});

test("normative engine boundary: this module never imports or is imported by spec-requirement-auto-confirm.mjs", async () => {
  const { readFile } = await import("node:fs/promises");
  const [promotion, autoConfirm] = await Promise.all([
    readFile(new URL("../spec-source-fact-promotion.mjs", import.meta.url), "utf8"),
    readFile(new URL("../spec-requirement-auto-confirm.mjs", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(promotion, /from\s+["'].*spec-requirement-auto-confirm/);
  assert.doesNotMatch(autoConfirm, /from\s+["'].*spec-source-fact-promotion/);
  // And it never writes technical_requirements.review_status / approved_for_downstream.
  assert.doesNotMatch(promotion, /UPDATE technical_requirements/);
});
