"use client";

import { lineTotalsModel, currencyDisplay } from "../../domain/commercial-line-presentation.mjs";

export function CommercialTotalsBar({ lines, projectCurrency }: { lines: Array<{ extendedCost?: number | null; hasPriceSource?: boolean }> | null; projectCurrency?: string }) {
  const totals = lineTotalsModel(lines);
  if (!lines || !lines.length) {
    return <div className="commercial-totals"><strong>No pricing lines yet</strong><small>Lines appear here once technical handoff produces priced scope. This is not a zero total.</small></div>;
  }
  const shown = currencyDisplay(totals.totalCost, projectCurrency, projectCurrency);
  return <div className="commercial-totals">
    <small>{totals.partial ? "PARTIAL TOTAL" : "TOTAL"}</small>
    <strong>{totals.totalCost == null ? "UNKNOWN" : shown.text}</strong>
    {totals.partial && <small>{totals.label}. Priced {totals.pricedCount} of {totals.totalCount} lines.</small>}
  </div>;
}
