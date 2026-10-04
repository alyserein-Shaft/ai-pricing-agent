// AL MOUSA -- FARENHYT PANEL CAPABILITY AUTHORITY: MANDATED COVERAGE (13).
//
// These tests police the CAPABILITY MODEL, not the Al Mousa result. Every
// assertion is anchored on PANEL_CAPABILITY_FACTS, which carries the document,
// revision, section and exact first-party proposition for each fact.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import {
  PANEL_CAPABILITY_FACTS, EXPANSION_STATE, capabilityFromAttributes, loopAdmissibility,
} from "../scripts/lib/farenhyt-panel-capability.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUDGET = readFileSync(join(HERE, "..", "scripts", "lib", "al-mousa-panel-slc-address-budget.mjs"), "utf8");
const RUNNER = readFileSync(join(HERE, "..", "scripts", "size-al-mousa-per-panel-slc-budget.mjs"), "utf8");
const PACKET = readFileSync(join(HERE, "..", "scripts", "al-mousa-capability-review-packet.mjs"), "utf8");
const db = process.env.FA_DB ? new DatabaseSync(process.env.FA_DB, { readOnly: true }) : null;

const fact = (pn, attr) => PANEL_CAPABILITY_FACTS.find((f) => f.partNumber === pn && f.attribute === attr);
// capabilityFromAttributes reads PERSISTED rows, which carry `normalized_value`.
// PANEL_CAPABILITY_FACTS is the SOURCE form, which carries `value` (and may be an
// array). Adapt the shape without altering either.
const asRow = (f) => ({
  attribute_name: f.attribute,
  normalized_value: Array.isArray(f.value) ? JSON.stringify(f.value) : String(f.value),
  original_value: f.original,
});
const rowsFor = (pn) => [...PANEL_CAPABILITY_FACTS.filter((f) => f.partNumber === pn).map(asRow),
  { attribute_name: "part_number", normalized_value: pn }];
const bundle = (pn) => capabilityFromAttributes(rowsFor(pn));
const I2100 = () => bundle("IFP-2100HV");
const I75 = () => bundle("IFP-75HV");

// 1 ------------------------------------------------------------------
test("1 -- IFP-2100 native SLC count comes from canonical capability evidence", () => {
  const f = fact("IFP-2100HV", "slc_loop_count");
  assert.ok(f, "native SLC loop count is a governed fact");
  assert.equal(f.value, 1);
  assert.ok(f.original && f.original.length > 20, "the fact carries its first-party proposition");
  assert.match(f.original, /signaling line circuit/i);
  assert.equal(I2100().slcLoopsInBuild, 1);
  assert.ok(["IFP-2100_DS", "IFP-2100_MANUAL", "IFP-2100_ECS_6815_DS"].includes(f.source));
});

// 2 ------------------------------------------------------------------
test("2 -- detector and module limits are INDEPENDENT dimensions", () => {
  const d = fact("IFP-2100HV", "detectors_per_loop");
  const m = fact("IFP-2100HV", "modules_per_loop");
  assert.ok(d && m, "both limits exist as separate facts");
  assert.equal(d.value, 159);
  assert.equal(m.value, 159);
  // Equal VALUES, but they must be separate facts with separate propositions,
  // and the store must not define a single collapsed "per loop" number.
  assert.notEqual(d, m, "they are two facts, not one");
  assert.notEqual(d.original, m.original, "each carries its own proposition");
  const b = I2100();
  assert.equal(b.detectorsPerLoop, 159);
  assert.equal(b.modulesPerLoop, 159);
  // No combined figure may be invented by adding them.
  assert.equal(b.combinedPerLoop ?? null, null, "no combined per-loop capacity is asserted");
  assert.equal(PANEL_CAPABILITY_FACTS.filter((f) => /combined/i.test(f.attribute)).length, 0,
    "no combined-address fact exists in the model");
});

// 3 ------------------------------------------------------------------
test("3 -- 2100 is modelled as SYSTEM SLC point capacity, not per-loop", () => {
  const sys = fact("IFP-2100HV", "max_system_slc_points_idp_sk");
  assert.ok(sys, "system SLC ceiling is its own fact");
  assert.equal(sys.value, 2100);
  assert.match(sys.original, /maximum number of IDP or SK SLC devices per panel is 2,100/i);
  const b = I2100();
  assert.equal(b.maxSystemSlcPointsIdpSk, 2100);
  assert.equal(b.panelPointCapacityIdpSk, 2100);
  // It must NOT be readable as a per-loop figure.
  assert.notEqual(b.detectorsPerLoop, 2100);
  assert.notEqual(b.modulesPerLoop, 2100);
});

// 4 ------------------------------------------------------------------
test("4 -- the SBUS/physical 6815 limit is NOT inferred from 2100/159", () => {
  const sbus = fact("IFP-2100HV", "max_sbus_6815_expanders");
  assert.ok(sbus, "the physical/SBUS expander limit is its own fact");
  assert.equal(sbus.value, 63);
  assert.match(sbus.original, /supports 63 6815s/);
  // The point-capacity arithmetic consequence must be LABELLED as derived.
  const derived = fact("IFP-2100HV", "full_populated_loop_equivalent_at_system_ceiling");
  assert.ok(derived, "the loop-equivalent arithmetic is retained but labelled");
  assert.equal(derived.value, 13);
  assert.match(derived.original, /DERIVED, NOT A MANUFACTURER LIMIT/);
  assert.match(derived.original, /must never be read as a maximum physical 6815 count/);
  // The decisive non-conflation: 63 is NOT 12, and NOT 2100/159.
  assert.notEqual(sbus.value, derived.value);
  assert.notEqual(sbus.value, Math.floor(2100 / 159));
  assert.equal(I2100().maxSbus6815Expanders, 63);
  assert.equal(I2100().sbusDeviceCapacity, 63, "the SBUS ceiling that binds it is modelled too");
});

// 5 ------------------------------------------------------------------
test("5 -- the unsupported '12 expansion maximum' cannot survive without explicit evidence", () => {
  const f = fact("IFP-2100HV", "slc_expansion_max_count");
  assert.ok(f, "the corrected maximum is retained under the same attribute");
  assert.equal(f.value, 63, "the value is 63, not the derived 12");
  assert.match(f.original, /CORRECTED/);
  assert.match(f.original, /no first-party proposition/i);
  assert.match(f.original, /2100\/159/, "the rejected derivation is named, not hidden");
  // No fact anywhere may still assert 12 as an expander maximum.
  for (const x of PANEL_CAPABILITY_FACTS) {
    assert.notEqual(x.value, 12, `no capability fact may assert 12 (${x.partNumber}.${x.attribute})`);
  }
  // The live persisted row is still 12 and awaiting human review -- that is the
  // honest state, and the packet must say so.
  if (db) {
    const row = db.prepare(
      `SELECT normalized_value, review_status FROM product_attributes WHERE product_id=
       (SELECT id FROM library_products WHERE part_number='IFP-2100HV') AND attribute_name='slc_expansion_max_count'`,
    ).get();
    assert.ok(row, "the persisted row exists");
    assert.equal(row.normalized_value, "12", "this slice did NOT write the correction");
    assert.match(row.review_status, /Needs Review/);
    assert.match(PACKET, /NOTHING WAS WRITTEN TO THE DATABASE/);
    assert.match(PACKET, /REPLACE 12 WITH 63/);
  }
});

// 6 ------------------------------------------------------------------
test("6 -- 6815 compatibility includes IFP-2100 where evidence proves it", () => {
  const c = fact("6815", "compatible_panel_families_enumerated");
  assert.ok(c, "the enumerated compatibility list is a governed fact");
  const models = c.value;
  assert.ok(Array.isArray(models));
  assert.ok(models.some((m) => /IFP-2100\/ECS/.test(m)), "IFP-2100/ECS is listed");
  assert.ok(models.some((m) => /IFP-300\/ECS/.test(m)), "IFP-300/ECS is listed");
  assert.ok(!models.some((m) => /IFP-75/.test(m)), "IFP-75 is NOT among the enumerated models");
  assert.match(c.original, /IFP-75 is NOT among the enumerated models/);
  // IFP-2100HV is manufacturer-supported for 6815.
  assert.equal(fact("IFP-2100HV", "slc_expansion_state").value, EXPANSION_STATE.SUPPORTED);
});

// 7 ------------------------------------------------------------------
test("7 -- IFP-75 does not gain 6815 authority from a current-draw worksheet", () => {
  // The hypothesised evidence set C is REFUTED: the IFP-75 manual contains zero
  // occurrences of 6815, so it cannot even be tested from a worksheet.
  const m = fact("IFP-75HV", "ifp75_manual_6815_mentions");
  assert.ok(m, "the manual's 6815 mention count is recorded as evidence");
  assert.equal(m.value, 0);
  assert.match(m.original, /ZERO occurrences of '6815'/);
  assert.match(m.original, /Presence in a current-draw worksheet cannot even be tested/);
  assert.match(m.original, /LS10147-001SK-E Rev D 06\/25\/2021/);
  // The datasheet exclusion stands independently.
  assert.equal(I75().expansionState, EXPANSION_STATE.OFFICIAL_DOCUMENTATION_CONFLICT);
});

// 8 ------------------------------------------------------------------
test("8 -- the IFP-75 conflict remains FAIL-CLOSED for new-project selection", () => {
  assert.equal(I75().expansionState, EXPANSION_STATE.OFFICIAL_DOCUMENTATION_CONFLICT);
  assert.equal(I75().expansionMaxCount, null, "no maximum may be stated while conflicted");
  const auth = fact("IFP-75HV", "slc_expansion_authority");
  assert.equal(auth.value, "NOT_CONFIRMED");
  const adm = loopAdmissibility({ capability: I75(), drawnLoops: 2 });
  assert.equal(adm.admissible, null, "a conflicted state authorises nothing");
  assert.equal(adm.state, "CONFLICTED_NO_PROCUREMENT_AUTHORITY");
  // It must NOT be converted into a settled technical rejection either.
  assert.notEqual(adm.state, "INADMISSIBLE_EXPANSION_NOT_SUPPORTED");
  // Nor into a global impossibility claim.
  assert.match(auth.original, /NOT_CONFIRMED/);
  assert.doesNotMatch(auth.original, /can never|never support|incompatible/i,
    "the narrower factual statement is required");
});

// 9 ------------------------------------------------------------------
test("9 -- 5815RMK capacity = two 6815 only when first-party evidence is loaded", () => {
  const kit = fact("5815RMK", "loop_cards_per_kit");
  assert.ok(kit, "kit capacity is a governed fact");
  assert.equal(kit.value, 2);
  // The FIRST-PARTY corroboration is the 6815 Data Sheet accessory list.
  const encl = fact("5815RMK", "mounting_capacity_6815_in_enclosure");
  assert.equal(encl.value, 2);
  assert.match(encl.original, /Cabinet holds two 6815s/i);
  assert.match(kit.original, /2 SLC Cards/i, "the pre-existing proposition is retained");
  // The other enclosures have their own, DIFFERENT capacities.
  assert.equal(fact("SK-NIC-KIT", "mounting_capacity_6815_in_enclosure").value, 1,
    "SK-NIC-KIT holds only one 6815");
  assert.equal(fact("RPS-1000HV", "mounting_capacity_6815_in_enclosure").value, 2);
  // With no evidence at all, capacity must be null, never a default of 2.
  assert.equal(capabilityFromAttributes([{ attribute_name: "part_number", normalized_value: "5815RMK" }])
    .mountingCapacityInEnclosure ?? null, null);
});

// 10 -----------------------------------------------------------------
test("10 -- mounting capacity and expansion REQUIREMENT are separate concepts", () => {
  const mfg = I2100().mountingCapacityInPanelCabinet;
  assert.equal(mfg, 2, "in-cabinet mounting capacity is modelled");
  // A 5-expander panel needs 5 expanders but only 2 fit in its own cabinet --
  // the remainder is REMOTE demand, which is an allocation result, not a capacity.
  const required = 5;
  assert.ok(required > mfg, "the test case genuinely needs remote mounting");
  assert.notEqual(required, mfg, "requirement is not capacity");
  // The runner must not derive a kit quantity; the allocator does that later.
  assert.match(RUNNER, /NOT DERIVED IN THIS SLICE/);
  assert.match(RUNNER, /consume in-enclosure slots before remote demand/);
});

// 11 -----------------------------------------------------------------
test("11 -- Al Mousa sizing carries NO manufacturer-capability literal", () => {
  // A bare number is banned; a number inside a PART NUMBER (IFP-2100) is not a
  // capacity, so the check targets assignment/property contexts only.
  const literalUse = (lit) => new RegExp(`[:=]\\s*${lit}\\b|\\b${lit}\\s*[*x]\\s*(?!\\S)|perLoop\\s*:\\s*${lit}`);
  for (const lit of ["159", "2100", "2032", "75", "150", "63"]) {
    assert.ok(!literalUse(lit).test(BUDGET), `the address-budget module must not hard-code ${lit}`);
    assert.ok(!literalUse(lit).test(RUNNER), `the sizing runner must not hard-code ${lit}`);
  }
  // Capacity can only arrive through the governed capability object.
  assert.match(BUDGET, /capability/);
  assert.doesNotMatch(BUDGET, /detectorsPerLoop:\s*\d|modulesPerLoop:\s*\d|panelPointCapacityIdpSk:\s*\d/);
});

// 12 -----------------------------------------------------------------
test("12 -- historical / final quotation data is not used", () => {
  const packet = PACKET;
  for (const token of ["clean" + "-golden-boq-oracle", "final_" + "quotation", "CLEAN" + "_GOLDEN", "supplier_" + "quote"]) {
    for (const src of [BUDGET, RUNNER, packet]) {
      assert.ok(!src.includes(token), `"${token}" must not appear`);
    }
  }
  // And the packet performs no database mutation of any kind.
  // SQL, not the English verb: the packet legitimately says "INSERT as a fact".
  assert.doesNotMatch(packet, /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|\.run\(|\.exec\()/i,
    "the review packet must contain no SQL statement and no mutation call");
  assert.match(packet, /readOnly: true/);
  assert.match(packet, /NOTHING WAS WRITTEN TO THE DATABASE/);
  assert.match(packet, /self-promote/i, "the packet must state it does not self-promote the facts");
});

// 13 -----------------------------------------------------------------
test("13 -- rerun is deterministic and the evidence is citable", () => {
  const first = JSON.stringify(I2100());
  const second = JSON.stringify(bundle("IFP-2100HV"));
  assert.equal(first, second, "two capability reads must agree");
  // Every fact carries a citable source and its proposition.
  for (const f of PANEL_CAPABILITY_FACTS) {
    assert.ok(f.source, `${f.partNumber}.${f.attribute} must name a source`);
    assert.ok(typeof f.original === "string" && f.original.length > 0,
      `${f.partNumber}.${f.attribute} must carry its proposition`);
  }
  const sources = new Set(PANEL_CAPABILITY_FACTS.map((f) => f.source));
  assert.ok(sources.has("IFP-2100_ECS_6815_DS"), "the 6815 Data Sheet is cited");
  assert.ok(sources.has("IFP-75_MANUAL"), "the IFP-75 manual is cited");
  assert.ok(sources.has("IFP-2100_MANUAL"), "the IFP-2100 manual is cited");
});
test.after(() => { if (db) db.close(); });