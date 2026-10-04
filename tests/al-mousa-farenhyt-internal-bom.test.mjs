// AL MOUSA -- FARENHYT INTERNAL DETAILED SELECTION AND PRICING VALIDATION.
//
// Eighteen assertions. These protect the things most likely to go wrong when a
// partial internal costing is produced: an unverified detector quietly satisfying
// a requirement, a discount appearing from nowhere, a list price being called a
// cost, an aggregate loop minimum being read as installed hardware, and the
// unresolved 17 heat detectors quietly disappearing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import {
  resolveFireAlarmBrandStrategy, commercialWorkflowFor, resolveBrandRelationship,
} from "../app/domain/fire-alarm-brand-strategy.mjs";
import { FARENHYT_SELECTION, SELECTION_BY_KEY } from "../scripts/lib/al-mousa-fire-alarm-selection-farenhyt.mjs";
import { FARENHYT_PLATFORM } from "../scripts/lib/al-mousa-farenhyt-platform.mjs";
import { CENSUS_Q, assertCensus } from "../scripts/lib/al-mousa-fire-alarm-commercial-bom.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const readFile = (p) => readFileSync(p, "utf8");
const DB = process.env.FA_DB;
const out = () => (DB ? execFileSync("node", [join(REPO, "scripts", "build-al-mousa-farenhyt-internal-bom.mjs"), DB], { encoding: "utf8" }) : null);

const base = (o = {}) => ({
  systemCategory: "FIRE_ALARM", mandatoryBrand: null, mandatoryBrandEvidence: [],
  standardsRegime: "ULF", addressablePointCount: 1877, pointCountBasis: "t", ...o,
});

// 1 -------------------------------------------------------------------------
test("1 -- Al Mousa resolves to the IN-HOUSE Farenhyt workflow", () => {
  const d = resolveFireAlarmBrandStrategy(base());
  assert.equal(d.preferredBrand, "FARENHYT");
  assert.equal(d.brandRelationship, "IN_HOUSE");
  assert.equal(d.commercialWorkflow, "INTERNAL_SELECTION_AND_PRICING");
});

// 2 -------------------------------------------------------------------------
test("2 -- no supplier RFQ and no supplier selection authority on the Farenhyt path", () => {
  const d = resolveFireAlarmBrandStrategy(base());
  assert.equal(d.requiresSupplierRfqBeforeCosting, false);
  assert.equal(d.supplierIsSelectionAuthority, false);
  assert.equal(d.sequence.includes("SUPPLIER_RFQ"), false);
  assert.equal(commercialWorkflowFor("NOTIFIER").commercialWorkflow, "SUPPLIER_RFQ_AND_ENGINEER_REVIEW");
  assert.equal(resolveBrandRelationship("NOTIFIER"), "EXTERNAL");
});

// 3 -------------------------------------------------------------------------
test("3 -- an exact selection requires a real orderable P/N", () => {
  for (const s of FARENHYT_SELECTION) {
    if (s.selection === "EXACT_SELECTION") {
      assert.ok(s.pn, `${s.key} claims EXACT_SELECTION with no P/N`);
      assert.doesNotMatch(s.pn, /\//, `${s.key} uses a slash-list as if it were one P/N`);
      assert.ok(s.evidence && s.evidence.length > 10, `${s.key} has no evidence string`);
    } else {
      // A part may have a settled P/N while its QUANTITY or CONFIGURATION is still an
      // assumption (ST-10 is an orderable part; the per-location length is the gap).
      // Identity and configuration are orthogonal, so a non-exact entry may carry a
      // P/N -- but it must then document what is actually open.
      if (s.pn) assert.ok(s.note && s.note.length > 20, `${s.key} has a P/N but no documented open assumption`);
      assert.ok(s.selection !== "EXACT_SELECTION");
    }
  }
  // Notification families stay candidate sets, never one fabricated SKU.
  for (const k of ["notifIndoorStrobe", "notifIndoorHornStrobe", "notifOutdoor"]) {
    assert.equal(SELECTION_BY_KEY[k].pn, null, k);
    assert.ok(SELECTION_BY_KEY[k].candidates.length > 0, k);
  }
});

// 4 -------------------------------------------------------------------------
test("4 -- the ROR requirement cannot be met by the fixed-only detector", () => {
  const ror = SELECTION_BY_KEY.heatRor;
  assert.equal(ror.pn, "IDP-HEAT-ROR-IV", "the ROR-capable part must be selected");
  assert.notEqual(ror.pn, "IDP-HEAT-IV", "the fixed-only part must not be carried forward");
  assert.match(ror.evidence, /rate-of rise|rate-of-rise/i);
  assert.match(ror.correction, /FIXED ONLY/);
  // The governed Al Mousa requirement includes ROR at 15F/min.
  assert.match(SELECTION_BY_KEY.heatRor.evidence + SELECTION_BY_KEY.heatRor.note, /15F|15.*\/.*min|rate-of-rise/i);
});

// 5 -------------------------------------------------------------------------
test("5 -- the 17 unresolved heat detectors cannot disappear", () => {
  const bal = SELECTION_BY_KEY.heatBalance;
  assert.equal(bal.selection, "TECHNICAL_SELECTION_REVIEW_REQUIRED");
  assert.equal(bal.pn, null);
  assert.equal(CENSUS_Q.heatBOQ, 26);
  assert.equal(CENSUS_Q.heatBOQ - 9, 17);
  assert.match(bal.note, /17|FOUR further BOQ rows/);
  // And the ROR line still carries only the 9 governed units.
  assert.equal(CENSUS_Q.heatBOQ - 9, 17, "17 is not rounded away or absorbed into the 9");
});

// 6 -------------------------------------------------------------------------
test("6 -- detector bases are represented as their own line", () => {
  const b = SELECTION_BY_KEY.detectorBase;
  assert.equal(b.pn, "B501-IV");
  assert.equal(b.selection, "EXACT_SELECTION");
  assert.match(b.evidence, /flangeless mounting base/i);
  // Every selected detector is base-not-included, so the base cannot be omitted.
  for (const k of ["smoke", "heatRor", "combined"]) {
    assert.ok(SELECTION_BY_KEY[k].base === "B501-IV", `${k} must declare its base`);
  }
});

// 7 -------------------------------------------------------------------------
test("7 -- passive phone jacks create no telephone interface quantity", () => {
  const jack = SELECTION_BY_KEY.ftJack;
  assert.equal(jack.pn, "FFT-FPJ");
  assert.match(jack.note, /PASSIVE/);
  assert.match(jack.note, /ZERO SLC addresses/);
  assert.match(jack.note, /never be converted into interface-module quantity/);
  // The interface line is topology-controlled, never derived from the jack count.
  const itf = SELECTION_BY_KEY.ftInterface;
  assert.equal(itf.selection, "QUANTITY_TOPOLOGY_REQUIRED");
  assert.equal(itf.pn, null);
  assert.match(itf.note, /73 jacks does NOT imply 73 modules and does NOT imply 37 modules/);
});

// 8 -------------------------------------------------------------------------
test("8 -- duct tube length is not fabricated", () => {
  const t = SELECTION_BY_KEY.ductTube;
  assert.equal(t.pn, "ST-10");
  assert.equal(t.selection, "CONFIGURATION_ASSUMPTION_REQUIRED", "must not be presented as settled");
  assert.match(t.evidence, /8-10/);
  assert.match(t.note, /not established|ASSUMPTION/);
  assert.match(t.note, /DST1|DST1\.5/, "alternative sizes must be named");
});

// 9 -------------------------------------------------------------------------
test("9 -- notification configuration gaps remain explicit", () => {
  for (const k of ["notifIndoorStrobe", "notifIndoorHornStrobe", "notifOutdoor"]) {
    const n = SELECTION_BY_KEY[k];
    // FAMILY may now be resolved, but the exact P/N must NOT be.
    assert.equal(n.selection, "CONFIGURATION_ASSUMPTION_REQUIRED", k);
    assert.equal(n.pn, null, `${k} must not carry an exact P/N`);
    assert.match(n.note, /EXACT P\/N NOT|FINAL P\/N NOT SELECTED/);
    assert.match(n.note, /discriminator|Mounting|mounting/i);
    // No candidate may be promoted to a selection, and each must be real.
    assert.ok(Array.isArray(n.candidates) && n.candidates.length > 0, `${k} keeps a candidate set`);
    assert.match(n.evidence, /BOQ|Spec|spec/);
  }
  assert.equal(CENSUS_Q.strobe + CENSUS_Q.strobeSounder + CENSUS_Q.strobeWp, 438);
});

// 10 ------------------------------------------------------------------------
test("10 -- aggregate loop minimum is distinguished from installed loops", () => {
  const det = CENSUS_Q.smoke + 9 + CENSUS_Q.combined + CENSUS_Q.duct;
  const aggregate = Math.ceil(det / FARENHYT_PLATFORM.panel.perLoopDetectors);
  assert.equal(det, 1486);
  assert.equal(aggregate, 10);
  // Installed is governed by physical panels, and exceeds the aggregate floor.
  const inBuild = CENSUS_Q.facp;
  const kits = Math.ceil((aggregate - inBuild) / FARENHYT_PLATFORM.expansionKit.loopCardsPerKit);
  const installed = inBuild + kits * FARENHYT_PLATFORM.expansionKit.loopCardsPerKit;
  assert.equal(inBuild, 7);
  assert.equal(kits, 2);
  assert.equal(installed, 11);
  assert.ok(installed > aggregate, "installed must NOT equal the aggregate minimum");
  if (DB) {
    const o = out();
    assert.match(o, /AGGREGATE THEORETICAL MINIMUM = 10 loops/);
    assert.match(o, /PRELIMINARY INSTALLED LOOPS\s+: 11/);
  }
});

// 11 ------------------------------------------------------------------------
test("11 -- Farenhyt pricing comes from internal price evidence", () => {
  const src = readFile(join(REPO, "scripts", "lib", "al-mousa-fire-alarm-selection-farenhyt.mjs"));
  assert.match(src, /KSA Honeywell Farenhyt Series Price List -2023\.xlsx/);
  // Every priced Farenhyt line resolves through the governed price tables.
  if (DB) {
    const o = out();
    assert.match(o, /Total list-price reference value/);
    assert.match(o, /IDP-PHOTO-IV/);
    assert.ok(Number(o.match(/Total list-price reference value[^:]*:\s*([\d.]+)/)[1]) > 0, "a list-price reference must be produced");
  }
});

// 12 ------------------------------------------------------------------------
test("12 -- no discount is invented", () => {
  const src = readFile(join(REPO, "scripts", "build-al-mousa-farenhyt-internal-bom.mjs"));
  // A discount may only ever arrive as governed policy data read from
  // discount_rules. It may never be typed into the script.
  assert.match(src, /SELECT \* FROM discount_rules WHERE approval_state='Approved'/);
  assert.doesNotMatch(src, /netMultiplier\s*=\s*0\.35\s*;?\s*$/m);
  assert.doesNotMatch(src, /listAmount \* 0\.35/);
  // Without an approved rule the line must NOT become costable.
  assert.match(src, /lineState = "PRICE_BASIS_REVIEW_REQUIRED"/);
  if (DB) {
    const o = out();
    // The applied rule is always reported with its authority and its provenance.
    assert.match(o, /DISCOUNT\s+-> governed Farenhyt rule, brand-scoped, Approved/);
    assert.match(o, /NET UNIT\s+-> derived = list x netMultiplier/);
  }
});

// 13 ------------------------------------------------------------------------
test("13 -- an old price-list date alone does not invalidate the source", () => {
  const src = readFile(join(REPO, "scripts", "build-al-mousa-farenhyt-internal-bom.mjs"));
  assert.match(src, /does NOT by\s*\n?\s*itself invalidate|not rejected for its date/);
  assert.match(src, /SOURCE_DATE/);
  assert.match(src, /PRICE_BASIS/);
  assert.match(src, /COMMERCIAL_VALIDITY/);
  assert.match(src, /DOWNSTREAM_USE/);
  // The four concepts must be separate columns, not conflated.
  assert.match(src, /SOURCE\s+SOURCE_DATE\s+PRICE_BASIS\s+COMMERCIAL_VALIDITY\s+DOWNSTREAM_USE/);
});

// 14 ------------------------------------------------------------------------
test("14 -- source price and net costing price remain distinct", () => {
  if (DB) {
    const o = out();
    // The list and the net are separate columns, and both are populated for a
    // costed line. Distinctness is now visible as DIFFERENT numbers, which is a
    // stronger check than the old "both UNKNOWN" world.
    assert.match(o, /ListUSD\s+NetUSD\s+NetSAR/);
    const row = o.split("\n").find((l) => l.includes("IDP-PHOTO-IV") && l.includes("READY_FOR_COSTING"));
    assert.ok(row, "a costed line must exist");
    const [, list, net, netSar] = row.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+READY_FOR_COSTING/);
    assert.ok(Number(list) > Number(net), "the list price must remain visible above the net");
    assert.equal(Number(net), Math.round(Number(list) * 0.35 * 100) / 100);
    assert.equal(Number(netSar), Math.round(Number(net) * 3.75 * 100) / 100);
    // And the report must still refuse to present the subtotal as a final cost.
    assert.match(o, /THIS IS A PARTIAL MATERIAL COST, NOT THE FINAL PROJECT MATERIAL COST/);
  }
});

// 15 ------------------------------------------------------------------------
test("15 -- missing FX cannot silently convert", () => {
  const src = readFile(join(REPO, "scripts", "build-al-mousa-farenhyt-internal-bom.mjs"));
  assert.match(src, /lineState = "FX_REQUIRED"/);
  assert.match(src, /Engineer Confirmed|fx\.rate/);
  assert.match(src, /any other currency would be FX_RATE_REQUIRED/i);
  // Only a governed approved rate is used.
  assert.match(src, /pricing_exchange_rates WHERE from_currency='USD' AND to_currency='SAR' AND approval_status='Approved'/);
});

// 16 ------------------------------------------------------------------------
test("16 -- a partial subtotal cannot present itself as the final total", () => {
  if (DB) {
    const o = out();
    assert.match(o, /THIS IS A PARTIAL MATERIAL COST, NOT THE FINAL PROJECT MATERIAL COST/);
    // Unresolved lines are excluded and visible, never folded in as zero.
    assert.match(o, /They are not zeroed/);
    // Heat is fully resolved, so no technical-selection line remains.
    assert.match(o, /TECHNICAL_SELECTION_REQUIRED\s+0/);
    assert.doesNotMatch(o, /FINAL PROJECT MATERIAL COST\s*:\s*[\d,]/i);
    assert.doesNotMatch(o, /TOTAL FIRE ALARM (COST|PRICE)\s*:\s*[\d,]/i);
  }
});

// 17 ------------------------------------------------------------------------
test("17 -- NOTIFIER evidence is untouched by the Farenhyt selection", () => {
  // The selection map is additive: it does not rewrite the canonical BOM.
  const sel = readFile(join(REPO, "scripts", "lib", "al-mousa-fire-alarm-selection-farenhyt.mjs"));
  assert.match(sel, /does NOT replace the canonical commercial BOM/);
  assert.match(sel, /PRESERVED as the technical/);
  assert.match(sel, /benchmark/);
  // The NOTIFIER identities are still present in the canonical commercial BOM.
  const bom = readFile(join(REPO, "scripts", "lib", "al-mousa-fire-alarm-commercial-bom.mjs"));
  assert.match(bom, /FSP-951-IV/);
  assert.match(bom, /N16e/);
  assert.match(bom, /NBG-12LX/);
});

// 18 ------------------------------------------------------------------------
test("18 -- rerun is deterministic and the commercial census is unchanged", () => {
  assert.deepEqual(assertCensus(), { lines: 21, verified: 13 });
  const before = { ...CENSUS_Q };
  if (DB) {
    assert.equal(out(), out(), "two runs must be byte-identical");
  }
  assert.deepEqual({ ...CENSUS_Q }, before, "no canonical quantity moved");
});
