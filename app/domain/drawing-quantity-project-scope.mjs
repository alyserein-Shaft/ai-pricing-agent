// PROJECT-SCOPED DRAWING QUANTITY COVERAGE.
//
// Closes the ambiguity proved in the Fireman Telephone slice: the canonical
// readers derive `coverageState` from the claims they are HANDED, so they are
// claim-relative, not project-relative. Measured directly:
//
//   claims for BOS + GRS + KGS (WLC absent entirely)
//     -> readCurrentDrawingQuantities(...).coverageState === "Complete"
//
// Nothing is wrong with those claims. They are individually current, governed
// and PROVEN. What is unknowable from the claim set alone is WHICH locations
// were supposed to have one. A partial set of internally-complete claims is
// therefore indistinguishable from a complete project, and downstream reading
// `Complete` as project readiness would consume an inflated or under-scoped
// total.
//
// THIS MODULE DOES NOT GUESS THE SCOPE.
//
// The expected scope is an EXPLICIT, GOVERNED input supplied by the caller.
// This module will not infer it from the existing claims (that would make a
// missing location invisible by construction), nor from recognition results,
// historical totals, fixtures or AI output. When no scope is supplied the answer
// is UNKNOWN_SCOPE -- explicitly NOT Complete. That is the whole point: an
// unknown scope must fail closed for readiness while remaining fully usable for
// read-only inspection.
//
// There is currently NO governed per-project expected-quantity-location registry
// in this repository, so in production today every call is UNKNOWN_SCOPE unless
// its caller brings scope of its own. That is reported, not papered over.
//
// THIS IS A WRAPPER, NOT A PARALLEL SUBSYSTEM. It delegates currentness to the
// canonical `isCurrentQuantityClaim` and all aggregate numbers to the canonical
// `readCurrentDrawingQuantities`. It adds only the project-relative question the
// existing reader cannot answer, and it creates no quantity authority of any
// kind: it reads claims and returns a verdict.

import {
  DRAWING_QUANTITY_AUTHORITY_VERSION,
  isCurrentQuantityClaim,
  readCurrentDrawingQuantities,
} from "./drawing-quantity-authority.mjs";
import {
  loadProjectExpectedScopeAuthority,
  SCOPE_DEFINITION_STATES,
} from "./drawing-quantity-expected-scope.mjs";

/**
 * Project-relative completeness. Deliberately NOT reusing the words
 * "Complete"/"Partial": those already mean claim-relative in
 * `COVERAGE_STATES`, and reusing them is exactly how the two get confused.
 */
export const PROJECT_QUANTITY_COMPLETENESS = Object.freeze({
  /** Every expected scope member has a current PROVEN governed quantity. */
  COMPLETE: "PROJECT_QUANTITY_SCOPE_COMPLETE",
  /** Scope is known, and at least one member has no current PROVEN quantity. */
  INCOMPLETE: "PROJECT_QUANTITY_SCOPE_INCOMPLETE",
  /** The system cannot establish the expected scope safely. Never Complete. */
  UNKNOWN_SCOPE: "PROJECT_QUANTITY_SCOPE_UNKNOWN",
});

/**
 * Per-member state. DISTINCT ON PURPOSE.
 *
 * `MISSING` (no current claim) is not the same as a member whose only claim is
 * CONFLICT or UNRESOLVED, and neither is a member whose claim is a reviewed
 * governed ZERO. A conflict has evidence but no authority; a missing location
 * has no evidence at all; a governed zero is real authority. Collapsing them
 * would let an engineer act on a conflict as though it were an absence.
 */
export const SCOPE_MEMBER_STATES = Object.freeze({
  PROVEN: "PROVEN",
  CONFLICT: "CONFLICT",
  UNRESOLVED: "UNRESOLVED",
  MISSING: "MISSING",
});

/** The default scope identity of a claim: the 0020 location-scoped `sheet`. */
const defaultClaimScopeKey = (claim) => claim?.sheet ?? null;
const defaultScopeKey = (member) => (typeof member === "string" ? member : member?.key ?? null);

const isUsable = (v) => v !== null && v !== undefined && String(v).trim() !== "";

/**
 * Project-scoped quantity coverage.
 *
 * @param input
 * @param input.claims               every quantity claim known, any state
 * @param input.currentDocumentVersions  { [document_id]: current_version_id }
 * @param input.expectedScope        GOVERNED expected scope members. REQUIRED for
 *                                   any completeness claim; absent => UNKNOWN_SCOPE.
 * @param input.claimScopeKeyOf      map a claim onto a scope member identity
 * @param input.scopeKeyOf           map a scope member onto its identity
 * @param input.deviceClass          optional class filter
 *
 * @returns a discriminated result. `downstreamReady` is true only for COMPLETE.
 */
export function readProjectScopedDrawingQuantityCoverage({
  claims = [],
  currentDocumentVersions = {},
  expectedScope = null,
  claimScopeKeyOf = defaultClaimScopeKey,
  scopeKeyOf = defaultScopeKey,
  deviceClass = null,
  // §10: scope-DEFINITION completeness is a different assertion from quantity
  // COVERAGE completeness. When governed scope authority is loaded, its
  // unresolved proposals are carried through here so the result can never say
  // the project's quantity scope is settled while proposals remain undecided.
  scopeDefinition = null,
} = {}) {
  const scopeMembers = (Array.isArray(expectedScope) ? expectedScope : [])
    .map(scopeKeyOf)
    .filter(isUsable)
    .map((k) => String(k).trim());

  // The canonical claim-relative numbers are returned UNCHANGED in every branch,
  // so a caller can still inspect what currently exists even when completeness
  // is unknowable. Read-only visibility must not be blocked by a safety gate.
  const claimRelative = readCurrentDrawingQuantities({ claims, currentDocumentVersions, deviceClass });

  // --- UNKNOWN_SCOPE: fail closed, never Complete ---------------------------
  if (scopeMembers.length === 0) {
    return {
      authorityVersion: DRAWING_QUANTITY_AUTHORITY_VERSION,
      completeness: PROJECT_QUANTITY_COMPLETENESS.UNKNOWN_SCOPE,
      complete: false,
      downstreamReady: false,
      expectedScopeKnown: false,
      expectedLocations: [],
      coveredLocations: [],
      missingLocations: [],
      members: [],
      // Kept explicit so a consumer that only reads totals still sees the
      // difference between "these claims are internally complete" and
      // "the project's scope is satisfied".
      coverageScope: "CLAIM_RELATIVE",
      claimRelative,
      quantityAuthorityCreated: false,
      // Same shape as the known-scope branch, so a consumer never has to branch
      // on which fields exist before asking what the scope-definition state is.
      quantityCoverageState: "QUANTITY_COVERAGE_UNKNOWN_SCOPE",
      scopeDefinitionState: scopeDefinition?.scopeDefinitionState ?? SCOPE_DEFINITION_STATES.UNKNOWN,
      approvedExpectedLocations: [],
      pendingScopeDecisions: scopeDefinition?.pendingScopeDecisions ?? [],
      reason: "No governed expected quantity scope is available, so project completeness cannot be established. "
        + "An unknown scope is never Complete: a partial set of internally-complete claims is indistinguishable from a complete project. "
        + "Approved expected-quantity scope authority is required to obtain a completeness verdict.",
    };
  }

  // --- currentness, via the canonical predicate (supersession included) -----
  //
  // `reviewStatusOf` is passed EXPLICITLY and is not optional. The canonical
  // predicate's default is `() => "Approved"`, which silently ignores the flat
  // `review_status` column on a persisted 0020 row -- only the nested
  // domain-shaped `review.status` is checked by default. Measured: a flat row
  // with review_status "Rejected" was counted in full. That is why the sibling
  // quantity->BOQ authority re-checks it explicitly at its own read/write
  // boundaries; this resolver does the same, so a Rejected or Needs Review claim
  // cannot satisfy expected coverage.
  const reviewStatusOf = (c) => c?.review_status
    ?? c?.review?.status
    ?? "Approved";

  const candidates = (Array.isArray(claims) ? claims : []).filter((c) =>
    isCurrentQuantityClaim(c, {
      currentDocumentVersionId: currentDocumentVersions[c?.document_id],
      reviewStatusOf,
    }),
  );
  const inClass = deviceClass ? candidates.filter((c) => c.device_class === deviceClass) : candidates;

  const byKey = new Map(scopeMembers.map((k) => [k, []]));
  const outOfScope = [];
  for (const claim of inClass) {
    const key = claimScopeKeyOf(claim);
    const bucket = key !== null && key !== undefined ? byKey.get(String(key).trim()) : undefined;
    if (bucket) bucket.push(claim);
    // A claim for a location nobody expected must NOT stand in for an expected
    // location that has none. It is reported, never substituted.
    else outOfScope.push({ key: key ?? null, documentId: claim.document_id ?? null, sheet: claim.sheet ?? null });
  }

  const sumProven = (list) => list
    .filter((c) => c.state === "PROVEN")
    .reduce((total, c) => total + (typeof c.quantity === "number" && Number.isFinite(c.quantity) ? c.quantity : 0), 0);

  const members = scopeMembers.map((key) => {
    const list = byKey.get(key) ?? [];
    const proven = list.filter((c) => c.state === "PROVEN");
    const conflicted = list.filter((c) => c.state === "CONFLICT");
    const unresolved = list.filter((c) => c.state === "UNRESOLVED");

    let state = SCOPE_MEMBER_STATES.MISSING;
    if (proven.length > 0) state = SCOPE_MEMBER_STATES.PROVEN;
    else if (conflicted.length > 0) state = SCOPE_MEMBER_STATES.CONFLICT;
    else if (unresolved.length > 0) state = SCOPE_MEMBER_STATES.UNRESOLVED;

    return {
      key,
      state,
      // Only PROVEN members carry a quantity. A member with no PROVEN claim
      // reports null, which is deliberately NOT zero: absence of evidence must
      // never be readable as a measured absence of devices.
      quantity: state === SCOPE_MEMBER_STATES.PROVEN ? sumProven(list) : null,
      currentClaimCount: list.length,
      documentIds: [...new Set(list.map((c) => c.document_id).filter(Boolean))],
      // Proven separately so an engineer can see WHICH state is blocking.
      counts: { proven: proven.length, conflicted: conflicted.length, unresolved: unresolved.length },
    };
  });

  const covered = members.filter((m) => m.state === SCOPE_MEMBER_STATES.PROVEN).map((m) => m.key);
  const missing = members.filter((m) => m.state !== SCOPE_MEMBER_STATES.PROVEN).map((m) => m.key);
  const quantityCoverageComplete = missing.length === 0;

  // Scope-definition state: is the SET OF EXPECTED LOCATIONS itself settled?
  // Absent authority we cannot know; with unresolved proposals we do not.
  const definition = scopeDefinition ?? { scopeDefinitionState: SCOPE_DEFINITION_STATES.UNKNOWN, pendingScopeDecisions: [], reason: null };
  const scopeDefinitionState = definition.scopeDefinitionState ?? SCOPE_DEFINITION_STATES.UNKNOWN;
  const pendingScopeDecisions = definition.pendingScopeDecisions ?? [];
  const scopeDefinitionComplete = scopeDefinitionState === SCOPE_DEFINITION_STATES.COMPLETE;

  return {
    authorityVersion: DRAWING_QUANTITY_AUTHORITY_VERSION,
    // Kept as the established field name so existing consumers of this result
    // keep working; it means QUANTITY COVERAGE only.
    completeness: quantityCoverageComplete
      ? PROJECT_QUANTITY_COMPLETENESS.COMPLETE
      : PROJECT_QUANTITY_COMPLETENESS.INCOMPLETE,
    complete: quantityCoverageComplete,

    // --- §10: the two completeness questions, answered separately ----------
    quantityCoverageState: quantityCoverageComplete
      ? "QUANTITY_COVERAGE_COMPLETE"
      : "QUANTITY_COVERAGE_INCOMPLETE",
    scopeDefinitionState,
    approvedExpectedLocations: scopeMembers,
    pendingScopeDecisions,

    // Fail closed for readiness, and it requires BOTH questions answered. Full
    // coverage of an unsettled scope is not readiness: more locations may still
    // be approved, and a consumer cannot see that from this result alone.
    downstreamReady: quantityCoverageComplete && scopeDefinitionComplete,
    expectedScopeKnown: true,
    expectedLocations: scopeMembers,
    coveredLocations: covered,
    missingLocations: missing,
    members,
    outOfScopeClaims: outOfScope,
    coverageScope: "PROJECT_RELATIVE",
    claimRelative,
    quantityAuthorityCreated: false,
    reason: !quantityCoverageComplete
      ? `${missing.length} of ${scopeMembers.length} expected locations have no current PROVEN governed quantity claim. `
        + "A missing location is not a zero and is never reported as one."
      : !scopeDefinitionComplete
        ? `All ${scopeMembers.length} approved expected locations have governed quantities, but ${pendingScopeDecisions.length} scope proposal(s) remain undecided. `
          + "Quantity coverage of the approved set is complete; the project's expected scope is not yet settled."
        : "Every expected location has a current PROVEN governed quantity claim, and no expected-scope proposal remains undecided.",
  };
}

/**
 * The production entry point: load the GOVERNED expected scope, then evaluate
 * project-scoped completeness against it.
 *
 * This exists so no caller has to hand-assemble an expected location list -- that
 * is how a hardcoded four-location list becomes an invisible assumption. When
 * the governed authority has no current Approved rows the resolver still runs and
 * still returns UNKNOWN_SCOPE, because an absent authority is not an empty scope.
 */
export async function readProjectScopedQuantityCoverageFromAuthority(db, {
  projectId,
  deviceClass,
  deviceVariant = null,
  claims = [],
  currentDocumentVersions = {},
} = {}) {
  const authority = await loadProjectExpectedScopeAuthority(db, {
    projectId,
    deviceClass,
    deviceVariant,
    currentDocumentVersions,
  });

  const result = readProjectScopedDrawingQuantityCoverage({
    claims,
    currentDocumentVersions,
    deviceClass,
    // Only the APPROVED locations are ever passed as expected scope. Pending
    // proposals are reported separately and never folded in.
    expectedScope: authority.approvedExpectedLocations,
    scopeDefinition: {
      scopeDefinitionState: authority.scopeDefinitionState,
      pendingScopeDecisions: authority.pendingScopeDecisions,
    },
  });

  return { ...result, scopeAuthority: authority };
}