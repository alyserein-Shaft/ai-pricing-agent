// Agent 8 -- staged product-matching decision presentation model.
//
// Purpose
// -------
// The matching surface currently answers one question with one number: it shows
// `technical_status` and `fit N%` for every candidate and lets the engineer
// infer compatibility, contractual acceptance, lifecycle, regional and
// commercial availability from that single line. This model separates those
// six axes so each one is judged, displayed and blocked on its own terms.
//
// Hard constraints honoured here
// -----------------------------
// 1. Nothing is inferred. A dimension with no governed evidence is reported as
//    NOT_EVIDENCED with an explicit "no evidence recorded" label. It is never
//    upgraded to a pass, and an unknown value is never rendered as 0.
// 2. The axes are independent. Changing commercial availability must not change
//    technical compatibility and vice versa; `dimensionSeparationProof`
//    exposes the inputs each axis read so that stays checkable.
// 3. No brand is hard-coded. Project brand/standard authority is consumed from
//    the governed `projectStrategy` payload only. The Fire Alarm brand policy
//    (Farenhyt / Gamewell / Gent, and NOTIFIER as a technically valid
//    alternative) is decided upstream in docs/fire-alarm-brand-and-pre-sales-policy.md
//    and recorded there; a component may not invent or default it.
// 4. Blocking is explained, not asserted. A blocked stage produces one concrete
//    next action with a real workspace target instead of a dead end.

export const MATCHING_DIMENSIONS = Object.freeze([
  "technicalCompatibility",
  "contractualAcceptance",
  "lifecycle",
  "regionalAvailability",
  "commercialAvailability",
  "evidenceConfidence",
]);

export const MATCHING_DIMENSION_LABELS = Object.freeze({
  technicalCompatibility: "Technical compatibility",
  contractualAcceptance: "Contractual acceptance",
  lifecycle: "Lifecycle",
  regionalAvailability: "Regional availability",
  commercialAvailability: "Commercial availability",
  evidenceConfidence: "Evidence confidence",
});

export const DIMENSION_TONE = Object.freeze({
  EVIDENCED: "tone-ready",
  NOT_EVIDENCED: "tone-unknown",
  BLOCKED: "tone-blocked",
  CONFLICT: "tone-conflict",
});

const NOT_EVIDENCED = (label, detail) => ({ state: "NOT_EVIDENCED", label, detail, tone: DIMENSION_TONE.NOT_EVIDENCED });
const EVIDENCED = (label, detail) => ({ state: "EVIDENCED", label, detail, tone: DIMENSION_TONE.EVIDENCED });
const BLOCKED = (label, detail) => ({ state: "BLOCKED", label, detail, tone: DIMENSION_TONE.BLOCKED });
const CONFLICT = (label, detail) => ({ state: "CONFLICT", label, detail, tone: DIMENSION_TONE.CONFLICT });

const text = (value) => (value == null ? "" : String(value).trim());
const list = (value) => (Array.isArray(value) ? value.map((entry) => text(entry)).filter(Boolean) : []);

// Technical compatibility: the engine's own technical status, the matching
// basis it recorded, and any mandatory failure it reported. These three are the
// only inputs consulted -- no commercial or brand signal may leak in.
export function technicalCompatibilityDimension(candidate) {
  if (!candidate) return NOT_EVIDENCED("Technical compatibility", "No candidate selected.");
  const status = text(candidate.technicalStatus ?? candidate.technical_status);
  const basis = list(candidate.matchingBasis);
  const failures = list(candidate.mandatoryFailures);
  if (failures.length > 0) return BLOCKED(status || "Blocked", `${failures.length} mismatching or missing item(s): ${failures.slice(0, 3).join("; ")}`);
  if (/discovery only/i.test(status)) return NOT_EVIDENCED(status, "Discovery Only -- not evidence of technical compatibility.");
  if (!status) return NOT_EVIDENCED("Technical compatibility", "The engine recorded no technical status for this candidate.");
  return EVIDENCED(status, basis.length ? `Verified basis: ${basis.slice(0, 3).join("; ")}` : "Engine recorded a technical status without a per-requirement basis.");
}

// Contractual acceptance: strictly a function of the governed project strategy.
// With no strategy payload this axis is unknown, never "accepted".
export function contractualAcceptanceDimension(candidate, projectStrategy = null) {
  if (!candidate) return NOT_EVIDENCED("Contractual acceptance", "No candidate selected.");
  const strategy = projectStrategy && typeof projectStrategy === "object" ? projectStrategy : null;
  const target = text(strategy?.targetBrand) || text(strategy?.targetManufacturer);
  const regime = text(strategy?.standardRegime);
  const reviewState = text(strategy?.reviewState);
  const mandated = strategy?.contractuallyMandated === true;

  if (!strategy || (!target && !regime)) {
    return NOT_EVIDENCED("Contractual acceptance", "No governed brand or standards authority is recorded for this project. A manufacturer named in a specification is not a mandate.");
  }
  const candidateBrand = text(candidate.manufacturer);
  const candidateMatches = Boolean(target) && candidateBrand.toLowerCase() === target.toLowerCase();
  const parts = [];
  if (target) parts.push(mandated ? `Contractually mandated brand: ${target}.` : `Project brand target: ${target}.`);
  if (regime) parts.push(`Standards regime: ${regime}.`);
  if (candidateMatches && mandated) return EVIDENCED("Brand mandated by contract", `${parts.join(" ")} Manufacturer acceptance remains a Consultant question and is not settled by the brand mandate alone.`);
  if (candidateMatches) return EVIDENCED("Matches the project brand target", `${parts.join(" ")} Manufacturer acceptance is still a Consultant question.`);
  if (mandated) return BLOCKED("Outside the contractually mandated brand", `${parts.join(" ")} This candidate cannot be selected without a recorded approved-equivalent decision.`);
  return CONFLICT("Different from the project brand target", `${parts.join(" ")} Substituting this manufacturer is a proposed equivalent that requires human approval.`);
}

// Lifecycle: only shown when the governed payload carries it.
export function lifecycleDimension(candidate) {
  const state = text(candidate?.lifecycleState ?? candidate?.lifecycle_state ?? candidate?.lifecycle);
  if (!state) return NOT_EVIDENCED("Lifecycle", "No lifecycle or end-of-life record is attached to this candidate.");
  if (/end of life|eol|discontinu/i.test(state)) return BLOCKED(state, "This product line is at or past end of life.");
  if (/phase|obsolesc|discontinu/i.test(state)) return CONFLICT(state, "Lifecycle state requires review before commitment.");
  return EVIDENCED(state, "Lifecycle state recorded on the governed product record.");
}

// Regional availability: only shown when the governed payload carries it.
export function regionalAvailabilityDimension(candidate) {
  const value = text(candidate?.regionalAvailability ?? candidate?.regional_availability);
  if (!value) return NOT_EVIDENCED("Regional availability", "No regional availability record is attached to this candidate.");
  if (/restricted|not available|unavailable/i.test(value)) return BLOCKED(value, "Not confirmed available for this project region.");
  if (/unknown|unconfirmed/i.test(value)) return NOT_EVIDENCED(value, "Regional availability is unconfirmed.");
  return EVIDENCED(value, "Regional availability recorded on the governed product record.");
}

// Commercial availability: deliberately isolated from technical eligibility.
export function commercialAvailabilityDimension(candidate) {
  const value = text(candidate?.commercial_availability ?? candidate?.commercialAvailability);
  if (!value) return NOT_EVIDENCED("Commercial availability", "No commercial availability record is attached to this candidate.");
  if (/unavailable|restricted|discontinued/i.test(value)) return BLOCKED(value, "Commercial availability is restricted.");
  if (/unknown|unconfirmed|pending/i.test(value)) return NOT_EVIDENCED(value, "Commercial availability is unconfirmed.");
  return EVIDENCED(value, "Commercial availability recorded on the governed product record.");
}

// Evidence confidence: the engine's confidence state plus any unacknowledged
// safety warnings, which a confidence number alone does not reveal.
export function evidenceConfidenceDimension(candidate, safetyDecision = null) {
  const state = text(candidate?.confidence_state ?? candidate?.confidence);
  const score = Number(candidate?.confidence_score ?? candidate?.confidenceScore);
  const unacknowledged = (safetyDecision?.warnings || []).filter((warning) => !warning.acknowledged_at);
  if (!state) return NOT_EVIDENCED("Evidence confidence", "No confidence state recorded for this candidate.");
  if (unacknowledged.length > 0) {
    return CONFLICT(state, `${unacknowledged.length} safety warning(s) not yet acknowledged: ${unacknowledged.map((w) => text(w.code || w.message)).slice(0, 2).join("; ")}`);
  }
  const scoreText = Number.isFinite(score) ? ` (${score}%)` : "";
  return EVIDENCED(state, `Recorded confidence${scoreText}. Confidence is evidence quality, not engineering approval.`);
}

export function candidateDimensionPanel(candidate, { safetyDecision = null, projectStrategy = null } = {}) {
  const dimensions = {
    technicalCompatibility: technicalCompatibilityDimension(candidate),
    contractualAcceptance: contractualAcceptanceDimension(candidate, projectStrategy),
    lifecycle: lifecycleDimension(candidate),
    regionalAvailability: regionalAvailabilityDimension(candidate),
    commercialAvailability: commercialAvailabilityDimension(candidate),
    evidenceConfidence: evidenceConfidenceDimension(candidate, safetyDecision),
  };
  const blocking = MATCHING_DIMENSIONS.filter((key) => dimensions[key].state === "BLOCKED");
  return Object.freeze({
    candidateId: text(candidate?.id ?? candidate?.candidateId) || null,
    partNumber: text(candidate?.part_number ?? candidate?.partNumber) || null,
    manufacturer: text(candidate?.manufacturer) || null,
    dimensions,
    blockedDimensions: blocking,
    // Approval requires no BLOCKED axis; NOT_EVIDENCED is a visible gap the
    // engineer may still accept, and is never silently treated as a pass.
    approvalBlocked: blocking.length > 0,
    unknownDimensions: MATCHING_DIMENSIONS.filter((key) => dimensions[key].state === "NOT_EVIDENCED"),
  });
}

// Which candidate is shown first. Rank 1 that is not a fallback wins; a
// fallback candidate is only promoted when nothing else exists, and the reason
// is always stated rather than implied by position.
export function stagedCandidates(candidates = []) {
  const usable = (Array.isArray(candidates) ? candidates : []).filter(Boolean);
  if (!usable.length) return { recommended: null, alternatives: [], fallbackPromoted: false };
  const ranked = [...usable].sort((a, b) => {
    const rank = (Number(a.rank) || 0) - (Number(b.rank) || 0);
    if (rank !== 0) return rank;
    return Number(Boolean(a.isFallbackCandidate)) - Number(Boolean(b.isFallbackCandidate));
  });
  const firstNonFallback = ranked.find((candidate) => !candidate.isFallbackCandidate) || null;
  const recommended = firstNonFallback || ranked[0];
  const fallbackPromoted = !firstNonFallback && Boolean(ranked[0].isFallbackCandidate);
  return {
    recommended,
    alternatives: ranked.filter((candidate) => candidate.id !== recommended.id),
    fallbackPromoted,
  };
}

const WORKSPACE_TARGETS = Object.freeze({
  understanding: "AI Understanding Review",
  requirements: "Requirements",
  matching: "Technical Matching",
  library: "Product Library",
});

// Turns "matching is unavailable" into one concrete, owned next action.
// `blockers` are the governed blocker strings already produced by the backend;
// they are matched by explicit keyword, and an unmatched blocker produces an
// honest "unclassified blocker" action instead of an invented explanation.
export function matchingNextAction({ blockers = [], stageStatus = "", approvedUnderstanding = 0, awaitingUnderstanding = 0, itemCount = 0, pendingRequirements = 0, matchStale = false } = {}) {
  const reasons = list(blockers);
  const text_ = reasons.join(" ").toLowerCase();

  if (matchStale) {
    return { kind: "STALE", label: "Re-run product matching", detail: "Requirements changed after this match ran, so these candidates are not current and cannot be approved.", workspace: WORKSPACE_TARGETS.matching, action: "RERUN_MATCHING" };
  }
  if (reasons.length === 0 && itemCount > 0 && !/not started|waiting|blocked/i.test(stageStatus)) {
    return { kind: "READY", label: "Review persisted candidates", detail: "Candidates are available for engineer review.", workspace: WORKSPACE_TARGETS.matching, action: "OPEN_MATCHING" };
  }
  if (itemCount === 0) {
    return { kind: "BLOCKED", label: "Open Product Matching prerequisites", detail: "No persisted BOQ items are available for product selection.", workspace: WORKSPACE_TARGETS.matching, action: "OPEN_PREREQUISITES" };
  }
  if (/understanding|interpretation|classification/.test(text_) || (approvedUnderstanding === 0 && awaitingUnderstanding > 0)) {
    return { kind: "BLOCKED", label: "Review AI understanding", detail: `${awaitingUnderstanding} interpretation(s) still need engineer review. Product discovery stays closed until understanding is approved.`, workspace: WORKSPACE_TARGETS.understanding, action: "OPEN_UNDERSTANDING" };
  }
  if (/requirement/.test(text_) || pendingRequirements > 0) {
    return { kind: "BLOCKED", label: "Review applicable requirements", detail: `${pendingRequirements} requirement(s) are not yet approved for downstream matching.`, workspace: WORKSPACE_TARGETS.requirements, action: "OPEN_REQUIREMENTS" };
  }
  if (reasons.length > 0) {
    return { kind: "BLOCKED", label: "Open Product Matching to resolve the blocker", detail: reasons[0], workspace: WORKSPACE_TARGETS.matching, action: "OPEN_MATCHING" };
  }
  return { kind: "PENDING", label: "Start technical matching", detail: "No persisted candidate result exists for this item yet.", workspace: WORKSPACE_TARGETS.matching, action: "RUN_MATCHING" };
}

export function matchingDecisionModel(input = {}) {
  const staged = stagedCandidates(input.candidates);
  const safetyFor = input.safetyFor || (() => null);
  return Object.freeze({
    status: input.status || "",
    stale: Boolean(input.matchStale),
    staleReason: text(input.matchStaleReason) || null,
    recommended: staged.recommended
      ? { candidate: staged.recommended, panel: candidateDimensionPanel(staged.recommended, { safetyDecision: safetyFor(staged.recommended), projectStrategy: input.projectStrategy || null }), fallbackPromoted: staged.fallbackPromoted }
      : null,
    alternatives: staged.alternatives.map((candidate) => ({ candidate, panel: candidateDimensionPanel(candidate, { safetyDecision: safetyFor(candidate), projectStrategy: input.projectStrategy || null }) })),
    projectStrategy: input.projectStrategy || null,
    nextAction: matchingNextAction({
      blockers: input.blockers,
      stageStatus: input.stageStatus,
      approvedUnderstanding: Number(input.approvedUnderstanding || 0),
      awaitingUnderstanding: Number(input.awaitingUnderstanding || 0),
      itemCount: Number(input.itemCount || 0),
      pendingRequirements: Number(input.pendingRequirements || 0),
      matchStale: input.matchStale,
    }),
    emptyState: (Array.isArray(input.candidates) ? input.candidates.length : 0) === 0,
  });
}
