// STAGE 4A -- COMPARISON EVIDENCE ENVELOPE + ENGINEER VIEW MODEL.
//
// Stage 4A-5/4A-6/4A-7: attach to every matcher comparison the evidence why a
// dimension is governed, what the candidate supports, and why that claim is
// trustworthy -- WITHOUT changing scoring, ranking, ceilings, or approval
// paths. The envelope is explanatory/decision evidence, never a ranking boost.
//
// Canonical vocabulary lives in evidence-authority-policy.mjs (authority
// classes, claim roles, evidence kinds, conflict states, applicability scopes,
// the declarative per-dimension authority matrix, and the cross-domain
// conflict policies). This module turns comparisons into envelopes and
// envelopes into an engineer-facing projection.
//
// Purely additive: legacy comparison rows and legacy engine behavior are
// untouched. The matcher wraps envelope construction defensively -- a failure
// of this explanatory layer must never take down matching.
//
// Pure domain logic: no DOM, no fetch, no DB.
import {
  authorityDomainPolicy,
  authorityRoleForClaim,
  classifyEvidenceKind,
  resolveAuthorityClassForSource,
  resolveCrossDomainConflict,
  isMatchingDimension,
  isConflictState,
  APPLICABILITY_SCOPES,
} from "./evidence-authority-policy.mjs";

export const ENVELOPE_VERSION = "evidence-envelope-1.0.0";

const txt = (value) => String(value ?? "").trim();
const norm = (value) => txt(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const productValue = (attribute) => attribute?.normalizedValue ?? attribute?.parsedValue ?? attribute?.value ?? attribute?.originalValue;
const dimName = (name) => norm(name || "").replace(/ /g, "_");

// ---------------------------------------------------------------------------
// Dimension mapping -- comparisonType/attribute name -> MATCHING_DIMENSIONS
// member (or a normalized raw name, which then FAILS CLOSED in the matrix).
// ---------------------------------------------------------------------------
const ATTRIBUTE_DIMENSION = {
  addressing: "addressing",
  protocol: "protocol",
  ip_rating: "ip_rating",
  indoor_outdoor: "indoor_outdoor",
  voltage: "voltage",
  capacity: "capacity",
  mounting: "mounting",
  manufacturer: "manufacturer",
  standard: "standards",
  standards: "standards",
  certification: "certification_listing",
  listing: "certification_listing",
  device_category: "device_category_function",
  device_role: "device_category_function",
  detector_technology: "device_category_function",
};

export const dimensionForComparison = (comparison) => {
  const comparisonType = comparison?.comparisonType || comparison?.type || "";
  const type = norm(comparisonType).replace(/ /g, "_");
  const requirement = comparison?.requirement || {};
  const required = comparison?.required || {};
  const attributeName = requirement?.attributeName || required?.name || requirement?.requirementCategory || "";

  if (/standard/.test(type) && type.startsWith("standard")) return "standards";
  if (type === "certification_listing") return "certification_listing";
  if (type === "lifecycle") return "lifecycle";
  if (type === "manufacturer" || type === "manufacturer_consistency") return "manufacturer";
  if (type === "compatibility") {
    const target = txt(requirement?.targetItem || requirement?.rightEntityId || requirement?.target || requirement?.value || "");
    if (/base/i.test(target)) return "detector_base_compatibility";
    return "facp_compatibility";
  }
  if (type === "accessory") {
    const name = txt(requirement?.accessory || requirement?.output?.accessory || requirement?.statement || "");
    if (/base/i.test(name)) return "detector_base_compatibility";
    return "mounting";
  }
  if (type === "attribute" || type === "technical_attribute" || type === "boq_attribute") {
    const key = dimName(attributeName);
    return ATTRIBUTE_DIMENSION[key] || key;
  }
  return dimName(attributeName) || "unknown";
};

// ---------------------------------------------------------------------------
// Side authority derivation.
// ---------------------------------------------------------------------------
const requirementSources = (requirement) => {
  if (!requirement) return [];
  if (Array.isArray(requirement.sources)) return requirement.sources;
  const probe = requirement.sourceType || requirement.source?.sourceType || requirement.source?.type;
  if (probe) return [{ sourceType: probe, source: typeof requirement.source === "object" ? requirement.source : null, confidence: requirement.confidence }];
  return [];
};

// governing entry: the consolidated requirement's sources are ordered with the
// governing source first (see consolidateRequirements in
// technical-requirement-engine.mjs).
export const requirementAuthorityOf = (requirement) => {
  const sources = requirementSources(requirement);
  if (!sources.length) {
    return {
      authorityClass: null,
      role: "DEFINING",
      standing: "Unconfirmed",
      source: null,
      status: "INSUFFICIENT_AUTHORITY",
      reason: "The requirement carries no governing source.",
    };
  }
  const governing = sources[0];
  const authorityClass = resolveAuthorityClassForSource(governing.sourceType);
  const applicability = requirement?.applicability?.status || null;
  const standing = applicability === "Confirmed Applicable" ? "Confirmed" : applicability === "Suggested Applicable" ? "Suggested" : "Unconfirmed";
  return {
    authorityClass,
    role: "DEFINING",
    standing,
    source: { sourceType: governing.sourceType, document: governing.source || null, confidence: Number(governing.confidence ?? 0) },
    status: authorityClass ? "AUTHORITATIVE" : "INSUFFICIENT_AUTHORITY",
    reason: authorityClass ? null : `Unrecognized source type "${governing.sourceType}"; failing closed.`,
  };
};

// role the requirement side actually plays for this dimension.
export const requirementAuthorityOfDimension = (requirement, dimension) => {
  const base = requirementAuthorityOf(requirement);
  if (!base.authorityClass) return base;
  const roleCheck = authorityRoleForClaim({ dimension, authorityClass: base.authorityClass, claimRole: "DEFINING" });
  return { ...base, status: roleCheck.status, reason: roleCheck.reason ?? base.reason };
};

// product/offered side authority. context: which comparisonType produced the
// offer (Standard -> CERTIFICATION_LISTING, else PRODUCT_TECHNICAL).
export const productAuthorityOf = (offered, comparisonType = "", fallbackClass = "PRODUCT_TECHNICAL") => {
  const offeredObject = offered && typeof offered === "object" ? offered : null;
  const type = norm(comparisonType).replace(/ /g, "_");
  const authorityClass = type.startsWith("standard") || type === "certification_listing" ? "CERTIFICATION_LISTING" : fallbackClass;
  const reviewStatus = offeredObject?.reviewStatus || offeredObject?.review_status || "Unreviewed";
  const standing = /^approved$/i.test(reviewStatus.trim()) ? "Approved" : /^reviewed$/i.test(reviewStatus.trim()) ? "Reviewed" : /^rejected$/i.test(reviewStatus.trim()) ? "Rejected" : "Unreviewed";
  const hasEvidence = Boolean(offeredObject?.evidence || offeredObject?.source || offeredObject?.sourceId || offeredObject?.source_id);
  return {
    authorityClass,
    role: "VERIFYING",
    standing,
    source: {
      productId: offeredObject?.productId || null,
      sourceId: offeredObject?.sourceId || offeredObject?.source_id || null,
      evidence: offeredObject?.evidence || null,
      confidence: Number(offeredObject?.confidence ?? 0),
    },
    hasEvidence,
    status: authorityClass ? "AUTHORITATIVE" : "INSUFFICIENT_AUTHORITY",
    reason: null,
  };
};

// ---------------------------------------------------------------------------
// Evidence kinds per side.
// ---------------------------------------------------------------------------
export const requirementEvidenceKindOf = (requirement) =>
  classifyEvidenceKind({ hasSource: requirementSources(requirement).length > 0, derivedTrace: requirement?.derivedTrace || null, declaredKind: requirement?.evidenceKind, provenance: requirement?.ruleId ? { ruleId: requirement.ruleId } : null });

export const productEvidenceKindOf = (offered) => {
  const object = offered && typeof offered === "object" ? offered : null;
  if (!object) return "MISSING";
  const probe = classifyEvidenceKind({ hasSource: Boolean(object.evidence || object.source || object.sourceId || object.source_id || object.documentId), derivedTrace: object.derivedTrace || null, declaredKind: object.evidenceKind });
  return probe === "MISSING_EVIDENCE_PLACEHOLDER" || probe === "UNKNOWN" ? "MISSING" : probe;
};

// ---------------------------------------------------------------------------
// Per-comparison envelope (4A-5).
// ---------------------------------------------------------------------------
const comparisonOutcomeState = (pass, resultText, crossDomain, dimension) => {
  if (pass !== true) {
    // Missing/insufficient evidence is classified FIRST: an evidence-gap is
    // never mislabeled as a value conflict.
    if (/missing|insufficient/i.test(txt(resultText)) || crossDomain?.state === "MISSING_EVIDENCE" || crossDomain?.state === "INSUFFICIENT_AUTHORITY") return "MISSING_EVIDENCE";
    if (/unknown/i.test(txt(resultText))) return "UNKNOWN";
    if (crossDomain && isConflictState(crossDomain.state) && crossDomain.blocking) return crossDomain.state;
    return "CONFLICTS";
  }
  return "AGREES";
};

const decisionBasisFor = ({ dimension, requirementAuthority, productAuthority, pass, resultText, conflicts }) => {
  const req = requirementAuthority?.authorityClass ? `${requirementAuthority.authorityClass} (${requirementAuthority.role})` : "unranked requirement";
  const prod = productAuthority?.authorityClass ? `${productAuthority.authorityClass} (${productAuthority.role})` : "unranked product";
  const conflict = conflicts?.relation || null;
  const outcome = pass ? "pass" : `fail (${resultText || "no evidence"})`;
  return `Dimension ${dimension}: ${req} vs ${prod}. ${conflict ? conflict + " " : ""}Outcome: ${outcome}. Authority metadata is explanatory only; it does not alter score or ranking.`;
};

export const buildComparisonEnvelope = (comparison, context = {}) => {
  const { profile = null, product = null } = context;
  const dimension = dimensionForComparison(comparison);
  const requirement = comparison?.requirement || {};
  const required = comparison?.required || comparison?.requirement || null;
  const offered = comparison?.offered || comparison?.productStandard || null;
  const comparisonType = comparison?.comparisonType || "";

  const requirementAuthorityBase = requirementAuthorityOfDimension(requirement, dimension);
  // A bare standard citation (requirement = { body: "UL", number: "268" })
  // carries no project source object, but an applicable standard is by
  // definition a regulatory/standards claim. Default the requirement side to
  // REGULATORY for the standards dimension instead of failing the envelope
  // closed for a citation the matcher itself treats as governed.
  const requirementAuthority =
    requirementAuthorityBase.authorityClass || dimension !== "standards"
      ? requirementAuthorityBase
      : {
          authorityClass: "REGULATORY",
          role: "DEFINING",
          standing: "Cited",
          source: { sourceType: "Standard citation", document: requirement?.body ? { body: requirement.body, number: requirement.number } : null, confidence: 0 },
          status: "INSUFFICIENT_AUTHORITY",
          reason: "A bare standard citation has no governed project applicability or provenance.",
        };
  const productAuthority = productAuthorityOf(offered, comparisonType);
  const requirementEvidenceKind = requirementEvidenceKindOf(requirement);
  const productEvidenceKind = productEvidenceKindOf(offered);

  // A superseded source (comparison flag, requirement flag, or source-level
  // supersession) can never clear a gate -- regardless of which classes the
  // two claims belong to. This is decided here, before cross-domain policy.
  const supersededClaim =
    comparison?.superseded === true ||
    requirement?.superseded === true ||
    /superseded/i.test(txt(requirement?.reviewStatus || "")) ||
    requirement?.applicability?.status === "Superseded" ||
    (Array.isArray(requirement?.sources) && requirement.sources.some((entry) => /superseded/i.test(txt(entry.status || ""))));

  const crossDomain = supersededClaim
    ? { state: "SUPERSEDED", label: "SUPERSEDED", relation: "A superseded source cannot clear a gate; the current governed revision applies.", blocking: true, dimension }
    : resolveCrossDomainConflict(
        { authorityClass: requirementAuthority.authorityClass, role: requirementAuthority.role },
        { authorityClass: productAuthority.authorityClass, role: productAuthority.role },
        { consistent: comparison?.pass === true, superseded: false, dimension },
      );

  const missingEvidence = [];
  if (requirementAuthority.status === "INSUFFICIENT_AUTHORITY") missingEvidence.push({ dimension, side: "requirement", reason: requirementAuthority.reason || "No governing source class." });
  if (productEvidenceKind === "MISSING" && comparison?.blocking) missingEvidence.push({ dimension, side: "product", reason: "No authoritative product evidence backs the offered claim." });

  const state = productEvidenceKind === "MISSING" && comparison?.blocking
    ? "MISSING_EVIDENCE"
    : comparisonOutcomeState(comparison?.pass, comparison?.result, crossDomain, dimension);

  const envelope = {
    dimension,
    requiredValue: required?.normalizedValue ?? required?.value ?? null,
    offeredValue: productValue(offered),
    result: state,
    legacyResult: comparison?.result || null,
    pass: Boolean(comparison?.pass) && !(productEvidenceKind === "MISSING" && comparison?.blocking),
    blocking: Boolean(comparison?.blocking),
    requirementEvidence: requirementAuthority.source ? { sourceType: requirementAuthority.source.sourceType, document: requirementAuthority.source.document || null, confidence: requirementAuthority.source.confidence } : null,
    productEvidence: productAuthority.source.evidence || productAuthority.source.sourceId ? { sourceId: productAuthority.source.sourceId, evidence: productAuthority.source.evidence || null } : null,
    requirementAuthority: { authorityClass: requirementAuthority.authorityClass, role: requirementAuthority.role, standing: requirementAuthority.standing, source: requirementAuthority.source, status: requirementAuthority.status },
    productAuthority: { authorityClass: productAuthority.authorityClass, role: productAuthority.role, standing: productAuthority.standing, source: productAuthority.source, status: productAuthority.status },
    requirementEvidenceKind,
    productEvidenceKind,
    evidenceKind: productEvidenceKind === "MISSING" ? "MISSING" : productEvidenceKind,
    applicability: null,
    conflicts: crossDomain,
    missingEvidence,
    engineeringReason: comparison?.result || null,
    decisionBasis: decisionBasisFor({ dimension, requirementAuthority, productAuthority, pass: comparison?.pass, resultText: comparison?.result, conflicts: crossDomain }),
  };

  // Apply the authority matrix as a final fail-safe: if the dimension/source
  // pairing is genuinely ungoverned, the envelope must say so.
  const policy = authorityDomainPolicy(dimension, requirementAuthority.authorityClass);
  if (requirementAuthority.authorityClass && !policy.authoritative && !missingEvidence.some((entry) => entry.side === "requirement")) {
    envelope.requirementAuthority.status = "INSUFFICIENT_AUTHORITY";
    envelope.result = "INSUFFICIENT_AUTHORITY";
    envelope.blocking = Boolean(comparison?.blocking) || true;
    missingEvidence.push({ dimension, side: "requirement", reason: policy.reason || "Source class has no authority over this dimension." });
    envelope.missingEvidence = missingEvidence;
    envelope.decisionBasis = `Dimension ${dimension}: ${envelope.requirementAuthority.authorityClass} is not authoritative for this dimension. ${envelope.decisionBasis}`;
  }

  return envelope;
};

// Aligned array of envelopes for a candidate's comparisons. Each envelope
// carries comparisonIndex so the engineer projection can pair it back.
export const buildEvidenceEnvelope = ({ profile, product, comparisons }) => {
  if (!Array.isArray(comparisons)) return [];
  return comparisons.map((comparison, index) => ({ comparisonIndex: index, ...buildComparisonEnvelope(comparison, { profile, product }) }));
};

// ---------------------------------------------------------------------------
// Engineer-facing projection (4A-7) -- never exposes internal jargon by
// default; expanded provenance carries the technical authority metadata.
// ---------------------------------------------------------------------------
const actionFor = (envelope) => {
  if (envelope.pass) return { result: "Satisfied", action: "No action" };
  if (!envelope.blocking) return { result: "Failed", action: "No action" };
  if (envelope.result === "MISSING_EVIDENCE" || envelope.missingEvidence?.length) return { result: "Unknown", action: "Provide missing information" };
  if (/CONFLICT/.test(envelope.result)) return { result: "Conflict", action: "Choose interpretation" };
  return { result: "Failed", action: "Technical decision needed" };
};

const textOf = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const asJson = JSON.stringify(value);
    return asJson === "{}" ? "" : asJson;
  }
  return String(value);
};

const offeredText = (offered) =>
  [offered?.name, offered?.normalizedValue, offered?.value, offered?.originalValue, offered?.targetItem, offered?.accessory, offered?.partNumber, offered?.source, offered?.evidence]
    .map(textOf)
    .filter((entry) => txt(entry).length)
    .join(" | ") || "Candidate claim";

const requirementBasisText = (envelope, requirementText) => {
  const authority = envelope.requirementAuthority;
  if (!authority?.authorityClass) return `Why: no governing source applies to this dimension (${requirementText}).`;
  return `Why: ${authority.authorityClass} ${authority.standing || "Unconfirmed"} -- ${authority.source?.sourceType || "governed source"} defines this dimension.`;
};

const candidateBasisText = (envelope, candidateText) => {
  const authority = envelope.productAuthority;
  const kind = envelope.productEvidenceKind;
  if (!authority?.authorityClass) return `Why: no authoritative product evidence yet backs "${candidateText}".`;
  return `Why: ${authority.authorityClass} ${authority.standing || "Unreviewed"} verifies this claim; evidence kind ${kind}.`;
};

export const buildEngineerView = ({ profile, candidate }) => {
  const comparisons = candidate?.comparisons || [];
  const envelopes = candidate?.evidenceEnvelope || buildEvidenceEnvelope({ profile, product: candidate?.product, comparisons });
  const items = envelopes.map((envelope, index) => {
    const comparison = comparisons[envelope.comparisonIndex ?? index] || {};
    const requirement = comparison?.requirement || {};
    const required = comparison?.required || null;
    const offered = comparison?.offered || comparison?.productStandard || null;
    const requirementText = requirement?.normalizedRequirement || required?.name || requirement?.id || "Requirement";
    const candidateText = offered ? (offeredText(offered)) : "No candidate evidence";
    const action = actionFor(envelope);
    return {
      dimension: envelope.dimension,
      requirement: requirementText,
      requirementBasis: requirementBasisText(envelope, requirementText),
      candidate: String(candidateText),
      candidateBasis: candidateBasisText(envelope, candidateText),
      result: action.result,
      action: action.action,
      _provenance: {
        requirementAuthority: envelope.requirementAuthority,
        productAuthority: envelope.productAuthority,
        conflicts: envelope.conflicts,
        missingEvidence: envelope.missingEvidence,
        decisionBasis: envelope.decisionBasis,
      },
    };
  });
  const summary = items.reduce(
    (acc, item) => {
      acc[item.result.toLowerCase()] += 1;
      if (item.action !== "No action") acc.actions.push(item.action);
      return acc;
    },
    { satisfied: 0, failed: 0, unknown: 0, conflict: 0, actions: [] },
  );
  return { version: ENVELOPE_VERSION, items, summary };
};

// ---------------------------------------------------------------------------
// Persistence round-trip (4A-6). Persisted rows carry the envelope under
// product_match_comparisons.notes -> { evidenceAuthority: {...} }; legacy rows
// have null notes and parse back to null (backward-compatible).
// ---------------------------------------------------------------------------
export const envelopeForPersistence = (envelope) => (envelope ? { evidenceAuthority: envelope } : null);

export const reconstructEnvelopeFromPersisted = (row) => {
  if (!row) return null;
  const notes = row.notes ?? row.notes_json ?? null;
  if (!notes) return null;
  try {
    const parsed = typeof notes === "string" ? JSON.parse(notes) : notes;
    const envelope = parsed?.evidenceAuthority || null;
    if (envelope?.dimension) return envelope;
  } catch {
    return null;
  }
  return null;
};