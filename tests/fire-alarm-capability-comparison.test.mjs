import assert from "node:assert/strict";
import test from "node:test";

import {
  FIRE_ALARM_CAPABILITIES,
  fireAlarmCapability,
  isGovernedBooleanCapability,
  isGovernedRelationalConstraint,
  parseCapabilityBoolean,
} from "../app/domain/fire-alarm-taxonomy.mjs";

import {
  CAPABILITY_RESULT,
  compareBooleanCapability,
  compareRelationalConstraint,
  evaluateCapabilities,
} from "../app/domain/product-matching-engine.mjs";

// CANONICAL CAPABILITY VOCABULARY + FAIL-CLOSED MATCHING
//
// Every capability key below was created ONLY because a currently-applicable Al
// Mousa "28 46 00 Fire Detection and Alarm System - Rev 1" clause demands it, and
// only because first-party Honeywell evidence can decide it. Each key is mapped to
// the governing clause that forced its creation so a reviewer can check the
// derivation rather than trust the list.

const product = (...pairs) => ({ id: "p", manufacturer: "Honeywell", partNumber: "X", attributes: pairs.map(([name, normalizedValue]) => ({ name, normalizedValue })) });

test("every capability declares an explicit value type, meaning and governing clause", () => {
  for (const [key, definition] of Object.entries(FIRE_ALARM_CAPABILITIES.capabilities)) {
    assert.equal(definition.key, key);
    assert.equal(definition.valueType, "Boolean", `${key} must be a typed Boolean capability`);
    assert.ok(definition.meaning.length > 10, `${key} must state what it means`);
    assert.match(definition.governingClause, /GENERAL|PRODUCTS/, `${key} must cite the clause that demanded it`);
    assert.equal(definition.semantics, "Fail-Closed");
  }
});

test("no capability key is named after a requirement sentence", () => {
  // Keys are short, snake_case capability nouns. A key that embedded the wording
  // of one project's clause could never be reusable.
  for (const key of Object.keys(FIRE_ALARM_CAPABILITIES.capabilities)) {
    assert.match(key, /^[a-z][a-z0-9_]*$/, `${key} must be a bare snake_case capability name`);
    assert.ok(key.split("_").length <= 4, `${key} must not encode a sentence`);
  }
});

test("an ungoverned capability name is not comparable at all", () => {
  assert.equal(fireAlarmCapability("not_a_real_capability"), null);
  assert.equal(isGovernedBooleanCapability("not_a_real_capability"), false);
  assert.equal(isGovernedRelationalConstraint("not_a_real_capability"), false);
  const outcome = compareBooleanCapability({ name: "not_a_real_capability", value: "true" }, product(["local_operator_display", "true"]));
  assert.equal(outcome.result, CAPABILITY_RESULT.InsufficientEvidence);
  assert.equal(outcome.blocking, false, "an ungoverned key must never block");
});

test("capability values parse only from literal booleans, never from prose", () => {
  for (const affirmative of [true, "true", "TRUE", "yes", "Yes", "supported", "present", "1"])
    assert.equal(parseCapabilityBoolean(affirmative), true, String(affirmative));
  for (const negative of [false, "false", "no", "Not Supported", "absent", "0"])
    assert.equal(parseCapabilityBoolean(negative), false, String(negative));
  // Anything that is not an unambiguous boolean is REFUSED, so a capability
  // comparison can never degrade into free-text matching.
  for (const refused of ["Red", "unknown", "", "4", "the panel shall feature switches", null, undefined, "maybe"])
    assert.equal(parseCapabilityBoolean(refused), null, JSON.stringify(refused));
});

test("true plus required true is compliant; explicit false is non-compliant and blocking", () => {
  assert.equal(compareBooleanCapability({ name: "alarm_verification_support", value: "true" }, product(["alarm_verification_support", "true"])).result, CAPABILITY_RESULT.Compliant);
  const failed = compareBooleanCapability({ name: "alarm_verification_support", value: "true" }, product(["alarm_verification_support", "false"]));
  assert.equal(failed.result, CAPABILITY_RESULT.NonCompliant);
  assert.equal(failed.pass, false);
  assert.equal(failed.blocking, true, "genuine non-compliance MUST block");
});

test("absent product evidence is Insufficient Evidence and is NOT blocking", () => {
  // This is the case that previously produced a false NON-COMPLIANT verdict.
  const outcome = compareBooleanCapability({ name: "operator_event_logging", value: "true" }, product());
  assert.equal(outcome.result, CAPABILITY_RESULT.InsufficientEvidence);
  assert.equal(outcome.pass, false);
  assert.equal(outcome.blocking, false, "unrecorded evidence must never be reported as non-compliance");
});

test("a non-boolean stored value and conflicting duplicate values both fail closed", () => {
  const junk = compareBooleanCapability({ name: "operator_event_logging", value: "true" }, product(["operator_event_logging", "sometimes"]));
  assert.equal(junk.result, CAPABILITY_RESULT.InsufficientEvidence);
  const conflicting = compareBooleanCapability({ name: "operator_event_logging", value: "true" }, product(["operator_event_logging", "true"], ["operator_event_logging", "false"]));
  assert.equal(conflicting.result, CAPABILITY_RESULT.InsufficientEvidence);
  assert.equal(conflicting.blocking, false);
});

test("a requirement-side value that is not a governed boolean fails closed", () => {
  const outcome = compareBooleanCapability({ name: "local_operator_display", value: "Red" }, product(["local_operator_display", "Red"]));
  assert.equal(outcome.result, CAPABILITY_RESULT.InsufficientEvidence);
  assert.equal(outcome.blocking, false);
});

test("THE RELATIVE COLOUR REQUIREMENT STAYS RELATIONAL", () => {
  const claim = { name: "related_enclosure_colour_match", value: "required" };

  // The panel exposes one determinate colour -> the constraint has a reference
  // value the related enclosure must match, and the comparison PASSES.
  const ok = compareRelationalConstraint(claim, product(["cabinet_color", "Red"]));
  assert.equal(ok.result, CAPABILITY_RESULT.Compliant);
  assert.equal(ok.offered, "Red");
  assert.match(ok.evidence.projectLevelCheck, /project-level cross-item check/);
  assert.match(ok.evidence.projectLevelCheck, /NOT asserted by this single-candidate comparison/);

  // The KEY POINT: the comparison never turns the relational requirement into an
  // absolute one. Nothing in the outcome says the required colour is "Red";
  // "Red" is this product's OWN value, and the constraint only says the other
  // enclosure must equal it.
  assert.equal(ok.requirement.capabilityName, "related_enclosure_colour_match");
  assert.ok(!JSON.stringify(ok.evidence).includes('"requiredValue"'), "no absolute required colour may be asserted");

  // No colour at all -> nothing for the related enclosure to match.
  assert.equal(compareRelationalConstraint(claim, product()).result, CAPABILITY_RESULT.InsufficientEvidence);
  // Two different colours -> no single reference value exists.
  assert.equal(compareRelationalConstraint(claim, product(["cabinet_color", "Red"], ["cabinet_color", "Black"])).result, CAPABILITY_RESULT.InsufficientEvidence);
  // An UNRESOLVED colour is not a reference value: asserting the equality against
  // "Unknown" would make the cross-item check formally true against a value
  // nobody decided.
  for (const unresolved of ["Unknown", "unknown", "TBD", "N/A", "not specified"]) {
    assert.equal(
      compareRelationalConstraint(claim, product(["cabinet_color", unresolved])).result,
      CAPABILITY_RESULT.InsufficientEvidence,
      `"${unresolved}" must not be accepted as a reference value`,
    );
  }
});

test("the relational constraint carries its governed referenced attribute in the vocabulary", () => {
  assert.equal(FIRE_ALARM_CAPABILITIES.relationalConstraints.related_enclosure_colour_match.referencedAttribute, "cabinet_color");
  // A boolean capability never carries one, so it can never be compared relationally.
  assert.equal(FIRE_ALARM_CAPABILITIES.capabilities.local_operator_display.referencedAttribute, undefined);
});

test("evaluateCapabilities returns one entry per claim and tags its governing requirement", () => {
  const requirements = [{ id: "req-1", capabilities: [{ name: "peer_to_peer_network", value: "true" }] }, { id: "req-2", capabilities: [{ name: "panel_operator_switches", value: "true" }] }];
  const outcomes = evaluateCapabilities(requirements, product(["peer_to_peer_network", "true"]));
  assert.equal(outcomes.length, 2);
  assert.equal(outcomes[0].governingRequirementId, "req-1");
  assert.equal(outcomes[0].result, CAPABILITY_RESULT.Compliant);
  assert.equal(outcomes[1].governingRequirementId, "req-2");
  assert.equal(outcomes[1].result, CAPABILITY_RESULT.InsufficientEvidence);
});

test("a requirement with no governed capability claim produces no capability comparison", () => {
  assert.deepEqual(evaluateCapabilities([{ id: "r", capabilities: [] }], product(["peer_to_peer_network", "true"])), []);
  assert.deepEqual(evaluateCapabilities([{ id: "r" }], product()), []);
});

test("panel_transient_protection exists as a governed key because the project demands it", () => {
  // The requirement demands it, so the key exists; no first-party evidence has been
  // recorded, so a product carrying nothing resolves to Insufficient Evidence --
  // never to implied-false, which would be a fabricated non-compliance.
  assert.ok(isGovernedBooleanCapability("panel_transient_protection"));
  assert.equal(compareBooleanCapability({ name: "panel_transient_protection", value: "true" }, product()).result, CAPABILITY_RESULT.InsufficientEvidence);
});