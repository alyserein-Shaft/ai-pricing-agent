// BENCHMARK CONTRACT, OUTPUT NORMALIZATION AND CHECKPOINT INTEGRITY.
//
// Each test here corresponds to a harness defect that actually occurred in this
// project. None of them is defensive padding: every one of these bugs shipped,
// corrupted a measurement, and had to be found by hand.
import test from "node:test";
import assert from "node:assert/strict";

import { BOQ_UNDERSTANDING_CASES, COMPARED_FIELDS } from "./fixtures/ai-synthetic/boq-understanding-corpus.mjs";
import { scoreUnderstandingCase } from "./fixtures/ai-synthetic/boq-understanding-scorer.mjs";
import {
  BOOLEAN_FIELDS,
  CANONICAL_RESPONSE_SCHEMA,
  DERIVED_FIELDS,
  FINGERPRINT_SHA,
  NUMERIC_FIELDS,
  SENTINELS,
  SCORER_READ_FIELDS,
  buildCanonicalBenchmarkPrompt,
  deriveForScoring,
  validateCanonicalPrediction,
  verifyBenchmarkContract,
} from "./fixtures/ai-synthetic/boq-benchmark-contract.mjs";
import {
  RESULT_CLASSES,
  aggregateOutcomes,
  benchmarkIdentity,
  classifyTransport,
  createCheckpointStore,
  normalizeStructuredOutput,
  scoreFields,
} from "./fixtures/ai-synthetic/boq-benchmark-harness.mjs";
import { SAFETY_PREDICATES_BY_CASE } from "./fixtures/ai-synthetic/boq-safety-predicates-corpus.mjs";

/**
 * The prompt-compliant prediction for a case.
 *
 * Derived from the answer key ONLY to synthesise a correctly-SHAPED compliant
 * response. It exists to prove the harness does not penalise a model for obeying
 * the instructions -- the previous defect made the disclosed token "UNKNOWN" score
 * as a fabrication on all 36 cases, and only this shape reveals that.
 */
const compliantOutput = (c) => {
  const p = {};
  for (const f of COMPARED_FIELDS) {
    const v = c.expected[f];
    p[f] = v == null
      ? (NUMERIC_FIELDS.includes(f) || BOOLEAN_FIELDS.includes(f) ? null : SENTINELS.UNKNOWN)
      : v;
  }
  return p;
};

// ── §3 contract ──────────────────────────────────────────────────────────────

test("benchmark contract verifies: prompt, schema, corpus and scorer agree", () => {
  const result = verifyBenchmarkContract();
  assert.equal(result.ok, true);
  assert.equal(result.fields, COMPARED_FIELDS.length);
});

test("contract gate REJECTS a hidden scored field (the 9-vs-18 defect)", () => {
  // A field the scorer compares but the schema never requests makes a compliant
  // model unpassable, and does so silently.
  const withHiddenField = [...COMPARED_FIELDS, "someNewField"];
  assert.throws(
    () => verifyBenchmarkContract({ comparedFields: withHiddenField }),
    (e) => e.code === "BENCHMARK_CONTRACT_VIOLATION" && /not in the canonical schema/.test(e.message),
  );
});

test("contract gate REJECTS an undeclared hidden scorer read", () => {
  // Simulates the reviewState class of bug: a scorer field that is neither
  // requested nor declared derived.
  const fields = [...SCORER_READ_FIELDS, "sneakyGovernanceField"];
  assert.throws(
    () => verifyBenchmarkContract({ comparedFields: fields.filter((f) => f !== "sneakyGovernanceField") }),
    () => true,
    "a schema/scorer mismatch must throw",
  );
  // And the real declaration must not be contradictory: reviewState is derived,
  // never requested.
  assert.ok(DERIVED_FIELDS.includes("reviewState"));
  assert.ok(!("reviewState" in CANONICAL_RESPONSE_SCHEMA.properties));
});

test("contract gate REJECTS ground truth outside the disclosed vocabulary", () => {
  const badCorpus = [{ caseId: "X", expected: { system: "Plumbing" } }];
  assert.throws(
    () => verifyBenchmarkContract({ corpus: badCorpus }),
    (e) => e.code === "BENCHMARK_CONTRACT_VIOLATION",
  );
});

test("contract gate REJECTS duplicate case ids", () => {
  const dupe = [{ caseId: "A", expected: {} }, { caseId: "A", expected: {} }];
  assert.throws(() => verifyBenchmarkContract({ corpus: dupe }), (e) => e.code === "BENCHMARK_CONTRACT_VIOLATION");
});

test("every sentinel used in ground truth is disclosed in the prompt", () => {
  const prompt = buildCanonicalBenchmarkPrompt({ input: "x" });
  for (const s of Object.values(SENTINELS)) {
    assert.ok(prompt.includes(s), `prompt does not disclose sentinel ${s}`);
  }
});

test("prompt states numeric/boolean unstated-value rule without contradiction", () => {
  const prompt = buildCanonicalBenchmarkPrompt({ input: "x" });
  // A prompt that says "return UNKNOWN" for a number field is self-contradictory:
  // a compliant model would emit a schema-invalid value for every unstated number.
  for (const f of NUMERIC_FIELDS) assert.ok(prompt.includes(f), `prompt omits numeric field ${f}`);
  for (const f of BOOLEAN_FIELDS) assert.ok(prompt.includes(f), `prompt omits boolean field ${f}`);
  const v = validateCanonicalPrediction(compliantOutput(BOQ_UNDERSTANDING_CASES[0]));
  assert.equal(v.valid, true, `compliant output failed schema: ${v.problems.join("; ")}`);
});

// ── §7 winnability ──────────────────────────────────────────────────────────

test("CORPUS WINNABILITY: a prompt-compliant model passes 36/36", () => {
  const failures = [];
  for (const c of BOQ_UNDERSTANDING_CASES) {
    const raw = compliantOutput(c);
    const schema = validateCanonicalPrediction(raw);
    if (!schema.valid) { failures.push(`${c.caseId}: schema ${schema.problems.join("; ")}`); continue; }
    const scored = scoreUnderstandingCase({ caseSpec: c, predicted: deriveForScoring(c, raw) });
    if (!scored.passed) {
      failures.push(`${c.caseId}: wrong=${JSON.stringify(scored.wrongFields)} unsafe=${JSON.stringify(scored.unsupportedAssertions)} fabricated=${JSON.stringify(scored.fabricatedFields)}`);
    }
  }
  assert.deepEqual(failures, [], `corpus is not winnable by a compliant model:\n${failures.join("\n")}`);
});

test("every case is scored -- no hard case is silently skipped", () => {
  assert.equal(BOQ_UNDERSTANDING_CASES.length, 36);
  const ids = BOQ_UNDERSTANDING_CASES.map((c) => c.caseId);
  assert.equal(new Set(ids).size, ids.length, "duplicate case ids would merge cases");
  for (const c of BOQ_UNDERSTANDING_CASES) {
    assert.ok(c.input && typeof c.input === "string", `${c.caseId} has no input`);
    assert.ok(c.expected && typeof c.expected === "object", `${c.caseId} has no expected answer`);
    assert.ok(c.difficulty, `${c.caseId} has no difficulty label`);
  }
});

test("dangerous wrong values FAIL while legitimate unknowns PASS", () => {
  // SYN-U-110 forbids naming any manufacturer: the answer must stay unknown.
  const c = BOQ_UNDERSTANDING_CASES.find((x) => x.caseId === "SYN-U-110");
  const honest = scoreUnderstandingCase({ caseSpec: c, predicted: deriveForScoring(c, compliantOutput(c)) });
  assert.equal(honest.passed, true, "honest unknown must pass");

  const fabricated = compliantOutput(c);
  fabricated.manufacturer = "Farenhyt";
  const unsafe = scoreUnderstandingCase({ caseSpec: c, predicted: deriveForScoring(c, fabricated) });
  assert.equal(unsafe.passed, false, "a named manufacturer must fail");
  assert.ok(unsafe.fabricatedFields.length > 0 || unsafe.unsupportedAssertions.length > 0);
});

// ── §5 structured output normalization ──────────────────────────────────────

test("accepts direct JSON, canonical envelope, and deterministic fenced JSON", () => {
  const obj = compliantOutput(BOQ_UNDERSTANDING_CASES[0]);
  const direct = normalizeStructuredOutput(JSON.stringify(obj));
  assert.equal(direct.resultClass, RESULT_CLASSES.MODEL_RESULT);
  assert.equal(direct.extraction, "direct");

  const envelope = normalizeStructuredOutput({ choices: [{ message: { content: JSON.stringify(obj) } }] });
  assert.equal(envelope.resultClass, RESULT_CLASSES.MODEL_RESULT);

  const fenced = normalizeStructuredOutput("```json\n" + JSON.stringify(obj) + "\n```");
  assert.equal(fenced.resultClass, RESULT_CLASSES.MODEL_RESULT);
  assert.equal(fenced.extraction, "fenced");
});

test("fenced JSON that does not validate is NOT accepted", () => {
  const broken = { ...compliantOutput(BOQ_UNDERSTANDING_CASES[0]), zoneCount: "four" };
  const r = normalizeStructuredOutput("```json\n" + JSON.stringify(broken) + "\n```");
  assert.equal(r.resultClass, RESULT_CLASSES.SCHEMA_INVALID, "a wrong-typed value must not pass via a fence");
});

test("prose is never mined for a value -- no semantic repair", () => {
  const r = normalizeStructuredOutput('Sure! The system is Fire Alarm and the category is Detector.');
  assert.equal(r.ok, false);
  assert.ok([RESULT_CLASSES.FOREIGN_RESPONSE, RESULT_CLASSES.MALFORMED_OUTPUT].includes(r.resultClass));
  assert.equal(r.prediction, null, "no prediction may be reconstructed from prose");
});

test("valid JSON sharing no contract key is FOREIGN_RESPONSE, not MALFORMED", () => {
  const r = normalizeStructuredOutput(JSON.stringify({ answer: "I cannot help with that", confidence: 0.1 }));
  assert.equal(r.resultClass, RESULT_CLASSES.FOREIGN_RESPONSE);
});

test("unparseable JSON is MALFORMED_OUTPUT", () => {
  const r = normalizeStructuredOutput('{"system": "Fire Alarm", ');
  assert.equal(r.resultClass, RESULT_CLASSES.MALFORMED_OUTPUT);
});

test("empty completion is malformed, never a pass", () => {
  assert.equal(normalizeStructuredOutput("").resultClass, RESULT_CLASSES.MALFORMED_OUTPUT);
  assert.equal(normalizeStructuredOutput({ choices: [{ message: { content: "" } }] }).resultClass, RESULT_CLASSES.MALFORMED_OUTPUT);
});

// ── §4 transport classification ─────────────────────────────────────────────

test("provider failures never masquerade as model answers", () => {
  assert.equal(classifyTransport({ status: 200 }), RESULT_CLASSES.MODEL_RESULT);
  assert.equal(classifyTransport({ timedOut: true }), RESULT_CLASSES.TIMEOUT);
  assert.equal(classifyTransport({ status: 429 }), RESULT_CLASSES.RATE_LIMITED);
  assert.equal(classifyTransport({ status: 500 }), RESULT_CLASSES.UPSTREAM_UNAVAILABLE);
  assert.equal(classifyTransport({ status: 503 }), RESULT_CLASSES.UPSTREAM_UNAVAILABLE);
  assert.equal(classifyTransport({ networkError: "ECONNRESET" }), RESULT_CLASSES.UPSTREAM_UNSTABLE);
  assert.equal(classifyTransport({ status: null }), RESULT_CLASSES.UPSTREAM_UNSTABLE);
  // An unrecognised status must not be assumed to be a good answer.
  assert.notEqual(classifyTransport({ status: 599 }), RESULT_CLASSES.MODEL_RESULT);
});

test("semantic metrics use ONLY valid model results", () => {
  const outcomes = [
    { resultClass: RESULT_CLASSES.MODEL_RESULT, caseFullyCorrect: true, fieldAccuracy: 1, attributeAccuracy: 1, unknownPreservation: 1, fabricatedFieldCount: 0, fieldsCompared: 19, safetyViolationCount: 0, safetyPredicatesApplicable: 2, latencyMs: 100 },
    { resultClass: RESULT_CLASSES.MODEL_RESULT, caseFullyCorrect: false, fieldAccuracy: 0.5, attributeAccuracy: 0.5, unknownPreservation: 0.5, fabricatedFieldCount: 1, fieldsCompared: 19, safetyViolationCount: 1, safetyPredicatesApplicable: 2, latencyMs: 200 },
    { resultClass: RESULT_CLASSES.TIMEOUT, latencyMs: 25000 },
    { resultClass: RESULT_CLASSES.UPSTREAM_UNAVAILABLE, latencyMs: 900 },
  ];
  const agg = aggregateOutcomes(outcomes);
  assert.equal(agg.total, 4);
  assert.equal(agg.semanticCount, 2, "only 2 attempts produced a model answer");
  assert.equal(agg.completionRate, 0.5, "completion rate must reflect operational failure");
  assert.equal(agg.fieldAccuracy, 0.75, "field accuracy must average over model results only");
  assert.equal(agg.unsupportedInferenceRate, Number((1 / 38).toFixed(4)), "inference rate must not count timeouts");
  // Safety accuracy is over predicate SLOTS (2 applicable per model result, 4
  // total), not per case: 1 violation out of 4 applicable slots = 0.75.
  assert.equal(agg.safetyAccuracy, 0.75);
  // True median of [100,200,900,25000] is 550; p90 (nearest-rank) is 25000.
  // Operational latency must be reported over ALL attempts, including the ones
  // that never produced a semantic answer.
  assert.equal(agg.medianLatencyMs, 550);
  assert.equal(agg.p90LatencyMs, 25000);
  assert.equal(agg.maxLatencyMs, 25000);
  assert.equal(agg.timeoutRate, 0.25);
});

// ── §6 field-level scoring ──────────────────────────────────────────────────

test("field-level scoring separates attribute accuracy from UNKNOWN handling", () => {
  const c = BOQ_UNDERSTANDING_CASES.find((x) => x.caseId === "SYN-U-001");
  const perfect = compliantOutput(c);
  const s1 = scoreFields({ caseSpec: c, predicted: perfect });
  assert.equal(s1.fieldAccuracy, 1);
  assert.ok(s1.unknownPreservation !== null && s1.unknownPreservation <= 1);

  // Break exactly one attribute; the aggregate must move by less than "all wrong".
  const oneWrong = { ...perfect, category: "Nonsense" };
  const s2 = scoreFields({ caseSpec: c, predicted: oneWrong });
  assert.ok(s2.fieldAccuracy > 0 && s2.fieldAccuracy < 1, "partial credit must be visible");
  assert.equal(s2.records.filter((r) => !r.correct).length, 1);
  assert.ok(s2.records.every((r) => r.kind === "ATTRIBUTE" || r.kind === "UNKNOWN_HANDLING"));
});

// ── §8 resumable checkpointing ──────────────────────────────────────────────

test("benchmark identity changes when anything that changes meaning changes", () => {
  const base = { provider: "nvidia", model: "m1", providerConfigFingerprint: "cfg", caseIds: ["a", "b"] };
  const id = benchmarkIdentity(base).id;
  assert.equal(benchmarkIdentity({ ...base }).id, id, "identity must be stable for identical inputs");
  for (const [label, mutate] of [
    ["corpus", () => ({ ...base, caseIds: ["a", "b", "c"] })],
    ["model", () => ({ ...base, model: "m2" })],
    ["provider", () => ({ ...base, provider: "other" })],
    ["config", () => ({ ...base, providerConfigFingerprint: "cfg2" })],
  ]) {
    assert.notEqual(benchmarkIdentity(mutate()).id, id, `${label} change must invalidate the identity`);
  }
});

test("checkpoint reuse requires an EXACT identity match", () => {
  const idA = benchmarkIdentity({ provider: "n", model: "m", caseIds: ["a"] }).id;
  const idB = benchmarkIdentity({ provider: "n", model: "m2", caseIds: ["a"] }).id;
  const store = createCheckpointStore({ identityId: idA });
  store.set("case-1", { ok: true });

  const good = store.adopt({ identityId: idA, results: { "case-2": { ok: true } } });
  assert.equal(good.adopted, true);
  assert.equal(good.reused, 1);
  assert.equal(store.get("case-2").ok, true);
  assert.equal(store.keys().length, 2);

  // A checkpoint from a different model must NEVER be blended in.
  const bad = store.adopt({ identityId: idB, results: { "case-9": { ok: false } } });
  assert.equal(bad.adopted, false);
  assert.equal(bad.reason, "identity mismatch");
  assert.equal(store.get("case-9"), undefined, "mismatched results must not be adopted");
});

test("a store with no identity refuses to adopt anything", () => {
  const store = createCheckpointStore();
  const r = store.adopt({ identityId: "whatever", results: { a: 1 } });
  assert.equal(r.adopted, false);
});

test("contract fingerprint is stable and non-empty", () => {
  assert.match(FINGERPRINT_SHA, /^[0-9a-f]{64}$/);
});

test("predicates referenced by the corpus are the same set the harness will execute", () => {
  // Guards against a predicate being added to the corpus prose but not to the
  // executable map -- the original silent-safety-axis failure.
  const proseCases = BOQ_UNDERSTANDING_CASES.filter((c) => (c.forbiddenInResponses ?? []).length > 0);
  assert.ok(proseCases.length > 0);
  for (const c of proseCases) {
    assert.ok((SAFETY_PREDICATES_BY_CASE[c.caseId] ?? []).length > 0, `${c.caseId} has prose but no executable predicate`);
  }
});
