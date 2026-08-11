export const ESTIMATOR_READINESS_VERSION = "estimator-readiness-v1";
export const ESTIMATOR_ROW_STATUSES = Object.freeze(["READY", "REVIEW", "MISSING", "EXCLUDED"]);

const present = (value) => value !== null && value !== undefined && String(value).trim() !== "";
const parse = (value, fallback) => { if (value && typeof value === "object") return value; try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; } };
const list = (value) => Array.isArray(value) ? value : parse(value, []);
const textList = (value) => list(value).map((entry) => typeof entry === "string" ? entry : entry?.result || entry?.message || entry?.code).filter(Boolean);
const confirmedCandidate = (row) => ["Approved", "Accepted", "Selected", "Confirmed"].includes(row.candidateReviewStatus) || row.technicalApprovalStatus === "Approved";
const usablePrice = (row, today) => Boolean(row.priceRecordId && row.priceApprovalStatus === "Approved" && row.priceDownstreamUse === "Costing" && present(row.priceValidUntil) && row.priceValidUntil >= today && Number(row.unitCostMinor) >= 0);
const contradictory = (row) => textList(row.mandatoryFailures).length > 0 || /block|ineligible|non.?compliant|contradiction/i.test(`${row.safetyState || ""} ${row.technicalEligibility || ""}`);
const excluded = (row) => row.rowType === "Excluded" || present(row.excludedScope);

export function deriveEstimatorRowReadiness(row, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const quantity = present(row.numericQuantity) ? Number(row.numericQuantity) : null;
  const unit = row.normalizedUnit || row.originalUnit || null;
  const description = row.description || null;
  const isExcluded = excluded(row);
  const hasCandidate = Boolean(row.candidateId && row.productId);
  const isConfirmed = hasCandidate && confirmedCandidate(row);
  const priceUsable = usablePrice(row, today);
  const hasPriceCandidate = Boolean(row.priceRecordId || row.pricingLineId);
  const hasContradiction = contradictory(row);
  const essential = [];
  if (!present(description)) essential.push("Description is missing");
  else if (String(description).trim().length < 3) essential.push("Description is too ambiguous to identify equipment");
  if (quantity === null || !Number.isFinite(quantity)) essential.push("Quantity is missing");
  if (!present(unit)) essential.push("Unit is missing");
  if (!hasCandidate) essential.push("No usable product candidate");
  if (!priceUsable) essential.push(hasPriceCandidate ? "No usable current price" : "No usable price evidence");

  const review = [];
  if (hasCandidate && !isConfirmed) review.push("Product suggestion requires engineer confirmation");
  if (hasCandidate && /medium|low|review/i.test(`${row.confidenceState || ""} ${row.recommendationTier || ""}`)) review.push("Product confidence requires engineer review");
  if (hasPriceCandidate && !priceUsable) review.push("Price candidate requires selection or current approval");
  const blockers = hasContradiction ? ["Known blocking technical contradiction"] : [];

  let status = "READY";
  let reasons = [];
  if (isExcluded) { status = "EXCLUDED"; reasons = [row.excludedScope || "Excluded from estimator scope"]; }
  else if (essential.length || blockers.length) { status = "MISSING"; reasons = [...blockers, ...essential]; }
  else if (review.length) { status = "REVIEW"; reasons = review; }

  const persistedUnderstanding = parse(row.understandingInterpretation, null);
  return {
    boqItemId: row.boqItemId,
    status,
    extraction: { description, quantity, unit, system: row.system || null, category: row.category || null, source: parse(row.sourceLocation, null) },
    understanding: persistedUnderstanding ? { status: row.understandingStatus === "NEEDS_REVIEW" ? "Needs Review" : "Available", ...persistedUnderstanding } : { status: row.understandingStatus || "Pending", normalizedDescription: row.normalizedDescription || null, system: row.system || null, category: row.category || null, productFamily: row.productFamily || null, attributes: parse(row.understandingAttributes, {}), missingInformation: row.understandingAvailable ? textList(row.understandingMissingInformation) : [] },
    product: hasCandidate ? { selectedCandidateId: row.candidateId, confirmed: isConfirmed, manufacturer: row.manufacturer || null, partNumber: row.partNumber || null, matchConfidence: Number(row.matchConfidence || 0), matchBasis: parse(row.matchBasis, []), source: parse(row.productSource, null) } : null,
    pricing: hasPriceCandidate ? { pricingLineId: row.pricingLineId || null, priceRecordId: row.priceRecordId || null, unitCost: row.unitCostMinor == null ? null : Number(row.unitCostMinor) / 100, currency: row.currency || null, source: parse(row.priceSource, null), validUntil: row.priceValidUntil || null, valid: priceUsable } : null,
    commercial: row.sellingUnitMinor == null ? null : { sellingUnitPrice: Number(row.sellingUnitMinor) / 100, total: row.sellingTotalMinor == null ? null : Number(row.sellingTotalMinor) / 100 },
    reasons: [...new Set(reasons)],
  };
}

export function deriveEstimatorReadiness(rows, options) {
  const items = rows.map((row) => deriveEstimatorRowReadiness(row, options));
  const summary = { total: items.length, ready: 0, review: 0, missing: 0, excluded: 0, aiCoverage: 0, quotationCoverage: 0 };
  for (const item of items) summary[item.status.toLowerCase()] += 1;
  const active = summary.total - summary.excluded;
  summary.aiCoverage = active ? Number((((summary.ready + summary.review) / active) * 100).toFixed(1)) : 0;
  summary.quotationCoverage = active ? Number(((summary.ready / active) * 100).toFixed(1)) : 0;
  return { modelVersion: ESTIMATOR_READINESS_VERSION, summary, items };
}
