// Agent 8 -- engineer-decision technical presentation, BOM summary and the
// standardized evidence drawer.
//
// Scope rules encoded here
// ------------------------
// * TECHNICAL ONLY. This model never reads or emits a price, a currency, a
//   discount, a cost total or a quotation figure. The commercial block in
//   EngineerDecisionWorkspace is owned by another lane; the technical view is
//   additive and deliberately price-blind, and `assertNoCommercialFields`
//   exists so that stays true.
// * One primary action. An engineer decision surface that offers three equal
//   buttons has no primary action. `primaryAction` returns exactly one, or
//   null when nothing is actionable.
// * Unknown is never zero. `count()` maps a missing, null or non-numeric value
//   to "Unknown" so an absent record cannot be rendered as "0".
// * Evidence is tiered. A headline rationale, then source labels and warning
//   counts, then the source document/page, and only then identifiers, hashes
//   and raw JSON. Raw JSON is never hoisted into the headline.

const COUNT_UNKNOWN = "Unknown";

export const count = (value) => {
  if (value == null || value === "") return COUNT_UNKNOWN;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : COUNT_UNKNOWN;
};

const text = (value) => (value == null ? "" : String(value).trim());
const COMMERCIAL_FIELDS = [
  "amount", "unitCost", "extendedCost", "currency", "price", "priceType", "exchangeRate",
  "rate", "totalCost", "materialSubtotal", "serviceSubtotal", "selectedSource", "rankedSources",
  "discount", "netPrice", "costDecisionQuestion", "priceEvidenceStatus",
];

// Guard used by tests and by the component: a technical payload that has
// picked up commercial fields is a bug, not something to render.
export function assertNoCommercialFields(payload) {
  const found = [];
  const walk = (value, path) => {
    if (!value || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      if (COMMERCIAL_FIELDS.includes(key)) found.push(`${path}.${key}`);
      walk(entry, `${path}.${key}`);
    }
  };
  walk(payload, "model");
  return found;
}

const COMPOSITE_ACTION = {
  AI_REVIEW_REQUIRED: { kind: "OPEN_UNDERSTANDING", workspace: "AI Understanding Review", label: "Review AI understanding" },
  TECHNICAL_DECISION_REQUIRED: { kind: "SELECT_PRODUCT", workspace: "Technical Matching", label: "Select a product for engineer review" },
  NO_MATCH: { kind: "RUN_MATCHING", workspace: "Technical Matching", label: "Re-run technical matching" },
  STALE_RECALCULATING: { kind: "OPEN_MATCHING", workspace: "Technical Matching", label: "Wait for recalculation or re-run matching" },
  RECALCULATION_FAILED: { kind: "OPEN_MATCHING", workspace: "Technical Matching", label: "Investigate the failed recalculation" },
  BOM_DECISION_REQUIRED: { kind: "OPEN_BOM", workspace: "BOM", label: "Resolve the BOM decision" },
  BOM_EVIDENCE_INCOMPLETE: { kind: "OPEN_BOM", workspace: "BOM", label: "Complete the BOM evidence" },
  TECHNICALLY_READY: { kind: "OPEN_BOM", workspace: "BOM", label: "Continue to the bill of materials" },
};

// The single primary action, derived from the governed composite state. Only
// states that actually need an engineer are mapped; an unmapped state yields
// null rather than a guessed button.
export function decisionPrimaryAction(compositeState, { safetyBlocks = [] } = {}) {
  const blockingSafety = safetyBlocks.filter((block) => text(block?.status || "OPEN").toUpperCase() !== "RESOLVED");
  if (blockingSafety.length > 0) {
    const first = blockingSafety[0];
    return { kind: "RESOLVE_BLOCK", workspace: "Technical Matching", label: text(first.user_message) || "Resolve the blocking technical issue", blockCode: text(first.code) || null, resolutionAction: text(first.resolution_action) || null, owner: text(first.owner) || null };
  }
  const mapped = COMPOSITE_ACTION[text(compositeState)];
  return mapped ? { ...mapped, blockCode: null, resolutionAction: null, owner: null } : null;
}

export function engineerDecisionTechnicalModel({ decision = null, bom = null } = {}) {
  if (!decision) return { available: false, reason: "No decision record loaded." };

  const understanding = decision.understanding || {};
  const family = understanding.familyClassification || null;
  const safety = decision.safety || null;
  const safetyBlocks = (safety?.blocks || []).filter(Boolean);
  const candidates = Array.isArray(decision.candidates) ? decision.candidates.filter(Boolean) : [];
  const primary = bom?.primaryProduct || null;

  const selectedProduct = primary
    ? {
        partNumber: text(primary.partNumber) || null,
        manufacturer: text(primary.manufacturer) || null,
        family: text(primary.family) || null,
        approved: Boolean(primary.approved),
        label: [text(primary.manufacturer), text(primary.partNumber)].filter(Boolean).join(" · ") || "Product identity missing",
      }
    : null;

  const why = [];
  if (family && text(family.decisionBasis)) {
    why.push({ label: "Classification basis", detail: `${text(family.productFamily) || "Family not established"} — ${text(family.decisionBasis)} (${text(family.origin)}${family.confidence != null ? ` · ${text(family.confidence)}%` : ""})` });
  }
  if (safety && text(safety.explanation)) why.push({ label: "Technical safety decision", detail: text(safety.explanation) });
  const leading = candidates.find((candidate) => candidate.candidateId === primary?.productId) || candidates[0] || null;
  if (leading) {
    if (text(leading.rankingReason)) why.push({ label: "Why this candidate leads", detail: text(leading.rankingReason) });
    else if (text(leading.explanation)) why.push({ label: "Candidate explanation", detail: text(leading.explanation) });
  }

  const consolidated = Array.isArray(decision.requirements?.consolidated) ? decision.requirements.consolidated : [];
  const clarifications = Array.isArray(decision.requirements?.openClarifications) ? decision.requirements.openClarifications.filter(Boolean) : [];
  const evidence = {
    applicableRequirements: consolidated.length,
    applicableRequirementsLabel: count(consolidated.length),
    openClarifications: clarifications.length,
    openClarificationsLabel: count(clarifications.length),
    safetyState: text(safety?.safetyState) || "Not evaluated",
    complianceState: text(safety?.complianceState) || "Not evaluated",
    recalculationStatus: text(decision.recalculation?.status) || "Unknown",
    sources: consolidated.slice(0, 8).map((requirement) => ({
      id: text(requirement.id) || null,
      priority: text(requirement.priority) || "Unspecified priority",
      text: text(requirement.normalizedRequirement) || "Requirement text missing",
    })),
  };

  const openIssues = [];
  for (const block of safetyBlocks) {
    if (text(block.status || "OPEN").toUpperCase() === "RESOLVED") continue;
    openIssues.push({ kind: "SAFETY_BLOCK", code: text(block.code) || null, detail: text(block.user_message) || "Blocking technical issue", owner: text(block.owner) || null, resolutionAction: text(block.resolution_action) || null });
  }
  for (const clarification of clarifications) openIssues.push({ kind: "CLARIFICATION", code: null, detail: text(clarification.question) || "Open clarification", owner: null, resolutionAction: null });
  const composite = text(decision.composite?.state);
  if (composite && !["TECHNICALLY_READY", "BOM_READY"].includes(composite)) {
    openIssues.push({ kind: "COMPOSITE", code: composite, detail: text(decision.composite?.label) || composite, owner: null, resolutionAction: null });
  }

  const alternatives = candidates
    .filter((candidate) => !primary || candidate.candidateId !== primary.productId)
    .map((candidate) => ({
      candidateId: candidate.candidateId,
      partNumber: text(candidate.partNumber) || null,
      manufacturer: text(candidate.manufacturer) || null,
      technicalStatus: text(candidate.technicalStatus) || "Not evaluated",
      confidence: text(candidate.confidence) || "Unknown",
      viable: candidate.isViable !== false,
      fallback: Boolean(candidate.isFallbackCandidate),
    }));

  return Object.freeze({
    available: true,
    itemReference: text(decision.itemReference) || null,
    description: text(decision.description) || null,
    compositeState: composite || null,
    selectedProduct,
    why,
    evidence,
    openIssues,
    alternatives,
    primaryAction: decisionPrimaryAction(composite, { safetyBlocks }),
  });
}

const ROLE_LABELS = Object.freeze({
  REQUIRED_COMPONENT: "Required",
  CONDITIONAL_COMPONENT: "Conditional",
  OPTIONAL_COMPONENT: "Optional",
  COMPATIBLE_ALTERNATIVE: "Compatible alternative",
  NOT_APPLICABLE: "Not applicable",
});

// Concise, technical-only BOM/accessory summary with a deep link to the BOM
// workspace. It deliberately exposes roles, unresolved decisions and quantity
// provenance -- never money.
export function bomAccessorySummary(bom = null) {
  if (!bom) return { available: false, reason: "No bill of materials record loaded.", totals: null, byRole: [], unresolved: [], link: null };
  const components = Array.isArray(bom.components) ? bom.components.filter(Boolean) : [];
  const byRole = [];
  for (const role of Object.keys(ROLE_LABELS)) {
    const items = components.filter((component) => component.role === role);
    if (items.length) byRole.push({ role, label: ROLE_LABELS[role], count: items.length, countLabel: count(items.length) });
  }
  const unresolved = components
    .filter((component) => component.decisionNeeded)
    .map((component) => ({
      role: component.role,
      roleLabel: ROLE_LABELS[component.role] || text(component.role) || "Unclassified role",
      partNumber: text(component.accessoryPartNumber) || null,
      relationshipType: text(component.relationshipType) || null,
    }));
  const missingQuantity = components.filter((component) => component.quantity?.value == null).length;

  return Object.freeze({
    available: true,
    totals: {
      components: components.length,
      componentsLabel: count(components.length),
      unresolved: unresolved.length,
      unresolvedLabel: count(unresolved.length),
      missingQuantity: missingQuantity,
      missingQuantityLabel: count(missingQuantity),
    },
    byRole,
    unresolved,
    primaryQuantity: bom.primaryQuantity
      ? { value: bom.primaryQuantity.value, label: bom.primaryQuantity.value == null ? "Missing" : `${bom.primaryQuantity.value} ${text(bom.primaryQuantity.unit) || ""}`.trim(), origin: text(bom.primaryQuantity.origin) || "Unknown origin" }
      : null,
    readiness: bom.readiness ? { state: text(bom.readiness.state) || "Unknown", label: text(bom.readiness.label) || "" } : { state: "Unknown", label: "" },
    // Deep link target only -- this summary never embeds commercial data and
    // never performs a write.
    link: { workspace: "BOM", label: "Open the full bill of materials" },
  });
}

// One drawer shape for all three surfaces: short rationale first, then source
// labels and warning counts, then the source document/page, and identifiers,
// hashes and raw JSON last.
export function evidenceDrawerModel({ rationale = "", sources = [], warnings = [], document = null, identifiers = {}, raw = null } = {}) {
  const sourceList = Array.isArray(sources) ? sources.filter(Boolean) : [];
  const warningList = Array.isArray(warnings) ? warnings.filter(Boolean) : [];
  const tiers = [
    {
      id: "rationale",
      label: "Why this is shown",
      kind: "SUMMARY",
      // A headline must never be the raw record.
      value: text(rationale) || "No rationale recorded for this result.",
    },
    {
      id: "sources",
      label: "Sources and warnings",
      kind: "COUNTS",
      value: {
        sourceLabels: sourceList.map((source) => text(source.label) || "Unlabelled source"),
        sourceCountLabel: count(sourceList.length),
        warningCountLabel: count(warningList.length),
        warningSummaries: warningList.slice(0, 5).map((warning) => text(warning.message) || text(warning.code) || "Unspecified warning"),
      },
    },
    {
      id: "document",
      label: "Source document",
      kind: "DOCUMENT",
      value: {
        document: text(document?.logicalName ?? document?.name ?? document?.documentName) || "Source document not recorded",
        page: document?.page == null ? "Page not recorded" : `Page ${text(document.page)}`,
        sheet: text(document?.sheet) || null,
        clause: text(document?.clause) || null,
      },
    },
    {
      id: "advanced",
      label: "Advanced identifiers and raw record",
      kind: "RAW",
      value: {
        identifiers: Object.entries(identifiers || {})
          .filter(([, value]) => value != null && String(value).trim() !== "")
          .map(([key, value]) => ({ key, value: String(value) })),
        raw: raw == null ? null : typeof raw === "string" ? raw : JSON.stringify(raw),
      },
    },
  ];

  return Object.freeze({
    tiers,
    // The headline is tier one only; raw JSON is confined to the advanced tier.
    headline: tiers[0].value,
    hasRawRecord: tiers[3].value.raw != null,
    identifierCountLabel: count(tiers[3].value.identifiers.length),
  });
}
