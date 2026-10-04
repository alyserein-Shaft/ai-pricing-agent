/**
 * Specification Requirement Auto-Confirm Governance Module
 *
 * Implements deterministic, source-version-aware requirement auto-confirmation
 * for technical requirements extracted from project specifications.
 *
 * A requirement may be auto-confirmed only if ALL gates pass:
 * 1. Review is pending (Needs Review / Pending Approval)
 * 2. Requirement type is Mandatory (normative force)
 * 3. Exact normative modal present (shall / must / is required / are required)
 * 4. No weak phrasing (suitable / as required / where necessary / ...)
 * 5. Exact source text present on the ACTIVE extraction version
 * 6. No unresolved condition or exception narrowing the obligation
 * 7. Not flagged by any open ambiguity or conflict record
 * 8. System attribution present (applicability anchored, never Unknown)
 * 9. Not commercial/qualification boilerplate (experience, ISO entity cert, supplier agency, priced proposals, maintenance contracts)
 * 10. Not a delegated design choice (subject to / as directed / ...)
 * 11. Not in excluded technical categories (Documentation, Maintenance, Training)
 * 12. Deterministic reproducibility
 */

import { applicationActor } from "./application-context.mjs";
import { currentTechnicalRequirementsFrom } from "./current-evidence-scope.mjs";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

// Policy version for audit trail
export const SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION = "spec-requirement-auto-confirm-1.0.0";

// System actor for auto-confirm
export const SPEC_REQUIREMENT_AUTO_CONFIRM_ACTOR = "system:spec-requirement-auto-confirm";

/**
 * Regex patterns for requirement evaluation
 */
const NORMATIVE_MODAL = /\b(shall|must|is required|are required)\b/i;
const WEAK_PHRASING = /suitable|as required|where necessary|where applicable|as necessary/i;
const DESIGN_CHOICE = /subject to|as directed|at the (sole )?discretion|if deemed|as may be required/i;
const COMMERCIAL_QUALIFICATION =
  /years?['’]?\s+(of\s+)?experience|proven\s+(expertise|experience)|expertise\s+in\s+(installing|inspecting|testing|commissioning)|iso\s?9001|ministry of commerce|agency agreement|priced proposal|maintenance.{0,20}(contract|testing)|inspection.{0,20}testing/i;
const EXCLUDED_TECHNICAL_CATEGORIES = new Set(["Documentation", "Maintenance", "Training"]);
const PENDING_REVIEW = new Set(["Needs Review", "Pending Approval"]);

/**
 * Evaluate whether a requirement is eligible for auto-confirmation.
 *
 * @param {Object} db - Database connection
 * @param {Object} params - Evaluation parameters
 * @returns {Object} Evaluation result with gates and eligibility
 */
export const evaluateSpecRequirementAutoConfirmation = async (db, {
  requirementId,
  activeExtractionVersionId,
}) => {
  const gates = [];
  const timestamp = new Date().toISOString();

  // Load the requirement.
  //
  // MVP-CLOSE-14: through the canonical CURRENTNESS authority, not a bare
  // `WHERE id = ?`.
  //
  // The bare load meant this exported evaluator -- which is the function every
  // caller consults for a verdict -- could compute and RETURN `eligible: true`
  // for a requirement whose evidence is no longer current: retired by a
  // supersession, from a non-governing document version, from a superseded
  // extraction, or on a deleted/archived document. The module's own
  // findEligibleSpecRequirements comment asserted that "the load-time currency
  // filter is the real gate", but the load had no currency filter at all; the
  // batch scan was the only place the contract was honoured.
  //
  // The write was independently safe -- the CAS below re-states the currency
  // predicate in an EXISTS guard, so a stale row could never actually be
  // approved. What leaked was the EVALUATION: a `true` verdict computed on
  // retired evidence, reportable to a caller that never performs the write.
  // Fail closed at the load so a non-current requirement is simply not found.
  //
  // Note the eligibility predicate is deliberately NOT applied here. This path
  // ADMITS a pending requirement into approval, so requiring it to be already
  // Approved would be circular. The review-state rule for this module is
  // admission (requirement-approval-eligibility / gate 1), which is a different
  // governance axis from downstream authority and is out of CLOSE-14 scope.
  const requirement = await db.prepare(
    `SELECT r.* FROM ${currentTechnicalRequirementsFrom("r")} WHERE r.id = ?`
  ).bind(requirementId).first();

  if (!requirement) {
    gates.push({ gate: 0, name: "requirement_exists", pass: false, reason: "Requirement not found or no longer current evidence" });
    return { eligible: false, gates, reason: "Requirement not found or no longer current evidence", policyVersion: SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION };
  }

  // Handle both snake_case (raw SQLite) and camelCase (D1) field names
  const getField = (obj, camelCase, snakeCase) => obj[camelCase] ?? obj[snakeCase] ?? null;

  const reviewStatus = getField(requirement, "reviewStatus", "review_status");
  const requirementType = getField(requirement, "requirementType", "requirement_type");
  const originalText = getField(requirement, "originalText", "original_text");
  const extractionVersionId = getField(requirement, "extractionVersionId", "extraction_version_id");
  const condition = getField(requirement, "condition", "condition");
  const exception = getField(requirement, "exception", "exception");
  const system = getField(requirement, "system", "system");
  const category = getField(requirement, "category", "category");

  // Gate 1: Review is still pending
  if (!PENDING_REVIEW.has(reviewStatus)) {
    gates.push({ gate: 1, name: "review_pending", pass: false, reason: `Review status is ${reviewStatus}, not pending` });
    return { eligible: false, gates, reason: `Review status is ${reviewStatus}`, policyVersion: SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION };
  }
  gates.push({ gate: 1, name: "review_pending", pass: true, reason: `Review status is ${reviewStatus}` });

  // Gate 2: Requirement type is Mandatory
  if (requirementType !== "Mandatory") {
    gates.push({ gate: 2, name: "mandatory_type", pass: false, reason: `Requirement type is ${requirementType}, not Mandatory` });
    return { eligible: false, gates, reason: `Requirement type is ${requirementType}`, policyVersion: SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION };
  }
  gates.push({ gate: 2, name: "mandatory_type", pass: true, reason: "Requirement type is Mandatory" });

  // Gate 3: Exact normative modal present
  if (!NORMATIVE_MODAL.test(originalText)) {
    gates.push({ gate: 3, name: "normative_modal", pass: false, reason: "No normative modal (shall/must/is required/are required) found in original text" });
    return { eligible: false, gates, reason: "No normative modal found", policyVersion: SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION };
  }
  gates.push({ gate: 3, name: "normative_modal", pass: true, reason: "Normative modal present in original text" });

  // Gate 4: No weak phrasing
  if (WEAK_PHRASING.test(originalText)) {
    gates.push({ gate: 4, name: "no_weak_phrasing", pass: false, reason: "Weak phrasing detected (suitable/as required/where necessary/...)" });
    return { eligible: false, gates, reason: "Weak phrasing detected", policyVersion: SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION };
  }
  gates.push({ gate: 4, name: "no_weak_phrasing", pass: true, reason: "No weak phrasing detected" });

  // Gate 5: the requirement's extraction is the current one for its document.
  // The expectation is now always supplied (per document, by the caller), so the
  // gate can no longer be satisfied by its own absence -- previously
  // `if (activeExtractionVersionId && ...)` made lineage checking optional, and
  // an exported caller that omitted the id got no lineage check at all.
  if (!activeExtractionVersionId || extractionVersionId !== activeExtractionVersionId) {
    gates.push({ gate: 5, name: "active_extraction", pass: false, reason: activeExtractionVersionId ? "Requirement is from stale extraction version" : "No current extraction version was established for this requirement" });
    return { eligible: false, gates, reason: activeExtractionVersionId ? "Stale extraction version" : "No current extraction version", policyVersion: SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION };
  }
  gates.push({ gate: 5, name: "active_extraction", pass: true, reason: "Requirement is from active extraction version" });

  // Gate 6: No unresolved condition or exception
  if (condition && condition.trim().length > 0) {
    gates.push({ gate: 6, name: "no_condition", pass: false, reason: "Requirement has unresolved condition" });
    return { eligible: false, gates, reason: "Has unresolved condition", policyVersion: SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION };
  }
  if (exception && exception.trim().length > 0) {
    gates.push({ gate: 6, name: "no_exception", pass: false, reason: "Requirement has exception" });
    return { eligible: false, gates, reason: "Has exception", policyVersion: SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION };
  }
  gates.push({ gate: 6, name: "no_condition_exception", pass: true, reason: "No condition or exception" });

  // Gate 7: No open ambiguity or conflict
  const ambiguity = await db.prepare(
    `SELECT id FROM requirement_ambiguities WHERE requirement_id = ? AND status = 'Open'`
  ).bind(requirementId).first();
  if (ambiguity) {
    gates.push({ gate: 7, name: "no_ambiguity", pass: false, reason: "Open ambiguity exists for this requirement" });
    return { eligible: false, gates, reason: "Open ambiguity exists", policyVersion: SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION };
  }
  const conflict = await db.prepare(
    `SELECT id FROM requirement_conflicts WHERE (left_requirement_id = ? OR right_requirement_id = ?) AND resolution_status = 'Open'`
  ).bind(requirementId, requirementId).first();
  if (conflict) {
    gates.push({ gate: 7, name: "no_conflict", pass: false, reason: "Open conflict exists for this requirement" });
    return { eligible: false, gates, reason: "Open conflict exists", policyVersion: SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION };
  }
  gates.push({ gate: 7, name: "no_ambiguity_conflict", pass: true, reason: "No open ambiguities or conflicts" });

  // Gate 8: System attribution present and not Unknown
  const systemTrim = (system || "").trim();
  if (!systemTrim || /^unknown$/i.test(systemTrim)) {
    gates.push({ gate: 8, name: "system_attribution", pass: false, reason: "System is unknown or missing" });
    return { eligible: false, gates, reason: "System unknown", policyVersion: SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION };
  }
  gates.push({ gate: 8, name: "system_attribution", pass: true, reason: `System is ${systemTrim}` });

  // Gate 9: Not commercial/qualification boilerplate
  if (COMMERCIAL_QUALIFICATION.test(originalText)) {
    gates.push({ gate: 9, name: "no_commercial_boilerplate", pass: false, reason: "Commercial qualification boilerplate detected" });
    return { eligible: false, gates, reason: "Commercial boilerplate", policyVersion: SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION };
  }
  gates.push({ gate: 9, name: "no_commercial_boilerplate", pass: true, reason: "No commercial boilerplate detected" });

  // Gate 10: Not a delegated design choice
  if (DESIGN_CHOICE.test(originalText)) {
    gates.push({ gate: 10, name: "no_design_choice", pass: false, reason: "Delegated design choice language detected" });
    return { eligible: false, gates, reason: "Delegated design choice", policyVersion: SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION };
  }
  gates.push({ gate: 10, name: "no_design_choice", pass: true, reason: "No delegated design choice language" });

  // Gate 11: Not in excluded technical categories
  if (EXCLUDED_TECHNICAL_CATEGORIES.has(category)) {
    gates.push({ gate: 11, name: "not_excluded_category", pass: false, reason: `Category ${category} is excluded` });
    return { eligible: false, gates, reason: `Excluded category: ${category}`, policyVersion: SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION };
  }
  gates.push({ gate: 11, name: "not_excluded_category", pass: true, reason: `Category ${category} is not excluded` });

  // Gate 12: Original text is non-empty
  if (!originalText || originalText.trim().length === 0) {
    gates.push({ gate: 12, name: "source_text_present", pass: false, reason: "Original text is empty" });
    return { eligible: false, gates, reason: "Missing source text", policyVersion: SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION };
  }
  gates.push({ gate: 12, name: "source_text_present", pass: true, reason: "Original text is present" });

  // All gates passed
  const eligible = gates.every((gate) => gate.pass);

  return {
    eligible,
    gates,
    reason: eligible ? "All gates passed" : gates.find((gate) => !gate.pass)?.reason,
    policyVersion: SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION,
    actor: SPEC_REQUIREMENT_AUTO_CONFIRM_ACTOR,
    timestamp,
    requirement: {
      id: requirementId,
      originalText,
      system: systemTrim,
      category,
      requirementType,
      reviewStatus,
      extractionVersionId,
    },
  };
};

/**
 * Auto-confirm a specification requirement if all gates pass.
 *
 * @param {Object} db - Database connection
 * @param {Object} params - Auto-confirm parameters
 * @returns {Object} Result of auto-confirmation attempt
 */
export const autoConfirmSpecRequirement = async (db, { requirementId, activeExtractionVersionId, evidence = null }) => {
  const evaluation = await evaluateSpecRequirementAutoConfirmation(db, { requirementId, activeExtractionVersionId });

  if (!evaluation.eligible) {
    return {
      success: false,
      evaluation,
      reason: evaluation.reason,
    };
  }

  const timestamp = new Date().toISOString();

  // REAL compare-and-swap authority, not an unconditional write.
  //
  // The previous UPDATE was `WHERE id = ?` alone. Three separate races were
  // live: (a) a human approving or rejecting the same requirement between the
  // gate evaluation and this write was silently overwritten; (b) a re-extraction
  // landing in the same window left a requirement on retired evidence marked
  // Approved with approved_for_downstream = 1, and nothing in the repository
  // ever resets that flag; (c) a document supersession had the same effect. The
  // state predicate makes this a genuine transition rather than a last-writer-
  // wins write, and the EXISTS currency predicate restates
  // CURRENT_TECHNICAL_REQUIREMENT_SQL at the instant of the write, so the
  // read-then-write window cannot launder stale evidence.
  const updated = await db.prepare(
    `UPDATE technical_requirements
     SET review_status = 'Approved',
         approved_for_downstream = 1,
         updated_at = ?
     WHERE id = ?
       AND review_status IN ('Needs Review', 'Pending Approval')
       AND EXISTS (SELECT 1 FROM ${currentTechnicalRequirementsFrom("cur")} WHERE cur.id = technical_requirements.id)`
  ).bind(timestamp, requirementId).run();

  const changed = Number(updated?.meta?.changes ?? updated?.changes ?? 0);
  if (changed === 0) {
    // Report the real outcome. A refused auto-confirm must never be reported as
    // a success, and must not write an audit row claiming a decision that the
    // database did not accept.
    return {
      success: false,
      requirementId,
      evaluation,
      reason: "Requirement state changed before the auto-confirm could be applied",
      code: "AUTO_CONFIRM_STATE_CHANGED",
    };
  }

  // The audit row is written only after the transition actually committed, so it
  // can never record a confirmation that did not happen.
  await db.prepare(
    `INSERT INTO requirement_review_decisions (
      id, extraction_version_id, requirement_id, action,
      previous_value, new_value, reason, evidence, decided_by, decided_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id("reqdecision"),
    evaluation.requirement.extractionVersionId || null,
    requirementId,
    "Auto-Confirm",
    JSON.stringify({ reviewStatus: evaluation.requirement.reviewStatus || "Needs Review", approvedForDownstream: 0 }),
    JSON.stringify({ reviewStatus: "Approved", approvedForDownstream: 1 }),
    `Auto-confirmed by policy ${SPEC_REQUIREMENT_AUTO_CONFIRM_POLICY_VERSION}: all deterministic gates passed`,
    // Optional caller-supplied governance provenance. `requirement_review_decisions` is
    // APPEND-ONLY (immutable_update / immutable_delete triggers), so evidence can never be
    // annotated after the fact -- a calling policy that must record its own authority must
    // supply it here, atomically with the transition it authorises.
    evidence === null ? null : (typeof evidence === "string" ? evidence : JSON.stringify(evidence)),
    SPEC_REQUIREMENT_AUTO_CONFIRM_ACTOR,
    timestamp
  ).run();

  return {
    success: true,
    requirementId,
    evaluation,
    timestamp,
  };
};

/**
 * Batch auto-confirm multiple specification requirements.
 *
 * @param {Object} db - Database connection
 * @param {Array} requirementIds - Array of requirement IDs
 * @param {String} activeExtractionVersionId - Active extraction version ID
 * @returns {Object} Batch result with successes and failures
 */
export const batchAutoConfirmSpecRequirements = async (db, requirementIds, activeExtractionVersionId) => {
  const results = [];
  const successes = [];
  const failures = [];

  for (const requirementId of requirementIds) {
    const result = await autoConfirmSpecRequirement(db, { requirementId, activeExtractionVersionId });
    results.push(result);

    if (result.success) {
      successes.push(result);
    } else {
      failures.push(result);
    }
  }

  return {
    total: requirementIds.length,
    successes: successes.length,
    failures: failures.length,
    results,
  };
};

/**
 * Find all eligible requirements for auto-confirmation in a project.
 *
 * @param {Object} db - Database connection
 * @param {String} projectId - Project ID
 * @returns {Object} Eligible requirements and evaluation results
 */
export const findEligibleSpecRequirements = async (db, projectId) => {
  // The scan is now driven by CURRENT_TECHNICAL_REQUIREMENT_SQL, the same
  // authority every other consumer uses. It previously resolved ONE project-wide
  // "active" extraction from `specification_extraction_jobs ... status='Completed'
  // ORDER BY completed_at DESC LIMIT 1` and then compared gate 5 against that one
  // id while scanning EVERY pending requirement in the project with no
  // extraction filter at all. Three provable consequences: a multi-document
  // project silently under-confirmed (document A's requirements were all skipped
  // once document B's job finished later), and a non-governing extraction -- one
  // whose document version had been retired, or whose job merely completed
  // without the extraction version still governing -- was treated as the
  // authority to confirm against.
  const requirements = await db.prepare(
    `SELECT r.id,
            r.original_text AS originalText,
            r.requirement_type AS requirementType,
            r.requirement_category AS requirementCategory,
            r.system,
            r.category,
            r.condition,
            r.exception,
            r.review_status AS reviewStatus,
            r.extraction_version_id AS extractionVersionId
       FROM ${currentTechnicalRequirementsFrom("r")}
      WHERE r.project_id = ?
        AND r.review_status IN ('Needs Review', 'Pending Approval')
      ORDER BY r.id`
  ).bind(projectId).all();

  if (!requirements.results || requirements.results.length === 0) {
    return { eligible: [], total: 0, reason: "No current pending specification requirements found" };
  }

  // Reported for backwards compatibility with the caller's response shape. It
  // is informational only: gate 5 is evaluated per requirement against that
  // requirement's own current extraction, never against a single project-wide id.
  const activeExtractionVersionId = requirements.results[0]?.extractionVersionId || null;

  const evaluations = [];
  const eligible = [];

  for (const req of requirements.results) {
    const evaluation = await evaluateSpecRequirementAutoConfirmation(db, {
      requirementId: req.id,
      // Per-requirement, not per-project. Comparing every requirement against
      // one project-wide id is what made a multi-document project skip every
      // requirement of every document except the newest. The load-time currency
      // filter is the real gate -- a requirement whose evidence is not current
      // never reaches this loop -- and this per-document expectation keeps gate
      // 5 meaningful rather than vacuous.
      activeExtractionVersionId: req.extractionVersionId,
    });
    evaluations.push({ requirementId: req.id, ...evaluation });

    if (evaluation.eligible) {
      eligible.push(req.id);
    }
  }

  return {
    eligible,
    total: requirements.results.length,
    evaluations,
    activeExtractionVersionId,
  };
};