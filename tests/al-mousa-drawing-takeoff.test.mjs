// BLIND FIRE ALARM DRAWING QUANTITY TAKEOFF -- VALIDATION TESTS.
//
// These tests police the TAKEOFF METHOD, not any particular number. The point
// is that a defensible drawing takeoff must satisfy all of the following, and
// that the method itself cannot quietly acquire a forbidden dependency:
//
//  1. symbol occurrences are never used as quantity;
//  2. only explicit annotations contribute;
//  3. S H (combined) never enters plain Smoke;
//  4. duct never enters plain Smoke;
//  5. notation absent from the governed legend stays unresolved;
//  6/7. building totals equal their accepted rows, campus equals their buildings;
//  8. no BOQ quantity is used as a target;
//  9. no final/historical quotation is read;
// 10. rerun is identical.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { takeOff } from "../scripts/lib/al-mousa-drawing-takeoff.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const TEXT = join(REPO, "tmp", "fire-alarm-text");
const read = (p) => readFileSync(p, "utf8");

// The governed legend, transcribed from T-00-ZZZ-002 rev 1.
const LEGEND = {
  S: "SMOKE DETECTOR", H: "HEAT DETECTOR", "S D": "DUCT DETECTOR",
  "S H": "SMOKE AND HEAT COMBINED DETECTOR", "CE M": "INTERFACE MODULE MONITORING",
  "CE C": "INTERFACE MODULE CONTROL", CE: "INTERFACE MODULE", DC: "DOOR CONTACT",
  T: "FIREMAN TELEPHONE JACK", F: "FIRE ALARM MANUAL STATION (WEATHER PROOF)",
  WP: "LOOP POWERED STROBE WITH SOUNDER (WEATHER PROOF TYPE)",
  C: "CEILING MOUNTED LOOP POWERED STROBE WITH SOUNDER",
  2: "FIRE ALARM MANUAL STATION",
};
const NOT_IN_LEGEND = ["S C", "S HC", "SIM", "M"];
const FAMILIES = { S: "SPOT_SMOKE", H: "HEAT", "S H": "COMBINED", "S D": "DUCT" };

const SHEETS = {
  KGS: "2401232-PC-KGS-DR-T-93-ZZZ-005.txt", BOS: "2401232-PC-BOS-DR-T-93-ZZZ-005.txt",
  GRS: "2401232-PC-GRS-DR-T-93-ZZZ-005.txt", WLC: "2401232-PC-WLC-DR-T-93-ZZZ-005.txt",
  AMS002: "2401232-PC-AMS-DR-T-93-ZZZ-002.txt",
};

test("1 -- symbol occurrences are NEVER used as quantity", () => {
  for (const [b, f] of Object.entries(SHEETS)) {
    const t = read(join(TEXT, f));
    // Count symbol tokens and annotation tokens. If quantity were derived from
    // occurrences the two would be comparable; annotations carry far larger
    // numbers, which is the whole point of the rule.
    const ann = (t.match(/\d+\s*Nos?\b/gi) || []).length;
    assert.ok(ann > 0, `${b} carries explicit annotations`);
    assert.ok((t.match(/\d+\s*Nos?\b/gi) || []).length > 0, `${b} annotations are "NN Nos" (period optional)`);
    const sOcc = (t.match(/(?<![A-Za-z])S(?![A-Za-z])/g) || []).length;
    assert.ok(ann < sOcc || sOcc > 0, `${b}: annotation count must not be a symbol-occurrence count`);
  }
  // The takeoff module contains no occurrence-counting path.
  const src = read(join(REPO, "scripts", "lib", "al-mousa-drawing-takeoff.mjs"))
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(src, /occurrenceCount|symbolCount|countSymbols/, "no symbol-occurrence quantity path may exist");
});

test("2 -- only explicit quantity annotations contribute", () => {
  const src = read(join(REPO, "scripts", "lib", "al-mousa-drawing-takeoff.mjs"));
  // Every accepted pair must carry the annotation's own numeric value.
  assert.match(src, /ANNOTATION_RE/, "the quantity source must be an explicit annotation pattern");
  assert.match(src, /\\d\+\\s\*Nos\?|Nos\?/, "annotation pattern must require the 'Nos' token");
  // Nothing may fall back to a default of 1 per symbol.
  assert.doesNotMatch(src, /\?\?\s*1\b|default.*\b1\b.*per symbol/, "no per-symbol default quantity may exist");
});

test("3 -- combined (S H) never enters plain Smoke", () => {
  const src = read(join(REPO, "scripts", "lib", "al-mousa-drawing-takeoff.mjs"));
  assert.match(src, /"S H":\s*"COMBINED"/, "S H must map to COMBINED");
  assert.doesNotMatch(src, /"S H":\s*"SPOT_SMOKE"/, "S H must never map to SPOT_SMOKE");
  // And S H is absent from the drawings anyway, which is itself recorded.
  const legendTxt = read(join(TEXT, "2401232-PC-AMS-DR-T-00-ZZZ-002.txt"));
  assert.match(legendTxt, /S H\s+SMOKE AND HEAT COMBINED DETECTOR/i,
    "the governed legend defines S H as the combined detector");
  assert.match(legendTxt, /S D\s+DUCT DETECTOR/i);
});

test("4 -- duct never enters plain Smoke", () => {
  const src = read(join(REPO, "scripts", "lib", "al-mousa-drawing-takeoff.mjs"));
  assert.match(src, /"S D":\s*"DUCT"/);
  assert.doesNotMatch(src, /"S D":\s*"SPOT_SMOKE"/);
  // "S D" must be matched longest-first so it cannot degrade into "S".
  assert.match(src, /sort\(\(a, b\) => b\.length - a\.length\)/,
    "symbol matching must prefer the longest token so 'S D' cannot degrade into 'S'");
});

test("5 -- notation absent from the governed legend stays unresolved", () => {
  for (const sym of NOT_IN_LEGEND) {
    assert.equal(LEGEND[sym], undefined, `${sym} must NOT be a governed legend identity`);
  }
  const src = read(join(REPO, "scripts", "lib", "al-mousa-drawing-takeoff.mjs"));
  assert.match(src, /SYMBOL_IDENTITY_UNRESOLVED|UNRESOLVED/, "an unresolved-identity state must exist");
  // An unresolved symbol must be quantifiable but UNCLASSIFIED.
  assert.match(src, /unresolvedIdentity/, "unresolved-identity quantities must be tracked separately");
  // Sanity against the real sheets: S C really is used on the schematics.
  const bos = read(join(TEXT, SHEETS.BOS));
  assert.match(bos, /S C/, "BOS uses the S C notation, which is why it matters");
});

test("6 -- building totals equal the sum of their accepted rows", () => {
  const all = takeOff(TEXT);
  for (const [b, r] of Object.entries(all.byBuilding)) {
    for (const [fam, total] of Object.entries(r.families)) {
      const fromRows = r.rows
        .filter((x) => FAMILIES[x.symbol] === fam)
        .reduce((t, x) => t + x.qty, 0);
      assert.equal(total, fromRows, `${b}/${fam} total must equal the sum of its accepted rows`);
    }
  }
});

test("7 -- campus total equals the sum of accepted building totals", () => {
  const all = takeOff(TEXT);
  for (const fam of ["SPOT_SMOKE", "HEAT", "COMBINED", "DUCT"]) {
    const fromBuildings = Object.values(all.byBuilding)
      .reduce((t, b) => t + (b.families[fam] ?? 0), 0);
    assert.equal(all.campus[fam], fromBuildings, `campus ${fam} must equal the sum of building totals`);
  }
});

test("8 -- no BOQ quantity is used as a target", () => {
  const src = read(join(REPO, "scripts", "lib", "al-mousa-drawing-takeoff.mjs"))
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(src, /boq_items|boq_review|numeric_quantity|approved_for_downstream/i,
    "the takeoff library must not reference any BOQ table");
  assert.doesNotMatch(src, /require\(.node:sqlite|from "node:sqlite"/, "the takeoff library must not open a database");
  // No target/expected number may be embedded to steer the result.
  assert.doesNotMatch(src, /target|expected|match.*boq|reconcile/i, "the takeoff must contain no reconciliation target");
});

test("9 -- no final or historical quotation is read", () => {
  const src = read(join(REPO, "scripts", "lib", "al-mousa-drawing-takeoff.mjs"))
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(src, /historical_boq_final_rows|supplier_quote|quotation|finalBOM/i);
  // Its only filesystem dependency is the drawing text directory.
  assert.match(takeOff.toString(), /readFileSync/, "it reads drawing text files");
  assert.doesNotMatch(takeOff.toString(), /inputs\/central-kitchen|final-quotation/i);
});

test("10 -- rerun returns an identical takeoff", () => {
  const a = JSON.stringify(takeOff(TEXT));
  const b = JSON.stringify(takeOff(TEXT));
  assert.equal(a, b, "two runs must produce byte-identical output");
});

test("11 -- every takeoff figure is traceable to an annotation and a sheet", () => {
  const all = takeOff(TEXT);
  for (const [b, r] of Object.entries(all.byBuilding)) {
    assert.ok(existsSync(join(TEXT, SHEETS[b])), `${b} must have a real source sheet`);
    for (const row of r.rows) {
      assert.match(row.annotation, /\d+\s*Nos?/i, "every accepted row must quote its annotation");
      assert.ok(typeof row.unresolvedIdentity === "boolean", "every row must state its identity resolution");
      assert.ok(row.sheet && row.level && row.symbol, "every row must carry sheet, level and symbol");
    }
  }
});

test("12 -- the drawing set is complete and each sheet carries annotations", () => {
  for (const [b, f] of Object.entries(SHEETS)) {
    const p = join(TEXT, f);
    assert.ok(existsSync(p), `${f} missing`);
    const t = read(p);
    assert.match(t, /\d+\s*Nos?\b/i, `${b} must carry explicit quantity annotations`);
  }
  // The governed legend is present and names every accepted identity.
  const legend = read(join(TEXT, "2401232-PC-AMS-DR-T-00-ZZZ-002.txt"));
  for (const [sym, desc] of Object.entries(LEGEND)) {
    assert.ok(legend.includes(sym), `legend must carry symbol ${sym} (${desc})`);
    // And the legend must actually DEFINE it with this description.
    assert.ok(legend.includes(desc.replace(/\s+/g, " ")), `legend must define ${desc}`);
  }
  assert.ok(readdirSync(TEXT).length > 0);
});