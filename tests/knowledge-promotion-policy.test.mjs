import test from "node:test";
import assert from "node:assert/strict";

import {
  KNOWLEDGE_PROMOTION_POLICY_VERSION,
  normalizeKnowledgeFactForPromotion,
} from "../app/domain/knowledge-promotion-policy.mjs";

test("promotion policy version is explicit", () => {
  assert.equal(
    KNOWLEDGE_PROMOTION_POLICY_VERSION,
    "knowledge-promotion-policy-v2"
  );
});

test("Protocol facts map deterministically to canonical product protocol attributes", () => {
  const cases = [
    ["SLC", "SLC"],
    ["slc", "SLC"],
    ["BACnet", "BACnet"],
    ["bacnet", "BACnet"],
    ["Modbus", "Modbus"],
    ["RS485", "RS-485"],
    ["RS-485", "RS-485"],
    ["rs-232", "RS-232"],
    ["Ethernet", "Ethernet"],
    ["PoE", "PoE"],
    ["poe+", "PoE+"],
    ["PoE++", "PoE++"],
    ["NAC", "NAC"],
    ["CAN bus", "CAN bus"],
    ["canbus", "CAN bus"],
    ["LonWorks", "LonWorks"],
    ["OPC", "OPC"],
  ];

  for (const [input, expected] of cases) {
    const result = normalizeKnowledgeFactForPromotion({
      factType: "Protocol",
      originalValue: input,
      normalizedValue: String(input).toLowerCase(),
    });

    assert.deepEqual(
      result,
      {
        status: "SUPPORTED",
        targetTable: "product_attributes",
        attributeName: "protocol",
        originalValue: input,
        normalizedValue: expected,
        unit: null,
      },
      input
    );
  }
});

test("unsupported Protocol values fail closed instead of being guessed", () => {
  for (const value of ["Unknown", "Proprietary", "SK protocol", "", null]) {
    const result = normalizeKnowledgeFactForPromotion({
      factType: "Protocol",
      originalValue: value,
      normalizedValue: value,
    });

    assert.equal(result.status, "UNSUPPORTED_ATTRIBUTE_VALUE", String(value));
    assert.equal(result.attributeName, "protocol");
  }
});

test("unsupported knowledge fact types cannot enter canonical promotion", () => {
  for (const factType of [
    "Price",
    "Manufacturer",
    "Product Family",
    "Certification",
    "Standard",
    "Operating Voltage",
  ]) {
    const result = normalizeKnowledgeFactForPromotion({
      factType,
      originalValue: "anything",
      normalizedValue: "anything",
    });

    assert.deepEqual(result, {
      status: "UNSUPPORTED_FACT_TYPE",
      factType,
    });
  }
});
