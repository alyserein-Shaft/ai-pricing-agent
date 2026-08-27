import test from "node:test";
import assert from "node:assert/strict";
import { runProductMatching } from "../app/domain/product-matching-engine.mjs";

// Sprint 0.4 -- profile.boqItem.attributes carries APPROVED BOQ Understanding
// facts in the governed canonical vocabulary (product_type, addressing,
// operating_voltage, ip_rating, ...). The catalog's own attributes (from
// specification-extractor.mjs) use a different, generic vocabulary ("IP
// Rating", "Voltage", ...). This proves the bridge -- via
// system-knowledge-registry.mjs's normalizeAttributeName, the same alias
// table BOQ Understanding already uses -- actually connects the two, without
// fuzzy merging and without ever blocking a candidate merely because the
// catalog hasn't captured an attribute yet.

const profile = (boqAttributes, overrides = {}) => ({
  versionNumber: 1,
  boqItem: { id: "boq-1", description: "Addressable smoke detector", system: "Fire Alarm", category: "Detection Devices", productFamily: "Addressable Smoke Detector", attributes: boqAttributes },
  readiness: { status: "Ready for Matching", blockingReasons: [] },
  consolidatedRequirements: [], standards: [], manufacturers: [], compatibility: [], accessories: [], derivedRequirements: [], clarifications: [],
  ...overrides,
});
const product = (attributes, overrides = {}) => ({ id: "p1", manufacturer: "Honeywell", family: "Addressable Smoke Detector", partNumber: "IDP-PHOTO-W", description: "Addressable photoelectric smoke detector", lifecycleStatus: "Active", reviewStatus: "Reviewed", attributes, standards: [], compatibility: [], accessories: [], source: { sheet: "Catalogue", row: 12 }, ...overrides });

test("a governed requirement attribute matches a raw catalog attribute through the shared alias bridge (ip_rating <-> IP Rating)", () => {
  const result = runProductMatching({ profile: profile({ ip_rating: "IP65" }), products: [product([{ name: "IP Rating", value: "IP65" }])] });
  const comparison = result.candidates[0].comparisons.find((entry) => entry.requirement?.attributeName === "ip_rating");
  assert.equal(comparison.result, "Pass");
  assert.equal(comparison.blocking, false);
});

test("a genuine verified mismatch between requirement and catalog attribute still blocks the candidate", () => {
  const result = runProductMatching({ profile: profile({ warranty: "5 years" }), products: [product([{ name: "Warranty Duration", value: "2 years" }])] });
  const comparison = result.candidates[0].comparisons.find((entry) => entry.requirement?.attributeName === "warranty");
  assert.equal(comparison.result, "Fail");
  assert.equal(comparison.blocking, true, "a real, verified mismatch is still a mandatory failure");
  assert.equal(result.candidates[0].mandatoryFailures.some((entry) => entry.requirement?.attributeName === "warranty"), true);
});

test("missing catalog attribute evidence is reported (PRODUCT_ATTRIBUTE_MISSING-equivalent) but never blocks the candidate", () => {
  const result = runProductMatching({ profile: profile({ temperature_range: "-10 to 60 C" }), products: [product([])] });
  const comparison = result.candidates[0].comparisons.find((entry) => entry.requirement?.attributeName === "temperature_range");
  assert.equal(comparison.result, "Missing Product Data");
  assert.equal(comparison.offered, null);
  assert.equal(comparison.blocking, false, "unverified/missing catalog evidence must never turn a candidate into a rejected one");
  assert.notEqual(result.candidates[0].technicalStatus, "Non-Compliant", "missing (not mismatched) evidence must never reject the candidate");
  assert.equal(result.candidates[0].recommendationTier === "Rejected Candidate", false);
});

test("no fuzzy merging -- an attribute with no safe explicit alias (Voltage) is never silently matched", () => {
  const result = runProductMatching({ profile: profile({ operating_voltage: 24 }), products: [product([{ name: "Voltage", normalizedValue: 24, normalizedUnit: "V" }])] });
  const comparison = result.candidates[0].comparisons.find((entry) => entry.requirement?.attributeName === "operating_voltage");
  assert.equal(comparison.result, "Missing Product Data", "Voltage has no explicit alias to operating_voltage (input_voltage vs operating_voltage is ambiguous) -- it must not be guessed");
  assert.equal(comparison.offered, null);
});

test("unknown attributes with no governed name remain distinct and are simply not compared", () => {
  const result = runProductMatching({ profile: profile({ some_future_attribute: "value" }), products: [product([{ name: "Some Future Attribute", value: "value" }])] });
  assert.equal(result.candidates[0].comparisons.some((entry) => entry.requirement?.attributeName === "some_future_attribute" && entry.result === "Pass"), false, "an attribute with no registered alias must never be treated as matched");
});

test("a non-governed system never receives Fire Alarm attribute aliasing, even with matching-looking raw names", () => {
  const cctvProfile = profile({ addressing: "Addressable" }, { boqItem: { id: "boq-2", description: "PTZ camera", system: "CCTV", category: "Cameras", productFamily: "PTZ Camera", attributes: { addressing: "Addressable" } } });
  const result = runProductMatching({ profile: cctvProfile, products: [product([{ name: "Addressing", value: "Addressable" }], { family: "PTZ Camera", description: "PTZ camera" })] });
  assert.equal(result.candidates[0].comparisons.some((entry) => entry.requirement?.attributeName === "addressing"), false, "CCTV is not a registered system -- Fire Alarm's alias table must never be applied to it");
});

// Sprint 0.5 -- a requirement for a primary device (e.g. Strobe) must not be
// satisfied by a product evidenced as only an accessory of one (e.g. LENS-G,
// device_role=Accessory extracted from its own "...Lens Attachment..." text).
test("a product evidenced as an accessory (device_role=Accessory) is a mandatory mismatch for a primary-device requirement", () => {
  const strobeProfile = profile({}, { boqItem: { id: "boq-3", description: "Horn Strobe 2W Red Wall", system: "Fire Alarm", category: "Notification Devices", productFamily: "Strobe", attributes: {} } });
  const lensAccessory = product([{ name: "device_role", value: "Accessory" }], { id: "p-lens", family: "Strobe", partNumber: "LENS-G", description: "Wall Strobe Lens Attachment, Green" });
  const result = runProductMatching({ profile: strobeProfile, products: [lensAccessory] });
  const comparison = result.candidates[0].comparisons.find((entry) => entry.requirement?.attributeName === "device_role");
  assert.equal(comparison.result, "Fail");
  assert.equal(comparison.blocking, true);
  assert.equal(result.candidates[0].mandatoryFailures.some((entry) => entry.requirement?.attributeName === "device_role"), true);
  assert.equal(result.candidates[0].technicalStatus, "Non-Compliant");
});
test("an accessory-role product is NOT a mismatch when the requirement itself wants an accessory-type family", () => {
  const baseProfile = profile({}, { boqItem: { id: "boq-4", description: "Detector base", system: "Fire Alarm", category: "Detection Devices", productFamily: "Detector Base", attributes: {} } });
  const genuineBase = product([{ name: "device_role", value: "Accessory" }], { id: "p-base", family: "Detector Base", partNumber: "B501-IV", description: "4\" standard flangeless mounting base" });
  const result = runProductMatching({ profile: baseProfile, products: [genuineBase] });
  assert.equal(result.candidates[0].comparisons.some((entry) => entry.requirement?.attributeName === "device_role"), false, "a Detector Base requirement genuinely wants an accessory-type product -- no mismatch");
});
test("a candidate with no device_role evidence at all is never penalized (absence is not a mismatch)", () => {
  const strobeProfile = profile({}, { boqItem: { id: "boq-5", description: "Speaker Strobe Red Ceiling", system: "Fire Alarm", category: "Notification Devices", productFamily: "Strobe", attributes: {} } });
  const genuineStrobe = product([], { id: "p-genuine", family: "Strobe", partNumber: "SPSCRL", description: "Speaker Strobe Red Ceiling" });
  const result = runProductMatching({ profile: strobeProfile, products: [genuineStrobe] });
  assert.equal(result.candidates[0].comparisons.some((entry) => entry.requirement?.attributeName === "device_role"), false);
  assert.notEqual(result.candidates[0].technicalStatus, "Non-Compliant");
});
