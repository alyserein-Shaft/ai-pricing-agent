import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyBomComponents, selectBomDecisionQuestion, deriveBomReadiness, deriveComponentQuantity, primaryQuantityRecord } from "../app/domain/bom-component-model.mjs";

const FIRE_ALARM = "Fire Alarm";

test("Addressable Smoke Detector -- a single unconditional Compatible Base is classified REQUIRED via the base-architecture registry signal, quantity derives 1:1", () => {
  const components = classifyBomComponents({
    system: FIRE_ALARM, primaryFamily: "Addressable Smoke Detector", primaryQuantity: 230,
    accessories: [{ relationshipType: "Compatible Base", accessoryProductId: "p-base-501", accessoryPartNumber: "B501-IV", quantityRule: "One per detector", quantityParameter: 1, conditions: [] }],
  });
  assert.equal(components.length, 1);
  assert.equal(components[0].role, "REQUIRED_COMPONENT");
  assert.equal(components[0].quantity.value, 230);
  assert.equal(components[0].quantity.origin, "DERIVED_FROM_PRIMARY_QUANTITY");
  assert.equal(components[0].quantity.derivationRule, "One per detector");
  assert.equal(deriveBomReadiness({ hasPrimaryProduct: true, components, hasOpenQuestion: false }).state, "BOM_READY");
});

test("Smoke Detector with a conditional Sounding Base -- NOT_SATISFIED marks it NOT_APPLICABLE, no decision needed, no false resolve", () => {
  const components = classifyBomComponents({
    system: FIRE_ALARM, primaryFamily: "Addressable Smoke Detector", primaryQuantity: 50,
    accessories: [
      { relationshipType: "Compatible Base", accessoryProductId: "p-base-501", accessoryPartNumber: "B501-IV", quantityRule: "One per detector", quantityParameter: 1, conditions: [] },
      { relationshipType: "Sounding Base", accessoryProductId: "p-base-200s", accessoryPartNumber: "B200S-IV", quantityRule: "One per detector, only when the sounder condition applies", quantityParameter: 1, conditions: [{ attribute: "notification_feature", operator: "equals", value: "Sounder Required" }] },
    ],
    approvedFacts: [{ attribute: "notification_feature", value: "No Sounder", source: "Approved BOQ Understanding" }],
  });
  const base = components.find((c) => c.accessoryPartNumber === "B501-IV");
  const sounder = components.find((c) => c.accessoryPartNumber === "B200S-IV");
  assert.equal(base.role, "REQUIRED_COMPONENT");
  assert.equal(sounder.role, "NOT_APPLICABLE");
  assert.equal(sounder.decisionNeeded, false);
  assert.equal(selectBomDecisionQuestion(components), null);
  assert.equal(deriveBomReadiness({ hasPrimaryProduct: true, components, hasOpenQuestion: false }).state, "BOM_READY");
});

test("Smoke Detector with a conditional Sounding Base -- SATISFIED includes it as CONDITIONAL_COMPONENT with a derived quantity", () => {
  const components = classifyBomComponents({
    system: FIRE_ALARM, primaryFamily: "Addressable Smoke Detector", primaryQuantity: 12,
    accessories: [
      { relationshipType: "Sounding Base", accessoryProductId: "p-base-200s", accessoryPartNumber: "B200S-IV", quantityRule: "One per detector", quantityParameter: 1, conditions: [{ attribute: "notification_feature", operator: "equals", value: "Sounder Required" }] },
    ],
    approvedFacts: [{ attribute: "notification_feature", value: "Sounder Required", source: "Approved BOQ Understanding" }],
  });
  assert.equal(components[0].role, "CONDITIONAL_COMPONENT");
  assert.equal(components[0].applicability.applicable, true);
  assert.equal(components[0].quantity.value, 12);
});

test("Smoke Detector with an UNKNOWN sounder condition -- exposes a precise BOM decision, never fabricates an answer", () => {
  const components = classifyBomComponents({
    system: FIRE_ALARM, primaryFamily: "Addressable Smoke Detector", primaryQuantity: 12,
    accessories: [{ relationshipType: "Sounding Base", accessoryProductId: "p-base-200s", accessoryPartNumber: "B200S-IV", quantityRule: "One per detector", quantityParameter: 1, conditions: [{ attribute: "notification_feature", operator: "equals", value: "Sounder Required" }] }],
    approvedFacts: [],
  });
  const question = selectBomDecisionQuestion(components);
  assert.equal(question.kind, "ATTRIBUTE_ANSWER");
  assert.equal(question.attributeName, "notification_feature");
  assert.match(question.question, /Sounding base/i);
  assert.equal(deriveBomReadiness({ hasPrimaryProduct: true, components, hasOpenQuestion: true }).state, "BOM_DECISION_REQUIRED");
});

test("Heat Detector with multiple compatible base choices -- an ambiguous required slot exposes a controlled-choice decision, never a fabricated preference", () => {
  const components = classifyBomComponents({
    system: FIRE_ALARM, primaryFamily: "Addressable Heat Detector", primaryQuantity: 40,
    accessories: [
      { relationshipType: "Compatible Base", accessoryProductId: "p-b501", accessoryPartNumber: "B501-IV", quantityRule: "One per detector", quantityParameter: 1, conditions: [] },
      { relationshipType: "Compatible Base", accessoryProductId: "p-b224rb", accessoryPartNumber: "B224RB-IV", quantityRule: "One per detector", quantityParameter: 1, conditions: [] },
      { relationshipType: "Compatible Base", accessoryProductId: "p-b224bi", accessoryPartNumber: "B224BI-IV", quantityRule: "One per detector", quantityParameter: 1, conditions: [] },
    ],
  });
  assert.ok(components.every((c) => c.role === "COMPATIBLE_ALTERNATIVE"));
  const question = selectBomDecisionQuestion(components);
  assert.equal(question.kind, "ACCESSORY_SELECTION");
  assert.equal(question.options.length, 3);
  assert.equal(deriveBomReadiness({ hasPrimaryProduct: true, components, hasOpenQuestion: true }).state, "BOM_DECISION_REQUIRED");
});

test("after an engineer selects one alternative, that one becomes REQUIRED and the others become NOT_APPLICABLE -- no open question remains", () => {
  const components = classifyBomComponents({
    system: FIRE_ALARM, primaryFamily: "Addressable Heat Detector", primaryQuantity: 40,
    accessories: [
      { relationshipType: "Compatible Base", accessoryProductId: "p-b501", accessoryPartNumber: "B501-IV", quantityRule: "One per detector", quantityParameter: 1, conditions: [] },
      { relationshipType: "Compatible Base", accessoryProductId: "p-b224rb", accessoryPartNumber: "B224RB-IV", quantityRule: "One per detector", quantityParameter: 1, conditions: [] },
    ],
    selections: { "Compatible Base": { accessoryProductId: "p-b501" } },
  });
  const selected = components.find((c) => c.accessoryProductId === "p-b501");
  const other = components.find((c) => c.accessoryProductId === "p-b224rb");
  assert.equal(selected.role, "REQUIRED_COMPONENT");
  assert.equal(selected.engineerSelected, true);
  assert.equal(other.role, "NOT_APPLICABLE");
  assert.equal(selectBomDecisionQuestion(components), null);
  assert.equal(deriveBomReadiness({ hasPrimaryProduct: true, components, hasOpenQuestion: false }).state, "BOM_READY");
});

test("a product with no accessory relationships at all -- BOM is trivially ready, never NOT_APPLICABLE", () => {
  const components = classifyBomComponents({ system: FIRE_ALARM, primaryFamily: "Beam Detector", primaryQuantity: 6, accessories: [] });
  assert.deepEqual(components, []);
  assert.equal(deriveBomReadiness({ hasPrimaryProduct: true, components, hasOpenQuestion: false }).state, "BOM_READY");
});

test("no primary product yet -- BOM is not applicable, independent of any accessory data", () => {
  assert.equal(deriveBomReadiness({ hasPrimaryProduct: false, components: [], hasOpenQuestion: false }).state, "BOM_NOT_APPLICABLE");
});

test("a capacity-dependent relationship never derives a fabricated quantity (shared/grouped equipment protection)", () => {
  const quantity = deriveComponentQuantity({ relationshipType: "Expansion Module", quantityRule: "CAPACITY_DEPENDENT -- not calculated by this system", quantityParameter: null }, 500);
  assert.equal(quantity.value, null);
  assert.equal(quantity.origin, null);
});

test("primaryQuantityRecord preserves CLIENT_BOQ origin and unit", () => {
  const record = primaryQuantityRecord({ value: 230, unit: "Each" });
  assert.deepEqual(record, { value: 230, unit: "Each", origin: "CLIENT_BOQ", derivationRule: null, source: "Original BOQ evidence", confidence: null });
});

test("a required-worded relationship with a genuine condition still surfaces as a decision when unresolved, not silently required", () => {
  const components = classifyBomComponents({
    system: FIRE_ALARM, primaryFamily: "Monitor Module", primaryQuantity: 5,
    accessories: [{ relationshipType: "Required Test Coil", accessoryProductId: "p-coil", accessoryPartNumber: "TC-1", quantityRule: "One per detector", quantityParameter: 1, conditions: [{ attribute: "detector_head_type", operator: "equals", value: "Ionization" }] }],
    approvedFacts: [],
  });
  assert.equal(components[0].role, "CONDITIONAL_COMPONENT");
  assert.equal(components[0].decisionNeeded, true);
});
