/**
 * MVP-CLOSE-4 — authorized-retry-aware Understanding currentness.
 *
 * THE DEFECT THIS FILE PINS
 * -------------------------
 * executeRun (worker/estimator-understanding-api.mjs) persists, for an
 * authorized retry (run_mode PER_ITEM_RETRY / CONTROLLED_RETRY), a config
 * fingerprint of the form
 *
 *     sha256(stableStringify({ baseConfigFingerprint, authorizationFingerprint }))
 *
 * instead of the plain interpretationConfigFingerprint(metadata). A retry's
 * stored value therefore can NEVER equal the plain current config fingerprint
 * -- even when the retry's underlying base configuration genuinely IS current.
 *
 * worker/estimator-understanding-api.mjs already handles that for pilot
 * coverage (alreadyInterpretedItemIds), and its own comment names the exact
 * gap: "a successful retry kept looking permanently stale". The review-layer
 * readers were never given the same treatment and compared by exact equality
 * only, so an authorized retry of the CURRENT config was reported FAILED while
 * the profile engine simultaneously consumed that same retry's facts.
 *
 * These tests build the mixed fingerprint from the raw sha256+stableStringify
 * primitive -- deliberately NOT from the helper under test -- so the real
 * on-disk format is pinned independently of the implementation.
 *
 * Fixture: tests/fixtures/active-chain-fixture.mjs applies the REAL ordered
 * drizzle-active migration chain, so every seed row satisfies the real NOT
 * NULL / FOREIGN KEY / TRIGGER constraints. :memory: only; no live data.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import { sanitizePersistedAiInterpretation } from "../app/domain/estimator-understanding-review.mjs";
import { loadPilotManifest } from "../worker/estimator-understanding-api.mjs";
import {
  loadUnderstandingReviewRows,
  safeUnderstandingReviewItem,
  currentApprovedUnderstandingFacts,
  currentUnderstandingAttempt,
  applyUnderstandingSystemFieldAutoApproval,
} from "../worker/estimator-understanding-review-api.mjs";
// Namespace import on purpose: a missing helper must fail the helper tests with
// a real assertion, never abort module load and hide the behavioural red state.
import * as engine from "../app/domain/boq-understanding-engine.mjs";

const {
  prepareBoqUnderstandingInput,
  interpretationInputFingerprint,
  interpretationConfigFingerprint,
  stableStringify,
  validateAndMergeBoqInterpretation,
} = engine;
const authorizationScopedConfigFingerprint = (...args) => engine.authorizationScopedConfigFingerprint(...args);
const interpretationConfigFingerprintIsCurrent = (...args) => engine.interpretationConfigFingerprintIsCurrent(...args);

const PROJECT_ID = "p-retry-currency";
const ORG = "o-retry-currency";
const METADATA = { provider: "cloudflare-workers-ai-binding", model: "@cf/meta/llama-3.1-8b-instruct-fast", modelVersion: "@cf/meta/llama-3.1-8b-instruct-fast" };
const CURRENT_CONFIG = interpretationConfigFingerprint(METADATA);
const OBSOLETE_CONFIG = interpretationConfigFingerprint({ ...METADATA, model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" });

// The raw on-disk construction, built WITHOUT the helper under test.
const rawMix = (baseConfigFingerprint, authorizationFingerprint) =>
  createHash("sha256").update(stableStringify({ baseConfigFingerprint, authorizationFingerprint })).digest("hex");

const auth = (seed) => createHash("sha256").update(`retry-authorization:${seed}`).digest("hex");

const seed = () => {
  const database = activeChainDatabase();
  const db = d1(database);
  database.exec(`
    INSERT INTO organizations (id,name) VALUES ('${ORG}','Retry Currency Org');
    INSERT INTO projects (id,name,owner_user_id,organization_id) VALUES ('${PROJECT_ID}','Retry Currency Project','owner1','${ORG}');
    INSERT INTO documents (id,project_id,logical_name,created_by) VALUES ('doc1','${PROJECT_ID}','boq.xlsx','owner1');
    INSERT INTO document_versions (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by)
      VALUES ('dv1','doc1',1,'boq.xlsx','boq.stored','xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',4,'sha-dv1','k','owner1');
    UPDATE documents SET current_version_id='dv1' WHERE id='doc1';
    INSERT INTO boq_extraction_versions (id,document_id,document_version_id,version_number,status,parser_version,ruleset_version,ocr_version,created_by)
      VALUES ('ext1','doc1','dv1',1,'Completed','pv','rv','ov','owner1');
    INSERT INTO specification_extraction_versions (id,document_id,document_version_id,version_number,status,parser_version,ruleset_version,model_version,prompt_version,ocr_version,created_by)
      VALUES ('spec-ext1','doc1','dv1',1,'Completed','pv','rv','mv','pv','ov','owner1');
  `);
  return { database, db };
};

let sequence = 0;
const seedItem = (database, { id, description, system = "Fire Alarm" }) => database.prepare(`
  INSERT INTO boq_items (id,project_id,row_type,extraction_version_id,source_document_id,sequence,item_number,description,numeric_quantity,original_quantity,normalized_unit,original_unit,system_value,category,subcategory,manufacturer,model,part_number,section_path,current_values,source_location,original_raw_values,review_status,approved_for_downstream,specification_reference,system_confidence,extraction_confidence,confidence_state)
  VALUES (?,'${PROJECT_ID}','BOQ Item','ext1','doc1',?,'1',?,'1','1','Each','Each',?,NULL,NULL,NULL,NULL,NULL,'[]','{}','{"sheet":"BOQ"}','[]','Approved',1,NULL,95,60,'High Confidence')
`).run(id, sequence += 1, description, system);

const mergedFor = (id, description, system, cls, confirmedSpecification = []) => {
  const input = prepareBoqUnderstandingInput({
    id, rowType: "BOQ Item", description, numericQuantity: "1", originalQuantity: "1",
    normalizedUnit: "Each", originalUnit: "Each", system, category: null, subcategory: null,
    manufacturer: null, model: null, partNumber: null, currentValues: {}, sourceLocation: { sheet: "BOQ" },
  }, confirmedSpecification);
  const response = {
    normalizedDescription: { value: description, origin: "EXTRACTED", confidence: 100 },
    system: { value: "Fire Alarm", origin: "EXTRACTED", confidence: 95 },
    category: { value: cls.category, origin: "INFERRED", confidence: 70 },
    equipmentType: { value: cls.equipmentType, origin: "INFERRED", confidence: 70 },
    productFamily: { value: cls.productFamily, origin: "INFERRED", confidence: 70 },
    technicalAttributes: [], standards: [], manufacturerEvidence: [], compatibilityRequirements: [],
    requiredAccessories: [], searchTerms: [], missingInformation: [], ambiguities: [], confidence: "LOW",
  };
  const merged = validateAndMergeBoqInterpretation(input, response);
  return { inputFingerprint: interpretationInputFingerprint(input), merged };
};

const seedRun = (database, { id, mode = "CONTROLLED_PILOT", configFingerprint = CURRENT_CONFIG, authorizationFingerprint = null, parentRunId = null }) =>
  database.prepare(`INSERT INTO estimator_understanding_runs (id,project_id,organization_id,provider,model,model_version,prompt_version,schema_version,config_fingerprint,status,requested_by,started_at,run_mode,parent_run_id,authorization_fingerprint)
    VALUES (?,?,?,?,?,?,'pv','sv',?,'COMPLETED','owner1',CURRENT_TIMESTAMP,?,?,?)`).run(
    id, PROJECT_ID, ORG, METADATA.provider, METADATA.model, METADATA.modelVersion, configFingerprint, mode, parentRunId, authorizationFingerprint);

const seedInterp = (database, { id, itemId, runId, version, inputFingerprint, configFingerprint, status, interpretation = null, errorCode = null }) =>
  database.prepare(`INSERT INTO estimator_item_interpretations (id,boq_item_id,run_id,project_id,version_number,input_fingerprint,config_fingerprint,provider,model,model_version,prompt_version,schema_version,status,validated_interpretation,error_code,raw_response,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,'pv','sv',?,?,?,NULL,'owner1',CURRENT_TIMESTAMP)`).run(
    id, itemId, runId, PROJECT_ID, version, inputFingerprint, configFingerprint,
    METADATA.provider, METADATA.model, METADATA.modelVersion, status, interpretation ? JSON.stringify(interpretation) : null, errorCode);

const DUCT = { category: "Detection Devices", productFamily: "Duct Detector", equipmentType: "Duct Detector" };
const read = async (db, id, options) => (await loadUnderstandingReviewRows(db, PROJECT_ID, options)).find((r) => r.boqItemId === id);
const readItem = async (db, id, options) => safeUnderstandingReviewItem(await read(db, id, options));

// ─────────────────────────────────────────────────────────────────────────────
// Helper-level: the shared predicate must be pinned to the real on-disk format
// and must fail closed.
// ─────────────────────────────────────────────────────────────────────────────

test("authorizationScopedConfigFingerprint reproduces the real on-disk retry construction exactly", () => {
  const a = auth("a");
  assert.equal(authorizationScopedConfigFingerprint(CURRENT_CONFIG, a), rawMix(CURRENT_CONFIG, a),
    "the helper must construct byte-identical values to sha256(stableStringify({baseConfigFingerprint, authorizationFingerprint}))");
  assert.notEqual(authorizationScopedConfigFingerprint(CURRENT_CONFIG, a), CURRENT_CONFIG,
    "an authorization-scoped value must never collide with the plain base fingerprint");
  assert.notEqual(authorizationScopedConfigFingerprint(CURRENT_CONFIG, a), authorizationScopedConfigFingerprint(CURRENT_CONFIG, auth("b")),
    "different authorizations must produce different identities");
});

test("interpretationConfigFingerprintIsCurrent: plain match, exact reconstruction, and fail-closed everything else", () => {
  const a = auth("a");
  assert.equal(interpretationConfigFingerprintIsCurrent(CURRENT_CONFIG, CURRENT_CONFIG, null), true, "a plain current-config interpretation stays current");
  assert.equal(interpretationConfigFingerprintIsCurrent(CURRENT_CONFIG, CURRENT_CONFIG, a), true, "a plain match does not need retry metadata");
  assert.equal(interpretationConfigFingerprintIsCurrent(rawMix(CURRENT_CONFIG, a), CURRENT_CONFIG, a), true, "a correctly reconstructed authorized retry IS current");
  assert.equal(interpretationConfigFingerprintIsCurrent(rawMix(CURRENT_CONFIG, a), CURRENT_CONFIG, auth("b")), false, "wrong authorization metadata fails closed");
  assert.equal(interpretationConfigFingerprintIsCurrent(rawMix(CURRENT_CONFIG, a), CURRENT_CONFIG, null), false, "a retry marker alone is not enough");
  assert.equal(interpretationConfigFingerprintIsCurrent(rawMix(CURRENT_CONFIG, a), CURRENT_CONFIG, ""), false, "an empty authorization value is not enough");
  assert.equal(interpretationConfigFingerprintIsCurrent(rawMix(CURRENT_CONFIG, a), null, a), false, "with no config context nothing is asserted");
  assert.equal(interpretationConfigFingerprintIsCurrent(CURRENT_CONFIG, OBSOLETE_CONFIG, null), false, "a genuinely obsolete base config stays stale");
  assert.equal(interpretationConfigFingerprintIsCurrent(rawMix(OBSOLETE_CONFIG, a), CURRENT_CONFIG, a), false,
    "an otherwise well-formed retry produced under an OBSOLETE base config must stay stale");
});

// ─────────────────────────────────────────────────────────────────────────────
// Behavioural: both supported retry modes, through the real readers.
// ─────────────────────────────────────────────────────────────────────────────

for (const mode of ["PER_ITEM_RETRY", "CONTROLLED_RETRY"]) {
  test(`[${mode}] a FAILED current-config attempt followed by a valid authorized retry of the CURRENT config is current`, async () => {
    const { database, db } = seed();
    const id = `boq-${mode}`;
    seedItem(database, { id, description: "Duct detector" });
    const { inputFingerprint, merged } = mergedFor(id, "Duct detector", "Fire Alarm", DUCT);
    const a = auth(mode);
    seedRun(database, { id: "run-pilot", configFingerprint: CURRENT_CONFIG });
    seedInterp(database, { id: "interp-2", itemId: id, runId: "run-pilot", version: 2, inputFingerprint, configFingerprint: CURRENT_CONFIG, status: "FAILED", errorCode: "AI_PROVIDER_ERROR" });
    seedRun(database, { id: "run-retry", mode, configFingerprint: rawMix(CURRENT_CONFIG, a), authorizationFingerprint: a, parentRunId: "run-pilot" });
    seedInterp(database, { id: "interp-3", itemId: id, runId: "run-retry", version: 3, inputFingerprint, configFingerprint: rawMix(CURRENT_CONFIG, a), status: merged.status, interpretation: merged.interpretation });

    const item = await readItem(db, id, { currentConfigFingerprint: CURRENT_CONFIG });
    assert.equal(item.review.status, "AWAITING_REVIEW", `an authorized ${mode} of the current config must not be reported FAILED`);
    assert.equal(item.aiProposal.productFamily.value, "Duct Detector");
    const row = await read(db, id, { currentConfigFingerprint: CURRENT_CONFIG });
    assert.equal(row.interpretationId, "interp-3", "the retry must be the selected interpretation");
    const attempt = await currentUnderstandingAttempt(db, PROJECT_ID, id, { currentConfigFingerprint: CURRENT_CONFIG });
    assert.equal(attempt.available, true, "effective selection and currentUnderstandingAttempt must agree");
    assert.equal(attempt.latestAttemptStatus, merged.status);
  });
}

test("a plain current-config interpretation stays current (no retry metadata at all)", async () => {
  const { database, db } = seed();
  const id = "boq-plain";
  seedItem(database, { id, description: "Duct detector" });
  const { inputFingerprint, merged } = mergedFor(id, "Duct detector", "Fire Alarm", DUCT);
  seedRun(database, { id: "run-plain", configFingerprint: CURRENT_CONFIG });
  seedInterp(database, { id: "interp-p", itemId: id, runId: "run-plain", version: 1, inputFingerprint, configFingerprint: CURRENT_CONFIG, status: merged.status, interpretation: merged.interpretation });

  for (const options of [undefined, { currentConfigFingerprint: CURRENT_CONFIG }]) {
    const item = await readItem(db, id, options);
    assert.equal(item.review.status, "AWAITING_REVIEW");
    assert.equal(item.aiProposal.productFamily.value, "Duct Detector");
  }
  const attempt = await currentUnderstandingAttempt(db, PROJECT_ID, id, { currentConfigFingerprint: CURRENT_CONFIG });
  assert.equal(attempt.available, true);
});

test("wrong authorization metadata on the retry run fails closed (stays stale)", async () => {
  const { database, db } = seed();
  const id = "boq-wrong-auth";
  seedItem(database, { id, description: "Duct detector" });
  const { inputFingerprint, merged } = mergedFor(id, "Duct detector", "Fire Alarm", DUCT);
  const stored = rawMix(CURRENT_CONFIG, auth("real"));
  seedRun(database, { id: "run-pilot", configFingerprint: CURRENT_CONFIG });
  seedInterp(database, { id: "interp-2", itemId: id, runId: "run-pilot", version: 2, inputFingerprint, configFingerprint: CURRENT_CONFIG, status: "FAILED", errorCode: "AI_PROVIDER_ERROR" });
  // the run persists a DIFFERENT authorization than the one its own stored fingerprint was built from
  seedRun(database, { id: "run-retry", mode: "PER_ITEM_RETRY", configFingerprint: stored, authorizationFingerprint: auth("forged"), parentRunId: "run-pilot" });
  seedInterp(database, { id: "interp-3", itemId: id, runId: "run-retry", version: 3, inputFingerprint, configFingerprint: stored, status: merged.status, interpretation: merged.interpretation });

  const item = await readItem(db, id, { currentConfigFingerprint: CURRENT_CONFIG });
  assert.equal(item.review.status, "FAILED", "a retry whose authorization does not reconstruct must not become current");
  const attempt = await currentUnderstandingAttempt(db, PROJECT_ID, id, { currentConfigFingerprint: CURRENT_CONFIG });
  assert.equal(attempt.available, false);
});

test("authorization metadata belonging to a different run/interpretation is not accepted", async () => {
  const { database, db } = seed();
  const id = "boq-wrong-run";
  seedItem(database, { id, description: "Duct detector" });
  const { inputFingerprint, merged } = mergedFor(id, "Duct detector", "Fire Alarm", DUCT);
  const otherAuth = auth("other-item");
  seedRun(database, { id: "run-pilot", configFingerprint: CURRENT_CONFIG });
  seedInterp(database, { id: "interp-2", itemId: id, runId: "run-pilot", version: 2, inputFingerprint, configFingerprint: CURRENT_CONFIG, status: "FAILED", errorCode: "AI_PROVIDER_ERROR" });
  // interpretation's stored fingerprint was built with ANOTHER run's authorization,
  // while the run it actually belongs to persists a different one
  seedRun(database, { id: "run-retry", mode: "PER_ITEM_RETRY", configFingerprint: rawMix(CURRENT_CONFIG, auth("this-item")), authorizationFingerprint: auth("this-item"), parentRunId: "run-pilot" });
  seedInterp(database, { id: "interp-3", itemId: id, runId: "run-retry", version: 3, inputFingerprint, configFingerprint: rawMix(CURRENT_CONFIG, otherAuth), status: merged.status, interpretation: merged.interpretation });

  const item = await readItem(db, id, { currentConfigFingerprint: CURRENT_CONFIG });
  assert.equal(item.review.status, "FAILED", "authorization metadata must be read from the run that actually produced THIS interpretation");
});

test("a retry produced under a genuinely obsolete base configuration stays stale even when well-formed", async () => {
  const { database, db } = seed();
  const id = "boq-obsolete";
  seedItem(database, { id, description: "Duct detector" });
  const { inputFingerprint, merged } = mergedFor(id, "Duct detector", "Fire Alarm", DUCT);
  const a = auth("obsolete");
  seedRun(database, { id: "run-pilot", configFingerprint: CURRENT_CONFIG });
  seedInterp(database, { id: "interp-2", itemId: id, runId: "run-pilot", version: 2, inputFingerprint, configFingerprint: CURRENT_CONFIG, status: "FAILED", errorCode: "AI_PROVIDER_ERROR" });
  // base config used by the retry is genuinely different from the current one
  seedRun(database, { id: "run-retry", mode: "PER_ITEM_RETRY", configFingerprint: rawMix(OBSOLETE_CONFIG, a), authorizationFingerprint: a, parentRunId: "run-pilot" });
  seedInterp(database, { id: "interp-3", itemId: id, runId: "run-retry", version: 3, inputFingerprint, configFingerprint: rawMix(OBSOLETE_CONFIG, a), status: merged.status, interpretation: merged.interpretation });

  const item = await readItem(db, id, { currentConfigFingerprint: CURRENT_CONFIG });
  assert.equal(item.review.status, "FAILED", "a real configuration change must keep invalidating -- this is the entire point of the fingerprint");
  const attempt = await currentUnderstandingAttempt(db, PROJECT_ID, id, { currentConfigFingerprint: CURRENT_CONFIG });
  assert.equal(attempt.available, false);
});

test("a changed input fingerprint invalidates the prior retry authority and its field facts", async () => {
  const { database, db } = seed();
  const id = "boq-input-change";
  seedItem(database, { id, description: "Duct detector" });
  const { inputFingerprint, merged } = mergedFor(id, "Duct detector", "Fire Alarm", DUCT);
  const a = auth("input-change");
  seedRun(database, { id: "run-pilot", configFingerprint: CURRENT_CONFIG });
  seedInterp(database, { id: "interp-2", itemId: id, runId: "run-pilot", version: 2, inputFingerprint, configFingerprint: CURRENT_CONFIG, status: "FAILED", errorCode: "AI_PROVIDER_ERROR" });
  seedRun(database, { id: "run-retry", mode: "PER_ITEM_RETRY", configFingerprint: rawMix(CURRENT_CONFIG, a), authorizationFingerprint: a, parentRunId: "run-pilot" });
  seedInterp(database, { id: "interp-3", itemId: id, runId: "run-retry", version: 3, inputFingerprint, configFingerprint: rawMix(CURRENT_CONFIG, a), status: merged.status, interpretation: merged.interpretation });

  // field auto-approval binds to the retry while the evidence is still current
  const applied = await applyUnderstandingSystemFieldAutoApproval(db, PROJECT_ID, id, CURRENT_CONFIG);
  assert.equal(applied.applied, true, "the deterministic classifier reproduces this classification");
  const factsBefore = await currentApprovedUnderstandingFacts(db, PROJECT_ID, id, { currentConfigFingerprint: CURRENT_CONFIG });
  assert.equal(factsBefore.productFamily.value, "Duct Detector");

  // now new CONFIRMED specification evidence changes the item's current input
  database.prepare(`INSERT INTO technical_requirements (id,extraction_version_id,project_id,source_document_id,sequence,original_text,normalized_requirement,engineering_domain,domain_source_type,requirement_type,requirement_category,confidence,confidence_state,review_status,extraction_method,parser_version,model_version,source_location,original_values,current_values,approved_for_downstream)
    VALUES ('req-x','spec-ext1','${PROJECT_ID}','doc1',1,'duct detectors','duct detectors shall be individually addressable','Fire Alarm','Specification','Mandatory','Documentation',90,'High Confidence','Approved','Explicit specification wording','pv','mv','{"page":30,"clause":"A"}','[]','{}',1)`).run();
  database.prepare(`INSERT INTO boq_requirement_links (id,project_id,boq_item_id,requirement_id,link_method,confidence,evidence,status,scope_id,created_by)
    VALUES ('link-x','${PROJECT_ID}','${id}','req-x','Human-confirmed knowledge link',90,'[]','Confirmed','${id}','owner1')`).run();

  const item = await readItem(db, id, { currentConfigFingerprint: CURRENT_CONFIG });
  assert.equal(item.review.status, "NOT_ANALYZED", "an evidence change must not be masked by retry currency");
  const factsAfter = await currentApprovedUnderstandingFacts(db, PROJECT_ID, id, { currentConfigFingerprint: CURRENT_CONFIG });
  assert.equal(factsAfter, null, "field authority must stay bound to the CURRENT input fingerprint");
  const attempt = await currentUnderstandingAttempt(db, PROJECT_ID, id, { currentConfigFingerprint: CURRENT_CONFIG });
  assert.equal(attempt.available, false);
});

test("whole-blob approval precedence is unchanged and restricted field authority still binds", async () => {
  const { database, db } = seed();
  // (1) whole-blob APPROVED wins over field-level facts
  const approved = "boq-whole-blob";
  seedItem(database, { id: approved, description: "Duct detector" });
  const whole = mergedFor(approved, "Duct detector", "Fire Alarm", DUCT);
  const a = auth("whole-blob");
  seedRun(database, { id: "run-wb-pilot", configFingerprint: CURRENT_CONFIG });
  seedInterp(database, { id: "interp-wb-2", itemId: approved, runId: "run-wb-pilot", version: 2, inputFingerprint: whole.inputFingerprint, configFingerprint: CURRENT_CONFIG, status: "FAILED", errorCode: "AI_PROVIDER_ERROR" });
  seedRun(database, { id: "run-wb-retry", mode: "PER_ITEM_RETRY", configFingerprint: rawMix(CURRENT_CONFIG, a), authorizationFingerprint: a, parentRunId: "run-wb-pilot" });
  seedInterp(database, { id: "interp-wb-3", itemId: approved, runId: "run-wb-retry", version: 3, inputFingerprint: whole.inputFingerprint, configFingerprint: rawMix(CURRENT_CONFIG, a), status: whole.merged.status, interpretation: whole.merged.interpretation });
  // The real approval path persists the SANITIZED canonical interpretation
  // (mutateUnderstandingReview -> sanitizeReviewedInterpretation over a payload
  // that never carries the server-owned boqItemId). Seeding the raw merged
  // payload would be rejected by that same contract and prove nothing.
  const canonical = sanitizePersistedAiInterpretation(whole.merged.interpretation);
  assert.ok(canonical, "the canonical payload must survive the real sanitizing contract");
  database.prepare(`INSERT INTO estimator_understanding_review_versions (id,project_id,boq_item_id,interpretation_id,source_input_fingerprint,source_document_version_id,source_extraction_version,version_number,review_status,canonical_interpretation,reviewed_by,review_reason,created_at)
    VALUES ('rv-wb','${PROJECT_ID}','${approved}','interp-wb-3',?,'dv1',1,1,'APPROVED',?,'owner1','approved',CURRENT_TIMESTAMP)`).run(whole.inputFingerprint, JSON.stringify(canonical));

  const approvedItem = await readItem(db, approved, { currentConfigFingerprint: CURRENT_CONFIG });
  assert.equal(approvedItem.review.status, "APPROVED", "a whole-blob approval bound to the retry must be APPROVED, not FAILED");
  const approvedFacts = await currentApprovedUnderstandingFacts(db, PROJECT_ID, approved, { currentConfigFingerprint: CURRENT_CONFIG });
  assert.equal(approvedFacts.productFamily.value, "Duct Detector");
  const approvedAttempt = await currentUnderstandingAttempt(db, PROJECT_ID, approved, { currentConfigFingerprint: CURRENT_CONFIG });
  assert.equal(approvedAttempt.available, true);

  // (2) restricted field authority: only system/category/productFamily are confirmable
  const fieldOnly = "boq-field-only";
  seedItem(database, { id: fieldOnly, description: "Duct detector" });
  const field = mergedFor(fieldOnly, "Duct detector", "Fire Alarm", DUCT);
  const b = auth("field-only");
  seedRun(database, { id: "run-fo-pilot", configFingerprint: CURRENT_CONFIG });
  seedInterp(database, { id: "interp-fo-2", itemId: fieldOnly, runId: "run-fo-pilot", version: 2, inputFingerprint: field.inputFingerprint, configFingerprint: CURRENT_CONFIG, status: "FAILED", errorCode: "AI_PROVIDER_ERROR" });
  seedRun(database, { id: "run-fo-retry", mode: "PER_ITEM_RETRY", configFingerprint: rawMix(CURRENT_CONFIG, b), authorizationFingerprint: b, parentRunId: "run-fo-pilot" });
  seedInterp(database, { id: "interp-fo-3", itemId: fieldOnly, runId: "run-fo-retry", version: 3, inputFingerprint: field.inputFingerprint, configFingerprint: rawMix(CURRENT_CONFIG, b), status: field.merged.status, interpretation: field.merged.interpretation });
  const applied = await applyUnderstandingSystemFieldAutoApproval(db, PROJECT_ID, fieldOnly, CURRENT_CONFIG);
  assert.equal(applied.applied, true);
  const stored = database.prepare(`SELECT field_key FROM estimator_understanding_field_reviews WHERE boq_item_id='${fieldOnly}' ORDER BY field_key`).all().map((r) => r.field_key);
  assert.deepEqual(stored, ["category", "productFamily", "system"], "field authority stays restricted to the closed classification key set");

  const item = await readItem(db, fieldOnly, { currentConfigFingerprint: CURRENT_CONFIG });
  assert.equal(item.review.status, "AWAITING_REVIEW", "a field-confirmed item is still awaiting an engineer decision, never auto-approved");
  const facts = await currentApprovedUnderstandingFacts(db, PROJECT_ID, fieldOnly, { currentConfigFingerprint: CURRENT_CONFIG });
  assert.equal(facts.system.value, "Fire Alarm");
  assert.equal(facts.productFamily.value, "Duct Detector");
  assert.equal(facts.manufacturer, undefined, "restricted field authority must not manufacture non-classification facts");
});

test("effective selection and currentUnderstandingAttempt agree for every case", async () => {
  const { database, db } = seed();
  const id = "boq-agreement";
  seedItem(database, { id, description: "Duct detector" });
  const { inputFingerprint, merged } = mergedFor(id, "Duct detector", "Fire Alarm", DUCT);
  const a = auth("agreement");
  seedRun(database, { id: "run-agree-pilot", configFingerprint: CURRENT_CONFIG });
  seedInterp(database, { id: "interp-agree-2", itemId: id, runId: "run-agree-pilot", version: 2, inputFingerprint, configFingerprint: CURRENT_CONFIG, status: "FAILED", errorCode: "AI_PROVIDER_ERROR" });
  seedRun(database, { id: "run-agree-retry", mode: "PER_ITEM_RETRY", configFingerprint: rawMix(CURRENT_CONFIG, a), authorizationFingerprint: a, parentRunId: "run-agree-pilot" });
  seedInterp(database, { id: "interp-agree-3", itemId: id, runId: "run-agree-retry", version: 3, inputFingerprint, configFingerprint: rawMix(CURRENT_CONFIG, a), status: merged.status, interpretation: merged.interpretation });

  const row = await read(db, id, { currentConfigFingerprint: CURRENT_CONFIG });
  const attempt = await currentUnderstandingAttempt(db, PROJECT_ID, id, { currentConfigFingerprint: CURRENT_CONFIG });
  assert.equal(attempt.available, true);
  assert.equal(attempt.selectedInterpretationId, row.interpretationId, "both readers must select the SAME interpretation");
  assert.equal(attempt.currentInputFingerprint, row.effective.currentInputFingerprint);
  assert.equal(attempt.currentConfigFingerprint, row.effective.selected.configFingerprint);
  assert.equal(attempt.reviewStatus, "AWAITING_REVIEW");
});

// ─────────────────────────────────────────────────────────────────────────────
// DELIBERATE behaviour change, pinned so it can never be "fixed" back.
// ─────────────────────────────────────────────────────────────────────────────
// Before the repair an authorized retry was invisible to the config filter, so
// currentUnderstandingAttempt's "newest current attempt" was the OLDER
// plain-config success and matching stayed open. Now the retry IS a current
// attempt, so a FAILED retry correctly becomes the newest current attempt and
// matching fails closed -- exactly the rule the function's own comment states
// ("a later FAILED attempt proves the current input/config no longer has an
// executable proposal ... a new matching run must fail closed").
//
// The review screen deliberately still offers the older v2 proposal for
// re-approval, because effective selection still resolves to v2.
test("a FAILED authorized retry over an older current-config success fails matching closed, while review still offers the older proposal", async () => {
  const { database, db } = seed();
  const id = "boq-failed-retry";
  seedItem(database, { id, description: "Duct detector" });
  const { inputFingerprint, merged } = mergedFor(id, "Duct detector", "Fire Alarm", DUCT);
  const a = auth("failed-retry");
  seedRun(database, { id: "run-fr-pilot", configFingerprint: CURRENT_CONFIG });
  seedInterp(database, { id: "interp-fr-2", itemId: id, runId: "run-fr-pilot", version: 2, inputFingerprint, configFingerprint: CURRENT_CONFIG, status: merged.status, interpretation: merged.interpretation });
  seedRun(database, { id: "run-fr-retry", mode: "PER_ITEM_RETRY", configFingerprint: rawMix(CURRENT_CONFIG, a), authorizationFingerprint: a, parentRunId: "run-fr-pilot" });
  seedInterp(database, { id: "interp-fr-3", itemId: id, runId: "run-fr-retry", version: 3, inputFingerprint, configFingerprint: rawMix(CURRENT_CONFIG, a), status: "FAILED", errorCode: "AI_PROVIDER_ERROR" });

  const attempt = await currentUnderstandingAttempt(db, PROJECT_ID, id, { currentConfigFingerprint: CURRENT_CONFIG });
  assert.equal(attempt.available, false, "the newest current attempt FAILED, so a matching run must fail closed");
  assert.equal(attempt.latestAttemptStatus, "FAILED");
  assert.equal(attempt.reviewStatus, "FAILED");

  const row = await read(db, id, { currentConfigFingerprint: CURRENT_CONFIG });
  assert.equal(row.interpretationId, "interp-fr-2", "the review screen still offers the older current-config proposal");
  assert.equal(row.effective.state, "AVAILABLE");
  assert.equal(safeUnderstandingReviewItem(row).review.status, "AWAITING_REVIEW");
});

test("an ordinary CONTROLLED_PILOT run with a NULL authorization fingerprint resolves by direct equality", async () => {
  const { database, db } = seed();
  const id = "boq-null-auth";
  seedItem(database, { id, description: "Duct detector" });
  const { inputFingerprint, merged } = mergedFor(id, "Duct detector", "Fire Alarm", DUCT);
  seedRun(database, { id: "run-na", mode: "CONTROLLED_PILOT", configFingerprint: CURRENT_CONFIG, authorizationFingerprint: null });
  assert.equal(database.prepare("SELECT authorization_fingerprint FROM estimator_understanding_runs WHERE id='run-na'").get().authorization_fingerprint, null,
    "an ordinary run really does persist a NULL authorization fingerprint");
  seedInterp(database, { id: "interp-na", itemId: id, runId: "run-na", version: 1, inputFingerprint, configFingerprint: CURRENT_CONFIG, status: merged.status, interpretation: merged.interpretation });

  const item = await readItem(db, id, { currentConfigFingerprint: CURRENT_CONFIG });
  assert.equal(item.review.status, "AWAITING_REVIEW", "a NULL authorization must not make an ordinary run look stale");
  assert.equal(interpretationConfigFingerprintIsCurrent(CURRENT_CONFIG, CURRENT_CONFIG, null), true);
});

test("the pilot-coverage reader and the review reader now agree about the same authorized retry", async () => {
  const { database, db } = seed();
  const id = "boq-pilot-agree";
  seedItem(database, { id, description: "Duct detector" });
  const { inputFingerprint, merged } = mergedFor(id, "Duct detector", "Fire Alarm", DUCT);
  const a = auth("pilot-agree");
  seedRun(database, { id: "run-pa-pilot", configFingerprint: CURRENT_CONFIG });
  seedInterp(database, { id: "interp-pa-2", itemId: id, runId: "run-pa-pilot", version: 2, inputFingerprint, configFingerprint: CURRENT_CONFIG, status: "FAILED", errorCode: "AI_PROVIDER_ERROR" });
  seedRun(database, { id: "run-pa-retry", mode: "PER_ITEM_RETRY", configFingerprint: rawMix(CURRENT_CONFIG, a), authorizationFingerprint: a, parentRunId: "run-pa-pilot" });
  seedInterp(database, { id: "interp-pa-3", itemId: id, runId: "run-pa-retry", version: 3, inputFingerprint, configFingerprint: rawMix(CURRENT_CONFIG, a), status: merged.status, interpretation: merged.interpretation });

  const item = await readItem(db, id, { currentConfigFingerprint: CURRENT_CONFIG });
  assert.equal(item.review.status, "AWAITING_REVIEW", "review reader calls the authorized retry current");

  // Pilot side: the SAME rows are "already interpreted", so the item is not
  // re-selected. This is the shared predicate doing the work in both places --
  // the two readers can no longer disagree.
  const manifest = await loadPilotManifest(db, PROJECT_ID, {}, CURRENT_CONFIG);
  assert.equal(manifest.itemIds.includes(id), false,
    "pilot coverage must also treat the authorized retry of the current config as covered");
});
