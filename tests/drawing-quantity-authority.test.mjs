/**
 * FOCUSED TESTS — governed drawing quantity authority.
 *
 * Each test maps to one of the required proofs:
 *   A current document version + proven class  -> current authority returned
 *   B new source document version               -> old evidence no longer current
 *   C one unresolved class                      -> does NOT invalidate proven siblings
 *   D printed/component discrepancy             -> both retained, no normalisation
 *   E KGS basement 144 vs 57                    -> represented as a conflict
 *   F F solid and F dashed                      -> separately representable
 *   G unknown HC                                -> unresolved, never zero
 *   H rejected/superseded review                -> not current
 *
 * No database: the model is pure. Persistence is covered by the domain contract
 * and exercised through the canonical store in the integration path.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  COUNT_METHODS,
  COVERAGE_STATES,
  DRAWING_QUANTITY_AUTHORITY_VERSION,
  DEVICE_VARIANTS,
  QUANTITY_CLAIM_STATES,
  aggregateCoverage,
  buildQuantityClaim,
  isCurrentQuantityClaim,
  readCurrentDrawingQuantities,
} from "../app/domain/drawing-quantity-authority.mjs";

const PROJECT = "project_test_qty";
const DOC = "doc_grs";
const V1 = "ver_grs_001";
const V2 = "doc_grs_v2";

const proven = (over = {}) =>
  buildQuantityClaim({
    projectId: PROJECT,
    documentId: DOC,
    documentVersionId: V1,
    sheet: "GRS-93",
    page: 1,
    parserVersion: "fire-alarm-drawing-device-schedule-1.0.0",
    semanticsVersion: "fire-alarm-legend-class-semantics-1.0.0",
    deviceClass: "S",
    quantity: 65,
    countMethod: "COMPONENT_CELL_SUM",
    classMeaningGoverned: true,
    reviewStatus: "Approved",
    reviewedBy: "omair-primary",
    ...over,
  });

// --- A ---------------------------------------------------------------------

test("A: a current document version plus a proven class yields current authority", () => {
  const { ok, claim } = proven();
  assert.equal(ok, true);
  assert.equal(claim.state, "PROVEN");
  assert.equal(claim.coverage_state, "Complete");

  const read = readCurrentDrawingQuantities({
    claims: [claim],
    currentDocumentVersions: { [DOC]: V1 },
  });
  assert.equal(read.coverageState, "Complete");
  assert.equal(read.provenTotal, 65);
  assert.equal(read.proven["S::STANDARD"].quantity, 65);
  assert.equal(read.unresolved.length, 0);
});

// --- B ---------------------------------------------------------------------

test("B: revising the source drawing makes the old quantity evidence non-current", () => {
  const { claim } = proven();
  const stale = readCurrentDrawingQuantities({
    claims: [claim],
    currentDocumentVersions: { [DOC]: V2 }, // the document head has moved on
  });
  assert.equal(stale.claimCount, 0, "evidence bound to a superseded version must not be returned");
  assert.equal(stale.provenTotal, 0);
  assert.deepEqual(stale.proven, {});

  assert.equal(isCurrentQuantityClaim(claim, { currentDocumentVersionId: V2 }), false);
  assert.equal(isCurrentQuantityClaim(claim, { currentDocumentVersionId: V1 }), true);
});

test("B2: a claim with no document version binding is refused outright", () => {
  const r = proven({ documentVersionId: undefined });
  assert.equal(r.ok, false);
  assert.equal(r.error, "MISSING_DOCUMENT_VERSION");
});

// --- C ---------------------------------------------------------------------

test("C: one unresolved class does NOT invalidate an unrelated proven class", () => {
  const s = proven();
  assert.equal(s.ok, true);

  const hc = buildQuantityClaim({
    projectId: PROJECT,
    documentId: DOC,
    documentVersionId: V1,
    sheet: "GRS-93",
    deviceClass: "HC",
    quantity: null,
    countMethod: "COMPONENT_CELL_SUM",
    classMeaningGoverned: false,
    unresolvedReason: "Token confirmed on sheet; no project source defines it.",
  });
  assert.equal(hc.ok, true);
  assert.equal(hc.claim.state, "UNRESOLVED");

  const read = readCurrentDrawingQuantities({
    claims: [s.claim, hc.claim],
    currentDocumentVersions: { [DOC]: V1 },
  });
  assert.equal(read.coverageState, "Partial", "coverage is partial, NOT void");
  assert.equal(read.provenTotal, 65, "the proven sibling survives intact");
  assert.equal(read.unresolved.length, 1);
  assert.equal(read.counts.unresolved, 1);
});

// --- D ---------------------------------------------------------------------

test("D: a printed/component discrepancy retains BOTH values and normalises neither", () => {
  const { claim } = proven({
    quantity: 57,
    printedTotal: 144,
    componentTotal: 57,
  });
  assert.equal(claim.state, "CONFLICT");
  assert.equal(claim.printed_total, 144);
  assert.equal(claim.component_total, 57);
  assert.equal(claim.discrepancy.delta, 87);
  assert.equal(claim.coverage_state, "Partial");

  // A conflicted claim must not contribute to the authoritative total.
  const read = aggregateCoverage([claim]);
  assert.equal(read.provenTotal, 0, "a conflict must not be silently counted as proven");
  assert.equal(read.discrepancies.length, 1);
  assert.equal(read.discrepancies[0].printedTotal, 144);
  assert.equal(read.discrepancies[0].componentTotal, 57);
  assert.equal(read.discrepancies[0].delta, 87);
});

test("D2: the discrepancy delta is derived, so printed cannot be forced to equal component", () => {
  const { claim } = proven({ quantity: 10, printedTotal: 25, componentTotal: 10, discrepancy: { delta: 0 } });
  assert.equal(claim.discrepancy.delta, 15, "a caller-supplied delta of 0 must not win over the measurements");
  assert.equal(claim.state, "CONFLICT");
});

// --- E ---------------------------------------------------------------------

test("E: KGS basement 144 vs 57 is representable as a conflict without either winning", () => {
  const kgs = buildQuantityClaim({
    projectId: PROJECT,
    documentId: "doc_kgs",
    documentVersionId: "ver_kgs_001",
    sheet: "KGS-93",
    floorOrArea: "BASEMENT 01",
    deviceClass: "S",
    quantity: 57,
    countMethod: "PRINTED_ROW_TOTAL",
    printedTotal: 144,
    componentTotal: 57,
    classMeaningGoverned: true,
    reviewStatus: "Approved",
  });
  assert.equal(kgs.ok, true);
  assert.equal(kgs.claim.state, "CONFLICT");
  assert.equal(kgs.claim.printed_total, 144, "printed 144 is preserved");
  assert.equal(kgs.claim.component_total, 57, "component 57 is preserved");
  assert.equal(kgs.claim.quantity, 57, "the component value is the quantity; the conflict is carried alongside");

  const read = aggregateCoverage([kgs.claim]);
  const d = read.discrepancies[0];
  assert.equal(d.floorOrArea, "BASEMENT 01");
  assert.deepEqual([d.printedTotal, d.componentTotal, d.delta], [144, 57, 87]);
});

// --- F ---------------------------------------------------------------------

test("F: F standard and F weatherproof are separately representable despite one printed code", () => {
  const solid = proven({ deviceClass: "F", deviceVariant: "STANDARD", quantity: 4 });
  const dashed = proven({ deviceClass: "F", deviceVariant: "WEATHERPROOF", quantity: 4 });
  assert.equal(solid.ok, true);
  assert.equal(dashed.ok, true);

  const read = aggregateCoverage([solid.claim, dashed.claim]);
  assert.equal(read.proven["F::STANDARD"].quantity, 4, "the solid variant keeps its own count");
  assert.equal(read.proven["F::WEATHERPROOF"].quantity, 4, "the dashed variant keeps its own count");
  assert.notEqual(
    Object.keys(read.proven).filter((k) => k.startsWith("F::")).length,
    1,
    "the two variants must not collapse into one class",
  );
  assert.equal(read.provenTotal, 8, "both variants sum, because they are two real devices");
});

test("F2: an unknown variant is refused", () => {
  const r = proven({ deviceVariant: "HALF_DRAWN" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "INVALID_VARIANT");
});

// --- G ---------------------------------------------------------------------

test("G: an unknown class stays unresolved and is NEVER zero", () => {
  const hc = buildQuantityClaim({
    projectId: PROJECT,
    documentId: DOC,
    documentVersionId: V1,
    sheet: "BOS-93",
    deviceClass: "HC",
    quantity: null,
    countMethod: "PRINTED_CELL",
    classMeaningGoverned: false,
    unresolvedReason: "Token confirmed; meaning unresolved.",
  });
  assert.equal(hc.ok, true);
  assert.equal(hc.claim.quantity, null);
  assert.notEqual(hc.claim.quantity, 0, "unresolved must never be encoded as zero");

  const read = aggregateCoverage([hc.claim]);
  assert.equal(read.unresolved[0].quantity, null);
  assert.equal(read.provenTotal, 0);
});

test("G2: a governed class may not carry a quantity without a count method", () => {
  const r = proven({ countMethod: null });
  assert.equal(r.ok, false);
  assert.equal(r.error, "MISSING_COUNT_METHOD");
});

test("G3: an ungoverned class may NOT carry a quantity", () => {
  const r = buildQuantityClaim({
    projectId: PROJECT,
    documentVersionId: V1,
    deviceClass: "HC",
    quantity: 3,
    countMethod: "PRINTED_CELL",
    classMeaningGoverned: false,
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, "UNGOVERNED_CLASS_WITH_QUANTITY");
});

// --- H ---------------------------------------------------------------------

test("H: a rejected or superseded review is not returned as current authority", () => {
  const rejected = proven({ reviewStatus: "Rejected", reviewReason: "Evidence contradicted." });
  const superseded = proven({ reviewStatus: "Superseded" });

  for (const r of [rejected, superseded]) {
    assert.equal(r.ok, true);
    assert.equal(isCurrentQuantityClaim(r.claim, { currentDocumentVersionId: V1 }), false);
    const read = readCurrentDrawingQuantities({
      claims: [r.claim],
      currentDocumentVersions: { [DOC]: V1 },
    });
    assert.equal(read.claimCount, 0);
    assert.equal(read.provenTotal, 0);
  }
});

// --- model shape -----------------------------------------------------------

test("MUTATION GUARD: the model never exposes an SLC pool, address or resource field", () => {
  // Drawing quantity answers HOW MANY DEVICES. Address authority answers HOW MANY
  // ADDRESSES. If a pool or address field ever appears here the domains have merged.
  const banned = /address|slc|pool|loop|resource|panel_capacity/i;
  const { claim } = proven();
  for (const key of Object.keys(claim)) {
    assert.ok(!banned.test(key), `drawing quantity must not carry address/pool field "${key}"`);
  }
  assert.ok(!banned.test(JSON.stringify(readCurrentDrawingQuantities({ claims: [claim], currentDocumentVersions: { [DOC]: V1 } }))));
});

test("vocabularies are closed", () => {
  assert.deepEqual([...QUANTITY_CLAIM_STATES].sort(), ["CONFLICT", "PROVEN", "UNRESOLVED"]);
  assert.deepEqual([...COVERAGE_STATES].sort(), ["Complete", "No Evidence", "Partial", "Unresolved"]);
  assert.deepEqual([...DEVICE_VARIANTS].sort(), ["STANDARD", "WEATHERPROOF"]);
  assert.ok(COUNT_METHODS.includes("COMPONENT_CELL_SUM"));
  assert.ok(COUNT_METHODS.includes("PRINTED_ROW_TOTAL"));
});

test("every claim carries its authority version and provenance", () => {
  const { claim } = proven({ sourceRegion: { x: 1, y: 2, w: 3, h: 4 }, evidenceFingerprint: "fp_1" });
  assert.equal(claim.authority_version, DRAWING_QUANTITY_AUTHORITY_VERSION);
  assert.equal(claim.evidence_fingerprint, "fp_1");
  assert.deepEqual(claim.source_region, { x: 1, y: 2, w: 3, h: 4 });
  assert.equal(claim.review.reviewed_by, "omair-primary");
});

test("aggregation is deterministic and order-independent", () => {
  const a = proven({ deviceClass: "S", quantity: 65 });
  const b = proven({ deviceClass: "H", quantity: 41 });
  const forward = aggregateCoverage([a.claim, b.claim]);
  const reversed = aggregateCoverage([b.claim, a.claim]);
  assert.equal(forward.provenTotal, reversed.provenTotal);
  assert.deepEqual(Object.keys(forward.proven).sort(), Object.keys(reversed.proven).sort());
});