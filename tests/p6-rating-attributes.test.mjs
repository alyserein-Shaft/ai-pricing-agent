import test from "node:test";
import assert from "node:assert/strict";
import { extractAttributes } from "../app/domain/specification-extractor.mjs";

// P6 numeric ratings: verbatim, self-identifying units/contexts only.

const names = (text) => extractAttributes(text).map((entry) => `${entry.name}=${entry.normalizedValue}`);

test("positive: dBA ratings captured (unit self-identifies)", () => {
  // R1: a two-sided bound is ONE Between fact [lo, hi], never two scalar/Excludes rows.
  assert.deepEqual(names("The sound output shall not fall below 65 dBA nor exceed 110 dBA overall."), ["sound_output=65,110"]);
  assert.deepEqual(names("Exterior horns must provide a minimum sound level of 85 dBA measured 10 feet away."), ["sound_output=85 dBA"]);
});

test("positive: candela with explicit cd unit captured (alternatives stay unresolved)", () => {
  assert.deepEqual(names("Strobe shall be 15/75 cd."), ["candela_rating=15/75 cd"]);
  // R1: alternative option sets are not simultaneous Equals facts.
  assert.deepEqual(names("dual settings of either 15/75 cd or 30/120 cd"), []);
});

test("positive: humidity with noun captured", () => {
  assert.deepEqual(names("Relative Humidity: Up to 95%, continuous, non-condensing"), ["humidity_range=95%"]);
  assert.equal(extractAttributes("Relative Humidity: Up to 95%, continuous, non-condensing")[0].operator, "Maximum", "R1: 'up to' is a maximum, not Equals");
});

test("positive: AH capacities and standby hours captured", () => {
  // R1: a capability range is not a battery's own capacity.
  assert.deepEqual(names("handle battery capacities from 12 to 200 amp hours"), []);
  assert.deepEqual(names("rated for 24 hours of operation after mains failure"), ["battery_autonomy=24 hours"]);
});

test("negative: bare percent without humidity noun is not humidity", () => {
  assert.deepEqual(names("rated with a 20% margin"), []);
  assert.deepEqual(names("recharge batteries to 100% capacity within 48 hours"), []);
});

test("negative: unit-less candela options stay unresolved", () => {
  assert.deepEqual(names("field-selectable candela options of 15, 30, 60"), []);
});

test("negative: contact ratings stay on Voltage (no duplicate rows)", () => {
  assert.deepEqual(names("The contacts must support 2 amps at 24 volts DC"), ["Voltage=24"]);
  assert.deepEqual(names("relay contacts must support up to 1 amp/30 VDC"), ["Voltage=30"]);
});

test("negative: dB without A-weighting is not sound_output", () => {
  assert.deepEqual(names("separated by a minimum of 4 dB in the range"), []);
});

test("negative: operating ranges still route to Temperature, not setpoints", () => {
  assert.deepEqual(names("operate on 15 – 32 VDC, within 0°C to 60°C"), ["Voltage=32", "Temperature=0,60"]);
});
