// AL MOUSA -- PER-PANEL SLC ADDRESS BUDGET, then Farenhyt panel right-sizing.
//
// READ-ONLY with respect to project data. This module opens the database
// read-only and performs NO governed quantity or product-selection write. It
// selects a TECHNICAL BASIS only; product identity, commercial selection, NAC /
// RPS sizing, BOM pricing and quotation are all out of scope here.
//
// DIVISION OF LABOUR (deliberate, so no parallel capacity logic exists)
// -------------------------------------------------------------------
// This module OWNS: the physical panel inventory, the per-panel ADDRESS POOLS,
// the drawing-vs-BOQ reconciliation of each pool, the unresolved pools, the
// scenario and sensitivity runs, and the minimum-loop arithmetic.
//
// This module DELEGATES to the already-governed implementations:
//   * demand figures      -> al-mousa-drawing-geometry-takeoff.mjs (drawing)
//                            al-mousa-drawing-boq-reconciliation.mjs (BOQ)
//   * panel admissibility -> farenhyt-panel-capability.mjs (loopAdmissibility)
//   * right-sizing        -> al-mousa-per-building-panel-reconstruction.mjs
//                            (rightSizePanel, expansionForPanel)
//   * manufacturer values -> product_attributes via loadPanelCapability
// There is deliberately NO second copy of per-loop capacity, no second panel
// ranking, and no hard-coded capability number in this file.
//
// THE POOLS
// ---------
// Detector addresses and module addresses have SEPARATE per-loop ceilings, so
// they are never summed into one "points" figure before the ceilings are met.
//
//   DOOR-CONTACT HANDLING. A door contact is one monitored point, so it is one
//   module-address demand for sizing. But the BOQ's generic Monitor Module row is
//   NOT assumed to include door contacts, so the two demands are carried as
//   SEPARATE source lines and are never netted. Whether one physical monitor
//   module serves one or several door contacts is a product-architecture
//   question that this slice deliberately does NOT answer.
//
//   MANUAL STATIONS. Addressable manual stations consume an SLC address, so they
//   are MODULE_POOL_ADDRESS_DEMAND. Device quantity and address-pool
//   classification stay distinct.

import {
  PROJECT, SEMANTIC_STATUS, boqBlocks, drawingByBuilding, stationDrawing, geo,
  ABOVE_CEILING_CANDIDATE,
} from "./al-mousa-drawing-boq-reconciliation.mjs";
import { DatabaseSync } from "node:sqlite";

export const POOL = Object.freeze({
  DETECTOR: "DETECTOR_POOL",
  MODULE: "MODULE_POOL",
  UNRESOLVED: "UNRESOLVED_SLC_POOL",
  NON_SLC: "NON_SLC_EXCLUDED",
});

export const AUTHORITY = Object.freeze({
  DRAWING: "DRAWING_DERIVED",
  BOQ: "BOQ_DERIVED",
  HUMAN: "HUMAN_ENGINEERING_DECISION",
  RECONCILED: "DRAWING_BOQ_RECONCILED_CONSERVATIVE_MAX",
});

export const CLASSIFICATION = Object.freeze({
  MINIMUM_MATCHES: "MATCHES_MINIMUM",
  DRAWING_RESERVE: "DRAWING_HAS_ENGINEERING_RESERVE",
  DRAWING_BELOW: "DRAWING_BELOW_REQUIRED_CAPACITY",
  UNRESOLVED: "UNRESOLVED",
});

/**
 * THE SEVEN PHYSICAL PANEL SCOPES, each with its own DRAWN loop count.
 *
 * Every loop count below was re-verified against the persisted positional
 * drawing assets (`drawing_assets` text runs carrying real 2-D bounding boxes),
 * not taken on assertion, and each carries the panel-block token the loops were
 * found under.
 *
 * Two identity points that must not be glossed over:
 *
 * 1. The KGS-005 sheet carries SIX SLC loops, but the ONLY panel token on that
 *    sheet is "MAIN FIRE ALARM CONTROL PANEL (M.F.A.C.P)". There is no FACP token
 *    on it. Those six loops therefore belong to the CAMPUS MFACP in the KGS fire
 *    command room -- which is exactly what the BOQ says, since the one panel row
 *    whose own wording is "Main Fire alarm control panel" sits in block 1 (the
 *    KGS block). Presenting "KGS" as a seventh peer building FACP would be wrong.
 *
 * 2. AMS-002 draws THREE separate two-loop FACP blocks. Only one of them is
 *    NAMED on the schematic ("@ MV SWGR ROOM SUBSTATION-1"). The other two are
 *    "@ SS-GRS-1, TRANSFORMER" and "@ EMERGENCY ROOM (GENERATOR ROOM)". The
 *    loop COUNT of two is explicit for all three drawn blocks; what is not drawn
 *    is which BOQ station name belongs to the two unnamed blocks. That pairing
 *    comes from the quantity fingerprint (see stationScopeFor), which is an
 *    explicit inference and is labelled as such.
 */
export const PHYSICAL_PANEL_SCOPES = Object.freeze([
  Object.freeze({
    id: "PANEL-MFACP-CAMPUS",
    // These are FOUR SEPARATE DIMENSIONS and must never be collapsed into one
    // "building" field. The MFACP is the campus NETWORK MASTER; it is NOT a
    // campus field-device aggregator.
    panelRole: "CAMPUS_NETWORK_MASTER",
    physicalLocation: "KGS (fire command room)",
    localServedScope: "KGS",
    networkScope: "CAMPUS",
    sheet: "2401232-PC-KGS-DR-T-93-ZZZ-005", panelBlockToken: "MAIN FIRE ALARM CONTROL PANEL (M.F.A.C.P)",
    drawnSlcLoops: 6, drawnLoopsClass: "DRAWING_EXPLICIT",
    drawnLoopTokens: ["LOOP-1", "LOOP-2", "LOOP-3", "LOOP-4", "LOOP-5", "LOOP-6"],
    boqBlock: 1, boqStation: null, mapping: "BOQ_BLOCK_1__PROVEN",
    mappingClass: "BUILDING_MAPPING_PROVEN",
    // Its SLC arithmetic uses ONLY the field-device demand served by its OWN
    // local loops (block 1 = KGS). Networked remote panels do not consume its
    // local detector/module address capacity merely because it supervises them.
    localDemandRule: "LOCAL_LOOPS_ONLY__REMOTE_PANELS_DO_NOT_CONSUME_LOCAL_SLC_CAPACITY",
  }),
  Object.freeze({
    id: "PANEL-BOYS", panelRole: "FACP", physicalLocation: "BOYS", localServedScope: "BOYS", networkScope: "CAMPUS", building: "BOYS",
    localDemandRule: "LOCAL_LOOPS_ONLY",
    sheet: "2401232-PC-BOS-DR-T-93-ZZZ-005", panelBlockToken: "FIRE ALARM CONTROL PANEL (F.A.C.P)",
    drawnSlcLoops: 6, drawnLoopsClass: "DRAWING_EXPLICIT",
    drawnLoopTokens: ["LOOP-1", "LOOP-2", "LOOP-3", "LOOP-4", "LOOP-5", "LOOP-6"],
    boqBlock: "AMBIGUOUS_2_OR_3", boqStation: null, mapping: "BOQ_BLOCK_2_OR_3__ORDER_AMBIGUOUS",
    mappingClass: "BUILDING_MAPPING_AMBIGUOUS",
  }),
  Object.freeze({
    id: "PANEL-GIRLS", panelRole: "FACP", physicalLocation: "GIRLS", localServedScope: "GIRLS", networkScope: "CAMPUS", building: "GIRLS",
    localDemandRule: "LOCAL_LOOPS_ONLY",
    sheet: "2401232-PC-GRS-DR-T-93-ZZZ-005", panelBlockToken: "FIRE ALARM CONTROL PANEL (F.A.C.P)",
    drawnSlcLoops: 6, drawnLoopsClass: "DRAWING_EXPLICIT",
    drawnLoopTokens: ["LOOP-1", "LOOP-2", "LOOP-3", "LOOP-4", "LOOP-5", "LOOP-6"],
    boqBlock: "AMBIGUOUS_2_OR_3", boqStation: null, mapping: "BOQ_BLOCK_2_OR_3__ORDER_AMBIGUOUS",
    mappingClass: "BUILDING_MAPPING_AMBIGUOUS",
  }),
  Object.freeze({
    id: "PANEL-WELCOME-CENTER", panelRole: "FACP", physicalLocation: "WELCOME CENTER", localServedScope: "WELCOME CENTER", networkScope: "CAMPUS", building: "WELCOME CENTER",
    localDemandRule: "LOCAL_LOOPS_ONLY",
    sheet: "2401232-PC-WLC-DR-T-93-ZZZ-005", panelBlockToken: "FIRE ALARM CONTROL PANEL (F.A.C.P)",
    drawnSlcLoops: 4, drawnLoopsClass: "DRAWING_EXPLICIT",
    drawnLoopTokens: ["LOOP-1", "LOOP-2", "LOOP-3", "LOOP-4"],
    boqBlock: 4, boqStation: null, mapping: "BOQ_BLOCK_4__PROVEN",
    mappingClass: "BUILDING_MAPPING_PROVEN",
  }),
  Object.freeze({
    id: "PANEL-SUB-STATION-1", panelRole: "FACP", physicalLocation: "SUB STATION-1", localServedScope: "SUB STATION-1", networkScope: "CAMPUS", building: "SUB STATION-1",
    localDemandRule: "LOCAL_LOOPS_ONLY",
    sheet: "2401232-PC-AMS-DR-T-93-ZZZ-002", panelBlockToken: "FIRE ALARM CONTROL PANEL (F.A.C.P) @ MV SWGR ROOM SUBSTATION-1",
    drawnSlcLoops: 2, drawnLoopsClass: "DRAWING_EXPLICIT",
    drawnLoopTokens: ["LOOP-1", "LOOP-2"],
    boqBlock: null, boqStation: "Sub Station-1 (Near BOS building)", mapping: "BOQ_STATION__NAME_AND_QUANTITY_MATCH",
    mappingClass: "BUILDING_MAPPING_PROVEN",
  }),
  Object.freeze({
    id: "PANEL-SUB-STATION-2", panelRole: "FACP", physicalLocation: "SUB STATION-2", localServedScope: "SUB STATION-2", networkScope: "CAMPUS", building: "SUB STATION-2",
    localDemandRule: "LOCAL_LOOPS_ONLY",
    sheet: "2401232-PC-AMS-DR-T-93-ZZZ-002", panelBlockToken: "FIRE ALARM CONTROL PANEL (F.A.C.P) @ SS-GRS-1, TRANSFORMER",
    drawnSlcLoops: 2, drawnLoopsClass: "DRAWING_EXPLICIT",
    drawnLoopTokens: ["LOOP-1", "LOOP-2"],
    boqBlock: null, boqStation: "Sub Station-2 (Near KGL building)", mapping: "BOQ_STATION__QUANTITY_MATCH_NAME_DISCREPANCY",
    mappingClass: "BUILDING_MAPPING_PROVEN__NAME_DISCREPANCY",
  }),
  Object.freeze({
    id: "PANEL-DG-STATION", panelRole: "FACP", physicalLocation: "DG STATION", localServedScope: "DG STATION", networkScope: "CAMPUS", building: "DG STATION",
    localDemandRule: "LOCAL_LOOPS_ONLY",
    sheet: "2401232-PC-AMS-DR-T-93-ZZZ-002", panelBlockToken: "FIRE ALARM CONTROL PANEL (F.A.C.P) @ EMERGENCY ROOM (GENERATOR ROOM)",
    drawnSlcLoops: 2, drawnLoopsClass: "DRAWING_EXPLICIT",
    drawnLoopTokens: ["LOOP-1", "LOOP-2"],
    boqBlock: null, boqStation: "DG Station (Near GRS building)", mapping: "BOQ_STATION__NAME_AND_QUANTITY_MATCH",
    mappingClass: "BUILDING_MAPPING_PROVEN",
  }),
]);

/**
 * Explicitly NON-SLC. Listed so their exclusion is auditable rather than silent.
 * A passive telephone jack stays here because no project or manufacturer
 * evidence in this slice establishes an SLC address relationship for it.
 */
export const NON_SLC_EXCLUSIONS = Object.freeze([
  "conventional NAC strobes",
  "conventional horn/strobes",
  "RPS power supplies",
  "detector bases",
  "duct housings",
  "sampling tubes",
  "remote indicators",
  "batteries",
  "cabinets",
  "workstation / printer",
  "passive telephone jacks",
  "network hardware",
]);

/** Conservative reconciliation of a drawing figure against a BOQ figure. */
export function reconcileDemand(drawingQty, boqQty) {
  const hasD = Number.isFinite(drawingQty);
  const hasB = Number.isFinite(boqQty);
  if (!hasD && !hasB) return { value: null, basis: "NOT_EVIDENCED", authority: null, drawing: null, boq: null };
  if (!hasB) return { value: drawingQty, basis: "DRAWING_ONLY", authority: AUTHORITY.DRAWING, drawing: drawingQty, boq: null };
  if (!hasD) return { value: boqQty, basis: "BOQ_ONLY", authority: AUTHORITY.BOQ, drawing: null, boq: boqQty };
  if (drawingQty === boqQty) return { value: drawingQty, basis: "EXACT_AGREEMENT", authority: AUTHORITY.RECONCILED, drawing: drawingQty, boq: boqQty };
  // Pre-sales sizing rule, stated rather than implied: take the HIGHER of the
  // two. Choosing the lower figure silently is how an under-sized system ships.
  return {
    value: Math.max(drawingQty, boqQty),
    basis: "CONSERVATIVE_MAX_OF_DISAGREEMENT",
    authority: AUTHORITY.RECONCILED,
    drawing: drawingQty, boq: boqQty,
    note: `drawing and BOQ disagree (${drawingQty} vs ${boqQty}); sizing uses the higher, and both are retained`,
  };
}

const num = (v) => (Number.isFinite(v) ? v : null);

/**
 * Build the address ledger for one panel.
 *
 * `sources` supplies the drawing and BOQ figures already computed by the
 * upstream modules; this function only reconciles and pools them.
 */
export function buildPanelLedger(scope, sources) {
  const d = sources.drawing ?? {};
  const b = sources.boq ?? {};

  const det = [];
  const push = (list, label, drawingQty, boqQty, extra = {}) => {
    const r = reconcileDemand(drawingQty, boqQty);
    list.push({
      demand: label, qty: r.value, pool: POOL.DETECTOR,
      drawing: r.drawing, boq: r.boq, basis: r.basis, authority: r.authority ?? extra.authority ?? null, ...extra,
    });
  };

  // ---- A. DETECTOR POOL
  push(det, "Smoke Detector Below Ceiling", num(d.belowCeiling), num(b[SEMANTIC_STATUS.BELOW_CEILING]), { drawingLabel: "S", boqLabel: "Smoke detectors (below ceiling)" });
  push(det, "Smoke Detector Above Ceiling (S C)", num(d.aboveCeiling), num(b[SEMANTIC_STATUS.ABOVE_CEILING]), {
    drawingLabel: "S C", boqLabel: "Smoke detectors (above ceiling)", authority: AUTHORITY.HUMAN,
    identityAuthority: AUTHORITY.HUMAN,
    note: "S C = smoke detector above ceiling / ceiling void smoke detector is a HUMAN-CONFIRMED project interpretation; the T-00 legend does not spell it out and the original legend is NOT rewritten",
  });
  push(det, "Heat Detector", num(d.heat), num(b[SEMANTIC_STATUS.HEAT]), { drawingLabel: "H", boqLabel: "Heat detector" });
  push(det, "Smoke + Heat Combined Detector", num(d.combined), num(b[SEMANTIC_STATUS.COMBINED]), { drawingLabel: "S H", boqLabel: "Combined smoke and heat detector" });
  push(det, "Duct Detector (detector head)", num(d.duct), num(b[SEMANTIC_STATUS.DUCT]), { drawingLabel: "S D", boqLabel: "Duct detector" });
  if (Number.isFinite(num(d.onSlab))) {
    det.push({ demand: "Smoke Detector on Slab", qty: d.onSlab, pool: POOL.DETECTOR, drawing: d.onSlab, boq: b[SEMANTIC_STATUS.ON_SLAB] ?? null, basis: "DRAWING_ONLY", authority: AUTHORITY.DRAWING, drawingLabel: "S", boqLabel: "Smoke detectors on slab" });
  }

  // ---- B. MODULE POOL
  const mod = [];
  const modBoqManual = (Number.isFinite(b[SEMANTIC_STATUS.MANUAL]) ? b[SEMANTIC_STATUS.MANUAL] : 0)
    + (Number.isFinite(b[SEMANTIC_STATUS.MANUAL_WP]) ? b[SEMANTIC_STATUS.MANUAL_WP] : 0);
  const modDrawingManual = num(d.manualStationTotal);
  {
    const r = reconcileDemand(modDrawingManual, Number.isFinite(b[SEMANTIC_STATUS.MANUAL]) || Number.isFinite(b[SEMANTIC_STATUS.MANUAL_WP]) ? modBoqManual : null);
    mod.push({
      demand: "Addressable Manual Stations", qty: r.value, pool: POOL.MODULE,
      drawing: r.drawing, boq: r.boq, basis: r.basis, authority: r.authority,
      classification: "MODULE_POOL_ADDRESS_DEMAND",
      note: "the schematics carry ONE manual-station column while the BOQ splits manual station into indoor and weatherproof rows, so the comparable BOQ quantity is those two rows TOGETHER; addressable manual stations consume an SLC address",
    });
  }
  {
    const r = reconcileDemand(num(d.imControl), num(b[SEMANTIC_STATUS.IM_CONTROL]));
    mod.push({ demand: "Control Modules", qty: r.value, pool: POOL.MODULE, drawing: r.drawing, boq: r.boq, basis: r.basis, authority: r.authority, drawingLabel: "CE C", boqLabel: "Interface module control" });
  }
  // Generic monitor modules and door-contact monitored points stay SEPARATE.
  {
    const r = reconcileDemand(num(d.imMonitor), num(b[SEMANTIC_STATUS.IM_MONITOR]));
    mod.push({
      demand: "GENERIC_MONITOR_MODULE_DEMAND", qty: r.value, pool: POOL.MODULE,
      drawing: r.drawing, boq: r.boq, basis: r.basis, authority: r.authority,
      drawingLabel: "CE M", boqLabel: "Interface module monitor",
      note: "the BOQ generic Monitor Module quantity is NOT assumed to include door contacts",
    });
  }
  const doorContacts = num(b.DOOR_CONTACT);
  mod.push({
    demand: "DOOR_CONTACT_MONITORED_POINT_DEMAND", qty: doorContacts, pool: POOL.MODULE,
    drawing: null, boq: doorContacts, basis: doorContacts === null ? "NOT_EVIDENCED" : "BOQ_ONLY",
    authority: doorContacts === null ? null : AUTHORITY.BOQ, boqLabel: "Door contact",
    note: "1 door contact = 1 module-address demand for sizing. Kept as its OWN demand line, never netted against the generic monitor module row. The drawings expose NO door-contact device column, so this is BOQ-only. Whether one physical monitor module serves one or several door contacts is a product-architecture decision NOT taken here.",
  });

  // ---- C. UNRESOLVED SLC POOL
  const unresolved = [];
  const shc = num(d["S HC"]);
  unresolved.push({
    demand: "S HC (project notation)", qty: shc, pool: POOL.UNRESOLVED,
    identity: "PROJECT_NOTATION_UNRESOLVED", deviceClass: "SLC_FIELD_DEVICE_PROVEN__DETECTOR_OR_MODULE_NOT_PROVEN",
    note: "proven to be an SLC loop field device; detector-vs-module address class NOT proven, so it is run as a bounded sensitivity in both directions and excluded from both pools",
  });
  unresolved.push({
    demand: "FIREPHONE_SLC_MODULE_DEMAND", qty: num(b[SEMANTIC_STATUS.FIREPHONE_JACK]),
    pool: POOL.UNRESOLVED, identity: "TOPOLOGY_UNRESOLVED",
    note: "passive firephone jack quantity is recorded, but telephone jack count is NOT inferred to equal monitor modules or telephone control modules; circuit/module topology remains unresolved and is assessed for materiality instead of invented",
  });

  // ---- D. NON-SLC
  const nonSlc = [
    { demand: "Loop powered strobes (conventional NAC)", qty: num(b.NOTIFICATION_STROBE) },
    { demand: "Loop powered strobes with sounder", qty: num(b.NOTIFICATION_STROBE_SOUNDER) },
    { demand: "Loop powered strobes with sounder (weatherproof)", qty: num(b.NOTIFICATION_STROBE_SOUNDER_WP) },
    { demand: "Passive firephone telephone jacks", qty: num(b[SEMANTIC_STATUS.FIREPHONE_JACK]) },
  ].filter((x) => x.qty !== null);

  const detectorTotal = det.reduce((t, r) => t + (r.qty ?? 0), 0);
  const moduleTotal = mod.reduce((t, r) => t + (r.qty ?? 0), 0);
  return { scope, det, mod, unresolved, nonSlc, detectorTotal, moduleTotal };
}

/**
 * Minimum loops. The detector and module ceilings are separate, so the panel
 * needs enough loops to satisfy BOTH, and enough total capacity for both.
 */
export function minimumLoops({ detectorAddresses, moduleAddresses, unresolvedAsDetectors = 0, unresolvedAsModules = 0, capability }) {
  const det = detectorAddresses + unresolvedAsDetectors;
  const mod = moduleAddresses + unresolvedAsModules;
  const detPerLoop = capability?.detectorsPerLoop;
  const modPerLoop = capability?.modulesPerLoop;
  const detMin = Number.isInteger(detPerLoop) && det > 0 ? Math.ceil(det / detPerLoop) : null;
  const modMin = Number.isInteger(modPerLoop) && mod > 0 ? Math.ceil(mod / modPerLoop) : null;
  const systemCapacity = capability?.panelPointCapacityIdpSk;
  const systemMin = Number.isInteger(systemCapacity) && (det + mod) > 0 ? Math.ceil((det + mod) / systemCapacity) : null;
  const feasible = [detMin, modMin, systemMin].filter(Number.isInteger);
  return {
    detectorAddresses: det, moduleAddresses: mod,
    detectorsPerLoop: num(detPerLoop), modulesPerLoop: num(modPerLoop), systemCapacity: num(systemCapacity),
    detectorLoopMinimum: detMin, moduleLoopMinimum: modMin, systemLoopMinimum: systemMin,
    calculatedMinimumLoops: feasible.length ? Math.max(...feasible) : null,
    DETECTOR_CAPACITY_OK: detMin === null ? null : det <= detPerLoop * detMin,
    MODULE_CAPACITY_OK: modMin === null ? null : mod <= modPerLoop * modMin,
    SYSTEM_CAPACITY_OK: systemMin === null ? null : (det + mod) <= systemCapacity * systemMin,
    note: "detector and module ceilings are per loop and independent; an aggregate 'points / combined capacity' division is never used as the sizing formula",
  };
}

export { PROJECT, geo, DatabaseSync, boqBlocks, drawingByBuilding, stationDrawing, ABOVE_CEILING_CANDIDATE, SEMANTIC_STATUS };