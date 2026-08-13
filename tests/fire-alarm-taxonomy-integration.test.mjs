import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as library from "../app/domain/product-price-library.mjs";
import * as understanding from "../app/domain/boq-understanding-engine.mjs";
import * as requirement from "../app/domain/requirement-intelligence-engine.mjs";
import { FIRE_ALARM_ATTRIBUTE_PROFILES, FIRE_ALARM_TAXONOMY, FIRE_ALARM_TAXONOMY_VERSION, buildFireAlarmTaxonomyContext } from "../app/domain/fire-alarm-taxonomy.mjs";

const fact = (value, origin = "INFERRED", confidence = 85) => ({ value, origin, confidence });
const row = (description) => understanding.prepareBoqUnderstandingInput({ id: "boq-taxonomy-test", rowType: "BOQ Item", description, originalQuantity: 1, originalUnit: "No" });
const validOutput = (overrides = {}) => ({
  normalizedDescription: fact("Addressable optical smoke detector with built-in isolator", "EXTRACTED", 100),
  system: fact("Fire Alarm"), category: fact("Detection Devices"), equipmentType: fact("Addressable optical smoke detector"),
  productFamily: fact("Addressable Smoke Detector"), technicalAttributes: [{ name: "addressing", value: "Addressable", origin: "EXTRACTED", confidence: 100 }],
  confidence: "HIGH", ...overrides,
});

test("all three domains consume the same canonical taxonomy object and version", () => {
  assert.strictEqual(library.FIRE_ALARM_TAXONOMY, FIRE_ALARM_TAXONOMY);
  assert.strictEqual(understanding.FIRE_ALARM_TAXONOMY, FIRE_ALARM_TAXONOMY);
  assert.strictEqual(requirement.FIRE_ALARM_TAXONOMY, FIRE_ALARM_TAXONOMY);
  assert.strictEqual(library.FIRE_ALARM_ATTRIBUTE_PROFILES, FIRE_ALARM_ATTRIBUTE_PROFILES);
  assert.equal(understanding.FIRE_ALARM_TAXONOMY_VERSION, FIRE_ALARM_TAXONOMY_VERSION);
  assert.equal(requirement.FIRE_ALARM_TAXONOMY_VERSION, FIRE_ALARM_TAXONOMY_VERSION);
});

test("candidate taxonomy context is bounded and excludes irrelevant families", () => {
  const context = buildFireAlarmTaxonomyContext({ description: "Addressable optical smoke detector with built-in isolator" });
  assert.ok(context.families.length > 0 && context.families.length <= 6);
  assert.ok(context.attributeNames.length <= 10);
  assert.equal(context.families[0].family, "Addressable Smoke Detector");
  assert.equal(context.families[0].selectionKey, "FA-1");
  assert.deepEqual(context.families.map(({ selectionKey }) => selectionKey), context.families.map((_, index) => `FA-${index + 1}`));
  assert.equal(context.families.some(({ family }) => family === "Fire Alarm Control Panel" || family === "Battery Cabinet"), false);
  assert.ok(JSON.stringify(context).length < 1600);
});

test("valid candidate key maps server-side to canonical inferred system, category and family", () => {
  const result = understanding.validateAndMergeBoqInterpretation(row("Addressable optical smoke detector with built-in isolator"), validOutput({
    taxonomyCandidateKey: fact("FA-1", "EXTRACTED", 100), system: fact(null, "MISSING", 0), category: fact("Detector Things"), productFamily: fact("Paraphrased Optical Sensor"),
  }));
  assert.equal(result.status, "COMPLETED");
  assert.deepEqual(result.interpretation.system, { value: "Fire Alarm", origin: "INFERRED", confidence: 70 });
  assert.deepEqual(result.interpretation.category, { value: "Detection Devices", origin: "INFERRED", confidence: 70 });
  assert.deepEqual(result.interpretation.productFamily, { value: "Addressable Smoke Detector", origin: "INFERRED", confidence: 70 });
  assert.equal(["system", "category", "equipmentType", "productFamily"].some((field) => result.interpretation[field].origin === "MISSING"), false);
  assert.equal("taxonomyCandidateKey" in result.interpretation, false);
});

test("unknown or altered candidate keys fail closed", () => {
  for (const key of ["FA-2", "fa-1", "FA-1-modified"]) {
    const result = understanding.validateAndMergeBoqInterpretation(row("Addressable optical smoke detector"), validOutput({ taxonomyCandidateKey: fact(key) }));
    assert.equal(result.status, "NEEDS_REVIEW");
    assert.equal(result.interpretation.category.origin, "MISSING");
    assert.equal(result.interpretation.productFamily.origin, "MISSING");
    assert.match(result.interpretation.ambiguities[0].value, /candidate selection/i);
  }
});

test("missing candidate key never auto-selects the sole candidate", () => {
  const output = validOutput();
  output.system = fact(null, "MISSING", 0);
  delete output.category;
  delete output.productFamily;
  const result = understanding.validateAndMergeBoqInterpretation(row("Addressable optical smoke detector"), output);
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.equal(result.interpretation.category.origin, "MISSING");
  assert.equal(result.interpretation.productFamily.origin, "MISSING");
  assert.equal(result.interpretation.system.origin, "MISSING");
});

test("existing exact category and family output remains backward compatible", () => {
  const result = understanding.validateAndMergeBoqInterpretation(row("Addressable optical smoke detector"), validOutput());
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.interpretation.category.value, "Detection Devices");
  assert.equal(result.interpretation.productFamily.value, "Addressable Smoke Detector");
});

test("a supplied key cannot select outside the bounded request context", () => {
  const input = row("Addressable optical smoke detector");
  assert.deepEqual(input.taxonomyContext.families.map(({ selectionKey }) => selectionKey), ["FA-1"]);
  const result = understanding.validateAndMergeBoqInterpretation(input, validOutput({ taxonomyCandidateKey: fact("FA-2") }));
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.equal(result.interpretation.system.origin, "MISSING");
  assert.equal(result.interpretation.productFamily.origin, "MISSING");
});

test("duplicate request-local keys cannot classify a row", () => {
  const input = row("Addressable optical smoke detector");
  input.taxonomyContext = { ...input.taxonomyContext, families: [...input.taxonomyContext.families, { ...input.taxonomyContext.families[0] }] };
  const result = understanding.validateAndMergeBoqInterpretation(input, validOutput({ taxonomyCandidateKey: fact("FA-1") }));
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.equal(result.interpretation.productFamily.origin, "MISSING");
});

test("canonical category and family pairing is enforced", () => {
  const result = understanding.validateAndMergeBoqInterpretation(row("Addressable optical smoke detector"), validOutput({ category: fact("Control Equipment") }));
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.equal(result.interpretation.productFamily.origin, "MISSING");
});

test("out-of-taxonomy values cannot pass as completed", () => {
  const result = understanding.validateAndMergeBoqInterpretation(row("Addressable optical smoke detector"), validOutput({ category: fact("AI Devices"), productFamily: fact("Magic Sensor") }));
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.equal(result.interpretation.category.origin, "MISSING");
  assert.equal(result.interpretation.productFamily.origin, "MISSING");
});

test("valid mocked response expands to canonical classification without creating downstream authority", () => {
  const result = understanding.validateAndMergeBoqInterpretation(row("Addressable optical smoke detector with built-in isolator"), validOutput());
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.interpretation.category.value, "Detection Devices");
  assert.equal(result.interpretation.productFamily.value, "Addressable Smoke Detector");
  assert.equal(result.interpretation.productFamily.origin, "INFERRED");
  assert.equal("productId" in result.interpretation, false);
  assert.equal("price" in result.interpretation, false);
  const source = fs.readFileSync(new URL("../app/domain/boq-understanding-engine.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from\s+["'][^"']*(?:product-matching|pricing-engine)[^"']*["']/);
});

test("candidate-key schema and prompt remain compact and explicit", () => {
  const input = row("Addressable optical smoke detector with built-in isolator");
  const prompt = understanding.buildBoqUnderstandingPrompt(input);
  assert.ok("taxonomyCandidateKey" in understanding.BOQ_UNDERSTANDING_RESPONSE_SCHEMA.properties);
  assert.match(prompt.system, /exactly as supplied/i);
  assert.match(prompt.system, /never invent, alter, or paraphrase a key/i);
  assert.ok(JSON.stringify(understanding.BOQ_UNDERSTANDING_RESPONSE_SCHEMA).length < 2300);
  assert.ok(prompt.system.length + prompt.user.length < 3000);
});
