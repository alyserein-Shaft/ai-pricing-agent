import test from "node:test";
import assert from "node:assert/strict";
import { extractAttributes } from "../app/domain/specification-extractor.mjs";
import { resolveRequirementFamilyPhrase } from "../app/domain/fire-alarm-taxonomy.mjs";

// P0 deterministic structure pack: verbatim extraction only, explicit
// negatives locked. No DB, no AI.

const names = (text) => extractAttributes(text).map((entry) => `${entry.name}=${entry.normalizedValue}`);

test("positive: fixed-temperature setpoint captured verbatim", () => {
  assert.deepEqual(names("Factory-set fixed temperature at 135°F (57°C)"), ["fixed_temperature_setpoint=135°F"]);
  assert.deepEqual(names("a high-temperature model provides fixed detection at 190°F (88°C)"), ["fixed_temperature_setpoint=190°F"]);
});

test("positive: rate-of-rise captured from both phrasings", () => {
  assert.deepEqual(names("Rate-of-rise detection at 15°F (8.3°C) per minute"), ["rate_of_rise_sensitivity=15°F/min"]);
  assert.deepEqual(names("Thermal ratings: fixed setpoint at 135°F (57°C), rate-of-rise at 15°F (8.3°C) per minute"), ["fixed_temperature_setpoint=135°F", "rate_of_rise_sensitivity=15°F/min"]);
});

test("positive: explicit addressing statements captured", () => {
  assert.deepEqual(names("Individually addressable devices"), ["addressing=Addressable"]);
  assert.deepEqual(names("Supports addressable-analog communication"), ["addressing=Addressable"]);
  assert.deepEqual(names("including addressable smoke detectors, multi-sensors"), ["addressing=Addressable"]);
});

test("negative: operating range is NOT a setpoint", () => {
  assert.deepEqual(names("Ambient Temperature: 0°C to 60°C"), ["Temperature=0,60"]);
  assert.deepEqual(names("operate on 15 – 32 VDC, within 0°C to 60°C"), ["Voltage=32", "Temperature=0,60"]);
});

test("negative: UL listing produces no attribute and no compatibility", () => {
  assert.deepEqual(names("The strobe device should comply with UL 1971 standards"), []);
  assert.deepEqual(names("Detectors must be UL certified to UL 217 and UL 268"), []);
});

test("negative: Class A wiring produces no attribute", () => {
  assert.deepEqual(names("Each SLC must accommodate NFPA 72 Style 4 wiring configurations"), []);
  assert.deepEqual(names("supervised two-wire zone of control units for feedback loop circuits (Class A wiring)"), []);
});

test("negative: address ranges never become addressing or protocol facts", () => {
  assert.deepEqual(names("rotary decimal addressing (range: 1-99 for CLIP systems, 1-159 for Flash Scan systems)"), []);
  assert.deepEqual(names("Compatible with FlashScan and CLIP protocols"), []);
});

test("negative: bare numbers without concept nouns are not captured", () => {
  assert.deepEqual(names("Responds to greater than 15°F/minute or 135°F"), []);
  assert.deepEqual(names("high heat at 190°F (88°C)"), []);
});

test("positive family: explicit device phrases resolve", () => {
  assert.equal(resolveRequirementFamilyPhrase("Duct detector activation must trigger supervisory alarm")?.family, "Duct Detector");
  assert.equal(resolveRequirementFamilyPhrase("The manual call point must be compatible")?.family, "Manual Call Point");
  assert.equal(resolveRequirementFamilyPhrase("Strobe units shall be synchronized")?.family, "Strobe");
  assert.equal(resolveRequirementFamilyPhrase("Combined smoke and heat detector")?.family, "Multi-Criteria Detector");
  assert.equal(resolveRequirementFamilyPhrase("The Fire Alarm Control Panel (FACP) shall feature switches")?.family, "Fire Alarm Control Panel");
  assert.equal(resolveRequirementFamilyPhrase("Factory-set fixed temperature at 135°F")?.family, "Heat Detector");
});

test("negative family: ambiguous wording stays unresolved", () => {
  for (const text of [
    "Smoke detectors (above ceiling)",
    "photoelectric smoke detector",
    "The detector must connect to the local control unit",
    "auxiliary addressable power supply serves as remote source",
    "horn alone in the corridor",
    "The entry keypad must support technical operations",
    "Provide, install, and connect an intelligent addressable fire alarm system",
  ]) assert.equal(resolveRequirementFamilyPhrase(text), null, text);
});

test("negative family: vendor names and acronyms never resolve", () => {
  assert.equal(resolveRequirementFamilyPhrase("Approved vendor list: Honeywell – U.S.A."), null);
  // R5: referenced equipment ("between MFACP and FACP") never steals the family identity.
  assert.equal(resolveRequirementFamilyPhrase("Network communication between MFACP and FACP should be supervised"), null);
});
