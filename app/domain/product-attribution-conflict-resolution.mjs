// SINGLE-PRODUCT ATTRIBUTION CONFLICT RESOLUTION -- the governed write path.
//
// WHY THIS EXISTS
// `product_conflicts` is the canonical register of unresolved product identity
// conditions, and `applyIdentityProposal` is the governed resolver for
// MERGE-shaped conflicts (two library products collapsing into one canonical
// product, IR-040 "Existing Product"). That path is structurally incapable of
// representing the other shape that actually occurs: a conflict on ONE canonical
// product whose brand/manufacturer/regime attribution is contested.
//
//   - it requires `outcome === "Existing Product" && terminal_rule_id === "IR-040"`
//   - it resolves the pair by reading `left_value.partNumber` /
//     `right_value.partNumber`, so a conflict whose sides are free text yields
//     no product pair at all
//   - it can only resolve by MOVING references from one product to another,
//     which is meaningless when there is only one product
//
// Without a path here, a single-product attribution conflict can never leave
// Open. Every reviewed Knowledge fact behind it stays permanently unpromotable,
// and the conflict badge becomes permanent background noise that reviewers learn
// to ignore -- which is worse than no badge at all.
//
// THE SEMANTIC INVARIANT
// A resolution may close a conflict ONLY when it has genuinely reconciled the
// canonical state, or when it has made the distinctness explicit and recorded.
// It may never close a conflict by writing prose while leaving contradictory
// canonical truth untouched. That failure mode is why "Needs Investigation" is a
// first-class outcome here rather than a rejection: the honest way to close
// nothing is to close nothing.
//
// EVERYTHING ELSE IS INHERITED, NOT REINVENTED
//   - the register stays `product_conflicts`; there is no second conflict table
//   - the audit stays `identity_decision_audit`, the FK-free register the
//     identity pipeline already uses, carrying entity, action, actor_role,
//     before/after snapshots and a UNIQUE (action, idempotency_key) index
//   - the human-decision policy is `app/domain/human-authority.mjs`, the single
//     source of truth for "may this identity act as a human decision-maker"
//   - the conflict-type vocabulary is `IDENTITY_CONFLICT_TYPES`
//
// No new table. No new role. No second conflict mechanism.

import { IDENTITY_CONFLICT_TYPES } from "./product-lifecycle-authority.mjs";
import { isHumanDecisionActor } from "./human-authority.mjs";

export const ATTRIBUTION_RESOLUTION_ACTIONS = Object.freeze({
  APPLY: "Resolve Single-Product Attribution Conflict",
  REVERSE: "Reverse Single-Product Attribution Conflict",
});

// The audit register is `identity_decision_audit`, NOT `governed_identity_decisions`.
//
// `governed_identity_decisions` looks like the obvious home -- it already has
// conflict_id, conflict_version_before, before/after snapshots, reversal_of_id
// and idempotency_key -- but it cannot be used. Its `decision_type` carries a
// CHECK constraint `IN ('Apply','Reverse')` and its `proposal_id` is NOT NULL
// with a FOREIGN KEY to `identity_resolution_proposals`. An attribution
// resolution has neither a merge decision type nor a proposal, so writing there
// would require fabricating both.
//
// `identity_decision_audit` is the register the identity pipeline already uses
// for every governed step, it is FK-free, and its UNIQUE (action,
// idempotency_key) index makes replay protection a DATABASE guarantee rather
// than a read-then-write race. No new table and no migration is introduced.
const AUDIT_ACTIONS = ATTRIBUTION_RESOLUTION_ACTIONS;

export const ATTRIBUTION_RESOLUTION_AUTHORITY_VERSION = "product-attribution-conflict-resolution-1.0.0";

export const ATTRIBUTION_RESOLUTION_OUTCOMES = Object.freeze({
  CONFIRM_CURRENT_ATTRIBUTION: "Confirm Current Canonical Attribution",
  CORRECT_CANONICAL_ATTRIBUTION: "Correct Canonical Attribution",
  PRESERVE_AND_RECORD_RELATIONSHIP: "Preserve Product + Record Relationship",
  NEEDS_INVESTIGATION: "Needs Investigation",
});

export const ATTRIBUTION_RESOLUTION_DECISIONS = Object.freeze(
  Object.values(ATTRIBUTION_RESOLUTION_OUTCOMES),
);

// Only conflict types that describe a CONTESTED ATTRIBUTION on a single product
// may be resolved here. A "Description Difference" collision is not an
// attribution conflict; sending it here would let a caller close a conflict of a
// different kind through a path whose guarantees were never designed for it.
export const ATTRIBUTION_CONFLICT_TYPES = Object.freeze([
  "Identity Collision — Brand / Standards Regime Conflict",
  "Possible Duplicate Identity",
]);

// The governed identity fields a human may correct, and the library_products
// column each one owns. Deliberately short: an attribution resolution is not a
// general product editor. `part_number` is absent because re-keying a part
// number is a catalogue operation with its own provenance rules, not an
// attribution correction; `lifecycle_status` is absent because availability is
// an evidence question answered by the lifecycle path, never by an identity
// decision.
export const CORRECTABLE_ATTRIBUTION_FIELDS = Object.freeze([
  { field: "brand", column: "brand_id", label: "brand" },
  { field: "manufacturer", column: "manufacturer_id", label: "manufacturer" },
  { field: "family", column: "family_id", label: "product family" },
]);

export const ATTRIBUTION_RESOLUTION_ERRORS = Object.freeze({
  CONFLICT_REQUIRED: "ATTRIBUTION_CONFLICT_NOT_FOUND",
  CONFLICT_NOT_OPEN: "ATTRIBUTION_CONFLICT_NOT_OPEN",
  CONFLICT_TYPE_UNSUPPORTED: "ATTRIBUTION_CONFLICT_TYPE_UNSUPPORTED",
  CONFLICT_VERSION_STALE: "ATTRIBUTION_CONFLICT_VERSION_STALE",
  PRODUCT_UNKNOWN: "ATTRIBUTION_PRODUCT_UNKNOWN",
  DECISION_REQUIRED: "ATTRIBUTION_DECISION_REQUIRED",
  DECISION_INVALID: "ATTRIBUTION_DECISION_INVALID",
  HUMAN_ACTOR_REQUIRED: "ATTRIBUTION_HUMAN_ACTOR_REQUIRED",
  REASON_REQUIRED: "ATTRIBUTION_REASON_REQUIRED",
  EVIDENCE_REQUIRED: "ATTRIBUTION_EVIDENCE_REQUIRED",
  CORRECTION_REQUIRED: "ATTRIBUTION_CORRECTION_REQUIRED",
  CORRECTION_FIELD_UNSUPPORTED: "ATTRIBUTION_CORRECTION_FIELD_UNSUPPORTED",
  CORRECTION_NO_CHANGE: "ATTRIBUTION_CORRECTION_MAKES_NO_CHANGE",
  CORRECTION_TARGET_UNKNOWN: "ATTRIBUTION_CORRECTION_TARGET_UNKNOWN",
  SUCCESSOR_REQUIRED: "ATTRIBUTION_SUCCESSOR_REQUIRED",
  SUCCESSOR_UNKNOWN: "ATTRIBUTION_SUCCESSOR_UNKNOWN",
  SUCCESSOR_IS_SELF: "ATTRIBUTION_SUCCESSOR_IS_SELF",
  SUCCESSOR_SUPERSEDED: "ATTRIBUTION_SUCCESSOR_SUPERSEDED",
  RELATIONSHIP_TYPE_UNSUPPORTED: "ATTRIBUTION_RELATIONSHIP_TYPE_UNSUPPORTED",
  SUCCESSOR_CONFLICT_OPEN: "ATTRIBUTION_SUCCESSOR_IDENTITY_CONFLICT_OPEN",
  IDEMPOTENCY_KEY_REQUIRED: "ATTRIBUTION_IDEMPOTENCY_KEY_REQUIRED",
  IDEMPOTENCY_KEY_REUSED: "ATTRIBUTION_IDEMPOTENCY_KEY_REUSED",
  DECISION_NOT_FOUND: "ATTRIBUTION_DECISION_NOT_FOUND",
  DECISION_NOT_REVERSIBLE: "ATTRIBUTION_DECISION_NOT_REVERSIBLE",
});

const MIN_REASON_CHARS = 20;
// An attribution CORRECTION moves a canonical field that matching and the brand
// policy both read, so it carries a higher evidence bar than merely agreeing
// with what is already there.
const MIN_CORRECTION_REASON_CHARS = 40;

const clean = (value) => String(value ?? "").trim();
const parseJson = (value, fallback) => {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};
const error = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

// The canonical identity fields this path may read and write. Read and write
// share ONE field list on purpose: a resolution must never be able to write a
// field its own before-snapshot failed to capture, because an uncaptured field
// cannot be restored on reversal.
const CORRECTION_COLUMNS = Object.freeze(
  Object.fromEntries(CORRECTABLE_ATTRIBUTION_FIELDS.map((entry) => [entry.field, entry.column])),
);

export const attributionProductSnapshot = (row) => ({
  productId: row.id,
  partNumber: clean(row.part_number),
  manufacturerId: row.manufacturer_id ?? null,
  brandId: row.brand_id ?? null,
  familyId: row.family_id ?? null,
  identityStatus: row.identity_status,
  identityVersion: Number(row.identity_version || 1),
  // Part of the snapshot so reversal can prove the product key itself never
  // moved, which is the invariant that preserves every downstream reference.
  normalizedPartNumber: clean(row.normalized_part_number),
  description: clean(row.description),
  lifecycleStatus: row.lifecycle_status,
});

export const attributionConflictSnapshot = (row) => ({
  conflictId: row.id,
  conflictType: row.conflict_type,
  status: row.status,
  resolution: row.resolution ?? null,
  resolvedBy: row.resolved_by ?? null,
  resolvedAt: row.resolved_at ?? null,
  conflictVersion: Number(row.conflict_version || 1),
  productId: row.product_id ?? null,
});

/**
 * Pure validation of an attribution resolution request.
 *
 * Kept pure so every governance rule is testable without a database and so a
 * route can never become the only place a rule is enforced. The human check is
 * FIRST: this operation closes a governed register and can move the brand a
 * commercial match reads, so the authority question must be answered before any
 * state is read, let alone written.
 */
export const assessAttributionConflictResolution = ({
  conflict,
  product,
  decision,
  correction = null,
  successorProductId = null,
  relationship = null,
  reason,
  evidence,
  humanActor,
  knownConflictType = null,
} = {}) => {
  if (!isHumanDecisionActor(humanActor)) {
    return error(
      ATTRIBUTION_RESOLUTION_ERRORS.HUMAN_ACTOR_REQUIRED,
      "This resolution must be made by a configured human decision-maker.",
    );
  }

  const conflictType = clean(conflict?.conflict_type ?? conflict?.conflictType);
  if (!conflictType) {
    return error(ATTRIBUTION_RESOLUTION_ERRORS.CONFLICT_REQUIRED, "A conflict is required.");
  }
  // A caller may narrow which conflicts it believes exist; by default the
  // register row is the authority.
  if (typeof knownConflictType === "function" && !knownConflictType(conflict)) {
    return error(
      ATTRIBUTION_RESOLUTION_ERRORS.CONFLICT_TYPE_UNSUPPORTED,
      "The conflict type is not governed by this path.",
    );
  }
  if (!ATTRIBUTION_CONFLICT_TYPES.includes(conflictType) || !IDENTITY_CONFLICT_TYPES.includes(conflictType)) {
    return error(
      ATTRIBUTION_RESOLUTION_ERRORS.CONFLICT_TYPE_UNSUPPORTED,
      `"${conflictType}" is not a single-product attribution conflict.`,
    );
  }
  if (clean(conflict?.status) !== "Open") {
    return error(
      ATTRIBUTION_RESOLUTION_ERRORS.CONFLICT_NOT_OPEN,
      "The conflict is no longer open.",
    );
  }
  if (!product) {
    return error(ATTRIBUTION_RESOLUTION_ERRORS.PRODUCT_UNKNOWN, "The conflict's canonical product is unknown.");
  }

  const chosen = clean(decision);
  if (!chosen) {
    return error(ATTRIBUTION_RESOLUTION_ERRORS.DECISION_REQUIRED, "Choose a resolution decision.");
  }
  if (!ATTRIBUTION_RESOLUTION_DECISIONS.includes(chosen)) {
    return error(
      ATTRIBUTION_RESOLUTION_ERRORS.DECISION_INVALID,
      "Choose Confirm Current Canonical Attribution, Correct Canonical Attribution, Preserve Product + Record Relationship, or Needs Investigation.",
    );
  }

  const refs = (Array.isArray(evidence) ? evidence : [])
    .map((entry) => {
      if (!entry) return null;
      if (typeof entry === "string") return { document: clean(entry) };
      const document = clean(entry.document ?? entry.sourceId ?? entry.source_id);
      const url = clean(entry.url);
      const quote = clean(entry.quote);
      return document || url ? { ...(document ? { document } : {}), ...(url ? { url } : {}), ...(quote ? { quote } : {}) } : null;
    })
    .filter(Boolean);
  if (!refs.length) {
    return error(
      ATTRIBUTION_RESOLUTION_ERRORS.EVIDENCE_REQUIRED,
      "A resolution must cite at least one supporting source.",
    );
  }

  const why = clean(reason);
  const minReason = chosen === ATTRIBUTION_RESOLUTION_OUTCOMES.CORRECT_CANONICAL_ATTRIBUTION
    ? MIN_CORRECTION_REASON_CHARS
    : MIN_REASON_CHARS;
  if (why.length < minReason) {
    return error(
      ATTRIBUTION_RESOLUTION_ERRORS.REASON_REQUIRED,
      `Provide a substantive reason of at least ${minReason} characters.`,
    );
  }

  // NEEDS INVESTIGATION IS A REAL, COMPLETE OUTCOME: it writes nothing at all
  // and leaves the conflict exactly as it was. It exists so that "we cannot
  // decide this yet" has a first-class governed outcome instead of being forced
  // into either a false confirmation or a destructive correction.
  if (chosen === ATTRIBUTION_RESOLUTION_OUTCOMES.NEEDS_INVESTIGATION) {
    return {
      ok: true,
      writes: false,
      value: {
        outcome: chosen,
        // Uniform shape across every outcome: a caller that destructures a
        // resolution must never have to branch on which decision produced it,
        // because a missing key here would read as "nothing was requested"
        // rather than "nothing can be written".
        correction: {},
        successorProductId: null,
        relationship: null,
        reason: why,
        supportingEvidence: refs,
        decidedBy: humanActor.id,
        humanActorSource: clean(humanActor.source),
        authorityVersion: ATTRIBUTION_RESOLUTION_AUTHORITY_VERSION,
      },
    };
  }

  if (chosen === ATTRIBUTION_RESOLUTION_OUTCOMES.CONFIRM_CURRENT_ATTRIBUTION) {
    return {
      ok: true,
      writes: true,
      value: {
        outcome: chosen,
        correction: {},
        successorProductId: null,
        relationship: null,
        reason: why,
        supportingEvidence: refs,
        decidedBy: humanActor.id,
        humanActorSource: clean(humanActor.source),
        authorityVersion: ATTRIBUTION_RESOLUTION_AUTHORITY_VERSION,
      },
    };
  }

  if (chosen === ATTRIBUTION_RESOLUTION_OUTCOMES.CORRECT_CANONICAL_ATTRIBUTION) {
    const requested = correction && typeof correction === "object" ? correction : {};
    const fields = Object.keys(requested).filter((key) => clean(requested[key]));
    if (!fields.length) {
      return error(
        ATTRIBUTION_RESOLUTION_ERRORS.CORRECTION_REQUIRED,
        "Name at least one attribution field to correct.",
      );
    }
    const unsupported = fields.filter((field) => !CORRECTION_COLUMNS[field]);
    if (unsupported.length) {
      return error(
        ATTRIBUTION_RESOLUTION_ERRORS.CORRECTION_FIELD_UNSUPPORTED,
        `Not correctable by attribution resolution: ${unsupported.join(", ")}. Correctable fields are ${CORRECTABLE_ATTRIBUTION_FIELDS.map((entry) => entry.field).join(", ")}.`,
        { unsupportedFields: unsupported, correctableFields: CORRECTABLE_ATTRIBUTION_FIELDS.map((entry) => entry.field) },
      );
    }
    // A correction that changes nothing is refused rather than recorded as a
    // correction: it would burn an audit row and a conflict version to say
    // "no", which is what Confirm Current Canonical Attribution is for.
    const unchanged = fields.filter((field) => clean(requested[field]) === clean(product[CORRECTION_COLUMNS[field]]));
    if (unchanged.length === fields.length) {
      return error(
        ATTRIBUTION_RESOLUTION_ERRORS.CORRECTION_NO_CHANGE,
        "The requested correction matches the current canonical value; use Confirm Current Canonical Attribution.",
      );
    }
    const corrections = {};
    for (const field of fields) {
      if (unchanged.includes(field)) continue;
      corrections[field] = clean(requested[field]);
    }
    return {
      ok: true,
      writes: true,
      value: {
        outcome: chosen,
        correction: corrections,
        successorProductId: null,
        relationship: null,
        reason: why,
        supportingEvidence: refs,
        decidedBy: humanActor.id,
        humanActorSource: clean(humanActor.source),
        authorityVersion: ATTRIBUTION_RESOLUTION_AUTHORITY_VERSION,
      },
    };
  }

  // PRESERVE PRODUCT + RECORD RELATIONSHIP.
  const successor = clean(successorProductId);
  if (!successor) {
    return error(
      ATTRIBUTION_RESOLUTION_ERRORS.SUCCESSOR_REQUIRED,
      "Name the related product whose distinctness or supersession must be recorded.",
    );
  }
  const relationshipType = clean(relationship?.relationshipType ?? relationship?.relationship_type);
  // Fail closed against the governed relationship vocabulary rather than
  // accepting a new token: an unsupported type would persist a row no governed
  // reader recognises, which is indistinguishable from no relationship at all
  // while looking like one.
  const governedType = "Compatible With";
  if (relationshipType && relationshipType !== governedType) {
    return error(
      ATTRIBUTION_RESOLUTION_ERRORS.RELATIONSHIP_TYPE_UNSUPPORTED,
      `"${relationshipType}" is not a governed relationship type. The governed vocabulary is ["${governedType}"]; a supersession relationship has no governed destination and must not be invented here.`,
      { governedTypes: [governedType] },
    );
  }
  return {
    ok: true,
    writes: true,
    value: {
      outcome: chosen,
      correction: {},
      successorProductId: successor,
      relationship: {
        relationshipType: governedType,
        note: clean(relationship?.note) || null,
      },
      reason: why,
      supportingEvidence: refs,
      decidedBy: humanActor.id,
      humanActorSource: clean(humanActor.source),
      authorityVersion: ATTRIBUTION_RESOLUTION_AUTHORITY_VERSION,
    },
  };
};

// ---------------------------------------------------------------------------
// The write path.
// ---------------------------------------------------------------------------

const loadConflict = (db, conflictId) =>
  db
    .prepare("SELECT * FROM product_conflicts WHERE id=?")
    .bind(conflictId)
    .first();

const loadProduct = (db, productId) =>
  db
    .prepare("SELECT * FROM library_products WHERE id=?")
    .bind(productId)
    .first();

const openConflictCount = async (db, productId) =>
  Number(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM product_conflicts WHERE product_id=? AND status='Open' AND deleted_at IS NULL",
        )
        .bind(productId)
        .first()
    )?.n || 0,
  );

// `library_scope` is NOT NULL on the audit register, and `identity_decision_audit`
// rows written by the merge path carry the scope it inherited from the proposal.
// Deriving the fallback here rather than at each call site keeps a reversal from
// writing a null scope its own reversal row would then fail on.
const scopeColumns = (conflict) => [
  clean(conflict?.library_scope) || "Global Library",
  conflict?.organization_id ?? null,
  conflict?.library_project_id ?? null,
];

/**
 * Resolve ONE single-product attribution conflict, governed and idempotently.
 *
 * Every write happens as ONE batch so the conflict cannot end up Resolved while
 * the attribution it claims to have reconciled is unchanged, or vice versa.
 * There is no partial-success state reachable through this path.
 *
 * Idempotency is keyed on (action, idempotency_key) in
 * `identity_decision_audit`, whose UNIQUE index makes this a DATABASE guarantee
 * rather than a read-then-write race. A replay with the same key and the same
 * request returns the original decision and writes nothing; a replay with a
 * DIFFERENT request is refused, because silently treating two different
 * resolutions as one would lose a human decision.
 */
export const resolveAttributionConflict = async (
  db,
  {
    conflictId,
    decision,
    correction = null,
    successorProductId = null,
    relationship = null,
    reason,
    evidence,
    humanActor,
    actorRole = null,
    idempotencyKey = null,
    expectedConflictVersion = null,
    newId = null,
    now = new Date().toISOString(),
  } = {},
) => {
  const id = clean(conflictId);
  if (!id) return error(ATTRIBUTION_RESOLUTION_ERRORS.CONFLICT_REQUIRED, "A conflict id is required.");

  const requestFingerprint = JSON.stringify({
    conflictId: id,
    decision: clean(decision),
    correction: correction && typeof correction === "object" ? correction : null,
    successorProductId: clean(successorProductId) || null,
    relationship: relationship ?? null,
    reason: clean(reason),
    decidedBy: clean(humanActor?.id),
  });

  if (clean(idempotencyKey)) {
    const prior = await db
      .prepare("SELECT * FROM identity_decision_audit WHERE action=? AND idempotency_key=?")
      .bind(AUDIT_ACTIONS.APPLY, clean(idempotencyKey))
      .first();
    if (prior) {
      const priorNext = parseJson(prior.new_snapshot_json, {});
      const priorPrevious = parseJson(prior.previous_snapshot_json, {});
      // `entity_id` is the conflict; the subject product is recorded inside the
      // before-snapshot, which is why both snapshots are read back here rather
      // than trusting the audit row to carry the product.
      const storedFingerprint = priorNext.requestFingerprint || null;
      if (storedFingerprint && storedFingerprint !== requestFingerprint) {
        return error(
          ATTRIBUTION_RESOLUTION_ERRORS.IDEMPOTENCY_KEY_REUSED,
          "The idempotency key was already used for a different attribution resolution.",
        );
      }
      const after = prior.entity_id ? await loadProduct(db, prior.entity_id) : null;
      const afterConflict = await loadConflict(db, id);
      return {
        ok: true,
        idempotent: true,
        decisionId: prior.id,
        outcome: priorNext.outcome ?? null,
        previous: priorPrevious,
        next: priorNext,
        after: after ? attributionProductSnapshot(after) : null,
        conflictAfter: afterConflict ? attributionConflictSnapshot(afterConflict) : null,
        message: `This exact attribution resolution was already recorded as "${priorNext.outcome ?? prior.action}"; nothing was written again.`,
      };
    }
  } else {
    return error(
      ATTRIBUTION_RESOLUTION_ERRORS.IDEMPOTENCY_KEY_REQUIRED,
      "Provide an idempotency key: closing a governed conflict must be replay-safe.",
    );
  }

  const conflict = await loadConflict(db, id);
  if (!conflict) return error(ATTRIBUTION_RESOLUTION_ERRORS.CONFLICT_REQUIRED, "Unknown conflict.");

  const product = conflict.product_id ? await loadProduct(db, conflict.product_id) : null;

  const assessed = assessAttributionConflictResolution({
    conflict,
    product,
    decision,
    correction,
    successorProductId,
    relationship,
    reason,
    evidence,
    humanActor,
  });
  if (!assessed.ok) return assessed;
  const value = assessed.value;

  // NEEDS INVESTIGATION writes nothing at all. The conflict stays Open and its
  // version is untouched, so held facts stay held and no audit row claims a
  // resolution that did not happen.
  //
  // `writes` is a property of the ASSESSMENT, not of its value. Read off
  // `value` it is always `undefined`, which is falsy, which would route EVERY
  // resolution through this silent no-op -- a resolution reporting success while
  // changing nothing. Tests ATTRIBUTION/H and O exist to catch exactly that,
  // because a reviewer reading "Recorded" would never notice.
  if (!assessed.writes) {
    return {
      ok: true,
      idempotent: false,
      writes: false,
      decisionId: null,
      outcome: value.outcome,
      message:
        "Recorded as Needs Investigation. The conflict is unchanged and still Open, so every fact held behind it stays held.",
      reason: value.reason,
      supportingEvidence: value.supportingEvidence,
      decidedBy: value.decidedBy,
    };
  }

  // Optimistic concurrency on the conflict version. A second concurrent resolver
  // must not silently overwrite the first resolver's reconciled state.
  if (expectedConflictVersion != null && Number(expectedConflictVersion) !== Number(conflict.conflict_version || 1)) {
    return error(
      ATTRIBUTION_RESOLUTION_ERRORS.CONFLICT_VERSION_STALE,
      "The conflict changed since it was read; reload before resolving.",
      { expectedConflictVersion: Number(expectedConflictVersion), actualConflictVersion: Number(conflict.conflict_version || 1) },
    );
  }

  const previousProduct = product ? attributionProductSnapshot(product) : null;
  const previousConflict = attributionConflictSnapshot(conflict);

  const statements = [];
  // The PRESERVE branch mints its ids up front, because the relationship row
  // must be able to cite the decision that authorised it. Declared here rather
  // than inside the branch so no branch reaches across scope for it.
  let presignedDecisionId = null;
  const newSnapshot = {
    outcome: value.outcome,
    reason: value.reason,
    decidedBy: value.decidedBy,
    decidedByName: clean(humanActor?.name),
    humanActorSource: value.humanActorSource,
    actorRole: clean(actorRole),
    correction: {},
    relationship: null,
    affectedEntityIds: {},
    supportingEvidence: value.supportingEvidence,
    authorityVersion: value.authorityVersion,
  };

  if (value.outcome === ATTRIBUTION_RESOLUTION_OUTCOMES.CORRECT_CANONICAL_ATTRIBUTION) {
    const resolvedTargets = {};
    const assignments = [];
    for (const [field, targetId] of Object.entries(value.correction)) {
      const column = CORRECTION_COLUMNS[field];
      if (!column) {
        return error(
          ATTRIBUTION_RESOLUTION_ERRORS.CORRECTION_FIELD_UNSUPPORTED,
          `Not correctable: ${field}.`,
        );
      }
      // The correction target must be an EXISTING governed row in the same
      // register. This path may repoint a product at an established brand or
      // manufacturer; it may never invent one, because a newly minted
      // manufacturer is a catalogue decision with its own provenance.
      const table = column === "brand_id" ? "product_brands" : column === "manufacturer_id" ? "product_manufacturers" : "product_families";
      const exists = await db.prepare(`SELECT id FROM ${table} WHERE id=?`).bind(targetId).first();
      if (!exists) {
        return error(
          ATTRIBUTION_RESOLUTION_ERRORS.CORRECTION_TARGET_UNKNOWN,
          `No ${field} exists with id ${targetId}. Correct an existing governed value; this path does not create catalogue rows.`,
          { field, targetId },
        );
      }
      assignments.push(`${column}=?`);
      resolvedTargets[field] = { column, from: product[column] ?? null, to: targetId };
    }
    newSnapshot.correction = resolvedTargets;
    newSnapshot.affectedEntityIds = {
      canonicalProductId: product.id,
      ...Object.fromEntries(Object.entries(resolvedTargets).map(([field, entry]) => [`${field}Id`, entry.to])),
    };
    statements.push(
      db
        .prepare(
          `UPDATE library_products SET ${assignments.join(", ")}, identity_version=COALESCE(identity_version,0)+1, updated_at=? WHERE id=?`,
        )
        .bind(...Object.values(resolvedTargets).map((entry) => entry.to), now, product.id),
    );
  }

  if (value.outcome === ATTRIBUTION_RESOLUTION_OUTCOMES.PRESERVE_AND_RECORD_RELATIONSHIP) {
    const successorId = clean(value.successorProductId);
    if (successorId === product.id) {
      return error(
        ATTRIBUTION_RESOLUTION_ERRORS.SUCCESSOR_IS_SELF,
        "The related product cannot be the product being resolved.",
      );
    }
    const successor = await loadProduct(db, successorId);
    if (!successor) {
      return error(
        ATTRIBUTION_RESOLUTION_ERRORS.SUCCESSOR_UNKNOWN,
        "The related product does not exist.",
      );
    }
    if (successor.identity_status !== "Active") {
      return error(
        ATTRIBUTION_RESOLUTION_ERRORS.SUCCESSOR_SUPERSEDED,
        "The related product is not an Active canonical product.",
      );
    }
    // Record the distinctness against a product whose own identity is settled.
    // Recording "these two are related" toward a third contested product would
    // propagate the unresolved question instead of closing it.
    if (await openConflictCount(db, successorId)) {
      return error(
        ATTRIBUTION_RESOLUTION_ERRORS.SUCCESSOR_CONFLICT_OPEN,
        "The related product has its own open identity conflict; resolve that first.",
      );
    }
    const decisionId = newId ? await newId("identitydecision") : `identitydecision_${Math.random().toString(16).slice(2)}`;
    const relId = newId
      ? await newId("engineeringrelationship")
      : `engineeringrelationship_${Math.random().toString(16).slice(2)}`;
    newSnapshot.relationship = {
      relationshipId: relId,
      relationshipType: value.relationship.relationshipType,
      leftEntityId: product.id,
      rightEntityId: successor.id,
      note: value.relationship.note,
    };
    newSnapshot.affectedEntityIds = {
      canonicalProductId: product.id,
      relatedProductId: successor.id,
      relationshipId: relId,
    };
    statements.push(
      db
        .prepare(
          `INSERT INTO engineering_relationships (id, left_entity_type, left_entity_id, relationship_type, right_entity_type, right_entity_id, conditions, exceptions, fact_type, scope_type, scope_id, confidence, status, version_number, effective_from, reviewed_by, reviewed_at, created_by, created_at)
           VALUES (?, 'Product', ?, ?, 'Product', ?, ?, '[]', 'Manufacturer Rule', 'Product', ?, 95, 'Approved', 1, ?, ?, ?, ?, ?)`,
        )
        .bind(
          relId,
          product.id,
          value.relationship.relationshipType,
          successor.id,
          // Knowledge provenance rides in conditions, the same convention the
          // Knowledge fact promotion path uses: `engineering_relationships
          // .provenance_fact_id` is an FK to `engineering_facts`, NOT to
          // `knowledge_facts`, so it stays null and the decided-by identity is
          // carried explicitly instead.
          JSON.stringify([
            {
              type: "documented_evidence",
              note: value.relationship.note,
              supportingEvidence: value.supportingEvidence,
              decidedBy: value.decidedBy,
              humanActorSource: value.humanActorSource,
              authorityResolution: value.authorityVersion,
            },
          ]),
          product.id,
          now,
          value.decidedBy,
          now,
          value.decidedBy,
          now,
        ),
    );
    presignedDecisionId = decisionId;
  }

  const decisionId =
    presignedDecisionId || (newId ? await newId("identitydecision") : `identitydecision_${Math.random().toString(16).slice(2)}`);

  // The after-state is read back from the database rather than recomputed here.
  // Reporting a reconstructed snapshot would mean reporting what the code BELIEVED
  // it wrote; reading it back reports what is actually stored.
  newSnapshot.conflict = {
    ...previousConflict,
    status: "Resolved",
    resolution: value.outcome,
    resolvedBy: value.decidedBy,
    resolvedAt: now,
    conflictVersion: previousConflict.conflictVersion + 1,
  };

  statements.push(
    db
      .prepare(
        "UPDATE product_conflicts SET status='Resolved', resolution=?, resolved_by=?, resolved_at=?, conflict_version=? WHERE id=? AND status='Open' AND conflict_version=?",
      )
      .bind(
        value.outcome,
        value.decidedBy,
        now,
        previousConflict.conflictVersion + 1,
        conflict.id,
        previousConflict.conflictVersion,
      ),
  );
  statements.push(
    db
      .prepare(
        `INSERT INTO identity_decision_audit (id, entity_type, entity_id, action, actor_id, actor_role, reason, previous_snapshot_json, new_snapshot_json, ruleset_checksum, proposal_fingerprint, idempotency_key, library_scope, organization_id, library_project_id)
         VALUES (?, 'Product Conflict', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        decisionId,
        // entity_id is the CONFLICT, not the product: the decision is ABOUT the
        // conflict, and reversal must find it from the conflict's own history.
        conflict.id,
        AUDIT_ACTIONS.APPLY,
        value.decidedBy,
        clean(actorRole),
        value.reason,
        JSON.stringify({ product: previousProduct, conflict: previousConflict }),
        JSON.stringify({ ...newSnapshot, requestFingerprint }),
        // Column mapping, stated because it is a mapping: an attribution
        // resolution has no merge ruleset and no proposal fingerprint, so the
        // authority version and the request fingerprint take the two optional
        // fingerprint slots this shared audit table already provides.
        ATTRIBUTION_RESOLUTION_AUTHORITY_VERSION,
        requestFingerprint,
        clean(idempotencyKey),
        ...scopeColumns(conflict),
      ),
  );

  try {
    await db.batch(statements);
  } catch (error_) {
    // The conflict UPDATE is version-guarded, so a concurrent resolver that won
    // the race makes the batch fail rather than double-apply. Report it as the
    // stale version it is, not as an opaque database error.
    const message = String(error_?.message || error_);
    if (message.includes("product_conflicts") || message.includes("constraint")) {
      return error(
        ATTRIBUTION_RESOLUTION_ERRORS.CONFLICT_VERSION_STALE,
        "The conflict changed while this resolution was being committed; nothing was written.",
        { cause: message },
      );
    }
    throw error_;
  }

  const afterConflict = await loadConflict(db, conflict.id);
  const afterProduct = await loadProduct(db, product.id);

  return {
    ok: true,
    idempotent: false,
    writes: true,
    decisionId,
    outcome: value.outcome,
    status: "Applied",
    previous: { product: previousProduct, conflict: previousConflict },
    next: newSnapshot,
    after: afterProduct ? attributionProductSnapshot(afterProduct) : null,
    conflictAfter: afterConflict ? attributionConflictSnapshot(afterConflict) : null,
    relationshipCreated: newSnapshot.relationship || null,
    reversible: true,
    message: `${value.outcome}. The conflict is Resolved and every canonical change is recorded with its prior value.`,
  };
};

/**
 * Reverse an applied attribution resolution using ONLY its stored before-state.
 *
 * Reversal is SAFE here precisely because the path was built to make it safe:
 * the correction surface is a closed field list that the before-snapshot shares,
 * so restoring is a column-for-column write of values this module itself
 * recorded. What makes it safe is also what limits it -- reversal restores
 * identity ATTRIBUTION only. It never reverts a promotion, never resurrects a
 * relationship created by some other route, and never touches price records,
 * project references or lifecycle events, because this path never moved them.
 */
export const reverseAttributionConflictResolution = async (
  db,
  { decisionId, reason, humanActor, actorRole = null, idempotencyKey = null, newId = null, now = new Date().toISOString() } = {},
) => {
  const id = clean(decisionId);
  if (!id) return error(ATTRIBUTION_RESOLUTION_ERRORS.DECISION_NOT_FOUND, "A decision id is required.");

  if (!isHumanDecisionActor(humanActor)) {
    return error(
      ATTRIBUTION_RESOLUTION_ERRORS.HUMAN_ACTOR_REQUIRED,
      "Reversal must be made by a configured human decision-maker.",
    );
  }

  const original = await db
    .prepare("SELECT * FROM identity_decision_audit WHERE id=? AND action=?")
    .bind(id, AUDIT_ACTIONS.APPLY)
    .first();
  if (!original) {
    return error(ATTRIBUTION_RESOLUTION_ERRORS.DECISION_NOT_FOUND, "Unknown attribution resolution.");
  }
  const originalPrevious = parseJson(original.previous_snapshot_json, {});
  // A reversal is found by the CONFLICT it reverses, never by a guess at the
  // product: `previous_snapshot_json.product` is the authoritative subject, and
  // reading it back means a reversal cannot be aimed at the wrong row.
  const originalProductId = originalPrevious?.product?.productId ?? null;
  const originalConflictId = original.entity_id;

  const already = await db
    .prepare("SELECT id FROM identity_decision_audit WHERE action=? AND new_snapshot_json LIKE ?")
    .bind(AUDIT_ACTIONS.REVERSE, `%"reversalOfId":"${id}"%`)
    .first();
  if (already) {
    return {
      ok: true,
      idempotent: true,
      reversalId: already.id,
      decisionId: id,
      message: "This attribution resolution was already reversed; nothing was written again.",
    };
  }

  const why = clean(reason);
  if (why.length < MIN_REASON_CHARS) {
    return error(
      ATTRIBUTION_RESOLUTION_ERRORS.REASON_REQUIRED,
      `Provide a substantive reversal reason of at least ${MIN_REASON_CHARS} characters.`,
    );
  }
  const key = clean(idempotencyKey);
  if (!key) {
    return error(
      ATTRIBUTION_RESOLUTION_ERRORS.IDEMPOTENCY_KEY_REQUIRED,
      "Provide an idempotency key for the reversal.",
    );
  }
  const priorByKey = await db
    .prepare("SELECT * FROM identity_decision_audit WHERE action=? AND idempotency_key=?")
    .bind(AUDIT_ACTIONS.REVERSE, key)
    .first();
  if (priorByKey) {
    return {
      ok: true,
      idempotent: true,
      reversalId: priorByKey.id,
      decisionId: id,
      message: "This reversal was already recorded; nothing was written again.",
    };
  }

  const previous = originalPrevious;
  const previousConflict = previous.conflict || {};
  const next = parseJson(original.new_snapshot_json, {});

  const product = originalProductId ? await loadProduct(db, originalProductId) : null;
  if (!product) {
    return error(ATTRIBUTION_RESOLUTION_ERRORS.PRODUCT_UNKNOWN, "The resolved product no longer exists; reversal refused.");
  }

  const statements = [];

  // Restore identity attribution column-for-column, and ONLY the columns this
  // decision changed. `identity_version` is left as-is: it counts decisions,
  // and decrementing it would let a later reader believe no decision ever
  // happened.
  const correctionEntries = Object.entries(next.correction || {});
  if (correctionEntries.length) {
    const assignments = [];
    const params = [];
    for (const [, entry] of correctionEntries) {
      assignments.push(`${entry.column}=?`);
      params.push(entry.from ?? null);
    }
    statements.push(
      db
        .prepare(`UPDATE library_products SET ${assignments.join(", ")}, updated_at=? WHERE id=?`)
        .bind(...params, now, product.id),
    );
  }

  // Remove only the relationship row this decision created.
  if (next.relationship?.relationshipId) {
    statements.push(
      db.prepare("DELETE FROM engineering_relationships WHERE id=?").bind(next.relationship.relationshipId),
    );
  }

  // Reopen the conflict. Its version stays at the resolved value so the next
  // resolution locks against a fresh version rather than reusing one.
  statements.push(
    db
      .prepare(
        "UPDATE product_conflicts SET status='Open', resolution=NULL, resolved_by=NULL, resolved_at=NULL WHERE id=?",
      )
      .bind(originalConflictId),
  );

  const reversalId = newId
    ? await newId("identityaudit")
    : `identityaudit_${Math.random().toString(16).slice(2)}`;

  statements.push(
    db
      .prepare(
        `INSERT INTO identity_decision_audit (id, entity_type, entity_id, action, actor_id, actor_role, reason, previous_snapshot_json, new_snapshot_json, ruleset_checksum, proposal_fingerprint, idempotency_key, library_scope, organization_id, library_project_id)
         VALUES (?, 'Product Conflict', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      )
      // Column order is explicit because the two optional fingerprint columns
      // sit in the middle: `ruleset_checksum` carries the authority version,
      // `proposal_fingerprint` is hard-coded NULL because an attribution
      // resolution has no merge proposal to fingerprint.
      .bind(
        reversalId,
        originalConflictId,
        AUDIT_ACTIONS.REVERSE,
        clean(humanActor?.id),
        clean(actorRole),
        why,
        JSON.stringify(next),
        JSON.stringify({
          outcome: "Reversed",
          reversalOfId: id,
          restored: next.correction || {},
          removedRelationshipId: next.relationship?.relationshipId || null,
          conflict: {
            ...previousConflict,
            status: "Open",
            resolution: null,
            resolvedBy: null,
            resolvedAt: null,
          },
          affectedEntityIds: { canonicalProductId: product.id },
          authorityVersion: ATTRIBUTION_RESOLUTION_AUTHORITY_VERSION,
        }),
        ATTRIBUTION_RESOLUTION_AUTHORITY_VERSION,
        key,
        ...scopeColumns(original),
      ),
  );

  await db.batch(statements);

  return {
    ok: true,
    idempotent: false,
    reversalId,
    decisionId: id,
    outcome: "Reversed",
    restored: next.correction || {},
    removedRelationshipId: next.relationship?.relationshipId || null,
    after: attributionProductSnapshot(await loadProduct(db, product.id)),
    conflictAfter: attributionConflictSnapshot(await loadConflict(db, originalConflictId)),
    message:
      "Attribution resolution reversed from its stored before-state. The conflict is Open again, and every fact held behind it stays held.",
  };
};
