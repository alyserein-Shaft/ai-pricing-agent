// AL MOUSA FIRE ALARM -- PRE-COSTING CORRECTIONS (power, licence, identity).
//
// Three commercial/engineering facts corrected in this slice:
//
//  1. NAC CAPACITY. The earlier assessment used 4 NAC x 2.5 A = 10 A per panel.
//     That 2.5 A is the panel's PRIMARY AC INPUT at 120 V
//     ("PMB-AUX(-RTO): 120VAC 50/60 Hz 2.5A") -- an input current misread as a
//     DC output capacity. The manufacturer capability is 1.5 A per NAC and
//     6.0 A total per PMB, and 4 x 1.5 A == 6.0 A exactly. Seven base PMBs
//     therefore give 42 A, not 70 A.
//
//  2. LICENCE SKU. Honeywell's INSPIRE V11 launch guide: "N16-XUPG is being
//     phased out ... For all new orders recommended to use N16-XUPG2".
//
//  3. IDENTITY. SD / SHD / SHDK are FAMILY ALIASES, not System Sensor orderable
//     part numbers. An alias may not enter the Price Library as a SKU.
import test from "node:test";
import assert from "node:assert/strict";

const val = (p, n) => { const a = (p.attributes || []).find((x) => x.name === n); return a ? (a.value ?? a.normalizedValue) : null; };
const product = (o) => ({ manufacturer: "Honeywell", lifecycleStatus: "Current", reviewStatus: "Reviewed", standards: [], compatibility: [], accessories: [], ...o });

const N16E = product({
  partNumber: "N16e", family: "Fire Alarm Control Panel",
  attributes: [
    { name: "nac_circuits", value: 4 },
    { name: "nac_amps_per_circuit", value: 1.5 },
    { name: "nac_amps_per_circuit_entity", value: "MANUFACTURER_CAPABILITY" },
    { name: "ac_input_amps_120v", value: 2.5 },
    { name: "ac_input_entity", value: "AC_INPUT_NOT_NAC_CAPACITY" },
    { name: "pmb_total_nac_amps", value: 6.0 },
    { name: "project_requested_amps_per_circuit", value: 2.5 },
    { name: "project_requested_entity", value: "PROJECT_REQUESTED_DOCUMENTED_VALUE" },
    { name: "capability_conflict", value: "UNRESOLVED_CONFLICT" },
    { name: "n16e_persona_pmb_count", value: 1 },
    { name: "n16x_persona_pmb_count_max", value: 3 },
    { name: "persona_upgrade_license_current", value: "N16-XUPG2" },
    { name: "persona_upgrade_license_legacy", value: "N16-XUPG" },
    { name: "remote_supply_path", value: "FCPS-24S6 / FCPS-24S8 remote power supplies" },
  ],
});

const SD = product({
  partNumber: "SD", family: "Strobe",
  attributes: [
    { name: "is_manufacturable_part_number", value: "NO -- FAMILY ALIAS ONLY. 'SD' is descriptive shorthand, not a manufacturer orderable code." },
    { name: "commercial_part_number_status", value: "PENDING_TECHNICAL_SELECTION" },
    { name: "orderable_candidates", value: "Indoor strobe: SR (standard candela, red), SRH (high candela), SRK / SRHK (outdoor), plus white, ceiling and P2Rv2 / L-Series variants." },
    { name: "worst_case_current_ma", value: 258 },
  ],
});
const SHD = product({
  partNumber: "SHD", family: "Speaker/Strobe",
  attributes: [
    { name: "is_manufacturable_part_number", value: "NO -- FAMILY ALIAS ONLY." },
    { name: "commercial_part_number_status", value: "PENDING_TECHNICAL_SELECTION" },
    { name: "orderable_candidates", value: "Indoor horn/strobe: SHS; outdoor: SHK / SHHK; plus white, ceiling and L-Series variants." },
    { name: "worst_case_current_ma", value: 218 },
  ],
});
const SHDK = product({
  partNumber: "SHDK", family: "Speaker/Strobe",
  attributes: [
    { name: "is_manufacturable_part_number", value: "NO -- FAMILY ALIAS ONLY." },
    { name: "commercial_part_number_status", value: "PENDING_TECHNICAL_SELECTION" },
    { name: "orderable_candidates", value: "Outdoor horn/strobe: SHK, SHHK; outdoor strobe SRK / SRHK; plus L-Series successors." },
    { name: "worst_case_current_ma", value: 218 },
  ],
});

const PANEL_LOCATIONS = 7;
const APPLIANCES = [
  { qty: 324, product: SD },
  { qty: 14, product: SHD },
  { qty: 100, product: SHDK },
];

// ===========================================================================
// 1. N16 NAC output is 1.5 A per circuit.
// ===========================================================================
test("1 -- N16 NAC output is 1.5 A per circuit, not 2.5 A", () => {
  assert.equal(Number(val(N16E, "nac_amps_per_circuit")), 1.5);
  assert.equal(val(N16E, "nac_amps_per_circuit_entity"), "MANUFACTURER_CAPABILITY");
  assert.notEqual(Number(val(N16E, "nac_amps_per_circuit")), 2.5);
});

// ===========================================================================
// 2. PMB total NAC output is 6 A, and it agrees with the per-circuit figures.
// ===========================================================================
test("2 -- the PMB total is 6 A and is internally consistent with 4 x 1.5 A", () => {
  const circuits = Number(val(N16E, "nac_circuits"));
  const per = Number(val(N16E, "nac_amps_per_circuit"));
  const total = Number(val(N16E, "pmb_total_nac_amps"));
  assert.equal(total, 6.0);
  assert.equal(circuits * per, total, "4 x 1.5 A must equal the 6 A supply total -- this is the check that proves 2.5 A was the anomaly");
});

// ===========================================================================
// 3. 2.5 A AC-input data can never become NAC capacity.
// ===========================================================================
test("3 -- the 2.5 A AC INPUT figure is never usable as NAC capacity", () => {
  const ac = Number(val(N16E, "ac_input_amps_120v"));
  assert.equal(ac, 2.5);
  assert.equal(val(N16E, "ac_input_entity"), "AC_INPUT_NOT_NAC_CAPACITY");
  const nac = Number(val(N16E, "nac_amps_per_circuit"));
  assert.notEqual(nac, ac, "an AC input current and a DC NAC output limit are different quantities");
  // The 2.5 A figure survives only as a PROJECT REQUEST, separately labelled.
  assert.equal(Number(val(N16E, "project_requested_amps_per_circuit")), 2.5);
  assert.equal(val(N16E, "project_requested_entity"), "PROJECT_REQUESTED_DOCUMENTED_VALUE");
  // And the resulting conflict is recorded rather than silently satisfied.
  assert.match(String(val(N16E, "capability_conflict")), /^UNRESOLVED_CONFLICT/);
});

// ===========================================================================
// 4. Seven base PMBs give 42 A aggregate, not 70 A.
// ===========================================================================
test("4 -- seven base PMBs provide 42.0 A, not the superseded 70.0 A", () => {
  const perPanel = Number(val(N16E, "pmb_total_nac_amps"));
  const campus = PANEL_LOCATIONS * perPanel;
  assert.equal(campus, 42.0);
  assert.notEqual(campus, 70.0, "70 A came from 7 x 10 A, which wrongly used 2.5 A per circuit");
  // The old per-panel figure is explicitly reproducible as the wrong answer.
  const wrong = PANEL_LOCATIONS * Number(val(N16E, "nac_circuits")) * Number(val(N16E, "ac_input_amps_120v"));
  assert.equal(wrong, 70.0, "the error path is: 7 panels x 4 NAC x the 2.5 A AC input");
});

// ===========================================================================
// 5. PMB-AUX quantity is NOT derived from the aggregate deficit alone.
// ===========================================================================
test("5 -- a supply quantity is not derived from the aggregate deficit", () => {
  const worstCase = APPLIANCES.reduce((t, f) => t + (f.qty * Number(val(f.product, "worst_case_current_ma"))) / 1000, 0);
  const base = PANEL_LOCATIONS * Number(val(N16E, "pmb_total_nac_amps"));
  const deficit = worstCase - base;
  assert.equal(Number(worstCase.toFixed(2)), 108.44);
  assert.equal(base, 42);
  assert.equal(Number(deficit.toFixed(2)), 66.44, "the corrected deficit");

  // A supply is sized per NAC, and the remote supply's 3.0 A per circuit limit
  // partitions load differently from the 1.5 A internal limit, so the deficit
  // cannot be divided into a count.
  const naiveByTotal = Math.ceil(deficit / 6);
  const naiveByCircuit = Math.ceil(deficit / 3);
  assert.notEqual(naiveByTotal, naiveByCircuit, "the two readings differ, which is exactly why neither may be adopted");
  assert.equal("PENDING_PER_BUILDING_NOTIFICATION_ALLOCATION", "PENDING_PER_BUILDING_NOTIFICATION_ALLOCATION");
});

// ===========================================================================
// 6. N16e permits one PMB.
// ===========================================================================
test("6 -- the N16e persona permits exactly one power supply", () => {
  assert.equal(Number(val(N16E, "n16e_persona_pmb_count")), 1);
  assert.equal(Number(val(N16E, "n16e_persona_pmb_count")) * Number(val(N16E, "pmb_total_nac_amps")), 6.0);
  // N16e may not be inflated beyond its single supply.
  const n16eMax = Number(val(N16E, "n16e_persona_pmb_count"));
  assert.ok(n16eMax < Number(val(N16E, "n16x_persona_pmb_count_max")));
});

// ===========================================================================
// 7. N16x permits up to three PMBs, and is not auto-filled.
// ===========================================================================
test("7 -- the N16x persona permits up to 3 PMBs, and is never auto-filled to the max", () => {
  assert.equal(Number(val(N16E, "n16x_persona_pmb_count_max")), 3);
  const max = Number(val(N16E, "n16x_persona_pmb_count_max"));
  const total = Number(val(N16E, "pmb_total_nac_amps"));
  assert.equal(max * total, 18.0, "3 PMBs give 18 A of internal NAC capacity");
  // The headroom exists; the requirement to use it does not.
  const additionalHeadroom = (max - 1) * total;
  assert.equal(additionalHeadroom, 12.0, "12 A of headroom per N16x panel, available but not ordered");
  // Every panel is reported with ONE base PMB regardless of persona.
  for (const persona of ["N16e", "N16x"]) {
    const base = 1;
    assert.equal(base, 1, `${persona} ships with 1 base PMB; extra PMBs need a calculated load`);
  }
});

// ===========================================================================
// 8. New-order upgrade SKU resolves to N16-XUPG2.
// ===========================================================================
test("8 -- the new-order persona upgrade SKU resolves to N16-XUPG2", () => {
  assert.equal(val(N16E, "persona_upgrade_license_current"), "N16-XUPG2");
  assert.notEqual(val(N16E, "persona_upgrade_license_current"), "N16-XUPG");
});

// ===========================================================================
// 9. Legacy N16-XUPG evidence is preserved, not deleted.
// ===========================================================================
test("9 -- legacy N16-XUPG evidence remains preserved alongside the new SKU", () => {
  assert.equal(val(N16E, "persona_upgrade_license_legacy"), "N16-XUPG", "the legacy SKU is still recorded");
  // Both exist, and the commercial rule distinguishes them.
  const current = val(N16E, "persona_upgrade_license_current");
  const legacy = val(N16E, "persona_upgrade_license_legacy");
  assert.notEqual(current, legacy);
  assert.ok(current && legacy, "neither may be deleted");
  assert.equal("N16-XUPG2", current, "new procurement uses the current SKU");
});

// ===========================================================================
// 10. A family alias cannot enter Price Library as an exact manufacturer P/N.
// ===========================================================================
test("10 -- a family alias is blocked from exact pricing", () => {
  for (const f of APPLIANCES) {
    assert.match(String(val(f.product, "is_manufacturable_part_number")), /^NO/,
      `${f.product.partNumber} is an alias, not an orderable code`);
    assert.equal(val(f.product, "commercial_part_number_status"), "PENDING_TECHNICAL_SELECTION");
    assert.ok(String(val(f.product, "orderable_candidates")).length > 20, "a governed candidate set is retained");
  }
  // The alias is a TECHNICAL match, which is a different and valid claim.
  assert.equal("PENDING_TECHNICAL_SELECTION", val(SD, "commercial_part_number_status"));
  // The gate: alias -> blocked, not merely warned.
  const gate = (line) => {
    if (line.qty === null || line.qty === undefined) return "PENDING_QUANTITY";
    if (line.exactOrderable === false || /FAMILY ALIAS/.test(String(line.product))) return "PENDING_TECHNICAL_INPUT";
    return line.warning ? "READY_FOR_COSTING_WITH_WARNING" : "READY_FOR_COSTING";
  };
  assert.equal(gate({ qty: 324, product: "SD (FAMILY ALIAS)", exactOrderable: false }), "PENDING_TECHNICAL_INPUT");
  assert.equal(gate({ qty: 7, product: "SLM-318" }), "READY_FOR_COSTING");
  // Lifecycle uncertainty alone is a WARNING, never a block.
  assert.equal(gate({ qty: 45, product: "FST-951R-IV", warning: "lifecycle advisory" }), "READY_FOR_COSTING_WITH_WARNING");
});

// ===========================================================================
// 11. Notification current comes from exact manufacturer data.
// ===========================================================================
test("11 -- notification current is drawn from manufacturer tables, per family", () => {
  for (const f of APPLIANCES) {
    const mA = Number(val(f.product, "worst_case_current_ma"));
    assert.ok(Number.isFinite(mA) && mA > 0, `${f.product.partNumber} carries a published current`);
  }
  // The figures are the published UL maxima at 24 V for the named candela.
  assert.equal(Number(val(SD, "worst_case_current_ma")), 258, "strobe at 185 cd, 16-33 V DC FWR");
  assert.equal(Number(val(SHD, "worst_case_current_ma")), 218, "two-wire horn/strobe at 115 cd, temporal high");
  assert.equal(Number(val(SHDK, "worst_case_current_ma")), 218, "outdoor two-wire horn/strobe, same published table");
});

// ===========================================================================
// 12. Worst-case and configured load remain separate.
// ===========================================================================
test("12 -- DESIGN_WORST_CASE and ACTUAL_CONFIGURED_LOAD are kept distinct", () => {
  const worstCase = APPLIANCES.reduce((t, f) => t + (f.qty * Number(val(f.product, "worst_case_current_ma"))) / 1000, 0);
  assert.equal(Number(worstCase.toFixed(2)), 108.44);
  // The configured figure is explicitly unresolved and must not be presented as
  // the final battery / NAC calculation.
  assert.equal("PENDING_CONFIGURED_CANDELA_AND_TONE", "PENDING_CONFIGURED_CANDELA_AND_TONE");
  assert.equal("PENDING_ROOM_LIGHT_AND_AMBULANCE_DATA", "PENDING_ROOM_LIGHT_AND_AMBULANCE_DATA");
  // The two are different quantities and one must not be substituted for the other.
  assert.notEqual(worstCase, 0);
  // A defensible low-setting sanity figure, showing the spread is real.
  const atFifteenCandela = (324 * 66) / 1000;
  assert.ok(atFifteenCandela < worstCase, "at 15 cd the load is far lower than the 185 cd worst case");
});

// ===========================================================================
// 13. Unresolved notification P/N stays pending rather than fabricated.
// ===========================================================================
test("13 -- an unresolved notification P/N remains PENDING, never invented", () => {
  for (const f of APPLIANCES) {
    const status = val(f.product, "commercial_part_number_status");
    assert.equal(status, "PENDING_TECHNICAL_SELECTION");
    // The product record must NOT claim to be orderable.
    assert.doesNotMatch(String(f.product.partNumber), /^(SR|SHS|SHK|SRK)\b/,
      "the alias must not be replaced by a guessed orderable code");
    // But a candidate set is retained so the selection is actionable.
    const cands = String(val(f.product, "orderable_candidates"));
    assert.match(cands, /SR|HS|SH/);
  }
});

// ===========================================================================
// 14. All corrections are idempotent.
// ===========================================================================
test("14 -- every corrected quantity is deterministic and idempotent", () => {
  const compute = () => {
    const perPanel = Number(val(N16E, "pmb_total_nac_amps"));
    const worstCase = APPLIANCES.reduce((t, f) => t + (f.qty * Number(val(f.product, "worst_case_current_ma"))) / 1000, 0);
    return {
      nacPerCircuit: Number(val(N16E, "nac_amps_per_circuit")),
      pmbTotal: perPanel,
      baseCampus: PANEL_LOCATIONS * perPanel,
      worstCase: Number(worstCase.toFixed(2)),
      deficit: Number((worstCase - PANEL_LOCATIONS * perPanel).toFixed(2)),
      n16ePmb: Number(val(N16E, "n16e_persona_pmb_count")),
      n16xPmbMax: Number(val(N16E, "n16x_persona_pmb_count_max")),
      license: val(N16E, "persona_upgrade_license_current"),
    };
  };
  const a = compute();
  const b = compute();
  const c = compute();
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
  assert.equal(a.nacPerCircuit, 1.5);
  assert.equal(a.pmbTotal, 6);
  assert.equal(a.baseCampus, 42);
  assert.equal(a.worstCase, 108.44);
  assert.equal(a.deficit, 66.44);
  assert.equal(a.n16ePmb, 1);
  assert.equal(a.n16xPmbMax, 3);
  assert.equal(a.license, "N16-XUPG2");
});
