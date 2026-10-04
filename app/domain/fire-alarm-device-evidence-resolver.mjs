// GOLDEN-6C3 -- governed Fire Alarm device identity, family, addressability and
// point-consumption evidence authority.
//
// WHAT THIS MODULE IS.
//
// It answers, for ONE device population, four INDEPENDENT governed questions:
//
//     A. What is this device?          (device identity)
//     B. What approved device family?  (device family)
//     C. Is it addressable?            (addressability)
//     D. Does it consume Fire Alarm addressable point demand?  (point consumption)
//
// Every property is resolved ONLY from governed evidence observations. The
// module performs no free-text AI, no fuzzy text similarity, no best-guess
// family, and no "known device name => one addressable point" inference.
//
// WHAT IT DELIBERATELY REUSES (no parallel taxonomy).
//
// Point-consumption classification stays in the canonical classifier
// `classifyFireAlarmSlcItem` (fire-alarm-slc-resource-classifier). This module
// resolves the EVIDENCE the classifier requires -- system, family, addressing
// attribute -- and hands off. It does not reimplement the classifier's
// units-per-device contract, conflict logic, quantity logic, or point-consumption
// policy, and it does not duplicate the classifier's family sets.
//
// GOVERNANCE INVARIANTS ENFORCED HERE.
//
//   1. Fire Alarm membership NEVER implies addressable.
//   2. Unknown addressability NEVER becomes conventional.
//   3. Unknown point consumption NEVER becomes one point and NEVER becomes zero.
//   4. Unknown family NEVER becomes a best-guess family.
//   5. Identity != family != addressability != point consumption: no dimension
//      is derived from another.
//   6. Protocol context != population-specific addressability: a protocol
//      mention governs addressability only when it is explicitly attached to
//      the population.
//   7. Evidence must be current, eligible, approved where governance requires
//      approval, not rejected, and not superseded; historical evidence is
//      retained for provenance but never governs the current resolution.
//   8. Conflicting current evidence never picks a winner by timestamp, mention
//      count, preferred source, or confidence -- it is a CONFLICT for human
//      adjudication unless a governing authority resolves it.
//   9. A legend/schedule applies only when its declared scope covers the
//      population; cross-sheet leakage is prevented structurally.
//  10. Quantity stays in GOLDEN-6C. This module never owns or reconciles
//      quantities; it only resolves device property authority.
//
// This module is pure: no I/O, no database, no schema, no mutation.

import { classifyFireAlarmSlcItem } from "./fire-alarm-slc-resource-classifier.mjs";

export const FIRE_ALARM_DEVICE_EVIDENCE_RESOLVER_VERSION =
  "fire-alarm-device-evidence-resolver-1.0.0";

// ---------------------------------------------------------------------------
// Canonical vocabulary. Deliberately matches the classifier's public contract
// (its family strings are consumed verbatim from evidence) while keeping the
// four evidence dimensions separate.
// ---------------------------------------------------------------------------

export const DEVICE_IDENTITY_STATES = Object.freeze([
  "GOVERNED_IDENTITY_RESOLVED",
  "IDENTITY_UNKNOWN",
]);

export const FAMILY_STATES = Object.freeze([
  "GOVERNED_FAMILY_RESOLVED",
  "FAMILY_UNKNOWN",
]);

export const ADDRESSABILITY_VALUES = Object.freeze([
  "ADDRESSABLE",
  "CONVENTIONAL",
  "NON_LOOP",
]);

// The four separately-governable evidence dimensions. A detector may have a
// governed family while addressability stays UNKNOWN: the two are independent.
export const ADDRESSABILITY_STATES = Object.freeze([
  "GOVERNED_ADDRESSABILITY_RESOLVED",
  "ADDRESSABILITY_UNKNOWN",
]);

export const POINT_CONSUMPTION_STATES = Object.freeze([
  "GOVERNED_POINT_CONSUMPTION_RESOLVED",
  "MULTI_ADDRESS_UNRESOLVED",
  "NON_POINT_CONFIRMED",
  "POINT_CONSUMPTION_UNKNOWN",
]);

// Population-level verdicts (GOLDEN-6C3 section 22). One verdict per
// population; it names what is known and what remains unknown.
export const POPULATION_STATES = Object.freeze([
  "GOVERNED_POINT_CONSUMPTION_RESOLVED",
  "GOVERNED_FAMILY_RESOLVED",
  "GOVERNED_ADDRESSABILITY_RESOLVED",
  "NON_POINT_CONFIRMED",
  "REQUIRES_ENGINEERING_REVIEW",
  "INSUFFICIENT_EVIDENCE",
  "CONFLICTING_EVIDENCE",
]);

// Pinned error codes for the resolver contract.
export const DEVICE_EVIDENCE_FAILURE_CODES = Object.freeze([
  "DEVICE_EVIDENCE_POPULATION_REQUIRED",
  "DEVICE_EVIDENCE_OBSERVATION_REQUIRED",
  "DEVICE_EVIDENCE_CLAIM_REQUIRED",
  "DEVICE_EVIDENCE_ID_REQUIRED",
]);

// A property dimension never resolves from a claim type that does not assert
// it. Protocol context is explicitly NOT an addressability claim.
const CLAIM_KEYS = Object.freeze([
  "deviceIdentity",
  "deviceFamily",
  "addressability",
  "pointConsumption",
  "negative",
  "protocol",
  "aliasEquivalence",
]);

const text = (value) => String(value ?? "").trim();
const approved = (observation) => {
  const status = text(observation?.reviewStatus);
  return /^approved$/i.test(status) || observation?.approvedForDownstream === true || observation?.approvedForDownstream === 1;
};

export function deviceEvidenceFailure(code, message, status = 422, details = null) {
  const error = new Error(message);
  Object.setPrototypeOf(error, deviceEvidenceFailure.prototype);
  error.name = "deviceEvidenceFailure";
  error.code = code;
  error.status = status;
  if (details !== undefined && details !== null) error.details = details;
  return error;
}

deviceEvidenceFailure.prototype = Object.create(Error.prototype);

// ---------------------------------------------------------------------------
// Observation eligibility.
//
// A governed evidence observation is usable only when it is CURRENT (not
// superseded), not rejected, and APPROVED (or explicitly marked approved for
// downstream use) where governance requires approval. Superseded and rejected
// evidence is ignored for current resolution -- it may live on as provenance,
// never as authority.
// ---------------------------------------------------------------------------
export function isUsableEvidenceObservation(observation) {
  if (!observation || typeof observation !== "object") return false;
  if (observation.supersededAt !== null && observation.supersededAt !== undefined && text(observation.supersededAt) !== "") return false;
  if (observation.rejected === true || observation.rejected === 1) return false;
  if (!approved(observation)) return false;
  const claims = observation.claims || {};
  return CLAIM_KEYS.some((key) => claims[key] !== undefined && claims[key] !== null && text(claims[key]) !== "");
}

// A protocol claim is only population-specific evidence when the observation is
// explicitly attached to this population. A drawing-wide or spec-wide protocol
// mention drives the message "protocol context != population addressability".
export const protocolMentionIsPopulationEvidence = (observation, populationId) => {
  const scope = observation?.scope || {};
  return (
    text(observation?.applicableTo) === text(populationId)
    || (text(scope.population) !== "" && text(scope.population) === text(populationId))
  );
};

// Cross-sheet / scope applicability. A legend or schedule observation that
// declares a sheet/drawing scope applies only when the population context is
// covered by that scope. No declared scope = no applicability assertion, so the
// claim cannot leak onto a population the evidence never named.
export const observationAppliesToPopulation = (observation, populationId, context = {}) => {
  if (observation?.applicableTo !== undefined && observation?.applicableTo !== null && text(observation.applicableTo) !== "") {
    if (text(observation.applicableTo) !== text(populationId)) return false;
  }
  const scope = observation?.scope || {};
  if (text(scope.population) !== "" && text(scope.population) !== text(populationId)) return false;
  if (text(scope.drawing) !== "" || text(scope.sheet) !== "") {
    const declared = text(scope.drawing || scope.sheet);
    const populationDrawing = text(context?.drawing || context?.sheet);
    // A scope-declared legend/schedule needs a matching population drawing
    // context; without one it cannot be proven applicable and must not leak
    // onto the population (fail-closed cross-sheet posture).
    if (populationDrawing === "" || populationDrawing !== declared) return false;
  }
  return true;
};

// ---------------------------------------------------------------------------
// Observability: a usable evidence observation contributes to a dimension only
// via the claim types that legitimately assert that dimension.
// ---------------------------------------------------------------------------
const identityClaims = (usable) => usable
  .filter((entry) => text(entry.observation.claims?.deviceIdentity) !== "")
  .map((entry) => ({ ...entry, value: text(entry.observation.claims.deviceIdentity) }));

// Alias-normalized family resolution. A family string is consumed verbatim from
// governed evidence. The ONLY normalization allowed is an alias-equivalence
// claim that is itself governed (aliasEvidence): e.g. an approved legend/schedule
// that literally defines "SD = Addressable Smoke Detector". Normalization
// happens WITHIN the observation that carries the mapping -- every observation
// contributes exactly one governed family value, so a direct claim from another
// observation still disagrees honestly instead of being silently merged. Fuzzy
// text similarity never merges families, and meaningful differences (Addressable
// vs Conventional, Detector vs Detector Base, Monitor vs Control module) are
// preserved because they are distinct evidence-declared strings.
const normalizedFamilyClaims = (usable) => usable
  .map((entry) => {
    const claims = entry.observation.claims || {};
    if (text(claims.aliasEquivalence) !== "" && entry.observation.aliasEvidence === true) {
      return { ...entry, value: text(claims.aliasEquivalence), viaAlias: true };
    }
    if (text(claims.deviceFamily) !== "") {
      return { ...entry, value: text(claims.deviceFamily), viaAlias: false };
    }
    return null;
  })
  .filter((entry) => entry !== null);

const addressabilityClaimValue = (claims) => {
  if (claims?.addressability !== undefined && claims?.addressability !== null && text(claims.addressability) !== "") {
    const value = text(claims.addressability).toUpperCase().replace(/[\s-]+/g, "_");
    return ADDRESSABILITY_VALUES.includes(value) ? value : null;
  }
  return null;
};

const addressabilityClaims = (usable) => usable
  .map((entry) => ({ ...entry, value: addressabilityClaimValue(entry.observation.claims) }))
  .filter((entry) => entry.value !== null);

// Negative evidence contributes governed CONVENTIONAL / NON_LOOP addressability
// and NON_POINT consumption when the observation explicitly claims it.
const negativeClaims = (usable) => usable
  .filter((entry) => text(entry.observation.claims?.negative) !== "")
  .map((entry) => ({
    ...entry,
    value: text(entry.observation.claims.negative).toUpperCase().replace(/[\s-]+/g, "_"),
  }));

const NEGATIVE_ADDRESSABILITY = new Map([
  ["CONVENTIONAL", "CONVENTIONAL"],
  ["NON_LOOP", "NON_LOOP"],
  ["NON_ADDRESSABLE", "CONVENTIONAL"],
  ["NAC", "NON_LOOP"],
  ["SPEAKER_CIRCUIT", "NON_LOOP"],
  ["DRY_CONTACT", "NON_LOOP"],
]);

const NEGATIVE_NON_POINT = new Set([
  "CONVENTIONAL",
  "NON_LOOP",
  "NAC",
  "SPEAKER_CIRCUIT",
  "DRY_CONTACT",
  "ACCESSORY",
  "NON_POINT",
]);

// ---------------------------------------------------------------------------
// Per-dimension aggregation. All usable claims must agree on a single governed
// value, or the dimension is a CONFLICT -- never an arbitrary winner. An
// optional `governingAuthority` may resolve disagreements exactly like
// GOLDEN-6C's quantity reconciliation: the authority model, not arithmetic,
// is what decides; two governing authorities that disagree are still a conflict.
// ---------------------------------------------------------------------------
const resolveDimensionClaims = (claims, { governingAuthority = null } = {}) => {
  if (claims.length === 0) return { state: null, value: null, authorities: [], conflicting: [] };
  const governing = governingAuthority
    ? claims.filter((entry) => text(entry.observation.authority) === governingAuthority)
    : [];
  const governingValues = [...new Set(governing.map((entry) => entry.value))];
  if (governing.length > 0) {
    if (governingValues.length > 1) {
      return {
        state: "CONFLICT",
        value: null,
        authorities: governing.map((entry) => entry.observation.authority).filter(Boolean),
        conflicting: [...new Set(governingValues)],
      };
    }
    return {
      state: "RESOLVED",
      value: governingValues[0],
      authorities: [...new Set(governing.map((entry) => text(entry.observation.authority)).filter(Boolean))],
      conflicting: [],
    };
  }
  const distinct = [...new Set(claims.map((entry) => entry.value))];
  if (distinct.length !== 1) {
    return {
      state: "CONFLICT",
      value: null,
      authorities: [...new Set(claims.map((entry) => text(entry.observation.authority)).filter(Boolean))],
      conflicting: distinct,
    };
  }
  return {
    state: "RESOLVED",
    value: distinct[0],
    authorities: [...new Set(claims.map((entry) => text(entry.observation.authority)).filter(Boolean))],
    conflicting: [],
  };
};

const evidenceRefs = (claims) => claims.map((entry) => ({
  id: entry.observation.id,
  source: text(entry.observation.source) || null,
  sourceLocation: text(entry.observation.sourceLocation) || null,
  authority: text(entry.observation.authority) || null,
}));

// ---------------------------------------------------------------------------
// Human engineering review questions (GOLDEN-6C3 section 36). Generated only
// where evidence genuinely cannot resolve a material property.
// ---------------------------------------------------------------------------
export function deviceReviewQuestions(resolution) {
  const questions = [];
  const id = resolution?.resolution?.identity || {};
  const family = resolution?.resolution?.family || {};
  const addressability = resolution?.resolution?.addressability || {};
  const point = resolution?.resolution?.pointConsumption || {};
  const populationId = resolution?.populationId || null;

  const hasConflicts = Boolean(resolution?.conflicts?.length);

  if (!hasConflicts && id.state === "GOVERNED_IDENTITY_RESOLVED" && family.state !== "GOVERNED_FAMILY_RESOLVED" && point.state !== "NON_POINT_CONFIRMED") {
    questions.push({
      populationId,
      question: "What is the approved device family for this population, and which governed evidence establishes it?",
      state: "FAMILY_REQUIRED",
      known: { identity: id.value },
    });
  }
  if (!hasConflicts && family.state === "GOVERNED_FAMILY_RESOLVED" && addressability.state !== "GOVERNED_ADDRESSABILITY_RESOLVED" && point.state !== "NON_POINT_CONFIRMED") {
    const isEquipment = ["Fire Alarm Control Panel", "Power Supply", "Battery", "Loop Card", "Detector Base", "Enclosure", "Back Box"].includes(family.value);
    if (!isEquipment) {
      questions.push({
        populationId,
        question: "Is this device population addressable (SLC loop device), conventional, or a non-loop (NAC/speaker-circuit) device? Provide governed evidence.",
        state: "ADDRESSABILITY_REQUIRED",
        known: { identity: id.value, family: family.value },
      });
    }
  }
  if (!hasConflicts && (point.state === "MULTI_ADDRESS_UNRESOLVED" || (family.state === "GOVERNED_FAMILY_RESOLVED" && addressability.state === "GOVERNED_ADDRESSABILITY_RESOLVED" && point.state === "POINT_CONSUMPTION_UNKNOWN"))) {
    questions.push({
      populationId,
      question: "Does this device consume one address, two addresses, or another governed address count? No address-count evidence currently exists.",
      state: "POINT_CONSUMPTION_REQUIRED",
      known: { identity: id.value, family: family.value, addressability: addressability.value },
    });
  }
  if (resolution?.conflicts?.length) {
    for (const conflict of resolution.conflicts) {
      questions.push({
        populationId,
        question: `Resolve the conflicting ${conflict.dimension} evidence: ${conflict.values.join(" vs ")}. No authority model resolves this disagreement; a human must adjudicate.`,
        state: "CONFLICT_REQUIRED",
        known: { dimension: conflict.dimension, values: conflict.values },
      });
    }
  }
  return questions;
}

// ---------------------------------------------------------------------------
// The resolver. Consumes structured, governed evidence observations for one
// population and returns the four independently-governed resolutions.
// ---------------------------------------------------------------------------
export function resolveFireAlarmDeviceAuthority({
  populationId = null,
  system = null,
  evidence = [],
  governingAuthority = null,
  context = {},
} = {}) {
  if (!text(populationId)) {
    throw deviceEvidenceFailure("DEVICE_EVIDENCE_POPULATION_REQUIRED", "A device population requires a governed population identity.");
  }
  if (!Array.isArray(evidence)) {
    throw deviceEvidenceFailure("DEVICE_EVIDENCE_OBSERVATION_REQUIRED", "Evidence must be a list of governed observations.");
  }
  if (evidence.length === 0) {
    throw deviceEvidenceFailure("DEVICE_EVIDENCE_OBSERVATION_REQUIRED", "A device population requires at least one governed evidence observation.");
  }

  const usable = [];
  const excluded = [];
  for (const observation of evidence) {
    if (!observation || typeof observation !== "object" || !text(observation.id)) {
      throw deviceEvidenceFailure("DEVICE_EVIDENCE_ID_REQUIRED", "Every evidence observation requires a governed evidence identity.");
    }
    const claims = observation.claims || {};
    if (!CLAIM_KEYS.some((key) => claims[key] !== undefined && claims[key] !== null && text(claims[key]) !== "")) {
      throw deviceEvidenceFailure("DEVICE_EVIDENCE_CLAIM_REQUIRED", `Observation ${observation.id} carries no governed claim for any evidence dimension.`);
    }
    const applies = observationAppliesToPopulation(observation, populationId, context);
    const usableObservation = isUsableEvidenceObservation(observation);
    if (!applies || !usableObservation) {
      excluded.push({
        id: observation.id,
        reason: !applies
          ? "Evidence scope does not cover this population (cross-sheet / cross-population protection)."
          : "Evidence is not current, or not approved, or is rejected/superseded, and cannot govern current resolution.",
      });
      continue;
    }
    // INVARIANT 6: protocol claims contribute only when explicitly attached to
    // this population.
    if (text(claims.protocol) !== "" && !protocolMentionIsPopulationEvidence(observation, populationId)) {
      excluded.push({
        id: observation.id,
        reason: "Protocol context without an explicit population attachment does not establish population-specific addressability.",
      });
      continue;
    }
    usable.push({ observation });
  }

  // Identity.
  const identityClaimsObs = identityClaims(usable);
  const identity = resolveDimensionClaims(identityClaimsObs, { governingAuthority });
  // Family (with governed alias normalization only).
  const famClaims = normalizedFamilyClaims(usable);
  const family = resolveDimensionClaims(famClaims, { governingAuthority });
  // Addressability: explicit claims plus negative evidence claims. Both are
  // governed assertions; absence of either never defaults a value. Any
  // disagreement between explicit and negative claims is a conflict -- never a
  // preference for one evidence kind over the other.
  const negatives = resolveDimensionClaims(negativeClaims(usable), { governingAuthority });
  const negativeAddressabilityValue = negatives.state === "RESOLVED" ? NEGATIVE_ADDRESSABILITY.get(negatives.value) || null : null;
  const negativeConsumesNoPoint = negatives.state === "RESOLVED" && (NEGATIVE_NON_POINT.has(negatives.value) || negatives.value === "ACCESSORY");
  const explicitAddressability = addressabilityClaims(usable);
  const allAddressabilityValues = [
    ...(explicitAddressability.length ? [explicitAddressability[0].value] : []),
    ...(negativeAddressabilityValue ? [negativeAddressabilityValue] : []),
  ];
  let addressability;
  if (allAddressabilityValues.length === 0) {
    addressability = { state: null, value: null, authorities: [], conflicting: [] };
  } else {
    const distinct = [...new Set(allAddressabilityValues)];
    if (distinct.length !== 1) {
      addressability = {
        state: "CONFLICT",
        value: null,
        authorities: [...new Set([...explicitAddressability, ...negativeClaims(usable)].map((entry) => text(entry.observation.authority)).filter(Boolean))],
        conflicting: distinct,
      };
    } else {
      addressability = {
        state: "RESOLVED",
        value: distinct[0],
        authorities: [...new Set([...explicitAddressability, ...negativeClaims(usable)].map((entry) => text(entry.observation.authority)).filter(Boolean))],
        conflicting: [],
      };
    }
  }

  const dimensionState = (dim, resolvedValue) =>
    dim.state === "CONFLICT"
      ? null
      : dim.state === "RESOLVED"
        ? resolvedValue
        : null;

  const resolvedIdentity = dimensionState(identity, identity.value);
  const resolvedFamily = dimensionState(family, family.value);
  const resolvedAddressability = dimensionState(addressability, addressability.value);
  const resolvedNegativeConsumesNoPoint = negatives.state === "RESOLVED" && negativeConsumesNoPoint;

  // Per-dimension states.
  const identityState = identity.state === "CONFLICT" ? null : identity.state === "RESOLVED" ? "GOVERNED_IDENTITY_RESOLVED" : "IDENTITY_UNKNOWN";
  const familyState = family.state === "CONFLICT" ? null : family.state === "RESOLVED" ? "GOVERNED_FAMILY_RESOLVED" : "FAMILY_UNKNOWN";
  const addressabilityState = addressability.state === "CONFLICT" ? null : addressability.state === "RESOLVED" ? "GOVERNED_ADDRESSABILITY_RESOLVED" : "ADDRESSABILITY_UNKNOWN";

  // Conflicts are population-wide: any dimension disagreement makes the whole
  // population CONFLICTING_EVIDENCE (INVARIANT 8) -- no winner is chosen.
  const conflicts = [];
  for (const [dimension, dim] of [["identity", identity], ["family", family], ["addressability", addressability], ["negative", negatives]]) {
    if (dim.state === "CONFLICT") conflicts.push({ dimension, values: dim.conflicting });
  }

  // Point consumption stays with the canonical classifier (INVARIANT: no
  // parallel taxonomy). The resolution exposes what the classifier needs and the
  // classifier's failure-closed states are preserved.
  const multiAddressClaimed = usable.some((entry) => {
    const claims = entry.observation.claims || {};
    const consumption = text(claims.pointConsumption).toUpperCase().replace(/[\s-]+/g, "_");
    return consumption === "MULTI" || consumption === "MULTI_ADDRESS" || consumption === "MULTI_POINT" || consumption === "MULTI_CHANNEL" || consumption === "DUAL_ADDRESS";
  });
  const pointConsumptionState =
    conflicts.length > 0
      ? null
      : resolvedNegativeConsumesNoPoint
        ? "NON_POINT_CONFIRMED"
        : multiAddressClaimed
          ? "MULTI_ADDRESS_UNRESOLVED"
          : resolvedFamily && resolvedAddressability
            ? "GOVERNED_POINT_CONSUMPTION_RESOLVED"
            : "POINT_CONSUMPTION_UNKNOWN";

  // Population-level verdict.
  let populationState;
  if (conflicts.length > 0) populationState = "CONFLICTING_EVIDENCE";
  else if (resolvedNegativeConsumesNoPoint) populationState = "NON_POINT_CONFIRMED";
  else if (pointConsumptionState === "GOVERNED_POINT_CONSUMPTION_RESOLVED") populationState = "GOVERNED_POINT_CONSUMPTION_RESOLVED";
  else if (pointConsumptionState === "MULTI_ADDRESS_UNRESOLVED") populationState = "REQUIRES_ENGINEERING_REVIEW";
  else if (resolvedFamily && resolvedAddressability) populationState = "REQUIRES_ENGINEERING_REVIEW";
  else if (resolvedAddressability) populationState = "GOVERNED_ADDRESSABILITY_RESOLVED";
  else if (resolvedFamily) populationState = "GOVERNED_FAMILY_RESOLVED";
  else populationState = "INSUFFICIENT_EVIDENCE";

  const resolution = {
    identity: { state: identityState, value: resolvedIdentity, authorities: evidenceRefs(identityClaimsObs), conflicting: identity.conflicting },
    family: { state: familyState, value: resolvedFamily, authorities: evidenceRefs(famClaims), conflicting: family.conflicting },
    addressability: { state: addressabilityState, value: resolvedAddressability, authorities: evidenceRefs([...addressabilityClaims(usable), ...negativeClaims(usable)]), conflicting: addressability.conflicting },
    pointConsumption: {
      state: pointConsumptionState,
      // The classifier decides the actual class; this dimension answers whether
      // the evidence questions are answered.
      multiAddressEvidence: multiAddressClaimed,
      nonPointConfirmed: resolvedNegativeConsumesNoPoint,
    },
  };

  const populated = {
    version: FIRE_ALARM_DEVICE_EVIDENCE_RESOLVER_VERSION,
    populationId: text(populationId),
    system: text(system) || null,
    resolution,
    populationState,
    conflicts,
    excluded,
    usableObservationCount: usable.length,
  };
  populated.reviewQuestions = deviceReviewQuestions(populated);

  // Candidates for the canonical classifier (the ONLY bridge to point
  // consumption). Never a guess: null means "evidence does not establish it".
  populated.candidates = {
    system: populated.system,
    family: resolvedFamily,
    attributes: {
      ...(resolvedAddressability ? { addressing: addressabilityValueForClassifier(resolvedAddressability) } : {}),
    },
  };
  return populated;
}

const addressabilityValueForClassifier = (value) => {
  if (value === "ADDRESSABLE") return "addressable";
  if (value === "CONVENTIONAL") return "conventional";
  if (value === "NON_LOOP") return "non-loop";
  return null;
};

// ---------------------------------------------------------------------------
// Classifier handoff (GOLDEN-6C3 section 26). This is the ONLY place point
// consumption is computed: the canonical classifier's governed units-per-device
// contract. The resolver never reimplements it.
// ---------------------------------------------------------------------------
export function classifyResolvedDeviceEvidence({ resolution, quantity = null, extraAttributes = {} } = {}) {
  const candidates = resolution?.candidates || {};
  const addressing = candidates.attributes?.addressing || null;
  const attributes = {
    ...(candidates.attributes || {}),
    ...extraAttributes,
    ...(addressing ? { addressing } : {}),
  };
  // A governed multi-address claim is surfaced through the canonical
  // classifier's OWN multi-address evidence vocabulary (slc_addressing /
  // point_behavior). The classifier already fails closed on it; the resolver
  // does not reimplement the multi-address rule, it feeds the evidence in the
  // form the canonical contract recognizes.
  if (resolution?.resolution?.pointConsumption?.multiAddressEvidence && !attributes.point_behavior && !attributes.slc_addressing) {
    attributes.slc_addressing = "multi_address";
  }
  const classification = classifyFireAlarmSlcItem({
    system: candidates.system,
    family: candidates.family,
    attributes,
    selectedQuantity: quantity === null || quantity === undefined
      ? { value: null, source: null, decisionId: null, status: "UNKNOWN" }
      : { value: quantity, source: resolution?.populationId || null, status: "VALID" },
  });
  return {
    canonicalState: classification.state,
    family: classification.family,
    addressability: classification.addressability,
    unitsPerDevice: classification.unitsPerDevice ?? null,
    demandUnits: classification.demandUnits === null || classification.demandUnits === undefined ? null : Number(classification.demandUnits),
    quantityStatus: classification.quantity?.status ?? "UNKNOWN",
    reason: classification.reason,
    provenance: classification.provenance || null,
    classifierVersion: classification.classifierVersion,
  };
}