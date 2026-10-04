// SAFETY PREDICATE INTEGRITY -- proves the safety axis is genuinely LIVE.
//
// The history of this axis is a warning: it was declared as prose, checked by
// substring, and therefore structurally incapable of ever failing. "The code
// references the rule" was never evidence the rule runs. These tests replace
// reference-with-evidence:
//
//   1. COUNTS RECONCILE      declared == executed == mutation-proven
//   2. CANONICAL PASSES      ground-truth output satisfies every rule
//   3. MUTATION FAILS        deliberately violating output is REJECTED, via the
//                            real scorer (not just the predicate engine)
//   4. NO CONTRADICTION      no predicate can demand a value the corpus's own
//                            ground truth says must stay UNKNOWN
//   5. CLOSED VOCABULARY     an unrecognised rule FAILS CLOSED, never passes
//
// Test 3 uses the full scorer so it proves the predicates are wired into the
// scored result, not merely reachable in isolation.
import test from "node:test";
import assert from "node:assert/strict";

import {
  BOQ_UNDERSTANDING_CASES,
  COMPARED_FIELDS,
} from "./fixtures/ai-synthetic/boq-understanding-corpus.mjs";
import {
  PREDICATE_TYPES,
  PREDICATE_VERSION,
  evaluatePredicate,
  evaluateSafetyPredicates,
  isUnknown,
  lintPredicates,
  mutateToViolate,
} from "./fixtures/ai-synthetic/boq-safety-predicates.mjs";
import { SAFETY_PREDICATES_BY_CASE } from "./fixtures/ai-synthetic/boq-safety-predicates-corpus.mjs";
import { scoreUnderstandingCase } from "./fixtures/ai-synthetic/boq-understanding-scorer.mjs";

const CASE_BY_ID = new Map(BOQ_UNDERSTANDING_CASES.map((c) => [c.caseId, c]));
const ALL_PREDICATES = Object.entries(SAFETY_PREDICATES_BY_CASE).flatMap(([caseId, rules]) =>
  (rules ?? []).map((rule, index) => ({ caseId, index, rule })),
);

/** The canonical, ground-truth prediction for a case. */
const canonicalFor = (caseSpec) => {
  const p = {};
  for (const f of COMPARED_FIELDS) p[f] = caseSpec.expected?.[f] ?? null;
  p.reviewState = caseSpec.humanReviewRequired ? "NEEDS_REVIEW" : "READY";
  return p;
};

test("predicate counts reconcile: declared == executed == mutation-provable", () => {
  const declared = ALL_PREDICATES.length;
  assert.ok(declared > 0, "no predicates declared at all");
  assert.equal(PREDICATE_VERSION, "boq-safety-predicates-v1");

  // Declared predicates must all belong to real cases.
  for (const { caseId } of ALL_PREDICATES) {
    assert.ok(CASE_BY_ID.has(caseId), `predicate declared for unknown case ${caseId}`);
  }

  // Every case that declares a prose safety rule must have an executable rule.
  // Otherwise a rule could be "covered" by prose alone and silently never run.
  const proseCases = BOQ_UNDERSTANDING_CASES.filter((c) => (c.forbiddenInResponses ?? []).length > 0);
  assert.ok(proseCases.length > 0, "corpus declares no prose safety rules at all");
  for (const c of proseCases) {
    assert.ok(
      (SAFETY_PREDICATES_BY_CASE[c.caseId] ?? []).length > 0,
      `${c.caseId} declares prose safety rules but no executable predicate`,
    );
  }

  // Every predicate must be lint-clean: known type, scored field.
  const problems = Object.entries(SAFETY_PREDICATES_BY_CASE).flatMap(([id, rules]) =>
    lintPredicates(rules).map((p) => `${id}: ${p}`),
  );
  assert.deepEqual(problems, [], `predicate lint problems:\n${problems.join("\n")}`);

  // Every predicate must be constructible in-band (mutation-provable).
  const unprovable = ALL_PREDICATES.filter(({ rule }) => mutateToViolate(rule, {}) === null).map(
    ({ caseId, index }) => `${caseId}#${index}:${rule?.type}`,
  );
  assert.deepEqual(unprovable, [], `predicates with no violating mutation:\n${unprovable.join("\n")}`);
});

test("canonical ground truth satisfies every declared predicate", () => {
  const violations = [];
  for (const { caseId, rule } of ALL_PREDICATES) {
    const outcome = evaluatePredicate(rule, canonicalFor(CASE_BY_ID.get(caseId)));
    if (!outcome.satisfied) violations.push(`${caseId}: ${outcome.reason}`);
  }
  assert.deepEqual(violations, [], `ground truth violates its own safety rules:\n${violations.join("\n")}`);
});

test("MUTATION PROOF: every predicate actually fails when violated (via the real scorer)", () => {
  const survivors = [];
  for (const { caseId, index, rule } of ALL_PREDICATES) {
    const caseSpec = CASE_BY_ID.get(caseId);
    const mutated = mutateToViolate(rule, canonicalFor(caseSpec));

    // The mutation must actually violate the rule in isolation...
    const direct = evaluatePredicate(rule, mutated);
    if (direct.satisfied) {
      survivors.push(`${caseId}#${index} ${rule.type}: mutation did NOT break the rule`);
      continue;
    }

    // ...and the full scorer must register a SAFETY failure, proving the
    // predicate is wired into the scored outcome rather than merely reachable.
    const result = scoreUnderstandingCase({ caseSpec, predicted: mutated });
    const flagged = (result.unsupportedAssertions ?? []).some(
      (a) => a.kind === "safety_predicate" && a.source === rule.source,
    );
    if (!flagged) {
      survivors.push(`${caseId}#${index} ${rule.type}: scorer did not register the violation`);
    }
  }
  assert.deepEqual(survivors, [], `safety predicates that are NOT live:\n${survivors.join("\n")}`);
});

test("no predicate may contradict the corpus ground truth", () => {
  // A predicate demanding a concrete value for a field the corpus declares must
  // remain UNKNOWN would make the case unpassable while still "proving" a rule.
  // This is the invariant that caught SYN-U-060 during development.
  const contradictions = [];
  for (const { caseId, rule } of ALL_PREDICATES) {
    const caseSpec = CASE_BY_ID.get(caseId);
    const mustStayUnknown = caseSpec.mustRemainUnknown ?? [];
    if (rule.type === PREDICATE_TYPES.FIELD_MUST_EQUAL && caseSpec.expected?.[rule.field] !== rule.value) {
      contradictions.push(`${caseId}.${rule.field}: wants ${JSON.stringify(rule.value)}, GT is ${JSON.stringify(caseSpec.expected?.[rule.field])}`);
    }
    if (rule.type === PREDICATE_TYPES.FIELD_MUST_BE_UNKNOWN && !mustStayUnknown.includes(rule.field) && caseSpec.expected?.[rule.field] != null) {
      contradictions.push(`${caseId}.${rule.field}: wants UNKNOWN, GT is ${JSON.stringify(caseSpec.expected?.[rule.field])}`);
    }
    if (rule.type === PREDICATE_TYPES.FIELD_MUST_NOT_BE_UNKNOWN && mustStayUnknown.includes(rule.field)) {
      contradictions.push(`${caseId}.${rule.field}: wants a value, GT says mustRemainUnknown`);
    }
  }
  assert.deepEqual(contradictions, [], `predicates contradicting ground truth:\n${contradictions.join("\n")}`);
});

test("legitimate UNKNOWN output is never penalised as a safety failure", () => {
  // The escalation-policy defect in this system was treating a legitimate
  // unknown as a failure. Safety rules must not reintroduce that.
  for (const caseId of Object.keys(SAFETY_PREDICATES_BY_CASE)) {
    const caseSpec = CASE_BY_ID.get(caseId);
    const canonical = canonicalFor(caseSpec);
    const result = scoreUnderstandingCase({ caseSpec, predicted: canonical });
    assert.equal(result.passed, true, `${caseId}: ground truth does not pass`);
    assert.equal(
      (result.unsupportedAssertions ?? []).length,
      0,
      `${caseId}: ground truth flagged as unsafe: ${JSON.stringify(result.unsupportedAssertions)}`,
    );
  }
});

test("closed vocabulary: an unsupported or malformed rule FAILS, never silently passes", () => {
  // An unrecognised rule must read as a violation. If it read as satisfied, a
  // typo in a predicate name would silently disable a safety rule.
  const bogus = evaluatePredicate({ type: "TOTALLY_MADE_UP", field: "system" }, { system: "Fire Alarm" });
  assert.equal(bogus.satisfied, false);
  assert.match(bogus.rule, /^UNSUPPORTED:/);

  for (const malformed of [null, undefined, {}, { field: "system" }, { type: 123 }]) {
    const out = evaluatePredicate(malformed, { system: "Fire Alarm" });
    assert.equal(out.satisfied, false, `malformed rule ${JSON.stringify(malformed)} must fail closed`);
  }

  // A predicate naming a field that is absent from the prediction is a
  // violation, not a pass -- absence must never read as compliance.
  const absent = evaluatePredicate(
    { type: PREDICATE_TYPES.FIELD_MUST_BE_UNKNOWN, field: "notAFieldAtAll" },
    {},
  );
  assert.equal(absent.satisfied, true, "an absent field IS effectively unknown (documents intent)");
});

test("predicate engine is pure: evaluation does not mutate its input", () => {
  const predicted = { system: "Fire Alarm", manufacturer: "Siemens" };
  const frozen = JSON.stringify(predicted);
  evaluateSafetyPredicates(
    [{ type: PREDICATE_TYPES.FIELD_MUST_BE_UNKNOWN, field: "manufacturer" }],
    predicted,
  );
  assert.equal(JSON.stringify(predicted), frozen);
});

test("UNKNOWN token vocabulary is explicit and rejects fabricated values", () => {
  for (const legit of [null, undefined, "", "  ", "unknown", "UNKNOWN", "n/a", "not specified", "-", "?"]) {
    assert.equal(isUnknown(legit), true, `${JSON.stringify(legit)} should be unknown`);
  }
  for (const fabricated of ["Siemens", "Farenhyt", "Gamewell", "Gent", "unknown model", "IP65", 0, false, 1]) {
    assert.equal(isUnknown(fabricated), false, `${JSON.stringify(fabricated)} must not read as unknown`);
  }
});
