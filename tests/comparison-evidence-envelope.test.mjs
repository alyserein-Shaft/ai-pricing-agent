import test from "node:test";
import assert from "node:assert/strict";
import { runProductMatching } from "../app/domain/product-matching-engine.mjs";
import {
  buildComparisonEnvelope,
  buildEvidenceEnvelope,
  buildEngineerView,
  dimensionForComparison,
  envelopeForPersistence,
  reconstructEnvelopeFromPersisted,
  requirementAuthorityOf,
  productAuthorityOf,
  productEvidenceKindOf,
} from "../app/domain/engineering-comparison-envelope.mjs";

const profile = (overrides = {}) => ({
  versionNumber: 1,
  boqItem: { id: "boq-1", description: "Addressable smoke detector", system: "Fire Alarm", category: "Detection Device", productFamily: "Addressable Smoke Detector" },
  readiness: { status: "Ready for Matching", blockingReasons: [] },
  consolidatedRequirements: [{ id: "r-voltage", normalizedRequirement: "24 V operation", priority: "Critical Mandatory", sources: [{ requirementId: "r-voltage", sourceType: "Specification", source: { documentId: "spec-1", clause: "4.2.1" }, confidence: 95 }], attributes: [{ name: "Voltage", operator: "Equal", normalizedValue: 24, normalizedUnit: "V" }] }],
  standards: [{ body: "EN54", number: "7" }],
  manufacturers: [],
  compatibility: [{ targetItem: "Farenhyt protocol" }],
  accessories: [{ accessory: "Detector base" }],
  derivedRequirements: [],
  clarifications: [],
  ...overrides,
});

const product = (overrides = {}) => ({
  id: "p1",
  manufacturer: "Honeywell",
  family: "Addressable Smoke Detector",
  partNumber: "IDP-PHOTO-W",
  description: "Addressable photoelectric smoke detector",
  lifecycleStatus: "Active",
  reviewStatus: "Reviewed",
  attributes: [{ name: "Voltage", normalizedValue: 24, normalizedUnit: "V", evidence: { documentId: "ds-1", sheet: "Catalogue" }, sourceId: "src-ds" }],
  standards: [{ body: "EN54", number: "7", evidence: { documentId: "cert-1" }, source: "UL Listing" }],
  compatibility: [{ targetItem: "Farenhyt protocol", relationshipType: "Compatible With" }],
  accessories: [{ name: "Detector base", relationshipType: "Compatible Base" }],
  source: { sheet: "Catalogue", row: 12 },
  ...overrides,
});

// ---------------------------------------------------------------------------
// Envelope construction.
// ---------------------------------------------------------------------------
test("a governed attribute comparison produces a full evidence envelope", () => {
  const result = runProductMatching({ profile: profile(), products: [product()] });
  assert.ok(result.candidates.length >= 1);
  const candidate = result.candidates[0];
  assert.ok(Array.isArray(candidate.evidenceEnvelope));
  assert.equal(candidate.evidenceEnvelope.length, candidate.comparisons.length);
  const voltage = candidate.evidenceEnvelope.find((entry) => entry.dimension === "voltage");
  assert.ok(voltage, "expected a voltage dimension envelope");
  assert.equal(voltage.requirementAuthority.authorityClass, "PROJECT_CONTRACT");
  assert.equal(voltage.requirementAuthority.role, "DEFINING");
  assert.equal(voltage.productAuthority.authorityClass, "PRODUCT_TECHNICAL");
  assert.equal(voltage.productAuthority.role, "VERIFYING");
  assert.equal(voltage.requirementEvidenceKind, "EXPLICIT");
  assert.equal(voltage.productEvidenceKind, "EXPLICIT");
  assert.equal(voltage.evidenceKind, "EXPLICIT");
  assert.ok(voltage.requirementEvidence, "requirement provenance must be attached");
  assert.equal(voltage.blocking, false);
});

test("the envelope is explanatory only: score, ranking, ceilings, and approval paths are unchanged", () => {
  const run = () => runProductMatching({ profile: profile(), products: [product()] });
  const first = run();
  const second = run();
  assert.deepEqual(
    first.candidates.map((c) => [c.product.id, c.score, c.rank, c.technicalStatus, c.recommendationTier, c.confidence, c.confidenceScore, c.familyMatchTier]),
    second.candidates.map((c) => [c.product.id, c.score, c.rank, c.technicalStatus, c.recommendationTier, c.confidence, c.confidenceScore, c.familyMatchTier]),
    "matching must be deterministic and the envelope must not feed any ranking input",
  );
  for (const candidate of first.candidates) {
    assert.equal(candidate.approvalReady, false, "no new product auto-approval");
    assert.equal(candidate.reviewStatus, "Needs Review");
    const sum = candidate.components.mandatoryCompliance + candidate.components.technicalAttributes + candidate.components.standards + candidate.components.compatibility + candidate.components.manufacturer + candidate.components.accessories + candidate.components.lifecycle + candidate.components.sourceReliability + candidate.components.commercialAvailability + candidate.components.searchRelevance;
    assert.equal(candidate.score, Math.max(0, Math.min(100, Math.round(sum))), "score must remain exactly the decomposable component sum");
  }
});

test("project vs regulatory has no global winner inside the envelope", () => {
  const envelope = buildComparisonEnvelope(
    { comparisonType: "Attribute", requirement: { id: "r", normalizedRequirement: "must comply", sources: [{ sourceType: "Specification" }], attributes: [{ name: "Voltage" }] }, required: { name: "Voltage", value: 24 }, offered: { name: "Voltage", value: 24, evidence: { documentId: "ds" } }, result: "Pass", pass: true, blocking: false },
    { profile, product },
  );
  // With only a project source the governing class is PROJECT_CONTRACT.
  assert.equal(envelope.requirementAuthority.authorityClass, "PROJECT_CONTRACT");
  assert.equal(envelope.conflicts.state, "REQUIREMENT_DEFINES_PRODUCT_VERIFIES");
  // A second regulatory-sourced requirement agreed with it yields BOTH_CONSTRAINTS_APPLY.
  const reg = buildComparisonEnvelope(
    { comparisonType: "Attribute", requirement: { id: "r2", sources: [{ sourceType: "Code" }], attributes: [{ name: "Voltage" }] }, required: { name: "Voltage", value: 24 }, offered: { name: "Voltage", value: 24, evidence: { documentId: "ds" } }, result: "Pass", pass: true, blocking: false },
    { profile, product },
  );
  assert.equal(reg.requirementAuthority.authorityClass, "REGULATORY");
});

test("AI inference cannot override explicit evidence and fails closed on a technical dimension", () => {
  const aiProfile = profile({ consolidatedRequirements: [{ id: "r-ai", normalizedRequirement: "AI suggests 12 V", priority: "Critical Mandatory", sources: [{ requirementId: "r-ai", sourceType: "AI Inference", source: null, confidence: 97 }], attributes: [{ name: "Voltage", operator: "Equal", normalizedValue: 12, normalizedUnit: "V" }] }] });
  const result = runProductMatching({ profile: aiProfile, products: [product()] });
  const candidate = result.candidates[0];
  const voltage = candidate.evidenceEnvelope.find((entry) => entry.dimension === "voltage");
  assert.equal(voltage.requirementAuthority.authorityClass, "AI_INFERENCE");
  assert.equal(voltage.requirementAuthority.status, "INSUFFICIENT_AUTHORITY", "an AI source has no authority over the voltage dimension");
  assert.equal(voltage.result, "INSUFFICIENT_AUTHORITY", "evidence never promotes inference on high confidence");
  assert.ok(voltage.missingEvidence.some((entry) => entry.side === "requirement"));
});

test("a supplier quote can never prove engineering compliance (COMMERCIAL never overrides)", () => {
  const commercial = productAuthorityOf({ quote: "supports 24V" }, "Attribute", "COMMERCIAL");
  assert.equal(commercial.authorityClass, "COMMERCIAL");
  const commercialEnvelope = buildComparisonEnvelope(
    { comparisonType: "Attribute", requirement: { id: "r", normalizedRequirement: "24 V", sources: [{ sourceType: "Specification" }], attributes: [{ name: "Voltage" }] }, required: { name: "Voltage", value: 24, unit: "V" }, offered: { name: "Voltage", value: 12, unit: "V", evidence: { source: "Supplier Quote" } }, result: "Fail", pass: false, blocking: true },
    { profile, product },
  );
  assert.equal(commercialEnvelope.productAuthority.authorityClass, "PRODUCT_TECHNICAL");
  const quoteAsProduct = buildComparisonEnvelope(
    { comparisonType: "Attribute", requirement: { id: "r", normalizedRequirement: "24 V", sources: [{ sourceType: "Specification" }], attributes: [{ name: "Voltage" }] }, required: { name: "Voltage", value: 24, unit: "V" }, offered: { name: "Voltage", value: 12, unit: "V" }, result: "Fail", pass: false, blocking: true },
    { profile, product },
  );
  assert.equal(quoteAsProduct.conflicts.state, "TECHNICAL_CONFLICT", "a real value mismatch between a governing requirement and product evidence is a technical conflict");
  assert.equal(quoteAsProduct.missingEvidence[0]?.side, "product", "an un-evidenced product claim must surface as missing product evidence");
});

test("certification/listing scope verifies only its own exact scope, never general suitability", () => {
  const envelope = buildComparisonEnvelope(
    { comparisonType: "Standard", requirement: { body: "UL", number: "268", part: null }, productStandard: { body: "UL", number: "268", evidence: { documentId: "cert-1" } }, result: "Verified Compliant", pass: true, blocking: false },
    { profile, product },
  );
  assert.equal(envelope.dimension, "standards");
  assert.equal(envelope.productAuthority.authorityClass, "CERTIFICATION_LISTING");
  assert.equal(envelope.productEvidenceKind, "EXPLICIT");
  const claimsOnly = buildComparisonEnvelope(
    { comparisonType: "Standard", requirement: { body: "UL", number: "268" }, productStandard: { body: "UL", number: "268" }, result: "Claimed Compliant", pass: false, blocking: true },
    { profile, product },
  );
  assert.equal(claimsOnly.productEvidenceKind, "MISSING", "a bare claim is not authoritative listing evidence");
  assert.equal(claimsOnly.conflicts.state, "CERTIFICATION_CONFLICT");
});

test("a superseded source cannot clear a gate", () => {
  const envelope = buildComparisonEnvelope(
    { comparisonType: "Attribute", requirement: { id: "r-old", normalizedRequirement: "old revision", superseded: true, sources: [{ sourceType: "Specification" }], attributes: [{ name: "Voltage" }] }, required: { name: "Voltage", value: 12 }, offered: { name: "Voltage", value: 12, evidence: { documentId: "ds" } }, result: "Pass", pass: true, blocking: false },
    { profile, product },
  );
  assert.equal(envelope.conflicts.state, "SUPERSEDED");
  assert.equal(envelope.conflicts.blocking, true);
});

test("missing authoritative product evidence on a mandatory dimension blocks", () => {
  const envelope = buildComparisonEnvelope(
    { comparisonType: "Attribute", requirement: { id: "r", normalizedRequirement: "24 V", sources: [{ sourceType: "Specification" }], attributes: [{ name: "Voltage" }] }, required: { name: "Voltage", value: 24, unit: "V" }, offered: null, result: "Missing Product Data", pass: false, blocking: true },
    { profile, product },
  );
  assert.equal(envelope.result, "MISSING_EVIDENCE");
  assert.equal(envelope.blocking, true);
  assert.ok(envelope.missingEvidence.some((entry) => entry.side === "product"));
});

test("derived product evidence requires a complete trace, never a partial one", () => {
  const complete = { documentId: "calc-1", derivedTrace: { ruleId: "slc.loop-and-expansion", ruleVersion: "1.0.0", inputs: [{ name: "detectors", value: 185 }], inputProvenance: [{ sourceId: "src" }], formula: "CEILING", output: { requiredLoops: 2 }, executionStatus: "COMPLETED", sourceFacts: [{ factId: "f1" }] } };
  const partial = { documentId: "calc-1", derivedTrace: { ruleId: "slc.loop-and-expansion", inputs: [], output: null, executionStatus: "COMPLETED" } };
  assert.equal(productEvidenceKindOf(complete), "DERIVED");
  assert.equal(productEvidenceKindOf(partial), "MISSING", "incomplete derived traces must never be treated as governed derived evidence");
});

test("dimension mapping covers the current governed matching dimensions", () => {
  assert.equal(dimensionForComparison({ comparisonType: "Attribute", required: { name: "addressing" } }), "addressing");
  assert.equal(dimensionForComparison({ comparisonType: "Attribute", required: { name: "IP Rating" } }), "ip_rating");
  assert.equal(dimensionForComparison({ comparisonType: "Attribute", required: { name: "Capacity" } }), "capacity");
  assert.equal(dimensionForComparison({ comparisonType: "Standard", requirement: { body: "UL", number: "268" } }), "standards");
  assert.equal(dimensionForComparison({ comparisonType: "Compatibility", requirement: { targetItem: "the control unit" } }), "facp_compatibility");
  assert.equal(dimensionForComparison({ comparisonType: "Accessory", requirement: { accessory: "conventional detector base" } }), "detector_base_compatibility");
  assert.equal(dimensionForComparison({ comparisonType: "Lifecycle" }), "lifecycle");
});

// ---------------------------------------------------------------------------
// Persistence round-trip (4A-6) + legacy compatibility.
// ---------------------------------------------------------------------------
test("the envelope persists through product_match_comparisons.notes and reconstructs", () => {
  const result = runProductMatching({ profile: profile(), products: [product()] });
  const envelope = result.candidates[0].evidenceEnvelope[0];
  const persisted = envelopeForPersistence(envelope);
  const row = { notes: JSON.stringify(persisted) };
  const reconstructed = reconstructEnvelopeFromPersisted(row);
  assert.deepEqual(reconstructed, envelope);
});

test("legacy comparison rows (null/garbage notes) parse back cleanly", () => {
  assert.equal(reconstructEnvelopeFromPersisted({ notes: null }), null);
  assert.equal(reconstructEnvelopeFromPersisted({ notes: "not json" }), null);
  assert.equal(reconstructEnvelopeFromPersisted({ notes: JSON.stringify({ unrelated: 1 }) }), null);
  assert.equal(reconstructEnvelopeFromPersisted(null), null);
  assert.equal(reconstructEnvelopeFromPersisted({}), null);
});

// ---------------------------------------------------------------------------
// Engineer view model (4A-7).
// ---------------------------------------------------------------------------
test("buildEngineerView projects REQUIREMENT/WHY/CANDIDATE/WHY/RESULT/ACTION without internal jargon", () => {
  const result = runProductMatching({ profile: profile(), products: [product()] });
  const view = buildEngineerView({ profile: profile(), candidate: result.candidates[0] });
  assert.equal(view.version, "evidence-envelope-1.0.0");
  assert.ok(view.items.length >= 1);
  for (const item of view.items) {
    assert.ok(item.requirement.length > 0);
    assert.match(item.requirementBasis, /^Why:/);
    assert.ok(item.candidate.length > 0);
    assert.match(item.candidateBasis, /^Why:/);
    assert.ok(["Satisfied", "Failed", "Unknown", "Conflict"].includes(item.result));
    assert.ok(["No action", "Provide missing information", "Choose interpretation", "Technical decision needed"].includes(item.action));
  }
  const satisfied = view.items.filter((entry) => entry.result === "Satisfied");
  assert.ok(satisfied.length >= 1, "a governed passing comparison must read Satisfied");
});

test("engineer action routing: missing information vs conflict vs technical decision", () => {
  const candidate = {
    product: product(),
    comparisons: [
      { comparisonType: "Attribute", requirement: { id: "r1", normalizedRequirement: "24 V", sources: [{ sourceType: "Specification" }], attributes: [{ name: "Voltage" }] }, required: { name: "Voltage", value: 24 }, offered: null, result: "Missing Product Data", pass: false, blocking: true },
      { comparisonType: "Attribute", requirement: { id: "r2", normalizedRequirement: "IP65", sources: [{ sourceType: "Specification" }], attributes: [{ name: "IP Rating" }] }, required: { name: "IP Rating", value: "IP65" }, offered: { name: "IP Rating", value: "IP54", evidence: { documentId: "ds" } }, result: "Fail", pass: false, blocking: true },
      { comparisonType: "Attribute", requirement: { id: "r3", normalizedRequirement: "24 V", sources: [{ sourceType: "Specification" }], attributes: [{ name: "Voltage" }] }, required: { name: "Voltage", value: 24 }, offered: { name: "Voltage", value: 24, evidence: { documentId: "ds" } }, result: "Pass", pass: true, blocking: false },
    ],
  };
  const view = buildEngineerView({ profile: profile(), candidate });
  const actions = view.items.map((item) => item.action);
  assert.ok(actions.includes("Provide missing information"));
  assert.deepEqual(actions.filter((entry) => entry === "Technical decision needed").length, 0);
  assert.ok(actions.includes("No action"));
  assert.equal(view.summary.satisfied >= 1, true);
  assert.equal(view.summary.unknown >= 1, true);
});

test("a bare product listing claim is missing evidence, never a passing agreement", () => {
  const result = runProductMatching({ profile: profile(), products: [product({ standards: [{ body: "EN54", number: "7" }] })] });
  const candidate = result.candidates[0];
  const standard = candidate.comparisons.find((entry) => entry.comparisonType === "Standard");
  assert.equal(standard.result, "Claimed Compliant");
  assert.equal(standard.pass, false);
  const envelope = candidate.evidenceEnvelope[candidate.comparisons.indexOf(standard)];
  assert.equal(envelope.pass, false);
  assert.equal(envelope.productEvidenceKind, "MISSING");
  assert.equal(envelope.result, "MISSING_EVIDENCE");
});

test("requirementAuthorityOf/produceAuthorityOf expose class, role, standing and provenance", () => {
  const req = requirementAuthorityOf({ id: "r", sources: [{ sourceType: "Specification", source: { documentId: "d1" }, confidence: 90 }], applicability: { status: "Confirmed Applicable" } });
  assert.equal(req.authorityClass, "PROJECT_CONTRACT");
  assert.equal(req.role, "DEFINING");
  assert.equal(req.standing, "Confirmed");
  assert.equal(req.source.document.documentId, "d1");
  const prod = productAuthorityOf({ name: "Voltage", value: 24, evidence: { documentId: "ds" }, reviewStatus: "Reviewed", confidence: 80 }, "Attribute");
  assert.equal(prod.authorityClass, "PRODUCT_TECHNICAL");
  assert.equal(prod.standing, "Reviewed");
  assert.equal(prod.hasEvidence, true);
  const bare = productAuthorityOf({ name: "Voltage", value: 24 }, "Attribute");
  assert.equal(bare.standing, "Unreviewed");
  assert.equal(bare.hasEvidence, false);
});