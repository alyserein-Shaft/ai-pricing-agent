import test from "node:test";
import assert from "node:assert/strict";

import {
  comparisonPartNumber,
  searchPartNumberKey,
  resolveKnowledgeProductIdentity,
  RESOLVER_OUTCOMES,
} from "../app/domain/knowledge-product-identity-resolver.mjs";

const ORG = "organization_bd_shaft_internal_pilot";
const CANONICAL = "product_0c4c8db3-674b-4564-8249-463c00885317";

const fact = (overrides = {}) => ({
  factId: "knowledgeFact_test",
  originalPartNumber: "IDP-PHOTO-IV",
  manufacturer: null,
  organizationId: ORG,
  libraryProjectId: null,
  ...overrides,
});

const candidate = (overrides = {}) => ({
  productId: "product_test-1",
  partNumber: "IDP-PHOTO-IV",
  manufacturer: "Honeywell",
  libraryScope: "Global Library",
  organizationId: null,
  libraryProjectId: null,
  identityStatus: "Active",
  canonicalProductId: null,
  canonicalPartNumber: null,
  canonicalStatus: null,
  canonicalPath: [],
  canonicalResolutionError: null,
  relationshipType: null,
  ...overrides,
});

const npcLink = (overrides = {}) => ({
  id: "knowledgeLink_test-1",
  partNumber: "IDP-PHOTO-IV",
  existingProductId: null,
  linkState: "New Product Candidate",
  ...overrides,
});

const resolve = (overrides = {}) => resolveKnowledgeProductIdentity({
  fact: fact(),
  candidates: [],
  existingLinks: [],
  openIdentityConflicts: [],
  ...overrides,
});

test("helpers: comparison and search-key examples from the policy", () => {
  assert.equal(comparisonPartNumber("idp-photo-iv"), "IDP-PHOTO-IV");
  assert.equal(comparisonPartNumber("  idp-photo-iv  "), "IDP-PHOTO-IV");
  assert.equal(comparisonPartNumber("IDP-PHOTO-IV."), "IDP-PHOTO-IV.");
  assert.equal(comparisonPartNumber("A  B-1"), "A B-1");
  assert.equal(searchPartNumberKey("IDP-PHOTO-IV"), "IDPPHOTOIV");
  assert.equal(searchPartNumberKey("IDP-PHOTO-IV."), "IDPPHOTOIV");
});

test("CASE-1: exact comparison match to one Active target", () => {
  const result = resolve({
    fact: fact({ manufacturer: "Honeywell" }),
    candidates: [candidate({ productId: CANONICAL })],
  });
  assert.equal(result.outcome, "EXACT_UNIQUE_TARGET");
  assert.equal(result.selectedTarget, CANONICAL);
  assert.equal(result.engineerReviewRequired, false);
  assert.equal(result.evidence.manufacturerBasis, "MATCHED");
});

test("CASE-2: one Superseded comparison match resolving to a unique Active canonical", () => {
  const result = resolve({
    fact: fact({ manufacturer: "Honeywell" }),
    candidates: [candidate({
      productId: "product_old-1",
      identityStatus: "Superseded",
      canonicalProductId: CANONICAL,
      canonicalPartNumber: "IDP-PHOTO-IV",
      canonicalStatus: "Active",
      canonicalPath: ["product_old-1", CANONICAL],
    })],
  });
  assert.equal(result.outcome, "EXACT_UNIQUE_TARGET");
  assert.equal(result.selectedTarget, CANONICAL);
  assert.equal(result.engineerReviewRequired, false);
  assert.ok(result.reasonCodes.includes("CANONICAL_CONVERGENCE"));
});

test("CASE-3: search-key-only punctuation match never proves identity", () => {
  const result = resolve({
    candidates: [candidate({ productId: "product_dot-1", partNumber: "IDP-PHOTO-IV." })],
  });
  assert.equal(result.outcome, "AMBIGUOUS_TARGET");
  assert.equal(result.selectedTarget, null);
  assert.equal(result.engineerReviewRequired, true);
  assert.ok(result.reasonCodes.includes("SEARCH_KEY_ONLY_NEVER_PROVES_IDENTITY"));
});

test("CASE-4: same comparison code under different manufacturers", () => {
  const result = resolve({
    fact: fact({ manufacturer: "Honeywell" }),
    candidates: [
      candidate({ productId: "product_h-1", manufacturer: "Honeywell" }),
      candidate({ productId: "product_b-1", manufacturer: "Bosch" }),
    ],
  });
  assert.equal(result.outcome, "AMBIGUOUS_TARGET");
  assert.equal(result.selectedTarget, null);
  assert.equal(result.engineerReviewRequired, true);
});

test("CASE-5: same code in Global + Organization as distinct identities", () => {
  const result = resolve({
    candidates: [
      candidate({ productId: "product_global-1" }),
      candidate({
        productId: "product_org-1",
        libraryScope: "Organization Library",
        organizationId: ORG,
      }),
    ],
  });
  assert.equal(result.outcome, "AMBIGUOUS_TARGET");
  assert.equal(result.selectedTarget, null);
  assert.equal(result.engineerReviewRequired, true);
});

test("CASE-6: multiple historical rows converging to the same canonical", () => {
  const superseded = (id, partNumber) => candidate({
    productId: id,
    partNumber,
    identityStatus: "Superseded",
    canonicalProductId: CANONICAL,
    canonicalStatus: "Active",
    canonicalPath: [id, CANONICAL],
  });
  const result = resolve({
    fact: fact({ originalPartNumber: "IDP-PHOTO-IV." }),
    candidates: [
      superseded("product_old-1", "IDP-PHOTO-IV."),
      superseded("product_old-2", "IDP-PHOTO-IV."),
    ],
  });
  assert.equal(result.outcome, "EXACT_UNIQUE_TARGET");
  assert.equal(result.selectedTarget, CANONICAL);
  assert.equal(result.engineerReviewRequired, false);
});

test("CASE-7: no candidates", () => {
  const result = resolve({ candidates: [] });
  assert.equal(result.outcome, "NO_TARGET");
  assert.equal(result.selectedTarget, null);
  assert.equal(result.deterministic, true);
  assert.equal(result.engineerReviewRequired, false);
});

test("CASE-8: existing link already equals the deterministic canonical target", () => {
  const result = resolve({
    fact: fact({ manufacturer: "Honeywell" }),
    candidates: [candidate({ productId: CANONICAL })],
    existingLinks: [npcLink({ existingProductId: CANONICAL, linkState: "Existing Product — Additive Learning Only" })],
  });
  assert.equal(result.outcome, "ALREADY_LINKED");
  assert.equal(result.selectedTarget, CANONICAL);
  assert.equal(result.engineerReviewRequired, false);
});

test("CASE-9 GOLDEN: NPC/null link plus deterministic canonical target", () => {
  const result = resolveKnowledgeProductIdentity({
    fact: fact({ factId: "knowledgeFact_6dbbd08f-4e40-48b5-8601-e644b2b2c556" }),
    candidates: [
      candidate({ productId: CANONICAL }),
      candidate({
        productId: "product_918ff5e3-2edb-4918-a29d-7ebf37dff322",
        partNumber: "IDP-PHOTO-IV.",
        identityStatus: "Superseded",
        canonicalProductId: CANONICAL,
        canonicalPartNumber: "IDP-PHOTO-IV",
        canonicalStatus: "Active",
        canonicalPath: ["product_918ff5e3-2edb-4918-a29d-7ebf37dff322", CANONICAL],
      }),
    ],
    existingLinks: [npcLink({ id: "knowledgeLink_a2bc1e97-9287-497e-934b-1d9c2ba83b39" })],
    openIdentityConflicts: [],
  });
  assert.equal(result.outcome, "REPAIRABLE_NEW_PRODUCT_CANDIDATE");
  assert.equal(result.selectedTarget, CANONICAL);
  assert.equal(result.engineerReviewRequired, false);
  assert.equal(result.deterministic, true);
});

test("CASE-10: existing link targets a different product", () => {
  const result = resolve({
    fact: fact({ manufacturer: "Honeywell" }),
    candidates: [candidate({ productId: CANONICAL })],
    existingLinks: [npcLink({ existingProductId: "product_other-1", linkState: "Existing Product — Additive Learning Only" })],
  });
  assert.equal(result.outcome, "EXISTING_LINK_CONFLICT");
  assert.equal(result.selectedTarget, null);
  assert.equal(result.engineerReviewRequired, true);
});

test("CASE-11: multiple persisted existing links", () => {
  const result = resolve({
    fact: fact({ manufacturer: "Honeywell" }),
    candidates: [candidate({ productId: CANONICAL })],
    existingLinks: [npcLink({ id: "knowledgeLink_1" }), npcLink({ id: "knowledgeLink_2", existingProductId: CANONICAL })],
  });
  assert.equal(result.outcome, "MULTIPLE_EXISTING_LINKS");
  assert.equal(result.selectedTarget, null);
  assert.equal(result.engineerReviewRequired, true);
});

test("CASE-12: broken canonical chain", () => {
  const result = resolve({
    candidates: [candidate({
      productId: "product_broken-1",
      identityStatus: "Superseded",
      canonicalProductId: null,
      canonicalResolutionError: "CANONICAL_PRODUCT_BROKEN_CHAIN",
    })],
  });
  assert.equal(result.outcome, "BROKEN_CANONICAL_CHAIN");
  assert.equal(result.selectedTarget, null);
  assert.equal(result.engineerReviewRequired, true);
});

test("CASE-13: commercial substitute only is never an identity target", () => {
  const result = resolve({
    candidates: [candidate({ productId: "product_sub-1", relationshipType: "Replacement" })],
  });
  assert.notEqual(result.outcome, "EXACT_UNIQUE_TARGET");
  assert.equal(result.outcome, "NO_TARGET");
  assert.equal(result.selectedTarget, null);
});

test("CASE-14: unknown manufacturer with a true unique comparison singleton", () => {
  const result = resolve({
    fact: fact({ manufacturer: null }),
    candidates: [candidate({ productId: CANONICAL, manufacturer: "Honeywell" })],
  });
  assert.equal(result.outcome, "EXACT_UNIQUE_TARGET");
  assert.equal(result.selectedTarget, CANONICAL);
  assert.equal(result.evidence.manufacturerBasis, "UNKNOWN_SINGLETON");
  assert.equal(result.engineerReviewRequired, false);
});

test("CASE-15: unknown manufacturer with a competing candidate", () => {
  const result = resolve({
    fact: fact({ manufacturer: null }),
    candidates: [
      candidate({ productId: "product_h-1", manufacturer: "Honeywell" }),
      candidate({ productId: "product_b-1", manufacturer: "Bosch" }),
    ],
  });
  assert.equal(result.outcome, "AMBIGUOUS_TARGET");
  assert.equal(result.selectedTarget, null);
  assert.equal(result.engineerReviewRequired, true);
});

test("CASE-16: search-key collision across two comparison-distinct codes", () => {
  const result = resolve({
    candidates: [
      candidate({ productId: "product_dot-1", partNumber: "IDP-PHOTO-IV." }),
      candidate({ productId: "product_us-1", partNumber: "IDP_PHOTO_IV" }),
    ],
  });
  assert.equal(result.outcome, "AMBIGUOUS_TARGET");
  assert.equal(result.selectedTarget, null);
  assert.equal(result.engineerReviewRequired, true);
});

test("CASE-17: original source value is preserved unchanged in evidence", () => {
  const result = resolve({
    fact: fact({ originalPartNumber: "  idp-photo-iv  ", manufacturer: "Honeywell" }),
    candidates: [candidate({ productId: CANONICAL })],
  });
  assert.equal(result.outcome, "EXACT_UNIQUE_TARGET");
  assert.equal(result.evidence.originalPartNumber, "  idp-photo-iv  ");
  assert.equal(result.evidence.factComparison, "IDP-PHOTO-IV");
});

test("GOVERNANCE: resolver output grants no product approval state", () => {
  const results = [
    resolve({
      fact: fact({ manufacturer: "Honeywell" }),
      candidates: [candidate({ productId: CANONICAL })],
    }),
    resolve({
      fact: fact({ manufacturer: "Honeywell" }),
      candidates: [candidate({ productId: CANONICAL })],
      existingLinks: [npcLink()],
    }),
  ];
  const forbidden = [
    "approved_for_discovery", "approvedForDiscovery", "review_status", "reviewStatus",
    "costingEligible", "costing_eligibility", "priceApproval", "technicalApproval",
    "certificationApproval", "pricesCreated",
  ];
  for (const result of results) {
    const serialized = JSON.stringify(result);
    for (const key of forbidden) {
      assert.ok(!serialized.includes(key), `resolver output must not contain ${key}`);
    }
  }
  assert.ok(RESOLVER_OUTCOMES.includes("REPAIRABLE_NEW_PRODUCT_CANDIDATE"));
});
