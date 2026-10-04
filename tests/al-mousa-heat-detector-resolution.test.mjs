// REMAINING 17 HEAT DETECTORS -- governed resolution.
//
// The failure this suite defends against is quiet and expensive: making heat
// demand disappear, inventing a detector for a row the evidence does not
// resolve, or letting a commercial discount stand in for an engineering answer.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import {
  SPEC_HEAT_CLAUSE, heatRequirementFromSpec, normalizeHeatRow, resolveHeatRows, matchProductForProfile,
} from "../scripts/lib/al-mousa-heat-detector-resolution.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const DB = process.env.FA_DB;
const RESOLVER = join(REPO, "scripts", "resolve-al-mousa-heat-detectors.mjs");
const BOM = join(REPO, "scripts", "build-al-mousa-farenhyt-internal-bom.mjs");
const ORACLE = join(REPO, "tests", "fixtures", "clean-golden-boq-oracle.mjs");

const out = () => execFileSync("node", [BOM, DB], { encoding: "utf8" });
const resolved = () => JSON.parse(execFileSync("node", [RESOLVER, DB, "--json"], { encoding: "utf8" }));
const readFile = (p) => readFileSync(p, "utf8");

// The governed spec text, kept verbatim so the tests assert against the words
// actually written in the project specification.
const SPEC_TEXT = `Fixed Temperature / Rate of Rise Heat Detectors: i. Thermal detectors employ an advanced thermistor
sensing circuit to deliver fixed-temperature detection at 135 degF (57 degC) and rate-of-rise thermal detection...
For applications requiring increased sensitivity, a high-temperature model provides fixed detection at 190 degF (88 degC).
c) Rate-of-rise detection at 15 degF (8.3 degC) per minute d) Factory-set fixed temperature at 135 degF (57 degC);
high-temperature model at 190 degF (88 degC)`;

const row = (n, qty, section, extra = {}) => normalizeHeatRow({
  row: n, qty, unit: "No", description: "Heat detector", section,
  notes: null, specificationReference: null, drawingReference: null, ...extra,
});
const GENERAL = "Supply, install and connect fire alarm detection and alarm system complete including wiring, conduits, accessories";
const PROFILES = { defaultProfile: { pn: "IDP-HEAT-ROR-IV" }, highTempProfile: { pn: "IDP-HEAT-HT-IV" } };
const PRODUCTS = [
  {
    partNumber: "IDP-HEAT-ROR-IV",
    description: "Intelligent Addressable Fixed temperature and rate-of rise thermal detector",
    attributes: [
      { name: "detection_principle", normalizedValue: "Fixed Temperature and Rate-of-Rise", source: { sourceId: "Doc 350285 Rev H" } },
      { name: "fixed_temperature_setpoint", normalizedValue: "135 degF" },
      { name: "rate_of_rise_sensitivity", normalizedValue: "15 degF/min" },
    ],
    standards: [{ body: "UL", number: "S2101" }],
  },
  {
    partNumber: "IDP-HEAT-IV",
    description: "Intelligent Addressable Thermal Detector Fixed Temp 135",
    attributes: [{ name: "detection_principle", normalizedValue: "Fixed Temperature" }],
    standards: [{ body: "UL", number: "S2101" }],
  },
  {
    partNumber: "IDP-HEAT-HT-IV",
    description: "Intelligent Addressable High temperature heat detector 135-190 degF",
    attributes: [{ name: "detection_principle", normalizedValue: "Variable High Temperature" }],
    standards: [{ body: "UL", number: "S2101" }],
  },
];
const runResolution = (rows) => {
  const req = heatRequirementFromSpec([{ original_text: SPEC_TEXT }]);
  return resolveHeatRows({ rows, requirement: req, governedRow: 15, heatProfiles: PROFILES });
};

// 1 -------------------------------------------------------------------------
test("1 -- total heat demand of 26 remains visible and nothing is deleted", () => {
  assert.ok(DB, "FA_DB required");
  const r = resolved();
  assert.equal(r.total, 26);
  const o = out();
  assert.match(o, /Heat detectors \(census TOTAL\)\s+26\s+26/);
  assert.match(o, /total heat demand accounted\s+: 26\s+MATCHES CENSUS/);
  // The five source rows are still individually reported.
  for (const n of [15, 63, 107, 148, 203]) assert.match(o, new RegExp(`row\\s+${n}\\s*:\\s*qty`), `row ${n} still reported`);
});

// 2 -------------------------------------------------------------------------
test("2 -- the existing 9-unit governed decision remains intact", () => {
  const r = resolved();
  const row15 = r.rows.find((x) => x.row === 15);
  assert.equal(row15.state, "GOVERNED_EXISTING");
  assert.equal(row15.qty, 9);
  assert.match(row15.reason, /existing human decision retained|not re-decided/i);
  // It is retained, not re-derived or overwritten.
  assert.equal(row15.pn, null, "this slice records it as pre-existing rather than re-deciding it");
});

// 3 -------------------------------------------------------------------------
test("3 -- the unresolved heat units cannot disappear from the report", () => {
  const r = resolved();
  const o = out();
  // After the detector-BOM correction every heat row carries an exact P/N, so
  // there is no unresolved heat line left to hide. The invariant that survives
  // is stronger: no row may be silently dropped, and all 26 must be accounted for.
  assert.equal(r.openQty, 0, "no heat row is left unresolved");
  assert.equal(r.resolvedQty, 26);
  assert.match(o, /total heat demand accounted\s+: 26\s+MATCHES CENSUS/);
  // If anything were ever unresolved it would still have to be visible.
  if (r.openQty > 0) {
    assert.match(o, /Heat detectors, unresolved[^\n]*TECHNICAL_SELECTION_REQUIRED/);
  } else {
    assert.ok(!/Heat detectors, unresolved/.test(o), "no phantom zero-quantity unresolved line");
  }
});

// 4 -------------------------------------------------------------------------
test("4 -- rows 63, 107, 148 and 203 are each evaluated independently", () => {
  const r = resolved();
  for (const n of [63, 107, 148, 203]) assert.ok(r.rows.find((x) => x.row === n), `row ${n} present`);
  assert.equal(r.rows.filter((x) => x.state === "RESOLVED" || x.state === "GOVERNED_EXISTING").length, 5);
  // Independence is shown by the DECISION PATH, not by a shared outcome: a row
  // holding an explicit temperature qualifier must still be held open while its
  // unqualified neighbour resolves.
  const req = heatRequirementFromSpec([{ original_text: SPEC_TEXT }]);
  const held = resolveHeatRows({
    rows: [row(15, 9, GENERAL), row(203, 2, "DG Station (Near GRS building)", { notes: "high temperature area" })],
    requirement: req, governedRow: 15, heatProfiles: PROFILES,
  });
  assert.equal(held.rows.find((x) => x.row === 203).state, "TECHNICAL_SELECTION_REVIEW_REQUIRED");
  assert.equal(held.rows.find((x) => x.row === 15).state, "GOVERNED_EXISTING");
  // Row 203 resolved on evidence, and records why location was not a reason.
  const dg = r.rows.find((x) => x.row === 203);
  assert.equal(dg.state, "RESOLVED");
  assert.equal(dg.pn, "IDP-HEAT-ROR-IV");
  assert.match(dg.evidenceChain.join(" "), /a building NAME is not a technical requirement/);
});

// 5 -------------------------------------------------------------------------
test("5 -- duplicate inference cannot rest on similar descriptions alone", () => {
  // Rows 63 and 107 have the SAME description text and still are not duplicates.
  const rows = [row(15, 9, GENERAL), row(63, 6, GENERAL), row(107, 8, GENERAL), row(148, 1, GENERAL), row(203, 2, "DG Station (Near GRS building)")];
  const r = runResolution(rows);
  for (const x of r.rows) assert.equal(x.duplicateOfItemId, null, "no row may be inferred a duplicate from text");
  // Distinct quantities all survive.
  const total = r.rows.reduce((t, x) => t + x.qty, 0);
  assert.equal(total, 26);
  assert.deepEqual(r.rows.map((x) => x.qty).sort((a, b) => a - b), [1, 2, 6, 8, 9]);
  // The only duplicate signal the system accepts is the governed one.
  const src = readFile(join(REPO, "scripts", "resolve-al-mousa-heat-detectors.mjs"));
  assert.match(src, /duplicate_of_item_id/);
});

// 6 -------------------------------------------------------------------------
test("6 -- a fixed-only detector cannot satisfy a rate-of-rise requirement", () => {
  const m = matchProductForProfile({ profile: "FIXED_135F_PLUS_ROR_15F_PER_MIN", products: PRODUCTS, requirement: SPEC_HEAT_CLAUSE });
  assert.equal(m.ok, true);
  assert.equal(m.pn, "IDP-HEAT-ROR-IV");
  // The fixed-only sibling is rejected, with a reason on record.
  assert.ok(m.rejected, "the fixed-only alternative must be explicitly rejected");
  assert.equal(m.rejected.pn, "IDP-HEAT-IV");
  assert.match(m.rejected.reason, /cannot provide|fixed-temperature-only/i);
  // Directly: a part whose principle is fixed-only must not match.
  const onlyFixed = PRODUCTS.filter((p) => p.partNumber !== "IDP-HEAT-ROR-IV");
  for (const p of onlyFixed) {
    const bad = matchProductForProfile({ profile: "FIXED_135F_PLUS_ROR_15F_PER_MIN", products: [p], requirement: SPEC_HEAT_CLAUSE });
    assert.equal(bad.ok, false, `${p.partNumber} must not satisfy an ROR profile`);
  }
});

// 7 -------------------------------------------------------------------------
test("7 -- the exact Farenhyt ROR detector requires governed evidence", () => {
  const m = matchProductForProfile({ profile: "FIXED_135F_PLUS_ROR_15F_PER_MIN", products: PRODUCTS, requirement: SPEC_HEAT_CLAUSE });
  assert.match(m.evidence.detectionPrinciple, /Rate-of-Rise/);
  assert.match(m.evidence.fixedSetpoint, /135/);
  assert.match(m.evidence.rateOfRise, /15/);
  assert.equal(m.evidence.ulListing, "S2101");
  assert.ok(m.evidence.datasheet, "a manufacturer datasheet must be cited");
  // Evidence is required: an unknown part fails closed.
  const unknown = matchProductForProfile({ profile: "FIXED_135F_PLUS_ROR_15F_PER_MIN", products: [], requirement: SPEC_HEAT_CLAUSE });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, "PRODUCT_NOT_IN_LIBRARY");
  // And a part missing ROR evidence is refused even if it is otherwise Farenhyt.
  const wrongProfile = matchProductForProfile({
    profile: "FIXED_135F_PLUS_ROR_15F_PER_MIN",
    products: [{ partNumber: "IDP-HEAT-ROR-IV", attributes: [{ name: "detection_principle", normalizedValue: "Fixed Temperature" }] }],
    requirement: SPEC_HEAT_CLAUSE,
  });
  assert.equal(wrongProfile.ok, false);
  assert.equal(wrongProfile.reason, "PRINCIPLE_MISMATCH");
});

// 8 -------------------------------------------------------------------------
test("8 -- base quantity is not double-counted", () => {
  const o = out();
  // The base census is derived from the mounting matrix: spot bases only.
  assert.match(o, /B501-IV quantity\s+: 1458/);
  const base = out().split("\n").find((l) => l.includes("B501-IV"));
  const qty = Number(base.match(/B501-IV\s+(\d+)/)[1]);
  // 1458 = 1401 smoke + 26 heat + 31 combined. The 45 duct heads are excluded.
  assert.equal(qty, 1401 + 26 + 31);
  // No duct base is charged, and the exclusion is stated with its evidence.
  assert.match(o, /IDP-PHOTO-R-IV\s+45\s+0\s+Duct detector head/);
  assert.match(o, /base_required = No/);
  // The heat identity is fully determined, so nothing is held back.
  assert.match(o, /all 26 heat units carry an exact P\/N/);
  assert.ok(!/pending, NOT included/.test(o), "no phantom pending-base disclosure remains");
});

// 9 -------------------------------------------------------------------------
test("9 -- point count is not double-counted", () => {
  const o = out();
  // 1503 = 1458 spot + 45 duct, and the FULL 26 heat census is used exactly once.
  assert.match(o, /SLC detector points\s+: 1503\s+\(= 1458 spot \+ 45 duct\)/);
  assert.ok(!/SLC detector points\s+: 1529/.test(o), "the 26 must not be added twice");
  assert.ok(!/SLC detector points\s+: 1548/.test(o));
  // Losing a base must not lose an address.
  assert.match(o, /consumes ZERO bases but still consumes exactly ONE/);
});

// 10 ------------------------------------------------------------------------
test("10 -- loop count is recomputed only because demand actually changed", () => {
  const o = out();
  assert.match(o, /detectors 1503 \/ 159 = 9\.45 -> 10 loops/);
  assert.match(o, /AGGREGATE THEORETICAL MINIMUM = 10 loops/);
  assert.match(o, /PRELIMINARY INSTALLED LOOPS   : 11/);
  // Point growth from 1486 to 1503 did not cross a loop boundary, so topology held.
  assert.match(o, /loop requirement\s+: aggregate minimum 10 loops, installed 11/);
});

// 11 ------------------------------------------------------------------------
test("11 -- the existing governed 65% rule is reused and not re-created", () => {
  assert.ok(DB, "FA_DB required");
  const o = out();
  // The rule is READ from the governed table (source), and REPORTED (output).
  assert.match(readFile(BOM), /SELECT \* FROM discount_rules WHERE approval_state='Approved'/);
  assert.match(o, /6500 bp off list \(net multiplier 0\.35\)/);
  // The heat decision path must not introduce any second rule or its own rate.
  const decider = readFile(join(REPO, "scripts", "decide-al-mousa-heat-detector-resolution.mjs"));
  assert.doesNotMatch(decider, /INSERT INTO discount_rules/);
  assert.doesNotMatch(decider, /0\.35\s*\*|discount_basis_points/);
  assert.match(decider, /Existing governed Farenhyt rule reused unchanged/);
});

// 12 ------------------------------------------------------------------------
test("12 -- list price remains unchanged after repricing the heat units", () => {
  const o = out();
  const heat = o.split("\n").find((l) => l.includes("IDP-HEAT-ROR-IV") && l.includes("READY_FOR_COSTING"));
  assert.ok(heat);
  const [, list, net] = heat.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+READY_FOR_COSTING/);
  assert.equal(Number(list), 64, "the Farenhyt list price is still the list price");
  assert.equal(Number(net), 22.4);
  assert.equal(Number(net), Math.round(Number(list) * 0.35 * 100) / 100);
});

// 13 ------------------------------------------------------------------------
test("13 -- net price is derived correctly for the newly costable units", async () => {
  const o = out();
  const heat = o.split("\n").find((l) => l.includes("IDP-HEAT-ROR-IV") && l.includes("READY_FOR_COSTING"));
  const [, qty, list, netUsd, netSar, ext] = heat.match(/\s(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+READY_FOR_COSTING$/).map(Number);
  // All 26 heat units now carry the exact product, including the 2 DG Station units.
  assert.equal(qty, 26);
  assert.equal(list, 64, "the governed Farenhyt list price is unchanged");
  assert.equal(netUsd, 22.4);
  assert.equal(netSar, 84);
  assert.equal(ext, Math.round(netSar * qty * 100) / 100);
  // Costable units, recomputed from the canonical census rather than a literal.
  const { CENSUS_Q } = await import("../scripts/lib/al-mousa-fire-alarm-commercial-bom.mjs");
  const derivedUnits = CENSUS_Q.smoke + 26 + CENSUS_Q.combined
    + CENSUS_Q.duct * 2                            // duct head + indoor housing
    + CENSUS_Q.pull + CENSUS_Q.monModule + CENSUS_Q.ctrlModule
    + (1401 + 26 + CENSUS_Q.combined)              // B501-IV bases, spot only
    + CENSUS_Q.facp + 4 + 2 + CENSUS_Q.ftJack;     // panel, loop cards, kits, jacks
  const units = Number(o.match(/Costable unit count\s+: (\d+)/)[1]);
  assert.equal(units, derivedUnits);
  assert.equal(units, 3401);
});

// 14 ------------------------------------------------------------------------
test("14 -- the subtotal increases only by the newly costable quantities", () => {
  const o = out();
  const usd = Number(o.match(/Costable NET material subtotal\s+:\s+([\d.]+) USD/)[1]);
  const sar = Number(o.match(/Costable NET material subtotal\s+:\s+[\d.]+ USD\s+=\s+([\d.]+) SAR/)[1]);
  assert.ok(usd > 0 && sar > 0);
  // Each LINE satisfies net SAR = round2(net USD x governed FX), and its extended
  // cost is round2(net SAR x qty). The subtotal is the SUM of those per-line
  // monetary amounts, so it is deliberately NOT exactly (subtotal USD x FX):
  // rounding is applied per line, not once at the end.
  for (const line of o.split("\n").filter((l) => /READY_FOR_COSTING$/.test(l))) {
    // Line tail is: qty, ListUSD, NetUSD, NetSAR, Ext SAR, then the state token.
    const m = line.match(/\s(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+READY_FOR_COSTING$/);
    if (!m) continue;
    const [, qty, list, netUsd, netSar, extSar] = m.map(Number);
    const who = line.trim().slice(0, 30);
    assert.equal(netUsd, Math.round(list * 0.35 * 100) / 100, `net USD on "${who}"`);
    assert.equal(netSar, Math.round(netUsd * 3.75 * 100) / 100, `net SAR on "${who}"`);
    assert.equal(extSar, Math.round(netSar * qty * 100) / 100, `extended SAR on "${who}"`);
  }
  // The aggregate therefore sits just below the naive conversion, by rounding only.
  const naive = usd * 3.75;
  assert.ok(sar <= naive && naive - sar < 5, `subtotal ${sar} must be the rounded sum, not ${naive}`);
  // The newly resolved heat line itself converts exactly.
  const heatLine = out().split("\n").find((l) => l.includes("IDP-HEAT-ROR-IV") && l.includes("READY_FOR_COSTING"));
  const [, hQty, hList, hNetUsd, hNetSar, hExt] = heatLine.match(/\s(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+READY_FOR_COSTING$/).map(Number);
  assert.equal(hQty, 26);
  assert.equal(hList, 64);
  assert.equal(hNetUsd, 22.4);
  assert.equal(hNetSar, 84);
  assert.equal(hExt, Math.round(hNetSar * hQty * 100) / 100);
  // All 26 heat units are now costable: 9 pre-existing + 15 resolved last slice
  // + 2 DG Station resolved by this slice. Nothing is held back.
  const heat = o.split("\n").find((l) => l.includes("IDP-HEAT-ROR-IV") && l.includes("READY_FOR_COSTING"));
  const heatQty = Number(heat.match(/IDP-HEAT-ROR-IV\s+(\d+)/)[1]);
  assert.equal(heatQty - 9, 17, "17 further heat units resolved from the original governed 9");
  const base = o.split("\n").find((l) => l.includes("B501-IV"));
  const baseQty = Number(base.match(/B501-IV\s+(\d+)/)[1]);
  // Bases cover every SPOT detector once (1401 + 26 + 31) and no duct head.
  assert.equal(baseQty, 1401 + 26 + 31);
  // Reconciliation: 1.3125 is shown as derived, never stored as a rule.
  assert.match(o, /the factor 1\.3125 is ONLY 0\.35 x 3\.75 and is not a stored rule/);
  assert.match(o, /PARTIAL MATERIAL COST, NOT THE FINAL PROJECT MATERIAL COST/);
});

// 15 ------------------------------------------------------------------------
test("15 -- rerunning is deterministic and re-applying the decision is idempotent", () => {
  assert.ok(DB, "FA_DB required");
  assert.equal(out(), out(), "two repricing runs are byte-identical");
  assert.deepEqual(resolved(), resolved(), "two resolutions are identical");
  const decider = join(REPO, "scripts", "decide-al-mousa-heat-detector-resolution.mjs");
  const before = execFileSync("node", [decider, DB, "--apply"], { encoding: "utf8" });
  const after = execFileSync("node", [decider, DB, "--apply"], { encoding: "utf8" });
  assert.match(after, /NO-OP|written=0/);
  assert.equal(before.match(/written=(\d+)/)[1], "0");
  assert.equal(after.match(/written=(\d+)/)[1], "0");
  assert.equal(before.match(/noop=(\d+)/)[1], after.match(/noop=(\d+)/)[1]);
  // The oracle census itself is untouched by this slice.
  assert.match(readFile(ORACLE), /description: "Heat detector", qty: 26, unit: "No", sourceRows: Object\.freeze\(\[15, 63, 107, 148, 203\]\)/);
});
