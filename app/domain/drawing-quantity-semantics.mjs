// DRAWING QUANTITY SEMANTICS
// Semantic layer between governed occurrence evidence and quantity authority.
// Occurrence counts, device counts, zone counts and module counts are separate,
// independently-governed axes. None may be derived from another unless
// governed evidence proves the relation.

export const DRAWING_QUANTITY_SEMANTICS_VERSION = "drawing-quantity-semantics-1.0.0";

export const QUANTITY_AXES = Object.freeze(["occurrenceCount", "deviceCount", "zoneCount", "moduleCount"]);

export const MULTIPLIER_REFERENTS = Object.freeze([
  "DEVICE_MULTIPLIER",
  "ZONE_MULTIPLIER",
  "MODULE_MULTIPLIER",
  "GROUP_SUBTOTAL",
  "CABLE_QUANTITY",
  "OTHER",
  "MULTIPLIER_REFERENT_AMBIGUOUS",
]);

export const MULTIPLIER_ASSOCIATIONS = Object.freeze([
  "BOUND_PROVEN",
  "CANDIDATE_PROXIMITY",
  "AMBIGUOUS_ASSOCIATION",
]);

function axis(value, { authorityStatus, evidenceIds = [], derivation, ambiguityState = null } = {}) {
  return Object.freeze({
    value: value ?? null,
    authorityStatus,
    evidenceIds: Object.freeze([...evidenceIds]),
    derivation: derivation ?? null,
    ambiguityState: ambiguityState ?? null,
  });
}

export function describeMultiplier(entry) {
  return Object.freeze({
    value: entry.value ?? null,
    sheet: entry.sheet ?? null,
    evidenceId: entry.evidenceId ?? null,
    referent: MULTIPLIER_REFERENTS.includes(entry.referent) ? entry.referent : "MULTIPLIER_REFERENT_AMBIGUOUS",
    association: MULTIPLIER_ASSOCIATIONS.includes(entry.association) ? entry.association : "AMBIGUOUS_ASSOCIATION",
    boundToOccurrenceIds: Object.freeze([...(entry.boundToOccurrenceIds ?? [])]),
    provenance: entry.provenance ?? null,
  });
}

function isCurrent(evidence, { projectId, currentDocumentVersions }) {
  if (evidence?.projectId !== undefined && projectId && evidence.projectId !== projectId) return false;
  if (evidence?.documentId && currentDocumentVersions?.[evidence.documentId] !== undefined &&
      evidence.documentVersionId && evidence.documentVersionId !== currentDocumentVersions[evidence.documentId]) return false;
  return true;
}

export function resolveDrawingQuantitySemantics({
  occurrences = [],
  multipliers = [],
  manufacturerTopologies = [],
  boqItems = [],
  specifications = [],
  projectId = null,
  currentDocumentVersions = {},
} = {}) {
  const acceptedOccurrences = occurrences.filter((o) => o.state === "accepted" && isCurrent(o, { projectId, currentDocumentVersions }));

  const occurrenceCount = axis(acceptedOccurrences.length, {
    authorityStatus: "EVIDENCED",
    evidenceIds: acceptedOccurrences.map((o) => o.id).filter(Boolean),
    derivation: "count of accepted governed occurrence evidence",
  });

  const multiplierRelations = multipliers.map((entry) => {
    const m = describeMultiplier(entry);
    const governedBinding = m.association === "BOUND_PROVEN" && m.boundToOccurrenceIds.length > 0 && Boolean(m.provenance);
    return { ...m, governedBinding };
  });

  // A multiplier may populate an axis ONLY when its referent is proven AND it
  // is governed-bound. Proximity never binds. Ambiguous referent never
  // contributes.
  const provenSum = (kind) => {
    const proven = multiplierRelations.filter((m) => m.governedBinding && m.referent === kind && m.provenance);
    if (proven.length === 0) return null;
    return proven.reduce((acc, m) => acc + (typeof m.value === "number" && m.value > 0 ? m.value : 0), 0);
  };

  const deviceCount = provenSum("DEVICE_MULTIPLIER") != null
    ? axis(provenSum("DEVICE_MULTIPLIER"), { authorityStatus: "EVIDENCED", evidenceIds: multiplierRelations.filter((m) => m.governedBinding && m.referent === "DEVICE_MULTIPLIER").map((m) => m.evidenceId).filter(Boolean), derivation: "governed DEVICE_MULTIPLIER bound to occurrences" })
    : axis(null, { authorityStatus: "UNPROVEN", evidenceIds: [], derivation: "no governed DEVICE_MULTIPLIER bound; not derived from occurrenceCount", ambiguityState: "AMBIGUOUS_EVIDENCE_PRESENT" });

  const zoneCount = provenSum("ZONE_MULTIPLIER") != null
    ? axis(provenSum("ZONE_MULTIPLIER"), { authorityStatus: "EVIDENCED", evidenceIds: multiplierRelations.filter((m) => m.governedBinding && m.referent === "ZONE_MULTIPLIER").map((m) => m.evidenceId).filter(Boolean), derivation: "governed ZONE_MULTIPLIER bound to occurrences" })
    : axis(null, { authorityStatus: "UNPROVEN", evidenceIds: [], derivation: "no governed ZONE_MULTIPLIER bound; not derived from occurrenceCount" });

  const moduleCount = provenSum("MODULE_MULTIPLIER") != null
    ? axis(provenSum("MODULE_MULTIPLIER"), { authorityStatus: "EVIDENCED", evidenceIds: multiplierRelations.filter((m) => m.governedBinding && m.referent === "MODULE_MULTIPLIER").map((m) => m.evidenceId).filter(Boolean), derivation: "governed MODULE_MULTIPLIER bound to occurrences" })
    : axis(null, { authorityStatus: "UNPROVEN", evidenceIds: [], derivation: "no governed MODULE_MULTIPLIER bound; not derived from occurrenceCount" });

  const topology = manufacturerTopologies.map((t) => ({
    subject: t.subject ?? null,
    relation: t.relation ?? null,
    evidenceId: t.evidenceId ?? null,
    advisory: true,
    createsAuthority: false,
  }));

  return Object.freeze({
    occurrenceCount,
    deviceCount,
    zoneCount,
    moduleCount,
    multiplierRelations,
    manufacturerTopology: topology,
  });
}

export { axis as makeAxis };
