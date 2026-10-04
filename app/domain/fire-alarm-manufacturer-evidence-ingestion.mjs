// GOLDEN-7A2 -- governed manufacturer evidence ingestion & product discovery
// readiness.
//
// WHAT THIS IS.
//
// The mechanism that turns a manufacturer's published evidence into governed
// product facts: it ranks source authority, preserves provenance, reconciles the
// discovered model against EXISTING canonical product identities, normalizes
// capabilities through the GOLDEN-7A normalizer, and reports discovery readiness
// WITH its blocker.
//
// WHAT IT DELIBERATELY DOES NOT DO.
//
// It never sets `approved_for_discovery`. That column is a governed HUMAN review
// outcome (worker/product-price-library-api.mjs `approve-discovery`, which
// requires a global-governance role, a substantive reason, and writes a decision
// audit row; the deterministic auto-approve policy in
// worker/product-auto-review.mjs additionally requires review_status='Reviewed'
// first). Evidence completeness and business approval are different facts, and
// this module keeps them different.
//
// It also never creates a product identity. A manufacturer document is a
// DISCOVERY LEAD; an identity is created only through the existing governed
// product-identity workflow. `reconcileAgainstExistingIdentities` therefore
// reports `EXISTING_IDENTITY` or `NEW_CANDIDATE_IDENTITY` and stops.
//
// SOURCE AUTHORITY (mission section 8).
//
// A reseller or distributor page may produce a discovery lead. It may never
// establish technical truth. Every normalized claim therefore carries the
// authority of the document it came from, and a claim whose only support is
// below-manufacturer is emitted as UNVERIFIED rather than as a fact.

import {
  normalizeFireAlarmPanelCapability,
  normalizeEcosystemIdentity,
  areSameProductIdentity,
  detectCapacityConflicts,
  assessSizingReadiness,
} from "./fire-alarm-panel-capability-normalization.mjs";

export const FIRE_ALARM_MANUFACTURER_EVIDENCE_VERSION =
  "fire-alarm-manufacturer-evidence-ingestion-1.0.0";

// ---------------------------------------------------------------------------
// Section 8 -- the source authority hierarchy. Ordered, and the ONLY place a
// source type is ranked, so "is this authoritative" is never decided ad hoc.
// ---------------------------------------------------------------------------
export const SOURCE_AUTHORITY = Object.freeze({
  MANUFACTURER_PRODUCT_PAGE: { rank: 1, authoritative: true, kind: "manufacturer" },
  MANUFACTURER_DATASHEET: { rank: 1, authoritative: true, kind: "manufacturer" },
  MANUFACTURER_INSTALL_MANUAL: { rank: 1, authoritative: true, kind: "manufacturer" },
  MANUFACTURER_COMPATIBILITY_DOCUMENT: { rank: 1, authoritative: true, kind: "manufacturer" },
  MANUFACTURER_CERTIFICATION_LISTING: { rank: 1, authoritative: true, kind: "manufacturer" },
  MANUFACTURER_LIFECYCLE_NOTICE: { rank: 1, authoritative: true, kind: "manufacturer" },
  // A certification LISTING body is independent of the manufacturer but
  // authoritative for certification only, never for capacity.
  CERTIFICATION_BODY_LISTING: { rank: 2, authoritative: true, kind: "certification_body", scope: "certification" },
  // Discovery leads only. Never technical truth.
  RESELLER_CATALOG: { rank: 4, authoritative: false, kind: "reseller" },
  DISTRIBUTOR_MARKETING_PAGE: { rank: 4, authoritative: false, kind: "distributor" },
  THIRD_PARTY_CATALOG: { rank: 5, authoritative: false, kind: "third_party" },
});

export const authorityOf = (sourceType) =>
  SOURCE_AUTHORITY[String(sourceType ?? "").toUpperCase()] || null;


// ---------------------------------------------------------------------------
// Section 9 -- one evidence document. Provenance is mandatory: a normalized
// number without its source semantics is not admissible.
// ---------------------------------------------------------------------------
export const buildEvidenceDocument = ({
  sourceType,
  manufacturer,
  title,
  url = null,
  revision = null,
  documentDate = null,
  region = null,
  retrievedOn = null,
} = {}) => {
  const resolved = String(sourceType ?? "").toUpperCase();
  const authority = authorityOf(resolved);
  if (!authority) {
    throw new Error(`GOLDEN7A2_UNKNOWN_SOURCE_TYPE: No authority is defined for source type "${sourceType}".`);
  }
  return {
    sourceType: resolved,
    authorityRank: authority.rank,
    authoritative: authority.authoritative,
    // A certification body may speak only to certification.
    authorityScope: authority.scope ?? "technical_and_certification",
    kind: authority.kind,
    manufacturer: String(manufacturer ?? "").trim() || null,
    title: String(title ?? "").trim() || null,
    url: url ? String(url).trim() : null,
    revision: String(revision ?? "").trim() || null,
    documentDate: documentDate ? String(documentDate).trim() : null,
    region: region ? String(region).trim() : null,
    retrievedOn: retrievedOn ? String(retrievedOn).trim() : null,
  };
};


/**
 * Ingests ONE manufacturer's published claim for ONE model.
 *
 * The claim carries the manufacturer's own words (`claimText`) plus the document
 * it came from. Capabilities are normalized by the GOLDEN-7A normalizer, and the
 * resulting record states plainly whether the evidence is authoritative enough to
 * be treated as technical fact.
 */
export function ingestManufacturerEvidence({
  document,
  manufacturer,
  brand = null,
  declaredEcosystem = null,
  family = null,
  model,
  claimText,
  variantLabel = null,
  region = null,
  lifecycleClaim = null,
} = {}) {
  const doc = document;
  if (!doc || typeof doc !== "object") {
    throw new Error("GOLDEN7A2_DOCUMENT_REQUIRED: Manufacturer evidence must carry its source document.");
  }
  const partNumber = String(model ?? "").trim();
  if (!partNumber) {
    throw new Error("GOLDEN7A2_MODEL_REQUIRED: Manufacturer evidence must name an exact model.");
  }

  const technicalAuthority = doc.authoritative && doc.authorityScope !== "certification";
  const text = String(claimText ?? "");

  // Reuse the canonical normalizer. A non-authoritative document still runs it,
  // so a lead is recorded in the same shape, but the record is marked UNVERIFIED
  // rather than being promoted to a fact.
  const normalized = normalizeFireAlarmPanelCapability({
    partNumber,
    description: text,
    family,
    manufacturer,
    brand,
    declaredEcosystem,
    recordedLifecycleStatus: lifecycleClaim,
    // Certification extraction is authority-sensitive.
    sources: [{ sourceType: technicalAuthority ? "MANUFACTURER_DOCUMENT" : "CATALOG_TEXT_UNVERIFIED" }],
  });

  // A certification-body source may establish certification and nothing else, so
  // its technical capabilities are dropped rather than trusted.
  const capabilities = technicalAuthority ? normalized.capabilities : [];
  const capacities = technicalAuthority ? normalized.capacities : [];
  const certifications = normalized.certifications.map((claim) => ({
    ...claim,
    // A certification claim is only Evidenced when an authoritative document
    // supports it; UL never implies FM, and EN54 never implies LPCB.
    authority: technicalAuthority || doc.authorityScope === "certification"
      ? "AUTHORITATIVE_DOCUMENT"
      : "CATALOG_TEXT_UNVERIFIED",
    status: technicalAuthority || doc.authorityScope === "certification" ? "Evidenced" : "Unverified",
    sourceDocument: { sourceType: doc.sourceType, title: doc.title, url: doc.url, revision: doc.revision, region: doc.region },
  }));

  const ecosystem = normalizeEcosystemIdentity({ manufacturer, brand, declaredEcosystem });

  // Section 17 -- lifecycle is never inferred from a live webpage or an old
  // manual, and never from a non-authoritative source.
  const lifecycleClaimText = String(lifecycleClaim ?? "").trim().toUpperCase();
  let lifecycle;
  if (!technicalAuthority) {
    // A reseller page saying "new" is not a manufacturer lifecycle statement.
    lifecycle = { lifecycleStatus: "UNKNOWN", basis: "NON_AUTHORITATIVE_SOURCE", inferredFromDocumentRecency: false, replacementProductId: null };
  } else if (doc.sourceType === "MANUFACTURER_LIFECYCLE_NOTICE"
    || ["CURRENT", "LEGACY", "DISCONTINUED", "REPLACED"].includes(lifecycleClaimText)) {
    lifecycle = { lifecycleStatus: lifecycleClaimText || "UNKNOWN", basis: doc.sourceType, inferredFromDocumentRecency: false, replacementProductId: null };
  } else {
    lifecycle = { lifecycleStatus: "UNKNOWN", basis: "NO_LIFECYCLE_EVIDENCE", inferredFromDocumentRecency: false, replacementProductId: null };
  }

  return {
    version: FIRE_ALARM_MANUFACTURER_EVIDENCE_VERSION,
    // Sections 5/6 -- identity kept at five separate levels.
    identity: {
      manufacturer: String(manufacturer ?? "").trim() || null,
      brand: String(brand ?? "").trim() || null,
      // Section 36 -- never collapsed to the manufacturer name.
      ecosystem: ecosystem.ecosystem,
      ecosystemBasis: ecosystem.basis,
      family: family ? String(family).trim() : null,
      model: partNumber,
      canonicalModel: normalized.identity.canonicalPartNumber,
      variant: variantLabel ? String(variantLabel).trim() : null,
      region: region ? String(region).trim() : null,
      productType: "Fire Alarm Control Panel",
    },
    evidenceStatus: technicalAuthority ? "AUTHORITATIVE" : "UNVERIFIED_DISCOVERY_LEAD",
    technicalAuthority,
    provenance: {
      sourceType: doc.sourceType,
      authorityRank: doc.authorityRank,
      authoritative: doc.authoritative,
      kind: doc.kind,
      manufacturer: doc.manufacturer,
      title: doc.title,
      url: doc.url,
      revision: doc.revision,
      documentDate: doc.documentDate,
      region: doc.region,
      retrievedOn: doc.retrievedOn,
      // Section 9 -- the manufacturer's original words are never discarded.
      originalText: text,
    },
    capabilities,
    capacities,
    certifications,
    protocols: technicalAuthority ? normalized.protocols : [],
    expansionRelationships: technicalAuthority ? normalized.expansionRelationships : [],
    lifecycle,
    // Section 24/31 -- technical discoverability is assessed, never granted.
    discovery: { approvedForDiscovery: null, blocked: true, blocker: "GOVERNED_PRODUCT_REVIEW_REQUIRED" },
  };
}


/**
 * Section 4 -- reconcile a discovered model against EXISTING canonical
 * identities BEFORE any new identity is contemplated.
 *
 * Matching is exact on the canonical part number, or a proven formatting alias
 * (section 5). Fuzzy similarity never merges, and a meaningful suffix difference
 * keeps two identities apart.
 */
export function reconcileAgainstExistingIdentities({ ingested, existingIdentities = [] }) {
  const canonical = ingested.identity.canonicalModel;
  const exact = existingIdentities.find((identity) =>
    areSameProductIdentity(identity.partNumber ?? identity.canonicalModel, canonical));
  if (exact) {
    return {
      resolution: "EXISTING_IDENTITY",
      productId: exact.id ?? null,
      matchedOn: "CANONICAL_PART_NUMBER",
      // An existing identity is ENRICHED, never replaced.
      action: "ENRICH_EXISTING_IDENTITY",
      newIdentityRequired: false,
    };
  }
  // A different suffix is a different model, not a near-duplicate.
  const near = existingIdentities.find((identity) => {
    const other = identity.canonicalModel ?? identity.partNumber;
    return typeof other === "string" && other.length > 0 && other !== canonical
      && (other.startsWith(canonical) || canonical.startsWith(other));
  });
  return {
    resolution: "NEW_CANDIDATE_IDENTITY",
    productId: null,
    matchedOn: null,
    action: "REFER_TO_GOVERNED_IDENTITY_WORKFLOW",
    newIdentityRequired: true,
    // Reported, never merged: these are candidate related models, not matches.
    relatedButDistinct: near ? [near.id ?? null].filter(Boolean) : [],
    distinctReason: near ? "A suffix/region/capacity variant is a distinct model, not a formatting alias." : null,
  };
}

// ---------------------------------------------------------------------------
// Sections 18/30 -- conflict handling across ingested records for one model.
// ---------------------------------------------------------------------------
export const reconcileConflicts = (records) => detectCapacityConflicts(records);

// ---------------------------------------------------------------------------
// Section 27/28 -- coverage matrix. Every row must be evidence-backed; a model
// with no authoritative evidence still appears, with its gap stated.
// ---------------------------------------------------------------------------
export function buildCoverageMatrix(ingestedRecords, { existingIdentities = [] } = {}) {
  const rows = ingestedRecords.map((record) => {
    const reconciliation = reconcileAgainstExistingIdentities({ ingested: record, existingIdentities });
    const conflicts = reconcileConflicts([{ sourceId: record.provenance.sourceType, sourceType: record.provenance.sourceType, capacities: record.capacities }]);
    const sizing = assessSizingReadiness({ capacities: record.capacities, conflicts });
    return {
      ecosystem: record.identity.ecosystem ?? "(unresolved)",
      manufacturer: record.identity.manufacturer,
      brand: record.identity.brand,
      family: record.identity.family,
      model: record.identity.model,
      variant: record.identity.variant,
      identity: reconciliation.resolution,
      productId: reconciliation.productId,
      evidenceStatus: record.evidenceStatus,
      certifications: record.certifications.map((c) => `${c.certification}:${c.status}`).join("+") || "none",
      capacity: record.capacities.map((c) => `${c.scope}=${c.value}`).join("+") || "none",
      lifecycle: record.lifecycle.lifecycleStatus,
      // Section 31 -- discovery and sizing readiness are separate axes.
      discovery: record.discovery.approvedForDiscovery === null ? "REVIEW_REQUIRED" : "READY",
      sizing: sizing.state,
      sizingMissing: sizing.missing,
      conflicts: conflicts.length > 0 ? "CONFLICTING_PRODUCT_DATA" : "none",
      source: record.provenance.sourceType,
    };
  });
  return rows.sort((left, right) => `${left.ecosystem}${left.model}`.localeCompare(`${right.ecosystem}${right.model}`));
}

// ---------------------------------------------------------------------------
// Section 22 -- discovery readiness assessment.
//
// This REPORTS the blocker. It never clears it, and it never reads price as
// evidence (section 24/25).
// ---------------------------------------------------------------------------
export const DISCOVERY_BLOCKERS = Object.freeze({
  NO_AUTHORITATIVE_EVIDENCE: "No authoritative manufacturer evidence supports this model.",
  IDENTITY_NOT_GOVERNED: "The model has no governed canonical product identity yet.",
  LIFECYCLE_UNRESOLVED: "Product lifecycle/currentness is not established by a manufacturer notice.",
  CAPACITY_CONFLICT: "Authoritative sources disagree on a capacity claim.",
  GOVERNED_PRODUCT_REVIEW_REQUIRED: "Business discovery approval is a separate governed human review and has not been performed.",
});

export function assessDiscoveryReadiness({ ingested, reconciliation, hasPriceRows = false, priceUsedAsEvidence = false } = {}) {
  const blockers = [];
  if (ingested.evidenceStatus !== "AUTHORITATIVE") blockers.push(DISCOVERY_BLOCKERS.NO_AUTHORITATIVE_EVIDENCE);
  if (reconciliation?.newIdentityRequired) blockers.push(DISCOVERY_BLOCKERS.IDENTITY_NOT_GOVERNED);
  if (ingested.lifecycle.lifecycleStatus === "UNKNOWN") blockers.push(DISCOVERY_BLOCKERS.LIFECYCLE_UNRESOLVED);
  if (priceUsedAsEvidence) {
    // Section 24/25 -- this is a programming error, surfaced rather than absorbed.
    blockers.push("PRICE_ROWS_ARE_NOT_TECHNICAL_AUTHORITY");
  }
  blockers.push(DISCOVERY_BLOCKERS.GOVERNED_PRODUCT_REVIEW_REQUIRED);

  return {
    // Section 23 -- evidence completeness is NOT approval.
    evidenceComplete: blockers.every((blocker) => blocker === DISCOVERY_BLOCKERS.GOVERNED_PRODUCT_REVIEW_REQUIRED),
    approvedForDiscovery: false,
    approvedForDiscoveryChangedByThisModule: false,
    blockers,
    technicalMatchCandidate: ingested.evidenceStatus === "AUTHORITATIVE" && !reconciliation?.newIdentityRequired,
    priceRowsPresent: hasPriceRows,
    priceRowsUsedAsTechnicalAuthority: priceUsedAsEvidence,
  };
}
