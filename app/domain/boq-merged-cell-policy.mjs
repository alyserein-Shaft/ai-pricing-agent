// CANONICAL MERGED-CELL INTERPRETATION POLICY FOR BOQ EXTRACTION.
//
// WHY THIS MODULE EXISTS
// ----------------------
// A spreadsheet merge is a DISPLAY construct: the anchor cell's value is
// rendered across the whole merged rectangle, and the covered cells carry no
// independent value. A BOQ reader that ignores merges therefore sees a value on
// one row and NOTHING on the rows beneath it, which silently drops rows or
// understates a per-row total. This was measured on a synthetic corpus: a
// current merged across three device rows was recovered on 1 of 3 rows, a 3x
// understatement, and a description merged down three rows caused all three
// rows to be classified Unknown instead of BOQ Item.
//
// This is the ONE place merge semantics live. It is called from exactly one
// call site (`matrixRowsFromSheet` in app/domain/boq-extractor.mjs). Merge
// logic is deliberately NOT reimplemented in any downstream consumer.
//
// THE POLICY, ANSWERED EXPLICITLY
// -------------------------------
// Q. What is the anchor cell?
// A. The top-left cell of the range. In OOXML only the anchor may carry a
//    value; every other cell in the rectangle is physically absent.
//
// Q. Which rows/columns are covered?
// A. The full inclusive rectangle named by the range, resolved from the cell
//    REFERENCES (not from array positions), so a sparse row cannot shift it.
//
// Q. When is a merged value inherited?
// A. Only when the anchor holds a non-empty value AND the covered cell is
//    currently empty. That is precisely the case where the sheet is asserting
//    "this value spans here" and no data would be lost.
//
// Q. When must it NOT be inherited?
// A. Four guards, all of them load-bearing:
//    1. EMPTY ANCHOR -- never fabricate. A merge whose anchor is blank asserts
//       nothing, so nothing is propagated.
//    2. OCCUPIED TARGET -- never overwrite a cell that has its own value. This
//       is what keeps a header merge that straddles a header/data boundary from
//       overwriting the real data row beneath it.
//    3. NO UNDECLARED MERGE -- only ranges present in the sheet's own
//       `mergedRanges` are honoured. A blank cell with no merge metadata is NOT
//       forward-filled. This is the explicit refusal to universally
//       forward-fill descriptions: doing so would invent shared scope that the
//       workbook never claimed, and would fuse genuinely distinct items.
//    4. MALFORMED RANGE -- an unparseable range is ignored, never thrown. The
//       parser must fail closed, and a bad merge annotation must not abort an
//       otherwise readable sheet.
//
// Q. How is provenance represented?
// A. An inherited cell keeps its OWN reference (so downstream cell-level
//    provenance still points at a real, addressable cell) and additionally
//    records `inherited: true`, `inheritedFrom` (the anchor reference) and
//    `mergedRange`. Provenance is never discarded and never becomes anonymous.
//    A caller that needs to distrust an inherited value can see that it was
//    inherited.
//
// Q. How do horizontal and vertical merges differ?
// A. They do not, semantically: both mean "the anchor's value spans this
//    rectangle". The fill is a rectangle fill either way. They differ only in
//    which axis is spanned, and that is derivable from the range shape, so no
//    special-casing is required and none is provided.
//
// Q. How do merged headers differ from merged data cells?
// A. Only in what a CONSUMER must do with them, and this module deliberately
//    does not decide that. A merged header must not create a duplicate data
//    row; a merged data value must be repeated down its rows. Because this
//    module only fills CELL VALUES and never creates or removes rows, the
//    "duplicate row" hazard cannot arise here at all. Deciding header-vs-data is
//    the job of the header detector, which runs later and unchanged.
//
// CONFIDENCE
// ----------
// This module changes NO confidence value and NO readiness threshold. A
// structurally recovered cell is not a more certain cell: the workbook asserts
// the same thing it asserted before, we simply stopped discarding it.
import { columnNumber, parseMergedRange } from "./boq-merged-cell-policy-primitives.mjs";

export const MERGE_POLICY_VERSION = "boq-merged-cell-policy-v1";

/** Guard reasons, returned so callers and tests can assert the policy held. */
export const MERGE_DECISIONS = Object.freeze({
  INHERITED: "INHERITED",
  SKIPPED_EMPTY_ANCHOR: "SKIPPED_EMPTY_ANCHOR",
  SKIPPED_OCCUPIED_TARGET: "SKIPPED_OCCUPIED_TARGET",
  SKIPPED_MALFORMED_RANGE: "SKIPPED_MALFORMED_RANGE",
  SKIPPED_OUT_OF_RANGE: "SKIPPED_OUT_OF_RANGE",
});

const isBlank = (value) =>
  value === null || value === undefined || (typeof value === "string" && value.trim() === "") ||
  (typeof value === "boolean" && value === false && false) || Number.isNaN(value);

/**
 * Resolve a sheet's merged ranges into a lookup of inherited cell values.
 *
 * @param {object} sheet parsed sheet ({ rows, mergedRanges, maxColumn })
 * @returns {{ lookup: Map<string, object>, decisions: object[], policy: string }}
 *   `lookup` is keyed `"<columnNumber>:<rowNumber>"`.
 */
export function resolveMergedCellInheritance(sheet) {
  const decisions = [];
  const lookup = new Map();
  const ranges = Array.isArray(sheet?.mergedRanges) ? sheet.mergedRanges : [];

  // Index the physically present cells once: reference column/row -> cell.
  const present = new Map();
  for (const row of Array.isArray(sheet?.rows) ? sheet.rows : []) {
    for (const cell of Array.isArray(row?.cells) ? row.cells : []) {
      const column = Number(cell?.column);
      const rowNumber = Number(cell?.row ?? row?.sourceRow);
      if (!Number.isInteger(column) || !Number.isInteger(rowNumber)) continue;
      present.set(`${column}:${rowNumber}`, cell);
    }
  }

  for (const range of ranges) {
    const parsed = parseMergedRange(range);
    if (!parsed) {
      // GUARD 4: malformed annotation is ignored, never fatal.
      decisions.push({ range: String(range), decision: MERGE_DECISIONS.SKIPPED_MALFORMED_RANGE });
      continue;
    }
    const { column: anchorColumn, row: anchorRow, endColumn, endRow } = parsed;
    const anchorCell = present.get(`${anchorColumn}:${anchorRow}`);

    // GUARD 1: an empty anchor asserts nothing.
    if (!anchorCell || isBlank(anchorCell.value)) {
      decisions.push({ range: String(range), decision: MERGE_DECISIONS.SKIPPED_EMPTY_ANCHOR });
      continue;
    }
    if (!anchorCell.reference) {
      // Cannot express provenance without a real anchor reference, so decline.
      decisions.push({ range: String(range), decision: MERGE_DECISIONS.SKIPPED_MALFORMED_RANGE });
      continue;
    }

    for (let rowNumber = anchorRow; rowNumber <= endRow; rowNumber += 1) {
      for (let column = anchorColumn; column <= endColumn; column += 1) {
        if (column === anchorColumn && rowNumber === anchorRow) continue; // the anchor itself
        const key = `${column}:${rowNumber}`;
        const existing = present.get(key);

        // GUARD 2: never overwrite a cell that carries its own value.
        if (existing && !isBlank(existing.value)) {
          decisions.push({ range: String(range), target: key, decision: MERGE_DECISIONS.SKIPPED_OCCUPIED_TARGET });
          continue;
        }
        // Out-of-sheet targets cannot be projected; record and move on.
        if (rowNumber > (sheet?.maxRow ?? Number.POSITIVE_INFINITY) || column > (sheet?.maxColumn ?? Number.POSITIVE_INFINITY)) {
          decisions.push({ range: String(range), target: key, decision: MERGE_DECISIONS.SKIPPED_OUT_OF_RANGE });
          continue;
        }

        const targetReference = `${columnLetters(column)}${rowNumber}`;
        lookup.set(key, {
          value: anchorCell.value,
          rawText: anchorCell.rawText ?? null,
          formula: null, // a formula belongs to the anchor, not to a covered cell
          reference: targetReference, // the target keeps its OWN address
          styleIndex: anchorCell.styleIndex ?? 0,
          column,
          row: rowNumber,
          // PROVENANCE: explicit, never anonymous.
          inherited: true,
          inheritedFrom: anchorCell.reference,
          mergedRange: String(range),
        });
        decisions.push({ range: String(range), target: key, decision: MERGE_DECISIONS.INHERITED });
      }
    }
  }

  return { lookup, decisions, policy: MERGE_POLICY_VERSION };
}

const columnLetters = (n) => {
  let s = "";
  let v = n;
  while (v > 0) { const r = (v - 1) % 26; s = String.fromCharCode(65 + r) + s; v = Math.floor((v - 1) / 26); }
  return s;
};

export { columnLetters, columnNumber, parseMergedRange };
