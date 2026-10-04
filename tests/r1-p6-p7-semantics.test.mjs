import test from "node:test";
import assert from "node:assert/strict";
import { extractAttributes } from "../app/domain/specification-extractor.mjs";
import { classifyEnvironmentalFacts, extractHumidityFacts, extractTemperatureRangeFacts, FIXED_TEMPERATURE_SETPOINT_PATTERN } from "../app/domain/environmental-semantics.mjs";
import { extractSoundFacts, ratingOperator } from "../app/domain/rating-semantics.mjs";

// R1 -- independent closure audit repair for P6/P7 extraction semantics.
// Rule under test: NO FALSE ENGINEERING FACTS. Every fixture below is a
// defect the closure audit proved from the live extractor or the runtime DB.
// Pure functions only: no DB, no AI.

const RATING_NAMES = new Set(["sound_output", "candela_rating", "humidity_range", "battery_capacity", "battery_autonomy"]);
const facts = (text) => extractAttributes(text).map((entry) => `${entry.name}|${entry.operator}|${JSON.stringify(entry.normalizedValue)}`);
const ofName = (text, name) => extractAttributes(text).filter((entry) => entry.name === name);
const env = (text) => classifyEnvironmentalFacts({ text });
const envelope = (text, name) => env(text).filter((fact) => fact.kind === "OPERATING_ENVELOPE" && fact.name === name);

// ---- A. sound output ---------------------------------------------------------
test("1. '15 dBA above ambient' is a relative delta, never absolute sound_output 15 dBA", () => {
  assert.deepEqual(ofName("The horn shall deliver a rated sound output at least 15 dBA above ambient noise levels.", "sound_output"), []);
  assert.deepEqual(ofName("Sound level of 15 dBA above ambient sound level.", "sound_output"), []);
});

test("2. '5 dBA above maximum ambient' is a relative delta, never absolute sound_output 5 dBA", () => {
  assert.deepEqual(ofName("no more than 5 dBA above the maximum ambient noise level in public and common areas.", "sound_output"), []);
  // the real requirement_249 sentence (both deltas) yields no sound_output at all
  const req249 = "Each horn shall feature a multi-tone switching capability, allowing selection of different tones within the device, continuous, intermittent, or siren, delivering a rated sound output at least 15 dBA above ambient noise levels, or no more than 5 dBA above the maximum ambient noise level in public and common areas.";
  assert.deepEqual(ofName(req249, "sound_output"), []);
});

test("ambient noise itself (site condition) is not the product's sound output", () => {
  assert.deepEqual(ofName("Provide strobes in areas that have an average ambient noise level exceeding 95 dBA.", "sound_output"), []);
});

test("3. 'not below 65 dBA nor exceed 110 dBA' is ONE bounded fact [65,110], never two Excludes rows", () => {
  const rows = ofName("The sound output shall not fall below 65 dBA nor exceed 110 dBA overall.", "sound_output");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].operator, "Between");
  assert.deepEqual(rows[0].parsedValue, [65, 110]);
  assert.deepEqual(rows[0].normalizedValue, [65, 110]);
  assert.equal(rows[0].normalizedUnit, "dBA");
  const combined = ofName("Provide notification appliances to achieve 15 dBA above ambient sound level, but not less than 65 dBA nor more than 110 dBA in all occupiable spaces.", "sound_output");
  assert.equal(combined.length, 1, "relative delta dropped, bounds kept");
  assert.deepEqual(combined[0].normalizedValue, [65, 110]);
});

test("4. '89 - 99 dBA' is a range, never Minimum 99", () => {
  const rows = ofName("Interior horns should offer selectable sound levels with at least two settings separated by a minimum of 4 dB in the 89 – 99 dBA range, measured 10 feet away on axis.", "sound_output");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].operator, "Between");
  assert.deepEqual(rows[0].normalizedValue, [89, 99]);
  assert.ok(!rows.some((row) => row.operator === "Minimum"));
});

test("scalar sound limits keep correct operators; a negated limit never becomes Excludes", () => {
  assert.deepEqual(facts("the audible alarm must achieve a minimum of 75 dBA at pillow level."), ['sound_output|Minimum|"75 dBA"']);
  assert.deepEqual(facts("Exterior horns must provide a minimum sound level of 85 dBA measured 10 feet away."), ['sound_output|Minimum|"85 dBA"']);
  assert.deepEqual(facts("The overall fan noise shall not exceed 35dBA measured at 1m."), ['sound_output|Maximum|"35 dBA"']);
  assert.deepEqual(facts("separated by a minimum of 4 dB in the range"), []);
});

// ---- B. candela option sets --------------------------------------------------
test("candela alternatives are never persisted as simultaneous Equals facts", () => {
  assert.deepEqual(ofName("dual settings of either 15/75 cd or 30/120 cd", "candela_rating"), []);
  assert.deepEqual(ofName("The candela output must be selectable on-site, with dual settings of either 15/75 cd or 30/120 cd.", "candela_rating"), []);
});

test("a single explicit candela statement is still captured", () => {
  assert.deepEqual(facts("Strobe shall be 15/75 cd."), ['candela_rating|Equals|"15/75 cd"']);
  assert.deepEqual(ofName("field-selectable candela options of 15, 30, 60", "candela_rating"), []);
});

// ---- C. battery capacity -----------------------------------------------------
test("5. '12 to 200 amp hours' is a capability range, never battery_capacity Equals 200 AH", () => {
  assert.deepEqual(ofName("The unit is equipped with an integrated charger designed to handle battery capacities from 12 to 200 amp hours.", "battery_capacity"), []);
  assert.deepEqual(ofName("Battery capacity of 12 AH to 26 AH.", "battery_capacity"), []);
  assert.deepEqual(ofName("Battery capacity 12 to 26 AH.", "battery_capacity"), []);
  assert.deepEqual(ofName("Charger shall support batteries up to 200 amp hours.", "battery_capacity"), []);
});

test("a plain battery capacity and autonomy are still captured", () => {
  assert.deepEqual(facts("Battery shall be 12 AH sealed lead acid; 24 hours of standby."), ['battery_capacity|Equals|"12 AH"', 'battery_autonomy|Equals|"24 hours"']);
  assert.deepEqual(facts("Battery backups must provide at least 24 hours of supervisory operation followed by 30 minutes of alarm."), ['battery_autonomy|Minimum|"24 hours"']);
});

// ---- D. humidity -------------------------------------------------------------
test("6. 'up to 95% RH' is a maximum, never Equals 95%", () => {
  for (const text of ["Relative Humidity: Up to 95%, continuous, non-condensing", "operate in up to 95% relative humidity", "Humidity: up to 95%", "up to 95% RH"]) {
    const rows = ofName(text, "humidity_range");
    assert.equal(rows.length, 1, text);
    assert.equal(rows[0].operator, "Maximum", text);
    assert.equal(rows[0].normalizedValue, "95%", text);
  }
  const fact = envelope("operate in up to 95% relative humidity", "humidity_range")[0];
  assert.equal(fact.operator, "Maximum");
  assert.deepEqual(fact.value, { limit: 95, unit: "%" });
});

test("7. '10% to 93% RH' is ONE coherent range [10,93]", () => {
  for (const text of ["operate between 10% and 93% relative humidity", "10% to 93% relative humidity", "Relative humidity 10 to 93%.", "Relative humidity: 10% - 93%, non-condensing"]) {
    const rows = ofName(text, "humidity_range");
    assert.equal(rows.length, 1, text);
    assert.equal(rows[0].operator, "Between", text);
    assert.deepEqual(rows[0].normalizedValue, [10, 93], text);
    const p7 = envelope(text, "humidity_range");
    assert.equal(p7.length, 1, `${text}: exactly one P7 fact, not two single-limit rows`);
    assert.equal(p7[0].operator, "Between");
    assert.deepEqual(p7[0].value, { range: [10, 93], unit: "%" });
  }
});

test("humidity qualifiers are preserved on the classified fact", () => {
  assert.deepEqual(envelope("Relative Humidity: Up to 95%, continuous, non-condensing", "humidity_range")[0].qualifiers, ["non-condensing"]);
});

test("8. 'humidity sensor accuracy within 5%' is sensor accuracy, not a humidity envelope", () => {
  for (const text of ["The humidity sensor accuracy shall be within 5%.", "Ambient humidity accuracy of 5%", "humidity accuracy of ±2%", "Humidity sensor tolerance 3%", "humidity measurement error 5%"]) {
    assert.deepEqual(ofName(text, "humidity_range"), [], text);
    assert.deepEqual(envelope(text, "humidity_range"), [], text);
  }
});

test("9. '20% margin' is not humidity", () => {
  assert.deepEqual(facts("rated with a 20% margin"), []);
  assert.deepEqual(env("rated with a 20% margin"), []);
});

test("10. discount / efficiency / capacity percentages are never humidity", () => {
  for (const text of ["80% efficiency rating", "95% discount for bulk order", "recharge batteries to 100% capacity within 48 hours", "humidity discount of 10%"]) {
    assert.deepEqual(ofName(text, "humidity_range"), [], text);
    assert.deepEqual(envelope(text, "humidity_range"), [], text);
  }
});

test("a cue-less humidity percentage is ambiguous (limit vs nominal) and stays unresolved", () => {
  assert.deepEqual(ofName("humidity 50%", "humidity_range"), []);
  assert.deepEqual(ofName("The relative humidity is 50%", "humidity_range"), []);
});

test("P6 extractor and P7 classifier share one humidity parser (no semantic drift)", () => {
  for (const text of ["up to 95% relative humidity", "10% to 93% RH", "Humidity: at least 10%", "humidity sensor accuracy within 5%"]) {
    const shared = extractHumidityFacts(text).map((fact) => `${fact.operator}|${JSON.stringify(fact.range ?? fact.value)}`);
    const p6 = ofName(text, "humidity_range").map((row) => `${row.operator}|${JSON.stringify(row.parsedValue ?? Number(String(row.normalizedValue).replace("%", "")))}`);
    const p7 = envelope(text, "humidity_range").map((fact) => `${fact.operator}|${JSON.stringify(fact.value.range ?? fact.value.limit)}`);
    assert.deepEqual(p6, shared, text);
    assert.deepEqual(p7, shared, text);
  }
});

// ---- E. temperature range safety ---------------------------------------------
test("11. '32°F to 120°C' is never silently stored as [32,120] °F", () => {
  const out = env("Operating range 32°F to 120°C");
  assert.ok(!out.some((fact) => fact.kind === "OPERATING_ENVELOPE"), "no envelope row");
  const unresolved = out.find((fact) => fact.kind === "UNRESOLVED");
  assert.ok(unresolved);
  assert.equal(unresolved.basis, "MIXED_UNIT_ENDPOINTS");
  assert.equal(unresolved.name, null);
  assert.equal(unresolved.value, null);
  assert.deepEqual(ofName("Operating range 32°F to 120°C", "Temperature"), []);
  assert.equal(extractTemperatureRangeFacts("32°F to 120°C")[0].mixedUnits, true);
});

test("12. signed endpoints (+50°C, -10°C) are handled, never dropped", () => {
  assert.deepEqual(envelope("Operating temperature: -20°C to +50°C", "temperature_range")[0].value, { range: [-20, 50], unit: "°C" });
  assert.deepEqual(envelope("Operating temperature -10°C to 55°C", "temperature_range")[0].value, { range: [-10, 55], unit: "°C" });
  assert.deepEqual(envelope("Operating ambient +5°C to +50°C", "temperature_range")[0].value, { range: [5, 50], unit: "°C" });
  assert.deepEqual(envelope("Operating range −10°C to +50°C", "temperature_range")[0].value, { range: [-10, 50], unit: "°C" });
  assert.deepEqual(ofName("ambient temperature range of +10°C to +40°C", "Temperature").map((row) => row.normalizedValue), [[10, 40]]);
  assert.deepEqual(ofName("operate from -10°C to +50°C", "Temperature").map((row) => row.normalizedValue), [[-10, 50]]);
});

test("a dash separated from its digits ('- 10° C') never silently loses its sign", () => {
  const text = "temperatures ranging from - 10° C to +65° C";
  assert.deepEqual(extractTemperatureRangeFacts(text), []);
  assert.deepEqual(ofName(text, "Temperature"), []);
  assert.deepEqual(envelope(`operating ${text}`, "temperature_range"), []);
});

test("unit-less endpoints are never given a guessed unit", () => {
  assert.deepEqual(envelope("Operating temperature 0 to 60°C", "temperature_range"), []);
  assert.deepEqual(env("from 12 to 200 with appropriate protection"), []);
});

test("a range beside a fixed setpoint is kept; the setpoint itself is never a range", () => {
  const out = envelope("Detector fixed temperature 190°F; within operating range 0°C-60°C", "temperature_range");
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].value, { range: [0, 60], unit: "°C" });
  assert.deepEqual(env("Factory-set fixed temperature at 135°F (57°C)"), []);
});

// ---- F. P0 fixed-setpoint regression -----------------------------------------
test("13. P0 pattern source is byte-identical to the shipped P0 pattern (single source of truth)", () => {
  const shippedP0 = String.raw`\bfixed(?:[-\s]*temperature)?(?:\s+detection)?\s+(?:at\s+)?(\d+(?:\.\d+)?)\s*°\s*([FC])\b|\bfactory-set\s+fixed\s+temperature\s+at\s+(\d+(?:\.\d+)?)\s*°\s*([FC])\b|\bfixed\s+setpoint\s+(?:at\s+|of\s+)?(\d+(?:\.\d+)?)\s*°\s*([FC])\b`;
  assert.equal(FIXED_TEMPERATURE_SETPOINT_PATTERN.source, shippedP0);
  assert.equal(FIXED_TEMPERATURE_SETPOINT_PATTERN.flags, "gi");
});

test("13. 135°F fixed setpoint, separate 190°F fact, ROR, and the range-is-not-a-setpoint rule", () => {
  assert.deepEqual(facts("Heat detectors shall be fixed temperature at 135°F and rate-of-rise 15°F/min."), ['fixed_temperature_setpoint|Equal|"135°F"', 'rate_of_rise_sensitivity|Equal|"15°F/min"']);
  assert.deepEqual(facts("Heat detector rated fixed temperature 190°F (88°C)."), ['fixed_temperature_setpoint|Equal|"190°F"']);
  assert.deepEqual(ofName("Detector shall operate at ambient temperature 0°C to 60°C.", "fixed_temperature_setpoint"), []);
  assert.deepEqual(ofName("within 0°C to 60°C", "fixed_temperature_setpoint"), []);
});

// ---- G. Golden Requirement 197 -----------------------------------------------
const REQ197 = "Features: a) Sleek, low-profile, and aesthetically pleasing design b) Advanced thermistor technology for rapid response c) Rate-of-rise detection at 15°F (8.3°C) per minute d) Factory-set fixed temperature at 135°F (57°C); high-temperature model at 190°F (88°C) e) Individually addressable devices f) Compatible with Flash Scan® and CLIP protocol systems g) Rotary decimal addressing (range: 1-99 for CLIP systems, 1-159 for Flash Scan systems) h) Two-wire SLC connectivity i) Visible LEDs blink upon each device address cycle j) 360° viewable visual alarm indicators (two bi-color LEDs); green blink indicates normal operation, steady red signals alarm k) Integrated communications and built-in device-type identification l) Remote testing capability via control panel m) Built-in functional test switch, activated by external magnet n) Walk test feature with address display (e.g., address 121 blinks LED as 12- pause-1) o) Low standby current consumption p) Backward compatibility q) Built-in tamper-resistant mechanism r) Suitable for direct surface or electrical box mounting s) Sealed to prevent back pressure t) Modular base system facilitates installation and maintenance; bases support interchangeable photoelectric, ionization, and thermal sensors u) SEMS screws provided for base wiring v) Constructed from off-white, fire-resistant plastic conforming to commercial standards for an attractive finish w) Rated 94-5V for plastic flammability x) Optional sounder, relay, and isolator bases available y) Thermal ratings: fixed setpoint at 135°F (57°C), rate-of-rise at 15°F (8.3°C) per minute, high heat at 190°F (88°C) c.";

test("14. Golden Requirement 197 extraction is unchanged: 135°F, 15°F/min, addressable; no 190°F fact, no rating/environment facts", () => {
  const rows = extractAttributes(REQ197).map((entry) => `${entry.name}|${entry.operator}|${JSON.stringify(entry.normalizedValue)}`);
  assert.deepEqual([...new Set(rows)].sort(), ['addressing|Equal|"Addressable"', 'fixed_temperature_setpoint|Equal|"135°F"', 'rate_of_rise_sensitivity|Equal|"15°F/min"']);
  assert.ok(!rows.some((row) => row.includes("190")), "190°F HT source fact is never attached to the Golden requirement");
  assert.ok(!extractAttributes(REQ197).some((entry) => RATING_NAMES.has(entry.name) || entry.name === "Temperature"));
  assert.deepEqual(env(REQ197), [], "no P7 environmental fact from Golden 197");
});

// ---- invariants over the whole corpus of proven-defect sentences ---------------
test("no rating fact is ever emitted with operator Excludes, and every Between fact is ordered lo <= hi", () => {
  const corpus = [
    "The sound output shall not fall below 65 dBA nor exceed 110 dBA overall.",
    "Alarm shall not be less than 75 dBA and shall not exceed 105 dBA.",
    "Battery shall not be smaller than 12 AH.",
    "The noise must not be 90 dBA.",
    "humidity shall not exceed 95% RH",
    "Sound level of 15 dBA above ambient sound level, but not less than 65 dBA nor more than 110 dBA in all occupiable spaces.",
  ];
  for (const text of corpus) {
    for (const entry of extractAttributes(text).filter((row) => RATING_NAMES.has(row.name))) {
      assert.notEqual(entry.operator, "Excludes", text);
      if (entry.operator === "Between") assert.ok(entry.normalizedValue[0] <= entry.normalizedValue[1], text);
    }
  }
});

test("ratingOperator: bound cues map to bounds, unexplained negation stays unresolved", () => {
  assert.equal(ratingOperator("shall not fall below "), "Minimum");
  assert.equal(ratingOperator(" nor exceed "), "Maximum");
  assert.equal(ratingOperator(" nor more than "), "Maximum");
  assert.equal(ratingOperator("minimum of "), "Minimum");
  assert.equal(ratingOperator("up to "), "Maximum");
  assert.equal(ratingOperator("must not be "), null);
  assert.equal(ratingOperator("rated at "), "Equals");
  assert.equal(ratingOperator("cover the area at "), "Equals", "'cover' must not read as the cue 'over'");
});

test("sound facts carry source spans so a caller can always trace the original text", () => {
  const text = "The sound output shall not fall below 65 dBA nor exceed 110 dBA overall.";
  const [fact] = extractSoundFacts(text);
  assert.equal(fact.originalValue, "65 dBA nor exceed 110 dBA");
  assert.equal(text.slice(fact.index, fact.end), fact.originalValue);
});
