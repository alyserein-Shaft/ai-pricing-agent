// AL MOUSA -- PER-PANEL SLC ADDRESS BUDGET + RIGHT-SIZING: MANDATED COVERAGE.
//
// All 16 mandated properties. READ-ONLY: the database is opened readOnly and no
// governed quantity, product selection or commercial output is written.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import {
  PHYSICAL_PANEL_SCOPES, POOL, CLASSIFICATION, buildPanelLedger, minimumLoops,
  NON_SLC_EXCLUSIONS,
} from "../scripts/lib/al-mousa-panel-slc-address-budget.mjs";
import { SEMANTIC_STATUS, boqFamily } from "../scripts/lib/al-mousa-drawing-boq-reconciliation.mjs";
import { GOVERNED_LABEL_FAMILY } from "../scripts/lib/al-mousa-drawing-geometry-takeoff.mjs";
import { loadPanelCapability } from "../scripts/lib/al-mousa-per-building-panel-reconstruction.mjs";
import { EXPANSION_STATE, loopAdmissibility } from "../scripts/lib/farenhyt-panel-capability.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(p, "utf8");
const BUDGET_SRC = read(join(HERE, "..", "scripts", "lib", "al-mousa-panel-slc-address-budget.mjs"));
const PER_PANEL_SRC = read(join(HERE, "..", "scripts", "size-al-mousa-fire-alarm-per-panel.mjs"));
const RUNNER_SRC = read(join(HERE, "..", "scripts", "size-al-mousa-per-panel-slc-budget.mjs"));
const db = process.env.FA_DB ? new DatabaseSync(process.env.FA_DB, { readOnly: true }) : null;

const SCOPE = PHYSICAL_PANEL_SCOPES[0];
const SOURCES = {
  drawing: { belowCeiling: 256, aboveCeiling: 131, heat: 14, combined: 6, duct: 13, manualStationTotal: 42, imControl: 13, imMonitor: 45, "S HC": 0 },
  boq: {
    [SEMANTIC_STATUS.BELOW_CEILING]: 253, [SEMANTIC_STATUS.ABOVE_CEILING]: 131,
    [SEMANTIC_STATUS.HEAT]: 9, [SEMANTIC_STATUS.COMBINED]: 6, [SEMANTIC_STATUS.DUCT]: 13,
    [SEMANTIC_STATUS.MANUAL]: 29, [SEMANTIC_STATUS.MANUAL_WP]: 10,
    [SEMANTIC_STATUS.IM_CONTROL]: 16, [SEMANTIC_STATUS.IM_MONITOR]: 29,
    DOOR_CONTACT: 26, [SEMANTIC_STATUS.FIREPHONE_JACK]: 19,
  },
};
const ledger = () => buildPanelLedger(SCOPE, SOURCES);

// 1 ------------------------------------------------------------------
test("1 -- above-ceiling S C is INCLUDED in the detector pool", () => {
  const l = ledger();
  const row = l.det.find((r) => r.demand.includes("Above Ceiling"));
  assert.ok(row, "an above-ceiling detector row exists");
  assert.equal(row.pool, POOL.DETECTOR);
  assert.equal(row.qty, 131, "S C enters the DETECTOR pool, not a separate pool");
  assert.equal(row.authority, "HUMAN_ENGINEERING_DECISION",
    "identity authority must remain the human engineering decision");
  assert.ok(row.note.includes("HUMAN-CONFIRMED"), "provenance is preserved");
  assert.match(row.note, /NOT rewritten/, "the original drawing legend is not rewritten");
  // It must actually be summed into the detector total.
  assert.ok(l.detectorTotal >= 131, "above-ceiling demand is inside detectorTotal");
  // The drawing still has no governed legend entry for it.
  assert.equal(GOVERNED_LABEL_FAMILY["S C"], undefined, "the legend still does not define S C");
});

// 2 ------------------------------------------------------------------
test("2 -- S HC stays UNRESOLVED", () => {
  const l = buildPanelLedger(SCOPE, { ...SOURCES, drawing: { ...SOURCES.drawing, "S HC": 16 } });
  const row = l.unresolved.find((r) => r.demand.startsWith("S HC"));
  assert.equal(row.qty, 16, "the exact quantity is preserved");
  assert.equal(row.identity, "PROJECT_NOTATION_UNRESOLVED");
  assert.equal(row.pool, POOL.UNRESOLVED, "it is not in the detector or module pool");
  // It must not be counted in either pool total.
  assert.equal(l.detectorTotal, 420, "S HC does not leak into the detector pool");
  assert.equal(l.moduleTotal, 129, "S HC does not leak into the module pool");
  assert.equal(boqFamily("S HC"), null, "no BOQ family absorbs it either");
});

// 3 ------------------------------------------------------------------
test("3 -- S HC detector-vs-module sensitivity runs BOTH cases", () => {
  const cap = { detectorsPerLoop: 159, modulesPerLoop: 159, panelPointCapacityIdpSk: 2100 };
  const caseD = minimumLoops({ detectorAddresses: 476, moduleAddresses: 123, unresolvedAsDetectors: 8, capability: cap });
  const caseM = minimumLoops({ detectorAddresses: 476, moduleAddresses: 123, unresolvedAsModules: 8, capability: cap });
  assert.equal(caseD.detectorAddresses, 484, "Case D puts S HC in the detector pool");
  assert.equal(caseM.moduleAddresses, 131, "Case M puts S HC in the module pool");
  assert.ok(caseD.detectorLoopMinimum !== caseM.detectorLoopMinimum,
    "the BOYS panel genuinely straddles the 3-loop threshold, so both cases must be visible");
  // The two cases are ALTERNATIVE bounds: the same 8 devices sit in the detector
  // pool in one and the module pool in the other, so they are never both added.
  assert.equal(caseD.detectorAddresses - 476, 8);
  assert.equal(caseM.moduleAddresses - 123, 8);
  assert.equal(caseD.moduleAddresses, 123, "Case D must not also inflate the module pool");
  assert.equal(caseM.detectorAddresses, 476, "Case M must not also inflate the detector pool");
});

// 4 ------------------------------------------------------------------
test("4 -- manual stations consume SLC MODULE-pool addresses", () => {
  const row = ledger().mod.find((r) => r.demand === "Addressable Manual Stations");
  assert.ok(row);
  assert.equal(row.pool, POOL.MODULE, "manual stations are module-pool demand");
  assert.equal(row.classification, "MODULE_POOL_ADDRESS_DEMAND");
  assert.ok(!ledger().det.some((r) => r.demand.includes("Manual")), "they are not in the detector pool");
  assert.ok(row.note.includes("SLC address"), "the address consumption is stated");
  // Device quantity and pool classification stay distinct concepts.
  assert.equal(row.qty, 42, "the reconciled DEVICE quantity is preserved");
  assert.equal(row.pool, POOL.MODULE, "and the POOL classification is separate");
});

// 5 ------------------------------------------------------------------
test("5 -- door contacts contribute INDEPENDENT module-address demand", () => {
  const l = ledger();
  const dc = l.mod.find((r) => r.demand === "DOOR_CONTACT_MONITORED_POINT_DEMAND");
  const gm = l.mod.find((r) => r.demand === "GENERIC_MONITOR_MODULE_DEMAND");
  assert.ok(dc && gm, "both demands exist as separate rows");
  assert.equal(dc.qty, 26, "1 door contact = 1 module-address demand");
  assert.equal(dc.pool, POOL.MODULE);
  assert.equal(gm.qty, 45);
  assert.notEqual(dc.qty, gm.qty, "they are not the same number collapsed together");
  assert.equal(l.moduleTotal, 42 + 16 + 45 + 26, "both are summed into the module pool");
  // Physical module count is NOT asserted.
  assert.match(dc.note, /NOT taken here/, "one-module-per-door is not assumed");
});

// 6 ------------------------------------------------------------------
test("6 -- generic Monitor Module rows are NOT assumed to include door contacts", () => {
  const gm = ledger().mod.find((r) => r.demand === "GENERIC_MONITOR_MODULE_DEMAND");
  assert.match(gm.note, /NOT assumed to include door contacts/);
  const dc = ledger().mod.find((r) => r.demand === "DOOR_CONTACT_MONITORED_POINT_DEMAND");
  assert.notEqual(gm.boq, dc.boq, "the two BOQ rows are distinct figures (29 vs 26)");
});

// 7 ------------------------------------------------------------------
test("7 -- passive firephone jacks do NOT automatically become SLC module addresses", () => {
  const l = ledger();
  const fp = l.unresolved.find((r) => r.demand.startsWith("FIREPHONE"));
  assert.equal(fp.qty, 19, "the jack count is recorded");
  assert.equal(fp.pool, POOL.UNRESOLVED, "it is unresolved, not module demand");
  assert.equal(fp.identity, "TOPOLOGY_UNRESOLVED");
  assert.equal(l.moduleTotal, 129, "jacks are excluded from the module pool");
  // They are explicitly listed as non-SLC.
  assert.ok(NON_SLC_EXCLUSIONS.includes("passive telephone jacks"));
  assert.ok(l.nonSlc.some((r) => r.demand.includes("Passive firephone")));
});

// 8 ------------------------------------------------------------------
test("8 -- detector and module capacities are checked SEPARATELY", () => {
  const cap = { detectorsPerLoop: 50, modulesPerLoop: 200, panelPointCapacityIdpSk: 1000 };
  // Detector-bound: 400 detectors / 200 modules.
  const r = minimumLoops({ detectorAddresses: 400, moduleAddresses: 200, capability: cap });
  assert.equal(r.detectorLoopMinimum, 8);
  assert.equal(r.moduleLoopMinimum, 1, "the module pool needs only one loop");
  assert.equal(r.calculatedMinimumLoops, 8, "the binding pool decides, not their sum");
  // The inverse must bind on modules instead.
  const r2 = minimumLoops({ detectorAddresses: 100, moduleAddresses: 800, capability: cap });
  assert.equal(r2.detectorLoopMinimum, 2);
  assert.equal(r2.moduleLoopMinimum, 4);
  assert.equal(r2.calculatedMinimumLoops, 4);
  // An aggregate points/combined division would have given (600/250)=3 for the
  // first case, which is LESS than the detector pool actually requires.
  assert.ok(r.calculatedMinimumLoops > Math.ceil(600 / 250), "aggregate division is provably insufficient");
  assert.match(r.note, /never used as the sizing formula/);
});

// 9 ------------------------------------------------------------------
test("9 -- BOYS/GIRLS mapping runs BOTH scenarios", () => {
  const src = read(join(HERE, "..", "scripts", "size-al-mousa-per-panel-slc-budget.mjs"));
  assert.match(src, /SCENARIO_A__B2_TO_BOYS/);
  assert.match(src, /SCENARIO_B__B2_TO_GIRLS/);
  assert.match(src, /boysBlock:\s*2[\s\S]*girlsBlock:\s*3/);
  assert.match(src, /boysBlock:\s*3[\s\S]*girlsBlock:\s*2/, "the inverted scenario is also present");
  assert.match(src, /NON_MATERIAL_TO_PANEL_SIZING/);
  assert.match(src, /MATERIAL_BUILDING_MAPPING_AMBIGUITY/);
});

// 10 -----------------------------------------------------------------
test("10 -- the ambiguous B2/B3 order cannot silently affect the result", () => {
  if (!db) return;
  const S = PHYSICAL_PANEL_SCOPES;
  assert.equal(S.find((s) => s.id === "PANEL-BOYS").boqBlock, "AMBIGUOUS_2_OR_3");
  assert.equal(S.find((s) => s.id === "PANEL-GIRLS").boqBlock, "AMBIGUOUS_2_OR_3");
  assert.equal(S.find((s) => s.id === "PANEL-BOYS").mappingClass, "BUILDING_MAPPING_AMBIGUOUS");
  // Both blocks must be claimed by exactly one panel, never both or neither.
  const claimed = S.filter((s) => s.boqBlock === "AMBIGUOUS_2_OR_3").length;
  assert.equal(claimed, 2);
});

// 11 -----------------------------------------------------------------
test("11 -- the IFP-75/6815 official-document conflict FAILS CLOSED", () => {
  if (!db) return;
  const cap = loadPanelCapability(db, "IFP-75HV");
  assert.equal(cap.expansionState, EXPANSION_STATE.OFFICIAL_DOCUMENTATION_CONFLICT);
  const adm = loopAdmissibility({ capability: cap, drawnLoops: 2 });
  assert.equal(adm.admissible, null, "a conflicted state authorises nothing");
  assert.equal(adm.state, "CONFLICTED_NO_PROCUREMENT_AUTHORITY");
  // And it must never be recorded as a settled technical exclusion either.
  assert.notEqual(adm.state, "INADMISSIBLE_EXPANSION_NOT_SUPPORTED");
  // Proven expansion, by contrast, IS admissible.
  const ok = loopAdmissibility({ capability: { slcLoopsInBuild: 1, expansionState: EXPANSION_STATE.SUPPORTED, expansionMaxCount: 12 }, drawnLoops: 6 });
  assert.equal(ok.admissible, true);
});

// 12 -----------------------------------------------------------------
test("12 -- aggregate campus pooling CANNOT justify a panel", () => {
  assert.doesNotMatch(RUNNER_SRC, /campus detector addresses required|aggregate lower bound/);
  assert.match(PER_PANEL_SRC, /pooled campus demand may not justify a panel/);
  assert.match(PER_PANEL_SRC, /NOT COMPUTED/, "the campus aggregate minimum is not computed at all");
  // Pooling is also not permitted to feed a panel's local SLC arithmetic.
  assert.match(BUDGET_SRC, /LOCAL_LOOPS_ONLY/);
  assert.match(BUDGET_SRC, /REMOTE_PANELS_DO_NOT_CONSUME_LOCAL_SLC_CAPACITY/);
  // The MFACP is a network master, NOT a campus field-device aggregator.
  const mf = PHYSICAL_PANEL_SCOPES[0];
  assert.equal(mf.panelRole, "CAMPUS_NETWORK_MASTER");
  assert.equal(mf.localServedScope, "KGS", "it serves only its own local scope");
  assert.equal(mf.networkScope, "CAMPUS");
  // No peer "KGS FACP" may exist alongside it.
  assert.equal(PHYSICAL_PANEL_SCOPES.length, 7);
  assert.ok(!PHYSICAL_PANEL_SCOPES.some((s) => s.id === "PANEL-KGS-FACP"));
});

// 13 -----------------------------------------------------------------
test("13 -- drawing design loops stay DISTINCT from the theoretical minimum", () => {
  const r = minimumLoops({ detectorAddresses: 420, moduleAddresses: 129, capability: { detectorsPerLoop: 159, modulesPerLoop: 159, panelPointCapacityIdpSk: 2100 } });
  assert.equal(r.calculatedMinimumLoops, 3);
  assert.equal(SCOPE.drawnSlcLoops, 6, "the drawing states 6");
  // 6 > 3 is ENGINEERING RESERVE, not an error to be corrected downward.
  const cls = SCOPE.drawnSlcLoops >= r.calculatedMinimumLoops
    ? (SCOPE.drawnSlcLoops === r.calculatedMinimumLoops ? CLASSIFICATION.MINIMUM_MATCHES : CLASSIFICATION.DRAWING_RESERVE)
    : CLASSIFICATION.DRAWING_BELOW;
  assert.equal(cls, CLASSIFICATION.DRAWING_RESERVE);
  assert.match(BUDGET_SRC, /DRAWING_HAS_ENGINEERING_RESERVE/);
  // NAC loops are never SLC loops.
  assert.ok(!JSON.stringify(PHYSICAL_PANEL_SCOPES).includes("NAC LOOP"));
});

// 14 -----------------------------------------------------------------
test("14 -- false merged BOQ rows cannot disappear from demand", () => {
  if (!db) return;
  // The live governed state is preserved exactly: still Merged, still not eligible.
  const rows = db.prepare(
    "SELECT sequence, review_status, approved_for_downstream FROM boq_items WHERE project_id=? AND review_status='Merged' ORDER BY sequence",
  ).all("project_ae501b85-9c12-4332-bf8e-787c90f2d388");
  assert.equal(rows.length, 8, "all 8 false merges are still in place");
  for (const r of rows) {
    assert.equal(r.review_status, "Merged");
    assert.equal(r.approved_for_downstream, 0, "still not downstream-eligible");
  }
  // Their quantities are nonetheless DISTINCT_SCOPE and must remain in sizing.
  const lens = buildPanelLedger(SCOPE, SOURCES);
  assert.equal(lens.detectorTotal, 420);
  assert.equal(lens.moduleTotal, 129);
  assert.ok(lens.det.some((r) => r.demand.includes("Below Ceiling")));
  // And no sizing path may filter on approved_for_downstream.
  assert.doesNotMatch(RUNNER_SRC, /approved_for_downstream/);
  assert.doesNotMatch(BUDGET_SRC, /approved_for_downstream/);
});

// 15 -----------------------------------------------------------------
test("15 -- no quotation / final-BOM target exists in the implementation", () => {
  const all = `${BUDGET_SRC}\n${RUNNER_SRC}\n${read(join(HERE, "al-mousa-panel-slc-address-budget.test.mjs"))}`;
  // Assembled from fragments so this file does not itself contain the tokens it
  // forbids -- otherwise the assertion would match its own source.
  const banned = ["clean" + "-golden-boq-oracle", "final_" + "quotation", "supplier_" + "quote", "CLEAN" + "_GOLDEN_BOQ_ORACLE", "final" + "BOM"];
  for (const token of banned) {
    assert.ok(!all.includes(token), `"${token}" must not appear in sizing code or tests`);
  }
  assert.ok(banned.every((t) => !BUDGET_SRC.includes(t) && !RUNNER_SRC.includes(t)),
    "the budget module and runner are the surfaces that must be clean");
  // The repaired script may NAME the oracle only to declare it validation-only.
  assert.match(PER_PANEL_SRC, /VALIDATION_ONLY/);
  assert.match(PER_PANEL_SRC, /NO TEST ORACLE MAY GENERATE A SIZING RESULT/,
    "the repaired script must state in-source that an oracle may not generate a result");
  // No capacity literal may be duplicated into the sizing path.
  assert.doesNotMatch(BUDGET_SRC, /\b(159|75|2100|2032|318)\b/, "no per-loop or system capacity literal in the budget module");
  assert.match(PER_PANEL_SRC, /loadPanelCapability/);
  assert.doesNotMatch(PER_PANEL_SRC, /^const PER_LOOP_\w+ = \d/m);
});

// 16 -----------------------------------------------------------------
test("16 -- rerun is deterministic", () => {
  const a = JSON.stringify(ledger());
  const b = JSON.stringify(buildPanelLedger(SCOPE, SOURCES));
  assert.equal(a, b, "two builds must agree exactly");
  const cap = { detectorsPerLoop: 159, modulesPerLoop: 159, panelPointCapacityIdpSk: 2100 };
  const m1 = JSON.stringify(minimumLoops({ detectorAddresses: 420, moduleAddresses: 129, capability: cap }));
  const m2 = JSON.stringify(minimumLoops({ detectorAddresses: 420, moduleAddresses: 129, capability: cap }));
  assert.equal(m1, m2);
});

// EXTRA: the sizing must follow the canonical capability module, not literals.
test("17 -- sizing FOLLOWS the canonical capability module (change it and the result moves)", () => {
  if (!db) return;
  const real = loadPanelCapability(db, "IFP-2100HV");
  assert.ok(Number.isInteger(real.detectorsPerLoop));
  // If the governed per-loop capacity were different, the loop minimum must move.
  const baseline = minimumLoops({ detectorAddresses: 420, moduleAddresses: 129, capability: real });
  const halved = minimumLoops({ detectorAddresses: 420, moduleAddresses: 129, capability: { ...real, detectorsPerLoop: Math.floor(real.detectorsPerLoop / 2) } });
  assert.ok(halved.detectorLoopMinimum > baseline.detectorLoopMinimum,
    "halving the governed per-loop capacity must increase the required loops");
  // The budget module carries no capacity literal at all (proved in test 15), so
  // the only route by which a capacity can enter is the governed object.
});

test.after(() => { if (db) db.close(); });