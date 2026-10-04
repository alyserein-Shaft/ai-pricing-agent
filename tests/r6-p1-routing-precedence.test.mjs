import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveRequirementRoute, detectPracticeObligation, detectProductTechnicalCriterion, OBLIGATION_CUES, SCOPE_VALUES, ROLE_VALUES,
} from "../app/domain/requirement-scope-role-routing.mjs";
import { analyzeRequirementFamilyPhrase, buildRequirementFamilyAnalyzer, REQUIREMENT_FAMILY_VOCABULARY } from "../app/domain/fire-alarm-taxonomy.mjs";

// R6 -- P1 routing precedence + practice-category safety. Pure: no DB, no AI, no runtime consumer.

const req = (originalText, requirementCategory = "Other", extra = {}) => ({
  originalText, requirementCategory, standards: [], compatibility: [], attributes: [], ...extra,
});
const route = (text, category, extra) => resolveRequirementRoute(req(text, category, extra));

test("1. practice beats family: Installation / Testing / Documentation obligations are never PRODUCT_MATCHING", () => {
  for (const category of ["Other", "Installation"]) {
    const out = route("Install smoke detectors in all guest rooms per the approved drawings.", category);
    assert.equal(out.role, "INSTALLATION_COMPLIANCE", category);
    assert.equal(out.family, null);
  }
  for (const category of ["Other", "Testing"]) assert.equal(route("Test smoke detectors after installation and record the results.", category).role, "TESTING_COMMISSIONING");
  for (const category of ["Other", "Documentation"]) assert.equal(route("Submit smoke detector technical data with the shop drawings.", category).role, "DOCUMENTATION_SUBMITTAL");
  // exact-family variants: the exact family is recorded for traceability but does not decide the role
  const exact = route("Duct detectors shall be installed in accordance with NFPA 72 and the manufacturer's instructions.", "Functional");
  assert.equal(exact.role, "INSTALLATION_COMPLIANCE");
  assert.equal(exact.mentionedFamily, "Duct Detector");
  assert.equal(exact.family, null);
  const asBuilt = route("The As-Built drawings shall locate as a minimum the following: FACP, annunciators, initiating devices.", "Documentation");
  assert.equal(asBuilt.role, "DOCUMENTATION_SUBMITTAL");
  assert.equal(route("Attach a permanent label to the inside of the fire alarm control panel identifying the electrical source.", "Installation").role, "INSTALLATION_COMPLIANCE");
});

test("2. Network beats an incidental family", () => {
  for (const category of ["Other", "Installation"]) {
    const out = route("FACP shall communicate over the network.", category);
    assert.equal(out.role, "SYSTEM_ARCHITECTURE", category);
    assert.equal(out.scope, "SYSTEM_WIDE");
    assert.equal(out.family, null);
  }
  assert.equal(route("The fire alarm control panel, repeater panel and annunciator must be networked together.", "Network").role, "SYSTEM_ARCHITECTURE");
});

test("3. a Manufacturer obligation is not product matching just because a family appears", () => {
  const out = route("Manufacturer shall provide smoke detectors with a ten year warranty.", "Manufacturer");
  assert.equal(out.role, "COMMERCIAL");
  assert.notEqual(out.role, "PRODUCT_MATCHING");
  assert.equal(route("Manufacturer shall provide smoke detectors.", "Other").role, "COMMERCIAL");
  assert.equal(route("The manufacturer must be approved by Saudi Civil Defense; the heat detector supplier shall hold an agency agreement.", "Compliance").role, "COMMERCIAL");
  // a manufacturer NAMED as the reference for an installation is still installation, not commerce
  assert.equal(route("Fault isolation modules are to be installed between each SLC device per the manufacturer's installation guidelines.", "Manufacturer").role, "INSTALLATION_COMPLIANCE");
});

test("4. UL 268 listing stays PRODUCT_MATCHING (the product-specific exception), even under a noisy practice category", () => {
  for (const category of ["Other", "Documentation", "Installation", "Testing"]) {
    const out = route("Smoke detector shall be UL 268 listed.", category);
    assert.equal(out.role, "PRODUCT_MATCHING", category);
    assert.equal(out.scope, "FAMILY_LEVEL");
    assert.equal(out.family, null, "a PARENT_CHILD group is not a resolved family");
    assert.equal(out.familyMatchClass, "PARENT_CHILD");
    assert.deepEqual(out.basis, ["PARENT_GROUP_WITH_PRODUCT_CRITERION", "PRODUCT_LISTING"]);
  }
  assert.equal(route("Heat detector shall be rated 135°F and UL 521 listed.", "Installation").role, "PRODUCT_MATCHING");
});

test("5. FlashScan device compatibility stays PRODUCT_MATCHING", () => {
  for (const category of ["Other", "Testing"]) {
    const out = route("Smoke detector shall support FlashScan.", category);
    assert.equal(out.role, "PRODUCT_MATCHING", category);
    assert.equal(out.basis[1], "PROTOCOL_TARGET");
  }
  assert.equal(route("Heat detector shall be compatible with FlashScan and CLIP.", "Compatibility").role, "PRODUCT_MATCHING");
});

test("6. SLC / Class / Style wording does not force product matching", () => {
  const cases = ["Smoke detector loops shall be Class A, Style 7, SLC.", "Detectors shall be connected to a Class B SLC circuit."];
  for (const text of cases) {
    const out = route(text, "Installation");
    assert.notEqual(out.role, "PRODUCT_MATCHING", text);
    assert.equal(out.role, "INSTALLATION_COMPLIANCE", "the practice category stands; topology is not a product criterion");
    assert.equal(detectProductTechnicalCriterion({ text, family: "Smoke Detector" }), null);
  }
  assert.equal(route("Signaling line circuit wiring shall be Class A Style 7.", "Other").role, "UNKNOWN", "a topology mention alone is not promoted");
});

test("7. PARENT_CHILD alone never forces PRODUCT_MATCHING", () => {
  const out = route("Smoke detectors shall be provided throughout the building.", "Other");
  assert.equal(out.familyMatchClass, "PARENT_CHILD");
  assert.notEqual(out.role, "PRODUCT_MATCHING");
  assert.equal(out.role, "UNKNOWN");
  assert.equal(route("Smoke detectors shall be provided throughout the building.", "Installation").role, "INSTALLATION_COMPLIANCE");
});

test("8. AMBIGUOUS and RELATED_NOT_EQUIVALENT never force PRODUCT_MATCHING", () => {
  const ambiguous = "Break glass units and detectors shall be provided.";
  const a = route("Approved flush mounted break glass/manual pull station units shall be installed at fireman's lift lobbies.", "Compliance");
  assert.equal(a.familyMatchClass, "AMBIGUOUS");
  assert.equal(a.role, "INSTALLATION_COMPLIANCE");
  assert.notEqual(route(ambiguous, "Other").role, "PRODUCT_MATCHING");
  const related = route("Wiring to speakers in conduit.", "Other");
  assert.equal(related.familyMatchClass, "RELATED_NOT_EQUIVALENT");
  assert.equal(related.role, "UNKNOWN");
  assert.equal(route("Wiring to speakers in conduit.", "Installation").role, "INSTALLATION_COMPLIANCE");
  assert.notEqual(route("Cable to the sounder shall have 2 conductors.", "Other").role, "PRODUCT_MATCHING");
});

test("9. Golden req197 stays PRODUCT_MATCHING / Heat Detector", () => {
  const text = "Features: a) Sleek, low-profile, and aesthetically pleasing design b) Advanced thermistor technology for rapid response c) Rate-of-rise detection at 15°F (8.3°C) per minute d) Factory-set fixed temperature at 135°F e) Remote testing capability f) Compatible with FlashScan and CLIP g) Optional sounder, relay, and isolator bases h) Facilitates installation and maintenance i) Built-in functional test switch";
  for (const category of ["Compliance", "Installation", "Testing"]) {
    const out = route(text, category, { compatibility: [{ targetItem: "FlashScan systems" }], attributes: [{ name: "fixed_temperature_setpoint" }] });
    assert.equal(out.role, "PRODUCT_MATCHING", category);
    assert.equal(out.family, "Heat Detector");
    assert.equal(out.scope, "FAMILY_LEVEL");
  }
  assert.equal(detectPracticeObligation(text), null, "'facilitates installation', 'remote testing capability' and 'test switch' are features, not obligations");
});

test("10. scope is independent of role", () => {
  // the same role can carry different scopes and the same scope different roles; scope never encodes the role
  assert.equal(route("Install smoke detectors per drawings.", "Other").scope, "PROJECT_WIDE");
  assert.equal(route("FACP shall communicate over the network.", "Other").scope, "SYSTEM_WIDE");
  assert.equal(route("Smoke detector shall be UL 268 listed.", "Other").scope, "FAMILY_LEVEL");
  const roles = new Set(["Install smoke detectors per drawings.", "Test smoke detectors after installation.", "Submit smoke detector technical data with the shop drawings."].map((text) => route(text).role));
  assert.equal(roles.size, 3);
  assert.deepEqual(new Set(["Install smoke detectors per drawings.", "Test smoke detectors after installation.", "Submit smoke detector technical data with the shop drawings."].map((text) => route(text).scope)), new Set(["PROJECT_WIDE"]));
  for (const text of ["Install smoke detectors.", "Smoke detector shall be UL 268 listed.", "FACP shall communicate over the network.", "Some clause."]) {
    const { scope, role } = route(text);
    assert.ok(SCOPE_VALUES.includes(scope) && ROLE_VALUES.includes(role));
  }
});

test("11. vocabulary order does not affect P1", () => {
  const texts = [
    ["Install smoke detectors in all guest rooms.", "Other"], ["Smoke detector shall be UL 268 listed.", "Documentation"], ["Duct detector activation must trigger supervisory alarm", "Functional"],
    ["FACP shall communicate over the network.", "Installation"], ["Manufacturer shall provide smoke detectors.", "Manufacturer"], ["Test heat detectors after installation.", "Testing"],
  ];
  const forward = buildRequirementFamilyAnalyzer(REQUIREMENT_FAMILY_VOCABULARY);
  const reversed = buildRequirementFamilyAnalyzer([...REQUIREMENT_FAMILY_VOCABULARY].reverse());
  for (const [text, category] of texts) {
    const a = resolveRequirementRoute(req(text, category), { analyzeFamily: forward });
    const b = resolveRequirementRoute(req(text, category), { analyzeFamily: reversed });
    assert.deepEqual(b, a, text);
    assert.deepEqual(a, route(text, category), text);
  }
});

test("12. no ITEM_SPECIFIC guessing, ever", () => {
  const texts = ["Install smoke detectors.", "Smoke detector shall be UL 268 listed.", "Provide 24 Heat Detectors on level 3.", "Pull station #12 shall be mounted at 1200mm.", "FACP-01 shall communicate over the network.", "Submit shop drawings.", "Unrelated sentence."];
  for (const text of texts) for (const category of ["Other", "Installation", "Testing", "Documentation", "Network", "Manufacturer"]) {
    assert.notEqual(route(text, category).scope, "ITEM_SPECIFIC", `${category}: ${text}`);
  }
});

test("13. attribute, standards and compatibility child rows never push an obligation to PRODUCT_MATCHING", () => {
  const rows = { attributes: [{ name: "sound_output" }], standards: [{ body: "NFPA", number: "72" }], compatibility: [{ targetItem: "SLC" }] };
  const install = route("All devices shall be installed per NFPA 72.", "Other", rows);
  assert.equal(install.role, "INSTALLATION_COMPLIANCE");
  assert.equal(route("Test all devices in accordance with NFPA 72.", "Other", rows).role, "TESTING_COMMISSIONING");
  assert.equal(route("Submit the NFPA 72 record of completion.", "Other", rows).role, "DOCUMENTATION_SUBMITTAL");
  assert.equal(route("The FACP shall communicate over the network per NFPA 72.", "Other", rows).role, "SYSTEM_ARCHITECTURE");
  // and without a family or an obligation, child rows keep their pre-R6 system-architecture meaning
  assert.equal(route("Some clause text", "Other", { standards: [{ body: "NFPA", number: "72" }] }).role, "SYSTEM_ARCHITECTURE");
  assert.equal(route("Some clause text", "Other", { attributes: [{ name: "sound_output" }] }).role, "SYSTEM_ARCHITECTURE");
});

test("14. a group mention with only child rows is not enough; a strict criterion is", () => {
  assert.equal(route("Detectors shall be provided.", "Other", { standards: [{ body: "NFPA", number: "72" }] }).role, "SYSTEM_ARCHITECTURE");
  assert.equal(route("Detectors shall be provided.", "Other", { attributes: [{ name: "temperature_range" }] }).role, "PRODUCT_MATCHING");
  assert.equal(route("Detectors shall be provided.", "Other", { attributes: [{ name: "some_other_attribute" }] }).role, "SYSTEM_ARCHITECTURE");
  assert.equal(detectProductTechnicalCriterion({ text: "Smoke detector shall be listed to NFPA 72.", family: "Smoke Detector" }), null, "NFPA is a code body: not a product listing");
  assert.equal(detectProductTechnicalCriterion({ text: "Smoke detector shall be UL 268 listed.", family: "Smoke Detector" }).kind, "PRODUCT_LISTING");
});

test("15. brief negative examples, verbatim expectations", () => {
  assert.equal(route("Install smoke detectors in the corridor.").role, "INSTALLATION_COMPLIANCE");
  assert.equal(route("Test smoke detectors in the corridor.").role, "TESTING_COMMISSIONING");
  assert.equal(route("Submit smoke detector technical data for approval.").role, "DOCUMENTATION_SUBMITTAL");
  assert.equal(route("Smoke detector shall be UL 268 listed.").role, "PRODUCT_MATCHING");
  assert.equal(route("Smoke detector shall support FlashScan.").role, "PRODUCT_MATCHING");
  assert.equal(route("FACP shall communicate over the network.").role, "SYSTEM_ARCHITECTURE");
  assert.notEqual(route("Manufacturer shall provide smoke detectors.").role, "PRODUCT_MATCHING");
  assert.notEqual(route("Wiring to speakers in conduit.", "Installation").role, "PRODUCT_MATCHING");
  assert.equal(route("All devices shall be installed per NFPA 72.").role, "INSTALLATION_COMPLIANCE");
});

test("16. cue precision: nouns, features and references are not obligations", () => {
  const notCues = [
    "Manual call points must support fail-safe operation.",
    "Detector incorporates a functional test switch and remote test capability.",
    "The detector facilitates installation and maintenance.",
    "Secure Shell (SSH) protocol shall be supported.",
    "Wire terminal strips shall be used to join wires.",
    "Test certificates for impact shall be submitted.".replace("shall be submitted", "are available"),
    "Materials shall be tested and listed by a recognized laboratory.",
    "All communications shall be verified and retransmitted if not acknowledged.",
    "Each cable shall enter the patch panel where required by manufacturer's installation manuals.",
    "The system shall provide network interface modules.",
    "The chassis shall accommodate 2 network interfaces.",
  ];
  for (const text of notCues) assert.equal(detectPracticeObligation(text), null, text);
  const cues = {
    "Install detectors per drawings.": "INSTALL_IMPERATIVE",
    "Detectors shall be installed per NFPA 72.": "INSTALL_MODAL_BE",
    "Provide and install all equipment racks.": "INSTALL_IMPERATIVE",
    "Test the system after installation.": "TEST_IMPERATIVE",
    "Cables shall be tested for continuity.": "TEST_MODAL_BE",
    "The Contractor shall submit a training plan.": "DOC_MODAL_SUBMIT",
    "Provide record drawings for maintenance.": "DOC_IMPERATIVE",
    "The manufacturer shall be approved by Civil Defense.": "COMMERCIAL_PARTY",
    "The panels must be networked together.": "SYSTEM_NETWORK",
  };
  for (const [text, id] of Object.entries(cues)) assert.equal(detectPracticeObligation(text)?.id, id, text);
  assert.ok(OBLIGATION_CUES.every((cue) => ROLE_VALUES.includes(cue.role)));
});

test("17. mount/placement wording: a feature's mounting is not the obligation; a placement is", () => {
  assert.equal(route("The center point of a manual pull station should be mounted at 1200mm from floor level.", "Installation").role, "INSTALLATION_COMPLIANCE");
  const feature = route("When not in plain view, duct detectors shall include remote alarm indicators and test switches mounted in plain view at 48 inches above the floor.", "Installation");
  assert.equal(feature.role, "PRODUCT_MATCHING");
  assert.equal(feature.family, "Duct Detector");
  assert.equal(route("Duct detectors shall be suitable for mounting in ductwork.", "Functional").role, "PRODUCT_MATCHING");
});

test("18. routing stays pure and additive: unchanged keys, no mutation, no ITEM_SPECIFIC, family field only for an exact family", () => {
  const input = req("Duct detector activation must trigger supervisory alarm", "Functional");
  const frozen = JSON.stringify(input);
  const out = resolveRequirementRoute(input);
  assert.equal(JSON.stringify(input), frozen);
  for (const key of ["scope", "role", "family", "basis", "unknown"]) assert.ok(key in out);
  assert.equal(out.family, "Duct Detector");
  assert.equal(out.unknown, false);
  assert.equal(resolveRequirementRoute(req("Unrelated sentence.", "Other")).unknown, true);
  assert.deepEqual(resolveRequirementRoute(req("Duct detector activation must trigger supervisory alarm", "Functional")), out, "deterministic");
  assert.equal(analyzeRequirementFamilyPhrase("Duct detector activation").matchClass, "EXACT_ALIAS");
});
