import test from "node:test";
import assert from "node:assert/strict";
import { classifyEnvironmentalFacts } from "../app/domain/environmental-semantics.mjs";

// P7 envelope semantics: setpoint ≠ envelope ≠ application. No DB, no AI.

const kinds = (text, category = "Other") => classifyEnvironmentalFacts({ text, category }).map((fact) => fact.kind);

test("operating range classifies as envelope with Between operator", () => {
  const out = classifyEnvironmentalFacts({ text: "All Intelligent Control modules operate on 15 – 32 VDC, within 0°C to 60°C, and up to 95% relative humidity." });
  const temp = out.find((fact) => fact.name === "temperature_range");
  assert.equal(temp.kind, "OPERATING_ENVELOPE");
  assert.equal(temp.operator, "Between");
  assert.deepEqual(temp.value, { range: [0, 60], unit: "°C" });
  const hum = out.find((fact) => fact.name === "humidity_range");
  assert.equal(hum.kind, "OPERATING_ENVELOPE");
  assert.equal(hum.operator, "Maximum");
});

test("fixed setpoints never become envelope facts", () => {
  for (const text of [
    "Factory-set fixed temperature at 135°F (57°C)",
    "a high-temperature model provides fixed detection at 190°F (88°C)",
    "Thermal ratings: fixed setpoint at 135°F, rate-of-rise at 15°F per minute",
  ]) {
    const out = classifyEnvironmentalFacts({ text });
    assert.ok(!out.some((fact) => fact.name === "temperature_range"), text);
  }
});

test("135°F fixed setpoint is not operating temperature (core negative)", () => {
  const out = classifyEnvironmentalFacts({ text: "fixed temperature = 135°F" });
  assert.deepEqual(out.filter((fact) => fact.kind === "OPERATING_ENVELOPE"), []);
});

test("190°F detector setpoint is not ambient project temperature", () => {
  const out = classifyEnvironmentalFacts({ text: "190°F high temperature detector for hot areas" });
  assert.ok(!out.some((fact) => fact.kind === "APPLICATION_ENVIRONMENT"), "no application row without site wording");
});

test("site ambient wording classifies application without persisting", () => {
  const out = classifyEnvironmentalFacts({ text: "Equipment installed outdoors shall operate in site ambient temperatures" });
  const app = out.filter((fact) => fact.kind === "APPLICATION_ENVIRONMENT");
  assert.ok(app.length > 0);
  assert.ok(app.every((fact) => fact.name === null), "application facts carry no persistable attribute");
});

test("bare percentages and discounts are not humidity", () => {
  assert.deepEqual(kinds("rated with a 20% margin"), []);
  assert.deepEqual(kinds("95% discount for bulk order"), []);
  assert.deepEqual(kinds("80% efficiency rating"), []);
});

test("relationship-less temperature mentions stay unresolved", () => {
  assert.deepEqual(kinds("variations in temperature, humidity, or barometric pressure"), []);
});

test("unit-less ranges stay unresolved", () => {
  assert.deepEqual(kinds("from 12 to 200 with appropriate protection"), []);
});
