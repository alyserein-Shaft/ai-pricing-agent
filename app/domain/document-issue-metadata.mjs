// GOVERNED DOCUMENT ISSUE METADATA AUTHORITY
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// The document issue-control gate ("Confirm construction issue metadata")
// requires three fields to be non-blank before a document may change project
// scope:
//
//     revision / issue, document issue date, transmittal / source reference
//
// That is correct as a gate -- the user must explicitly confirm the issue state
// before any scope change. But it conflated two different things:
//
//   1. "the reviewer has not confirmed this field"   (NOT REVIEWED)
//   2. "the reviewer confirmed the source does not state it" (SOURCE ABSENCE)
//
// A source workbook that genuinely prints no revision, no issue date and no
// transmittal cannot clear the gate without the reviewer typing a fabricated
// string ("Rev 0", today's date, an invented reference). That converts missing
// evidence into invented evidence, which this repository forbids.
//
// WHAT THIS IS
//
// An explicit, auditable SOURCE-ABSENCE state, per field:
//
//     NOT_STATED_IN_SOURCE
//
// The gate is PRESERVED, not relaxed. Each required field must be resolved to
// exactly one of two human-confirmed states:
//
//   * an explicit source-backed value, OR
//   * NOT_STATED_IN_SOURCE
//
// A blank field with no absence confirmation is still BLOCKED. Blank alone is
// never a confirmation.
//
// NOT_APPLICABLE is deliberately NOT reused here. The repository's existing
// NOT_APPLICABLE convention (governed-classification-authority.mjs,
// drawing-quantity-boq-links.mjs) means "this question does not apply to this
// item". A missing revision is not inapplicable -- the source was asked and did
// not answer. Collapsing the two would lose that distinction.
//
// WHAT THIS IS NOT
//
//   * NOT a default value, placeholder, or fallback string
//   * NOT "optional" -- confirmation is still required for every field
//   * NOT an AI inference of a missing value
//   * NOT an approval of scope, compliance, product, or price
//
// Pure domain logic: no React, no DOM, no fetch, no DB. page.tsx consumes this
// as the single authority for the gate; it must not re-implement the rules.
export const DOCUMENT_ISSUE_METADATA_VERSION = "document-issue-metadata-1.1.0";

// The canonical human-identity policy. Imported, never redefined: the synthetic
// fallback list must have exactly one definition across the codebase.
import { isSyntheticActorId } from "./human-authority.mjs";

/** The one governed token for "the reviewer confirmed the source is silent". */
export const NOT_STATED_IN_SOURCE = "NOT_STATED_IN_SOURCE";

/** Human-readable label, used by the UI so absence never reads as a value. */
export const NOT_STATED_IN_SOURCE_LABEL = "Not stated in source";

/** Per-field review states. Deliberately distinct so the UI can tell them apart. */
export const DOCUMENT_ISSUE_FIELD_STATES = Object.freeze({
  /** Confirmed source-backed value present. */
  SOURCE_VALUE: "SOURCE_VALUE",
  /** Confirmed source absence. */
  NOT_STATED_IN_SOURCE,
  /** Blank and not confirmed absent -> blocked. */
  MISSING_REQUIRED_INPUT: "MISSING_REQUIRED_INPUT",
});

/**
 * Required metadata fields and the DocumentControl property that carries each.
 * `absentKey` is the boolean that records the reviewer's explicit absence
 * confirmation; `valueKey` is the source-backed value it must not coexist with.
 */
export const REQUIRED_DOCUMENT_ISSUE_FIELDS = Object.freeze([
  Object.freeze({ key: "revision", label: "Revision / issue", valueKey: "revision", absentKey: "revisionNotStated" }),
  Object.freeze({ key: "issueDate", label: "Document issue date", valueKey: "issueDate", absentKey: "issueDateNotStated" }),
  Object.freeze({ key: "transmittal", label: "Transmittal / source reference", valueKey: "transmittal", absentKey: "transmittalNotStated" }),
]);

/**
 * Issue purposes that may enter extraction / change the active baseline.
 * Reference-only purposes ("For Information", "Superseded") never may.
 *
 * "RFQ" is a real controlled value, added because a source document may
 * explicitly identify itself as a Request for Quotation. It is an ACTIVE
 * commercial inquiry purpose and is therefore scope-eligible alongside Tender
 * and Addendum. It is NEVER silently mapped to Tender: an RFQ stays an RFQ in
 * the record and in the audit trail.
 */
export const DOCUMENT_ISSUE_PURPOSES = Object.freeze([
  "Tender",
  "Addendum",
  "RFQ",
  "For Information",
  "Superseded",
]);

/** Display label for each controlled purpose. Presentation only; never the stored value. */
export const DOCUMENT_ISSUE_PURPOSE_LABELS = Object.freeze(
  /** @type {Readonly<Record<string, string>>} */ ({
    Tender: "Tender",
    Addendum: "Addendum",
    RFQ: "Request for Quotation (RFQ)",
    "For Information": "For Information",
    Superseded: "Superseded",
  }),
);

export const ACTIVE_DOCUMENT_ISSUE_PURPOSES = Object.freeze(["Tender", "Addendum", "RFQ"]);

/**
 * Roles are NOT human identities. A governed confirmation must carry a named
 * actor; these values are refused when supplied as the actor identity.
 *
 * The synthetic-identity rule is NOT redefined here. It is imported from the one
 * canonical policy module so this path cannot drift from `worker/human-actor.mjs`
 * and `knowledge-source-authority-review.mjs`: if a deployment falls back to
 * `local-development-user`, that is configuration, not a human, and this
 * confirmation must fail closed exactly as every other governed write does.
 */
export const NON_ACTOR_ROLE_VALUES = Object.freeze([
  "Estimator",
  "Engineering Reviewer",
  "Procurement Reviewer",
  "Commercial Approver",
  "Project Manager",
  "Commercial Manager",
  "Commercial Reviewer",
  "Administrator",
  "No Project Permission",
]);

/** Refuse a role, or a synthetic development placeholder, as a human actor. */
export function isGovernedConfirmationActor(actorUserId) {
  const id = String(actorUserId ?? "").trim();
  if (!id) return { ok: false, code: "HUMAN_ACTOR_REQUIRED", reason: "A governed issue-metadata confirmation requires a named authenticated actor. A role alone is not human attribution." };
  if (NON_ACTOR_ROLE_VALUES.includes(id)) {
    return { ok: false, code: "ROLE_IS_NOT_A_HUMAN_ACTOR", reason: `"${id}" is a role, not a named person. Record the authenticated user id instead.` };
  }
  if (isSyntheticActorId(id)) {
    return {
      ok: false,
      code: "SYNTHETIC_ACTOR_NOT_A_HUMAN",
      reason: `"${id}" is a synthetic development placeholder, not a human being. `
        + "Configure the operator's human identity on the server before recording a governed confirmation.",
    };
  }
  return { ok: true, code: "HUMAN_ACTOR_ACCEPTED", reason: "Named human actor." };
}

const isBlank = (value) => typeof value !== "string" || value.trim() === "";

// ---------------------------------------------------------------------------
// EXACT DOCUMENT AUTHORITY BINDING
// ---------------------------------------------------------------------------
// A confirmation is bound to the exact source identity, never to a filename.
//
// Authority is resolved from CANONICAL EXTRACTION PROVENANCE: the
// `boq_extraction_versions` row(s) that actually produced the governed BOQ
// extraction, joined to the document it ran against. That provenance is the only
// admissible selector.
//
// DELIBERATELY NOT USED as authority:
//   * filename / logical_name  -- two documents may share one
//   * content sha256           -- identical content must not imply one identity
//   * upload order / timestamps -- recency is not governed currentness
//   * which document happens to look "first" in a list
//
// If extraction provenance does not resolve to EXACTLY ONE (documentId,
// documentVersionId), this fails closed. It never picks a winner, never binds
// two documents together, and never treats a tie as permission to proceed.
//
// `intakeVersionId` is deliberately absent: this layer is document issue
// control and has no drawing-intake concept. Inventing an identity that does
// not exist here would be worse than reporting the limitation.

/**
 * Build the deterministic authority key for one exact source identity.
 * Order-independent; safe to compare for equality.
 */
export function buildDocumentIssueAuthorityKey({ projectId, documentId, documentVersionId } = {}) {
  if (isBlank(projectId) || isBlank(documentId) || isBlank(documentVersionId)) return null;
  return `${projectId.trim()}|${documentId.trim()}|${documentVersionId.trim()}`;
}

/**
 * Resolve exact document authority from canonical extraction provenance.
 *
 * `extractions` entries need { extractionVersionId, documentId, documentVersionId }.
 *
 * Returns ok:true ONLY for exactly one distinct source identity. Two distinct
 * identities -- the real duplicate-upload case -- is a hard failure that names
 * both candidates so a human can retire one through the canonical path.
 */
export function resolveDocumentIssueAuthorityFromExtraction({ projectId, extractions } = {}) {
  if (isBlank(projectId)) {
    return { ok: false, code: "MISSING_PROJECT_ID", reason: "A document issue confirmation must be bound to a project." };
  }
  const seen = new Map();
  for (const row of Array.isArray(extractions) ? extractions : []) {
    if (!row || isBlank(row.documentId) || isBlank(row.documentVersionId)) continue;
    const pair = `${row.documentId}|${row.documentVersionId}`;
    if (!seen.has(pair)) {
      seen.set(pair, {
        documentId: row.documentId.trim(),
        documentVersionId: row.documentVersionId.trim(),
        extractionVersionIds: [],
      });
    }
    if (row.extractionVersionId && !seen.get(pair).extractionVersionIds.includes(row.extractionVersionId)) {
      seen.get(pair).extractionVersionIds.push(row.extractionVersionId);
    }
  }

  if (seen.size === 0) {
    return {
      ok: false,
      code: "NO_EXTRACTION_PROVENANCE",
      reason: "No governed BOQ extraction provenance identifies the source of this candidate set. "
        + "Issue metadata cannot be confirmed against an unidentified source.",
      candidates: [],
    };
  }

  const candidates = [...seen.values()].sort((a, b) =>
    `${a.documentId}|${a.documentVersionId}`.localeCompare(`${b.documentId}|${b.documentVersionId}`));

  if (candidates.length > 1) {
    // Fail closed and name both. Choosing by filename, hash, upload order or
    // recency is not authority, so none of those is consulted.
    return {
      ok: false,
      code: "AMBIGUOUS_EXTRACTION_PROVENANCE",
      reason: `The current BOQ extraction provenance resolves to ${candidates.length} distinct source documents, `
        + "so the exact source of the normalized candidate set is not uniquely governed. "
        + "Retire the unused duplicate document through the canonical path, then retry. "
        + "Filename, content hash and upload order are NOT used to break this tie.",
      candidates,
    };
  }

  const [only] = candidates;
  return {
    ok: true,
    code: "DOCUMENT_AUTHORITY_RESOLVED",
    reason: "Extraction provenance resolved to exactly one governed source document.",
    candidates,
    documentId: only.documentId,
    documentVersionId: only.documentVersionId,
    extractionVersionIds: only.extractionVersionIds,
    authorityKey: buildDocumentIssueAuthorityKey({
      projectId,
      documentId: only.documentId,
      documentVersionId: only.documentVersionId,
    }),
  };
}


/**
 * Resolve one required field to exactly one review state.
 * Absence and a value are mutually exclusive by construction.
 */
export function documentIssueFieldState(control, field) {
  const absent = control?.[field.absentKey] === true;
  const value = control?.[field.valueKey];
  if (absent && !isBlank(value)) {
    // Never silently keep both. The caller must clear one.
    return { key: field.key, label: field.label, state: "SOURCE_ABSENCE_CONFLICTS_WITH_VALUE", value: value.trim() };
  }
  if (absent) {
    return { key: field.key, label: field.label, state: NOT_STATED_IN_SOURCE, value: null };
  }
  if (!isBlank(value)) {
    return { key: field.key, label: field.label, state: DOCUMENT_ISSUE_FIELD_STATES.SOURCE_VALUE, value: value.trim() };
  }
  return { key: field.key, label: field.label, state: DOCUMENT_ISSUE_FIELD_STATES.MISSING_REQUIRED_INPUT, value: null };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a document issue control for confirmation.
 *
 * Blocking rules (all fail closed):
 *   - any required field blank AND not confirmed absent -> MISSING_REQUIRED_INPUT
 *   - a field both confirmed absent and carrying a value -> conflict, refused
 *   - a present issue date in the future -> ISSUE_DATE_IN_FUTURE
 *   - a present issue date not ISO yyyy-mm-dd -> ISSUE_DATE_INVALID
 *   - a missing/blank issue purpose -> MISSING_ISSUE_PURPOSE
 *
 * A valid result resolves EVERY required field to SOURCE_VALUE or
 * NOT_STATED_IN_SOURCE. It never resolves to MISSING_REQUIRED_INPUT.
 */
/**
 * @param {Record<string, any>} control
 * @param {{ today?: string, requireAttribution?: boolean }} [options]
 */
export function validateDocumentIssueConfirmation(control, { today, requireAttribution = true } = {}) {
  const fieldStates = REQUIRED_DOCUMENT_ISSUE_FIELDS.map((field) => documentIssueFieldState(control, field));

  // --- named human actor --------------------------------------------------
  // A governed confirmation must be attributable to a NAMED human. A role is
  // not an identity.
  //
  // `requireAttribution: false` is for the pre-confirm UI enablement check
  // only: the named actor and the document authority binding are supplied by
  // the confirm handler from the live session and the resolved provenance, so
  // they cannot exist on the in-progress control yet. The recorded decision
  // itself is ALWAYS validated with attribution required -- there is no path
  // that writes a role-only or unbound confirmation.
  if (requireAttribution) {
    const actorVerdict = isGovernedConfirmationActor(control?.confirmedByUserId);
    if (!actorVerdict.ok) {
      return { ok: false, code: actorVerdict.code, reason: actorVerdict.reason, fieldStates };
    }
    if (isBlank(control?.confirmedByDisplayName)) {
      return {
        ok: false,
        code: "HUMAN_ACTOR_REQUIRED",
        reason: "A governed issue-metadata confirmation requires the actor's display name as well as their user id.",
        fieldStates,
      };
    }

    if (isBlank(control?.authorityKey)) {
      return {
        ok: false,
        code: "DOCUMENT_AUTHORITY_REQUIRED",
        reason: "A governed issue-metadata confirmation must be bound to the exact document/version identity of the source.",
        fieldStates,
      };
    }
  }

  const conflict = fieldStates.find((f) => f.state === "SOURCE_ABSENCE_CONFLICTS_WITH_VALUE");
  if (conflict) {
    return {
      ok: false,
      code: "SOURCE_ABSENCE_CONFLICTS_WITH_VALUE",
      reason: `${conflict.label} is marked "${NOT_STATED_IN_SOURCE_LABEL}" but also carries a value ("${conflict.value}"). `
        + "A source absence cannot coexist with a value; clear one of them.",
      fieldStates,
    };
  }

  const missing = fieldStates.find((f) => f.state === DOCUMENT_ISSUE_FIELD_STATES.MISSING_REQUIRED_INPUT);
  if (missing) {
    return {
      ok: false,
      code: "MISSING_REQUIRED_INPUT",
      reason: `${missing.label} is required. Enter a source-backed value, or explicitly confirm "${NOT_STATED_IN_SOURCE_LABEL}". `
        + "A blank field is not a confirmation.",
      fieldStates,
    };
  }

  const purpose = control?.status;
  if (isBlank(purpose) || !DOCUMENT_ISSUE_PURPOSES.includes(purpose)) {
    return {
      ok: false,
      code: "MISSING_ISSUE_PURPOSE",
      reason: "Issue purpose is required.",
      fieldStates,
    };
  }

  // Only a REAL, present issue date is date-checked. NOT_STATED_IN_SOURCE needs
  // no date, and must never be defaulted to one.
  if (control.issueDateNotStated !== true) {
    const issueDate = String(control.issueDate).trim();
    if (!ISO_DATE.test(issueDate)) {
      return { ok: false, code: "ISSUE_DATE_INVALID", reason: "Document issue date must be a real calendar date (yyyy-mm-dd).", fieldStates };
    }
    const ceiling = typeof today === "string" && ISO_DATE.test(today) ? today : null;
    if (ceiling && issueDate > ceiling) {
      return { ok: false, code: "ISSUE_DATE_IN_FUTURE", reason: "Document issue date cannot be in the future.", fieldStates };
    }
  }

  return {
    ok: true,
    code: "READY_TO_CONFIRM",
    reason: "Every required issue field is resolved to a source value or explicit source absence.",
    fieldStates,
    notStatedFields: fieldStates.filter((f) => f.state === NOT_STATED_IN_SOURCE).map((f) => f.key),
    sourceValueFields: fieldStates.filter((f) => f.state === DOCUMENT_ISSUE_FIELD_STATES.SOURCE_VALUE).map((f) => f.key),
  };
}

/**
 * Whether a confirmed document issue may change project scope.
 *
 * Three independent conditions, all required:
 *   1. an explicit confirmation exists,
 *   2. the issue purpose is active,
 *   3. the confirmation is still bound to the CURRENT exact document authority.
 *
 * Condition 3 is what stops a confirmation transferring to another document,
 * another version, another intake set, or another project: if the current
 * authority key differs from the bound one, the confirmation does not apply and
 * the gate stays closed. It also means a role-only or unbound record can never
 * authorise scope, even if it somehow carries `confirmed: true`.
 */
export function documentIssueAllowsScope(control, { currentAuthorityKey } = {}) {
  if (!control?.confirmed) return false;
  if (!ACTIVE_DOCUMENT_ISSUE_PURPOSES.includes(control.status)) return false;
  if (isBlank(control.authorityKey)) return false;
  if (isBlank(currentAuthorityKey)) return false;
  if (isBlank(control.confirmedByUserId)) return false;
  if (!isGovernedConfirmationActor(control.confirmedByUserId).ok) return false;
  return control.authorityKey === currentAuthorityKey;
}

/**
 * Why a scope gate is closed, for an honest UI state. Never guesses.
 */
export function documentIssueScopeBlocker(control, { currentAuthorityKey } = {}) {
  if (!control?.confirmed) return "NOT_CONFIRMED";
  if (!ACTIVE_DOCUMENT_ISSUE_PURPOSES.includes(control.status)) return "ISSUE_PURPOSE_NOT_ACTIVE";
  if (isBlank(control.confirmedByUserId)) return "HUMAN_ACTOR_REQUIRED";
  if (!isGovernedConfirmationActor(control.confirmedByUserId).ok) return documentIssueScopeBlocker(control, { currentAuthorityKey });
  if (isBlank(control.authorityKey)) return "DOCUMENT_AUTHORITY_REQUIRED";
  if (isBlank(currentAuthorityKey)) return "DOCUMENT_AUTHORITY_UNRESOLVED";
  if (control.authorityKey !== currentAuthorityKey) return "DOCUMENT_AUTHORITY_CHANGED";
  return null;
}

/**
 * Render one field for the audit trail without ever printing an invented value.
 * A confirmed absence renders as the governed label, never as an empty string.
 */
export function describeDocumentIssueField(fieldState) {
  if (fieldState.state === NOT_STATED_IN_SOURCE) return NOT_STATED_IN_SOURCE_LABEL;
  if (fieldState.state === DOCUMENT_ISSUE_FIELD_STATES.SOURCE_VALUE) return fieldState.value;
  return "(not confirmed)";
}

/** Audit-safe, fully explicit description of a confirmation decision. */
export function describeDocumentIssueConfirmation(fieldStates, purpose, actor = {}) {
  const who = actor.userId
    ? `${actor.displayName || actor.userId}${actor.role ? ` (${actor.role})` : ""}`
    : "(no named actor)";
  return REQUIRED_DOCUMENT_ISSUE_FIELDS.map((field) => {
    const state = fieldStates.find((f) => f.key === field.key);
    return `${field.label}: ${describeDocumentIssueField(state)}`;
  }).concat([`Issue purpose: ${purpose}`, `Confirmed by: ${who}`]).join(" · ");
}
