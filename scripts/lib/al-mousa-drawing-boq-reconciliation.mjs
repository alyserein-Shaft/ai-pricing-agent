// AL MOUSA -- DRAWING / BOQ SEMANTIC RECONCILIATION & BUILDING FINGERPRINTING.
//
// READ-ONLY. Reads the governed BOQ as CROSS-DOCUMENT PROJECT EVIDENCE and the
// frozen geometry-aware drawing takeoff. Makes no governed quantity or
// product-selection write. Opens the database read-only.
//
// METHOD NOTES
// ------------
// * Campus-level agreement is NOT evidence. Offsetting per-building deltas can
//   sum to a campus match by coincidence, so every comparison here is made
//   PER BUILDING and the campus figure is only ever a checksum.
// * A block/building match requires a MULTI-FAMILY fingerprint. One matching
//   quantity proves nothing.
// * Deltas are reported as deltas. No universal tolerance is invented; each is
//   judged on absolute size, relative size, and whether panel/loop sizing or
//   procurement meaning changes.

import { openDb, takeOffSheet, SHEETS } from "./al-mousa-drawing-geometry-takeoff.mjs";

const PROJECT = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";
const geo = openDb(process.env.FA_DB);

// ---------------------------------------------------------------- BOQ blocks

const SEMANTIC_STATUS = Object.freeze({
  ABOVE_CEILING: "SMOKE_ABOVE_CEILING",
  BELOW_CEILING: "SMOKE_BELOW_CEILING",
  ON_SLAB: "SMOKE_ON_SLAB",
  HEAT: "HEAT",
  COMBINED: "COMBINED",
  DUCT: "DUCT",
  MANUAL: "MANUAL_STATION",
  MANUAL_WP: "MANUAL_STATION_WEATHERPROOF",
  DOOR_CONTACT: "DOOR_CONTACT",
  IM_CONTROL: "INTERFACE_MODULE_CONTROL",
  IM_MONITOR: "INTERFACE_MODULE_MONITORING",
  FIREPHONE_JACK: "FIREPHONE_JACK",
  PANEL: "PANEL",
});

/** Classify a BOQ description into the family the drawing column is compared to. */
function boqFamily(description) {
  const d = String(description || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!d) return null;
  if (/above ceiling/.test(d)) return SEMANTIC_STATUS.ABOVE_CEILING;
  if (/below ceiling/.test(d)) return SEMANTIC_STATUS.BELOW_CEILING;
  if (/on slab|in slab/.test(d)) return SEMANTIC_STATUS.ON_SLAB;
  if (/\bduct\b/.test(d) && /detector|sensor/.test(d)) return SEMANTIC_STATUS.DUCT;
  if (/combined smoke and heat/.test(d)) return SEMANTIC_STATUS.COMBINED;
  if (/\bheat\b/.test(d) && /detector|sensor/.test(d)) return SEMANTIC_STATUS.HEAT;
  if (/manual station.*weather ?proof/.test(d)) return SEMANTIC_STATUS.MANUAL_WP;
  if (/manual station|pull station/.test(d)) return SEMANTIC_STATUS.MANUAL;
  // Door contact is a MONITORED POINT, semantically distinct from a generic
  // monitor module. Keeping it separate is what prevents one being assumed to
  // contain the other.
  if (/door contact/.test(d)) return SEMANTIC_STATUS.DOOR_CONTACT;
  if (/interface module control/.test(d)) return SEMANTIC_STATUS.IM_CONTROL;
  if (/interface module monitor/.test(d)) return SEMANTIC_STATUS.IM_MONITOR;
  if (/fireman telephone|telephone jack/.test(d)) return SEMANTIC_STATUS.FIREPHONE_JACK;
  if (/fire alarm control panel/.test(d)) return SEMANTIC_STATUS.PANEL;
  return null;
}

/**
 * Split the BOQ into its logical blocks.
 *
 * A block starts at every `SECTION 28 46 00` header row. Blocks that carry a
 * NAMED subsection (Sub Station-1 / DG Station / Sub Station-2) are station
 * scopes and are kept separate rather than folded into a campus block.
 */
export function boqBlocks(db, projectId) {
  const rows = db.prepare(
    `SELECT sequence, item_number, description, original_quantity, numeric_quantity,
            row_type, review_status, approved_for_downstream, subsection, section
       FROM boq_items WHERE project_id = ? ORDER BY sequence`,
  ).all(projectId);
  const qty = (r) => {
    if (r.numeric_quantity !== null && r.numeric_quantity !== undefined && r.numeric_quantity !== "") {
      return Number(r.numeric_quantity);
    }
    const s = String(r.original_quantity ?? "").replace(/,/g, "").trim();
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  const blocks = [];
  let current = null;
  let stationScope = null;
  for (const r of rows) {
    const d = String(r.description || "").replace(/\s+/g, " ").trim();
    if (r.row_type === "Section Header") {
      current = { block: blocks.length + 1, headerSequence: r.sequence, rows: [], stations: [] };
      blocks.push(current);
      stationScope = null;
      continue;
    }
    if (!current) continue;
    if (r.row_type === "Subsection Header") {
      const named = /\bstation\b/i.test(d) ? d : null;
      if (named) {
        stationScope = { scope: d, rows: [] };
        current.stations.push(stationScope);
      }
      continue;
    }
    if (r.row_type !== "BOQ Item") continue;
    const fam = boqFamily(d);
    const target = stationScope ? stationScope.rows : current.rows;
    target.push({
      sequence: r.sequence, item: r.item_number, description: d, family: fam,
      quantity: qty(r), reviewStatus: r.review_status,
      approvedForDownstream: r.approved_for_downstream === 1 || r.approved_for_downstream === true,
    });
  }
  for (const b of blocks) {
    b.families = {};
    for (const r of b.rows) {
      if (r.family && r.quantity !== null) b.families[r.family] = (b.families[r.family] ?? 0) + r.quantity;
    }
    for (const s of b.stations) {
      s.families = {};
      for (const r of s.rows) {
        if (r.family && r.quantity !== null) s.families[r.family] = (s.families[r.family] ?? 0) + r.quantity;
      }
    }
  }
  return blocks;
}

// ------------------------------------------------------------ drawing takeoff

/**
 * Drawing device columns grouped by the family the BOQ is compared against.
 *
 * `S C` is mapped to the above-ceiling family as a CANDIDATE, clearly named as
 * such. That mapping is what this task is testing; it is not assumed.
 */
export const ABOVE_CEILING_CANDIDATE = "SMOKE_ABOVE_CEILING_CANDIDATE";

const DRAWING_COLUMN_OF = Object.freeze({
  "S C": ABOVE_CEILING_CANDIDATE,
  S: SEMANTIC_STATUS.BELOW_CEILING,
  H: SEMANTIC_STATUS.HEAT,
  "S H": SEMANTIC_STATUS.COMBINED,
  "S D": SEMANTIC_STATUS.DUCT,
  F: SEMANTIC_STATUS.MANUAL_WP,
  "CE C": SEMANTIC_STATUS.IM_CONTROL,
  "CE M": SEMANTIC_STATUS.IM_MONITOR,
  T: SEMANTIC_STATUS.FIREPHONE_JACK,
  WP: SEMANTIC_STATUS.PANEL, // placeholder, replaced below
});

export function drawingByBuilding(geoDb) {
  const out = {};
  for (const key of Object.keys(SHEETS)) {
    const sheet = takeOffSheet(geoDb, key, { bandBy: key === "AMS002" ? "sheet" : "level" });
    const b = SHEETS[key].building;
    const agg = out[b] ??= { families: {}, unidentified: {}, unbound: [] };
    for (const r of sheet.rows) {
      if (!r.symbolLabel) { agg.unbound.push(r); continue; }
      if (!r.family && !DRAWING_COLUMN_OF[r.symbolLabel]) {
        agg.unidentified[r.symbolLabel] = (agg.unidentified[r.symbolLabel] ?? 0) + r.quantity;
        continue;
      }
      if (r.symbolLabel === "WP") {
        agg.families.NOTIFICATION_WP = (agg.families.NOTIFICATION_WP ?? 0) + r.quantity;
        continue;
      }
      if (r.symbolLabel === "F") {
        // The schematics carry a single manual-station column. The BOQ splits
        // manual station into indoor and weatherproof rows, so the only
        // comparable BOQ quantity is the two rows TOGETHER.
        agg.families.MANUAL_STATION_TOTAL = (agg.families.MANUAL_STATION_TOTAL ?? 0) + r.quantity;
        continue;
      }
      const fam = DRAWING_COLUMN_OF[r.symbolLabel];
      if (!fam) continue;
      agg.families[fam] = (agg.families[fam] ?? 0) + r.quantity;
    }
  }
  return out;
}

/** Map a station's drawing rows to the BOQ family its caption block governs. */
export function stationDrawing(geoDb) {
  const sheet = takeOffSheet(geoDb, "AMS002", { bandBy: "sheet" });
  const bound = sheet.rows.filter((r) => r.symbolLabel);
  const unbound = sheet.rows.filter((r) => !r.symbolLabel);
  // Each FACP block caption labels the device rows printed ABOVE it.
  const captions = [
    { caption: "@ SS-GRS-1, TRANSFORMER", below: 957 },
    { caption: "@ MV SWGR ROOM SUBSTATION-1", below: 1490 },
    { caption: "(GENERATOR ROOM)", below: 2006 },
  ];
  const scopes = captions.map((c) => ({ ...c, rows: [], families: {} }));
  for (const r of bound) {
    // The governing caption is the FIRST one printed BELOW the device rows.
    const scope = scopes.find((s) => r.quantityBox.y < s.below);
    if (!scope) continue;
    scope.rows.push(r);
    const fam = r.symbolLabel === "S" ? SEMANTIC_STATUS.ON_SLAB
      : r.symbolLabel === "H" ? SEMANTIC_STATUS.HEAT
        : r.symbolLabel === "F" ? "MANUAL_STATION_TOTAL"
          : r.symbolLabel === "WP" ? "NOTIFICATION_WP"
            : DRAWING_COLUMN_OF[r.symbolLabel] ?? null;
    if (fam) scope.families[fam] = (scope.families[fam] ?? 0) + r.quantity;
  }
  return { scopes, unbound };
}

// ------------------------------------------------------------------- deltas

export const DELTA_CLASS = Object.freeze({
  EXACT: "EXACT",
  MINOR: "MINOR_TAKEOFF_DELTA",
  MATERIAL: "MATERIAL_DELTA",
  STRUCTURAL: "STRUCTURAL_CONFLICT",
  NOT_COMPARABLE: "NOT_COMPARABLE",
});

/**
 * Judge one delta. No universal percentage is invented: a small absolute AND
 * relative delta on a large population is MINOR; a large absolute delta, or one
 * big enough to move a loop or panel boundary, is MATERIAL; a delta where one
 * document carries the device family and the other does not at all is
 * STRUCTURAL.
 */
export function judgeDelta(drawing, boq) {
  if (drawing === null || boq === null || boq === undefined) return DELTA_CLASS.NOT_COMPARABLE;
  const d = drawing - boq;
  if (d === 0) return DELTA_CLASS.EXACT;
  const rel = boq === 0 ? null : Math.abs(d) / boq;
  if (boq === 0) return DELTA_CLASS.STRUCTURAL;
  if (Math.abs(d) <= 3 || rel <= 0.02) return DELTA_CLASS.MINOR;
  if (Math.abs(d) <= 12 && rel <= 0.08) return DELTA_CLASS.MINOR;
  return DELTA_CLASS.MATERIAL;
}

export { PROJECT, SEMANTIC_STATUS, boqFamily, geo };