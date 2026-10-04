import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCompatibility, parseCompatibilityRelations, extractSpecificationPages, extractAttributes } from "../app/domain/specification-extractor.mjs";
import {
  COMPATIBILITY_VOCABULARY, COMPAT_TERM_TYPES, COMPAT_PERSISTENCE_POLICY, RELATIONSHIP_MODES, classifyCompatibilityTarget, classifyCompatibilityTargets, decomposeCompatibilityTarget,
  persistencePolicyForType, isPersistableCompatibilityEntry, isGenericTargetPhrase, resolveStoredCompatibilityType, toCompatibilityRowShape,
} from "../app/domain/compatibility-vocabulary.mjs";

// R3 -- live compatibility persistence: typed targets, relationship sets, guards.
// Pure functions only (no DB, no matcher).

const rows = (text, options) => parseCompatibility(text, options);
const targets = (text, options) => rows(text, options).map((row) => `${row.targetItem}:${row.targetType}`);
const relation = (text, options) => parseCompatibilityRelations(text, options)[0];

// ---- target type model -------------------------------------------------------------
test("persistence eligibility is explicit for every governed target type (no duplicates, no gaps)", () => {
  assert.deepEqual(Object.keys(COMPAT_PERSISTENCE_POLICY).sort(), [...COMPAT_TERM_TYPES].sort(), "every governed type has a policy");
  assert.deepEqual(COMPAT_PERSISTENCE_POLICY, { PROTOCOL: "PERSIST", PANEL_ROLE: "PERSIST", CIRCUIT_BUS: "EVIDENCE_ONLY", TOPOLOGY: "EVIDENCE_ONLY", AMBIGUOUS: "NEVER", GUARD_STANDARD: "NEVER", GUARD_VENDOR: "NEVER" });
  assert.equal(Object.isFrozen(COMPAT_PERSISTENCE_POLICY), true);
  assert.equal(persistencePolicyForType(null), "PERSIST_UNTYPED", "unrecognized free text keeps the legacy behavior, flagged untyped");
  assert.equal(persistencePolicyForType("SOMETHING_NEW"), "NEVER", "an unknown type string never persists");
  assert.deepEqual([...RELATIONSHIP_MODES], ["SINGLE", "ALL_REQUIRED", "ANY_OF", "UNRESOLVED"]);
});

test("classifyCompatibilityTargets returns EVERY governed term in text order with longest-match overlaps", () => {
  assert.deepEqual(classifyCompatibilityTargets("Flash Scan® and CLIP protocol systems").map((hit) => `${hit.term}:${hit.type}`), ["FlashScan:PROTOCOL", "CLIP:PROTOCOL"]);
  assert.deepEqual(classifyCompatibilityTargets("Honeywell IDP panel on a two-wire SLC, Class A").map((hit) => hit.term), ["Honeywell", "IDP", "SLC", "Class A"]);
  assert.deepEqual(classifyCompatibilityTargets("two-wire SLC").map((hit) => hit.term), ["SLC"], "alias overlap resolves to one hit");
  assert.deepEqual(classifyCompatibilityTargets("Main FACP").map((hit) => hit.term), ["MFACP"]);
  assert.deepEqual(classifyCompatibilityTargets("the clip on the wall"), [], "lowercase verb 'clip' is never a protocol");
  assert.equal(classifyCompatibilityTarget("Flash Scan® and CLIP")?.term, "FlashScan", "the original single-hit classifier is unchanged");
});

// ---- 1. targetType survives the persistence-shape transformation ----------------------------
test("1. targetType survives: the stored row carries the canonical term and the type is recoverable at read time", () => {
  const parsed = rows("The panel shall be compatible with FlashScan and CLIP protocol systems.");
  assert.equal(parsed.length, 2);
  for (const entry of parsed) {
    const stored = toCompatibilityRowShape(entry);
    assert.deepEqual(Object.keys(stored), ["source_item", "target_item", "relationship_type", "mandatory", "confidence"], "exactly the existing columns; no column is overloaded");
    assert.equal(resolveStoredCompatibilityType(stored.target_item), entry.targetType);
    assert.equal(entry.targetType, "PROTOCOL");
  }
  assert.deepEqual(parsed.map((entry) => toCompatibilityRowShape(entry).target_item), ["FlashScan", "CLIP"]);
  const panel = rows("The devices shall be compatible with the FACP.")[0];
  assert.equal(resolveStoredCompatibilityType(toCompatibilityRowShape(panel).target_item), "PANEL_ROLE");
});

// ---- 2/3. guards -------------------------------------------------------------------------------
test("2. guarded, ambiguous and evidence-only targets never produce a compat row", () => {
  const cases = [
    ["The detectors shall be compatible with UL 268.", "GUARD_STANDARD"],
    ["The detectors shall be compatible with NFPA 72.", "GUARD_STANDARD"],
    ["The detectors shall be compatible with EN54.", "GUARD_STANDARD"],
    ["The detectors shall be compatible with Honeywell panels.", "GUARD_VENDOR"],
    ["The detectors shall be compatible with Notifier panels.", "GUARD_VENDOR"],
    ["The detectors shall be compatible with Farenhyt.", "GUARD_VENDOR"],
    ["The detectors shall be compatible with Class A wiring.", "TOPOLOGY"],
    ["The detectors shall be compatible with Style 6.", "TOPOLOGY"],
    ["The detectors shall be compatible with the SLC loop.", "CIRCUIT_BUS"],
    ["The detectors shall be compatible with two-wire SLC.", "CIRCUIT_BUS"],
    ["The module shall be compatible with IDP.", "AMBIGUOUS"],
  ];
  for (const [text, type] of cases) {
    assert.deepEqual(rows(text), [], text);
    const found = relation(text);
    assert.equal(found.targets[0].targetType, type, `${text}: still classified, never lost`);
    assert.ok(found.notPersisted.length > 0, text);
  }
});

test("3. SLC / Class / Style / standards / vendors never become PROTOCOL", () => {
  for (const term of ["SLC", "NAC", "two-wire SLC", "Class A", "Class B", "Style 4", "Style 6", "Style 7", "UL 268", "NFPA 72", "EN 54", "BS 5839", "Honeywell", "Notifier", "Farenhyt"]) {
    for (const hit of classifyCompatibilityTargets(term)) assert.notEqual(hit.type, "PROTOCOL", term);
  }
  assert.equal(classifyCompatibilityTarget("two-wire SLC").type, "CIRCUIT_BUS");
});

test("vendor mention alone is not interoperability, but a vendor qualifying a specific model keeps that model as an untyped target", () => {
  assert.deepEqual(rows("The detectors shall be compatible with Honeywell panels."), []);
  const model = rows("The detectors shall be compatible with Notifier NFS-3030 panels.");
  assert.equal(model.length, 1);
  assert.equal(model[0].targetType, null);
  assert.equal(model[0].note, "VENDOR_OR_AMBIGUOUS_TERM_QUALIFIES_SPECIFIC_MODEL");
  assert.deepEqual(rows("The detectors shall be compatible with UL 268 listed panels."), [], "a standard is never rescued by a qualifier");
});

test("IDP stays AMBIGUOUS: never persisted, never resolved without role evidence", () => {
  assert.equal(classifyCompatibilityTarget("IDP").type, "AMBIGUOUS");
  assert.deepEqual(rows("The module shall be compatible with IDP."), []);
  assert.deepEqual(rows("The module shall interface with IDP panel."), []);
  assert.equal(relation("The module shall be compatible with IDP.").targets[0].policy, "NEVER");
});

// ---- 4. multi-target decomposition ----------------------------------------------------------------
test("4. explicit AND decomposes into typed targets in one ALL_REQUIRED set", () => {
  const found = relation("The panel shall be compatible with FlashScan and CLIP protocol systems.");
  assert.equal(found.relationshipMode, "ALL_REQUIRED");
  assert.equal(found.targetPhrase, "FlashScan and CLIP protocol systems", "verbatim source evidence preserved");
  assert.deepEqual(found.rows.map((row) => [row.targetItem, row.targetType, row.relationshipMode, row.targetVerbatim]), [["FlashScan", "PROTOCOL", "ALL_REQUIRED", "FlashScan"], ["CLIP", "PROTOCOL", "ALL_REQUIRED", "CLIP"]]);
  assert.deepEqual(targets("The panel shall be compatible with Flash Scan® and CLIP protocols."), ["FlashScan:PROTOCOL", "CLIP:PROTOCOL"], "alias resolves to the canonical term; verbatim kept separately");
  assert.deepEqual(targets("The detectors shall be compatible with both FlashScan and CLIP."), ["FlashScan:PROTOCOL", "CLIP:PROTOCOL"]);
  assert.deepEqual(targets("The panel shall be compatible with FlashScan, CLIP and the FACP."), ["FlashScan:PROTOCOL", "CLIP:PROTOCOL", "FACP:PANEL_ROLE"]);
});

test("a single explicit target is one typed PROTOCOL row", () => {
  const found = relation("The detectors shall be compatible with FlashScan.");
  assert.equal(found.relationshipMode, "SINGLE");
  assert.deepEqual(found.rows.map((row) => [row.targetItem, row.targetType, row.relationshipMode]), [["FlashScan", "PROTOCOL", "SINGLE"]]);
});

test("OR is recognized as ANY_OF but is NOT persisted (no mode column: it would corrupt into an AND)", () => {
  for (const text of ["The detectors shall be compatible with FlashScan or CLIP.", "The detectors shall be compatible with either FlashScan or CLIP protocols."]) {
    const found = relation(text);
    assert.equal(found.relationshipMode, "ANY_OF", text);
    assert.deepEqual(found.rows, [], text);
    assert.equal(found.notPersisted[0].reason, "ANY_OF_NOT_REPRESENTABLE_WITHOUT_MODE_COLUMN");
    assert.deepEqual(found.targets.map((target) => target.term), ["FlashScan", "CLIP"], "the OR set is still reported, verbatim");
  }
});

test("bare multiple names without an explicit conjunction, mixed connectors and contradictory quantifiers stay unresolved", () => {
  const unresolved = {
    "The detectors shall be compatible with FlashScan CLIP.": "UNRECOGNIZED_CONNECTOR",
    "The detectors shall be compatible with FlashScan and CLIP or IDP.": "MIXED_CONNECTORS",
    "The detectors shall be compatible with either FlashScan and CLIP.": "CONTRADICTORY_QUANTIFIER",
    "The detectors shall be compatible with both FlashScan or CLIP.": "CONTRADICTORY_QUANTIFIER",
    "The detectors shall be compatible with FlashScan and/or CLIP.": "UNRECOGNIZED_CONNECTOR",
  };
  for (const [text, reason] of Object.entries(unresolved)) {
    const found = relation(text);
    assert.equal(found.relationshipMode, "UNRESOLVED", text);
    assert.deepEqual(found.rows, [], text);
    assert.equal(found.notPersisted[0].reason, reason, text);
  }
});

test("vague plural language never invents a target set", () => {
  for (const text of ["The detectors shall be compatible with protocol systems.", "The detectors shall be compatible with all protocols.", "The detectors shall be compatible with the other devices."]) {
    assert.deepEqual(rows(text), [], text);
    assert.equal(relation(text).notPersisted[0].reason, "GENERIC_TARGET_PHRASE", text);
  }
  assert.equal(isGenericTargetPhrase("protocol systems"), true);
  assert.equal(isGenericTargetPhrase("the control unit"), false);
});

test("an ambiguous or guarded member of an explicit AND set is dropped and reported, never actionable", () => {
  const found = relation("The detectors shall be compatible with FlashScan, CLIP and IDP.");
  assert.equal(found.relationshipMode, "ALL_REQUIRED");
  assert.deepEqual(found.rows.map((row) => row.targetItem), ["FlashScan", "CLIP"]);
  assert.deepEqual(found.notPersisted.map((entry) => entry.reason), ["TARGET_TYPE_AMBIGUOUS_NEVER"]);
});

test("negated relationships never become positive compatibility rows", () => {
  const found = relation("The devices shall not be compatible with FlashScan.");
  assert.equal(found.polarity, "NEGATED");
  assert.deepEqual(found.rows, []);
  assert.equal(found.notPersisted[0].reason, "NEGATED_RELATIONSHIP");
});

test("legacy free-text targets outside the vocabulary keep persisting, flagged untyped (no regression)", () => {
  const legacy = rows("Provide detector; it shall be compatible with Golden Fire Addressable Control Panel GF-CP-001, and shall include a detector base.");
  assert.deepEqual(legacy.map((row) => [row.targetItem, row.targetType, row.relationshipMode]), [["Golden Fire Addressable Control Panel GF-CP-001", null, "SINGLE"]]);
});

// ---- 5. mandatory propagation ---------------------------------------------------------------------------------
test("5. mandatory follows the containing requirement's normative force, not just a modal in the sentence", () => {
  const sentence = "The devices are compatible with FlashScan and CLIP protocol systems.";
  assert.deepEqual(rows(sentence, { requirementType: "Mandatory" }).map((row) => row.mandatory), [true, true], "modal-free feature item under a Mandatory parent");
  for (const type of ["Optional", "Preferred", "Conditional", "Informational", "Prohibited"]) assert.deepEqual(rows(sentence, { requirementType: type }).map((row) => row.mandatory), [false, false], type);
  assert.deepEqual(rows(sentence).map((row) => row.mandatory), [false, false], "legacy call without a type: sentence-modal test (no modal here)");
  assert.deepEqual(rows("The devices shall be compatible with FlashScan.").map((row) => row.mandatory), [true], "legacy call: modal present");
  assert.deepEqual(rows("The devices shall be compatible with FlashScan.", { requirementType: "Optional" }).map((row) => row.mandatory), [false], "an explicit Optional type wins over the modal");
  assert.equal(toCompatibilityRowShape(rows(sentence, { requirementType: "Mandatory" })[0]).mandatory, 1);
});

// ---- 6. Golden Requirement 197 -----------------------------------------------------------------------------------
const REQ197 = "Features: a) Sleek, low-profile, and aesthetically pleasing design b) Advanced thermistor technology for rapid response c) Rate-of-rise detection at 15°F (8.3°C) per minute d) Factory-set fixed temperature at 135°F (57°C); high-temperature model at 190°F (88°C) e) Individually addressable devices f) Compatible with Flash Scan® and CLIP protocol systems g) Rotary decimal addressing (range: 1-99 for CLIP systems, 1-159 for Flash Scan systems) h) Two-wire SLC connectivity i) Visible LEDs blink upon each device address cycle j) 360° viewable visual alarm indicators (two bi-color LEDs); green blink indicates normal operation, steady red signals alarm k) Integrated communications and built-in device-type identification l) Remote testing capability via control panel";

test("6. Golden req197 source yields an explicit typed FlashScan+CLIP set; two-wire SLC stays circuit evidence, not protocol", () => {
  const result = extractSpecificationPages([{ page: 11, lines: ["SECTION 28 46 00", "PART 2 - PRODUCTS", "5. Additionally, specify the types of detectors required as follows:", "See the detector family descriptions below.", REQ197] }]);
  const requirement = result.requirements.find((entry) => entry.originalText.startsWith("Features:"));
  assert.equal(requirement.requirementType, "Mandatory");
  assert.deepEqual(requirement.compatibility.map((entry) => [entry.targetItem, entry.targetType, entry.relationshipMode, entry.mandatory, entry.type]), [["FlashScan", "PROTOCOL", "ALL_REQUIRED", true, "Compatible With"], ["CLIP", "PROTOCOL", "ALL_REQUIRED", true, "Compatible With"]]);
  assert.ok(!requirement.compatibility.some((entry) => /SLC|Rotary|address/i.test(entry.targetItem)), "no SLC / address-range row");
  assert.equal(classifyCompatibilityTarget("Two-wire SLC connectivity").type, "CIRCUIT_BUS");
  assert.match(requirement.originalText, /Flash Scan® and CLIP protocol systems/, "verbatim source evidence is untouched");
});

test("6. Golden req197 P0 facts are unchanged: 135°F, 15°F/min, Addressable; 190°F is never attached", () => {
  const names = [...new Set(extractAttributes(REQ197).map((entry) => `${entry.name}|${entry.normalizedValue}`))].sort();
  assert.deepEqual(names, ["addressing|Addressable", "fixed_temperature_setpoint|135°F", "rate_of_rise_sensitivity|15°F/min"]);
});

// ---- 7/8. live persistence wiring and choke-point defense --------------------------------------------------------------
test("the persistence choke point rejects any foreign entry that is guarded, ambiguous, evidence-only, generic or negated", () => {
  const entry = (targetItem, targetType, extra = {}) => ({ sourceItem: "x", targetItem, type: "Compatible With", mandatory: true, confidence: 84, ...(targetType === undefined ? {} : { targetType }), ...extra });
  for (const [target, type] of [["UL", "GUARD_STANDARD"], ["Honeywell", "GUARD_VENDOR"], ["IDP", "AMBIGUOUS"], ["SLC", "CIRCUIT_BUS"], ["Class A", "TOPOLOGY"]]) assert.equal(isPersistableCompatibilityEntry(entry(target, type)), false, `${target}:${type}`);
  assert.equal(isPersistableCompatibilityEntry(entry("FlashScan", "PROTOCOL")), true);
  assert.equal(isPersistableCompatibilityEntry(entry("FACP", "PANEL_ROLE")), true);
  assert.equal(isPersistableCompatibilityEntry(entry("Golden Fire Panel GF-CP-001", null)), true);
  assert.equal(isPersistableCompatibilityEntry(entry("FlashScan", "PROTOCOL", { polarity: "NEGATED" })), false);
  assert.equal(isPersistableCompatibilityEntry(entry("protocol systems", null)), false);
  assert.equal(isPersistableCompatibilityEntry(entry("", "PROTOCOL")), false);
  // foreign producer with no targetType: derive from ALL terms, not just the first
  assert.equal(isPersistableCompatibilityEntry(entry("UL 268")), false);
  assert.equal(isPersistableCompatibilityEntry(entry("UL 268 and FlashScan")), false);
  assert.equal(isPersistableCompatibilityEntry(entry("Honeywell IDP panel")), false);
  assert.equal(isPersistableCompatibilityEntry(entry("FlashScan and CLIP protocol systems")), true);
  assert.equal(isPersistableCompatibilityEntry(entry("the control unit")), true);
});

test("both live writers filter through the choke point before INSERT (wiring proof)", () => {
  const api = readFileSync(new URL("../worker/specification-extraction-api.mjs", import.meta.url), "utf8");
  const background = readFileSync(new URL("../worker/specification-extraction-background.mjs", import.meta.url), "utf8");
  for (const source of [api, background]) assert.match(source, /import \{ isPersistableCompatibilityEntry \} from "\.\.\/app\/domain\/compatibility-vocabulary\.mjs"/);
  assert.match(api, /requirement\.compatibility\.filter\(isPersistableCompatibilityEntry\)\.forEach\(\(entry\) => statements\.push\(env\.DB\.prepare\("INSERT INTO requirement_compatibility/);
  assert.match(background, /const persistableCompatibility = \(requirement\.compatibility \|\| \[\]\)\.filter\(isPersistableCompatibilityEntry\);/);
  assert.match(background, /item < persistableCompatibility\.length/);
  assert.doesNotMatch(background, /requirement\.compatibility\[item\]/, "no unfiltered indexed write remains");
});

test("schema gap canary: requirement_compatibility still has no target_type / relationship_mode / set-id column", () => {
  const schema = readFileSync(new URL("../db/schema.ts", import.meta.url), "utf8");
  const block = schema.match(/export const requirementCompatibility = sqliteTable\([\s\S]*?\}\);?/);
  assert.ok(block, "table definition found");
  for (const column of ["targetType", "target_type", "relationshipMode", "relationship_mode", "setId", "set_id", "groupId", "group_id"]) assert.doesNotMatch(block[0], new RegExp(column), `${column}: if a migration adds this, R3's per-target-row workaround should be revisited`);
});

// ---- idempotency / duplicates ---------------------------------------------------------------------------------------------
test("extraction is deterministic and never duplicates a target inside one relationship", () => {
  const text = "The panel shall be compatible with FlashScan and CLIP protocol systems.";
  assert.deepEqual(rows(text), rows(text));
  assert.deepEqual(targets("The panel shall be compatible with FlashScan and FlashScan."), ["FlashScan:PROTOCOL"]);
  assert.deepEqual(decomposeCompatibilityTarget("FlashScan and CLIP").terms.map((term) => term.term), ["FlashScan", "CLIP"]);
  const ids = new Set(rows(text).map((row, index) => `req_compatibility_${index + 1}`));
  assert.equal(ids.size, 2, "the background writer's contiguous index ids stay unique over the eligible list");
});

test("relationship type is preserved (Compatible With vs Interface) on every decomposed row", () => {
  assert.deepEqual(rows("The module shall interface with FlashScan and CLIP.").map((row) => row.type), ["Interface", "Interface"]);
  assert.deepEqual(rows("The module shall be compatible with FlashScan and CLIP.").map((row) => row.type), ["Compatible With", "Compatible With"]);
});

test("the vocabulary itself is unchanged by R3 (24 terms, same types)", () => {
  assert.equal(COMPATIBILITY_VOCABULARY.length, 24);
});

// ---- standards citations beyond the 24-term vocabulary (found by the DB census) -----------------------------------------
test("standards citations (IEEE / ISO / EN / TIA ...) never become compat rows, even outside the P2 guard terms", () => {
  for (const text of [
    "The panel shall be compatible with IEEE Standard 802.",
    "The network shall be compatible with all IEEE 802.11 standards in use.",
    "The cabling shall be compatible with ISO 11801:2002, ISO 61156-5, EN 50173-1: A2:2011.",
    "The devices shall be compatible with EN 54-2.",
    "The devices shall be compatible with TIA-568 and ANSI 60.",
  ]) {
    assert.deepEqual(rows(text), [], text);
    assert.ok(relation(text).targets.every((target) => target.targetType === "GUARD_STANDARD"), text);
  }
  assert.deepEqual(classifyCompatibilityTargets("IEEE Standard 802").map((hit) => [hit.term, hit.type]), [["IEEE Standard 802", "GUARD_STANDARD"]]);
  assert.deepEqual(classifyCompatibilityTargets("UL 268 and UL 217").map((hit) => hit.term), ["UL 268", "UL 217"], "a citation outranks the shorter 'UL' vocabulary hit");
});

test("ONVIF is an interoperability profile, not a standards listing: it is not guarded", () => {
  assert.deepEqual(classifyCompatibilityTargets("ONVIF Profile S"), []);
  assert.deepEqual(rows("The cameras shall be compatible with ONVIF Profile S.").map((row) => [row.targetItem, row.targetType]), [["ONVIF Profile S", null]]);
});

test("the choke point checks the target text even when the producer declared it untyped (null) or typed PROTOCOL", () => {
  const entry = (targetItem, targetType) => ({ sourceItem: "x", targetItem, targetType, type: "Compatible With", mandatory: true, confidence: 84 });
  for (const target of ["IEEE Standard 802", "all IEEE 802.11 standards in use", "ISO 11801:2002, ISO 61156-5, EN 50173-1: A2:2011,"]) assert.equal(isPersistableCompatibilityEntry(entry(target, null)), false, target);
  assert.equal(isPersistableCompatibilityEntry(entry("FlashScan and UL 268", "PROTOCOL")), false, "a typed entry cannot smuggle a standard inside its text");
  assert.equal(isPersistableCompatibilityEntry(entry("ONVIF Profile S", null)), true);
});
