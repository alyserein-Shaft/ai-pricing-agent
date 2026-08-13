import test from "node:test";
import assert from "node:assert/strict";

import {
  BOQ_UNDERSTANDING_RESPONSE_SCHEMA,
  buildBoqUnderstandingPrompt,
  prepareBoqUnderstandingInput,
  validateAndMergeBoqInterpretation,
} from "../app/domain/boq-understanding-engine.mjs";

test("compact provider schema declares all provenance states without verbose conditionals", () => {
  const fact = BOQ_UNDERSTANDING_RESPONSE_SCHEMA.$defs.evidenceFact;
  assert.deepEqual(fact.properties.origin.enum, ["EXTRACTED", "INFERRED", "MISSING", "NOT_APPLICABLE"]);
  assert.deepEqual(BOQ_UNDERSTANDING_RESPONSE_SCHEMA.required, ["normalizedDescription", "confidence"]);
  assert.equal(JSON.stringify(BOQ_UNDERSTANDING_RESPONSE_SCHEMA).length < 4000, true);
});

test("application validator still fails closed for non-null MISSING scalar values", () => {
  const input = prepareBoqUnderstandingInput({
    boqItemId: "boq-contract-1",
    description: "Smoke detectors above ceiling",
    numericQuantity: 10,
    normalizedUnit: "Each",
    system: "Fire Alarm",
  });

  assert.throws(
    () =>
      validateAndMergeBoqInterpretation(input, {
        normalizedDescription: {
          value: "invented text",
          origin: "MISSING",
          confidence: 0,
        },
        confidence: "LOW",
      }),
    /violates the MISSING contract/,
  );
});

test("missingInformation labels must not masquerade as MISSING evidence values", () => {
  const input = prepareBoqUnderstandingInput({
    boqItemId: "boq-contract-2",
    description: "Smoke detectors above ceiling",
    numericQuantity: 10,
    normalizedUnit: "Each",
    system: "Fire Alarm",
  });

  assert.throws(
    () =>
      validateAndMergeBoqInterpretation(input, {
        normalizedDescription: { value: "Smoke detectors above ceiling", origin: "EXTRACTED", confidence: 100 },
        missingInformation: [
          {
            value: "Operating voltage",
            origin: "MISSING",
            confidence: 0,
          },
        ],
        confidence: "LOW",
      }),
    /violates the MISSING contract/,
  );
});

test("prompt explicitly teaches the model the strict MISSING contract", () => {
  const input = prepareBoqUnderstandingInput({
    boqItemId: "boq-contract-3",
    description: "Smoke detector",
  });

  const prompt = buildBoqUnderstandingPrompt(input);

  assert.match(
    prompt.system,
    /MISSING means.*null value and 0 confidence/,
  );

  assert.match(
    prompt.system,
    /missingInformation.*origin INFERRED/,
  );
  assert.match(prompt.system, /NOT_APPLICABLE means the field genuinely does not apply/);
  assert.match(prompt.system, /system, category, equipmentType, and productFamily must never be NOT_APPLICABLE/);
  assert.match(prompt.system, /otherwise use MISSING without inventing a value/);
});

test("normalized description cannot be missing or not applicable for a BOQ item", () => {
  const input = prepareBoqUnderstandingInput({ boqItemId: "boq-contract-4", description: "Device" });
  for (const origin of ["MISSING", "NOT_APPLICABLE"]) {
    assert.throws(() => validateAndMergeBoqInterpretation(input, {
      normalizedDescription: { value: null, origin, confidence: origin === "MISSING" ? 0 : 100 }, confidence: "LOW",
    }), /normalizedDescription must be a supported non-null value/);
  }
});
