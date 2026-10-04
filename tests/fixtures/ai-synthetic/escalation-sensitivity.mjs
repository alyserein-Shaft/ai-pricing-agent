#!/usr/bin/env node
// ESCALATION POLICY SENSITIVITY ANALYSIS.
//
// WHAT THIS IS, AND WHAT IT IS NOT
// ---------------------------------
// §17 asks for TP / FP / FN / TN against real Lightning errors, Super results
// and Ultra results. That requires a live model. With no NVIDIA_API_KEY there is
// no model, so those four numbers CANNOT be computed here and are reported as
// BLOCKED rather than estimated. Fabricating them from assumed model behaviour
// would be exactly the kind of unmeasured claim this whole pass exists to avoid.
//
// What CAN be measured without a model, and is genuinely informative:
//   1. DECISION DISTRIBUTION -- on authored inputs, how often does the policy
//      escalate, send to human review, or accept? A policy that escalates
//      everything is as useless as one that escalates nothing.
//   2. AUTHORED-DIFFICULTY AGREEMENT -- the understanding corpus declares a
//      `difficulty` and a `humanReviewRequired` flag per case, authored
//      independently of any model. If the policy's routing agrees with those
//      authored labels it has real discriminating power; if it disagrees
//      uniformly, its declared thresholds are wrong.
//   3. THRESHOLD SENSITIVITY -- how the routing changes as the thresholds move.
//      A policy whose routing is flat across the whole plausible range is
//      carrying no information.
//
// This is a POLICY SENSITIVITY probe. It is NOT a model benchmark and must never
// be reported as one.
import { decideEscalation, ESCALATION_THRESHOLDS } from "../../../app/domain/ai-provider-escalation-policy.mjs";
import { BOQ_UNDERSTANDING_CASES } from "./boq-understanding-corpus.mjs";

/** Build a plausible observed-response shape for one authored case. */
const observedFor = (caseSpec, overrides = {}) => {
  const exp = caseSpec.expected;
  const known = Object.entries(exp)
    .filter(([k, v]) => COMPARED.has(k) && v !== null && v !== undefined)
    .map(([k, v]) => ({ name: k, value: String(v), origin: "EXTRACTED", confidence: 95 }));
  const unknown = (caseSpec.mustRemainUnknown ?? [])
    .map((k) => ({ name: k, value: null, origin: "MISSING", confidence: 0 }));
  return {
    confidence: caseSpec.humanReviewRequired ? 55 : 92,
    technicalAttributes: [...known, ...unknown],
    corrections: [],
    ...overrides,
  };
};
const COMPARED = new Set(["system", "category", "productFamily", "addressability", "medium", "actionType", "mount"]);

/**
 * Run the current policy over every authored case and summarise the routing.
 */
export function analyseEscalationSensitivity() {
  const decisions = BOQ_UNDERSTANDING_CASES.map((caseSpec) => {
    const authorityRequired = Boolean(caseSpec.humanReviewRequired);
    const d = decideEscalation({
      entryTier: "LIGHTNING",
      response: observedFor(caseSpec),
      schemaValid: true,
      // A declared addressing or protocol conflict is a cross-document-style
      // conflict for the purpose of the routing probe.
      crossDocumentConflict: /CONFLICT/i.test(JSON.stringify(caseSpec.expected)),
      humanAuthorityRequired: false, // measured separately below
    });
    const withAuthority = decideEscalation({
      entryTier: "LIGHTNING",
      response: observedFor(caseSpec),
      schemaValid: true,
      crossDocumentConflict: /CONFLICT/i.test(JSON.stringify(caseSpec.expected)),
      humanAuthorityRequired: authorityRequired,
    });
    return Object.freeze({
      caseId: caseSpec.caseId,
      difficulty: caseSpec.difficulty,
      authoredHumanReviewRequired: authorityRequired,
      routedTier: d.tier,
      escalated: d.escalated,
      reasons: d.reasons,
      withAuthorityOutcome: withAuthority.state,
      withAuthorityTier: withAuthority.tier,
    });
  });

  const accepted = decisions.filter((d) => !d.escalated);
  const toSuper = decisions.filter((d) => d.escalated && d.routedTier === "SUPER");
  const toUltra = decisions.filter((d) => d.escalated && d.routedTier === "ULTRA");
  const toHuman = decisions.filter((d) => d.withAuthorityOutcome === "HUMAN_REVIEW_REQUIRED");

  // Agreement with the AUTHORED labels.
  const cleanOrAbbrev = (d) => d.difficulty === "clean" || d.difficulty === "abbreviation" || d.difficulty === "misspelling" || d.difficulty === "multilingual" || d.difficulty === "malformed_unit" || d.difficulty === "non_descriptive";
  const shouldEscalateByDifficulty = (d) => !cleanOrAbbrev(d);
  const agreeEscalate = decisions.filter((d) => d.escalated === shouldEscalateByDifficulty(d)).length;
  const agreeHuman = decisions.filter((d) => (d.withAuthorityOutcome === "HUMAN_REVIEW_REQUIRED") === d.authoredHumanReviewRequired).length;

  return Object.freeze({
    cases: decisions.length,
    acceptedAtLightning: accepted.length,
    escalatedToSuper: toSuper.length,
    escalatedToUltra: toUltra.length,
    terminatedAtHumanReview: toHuman.length,
    // A policy that escalates everything, or nothing, has no discriminating power.
    escalationRate: decisions.length ? Number(((toSuper.length + toUltra.length) / decisions.length).toFixed(4)) : null,
    agreementWithAuthoredDifficulty: decisions.length ? Number((agreeEscalate / decisions.length).toFixed(4)) : null,
    agreementWithAuthoredHumanReview: decisions.length ? Number((agreeHuman / decisions.length).toFixed(4)) : null,
    thresholdsUnderTest: ESCALATION_THRESHOLDS,
    decisions: Object.freeze(decisions),
    // Calibrated against real model errors? No. There is no model.
    calibrationAgainstModelError: "BLOCKED__NO_LIVE_MODEL__NVIDIA_API_KEY_ABSENT",
    label: "POLICY_SENSITIVITY_NOT_A_MODEL_BENCHMARK",
  });
}

/**
 * Sweep the accept-confidence threshold and report how routing moves.
 * A flat curve means the declared threshold is not doing any work.
 */
export function sweepAcceptConfidence(candidates = [50, 60, 70, 80, 90, 95]) {
  return Object.freeze(candidates.map((acceptConfidence) => {
    const escalated = BOQ_UNDERSTANDING_CASES.filter((c) => {
      const d = decideEscalation({
        entryTier: "LIGHTNING",
        response: observedFor(c, { confidence: acceptConfidence }),
        schemaValid: true,
        humanAuthorityRequired: false,
      });
      return d.escalated;
    }).length;
    return Object.freeze({ acceptConfidence, escalated, rate: Number((escalated / BOQ_UNDERSTANDING_CASES.length).toFixed(4)) });
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = analyseEscalationSensitivity();
  console.log("ESCALATION POLICY SENSITIVITY  (NOT a model benchmark)\n");
  console.log(`  cases=${r.cases}  acceptedAtLightning=${r.acceptedAtLightning}  ->SUPER=${r.escalatedToSuper}  ->ULTRA=${r.escalatedToUltra}  HUMAN_REVIEW=${r.terminatedAtHumanReview}`);
  console.log(`  escalationRate=${r.escalationRate}`);
  console.log(`  agreement with AUTHORED difficulty labels=${r.agreementWithAuthoredDifficulty}`);
  console.log(`  agreement with AUTHORED human-review labels=${r.agreementWithAuthoredHumanReview}`);
  console.log(`  calibration against real model error: ${r.calibrationAgainstModelError}\n`);
  console.log("  accept-confidence sweep:");
  for (const s of sweepAcceptConfidence()) console.log(`    acceptConfidence=${String(s.acceptConfidence).padStart(3)}  escalated=${String(s.escalated).padStart(2)}  rate=${s.rate}`);
}
