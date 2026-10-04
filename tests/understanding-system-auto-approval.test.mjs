import test from "node:test";
import assert from "node:assert/strict";

import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import { evaluateUnderstandingSystemAutoApproval, UNDERSTANDING_SYSTEM_AUTO_APPROVAL_POLICY_VERSION } from "../app/domain/understanding-system-auto-approval.mjs";
import {
  applyUnderstandingSystemAutoApproval,
  loadUnderstandingReviewRows,
  safeUnderstandingReviewItem,
  SYSTEM_AUTO_APPROVAL_ACTOR_ID,
} from "../worker/estimator-understanding-review-api.mjs";
import { prepareBoqUnderstandingInput, validateAndMergeBoqInterpretation, interpretationInputFingerprint } from "../app/domain/boq-understanding-engine.mjs";

// ---------------------------------------------------------------------------
// Part 1: pure policy unit tests (no DB) -- the eligibility logic itself.
// ---------------------------------------------------------------------------

const f = (value, origin = "INFERRED", confidence = 70) => ({ value, origin, confidence });

// The real, current Row 15 v3 proposal shape (Al Mousa School), reproduced
// exactly as fetched live: system/category/productFamily all INFERRED at
// 70%, detector_technology the only non-null attribute (EXTRACTED, text-
// verified), every governed matching attribute explicitly MISSING, overall
// confidence LOW. This is the case the policy is meant to approve.
const row15Proposal = () => ({
  normalizedDescription: f("Heat detector", "EXTRACTED", 100),
  system: f("Fire Alarm", "INFERRED", 70),
  category: f("Detection Devices", "INFERRED", 70),
  subcategory: f(null, "MISSING", 0),
  equipmentType: f("Heat Detector", "EXTRACTED", 100),
  productFamily: f("Heat Detector", "INFERRED", 70),
  attributes: {
    operating_voltage: f(null, "MISSING", 0),
    detector_technology: f("heat detector", "EXTRACTED", 100),
    product_type: f(null, "MISSING", 0),
    addressing: f(null, "MISSING", 0),
    protocol: f(null, "MISSING", 0),
    compatible_panel_family: f(null, "MISSING", 0),
    loop_compatibility: f(null, "MISSING", 0),
  },
  manufacturerPreferences: [], manufacturerRestrictions: [], standards: [], compatibilityRequirements: [], requiredAccessories: [], searchTerms: [], missingInformation: [], ambiguities: [], engineeringNotes: [],
  reviewReasons: ["CONFIDENCE_SCALE_NORMALIZED", "APPLICABLE_ATTRIBUTE_MISSING:product_type", "APPLICABLE_ATTRIBUTE_MISSING:addressing", "APPLICABLE_ATTRIBUTE_MISSING:protocol", "APPLICABLE_ATTRIBUTE_MISSING:compatible_panel_family", "APPLICABLE_ATTRIBUTE_MISSING:loop_compatibility", "APPLICABLE_ATTRIBUTE_MISSING:operating_voltage"],
  confidence: "LOW",
});

const baseInput = () => ({
  rawDescription: "Heat detector",
  boqItemSystemValue: "Fire Alarm",
  interpretation: row15Proposal(),
  proposalState: "AVAILABLE",
  classificationBlockers: [],
  taxonomyValid: true,
});

test("1. Heat detector -> neutral Heat Detector is eligible for System Auto-Approval", () => {
  const result = evaluateUnderstandingSystemAutoApproval(baseInput());
  assert.equal(result.eligible, true, JSON.stringify(result.reasons));
  assert.equal(result.policyVersion, UNDERSTANDING_SYSTEM_AUTO_APPROVAL_POLICY_VERSION);
  assert.equal(result.evidence.deterministicClassification.family, "Heat Detector");
  assert.deepEqual(result.evidence.matchedAttributes, ["detector_technology"]);
});

test("6. missing downstream matching attributes (operating_voltage, protocol, compatible_panel_family, loop_compatibility, addressing) do not block Understanding auto-approval", () => {
  const result = evaluateUnderstandingSystemAutoApproval(baseInput());
  assert.equal(result.eligible, true);
  assert.ok(!result.reasons.some((r) => r.startsWith("ATTRIBUTE_EXCEEDS_EVIDENCE")));
});

test("2. Addressable asserted without source evidence -> NOT auto-approved", () => {
  const interpretation = row15Proposal();
  interpretation.attributes.addressing = f("Addressable", "INFERRED", 70);
  const result = evaluateUnderstandingSystemAutoApproval({ ...baseInput(), interpretation });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("ATTRIBUTE_EXCEEDS_EVIDENCE:addressing"));
});

test("protocol inferred without source evidence -> NOT auto-approved", () => {
  const interpretation = row15Proposal();
  interpretation.attributes.protocol = f("Analogue Addressable", "INFERRED", 60);
  const result = evaluateUnderstandingSystemAutoApproval({ ...baseInput(), interpretation });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("ATTRIBUTE_EXCEEDS_EVIDENCE:protocol"));
});

test("manufacturer inferred without source evidence -> NOT auto-approved", () => {
  const interpretation = row15Proposal();
  interpretation.manufacturerPreferences = [f("Honeywell", "INFERRED", 60)];
  const result = evaluateUnderstandingSystemAutoApproval({ ...baseInput(), interpretation });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("UNVERIFIED_CLAIM_PRESENT:manufacturerPreferences"));
});

test("compatibility inferred -> NOT auto-approved", () => {
  const interpretation = row15Proposal();
  interpretation.compatibilityRequirements = [{ value: "Farenhyt panel family", origin: "INFERRED", confidence: 55 }];
  const result = evaluateUnderstandingSystemAutoApproval({ ...baseInput(), interpretation });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("UNVERIFIED_CLAIM_PRESENT:compatibilityRequirements"));
});

test("3. ambiguous / multi-family raw description -> NOT auto-approved (classifyFireAlarmFamilyFromText fails closed to null)", () => {
  const interpretation = row15Proposal();
  interpretation.normalizedDescription = f("Combined smoke and heat detector", "EXTRACTED", 100);
  interpretation.productFamily = f("Heat Detector", "INFERRED", 70);
  const result = evaluateUnderstandingSystemAutoApproval({ ...baseInput(), rawDescription: "Combined smoke and heat detector", interpretation });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("FAMILY_NOT_DETERMINISTICALLY_REPRODUCIBLE"));
});

test("proposed family conflicts with raw text -> NOT auto-approved", () => {
  const interpretation = row15Proposal();
  interpretation.productFamily = f("Addressable Smoke Detector", "INFERRED", 70);
  interpretation.category = f("Detection Devices", "INFERRED", 70);
  const result = evaluateUnderstandingSystemAutoApproval({ ...baseInput(), interpretation });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("FAMILY_NOT_DETERMINISTICALLY_REPRODUCIBLE"));
});

test("4. proposed family conflicts with governed taxonomy (invalid pairing) -> NOT auto-approved", () => {
  const interpretation = row15Proposal();
  interpretation.category = f("Control Equipment", "INFERRED", 70); // Heat Detector belongs to Detection Devices
  const result = evaluateUnderstandingSystemAutoApproval({ ...baseInput(), interpretation });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("TAXONOMY_PAIR_NOT_CANONICAL"));
});

test("5. stale interpretation -> NOT auto-approved", () => {
  const result = evaluateUnderstandingSystemAutoApproval({ ...baseInput(), proposalState: "UNAVAILABLE_OR_STALE" });
  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasons, ["STALE_OR_UNAVAILABLE_PROPOSAL"]);
});

test("classification blockers present -> NOT auto-approved", () => {
  const interpretation = row15Proposal();
  interpretation.productFamily = f(null, "MISSING", 0);
  const result = evaluateUnderstandingSystemAutoApproval({ ...baseInput(), interpretation, classificationBlockers: [{ field: "productFamily", state: "MISSING_CURRENT_EVIDENCE" }] });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("CLASSIFICATION_BLOCKERS_PRESENT"));
});

test("taxonomy candidate not accepted -> NOT auto-approved", () => {
  const result = evaluateUnderstandingSystemAutoApproval({ ...baseInput(), taxonomyValid: false });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.includes("TAXONOMY_CANDIDATE_NOT_ACCEPTED"));
});

test("policy-defined ambiguity (governance-safety reviewReason present) -> NOT auto-approved", () => {
  const interpretation = row15Proposal();
  interpretation.reviewReasons = [...interpretation.reviewReasons, "GOVERNED_CANDIDATE_KEY_INVALID"];
  const result = evaluateUnderstandingSystemAutoApproval({ ...baseInput(), interpretation });
  assert.equal(result.eligible, false);
  assert.ok(result.reasons.some((r) => r.startsWith("POLICY_AMBIGUITY_PRESENT")));
});

test("AI confidence is never read as an approval authority -- LOW confidence with clean evidence is still eligible", () => {
  const interpretation = row15Proposal();
  interpretation.confidence = "LOW";
  const result = evaluateUnderstandingSystemAutoApproval({ ...baseInput(), interpretation });
  assert.equal(result.eligible, true);
});

// ---------------------------------------------------------------------------
// Part 2: full governed-mutation-layer tests (in-memory DB carrying the REAL
// active migration chain, real mutateUnderstandingReview -- same harness
// pattern as understanding-approval-revalidation.test.mjs).
// ---------------------------------------------------------------------------

const PROJECT_ID = "p1";
const ITEM_ID = "boq-row15-equivalent";
// row_type intentionally omitted from the raw fixture's own description --
// this mirrors the REAL Row 15 raw text exactly: "Heat detector", under a
// deterministic, section-derived system_value of "Fire Alarm" (never the AI's
// own guess -- see boq_items.system_value in the real project).
const rawItemFixture = { system_value: "Fire Alarm", category: null, description: "Heat detector" };

// The fixture is the ACTUAL ordered active migration chain (drizzle-active
// journal), not a hand-written approximation -- see tests/fixtures/
// active-chain-fixture.mjs. Every seed row below therefore has to satisfy the
// REAL NOT NULL set, and FK enforcement is on because the real chain leaves it
// on (drizzle-active/0002_governing_source_fk.sql). :memory: only; no live data.
//
// Two REAL column types are load-bearing for the fingerprint this file
// computes, so the seed and the test's own prepareBoqUnderstandingInput input
// are derived from the SAME constants rather than restated:
//   * boq_items.numeric_quantity / .original_quantity are TEXT on the real
//     chain, so the DB yields "9" where the fixture row says 9 -- a numeric 9
//     recomputes a different input_fingerprint and the proposal would read
//     UNAVAILABLE_OR_STALE instead of AVAILABLE.
//   * boq_items.source_location is NOT NULL JSON, so a missing value cannot be
//     represented and the parsed object has to be what the read path sees.
const ITEM_QUANTITY = "9";
const ITEM_SOURCE_LOCATION = { sheet: "BOQ", row: 15 };

const buildDatabase = async () => activeChainDatabase();

const seedProjectAndItem = (raw) => {
  raw.exec(`
    INSERT INTO organizations (id, name) VALUES ('org1','Org One');
    INSERT INTO projects (id, name, owner_user_id, organization_id) VALUES ('${PROJECT_ID}','Understanding Fixture','owner1','org1');
    INSERT INTO documents (id, project_id, logical_name, created_by) VALUES ('doc1','${PROJECT_ID}','boq-1.xlsx','owner1');
    INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by)
      VALUES ('dv1','doc1',1,'boq-1.xlsx','boq-1.stored','xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',4,'sha-dv1','projects/${PROJECT_ID}/boq-1.xlsx','owner1');
    UPDATE documents SET current_version_id='dv1' WHERE id='doc1';
    INSERT INTO boq_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, ocr_version, created_by)
      VALUES ('ext1','doc1','dv1',1,'Completed','parser-v1','rules-v1','ocr-v1','owner1');
  `);
  raw.prepare(`INSERT INTO boq_items (id,project_id,row_type,extraction_version_id,source_document_id,sequence,item_number,description,numeric_quantity,original_quantity,normalized_unit,original_unit,system_value,category,subcategory,manufacturer,model,part_number,section_path,current_values,source_location,original_raw_values,review_status,approved_for_downstream,specification_reference,system_confidence,extraction_confidence,confidence_state)
    VALUES (?,'${PROJECT_ID}','BOQ Item','ext1','doc1',15,'C',?,?,?,'Each','Each',?,NULL,NULL,NULL,NULL,NULL,'[]','{}',?,'[]','Approved',1,NULL,95,60,'High Confidence')`)
    .run(ITEM_ID, rawItemFixture.description, ITEM_QUANTITY, ITEM_QUANTITY, rawItemFixture.system_value, JSON.stringify(ITEM_SOURCE_LOCATION));
};

const seedFreshInterpretation = (raw) => {
  const input = prepareBoqUnderstandingInput({ id: ITEM_ID, rowType: "BOQ Item", description: rawItemFixture.description, numericQuantity: ITEM_QUANTITY, originalQuantity: ITEM_QUANTITY, normalizedUnit: "Each", originalUnit: "Each", system: rawItemFixture.system_value, category: null, subcategory: null, manufacturer: null, model: null, partNumber: null, currentValues: {}, sourceLocation: ITEM_SOURCE_LOCATION }, []);
  const inputFingerprint = interpretationInputFingerprint(input);
  const response = {
    normalizedDescription: { value: "Heat detector", origin: "EXTRACTED", confidence: 100 },
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
    VALUES ('run-1','${PROJECT_ID}','org1','test-provider','test-model','model-v1','prompt-v1','schema-v1','cfg1','COMPLETED','owner1',CURRENT_TIMESTAMP,'CONTROLLED_PILOT')`).run();
  raw.prepare(`INSERT INTO estimator_item_interpretations (id,boq_item_id,run_id,project_id,version_number,input_fingerprint,config_fingerprint,provider,model,model_version,prompt_version,schema_version,status,validated_interpretation,error_code,raw_response,created_by,created_at)
    VALUES (?,?,?,?,(SELECT COALESCE(MAX(version_number),0)+1 FROM estimator_item_interpretations WHERE boq_item_id=?),?,'cfg1','test-provider','test-model','model-v1','prompt-v1','schema-v1',?,?,NULL,NULL,'owner1',CURRENT_TIMESTAMP)`)
    .run("interp-1", ITEM_ID, "run-1", PROJECT_ID, ITEM_ID, inputFingerprint, merged.status, JSON.stringify(merged.interpretation));
  return { inputFingerprint, merged };
};

test("7. System Auto-Approval executes through the real governed mutation and produces proper audit provenance", async () => {
  const raw = await buildDatabase();
  seedProjectAndItem(raw);
  const DB = d1(raw);
  seedFreshInterpretation(raw);

  const outcome = await applyUnderstandingSystemAutoApproval(DB, PROJECT_ID, ITEM_ID, 'cfg1');
  assert.equal(outcome.applied, true, JSON.stringify(outcome.policy?.reasons));
  assert.equal(outcome.policy.eligible, true);
  assert.equal(outcome.result.review.status, "APPROVED");

  const row = (await loadUnderstandingReviewRows(DB, PROJECT_ID)).find((entry) => entry.boqItemId === ITEM_ID);
  const item = safeUnderstandingReviewItem(row);
  assert.equal(item.review.status, "APPROVED");

  const versionRow = raw.prepare("SELECT * FROM estimator_understanding_review_versions WHERE boq_item_id=? ORDER BY version_number DESC LIMIT 1").get(ITEM_ID);
  assert.equal(versionRow.reviewed_by, SYSTEM_AUTO_APPROVAL_ACTOR_ID);
  assert.match(versionRow.review_reason, /System Auto-Approval/);
  assert.match(versionRow.review_reason, new RegExp(UNDERSTANDING_SYSTEM_AUTO_APPROVAL_POLICY_VERSION.replace(/\./g, "\\.")));

  const eventRow = raw.prepare("SELECT * FROM estimator_understanding_review_events WHERE boq_item_id=? ORDER BY created_at DESC LIMIT 1").get(ITEM_ID);
  assert.equal(eventRow.actor_user_id, SYSTEM_AUTO_APPROVAL_ACTOR_ID);
  assert.equal(eventRow.action, "APPROVE_INTERPRETATION");
  assert.equal(eventRow.new_status, "APPROVED");
  assert.match(eventRow.reason, /System Auto-Approval/);

  // interpretation version / input fingerprint are fully traceable via the
  // persisted interpretation_id join -- never duplicated onto the review row.
  const interpretation = raw.prepare("SELECT version_number, input_fingerprint, config_fingerprint FROM estimator_item_interpretations WHERE id=?").get(versionRow.interpretation_id);
  assert.equal(interpretation.version_number, 1);
  assert.ok(interpretation.input_fingerprint);
  assert.ok(interpretation.config_fingerprint);
});

test("8. no Requirement Profile regeneration or Matching run is triggered as a side effect -- cascadeUnderstandingApproval is never invoked by this path", async () => {
  const raw = await buildDatabase();
  seedProjectAndItem(raw);
  const DB = d1(raw);
  seedFreshInterpretation(raw);

  const outcome = await applyUnderstandingSystemAutoApproval(DB, PROJECT_ID, ITEM_ID, 'cfg1');
  assert.equal(outcome.applied, true);
  // applyUnderstandingSystemAutoApproval calls mutateUnderstandingReview
  // directly, never handleEstimatorUnderstandingReviewApi's HTTP POST
  // handler -- the only place CASCADE_TRIGGERING_ACTIONS/cascadeUnderstandingApproval
  // is wired (see worker/estimator-understanding-review-api.mjs). Proven
  // structurally here: the result carries no `cascade` field, and the HTTP
  // handler is the only code in the repository that ever adds one. (This
  // fixture now carries the real active migration chain, so
  // requirement_profile_versions / product_match_runs DO exist here; the
  // absence of a cascade is proven by the returned shape, not by their
  // absence from the schema.)
  assert.equal("cascade" in outcome.result, false);
});

test("rerun preservation -- a second call after approval never overwrites or duplicates the existing decision", async () => {
  const raw = await buildDatabase();
  seedProjectAndItem(raw);
  const DB = d1(raw);
  seedFreshInterpretation(raw);
  const first = await applyUnderstandingSystemAutoApproval(DB, PROJECT_ID, ITEM_ID, 'cfg1');
  assert.equal(first.applied, true);

  const second = await applyUnderstandingSystemAutoApproval(DB, PROJECT_ID, ITEM_ID, 'cfg1');
  // The classification itself is still deterministically valid (policy
  // eligibility is unaffected by review status), but mutateUnderstandingReview's
  // OWN existing governance (buildUnderstandingReviewActionPolicy) never
  // offers APPROVE_INTERPRETATION for an already-APPROVED item -- only
  // RETURN_TO_REVIEW is -- so the mutation itself is refused. This is the
  // existing rerun-preservation guarantee, unmodified, not a new check this
  // policy adds.
  assert.equal(second.policy.eligible, true);
  assert.equal(second.applied, false, "an already-approved item must not be silently re-approved or duplicated");
  assert.ok(second.result.error);

  const versions = raw.prepare("SELECT COUNT(*) count FROM estimator_understanding_review_versions WHERE boq_item_id=?").get(ITEM_ID);
  assert.equal(versions.count, 1, "no duplicate review version was created");
});
