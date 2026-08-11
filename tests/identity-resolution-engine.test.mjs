import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeIdentityPair, buildIdentityKey, buildTerminalPunctuationKey,
  extractElectricalTokens, identityRulesetDocument, IDENTITY_RULES, tokenizeOrderCode,
} from "../app/domain/identity-resolution-engine.mjs";

const base = (partNumber, description, extra = {}) => ({
  id: `product:${partNumber}`, manufacturerId: "manufacturer:honeywell", manufacturer: "Honeywell",
  brand: "Farenhyt", partNumber, description, attributes: [], sourceId: "price-list", ...extra,
});

const clean = [
  ["B501-BL.", "B501-BL", "4” standard flangeless mounting base (Black Color)"],
  ["IDP-PHOTO-IV.", "IDP-PHOTO-IV", "Intelligent Addressable Photoelectric Smoke Detector (Ivory Color) (Base Not Included)"],
  ["IDP-MINIMON.", "IDP-MINIMON", "Intelligent Addressable Mini Monitor Module, Supervised, Single Contact"],
  ["IDP-ISO.", "IDP-ISO", "Intelligent Addressable Line Isolator Mod. Isolates Short Circuits On Slc Loop"],
  ["IDP-MONITOR.", "IDP-MONITOR", "Intelligent Addressable Monitor Module, Supervised, Single Contact"],
  ["B300-6.", "B300-6", "White, 6” base, standard flanged low-profile mounting base."],
  ["IDP-PHOTO-R-IV.", "IDP-PHOTO-R-IV", "Intelligent Photoelectric Replacement Smoke Detector remote test capable, for use with DNR (W) duct smoke detector (Ivory Color)"],
  ["IDP-PHOTO-T-IV.", "IDP-PHOTO-T-IV", "Intelligent Addressable Photoelectric Smoke Detector with Thermal (135ºF)(57ºC) (Base Not Included) (Ivory Color)"],
  ["IDP-HEAT-IV.", "IDP-HEAT-IV", "Intelligent Addressable Thermal Detector Fixed Temp 135 (Base Not Included)"],
  ["IDP-PHOTO-W.", "IDP-PHOTO-W", "Intelligent Addressable Photoelectric Smoke Detector. (Base Not Included) (White Color)"],
  ["IDP-HEAT-ROR-IV.", "IDP-HEAT-ROR-IV", "Intelligent Addressable Fixed temperature and rate-of rise thermal detector (Rate-of-rise detection 15ºF/min (9ºC/min) (Base Not Included)(Ivory Color)"],
  ["IDP-ZONE.", "IDP-ZONE", "Intelligent Addressable 2-wire Zone Interface Module"],
  ["B300-6-IV.", "B300-6-IV", "Ivory,6” base, Bulk pack of B300-6-IV, package contains 10"],
  ["IDP-HEAT-HT-W.", "IDP-HEAT-HT-W", "Intelligent Addressable High temperature heat detector 135ºF –190ºF (57ºC – 88ºC) (Base Not Included) (White Color)"],
  ["IDP-HEAT-W.", "IDP-HEAT-W", "Intelligent Addressable Thermal Detector Fixed Temp 135 (Base Not Included) (White Color)"],
  ["IDP-HEAT-HT-IV.", "IDP-HEAT-HT-IV", "Intelligent Addressable High temperature heat detector 135ºF –190ºF (57ºC – 88ºC) (Base Not Included) (Ivory Color)"],
  ["IDP-RELAY.", "IDP-RELAY", "Intelligent Addressable Relay Module W/ 2 Isolated Sets Of Form C Contacts"],
  ["IDP-CONTROL.", "IDP-CONTROL", "Intelligent Addressable Supervised Control Module"],
];

const golden = [
  ...clean.map(([left, right, description]) => ({ left: base(left, description), right: base(right, description), classification: "Punctuation difference", outcome: "Existing Product", terminalRule: "IR-040" })),
  { left: base("IDP-PHOTO-T-W.", "Intelligent Addressable Photoelectric Smoke Detector with Thermal (135ºF)(57ºC) (Base Not Included) (Ivory Color) (White Color)"), right: base("IDP-PHOTO-T-W", "Intelligent Addressable Photoelectric Smoke Detector with Thermal (135ºF)(57ºC) (Base Not Included) (Ivory Color) (White Color)"), classification: "Punctuation difference", outcome: "Needs Review", terminalRule: "IR-160" },
  { left: base("REL-4.7K-BP", "End Of Line Resistor; 4.7k With Leads; Qty. 10"), right: base("REL-47K-BP", "End Of Line Resistor; 47k With Leads; Qty. 10"), classification: "Different products", outcome: "Different Products", terminalRule: "IR-010" },
  { left: base("REL-4.7K", "End Of Line Resistor; 4.7k With Leads"), right: base("REL-47K", "End Of Line Resistor; 47k With Leads"), classification: "Different products", outcome: "Different Products", terminalRule: "IR-010" },
  { left: base("B501-WHITE-BP.", "Bulk pack of B501-WHITE contains 20"), right: base("B501-WHITE-BP", "Bulk pack of B501-WHITE contains 10"), classification: "Package quantity variant", outcome: "Needs Review", terminalRule: "IR-050" },
  { left: base("B401.", "Detector mounting base. - Made in India (EN-54 Listed)"), right: base("B401", "Detector mounting base. For conventional detectors."), classification: "Ambiguous", outcome: "Needs Review", terminalRule: "IR-160" },
  { left: base("B501-WHITE.", "White, 4” standard European flangeless mounting base. UL/ULC listed.Made in India"), right: base("B501-WHITE", "4” standard flangeless mounting base (White Color)"), classification: "Ambiguous", outcome: "Needs Review", terminalRule: "IR-160" },
  { left: base("IDP-PHOTO-R-W.", "Intelligent Photoelectric Replacement Smoke Detector remote test capable, for use with DNR (W) duct smoke detector (White Color)"), right: base("IDP-PHOTO-R-W", "Intelligent Photoelectric Replacement Smoke Detector remote test capable, for use with DNR (W) duct smoke detector (Ivory Color) (White Color)"), classification: "Ambiguous", outcome: "Needs Review", terminalRule: "IR-160" },
  { left: base("B501-IV.", "Ivory color, 4” standard European flangeless mounting base. UL/ULC listed. Made in India"), right: base("B501-IV", "4” standard flangeless mounting base (Ivory Color)"), classification: "Ambiguous", outcome: "Needs Review", terminalRule: "IR-160" },
  { left: base("IDP-HEAT-ROR-W.", "Intelligent Addressable Fixed temperature and rate-of rise thermal detector (Rate-of-rise detection 15ºF/min (9ºC/min) (Base Not Included)(Ivory Color)"), right: base("IDP-HEAT-ROR-W", "Intelligent Addressable Fixed temperature and rate-of rise thermal detector (Rate-of-rise detection 15ºF/min (9ºC/min) (Base Not Included)(Ivory Color)"), classification: "Ambiguous", outcome: "Needs Review", terminalRule: "IR-160" },
];

test("all rules IR-001 through IR-160 are present in deterministic priority order", () => {
  assert.deepEqual(IDENTITY_RULES.map((rule) => rule.id), ["IR-001", "IR-002", "IR-003", "IR-010", "IR-011", "IR-020", "IR-030", "IR-040", "IR-050", "IR-060", "IR-070", "IR-080", "IR-090", "IR-100", "IR-110", "IR-120", "IR-130", "IR-140", "IR-150", "IR-160"]);
  assert.ok(IDENTITY_RULES.every((rule, index) => index === 0 || rule.priority > IDENTITY_RULES[index - 1].priority));
});

test("complete 27-collision golden suite matches the approved Step 8 classifications", async () => {
  assert.equal(golden.length, 27);
  const results = await Promise.all(golden.map((entry, index) => analyzeIdentityPair(entry.left, entry.right, { conflictId: `golden-${index + 1}` })));
  results.forEach((result, index) => {
    assert.equal(result.classification, golden[index].classification, `classification case ${index + 1}`);
    assert.equal(result.outcome, golden[index].outcome, `outcome case ${index + 1}`);
    assert.equal(result.terminalRule, golden[index].terminalRule, `terminal rule case ${index + 1}`);
    assert.match(result.inputFingerprint, /^[a-f0-9]{64}$/);
    assert.match(result.proposalFingerprint, /^[a-f0-9]{64}$/);
    assert.ok(result.trace.every((entry) => entry.humanExplanation && entry.machineExplanation));
  });
  const summary = results.reduce((value, result) => { value[result.classification] = (value[result.classification] || 0) + 1; return value; }, {});
  assert.deepEqual(summary, { "Punctuation difference": 19, "Different products": 2, "Package quantity variant": 1, Ambiguous: 5 });
  assert.equal(results.filter((result) => result.terminalRule === "IR-040").length, 18);
  assert.equal(results.filter((result) => result.classification === "Punctuation difference" && result.outcome === "Needs Review").length, 1);
});

test("protected decimals make 4.7K and 47K unequal electrical values", async () => {
  const left = base("REL-4.7K", "End Of Line Resistor; 4.7k With Leads");
  const right = base("REL-47K", "End Of Line Resistor; 47k With Leads");
  assert.notDeepEqual(tokenizeOrderCode(left.partNumber), tokenizeOrderCode(right.partNumber));
  assert.deepEqual(extractElectricalTokens(left).map((entry) => entry.value), [4700]);
  assert.deepEqual(extractElectricalTokens(right).map((entry) => entry.value), [47000]);
  const result = await analyzeIdentityPair(left, right);
  assert.equal(result.outcome, "Different Products");
  assert.equal(result.reasonCode, "ELECTRICAL_VALUES_DIFFER");
});

test("kits, packages, replacements, and revisions never merge with products", async () => {
  const component = base("COMP-1", "Component");
  const kit = await analyzeIdentityPair(base("KIT-1", "Kit containing component"), component);
  assert.equal(kit.outcome, "Needs Review");
  assert.equal(kit.terminalRule, "IR-060");
  const replacement = await analyzeIdentityPair(base("OLD-1", "Old product"), base("NEW-1", "New product"), { replacementEvidence: [{ sourceId: "official-notice" }] });
  assert.equal(replacement.outcome, "Replacement");
  assert.notEqual(replacement.outcome, "Existing Product");
  const revision = await analyzeIdentityPair(base("MODEL-R1", "Revision one"), base("MODEL-R2", "Revision two"), { revisionEvidence: [{ sourceId: "revision-notice" }] });
  assert.equal(revision.outcome, "Needs Review");
  assert.equal(revision.relationship, "Revision");
  const packageResult = await analyzeIdentityPair(base("PACK-10", "Package contains 10"), component);
  assert.notEqual(packageResult.outcome, "Existing Product");
});

test("description similarity and known-versus-unknown discriminators fail closed", async () => {
  const similar = await analyzeIdentityPair(base("MODEL-A", "Identical description"), base("MODEL-B", "Identical description"));
  assert.notEqual(similar.outcome, "Existing Product");
  const unknown = await analyzeIdentityPair(base("MODEL-1", "Same product", { attributes: [{ name: "protocol", value: "SK" }] }), base("MODEL-1", "Same product", { attributes: [] }));
  assert.equal(unknown.outcome, "Needs Review");
  assert.ok(unknown.blockers.some((entry) => entry.field === "protocol" && entry.kind === "known-vs-unknown"));
});

test("identity and proposal fingerprints are stable and original codes remain distinct", async () => {
  assert.notEqual(buildIdentityKey("m", "B501."), buildIdentityKey("m", "B501"));
  assert.equal(buildTerminalPunctuationKey("m", "B501."), buildTerminalPunctuationKey("m", "B501"));
  const a = await analyzeIdentityPair(base("B501-BL.", "Black base"), base("B501-BL", "Black base"));
  const b = await analyzeIdentityPair(base("B501-BL.", "Black base"), base("B501-BL", "Black base"));
  assert.equal(a.inputFingerprint, b.inputFingerprint);
  assert.equal(a.proposalFingerprint, b.proposalFingerprint);
});

test("ruleset document is stable and explicitly forbids product merging", async () => {
  const first = await identityRulesetDocument(), second = await identityRulesetDocument();
  assert.equal(first.checksum, second.checksum);
  assert.equal(first.safetyPolicy.mergeProducts, false);
  assert.equal(first.safetyPolicy.descriptionCreatesIdentity, false);
  assert.equal(first.safetyPolicy.unknownEqualsKnown, false);
});
