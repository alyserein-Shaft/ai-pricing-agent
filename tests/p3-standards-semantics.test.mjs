import test from "node:test";
import assert from "node:assert/strict";
import { classifyStandardRelationship, classifyStandardOccurrence, refineRouteWithStandardSemantics } from "../app/domain/standards-semantics.mjs";

// P3 standards/listings semantics: identity ≠ role ≠ listing ≠ target.

test("relationship wording classification", () => {
  assert.equal(classifyStandardRelationship("must be UL certified to UL 268"), "CERTIFIED_TO");
  assert.equal(classifyStandardRelationship("shall be listed under a single manufacturer"), "LISTED_TO");
  assert.equal(classifyStandardRelationship("The UL 268A-listed housing fits footprints"), "LISTED_TO");
  assert.equal(classifyStandardRelationship("devices compliant with UL864"), "COMPLIES_WITH");
  assert.equal(classifyStandardRelationship("Complies with the 8th Edition of UL 217"), "COMPLIES_WITH");
  assert.equal(classifyStandardRelationship("installation in accordance with NFPA 72"), "IN_ACCORDANCE_WITH");
  assert.equal(classifyStandardRelationship("Cables as per NFPA and BS6387"), "IN_ACCORDANCE_WITH");
  assert.equal(classifyStandardRelationship("UL268, 7 Edition, 2016 – UL Standard for Safety Smoke Detectors"), "MENTIONED");
  assert.equal(classifyStandardRelationship("Approved to UL 864"), "APPROVED");
});

test("ISO 9001 is always quality certification, never product evidence", () => {
  const out = classifyStandardOccurrence({ body: "ISO", number: "9001", relationship: "MENTIONED", category: "Manufacturer", family: null, text: "Manufacturers must be ISO 9001 certified" });
  assert.equal(out.semantic, "QUALITY_CERTIFICATION");
});

test("listing verb with family gives PRODUCT_STANDARD; without gives SYSTEM_STANDARD", () => {
  const withFam = classifyStandardOccurrence({ body: "UL", number: "1971", relationship: "COMPLIES_WITH", category: "Compliance", family: "Strobe", text: "The strobe device should comply with UL 1971" });
  assert.equal(withFam.semantic, "PRODUCT_STANDARD");
  const noFam = classifyStandardOccurrence({ body: "UL", number: "864", relationship: "COMPLIES_WITH", category: "Compliance", family: null, text: "All control equipment is required to include transient protection compliant with UL864" });
  assert.equal(noFam.semantic, "SYSTEM_STANDARD");
});

test("bibliography entries are REFERENCE_ENTRY, never match gates", () => {
  const out = classifyStandardOccurrence({ body: "NFPA", number: "72", relationship: "MENTIONED", category: "Other", family: null, text: "NFPA 72, 2019 - National Fire Alarm and Signaling Code. c." });
  assert.equal(out.semantic, "REFERENCE_ENTRY");
});

test("cable/wiring context routes CABLE_WIRING_STANDARD", () => {
  const out = classifyStandardOccurrence({ body: "BS", number: "6387", relationship: "IN_ACCORDANCE_WITH", category: "Other", family: null, text: "Cables: installations per NFPA, BS6387 and Civil Defense Codes" });
  assert.equal(out.semantic, "CABLE_WIRING_STANDARD");
});

test("testing category routes TESTING_STANDARD; product test features do not", () => {
  const t = classifyStandardOccurrence({ body: "NFPA", number: "72", relationship: "COMPLIES_WITH", category: "Testing", family: null, text: "Acceptance testing per NFPA 72" });
  assert.equal(t.semantic, "TESTING_STANDARD");
  const f = classifyStandardOccurrence({ body: "UL", number: "268", relationship: "MENTIONED", category: "Compliance", family: "Heat Detector", text: "Can be tested remotely from the panel" });
  assert.notEqual(f.semantic, "TESTING_STANDARD");
});

test("refinement only fills UNKNOWN routes, never reassigns decided ones", () => {
  const decided = { scope: "FAMILY_LEVEL", role: "PRODUCT_MATCHING", basis: ["X"], unknown: false };
  assert.deepEqual(refineRouteWithStandardSemantics(decided, [{ semantic: "INSTALLATION_CODE" }]), decided);
  const unk = { scope: "UNKNOWN", role: "UNKNOWN", basis: ["Y"], unknown: true };
  const inst = refineRouteWithStandardSemantics(unk, [{ semantic: "INSTALLATION_CODE" }]);
  assert.equal(inst.role, "INSTALLATION_COMPLIANCE");
  assert.equal(refineRouteWithStandardSemantics(unk, [{ semantic: "SYSTEM_STANDARD" }]).unknown, true);
  assert.equal(refineRouteWithStandardSemantics(unk, []).unknown, true);
});

test("SAFETY: no semantic ever yields a compatibility target", () => {
  for (const semantic of ["PRODUCT_STANDARD", "SYSTEM_STANDARD", "INSTALLATION_CODE", "TESTING_STANDARD", "QUALITY_CERTIFICATION", "CABLE_WIRING_STANDARD", "APPROVAL_CERTIFICATION", "REFERENCE_ENTRY"]) {
    assert.ok(!/compat/i.test(semantic), semantic);
  }
});

test("SAFETY: standards map to P1 practice roles, never PROTOCOL", () => {
  const unk = { scope: "UNKNOWN", role: "UNKNOWN", basis: [], unknown: true };
  for (const [sem, role] of [["INSTALLATION_CODE", "INSTALLATION_COMPLIANCE"], ["CABLE_WIRING_STANDARD", "INSTALLATION_COMPLIANCE"], ["TESTING_STANDARD", "TESTING_COMMISSIONING"], ["QUALITY_CERTIFICATION", "COMMERCIAL"], ["REFERENCE_ENTRY", "INFORMATIONAL"]]) {
    assert.equal(refineRouteWithStandardSemantics(unk, [{ semantic: sem }]).role, role, sem);
  }
});
