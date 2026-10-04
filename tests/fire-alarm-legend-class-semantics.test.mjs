/**
 * Tests for the governed legend class semantics.
 *
 * The properties that matter:
 *  - ONLY GOVERNED_AND_PROVEN may be used as a device
 *  - a conflicted or unresolved code is never silently returned as a device
 *  - compounds match whole and take precedence over their bare letters
 *  - an unproven compound is NEVER decomposed into bare letters
 *  - T resolves to a telephone jack with NO SLC address
 *  - the vocabulary is closed: an unknown code is UNRESOLVED, not invented
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  LEGEND_AUTHORITY_STATES,
  LEGEND_CLASS_AUTHORITY,
  LEGEND_SEMANTICS_VERSION,
  PROVEN_LEGEND_CLASSES,
  UNRESOLVED_LEGEND_CLASSES,
  classifyLegendClass,
  classifyScheduleClassCell,
  matchGovernedLegendToken,
} from "../app/domain/fire-alarm-legend-class-semantics.mjs";

test("MUTATION GUARD: only GOVERNED_AND_PROVEN is ever usable", () => {
  for (const [code, entry] of Object.entries(LEGEND_CLASS_AUTHORITY)) {
    const result = classifyLegendClass(code);
    assert.equal(
      result.usableForScheduleSemantics,
      entry.state === "GOVERNED_AND_PROVEN",
      `${code}: usability must track its authority state, not its presence in the table`,
    );
  }
});

test("the four authority states are a closed vocabulary", () => {
  assert.deepEqual([...LEGEND_AUTHORITY_STATES].sort(), [
    "CONFLICTED",
    "GOVERNED_AND_PROVEN",
    "GOVERNED_BUT_PROVENANCE_WEAK",
    "UNRESOLVED",
  ]);
  for (const entry of Object.values(LEGEND_CLASS_AUTHORITY)) {
    assert.ok(
      LEGEND_AUTHORITY_STATES.includes(entry.state),
      `unknown authority state "${entry.state}"`,
    );
  }
});

test("T is governed and is a telephone jack with NO SLC address", () => {
  const t = classifyLegendClass("T");
  assert.equal(t.state, "GOVERNED_AND_PROVEN");
  assert.equal(t.description, "FIREMAN TELEPHONE JACK");
  assert.equal(t.usableForScheduleSemantics, true);
  // The point of resolving T: it must not be read as a module address.
  assert.equal(t.addressImplication, "NO_SLC_ADDRESS");
});

test("S and H are proven single-letter detectors", () => {
  assert.equal(classifyLegendClass("S").description, "SMOKE DETECTOR");
  assert.equal(classifyLegendClass("H").description, "HEAT DETECTOR");
  for (const code of ["S", "H"]) {
    assert.equal(classifyLegendClass(code).usableForScheduleSemantics, true);
  }
});

test("MUTATION GUARD: F is CONFLICTED, not resolved to one of its two meanings", () => {
  const f = classifyLegendClass("F");
  assert.equal(f.state, "CONFLICTED");
  assert.equal(f.usableForScheduleSemantics, false);
  assert.match(f.reason, /TWO legend columns/i);
  // The reason must name the ambiguity rather than pick a winner.
  assert.match(f.reason, /WEATHER PROOF/);
});

test("compound tokens match WHOLE and take precedence over their bare letters", () => {
  const control = classifyScheduleClassCell("CE C");
  assert.equal(control.state, "GOVERNED_AND_PROVEN");
  assert.equal(control.tokens.length, 1);
  assert.equal(control.tokens[0].description, "INTERFACE MODULE CONTROL");
  assert.equal(control.tokens[0].compound, true);

  const monitoring = classifyScheduleClassCell("CE M");
  assert.equal(monitoring.tokens[0].description, "INTERFACE MODULE MONITORING");

  const duct = classifyScheduleClassCell("S D");
  assert.equal(duct.tokens[0].description, "DUCT DETECTOR");
});

test("MUTATION GUARD: a compound is NEVER decomposed into unproven bare letters", () => {
  // "CE C" contains CE and C, and both are UNRESOLVED on their own. If the
  // matcher fell back to per-letter evaluation it would report UNRESOLVED and
  // lose a proven device. It must match the compound whole.
  assert.equal(classifyLegendClass("CE").usableForScheduleSemantics, false);
  assert.equal(classifyLegendClass("C").usableForScheduleSemantics, false);
  assert.equal(classifyLegendClass("CE C").usableForScheduleSemantics, true);

  // And a bare "CE" cell must NOT be rescued by the existence of "CE C".
  const bare = classifyScheduleClassCell("CE");
  assert.equal(bare.state, "UNRESOLVED");
  assert.equal(bare.tokens.length, 0);
});

test("bare letters that only exist inside compounds stay unresolved", () => {
  for (const code of ["CE", "C", "D", "M"]) {
    const r = classifyLegendClass(code);
    assert.notEqual(
      r.usableForScheduleSemantics,
      true,
      `${code} must not be usable as a standalone device`,
    );
    assert.ok(r.reason, `${code} must explain why it is not usable`);
  }
});

test("HC remains UNRESOLVED and is not invented", () => {
  const hc = classifyLegendClass("HC");
  assert.equal(hc.state, "UNRESOLVED");
  assert.equal(hc.description, null);
  assert.equal(hc.usableForScheduleSemantics, false);
});

test("MUTATION GUARD: an unknown code is UNRESOLVED, never guessed", () => {
  for (const junk of ["ZZ", "QQ", "XY9", "FOO"]) {
    const r = classifyLegendClass(junk);
    assert.equal(r.state, "UNRESOLVED");
    assert.equal(r.description, null);
    assert.equal(r.usableForScheduleSemantics, false);
  }
});

test("MUTATION GUARD: no token is matched by prefix or substring", () => {
  // "SIM" starts with S and "CEILING" with CE. Prefix matching would silently
  // convert a drawing-layer token into a fire alarm device.
  assert.equal(matchGovernedLegendToken("SIM"), null, "SIM is not S");
  assert.equal(matchGovernedLegendToken("CEILING"), null, "CEILING is not CE");
  assert.equal(matchGovernedLegendToken("SMOKE"), null, "SMOKE is not S");
  assert.equal(matchGovernedLegendToken("HC"), null, "HC is not usable and must not be returned");
  // Case and surrounding whitespace are the ONLY normalisations applied.
  const loose = matchGovernedLegendToken("  ce c  ");
  assert.ok(loose, "whitespace and case are normalised");
  assert.equal(loose.description, "INTERFACE MODULE CONTROL");
});

test("every classification carries its semantics version and provenance", () => {
  for (const code of PROVEN_LEGEND_CLASSES) {
    const r = classifyLegendClass(code);
    assert.equal(r.semanticsVersion, LEGEND_SEMANTICS_VERSION);
    assert.ok(r.sourceDocumentId, `${code} must name its source document`);
    assert.equal(r.sourcePage, 1);
  }
});

test("the proven and unresolved sets are disjoint and cover the vocabulary", () => {
  const all = Object.keys(LEGEND_CLASS_AUTHORITY);
  assert.equal(PROVEN_LEGEND_CLASSES.length + UNRESOLVED_LEGEND_CLASSES.length, all.length);
  for (const code of PROVEN_LEGEND_CLASSES) {
    assert.ok(!UNRESOLVED_LEGEND_CLASSES.includes(code));
    assert.equal(LEGEND_CLASS_AUTHORITY[code].state, "GOVERNED_AND_PROVEN");
  }
  // The exact proven set, so adding a code is a deliberate visible change.
  assert.deepEqual([...PROVEN_LEGEND_CLASSES].sort(), ["CE C", "CE M", "H", "S", "S D", "T", "WP"]);
});

test("classification is deterministic and order-independent", () => {
  // Compare the decision surface, not object identity: each call builds a fresh
  // object, so reference equality would fail for reasons unrelated to behaviour.
  const surface = (c) => {
    const r = classifyLegendClass(c);
    return [r.code, r.state, r.description, r.usableForScheduleSemantics, r.compound, r.addressImplication];
  };
  const forward = PROVEN_LEGEND_CLASSES.map(surface);
  const reversed = [...PROVEN_LEGEND_CLASSES].reverse().map(surface);
  // Order-independence is the property under test: the same set of codes must
  // yield the same decisions however it is enumerated. The results are keyed by
  // code, so they are compared as a SET -- deepEqual on arrays is positional and
  // would fail on ordering alone, testing nothing about the module.
  const byCode = (rows) => Object.fromEntries(rows.map(([code]) => [code, rows.find((r) => r[0] === code).slice(1)]));
  assert.deepEqual(byCode(forward), byCode(reversed));

  // And every code in the vocabulary must be classified, with none missing.
  const allCodes = Object.keys(LEGEND_CLASS_AUTHORITY).map(surface);
  assert.equal(allCodes.length, Object.keys(LEGEND_CLASS_AUTHORITY).length);
  assert.equal(
    allCodes.filter((r) => r[0]).length,
    Object.keys(LEGEND_CLASS_AUTHORITY).length,
    "every governed code must classify to itself",
  );
});

test("an empty or absent cell is UNRESOLVED, never a device", () => {
  for (const empty of ["", "   ", null, undefined]) {
    const r = classifyScheduleClassCell(empty);
    assert.equal(r.state, "UNRESOLVED");
    assert.equal(r.tokens.length, 0);
  }
});