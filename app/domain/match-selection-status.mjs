// Matching -> Selected Product connection. The underlying selection
// mechanism already exists (safety_decisions + a Technical-type
// safety_approval_requests row is what pricing-runtime.mjs and
// quotation-line-authority.mjs already treat as "the selected product" --
// see loadPricingInput's technicalApproval check) -- this module does not
// invent a new selection concept. It only projects that existing state into
// one clear verdict per BOQ item, because nothing previously surfaced it
// where an engineer compares candidates, and nothing flagged the one real
// gap the schema allows: more than one candidate for the same item can each
// independently receive an Approved Technical decision (safety_decisions
// has no uniqueness constraint across candidates for one boq_item_id), which
// would leave "the selected product" ambiguous to any caller that assumes
// there is exactly one.
export const MATCH_SELECTION_STATUS_VERSION = "match-selection-status-1.0.0";

const ELIGIBLE_TECHNICAL_STATES = new Set(["Eligible for Technical Approval", "Eligible with Required Warning Acknowledgment"]);

// candidates: [{ candidateId, technicalEligibility: string|null, technicalApproved: boolean, priceEligibility: string|null }]
// technicalEligibility/priceEligibility are the exact labels
// confidence-safety-engine.mjs already computes (null when no safety
// decision has ever been evaluated for that candidate). technicalApproved
// reflects the exact same "latest Approved Technical safety_approval_requests
// row" check pricing-runtime.mjs's loadPricingInput already performs --
// passed in, not re-derived, so the two can never disagree.
export function deriveMatchSelectionStatus({ candidates = [] } = {}) {
  const perCandidate = candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    // Rank/score are read for display only, never for this status --
    // authorization comes solely from technicalApproved (a real engineer
    // decision), matching the requirement that ranking or confidence alone
    // must never authorize selection.
    technicalEligibility: candidate.technicalEligibility ?? null,
    priceEligibility: candidate.priceEligibility ?? null,
    status: candidate.technicalApproved
      ? "Selected"
      : ELIGIBLE_TECHNICAL_STATES.has(candidate.technicalEligibility)
        ? "Eligible"
        : candidate.technicalEligibility
          ? "Not Eligible"
          : "Not Evaluated",
  }));

  if (!perCandidate.length) {
    return { version: MATCH_SELECTION_STATUS_VERSION, verdict: "NO_CANDIDATES", reason: "No product match candidates exist for this item.", selectedCandidateId: null, candidates: perCandidate };
  }

  const selected = perCandidate.filter((entry) => entry.status === "Selected");
  if (selected.length === 1) {
    return { version: MATCH_SELECTION_STATUS_VERSION, verdict: "SELECTED", reason: "Exactly one candidate has an Approved Technical decision.", selectedCandidateId: selected[0].candidateId, candidates: perCandidate };
  }
  if (selected.length > 1) {
    // Real, structurally-possible state (no DB constraint prevents it) --
    // reported, never silently resolved by picking one (e.g. highest rank),
    // since that would itself be an invented automatic-selection policy.
    return {
      version: MATCH_SELECTION_STATUS_VERSION,
      verdict: "AMBIGUOUS",
      reason: `${selected.length} candidates each have an Approved Technical decision for this item; exactly one selection must be resolved by an engineer.`,
      selectedCandidateId: null,
      ambiguousCandidateIds: selected.map((entry) => entry.candidateId),
      candidates: perCandidate,
    };
  }

  const eligible = perCandidate.filter((entry) => entry.status === "Eligible");
  if (eligible.length) {
    return {
      version: MATCH_SELECTION_STATUS_VERSION,
      verdict: "PENDING_DECISION",
      reason: `${eligible.length} candidate${eligible.length === 1 ? " is" : "s are"} eligible for Technical Approval; no engineer decision has been recorded yet. No automatic-selection policy exists -- eligibility alone never authorizes selection.`,
      selectedCandidateId: null,
      eligibleCandidateIds: eligible.map((entry) => entry.candidateId),
      candidates: perCandidate,
    };
  }

  return {
    version: MATCH_SELECTION_STATUS_VERSION,
    verdict: "BLOCKED",
    reason: "No candidate currently qualifies for Technical Approval.",
    selectedCandidateId: null,
    candidates: perCandidate,
  };
}
