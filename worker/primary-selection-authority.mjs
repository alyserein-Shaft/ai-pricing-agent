// Canonical downstream authority for the primary product of one BOQ line.
//
// Ranking is a proposal, safety eligibility is readiness, and only a durable
// Approved Technical request attached to the exact current safety decision can
// authorize a selected product. This resolver deliberately keeps those three
// states separate so BOM, costing, and their write paths cannot silently drift.
export const PRIMARY_SELECTION_STATES = Object.freeze({
  APPROVED: "APPROVED",
  PROVISIONAL: "PROVISIONAL",
  AMBIGUOUS: "AMBIGUOUS",
  UNAVAILABLE: "UNAVAILABLE",
});

const unavailable = (code, blocker) => ({
  status: PRIMARY_SELECTION_STATES.UNAVAILABLE,
  code,
  approved: false,
  blocker,
  selection: null,
  provisionalCandidate: null,
  candidateIds: [],
  matchRun: null,
  safetyDecision: null,
  technicalApproval: null,
});

export const primarySelectionAuthorityView = (authority) => {
  const candidate = authority.selection || authority.provisionalCandidate;
  return {
    status: authority.status,
    code: authority.code,
    approved: authority.approved,
    candidateId: candidate?.candidateId || null,
    productId: candidate?.productId || null,
    safetyDecisionId: authority.safetyDecision?.id || null,
    technicalApprovalRequestId: authority.technicalApproval?.id || null,
    technicalApprovalStatus: authority.technicalApproval?.status || null,
    candidateIds: [...(authority.candidateIds || [])],
    matchRunId: authority.matchRun?.id || null,
  };
};

export async function resolveCurrentPrimarySelection(db, boqItemId) {
  const candidateRows = await db.prepare(`
    SELECT c.id candidateId, c.product_id productId, c.rank, r.id matchRunId
    FROM product_match_candidates c
    JOIN product_match_runs r ON r.id=c.match_run_id
    WHERE r.boq_item_id=? AND r.superseded_at IS NULL
      -- GOV-AUTH-1: same enforcement as pricing-runtime. A rejected candidate
      -- must never resolve as the primary selection even if a Technical
      -- approval row still names it; rejection revokes resolvability, and the
      -- approval row itself stays untouched as audit history.
      AND c.review_status NOT IN ('Rejected','Auto-Rejected Technical')
    ORDER BY c.rank, c.id
  `).bind(boqItemId).all();

  const candidates = (candidateRows.results || []).map((row) => ({
    candidateId: row.candidateId,
    productId: row.productId,
    rank: Number(row.rank),
    matchRunId: row.matchRunId,
  }));

  if (!candidates.length) {
    return unavailable(
      "NO_CURRENT_CANDIDATE",
      "No candidate exists in the current product match run.",
    );
  }

  const matchRunIds = [...new Set(candidates.map((candidate) => candidate.matchRunId))];
  // EVIDENCE-CURRENCY-1 (DFG-A) note: profile-staleness is enforced downstream,
  // not here. loadPricingInput refuses stale-profile runs (REQUIREMENT_PROFILE_
  // CHANGED) and covers every pricing/costing path; panel sizing carries its own
  // STALE_PANEL_PRODUCT_SELECTION check with a domain-specific code. Refusing
  // here would collapse those layers and mask the domain codes, so the resolver
  // stays profile-agnostic by design. Revisit only if a selection consumer
  // appears that neither prices nor carries its own staleness check.
  if (matchRunIds.length !== 1) {
    return {
      ...unavailable(
        "CURRENT_MATCH_RUN_AMBIGUOUS",
        "More than one non-superseded product match run exists; no primary selection can be resolved safely.",
      ),
      candidateIds: candidates.map((candidate) => candidate.candidateId),
    };
  }

  const evaluated = [];
  for (const candidate of candidates) {
    const safety = await db.prepare(`
      SELECT d.id, d.candidate_id candidateId, d.version_number versionNumber
      FROM safety_decisions d
      WHERE d.boq_item_id=? AND d.candidate_id=? AND d.superseded_at IS NULL
      ORDER BY d.version_number DESC
      LIMIT 1
    `).bind(boqItemId, candidate.candidateId).first();

    if (!safety) {
      evaluated.push({ candidate, safetyDecision: null, technicalApproval: null });
      continue;
    }

    const technicalApproval = await db.prepare(`
      SELECT id, status, entity_version entityVersion, decided_at decidedAt,
             created_at createdAt
      FROM safety_approval_requests
      WHERE safety_decision_id=? AND approval_type='Technical'
      ORDER BY COALESCE(decided_at, created_at) DESC, created_at DESC, id DESC
      LIMIT 1
    `).bind(safety.id).first();

    evaluated.push({ candidate, safetyDecision: safety, technicalApproval });
  }

  const approved = evaluated.filter(({ safetyDecision, technicalApproval }) =>
    technicalApproval?.status === "Approved"
    && Number(technicalApproval.entityVersion) === Number(safetyDecision.versionNumber)
  );

  if (approved.length > 1) {
    return {
      status: PRIMARY_SELECTION_STATES.AMBIGUOUS,
      code: "MULTIPLE_TECHNICAL_APPROVALS",
      approved: false,
      blocker: `${approved.length} current candidates have Approved Technical decisions; no primary selection can be resolved safely.`,
      selection: null,
      provisionalCandidate: null,
      candidateIds: approved.map(({ candidate }) => candidate.candidateId),
      matchRun: { id: matchRunIds[0] },
      safetyDecision: null,
      technicalApproval: null,
    };
  }

  if (approved.length === 1) {
    const { candidate, safetyDecision, technicalApproval } = approved[0];
    return {
      status: PRIMARY_SELECTION_STATES.APPROVED,
      code: null,
      approved: true,
      blocker: null,
      selection: { ...candidate, safetyDecisionId: safetyDecision.id },
      provisionalCandidate: null,
      candidateIds: [candidate.candidateId],
      matchRun: { id: matchRunIds[0] },
      safetyDecision,
      technicalApproval,
    };
  }

  const provisionalCandidate = candidates[0];
  const provisionalEvaluation = evaluated.find((entry) => entry.candidate.candidateId === provisionalCandidate.candidateId);
  if (!provisionalEvaluation?.safetyDecision) {
    return {
      status: PRIMARY_SELECTION_STATES.PROVISIONAL,
      code: "CURRENT_SAFETY_DECISION_REQUIRED",
      approved: false,
      blocker: "The highest-ranked current candidate is provisional only; it has no current safety decision.",
      selection: null,
      provisionalCandidate,
      candidateIds: candidates.map((candidate) => candidate.candidateId),
      matchRun: { id: matchRunIds[0] },
      safetyDecision: null,
      technicalApproval: null,
    };
  }

  const latestApproval = provisionalEvaluation.technicalApproval || null;
  const approvalDescription = latestApproval
    ? `the latest durable Technical approval request is ${latestApproval.status}`
    : "no durable Technical approval request has been recorded";

  return {
    status: PRIMARY_SELECTION_STATES.PROVISIONAL,
    code: "TECHNICAL_APPROVAL_REQUIRED",
    approved: false,
    blocker: `The highest-ranked current candidate remains provisional; ${approvalDescription} for its exact current safety decision.`,
    selection: null,
    provisionalCandidate,
    candidateIds: candidates.map((candidate) => candidate.candidateId),
    matchRun: { id: matchRunIds[0] },
    safetyDecision: provisionalEvaluation.safetyDecision,
    technicalApproval: latestApproval,
  };
}
