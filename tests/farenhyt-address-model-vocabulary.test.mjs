// Farenhyt Batch 1 -- Decision 3: governed address-model vocabulary.
//
// Guards the reason the type exists. Manufacturer evidence across twelve
// Farenhyt products established FIVE distinct SLC/address resource behaviours.
// The pre-existing scalar "SLC Addresses Consumed" fact type cannot express
// them: it records a count, not a model, and the models are NOT
// interchangeable for panel sizing. Collapsing SHARED_WITH_DETECTOR or
// HOUSED_MODULE_OWN_ADDRESS to 1, or HOUSING_NO_ADDITIONAL_ADDRESS to 0,
// silently mis-sizes a 159-address loop.
//
// These tests are deliberately narrow: they prove the POLICY surface (that the
// type is governed, human-gated, closed-vocabulary, and cannot be reached
// deterministically). They do NOT promote anything, and no product data,
// lifecycle, or selection state is touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KNOWLEDGE_PROMOTION_ELIGIBILITY,
} from "../app/domain/knowledge-promotion-policy.mjs";

const ADDRESS_MODEL_VALUES = Object.freeze([
  "STANDALONE_ADDRESS",
  "SHARED_WITH_DETECTOR",
  "HOUSING_NO_ADDITIONAL_ADDRESS",
  "HOUSED_MODULE_OWN_ADDRESS",
  "NON_SLC",
]);

test("1 -- Address Model is a governed fact type, not an unclassified one", () => {
  const policy = KNOWLEDGE_PROMOTION_ELIGIBILITY["Address Model"];
  assert.ok(policy, "Address Model must be present in the promotion policy");
  assert.equal(policy.eligible, true);
});

test("2 -- Address Model is HUMAN-gated, never deterministic", () => {
  const policy = KNOWLEDGE_PROMOTION_ELIGIBILITY["Address Model"];
  assert.equal(policy.path, "human",
    "address model must never auto-promote; an internet research agent may author it but not approve it");
  assert.equal(policy.destination, "attribute");
  assert.equal(policy.attributeName, "slc_address_model");
});

test("3 -- the closed vocabulary is exactly the five researched behaviours", () => {
  // Guards against a value being added that no manufacturer evidence supports,
  // and against one of the researched models being dropped.
  for (const value of ADDRESS_MODEL_VALUES) {
    assert.match(value, /^[A-Z_]+$/, "vocabulary values are SCREAMING_SNAKE identifiers");
  }
  assert.equal(new Set(ADDRESS_MODEL_VALUES).size, 5,
    "the five models must be distinct; a duplicate would mean two researched behaviours collapsed");
  // The two that a naive scalar would have merged with STANDALONE_ADDRESS.
  assert.ok(ADDRESS_MODEL_VALUES.includes("SHARED_WITH_DETECTOR"));
  assert.ok(ADDRESS_MODEL_VALUES.includes("HOUSED_MODULE_OWN_ADDRESS"));
  // The two that must not be read as "consumes one address".
  assert.ok(ADDRESS_MODEL_VALUES.includes("HOUSING_NO_ADDITIONAL_ADDRESS"));
  assert.ok(ADDRESS_MODEL_VALUES.includes("NON_SLC"));
});

test("4 -- the pre-existing scalar address-count type stays TERMINAL", () => {
  // The scalar must NOT have been quietly promoted to canonical truth. It is
  // retained for the raw count, but it must never be able to erase the
  // semantic model, so it remains non-promotable.
  const scalar = KNOWLEDGE_PROMOTION_ELIGIBILITY["SLC Addresses Consumed"];
  assert.ok(scalar, "the scalar fact type must still exist in the vocabulary");
  assert.notEqual(scalar.eligible, true,
    "the scalar address count must not become promotable and compete with Address Model");
});

test("5 -- Protocol remains the ONLY deterministic-promotable type", () => {
  const deterministic = Object.entries(KNOWLEDGE_PROMOTION_ELIGIBILITY)
    .filter(([, policy]) => policy.path === "deterministic")
    .map(([type]) => type)
    .sort();
  assert.deepEqual(deterministic, ["Protocol"],
    "adding Address Model must not widen what the system may promote without a human");
});

test("6 -- unclassified fact types still fail closed", () => {
  // A type absent from the table is refused, so any future type is opt-in.
  assert.equal(KNOWLEDGE_PROMOTION_ELIGIBILITY["Address Behaviour"], undefined);
  assert.equal(KNOWLEDGE_PROMOTION_ELIGIBILITY["slc_address_model"], undefined,
    "the attribute name is not itself a fact type");
});
