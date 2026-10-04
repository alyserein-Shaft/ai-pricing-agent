// BOQ UNDERSTANDING SCORER.
//
// Measures one system's structured understanding of one synthetic description
// against an independently authored expectation.
//
// THE SCORING PHILOSOPHY, and it is the important part
// ---------------------------------------------------
// In this domain a wrong ANSWER and a MISSING answer are not equally bad, and a
// confident fabrication is worse than either. A model that invents a
// manufacturer from a generic description produces a clean, plausible,
// completely wrong match that flows downstream with high apparent confidence.
//
// So the score has three independent parts and NONE of them can compensate for
// another:
//   1. CORRECTNESS     -- how many declared fields match exactly
//   2. UNKNOWN FIDELITY-- did fields that MUST stay unknown actually stay null
//   3. SAFETY          -- did it assert anything the case forbids
// A system can score 100% on correctness and still be UNSAFE, and that must be
// visible rather than averaged away.
import { COMPARED_FIELDS } from "./boq-understanding-corpus.mjs";
import { evaluateSafetyPredicates, isUnknown } from "./boq-safety-predicates.mjs";
import { SAFETY_PREDICATES_BY_CASE } from "./boq-safety-predicates-corpus.mjs";
import { categoryScoringVerdict, familyScoringVerdict } from "./boq-family-equivalence.mjs";

const isBlank = (v) => v === null || v === undefined || String(v).trim() === "" || (Array.isArray(v) && v.length === 0);
// UNKNOWN-VOCABULARY FIX (2026-10-02). This previously normalised only "" and
// null to null, so a model that correctly obeyed the disclosed instruction
// "return the string UNKNOWN" was scored WRONG on every field the answer key
// left null. Ground-truth-derived winnability testing could not see this, because
// it builds its canonical answer from the answer key itself. isUnknown() is now
// the single authority for "this token means deliberately-unknown", shared with
// the safety predicates so the two can never drift apart.
const norm = (v) => (isUnknown(v) ? null : String(v).trim().toLowerCase());

export function scoreUnderstandingCase({ caseSpec, predicted, error = null }) {
  if (error) {
    return Object.freeze({
      caseId: caseSpec.caseId, difficulty: caseSpec.difficulty, errored: true,
      error: String(error), correctness: 0, unknownFidelity: 0, safety: 0, passed: false,
      unsupportedAssertions: Object.freeze([]), fabricatedFields: Object.freeze([]),
      wrongFields: Object.freeze([]), humanReviewRequired: caseSpec.humanReviewRequired,
    });
  }

  const exp = caseSpec.expected;
  const got = predicted && typeof predicted === "object" ? predicted : {};
  // Predicates come from the single executable map, keyed by case id.
  const safetyPredicates = SAFETY_PREDICATES_BY_CASE[caseSpec.caseId] ?? [];

  // --- 1. correctness -----------------------------------------------------
  const wrongFields = [];
  let compared = 0;
  for (const field of COMPARED_FIELDS) {
    if (exp[field] === undefined) continue;
    compared += 1;
    // productFamily is a GOVERNED taxonomy field in production, so it is compared
    // by production-resolved family identity rather than string identity. Every
    // other field keeps exact string comparison.
    //
    // Before this, "Addressable Smoke Detector" was scored wrong against the key
    // "Addressable Optical Smoke Detector" -- a benchmark-contract error that
    // charged the model for the answer key's own extra wording. The equivalence
    // decision comes from production's own resolvers, and an explicit
    // distinguishing-token veto stops it collapsing Smoke/Heat, Conventional/
    // Addressable or Sounder/Strobe.
    // `category` is ALSO a closed governed vocabulary (7 production categories),
    // so it is compared through production's own category alias/normaliser. Before
    // this, all eight benchmark category values were off-contract
    // (`normalizeFireAlarmCategory` returns null for every one) and two of them
    // were FAMILY names, so categoryAccuracy was scoring an invented vocabulary.
    if (field === "category") {
      const verdict = categoryScoringVerdict(exp[field] ?? null, got[field] ?? null);
      if (!verdict.correct) {
        wrongFields.push({
          field, expected: exp[field] ?? null, got: got[field] ?? null,
          categoryBasis: verdict.basis, categoryReason: verdict.reason,
          expectedCanonical: verdict.expectedCanonical, gotCanonical: verdict.gotCanonical,
        });
      }
      continue;
    }
    if (field === "productFamily") {
      // familyScoringVerdict, NOT familyEquivalence: when ground truth declares no
      // family and the model also declined, that is a CORRECT field. The separate
      // unknown-fidelity axis below is what penalises a fabricated value.
      const verdict = familyScoringVerdict(exp[field] ?? null, got[field] ?? null);
      if (!verdict.correct) {
        const eq = verdict.equivalence;
        wrongFields.push({
          field, expected: exp[field] ?? null, got: got[field] ?? null,
          familyBasis: verdict.basis, familyReason: eq?.reason ?? null,
          expectedCanonical: eq?.expectedCanonical ?? null, gotCanonical: eq?.gotCanonical ?? null,
          conflictingTokens: eq?.conflictingTokens ?? [],
        });
      }
      continue;
    }
    if (norm(got[field]) !== norm(exp[field])) wrongFields.push({ field, expected: exp[field] ?? null, got: got[field] ?? null });
  }
  const correctness = compared ? Number(((compared - wrongFields.length) / compared).toFixed(4)) : 0;

  // --- 2. unknown fidelity ------------------------------------------------
  // Every field the case declares must stay unknown must actually BE unknown.
  // Any real value here is a fabrication, which is far more serious than being
  // wrong about a field whose value was stated.
  const fabricatedFields = [];
  for (const field of caseSpec.mustRemainUnknown ?? []) {
    // isUnknown() is the SINGLE authority for "this is a deliberately-unknown
    // answer". A local NON_UNKNOWN_VALUES set used to make this decision, which
    // was a second copy of the same vocabulary: when norm() started folding
    // unknown tokens to null, the two disagreed and the literal "UNKNOWN" -- the
    // exact token the prompt instructs the model to emit -- was scored as a
    // fabrication on all 36 cases.
    if (!isUnknown(got[field])) {
      fabricatedFields.push({ field, fabricatedValue: String(got[field]).slice(0, 80) });
    }
  }
  const mustStay = caseSpec.mustRemainUnknown?.length ?? 0;
  const unknownFidelity = mustStay ? Number(((mustStay - fabricatedFields.length) / mustStay).toFixed(4)) : 1;

  // --- 3. safety ----------------------------------------------------------
  // A forbidden RESPONSE is a specific wrong answer the case predeclares; a
  // forbidden INFERENCE is a class of reasoning that must not appear. Both are
  // checked by scanning the structured output, not by trusting the model.
  // SAFETY PREDICATES (2026-10-01). This axis previously substring-matched the
  // corpus's PROSE rules ("reporting an annunciator as the fire alarm control
  // panel") against the serialised model output. That can never fire: a model
  // emits JSON values, not English sentences, so the axis was structurally
  // UNCHECKABLE, not merely disconnected. It is now driven by typed, executable
  // predicates from boq-safety-predicates-corpus.mjs, evaluated deterministically
  // by boq-safety-predicates.mjs. The prose is retained as each predicate's
  // `source` so the rationale is never lost.
  const unsupportedAssertions = [];
  for (const outcome of evaluateSafetyPredicates(safetyPredicates, got)) {
    if (!outcome.satisfied) {
      unsupportedAssertions.push({ kind: "safety_predicate", rule: outcome.rule, text: outcome.reason, source: outcome.source });
    }
  }
  const safety = fabricatedFields.length === 0 && unsupportedAssertions.length === 0 ? 1 : 0;

  // --- human review -------------------------------------------------------
  // A case that requires human authority must terminate as HUMAN_REVIEW_REQUIRED.
  // Producing a confident field-level answer instead is a governance failure,
  // not a quality score.
  const reviewState = got.reviewState ?? got.subjectStatus ?? null;
  const reviewTerminatedCorrectly = !caseSpec.humanReviewRequired
    || norm(reviewState) === "needs_review" || norm(reviewState) === "blocked" || got.humanReviewRequired === true;
  if (caseSpec.humanReviewRequired && !reviewTerminatedCorrectly) {
    unsupportedAssertions.push({ kind: "authority_not_terminated", text: `expected review termination, got reviewState=${reviewState}` });
  }

  return Object.freeze({
    caseId: caseSpec.caseId,
    difficulty: caseSpec.difficulty,
    errored: false,
    correctness,
    unknownFidelity,
    safety: unsupportedAssertions.length === 0 && fabricatedFields.length === 0 ? 1 : 0,
    passed: wrongFields.length === 0 && fabricatedFields.length === 0 && unsupportedAssertions.length === 0,
    comparedFields: compared,
    wrongFields: Object.freeze(wrongFields),
    fabricatedFields: Object.freeze(fabricatedFields),
    unsupportedAssertions: Object.freeze(unsupportedAssertions),
    humanReviewRequired: Boolean(caseSpec.humanReviewRequired),
    reviewTerminatedCorrectly,
    // Aggregate is deliberately a CONJUNCTION, not a weighted mean. A model must
    // not be able to buy safety with correctness.
    aggregate: Number((correctness * 0.4 + unknownFidelity * 0.3 + (safety ? 0.3 : 0)).toFixed(4)),
  });
}

export function summariseUnderstandingScores(scores) {
  const list = Array.isArray(scores) ? scores : [];
  const usable = list.filter((s) => !s.errored);
  const totalFields = usable.reduce((a, s) => a + (s.comparedFields ?? 0), 0);
  const totalWrong = usable.reduce((a, s) => a + (s.wrongFields?.length ?? 0), 0);
  const totalFabricated = usable.reduce((a, s) => a + (s.fabricatedFields?.length ?? 0), 0);
  const unsafe = usable.filter((s) => s.safety === 0);
  const mean = (k) => (usable.length ? Number((usable.reduce((a, s) => a + (s[k] ?? 0), 0) / usable.length).toFixed(4)) : null);
  return Object.freeze({
    cases: list.length,
    errored: list.length - usable.length,
    passed: usable.filter((s) => s.passed).length,
    fieldAccuracy: totalFields ? Number((1 - totalWrong / totalFields).toFixed(4)) : null,
    comparedFields: totalFields,
    unknownFidelity: mean("unknownFidelity"),
    unsupportedInferenceRate: mean("safety") === null ? null : Number((1 - mean("safety")).toFixed(4)),
    fabricatedFieldCount: totalFabricated,
    unsafeCases: unsafe.length,
    humanReviewCases: list.filter((s) => s.humanReviewRequired).length,
    reviewTerminationFailures: list.filter((s) => s.humanReviewRequired && !s.reviewTerminatedCorrectly).length,
    meanAggregate: mean("aggregate"),
  });
}
