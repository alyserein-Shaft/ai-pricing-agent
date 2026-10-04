// Range primitives for the canonical merged-cell policy.
//
// These live apart from the policy itself so the pure reference<->coordinate
// arithmetic can be tested on its own, and so the policy module has no
// dependency on any parser. Nothing here reads a workbook.
import { columnNumber } from "./boq-cell-reference.mjs";

export { columnNumber };

/**
 * Parse an OOXML merged range such as "B2:B4" or "C1:D1" into inclusive
 * coordinates. Returns null for anything unparseable -- the caller must then
 * IGNORE the range rather than guess.
 *
 * @returns {{column:number,row:number,endColumn:number,endRow:number}|null}
 */
export function parseMergedRange(reference) {
  if (typeof reference !== "string") return null;
  const parts = reference.trim().split(":");
  if (parts.length !== 2) return null;
  const start = parseCellRef(parts[0]);
  const end = parseCellRef(parts[1]);
  if (!start || !end) return null;
  return {
    column: Math.min(start.column, end.column),
    row: Math.min(start.row, end.row),
    endColumn: Math.max(start.column, end.column),
    endRow: Math.max(start.row, end.row),
  };
}

/** "D14" -> { column: 4, row: 14 }. Returns null when malformed. */
export function parseCellRef(reference) {
  if (typeof reference !== "string") return null;
  const match = reference.trim().match(/^([A-Za-z]{1,3})(\d{1,7})$/);
  if (!match) return null;
  const column = columnNumber(match[1]);
  const row = Number(match[2]);
  if (!Number.isInteger(column) || column < 1 || !Number.isInteger(row) || row < 1) return null;
  return { column, row };
}
