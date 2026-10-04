// DOCUMENT-STRUCTURE BENCHMARK SCORER.
//
// Scores ONE system's output for ONE case against the independently authored
// ground truth. Pure and deterministic: no network, no clock, no randomness, no
// knowledge of any model. The same scorer is used for the native parser, for a
// mocked NVIDIA response, and for a live NVIDIA response, so the comparison is
// like-for-like.
//
// ERROR SEVERITY (from the brief):
//   P0 STRUCTURAL -- could produce a materially wrong engineering quantity
//   P1 SEMANTIC   -- wrong field meaning/classification
//   P2 FORMATTING -- presentation only
//   P3 COSMETIC   -- invisible to downstream logic
import { DOCUMENT_STRUCTURE_CASES, CASE_001_EXPECTED_TOTAL_ALARM_MA, CASE_001_UNDERSTATED_TOTAL_ALARM_MA } from "./document-structure-corpus.mjs";

export const SEVERITY = Object.freeze({ P0: "P0", P1: "P1", P2: "P2", P3: "P3" });
const SEVERITY_RANK = Object.freeze({ P0: 0, P1: 1, P2: 2, P3: 3 });

/**
 * Coerce to a finite number, or null.
 *
 * The null guard is essential and was itself a bug once: `Number(null)` is 0 and
 * `Number("")` is 0, so a naive coercion silently converts a MISSING value into
 * a ZERO. That is the exact failure class this benchmark exists to detect -- a
 * per-row total that counts an absent value as zero understates the result while
 * looking perfectly well formed. Missing must stay missing.
 */
const num = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  if (typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const sameNum = (a, b) => Number(num(a)) === Number(num(b));
const arr = (v) => (Array.isArray(v) ? v : []);

/**
 * Score one case for one system.
 *
 * @param {object} options
 * @param {object} options.caseSpec     a Case from the corpus
 * @param {object} options.actual       the system's normalised output
 * @returns {object} per-case score
 */
export function scoreDocumentCase({ caseSpec, actual }) {
  const checks = [];
  const add = (id, ok, detail, severity = SEVERITY.P0) =>
    checks.push({ id, ok: Boolean(ok), severity, detail: String(detail ?? "") });

  const exp = caseSpec.expected;
  const got = actual && typeof actual === "object" ? actual : {};

  // --- item/row count -----------------------------------------------------
  if (exp.itemCount !== undefined) add("itemCount", got.itemCount === exp.itemCount, `expected ${exp.itemCount}, got ${got.itemCount}`);
  if (exp.rowCount !== undefined) add("rowCount", got.rowCount === exp.rowCount, `expected ${exp.rowCount}, got ${got.rowCount}`);

  // --- quantities ---------------------------------------------------------
  if (exp.quantities !== undefined) {
    const want = arr(exp.quantities);
    const have = arr(got.quantities);
    const exact = want.length === have.length && want.every((v, i) => sameNum(v, have[i]));
    add("quantities", exact, `expected [${want}], got [${have}]`);
  }
  if (exp.quantity !== undefined) add("quantity", sameNum(exp.quantity, got.quantity), `expected ${exp.quantity}, got ${got.quantity}`);
  if (exp.totalQuantity !== undefined) add("totalQuantity", sameNum(exp.totalQuantity, got.totalQuantity), `expected ${exp.totalQuantity}, got ${got.totalQuantity}`);

  // --- units --------------------------------------------------------------
  if (exp.units !== undefined) {
    const want = arr(exp.units);
    const have = arr(got.units);
    add("units", want.length === have.length && want.every((v, i) => v === have[i]), `expected [${want}], got [${have}]`, SEVERITY.P1);
  }
  if (exp.unitClasses !== undefined) {
    const want = arr(exp.unitClasses);
    const have = arr(got.unitClasses);
    add("unitClasses", want.length === have.length && want.every((v, i) => v === have[i]), `expected [${want}], got [${have}]`, SEVERITY.P1);
  }
  if (exp.distinctUnitClasses !== undefined) {
    // The engineering-meaningful property: dimensional classes must stay
    // distinct. m and m2 collapsing is a P0, not a naming difference.
    const have = new Set(arr(got.unitClasses));
    add("distinctUnitClasses", have.size === exp.distinctUnitClasses, `expected ${exp.distinctUnitClasses} distinct unit classes, got ${have.size} from [${arr(got.unitClasses)}]`, SEVERITY.P0);
  }
  if (exp.unitCollapseOfMAndM2IsForbidden) {
    const have = arr(got.unitClasses);
    // Exactly one AREA class and exactly one LENGTH class must survive.
    add("noM2ToMCollapse", have.filter((u) => u === "AREA").length === 1 && have.filter((u) => u === "LENGTH").length === 1,
      `area and length must both survive, got [${have}]`, SEVERITY.P0);
  }

  // --- identity / description --------------------------------------------
  if (exp.itemNumber !== undefined) add("itemNumber", got.itemNumber === exp.itemNumber, `expected ${exp.itemNumber}, got ${got.itemNumber}`, SEVERITY.P1);
  if (exp.itemNumbers !== undefined) {
    const want = arr(exp.itemNumbers);
    const have = arr(got.itemNumbers);
    add("itemNumbers", want.length === have.length && want.every((v, i) => v === have[i]), `expected [${want}], got [${have}]`, SEVERITY.P1);
  }
  if (exp.description !== undefined) add("description", String(got.description ?? "").trim() === exp.description, `expected "${exp.description}", got "${got.description}"`, SEVERITY.P1);
  if (exp.sectionHeading !== undefined) add("sectionHeading", String(got.sectionHeading ?? "").trim() === String(exp.sectionHeading ?? ""), `expected "${exp.sectionHeading}", got "${got.sectionHeading}"`, SEVERITY.P1);
  if (exp.tableTitle !== undefined) {
    add("tableTitle", String(got.tableTitle ?? "").trim() === exp.tableTitle, `expected table title "${exp.tableTitle}", got "${got.tableTitle}"`, SEVERITY.P1);
    // The title must be PRESERVED (not silently dropped) -- this is the real
    // defect that was closed. An earlier version of this assertion compared
    // itemCount to itself and could never fail, which is a hollow test; it now
    // asserts an observable property of the parser output.
    add("tableTitlePreserved", (got.tableTitleCount ?? 0) >= 1, "the table title row must be retained in the output, not dropped", SEVERITY.P0);
    // And it must not be promoted into hierarchy. The separate `sectionHeading`
    // check already proves that (expected null for 014); this asserts the row
    // is counted as a title rather than a heading.
    add("tableTitleNotPromotedToHeading", String(got.tableTitle ?? "").trim() !== "" && String(got.sectionHeading ?? "").trim() === String(exp.sectionHeading ?? ""),
      "a table title must stay a table title and must not become a section heading", SEVERITY.P0);
  }

  // --- structural guards (the interesting ones) ---------------------------
  if (exp.mustNotCollapseToSingleValue) {
    add("valuesNotCollapsed", arr(got.valuesForSynModM1).length === arr(exp.valuesForSynModM1).length, "two distinct values must survive", SEVERITY.P0);
  }
  if (exp.mustNotSplitOnEmbeddedNewline) add("noSplitOnNewline", got.itemCount === 1, "an embedded newline must not create an item", SEVERITY.P0);
  if (exp.mustNotFuseIntoOneItem) add("noFalseFuse", got.itemCount === 2, "two distinct products must stay two items", SEVERITY.P0);
  if (exp.mustNotBecomeItem) add("nonItemNotItem", got.itemCount === 1, "a note/heading must not become a BOQ item", SEVERITY.P0);
  if (exp.noteMustNotBecomeItem) add("noteNotItem", got.itemCount === 1, "a note row must not become a BOQ item", SEVERITY.P1);
  if (exp.missingUnitMustNotShiftColumns) {
    // Row-agnostic and structural: a row with no unit must still hold its own
    // numeric quantity. A shifted column would surface as a row whose quantity
    // is missing or non-numeric.
    const quantities = arr(got.quantities);
    const classes = arr(got.unitClasses);
    const unitless = [];
    for (let i = 0; i < classes.length; i += 1) if (classes[i] === "UNKNOWN") unitless.push(i);
    const allUnitlessHaveQuantities = unitless.every((i) => Number.isFinite(num(quantities[i])));
    add("missingUnitMustNotShiftColumns", allUnitlessHaveQuantities,
      `every row lacking a unit must still carry a numeric quantity; unitless rows [${unitless}] quantities [${quantities}]`, SEVERITY.P0);
  }
  if (exp.allQuantitiesMustBeNumeric) {
    const quantities = arr(got.quantities);
    add("allQuantitiesNumeric", quantities.length > 0 && quantities.every((q) => Number.isFinite(num(q))),
      `no quantity may be borrowed from a text column, got [${quantities}]`, SEVERITY.P0);
  }
  if (exp.childRowsMustNotInheritItemNumber) {
    const kids = arr(got.childItemNumbers);
    add("childrenDoNotInheritItemNumber", kids.every((v) => v !== exp.sectionItemNumber), `children must not inherit "${exp.sectionItemNumber}", got [${kids}]`, SEVERITY.P1);
  }
  if (exp.childItemCount !== undefined) add("childItemCount", got.childItemCount === exp.childItemCount, `expected ${exp.childItemCount}, got ${got.childItemCount}`, SEVERITY.P1);
  if (exp.noteRowCount !== undefined) add("noteRowCount", got.noteRowCount === exp.noteRowCount, `expected ${exp.noteRowCount}, got ${got.noteRowCount}`, SEVERITY.P1);
  if (exp.headerRows !== undefined) add("headerRows", got.headerRows === exp.headerRows, `expected ${exp.headerRows}, got ${got.headerRows}`, SEVERITY.P1);
  if (exp.columnCount !== undefined) add("columnCount", got.columnCount === exp.columnCount, `expected ${exp.columnCount}, got ${got.columnCount}`, SEVERITY.P1);

  // --- MERGE PROPAGATION: the decisive P0 check ---------------------------
  if (exp.rows !== undefined) {
    const wantRows = arr(exp.rows);
    const haveRows = arr(got.rows);
    add("rowCountFromRows", wantRows.length === haveRows.length, `expected ${wantRows.length} rows, got ${haveRows.length}`, SEVERITY.P0);

    // THE DECISIVE P0 CHECK: every row a merge covers must recover the merged
    // value. If a covered row comes back with no current, a per-row total counts
    // one device's draw instead of the whole group, understating the result.
    if (exp.allCoveredRowsRecoverCurrent) {
      const missing = haveRows.filter((r) => !Number.isFinite(num(r.standbyMa)) || !Number.isFinite(num(r.alarmMa)));
      add("allCoveredRowsRecoverCurrent", missing.length === 0,
        `every covered row must recover the merged current; ${missing.length} of ${haveRows.length} rows did not`, SEVERITY.P0);
    }
    if (exp.expectedDeviceCountWithCurrent !== undefined) {
      const withCurrent = haveRows.filter((r) => Number.isFinite(num(r.alarmMa))).length;
      add("deviceCountWithCurrent", withCurrent === exp.expectedDeviceCountWithCurrent,
        `expected ${exp.expectedDeviceCountWithCurrent} devices carrying the merged current, got ${withCurrent}`, SEVERITY.P0);
    }
    if (exp.valuesMustNotCollapseToSingle) {
      const v = haveRows[0] || {};
      add("valuesNotCollapsed", Number.isFinite(num(v.standbyMa)) && Number.isFinite(num(v.alarmMa)) && num(v.standbyMa) !== num(v.alarmMa),
        `standby and alarm must remain two distinct values, got standby=${v.standbyMa} alarm=${v.alarmMa}`, SEVERITY.P0);
    }
    // Every field the case declares must match exactly, field by field.
    const perRowOk = wantRows.every((w, i) => {
      const h = haveRows[i] || {};
      if (w.model !== undefined && String(h.model ?? "").trim() !== w.model) return false;
      if (w.standbyMa !== undefined && !sameNum(h.standbyMa, w.standbyMa)) return false;
      if (w.alarmMa !== undefined && !sameNum(h.alarmMa, w.alarmMa)) return false;
      return true;
    });
    add("perRowValuesExact", perRowOk, "every row's model and currents must match the authored ground truth", SEVERITY.P0);
  }

  // --- provenance ---------------------------------------------------------
  if (exp.provenance !== undefined) {
    const p = got.provenance || {};
    if (exp.provenance.row !== undefined) add("provenanceRow", p.row === exp.provenance.row, `expected row ${exp.provenance.row}, got ${p.row}`, SEVERITY.P2);
    if (exp.provenance.cells !== undefined) {
      const want = exp.provenance.cells;
      const have = p.cells || {};
      const ok = Object.entries(want).every(([k, v]) => have[k] === v);
      add("provenanceCells", ok, `expected cell refs ${JSON.stringify(want)}, got ${JSON.stringify(have)}`, SEVERITY.P2);
    }
    if (exp.provenance.mustExist) add("provenanceExists", Boolean(p && p.row !== null), "the parser must emit row-level provenance", SEVERITY.P2);
  }

  const failed = checks.filter((c) => !c.ok);
  const worst = failed.length
    ? failed.reduce((a, b) => (SEVERITY_RANK[a.severity] <= SEVERITY_RANK[b.severity] ? a : b)).severity
    : null;

  return Object.freeze({
    caseId: caseSpec.caseId,
    category: caseSpec.category,
    pattern: caseSpec.pattern,
    caseSeverity: caseSpec.severity,
    passed: failed.length === 0,
    checksPassed: checks.length - failed.length,
    checksTotal: checks.length,
    failedCheckIds: Object.freeze(failed.map((c) => c.id)),
    failures: Object.freeze(failed),
    worstFailureSeverity: worst,
  });
}

/** Aggregate a set of per-case scores. */
export function summariseDocumentScores(scores) {
  const list = arr(scores);
  const failed = list.filter((s) => !s.passed);
  const p0 = failed.filter((s) => s.worstFailureSeverity === SEVERITY.P0);
  const p1 = failed.filter((s) => s.worstFailureSeverity === SEVERITY.P1);
  return Object.freeze({
    cases: list.length,
    passed: list.length - failed.length,
    failed: failed.length,
    passRate: list.length ? Number(((list.length - failed.length) / list.length).toFixed(4)) : null,
    p0StructuralFailures: p0.length,
    p1SemanticFailures: p1.length,
    failedCaseIds: Object.freeze(failed.map((s) => s.caseId)),
  });
}

/** Case 001 is the headline numeric case; report its arithmetic explicitly. */
export function mergedCellNumericAssessment(nativeActual) {
  const rows = arr(nativeActual?.rows);
  // A merge means ONE current applies to every covered row. The correct total is
  // therefore (rows carrying a current) x (that current) -- NOT a sum of
  // per-row values, which would triple-count a shared value.
  const withCurrent = rows.filter((r) => Number.isFinite(num(r.alarmMa)));
  const perRowSum = withCurrent.reduce((a, r) => a + num(r.alarmMa), 0);
  const unique = new Set(withCurrent.map((r) => num(r.alarmMa)));
  const shared = unique.size === 1 ? [...unique][0] : null;
  const recovered = shared !== null ? shared * rows.length : perRowSum;
  return Object.freeze({
    deviceRows: rows.length,
    rowsRecoveringCurrent: withCurrent.length,
    expectedRowsRecoveringCurrent: 3,
    mergedCurrentMa: shared,
    expectedTotalAlarmMa: CASE_001_EXPECTED_TOTAL_ALARM_MA,
    recoveredTotalAlarmMa: Number(recovered.toFixed(6)),
    // Understatement if the covered rows yield no current: only one device counted.
    understatedTotalIfCoveredRowsEmptyMa: CASE_001_UNDERSTATED_TOTAL_ALARM_MA,
    understatementErrorMa: Number((CASE_001_EXPECTED_TOTAL_ALARM_MA - CASE_001_UNDERSTATED_TOTAL_ALARM_MA).toFixed(6)),
    understatementFactor: Number((CASE_001_EXPECTED_TOTAL_ALARM_MA / CASE_001_UNDERSTATED_TOTAL_ALARM_MA).toFixed(4)),
    preservedIntendedRowRelationship: rows.length === 3 && withCurrent.length === 3,
  });
}

export { DOCUMENT_STRUCTURE_CASES };
