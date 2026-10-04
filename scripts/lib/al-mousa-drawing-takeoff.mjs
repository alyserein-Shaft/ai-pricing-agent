// AL MOUSA -- BLIND FIRE ALARM DRAWING QUANTITY TAKEOFF.
//
// READ-ONLY and BLIND. This module reads drawing text only. It opens no
// database, references no BOQ table, and contains no target number, so it
// cannot steer its result toward any previously reported figure.
//
// THE QUANTITY SOURCE RULE
// ------------------------
// Quantity comes from EXPLICIT SCHEMATIC ANNOTATIONS -- "39 Nos.", "144 Nos.",
// "1 No." -- and never from how many graphic symbols happen to be drawn. A
// schematic prints each device type once as a symbol and states its count; the
// symbol is a KEY, not an occurrence.
//
// A symbol/annotation pair is accepted only when the association is MUTUAL
// nearest by column. Two annotations competing for one symbol column means the
// pairing is not defensible from a flattened text layer, so it is reported
// rather than guessed.
//
// SYMBOL IDENTITY comes from the governed T-00 legend only. Notation the legend
// does not define (S C, S HC, SIM, M) is quantified but UNCLASSIFIED: it is
// reported in its own bucket and never folded into a confirmed family total.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const DRAWING_SHEETS = Object.freeze({
  KGS: "2401232-PC-KGS-DR-T-93-ZZZ-005.txt",
  BOS: "2401232-PC-BOS-DR-T-93-ZZZ-005.txt",
  GRS: "2401232-PC-GRS-DR-T-93-ZZZ-005.txt",
  WLC: "2401232-PC-WLC-DR-T-93-ZZZ-005.txt",
  // One sheet covers BOTH substations and the DG/generator scope; it carries no
  // LEVEL markers, so it is treated as a single station band rather than as an
  // empty sheet.
  AMS002: "2401232-PC-AMS-DR-T-93-ZZZ-002.txt",
});

/** Governed legend identities, from 2401232-PC-AMS-DR-T-00-ZZZ-002 rev 1. */
export const LEGEND = Object.freeze({
  "S": "SMOKE DETECTOR",
  "H": "HEAT DETECTOR",
  "S D": "DUCT DETECTOR",
  "S H": "SMOKE AND HEAT COMBINED DETECTOR",
  "CE M": "INTERFACE MODULE MONITORING",
  "CE C": "INTERFACE MODULE CONTROL",
  "CE": "INTERFACE MODULE",
  "DC": "DOOR CONTACT",
  "T": "FIREMAN TELEPHONE JACK",
  "F": "FIRE ALARM MANUAL STATION (WEATHER PROOF)",
  "WP": "LOOP POWERED STROBE WITH SOUNDER (WEATHER PROOF TYPE)",
  "C": "CEILING MOUNTED LOOP POWERED STROBE WITH SOUNDER (WEATHER PROOF TYPE)",
  "2": "FIRE ALARM MANUAL STATION",
});

/** Notation that appears on the schematics but is NOT in the governed legend. */
export const SYMBOL_IDENTITY_UNRESOLVED = Object.freeze(["S C", "S HC", "SIM", "M"]);

/** Family membership. Only these four become confirmed family totals. */
export const FAMILY_OF = Object.freeze({
  "S": "SPOT_SMOKE",
  "H": "HEAT",
  "S H": "COMBINED",
  "S D": "DUCT",
});

export const ANNOTATION_RE = /(\d+)\s*Nos?\s*\.?/gi;
const LEVEL_RE = /^\s*(ROOF|LEVEL|GROUND FLOOR|BASEMENT|FLOOR)\b\s*([0-9A-Z]{0,3})\b/;

const SYMBOL_TOKENS = Object.freeze(
  Object.keys(LEGEND).concat(SYMBOL_IDENTITY_UNRESOLVED).sort((a, b) => b.length - a.length),
);

const isCableNote = (line) => /sq\.mm|CABLE|CWZ/i.test(line);

/**
 * Band a sheet. Level markers delimit multi-storey schematics. A small station
 * schematic has none, and treating that as "no bands" would report ZERO demand
 * on a sheet that plainly shows devices -- so the whole sheet becomes one band.
 */
export function bands(lines) {
  const marks = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = LEVEL_RE.exec(lines[i]);
    if (m) marks.push({ at: i, label: `${m[1].toUpperCase()} ${m[2]}`.trim() });
  }
  if (!marks.length) return [{ label: "SHEET (no level markers)", start: 0, end: lines.length }];
  return marks.map((m, n) => ({
    label: m.label,
    start: m.at,
    end: n + 1 < marks.length ? marks[n + 1].at : lines.length,
  }));
}

/** Collect symbol tokens and quantity annotations with their column offsets. */
function tokens(lines, start, end) {
  const symbols = [];
  const annotations = [];
  for (let i = start; i < Math.min(end, lines.length); i += 1) {
    const line = lines[i];
    for (const m of line.matchAll(ANNOTATION_RE)) {
      annotations.push({ line: i, col: m.index, qty: Number(m[1]), annotation: m[0].trim() });
    }
    const cable = isCableNote(line);
    for (const s of SYMBOL_TOKENS) {
      // A bare digit is only a symbol when isolated. Otherwise "2 X 1.5 sq.mm
      // CWZ CABLE" registers as a FIRE ALARM MANUAL STATION and inflates
      // manual-station demand by hundreds.
      if (/^\d+$/.test(s)) {
        if (cable) continue;
        for (const m of line.matchAll(new RegExp(`(?:^|\\s{2,})${s}(?=\\s{2,}|$)`, "g"))) {
          symbols.push({ line: i, col: m.index + m[0].length - 1, symbol: s });
        }
        continue;
      }
      for (const m of line.matchAll(new RegExp(`(?<![A-Za-z])${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z])`, "g"))) {
        symbols.push({ line: i, col: m.index, symbol: s });
      }
    }
  }
  return { symbols, annotations };
}

const COL_TOL = 6;
const ROW_TOL = 8;

/** Accept only mutual-nearest, unique symbol/annotation pairs. */
export function associate(symbols, annotations) {
  const accepted = [];
  const usedSymbol = new Set();
  const usedAnnotation = new Set();
  for (let ai = 0; ai < annotations.length; ai += 1) {
    const a = annotations[ai];
    const near = symbols.filter((s) => Math.abs(s.col - a.col) <= COL_TOL && Math.abs(s.line - a.line) <= ROW_TOL);
    if (!near.length) continue;
    const pick = near.reduce((best, s) => {
      const d = Math.abs(s.col - a.col) * 100 + Math.abs(s.line - a.line);
      return !best || d < best.d ? { s, d } : best;
    }, null).s;
    const back = annotations
      .filter((x) => Math.abs(x.col - pick.col) <= COL_TOL && Math.abs(x.line - pick.line) <= ROW_TOL)
      .reduce((best, x) => {
        const d = Math.abs(x.col - pick.col) * 100 + Math.abs(x.line - pick.line);
        return !best || d < best.d ? { a: x, d } : best;
      }, null).a;
    const mutual = back.line === a.line && back.col === a.col;
    if (!mutual || usedSymbol.has(pick) || usedAnnotation.has(ai)) continue;
    usedSymbol.add(pick);
    usedAnnotation.add(ai);
    accepted.push({ symbol: pick.symbol, qty: a.qty, annotation: a.annotation });
  }
  const orphans = [
    ...symbols.filter((s) => !usedSymbol.has(s)).map((s) => ({ kind: "SYMBOL_WITHOUT_UNIQUE_ANNOTATION", symbol: s.symbol })),
    ...annotations.filter((_, i) => !usedAnnotation.has(i)).map((a) => ({ kind: "ANNOTATION_WITHOUT_UNIQUE_SYMBOL", qty: a.qty, annotation: a.annotation })),
  ];
  return { accepted, orphans };
}

/** Full blind takeoff. Returns per-building rows, families and orphans. */
export function takeOff(textDir) {
  const byBuilding = {};
  for (const [building, file] of Object.entries(DRAWING_SHEETS)) {
    const lines = readFileSync(join(textDir, file), "utf8").split("\n");
    const rows = [];
    const orphans = [];
    for (const band of bands(lines)) {
      const { symbols, annotations } = tokens(lines, band.start, band.end);
      const { accepted, orphans: o } = associate(symbols, annotations);
      for (const a of accepted) {
        rows.push({
          sheet: file, level: band.label, symbol: a.symbol,
          identity: LEGEND[a.symbol] ?? null,
          family: FAMILY_OF[a.symbol] ?? null,
          unresolvedIdentity: !LEGEND[a.symbol],
          qty: a.qty, annotation: a.annotation,
        });
      }
      orphans.push(...o.map((x) => ({ ...x, level: band.label })));
    }
    const families = {};
    const bySymbol = {};
    for (const r of rows) {
      bySymbol[r.symbol] = (bySymbol[r.symbol] ?? 0) + r.qty;
      if (r.family) families[r.family] = (families[r.family] ?? 0) + r.qty;
    }
    const unresolved = {};
    for (const r of rows) if (r.unresolvedIdentity) unresolved[r.symbol] = (unresolved[r.symbol] ?? 0) + r.qty;
    byBuilding[building] = { sheet: file, rows, families, bySymbol, unresolved, orphans };
  }
  const campus = {};
  for (const fam of ["SPOT_SMOKE", "HEAT", "COMBINED", "DUCT"]) {
    campus[fam] = Object.values(byBuilding).reduce((t, b) => t + (b.families[fam] ?? 0), 0);
  }
  return { byBuilding, campus };
}