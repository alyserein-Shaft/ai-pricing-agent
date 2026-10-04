/**
 * GOVERNED DRAWING QUANTITY -> BOQ LINK AUTHORITY.
 *
 * This module is the SINGLE owner of the correspondence that lets Address Demand
 * consume a physical quantity for a BOQ item. It owns the decision vocabulary, the
 * currentness predicate, the fingerprint and the canonical reader. Address Demand
 * calls `readCurrentDrawingQuantityBoqLink` and MUST NOT query the link table
 * itself: a second query would fork the currentness rules, and two routes could
 * then disagree about whether a quantity is current.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS AUTHORITY HAS TO EXIST
 * ---------------------------------------------------------------------------
 * A Drawing Quantity Claim is a statement about a DRAWING LOCATION:
 *
 *   project_id, document_version_id, sheet, floor_or_area, device_class, device_variant
 *
 * `drizzle-active/0020_drawing_quantity_claims.sql` deliberately carries NO
 * `boq_item_id` and no foreign key to `boq_items`. That is correct, not an
 * oversight. The proven Al Mousa cardinality is MIXED: one drawing class maps to
 * many BOQ rows across floors (Heat detector -> 4 rows: 9, 6, 8, 1) and per-row
 * quantities genuinely differ (Interface module control -> 16, 16, 16, 7).
 *
 * So a class-level count CANNOT be divided across BOQ rows without inventing a
 * split. What is missing is not a number -- it is a governed, auditable statement
 * that "this drawing location is this BOQ row". That statement is this authority.
 *
 * ---------------------------------------------------------------------------
 * NAME: WHY `drawing_quantity_boq_links`
 * ---------------------------------------------------------------------------
 * The name is derived from the project's own convention for a governed
 * correspondence between two entities, NOT from the fact that a previous route
 * already mentioned it. The convention donor is `boq_requirement_links`
 * (BOQ item <-> requirement), which is structurally the same authority: one side
 * is a BOQ item, the other is a governed domain fact, the pair is decided by
 * review, and the table versions itself. `drawing_legend_geometry_approved_links`
 * confirms that `_links` means "correspondence", not "row pointer".
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS AUTHORITY IS NOT
 * ---------------------------------------------------------------------------
 * It is NOT an allocation and does NOT split quantities. It answers applicability
 * only: may this claim's quantity be consumed for this BOQ row? If a claim cannot
 * be uniquely assigned the decision is AMBIGUOUS and Address Demand stays blocked
 * for that row. No arithmetic happens here.
 *
 * It is NOT description matching. There is deliberately no code path that compares
 * a BOQ description to a drawing label. Two BOQ rows can carry an identical
 * description and must stay independently linkable, so description is not even
 * evidence.
 *
 * It is NOT `profile_requirement_applicability.device_identity_ref`. That column
 * encodes `drawing-requirement:{recognitionVersionId}:{definitionId}:{boqItemId}`
 * -- a symbol DEFINITION identity, not a drawing LOCATION. It cannot distinguish
 * the four per-floor Heat detector claims, cannot cite a quantity claim, and has
 * no independent supersession. Forcing quantity applicability into it would
 * corrupt an existing, correct, differently-scoped governed meaning.
 */

import {
  computeQuantityAuthorityFingerprint,
  fingerprintHash,
} from "./drawing-quantity-authority.mjs";

// ---------------------------------------------------------------------------
// AUTHORITY VERSION
// ---------------------------------------------------------------------------

/**
 * The authority version governing the APPLICABILITY DECISION itself.
 *
 * Deliberately separate from `DRAWING_QUANTITY_AUTHORITY_VERSION` (how a quantity
 * is counted) and `RESOURCE_CLASSIFICATION_RULESET_VERSION` (how many addresses a
 * device consumes). Three policies, three versions, never conflated -- the same
 * ownership discipline that repaired the resource rule-version defect.
 *
 * It participates in the link fingerprint, so bumping it invalidates every existing
 * link's currency and forces re-decision. That is the intent.
 */
export const DRAWING_QUANTITY_BOQ_LINK_VERSION = "drawing-quantity-boq-link-1.0.0";

/** The canonical table name. Owned by Agent 1's migration handoff. */
export const DRAWING_QUANTITY_BOQ_LINK_TABLE = "drawing_quantity_boq_links";

// ---------------------------------------------------------------------------
// DECISION VOCABULARY
// ---------------------------------------------------------------------------

/**
 * The APPLICABILITY DECISION. This is NOT the review lifecycle.
 *
 * `review_status` already carries the project's established review vocabulary
 * ('Needs Review' | 'Approved' | 'Rejected' -- the same values 0020 defaults to)
 * and is reused verbatim. No new review vocabulary is invented here. What review
 * alone cannot express is WHAT was decided: a reviewer can legitimately APPROVE
 * the conclusion "these two do not correspond", which is a decision, not a
 * rejection. Hence two axes, following `profile_requirement_applicability` -- the
 * only structure in the codebase that carries both.
 */
export const LINK_DECISIONS = Object.freeze({
  /** A correspondence was proposed. Proposes; never asserts. Never consumable. */
  PROPOSED: "PROPOSED",
  /** Decided: this claim IS the quantity authority for this BOQ row. */
  APPLICABLE: "APPLICABLE",
  /** Decided: these do not correspond. Never consumable. */
  NOT_APPLICABLE: "NOT_APPLICABLE",
  /** Cannot be decided (several candidate rows, or one row claimed by several locations). */
  AMBIGUOUS: "AMBIGUOUS",
});

/**
 * Established project review vocabulary, reused verbatim. NOT extended.
 *
 * These are enforced by CHECK constraints in the handoff schema. That matters:
 * the audit found NO table in the entire project constrains `review_status`, so a
 * hand-written `'Appr0ved'` would otherwise be stored and only silently refused at
 * read time. A new authority should not inherit that gap.
 */
export const LINK_REVIEW_STATUSES = Object.freeze(["Needs Review", "Approved", "Rejected"]);

const CONSUMABLE_DECISION = LINK_DECISIONS.APPLICABLE;
const CONSUMABLE_REVIEW = "Approved";

/** Only an affirmatively decided, approved, current link consumes. */
const CONSUMABLE_STATES = new Set(["DRAWING_QUANTITY_BOQ_LINK_READY"]);

// ---------------------------------------------------------------------------
// READ STATES
// ---------------------------------------------------------------------------

/**
 * Explicit, discriminated outcomes. Each names a distinct fact with a distinct
 * remedy, so none is collapsed into another: a caller must never have to guess WHY
 * a quantity did not flow.
 */
export const DRAWING_QUANTITY_BOQ_LINK_STATES = Object.freeze({
  /** Current, approved, applicable link to a current approved PROVEN claim. */
  READY: "DRAWING_QUANTITY_BOQ_LINK_READY",
  /** No governed link authority exists, or no record binds this BOQ item. */
  MISSING: "MISSING_DRAWING_QUANTITY_BOQ_LINK",
  /** A proposal exists; nobody has decided it. Never consumable. */
  PROPOSED: "PROPOSED_DRAWING_QUANTITY_BOQ_LINK",
  /** Decided as NOT corresponding. */
  NOT_APPLICABLE: "NOT_APPLICABLE_DRAWING_QUANTITY_BOQ_LINK",
  /** Cannot be decided; a human must resolve it. */
  AMBIGUOUS: "AMBIGUOUS_DRAWING_QUANTITY_BOQ_LINK",
  /** Exists but is not approved (or was rejected). */
  UNREVIEWED: "UNREVIEWED_DRAWING_QUANTITY_BOQ_LINK",
  /** Exists and was approved, but a governing identity moved underneath it. */
  STALE: "STALE_DRAWING_QUANTITY_BOQ_LINK",
  /** The record belongs to a different project. Refused, never consumed. */
  CROSS_PROJECT: "CROSS_PROJECT_DRAWING_QUANTITY_BOQ_LINK",
  /** More than one current approved applicable record claims this BOQ row. */
  MULTIPLE: "MULTIPLE_DRAWING_QUANTITY_BOQ_LINKS",
  /** The linked claim does not exist, or is not in this project. */
  CLAIM_MISSING: "MISSING_LINKED_DRAWING_QUANTITY_CLAIM",
  /** The linked claim is superseded or bound to a superseded drawing revision. */
  CLAIM_STALE: "STALE_LINKED_DRAWING_QUANTITY_CLAIM",
  /** The linked claim has not been approved in review. */
  CLAIM_UNAPPROVED: "UNAPPROVED_LINKED_DRAWING_QUANTITY_CLAIM",
  /** The linked claim's own authority fingerprint disagrees with its content. */
  CLAIM_FINGERPRINT_DRIFT: "LINKED_DRAWING_QUANTITY_CLAIM_FINGERPRINT_DRIFT",
  /** The linked claim is not PROVEN (printed/component conflict, or unresolved class). */
  CLAIM_NOT_PROVEN: "UNPROVEN_LINKED_DRAWING_QUANTITY_CLAIM",
});

// ---------------------------------------------------------------------------
// LINK FINGERPRINT
// ---------------------------------------------------------------------------

/**
 * Inputs that GOVERN the link and therefore invalidate it when any of them moves.
 *
 * Deliberately EXCLUDED: `applicability_state`, `review_status`, `applicability_reason`
 * and the timestamps. Those are the DECISION, and a decision is expressed by
 * inserting a new version that supersedes the old one -- never by mutating a row in
 * place (the `boq_requirement_links` discipline, and 0020's
 * `drawing_quantity_claims_supersede_only_update` trigger enforces it for claims).
 * Folding the decision into its own fingerprint would make approving a link destroy
 * its own currency, which is incoherent.
 *
 * `claim_version_number`, `claim_evidence_fingerprint` and `claim_authority_version`
 * are what make a claim revision invalidate the link resting on it WITHOUT
 * duplicating any claim column into this table. The link stores a hash INPUT, so it
 * can never become a second source of truth that disagrees with the claim it cites.
 * `boq_extraction_version_id` is what makes a BOQ re-extraction invalidate the link.
 */
export const LINK_FINGERPRINT_KEYS = Object.freeze([
  "applicability_authority_version",
  "boq_extraction_version_id",
  "boq_item_id",
  "claim_authority_version",
  "claim_evidence_fingerprint",
  "claim_version_number",
  "drawing_quantity_claim_id",
  "project_id",
]);

/**
 * Deterministic authority fingerprint for one link.
 *
 * @returns hex digest, or null when the record cannot be governed at all (no
 *   project, no claim, no BOQ item) -- the same refusal `computeQuantityAuthorityFingerprint`
 *   makes for a claim that could never have been built.
 */
export function computeLinkFingerprint(inputs) {
  if (!inputs || typeof inputs !== "object") return null;
  if (!inputs.project_id || !inputs.drawing_quantity_claim_id || !inputs.boq_item_id) return null;
  const material = {};
  for (const key of LINK_FINGERPRINT_KEYS) {
    const value = key === "applicability_authority_version"
      ? inputs.applicability_authority_version ?? DRAWING_QUANTITY_BOQ_LINK_VERSION
      : inputs[key];
    material[key] = value === undefined ? null : value;
  }
  // Namespaced so a link fingerprint can never be mistaken for a claim fingerprint,
  // even though both use the SAME hash primitive (one definition, two namespaces).
  return `dqbl_${fingerprintHash(material)}`;
}

/** Is the stored link fingerprint still a true description of its own inputs? */
export function isLinkFingerprintCurrent(row) {
  if (!row) return false;
  const derived = computeLinkFingerprint(row);
  if (!derived) return false;
  if (!row.applicability_input_fingerprint) return true; // nothing stored to contradict
  return row.applicability_input_fingerprint === derived;
}

/**
 * Flatten a joined link row into the fingerprint input shape.
 *
 * The canonical reader produces rows already joined to their claim and to the BOQ
 * item's extraction version, so the fingerprint is recomputed LIVE from the joined
 * columns rather than trusting a stored duplicate of the claim's identity.
 */
export function linkFingerprintInputs(row) {
  return {
    applicability_authority_version: row.applicability_authority_version,
    boq_extraction_version_id: row.boq_extraction_version_id ?? null,
    boq_item_id: row.boq_item_id,
    claim_authority_version: row.claim_authority_version ?? null,
    claim_evidence_fingerprint: row.claim_evidence_fingerprint ?? null,
    claim_version_number: row.claim_version_number ?? null,
    drawing_quantity_claim_id: row.drawing_quantity_claim_id,
    project_id: row.project_id,
  };
}

// ---------------------------------------------------------------------------
// CURRENTNESS PREDICATE (pure)
// ---------------------------------------------------------------------------

/**
 * THE EXACT CURRENTNESS PREDICATE.
 *
 * A link supplies a physical quantity if and only if EVERY clause below holds.
 * They are evaluated in a fixed order so the reported state names the FIRST failing
 * clause -- deterministically, and never a clause that did not actually fail.
 *
 * Link clauses:
 *   L1 the record belongs to this project
 *   L2 it is not superseded and is the head version for its identity
 *   L3 the decision is APPLICABLE
 *   L4 review_status is 'Approved'
 *   L5 the link fingerprint still describes its own inputs
 *
 * Claim clauses (a link is only as current as what it rests on):
 *   C1 the claim exists and belongs to this project
 *   C2 the claim's own authority fingerprint still matches its content
 *   C3 the claim is approved
 *   C4 the claim's document still points at the claim's version (drawing not revised)
 *   C5 the claim is PROVEN (a conflicted or unresolved claim is not a count)
 *
 * @param row     joined link row (see readCurrentDrawingQuantityBoqLink)
 * @param context { projectId, requireApprovedClaim }
 * @returns { state, consumable, ready, quantity, reason, link, clause }
 */
export function evaluateLinkCurrency(row, { projectId, requireApprovedClaim = true } = {}) {
  const blocked = (state, reason, clause) => ({
    state,
    consumable: false,
    ready: false,
    quantity: null,
    reason,
    authorityVersion: DRAWING_QUANTITY_BOQ_LINK_VERSION,
    link: summariseLink(row),
    clause,
  });

  // L1 -- project. A cross-project link is refused outright, never consumed.
  if (!row || row.project_id !== projectId) {
    return blocked(
      DRAWING_QUANTITY_BOQ_LINK_STATES.CROSS_PROJECT,
      "The link record belongs to a different project; a cross-project correspondence is never consumed.",
      "L1",
    );
  }

  // L2 -- supersession. Selection of the head happens in SQL; this catches an
  // explicitly superseded row reaching the predicate by any other path.
  if (row.superseded_at) {
    return blocked(
      DRAWING_QUANTITY_BOQ_LINK_STATES.STALE,
      "The link has been superseded by a newer decision.",
      "L2",
    );
  }

  // L3 -- the decision, most specific first so the reported reason names the real
  // blocker rather than a generic "unreviewed".
  if (row.applicability_state === LINK_DECISIONS.AMBIGUOUS) {
    return blocked(
      DRAWING_QUANTITY_BOQ_LINK_STATES.AMBIGUOUS,
      "The correspondence is ambiguous: this claim cannot be uniquely assigned to this BOQ row. A human must resolve it; no quantity may be split or assumed.",
      "L3",
    );
  }
  if (row.applicability_state === LINK_DECISIONS.NOT_APPLICABLE) {
    return blocked(
      DRAWING_QUANTITY_BOQ_LINK_STATES.NOT_APPLICABLE,
      "The correspondence was decided as NOT applicable; this claim is not this BOQ row's quantity authority.",
      "L3",
    );
  }
  if (row.applicability_state === LINK_DECISIONS.PROPOSED) {
    return blocked(
      DRAWING_QUANTITY_BOQ_LINK_STATES.PROPOSED,
      "The correspondence is only a proposal. A proposal is never authority.",
      "L3",
    );
  }
  if (row.applicability_state !== CONSUMABLE_DECISION) {
    return blocked(
      DRAWING_QUANTITY_BOQ_LINK_STATES.UNREVIEWED,
      `The applicability decision '${row.applicability_state}' is not an affirmative, decided applicability.`,
      "L3",
    );
  }

  // L4 -- governed review, reusing the established vocabulary.
  if (row.review_status !== CONSUMABLE_REVIEW) {
    return blocked(
      DRAWING_QUANTITY_BOQ_LINK_STATES.UNREVIEWED,
      `The applicability decision is '${row.review_status}', not 'Approved'. An unapproved decision is never consumed.`,
      "L4",
    );
  }

  // L5 -- the link's own currency.
  if (!isLinkFingerprintCurrent(row)) {
    return blocked(
      DRAWING_QUANTITY_BOQ_LINK_STATES.STALE,
      "A governing identity changed under this link (claim revision, claim quantity policy, BOQ item re-extraction, or link policy), so the stored decision no longer describes its own inputs.",
      "L5",
    );
  }

  // C1 -- the claim must exist, in this project.
  if (!row.claim_id) {
    return blocked(
      DRAWING_QUANTITY_BOQ_LINK_STATES.CLAIM_MISSING,
      "The linked drawing quantity claim does not exist.",
      "C1",
    );
  }
  if (row.claim_project_id && row.claim_project_id !== projectId) {
    return blocked(
      DRAWING_QUANTITY_BOQ_LINK_STATES.CROSS_PROJECT,
      "The linked drawing quantity claim belongs to a different project.",
      "C1",
    );
  }
  if (row.claim_superseded_at) {
    return blocked(
      DRAWING_QUANTITY_BOQ_LINK_STATES.CLAIM_STALE,
      "The linked drawing quantity claim has been superseded.",
      "C1",
    );
  }

  // C2 -- the claim's own authority fingerprint, recomputed from the joined
  // columns by the canonical quantity authority (never a second definition).
  if (!isClaimFingerprintCurrent(row)) {
    return blocked(
      DRAWING_QUANTITY_BOQ_LINK_STATES.CLAIM_FINGERPRINT_DRIFT,
      "The linked claim's authority fingerprint disagrees with its own content, so it is not readable as authority.",
      "C2",
    );
  }

  // C3 -- the claim must be governed. A claim left at 'Needs Review' is not
  // authority and is never consumed.
  if (requireApprovedClaim && row.claim_review_status !== CONSUMABLE_REVIEW) {
    return blocked(
      DRAWING_QUANTITY_BOQ_LINK_STATES.CLAIM_UNAPPROVED,
      `The linked drawing quantity claim is '${row.claim_review_status ?? "unreviewed"}', not 'Approved'.`,
      "C3",
    );
  }

  // C4 -- document currency, proven PER CLAIM against its OWN document head. Not a
  // single project-wide guess: a project may hold several drawing documents, and a
  // revised drawing must invalidate its quantity evidence without anything having
  // to remember to clear the link.
  if (!row.claim_document_version_id || row.claim_current_document_version_id !== row.claim_document_version_id) {
    return blocked(
      DRAWING_QUANTITY_BOQ_LINK_STATES.CLAIM_STALE,
      "The linked claim is bound to a superseded drawing revision; the quantity evidence is no longer current.",
      "C4",
    );
  }

  // C5 -- only a PROVEN claim is a count.
  if (row.claim_state !== "PROVEN") {
    return blocked(
      DRAWING_QUANTITY_BOQ_LINK_STATES.CLAIM_NOT_PROVEN,
      `The linked claim is '${row.claim_state}', not 'PROVEN'. A conflicted or unresolved claim contributes no quantity.`,
      "C5",
    );
  }

  return {
    state: DRAWING_QUANTITY_BOQ_LINK_STATES.READY,
    consumable: CONSUMABLE_STATES.has(DRAWING_QUANTITY_BOQ_LINK_STATES.READY),
    ready: true,
    quantity: Number.isFinite(row.claim_quantity) ? row.claim_quantity : null,
    reason: null,
    authorityVersion: DRAWING_QUANTITY_BOQ_LINK_VERSION,
    link: summariseLink(row),
    clause: "READY",
  };
}

// ---------------------------------------------------------------------------
// CANONICAL READER
// ---------------------------------------------------------------------------

/**
 * THE canonical reader for current approved quantity->BOQ links.
 *
 * Fails closed in every direction:
 *   - no link store at all                      -> MISSING
 *   - no record for this BOQ item               -> MISSING
 *   - more than one current approved applicable -> MULTIPLE (defence in depth
 *     BEHIND the partial unique index, so a hand-edited or migrated store still
 *     cannot double-count)
 *   - anything else                             -> the specific blocked state
 *
 * @param db        D1 handle
 * @param projectId
 * @param boqItemId
 */
export async function readCurrentDrawingQuantityBoqLink(
  db,
  { projectId, boqItemId, requireApprovedClaim = true } = {},
) {
  const missing = (state, reason) => ({
    state,
    consumable: false,
    ready: false,
    quantity: null,
    reason,
    authorityVersion: DRAWING_QUANTITY_BOQ_LINK_VERSION,
    link: null,
  });

  if (!db || !projectId || !boqItemId) {
    return missing(
      DRAWING_QUANTITY_BOQ_LINK_STATES.MISSING,
      "No link scope was supplied.",
    );
  }

  // The store's absence is the honest answer, not a reason to look for a
  // substitute. There is deliberately no fallback path in this function.
  const store = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .bind(DRAWING_QUANTITY_BOQ_LINK_TABLE)
    .first();
  if (!store) {
    return missing(
      DRAWING_QUANTITY_BOQ_LINK_STATES.MISSING,
      "No governed drawing-quantity-to-BOQ link authority exists. Without it there is no lawful way to decide which drawing location is this BOQ row.",
    );
  }

  // Head selection: unrejected rows, highest version per link identity. Selecting
  // the head here rather than trusting a single stored pointer is what makes
  // supersession work without anything having to remember to clear a link.
  const rows = await db.prepare(LINK_CURRENT_SQL).bind(projectId, boqItemId).all();
  const candidates = (rows?.results ?? []).filter((r) => r && String(r.review_status || "") !== "Rejected");

  if (candidates.length === 0) {
    return missing(
      DRAWING_QUANTITY_BOQ_LINK_STATES.MISSING,
      "No governed link record binds a drawing quantity claim to this BOQ item.",
    );
  }

  // More than one current record is tolerable only when at most ONE is an
  // affirmative approved applicability. Two would mean two claims claiming this
  // row's quantity -- exactly the double-count this authority exists to prevent --
  // so it is reported as ambiguous, never summed.
  const affirmative = candidates.filter(
    (r) => r.applicability_state === CONSUMABLE_DECISION && r.review_status === CONSUMABLE_REVIEW,
  );
  if (affirmative.length > 1) {
    return missing(
      DRAWING_QUANTITY_BOQ_LINK_STATES.MULTIPLE,
      `${affirmative.length} current approved link records claim this BOQ row. The quantity is ambiguous and is never summed across claims.`,
    );
  }

  // The affirmative record wins when present (it is the only consumable one);
  // otherwise evaluate the single remaining candidate so the reported reason names
  // the real blocker (proposed / ambiguous / unreviewed / stale).
  const target = affirmative[0] ?? candidates[0];
  const evaluated = evaluateLinkCurrency(target, { projectId, requireApprovedClaim });
  return { ...evaluated, candidateCount: candidates.length };
}

// ---------------------------------------------------------------------------
// WRITER AUTHORITY
// ---------------------------------------------------------------------------

/**
 * The governed write path's refusal rules, as a PURE predicate so they can be
 * proven without a database.
 *
 * Returns EVERY refusal that applies, in a fixed order, so a caller that wants to
 * auto-propose sees the full picture and a caller that must refuse reports the
 * first. Every refusal here is a fact about governance, never a heuristic.
 *
 * There is deliberately NO auto-approval rule. Nothing in today's governed evidence
 * determines a drawing LOCATION -> BOQ ROW correspondence deterministically: the
 * only genuine predicate available (`resolveGovernedLink`,
 * `app/domain/drawing-quantity-evidence-engine.mjs`) matches an approved product
 * FAMILY, which is not location-scoped and cannot distinguish the four per-floor
 * Heat detector rows. A proposal may therefore be WRITTEN, but only as a PROPOSAL
 * (`applicability_state = 'PROPOSED'`, `review_status = 'Needs Review'`), which is
 * never consumable. Automating the normal is fine; automating the AUTHORITY is not.
 */
export function evaluateLinkWrite({
  claim = null,
  boqItem = null,
  projectId,
  currentDocumentVersionId = null,
  requireApprovedClaim = true,
} = {}) {
  const refusals = [];
  const refuse = (code, reason) => refusals.push({ code, reason });

  if (!projectId) refuse("MISSING_PROJECT", "No project scope was supplied.");

  // Normalised first, so a claim handed over as a `buildQuantityClaim` result is
  // judged by the same rules as a D1 row.
  const governed = normaliseClaim(claim);

  if (!governed) {
    refuse(
      "MISSING_CLAIM",
      "A real, current drawing_quantity_claim_id is required. A free-text reference is not a correspondence.",
    );
  } else {
    if (governed.project_id && governed.project_id !== projectId) {
      refuse("CROSS_PROJECT_CLAIM", "The drawing quantity claim belongs to a different project.");
    }
    if (governed.superseded_at) {
      refuse("SUPERSEDED_CLAIM", "The drawing quantity claim has been superseded.");
    }
    if (!isClaimFingerprintCurrent(governed)) {
      refuse("CLAIM_FINGERPRINT_DRIFT", "The claim's authority fingerprint disagrees with its own content.");
    }
    if (requireApprovedClaim && governed.review_status !== CONSUMABLE_REVIEW) {
      refuse("UNAPPROVED_CLAIM", `The drawing quantity claim is '${governed.review_status ?? "unreviewed"}', not 'Approved'.`);
    }
    if (currentDocumentVersionId && governed.document_version_id !== currentDocumentVersionId) {
      refuse("CLAIM_SUPERSEDED_DOCUMENT_VERSION", "The claim is bound to a superseded drawing revision.");
    }
    if (governed.state !== "PROVEN") {
      refuse("CLAIM_NOT_PROVEN", `The claim is '${governed.state}', not 'PROVEN'. A conflicted or unresolved claim cannot be linked as a quantity authority.`);
    }
    // The 0020 identity must be complete. A link that cannot name the full drawing
    // location is not a location correspondence.
    for (const key of ["document_version_id", "device_class", "device_variant"]) {
      if (!governed[key]) {
        refuse("INCOMPLETE_CLAIM_IDENTITY", `The claim carries no '${key}', so it cannot identify a drawing location.`);
      }
    }
  }

  if (!boqItem) {
    refuse("MISSING_BOQ_ITEM", "A real, known boq_item_id is required.");
  } else if (boqItem.project_id && boqItem.project_id !== projectId) {
    refuse("CROSS_PROJECT_BOQ_ITEM", "The BOQ item belongs to a different project.");
  }

  return {
    allowed: refusals.length === 0,
    refusals,
    /** Always a PROPOSAL. Nothing today may write an auto-approved applicability. */
    proposalState: LINK_DECISIONS.PROPOSED,
    proposalReviewStatus: "Needs Review",
  };
}

// ---------------------------------------------------------------------------
// INTERNALS
// ---------------------------------------------------------------------------

/**
 * Current-head selection joined to the claim, to the claim's OWN document head and
 * to the BOQ item's extraction version.
 *
 * The `documents` join is what lets clause C4 be proven per claim rather than
 * guessed project-wide: `documents.current_version_id` is the canonical head
 * pointer (`documentVersionGoverningPredicate` in `worker/current-evidence-scope.mjs`
 * expresses the same rule in SQL).
 */
const LINK_CURRENT_SQL = `
  SELECT
    a.id,
    a.project_id,
    a.drawing_quantity_claim_id,
    a.boq_item_id,
    a.applicability_state,
    a.applicability_reason,
    a.applicability_authority_version,
    a.applicability_input_fingerprint,
    a.review_status,
    a.reviewed_by,
    a.reviewed_at,
    a.review_reason,
    a.version_number,
    a.previous_version_id,
    a.superseded_at,
    a.created_by,
    a.created_at,
    b.extraction_version_id AS boq_extraction_version_id,
    c.id                   AS claim_id,
    c.project_id           AS claim_project_id,
    c.document_id          AS claim_document_id,
    c.document_version_id  AS claim_document_version_id,
    c.sheet                AS claim_sheet,
    c.page                 AS claim_page,
    c.floor_or_area        AS claim_floor_or_area,
    c.parser_version       AS claim_parser_version,
    c.semantics_version    AS claim_semantics_version,
    c.device_class         AS claim_device_class,
    c.device_variant       AS claim_device_variant,
    c.count_method         AS claim_count_method,
    c.quantity             AS claim_quantity,
    c.printed_total        AS claim_printed_total,
    c.component_total      AS claim_component_total,
    c.source_region        AS claim_source_region,
    c.source_asset_ids     AS claim_source_asset_ids,
    c.state                AS claim_state,
    c.authority_version    AS claim_authority_version,
    c.evidence_fingerprint AS claim_evidence_fingerprint,
    c.version_number       AS claim_version_number,
    c.review_status        AS claim_review_status,
    c.superseded_at        AS claim_superseded_at,
    d.current_version_id   AS claim_current_document_version_id
  FROM ${DRAWING_QUANTITY_BOQ_LINK_TABLE} a
  LEFT JOIN boq_items b
    ON b.id = a.boq_item_id
  LEFT JOIN drawing_quantity_claims c
    ON c.id = a.drawing_quantity_claim_id
  LEFT JOIN documents d
    ON d.id = c.document_id
  WHERE a.project_id = ?
    AND a.boq_item_id = ?
    AND a.superseded_at IS NULL
    AND a.review_status <> 'Rejected'
    AND a.version_number = (
      SELECT MAX(a2.version_number)
      FROM ${DRAWING_QUANTITY_BOQ_LINK_TABLE} a2
      WHERE a2.project_id = a.project_id
        AND a2.boq_item_id = a.boq_item_id
        AND a2.drawing_quantity_claim_id = a.drawing_quantity_claim_id
        AND a2.superseded_at IS NULL
    )
  ORDER BY a.version_number DESC
`;

/**
 * Identity + state of the link, for an auditable response.
 *
 * Deliberately EXCLUDES the quantity: the quantity belongs to the CLAIM, and
 * copying it here would create a second place for it to live and silently disagree.
 * The claim identity is CITED, never copied.
 *
 * CROSS-PROJECT REDACTION: when the linked claim belongs to a different project,
 * its identity -- and the link's reference to it -- are withheld. The link is
 * refused either way, so reporting the foreign row id would disclose another
 * tenant's row to a project that has no claim to it. The refusal reason still
 * names the problem without naming the victim.
 */
function summariseLink(row) {
  if (!row) return null;
  const foreignClaim = Boolean(
    row.claim_id && row.claim_project_id && row.claim_project_id !== row.project_id,
  );
  return {
    linkId: row.id,
    linkState: row.applicability_state,
    linkAuthorityVersion: row.applicability_authority_version,
    linkInputFingerprint: row.applicability_input_fingerprint,
    linkReason: row.applicability_reason,
    projectId: row.project_id,
    drawingQuantityClaimId: foreignClaim ? null : row.drawing_quantity_claim_id,
    boqItemId: row.boq_item_id,
    boqExtractionVersionId: row.boq_extraction_version_id ?? null,
    versionNumber: row.version_number,
    previousVersionId: row.previous_version_id,
    reviewStatus: row.review_status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    reviewReason: row.review_reason,
    createdBy: row.created_by,
    createdAt: row.created_at,
    claimWithheld: foreignClaim,
    claim: foreignClaim || !row.claim_id
      ? null
      : {
          claimId: row.claim_id,
          documentVersionId: row.claim_document_version_id,
          sheet: row.claim_sheet,
          floorOrArea: row.claim_floor_or_area,
          deviceClass: row.claim_device_class,
          deviceVariant: row.claim_device_variant,
          countMethod: row.claim_count_method,
          semanticsVersion: row.claim_semantics_version,
          claimState: row.claim_state,
          claimAuthorityVersion: row.claim_authority_version,
          claimVersionNumber: row.claim_version_number,
          claimReviewStatus: row.claim_review_status,
          claimFingerprint: row.claim_evidence_fingerprint,
        },
  };
}

/**
 * Reduce a governed claim to ONE flat shape, whichever form it arrives in.
 *
 * Two real shapes exist and they are NOT interchangeable:
 *   - a `buildQuantityClaim` result: snake_case columns plus a NESTED `review`
 *     object, no `id` (the writer mints it) and no `version_number`;
 *   - a D1 row: flat, with `review_status`, `id` and `version_number`.
 *
 * Reading one as the other silently reports an approved claim as unreviewed,
 * because `claim.review_status` is simply absent on the domain object. Every
 * claim-reading path here goes through this function so that mistake cannot be
 * made in one place and not the other.
 */
function normaliseClaim(claim) {
  if (!claim) return null;
  const joined = claim.claim_id !== undefined && claim.claim_id !== null;
  const pick = (field) => (joined ? claim[`claim_${field}`] : claim[field]);
  return {
    id: joined ? claim.claim_id : claim.id ?? null,
    project_id: pick("project_id"),
    document_id: pick("document_id"),
    document_version_id: pick("document_version_id"),
    sheet: pick("sheet"),
    page: pick("page"),
    floor_or_area: pick("floor_or_area"),
    parser_version: pick("parser_version"),
    semantics_version: pick("semantics_version"),
    device_class: pick("device_class"),
    device_variant: pick("device_variant"),
    quantity: pick("quantity"),
    count_method: pick("count_method"),
    printed_total: pick("printed_total"),
    component_total: pick("component_total"),
    source_region: pick("source_region"),
    source_asset_ids: parseSourceAssetIds(pick("source_asset_ids")),
    authority_version: pick("authority_version"),
    evidence_fingerprint: pick("evidence_fingerprint"),
    version_number: pick("version_number"),
    state: pick("state"),
    superseded_at: pick("superseded_at"),
    // Flat column wins; otherwise the nested domain object's status is used.
    review_status: pick("review_status") ?? claim.review?.status ?? claim.claim_review_status ?? null,
  };
}

/**
 * The claim's own fingerprint currency, evaluated on the joined claim columns.
 *
 * Delegates to the canonical quantity authority rather than re-deriving it, so
 * there is exactly ONE definition of "this claim describes itself". Accepts a
 * joined reader row, a D1 claim row, or a `buildQuantityClaim` result.
 */
function isClaimFingerprintCurrent(row) {
  const claim = normaliseClaim(row);
  if (!claim) return false;
  const derived = computeQuantityAuthorityFingerprint(claim);
  if (!derived) return false;
  if (!claim.evidence_fingerprint) return true; // nothing stored to contradict
  return claim.evidence_fingerprint === derived;
}

/**
 * `source_asset_ids` is stored as a JSON string but the fingerprint hashes the
 * ARRAY (the canonical authority sorts it, because order is not authority). It
 * must therefore be parsed before hashing, or every claim would appear drifted.
 */
function parseSourceAssetIds(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : value;
  } catch {
    return value;
  }
}
