// AL MOUSA -- DRAWING / BOQ SEMANTIC RECONCILIATION: MANDATED REGRESSION COVERAGE.
//
// READ-ONLY. These tests police the RECONCILIATION METHOD and lock in the
// evidence findings of this slice. They make no governed write and touch no
// final, historical or commercial output.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import {
  PROJECT, SEMANTIC_STATUS, boqFamily, boqBlocks, drawingByBuilding,
  stationDrawing, judgeDelta, DELTA_CLASS, geo, ABOVE_CEILING_CANDIDATE,
} from "../scripts/lib/al-mousa-drawing-boq-reconciliation.mjs";
import {
  GOVERNED_LABEL_FAMILY, DETECTOR_FAMILIES, takeOffSheet,
} from "../scripts/lib/al-mousa-drawing-geometry-takeoff.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "scripts", "lib", "al-mousa-drawing-boq-reconciliation.mjs");
const code = readFileSync(SRC, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const dbFile = process.env.FA_DB;
const db = dbFile ? new DatabaseSync(dbFile, { readOnly: true }) : null;

test("1 -- 'S C' is treated as a CANDIDATE mapping, never an assumed one", () => {
  // The geometry module must NOT silently resolve 'S C' into a detector family.
  assert.equal(GOVERNED_LABEL_FAMILY["S C"], undefined, "'S C' is not a governed legend label");
  assert.ok(ABOVE_CEILING_CANDIDATE.includes("CANDIDATE"), "the mapping is named as a candidate");
  assert.ok(!Object.values(GOVERNED_LABEL_FAMILY).includes("ABOVE_CEILING"),
    "the geometry module never invents an above-ceiling family from a legend gap");
  // The reconciliation module must carry the candidate label, not a settled one.
  assert.match(code, /SMOKE_ABOVE_CEILING_CANDIDATE/);
  assert.match(code, /boqFamily/);
});

test("2 -- the governed T-00 legend itself mandates a ceiling-void smoke population", () => {
  if (!db) return;
  const legendIntake = "drawingIntake_a2a136f5-ddea-47c9-884a-c05445c1c56d";
  const texts = db.prepare(
    "SELECT text_content FROM drawing_assets WHERE intake_version_id=? AND asset_type='Text'",
  ).all(legendIntake).map((r) => String(r.text_content || ""));
  const joined = texts.join(" ");
  assert.ok(/ALL THE VOID AREAS NEEDS TO BE PROVIDED WITH CEILING VOID SMOKE/.test(joined),
    "the legend note requires ceiling-void smoke detectors");
  assert.ok(/ABOVE CEILING AND IN SLAB/.test(joined),
    "the legend note places them above ceiling and in slab");
  assert.ok(/DETECTORS WITH REMOTE INDICATORS AS PER KFD REQUIREMENTS/.test(joined),
    "the legend note requires remote indication");
  // Independent first-party corroboration from the specification.
  const clause = db.prepare(
    `SELECT COUNT(*) c FROM technical_requirements WHERE project_id=?
       AND original_text LIKE '%ceiling or floor voids%'`,
  ).get(PROJECT).c;
  assert.ok(clause >= 1, "the specification independently requires detectors in ceiling/floor voids");
});

test("3 -- the BOQ carries above-ceiling and below-ceiling smoke as SEPARATE rows", () => {
  assert.equal(boqFamily("Smoke detectors (above ceiling)"), SEMANTIC_STATUS.ABOVE_CEILING);
  assert.equal(boqFamily("Smoke detectors (below ceiling)"), SEMANTIC_STATUS.BELOW_CEILING);
  assert.equal(boqFamily("Smoke detectors on slab"), SEMANTIC_STATUS.ON_SLAB);
  assert.notEqual(boqFamily("Smoke detectors (above ceiling)"), boqFamily("Smoke detectors (below ceiling)"),
    "the two populations must never collapse into one family");
  if (!db) return;
  const blocks = boqBlocks(db, PROJECT);
  const campus = blocks.filter((b) => b.stations.length === 0 && Object.keys(b.families).length);
  assert.equal(campus.length, 4, "four campus-wide BOQ blocks");
  for (const b of campus) {
    assert.ok(b.families[SEMANTIC_STATUS.ABOVE_CEILING] > 0, `block ${b.block} has an above-ceiling row`);
    assert.ok(b.families[SEMANTIC_STATUS.BELOW_CEILING] > 0, `block ${b.block} has a below-ceiling row`);
  }
});

test("4 -- a block/building match must rest on a MULTI-family fingerprint", () => {
  if (!db) return;
  const blocks = boqBlocks(db, PROJECT);
  const draw = drawingByBuilding(geo);
  const FP = [ABOVE_CEILING_CANDIDATE, SEMANTIC_STATUS.BELOW_CEILING, SEMANTIC_STATUS.HEAT,
    SEMANTIC_STATUS.COMBINED, SEMANTIC_STATUS.DUCT, "MANUAL_STATION_TOTAL"];
  const boqFp = (b) => ({
    [ABOVE_CEILING_CANDIDATE]: b.families[SEMANTIC_STATUS.ABOVE_CEILING] ?? null,
    [SEMANTIC_STATUS.BELOW_CEILING]: b.families[SEMANTIC_STATUS.BELOW_CEILING] ?? null,
    [SEMANTIC_STATUS.HEAT]: b.families[SEMANTIC_STATUS.HEAT] ?? null,
    [SEMANTIC_STATUS.COMBINED]: b.families[SEMANTIC_STATUS.COMBINED] ?? null,
    [SEMANTIC_STATUS.DUCT]: b.families[SEMANTIC_STATUS.DUCT] ?? null,
    MANUAL_STATION_TOTAL: (b.families[SEMANTIC_STATUS.MANUAL] ?? 0) + (b.families[SEMANTIC_STATUS.MANUAL_WP] ?? 0),
  });
  const buildings = Object.keys(draw).filter((b) => b !== "SUB STATION / DG");
  const campus = blocks.filter((b) => b.stations.length === 0 && Object.keys(b.families).length);
  const results = [];
  for (const b of campus) {
    for (const bl of buildings) {
      let exact = 0;
      for (const f of FP) {
        const bv = boqFp(b)[f]; const dv = draw[bl].families[f] ?? null;
        if (bv !== null && dv !== null && bv === dv) exact += 1;
      }
      results.push({ block: b.block, bl, exact });
    }
  }
  // Every asserted match must clear the multi-family bar, never a single family.
  const proven = results.filter((r) => r.exact >= 3);
  assert.ok(proven.length >= 2, "at least two block/building pairs match on three or more families");
  for (const r of proven) assert.ok(r.exact >= 3, `block ${r.block} -> ${r.bl} rests on ${r.exact} families`);
  // Block 1 and block 4 are uniquely determined; every rival scores lower.
  const b1 = results.filter((r) => r.block === 1).sort((a, b) => b.exact - a.exact);
  assert.equal(b1[0].bl, "KGS", "block 1 maps to KGS");
  assert.ok(b1[0].exact > b1[1].exact, "block 1's match is unique");
  const b4 = results.filter((r) => r.block === 4).sort((a, b) => b.exact - a.exact);
  assert.equal(b4[0].bl, "WELCOME CENTER", "block 4 maps to WELCOME CENTER");
  assert.ok(b4[0].exact > b4[1].exact, "block 4's match is unique");
});

test("5 -- the two large BOQ blocks are NOT interchangeable, and cannot be ordered by the drawings", () => {
  if (!db) return;
  const blocks = boqBlocks(db, PROJECT);
  const b2 = blocks.find((b) => b.block === 2).families;
  const b3 = blocks.find((b) => b.block === 3).families;
  const keys = new Set([...Object.keys(b2), ...Object.keys(b3)]);
  const differing = [...keys].filter((k) => (b2[k] ?? 0) !== (b3[k] ?? 0));
  // The two blocks agree on every family EXCEPT heat. So they are not
  // interchangeable, and heat is the only family that could tell them apart.
  assert.deepEqual(differing, [SEMANTIC_STATUS.HEAT],
    "blocks 2 and 3 differ on heat only");
  assert.equal(b2[SEMANTIC_STATUS.HEAT], 6);
  assert.equal(b3[SEMANTIC_STATUS.HEAT], 8);
  // And the drawings cannot use it: both candidate buildings show the same heat.
  const draw = drawingByBuilding(geo);
  const boys = draw.BOYS.families[SEMANTIC_STATUS.HEAT];
  const girls = draw.GIRLS.families[SEMANTIC_STATUS.HEAT];
  assert.equal(boys, girls, "BOYS and GIRLS show identical heat counts on the drawings");
  assert.notEqual(boys, b2[SEMANTIC_STATUS.HEAT]);
  assert.notEqual(boys, b3[SEMANTIC_STATUS.HEAT]);
  // Therefore no drawing family orders the two blocks. The module must not
  // pretend otherwise by hard-coding a block order.
  assert.doesNotMatch(code, /block\s*2\s*(?:=>|->|:)\s*['"]?(BOYS|GIRLS)/i,
    "the module must not hard-code which block is BOYS or GIRLS");
});

test("6 -- station scopes are matched by fingerprint, not by document order", () => {
  if (!db) return;
  const sd = stationDrawing(geo);
  assert.equal(sd.scopes.length, 3, "AMS-002 carries three independently captioned panel scopes");
  const blocks = boqBlocks(db, PROJECT);
  const stations = blocks.flatMap((b) => b.stations);
  assert.equal(stations.length, 3, "the BOQ carries three named station scopes");
  // Document order deliberately disagrees with quantity order, so an index-based
  // pairing would produce a wrong answer. Prove the mapping rests on quantities.
  const boqSlab = stations.map((s) => s.families[SEMANTIC_STATUS.ON_SLAB]);
  const drawSlab = sd.scopes.map((s) => s.families.SMOKE_ON_SLAB);
  assert.deepEqual([...boqSlab].sort(), [...drawSlab].sort(),
    "the three station smoke populations are the same multiset on both documents");
  assert.notDeepEqual(boqSlab, drawSlab,
    "document order differs from quantity order, so index pairing would be wrong");
  // DG Station is the only scope carrying heat, and the only drawing scope with heat.
  const dg = stations.find((s) => /DG Station/i.test(s.scope));
  assert.ok(dg.families[SEMANTIC_STATUS.HEAT] > 0, "DG Station is the only station with heat detectors");
  const withHeat = sd.scopes.filter((s) => (s.families.HEAT ?? 0) > 0);
  assert.equal(withHeat.length, 1, "exactly one drawing scope carries heat");
  assert.ok(/GENERATOR/i.test(withHeat[0].caption), "and it is the generator room");
});

test("7 -- the 'KGL' naming discrepancy is surfaced, not normalised away", () => {
  if (!db) return;
  const blocks = boqBlocks(db, PROJECT);
  const s2 = blocks.flatMap((b) => b.stations).find((s) => /Sub Station-2/i.test(s.scope));
  assert.ok(s2, "Sub Station-2 scope exists");
  assert.match(s2.scope, /KGL/, "the BOQ names the neighbouring building KGL");
  const approved = ["KGS", "BOS", "GRS", "WELCOME CENTER"];
  assert.ok(!approved.includes("KGL"),
    "KGL is NOT an approved architecture area, so the discrepancy must be reported, not mapped");
  // The matching drawing scope carries a different name entirely.
  const sd = stationDrawing(geo);
  const matched = sd.scopes.find((s) => s.families.SMOKE_ON_SLAB === s2.families[SEMANTIC_STATUS.ON_SLAB]);
  assert.ok(matched, "a drawing scope matches on quantity");
  assert.doesNotMatch(matched.caption, /Sub Station-2/i,
    "and its own caption does not say Sub Station-2 -- that is the discrepancy");
});

test("8 -- delta classification is judged, never absorbed by an invented tolerance", () => {
  assert.equal(judgeDelta(10, 10), DELTA_CLASS.EXACT);
  assert.equal(judgeDelta(10, null), DELTA_CLASS.NOT_COMPARABLE);
  assert.equal(judgeDelta(0, 0), DELTA_CLASS.EXACT, 'no demand on either side is agreement, not a conflict');
  assert.equal(judgeDelta(7, 0), DELTA_CLASS.STRUCTURAL, 'demand on the drawing with none on the BOQ is structural');
  assert.equal(judgeDelta(13, 9), DELTA_CLASS.MATERIAL, "a 4-unit / 44% heat delta is not minor");
  assert.equal(judgeDelta(103, 100), DELTA_CLASS.MINOR, "3 units on a base of 100 is a minor takeoff delta");
  // A relative test alone must not excuse a large absolute movement.
  assert.equal(judgeDelta(204, 192), DELTA_CLASS.MINOR, "the observed +12 above-ceiling delta on a base of 192");
  assert.equal(judgeDelta(50, 192), DELTA_CLASS.MATERIAL);
  // No single percentage is declared universal anywhere in the module.
  assert.doesNotMatch(code, /tolerance\s*=\s*0?\.\d+|TOLERANCE_PCT/,
    "no universal tolerance percentage may be baked in");
});

test("9 -- 'S HC' keeps its exact quantity and stays out of every family sum", () => {
  if (!db) return;
  const draw = drawingByBuilding(geo);
  let held = 0;
  for (const [, v] of Object.entries(draw)) held += v.unidentified["S HC"] ?? 0;
  assert.equal(held, 16, "S HC quantity is preserved exactly at 16");
  // It must not appear in ANY governed family.
  for (const [b, v] of Object.entries(draw)) {
    for (const [fam] of Object.entries(v.families)) {
      assert.ok(!/HC/.test(fam), `${b}: no family may absorb the S HC notation (${fam})`);
    }
  }
  // And it must not be silently reclassified.
  assert.equal(GOVERNED_LABEL_FAMILY["S HC"], undefined, "'S HC' is not a governed legend label");
  assert.equal(GOVERNED_LABEL_FAMILY["S H"], "COMBINED",
    "the governed combined detector remains a SEPARATE identity from S HC");
});

test("10 -- TOTAL addresses count only device classes with established SLC consumption", () => {
  // Established address-bearing families are the governed detector classes.
  for (const f of ["SMOKE", "HEAT", "COMBINED", "DUCT"]) {
    assert.ok(DETECTOR_FAMILIES.includes(f), `${f} is a governed detector family`);
  }
  // Notification and manual stations are explicitly NOT address-bearing.
  assert.notEqual(GOVERNED_LABEL_FAMILY.WP, "SMOKE");
  assert.notEqual(GOVERNED_LABEL_FAMILY.F, "SMOKE");
  if (!db) return;
  const draw = drawingByBuilding(geo);
  let established = 0; let candidate = 0; let held = 0;
  for (const [, v] of Object.entries(draw)) {
    established += (v.families[SEMANTIC_STATUS.BELOW_CEILING] ?? 0)
      + (v.families[SEMANTIC_STATUS.HEAT] ?? 0)
      + (v.families[SEMANTIC_STATUS.COMBINED] ?? 0)
      + (v.families[SEMANTIC_STATUS.DUCT] ?? 0);
    candidate += v.families[ABOVE_CEILING_CANDIDATE] ?? 0;
    held += v.unidentified["S HC"] ?? 0;
  }
  assert.ok(established > 0, "an established address total exists");
  assert.ok(candidate > 0, "the above-ceiling candidate total exists but is held apart");
  assert.ok(held > 0, "the unresolved notation is held apart again");
  // Three distinct figures, never merged into one headline number.
  assert.notEqual(established, established + candidate);
});

test("11 -- no governed write, no product selection, no commercial output", () => {
  assert.doesNotMatch(code, /new DatabaseSync/, "this module must not open a database of its own");
  const geoSrc = readFileSync(
    join(HERE, "..", "scripts", "lib", "al-mousa-drawing-geometry-takeoff.mjs"), "utf8",
  );
  assert.doesNotMatch(geoSrc, /readOnly:\s*false/);
  assert.match(geoSrc, /readOnly:\s*true/, "the handle it does borrow is read-only");
  for (const banned of [
    "IFP-75", "IFP-2100", "6815", "5815RMK", "RPS", "bom_lines",
    "supplier_quote", "final_quotation", "discount_rules",
  ]) {
    assert.ok(!code.includes(banned), `the reconciliation must not reference ${banned}`);
  }
  for (const word of ["rightSiz", "right_siz", "panelSizing", "panel_sizing"]) {
    assert.ok(!new RegExp(word).test(code), `the reconciliation must not perform sizing (${word})`);
  }
});

test("12 -- the reconciliation is deterministic", () => {
  if (!db) return;
  const a = JSON.stringify(boqBlocks(db, PROJECT).map((b) => [b.block, b.families]));
  const b = JSON.stringify(boqBlocks(db, PROJECT).map((x) => [x.block, x.families]));
  assert.equal(a, b, "two BOQ reads must agree");
  const c = JSON.stringify(drawingByBuilding(geo));
  const d = JSON.stringify(drawingByBuilding(geo));
  assert.equal(c, d, "two drawing reads must agree");
});

test("13 -- the geometry method is untouched by this slice", () => {
  // This reconciliation is downstream of the frozen geometry takeoff and must
  // not have altered it.
  if (!db) return;
  const sheet = takeOffSheet(geo, "BOS", { bandBy: "level" });
  const sc = sheet.rows.filter((r) => r.symbolLabel === "S C").reduce((t, r) => t + r.quantity, 0);
  assert.equal(sc, 204, "the geometry 'S C' column for BOYS is unchanged");
  assert.ok(sheet.rows.some((r) => r.symbolLabel === "S HC"), "the unresolved notation is still present");
  assert.ok(sheet.rows.some((r) => r.classification === "NOT_A_DEVICE_COLUMN_COUNT"),
    "non-device columns are still classified, not absorbed");
});

// The handle must stay open for the whole run: top-level code executes BEFORE any
// test body, so closing here would hand every test that reads the BOQ a closed
// handle and fail them with ERR_INVALID_STATE.
test.after(() => { if (db) db.close(); });