import test from "node:test";
import assert from "node:assert/strict";
import { extractFireAlarmProductAttributes } from "../app/domain/fire-alarm-product-attribute-extraction.mjs";

const attr = (results, name) => results.find((entry) => entry.name === name);

test("action_type is extracted only for Pull Station, from real Dual/Single Action text", () => {
  const dual = extractFireAlarmProductAttributes({ description: "Intelligent Addressable Pull Station, Dual Action, Key Reset", family: "Pull Station" });
  assert.equal(attr(dual, "action_type").value, "Dual Action");
  assert.equal(attr(dual, "action_type").sourceText, "Dual Action");
  const single = extractFireAlarmProductAttributes({ description: "Intelligent Addressable Pull Station, Single Action, Key Reset", family: "Pull Station" });
  assert.equal(attr(single, "action_type").value, "Single Action");
});
test("action_type is never extracted for a family it was not proven against", () => {
  const result = extractFireAlarmProductAttributes({ description: "Manual Call Point, Dual Action variant", family: "Manual Call Point" });
  assert.equal(attr(result, "action_type"), undefined, "action_type is scoped to Pull Station only, per the governed profile added for it");
});

test("relay_count is extracted only for Relay Module, from a real Form C contact count", () => {
  const two = extractFireAlarmProductAttributes({ description: "Intelligent Addressable Relay Module W/ 2 Isolated Sets Of Form C Contacts", family: "Relay Module" });
  assert.equal(attr(two, "relay_count").value, 2);
  const six = extractFireAlarmProductAttributes({ description: "Intelligent Addressable Relay Module W/ 6 Form C Relays", family: "Relay Module" });
  assert.equal(attr(six, "relay_count").value, 6);
});

test("frequency is extracted from a real Hz value on a Sounder Base, not fabricated for one without", () => {
  const lowFreq = extractFireAlarmProductAttributes({ description: "Ivory, Low Frequency Intelligent, programmable sounder base. Produces a fundamental frequency of 520 Hz +/- 10%", family: "Sounder Base" });
  assert.equal(attr(lowFreq, "frequency").value, "520 Hz");
  const noFreq = extractFireAlarmProductAttributes({ description: "Ivory Color, Intelligent addressable sounder base capable of producing sound output in high or low volume with ANSI Temporal 3", family: "Sounder Base" });
  assert.equal(attr(noFreq, "frequency"), undefined, "no Hz value exists in this description -- must not be guessed");
});

test("ecs_capability and color are extracted only for Fire Alarm Control Panel, from real evidence", () => {
  const ecs = extractFireAlarmProductAttributes({ description: "Farenhyt 2100 point Integrated Fire Alarm & Emergency Communication System... Red Cabinet", family: "Fire Alarm Control Panel" });
  assert.equal(attr(ecs, "ecs_capability").value, "ECS Capable");
  assert.equal(attr(ecs, "color").value, "Red");
  const noEcs = extractFireAlarmProductAttributes({ description: "Farenhyt 2100 point Addressable Fire Panel... Black Cabinet", family: "Fire Alarm Control Panel" });
  assert.equal(attr(noEcs, "ecs_capability"), undefined, "this panel's own description never mentions ECS/Emergency Communication -- must not be assumed");
  assert.equal(attr(noEcs, "color").value, "Black");
});

test("device_role=Accessory is extracted from an explicit accessory word, regardless of family, and never guessed from the word 'Lens' alone", () => {
  const lensAccessory = extractFireAlarmProductAttributes({ description: "Wall Strobe Lens Attachment, Green", family: "Strobe" });
  assert.equal(attr(lensAccessory, "device_role").value, "Accessory");
  const cabinetAccessory = extractFireAlarmProductAttributes({ description: "Cabinet Only - Accessories Of IFP-2100 - Black", family: null });
  assert.equal(attr(cabinetAccessory, "device_role").value, "Accessory");
  const plainLens = extractFireAlarmProductAttributes({ description: "Wall Amber Lens", family: "Strobe" });
  assert.equal(attr(plainLens, "device_role"), undefined, "the word 'Lens' alone is not an explicit accessory signal -- only 'Accessory'/'Accessories'/'Attachment' are");
});

test("addressing is extracted from the word 'Addressable' regardless of family", () => {
  const result = extractFireAlarmProductAttributes({ description: "Intelligent Addressable Photoelectric Smoke Detector", family: "Addressable Smoke Detector" });
  assert.equal(attr(result, "addressing").value, "Addressable");
});
test("addressing is not fabricated when the word never appears", () => {
  const result = extractFireAlarmProductAttributes({ description: "4\" standard flangeless mounting base (Ivory Color)", family: "Detector Base" });
  assert.equal(attr(result, "addressing"), undefined);
});

test("no attributes are ever emitted from an empty or missing description", () => {
  assert.deepEqual(extractFireAlarmProductAttributes({ description: "", family: "Pull Station" }), []);
  assert.deepEqual(extractFireAlarmProductAttributes({ description: null, family: "Pull Station" }), []);
});

test("every emitted attribute preserves the exact raw source text it was extracted from", () => {
  const result = extractFireAlarmProductAttributes({ description: "Intelligent Addressable Relay Module W/ 6 Form C Relays", family: "Relay Module" });
  for (const entry of result) {
    assert.ok(entry.sourceText, `${entry.name} must carry sourceText`);
    assert.ok(entry.extractionMethod.includes(entry.name));
    assert.equal(entry.origin, "EXTRACTED");
  }
});

// Sprint 1.3 -- SLC capacity facts, proven against the real IFP-2100HV catalog description.
const IFP_2100HV_DESCRIPTION = "Farenhyt 2100 point Addressable Fire Panel, 4 line LCD display with 40 characters per line,One SLC loop card inbuild, 159 Detectors and 159 Modules per loop, Additional Loop cards can be expanded through 5815RMK (Remote mounting Kit which accomodates 2 SLC Cards (6815)) , Network upto 32 panels, inbuild eight on-board Flexput™ circuits,Built in USB interface for programming,Four programmable function keys, 240VAC @ 50/60Hz, 2.8A , UL Listing and FM Approved, Red Cabinet";

test("native_slc_loops, max_detectors_per_loop, max_modules_per_loop, max_system_points are extracted from the real IFP-2100HV description", () => {
  const result = extractFireAlarmProductAttributes({ description: IFP_2100HV_DESCRIPTION, family: null });
  assert.equal(attr(result, "native_slc_loops").value, 1);
  assert.equal(attr(result, "native_slc_loops").sourceText, "One SLC loop card inbuild");
  assert.equal(attr(result, "max_detectors_per_loop").value, 159);
  assert.equal(attr(result, "max_modules_per_loop").value, 159);
  assert.equal(attr(result, "max_system_points").value, 2100);
  assert.equal(attr(result, "max_system_points").sourceText, "Farenhyt 2100 point");
});

test("max_detectors_per_loop and max_modules_per_loop stay separate -- never summed or conflated", () => {
  const result = extractFireAlarmProductAttributes({ description: IFP_2100HV_DESCRIPTION, family: null });
  assert.notEqual(attr(result, "max_detectors_per_loop").name, attr(result, "max_modules_per_loop").name === undefined);
  const names = result.map((e) => e.name);
  assert.ok(!names.includes("max_combined_devices_per_loop"), "no combined/summed attribute is ever emitted");
  assert.equal(attr(result, "max_detectors_per_loop").value + attr(result, "max_modules_per_loop").value, 318);
  // The sum above is just an arithmetic sanity check on the two SEPARATE
  // values -- nothing in the extractor itself ever computes or stores 318.
});

test("no capacity attribute is fabricated for a product with no capacity evidence in its own description (the real broken 6815/5815RMK catalog text)", () => {
  const result6815 = extractFireAlarmProductAttributes({ description: "006815", family: null });
  const result5815RMK = extractFireAlarmProductAttributes({ description: "005815RMK", family: null });
  for (const result of [result6815, result5815RMK]) {
    assert.equal(attr(result, "native_slc_loops"), undefined);
    assert.equal(attr(result, "max_detectors_per_loop"), undefined);
    assert.equal(attr(result, "max_modules_per_loop"), undefined);
    assert.equal(attr(result, "max_system_points"), undefined);
  }
});

test("max_detectors_per_loop is not extracted from a bare 'per loop' mention without the paired 'Detectors and N Modules' sentence shape", () => {
  const result = extractFireAlarmProductAttributes({ description: "Supports up to 200 devices per loop", family: null });
  assert.equal(attr(result, "max_detectors_per_loop"), undefined);
  assert.equal(attr(result, "max_modules_per_loop"), undefined);
});

test("max_system_points requires the Farenhyt-prefixed point phrase -- an unrelated numeric 'point' mention elsewhere never fires it", () => {
  const result = extractFireAlarmProductAttributes({ description: "Terminal block, 12 point connector", family: null });
  assert.equal(attr(result, "max_system_points"), undefined);
});
