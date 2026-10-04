import assert from "node:assert/strict";
import test from "node:test";
import {
  BOQ_RECONCILIATION_MATERIALITY,
  BOQ_RECONCILIATION_QUESTION_TYPE,
  BOQ_RECONCILIATION_VERDICTS,
  mapReasonerResultToBoqVerdict,
  reconcileBoqLineDeterministically,
  reconcileBoqScope,
} from "../app/domain/boq-reconciliation-reasoner.mjs";
import { normalizeReasoningEvidence, validateReasoningResult } from "../app/domain/project-evidence-reasoner.mjs";

const PROJECT = "proj-boq";
const DOC = "doc-1";
const VER = "ver-1";
const EX = "ex-1";

const cand = (over = {}) => ({
  id: "c1",
  description: "Fireman telephone jack",
  unit: "No",
  quantity: 73,
  sourceAnchors: [29, 80, 121, 166],
  ...over,
});
// Two source wordings behind one consolidated candidate -> genuinely NON-EXACT,
// so the deterministic layer must hand it to the model rather than classify it.
const variantRows = (over = {}) => [
  { sourceRow: 17, description: "combined smoke and heat detector", quantity: 6, unit: "No" },
  { sourceRow: 65, description: "combined smoke and heat SENSOR", quantity: 10, unit: "No" },
  { sourceRow: 109, description: "combined smoke and heat detector", quantity: 9, unit: "No" },
  { sourceRow: 150, description: "combined smoke and heat sensor", quantity: 6, unit: "No" },
].map((r) => ({ scope: "PROJECT", projectId: PROJECT, documentId: DOC, documentVersionId: VER, currentness: "CURRENT", governanceState: "UNSPECIFIED", authorityCeiling: "SUPPORTING", ...r, ...over }));
const variantCand = () => cand({ id: "c-det", description: "Combined smoke and heat detector", quantity: 31, sourceAnchors: [17, 65, 109, 150] });

const rows = (over = {}) => [
  { sourceRow: 29, description: "Fireman telephone jack", quantity: 19, unit: "No", section: "FA" },
  { sourceRow: 80, description: "Fireman telephone jack", quantity: 24, unit: "No", section: "FA" },
  { sourceRow: 121, description: "Fireman telephone jack", quantity: 24, unit: "No", section: "FA" },
  { sourceRow: 166, description: "Fireman telephone jack", quantity: 6, unit: "No", section: "FA" },
].map((r) => ({ ...r, ...over }));

test("1: EXACT equality is classified deterministically and NEVER reaches the model", async () => {
  let called = 0;
  const provider = { interpret: async () => { called += 1; throw new Error("must not be called"); } };
  const currentLine = { description: "Fireman telephone jack", unit: "Each", quantity: 73, sourceAnchors: [29, 80, 121, 166] };
  const outcome = await reconcileBoqScope({
    projectId: PROJECT, documentId: DOC, documentVersionId: VER, extractionId: EX,
    candidates: [cand()], currentLines: [currentLine], sourceRows: rows(), provider,
  });
  assert.equal(outcome.deterministicExactMatches, 1);
  assert.equal(outcome.aiCalls, 0, "an exact line must cost zero model calls");
  assert.equal(called, 0, "the provider must never be invoked for exact equality");
  assert.equal(outcome.materialDifferences.length, 0);
  // Unit normalisation No -> Each is equivalence, not a conflict.
  assert.equal(reconcileBoqLineDeterministically({ candidate: cand(), currentLine, sourceRows: rows() }).isExact, true);
});

test("2: the model can NEVER alter quantity, unit or source anchors", async () => {
  // A model that tries to restate the quantity is rejected outright.
  const evidence = [{ evidenceId: "e1", evidenceKey: "k", sourceType: "BOQ_SOURCE_ROW" }];
  const hostile = validateReasoningResult({
    result: {
      status: "RESOLVED",
      proposedInterpretation: "The consolidated quantity should be 999 and the unit changed to Lump Sum",
      reasoningSummary: "quantity 999 lump sum",
      evidenceAssessment: [{ evidenceId: "e1", relationship: "CORROBORATION", explanation: "x" }],
      recommendedAction: "KEEP_NOT_PROVEN",
      modelConfidence: 0.9,
    },
    evidence,
  });
  assert.equal(hostile.ok, false);
  assert.ok(hostile.errors.includes("QUANTITY_CLAIM_FORBIDDEN"), "quantity claims are structurally forbidden");

  // And the adapter re-derives those three fields deterministically regardless.
  const provider = {
    metadata: { provider: "test", model: "test" },
    interpret: async () => ({
      status: "RESOLVED",
      proposedInterpretation: "Same scope.",
      reasoningSummary: "Same device class.",
      evidenceAssessment: [],
      recommendedAction: "KEEP_NOT_PROVEN",
      modelConfidence: 0.8,
    }),
  };
  const out = await reconcileBoqScope({
    projectId: PROJECT, documentId: DOC, documentVersionId: VER, extractionId: EX,
    candidates: [variantCand()], currentLines: [], sourceRows: variantRows(), provider,
  });
  const entry = out.nonExact[0];
  assert.ok(entry, "a wording variant must reach the model");
  assert.equal(entry.sourceAnchors.join(","), "17,65,109,150", "anchors come from the candidate, not the model");
  assert.equal(entry.sourceQuantity, 31, "quantity comes from the source rows, not the model");
});

test("3: outputs citing nonexistent evidence IDs are rejected", async () => {
  const provider = {
    metadata: { provider: "test", model: "test" },
    interpret: async () => ({
      status: "RESOLVED",
      proposedInterpretation: "Same.",
      reasoningSummary: "Same.",
      evidenceAssessment: [{ evidenceId: "EVIDENCE_THAT_DOES_NOT_EXIST", relationship: "CORROBORATION", explanation: "invented" }],
      recommendedAction: "KEEP_NOT_PROVEN",
      modelConfidence: 0.9,
    }),
  };
  const out = await reconcileBoqScope({
    projectId: PROJECT, documentId: DOC, documentVersionId: VER, extractionId: EX,
    candidates: [variantCand()], currentLines: [], provider, sourceRows: variantRows(),
  });
  const entry = out.nonExact[0];
  assert.equal(entry.ai.status, "INSUFFICIENT_EVIDENCE", "a fabricated citation must fail the whole output closed");
  assert.equal(entry.ai.verdict.verdict, "INSUFFICIENT_EVIDENCE");
});

test("4: source / project / version isolation is preserved", () => {
  const { accepted, excluded } = normalizeReasoningEvidence({
    projectId: PROJECT,
    evidence: [
      { evidenceKey: "mine", scope: "PROJECT", projectId: PROJECT, extractedText: "ok", currentness: "CURRENT" },
      { evidenceKey: "foreign", scope: "PROJECT", projectId: "other-project", extractedText: "ok", currentness: "CURRENT" },
      { evidenceKey: "stale", scope: "PROJECT", projectId: PROJECT, extractedText: "ok", currentness: "STALE" },
      { evidenceKey: "superseded", scope: "PROJECT", projectId: PROJECT, extractedText: "ok", superseded: true },
    ],
  });
  assert.deepEqual(accepted.map((e) => e.evidenceKey), ["mine"]);
  assert.ok(excluded.some((e) => e.reason === "FOREIGN_PROJECT_EVIDENCE"));
  assert.ok(excluded.some((e) => e.reason === "STALE_EVIDENCE"));
  assert.ok(excluded.some((e) => e.reason === "STALE_EVIDENCE"));
});

test("5: a wording-only difference is recognised as a NORMALIZATION_EQUIVALENT, non-material", async () => {
  const variantRows = [
    { sourceRow: 17, description: "combined smoke and heat detector", quantity: 6, unit: "No" },
    { sourceRow: 65, description: "combined smoke and heat SENSOR", quantity: 10, unit: "No" },
    { sourceRow: 109, description: "combined smoke and heat detector", quantity: 9, unit: "No" },
    { sourceRow: 150, description: "combined smoke and heat sensor", quantity: 6, unit: "No" },
  ];
  const provider = {
    metadata: { provider: "test", model: "test" },
    interpret: async () => ({
      status: "RESOLVED",
      proposedInterpretation: "Detector and sensor are the same device class on this BOQ.",
      reasoningSummary: "Both wordings describe the same combined smoke and heat sensing device; the wording varies between buildings.",
      evidenceAssessment: [],
      recommendedAction: "KEEP_NOT_PROVEN",
      modelConfidence: 0.86,
    }),
  };
  const out = await reconcileBoqScope({
    projectId: PROJECT, documentId: DOC, documentVersionId: VER, extractionId: EX,
    candidates: [cand({ id: "c-det", description: "Combined smoke and heat detector", quantity: 31, sourceAnchors: [17, 65, 109, 150] })],
    currentLines: [],
    sourceRows: variantRows.map((r) => ({ ...r, scope: "PROJECT", projectId: PROJECT, documentId: DOC, documentVersionId: VER, currentness: "CURRENT", governanceState: "UNSPECIFIED", authorityCeiling: "SUPPORTING" })),
    provider,
  });
  const entry = out.nonExact[0];
  assert.equal(entry.ai.verdict.verdict, "NORMALIZATION_EQUIVALENT");
  assert.equal(entry.ai.verdict.materiality, "NON_MATERIAL");
  assert.equal(out.materialDifferences.length, 0, "a wording difference must not become human review work");
});

test("6: a quantity conflict stays MATERIAL", async () => {
  const det = reconcileBoqLineDeterministically({ candidate: cand({ quantity: 73 }), sourceRows: rows() });
  const conflicting = reconcileBoqLineDeterministically({ candidate: cand({ quantity: 99 }), sourceRows: rows() });
  assert.equal(det.isExact, true);
  assert.equal(conflicting.isExact, false);
  assert.ok(conflicting.differences.some((d) => d.field === "consolidatedQuantity"));
  const mapped = mapReasonerResultToBoqVerdict({
    deterministic: conflicting,
    result: { status: "RESOLVED", reasoningSummary: "differs", proposedInterpretation: "x", modelConfidence: 0.7, citedEvidenceIds: [] },
  });
  assert.equal(mapped.verdict, "QUANTITY_CONFLICT");
  assert.equal(mapped.materiality, "MATERIAL");
});

test("7: a unit conflict stays MATERIAL", () => {
  const conflicting = reconcileBoqLineDeterministically({
    candidate: cand({ unit: "No" }),
    currentLine: { description: "Fireman telephone jack", unit: "Lump Sum", quantity: 73, sourceAnchors: [29, 80, 121, 166] },
    sourceRows: rows(),
  });
  assert.ok(conflicting.differences.some((d) => d.field === "unit"));
  const mapped = mapReasonerResultToBoqVerdict({ deterministic: conflicting, result: { status: "RESOLVED", reasoningSummary: "d", proposedInterpretation: "x", modelConfidence: 0.7 } });
  assert.equal(mapped.verdict, "UNIT_CONFLICT");
  assert.equal(mapped.materiality, "MATERIAL");
});

test("8: split / merge recommendations remain PROPOSALS only — no authority", async () => {
  const provider = {
    metadata: { provider: "test", model: "test" },
    interpret: async () => ({
      status: "RESOLVED",
      proposedInterpretation: "These two lines should be split into separate devices.",
      reasoningSummary: "A split is recommended.",
      evidenceAssessment: [],
      recommendedAction: "HUMAN_REVIEW",
      modelConfidence: 0.8,
    }),
  };
  const out = await reconcileBoqScope({
    projectId: PROJECT, documentId: DOC, documentVersionId: VER, extractionId: EX,
    candidates: [variantCand()], currentLines: [], sourceRows: variantRows(), provider,
  });
  assert.equal(out.state, "AI_PROPOSED");
  assert.equal(out.authorityWrites, 0);
  assert.equal(out.nonExact[0].ai.verdict.recommendedAction, "HUMAN_REVIEW");
});

test("9: provider failure returns human review, never a guessed equivalence", async () => {
  for (const provider of [null, { interpret: async () => { throw new Error("upstream 503"); } }]) {
    const out = await reconcileBoqScope({
      projectId: PROJECT, documentId: DOC, documentVersionId: VER, extractionId: EX,
      candidates: [cand({ quantity: 50 })], currentLines: [], sourceRows: rows(), provider,
    });
    const entry = out.nonExact[0];
    assert.ok(["INSUFFICIENT_EVIDENCE", "QUANTITY_CONFLICT"].includes(entry.ai?.verdict?.verdict));
    assert.notEqual(entry.ai?.verdict?.verdict, "SEMANTICALLY_IDENTICAL", "a failure must never read as equivalence");
    if (entry.ai?.verdict?.verdict === "INSUFFICIENT_EVIDENCE") assert.equal(entry.ai.verdict.materiality, "MATERIAL");
  }
});

test("10: the run performs NO current-BOQ writes and stays inside the closed vocabularies", async () => {
  const provider = {
    metadata: { provider: "test", model: "test" },
    interpret: async () => ({
      status: "RESOLVED", proposedInterpretation: "same", reasoningSummary: "same",
      evidenceAssessment: [], recommendedAction: "KEEP_NOT_PROVEN", modelConfidence: 0.9,
    }),
  };
  const rowsFixture = variantRows();
  const before = structuredClone(rowsFixture);
  const out = await reconcileBoqScope({
    projectId: PROJECT, documentId: DOC, documentVersionId: VER, extractionId: EX,
    candidates: [variantCand()], currentLines: [], sourceRows: rowsFixture, provider,
  });
  assert.deepEqual(rowsFixture, before, "source rows must be untouched");
  assert.equal(out.authorityWrites, 0);
  assert.equal(out.questionType, BOQ_RECONCILIATION_QUESTION_TYPE);
  for (const entry of out.nonExact) {
    assert.ok(BOQ_RECONCILIATION_VERDICTS.includes(entry.ai?.verdict?.verdict));
    assert.ok(BOQ_RECONCILIATION_MATERIALITY.includes(entry.ai?.verdict?.materiality));
  }
});

const ROWS = rows().map((r) => ({ ...r, scope: "PROJECT", projectId: PROJECT, documentId: DOC, documentVersionId: VER, currentness: "CURRENT", governanceState: "UNSPECIFIED", authorityCeiling: "SUPPORTING" }));
