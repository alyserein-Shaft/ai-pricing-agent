// DRAWING QUANTITY AUTHORITY — currentness fingerprint + canonical read
//
// Focus: the two properties the currentness model depends on and that could not
// previously be proven at all, because `evidence_fingerprint` was a field a
// producer SET rather than one anything DERIVED:
//
//   A. identical authorities always yield the identical fingerprint;
//   B. a change in any governing authority moves it;
//   ...and, equally load-bearing, that a change in ANY DOWNSTREAM concern leaves
//   it byte-identical, so resource classification or panel allocation can never
//   invalidate a physical drawing count.
//
// Plus the canonical downstream read and its fail-closed behaviour (§17).
//
// Run: node --test tests/drawing-quantity-authority-currentness.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import {
  DRAWING_QUANTITY_AUTHORITY_STATES,
  QUANTITY_FINGERPRINT_KEYS,
  buildQuantityClaim,
  computeQuantityAuthorityFingerprint,
  isFingerprintCurrent,
  readCurrentDrawingQuantityAuthority,
} from "../app/domain/drawing-quantity-authority.mjs";

const DOC = "doc_drawing_1";
const VER = "ver_1";
const HEAD = "ver_1";

const claim = (overrides = {}) =>
  buildQuantityClaim({
    projectId: "project_ae501b85",
    documentId: DOC,
    documentVersionId: VER,
    sheet: "2401232- PC- BOS- DR- T-93-ZZZ-005",
    page: 1,
    parserVersion: "drawing-intake-1.1.0",
    semanticsVersion: "drawing-semantics-rev2",
    deviceClass: "FIREMAN TELEPHONE JACK",
    deviceVariant: "STANDARD",
    quantityType: "PHYSICAL_DEVICE",
    quantity: 25,
    countMethod: "COMPONENT_CELL_SUM",
    classMeaningGoverned: true,
    reviewStatus: "Approved",
    ...overrides,
  }).claim;

const fp = (c) => computeQuantityAuthorityFingerprint(c);

// ---------------------------------------------------------------------------
// REQUIRED MUTATION TEST A -- determinism
// ---------------------------------------------------------------------------

test("A -- same drawing source + same semantics + same count logic => IDENTICAL authority fingerprint", () => {
  const a = fp(claim());
  const b = fp(claim());
  assert.equal(a, b, "two independently built identical claims must fingerprint identically");
  // Field ORDER in the input must not matter.
  const reordered = buildQuantityClaim({
    reviewStatus: "Approved",
    classMeaningGoverned: true,
    countMethod: "COMPONENT_CELL_SUM",
    quantity: 25,
    deviceClass: "FIREMAN TELEPHONE JACK",
    deviceVariant: "STANDARD",
    quantityType: "PHYSICAL_DEVICE",
    semanticsVersion: "drawing-semantics-rev2",
    parserVersion: "drawing-intake-1.1.0",
    page: 1,
    sheet: "2401232- PC- BOS- DR- T-93-ZZZ-005",
    documentVersionId: VER,
    documentId: DOC,
    projectId: "project_ae501b85",
  }).claim;
  assert.equal(fp(reordered), a, "input key order must not affect the fingerprint");
  // SOURCE ASSET ORDER is not authority, so it must not move the fingerprint.
  const withAssets = claim({ sourceAssetIds: ["asset_b", "asset_a"] });
  const withAssetsSorted = claim({ sourceAssetIds: ["asset_a", "asset_b"] });
  assert.equal(fp(withAssets), fp(withAssetsSorted));
});

// ---------------------------------------------------------------------------
// REQUIRED MUTATION TEST B -- drawing revision / source fingerprint moves it
// ---------------------------------------------------------------------------

test("B -- a drawing revision or source fingerprint change => the authority fingerprint CHANGES", () => {
  const base = fp(claim());
  assert.notEqual(fp(claim({ documentVersionId: "ver_2" })), base, "a new document version must move it");
  assert.notEqual(fp(claim({ parserVersion: "drawing-intake-1.2.0" })), base, "a new parser/extraction rule must move it");
  assert.notEqual(fp(claim({ sheet: "2401232- PC- GRS- DR- T-93-ZZZ-005" })), base, "a different sheet is different evidence");
  assert.notEqual(fp(claim({ page: 2 })), base, "a different page is different evidence");
  assert.notEqual(fp(claim({ sourceRegion: [0, 0, 10, 10] })), base, "a different source region must move it");
  assert.notEqual(fp(claim({ sourceAssetIds: ["asset_x"] })), base, "different source assets must move it");
});

// ---------------------------------------------------------------------------
// REQUIRED MUTATION TEST C -- semantic authority changes
// ---------------------------------------------------------------------------

test("C -- a semantic authority / count-derivation change => the fingerprint CHANGES", () => {
  const base = fp(claim());
  assert.notEqual(fp(claim({ semanticsVersion: "drawing-semantics-rev3" })), base, "a new semantic authority version must move it");
  assert.notEqual(fp(claim({ deviceClass: "SMOKE DETECTOR" })), base, "a different governed class must move it");
  assert.notEqual(fp(claim({ deviceVariant: "WEATHERPROOF" })), base, "F standard and F weatherproof are different quantity identities");
  assert.notEqual(fp(claim({ countMethod: "PRINTED_CELL" })), base, "a different count derivation must move it");
  // The quantity itself is part of the authority, so a corrected count moves it.
  assert.notEqual(fp(claim({ quantity: 26 })), base);
});

// ---------------------------------------------------------------------------
// REQUIRED MUTATION TEST D -- raw recognition count
// ---------------------------------------------------------------------------

test("D -- a raw recognition-count change moves the fingerprint ONLY when the derivation consumes it", () => {
  // A claim carries a QUANTITY, not a recognition count. So a change to the
  // recognised-occurrence set that does not alter the derived quantity leaves the
  // quantity authority untouched...
  const derivedFromSymbolSum = claim({ quantity: 25, countMethod: "COMPONENT_CELL_SUM" });
  assert.equal(fp(derivedFromSymbolSum), fp(claim({ quantity: 25, countMethod: "COMPONENT_CELL_SUM" })));
  // ...and a change that DOES alter the derived quantity moves it, because the
  // derivation consumed that occurrence set.
  assert.notEqual(fp(derivedFromSymbolSum), fp(claim({ quantity: 26, countMethod: "COMPONENT_CELL_SUM" })));
  // Printed and component totals are both part of the authority: a reconciliation
  // change must be visible.
  assert.notEqual(fp(claim({ printedTotal: 12 })), fp(claim({ printedTotal: 6 })));
});

// ---------------------------------------------------------------------------
// REQUIRED MUTATION TESTS E + F -- downstream MUST NOT invalidate
// ---------------------------------------------------------------------------

test("E -- a RESOURCE CLASSIFICATION change does NOT change the physical quantity fingerprint", () => {
  const base = claim();
  const before = fp(base);
  // Resource classification is Agent 3's domain and exists on NO field here.
  // Whatever a downstream consumer attaches to its own model, the quantity
  // authority's own content is unchanged.
  const withClassifierNoise = { ...base, resource_class: "MODULE", slc_addresses: 1, detector_pool: 159, module_pool: 159 };
  assert.equal(fp(withClassifierNoise), before, "downstream classification fields must not enter the fingerprint");
  assert.equal(isFingerprintCurrent(withClassifierNoise), true);
  // The model has no such fields to begin with.
  for (const field of ["slc_resource_class", "addresses", "detector_pool", "module_pool", "address_demand"]) {
    assert.equal(field in base, false, `${field} must not exist on a quantity claim`);
  }
});

test("F -- a PANEL ALLOCATION / SIZING / SELECTION / PRICE change does NOT change the fingerprint", () => {
  const base = claim();
  const before = fp(base);
  const downstream = {
    ...base,
    panel_allocation: { panel: "IFP-2100HV", quantity: 1 },
    panel_sizing: { points: 2100 },
    selected_product: "product_ec9dcbb1",
    price_minor: 678700,
    quotation_id: "q_1",
  };
  assert.equal(fp(downstream), before, "downstream allocation/sizing/selection/pricing must not enter the fingerprint");
  for (const field of ["panel_allocation", "panel_sizing", "selected_product", "price_minor", "quotation_id"]) {
    assert.equal(field in base, false, `${field} must not exist on a quantity claim`);
  }
});

// ---------------------------------------------------------------------------
// The allowlist is the mechanism that makes E/F provable
// ---------------------------------------------------------------------------

test("the fingerprint is an explicit ALLOWLIST, never a hash of the whole claim", () => {
  assert.deepEqual([...QUANTITY_FINGERPRINT_KEYS].sort(), [
    "authority_version", "component_total", "count_method", "device_class", "device_variant",
    "document_id", "document_version_id", "page", "parser_version", "printed_total",
    "project_id", "quantity", "semantics_version", "sheet", "source_asset_ids", "source_region",
  ]);
  // Adding an arbitrary unknown field cannot move the fingerprint -- this is what
  // makes the downstream-exclusion guarantee structural rather than aspirational.
  const base = claim();
  const polluted = { ...base, totally_unrelated_field: "anything", another: [1, 2, 3] };
  assert.equal(fp(polluted), fp(base));
});

test("a claim missing its minimum authorities cannot be fingerprinted at all", () => {
  assert.equal(fp({ ...claim(), project_id: null }), null);
  assert.equal(fp({ ...claim(), document_version_id: null }), null);
  assert.equal(fp({ ...claim(), device_class: null }), null);
  assert.equal(fp({ ...claim(), count_method: null }), null);
  assert.equal(fp(null), null);
  assert.equal(fp(undefined), null);
  // ...and the model already refuses to build such a claim in the first place.
  assert.equal(buildQuantityClaim({ projectId: "p", deviceClass: "X", countMethod: "PRINTED_CELL", quantity: 1 }).error, "MISSING_DOCUMENT_VERSION");
});

test("a stored fingerprint that disagrees with content is detected as drift", () => {
  const good = claim();
  assert.equal(isFingerprintCurrent(good), true, "no stored fingerprint means nothing to contradict");
  assert.equal(isFingerprintCurrent({ ...good, evidence_fingerprint: fp(good) }), true);
  // Tampering with the quantity while keeping the old fingerprint is drift.
  assert.equal(isFingerprintCurrent({ ...good, evidence_fingerprint: fp(good), quantity: 999 }), false);
  // A tampered fingerprint is drift too.
  assert.equal(isFingerprintCurrent({ ...good, evidence_fingerprint: "dqa_deadbeefdeadbeef" }), false);
});

// ---------------------------------------------------------------------------
// Canonical read + fail-closed behaviour (§16 / §17)
// ---------------------------------------------------------------------------

test("canonical read returns governed, current, non-stale authority and nothing else", () => {
  const proven = claim();
  const result = readCurrentDrawingQuantityAuthority({ claims: [proven], currentDocumentVersions: { [DOC]: HEAD } });
  assert.equal(result.ready, true);
  assert.equal(result.state, DRAWING_QUANTITY_AUTHORITY_STATES.READY);
  assert.equal(result.quantity, 25);
  assert.equal(result.coverageState, "Complete");
  assert.equal(result.claims[0].authorityFingerprint, fp(proven));
  assert.deepEqual(result.proven, { "FIREMAN TELEPHONE JACK::STANDARD": { deviceClass: "FIREMAN TELEPHONE JACK", deviceVariant: "STANDARD", quantity: 25, sheets: [proven.sheet], state: "PROVEN" } });
});

test("MISSING -- no claims at all returns an explicit state and NEVER a substitute", () => {
  const result = readCurrentDrawingQuantityAuthority({ claims: [], currentDocumentVersions: {} });
  assert.equal(result.ready, false);
  assert.equal(result.state, DRAWING_QUANTITY_AUTHORITY_STATES.MISSING);
  assert.equal(result.quantity, null, "an absent authority must never carry a number");
  // Explicitly: no fallback field exists that could hold a BOQ/historical/recognition value.
  for (const forbidden of ["boqQuantity", "fallback", "historicalQuantity", "recognitionCount", "scheduleText"]) {
    assert.equal(forbidden in result, false, `${forbidden} must not exist as a fallback`);
  }
});

test("STALE -- a claim bound to a superseded drawing revision is not authority", () => {
  const result = readCurrentDrawingQuantityAuthority({ claims: [claim()], currentDocumentVersions: { [DOC]: "ver_2" } });
  assert.equal(result.ready, false);
  assert.equal(result.state, DRAWING_QUANTITY_AUTHORITY_STATES.STALE);
  assert.equal(result.quantity, null);
});

test("UNRESOLVED_SEMANTICS -- an ungoverned class yields no physical quantity", () => {
  const unresolved = buildQuantityClaim({
    projectId: "project_ae501b85", documentId: DOC, documentVersionId: VER, sheet: "BOS",
    deviceClass: "HC", countMethod: "PRINTED_CELL", quantity: null, classMeaningGoverned: false, reviewStatus: "Approved",
  }).claim;
  assert.equal(unresolved.quantity, null, "an unresolved class is NEVER zero");
  const result = readCurrentDrawingQuantityAuthority({ claims: [unresolved], currentDocumentVersions: { [DOC]: HEAD } });
  assert.equal(result.ready, false);
  assert.equal(result.state, DRAWING_QUANTITY_AUTHORITY_STATES.UNRESOLVED_SEMANTICS);
  assert.equal(result.quantity, null);
  assert.equal(result.unresolved[0].deviceClass, "HC");
  assert.equal(result.unresolved[0].quantity, null);
});

test("FINGERPRINT_DRIFT -- no claim is trusted when every one has drifted", () => {
  const drifted = { ...claim(), evidence_fingerprint: "dqa_0000000000000" };
  const result = readCurrentDrawingQuantityAuthority({ claims: [drifted], currentDocumentVersions: { [DOC]: HEAD } });
  assert.equal(result.ready, false);
  assert.equal(result.state, DRAWING_QUANTITY_AUTHORITY_STATES.FINGERPRINT_DRIFT);
  assert.equal(result.quantity, null);
});

test("a printed/component CONFLICT contributes NO quantity, and is not silently reconciled", () => {
  const conflicted = claim({ printedTotal: 12, componentTotal: 6 });
  assert.equal(conflicted.state, "CONFLICT");
  const result = readCurrentDrawingQuantityAuthority({ claims: [conflicted], currentDocumentVersions: { [DOC]: HEAD } });
  assert.equal(result.ready, false);
  assert.equal(result.quantity, null, "the conflicting class contributes nothing, not even its component total");
  // Both values are retained so a human can adjudicate.
  assert.equal(result.discrepancies[0].printedTotal, 12);
  assert.equal(result.discrepancies[0].componentTotal, 6);
  assert.equal(result.discrepancies[0].delta, 6);
});

test("one unresolved class does not invalidate a sibling PROVEN class", () => {
  const hc = buildQuantityClaim({
    projectId: "project_ae501b85", documentId: DOC, documentVersionId: VER, sheet: "BOS",
    deviceClass: "HC", countMethod: "PRINTED_CELL", quantity: null, classMeaningGoverned: false, reviewStatus: "Approved",
  }).claim;
  const result = readCurrentDrawingQuantityAuthority({ claims: [claim(), hc], currentDocumentVersions: { [DOC]: HEAD } });
  assert.equal(result.ready, true, "a governed proven class remains usable alongside an unresolved one");
  assert.equal(result.quantity, 25);
  assert.equal(result.coverageState, "Partial");
  assert.equal(result.counts.unresolved, 1);
  assert.equal(result.unresolved[0].quantity, null, "and the unresolved class is still reported as null, never zero");
});

test("a REJECTED review is not authority", () => {
  const rejected = claim({ reviewStatus: "Rejected" });
  assert.equal(rejected.state, "UNRESOLVED", "a rejected claim can never present as proven");
  const result = readCurrentDrawingQuantityAuthority({ claims: [rejected], currentDocumentVersions: { [DOC]: HEAD } });
  assert.equal(result.ready, false);
  assert.equal(result.quantity, null);
});
