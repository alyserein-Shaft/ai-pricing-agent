/**
 * GOLDEN-6C3 -- governed Fire Alarm device identity / family / addressability /
 * point-consumption evidence authority.
 *
 * This suite proves the evidence-resolution layer that feeds the canonical
 * point-classifier `classifyFireAlarmSlcItem` (GOLDEN-6C's units-per-device
 * contract), and through it the GOLDEN-6C preliminary point engine and the
 * GOLDEN-6C2 preliminary sizing snapshot.
 *
 * Coverage: section 37 acceptance (26 rows), section 38 mandatory negatives
 * (13 rows), all-branch resolver rules (alias / protocol / legend / schedule /
 * conflict / governing authority / evidence lifecycle), canonical-classifier
 * integration, GOLDEN-6C engine integration, and a GOLDEN-6C2 snapshot handoff
 * against a throwaway sqlite chain (journal order, temp directory only).
 *
 * Read-only with respect to every persistent artifact: no live database, no
 * schema, no migration, no snapshot outside the disposable temp chain.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  FIRE_ALARM_DEVICE_EVIDENCE_RESOLVER_VERSION,
  ADDRESSABILITY_VALUES,
  DEVICE_IDENTITY_STATES,
  FAMILY_STATES,
  ADDRESSABILITY_STATES,
  POINT_CONSUMPTION_STATES,
  POPULATION_STATES,
  DEVICE_EVIDENCE_FAILURE_CODES,
  deviceEvidenceFailure,
  isUsableEvidenceObservation,
  observationAppliesToPopulation,
  protocolMentionIsPopulationEvidence,
  resolveFireAlarmDeviceAuthority,
  classifyResolvedDeviceEvidence,
} from "../app/domain/fire-alarm-device-evidence-resolver.mjs";
import {
  buildDeviceInventoryRecord,
  aggregatePreliminaryPointDemand,
} from "../app/domain/fire-alarm-preliminary-point-demand.mjs";
import {
  PRELIMINARY_SIZING_SNAPSHOT_STATES,
  createFireAlarmPreliminarySizingSnapshot,
  currentPreliminarySizingSnapshot,
  preliminarySizingSnapshotInput,
  preliminarySizingFlowState,
} from "../app/domain/fire-alarm-preliminary-sizing-snapshot.mjs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ACTIVE_ROOT = join(ROOT, "drizzle-active");

/* ================================================================== *
 * Small builders
 * ================================================================== */

// A governed evidence observation with approval, current, and one claim.
const obs = (over = {}) => ({
  id: "ev-" + Math.random().toString(36).slice(2, 8),
  source: "approved-understanding",
  authority: "Understanding Review",
  reviewStatus: "Approved",
  claims: {},
  ...over,
});

const approve = (over = {}) => ({
  id: "ev-" + Math.random().toString(36).slice(2, 8),
  source: "approved-understanding",
  authority: "Understanding Review",
  reviewStatus: "Approved",
  claims: {
    deviceIdentity: "Smoke Detector",
    deviceFamily: "Addressable Smoke Detector",
    addressability: "ADDRESSABLE",
    ...over.claims,
  },
  ...Object.fromEntries(Object.entries(over).filter(([key]) => key !== "claims")),
});

const resolve = (over = {}) => resolveFireAlarmDeviceAuthority({
  populationId: "pop-1",
  system: "Fire Alarm",
  context: { drawing: "E-201" },
  evidence: [approve()],
  ...over,
});

const classify = (resolution, quantity = 100) => classifyResolvedDeviceEvidence({ resolution, quantity });

/* ================================================================== *
 * Section 37 -- acceptance scenarios (26 rows)
 * ================================================================== */

test("37.01 legend applicability: a legend scoped to the population drawing governs", () => {
  const r = resolve({
    evidence: [{
      id: "ev-legend-applicable", source: "drawing-legend", sourceLocation: "E-201 legend", authority: "Legend",
      reviewStatus: "Approved", scope: { drawing: "E-201" },
      claims: { deviceIdentity: "Smoke Detector", deviceFamily: "Addressable Smoke Detector", addressability: "ADDRESSABLE" },
    }],
  });
  assert.equal(r.resolution.family.state, "GOVERNED_FAMILY_RESOLVED");
  assert.equal(r.resolution.family.value, "Addressable Smoke Detector");
  assert.equal(r.resolution.addressability.value, "ADDRESSABLE");
  assert.equal(r.resolution.identity.value, "Smoke Detector");
  assert.equal(r.excluded.length, 0);
});

test("37.02 unrelated-sheet legend must NOT apply (cross-sheet leakage is prevented)", () => {
  const r = resolve({
    context: { drawing: "E-202" },
    evidence: [{
      id: "ev-legend-wrong-sheet", source: "drawing-legend", sourceLocation: "E-201 legend", authority: "Legend",
      reviewStatus: "Approved", scope: { drawing: "E-201" },
      claims: { deviceFamily: "Addressable Smoke Detector", addressability: "ADDRESSABLE" },
    }],
  });
  assert.equal(r.resolution.family.state, "FAMILY_UNKNOWN");
  assert.equal(r.excluded[0].id, "ev-legend-wrong-sheet");
  assert.match(r.excluded[0].reason, /does not cover this population/i);
});

test("37.03 protocol global-vs-attached: attached protocol evidence is usable", () => {
  const r = resolve({
    evidence: [{
      id: "ev-protocol-attached", source: "specification-clause", sourceLocation: "Spec 28.31", authority: "Specification",
      reviewStatus: "Approved", applicableTo: "pop-1",
      claims: { deviceFamily: "Addressable Smoke Detector", addressability: "ADDRESSABLE", protocol: "FlashScan" },
    }],
  });
  assert.equal(r.excluded.length, 0);
  assert.equal(r.resolution.family.value, "Addressable Smoke Detector");
});

test("37.04 protocol global-vs-attached: unattached protocol mention never becomes population addressability", () => {
  const r = resolve({
    evidence: [{
      id: "ev-protocol-global", source: "specification-clause", sourceLocation: "Spec 28.31", authority: "Specification",
      reviewStatus: "Approved",
      claims: { deviceFamily: "Smoke Detector", protocol: "FlashScan" },
    }],
  });
  assert.deepEqual(r.excluded.map((e) => e.id), ["ev-protocol-global"]);
  assert.match(r.excluded[0].reason, /Protocol context without an explicit population attachment/i);
  assert.equal(r.resolution.addressability.state, "ADDRESSABILITY_UNKNOWN");
});

test("37.05 superseded evidence is ignored even when approved", () => {
  const r = resolve({
    evidence: [{
      id: "ev-old", source: "approved-understanding", authority: "Understanding Review",
      reviewStatus: "Approved", supersededAt: "2026-09-01T00:00:00.000Z",
      claims: { deviceFamily: "Addressable Smoke Detector", addressability: "ADDRESSABLE" },
    }],
  });
  assert.equal(r.resolution.family.state, "FAMILY_UNKNOWN");
  assert.equal(r.excluded[0].id, "ev-old");
});

test("37.06 needs-review evidence does not govern current resolution", () => {
  const r = resolve({
    evidence: [{
      id: "ev-needs-review", source: "drawing-legend", authority: "Legend", reviewStatus: "Needs Review",
      claims: { deviceFamily: "Addressable Smoke Detector", addressability: "ADDRESSABLE" },
    }],
  });
  assert.equal(r.resolution.family.state, "FAMILY_UNKNOWN");
  assert.equal(r.excluded[0].id, "ev-needs-review");
});

test("37.07 rejected evidence does not govern current resolution", () => {
  const r = resolve({
    evidence: [
      { ...obs(), id: "ev-rejected", rejected: true, claims: { deviceFamily: "Addressable Smoke Detector", addressability: "ADDRESSABLE" } },
    ],
  });
  assert.equal(r.resolution.family.state, "FAMILY_UNKNOWN");
  assert.equal(r.excluded[0].id, "ev-rejected");
});

test("37.08 identity is not copied between populations sharing a description", () => {
  // Population A has governed identity; population B's evidence carries no
  // identity claim. The similar description in B's BOQ row is not evidence.
  const a = resolve({ populationId: "pop-a", evidence: [approve({ claims: { deviceIdentity: "Smoke Detector", deviceFamily: "Addressable Smoke Detector" } })] });
  const b = resolve({
    populationId: "pop-b",
    evidence: [{ ...obs(), id: "ev-b", claims: { deviceFamily: "Addressable Smoke Detector" } }],
  });
  assert.equal(a.resolution.identity.value, "Smoke Detector");
  assert.equal(b.resolution.identity.state, "IDENTITY_UNKNOWN");
  assert.equal(b.resolution.identity.value, null);
});

test("37.09 alias normalization requires governed equivalence evidence", () => {
  const r = resolve({
    evidence: [{
      id: "ev-alias-governed", source: "drawing-legend", authority: "Legend", reviewStatus: "Approved", aliasEvidence: true,
      claims: { deviceFamily: "Smoke Detector", aliasEquivalence: "Addressable Smoke Detector", addressability: "ADDRESSABLE" },
    }],
  });
  assert.equal(r.resolution.family.value, "Addressable Smoke Detector");
  assert.equal(r.resolution.family.state, "GOVERNED_FAMILY_RESOLVED");
});

test("37.10 alias equivalence without governing evidence is inert", () => {
  const r = resolve({
    evidence: [{
      id: "ev-alias-non-governed", source: "drawing-legend", authority: "Legend", reviewStatus: "Approved",
      claims: { deviceFamily: "Smoke Detector", aliasEquivalence: "Addressable Smoke Detector", addressability: "ADDRESSABLE" },
    }],
  });
  assert.equal(r.resolution.family.value, "Smoke Detector");
});

test("37.11 fuzzy similarity never merges families", () => {
  const r = resolve({
    evidence: [
      { ...obs(), id: "ev-f1", claims: { deviceFamily: "Smoke Detector" } },
      { ...obs(), id: "ev-f2", claims: { deviceFamily: "Smoke Detector Base" } },
    ],
  });
  assert.equal(r.populationState, "CONFLICTING_EVIDENCE");
  assert.deepEqual(r.conflicts[0].values, ["Smoke Detector", "Smoke Detector Base"]);
});

test("37.12 meaningful family differences are preserved verbatim", () => {
  const conventional = resolve({
    populationId: "pop-conv",
    evidence: [{ ...obs(), id: "ev-conv", claims: { deviceFamily: "Conventional Detector", negative: "CONVENTIONAL" } }],
  });
  const addressable = resolve({
    populationId: "pop-addr",
    evidence: [{ ...obs(), id: "ev-addr", claims: { deviceFamily: "Addressable Smoke Detector", addressability: "ADDRESSABLE" } }],
  });
  assert.equal(conventional.resolution.family.value, "Conventional Detector");
  assert.equal(addressable.resolution.family.value, "Addressable Smoke Detector");
  // The conventional population carries its negative: stays non-point.
  assert.equal(conventional.populationState, "NON_POINT_CONFIRMED");
});

test("37.13 an approved understanding family claim is authoritative", () => {
  const r = resolve({
    evidence: [{
      id: "ev-understanding", source: "approved-understanding", authority: "Understanding Review", reviewStatus: "Approved",
      claims: { deviceFamily: "Addressable Heat Detector" },
    }],
  });
  assert.equal(r.resolution.family.value, "Addressable Heat Detector");
  assert.deepEqual(r.resolution.family.authorities, [{ id: "ev-understanding", source: "approved-understanding", sourceLocation: null, authority: "Understanding Review" }]);
});

test("37.14 approved attribute addressing resolves addressability independently", () => {
  const r = resolve({
    evidence: [{ ...obs(), id: "ev-attr", claims: { addressability: "ADDRESSABLE" } }],
  });
  assert.equal(r.resolution.addressability.state, "GOVERNED_ADDRESSABILITY_RESOLVED");
  assert.equal(r.resolution.addressability.value, "ADDRESSABLE");
  // Family stays independent and unknown.
  assert.equal(r.resolution.family.state, "FAMILY_UNKNOWN");
  assert.equal(r.populationState, "GOVERNED_ADDRESSABILITY_RESOLVED");
});

test("37.15 absence of addressable is never conventional", () => {
  const r = resolve({
    evidence: [{ ...obs(), id: "ev-no-addr", claims: { deviceFamily: "Addressable Smoke Detector" } }],
  });
  assert.equal(r.resolution.addressability.state, "ADDRESSABILITY_UNKNOWN");
  assert.equal(r.resolution.addressability.value, null);
});

test("37.16 conventional negative evidence resolves conclusively", () => {
  const r = resolve({
    evidence: [{ ...obs(), id: "ev-neg-conv", claims: { deviceFamily: "Conventional Detector", negative: "CONVENTIONAL" } }],
  });
  assert.equal(r.resolution.addressability.value, "CONVENTIONAL");
  assert.equal(r.populationState, "NON_POINT_CONFIRMED");
  const c = classify(r, 40);
  assert.equal(c.canonicalState, "NOT_SLC");
  assert.equal(c.demandUnits, 0);
});

test("37.17 NAC notification appliance with governed negative evidence is a non-loop device", () => {
  const r = resolve({
    evidence: [{ ...obs(), id: "ev-nac", claims: { deviceIdentity: "Horn", deviceFamily: "Horn", negative: "NAC" } }],
  });
  assert.equal(r.resolution.addressability.value, "NON_LOOP");
  assert.equal(r.populationState, "NON_POINT_CONFIRMED");
  const c = classify(r, 60);
  // The canonical classifier cannot represent the Horn family at all, so even
  // with governed NAC evidence the SLC contribution stays unknown -- the
  // recognised notification-appliance resolution gap, never a forced zero.
  assert.equal(c.canonicalState, "UNRESOLVED");
  assert.match(c.reason, /cannot safely represent/i);
  assert.equal(c.demandUnits, null);
});

test("37.18 notification appliance without any governed evidence stays unresolved", () => {
  const r = resolve({
    evidence: [{ ...obs(), id: "ev-notif", claims: { deviceFamily: "Horn" } }],
  });
  assert.equal(r.resolution.family.value, "Horn");
  assert.equal(r.resolution.addressability.state, "ADDRESSABILITY_UNKNOWN");
  assert.equal(r.resolution.pointConsumption.state, "POINT_CONSUMPTION_UNKNOWN");
  const c = classify(r, 60);
  assert.equal(c.canonicalState, "UNRESOLVED");
  assert.equal(c.demandUnits, null);
});

test("37.19 multi-address module evidence leaves address count unresolved", () => {
  const r = resolve({
    evidence: [{ ...obs(), id: "ev-module-multi", claims: { deviceFamily: "Monitor Module", addressability: "ADDRESSABLE", pointConsumption: "MULTI" } }],
  });
  assert.equal(r.resolution.pointConsumption.state, "MULTI_ADDRESS_UNRESOLVED");
  assert.equal(r.populationState, "REQUIRES_ENGINEERING_REVIEW");
  const c = classify(r, 10);
  assert.equal(c.canonicalState, "UNRESOLVED");
  assert.match(c.reason, /Multi-address or multi-channel/i);
});

test("37.20 control equipment family stays a governed non-field-point family", () => {
  const r = resolve({
    evidence: [{ ...obs(), id: "ev-facp", claims: { deviceFamily: "Fire Alarm Control Panel" } }],
  });
  assert.equal(r.resolution.family.value, "Fire Alarm Control Panel");
  assert.equal(r.populationState, "GOVERNED_FAMILY_RESOLVED");
  const c = classify(r, 1);
  assert.equal(c.canonicalState, "NOT_SLC");
  assert.equal(c.demandUnits, 0);
});

test("37.21 accessory family stays a governed non-point accessory family", () => {
  const r = resolve({
    evidence: [{ ...obs(), id: "ev-base", claims: { deviceFamily: "Detector Base" } }],
  });
  assert.equal(r.resolution.family.value, "Detector Base");
  const c = classify(r, 100);
  assert.equal(c.canonicalState, "NOT_SLC");
  assert.equal(c.demandUnits, 0);
});

test("37.22 conflicting approved evidence is a population-wide conflict, never a winner", () => {
  const r = resolve({
    evidence: [
      { ...obs(), id: "ev-c1", claims: { deviceFamily: "Addressable Smoke Detector", addressability: "ADDRESSABLE" } },
      { ...obs(), id: "ev-c2", claims: { deviceFamily: "Smoke Detector", addressability: "ADDRESSABLE" } },
    ],
  });
  assert.equal(r.populationState, "CONFLICTING_EVIDENCE");
  assert.deepEqual(r.conflicts.map((c) => c.dimension), ["family"]);
  assert.deepEqual(r.resolution.family.conflicting.sort(), ["Addressable Smoke Detector", "Smoke Detector"].sort());
  assert.equal(r.resolution.family.value, null);
});

test("37.23 governing authority resolves a disagreement the authority model owns", () => {
  const r = resolve({
    governingAuthority: "Legend",
    evidence: [
      { ...obs(), id: "ev-g1", authority: "Legend", claims: { deviceFamily: "Addressable Smoke Detector", addressability: "ADDRESSABLE" } },
      { ...obs(), id: "ev-g2", authority: "Understanding Review", claims: { deviceFamily: "Smoke Detector", addressability: "ADDRESSABLE" } },
    ],
  });
  assert.equal(r.resolution.family.value, "Addressable Smoke Detector");
  assert.equal(r.populationState, "GOVERNED_POINT_CONSUMPTION_RESOLVED");
});

test("37.24 two governing authorities that disagree are still a conflict", () => {
  const r = resolve({
    governingAuthority: "Legend",
    evidence: [
      { ...obs(), id: "ev-g3", authority: "Legend", claims: { deviceFamily: "Addressable Smoke Detector" } },
      { ...obs(), id: "ev-g4", authority: "Legend", claims: { deviceFamily: "Smoke Detector" } },
    ],
  });
  assert.equal(r.populationState, "CONFLICTING_EVIDENCE");
  assert.equal(r.resolution.family.value, null);
});

test("37.25 schedule linked to the population governs; unlinked schedule does not", () => {
  const linked = resolve({
    evidence: [{
      id: "ev-sched-linked", source: "schedule", authority: "Equipment Schedule", reviewStatus: "Approved",
      applicableTo: "pop-1",
      claims: { deviceIdentity: "Smoke Detector", deviceFamily: "Addressable Smoke Detector", addressability: "ADDRESSABLE" },
    }],
  });
  assert.equal(linked.resolution.family.value, "Addressable Smoke Detector");

  const unlinked = resolve({
    populationId: "pop-2",
    evidence: [{
      id: "ev-sched-unlinked", source: "schedule", authority: "Equipment Schedule", reviewStatus: "Approved",
      applicableTo: "pop-1",
      claims: { deviceFamily: "Addressable Smoke Detector", addressability: "ADDRESSABLE" },
    }],
  });
  assert.equal(unlinked.resolution.family.state, "FAMILY_UNKNOWN");
  assert.equal(unlinked.excluded[0].id, "ev-sched-unlinked");
});

test("37.26 resolved output is a pure non-quantity evidence contract and hands off to the canonical classifier", () => {
  const r = resolve();
  assert.equal(r.version, FIRE_ALARM_DEVICE_EVIDENCE_RESOLVER_VERSION);
  assert.deepEqual(Object.keys(r.candidates).sort(), ["attributes", "family", "system"]);
  const c = classify(r, 88);
  assert.equal(c.canonicalState, "SLC_DETECTOR_POOL");
  assert.equal(c.demandUnits, 88);
  // Version pin moved 2026-10-03 (2nd time): the classifier gained the governed
  // DIRECT-SLC vs SECONDARY-INTERFACE axes, which is an executable policy
  // change and therefore requires a version bump. The pool/demand contract
  // asserted above is unchanged.
  //
  // Version pin moved again 2026-10-03 for 1.3.0: a SECOND, INDEPENDENT
  // addressability channel was added -- the approved manufacturer
  // `slc_address_model` fact. It can settle whether an address is consumed and
  // how many, and it can settle a proven zero; it can never choose a pool.
  // No state name was added or removed, so the closed vocabulary asserted
  // elsewhere in this file is unchanged.
  assert.equal(c.classifierVersion, "fire-alarm-slc-resource-classifier-1.3.0");
});

/* ================================================================== *
 * Section 38 -- mandatory negatives (13 rows)
 * ================================================================== */

test("38.01 Fire Alarm membership never implies addressable", () => {
  const r = resolve({ evidence: [{ ...obs(), id: "ev-sys", claims: { deviceIdentity: "Smoke Detector" } }] });
  assert.equal(r.resolution.addressability.state, "ADDRESSABILITY_UNKNOWN");
  assert.equal(r.resolution.addressability.value, null);
});

test("38.02 a known detector name never implies one point", () => {
  const r = resolve({ evidence: [{ ...obs(), id: "ev-det", claims: { deviceFamily: "Addressable Smoke Detector" } }] });
  assert.equal(r.resolution.pointConsumption.state, "POINT_CONSUMPTION_UNKNOWN");
  const c = classify(r, 90);
  assert.equal(c.canonicalState, "UNRESOLVED");
  assert.match(c.reason, /requires governed addressable evidence/i);
  assert.equal(c.demandUnits, null);
});

test("38.03 a module family never implies one point without addressability", () => {
  const r = resolve({ evidence: [{ ...obs(), id: "ev-mod", claims: { deviceFamily: "Monitor Module" } }] });
  const c = classify(r, 5);
  assert.equal(c.canonicalState, "UNRESOLVED");
  assert.equal(c.demandUnits, null);
  assert.equal(r.resolution.pointConsumption.state, "POINT_CONSUMPTION_UNKNOWN");
});

test("38.04 notification appliances never become SLC points without evidence", () => {
  const r = resolve({ evidence: [{ ...obs(), id: "ev-horn", claims: { deviceFamily: "Horn", addressability: "ADDRESSABLE" } }] });
  const c = classify(r, 60);
  assert.equal(c.canonicalState, "UNRESOLVED");
  assert.match(c.reason, /cannot safely represent/i);
  assert.equal(c.demandUnits, null);
});

test("38.05 an unknown family never becomes a best-guess family", () => {
  const r = resolve({ evidence: [{ ...obs(), id: "ev-unk", claims: { addressability: "ADDRESSABLE" } }] });
  assert.equal(r.resolution.family.state, "FAMILY_UNKNOWN");
  assert.equal(r.resolution.family.value, null);
  assert.equal(r.candidates.family, null);
});

test("38.06 the same description never copies another population's identity", () => {
  const r1 = resolve({ populationId: "pop-x", evidence: [approve({ claims: { deviceIdentity: "Smoke Detector", deviceFamily: "Addressable Smoke Detector" } })] });
  const r2 = resolve({
    populationId: "pop-y",
    evidence: [{ ...obs(), id: "ev-y", claims: { deviceFamily: "Addressable Smoke Detector" } }],
  });
  assert.equal(r1.resolution.identity.value, "Smoke Detector");
  assert.equal(r2.resolution.identity.value, null);
  assert.equal(r2.resolution.identity.state, "IDENTITY_UNKNOWN");
});

test("38.07 FlashScan/CLIP mention never makes every device addressable", () => {
  const r = resolve({
    evidence: [
      { ...obs(), id: "ev-flash", claims: { deviceFamily: "Smoke Detector", protocol: "FlashScan CLIP" } },
      { ...obs(), id: "ev-addr-proto", applicableTo: "pop-1", claims: { deviceFamily: "Smoke Detector", protocol: "FlashScan" } },
    ],
  });
  // Unattached protocol mention is excluded.
  assert.equal(r.excluded.length, 1);
  // Attached protocol mention is usable but never fabricates ADDRESSABLE.
  assert.equal(r.resolution.addressability.state, "ADDRESSABILITY_UNKNOWN");
});

test("38.08 a manufacturer reference never becomes a project property", () => {
  const r = resolve({ evidence: [{ ...obs(), id: "ev-mfr", claims: { deviceFamily: "Addressable Smoke Detector", addressability: "ADDRESSABLE" } }] });
  const serialized = JSON.stringify(r);
  // The resolver output has no manufacturer, model, panel, or part-number
  // vocabulary at all -- nothing can be claimed from a manufacturer reference.
  assert.ok(!/manufacturer|part[_ -]?number|panel[_ -]?model|model_name/i.test(serialized));
});

test("38.09 superseded evidence never governs", () => {
  const r = resolve({
    evidence: [{ ...obs(), id: "ev-sup", supersededAt: "2026-09-01T00:00:00.000Z", claims: { deviceFamily: "Addressable Smoke Detector", addressability: "ADDRESSABLE" } }],
  });
  assert.equal(r.resolution.family.state, "FAMILY_UNKNOWN");
  assert.equal(r.populationState, "INSUFFICIENT_EVIDENCE");
  assert.equal(r.usableObservationCount, 0);
});

test("38.10 unknown addressability never becomes conventional", () => {
  const r = resolve({ evidence: [{ ...obs(), id: "ev-a10", claims: { deviceFamily: "Addressable Smoke Detector" } }] });
  assert.equal(r.resolution.addressability.value, null);
  assert.notEqual(r.resolution.addressability.value, "CONVENTIONAL");
  const c = classify(r, 20);
  assert.match(c.reason, /requires governed addressable evidence/i);
});

test("38.11 unknown point consumption never becomes zero", () => {
  const r = resolve({ evidence: [{ ...obs(), id: "ev-a11", claims: { deviceFamily: "Horn" } }] });
  assert.notEqual(r.resolution.pointConsumption.state, "NON_POINT_CONFIRMED");
  const c = classify(r, 30);
  assert.equal(c.demandUnits, null);
  // The GOLDEN-6C engine must carry it as UNKNOWN demand, not excluded 0.
  const demand = aggregatePreliminaryPointDemand([
    buildDeviceInventoryRecord({
      populationId: "pop-1", deviceFamily: "Horn", system: "Fire Alarm",
      addressability: null, scope: { project: "P1" }, governingSource: "BOQ",
      sources: [{ authority: "BOQ", source: "BOQ-1", quantity: 30, confidence: 90 }],
    }),
  ]);
  assert.equal(demand.knownPointDemand, 0);
  assert.equal(demand.unknownPointDemand, 30);
});

test("38.12 point evidence never names an ecosystem", () => {
  const r = resolve();
  assert.ok(!/farenhyt|gent|gamewell|simplex|ecosystem/i.test(JSON.stringify(r)));
});

test("38.13 point evidence never names an exact panel", () => {
  const r = resolve();
  assert.ok(!/panel[_ -]?model|exact[_ -]?product|approved[_ -]?product|model[_ -]?number/i.test(JSON.stringify(r)));
});

/* ================================================================== *
 * All-branch resolver rules
 * ================================================================== */

test("branch: observation eligibility gate", () => {
  assert.equal(isUsableEvidenceObservation(null), false);
  assert.equal(isUsableEvidenceObservation({}), false);
  assert.ok(isUsableEvidenceObservation(obs({ claims: { deviceFamily: "X" } })));
  assert.equal(isUsableEvidenceObservation(obs({ reviewStatus: "Needs Review", claims: { deviceFamily: "X" } })), false);
  assert.equal(isUsableEvidenceObservation(obs({ rejected: true, claims: { deviceFamily: "X" } })), false);
  assert.equal(isUsableEvidenceObservation(obs({ supersededAt: "2026-09-01", claims: { deviceFamily: "X" } })), false);
  // An observation with only an empty string claim is not usable.
  assert.equal(isUsableEvidenceObservation(obs({ claims: { deviceFamily: "  " } })), false);
});

test("branch: scope applicability guards", () => {
  assert.equal(observationAppliesToPopulation(obs({ applicableTo: "pop-1" }), "pop-1"), true);
  assert.equal(observationAppliesToPopulation(obs({ applicableTo: "pop-1" }), "pop-2"), false);
  assert.equal(observationAppliesToPopulation(obs({ scope: { drawing: "E-201" } }), "pop-1", { drawing: "E-201" }), true);
  assert.equal(observationAppliesToPopulation(obs({ scope: { drawing: "E-201" } }), "pop-1", { drawing: "E-202" }), false);
  // When the population has no drawing context, a drawing-scoped claim cannot
  // be proven applicable and is refused (no leak).
  assert.equal(observationAppliesToPopulation(obs({ scope: { drawing: "E-201" } }), "pop-1", {}), false);
  assert.equal(observationAppliesToPopulation(obs({}), "pop-1"), true);
});

test("branch: protocol attachment detection", () => {
  assert.equal(protocolMentionIsPopulationEvidence(obs({ applicableTo: "pop-1" }), "pop-1"), true);
  assert.equal(protocolMentionIsPopulationEvidence(obs({ scope: { population: "pop-1" } }), "pop-1"), true);
  assert.equal(protocolMentionIsPopulationEvidence(obs({ scope: { population: "pop-2" } }), "pop-1"), false);
  assert.equal(protocolMentionIsPopulationEvidence(obs({}), "pop-1"), false);
});

test("branch: pinned failure codes", () => {
  assert.throws(() => resolveFireAlarmDeviceAuthority({}), (e) => e.code === "DEVICE_EVIDENCE_POPULATION_REQUIRED");
  assert.throws(() => resolveFireAlarmDeviceAuthority({ populationId: "p" }), (e) => e.code === "DEVICE_EVIDENCE_OBSERVATION_REQUIRED");
  assert.throws(() => resolveFireAlarmDeviceAuthority({ populationId: "p", evidence: [] }), (e) => e.code === "DEVICE_EVIDENCE_OBSERVATION_REQUIRED");
  assert.throws(() => resolveFireAlarmDeviceAuthority({ populationId: "p", evidence: [{ claims: { deviceFamily: "X" } }] }), (e) => e.code === "DEVICE_EVIDENCE_ID_REQUIRED");
  assert.throws(() => resolveFireAlarmDeviceAuthority({ populationId: "p", evidence: [{ id: "e1", claims: {} }] }), (e) => e.code === "DEVICE_EVIDENCE_CLAIM_REQUIRED");
  const err = deviceEvidenceFailure("DEVICE_EVIDENCE_CLAIM_REQUIRED", "x", 422);
  assert.equal(err.name, "deviceEvidenceFailure");
  assert.equal(err.status, 422);
  assert.ok(DEVICE_EVIDENCE_FAILURE_CODES.includes("DEVICE_EVIDENCE_CLAIM_REQUIRED"));
});

test("branch: explicit + negative addressability that agree resolve by consensus", () => {
  const r = resolve({
    evidence: [
      { ...obs(), id: "ev-e1", claims: { deviceFamily: "Conventional Detector", addressability: "CONVENTIONAL" } },
      { ...obs(), id: "ev-e2", claims: { negative: "CONVENTIONAL" } },
    ],
  });
  assert.equal(r.populationState, "NON_POINT_CONFIRMED");
  assert.equal(r.resolution.addressability.value, "CONVENTIONAL");
});

test("branch: explicit + negative addressability that disagree are a conflict", () => {
  const r = resolve({
    evidence: [
      { ...obs(), id: "ev-x1", claims: { deviceFamily: "Addressable Smoke Detector", addressability: "ADDRESSABLE" } },
      { ...obs(), id: "ev-x2", claims: { negative: "CONVENTIONAL" } },
    ],
  });
  assert.equal(r.populationState, "CONFLICTING_EVIDENCE");
  assert.deepEqual(r.conflicts.map((c) => c.dimension), ["addressability"]);
});

test("branch: NON_POINT negative confirms non-point without forcing addressability", () => {
  const r = resolve({
    evidence: [{ ...obs(), id: "ev-np", claims: { deviceFamily: "Detector Base", negative: "ACCESSORY" } }],
  });
  assert.equal(r.populationState, "NON_POINT_CONFIRMED");
  assert.equal(r.resolution.addressability.state, "ADDRESSABILITY_UNKNOWN");
});

test("branch: multi-address claim spellings are all detected", () => {
  for (const spelling of ["MULTI", "MULTI_ADDRESS", "multi-point"]) {
    const r = resolve({
      evidence: [{ ...obs(), id: `ev-ma-${spelling}`, claims: { deviceFamily: "Monitor Module", addressability: "ADDRESSABLE", pointConsumption: spelling } }],
    });
    assert.equal(r.resolution.pointConsumption.state, "MULTI_ADDRESS_UNRESOLVED", spelling);
    assert.equal(r.populationState, "REQUIRES_ENGINEERING_REVIEW", spelling);
  }
});

test("branch: a governed but classifier-unrepresentable family stays unknown-demand", () => {
  const r = resolve({ evidence: [{ ...obs(), id: "ev-unspec", claims: { deviceFamily: "Unclassified Specialty Device" } }] });
  assert.equal(r.resolution.family.state, "GOVERNED_FAMILY_RESOLVED");
  const c = classify(r, 75);
  assert.equal(c.canonicalState, "UNRESOLVED");
  assert.equal(c.demandUnits, null);
  assert.match(c.reason, /cannot safely represent|No governed SLC resource mapping/i);
});

test("branch: consensus identity from multiple approved sources", () => {
  const r = resolve({
    evidence: [
      { ...obs(), id: "ev-i1", claims: { deviceIdentity: "Smoke Detector" } },
      { ...obs(), id: "ev-i2", claims: { deviceIdentity: "Smoke Detector" } },
    ],
  });
  assert.equal(r.resolution.identity.value, "Smoke Detector");
  assert.equal(r.conflicts.length, 0);
});

test("branch: review questions are generated per missing material property", () => {
  const familyOnly = resolve({ evidence: [{ ...obs(), id: "ev-rq1", claims: { deviceIdentity: "Smoke Detector", deviceFamily: "Smoke Detector" } }] });
  assert.deepEqual(familyOnly.reviewQuestions.map((q) => q.state), ["ADDRESSABILITY_REQUIRED"]);

  const identityOnly = resolve({ evidence: [{ ...obs(), id: "ev-rq2", claims: { deviceIdentity: "Smoke Detector" } }] });
  assert.deepEqual(identityOnly.reviewQuestions.map((q) => q.state), ["FAMILY_REQUIRED"]);

  // A module with governed addressability but a MULTI address-count claim is a
  // genuine POINT_CONSUMPTION_REQUIRED question: the count is unknown.
  const multiModule = resolve({
    evidence: [{ ...obs(), id: "ev-rq3", claims: { deviceFamily: "Monitor Module", addressability: "ADDRESSABLE", pointConsumption: "MULTI" } }],
  });
  assert.ok(multiModule.reviewQuestions.some((q) => q.state === "POINT_CONSUMPTION_REQUIRED"));

  // A module with governed addressability and no multi-address evidence has the
  // canonical address-count contract answered by the classifier itself -- the
  // resolver asks nothing more.
  const plainModule = resolve({
    evidence: [{ ...obs(), id: "ev-rq3b", claims: { deviceFamily: "Monitor Module", addressability: "ADDRESSABLE" } }],
  });
  assert.ok(!plainModule.reviewQuestions.some((q) => q.state === "POINT_CONSUMPTION_REQUIRED"));
});

test("branch: equipment families do not generate addressability review questions", () => {
  const r = resolve({ evidence: [{ ...obs(), id: "ev-rq4", claims: { deviceFamily: "Fire Alarm Control Panel" } }] });
  assert.ok(!r.reviewQuestions.some((q) => q.state === "ADDRESSABILITY_REQUIRED"));
});

/* ================================================================== *
 * Canonical-classifier integration
 * ================================================================== */

test("integration: resolved detector -> SLC_DETECTOR_POOL with one point per device", () => {
  const r = resolve();
  const c = classify(r, 120);
  assert.equal(c.canonicalState, "SLC_DETECTOR_POOL");
  assert.equal(c.unitsPerDevice, 1);
  assert.equal(c.demandUnits, 120);
});

test("integration: resolved module -> SLC_MODULE_POOL with one point per device", () => {
  const r = resolve({
    evidence: [{ ...obs(), id: "ev-mod-ok", claims: { deviceFamily: "Monitor Module", addressability: "ADDRESSABLE" } }],
  });
  const c = classify(r, 40);
  assert.equal(c.canonicalState, "SLC_MODULE_POOL");
  assert.equal(c.unitsPerDevice, 1);
  assert.equal(c.demandUnits, 40);
});

test("integration: addressable heat and multi-criteria detectors classify as detector pool", () => {
  for (const family of ["Addressable Heat Detector", "Multi-Criteria Detector"]) {
    const r = resolve({ evidence: [{ ...obs(), id: `ev-${family}`, claims: { deviceFamily: family, addressability: "ADDRESSABLE" } }] });
    const c = classify(r, 25);
    assert.equal(c.canonicalState, "SLC_DETECTOR_POOL", family);
    assert.equal(c.demandUnits, 25, family);
  }
});

test("integration: quantity never comes from the resolver", () => {
  const r = resolve();
  assert.ok(!("quantity" in r));
  assert.ok(!("unitsPerDevice" in r));
  // Null quantity classifies the state but yields no demand.
  const c = classifyResolvedDeviceEvidence({ resolution: r });
  assert.equal(c.canonicalState, "SLC_DETECTOR_POOL");
  assert.equal(c.demandUnits, null);
});

/* ================================================================== *
 * GOLDEN-6C engine integration
 * ================================================================== */

test("6C engine: resolver candidates drive the known point demand", () => {
  const resolved = resolve();
  const unresolved = resolve({
    populationId: "pop-2",
    evidence: [{ ...obs(), id: "ev-6c-u", claims: { deviceFamily: "Horn" } }],
  });

  const records = [
    buildDeviceInventoryRecord({
      populationId: "pop-1", deviceFamily: resolved.candidates.family, system: "Fire Alarm",
      addressability: resolved.candidates.attributes.addressing,
      scope: { project: "P1", building: "A", fireAlarmSystem: "FA-1" },
      governingSource: "BOQ",
      sources: [{ authority: "BOQ", source: "BOQ-1", quantity: 100, confidence: 90 }],
    }),
    buildDeviceInventoryRecord({
      populationId: "pop-2", deviceFamily: unresolved.candidates.family, system: "Fire Alarm",
      addressability: null,
      scope: { project: "P1", building: "A", fireAlarmSystem: "FA-1" },
      governingSource: "BOQ",
      sources: [{ authority: "BOQ", source: "BOQ-2", quantity: 60, confidence: 90 }],
    }),
  ];
  const demand = aggregatePreliminaryPointDemand(records);
  assert.equal(demand.knownPointDemand, 100);
  assert.equal(demand.unknownPointDemand, 60);
  // The governed engine outcome: 100 known + 60 unknown, both below the 2000
  // threshold and the known total nonzero -> WITHIN_THRESHOLD_CONFIRMED, and the
  // policy number is the known total only.
  assert.deepEqual(demand.thresholdStatus, "WITHIN_THRESHOLD_CONFIRMED");
  assert.equal(demand.preliminaryTotalPoints, 100);
});

test("6C engine: resolver without addressability authority cannot invent demand", () => {
  const r = resolve({ evidence: [{ ...obs(), id: "ev-6c-noaddr", claims: { deviceFamily: "Addressable Smoke Detector" } }] });
  const demand = aggregatePreliminaryPointDemand([
    buildDeviceInventoryRecord({
      populationId: "pop-1", deviceFamily: r.candidates.family, system: "Fire Alarm",
      addressability: null,
      scope: { project: "P1" }, governingSource: "BOQ",
      sources: [{ authority: "BOQ", source: "BOQ-1", quantity: 200, confidence: 90 }],
    }),
  ]);
  assert.equal(demand.knownPointDemand, 0);
  assert.equal(demand.unknownPointDemand, 200);
  // Correctness stays THRESHOLD_UNCERTAIN for a materially unresolved project.
  assert.equal(demand.thresholdStatus, "THRESHOLD_UNCERTAIN");
});

/* ================================================================== *
 * GOLDEN-6C2 preliminary sizing snapshot handoff (disposable chain)
 * ================================================================== */

const ACTIVE_TAGS = () => JSON.parse(readFileSync(join(ACTIVE_ROOT, "meta", "_journal.json"), "utf8")).entries.map((entry) => entry.tag);

const statementsOf = (sql) => sql
  .split("--> statement-breakpoint")
  .map((statement) => statement.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim())
  .filter(Boolean);

const openAppliedChain = () => {
  const dir = mkdtempSync(join(tmpdir(), "golden-6c3-"));
  const db = new DatabaseSync(join(dir, "chain.sqlite"));
  db.exec("PRAGMA foreign_keys=ON");
  return { db, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
};

const applyTag = (db, tag) => {
  const file = join(ACTIVE_ROOT, `${tag}.sql`);
  assert.ok(existsSync(file), `active migration ${tag} must exist`);
  db.exec("BEGIN");
  try {
    for (const statement of statementsOf(readFileSync(file, "utf8"))) db.exec(statement);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw new Error(`active migration ${tag} failed to apply: ${error.message}`);
  }
};

const applyActiveChain = (db) => { for (const tag of ACTIVE_TAGS()) applyTag(db, tag); };

test("6C2 handoff: resolver-resolved demand writes a usable preliminary snapshot on a disposable chain", async () => {
  const { db, cleanup } = openAppliedChain();
  try {
    applyActiveChain(db);
    db.exec(`
      INSERT INTO projects (id, name, owner_user_id, organization_id, system_domain, initial_status, created_at, updated_at)
      VALUES ('p1', 'Golden 6C3 Disposable', 'u1', NULL, 'Fire Alarm', 'Draft', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);

    const r1 = resolve();
    const r2 = resolve({
      populationId: "pop-2",
      evidence: [{ ...obs(), id: "ev-6c2-horn", claims: { deviceFamily: "Horn" } }],
    });
    const demand = aggregatePreliminaryPointDemand([
      buildDeviceInventoryRecord({
        populationId: "pop-1", deviceFamily: r1.candidates.family, system: "Fire Alarm",
        addressability: r1.candidates.attributes.addressing,
        scope: { project: "p1", building: "A", fireAlarmSystem: "FA-1" },
        governingSource: "BOQ",
        sources: [{ authority: "BOQ", source: "BOQ-1", quantity: 100, confidence: 90 }],
      }),
      buildDeviceInventoryRecord({
        populationId: "pop-2", deviceFamily: r2.candidates.family, system: "Fire Alarm",
        addressability: null,
        scope: { project: "p1", building: "A", fireAlarmSystem: "FA-1" },
        governingSource: "BOQ",
        sources: [{ authority: "BOQ", source: "BOQ-2", quantity: 60, confidence: 90 }],
      }),
    ]);

    const snapshot = await createFireAlarmPreliminarySizingSnapshot({
      command: { projectId: "p1", reason: "Governed preliminary point count for the disposable chain." },
      dependencies: { demand },
    });
    assert.equal(snapshot.status, "COMPLETED");

    db.prepare(`
      INSERT INTO fire_alarm_preliminary_sizing_snapshots
        (id, project_id, version_number, input_fingerprint, engine_version, status,
         input_json, calculation_json, dossier_json, reason, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      "snap-6c3-1", "p1", 1, snapshot.inputFingerprint, snapshot.engineVersion, snapshot.status,
      JSON.stringify(snapshot.input), JSON.stringify(snapshot.calculation), JSON.stringify(snapshot.dossier),
      snapshot.input.command.reason, "golden-6c3",
    );

    const rows = db.prepare("SELECT * FROM fire_alarm_preliminary_sizing_snapshots WHERE project_id = ?").all("p1");
    assert.equal(rows.length, 1);
    const current = currentPreliminarySizingSnapshot(rows);
    assert.equal(preliminarySizingFlowState(current), "READY");
    const input = preliminarySizingSnapshotInput(current);
    assert.equal(input.preliminaryTotalPoints, 100);
    assert.equal(input.knownPointDemand, 100);
    assert.equal(input.unknownPointDemand, 60);
    assert.equal(input.thresholdStatus, "WITHIN_THRESHOLD_CONFIRMED");
    assert.equal(input.usable, true);
    // The durable payload carries no product identity and no ecosystem.
    assert.ok(!/farenhyt|panel[_ -]?model/i.test(JSON.stringify(snapshot.dossier)));
  } finally {
    cleanup();
  }
});

test("6C2 handoff: resolver UNRESOLVED-point populations keep the count usable at zero known", async () => {
  const r1 = resolve();
  const r2 = resolve({
    populationId: "pop-2",
    evidence: [{ ...obs(), id: "ev-6c2-noaddr", claims: { deviceFamily: "Addressable Smoke Detector" } }],
  });
  const demand = aggregatePreliminaryPointDemand([
    buildDeviceInventoryRecord({
      populationId: "pop-1", deviceFamily: r1.candidates.family, system: "Fire Alarm",
      addressability: r1.candidates.attributes.addressing,
      scope: { project: "P1" }, governingSource: "BOQ",
      sources: [{ authority: "BOQ", source: "BOQ-1", quantity: 100, confidence: 90 }],
    }),
    buildDeviceInventoryRecord({
      populationId: "pop-2", deviceFamily: r2.candidates.family, system: "Fire Alarm",
      addressability: null,
      scope: { project: "P1" }, governingSource: "BOQ",
      sources: [{ authority: "BOQ", source: "BOQ-2", quantity: 200, confidence: 90 }],
    }),
  ]);
  const snapshot = await createFireAlarmPreliminarySizingSnapshot({
    command: { projectId: "p1", reason: "Governed preliminary point count." },
    dependencies: { demand },
  });
  assert.equal(snapshot.calculation.preliminaryTotalPoints, 100);
  assert.equal(snapshot.calculation.thresholdStatus, "WITHIN_THRESHOLD_CONFIRMED");
  assert.equal(snapshot.calculation.unknownPointDemand, 200);
  assert.ok(PRELIMINARY_SIZING_SNAPSHOT_STATES.includes(snapshot.status));
});

/* ================================================================== *
 * Vocabulary pinning & independence regressions
 * ================================================================== */

test("vocabulary: pinned state sets and no drift", () => {
  assert.deepEqual(ADDRESSABILITY_VALUES, ["ADDRESSABLE", "CONVENTIONAL", "NON_LOOP"]);
  assert.ok(DEVICE_IDENTITY_STATES.includes("GOVERNED_IDENTITY_RESOLVED"));
  assert.ok(FAMILY_STATES.includes("GOVERNED_FAMILY_RESOLVED"));
  assert.ok(ADDRESSABILITY_STATES.includes("GOVERNED_ADDRESSABILITY_RESOLVED"));
  assert.ok(POINT_CONSUMPTION_STATES.includes("MULTI_ADDRESS_UNRESOLVED"));
  for (const state of POPULATION_STATES) assert.equal(typeof state, "string");
});

test("independence: ecosystem lane (GOLDEN-5) never appears in the resolver contract", () => {
  const r = resolve();
  assert.ok(!("ecosystemTarget" in r));
  assert.ok(!("panelSizeClass" in r));
});