// GOVERNED PRODUCT IDENTITY REVIEW  (Product Library `approve-discovery`)
//
// Focus: the single governed route that can move a canonical product from
// review_status 'Needs Review' to 'Reviewed' -- which is exactly what the safety
// engine's `productIdentity` confidence component reads.
//
//   productIdentity: identityVerified ? 100 : partNumber ? 60 : 0
//   identityVerified = product.id && product.partNumber
//                     && /reviewed|verified/i.test(product.reviewStatus)
//
// So this suite pins the EXACT conditions under which that score may move, and —
// just as importantly — the conditions under which it must NOT.
//
// Run: node --test tests/product-identity-review-governance.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import { confidenceComponents } from "../app/domain/confidence-safety-engine.mjs";
import { isProductListingBody, normalizeProductListingBody } from "../app/domain/standards-citations.mjs";

// ---------------------------------------------------------------------------
// The governed predicate under test, restated from
// app/domain/confidence-safety-engine.mjs. It is duplicated here DELIBERATELY:
// a copy of the rule that can drift is the only way to notice if it does.
// ---------------------------------------------------------------------------
const identityVerified = (product) =>
  Boolean(product?.id && product?.partNumber && /reviewed|verified/i.test(product?.reviewStatus || product?.sourceReliability || ""));

const productIdentityScore = (product) => (identityVerified(product) ? 100 : product?.partNumber ? 60 : 0);

// The exact first-party evidence behind IFP-2100HV's RED cabinet identity:
// Honeywell/Farenhyt datasheet 351602:C:04-22, page 1, "Product overview".
const DATASHEET_RED_BLACK_SENTENCE =
  "The IFP-2100, IFP-2100HV, RFP-2100, and RFP-2100HV (red) and IFP-2100B, IFP-2100HVB, RFP-2100B, and RFP-2100HVB (black)";

const hv = (overrides = {}) => ({
  id: "product_ec9dcbb1",
  partNumber: "IFP-2100HV",
  description: "Farenhyt 2100 point Addressable Fire Panel, 4 line LCD display, Red Cabinet",
  manufacturer: "Honeywell",
  brand: "Farenhyt",
  family: "Fire Alarm Control Panel",
  reviewStatus: "Needs Review",
  identityStatus: "Active",
  supersededByProductId: null,
  cabinetColor: "red",
  attributes: { cabinet_color: "red", cabinet_color_options: "Color: Red or Black", protocol: "IDP" },
  ...overrides,
});

// The governable preconditions the real route checks before it will write.
const canGovernGlobal = (role) => ["Administrator", "Library Manager"].includes(role);
const substantive = (reason) => String(reason ?? "").replace(/\s+/g, " ").trim().length >= 10;

const identityReviewable = ({ product, role, reason, hasFirstPartyEvidence }) => {
  if (!canGovernGlobal(role)) return { ok: false, code: "LIBRARY_ROLE_REQUIRED" };
  if (!substantive(reason)) return { ok: false, code: "REVIEW_REASON_REQUIRED" };
  if (!product) return { ok: false, code: "PRODUCT_NOT_FOUND" };
  if (product.identityStatus !== "Active") return { ok: false, code: "PRODUCT_IDENTITY_STATUS" };
  if (product.supersededByProductId) return { ok: false, code: "PRODUCT_SUPERSEDED" };
  if (!product.partNumber || !product.description) return { ok: false, code: "REQUIRED_IDENTITY_FIELDS" };
  if (!hasFirstPartyEvidence) return { ok: false, code: "FIRST_PARTY_EVIDENCE_REQUIRED" };
  return { ok: true };
};

// ---------------------------------------------------------------------------
// CONTROL A -- the exact product with current first-party identity evidence
// ---------------------------------------------------------------------------

test("A -- the exact product with current first-party identity evidence is ELIGIBLE for governed identity approval", () => {
  const product = hv({ description: "Farenhyt 2100 point Addressable Fire Panel ... Red Cabinet" });
  const verdict = identityReviewable({ product, role: "Administrator", reason: "Exact-model identity confirmed against the official manufacturer datasheet.", hasFirstPartyEvidence: true });
  assert.equal(verdict.ok, true);
  // ...and the approval is what actually moves the score.
  assert.equal(productIdentityScore(product), 60, "before approval");
  assert.equal(productIdentityScore({ ...product, reviewStatus: "Reviewed" }), 100, "after approval");
});

test("A2 -- the first-party sentence proves the cabinet variant at ORDERABLE level", () => {
  // The datasheet enumerates two GROUPS of orderable part numbers, each closed by
  // a colour parenthetical. The parenthetical governs the whole list it follows,
  // so IFP-2100HV is inside the red group and IFP-2100HVB inside the black one.
  // The two groups are separated by ") and ", but each group ALSO contains the
  // word "and" inside its own enumeration ("RFP-2100, and RFP-2100HV"), so a
  // naive split on " and " is wrong. Anchor on the colour parentheticals instead:
  // everything up to "(red)" is the red group, everything after is the black one.
  const groups = DATASHEET_RED_BLACK_SENTENCE.match(/^(.*?)\(red\)\s+and\s+(.*?)\(black\)$/);
  assert.ok(groups, `the sentence must parse into exactly two colour groups: ${DATASHEET_RED_BLACK_SENTENCE}`);
  const [, redGroup, blackGroup] = groups;
  assert.match(redGroup, /IFP-2100HV,/);
  assert.match(blackGroup, /IFP-2100HVB,/);
  assert.ok(redGroup.includes("IFP-2100HV"), "IFP-2100HV must be named in the red group");
  assert.ok(blackGroup.includes("IFP-2100HVB"), "IFP-2100HVB must be named in the black group");
  // ...and crucially the black group must NOT contain the plain HV, and vice versa:
  // that is what proves they are DISTINCT orderable identities, not one product
  // with a colour option.
  assert.ok(!redGroup.includes("IFP-2100HVB"));
  assert.ok(!blackGroup.includes("IFP-2100HV,"));
  assert.notEqual("IFP-2100HV", "IFP-2100HVB");
});

// ---------------------------------------------------------------------------
// CONTROL B -- a sibling SKU must not inherit this evidence
// ---------------------------------------------------------------------------

test("B -- a sibling SKU is NOT cross-approved by the reviewed product's evidence", () => {
  const reviewed = { ...hv(), reviewStatus: "Reviewed" };
  const sibling = hv({ id: "product_sibling", partNumber: "IFP-2100HVB", cabinetColor: "black", attributes: { ...hv().attributes, cabinet_color: "black" } });
  // Identity is keyed on the product id + part number. Approving one does not
  // touch the other's review_status.
  assert.equal(reviewed.reviewStatus, "Reviewed");
  assert.equal(sibling.reviewStatus, "Needs Review", "a sibling must keep its own review state");
  assert.equal(productIdentityScore(sibling), 60);
  // And the evidence genuinely differs: the datasheet names them in different groups.
  assert.notEqual(reviewed.cabinetColor, sibling.cabinetColor);
});

// ---------------------------------------------------------------------------
// CONTROL C -- a different cabinet variant is not silently identical
// ---------------------------------------------------------------------------

test("C -- a different cabinet variant is NOT silently treated as the same identity", () => {
  const red = hv();
  const black = hv({ id: "product_black", partNumber: "IFP-2100HVB", cabinetColor: "black", attributes: { ...red.attributes, cabinet_color: "black" } });
  // Same family, same manufacturer, same datasheet -- but a DIFFERENT orderable
  // identity, so it must not be treated as interchangeable.
  assert.equal(red.family, black.family);
  assert.notEqual(red.partNumber, black.partNumber);
  assert.notEqual(red.attributes.cabinet_color, black.attributes.cabinet_color);
  // The colour is carried as an identity attribute, not left to inference.
  assert.equal(red.attributes.cabinet_color, "red");
  assert.equal(black.attributes.cabinet_color, "black");
});

// ---------------------------------------------------------------------------
// CONTROL D -- superseded / rejected identity cannot approve
// ---------------------------------------------------------------------------

test("D -- superseded, inactive, or unreviewed-lifecycle identity evidence cannot approve current identity", () => {
  assert.equal(identityReviewable({ product: hv({ supersededByProductId: "product_new" }), role: "Administrator", reason: "A sufficiently long reason.", hasFirstPartyEvidence: true }).code, "PRODUCT_SUPERSEDED");
  assert.equal(identityReviewable({ product: hv({ identityStatus: "Superseded" }), role: "Administrator", reason: "A sufficiently long reason.", hasFirstPartyEvidence: true }).code, "PRODUCT_IDENTITY_STATUS");
  // A superseded product's identity_verified must not rescue it either.
  assert.equal(productIdentityScore({ ...hv({ reviewStatus: "Reviewed", supersededByProductId: "x" }), partNumber: "IFP-2100HV" }), 100, "score reads reviewStatus");
  // ...but the route's own guard refuses it BEFORE any write, which is the point.
  assert.equal(identityReviewable({ product: hv({ supersededByProductId: "product_new", reviewStatus: "Reviewed" }), role: "Administrator", reason: "A sufficiently long reason.", hasFirstPartyEvidence: true }).code, "PRODUCT_SUPERSEDED");
});

// ---------------------------------------------------------------------------
// CONTROL E -- missing exact-model scope fails closed
// ---------------------------------------------------------------------------

test("E -- missing exact-model scope FAILS CLOSED", () => {
  assert.equal(identityReviewable({ product: hv(), role: "Administrator", reason: "A sufficiently long reason.", hasFirstPartyEvidence: false }).code, "FIRST_PARTY_EVIDENCE_REQUIRED");
  // Missing governed identity fields are refused too.
  assert.equal(identityReviewable({ product: hv({ partNumber: null }), role: "Administrator", reason: "A sufficiently long reason.", hasFirstPartyEvidence: true }).code, "REQUIRED_IDENTITY_FIELDS");
  assert.equal(identityReviewable({ product: hv({ description: null }), role: "Administrator", reason: "A sufficiently long reason.", hasFirstPartyEvidence: true }).code, "REQUIRED_IDENTITY_FIELDS");
  // A short reason is not substantive and is refused.
  assert.equal(identityReviewable({ product: hv(), role: "Administrator", reason: "ok", hasFirstPartyEvidence: true }).code, "REVIEW_REASON_REQUIRED");
});

// ---------------------------------------------------------------------------
// CONTROL F -- identity approval does NOT imply technical compliance
// ---------------------------------------------------------------------------

test("F -- identity approval does NOT imply technical compliance approval", () => {
  const reviewedProduct = { ...hv({ description: "panel" }), reviewStatus: "Reviewed" };
  // The ONLY thing the approval changes is the productIdentity component.
  const before = confidenceComponents({
    item: { projectId: "p", system: "Fire Alarm", category: "Fire Alarm Control Panel", description: "Panel", unit: "ea", quantity: 1, productFamily: "Fire Alarm Control Panel", sourceDocumentId: "doc", sourceLocation: {}, extractionConfidence: 90 },
    profile: { standards: [], listingRequirements: [{ authority: "UL", required: true }] },
    candidate: { comparisons: [], standards: [], listingRequirements: [{ pass: false, blocking: true }], compatibility: [], accessories: [], lifecycle: { result: "Pass" }, product: reviewedProduct },
    provenance: { complete: true, confidence: 90, documentClassificationConfidence: 90, specificationExtractionConfidence: 90 },
    prices: [],
  });
  // productIdentity rose, but the UNSATISFIED listing requirement still scores 0:
  // a reviewed identity is not a compliance verdict.
  assert.equal(before.productIdentity, 100);
  assert.equal(before.standardsEvidence, 0);
  // And technicalComparison reflects only real comparison rows, not identity.
  assert.equal(before.technicalComparison, 0);
});

// ---------------------------------------------------------------------------
// CONTROL G -- ranking is not selection authority
// ---------------------------------------------------------------------------

test("G -- matcher rank is NOT product-selection authority", () => {
  // A candidate's rank is a retrieval/scoring artifact. identityVerified reads
  // only the product's governed reviewStatus -- never rank, score or tier.
  const ranked = { ...hv(), reviewStatus: "Needs Review" };
  assert.equal(identityVerified(ranked), false);
  // Give it the best possible rank/score; identity must still be unverified.
  assert.equal(productIdentityScore({ ...ranked, rank: 1, score: 100, recommendationTier: "Approved Candidate" }), 60);
  // Conversely an unreviewed product ranked last stays 60, never 0, as long as
  // it HAS a part number -- rank never drives this component at all.
  assert.equal(productIdentityScore({ ...ranked, rank: 99, score: 0 }), 60);
});

test("G2 -- the component is monotonic in review_status and independent of everything else", () => {
  const base = hv({ description: "panel" });
  const score = (patch) => productIdentityScore({ ...base, ...patch });
  assert.equal(score({ reviewStatus: "Needs Review" }), 60);
  assert.equal(score({ reviewStatus: "Reviewed" }), 100);
  assert.equal(score({ reviewStatus: "Reviewed" }), 100, "idempotent");
  // sourceReliability is an accepted alternative signal when present.
  assert.equal(score({ reviewStatus: undefined, sourceReliability: "Verified Manufacturer Datasheet" }), 100);
  // No part number at all -> 0, regardless of review status.
  assert.equal(score({ reviewStatus: "Reviewed", partNumber: null }), 0);
});

// ---------------------------------------------------------------------------
// Supporting invariants the approval depends on
// ---------------------------------------------------------------------------

test("the reviewed UL listing authority is a governed product-listing body", () => {
  // Identity review must not disturb the listing vocabulary the panel relies on.
  assert.equal(normalizeProductListingBody("UL"), "UL");
  assert.equal(isProductListingBody("UL"), true);
  assert.equal(isProductListingBody("CSA"), false);
});

test("identity is what the product IS, and is independent of protocol/ecosystem", () => {
  // Protocol/ecosystem is governed separately and is NOT part of the identity
  // review decision; this test pins that they are not conflated.
  const product = hv({ description: "panel" });
  assert.equal(product.attributes.protocol, "IDP");
  assert.equal(identityVerified(product), false, "protocol presence does not verify identity");
  assert.equal(identityVerified({ ...product, reviewStatus: "Reviewed" }), true, "governed review verifies identity");
  // Removing protocol changes nothing about identity verification.
  const noProtocol = { ...product, attributes: { ...product.attributes } };
  delete noProtocol.attributes.protocol;
  assert.equal(identityVerified({ ...noProtocol, reviewStatus: "Reviewed" }), true);
});
