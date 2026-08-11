export function technicalRequirementModel(requirement) {
  if (!requirement) return null;
  return Object.freeze({
    id: requirement.id,
    reviewStatus: requirement.review_status,
    approvedForDownstream: requirement.approved_for_downstream,
    confidence: requirement.confidence,
    confidenceState: requirement.confidence_state,
    evidence: requirement.original_text,
    sourceLocation: requirement.source_location,
    currentValues: requirement.current_values,
  });
}

export function matchingCandidateModel(candidate, safetyDecision = null) {
  if (!candidate) return null;
  const discoveryOnly =
    candidate.recommendation_tier === "Discovery Only" ||
    candidate.technical_status === "Discovery Only" ||
    candidate.confidence_state === "Discovery Only";
  const approvalEligible = Boolean(
    safetyDecision &&
      /^Eligible/.test(safetyDecision.technical_eligibility || "") &&
      safetyDecision.blocks?.length === 0 &&
      !safetyDecision.warnings?.some((warning) => !warning.acknowledged_at) &&
      !discoveryOnly,
  );
  return Object.freeze({
    id: candidate.id,
    confidence: candidate.confidence_state,
    technicalStatus: candidate.technical_status,
    recommendationTier: candidate.recommendation_tier,
    discoveryOnly,
    approvalEligible,
  });
}

export function validSelectedItem(items, requestedId) {
  if (!requestedId) return null;
  return items.some((item) => item.id === requestedId) ? requestedId : null;
}

export function selectionAfterProjectChange(previousProjectId, nextProjectId, selectedItemId) {
  return previousProjectId === nextProjectId ? selectedItemId || null : null;
}
