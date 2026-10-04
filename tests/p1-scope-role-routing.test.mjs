import test from "node:test";
import assert from "node:assert/strict";
import { resolveRequirementRoute } from "../app/domain/requirement-scope-role-routing.mjs";

// P1 scope & downstream-role routing: pure derivation, no DB, no AI.

const req = (overrides = {}) => ({
  originalText: "", requirementCategory: "Other", standards: [], compatibility: [], attributes: [], ...overrides,
});

test("explicit device family routes PRODUCT_MATCHING at FAMILY_LEVEL", () => {
  const out = resolveRequirementRoute(req({ originalText: "Duct detector activation must trigger supervisory alarm", requirementCategory: "Functional" }));
  assert.equal(out.role, "PRODUCT_MATCHING");
  assert.equal(out.scope, "FAMILY_LEVEL");
  assert.equal(out.family, "Duct Detector");
});

test("Golden req197 shape routes PRODUCT_MATCHING, never a protocol inference", () => {
  const out = resolveRequirementRoute(req({
    originalText: "Factory-set fixed temperature at 135°F; compatible with FlashScan and CLIP protocol systems",
    requirementCategory: "Compliance",
    compatibility: [{ targetItem: "FlashScan systems" }],
  }));
  assert.equal(out.role, "PRODUCT_MATCHING");
  assert.equal(out.family, "Heat Detector");
});

test("practice categories route to governed non-matching roles, obligations preserved", () => {
  assert.equal(resolveRequirementRoute(req({ originalText: "Install detectors per drawings", requirementCategory: "Installation" })).role, "INSTALLATION_COMPLIANCE");
  assert.equal(resolveRequirementRoute(req({ originalText: "Acceptance testing by contractor", requirementCategory: "Testing" })).role, "TESTING_COMMISSIONING");
  assert.equal(resolveRequirementRoute(req({ originalText: "Submit shop drawings", requirementCategory: "Documentation" })).role, "DOCUMENTATION_SUBMITTAL");
  assert.equal(resolveRequirementRoute(req({ originalText: "Provide maintenance visits", requirementCategory: "Maintenance" })).role, "MAINTENANCE_SERVICE");
  assert.equal(resolveRequirementRoute(req({ originalText: "Priced maintenance proposal", requirementCategory: "Warranty" })).role, "COMMERCIAL");
  assert.equal(resolveRequirementRoute(req({ originalText: "Contractor must have 10 years experience", requirementCategory: "Manufacturer" })).role, "COMMERCIAL");
});

test("practice routes keep PROJECT_WIDE scope, never ITEM_SPECIFIC", () => {
  for (const category of ["Installation", "Testing", "Documentation", "Maintenance", "Manufacturer"]) {
    const out = resolveRequirementRoute(req({ originalText: "Some clause text", requirementCategory: category }));
    assert.equal(out.scope, "PROJECT_WIDE", category);
    assert.notEqual(out.scope, "ITEM_SPECIFIC", category);
  }
});

test("standards without family are system obligations, never compatibility targets", () => {
  const out = resolveRequirementRoute(req({
    originalText: "NFPA 72, 2019 - National Fire Alarm and Signaling Code",
    requirementCategory: "Compliance", standards: [{ body: "NFPA", number: "72" }],
  }));
  assert.equal(out.role, "SYSTEM_ARCHITECTURE");
  assert.equal(out.scope, "SYSTEM_WIDE");
});

test("UL listing with explicit device noun stays matchable as a listing (family known)", () => {
  const out = resolveRequirementRoute(req({
    originalText: "The strobe device should comply with UL 1971 standards",
    requirementCategory: "Compliance", standards: [{ body: "UL", number: "1971" }],
  }));
  assert.equal(out.role, "PRODUCT_MATCHING");
  assert.equal(out.family, "Strobe");
});

test("vague text with no evidence stays UNKNOWN in triage", () => {
  for (const text of [
    "Provide, install, and connect an intelligent addressable fire alarm system",
    "Power supplies, batteries, and battery chargers to relevant standards",
    "Sample text fragment without operative content",
  ]) {
    const out = resolveRequirementRoute(req({ originalText: text, requirementCategory: "Other" }));
    assert.equal(out.unknown, true, text);
    assert.equal(out.role, "UNKNOWN", text);
    assert.equal(out.scope, "UNKNOWN", text);
  }
});

test("ITEM_SPECIFIC is never assigned from requirement text alone", () => {
  const out = resolveRequirementRoute(req({
    originalText: "The Fire Alarm Control Panel (FACP) shall feature switches and an LCD display",
    requirementCategory: "Functional",
  }));
  assert.notEqual(out.scope, "ITEM_SPECIFIC");
});

test("vendor names do not change routing into product matching", () => {
  const out = resolveRequirementRoute(req({ originalText: "Approved vendor list: Honeywell – U.S.A.", requirementCategory: "Manufacturer" }));
  assert.equal(out.role, "COMMERCIAL");
  assert.equal(out.family, null);
});

test("MFACP/FACP topology is referenced equipment, not a family (R5): the Network category decides", () => {
  // R5 changed the upstream P5 resolver: panels named in "between MFACP and FACP" are referenced
  // equipment, so the family is no longer resolved and P1 falls through to the practice category.
  const out = resolveRequirementRoute(req({ originalText: "Network communication between MFACP and FACP should be continuously supervised", requirementCategory: "Network" }));
  assert.equal(out.family, null);
  assert.equal(out.role, "SYSTEM_ARCHITECTURE");
});
