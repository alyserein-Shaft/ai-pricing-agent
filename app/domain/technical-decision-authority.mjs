// STAGE 4D-3 -- PURE TECHNICAL DECISION STATE MACHINE.
//
// A single deterministic, fail-closed decision layer over the now-live
// engineering inputs. It CONSUMES the already-computed Stage 4A-4C outputs
// (candidate evidenceEnvelope, candidate engineeringCalculations, the run-level
// engineeringDossier / engineeringReadiness / projectEngineeringChecks and the
// 4D-2 dossierWiring staleness metadata) and answers one question:
//
//     "What is the current technical decision state for this candidate?"
//
// WITHOUT persisting or acting on it. This module computes only. It never
// approves, never rejects, never selects, never prices, never writes
// safety_approval_requests / product_match_reviews, and never touches
// candidate.approvalReady or candidate.reviewStatus. It is pure domain logic
// (no DB, no fetch, no worker imports, no side effects, no Math.random), so an
// identical input always produces a semantically identical decision object.
//
// EVALUATION PRECEDENCE (deterministic, fail closed):
//   A. STALENESS            -- live stale/fingerprint metadata only; no global
//                              invalidation wiring is implemented yet (the 4D-2
//                              contract records invalidationImplemented:false).
//   B. ENGINEERING CONFLICT / AMBIGUITY / MISSING AUTHORITY -- mandatory
//      envelope dimensions that are AMBIGUOUS / MISSING_EVIDENCE /
//      INSUFFICIENT_AUTHORITY / UNKNOWN / AI-inference-only /
//      commercial-only / cross-domain authority conflicts -> ENGINEER_EXCEPTION.
//   C. CALCULATION INPUT GAPS -- REQUIRED_BUT_INPUTS_MISSING /
//      CALCULATION_CONFLICT / ENGINEER_REVIEW_REQUIRED / REQUIRED-without-result
//      -> ENGINEER_EXCEPTION.
//   D. DOSSIER / SYSTEM EVIDENCE GAPS -- MISSING / PRESENT_UNVERIFIED /
//      CONFLICTING (and STALE, routed to STALE) critical dossier items ->
//      ENGINEER_EXCEPTION. Missing SYSTEM_ARCHITECTURE (no governed live
//      source exists) is an insufficient engineering basis, never a
//      TECHNICALLY_UNACCEPTABLE.
//   E. DETERMINISTIC MANDATORY FAILURE -- only after B-D are clean:
//      authoritative evidence proves a mandatory technical failure
//      (protocol mismatch, mandatory attribute mismatch, known incompatible
//      relation, prohibited manufacturer,
//      certification contradicted by authoritative evidence, CALCULATED_FAIL,
//      attributable candidate-specific blocking project/system violation) ->
//      TECHNICALLY_UNACCEPTABLE. Missing evidence is NEVER a deterministic
//      failure. Lifecycle/availability states are NEVER deterministic failures
//      either (project policy): they surface as acknowledgment warnings only.
//   F. WARNINGS              -- every mandatory gate closed but one or more
//                              non-blocking warnings exist ->
//                              TECHNICALLY_ACCEPTABLE_WITH_WARNING.
//   G. CLEAN SUCCESS         -- every required gate closed with authoritative
//                              current evidence -> TECHNICALLY_ACCEPTABLE.
//   else fail closed         -> ENGINEER_EXCEPTION (INSUFFICIENT_EVIDENCE).
//
// STALENESS CODES: the closed 4D-2 contract coalesces item- and governing-basis
// staleness under a single basis ("ITEM/GOVERNING-BASIS"), so every staleness
// detection is reported with the STALE_GOVERNING_BASIS exception reason code.
// Non-critical (lightly stale) dossier rows merely warn.
//
// AUTHORITY: STALE / TECHNICALLY_* states are reached deterministically
// (SYSTEM_DETERMINISTIC_EVALUATION); ENGINEER_EXCEPTION is the only state that
// routes to a human (ENGINEER_REQUIRED).
//
// The decision module never re-runs Stage 4A/4B/4C engines and never recomputes
// a calculation; it interprets their outputs only.
import { CROSS_DOMAIN_CONFLICT_STATES } from "./evidence-authority-policy.mjs";

export const TECHNICAL_DECISION_VERSION = "technical-decision-authority-4d-3.0.0";

export const TECHNICAL_DECISION_STATES = Object.freeze([
  "TECHNICALLY_ACCEPTABLE",
  "TECHNICALLY_ACCEPTABLE_WITH_WARNING",
  "TECHNICALLY_UNACCEPTABLE",
  "ENGINEER_EXCEPTION",
  "STALE",
]);

// Engineer-exception reason vocabulary (deterministic codes, deduplicated in
// the output). ENGINEER_EXCEPTION is workflow-facing; these codes preserve the
// fine-grained reason so a later stage can route the human decision.
export const EXCEPTION_REASON_CODES = Object.freeze([
  "INSUFFICIENT_EVIDENCE",
  "INSUFFICIENT_AUTHORITY",
  "AMBIGUOUS",
  "ENGINEERING_CONFLICT",
  "UNKNOWN_APPLICABILITY",
  "MISSING_ENGINEERING_INPUT",
  "MISSING_COMPATIBILITY_EVIDENCE",
  "MISSING_ARCHITECTURE_EVIDENCE",
  "REGULATORY_OR_AHJ_CLARIFICATION",
  "CONFLICTING_AUTHORITATIVE_EVIDENCE",
  "CERTIFICATION_SCOPE_AMBIGUITY",
  "MANUAL_CANDIDATE_REVIEW",
  "APPROVED_DEVIATION_REQUIRED",
  "TECHNICAL_SUBSTITUTION_REVIEW",
  "PROJECT_SPECIFIC_EXCEPTION",
  "UNRESOLVED_SYSTEM_CONSTRAINT",
  "STALE_GOVERNING_BASIS",
]);

const MANDATORY_PRIORITIES = new Set(["Critical Mandatory", "Mandatory", "Conditional Mandatory"]);
const crossDomainConflict = (state) => CROSS_DOMAIN_CONFLICT_STATES.includes(state);

// ---------------------------------------------------------------------------
// Small pure utilities.
// ---------------------------------------------------------------------------
const uniq = (values) => [...new Set(values.filter(Boolean))];
const code = (reason) => (EXCEPTION_REASON_CODES.includes(reason) ? reason : "INSUFFICIENT_EVIDENCE");
const isStaleEvidence = (entry) => entry?.stale === true || /stale/i.test(String(entry?.reviewStatus || ""));

// A mandatory envelope dimension resolution (fail closed unless the row closes
// with authoritative current evidence).
const resolutionOf = ({ envelope, comparison }) => {
  const dimension = envelope?.dimension || comparison?.dimension || "unknown";
  const result = envelope?.result ?? null;
  const productAuthority = envelope?.productAuthority || {};
  const requirementAuthority = envelope?.requirementAuthority || {};
  const authorityClass = productAuthority.authorityClass || null;
  const requirementClass = requirementAuthority.authorityClass || null;
  const evidenceKind = envelope?.productEvidenceKind || envelope?.evidenceKind || null;
  const conflicts = envelope?.conflicts || null;
  const isCompatibilityDimension = /compatibility|base_compatibility/i.test(dimension);
  const isArchitectureDimension = /system_architecture/i.test(dimension);

  const lackOfAuthority = (overrideReason = null, detail = null) => ({
    satisfied: false,
    unresolved: true,
    reason: overrideReason || "INSUFFICIENT_AUTHORITY",
    detail: detail || `Dimension ${dimension} carries no authoritative governed evidence; fail closed.`,
  });

  // NOT_APPLICABLE -- exclude from required satisfaction.
  if (result === "NOT_APPLICABLE") {
    return { satisfied: false, unresolved: false, failed: false, notApplicable: true, reason: null, detail: `Dimension ${dimension} is not applicable.` };
  }

  // AI inference and COMMERCIAL evidence can never close a technical dimension.
  if (authorityClass === "AI_INFERENCE" || evidenceKind === "INFERRED") {
    return lackOfAuthority("INSUFFICIENT_AUTHORITY", `Dimension ${dimension} is supported only by AI inference; inference never closes a mandatory technical dimension.`);
  }
  if (authorityClass === "COMMERCIAL" || requirementClass === "COMMERCIAL") {
    return lackOfAuthority("INSUFFICIENT_AUTHORITY", `Dimension ${dimension} is supported only by commercial evidence; commercial evidence never closes technical compliance.`);
  }
  if (requirementAuthority.status === "INSUFFICIENT_AUTHORITY") {
    return lackOfAuthority("INSUFFICIENT_AUTHORITY", `Dimension ${dimension} requirement side has insufficient authority.`);
  }

  const hasVerifiedProductEvidence = evidenceKind === "EXPLICIT" || evidenceKind === "DERIVED";

  switch (result) {
    case "AGREES":
      // AGREES only satisfies when backed by governed product evidence and an
      // authoritative requirement. A "Claimed Compliant" standards offer
      // (present claim, no evidence) is a certification scope ambiguity.
      if (!hasVerifiedProductEvidence) {
        const isStandardsClaim = dimension === "standards" || dimension === "certification_listing";
        return lackOfAuthority(isStandardsClaim ? "CERTIFICATION_SCOPE_AMBIGUITY" : "INSUFFICIENT_EVIDENCE", `Dimension ${dimension} agrees but carries no governed product evidence; the claim is unverified.`);
      }
      return { satisfied: true, unresolved: false, failed: false, notApplicable: false, reason: null, detail: `Dimension ${dimension} is satisfied with authoritative evidence (${evidenceKind}).` };

    case "MISSING_EVIDENCE":
      return {
        satisfied: false,
        unresolved: true,
        reason: isArchitectureDimension ? "MISSING_ARCHITECTURE_EVIDENCE" : isCompatibilityDimension ? "MISSING_COMPATIBILITY_EVIDENCE" : "INSUFFICIENT_EVIDENCE",
        detail: `Dimension ${dimension} is missing evidence.`,
      };

    case "INSUFFICIENT_AUTHORITY":
      return lackOfAuthority("INSUFFICIENT_AUTHORITY", `Dimension ${dimension} has insufficient source authority.`);

    case "AMBIGUOUS":
      return { satisfied: false, unresolved: true, reason: "AMBIGUOUS", detail: `Dimension ${dimension} is ambiguous.` };

    case "UNKNOWN":
      return { satisfied: false, unresolved: true, reason: "UNKNOWN_APPLICABILITY", detail: `Dimension ${dimension} applicability is unknown.` };

    case "SUPERSEDED":
      // A superseded source cannot support acceptance; it only resolves if a
      // same-dimension AGREES row (replacement evidence) exists. The caller
      // passes that in via `replacementExists` below.
      return { satisfied: false, unresolved: false, failed: false, notApplicable: false, superseded: true, reason: "REGULATORY_OR_AHJ_CLARIFICATION", detail: `Dimension ${dimension} is backed only by a superseded source.` };

    case "CONFLICTS":
      // Cross-domain authority/document conflict -> engineer judgment. A plain
      // value mismatch with authoritative evidence on both sides is a
      // deterministic candidate technical mismatch (records `failed`).
      if (conflicts?.state && crossDomainConflict(conflicts.state)) {
        const reason = conflicts.state === "TECHNICAL_CONFLICT" ? "ENGINEERING_CONFLICT" : conflicts.state === "BOTH_CONSTRAINTS_APPLY" ? "AMBIGUOUS" : "CONFLICTING_AUTHORITATIVE_EVIDENCE";
        return {
          satisfied: false,
          unresolved: true,
          reason,
          detail: `Dimension ${dimension} has conflicting authoritative evidence (${conflicts.state}).`,
        };
      }
      if (conflicts?.state === "CALCULATION_DEFINES_PRODUCT_VERIFIES" && conflicts.blocking === true) {
        // The governed calculation defines required capacity the product
        // evidence cannot satisfy -> deterministic calculated failure.
        return { satisfied: false, unresolved: false, failed: true, reason: null, detail: `Dimension ${dimension}: the governed calculation defines capacity the product cannot satisfy.` };
      }
      if (!hasVerifiedProductEvidence) {
        return lackOfAuthority("INSUFFICIENT_EVIDENCE", `Dimension ${dimension} conflicts without authoritative product evidence.`);
      }
      // Authoritative value mismatch (e.g. protocol mismatch, mandatory
      // attribute mismatch, incompatible relation).
      return { satisfied: false, unresolved: false, failed: true, reason: "DETERMINISTIC_MISMATCH", detail: `Dimension ${dimension} conflicts with authoritative evidence (${result}).` };

    default:
      return {
        satisfied: false,
        unresolved: true,
        reason: "INSUFFICIENT_EVIDENCE",
        detail: `Dimension ${dimension} has no resolvable envelope outcome (${result || "unknown"}).`,
      };
  }
};

// ---------------------------------------------------------------------------
// Per-source collection helpers.
// ---------------------------------------------------------------------------
// Envelope rows -> mandatory dimension resolutions + exception/deterministic
// failure/warning inputs. Every mandatory row is classified independently so a
// failing mandatory requirement always fails closed even when a sibling row on
// the same dimension passes.
const evaluateEnvelopeDimensions = ({ candidate, reasons, exceptionReasons, deterministicFailures }) => {
  const dimensions = [];
  for (const envelope of candidate?.evidenceEnvelope || []) {
    const comparison = candidate?.comparisons?.[envelope.comparisonIndex] ?? null;
    const requirementPriority = comparison?.requirement?.priority ?? null;
    const mandatory = envelope?.blocking === true || MANDATORY_PRIORITIES.has(String(requirementPriority ?? ""));
    if (!mandatory) continue;

    // Same-dimension AGREES rows act as replacement evidence for a SUPERSEDED row.
    const replacementExists = (candidate?.evidenceEnvelope || []).some(
      (other) => other.dimension === envelope.dimension && other.result === "AGREES" && (other.productEvidenceKind === "EXPLICIT" || other.productEvidenceKind === "DERIVED"),
    );

    const resolution = resolutionOf({ envelope, comparison });
    const existing = dimensions.find((entry) => entry.dimension === envelope.dimension);
    if (existing) {
      existing.satisfied = existing.satisfied || resolution.satisfied;
      existing.failed = existing.failed || resolution.failed;
      existing.unresolved = existing.unresolved || resolution.unresolved;
      existing.notApplicable = existing.notApplicable && Boolean(resolution.notApplicable);
    } else {
      dimensions.push({
        dimension: envelope.dimension,
        satisfied: Boolean(resolution.satisfied),
        failed: Boolean(resolution.failed),
        unresolved: Boolean(resolution.unresolved),
        notApplicable: Boolean(resolution.notApplicable),
      });
    }

    if (resolution.failed) {
      deterministicFailures.push({ type: "ENVELOPE_MANDATORY_MISMATCH", dimension: envelope.dimension, reason: resolution.detail || `Dimension ${envelope.dimension} conflicts with authoritative evidence.` });
    } else if (resolution.unresolved) {
      reasons.push(resolution.detail || `Dimension ${envelope.dimension} is unresolved.`);
      exceptionReasons.push(code(resolution.reason));
    } else if (resolution.superseded && !replacementExists) {
      reasons.push(resolution.detail || `Dimension ${envelope.dimension} is backed only by a superseded source.`);
      exceptionReasons.push("REGULATORY_OR_AHJ_CLARIFICATION");
    }
  }
  return dimensions;
};

// Calculation results -> gaps (exception) + deterministic failures + summary.
const evaluateCalculations = ({ candidate, reasons, exceptionReasons, deterministicFailures }) => {
  const summary = { required: 0, passed: 0, failed: 0, missing: 0, conflicted: 0, notRequired: 0 };
  const refs = [];
  for (const result of candidate?.engineeringCalculations?.results || []) {
    const state = result?.state ?? null;
    const label = `${result?.label || result?.calculationType || "calculation"} (${result?.calculationType || "unknown"})`;
    const ref = { calculationType: result?.calculationType ?? null, state, blocking: Boolean(result?.blocking), ruleId: result?.ruleId ?? null, ruleVersion: result?.ruleVersion ?? null };
    refs.push(ref);

    if (state === "NOT_REQUIRED") {
      summary.notRequired += 1;
      continue;
    }
    summary.required += 1;
    if (state === "CALCULATED_PASS") {
      if (result?.stale === true || isStaleEvidence(result)) {
        exceptionReasons.push("STALE_GOVERNING_BASIS");
        reasons.push(`Calculation ${label} passed but its governed inputs are stale.`);
        summary.passed += 1;
      } else {
        summary.passed += 1;
      }
      continue;
    }
    if (state === "CALCULATED_FAIL") {
      if (result?.blocking === true && (result?.evidenceKind === "DERIVED" || Boolean(result?.evidence))) {
        summary.failed += 1;
        deterministicFailures.push({ type: "CALCULATED_FAIL", calculationType: result?.calculationType, reason: `${label} calculated a mandatory FAIL.` });
      } else {
        summary.failed += 1;
        exceptionReasons.push("INSUFFICIENT_EVIDENCE");
        reasons.push(`Calculation ${label} FAIL is not backed by authoritative derived evidence.`);
      }
      continue;
    }
    if (state === "REQUIRED_BUT_INPUTS_MISSING" || state === "REQUIRED" || state === "READY_TO_CALCULATE") {
      summary.missing += 1;
      exceptionReasons.push("MISSING_ENGINEERING_INPUT");
      reasons.push(`Calculation ${label} is required but has no completed deterministic result (${state}).`);
      continue;
    }
    if (state === "CALCULATION_CONFLICT") {
      summary.conflicted += 1;
      exceptionReasons.push("ENGINEERING_CONFLICT");
      reasons.push(`Calculation ${label} conflicts; the capacity requirement evidence contradicts itself.`);
      continue;
    }
    if (state === "ENGINEER_REVIEW_REQUIRED") {
      summary.conflicted += 1;
      exceptionReasons.push("UNKNOWN_APPLICABILITY");
      reasons.push(`Calculation ${label} is not governed by any rule; engineer review required.`);
      continue;
    }
    if (result?.stale === true || isStaleEvidence(result)) {
      exceptionReasons.push("STALE_GOVERNING_BASIS");
      reasons.push(`Calculation ${label} carries stale evidence metadata.`);
      continue;
    }
    // Any other state (e.g. unknown) fails closed.
    summary.missing += 1;
    exceptionReasons.push("MISSING_ENGINEERING_INPUT");
    reasons.push(`Calculation ${label} has no deterministic state (${state || "unknown"}).`);
  }
  return { summary, refs };
};

// Dossier items -> closed/unresolved/stale deductions + warnings.
const evaluateDossier = ({ engineeringDossier, reasons, exceptionReasons, warnings, ack }) => {
  const summary = { total: 0, verified: 0, missing: 0, conflicting: 0, stale: 0, presentUnverified: 0, notRequired: 0, blocked: engineeringDossier?.status === "BLOCKED" };
  const stalenessDetected = [];
  if (!engineeringDossier?.items) return { summary, stalenessDetected };
  for (const item of engineeringDossier.items) {
    const status = item.status;
    if (!item.required) {
      // Non-required rows stay neutral on their own (e.g. an optional
      // warranty), except that present-but-unverified or stale non-required
      // evidence still warns.
      if (status === "PRESENT_UNVERIFIED") {
        const text = `Dossier item ${item.label} is present but unverified (corroboration only); it does not close any technical gate.`;
        warnings.push(text);
        ack(text, true);
      } else if (status === "STALE") {
        const text = `Dossier item ${item.label} is stale but non-required; it only warns.`;
        warnings.push(text);
        ack(text, false);
      }
      summary.notRequired += 1;
      continue;
    }
    summary.total += 1;
    if (status === "VERIFIED") {
      summary.verified += 1;
      continue;
    }
    if (status === "NOT_REQUIRED") {
      summary.notRequired += 1;
      continue;
    }
    if (status === "CONFLICTING") {
      summary.conflicting += 1;
      exceptionReasons.push(item.type === "ENGINEERING_CALCULATION" || item.type === "CAPACITY_CALCULATION" ? "ENGINEERING_CONFLICT" : "CONFLICTING_AUTHORITATIVE_EVIDENCE");
      reasons.push(`Dossier item ${item.label} has conflicting governing evidence.`);
      continue;
    }
    if (status === "STALE") {
      summary.stale += 1;
      if (item.critical) {
        stalenessDetected.push(item.label);
      } else {
        const reason = `Dossier item ${item.label} is stale but non-critical; it only warns.`;
        warnings.push(reason);
        ack(reason, false);
      }
      continue;
    }
    if (status === "PRESENT_UNVERIFIED") {
      summary.presentUnverified += 1;
      exceptionReasons.push("INSUFFICIENT_AUTHORITY");
      reasons.push(`Dossier item ${item.label} is present but unverified; deterministic verification is required before closure.`);
      continue;
    }
    if (status === "MISSING") {
      summary.missing += 1;
      const reason = item.type === "SYSTEM_ARCHITECTURE"
        ? "MISSING_ARCHITECTURE_EVIDENCE"
        : item.type === "CAPACITY_CALCULATION" || item.type === "ENGINEERING_CALCULATION"
          ? "MISSING_ENGINEERING_INPUT"
          : "INSUFFICIENT_EVIDENCE";
      exceptionReasons.push(reason);
      reasons.push(`Dossier item ${item.label} is MISSING. Missing critical engineering evidence is an insufficient engineering basis (never a deterministic rejection).`);
      continue;
    }
    // Unknown dossier state fails closed.
    summary.missing += 1;
    exceptionReasons.push("INSUFFICIENT_EVIDENCE");
    reasons.push(`Dossier item ${item.label} has an unrecognized status (${status || "unknown"}).`);
  }
  return { summary, stalenessDetected };
};

// projectEngineeringChecks -> context-incomplete classification, violations
// attribution, warnings.
const evaluateProjectChecks = ({ projectEngineeringChecks, profile, candidateItemId, reasons, exceptionReasons, warnings, ack, deterministicFailures }) => {
  const summary = {
    contextStatus: projectEngineeringChecks?.contextStatus ?? null,
    violations: projectEngineeringChecks?.violationCount ?? 0,
    blockingViolations: 0,
    warningViolations: 0,
    attributable: [],
  };
  if (!projectEngineeringChecks) return summary;

  // PROJECT_CONTEXT_INCOMPLETE is never a deterministic candidate rejection.
  // It raises UNRESOLVED_SYSTEM_CONSTRAINT only when the unavailable constraint
  // is actually mandated by the governing project inputs at this execution
  // scope; otherwise it is recorded as a missing-governing-context fact.
  if (projectEngineeringChecks.contextStatus === "PROJECT_CONTEXT_INCOMPLETE") {
    const unavailable = projectEngineeringChecks.constraintsUnavailable || [];
    const mandates = {
      singleManufacturer: profile?.singleManufacturer === true,
      commonProtocol: Boolean(profile?.commonProtocol),
      panelCapacityByPanel: Boolean(profile?.panelCapacityByPanel),
    };
    for (const constraint of unavailable) {
      if (constraint === "approvedManufacturers") continue; // available live via the approved list
      if (mandates[constraint]) {
        exceptionReasons.push("UNRESOLVED_SYSTEM_CONSTRAINT");
        reasons.push(`Project context is incomplete: ${constraint} is mandated but unavailable at this execution scope; it was NOT assumed.`);
      }
    }
  }

  for (const violation of projectEngineeringChecks.violations || []) {
    if (violation.severity === "WARNING") {
      summary.warningViolations += 1;
      const text = `Project-level: ${violation.reason}`;
      warnings.push(text);
      ack(text, true);
      continue;
    }
    summary.blockingViolations += 1;
    const attributable = (violation.itemsAffected || []).includes(candidateItemId);
    if (violation.type === "APPROVED_MANUFACTURER_VIOLATION" || violation.type === "MANUFACTURER_CONSISTENCY" || violation.type === "COMMON_PROTOCOL_VIOLATION" || violation.type === "TOTAL_PANEL_CAPACITY") {
      if (attributable) {
        summary.attributable.push({ type: violation.type, itemsAffected: violation.itemsAffected || [] });
        deterministicFailures.push({ type: "PROJECT_VIOLATION", violationType: violation.type, reason: `Candidate-attributable project violation: ${violation.reason}` });
      } else {
        exceptionReasons.push("PROJECT_SPECIFIC_EXCEPTION");
        reasons.push(`A blocking project violation exists but is not attributable to this candidate: ${violation.reason}`);
      }
      continue;
    }
    // Unrecognized blocking violation fails closed without rejecting the candidate.
    exceptionReasons.push("PROJECT_SPECIFIC_EXCEPTION");
    reasons.push(`Unrecognized blocking project violation: ${violation.reason}`);
  }
  return summary;
};

// engineeringReadiness -> blockers/warnings (workflow-facing, never sufficient
// on its own).
const evaluateReadiness = ({ engineeringReadiness, reasons, exceptionReasons, warnings, ack }) => {
  const summary = { status: engineeringReadiness?.status ?? null, blockers: 0, warnings: 0, deterministicVerification: Boolean(engineeringReadiness?.deterministicVerification) };
  if (!engineeringReadiness) return summary;
  for (const blocker of engineeringReadiness.blockers || []) {
    // Dossier/project blockers are already reported item-by-item above; an
    // item-readiness blocker is a project-context constraint.
    if (/Project-level:/.test(blocker)) continue;
    summary.blockers += 1;
    exceptionReasons.push("PROJECT_SPECIFIC_EXCEPTION");
    reasons.push(blocker);
  }
  for (const warning of engineeringReadiness.warnings || []) {
    if (/Project-level:/.test(warning)) continue; // already reported with the violation
    summary.warnings += 1;
    const text = warning;
    warnings.push(text);
    ack(text, /Project-level:/.test(warning));
  }
  return summary;
};

// ---------------------------------------------------------------------------
// PRIMARY FUNCTION.
// ---------------------------------------------------------------------------
export const evaluateTechnicalDecision = (input = {}) => {
  const {
    candidate = null,
    engineeringDossier = null,
    engineeringReadiness = null,
    projectEngineeringChecks = null,
    dossierWiring = null,
    profile = null,
    manualCandidate = null,
    approvedDeviationRequired = false,
    technicalSubstitutionReview = false,
  } = input;

  const reasons = [];
  const exceptionReasons = [];
  const deterministicFailures = [];
  const warnings = [];
  const acknowledgmentWarnings = [];
  const ack = (text, required) => { if (required) acknowledgmentWarnings.push(text); };

  const candidateItemId = profile?.boqItem?.id ?? null;

  // ---- A. STALENESS (top precedence; metadata-sourced only) ----------------
  const governingBasisStale = dossierWiring?.staleness?.stale === true;
  const dossierStale = [];
  const dossierEvaluation = evaluateDossier({ engineeringDossier, reasons, exceptionReasons, warnings, ack });
  dossierStale.push(...dossierEvaluation.stalenessDetected);
  const calculationEvaluation = evaluateCalculations({ candidate, reasons, exceptionReasons, deterministicFailures });
  const calculationStale = (candidate?.engineeringCalculations?.results || []).some((result) => result?.stale === true || isStaleEvidence(result));
  const staleDetected = governingBasisStale || dossierStale.length > 0 || calculationStale;
  if (governingBasisStale) reasons.push("The governing basis (ITEM/GOVERNING-BASIS) for this decision is stale.");
  if (dossierStale.length) reasons.push(`Critical dossier evidence is stale: ${dossierStale.join(", ")}.`);

  // ---- B..D. EXCEPTION CONDITIONS -----------------------------------------
  const dimensionEvaluation = evaluateEnvelopeDimensions({ candidate, reasons, exceptionReasons, deterministicFailures });
  const projectEvaluation = evaluateProjectChecks({ projectEngineeringChecks, profile, candidateItemId, reasons, exceptionReasons, warnings, ack, deterministicFailures });
  const readinessEvaluation = evaluateReadiness({ engineeringReadiness, reasons, exceptionReasons, warnings, ack });

  // Lifecycle warnings (existing safety/technical eligibility surface).
  if (candidate?.lifecycle?.warning === true) {
    const text = `Lifecycle state "${candidate?.lifecycle?.state || "unknown"}" carries a non-blocking warning that requires acknowledgment.`;
    warnings.push(text);
    ack(text, true);
  }

  // Deterministic mandatory failures carried directly by the candidate surface
  // (authoritative governed fields, not evidence prose): a prohibited
  // manufacturer or a "Not Approved" manufacturer against a required approved
  // list. Lifecycle/availability is advisory-only (warning path above) and
  // never a deterministic failure, even when the candidate surface carries a
  // legacy blocking flag.
  if (candidate?.manufacturer?.result === "Prohibited") {
    deterministicFailures.push({ type: "PROHIBITED_MANUFACTURER", reason: `Manufacturer ${candidate.manufacturer.offered || "?"} is prohibited by the project.` });
  } else if (candidate?.manufacturer?.result === "Not Approved" && (candidate?.manufacturer?.required || []).length > 0) {
    deterministicFailures.push({ type: "NOT_APPROVED_MANUFACTURER", reason: `Manufacturer ${candidate.manufacturer.offered || "?"} is not on the required approved list.` });
  }

  // ---- MANUAL / DEVIATION / SUBSTITUTION -----------------------------------
  if (approvedDeviationRequired) {
    exceptionReasons.push("APPROVED_DEVIATION_REQUIRED");
    reasons.push("This candidate requires an approved deviation; a system decision never creates one.");
  }
  if (technicalSubstitutionReview) {
    exceptionReasons.push("TECHNICAL_SUBSTITUTION_REVIEW");
    reasons.push("A technical substitution requiring judgment is not deterministically resolvable.");
  }
  if (manualCandidate?.decisionRequired === true && manualCandidate?.fullyReviewable !== true) {
    exceptionReasons.push("MANUAL_CANDIDATE_REVIEW");
    reasons.push("This candidate requires a manual decision; no governed policy proves it fully reviewable.");
  }

  // ---- Summary objects -----------------------------------------------------
  const mandatoryDimensions = {
    total: dimensionEvaluation.length,
    satisfied: dimensionEvaluation.filter((entry) => entry.satisfied).length,
    failed: dimensionEvaluation.filter((entry) => entry.failed && !entry.unresolved).length,
    unresolved: dimensionEvaluation.filter((entry) => entry.unresolved || entry.superseded).length,
    notApplicable: dimensionEvaluation.filter((entry) => entry.notApplicable).length,
  };

  const calculationSummary = calculationEvaluation.summary;
  const dossierSummary = dossierEvaluation.summary;
  const projectCheckSummary = projectEvaluation;

  const evidenceRefs = (candidate?.evidenceEnvelope || []).map((envelope, index) => ({
    comparisonIndex: envelope.comparisonIndex ?? index,
    dimension: envelope.dimension ?? null,
    result: envelope.result ?? null,
    authorityClass: envelope.productAuthority?.authorityClass ?? null,
    requirementAuthorityClass: envelope.requirementAuthority?.authorityClass ?? null,
    evidenceKind: envelope.productEvidenceKind ?? envelope.evidenceKind ?? null,
    pass: Boolean(envelope.pass),
    blocking: Boolean(envelope.blocking),
  }));
  const calculationRefs = calculationEvaluation.refs;

  const versionFingerprints = {
    decisionVersion: TECHNICAL_DECISION_VERSION,
    dossierEngineVersion: engineeringDossier?.engineVersion ?? null,
    wiringVersion: dossierWiring?.wiringVersion ?? null,
    stalenessBasis: dossierWiring?.staleness?.basis ?? null,
    invalidationImplemented: dossierWiring?.staleness?.invalidationImplemented ?? false,
    requirementProfileVersion: dossierWiring?.staleness?.requirementProfileVersion ?? candidate?.provenance?.requirementProfileVersion ?? null,
    itemId: dossierWiring?.staleness?.itemId ?? profile?.boqItem?.id ?? null,
    calculationRuleVersions: Object.fromEntries((candidate?.engineeringCalculations?.results || []).map((result) => [result?.calculationType, result?.ruleVersion])),
  };

  // ---- STATE RESOLUTION (deterministic, fail closed) -----------------------
  let state;
  if (staleDetected) {
    state = "STALE";
    exceptionReasons.push("STALE_GOVERNING_BASIS");
    if (!reasons.length) reasons.push("The governing engineering basis for this decision is stale.");
  } else if (exceptionReasons.length || deterministicFailures.length === 0 && mandatoryDimensions.total === 0) {
    // Missing evidence / no resolvable mandatory dimension -> ENGINEER_EXCEPTION
    // (never a fabricated TECHNICALLY_UNACCEPTABLE; a candidate identity alone,
    // or a technically-ready dossier alone, can never yield acceptance).
    if (!exceptionReasons.length) {
      exceptionReasons.push("INSUFFICIENT_EVIDENCE");
      reasons.push("No mandatory engineering dimension could be closed with authoritative evidence; there is no deterministic engineering basis either way.");
    }
    state = "ENGINEER_EXCEPTION";
  } else if (deterministicFailures.length) {
    state = "TECHNICALLY_UNACCEPTABLE";
  } else if (warnings.length) {
    state = "TECHNICALLY_ACCEPTABLE_WITH_WARNING";
  } else if (mandatoryDimensions.satisfied > 0 && mandatoryDimensions.unresolved === 0 && mandatoryDimensions.failed === 0 && dossierSummary.missing === 0 && dossierSummary.conflicting === 0 && dossierSummary.presentUnverified === 0 && calculationSummary.missing === 0 && calculationSummary.conflicted === 0 && calculationSummary.failed === 0) {
    state = "TECHNICALLY_ACCEPTABLE";
  } else {
    state = "ENGINEER_EXCEPTION";
    if (!exceptionReasons.length) exceptionReasons.push("INSUFFICIENT_EVIDENCE");
    if (!reasons.length) reasons.push("Every required engineering gate must be closed with authoritative current evidence before technical acceptance.");
  }
  // STALE supersedes ENGINEER_EXCEPTION (precedence A), and the harsh-fail path
  // never produces TECHNICALLY_UNACCEPTABLE.
  if (!staleDetected && state === "STALE") state = "ENGINEER_EXCEPTION";

  const authority = state === "ENGINEER_EXCEPTION" ? "ENGINEER_REQUIRED" : "SYSTEM_DETERMINISTIC_EVALUATION";
  const deterministic = state !== "ENGINEER_EXCEPTION";

  return {
    state,
    authority,
    deterministic,
    reasons: uniq(reasons),
    exceptionReasons: uniq(exceptionReasons),
    // Stage 4D-4 consumption surface: the deterministic failure trace already
    // proven by this module. Never contains missing-evidence / ambiguity /
    // authority-gap outcomes (those always route to ENGINEER_EXCEPTION); an
    // ENGINEER_EXCEPTION decision carries an empty trace by construction.
    technicalFailures: deterministicFailures.map((failure) => ({ ...failure })),
    mandatoryDimensions,
    calculationSummary,
    dossierSummary,
    projectCheckSummary,
    warnings: uniq(warnings),
    requiresAcknowledgment: acknowledgmentWarnings.length > 0,
    evidenceRefs,
    calculationRefs,
    versionFingerprints,
    solePurpose: "TECHNICAL_DECISION_EVALUATION_ONLY",
  };
};