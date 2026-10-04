import test from "node:test";
import assert from "node:assert/strict";

import {
  CAPACITY_SCOPE_DIMENSIONS,
  CapacityScopeError,
  assertDesignProtocol,
  buildCapacityFact,
  capacityOrUnresolved,
  isLegacyProtocolFact,
  isSameEngineeringFact,
  resolveCapacity,
} from "../app/domain/scoped-product-capacity.mjs";

// PHASE D/G -- SCOPED CAPACITY.
//
// THE INVARIANT: a bare capacity number is not engineering data. Every value
// entering matching, knowledge, BOM or sizing must carry its full scope, and a
// consumer must fail closed rather than borrow a number from a neighbouring
// scope.
//
// The concrete trap these tests exist to close: 159 detectors/SLC and
// 159 modules/SLC are different facts. So are FlashScan 159 and CLIP 99. So
// are 3,180/FACP and 200/network.

// The manufacturer's documented FlashScan figures (Honeywell DN-62112 Rev M /
// SLC Wiring Manual 51253:U9), each correctly scoped.
const FLASHSCAN = {
  detectorsPerSlc: () => buildCapacityFact({
    value: 159, unit: "detectors", resourceClass: "detector", scopeType: "SLC", scopeEntity: "SLM-318",
    protocolMode: "FlashScan", evidence: "DN-62112 Rev M p.9", authority: "MANUFACTURER_DOCUMENT", reviewState: "VERIFIED",
  }),
  modulesPerSlc: () => buildCapacityFact({
    value: 159, unit: "modules", resourceClass: "module", scopeType: "SLC", scopeEntity: "SLM-318",
    protocolMode: "FlashScan", evidence: "DN-62112 Rev M p.9", authority: "MANUFACTURER_DOCUMENT", reviewState: "VERIFIED",
  }),
  devicesPerSlc: () => buildCapacityFact({
    value: 318, unit: "devices", resourceClass: "device", scopeType: "SLC", scopeEntity: "SLM-318",
    protocolMode: "FlashScan", evidence: "DN-62112 Rev M p.2", authority: "MANUFACTURER_DOCUMENT", reviewState: "VERIFIED",
  }),
  loopsPerFacpN16x: () => buildCapacityFact({
    value: 10, unit: "SLC loops", resourceClass: "loop", scopeType: "FACP", scopeEntity: "N16x",
    protocolMode: "FlashScan", evidence: "DN-62112 Rev M p.9", authority: "MANUFACTURER_DOCUMENT", reviewState: "VERIFIED",
  }),
  devicesPerFacpN16x: () => buildCapacityFact({
    value: 3180, unit: "addressable devices", resourceClass: "device", scopeType: "FACP", scopeEntity: "N16x",
    protocolMode: "FlashScan", evidence: "DN-62112 Rev M p.1", authority: "MANUFACTURER_DOCUMENT", reviewState: "VERIFIED",
  }),
  // The genuine trap: 3,180 is 1,590 detectors + 1,590 modules, NOT 3,180
  // detectors. Citing it as a detector capacity overstates detectors 2x.
  detectorsPerFacpN16x: () => buildCapacityFact({
    value: 1590, unit: "detectors", resourceClass: "detector", scopeType: "FACP", scopeEntity: "N16",
    protocolMode: "FlashScan", evidence: "LS10239-000NF-E Rev B p.15", authority: "MANUFACTURER_DOCUMENT", reviewState: "UNVERIFIED_SOURCE_HOST",
  }),
  // CLIP, legacy/exception only.
  detectorsPerSlcClip: () => buildCapacityFact({
    value: 99, unit: "detectors", resourceClass: "detector", scopeType: "SLC", scopeEntity: "SLM-318",
    protocolMode: "CLIP", evidence: "51253:U9 p.13", authority: "MANUFACTURER_DOCUMENT", reviewState: "VERIFIED",
  }),
};

test("a capacity fact must carry every scope dimension", () => {
  assert.throws(
    () => buildCapacityFact({ value: 159, unit: "detectors", resourceClass: "detector", scopeType: "SLC", protocolMode: "FlashScan", evidence: "e", authority: "a" }),
    (error) => error instanceof CapacityScopeError && error.code === "CAPACITY_SCOPE_INCOMPLETE" && /scopeEntity/.test(error.message),
    "an unscoped capacity must be refused",
  );
});

test("a capacity without evidence is refused -- an unsourced number is not usable", () => {
  assert.throws(
    () => buildCapacityFact({ value: 159, unit: "detectors", resourceClass: "detector", scopeType: "SLC", scopeEntity: "SLM-318", protocolMode: "FlashScan" }),
    (error) => error.code === "CAPACITY_EVIDENCE_REQUIRED",
  );
});

test("the scope dimensions are exactly the five that make a fact identifiable", () => {
  assert.deepEqual([...CAPACITY_SCOPE_DIMENSIONS], ["resourceClass", "scopeType", "scopeEntity", "protocolMode", "qualifier"]);
});

test("159 detectors/SLC and 159 modules/SLC are NOT the same fact despite the equal number", () => {
  const detectors = FLASHSCAN.detectorsPerSlc();
  const modules = FLASHSCAN.modulesPerSlc();
  assert.equal(detectors.value, modules.value);
  assert.equal(isSameEngineeringFact(detectors, modules), false, "equal numbers, different engineering facts");
  assert.throws(() => resolveCapacity([modules], { resourceClass: "detector", scopeType: "SLC", scopeEntity: "SLM-318", protocolMode: "FlashScan" }),
    (error) => error.code === "CAPACITY_NOT_EVIDENCED",
    "a module capacity must never be borrowed as a detector capacity");
});

test("FlashScan 159 and CLIP 99 are never substituted for one another", () => {
  const all = [FLASHSCAN.detectorsPerSlc(), FLASHSCAN.detectorsPerSlcClip()];
  const fs = resolveCapacity(all, { resourceClass: "detector", scopeType: "SLC", scopeEntity: "SLM-318", protocolMode: "FlashScan" });
  const clip = resolveCapacity(all, { resourceClass: "detector", scopeType: "SLC", scopeEntity: "SLM-318", protocolMode: "CLIP" });
  assert.equal(fs.value, 159);
  assert.equal(clip.value, 99);
  assert.equal(isSameEngineeringFact(fs, clip), false);
  assert.equal(isLegacyProtocolFact(clip), true, "CLIP facts are labelled legacy");
  assert.equal(isLegacyProtocolFact(fs), false);
});

test("a design on a legacy protocol requires an evidence-bearing exception", () => {
  assert.equal(assertDesignProtocol({ protocolMode: "FlashScan" }).allowed, true);

  const refused = assertDesignProtocol({ protocolMode: "CLIP" });
  assert.equal(refused.allowed, false);
  assert.equal(refused.code, "LEGACY_PROTOCOL_REQUIRES_EVIDENCE_BEARING_EXCEPTION");

  const withException = assertDesignProtocol({ protocolMode: "CLIP", exception: { reason: "legacy installed base", evidence: "site survey" } });
  assert.equal(withException.allowed, true, "an evidenced exception is permitted");
});

test("3,180/FACP is a device total, not a detector count", () => {
  const deviceTotal = FLASHSCAN.devicesPerFacpN16x();
  const detectorTotal = FLASHSCAN.detectorsPerFacpN16x();
  assert.equal(deviceTotal.value, 3180);
  assert.equal(detectorTotal.value, 1590, "detector class is 1,590, not 3,180");
  assert.equal(isSameEngineeringFact(deviceTotal, detectorTotal), false);
  assert.throws(() => resolveCapacity([deviceTotal], { resourceClass: "detector", scopeType: "FACP", scopeEntity: "N16x" }),
    (error) => error.code === "CAPACITY_NOT_EVIDENCED",
    "a device total must not answer a detector-capacity question");
});

test("SLC and FACP and NETWORK scopes never answer each other", () => {
  const facts = [FLASHSCAN.devicesPerSlc(), FLASHSCAN.devicesPerFacpN16x()];
  assert.equal(resolveCapacity(facts, { resourceClass: "device", scopeType: "SLC", scopeEntity: "SLM-318" }).value, 318);
  assert.equal(resolveCapacity(facts, { resourceClass: "device", scopeType: "FACP", scopeEntity: "N16x" }).value, 3180);
  assert.throws(() => resolveCapacity(facts, { resourceClass: "device", scopeType: "NETWORK", scopeEntity: "N16x" }),
    (error) => error.code === "CAPACITY_NOT_EVIDENCED",
    "3,180 per FACP is not a network capacity");
});

test("conflicting evidence for one scope is surfaced, never silently resolved", () => {
  const a = buildCapacityFact({ value: 25, unit: "devices", resourceClass: "device", scopeType: "ISOLATOR_SEGMENT", scopeEntity: "ISO-X", evidence: "DN-2243 Rev B p.1", authority: "MANUFACTURER_DOCUMENT" });
  const b = buildCapacityFact({ value: 7, unit: "devices", resourceClass: "device", scopeType: "ISOLATOR_SEGMENT", scopeEntity: "ISO-X", evidence: "51253:U9 p.19", authority: "MANUFACTURER_DOCUMENT" });
  assert.throws(() => resolveCapacity([a, b], { resourceClass: "device", scopeType: "ISOLATOR_SEGMENT", scopeEntity: "ISO-X" }),
    (error) => error.code === "CAPACITY_EVIDENCE_CONFLICT" && /must be resolved against the source documents/.test(error.message));
});

test("a qualifier is part of identity, not a comment", () => {
  const without = buildCapacityFact({ value: 50, unit: "ohms", resourceClass: "device", scopeType: "SLC", scopeEntity: "SLM-318", evidence: "DN-62115 Rev B p.2", authority: "MANUFACTURER_DOCUMENT" });
  const withSelfTest = buildCapacityFact({ value: 35, unit: "ohms", resourceClass: "device", scopeType: "SLC", scopeEntity: "SLM-318", qualifier: "with self-test detectors installed", evidence: "51253:U9 p.25", authority: "MANUFACTURER_DOCUMENT" });
  assert.equal(isSameEngineeringFact(without, withSelfTest), false);
  assert.equal(resolveCapacity([without, withSelfTest], { resourceClass: "device", scopeType: "SLC", scopeEntity: "SLM-318" }).value, 50);
  assert.equal(resolveCapacity([without, withSelfTest], { resourceClass: "device", scopeType: "SLC", scopeEntity: "SLM-318", qualifier: "with self-test detectors installed" }).value, 35);
});

test("an unevidenced capacity reports UNRESOLVED rather than throwing for fail-closed callers", () => {
  const result = capacityOrUnresolved([], { resourceClass: "detector", scopeType: "SLC", scopeEntity: "SLM-318", protocolMode: "FlashScan" });
  assert.equal(result.resolved, false);
  assert.equal(result.fact, null);
  assert.equal(result.code, "CAPACITY_NOT_EVIDENCED");
  assert.match(result.message, /Unknown stays unknown/);
});

test("an invalid capacity value is refused rather than coerced to zero", () => {
  for (const bad of [NaN, -1, "many", undefined]) {
    assert.throws(
      () => buildCapacityFact({ value: bad, unit: "detectors", resourceClass: "detector", scopeType: "SLC", scopeEntity: "SLM-318", protocolMode: "FlashScan", evidence: "e", authority: "a" }),
      (error) => error instanceof CapacityScopeError,
      "value " + JSON.stringify(bad) + " must be refused, never coerced",
    );
  }
});
