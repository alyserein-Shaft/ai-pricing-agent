// Commercial line presentation models (pure; no DOM, no DB).
//
// These turn governed commercial state into unambiguous UI models. Every model
// distinguishes UNKNOWN from zero/empty: a missing price is never rendered as
// `0 SAR`, a partial total is always labelled Partial, and an unreviewed
// discount policy is never presented as governed.

// --- Price source kinds -------------------------------------------------------
export const PRICE_SOURCE_KINDS = Object.freeze({
  INTERNAL_LIST: "INTERNAL_LIST",
  SUPPLIER_QUOTE: "SUPPLIER_QUOTE",
  HISTORICAL: "HISTORICAL",
  MANUAL: "MANUAL",
  POLICY: "POLICY",
  MISSING: "MISSING",
});

export function priceSourceBadge(source) {
  if (!source || source.kind == null) {
    return { kind: "MISSING", label: "Price missing", detail: "No price source recorded for this line.", stale: false, actionable: true };
  }
  const labels = {
    INTERNAL_LIST: "Internal price list",
    SUPPLIER_QUOTE: "Supplier quote",
    HISTORICAL: "Historical price — discovery only",
    MANUAL: "Manual price",
    POLICY: "Governed pricing policy",
  };
  const stale = source.validityState != null && String(source.validityState).toLowerCase() !== "current" && String(source.validityState).toLowerCase() !== "valid";
  return {
    kind: source.kind,
    label: labels[source.kind] || String(source.kind),
    detail: [source.reference, source.version, source.date].filter(Boolean).join(" · ") || "Provenance not recorded",
    stale,
    actionable: source.kind === "MISSING" || stale,
  };
}

// --- Totals (partial labelling) -----------------------------------------------
export function lineTotalsModel(lines) {
  const rows = Array.isArray(lines) ? lines : [];
  const priced = rows.filter((l) => l != null && Number.isFinite(Number(l.extendedCost)) && l.hasPriceSource === true);
  const unpriced = rows.filter((l) => !priced.includes(l));
  const totalCost = priced.reduce((sum, l) => sum + Number(l.extendedCost), 0);
  return {
    pricedCount: priced.length,
    unpricedCount: unpriced.length,
    totalCount: rows.length,
    totalCost: priced.length ? totalCost : null,
    partial: unpriced.length > 0,
    label: unpriced.length > 0 ? `Partial Total (${unpriced.length} of ${rows.length} lines excluded)` : "Total",
  };
}

// --- Technical handoff chip ----------------------------------------------------
const HANDOFF_MAP = Object.freeze({
  TECHNICALLY_READY: { chip: "TECHNICALLY READY", tone: "review-ready", blocksPricing: false },
  TECHNICAL_REVIEW_REQUIRED: { chip: "TECHNICAL REVIEW REQUIRED", tone: "review-pending", blocksPricing: true },
  TECHNICAL_BLOCKED: { chip: "TECHNICAL BLOCKED", tone: "review-blocked", blocksPricing: true },
  TECHNICAL_DATA_STALE: { chip: "TECHNICAL DATA STALE", tone: "review-stale", blocksPricing: true },
});

export function handoffChip(technicalState) {
  const key = String(technicalState || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  const mapped = HANDOFF_MAP[key];
  if (mapped) return mapped;
  return { chip: "TECHNICAL REVIEW REQUIRED", tone: "review-pending", blocksPricing: true };
}

// --- Farenhyt internal pricing policy -------------------------------------------
// Net Cost = List × 0.35 (65% off list). Governed ONLY when an approved
// discount_rules row exists; otherwise the 65% figure is historical and the
// model reports UNREVIEWED. Never invent approval.
export const FARENHYT_NET_MULTIPLIER = 0.35;
export const FARENHYT_DISCOUNT_BPS = 6500;

export function farenhytPolicyModel(discountRule) {
  const approved = discountRule != null
    && Number(discountRule.discount_basis_points) === FARENHYT_DISCOUNT_BPS
    && String(discountRule.approval_state || "").toLowerCase() === "approved"
    && discountRule.superseded_at == null;
  return {
    governed: approved,
    status: approved ? "GOVERNED" : "UNREVIEWED",
    listToNet: "List Price → 65% Discount → Net Cost",
    multiplier: FARENHYT_NET_MULTIPLIER,
    basisPoints: FARENHYT_DISCOUNT_BPS,
    note: approved
      ? "Governed company policy: Farenhyt net = list × 0.35."
      : "Historical 65% supplier discount is NOT a governed rule. Record it through the governed discount-rules path with commercial approval before quoting from it.",
    ruleId: approved ? discountRule.id : null,
  };
}

export function applyFarenhytNet(listAmount) {
  const amount = asGovernedAmount(listAmount);
  if (amount === null) return null;
  return amount * FARENHYT_NET_MULTIPLIER;
}

const asGovernedAmount = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};
export const USD_TO_SAR = 3.75;

export function currencyDisplay(amountMinor, sourceCurrency, projectCurrency = "SAR") {
  const amount = asGovernedAmount(amountMinor);
  if (amount === null) return { text: "UNKNOWN", converted: null, reviewRequired: true };
  const src = String(sourceCurrency || "").toUpperCase();
  const dst = String(projectCurrency || "SAR").toUpperCase();
  if (src === dst || (src === "" && dst === "SAR")) return { text: `${amount} ${dst}`, converted: amount, reviewRequired: false };
  if (src === "USD" && dst === "SAR") {
    return { text: `${amount} USD × ${USD_TO_SAR} = ${Math.round(amount * USD_TO_SAR)} SAR`, converted: Math.round(amount * USD_TO_SAR), reviewRequired: false, policy: "FIXED_USD_SAR" };
  }
  return { text: `${amount} ${src || "?"} — currency review required`, converted: null, reviewRequired: true };
}

// --- Quotation readiness -----------------------------------------------------------
export function quotationReadinessModel(quotation) {
  const q = quotation || {};
  const excluded = q.excludedLines == null ? null : Number(q.excludedLines);
  const unresolved = Number(q.unresolvedLines || 0);
  const approved = String(q.approvalState || "").toLowerCase() === "approved";
  const ready = approved && excluded === 0 && unresolved === 0 && q.commercialReady === true;
  return {
    revision: q.revision ?? null,
    approvalState: q.approvalState || "UNKNOWN",
    ready,
    verdict: ready ? "READY TO ISSUE" : "NOT READY",
    excludedNote: excluded == null ? null : excluded > 0 ? `${excluded} lines excluded from this revision` : null,
    unresolvedNote: unresolved > 0 ? `${unresolved} unresolved lines block issue` : null,
  };
}
