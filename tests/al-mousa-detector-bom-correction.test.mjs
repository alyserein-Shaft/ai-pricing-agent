// DETECTOR BOM CORRECTION -- base census, duct head identity, DG heat applicability.
//
// Three defects are guarded here:
//   - a base quantity inflated by counting duct heads that need no base,
//   - a ceiling detector used where the manufacturer names a duct part,
//   - an unresolved heat line held open by a MANUFACTURER OPTION rather than by
//     any project evidence.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { buildBaseCensus, DETECTOR_MOUNTING, SPOT_BASE_PN } from "../scripts/lib/al-mousa-detector-base-census.mjs";
import { projectOverrideForRow, resolveHeatRows, heatRequirementFromSpec, normalizeHeatRow } from "../scripts/lib/al-mousa-heat-detector-resolution.mjs";
import { FARENHYT_SELECTION } from "../scripts/lib/al-mousa-fire-alarm-selection-farenhyt.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const DB = process.env.FA_DB;
const BOM = join(REPO, "scripts", "build-al-mousa-farenhyt-internal-bom.mjs");
const RESOLVER = join(REPO, "scripts", "resolve-al-mousa-heat-detectors.mjs");
const readFile = (p) => readFileSync(p, "utf8");
const out = () => execFileSync("node", [BOM, DB], { encoding: "utf8" });
const resolved = () => JSON.parse(execFileSync("node", [RESOLVER, DB, "--json"], { encoding: "utf8" }));
const line = (o, needle) => o.split("\n").find((l) => l.includes(needle) && !l.includes("Requirement"));

const SPEC_TEXT = `Fixed Temperature / Rate of Rise Heat Detectors: fixed-temperature detection at 135 degF (57 degC)
and rate-of-rise thermal detection. For applications requiring increased sensitivity, a high-temperature model
provides fixed detection at 190 degF (88 degC). c) Rate-of-rise detection at 15 degF (8.3 degC) per minute`;
const GENERAL = "Supply, install and connect fire alarm detection and alarm system complete";
const PROFILES = { defaultProfile: { pn: "IDP-HEAT-ROR-IV" }, highTempProfile: { pn: "IDP-HEAT-HT-IV" } };
// Rows go through the SAME normalizer the DB runner uses, so the test exercises
// the real decision path (including named-scope detection) rather than a shape
// the production code never sees.
const row = (n, qty, section, extra = {}) => normalizeHeatRow({
  row: n, qty, unit: "No", description: "Heat detector", section,
  notes: null, specificationReference: null, drawingReference: null, ...extra,
});
const runResolution = (rows) =>
  resolveHeatRows({ rows, requirement: heatRequirementFromSpec([{ original_text: SPEC_TEXT }]), governedRow: 15, heatProfiles: PROFILES });

// 1 -------------------------------------------------------------------------
test("1 -- B501-IV quantity is derived from compatible spot detectors, not a hard-coded total", () => {
  const c = buildBaseCensus({ smoke: 1401, heatTotal: 26, combined: 31, duct: 45 });
  assert.equal(c.basePn, SPOT_BASE_PN);
  // Derived: 1401 + 26 + 31. Recomputed here, never written as a literal.
  const derived = c.rows.filter((r) => r.counts !== false && r.usesBase).reduce((t, r) => t + r.quantity, 0);
  assert.equal(c.baseQuantity, derived);
  assert.equal(c.baseQuantity, 1401 + 26 + 31);
  // The matrix is the authority and the duct row opts out of it.
  const duct = c.rows.find((r) => r.key === "ductHead");
  assert.equal(duct.usesBase, false);
  assert.equal(duct.baseQuantity, 0);
  assert.ok(DETECTOR_MOUNTING.length >= 5);
  if (DB) {
    assert.match(out(), /B501-IV quantity\s+: 1458/);
    assert.match(out(), /TOTAL\s+1503\s+1458/);
  }
});

// 2 -------------------------------------------------------------------------
test("2 -- duct heads do not create B501-IV bases unless explicitly required", () => {
  const c = buildBaseCensus({ smoke: 1401, heatTotal: 26, combined: 31, duct: 45 });
  assert.equal(c.rows.find((r) => r.key === "ductHead").baseQuantity, 0);
  // A duct point is still a point, so removing its base must NOT remove its address.
  assert.equal(c.ductPoints, 45);
  assert.equal(c.spotPoints + c.ductPoints, 1503);
  // The exclusion rests on governed evidence, not preference.
  const duct = DETECTOR_MOUNTING.find((m) => m.key === "ductHead");
  assert.match(duct.evidence, /base_required\s*=\s*'?No'?/);
  assert.match(duct.evidence, /no duct family/);
  assert.match(duct.evidence, /when used standalone/i, "the base condition is conditional on standalone use");
  if (DB) {
    // 45 spot bases fewer than the previous (wrong) total of 1503.
    assert.match(out(), /previous \(incorrect\) quantity: 1503/);
    assert.ok(!/B501-IV\s+1503/.test(out()));
  }
});

// 3 -------------------------------------------------------------------------
test("3 -- all 26 heat detectors remain in the point census", () => {
  const c = buildBaseCensus({ smoke: 1401, heatTotal: 26, combined: 31, duct: 45 });
  assert.equal(c.rows.find((r) => r.key === "heatRor").quantity, 26);
  if (DB) {
    const o = out();
    assert.match(o, /Heat detectors \(census TOTAL\)\s+26\s+26/);
    assert.match(o, /IDP-HEAT-ROR-IV\s+26\s+/);
    assert.match(o, /SLC detector points\s+: 1503\s+\(= 1458 spot \+ 45 duct\)/);
    // 26 exactly once -- the evidence-only candidate row must not add 26 again.
    assert.ok(!/SLC detector points\s+: 1529/.test(o));
  }
});

// 4 -------------------------------------------------------------------------
test("4 -- unresolved heat identity does not remove an SLC address", () => {
  // Both heat candidates share one base family, so identity ambiguity cannot
  // move the base quantity at all.
  const both = buildBaseCensus({ smoke: 1401, heatTotal: 26, combined: 31, duct: 45 });
  assert.equal(both.baseQuantity, 1401 + 26 + 31);
  const cand = DETECTOR_MOUNTING.find((m) => m.key === "heatCandidate");
  assert.match(cand.evidence, /IDP-Heat-ROR' AND 'IDP-Heat-HT/);
  assert.equal(cand.counts, false, "the evidence row must not contribute quantity");
  if (DB) {
    assert.match(out(), /all 26 heat units carry an exact P\/N, so the base quantity is fully determined/);
  }
});

// 5 -------------------------------------------------------------------------
test("5 -- DG Station location alone cannot force high-temperature heat", () => {
  // A named building scope with no project evidence must still resolve.
  assert.equal(projectOverrideForRow(row(203, 2, "DG Station (Near GRS building)"), { highTempLocationAssigned: false }), null);
  const r = runResolution([
    row(15, 9, GENERAL), row(63, 6, GENERAL), row(107, 8, GENERAL),
    row(148, 1, GENERAL), row(203, 2, "DG Station (Near GRS building)"),
  ]);
  const dg = r.rows.find((x) => x.row === 203);
  assert.equal(dg.state, "RESOLVED", "a building NAME is not a technical requirement");
  assert.equal(dg.pn, "IDP-HEAT-ROR-IV");
  assert.match(dg.evidenceChain.join(" "), /a building NAME is not a technical requirement/);
});

// 6 -------------------------------------------------------------------------
test("6 -- general project requirements apply unless a more specific one overrides", () => {
  // An explicit qualifier ON THE ROW is a genuine override and must hold it open.
  const withNote = row(203, 2, "DG Station (Near GRS building)", { notes: "high temperature area" });
  assert.ok(projectOverrideForRow(withNote, { highTempLocationAssigned: false }), "an explicit row qualifier overrides");
  const held = runResolution([row(15, 9, GENERAL), withNote]).rows.find((x) => x.row === 203);
  assert.equal(held.state, "TECHNICAL_SELECTION_REVIEW_REQUIRED");
  assert.ok(held.missingDiscriminator);
  // And a spec that actually maps the variant to a location is also an override.
  assert.ok(projectOverrideForRow(row(203, 2, "Plant Room"), { highTempLocationAssigned: true }));
  // Otherwise the universal profile governs.
  assert.equal(projectOverrideForRow(row(63, 6, GENERAL), { highTempLocationAssigned: false }), null);
});

// 7 -------------------------------------------------------------------------
test("7 -- DNR/DNRW detector compatibility is checked using governed evidence", () => {
  // Assert the EVALUATED selection, not the raw source: the evidence strings are
  // concatenated across lines, so a source-level regex would be testing syntax.
  const duct = FARENHYT_SELECTION.find((s) => s.key === "ductHead");
  assert.ok(duct, "ductHead line present in the canonical selection");
  assert.equal(duct.pn, "IDP-PHOTO-R-IV");
  assert.equal(duct.selection, "EXACT_SELECTION");
  assert.match(duct.evidence, /requires IDP-PHOTO-R \(remote-test capable\) sensor/);
  assert.match(duct.evidence, /for use with DNR \(W\) duct smoke detector/);
  assert.match(duct.note, /base_required = No/);
  assert.match(duct.note, /address_consumption 0/);
  // The superseded ceiling part must not remain the selection...
  assert.notEqual(duct.pn, "IDP-PHOTO-IV", "the ceiling part must not be the duct selection");
  // ...and the correction is recorded with its reason rather than silently applied.
  assert.match(duct.correction, /CORRECTION:/);
  assert.match(duct.correction, /CEILING/);
  // No base is attached to a duct head.
  assert.equal(duct.base, null);
  if (DB) {
    const o = out();
    assert.ok(line(o, "IDP-PHOTO-R-IV").includes("READY_FOR_COSTING"));
    assert.ok(!line(o, "Addressable detector head for duct de").includes("IDP-PHOTO-IV"));
  }
});

// 8 -------------------------------------------------------------------------
test("8 -- a duct P/N change updates pricing without changing quantity", () => {
  if (!DB) return;
  const o = out();
  const head = line(o, "IDP-PHOTO-R-IV");
  const m = head.match(/\s(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+READY_FOR_COSTING$/);
  assert.ok(m, `unparsed duct line: ${head}`);
  const [, qty, list, netUsd, netSar, ext] = m.map(Number);
  assert.equal(qty, 45, "quantity is unchanged by the P/N correction");
  assert.equal(netUsd, Math.round(list * 0.35 * 100) / 100, "same governed discount");
  assert.equal(netSar, Math.round(netUsd * 3.75 * 100) / 100);
  assert.equal(ext, Math.round(netSar * qty * 100) / 100);
  // The list price came from that part's own governed record, not the old part's.
  assert.notEqual(list, 65, "IDP-PHOTO-IV list was 65; the duct part prices from its own record");
});

// 9 -------------------------------------------------------------------------
test("9 -- the existing 65% Farenhyt rule is reused and not re-created", () => {
  assert.ok(DB, "FA_DB required");
  const o = out();
  assert.match(readFile(BOM), /SELECT \* FROM discount_rules WHERE approval_state='Approved'/);
  assert.match(o, /6500 bp off list \(net multiplier 0\.35\)/);
  const decider = readFile(join(REPO, "scripts", "decide-al-mousa-heat-detector-resolution.mjs"));
  assert.doesNotMatch(decider, /INSERT INTO discount_rules/);
  assert.match(decider, /Existing governed Farenhyt rule reused unchanged/);
});

// 10 ------------------------------------------------------------------------
test("10 -- repricing preserves source list prices", () => {
  if (!DB) return;
  const o = out();
  // Every costed line still shows a list price above its net, derived not overwritten.
  for (const l of o.split("\n").filter((x) => /READY_FOR_COSTING$/.test(x))) {
    const m = l.match(/\s(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+READY_FOR_COSTING$/);
    if (!m) continue;
    const [, , list, netUsd] = m.map(Number);
    assert.ok(list > netUsd, `list must remain visible above net on "${l.trim().slice(0, 26)}"`);
    assert.equal(netUsd, Math.round(list * 0.35 * 100) / 100);
  }
  assert.match(o, /LIST PRICE  -> unchanged, from the governed price record \(never overwritten\)/);
});

// 11 ------------------------------------------------------------------------
test("11 -- loop count changes only if actual demand or capacity requires it", () => {
  if (!DB) return;
  const o = out();
  // Demand rose (a duct part swap and extra heat), and loops are re-derived from it.
  assert.match(o, /detectors 1503 \/ 159 = 9\.45 -> 10 loops/);
  assert.match(o, /AGGREGATE THEORETICAL MINIMUM = 10 loops/);
  assert.match(o, /PRELIMINARY INSTALLED LOOPS   : 11/);
  // Capacity change: correcting the point count must not flip the brand threshold.
  assert.match(o, /preferred brand\s+: FARENHYT/);
});

// 12 ------------------------------------------------------------------------
test("12 -- rerun is deterministic and idempotent", () => {
  if (!DB) return;
  assert.equal(out(), out(), "two repricing runs are byte-identical");
  assert.deepEqual(resolved(), resolved());
  const decider = join(REPO, "scripts", "decide-al-mousa-heat-detector-resolution.mjs");
  const a = execFileSync("node", [decider, DB, "--apply"], { encoding: "utf8" });
  const b = execFileSync("node", [decider, DB, "--apply"], { encoding: "utf8" });
  assert.match(b, /written=0/);
  assert.match(b, /noop=5/);
  // A superseding decision is recorded once, then the rerun is a stable NO-OP.
  assert.equal(a, b);
});
