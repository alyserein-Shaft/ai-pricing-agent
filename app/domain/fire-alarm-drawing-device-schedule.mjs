// GOVERNED FIRE ALARM DRAWING DEVICE SCHEDULE PARSER
//
// WHY THIS EXISTS. Fire Alarm schematic sheets print a device schedule -- per
// floor or per zone, with printed quantities and the device-class codes those
// quantities belong to. That schedule IS the project's own per-building device
// evidence, and until now nothing read it: the intake pipeline stored the text
// assets with coordinates, and only a one-shot historical script ever wrote
// legend entries. Recognition therefore had no symbol definitions to bootstrap
// and could never approve a Fire Alarm occurrence.
//
// This parser is a PURE function over already-ingested drawing assets. It does
// not read or write the database, does not decide SLC address class (that is a
// separate governed authority), and never normalises a discrepancy away.
//
// TWO REAL LAYOUTS, both derived from actual project sheets -- no third layout
// is speculatively supported:
//
//   LEVEL_BAND_SUBTOTAL   (BOS, landscape, 3370x2384)
//     One row per floor. Each printed subtotal ("61Nos.") has its device-class
//     codes printed BENEATH it at the same x. The row also carries a printed
//     row TOTAL with no class cell beneath it.
//
//   LEVEL_COLUMN_STACK    (WLC, portrait, 2384x3370)
//     One COLUMN per floor; the floor labels sit side by side at one y. Under
//     each column is a zone header, a class code, and a vertical stack of
//     printed quantity cells.
//
// DISCREPANCIES ARE PRESERVED. Where the sum of class-attributed subtotals
// differs from the printed row total, BOTH values are returned with the delta.
// The difference is a real observation about the sheet, not an error to be
// rounded away -- and it may be the signature of an unattributed column.

export const SCHEDULE_PARSER_VERSION = "fire-alarm-drawing-device-schedule-1.0.0";

export const SCHEDULE_LAYOUT_STRATEGIES = Object.freeze([
  "LEVEL_BAND_SUBTOTAL",
  "LEVEL_COLUMN_STACK",
]);

export const SCHEDULE_PARSE_CONFIDENCE = Object.freeze([
  "COMPLETE",
  "PARTIAL_NO_LEVEL_ROWS",
  "UNSUPPORTED_LAYOUT",
]);

// A floor/level row label as these sheets actually print them.
const LEVEL_PATTERN = /^(GROUND FLOOR|BASEMENT(?:\s*\d+)?|LEVEL\s*\d+|ROOF\s*\d+|MEZZANINE|EXTERNAL)$/i;
// A printed quantity cell: "61Nos.", "2 Nos", "1 No", "3Nos"
const QUANTITY_PATTERN = /^(\d{1,4})\s*Nos?\.?$/i;
// A device-class cell: a short uppercase abbreviation. Deliberately capped at 4
// characters so ordinary words can never be mistaken for a class code.
const CLASS_PATTERN = /^([A-Z]{1,4})$/;

const normalizedText = (value) => String(value ?? "").trim();
const isLevelLabel = (text) => LEVEL_PATTERN.test(text) && normalizedText(text).length <= 16;
const quantityOf = (text) => {
  const match = QUANTITY_PATTERN.exec(text);
  return match ? Number(match[1]) : null;
};
const classOf = (text) => (CLASS_PATTERN.test(text) ? text.toUpperCase() : null);

// Normalises an ingested asset row into the geometry this parser needs. An
// asset whose bounding box cannot be read is DROPPED, never guessed at.
export const toPositionedAssets = (rows = []) =>
  rows
    .map((row) => {
      let box = null;
      try {
        box = typeof row.bounding_box === "string" ? JSON.parse(row.bounding_box) : row.bounding_box;
      } catch {
        box = null;
      }
      if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y)) return null;
      return {
        id: row.id ?? null,
        text: normalizedText(row.text_content),
        x: Number(box.x),
        y: Number(box.y),
        width: Number.isFinite(box.width) ? Number(box.width) : 0,
        height: Number.isFinite(box.height) ? Number(box.height) : 0,
        assetType: row.asset_type ?? null,
      };
    })
    .filter((asset) => asset && asset.text.length > 0)
    // Canonical ordering, so the parser is a pure function of the ASSET SET and
    // not of the order rows happened to arrive in. Every downstream scan keeps
    // array order, so without this the subtotal sequence -- and therefore the
    // reported evidence -- depended on query ordering.
    .sort((a, b) => a.y - b.y || a.x - b.x || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));

const uniqueSorted = (values) => [...new Set(values)].sort();

// ---------------------------------------------------------------------------
// LAYOUT DETECTION
// ---------------------------------------------------------------------------
// Derived from geometry, not from the filename. A sheet is COLUMN_STACK when
// its level labels are spread horizontally at (near) one y -- the portrait
// side-by-side schedule -- and BAND_SUBTOTAL when they are spread vertically,
// i.e. stacked as rows.
export const detectScheduleLayout = (assets = []) => {
  const levels = assets.filter((asset) => isLevelLabel(asset.text));
  if (levels.length < 2) {
    return {
      strategy: levels.length === 1 ? SCHEDULE_LAYOUT_STRATEGIES[0] : null,
      levelLabelCount: levels.length,
      reason:
        levels.length === 0
          ? "No floor/level row labels were recognised on this sheet."
          : "Only one floor label: a single-row schedule is not enough to establish a layout.",
    };
  }
  const ys = levels.map((level) => level.y);
  const spreadY = Math.max(...ys) - Math.min(...ys);
  const xs = levels.map((level) => level.x);
  const spreadX = Math.max(...xs) - Math.min(...xs);

  if (spreadX > spreadY * 3 && spreadX > 200) {
    return {
      strategy: "LEVEL_COLUMN_STACK",
      levelLabelCount: levels.length,
      reason: `Floor labels span ${spreadX.toFixed(0)}px horizontally but only ${spreadY.toFixed(0)}px vertically: the schedule is column-per-floor.`,
      spreadX,
      spreadY,
    };
  }
  return {
    strategy: "LEVEL_BAND_SUBTOTAL",
    levelLabelCount: levels.length,
    reason: `Floor labels span ${spreadY.toFixed(0)}px vertically: the schedule is row-per-floor.`,
    spreadX,
    spreadY,
  };
};

// ---------------------------------------------------------------------------
// STRATEGY A -- LEVEL_BAND_SUBTOTAL (BOS-style, row per floor)
// ---------------------------------------------------------------------------

// Vertical distance within which a class cell is treated as belonging to the
// subtotal above it. Derived from the observed offset (subtotal baseline to
// class baseline is 8-30px on these sheets) with headroom, and expressed
// relative to the printed text height so it is not tied to one sheet's scale.
const classBandFor = (subtotal) => Math.max(24, subtotal.height * 4);

// Horizontal slack when asking whether a cell sits outside the subtotal span.
// Matches the slack the class-attribution window already uses on the left.
const SPAN_SLACK = 12;

/**
 * Choose the printed row total from the quantity cells that carry no class codes.
 *
 * WHY THIS EXISTS. The original rule was "the first such cell is the row total".
 * That is right only when a floor prints exactly one unattributed quantity. KGS
 * prints two on every floor -- a small per-class quantity (2, 9, 4) and the real
 * row total (144, 185, 120, 115, 46) -- and the first-by-position rule picked the
 * small one. Every KGS floor therefore reported a printed total near 2-9 against a
 * component sum in the hundreds, which is how a sheet whose quantity cells sum to
 * 1281 was reported as a printed total of 23.
 *
 * THE RULE. The printed row total is the unattributed cell that lies OUTSIDE the
 * horizontal span of that floor's class-attributed subtotals. On every real sheet
 * the row total is set apart from the per-class block. Verified across all floors
 * of BOS, GRS and KGS: the rule selects a unique candidate everywhere.
 *
 * DELIBERATELY NOT USED: "pick the largest value". That is a value heuristic, and
 * it would silently absorb a genuine drawing discrepancy. This rule is geometric.
 *
 * When the rule cannot choose uniquely -- no subtotals to measure a span against,
 * or several candidates outside it -- it returns null and the floor stays
 * unresolved. An ambiguous row total is reported as missing, never guessed.
 */
const selectPrintedRowTotal = (unattributed, subtotals) => {
  if (!unattributed.length) return null;
  if (unattributed.length === 1) return unattributed[0];
  if (!subtotals.length) return null;

  const xs = subtotals.map((entry) => entry.x);
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const outside = unattributed.filter(
    (cell) => cell.x < min - SPAN_SLACK || cell.x > max + SPAN_SLACK,
  );

  // Exactly one candidate outside the subtotal block: that is the row total.
  if (outside.length === 1) return outside[0];

  // More than one outside the block is genuinely ambiguous. Fall back to null
  // rather than picking by value or by position.
  return null;
};

const parseLevelBandSubtotal = (assets) => {
  const levels = assets.filter((asset) => isLevelLabel(asset.text)).sort((a, b) => a.y - b.y || a.x - b.x);
  const floors = [];

  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index];
    const next = levels[index + 1];
    const upperBound = next ? next.y : Infinity;
    // The band is this floor's row: from just above its label to just below the
    // next label. Horizontal extent is bounded by the label column so an
    // unrelated annotation elsewhere on the sheet cannot be captured.
    const band = assets.filter(
      (asset) => asset.y >= level.y - 8 && asset.y < upperBound - 8 && Math.abs(asset.x - level.x) < 900,
    );

    const subtotals = [];
    // Quantity cells with no class codes beneath. NOT assumed to be the row
    // total: KGS prints a per-class quantity in that position too.
    const unattributed = [];

    for (const cell of band) {
      const quantity = quantityOf(cell.text);
      if (quantity === null) continue;
      const classes = uniqueSorted(
        band
          .filter(
            (other) =>
              other !== cell &&
              other.y > cell.y &&
              other.y <= cell.y + classBandFor(cell) &&
              other.x >= cell.x - 12 &&
              other.x <= cell.x + 60,
          )
          .map((other) => classOf(other.text))
          .filter(Boolean),
      );

      if (classes.length === 0) {
        // No class cell beneath. This is a CANDIDATE printed row total, but on
        // some sheets it is not the only such cell -- so candidates are collected
        // and resolved after the whole band is read. See selectPrintedRowTotal.
        unattributed.push({ value: quantity, raw: cell.text, x: cell.x, y: cell.y });
        continue;
      }
      subtotals.push({
        value: quantity,
        raw: cell.text,
        classCodes: classes,
        x: cell.x,
        y: cell.y,
      });
    }

    const printedRowTotal = selectPrintedRowTotal(unattributed, subtotals);

    if (!subtotals.length && printedRowTotal === null) continue;

    // The component sum is computed from the class-attributed subtotals ONLY.
    // It is deliberately NOT reconciled against the printed row total.
    const componentSum = subtotals.reduce((sum, entry) => sum + entry.value, 0);
    const discrepancy =
      printedRowTotal === null
        ? null
        : {
            printedRowTotal: printedRowTotal.value,
            componentSum,
            delta: printedRowTotal.value - componentSum,
          };

    floors.push({
      level: level.text,
      levelLabel: { x: level.x, y: level.y, id: level.id },
      subtotals,
      printedRowTotal,
      componentSum,
      discrepancy,
      // Retained so an ambiguous row total stays inspectable rather than being
      // discarded. Never summed and never used as an authority.
      unattributedQuantities: unattributed,
      unresolved:
        // A printed total with no subtotals at all, or a subtotal set that does
        // not account for the printed total, is UNRESOLVED evidence -- never a
        // silently completed figure.
        subtotals.length === 0 ||
        (discrepancy !== null && discrepancy.delta !== 0) ||
        // Several unattributed quantity cells the rule could not resolve to a
        // single row total. The floor's printed total is genuinely unknown, so
        // the floor cannot be called resolved even though no discrepancy was
        // computed.
        (printedRowTotal === null && unattributed.length > 1),
    });
  }
  return floors;
};

// ---------------------------------------------------------------------------
// STRATEGY B -- LEVEL_COLUMN_STACK (WLC-style, column per floor)
// ---------------------------------------------------------------------------
//
// HONEST LIMIT, recorded rather than papered over: this strategy recovers the
// floor columns, their zone headers and their class codes, and the printed
// quantity cells beneath each -- but it does NOT assign a meaning to the STACK
// of quantity cells in a column (these sheets print two or more cells per
// column). Until that meaning is established from project evidence, the cells
// are returned individually and the column is reported UNRESOLVED rather than
// summed into an invented per-floor total.
const columnWidth = (assets) => {
  const xs = assets.map((asset) => asset.x).sort((a, b) => a - b);
  const gaps = [];
  for (let index = 1; index < xs.length; index += 1) gaps.push(xs[index] - xs[index - 1]);
  const typical = gaps.filter((gap) => gap > 4);
  if (!typical.length) return 160;
  typical.sort((a, b) => a - b);
  return Math.max(80, typical[Math.floor(typical.length / 2)] * 4);
};

const parseLevelColumnStack = (assets) => {
  const levels = assets.filter((asset) => isLevelLabel(asset.text));
  const width = columnWidth(assets);
  const byColumn = new Map();

  for (const level of levels) {
    const key = `${Math.round(level.x / width)}`;
    if (!byColumn.has(key)) byColumn.set(key, []);
    byColumn.get(key).push(level);
  }

  const floors = [];
  for (const [key, columnLevels] of byColumn) {
    const anchor = columnLevels[0];
    const column = assets.filter((asset) => Math.abs(asset.x - anchor.x) < width / 2);
    const header = column.filter((asset) => asset.y > anchor.y && classOf(asset.text) && asset.text.length <= 6 && asset.y < anchor.y + 260);
    const classCodes = uniqueSorted(header.map((asset) => classOf(asset.text)).filter(Boolean));
    const zoneHeaders = uniqueSorted(
      column.filter((asset) => asset.text.length > 4 && asset.text.length <= 8 && /^[A-Z]{1,3}-?\d{1,3}$/i.test(asset.text)).map((asset) => asset.text),
    );
    const quantityCells = column
      .filter((asset) => quantityOf(asset.text) !== null)
      .sort((a, b) => a.y - b.y)
      .map((asset) => ({ value: quantityOf(asset.text), raw: asset.text, x: asset.x, y: asset.y }));

    if (!quantityCells.length) continue;

    floors.push({
      level: columnLevels.map((level) => level.text).join(" / "),
      levelLabel: { x: anchor.x, y: anchor.y, id: anchor.id },
      zoneHeaders,
      classCodes,
      // Individual cells, deliberately NOT summed: the meaning of the stack is
      // not established from project evidence.
      quantityCells,
      printedRowTotal: null,
      componentSum: null,
      discrepancy: null,
      unresolved: true,
      unresolvedReason:
        "Column layout: the printed quantity cells are recovered individually, but the engineering meaning of the stacked cells per column is not established, so no per-floor total is asserted.",
      columnKey: key,
    });
  }
  return floors;
};

// ---------------------------------------------------------------------------
// ENTRY POINT
// ---------------------------------------------------------------------------
export const parseFireAlarmDeviceSchedule = ({ assets = [], sheetCode = null, pageNumber = null } = {}) => {
  const positioned = toPositionedAssets(assets);
  const layout = detectScheduleLayout(positioned);

  if (!layout.strategy) {
    return {
      parserVersion: SCHEDULE_PARSER_VERSION,
      sheetCode,
      pageNumber,
      strategy: null,
      confidence: "UNSUPPORTED_LAYOUT",
      layoutReason: layout.reason,
      positionedAssetCount: positioned.length,
      floors: [],
      detectorSide: null,
      moduleSide: null,
      unresolvedClasses: [],
    };
  }

  const floors =
    layout.strategy === "LEVEL_COLUMN_STACK" ? parseLevelColumnStack(positioned) : parseLevelBandSubtotal(positioned);

  // Class CODES are preserved verbatim. Mapping a code such as S/H/C/D to an
  // engineering device class, and then to an SLC address class, is a SEPARATE
  // governed authority and is deliberately not performed here.
  const codes = uniqueSorted(
    floors.flatMap((floor) => (floor.subtotals || []).flatMap((entry) => entry.classCodes)),
  );

  const printedTotals = floors.map((floor) => floor.printedRowTotal?.value).filter((value) => Number.isFinite(value));
  const componentSums = floors.map((floor) => floor.componentSum).filter((value) => Number.isFinite(value));
  const discrepancies = floors
    .map((floor) => floor.discrepancy)
    .filter((discrepancy) => discrepancy && discrepancy.delta !== 0);

  return {
    parserVersion: SCHEDULE_PARSER_VERSION,
    sheetCode,
    pageNumber,
    strategy: layout.strategy,
    layoutReason: layout.reason,
    positionedAssetCount: positioned.length,
    floors,
    // Aggregate evidence, with the printed and derived figures kept distinct.
    printedTotalSum: printedTotals.length ? printedTotals.reduce((a, b) => a + b, 0) : null,
    componentSumTotal: componentSums.length ? componentSums.reduce((a, b) => a + b, 0) : null,
    discrepancies,
    classCodesSeen: codes,
    confidence:
      floors.length === 0
        ? "PARTIAL_NO_LEVEL_ROWS"
        : layout.strategy === "LEVEL_COLUMN_STACK" || discrepancies.length > 0
          ? "PARTIAL"
          : "COMPLETE",
  };
};
