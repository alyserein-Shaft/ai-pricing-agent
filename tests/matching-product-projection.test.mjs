import test from "node:test";
import assert from "node:assert/strict";

import {
  mergeMatchingProductAttributes,
  projectModernProductAttribute,
} from "../app/domain/matching-product-projection.mjs";

test("modern Product Knowledge overrides legacy attribute with same canonical name", () => {
  const attributes = mergeMatchingProductAttributes({
    legacyAttributes: [
      { name: "ecs_capability", value: "Legacy ECS" },
      { name: "color", value: "Red" },
    ],
    modernAttributes: [
      {
        attribute_name: "ecs_capability",
        normalized_value: "ECS Capable",
        original_value: "Emergency Communication System",
        unit: null,
        confidence: 96,
        review_status: "Needs Review",
        source_id: "source_manual",
        evidence_json: '{"page":10}',
      },
    ],
  });

  assert.equal(attributes.length, 2);

  const ecs = attributes.find((entry) => entry.name === "ecs_capability");
  assert.equal(ecs.normalizedValue, "ECS Capable");
  assert.equal(ecs.knowledgeRepresentation, "product_attributes");

  const color = attributes.find((entry) => entry.name === "color");
  assert.equal(color.value, "Red");
  assert.equal(color.knowledgeRepresentation, "legacy_library_product");
});

test("legacy-only Product Knowledge remains available as fallback", () => {
  const attributes = mergeMatchingProductAttributes({
    legacyAttributes: [
      { name: "native_slc_loops", value: 1 },
      { name: "max_system_points", value: 2100 },
    ],
    modernAttributes: [],
  });

  assert.equal(attributes.length, 2);
  assert.equal(attributes[0].value, 1);
  assert.equal(attributes[1].value, 2100);
});

test("newest modern row wins when caller supplies modern rows newest-first", () => {
  const attributes = mergeMatchingProductAttributes({
    legacyAttributes: [],
    modernAttributes: [
      {
        attribute_name: "ecs_capability",
        normalized_value: "ECS Capable",
        original_value: "new",
        evidence_json: "{}",
      },
      {
        attribute_name: "ecs_capability",
        normalized_value: "OLD",
        original_value: "old",
        evidence_json: "{}",
      },
    ],
  });

  assert.equal(attributes.length, 1);
  assert.equal(attributes[0].normalizedValue, "ECS Capable");
  assert.equal(attributes[0].originalValue, "new");
});

test("numeric JSON normalized_value stays numeric for matching comparisons", () => {
  const projected = projectModernProductAttribute({
    attribute_name: "relay_count",
    normalized_value: "6",
    original_value: "6",
    value_json: '{"normalized":6}',
    confidence: 95,
    evidence_json: "{}",
  });

  assert.equal(projected.normalizedValue, 6);
  assert.equal(typeof projected.normalizedValue, "number");
});

test("plain text normalized_value remains plain text", () => {
  const projected = projectModernProductAttribute({
    attribute_name: "ecs_capability",
    normalized_value: "ECS Capable",
    original_value: "Emergency Communication System",
    confidence: 96,
    evidence_json: "{}",
  });

  assert.equal(projected.normalizedValue, "ECS Capable");
});
