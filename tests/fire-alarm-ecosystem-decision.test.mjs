// SLICE 2B -- GOVERNED PROJECT FIRE ALARM ECOSYSTEM DECISION TESTS.
//
// WHAT THIS SUITE PROVES.
//
// The governed project ecosystem decision is a PROJECT REQUIREMENT BASIS. It
// supplies the restored Technical Requirement Engine with a NAMED, human-decided
// compatibility target -- and nothing else.
//
// It is deliberately adversarial about the four ways this could go dishonest:
//   * a decision that does not exist must leave the engine failing closed;
//   * a decision must NOT make an item "Ready for Matching" on its own;
//   * a decision must NOT be satisfiable by protocol text, a manufacturer name,
//     a family, or generic source-fact evidence;
//   * a decision must NEVER claim a product is compatible.
//
// It also pins the R11 fail-closed, source-fact, project-precedence and drawing
// architecture behaviour of the restored engine, so a future Slice 2B change
// that weakened any of them would fail HERE rather than silently in production.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  BLOCKING_ECOSYSTEM_ELIGIBILITY,
  ECOSYSTEM_ELIGIBILITY,
  ECOSYSTEM_INTERFACE_METHODS,
  FIRE_ALARM_ECOSYSTEM_BASIS_VERSION,
  NON_SUBSTITUTABLE_EVIDENCE_CLASSES,
  buildEcosystemRequirementBasis,
  classifyEcosystemCompatibility,
  ecosystemBasisRelationships,
} from "../app/domain/fire-alarm-ecosystem-requirement-basis.mjs";
import {
  validateProjectFireAlarmEcosystemDecision,
  MUST_REMAIN_UNRESOLVED,
} from "../app/domain/fire-alarm-ecosystem-decision.mjs";
import {
  REQUIREMENT_RULESET_VERSION,
  buildTechnicalRequirementProfile,
  detectMissingInformation,
} from "../app/domain/technical-requirement-engine.mjs";

// ---------------------------------------------------------------------------
// A REAL governed decision, built through the parked validator so the whole
// governed chain is exercised rather than a hand-typed object.
// ---------------------------------------------------------------------------
const governedInput = {
  ecosystem: "NOTIFIER",
  primaryProtocol: "FlashScan",
  allowedLegacyProtocols: ["CLIP"],
  preliminaryPanelFamily: { key: "INSPIRE_N16", isSelected: false, isConsultantApproved: false },
  complianceBasisState: "PARTIALLY_RESOLVED",
  contractualManufacturerAcceptance: "CONSULTANT_APPROVAL_REQUIRED",
  substitutionAuthority: "HUMAN_APPROVAL_REQUIRED",
  directMatchPolicy: "Addressable devices must be Notifier ecosystem; third-party permitted only via proven supervised interfaces.",
  notDirectMatchEcosystems: ["SIMPLEX"],
  appliesWhile: "This project's Fire Alarm system, as governed by the current specification version.",
  evidence: ["28 46 00 Fire Detection and Alarm System"],
  reason: "Project documents name FlashScan/CLIP references without mandating a manufacturer; adopt Notifier as the governed technical design basis.",
  decidedBy: "engineer-1",
  decidedRole: "Technical Manager",
  specificationVersion: "SPEC-28-46-00-rev-3",
};

const current = {
  id: "ecosystemDecision_test",
  projectId: "project_test",
  decidedAt: "2026-09-29T00:00:00.000Z",
  decision: validateProjectFireAlarmEcosystemDecision(governedInput),
};

const panel = {
  id: "boqitem_1",
  itemNumber: "1",
  system: "Fire Alarm",
  category: "Control Equipment",
  productFamily: "Fire Alarm Control Panel",
  description: "Addressable fire alarm control panel",
  unit: "EA",
  quantity: 1,
  classificationConfidence: 90,
};

const compatGap = (profile) => profile.missingInformation.find((entry) => entry.field === "compatibilityTarget");

// ===========================================================================
test("Slice 2B-1. the governed decision yields a named, project-scoped basis", async (t) => {
  await t.test("the basis names a real compatibility target", () => {
    const basis = buildEcosystemRequirementBasis(current);
    assert.ok(basis, "a governed decision must produce a basis");
    assert.equal(basis.ecosystem, "NOTIFIER");
    assert.equal(basis.compatibilityTarget, "Notifier Fire Alarm ecosystem (FlashScan / CLIP)");
    assert.equal(basis.basisVersion, FIRE_ALARM_ECOSYSTEM_BASIS_VERSION);
  });

  await t.test("the engine relationship is explicitly project-scoped, not scope-absent", () => {
    const rel = buildEcosystemRequirementBasis(current).compatibilityRelationship;
    assert.equal(rel.scopeType, "Project");
    assert.equal(rel.scopeId, "project_test");
    assert.equal(rel.relationshipType, "Compatible With");
    assert.equal(rel.targetItem, "Notifier Fire Alarm ecosystem (FlashScan / CLIP)");
  });

  await t.test("no decision yields null basis and an EMPTY relationship array", () => {
    assert.equal(buildEcosystemRequirementBasis(null), null);
    assert.deepEqual(ecosystemBasisRelationships(null), [],
      "spreading [] must be a no-op so the engine keeps failing closed");
  });

  await t.test("the basis never claims product compatibility", () => {
    const basis = buildEcosystemRequirementBasis(current);
    assert.equal(basis.productCompatibilityClaimed, false);
    assert.equal(basis.compatibilityRelationship.productCompatibilityClaimed, false);
    assert.equal(basis.compatibilityRelationship.productCompatibilityState, "NOT_EVALUATED_NO_PRODUCT_EVIDENCE");
    assert.equal(basis.compatibilityRelationship.scope, "PROJECT_REQUIREMENT");
    assert.equal(basis.compatibilityRelationship.basis, "HUMAN_ENGINEERING_DECISION");
  });

  await t.test("the non-substitutable evidence classes are declared on the record", () => {
    const basis = buildEcosystemRequirementBasis(current);
    for (const cls of NON_SUBSTITUTABLE_EVIDENCE_CLASSES) {
      assert.ok(basis.nonSubstitutableEvidenceClasses.includes(cls), `must declare ${cls} non-substitutable`);
    }
  });
});

// ===========================================================================
test("Slice 2B-2. WITHOUT a decision the engine is unchanged and fails closed", () => {
  const withoutBasis = buildTechnicalRequirementProfile({ boqItem: panel, relationships: [] });
  const gap = compatGap(withoutBasis);
  assert.ok(gap, "compatibilityTarget must still be reported with no governed decision");
  assert.equal(gap.blocking, true, "and it must still BLOCK");
  assert.equal(withoutBasis.readiness.status, "Missing Critical Information");
});

test("Slice 2B-3. WITH a decision the target is named, but readiness is NOT granted", () => {
  const withBasis = buildTechnicalRequirementProfile({
    boqItem: panel,
    relationships: ecosystemBasisRelationships(current),
  });

  assert.equal(compatGap(withBasis), undefined,
    "a genuinely named governed target clears the gap");

  assert.notEqual(withBasis.readiness.status, "Ready for Matching",
    "an ecosystem basis alone must never make a Fire Alarm item ready for matching");
  assert.equal(withBasis.readiness.status, "Needs Technical Review",
    "it moves to technical review, which is the honest state");

  assert.equal(withBasis.compatibility.length, 1);
  assert.equal(withBasis.compatibility[0].productCompatibilityClaimed, false);
  assert.equal(withBasis.compatibility.some((entry) => entry.productCompatibilityClaimed === true), false,
    "no compatibility entry may claim a product is compatible");
});

// ===========================================================================
test("Slice 2B-4. NO DISHONEST SATISFACTION -- only the governed decision clears the target", async (t) => {
  // Each of these is a real, non-empty compatibility input that the restored
  // engine must still treat as NOT naming a target.
  const mustNotClear = [
    ["a protocol string alone", [{ relationshipType: "Compatible With", targetItem: "", value: "FlashScan" }]],
    ["a manufacturer name alone", [{ relationshipType: "Compatible With", targetItem: "", manufacturer: "Honeywell" }]],
    ["an unreviewed internet claim", [{ relationshipType: "Compatible With", targetItem: "", source: "Reseller page", confidence: 90 }]],
    ["product-family similarity", [{ relationshipType: "Compatible With", targetItem: "", productFamily: "Fire Alarm Control Panel" }]],
  ];

  for (const [label, compatibility] of mustNotClear) {
    await t.test(`${label} does not clear compatibilityTarget`, () => {
      const profile = buildTechnicalRequirementProfile({ boqItem: panel, relationships: compatibility });
      const gap = compatGap(profile);
      assert.ok(gap, `${label} must NOT satisfy compatibilityTarget`);
      assert.equal(gap.blocking, true, `${label} must leave the gap BLOCKING`);
    });
  }

  await t.test("generic Source Fact protocol evidence does not clear it", () => {
    const profile = buildTechnicalRequirementProfile({
      boqItem: panel,
      sourceFacts: [{
        factId: "sf-proto",
        predicate: "protocol_compatibility",
        value: "FlashScan, CLIP",
        unit: null,
        confidence: 95,
        scopeType: "BOQ Item",
        scopeId: panel.id,
        factType: "Source Fact",
        status: "Active",
      }],
      relationships: [],
    });
    const gap = compatGap(profile);
    assert.ok(gap, "a Source Fact protocol claim must NOT satisfy compatibilityTarget");
    assert.equal(gap.blocking, true);

    // ...and the engine still records it as non-blocking EVIDENCE.
    const evidence = profile.compatibility.find((entry) => entry.source === "Source Fact");
    assert.ok(evidence, "the Source Fact is still recorded as compatibility evidence");
    assert.equal(evidence.blocking, false);
    assert.equal(evidence.status, "Evidence");
  });
});

// ===========================================================================
test("Slice 2B-5. INVARIANT 2 -- addressable devices stay inside the decided ecosystem", async (t) => {
  const inEcosystem = classifyEcosystemCompatibility(current, {
    manufacturer: "NOTIFIER",
    ecosystem: "NOTIFIER",
    category: "Control Equipment",
    productFamily: "Fire Alarm Control Panel",
    interfaceMethod: ECOSYSTEM_INTERFACE_METHODS.DIRECT_ADDRESSABLE,
  });
  assert.equal(inEcosystem.eligibility, ECOSYSTEM_ELIGIBILITY.ADDRESSABLE_WITHIN_ECO_SYSTEM);
  assert.equal(inEcosystem.blocking, false);
  assert.equal(inEcosystem.productCompatibilityClaimed, false, "eligibility is never a match");
  assert.equal(inEcosystem.compatibilityTargetSatisfiedByThis, false);

  await t.test("an addressable device from another ecosystem is BLOCKED", () => {
    const outside = classifyEcosystemCompatibility(current, {
      manufacturer: "Simplex",
      ecosystem: "SIMPLEX",
      category: "Control Equipment",
      productFamily: "Fire Alarm Control Panel",
      interfaceMethod: ECOSYSTEM_INTERFACE_METHODS.DIRECT_ADDRESSABLE,
    });
    assert.equal(outside.eligibility, ECOSYSTEM_ELIGIBILITY.ADDRESSABLE_OUTSIDE_ECO_SYSTEM_BLOCKED);
    assert.equal(outside.blocking, true);
    assert.ok(BLOCKING_ECOSYSTEM_ELIGIBILITY.includes(outside.eligibility));
  });

  await t.test("a shared parent manufacturer does NOT make an out-of-ecosystem device eligible", () => {
    // Farenhyt and Notifier are both Honeywell brands. That is not compatibility.
    const outside = classifyEcosystemCompatibility(current, {
      manufacturer: "Honeywell Farenhyt",
      ecosystem: "FARENHYT",
      category: "Control Equipment",
      productFamily: "Fire Alarm Control Panel",
      interfaceMethod: ECOSYSTEM_INTERFACE_METHODS.DIRECT_ADDRESSABLE,
    });
    assert.equal(outside.eligibility, ECOSYSTEM_ELIGIBILITY.ADDRESSABLE_OUTSIDE_ECO_SYSTEM_BLOCKED);
    assert.equal(outside.blocking, true, "same parent company must never imply compatibility");
  });

  await t.test("only recorded approved compatible-integration evidence admits an outsider", () => {
    const approved = classifyEcosystemCompatibility(current, {
      manufacturer: "Honeywell Farenhyt",
      ecosystem: "FARENHYT",
      category: "Control Equipment",
      productFamily: "Fire Alarm Control Panel",
      interfaceMethod: ECOSYSTEM_INTERFACE_METHODS.DIRECT_ADDRESSABLE,
      governedCompatibleIntegrationEvidence: true,
    });
    assert.equal(approved.eligibility, ECOSYSTEM_ELIGIBILITY.THIRD_PARTY_INTERFACE_ELIGIBLE);
    assert.equal(approved.blocking, false);
    assert.match(approved.conditionalOn, /reviewed/);
  });

  await t.test("an addressable candidate with unresolved identity is BLOCKED, not guessed", () => {
    const unknown = classifyEcosystemCompatibility(current, {
      category: "Control Equipment",
      productFamily: "Fire Alarm Control Panel",
      interfaceMethod: ECOSYSTEM_INTERFACE_METHODS.DIRECT_ADDRESSABLE,
    });
    assert.equal(unknown.eligibility, ECOSYSTEM_ELIGIBILITY.CANDIDATE_IDENTITY_UNRESOLVED);
    assert.equal(unknown.blocking, true);
  });
});

// ===========================================================================
test("Slice 2B-6. INVARIANT 3 -- third-party devices on proven supervised interfaces stay eligible", async (t) => {
  for (const method of [
    ECOSYSTEM_INTERFACE_METHODS.DRY_CONTACT,
    ECOSYSTEM_INTERFACE_METHODS.MONITORED_INPUT,
    ECOSYSTEM_INTERFACE_METHODS.MONITORED_OUTPUT,
  ]) {
    await t.test(`${method} with proven supervision is eligible`, () => {
      const verdict = classifyEcosystemCompatibility(current, {
        manufacturer: "Third Party Devices Ltd",
        category: "Control Equipment",
        productFamily: "Fire Alarm Control Panel",
        interfaceMethod: method,
        supervisionProven: true,
      });
      assert.equal(verdict.eligibility, ECOSYSTEM_ELIGIBILITY.THIRD_PARTY_INTERFACE_ELIGIBLE);
      assert.equal(verdict.blocking, false, "a proven supervised interface is not ecosystem-locked");
      assert.ok(verdict.supervisionRequirement, "the supervision requirement must be stated");
    });

    await t.test(`${method} with UNPROVEN supervision is BLOCKED`, () => {
      const verdict = classifyEcosystemCompatibility(current, {
        manufacturer: "Third Party Devices Ltd",
        category: "Control Equipment",
        productFamily: "Fire Alarm Control Panel",
        interfaceMethod: method,
        supervisionProven: false,
      });
      assert.equal(verdict.eligibility, ECOSYSTEM_ELIGIBILITY.THIRD_PARTY_INTERFACE_UNPROVEN_BLOCKED);
      assert.equal(verdict.blocking, true, "third-party must not be assumed proven");
    });
  }

  await t.test("third-party devices are NOT treated as incompatible merely for being third-party", () => {
    const verdict = classifyEcosystemCompatibility(current, {
      manufacturer: "Third Party Devices Ltd",
      category: "Control Equipment",
      interfaceMethod: ECOSYSTEM_INTERFACE_METHODS.DRY_CONTACT,
      supervisionProven: true,
    });
    assert.equal(verdict.eligibility, ECOSYSTEM_ELIGIBILITY.THIRD_PARTY_INTERFACE_ELIGIBLE);
    assert.equal(verdict.blocking, false);
  });
});

// ===========================================================================
test("Slice 2B-7. INVARIANT 5 -- every unresolved case fails closed", async (t) => {
  await t.test("no governed decision blocks", () => {
    const verdict = classifyEcosystemCompatibility(null, { manufacturer: "NOTIFIER", category: "Control Equipment" });
    assert.equal(verdict.eligibility, ECOSYSTEM_ELIGIBILITY.NO_GOVERNED_DECISION);
    assert.equal(verdict.blocking, true);
  });

  await t.test("the decision has no meaning outside Fire Alarm", () => {
    const verdict = classifyEcosystemCompatibility(current, { system: "CCTV", category: "Camera" });
    assert.equal(verdict.eligibility, ECOSYSTEM_ELIGIBILITY.NO_GOVERNED_DECISION);
    assert.equal(verdict.blocking, true);
  });

  await t.test("an unknown interface method is never silently treated as non-addressable", () => {
    const verdict = classifyEcosystemCompatibility(current, {
      manufacturer: "Third Party Devices Ltd",
      category: "Control Equipment",
      productFamily: "Fire Alarm Control Panel",
      interfaceMethod: "SOME_UNGOVERNED_METHOD",
      supervisionProven: true,
    });
    assert.equal(verdict.eligibility, ECOSYSTEM_ELIGIBILITY.ADDRESSABLE_OUTSIDE_ECO_SYSTEM_BLOCKED);
    assert.equal(verdict.blocking, true, "an unrecognised method must fail closed");
  });

  await t.test("every verdict carries productCompatibilityClaimed=false and targetSatisfiedByThis=false", () => {
    const verdicts = [
      classifyEcosystemCompatibility(current, { manufacturer: "NOTIFIER", ecosystem: "NOTIFIER", category: "Control Equipment", productFamily: "Fire Alarm Control Panel", interfaceMethod: ECOSYSTEM_INTERFACE_METHODS.DIRECT_ADDRESSABLE }),
      classifyEcosystemCompatibility(current, { manufacturer: "Simplex", ecosystem: "SIMPLEX", category: "Control Equipment", productFamily: "Fire Alarm Control Panel", interfaceMethod: ECOSYSTEM_INTERFACE_METHODS.DIRECT_ADDRESSABLE }),
      classifyEcosystemCompatibility(current, { manufacturer: "Acme", category: "Control Equipment", interfaceMethod: ECOSYSTEM_INTERFACE_METHODS.DRY_CONTACT, supervisionProven: true }),
      classifyEcosystemCompatibility(null, {}),
    ];
    for (const verdict of verdicts) {
      assert.equal(verdict.productCompatibilityClaimed, false);
      assert.equal(verdict.compatibilityTargetSatisfiedByThis, false);
    }
  });
});

// ===========================================================================
test("Slice 2B-8. INVARIANT 1 -- the decision is not compliance, and not a document rewrite", async (t) => {
  await t.test("the ruleset version is still the R11 fail-closed ruleset", () => {
    assert.match(REQUIREMENT_RULESET_VERSION, /fail-closed-panel-compat/,
      "Slice 2B must not weaken or replace the restored R11 ruleset");
  });

  await t.test("compliance fields that must stay unresolved are still unresolved", () => {
    const basis = buildEcosystemRequirementBasis(current);
    const unresolved = current.decision.complianceBasis.unresolved.map((entry) => entry.field);
    for (const field of MUST_REMAIN_UNRESOLVED) {
      assert.ok(unresolved.includes(field), `${field} must remain an explicitly unresolved field`);
    }
    assert.equal(basis.contractualManufacturerAcceptance, "CONSULTANT_APPROVAL_REQUIRED",
      "the decision must not approve the manufacturer contractually");
    assert.equal(basis.substitutionAuthority, "HUMAN_APPROVAL_REQUIRED");
  });

  await t.test("the decision is bounded to the specification version it was made against", () => {
    assert.equal(buildEcosystemRequirementBasis(current).specificationVersion, "SPEC-28-46-00-rev-3");
  });

  await t.test("a project requirement basis is not a project document rewrite", () => {
    // The basis records a decision, decided by a human, against a version. It
    // must never present itself as the specification having named a manufacturer.
    const basis = buildEcosystemRequirementBasis(current);
    assert.equal(basis.compatibilityRelationship.scope, "PROJECT_REQUIREMENT");
    assert.equal(basis.compatibilityRelationship.authority, "PROJECT_ECOSYSTEM_DECISION");
    assert.ok(basis.decidedBy, "a human actor must be recorded");
    assert.ok(basis.decidedRole, "the deciding role must be recorded");
  });
});

// ===========================================================================
test("Slice 2B-9. NON-REGRESSION -- restored engine behaviour is untouched by the basis", async (t) => {
  await t.test("project precedence and source facts are unaffected when no basis exists", () => {
    const profile = buildTechnicalRequirementProfile({
      boqItem: panel,
      relationships: [],
      sourceFacts: [{
        factId: "sf-1",
        predicate: "protocol_compatibility",
        value: "FlashScan",
        unit: null,
        confidence: 95,
        scopeType: "BOQ Item",
        scopeId: panel.id,
        factType: "Source Fact",
        status: "Active",
      }],
    });
    assert.equal(profile.technicalFacts.length, 1, "source facts must still be consumed");
    assert.equal(compatGap(profile).blocking, true, "and must still not satisfy the target");
  });

  await t.test("the basis does not suppress R11 fail-closed panel compatibility", () => {
    const withBasis = buildTechnicalRequirementProfile({
      boqItem: panel,
      relationships: ecosystemBasisRelationships(current),
    });
    // The ecosystem basis names a target; it must not silently relax the
    // remaining governed panel-compatibility confidence requirement.
    const required = withBasis.confidence;
    assert.ok(typeof required.overall === "number");
    assert.notEqual(withBasis.readiness.status, "Ready for Matching",
      "R11 fail-closed must still require review, not auto-approve");
  });

  await t.test("drawing architecture context still flows through untouched", () => {
    const profile = buildTechnicalRequirementProfile({
      boqItem: panel,
      relationships: ecosystemBasisRelationships(current),
      drawingArchitectureContext: { version: "v1", available: true, status: "Approved", evidenceCount: 2 },
    });
    assert.ok("drawingArchitectureContext" in profile, "the context must still be returned");
    assert.equal(compatGap(profile), undefined, "and the basis must still clear the target");
  });

  await t.test("detectMissingInformation keeps its own single-argument contract", () => {
    assert.equal(detectMissingInformation.length, 1,
      "the engine's gap detector must keep its destructured options object");
  });
});

// ===========================================================================
test("Slice 2B-10. ENGINE PURITY -- Slice 2B must not contaminate the restored engine", async (t) => {
  const engineSource = await readFile(
    new URL("../app/domain/technical-requirement-engine.mjs", import.meta.url),
    "utf8",
  );

  await t.test("the engine names NO ecosystem vocabulary", () => {
    // Independently pinned by golden-4:499-503 and golden-5:801-806. The engine
    // must stay ecosystem-agnostic; Slice 2B supplies the target from OUTSIDE it.
    assert.doesNotMatch(engineSource, /Honeywell|Notifier|Farenhyt|Gent|Gamewell|Simplex/i,
      "the requirement engine must never import or branch on a manufacturer ecosystem");
  });

  await t.test("the engine does not import the ecosystem decision or basis modules", () => {
    assert.doesNotMatch(engineSource, /fire-alarm-ecosystem/,
      "the engine must not depend on the ecosystem slice in any direction");
  });

  await t.test("the engine still carries the R11 fail-closed ruleset and restored features", () => {
    assert.match(engineSource, /fail-closed-panel-compat/);
    assert.match(engineSource, /statusAwareSourceAuthority/);
    assert.match(engineSource, /sourceFactCompatibility/);
    assert.match(engineSource, /drawingArchitectureContext/);
  });

  await t.test("the basis module is the ONLY place the vocabulary is applied", async () => {
    const basisSource = await readFile(
      new URL("../app/domain/fire-alarm-ecosystem-requirement-basis.mjs", import.meta.url),
      "utf8",
    );
    // The basis consumes the decision; it does not redefine the vocabulary.
    assert.match(basisSource, /from "\.\/fire-alarm-ecosystem-decision\.mjs"/);
    assert.doesNotMatch(basisSource, /const PROJECT_ECOSYSTEM_VOCABULARY/,
      "the governed vocabulary must have exactly one definition");
  });
});
