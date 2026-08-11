import test from "node:test";
import assert from "node:assert/strict";

import {
  BOQ_UNDERSTANDING_RESPONSE_SCHEMA,
  buildBoqUnderstandingPrompt,
  prepareBoqUnderstandingInput,
  validateAndMergeBoqInterpretation,
} from "../app/domain/boq-understanding-engine.mjs";

test("provider schema constrains MISSING facts to null and zero confidence", () => {
  const condition =
    BOQ_UNDERSTANDING_RESPONSE_SCHEMA.properties
      .normalizedDescription
      .allOf?.[0];

  assert.ok(condition, "MISSING conditional schema must exist");

  assert.equal(
    condition.if.properties.origin.const,
    "MISSING",
  );

  assert.equal(
    condition.then.properties.value.type,
    "null",
  );

  assert.equal(
    condition.then.properties.confidence.const,
    0,
  );
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
    /MISSING values must be null/,
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
        missingInformation: [
          {
            value: "Operating voltage",
            origin: "MISSING",
            confidence: 0,
          },
        ],
        confidence: "LOW",
      }),
    /MISSING values must be null/,
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
    /whenever origin is MISSING, value MUST be null and confidence MUST be 0/,
  );

  assert.match(
    prompt.system,
    /missingInformation.*origin INFERRED/,
  );
});
