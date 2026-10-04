/**
 * DETERMINISTIC EVIDENCE ELIGIBILITY GATE  —  contains NO model call.
 *
 * WHY THIS EXISTS
 * ---------------
 * The previous benchmark produced, from a BLANK image:
 *     BEST_SUPPORTED_PROJECT_CLASS = FIREMAN TELEPHONE JACK
 *     CONFIDENCE = 100,  RECOMMENDED_ACTION = ACCEPT_FACT
 * while Stage 1 had correctly reported GLYPH_COUNT=0, ENCLOSURE_SHAPE=NONE,
 * OBSERVATION_CONFIDENCE=0. The reasoning model discarded a perfect null signal
 * and answered from the legend alone. Prompt wording cannot fix that, because
 * the model is an authority over its own output and confidence is not evidence.
 *
 * So acceptance authority moves OUT of the model and INTO this gate.
 *
 * DESIGN RULE (§4): eligibility must NOT be a glyph-count test. Valid drawing
 * symbols may carry no text at all. The gate therefore distinguishes
 *   NO_EVIDENCE            (nothing usable was observed)
 * from
 *   NON_TEXT_VISUAL_EVIDENCE (linework / enclosure shape, zero glyphs, still valid)
 *
 * MODEL_CONFIDENCE_IS_NOT_AUTHORITY is structural here: this function takes no
 * confidence input at all, and `applyGate` can only ever DOWNGRADE a model
 * result, never upgrade it.
 */

export const GATE_VERDICT = Object.freeze({
  ELIGIBLE_FOR_REASONING: "ELIGIBLE_FOR_REASONING",
  ELIGIBLE_FOR_ACCEPTANCE: "ELIGIBLE_FOR_ACCEPTANCE",
  BLOCKED: "BLOCKED",
});

/** Evidence classes a caller may assert. NONE is absence of all evidence. */
export const EVIDENCE_STATE = Object.freeze({
  TEXT_GLYPH: "TEXT_GLYPH",
  NON_TEXT_VISUAL: "NON_TEXT_VISUAL",
  BOTH: "BOTH",
  NONE: "NONE",
});

/**
 * @param {object} input
 * @param {boolean} input.renderSucceeded        page rendered at all
 * @param {object|null} input.renderValidity     assessRenderValidity() result
 * @param {boolean} input.targetLocated          target bbox resolved on the page
 * @param {string}  input.evidenceState          one of EVIDENCE_STATE
 * @param {string|null} input.contextType        LEGEND|SCHEDULE|PLAN|NOTE|UNKNOWN
 * @param {boolean} input.projectEvidencePresent governed legend/notes available
 * @param {string[]} input.blockingContradictions contradictions that void a claim
 * @param {string[]} input.ocrUncertainties      low-confidence readings
 */
export function evaluateEligibility(input) {
  const {
    renderSucceeded, renderValidity, targetLocated, evidenceState,
    contextType, projectEvidencePresent, blockingContradictions = [], ocrUncertainties = [],
  } = input;

  // Two EXPLICIT lists. Acceptance strictly implies reasoning eligibility, so a
  // hard block must block both. (An earlier version gated acceptance on
  // `eligibleForReasoning && reasons.length`, which INVERTED: a hard block left
  // ELIGIBLE_FOR_ACCEPTANCE true, and applyGate then let a c100 ACCEPT_FACT from
  // a blank image straight through. Found by the blank-image replay in
  // benchmark-16, not by the adversarial suite, because that suite never routes
  // a blocked case through applyGate.)
  const reasoningBlocks = [];
  const acceptanceBlocks = [];

  if (!renderSucceeded) reasoningBlocks.push("RENDER_FAILED");
  if (renderValidity && !renderValidity.valid) reasoningBlocks.push(`IMAGE_INVALID:${renderValidity.reason || "UNKNOWN"}`);
  if (!targetLocated) reasoningBlocks.push("TARGET_NOT_LOCATED");
  if (!evidenceState || evidenceState === EVIDENCE_STATE.NONE) reasoningBlocks.push("NO_USABLE_EVIDENCE");

  if (!projectEvidencePresent) acceptanceBlocks.push("NO_PROJECT_EVIDENCE");
  if (!contextType || contextType === "UNKNOWN") acceptanceBlocks.push("CONTEXT_TYPE_UNKNOWN");
  if (blockingContradictions.length) acceptanceBlocks.push(`BLOCKING_CONTRADICTION:${blockingContradictions[0].slice(0, 120)}`);
  // Vision-only evidence with no deterministic context cannot be accepted: a
  // previous run mislabelled schedule cells as legend rows and reasoned from it.
  if (evidenceState === EVIDENCE_STATE.NON_TEXT_VISUAL && (!contextType || contextType === "UNKNOWN")) {
    acceptanceBlocks.push("VISION_ONLY_EVIDENCE_WITHOUT_DETERMINISTIC_CONTEXT");
  }

  const eligibleForReasoning = reasoningBlocks.length === 0;
  const eligibleForAcceptance = eligibleForReasoning && acceptanceBlocks.length === 0;
  const reasons = [...reasoningBlocks, ...acceptanceBlocks];

  const verdict = !eligibleForReasoning ? GATE_VERDICT.BLOCKED
    : eligibleForAcceptance ? GATE_VERDICT.ELIGIBLE_FOR_ACCEPTANCE
    : GATE_VERDICT.ELIGIBLE_FOR_REASONING;

  return {
    verdict,
    ELIGIBLE_FOR_REASONING: eligibleForReasoning,
    ELIGIBLE_FOR_ACCEPTANCE: eligibleForAcceptance,
    BLOCK_REASON: reasons.length ? reasons.join("; ") : null,
    evidenceState,
    contextType: contextType ?? "UNKNOWN",
    ocrUncertainties,
    // Recorded so a report can prove confidence was never an input.
    MODEL_CONFIDENCE_IS_NOT_AUTHORITY: true,
  };
}

/**
 * The forced result a caller must emit when the gate blocks. This is produced
 * OUTSIDE the model, so a blank image cannot yield ACCEPT_FACT no matter what
 * the model wanted to say.
 */
export function forcedBlockedResult(gate, target = "UNKNOWN") {
  return {
    TARGET: target,
    BEST_SUPPORTED_PROJECT_CLASS: "UNKNOWN",
    STRUCTURAL_ROLE: "UNKNOWN",
    PROJECT_EVIDENCE_USED: [],
    VISUAL_EVIDENCE_USED: [],
    CONTRADICTIONS: [],
    EVIDENCE_GAPS: [`GATE_BLOCKED:${gate.BLOCK_REASON}`],
    CONFIDENCE_0_TO_100: 0,
    EVIDENCE_STATE: "INSUFFICIENT",
    RECOMMENDED_ACTION: "KEEP_UNKNOWN",
    GATE: gate,
    GATE_OVERRODE_MODEL: true,
  };
}

/**
 * Apply the gate to a model result. This function is MONOTONICALLY DOWNWARD:
 * it can turn ACCEPT_FACT into KEEP_UNKNOWN, but it can never turn KEEP_UNKNOWN
 * into ACCEPT_FACT. Model confidence is deliberately absent from the signature.
 */
export function applyGate(modelResult, gate) {
  if (!gate.ELIGIBLE_FOR_ACCEPTANCE) {
    return {
      ...modelResult,
      BEST_SUPPORTED_PROJECT_CLASS: "UNKNOWN",
      EVIDENCE_STATE: "INSUFFICIENT",
      RECOMMENDED_ACTION: "KEEP_UNKNOWN",
      CONFIDENCE_0_TO_100: 0,
      GATE: gate,
      GATE_OVERRODE_MODEL: true,
      MODEL_RAW_ACTION: modelResult?.RECOMMENDED_ACTION ?? null,
      MODEL_RAW_CLASS: modelResult?.BEST_SUPPORTED_PROJECT_CLASS ?? null,
      MODEL_RAW_CONFIDENCE: modelResult?.CONFIDENCE_0_TO_100 ?? null,
    };
  }
  return { ...modelResult, GATE: gate, GATE_OVERRODE_MODEL: false };
}

/** Derive the evidence state from a deterministic packet (+ optional VLM). */
export function deriveEvidenceState({ packet, vlmObservation = null }) {
  const text = !!packet?.tokens?.count;
  const nonText = !!(packet?.geometry?.straightLinework || (packet?.geometry?.enclosure && packet.geometry.enclosure !== "NONE"));
  const vlmText = Array.isArray(vlmObservation?.VISIBLE_TEXT) && vlmObservation.VISIBLE_TEXT.length > 0;
  const vlmNonText = !!(vlmObservation && vlmObservation.ENCLOSURE_SHAPE && !["NONE", "", null].includes(vlmObservation.ENCLOSURE_SHAPE));
  const anyText = text || vlmText;
  const anyNonText = nonText || vlmNonText;
  if (anyText && anyNonText) return EVIDENCE_STATE.BOTH;
  if (anyText) return EVIDENCE_STATE.TEXT_GLYPH;
  if (anyNonText) return EVIDENCE_STATE.NON_TEXT_VISUAL;
  return EVIDENCE_STATE.NONE;
}
