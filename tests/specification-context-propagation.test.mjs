import test from "node:test";
import assert from "node:assert/strict";
import { extractSpecificationPages, detectEngineeringDomain, extractAttributes } from "../app/domain/specification-extractor.mjs";

// Focused proof for the Al Mousa panel-selection blocker: a specification
// sentence that does not itself name a system was losing the governing system
// context of its PARENT specification, because a clause path carries only the
// section number and heading -- never the specification's own title.
//
// Measured defect on the real Al Mousa clause "2 PRODUCTS / 5 System Capacity":
//   path + sentence                 -> Unknown
//   document title + same sentence  -> Fire Alarm
//
// The repair resolves the document-level domain ONCE and uses it ONLY as a
// fallback for a sentence that resolves to Unknown on its own. These tests pin
// both the fix and, just as importantly, that it does NOT overwrite a
// sentence's own detection.

const page = (n, lines) => ({ page: n, lines });

// The real page furniture from the Al Mousa specification carries the
// specification title on every page; that is the governing context that was
// being dropped.
const TITLE_FURNITURE = "AlMoosa K12 School - KSA III-2/28 46 00 -19 Particular Specifications Pace 2401232 Fire Detection and Alarm System Rev 1";

const SYSTEM_CAPACITY_PAGES = [
  page(19, [
    TITLE_FURNITURE,
    "28 46 00 SECTION 28 46 00",
    "2 PRODUCTS",
    "5 System Capacity:",
    "a. The Fire Alarm Control Panel (FACP) must be able to communicate using a peer-to- peer, regenerative format and protocol across both local area networks (LAN) and wide area networks (WAN). The system should support network speeds of up to 100 Mb and can connect as many as 200 panels or nodes.",
    "b. Expansion capabilities for the control panel allow for up to 10 SLC loops, with each module accommodating up to 318 analog or addressable devices. This configuration provides a maximum system capacity of 3,180 points.",
    "c. The fire alarm control panel should feature a comprehensive operator interface with an annunciation panel, including a backlit liquid crystal display that holds up to 640 characters, individual color-coded LEDs for system status, and a QWERTY alphanumeric keypad for programming and system control.",
  ]),
];

const byText = (result, needle) => result.requirements.find((r) => r.originalText.includes(needle));

test("a sentence with no system token of its own inherits the governing document's system instead of becoming Unknown", () => {
  const result = extractSpecificationPages(SYSTEM_CAPACITY_PAGES, {});
  const inherited = byText(result, "3,180 points");
  assert.ok(inherited, "the capacity sentence must still be extracted");
  assert.equal(inherited.system, "Fire Alarm", "it must inherit Fire Alarm from the parent specification, not become Unknown");
  assert.equal(inherited.domain.value, "Fire Alarm");
  assert.equal(inherited.domain.sourceType, "Inherited From Document", "inherited context must be labelled honestly, never dressed up as explicit");
});

test("the real 3,180-point capacity requirement keeps its deterministically extracted attribute while inheriting context", () => {
  const result = extractSpecificationPages(SYSTEM_CAPACITY_PAGES, {});
  const capacity = byText(result, "3,180 points");
  // Context propagation must not touch any sentence-specific fact.
  assert.deepEqual(
    capacity.attributes.map((a) => [a.name, a.operator, a.normalizedValue, a.normalizedUnit]),
    [["Capacity", "Maximum", 3180, "POINTS"]],
    "the extracted Capacity attribute must be byte-identical after the fix",
  );
});

test("a sentence that names its own system is NOT overridden by document inheritance", () => {
  const result = extractSpecificationPages(SYSTEM_CAPACITY_PAGES, {});
  const own = byText(result, "Fire Alarm Control Panel (FACP) must be able to communicate");
  assert.ok(own, "the explicitly-named sentence must be extracted");
  assert.equal(own.system, "Fire Alarm");
  assert.equal(own.domain.sourceType, "Inferred", "a sentence with its own token keeps its own detection basis");
  assert.notEqual(own.domain.sourceType, "Inherited From Document");
});

test("inheritance lowers confidence rather than inflating it", () => {
  const result = extractSpecificationPages(SYSTEM_CAPACITY_PAGES, {});
  const inherited = byText(result, "3,180 points");
  assert.equal(inherited.domain.confidence, 0, "an inherited value is never an explicit statement, so it carries no explicit confidence");
});

test("a document that genuinely states no system leaves every requirement Unknown -- inheritance never invents a system", () => {
  const generic = extractSpecificationPages([
    page(1, ["Some Other Specification", "1 GENERAL", "The widget shall be 10 mm wide and shall be blue in colour."]),
  ], {});
  assert.ok(generic.requirements.length >= 1, "the sentence is still extracted");
  for (const requirement of generic.requirements) {
    assert.equal(requirement.system, "Unknown", "with no governing system anywhere, nothing may be inherited");
    assert.equal(requirement.domain.sourceType, "Unknown");
  }
});

test("the fix does not change which attribute names the vocabulary can express", () => {
  // Guards against a repair that widens the attribute vocabulary instead of
  // fixing context propagation.
  assert.deepEqual(
    extractAttributes("3,180 points").map((a) => [a.name, a.normalizedValue]),
    [["Capacity", 3180]],
  );
  assert.equal(detectEngineeringDomain("28 46 00 Fire Detection and Alarm System").value, "Fire Alarm");
});