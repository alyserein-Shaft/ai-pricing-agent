export function pricingLineModel(item, payload) {
  const line = payload?.line || null;
  const output = line?.output || payload?.result || null;
  const selectedSource = output?.selectedSource || null;
  return Object.freeze({
    itemId: item.id,
    itemNumber: item.item_number,
    description: item.description,
    status: line?.status || payload?.status || "Not Started",
    version: Number(line?.version_number || payload?.version || 0),
    selectedSource,
    result: output,
  });
}

export function pricingSourcePresentation(source) {
  if (!source) return { label: "No governed source selected", costingApproved: false };
  const historical = /historical|catalog|discovery/i.test(`${source.type || ""} ${source.downstreamUse || ""}`);
  const eligible = source.eligibleForCosting === true && !historical;
  return { label: historical ? "Historical / Discovery Only" : eligible ? "Current costing-eligible source" : "Source not approved for costing", costingApproved: eligible };
}

export function quotationTotals(quotation) {
  const amount = (snake, camel) => Number(quotation?.[snake] ?? quotation?.[camel] ?? 0) / 100;
  return { subtotal: amount("subtotal_minor", "subtotalMinor"), vat: amount("vat_minor", "vatMinor"), total: amount("total_minor", "totalMinor") };
}

export function quotationActionState(workflow, quotation, stale) {
  return Object.freeze({
    canDraft: Boolean(workflow?.readyForQuotation && (!quotation || stale)),
    canApprove: Boolean(workflow?.readyForQuotation && quotation?.status === "Draft" && !stale),
    canIssue: Boolean(workflow?.readyForIssue && quotation?.status === "Approved" && !stale),
  });
}
