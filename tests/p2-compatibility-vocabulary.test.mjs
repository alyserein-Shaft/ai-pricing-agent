import test from "node:test";
import assert from "node:assert/strict";
import { parseCompatibility } from "../app/domain/specification-extractor.mjs";
import { classifyCompatibilityTarget, isMatchableCompatType, COMPATIBILITY_VOCABULARY } from "../app/domain/compatibility-vocabulary.mjs";

// P2 compatibility pack: typed targets, explicit verbs only, guards hold.

test("vocabulary types cover the required semantic distinctions", () => {
  const types = new Set(COMPATIBILITY_VOCABULARY.map((entry) => entry.type));
  for (const t of ["PROTOCOL", "CIRCUIT_BUS", "TOPOLOGY", "PANEL_ROLE", "AMBIGUOUS", "GUARD_STANDARD", "GUARD_VENDOR"]) assert.ok(types.has(t), t);
});

test("FlashScan and CLIP classify PROTOCOL; SLC/Class/Style classify non-protocol", () => {
  assert.deepEqual(classifyCompatibilityTarget("Flash Scan® and CLIP protocol systems"), { term: "FlashScan", type: "PROTOCOL" });
  assert.deepEqual(classifyCompatibilityTarget("CLIP protocol systems").type, "PROTOCOL");
  assert.equal(classifyCompatibilityTarget("two-wire SLC").type, "CIRCUIT_BUS");
  assert.equal(classifyCompatibilityTarget("Class A wiring").type, "TOPOLOGY");
  assert.equal(classifyCompatibilityTarget("Style 4").type, "TOPOLOGY");
  assert.equal(classifyCompatibilityTarget("MFACP").type, "PANEL_ROLE");
});

test("IDP stays AMBIGUOUS without role evidence", () => {
  assert.equal(classifyCompatibilityTarget("IDP series detectors").type, "AMBIGUOUS");
  assert.equal(isMatchableCompatType("AMBIGUOUS"), false);
});

test("only PROTOCOL is matchable", () => {
  assert.equal(isMatchableCompatType("PROTOCOL"), true);
  for (const t of ["CIRCUIT_BUS", "TOPOLOGY", "PANEL_ROLE", "AMBIGUOUS", "GUARD_STANDARD", "GUARD_VENDOR", null, "UNKNOWN"]) assert.equal(isMatchableCompatType(t), false, String(t));
});

test("parser emits typed FlashScan/CLIP target with explicit verb", () => {
  const out = parseCompatibility("e) Individually addressable devices f) Compatibility with FlashScan and CLIP protocols. g) Rotary addressing.");
  // R3: "FlashScan and CLIP" is two typed PROTOCOL targets, not one collapsed string.
  assert.deepEqual(out.map((entry) => [entry.targetItem, entry.targetType]), [["FlashScan", "PROTOCOL"], ["CLIP", "PROTOCOL"]]);
});

test("noun-form does not fire on bare mention without relationship", () => {
  assert.deepEqual(parseCompatibility("FlashScan is a communication protocol."), []);
  assert.deepEqual(parseCompatibility("The strobe device should comply with UL 1971 standards."), []);
});

test("SAFETY: UL/NFPA listings never become compatibility targets", () => {
  assert.deepEqual(parseCompatibility("Detectors must be UL certified to UL 217 and UL 268."), []);
  assert.deepEqual(parseCompatibility("Each SLC must accommodate NFPA 72 Style 4 wiring."), []);
  for (const std of ["UL 1971", "UL 268", "NFPA 72"]) assert.notEqual(classifyCompatibilityTarget(std)?.type, "PROTOCOL", std);
});

test("SAFETY: Class A/B and Style 4/6/7 never classify as protocol", () => {
  for (const t of ["Class A", "Class B", "Style 4", "Style 6", "Style 7"]) assert.notEqual(classifyCompatibilityTarget(t)?.type, "PROTOCOL", t);
});

test("SAFETY: SLC alone and address ranges never classify as protocol", () => {
  assert.equal(classifyCompatibilityTarget("two-wire SLC").type, "CIRCUIT_BUS");
  assert.equal(classifyCompatibilityTarget("1-99 on CLIP systems").type, "PROTOCOL");
  assert.equal(classifyCompatibilityTarget("Connects via two-wire SLC.").type, "CIRCUIT_BUS");
});

test("SAFETY: vendor names never prove compatibility", () => {
  for (const v of ["Honeywell", "Notifier", "Farenhyt", "Simplex"]) {
    assert.equal(classifyCompatibilityTarget(v).type, "GUARD_VENDOR", v);
    assert.equal(isMatchableCompatType("GUARD_VENDOR"), false);
  }
  assert.deepEqual(parseCompatibility("Approved vendor list: Honeywell – U.S.A."), []);
});

test("SAFETY: same-parent-company text yields no target", () => {
  assert.deepEqual(parseCompatibility("All panels and devices shall be manufactured by a single reputable organization."), []);
});

test("rejected broad verbs stay rejected (five-party-calls regression)", () => {
  assert.deepEqual(parseCompatibility("The system supports five-party calls between handsets."), []);
  assert.deepEqual(parseCompatibility("Panels must support networking with up to 99 additional nodes."), []);
});
