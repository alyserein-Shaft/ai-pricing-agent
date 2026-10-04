import assert from "node:assert/strict";
import test from "node:test";

import { extractSpecificationPages } from "../app/domain/specification-extractor.mjs";

// COLON-INTRODUCED LIST MEMBERSHIP -- EXTRACTOR ROOT-CAUSE REPAIR
//
// Al Mousa "28 46 00 Fire Detection and Alarm System - Rev 1", clause 1 GENERAL,
// ends two requirements on a colon and then enumerates them:
//
//   H.7 "Key presses shall be recorded in the history log. FACP shall have
//        sufficient memory to support its operating system and databases
//        including:"  -> 8. Fire management. 9. Alarm management. 10. Historical
//        data. 11. Maintenance support applications. 12. Custom processes.
//        13. Operator I/O.
//   I.  "FACP Shall be provided with the following for basic operation:"
//        -> 1. Communication Ports ... 2. Integrated On-Line Diagnostics ...
//        3. Surge and Transient Protection ...
//
// `segmentSpecification` makes each of those numbered lines its OWN clause, and
// because a bare noun phrase carries no shall/must/should, `classifyRequirementType`
// returned "Informational" and the `requirementLike` gate dropped it. So the whole
// constraint each colon introduced was silently lost, leaving only the dangling
// lead-in. Every one of those nine items is ABSENT FROM DB.

const clauseLines = [
  "1.5       SYSTEM DESCRIPTION",
  "      H. Three operator keys will display function status and are assigned to acknowledge, signal",
  "         silence, and system reset; the other five keys can be user-assigned for additional functions.",
  "         1. Lamp test.",
  "         7. Key presses shall be recorded in the history log. FACP shall have sufficient memory to",
  "              support its operating system and databases including:",
  "         8. Fire management.",
  "         9. Alarm management.",
  "         10. Historical data.",
  "         11. Maintenance support applications.",
  "         12. Custom processes.",
  "         13. Operator I/O.",
  "      I. FACP Shall be provided with the following for basic operation:",
  "         1. Communication Ports: Offer data communication interfaces to enable the concurrent",
  "              operation of devices such as industry-standard printers, programming terminals, PCs,",
  "              transponders, and annunciators.",
  "         2. Integrated On-Line Diagnostics: The control panel will continuously run self,",
  "              communication, and subsidiary equipment diagnostics.",
  "         3. Surge and Transient Protection: Isolation will be provided at field terminations to suppress",
  "              voltage transients as needed.",
];

const extract = (lines) => extractSpecificationPages([{ page: 1, lines }], { documentType: "Technical Specification" }).requirements;
const has = (requirements, prefix) => requirements.some((requirement) => requirement.originalText.startsWith(prefix));

test("every item of a colon-introduced list is recovered, not just the first", () => {
  const requirements = extract(clauseLines);
  const lost = [
    "Fire management", "Alarm management", "Historical data", "Maintenance support applications",
    "Custom processes", "Operator I/O", "Communication Ports", "Integrated On-Line Diagnostics",
    "Surge and Transient Protection",
  ];
  for (const item of lost) assert.ok(has(requirements, item), `"${item}" was lost by the extractor and must now be recovered`);
  assert.equal(lost.filter((item) => has(requirements, item)).length, lost.length);
});

test("a recovered list member INHERITS the governing lead-in's modal, not an invented one", () => {
  const requirements = extract(clauseLines);
  // The lead-in "FACP Shall be provided with the following for basic operation:" is
  // Mandatory, so its members are Mandatory too.
  for (const item of ["Communication Ports", "Integrated On-Line Diagnostics", "Surge and Transient Protection"]) {
    const member = requirements.find((requirement) => requirement.originalText.startsWith(item));
    assert.equal(member.requirementType, "Mandatory", `${item} must inherit Mandatory`);
    assert.equal(member.priority, undefined, `${item} carries no separately invented property`);
  }
});

test("the lead-in itself is still extracted, so nothing that already worked regresses", () => {
  const requirements = extract(clauseLines);
  assert.ok(has(requirements, "Key presses shall be recorded in the history log."));
  assert.ok(has(requirements, "FACP shall have sufficient memory"));
  assert.ok(has(requirements, "FACP Shall be provided with the following for basic operation:"));
});

test("NEGATIVE CONTROL: a bare noun phrase outside any colon list is still dropped", () => {
  // This is the guard that keeps the repair from inventing requirements. A heading
  // or stray noun phrase that is NOT a list member of a colon lead-in stays
  // Informational and is discarded exactly as before.
  const requirements = extract([
    "1.0       SCOPE",
    "A. This section shall apply to all work described herein.",
    "Intolerable weather conditions.",
    "B. The contractor shall submit shop drawings for approval.",
  ]);
  assert.equal(has(requirements, "Intolerable"), false, "a bare noun phrase must not be admitted");
  assert.equal(requirements.length, 2);
});

test("NEGATIVE CONTROL: an unnumbered preamble clause can never open or join a list", () => {
  const requirements = extract([
    "Background noise shall be minimised:",
    "Unnumbered trailing fragment.",
  ]);
  assert.equal(has(requirements, "Unnumbered trailing fragment"), false);
});

test("NEGATIVE CONTROL: a clause with its own modal closes the preceding list", () => {
  // "2. The installer shall test every zone." carries its own modal, so the list
  // opened by the preceding colon must not swallow what follows it. Each item here
  // is a NUMBERED line so it really becomes its own clause (an unnumbered line is
  // merged into the previous clause by segmentSpecification and would not exercise
  // this control at all).
  const requirements = extract([
    "1.1 SCOPE",
    "The panel shall provide the following:",
    "1. Alpha item.",
    "2. The installer shall test every zone.",
    "3. Beta orphan fragment.",
  ]);
  assert.ok(has(requirements, "Alpha item."), "the first list member inherits");
  assert.ok(has(requirements, "The installer shall test every zone."));
  assert.equal(has(requirements, "Beta orphan fragment"), false, "the list must close at the first clause with its own modal");
});