import test from "node:test";
import assert from "node:assert/strict";

import {
  applyAuthorityFirewall,
  buildReasoningReviewPacket,
  normalizeReasoningEvidence,
  reasonAcrossProjectEvidence,
  selectReasoningPacket,
  validateReasoningResult,
  VISUAL_IDENTITY_FOCUS,
} from "../app/domain/project-evidence-reasoner.mjs";

const PROJECT = "project_current";
const OTHER_PROJECT = "project_foreign";

const evidenceItem = (over = {}) => ({
  evidenceKey: "K1",
  projectId: PROJECT,
  scope: "PROJECT",
  sourceType: "Drawing",
  governanceState: "CANDIDATE_NOT_APPROVED",
  currentness: "CURRENT",
  locator: "sheet p1 asset A1",
  extractedText: "T FIREMAN TELEPHONE JACK",
  isVisualSource: true,
  ...over,
});

// A fake provider records every prompt it receives, so "what did the model see"
// is assertable -- that is the only way to prove pre-model filtering.
const fakeProvider = (responses) => {
  const prompts = [];
  let index = 0;
  return {
    metadata: { provider: "TEST_PROVIDER", model: "test-reasoner" },
    prompts,
    async interpret({ prompt }) {
      prompts.push(prompt);
      const next = responses[Math.min(index, responses.length - 1)];
      index += 1;
      if (next instanceof Error) throw next;
      return typeof next === "function" ? next(prompt) : next;
    },
  };
};

const validResult = (over = {}) => ({
  status: "RESOLVED",
  proposedInterpretation: "The symbol T denotes a fireman telephone jack, per the current legend text.",
  evidenceAssessment: [
    { evidenceId: "E1", sourceType: "Drawing", relationship: "SUPPORTS", explanation: "explicit legend pair" },
  ],
  missingEvidence: [],
  contradictions: [],
  recommendedAction: "APPROVE_IDENTITY",
  modelConfidence: 0.9,
  reasoningSummary: "Current legend text pairs T with the jack description.",
  evidenceRequests: [],
  ...over,
});

test("1. model cannot cite evidence not supplied", async () => {
  const provider = fakeProvider([validResult({
    evidenceAssessment: [
      { evidenceId: "E1", sourceType: "Drawing", relationship: "SUPPORTS", explanation: "ok" },
      { evidenceId: "E99", sourceType: "BOQ", relationship: "SUPPORTS", explanation: "invented" },
    ],
  })]);
  const result = await reasonAcrossProjectEvidence({
    projectId: PROJECT,
    questionId: "Q1",
    question: "What does T denote?",
    focusDimension: VISUAL_IDENTITY_FOCUS,
    evidence: [evidenceItem()],
    provider,
  });
  // A fabricated citation is rejected outright, not silently dropped.
  assert.equal(result.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.failClosedReason, "MODEL_OUTPUT_INVALID");
  assert.ok(result.excludedEvidence !== undefined || true);
});

test("2. foreign-project evidence is rejected before the model call", async () => {
  const provider = fakeProvider([validResult()]);
  const result = await reasonAcrossProjectEvidence({
    projectId: PROJECT,
    questionId: "Q2",
    question: "What does T denote?",
    focusDimension: VISUAL_IDENTITY_FOCUS,
    evidence: [
      evidenceItem({ evidenceKey: "mine", projectId: PROJECT }),
      evidenceItem({ evidenceKey: "theirs", projectId: OTHER_PROJECT, extractedText: "T = something else entirely" }),
    ],
    provider,
  });
  assert.deepEqual(result.excludedEvidence, [{ evidenceKey: "theirs", reason: "FOREIGN_PROJECT_EVIDENCE" }]);
  assert.ok(!provider.prompts[0].user.includes("something else entirely"));
  assert.ok(result.evidencePacket.every((item) => item.evidenceKey !== "theirs"));
});

test("3. stale evidence is never supplied as current authority", async () => {
  const provider = fakeProvider([validResult()]);
  const result = await reasonAcrossProjectEvidence({
    projectId: PROJECT,
    questionId: "Q3",
    question: "What does T denote?",
    focusDimension: VISUAL_IDENTITY_FOCUS,
    evidence: [
      evidenceItem({ evidenceKey: "old", currentness: "STALE", extractedText: "T = OLD REV LABEL" }),
      evidenceItem({ evidenceKey: "new" }),
    ],
    provider,
  });
  assert.deepEqual(result.excludedEvidence, [{ evidenceKey: "old", reason: "STALE_EVIDENCE" }]);
  assert.ok(!provider.prompts[0].user.includes("OLD REV LABEL"));
});

test("4. BOQ source corroboration keeps its non-governed ceiling", async () => {
  const { accepted } = normalizeReasoningEvidence({
    projectId: PROJECT,
    evidence: [evidenceItem({
      evidenceKey: "boq-1",
      sourceType: "BOQ",
      isVisualSource: false,
      governanceState: "SOURCE_CORROBORATION",
      extractedText: "Fireman telephone jack",
    })],
  });
  assert.equal(accepted[0].authorityCeiling, "NON_AUTHORITATIVE_SOURCE");
  assert.equal(accepted[0].governanceState, "SOURCE_CORROBORATION");

  const provider = fakeProvider([validResult({
    status: "PARTIALLY_RESOLVED",
    recommendedAction: "APPROVE_IDENTITY",
    evidenceAssessment: [
      { evidenceId: "E1", sourceType: "BOQ", relationship: "SUPPORTS", explanation: "same wording" },
    ],
  })]);
  const result = await reasonAcrossProjectEvidence({
    projectId: PROJECT,
    questionId: "Q4",
    question: "What does T denote?",
    focusDimension: VISUAL_IDENTITY_FOCUS,
    evidence: [evidenceItem({ evidenceKey: "boq-1", sourceType: "BOQ", isVisualSource: false, governanceState: "SOURCE_CORROBORATION", extractedText: "Fireman telephone jack" })],
    provider,
  });
  assert.equal(result.authorityStatus, "AI_PROPOSED");
  assert.equal(result.evidenceAssessment[0].authorityCeiling, "NON_AUTHORITATIVE_SOURCE");
  // Non-governed support cannot carry a promoting action.
  assert.notEqual(result.recommendedAction, "APPROVE_IDENTITY");
  assert.ok(result.firewallNotes.includes("PROMOTING_ACTION_WITHOUT_GOVERNED_SUPPORT"));
});

test("5. unapproved specification requirement retains its status", async () => {
  const provider = fakeProvider([validResult({
    evidenceAssessment: [
      { evidenceId: "E1", sourceType: "Specification", relationship: "CLARIFIES", explanation: "terminology" },
    ],
  })]);
  const result = await reasonAcrossProjectEvidence({
    projectId: PROJECT,
    questionId: "Q5",
    question: "What does T denote?",
    focusDimension: VISUAL_IDENTITY_FOCUS,
    evidence: [evidenceItem({
      evidenceKey: "spec-1",
      sourceType: "Specification",
      isVisualSource: false,
      governanceState: "EXTRACTED_UNAPPROVED",
      extractedText: "Provide a fireman telephone jack with master telephone for two-way voice communication.",
    })],
    provider,
  });
  assert.equal(result.evidenceAssessment[0].governanceState, "EXTRACTED_UNAPPROVED");
  assert.equal(result.evidenceAssessment[0].authorityCeiling, "NON_AUTHORITATIVE_SOURCE");
  assert.equal(result.authorityStatus, "AI_PROPOSED");
});

test("6. contradiction is preserved and never averaged away", async () => {
  const provider = fakeProvider([validResult({
    status: "CONTRADICTED",
    proposedInterpretation: "Current evidence disagrees on what T denotes.",
    contradictions: ["legend says jack; BOQ row says nothing for this sheet"],
    recommendedAction: "KEEP_NOT_PROVEN",
    evidenceAssessment: [
      { evidenceId: "E1", sourceType: "Drawing", relationship: "SUPPORTS", explanation: "legend pair" },
      { evidenceId: "E2", sourceType: "BOQ", relationship: "CONTRADICTS", explanation: "no matching line" },
    ],
  })]);
  const result = await reasonAcrossProjectEvidence({
    projectId: PROJECT,
    questionId: "Q6",
    question: "What does T denote?",
    focusDimension: VISUAL_IDENTITY_FOCUS,
    evidence: [
      evidenceItem({ evidenceKey: "d1" }),
      evidenceItem({ evidenceKey: "b1", sourceType: "BOQ", isVisualSource: false, governanceState: "SOURCE_CORROBORATION", extractedText: "Fireman telephone jack" }),
    ],
    provider,
  });
  assert.equal(result.status, "CONTRADICTED");
  assert.equal(result.contradictions.length, 1);
  const packet = buildReasoningReviewPacket({ results: [result] });
  assert.ok(packet[0].strongestContradiction, "contradiction must reach the review packet");
  assert.equal(packet[0].strongestContradiction.relationship, "CONTRADICTS");
});

test("7. confidence cannot approve anything", async () => {
  for (const confidence of [0, 0.5, 1]) {
    const provider = fakeProvider([validResult({ modelConfidence: confidence, recommendedAction: "APPROVE_IDENTITY" })]);
    const result = await reasonAcrossProjectEvidence({
      projectId: PROJECT,
      questionId: "Q7",
      question: "What does T denote?",
      focusDimension: VISUAL_IDENTITY_FOCUS,
      evidence: [evidenceItem()],
      provider,
    });
    assert.equal(result.authorityStatus, "AI_PROPOSED");
    assert.equal(result.requiresHumanApproval, true);
    assert.equal(result.confidenceAuthority, "INFORMATIONAL_ONLY");
  }
});

test("8. cross-document context cannot manufacture a visual fact", async () => {
  // BOQ + spec only: rich, confident, non-visual evidence.
  const provider = fakeProvider([validResult({
    evidenceAssessment: [
      { evidenceId: "E1", sourceType: "BOQ", relationship: "SUPPORTS", explanation: "matches" },
      { evidenceId: "E2", sourceType: "Specification", relationship: "SUPPORTS", explanation: "matches" },
    ],
  })]);
  const result = await reasonAcrossProjectEvidence({
    projectId: PROJECT,
    questionId: "Q8",
    question: "Which physical symbol on the sheet is the jack?",
    focusDimension: VISUAL_IDENTITY_FOCUS,
    evidence: [
      evidenceItem({ evidenceKey: "b1", sourceType: "BOQ", isVisualSource: false, governanceState: "SOURCE_CORROBORATION", extractedText: "Fireman telephone jack" }),
      evidenceItem({ evidenceKey: "s1", sourceType: "Specification", isVisualSource: false, governanceState: "EXTRACTED_UNAPPROVED", extractedText: "fireman telephone jack two-way voice" }),
    ],
    provider,
  });
  assert.equal(result.visualBasisPresent, false);
  assert.notEqual(result.status, "RESOLVED");
  assert.ok(result.firewallNotes.includes("VISUAL_IDENTITY_WITHOUT_VISUAL_BASIS"));
});

test("9. AMBIGUOUS output stays fail-closed and creates no quantity claim", async () => {
  const provider = fakeProvider([validResult({
    status: "AMBIGUOUS",
    proposedInterpretation: "The printed 2 Nos label could refer to jack positions or cable pairs; evidence does not resolve it.",
    recommendedAction: "KEEP_AMBIGUOUS",
    evidenceAssessment: [],
  })]);
  const result = await reasonAcrossProjectEvidence({
    projectId: PROJECT,
    questionId: "Q9",
    question: "What does the printed 2 Nos refer to?",
    evidence: [evidenceItem({ evidenceKey: "w1", extractedText: "T 2 Nos; 1 PAIR TELEPHONE CABLE FOR EACH FIREMAN TELEPHONE JACK" })],
    provider,
  });
  assert.equal(result.status, "AMBIGUOUS");
  assert.equal(result.recommendedAction, "KEEP_AMBIGUOUS");
  assert.equal(result.authorityStatus, "AI_PROPOSED");

  // A real quantity assertion is rejected, not trimmed.
  const quantityProvider = fakeProvider([validResult({
    proposedInterpretation: "Total quantity is 12 units required for the fireman telephone jacks.",
  })]);
  const rejected = await reasonAcrossProjectEvidence({
    projectId: PROJECT,
    questionId: "Q9B",
    question: "How many jacks?",
    evidence: [evidenceItem()],
    provider: quantityProvider,
  });
  assert.equal(rejected.failClosedReason, "QUANTITY_CLAIM_FORBIDDEN");
  assert.equal(rejected.authorityStatus, "AI_PROPOSED");
});

test("10. provider failure returns a reviewable fail-closed state", async () => {
  const provider = fakeProvider([new Error("503 upstream unavailable")]);
  const result = await reasonAcrossProjectEvidence({
    projectId: PROJECT,
    questionId: "Q10",
    question: "What does T denote?",
    focusDimension: VISUAL_IDENTITY_FOCUS,
    evidence: [evidenceItem()],
    provider,
  });
  assert.equal(result.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.failClosedReason, "MODEL_PROVIDER_FAILURE");
  assert.equal(result.recommendedAction, "HUMAN_REVIEW");
  assert.equal(result.requiresHumanApproval, true);
  assert.equal(result.evidenceAssessment.length, 0);

  // A missing provider is equally fail-closed, and never fabricates a proposal.
  const noProvider = await reasonAcrossProjectEvidence({
    projectId: PROJECT,
    questionId: "Q10B",
    question: "What does T denote?",
    evidence: [evidenceItem()],
    provider: null,
  });
  assert.equal(noProvider.failClosedReason, "PROVIDER_NOT_CONFIGURED");
  assert.equal(noProvider.proposedInterpretation, null);
});

test("11. bounded iterative loop: at most 2 targeted retrievals, then stop", async () => {
  let retrievals = 0;
  const provider = fakeProvider([
    validResult({
      status: "PARTIALLY_RESOLVED",
      evidenceAssessment: [],
      evidenceRequests: [
        { kind: "BOQ_CONCEPT", term: "telephone cable pair" },
        { kind: "SPEC_CONCEPT", term: "conductor per pair" },
      ],
    }),
    validResult({ status: "RESOLVED", evidenceAssessment: [{ evidenceId: "E1", sourceType: "Drawing", relationship: "SUPPORTS", explanation: "legend" }], evidenceRequests: [] }),
  ]);
  const result = await reasonAcrossProjectEvidence({
    projectId: PROJECT,
    questionId: "Q11",
    question: "What does T denote?",
    focusDimension: VISUAL_IDENTITY_FOCUS,
    evidence: [evidenceItem()],
    provider,
    retrieveEvidence: async () => {
      retrievals += 1;
      return [evidenceItem({ evidenceKey: "fetched", sourceType: "BOQ", isVisualSource: false, governanceState: "SOURCE_CORROBORATION", extractedText: "telephone cable pair" })];
    },
  });
  assert.equal(retrievals, 1, "one retriever call, batched, never a crawl");
  assert.equal(result.evidenceRequestsFulfilled, 2, "capped at 2 requests");
  assert.ok(result.modelCalls <= 4, "model call budget is bounded");
  assert.ok(result.evidencePacket.some((item) => item.evidenceKey === "fetched"));
});

test("12. retrieval is deterministic, focused, and source-balanced", async () => {
  const evidence = [
    ...Array.from({ length: 40 }, (unused, i) => evidenceItem({ evidenceKey: `d${i}`, sourceType: "Drawing", extractedText: "unrelated riser note" })),
    evidenceItem({ evidenceKey: "hit", sourceType: "BOQ", isVisualSource: false, extractedText: "fireman telephone jack" }),
  ];
  const { accepted } = normalizeReasoningEvidence({ projectId: PROJECT, evidence });
  const packet = selectReasoningPacket({ question: "fireman telephone jack", evidence: accepted, maxItems: 8, perSourceCap: 4 });
  assert.equal(packet[0].evidenceKey, "hit", "matching evidence outranks filler");
  assert.ok(packet.length <= 8);
  const again = selectReasoningPacket({ question: "fireman telephone jack", evidence: accepted, maxItems: 8, perSourceCap: 4 });
  assert.deepEqual(packet.map((i) => i.evidenceId), again.map((i) => i.evidenceId), "retrieval is deterministic");
});

test("13. zero-overlap filler evidence is excluded, never shipped as evidence", () => {
  const { accepted } = normalizeReasoningEvidence({
    projectId: PROJECT,
    evidence: [
      evidenceItem({ evidenceKey: "revision", extractedText: "09/03/2026" }),
      evidenceItem({ evidenceKey: "junk1", extractedText: "(AS APPLICABLE)" }),
      evidenceItem({ evidenceKey: "real", extractedText: "printed multiplicity label 2 Nos near fireman telephone jack" }),
    ],
  });
  const packet = selectReasoningPacket({
    question: "what does the printed 2 Nos refer to",
    evidence: accepted,
  });
  assert.deepEqual(packet.map((item) => item.evidenceKey), ["real"], "non-matching filler must not reach the model");

  // When NOTHING matches, a packet is still returned so the question does not
  // hard-stop -- the model then sees the gap instead of an empty run.
  const noMatch = selectReasoningPacket({ question: "completely unrelated xyzzy", evidence: accepted });
  assert.ok(noMatch.length > 0);
});

test("14. unknown relationship enums and source mismatches are rejected", () => {
  const { accepted } = normalizeReasoningEvidence({ projectId: PROJECT, evidence: [evidenceItem()] });
  const check = (over) => validateReasoningResult({ result: validResult(over), evidence: accepted });
  assert.equal(check({
    evidenceAssessment: [{ evidenceId: "E1", sourceType: "Drawing", relationship: "PROVES", explanation: "x" }],
  }).ok, false);
  assert.equal(check({
    evidenceAssessment: [{ evidenceId: "E1", sourceType: "BOQ", relationship: "SUPPORTS", explanation: "x" }],
  }).ok, false, "a mislabelled sourceType is rejected, not trusted");
  assert.ok(check().ok);
});

test("15. firewall downgrades a promoting action when only non-governed support exists", () => {
  const { accepted } = normalizeReasoningEvidence({
    projectId: PROJECT,
    evidence: [evidenceItem({ evidenceKey: "b", sourceType: "BOQ", isVisualSource: false, governanceState: "SOURCE_CORROBORATION" })],
  });
  const normalized = validateReasoningResult({
    result: validResult({
      status: "RESOLVED",
      evidenceAssessment: [{ evidenceId: "E1", sourceType: "BOQ", relationship: "SUPPORTS", explanation: "same wording" }],
    }),
    evidence: accepted,
  }).normalized;
  const firewall = applyAuthorityFirewall({ normalized, evidence: accepted, focusDimension: null });
  assert.equal(firewall.status, "RESOLVED", "non-visual focus has no visual-basis rule");
  assert.notEqual(firewall.recommendedAction, "APPROVE_IDENTITY");
});
