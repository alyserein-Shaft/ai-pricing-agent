/**
 * GOLDEN-6C -- governed preliminary Fire Alarm point count & sizing input.
 *
 * The device point-consumption contract is the CANONICAL classifier
 * (fire-alarm-slc-resource-classifier); this suite proves the aggregation,
 * reconciliation, scope, threshold, completeness and adapter rules on top of it,
 * and proves the engine contains no manufacturer, panel-model or ecosystem
 * logic of its own.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  FIRE_ALARM_PRELIMINARY_POINT_DEMAND_VERSION,
  PRELIMINARY_POINT_THRESHOLD,
  buildDeviceInventoryRecord,
  reconcilePopulation,
  classifyDevicePointDemand,
  aggregatePreliminaryPointDemand,
  preliminarySizingInput,
} from "../app/domain/fire-alarm-preliminary-point-demand.mjs";

const rec = (over = {}) => buildDeviceInventoryRecord({
  populationId: "pop-1",
  deviceFamily: "Addressable Smoke Detector",
  system: "Fire Alarm",
  // Governed addressability evidence. Absent this, the canonical classifier
  // refuses to price a detector at one point -- the gap the live project has.
  addressability: "addressable",
  scope: { project: "P1", building: "Building A", fireAlarmSystem: "FA-1" },
  governingSource: "BOQ",
  sources: [{ authority: "BOQ", source: "BOQ-1", quantity: 100, confidence: 90 }],
  ...over,
});

/* ================================================================== *
 * Section 31 -- acceptance scenarios
 * ================================================================== */

test("GOLDEN-6C 31.1  100 confirmed addressable detectors -> 100 known points", () => {
  const result = aggregatePreliminaryPointDemand([
    rec({ sources: [{ authority: "BOQ", source: "BOQ-1", quantity: 100 }] }),
  ], { governingAuthority: "BOQ" });
  const row = result.populations[0];
  assert.equal(row.classified.demandClass, "ADDRESSABLE_DETECTOR_POINT");
  assert.equal(row.knownPointDemand, 100);
  assert.equal(result.knownPointDemand, 100);
  assert.equal(result.unknownPointDemand, 0);
});

test("GOLDEN-6C 31.2  20 one-point monitor modules -> +20 known points", () => {
  const result = aggregatePreliminaryPointDemand([
    rec({ populationId: "d", sources: [{ authority: "BOQ", source: "s", quantity: 100 }] }),
    rec({
      populationId: "m",
      deviceFamily: "Monitor Module",
      sources: [{ authority: "BOQ", source: "s", quantity: 20 }],
    }),
  ], { governingAuthority: "BOQ" });
  assert.equal(result.knownPointDemand, 120, "modules add their own governed demand");
  assert.deepEqual(
    result.populations.map((r) => r.classified.demandClass).sort(),
    ["ADDRESSABLE_DETECTOR_POINT", "ADDRESSABLE_MODULE_POINT"],
  );
});

test("GOLDEN-6C 31.3  module with no established consumption -> unknown demand, never zero", () => {
  // A dual-input / multi-channel module has no governed units-per-device
  // contract, so the canonical classifier refuses to price it at one point.
  const multi = rec({
    populationId: "m-multi",
    deviceFamily: "Monitor Module",
    // Governed multi-channel evidence travels with the population.
    attributes: { channel_count: 2 },
    sources: [{ authority: "BOQ", source: "s", quantity: 8 }],
  });
  const classified = classifyDevicePointDemand(multi, { quantity: 8 });
  assert.equal(classified.demandClass, "UNKNOWN_NEEDS_REVIEW");
  assert.equal(classified.pointDemand, null);

  const result = aggregatePreliminaryPointDemand([multi], { governingAuthority: "BOQ" });
  assert.equal(result.knownPointDemand, 0, "unknown consumption never becomes known points");
  assert.equal(result.unknownPointDemand, 8, "and it is never dropped as zero");
});

test("GOLDEN-6C 31.4  conventional horn / strobe quantity adds no SLC point", () => {
  const result = aggregatePreliminaryPointDemand([
    rec({ populationId: "n1", deviceFamily: "Horn", sources: [{ authority: "BOQ", source: "s", quantity: 40 }] }),
    rec({ populationId: "n2", deviceFamily: "Strobe", sources: [{ authority: "BOQ", source: "s", quantity: 97 }] }),
    rec({ populationId: "n3", deviceFamily: "Speaker", sources: [{ authority: "BOQ", source: "s", quantity: 12 }] }),
  ], { governingAuthority: "BOQ" });
  assert.equal(result.knownPointDemand, 0, "notification appliances are not automatically SLC points");
  assert.equal(result.unknownPointDemand, 149, "they stay visible as unresolved until addressable evidence exists");
  for (const row of result.populations) {
    assert.equal(row.classified.canonicalState, "UNRESOLVED");
  }
});

test("GOLDEN-6C 31.5  FACP / power supply / battery add no field-point demand", () => {
  const result = aggregatePreliminaryPointDemand([
    rec({ populationId: "p1", deviceFamily: "Fire Alarm Control Panel", sources: [{ authority: "BOQ", source: "s", quantity: 1 }] }),
    rec({ populationId: "p2", deviceFamily: "Power Supply", sources: [{ authority: "BOQ", source: "s", quantity: 4 }] }),
    rec({ populationId: "p3", deviceFamily: "Battery", sources: [{ authority: "BOQ", source: "s", quantity: 8 }] }),
  ], { governingAuthority: "BOQ" });
  assert.equal(result.knownPointDemand, 0);
  assert.equal(result.unknownPointDemand, 0, "excluded equipment is excluded, not hidden as unknown");
  for (const row of result.populations) {
    assert.equal(row.classified.demandClass, "NON_ADDRESSABLE_EQUIPMENT");
  }
  // Section 26: captured as architecture/complexity EVIDENCE, never a decision.
  assert.equal(result.complexityEvidence.decidedByThisStage, false);
  assert.equal(result.complexityEvidence.decision, null);
  assert.equal(result.complexityEvidence.signals.length, 3);
});

test("GOLDEN-6C 31.6  GUI / workstation equipment adds no field-point demand", () => {
  const result = aggregatePreliminaryPointDemand([
    rec({ populationId: "g1", deviceFamily: "Annunciator", sources: [{ authority: "BOQ", source: "s", quantity: 1 }] }),
  ], { governingAuthority: "BOQ" });
  // An unknown family is UNRESOLVED, never silently treated as a point consumer.
  assert.equal(result.knownPointDemand, 0);
  assert.equal(result.unknownPointDemand, 1);
});

test("GOLDEN-6C 31.7  the SAME population across BOQ and layout is counted once", () => {
  const single = rec({
    sources: [
      { authority: "BOQ", source: "BOQ-1", quantity: 200 },
      { authority: "PRINTED_DRAWING", source: "Riser T-93", quantity: 200 },
    ],
  });
  const result = aggregatePreliminaryPointDemand([single], { governingAuthority: "BOQ" });
  assert.equal(result.knownPointDemand, 200, "two sources describing one population are not 400");
  assert.equal(result.populations[0].reconciliation.state, "QUANTITY_CONFIRMED");
  // The lineage is preserved, not flattened away.
  assert.equal(single.sources.length, 2);
});

test("GOLDEN-6C 31.8  two INDEPENDENT populations are counted separately", () => {
  const result = aggregatePreliminaryPointDemand([
    rec({ populationId: "bldgA", scope: { project: "P1", building: "A" }, sources: [{ authority: "BOQ", source: "s", quantity: 200 }] }),
    rec({ populationId: "bldgB", scope: { project: "P1", building: "B" }, sources: [{ authority: "BOQ", source: "s", quantity: 200 }] }),
  ], { governingAuthority: "BOQ" });
  assert.equal(result.knownPointDemand, 400, "distinct populations are both counted");
  assert.equal(result.scopeTotals.length, 2, "each keeps its own building scope");
});

test("GOLDEN-6C 31.9  BOQ/drawing quantity conflict is reported, never arbitrarily summed or won", () => {
  const conflicted = rec({
    sources: [
      { authority: "BOQ", source: "BOQ-1", quantity: 180 },
      { authority: "PRINTED_DRAWING", source: "Riser T-93", quantity: 184 },
    ],
  });
  const reconciliation = reconcilePopulation(conflicted);
  assert.equal(reconciliation.state, "QUANTITY_CONFLICT");
  assert.equal(reconciliation.quantity, null, "no winner is chosen");

  const result = aggregatePreliminaryPointDemand([conflicted]);
  assert.equal(result.knownPointDemand, 0);
  assert.equal(result.unknownPointDemand, 0, "an unresolved conflict contributes no invented quantity");
  assert.equal(result.completeness, "CONFLICTED");
  assert.equal(result.conflicts.length, 1);
  assert.ok(result.conflicts[0].reason.includes("no value is chosen"));
});

test("GOLDEN-6C 31.10  a governing authority resolves a conflict by policy, not by arithmetic", () => {
  const conflicted = rec({
    sources: [
      { authority: "BOQ", source: "BOQ-1", quantity: 180 },
      { authority: "PRINTED_DRAWING", source: "Riser T-93", quantity: 184 },
    ],
  });
  const result = aggregatePreliminaryPointDemand([conflicted], { governingAuthority: "PRINTED_DRAWING" });
  assert.equal(result.populations[0].reconciliation.state, "QUANTITY_RECONCILED");
  assert.equal(result.knownPointDemand, 184, "the authority model decides, and the other value is retained");
  assert.equal(conflicted.sources.length, 2, "non-governing evidence is retained, not deleted");
});

test("GOLDEN-6C 31.11  a missing building layout is incomplete coverage, not zero devices", () => {
  const result = aggregatePreliminaryPointDemand([
    rec({ populationId: "a", scope: { project: "P1", building: "A" }, sources: [{ authority: "BOQ", source: "s", quantity: 100 }] }),
  ], { governingAuthority: "BOQ", knownScopes: ["A", "B", "Welcome Center"] });
  assert.equal(result.completeness, "PARTIALLY_COMPLETE", "known-but-uncovered scopes keep the result incomplete");
  assert.equal(result.knownPointDemand, 100, "covered evidence is still reported");
  assert.equal(result.unknownPointDemand, 0, "an absent layout is reported as incomplete, never invented as zero-demand");
});

test("GOLDEN-6C 31.12  unknown device type is not zero", () => {
  const result = aggregatePreliminaryPointDemand([
    rec({ populationId: "u", deviceFamily: "Unclassified Specialty Device", sources: [{ authority: "BOQ", source: "s", quantity: 75 }] }),
  ], { governingAuthority: "BOQ" });
  assert.equal(result.knownPointDemand, 0);
  assert.equal(result.unknownPointDemand, 75);
  assert.equal(result.unresolvedPopulations, 1);
});

test("GOLDEN-6C 31.13  known 1500, no material unknown -> 1500 usable", () => {
  const result = aggregatePreliminaryPointDemand([
    rec({ sources: [{ authority: "BOQ", source: "s", quantity: 1500 }] }),
  ], { governingAuthority: "BOQ" });
  assert.equal(result.knownPointDemand, 1500);
  assert.equal(result.thresholdStatus, "WITHIN_THRESHOLD_CONFIRMED");
  assert.equal(result.preliminaryTotalPoints, 1500);
  const input = preliminarySizingInput(result);
  assert.equal(input.preliminaryTotalPoints, 1500);
  assert.equal(input.usable, true);
});

test("GOLDEN-6C 31.14  known 2200 -> above-threshold is PROVEN even with unknown devices present", () => {
  const result = aggregatePreliminaryPointDemand([
    rec({ sources: [{ authority: "BOQ", source: "s", quantity: 2200 }] }),
    rec({ populationId: "u", deviceFamily: "Unclassified Specialty Device", sources: [{ authority: "BOQ", source: "s", quantity: 100 }] }),
  ], { governingAuthority: "BOQ" });
  assert.equal(result.knownPointDemand, 2200);
  assert.equal(result.unknownPointDemand, 100);
  assert.equal(result.thresholdStatus, "ABOVE_THRESHOLD_CONFIRMED", "unresolved demand cannot retract a proof");
  assert.equal(result.preliminaryTotalPoints, 2200, "the proven known total is usable; the unknown is reported separately");
  assert.equal(result.unknownPointDemand, 100, "the unknown remainder is never folded into the total");
  assert.equal(preliminarySizingInput(result).usable, true);
});

test("GOLDEN-6C 31.15  known 1950 + material unknown -> threshold UNCERTAIN, no exact policy number", () => {
  const result = aggregatePreliminaryPointDemand([
    rec({ sources: [{ authority: "BOQ", source: "s", quantity: 1950 }] }),
    rec({ populationId: "u", deviceFamily: "Unclassified Specialty Device", sources: [{ authority: "BOQ", source: "s", quantity: 75 }] }),
  ], { governingAuthority: "BOQ" });
  assert.equal(result.thresholdStatus, "THRESHOLD_UNCERTAIN");
  assert.equal(result.completeness, "THRESHOLD_UNCERTAIN");
  assert.equal(result.preliminaryTotalPoints, null, "no exact point count is published");
  const input = preliminarySizingInput(result);
  assert.equal(input.preliminaryTotalPoints, null);
  assert.equal(input.usable, false);
  assert.equal(input.thresholdStatus, "THRESHOLD_UNCERTAIN");
});

test("GOLDEN-6C 31.16  identical evidence is idempotent (same fingerprint inputs, same result)", () => {
  const records = () => [
    rec({ sources: [{ authority: "BOQ", source: "s", quantity: 700 }] }),
    rec({ populationId: "m", deviceFamily: "Monitor Module", sources: [{ authority: "BOQ", source: "s", quantity: 40 }] }),
    rec({ populationId: "u", deviceFamily: "Unclassified Specialty Device", sources: [{ authority: "BOQ", source: "s", quantity: 10 }] }),
  ];
  const first = aggregatePreliminaryPointDemand(records(), { governingAuthority: "BOQ" });
  const second = aggregatePreliminaryPointDemand(records(), { governingAuthority: "BOQ" });
  const project = (r) => JSON.stringify({
    known: r.knownPointDemand, unknown: r.unknownPointDemand,
    threshold: r.thresholdStatus, completeness: r.completeness,
    preliminary: r.preliminaryTotalPoints,
  });
  assert.equal(project(first), project(second), "the same effective evidence yields the same sizing result");
});

test("GOLDEN-6C 31.17  a changed effective quantity changes the result", () => {
  const before = aggregatePreliminaryPointDemand([
    rec({ sources: [{ authority: "BOQ", source: "s", quantity: 700 }] }),
  ], { governingAuthority: "BOQ" });
  const after = aggregatePreliminaryPointDemand([
    rec({ sources: [{ authority: "BOQ", source: "s", quantity: 900 }] }),
  ], { governingAuthority: "BOQ" });
  assert.notEqual(before.knownPointDemand, after.knownPointDemand);
  assert.notEqual(before.preliminaryTotalPoints, after.preliminaryTotalPoints);
});

test("GOLDEN-6C 31.18  preliminary points resolve while compliance regime stays unresolved", () => {
  // Section 25: this stage is independent of the compliance regime. It does
  // not read, require or infer one, and its output carries no ecosystem.
  const result = aggregatePreliminaryPointDemand([
    rec({ sources: [{ authority: "BOQ", source: "s", quantity: 1500 }] }),
  ], { governingAuthority: "BOQ" });
  const serialised = JSON.stringify(result);
  assert.equal(result.preliminaryTotalPoints, 1500);
  assert.doesNotMatch(serialised, /UL\/FM|ULC|LPCB|EN ?54|compliance/i,
    "the preliminary stage carries no compliance-regime opinion");
  assert.equal(result.resolvedEcosystem, undefined, "no ecosystem is selected here");
});

test("GOLDEN-6C 31.19  known 1500 + UL/FM hands the policy the correct count", async () => {
  const { resolveFireAlarmEcosystem } = await import("../app/domain/fire-alarm-ecosystem-policy.mjs");
  const result = aggregatePreliminaryPointDemand([
    rec({ sources: [{ authority: "BOQ", source: "s", quantity: 1500 }] }),
  ], { governingAuthority: "BOQ" });
  const input = preliminarySizingInput(result);
  const decision = resolveFireAlarmEcosystem({
    complianceRegime: "UL/FM",
    preliminaryTotalPoints: input.preliminaryTotalPoints,
    complexity: "not-exceptional",
  });
  assert.equal(input.preliminaryTotalPoints, 1500);
  assert.equal(decision.inputsUsed.preliminaryTotalPoints, 1500, "the policy receives the governed count");
  assert.equal(decision.thresholdIsCertifiedMaximum, false, "the 2,000 threshold is never a certified manufacturer maximum");
});

test("GOLDEN-6C 31.20  uncertainty withholds the policy number rather than feeding a false one", async () => {
  const { resolveFireAlarmEcosystem } = await import("../app/domain/fire-alarm-ecosystem-policy.mjs");
  const result = aggregatePreliminaryPointDemand([
    rec({ sources: [{ authority: "BOQ", source: "s", quantity: 1950 }] }),
    rec({ populationId: "u", deviceFamily: "Unclassified Specialty Device", sources: [{ authority: "BOQ", source: "s", quantity: 75 }] }),
  ], { governingAuthority: "BOQ" });
  const decision = resolveFireAlarmEcosystem({
    complianceRegime: "UL/FM",
    preliminaryTotalPoints: preliminarySizingInput(result).preliminaryTotalPoints,
    complexity: "not-exceptional",
  });
  assert.equal(decision.inputsUsed.preliminaryTotalPoints, null, "no unproven count reaches the policy");
  assert.notEqual(decision.decisionState, "RESOLVED_FARENHYT", "a false confident ecosystem decision is impossible here");
});

test("GOLDEN-6C 31.21  complexity evidence is preserved and never becomes a decision", () => {
  const result = aggregatePreliminaryPointDemand([
    rec({ populationId: "p", deviceFamily: "Fire Alarm Control Panel", sources: [{ authority: "BOQ", source: "s", quantity: 3 }] }),
  ], { governingAuthority: "BOQ" });
  assert.equal(result.complexityEvidence.decidedByThisStage, false);
  assert.equal(result.complexityEvidence.decision, null);
  assert.ok(result.complexityEvidence.signals.length > 0, "multiple panels are observable evidence");
  // There is no API on this module that could set a complexity decision.
  assert.ok(!("resolveComplexity" in result));
});

/* ================================================================== *
 * Section 32 -- mandatory negative assertions
 * ================================================================== */

test("GOLDEN-6C 32.1  device quantity does not silently equal point demand", () => {
  // A family with no governed units-per-device contract cannot become a point.
  const record = rec({ deviceFamily: "Unclassified Specialty Device", sources: [{ authority: "BOQ", source: "s", quantity: 131 }] });
  const classified = classifyDevicePointDemand(record, { quantity: 131 });
  assert.equal(classified.pointDemand, null);
  assert.equal(classified.pointDemand, null, "no point is invented from a raw quantity");
  assert.equal(record.sources[0].quantity, 131, "the quantity is preserved in the inventory lineage");
  assert.equal(record.reviewStatus, "Needs Review");
});

test("GOLDEN-6C 32.2  not every Fire Alarm device is 1 point", () => {
  // Multi-address evidence must not collapse to one point per device.
  const classified = classifyDevicePointDemand(
    rec({ deviceFamily: "Monitor Module", sources: [{ authority: "BOQ", source: "s", quantity: 10 }] }),
    { quantity: 10, extraAttributes: { point_count: 4 } },
  );
  assert.equal(classified.unitsPerDevice, null);
  assert.equal(classified.pointDemand, null);
});

test("GOLDEN-6C 32.3  unknown quantity never becomes 0 and never vanishes", () => {
  const result = aggregatePreliminaryPointDemand([
    rec({ populationId: "u", deviceFamily: "Unclassified Specialty Device", sources: [{ authority: "BOQ", source: "s", quantity: 63 }] }),
  ], { governingAuthority: "BOQ" });
  assert.equal(result.unknownPointDemand, 63);
  assert.equal(result.knownPointDemand, 0);
  assert.notEqual(result.unknownPointDemand, 0);
});

test("GOLDEN-6C 32.4  a population with no numeric quantity is QUANTITY_UNKNOWN", () => {
  const record = rec({ sources: [{ authority: "BOQ", source: "s", quantity: null }] });
  const reconciliation = reconcilePopulation(record);
  assert.equal(reconciliation.state, "QUANTITY_UNKNOWN");
  assert.equal(reconciliation.quantity, null);
});

test("GOLDEN-6C 32.5  inventory records require governed identity and a quantity source", () => {
  assert.throws(
    () => buildDeviceInventoryRecord({ sources: [{ authority: "BOQ", source: "s", quantity: 1 }] }),
    /GOLDEN6C_POPULATION_ID_REQUIRED/,
  );
  assert.throws(
    () => buildDeviceInventoryRecord({ populationId: "p", sources: [] }),
    /GOLDEN6C_QUANTITY_SOURCE_REQUIRED/,
  );
});

test("GOLDEN-6C 32.6  the project total is never divided across panels", () => {
  const result = aggregatePreliminaryPointDemand([
    rec({ sources: [{ authority: "BOQ", source: "s", quantity: 1200 }] }),
    rec({ populationId: "p1", deviceFamily: "Fire Alarm Control Panel", sources: [{ authority: "BOQ", source: "s", quantity: 1 }] }),
    rec({ populationId: "p2", deviceFamily: "Fire Alarm Control Panel", scope: { project: "P1", building: "B", panel: "P2" }, sources: [{ authority: "BOQ", source: "s", quantity: 1 }] }),
  ], { governingAuthority: "BOQ" });
  assert.equal(result.projectTotalPoints, 1200, "the project total is the whole demand");
  const panelScopes = result.scopeTotals.filter((scope) => scope.scope.panel);
  for (const scope of panelScopes) {
    assert.notEqual(scope.knownPointDemand, 600, "no even split of 1200 across two panels is invented");
  }
});

test("GOLDEN-6C 32.7  spare capacity is never folded into the demand total", () => {
  const result = aggregatePreliminaryPointDemand([
    rec({ sources: [{ authority: "BOQ", source: "s", quantity: 1500 }] }),
  ], { governingAuthority: "BOQ" });
  assert.equal(result.knownPointDemand, 1500, "demand is demand, not inflated design capacity");
  assert.equal(JSON.stringify(result).includes("spareCapacity"), false, "no spare-capacity figure is computed here");
});

test("GOLDEN-6C 32.8  confidence is not derived from quantity size", () => {
  const small = aggregatePreliminaryPointDemand([
    rec({ sources: [{ authority: "BOQ", source: "s", quantity: 10 }] }),
  ], { governingAuthority: "BOQ" });
  const conflicted = aggregatePreliminaryPointDemand([
    rec({ sources: [{ authority: "BOQ", source: "s", quantity: 10 }, { authority: "PRINTED_DRAWING", source: "d", quantity: 11 }] }),
  ]);
  assert.ok(conflicted.confidence < small.confidence,
    "conflicted evidence lowers confidence even at an identical, tiny quantity");
  assert.equal(small.confidenceFactors.classifiedQuantityCoverage, 1);
  assert.equal(conflicted.confidenceFactors.conflictingQuantities, 1);
});

test("GOLDEN-6C 32.9  the module selects no ecosystem, manufacturer, panel model or loop count", async () => {
  const raw = await readFile(new URL("../app/domain/fire-alarm-preliminary-point-demand.mjs", import.meta.url), "utf8");
  // Comments explain what this stage deliberately does NOT do, so the assertion
  // runs against the executable code only.
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const forbidden of [
    /Farenhyt/i, /Gamewell/i, /Simplex/i, /Gent/i, /Honeywell/i, /Notifier/i,
    /UL\/FM/, /LPCB/, /EN ?54/, /loopsPerPanel|loopCapacity|exactLoops/i, /expansion/i, /spareCapacity/i,
  ]) {
    assert.doesNotMatch(source, forbidden, `preliminary sizing must not contain ${forbidden}`);
  }
  // The threshold is the internal policy constant, explicitly not a certified maximum.
  const result = aggregatePreliminaryPointDemand([
    rec({ sources: [{ authority: "BOQ", source: "s", quantity: 1500 }] }),
  ], { governingAuthority: "BOQ" });
  assert.equal(result.threshold, PRELIMINARY_POINT_THRESHOLD);
  assert.equal(result.thresholdIsCertifiedManufacturerMaximum, false);
  assert.equal(result.version, FIRE_ALARM_PRELIMINARY_POINT_DEMAND_VERSION);
});

test("GOLDEN-6C 32.10  deduplication is by governed identity, never by text similarity", () => {
  // Two records with near-identical descriptions but DIFFERENT governed
  // population identities are two populations.
  const a = rec({ populationId: "bldgA-smoke", scope: { project: "P1", building: "A" }, sources: [{ authority: "BOQ", source: "s", quantity: 100 }] });
  const b = rec({ populationId: "bldgB-smoke", scope: { project: "P1", building: "B" }, sources: [{ authority: "BOQ", source: "s", quantity: 100 }] });
  const result = aggregatePreliminaryPointDemand([a, b], { governingAuthority: "BOQ" });
  assert.equal(result.populations.length, 2);
  assert.equal(result.knownPointDemand, 200, "similar text does not merge distinct governed populations");
});

test("GOLDEN-6C 31.22  an unexamined project is UNCERTAIN, never 'a small system'", () => {
  // Regression: zero resolved demand used to report WITHIN_THRESHOLD_CONFIRMED,
  // which is indistinguishable from a genuinely small system and would let the
  // policy resolve an ecosystem for a project that was never sized.
  const empty = aggregatePreliminaryPointDemand([]);
  assert.equal(empty.knownPointDemand, 0);
  assert.equal(empty.thresholdStatus, "THRESHOLD_UNCERTAIN");
  assert.equal(empty.completeness, "INSUFFICIENT");
  assert.equal(empty.confidence, "NONE");
  assert.equal(preliminarySizingInput(empty).preliminaryTotalPoints, null);
  assert.equal(preliminarySizingInput(empty).usable, false);

  // Every population unresolved is the same condition by another route.
  const allUnknown = aggregatePreliminaryPointDemand([
    rec({ populationId: "u", deviceFamily: "Unclassified Specialty Device", addressability: null, sources: [{ authority: "BOQ", source: "s", quantity: 40 }] }),
  ], { governingAuthority: "BOQ" });
  assert.equal(allUnknown.thresholdStatus, "THRESHOLD_UNCERTAIN");
  assert.equal(allUnknown.preliminaryTotalPoints, null);
});
