// GOVERNED EXPECTED DRAWING QUANTITY SCOPE AUTHORITY.
//
// Answers one question, and refuses to guess it:
//
//   For this project and this governed device class, which canonical locations
//   are expected to carry a governed quantity claim?
//
// This is the input the project-scoped completeness resolver needs in order to
// distinguish COMPLETE / INCOMPLETE / UNKNOWN_SCOPE. It exists as its own
// authority because expected scope CANNOT be inferred from quantity claims:
// inferring it from the observed claims makes a missing location invisible by
// construction, which is the exact defect the resolver was built to close.
//
// EXPECTED LOCATION != QUANTITY. Nothing in this module creates, implies or
// authorises a quantity, a recognition count, a total or a BOQ link. It stores
// obligations about locations. "WLC is expected to carry Fireman Telephone
// quantity" says nothing about how many exist there -- that is 0020's separate
// business, and the table has no quantity column to abuse.
//
// GOVERNANCE
// Append-only and one-new-version-per-decision, mirroring 0020 exactly. A
// `Needs Review` row is a PROPOSAL and confers nothing. Only a CURRENT
// `Approved` row is expected-scope authority; `Rejected` is a refusal and is
// excluded alongside it. The vocabulary is the existing project decision
// vocabulary, not a new parallel one.
//
// CANONICAL IDENTITY ONLY. Scope binds to the same (document, sheet,
// floor_or_area, device_class, device_variant) identity 0020 uses, so the
// registry is directly comparable with claims. `display_label` is a
// human-readable convenience and is never authority: aliases, AI-normalised
// location names and reviewer-typed free text cannot satisfy an expected
// location.

import { DRAWING_QUANTITY_AUTHORITY_VERSION, DEVICE_VARIANTS } from "./drawing-quantity-authority.mjs";
import { isSyntheticActorId } from "./human-authority.mjs";

export const EXPECTED_SCOPE_AUTHORITY_VERSION = `${DRAWING_QUANTITY_AUTHORITY_VERSION}+expected-scope-1.0.0`;

/** The existing project decision vocabulary. Not a new review language. */
export const SCOPE_REVIEW_STATUSES = Object.freeze(["Needs Review", "Approved", "Rejected"]);

/**
 * How completely the EXPECTED SCOPE DEFINITION itself has been decided.
 *
 * Kept SEPARATE from quantity coverage on purpose. "Every location we know
 * about has a quantity" and "we know every location that owes a quantity" are
 * different assertions, and reporting the first as if it were the second is how
 * a partial project silently looks finished. While proposals remain unresolved,
 * a COMPLETE quantity coverage state does not mean the project scope is settled.
 */
export const SCOPE_DEFINITION_STATES = Object.freeze({
  /** Approved scope exists and no proposals remain unresolved. */
  COMPLETE: "SCOPE_DEFINITION_COMPLETE",
  /** Approved scope exists, but proposals are still awaiting a decision. */
  PENDING: "SCOPE_DEFINITION_PENDING",
  /** No approved scope at all. Quantity completeness cannot be established. */
  UNKNOWN: "SCOPE_DEFINITION_UNKNOWN",
});

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

// ---- DECISION VALIDATION ----------------------------------------------------

/**
 * Validate one expected-scope row on its way into authority.
 *
 * @param input
 * @param input.reviewStatus 'Needs Review' | 'Approved' | 'Rejected'
 * @param input.actorId      the reviewer of record; synthetic ids are refused
 *                           ONLY for a decision, never for a proposal
 */
export function validateExpectedScopeDecision(input = {}) {
  if (!input || typeof input !== "object") {
    return { ok: false, code: "INVALID_INPUT", reason: "An expected-scope decision must be an object." };
  }
  // NOTE: `sheet` is deliberately NOT in this required list.
  //
  // The canonical location key is DERIVED by the writer from
  // `documents.logical_name` for the given documentId, so the caller never
  // supplies it and an alias cannot become identity. Requiring it here would
  // demand a value the writer immediately discards, and would invite exactly the
  // free-text identity §2 of the governing task forbids. The stored row is still
  // required to carry a non-blank sheet by the schema trigger
  // `drawing_quantity_expected_scope_no_quantity_guard`, so the guarantee holds
  // where it actually matters.
  for (const field of ["projectId", "documentId", "documentVersionId", "deviceClass", "proposedReason"]) {
    if (!isNonEmptyString(input[field])) {
      return { ok: false, code: "MISSING_SCOPE_FIELD", reason: `${field} is required; an expected location without a canonical identity is not scope authority.` };
    }
  }
  if (!SCOPE_REVIEW_STATUSES.includes(input.reviewStatus)) {
    return { ok: false, code: "SCOPE_REVIEW_STATUS_INVALID", reason: `reviewStatus must be one of ${SCOPE_REVIEW_STATUSES.join(", ")}.` };
  }
  // A NULL variant means "every variant of this class", so it is legitimate.
  // A PRESENT variant must be a real one.
  if (input.deviceVariant !== undefined && input.deviceVariant !== null && !DEVICE_VARIANTS.includes(input.deviceVariant)) {
    return { ok: false, code: "SCOPE_VARIANT_INVALID", reason: `deviceVariant must be one of ${DEVICE_VARIANTS.join(", ")}, or null to cover every variant of the class.` };
  }

  const reviewStatus = input.reviewStatus;

  // A decision REQUIRES a real human. A proposal does not, because a proposal
  // confers no authority and is exactly the kind of machine output the review
  // step exists to consider.
  if (reviewStatus !== "Needs Review") {
    if (!isNonEmptyString(input.actorId)) {
      return { ok: false, code: "SCOPE_REVIEWER_MISSING", reason: `A '${reviewStatus}' scope decision must record the reviewing actor.` };
    }
    if (isSyntheticActorId(input.actorId)) {
      return {
        ok: false,
        code: "SYNTHETIC_ACTOR_CANNOT_DECIDE_SCOPE",
        reason: `Reviewer "${input.actorId}" is a synthetic identity. `
          + "It may raise a proposal, but a development or system identity can never approve or reject expected quantity scope.",
      };
    }
    if (!isNonEmptyString(input.reviewReason)) {
      return { ok: false, code: "SCOPE_REVIEW_REASON_REQUIRED", reason: `A '${reviewStatus}' scope decision must carry a substantive reason.` };
    }
  }

  // decision_group is a MUTUAL-EXCLUSION KEY, not a location identity. It groups
  // competing candidate sheets for ONE location decision so at most one of them
  // can ever become current Approved authority. NULL means no exclusion declared.
  const decisionGroup = isNonEmptyString(input.decisionGroup) ? input.decisionGroup.trim() : null;
  if (decisionGroup !== null && decisionGroup.length > 120) {
    return { ok: false, code: "SCOPE_DECISION_GROUP_TOO_LONG", reason: "decisionGroup must be at most 120 characters." };
  }

  return {
    ok: true,
    decision: {
      decisionGroup,
      projectId: input.projectId.trim(),
      documentId: input.documentId.trim(),
      documentVersionId: input.documentVersionId.trim(),
      // Left null here on purpose: the writer derives the canonical sheet from the
      // governed document and overwrites this. A caller-supplied sheet is never
      // carried into authority.
      sheet: null,
      floorOrArea: isNonEmptyString(input.floorOrArea) ? input.floorOrArea.trim() : null,
      deviceClass: input.deviceClass.trim(),
      deviceVariant: input.deviceVariant ?? null,
      // Explicitly labelled as non-authority.
      displayLabel: isNonEmptyString(input.displayLabel) ? input.displayLabel.trim() : null,
      proposedReason: input.proposedReason.trim(),
      provenance: typeof input.provenance === "string" ? input.provenance : JSON.stringify(input.provenance ?? {}),
      authorityVersion: EXPECTED_SCOPE_AUTHORITY_VERSION,
      reviewStatus,
      reviewedBy: reviewStatus === "Needs Review" ? null : input.actorId.trim(),
      reviewedAt: reviewStatus === "Needs Review" ? null : (input.reviewedAt ?? new Date().toISOString()),
      reviewReason: reviewStatus === "Needs Review" ? null : input.reviewReason.trim(),
    },
  };
}

/** The row shape the loader consumes, normalised from a persisted row. */
const normaliseRow = (row) => ({
  id: row.id,
  project_id: row.project_id,
  document_id: row.document_id,
  document_version_id: row.document_version_id,
  sheet: row.sheet,
  floor_or_area: row.floor_or_area,
  device_class: row.device_class,
  device_variant: row.device_variant,
  display_label: row.display_label,
  review_status: row.review_status,
  proposed_reason: row.proposed_reason,
  provenance: row.provenance,
  reviewed_by: row.reviewed_by,
  reviewed_at: row.reviewed_at,
  review_reason: row.review_reason,
  version_number: row.version_number,
  superseded_at: row.superseded_at,
});

/**
 * Load the governed expected scope for one project and device class.
 *
 * Returns the APPROVED expected locations (the only authority), the unresolved
 * proposals, and an explicit scope-definition state. A pending proposal is
 * reported and excluded from authority; it is never quietly folded in.
 *
 * Document-version staleness: an expected-scope row states an OBLIGATION about a
 * location, which does not become false because a PDF was re-uploaded, so a row
 * bound to a superseded drawing revision still counts as scope. The count is
 * returned so an engineer can see which decisions predate the current revision
 * and may want to re-review. (This is deliberately NOT the same rule as 0020
 * claims, which are evidence about a specific revision and therefore go stale.)
 */
export async function loadProjectExpectedScopeAuthority(
  db,
  { projectId, deviceClass, deviceVariant = null, currentDocumentVersions = {} } = {},
) {
  if (!isNonEmptyString(projectId) || !isNonEmptyString(deviceClass)) {
    return {
      expectedScopeKnown: false,
      approvedExpectedLocations: [],
      pendingScopeDecisions: [],
      scopeDefinitionState: SCOPE_DEFINITION_STATES.UNKNOWN,
      reason: "A governed expected-scope query needs a project and a governed device class.",
    };
  }

  const variantClause = deviceVariant === null || deviceVariant === undefined ? "" : " AND device_variant=?";
  const binds = [projectId, deviceClass];
  if (variantClause) binds.push(deviceVariant);

  const rows = (await db.prepare(
    "SELECT * FROM drawing_quantity_expected_scope"
    + " WHERE project_id=? AND device_class=?"
    + variantClause
    + " AND superseded_at IS NULL",
  ).bind(...binds).all()).results ?? [];

  const scoped = rows.map(normaliseRow);
  const approved = scoped.filter((r) => r.review_status === "Approved");
  const pending = scoped.filter((r) => r.review_status === "Needs Review");
  const rejected = scoped.filter((r) => r.review_status === "Rejected");

  if (approved.length === 0) {
    return {
      expectedScopeKnown: false,
      approvedExpectedLocations: [],
      // Still reported: a reviewer needs to see WHY scope is unknown.
      pendingScopeDecisions: pending.map((r) => ({ id: r.id, sheet: r.sheet, documentId: r.document_id, deviceClass: r.device_class, proposedReason: r.proposed_reason })),
      rejectedScopeDecisions: rejected.map((r) => ({ id: r.id, sheet: r.sheet, documentId: r.document_id, deviceClass: r.device_class, reviewReason: r.review_reason })),
      scopeDefinitionState: SCOPE_DEFINITION_STATES.UNKNOWN,
      // No approved scope means no authority at all -- NOT an empty scope that
      // would vacuously report Complete.
      reason: approved.length === 0
        ? `No current Approved expected-quantity scope exists for class ${deviceClass}. `
          + `${pending.length} proposal(s) remain and confer no authority; a proposal is never scope authority.`
        : "",
    };
  }

  const onStaleRevision = approved.filter(
    (r) => currentDocumentVersions?.[r.document_id] !== undefined && currentDocumentVersions[r.document_id] !== r.document_version_id,
  );

  return {
    expectedScopeKnown: true,
    approvedExpectedLocations: approved.map((r) => r.sheet),
    approvedScopeRows: approved,
    pendingScopeDecisions: pending.map((r) => ({ id: r.id, sheet: r.sheet, documentId: r.document_id, deviceClass: r.device_class, proposedReason: r.proposed_reason })),
    rejectedScopeDecisions: rejected.map((r) => ({ id: r.id, sheet: r.sheet, documentId: r.document_id, deviceClass: r.device_class, reviewReason: r.review_reason })),
    scopeDefinitionState: pending.length === 0 ? SCOPE_DEFINITION_STATES.COMPLETE : SCOPE_DEFINITION_STATES.PENDING,
    approvedOnSupersededDocumentVersion: onStaleRevision.map((r) => r.sheet),
    reason: pending.length === 0
      ? "Every proposed expected location has been decided."
      : `${pending.length} expected-scope proposal(s) remain undecided, so the project's quantity scope is not yet settled even though the approved set has complete coverage.`,
  };
}