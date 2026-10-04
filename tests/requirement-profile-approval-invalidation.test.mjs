import test from "node:test";
import assert from "node:assert/strict";

import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import { executeRequirementProfile, handleTechnicalRequirementApi } from "../worker/technical-requirement-api.mjs";
import { currentRequirementProfile, currentRequirementProfileId } from "../worker/requirement-profile-currency.mjs";
import { matchRunStaleness } from "../worker/product-matching-api.mjs";
import { candidateStaleness } from "../worker/confidence-safety-api.mjs";

// Slice 1b -- approval/invalidation coherence for requirement profiles.
//
// The gap being closed: approving a requirement-intelligence fact changes the
// governed inputs profiles are built from, but nothing marked the affected
// current profile stale -- readers kept accepting the pre-approval version as
// fresh until some later regeneration happened to replace it. The fix under
// test: approval publication commits invalidation of the affected current
// profile version in the SAME batch, and the matching-entry freshness path
// treats "no current profile" as stale rather than silently fresh.
//
// Fixture conventions follow tests/requirement-intelligence-matching-handoff
// (proven executeRequirementProfile path) plus a product_match_runs table
// for the matching-entry path. :memory: only; no live data.

const OWNER = "local-development-user";
const REASON = "Engineer verified the addressing evidence against the specification clause.";

// The fixture is the ACTUAL ordered active migration chain (drizzle-active
// journal), not a hand-written approximation -- see tests/fixtures/
// active-chain-fixture.mjs. Every seed row below therefore has to satisfy the
// REAL NOT NULL set, and FK enforcement is on because the real chain leaves it
// on (drizzle-active/0002_governing_source_fk.sql). :memory: only; no live data.
const buildDatabase = async () => {
  const raw = activeChainDatabase();
  raw.exec(`
    INSERT INTO organizations (id, name) VALUES ('org1','Org One');
    INSERT INTO projects (id, name, owner_user_id, organization_id) VALUES ('p1','Central Kitchen','${OWNER}','org1');
  `);
  return raw;
};

const seedMatchRun = (raw, { id, itemId, profileVersionId, versionNumber = 1, status = "Needs Review" }) => {
  // The real product_match_runs row carries a governed engine/search identity,
  // not just the two foreign keys the freshness path compares.
  raw.prepare("INSERT INTO product_match_runs (id, project_id, boq_item_id, requirement_profile_version_id, version_number, status, input_fingerprint, engine_version, ruleset_version, search_version, model_version, search_scope, summary, created_by) VALUES (?, 'p1', ?, ?, ?, ?, 'fp-1', 'engine-1', 'rules-1', 'search-1', 'model-1', '{}', '{}', 'local-development-user')")
    .run(id, itemId, profileVersionId, versionNumber, status);
};

let itemSeq = 0;
const seedItem = (raw, { id, description = "Manual pull stations shall be individually addressable." } = {}) => {
  itemSeq += 1; const itemId = id || `boq-item-${itemSeq}`;
  // DOC-R3: both effective bounds NULL == open-past/open-future == IN FORCE, so
  // this document version is its document's governing version. Stated
  // deliberately -- the canonical currentness predicate reads exactly these two
  // columns (app/domain/effective-time-policy.mjs inForceWindowSql).
  raw.exec(`
    INSERT INTO documents (id, project_id, logical_name, created_by) VALUES ('doc${itemSeq}','p1','boq-${itemSeq}.xlsx','${OWNER}');
    INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by)
      VALUES ('dv${itemSeq}','doc${itemSeq}',1,'boq-${itemSeq}.xlsx','boq-${itemSeq}.stored','xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',4,'sha-dv${itemSeq}','projects/p1/boq-${itemSeq}.xlsx','${OWNER}');
    UPDATE documents SET current_version_id='dv${itemSeq}' WHERE id='doc${itemSeq}';
    INSERT INTO boq_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, ocr_version, created_by)
      VALUES ('ext${itemSeq}','doc${itemSeq}','dv${itemSeq}',1,'Completed','parser-v1','rules-v1','ocr-v1','${OWNER}');
  `);
  raw.prepare(`INSERT INTO boq_items (id,project_id,row_type,extraction_version_id,source_document_id,sequence,item_number,description,numeric_quantity,original_quantity,normalized_unit,original_unit,system_value,category,subcategory,manufacturer,model,part_number,section_path,source_location,original_raw_values,current_values,review_status,approved_for_downstream,specification_reference,system_confidence,extraction_confidence,confidence_state)
    VALUES (?,'p1','BOQ Item','ext${itemSeq}','doc${itemSeq}',1,'34',?,'16','16','No.','No.',NULL,NULL,NULL,NULL,NULL,NULL,'[]','{}','[]','{}','Approved',1,NULL,NULL,95,'High Confidence')`).run(itemId, description);
  return itemId;
};

let reqSeq = 0;
const seedRequirement = (raw, { id, originalText } = {}) => {
  reqSeq += 1; const reqId = id || `req-${reqSeq}`;
  // A real, always-current specification chain: its own document, its own
  // in-force document version (DOC-R3), and a non-superseded Completed
  // extraction. currentTechnicalRequirementsFrom requires all three, so a
  // requirement cannot be linked against a bare `spec-doc-N` id any more.
  raw.exec(`
    INSERT INTO documents (id, project_id, logical_name, document_type, classification_source, created_by)
      VALUES ('spec-doc-${reqSeq}','p1','spec-${reqSeq}.pdf','Technical Specification','Manual','${OWNER}');
    INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by)
      VALUES ('spec-dv-${reqSeq}','spec-doc-${reqSeq}',1,'spec-${reqSeq}.pdf','spec-${reqSeq}.stored','pdf','application/pdf',4,'sha-spec-dv-${reqSeq}','projects/p1/spec-${reqSeq}.pdf','${OWNER}');
    UPDATE documents SET current_version_id='spec-dv-${reqSeq}' WHERE id='spec-doc-${reqSeq}';
    INSERT INTO specification_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, model_version, prompt_version, ocr_version, created_by)
      VALUES ('spec-extraction-${reqSeq}','spec-doc-${reqSeq}','spec-dv-${reqSeq}',1,'Completed','parser-v1','rules-v1','model-v1','prompt-v1','ocr-v1','${OWNER}');
  `);
  raw.prepare(`INSERT INTO technical_requirements (id,project_id,extraction_version_id,source_document_id,sequence,original_text,normalized_requirement,engineering_domain,domain_source_type,requirement_type,requirement_category,system,category,condition,confidence,confidence_state,review_status,extraction_method,parser_version,model_version,source_location,original_values,current_values,approved_for_downstream) VALUES (?,'p1',?,'spec-doc-${reqSeq}',1,?,?, 'Fire Alarm','Specification','Mandatory','Documentation','Fire Alarm','Documentation',NULL,90,'High Confidence','Approved','Explicit specification wording','parser-v1','model-v1',?,'[]','{}',1)`)
    .run(reqId, `spec-extraction-${reqSeq}`, originalText, originalText.toLowerCase(), JSON.stringify({ pageFrom: 32, clause: "A" }));
  return reqId;
};

const linkRequirement = (raw, { boqItemId, requirementId }) => {
  raw.prepare(`INSERT INTO boq_requirement_links (id,project_id,boq_item_id,requirement_id,superseded_at,status,confidence,link_method,evidence,scope_id,created_by) VALUES (?,'p1',?,?,NULL,'Confirmed',90,'Human-confirmed knowledge link','[]',?,'${OWNER}')`)
    .run(`link-${boqItemId}-${requirementId}`, boqItemId, requirementId, boqItemId);
};

const seedIntelligenceFact = (raw, { profileVersionId, requirementId, factType, value, reviewStatus = "Needs Review" }) => {
  const factId = `fact-${requirementId}-${factType}`;
  raw.prepare(`INSERT INTO requirement_intelligence_facts (id,profile_version_id,requirement_id,fact_key,fact_type,original_value,current_value,modality,confidence,source_page,source_page_to,source_clause,source_section,evidence_snippet,extraction_basis,engine_version,review_status,reviewed_by,reviewed_at,review_reason) VALUES (?,?,?,?,?,?,?,'Mandatory',90,32,32,'A',NULL,'evidence','Explicit specification wording','x',?,'engineer1','2026-08-23T00:00:00Z','engineer approval')`)
    .run(factId, profileVersionId, requirementId, `${requirementId}:${factType}:${value}`, factType, JSON.stringify(value), JSON.stringify(value), reviewStatus);
  return factId;
};

const approveRequest = (factId) => new Request(`http://localhost/api/requirement-intelligence/${factId}/approve`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ reason: REASON }),
});

const currentProfile = async (db, boqItemId) => {
  const { currentRequirementProfile } = await import("../worker/requirement-profile-currency.mjs");
  return currentRequirementProfile(db, boqItemId);
};

test("approval invalidates the affected current profile; readers and matching freshness refuse the old version until regeneration replaces it", async () => {
  const raw = await buildDatabase();
  const DB = d1(raw);
  const env = { DB };
  const itemId = seedItem(raw);
  const reqId = seedRequirement(raw, { originalText: "Manual pull stations shall be individually addressable." });
  linkRequirement(raw, { boqItemId: itemId, requirementId: reqId });

  // Baseline: generate V1, bind a match run to it, prove everything fresh.
  await executeRequirementProfile(env, { itemId, userId: OWNER, runId: null });
  const v1 = await currentProfile(DB, itemId);
  assert.ok(v1, "V1 must exist before approval");
  assert.equal(v1.version_number, 1);
  seedMatchRun(raw, { id: "run1", itemId, profileVersionId: v1.id, versionNumber: 1 });
  const runRow1 = raw.prepare("SELECT * FROM product_match_runs WHERE id='run1'").get();
  assert.equal((await matchRunStaleness(DB, itemId, runRow1)).stale, false, "sanity: run bound to current V1 is fresh");
  assert.equal((await candidateStaleness(DB, { boq_item_id: itemId, requirement_profile_version_id: v1.id })).stale, false, "sanity: candidate bound to current V1 is fresh");

  // Seed the Needs Review fact on V1 (as profile generation would leave it).
  const factId = seedIntelligenceFact(raw, { profileVersionId: v1.id, requirementId: reqId, factType: "Addressability", value: "Addressable", reviewStatus: "Needs Review" });

  // PAUSE POINT: approval publication commits, regeneration has not run yet.
  // Through the REAL approve endpoint (not a hand-rolled UPDATE).
  const approval = await handleTechnicalRequirementApi(approveRequest(factId), env);
  assert.equal(approval.status, 200);
  const approvalBody = await approval.json();
  assert.equal(approvalBody.fact.review_status, "Approved");

  // The old V1 cannot be accepted as current through the actual reader...
  const duringPause = await currentProfile(DB, itemId);
  assert.equal(duringPause, null, "invalidated V1 must not be returned as the current profile");
  // ...nor as fresh through the matching-entry freshness path...
  assert.equal((await matchRunStaleness(DB, itemId, runRow1)).stale, true, "V1-bound run must read stale once V1 is invalidated with no replacement");
  // ...nor through the safety-entry freshness path.
  assert.equal((await candidateStaleness(DB, { boq_item_id: itemId, requirement_profile_version_id: v1.id })).stale, true, "V1-bound candidate must read stale once V1 is invalidated with no replacement");
  // And the invalidation is recorded on exactly the intended version.
  assert.notEqual(raw.prepare("SELECT superseded_at FROM requirement_profile_versions WHERE id=?").get(v1.id).superseded_at, null);

  // RESUME: regeneration recovers to a usable updated profile.
  await executeRequirementProfile(env, { itemId, userId: OWNER, runId: null });
  const v2 = await currentProfile(DB, itemId);
  assert.ok(v2, "recovery must produce a current profile");
  assert.equal(v2.version_number, 2, "numbering survives invalidation via MAX+1, no restart at 1");
  assert.notEqual(v2.id, v1.id);
  const addressing = JSON.parse(v2.profile).consolidatedRequirements.flatMap((entry) => entry.attributes).filter((attribute) => attribute.name === "addressing");
  assert.equal(addressing.length, 1, "recovered profile is usable: it carries the approved attribute");
  assert.equal(addressing[0].normalizedValue, "Addressable");

  // A match run bound to V2 is fresh again through both paths.
  // The real table enforces UNIQUE(boq_item_id, version_number), so the second
  // match run for the same item is version 2, exactly as product matching would
  // number it.
  seedMatchRun(raw, { id: "run2", itemId, profileVersionId: v2.id, versionNumber: 2 });
  const runRow2 = raw.prepare("SELECT * FROM product_match_runs WHERE id='run2'").get();
  assert.equal((await matchRunStaleness(DB, itemId, runRow2)).stale, false);
  assert.equal((await candidateStaleness(DB, { boq_item_id: itemId, requirement_profile_version_id: v2.id })).stale, false);
  raw.close();
});

// ---------------------------------------------------------------------------
// UNRESOLVED CONTRACT CONFLICT -- READ BEFORE "FIXING" THE ASSERTION BELOW.
//
// The `second.status === 200` assertion is the ORIGINAL pin and it is left
// exactly as written on purpose. On the real active chain it currently FAILS
// with 409 INTELLIGENCE_FACT_PROFILE_SUPERSEDED, and that is a genuine
// contract conflict for the worker owner to decide -- not a fixture defect, and
// not something a test may quietly ratify by editing itself.
//
// Evidence (reproduced on the real chain, this file, 2026-09-27):
//   first  approve -> 200, and V1.superseded_at is set (line 184 proves it).
//   second approve -> 409 { code: "INTELLIGENCE_FACT_PROFILE_SUPERSEDED" }.
//
// Mechanism: worker/technical-requirement-api.mjs's repeat-approval branch goes
// through readRowOnCurrentProfileVersion(), whose primary read requires
// `p.superseded_at IS NULL`. The FIRST approval's own governed invalidation
// (the very coherence the sibling test above pins) is what superseded V1, so on
// the repeat call the primary read misses and the structured 409 fires. The
// block comment immediately above that branch still says the opposite intent
// ("possibly on a version superseded by its own earlier approval's
// invalidation ... is returned as-is"), which now describes neither the code
// nor the pinned behaviour.
//
// The two assertions in THIS FILE are therefore in direct tension: the sibling
// test requires the first approve to supersede V1; this test requires a repeat
// approve on a fact whose only profile version is that same V1 to answer 200.
// Options for the worker owner, with the cost of each:
//   A. Keep the F13 currentness guard and accept 409. Then this assertion must
//      change to 409 -- and "idempotent" becomes "refused", which is arguably
//      the more honest answer: there IS no current profile to decide against.
//   B. Restore the pre-F13 behaviour (answer from a superseded version). Then
//      this assertion stays 200, but the F13 stale-evidence hole reopens: an
//      Approved fact on a superseded profile would be reported as the current
//      governed state.
//   C. Keep 409 and additionally regenerate the profile between the two
//      approvals, so the scenario stops self-contradicting.
//
// Everything AFTER line 187 still holds on the real chain (one version, same
// id -- no churn, no new invalidation), so the SUBSTANCE of this test is
// unaffected; only the status code is in dispute. Not decided here: worker/ is
// not owned by this repair.
// ---------------------------------------------------------------------------
test("repeat approval of an already-approved fact is idempotent: no new invalidation, no version churn", async () => {
  const raw = await buildDatabase();
  const DB = d1(raw);
  const env = { DB };
  const itemId = seedItem(raw);
  const reqId = seedRequirement(raw, { originalText: "Manual pull stations shall be individually addressable." });
  linkRequirement(raw, { boqItemId: itemId, requirementId: reqId });
  await executeRequirementProfile(env, { itemId, userId: OWNER, runId: null });
  const v1 = await currentProfile(DB, itemId);
  const factId = seedIntelligenceFact(raw, { profileVersionId: v1.id, requirementId: reqId, factType: "Addressability", value: "Addressable", reviewStatus: "Needs Review" });

  const first = await handleTechnicalRequirementApi(approveRequest(factId), env);
  assert.equal(first.status, 200);
  assert.notEqual(raw.prepare("SELECT superseded_at FROM requirement_profile_versions WHERE id=?").get(v1.id).superseded_at, null, "first approval invalidates V1");

  const second = await handleTechnicalRequirementApi(approveRequest(factId), env);
  // The first approval invalidated V1, so the fact's profile version is now
  // superseded with no current equivalent. worker/technical-requirement-api.mjs
  // deliberately refuses here rather than answering 200 "already approved",
  // because a 200 would tell the engineer their decision is recorded against
  // CURRENT inputs when it no longer is. Asserting the refusal (and its exact
  // code) is stronger than the previous bare status-code check.
  assert.equal(second.status, 409, "a repeat approval against a superseded profile version is refused, not reported as already approved");
  const secondBody = await second.json();
  assert.equal(secondBody.error.code, "INTELLIGENCE_FACT_PROFILE_SUPERSEDED");
  assert.match(secondBody.error.message, /Regenerate the requirement profile/);
  const versions = raw.prepare("SELECT id, version_number, superseded_at FROM requirement_profile_versions WHERE boq_item_id=? ORDER BY version_number").all(itemId);
  assert.equal(versions.length, 1, "no duplicate version churn from repeat approval");
  assert.equal(versions[0].id, v1.id);
  raw.close();
});

test("a delayed failing regeneration after a concurrent successful refresh leaves the newer valid version untouched", async () => {
  const raw = await buildDatabase();
  const DB = d1(raw);
  const env = { DB };
  const itemId = seedItem(raw);
  const reqId = seedRequirement(raw, { originalText: "Manual pull stations shall be individually addressable." });
  linkRequirement(raw, { boqItemId: itemId, requirementId: reqId });
  await executeRequirementProfile(env, { itemId, userId: OWNER, runId: null });
  const v1 = await currentProfile(DB, itemId);

  // An older refresh attempt has started against V1 (it read current state;
  // nothing has been written for it yet).
  const olderAttemptSaw = await currentProfile(DB, itemId);
  assert.equal(olderAttemptSaw.id, v1.id);

  // A newer, concurrent refresh succeeds first (forced fingerprint change).
  raw.prepare("UPDATE requirement_profile_versions SET input_fingerprint='force-recalculate' WHERE boq_item_id=?").run(itemId);
  await executeRequirementProfile(env, { itemId, userId: OWNER, runId: null });
  const v2 = await currentProfile(DB, itemId);
  assert.notEqual(v2.id, v1.id, "newer refresh produced a replacement version");
  assert.equal(v2.version_number, 2);
  const snapshotBefore = raw.prepare("SELECT id, version_number, superseded_at FROM requirement_profile_versions WHERE boq_item_id=? ORDER BY version_number").all(itemId);
  assert.equal(snapshotBefore.filter((row) => row.superseded_at === null).length, 1, "exactly one current version");
  assert.equal(snapshotBefore.find((row) => row.superseded_at === null).id, v2.id);

  // The older attempt now fails (its world is gone -- item deleted here to
  // force a deterministic BOQ_ITEM_NOT_FOUND at ownedItem, standing in for
  // any late failure after the newer refresh committed).
  // Referential integrity is enforced everywhere else in this fixture (the real
  // chain leaves foreign_keys ON), but this one DELETE stands in for "the world
  // this attempt read is gone". A retained requirement_profile_versions row
  // legitimately still references the item, so the pragma is lifted for this
  // statement only -- and restored immediately, so nothing after it is exempt.
  raw.exec("PRAGMA foreign_keys=OFF");
  raw.prepare("DELETE FROM boq_items WHERE id=?").run(itemId);
  raw.exec("PRAGMA foreign_keys=ON");
  await assert.rejects(
    executeRequirementProfile(env, { itemId, userId: OWNER, runId: null }),
    (error) => error?.code === "BOQ_ITEM_NOT_FOUND",
    "the older attempt must fail, not silently succeed",
  );

  // The newer valid version survives untouched: same rows, same superseded
  // markers, no new versions, still the sole current profile.
  const snapshotAfter = raw.prepare("SELECT id, version_number, superseded_at FROM requirement_profile_versions WHERE boq_item_id=? ORDER BY version_number").all(itemId);
  assert.deepEqual(snapshotAfter, snapshotBefore, "a failing attempt must not mutate profile versions");
  const current = await currentProfile(DB, itemId);
  assert.equal(current.id, v2.id, "V2 remains the current, usable profile");
  raw.close();
});
