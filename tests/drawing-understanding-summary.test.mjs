import test from "node:test";
import assert from "node:assert/strict";
import { buildDrawingUnderstandingSummary } from "../app/domain/drawing-understanding-summary.mjs";

const item = (overrides) => ({ id: "x", sourceType: "Loop", semanticType: "circuits", label: "LOOP-1", reviewStatus: "Needs Review", governedStatus: "Needs Review", evidence: {}, ...overrides });

test("with no items at all, reports drawing identity as not yet established rather than fabricating a summary", () => {
  const summary = buildDrawingUnderstandingSummary({ sourceDocument: {}, drawingType: null, items: [] });
  assert.match(summary.whatThisExplains, /not yet established/);
  assert.deepEqual(summary.mainFindings, []);
  assert.equal(summary.counts.currentEngineering, 0);
});

test("source sheet identity is shown without substituting a model paraphrase", () => {
  const items = [item({ sourceType: "AiFinding", semanticType: "drawingIdentity", label: "Schematic / Single-Line — Fire detection and alarm schematic" })];
  const summary = buildDrawingUnderstandingSummary({ sourceDocument: { sheetName: "FIRE DETECTION & ALARM SCHEMATIC", drawingNumber: "DR-005" }, drawingType: "Schematic / Single-Line", items });
  assert.match(summary.whatThisExplains, /FIRE DETECTION & ALARM SCHEMATIC/);
  assert.match(summary.whatThisExplains, /DR-005/);
});

test("source sheet name remains visible without an AI identity", () => {
  const summary = buildDrawingUnderstandingSummary({ sourceDocument: { sheetName: "FCC ROOM DETAILS" }, drawingType: "Detail / Enlarged Detail", items: [] });
  assert.match(summary.whatThisExplains, /FCC ROOM DETAILS/);
});

test("a legacy 'Not Found' finding with unresolved history is excluded from every count, same as a rejection", () => {
  const items = [item({ id: "a" }), item({ id: "b", reviewStatus: "Not Found", governedStatus: "Not Found" })];
  const summary = buildDrawingUnderstandingSummary({ items });
  assert.equal(summary.counts.currentEngineering, 1);
});

test("a rejected finding is excluded from every count -- an engineer's rejection is respected", () => {
  const items = [item({ id: "a" }), item({ id: "b", reviewStatus: "Rejected" })];
  const summary = buildDrawingUnderstandingSummary({ items });
  assert.equal(summary.counts.currentEngineering, 1);
});

test("real counts group by source type with real labels sampled, never inventing a fact", () => {
  const items = [
    item({ id: "l1", label: "LOOP-1" }),
    item({ id: "l2", label: "LOOP-2" }),
    item({ id: "i1", sourceType: "Interface", semanticType: "systemInterfaces", label: "INTERFACE TO IBMS SYSTEM" }),
  ];
  const summary = buildDrawingUnderstandingSummary({ items });
  const loopLine = summary.mainFindings.find((line) => line.includes("LOOP-1"));
  assert.match(loopLine, /^Circuits:/);
  assert.match(loopLine, /LOOP-1/);
  assert.match(loopLine, /LOOP-2/);
});

test("missingOrAmbiguous findings surface verbatim in needsClarification, and a Needs Review count is added generically", () => {
  const items = [
    item({ id: "l1" }),
    item({ id: "gap1", sourceType: "AiFinding", semanticType: "missingOrAmbiguous", label: "Revision not visually confirmed.", reviewStatus: "Needs Review" }),
  ];
  const summary = buildDrawingUnderstandingSummary({ items });
  assert.ok(summary.needsClarification.includes("Revision not visually confirmed."));
  assert.ok(summary.needsClarification.some((line) => /distinct current engineering candidates/.test(line)));
});

test("a Conflict-flagged finding is surfaced distinctly from a plain Needs Review count", () => {
  const items = [item({ id: "c1", reviewStatus: "Conflict", governedStatus: "Conflict" })];
  const summary = buildDrawingUnderstandingSummary({ items });
  assert.ok(summary.needsClarification.some((line) => /flagged as Conflict/.test(line)));
});

test("hasAiFindings reflects whether any AI-sourced item is present", () => {
  assert.equal(buildDrawingUnderstandingSummary({ items: [item()] }).hasAiFindings, false);
  assert.equal(buildDrawingUnderstandingSummary({ items: [item({ sourceType: "AiCircuit" })] }).hasAiFindings, true);
});
