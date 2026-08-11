const CURRENT_STATES = new Set(["Current", "Expiring soon"]);

export const priceEvidenceValidity = (item, today) => {
  if (item.status !== "Costed") return { status: "Unpriced", validUntil: "", daysRemaining: null };
  const validUntil = item.approvedSource?.match(/valid until (\d{4}-\d{2}-\d{2})/i)?.[1] || "";
  if (!validUntil) return { status: "Validity missing", validUntil: "", daysRemaining: null };
  const daysRemaining = Math.ceil((Date.parse(`${validUntil}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  if (validUntil < today) return { status: "Expired", validUntil, daysRemaining };
  if (daysRemaining <= 7) return { status: "Expiring soon", validUntil, daysRemaining };
  return { status: "Current", validUntil, daysRemaining };
};

export const hasCurrentPriceEvidence = (item, today) => CURRENT_STATES.has(priceEvidenceValidity(item, today).status);

export const summarizePriceEvidence = (items, today) => items.map((item) => ({ item, ...priceEvidenceValidity(item, today) }));
