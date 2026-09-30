// GOLDEN-5 -- GOVERNED FIRE ALARM ECOSYSTEM-SELECTION POLICY.
//
// Pure domain foundation that decides WHICH Fire Alarm panel/loop ecosystem
// (compatibility family) a project is governed by, REPLACING the assumption
// that "Honeywell / Notifier = the project-wide compatibility basis".
//
// The ecosystem is a COMPATIBILITY FAMILY, never an exact panel model. This
// module performs PRELIMINARY ecosystem sizing only: it decides which
// manufacturer ecosystem family the project belongs to (Farenhyt, Gent,
// Gamewell-FCI, Simplex, ...), and it NEVER selects a panel model, loop
// capacity, network topology, or expansion module. Exact panel sizing is a
// later, separately-governed stage (fire_alarm_panel_sizing_snapshots); this
// policy deliberately never crosses Compatibility -> Preliminary Sizing.
//
// HARD DESIGN INVARIANTS:
//   1. Only RESOLVED states ever carry a compatibilityTarget. Every unresolved
//      review state (missing compliance basis, missing sizing snapshot,
//      insufficient complexity evidence, large-UL/FM evaluation pending)
//      returns compatibilityTarget = null, so no caller may write a
//      requirement_compatibility row before the ecosystem is actually
//      resolved.
//   2. FlashScan / CLIP protocol references are CONTEXT ONLY. They are
//      accepted as inputs, recorded as context, and NEVER consulted for
//      resolution -- a protocol reference alone can never resolve an
//      ecosystem and can never clear compatibilityTarget.
//   3. The 2,000-point Farenhyt threshold is an INTERNAL engineering /
//      business selection threshold, NOT a manufacturer-certified technical
//      maximum. The Farenhyt resolution carries thresholdIsCertifiedMaximum:
//      false structurally.
//   4. A large UL/FM system (>2,000 points OR established exceptional
//      complexity) NEVER auto-selects between Gamewell-FCI and Simplex. The
//      candidates are surfaced for governed human evaluation, and a
//      compatibility target is only produced from an explicit approved
//      selection of exactly one candidate.
//   5. Complexity is tri-state: high / not-exceptional / insufficient. When
//      complexity evidence is insufficient, a review state is returned
//      (COMPLEXITY_REVIEW_REQUIRED) -- the policy NEVER guesses.
//   6. Manufacturer identity is never conflated with compatibility evidence.
//      The decision is expressed as ecosystem targets consumed by
//      requirement_compatibility (GOLDEN-4 architecture), never as a
//      manufacturer assignment.
//
// Authority/basis contract (GOLDEN-4 architecture, extended):
//   - EXPLICIT project ecosystem  -> basis PROJECT_REQUIREMENT
//   - Rule B policy resolution     -> basis ENGINEERING_POLICY_RESOLUTION
//   - Approved large-system pick   -> basis HUMAN_ENGINEERING_DECISION
// Every resolution records which rule fired, which inputs were used, and why,
// so the persisted decision can carry full provenance.
//
// Pure domain logic: no DOM, no fetch, no DB, no Math.random. Unknown /
// ambiguous evidence FAILS CLOSED to the review state, never to a guess.

export const FIRE_ALARM_ECOSYSTEM_POLICY_VERSION = "fire-alarm-ecosystem-policy-1.0.0";

// Internal engineering/business selection threshold for the UL/FM preliminary
// sizing route. Explicitly NOT a manufacturer-certified technical maximum.
export const FARENHYT_PRELIMINARY_POINT_THRESHOLD = 2000;
export const FARENHYT_THRESHOLD_WORDING =
  "internal engineering/business selection threshold, not a manufacturer-certified technical maximum";

// The canonical decision states. Unresolved review states never carry a
// compatibilityTarget (see resolveFireAlarmEcosystem).
export const ECOSYSTEM_DECISION_STATES = Object.freeze([
  "EXPLICIT_PROJECT_ECOSYSTEM",
  "RESOLVED_FARENHYT",
  "RESOLVED_GENT",
  "LARGE_ULFM_ECOSYSTEM_EVALUATION_REQUIRED",
  "MISSING_FIRE_ALARM_COMPLIANCE_BASIS",
  "PANEL_SIZING_SNAPSHOT_REQUIRED",
  "COMPLEXITY_REVIEW_REQUIRED",
]);

// States that carry a resolved ecosystem and therefore a compatibilityTarget.
const RESOLVED_STATES = new Set(["EXPLICIT_PROJECT_ECOSYSTEM", "RESOLVED_FARENHYT", "RESOLVED_GENT"]);

// Complaint-regime vocabulary. EN54 / LPCB / European regimes map to the
// Gent by Honeywell ecosystem (Rule B); UL/FM regimes go through the
// preliminary sizing route. Anything else, or conflicting evidence, is
// MISSING_FIRE_ALARM_COMPLIANCE_BASIS -- never guessed.
export const COMPLIANCE_REGIMES = Object.freeze({
  ULFM: "UL/FM",
  LPCB_EN54_EUROPEAN: "LPCB/EN54/European",
});

// Canonical ecosystem target labels used by requirement_compatibility. These
// are the ONLY compatibility targets this policy may produce.
export const RESOLVED_ECOSYSTEM_TARGETS = Object.freeze({
  FARENHYT: "Honeywell Farenhyt Fire Alarm ecosystem",
  GENT: "Gent by Honeywell Fire Alarm ecosystem",
  GAMEWELL_FCI: "Honeywell Gamewell-FCI Fire Alarm ecosystem",
  SIMPLEX: "Simplex Fire Alarm ecosystem",
});

// The two candidates for a large UL/FM system. NEVER auto-picked: a governed
// human evaluation selects exactly one before any compatibility row exists.
export const LARGE_ULFM_CANDIDATES = Object.freeze([
  RESOLVED_ECOSYSTEM_TARGETS.GAMEWELL_FCI,
  RESOLVED_ECOSYSTEM_TARGETS.SIMPLEX,
]);

// Authority bases the policy may produce (same contract GOLDEN-4 introduced
// via technical_requirements.source_location.basis).
export const AUTHORITY_BASES = Object.freeze([
  "PROJECT_REQUIREMENT",
  "HUMAN_ENGINEERING_DECISION",
  "ENGINEERING_POLICY_RESOLUTION",
]);

// Rule identifiers produced by this policy. Persisted callers fold these into
// the decision's provenance so "which rule fired" is always legible.
export const POLICY_RULES = Object.freeze({
  EXPLICIT_PROJECT_ECOSYSTEM: "RULE_A_EXPLICIT_PROJECT_ECOSYSTEM",
  COMPLIANCE_REGIME_GENT: "RULE_B_COMPLIANCE_REGIME_GENT",
  COMPLIANCE_REGIME_MISSING: "RULE_B_COMPLIANCE_REGIME_MISSING",
  FARENHYT: "RULE_C_ULFM_PRELIMINARY_FARENHYT",
  SIZING_SNAPSHOT_REQUIRED: "RULE_C_ULFM_PRELIMINARY_SIZING_SNAPSHOT_REQUIRED",
  LARGE_SYSTEM_EVALUATION: "RULE_C_ULFM_LARGE_SYSTEM_EVALUATION_REQUIRED",
  COMPLEXITY_REVIEW: "RULE_C_ULFM_COMPLEXITY_REVIEW_REQUIRED",
  APPROVED_LARGE_SYSTEM_SELECTION: "RULE_D_APPROVED_LARGE_SYSTEM_SELECTION",
});

// ---------------------------------------------------------------------------
// Compliance-regime normalization (Rule B input).
// ---------------------------------------------------------------------------
const REGIME_ULFM_PATTERN = /\b(UL|ULC|FM|UL\/FM|FM Global)\b/i;
const REGIME_EUROPEAN_PATTERN = /\b(EN\s?54|LPCB|BS\s?5839|European)\b/i;

// Normalizes a single compliance-regime statement to the canonical regime
// value, or null when the statement is unrecognized OR contradictory.
export function normalizeComplianceRegime(value) {
  const statement = String(value ?? "").trim();
  if (!statement) return null;
  const ul = REGIME_ULFM_PATTERN.test(statement);
  const eu = REGIME_EUROPEAN_PATTERN.test(statement);
  if (ul && eu) return null; // contradictory -- fail closed, never guess
  if (ul) return COMPLIANCE_REGIMES.ULFM;
  if (eu) return COMPLIANCE_REGIMES.LPCB_EN54_EUROPEAN;
  return null;
}

// ---------------------------------------------------------------------------
// Complexity evidence normalization (Rule C input).
// ---------------------------------------------------------------------------
// "high"        -- exceptional complexity is ESTABLISHED by governed evidence.
// "not-exceptional" -- no exceptional complexity is ESTABLISHED by governed
//                  evidence (an assessed small/medium system).
// null          -- insufficient evidence; the policy returns a review state.
const HIGH_COMPLEXITY_SIGNALS = /campus|voice evacuation|smoke control|high-rise|process plant|multiple (?:networked )?panels|networked panels|phased evacuation|fire-fighting lift/i;
const NOT_EXCEPTIONAL_SIGNALS = /(?:small|medium) (?:sized )?system|single building|no exceptional|standard occupancy/i;

// Normalizes a complexity statement to "high" | "not-exceptional" | null.
// Contradictory statements fail closed to null (review state).
export function normalizeComplexityEvidence(value) {
  const statement = String(value ?? "").trim().toLowerCase();
  if (!statement) return null;
  const high = statement === "high"
    || statement === "exceptional"
    || HIGH_COMPLEXITY_SIGNALS.test(statement);
  const normal = ["not-exceptional", "not exceptional", "standard", "small system", "medium system", "single building"]
    .includes(statement)
    || NOT_EXCEPTIONAL_SIGNALS.test(statement);
  if (high && normal) return null; // contradictory -- fail closed, never guess
  if (high) return "high";
  if (normal) return "not-exceptional";
  return null;
}

// ---------------------------------------------------------------------------
// THE POLICY. resolveFireAlarmEcosystem(input) -> decision.
// ---------------------------------------------------------------------------
//
// input:
//   explicitProjectEcosystem: string | null
//       An APPROVED project requirement that explicitly names the governing
//       manufacturer ecosystem/family (a real governed mandate, never a
//       five-manufacturer reference list and never a protocol reference).
//   complianceRegime: "UL/FM" | "LPCB/EN54/European" | null
//       Governed compliance-regime evidence for the project.
//   preliminaryTotalPoints: number | null
//       PRELIMINARY total addressable point count for UL/FM sizing, sourced
//       from a governed preliminary sizing snapshot (never guessed).
//   complexity: "high" | "not-exceptional" | null
//       Established complexity evidence (Rule C-2). null = insufficient.
//   protocolReferences: string[]
//       CONTEXT ONLY. FlashScan / CLIP and any other protocol reference are
//       accepted, echoed back as context, and NEVER consulted for resolution.
//   approvedLargeSystemEcosystem: string | null
//       For a LARGE_ULFM_ECOSYSTEM_EVALUATION_REQUIRED decision: an approved
//       governed human selection of exactly one LARGE_ULFM_CANDIDATES value.
//       Supplying this converts the review state into a resolved
//       HUMAN_ENGINEERING_DECISION with that candidate as the target. Any
//       other value is refused (fail closed).
export function resolveFireAlarmEcosystem({
  explicitProjectEcosystem = null,
  complianceRegime = null,
  preliminaryTotalPoints = null,
  complexity = null,
  protocolReferences = [],
  approvedLargeSystemEcosystem = null,
} = {}) {
  const normalizedPoints = (raw) => {
    if (raw === null || raw === undefined || raw === "") return null;
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : null;
  };
  const inputsUsed = {
    explicitProjectEcosystem: explicitProjectEcosystem != null && String(explicitProjectEcosystem).trim() !== "",
    complianceRegime: normalizeComplianceRegime(complianceRegime),
    preliminaryTotalPoints: normalizedPoints(preliminaryTotalPoints),
    complexity: normalizeComplexityEvidence(complexity),
    protocolReferences: Array.isArray(protocolReferences) ? protocolReferences.filter((entry) => String(entry ?? "").trim()) : [],
  };
  const protocolContextProvided = inputsUsed.protocolReferences.length > 0;

  const base = {
    version: FIRE_ALARM_ECOSYSTEM_POLICY_VERSION,
    threshold: FARENHYT_PRELIMINARY_POINT_THRESHOLD,
    thresholdWording: FARENHYT_THRESHOLD_WORDING,
    thresholdIsCertifiedMaximum: false,
    resolvedEcosystem: null,
    compatibilityTarget: null,
    basis: null,
    needsReview: false,
    protocolReferencesIgnored: false,
    inputsUsed,
  };

  // RULE A -- an explicit project ecosystem requirement wins over every
  // default. Basis PROJECT_REQUIREMENT. This is the ONLY rule that may carry
  // an ecosystem named by the project itself.
  if (inputsUsed.explicitProjectEcosystem) {
    return {
      ...base,
      decisionState: "EXPLICIT_PROJECT_ECOSYSTEM",
      resolvedEcosystem: String(explicitProjectEcosystem).trim(),
      compatibilityTarget: String(explicitProjectEcosystem).trim(),
      basis: "PROJECT_REQUIREMENT",
      ruleId: POLICY_RULES.EXPLICIT_PROJECT_ECOSYSTEM,
      reason: "An approved project requirement explicitly names the governing Fire Alarm ecosystem; the project requirement wins over every policy default.",
      protocolReferencesIgnored: protocolContextProvided,
    };
  }

  // RULE B -- compliance regime.
  if (!inputsUsed.complianceRegime) {
    return {
      ...base,
      decisionState: "MISSING_FIRE_ALARM_COMPLIANCE_BASIS",
      ruleId: POLICY_RULES.COMPLIANCE_REGIME_MISSING,
      needsReview: true,
      protocolReferencesIgnored: protocolContextProvided,
      reason: "No governed compliance regime (UL/FM or LPCB/EN54/European) is established for the project, so no ecosystem can be selected. A FlashScan / CLIP protocol reference is context only and never resolves an ecosystem.",
    };
  }

  if (inputsUsed.complianceRegime === COMPLIANCE_REGIMES.LPCB_EN54_EUROPEAN) {
    return {
      ...base,
      decisionState: "RESOLVED_GENT",
      resolvedEcosystem: RESOLVED_ECOSYSTEM_TARGETS.GENT,
      compatibilityTarget: RESOLVED_ECOSYSTEM_TARGETS.GENT,
      basis: "ENGINEERING_POLICY_RESOLUTION",
      ruleId: POLICY_RULES.COMPLIANCE_REGIME_GENT,
      protocolReferencesIgnored: protocolContextProvided,
      reason: "An LPCB/EN54/European compliance regime governs the project; the governed ecosystem policy resolves the compatibility family to Gent by Honeywell per Rule B. Preliminary point counts and complexity do not enter this route.",
    };
  }

  // RULE C -- UL/FM preliminary sizing. The point count must come from a
  // governed preliminary sizing snapshot.
  if (inputsUsed.preliminaryTotalPoints === null) {
    return {
      ...base,
      decisionState: "PANEL_SIZING_SNAPSHOT_REQUIRED",
      ruleId: POLICY_RULES.SIZING_SNAPSHOT_REQUIRED,
      needsReview: true,
      protocolReferencesIgnored: protocolContextProvided,
      reason: "The UL/FM regime requires an established preliminary point count before an ecosystem can be selected; none is available, so a governed preliminary panel-sizing snapshot is required. Point counts are never guessed.",
    };
  }

  // Large-UL/FM trigger: points above the internal threshold, OR established
  // exceptional complexity. Both lead to governed evaluation, never to an
  // automatic Gamewell-FCI-vs-Simplex choice.
  const pointsAboveThreshold = inputsUsed.preliminaryTotalPoints > FARENHYT_PRELIMINARY_POINT_THRESHOLD;

  // Complexity is only decisive at or below the threshold. When its evidence
  // is insufficient (null), the policy returns a review state rather than
  // silently assuming "not exceptional". Establish exceptional complexity is
  // enough on its own to trigger the large-system evaluation, even below the
  // point threshold.
  if (inputsUsed.complexity === "high" || pointsAboveThreshold) {
    if (approvedLargeSystemEcosystem == null || String(approvedLargeSystemEcosystem).trim() === "") {
      return {
        ...base,
        decisionState: "LARGE_ULFM_ECOSYSTEM_EVALUATION_REQUIRED",
        ruleId: POLICY_RULES.LARGE_SYSTEM_EVALUATION,
        candidates: [...LARGE_ULFM_CANDIDATES],
        needsReview: true,
        protocolReferencesIgnored: protocolContextProvided,
        reason: pointsAboveThreshold
          ? `The preliminary point count (${inputsUsed.preliminaryTotalPoints}) exceeds the internal ${FARENHYT_PRELIMINARY_POINT_THRESHOLD}-point selection threshold (${FARENHYT_THRESHOLD_WORDING}), so a governed large-UL/FM ecosystem evaluation is required. Gamewell-FCI and Simplex are candidates; this policy does not choose between them.`
          : "Exceptional system complexity is established, so the project cannot be defaulted to the small/medium ecosystem despite its point count. A governed large-UL/FM ecosystem evaluation is required; Gamewell-FCI and Simplex are candidates and are not auto-chosen.",
      };
    }
    if (!LARGE_ULFM_CANDIDATES.includes(String(approvedLargeSystemEcosystem).trim())) {
      return {
        ...base,
        decisionState: "LARGE_ULFM_ECOSYSTEM_EVALUATION_REQUIRED",
        ruleId: POLICY_RULES.APPROVED_LARGE_SYSTEM_SELECTION,
        candidates: [...LARGE_ULFM_CANDIDATES],
        needsReview: true,
        protocolReferencesIgnored: protocolContextProvided,
        reason: `The approved large-system selection (${approvedLargeSystemEcosystem}) is not one of the governed candidates (${LARGE_ULFM_CANDIDATES.join(", ")}); no ecosystem is resolved.`,
      };
    }
    // An approved selection of exactly one candidate resolves the ecosystem.
    return {
      ...base,
      decisionState: "EXPLICIT_PROJECT_ECOSYSTEM",
      resolvedEcosystem: String(approvedLargeSystemEcosystem).trim(),
      compatibilityTarget: String(approvedLargeSystemEcosystem).trim(),
      basis: "HUMAN_ENGINEERING_DECISION",
      ruleId: POLICY_RULES.APPROVED_LARGE_SYSTEM_SELECTION,
      protocolReferencesIgnored: protocolContextProvided,
      reason: `A governed human engineering decision selected ${approvedLargeSystemEcosystem} from the evaluated large-UL/FM candidates after the large-system evaluation.`,
    };
  }

  if (inputsUsed.complexity === null) {
    return {
      ...base,
      decisionState: "COMPLEXITY_REVIEW_REQUIRED",
      ruleId: POLICY_RULES.COMPLEXITY_REVIEW,
      needsReview: true,
      protocolReferencesIgnored: protocolContextProvided,
      reason: `The point count (${inputsUsed.preliminaryTotalPoints}) is within the ${FARENHYT_PRELIMINARY_POINT_THRESHOLD}-point internal threshold (${FARENHYT_THRESHOLD_WORDING}) and the compliance regime is UL/FM, but no governed complexity evidence establishes whether exceptional system complexity exists. The policy never assumes 'not exceptional'; a complexity review is required before an ecosystem is resolved.`,
    };
  }

  // UL/FM, points <= 2,000, and established not-exceptional complexity ->
  // Honeywell Farenhyt (Rule C-1).
  return {
    ...base,
    decisionState: "RESOLVED_FARENHYT",
    resolvedEcosystem: RESOLVED_ECOSYSTEM_TARGETS.FARENHYT,
    compatibilityTarget: RESOLVED_ECOSYSTEM_TARGETS.FARENHYT,
    basis: "ENGINEERING_POLICY_RESOLUTION",
    ruleId: POLICY_RULES.FARENHYT,
    protocolReferencesIgnored: protocolContextProvided,
    reason: `The UL/FM regime, preliminary point count ${inputsUsed.preliminaryTotalPoints} (within the internal ${FARENHYT_PRELIMINARY_POINT_THRESHOLD}-point selection threshold -- ${FARENHYT_THRESHOLD_WORDING}), and established not-exceptional complexity resolve the compatibility family to Honeywell Farenhyt per Rule C. No exact panel model, loop capacity, topology or expansion module is selected by this resolution.`,
  };
}

// Convenience predicate for persistence callers: may a requirement_compatibility
// row be written with the resulting target?
export function ecosystemIsResolved(decision) {
  return RESOLVED_STATES.has(decision?.decisionState) && Boolean(decision?.compatibilityTarget);
}

export function ecosystemTargetForState(state) {
  if (state === "RESOLVED_FARENHYT") return RESOLVED_ECOSYSTEM_TARGETS.FARENHYT;
  if (state === "RESOLVED_GENT") return RESOLVED_ECOSYSTEM_TARGETS.GENT;
  return null;
}