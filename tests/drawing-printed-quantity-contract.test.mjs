import test from "node:test";
import assert from "node:assert/strict";
import {
  DRAWING_PRINTED_QUANTITY_CONTRACT_VERSION,
  parsePrintedQuantityText,
  buildPrintedQuantityRow,
  resolveRowDeviceQuantity,
  summariseDrawingPrintedQuantity,
  evaluateDrawingQuantityRequest,
  recogniseOccurrenceCountMetric,
  compareOccurrenceCountToPrintedQuantity,
  NO_PRINTED_QUANTITY_AUTHORITY,
} from "../app/domain/drawing-printed-quantity-contract.mjs";

// DRAW-QTY-1 (2026-09-27): acceptance cases for the canonical printed-quantity
// contract.
//
// The fixture numbers are REAL, not invented. They are the 36 printed count
// cells of the reviewed WLC T-93 riser sheet, read from that PDF's text layer,
// which total 248 devices -- against 27 approved recognition occurrences on
// the governed surface. Those 27 are 27 printed ROWS, not 27 devices, and
// that gap is the entire reason this contract exists.

const WLC = "doc_3a7c645e-08b2-49b0-822c-3036a0da439f";
const WLC_VERSION = "ver_7be5e0e0-wlc";
const WLC_SHEET = "WLC T-93";

// The 36 printed count cells, in sheet order.
const WLC_PRINTED_COUNTS = [
  2, 2, 2, 2, 2, 2, 3, 2, 2, 1, 3, 1, 1, 7, 8, 9, 38, 6, 36, 32, 1, 2, 5, 2, 16, 1, 6, 2, 24, 6, 6, 7, 2, 2, 1, 4,
];
const WLC_PRINTED_TOTAL = 248; // asserted below, not assumed
const WLC_APPROVED_OCCURRENCES = 27;

const simpleRow = (over = {}) =>
  buildPrintedQuantityRow({
    sourceDocumentId: WLC,
    sourceDocumentVersionId: WLC_VERSION,
    pageNumber: 1,
    sheetKey: WLC_SHEET,
    rowKey: "row-simple",
    printedQuantityText: "12 Nos",
    compositionTokens: ["S"],
    classKeys: ["S"],
    recognitionState: "APPROVED",
    occurrenceIds: ["occ-1"],
    governing: true,
    ...over,
  });

// ===========================================================================
// Parsing a printed count
// ===========================================================================

test("a printed count is parsed verbatim, and only when it is a plain printed device count", () => {
  assert.deepEqual(parsePrintedQuantityText("36 Nos"), { raw: "36 Nos", value: 36 });
  assert.deepEqual(parsePrintedQuantityText("1 No"), { raw: "1 No", value: 1 });
  assert.deepEqual(parsePrintedQuantityText("12"), { raw: "12", value: 12 });
  assert.deepEqual(parsePrintedQuantityText("  8  QTY "), { raw: "8  QTY", value: 8 });

  // Nothing is coerced or approximated. These must all fail to parse.
  for (const bad of ["", "   ", "LOT 4", "3 Nos (2 SHS)", "2x", "2.5", "N/A", null, undefined, 36]) {
    assert.equal(parsePrintedQuantityText(bad), null, `must not parse ${JSON.stringify(bad)}`);
  }
});

test("a row whose printed text and printed number disagree is unparseable, never silently resolved", () => {
  const row = buildPrintedQuantityRow({ rowKey: "r", printedQuantityText: "36 Nos", printedQuantity: 12, compositionTokens: ["S"], classKeys: ["S"] });
  assert.equal(row.quantityState, "PRINTED_QUANTITY_UNPARSEABLE");
  assert.equal(row.printedQuantity, null, "a disagreement must not resolve to either number");
  assert.equal(row.quantityAuthority, "NONE");
});

// ===========================================================================
// CASE A -- simple printed row
// ===========================================================================

test("CASE A: a simple printed row S -> 12 Nos retains class, printed 12, and full provenance", () => {
  const row = simpleRow();
  assert.equal(row.contractVersion, DRAWING_PRINTED_QUANTITY_CONTRACT_VERSION);
  assert.equal(row.printedQuantityText, "12 Nos", "the printed text survives verbatim");
  assert.equal(row.printedQuantity, 12);
  assert.equal(row.quantityAuthority, "PRINTED_DRAWING");
  assert.equal(row.composition.state, "SINGLE_CLASS");
  assert.deepEqual(row.composition.printedTokens, ["S"]);
  assert.equal(row.identityState, "CLASS_RESOLVED");
  // Traceability: which document, which version, which page, which row.
  assert.equal(row.sourceDocumentId, WLC);
  assert.equal(row.sourceDocumentVersionId, WLC_VERSION);
  assert.equal(row.pageNumber, 1);
  assert.equal(row.rowKey, "row-simple");
  assert.equal(row.sheetKey, WLC_SHEET);
  assert.deepEqual(row.occurrenceIds, ["occ-1"]);

  const resolved = resolveRowDeviceQuantity(row);
  assert.equal(resolved.available, true);
  assert.equal(resolved.promotable, true, "an approved, governing, single-class row is promotable");
  assert.equal(resolved.quantity, 12);
  assert.equal(resolved.authority, "PRINTED_DRAWING");
  assert.equal(resolved.blockers.length, 0);
});

// ===========================================================================
// CASE B -- occurrence count vs printed quantity
// ===========================================================================

test("CASE B: one approved row occurrence whose row prints 25 Nos yields count 1 and printed quantity 25", () => {
  const row = simpleRow({ rowKey: "row-7-strobe", printedQuantityText: "25 Nos", compositionTokens: ["S"], classKeys: ["S"] });
  const resolved = resolveRowDeviceQuantity(row);

  // The recognition metric and the device quantity are two different numbers.
  assert.equal(row.occurrenceIds.length, 1, "exactly one occurrence: the row itself");
  assert.equal(resolved.quantity, 25, "and the row prints 25 devices");

  const metric = recogniseOccurrenceCountMetric(1);
  assert.equal(metric.approvedOccurrenceCount, 1);
  assert.equal(metric.isDeviceQuantity, false);
  assert.equal(metric.quantityAuthority, "NONE");
  assert.equal(metric.unit, "approved_occurrences", "the count carries no device unit");

  // A count and a printed total can never be declared equal: they measure
  // different things, so alignment is not determinable, not "aligned".
  const comparison = compareOccurrenceCountToPrintedQuantity({ approvedOccurrenceCount: 1, summary: { printedTotalDeviceCount: 25 } });
  assert.equal(comparison.alignment, "NOT_DETERMINABLE");
  assert.equal(comparison.approvedOccurrenceCount, 1);
  assert.equal(comparison.printedTotalDeviceCount, 25);
});

test("the reviewed sheet's real totals: 27 approved occurrences against 248 printed devices", () => {
  const rows = WLC_PRINTED_COUNTS.map((value, index) =>
    simpleRow({ rowKey: `wlc-${index}`, printedQuantityText: `${value} Nos`, compositionTokens: ["S"], classKeys: ["S"] }),
  );
  const summary = summariseDrawingPrintedQuantity({ rows, sheetKey: WLC_SHEET });
  assert.equal(WLC_PRINTED_COUNTS.length, 36, "the reviewed sheet prints 36 count cells");
  assert.equal(WLC_PRINTED_COUNTS.reduce((a, b) => a + b, 0), WLC_PRINTED_TOTAL, "which total 248 devices");
  assert.equal(summary.printedTotalDeviceCount, 248);

  // The recognition surface holds 27 approved occurrences. Against a printed
  // 248, using the count as a quantity is a ~9x understatement.
  const metric = recogniseOccurrenceCountMetric(WLC_APPROVED_OCCURRENCES);
  assert.equal(metric.approvedOccurrenceCount, 27);
  assert.equal(metric.isDeviceQuantity, false);
  assert.ok(248 / 27 > 8, "the printed total is more than eight times the occurrence count");
});

// ===========================================================================
// CASE C -- composite row
// ===========================================================================

test("CASE C: a composite row S + CM -> 24 Nos preserves its composition and 24, and never becomes two 24s", () => {
  // The printed run on the sheet is a SINGLE text-showing operation carrying
  // more than one class, so its composition is one printed fact.
  const row = buildPrintedQuantityRow({
    sourceDocumentId: WLC, sourceDocumentVersionId: WLC_VERSION, pageNumber: 1,
    sheetKey: WLC_SHEET, rowKey: "row-s-cm",
    printedQuantityText: "24 Nos", compositionTokens: ["S", "CM"], classKeys: null,
    recognitionState: "APPROVED", occurrenceIds: ["occ-sc"], governing: true,
  });

  assert.deepEqual(row.composition.printedTokens, ["S", "CM"], "the printed composition survives in order");
  assert.deepEqual(row.composition.distinctClasses, ["S", "CM"]);
  assert.equal(row.composition.state, "COMPOSITE_SEMANTICS_UNRESOLVED");
  assert.equal(row.printedQuantity, 24, "the printed quantity attaches to the whole printed composition");
  assert.equal(row.quantityAuthority, "PRINTED_DRAWING");

  // It is NOT decomposed, so no per-class quantity may be produced.
  assert.equal(row.decomposition, null);
  const resolved = resolveRowDeviceQuantity(row);
  assert.equal(resolved.available, false, "no per-class device quantity exists for an unresolved composite");
  assert.equal(resolved.quantity, null);
  assert.ok(resolved.blockers.some((b) => b.code === "COMPOSITION_UNRESOLVED"));

  // The summary must neither fan the row out to its tokens nor drop it.
  const summary = summariseDrawingPrintedQuantity({ rows: [row], sheetKey: WLC_SHEET });
  assert.equal(summary.printedTotalDeviceCount, 24, "the printed 24 is still counted at row level");
  assert.equal(summary.perClass.length, 0, "and attributed to no class at all");
  assert.equal(summary.unresolved.length, 1);
  assert.equal(summary.unresolved[0].reason, "COMPOSITION_UNRESOLVED");
  assert.equal(summary.unresolved[0].printedQuantity, 24);
  assert.equal(summary.deviceQuantityAvailable, false);
  assert.equal(
    summary.perClass.reduce((sum, entry) => sum + entry.printedQuantity, 0) + summary.unresolved.reduce((sum, e) => sum + e.printedQuantity, 0),
    24,
    "every printed device is accounted for exactly once -- neither duplicated across tokens nor lost",
  );
});

test("a composite row only decomposes under an explicit governed ruling that reconciles with the printed total", () => {
  const base = {
    sourceDocumentId: WLC, sourceDocumentVersionId: WLC_VERSION, pageNumber: 1,
    sheetKey: WLC_SHEET, rowKey: "row-s-h-fce", printedQuantityText: "36 Nos",
    compositionTokens: ["S", "H", "FCE"], recognitionState: "APPROVED", governing: true,
  };

  // Two independent ways a proposed split can be wrong. Both are refused, and
  // the row falls back to UNRESOLVED rather than propagating a bad split.
  const missingToken = buildPrintedQuantityRow({ ...base, decomposition: { state: "GOVERNED_DECOMPOSED", perClass: [{ classKey: "S", quantity: 18 }, { classKey: "H", quantity: 18 }], decidedBy: "engineer1", reason: "Split without accounting for FCE." } });
  assert.equal(missingToken.composition.state, "COMPOSITE_SEMANTICS_UNRESOLVED", "a split that omits a printed token is not a decomposition");
  assert.equal(missingToken.decomposition, null);

  const wrongSum = buildPrintedQuantityRow({ ...base, decomposition: { state: "GOVERNED_DECOMPOSED", perClass: [{ classKey: "S", quantity: 20 }, { classKey: "H", quantity: 20 }, { classKey: "FCE", quantity: 20 }], decidedBy: "engineer1", reason: "Split that does not reconcile with the printed row." } });
  assert.equal(wrongSum.composition.state, "COMPOSITE_SEMANTICS_UNRESOLVED", "a split that does not sum to the printed row is not a decomposition");
  assert.equal(wrongSum.decomposition, null);

  // An equal-but-arbitrary split that DOES reconcile is structurally accepted
  // -- the contract validates arithmetic and coverage, and attributes the
  // ruling. It does not second-guess an engineer who reconciled correctly;
  // that judgement is the engineer's, recorded in decidedBy/reason.
  const equal = buildPrintedQuantityRow({ ...base, decomposition: { state: "GOVERNED_DECOMPOSED", perClass: [{ classKey: "S", quantity: 12 }, { classKey: "H", quantity: 12 }, { classKey: "FCE", quantity: 12 }], decidedBy: "engineer1", reason: "Even split confirmed against the riser convention." } });
  assert.equal(equal.composition.state, "COMPOSITE_GOVERNED_DECOMPOSED");
  assert.equal(equal.decomposition.decidedBy, "engineer1");

  // One that covers every printed token and sums exactly is accepted.
  const good = buildPrintedQuantityRow({ ...base, decomposition: { state: "GOVERNED_DECOMPOSED", perClass: [{ classKey: "S", quantity: 6 }, { classKey: "H", quantity: 6 }, { classKey: "FCE", quantity: 24 }], decidedBy: "engineer1", reason: "Riser convention confirmed by the designer: each printed unit contains one S, one H, one FCE." } });
  assert.equal(good.composition.state, "COMPOSITE_GOVERNED_DECOMPOSED");
  assert.equal(good.printedQuantity, 36, "the printed row quantity is still the printed row quantity");
  assert.equal(good.decomposition.perClass.reduce((s, e) => s + e.quantity, 0), 36);
  const resolved = resolveRowDeviceQuantity(good);
  assert.equal(resolved.available, true);
  assert.equal(resolved.basis, "PRINTED_DRAWING_GOVERNED_DECOMPOSITION");
  assert.equal(good.decomposition.decidedBy, "engineer1", "the ruling is attributed, not anonymous");
});

// ===========================================================================
// CASE D -- rejected recognition, quantity preserved
// ===========================================================================

test("CASE D: a rejected row keeps its printed 25 Nos as non-promoted drawing evidence", () => {
  // The row-7 strobe recognition disposition stands: rejected. The printed
  // count on that same row is still a real printed fact.
  const row = simpleRow({
    rowKey: "row-7-strobe", printedQuantityText: "25 Nos",
    compositionTokens: ["S"], classKeys: ["S"],
    recognitionState: "REJECTED", occurrenceIds: ["occ-rejected"],
  });

  const resolved = resolveRowDeviceQuantity(row);
  assert.equal(resolved.available, true, "the printed count survives a recognition rejection");
  assert.equal(resolved.quantity, 25);
  assert.equal(resolved.promotable, false, "but a rejected row is never promoted to a commercial quantity");

  const summary = summariseDrawingPrintedQuantity({ rows: [row], sheetKey: WLC_SHEET });
  assert.equal(summary.printedTotalDeviceCount, 25);
  assert.equal(summary.promotablePrintedTotal, 0, "nothing is promotable from a rejected row");

  // And the row is genuinely not selectable.
  const gate = evaluateDrawingQuantityRequest({ rows: [row], approvedOccurrenceCount: 0, sheetKey: WLC_SHEET });
  assert.equal(gate.ok, false, "a rejected-only row cannot authorize a quantity");
  assert.equal(gate.quantity, null);
});

// ===========================================================================
// CASE E -- quantity known, identity unresolved
// ===========================================================================

test("CASE E: 4 uncaptured devices are representable as a known quantity with an unresolved identity and no fabricated class", () => {
  // Two printed count cells on the reviewed sheet -- 3 Nos and 1 No -- have
  // full vector artwork and no text tag, so recognition never produced an
  // occurrence for them. The count is known; the class is not.
  const untagged3 = buildPrintedQuantityRow({
    sourceDocumentId: WLC, sourceDocumentVersionId: WLC_VERSION, pageNumber: 1,
    sheetKey: WLC_SHEET, rowKey: "untagged-3", printedQuantityText: "3 Nos",
    compositionTokens: [], classKeys: null,
    recognitionState: "NO_OCCURRENCE", occurrenceIds: [], governing: true,
  });
  const untagged1 = buildPrintedQuantityRow({
    sourceDocumentId: WLC, sourceDocumentVersionId: WLC_VERSION, pageNumber: 1,
    sheetKey: WLC_SHEET, rowKey: "untagged-1", printedQuantityText: "1 No",
    compositionTokens: [], classKeys: null,
    recognitionState: "NO_OCCURRENCE", occurrenceIds: [], governing: true,
  });

  for (const row of [untagged3, untagged1]) {
    assert.equal(row.printedQuantity, row.printedQuantityText === "3 Nos" ? 3 : 1, "the quantity is known");
    assert.equal(row.identityState, "IDENTITY_UNRESOLVED", "the identity is honestly unresolved");
    assert.equal(row.recognitionState, "NO_OCCURRENCE");
    assert.deepEqual(row.composition.printedTokens, [], "no class is invented");
    assert.equal(row.composition.state, "COMPOSITION_ABSENT");
    const resolved = resolveRowDeviceQuantity(row);
    assert.equal(resolved.available, false, "an unresolved identity cannot authorize a quantity");
    assert.equal(resolved.quantity, null);
    assert.ok(resolved.blockers.some((b) => b.code === "IDENTITY_UNRESOLVED"));
    assert.equal(
      resolved.blockers.some((b) => b.code === "COMPOSITION_UNRESOLVED"),
      false,
      "the blocker here is the unresolved identity, not an unresolved composite -- no composition was printed at all",
    );
  }

  // The 4 devices are still counted at sheet level, and attributed to nobody.
  const summary = summariseDrawingPrintedQuantity({ rows: [untagged3, untagged1], sheetKey: WLC_SHEET });
  assert.equal(summary.printedTotalDeviceCount, 4, "the 4 devices are not lost from the sheet");
  assert.equal(summary.perClass.length, 0, "and are attributed to no class");
  assert.equal(summary.unresolved.length, 2);
});

// ===========================================================================
// CASE F -- stale / non-governing document
// ===========================================================================

test("CASE F: a printed count from a non-governing or superseded document cannot authorize a quantity", () => {
  const notGoverning = simpleRow({ rowKey: "old-version", sourceDocumentVersionId: "ver_superseded", governing: false });
  const r1 = resolveRowDeviceQuantity(notGoverning);
  assert.equal(r1.available, false);
  assert.equal(r1.quantity, null);
  assert.ok(r1.blockers.some((b) => b.code === "SOURCE_DOCUMENT_NOT_GOVERNING"));

  const stale = simpleRow({ rowKey: "stale-evidence", stale: true });
  const r2 = resolveRowDeviceQuantity(stale);
  assert.equal(r2.available, false);
  assert.equal(r2.quantity, null);
  assert.ok(r2.blockers.some((b) => b.code === "EVIDENCE_STALE"));

  assert.equal(evaluateDrawingQuantityRequest({ rows: [notGoverning, stale], sheetKey: WLC_SHEET }).ok, false);
});

test("a printed count with no source row identity is untraceable and therefore unusable", () => {
  const orphan = buildPrintedQuantityRow({
    printedQuantityText: "36 Nos", compositionTokens: ["S"], classKeys: ["S"],
    rowKey: null, recognitionState: "APPROVED", governing: true,
  });
  const resolved = resolveRowDeviceQuantity(orphan);
  assert.equal(resolved.available, false);
  assert.ok(resolved.blockers.some((b) => b.code === "PRINTED_COUNT_HAS_NO_SOURCE_ROW"));
});

// ===========================================================================
// CASE G -- sheet scope, never project scope
// ===========================================================================

test("CASE G: absence is sheet-scoped and the summary can never claim project completeness on its own", () => {
  const summary = summariseDrawingPrintedQuantity({ rows: [simpleRow()], sheetKey: WLC_SHEET });
  assert.equal(summary.scope.sheetKey, WLC_SHEET);
  assert.equal(summary.scope.completeness, "SHEET_COMPLETE", "a single reviewed sheet is never project-complete");
  assert.equal(summary.scope.completeness === "PROJECT_COMPLETE", false);

  // Project completeness may only be asserted by the caller, and only
  // explicitly -- the contract never infers it.
  const widened = summariseDrawingPrintedQuantity({ rows: [simpleRow()], sheetKey: WLC_SHEET, scopeLabel: "PROJECT_COMPLETE" });
  assert.equal(widened.scope.completeness, "PROJECT_COMPLETE");
  assert.equal(
    summariseDrawingPrintedQuantity({ rows: [], sheetKey: WLC_SHEET }).scope.completeness,
    "SHEET_COMPLETE",
    "reviewing nothing does not become project completeness",
  );
});

// ===========================================================================
// The fail-closed gate
// ===========================================================================

test("with no governed printed-quantity extraction the gate refuses, and refuses with a reason -- never a count", () => {
  // This is the Golden state today: the reviewed drawing has never been
  // through a structural parse, so the printed counts survive nowhere.
  const gate = evaluateDrawingQuantityRequest({ rows: [], approvedOccurrenceCount: 27, sheetKey: WLC_SHEET });
  assert.equal(gate.ok, false);
  assert.equal(gate.quantity, null);
  assert.equal(gate.authority, "NONE");
  assert.equal(gate.blockers.some((b) => b.code === "PRINTED_COUNT_MISSING"), true);
  assert.match(gate.blockers[0].detail, /recognition metric/i);
  assert.match(gate.blockers[0].detail, /not a device quantity/i);
  // The 27 is nowhere in the answer as a quantity.
  assert.equal(JSON.stringify(gate).includes('"quantity":27'), false);
});

test("the gate returns the printed total only when every printed row is available AND promotable", () => {
  const clean = evaluateDrawingQuantityRequest({ rows: [simpleRow(), simpleRow({ rowKey: "r2", printedQuantityText: "4 Nos" })], sheetKey: WLC_SHEET });
  assert.equal(clean.ok, true);
  assert.equal(clean.quantity, 16);
  assert.equal(clean.authority, "PRINTED_DRAWING");

  const withRejected = evaluateDrawingQuantityRequest({ rows: [simpleRow(), simpleRow({ rowKey: "r2", printedQuantityText: "4 Nos", recognitionState: "REJECTED" })], sheetKey: WLC_SHEET });
  assert.equal(withRejected.ok, false, "one non-promotable row fails the whole gate closed");
  assert.equal(withRejected.quantity, null);
});

test("NO_PRINTED_QUANTITY_AUTHORITY is a refusal carrying a reason, never a zero", () => {
  assert.equal(NO_PRINTED_QUANTITY_AUTHORITY.available, false);
  assert.equal(NO_PRINTED_QUANTITY_AUTHORITY.quantity, null, "refusal is null, not 0");
  assert.equal(NO_PRINTED_QUANTITY_AUTHORITY.authority, "NONE");
  assert.equal(NO_PRINTED_QUANTITY_AUTHORITY.blockers.length, 1);
});

test("resolveRowDeviceQuantity tolerates a missing row rather than throwing", () => {
  const resolved = resolveRowDeviceQuantity(null);
  assert.equal(resolved.available, false);
  assert.equal(resolved.quantity, null);
  assert.equal(resolved.promotable, false);
});
