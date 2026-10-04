// Agent 8 -- focused tests for the engineer-decision technical view, the BOM
// accessory summary and the standardized evidence drawer.

import test from "node:test";
import assert from "node:assert/strict";

import {
  assertNoCommercialFields,
  bomAccessorySummary,
  count,
  decisionPrimaryAction,
  engineerDecisionTechnicalModel,
  evidenceDrawerModel,
} from "../app/domain/engineer-decision-presentation.mjs";

const decision = (over = {}) => ({
  boqItemId: "boqitem_1",
  itemReference: "28 46 00 - 0010",
  description: "Smoke detectors (above ceiling)",
  understanding: {
    status: "APPROVED",
    familyClassification: { productFamily: "Smoke Detector", decisionBasis: "SYSTEM_CONFIRMED_BY_DETERMINISTIC_SECTION_CONTEXT", origin: "DETERMINISTIC", confidence: 92 },
    governedTaxonomy: { productFamily: "Smoke Detector", category: "Initiating Devices", acceptedCandidate: true },
  },
  requirements: {
    readiness: { status: "READY" },
    applicableCount: 3,
    consolidated: [
      { id: "req_1", normalizedRequirement: "UL 864 listed smoke detector", priority: "Mandatory" },
      { id: "req_2", normalizedRequirement: "Addressable loop device", priority: "Mandatory" },
    ],
    openClarifications: [],
  },
  candidates: [
    { candidateId: "cand_1", rank: 1, manufacturer: "Notifier", partNumber: "NFS2-3030", family: "IDNet2", technicalStatus: "Compatible", recommendationTier: "Recommended", confidence: "High Confidence", confidenceScore: 82, explanation: "Address capacity and loop capacity both satisfied.", matchingBasis: ["address capacity"], mandatoryFailures: [], familyMatchTier: 1, isFallbackCandidate: false, rankingReason: "Highest verified address capacity on the current profile.", isViable: true },
    { candidateId: "cand_2", rank: 2, manufacturer: "Notifier", partNumber: "NFS2-3035", family: "IDNet2", technicalStatus: "Compatible", recommendationTier: "Alternative", confidence: "Medium Confidence", confidenceScore: 64, explanation: "Fewer loop devices.", matchingBasis: ["address capacity"], mandatoryFailures: [], familyMatchTier: 2, isFallbackCandidate: false, rankingReason: null, isViable: true },
  ],
  safety: { safetyState: "Eligible", complianceState: "Compliant", explanation: "All mandatory requirements matched from current evidence." },
  recalculation: { status: "CURRENT" },
  currentBlocker: null,
  composite: { state: "TECHNICALLY_READY", label: "Technical decision is ready" },
  ...over,
});

const bom = (over = {}) => ({
  boqItemId: "boqitem_1",
  primaryProduct: { productId: "cand_1", partNumber: "NFS2-3030", manufacturer: "Notifier", family: "IDNet2", description: "Intelligent smoke detector", approved: true },
  primaryQuantity: { value: 12, unit: "pcs", origin: "CLIENT_BOQ", derivationRule: null, source: "BOQ", confidence: 100 },
  components: [
    { relationshipType: "INPUT_DEVICE", accessoryProductId: "acc_1", accessoryPartNumber: "B-300-6", role: "REQUIRED_COMPONENT", quantity: { value: 1, unit: "ea", origin: "DERIVED_FROM_PRIMARY_QUANTITY" }, decisionNeeded: false },
    { relationshipType: "MOUNTING_BASE", accessoryProductId: "acc_2", accessoryPartNumber: "NBG-12LX", role: "CONDITIONAL_COMPONENT", quantity: { value: null, unit: "ea", origin: null }, decisionNeeded: true },
  ],
  engineerQuestion: { kind: "ACCESSORY_SELECTION", question: "Select the mounting base" },
  readiness: { state: "BOM_DECISION_REQUIRED", label: "One accessory decision required" },
  ...over,
});

test("unknown is never rendered as zero", () => {
  assert.equal(count(null), "Unknown");
  assert.equal(count(undefined), "Unknown");
  assert.equal(count(""), "Unknown");
  assert.equal(count("abc"), "Unknown");
  assert.equal(count(0), "0");
  assert.equal(count(3), "3");
});

test("the technical view carries no commercial field", () => {
  const model = engineerDecisionTechnicalModel({ decision: decision(), bom: bom() });
  assert.deepEqual(assertNoCommercialFields(model), []);
  assert.deepEqual(assertNoCommercialFields(bomAccessorySummary(bom())), []);
});

test("the technical view surfaces selected product, why and evidence", () => {
  const model = engineerDecisionTechnicalModel({ decision: decision(), bom: bom() });
  assert.equal(model.available, true);
  assert.equal(model.selectedProduct.partNumber, "NFS2-3030");
  assert.equal(model.selectedProduct.approved, true);
  assert.ok(model.why.length >= 2, "classification basis and safety explanation must both be shown");
  assert.match(model.why[0].detail, /SYSTEM_CONFIRMED_BY_DETERMINISTIC_SECTION_CONTEXT/);
  assert.equal(model.evidence.applicableRequirements, 2);
  assert.equal(model.evidence.safetyState, "Eligible");
  assert.equal(model.evidence.recalculationStatus, "CURRENT");
});

test("alternatives exclude the selected product and keep fallback visible", () => {
  const withFallback = decision({
    candidates: [
      { ...decision().candidates[0] },
      { ...decision().candidates[1] },
      { ...decision().candidates[1], candidateId: "cand_3", isFallbackCandidate: true, partNumber: "FB-1" },
    ],
  });
  const model = engineerDecisionTechnicalModel({ decision: withFallback, bom: bom() });
  assert.deepEqual(model.alternatives.map((a) => a.candidateId), ["cand_2", "cand_3"]);
  assert.equal(model.alternatives[1].fallback, true);
});

test("open issues collect safety blocks, clarifications and the composite state", () => {
  const model = engineerDecisionTechnicalModel({
    decision: decision({
      safety: { safetyState: "Blocked", complianceState: "Non-Compliant", explanation: "x", blocks: [{ id: "b1", code: "MANDATORY_REQUIREMENT_MISSING", user_message: "Address capacity requirement missing", resolution_action: "Review requirement profile", owner: "Engineer", status: "OPEN" }] },
      requirements: { readiness: { status: "BLOCKED" }, applicableCount: 1, consolidated: [], openClarifications: [{ question: "Is 200 nodes the design intent?" }] },
      composite: { state: "TECHNICAL_DECISION_REQUIRED", label: "Technical decision required" },
    }),
    bom,
  });
  const kinds = model.openIssues.map((issue) => issue.kind);
  assert.deepEqual(kinds.sort(), ["CLARIFICATION", "COMPOSITE", "SAFETY_BLOCK"]);
  assert.equal(model.primaryAction.workspace, "Technical Matching");
});

test("a resolved safety block does not become an open issue", () => {
  const model = engineerDecisionTechnicalModel({
    decision: decision({ safety: { safetyState: "Eligible", complianceState: "Compliant", explanation: "x", blocks: [{ id: "b1", code: "X", user_message: "done", status: "RESOLVED" }] } }),
    bom,
  });
  assert.equal(model.openIssues.filter((issue) => issue.kind === "SAFETY_BLOCK").length, 0);
});

test("there is exactly one primary action, or none at all", () => {
  const ready = engineerDecisionTechnicalModel({ decision: decision(), bom: bom() });
  assert.equal(typeof ready.primaryAction, "object");
  assert.equal(ready.primaryAction.workspace, "BOM");
  const unmapped = decisionPrimaryAction("SOME_FUTURE_STATE");
  assert.equal(unmapped, null, "an unmapped state must yield no button, not a guessed one");
});

test("an unresolved safety block outranks the composite-state action", () => {
  const action = decisionPrimaryAction("TECHNICALLY_READY", { safetyBlocks: [{ code: "C1", user_message: "Resolve capacity", owner: "Engineer", status: "OPEN" }] });
  assert.equal(action.kind, "RESOLVE_BLOCK");
  assert.equal(action.blockCode, "C1");
  assert.equal(action.owner, "Engineer");
});

test("a missing decision record degrades honestly instead of rendering blank sections", () => {
  const model = engineerDecisionTechnicalModel({ decision: null });
  assert.equal(model.available, false);
  assert.ok(model.reason);
});

test("the BOM summary counts roles and unresolved decisions with a deep link", () => {
  const summary = bomAccessorySummary(bom());
  assert.equal(summary.available, true);
  assert.equal(summary.totals.components, 2);
  assert.equal(summary.totals.unresolved, 1);
  assert.equal(summary.totals.missingQuantity, 1);
  assert.deepEqual(summary.byRole.map((r) => r.role), ["REQUIRED_COMPONENT", "CONDITIONAL_COMPONENT"]);
  assert.equal(summary.unresolved[0].partNumber, "NBG-12LX");
  assert.equal(summary.link.workspace, "BOM");
  assert.equal(summary.primaryQuantity.label, "12 pcs");
});

test("a missing BOM record states so instead of showing zero totals", () => {
  const summary = bomAccessorySummary(null);
  assert.equal(summary.available, false);
  assert.equal(summary.totals, null);
});

test("the evidence drawer is tiered and keeps raw JSON out of the headline", () => {
  const drawer = evidenceDrawerModel({
    rationale: "UL 864 listed device matched from the current profile.",
    sources: [{ label: "Spec 28 46 00" }, { label: "Drawing FA-01" }],
    warnings: [{ code: "W1", message: "Lifecycle unconfirmed" }],
    document: { logicalName: "28 46 00 - Rev 1.pdf", page: 12, clause: "2.4" },
    identifiers: { reviewKey: "30497bd8df5817b7454f4acb6993" },
    raw: { anything: "raw" },
  });
  assert.deepEqual(drawer.tiers.map((tier) => tier.id), ["rationale", "sources", "document", "advanced"]);
  assert.equal(drawer.headline, "UL 864 listed device matched from the current profile.");
  assert.equal(JSON.stringify(drawer.headline).includes("anything"), false, "raw JSON must never appear in the headline");
  assert.equal(drawer.tiers[3].value.raw, '{"anything":"raw"}');
  assert.equal(drawer.tiers[2].value.document, "28 46 00 - Rev 1.pdf");
  assert.equal(drawer.tiers[2].value.page, "Page 12");
  assert.equal(drawer.hasRawRecord, true);
});

test("the drawer reports missing evidence as absent, not as zero", () => {
  const drawer = evidenceDrawerModel({});
  assert.equal(drawer.tiers[1].value.warningCountLabel, "0");
  assert.equal(drawer.tiers[2].value.document, "Source document not recorded");
  assert.equal(drawer.tiers[2].value.page, "Page not recorded");
  assert.equal(drawer.hasRawRecord, false);
  assert.equal(drawer.identifierCountLabel, "0");
});

test("empty identifiers are omitted rather than rendered blank", () => {
  const drawer = evidenceDrawerModel({ identifiers: { a: "", b: null, c: "keep" } });
  assert.deepEqual(drawer.tiers[3].value.identifiers, [{ key: "c", value: "keep" }]);
});
