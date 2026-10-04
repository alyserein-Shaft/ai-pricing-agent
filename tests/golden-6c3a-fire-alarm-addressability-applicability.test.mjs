// GOLDEN-6C3A -- governed addressability evidence applicability & attachment.
//
// Proves the decision engine that decides WHICH existing Fire Alarm
// addressability evidence legitimately governs WHICH device populations
// (mission sections 3-37). Coverage:
//   - section 35 acceptance scenarios (applicability per basis)
//   - the 11 mandatory negative assertions plus their governance aliases
//   - evidence eligibility and extraction-currency gates
//   - drawing scope / cross-sheet legend scope (never assumed, never global)
//   - system-wide requirement gate (field devices only)
//   - family-scope gate (UNKNOWN family stays INSUFFICIENT_EVIDENCE)
//   - protocol / network-architecture mentions (never auto-attach)
//   - schedule and explicit BOQ relationship bases
//   - conflict handling (fail closed, no winner by mention count/recency/confidence)
//   - section 37 idempotency
//   - downstream handoff: attachment -> GOLDEN-6C3 resolver -> canonical
//     classifier, with the no-point-fabrication invariant
//   - before/after point demand through the GOLDEN-6C engine on an in-memory
//     replica (improved evidence recomputes; unchanged evidence does not move)
//
// Pure domain tests: no database, no network, no process spawning.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADDRESSABILITY_APPLICABILITY_POLICY_VERSION,
  ADDRESSABILITY_APPLICABILITY_STATUSES,
  ADDRESSABILITY_EVIDENCE_BASES,
  PROHIBITED_APPLICABILITY_BASES,
  ADDRESSABILITY_RESOLUTION_STATES,
  isEligibleAddressabilityEvidence,
  classifyAddressabilityApplicability,
  planAddressabilityAttachments,
  derivePopulationAddressability,
  buildResolverObservation,
  addressabilityReviewQuestions,
} from "../app/domain/fire-alarm-addressability-applicability.mjs";
import {
  resolveFireAlarmDeviceAuthority,
  classifyResolvedDeviceEvidence,
} from "../app/domain/fire-alarm-device-evidence-resolver.mjs";
import {
  buildDeviceInventoryRecord,
  aggregatePreliminaryPointDemand,
  classifyDevicePointDemand,
} from "../app/domain/fire-alarm-preliminary-point-demand.mjs";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const eligible = (over = {}) => ({
  id: "ev-legend-sd",
  kind: "LEGEND_ENTRY",
  claimKind: "DEVICE",
  addressabilityClaim: "ADDRESSABLE",
  basis: "SAME_DRAWING_SYMBOL_SCOPE",
  scope: { system: "Fire Alarm", sheet: "FA-101", symbol: "SD", applicableSheets: [] },
  eligibility: { reviewStatus: "Approved", approvedForDownstream: 1, extractionIsCurrent: true },
  provenance: { source: "Drawing Legend", sourceLocation: "sheet 1", authority: "Legend (approved)" },
  ...over,
});

const population = (over = {}) => ({
  id: "pop-101-sd",
  family: "Smoke Detector",
  system: "Fire Alarm",
  drawingScope: { sheets: ["FA-101"], symbols: ["SD"] },
  ...over,
});

// A governed family observation from the approved understanding/identity layer
// (the GOLDEN-6C3B side of the flow). The applicability layer never invents a
// family; where a handoff test needs a point decision, the family arrives from
// the same approved-facts path the live inventory uses.
const familyObservation = (id, populationId, family, source = "Understanding Review") => ({
  id,
  source,
  sourceLocation: "approved understanding facts",
  authority: "Understanding (approved)",
  reviewStatus: "Approved",
  applicableTo: populationId,
  scope: { population: populationId },
  claims: { deviceFamily: family },
});

// ---------------------------------------------------------------------------
// section 35 -- acceptance scenarios
// ---------------------------------------------------------------------------

test("35.1 applicable legend entry + matching symbol scope -> CONFIRMED_APPLICABLE + attachment", () => {
  const decision = classifyAddressabilityApplicability({ evidence: eligible(), population: population() });
  assert.equal(decision.status, "CONFIRMED_APPLICABLE");
  assert.equal(decision.basis, "SAME_DRAWING_SYMBOL_SCOPE");
  const plan = planAddressabilityAttachments({ evidences: [eligible()], populations: [population()] });
  assert.equal(plan.attachmentsToCreate.length, 1);
  const attachment = plan.attachmentsToCreate[0];
  assert.equal(attachment.key, "ev-legend-sd|pop-101-sd");
  assert.equal(attachment.addressabilityClaim, "ADDRESSABLE");
  assert.equal(attachment.provenance.source, "Drawing Legend");
});

test("35.2 legend entry + unrelated sheet population -> NOT_APPLICABLE, no attachment", () => {
  const decision = classifyAddressabilityApplicability({
    evidence: eligible(),
    population: population({ id: "pop-301", drawingScope: { sheets: ["FA-301"], symbols: ["SD"] } }),
  });
  assert.equal(decision.status, "NOT_APPLICABLE");
  const plan = planAddressabilityAttachments({
    evidences: [eligible()],
    populations: [population({ id: "pop-301", drawingScope: { sheets: ["FA-301"], symbols: ["SD"] } })],
  });
  assert.equal(plan.attachmentsToCreate.length, 0);
});

test("35.3 explicit governed cross-sheet reference -> applies only to the referenced sheet", () => {
  const crossSheet = eligible({
    id: "ev-legend-cross",
    basis: "EXPLICIT_LEGEND_REFERENCE",
    scope: { system: "Fire Alarm", sheet: "FA-101", applicableSheets: ["FA-201"] },
  });
  const onReferenceSheet = classifyAddressabilityApplicability({
    evidence: crossSheet,
    population: population({ id: "pop-201", drawingScope: { sheets: ["FA-201"], symbols: [] } }),
  });
  assert.equal(onReferenceSheet.status, "CONFIRMED_APPLICABLE");
  const onOtherSheet = classifyAddressabilityApplicability({
    evidence: crossSheet,
    population: population({ id: "pop-301", drawingScope: { sheets: ["FA-301"], symbols: [] } }),
  });
  assert.equal(onOtherSheet.status, "NOT_APPLICABLE");
});

test("35.4 approved system-wide addressable requirement + detector population -> CONFIRMED", () => {
  const systemWide = eligible({
    id: "ev-r53",
    kind: "SPECIFICATION_REQUIREMENT",
    claimKind: "SYSTEM_ARCHITECTURE",
    basis: "APPROVED_SYSTEM_WIDE_REQUIREMENT",
    scope: { system: "Fire Alarm", systemWide: true },
  });
  const decision = classifyAddressabilityApplicability({ evidence: systemWide, population: population() });
  assert.equal(decision.status, "CONFIRMED_APPLICABLE");
  assert.equal(decision.ruleId, "RULE_17_APPROVED_SYSTEM_WIDE_REQUIREMENT");
});

test("35.5 same system-wide requirement + FACP -> NOT_APPLICABLE (never control equipment)", () => {
  const systemWide = eligible({
    id: "ev-r53",
    kind: "SPECIFICATION_REQUIREMENT",
    claimKind: "SYSTEM_ARCHITECTURE",
    basis: "APPROVED_SYSTEM_WIDE_REQUIREMENT",
    scope: { system: "Fire Alarm", systemWide: true },
  });
  const decision = classifyAddressabilityApplicability({
    evidence: systemWide,
    population: population({ id: "pop-facp", family: "Fire Alarm Control Panel", drawingScope: null }),
  });
  assert.equal(decision.status, "NOT_APPLICABLE");
  assert.equal(decision.ruleId, "RULE_15_DEVICE_CLASS_NOT_COVERED");
});

test("35.6 detector-scoped requirement + detector -> CONFIRMED", () => {
  const familyScoped = eligible({
    id: "ev-det-scope",
    kind: "SPECIFICATION_REQUIREMENT",
    basis: "EXPLICIT_DEVICE_FAMILY_SCOPE",
    scope: { system: "Fire Alarm", families: ["Smoke Detector", "Heat Detector"] },
  });
  const decision = classifyAddressabilityApplicability({ evidence: familyScoped, population: population() });
  assert.equal(decision.status, "CONFIRMED_APPLICABLE");
});

test("35.7 detector-scoped requirement + module -> NOT_APPLICABLE", () => {
  const familyScoped = eligible({
    id: "ev-det-scope",
    basis: "EXPLICIT_DEVICE_FAMILY_SCOPE",
    scope: { system: "Fire Alarm", families: ["Smoke Detector", "Heat Detector"] },
  });
  const decision = classifyAddressabilityApplicability({
    evidence: familyScoped,
    population: population({ id: "pop-mod", family: "Monitor Module", drawingScope: null }),
  });
  assert.equal(decision.status, "NOT_APPLICABLE");
});

test("35.8 family-dependent scope + UNKNOWN population family -> INSUFFICIENT_EVIDENCE (coordination with 6C3B)", () => {
  const familyScoped = eligible({
    id: "ev-det-scope",
    basis: "EXPLICIT_DEVICE_FAMILY_SCOPE",
    scope: { system: "Fire Alarm", families: ["Smoke Detector", "Heat Detector"] },
  });
  const decision = classifyAddressabilityApplicability({
    evidence: familyScoped,
    population: population({ id: "pop-unknown", family: null, drawingScope: null }),
  });
  assert.equal(decision.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(decision.ruleId, "RULE_14_FAMILY_PREREQUISITE_UNKNOWN");
});

test("35.9 protocol mention without a governed population relationship -> zero automatic attachments project-wide", () => {
  const protocol = eligible({
    id: "ev-proto",
    claimKind: "PROTOCOL",
    addressabilityClaim: null,
    scope: { system: "Fire Alarm" },
  });
  const populations = [
    population(),
    population({ id: "pop-2", drawingScope: { sheets: ["FA-101"], symbols: [] } }),
    population({ id: "pop-3", family: "Heat Detector", drawingScope: { sheets: ["FA-201"], symbols: ["HD"] } }),
  ];
  const plan = planAddressabilityAttachments({ evidences: [protocol], populations });
  assert.equal(plan.attachmentsToCreate.length, 0);
  for (const entry of plan.classifications) assert.equal(entry.status, "NOT_APPLICABLE");
});

test("35.10 protocol mention already bound by a governed population relationship -> allowed to attach", () => {
  const protocolBound = eligible({
    id: "ev-proto-bound",
    claimKind: "PROTOCOL",
    basis: "EXPLICIT_BOQ_RELATIONSHIP",
    scope: { system: "Fire Alarm", populationIds: ["pop-101-sd"] },
  });
  const decision = classifyAddressabilityApplicability({ evidence: protocolBound, population: population() });
  assert.equal(decision.status, "CONFIRMED_APPLICABLE");
  const plan = planAddressabilityAttachments({ evidences: [protocolBound], populations: [population()] });
  assert.equal(plan.attachmentsToCreate.length, 1);
});

test("35.11 current, approved, approved-for-downstream evidence is eligible", () => {
  assert.equal(isEligibleAddressabilityEvidence(eligible()), true);
  const decision = classifyAddressabilityApplicability({ evidence: eligible(), population: population() });
  assert.equal(decision.status, "CONFIRMED_APPLICABLE");
});

test("35.12 superseded evidence is NOT current -> NOT_APPLICABLE", () => {
  const superseded = eligible({
    id: "ev-stale",
    eligibility: { reviewStatus: "Approved", approvedForDownstream: 1, extractionIsCurrent: false },
  });
  assert.equal(isEligibleAddressabilityEvidence(superseded), false);
  const decision = classifyAddressabilityApplicability({ evidence: superseded, population: population() });
  assert.equal(decision.status, "NOT_APPLICABLE");
  assert.equal(decision.ruleId, "RULE_2_EVIDENCE_NOT_CURRENT");
});

test("35.13 pending / unapproved evidence -> NOT_APPLICABLE", () => {
  const pending = eligible({
    id: "ev-pending",
    eligibility: { reviewStatus: "Needs Review", approvedForDownstream: 0, extractionIsCurrent: true },
  });
  assert.equal(isEligibleAddressabilityEvidence(pending), false);
  const decision = classifyAddressabilityApplicability({ evidence: pending, population: population() });
  assert.equal(decision.status, "NOT_APPLICABLE");
  assert.equal(decision.ruleId, "RULE_1_EVIDENCE_NOT_ELIGIBLE");
});

test("35.14 conflicting applicable evidence -> ADDRESSABILITY_CONFLICT, fail closed", () => {
  const addressable = eligible({ id: "ev-addr", basis: "EXPLICIT_BOQ_RELATIONSHIP", scope: { populationIds: ["pop-101-sd"] } });
  const conventional = eligible({ id: "ev-conv", addressabilityClaim: "CONVENTIONAL", negative: true, basis: "EXPLICIT_BOQ_RELATIONSHIP", scope: { populationIds: ["pop-101-sd"] } });
  const plan = planAddressabilityAttachments({ evidences: [addressable, conventional], populations: [population()] });
  assert.equal(plan.attachmentsToCreate.length, 2);
  const derived = derivePopulationAddressability({ population: population(), classifications: plan.classifications });
  assert.equal(derived.resolutionState, "ADDRESSABILITY_CONFLICT");
  assert.deepEqual([...derived.conflictingClaims].sort(), ["ADDRESSABLE", "CONVENTIONAL"]);
  assert.equal(derived.resolvedAddressability, null);
});

test("35.15 explicit conventional evidence -> NON_ADDRESSABLE resolution", () => {
  const conventional = eligible({
    id: "ev-conv",
    addressabilityClaim: "CONVENTIONAL",
    negative: true,
    scope: { system: "Fire Alarm", populationIds: ["pop-101-sd"] },
    basis: "EXPLICIT_BOQ_RELATIONSHIP",
  });
  const plan = planAddressabilityAttachments({ evidences: [conventional], populations: [population()] });
  const derived = derivePopulationAddressability({ population: population(), classifications: plan.classifications });
  assert.equal(derived.resolutionState, "ADDRESSABILITY_RESOLVED_NON_ADDRESSABLE");
  assert.equal(derived.resolvedAddressability, "CONVENTIONAL");
});

test("35.16 schedule-linked device -> CONFIRMED via schedule basis", () => {
  const schedule = eligible({
    id: "ev-schedule",
    basis: "EXPLICIT_SCHEDULE_REFERENCE",
    scope: { system: "Fire Alarm", schedule: "schedule_det_001" },
  });
  const decision = classifyAddressabilityApplicability({
    evidence: schedule,
    population: population({ schedules: ["schedule_det_001"], drawingScope: null }),
  });
  assert.equal(decision.status, "CONFIRMED_APPLICABLE");
});

test("35.17 fuzzy schedule name only -> NOT_APPLICABLE", () => {
  const schedule = eligible({
    id: "ev-schedule",
    basis: "EXPLICIT_SCHEDULE_REFERENCE",
    scope: { system: "Fire Alarm", schedule: "schedule_det_001" },
  });
  const decision = classifyAddressabilityApplicability({
    evidence: schedule,
    population: population({ schedules: ["DETECTOR SCHEDULE (1ST FLR)"], drawingScope: null }),
  });
  assert.equal(decision.status, "NOT_APPLICABLE");
});

test("35.18 BOQ population with no drawing relationship -> legend NOT applicable", () => {
  const decision = classifyAddressabilityApplicability({
    evidence: eligible({ basis: "SAME_DRAWING_SYMBOL_SCOPE" }),
    population: population({ id: "pop-boq", drawingScope: null }),
  });
  assert.equal(decision.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(decision.ruleId, "RULE_10_DRAWING_SCOPE_UNKNOWN");
});

test("35.19 one evidence row governs many in-scope populations -> N attachments, no evidence cloning", () => {
  const systemWide = eligible({
    id: "ev-r53",
    kind: "SPECIFICATION_REQUIREMENT",
    claimKind: "SYSTEM_ARCHITECTURE",
    basis: "APPROVED_SYSTEM_WIDE_REQUIREMENT",
    scope: { system: "Fire Alarm", systemWide: true },
  });
  const populations = [
    population({ id: "pop-a", family: "Heat Detector", drawingScope: null }),
    population({ id: "pop-b", family: "MCP", drawingScope: null }),
    population({ id: "pop-c", family: "Interface Module", drawingScope: null }),
    population({ id: "pop-facp", family: "Fire Alarm Control Panel", drawingScope: null }),
  ];
  const plan = planAddressabilityAttachments({ evidences: [systemWide], populations });
  assert.equal(plan.attachmentsToCreate.length, 3);
  assert.equal(new Set(plan.attachmentsToCreate.map((a) => a.evidenceKey)).size, 1);
  assert.equal(plan.attachmentsToCreate[0].evidenceKey, "ev-r53");
});

test("35.20 reprocessing the same input -> no duplicate attachments (idempotency)", () => {
  const plan1 = planAddressabilityAttachments({ evidences: [eligible()], populations: [population()] });
  const plan2 = planAddressabilityAttachments({
    evidences: [eligible()],
    populations: [population()],
    existingAttachments: plan1.attachmentsToCreate,
  });
  assert.equal(plan1.attachmentsToCreate.length, 1);
  assert.equal(plan2.attachmentsToCreate.length, 0);
  assert.equal(plan1.confirmedPairs, plan2.confirmedPairs);
  assert.deepEqual(
    plan1.classifications.map((entry) => entry.status),
    plan2.classifications.map((entry) => entry.status),
  );
});

test("35.21 attachment -> GOLDEN-6C3 resolver -> GOVERNED_ADDRESSABILITY_RESOLVED", () => {
  const plan = planAddressabilityAttachments({ evidences: [eligible()], populations: [population()] });
  const observation = buildResolverObservation(plan.attachmentsToCreate[0], population());
  const resolved = resolveFireAlarmDeviceAuthority({
    populationId: population().id,
    system: "Fire Alarm",
    evidence: [observation],
  });
  assert.equal(resolved.resolution.addressability.state, "GOVERNED_ADDRESSABILITY_RESOLVED");
  assert.equal(resolved.resolution.addressability.value, "ADDRESSABLE");
  assert.equal(resolved.populationState, "GOVERNED_ADDRESSABILITY_RESOLVED");
  // Dimension independence: addressability evidence never fabricates a family.
  assert.equal(resolved.resolution.family.state, "FAMILY_UNKNOWN");
});

test("35.22 attachment does not fabricate point consumption (classifier owns it)", () => {
  const plan = planAddressabilityAttachments({ evidences: [eligible()], populations: [population()] });
  const attachment = plan.attachmentsToCreate[0];
  assert.equal(attachment.addressabilityClaim, "ADDRESSABLE");
  assert.equal("pointConsumption" in attachment, false);
  const observation = buildResolverObservation(attachment, population());
  assert.deepEqual(observation.claims, { addressability: "ADDRESSABLE" });
  const resolved = resolveFireAlarmDeviceAuthority({
    populationId: population().id,
    system: "Fire Alarm",
    evidence: [observation],
  });
  const classified = classifyResolvedDeviceEvidence({ resolution: resolved, quantity: 10 });
  // Family is not taken from the addressability attachment, so the canonical
  // classifier cannot yield a point: nothing is fabricated.
  assert.equal(classified.canonicalState, "UNRESOLVED");
  assert.equal(classified.unitsPerDevice, null);
});

test("35.23 improved evidence -> point demand recomputes (before/after through the 6C engine)", () => {
  // BEFORE: no governed addressing evidence -> family present, addressability absent.
  const beforeRecord = buildDeviceInventoryRecord({
    populationId: "pop-det",
    deviceFamily: "Addressable Smoke Detector",
    system: "Fire Alarm",
    addressability: null,
    governingSource: "BOQ",
    sources: [{ authority: "BOQ", source: "BOQ", quantity: 12, confidence: 90 }],
  });
  const before = classifyDevicePointDemand(beforeRecord, { quantity: 12 });
  assert.equal(before.demandClass, "UNKNOWN_NEEDS_REVIEW");

  // AFTER: governed addressability attachment + governed family observation
  // flow through the resolver (the approved-facts path carries the family).
  const systemWide = eligible({
    id: "ev-r53",
    kind: "SPECIFICATION_REQUIREMENT",
    claimKind: "SYSTEM_ARCHITECTURE",
    basis: "APPROVED_SYSTEM_WIDE_REQUIREMENT",
    scope: { system: "Fire Alarm", systemWide: true },
  });
  const populationRow = population({ id: "pop-det", family: "Addressable Smoke Detector" });
  const plan = planAddressabilityAttachments({ evidences: [systemWide], populations: [populationRow] });
  assert.equal(plan.attachmentsToCreate.length, 1);
  const observation = buildResolverObservation(plan.attachmentsToCreate[0], populationRow);
  const resolved = resolveFireAlarmDeviceAuthority({
    populationId: "pop-det",
    system: "Fire Alarm",
    evidence: [familyObservation("family-obs|pop-det", "pop-det", "Addressable Smoke Detector"), observation],
  });
  const afterRecord = buildDeviceInventoryRecord({
    populationId: "pop-det",
    deviceFamily: resolved.candidates.family,
    system: "Fire Alarm",
    addressability: resolved.candidates.attributes?.addressing ?? null,
    governingSource: "BOQ",
    sources: [{ authority: "BOQ", source: "BOQ", quantity: 12, confidence: 90 }],
  });
  const after = classifyDevicePointDemand(afterRecord, { quantity: 12 });
  assert.equal(after.demandClass, "ADDRESSABLE_DETECTOR_POINT");
  assert.equal(after.pointDemand, 12);

  const demandBefore = aggregatePreliminaryPointDemand([beforeRecord], { governingAuthority: "BOQ" });
  const demandAfter = aggregatePreliminaryPointDemand([afterRecord], { governingAuthority: "BOQ" });
  assert.equal(demandBefore.knownPointDemand, 0);
  assert.equal(demandAfter.knownPointDemand, 12);
  assert.notEqual(demandAfter.thresholdStatus, demandBefore.thresholdStatus);
});

test("35.24 no effective evidence change -> no artificial result change", () => {
  const run = () => {
    const records = [
      buildDeviceInventoryRecord({
        populationId: "pop-det",
        deviceFamily: "Addressable Smoke Detector",
        system: "Fire Alarm",
        addressability: "addressable",
        governingSource: "BOQ",
        sources: [{ authority: "BOQ", source: "BOQ", quantity: 8, confidence: 90 }],
      }),
    ];
    return aggregatePreliminaryPointDemand(records, { governingAuthority: "BOQ" });
  };
  const first = run();
  const second = run();
  assert.equal(first.knownPointDemand, second.knownPointDemand);
  assert.equal(first.unknownPointDemand, second.unknownPointDemand);
  assert.equal(first.preliminaryTotalPoints, second.preliminaryTotalPoints);
  assert.equal(first.thresholdStatus, second.thresholdStatus);
});

// ---------------------------------------------------------------------------
// section 36 -- the 11 mandatory negative assertions
// ---------------------------------------------------------------------------

test("36.1 a legend exists -> does NOT apply to every drawing in the project", () => {
  const plan = planAddressabilityAttachments({
    evidences: [eligible()],
    populations: [population({ id: "pop-301", drawingScope: { sheets: ["FA-301"], symbols: [] } })],
  });
  assert.equal(plan.attachmentsToCreate.length, 0);
});

test("36.2 a spec says addressable -> does NOT make ALL Fire Alarm devices addressable", () => {
  const spec = eligible({
    id: "ev-spec-addr",
    claimKind: "SYSTEM_ARCHITECTURE",
    basis: "APPROVED_SYSTEM_WIDE_REQUIREMENT",
    scope: { system: "Fire Alarm", systemWide: true },
  });
  const plan = planAddressabilityAttachments({
    evidences: [spec],
    populations: [
      population({ id: "pop-facp", family: "Fire Alarm Control Panel", drawingScope: null }),
      population({ id: "pop-batt", family: "Battery", drawingScope: null }),
      population({ id: "pop-strobe", family: "Strobe", drawingScope: null }),
    ],
  });
  assert.equal(plan.attachmentsToCreate.length, 0);
});

test("36.3 same Fire Alarm system -> is NOT an evidence basis", () => {
  const sameSystem = eligible({
    id: "ev-same-system",
    basis: "SAME_FIRE_ALARM_SYSTEM",
    scope: { system: "Fire Alarm", applicableSheets: ["FA-999"] },
  });
  const decision = classifyAddressabilityApplicability({ evidence: sameSystem, population: population() });
  assert.equal(decision.status, "NOT_APPLICABLE");
  assert.equal(decision.ruleId, "RULE_7_PROHIBITED_APPLICABILITY_BASIS");
});

test("36.4 same device description -> NEVER copies evidence onto another population", () => {
  const descriptionLike = eligible({
    id: "ev-desc",
    basis: "SAME_DESCRIPTION",
    scope: { system: "Fire Alarm" },
  });
  const decision = classifyAddressabilityApplicability({ evidence: descriptionLike, population: population() });
  assert.equal(decision.status, "NOT_APPLICABLE");
  assert.equal(decision.ruleId, "RULE_7_PROHIBITED_APPLICABILITY_BASIS");
});

test("36.5 FlashScan/CLIP/IDP/SLC mention -> does NOT attach to every population", () => {
  const protocol = eligible({
    id: "ev-protocol-fs",
    claimKind: "PROTOCOL",
    addressabilityClaim: null,
    scope: { system: "Fire Alarm" },
  });
  const plan = planAddressabilityAttachments({
    evidences: [protocol],
    populations: [population(), population({ id: "pop-2", family: "Heat Detector" }), population({ id: "pop-3", family: "MCP" })],
  });
  assert.equal(plan.attachmentsToCreate.length, 0);
});

test("36.6 UNKNOWN family -> cannot satisfy a family-scoped requirement", () => {
  const familyScoped = eligible({
    id: "ev-det-scope",
    basis: "EXPLICIT_DEVICE_FAMILY_SCOPE",
    scope: { system: "Fire Alarm", families: ["Smoke Detector"] },
  });
  const decision = classifyAddressabilityApplicability({
    evidence: familyScoped,
    population: population({ id: "pop-unknown", family: null, drawingScope: null }),
  });
  assert.equal(decision.status, "INSUFFICIENT_EVIDENCE");
});

test("36.7 addressable -> does NOT automatically mean one point", () => {
  const plan = planAddressabilityAttachments({ evidences: [eligible()], populations: [population()] });
  const attachment = plan.attachmentsToCreate[0];
  assert.equal(attachment.addressabilityClaim, "ADDRESSABLE");
  assert.equal(Object.hasOwn(attachment, "pointConsumption"), false);
  assert.equal(Object.hasOwn(attachment, "unitsPerDevice"), false);
  const observation = buildResolverObservation(attachment, population());
  assert.equal("pointConsumption" in observation.claims, false);
});

test("36.8 superseded evidence -> does NOT govern", () => {
  const superseded = eligible({
    id: "ev-sup",
    eligibility: { reviewStatus: "Approved", approvedForDownstream: 1, supersededAt: "2026-09-20T14:01:22.752Z" },
  });
  const decision = classifyAddressabilityApplicability({ evidence: superseded, population: population() });
  assert.equal(decision.status, "NOT_APPLICABLE");
  assert.equal(decision.ruleId, "RULE_2_EVIDENCE_NOT_CURRENT");
});

test("36.9 rejected evidence -> does NOT govern", () => {
  const rejected = eligible({
    id: "ev-rej",
    eligibility: { reviewStatus: "Rejected", approvedForDownstream: 0, rejected: true, extractionIsCurrent: true },
  });
  const decision = classifyAddressabilityApplicability({ evidence: rejected, population: population() });
  assert.equal(decision.status, "NOT_APPLICABLE");
});

test("36.10 an addressability attachment -> does NOT select an ecosystem", () => {
  const plan = planAddressabilityAttachments({ evidences: [eligible()], populations: [population()] });
  const attachment = plan.attachmentsToCreate[0];
  assert.equal(Object.hasOwn(attachment, "ecosystem"), false);
  assert.equal(Object.hasOwn(attachment, "panel"), false);
  const observation = buildResolverObservation(attachment, population());
  assert.equal("ecosystem" in observation.claims, false);
  assert.equal("panel" in observation.claims, false);
});

test("36.11 an addressability attachment -> does NOT select a panel", () => {
  const plan = planAddressabilityAttachments({ evidences: [eligible()], populations: [population()] });
  const attachment = plan.attachmentsToCreate[0];
  assert.equal(Object.hasOwn(attachment, "facp"), false);
  assert.equal(Object.hasOwn(attachment, "panelId"), false);
  assert.equal(Object.hasOwn(attachment, "panelCapacity"), false);
});

// ---------------------------------------------------------------------------
// eligibility & extraction currency gates
// ---------------------------------------------------------------------------

test("eligibility: every failure mode fails closed with the correct rule", () => {
  const variants = [
    { label: "not approved", over: { eligibility: { reviewStatus: "Needs Review", approvedForDownstream: 0, extractionIsCurrent: true } }, rule: "RULE_1_EVIDENCE_NOT_ELIGIBLE" },
    { label: "approved but not approved_for_downstream", over: { eligibility: { reviewStatus: "Approved", approvedForDownstream: 0, extractionIsCurrent: true } }, rule: "RULE_1_EVIDENCE_NOT_ELIGIBLE" },
    { label: "extraction not current", over: { eligibility: { reviewStatus: "Approved", approvedForDownstream: 1, extractionIsCurrent: false } }, rule: "RULE_2_EVIDENCE_NOT_CURRENT" },
    { label: "superseded_at set", over: { eligibility: { reviewStatus: "Approved", approvedForDownstream: 1, supersededAt: "2026-09-20T14:01:22.752Z" } }, rule: "RULE_2_EVIDENCE_NOT_CURRENT" },
    { label: "rejected flag", over: { eligibility: { reviewStatus: "Approved", approvedForDownstream: 1, rejected: true, extractionIsCurrent: true } }, rule: "RULE_2_EVIDENCE_NOT_CURRENT" },
  ];
  for (const variant of variants) {
    const decision = classifyAddressabilityApplicability({ evidence: eligible(variant.over), population: population() });
    assert.equal(decision.status, "NOT_APPLICABLE", variant.label);
    assert.equal(decision.ruleId, variant.rule, variant.label);
  }
});

test("eligibility: isEligibleAddressabilityEvidence agrees", () => {
  const ok = eligible();
  const stale = eligible({ eligibility: { reviewStatus: "Approved", approvedForDownstream: 1, extractionIsCurrent: false } });
  const pending = eligible({ eligibility: { reviewStatus: "Needs Review", approvedForDownstream: 0, extractionIsCurrent: true } });
  assert.equal(isEligibleAddressabilityEvidence(ok), true);
  assert.equal(isEligibleAddressabilityEvidence(stale), false);
  assert.equal(isEligibleAddressabilityEvidence(pending), false);
});

test("evidence carrying no device addressability claim can never attach addressability", () => {
  const noClaim = eligible({ id: "ev-identity-only", claimKind: "NONE", addressabilityClaim: null });
  const decision = classifyAddressabilityApplicability({ evidence: noClaim, population: population() });
  assert.equal(decision.status, "NOT_APPLICABLE");
  assert.equal(decision.ruleId, "RULE_3_NO_DEVICE_ADDRESSABILITY_CLAIM");
});

test("network/system-architecture evidence (data-network wiring) never attaches per-population", () => {
  const network = eligible({
    id: "ev-r442",
    kind: "SPECIFICATION_REQUIREMENT",
    claimKind: "NETWORK_ARCHITECTURE",
    addressabilityClaim: null,
    scope: { system: "Fire Alarm" },
  });
  const decision = classifyAddressabilityApplicability({ evidence: network, population: population() });
  assert.equal(decision.status, "NOT_APPLICABLE");
  assert.equal(decision.ruleId, "RULE_5_NETWORK_ARCHITECTURE_NOT_DEVICE_EVIDENCE");
});

test("unknown basis fails closed to INSUFFICIENT_EVIDENCE", () => {
  const unknownBasis = eligible({ basis: null });
  const decision = classifyAddressabilityApplicability({ evidence: unknownBasis, population: population() });
  assert.equal(decision.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(decision.ruleId, "RULE_6_UNKNOWN_APPLICABILITY_BASIS");
});

test("a governed claim that declares NO scope fails closed and can never attach", () => {
  const scopeless = eligible({
    id: "ev-scopeless",
    basis: "EXPLICIT_DEVICE_FAMILY_SCOPE",
    scope: { system: "Fire Alarm" },
  });
  for (const target of [population(), population({ id: "pop-facp", family: "Fire Alarm Control Panel" })]) {
    const decision = classifyAddressabilityApplicability({ evidence: scopeless, population: target });
    assert.equal(decision.status, "INSUFFICIENT_EVIDENCE");
    assert.equal(decision.ruleId, "RULE_26_SCOPE_UNDECLARED_FAILS_CLOSED");
  }
  const plan = planAddressabilityAttachments({ evidences: [scopeless], populations: [population()] });
  assert.equal(plan.attachmentsToCreate.length, 0);
});

// ---------------------------------------------------------------------------
// drawing scope & cross-sheet legend scope (sections 8-9, 10, 21-22)
// ---------------------------------------------------------------------------

test("scope: symbol mismatch on the same sheet -> NOT_APPLICABLE (symbol identity preserved)", () => {
  const decision = classifyAddressabilityApplicability({
    evidence: eligible(),
    population: population({ drawingScope: { sheets: ["FA-101"], symbols: ["HD"] } }),
  });
  assert.equal(decision.status, "NOT_APPLICABLE");
});

test("scope: population with no governed sheet -> INSUFFICIENT_EVIDENCE", () => {
  const decision = classifyAddressabilityApplicability({
    evidence: eligible(),
    population: population({ drawingScope: { sheets: [], symbols: ["SD"] } }),
  });
  assert.equal(decision.status, "INSUFFICIENT_EVIDENCE");
});

test("scope: evidence with no governed sheet scope -> INSUFFICIENT_EVIDENCE", () => {
  const decision = classifyAddressabilityApplicability({
    evidence: eligible({ scope: { system: "Fire Alarm", symbol: "SD", applicableSheets: [] } }),
    population: population(),
  });
  assert.equal(decision.status, "INSUFFICIENT_EVIDENCE");
});

test("scope: sheet-scoped legend applies to the whole sheet, symbol scope is narrower", () => {
  const sheetScope = eligible({ basis: "SAME_DRAWING_SHEET_SCOPE", scope: { system: "Fire Alarm", sheet: "FA-101", applicableSheets: [] } });
  const decision = classifyAddressabilityApplicability({
    evidence: sheetScope,
    population: population({ drawingScope: { sheets: ["FA-101"], symbols: [] } }),
  });
  assert.equal(decision.status, "CONFIRMED_APPLICABLE");
});

test("scope: a bare 'refer to drawing X' note with no governed reference model is not a cross-sheet link", () => {
  const bare = eligible({
    id: "ev-bare-ref",
    basis: "EXPLICIT_LEGEND_REFERENCE",
    scope: { system: "Fire Alarm", sheet: "FA-101", applicableSheets: [] },
  });
  const decision = classifyAddressabilityApplicability({
    evidence: bare,
    population: population({ id: "pop-201", drawingScope: { sheets: ["FA-201"], symbols: [] } }),
  });
  assert.equal(decision.status, "NOT_APPLICABLE");
  assert.equal(decision.ruleId, "RULE_11_LEGEND_REFERENCE_OUT_OF_SCOPE");
});

// ---------------------------------------------------------------------------
// system-wide gate (sections 11, 13, 15)
// ---------------------------------------------------------------------------

test("system-wide: field device families attach; control/accessory/NAC never do", () => {
  const systemWide = eligible({
    id: "ev-r53",
    kind: "SPECIFICATION_REQUIREMENT",
    claimKind: "SYSTEM_ARCHITECTURE",
    basis: "APPROVED_SYSTEM_WIDE_REQUIREMENT",
    scope: { system: "Fire Alarm", systemWide: true },
  });
  const inScope = [
    ["pop-mcp", "MCP"],
    ["pop-interface", "Interface Module"],
    ["pop-duct", "Duct Detector"],
    ["pop-heat", "Heat Detector"],
  ];
  for (const [id, family] of inScope) {
    const decision = classifyAddressabilityApplicability({
      evidence: systemWide,
      population: population({ id, family, drawingScope: null }),
    });
    assert.equal(decision.status, "CONFIRMED_APPLICABLE", `${family} should be in scope`);
  }
  const never = [
    ["pop-facp", "Fire Alarm Control Panel"],
    ["pop-batt", "Battery"],
    ["pop-psu", "Power Supply"],
    ["pop-loop", "Loop Card"],
    ["pop-enclosure", "Enclosure"],
    ["pop-box", "Back Box"],
    ["pop-strobe", "Strobe"],
    ["pop-horn", "Horn"],
    ["pop-hs", "Horn/Strobe"],
    ["pop-spk", "Speaker"],
  ];
  for (const [id, family] of never) {
    const decision = classifyAddressabilityApplicability({
      evidence: systemWide,
      population: population({ id, family, drawingScope: null }),
    });
    assert.equal(decision.status, "NOT_APPLICABLE", `${family} must never be covered`);
  }
});

test("system-wide: UNKNOWN family/class -> INSUFFICIENT_EVIDENCE", () => {
  const systemWide = eligible({
    id: "ev-r53",
    kind: "SPECIFICATION_REQUIREMENT",
    claimKind: "SYSTEM_ARCHITECTURE",
    basis: "APPROVED_SYSTEM_WIDE_REQUIREMENT",
    scope: { system: "Fire Alarm", systemWide: true },
  });
  const decision = classifyAddressabilityApplicability({
    evidence: systemWide,
    population: population({ id: "pop-unknown", family: null, drawingScope: null }),
  });
  assert.equal(decision.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(decision.ruleId, "RULE_16_DEVICE_CLASS_UNKNOWN");
});

test("system-wide: explicit device-class restriction is honored", () => {
  const systemWide = eligible({
    id: "ev-init-only",
    kind: "SPECIFICATION_REQUIREMENT",
    claimKind: "SYSTEM_ARCHITECTURE",
    basis: "APPROVED_SYSTEM_WIDE_REQUIREMENT",
    scope: { system: "Fire Alarm", systemWide: true, deviceClasses: ["FIELD_DEVICE"] },
  });
  const field = classifyAddressabilityApplicability({ evidence: systemWide, population: population({ id: "pop-heat", family: "Heat Detector", drawingScope: null }) });
  assert.equal(field.status, "CONFIRMED_APPLICABLE");
  const unknown = classifyAddressabilityApplicability({ evidence: systemWide, population: population({ id: "pop-u", family: null, drawingScope: null }) });
  assert.equal(unknown.status, "INSUFFICIENT_EVIDENCE");
});

test("system-wide: declared family lists still gate membership", () => {
  const systemWide = eligible({
    id: "ev-r53",
    kind: "SPECIFICATION_REQUIREMENT",
    claimKind: "SYSTEM_ARCHITECTURE",
    basis: "APPROVED_SYSTEM_WIDE_REQUIREMENT",
    scope: { system: "Fire Alarm", systemWide: true, families: ["Heat Detector"] },
  });
  const member = classifyAddressabilityApplicability({ evidence: systemWide, population: population({ id: "pop-heat", family: "Heat Detector", drawingScope: null }) });
  assert.equal(member.status, "CONFIRMED_APPLICABLE");
  const nonMember = classifyAddressabilityApplicability({ evidence: systemWide, population: population({ id: "pop-mcp", family: "MCP", drawingScope: null }) });
  assert.equal(nonMember.status, "NOT_APPLICABLE");
  const unknown = classifyAddressabilityApplicability({ evidence: systemWide, population: population({ id: "pop-u", family: null, drawingScope: null }) });
  assert.equal(unknown.status, "INSUFFICIENT_EVIDENCE");
});

// ---------------------------------------------------------------------------
// negative evidence
// ---------------------------------------------------------------------------

test("negative: two independent conventional sources still resolve NON_ADDRESSABLE (no false conflict)", () => {
  const convA = eligible({
    id: "ev-conv-a",
    addressabilityClaim: "CONVENTIONAL",
    negative: true,
    basis: "EXPLICIT_BOQ_RELATIONSHIP",
    scope: { system: "Fire Alarm", populationIds: ["pop-101-sd"] },
  });
  const convB = eligible({
    id: "ev-conv-b",
    addressabilityClaim: "CONVENTIONAL",
    negative: true,
    basis: "HUMAN_ENGINEERING_DECISION",
    scope: { system: "Fire Alarm", populationIds: ["pop-101-sd"] },
  });
  const plan = planAddressabilityAttachments({ evidences: [convA, convB], populations: [population()] });
  const derived = derivePopulationAddressability({ population: population(), classifications: plan.classifications });
  assert.equal(derived.resolutionState, "ADDRESSABILITY_RESOLVED_NON_ADDRESSABLE");
  assert.equal(derived.resolvedAddressability, "CONVENTIONAL");
  assert.deepEqual(derived.conflictingClaims, []);
});

// ---------------------------------------------------------------------------
// schedule scope
// ---------------------------------------------------------------------------

test("schedule: no schedule identity declared -> INSUFFICIENT_EVIDENCE", () => {
  const schedule = eligible({ id: "ev-schedule", basis: "EXPLICIT_SCHEDULE_REFERENCE", scope: { system: "Fire Alarm" } });
  const decision = classifyAddressabilityApplicability({ evidence: schedule, population: population({ schedules: ["schedule_det_001"], drawingScope: null }) });
  assert.equal(decision.status, "INSUFFICIENT_EVIDENCE");
});

// ---------------------------------------------------------------------------
// explicit BOQ relationship & human decisions
// ---------------------------------------------------------------------------

test("relationship: explicit BOQ relationship names the population -> CONFIRMED; names others -> NOT_APPLICABLE; names none -> INSUFFICIENT", () => {
  const named = eligible({ id: "ev-boq", basis: "EXPLICIT_BOQ_RELATIONSHIP", scope: { system: "Fire Alarm", populationIds: ["pop-101-sd"] } });
  assert.equal(classifyAddressabilityApplicability({ evidence: named, population: population() }).status, "CONFIRMED_APPLICABLE");
  const other = eligible({ id: "ev-boq", basis: "EXPLICIT_BOQ_RELATIONSHIP", scope: { system: "Fire Alarm", populationIds: ["pop-other"] } });
  assert.equal(classifyAddressabilityApplicability({ evidence: other, population: population() }).status, "NOT_APPLICABLE");
  const none = eligible({ id: "ev-boq", basis: "EXPLICIT_BOQ_RELATIONSHIP", scope: { system: "Fire Alarm" } });
  assert.equal(classifyAddressabilityApplicability({ evidence: none, population: population() }).status, "INSUFFICIENT_EVIDENCE");
});

test("relationship: a human engineering decision must name its populations", () => {
  const decision = eligible({
    id: "ev-human",
    basis: "HUMAN_ENGINEERING_DECISION",
    scope: { system: "Fire Alarm", populationIds: ["pop-101-sd"] },
  });
  assert.equal(classifyAddressabilityApplicability({ evidence: decision, population: population() }).status, "CONFIRMED_APPLICABLE");
  const empty = eligible({ id: "ev-human", basis: "HUMAN_ENGINEERING_DECISION", scope: { system: "Fire Alarm" } });
  assert.equal(classifyAddressabilityApplicability({ evidence: empty, population: population() }).status, "INSUFFICIENT_EVIDENCE");
});

// ---------------------------------------------------------------------------
// ambiguity & engineering review (section 18, 23, 24, 34)
// ---------------------------------------------------------------------------

test("review: ambiguous/contested evidence -> REQUIRES_ENGINEERING_REVIEW, population stays ADDRESSABILITY_REQUIRES_REVIEW", () => {
  const ambiguous = eligible({ id: "ev-amb", ambiguous: true, basis: "EXPLICIT_BOQ_RELATIONSHIP", scope: { system: "Fire Alarm", populationIds: ["pop-101-sd"] } });
  const plan = planAddressabilityAttachments({
    evidences: [ambiguous],
    populations: [population()],
  });
  const classification = plan.classifications[0];
  assert.equal(classification.status, "REQUIRES_ENGINEERING_REVIEW");
  assert.equal(plan.attachmentsToCreate.length, 0);
  const derived = derivePopulationAddressability({ population: population(), classifications: plan.classifications });
  assert.equal(derived.resolutionState, "ADDRESSABILITY_REQUIRES_REVIEW");
  assert.equal(derived.reviewRequiredEvidence.length, 1);
});

test("review: a pending review question wins over an apparent resolution (fail closed)", () => {
  const confirmed = eligible({ id: "ev-addr", basis: "EXPLICIT_BOQ_RELATIONSHIP", scope: { system: "Fire Alarm", populationIds: ["pop-101-sd"] } });
  const ambiguous = eligible({ id: "ev-amb", ambiguous: true, basis: "EXPLICIT_BOQ_RELATIONSHIP", scope: { system: "Fire Alarm", populationIds: ["pop-101-sd"] } });
  const plan = planAddressabilityAttachments({ evidences: [confirmed, ambiguous], populations: [population()] });
  const derived = derivePopulationAddressability({ population: population(), classifications: plan.classifications });
  assert.equal(derived.resolutionState, "ADDRESSABILITY_REQUIRES_REVIEW");
});

test("review: human review questions name evidence, population, and the exact blocking question", () => {
  const familyScoped = eligible({
    id: "ev-det-scope",
    basis: "EXPLICIT_DEVICE_FAMILY_SCOPE",
    scope: { system: "Fire Alarm", families: ["Smoke Detector"] },
  });
  const questions = addressabilityReviewQuestions({
    evidence: familyScoped,
    population: population({ id: "pop-unknown", family: null, drawingScope: null }),
  });
  assert.equal(questions.length, 1);
  assert.equal(questions[0].evidenceId, "ev-det-scope");
  assert.equal(questions[0].populationId, "pop-unknown");
  assert.match(questions[0].question, /ev-det-scope/);
  assert.match(questions[0].question, /pop-unknown/);
  assert.equal(questions[0].state, "ADDRESSABILITY_APPLICABILITY_REQUIRED");
});

// ---------------------------------------------------------------------------
// vocabulary & invariants
// ---------------------------------------------------------------------------

test("vocabulary: policy version, states, bases, and prohibited bases are pinned", () => {
  assert.equal(ADDRESSABILITY_APPLICABILITY_POLICY_VERSION, "fire-alarm-addressability-applicability-policy-1.0.0");
  assert.deepEqual(ADDRESSABILITY_APPLICABILITY_STATUSES, ["CONFIRMED_APPLICABLE", "NOT_APPLICABLE", "INSUFFICIENT_EVIDENCE", "REQUIRES_ENGINEERING_REVIEW"]);
  assert.deepEqual(ADDRESSABILITY_EVIDENCE_BASES, [
    "SAME_DRAWING_SYMBOL_SCOPE",
    "SAME_DRAWING_SHEET_SCOPE",
    "EXPLICIT_LEGEND_REFERENCE",
    "EXPLICIT_SCHEDULE_REFERENCE",
    "APPROVED_SYSTEM_WIDE_REQUIREMENT",
    "EXPLICIT_DEVICE_FAMILY_SCOPE",
    "EXPLICIT_BOQ_RELATIONSHIP",
    "HUMAN_ENGINEERING_DECISION",
  ]);
  assert.deepEqual(PROHIBITED_APPLICABILITY_BASES, ["SAME_FIRE_ALARM_SYSTEM", "SAME_MANUFACTURER", "PRODUCT_FAMILY_GUESS", "SAME_DESCRIPTION"]);
  assert.deepEqual(ADDRESSABILITY_RESOLUTION_STATES, [
    "ADDRESSABILITY_RESOLVED_ADDRESSABLE",
    "ADDRESSABILITY_RESOLVED_NON_ADDRESSABLE",
    "ADDRESSABILITY_CONFLICT",
    "ADDRESSABILITY_INSUFFICIENT_EVIDENCE",
    "ADDRESSABILITY_REQUIRES_REVIEW",
  ]);
});

test("vocabulary: a manufacturer / product-family-guess NEVER establishes scope", () => {
  const manufacturer = eligible({ id: "ev-man", basis: "SAME_MANUFACTURER", scope: { system: "Fire Alarm" } });
  assert.equal(classifyAddressabilityApplicability({ evidence: manufacturer, population: population() }).status, "NOT_APPLICABLE");
  const familyGuess = eligible({ id: "ev-guess", basis: "PRODUCT_FAMILY_GUESS", scope: { system: "Fire Alarm" } });
  assert.equal(classifyAddressabilityApplicability({ evidence: familyGuess, population: population() }).status, "NOT_APPLICABLE");
});

// ---------------------------------------------------------------------------
// section 37 -- idempotency of the full plan
// ---------------------------------------------------------------------------

test("idempotency: identical inputs -> identical classifications and attachments, no duplicates", () => {
  const evidences = [
    eligible({ id: "ev-sd" }),
    eligible({ id: "ev-r53", claimKind: "SYSTEM_ARCHITECTURE", basis: "APPROVED_SYSTEM_WIDE_REQUIREMENT", scope: { system: "Fire Alarm", systemWide: true } }),
    eligible({ id: "ev-net", claimKind: "NETWORK_ARCHITECTURE", addressabilityClaim: null, scope: { system: "Fire Alarm" } }),
  ];
  const populations = [
    population({ id: "pop-101", family: "Heat Detector", drawingScope: { sheets: ["FA-101"], symbols: ["HD"] } }),
    population({ id: "pop-facp", family: "Fire Alarm Control Panel", drawingScope: null }),
  ];
  const first = planAddressabilityAttachments({ evidences, populations });
  const second = planAddressabilityAttachments({ evidences, populations });
  assert.equal(first.attachmentsToCreate.length, expectedAttachmentPairs({ evidences, populations }));
  assert.deepEqual(
    second.classifications.map((entry) => `${entry.evidenceId}|${entry.populationId}|${entry.status}`),
    first.classifications.map((entry) => `${entry.evidenceId}|${entry.populationId}|${entry.status}`),
  );
  const third = planAddressabilityAttachments({ evidences, populations, existingAttachments: first.attachmentsToCreate });
  assert.equal(third.attachmentsToCreate.length, 0);
});

const expectedAttachmentPairs = ({ evidences, populations }) => {
  let count = 0;
  for (const evidence of evidences) {
    for (const p of populations) {
      if (classifyAddressabilityApplicability({ evidence, population: p }).status === "CONFIRMED_APPLICABLE") count += 1;
    }
  }
  return count;
};

test("idempotency: derivePopulationAddressability over identical classifications is stable", () => {
  const plan = planAddressabilityAttachments({ evidences: [eligible()], populations: [population()] });
  const a = derivePopulationAddressability({ population: population(), classifications: plan.classifications });
  const b = derivePopulationAddressability({ population: population(), classifications: plan.classifications });
  assert.equal(a.resolutionState, b.resolutionState);
  assert.equal(a.resolvedAddressability, b.resolvedAddressability);
  assert.deepEqual(a.applicableAddressabilityEvidence, b.applicableAddressabilityEvidence);
});

// ---------------------------------------------------------------------------
// downstream handoff: only governed attachments may reach the resolver
// ---------------------------------------------------------------------------

test("handoff: an observation can only be built from a governed attachment", () => {
  assert.throws(() => buildResolverObservation(undefined, population()), /evidence record|attachment/i);
  assert.throws(() => buildResolverObservation({}, population()), /attachment/i);
});

test("handoff: classification preserves all provenance on the attachment", () => {
  const plan = planAddressabilityAttachments({ evidences: [eligible()], populations: [population()] });
  const attachment = plan.attachmentsToCreate[0];
  assert.deepEqual(attachment.provenance, {
    source: "Drawing Legend",
    sourceLocation: "sheet 1",
    authority: "Legend (approved)",
    sourcePage: null,
    sourceDrawingNumber: null,
    evidenceVersionId: null,
  });
  assert.equal(attachment.policyVersion, ADDRESSABILITY_APPLICABILITY_POLICY_VERSION);
  assert.equal(attachment.negative, false);
});

test("handoff: multi-address device stays review-required; addressability alone never resolves a point", () => {
  const plan = planAddressabilityAttachments({
    evidences: [eligible({ id: "ev-addr" })],
    populations: [population({ id: "pop-mod", family: "Monitor Module", drawingScope: { sheets: ["FA-101"], symbols: ["SD"] } })],
  });
  const attachment = plan.attachmentsToCreate[0];
  const observation = buildResolverObservation(attachment, population({ id: "pop-mod" }));
  const resolved = resolveFireAlarmDeviceAuthority({
    populationId: "pop-mod",
    system: "Fire Alarm",
    evidence: [observation],
  });
  assert.equal(resolved.resolution.addressability.state, "GOVERNED_ADDRESSABILITY_RESOLVED");
  // The resolver feeds the canonical classifier; the classifier is the only
  // place a point value can come from.
  const classified = classifyResolvedDeviceEvidence({ resolution: resolved, quantity: 3 });
  assert.equal(classified.unitsPerDevice, null);
  assert.equal(classified.canonicalState, "UNRESOLVED");
});

test("handoff: NOT_SLC families resolve to zero points through the canonical contract", () => {
  const plan = planAddressabilityAttachments({
    evidences: [eligible({ id: "ev-addr" })],
    populations: [population({ id: "pop-facp2", family: "Fire Alarm Control Panel", drawingScope: { sheets: ["FA-101"], symbols: ["SD"] } })],
  });
  // A legend symbol can attach to the population (sheet/symbol in scope); the
  // canonical classifier then decides a FACP is NOT_SLC and consumes 0 points.
  const attachment = plan.attachmentsToCreate[0];
  const observation = buildResolverObservation(attachment, population({ id: "pop-facp2" }));
  const resolved = resolveFireAlarmDeviceAuthority({
    populationId: "pop-facp2",
    system: "Fire Alarm",
    evidence: [familyObservation("family-obs|pop-facp2", "pop-facp2", "Fire Alarm Control Panel"), observation],
  });
  const classified = classifyResolvedDeviceEvidence({ resolution: resolved, quantity: 1 });
  assert.equal(classified.canonicalState, "NOT_SLC");
  assert.equal(classified.unitsPerDevice, 0);
});

test("handoff: addressable + governed detector family resolves exactly one point from the classifier", () => {
  const familyEvidence = eligible({
    id: "ev-det-scope",
    kind: "SPECIFICATION_REQUIREMENT",
    basis: "EXPLICIT_DEVICE_FAMILY_SCOPE",
    scope: { system: "Fire Alarm", families: ["Addressable Smoke Detector"] },
  });
  const plan = planAddressabilityAttachments({
    evidences: [familyEvidence],
    populations: [population({ id: "pop-det", family: "Addressable Smoke Detector", drawingScope: null })],
  });
  const attachment = plan.attachmentsToCreate[0];
  const observation = buildResolverObservation(attachment, population({ id: "pop-det" }));
  const resolved = resolveFireAlarmDeviceAuthority({
    populationId: "pop-det",
    system: "Fire Alarm",
    evidence: [familyObservation("family-obs|pop-det", "pop-det", "Addressable Smoke Detector"), observation],
  });
  assert.equal(resolved.resolution.addressability.value, "ADDRESSABLE");
  const classified = classifyResolvedDeviceEvidence({ resolution: resolved, quantity: 10 });
  assert.equal(classified.canonicalState, "SLC_DETECTOR_POOL");
  assert.equal(classified.unitsPerDevice, 1);
  assert.equal(classified.demandUnits, 10);
});

// ---------------------------------------------------------------------------
// input validation
// ---------------------------------------------------------------------------

test("input: missing evidence/population fails loudly", () => {
  assert.throws(() => classifyAddressabilityApplicability({ population: population() }), /evidence/i);
  assert.throws(() => classifyAddressabilityApplicability({ evidence: eligible() }), /population/i);
  assert.throws(() => classifyAddressabilityApplicability({ evidence: { ...eligible(), claimKind: "GARBAGE" }, population: population() }), /claim kind/i);
  assert.throws(() => classifyAddressabilityApplicability({ evidence: { ...eligible(), addressabilityClaim: "MAYBE" }, population: population() }), /claim value/i);
});