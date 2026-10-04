import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  SLC_RESOURCE_CLASSIFIER_VERSION,
  SLC_RESOURCE_STATES,
  classifyFireAlarmSlcItem,
  resolveSlcDemandQuantity,
} from "../app/domain/fire-alarm-slc-resource-classifier.mjs";
import { gatherCalculationInputs } from "../app/domain/calculation-requirement-engine.mjs";

const attributes = (entries) => Object.fromEntries(entries.map(([name, value]) => [name, { value }]));

const item = (overrides = {}) => ({
  system: "Fire Alarm",
  family: "Addressable Smoke Detector",
  attributes: attributes([["addressing", "Addressable"]]),
  selectedQuantity: { value: 10, source: "BOQ", decisionId: null },
  ...overrides,
});

test("R7-P2 classifier version and closed state vocabulary are explicit", () => {
  // GOLDEN-6C3B bumped the version and added ONE state. The state exists because
  // SLC role and point consumption were incorrectly coupled: a governed family
  // was either accepted with a hardcoded one-point-per-device, or refused as
  // though it had no role at all. `SLC_ROLE_ESTABLISHED` is the honest middle --
  // the family is recognized, and its point count is withheld because this
  // repository evidences none. It carries a null demand, so 6C books it as
  // UNKNOWN and never as zero, and it is deliberately NOT a pool state, so
  // panel sizing keeps failing closed on it.
  assert.equal(SLC_RESOURCE_CLASSIFIER_VERSION, "fire-alarm-slc-resource-classifier-1.3.0");
  assert.deepEqual(SLC_RESOURCE_STATES, ["SLC_DETECTOR_POOL", "SLC_MODULE_POOL", "SLC_ROLE_ESTABLISHED", "NOT_SLC", "UNRESOLVED"]);
});

test("CASE A/B -- governed addressable smoke and heat detectors use one detector pool", () => {
  for (const family of ["Addressable Smoke Detector", "Addressable Heat Detector"]) {
    const result = classifyFireAlarmSlcItem(item({ family }));
    assert.equal(result.state, "SLC_DETECTOR_POOL", `${family}: ${result.reason}`);
    assert.equal(result.unitsPerDevice, 1);
    assert.equal(result.demandUnits, 10);
    assert.equal(result.quantity.source, "BOQ");
  }
});

test("CASE C/G -- conventional and unknown-addressability items do not become zero demand", () => {
  const conventional = classifyFireAlarmSlcItem(item({ family: "Conventional Detector", attributes: attributes([["addressing", "Conventional"]]) }));
  assert.equal(conventional.state, "NOT_SLC");
  assert.equal(conventional.demandUnits, 0);
  const unknown = classifyFireAlarmSlcItem(item({ attributes: {} }));
  assert.equal(unknown.state, "UNRESOLVED");
  assert.equal(unknown.demandUnits, null);
});

test("CASE D/E -- governed addressable monitor/control modules use the module pool", () => {
  for (const family of ["Monitor Module", "Control Module"]) {
    const result = classifyFireAlarmSlcItem(item({ family }));
    assert.equal(result.state, "SLC_MODULE_POOL");
    assert.equal(result.unitsPerDevice, 1);
    assert.equal(result.demandUnits, 10);
  }
});

test("CASE F/H/I/J -- accessories, manual initiators, notification, and multi-address evidence fail closed or remain non-demand", () => {
  assert.equal(classifyFireAlarmSlcItem(item({ family: "Detector Base" })).state, "NOT_SLC");

  // GOLDEN-6C3B: Manual Call Point is a CANONICAL governed family
  // (`product_families`, domain "Manual Initiation") that this classifier used
  // to refuse for naming reasons alone. Its ROLE is now recognized -- and its
  // point consumption is still withheld, because no repository evidence
  // establishes how many SLC addresses a manual call point consumes.
  // "Remains non-demand" is the property this case protects, and it holds.
  const mcp = classifyFireAlarmSlcItem(item({ family: "Manual Call Point" }));
  assert.equal(mcp.state, "SLC_ROLE_ESTABLISHED");
  assert.equal(mcp.slcRole, "SLC_FIELD_DEVICE");
  assert.equal(mcp.unitsPerDevice, null);
  assert.equal(mcp.demandUnits, null, "a recognized family with no consumption evidence stays non-demand");
  assert.equal(mcp.quantity.total, null);

  // Notification appliances stay UNRESOLVED. GOLDEN-6C3B deliberately did NOT
  // promote them: doing so would move their units out of the `unknown` bucket
  // into a settled zero, and unknown demand must stay visible.
  const strobe = classifyFireAlarmSlcItem(item({ family: "Strobe", attributes: attributes([["addressing", "Addressable"]]) }));
  assert.equal(strobe.state, "UNRESOLVED");
  assert.equal(strobe.slcRole, "NOT_SLC", "the canonical role is recorded, but the exclusion decision is unchanged");

  const multi = classifyFireAlarmSlcItem(item({ attributes: attributes([["addressing", "Addressable"], ["channel_count", 2]]) }));
  assert.equal(multi.state, "UNRESOLVED");
  assert.equal(multi.demandUnits, null);
});

test("CASE K-N -- quantity decision, fallback, unknown, and explicit zero semantics", () => {
  const decision = classifyFireAlarmSlcItem(item({ selectedQuantity: { value: 7, source: "Drawing", decisionId: "q1" } }));
  assert.equal(decision.demandUnits, 7);
  assert.equal(decision.quantity.decisionId, "q1");
  const fallback = resolveSlcDemandQuantity({ value: 4, source: "BOQ", decisionId: null }, 1);
  assert.equal(fallback.value, 4);
  const unknown = resolveSlcDemandQuantity({ value: null, source: "BOQ", decisionId: null }, 1);
  assert.equal(unknown.value, null);
  assert.equal(unknown.status, "UNKNOWN");
  const zero = resolveSlcDemandQuantity({ value: 0, source: "Reviewed", decisionId: "q2" }, 1);
  assert.equal(zero.value, 0);
  assert.equal(zero.status, "VALID");
});

test("CASE O -- explicit quantity conflict cannot produce demand", () => {
  const result = classifyFireAlarmSlcItem(item({ selectedQuantity: { value: 10, source: "BOQ", decisionId: "q1", status: "CONFLICT" } }));
  assert.equal(result.state, "UNRESOLVED");
  assert.equal(result.demandUnits, null);
});

test("CASE P/Q -- classifier and quantity provenance are retained in the contribution identity", () => {
  const result = classifyFireAlarmSlcItem(item());
  assert.equal(result.classifierVersion, SLC_RESOURCE_CLASSIFIER_VERSION);
  assert.equal(result.family, "Addressable Smoke Detector");
  assert.equal(result.addressability, "Addressable");
  assert.equal(result.quantity.source, "BOQ");
  assert.equal(result.provenance.family, "Addressable Smoke Detector");
  assert.equal(result.provenance.addressability, "Addressable");
});

test("persisted SLC classification feeds live calculation demand and capacity evidence is approved-only", () => {
  const profile = {
    boqItem: {
      slcResourceClassification: {
        state: "SLC_DETECTOR_POOL",
        demandUnits: 10,
        quantity: { source: "BOQ", decisionId: null },
        provenance: { quantityAuthority: "BOQ" },
      },
    },
  };
  const approvedProduct = {
    attributes: [
      { name: "native_loops", value: 1, reviewStatus: "Approved" },
      { name: "detectors_per_loop", value: 20, reviewStatus: "Approved" },
      { name: "modules_per_loop", value: 10, reviewStatus: "Approved" },
      { name: "system_point_capacity", value: 100, reviewStatus: "Approved" },
    ],
  };
  const approved = gatherCalculationInputs({ calculationType: "slc.loop-and-expansion", product: approvedProduct, profile });
  assert.deepEqual(approved.inputs.filter((entry) => entry.name.startsWith("demand.")), [
    { name: "demand.detectors", value: 10, unit: "count", source: { side: "slc-resource-classification", sourceId: "BOQ", documentId: null, reviewStatus: "Approved", origin: "SLC_DETECTOR_POOL", confidence: null, evidence: { quantityAuthority: "BOQ" } } },
    { name: "demand.modules", value: 0, unit: "count", source: { side: "slc-resource-classification", sourceId: "BOQ", documentId: null, reviewStatus: "Approved", origin: "SLC_DETECTOR_POOL", confidence: null, evidence: { quantityAuthority: "BOQ" } } },
  ]);
  assert.equal(approved.inputs.filter((entry) => entry.name.startsWith("panelCapacity.")).length, 4);

  const needsReview = gatherCalculationInputs({
    calculationType: "slc.loop-and-expansion",
    profile,
    product: { attributes: approvedProduct.attributes.map((entry) => ({ ...entry, reviewStatus: "Needs Review" })) },
  });
  assert.deepEqual(needsReview.inputs.filter((entry) => entry.name.startsWith("panelCapacity.")), []);
});

test("R7-P2 technical profile integration uses selected quantity and classifier identity in the existing fingerprint", async () => {
  const source = await readFile(new URL("../worker/technical-requirement-api.mjs", import.meta.url), "utf8");
  assert.match(source, /currentSelectedQuantity\(env\.DB, item\)/);
  assert.match(source, /classifyFireAlarmSlcItem\(\{ system: approvedSystem, family: approvedProductFamily/);
  assert.match(source, /quantityAuthority: selectedQuantity/);
  assert.match(source, /slcClassifierVersion: slcResourceClassification\.classifierVersion/);
  assert.match(source, /quantity: selectedQuantity\.value/);
  assert.match(source, /currentBoqEligibleForEngineeringPredicate\("b"\)/);
});
