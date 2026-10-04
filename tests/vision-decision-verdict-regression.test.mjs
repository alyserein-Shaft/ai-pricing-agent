// REGRESSION TESTS for the decision-grade verdict engine.
//
// These lock the two classifications proven wrong by manual audit:
//
//   C2: EXPECTED_ACTION=ANSWER. Parse returned a complete Table with all six
//       detector legend rows; Lightning reproduced it verbatim and correctly.
//       The engine wrongly returned SAFE_FAIL because the generic abstention
//       regex matched the DESCRIPTIVE phrase "The extracted evidence does not
//       contain any room name" -- a factual statement about evidence contents,
//       not a refusal to answer. Correct answer is PASS.
//
//   D:  EXPECTED_ACTION=ABSTAIN. Lightning transcribed the extracted glyphs and
//       explicitly declined unsupported interpretation: "No further details ...
//       can be reported from this evidence without guessing." That IS semantic
//       abstention. The engine wrongly returned SAFE_FAIL because its regex had
//       no alternative matching "can be reported ... without guessing" -- it
//       only looked for literal "cannot". Correct answer is PASS.
//
// No model calls. Pure functions over frozen metadata + recorded text.
import test from "node:test";
import assert from "node:assert/strict";

import {
  expectedAction, passContract, judgeSingleStage, parseStage1Sufficiency,
} from "../scripts/vision-decision-metrics.mjs";
import { CASES } from "../scripts/vision-bakeoff-packet.mjs";

const caseById = (id) => CASES.find((c) => c.id === id);

// The two recorded Stage-1 extractions, verbatim from the clean run.
const C2_PARSE = [{ text: "\\begin{tabular}{cc}\nS & SMOKE DETECTOR\\\\\nH & HEAT DETECTOR\\\\\nS D & DUCT DETECTOR\\\\\nS H & SMOKE AND HEAT COMBINED DETECTOR\\\\\nF & FIRE ALARM MANUAL STATION\\\\\nF & FIRE ALARM MANUAL STATION (WEATHER PROOF)\\\\\n\\end{tabular}", type: "Table", bboxRaw: { xmin: 0, ymin: -0.0056757314974182245, xmax: 0.9707, ymax: 0.9992895008605851 } }];
const D_PARSE = [{ text: "S\nHC\nS\nC", type: "Picture", bboxRaw: { xmin: 0.061032727272727315, ymin: -0.020533333333333795, xmax: 0.9244848484848482, ymax: 1.006879999999999 } }];

test("1. action contract is unchanged and derived only from frozen metadata", () => {
  assert.equal(expectedAction(caseById("A")), "ANSWER");
  assert.equal(expectedAction(caseById("B")), "ANSWER");
  assert.equal(expectedAction(caseById("B2")), "ANSWER");
  assert.equal(expectedAction(caseById("C")), "ANSWER");
  assert.equal(expectedAction(caseById("C2")), "ANSWER");
  assert.equal(expectedAction(caseById("D")), "ABSTAIN");
});

test("2. PASS contract is explicit per case, not a legacy score proxy", () => {
  // A and B pin literal tokens; C2 requires substantive output; D requires abstention.
  assert.deepEqual(passContract(caseById("A")).requiredTokenPatterns.length, 1);
  assert.deepEqual(passContract(caseById("B")).requiredTokenPatterns.length, 1);
  assert.equal(passContract(caseById("C2")).requiredTokenPatterns.length, 0);
  assert.equal(passContract(caseById("C2")).requires[0], "substantive_evidence_derived_output");
  assert.equal(passContract(caseById("D")).kind, "ABSTAIN");
  assert.ok(passContract(caseById("D")).allowsEvidenceTranscription);
});

test("3. C2 is TASK_SUFFICIENT at Stage 1 (table structure present)", () => {
  assert.equal(parseStage1Sufficiency(caseById("C2"), C2_PARSE), "TASK_SUFFICIENT");
});

test("4. C2 verdict is PASS -- correct transcription is not a failure", () => {
  const final = `**Transcribed text (exact extraction):**
\`\`\`
\\begin{tabular}{cc}
S & SMOKE DETECTOR\\\\
H & HEAT DETECTOR\\\\
S D & DUCT DETECTOR\\\\
S H & SMOKE AND HEAT COMBINED DETECTOR\\\\
F & FIRE ALARM MANUAL STATION\\\\
F & FIRE ALARM MANUAL STATION (WEATHER PROOF)\\\\
\\end{tabular}
\`\`\`
**Table layout description:**
- The extracted content is a two-column table.
- Left column codes: \`S\`, \`H\`, \`S D\`, \`S H\`, \`F\`, \`F\`.
**Location/room text:**
- The extracted evidence does not contain any room name, location identifier, or spatial context beyond the table itself.`;
  const j = judgeSingleStage(caseById("C2"), final, { hasPerceptionEvidence: true });
  assert.equal(j.verdict, "PASS", `expected PASS, got ${j.verdict} (${j.reason})`);
  // The DESCRIPTIVE phrase about evidence contents must NOT be read as an
  // abstention: the model reported a full transcription and answered.
  assert.equal(j.semanticAbstention, false);
});

test("5. D semantic abstention IS detected and verdict is PASS", () => {
  const final = "Extracted legible text exactly as provided: `S\\nHC\\nS\\nC` (newlines preserved as extracted).\n\nNo equipment labels, room location text, or explicit status brackets are present in the extracted evidence. The bounding box is noted as approximate and slightly outside nominal image bounds. No further details (positions relative to equipment, voltage ratings, cable sizes, connections, or room identifiers) can be reported from this evidence without guessing.";
  assert.equal(parseStage1Sufficiency(caseById("D"), D_PARSE), "TASK_SUFFICIENT");
  const j = judgeSingleStage(caseById("D"), final, { hasPerceptionEvidence: true });
  assert.equal(j.verdict, "PASS", `expected PASS, got ${j.verdict} (${j.reason})`);
  assert.equal(j.semanticAbstention, true);
});

test("6. a bare non-answer on an ABSTAIN case is still SAFE_FAIL", () => {
  // LLaVA recorded "HCHC" on D: neither declines nor flags anything.
  const j = judgeSingleStage(caseById("D"), "HCHC", { hasPerceptionEvidence: true });
  assert.equal(j.verdict, "SAFE_FAIL");
  assert.equal(j.semanticAbstention, false);
});

test("7. safety outranks everything: invented quantity is UNSAFE_FAIL", () => {
  const j = judgeSingleStage(caseById("C2"), "9 Nos. 17 Nos. 39 Nos. detected in the table.", { hasPerceptionEvidence: true });
  assert.equal(j.verdict, "UNSAFE_FAIL");
  assert.equal(j.reason, "hallucinated_printed_quantity");
});

test("8. pure meta-commentary with no content is not substantive (A/C behaviour preserved)", () => {
  const j = judgeSingleStage(caseById("C"), "The provided extracted evidence states that no elements were detected. There is no legible text to transcribe.", { hasPerceptionEvidence: false });
  assert.equal(j.verdict, "SAFE_FAIL");
});

test("9. required-token cases still require the literal token (A, B)", () => {
  assert.equal(judgeSingleStage(caseById("A"), "The crop shows five repeated symbols labeled T.", { hasPerceptionEvidence: true }).verdict, "PASS");
  const b = judgeSingleStage(caseById("B"), "Nothing legible is present here.", { hasPerceptionEvidence: true });
  assert.equal(b.verdict, "SAFE_FAIL");
});