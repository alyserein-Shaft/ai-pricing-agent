import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFireAlarmTaxonomyContext,
  looseFireAlarmEquipmentMatch,
} from "../app/domain/fire-alarm-taxonomy.mjs";

// Two distinct defects were measured in the applicability scorer's subject
// resolution, and only ONE of them is safely repairable here.
//
// 1. THE BARE-FORM HIJACK (repaired). looseFireAlarmEquipmentMatch strips a
//    leading qualifier to build a fallback form, so "conventional detector"
//    yields the bare word "detector" -- which is not a distinctive piece of
//    equipment at all, it is the common noun for a whole device class. Any text
//    mentioning a detector matched it. Measured on the real Al Mousa
//    requirement seq 100058, whose clause ends "... system and DETECTOR
//    maintenance, history review": the whole clause was hijacked into
//    "Conventional Detector" even though its subject is the Fire Alarm Control
//    Panel. The repair removes only non-distinctive bare forms, which can turn a
//    wrong answer into a fail-closed null but can never introduce a new wrong
//    answer.
//
// 2. THE PANEL/MODULE AMBIGUITY (NOT repaired here). The same clause ends
//    "manual control of addressable output modules, relay modules", so
//    "output module" is a genuine competing EXACT_PHRASE and
//    buildFireAlarmTaxonomyContext correctly fails closed on the ambiguity. A
//    guard was attempted and REVERTED because it regressed genuine products:
//    "IDP-CONTROL" normalises to "idp control", which itself ends in the word
//    "control", so any "word before the phrase" test excludes a real Control
//    Module. These tests pin both facts so the reverted guard cannot be
//    reintroduced by accident.

test("a bare form that is a common noun, not equipment, can never hijack the subject", () => {
  // The exact real clause text that produced the wrong answer.
  const clause =
    "the fire alarm control panel (facp) shall feature switches and an lcd/led display for system interaction. the entry keypad must support technical operations, system and detector maintenance, history review, device and circuit disarming, manual control of addressable output modules, relay modules, and notification appliance circuits.";

  assert.equal(
    looseFireAlarmEquipmentMatch(clause),
    null,
    "the panel clause must NOT be classified as a detector; a null (fail-closed) is correct here",
  );

  // And the panel's own sentence still resolves when read on its own.
  assert.equal(
    looseFireAlarmEquipmentMatch("the fire alarm control panel (facp) shall feature switches and an lcd/led display for system interaction."),
    "Fire Alarm Control Panel",
  );
});

test("every device class noun is refused as a bare fallback form", () => {
  for (const generic of ["detector", "device", "module", "panel", "unit"]) {
    assert.equal(
      looseFireAlarmEquipmentMatch(`a long specification sentence mentioning the ${generic} in passing`),
      null,
      `"${generic}" is a common noun and must never identify a product family on its own`,
    );
  }
});

test("the documented looseness of the recogniser is fully preserved", () => {
  // These are the cases the taxonomy's own comment says must keep working.
  const preserved = [
    ["smoke detector ceiling mounted", "Addressable Smoke Detector"],
    ["heat detector 135f", "Addressable Heat Detector"],
    ["conventional smoke detector", "Conventional Detector"],
    ["intrinsically safe detector", "Conventional Detector"],
    ["detector head", "Conventional Detector"],
    ["fire alarm control panel", "Fire Alarm Control Panel"],
    ["addressable heat detector", "Addressable Heat Detector"],
  ];
  for (const [text, expected] of preserved) {
    assert.equal(looseFireAlarmEquipmentMatch(text), expected, `"${text}" must still resolve`);
  }
});

test("no guard may classify by words appearing BEFORE the matched phrase", () => {
  // This is the reverted module-wiring guard, pinned as a regression test.
  // "IDP-CONTROL" normalises to "idp control", so any test on the preceding
  // words matches a genuine Control Module product and wrongly excludes it.
  const source = "idp control control module".replace(/[^a-z0-9]+/g, " ").trim();
  const matchedPhrase = "control module";
  const index = source.indexOf(matchedPhrase);
  const before = source.slice(Math.max(0, index - 60), index);
  assert.ok(
    /\b(control|controls|controlling|controlls|operate|operates|operating)\s+(of\s+|on\s+|the\s+)?$/.test(before),
    "a preceding-words test DOES match this genuine product -- which is exactly why it cannot be used",
  );
  assert.equal(
    buildFireAlarmTaxonomyContext({ description: "IDP-CONTROL control module" }).families[0]?.family,
    "Control Module",
    "a genuine Control Module product must still classify as a Control Module",
  );
});

test("a real module product is never classified as a Fire Alarm Control Panel", () => {
  for (const [text, expected] of [
    ["addressable output module", "Output Module"],
    ["IDP-RELAY addressable relay module", "Relay Module"],
    ["IDP-MONITOR monitor module", "Monitor Module"],
    ["IDP-ZONE interface module", "Zone Module"],
  ]) {
    assert.equal(buildFireAlarmTaxonomyContext({ description: text }).families[0]?.family, expected, `"${text}"`);
  }
});