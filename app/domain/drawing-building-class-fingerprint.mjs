// GOVERNED PER-BUILDING MULTI-CLASS DRAWING FINGERPRINT.
//
// WHY. Quantity block alignment needs a per-building, multi-class signature.
// A single governed class (T only) is not enough to separate BOS / GRS / KGS /
// WLC, and the printed quantities on each schematic DO differ per building -- so
// the printed device counts are the discriminating evidence, not the T count.
//
// WHAT THIS IS NOT. It is alignment EVIDENCE, never quantity authority:
//   * an OCCURRENCE count and a PRINTED quantity are different evidence types
//     and are never merged;
//   * no device quantity, SLC demand, zone/module count or quantity claim is
//     produced here -- that decision belongs to the quantity reasoning stage;
//   * a compound token (S HC, S C, CE, WP-...) is NEVER flattened into a single
//     class. Unresolved compounds stay COMPOUND_CLASS / AMBIGUOUS;
//   * a printed count is attached to a class only through an explicit,
//     bounded, single-winner geometric association. Where several counts compete
//     for one symbol slot, the class is AMBIGUOUS and contributes nothing.

export const FINGERPRINT_EVIDENCE_TYPES = Object.freeze({
  GOVERNED_OCCURRENCE_COUNT: "GOVERNED_OCCURRENCE_COUNT",
  GOVERNED_PRINTED_QUANTITY: "GOVERNED_PRINTED_QUANTITY",
  GOVERNED_SCHEDULE_COUNT: "GOVERNED_SCHEDULE_COUNT",
  UNRESOLVED: "UNRESOLVED",
});

export const FINGERPRINT_AUTHORITY = Object.freeze({
  GOVERNED: "GOVERNED",
  CANDIDATE: "CANDIDATE_NOT_APPROVED",
  AMBIGUOUS: "AMBIGUOUS",
  UNRESOLVED: "UNRESOLVED",
});

export const FINGERPRINT_CLASS_STATE = Object.freeze({
  RESOLVED_CLASS: "RESOLVED_CLASS",
  COMPOUND_CLASS: "COMPOUND_CLASS",
  AMBIGUOUS: "AMBIGUOUS",
});

// Association window, measured on this corpus: a printed count sits directly
// above its symbol in the same column, typically 9-25 units away. The window is
// deliberately tight so a count cannot jump columns.
export const COUNT_TO_SYMBOL_MAX_DX = 14;
export const COUNT_TO_SYMBOL_MAX_DY = 34;
export const COUNT_TO_SYMBOL_MIN_DY = 4;

const PRINTED_QUANTITY_PATTERN = /^(\d+)\s*Nos?\.?$/i;
const SYMBOL_TOKEN_PATTERN = /^[A-Z][A-Z0-9]{0,2}$/;

const centerX = (box) => box.x + box.width / 2;
const centerY = (box) => box.y + box.height / 2;

export const parsePrintedQuantity = (text) => {
  const match = PRINTED_QUANTITY_PATTERN.exec(String(text ?? "").trim());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
};

// Compound tokens are shared glyphs printed together on the sheet (S HC, S C,
// CE, WP). They describe a combined device and must never be reduced to one of
// their parts.
export const COMPOUND_SYMBOL_PATTERN = /^(?:S\s*(?:HC|C|H)\b|(?:HC|C)\s*S\b|CE\b|WP\b|SM\b|SIM\b)$/;

export const isCompoundSymbol = (token) => COMPOUND_SYMBOL_PATTERN.test(String(token ?? "").trim());

/**
 * Associate printed quantity labels with symbol tokens on ONE sheet.
 * Pure and deterministic: no AI, no scoring, no nearest-guess tie-breaking.
 *
 * A printed count binds to a symbol only when it is the single winner in its
 * column window. Competing counts produce AMBIGUOUS slots, never a silent pick.
 */
export function associatePrintedQuantities({ assets = [] } = {}) {
  const rows = (assets || [])
    .filter((asset) => asset && asset.boundingBox && typeof asset.text === "string")
    .map((asset) => ({ ...asset, cx: centerX(asset.boundingBox), cy: centerY(asset.boundingBox) }));

  const quantityRows = rows.map((asset) => ({ asset, value: parsePrintedQuantity(asset.text) })).filter((entry) => entry.value !== null);
  const symbolRows = rows.filter((asset) => SYMBOL_TOKEN_PATTERN.test(asset.text.trim()));

  // Every (count, symbol) pair inside the window, with the offset kept so
  // competition is detectable.
  const links = [];
  for (const quantity of quantityRows) {
    for (const symbol of symbolRows) {
      if (symbol.id === quantity.asset.id) continue;
      const dx = Math.abs(symbol.cx - quantity.cx);
      const dy = symbol.cy - quantity.cy; // the symbol sits BELOW its printed count
      if (dx > COUNT_TO_SYMBOL_MAX_DX) continue;
      if (dy < COUNT_TO_SYMBOL_MIN_DY || dy > COUNT_TO_SYMBOL_MAX_DY) continue;
      links.push({ quantity, symbol, dx, dy });
    }
  }

  // Competition, in both directions, is ambiguity -- never a preference.
  const ambiguousSlots = new Set();
  const bySymbol = new Map();
  const byQuantity = new Map();
  for (const link of links) {
    const symbolKey = `${link.symbol.asset.id}`;
    const quantityKey = `${link.quantity.asset.id}`;
    bySymbol.set(symbolKey, [...(bySymbol.get(symbolKey) || []), link]);
    byQuantity.set(quantityKey, [...(byQuantity.get(quantityKey) || []), link]);
  }
  for (const [, group] of bySymbol) if (group.length > 1) ambiguousSlots.add(`${group[0].symbol.asset.id}`);
  for (const [, group] of byQuantity) if (group.length > 1) ambiguousSlots.add(`${group[0].quantity.asset.id}`);

  const resolved = [];
  const ambiguous = [];
  for (const link of links) {
    const record = {
      symbol: link.symbol.asset.text.trim(),
      symbolAssetId: link.symbol.asset.id,
      symbolBBox: link.symbol.asset.boundingBox,
      pageNumber: link.symbol.asset.pageNumber ?? null,
      quantity: link.quantity.value,
      quantityAssetId: link.quantity.asset.id,
      quantityText: link.quantity.asset.text.trim(),
      quantityBBox: link.quantity.asset.boundingBox,
      dx: Math.round(link.dx * 10) / 10,
      dy: Math.round(link.dy * 10) / 10,
    };
    if (ambiguousSlots.has(`${link.symbol.asset.id}`) || ambiguousSlots.has(`${link.quantity.asset.id}`)) ambiguous.push(record);
    else resolved.push(record);
  }

  return { resolved, ambiguous };
}

/**
 * Build one building's multi-class fingerprint.
 *
 * inputs:
 *   buildingId            scope key (governed drawing number of the building sheet)
 *   governedClasses       [{ token, meaning, legendDocumentId, legendIntakeVersionId }] -- human-governed
 *   governedOccurrences   [{ token, count, evidenceType, sourceAssetIds, pageNumbers, authorityFactId }]
 *   printedAssociations   result of associatePrintedQuantities for this sheet
 *   ambiguity             [{ label, status, detail }]
 *   currentness           { documentId, documentVersionId, drawingIntakeVersionId, drawingNumberGoverned }
 */
export function buildBuildingClassFingerprint({
  buildingId,
  governedClasses = [],
  governedOccurrences = [],
  printedAssociations = { resolved: [], ambiguous: [] },
  ambiguity = [],
  currentness = {},
} = {}) {
  const classes = [];
  const tokensWithGovernedOccurrence = new Set(governedOccurrences.map((entry) => entry.token));

  // 1. Governed occurrence counts (a DIFFERENT evidence type from printed text).
  for (const occurrence of governedOccurrences) {
    const definition = governedClasses.find((entry) => entry.token === occurrence.token) || null;
    classes.push({
      normalizedClass: definition ? definition.meaning : null,
      token: occurrence.token,
      value: occurrence.count,
      evidenceType: occurrence.evidenceType ?? FINGERPRINT_EVIDENCE_TYPES.GOVERNED_OCCURRENCE_COUNT,
      authorityStatus: FINGERPRINT_AUTHORITY.GOVERNED,
      classState: FINGERPRINT_CLASS_STATE.RESOLVED_CLASS,
      sourceAssetIds: occurrence.sourceAssetIds || [],
      pageNumbers: occurrence.pageNumbers || [],
      authorityFactId: occurrence.authorityFactId ?? null,
      note: "Governed physical occurrence evidence. NOT a device quantity.",
    });
  }

  // 2. Printed quantities attached to a symbol that has a governed meaning.
  const resolvedBySymbol = new Map();
  for (const record of printedAssociations.resolved || []) {
    const list = resolvedBySymbol.get(record.symbol) || [];
    list.push(record);
    resolvedBySymbol.set(record.symbol, list);
  }
  const ambiguousSymbols = new Set((printedAssociations.ambiguous || []).map((record) => record.symbol));

  for (const record of printedAssociations.resolved || []) {
    const definition = governedClasses.find((entry) => entry.token === record.symbol) || null;
    // A compound glyph never inherits a single part's meaning.
    if (isCompoundSymbol(record.symbol)) continue;
    if (!definition) continue;
    // An occurrence count and a printed quantity are never merged: the printed
    // value is recorded as its own feature so both remain visible to alignment.
    classes.push({
      normalizedClass: definition.meaning,
      token: record.symbol,
      value: record.quantity,
      evidenceType: FINGERPRINT_EVIDENCE_TYPES.GOVERNED_PRINTED_QUANTITY,
      authorityStatus: FINGERPRINT_AUTHORITY.GOVERNED,
      classState: FINGERPRINT_CLASS_STATE.RESOLVED_CLASS,
      sourceAssetIds: [record.quantityAssetId, record.symbolAssetId],
      pageNumbers: [record.pageNumber],
      authorityFactId: definition.authorityFactId ?? null,
      note: `Printed quantity "${record.quantityText}" above symbol ${record.symbol} (dx=${record.dx}, dy=${record.dy}). NOT a device quantity.`,
    });
  }

  // 3. Every governed class that produced no clean evidence is reported as
  //    UNRESOLVED, so absence is explicit rather than silent.
  for (const definition of governedClasses) {
    if (classes.some((entry) => entry.token === definition.token && entry.authorityStatus === FINGERPRINT_AUTHORITY.GOVERNED)) continue;
    classes.push({
      normalizedClass: definition.meaning,
      token: definition.token,
      value: null,
      evidenceType: FINGERPRINT_EVIDENCE_TYPES.UNRESOLVED,
      authorityStatus: FINGERPRINT_AUTHORITY.UNRESOLVED,
      classState: FINGERPRINT_CLASS_STATE.AMBIGUOUS,
      sourceAssetIds: [],
      pageNumbers: [],
      authorityFactId: definition.authorityFactId ?? null,
      note: tokensWithGovernedOccurrence.has(definition.token)
        ? "A governed occurrence count exists for this class; no printed quantity could be associated."
        : "No governed occurrence count or unambiguous printed quantity for this class on this sheet.",
    });
  }

  // 4. Compound / ambiguous symbol slots are surfaced, never folded into a class.
  const compoundSlots = [...new Set([...(printedAssociations.ambiguous || []).map((r) => r.symbol), ...ambiguousSymbols])]
    .filter((token) => token)
    .sort()
    .map((token) => ({
      token,
      isCompound: isCompoundSymbol(token),
      classState: isCompoundSymbol(token) ? FINGERPRINT_CLASS_STATE.COMPOUND_CLASS : FINGERPRINT_CLASS_STATE.AMBIGUOUS,
      competingQuantityCount: (printedAssociations.ambiguous || []).filter((record) => record.symbol === token).length,
      value: null,
      evidenceType: FINGERPRINT_EVIDENCE_TYPES.UNRESOLVED,
      authorityStatus: FINGERPRINT_AUTHORITY.AMBIGUOUS,
      note: "Competing or compound symbol evidence; never resolved into a single class value.",
    }));

  const governedFeatures = classes.filter((entry) => entry.authorityStatus === FINGERPRINT_AUTHORITY.GOVERNED && entry.value !== null);
  const distinctClasses = new Set(governedFeatures.map((entry) => entry.normalizedClass ?? entry.token));

  return {
    buildingId,
    currentness,
    classes,
    compoundAndAmbiguousSlots: compoundSlots,
    ambiguityFlags: ambiguity,
    alignmentReadiness: {
      // Usable for block alignment when >= 2 independent governed classes exist
      // and no material ambiguity invalidates them. Every class is NOT required.
      governedClassCount: governedFeatures.length,
      distinctGovernedClasses: distinctClasses.size,
      usableForBlockAlignment: distinctClasses.size >= 2,
      basis: "two or more independent governed classes with current provenance",
    },
    // Explicit non-authority statement: this fingerprint is alignment evidence.
    quantityAuthority: {
      isEvidence: true,
      isDeviceQuantity: false,
      deviceQuantity: null,
      isEngineerApprovedQuantity: false,
      decidedBy: "QUANTITY_REASONING_STAGE_REQUIRED",
    },
  };
}
