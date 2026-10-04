import test from "node:test";
import assert from "node:assert/strict";
import { resolveRequirementFamilyPhrase, KNOWN_REQUIREMENT_FAMILY_GAPS } from "../app/domain/fire-alarm-taxonomy.mjs";

// P5 device-noun pack: only exact aliases resolve; everything else stays
// null (UNKNOWN). No DB, no AI.

const fam = (text) => resolveRequirementFamilyPhrase(text)?.family ?? null;

test("positive: fire-service telephone phrases resolve Firefighter Telephone", () => {
  assert.equal(fam("Each fire- fighter's telephone jack should feature a single phone jack"), "Firefighter Telephone");
  assert.equal(fam("The portable fire telephone handset should be red, with a coiled cord"), "Firefighter Telephone");
});

test("positive: break-glass insert resolves Break Glass Unit", () => {
  assert.equal(fam("enclosure cover equipped with a lock and break-glass insert"), "Break Glass Unit");
});

test("positive: pre-existing manual/strobe/duct phrases still resolve", () => {
  assert.equal(fam("The manual call point must be compatible"), "Manual Call Point");
  assert.equal(fam("Strobe units shall be synchronized"), "Strobe");
  assert.equal(fam("Duct detector activation must trigger supervisory alarm"), "Duct Detector");
});

test("negative: master/bare telephone never resolves (KX-AT7730 collision)", () => {
  assert.equal(fam("The control panel shall include a master telephone"), null);
  assert.equal(fam("Approved vendor list includes telephone equipment"), null);
  // R5: "speaker circuits" is supporting scope (wiring/circuit supervision), not the Speaker device.
  assert.equal(fam("Speaker or telephone circuits may be open"), null);
});

test("negative: interface nouns never become Interface Module", () => {
  for (const text of [
    "Control of HVAC equipment and smoke exhaust fans",
    "Signals to elevators with all required accessories",
    "interface with BMS system for proper operation",
    "The telephone system should be distributed across the network",
    "Where required by plans, remote fire telephones are to be provided",
  ]) assert.ok(!["Interface Module", "Monitor Module", "Control Module"].includes(fam(text)), text);
});

test("negative: door contact never becomes Monitor Module", () => {
  assert.equal(fam("Door contact with supervised input for interfacing"), null);
});

test("negative: cable/conduit stay out of product families", () => {
  assert.equal(fam("Use fire-resistant cables for analogue loop circuits"), null);
  assert.equal(fam("All wiring shall be installed in conduit"), null);
});

test("negative: bare batteries/charger stay unresolved (system context)", () => {
  assert.equal(fam("System batteries must be supervised for maintenance"), null);
  assert.equal(fam("Automatic chargers must fully recharge batteries within 48 hours"), null);
});

test("negative: horn alone and notification-appliance alone stay unresolved", () => {
  assert.equal(fam("horn alone in the corridor"), null);
  assert.equal(fam("Activation of the corridor notification appliance circuit"), null);
});

test("negative: bare detectors and vendor names stay unresolved", () => {
  assert.equal(fam("The detector must connect to the local control unit"), null);
  assert.equal(fam("Smoke detectors (above ceiling)"), null);
  assert.equal(fam("Approved vendor list: Honeywell – U.S.A."), null);
  // R5: the panels are REFERENCED equipment ("between X and Y"); the specified item is the network
  // communication, so the referenced FACP must not steal the requirement's family identity.
  assert.equal(fam("Network communication between MFACP and FACP should be supervised"), null);
  assert.equal(fam("The Fire Alarm Control Panel (FACP) shall supervise the network"), "Fire Alarm Control Panel");
});

test("KNOWN_REQUIREMENT_FAMILY_GAPS records evaluated rejections", () => {
  assert.ok(Array.isArray(KNOWN_REQUIREMENT_FAMILY_GAPS));
  assert.ok(KNOWN_REQUIREMENT_FAMILY_GAPS.length >= 8);
  const concepts = KNOWN_REQUIREMENT_FAMILY_GAPS.map((entry) => entry.concept).join(" | ");
  for (const key of ["cable", "conduit", "elevator", "HVAC", "door contact", "telephone", "batteries", "horn", "notification appliance"]) {
    assert.ok(concepts.toLowerCase().includes(key.toLowerCase()), key);
  }
  for (const entry of KNOWN_REQUIREMENT_FAMILY_GAPS) {
    assert.ok(entry.concept && entry.reason && entry.evidence, JSON.stringify(entry));
  }
});
