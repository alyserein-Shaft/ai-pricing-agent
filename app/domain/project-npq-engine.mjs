export const NPQ_ENGINE_VERSION = "project-npq-v1.0";

export const NPQ_MANUFACTURER_STRATEGIES = [
  "Fixed Manufacturer",
  "Preferred Manufacturer",
  "Approved Manufacturers",
  "Open Manufacturer",
  "Detect from Specification",
];

export const NPQ_PRICING_STRATEGIES = [
  "Price List",
  "Supplier Quotation",
  "Historical Project",
  "Contract Price",
  "Manual Price",
  "Mixed Sources",
];

export const NPQ_DELIVERY_SCOPES = [
  "Materials Only",
  "Supply and Installation",
  "Supply, Installation, Testing and Commissioning",
];

export const NPQ_EVIDENCE_TYPES = [
  "BOQ",
  "Technical Specifications",
  "Drawings",
  "Approved Vendor List",
  "Datasheets",
  "Supplier Quotations",
  "Previous Projects",
  "Price Lists",
];

const clean = value => String(value ?? "").trim();

const list = value => [...new Set(
  (Array.isArray(value) ? value : [])
    .map(clean)
    .filter(Boolean),
)];

const availability = value =>
  ["Unknown", "Available", "Not available yet"].includes(value)
    ? value
    : "Unknown";

export function normalizeNpQProfile(input = {}) {
  return {
    country: clean(input.country),
    city: clean(input.city),
    location: clean(input.location),
    inquirySubject: clean(input.inquirySubject),
    inquiryReceived: clean(input.inquiryReceived),
    contactName: clean(input.contactName),
    contactEmail: clean(input.contactEmail),
    contactPhone: clean(input.contactPhone),

    primarySystem: clean(input.primarySystem),
    additionalSystems: list(input.additionalSystems),
    deliveryScope: clean(input.deliveryScope),
    scopeNotes: clean(input.scopeNotes),

    manufacturerStrategy:
      NPQ_MANUFACTURER_STRATEGIES.includes(input.manufacturerStrategy)
        ? input.manufacturerStrategy
        : "Detect from Specification",
    preferredManufacturer: clean(input.preferredManufacturer),
    approvedManufacturers: list(input.approvedManufacturers),
    manufacturerNotes: clean(input.manufacturerNotes),

    pricingStrategy:
      NPQ_PRICING_STRATEGIES.includes(input.pricingStrategy)
        ? input.pricingStrategy
        : "Price List",
    primaryPricingSourceType: clean(input.primaryPricingSourceType),
    primaryPricingSourceId: clean(input.primaryPricingSourceId),
    fallbackPricingSources: list(input.fallbackPricingSources),
    projectCurrency: clean(input.projectCurrency || "SAR").toUpperCase(),
    pricingNotes: clean(input.pricingNotes),

    expectedEvidence: list(input.expectedEvidence).filter(value =>
      NPQ_EVIDENCE_TYPES.includes(value),
    ),

    boqAvailability: availability(input.boqAvailability),
    drawingAvailability: availability(input.drawingAvailability),
  };
}

export function validateNpQProfile(input, { forConfirmation = false } = {}) {
  const profile = normalizeNpQProfile(input);
  const missing = [];

  if (!profile.primarySystem) missing.push("primarySystem");
  if (!profile.deliveryScope) missing.push("deliveryScope");
  if (!profile.projectCurrency) missing.push("projectCurrency");
  if (!profile.pricingStrategy) missing.push("pricingStrategy");

  if (
    profile.manufacturerStrategy === "Fixed Manufacturer" &&
    !profile.preferredManufacturer
  ) {
    missing.push("preferredManufacturer");
  }

  if (
    profile.manufacturerStrategy === "Approved Manufacturers" &&
    profile.approvedManufacturers.length === 0
  ) {
    missing.push("approvedManufacturers");
  }

  if (
    forConfirmation &&
    ["Price List", "Supplier Quotation", "Contract Price"].includes(
      profile.pricingStrategy,
    ) &&
    !profile.primaryPricingSourceType
  ) {
    missing.push("primaryPricingSourceType");
  }

  return {
    ok: missing.length === 0,
    code: missing.length ? "NPQ_REQUIRED_FIELDS_MISSING" : null,
    missing,
    profile,
  };
}

const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonical(value[key])]),
    );
  }
  return value;
};

export async function npqFingerprint(profile) {
  const payload = JSON.stringify(
    canonical({
      engineVersion: NPQ_ENGINE_VERSION,
      profile: normalizeNpQProfile(profile),
    }),
  );
  const bytes = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function npqReadiness(profile, status = "Draft") {
  const validation = validateNpQProfile(profile, {
    forConfirmation: status === "Confirmed",
  });

  return {
    status,
    complete: validation.ok,
    missing: validation.missing,
    downstreamAuthority:
      status === "Confirmed" && validation.ok
        ? "AUTHORITATIVE_PROJECT_CONTEXT"
        : "NON_AUTHORITATIVE_DRAFT",
    grantsProductApproval: false,
    grantsPricingApproval: false,
    grantsQuotationApproval: false,
  };
}
