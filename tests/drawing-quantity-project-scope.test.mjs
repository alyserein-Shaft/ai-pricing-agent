// PROJECT-SCOPED DRAWING QUANTITY COMPLETENESS.
//
// Twelve proofs that the project can no longer treat a partial set of governed
// drawing quantities as complete merely because every existing claim is
// internally complete.
//
// All fixtures are in-memory and controlled. No live claim is written, no Vision
// is run, no proposal is created, no reviewer acts, and the four location labels
// below are TEST DATA supplied through the explicit `expectedScope` input -- they
// are never hardcoded into production logic.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  readCurrentDrawingQuantities,
  readCurrentDrawingQuantityAuthority,
  isCurrentQuantityClaim,
  DRAWING_QUANTITY_AUTHORITY_STATES,
} from "../app/domain/drawing-quantity-authority.mjs";
import {
  readProjectScopedDrawingQuantityCoverage,
  PROJECT_QUANTITY_COMPLETENESS,
  SCOPE_MEMBER_STATES,
} from "../app/domain/drawing-quantity-project-scope.mjs";
import { SCOPE_DEFINITION_STATES } from "../app/domain/drawing-quantity-expected-scope.mjs";

const LOCATIONS = ["BOS", "GRS", "KGS", "WLC"];
const sheetOf = (loc) => `2401232-PC-${loc}-DR-T-93-ZZZ-005`;

/** The governed expected scope a caller would supply for this project. */
const scope = () => LOCATIONS.map(sheetOf);

/**
 * A current, Approved, PROVEN claim row in the shape the 0020 readers consume
 * (flat snake_case, as persisted).
 */
const claim = (loc, quantity, over = {}) => ({
  id: `c-${loc}-${quantity}`,
  project_id: "p1",
  document_id: `doc-${loc}`,
  document_version_id: `ver-${loc}`,
  sheet: sheetOf(loc),
  floor_or_area: null,
  device_class: "T",
  device_variant: "STANDARD",
  quantity_type: "PHYSICAL_DEVICE",
  quantity,
  count_method: "PRINTED_CELL",
  printed_total: quantity,
  component_total: null,
  state: "PROVEN",
  review_status: "Approved",
  source_asset_ids: [`asset-${loc}`],
  superseded_at: null,
  version_number: 1,
  ...over,
});

const versions = (locs = LOCATIONS) =>
  Object.fromEntries(locs.map((l) => [`doc-${l}`, `ver-${l}`]));

const project = (claims, over = {}) => readProjectScopedDrawingQuantityCoverage({
  claims,
  currentDocumentVersions: versions(),
  expectedScope: scope(),
  ...over,
});

// ---- 1. the claim-relative reader keeps its existing behaviour -------------

test("1. claim-relative behaviour is retained where intentionally kept", () => {
  // Three internally-complete claims with no scope knowledge: the legacy reader
  // still reports Complete, exactly as before. This compatibility is deliberate
  // and is why the new result is a separate, explicitly-named projection.
  const legacy = readCurrentDrawingQuantities({
    claims: [claim("BOS", 25), claim("GRS", 25), claim("KGS", 23)],
    currentDocumentVersions: versions(),
  });
  assert.equal(legacy.coverageState, "Complete");
  assert.equal(legacy.provenTotal, 73);

  // The project-scoped projection of the SAME claim set disagrees, and says why.
  const scoped = project([claim("BOS", 25), claim("GRS", 25), claim("KGS", 23)]);
  assert.equal(scoped.completeness, PROJECT_QUANTITY_COMPLETENESS.INCOMPLETE);
  assert.notEqual(scoped.completeness, legacy.coverageState, "the two must not be confusable");

  // And the legacy reader still carries the additive safety marker.
  const authority = readCurrentDrawingQuantityAuthority({
    claims: [claim("BOS", 25), claim("GRS", 25), claim("KGS", 23)],
    currentDocumentVersions: versions(),
  });
  assert.equal(authority.state, DRAWING_QUANTITY_AUTHORITY_STATES.READY);
  assert.equal(authority.ready, true);
  assert.equal(authority.coverageScope, "CLAIM_RELATIVE");
  assert.equal(authority.projectCoverageComplete, false);
  assert.match(authority.projectCoverageReason, /readProjectScopedDrawingQuantityCoverage/);
});

// ---- 2. 4/4 -> COMPLETE ----------------------------------------------------

test("2. four of four expected locations is COMPLETE", () => {
  const r = project([claim("BOS", 25), claim("GRS", 25), claim("KGS", 23), claim("WLC", 12)]);
  assert.equal(r.completeness, PROJECT_QUANTITY_COMPLETENESS.COMPLETE);
  assert.equal(r.complete, true);
  assert.deepEqual(r.missingLocations, []);
  assert.deepEqual(r.coveredLocations.sort(), scope().sort());
  // The aggregate 25+25+23+12 = 85 is consumed from the CANONICAL reader, not recomputed.
  assert.equal(r.claimRelative.provenTotal, 85);
  assert.equal(r.claimRelative.proven["T::STANDARD"].quantity, 85);

  // CONTRACT TIGHTENED by the expected-scope authority slice: quantity coverage
  // and scope-DEFINITION completeness are different assertions, and readiness now
  // requires BOTH. A caller supplying only a bare expected list has not said
  // whether any expected-scope proposal is still undecided, so its scope
  // definition is UNKNOWN and it cannot be "ready" -- while quantity coverage is
  // still honestly reported COMPLETE above.
  assert.equal(r.quantityCoverageState, "QUANTITY_COVERAGE_COMPLETE");
  assert.equal(r.scopeDefinitionState, SCOPE_DEFINITION_STATES.UNKNOWN);
  assert.equal(r.downstreamReady, false, "an unknown scope definition is not readiness");

  // With a governed, settled scope definition, readiness follows.
  const settled = project(
    [claim("BOS", 25), claim("GRS", 25), claim("KGS", 23), claim("WLC", 12)],
    { scopeDefinition: { scopeDefinitionState: SCOPE_DEFINITION_STATES.COMPLETE, pendingScopeDecisions: [] } },
  );
  assert.equal(settled.downstreamReady, true);

  // And an unresolved proposal withholds readiness even at full quantity coverage.
  const pending = project(
    [claim("BOS", 25), claim("GRS", 25), claim("KGS", 23), claim("WLC", 12)],
    { scopeDefinition: { scopeDefinitionState: SCOPE_DEFINITION_STATES.PENDING, pendingScopeDecisions: [{ id: "p1", sheet: "extra" }] } },
  );
  assert.equal(pending.quantityCoverageState, "QUANTITY_COVERAGE_COMPLETE");
  assert.equal(pending.scopeDefinitionState, SCOPE_DEFINITION_STATES.PENDING);
  assert.equal(pending.downstreamReady, false, "coverage of an unsettled scope is not readiness");
  assert.equal(pending.pendingScopeDecisions.length, 1);
});

// ---- 3. 3/4 -> INCOMPLETE, missing WLC ------------------------------------

test("3. three of four is INCOMPLETE with WLC missing", () => {
  const r = project([claim("BOS", 25), claim("GRS", 25), claim("KGS", 23)]);
  assert.equal(r.completeness, PROJECT_QUANTITY_COMPLETENESS.INCOMPLETE);
  assert.equal(r.complete, false);
  assert.equal(r.downstreamReady, false);
  assert.deepEqual(r.missingLocations, [sheetOf("WLC")]);

  // THE DEFECT THIS CLOSES: the claim-relative reader alone says "Complete" here.
  const legacy = readCurrentDrawingQuantities({
    claims: [claim("BOS", 25), claim("GRS", 25), claim("KGS", 23)],
    currentDocumentVersions: versions(),
  });
  assert.equal(legacy.coverageState, "Complete", "the old defect is still visible on the legacy reader");
  assert.equal(r.claimRelative.coverageState, "Complete", "and is surfaced, not hidden, on the projection");
  assert.equal(r.complete, false, "but it can no longer be mistaken for project completeness");
});

// ---- 4. 1/4 -> INCOMPLETE -------------------------------------------------

test("4. one of four is INCOMPLETE", () => {
  const r = project([claim("WLC", 12)]);
  assert.equal(r.completeness, PROJECT_QUANTITY_COMPLETENESS.INCOMPLETE);
  assert.deepEqual(r.missingLocations.sort(), [sheetOf("BOS"), sheetOf("GRS"), sheetOf("KGS")]);
  assert.deepEqual(r.coveredLocations, [sheetOf("WLC")]);
  assert.equal(r.claimRelative.provenTotal, 12);
});

// ---- 5. 0/4 -> INCOMPLETE when scope is known ----------------------------

test("5. zero of four is INCOMPLETE when the expected scope is known", () => {
  const r = project([]);
  assert.equal(r.completeness, PROJECT_QUANTITY_COMPLETENESS.INCOMPLETE);
  assert.equal(r.complete, false);
  assert.equal(r.downstreamReady, false);
  assert.equal(r.coveredLocations.length, 0);
  assert.deepEqual(r.missingLocations.sort(), scope().sort());
  assert.match(r.reason, /4 of 4/);
});

// ---- 6. unknown expected scope -> UNKNOWN_SCOPE, never Complete -----------

test("6. unknown expected scope is UNKNOWN_SCOPE and never COMPLETE", () => {
  const claims = [claim("BOS", 25), claim("GRS", 25), claim("KGS", 23), claim("WLC", 12)];
  for (const absent of [null, undefined, [], "not-an-array", ["", "  ", null]]) {
    const r = readProjectScopedDrawingQuantityCoverage({
      claims,
      currentDocumentVersions: versions(),
      expectedScope: absent,
    });
    assert.equal(r.completeness, PROJECT_QUANTITY_COMPLETENESS.UNKNOWN_SCOPE, `scope=${JSON.stringify(absent)}`);
    assert.equal(r.complete, false);
    assert.equal(r.downstreamReady, false);
    assert.equal(r.expectedScopeKnown, false);
  }

  // Even with all four claims present and internally perfect, unknown scope is
  // NOT Complete. This is the fail-closed requirement.
  const unknown = readProjectScopedDrawingQuantityCoverage({
    claims, currentDocumentVersions: versions(), expectedScope: null,
  });
  assert.equal(unknown.claimRelative.provenTotal, 85, "the numbers remain inspectable");
  assert.notEqual(unknown.completeness, PROJECT_QUANTITY_COMPLETENESS.COMPLETE);
  assert.match(unknown.reason, /never Complete/i);
});

// ---- 7. governed zero counts as present -----------------------------------

test("7. a governed zero is present, not missing", () => {
  const r = project([claim("BOS", 25), claim("GRS", 25), claim("KGS", 23), claim("WLC", 0)]);
  assert.equal(r.completeness, PROJECT_QUANTITY_COMPLETENESS.COMPLETE, "a reviewed zero satisfies its location");
  assert.deepEqual(r.missingLocations, []);
  const wlc = r.members.find((m) => m.key === sheetOf("WLC"));
  assert.equal(wlc.state, SCOPE_MEMBER_STATES.PROVEN);
  assert.equal(wlc.quantity, 0, "zero is a real governed quantity");
  assert.equal(r.claimRelative.provenTotal, 73);
});

// ---- 8. a missing claim never becomes zero -------------------------------

test("8. a missing claim is null, never zero", () => {
  const r = project([claim("BOS", 25), claim("GRS", 25), claim("KGS", 23)]);
  const wlc = r.members.find((m) => m.key === sheetOf("WLC"));
  assert.equal(wlc.state, SCOPE_MEMBER_STATES.MISSING);
  assert.equal(wlc.quantity, null, "absent evidence must not be readable as zero devices");
  assert.notEqual(wlc.quantity, 0);
  assert.equal(wlc.currentClaimCount, 0);

  // Requesting only the missing location yields an empty scope, not a zero total.
  const only = project([claim("BOS", 25)], { expectedScope: [sheetOf("WLC")] });
  assert.deepEqual(only.members.map((m) => [m.state, m.quantity]), [["MISSING", null]]);
  // `claimRelative` is the canonical reader over the claims supplied, NOT
  // re-scoped to the expected scope: filtering it would redefine a shared reader.
  // So it still totals BOS. The scoped answer lives in `members`, which is null.
  assert.equal(only.claimRelative.provenTotal, 25);
  assert.equal(only.complete, false);

  // GOVERNED ZERO != MISSING CLAIM
  const zeroed = project([claim("BOS", 25), claim("GRS", 25), claim("KGS", 23), claim("WLC", 0)]);
  const zeroMember = zeroed.members.find((m) => m.key === sheetOf("WLC"));
  const missingMember = r.members.find((m) => m.key === sheetOf("WLC"));
  assert.equal(zeroMember.state, SCOPE_MEMBER_STATES.PROVEN);
  assert.equal(missingMember.state, SCOPE_MEMBER_STATES.MISSING);
  assert.notEqual(zeroMember.state, missingMember.state);
  assert.notEqual(zeroMember.quantity, missingMember.quantity);
});

// ---- 9. superseded claims do not satisfy coverage -------------------------

test("9. a superseded claim does not satisfy current coverage", () => {
  // WLC has a reviewed claim that was then superseded by a revision.
  const superseded = claim("WLC", 12, { id: "c-WLC-v1", version_number: 1, superseded_at: "2026-10-01T00:00:00.000Z" });

  assert.equal(isCurrentQuantityClaim(superseded, { currentDocumentVersionId: "ver-WLC" }), false);

  const r = project([claim("BOS", 25), claim("GRS", 25), claim("KGS", 23), superseded]);
  assert.equal(r.completeness, PROJECT_QUANTITY_COMPLETENESS.INCOMPLETE, "superseded history does not cover WLC");
  assert.deepEqual(r.missingLocations, [sheetOf("WLC")]);
  assert.equal(r.claimRelative.provenTotal, 73, "a superseded quantity is not in any total");

  // A second, independent defect this closes: two versions of one identity were
  // BOTH aggregated before the supersession clause was added to the canonical
  // predicate. Verified numerically, not asserted.
  const both = [superseded, claim("WLC", 99, { id: "c-WLC-v2", version_number: 2 })];
  const agg = readCurrentDrawingQuantities({ claims: both, currentDocumentVersions: versions() });
  assert.equal(agg.provenTotal, 99, "only the current version contributes; 12 + 99 is not summed");
  assert.equal(agg.counts.proven, 1);
});

// ---- 10. an extra unrelated location cannot substitute --------------------

test("10. an unrelated location cannot substitute for a missing expected one", () => {
  const stray = claim("X99", 500, { document_id: "doc-X99", document_version_id: "ver-X99" });
  const r = project([claim("BOS", 25), claim("GRS", 25), claim("KGS", 23), stray], {
    currentDocumentVersions: { ...versions(), "doc-X99": "ver-X99" },
  });
  assert.equal(r.completeness, PROJECT_QUANTITY_COMPLETENESS.INCOMPLETE);
  assert.deepEqual(r.missingLocations, [sheetOf("WLC")], "WLC is still missing");
  assert.equal(r.outOfScopeClaims.length, 1);
  assert.equal(r.outOfScopeClaims[0].key, sheetOf("X99"));
  assert.equal(r.coveredLocations.includes(sheetOf("X99")), false);
  // The stray quantity is visible but never counted as expected coverage.
  assert.equal(r.claimRelative.provenTotal, 573, "25+25+23+500 -- the stray is visible, never as coverage");
});

// ---- 11. downstream readiness cannot treat 3/4 as complete ----------------

test("11. downstream readiness fails closed on a partial set", () => {
  const partial = [claim("BOS", 25), claim("GRS", 25), claim("KGS", 23)];

  // The field downstream must gate on.
  assert.equal(project(partial).downstreamReady, false);

  // The canonical claim-relative reader alone would have let it through; the
  // additive marker on its READY branch says so explicitly.
  const authority = readCurrentDrawingQuantityAuthority({
    claims: partial,
    currentDocumentVersions: versions(),
  });
  assert.equal(authority.ready, true, "claim-relative readiness is intentionally unchanged");
  assert.equal(authority.coverageScope, "CLAIM_RELATIVE");
  assert.equal(authority.projectCoverageComplete, false, "but it can never be read as project completeness");
  assert.match(authority.projectCoverageReason, /cannot assert project completeness/);

  // Read-only inspection is NOT blocked by the gate.
  const scoped = project(partial);
  assert.equal(scoped.claimRelative.provenTotal, 73, "engineers can still see what exists");
  assert.equal(Object.keys(scoped.claimRelative.proven).length, 1);
  assert.equal(scoped.members.filter((m) => m.state === SCOPE_MEMBER_STATES.PROVEN).length, 3);
});

// ---- 12. the resolver creates no quantity authority ------------------------

test("12. the completeness resolver creates no quantity authority", () => {
  const claims = [claim("BOS", 25), claim("GRS", 25), claim("KGS", 23), claim("WLC", 12)];
  const snapshot = JSON.stringify(claims);

  const r = project(claims);

  // Pure: inputs are not mutated, nothing is created, nothing is derived from it.
  assert.equal(JSON.stringify(claims), snapshot, "input claims are untouched");
  assert.equal(r.quantityAuthorityCreated, false);
  assert.equal(claims.length, 4, "no claim was added");

  // The result carries no persistable claim: no id/version/fingerprint, and no
  // quantity source of its own -- every quantity traces to a supplied claim.
  assert.equal("evidence_fingerprint" in r, false);
  const ids = new Set(r.members.flatMap((m) => m.documentIds));
  assert.ok(ids.size <= 4);

  // Every reported quantity is attributable to a real supplied claim.
  for (const member of r.members) {
    if (member.state === SCOPE_MEMBER_STATES.PROVEN) {
      const source = claims.filter((c) => c.sheet === member.key && c.state === "PROVEN");
      assert.equal(member.quantity, source.reduce((t, c) => t + c.quantity, 0));
    } else {
      assert.equal(member.quantity, null);
    }
  }

  // No DB handle exists in its signature: it cannot write.
  const src = readFileSync(new URL("../app/domain/drawing-quantity-project-scope.mjs", import.meta.url), "utf8");
  assert.equal(/\bprepare\(|\bbatch\(|\bexec\(|\.run\(\)/.test(src), false, "the resolver performs no SQL");
});

// ---- supporting invariants -------------------------------------------------

test("a conflict is distinguishable from a missing location", () => {
  const conflicted = claim("WLC", 12, { state: "CONFLICT", printed_total: 12, component_total: 10 });
  const r = project([claim("BOS", 25), claim("GRS", 25), claim("KGS", 23), conflicted]);
  const wlc = r.members.find((m) => m.key === sheetOf("WLC"));
  assert.equal(wlc.state, SCOPE_MEMBER_STATES.CONFLICT, "there IS evidence, it just is not authoritative");
  assert.equal(wlc.quantity, null);
  assert.equal(wlc.counts.conflicted, 1);
  // It is listed among the unmet members because it does not satisfy coverage,
  // but its state tells the engineer WHY, which MISSING would not.
  assert.deepEqual(r.missingLocations, [sheetOf("WLC")]);
  assert.equal(r.completeness, PROJECT_QUANTITY_COMPLETENESS.INCOMPLETE);
});

test("an unresolved class is distinguishable from a missing location", () => {
  const unresolved = claim("WLC", 12, { state: "UNRESOLVED", quantity: null, device_class: "SIM" });
  const r = project([claim("BOS", 25), claim("GRS", 25), claim("KGS", 23), unresolved]);
  const wlc = r.members.find((m) => m.key === sheetOf("WLC"));
  assert.equal(wlc.state, SCOPE_MEMBER_STATES.UNRESOLVED);
  assert.equal(wlc.quantity, null);
  assert.equal(r.completeness, PROJECT_QUANTITY_COMPLETENESS.INCOMPLETE);
});

test("an unapproved or rejected claim does not satisfy coverage", () => {
  for (const review_status of ["Rejected", "Needs Review"]) {
    const r = project([
      claim("BOS", 25), claim("GRS", 25), claim("KGS", 23),
      claim("WLC", 12, { review_status }),
    ]);
    assert.equal(r.completeness, PROJECT_QUANTITY_COMPLETENESS.INCOMPLETE, review_status);
    assert.deepEqual(r.missingLocations, [sheetOf("WLC")], review_status);
  }
});

test("a claim on a superseded document version does not satisfy coverage", () => {
  // WLC's evidence belongs to ver-WLC but the document head moved to ver-WLC-2.
  const r = readProjectScopedDrawingQuantityCoverage({
    claims: [claim("BOS", 25), claim("GRS", 25), claim("KGS", 23), claim("WLC", 12)],
    currentDocumentVersions: { ...versions(), "doc-WLC": "ver-WLC-2" },
    expectedScope: scope(),
  });
  assert.equal(r.completeness, PROJECT_QUANTITY_COMPLETENESS.INCOMPLETE);
  assert.deepEqual(r.missingLocations, [sheetOf("WLC")]);
});

test("the result is deterministic and order-independent", () => {
  const claims = [claim("WLC", 12), claim("BOS", 25), claim("GRS", 25), claim("KGS", 23)];
  const forward = project(claims);
  const reversed = project([...claims].reverse());
  assert.equal(forward.completeness, reversed.completeness);
  assert.deepEqual(forward.members, reversed.members);
  assert.equal(forward.claimRelative.provenTotal, reversed.claimRelative.provenTotal);
});

test("an explicit scope identity mapping is honoured without inventing one", () => {
  // A caller whose own registry uses richer members can map them onto claim
  // sheets itself. The resolver never guesses that mapping.
  const registryMembers = [
    { key: "LOC-BOS", sheet: sheetOf("BOS") },
    { key: "LOC-WLC", sheet: sheetOf("WLC") },
  ];
  const r = readProjectScopedDrawingQuantityCoverage({
    claims: [claim("BOS", 25), claim("WLC", 12)],
    currentDocumentVersions: versions(),
    expectedScope: registryMembers,
    scopeKeyOf: (m) => m?.key ?? null,
    claimScopeKeyOf: (c) => registryMembers.find((m) => m.sheet === c.sheet)?.key ?? null,
  });
  assert.equal(r.completeness, PROJECT_QUANTITY_COMPLETENESS.COMPLETE);
  assert.deepEqual(r.coveredLocations.sort(), ["LOC-BOS", "LOC-WLC"]);
});