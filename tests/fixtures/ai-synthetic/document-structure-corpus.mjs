// SYNTHETIC DOCUMENT-STRUCTURE BENCHMARK CORPUS.
//
// DATA POLICY: every project name, model number, manufacturer, quantity and
// price below is FABRICATED for this benchmark. None is drawn from, derived
// from, or copied out of any project, supplier or commercial source. The
// project vocabulary (fire alarm) is used because that is our domain, but the
// documents are invented.
//
// GROUND-TRUTH RULE (the important one): every `expected` block below is
// authored from the INTENT of the case -- what a competent human reading the
// authored sheet must conclude -- and is fixed BEFORE any parser or model runs.
// It is never derived from parser output, and NVIDIA output must never be
// allowed to write it. That is the whole point of the benchmark: NVIDIA
// validates an independently authored key, it does not produce one.
//
// SEVERITY follows the brief:
//   P0 STRUCTURAL -- could produce a materially wrong engineering quantity
//   P1 SEMANTIC   -- wrong field meaning/classification
//   P2 FORMATTING -- presentation only
//   P3 COSMETIC   -- invisible to downstream logic

/** @typedef {{caseId:string, category:string, pattern:string, rationale:string,
 *             rows:any[][], merges?:string[], expected:object, severity:string}} Case */

/** @type {Case[]} */
export const DOCUMENT_STRUCTURE_CASES = [
  // ---------------------------------------------------------------- 1
  {
    caseId: "SYN-DOC-001-vertical-merge-distinct-currents",
    category: "TABLE",
    pattern: "vertically merged cell spanning multiple rows",
    rationale:
      "The single highest-value case. A merged cell CONTAINING THE CURRENTS spans three device rows, holding its value only on the anchor row. The correct reading is that ONE current applies to all three devices. The failure mode is that the two covered rows yield NO current at all, so any per-row current total silently omits two devices and UNDERSTATES a power or battery calculation. This is the structural class behind the historical 24x battery error, rebuilt entirely with fabricated model numbers and quantities.",
    // BOQ-shaped so the canonical column mapper engages. Columns E and F are the
    // current pair; a real worksheet merges them down the device group.
    rows: [
      ["Item", "Description", "Unit", "Qty", "Standby mA", "Alarm mA"],
      ["1", "SYN-DET-OP1 addressable optical smoke detector", "No", 12, 0.3, 6.5],
      ["2", "SYN-DET-OP2 addressable optical smoke detector", "No", 14, null, null],
      ["3", "SYN-DET-HT1 addressable heat detector", "No", 8, null, null],
    ],
    // AUTHORING CORRECTION (documented, not a score change): this was authored
    // as a single "E2:F4" range, which is NOT a legal worksheet -- F2 held its own
    // 6.5 value while sitting INSIDE the merged rectangle, something Excel
    // refuses to produce. A current column merged down a device group is
    // actually TWO vertical merges. The expected semantics below are unchanged:
    // one current applies to all three device rows, total 19.5 mA. Only the
    // workbook markup was corrected to be legal.
    merges: ["E2:E4", "F2:F4"],
    expected: {
      itemCount: 3,
      quantities: [12, 14, 8],
      rowCount: 3,
      rows: [
        { model: "SYN-DET-OP1", standbyMa: 0.3, alarmMa: 6.5, currentAppliesToRow: true },
        { model: "SYN-DET-OP2", standbyMa: 0.3, alarmMa: 6.5, currentAppliesToRow: true },
        { model: "SYN-DET-HT1", standbyMa: 0.3, alarmMa: 6.5, currentAppliesToRow: true },
      ],
      // The decisive assertion: EVERY covered row must recover the merged
      // current. If rows 2 and 3 come back with no current, a per-row total
      // counts one device's draw instead of three.
      allCoveredRowsRecoverCurrent: true,
      expectedDeviceCountWithCurrent: 3,
    },
    severity: "P0",
  },

  // ---------------------------------------------------------------- 2
  {
    caseId: "SYN-DOC-002-merged-header-cells",
    category: "TABLE",
    pattern: "horizontally merged header cells",
    rationale:
      "A two-tier header where 'Current Draw' spans two sub-columns. A parser that reads only row 1 sees one header for two data columns and can misalign every current value.",
    rows: [
      ["Item", "Description", "Current Draw", null, "Qty"],
      [null, null, "Standby", "Alarm", null],
      ["1", "SYN-SND-ST1 addressable sounder/strobe", 0.4, 5.9, 20],
    ],
    merges: ["C1:D1", "A1:A2", "B1:B2", "E1:E2"],
    expected: {
      headerRows: 2,
      dataRows: 1,
      itemNumber: "1",
      quantity: 20,
      // The sub-header row must be recognised as a header, not as data.
      dataMustNotIncludeHeaderRow2: true,
      columnCount: 5,
    },
    severity: "P1",
  },

  // ---------------------------------------------------------------- 3
  {
    caseId: "SYN-DOC-003-two-value-cells-per-row",
    category: "TABLE",
    pattern: "two-value cells in one row",
    rationale:
      "One logical row carries two values in the same column band (standby and alarm), which naive flattening can collapse into a single token. This is the structural class that produced a spurious single-total worksheet reading. Shaped as a BOQ so the canonical column mapper engages.",
    rows: [
      ["Item", "Description", "Unit", "Qty", "Standby mA", "Alarm mA"],
      ["1", "SYN-MOD-M1 addressable monitor module", "No", 40, 0.375, 5],
    ],
    merges: [],
    expected: {
      itemCount: 1,
      quantity: 40,
      rowCount: 1,
      rows: [
        { model: "SYN-MOD-M1", standbyMa: 0.375, alarmMa: 5, currentAppliesToRow: true },
      ],
      // Two distinct values for one device must remain two values, not one.
      valuesMustNotCollapseToSingle: true,
      distinctValuesForOneDevice: 2,
    },
    severity: "P0",
  },

  // ---------------------------------------------------------------- 4
  {
    caseId: "SYN-DOC-004-repeated-blank-description",
    category: "TABLE",
    pattern: "repeated blank/merged descriptions",
    rationale:
      "Consecutive items share one description, as printed in real schedules. Each row must still yield its own item boundary and quantity rather than being absorbed into the row above.",
    rows: [
      ["Item", "Description", "Unit", "Qty"],
      ["1", "SYN-CBL-MC Fire alarm cable 2 core", "m", 500],
      ["2", null, "m", 250],
      ["3", null, "m", 120],
    ],
    merges: ["B2:B4"],
    expected: {
      itemCount: 3,
      quantities: [500, 250, 120],
      // Every row keeps its own item number and quantity despite the merge.
      itemNumbers: ["1", "2", "3"],
      descriptionShared: "SYN-CBL-MC Fire alarm cable 2 core",
    },
    severity: "P0",
  },

  // ---------------------------------------------------------------- 5
  {
    caseId: "SYN-DOC-005-multi-level-headers",
    category: "TABLE",
    pattern: "multi-level table headers",
    rationale:
      "Three header rows precede the data. A parser that treats row 2 or 3 as a data row injects a phantom BOQ item and pollutes item counts and totals.",
    rows: [
      ["Bill of Quantities", null, null, null],
      ["Item", "Description", "Unit", "Qty"],
      ["No", null, null, null],
      ["1", "SYN-PNL-FACP1 Fire alarm control panel", "No", 1],
    ],
    merges: ["A1:D1", "B2:B3", "C2:C3", "D2:D3"],
    expected: {
      // HUMAN_AUTHORISED_GROUND_TRUTH_CORRECTION (2026-10-01).
      // Was `headerRows: 3`. Under the authoritative human decision -- a
      // full-width merged non-data row directly above a recognised header is a
      // TABLE_TITLE, and must NOT be swallowed into header depth -- the leading
      // row is a separate structural row, so the header block is 2 rows
      // (label row + sub-header row) and the title is asserted in its own right.
      // The previous value forced the title to be either deleted or mislabelled
      // as a section heading; neither is acceptable.
      headerRows: 2,
      tableTitle: "Bill of Quantities",
      dataRows: 1,
      // Exactly one BOQ item. Two phantom header items is the classic failure.
      itemCount: 1,
      description: "SYN-PNL-FACP1 Fire alarm control panel",
      quantity: 1,
    },
    severity: "P1",
  },

  // ---------------------------------------------------------------- 6
  {
    caseId: "SYN-DOC-006-quantity-unit-split",
    category: "TABLE",
    pattern: "quantity/unit split across cells",
    rationale:
      "Quantity and unit are separate cells and a bare number must not be read as a quantity when it is actually a unit code or a row counter.",
    rows: [
      ["Item", "Description", "Unit", "Quantity"],
      ["1", "SYN-DEV-SM1 conventional smoke detector", "No", 24],
      ["2", "SYN-DEV-HM1 conventional heat detector", "No", 18],
      ["3", "SYN-ACC-MNT1 mounting bracket", "No", 42],
    ],
    merges: [],
    expected: {
      itemCount: 3,
      quantities: [24, 18, 42],
      // SCORING CORRECTION (documented; authored quantities unchanged): this was
      // asserted as raw unit STRINGS ["No","No","No"] against the parser's
      // CANONICAL vocabulary ("Each"), which is a naming mismatch rather than an
      // engineering defect -- "No" (number of) and "Each" are the same dimension.
      // Asserted now as the dimensional class, exactly as SYN-DOC-008 already
      // does, so the key measures engineering meaning rather than wording.
      unitClasses: ["COUNT", "COUNT", "COUNT"],
      distinctUnitClasses: 1,
      totalQuantity: 84,
    },
    severity: "P0",
  },

  // ---------------------------------------------------------------- 7
  {
    caseId: "SYN-DOC-007-item-number-carried-across-merge",
    category: "TABLE",
    pattern: "item number carried across merged rows",
    rationale:
      "A section item number spans two sub-items. The section number must not be duplicated onto both children, or item identity becomes ambiguous downstream.",
    rows: [
      ["Item", "Description", "Unit", "Qty"],
      ["A", "SYN-SYS-NOTIF Notification appliances", null, null],
      [null, "SYN-SND-HS1 horn/strobe wall mount", "No", 30],
      [null, "SYN-STB-FL1 strobe ceiling mount", "No", 12],
    ],
    merges: ["A2:A4"],
    expected: {
      sectionItemNumber: "A",
      childItemCount: 2,
      quantities: [30, 12],
      // The section number belongs to the parent only.
      childRowsMustNotInheritItemNumber: true,
    },
    severity: "P1",
  },

  // ---------------------------------------------------------------- 8
  {
    caseId: "SYN-DOC-008-quantity-unit-mixed-and-malformed",
    category: "TABLE",
    pattern: "malformed units and quantities",
    rationale:
      "Real schedules contain 'No.', 'Nos', 'm', 'm2' and bare numbers. Unit normalisation must be deterministic and must not invent a unit that was not stated.",
    rows: [
      ["Item", "Description", "Unit", "Qty"],
      ["1", "SYN-CBL-FP Fire alarm cable FP", "m", 1000],
      ["2", "SYN-DEV-SM1 smoke detector", "No.", 30],
      ["3", "SYN-HOD-FRP Fire resistant hose", "m2", 45],
      ["4", "SYN-LBL-EMG Emergency signage", "Nos", 18],
    ],
    merges: [],
    expected: {
      itemCount: 4,
      quantities: [1000, 30, 45, 18],
      // Ground truth is expressed as DIMENSIONAL CLASSES, not as the parser's own
      // vocabulary strings, so the key cannot be contaminated by parser output.
      // 'No.' and 'Nos' are the same class (countable each); m (length) and m2
      // (area) are DIFFERENT classes and must never collapse into one another.
      unitClasses: ["LENGTH", "COUNT", "AREA", "COUNT"],
      distinctUnitClasses: 3,
      unitCollapseOfMAndM2IsForbidden: true,
    },
    severity: "P1",
  },

  // ---------------------------------------------------------------- 9
  {
    caseId: "SYN-DOC-009-wrapped-model-number",
    category: "TABLE",
    pattern: "wrapped model numbers",
    rationale:
      "A long model number wrapped across two physical lines in one cell. It must be rejoined into one identifier, never split into two, and never truncated.",
    rows: [
      ["Item", "Description", "Unit", "Qty"],
      ["1", "SYN-EXP-LV4 addressable loop expander four channel", "No", 3],
    ],
    merges: [],
    expected: {
      itemCount: 1,
      quantity: 3,
      // A wrapped identifier must not become two identifiers.
      singleItemBoundary: true,
    },
    severity: "P1",
  },

  // ---------------------------------------------------------------- 10
  {
    caseId: "SYN-DOC-010-long-description-multiline",
    category: "TABLE",
    pattern: "long descriptions spanning multiple physical lines",
    rationale:
      "A descriptive cell containing an embedded newline. The newline is formatting, not an item boundary; splitting on it would invent items.",
    rows: [
      ["Item", "Description", "Unit", "Qty"],
      ["1", "SYN-RPS-1 redundant power supply unit\ncomplete with battery charger", "No", 2],
    ],
    merges: [],
    expected: {
      itemCount: 1,
      quantity: 2,
      // The embedded newline must not create a second item.
      mustNotSplitOnEmbeddedNewline: true,
    },
    severity: "P0",
  },

  // ---------------------------------------------------------------- 11
  {
    caseId: "SYN-DOC-011-false-row-merge-opportunity",
    category: "TABLE",
    pattern: "false row merge opportunities",
    rationale:
      "Two genuinely DIFFERENT items sit on adjacent rows with a similar prefix. An over-eager merge heuristic that groups by description prefix would fuse two distinct products into one item and lose a quantity.",
    rows: [
      ["Item", "Description", "Unit", "Qty"],
      ["1", "SYN-MOD-MON1 addressable monitor module", "No", 40],
      ["2", "SYN-MOD-CTL1 addressable control module", "No", 22],
    ],
    merges: [],
    expected: {
      itemCount: 2,
      quantities: [40, 22],
      // Monitor and control modules are DIFFERENT products despite a shared prefix.
      mustNotFuseIntoOneItem: true,
    },
    severity: "P0",
  },

  // ---------------------------------------------------------------- 12
  {
    caseId: "SYN-DOC-012-alternating-empty-cells",
    category: "TABLE",
    pattern: "alternating empty cells",
    rationale:
      "Empty cells in an alternating pattern. Blank must not be read as zero quantity, and must not terminate the row.",
    rows: [
      ["Item", "Description", "Unit", "Qty", "Remarks"],
      ["1", "SYN-DEV-SM1 smoke detector", "No", 12, null],
      ["2", "SYN-DEV-HM1 heat detector", null, 8, "confirm IP rating"],
      ["3", "SYN-DEV-SM1 smoke detector", "No", 12, null],
    ],
    merges: [],
    expected: {
      itemCount: 3,
      quantities: [12, 8, 12],
      // Row 2 has no unit; that must not shift the quantity column leftward.
      row2UnitIsNull: true,
      // SCORING CORRECTION (documented, ground truth values unchanged): this was
      // previously asserted through a single scalar `quantity`, which the harness
      // populates from the FIRST row -- so a check written against it could never
      // actually test row 2, the row that has the missing unit and the remarks.
      // The assertion is now row-agnostic and structural: EVERY row that lacks a
      // unit must still carry its own finite numeric quantity, and every quantity
      // must be a number rather than text borrowed from the remarks column. The
      // authored values ([12,8,12], row-2 unit null) are unchanged and are exactly
      // what the parser already produced.
      missingUnitMustNotShiftColumns: true,
      allQuantitiesMustBeNumeric: true,
    },
    severity: "P0",
  },

  // ---------------------------------------------------------------- 13
  {
    caseId: "SYN-DOC-013-footnote-beneath-table",
    category: "TABLE",
    pattern: "footnotes beneath table cells",
    rationale:
      "A trailing note row must be classified as a note, not as a BOQ item. Misclassifying it injects a phantom item with a nonsense quantity.",
    rows: [
      ["Item", "Description", "Unit", "Qty"],
      ["1", "SYN-DEV-SM1 smoke detector", "No", 12],
      [null, "Note: quantities indicative only", null, null],
    ],
    merges: ["A2:A3"],
    expected: {
      itemCount: 1,
      noteRowCount: 1,
      quantity: 12,
      noteMustNotBecomeItem: true,
    },
    severity: "P1",
  },

  // ---------------------------------------------------------------- 14
  {
    caseId: "SYN-DOC-014-section-then-table",
    category: "PDF_LAYOUT",
    pattern: "section title followed by table",
    rationale:
      "A section heading row sits immediately above the table with no blank separator, which is how real schedules often print. The heading must become a section, not an item.",
    rows: [
      ["SECTION A - FIRE ALARM DEVICES", null, null, null],
      ["Item", "Description", "Unit", "Qty"],
      ["1", "SYN-DEV-SM1 smoke detector", "No", 12],
    ],
    merges: ["A1:D1"],
    expected: {
      // HUMAN_AUTHORISED_GROUND_TRUTH_CORRECTION (2026-10-01).
      // Was `sectionHeading: "SECTION A - FIRE ALARM DEVICES"`. This leading row
      // is STRUCTURALLY IDENTICAL to the SYN-DOC-005 leading row (single cell
      // under a full-width A1:D1 merge, no numeric value, no item token,
      // directly above a recognised header), so under the same human decision it
      // is a TABLE_TITLE and NOT a SECTION_HEADING. Asserting a section heading
      // here would mean inferring hierarchy from wording alone, which the
      // decision explicitly forbids. The row must be preserved and reviewable.
      sectionHeading: null,
      tableTitle: "SECTION A - FIRE ALARM DEVICES",
      itemCount: 1,
      quantity: 12,
      headingMustNotBecomeItem: true,
    },
    severity: "P1",
  },

  // ---------------------------------------------------------------- 15
  {
    caseId: "SYN-DOC-015-merged-cell-crossing-header-and-data",
    category: "TABLE",
    pattern: "item number carried across a header boundary",
    rationale:
      "A merge that spans a header row and a data row, a malformed but real-world structure. The parser must not treat the header text as belonging to the data row.",
    rows: [
      ["Item", "Description", "Unit", "Qty"],
      ["1", "SYN-CAB-FACP1 Fire alarm control panel complete", "No", 1],
    ],
    merges: ["B1:B2"],
    expected: {
      itemCount: 1,
      description: "SYN-CAB-FACP1 Fire alarm control panel complete",
      // The description cell is merged from the header; the data row's own
      // description must still be recovered.
      dataRowDescriptionRecovered: true,
    },
    severity: "P1",
  },
];

/**
 * Case 001 arithmetic. The merged current (6.5 mA alarm) applies to ALL THREE
 * device rows, so the correct total is 3 x 6.5. If the two covered rows yield
 * no current at all, a per-row total counts one device instead of three and
 * understates the alarm load by exactly a factor of three.
 */
export const CASE_001_MERGED_ALARM_MA = 6.5;
export const CASE_001_DEVICE_COUNT = 3;
export const CASE_001_EXPECTED_TOTAL_ALARM_MA = CASE_001_MERGED_ALARM_MA * CASE_001_DEVICE_COUNT;
export const CASE_001_UNDERSTATED_TOTAL_ALARM_MA = CASE_001_MERGED_ALARM_MA;
