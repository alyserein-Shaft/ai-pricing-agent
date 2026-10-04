// AL MOUSA -- PER-PANEL SLC ADDRESS BUDGET + FARENHYT RIGHT-SIZING (runner).
//
// READ-ONLY. Opens the database read-only, writes nothing, selects no product
// identity and touches no commercial output. It produces a TECHNICAL BASIS.
//
// Preserved live state: the 8 false-merged BOQ rows remain Merged / not
// downstream-eligible. Their quantities are still DISTINCT_SCOPE per the
// structural audit, so they are included in read-only sizing and reported.

import { DatabaseSync } from "node:sqlite";
import {
  PROJECT, SEMANTIC_STATUS as S, boqBlocks, drawingByBuilding, stationDrawing, geo,
  ABOVE_CEILING_CANDIDATE,
} from "./lib/al-mousa-drawing-boq-reconciliation.mjs";
import {
  PHYSICAL_PANEL_SCOPES, CLASSIFICATION, buildPanelLedger, minimumLoops,
} from "./lib/al-mousa-panel-slc-address-budget.mjs";
import {
  loadAllPanelCapabilities, rightSizePanel, expansionForPanel,
} from "./lib/al-mousa-per-building-panel-reconstruction.mjs";

const db = new DatabaseSync(process.env.FA_DB, { readOnly: true });
const blocks = boqBlocks(db, PROJECT);
const draw = drawingByBuilding(geo);
const sd = stationDrawing(geo);

const campusBlocks = blocks.filter((b) => b.stations.length === 0 && Object.keys(b.families).length);
const byBlock = (n) => campusBlocks.find((b) => b.block === n)?.families ?? {};
const stationByScope = (needle) => blocks.flatMap((b) => b.stations)
  .find((s) => s.scope.toLowerCase().includes(needle.toLowerCase()))?.families ?? {};

/** Drawing-side figures for one building, as the geometry takeoff produced them. */
function drawingFor(buildingKey) {
  const d = draw[buildingKey];
  if (!d) return {};
  const f = d.families;
  const u = d.unidentified ?? {};
  return {
    belowCeiling: f[S.BELOW_CEILING] ?? null,
    aboveCeiling: f[ABOVE_CEILING_CANDIDATE] ?? null,
    heat: f[S.HEAT] ?? null,
    combined: f[S.COMBINED] ?? null,
    duct: f[S.DUCT] ?? null,
    manualStationTotal: f.MANUAL_STATION_TOTAL ?? null,
    imControl: f[S.IM_CONTROL] ?? null,
    imMonitor: f[S.IM_MONITOR] ?? null,
    "S HC": u["S HC"] ?? 0,
  };
}

/** Station-side drawing figures from the AMS-002 captioned scopes. */
function stationDrawingFor(captionNeedle) {
  const sc = sd.scopes.find((s) => s.caption.toLowerCase().includes(captionNeedle.toLowerCase()));
  if (!sc) return {};
  return {
    onSlab: sc.families.SMOKE_ON_SLAB ?? null,
    heat: sc.families.HEAT ?? null,
    manualStationTotal: sc.families.MANUAL_STATION_TOTAL ?? null,
    "S HC": 0,
  };
}

/** BOYS/GIRLS block order is ambiguous; both scenarios are carried. */
const SCENARIOS = Object.freeze({
  A: { label: "SCENARIO_A__B2_TO_BOYS", boysBlock: 2, girlsBlock: 3 },
  B: { label: "SCENARIO_B__B2_TO_GIRLS", boysBlock: 3, girlsBlock: 2 },
});

function sourcesFor(scope, scenario) {
  if (scope.boqBlock === 1) return { drawing: drawingFor("KGS"), boq: byBlock(1) };
  if (scope.boqBlock === 4) return { drawing: drawingFor("WELCOME CENTER"), boq: byBlock(4) };
  if (scope.id === "PANEL-BOYS") return { drawing: drawingFor("BOYS"), boq: byBlock(scenario.boysBlock) };
  if (scope.id === "PANEL-GIRLS") return { drawing: drawingFor("GIRLS"), boq: byBlock(scenario.girlsBlock) };
  if (scope.id === "PANEL-SUB-STATION-1") return { drawing: stationDrawingFor("MV SWGR"), boq: stationByScope("Sub Station-1") };
  if (scope.id === "PANEL-SUB-STATION-2") return { drawing: stationDrawingFor("SS-GRS-1"), boq: stationByScope("Sub Station-2") };
  if (scope.id === "PANEL-DG-STATION") return { drawing: stationDrawingFor("GENERATOR"), boq: stationByScope("DG Station") };
  return {};
}

const capabilities = loadAllPanelCapabilities(db);
const NAMES = Object.fromEntries(capabilities.map((c) => [c.partNumber, c]));

function evaluate(scenario) {
  const panels = [];
  for (const scope of PHYSICAL_PANEL_SCOPES) {
    const src = sourcesFor(scope, scenario);
    const ledger = buildPanelLedger(scope, src);
    const shc = ledger.unresolved.find((u) => u.demand.startsWith("S HC"))?.qty ?? 0;
    const jacks = ledger.unresolved.find((u) => u.demand.startsWith("FIREPHONE"))?.qty ?? 0;

    // Bounded S HC sensitivity: Case D = detector addresses, Case M = module.
    const caseD = minimumLoops({ detectorAddresses: ledger.detectorTotal, moduleAddresses: ledger.moduleTotal, unresolvedAsDetectors: shc, capability: NAMES["IFP-2100HV"] });
    const caseM = minimumLoops({ detectorAddresses: ledger.detectorTotal, moduleAddresses: ledger.moduleTotal, unresolvedAsModules: shc, capability: NAMES["IFP-2100HV"] });
    // Firephone worst case: every passive jack becoming one module address.
    const fpWorst = minimumLoops({ detectorAddresses: ledger.detectorTotal, moduleAddresses: ledger.moduleTotal, unresolvedAsDetectors: shc, unresolvedAsModules: jacks, capability: NAMES["IFP-2100HV"] });

    const sizing = rightSizePanel({
      panelId: scope.id, loops: { drawnLoops: scope.drawnSlcLoops },
      capabilities, detectorDemand: ledger.detectorTotal, moduleDemand: ledger.moduleTotal,
      nacCircuits: null, requiredFeatures: scope.drawnSlcLoops > 1 ? ["EXPANSION"] : [],
    });
    // `selected` is the ONLY thing that may be reported as selected. A panel
    // whose SLC expansion authority is NOT_CONFIRMED (IFP-75HV / 6815) lands in
    // `candidates` with an unproven note, and `smallestAdmissible` would name it
    // as if it were chosen. Substituting it would silently select the panel the
    // manufacturer evidence conflict forbids for new-project selection.
    const selectedPn = sizing.selected;
    const admissibleButUnproven = sizing.candidates ?? [];

    // rightSizePanel reports `selected` only when the SMALLEST admissible
    // candidate is fully proven. Where the smallest candidate carries an
    // unproven-evidence note but a LARGER candidate is fully proven, that
    // module returns selected=null even though a valid technical basis exists.
    // Rather than modify that shared module (other flows depend on it), resolve
    // it here using the per-candidate `unproven` map it already returns. If NO
    // candidate is fully proven, nothing is selected.
    let resolvedPn = selectedPn;
    let resolvedBy = selectedPn ? "rightSizePanel.selected" : null;
    if (!resolvedPn) {
      const byCapacity = [...(sizing.candidates ?? [])].sort(
        (a, b) => (NAMES[a]?.panelPointCapacityIdpSk ?? 0) - (NAMES[b]?.panelPointCapacityIdpSk ?? 0));
      const fullyProven = byCapacity.find((pn) => (sizing.unproven?.[pn] ?? []).length === 0);
      if (fullyProven) { resolvedPn = fullyProven; resolvedBy = "smallest FULLY-PROVEN candidate (smallest candidate had unproven evidence)"; }
    }
    // Expansion hardware is computed from the RESOLVED panel, so a station panel
    // is not left reporting an unknown expander count merely because the
    // smallest candidate had unproven evidence.
    const expansion = expansionForPanel({ panelId: scope.id, drawnLoops: scope.drawnSlcLoops, panelPn: resolvedPn, capability: resolvedPn ? NAMES[resolvedPn] : null });

    panels.push({
      scope, ledger, shc, jacks,
      caseD, caseM, fpWorst,
      drawnVsMinimum: scope.drawnSlcLoops >= caseD.calculatedMinimumLoops
        ? (scope.drawnSlcLoops === caseD.calculatedMinimumLoops ? CLASSIFICATION.MINIMUM_MATCHES : CLASSIFICATION.DRAWING_RESERVE)
        : CLASSIFICATION.DRAWING_BELOW,
      sizing, selectedPn: resolvedPn, selectedBy: resolvedBy, admissibleButUnproven, expansion,
      // Admissible-but-unproven candidates cannot be selected, but they must be
      // reported with the reason, never dropped.
      unselectedReason: sizing.blockers && sizing.blockers.length
        ? sizing.blockers.join("; ")
        : null,
    });
  }
  return { scenario, panels };
}

const runA = evaluate(SCENARIOS.A);
const runB = evaluate(SCENARIOS.B);

const line = (t) => console.log(`\n${t}\n${"=".repeat(t.length)}`);

line("A. PHYSICAL PANEL INVENTORY");
console.log(`  ${"Scope".padEnd(24)}${"Role".padEnd(22)}${"Location".padEnd(16)}${"Local scope".padEnd(15)}${"Network".padEnd(9)}${"Loops".padStart(6)}  class`);
for (const s of PHYSICAL_PANEL_SCOPES) {
  console.log(`  ${s.id.padEnd(24)}${s.panelRole.padEnd(22)}${s.physicalLocation.padEnd(16)}${s.localServedScope.padEnd(15)}${s.networkScope.padEnd(9)}${String(s.drawnSlcLoops).padStart(6)}  ${s.drawnLoopsClass}`);
}
console.log(`  TOTAL drawing design SLC loops = ${PHYSICAL_PANEL_SCOPES.reduce((t, s) => t + s.drawnSlcLoops, 0)}  (NAC LOOP excluded)`);

for (const run of [runA, runB]) {
  line(`${run.scenario.label}`);
  for (const p of run.panels) {
    console.log(`\n  ${p.scope.id}  (${p.scope.physicalLocation})`);
    console.log(`     pool rows:`);
    for (const r of p.ledger.det) console.log(`       DET      ${String(r.qty).padStart(5)}  ${r.demand.padEnd(42)} draw=${String(r.drawing).padStart(5)} boq=${String(r.boq).padStart(5)}  ${r.basis}`);
    for (const r of p.ledger.mod) console.log(`       MOD      ${String(r.qty).padStart(5)}  ${r.demand.padEnd(42)} draw=${String(r.drawing).padStart(5)} boq=${String(r.boq).padStart(5)}  ${r.basis}`);
    for (const r of p.ledger.unresolved) console.log(`       UNRESOLV ${String(r.qty).padStart(5)}  ${r.demand.padEnd(42)} ${r.identity ?? ""}`);
    for (const r of p.ledger.nonSlc) console.log(`       NON-SLC  ${String(r.qty).padStart(5)}  ${r.demand}`);
    console.log(`     detector pool = ${p.ledger.detectorTotal}   module pool = ${p.ledger.moduleTotal}`);
    console.log(`     min loops: detector=${p.caseD.detectorLoopMinimum} module=${p.caseD.moduleLoopMinimum} system=${p.caseD.systemLoopMinimum} -> ${p.caseD.calculatedMinimumLoops}   drawn=${p.scope.drawnSlcLoops}  => ${p.drawnVsMinimum}`);
    const shcMinSame = p.caseD.calculatedMinimumLoops === p.caseM.calculatedMinimumLoops;
    // Selection is driven by the DRAWN loop count, so it is identical under both
    // S HC cases by construction; only the minimum-loop cross-check can move.
    console.log(`     S HC: CaseD(det)=${p.caseD.calculatedMinimumLoops}L  CaseM(mod)=${p.caseM.calculatedMinimumLoops}L  minimum ${shcMinSame ? "unchanged" : `SHIFTS ${p.caseM.calculatedMinimumLoops}->${p.caseD.calculatedMinimumLoops}`}`);
    console.log(`          selected architecture under BOTH cases = ${p.selectedPn ?? "NONE"}  => S_HC_IDENTITY_NON_MATERIAL_TO_PANEL_SELECTION${shcMinSame ? "" : " (but material to the minimum-loop cross-check)"}`);
    console.log(`     firephone worst case (all ${p.jacks} jacks as modules): ${p.fpWorst.calculatedMinimumLoops} loops  => ${p.fpWorst.calculatedMinimumLoops <= p.scope.drawnSlcLoops ? "FIREPHONE_TOPOLOGY_NON_MATERIAL" : "FIREPHONE_TOPOLOGY_BLOCKS"}`);
    console.log(`     sizing: ${p.sizing.status}  SELECTED=${p.selectedPn ?? "NONE (not selectable on current evidence)"}${p.selectedBy ? `   [${p.selectedBy}]` : ""}`);
    if (p.admissibleButUnproven.length) console.log(`     admissible-but-unproven: ${p.admissibleButUnproven.join(", ")}  <- ${p.unselectedReason}`);
    console.log(`     evaluation: ${JSON.stringify(p.sizing.evaluation)}`);
    console.log(`     expansion: ${p.expansion.status} loopCards=${p.expansion.loopCards} kits=${p.expansion.kits ?? "null"}`);
  }
}

line("E. BOYS/GIRLS SCENARIO COMPARISON");
const pick = (run, id) => run.panels.find((p) => p.scope.id === id);
for (const id of ["PANEL-BOYS", "PANEL-GIRLS"]) {
  const a = pick(runA, id); const b = pick(runB, id);
  console.log(`  ${id}`);
  console.log(`     A: det=${a.ledger.detectorTotal} mod=${a.ledger.moduleTotal} min=${a.caseD.calculatedMinimumLoops} drawn=${a.scope.drawnSlcLoops} sel=${a.selectedPn}`);
  console.log(`     B: det=${b.ledger.detectorTotal} mod=${b.ledger.moduleTotal} min=${b.caseD.calculatedMinimumLoops} drawn=${b.scope.drawnSlcLoops} sel=${b.selectedPn}`);
  const selSame = a.selectedPn === b.selectedPn;
  const loopsSame = a.scope.drawnSlcLoops === b.scope.drawnSlcLoops;
  console.log(`     -> ${selSame && loopsSame ? "NON_MATERIAL_TO_PANEL_SIZING (selected panel and design loops identical in both scenarios)" : "MATERIAL_BUILDING_MAPPING_AMBIGUITY"}`);
}

line("H. SELECTED TECHNICAL ARCHITECTURE");
console.log(`  ${"Panel".padEnd(24)}${"Selected".padEnd(14)}${"Design".padStart(7)}${"Native".padStart(7)}${"Expand".padStart(7)}  confidence`);
for (const p of runA.panels) {
  const cap = p.selectedPn ? NAMES[p.selectedPn] : null;
  console.log(`  ${p.scope.id.padEnd(24)}${String(p.selectedPn ?? "NONE").padEnd(14)}${String(p.scope.drawnSlcLoops).padStart(7)}${String(cap?.slcLoopsInBuild ?? "?").padStart(7)}${String(p.expansion.additionalLoops ?? "?").padStart(7)}  ${p.sizing.status}${p.selectedPn ? "" : "   <- NOT SELECTABLE on current evidence"}`);
}
console.log(`  total 6815 loop expanders = ${runA.panels.reduce((t, p) => t + (p.expansion.loopCards ?? 0), 0)}`);
// Mounting capacity per enclosure is now FIRST-PARTY EVIDENCED (6815 Data Sheet,
// ACCESSORIES / FEATURES): IFP-2100 cabinet 2, RPS-1000 cabinet 2, 5815RMK 2,
// SK-NIC-KIT 1. The remote-kit QUANTITY is still not derived here, because the
// allocation rule belongs to the BOM allocator: it must consume those in-enclosure
// slots FIRST and only then compute remote 5815RMK demand.
{
  const cap = NAMES["IFP-2100HV"];
  const inCabinet = cap?.mountingCapacityInPanelCabinet ?? null;
  console.log(`  6815 mounting capacity, IFP-2100 cabinet : ${inCabinet ?? "not established"}`);
  console.log(`  5815RMK kits                          : NOT DERIVED IN THIS SLICE -- the allocator must consume in-enclosure slots before remote demand; 5815RMK holds two 6815 (6815 Data Sheet)`);
}

line("NETWORK");
console.log(`  panels on the campus network = ${PHYSICAL_PANEL_SCOPES.length}; governed IFP-2100HV network_panel_limit = ${NAMES["IFP-2100HV"]?.networkPanelLimit ?? "?"}`);
db.close();