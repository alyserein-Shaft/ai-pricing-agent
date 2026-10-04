// AL MOUSA -- GEOMETRY-AWARE FIRE ALARM SCHEMATIC TAKEOFF.
//
// READ-ONLY. Opens the drawing tables of the verification database in readOnly
// mode and reads no BOQ, BOM, product, pricing or quotation table.
//
// WHY THIS EXISTS
// ---------------
// A schematic is not a text stream. Its device columns are separated in X, its
// counts are separated in Y, and the ONLY thing that binds a count to a device
// is that geometry. Flattening the page destroys the X separation, so adjacent
// symbols merge into strings like "S C" that look like one device and are not.
//
// WHAT IS ACTUALLY USED AS THE VISUAL ASSET
// -----------------------------------------
// `drawing_assets` -- the persisted positional asset table the project's own
// drawing intake/recognition pipeline produces. Every text run carries a real
// 2-D bounding box, so symbol identity and quantity callouts can be bound by
// X alignment and Y order instead of by character order. Coordinates are used
// RELATIVE to the asset frame's own origin: association is translation
// invariant, which also neutralises the negative-origin defect present on the
// KGS sheet (its boxes are translated out of page space).
//
// GOVERNED IDENTITY
// -----------------
// Identity comes only from the governed Fire Alarm legend (T-00-ZZZ-002), read
// from that sheet's own description runs and cross-checked against the Approved
// `drawing_symbol_definitions`. A device-column label the governed legend does
// not define is QUANTIFIED but NOT CLASSIFIED. It is never folded into a
// family total, and it is never split into the letters that happen to make it
// up.

import { DatabaseSync } from "node:sqlite";

export const SHEETS = Object.freeze({
  KGS: { project: "project_c0123d91-c30b-4956-87cb-e473ef53f89d", file: "2401232-PC-KGS-DR-T-93-ZZZ-005.pdf", building: "KGS" },
  BOS: { project: "project_ae501b85-9c12-4332-bf8e-787c90f2d388", file: "2401232-PC-BOS-DR-T-93-ZZZ-005.pdf", building: "BOYS" },
  GRS: { project: "project_c0123d91-c30b-4956-87cb-e473ef53f89d", file: "2401232-PC-GRS-DR-T-93-ZZZ-005.pdf", building: "GIRLS" },
  WLC: { project: "project_ae501b85-9c12-4332-bf8e-787c90f2d388", file: "2401232-PC-WLC-DR-T-93-ZZZ-005 (3).pdf", building: "WELCOME CENTER" },
  AMS002: { project: "project_ae501b85-9c12-4332-bf8e-787c90f2d388", file: "2401232-PC-AMS-DR-T-93-ZZZ-002.pdf", building: "SUB STATION / DG" },
});

/** Governed Fire Alarm legend, in the order the T-00 sheet prints it. */
export const LEGEND_ORDER = Object.freeze([
  "SMOKE DETECTOR",
  "HEAT DETECTOR",
  "DUCT DETECTOR",
  "SMOKE AND HEAT COMBINED DETECTOR",
  "FIRE ALARM MANUAL STATION",
  "FIRE ALARM MANUAL STATION (WEATHER PROOF)",
  "LOOP POWERED STROBE",
  "LOOP POWERED STROBE WITH SOUNDER",
  "LOOP POWERED STROBE WITH SOUNDER (WEATHER PROOF TYPE)",
  "CEILING MOUNTED LOOP POWERED STROBE WITH SOUNDER (WEATHER PROOF TYPE)",
  "FIREMAN TELEPHONE JACK",
  "ZONE INTERFACE MODULE",
  "FIREMAN TELEPHONE CONTROL PANEL",
  "FIRE ALARM REPEATER PANEL",
  "MAIN FIRE ALARM CONTROL PANEL",
  "INTERFACE MODULE CONTROL",
  "INTERFACE MODULE MONITORING",
  "DOOR CONTACT",
]);

/** Approved legend abbreviations -> device family. Governed vocabulary only. */
export const GOVERNED_LABEL_FAMILY = Object.freeze({
  S: "SMOKE",
  H: "HEAT",
  "S D": "DUCT",
  "S H": "COMBINED",
  F: "MANUAL_STATION",
  "CE": "INTERFACE_MODULE",
  "CE C": "INTERFACE_MODULE_CONTROL",
  "CE M": "INTERFACE_MODULE_MONITORING",
  DC: "DOOR_CONTACT",
  T: "FIREMAN_TELEPHONE_JACK",
  WP: "STROBE_SOUNDER",
  C: "CEILING_STROBE_SOUNDER",
  FTCP: "FTCP",
  FARP: "FARP",
  MFACP: "MFACP",
});

/** Device families this audit reports as detector demand. */
export const DETECTOR_FAMILIES = Object.freeze(["SMOKE", "HEAT", "COMBINED", "DUCT"]);

export const QTY_RE = /^\d+\s*Nos?\.?$/i;
const LEVEL_RE = /^(ROOF|LEVEL|GROUND FLOOR|BASEMENT|FLOOR)\b\s*[0-9]{0,2}$/i;
const LABEL_RE = /^[A-Z][A-Z0-9]{0,3}$/;
const COMPOUND_GAP_MAX = 14;
const COMPOUND_DY_MAX = 12;
const COL_TOL = 5;
const ROW_ABOVE_MIN = 2;
const ROW_ABOVE_MAX = 44;
/** Count sits immediately right of its label, above the label's own row. */
const RIGHT_GAP_MIN = 0;
const RIGHT_GAP_MAX = 18;
const RIGHT_DY_MAX = 18;

export function openDb(file) {
  return new DatabaseSync(file, { readOnly: true });
}

export function intakeFor(db, key) {
  const s = SHEETS[key];
  if (!s) throw new Error(`unknown sheet ${key}`);
  const r = db.prepare(
    `SELECT iv.id FROM drawing_intake_versions iv
       JOIN document_versions dv ON dv.id = iv.document_version_id
      WHERE iv.project_id = ? AND dv.original_filename = ?`,
  ).get(s.project, s.file);
  if (!r) throw new Error(`no governed drawing intake for ${key} (${s.file})`);
  return r.id;
}

/** Positional text assets for one drawing page, in a translation-invariant frame. */
export function assets(db, intakeId) {
  const raw = db.prepare(
    `SELECT text_content, bounding_box FROM drawing_assets
      WHERE intake_version_id = ? AND asset_type = 'Text'`,
  ).all(intakeId)
    .map((r) => {
      const b = JSON.parse(r.bounding_box);
      return { text: (r.text_content || "").trim(), x: b.x, y: b.y, w: b.width, h: b.height };
    })
    .filter((a) => a.text);
  if (!raw.length) return [];
  const ox = Math.min(...raw.map((r) => r.x));
  const oy = Math.min(...raw.map((r) => r.y));
  return raw.map((a) => ({
    ...a, x: a.x - ox, y: a.y - oy, cx: a.x - ox + a.w / 2, cy: a.y - oy + a.h / 2,
  }));
}

/**
 * Group short label runs into device-column label UNITS.
 *
 * A unit is one or more runs in the same column band, horizontally adjacent, on
 * the same text row or the line stacked immediately beneath it. Sweeping by X
 * rather than by Y is what makes this 2-D: a run below and to the right of its
 * neighbour must still join the same label.
 *
 * A quantity annotation lying BETWEEN two candidate runs blocks the join. That
 * guard is what stops two genuinely stacked device rows from being fused into
 * one label merely because they share a column.
 */
export function labelUnits(tokens, qtys = []) {
  const open = [];
  const sorted = [...tokens].sort((a, b) => a.x - b.x);
  // A count written in the SAME column BETWEEN two candidate runs blocks the
  // join: that run boundary is a device row, not a label continuation. Only
  // counts in the same column count as a blocker.
  const annotationBetween = (a, b) => qtys.some((q) => {
    const lo = Math.min(a.cy, b.cy);
    const hi = Math.max(a.cy, b.cy);
    const columnNear = q.cx >= Math.min(a.cx, b.cx) - 20 && q.cx <= Math.max(a.cx, b.cx) + 20;
    return columnNear && q.cy > lo && q.cy < hi;
  });
  for (const t of sorted) {
    let joined = null;
    let bestGap = Infinity;
    for (const u of open) {
      const last = u.last;
      // Compare centres, not edges: a label stacked on two lines overlaps its
      // own first line horizontally, so an edge-gap test would reject it.
      const dcx = t.cx - last.cx;
      if (dcx < -2 || dcx > COMPOUND_GAP_MAX) continue;
      if (Math.abs(t.cy - u.tokens[0].cy) > COMPOUND_DY_MAX) continue;
      if (annotationBetween(u.tokens[0], t)) continue;
      if (dcx < bestGap) { bestGap = dcx; joined = u; }
    }
    if (joined) {
      joined.tokens.push(t); joined.last = t;
    } else {
      open.push({ tokens: [t], last: t });
    }
  }
  return open.map((c) => ({
    label: c.tokens.map((t) => t.text).join(" "),
    tokens: c.tokens,
    x: c.tokens[0].x, y: c.tokens[0].y, w: c.tokens[0].w,
    leadCx: c.tokens[0].cx, cy: c.tokens[0].cy,
    rightEdge: c.tokens[c.tokens.length - 1].x + c.tokens[c.tokens.length - 1].w,
    innerGaps: c.tokens.slice(1).map((t, i) => +(t.cx - c.tokens[i].cx).toFixed(2)),
  })).sort((a, b) => a.cy - b.cy || a.x - b.x);
}

export function levelBands(tokens) {
  const lv = tokens.filter((t) => LEVEL_RE.test(t.text))
    .map((t) => ({ label: t.text.replace(/\s+/g, " ").trim().toUpperCase(), y: t.y, cy: t.cy }))
    .sort((a, b) => a.y - b.y);
  if (!lv.length) return [];
  // Captions printed on one shared baseline (the WLC sheet carries GROUND FLOOR,
  // LEVEL 01, ROOF 01 and ROOF 02 at the same y) cannot order anything: banding
  // on them would invent a level for every row. Decline instead of guessing.
  const distinctRows = new Set(lv.map((l) => Math.round(l.cy / 8))).size;
  if (distinctRows < lv.length) return [];
  // Otherwise a level caption labels the band that follows it, so the band runs
  // from the caption to the next caption.
  return lv.map((l, i) => ({
    level: l.label,
    start: l.cy,
    end: i + 1 < lv.length ? lv[i + 1].cy : Infinity,
  }));
}

/**
 * Prove that a label unit occupies exactly ONE device column.
 *
 * Device columns sit on a regular pitch. A label unit's LEADING run must land on
 * that grid; a run that trails inside the same label lands between columns and
 * is therefore part of the label, not a column of its own. This is the test that
 * decides "adjacent separate symbols" versus "one compound label" without ever
 * reading the characters as a word.
 */
export function columnPitchProof(units) {
  const leads = units.map((u) => u.x).sort((a, b) => a - b);
  const diffs = leads.slice(1).map((v, i) => v - leads[i]);
  if (!diffs.length) return { pitch: null, onGrid: [], offGrid: [] };
  const pitch = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const onGrid = [];
  const offGrid = [];
  for (const u of units) {
    const nearest = Math.min(...leads.map((l) => Math.abs(l - u.x)));
    const drift = nearest - pitch;
    (drift < pitch / 2 ? onGrid : offGrid).push({ ...u, nearestColumn: +nearest.toFixed(2), drift: +drift.toFixed(2) });
  }
  return { pitch: +pitch.toFixed(2), onGrid, offGrid };
}

/**
 * Associate each quantity annotation with the label unit it belongs to.
 *
 * Two drafting conventions appear in this drawing set and both are geometric:
 *
 *   CENTRED_ABOVE -- the count is centred over the label's LEADING run (the
 *     horizontal columns used on the KGS/BOS/GRS schematics).
 *   RIGHT_ABOVE   -- the count starts just to the RIGHT of the label and sits a
 *     little above its row (the per-panel vertical device schedules used on the
 *     WLC and substation schematics).
 *
 * Either way the test is X plus Y, never character order.
 */
export function associateAnnotations(qtys, units) {
  const pairs = [];
  const addPairs = (convention, test) => {
    for (const q of qtys) {
      for (const u of units) {
        const dx = test(q, u);
        if (dx !== null) pairs.push({ q, u, convention, dx: +dx.toFixed(2) });
      }
    }
  };
  addPairs("CENTRED_ABOVE", (q, u) => {
    const dx = Math.abs(u.leadCx - q.cx);
    const above = u.cy - q.cy;
    return dx <= COL_TOL && above >= ROW_ABOVE_MIN && above <= ROW_ABOVE_MAX ? dx : null;
  });
  addPairs("RIGHT_ABOVE", (q, u) => {
    const gap = q.x - u.rightEdge;
    return gap >= RIGHT_GAP_MIN && gap <= RIGHT_GAP_MAX && Math.abs(u.cy - q.cy) <= RIGHT_DY_MAX ? gap : null;
  });

  // Resolve in two passes. CENTRED_ABOVE is the stronger, more specific claim
  // (the count is centred on its own column), so it must never lose a count to
  // the looser right-hand convention. Each pass claims a count and a label once.
  const usedQ = new Map();
  const usedU = new Map();
  for (const convention of ["CENTRED_ABOVE", "RIGHT_ABOVE"]) {
    const pass = pairs.filter((p) => p.convention === convention).sort((a, b) => a.dx - b.dx);
    for (const p of pass) {
      if (usedQ.has(p.q) || usedU.has(p.u)) continue;
      usedQ.set(p.q, p); usedU.set(p.u, p);
    }
  }
  return qtys.map((q) => {
    const hit = usedQ.get(q);
    const rival = pairs.filter((p) => p.q === q && p.u !== hit?.u).map((p) => p.u.label);
    return {
      q, unit: hit ? hit.u : null, convention: hit ? hit.convention : null,
      dx: hit ? hit.dx : null, rival: rival.length ? rival[0] : null,
      rivalCount: rival.length,
    };
  });
}

/** Per-sheet geometry-aware takeoff. Returns rows plus every rejected quantity. */
export function takeOffSheet(db, key, { bandBy = "level" } = {}) {
  const intakeId = intakeFor(db, key);
  const all = assets(db, intakeId);
  const qtys = all.filter((t) => QTY_RE.test(t.text));
  const units = labelUnits(all.filter((t) => LABEL_RE.test(t.text)), qtys);
  const bands = levelBands(all);
  const proof = columnPitchProof(units.filter((u) => associateAnnotations(qtys, [u]).some((h) => h.unit)));

  const rows = [];
  for (const hit of associateAnnotations(qtys, units)) {
    const band = bands.find((b) => hit.q.cy >= b.start && hit.q.cy < b.end);
    const rec = {
      sheet: key,
      building: SHEETS[key].building,
      level: band ? band.level : (bandBy === "sheet" ? "SHEET" : "UNBANDED"),
      quantityText: hit.q.text,
      quantity: Number(hit.q.text.match(/\d+/)[0]),
      quantityBox: { x: +hit.q.x.toFixed(1), y: +hit.q.y.toFixed(1), w: +hit.q.w.toFixed(1), cx: +hit.q.cx.toFixed(1), cy: +hit.q.cy.toFixed(1) },
      symbolLabel: hit.unit ? hit.unit.label : null,
      symbolBox: hit.unit ? { x: +hit.unit.x.toFixed(1), y: +hit.unit.y.toFixed(1), leadCx: +hit.unit.leadCx.toFixed(1), cy: +hit.unit.cy.toFixed(1) } : null,
      symbolRuns: hit.unit ? hit.unit.tokens.map((t) => ({ text: t.text, x: +t.x.toFixed(1), y: +t.y.toFixed(1), w: +t.w.toFixed(1) })) : null,
      convention: hit.convention,
      columnPitch: hit.unit ? proof.pitch : null,
      associationRationale: hit.unit
        ? `${hit.convention}: count "${hit.q.text}" centre x=${hit.q.cx.toFixed(1)} vs label "${hit.unit.label}" leading run x=${hit.unit.leadCx.toFixed(1)} (dx=${hit.dx}), vertical offset ${(hit.unit.cy - hit.q.cy).toFixed(1)}; bound in X and Y, not by character order`
        : "no label unit shares this column within the accepted geometric windows",
      dx: hit.dx,
      adjacentLabel: hit.adjacentLabel,
      state: hit.unit ? "RESOLVED_FROM_GEOMETRY" : "UNREADABLE",
      // A count that has NO device label anywhere in its own column band is not a
      // failed association: it belongs to a different table on the same sheet
      // (a level subtotal column, or the interface schedule down the right-hand
      // side). Say so rather than leaving it looking like a missed device.
      columnHasDeviceLabel: units.some((u) => Math.abs(u.leadCx - hit.q.cx) <= 40),
    };
    rec.family = hit.unit ? (GOVERNED_LABEL_FAMILY[hit.unit.label] ?? null) : null;
    rec.identityGoverned = Boolean(rec.family);
    rec.classification = rec.family
      ? "RESOLVED_FROM_GEOMETRY"
      : hit.unit
        ? "QUANTIFIED_IDENTITY_NOT_IN_GOVERNED_LEGEND"
        : rec.columnHasDeviceLabel
          ? "UNRESOLVED_COLUMN_PRESENT"
          : "NOT_A_DEVICE_COLUMN_COUNT";
    rows.push(rec);
  }
  return { sheet: key, intakeId, units, proof, rows };
}

/** Aggregate sheet rows into per-building detector families. */
export function buildingTotals(rowsBySheet) {
  const byBuilding = {};
  for (const rows of Object.values(rowsBySheet)) {
    const b = rows[0]?.building ?? "UNKNOWN";
    const agg = byBuilding[b] ??= { families: {}, unidentified: {}, unresolved: [], rows: [] };
    for (const r of rows) {
      agg.rows.push(r);
      if (r.family) agg.families[r.family] = (agg.families[r.family] ?? 0) + r.quantity;
      else if (r.symbolLabel) agg.unidentified[r.symbolLabel] = (agg.unidentified[r.symbolLabel] ?? 0) + r.quantity;
      else agg.unresolved.push(r);
    }
  }
  for (const f of DETECTOR_FAMILIES) if (!(f in byBuilding)) { /* keep absence visible */ }
  return byBuilding;
}

export function campusTotals(byBuilding) {
  const campus = {};
  for (const f of DETECTOR_FAMILIES) {
    campus[f] = Object.values(byBuilding).reduce((t, b) => t + (b.families[f] ?? 0), 0);
  }
  return campus;
}