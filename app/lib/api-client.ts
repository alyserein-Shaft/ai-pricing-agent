export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export async function requestJson<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(input, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } })
      .error;
    throw new ApiError(
      response.status,
      error?.code || "REQUEST_FAILED",
      error?.message || `Request failed with HTTP ${response.status}`,
    );
  }
  return payload as T;
}

export async function commandThenRefresh<TCommand, TRead>(options: {
  command: () => Promise<TCommand>;
  refresh: () => Promise<TRead>;
}) {
  const commandResult = await options.command();
  const readModel = await options.refresh();
  return { commandResult, readModel };
}

export const projectApi = {
  dashboard: (projectId: string) =>
    `/api/projects/${encodeURIComponent(projectId)}/dashboard`,
  workflow: (projectId: string) =>
    `/api/projects/${encodeURIComponent(projectId)}/presales-workflow`,
  lifecycle: (projectId: string, operation: "archive" | "restore") =>
    `/api/projects/${encodeURIComponent(projectId)}/${operation}`,
};

export const technicalApi = {
  requirementAction: (requirementId: string, operation: string) =>
    `/api/requirements/${encodeURIComponent(requirementId)}/${operation}`,
  requirementHistory: (requirementId: string) =>
    `/api/requirements/${encodeURIComponent(requirementId)}/history`,
  matching: (itemId: string, operation: string) =>
    `/api/boq-items/${encodeURIComponent(itemId)}/matching/${operation}`,
  safety: (candidateId: string, operation = "") =>
    `/api/match-candidates/${encodeURIComponent(candidateId)}/safety${operation ? `/${operation}` : ""}`,
};

export const commercialApi = {
  scenarios: (projectId: string) =>
    `/api/pricing/projects/${encodeURIComponent(projectId)}/scenarios`,
  selectedScenario: (projectId: string) =>
    `/api/pricing/projects/${encodeURIComponent(projectId)}/selected-scenario`,
  pricingLine: (itemId: string, scenarioId: string) =>
    `/api/pricing/items/${encodeURIComponent(itemId)}?scenarioId=${encodeURIComponent(scenarioId)}`,
  calculatePricing: (itemId: string) =>
    `/api/pricing/items/${encodeURIComponent(itemId)}/calculate`,
  manualPrice: (itemId: string, scenarioId: string) =>
    `/api/pricing/items/${encodeURIComponent(itemId)}/manual-price?scenarioId=${encodeURIComponent(scenarioId)}`,
  productPrices: (productId: string, projectId: string) =>
    `/api/products/${encodeURIComponent(productId)}/prices?projectId=${encodeURIComponent(projectId)}`,
  priceSources: (projectId: string) =>
    `/api/library/sources?projectId=${encodeURIComponent(projectId)}`,
  prices: (projectId: string) =>
    `/api/library/prices?projectId=${encodeURIComponent(projectId)}&pageSize=200`,
  reviewPriceSource: (sourceId: string) =>
    `/api/price-sources/${encodeURIComponent(sourceId)}/review`,
  ingestLibraryDocument: (versionId: string) =>
    `/api/library/document-versions/${encodeURIComponent(versionId)}/ingest`,
  reviewQueue: (projectId: string, query = "") =>
    `/api/reviews/projects/${encodeURIComponent(projectId)}/queue${query ? `?${query}` : ""}`,
  reviewSummary: (projectId: string) =>
    `/api/reviews/projects/${encodeURIComponent(projectId)}/summary`,
  reviewAction: (reviewId: string, operation: string) =>
    `/api/reviews/${encodeURIComponent(reviewId)}/${operation}`,
  quotation: (projectId: string, operation: "draft" | "approve" | "issue") =>
    `/api/projects/${encodeURIComponent(projectId)}/presales-workflow/quotation/${operation}`,
};
