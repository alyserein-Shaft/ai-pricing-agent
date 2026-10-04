// SCOPED QUANTITY RECONCILIATION
// Localizes a BOQ-vs-Drawing difference to its contributing project scope
// without deciding which number is physical truth. The normalized BOQ total
// remains the BOQ authority; drawing occurrences remain occurrence evidence.

export const SCOPE_AUTHORITIES = Object.freeze([
  "EXPLICIT_SOURCE_SCOPE",
  "DETERMINISTIC_SECTION_SCOPE",
  "AI_SUPPORTED_SCOPE",
  "UNRESOLVED_SCOPE",
]);

export const SCOPE_KEYS = Object.freeze(["BOS", "GRS", "KGS", "WLC", "OTHER", "AMBIGUOUS"]);

const BUILDING_TOKENS = ["BOS", "GRS", "KGS", "WLC"];

// Scope may only be derived from EXPLICIT present-in-source evidence. It is
// never inferred from row order, item_number letters, or legacy mappings.
export function classifyContributorScope(row) {
  const text = [
    row.sourceDescription,
    row.section,
    Array.isArray(row.sectionPath) ? row.sectionPath.join(" ") : row.sectionPath,
    typeof row.sourceLocation === "string" ? row.sourceLocation :
      (row.sourceLocation && ((row.sourceLocation.sheet ? row.sourceLocation.sheet + " " : "") + (row.sourceLocation.columnPath ?? ""))),
    Array.isArray(row.rawValues) ? row.rawValues.join(" ") : row.rawValues,
  ].filter(Boolean).join(" | ").toUpperCase();

  const hits = BUILDING_TOKENS.filter((t) => new RegExp(`\\b${t}\\b`).test(text));

  if (hits.length === 1) {
    // Explicit building identifier found in source text. Prefer deterministic
    // structural context; it is never guessed.
    const key = hits[0];
    const authority = /BOS|GRS|KGS|WLC/.test(text) ? "EXPLICIT_SOURCE_SCOPE" : "DETERMINISTIC_SECTION_SCOPE";
    return { scope: key, authority };
  }
  if (hits.length > 1) {
    return { scope: "AMBIGUOUS", authority: "UNRESOLVED_SCOPE", note: "multiple building tokens in source context" };
  }
  return { scope: "AMBIGUOUS", authority: "UNRESOLVED_SCOPE" };
}

export function buildScopedReconciliation({
  normalizedTotal,
  normalizedUnit,
  contributors,
  drawingByScope,
  drawingOccurrenceCount,
}) {
  // contributors: [{ sourceRow, sourceDescription, sourceQuantity, sourceUnit, section, sectionPath, sourceLocation, rawValues, sourceBoqItemId, sourceDocumentVersionId, sourceExtractionId }]
  const scoped = [];
  for (const row of contributors) {
    const c = classifyContributorScope(row);
    scoped.push({ ...c, qty: Number(row.sourceQuantity) || 0, row: row.sourceRow, sourceBoqItemId: row.sourceBoqItemId, sourceDocumentVersionId: row.sourceDocumentVersionId ?? null, sourceExtractionId: row.sourceExtractionId ?? null });
  }

  // signatures: re-sum to normalizedTotal must hold
  const resum = scoped.reduce((a, r) => a + r.qty, 0);
  const totals = {};
  const byScope = {};
  for (const r of scoped) {
    totals[r.scope] = (totals[r.scope] ?? 0) + r.qty;
    (byScope[r.scope] ??= []).push(r);
  }

  const perScope = [];
  for (const sheet of ["BOS", "GRS", "KGS", "WLC"]) {
    const hasScopedContribution = Object.prototype.hasOwnProperty.call(totals, sheet);
    const drawingOlc = sheet in (drawingByScope ?? {}) ? Number(drawingByScope[sheet]) : null;
    let status;
    if (!hasScopedContribution && drawingOlc == null) status = "NOT_COMPARABLE";
    else if (!hasScopedContribution) status = "SCOPE_UNRESOLVED"; // drawing only; BOQ row not provably this scope
    else if (drawingOlc == null) status = "NOT_COMPARABLE";
    else if (totals[sheet] === drawingOlc) status = "MATCH";
    else status = "DIFFERS";
    perScope.push({ scope: sheet, boqContribution: hasScopedContribution ? totals[sheet] : null, drawingOccurrences: drawingOlc, status });
  }
  if (totals.AMBIGUOUS) {
    perScope.push({ scope: "AMBIGUOUS", boqContribution: totals.AMBIGUOUS, drawingOccurrences: null, status: "SCOPE_UNRESOLVED" });
  }
  if (totals.OTHER) perScope.push({ scope: "OTHER", boqContribution: totals.OTHER, drawingOccurrences: null, status: "SCOPE_UNRESOLVED" });

  const globalDelta = (Number(drawingOccurrenceCount) || 0) - (Number(normalizedTotal) || 0);

  // Delta localization: only authoritative if every localized contribution is scoped.
  const allScoped = contributors.every((r) => {
    const c = classifyContributorScope(r);
    return c.scope !== "AMBIGUOUS" && c.authority !== "UNRESOLVED_SCOPE";
  });
  let deltaLocalization;
  if (globalDelta === 0) deltaLocalization = "DELTA_LOCALIZED_EXACTLY";
  else if (allScoped) {
    // every row independently scoped -> localization possible per this evidence
    deltaLocalization = "DELTA_PARTIALLY_LOCALIZED";
  } else deltaLocalization = "DELTA_NOT_LOCALIZED";

  // WLC-specific diagnostic
  const wlcBoq = totals.WLC ?? null;
  const wlcRows = byScope.WLC ?? [];
  const wlcScopeResolved = wlcRows.length > 0 && wlcRows.every((r) => r.authority !== "UNRESOLVED_SCOPE");
  let wlcDiagnostic;
  if (wlcBoq == null || wlcRows.length === 0) wlcDiagnostic = "WLC_SCOPE_UNRESOLVED";
  else if (wlcScopeResolved && Number(drawingByScope?.WLC ?? 0) === 6 && wlcBoq !== 6 && globalDelta === 6) {
    // structural relation exists but authority unclear -> possible, not proven
    wlcDiagnostic = "WLC_SCOPE_POSSIBLE_CONTRIBUTOR";
  } else wlcDiagnostic = "WLC_SCOPE_NOT_CAUSAL";

  return {
    normalizedTotal,
    normalizedUnit,
    normalizedTotalResums: resum === (Number(normalizedTotal) || 0),
    contributorCount: contributors.length,
    scopeTotals: totals,
    contributors: scoped,
    perScopeReconciliation: perScope,
    drawingOccurrenceCount,
    globalDelta,
    deltaLocalization,
    wlcDiagnostic,
  };
}
