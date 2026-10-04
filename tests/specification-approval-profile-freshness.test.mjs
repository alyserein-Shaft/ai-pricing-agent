import test from "node:test";
import assert from "node:assert/strict";

import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import { handleSpecificationExtractionApi } from "../worker/specification-extraction-api.mjs";
import { currentRequirementProfile } from "../worker/requirement-profile-currency.mjs";
import { matchRunStaleness } from "../worker/product-matching-api.mjs";
import { candidateStaleness } from "../worker/confidence-safety-api.mjs";

// Slice 1b reconciliation: verifies the ORIGINAL defect route
// (POST /api/requirements/:id/approve in
// worker/specification-extraction-api.mjs) -- NOT the separate
// intelligence-fact approval endpoint, which is a disjoint handler over
// disjoint entities (requirement_intelligence_facts vs
// technical_requirements) with no shared invalidation path.
//
// Defect under test: approving a specification requirement commits the
// approval, then regenerates affected profiles inline. Between publication
// and replacement, the old profile version is still returned as current
// and V1-bound match runs still read fresh. Worse, a failing regeneration
// supersedes EVERY non-superseded version for the item
// (WHERE boq_item_id=? AND superseded_at IS NULL), so a delayed failure
// can destroy a newer valid profile created concurrently.
//
// WHY THE CANONICAL FIXTURE INSTEAD OF A HAND-WRITTEN SCHEMA
// ---------------------------------------------------------
// This file used to carry a 31-table `new DatabaseSync(":memory:")`
// approximation with `PRAGMA foreign_keys=OFF` and its own `d1` shim. All
// four tests here failed with `Error: no such table:
// canonical_library_products` -- that relation is the recursive
// supersession VIEW created by
// `drizzle-active/0000_baseline_schema_0082.sql`, joined by
// worker/technical-requirement-api.mjs's engineering-relationships query
// (COMPAT-GOV currency) that every `executeRequirementProfile` call runs
// through `loadInputs`. A hand-written list could not express it, and
// appending a CREATE VIEW is exactly how that drift returns on the next
// migration, so the local schema is NOT patched here.
//
// Every database below is therefore `activeChainDatabase()` -- the ACTUAL
// ordered drizzle-active chain read from the migration journal -- wrapped
// in the shared `d1()` adapter, which already accepts the same
// `{onRead, onWrite}` interception hooks this file's write gate needs, so
// no local adapter fork is kept. That adapter's `batch()` runs statements
// sequentially in autocommit (see the fixture's MODELLING NOTE): a single
// node:sqlite connection cannot hold two open write transactions, which
// would make the interleaving under test unrepresentable. The defect under
// test is WHERE-clause scope -- which rows an UPDATE touches -- which is
// identical with or without an enclosing transaction, and no test in this
// file asserts batch atomicity. Statement order and arguments are
// byte-identical to production.
//
// Foreign-key enforcement is left ON, because the real chain leaves it on
// (drizzle-active/0002_governing_source_fk.sql), so every seed below is
// referentially complete and lands on a real in-force evidence chain
// (documents -> document_versions -> extraction versions -> boq_items /
// technical_requirements). That is not cosmetic: the current-evidence
// authority resolves currentness through document-version effective
// bounds, so an approximation row that is not genuinely current would make
// `loadInputs` legitimately return nothing and every assertion below would
// become vacuous. Nothing is stubbed around the authority.
//
// :memory: only. No live data, no commits.

const OWNER = "local-development-user";
const REASON = "Engineer verified the detector requirement against the specification clause.";

// The fixture is the ACTUAL ordered active migration chain (drizzle-active
// journal) -- see tests/fixtures/active-chain-fixture.mjs -- not a hand-written
// approximation, for the reason stated at the top of this file. The shared
// adapter's `d1(raw, { onRead, onWrite })` already provides the write
// interception gate the first two tests below need, so the local shim this file
// used to carry is gone rather than forked.
//
// Foreign-key enforcement is on (the real chain leaves it on --
// drizzle-active/0002_governing_source_fk.sql), so the seeds below are
// referentially complete: `projects.organization_id` is a real FK to
// `organizations`, and `boq_items` / `technical_requirements` are FK children of
// real extraction versions hanging off real documents and real document
// versions.
//
// DOC-R3: `document_versions.effective_from`/`effective_to` are left NULL on
// purpose -- open-past/open-future == IN FORCE -- so each seeded document
// version is its document's GOVERNING version, which is what
// CURRENT_BOQ_EVIDENCE_SQL / CURRENT_TECHNICAL_REQUIREMENT_SQL require before
// they will return the item or the requirement at all
// (app/domain/effective-time-policy.mjs inForceWindowSql). `documents
// .current_version_id` is also set, but the authority does not read it.
const buildDatabase = () => {
  const raw = activeChainDatabase();
  raw.exec(`
    INSERT INTO organizations (id, name) VALUES ('org1', 'Org One');
    INSERT INTO projects (id, name, owner_user_id, organization_id) VALUES ('p1', 'Central Kitchen', '${OWNER}', 'org1');
  `);
  return raw;
};

// One BOQ item on its OWN source document (a BOQ, never the specification the
// requirement comes from -- the current-evidence authority joins
// boq_extraction_versions to documents and would reject a shared head).
// The real boq_items additionally requires section_path (JSON),
// original_raw_values and confidence_state, all NOT NULL, and its
// numeric_quantity / original_quantity are TEXT -- so the quantities below are
// the same 1 the approximation stored, as TEXT. source_location is NOT NULL
// JSON on the real table, so the approximation's NULL becomes a real
// source_location object. system_value / category / subcategory /
// specification_reference / system_confidence stay NULL, exactly as before:
// this slice is about approval freshness, not about classification.
const seedItem = (raw, itemId, description = "Addressable heat detector unit") => {
  raw.exec(`
    INSERT INTO documents (id, project_id, logical_name, document_type, classification_source, created_by)
      VALUES ('doc-${itemId}', 'p1', 'boq-${itemId}.xlsx', 'BOQ', 'Manual', '${OWNER}');
    INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by)
      VALUES ('dv-${itemId}', 'doc-${itemId}', 1, 'boq-${itemId}.xlsx', 'boq-${itemId}.stored', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 4, 'sha-dv-${itemId}', 'projects/p1/boq-${itemId}.xlsx', '${OWNER}');
    UPDATE documents SET current_version_id = 'dv-${itemId}' WHERE id = 'doc-${itemId}';
    INSERT INTO boq_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, ocr_version, created_by)
      VALUES ('ext-${itemId}', 'doc-${itemId}', 'dv-${itemId}', 1, 'Completed', 'parser-v1', 'rules-v1', 'ocr-v1', '${OWNER}');
  `);
  raw.prepare(`INSERT INTO boq_items (id, project_id, row_type, extraction_version_id, source_document_id, sequence, section_path, item_number, description, numeric_quantity, original_quantity, normalized_unit, original_unit, system_value, category, subcategory, manufacturer, model, part_number, current_values, source_location, original_raw_values, review_status, approved_for_downstream, specification_reference, system_confidence, extraction_confidence, confidence_state)
    VALUES (?,'p1','BOQ Item','ext-${itemId}','doc-${itemId}',1,'[]','28',?,'1','1','No.','No.',NULL,NULL,NULL,NULL,NULL,NULL,'{}','{"row": 3, "column": "Quantity"}','{}','Approved',1,NULL,NULL,95,'High Confidence')`).run(itemId, description);
};

// The requirement is bound to a real, current document version: the canonical
// current-technical-requirement population requires the extraction version, its
// document (project-scoped, undeleted, unarchived) and that document's
// GOVERNING version to all agree, so an orphan extraction version would never be
// read. The real technical_requirements additionally requires sequence,
// engineering_domain, domain_source_type, confidence_state, extraction_method,
// parser_version, model_version, original_values and current_values, all NOT
// NULL, and is UNIQUE(extraction_version_id, sequence).
const seedRequirement = (raw, reqId) => {
  raw.exec(`
    INSERT INTO documents (id, project_id, logical_name, document_type, classification_source, created_by)
      VALUES ('spec-doc-1', 'p1', 'spec.pdf', 'Technical Specification', 'Manual', '${OWNER}');
    INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by)
      VALUES ('spec-doc-v1', 'spec-doc-1', 1, 'spec.pdf', 'spec.stored', 'pdf', 'application/pdf', 4, 'sha-spec-doc-v1', 'projects/p1/spec.pdf', '${OWNER}');
    UPDATE documents SET current_version_id = 'spec-doc-v1' WHERE id = 'spec-doc-1';
    INSERT INTO specification_extraction_versions (id, document_id, document_version_id, superseded_at, version_number, status, parser_version, ruleset_version, model_version, prompt_version, ocr_version, created_by)
      VALUES ('spec-extraction-1', 'spec-doc-1', 'spec-doc-v1', NULL, 1, 'Completed', 'x', 'x', 'x', 'x', 'x', '${OWNER}');
  `);
  raw.prepare(`INSERT INTO technical_requirements (id, project_id, extraction_version_id, source_document_id, sequence, original_text, normalized_requirement, requirement_type, requirement_category, engineering_domain, domain_source_type, system, category, condition, exception, confidence, confidence_state, review_status, extraction_method, parser_version, model_version, source_location, approved_for_downstream, original_values, current_values)
    VALUES (?,'p1','spec-extraction-1','spec-doc-1',1,'Heat detectors shall be individually addressable.','heat detectors shall be individually addressable.','Mandatory','Compliance','Fire Alarm','Specification','Fire Alarm','Detection Devices',NULL,NULL,90,'High','Needs Review','Explicit specification wording','x','x','{"pageFrom": 32, "clause": "5"}',0,'{}','{}')`)
    .run(reqId);
};

// The real boq_requirement_links additionally requires link_method, confidence,
// evidence, scope_id and created_by, and its boq_item_id / requirement_id /
// project_id are real foreign keys -- so this row can now only exist when both
// endpoints genuinely exist, which the approximation could not express.
const linkRequirement = (raw, boqItemId, requirementId) => {
  raw.prepare(`INSERT INTO boq_requirement_links (id, project_id, boq_item_id, requirement_id, superseded_at, status, confidence, link_method, evidence, scope_id, created_by) VALUES (?,'p1',?,?,NULL,'Confirmed',90,'test','[]',?,'${OWNER}')`)
    .run(`link-${boqItemId}-${requirementId}`, boqItemId, requirementId, boqItemId);
};

const seedProfileVersion = (raw, { id, boqItemId, versionNumber }) => {
  raw.prepare(`INSERT INTO requirement_profile_versions (id, project_id, boq_item_id, processing_run_id, version_number, status, engine_version, ruleset_version, model_version, input_fingerprint, profile, explanation, readiness_status, confidence_summary, created_by, completed_at, superseded_at) VALUES (?,'p1',?,NULL,?,'Completed','x','x','x','fp-pre','{}','x','Ready with Warnings','{}','owner1','2026-08-23T00:00:00Z',NULL)`)
    .run(id, boqItemId, versionNumber);
};

// The real product_match_runs row carries a governed engine/search identity
// (input_fingerprint / engine_version / ruleset_version / search_version /
// model_version / search_scope / summary / created_by), not just the two
// foreign keys the freshness path compares. Named columns only.
const seedMatchRun = (raw, { runId, boqItemId, profileVersionId, versionNumber = 1 }) => {
  raw.prepare("INSERT INTO product_match_runs (id, project_id, boq_item_id, requirement_profile_version_id, version_number, status, input_fingerprint, engine_version, ruleset_version, search_version, model_version, search_scope, summary, created_by) VALUES (?, 'p1', ?, ?, ?, 'Needs Review', 'fp-run-1', 'engine-1', 'rules-1', 'search-1', 'model-1', '{}', '{}', 'local-development-user')")
    .run(runId, boqItemId, profileVersionId, versionNumber);
};

const approveRequest = (requirementId) => new Request(`http://localhost/api/requirements/${requirementId}/approve`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ reason: REASON }),
});

const waitFor = async (predicate, label) => {
  for (let i = 0; i < 2000; i += 1) {
    if (predicate()) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`gate never reached: ${label}`);
};

const currentProfileId = async (db, boqItemId) => {
  const { currentRequirementProfileId } = await import("../worker/requirement-profile-currency.mjs");
  return currentRequirementProfileId(db, boqItemId);
};

const currentProfile = async (db, boqItemId) => {
  const { currentRequirementProfile } = await import("../worker/requirement-profile-currency.mjs");
  return currentRequirementProfile(db, boqItemId);
};

test("original route: after approval publication and before replacement, the old profile is still accepted as current and its runs read fresh", async () => {
  const raw = buildDatabase();
  // Gate: hold the FIRST profile-version INSERT (persist moment) so the
  // approval is committed while no replacement exists yet.
  let persistArrived = false;
  let releasePersist = null;
  const holdPersist = new Promise((resolve) => { releasePersist = resolve; });
  const seenWrites = [];
  const DB = d1(raw, {
    onWrite: async (sql) => {
      if (seenWrites.length < 40) seenWrites.push(String(sql).slice(0, 90));
      if (/^\s*INSERT INTO requirement_profile_versions\b/i.test(sql) && !persistArrived) {
        persistArrived = true;
        await holdPersist;
      }
    },
  });
  const env = {
    DB,
    FILES: {},
    // Fixture server-configured human identity (see human-actor-attribution).
    APP_HUMAN_ID: "op-test-human-01",
    APP_HUMAN_NAME: "Test Human Operator",
    APP_HUMAN_EMAIL: "human-operator@example.test",
  };

  for (const itemId of ["boq-a", "boq-b"]) seedItem(raw, itemId);
  seedRequirement(raw, "req-1");
  linkRequirement(raw, "boq-a", "req-1");
  linkRequirement(raw, "boq-b", "req-1");
  seedProfileVersion(raw, { id: "v1a", boqItemId: "boq-a", versionNumber: 1 });
  seedProfileVersion(raw, { id: "v1b", boqItemId: "boq-b", versionNumber: 1 });
  seedMatchRun(raw, { runId: "run-a", boqItemId: "boq-a", profileVersionId: "v1a" });
  seedMatchRun(raw, { runId: "run-b", boqItemId: "boq-b", profileVersionId: "v1b" });

  const { handleSpecificationExtractionApi } = await import("../worker/specification-extraction-api.mjs");
  const { matchRunStaleness } = await import("../worker/product-matching-api.mjs");
  const { candidateStaleness } = await import("../worker/confidence-safety-api.mjs");

  // Sanity: everything fresh before approval.
  assert.equal((await matchRunStaleness(DB, "boq-a", raw.prepare("SELECT * FROM product_match_runs WHERE id='run-a'").get())).stale, false);

  // Fire the REAL approve handler without awaiting: approval commits, then
  // its inline regeneration runs for both items and blocks at persist.
  const pending = handleSpecificationExtractionApi(approveRequest("req-1"), env);
  let settled = null;
  pending.then(
    (response) => { settled = { status: response.status }; },
    (error) => { settled = { error: String(error && error.message || error) }; },
  );
  try {
    await waitFor(() => persistArrived, "regen persist gate");
  } catch (error) {
    console.error("DEBUG writes seen:", JSON.stringify(seenWrites, null, 1));
    console.error("DEBUG pending settled:", JSON.stringify(settled));
    const response = await pending;
    console.error("DEBUG response:", response.status, (await response.text()).slice(0, 900));
    throw error;
  }

  // Approval is published...
  assert.equal(raw.prepare("SELECT review_status FROM technical_requirements WHERE id='req-1'").get().review_status, "Approved");
  assert.equal(raw.prepare("SELECT approved_for_downstream FROM technical_requirements WHERE id='req-1'").get().approved_for_downstream, 1);

  // ...but no replacement exists yet, and the old versions are still
  // returned as current and read as fresh through BOTH freshness paths.
  // Desired: current null + stale true. Actual (defect): V1 current + fresh.
  const currentA = await currentProfile(DB, "boq-a");
  assert.equal(currentA, null, "DEFECT SLOT 1: invalidated-window profile must not be returned as current");
  const currentB = await currentProfile(DB, "boq-b");
  assert.equal(currentB, null, "DEFECT SLOT 2: invalidated-window profile must not be returned as current");
  assert.equal((await matchRunStaleness(DB, "boq-a", raw.prepare("SELECT * FROM product_match_runs WHERE id='run-a'").get())).stale, true);
  assert.equal((await matchRunStaleness(DB, "boq-b", raw.prepare("SELECT * FROM product_match_runs WHERE id='run-b'").get())).stale, true);
  assert.equal((await candidateStaleness(DB, { boq_item_id: "boq-a", requirement_profile_version_id: "v1a" })).stale, true);
  assert.equal((await candidateStaleness(DB, { boq_item_id: "boq-b", requirement_profile_version_id: "v1b" })).stale, true);

  // Resume: release persist, await full completion.
  releasePersist();
  const response = await pending;
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.profiles.failed, 0);

  // Recovery: usable updated profiles, old runs stale, new runs fresh.
  const v2a = await currentProfile(DB, "boq-a");
  const v2b = await currentProfile(DB, "boq-b");
  assert.ok(v2a && v2b, "recovery must leave usable current profiles");
  assert.equal(v2a.version_number, 2);
  assert.equal(v2b.version_number, 2);
  assert.equal((await matchRunStaleness(DB, "boq-a", raw.prepare("SELECT * FROM product_match_runs WHERE id='run-a'").get())).stale, true);
  // Named columns via the shared seed helper: the real product_match_runs
  // carries a governed engine/search identity, and the real table enforces
  // UNIQUE(boq_item_id, version_number), so the second run for this item is
  // version 2, exactly as product matching would number it.
  seedMatchRun(raw, { runId: "run-a2", boqItemId: "boq-a", profileVersionId: v2a.id, versionNumber: 2 });
  assert.equal((await matchRunStaleness(DB, "boq-a", raw.prepare("SELECT * FROM product_match_runs WHERE id='run-a2'").get())).stale, false);
  raw.close();
});

test("original route: an older failing refresh after a concurrent successful refresh must not supersede the newer valid version", async () => {
  const raw = buildDatabase();
  // Gate modes: HOLD the first profile INSERT, then FAIL it on release.
  let persistArrived = false;
  let releasePersist = null;
  let failPersist = false;
  const holdPersist = new Promise((resolve) => { releasePersist = resolve; });
  const DB = d1(raw, {
    onWrite: async (sql) => {
      if (/^\s*INSERT INTO requirement_profile_versions\b/i.test(sql) && !persistArrived) {
        persistArrived = true;
        await holdPersist;
        if (failPersist) throw new Error("FAULT_INJECTED_PERSIST");
      }
    },
  });
  const env = {
    DB,
    FILES: {},
    // Fixture server-configured human identity (see human-actor-attribution).
    APP_HUMAN_ID: "op-test-human-01",
    APP_HUMAN_NAME: "Test Human Operator",
    APP_HUMAN_EMAIL: "human-operator@example.test",
  };

  seedItem(raw, "boq-c");
  seedRequirement(raw, "req-2");
  linkRequirement(raw, "boq-c", "req-2");
  seedProfileVersion(raw, { id: "v1c", boqItemId: "boq-c", versionNumber: 1 });
  seedMatchRun(raw, { runId: "run-c", boqItemId: "boq-c", profileVersionId: "v1c" });

  const { handleSpecificationExtractionApi } = await import("../worker/specification-extraction-api.mjs");

  // Older attempt starts first and blocks at persist (approval committed).
  const older = handleSpecificationExtractionApi(approveRequest("req-2"), env);
  await waitFor(() => persistArrived, "older regen persist gate");

  // Newer concurrent refresh runs fully to a valid replacement.
  // (Gate already consumed by the older attempt: single persist stream here.)
  const { executeRequirementProfile } = await import("../worker/technical-requirement-api.mjs");
  await executeRequirementProfile(env, { itemId: "boq-c", userId: "local-development-user", runId: null });
  const v2c = await currentProfile(DB, "boq-c");
  assert.notEqual(v2c.id, "v1c", "newer refresh produced a replacement version");
  assert.equal(v2c.version_number, 2);

  // Older attempt now fails. Its failure handler must not touch V2c.
  failPersist = true;
  releasePersist();
  const olderResponse = await older;
  assert.equal(olderResponse.status, 502, "older failure is reported truthfully, never as success");
  const v2row = raw.prepare("SELECT superseded_at FROM requirement_profile_versions WHERE id=?").get(v2c.id);
  assert.equal(v2row.superseded_at, null, "DEFECT SLOT: newer valid version must survive an older attempt's failure");
  const current = await currentProfile(DB, "boq-c");
  assert.equal(current.id, v2c.id, "DEFECT SLOT: newer valid version must remain the usable current profile");
  const nonSuperseded = raw.prepare("SELECT COUNT(*) AS n FROM requirement_profile_versions WHERE boq_item_id='boq-c' AND superseded_at IS NULL").get().n;
  assert.equal(nonSuperseded, 1, "exactly one current version may exist");
  raw.close();
});

test("original route: an ordinary successful approval invalidates V1, generates V2 including the newly approved requirement, and refreshes the linked item", async () => {
  const raw = buildDatabase();
  const DB = d1(raw);
  const env = {
    DB,
    FILES: {},
    // Fixture server-configured human identity (see human-actor-attribution).
    APP_HUMAN_ID: "op-test-human-01",
    APP_HUMAN_NAME: "Test Human Operator",
    APP_HUMAN_EMAIL: "human-operator@example.test",
  };

  seedItem(raw, "boq-d");
  seedRequirement(raw, "req-3");
  linkRequirement(raw, "boq-d", "req-3");
  seedProfileVersion(raw, { id: "v1d", boqItemId: "boq-d", versionNumber: 1 });

  const response = await handleSpecificationExtractionApi(approveRequest("req-3"), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.profiles.affectedItems, 1);
  assert.equal(body.profiles.refreshed, 1);
  assert.equal(body.profiles.failed, 0);

  assert.equal(raw.prepare("SELECT review_status, approved_for_downstream FROM technical_requirements WHERE id='req-3'").get().approved_for_downstream, 1);

  const v1row = raw.prepare("SELECT superseded_at FROM requirement_profile_versions WHERE id='v1d'").get();
  assert.notEqual(v1row.superseded_at, null, "V1 must be invalidated once approval publishes");

  const v2 = await currentProfile(DB, "boq-d");
  assert.ok(v2, "a fresh replacement profile must be published");
  assert.notEqual(v2.id, "v1d");
  assert.equal(v2.version_number, 2);

  const linked = raw.prepare("SELECT COUNT(*) AS n FROM profile_requirement_applicability WHERE profile_version_id=? AND requirement_id='req-3'").get(v2.id);
  assert.ok(linked.n >= 1, "V2 must include the newly approved requirement, which V1 (generated before approval) could not");

  const nonSuperseded = raw.prepare("SELECT COUNT(*) AS n FROM requirement_profile_versions WHERE boq_item_id='boq-d' AND superseded_at IS NULL").get().n;
  assert.equal(nonSuperseded, 1, "exactly one current version may exist");
  raw.close();
});

test("original route: a repeat approval of an already-Approved requirement does not destructively invalidate the still-valid current profile or create unnecessary churn", async () => {
  const raw = buildDatabase();
  const DB = d1(raw);
  const env = {
    DB,
    FILES: {},
    // Fixture server-configured human identity (see human-actor-attribution).
    APP_HUMAN_ID: "op-test-human-01",
    APP_HUMAN_NAME: "Test Human Operator",
    APP_HUMAN_EMAIL: "human-operator@example.test",
  };

  seedItem(raw, "boq-e");
  seedRequirement(raw, "req-4");
  linkRequirement(raw, "boq-e", "req-4");
  seedProfileVersion(raw, { id: "v1e", boqItemId: "boq-e", versionNumber: 1 });

  // First approval: genuine transition into Approved -- invalidates V1,
  // publishes V2.
  const first = await handleSpecificationExtractionApi(approveRequest("req-4"), env);
  assert.equal(first.status, 200);
  const v2 = await currentProfile(DB, "boq-e");
  assert.ok(v2);
  assert.equal(v2.version_number, 2);

  // Second (repeat) approval: the requirement is already Approved, so
  // nothing about its downstream-affecting inputs changes. The atomic
  // invalidation gate must skip it entirely, and executeRequirementProfile's
  // own input-fingerprint idempotency must make the rerun a true no-op.
  const second = await handleSpecificationExtractionApi(approveRequest("req-4"), env);
  assert.equal(second.status, 200);
  const secondBody = await second.json();
  assert.equal(secondBody.profiles.failed, 0);
  assert.equal(secondBody.profiles.outcomes[0].idempotent, true, "repeat approval must not churn a fresh version");

  const v2row = raw.prepare("SELECT superseded_at, version_number FROM requirement_profile_versions WHERE id=?").get(v2.id);
  assert.equal(v2row.superseded_at, null, "repeat approval must not supersede the still-valid current profile");
  assert.equal(v2row.version_number, 2, "repeat approval must not create unnecessary version churn");

  const stillCurrent = await currentProfile(DB, "boq-e");
  assert.ok(stillCurrent, "the item must never be left without a current profile merely because approval was called again");
  assert.equal(stillCurrent.id, v2.id);

  const versionCount = raw.prepare("SELECT COUNT(*) AS n FROM requirement_profile_versions WHERE boq_item_id='boq-e'").get().n;
  assert.equal(versionCount, 2, "no third version was fabricated by the repeat call");
  raw.close();
});
