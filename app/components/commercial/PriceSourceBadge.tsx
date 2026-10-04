"use client";

import { priceSourceBadge, handoffChip } from "../../domain/commercial-line-presentation.mjs";

export function PriceSourceBadge({ source }: { source: { kind?: string; reference?: string; version?: string; date?: string; validityState?: string } | null }) {
  const badge = priceSourceBadge(source);
  return <span className={badge.stale || badge.kind === "MISSING" ? "review-blocked" : "review-ready"}>
    <strong>{badge.label}</strong>
    <small>{badge.detail}{badge.stale ? " · STALE" : ""}</small>
  </span>;
}

export function TechnicalHandoffChip({ technicalState }: { technicalState: string }) {
  const chip = handoffChip(technicalState);
  return <span className={chip.tone}>
    <strong>{chip.chip}</strong>
    {chip.blocksPricing && <small> · blocks pricing readiness</small>}
  </span>;
}
