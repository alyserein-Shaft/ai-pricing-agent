"use client";

import { quotationReadinessModel } from "../../domain/commercial-line-presentation.mjs";

export function QuotationReadinessPanel({ quotation }: {
  quotation: {
    revision?: number; approvalState?: string; customer?: string; currency?: string;
    commercialTotal?: number | null; excludedLines?: number; unresolvedLines?: number;
    commercialReady?: boolean; issued?: boolean; createdBy?: string; createdAt?: string; reason?: string;
  } | null;
}) {
  if (!quotation) {
    return <div className="quotation-readiness"><strong>No quotation drafted</strong><small>Draft only when governed commercial readiness permits it.</small></div>;
  }
  const model = quotationReadinessModel(quotation);
  return <div className="quotation-readiness">
    <small>REVISION {model.revision ?? "—"} · {model.approvalState}</small>
    <strong>{model.verdict}</strong>
    {model.excludedNote && <p>{model.excludedNote}</p>}
    {model.unresolvedNote && <p>{model.unresolvedNote}</p>}
    {quotation.createdBy && <small>By {quotation.createdBy}{quotation.createdAt ? ` · ${quotation.createdAt}` : ""}</small>}
    {quotation.reason && <p>{quotation.reason}</p>}
    <button disabled={!model.ready}>Issue quotation</button>
  </div>;
}
