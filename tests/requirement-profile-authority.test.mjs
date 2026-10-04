// STALE-EVIDENCE RESIDUAL CLOSURE for worker/technical-requirement-api.mjs.
//
// Findings covered, all behaviourally (never by reading the source text):
//
//   F6  POST /api/profile-applicability/:id/confirm|reject  must not mutate an
//       applicability verdict that hangs off a SUPERSEDED profile version.
//   F12 POST /api/profile-issues/:id/resolve|approve|reject|answer -- same.
//   F13 POST /api/requirement-intelligence/:id/approve (repeat-approval
//       idempotency read) must not report an Approved fact on a superseded
//       profile version as the current governed state.
//   F8  The knowledge-facts input must not admit fact_type='Source Fact' at all;
//       loadActiveSourceFacts is the single authority for that channel.
//   F7  Profile generation must FAIL CLOSED (naming the fact) when an Active
//       Source Fact's only extraction provenance is no longer current.
//
// The fixture is built by applying the ACTUAL active migration chain
// (drizzle-active journal), exactly as tests/zero-denominator-and-queue-debt
// .test.mjs does. That matters here: the hand-written-schema suites in this
// area have drifted so far from the canonical authority queries that most of
// them already fail with "no such column: dv.effective_from" / "no such table:
// document_supersessions", so a hand-written fixture here could only ever
// produce a false green.
//
// Every requirement row is made genuinely CURRENT through the canonical
// CURRENT_TECHNICAL_REQUIREMENT_SQL: project (not archived) + document (not
// deleted/archived) + in-force governing document_version + a 'Completed'
// non-superseded specification_extraction_versions row with no newer sibling.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { executeRequirementProfile, handleTechnicalRequirementApi, loadInputs } from "../worker/technical-requirement-api.mjs";
import { currentRequirementProfile } from "../worker/requirement-profile-currency.mjs";

const ACTIVE_ROOT = new URL("../drizzle-active", import.meta.url).pathname.replace(/\/$/, "");

const applyActiveChain = (db) => {
  const journal = JSON.parse(readFileSync(join(ACTIVE_ROOT, "meta", "_journal.json"), "utf8"));
  for (const entry of journal.entries) {
    const sql = readFileSync(join(ACTIVE_ROOT, `${entry.tag}.sql`), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) db.exec(trimmed);
    }
  }
};

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (values = []) => ({
      first: async () => raw.prepare(sql).get(...values) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...values) }),
      run: async () => raw.prepare(sql).run(...values),
    });
    return { ...operation(), bind: (...values) => operation(values) };
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

const OWNER = "local-development-user";
const REASON = "Engineer verified this against the governing specification clause and drawing set.";

const env = (raw) => ({ DB: d1(raw), APP_ACCESS_MODE: "single-user", APP_USER_ID: OWNER, APP_ORGANIZATION_ID: "org-authority" });
const ctx = { waitUntil: () => undefined };

const post = (path, body = { reason: REASON }) => new Request(`http://localhost${path}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

// effective_from a year ago / effective_to a year ahead, so the document version
// is unambiguously IN FORCE for every assertion here (half-open [from, to)).
const IN_FORCE_FROM = "2020-01-01T00:00:00.000Z";
const IN_FORCE_TO = "2999-01-01T00:00:00.000Z";

const seed = () => {
  const directory = mkdtempSync(join(tmpdir(), "req-profile-authority-"));
  const raw = new DatabaseSync(join(directory, "authority.sqlite"));
  applyActiveChain(raw);

  raw.exec(`
    INSERT INTO organizations (id, name) VALUES ('org-authority', 'Authority Org');
    INSERT INTO projects (id, name, owner_user_id, organization_id, system_domain) VALUES ('p1', 'Authority Project', '${OWNER}', 'org-authority', 'Fire Alarm');
    INSERT INTO documents (id, project_id, logical_name, created_by) VALUES ('spec-doc', 'p1', 'Specification 28 46 00', '${OWNER}');
    INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by, effective_from, effective_to)
      VALUES ('spec-dv', 'spec-doc', 1, 'spec.pdf', 'spec.stored', 'pdf', 'application/pdf', 4, 'sha-spec', 'projects/spec.pdf', '${OWNER}', '${IN_FORCE_FROM}', '${IN_FORCE_TO}');
    INSERT INTO documents (id, project_id, logical_name, created_by) VALUES ('boq-doc', 'p1', 'BOQ', '${OWNER}');
    INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by, effective_from, effective_to)
      VALUES ('boq-dv', 'boq-doc', 1, 'boq.pdf', 'boq.stored', 'pdf', 'application/pdf', 4, 'sha-boq', 'projects/boq.pdf', '${OWNER}', '${IN_FORCE_FROM}', '${IN_FORCE_TO}');
    INSERT INTO boq_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, ocr_version, created_by)
      VALUES ('boq-ext', 'boq-doc', 'boq-dv', 1, 'Completed', 'p1', 'r1', 'o1', '${OWNER}');
    INSERT INTO specification_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, model_version, prompt_version, ocr_version, created_by)
      VALUES ('spec-ext', 'spec-doc', 'spec-dv', 1, 'Completed', 'p1', 'r1', 'm1', 'pr1', 'o1', '${OWNER}');
    INSERT INTO technical_requirements (id, project_id, extraction_version_id, source_document_id, sequence, original_text, normalized_requirement, engineering_domain, domain_source_type, requirement_type, requirement_category, system, category, confidence, confidence_state, extraction_method, parser_version, model_version, source_location, original_values, current_values, review_status, approved_for_downstream)
      VALUES ('req-1', 'p1', 'spec-ext', 'spec-doc', 1, 'Manual pull stations shall be individually addressable.', 'manual pull stations shall be individually addressable.', 'Fire Detection', 'Specification', 'Mandatory', 'Documentation', 'Fire Alarm', 'Documentation', 90, 'High', 'Deterministic', 'p1', 'm1', '{"pageFrom":32,"clause":"5.1"}', '{}', '{}', 'Approved', 1);
  `);

  raw.prepare(`INSERT INTO boq_items (id, project_id, row_type, extraction_version_id, source_document_id, sequence, section_path, item_number, description, numeric_quantity, original_quantity, normalized_unit, original_unit, system_value, category, subcategory, current_values, source_location, review_status, approved_for_downstream, specification_reference, system_confidence, extraction_confidence, confidence_state, original_raw_values)
    VALUES ('item-1','p1','BOQ Item','boq-ext','boq-doc',1,'Building A','C','Manual pull station',9,9,'Each','Each','Fire Alarm','Manual Pull Station','Manual Pull Station','{}','{"page":12,"row":3}','Approved',1,NULL,90,90,'High','{}')`).run();

  raw.exec(`
    INSERT INTO boq_requirement_links (id, project_id, boq_item_id, requirement_id, scope_id, created_by, status, confidence, link_method, evidence)
      VALUES ('link-1', 'p1', 'item-1', 'req-1', 'item-1', '${OWNER}', 'Confirmed', 90, 'Human-confirmed knowledge link', '[]');
  `);

  return { raw, close: () => { raw.close(); rmSync(directory, { recursive: true, force: true }); } };
};

const knowledgeFact = (raw, { id, factType, status = "Active", scopeType = "Project" }) => {
  raw.prepare(`INSERT INTO engineering_facts (id, project_id, entity_type, entity_id, predicate, value, data_type, operator, fact_type, scope_type, scope_id, status, confidence, model_version)
    VALUES (?,'p1','Project','p1',?,'{"value":"from-knowledge-fact","unit":null}','text','Equal',?,?,NULL,?,90,'test-1.0.0')`)
    .run(id, `predicate_${id}`, factType, scopeType, status);
  return id;
};

// scope_type='BOQ Item' / scope_id='item-1' is the only scope
// resolveScopedFacts (app/domain/engineering-knowledge.mjs) can match against
// the boqItem executeRequirementProfile actually builds -- it carries no
// projectId -- so these facts genuinely reach profile.technicalFacts, which is
// what makes "was this fact consumed?" a real assertion rather than a vacuous
// one.
const sourceFact = (raw, { id, extractionVersionId = "spec-ext", status = "Active" }) => {
  raw.prepare(`INSERT INTO engineering_facts (id, project_id, entity_type, entity_id, predicate, value, data_type, operator, fact_type, scope_type, scope_id, status, confidence, model_version)
    VALUES (?,'p1','BOQ Item','item-1',?,'{"value":"135F","unit":null}','text','Equal','Source Fact','BOQ Item','item-1',?,92,'spec-source-fact-promotion-1.0.0')`)
    .run(id, `predicate_${id}`, status);
  raw.prepare(`INSERT INTO engineering_fact_provenance (id, fact_id, source_type, source_id, document_id, document_version_id, extraction_version_id, page, section, clause, confidence)
    VALUES (?,?,'Specification Extraction','req-1','spec-doc','spec-dv',?,11,'28 46 00','5.1',92)`)
    .run(`prov-${id}`, id, extractionVersionId);
  return id;
};

// GOV-AUTH-1 (docs/GOV-AUTH-1-authority-audit.md, "Facts channel --
// Pending Review/Rejected facts reached profiles (REAL, closed)").
//
// This test previously asserted the OPPOSITE policy: that a non-Source-Fact row
// reached the knowledge channel "whatever their status", explicitly including a
// Pending Review Human Decision. That was the defect, not the contract.
//
// The governed lifecycle (worker/engineering-fact-freshness.mjs:56-66,
// worker/knowledge-promotion.mjs:71) is:
//   Active/Approved  -> a recorded human decision exists; may shape a profile
//   Pending Review   -> exists, but carries NO recorded human decision yet
//   Rejected         -> explicitly refused by a human
//   Superseded       -> retired
// and app/domain/technical-requirement-engine.mjs:166 describes its own input as
// "Approved facts promoted", so the profile model was always written for
// reviewed facts; the query admitting Pending Review contradicted the model.
//
// Distinctions this preserves, which must not be collapsed:
//   knowledge EXISTENCE        -> the row exists and is visible to engineers
//   knowledge REVIEW/ACCEPTANCE-> status; only Active/Approved is accepted
//   requirement-profile ELIGIBILITY -> the gate under test
//   BOQ applicability / technical approval -> separate authorities, untouched
// Eligibility narrowing does NOT hide evidence: review surfaces that must SHOW
// pending facts (knowledge-profile GET, review lists) query separately and are
// deliberately unchanged by GOV-AUTH-1.
test("F8: the knowledge-facts input admits reviewed facts only -- Pending Review, Rejected and Superseded are excluded -- and excludes fact_type='Source Fact' entirely", async () => {
  const { raw, close } = seed();
  try {
    knowledgeFact(raw, { id: "kf-active", factType: "Human Decision" });
    knowledgeFact(raw, { id: "kf-supplier", factType: "Supplier Claim" });
    knowledgeFact(raw, { id: "kf-approved", factType: "Human Decision", status: "Approved" });
    knowledgeFact(raw, { id: "kf-pending", factType: "Human Decision", status: "Pending Review" });
    knowledgeFact(raw, { id: "kf-rejected", factType: "Supplier Claim", status: "Rejected" });
    knowledgeFact(raw, { id: "kf-superseded", factType: "Human Decision", status: "Superseded" });
    sourceFact(raw, { id: "sf-pending", status: "Pending Review" });
    sourceFact(raw, { id: "sf-rejected", status: "Rejected" });
    sourceFact(raw, { id: "sf-active", status: "Active" });

    const item = raw.prepare("SELECT *, project_id FROM boq_items WHERE id='item-1'").get();
    const inputs = await loadInputs(d1(raw), item);
    const ids = inputs.facts.map((fact) => fact.id).sort();

    // Negative coverage: a fact that has NOT reached the governed reviewed
    // state must not be able to shape a requirement profile. Each of these is a
    // distinct lifecycle outcome, asserted separately so a future change that
    // re-admits one of them names itself.
    assert.deepEqual(ids, ["kf-active", "kf-approved", "kf-supplier"],
      "only reviewed (Active/Approved) non-Source-Fact rows reach the knowledge channel");
    assert.equal(ids.includes("kf-pending"), false,
      "a Pending Review fact carries no recorded human decision and must not shape a profile");
    assert.equal(ids.includes("kf-rejected"), false,
      "an explicitly refused fact must not shape a profile");
    assert.equal(ids.includes("kf-superseded"), false,
      "a retired fact must not shape a profile");
    assert.equal(ids.includes("sf-pending"), false, "a Pending Review Source Fact must not arrive through the wrong channel");
    assert.equal(ids.includes("sf-rejected"), false, "a Rejected Source Fact must not arrive through the wrong channel");
    assert.equal(ids.includes("sf-active"), false, "an Active Source Fact arrives only through loadActiveSourceFacts");
    assert.deepEqual(inputs.sourceFacts.map((fact) => fact.factId), ["sf-active"],
      "loadActiveSourceFacts remains the single authority for the Source Fact channel");
  } finally { close(); }
});

test("F7: profile generation FAILS CLOSED and names the fact when an Active Source Fact's only extraction provenance is no longer current", async () => {
  const { raw, close } = seed();
  try {
    sourceFact(raw, { id: "sf-stale" });
    sourceFact(raw, { id: "sf-live" });

    // Baseline: with a current extraction version, the same fixture generates a
    // profile and consumes BOTH facts -- so the refusal below is caused by the
    // lineage change alone, not by the fixture.
    const DB = d1(raw);
    await executeRequirementProfile({ DB }, { itemId: "item-1", userId: OWNER, runId: null });
    const first = await currentRequirementProfile(DB, "item-1");
    assert.ok(first, "a current extraction provenance must still allow profile generation");
    assert.deepEqual(JSON.parse(first.profile).technicalFacts.map((fact) => fact.factId).sort(), ["sf-live", "sf-stale"]);

    // Retire the extraction version BOTH facts point at, then re-point one fact
    // at a fresh current extraction so the fixture distinguishes the two cases
    // rather than failing on everything.
    raw.prepare("UPDATE specification_extraction_versions SET superseded_at='2026-01-01T00:00:00.000Z' WHERE id='spec-ext'").run();
    raw.prepare(`INSERT INTO specification_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, model_version, prompt_version, ocr_version, created_by)
      VALUES ('spec-ext-2','spec-doc','spec-dv',2,'Completed','p1','r1','m1','pr1','o1','${OWNER}')`).run();
    raw.prepare(`INSERT INTO technical_requirements (id, project_id, extraction_version_id, source_document_id, sequence, original_text, normalized_requirement, engineering_domain, domain_source_type, requirement_type, requirement_category, system, category, confidence, confidence_state, extraction_method, parser_version, model_version, source_location, original_values, current_values, review_status, approved_for_downstream)
      VALUES ('req-2','p1','spec-ext-2','spec-doc',2,'Pull stations shall be addressable and supervised.','pull stations shall be addressable and supervised.','Fire Detection','Specification','Mandatory','Documentation','Fire Alarm','Documentation',90,'High','Deterministic','p1','m1','{"pageFrom":32,"clause":"5.1"}','{}','{}','Approved',1)`).run();
    raw.prepare("UPDATE engineering_fact_provenance SET extraction_version_id='spec-ext-2' WHERE fact_id='sf-live'").run();
    raw.prepare("UPDATE requirement_profile_versions SET input_fingerprint='force-recalculate' WHERE boq_item_id='item-1'").run();

    await assert.rejects(
      executeRequirementProfile({ DB }, { itemId: "item-1", userId: OWNER, runId: null }),
      (error) => {
        assert.equal(error.code, "STALE_SOURCE_FACT_EVIDENCE", "the refusal must use the module's structured-failure convention");
        assert.match(error.message, /sf-stale/, "the failure must name the stale fact");
        assert.equal(error.message.includes("sf-live"), false, "a fact with a current extraction provenance must not be reported stale");
        assert.deepEqual(error.technicalDetails.staleSourceFactIds, ["sf-stale"]);
        return true;
      },
      "stale Source Fact evidence must block profile generation, never be silently dropped",
    );

    // No new profile version was written, and the current one was not replaced:
    // the refusal is a refusal, not a silent re-numbering.
    const versions = raw.prepare("SELECT id, version_number FROM requirement_profile_versions WHERE boq_item_id='item-1' ORDER BY version_number").all();
    assert.equal(versions.length, 1, "a failed generation must not persist a differently-numbered profile");
    assert.equal((await currentRequirementProfile(DB, "item-1")).id, first.id, "the last good profile stays current and usable");
  } finally { close(); }
});

test("F7 (supported case): a Source Fact whose extraction provenance is stale but which carries non-extraction provenance is not stale, matching the invalidator's own rule", async () => {
  const { raw, close } = seed();
  try {
    sourceFact(raw, { id: "sf-stale" });
    raw.prepare(`INSERT INTO engineering_fact_provenance (id, fact_id, source_type, source_id, document_id, page, section, clause, confidence)
      VALUES ('prov-manual','sf-stale','Manufacturer Datasheet','ds-1','spec-doc',4,'28 46 00','2.1',90)`).run();
    raw.prepare("UPDATE specification_extraction_versions SET superseded_at='2026-01-01T00:00:00.000Z' WHERE id='spec-ext'").run();

    const DB = d1(raw);
    await executeRequirementProfile({ DB }, { itemId: "item-1", userId: OWNER, runId: null });
    const profile = await currentRequirementProfile(DB, "item-1");
    assert.ok(profile, "one surviving authoritative provenance is enough; this is not a stale fact");
    assert.deepEqual(JSON.parse(profile.profile).technicalFacts.map((fact) => fact.factId), ["sf-stale"]);
  } finally { close(); }
});

// F6 / F12 / F13 all need the same world: a profile version that has been
// superseded by a later regeneration, plus the current replacement.
const supersededAndCurrentProfiles = async () => {
  const fixture = seed();
  const DB = d1(fixture.raw);
  await executeRequirementProfile({ DB }, { itemId: "item-1", userId: OWNER, runId: null });
  const stale = await currentRequirementProfile(DB, "item-1");
  assert.ok(stale, "V1 must exist");
  const applicabilityOnStale = fixture.raw.prepare("SELECT id FROM profile_requirement_applicability WHERE profile_version_id=? ORDER BY id LIMIT 1").get(stale.id);
  assert.ok(applicabilityOnStale, "profile generation must have written an applicability verdict to assert on");
  fixture.raw.prepare(`INSERT INTO profile_issues (id, profile_version_id, issue_type, related_requirement_id, related_field, payload, severity, blocking, status)
    VALUES ('issue-stale', ?, 'Missing Information', 'req-1', 'addressing', '{"question":"Which addressing method governs?"}', 'High', 1, 'Open')`).run(stale.id);
  fixture.raw.prepare(`INSERT INTO requirement_intelligence_facts (id, profile_version_id, requirement_id, fact_key, fact_type, original_value, current_value, modality, confidence, evidence_snippet, extraction_basis, engine_version, review_status)
    VALUES ('if-stale', ?, 'req-1', 'req-1:Addressability:Addressable', 'Addressability', '"Addressable"', '"Addressable"', 'Mandatory', 90, 'shall be individually addressable', 'Explicit specification wording', 'test-engine', 'Approved')`).run(stale.id);

  // Regenerate: V1 is superseded, V2 is current, and V2 carries its own rows.
  fixture.raw.prepare("UPDATE requirement_profile_versions SET input_fingerprint='force-recalculate' WHERE boq_item_id='item-1'").run();
  await executeRequirementProfile({ DB }, { itemId: "item-1", userId: OWNER, runId: null });
  const current = await currentRequirementProfile(DB, "item-1");
  assert.ok(current, "V2 must exist");
  assert.notEqual(current.id, stale.id);
  assert.ok(stale.id && fixture.raw.prepare("SELECT superseded_at FROM requirement_profile_versions WHERE id=?").get(stale.id).superseded_at, "V1 is superseded");
  return { ...fixture, DB, stale, current, applicabilityOnStale: applicabilityOnStale.id };
};

test("F6: confirming applicability on a superseded profile version is refused and mutates nothing; the current profile version still succeeds", async () => {
  const { raw, DB, close, stale, current, applicabilityOnStale } = await supersededAndCurrentProfiles();
  try {
    const environment = env(raw);
    const refused = await handleTechnicalRequirementApi(post(`/api/profile-applicability/${applicabilityOnStale}/confirm`), environment, ctx);
    assert.equal(refused.status, 409);
    const refusedBody = await refused.json();
    assert.equal(refusedBody.error.code, "APPLICABILITY_PROFILE_SUPERSEDED");
    assert.match(refusedBody.error.message, /superseded/i);

    const untouched = raw.prepare("SELECT * FROM profile_requirement_applicability WHERE id=?").get(applicabilityOnStale);
    assert.notEqual(untouched.review_status, "Reviewed", "a stale applicability verdict must not be marked Reviewed");
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM requirement_profile_decisions WHERE entity_id=? AND profile_version_id=?").get(applicabilityOnStale, stale.id).n, 0, "no decision row may be written against a superseded profile version");
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM document_audit_events WHERE action LIKE 'Requirement Profile %' AND project_id='p1' AND old_value LIKE ?").get(`%${applicabilityOnStale}%`).n, 0, "no audit event may be written for the refused decision");

    // The identical call on the CURRENT profile version succeeds and is recorded.
    const currentRow = raw.prepare("SELECT id FROM profile_requirement_applicability WHERE profile_version_id=? ORDER BY id LIMIT 1").get(current.id);
    assert.ok(currentRow, "the current profile version must carry its own applicability verdict");
    const accepted = await handleTechnicalRequirementApi(post(`/api/profile-applicability/${currentRow.id}/confirm`), environment, ctx);
    assert.equal(accepted.status, 200);
    const acceptedBody = await accepted.json();
    assert.equal(acceptedBody.applicability.status, "Confirmed Applicable");
    assert.equal(raw.prepare("SELECT review_status FROM profile_requirement_applicability WHERE id=?").get(currentRow.id).review_status, "Reviewed");
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM requirement_profile_decisions WHERE entity_id=? AND profile_version_id=?").get(currentRow.id, current.id).n, 1);

    // A row that does not exist at all is still a plain 404, not a 409.
    const missing = await handleTechnicalRequirementApi(post("/api/profile-applicability/does-not-exist/confirm"), environment, ctx);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, "APPLICABILITY_NOT_FOUND");
    assert.ok(DB);
  } finally { close(); }
});

test("F12: resolving a profile issue on a superseded profile version is refused and mutates nothing; the current profile version still succeeds", async () => {
  const { raw, close, stale, current } = await supersededAndCurrentProfiles();
  try {
    const environment = env(raw);
    for (const action of ["resolve", "approve", "reject", "answer"]) {
      const refused = await handleTechnicalRequirementApi(post(`/api/profile-issues/issue-stale/${action}`), environment, ctx);
      assert.equal(refused.status, 409, `${action} must be refused on a superseded profile version`);
      assert.equal((await refused.json()).error.code, "PROFILE_ISSUE_PROFILE_SUPERSEDED");
    }
    assert.equal(raw.prepare("SELECT status FROM profile_issues WHERE id='issue-stale'").get().status, "Open", "the stale issue must keep its status");
    assert.equal(raw.prepare("SELECT resolved_by FROM profile_issues WHERE id='issue-stale'").get().resolved_by, null, "the stale issue must not gain a resolver");
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM requirement_profile_decisions WHERE entity_id='issue-stale'").get().n, 0, "no decision row may be written against a superseded profile version");

    const currentIssueId = "issue-current";
    raw.prepare(`INSERT INTO profile_issues (id, profile_version_id, issue_type, related_requirement_id, related_field, payload, severity, blocking, status)
      VALUES (?, ?, 'Missing Information', 'req-1', 'addressing', '{"question":"Which addressing method governs?"}', 'High', 1, 'Open')`).run(currentIssueId, current.id);
    const accepted = await handleTechnicalRequirementApi(post(`/api/profile-issues/${currentIssueId}/resolve`), environment, ctx);
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).status, "Resolved");
    assert.equal(raw.prepare("SELECT status FROM profile_issues WHERE id=?").get(currentIssueId).status, "Resolved");
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM requirement_profile_decisions WHERE entity_id=?").get(currentIssueId).n, 1);
    assert.ok(stale);

    const missing = await handleTechnicalRequirementApi(post("/api/profile-issues/does-not-exist/resolve"), environment, ctx);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, "PROFILE_ISSUE_NOT_FOUND");
  } finally { close(); }
});

test("F13: the repeat-approval idempotency read does not report an Approved fact on a superseded profile version as current; a current profile version still succeeds", async () => {
  const { raw, close, current } = await supersededAndCurrentProfiles();
  try {
    const environment = env(raw);
    const refused = await handleTechnicalRequirementApi(post("/api/requirement-intelligence/if-stale/approve"), environment, ctx);
    assert.equal(refused.status, 409, "a superseded profile version must not be answered as an idempotent approval");
    const refusedBody = await refused.json();
    assert.equal(refusedBody.error.code, "INTELLIGENCE_FACT_PROFILE_SUPERSEDED");
    assert.equal(refusedBody.fact, undefined, "no fact may be reported as the current governed state");

    raw.prepare(`INSERT INTO requirement_intelligence_facts (id, profile_version_id, requirement_id, fact_key, fact_type, original_value, current_value, modality, confidence, evidence_snippet, extraction_basis, engine_version, review_status)
      VALUES ('if-current', ?, 'req-1', 'req-1:Addressability:Addressable', 'Addressability', '"Addressable"', '"Addressable"', 'Mandatory', 90, 'shall be individually addressable', 'Explicit specification wording', 'test-engine', 'Approved')`).run(current.id);
    const accepted = await handleTechnicalRequirementApi(post("/api/requirement-intelligence/if-current/approve"), environment, ctx);
    assert.equal(accepted.status, 200, "an Approved fact on the CURRENT profile version is still decidable");
    const acceptedBody = await accepted.json();
    assert.equal(acceptedBody.fact.review_status, "Approved");
    assert.equal(acceptedBody.profileVersion, current.version_number);
    assert.equal(acceptedBody.error, undefined, "the current profile version must not be refused as superseded");

    const missing = await handleTechnicalRequirementApi(post("/api/requirement-intelligence/does-not-exist/approve"), environment, ctx);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, "INTELLIGENCE_FACT_NOT_FOUND");
  } finally { close(); }
});
