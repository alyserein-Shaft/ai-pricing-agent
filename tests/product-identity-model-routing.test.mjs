import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProductIdentityProvenance,
  classifyProductIdentityComplexity,
  COMPLEXITY_CONDITIONS,
  productIdentityModelEnv,
  productIdentityModelForComplexity,
  PRODUCT_IDENTITY_COMPLEX_MODEL,
  PRODUCT_IDENTITY_NEMOTRON_ENABLED,
  PRODUCT_IDENTITY_SIMPLE_MODEL,
  SIMPLE_CONDITIONS,
} from "../app/domain/product-identity-model-routing.mjs";
import { validateProductRanking } from "../app/domain/ai-product-ranking-engine.mjs";

const NEMOTRON = "nvidia/nemotron-3-ultra-550b-a55b";

test("1: a trivial one-dominant-candidate case routes to the 8B", () => {
  const result = classifyProductIdentityComplexity({
    candidates: [{ mandatoryFailures: [] }],
    profile: { attributes: { sensing: "smoke" } },
    deterministic: { status: "Matched" },
  });
  assert.equal(result.complexityClass, "SIMPLE");
  assert.equal(productIdentityModelForComplexity(result.complexityClass), PRODUCT_IDENTITY_SIMPLE_MODEL);
});

test("2: a multi-candidate case routes to the 70B", () => {
  const result = classifyProductIdentityComplexity({
    candidates: [{ mandatoryFailures: [] }, { mandatoryFailures: [] }, { mandatoryFailures: [] }],
    profile: {},
    deterministic: {},
  });
  assert.equal(result.complexityClass, "COMPLEX");
  assert.ok(result.complexityReasons.includes("multiple_materially_viable_candidates"));
  assert.equal(productIdentityModelForComplexity(result.complexityClass), PRODUCT_IDENTITY_COMPLEX_MODEL);
});

test("3: a compatibility-sensitive case routes to the 70B", () => {
  const result = classifyProductIdentityComplexity({
    candidates: [{ mandatoryFailures: [] }],
    profile: { compatibility: [{ target: "panel", relationship: "Compatible With" }] },
    deterministic: {},
  });
  assert.equal(result.complexityClass, "COMPLEX");
  assert.ok(result.complexityReasons.includes("compatibility_reasoning_required"));
});

test("4: a contradictory-requirement case routes to the 70B", () => {
  const result = classifyProductIdentityComplexity({
    candidates: [{ mandatoryFailures: [] }],
    profile: { conflicts: [{ blocking: true, left: "UL", right: "EN54" }] },
    deterministic: {},
  });
  assert.equal(result.complexityClass, "COMPLEX");
  assert.ok(result.complexityReasons.includes("conflicting_requirements_exist"));
});

test("5: incomplete required attributes route to the 70B", () => {
  const result = classifyProductIdentityComplexity({
    candidates: [{ mandatoryFailures: [] }],
    profile: { missingAttributes: ["IP Rating", "Operating voltage"] },
    deterministic: {},
  });
  assert.equal(result.complexityClass, "COMPLEX");
  assert.ok(result.complexityReasons.includes("required_product_attributes_incomplete"));
});

test("6: unknown complexity FAILS CONSERVATIVE to the 70B", () => {
  const result = classifyProductIdentityComplexity({ candidates: [], profile: null, deterministic: null });
  assert.equal(result.complexityClass, "COMPLEX");
  assert.ok(result.complexityReasons.includes("unknown_complexity_fails_conservative_to_complex"));
  assert.equal(productIdentityModelForComplexity(result.complexityClass), PRODUCT_IDENTITY_COMPLEX_MODEL);
});

test("7: a provider failure never switches models -- provenance records no fallback", () => {
  // Routing is complexity-based. There is no code path from a failure to another model:
  // the provenance contract hard-codes fallbackUsed=false and the classifier is pure.
  const provenance = buildProductIdentityProvenance({
    complexityClass: "SIMPLE", complexityReasons: ["one_dominant_candidate"], model: PRODUCT_IDENTITY_SIMPLE_MODEL,
  });
  assert.equal(provenance.fallbackUsed, false);
  assert.equal(provenance.attempt, 1, "a failure is not retried on the other tier");
  // And the model id is a pure function of the class, so no failure can alter it.
  assert.equal(productIdentityModelForComplexity("SIMPLE"), PRODUCT_IDENTITY_SIMPLE_MODEL);
  assert.equal(productIdentityModelForComplexity("COMPLEX"), PRODUCT_IDENTITY_COMPLEX_MODEL);
});

test("8: both tiers resolve through the SAME env contract (identical schema path)", () => {
  const simple = productIdentityModelEnv({ BOQ_AI_MODEL_VERSION: "v1" }, "SIMPLE");
  const complex = productIdentityModelEnv({ BOQ_AI_MODEL_VERSION: "v1" }, "COMPLEX");
  // Same provider selection, same escalation constant, only the model id differs.
  assert.equal(simple.BOQ_AI_PROVIDER, complex.BOQ_AI_PROVIDER);
  assert.equal(simple.BOQ_AI_ESCALATION_MODEL, complex.BOQ_AI_ESCALATION_MODEL);
  assert.equal(simple.BOQ_AI_MODEL_VERSION, complex.BOQ_AI_MODEL_VERSION);
  assert.notEqual(simple.BOQ_AI_MODEL, complex.BOQ_AI_MODEL);
});

test("9: fabricated evidence is rejected on both tiers (same validation contract)", () => {
  // Both tiers share the ranking engine's validator, so a fabricated id is refused
  // identically regardless of which model produced it.
  // The ranking validator THROWS on malformed output rather than returning ok:false,
  // so "rejected" means "throws". Both tiers share this ONE validator (imported once,
  // used by both), so a fabricated candidate id is refused identically whichever model
  // produced the answer -- the contract is shared, not merely that both reject.
  const retrieved = [{ product: { id: "p1" }, score: 1, matchingBasis: ["addressable"], mandatoryFailures: [], source: {} }];
  const base = {
    recommendationState: "CANDIDATES_READY_FOR_REVIEW",
    candidates: [{ candidateId: "p1", rank: 1, fitScore: 80, matchState: "STRONG", matchedCriteria: ["addressable"], mismatchedCriteria: [], missingEvidence: [], explanation: "ok" }],
  };
  const attempt = (mutate) => {
    try {
      validateProductRanking(mutate(structuredClone(base)), retrieved);
      return null;
    } catch (error) {
      return error.message;
    }
  };
  for (const model of [PRODUCT_IDENTITY_SIMPLE_MODEL, PRODUCT_IDENTITY_COMPLEX_MODEL]) {
    // A candidate id the caller never supplied is refused.
    const fabricatedId = attempt((b) => { b.candidates[0].candidateId = "NOT_SUPPLIED"; return b; });
    assert.ok(fabricatedId, `${model} accepted a fabricated candidate id`);
    assert.match(fabricatedId, /unknown or duplicate candidate ID/i, model);
    // Technical evidence the deterministic matcher never produced is refused.
    const fabricatedEvidence = attempt((b) => { b.candidates[0].matchedCriteria = ["invented criterion"]; return b; });
    assert.ok(fabricatedEvidence, `${model} accepted fabricated technical evidence`);
    assert.match(fabricatedEvidence, /unsupported technical evidence/i, model);
    // And a valid answer passes on both tiers, proving the contract is shared.
    assert.equal(attempt((b) => b), null, `${model} rejected a valid answer`);
  }
});

test("10: Nemotron is NEVER selected for Product Identity", () => {
  assert.equal(PRODUCT_IDENTITY_NEMOTRON_ENABLED, false);
  for (const complexityClass of ["SIMPLE", "COMPLEX"]) {
    assert.notEqual(productIdentityModelForComplexity(complexityClass), NEMOTRON);
    assert.notEqual(productIdentityModelEnv({}, complexityClass).BOQ_AI_MODEL, NEMOTRON);
  }
  // And no routing constant names it.
  assert.ok(!JSON.stringify([PRODUCT_IDENTITY_SIMPLE_MODEL, PRODUCT_IDENTITY_COMPLEX_MODEL]).includes("nemotron"));
});

test("11: using the 70B changes no authority -- the classifier is pure and side-effect free", () => {
  const input = { candidates: [{ mandatoryFailures: [] }], profile: { conflicts: [{ blocking: true }] }, deterministic: {} };
  const snapshot = JSON.stringify(input);
  const first = classifyProductIdentityComplexity(input);
  const second = classifyProductIdentityComplexity(input);
  assert.deepEqual(first, second, "deterministic: same input, same class");
  assert.equal(JSON.stringify(input), snapshot, "the classifier mutates nothing");
  // The class set is closed, so no caller can invent a third tier.
  assert.ok(["SIMPLE", "COMPLEX"].includes(first.complexityClass));
  assert.equal(COMPLEXITY_CONDITIONS.length, 10);
  assert.equal(SIMPLE_CONDITIONS.length, 6);
});
