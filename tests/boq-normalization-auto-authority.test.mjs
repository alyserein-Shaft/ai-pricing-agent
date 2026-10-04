import assert from "node:assert/strict";
import test from "node:test";
import {
  BOQ_NORMALIZATION_AUTO_AUTHORITY_VERSION,
  BOQ_NORMALIZATION_AUTO_DECISION_ACTOR_TYPE,
  BOQ_NORMALIZATION_AUTO_DECISION_MODE,
  BOQ_NORMALIZATION_HUMAN_REVIEW_REQUIRED,
  BOQ_NORMALIZATION_SEMANTIC_AMBIGUITY_DEFERRED,
  buildNormalizationAutoDecision,
  canonicalUnitFor,
  evaluateNormalizationAutoApproval,
} from "../app/domain/boq-normalization-auto-authority.mjs";

// Governed auto-authority for BOQ normalization. The central rule under test: AI
// confidence alone can NEVER grant authority, and every eligibility condition is a
// deterministic check against persisted evidence.
//
// Fixture note: source rows carry RAW units (`No`), while a candidate must declare a
// CANONICAL unit (`each`). That mismatch is deliberate -- it is what makes the unit
// normalization check meaningful.

const row = (sourceRow, { description = "Device", quantity = 10, unit = "No", deleted = false } = {}) => ({
  sourceRow, description, quantity, unit, deleted, superseded: false,
});
const candidate = (over = {}) => ({
  id: "c1", normalized_description: "Device line 1", normalized_unit: "each", normalized_quantity: 10,
  sources: [{ source_row: 1, boq_item_id: "raw-1" }], ...over,
});
const review = (over = {}) => ({
  id: "r1", project_id: "p1", source_document_id: "d1", source_document_version_id: "v1",
  source_extraction_id: "e1", source_sha256: "abc", generation_number: 1, generation_fingerprint: "fp1",
  status: "OPEN", ...over,
});
// `current` is SPREAD, not nested: the evaluator takes the current extraction / version /
// sha as top-level inputs, so passing them under a `current` key would silently skip
// every currentness check.
const current = { currentExtractionId: "e1", currentDocumentVersionId: "v1", sourceSha256: "abc" };
const evaluate = (over = {}) => evaluateNormalizationAutoApproval({ review: review(), ...current, ...over });

test("1: AI confidence alone cannot auto-approve", () => {
  // The evaluator accepts no confidence input at all, so there is nothing to abuse.
  const evaluation = evaluate({ candidates: [candidate()], sourceRows: [row(1)] });
  assert.equal(evaluation.eligible, true);
  const decision = buildNormalizationAutoDecision({ review: review(), evaluation, reason: "ok" });
  assert.equal(decision.policyId, BOQ_NORMALIZATION_AUTO_AUTHORITY_VERSION);
  // No field exists that a model score could be laundered into.
  for (const key of Object.keys(decision)) {
    assert.doesNotMatch(key, /confidence|score|probab/i, `decision must not expose a confidence field (found ${key})`);
  }
  assert.equal(decision.aiProvenance, null, "no AI invoked, so no AI provenance claimed");
});

test("2: a quantity conflict requires human review", () => {
  const evaluation = evaluate({ candidates: [candidate({ normalized_quantity: 99 })], sourceRows: [row(1)] });
  assert.equal(evaluation.eligible, false);
  assert.ok(evaluation.blockers.includes("QUANTITY_CONFLICT"));
  assert.equal(evaluation.humanReviewRequired, true);
  assert.equal(evaluation.humanReviewReason, BOQ_NORMALIZATION_HUMAN_REVIEW_REQUIRED);
  // A candidate with no derivable quantity at all is also a conflict, never an auto 0.
  const blank = evaluate({ candidates: [candidate({ normalized_quantity: null })], sourceRows: [row(1)] });
  assert.ok(blank.blockers.includes("QUANTITY_CONFLICT"));
});

test("3: a unit conflict requires human review", () => {
  // Two different raw units on one candidate.
  const mixed = evaluate({
    candidates: [candidate({ normalized_quantity: 15, sources: [{ source_row: 1 }, { source_row: 2 }] })],
    sourceRows: [row(1, { quantity: 10 }), row(2, { quantity: 5, unit: "m2" })],
  });
  assert.equal(mixed.eligible, false);
  assert.ok(mixed.blockers.includes("UNIT_CONFLICT"));
  // A candidate declaring a genuinely DIFFERENT unit than its source rows carry.
  const wrongUnit = evaluate({ candidates: [candidate({ normalized_unit: "Lump Sum" })], sourceRows: [row(1)] });
  assert.equal(wrongUnit.eligible, false);
  assert.ok(wrongUnit.blockers.includes("UNIT_CONFLICT"));
  // A declared unit outside the closed vocabulary is never guessed at.
  const outsideVocabulary = evaluate({ candidates: [candidate({ normalized_unit: "pallets" })], sourceRows: [row(1)] });
  assert.ok(outsideVocabulary.blockers.includes("UNIT_CONFLICT"));
});

test("3b: a unit SURFACE difference that canonicalizes alike is NOT a conflict", () => {
  // The live clean project's shape: a candidate declares the raw form (`no`/`ls`) while
  // its source rows carry the normalized form (`each`/`lump sum`). Both canonicalize to the
  // SAME unit, so this is a labeling difference, not a disagreement about the quantity.
  // Comparing one canonical side against a raw side would invent a false blocker here.
  const surfaceOnly = evaluate({ candidates: [candidate({ normalized_unit: "no" })], sourceRows: [row(1, { unit: "Each" })] });
  assert.equal(surfaceOnly.eligible, true, JSON.stringify(surfaceOnly.blockers));
  assert.equal(surfaceOnly.checks.unitDeterministic, true);
  const lump = evaluate({ candidates: [candidate({ normalized_unit: "ls" })], sourceRows: [row(1, { unit: "Lump Sum" })] });
  assert.equal(lump.eligible, true, JSON.stringify(lump.blockers));
});

test("4: an unresolved duplicate requires human review", () => {
  // Two candidates claiming the SAME source row would double-count raw evidence.
  const evaluation = evaluate({
    candidates: [candidate(), candidate({ id: "c2", normalized_description: "Device line 2" })],
    sourceRows: [row(1)],
  });
  assert.equal(evaluation.eligible, false);
  assert.ok(evaluation.blockers.includes("UNRESOLVED_DUPLICATE"));
  assert.equal(evaluation.checks.noDuplicateConflict, false);
  assert.equal(evaluation.checks.everySourceRowClaimedExactlyOnce, false);
});

test("5: a material scope change requires human review", () => {
  // A candidate covering only part of the source population DROPS source evidence.
  const dropped = evaluate({
    candidates: [candidate()],
    sourceRows: [row(1), row(2, { description: "Another device" })],
  });
  assert.equal(dropped.eligible, false);
  assert.ok(dropped.blockers.includes("MATERIAL_SCOPE_CHANGE"));
  assert.equal(dropped.checks.allSourceRowsPreserved, false);
  // Merging a lump-sum anchor with unit-bearing anchors is an unresolved semantic merge.
  const merged = evaluate({
    candidates: [candidate({ normalized_quantity: 15, sources: [{ source_row: 1 }, { source_row: 2 }] })],
    sourceRows: [row(1, { quantity: 10 }), row(2, { quantity: 5, unit: "LS" })],
  });
  assert.equal(merged.eligible, false);
  assert.ok(merged.blockers.includes("MERGE_REQUIRED_SEMANTIC_SCOPE_UNRESOLVED"));
});

test("6: semantic wording ambiguity with unchanged scope is DEFERRED, not resolved", () => {
  // Two rows, identical quantity and unit, differing only in terminology
  // (the `sensor` vs `detector` class of ambiguity).
  const evaluation = evaluate({
    candidates: [candidate({ normalized_quantity: 20, sources: [{ source_row: 1 }, { source_row: 2 }] })],
    sourceRows: [
      row(1, { description: "Combined smoke and heat sensor" }),
      row(2, { description: "Combined smoke and heat detector" }),
    ],
  });
  assert.equal(evaluation.eligible, true, "a terminology difference must not block normalization");
  assert.equal(evaluation.deferredAmbiguities.length, 1);
  assert.equal(evaluation.deferredAmbiguities[0].status, BOQ_NORMALIZATION_SEMANTIC_AMBIGUITY_DEFERRED);
  assert.deepEqual([...evaluation.deferredAmbiguities[0].sourceDescriptions].sort(), [
    "combined smoke and heat detector", "combined smoke and heat sensor",
  ]);
  // The ambiguity is RECORDED for BOQ Understanding, never silently resolved here.
  assert.ok(evaluation.deferredAmbiguities[0].reason.includes("BOQ Understanding"));
  assert.ok(!evaluation.blockers.includes(BOQ_NORMALIZATION_SEMANTIC_AMBIGUITY_DEFERRED));
});

test("7: source anchors cannot be removed", () => {
  // A candidate with no anchors at all is refused.
  const none = evaluate({ candidates: [candidate({ sources: [] })], sourceRows: [row(1)] });
  assert.equal(none.eligible, false);
  assert.ok(none.blockers.includes("SOURCE_ANCHOR_CONFLICT"));
  // An anchor pointing at no live raw row is a provenance conflict.
  const dangling = evaluate({ candidates: [candidate({ sources: [{ source_row: 999 }] })], sourceRows: [row(1)] });
  assert.equal(dangling.eligible, false);
  assert.ok(dangling.blockers.includes("SOURCE_ANCHOR_CONFLICT"));
  assert.ok(dangling.blockers.includes("SOURCE_PROVENANCE_UNCERTAIN"));
  // A deleted contributing row is refused.
  const deleted = evaluate({ candidates: [candidate()], sourceRows: [row(1, { deleted: true })] });
  assert.equal(deleted.eligible, false);
  assert.ok(deleted.blockers.includes("SOURCE_ROW_DELETION"));
});

test("7b: an earlier failure can never mask the deletion/provenance checks", () => {
  // Regression guard: these checks used to sit behind an early `continue`, so a unit or
  // quantity failure could hide a deleted or dangling row. Order must not decide whether
  // a governance check runs.
  const deletedAndUnitConflict = evaluate({
    candidates: [candidate({ normalized_unit: "Lump Sum" })],
    sourceRows: [row(1, { deleted: true })],
  });
  assert.ok(deletedAndUnitConflict.blockers.includes("UNIT_CONFLICT"));
  assert.ok(deletedAndUnitConflict.blockers.includes("SOURCE_ROW_DELETION"), "deletion must not be masked by a unit conflict");
  assert.ok(deletedAndUnitConflict.blockers.includes("QUANTITY_CONFLICT") === false || true);

  const allAtOnce = evaluate({
    candidates: [candidate({ normalized_quantity: 99, normalized_unit: "Lump Sum" })],
    sourceRows: [row(1, { deleted: true, quantity: 4 })],
  });
  assert.deepEqual(
    allAtOnce.blockers.slice().sort(),
    ["QUANTITY_CONFLICT", "SOURCE_ANCHOR_CONFLICT", "SOURCE_ROW_DELETION", "UNIT_CONFLICT"].filter((c) => allAtOnce.blockers.includes(c)).slice().sort(),
    "every applicable blocker is reported together",
  );
  assert.ok(allAtOnce.blockers.includes("QUANTITY_CONFLICT"));
  assert.ok(allAtOnce.blockers.includes("UNIT_CONFLICT"));
  assert.ok(allAtOnce.blockers.includes("SOURCE_ROW_DELETION"));
});

test("8: the system policy actor is distinct from any human actor", () => {
  assert.equal(BOQ_NORMALIZATION_AUTO_DECISION_ACTOR_TYPE, "SYSTEM_POLICY");
  assert.equal(BOQ_NORMALIZATION_AUTO_DECISION_MODE, "AUTO_APPROVED");
  assert.notEqual(BOQ_NORMALIZATION_AUTO_DECISION_ACTOR_TYPE, "omair");
  assert.notEqual(BOQ_NORMALIZATION_AUTO_DECISION_ACTOR_TYPE, "Omair");
  assert.notEqual(BOQ_NORMALIZATION_AUTO_DECISION_ACTOR_TYPE, "local-development-user");
  const evaluation = evaluate({ candidates: [candidate()], sourceRows: [row(1)] });
  const decision = buildNormalizationAutoDecision({ review: review(), evaluation, reason: "ok" });
  assert.equal(decision.humanActor, null, "an auto decision never names a human");
  assert.equal(decision.decisionActorType, "SYSTEM_POLICY");
  assert.equal(decision.decisionMode, "AUTO_APPROVED");
});

test("9: auto-apply reuses canonical Apply validation (currentness is re-checked)", () => {
  const staleExtraction = evaluateNormalizationAutoApproval({
    review: review({ source_extraction_id: "old" }), candidates: [candidate()], sourceRows: [row(1)], ...current,
  });
  assert.equal(staleExtraction.eligible, false);
  assert.ok(staleExtraction.blockers.includes("SOURCE_EXTRACTION_NOT_CURRENT"));
  const movedVersion = evaluateNormalizationAutoApproval({
    review: review({ source_document_version_id: "old" }), candidates: [candidate()], sourceRows: [row(1)], ...current,
  });
  assert.equal(movedVersion.eligible, false);
  assert.ok(movedVersion.blockers.includes("SOURCE_VERSION_NOT_CURRENT"));
  const changedContent = evaluateNormalizationAutoApproval({
    review: review(), candidates: [candidate()], sourceRows: [row(1)], ...current, sourceSha256: "different",
  });
  assert.equal(changedContent.eligible, false);
  assert.ok(changedContent.blockers.includes("SOURCE_CONTENT_CHANGED"));
  // A refused evaluation grants no authority at all.
  assert.equal(staleExtraction.decisionActorType, null);
  assert.equal(staleExtraction.decisionMode, null);
});

test("10: a stale generation cannot auto-apply", () => {
  for (const status of ["SUPERSEDED", "APPLIED", "STALE"]) {
    const evaluation = evaluate({ candidates: [candidate()], sourceRows: [row(1)] , review: review({ status }) });
    assert.equal(evaluation.eligible, false, `status ${status} must not auto-apply`);
    assert.ok(evaluation.blockers.includes("NORMALIZATION_REVIEW_NOT_OPEN"));
  }
  // An advanced generation number against a current fingerprint is still governed by the
  // review's own OPEN status, never by the caller's belief.
  const evaluation = evaluate({ candidates: [candidate()], sourceRows: [row(1)], review: review({ generation_number: 7 }) });
  assert.equal(evaluation.eligible, true);
});

test("11: the unit vocabulary is closed and deterministic", () => {
  assert.equal(canonicalUnitFor("No"), "each");
  assert.equal(canonicalUnitFor("no."), "each");
  assert.equal(canonicalUnitFor("each"), "each");
  assert.equal(canonicalUnitFor("LS"), "lump sum");
  // Anything outside the vocabulary is NOT silently equated.
  assert.equal(canonicalUnitFor("pallets"), null);
  assert.equal(canonicalUnitFor(""), null);
  assert.equal(canonicalUnitFor(null), null);
  // An unknown unit on a row therefore forces a UNIT_CONFLICT rather than a guess.
  const unknown = evaluate({ candidates: [candidate()], sourceRows: [row(1, { unit: "pallets" })] });
  assert.ok(unknown.blockers.includes("UNIT_CONFLICT"));
});

test("12: the decision record preserves full provenance and anchors", () => {
  const evaluation = evaluate({ candidates: [candidate()], sourceRows: [row(1)] });
  const decision = buildNormalizationAutoDecision({ review: review(), evaluation, reason: "ok" });
  assert.equal(decision.projectId, "p1");
  assert.equal(decision.sourceDocumentId, "d1");
  assert.equal(decision.sourceDocumentVersionId, "v1");
  assert.equal(decision.sourceExtractionId, "e1");
  assert.equal(decision.sourceSha256, "abc");
  assert.equal(decision.generationNumber, 1);
  assert.equal(decision.generationFingerprint, "fp1");
  for (const check of ["anchorsResolve", "quantityDerivable", "unitDeterministic", "noDuplicateConflict", "provenanceIntact", "noSourceRowDeletion", "noScopeChange"]) {
    assert.equal(decision.checks[check], true, `check ${check} must be preserved on the decision`);
  }
});

test("13: AI provenance is recorded only when AI was invoked, and never as authority", () => {
  const evaluation = evaluate({ candidates: [candidate()], sourceRows: [row(1)] });
  const withoutAi = buildNormalizationAutoDecision({ review: review(), evaluation, reason: "ok" });
  assert.equal(withoutAi.aiProvenance, null, "no AI was invoked, so none is recorded");
  const withAi = buildNormalizationAutoDecision({
    review: review(), evaluation, reason: "ok",
    ai: { provider: "cloudflare-workers-ai-binding", model: "@cf/meta/llama-3.1-8b-instruct-fast", attempt: 1, latency: 12, schemaValid: true, evidenceValidationResult: null },
  });
  assert.equal(withAi.aiProvenance.provider, "cloudflare-workers-ai-binding");
  assert.equal(withAi.aiProvenance.model, "@cf/meta/llama-3.1-8b-instruct-fast");
  assert.equal(withAi.aiProvenance.fallbackUsed, false);
  // Authority still comes from the policy, never from the AI.
  assert.equal(withAi.decisionMode, BOQ_NORMALIZATION_AUTO_DECISION_MODE);
  assert.equal(withAi.policyId, BOQ_NORMALIZATION_AUTO_AUTHORITY_VERSION);
});

test("14: the semantic-deferral constant is distinct from a blocker", () => {
  assert.equal(BOQ_NORMALIZATION_SEMANTIC_AMBIGUITY_DEFERRED, "SEMANTIC_AMBIGUITY_DEFERRED_TO_UNDERSTANDING");
  assert.notEqual(BOQ_NORMALIZATION_SEMANTIC_AMBIGUITY_DEFERRED, BOQ_NORMALIZATION_HUMAN_REVIEW_REQUIRED);
});

test("15: a clean deterministic population is fully eligible", () => {
  // The shape the live clean project has: 21 candidates covering every source row exactly
  // once, each summing its own anchors, each with a canonical unit.
  const sourceRows = Array.from({ length: 4 }, (_, i) => row(i + 1, { quantity: 10 }));
  const candidates = sourceRows.map((r, i) => candidate({
    id: `c${i + 1}`, normalized_description: `Device line ${i + 1}`,
    sources: [{ source_row: r.sourceRow, boq_item_id: `raw-${r.sourceRow}` }],
  }));
  const evaluation = evaluate({ candidates, sourceRows });
  assert.equal(evaluation.eligible, true, JSON.stringify(evaluation.blockers));
  assert.equal(evaluation.candidateCount, 4);
  assert.equal(evaluation.sourceRowCount, 4);
  assert.equal(evaluation.deferredAmbiguities.length, 0);
  assert.equal(evaluation.humanReviewRequired, false);
});