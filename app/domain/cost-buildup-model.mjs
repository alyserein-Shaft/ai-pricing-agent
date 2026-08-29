// Phase 5 cost-continuity fix -- the generic, per-line Cost Build-Up
// composite model. Every input is read from EXISTING authoritative pricing
// infrastructure (price_records, pricing_exchange_rates, pricing_lines,
// pricing_cost_components -- all already governed by app/domain/pricing-engine.mjs
// and worker/pricing-api.mjs, built in an earlier sprint) -- this module
// invents no new price, no new precedence rule, and no selling-price logic.
// It only classifies and explains evidence that already exists, reusing the
// exact SAME source precedence pricing-engine.mjs's own selectPriceSources
// already uses, so "no automatic supplier-vs-price-list preference is
// invented" holds structurally, not by convention.
import { priceValidity, selectPriceSources, convertCurrency, applyDiscounts, quantityMultiplier } from "./pricing-engine.mjs";

const round = (value, precision = 2) => { const factor = 10 ** precision; return Math.round((Number(value) + Number.EPSILON) * factor) / factor; };

// A price record counts as currently costing-eligible only if it is BOTH
// approved and explicitly marked for costing use (never Discovery Only,
// never merely "reviewed") -- the same downstream_use gate
// isPriceEligibleForCosting already enforces elsewhere in this codebase.
const isCurrent = (record, at) => record.approvalStatus === "Approved" && record.downstreamUse === "Costing" && ["Valid", "Expiring Soon"].includes(priceValidity(record, at));
const isHistorical = (record, at) => record.priceType === "Historical Approved Price" || (record.approvalStatus === "Approved" && priceValidity(record, at) === "Expired");

// Materially different (not just floating-point noise) once normalized into
// a single currency -- a real basis for PRICE_CONFLICT, never a false
// positive from two sources that simply round differently.
const materiallyDiffer = (amounts, tolerancePercent = 2) => {
  if (amounts.length < 2) return false;
  const min = Math.min(...amounts), max = Math.max(...amounts);
  if (min <= 0) return max > 0;
  return (max - min) / min * 100 > tolerancePercent;
};

export const PRICE_EVIDENCE_STATES = Object.freeze(["CURRENT_PRICE_AVAILABLE", "HISTORICAL_PRICE_ONLY", "MULTIPLE_PRICE_EVIDENCE", "PRICE_CONFLICT", "PRICE_MISSING"]);

// Never fabricates a current price from historical data -- HISTORICAL_PRICE_ONLY
// and PRICE_MISSING are both terminal, non-costing-eligible states; only
// CURRENT_PRICE_AVAILABLE / MULTIPLE_PRICE_EVIDENCE ever feed a cost.
export function derivePriceEvidenceStatus(records = [], { normalizedAmounts = [], at = new Date().toISOString() } = {}) {
  const current = records.filter((record) => isCurrent(record, at));
  const historical = records.filter((record) => isHistorical(record, at));
  if (!current.length && !historical.length) return "PRICE_MISSING";
  if (!current.length) return "HISTORICAL_PRICE_ONLY";
  if (current.length === 1) return "CURRENT_PRICE_AVAILABLE";
  return materiallyDiffer(normalizedAmounts.length ? normalizedAmounts : current.map((record) => record.amount)) ? "PRICE_CONFLICT" : "MULTIPLE_PRICE_EVIDENCE";
}

// The selected cost evidence retains the ORIGINAL source (priceType,
// reference, currency, amount) -- never collapsed into one anonymous
// number. `selectedPriceSourceId` is an engineer's explicit prior choice
// (read from a persisted pricing_lines.selected_price_record_id); absent
// one, this only ever proposes the precedence-ranked top candidate as a
// suggestion requiring explicit selection -- the same
// requiresExplicitSelection contract pricing-engine.mjs's own
// calculatePricingLine already enforces.
export function selectCostEvidence(rankedSources = [], selectedPriceSourceId = null) {
  if (selectedPriceSourceId) {
    const chosen = rankedSources.find((entry) => entry.id === selectedPriceSourceId);
    if (chosen) return { ...chosen, selectionBasis: "Engineer Selected" };
  }
  const recommended = rankedSources.find((entry) => entry.eligible);
  return recommended ? { ...recommended, selectionBasis: "Precedence Suggested — Requires Explicit Selection" } : null;
}

export const COST_LINE_STATES = Object.freeze(["COST_READY", "COST_DECISION_REQUIRED", "COST_EVIDENCE_INCOMPLETE", "COST_NOT_APPLICABLE"]);
const COST_STATE_LABELS = Object.freeze({
  COST_READY: "Cost ready for review",
  COST_DECISION_REQUIRED: "Engineer cost decision required",
  COST_EVIDENCE_INCOMPLETE: "Price or exchange-rate evidence is incomplete",
  COST_NOT_APPLICABLE: "BOM is not ready for costing yet",
});

export function deriveCostReadiness({ bomReady, priceEvidenceStatus, hasOpenCostQuestion, exchangeRateMissing, materialCostComputed = true }) {
  const state = !bomReady ? "COST_NOT_APPLICABLE"
    : hasOpenCostQuestion ? "COST_DECISION_REQUIRED"
    : priceEvidenceStatus === "PRICE_MISSING" || exchangeRateMissing || !materialCostComputed ? "COST_EVIDENCE_INCOMPLETE"
    : "COST_READY";
  return { state, label: COST_STATE_LABELS[state] };
}

// One precise cost decision, in priority order -- reusing the exact
// question-and-answer pattern proven in the Unified Engineer Decision Center
// (Vertical Slice 1) and the BOM decision surface (Vertical Slice 2): a
// governed reason, a structured kind, a closed option set where one exists.
export function selectCostDecisionQuestion({ priceEvidenceStatus, rankedSources = [], exchangeRateMissing, sourceCurrency, missingCostBasisComponents = [], hasExplicitSelection = false }) {
  // The underlying engine (calculatePricingLine) never auto-selects a price
  // source, even when exactly one current, eligible source exists -- "no
  // automatic supplier-vs-price-list preference may be invented" holds even
  // for a single obvious candidate. This asks for confirmation whenever
  // costing-eligible evidence exists but nothing has been explicitly chosen
  // yet, not only when multiple sources genuinely compete.
  if (["CURRENT_PRICE_AVAILABLE", "MULTIPLE_PRICE_EVIDENCE", "PRICE_CONFLICT"].includes(priceEvidenceStatus) && !hasExplicitSelection) {
    const eligible = rankedSources.filter((entry) => entry.eligible);
    if (eligible.length) return {
      kind: "SELECT_PRICE_SOURCE",
      options: eligible.map((entry) => ({ id: entry.id, priceType: entry.priceType, amount: entry.amount, currency: entry.currency, reference: entry.reference })),
      question: eligible.length === 1
        ? `Confirm ${eligible[0].priceType} (${eligible[0].amount} ${eligible[0].currency}) as the price evidence to use for costing.`
        : `Which price evidence should be used — ${eligible.map((entry) => `${entry.priceType} (${entry.amount} ${entry.currency})`).join(", ")}?`,
    };
  }
  if (exchangeRateMissing) return { kind: "CONFIRM_EXCHANGE_RATE", options: [], question: `Confirm the ${sourceCurrency}→SAR exchange rate to use for this project (no approved rate is on record).` };
  if (missingCostBasisComponents.length) return { kind: "PROVIDE_COST_BASIS", options: missingCostBasisComponents, question: `Provide a cost basis for: ${missingCostBasisComponents.join(", ")}.` };
  return null;
}

export function extendedMaterialCost({ unitCost, quantity }) {
  if (unitCost == null || quantity == null) return null;
  return round(Number(unitCost) * Number(quantity), 2);
}

// Phase 5 cost-continuity fix (BOM-component costing) -- a BOM component's
// inclusion in the primary product's own governance (Vertical Slice 1's
// technical/safety approval) never applies to it: a required base or a
// resolved conditional sounder base is governed instead by Product
// Knowledge's own approved accessory relationship plus the BOM read model's
// already-resolved role (Vertical Slice 2) -- that IS its "technical
// approval" for costing purposes. calculatePricingLine's own
// TECHNICAL_APPROVAL_REQUIRED / SAFETY_PRICE_ELIGIBILITY_REQUIRED gate is
// therefore the wrong gate to reuse here (it would either wrongly block
// every accessory forever, or require fabricating a fake safety decision).
// What IS reused, directly, are the engine's own real computational
// primitives -- selectPriceSources, convertCurrency, applyDiscounts,
// quantityMultiplier -- so price precedence, currency conversion and
// discount math are never reimplemented, only the primary-product-specific
// approval gate is (correctly) not reapplied to a component it was never
// designed to govern.
export function isBomComponentIncludedInCosting(component) {
  if (!component) return false;
  if (component.role === "REQUIRED_COMPONENT" || component.role === "CONDITIONAL_COMPONENT") return true;
  return (component.role === "OPTIONAL_COMPONENT" || component.role === "COMPATIBLE_ALTERNATIVE") && Boolean(component.engineerSelected);
}

export function priceMaterialComponent({ productId, quantity, unit, lumpSumMode, priceSources = [], selectedPriceSourceId = null, projectId, region, at = new Date().toISOString(), sourcePrecedence, exchangeRate, projectCurrency, discounts = [], manufacturer, precision = 2 }) {
  const rankedSources = selectPriceSources({ sources: priceSources, projectId, productId, quantity, region, at, precedence: sourcePrecedence });
  if (!rankedSources.some((entry) => entry.eligible)) return { status: "PRICE_MISSING", rankedSources, selectedSource: null, netUnitCost: null, extendedCost: null, blockers: ["PRICE_MISSING"] };
  const selected = rankedSources.find((entry) => entry.id === selectedPriceSourceId);
  if (!selected?.eligible) return { status: "AWAITING_SELECTION", rankedSources, selectedSource: null, netUnitCost: null, extendedCost: null, blockers: ["PRICE_SOURCE_SELECTION_REQUIRED"] };
  let multiplier;
  try { multiplier = quantityMultiplier({ quantity, unit, lumpSumMode }); }
  catch (error) { return { status: "QUANTITY_INVALID", rankedSources, selectedSource: selected, netUnitCost: null, extendedCost: null, blockers: [error.code] }; }
  let conversion;
  try { conversion = convertCurrency({ amount: selected.amount, sourceCurrency: selected.currency, projectCurrency, exchangeRate, precision }); }
  catch (error) { return { status: "EXCHANGE_RATE_MISSING", rankedSources, selectedSource: selected, netUnitCost: null, extendedCost: null, blockers: [error.code] }; }
  const discounted = applyDiscounts({ amount: conversion.convertedAmount, discounts, context: { componentType: "Material", projectId, manufacturer, sourceId: selected.id, at, precision } });
  return { status: "PRICED", rankedSources, selectedSource: selected, conversion, netUnitCost: discounted.net, quantity: multiplier, extendedCost: round(discounted.net * multiplier, precision), blockers: [] };
}

// Total Material Cost = Primary Material Cost + Required BOM Component Cost
// + Resolved Conditional Component Cost -- computed only from entries the
// caller has already filtered to isBomComponentIncludedInCosting (an
// unselected optional/alternative or a NOT_APPLICABLE component must never
// reach this function at all, so it can never affect the total either way).
// A missing/unresolved REQUIRED or CONDITIONAL entry blocks the total
// outright (never silently summed as zero); a missing OPTIONAL/alternative
// entry (only present because it was engineer-selected, per the caller's
// own filter) is reported the same way, since an engineer's own inclusion
// decision still deserves a real cost, not a silent zero.
export function aggregateMaterialCost({ primary, components = [] }) {
  const missing = [];
  let componentTotal = 0;
  for (const entry of components) {
    if (entry.priced.status === "PRICED") { componentTotal = round(componentTotal + entry.priced.extendedCost, 2); continue; }
    missing.push({ partNumber: entry.partNumber, role: entry.role, relationshipType: entry.relationshipType || null, status: entry.priced.status });
  }
  const primaryReady = Boolean(primary?.approvalReady);
  if (!primaryReady) missing.unshift({ partNumber: primary?.partNumber || null, role: "PRIMARY_PRODUCT", relationshipType: null, status: primary?.status || "PRICE_MISSING" });
  const primaryMaterialCost = primaryReady ? primary.materialTotal : null;
  const requiredComponentCost = components.filter((entry) => entry.role === "REQUIRED_COMPONENT" && entry.priced.status === "PRICED").reduce((sum, entry) => sum + entry.priced.extendedCost, 0);
  const conditionalComponentCost = components.filter((entry) => entry.role === "CONDITIONAL_COMPONENT" && entry.priced.status === "PRICED").reduce((sum, entry) => sum + entry.priced.extendedCost, 0);
  const totalMaterialCost = missing.length ? null : round((primaryMaterialCost || 0) + componentTotal, 2);
  return {
    primaryMaterialCost,
    requiredComponentCost: round(requiredComponentCost, 2),
    conditionalComponentCost: round(conditionalComponentCost, 2),
    componentMaterialCost: round(componentTotal, 2),
    totalMaterialCost,
    missingComponents: missing,
  };
}

// The unified cost-decision question across the primary product AND every
// included BOM component -- reusing the exact SAME question shapes
// (SELECT_PRICE_SOURCE / CONFIRM_EXCHANGE_RATE) already proven for the
// primary product alone, now scoped and labeled per component so an
// engineer always knows exactly which PN a question is about. Walks the
// list in order (primary first, matching its historical priority) and
// returns the FIRST unresolved one -- never asks about every gap at once.
export function selectMaterialCostDecisionQuestion(entries = []) {
  for (const entry of entries) {
    const eligible = (entry.rankedSources || []).filter((source) => source.eligible);
    if (["PRICE_MISSING", "AWAITING_SELECTION"].includes(entry.priced?.status) && eligible.length) {
      return {
        kind: "SELECT_PRICE_SOURCE",
        scope: entry.scope,
        partNumber: entry.partNumber,
        productId: entry.productId,
        options: eligible.map((source) => ({ id: source.id, priceType: source.priceType, amount: source.amount, currency: source.currency, reference: source.reference })),
        question: eligible.length === 1
          ? `Confirm ${eligible[0].priceType} (${eligible[0].amount} ${eligible[0].currency}) as the price evidence for ${entry.scope} ${entry.partNumber}.`
          : `Which price evidence should be used for ${entry.scope} ${entry.partNumber} — ${eligible.map((source) => `${source.priceType} (${source.amount} ${source.currency})`).join(", ")}?`,
      };
    }
    if (entry.priced?.status === "EXCHANGE_RATE_MISSING") {
      return { kind: "CONFIRM_EXCHANGE_RATE", scope: entry.scope, partNumber: entry.partNumber, productId: entry.productId, options: [], question: `Confirm the ${entry.priced.selectedSource?.currency}→SAR exchange rate to use for ${entry.scope} ${entry.partNumber} (no approved rate is on record).` };
    }
  }
  return null;
}
