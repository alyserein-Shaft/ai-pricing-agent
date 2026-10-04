import test from "node:test";
import assert from "node:assert/strict";
import { VISUAL_UNDERSTANDING_RESPONSE_SCHEMA, buildAiVisualUnderstandingProposals } from "../app/domain/drawing-visual-understanding-contract.mjs";

const SAMPLE_RESULT = {
  drawingIdentity: { drawingType: "Schematic / Single-Line", purpose: "Fire detection and alarm schematic", basis: "Observed", evidenceQuote: "FIRE DETECTION & ALARM SCHEMATIC" },
  equipment: [{ name: "FIRE ALARM CONTROL PANEL (F.A.C.P)", explicitLocation: "AT GROUND FLOOR SECURITY ROOM (00-026)", basis: "Observed", evidenceQuote: "AT GROUND FLOOR SECURITY ROOM (00-026)" }],
  circuits: [
    { label: "LOOP-4", role: "Detection loop", spareStatus: "Spare / Unpopulated", basis: "Observed", evidenceQuote: "LOOP-4 SPARE" },
    { label: "NAC LOOP", role: "Notification appliance circuit", spareStatus: "Unknown", basis: "Observed", evidenceQuote: "NAC LOOP" },
  ],
  cableSpecs: [{ specification: "2 X 1.5 sq.mm", occurrenceCount: 2, circuitContext: "Detection loop wiring", basis: "Observed" }],
  interfaces: [{ name: "INTERFACE TO IBMS SYSTEM", basis: "Observed", evidenceQuote: "INTERFACE TO IBMS SYSTEM" }],
  notes: ["1. FOR ELV LEGENDS, GENERAL NOTES & ABBREVIATIONS REFER"],
  crossSheetReferences: [{ referencedDrawingNumber: "2401232-PC-AMS-T-00-ZZZ-002", evidenceQuote: "DWG NO. 2401232-PC-AMS-T-00-ZZZ-002" }],
  quantities: [{ quantity: 4, sourceSymbolOrText: "LOOP-1..LOOP-4 tags", evidenceQuote: "LOOP-1 LOOP-2 LOOP-3 LOOP-4" }],
  missingOrAmbiguous: ["Revision value not visually confirmed in the provided crops."],
};

test("the response schema requires every category and forbids extra properties -- a partial/loose model response fails validation, not silently accepted", () => {
  assert.deepEqual(
    VISUAL_UNDERSTANDING_RESPONSE_SCHEMA.schema.required.sort(),
    ["cableSpecs", "circuits", "crossSheetReferences", "drawingIdentity", "equipment", "interfaces", "missingOrAmbiguous", "notes", "quantities"].sort(),
  );
  assert.equal(VISUAL_UNDERSTANDING_RESPONSE_SCHEMA.schema.additionalProperties, false);
});

test("every finding-level schema requires a basis (Observed/Interpreted) or an evidence quote -- nothing can be reported ungrounded", () => {
  assert.deepEqual(VISUAL_UNDERSTANDING_RESPONSE_SCHEMA.schema.properties.circuits.items.properties.basis.enum, ["Observed", "Interpreted"]);
  assert.ok(VISUAL_UNDERSTANDING_RESPONSE_SCHEMA.schema.properties.equipment.items.required.includes("evidenceQuote"));
});

test("every mapped proposal defaults to Unsupported/Needs Review regardless of what the model claimed -- confidence never grants approval", () => {
  const items = buildAiVisualUnderstandingProposals({ result: SAMPLE_RESULT, sourceDocument: { id: "doc1", drawingNumber: "DR-005", sheetName: "SCHEMATIC" }, revision: "1", pageNumber: 1, modelInfo: { visionModel: "llava", synthesisModel: "llama" } });
  assert.ok(items.length > 0);
  for (const item of items) {
    assert.equal(item.authorityRole, "Unsupported");
    assert.equal(item.governedStatus, "Needs Review");
    assert.equal(item.reviewStatus, "Needs Review");
    assert.equal(item.confidence, null, "an AI self-reported confidence must never be surfaced as a governance signal");
    assert.equal(item.boundingBox, null, "a language model's output is not a reliable pixel coordinate");
    assert.match(item.extractionMethod, /AI visual analysis/);
    assert.match(item.extractionMethod, /llava/);
    assert.match(item.extractionMethod, /llama/);
  }
});

test("circuit spare status and role are preserved verbatim, never collapsed into a generic 'loop' label", () => {
  const items = buildAiVisualUnderstandingProposals({ result: SAMPLE_RESULT, sourceDocument: { id: "doc1" }, pageNumber: 1 });
  const loop4 = items.find((item) => item.semanticType === "circuits" && item.evidence.evidenceQuote === "LOOP-4 SPARE");
  assert.ok(loop4);
  assert.equal(loop4.evidence.spareStatus, "Spare / Unpopulated");
  const nac = items.find((item) => item.semanticType === "circuits" && item.label.startsWith("NAC LOOP"));
  assert.ok(nac);
  assert.equal(nac.evidence.spareStatus, "Unknown");
});

test("cable specs stay grouped by unique specification with an occurrence count, not one proposal per physical mention", () => {
  const items = buildAiVisualUnderstandingProposals({ result: SAMPLE_RESULT, sourceDocument: { id: "doc1" }, pageNumber: 1 });
  const cableItems = items.filter((item) => item.semanticType === "cableSpecs");
  assert.equal(cableItems.length, 1, "the sample has ONE unique spec (2 X 1.5 sq.mm) with occurrenceCount 2 -- must be one proposal, not two");
  assert.equal(cableItems[0].evidence.occurrenceCount, 2);
});

test("a cross-sheet reference finding preserves the literal referenced number even with no resolution attempted here", () => {
  const items = buildAiVisualUnderstandingProposals({ result: SAMPLE_RESULT, sourceDocument: { id: "doc1" }, pageNumber: 1 });
  const ref = items.find((item) => item.semanticType === "crossSheetReferences");
  assert.equal(ref.evidence.referencedDrawingNumber, "2401232-PC-AMS-T-00-ZZZ-002");
});

test("an equipment finding with no explicit location keeps that absence, never fabricating one", () => {
  const withoutLocation = { ...SAMPLE_RESULT, equipment: [{ name: "SMOKE DETECTOR", explicitLocation: null, basis: "Observed", evidenceQuote: "SD" }] };
  const items = buildAiVisualUnderstandingProposals({ result: withoutLocation, sourceDocument: { id: "doc1" }, pageNumber: 1 });
  const equipment = items.find((item) => item.semanticType === "equipment");
  assert.equal(equipment.evidence.explicitLocation, null);
  assert.equal(equipment.label, "SMOKE DETECTOR");
});

test("notes and missingOrAmbiguous are also turned into real proposals -- nothing validated by the model is silently dropped before persistence", () => {
  const items = buildAiVisualUnderstandingProposals({ result: SAMPLE_RESULT, sourceDocument: { id: "doc1" }, pageNumber: 1 });
  const note = items.find((item) => item.semanticType === "notes");
  assert.ok(note);
  assert.equal(note.label, "1. FOR ELV LEGENDS, GENERAL NOTES & ABBREVIATIONS REFER");
  assert.equal(note.sourceType, "AiFinding");
  const gap = items.find((item) => item.semanticType === "missingOrAmbiguous");
  assert.ok(gap);
  assert.equal(gap.label, "Revision value not visually confirmed in the provided crops.");
  assert.equal(gap.sourceType, "AiFinding");
});

test("a null/undefined result produces no proposals rather than throwing", () => {
  assert.deepEqual(buildAiVisualUnderstandingProposals({ result: null }), []);
  assert.deepEqual(buildAiVisualUnderstandingProposals({}), []);
});

test('runtime validator rejects missing required fields and invalid status enums',async()=>{
 const {validateVisualUnderstanding}=await import('../app/domain/drawing-visual-understanding-contract.mjs');
 assert.equal(validateVisualUnderstanding({drawingIdentity:{}}),false);
 const base={drawingIdentity:{drawingType:'Schematic',purpose:'Review',basis:'Observed',evidenceQuote:'Sheet title'},equipment:[],circuits:[],cableSpecs:[],interfaces:[],notes:[],crossSheetReferences:[],quantities:[],missingOrAmbiguous:[]};
 assert.equal(validateVisualUnderstanding(base),true);
 assert.equal(validateVisualUnderstanding({...base,circuits:[{label:'L1',role:'Unknown',basis:'Observed',evidenceQuote:'L1',spareStatus:'Approved'}]}),false);
});
