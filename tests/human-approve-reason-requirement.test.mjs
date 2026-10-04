// R1 -- SUBSTANTIVE REASON REQUIRED FOR EVERY HUMAN UNDERSTANDING DECISION.
//
// Operator decision: HUMAN APPROVE_INTERPRETATION must require a substantive
// reason. The UI already gated all four human actions through
// app/domain/review-reason-gate.mjs, but the backend refused a reason for only
// three of them: `validateUnderstandingReviewCommand` lists
// EDIT_AND_APPROVE / REJECT_INTERPRETATION / RETURN_TO_REVIEW and omits
// APPROVE_INTERPRETATION, because that command is shared with deterministic
// system auto-approval. A direct API caller could therefore approve an
// interpretation with no reason at all, while the UI refused to.
//
// These tests pin the enforced behaviour at the HUMAN API/write boundary:
//
//   A1  All four human decisions are refused without a substantive reason.
//   A2  A direct POST cannot approve without a reason -- the UI gate is not
//       the only thing standing between a caller and an unevidenced approval.
//   A3  A refused decision writes NOTHING: no review version, no review event,
//       no audit row. A refused decision is not an event.
//   A4  A substantive reason is accepted and attributed to the configured human.
//   A5  System/deterministic auto-approval is unaffected: it still approves,
//       with no fake human reason and no synthetic actor.
//   A6  The canonical minimum length is shared, not redefined.
//
// FIXTURES ONLY. Every test runs against the real active migration chain in
// :memory: (tests/fixtures/active-chain-fixture.mjs). Nothing in this file
// touches the live Primary D1 database.
import test from "node:test";
import assert from "node:assert/strict";

import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import { MIN_GOVERNED_REASON_LENGTH } from "../app/domain/reason-governance.mjs";
import { evaluateReasonGate } from "../app/domain/review-reason-gate.mjs";
import {
  handleEstimatorUnderstandingReviewApi,
  loadUnderstandingReviewRows,
  safeUnderstandingReviewItem,
  SYSTEM_AUTO_APPROVAL_ACTOR_ID,
  applyUnderstandingSystemAutoApproval,
  understandingReviewSelectionAuthority,
} from "../worker/estimator-understanding-review-api.mjs";
import { validateUnderstandingReviewCommand } from "../app/domain/estimator-understanding-review.mjs";
import { prepareBoqUnderstandingInput, validateAndMergeBoqInterpretation, interpretationInputFingerprint } from "../app/domain/boq-understanding-engine.mjs";

import { createConfiguredBoqUnderstandingProvider } from "../worker/boq-understanding-provider.mjs";
import { interpretationConfigFingerprint } from "../app/domain/boq-understanding-engine.mjs";

const HUMAN_ACTIONS = ["APPROVE_INTERPRETATION", "EDIT_AND_APPROVE", "REJECT_INTERPRETATION", "RETURN_TO_REVIEW"];
const ITEM_ID = "boq-item-reason-fixture";
// boq_items.numeric_quantity / .original_quantity are TEXT on the real active
// chain, so the DB reads back "2" where the fixture literal says 2. A NUMERIC 2
// recomputes a different input_fingerprint and the proposal then reads
// UNAVAILABLE_OR_STALE, which would silently test the wrong branch. The seed and
// prepareBoqUnderstandingInput therefore share these constants rather than
// restating the values.
const ITEM_QUANTITY = "2";
const ITEM_SOURCE_LOCATION = { sheet: "BOQ", row: 15 };
const ITEM_DESCRIPTION = "Heat detector";
const PROJECT_ID = "proj-reason-fixture";
const ORGANIZATION_ID = "org-reason";
const HUMAN_ENV = { APP_HUMAN_ID: "op-reason-fixture-01", APP_HUMAN_NAME: "Reason Fixture Operator" };

// The governing configuration fingerprint is DERIVED by the worker from the
// configured provider, exactly as at runtime. Hard-coding one here would make
// the seeded interpretation look stale and silently test the wrong branch.
const envFor = (raw) => {
  const env = { DB: d1(raw), FILES: {}, AI: {}, APP_USER_ID: "local-development-user", APP_ORGANIZATION_ID: ORGANIZATION_ID, ...HUMAN_ENV };
  return { env, configFingerprint: interpretationConfigFingerprint(createConfiguredBoqUnderstandingProvider(env)?.metadata || { provider: "unavailable", model: "unavailable", modelVersion: "unavailable" }) };
};

const counts = (raw, itemId = ITEM_ID) => ({
  versions: raw.prepare("SELECT COUNT(*) count FROM estimator_understanding_review_versions WHERE boq_item_id=?").get(itemId).count,
  events: raw.prepare("SELECT COUNT(*) count FROM estimator_understanding_review_events WHERE boq_item_id=?").get(itemId).count,
});

const seed = (raw, configFingerprint) => {
  raw.exec(`
    INSERT INTO organizations (id, name) VALUES ('${ORGANIZATION_ID}','Reason Org');
    INSERT INTO projects (id, name, owner_user_id, organization_id) VALUES ('${PROJECT_ID}','Reason Fixture','local-development-user','${ORGANIZATION_ID}');
    INSERT INTO documents (id, project_id, logical_name, created_by) VALUES ('doc-reason','${PROJECT_ID}','boq.xlsx','local-development-user');
    INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by)
      VALUES ('dv-reason','doc-reason',1,'boq.xlsx','boq.stored','xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',4,'sha-dv-reason','projects/x/boq.xlsx','local-development-user');
    UPDATE documents SET current_version_id='dv-reason' WHERE id='doc-reason';
    INSERT INTO boq_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, ocr_version, created_by)
      VALUES ('ext-reason','doc-reason','dv-reason',1,'Completed','parser-v1','rules-v1','ocr-v1','local-development-user');
  `);
  raw.prepare(`INSERT INTO boq_items (id,project_id,row_type,extraction_version_id,source_document_id,sequence,item_number,description,numeric_quantity,original_quantity,normalized_unit,original_unit,system_value,category,subcategory,manufacturer,model,part_number,section_path,current_values,source_location,original_raw_values,review_status,approved_for_downstream,specification_reference,system_confidence,extraction_confidence,confidence_state)
    VALUES (?,'${PROJECT_ID}','BOQ Item','ext-reason','doc-reason',15,'C',?,?,?,'Each','Each','Fire Alarm',NULL,NULL,NULL,NULL,NULL,'[]','{}',?,'[]','Approved',1,NULL,95,60,'High Confidence')`)
    .run(ITEM_ID, ITEM_DESCRIPTION, ITEM_QUANTITY, ITEM_QUANTITY, JSON.stringify(ITEM_SOURCE_LOCATION));

  const input = prepareBoqUnderstandingInput(
    { id: ITEM_ID, rowType: "BOQ Item", description: ITEM_DESCRIPTION, numericQuantity: ITEM_QUANTITY, originalQuantity: ITEM_QUANTITY, normalizedUnit: "Each", originalUnit: "Each", system: "Fire Alarm", category: null, subcategory: null, manufacturer: null, model: null, partNumber: null, currentValues: {}, sourceLocation: ITEM_SOURCE_LOCATION },
    [],
  );
  const response = {
    normalizedDescription: { value: ITEM_DESCRIPTION, origin: "EXTRACTED", confidence: 100 },
    taxonomyCandidateKey: { value: "FA-1", origin: "INFERRED", confidence: 70 },
    system: { value: "Fire Alarm", origin: "INFERRED", confidence: 70 },
    category: { value: "Detection Devices", origin: "INFERRED", confidence: 70 },
    equipmentType: { value: "Heat Detector", origin: "EXTRACTED", confidence: 100 },
    productFamily: { value: "Heat Detector", origin: "INFERRED", confidence: 70 },
    technicalAttributes: [{ name: "detector_technology", value: "heat detector", origin: "EXTRACTED", confidence: 100 }],
    standards: [], manufacturerEvidence: [], compatibilityRequirements: [], requiredAccessories: [], searchTerms: [], missingInformation: [], ambiguities: [], confidence: "LOW",
  };
  const merged = validateAndMergeBoqInterpretation(input, response);
  raw.prepare(`INSERT INTO estimator_understanding_runs (id, project_id, organization_id, provider, model, model_version, prompt_version, schema_version, config_fingerprint, status, requested_by, started_at, run_mode)
    VALUES ('run-reason','${PROJECT_ID}','${ORGANIZATION_ID}','test-provider','test-model','model-v1','prompt-v1','schema-v1',?,'COMPLETED','local-development-user',CURRENT_TIMESTAMP,'CONTROLLED_PILOT')`).run(configFingerprint);
  raw.prepare(`INSERT INTO estimator_item_interpretations (id,boq_item_id,run_id,project_id,version_number,input_fingerprint,config_fingerprint,provider,model,model_version,prompt_version,schema_version,status,validated_interpretation,error_code,raw_response,created_by,created_at)
    VALUES (?,?,?,?,(SELECT COALESCE(MAX(version_number),0)+1 FROM estimator_item_interpretations WHERE boq_item_id=?),?,?,'test-provider','test-model','model-v1','prompt-v1','schema-v1',?,?,NULL,NULL,'local-development-user',CURRENT_TIMESTAMP)`)
    .run("interp-reason", ITEM_ID, "run-reason", PROJECT_ID, ITEM_ID, interpretationInputFingerprint(input), configFingerprint, merged.status, JSON.stringify(merged.interpretation));
  return merged;
};

const setup = async () => {
  const raw = await activeChainDatabase();
  const { env, configFingerprint } = envFor(raw);
  seed(raw, configFingerprint);
  return { raw, DB: env.DB, env, configFingerprint };
};

// The item URL is keyed by the DERIVED review key (sha256("understanding-review:" + boqItemId)
// truncated), not the raw BOQ item id, so the test resolves it from the row the
// same way a real client does rather than guessing it.
const postReview = (env, body, reviewKey) =>
  handleEstimatorUnderstandingReviewApi(
    new Request(`http://localhost/api/projects/${PROJECT_ID}/estimator-understanding-review/items/${reviewKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
    {},
  );

// The authoritative selection authority is derived server-side from the current
// row, so the test builds it exactly as a well-behaved client would.
const authorityFor = async (DB, configFingerprint) => {
  const rows = await loadUnderstandingReviewRows(DB, PROJECT_ID, { currentConfigFingerprint: configFingerprint });
  const row = rows.find((entry) => entry.boqItemId === ITEM_ID);
  assert.ok(row, "the fixture item must be a current review row");
  const item = safeUnderstandingReviewItem(row);
  // Optimistic concurrency is real: the caller must present the row's CURRENT
  // review version. Reading it here instead of hard-coding a number is what
  // keeps this test from passing or failing for the wrong reason.
  return { row, reviewKey: item.reviewKey, expectedVersion: Number(row.reviewVersion || 0), authority: understandingReviewSelectionAuthority(PROJECT_ID, row) };
};

// ---------------------------------------------------------------------------
// A1 + A6 -- the governed gate, at the canonical minimum length
// ---------------------------------------------------------------------------

test("A1. all four human decisions require a substantive reason", () => {
  for (const decision of HUMAN_ACTIONS) {
    assert.equal(evaluateReasonGate({ decision }).ok, false, `${decision} must not proceed without a reason`);
    assert.equal(evaluateReasonGate({ decision, reason: "" }).ok, false, `${decision} must reject a blank reason`);
    assert.equal(evaluateReasonGate({ decision, reason: "   \t\n  " }).ok, false, `${decision} must reject a whitespace reason`);
    // "ok ok" is 5 characters: exactly MIN_GOVERNED_REASON_LENGTH, so it is
    // the boundary case that MUST be accepted. A4 and A6 pin the boundary.
    assert.equal(evaluateReasonGate({ decision, reason: "ok ok" }).ok, true, `${decision} must accept a reason at exactly the minimum length`);
    assert.equal(evaluateReasonGate({ decision, reason: "Verified against the panel data sheet revision C" }).ok, true, `${decision} must accept a substantive reason`);
  }
});

test("A6. the gate uses the canonical minimum length, not a second definition", () => {
  const atMinimum = "x".repeat(MIN_GOVERNED_REASON_LENGTH);
  const justUnder = "x".repeat(MIN_GOVERNED_REASON_LENGTH - 1);
  assert.equal(evaluateReasonGate({ decision: "APPROVE_INTERPRETATION", reason: atMinimum }).ok, true);
  assert.equal(evaluateReasonGate({ decision: "APPROVE_INTERPRETATION", reason: justUnder }).ok, false);
});

// ---------------------------------------------------------------------------
// A2 + A3 -- the HTTP boundary refuses, and refusal writes nothing
// ---------------------------------------------------------------------------

test("A2/A3. a direct API call cannot approve without a reason, and writes nothing", async () => {
  const { raw, DB, env, configFingerprint } = await setup();
  const { authority, reviewKey, expectedVersion } = await authorityFor(DB, configFingerprint);
  const before = counts(raw);

  for (const body of [
    undefined,
    { reason: "" },
    { reason: "    " },
    { reason: "ok" },
  ]) {
    const payload = { action: "APPROVE_INTERPRETATION", expectedVersion, requestId: "human-approve-no-reason", selectionAuthority: authority };
    if (body) Object.assign(payload, body);
    const response = await postReview(env, payload, reviewKey);
    assert.equal(response.status, 400, `APPROVE_INTERPRETATION must be refused for reason ${JSON.stringify(body)}`);
    const error = await response.json();
    assert.equal(error.error.code, "REVIEW_REASON_REQUIRED");
  }

  // A refused decision is not an event. No version, no audit row, nothing.
  assert.deepEqual(counts(raw), before, "a refused approval must leave no review version or review event");
});

test("A2. every human decision is refused at the API boundary without a reason", async () => {
  for (const action of HUMAN_ACTIONS) {
    const { raw, DB, env, configFingerprint } = await setup();
    const { authority, reviewKey, expectedVersion } = await authorityFor(DB, configFingerprint);
    const before = counts(raw);
    const payload = { action, expectedVersion, requestId: `human-${action}-no-reason`, selectionAuthority: authority };
    if (action === "EDIT_AND_APPROVE") payload.canonicalInterpretation = { productFamily: "Heat Detector" };
    const response = await postReview(env, payload, reviewKey);
    assert.equal(response.status, 400, `${action} must be refused without a reason`);
    const error = await response.json();
    assert.ok(
      ["REVIEW_REASON_REQUIRED", "UNDERSTANDING_REVIEW_REASON_REQUIRED"].includes(error.error.code),
      `${action} must report a reason requirement, got ${error.error.code}`,
    );
    assert.deepEqual(counts(raw), before, `${action} refusal must write nothing`);
  }
});

// ---------------------------------------------------------------------------
// A4 -- a substantive human reason is accepted and attributed truthfully
// ---------------------------------------------------------------------------

test("A4. a substantive reason is accepted and attributed to the configured human", async () => {
  const { raw, DB, env, configFingerprint } = await setup();
  const { authority, reviewKey, expectedVersion } = await authorityFor(DB, configFingerprint);
  const response = await postReview(env, {
    action: "APPROVE_INTERPRETATION",
    expectedVersion,
    requestId: "human-approve-with-reason",
    selectionAuthority: authority,
    reason: "Confirmed against the panel data sheet revision C",
  }, reviewKey);
  // The body is read exactly once: asserting the status with `await
  // response.text()` as the failure message would consume the body and turn a
  // real assertion failure into an unrelated "Body has already been read".
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.review.status, "APPROVED");

  const row = await loadUnderstandingReviewRows(DB, PROJECT_ID, { currentConfigFingerprint: configFingerprint });
  assert.equal(safeUnderstandingReviewItem(row.find((entry) => entry.boqItemId === ITEM_ID)).review.status, "APPROVED");

  // Attribution is the configured human, never a synthetic fallback and never
  // a value supplied by the request body.
  const version = raw.prepare("SELECT * FROM estimator_understanding_review_versions WHERE boq_item_id=? ORDER BY version_number DESC LIMIT 1").get(ITEM_ID);
  assert.equal(version.reviewed_by, HUMAN_ENV.APP_HUMAN_ID);
  assert.match(version.review_reason, /panel data sheet revision C/);
  const event = raw.prepare("SELECT * FROM estimator_understanding_review_events WHERE boq_item_id=? ORDER BY created_at DESC, id DESC LIMIT 1").get(ITEM_ID);
  assert.equal(event.actor_user_id, HUMAN_ENV.APP_HUMAN_ID);
  assert.equal(event.action, "APPROVE_INTERPRETATION");
});

// ---------------------------------------------------------------------------
// A5 -- system / deterministic auto-approval is untouched
// ---------------------------------------------------------------------------

test("A5. system auto-approval still approves, with no fake human reason and no synthetic actor", async () => {
  const { raw, DB, configFingerprint } = await setup();
  const outcome = await applyUnderstandingSystemAutoApproval(DB, PROJECT_ID, ITEM_ID, configFingerprint);
  assert.equal(outcome.applied, true, JSON.stringify(outcome.policy?.reasons || []));

  const version = raw.prepare("SELECT * FROM estimator_understanding_review_versions WHERE boq_item_id=? ORDER BY version_number DESC LIMIT 1").get(ITEM_ID);
  assert.equal(version.reviewed_by, SYSTEM_AUTO_APPROVAL_ACTOR_ID, "the system actor is preserved, never rewritten to a human");
  assert.match(version.review_reason, /System Auto-Approval/, "its reason is policy-derived, not a human's words");
  const event = raw.prepare("SELECT * FROM estimator_understanding_review_events WHERE boq_item_id=? ORDER BY created_at DESC, id DESC LIMIT 1").get(ITEM_ID);
  assert.equal(event.actor_user_id, SYSTEM_AUTO_APPROVAL_ACTOR_ID);
});

test("A5. the shared command contract still accepts APPROVE_INTERPRETATION without a reason, so auto-approval is untouched", async () => {
  // This is the deliberate split: the shared command contract stays permissive
  // because deterministic system auto-approval routes through it, and the
  // requirement lives at the human boundary instead (A2). If someone "fixes"
  // this line by making the shared contract require a reason, auto-approval
  // would either break or be forced to invent a human reason.
  const validated = validateUnderstandingReviewCommand({
    action: "APPROVE_INTERPRETATION",
    expectedVersion: 1,
    requestId: "system-auto-approval-check",
    selectionAuthority: "a".repeat(64),
  });
  assert.equal(validated.ok, true, "the shared command contract must remain permissive for system writers");
});
