import test from "node:test";
import assert from "node:assert/strict";
import {
  shapeProjectStatus,
  shapeBoqItemContext,
  shapeRequirementProfile,
  shapeProductMatchingStatus,
  classifyItemReference,
  detectItemReferenceInQuestion,
  detectQuestionIntent,
  resolveItemReference,
  containsOutOfScopeClaim,
  containsInternalFieldNameLeak,
  detectSelfContradiction,
  detectRequirementProfileContradiction,
  detectProductMatchingContradiction,
  buildAuthoritativeAnswerFacts,
  runAgentTurn,
  buildAgentPrompt,
  buildExplanationPrompt,
  validateAgentStep,
  validateFinalResponse,
  AGENT_DECISION_SCHEMA,
  ANSWER_EXPLANATION_SCHEMA,
  RECOMMENDED_ACTION_TYPES,
  TOOL_REGISTRY,
  CLAIM_CAPABILITIES,
  UNSUPPORTED_ITEM_CAPABILITIES,
  QUESTION_INTENTS,
  INTENT_REQUIRED_CAPABILITIES,
  RESPONSE_STATUSES,
  SUBJECT_STATUSES,
  EVIDENCE_SCOPES,
  MAX_STEPS,
} from "../app/domain/ai-presales-agent-engine.mjs";
import { derivePresalesWorkflow } from "../app/domain/presales-workflow-engine.mjs";

// Phase A1 Slice 1+2+2.1+2.2+3+3.1: pure domain tests. No DB, no network --
// scripted stub providers stand in for Workers AI so the LOOP's own
// bounded, grounded behavior is proven deterministically here; real-model
// evidence is gathered separately against the live Workers AI binding.
//
// Slice 3.1 (fact/explanation separation): the model no longer supplies
// responseStatus, subjectStatus, blockers, missingRequirements, conflicts,
// staleness, recommendedNextAction.actionType, or references AT ALL -- see
// buildAuthoritativeAnswerFacts/buildFinalAnswer in the engine. The answer-
// provider stub scripts below now return the NARROW explanation shape
// {summary, findingsText, explanation, recommendedNextActionText} instead
// of the old full FINAL_RESPONSE shape -- this is the actual, current
// contract answerProvider.interpret() is called against.

const stubProvider = (steps) => {
  let call = 0;
  return {
    metadata: { provider: "stub", model: "stub-model", modelVersion: "stub-model" },
    interpret: async () => {
      const step = steps[Math.min(call, steps.length - 1)];
      call += 1;
      if (step instanceof Error) throw step;
      return typeof step === "function" ? step() : step;
    },
  };
};
// A decision-only provider: never needs answer content in its script since
// a rejected/ungrounded ANSWER decision never reaches the content-fetch call.
const stubDecisionProvider = stubProvider;
// An answer-content (explanation) provider: its script items are bare
// ANSWER_EXPLANATION shapes -- exactly what answerProvider.interpret
// returns in the real architecture now.
const stubAnswerProvider = stubProvider;

// Decision-step shorthand -- every decision argument object always carries
// both fields (Slice 3).
const callTool = (toolName, args = {}) => ({ action: "CALL_TOOL", toolName, arguments: { itemReference: null, itemId: null, ...args } });
const answerDecision = () => ({ action: "ANSWER", arguments: { itemReference: null, itemId: null } });

// A minimal, always-valid explanation shape for tests that don't care
// about the specific prose, only that a legitimate one is accepted.
const explanationAnswer = (overrides = {}) => ({
  summary: "s",
  findingsText: [],
  explanation: "",
  recommendedNextActionText: "",
  ...overrides,
});

const realWorkflow = (overrides = {}) => derivePresalesWorkflow({
  project: { id: "p1", name: "Test", organizationId: "org1", systemDomain: "Fire Alarm" },
  facts: { documents: 3, classified: 3, boqItems: 5, requirementProfiles: 5, matchedItems: 2, ...overrides },
});

// ============================================================
// Section 2: shapeProjectStatus reshapes derivePresalesWorkflow's REAL
// output -- never recomputes readiness itself.
// ============================================================

test("shapeProjectStatus reshapes the real derivePresalesWorkflow output without recomputing readiness", () => {
  const workflow = realWorkflow();
  const shaped = shapeProjectStatus("p1", workflow);
  assert.equal(shaped.projectId, "p1");
  assert.equal(shaped.currentPhase, workflow.workflowStage);
  assert.equal(shaped.documentStatus, workflow.stages.find((s) => s.id === "intake").status);
  assert.equal(shaped.requirementStatus, workflow.stages.find((s) => s.id === "requirements").status);
  assert.equal(shaped.productSelectionStatus, workflow.stages.find((s) => s.id === "selection").status);
  assert.equal(shaped.pricingStatus, workflow.stages.find((s) => s.id === "supplier").status);
  assert.equal(shaped.quotationStatus, workflow.stages.find((s) => s.id === "quotation").status);
  assert.deepEqual(shaped.blockers, workflow.blockers.map((b) => ({ stageId: b.stageId, stage: b.stage, message: b.message })));
});

test("shapeProjectStatus refuses to fabricate a shape from a missing project id or workflow", () => {
  assert.throws(() => shapeProjectStatus(null, realWorkflow()));
  assert.throws(() => shapeProjectStatus("p1", null));
});

test("the tool registry contains exactly the four tools this slice authorizes, with the right argumentKind per tool", () => {
  assert.deepEqual(Object.keys(TOOL_REGISTRY), ["get_project_status", "get_boq_item_context", "get_requirement_profile", "get_product_matching_status"]);
  assert.equal(TOOL_REGISTRY.get_project_status.scopeType, "PROJECT");
  assert.equal(TOOL_REGISTRY.get_project_status.argumentKind, "NONE");
  assert.equal(TOOL_REGISTRY.get_boq_item_context.scopeType, "BOQ_ITEM");
  assert.equal(TOOL_REGISTRY.get_boq_item_context.argumentKind, "ITEM_REFERENCE");
  assert.equal(TOOL_REGISTRY.get_requirement_profile.scopeType, "BOQ_ITEM");
  assert.equal(TOOL_REGISTRY.get_requirement_profile.argumentKind, "ITEM_ID");
  assert.equal(TOOL_REGISTRY.get_product_matching_status.scopeType, "BOQ_ITEM");
  assert.equal(TOOL_REGISTRY.get_product_matching_status.argumentKind, "ITEM_ID");
});

// ============================================================
// Slice 2.2/3/4: the claim-capability model.
// ============================================================
test("CLAIM_CAPABILITIES declares exactly the categories each tool can support, and never declares an unsupported item capability", () => {
  assert.deepEqual(CLAIM_CAPABILITIES.get_project_status, [
    "PROJECT_PHASE", "PROJECT_NEXT_ACTION", "PROJECT_BLOCKER", "PROJECT_DOCUMENT_STATUS",
    "PROJECT_REQUIREMENT_STATUS", "PROJECT_PRODUCT_SELECTION_STATUS", "PROJECT_PRICING_STATUS", "PROJECT_QUOTATION_STATUS",
  ]);
  assert.deepEqual(CLAIM_CAPABILITIES.get_boq_item_context, [
    "ITEM_IDENTITY", "ITEM_DESCRIPTION", "ITEM_BOQ_QUANTITY", "ITEM_SELECTED_QUANTITY",
    "ITEM_SELECTED_QUANTITY_SOURCE", "ITEM_SYSTEM", "ITEM_FAMILY", "ITEM_REVIEW_STATUS",
  ]);
  assert.deepEqual(CLAIM_CAPABILITIES.get_requirement_profile, [
    "ITEM_REQUIREMENT_PROFILE", "ITEM_REQUIRED_ATTRIBUTES", "ITEM_REQUIREMENT_CONFLICT",
    "ITEM_REQUIREMENT_MISSING", "ITEM_REQUIREMENT_STALE", "ITEM_REQUIREMENT_REVIEW_STATUS",
  ]);
  assert.deepEqual(CLAIM_CAPABILITIES.get_product_matching_status, [
    "ITEM_MATCHING_STATUS", "ITEM_MATCH_RUN", "ITEM_MATCH_STALE", "ITEM_CANDIDATE_COUNT",
    "ITEM_CANDIDATE_STATUS", "ITEM_MATCH_FAILURE_REASON", "ITEM_MATCH_MISSING_EVIDENCE", "ITEM_SELECTED_CANDIDATE_STATE",
  ]);
  for (const unsupported of UNSUPPORTED_ITEM_CAPABILITIES) {
    assert.equal(CLAIM_CAPABILITIES.get_boq_item_context.includes(unsupported), false, `${unsupported} must never be claimed as a get_boq_item_context capability`);
    assert.equal(CLAIM_CAPABILITIES.get_requirement_profile.includes(unsupported), false, `${unsupported} must never be claimed as a get_requirement_profile capability`);
    assert.equal(CLAIM_CAPABILITIES.get_product_matching_status.includes(unsupported), false, `${unsupported} must never be claimed as a get_product_matching_status capability`);
  }
  assert.deepEqual(UNSUPPORTED_ITEM_CAPABILITIES, [
    "ITEM_TECHNICAL_ELIGIBILITY", "ITEM_SAFETY_STATUS", "ITEM_PRICE_STATUS", "ITEM_PRICE_ELIGIBILITY",
    "ITEM_FINAL_TECHNICAL_APPROVAL", "ITEM_COMMERCIAL_READINESS", "ITEM_PRODUCT_REJECTION_REASON",
    "ITEM_SPEC_REQUIREMENTS", "ITEM_DRAWING_EVIDENCE",
  ], "Slice 4: ITEM_MATCHING_STATUS moved OUT of this list -- get_product_matching_status genuinely supports it now");
});

// ============================================================
// Slice 2.2/3, Section 3/5: question intent -- small, deterministic.
// ============================================================
test("detectQuestionIntent classifies the brief's own example questions correctly, including Slice 3's two intents and Slice 4's new matching intent", () => {
  assert.equal(detectQuestionIntent("Why isn't BOQ item 28.19 ready?"), "ITEM_READINESS_REASON");
  assert.equal(detectQuestionIntent("What is blocking item 28.19?"), "ITEM_READINESS_REASON");
  assert.equal(detectQuestionIntent("Why isn't item 28.19 ready for product selection?"), "ITEM_READINESS_REASON");
  assert.equal(detectQuestionIntent("What quantity are we using for item 28.19?"), "ITEM_QUANTITY");
  assert.equal(detectQuestionIntent("What requirements apply to item 28.19?"), "ITEM_REQUIREMENTS");
  assert.equal(detectQuestionIntent("What conflicts exist for item 28.19?"), "ITEM_REQUIREMENT_CONFLICTS");
  assert.equal(detectQuestionIntent("What do we know about item 28.19?"), "ITEM_INFORMATION");
  assert.equal(detectQuestionIntent("Tell me about item ABC-999"), "ITEM_INFORMATION");
  assert.equal(detectQuestionIntent("What is blocking this project?"), "PROJECT_BLOCKERS");
  assert.equal(detectQuestionIntent("What should I work on next?"), "PROJECT_NEXT_ACTION");
  assert.equal(detectQuestionIntent("Are we ready to quote?"), "PROJECT_STATUS");
  assert.equal(detectQuestionIntent("What's the weather like?"), "UNKNOWN");
  // Slice 4, Section 11: "why isn't item X matched" is a DIFFERENT intent
  // from "why isn't item X ready" -- the old readiness phrasing is
  // deliberately unaffected (Slice 4's own brief: "Do NOT change that
  // architecture").
  assert.equal(detectQuestionIntent("Why isn't item 28.20 matched?"), "ITEM_MATCHING_STATUS");
  assert.equal(detectQuestionIntent("Are there any compatible products for item 28.20?"), "ITEM_MATCHING_STATUS");
  assert.equal(detectQuestionIntent("Why was candidate IDP-PHOTO-IV rejected for item 28.20?"), "ITEM_MATCHING_STATUS");
  assert.equal(detectQuestionIntent("Which candidates need review for item 28.20?"), "ITEM_MATCHING_STATUS");
  assert.equal(detectQuestionIntent("Has a product been selected for item 28.20?"), "ITEM_MATCHING_STATUS");
});

test("QUESTION_INTENTS and INTENT_REQUIRED_CAPABILITIES cover exactly the intents this slice authorizes, and ITEM_READINESS_REASON/ITEM_MATCHING_STATUS require the correct tool-call evidence (never a permanently-unsatisfiable capability)", () => {
  assert.deepEqual(QUESTION_INTENTS, [
    "PROJECT_STATUS", "PROJECT_BLOCKERS", "PROJECT_NEXT_ACTION",
    "ITEM_INFORMATION", "ITEM_QUANTITY", "ITEM_READINESS_REASON",
    "ITEM_REQUIREMENTS", "ITEM_REQUIREMENT_CONFLICTS", "ITEM_MATCHING_STATUS", "ITEM_REFERENCE_LOOKUP", "UNKNOWN",
  ]);
  assert.deepEqual(Object.keys(INTENT_REQUIRED_CAPABILITIES).sort(), [...QUESTION_INTENTS].sort());
  assert.deepEqual(INTENT_REQUIRED_CAPABILITIES.ITEM_READINESS_REASON, ["ITEM_REQUIREMENT_PROFILE"], "unchanged from Slice 3.1 -- 'why isn't it ready' never requires matching evidence");
  assert.deepEqual(INTENT_REQUIRED_CAPABILITIES.ITEM_REQUIREMENTS, ["ITEM_REQUIREMENT_PROFILE"]);
  assert.deepEqual(INTENT_REQUIRED_CAPABILITIES.ITEM_REQUIREMENT_CONFLICTS, ["ITEM_REQUIREMENT_CONFLICT"]);
  assert.deepEqual(INTENT_REQUIRED_CAPABILITIES.ITEM_MATCHING_STATUS, ["ITEM_REQUIREMENT_PROFILE", "ITEM_MATCHING_STATUS"]);
  assert.equal(
    CLAIM_CAPABILITIES.get_requirement_profile.includes("ITEM_REQUIREMENT_PROFILE"),
    true,
    "get_requirement_profile must actually be able to satisfy the capability ITEM_READINESS_REASON now requires",
  );
  assert.equal(
    CLAIM_CAPABILITIES.get_product_matching_status.includes("ITEM_MATCHING_STATUS"),
    true,
    "get_product_matching_status must actually be able to satisfy the capability ITEM_MATCHING_STATUS now requires",
  );
});

// ============================================================
// Section 8: the initial (decision) prompt never includes full project state.
// ============================================================
test("the initial prompt (no tool results yet) contains no real project state, only the question and tool catalogue metadata", () => {
  const prompt = buildAgentPrompt({ question: "What is blocking this project?", toolResults: [] });
  assert.match(prompt.user, /"question":"What is blocking this project\?"/);
  assert.match(prompt.user, /get_project_status/);
  assert.match(prompt.user, /get_requirement_profile/);
  assert.match(prompt.user, /"toolResults":\[\]/, "no tool has run yet, so the tool-results array must be empty");
  assert.doesNotMatch(prompt.user, /"projectId"|"currentPhase"|"documentStatus"/, "no actual tool RESULT field must appear before any tool has executed");
});

test("a prompt built after a tool call includes that tool's real result", () => {
  const result = shapeProjectStatus("p1", realWorkflow());
  const prompt = buildAgentPrompt({ question: "q", toolResults: [{ toolName: "get_project_status", result }] });
  assert.match(prompt.user, new RegExp(result.currentPhase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

// ============================================================
// Slice 3.1, Section 1/2: AUTHORITATIVE ANSWER FACTS -- pure, deterministic,
// built only from real tool results. This is the core deliverable this
// slice adds.
// ============================================================
const shapedItem = () => shapeBoqItemContext(boqItem(), { selectedQuantity: { value: 24, source: "BOQ" } });
const foundResult = (projectId = "p1") => ({ found: true, projectId, item: shapedItem() });
const notFoundResult = (candidateReference, projectId = "p1") => ({ found: false, projectId, reason: "ITEM_NOT_FOUND", candidateReference });
const ambiguousResult = (candidateReference, projectId = "p1") => ({ found: false, projectId, reason: "ITEM_REFERENCE_AMBIGUOUS", candidateReference });
const foundRequirementProfile = (overrides = {}) => ({
  found: true, projectId: "p1", itemId: shapedItem().itemId, profileVersionId: "reqprofile_1", stale: false,
  system: "Fire Alarm", family: "Detector", readinessStatus: "Ready for Matching",
  requirements: [{ name: "Protocol", value: "Addressable", status: "Confirmed", sourceTypes: ["Specification"] }],
  missingRequirements: [], conflicts: [], reviewStatus: "Completed", blockers: [],
  ...overrides,
});
const requirementProfileNotFound = () => ({ found: false, projectId: "p1", itemId: shapedItem().itemId, reason: "REQUIREMENT_PROFILE_NOT_FOUND" });

test("buildAuthoritativeAnswerFacts: a CLEAN profile on a readiness question yields zero blockers, the product-selection capability gap, and actionType REVIEW_PRODUCT_MATCHING", () => {
  const toolResults = [
    { toolName: "get_boq_item_context", result: foundResult() },
    { toolName: "get_requirement_profile", result: foundRequirementProfile() },
  ];
  const aaf = buildAuthoritativeAnswerFacts({ questionIntent: "ITEM_READINESS_REASON", toolResults, missingCapabilities: [] });
  assert.deepEqual(aaf.blockers, []);
  assert.deepEqual(aaf.missingRequirements, []);
  assert.deepEqual(aaf.conflicts, []);
  assert.equal(aaf.capabilityGaps.length, 1);
  assert.match(aaf.capabilityGaps[0], /product-selection readiness/i);
  assert.equal(aaf.recommendedAction.actionType, "REVIEW_PRODUCT_MATCHING");
  assert.equal(aaf.responseStatus, "GROUNDED");
  assert.equal(aaf.subjectStatus, null);
  assert.equal(aaf.facts.profileStale, false);
});

test("buildAuthoritativeAnswerFacts: a BLOCKED profile (missing requirement + conflict) yields exactly those two blockers, no more, no less, and actionType RESOLVE_REQUIREMENT_CONFLICT", () => {
  const toolResults = [
    { toolName: "get_boq_item_context", result: foundResult() },
    { toolName: "get_requirement_profile", result: foundRequirementProfile({
      missingRequirements: ["Panel Compatibility"],
      conflicts: [{ attribute: "Voltage", type: "Required Value Conflict", values: [{ value: "24V", unit: "V", sourceType: "BOQ" }, { value: "12V", unit: "V", sourceType: "Drawing" }], technicalImpact: "x", blocking: true }],
    }) },
  ];
  const aaf = buildAuthoritativeAnswerFacts({ questionIntent: "ITEM_READINESS_REASON", toolResults, missingCapabilities: [] });
  assert.equal(aaf.blockers.length, 2);
  assert.match(aaf.blockers[0], /Missing technical requirement: Panel Compatibility/);
  assert.match(aaf.blockers[1], /Requirement conflict on Voltage/);
  assert.match(aaf.blockers[1], /BOQ: 24V/);
  assert.match(aaf.blockers[1], /Drawing: 12V/);
  assert.equal(aaf.recommendedAction.actionType, "RESOLVE_REQUIREMENT_CONFLICT");
});

test("buildAuthoritativeAnswerFacts: a STALE profile yields the recalculation blocker and actionType RECALCULATE_REQUIREMENT_PROFILE, taking priority over any other blocker", () => {
  const toolResults = [
    { toolName: "get_boq_item_context", result: foundResult() },
    { toolName: "get_requirement_profile", result: foundRequirementProfile({ stale: true, missingRequirements: ["Panel Compatibility"] }) },
  ];
  const aaf = buildAuthoritativeAnswerFacts({ questionIntent: "ITEM_READINESS_REASON", toolResults, missingCapabilities: [] });
  assert.match(aaf.blockers[0], /needs recalculation/);
  assert.equal(aaf.facts.profileStale, true);
  assert.equal(aaf.recommendedAction.actionType, "RECALCULATE_REQUIREMENT_PROFILE");
});

test("buildAuthoritativeAnswerFacts: fields not proven by any tool this turn stay honestly null, never guessed", () => {
  const aaf = buildAuthoritativeAnswerFacts({ questionIntent: "UNKNOWN", toolResults: [], missingCapabilities: [] });
  assert.equal(aaf.entity.type, null);
  assert.equal(aaf.facts.system, null);
  assert.equal(aaf.facts.profileStale, null);
  assert.deepEqual(aaf.blockers, []);
  assert.equal(aaf.recommendedAction.actionType, "NONE");
});

test("buildAuthoritativeAnswerFacts: a project question with real project blockers surfaces them verbatim as blockers, and actionType RESOLVE_PROJECT_BLOCKERS", () => {
  const shaped = shapeProjectStatus("p1", realWorkflow());
  const toolResults = [{ toolName: "get_project_status", result: shaped }];
  const aaf = buildAuthoritativeAnswerFacts({ questionIntent: "PROJECT_BLOCKERS", toolResults, missingCapabilities: [] });
  assert.deepEqual(aaf.blockers, shaped.blockers.map((b) => b.message));
  assert.equal(aaf.recommendedAction.actionType, shaped.blockers.length ? "RESOLVE_PROJECT_BLOCKERS" : "NONE");
});

test("buildAuthoritativeAnswerFacts: responseStatus is GROUNDED only when no capability is missing, PARTIAL otherwise -- never decided by the model", () => {
  const clean = buildAuthoritativeAnswerFacts({ questionIntent: "ITEM_QUANTITY", toolResults: [{ toolName: "get_boq_item_context", result: foundResult() }], missingCapabilities: [] });
  assert.equal(clean.responseStatus, "GROUNDED");
  const gapped = buildAuthoritativeAnswerFacts({ questionIntent: "ITEM_READINESS_REASON", toolResults: [{ toolName: "get_boq_item_context", result: foundResult() }], missingCapabilities: ["ITEM_REQUIREMENT_PROFILE"] });
  assert.equal(gapped.responseStatus, "PARTIAL");
  assert.match(gapped.capabilityGaps[0], /No technical requirement profile/);
});

// ============================================================
// Slice 3.1, Section 4: internal-field-name leak detection.
// ============================================================
test("containsInternalFieldNameLeak catches raw camelCase tool-result key names echoed as prose, but not ordinary English", () => {
  assert.equal(containsInternalFieldNameLeak(["missingRequirements", "stale"]), true, "the exact live bug: blockers=['missingRequirements','stale']");
  assert.equal(containsInternalFieldNameLeak(["The profileStale flag is true."]), true);
  assert.equal(containsInternalFieldNameLeak(["reviewStatus is Approved."]), true);
  assert.equal(containsInternalFieldNameLeak(["The item's review status is Approved."]), false, "plain English must never be flagged");
  assert.equal(containsInternalFieldNameLeak(["The requirement profile is stale."]), false, "the plain word 'stale' alone is legitimate prose");
});

// ============================================================
// Section 5: explicit server-side step validation.
// ============================================================
test("validateAgentStep rejects an ANSWER attempted before any tool executed this turn", () => {
  assert.throws(() => validateAgentStep(answerDecision(), { groundedThisTurn: false }), /Answer attempted before any tool/);
});

test("validateAgentStep rejects an unregistered tool name", () => {
  assert.throws(() => validateAgentStep(callTool("delete_project"), { groundedThisTurn: false }), /Unregistered tool/);
});

test("validateAgentStep rejects a step missing the now-mandatory arguments object", () => {
  assert.throws(() => validateAgentStep({ action: "CALL_TOOL", toolName: "get_project_status" }, { groundedThisTurn: false }), /requires a structured arguments object/);
});

test("validateAgentStep rejects get_project_status called with a non-null itemReference", () => {
  assert.throws(() => validateAgentStep(callTool("get_project_status", { itemReference: "28.19" }), { groundedThisTurn: false }), /takes no item/);
});

test("validateAgentStep rejects get_boq_item_context called with an empty itemReference when no question-level reference is available either", () => {
  assert.throws(() => validateAgentStep(callTool("get_boq_item_context"), { groundedThisTurn: false }), /requires a non-empty arguments.itemReference/);
  const validated = validateAgentStep(callTool("get_boq_item_context", { itemReference: "28.19" }), { groundedThisTurn: false });
  assert.deepEqual(validated, { action: "CALL_TOOL", toolName: "get_boq_item_context", arguments: { itemReference: "28.19", itemId: null } });
});

test("validateAgentStep falls back to the question's own detected item reference only when the model left itemReference blank -- a non-empty model value is never overridden", () => {
  const filledFromBlank = validateAgentStep(callTool("get_boq_item_context"), { groundedThisTurn: false, questionItemReference: "28.19" });
  assert.deepEqual(filledFromBlank, { action: "CALL_TOOL", toolName: "get_boq_item_context", arguments: { itemReference: "28.19", itemId: null } });

  const modelValuePreserved = validateAgentStep(callTool("get_boq_item_context", { itemReference: "28.20" }), { groundedThisTurn: false, questionItemReference: "28.19" });
  assert.deepEqual(modelValuePreserved, { action: "CALL_TOOL", toolName: "get_boq_item_context", arguments: { itemReference: "28.20", itemId: null } });
});

test("validateAgentStep passes through a null/empty itemReference for get_requirement_profile without throwing, and relabels a real one into the internal itemId field", () => {
  const withNull = validateAgentStep(callTool("get_requirement_profile"), { groundedThisTurn: false });
  assert.deepEqual(withNull, { action: "CALL_TOOL", toolName: "get_requirement_profile", arguments: { itemReference: null, itemId: null } });
  const validated = validateAgentStep(callTool("get_requirement_profile", { itemReference: "boqitem_x" }), { groundedThisTurn: false });
  assert.deepEqual(validated, { action: "CALL_TOOL", toolName: "get_requirement_profile", arguments: { itemReference: null, itemId: "boqitem_x" } });
});

// ============================================================
// Slice 3.1, Section 10: validateFinalResponse now checks the SERVER'S OWN
// merged output (defensive assertion), not raw model output.
// ============================================================
test("validateFinalResponse accepts a well-formed server-merged answer and rejects a malformed recommendedNextAction/facts/subjectStatus", () => {
  const good = {
    summary: "s", responseStatus: "GROUNDED", subjectStatus: null,
    facts: { entityType: null, itemId: null, itemReference: null, projectId: null, system: null, family: null, itemReviewStatus: null, profileStale: null, readinessStatus: null, requirementReviewStatus: null, selectedQuantity: null, selectedQuantitySource: null },
    findings: [], blockers: [], recommendedNextAction: { actionType: "NONE", label: "" }, references: [],
  };
  assert.deepEqual(validateFinalResponse(good), good);
  assert.throws(() => validateFinalResponse({ ...good, subjectStatus: "NOT_A_REAL_SUBJECT_STATUS" }));
  assert.throws(() => validateFinalResponse({ ...good, facts: null }), /facts is invalid/);
  assert.throws(() => validateFinalResponse({ ...good, recommendedNextAction: "just a string now" }), /recommendedNextAction is invalid/);
  assert.throws(() => validateFinalResponse({ ...good, recommendedNextAction: { actionType: "NOT_A_REAL_ACTION_TYPE", label: "x" } }), /recommendedNextAction is invalid/);
});

test("RESPONSE_STATUSES and SUBJECT_STATUSES are two SEPARATE closed vocabularies -- the pre-2.2 overloaded single status enum is gone", () => {
  assert.deepEqual(RESPONSE_STATUSES, ["GROUNDED", "PARTIAL", "FAILED_SAFE"]);
  assert.deepEqual(SUBJECT_STATUSES, ["READY", "NEEDS_REVIEW", "BLOCKED", "STALE"]);
  assert.equal(RESPONSE_STATUSES.some((s) => SUBJECT_STATUSES.includes(s)), false, "the two vocabularies must never overlap, or the ambiguity Section 6 fixes would return");
});

test("RECOMMENDED_ACTION_TYPES is the closed, server-owned action-type vocabulary", () => {
  assert.deepEqual(RECOMMENDED_ACTION_TYPES, [
    "RECALCULATE_REQUIREMENT_PROFILE", "RESOLVE_REQUIREMENT_CONFLICT", "REVIEW_MISSING_REQUIREMENTS",
    "REVIEW_PRODUCT_MATCHING", "RUN_PRODUCT_MATCHING", "RERUN_PRODUCT_MATCHING", "REVIEW_PRODUCT_CANDIDATES",
    "RESOLVE_PROJECT_BLOCKERS", "NONE",
  ]);
});

// ============================================================
// Slice 2.2, Section 5: self-consistency invariants (pure function).
// ============================================================
test("detectSelfContradiction rejects 'review is pending/missing' when reviewStatus is Approved, and 'quantity unknown' when a selected quantity was returned", () => {
  const approvedItem = { found: true, item: { reviewStatus: "Approved", selectedQuantity: 24, selectedQuantitySource: "BOQ" } };
  assert.ok(detectSelfContradiction(["The item's review is pending."], approvedItem));
  assert.ok(detectSelfContradiction(["Awaiting review before proceeding."], approvedItem));
  assert.ok(detectSelfContradiction(["The selected quantity is unknown."], approvedItem));
  assert.ok(detectSelfContradiction(["Drawing quantity is governing here."], approvedItem));
  assert.equal(detectSelfContradiction(["Item 28.19 is a Dome Camera, quantity 24, Approved."], approvedItem), null);
  assert.equal(detectSelfContradiction(["This tool set does not yet expose readiness evidence."], approvedItem), null);
});

test("detectSelfContradiction never fires without a real FOUND item result (e.g. a project-only question, or a not-found/ambiguous result)", () => {
  assert.equal(detectSelfContradiction(["review is pending"], null), null);
  assert.equal(detectSelfContradiction(["review is pending"], { found: false }), null);
});

// ============================================================
// Slice 3, Section 2/3: shapeRequirementProfile -- pure, reads only fields
// buildTechnicalRequirementProfile already computed.
// ============================================================
const profileRow = (overrides = {}) => ({ id: "reqprofile_1", readiness_status: "Missing Critical Information", status: "Needs Review", ...overrides });
const parsedProfileFixture = (overrides = {}) => ({
  boqItem: { system: "Fire Alarm", productFamily: "Detector" },
  consolidatedRequirements: [
    { key: "Protocol", normalizedRequirement: "Protocol", attributes: [{ name: "Protocol", normalizedValue: "Addressable" }], sources: [{ sourceType: "Specification", source: {} }] },
    { key: "Voltage", normalizedRequirement: "Voltage", attributes: [{ name: "Voltage", normalizedValue: "24V" }, { name: "Voltage", normalizedValue: "12V" }], sources: [{ sourceType: "BOQ", source: {} }, { sourceType: "Drawing", source: {} }] },
    { key: "Panel Compatibility", normalizedRequirement: "Panel Compatibility", attributes: [], sources: [{ sourceType: "Specification", source: {} }] },
  ],
  missingInformation: [{ field: "Panel Compatibility", whyNeeded: "Required for safe matching." }],
  conflicts: [{ attribute: "Voltage", type: "Required Value Conflict", values: [{ value: "24V", unit: "V", source: { sourceType: "BOQ" } }, { value: "12V", unit: "V", source: { sourceType: "Drawing" } }], technicalImpact: "Cannot match safely.", blocking: true }],
  readiness: { status: "Missing Critical Information", blockingReasons: ["Panel Compatibility is required."] },
  ...overrides,
});

test("shapeRequirementProfile returns the engine's own readiness.status/blockingReasons directly, and derives requirement status only by set membership against missingInformation/conflicts", () => {
  const shaped = shapeRequirementProfile(profileRow(), { parsedProfile: parsedProfileFixture(), stale: false });
  assert.equal(shaped.profileVersionId, "reqprofile_1");
  assert.equal(shaped.stale, false);
  assert.equal(shaped.system, "Fire Alarm");
  assert.equal(shaped.family, "Detector");
  assert.equal(shaped.readinessStatus, "Missing Critical Information");
  assert.equal(shaped.reviewStatus, "Needs Review");
  assert.deepEqual(shaped.blockers, ["Panel Compatibility is required."]);
  assert.deepEqual(shaped.missingRequirements, ["Panel Compatibility"]);
  assert.equal(shaped.conflicts.length, 1);
  assert.equal(shaped.conflicts[0].attribute, "Voltage");
  assert.deepEqual(shaped.conflicts[0].values.map((v) => v.sourceType), ["BOQ", "Drawing"]);

  const protocolReq = shaped.requirements.find((r) => r.name === "Protocol");
  assert.equal(protocolReq.value, "Addressable");
  assert.equal(protocolReq.status, "Confirmed");
  assert.deepEqual(protocolReq.sourceTypes, ["Specification"]);

  const voltageReq = shaped.requirements.find((r) => r.name === "Voltage");
  assert.equal(voltageReq.status, "Conflict", "Voltage appears in conflicts -- status must reflect that, not Confirmed");
  assert.deepEqual(voltageReq.sourceTypes, ["BOQ", "Drawing"]);

  const panelReq = shaped.requirements.find((r) => r.name === "Panel Compatibility");
  assert.equal(panelReq.status, "Missing", "Panel Compatibility appears in missingInformation -- status must reflect that");
  assert.equal(panelReq.value, null, "no attributes exist for a missing requirement -- value must be honestly null, never guessed");
});

test("shapeRequirementProfile refuses to fabricate a shape from a missing profile row", () => {
  assert.throws(() => shapeRequirementProfile(null, { parsedProfile: {} }));
  assert.throws(() => shapeRequirementProfile({}, { parsedProfile: {} }));
});

// ============================================================
// Slice 3/3.1, Section 13/7: requirement-profile self-consistency
// invariants, now including the REVERSE stale direction (Slice 3.1).
// ============================================================
test("detectRequirementProfileContradiction rejects claiming a conflict exists when the profile reports none, claiming the profile is current when it is stale, claiming it is stale when it is not, and asserting a value for a missing requirement", () => {
  const cleanProfile = { found: true, stale: false, conflicts: [], missingRequirements: [] };
  assert.ok(detectRequirementProfileContradiction(["A conflict exists between BOQ and Drawing."], cleanProfile));
  assert.equal(detectRequirementProfileContradiction(["No conflicts were found."], cleanProfile), null);
  assert.ok(detectRequirementProfileContradiction(["This requirement profile is stale."], cleanProfile), "Slice 3.1 Section 7: the reverse direction -- a non-stale profile must not be claimed stale");
  assert.equal(detectRequirementProfileContradiction(["This requirement profile is not stale."], cleanProfile), null);

  const staleProfile = { found: true, stale: true, conflicts: [], missingRequirements: [] };
  assert.ok(detectRequirementProfileContradiction(["This requirement profile is current."], staleProfile));
  assert.equal(detectRequirementProfileContradiction(["This profile is stale and not current -- recalculate first."], staleProfile), null);

  const missingProtocol = { found: true, stale: false, conflicts: [], missingRequirements: ["Protocol"] };
  assert.ok(detectRequirementProfileContradiction(["Protocol is Addressable."], missingProtocol));
  assert.equal(detectRequirementProfileContradiction(["Protocol is a missing requirement."], missingProtocol), null, "stating that a field IS missing must never itself be flagged as asserting its value");
});

test("detectRequirementProfileContradiction never fires without a real FOUND requirement profile result", () => {
  assert.equal(detectRequirementProfileContradiction(["a conflict exists"], null), null);
  assert.equal(detectRequirementProfileContradiction(["a conflict exists"], { found: false }), null);
});

// ============================================================
// Slice 3.1, Section 3/10: the EXPLANATION prompt -- narrow, shows only
// server-decided facts, never the raw camelCase facts object.
// ============================================================
test("buildExplanationPrompt shows the model server-decided facts/blockers/capabilityGaps/recommendedAction as plain-language lines, never raw camelCase keys, and includes a corrective notice when supplied", () => {
  const aaf = buildAuthoritativeAnswerFacts({
    questionIntent: "ITEM_READINESS_REASON",
    toolResults: [{ toolName: "get_boq_item_context", result: foundResult() }, { toolName: "get_requirement_profile", result: foundRequirementProfile({ missingRequirements: ["Panel Compatibility"] }) }],
    missingCapabilities: [],
  });
  const prompt = buildExplanationPrompt({ question: "Why isn't BOQ item 28.19 ready?", aaf });
  assert.match(prompt.user, /Missing technical requirement: Panel Compatibility/);
  assert.doesNotMatch(prompt.user, /"profileStale":|"reviewStatus":|"readinessStatus":/, "the raw camelCase facts object must never be dumped into the prompt -- only pre-rendered plain-language lines");
  assert.match(prompt.user, /decidedFacts/);
  assert.match(prompt.user, /recommendedAction/);

  const withNotice = buildExplanationPrompt({ question: "q", aaf, correctiveNotice: "fix this" });
  assert.match(withNotice.user, /"correctiveNotice":"fix this"/);
});

// ============================================================
// Section 5: explicit server-side step validation (schema sanity).
// ============================================================
test("AGENT_DECISION_SCHEMA and ANSWER_EXPLANATION_SCHEMA are valid, strict JSON Schema objects, and the explanation schema carries no factual field", () => {
  assert.equal(AGENT_DECISION_SCHEMA.additionalProperties, false);
  assert.deepEqual(AGENT_DECISION_SCHEMA.properties.action.enum, ["CALL_TOOL", "ANSWER"]);
  assert.deepEqual(AGENT_DECISION_SCHEMA.properties.toolName.enum, ["get_project_status", "get_boq_item_context", "get_requirement_profile", "get_product_matching_status"]);
  assert.equal(AGENT_DECISION_SCHEMA.properties.answer, undefined, "the decision schema must never embed the full answer schema -- that combination is what broke ANSWER completions live");
  assert.deepEqual(AGENT_DECISION_SCHEMA.required, ["action", "arguments"]);
  assert.deepEqual(AGENT_DECISION_SCHEMA.properties.arguments.required, ["itemReference"], "Slice 3: exactly one shared wire field -- a second field broke live reliability, see the comment above AGENT_STEP_ARGUMENTS_SCHEMA");

  assert.equal(ANSWER_EXPLANATION_SCHEMA.additionalProperties, false);
  assert.deepEqual(ANSWER_EXPLANATION_SCHEMA.required.sort(), ["explanation", "findingsText", "recommendedNextActionText", "summary"].sort());
  for (const factual of ["responseStatus", "subjectStatus", "blockers", "references", "missingRequirements", "conflicts"]) {
    assert.equal(ANSWER_EXPLANATION_SCHEMA.properties[factual], undefined, `${factual} must never be a model-facing field -- it is server-owned now`);
  }
});

test("MAX_STEPS is unchanged from Slice 1, never loosened", () => {
  assert.equal(MAX_STEPS, 4);
});

// ============================================================
// Phase A1 Slice 2: entity-scope grounding.
// ============================================================

const boqItem = (overrides = {}) => ({
  id: "boqitem_11111111-1111-1111-1111-111111111111",
  item_number: "28.19",
  sequence: 42,
  description: "Ceiling Mounted Dome Camera",
  numeric_quantity: "24",
  original_quantity: "24",
  system_value: "CCTV",
  subcategory: "Dome Camera",
  category: "Cameras",
  review_status: "Approved",
  ...overrides,
});

test("EVIDENCE_SCOPES declares exactly PROJECT and BOQ_ITEM", () => {
  assert.deepEqual(EVIDENCE_SCOPES, ["PROJECT", "BOQ_ITEM"]);
});

// Section 3: item-reference classification and resolution.
test("classifyItemReference recognizes an internal id, a Row N reference, and treats everything else as an item number", () => {
  assert.deepEqual(classifyItemReference("boqitem_11111111-1111-1111-1111-111111111111"), { kind: "ID", value: "boqitem_11111111-1111-1111-1111-111111111111" });
  assert.deepEqual(classifyItemReference("Row 12"), { kind: "ROW", value: 12 });
  assert.deepEqual(classifyItemReference("row 12"), { kind: "ROW", value: 12 });
  assert.deepEqual(classifyItemReference("28.19"), { kind: "ITEM_NUMBER", value: "28.19" });
  assert.equal(classifyItemReference(""), null);
  assert.equal(classifyItemReference(null), null);
});

test("resolveItemReference matches by the correct tier only -- never a cross-tier guess", () => {
  const items = [boqItem(), boqItem({ id: "boqitem_2", item_number: "28.20", sequence: 43 })];
  assert.equal(resolveItemReference("28.19", items).matches.length, 1);
  assert.equal(resolveItemReference("28.19", items).matches[0].id, boqItem().id);
  assert.equal(resolveItemReference("Row 43", items).matches.length, 1);
  assert.equal(resolveItemReference("Row 43", items).matches[0].item_number, "28.20");
  assert.equal(resolveItemReference("boqitem_2", items).matches.length, 1);
  assert.equal(resolveItemReference("does-not-exist", items).matches.length, 0);
});

test("resolveItemReference honestly reports an ambiguous reference (>1 match) rather than guessing", () => {
  const items = [boqItem(), boqItem({ id: "boqitem_dup", item_number: "28.19", sequence: 99 })];
  const { matches } = resolveItemReference("28.19", items);
  assert.equal(matches.length, 2, "a real duplicate item_number must surface as 2 matches, never silently pick one");
});

// Section 5: detecting whether a QUESTION itself names a specific item.
test("detectItemReferenceInQuestion finds a dotted item number, an explicit 'item X' phrase, and a 'row N' phrase", () => {
  assert.equal(detectItemReferenceInQuestion("Why isn't BOQ item 28.19 ready?"), "28.19");
  assert.equal(detectItemReferenceInQuestion("What quantity are we using for item 28.19?"), "28.19");
  assert.equal(detectItemReferenceInQuestion("Tell me about item ABC-that-does-not-exist"), "ABC-that-does-not-exist");
  assert.equal(detectItemReferenceInQuestion("What about row 12?"), "12");
});

test("detectItemReferenceInQuestion returns null for a genuinely project-level question", () => {
  assert.equal(detectItemReferenceInQuestion("What is blocking this project?"), null);
  assert.equal(detectItemReferenceInQuestion("What should I work on next?"), null);
  assert.equal(detectItemReferenceInQuestion("Are we ready to quote?"), null);
});

// Section 2: shapeBoqItemContext -- honest nulls, no inference.
test("shapeBoqItemContext reshapes a real item row into the compact contract, preferring the approved understanding fact but falling back honestly", () => {
  const shaped = shapeBoqItemContext(boqItem(), { selectedQuantity: { value: 22, source: "Drawing" }, approvedSystem: null, approvedFamily: null });
  assert.equal(shaped.itemId, boqItem().id);
  assert.equal(shaped.itemReference, "28.19");
  assert.equal(shaped.boqQuantity, 24);
  assert.equal(shaped.selectedQuantity, 22);
  assert.equal(shaped.selectedQuantitySource, "Drawing");
  assert.equal(shaped.system, "CCTV");
  assert.equal(shaped.family, "Dome Camera");
  assert.equal(shaped.reviewStatus, "Approved");
});

test("shapeBoqItemContext falls back to 'Row N' when item_number is null, and returns null honestly for genuinely absent system/family", () => {
  const shaped = shapeBoqItemContext(boqItem({ item_number: null, system_value: null, subcategory: null, category: null }));
  assert.equal(shaped.itemReference, "Row 42");
  assert.equal(shaped.system, null);
  assert.equal(shaped.family, null);
});

test("shapeBoqItemContext refuses to fabricate a shape from a missing item row", () => {
  assert.throws(() => shapeBoqItemContext(null));
  assert.throws(() => shapeBoqItemContext({}));
});

// Section 6: the concrete, achievable capability-boundary vocabulary check.
test("containsOutOfScopeClaim catches the exact real Slice-1 failure phrase and its topic-area variants, plus Slice 3's product-selection-decision phrases", () => {
  assert.equal(containsOutOfScopeClaim(["BOQ item 28.19 lacks eligible current price evidence."]), true);
  assert.equal(containsOutOfScopeClaim(["Item 28.19 is technically eligible."]), true);
  assert.equal(containsOutOfScopeClaim(["1 safety block(s) remain open."]), true);
  assert.equal(containsOutOfScopeClaim(["Matching failed for this item."]), true);
  assert.equal(containsOutOfScopeClaim(["Product X is selected for this item."]), true);
  assert.equal(containsOutOfScopeClaim(["Item 28.19 is identified as Dome Camera with quantity 24."]), false);
  assert.equal(containsOutOfScopeClaim(["This tool set does not yet expose product-selection readiness."]), false);
});

// ============================================================
// Slice 3.1, Section 2/3/10: full-loop proof that FACTS are server-owned --
// no matter what the model's prose says, the final answer's blockers/
// responseStatus/subjectStatus/references/recommendedNextAction.actionType
// are exactly what the tools proved.
// ============================================================

test("Full loop: even if the model's explanation prose falsely claims a conflict/stale/missing-value, the FINAL answer's blockers/facts stay exactly what the tools proved -- the bad sentence is dropped, never causes a turn failure", async () => {
  const decisionProvider = stubDecisionProvider([
    callTool("get_boq_item_context", { itemReference: "28.19" }),
    callTool("get_requirement_profile", { itemReference: shapedItem().itemId }),
    answerDecision(),
  ]);
  // A CLEAN profile, but the model's prose lies in every possible way at once.
  const answerProvider = stubAnswerProvider([
    explanationAnswer({
      summary: "This requirement profile is stale and has a conflict.",
      findingsText: ["A conflict exists between BOQ and Drawing.", "This requirement profile is stale.", "missingRequirements"],
      explanation: "The profile is stale.",
      recommendedNextActionText: "Product X is selected for this item.",
    }),
  ]);
  const toolExecutors = {
    get_boq_item_context: async () => foundResult(),
    get_requirement_profile: async () => foundRequirementProfile(), // clean: stale:false, no missing, no conflicts
  };
  const outcome = await runAgentTurn({ question: "Why isn't BOQ item 28.19 ready?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED", "a bad model explanation must never fail the whole turn now -- it is filtered, not retried/rejected");
  assert.deepEqual(outcome.answer.blockers, [], "blockers are 100% server-owned -- the model's fabricated conflict/stale claims can never appear here");
  assert.equal(outcome.answer.facts.profileStale, false);
  assert.equal(outcome.answer.responseStatus, "GROUNDED");
  assert.equal(outcome.answer.subjectStatus, null);
  // Every piece of prose the model supplied was unsafe (leaked field name,
  // stale/conflict contradiction, out-of-scope claim) -- all dropped, so the
  // server's own fallback summary is used instead.
  assert.doesNotMatch(outcome.answer.summary, /\bmissingRequirements\b/);
  assert.doesNotMatch(outcome.answer.summary, /is stale/);
  assert.doesNotMatch(outcome.answer.summary, /conflict exists/);
  assert.equal(outcome.answer.findings.some((f) => /missingRequirements/.test(f)), false);
  assert.equal(outcome.answer.recommendedNextAction.actionType, "REVIEW_PRODUCT_MATCHING", "actionType can never be changed by the model's prose");
});

test("Full loop: safe, accurate model prose IS kept and merged into the final summary/findings", async () => {
  const decisionProvider = stubDecisionProvider([
    callTool("get_boq_item_context", { itemReference: "28.19" }),
    callTool("get_requirement_profile", { itemReference: shapedItem().itemId }),
    answerDecision(),
  ]);
  const answerProvider = stubAnswerProvider([
    explanationAnswer({
      summary: "The Panel Compatibility requirement still needs to be supplied by the engineer before matching can proceed.",
      findingsText: ["The Voltage requirement is contested between the BOQ and the drawing."],
      explanation: "",
      recommendedNextActionText: "Please confirm the correct panel compatibility spec.",
    }),
  ]);
  const toolExecutors = {
    get_boq_item_context: async () => foundResult(),
    get_requirement_profile: async () => foundRequirementProfile({ missingRequirements: ["Panel Compatibility"] }),
  };
  const outcome = await runAgentTurn({ question: "Why isn't BOQ item 28.19 ready?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED");
  assert.match(outcome.answer.summary, /Panel Compatibility requirement still needs to be supplied/);
  assert.equal(outcome.answer.findings.includes("The Voltage requirement is contested between the BOQ and the drawing."), true);
  assert.equal(outcome.answer.recommendedNextAction.label, "Please confirm the correct panel compatibility spec.", "a safe rephrasing of the same actionType's meaning IS kept");
  assert.equal(outcome.answer.recommendedNextAction.actionType, "REVIEW_MISSING_REQUIREMENTS");
});

test("Full loop: references are built exclusively from real tool results -- the model has no field to supply or fabricate one with at all", async () => {
  const decisionProvider = stubDecisionProvider([callTool("get_boq_item_context", { itemReference: "28.19" }), answerDecision()]);
  const answerProvider = stubAnswerProvider([explanationAnswer()]);
  const toolExecutors = { get_boq_item_context: async () => foundResult() };
  const outcome = await runAgentTurn({ question: "What do we know about item 28.19?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED");
  assert.deepEqual(outcome.answer.references, [{ type: "BOQ_ITEM", projectId: "p1", itemId: shapedItem().itemId, itemReference: "28.19" }]);
});

test("Full loop: subjectStatus is always null, server-decided -- there is no longer any model field that could set it otherwise", async () => {
  const decisionProvider = stubDecisionProvider([callTool("get_project_status"), answerDecision()]);
  const answerProvider = stubAnswerProvider([explanationAnswer({ summary: "The project has open blockers." })]);
  const toolExecutors = { get_project_status: async () => shapeProjectStatus("p1", realWorkflow()) };
  const outcome = await runAgentTurn({ question: "What is blocking this project?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED");
  assert.equal(outcome.answer.subjectStatus, null);
});

test("Full loop: a malformed explanation response (wrong shape) retries once, then fails safely -- this is the only remaining retry trigger", async () => {
  const decisionProvider = stubDecisionProvider([callTool("get_project_status"), answerDecision()]);
  const answerProvider = stubAnswerProvider([{ notTheRightShape: true }, { alsoWrong: true }]);
  const toolExecutors = { get_project_status: async () => shapeProjectStatus("p1", realWorkflow()) };
  const outcome = await runAgentTurn({ question: "What is blocking this project?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "FAILED_SAFE");
  assert.equal(outcome.reason, "MALFORMED_MODEL_OUTPUT");
  assert.equal(outcome.diagnostics.modelCalls, 4, "CALL_TOOL decision + ANSWER decision + two failed explanation attempts");
});

test("Full loop: a malformed explanation shape recovers on the corrective retry", async () => {
  const decisionProvider = stubDecisionProvider([callTool("get_project_status"), answerDecision()]);
  const answerProvider = stubAnswerProvider([{ notTheRightShape: true }, explanationAnswer()]);
  const toolExecutors = { get_project_status: async () => shapeProjectStatus("p1", realWorkflow()) };
  const outcome = await runAgentTurn({ question: "What is blocking this project?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED");
});

// ============================================================
// Section 11 (Slice 2.2) / Section 12 (Slice 3.1): the brief's own
// explicit negative-validation set -- now proven at the FACT level
// (buildAuthoritativeAnswerFacts), since content-quality issues in model
// prose no longer fail the turn, only get filtered (see the two "Full
// loop" tests above for that guarantee).
// ============================================================
test("Section 12 negative tests: the server never lets a fact the tools disprove into blockers/facts, regardless of question phrasing", () => {
  const nonStale = buildAuthoritativeAnswerFacts({ questionIntent: "ITEM_READINESS_REASON", toolResults: [{ toolName: "get_requirement_profile", result: foundRequirementProfile({ stale: false }) }], missingCapabilities: [] });
  assert.equal(nonStale.facts.profileStale, false, "server truth: non-stale tool result -> facts.profileStale must be false, never true");

  const noConflict = buildAuthoritativeAnswerFacts({ questionIntent: "ITEM_REQUIREMENT_CONFLICTS", toolResults: [{ toolName: "get_requirement_profile", result: foundRequirementProfile({ conflicts: [] }) }], missingCapabilities: [] });
  assert.deepEqual(noConflict.conflicts, [], "server truth: no conflict -> conflicts must stay empty");

  const noMissing = buildAuthoritativeAnswerFacts({ questionIntent: "ITEM_REQUIREMENTS", toolResults: [{ toolName: "get_requirement_profile", result: foundRequirementProfile({ missingRequirements: [] }) }], missingCapabilities: [] });
  assert.deepEqual(noMissing.missingRequirements, [], "server truth: no missing requirement -> missingRequirements must stay empty");

  const approvedReview = buildAuthoritativeAnswerFacts({ questionIntent: "ITEM_INFORMATION", toolResults: [{ toolName: "get_boq_item_context", result: foundResult() }], missingCapabilities: [] });
  assert.equal(approvedReview.facts.itemReviewStatus, "Approved", "server truth: Approved review status is exposed exactly as the tool returned it, never overridden");

  const selectedQty = buildAuthoritativeAnswerFacts({ questionIntent: "ITEM_QUANTITY", toolResults: [{ toolName: "get_boq_item_context", result: foundResult() }], missingCapabilities: [] });
  assert.equal(selectedQty.facts.selectedQuantity, 24);
  assert.equal(selectedQty.facts.selectedQuantitySource, "BOQ");
});

test("Section 12 negative tests: the model cannot add or drop a server-decided blocker -- buildAuthoritativeAnswerFacts's blocker set is the ONLY blocker set, period", async () => {
  const decisionProvider = stubDecisionProvider([
    callTool("get_boq_item_context", { itemReference: "28.19" }),
    callTool("get_requirement_profile", { itemReference: shapedItem().itemId }),
    answerDecision(),
  ]);
  const twoBlockerProfile = foundRequirementProfile({
    missingRequirements: ["Panel Compatibility"],
    conflicts: [{ attribute: "Voltage", type: "Required Value Conflict", values: [{ value: "24V", unit: "V", sourceType: "BOQ" }, { value: "12V", unit: "V", sourceType: "Drawing" }], technicalImpact: "x", blocking: true }],
  });
  const expectedFacts = buildAuthoritativeAnswerFacts({
    questionIntent: "ITEM_READINESS_REASON",
    toolResults: [{ toolName: "get_boq_item_context", result: foundResult() }, { toolName: "get_requirement_profile", result: twoBlockerProfile }],
    missingCapabilities: [],
  });
  // The model tries to both ADD a third blocker-sounding claim and DROP one
  // of the real two by omission/contradiction in its prose.
  const answerProvider = stubAnswerProvider([
    explanationAnswer({
      summary: "The only problem is a price issue -- everything else is fine.",
      findingsText: ["No eligible current price exists for this item."],
    }),
  ]);
  const toolExecutors = {
    get_boq_item_context: async () => foundResult(),
    get_requirement_profile: async () => twoBlockerProfile,
  };
  const outcome = await runAgentTurn({ question: "Why isn't BOQ item 28.19 ready?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED");
  assert.deepEqual(outcome.answer.blockers, expectedFacts.blockers, "the real two blockers are ALWAYS present, regardless of what the model's prose said");
  assert.equal(outcome.answer.blockers.length, 2);
});

// ============================================================
// Scenario D (brief Section 10-D): model attempts ANSWER before a tool
// call -> server rejects/corrects it, then the model grounds and answers.
// ============================================================
test("Scenario D: an ungrounded ANSWER is rejected and corrected once, then a grounded answer completes", async () => {
  const projectId = "p1";
  const workflow = realWorkflow({ boqItems: 5, requirementProfiles: 2 });
  const shaped = shapeProjectStatus(projectId, workflow);
  const decisionProvider = stubDecisionProvider([answerDecision(), callTool("get_project_status"), answerDecision()]);
  const answerProvider = stubAnswerProvider([
    explanationAnswer({ summary: `Current phase: ${shaped.currentPhase}` }),
  ]);
  const toolExecutors = { get_project_status: async () => shaped };
  const outcome = await runAgentTurn({ question: "What is blocking this project?", projectId, decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED");
  assert.equal(outcome.answer.responseStatus, "GROUNDED");
  assert.equal(outcome.answer.subjectStatus, null, "subjectStatus is always server-decided null now -- no tool proves a SUBJECT_STATUSES-shaped verdict");
  assert.deepEqual(outcome.answer.blockers, shaped.blockers.map((b) => b.message));
  assert.equal(outcome.diagnostics.modelCalls, 4, "one rejected ANSWER decision + one CALL_TOOL decision + one grounded ANSWER decision + one content fetch");
  assert.equal(outcome.diagnostics.toolCalls.length, 1);
});

// ============================================================
// Scenario E: unknown tool request -> rejected safely, never executed.
// ============================================================
test("Scenario E: a request for an unregistered tool is rejected safely, no tool is ever executed", async () => {
  const decisionProvider = stubDecisionProvider([callTool("delete_requirement")]);
  const answerProvider = stubAnswerProvider([]);
  let executed = false;
  const toolExecutors = { get_project_status: async () => { executed = true; return {}; } };
  const outcome = await runAgentTurn({ question: "q", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "FAILED_SAFE");
  assert.equal(outcome.reason, "UNREGISTERED_TOOL");
  assert.equal(outcome.answer.responseStatus, "FAILED_SAFE");
  assert.equal(outcome.answer.subjectStatus, null);
  assert.equal(executed, false, "no registered tool must ever run when the requested tool is unregistered");
});

// ============================================================
// Scenario F: repeated identical CALL_TOOL request -> bounded termination.
// ============================================================
test("Scenario F: an identical repeated tool call terminates safely instead of looping", async () => {
  const decisionProvider = stubDecisionProvider([callTool("get_project_status"), callTool("get_project_status")]);
  const answerProvider = stubAnswerProvider([]);
  let executions = 0;
  const toolExecutors = { get_project_status: async () => { executions += 1; return shapeProjectStatus("p1", realWorkflow()); } };
  const outcome = await runAgentTurn({ question: "q", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "FAILED_SAFE");
  assert.equal(outcome.reason, "REPEATED_TOOL_CALL");
  assert.equal(executions, 1, "the tool must only actually execute once -- the repeat is rejected before dispatch");
});

// ============================================================
// Scenario G: malformed model output -> safe failure.
// ============================================================
test("Scenario G: malformed model output (missing action) fails safely, never guesses", async () => {
  const decisionProvider = stubDecisionProvider([{ notAnAction: true }]);
  const answerProvider = stubAnswerProvider([]);
  const outcome = await runAgentTurn({ question: "q", projectId: "p1", decisionProvider, answerProvider, toolExecutors: {} });
  assert.equal(outcome.status, "FAILED_SAFE");
  assert.equal(outcome.reason, "MALFORMED_MODEL_OUTPUT");
});

test("Scenario G: a non-JSON-object model response fails safely", async () => {
  const decisionProvider = stubDecisionProvider(["not an object"]);
  const answerProvider = stubAnswerProvider([]);
  const outcome = await runAgentTurn({ question: "q", projectId: "p1", decisionProvider, answerProvider, toolExecutors: {} });
  assert.equal(outcome.status, "FAILED_SAFE");
  assert.equal(outcome.reason, "MALFORMED_MODEL_OUTPUT");
});

// ============================================================
// Scenario H: Workers AI unavailable -> fixed safe response, no guess.
// ============================================================
test("Scenario H: provider unavailable (null) returns a fixed safe response without calling any model", async () => {
  const outcome = await runAgentTurn({ question: "q", projectId: "p1", decisionProvider: null, answerProvider: null, toolExecutors: {} });
  assert.equal(outcome.status, "FAILED_SAFE");
  assert.equal(outcome.reason, "PROVIDER_ERROR");
  assert.equal(outcome.answer.responseStatus, "FAILED_SAFE");
});

test("Scenario H: the decision provider throwing mid-call fails safely with no fabricated answer", async () => {
  const decisionProvider = stubDecisionProvider([new Error("Workers AI request timed out.")]);
  const answerProvider = stubAnswerProvider([]);
  const outcome = await runAgentTurn({ question: "q", projectId: "p1", decisionProvider, answerProvider, toolExecutors: {} });
  assert.equal(outcome.status, "FAILED_SAFE");
  assert.equal(outcome.reason, "PROVIDER_ERROR");
});

test("Scenario H: the answer-content provider throwing after a grounded decision fails safely with no fabricated answer", async () => {
  const decisionProvider = stubDecisionProvider([callTool("get_project_status"), answerDecision()]);
  const answerProvider = stubAnswerProvider([new Error("Workers AI request timed out.")]);
  const toolExecutors = { get_project_status: async () => shapeProjectStatus("p1", realWorkflow()) };
  const outcome = await runAgentTurn({ question: "q", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "FAILED_SAFE");
  assert.equal(outcome.reason, "PROVIDER_ERROR");
});

// ============================================================
// Step-limit / bound proof: the loop must never run unbounded even when
// the model keeps requesting the SAME registered tool with genuinely
// different arguments every time (so repeated-call detection alone would
// not stop it -- only the hard step limit does). Uses found:true results
// throughout -- a found:false result would now short-circuit immediately
// (Section 7/8), which is a different, separately-tested behavior.
// ============================================================
test("the loop terminates at the step limit even when every call is a distinct, valid CALL_TOOL request", async () => {
  let n = 0;
  const decisionProvider = stubDecisionProvider([
    () => callTool("get_boq_item_context", { itemReference: `28.${n += 1}` }),
  ]);
  const answerProvider = stubAnswerProvider([]);
  const toolExecutors = { get_boq_item_context: async () => ({ found: true, projectId: "p1", item: { itemId: "boqitem_x", itemReference: "28.1", description: "d", boqQuantity: 1, selectedQuantity: 1, selectedQuantitySource: "BOQ", system: "CCTV", family: "f", reviewStatus: "Approved" } }) };
  const outcome = await runAgentTurn({ question: "q", projectId: "p1", decisionProvider, answerProvider, toolExecutors, maxSteps: 3 });
  assert.equal(outcome.status, "FAILED_SAFE");
  assert.equal(outcome.reason, "STEP_LIMIT_REACHED");
  assert.equal(outcome.diagnostics.modelCalls, 3);
});

// ============================================================
// Tool execution failure.
// ============================================================
test("a tool executor throwing produces a safe failure, never a fabricated tool result", async () => {
  const decisionProvider = stubDecisionProvider([callTool("get_project_status")]);
  const answerProvider = stubAnswerProvider([]);
  const toolExecutors = { get_project_status: async () => { throw new Error("DB unavailable"); } };
  const outcome = await runAgentTurn({ question: "q", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "FAILED_SAFE");
  assert.equal(outcome.reason, "TOOL_EXECUTION_ERROR");
});

// ============================================================
// Happy path end-to-end proof using the REAL derivePresalesWorkflow output,
// proving the final answer is actually grounded in real project state.
// ============================================================
test("a grounded answer's blockers genuinely match the real, authoritative project workflow state", async () => {
  const projectId = "p1";
  const workflow = realWorkflow({ boqItems: 5, requirementProfiles: 5, matchedItems: 5, technicalApproved: 5, pricedItems: 2, missingPrices: 3 });
  const shaped = shapeProjectStatus(projectId, workflow);
  const decisionProvider = stubDecisionProvider([callTool("get_project_status"), answerDecision()]);
  const answerProvider = stubAnswerProvider([
    explanationAnswer({ summary: `Pricing status: ${shaped.pricingStatus}`, findingsText: [`documentStatus=${shaped.documentStatus}`] }),
  ]);
  const toolExecutors = { get_project_status: async () => shaped };
  // PROJECT_BLOCKERS intent is what makes buildAuthoritativeAnswerFacts
  // surface get_project_status's real blockers array -- see the comment
  // above buildAuthoritativeAnswerFacts's blockers construction.
  const outcome = await runAgentTurn({ question: "What is blocking this project?", projectId, decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED");
  assert.match(outcome.answer.summary, new RegExp(shaped.pricingStatus));
  assert.deepEqual(outcome.answer.blockers, shaped.blockers.map((b) => b.message));
});

// ============================================================
// Phase A1 Slice 2: entity-scope grounding, full loop.
// ============================================================

test("Section 9 / Test A: an item-specific READINESS question causes item-level tool usage and a capability-bounded ABSTENTION, never a fabricated readiness diagnosis (no requirement profile called)", async () => {
  const decisionProvider = stubDecisionProvider([callTool("get_boq_item_context", { itemReference: "28.19" }), answerDecision()]);
  const answerProvider = stubAnswerProvider([
    explanationAnswer({ summary: "Item 28.19 is Ceiling Mounted Dome Camera, quantity 24. This tool set does not yet expose readiness evidence for it." }),
  ]);
  const toolExecutors = { get_boq_item_context: async () => foundResult() };
  const outcome = await runAgentTurn({ question: "Why isn't BOQ item 28.19 ready?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED");
  assert.equal(outcome.diagnostics.questionScope, "BOQ_ITEM");
  assert.equal(outcome.diagnostics.questionIntent, "ITEM_READINESS_REASON");
  assert.equal(outcome.answer.responseStatus, "PARTIAL", "ITEM_REQUIREMENT_PROFILE capability was never proven this turn (get_requirement_profile was never called) -- GROUNDED would be rejected");
  assert.equal(outcome.answer.subjectStatus, null);
  assert.match(outcome.answer.findings[0], /No technical requirement profile/, "the server's own capability-gap sentence must be present even if the model said nothing useful");
});

// ============================================================
// Slice 3: the PRIMARY GOAL flow -- resolve item -> get_boq_item_context ->
// get_requirement_profile -> grounded requirement-level explanation.
// ============================================================
test("Primary goal flow: readiness question with a real requirement-profile blocker is explained, GROUNDED, subjectStatus still null", async () => {
  const decisionProvider = stubDecisionProvider([
    callTool("get_boq_item_context", { itemReference: "28.19" }),
    callTool("get_requirement_profile", { itemReference: shapedItem().itemId }),
    answerDecision(),
  ]);
  const answerProvider = stubAnswerProvider([
    explanationAnswer({
      summary: "Item 28.19 is not ready because Panel Compatibility is a missing mandatory requirement.",
      findingsText: ["Panel Compatibility is required."],
      recommendedNextActionText: "Provide the missing Panel Compatibility requirement.",
    }),
  ]);
  const toolExecutors = {
    get_boq_item_context: async () => foundResult(),
    get_requirement_profile: async () => foundRequirementProfile({ missingRequirements: ["Panel Compatibility"], readinessStatus: "Missing Critical Information", blockers: ["Panel Compatibility is required."] }),
  };
  const outcome = await runAgentTurn({ question: "Why isn't BOQ item 28.19 ready?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED");
  assert.equal(outcome.answer.responseStatus, "GROUNDED", "ITEM_REQUIREMENT_PROFILE was proven this turn -- GROUNDED is legitimate now");
  assert.equal(outcome.answer.subjectStatus, null, "requirement-level readiness is still never the same as full product-selection subjectStatus");
  assert.deepEqual(outcome.diagnostics.toolsCalled, ["get_boq_item_context", "get_requirement_profile"]);
  assert.equal(outcome.diagnostics.profileVersionId, "reqprofile_1");
  assert.equal(outcome.diagnostics.profileStale, false);
  assert.deepEqual(outcome.answer.blockers, ["Missing technical requirement: Panel Compatibility."]);
  assert.equal(outcome.answer.recommendedNextAction.actionType, "REVIEW_MISSING_REQUIREMENTS");
});

test("Slice 3, Section 5: a CLEAN requirement profile must not be answered as simple item readiness -- GROUNDED is allowed, but subjectStatus stays null and the answer must hedge", async () => {
  const decisionProvider = stubDecisionProvider([
    callTool("get_boq_item_context", { itemReference: "28.19" }),
    callTool("get_requirement_profile", { itemReference: shapedItem().itemId }),
    answerDecision(),
  ]);
  // Empty prose -- proves the SERVER, not the model, is what guarantees the
  // requirement-vs-product-selection distinction appears.
  const answerProvider = stubAnswerProvider([explanationAnswer({ summary: "" })]);
  const toolExecutors = {
    get_boq_item_context: async () => foundResult(),
    get_requirement_profile: async () => foundRequirementProfile(),
  };
  const outcome = await runAgentTurn({ question: "Why isn't BOQ item 28.19 ready?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED");
  assert.equal(outcome.answer.subjectStatus, null);
  assert.deepEqual(outcome.answer.blockers, [], "a clean profile has no real blockers");
  assert.match(outcome.answer.summary, /product-selection readiness \(product matching, technical eligibility, safety, and price\) is not yet available/i, "the server-authored fallback summary always states this distinction, even with no model prose to lean on");
  assert.equal(outcome.answer.findings.includes("Requirement profile: Ready"), true);
  assert.match(outcome.answer.findings[1], /product-selection readiness/i, "the capability-gap sentence is unconditional, server-authored, and present even with empty model prose");
});

// Slice 3, third finding: real live-model evidence showed the model
// reliably DECIDES to call get_requirement_profile once it has resolved an
// item, but does not reliably TRANSCRIBE the real internal id into its own
// arguments. Since this value is already fully known and verified
// server-side, the server injects it directly.
test("Slice 3: get_requirement_profile's itemId is injected server-side from the item ALREADY resolved this turn -- the model's own (possibly wrong) transcription is never used", async () => {
  const decisionProvider = stubDecisionProvider([
    callTool("get_boq_item_context", { itemReference: "28.19" }),
    callTool("get_requirement_profile", { itemReference: "not-the-real-id-the-model-guessed" }),
    answerDecision(),
  ]);
  const answerProvider = stubAnswerProvider([explanationAnswer()]);
  let executedWithItemId = null;
  const toolExecutors = {
    get_boq_item_context: async () => foundResult(),
    get_requirement_profile: async (args) => { executedWithItemId = args.itemId; return foundRequirementProfile(); },
  };
  const outcome = await runAgentTurn({ question: "Why isn't BOQ item 28.19 ready?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED");
  assert.equal(executedWithItemId, shapedItem().itemId, "the tool must execute with the REAL id the server already resolved, never the model's own transcription");
});

test("Slice 3: get_requirement_profile is rejected before execution if no item was resolved yet this turn at all (nothing to inject)", async () => {
  const decisionProvider = stubDecisionProvider([callTool("get_requirement_profile", { itemReference: "anything" })]);
  const answerProvider = stubAnswerProvider([]);
  let executed = false;
  const toolExecutors = { get_requirement_profile: async () => { executed = true; return foundRequirementProfile(); } };
  const outcome = await runAgentTurn({ question: "q", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "FAILED_SAFE");
  assert.equal(outcome.diagnostics.groundingFailureReason, "REQUIREMENT_PROFILE_ITEM_MISMATCH");
  assert.equal(executed, false);
});

test("Slice 3, Section 11: REQUIREMENT_PROFILE_NOT_FOUND short-circuits to a fixed GROUNDED honest-absence response -- no answer-content model call", async () => {
  const decisionProvider = stubDecisionProvider([
    callTool("get_boq_item_context", { itemReference: "28.19" }),
    callTool("get_requirement_profile", { itemReference: shapedItem().itemId }),
  ]);
  const answerProvider = stubAnswerProvider([new Error("must never be called for a deterministic not-found response")]);
  const toolExecutors = {
    get_boq_item_context: async () => foundResult(),
    get_requirement_profile: async () => requirementProfileNotFound(),
  };
  const outcome = await runAgentTurn({ question: "Why isn't BOQ item 28.19 ready?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED");
  assert.equal(outcome.answer.responseStatus, "GROUNDED");
  assert.equal(outcome.answer.subjectStatus, null);
  assert.match(outcome.answer.summary, /No technical requirement profile has been generated/);
  assert.equal(outcome.diagnostics.modelCalls, 2, "two decision calls (item lookup + profile lookup) -- no answer-content call follows a resolver short-circuit");
});

test("Slice 3.1, Section 6/7: a stale profile is ALWAYS exposed in facts.profileStale/blockers regardless of what the model's prose says", async () => {
  const decisionProvider = stubDecisionProvider([
    callTool("get_boq_item_context", { itemReference: "28.19" }),
    callTool("get_requirement_profile", { itemReference: shapedItem().itemId }),
    answerDecision(),
  ]);
  const answerProvider = stubAnswerProvider([
    explanationAnswer({ summary: "This requirement profile is current and ready.", findingsText: ["This requirement profile is current and ready."] }),
  ]);
  const toolExecutors = {
    get_boq_item_context: async () => foundResult(),
    get_requirement_profile: async () => foundRequirementProfile({ stale: true }),
  };
  const outcome = await runAgentTurn({ question: "Why isn't BOQ item 28.19 ready?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED", "the bad 'is current' claim is filtered, not a turn failure");
  assert.equal(outcome.answer.facts.profileStale, true);
  assert.match(outcome.answer.blockers[0], /needs recalculation/);
  assert.equal(outcome.answer.findings.some((f) => /is current and ready/.test(f)), false, "the false 'current' claim must never survive into the final findings");
  assert.equal(outcome.diagnostics.profileStale, true);
});

test("Test D: a project-level question never requires or forces item-tool usage", async () => {
  const workflow = realWorkflow();
  const shaped = shapeProjectStatus("p1", workflow);
  const decisionProvider = stubDecisionProvider([callTool("get_project_status"), answerDecision()]);
  const answerProvider = stubAnswerProvider([explanationAnswer()]);
  const toolExecutors = {
    get_project_status: async () => shaped,
    get_boq_item_context: async () => { throw new Error("must not be called"); },
    get_requirement_profile: async () => { throw new Error("must not be called"); },
  };
  const outcome = await runAgentTurn({ question: "What is blocking this project?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED");
  assert.equal(outcome.diagnostics.questionScope, "PROJECT");
  assert.equal(outcome.diagnostics.questionIntent, "PROJECT_BLOCKERS");
  assert.deepEqual(outcome.diagnostics.toolEvidenceScopes, ["PROJECT"]);
  assert.deepEqual(outcome.diagnostics.toolsCalled, ["get_project_status"]);
});

test("Slice 3, Section 10: a plain quantity question never calls get_requirement_profile", async () => {
  const decisionProvider = stubDecisionProvider([callTool("get_boq_item_context", { itemReference: "28.19" }), answerDecision()]);
  const answerProvider = stubAnswerProvider([explanationAnswer({ summary: "24" })]);
  const toolExecutors = {
    get_boq_item_context: async () => foundResult(),
    get_requirement_profile: async () => { throw new Error("must not be called for a plain quantity question"); },
  };
  const outcome = await runAgentTurn({ question: "What quantity are we using for item 28.19?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED");
  assert.deepEqual(outcome.diagnostics.toolsCalled, ["get_boq_item_context"]);
  assert.equal(outcome.answer.facts.selectedQuantity, 24);
});

test("PROJECT-scope evidence alone can never satisfy an item-specific question -- corrected once, then grounded (with an honest abstention, since no requirement profile was called)", async () => {
  const decisionProvider = stubDecisionProvider([
    callTool("get_project_status"),
    answerDecision(),
    callTool("get_boq_item_context", { itemReference: "28.19" }),
    answerDecision(),
  ]);
  const answerProvider = stubAnswerProvider([
    explanationAnswer({ summary: "Item 28.19 identified; requirement-level readiness evidence is not available from this tool set." }),
  ]);
  const toolExecutors = { get_project_status: async () => shapeProjectStatus("p1", realWorkflow()), get_boq_item_context: async () => foundResult() };
  const outcome = await runAgentTurn({ question: "Why isn't BOQ item 28.19 ready?", projectId: "p1", decisionProvider, answerProvider, toolExecutors, maxSteps: 4 });
  assert.equal(outcome.status, "COMPLETED");
  assert.equal(outcome.answer.responseStatus, "PARTIAL");
  assert.equal(outcome.diagnostics.modelCalls, 5, "project tool call + rejected premature answer decision + item tool call + grounded answer decision + content fetch");
});

test("Section 9: item A evidence cannot satisfy a question naming item B -- the model querying the wrong item is rejected, not silently accepted", async () => {
  const decisionProvider = stubDecisionProvider([
    callTool("get_boq_item_context", { itemReference: "28.20" }), // question asks about 28.19
    answerDecision(),
  ]);
  const answerProvider = stubAnswerProvider([]);
  const toolExecutors = { get_boq_item_context: async () => foundResult() };
  const outcome = await runAgentTurn({ question: "Why isn't BOQ item 28.19 ready?", projectId: "p1", decisionProvider, answerProvider, toolExecutors, maxSteps: 2 });
  assert.equal(outcome.status, "FAILED_SAFE");
  assert.equal(outcome.reason, "STEP_LIMIT_REACHED", "with only 2 steps, the wrong-item lookup consumes step 1 and the corrected retry never lands -- proving the wrong item genuinely never satisfied grounding");
});

// ============================================================
// Slice 2.2, Section 7/8: deterministic short-circuit for
// ITEM_NOT_FOUND / ITEM_REFERENCE_AMBIGUOUS -- no answer-model call at all.
// ============================================================
test("Test F: ITEM_NOT_FOUND short-circuits to a fixed GROUNDED response server-side -- no answer-content model call, no fabricated reference", async () => {
  const decisionProvider = stubDecisionProvider([callTool("get_boq_item_context", { itemReference: "ABC-999" })]);
  const answerProvider = stubAnswerProvider([new Error("must never be called for a deterministic not-found response")]);
  const toolExecutors = { get_boq_item_context: async () => notFoundResult("ABC-999") };
  const outcome = await runAgentTurn({ question: "Tell me about item ABC-999", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED");
  assert.equal(outcome.answer.responseStatus, "GROUNDED");
  assert.equal(outcome.answer.subjectStatus, null);
  assert.equal(outcome.answer.summary, "I couldn't find BOQ item ABC-999 in this project.");
  assert.deepEqual(outcome.answer.references, []);
  assert.equal(outcome.diagnostics.modelCalls, 1, "exactly one decision call -- no answer-content call follows a resolver short-circuit");
  assert.equal(outcome.diagnostics.resolvedEntity, null, "nothing was found, so no entity is recorded as resolved");
});

test("Test G: ITEM_REFERENCE_AMBIGUOUS short-circuits to a fixed GROUNDED clarification response server-side -- no repeated tool call, no guessed selection", async () => {
  const decisionProvider = stubDecisionProvider([callTool("get_boq_item_context", { itemReference: "9.1" })]);
  const answerProvider = stubAnswerProvider([new Error("must never be called for a deterministic ambiguous response")]);
  let executions = 0;
  const toolExecutors = { get_boq_item_context: async () => { executions += 1; return ambiguousResult("9.1"); } };
  const outcome = await runAgentTurn({ question: "What do we know about item 9.1?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED");
  assert.equal(outcome.answer.responseStatus, "GROUNDED");
  assert.equal(outcome.answer.subjectStatus, null);
  assert.match(outcome.answer.summary, /more than one BOQ row matching "9\.1"/);
  assert.equal(outcome.diagnostics.modelCalls, 1);
  assert.equal(executions, 1, "the resolver is never queried twice for an ambiguous reference");
});

test("diagnostics.groundingFailureReason is null on a clean completion and set on every failure path", async () => {
  const cleanDecisionProvider = stubDecisionProvider([callTool("get_project_status"), answerDecision()]);
  const cleanAnswerProvider = stubAnswerProvider([explanationAnswer()]);
  const clean = await runAgentTurn({ question: "What is blocking this project?", projectId: "p1", decisionProvider: cleanDecisionProvider, answerProvider: cleanAnswerProvider, toolExecutors: { get_project_status: async () => shapeProjectStatus("p1", realWorkflow()) } });
  assert.equal(clean.diagnostics.groundingFailureReason, null);

  const failing = await runAgentTurn({ question: "q", projectId: "p1", decisionProvider: null, answerProvider: null, toolExecutors: {} });
  assert.equal(failing.diagnostics.groundingFailureReason, "PROVIDER_ERROR");
});

// ============================================================
// Slice 4: get_product_matching_status -- the fourth and final tool this
// slice authorizes. Reuses worker/product-matching-api.mjs's real
// persisted product_match_runs/product_match_candidates rows and its own
// exported matchRunStaleness() (proven separately, against real SQL, in
// tests/ai-presales-agent-tools.test.mjs). Never a new matching algorithm,
// never a re-rank, never an AI Product Ranking call from the agent.
// ============================================================

const matchRunRow = (overrides = {}) => ({ id: "matchrun_1", requirement_profile_version_id: "reqprofile_1", status: "Needs Review", candidate_count: 1, no_match: null, ...overrides });
const candidateRow = (overrides = {}) => ({
  id: "cand_1", product_id: "prod_1", part_number: "IDP-EAGLE", manufacturer: "Honeywell", family: "Dome Camera",
  technical_status: "Technically Compliant", review_status: "Needs Review", matching_basis: JSON.stringify(["Manufacturer + Product Family"]), mandatory_failures: JSON.stringify([]),
  ...overrides,
});
const foundMatchingResult = (overrides = {}) => ({
  found: true, projectId: "p1", itemId: shapedItem().itemId,
  matchRunId: "matchrun_1", requirementProfileVersionId: "reqprofile_1", stale: false,
  status: "Needs Review", candidateCount: 1,
  counts: { technicallyEligible: 1, discoveryOnly: 0, nonCompliant: 0, needsReview: 1 },
  selectedCandidate: null,
  candidates: [
    { candidateId: "cand_1", productId: "prod_1", partNumber: "IDP-EAGLE", manufacturer: "Honeywell", family: "Dome Camera", deterministicStatus: "Technically Compliant", reviewStatus: "Needs Review", matchedCriteria: ["Manufacturer + Product Family"], failedCriteria: [], missingEvidence: [] },
  ],
  blockers: [],
  ...overrides,
});
const matchRunNotFound = () => ({ found: false, projectId: "p1", itemId: shapedItem().itemId, reason: "MATCH_RUN_NOT_FOUND" });

test("shapeProductMatchingStatus reshapes real product_match_runs/product_match_candidates rows -- candidate order from rank, counts from technicalStatus/reviewStatus, failedCriteria vs missingEvidence split from mandatory_failures, selectedCandidate only from a confirmed review_status", () => {
  const shaped = shapeProductMatchingStatus(
    matchRunRow({ candidate_count: 3 }),
    [
      candidateRow({ id: "cand_eligible", technical_status: "Technically Compliant", review_status: "Approved", matching_basis: JSON.stringify(["Manufacturer + Product Family"]) }),
      candidateRow({ id: "cand_discovery", technical_status: "Discovery Only", review_status: "Needs Review", mandatory_failures: JSON.stringify([{ type: "Evidence", result: "Evidence Missing" }]) }),
      candidateRow({ id: "cand_noncompliant", technical_status: "Non-Compliant", review_status: "Needs Review", mandatory_failures: JSON.stringify([{ type: "Voltage", result: "Voltage mismatch" }]) }),
    ],
    { stale: false },
  );
  assert.equal(shaped.matchRunId, "matchrun_1");
  assert.equal(shaped.stale, false);
  assert.equal(shaped.status, "Needs Review");
  assert.equal(shaped.candidateCount, 3);
  assert.deepEqual(shaped.counts, { technicallyEligible: 1, discoveryOnly: 1, nonCompliant: 1, needsReview: 2 });
  assert.deepEqual(shaped.selectedCandidate, { candidateId: "cand_eligible", productId: "prod_1", partNumber: "IDP-EAGLE", reviewStatus: "Approved" });
  const discovery = shaped.candidates.find((c) => c.candidateId === "cand_discovery");
  assert.deepEqual(discovery.missingEvidence, ["Evidence Missing"]);
  assert.deepEqual(discovery.failedCriteria, []);
  const nonCompliant = shaped.candidates.find((c) => c.candidateId === "cand_noncompliant");
  assert.deepEqual(nonCompliant.failedCriteria, ["Voltage mismatch"]);
});

test("shapeProductMatchingStatus truncates returned candidates to the top 5 by rank, but candidateCount/counts still reflect the FULL run", () => {
  const rows = Array.from({ length: 8 }, (_, i) => candidateRow({ id: `cand_${i}`, product_id: `prod_${i}`, part_number: `PN-${i}`, technical_status: "Technically Compliant" }));
  const shaped = shapeProductMatchingStatus(matchRunRow({ candidate_count: 8 }), rows, { stale: false });
  assert.equal(shaped.candidates.length, 5, "Section 4 of the brief: recommended maximum 5 returned");
  assert.equal(shaped.candidateCount, 8, "aggregate counts must cover the full run, not just the returned 5");
  assert.equal(shaped.counts.technicallyEligible, 8);
});

test("shapeProductMatchingStatus surfaces the engine's own no_match.reason as a blocker, and refuses to fabricate a shape from a missing run row", () => {
  const shaped = shapeProductMatchingStatus(matchRunRow({ candidate_count: 0, status: "No Match", no_match: JSON.stringify({ reason: "No product was found within the controlled search scope." }) }), [], { stale: false });
  assert.deepEqual(shaped.blockers, ["No product was found within the controlled search scope."]);
  assert.deepEqual(shaped.candidates, []);
  assert.throws(() => shapeProductMatchingStatus(null, []));
});

// ============================================================
// Slice 4, Section 4/6: containsOutOfScopeClaim now gates matching
// vocabulary CONDITIONALLY -- forbidden when no matching evidence exists
// this turn (Slice 1-3.1 behavior, unchanged), legitimate once
// get_product_matching_status actually ran. Safety/price/final-approval
// vocabulary stays ALWAYS forbidden, regardless.
// ============================================================
test("containsOutOfScopeClaim: matching vocabulary is forbidden by default (matchingAvailable=false, Slice 1-3.1 behavior unchanged) but allowed once matchingAvailable=true", () => {
  assert.equal(containsOutOfScopeClaim(["This candidate is technically eligible."]), true);
  assert.equal(containsOutOfScopeClaim(["This candidate is technically eligible."], { matchingAvailable: false }), true);
  assert.equal(containsOutOfScopeClaim(["This candidate is technically eligible."], { matchingAvailable: true }), false);
  assert.equal(containsOutOfScopeClaim(["The candidate is Non-Compliant."], { matchingAvailable: true }), false);
  assert.equal(containsOutOfScopeClaim(["Matching status is Needs Review."], { matchingAvailable: true }), false);
});

test("containsOutOfScopeClaim: safety/price/final-approval/commercial-readiness claims stay ALWAYS forbidden, even when matchingAvailable=true", () => {
  const alwaysForbidden = [
    "1 safety block(s) remain open.",
    "This item has been technically approved for quotation.",
    "The item has no eligible current price.",
    "The product is commercially ready.",
    "Product IDP-EAGLE is selected for this item.",
  ];
  for (const claim of alwaysForbidden) {
    assert.equal(containsOutOfScopeClaim([claim], { matchingAvailable: true }), true, `"${claim}" must remain forbidden regardless of matching availability`);
  }
});

// ============================================================
// Slice 4, Section 13/16: detectProductMatchingContradiction.
// ============================================================
test("detectProductMatchingContradiction rejects claiming the match run needs rerunning when it is not stale, claiming it is current when it IS stale, and fabricating a failure/missing-evidence claim for a candidate the tool proved is clean", () => {
  const fresh = foundMatchingResult({ stale: false });
  assert.ok(detectProductMatchingContradiction(["The match run needs to be rerun."], fresh));
  assert.equal(detectProductMatchingContradiction(["The match run does not need to be rerun."], fresh), null);

  const stale = foundMatchingResult({ stale: true });
  assert.ok(detectProductMatchingContradiction(["The match run is current."], stale));

  assert.ok(
    detectProductMatchingContradiction(["IDP-EAGLE failed the mandatory technical check."], fresh),
    "cand_1/IDP-EAGLE has zero real failedCriteria/missingEvidence -- claiming it failed is a fabrication",
  );
  assert.equal(detectProductMatchingContradiction(["IDP-EAGLE is technically compliant."], fresh), null, "a true, non-failure statement about the same clean candidate is not a contradiction");
});

test("detectProductMatchingContradiction never fires without a real FOUND matching result", () => {
  assert.equal(detectProductMatchingContradiction(["the match run is stale"], null), null);
  assert.equal(detectProductMatchingContradiction(["the match run is stale"], { found: false }), null);
});

// ============================================================
// Slice 4, Section 1/2/13: buildAuthoritativeAnswerFacts with matching
// evidence -- server-owned blockers/counts/actionType/capabilityGaps,
// exactly mirroring the discipline Slice 3.1 established for requirements.
// ============================================================
test("buildAuthoritativeAnswerFacts: eligible candidates found -> zero matching blockers, actionType REVIEW_PRODUCT_CANDIDATES, Final-approval capability gap (not the old product-selection gap)", () => {
  const toolResults = [
    { toolName: "get_boq_item_context", result: foundResult() },
    { toolName: "get_requirement_profile", result: foundRequirementProfile() },
    { toolName: "get_product_matching_status", result: foundMatchingResult() },
  ];
  const aaf = buildAuthoritativeAnswerFacts({ questionIntent: "ITEM_MATCHING_STATUS", toolResults, missingCapabilities: [] });
  assert.deepEqual(aaf.blockers, []);
  assert.equal(aaf.recommendedAction.actionType, "REVIEW_PRODUCT_CANDIDATES");
  assert.equal(aaf.capabilityGaps.some((g) => /safety and price/i.test(g)), true);
  assert.equal(aaf.capabilityGaps.some((g) => /product matching.*not yet available/i.test(g)), false, "matching evidence genuinely exists -- the OLD 'matching is unavailable' gap text must not appear");
  assert.equal(aaf.facts.candidateCount, 1);
  assert.equal(aaf.facts.technicallyEligibleCount, 1);
});

test("buildAuthoritativeAnswerFacts: Discovery Only candidates only -> counted correctly, actionType still REVIEW_PRODUCT_CANDIDATES (real candidates exist, just not eligible)", () => {
  const discoveryResult = foundMatchingResult({
    status: "Discovery Only",
    counts: { technicallyEligible: 0, discoveryOnly: 1, nonCompliant: 0, needsReview: 1 },
    candidates: [{ candidateId: "cand_1", productId: "prod_1", partNumber: "IDP-PHOTO-IV", manufacturer: "Honeywell", family: null, deterministicStatus: "Discovery Only", reviewStatus: "Needs Review", matchedCriteria: ["Semantic Discovery"], failedCriteria: [], missingEvidence: ["Protocol evidence"] }],
  });
  const toolResults = [
    { toolName: "get_boq_item_context", result: foundResult() },
    { toolName: "get_requirement_profile", result: foundRequirementProfile() },
    { toolName: "get_product_matching_status", result: discoveryResult },
  ];
  const aaf = buildAuthoritativeAnswerFacts({ questionIntent: "ITEM_MATCHING_STATUS", toolResults, missingCapabilities: [] });
  assert.equal(aaf.facts.discoveryOnlyCount, 1);
  assert.equal(aaf.facts.technicallyEligibleCount, 0);
  assert.equal(aaf.recommendedAction.actionType, "REVIEW_PRODUCT_CANDIDATES");
  assert.equal(aaf.matchingCandidateSummaries[0].includes("IDP-PHOTO-IV"), true);
  assert.equal(aaf.matchingCandidateSummaries[0].includes("Discovery Only"), true);
  assert.equal(aaf.matchingCandidateSummaries[0].includes("Protocol evidence"), true);
});

test("buildAuthoritativeAnswerFacts: a STALE match run yields the rerun blocker and actionType RERUN_PRODUCT_MATCHING, taking priority over candidate review", () => {
  const staleResult = foundMatchingResult({ stale: true });
  const toolResults = [
    { toolName: "get_boq_item_context", result: foundResult() },
    { toolName: "get_requirement_profile", result: foundRequirementProfile() },
    { toolName: "get_product_matching_status", result: staleResult },
  ];
  const aaf = buildAuthoritativeAnswerFacts({ questionIntent: "ITEM_MATCHING_STATUS", toolResults, missingCapabilities: [] });
  assert.match(aaf.blockers[0], /needs to be rerun/);
  assert.equal(aaf.facts.matchStale, true);
  assert.equal(aaf.recommendedAction.actionType, "RERUN_PRODUCT_MATCHING");
});

test("buildAuthoritativeAnswerFacts: a real zero-candidate run surfaces the matching engine's OWN no_match reason as a blocker, never a guessed reason", () => {
  const zeroResult = foundMatchingResult({ status: "No Match", candidateCount: 0, counts: { technicallyEligible: 0, discoveryOnly: 0, nonCompliant: 0, needsReview: 0 }, candidates: [], blockers: ["No product was found within the controlled search scope."] });
  const toolResults = [
    { toolName: "get_boq_item_context", result: foundResult() },
    { toolName: "get_requirement_profile", result: foundRequirementProfile() },
    { toolName: "get_product_matching_status", result: zeroResult },
  ];
  const aaf = buildAuthoritativeAnswerFacts({ questionIntent: "ITEM_MATCHING_STATUS", toolResults, missingCapabilities: [] });
  assert.deepEqual(aaf.blockers, ["No product was found within the controlled search scope."]);
  // No stale/requirement blocker and zero real candidates to review -- the
  // server deliberately does NOT invent a specific actionType it has no
  // good evidence for (Section 3: "do not fabricate status labels"); the
  // real blocker text above is already the honest, useful signal.
  assert.equal(aaf.recommendedAction.actionType, "NONE");
});

// ============================================================
// Slice 4, full-loop proof: Section 11-A primary flow -- item -> requirement
// -> matching -> grounded, cross-layer explanation.
// ============================================================
test("Primary matching flow: a matching question resolves item, requirement profile, AND matching status in order, and the final answer states all three cross-layer facts (Section 15)", async () => {
  const decisionProvider = stubDecisionProvider([
    callTool("get_boq_item_context", { itemReference: "28.19" }),
    callTool("get_requirement_profile", { itemReference: shapedItem().itemId }),
    callTool("get_product_matching_status", { itemReference: shapedItem().itemId }),
    answerDecision(),
  ]);
  const answerProvider = stubAnswerProvider([explanationAnswer({ summary: "" })]); // empty -> exercises the server fallback
  const toolExecutors = {
    get_boq_item_context: async () => foundResult(),
    get_requirement_profile: async () => foundRequirementProfile(),
    get_product_matching_status: async () => foundMatchingResult(),
  };
  const outcome = await runAgentTurn({ question: "Why isn't item 28.19 matched?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED");
  assert.equal(outcome.diagnostics.questionIntent, "ITEM_MATCHING_STATUS");
  assert.deepEqual(outcome.diagnostics.toolsCalled, ["get_boq_item_context", "get_requirement_profile", "get_product_matching_status"]);
  assert.equal(outcome.diagnostics.matchRunId, "matchrun_1");
  assert.equal(outcome.diagnostics.matchStale, false);
  assert.equal(outcome.diagnostics.candidateCount, 1);
  assert.match(outcome.answer.summary, /Requirement profile: Ready/);
  assert.match(outcome.answer.summary, /Product matching:.*technically eligible/i);
  assert.match(outcome.answer.summary, /Final approval:.*safety and price/i);
  assert.equal(outcome.answer.subjectStatus, null);
});

test("Discovery Only behavior: the final answer's candidate summary states Discovery Only and the real missing evidence, never a false 'eligible' claim", async () => {
  const discoveryResult = foundMatchingResult({
    status: "Discovery Only",
    counts: { technicallyEligible: 0, discoveryOnly: 1, nonCompliant: 0, needsReview: 1 },
    candidates: [{ candidateId: "cand_1", productId: "prod_1", partNumber: "IDP-PHOTO-IV", manufacturer: "Honeywell", family: null, deterministicStatus: "Discovery Only", reviewStatus: "Needs Review", matchedCriteria: ["Semantic Discovery"], failedCriteria: [], missingEvidence: ["Protocol evidence"] }],
  });
  const decisionProvider = stubDecisionProvider([
    callTool("get_boq_item_context", { itemReference: "28.20" }),
    callTool("get_requirement_profile", { itemReference: shapedItem().itemId }),
    callTool("get_product_matching_status", { itemReference: shapedItem().itemId }),
    answerDecision(),
  ]);
  const answerProvider = stubAnswerProvider([explanationAnswer()]);
  const toolExecutors = {
    get_boq_item_context: async () => foundResult(),
    get_requirement_profile: async () => foundRequirementProfile(),
    get_product_matching_status: async () => discoveryResult,
  };
  const outcome = await runAgentTurn({ question: "Are there any compatible products for item 28.20?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED");
  const candidateFinding = outcome.answer.findings.find((f) => f.includes("IDP-PHOTO-IV"));
  assert.match(candidateFinding, /Discovery Only/);
  assert.match(candidateFinding, /Protocol evidence/);
  assert.equal(outcome.answer.facts.technicallyEligibleCount, 0);
});

test("Non-compliant behavior: the final answer's candidate summary states the real failed criteria, and matching counts are exact", async () => {
  const nonCompliantResult = foundMatchingResult({
    status: "Needs Review",
    counts: { technicallyEligible: 0, discoveryOnly: 0, nonCompliant: 1, needsReview: 1 },
    candidates: [{ candidateId: "cand_1", productId: "prod_1", partNumber: "IDP-BAD", manufacturer: "Honeywell", family: null, deterministicStatus: "Non-Compliant", reviewStatus: "Needs Review", matchedCriteria: [], failedCriteria: ["Voltage mismatch"], missingEvidence: [] }],
  });
  const decisionProvider = stubDecisionProvider([
    callTool("get_boq_item_context", { itemReference: "28.19" }),
    callTool("get_requirement_profile", { itemReference: shapedItem().itemId }),
    callTool("get_product_matching_status", { itemReference: shapedItem().itemId }),
    answerDecision(),
  ]);
  const answerProvider = stubAnswerProvider([explanationAnswer()]);
  const toolExecutors = {
    get_boq_item_context: async () => foundResult(),
    get_requirement_profile: async () => foundRequirementProfile(),
    get_product_matching_status: async () => nonCompliantResult,
  };
  const outcome = await runAgentTurn({ question: "Why was candidate IDP-BAD rejected for item 28.19?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED");
  const candidateFinding = outcome.answer.findings.find((f) => f.includes("IDP-BAD"));
  assert.match(candidateFinding, /Non-Compliant/);
  assert.match(candidateFinding, /Voltage mismatch/);
  assert.equal(outcome.answer.facts.nonCompliantCount, 1);
});

test("Stale matching behavior: facts.matchStale/blockers ALWAYS expose staleness regardless of what the model's prose claims, and a false 'current' claim is filtered rather than failing the turn", async () => {
  const staleResult = foundMatchingResult({ stale: true });
  const decisionProvider = stubDecisionProvider([
    callTool("get_boq_item_context", { itemReference: "28.19" }),
    callTool("get_requirement_profile", { itemReference: shapedItem().itemId }),
    callTool("get_product_matching_status", { itemReference: shapedItem().itemId }),
    answerDecision(),
  ]);
  const answerProvider = stubAnswerProvider([explanationAnswer({ summary: "The match run is current and ready.", findingsText: ["The match run is current."] })]);
  const toolExecutors = {
    get_boq_item_context: async () => foundResult(),
    get_requirement_profile: async () => foundRequirementProfile(),
    get_product_matching_status: async () => staleResult,
  };
  const outcome = await runAgentTurn({ question: "Why isn't item 28.19 matched?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED", "the false 'current' claim is filtered, not a turn failure");
  assert.equal(outcome.answer.facts.matchStale, true);
  assert.match(outcome.answer.blockers[0], /needs to be rerun/);
  assert.equal(outcome.answer.recommendedNextAction.actionType, "RERUN_PRODUCT_MATCHING");
  assert.equal(outcome.answer.findings.some((f) => /match run is current/i.test(f)), false, "the false 'current' claim must never survive into the final findings");
});

test("Slice 4, Section 8: MATCH_RUN_NOT_FOUND short-circuits to a fixed GROUNDED honest-absence response with actionType RUN_PRODUCT_MATCHING -- absence is never interpreted as 'no compatible product exists'", async () => {
  const decisionProvider = stubDecisionProvider([
    callTool("get_boq_item_context", { itemReference: "28.21" }),
    callTool("get_requirement_profile", { itemReference: shapedItem().itemId }),
    callTool("get_product_matching_status", { itemReference: shapedItem().itemId }),
  ]);
  const answerProvider = stubAnswerProvider([new Error("must never be called for a deterministic not-found response")]);
  const toolExecutors = {
    get_boq_item_context: async () => foundResult(),
    get_requirement_profile: async () => foundRequirementProfile(),
    get_product_matching_status: async () => matchRunNotFound(),
  };
  const outcome = await runAgentTurn({ question: "Why isn't item 28.21 matched?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED");
  assert.equal(outcome.answer.responseStatus, "GROUNDED");
  assert.match(outcome.answer.summary, /has not been run yet/);
  assert.doesNotMatch(outcome.answer.summary, /no compatible product/i);
  assert.equal(outcome.answer.recommendedNextAction.actionType, "RUN_PRODUCT_MATCHING");
  assert.equal(outcome.diagnostics.modelCalls, 3, "three decision calls (item + requirement + matching lookups) -- no answer-content call follows a resolver short-circuit");
});

test("Slice 4, Section 9: a real match run with zero candidates is distinguished from 'no match run at all' -- explains the engine's real blocker, never guesses", async () => {
  const zeroResult = foundMatchingResult({ status: "No Match", candidateCount: 0, counts: { technicallyEligible: 0, discoveryOnly: 0, nonCompliant: 0, needsReview: 0 }, candidates: [], blockers: ["No product was found within the controlled search scope."] });
  const decisionProvider = stubDecisionProvider([
    callTool("get_boq_item_context", { itemReference: "28.19" }),
    callTool("get_requirement_profile", { itemReference: shapedItem().itemId }),
    callTool("get_product_matching_status", { itemReference: shapedItem().itemId }),
    answerDecision(),
  ]);
  const answerProvider = stubAnswerProvider([explanationAnswer()]);
  const toolExecutors = {
    get_boq_item_context: async () => foundResult(),
    get_requirement_profile: async () => foundRequirementProfile(),
    get_product_matching_status: async () => zeroResult,
  };
  const outcome = await runAgentTurn({ question: "Why isn't item 28.19 matched?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED");
  assert.equal(outcome.diagnostics.candidateCount, 0);
  assert.deepEqual(outcome.answer.blockers, ["No product was found within the controlled search scope."]);
});

test("Slice 4, Section 11-E: a real engineer-selected candidate is exposed, but rank #1 is never confused with selected", async () => {
  const withSelection = foundMatchingResult({
    counts: { technicallyEligible: 2, discoveryOnly: 0, nonCompliant: 0, needsReview: 1 },
    selectedCandidate: { candidateId: "cand_2", productId: "prod_2", partNumber: "IDP-PHOTO-IV", reviewStatus: "Approved" },
    candidates: [
      { candidateId: "cand_1", productId: "prod_1", partNumber: "IDP-EAGLE", manufacturer: "Honeywell", family: null, deterministicStatus: "Technically Compliant", reviewStatus: "Needs Review", matchedCriteria: [], failedCriteria: [], missingEvidence: [] },
      { candidateId: "cand_2", productId: "prod_2", partNumber: "IDP-PHOTO-IV", manufacturer: "Honeywell", family: null, deterministicStatus: "Technically Compliant", reviewStatus: "Approved", matchedCriteria: [], failedCriteria: [], missingEvidence: [] },
    ],
  });
  const decisionProvider = stubDecisionProvider([
    callTool("get_boq_item_context", { itemReference: "28.19" }),
    callTool("get_requirement_profile", { itemReference: shapedItem().itemId }),
    callTool("get_product_matching_status", { itemReference: shapedItem().itemId }),
    answerDecision(),
  ]);
  const answerProvider = stubAnswerProvider([explanationAnswer()]);
  const toolExecutors = {
    get_boq_item_context: async () => foundResult(),
    get_requirement_profile: async () => foundRequirementProfile(),
    get_product_matching_status: async () => withSelection,
  };
  const outcome = await runAgentTurn({ question: "Has a product been selected for item 28.19?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED");
  assert.equal(outcome.answer.facts.selectedCandidatePartNumber, "IDP-PHOTO-IV");
  assert.equal(outcome.answer.facts.selectedCandidateReviewStatus, "Approved");
});

test("Slice 4, Section 16 negative claim: 'Product X is selected' is rejected when selectedCandidate is null, regardless of matching evidence availability", async () => {
  const decisionProvider = stubDecisionProvider([
    callTool("get_boq_item_context", { itemReference: "28.19" }),
    callTool("get_requirement_profile", { itemReference: shapedItem().itemId }),
    callTool("get_product_matching_status", { itemReference: shapedItem().itemId }),
    answerDecision(),
  ]);
  const answerProvider = stubAnswerProvider([explanationAnswer({ summary: "Product IDP-EAGLE is selected for this item.", findingsText: ["Product IDP-EAGLE is selected for this item."] })]);
  const toolExecutors = {
    get_boq_item_context: async () => foundResult(),
    get_requirement_profile: async () => foundRequirementProfile(),
    get_product_matching_status: async () => foundMatchingResult(), // selectedCandidate: null
  };
  const outcome = await runAgentTurn({ question: "Has a product been selected for item 28.19?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED", "the fabricated selection claim is filtered, not a turn failure");
  assert.equal(outcome.answer.facts.selectedCandidatePartNumber, null);
  assert.doesNotMatch(outcome.answer.summary, /is selected/i);
  assert.equal(outcome.answer.findings.some((f) => /is selected/i.test(f)), false);
});

// ============================================================
// Slice 4, Section 2: get_product_matching_status's itemId is injected
// server-side, the exact same discipline Slice 3 established for
// get_requirement_profile.
// ============================================================
test("Slice 4: get_product_matching_status's itemId is injected server-side from the item ALREADY resolved this turn -- the model's own transcription is never used", async () => {
  const decisionProvider = stubDecisionProvider([
    callTool("get_boq_item_context", { itemReference: "28.19" }),
    callTool("get_requirement_profile", { itemReference: shapedItem().itemId }),
    callTool("get_product_matching_status", { itemReference: "not-the-real-id-the-model-guessed" }),
    answerDecision(),
  ]);
  const answerProvider = stubAnswerProvider([explanationAnswer()]);
  let executedWithItemId = null;
  const toolExecutors = {
    get_boq_item_context: async () => foundResult(),
    get_requirement_profile: async () => foundRequirementProfile(),
    get_product_matching_status: async (args) => { executedWithItemId = args.itemId; return foundMatchingResult(); },
  };
  const outcome = await runAgentTurn({ question: "Why isn't item 28.19 matched?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED");
  assert.equal(executedWithItemId, shapedItem().itemId);
});

test("Slice 4: get_product_matching_status is rejected before execution if no item was resolved yet this turn at all (nothing to inject)", async () => {
  const decisionProvider = stubDecisionProvider([callTool("get_product_matching_status", { itemReference: "anything" })]);
  const answerProvider = stubAnswerProvider([]);
  let executed = false;
  const toolExecutors = { get_product_matching_status: async () => { executed = true; return foundMatchingResult(); } };
  const outcome = await runAgentTurn({ question: "q", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "FAILED_SAFE");
  assert.equal(outcome.diagnostics.groundingFailureReason, "PRODUCT_MATCHING_ITEM_MISMATCH");
  assert.equal(executed, false);
});

// ============================================================
// Slice 4.1, Section 3: tool-steering diagnostics -- tool names and step
// counters only, never raw project content -- proving live (and here,
// deterministically via a stub) that forcedSpecificToolCallSchema's pin
// matches what the model actually chose, one row per decision step.
// ============================================================
test("Slice 4.1: diagnostics.toolSteering records one row per decision step with the exact schema-pinned tool and the model's chosen tool", async () => {
  const decisionProvider = stubDecisionProvider([
    callTool("get_boq_item_context", { itemReference: "28.19" }),
    callTool("get_requirement_profile", { itemReference: shapedItem().itemId }),
    callTool("get_product_matching_status", { itemReference: shapedItem().itemId }),
    answerDecision(),
  ]);
  const answerProvider = stubAnswerProvider([explanationAnswer()]);
  const toolExecutors = {
    get_boq_item_context: async () => foundResult(),
    get_requirement_profile: async () => foundRequirementProfile(),
    get_product_matching_status: async () => foundMatchingResult(),
  };
  const outcome = await runAgentTurn({ question: "Why isn't item 28.19 matched?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED");
  const steering = outcome.diagnostics.toolSteering;
  assert.equal(steering.length, 4, "one row per decision step, including the final ANSWER decision");
  assert.deepEqual(steering[0].availableTools, ["get_project_status", "get_boq_item_context", "get_requirement_profile", "get_product_matching_status"]);
  assert.equal(steering[0].stepNumber, 0);
  assert.equal(steering[0].schemaPinnedTool, "get_boq_item_context", "item unresolved -- the only possible next tool is get_boq_item_context");
  assert.equal(steering[0].modelChosenTool, "get_boq_item_context");
  assert.equal(steering[1].schemaPinnedTool, "get_requirement_profile", "requirement-before-matching ordering (Section 11-A)");
  assert.equal(steering[1].modelChosenTool, "get_requirement_profile");
  assert.equal(steering[2].schemaPinnedTool, "get_product_matching_status");
  assert.equal(steering[2].modelChosenTool, "get_product_matching_status");
  assert.equal(steering[3].schemaPinnedTool, null, "no capability gap remains -- the decision is unforced, free to ANSWER");
});

test("Slice 4.1: toolSteering shows a mismatch when the model chooses a tool other than the schema-pinned one (a wrong-tool detour), for live steering-rate measurement", async () => {
  const decisionProvider = stubDecisionProvider([
    callTool("get_boq_item_context", { itemReference: "28.19" }),
    callTool("get_project_status"), // wrong tool -- pinned tool was get_requirement_profile
  ]);
  const answerProvider = stubAnswerProvider([]);
  const toolExecutors = {
    get_boq_item_context: async () => foundResult(),
    get_project_status: async () => shapeProjectStatus("p1", realWorkflow()),
  };
  const outcome = await runAgentTurn({ question: "Why isn't item 28.19 matched?", projectId: "p1", decisionProvider, answerProvider, toolExecutors, maxSteps: 2 });
  assert.equal(outcome.status, "FAILED_SAFE");
  const steering = outcome.diagnostics.toolSteering;
  assert.equal(steering[1].schemaPinnedTool, "get_requirement_profile");
  assert.equal(steering[1].modelChosenTool, "get_project_status", "the wrong-tool detour is visible in the diagnostics even though validateAgentStep did not reject it (get_project_status is a real registered tool, just not the pinned one)");
});

// ============================================================
// Slice 4, Section 12: tool efficiency -- matching is called ONLY for
// matching-flavored questions, never for quantity/requirements/project
// questions, and the OLD readiness intent still never calls it either
// (Slice 4's own brief: "Do NOT change that architecture").
// ============================================================
test("Slice 4, Section 12: a plain quantity question never calls get_product_matching_status", async () => {
  const decisionProvider = stubDecisionProvider([callTool("get_boq_item_context", { itemReference: "28.19" }), answerDecision()]);
  const answerProvider = stubAnswerProvider([explanationAnswer({ summary: "24" })]);
  const toolExecutors = {
    get_boq_item_context: async () => foundResult(),
    get_requirement_profile: async () => { throw new Error("must not be called"); },
    get_product_matching_status: async () => { throw new Error("must not be called for a plain quantity question"); },
  };
  const outcome = await runAgentTurn({ question: "What quantity are we using for item 28.19?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED");
  assert.deepEqual(outcome.diagnostics.toolsCalled, ["get_boq_item_context"]);
});

test("Slice 4, Section 12: a requirements question never calls get_product_matching_status", async () => {
  const decisionProvider = stubDecisionProvider([
    callTool("get_boq_item_context", { itemReference: "28.19" }),
    callTool("get_requirement_profile", { itemReference: shapedItem().itemId }),
    answerDecision(),
  ]);
  const answerProvider = stubAnswerProvider([explanationAnswer()]);
  const toolExecutors = {
    get_boq_item_context: async () => foundResult(),
    get_requirement_profile: async () => foundRequirementProfile(),
    get_product_matching_status: async () => { throw new Error("must not be called for a plain requirements question"); },
  };
  const outcome = await runAgentTurn({ question: "What requirements apply to item 28.19?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED");
  assert.deepEqual(outcome.diagnostics.toolsCalled, ["get_boq_item_context", "get_requirement_profile"]);
});

test("Slice 4, Section 12: the OLD plain readiness question ('why isn't it ready') still never calls get_product_matching_status -- Slice 3.1 behavior is unchanged", async () => {
  const decisionProvider = stubDecisionProvider([
    callTool("get_boq_item_context", { itemReference: "28.19" }),
    callTool("get_requirement_profile", { itemReference: shapedItem().itemId }),
    answerDecision(),
  ]);
  const answerProvider = stubAnswerProvider([explanationAnswer()]);
  const toolExecutors = {
    get_boq_item_context: async () => foundResult(),
    get_requirement_profile: async () => foundRequirementProfile(),
    get_product_matching_status: async () => { throw new Error("must not be called for the plain 'ready' phrasing"); },
  };
  const outcome = await runAgentTurn({ question: "Why isn't BOQ item 28.19 ready?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED");
  assert.equal(outcome.diagnostics.questionIntent, "ITEM_READINESS_REASON");
  assert.deepEqual(outcome.diagnostics.toolsCalled, ["get_boq_item_context", "get_requirement_profile"]);
});

test("Slice 4, Section 12: a project blocker question calls only get_project_status, never any item tool", async () => {
  const shaped = shapeProjectStatus("p1", realWorkflow());
  const decisionProvider = stubDecisionProvider([callTool("get_project_status"), answerDecision()]);
  const answerProvider = stubAnswerProvider([explanationAnswer()]);
  const toolExecutors = {
    get_project_status: async () => shaped,
    get_boq_item_context: async () => { throw new Error("must not be called"); },
    get_requirement_profile: async () => { throw new Error("must not be called"); },
    get_product_matching_status: async () => { throw new Error("must not be called"); },
  };
  const outcome = await runAgentTurn({ question: "What is blocking the project?", projectId: "p1", decisionProvider, answerProvider, toolExecutors });
  assert.equal(outcome.status, "COMPLETED");
  assert.deepEqual(outcome.diagnostics.toolsCalled, ["get_project_status"]);
});
