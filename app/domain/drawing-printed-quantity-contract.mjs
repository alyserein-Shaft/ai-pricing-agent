// DRAW-QTY-1 (2026-09-27): DRAWING PRINTED QUANTITY AUTHORITY & COMPOSITE ROW CONTRACT.
//
// WHY THIS MODULE EXISTS.
//
// A fire-alarm riser schedule prints its device counts in the TEXT layer: each
// row carries an abbreviation (or composition of abbreviations) on the left and
// a printed "N Nos" on the right. On the one reviewed sheet (WLC T-93) the
// text layer yields 36 printed count cells totalling 248 devices, while the
// governed recognition surface holds 27 approved occurrences.
//
// Those 27 are 27 ROWS, not 27 devices. The occurrence model has no quantity
// field at all (drawing_symbol_occurrences has 18 columns and none is a
// quantity), so an approved occurrence can only ever be a recognition metric.
// Promoting a count of approved occurrences to a device quantity therefore
// reports 27 against a drawing that explicitly prints 248 -- roughly a 9x
// understatement that is not a lower bound of anything the sheet asserts.
//
// This module establishes the canonical contract that can truthfully carry a
// PRINTED quantity, and the fail-closed gate that stops any consumer from
// substituting an occurrence count for one. It is pure: no I/O, no database,
// no schema, no mutation.
//
// GOVERNANCE INVARIANTS CARRIED HERE.
//   - An occurrence count is NEVER a device quantity. It stays available as a
//     recognition metric, explicitly labelled as one.
//   - A device quantity requires a printed count, a source row, a resolvable
//     composition, a governing document, and non-stale evidence. Any missing
//     precondition fails closed with a named blocker -- never a silent
//     fallback to a count.
//   - A composite row's printed quantity attaches to the WHOLE printed
//     composition. It is NEVER copied to each token. Until a governed
//     decomposition decision exists, a composite row yields a printed
//     quantity but NO per-class quantity, and says so.
//   - Recognition rejection never destroys quantity evidence, and never
//     promotes it either: a rejected row keeps its printed quantity as
//     non-promoted evidence.
//   - Absence is SHEET-scoped. Nothing in this module may claim a class is
//     absent from the project.
//
// RELATION TO EXISTING POLICY. This does not invent a new rule. It enforces
// one the repository already asserts: app/domain/drawing-evidence-authority-
// policy.mjs states that a drawing count is "discrepancy evidence only, not
// authoritative", and app/domain/drawing-quantity-evidence-engine.mjs
// documents that its own number is "never how many devices exist in the
// project". The single conversion site in
// worker/quantity-source-decision-api.mjs violated both.

export const DRAWING_PRINTED_QUANTITY_CONTRACT_VERSION = "drawing-printed-quantity-contract-1.0.0";

// ---------------------------------------------------------------------------
// Printed quantity text
// ---------------------------------------------------------------------------

// A printed count is an integer followed by an optional plural/singular
// quantity marker. Nothing else is accepted. "3 Nos (2 SHS)", "2x", "LOT 4"
// and "2.5" all fail to parse rather than being coerced -- an unparseable
// count must be visible as unparseable, never approximated.
const PRINTED_QUANTITY_PATTERN = /^(\d+)\s*(?:nos?\.?|qty\.?)?$/i;

/**
 * Parse a printed count cell verbatim. Returns the raw text plus the integer
 * value, or null when the text is absent or is not a plain printed count.
 * Never throws, never coerces, never guesses.
 */
export const parsePrintedQuantityText = (text) => {
  if (typeof text !== "string") return null;
  const raw = text.trim();
  if (!raw) return null;
  const match = PRINTED_QUANTITY_PATTERN.exec(raw);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return { raw, value };
};

// ---------------------------------------------------------------------------
// Contract vocabularies
// ---------------------------------------------------------------------------

export const PRINTED_QUANTITY_STATES = [
  "PRINTED_QUANTITY_PRESENT",
  "PRINTED_QUANTITY_MISSING",
  "PRINTED_QUANTITY_UNPARSEABLE",
];

// How the printed composition of a row relates to a device class.
export const COMPOSITION_STATES = [
  "SINGLE_CLASS",
  "COMPOSITE_SEMPOSED",
  "COMPOSITE_SEMANTICS_UNRESOLVED",
  "COMPOSITION_ABSENT",
  // Only reachable through an explicit governed decomposition decision.
  "COMPOSITE_GOVERNED_DECOMPOSED",
];

// Whether the row's device identity is known. A row can have a printed count
// and still be identity-unresolved; that is a legitimate, representable state
// and must never be filled in with a fabricated class.
export const IDENTITY_STATES = ["CLASS_RESOLVED", "IDENTITY_UNRESOLVED"];

// Recognition state of the row's occurrence(s), as governed by the review
// surface. Recorded for provenance; it never overwrites the printed count.
export const RECOGNITION_STATES = ["APPROVED", "REJECTED", "NEEDS_REVIEW", "NO_OCCURRENCE"];

// A device quantity is only ever authorised by a printed count on the drawing.
export const QUANTITY_AUTHORITIES = ["PRINTED_DRAWING", "NONE"];

// Every reason the contract refuses to yield a device quantity. These map
// one-to-one onto the fail-closed preconditions required of any downstream
// drawing quantity.
export const DEVICE_QUANTITY_BLOCKERS = [
  "PRINTED_COUNT_MISSING",
  "PRINTED_COUNT_UNPARSEABLE",
  "PRINTED_COUNT_HAS_NO_SOURCE_ROW",
  "COMPOSITION_UNRESOLVED",
  "EVIDENCE_STALE",
  "SOURCE_DOCUMENT_NOT_GOVERING",
  "IDENTITY_UNRESOLVED",
];

const blocker = (code, detail) => ({ code, detail });

// The standing result whenever a drawing has not been through a governed
// printed-quantity extraction. This is the honest default and it is a refusal,
// not a zero.
export const NO_PRINTED_QUANTITY_AUTHORITY = Object.freeze({
  available: false,
  quantity: null,
  authority: "NONE",
  blockers: Object.freeze([
    blocker("PRINTED_COUNT_MISSING", "No governed printed drawing count exists for this evidence. An approved occurrence count is a recognition metric, not a device quantity."),
  ]),
});

// ---------------------------------------------------------------------------
// Row construction
// ---------------------------------------------------------------------------

const normaliseTokens = (tokens) =>
  (Array.isArray(tokens) ? tokens : [])
    .map((token) => (typeof token === "string" ? token.trim() : ""))
    .filter(Boolean)
    .map((token) => token.toUpperCase());

const distinctClasses = (tokens) => [...new Set(tokens)];

const deriveCompositionState = (tokens, decomposition) => {
  if (!tokens.length) return "COMPOSITION_ABSENT";
  const classes = distinctClasses(tokens);
  if (classes.length === 1) return tokens.length === 1 ? "SINGLE_CLASS" : "COMPOSITE_SEMPOSED";
  if (decomposition && decomposition.state === "GOVERNED_DECOMPOSED") return "COMPOSITE_GOVERNED_DECOMPOSED";
  return "COMPOSITE_SEMANTICS_UNRESOLVED";
};

/**
 * Build one canonical printed-quantity row.
 *
 * The row is the unit of drawing quantity truth. It represents a printed
 * group on a sheet -- not a symbol instance, not an occurrence, not a device.
 *
 * A governed decomposition is accepted only when it is explicitly marked
 * GOVERNED_DECOMPOSED, carries a decider and a reason, covers every printed
 * token, and its per-class quantities sum exactly to the printed total.
 * Anything short of that leaves the composition UNRESOLVED. In particular a
 * composite row is never silently fanned out to its tokens.
 */
export const buildPrintedQuantityRow = ({
  sourceDocumentId = null,
  sourceDocumentVersionId = null,
  pageNumber = null,
  sheetKey = null,
  rowKey = null,
  printedQuantityText = null,
  printedQuantity = null,
  compositionTokens = [],
  classKeys = null,
  identityState = null,
  recognitionState = "NO_OCCURRENCE",
  occurrenceIds = [],
  definitionKeys = [],
  decomposition = null,
  extractedBy = null,
  parserVersion = null,
  structureVersionId = null,
  governing = false,
  stale = false,
} = {}) => {
  const parsed = printedQuantityText != null ? parsePrintedQuantityText(printedQuantityText) : null;

  // An explicit numeric printed quantity is honoured only when it agrees with
  // the printed text; a silent disagreement is itself a defect, not a choice.
  let quantity = null;
  let quantityState;
  if (parsed) {
    quantity = parsed.value;
    quantityState = "PRINTED_QUANTITY_PRESENT";
    if (Number.isFinite(printedQuantity) && Number(printedQuantity) !== parsed.value) {
      quantityState = "PRINTED_QUANTITY_UNPARSEABLE";
      quantity = null;
    }
  } else if (printedQuantityText != null && String(printedQuantityText).trim()) {
    quantityState = "PRINTED_QUANTITY_UNPARSEABLE";
  } else if (Number.isFinite(printedQuantity) && printedQuantity >= 0) {
    quantity = Number(printedQuantity);
    quantityState = "PRINTED_QUANTITY_PRESENT";
  } else {
    quantityState = "PRINTED_QUANTITY_MISSING";
  }

  const printedTokens = normaliseTokens(compositionTokens);
  const compositionState = deriveCompositionState(printedTokens, decomposition);
  const resolvedIdentity = identityState || (classKeys && classKeys.length ? "CLASS_RESOLVED" : "IDENTITY_UNRESOLVED");

  const row = {
    contractVersion: DRAWING_PRINTED_QUANTITY_CONTRACT_VERSION,
    sourceDocumentId,
    sourceDocumentVersionId,
    pageNumber,
    // Sheet scope travels with the row so that "not observed" can never be
    // widened into a project-wide absence claim.
    sheetKey: sheetKey ?? rowKey,
    rowKey,
    printedQuantityText: printedQuantityText == null ? null : String(printedQuantityText),
    printedQuantity: quantity,
    quantityState,
    quantityAuthority: quantityState === "PRINTED_QUANTITY_PRESENT" ? "PRINTED_DRAWING" : "NONE",
    composition: {
      printedTokens,
      distinctClasses: distinctClasses(printedTokens),
      normalizedClassKeys: classKeys ? normaliseTokens(classKeys) : null,
      state: compositionState,
    },
    identityState: resolvedIdentity,
    recognitionState,
    occurrenceIds: [...(occurrenceIds || [])],
    definitionKeys: [...(definitionKeys || [])],
    decomposition: null,
    provenance: {
      extractedBy,
      parserVersion,
      structureVersionId,
      governing: Boolean(governing),
      stale: Boolean(stale),
    },
  };

  if (compositionState === "COMPOSITE_GOVERNED_DECOMPOSED") {
    const assigned = (decomposition.perClass || []).map((entry) => ({
      classKey: typeof entry.classKey === "string" ? entry.classKey.trim().toUpperCase() : null,
      quantity: Number.isFinite(entry.quantity) ? entry.quantity : null,
    }));
    const coversEveryToken = assigned.length > 0 && distinctClasses(printedTokens).every((token) => assigned.some((entry) => entry.classKey === token));
    const sumsExactly =
      quantity != null &&
      assigned.every((entry) => Number.isFinite(entry.quantity)) &&
      assigned.reduce((sum, entry) => sum + entry.quantity, 0) === quantity;
    if (coversEveryToken && sumsExactly) {
      row.decomposition = {
        state: "GOVERNED_DECOMPOSED",
        perClass: assigned,
        decidedBy: decomposition.decidedBy || null,
        reason: decomposition.reason || null,
      };
      // An accepted decomposition names a class for every printed token, so
      // the row's identity is resolved BY that ruling. Leaving it unresolved
      // would make an accepted decomposition still fail closed, which would
      // make accepting one pointless.
      if (row.identityState === "IDENTITY_UNRESOLVED") row.identityState = "CLASS_RESOLVED";
    } else {
      // A decomposition that does not reconcile with the printed row is not a
      // decomposition. Refuse it rather than propagating a wrong split.
      row.composition.state = "COMPOSITE_SEMANTICS_UNRESOLVED";
    }
  }

  return row;
};

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the device quantity a single printed row can support.
 *
 * `available` means a printed device quantity is truthfully derivable from
 * this row. `promotable` additionally means recognition has approved it, so
 * it may be offered to downstream commercial stages. A rejected row keeps a
 * truthful printed quantity while remaining non-promotable -- quantity
 * evidence survives a recognition rejection without being laundered by it.
 */
export const resolveRowDeviceQuantity = (row) => {
  if (!row) return { ...NO_PRINTED_QUANTITY_AUTHORITY, promotable: false };
  const blockers = [];

  if (row.quantityState === "PRINTED_QUANTITY_UNPARSEABLE") {
    blockers.push(blocker("PRINTED_COUNT_UNPARSEABLE", `The printed count "${row.printedQuantityText}" is not a plain printed device count.`));
  } else if (row.quantityState === "PRINTED_QUANTITY_MISSING" || row.printedQuantity == null) {
    blockers.push(blocker("PRINTED_COUNT_MISSING", "This row carries no authoritative printed device count."));
  }
  if (!row.rowKey) {
    blockers.push(blocker("PRINTED_COUNT_HAS_NO_SOURCE_ROW", "A printed count with no source row identity is not traceable and cannot authorize a quantity."));
  }
  if (row.composition.state === "COMPOSITE_SEMANTICS_UNRESOLVED") {
    blockers.push(blocker("COMPOSITION_UNRESOLVED", `The printed composition "${row.composition.printedTokens.join(" + ")}" governs one printed quantity across multiple classes. It is not decomposed, so no per-class quantity exists.`));
  }
  if (row.provenance.stale) {
    blockers.push(blocker("EVIDENCE_STALE", "This printed quantity was extracted from evidence that has since been superseded."));
  }
  if (!row.provenance.governing) {
    blockers.push(blocker("SOURCE_DOCUMENT_NOT_GOVERNING", "The source document version is not the governing version, so it cannot authorize a current quantity."));
  }
  if (row.identityState === "IDENTITY_UNRESOLVED") {
    blockers.push(blocker("IDENTITY_UNRESOLVED", "The device identity of this row is unresolved. The printed count is known; the class is not, and must not be invented."));
  }

  const available = blockers.length === 0;
  return {
    available,
    promotable: available && row.recognitionState === "APPROVED",
    quantity: available ? row.printedQuantity : null,
    authority: available ? "PRINTED_DRAWING" : "NONE",
    basis: available
      ? row.composition.state === "COMPOSITE_GOVERNED_DECOMPOSED"
        ? "PRINTED_DRAWING_GOVERNED_DECOMPOSITION"
        : "PRINTED_DRAWING_ROW"
      : "NONE",
    blockers,
  };
};

/**
 * Summarise a set of printed rows into sheet-scoped drawing quantity evidence.
 *
 * Per-class quantities are only emitted for rows that are single-class or
 * governed-decomposed. Every other printed count still contributes to the
 * printed total and is reported as unresolved with its reason, so a printed
 * device count is never silently dropped from the sheet.
 */
export const summariseDrawingPrintedQuantity = ({ rows = [], sheetKey = null, scopeLabel = null } = {}) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  const perClass = new Map();
  const unresolved = [];
  let printedTotal = 0;
  let promotableTotal = 0;

  for (const row of safeRows) {
    if (row.printedQuantity == null) continue;
    printedTotal += row.printedQuantity;
    const resolved = resolveRowDeviceQuantity(row);
    if (row.composition.state === "COMPOSITE_SEMANTICS_UNRESOLVED") {
      unresolved.push({
        rowKey: row.rowKey,
        printedQuantity: row.printedQuantity,
        printedTokens: row.composition.printedTokens,
        reason: "COMPOSITION_UNRESOLVED",
        detail: "One printed quantity governs this whole printed composition; it is not attributable to any single class without a governed decomposition ruling.",
      });
      continue;
    }
    if (!resolved.available) {
      unresolved.push({
        rowKey: row.rowKey,
        printedQuantity: row.printedQuantity,
        printedTokens: row.composition.printedTokens,
        reason: resolved.blockers[0]?.code || "PRINTED_COUNT_HAS_NO_SOURCE_ROW",
        detail: resolved.blockers[0]?.detail || "This printed count cannot authorize a quantity.",
      });
      continue;
    }
    const classes = row.composition.state === "COMPOSITE_GOVERNED_DECOMPOSED"
      ? row.decomposition.perClass.map((entry) => ({ classKey: entry.classKey, quantity: entry.quantity }))
      : [{ classKey: row.composition.distinctClasses[0] || null, quantity: row.printedQuantity }];
    for (const entry of classes) {
      const key = entry.classKey || "__UNCLASSIFIED__";
      const bucket = perClass.get(key) || { classKey: entry.classKey, printedQuantity: 0, rowKeys: [] };
      bucket.printedQuantity += entry.quantity;
      bucket.rowKeys.push(row.rowKey);
      perClass.set(key, bucket);
    }
    if (resolved.promotable) promotableTotal += row.printedQuantity;
  }

  return {
    contractVersion: DRAWING_PRINTED_QUANTITY_CONTRACT_VERSION,
    // Sheet-scoped by construction. A caller may widen this only by supplying
    // rows from more sheets, never by asserting project-wide completeness.
    scope: { sheetKey, scopeLabel, completeness: scopeLabel === "PROJECT_COMPLETE" ? "PROJECT_COMPLETE" : "SHEET_COMPLETE" },
    rowCount: safeRows.length,
    printedTotalDeviceCount: printedTotal,
    promotablePrintedTotal: promotableTotal,
    perClass: [...perClass.values()].sort((a, b) => String(a.classKey).localeCompare(String(b.classKey))),
    unresolved,
    deviceQuantityAvailable: unresolved.length === 0 && safeRows.length > 0,
    isBoqTruth: false,
    isTenderQuantity: false,
    isEngineerApprovedQuantity: false,
  };
};

/**
 * Fail-closed gate for any request that wants a drawing device quantity.
 *
 * Returns the quantity only when every precondition holds. Otherwise it
 * returns a refusal carrying named blockers and a null quantity. It never
 * substitutes an occurrence count.
 */
export const evaluateDrawingQuantityRequest = ({ rows = [], approvedOccurrenceCount = null, sheetKey = null } = {}) => {
  const summary = summariseDrawingPrintedQuantity({ rows, sheetKey });

  if (!rows.length) {
    // The count is reported so the engineer can see exactly what is being
    // refused, and is deliberately never returned as the quantity.
    const found = Number.isFinite(approvedOccurrenceCount) ? `${approvedOccurrenceCount} approved occurrence(s) exist, but ` : "";
    return {
      ok: false,
      quantity: null,
      authority: "NONE",
      summary,
      blockers: [
        blocker("PRINTED_COUNT_MISSING", `This drawing has no governed printed-quantity extraction. ${found}an approved occurrence count is a recognition metric and is not a device quantity, so it cannot stand in for one.`),
      ],
      approvedOccurrenceCount: recogniseOccurrenceCountMetric(approvedOccurrenceCount),
    };
  }

  if (summary.unresolved.length) {
    return {
      ok: false,
      quantity: null,
      authority: "NONE",
      summary,
      blockers: summary.unresolved.map((entry) => blocker(entry.reason, entry.detail)),
    };
  }

  const notPromotable = rows.filter((row) => resolveRowDeviceQuantity(row).available && !resolveRowDeviceQuantity(row).promotable);
  if (notPromotable.length) {
    return {
      ok: false,
      quantity: null,
      authority: "NONE",
      summary,
      blockers: [
        blocker(
          "IDENTITY_UNRESOLVED",
          `${notPromotable.length} printed row(s) are not recognition-approved, so their printed counts remain evidence and are not promotable to a commercial quantity.`,
        ),
      ],
    };
  }

  return { ok: true, quantity: summary.printedTotalDeviceCount, authority: "PRINTED_DRAWING", summary, blockers: [] };
};

// ---------------------------------------------------------------------------
// The occurrence count, named for what it is
// ---------------------------------------------------------------------------

/**
 * Describe an approved occurrence count as a recognition metric.
 *
 * This exists so that the number remains useful for recognition reporting
 * while being structurally unable to read as a device quantity. It is not a
 * quantity and carries no unit.
 */
export const recogniseOccurrenceCountMetric = (approvedOccurrenceCount) => ({
  approvedOccurrenceCount: Number.isFinite(approvedOccurrenceCount) ? approvedOccurrenceCount : null,
  unit: "approved_occurrences",
  isDeviceQuantity: false,
  quantityAuthority: "NONE",
  reason: "An approved occurrence is a recognised legend row on a reviewed sheet. One occurrence is not one installed device; a single printed riser row carries its device count in text, not in symbols.",
});

/**
 * Compare an occurrence count with printed device totals without ever
 * declaring them equal. A count can never align or conflict with a printed
 * quantity -- they measure different things -- so alignment is reported as
 * not-determinable rather than guessed.
 */
export const compareOccurrenceCountToPrintedQuantity = ({ approvedOccurrenceCount = null, summary = null } = {}) => {
  const metric = recogniseOccurrenceCountMetric(approvedOccurrenceCount);
  return {
    approvedOccurrenceCount: metric.approvedOccurrenceCount,
    printedTotalDeviceCount: summary?.printedTotalDeviceCount ?? null,
    alignment: "NOT_DETERMINABLE",
    reason: "Approved occurrences and printed device counts are different measures. Their difference is not a variance, and neither number is derived from the other.",
  };
};
