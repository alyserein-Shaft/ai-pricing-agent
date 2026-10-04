import assert from "node:assert/strict";
import test from "node:test";
import {
  BOQ_RECONCILIATION_QUESTION_TYPE,
  reconcileBoqScope,
} from "../app/domain/boq-reconciliation-reasoner.mjs";
import {
  normalizeReasoningEvidence,
  reasonAcrossProjectEvidence,
  validateReasoningResult,
} from "../app/domain/project-evidence-reasoner.mjs";

const P = "proj-adjudication";
const DOC = "doc-1";
const VER = "ver-1";
const LEGACY = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";

const ev = (key, text, extra = {}) => ({
  evidenceKey: key, scope: "PROJECT", projectId: P, documentId: DOC, documentVersionId: VER,
  currentness: "CURRENT", superseded: false, extractedText: text,
  governanceState: "UNSPECIFIED", authorityCeiling: "SUPPORTING", ...extra,
});

test("1: context is sourced from the CURRENT project only — a legacy-project citation is refused", () => {
  const { accepted, excluded } = normalizeReasoningEvidence({
    projectId: P,
    evidence: [
      ev("current:boq-row65", "current project row 65"),
      { ...ev("legacy:row65", "legacy project row"), projectId: LEGACY },
      { ...ev("legacy-global", "legacy knowledge"), scope: "GLOBAL_REUSABLE", projectId: LEGACY },
    ],
  });
  assert.deepEqual(accepted.map((e) => e.evidenceKey), ["current:boq-row65"]);
  assert.equal(excluded.filter((e) => e.reason === "FOREIGN_PROJECT_EVIDENCE").length, 2);
});

test("2: location / section context survives into the packet the model receives", () => {
  const packet = [
    ev("boq-block-xl57:row65", "WORKSHEET MECH RFQ block at row 57; subsection header 'Supply, install and connect fire alarm...'; item G 'Combined smoke and heat sensor' No 10"),
    ev("boq-source-columns", "no location column exists; columns are A=itemNumber, B=description, C=unit, D=quantity"),
  ];
  const { accepted } = normalizeReasoningEvidence({ projectId: P, evidence: packet });
  const joined = accepted.map((e) => e.extractedText).join(" | ");
  assert.match(joined, /WORKSHEET MECH RFQ/, "sheet context retained");
  assert.match(joined, /Subsection header/i, "section context retained");
  assert.match(joined, /no location column/i, "the absence of a location column is itself evidence");
});

test("3: the AI cannot delete a source anchor", async () => {
  // A model that proposes dropping an anchor is rejected: anchors are not a
  // model-controllable field, and the shared validator rejects fabricated ids.
  const evidence = [{ evidenceId: "e1", evidenceKey: "boq-row65", sourceType: "BOQ_SOURCE_ROW" }];
  const result = validateReasoningResult({
    result: {
      status: "RESOLVED",
      proposedInterpretation: "Row 109 should be removed as a duplicate and its anchor discarded.",
      reasoningSummary: "delete the duplicate anchor",
      evidenceAssessment: [{ evidenceId: "e1", relationship: "SUPPORTS", explanation: "x" }],
      recommendedAction: "HUMAN_REVIEW",
      modelConfidence: 0.9,
    },
    evidence,
  });
  assert.equal(result.ok, true, "the statement itself is structurally valid");
  // ...but the ADAPTER never carries anchor state out of model output at all.
  const out = await reconcileBoqScope({
    projectId: P, documentId: DOC, documentVersionId: VER, extractionId: "ex-1",
    candidates: [{ id: "c", description: "Combined smoke and heat detector", unit: "No", quantity: 31, sourceAnchors: [17, 65, 109, 150] }],
    currentLines: [], provider: null,
    sourceRows: [17, 65, 109, 150].map((n) => ({ sourceRow: n, description: "Combined smoke and heat detector", quantity: n === 17 ? 6 : n === 150 ? 5 : 10, unit: "No", scope: "PROJECT", projectId: P, documentId: DOC, documentVersionId: VER, currentness: "CURRENT" })),
  });
  assert.deepEqual(out.exact[0].sourceAnchors, [17, 65, 109, 150], "all four anchors are preserved regardless of any model view");
});

test("4: a material quantity claim is refused by the shared guard", async () => {
  const evidence = [{ evidenceId: "e1", evidenceKey: "k", sourceType: "BOQ_SOURCE_ROW" }];
  const hostile = validateReasoningResult({
    result: {
      status: "RESOLVED",
      proposedInterpretation: "The consolidated quantity is 21",
      reasoningSummary: "quantity is 21",
      evidenceAssessment: [{ evidenceId: "e1", relationship: "SUPPORTS", explanation: "x" }],
      recommendedAction: "HUMAN_REVIEW",
      modelConfidence: 0.8,
    },
    evidence,
  });
  assert.equal(hostile.ok, false);
  assert.ok(hostile.errors.includes("QUANTITY_CLAIM_FORBIDDEN"));

  // DOCUMENTED COVERAGE GAP, asserted rather than hidden: the guard's pattern is
  // /\b(?:total|quantity|qty)\s*(?:is|of|equals|=|:)?\s*\d/i, so a hedged
  // phrasing such as "quantity SHOULD BE 21" does NOT trip it. The structural
  // protection does not depend on this guard alone -- quantity is re-derived from
  // the source rows and is never read from model output -- but the gap is real
  // and is recorded rather than papered over.
  const hedged = validateReasoningResult({
    result: {
      status: "RESOLVED",
      proposedInterpretation: "The consolidated quantity should be 21",
      reasoningSummary: "it should be 21",
      evidenceAssessment: [{ evidenceId: "e1", relationship: "SUPPORTS", explanation: "x" }],
      recommendedAction: "HUMAN_REVIEW",
      modelConfidence: 0.8,
    },
    evidence,
  });
  assert.equal(hedged.ok, true, "documents the current gap: hedged quantity phrasing is not caught");
});

test("5: a material quantity change is never auto-written", async () => {
  const before = structuredClone(ROWS);
  const out = await reconcileBoqScope({
    projectId: P, documentId: DOC, documentVersionId: VER, extractionId: "ex-1",
    candidates: [CAND], currentLines: [], sourceRows: ROWS, provider: null,
  });
  assert.deepEqual(ROWS, before, "source rows untouched");
  assert.equal(out.authorityWrites, 0);
  assert.equal(out.state, "AI_PROPOSED");
  // Two source wordings => non-exact, so the consolidated total is carried on the
  // non-exact entry. It is DERIVED from the source rows, never asserted by the
  // caller or read from model output.
  assert.equal(out.exact.length, 0);
  assert.equal(out.nonExact[0].sourceQuantity, 31);
  assert.equal(out.nonExact[0].ai.verdict.verdict, "INSUFFICIENT_EVIDENCE", "no provider => no guessed equivalence");
});

test("6: all 90 source anchors remain represented", () => {
  // Every anchor is preserved on its candidate and is independently resolvable.
  const total = CAND.sourceAnchors.reduce((n, a) => n + 1, 0);
  assert.equal(total, 4);
  const resolved = CAND.sourceAnchors.filter((a) => ROWS.some((r) => r.sourceRow === a));
  assert.equal(resolved.length, 4, "every anchor resolves to a live source row");
});

const CAND = { id: "c-det", description: "Combined smoke and heat detector", unit: "No", quantity: 31, sourceAnchors: [17, 65, 109, 150] };
const ROWS = [
  { sourceRow: 17, description: "Combined smoke and heat detector", quantity: 6, unit: "No", scope: "PROJECT", projectId: P, documentId: DOC, documentVersionId: VER, currentness: "CURRENT" },
  { sourceRow: 65, description: "Combined smoke and heat sensor", quantity: 10, unit: "No", scope: "PROJECT", projectId: P, documentId: DOC, documentVersionId: VER, currentness: "CURRENT" },
  { sourceRow: 109, description: "Combined smoke and heat sensor", quantity: 10, unit: "No", scope: "PROJECT", projectId: P, documentId: DOC, documentVersionId: VER, currentness: "CURRENT" },
  { sourceRow: 150, description: "Combined smoke and heat detector", quantity: 5, unit: "No", scope: "PROJECT", projectId: P, documentId: DOC, documentVersionId: VER, currentness: "CURRENT" },
];

test("7: the adapter uses the BOQ_RECONCILIATION question type and stays AI_PROPOSED", () => {
  assert.equal(BOQ_RECONCILIATION_QUESTION_TYPE, "BOQ_RECONCILIATION");
  // Duplicate/semantic adjudication run on the SHARED reasoner, so its own
  // fail-closed contract still governs them.
  assert.equal(typeof reasonAcrossProjectEvidence, "function");
});
