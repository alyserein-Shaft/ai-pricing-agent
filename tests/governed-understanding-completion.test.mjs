// SLICE: Governed Understanding Completion -> SLC demand funnel (field path).
//
// T1  A deterministically classifiable missing-family item gains governed
//     family authority through the existing system field-confirmation policy.
// T2  Identical repeat is idempotent (no duplicate rows, no overwrite).
// T3  A conflicting decision against the same interpretation+fingerprint is refused.
// T4  An ambiguous classification (bare "Smoke detectors (above ceiling)")
//     is NOT auto-confirmed, and writes nothing.
// T5  A stale interpretation/fingerprint cannot receive an authority decision
//     intended for another version (field facts bind to interpretation+fp).
// T6  The current governed resolver returns the field-level confirmed family.
// T7  The SLC classifier consumes the governed family (and reports the
//     taxonomy reason, not a missing-family reason).
// T8  The point-demand bridge receives the resulting resource classification.
// T9  A missing/ambiguous family remains fail-closed in the SLC classifier.
// T10 No manufacturer/standards/compatibility field is auto-approved by this slice.
//
// All paths are the real production modules on the real active migration
// chain (:memory: fixture). Nothing touches the live database.
import test from "node:test";
import assert from "node:assert/strict";

import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import { prepareBoqUnderstandingInput, validateAndMergeBoqInterpretation, interpretationInputFingerprint } from "../app/domain/boq-understanding-engine.mjs";
import {
  applyUnderstandingSystemFieldAutoApproval,
  currentApprovedUnderstandingFacts,
  loadUnderstandingReviewRows,
  recordUnderstandingFieldDecision,
  UNDERSTANDING_FIELD_AUTO_ACTOR_ID,
} from "../worker/estimator-understanding-review-api.mjs";
import { evaluateUnderstandingSystemAutoApproval } from "../app/domain/understanding-system-auto-approval.mjs";
import { classifyFireAlarmSlcItem } from "../app/domain/fire-alarm-slc-resource-classifier.mjs";
import { produceProjectPreliminaryPointDemand } from "../app/domain/project-point-demand-bridge.mjs";

const PROJECT = "p1";
const CFG = "cfg-field-slice";
const ITEM = "boq-duct-1";
const AMBIGUOUS_ITEM = "boq-smoke-bare-1";
const QTY = "4";
const SRC_LOC = { sheet: "BOQ", row: 7 };

const seedParents = (raw) => {
  raw.exec(`
    INSERT INTO organizations (id, name) VALUES ('org1','Org One');
    INSERT INTO projects (id, name, owner_user_id, organization_id) VALUES ('${PROJECT}','Field Slice Fixture','owner1','org1');
    INSERT INTO documents (id, project_id, logical_name, created_by) VALUES ('doc1','${PROJECT}','boq-1.xlsx','owner1');
    INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by)
      VALUES ('dv1','doc1',1,'boq-1.xlsx','boq-1.stored','xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',4,'sha-dv1','projects/${PROJECT}/boq-1.xlsx','owner1');
    UPDATE documents SET current_version_id='dv1' WHERE id='doc1';
    INSERT INTO boq_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, ocr_version, created_by)
      VALUES ('ext1','doc1','dv1',1,'Completed','parser-v1','rules-v1','ocr-v1','owner1');
  `);
};

let seedSequence = 0;
const seedItem = (raw, id, description, systemValue) => {
  seedSequence += 1;
  raw.prepare(`INSERT INTO boq_items (id,project_id,row_type,extraction_version_id,source_document_id,sequence,item_number,description,numeric_quantity,original_quantity,normalized_unit,original_unit,system_value,category,subcategory,manufacturer,model,part_number,section_path,current_values,source_location,original_raw_values,review_status,approved_for_downstream,specification_reference,system_confidence,extraction_confidence,confidence_state)
    VALUES (?,'${PROJECT}','BOQ Item','ext1','doc1',?,'C',?,?,?,'Each','Each',?,NULL,NULL,NULL,NULL,NULL,'[]','{}',?,'[]','Approved',1,NULL,95,60,'High Confidence')`)
    .run(id, seedSequence, description, QTY, QTY, systemValue, JSON.stringify(SRC_LOC));
};

const seedInterpretation = (raw, itemId, interpId, runId, description, family, category) => {
  const input = prepareBoqUnderstandingInput({ id: itemId, rowType: "BOQ Item", description, numericQuantity: QTY, originalQuantity: QTY, normalizedUnit: "Each", originalUnit: "Each", system: "Fire Alarm", category: null, subcategory: null, manufacturer: null, model: null, partNumber: null, currentValues: {}, sourceLocation: SRC_LOC }, []);
  const inputFingerprint = interpretationInputFingerprint(input);
  const response = {
    normalizedDescription: { value: description, origin: "EXTRACTED", confidence: 100 },
    taxonomyCandidateKey: { value: "FA-1", origin: "INFERRED", confidence: 70 },
    system: { value: "Fire Alarm", origin: "INFERRED", confidence: 70 },
    category: { value: category, origin: "INFERRED", confidence: 70 },
    equipmentType: { value: family, origin: "EXTRACTED", confidence: 100 },
    productFamily: family ? { value: family, origin: "INFERRED", confidence: 70 } : { value: null, origin: "MISSING", confidence: 0 },
    technicalAttributes: [{ name: "detector_technology", value: description.toLowerCase(), origin: "EXTRACTED", confidence: 100 }],
    standards: [], manufacturerEvidence: [], compatibilityRequirements: [], requiredAccessories: [], searchTerms: [], missingInformation: [], ambiguities: [], confidence: "MEDIUM",
  };
  const merged = validateAndMergeBoqInterpretation(input, response);
  raw.prepare(`INSERT INTO estimator_understanding_runs (id, project_id, organization_id, provider, model, model_version, prompt_version, schema_version, config_fingerprint, status, requested_by, started_at, run_mode)
    VALUES (?,?,?,?,?,?,?,?,?,'COMPLETED','owner1',CURRENT_TIMESTAMP,'CONTROLLED_PILOT')`)
    .run(runId, PROJECT, "org1", "test-provider", "test-model", "model-v1", "prompt-v1", "schema-v1", CFG);
  raw.prepare(`INSERT INTO estimator_item_interpretations (id,boq_item_id,run_id,project_id,version_number,input_fingerprint,config_fingerprint,provider,model,model_version,prompt_version,schema_version,status,validated_interpretation,created_by,created_at)
    VALUES (?,?,?,?,(SELECT COALESCE(MAX(version_number),0)+1 FROM estimator_item_interpretations WHERE boq_item_id=?),?,?,'test-provider','test-model','model-v1','prompt-v1','schema-v1',?,?,'owner1',CURRENT_TIMESTAMP)`)
    .run(interpId, itemId, runId, PROJECT, itemId, inputFingerprint, CFG, merged.status, JSON.stringify(merged.interpretation));
  return { inputFingerprint, merged };
};

const setup = async () => {
  const raw = await activeChainDatabase();
  seedParents(raw);
  seedItem(raw, ITEM, "Duct detector", "Fire Alarm");
  seedItem(raw, AMBIGUOUS_ITEM, "Smoke detectors (above ceiling)", "Fire Alarm");
  seedInterpretation(raw, ITEM, "interp-duct-1", "run-duct-1", "Duct detector", "Duct Detector", "Detection Devices");
  seedInterpretation(raw, AMBIGUOUS_ITEM, "interp-smoke-1", "run-smoke-1", "Smoke detectors (above ceiling)", null, null);
  return { raw, DB: d1(raw) };
};

// T1 -- a deterministically classifiable item gains governed family authority.
test("T1. a deterministically classifiable missing-family item gains governed family via the system field policy", async () => {
  const { raw, DB } = await setup();
  try {
    const outcome = await applyUnderstandingSystemFieldAutoApproval(DB, PROJECT, ITEM, CFG);
    assert.equal(outcome.applied, true, JSON.stringify(outcome));
    assert.equal(outcome.confirmedFields, 3, "system + category + productFamily, nothing else");
    for (const entry of outcome.results) {
      assert.equal(entry.success, true);
      assert.equal(entry.idempotent, false);
    }
    const rows = raw.prepare("SELECT field_key, decision, reviewed_by FROM estimator_understanding_field_reviews WHERE boq_item_id=?").all(ITEM);
    assert.deepEqual(rows.map((r) => r.field_key).sort(), ["category", "productFamily", "system"]);
    for (const r of rows) {
      assert.equal(r.decision, "CONFIRMED");
      assert.equal(r.reviewed_by, UNDERSTANDING_FIELD_AUTO_ACTOR_ID, "the actor is the governed system identity, never a human");
    }
  } finally { raw.close(); }
});

// T2 -- identical repeat is idempotent.
test("T2. identical repeat is a safe no-op, never a duplicate row", async () => {
  const { raw, DB } = await setup();
  try {
    const first = await applyUnderstandingSystemFieldAutoApproval(DB, PROJECT, ITEM, CFG);
    assert.equal(first.applied, true);
    const second = await applyUnderstandingSystemFieldAutoApproval(DB, PROJECT, ITEM, CFG);
    assert.equal(second.applied, true);
    assert.ok(second.results.every((entry) => entry.idempotent === true), "every field reports idempotent on repeat");
    const count = raw.prepare("SELECT COUNT(*) c FROM estimator_understanding_field_reviews WHERE boq_item_id=?").get(ITEM).c;
    assert.equal(count, 3, "still exactly 3 rows after the repeat");
  } finally { raw.close(); }
});

// T3 -- a conflicting decision is refused.
test("T3. a conflicting value against the same interpretation+fingerprint is refused", async () => {
  const { raw, DB } = await setup();
  try {
    await applyUnderstandingSystemFieldAutoApproval(DB, PROJECT, ITEM, CFG);
    const row = (await loadUnderstandingReviewRows(DB, PROJECT, { currentConfigFingerprint: CFG })).find((entry) => entry.boqItemId === ITEM);
    const conflict = await recordUnderstandingFieldDecision(DB, {
      boqItemId: ITEM, projectId: PROJECT, interpretationId: row.interpretationId, fieldKey: "productFamily",
      decision: "CONFIRMED",
      proposedValue: { value: "Duct Detector" },
      confirmedValue: { value: "Beam Detector" },
      sourceInputFingerprint: row.effective.currentInputFingerprint,
      reason: "hostile test write", actorUserId: "tester",
    });
    assert.equal(conflict.success, false);
    assert.equal(conflict.code, "FIELD_DECISION_ALREADY_RECORDED");
    const stored = raw.prepare("SELECT confirmed_value FROM estimator_understanding_field_reviews WHERE boq_item_id=? AND field_key='productFamily'").get(ITEM).confirmed_value;
    assert.match(stored, /Duct Detector/, "the original governed value is untouched");
  } finally { raw.close(); }
});

// T4 -- ambiguous classification is NOT auto-confirmed and writes nothing.
test("T4. bare smoke-detector text is NOT auto-confirmed (addressable vs conventional is undecided)", async () => {
  const { raw, DB } = await setup();
  try {
    const outcome = await applyUnderstandingSystemFieldAutoApproval(DB, PROJECT, AMBIGUOUS_ITEM, CFG);
    assert.equal(outcome.applied, false);
    // The merge leaves a familyless proposal with no confirmable system
    // either, so the refusal surfaces at the system gate; a proposal that
    // carried system further would refuse at the family gate. Both are
    // legitimate deterministic refusals -- what matters is nothing is confirmed.
    assert.ok(
      ["SYSTEM_NOT_CONFIRMED_BY_DETERMINISTIC_SECTION_CONTEXT", "FAMILY_NOT_DETERMINISTICALLY_REPRODUCIBLE"].includes(outcome.code),
      "refusal code: " + outcome.code,
    );
    const count = raw.prepare("SELECT COUNT(*) c FROM estimator_understanding_field_reviews WHERE boq_item_id=?").get(AMBIGUOUS_ITEM).c;
    assert.equal(count, 0, "an ambiguous item leaves no governance trace at all");
  } finally { raw.close(); }
});

// T5 -- stale interpretation/fingerprint cannot receive another version's decision.
test("T5. a field decision bound to a superseded interpretation is invisible to the current resolver", async () => {
  const { raw, DB } = await setup();
  try {
    await applyUnderstandingSystemFieldAutoApproval(DB, PROJECT, ITEM, CFG);
    const before = await currentApprovedUnderstandingFacts(DB, PROJECT, ITEM);
    assert.equal(before?.productFamily?.value, "Duct Detector");
    // The BOQ input itself changes, then a newer interpretation arrives with
    // a different proposal; the old field facts stay bound to the old
    // interpretation id + fingerprint and must not leak into the new version.
    raw.prepare("UPDATE boq_items SET description=? WHERE id=?").run("Duct detector unit", ITEM);
    seedInterpretation(raw, ITEM, "interp-duct-2", "run-duct-2", "Duct detector unit", "Beam Detector", "Detection Devices");
    const row = (await loadUnderstandingReviewRows(DB, PROJECT, { currentConfigFingerprint: CFG })).find((entry) => entry.boqItemId === ITEM);
    assert.notEqual(row.interpretationId, "interp-duct-1", "the current interpretation actually moved");
    const after = await currentApprovedUnderstandingFacts(DB, PROJECT, ITEM);
    assert.equal(after, null, "old-interpretation field facts must not leak into the current version");
  } finally { raw.close(); }
});

// T6 -- the current governed resolver returns the field-level confirmed family.
test("T6. currentApprovedUnderstandingFacts returns the system-confirmed family with no whole-blob approval", async () => {
  const { raw, DB } = await setup();
  try {
    assert.equal(await currentApprovedUnderstandingFacts(DB, PROJECT, ITEM), null, "nothing governed before confirmation");
    await applyUnderstandingSystemFieldAutoApproval(DB, PROJECT, ITEM, CFG);
    const facts = await currentApprovedUnderstandingFacts(DB, PROJECT, ITEM);
    assert.equal(facts?.system?.value, "Fire Alarm");
    assert.equal(facts?.category?.value, "Detection Devices");
    assert.equal(facts?.productFamily?.value, "Duct Detector");
    const versions = raw.prepare("SELECT COUNT(*) c FROM estimator_understanding_review_versions WHERE boq_item_id=?").get(ITEM).c;
    assert.equal(versions, 0, "field authority never fabricates a whole-blob approval");
  } finally { raw.close(); }
});

// T7 -- the SLC classifier consumes the governed family.
test("T7. the SLC classifier consumes the governed family and reports the taxonomy reason", async () => {
  const governed = classifyFireAlarmSlcItem({ system: "Fire Alarm", family: "Duct Detector", attributes: {}, selectedQuantity: { value: 4 } });
  assert.equal(governed.state, "UNRESOLVED", "Duct Detector has no SLC pool mapping yet -- that is the next slice, not this one");
  assert.equal(governed.family, "Duct Detector", "the governed family is carried through, proving it was consumed");
  assert.equal(governed.slcRole, "SLC_FIELD_DEVICE", "it is recognised as a field device, not an unknown row");
  assert.match(governed.reason, /addressable evidence is required/, "the exact next missing fact is named: addressability");
  assert.doesNotMatch(governed.reason, /system and family are required/, "it must NOT report missing family when family is governed");
  // Positive control: a fully evidenced detector family resolves.
  const resolved = classifyFireAlarmSlcItem({ system: "Fire Alarm", family: "Addressable Smoke Detector", attributes: { addressing: "addressable" }, selectedQuantity: { value: 4 } });
  assert.equal(resolved.state, "SLC_DETECTOR_POOL");
  assert.equal(resolved.demandUnits, 4);
});

// T8 -- the point-demand bridge receives the resulting resource classification.
test("T8. point demand receives the SLC classification produced from the governed family", async () => {
  const classification = classifyFireAlarmSlcItem({ system: "Fire Alarm", family: "Addressable Smoke Detector", attributes: { addressing: "addressable" }, selectedQuantity: { value: 4 } });
  const profileRow = { profile: JSON.stringify({ boqItem: { slcResourceClassification: { ...classification, quantity: { value: 4, source: "BOQ", status: "VALID" } } } }) };
  const result = await produceProjectPreliminaryPointDemand({
    db: { prepare: () => ({ bind: () => ({ all: async () => ({ results: [{ id: "b1", description: "Duct detector", item_number: "C", system_value: "Fire Alarm", approved_for_downstream: 1, extraction_confidence: 95, review_status: "Approved", row_type: "BOQ Item" }] }) }) }) },
    projectId: PROJECT,
    loadCurrentProfile: async () => profileRow,
    loadApprovedUnderstanding: async () => ({ system: { value: "Fire Alarm" }, productFamily: { value: "Addressable Smoke Detector" }, attributes: {} }),
    currentSelectedQuantity: async () => ({ value: 4, source: "BOQ", status: "VALID" }),
  });
  assert.equal(result.knownPointDemand, 4, "quantity x governed detector semantics = demand");
  assert.equal(result.generatedFrom.populations[0].slcState, "SLC_DETECTOR_POOL");
});

// T11 -- a STALE whole-blob approval (bound to a superseded interpretation)
// no longer locks the current proposal out of the field path.
test("T11. a stale whole-blob approval does not block field confirmation of the current proposal", async () => {
  const { raw, DB } = await setup();
  try {
    // Approve the first interpretation through the real whole-blob writer.
    const { applyUnderstandingSystemAutoApproval } = await import("../worker/estimator-understanding-review-api.mjs");
    const first = await applyUnderstandingSystemAutoApproval(DB, PROJECT, ITEM, CFG);
    assert.equal(first.applied, true, "precondition: whole-blob approval lands");
    // The BOQ input changes and a new interpretation supersedes the first.
    raw.prepare("UPDATE boq_items SET description=? WHERE id=?").run("Duct detector unit", ITEM);
    seedInterpretation(raw, ITEM, "interp-duct-2", "run-duct-2", "Duct detector unit", "Duct Detector", "Detection Devices");
    const row = (await loadUnderstandingReviewRows(DB, PROJECT, { currentConfigFingerprint: CFG })).find((entry) => entry.boqItemId === ITEM);
    assert.notEqual(row.interpretationId, "interp-duct-1");
    // The stale approval yields nothing for the current version...
    assert.equal(await currentApprovedUnderstandingFacts(DB, PROJECT, ITEM), null);
    // ...but the field path now governs the current proposal instead of
    // refusing with WHOLE_BLOB_ALREADY_APPROVED.
    const outcome = await applyUnderstandingSystemFieldAutoApproval(DB, PROJECT, ITEM, CFG);
    assert.equal(outcome.applied, true, JSON.stringify(outcome));
    const facts = await currentApprovedUnderstandingFacts(DB, PROJECT, ITEM);
    assert.equal(facts?.productFamily?.value, "Duct Detector");
  } finally { raw.close(); }
});

// T12 -- a CURRENT whole-blob approval still skips the field path.
test("T12. a current whole-blob approval still skips field confirmation as redundant", async () => {
  const { raw, DB } = await setup();
  try {
    const { applyUnderstandingSystemAutoApproval } = await import("../worker/estimator-understanding-review-api.mjs");
    await applyUnderstandingSystemAutoApproval(DB, PROJECT, ITEM, CFG);
    const outcome = await applyUnderstandingSystemFieldAutoApproval(DB, PROJECT, ITEM, CFG);
    assert.equal(outcome.applied, false);
    assert.equal(outcome.code, "WHOLE_BLOB_ALREADY_APPROVED");
  } finally { raw.close(); }
});

// T13 -- wiring/material scope settles as NOT_SLC without a forced family.
test("T13. a cable category is NOT_SLC under either system, with no family invented", async () => {
  for (const system of ["Fire Alarm", "Electrical", null]) {
    const result = classifyFireAlarmSlcItem({ system, family: null, category: "Fire Resistant Cable", attributes: {}, selectedQuantity: { value: 1, source: "BOQ", status: "VALID" } });
    assert.equal(result.state, "NOT_SLC", "system=" + system);
    assert.equal(result.slcRole, "NOT_SLC");
    assert.equal(result.family, null, "no product family is forced onto a wiring row");
    assert.equal(result.unitsPerDevice, 0);
    assert.equal(result.demandUnits, 0);
    assert.match(result.reason, /wiring\/material scope/);
    assert.equal(result.provenance.slcRoleBasis, "WIRING_CATEGORY_RULE");
  }
});

// T14 -- the wiring rule is narrow: non-cable rows are unaffected.
test("T14. non-wiring categories still take the family path", async () => {
  const missing = classifyFireAlarmSlcItem({ system: "Fire Alarm", family: null, category: "Detector", attributes: {}, selectedQuantity: { value: 4 } });
  assert.equal(missing.state, "UNRESOLVED");
  assert.match(missing.reason, /system and family are required/);
  const detector = classifyFireAlarmSlcItem({ system: "Fire Alarm", family: "Addressable Smoke Detector", category: "Detector", attributes: { addressing: "addressable" }, selectedQuantity: { value: 4 } });
  assert.equal(detector.state, "SLC_DETECTOR_POOL");
});

// T15 -- a human EDITED family + addressing attribute on a proposal that
// carried neither resolves through the real chain to a detector pool.
// (Mechanism test for the project-scoped bare-smoke decision: the decision
// itself is human; this proves the governed machinery carries it faithfully.)
test("T15. human EDITED family and addressing on a familyless proposal reaches SLC_DETECTOR_POOL", async () => {
  const { raw, DB } = await setup();
  try {
    const row = (await loadUnderstandingReviewRows(DB, PROJECT, { currentConfigFingerprint: CFG })).find((entry) => entry.boqItemId === AMBIGUOUS_ITEM);
    const actor = "human-test-principal";
    const reason = "Human project decision (fixture equivalent): Fire Alarm scope rows with no conventional evidence are the addressable devices.";
    for (const [fieldKey, value] of [
      ["system", "Fire Alarm"],
      ["productFamily", "Addressable Smoke Detector"],
      ["attribute:addressing", "addressable"],
    ]) {
      const outcome = await recordUnderstandingFieldDecision(DB, {
        boqItemId: AMBIGUOUS_ITEM, projectId: PROJECT, interpretationId: row.interpretationId, fieldKey,
        decision: "EDITED", proposedValue: null,
        confirmedValue: { value, origin: "HUMAN_PROJECT_DECISION", confidence: 100 },
        sourceInputFingerprint: row.effective.currentInputFingerprint, reason, actorUserId: actor,
      });
      assert.equal(outcome.success, true, fieldKey + ": " + JSON.stringify(outcome));
    }
    const facts = await currentApprovedUnderstandingFacts(DB, PROJECT, AMBIGUOUS_ITEM);
    assert.equal(facts?.productFamily?.value, "Addressable Smoke Detector");
    const classified = classifyFireAlarmSlcItem({
      system: facts?.system?.value, family: facts?.productFamily?.value,
      attributes: { addressing: facts?.attributes?.addressing?.value },
      selectedQuantity: { value: 4, source: "BOQ", status: "VALID" },
    });
    assert.equal(classified.state, "SLC_DETECTOR_POOL");
    assert.equal(classified.demandUnits, 4);
    const writes = raw.prepare("SELECT COUNT(*) c FROM estimator_understanding_field_reviews WHERE boq_item_id=? AND reviewed_by=?").get(AMBIGUOUS_ITEM, actor).c;
    assert.equal(writes, 3, "all three facts carry the human actor, never a system identity");
  } finally { raw.close(); }
});

// T16 -- a GENERIC Interface Module stays unresolved even with addressability:
// monitor-vs-control refinement is a separate, evidence-backed decision.
test("T16. generic Interface Module never resolves to a pool without role refinement", async () => {
  const generic = classifyFireAlarmSlcItem({ system: "Fire Alarm", family: "Interface Module", attributes: { addressing: "addressable" }, selectedQuantity: { value: 16, source: "BOQ", status: "VALID" } });
  assert.equal(generic.state, "SLC_ROLE_ESTABLISHED", "generic interface + addressable gets role, never a pool");
  assert.equal(generic.demandUnits, null, "no consumption number without role refinement");
  assert.equal(generic.slcRole, "SLC_MODULE", "module role preserved for later refinement");
  const monitor = classifyFireAlarmSlcItem({ system: "Fire Alarm", family: "Monitor Module", attributes: { addressing: "addressable" }, selectedQuantity: { value: 16, source: "BOQ", status: "VALID" } });
  assert.equal(monitor.state, "SLC_MODULE_POOL");
  assert.equal(monitor.demandUnits, 16);
  assert.equal(monitor.family, "Monitor Module", "subtype preserved alongside the pool");
});

// T17 -- disputed concurrent changes are isolated from readiness totals.
test("T17. disputed families never leak into readiness buckets", async () => {
  const { isDisputedSlcFamily, partitionDisputedDemand, DISPUTE_STATUS } = await import("../app/domain/slc-dispute-freeze.mjs");
  assert.equal(DISPUTE_STATUS, "DISPUTED_CONCURRENT_CHANGE");
  for (const fam of ["Interface Module", "Pull Station", "Manual Call Point"]) {
    assert.equal(isDisputedSlcFamily(fam), true, fam + " is frozen");
  }
  assert.equal(isDisputedSlcFamily("Addressable Smoke Detector"), false);
  assert.equal(isDisputedSlcFamily(null), false);
  const buckets = partitionDisputedDemand([
    { family: "Interface Module", state: "NOT_SLC", demandUnits: 0 },
    { family: "Manual Call Point", state: "UNRESOLVED", demandUnits: null },
    { family: "Addressable Smoke Detector", state: "SLC_DETECTOR_POOL", demandUnits: 131 },
    { family: null, state: "UNRESOLVED", demandUnits: null },
  ]);
  assert.equal(buckets.disputed.populations, 2, "both disputed rows lifted out");
  assert.equal(buckets.detectorPool.units, 131, "governed demand untouched");
  assert.equal(buckets.unresolved.populations, 1, "only the genuinely unresolved row");
  assert.equal(buckets.notSlc.populations, 0, "a disputed NOT_SLC is not booked as settled zero");
});

// T9 -- missing/ambiguous family remains fail-closed.
test("T9. a missing family stays UNRESOLVED and contributes no known demand", async () => {
  const missing = classifyFireAlarmSlcItem({ system: null, family: null, attributes: {}, selectedQuantity: { value: 4 } });
  assert.equal(missing.state, "UNRESOLVED");
  assert.match(missing.reason, /system and family are required/);
  assert.equal(missing.demandUnits, null);
});

// T10 -- manufacturer/standards/compatibility are never auto-approved here.
test("T10. unverified manufacturer/standard/compatibility claims block whole-blob approval; the field path cannot write them", async () => {
  const base = {
    rawDescription: "Duct detector",
    boqItemSystemValue: "Fire Alarm",
    proposalState: "AVAILABLE",
    classificationBlockers: [],
    taxonomyValid: true,
  };
  const clean = {
    system: { value: "Fire Alarm" }, category: { value: "Detection Devices" }, productFamily: { value: "Duct Detector" },
    attributes: {}, manufacturerPreferences: [], compatibilityRequirements: [], requiredAccessories: [], standards: [], ambiguities: [], reviewReasons: [],
  };
  assert.equal(evaluateUnderstandingSystemAutoApproval({ ...base, interpretation: clean }).eligible, true);
  for (const listName of ["manufacturerPreferences", "compatibilityRequirements", "requiredAccessories", "standards"]) {
    const tainted = { ...clean, [listName]: [{ value: "x" }] };
    const result = evaluateUnderstandingSystemAutoApproval({ ...base, interpretation: tainted });
    assert.equal(result.eligible, false, listName + " must block auto-approval");
    assert.ok(result.reasons.some((r) => r === "UNVERIFIED_CLAIM_PRESENT:" + listName));
  }
  // And the field writer only ever iterates the 3 classification keys.
  const { raw, DB } = await setup();
  try {
    await applyUnderstandingSystemFieldAutoApproval(DB, PROJECT, ITEM, CFG);
    const keys = raw.prepare("SELECT DISTINCT field_key FROM estimator_understanding_field_reviews WHERE boq_item_id=?").all(ITEM).map((r) => r.field_key).sort();
    assert.deepEqual(keys, ["category", "productFamily", "system"]);
  } finally { raw.close(); }
});
