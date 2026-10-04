import test from "node:test";
import assert from "node:assert/strict";

import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import { buildLineDecisionModel } from "../worker/boq-line-decision-api.mjs";
import { mutateUnderstandingReview, understandingReviewSelectionAuthority, loadUnderstandingReviewRows } from "../worker/estimator-understanding-review-api.mjs";
import { prepareBoqUnderstandingInput, interpretationInputFingerprint } from "../app/domain/boq-understanding-engine.mjs";

// Truthful technical readiness correction -- worker-level proof that the
// REAL API-to-model mapping (buildLineDecisionModel, not just a manually
// constructed deriveCompositeLineState input) no longer reports
// TECHNICALLY_READY for a real persisted safety_decisions row shaped exactly
// like the confirmed contradiction: safety_state="Approval Ready" (zero
// blocks) while technical_eligibility="Human Review Required" (an
// unresolved Mandatory requirement). Reuses the real APPROVE_INTERPRETATION
// flow already established in tests/technical-requirement-drawing-handoff.test.mjs
// -- hand-inserting an estimator_understanding_review_versions row directly
// (bypassing mutateUnderstandingReview) does not reach review.status="APPROVED"
// because reviewMatchesEffective requires the REAL recomputed input
// fingerprint, not an arbitrary one. The database is the real, ordered active
// migration chain (tests/fixtures/active-chain-fixture.mjs).

// The fixture is the ACTUAL ordered active migration chain (drizzle-active
// journal), not a hand-written approximation -- see
// tests/fixtures/active-chain-fixture.mjs. The previously hand-rolled schema
// here omitted the real NOT NULL sets (boq_items.hierarchy_depth /
// section_path / confidence_state / original_raw_values, documents.created_by,
// the 13-NOT-NULL requirement_profile_versions row, product_manufacturers.
// normalized_name, ...) and re-applied drizzle/0060 on top, which is already
// folded into the chain -- so it proved nothing about the behaviour it claims
// to cover. Foreign keys are ON because the real chain leaves them on
// (drizzle-active/0002_governing_source_fk.sql), so `organizations` and the
// real library/match/safety FK parents are seeded for real. The shared `d1`
// adapter is used unmodified; this file asserts nothing about batch
// atomicity, and a single node:sqlite connection cannot model D1's batch
// transaction boundary anyway (see the fixture's MODELLING NOTE).
const buildDatabase = async () => {
  const raw = activeChainDatabase();
  raw.exec(`
    INSERT INTO organizations (id, name, owner_user_id) VALUES ('org1', 'Org One', 'owner1');
    INSERT INTO projects (id, name, owner_user_id, organization_id) VALUES ('p1', 'CCTV Retrofit', 'owner1', 'org1');
  `);
  return raw;
};

// CCTV/Dome Camera -- deliberately NOT "Fire Alarm"/"Heat Detector". Fire
// Alarm is a registered governed-taxonomy system (system-knowledge-registry.mjs),
// which additionally requires row.effective.taxonomy.acceptedCandidate before
// mutateUnderstandingReview will approve it -- out of scope to construct here.
// CCTV/Dome Camera is the exact, already-proven-working shape reused from
// tests/technical-requirement-drawing-handoff.test.mjs's cctvProposal fixture;
// the specific system/family is irrelevant to what this file verifies (the
// safety_state/technical_eligibility -> composite wiring), only a genuinely
// APPROVED understanding review is required to reach that branch.
const cctvProposal = {
  normalizedDescription: { value: "Dome Camera", origin: "EXTRACTED", confidence: 95 },
  system: { value: "CCTV", origin: "EXTRACTED", confidence: 95 },
  category: { value: "Cameras", origin: "EXTRACTED", confidence: 90 },
  subcategory: { value: null, origin: "MISSING", confidence: 0 },
  equipmentType: { value: "Dome Camera", origin: "EXTRACTED", confidence: 90 },
  productFamily: { value: "Dome Camera", origin: "EXTRACTED", confidence: 90 },
  // Dome Camera's own governed mandatory matching attributes
  // (app/domain/cctv-taxonomy.mjs: camera_type, megapixels) are supplied so
  // evaluateUnderstandingAuthority's matchingBlockers is empty -- this file
  // is testing the safety_state/technical_eligibility -> composite wiring in
  // isolation, not CCTV's own governed-attribute engineer-question gate.
  attributes: {
    camera_type: { value: "Dome", origin: "EXTRACTED", confidence: 95 },
    megapixels: { value: "4MP", origin: "EXTRACTED", confidence: 95 },
  },
  manufacturerPreferences: [], manufacturerRestrictions: [], standards: [], compatibilityRequirements: [],
  requiredAccessories: [], searchTerms: ["dome camera"], missingInformation: [], ambiguities: [],
  engineeringNotes: [], confidence: "HIGH", reviewReasons: [],
};

const PROJECT = "p1";
const ITEM = "boq-cctv-1";
const OWNER = "owner1";

// Exactly the real established seedItem/decide pattern from
// tests/technical-requirement-drawing-handoff.test.mjs: an approved AI
// Understanding Review, reached through the actual mutateUnderstandingReview
// APPROVE_INTERPRETATION path (never a hand-rolled review_versions row).
const seedApprovedItem = async (raw) => {
  const DB = d1(raw);
  // Real chain fidelity, not fixture convenience: boq_items.original_quantity /
  // numeric_quantity are TEXT (worker/boq-extraction-api.mjs persists
  // String(row.quantity.*)) and source_location is NOT NULL JSON, and the
  // resolver recomputes the understanding fingerprint from the row AS STORED.
  const boqInput = prepareBoqUnderstandingInput({
    id: ITEM, rowType: "BOQ Item", description: "Dome Camera",
    numericQuantity: "9", originalQuantity: "9", normalizedUnit: "Each", originalUnit: "Each",
    system: null, category: null, subcategory: null, manufacturer: null, model: null, partNumber: null,
    currentValues: {}, sourceLocation: {},
  });
  const inputFingerprint = interpretationInputFingerprint(boqInput);
  raw.exec(`
    INSERT INTO documents (id, project_id, logical_name, created_by) VALUES ('doc1','${PROJECT}','boq.xlsx','${OWNER}');
    INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by)
      VALUES ('dv1','doc1',1,'boq.xlsx','boq.stored','xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',4,'sha-dv1','projects/${PROJECT}/boq.xlsx','${OWNER}');
    UPDATE documents SET current_version_id='dv1' WHERE id='doc1';
    INSERT INTO boq_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, ocr_version, created_by)
      VALUES ('ext1','doc1','dv1',1,'Completed','parser-v1','rules-v1','ocr-v1','${OWNER}');
  `);
  // AIU-2: Understanding review only exists for extraction-confirmed BOQ rows
  // (canonical AI Understanding eligibility), so the seed row must carry a
  // confirmed extraction decision + downstream approval, not 'Needs Review'.
  // Every column below is named because the real boq_items carries NOT NULL
  // columns (hierarchy_depth, section_path, confidence_state,
  // original_raw_values) that a positional list cannot express.
  raw.prepare(`INSERT INTO boq_items (id,project_id,row_type,extraction_version_id,source_document_id,sequence,item_number,description,numeric_quantity,original_quantity,normalized_unit,original_unit,system_value,category,subcategory,manufacturer,model,part_number,hierarchy_depth,section_path,source_location,original_raw_values,current_values,review_status,approved_for_downstream,specification_reference,system_confidence,extraction_confidence,confidence_state)
    VALUES (?,?,'BOQ Item','ext1','doc1',1,'C','Dome Camera','9','9','Each','Each',NULL,NULL,NULL,NULL,NULL,NULL,0,'[]','{}','[]','{}','Auto Verified',1,NULL,NULL,60,'High Confidence')`)
    .run(ITEM, PROJECT);
  raw.exec(`INSERT INTO estimator_understanding_runs (id, project_id, organization_id, provider, model, model_version, prompt_version, schema_version, config_fingerprint, status, requested_by)
    VALUES ('run1','${PROJECT}','org1','test','test-model','1','p1','s1','cfg1','COMPLETED','${OWNER}')`);
  raw.prepare(`INSERT INTO estimator_item_interpretations (id,boq_item_id,run_id,project_id,version_number,input_fingerprint,config_fingerprint,provider,model,model_version,prompt_version,schema_version,status,validated_interpretation,error_code,created_by,created_at)
    VALUES ('interp1',?,'run1',?,1,?,'cfg1','test','test-model','1','p1','s1','NEEDS_REVIEW',?,NULL,'${OWNER}','2026-09-23T00:00:00Z')`)
    .run(ITEM, PROJECT, inputFingerprint, JSON.stringify(cctvProposal));
  const row = (await loadUnderstandingReviewRows(DB, PROJECT)).find((entry) => entry.boqItemId === ITEM);
  await mutateUnderstandingReview(DB, { userId: OWNER }, PROJECT, row, {
    action: "APPROVE_INTERPRETATION", expectedVersion: Number(row.reviewVersion || 0),
    requestId: "req-approve", selectionAuthority: understandingReviewSelectionAuthority(PROJECT, row), reason: null,
  });
  return DB;
};

// A viable (mandatory-clean) top-ranked candidate, and a real
// safety_decisions row shaped exactly like the confirmed contradiction.
const seedCandidateAndSafetyDecision = (raw, { technicalEligibility, safetyState }) => {
  // The real product_match_runs / safety_decisions tables carry a foreign key
  // to requirement_profile_versions, so the profile version those two rows are
  // bound to is seeded first, with its real 13 NOT NULL columns filled.
  raw.exec(`
    INSERT INTO product_manufacturers (id, name, normalized_name, created_by) VALUES ('mfr1','Acme','acme','${OWNER}');
    INSERT INTO product_families (id, name, normalized_name) VALUES ('fam1','Dome Camera','dome camera');
    INSERT INTO library_products (id, manufacturer_id, family_id, part_number, normalized_part_number, description, attributes, created_by)
      VALUES ('product1','mfr1','fam1','ASD-100','asd 100','Dome Camera','[]','${OWNER}');
    INSERT INTO requirement_profile_versions (id,project_id,boq_item_id,version_number,status,engine_version,ruleset_version,model_version,input_fingerprint,profile,explanation,readiness_status,confidence_summary,created_by)
      VALUES ('profile1','${PROJECT}','${ITEM}',1,'Completed','engine-1','rules-1','model-1','fp-profile','{}','Seeded profile','Ready','{}','${OWNER}');
  `);
  raw.prepare(`INSERT INTO product_match_runs (id,project_id,boq_item_id,requirement_profile_version_id,version_number,status,input_fingerprint,engine_version,ruleset_version,search_version,model_version,search_scope,summary,created_by)
    VALUES ('run-match-1',?,?,'profile1',1,'Needs Review','fp-match','engine-1','rules-1','search-1','model-1','{}','{}',?)`)
    .run(PROJECT, ITEM, OWNER);
  raw.prepare(`INSERT INTO product_match_candidates (id,match_run_id,product_id,rank,search_stage,score,score_components,technical_status,recommendation_tier,confidence_state,confidence_score,matching_basis,commercial_availability,explanation,mandatory_failures,lifecycle_result,review_status,manually_added)
    VALUES ('candidate1','run-match-1','product1',1,'Library',80,'{}','Technical Review Required','Pending Evidence','High Confidence',80,'[]','Valid Current Price Available','Top candidate','[]','{}','Needs Review',0)`).run();
  raw.prepare(`INSERT INTO safety_decisions (id,project_id,boq_item_id,candidate_id,requirement_profile_version_id,match_run_id,version_number,input_fingerprint,safety_state,compliance_state,confidence_level,overall_confidence,confidence_components,technical_eligibility,price_eligibility,missing_information,provenance_status,explanation,engine_version,ruleset_version,model_version,recalculation_reason,created_by,superseded_at)
    VALUES ('safety1',?,?,'candidate1','profile1','run-match-1',1,'fp-safety',?,'Technical Review Required','High Confidence',80,'{}',?,'Price Approval Disabled','[]','Complete','Explanation','confidence-safety-engine-1.0.0','safety-rules-2026-08-02','deterministic-critical-gates-1.0.0','Initial evaluation',?,NULL)`)
    .run(PROJECT, ITEM, safetyState, technicalEligibility, OWNER);
};

test("buildLineDecisionModel: Approval Ready + Human Review Required (the confirmed real API-to-model contradiction) -> composite is NOT TECHNICALLY_READY", async () => {
  const raw = await buildDatabase();
  const DB = await seedApprovedItem(raw);
  seedCandidateAndSafetyDecision(raw, { technicalEligibility: "Human Review Required", safetyState: "Approval Ready" });
  const model = await buildLineDecisionModel({ DB }, { projectId: PROJECT, itemId: ITEM, userId: "owner1" });
  assert.equal(model.understanding.status, "APPROVED", "sanity: the AI Understanding Review must be genuinely approved for this fixture to test the intended branch");
  assert.equal(model.safety.safetyState, "Approval Ready");
  assert.equal(model.safety.technicalEligibility, "Human Review Required");
  assert.notEqual(model.composite.state, "TECHNICALLY_READY", "the real API-to-model mapping must not report technically ready for an unresolved-evidence candidate");
  assert.equal(model.composite.state, "TECHNICAL_DECISION_REQUIRED");
  assert.match(model.currentBlocker || "", /not yet eligible for technical approval/i);
  raw.close();
});

test("buildLineDecisionModel: an otherwise eligible control still reaches TECHNICALLY_READY (existing intended behavior preserved)", async () => {
  const raw = await buildDatabase();
  const DB = await seedApprovedItem(raw);
  seedCandidateAndSafetyDecision(raw, { technicalEligibility: "Eligible for Technical Approval", safetyState: "Approval Ready" });
  const model = await buildLineDecisionModel({ DB }, { projectId: PROJECT, itemId: ITEM, userId: "owner1" });
  assert.equal(model.composite.state, "TECHNICALLY_READY");
  assert.equal(model.currentBlocker, null);
  raw.close();
});

test("buildLineDecisionModel: an actual open safety block still forces TECHNICAL_DECISION_REQUIRED regardless of the eligibility label -- blocked-state precedence preserved", async () => {
  const raw = await buildDatabase();
  const DB = await seedApprovedItem(raw);
  seedCandidateAndSafetyDecision(raw, { technicalEligibility: "Technical Approval Disabled", safetyState: "Blocked" });
  const model = await buildLineDecisionModel({ DB }, { projectId: PROJECT, itemId: ITEM, userId: "owner1" });
  assert.equal(model.composite.state, "TECHNICAL_DECISION_REQUIRED");
  assert.match(model.currentBlocker || "", /open safety\/compliance block/i, "the pre-existing open-block message must still take precedence over the new eligibility message");
  raw.close();
});
