/**
 * Governance tests for the drawing second-opinion claim layer.
 *
 * Each test names the invariant it defends. The interesting ones are the
 * mutation guards: if any of these can be made to pass by an edit that violates
 * the stated rule, the suite has stopped testing the rule.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  CLAIM_TYPES,
  RECONCILIATION_STATES,
  SECOND_OPINION_AUTHORITY,
  buildDrawingFactClaim,
  claimValueKey,
  reconcileClaimBatch,
  reconcileDrawingClaims,
  claimBatchBlockers,
} from "../app/domain/drawing-second-opinion-claims.mjs";

const PROJECT = "project_test";

function nativeClaim(overrides = {}) {
  return buildDrawingFactClaim({
    claimType: "DEVICE_QUANTITY",
    claimValue: "17",
    projectId: PROJECT,
    sheet: "SHEET-1",
    page: 1,
    bbox: { x: 10, y: 20, width: 30, height: 40 },
    nativeEvidence: ["17Nos."],
    ...overrides,
  });
}

function nvidiaClaim(overrides = {}) {
  return buildDrawingFactClaim({
    claimType: "DEVICE_QUANTITY",
    claimValue: "17",
    projectId: PROJECT,
    sheet: "SHEET-1",
    page: 1,
    nativeEvidence: null,
    nvidiaEvidence: ["17Nos."],
    confidence: 0.97,
    ...overrides,
  });
}

test("invariant: a claim retains project, sheet, page and bbox provenance", () => {
  const { ok, claim } = nativeClaim();
  assert.equal(ok, true);
  assert.equal(claim.project_id, PROJECT);
  assert.equal(claim.sheet, "SHEET-1");
  assert.equal(claim.page, 1);
  assert.deepEqual(claim.bbox, { x: 10, y: 20, width: 30, height: 40 });
});

test("invariant: evidence provenance is derived, not trusted from the caller", () => {
  // The caller claims BOTH but only supplied native evidence.
  const { claim } = nativeClaim({ evidence_sources: ["NATIVE", "NVIDIA"] });
  assert.deepEqual(claim.evidence_sources, ["NATIVE"]);

  const both = buildDrawingFactClaim({
    claimType: "DEVICE_QUANTITY",
    claimValue: "1",
    projectId: PROJECT,
    nativeEvidence: ["1No."],
    nvidiaEvidence: ["1No."],
  });
  assert.deepEqual(both.claim.evidence_sources, ["BOTH"]);

  const advisoryOnly = buildDrawingFactClaim({
    claimType: "DEVICE_QUANTITY",
    claimValue: "1",
    projectId: PROJECT,
    nvidiaEvidence: ["1No."],
  });
  assert.deepEqual(advisoryOnly.claim.evidence_sources, ["NVIDIA"]);
});

test("invariant: claim vocabulary is closed - an invented claim type is refused", () => {
  const result = buildDrawingFactClaim({
    claimType: "TOTALLY_MADE_UP_TYPE",
    claimValue: "x",
    projectId: PROJECT,
    nativeEvidence: ["x"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "UNRECOGNISED_CLAIM_TYPE");

  // And every advertised type is actually accepted.
  for (const claimType of CLAIM_TYPES) {
    const built = buildDrawingFactClaim({
      claimType,
      claimValue: "x",
      projectId: PROJECT,
      nativeEvidence: ["x"],
    });
    assert.equal(built.ok, true, `${claimType} should be accepted`);
  }
});

test("invariant: no claim may declare itself authoritative or approved", () => {
  for (const status of ["APPROVED", "AUTHORITATIVE", "GOVERNED", "PROMOTED", "accepted"]) {
    const result = buildDrawingFactClaim({
      claimType: "DEVICE_QUANTITY",
      claimValue: "17",
      projectId: PROJECT,
      nativeEvidence: ["17Nos."],
      status,
    });
    assert.equal(result.ok, false, `${status} must be refused`);
    assert.equal(result.error, "CLAIM_STATUS_NOT_PERMITTED");
  }

  // And every reconciled claim stays PROPOSED.
  const { claim } = nativeClaim();
  assert.equal(claim.status, "PROPOSED");
  assert.equal(claim.authority.AUTHORITATIVE_PARSER, "NATIVE_ONLY");
  assert.equal(claim.authority.NVIDIA_ROLE, "SHADOW_ONLY_ADVISORY");
});

test("invariant: a claim with no evidence from either side is refused", () => {
  const result = buildDrawingFactClaim({
    claimType: "DEVICE_QUANTITY",
    claimValue: "17",
    projectId: PROJECT,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "NO_EVIDENCE");
});

test("MUTATION GUARD: a duplicate reading on ONE sheet is NOT cross-sheet corroboration", () => {
  // Two identical native claims from the same sheet are one reading stated
  // twice. Treating them as corroboration would let a single sheet launder a
  // claim into a corroborated one.
  const result = reconcileClaimBatch([
    nativeClaim({ claimValue: "GRS~WLC", claimSubject: "link:GRS~WLC", sheet: "GRS" }).claim,
    nativeClaim({ claimValue: "GRS~WLC", claimSubject: "link:GRS~WLC", sheet: "GRS" }).claim,
  ]);
  assert.equal(result.entries[0].status, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.entries[0].reconciliation.basis, "NATIVE_ONLY_NOT_CORROBORATED");
});

test("invariant: independent native sheets agreeing IS corroboration, reported distinctly", () => {
  // The same link printed on two different sheets is genuine corroboration of
  // the drawing. It must be reported as corroborated, but under a native-only
  // basis so it is never mistaken for advisory corroboration.
  const result = reconcileClaimBatch([
    nativeClaim({ claimValue: "GRS~WLC", claimSubject: "link:GRS~WLC", sheet: "GRS" }).claim,
    nativeClaim({ claimValue: "GRS~WLC", claimSubject: "link:GRS~WLC", sheet: "WLC" }).claim,
  ]);
  const entry = result.entries[0];
  assert.equal(entry.status, "CORROBORATED");
  assert.equal(entry.reconciliation.basis, "NATIVE_CROSS_SHEET_AGREEMENT");
  assert.equal(entry.reconciliation.corroborating_sheets.length, 2);
  assert.equal(entry.reconciliation.nvidia_value, null);
  assert.match(entry.reconciliation.notes, /native evidence only/i);
});

test("MUTATION GUARD: native sheets DISAGREEING must be a conflict, not a merge", () => {
  const result = reconcileClaimBatch([
    nativeClaim({ claimValue: "GRS~WLC", claimSubject: "link:X", sheet: "GRS" }).claim,
    nativeClaim({ claimValue: "GRS~KGS", claimSubject: "link:X", sheet: "WLC" }).claim,
  ]);
  assert.equal(result.entries[0].status, "CONFLICT");
  assert.equal(result.entries[0].reconciliation.basis, "INTERNALLY_INCONSISTENT_EVIDENCE");
});

test("MUTATION GUARD: advisory-only evidence can NEVER corroborate, at any confidence", () => {
  // This is the load-bearing rule of the whole layer. Confidence must not matter.
  for (const confidence of [0.5, 0.9, 0.99, 1]) {
    const { claim } = nvidiaClaim({ confidence });
    const { reconciliation } = reconcileDrawingClaims({ nativeClaim: null, nvidiaClaim: claim });
    assert.equal(
      reconciliation.state,
      "INSUFFICIENT_EVIDENCE",
      `advisory-only must not corroborate even at confidence ${confidence}`,
    );
    assert.equal(reconciliation.basis, "ADVISORY_ONLY_CANNOT_CORROBORATE");
    assert.equal(reconciliation.status, "PROPOSED");
  }
});

test("MUTATION GUARD: disagreement is CONFLICT and both readings survive", () => {
  const n = nativeClaim({ claimValue: "17" }).claim;
  const a = nvidiaClaim({ claimValue: "17Nos", confidence: 1 }).claim;

  const { reconciliation } = reconcileDrawingClaims({ nativeClaim: n, nvidiaClaim: a });
  assert.equal(reconciliation.state, "CONFLICT");
  assert.equal(reconciliation.basis, "DISAGREING_VALUES");

  // Neither reading may be dropped.
  assert.deepEqual(reconciliation.retained_values, ["17", "17Nos"]);
  assert.equal(reconciliation.native_value, "17");
  assert.equal(reconciliation.nvidia_value, "17Nos");

  // Higher advisory confidence must not have decided it.
  assert.match(reconciliation.notes, /higher advisory confidence does NOT resolve/i);
});

test("MUTATION GUARD: a confident advisory claim cannot override native evidence", () => {
  // The adversarial case: advisory is very confident and very specific; native
  // says something different. The verdict must still be CONFLICT.
  const n = nativeClaim({ claimValue: "150" }).claim;
  const a = nvidiaClaim({
    claimValue: "100",
    confidence: 1,
    nvidiaEvidence: ["1OPNAN", "100"],
  }).claim;

  const { reconciliation } = reconcileDrawingClaims({ nativeClaim: n, nvidiaClaim: a });
  assert.equal(reconciliation.state, "CONFLICT");
  assert.equal(reconciliation.confidence, 1, "confidence is reported, never acted on");
});

test("invariant: agreeing evidence corroborates; differing support text only partly does", () => {
  const same = reconcileDrawingClaims({
    nativeClaim: nativeClaim().claim,
    nvidiaClaim: nvidiaClaim().claim,
  });
  assert.equal(same.reconciliation.state, "CORROBORATED");

  const partial = reconcileDrawingClaims({
    nativeClaim: nativeClaim({ nativeEvidence: ["17Nos.", "LEVEL 01"] }).claim,
    nvidiaClaim: nvidiaClaim({ nvidiaEvidence: ["17Nos."] }).claim,
  });
  assert.equal(partial.reconciliation.state, "PARTIALLY_CORROBORATED");
  assert.ok(partial.reconciliation.conflict_detail.some((d) => d.detail === "LEVEL 01"));
});

test("MUTATION GUARD: the known advisory mutations must not be normalised away", () => {
  // These are the specific corruptions the advisory layer is known to produce.
  // Case/whitespace differences may collapse; the mutations must NOT.
  assert.equal(claimValueKey("fire detection"), claimValueKey("FIRE   DETECTION"));

  const mutated = ["17(Cont'd)", "17 (Cont'", "I 7", "1/7", "L17"];
  for (const value of mutated) {
    assert.notEqual(claimValueKey(value), claimValueKey("17"), `"${value}" must not collapse to 17`);
  }
});

test("invariant: comparison is case and whitespace insensitive but nothing else", () => {
  assert.equal(claimValueKey("  Smoke   Detector "), claimValueKey("SMOKE DETECTOR"));
  assert.notEqual(claimValueKey("SMOKE DETECTOR"), claimValueKey("SMOKE-DETECTOR"));
  assert.notEqual(claimValueKey("SMOKE DETECTOR"), claimValueKey("SMOKE DETECTOR."));
});

test("invariant: malformed provenance is dropped rather than stored corrupt", () => {
  const { claim } = buildDrawingFactClaim({
    claimType: "DEVICE_QUANTITY",
    claimValue: "17",
    projectId: PROJECT,
    bbox: { x: 1, y: 2, width: 0, height: 5 },
    nativeEvidence: ["17Nos."],
  });
  assert.equal(claim.bbox, null, "a zero-width bbox must not be retained");
});

test("invariant: batch reconciliation is deterministic regardless of input order", () => {
  const claims = [
    nativeClaim({ claimValue: "17", claimSubject: "count@LEVEL 01", nativeEvidence: ["17Nos.", "A"] }).claim,
    nvidiaClaim({ claimValue: "17", claimSubject: "count@LEVEL 01", nvidiaEvidence: ["17Nos."] }).claim,
    nativeClaim({ claimValue: "4", claimSubject: "count@LEVEL 02", nativeEvidence: ["4Nos."] }).claim,
    nvidiaClaim({ claimValue: "4", claimSubject: "count@LEVEL 02", nvidiaEvidence: ["4Nos."] }).claim,
  ];
  const forward = reconcileClaimBatch(claims);
  const reversed = reconcileClaimBatch([...claims].reverse());
  assert.deepEqual(
    forward.entries.map((e) => [e.claim_type, e.claim_subject, e.status]),
    reversed.entries.map((e) => [e.claim_type, e.claim_subject, e.status]),
  );
  assert.equal(forward.summary.buckets, 2);
  // The first bucket has an extra native fragment ("A") the advisory side lacks,
  // so it is only PARTIALLY corroborated. The second agrees outright.
  assert.equal(forward.summary.partially_corroborated, 1);
  assert.equal(forward.summary.corroborated, 1);
  assert.equal(forward.summary.conflicts, 0);
});

test("MUTATION GUARD: same subject + different values MUST surface as CONFLICT", () => {
  // If batching keyed on VALUE instead of SUBJECT, these two would land in
  // separate buckets and the conflict would silently disappear.
  const conflict = reconcileClaimBatch([
    nativeClaim({ claimValue: "150", claimSubject: "detector_count@LEVEL 01" }).claim,
    nvidiaClaim({ claimValue: "100", claimSubject: "detector_count@LEVEL 01" }).claim,
  ]);
  assert.equal(conflict.entries.length, 1, "one subject, one bucket");
  assert.equal(conflict.summary.conflicts, 1);
  const entry = conflict.entries[0];
  assert.equal(entry.status, "CONFLICT");
  assert.equal(entry.reconciliation.basis, "DISAGREING_VALUES");
  // Both values survive the reconciliation.
  assert.deepEqual(entry.reconciliation.retained_values, ["150", "100"]);
});

test("MUTATION GUARD: one provenance reporting two values is an internal conflict", () => {
  // Native extraction is not automatically self-consistent either. Two native
  // claims about one subject with different values must not be silently merged.
  const result = reconcileClaimBatch([
    nativeClaim({ claimValue: "17", claimSubject: "count@X" }).claim,
    nativeClaim({ claimValue: "15", claimSubject: "count@X" }).claim,
  ]);
  assert.equal(result.entries[0].status, "CONFLICT");
  assert.equal(result.entries[0].reconciliation.basis, "INTERNALLY_INCONSISTENT_EVIDENCE");
});

test("invariant: blockers name exactly what is still unresolved", () => {
  const conflict = reconcileClaimBatch([
    nativeClaim({ claimValue: "17", claimSubject: "count@X" }).claim,
    nvidiaClaim({ claimValue: "100", claimSubject: "count@X" }).claim,
  ]);
  const blockers = claimBatchBlockers(conflict);
  assert.ok(blockers.includes("UNRESOLVED_CONFLICT:DEVICE_QUANTITY"));

  const advisoryOnly = reconcileClaimBatch([nvidiaClaim().claim]);
  const advisoryBlockers = claimBatchBlockers(advisoryOnly);
  assert.ok(advisoryBlockers.includes("ADVISORY_ONLY:DEVICE_QUANTITY"));
  assert.ok(advisoryBlockers.includes("NO_NATIVE_EVIDENCE_IN_BATCH"));

  const clean = reconcileClaimBatch([nativeClaim().claim, nvidiaClaim().claim]);
  assert.deepEqual(claimBatchBlockers(clean), []);
});

test("invariant: the reconciliation vocabulary is closed", () => {
  assert.deepEqual([...RECONCILIATION_STATES].sort(), [
    "CONFLICT",
    "CORROBORATED",
    "INSUFFICIENT_EVIDENCE",
    "PARTIALLY_CORROBORATED",
  ]);
  // No reconciliation verdict is ever an approval state.
  for (const state of RECONCILIATION_STATES) {
    assert.ok(!["APPROVED", "GOVERNED", "ACCEPTED"].includes(state));
  }
  assert.deepEqual(SECOND_OPINION_AUTHORITY.AUTHORITATIVE_PARSER, "NATIVE_ONLY");
});