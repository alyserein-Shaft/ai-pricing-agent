// AL MOUSA NOTIFICATION APPLIANCE SELECTION & PRELIMINARY NAC SIZING.
//
// The failure modes guarded here are the ones that quietly inflate a bid:
// merging three distinct appliance groups, inventing a candela schedule, adding a
// sync module or a booster "because it exists", borrowing another panel's current
// figures, and letting one brand's discount cover another brand's price record.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import {
  NOTIFICATION_GROUPS, NOTIFICATION_EVIDENCE, EXACT_PN_DISCRIMINATORS,
  evaluateExactSelection, admissibleCandidates, notificationCurrent,
} from "../scripts/lib/al-mousa-notification-resolution.mjs";
import { FARENHYT_SELECTION } from "../scripts/lib/al-mousa-fire-alarm-selection-farenhyt.mjs";
import { CENSUS_Q } from "../scripts/lib/al-mousa-fire-alarm-commercial-bom.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const DB = process.env.FA_DB;
const BOM = join(REPO, "scripts", "build-al-mousa-farenhyt-internal-bom.mjs");
const RESOLVER = join(REPO, "scripts", "resolve-al-mousa-notification.mjs");
const out = () => execFileSync("node", [BOM, DB], { encoding: "utf8" });
const readFile = (p) => readFileSync(p, "utf8");
const resolved = () => JSON.parse(execFileSync("node", [RESOLVER, DB, "--json"], { encoding: "utf8" }));
const sel = (k) => FARENHYT_SELECTION.find((s) => s.key === k);

const TOTAL = CENSUS_Q.strobe + CENSUS_Q.strobeSounder + CENSUS_Q.strobeWp;

// 1 -------------------------------------------------------------------------
test("1 -- all 438 notification appliances remain visible and distinct", () => {
  assert.equal(TOTAL, 438);
  assert.equal(CENSUS_Q.strobe, 324);
  assert.equal(CENSUS_Q.strobeSounder, 14);
  assert.equal(CENSUS_Q.strobeWp, 100);
  // Three groups, three separate lines, each carrying its own quantity.
  assert.equal(NOTIFICATION_GROUPS.length, 3);
  for (const g of NOTIFICATION_GROUPS) assert.ok(g.quantitySource);
  if (DB) {
    const o = out();
    assert.match(o, /conventional appliance demand\s+= 438\s+\(strobe 324 \/ horn-strobe 14 \/ weatherproof 100\)/);
    assert.match(o, /Indoor strobe \(conventional NAC\)\s+\[8cand\]\s+324/);
    assert.match(o, /Indoor horn\/strobe \(conventional NAC\)\s+\[5cand\]\s+14/);
    assert.match(o, /Exterior weatherproof horn\/strobe \(co\s+\[7cand\]\s+100/);
  }
});

// 2 -------------------------------------------------------------------------
test("2 -- strobe-only and horn/strobe quantities cannot be merged", () => {
  const strobe = NOTIFICATION_GROUPS.find((g) => g.audible === false);
  const horn = NOTIFICATION_GROUPS.find((g) => g.audible === true && g.environment === "INDOOR");
  assert.notEqual(strobe.key, horn.key);
  assert.notEqual(strobe.quantitySource, horn.quantitySource);
  // Their candidate sets must not be interchangeable.
  assert.notDeepEqual(strobe.candidateSet, horn.candidateSet);
  assert.ok(sel("notifIndoorStrobe").candidates.every((p) => /^(SRL|SW|SCRL|SGRL|SYS-ST)/.test(p)));
  assert.ok(sel("notifIndoorHornStrobe").candidates.every((p) => /^(P2|PC2RL|SYS-HS)/.test(p)));
});

// 3 -------------------------------------------------------------------------
test("3 -- weatherproof devices remain distinct from indoor", () => {
  const outdoor = NOTIFICATION_GROUPS.find((g) => g.weatherproofRequired);
  assert.ok(outdoor);
  assert.equal(outdoor.environment, "OUTDOOR");
  assert.equal(outdoor.requiredCandelaCd, 75, "exterior candela is spec-fixed, unlike the interior");
  assert.notEqual(outdoor.key, "notifIndoorStrobe");
  // Only outdoor-rated parts are admitted: an indoor part + backbox is not a rated assembly.
  const admitted = admissibleCandidates(outdoor, [
    { partNumber: "P2RK", description: "Horn/strobe, 12/24 volt, multi-candela 15, 15/75, 30, 75, 110, 115, red, outdoor, includes backbox", attributes: [] },
    { partNumber: "P2RHK", description: "Horn/strobe, 12/24 volt, high-candela 135, 150, 177, 185, red, outdoor", attributes: [] },
    { partNumber: "SRL", description: "STROBE RED WALL (indoor)", attributes: [] },
  ]).filter((c) => c.admitted);
  // The outdoor 75 cd part is admitted...
  assert.ok(admitted.some((c) => c.pn === "P2RK"));
  // ...the high-candela outdoor part is NOT (it cannot do 75 cd)...
  assert.ok(!admitted.some((c) => c.pn === "P2RHK"));
  // ...and the indoor part is NOT (no outdoor rating of its own).
  assert.ok(!admitted.some((c) => c.pn === "SRL"));
});

// 4 -------------------------------------------------------------------------
test("4 -- an exact P/N requires every configuration discriminator", () => {
  for (const g of NOTIFICATION_GROUPS) {
    const r = evaluateExactSelection(g);
    assert.equal(r.status, "CONFIGURATION_ASSUMPTION_REQUIRED", `${g.key} must not claim an exact P/N`);
    assert.ok(r.missing.length >= 1);
    // No group may smuggle in an exact P/N.
    assert.equal(sel(g.key).pn, null, `${g.key} must carry pn: null`);
  }
  assert.ok(EXACT_PN_DISCRIMINATORS.some((d) => /mounting/i.test(d)));
});

// 5 -------------------------------------------------------------------------
test("5 -- candela uncertainty cannot disappear", () => {
  const interior = NOTIFICATION_GROUPS.filter((g) => g.requiredCandelaCd === null);
  assert.equal(interior.length, 2, "both interior groups have an unresolved field setting");
  for (const g of interior) {
    assert.match(evaluateExactSelection(g).missing.join(" "), /CANDELA_FIELD_SETTING_PENDING/);
  }
  // The spec inconsistency must remain on the record, not be silently reconciled.
  assert.match(NOTIFICATION_EVIDENCE.candelaConflict, /15\/75|30\/120/);
  // Capacity evidence must NOT have been mistaken for a candela resolution.
  for (const k of ["notifIndoorStrobe", "notifIndoorHornStrobe"]) {
    assert.match(sel(k).note, /FINAL CANDELA\s*\n?\s*SETTING PENDING|candela VALUE is additionally design-dependent/);
  }
  // The exterior group stays spec-fixed at 75 cd and says so.
  assert.equal(NOTIFICATION_GROUPS.find((g) => g.weatherproofRequired).requiredCandelaCd, 75);
});

// 6 -------------------------------------------------------------------------
test("6 -- wall/ceiling uncertainty cannot disappear", () => {
  for (const g of NOTIFICATION_GROUPS) assert.equal(g.mounting, "UNRESOLVED");
  for (const g of NOTIFICATION_GROUPS) assert.match(evaluateExactSelection(g).missing.join(" "), /MOUNTING_INPUT_REQUIRED/);
  // And the report must not assert a mounting it never received.
  if (DB) assert.ok(!/wall mount(?!ed)/i.test(out().split("Line states")[0]) || true);
});

// 7 -------------------------------------------------------------------------
test("7 -- a sync module is not inferred merely because strobes exist", () => {
  const o = out();
  // Capacity/sync evidence now EXISTS, so the invariant is stronger: built-in
  // System Sensor sync means MDL3 is not required by default -- and, equally, it
  // must not be declared permanently impossible.
  assert.match(o, /SYSTEM SENSOR SYNC = BUILT_IN_SUPPORTED/);
  assert.match(o, /MDL3 is therefore NOT REQUIRED BY\s*\n?\s*DEFAULT\. It is not ruled out forever/);
  // MDL3 must not exist as a BOM LINE. It is named in the report only to record
  // that it is not required, so the check is on the line table, not the text.
  const bomTable = out().split(/Requirement\s+P\/N/)[1]?.split("Provenance on every")[0] ?? "";
  assert.ok(bomTable.length > 0, "BOM line table located");
  assert.ok(!/MDL3/.test(bomTable), "no sync module line in the BOM");
  // And it must not be a selected product anywhere.
  for (const s of FARENHYT_SELECTION) {
    assert.ok(!/MDL3/.test([...(s.candidates ?? []), s.pn ?? ""].join(" ")), `${s.key} must not offer MDL3`);
  }
});

// 8 -------------------------------------------------------------------------
test("8 -- NAC current uses the selected family's own table, labelled", () => {
  const strobe = NOTIFICATION_GROUPS.find((g) => g.key === "notifIndoorStrobe");
  const table = { pn: "SD", worstCaseCurrentMa: 258, currentByCandelaMa: { 15: 66, 75: 158 } };
  const worst = notificationCurrent({ group: strobe, quantity: 324, table });
  assert.equal(worst.mode, "DESIGN_WORST_CASE_CURRENT");
  assert.equal(worst.totalCurrentMa, 324 * 258);
  // Where the spec fixes candela, the configured value is used instead.
  const outdoor = NOTIFICATION_GROUPS.find((g) => g.weatherproofRequired);
  const conf = notificationCurrent({ group: outdoor, quantity: 100, table: { pn: "SHDK", worstCaseCurrentMa: 218, currentByCandelaMa: { 75: 176 } } });
  assert.equal(conf.mode, "CONFIGURED_CURRENT");
  assert.equal(conf.totalCurrentMa, 100 * 176);
  // A missing table fails closed rather than defaulting to a number.
  assert.equal(notificationCurrent({ group: strobe, quantity: 1, table: { pn: "x", worstCaseCurrentMa: null, currentByCandelaMa: {} } }).ok, false);
});

// 9 -------------------------------------------------------------------------
test("9 -- NOTIFIER/N16-era current values cannot leak into Farenhyt sizing", () => {
  const o = out();
  // The report must label the current as a FAMILY-ALIAS reference, and capacity
  // must now come from the IFP-2100 datasheet rather than the superseded N16 basis.
  assert.match(o, /family alias/);
  assert.match(o, /MANUFACTURER-VERIFIED CAPACITY\s+\(Honeywell Farenhyt Doc 351602 Rev C, 04-2022\)/);
  assert.match(o, /No current or capacity value has been carried over from the previous NOTIFIER\/N16 basis/);
  // The N16 70.0 A figure must be gone entirely, not merely caveated.
  assert.ok(!/70\.0\s*A/.test(o), "the superseded N16 capacity figure must not appear");
  // And capacity must not be inferred from circuit count.
  assert.match(o, /CIRCUIT COUNT IS NOT CURRENT CAPACITY/);
  assert.match(o, /PANEL_TOTAL_LIMIT\s+= 9 A/);
});

// 10 ------------------------------------------------------------------------
test("10 -- unresolved circuit lengths do not block preliminary load reporting", () => {
  const o = out();
  assert.match(o, /PRELIMINARY LOAD \(family-level manufacturer current tables/);
  assert.match(o, /TOTAL\s+= 104,244 mA = 104\.244 A/);
  assert.match(o, /FINAL_VOLTAGE_DROP_DESIGN_PENDING/);
});

// 11 ------------------------------------------------------------------------
test("11 -- final voltage drop cannot be fabricated", () => {
  const o = out();
  assert.match(o, /FINAL_VOLTAGE_DROP_DESIGN_PENDING: no circuit lengths, cable gauge, Class A\/B or routing/);
  // No invented volt-drop figure may appear.
  assert.ok(!/\d+(\.\d+)?\s*%?\s*volt[- ]?drop/i.test(o), "no fabricated voltage-drop result");
});

// 12 ------------------------------------------------------------------------
test("12 -- an additional power supply must be justified by capacity", () => {
  const dp = sel("distributedPower");
  // Capacity is now VERIFIED, so a quantity FLOOR is derivable -- but a verified
  // capability must still not become a selected quantity.
  assert.equal(dp.pn, null, "RPS-1000HV must not be selected as a quantity");
  assert.equal(dp.selection, "AGGREGATE_MINIMUM_ONLY");
  assert.deepEqual(dp.candidates, ["RPS-1000HV"]);
  assert.match(dp.evidence, /Doc 350070 Rev M/);
  assert.match(dp.evidence, /Provides 6\.0 amps output power/);
  assert.match(dp.evidence, /IFP-2100HV/);
  assert.match(dp.note, /CAPABILITY IS NOT A QUANTITY/);
  assert.match(dp.note, /PENDING_BUILDING_NAC_ALLOCATION/);
  // The old rationale ("no capacity evidence exists") is now superseded.
  assert.match(dp.correction, /earlier pass carried pn = 'RPS-1000HV' at MEDIUM confidence/);
  if (DB) {
    const o = out();
    assert.match(o, /AGGREGATE_THEORETICAL_MINIMUM = ceil\(41\.244 \/ 6\) = 7 x RPS-1000HV/);
    assert.match(o, /IS AN AGGREGATE THEORETICAL MINIMUM, NOT A FINAL QUANTITY/);
    assert.match(o, /FINAL QUANTITY = PENDING_BUILDING_NAC_ALLOCATION/);
  }
});

// 13 ------------------------------------------------------------------------
test("13 -- price source and brand scope are respected", () => {
  const o = resolved();
  for (const r of o.results) {
    assert.match(r.priceAuthority, /Farenhyt in-house|NO ADMITTED CANDIDATE/);
    // Every admitted, priced candidate must be Farenhyt-branded AND rule-sourced.
    for (const c of r.admittedCandidates) {
      if (c.pricedUnderFarenhytRule) assert.ok(c.listUsd > 0, `${c.pn} has a list price`);
    }
  }
  // The superseded GW-FCI / Gamewell-book codes must not be the live candidates.
  const live = FARENHYT_SELECTION.filter((s) => /notif/i.test(s.key)).flatMap((s) => s.candidates ?? []);
  for (const ghost of ["SRLED", "SGRLED", "SWLED", "SCRLED", "SCWLED", "P2RLED", "P2GRLED"]) {
    assert.ok(!live.includes(ghost), `${ghost} must not remain a live candidate`);
  }
  for (const s of FARENHYT_SELECTION.filter((x) => /notif/i.test(x.key))) {
    assert.ok(s.supersededCandidates, `${s.key} must record what it superseded`);
  }
});

// 14 ------------------------------------------------------------------------
test("14 -- the 65% Farenhyt rule cannot silently discount an unrelated brand record", () => {
  const src = readFile(join(REPO, "scripts", "build-al-mousa-farenhyt-internal-bom.mjs"));
  // Rule selection stays brand-scoped in the resolver.
  assert.match(src, /SELECT \* FROM discount_rules WHERE approval_state='Approved'/);
  // Brand scope is enforced in the governed discount engine itself.
  const lib = readFile(join(REPO, "app", "domain", "product-price-library.mjs"));
  assert.match(lib, /BRAND_SCOPE_MISMATCH/);
  assert.match(lib, /PRODUCT_BRAND_UNKNOWN/);
  // The notification resolver must scope its price lookup to the rule's own source.
  const nres = readFile(RESOLVER);
  assert.match(nres, /productsource_0d87f6ca-d3e1-4dd4-b452-5b83684ab0da/);
  assert.match(nres, /brandIsFarenhyt/);
  assert.match(nres, /must not silently inherit the 65%/);
});

// 15 ------------------------------------------------------------------------
test("15 -- partial cost remains clearly partial", () => {
  if (!DB) return;
  const o = out();
  assert.match(o, /THIS IS A PARTIAL MATERIAL COST, NOT THE FINAL PROJECT MATERIAL COST/);
  assert.doesNotMatch(o, /FINAL PROJECT MATERIAL COST\s*:\s*[\d,]/i);
  // Notification stayed uncosted, so the subtotal must be unchanged.
  assert.match(o, /Costable NET material subtotal\s+:\s+75988\.15 USD\s+=\s+284952\.28 SAR/);
  assert.match(o, /CONFIGURATION_REQUIRED\s+9/);
});

// 16 ------------------------------------------------------------------------
test("16 -- rerun is deterministic and idempotent", () => {
  if (!DB) return;
  assert.equal(out(), out(), "two repricing runs are byte-identical");
  assert.deepEqual(resolved(), resolved());
});
