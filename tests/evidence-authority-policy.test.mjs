import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTHORITY_CLASSES,
  CLAIM_ROLES,
  EVIDENCE_KINDS,
  CONFLICT_STATES,
  CROSS_DOMAIN_CONFLICT_STATES,
  APPLICABILITY_SCOPES,
  MATCHING_DIMENSIONS,
  GLOBAL_NUMERIC_AUTHORITY_RANK,
  AUTHORITY_DOMAIN_POLICY,
  APPLICABILITY_SPECIFICITY,
  isAuthorityClass,
  isClaimRole,
  isEvidenceKind,
  isConflictState,
  isApplicabilityScope,
  isMatchingDimension,
  authorityDomainPolicy,
  authorityRoleForClaim,
  resolveAuthorityClassForSource,
  SOURCE_TYPE_AUTHORITY_CLASS,
  resolveCrossDomainConflict,
  classifyEvidenceKind,
  isDerivedEvidenceComplete,
  promoteEvidenceKind,
  evidenceKindTrust,
  insufficientAuthority,
  missingEvidence,
  UNKNOWN_PRECEDENCE,
} from "../app/domain/evidence-authority-policy.mjs";

// ---------------------------------------------------------------------------
// Canonical vocabularies.
// ---------------------------------------------------------------------------
test("canonical authority classes are exactly the eight governed classes", () => {
  assert.deepEqual(AUTHORITY_CLASSES, ["PROJECT_CONTRACT", "REGULATORY", "ENGINEERING_DESIGN", "PRODUCT_TECHNICAL", "CERTIFICATION_LISTING", "COMMERCIAL", "HISTORICAL_ORGANIZATIONAL", "AI_INFERENCE"]);
});

test("there is explicitly NO global numeric authority rank", () => {
  assert.equal(GLOBAL_NUMERIC_AUTHORITY_RANK, null);
});

test("claim roles / evidence kinds / conflict states / scopes / dimensions are canonical and validated", () => {
  assert.deepEqual(CLAIM_ROLES, ["DEFINING", "VERIFYING", "ARBITRATING", "REFUTING"]);
  assert.deepEqual(EVIDENCE_KINDS, ["EXPLICIT", "DERIVED", "INFERRED"]);
  for (const state of [...CONFLICT_STATES, ...CROSS_DOMAIN_CONFLICT_STATES]) assert.equal(isConflictState(state), true);
  assert.deepEqual(APPLICABILITY_SCOPES, ["PROJECT", "SYSTEM", "SUBSYSTEM", "EQUIPMENT_FAMILY", "EXACT_BOQ_ITEM", "ZONE_AREA", "DRAWING", "EXACT_MODEL"]);
  assert.ok(MATCHING_DIMENSIONS.length >= 14);
});

test("applicability specificity is monotonic and is labeled specificity, never authority strength", () => {
  assert.ok(APPLICABILITY_SPECIFICITY.EXACT_MODEL > APPLICABILITY_SPECIFICITY.EXACT_BOQ_ITEM);
  assert.ok(APPLICABILITY_SPECIFICITY.EXACT_BOQ_ITEM > APPLICABILITY_SPECIFICITY.EQUIPMENT_FAMILY);
  assert.ok(APPLICABILITY_SPECIFICITY.EQUIPMENT_FAMILY > APPLICABILITY_SPECIFICITY.SYSTEM);
  assert.ok(APPLICABILITY_SPECIFICITY.SYSTEM > APPLICABILITY_SPECIFICITY.PROJECT);
  assert.equal(typeof APPLICABILITY_SPECIFICITY.PROJECT, "number");
});

test("validators fail closed on unknown values", () => {
  assert.equal(isAuthorityClass("PROJECT"), false);
  assert.equal(isAuthorityClass("project_contract"), false);
  assert.equal(isClaimRole("OVERRIDES"), false);
  assert.equal(isClaimRole("arbitrating"), false);
  assert.equal(isEvidenceKind("CONFIDENT"), false);
  assert.equal(isConflictState("WINS"), false);
  assert.equal(isApplicabilityScope("SITE"), false);
  assert.equal(isMatchingDimension("bandwidth"), false);
  assert.equal(isMatchingDimension("voltage"), true);
});

// ---------------------------------------------------------------------------
// Source-type -> authority class mapping.
// ---------------------------------------------------------------------------
test("known source types resolve to their domain-specific class", () => {
  assert.equal(resolveAuthorityClassForSource("Specification"), "PROJECT_CONTRACT");
  assert.equal(resolveAuthorityClassForSource("BOQ"), "PROJECT_CONTRACT");
  assert.equal(resolveAuthorityClassForSource("Drawing"), "PROJECT_CONTRACT");
  assert.equal(resolveAuthorityClassForSource("Code"), "REGULATORY");
  assert.equal(resolveAuthorityClassForSource("AHJ Requirement"), "REGULATORY");
  assert.equal(resolveAuthorityClassForSource("Design Calculation"), "ENGINEERING_DESIGN");
  assert.equal(resolveAuthorityClassForSource("Manufacturer"), "PRODUCT_TECHNICAL");
  assert.equal(resolveAuthorityClassForSource("Datasheet"), "PRODUCT_TECHNICAL");
  assert.equal(resolveAuthorityClassForSource("Certification"), "CERTIFICATION_LISTING");
  assert.equal(resolveAuthorityClassForSource("Supplier"), "COMMERCIAL");
  assert.equal(resolveAuthorityClassForSource("Previous Project"), "HISTORICAL_ORGANIZATIONAL");
  assert.equal(resolveAuthorityClassForSource("AI Inference"), "AI_INFERENCE");
});

test("unknown source types fail closed to null (no guess)", () => {
  assert.equal(resolveAuthorityClassForSource("Gossip"), null);
  assert.equal(resolveAuthorityClassForSource(""), null);
  assert.equal(resolveAuthorityClassForSource(undefined), null);
});

test("the mapping table is fully enumerable over its keys", () => {
  assert.ok(Object.keys(SOURCE_TYPE_AUTHORITY_CLASS).length >= 30);
});

// ---------------------------------------------------------------------------
// Declarative matrix.
// ---------------------------------------------------------------------------
test("the matrix is declared as DATA over every dimension", () => {
  for (const dimension of MATCHING_DIMENSIONS) {
    assert.ok(AUTHORITY_DOMAIN_POLICY[dimension], `missing matrix row for ${dimension}`);
    for (const authorityClass of Object.keys(AUTHORITY_DOMAIN_POLICY[dimension])) {
      assert.equal(isAuthorityClass(authorityClass), true, `invalid class ${authorityClass} in ${dimension}`);
      for (const role of AUTHORITY_DOMAIN_POLICY[dimension][authorityClass]) assert.equal(isClaimRole(role), true, `invalid role ${role} in ${dimension}`);
    }
  }
});

test("PROJECT_CONTRACT defines what the project requires; COMMERCIAL/AI never authorize technical dimensions", () => {
  assert.equal(authorityDomainPolicy("voltage", "PROJECT_CONTRACT").authoritative, true);
  assert.equal(authorityDomainPolicy("capacity", "PROJECT_CONTRACT").authoritative, true);
  assert.equal(authorityDomainPolicy("protocol", "COMMERCIAL").authoritative, false);
  assert.equal(authorityDomainPolicy("protocol", "AI_INFERENCE").authoritative, false);
  assert.equal(authorityDomainPolicy("addressing", "COMMERCIAL").authoritative, false);
  assert.equal(authorityDomainPolicy("certification_listing", "COMMERCIAL").authoritative, false);
  assert.equal(authorityDomainPolicy("voltage", "HISTORICAL_ORGANIZATIONAL").authoritative, false);
});

test("PRODUCT_TECHNICAL verifies but never defines project requirements", () => {
  const verifying = authorityRoleForClaim({ dimension: "voltage", authorityClass: "PRODUCT_TECHNICAL", claimRole: "VERIFYING" });
  assert.equal(verifying.status, "AUTHORITATIVE");
  const defining = authorityRoleForClaim({ dimension: "voltage", authorityClass: "PRODUCT_TECHNICAL", claimRole: "DEFINING" });
  assert.equal(defining.status, "INSUFFICIENT_AUTHORITY");
});

test("CERTIFICATION_LISTING verifies exact listing scope for standards but cannot define project scope", () => {
  assert.equal(authorityRoleForClaim({ dimension: "standards", authorityClass: "CERTIFICATION_LISTING", claimRole: "VERIFYING" }).status, "AUTHORITATIVE");
  const defining = authorityRoleForClaim({ dimension: "standards", authorityClass: "CERTIFICATION_LISTING", claimRole: "DEFINING" });
  assert.equal(defining.status, "INSUFFICIENT_AUTHORITY");
});

test("unknown dimension/class pair fails closed to INSUFFICIENT_AUTHORITY", () => {
  assert.equal(authorityDomainPolicy("wifi_channels", "PRODUCT_TECHNICAL").status, "INSUFFICIENT_AUTHORITY");
  assert.equal(authorityDomainPolicy("voltage", "SUPERHERO").status, "INSUFFICIENT_AUTHORITY");
  assert.equal(authorityDomainPolicy("voltage", "superhero").authoritative, false);
});

// ---------------------------------------------------------------------------
// Cross-domain conflict semantics -- NO universal winner.
// ---------------------------------------------------------------------------
test("PROJECT_CONTRACT vs REGULATORY has no global winner: both constraints apply together", () => {
  const agree = resolveCrossDomainConflict({ authorityClass: "PROJECT_CONTRACT" }, { authorityClass: "REGULATORY" }, { consistent: true, dimension: "voltage" });
  assert.equal(agree.state, "BOTH_CONSTRAINTS_APPLY");
  assert.equal(agree.blocking, false);
  const clash = resolveCrossDomainConflict({ authorityClass: "PROJECT_CONTRACT" }, { authorityClass: "REGULATORY" }, { consistent: false, dimension: "voltage" });
  assert.equal(clash.state, "REGULATORY_CONFLICT");
  assert.equal(clash.blocking, true);
});

test("PROJECT_CONTRACT vs ENGINEERING_DESIGN: engineering must satisfy the project", () => {
  const agree = resolveCrossDomainConflict({ authorityClass: "ENGINEERING_DESIGN" }, { authorityClass: "PROJECT_CONTRACT" }, { consistent: true, dimension: "capacity" });
  assert.equal(agree.state, "ENGINEERING_MUST_SATISFY_PROJECT");
  assert.equal(agree.blocking, false);
  const clash = resolveCrossDomainConflict({ authorityClass: "ENGINEERING_DESIGN" }, { authorityClass: "PROJECT_CONTRACT" }, { consistent: false, dimension: "capacity" });
  assert.equal(clash.state, "AUTHORITY_CONFLICT");
  assert.equal(clash.blocking, true);
});

test("REGULATORY vs ENGINEERING_DESIGN: engineering must satisfy the regulation", () => {
  const agree = resolveCrossDomainConflict({ authorityClass: "REGULATORY" }, { authorityClass: "ENGINEERING_DESIGN" }, { consistent: true, dimension: "standards" });
  assert.equal(agree.state, "ENGINEERING_MUST_SATISFY_REGULATION");
  assert.equal(agree.blocking, false);
  const clash = resolveCrossDomainConflict({ authorityClass: "REGULATORY" }, { authorityClass: "ENGINEERING_DESIGN" }, { consistent: false, dimension: "standards" });
  assert.equal(clash.state, "REGULATORY_CONFLICT");
  assert.equal(clash.blocking, true);
});

test("project/regulatory requirement vs product claim: requirement defines, product verifies; mismatch is a technical conflict", () => {
  const ok = resolveCrossDomainConflict({ authorityClass: "PROJECT_CONTRACT" }, { authorityClass: "PRODUCT_TECHNICAL" }, { consistent: true, dimension: "voltage" });
  assert.equal(ok.state, "REQUIREMENT_DEFINES_PRODUCT_VERIFIES");
  assert.equal(ok.blocking, false);
  const mismatch = resolveCrossDomainConflict({ authorityClass: "REGULATORY" }, { authorityClass: "PRODUCT_TECHNICAL" }, { consistent: false, dimension: "ip_rating" });
  assert.equal(mismatch.state, "TECHNICAL_CONFLICT");
  assert.equal(mismatch.blocking, true);
});

test("CERTIFICATION_LISTING vs PRODUCT_TECHNICAL: each authoritative only for its own scope; no universal winner", () => {
  const agree = resolveCrossDomainConflict({ authorityClass: "CERTIFICATION_LISTING" }, { authorityClass: "PRODUCT_TECHNICAL" }, { consistent: true, dimension: "certification_listing" });
  assert.equal(agree.state, "EXACT_SCOPE_EACH");
  assert.equal(agree.blocking, false);
  const clash = resolveCrossDomainConflict({ authorityClass: "CERTIFICATION_LISTING" }, { authorityClass: "PRODUCT_TECHNICAL" }, { consistent: false, dimension: "certification_listing" });
  assert.equal(clash.state, "CERTIFICATION_CONFLICT");
  assert.equal(clash.blocking, true);
});

test("COMMERCIAL / HISTORICAL / AI never override technical authority", () => {
  const commercial = resolveCrossDomainConflict({ authorityClass: "COMMERCIAL" }, { authorityClass: "PRODUCT_TECHNICAL" }, { consistent: true, dimension: "voltage" });
  assert.equal(commercial.state, "COMMERCIAL_NEVER_OVERRIDES");
  assert.equal(commercial.blocking, true);
  const historical = resolveCrossDomainConflict({ authorityClass: "HISTORICAL_ORGANIZATIONAL" }, { authorityClass: "PRODUCT_TECHNICAL" }, { consistent: true, dimension: "mounting" });
  assert.equal(historical.state, "HISTORICAL_NEVER_OVERRIDES");
  const ai = resolveCrossDomainConflict({ authorityClass: "AI_INFERENCE" }, { authorityClass: "PRODUCT_TECHNICAL" }, { consistent: true, dimension: "addressing" });
  assert.equal(ai.state, "AI_NEVER_OVERRIDES");
  assert.equal(ai.blocking, true);
});

test("within-domain: same class agrees, contradicts (blocking), or is superseded (blocking)", () => {
  const agree = resolveCrossDomainConflict({ authorityClass: "PROJECT_CONTRACT" }, { authorityClass: "PROJECT_CONTRACT" }, { consistent: true });
  assert.equal(agree.state, "AGREES");
  assert.equal(agree.blocking, false);
  const clash = resolveCrossDomainConflict({ authorityClass: "REGULATORY" }, { authorityClass: "REGULATORY" }, { consistent: false, dimension: "standards" });
  assert.equal(clash.state, "CONFLICTS");
  assert.equal(clash.blocking, true);
  const superseded = resolveCrossDomainConflict({ authorityClass: "PRODUCT_TECHNICAL" }, { authorityClass: "PRODUCT_TECHNICAL" }, { consistent: true, superseded: true, dimension: "voltage" });
  assert.equal(superseded.state, "SUPERSEDED");
  assert.equal(superseded.blocking, true, "a superseded source can never clear a gate");
});

test("unknown classes fail closed to INSUFFICIENT_AUTHORITY / UNKNOWN_PRECEDENCE -- never a fabricated winner", () => {
  const unknown = resolveCrossDomainConflict({ authorityClass: null }, { authorityClass: "PRODUCT_TECHNICAL" }, { consistent: false });
  assert.equal(unknown.state, "INSUFFICIENT_AUTHORITY");
  assert.equal(unknown.blocking, true);
  const unpaired = resolveCrossDomainConflict({ authorityClass: "COMMERCIAL" }, { authorityClass: "REGULATORY" }, { consistent: true });
  assert.equal(unpaired.state, "UNKNOWN_PRECEDENCE");
  assert.equal(unpaired.blocking, true);
  assert.equal(UNKNOWN_PRECEDENCE, "UNKNOWN_PRECEDENCE");
});

test("fail-safe helpers block toward clarification, never resolve", () => {
  const ia = insufficientAuthority("capacity");
  assert.equal(ia.state, "INSUFFICIENT_AUTHORITY");
  assert.equal(ia.blocking, true);
  const me = missingEvidence("voltage");
  assert.equal(me.state, "MISSING_EVIDENCE");
  assert.equal(me.blocking, true);
});

// ---------------------------------------------------------------------------
// Evidence kinds (4A-4) -- explicit / derived / inferred trust.
// ---------------------------------------------------------------------------
test("EXPLICIT is source-backed, DERIVED requires a complete trace, INFERRED stays inferred", () => {
  assert.equal(classifyEvidenceKind({ hasSource: true }), "EXPLICIT");
  assert.equal(classifyEvidenceKind({ declaredKind: "INFERRED" }), "INFERRED");
  const derived = {
    ruleId: "slc.loop-and-expansion",
    ruleVersion: "1.0.0",
    inputs: [{ name: "detectors", value: 185 }],
    inputProvenance: [{ sourceId: "src-project-bom" }],
    formula: "CEILING(demand / perLoop)",
    output: { requiredLoops: 2 },
    executionStatus: "COMPLETED",
    sourceFacts: [{ factId: "fact-demand" }],
  };
  assert.equal(isDerivedEvidenceComplete(derived), true);
  assert.equal(classifyEvidenceKind({ derivedTrace: derived }), "DERIVED");
  assert.equal(isDerivedEvidenceComplete({ ...derived, ruleVersion: undefined }), false);
  assert.equal(isDerivedEvidenceComplete({ ...derived, inputProvenance: [] }), false, "inputs without provenance break the derivation contract");
});

test("inference can never be promoted to explicit by confidence", () => {
  assert.equal(promoteEvidenceKind("INFERRED", 99), "INFERRED");
  assert.equal(promoteEvidenceKind("INFERRED", 0), "INFERRED");
  assert.equal(promoteEvidenceKind("EXPLICIT", 1), "EXPLICIT");
  assert.equal(evidenceKindTrust("EXPLICIT", "INFERRED"), "EXPLICIT");
  assert.equal(evidenceKindTrust("DERIVED", "INFERRED"), "DERIVED");
  assert.equal(evidenceKindTrust("EXPLICIT", "DERIVED"), null, "no blanket winner between two governed kinds");
});