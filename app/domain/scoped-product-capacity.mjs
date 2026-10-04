// SCOPED PRODUCT CAPACITY AUTHORITY (Phase D/G foundation).
//
// THE ENGINEERING INVARIANT THIS ENFORCES
//
//   NO CAPACITY VALUE MAY ENTER MATCHING, KNOWLEDGE, BOM OR SIZING WITHOUT AN
//   EXPLICIT ENGINEERING SCOPE.
//
// A bare number is not engineering data. These are five DIFFERENT facts that
// happen to be numerically related, and merging them is how a panel gets
// overspecified or a loop gets overfilled:
//
//   159 detectors / SLC / FlashScan / SLM-318
//   159 modules  / SLC / FlashScan / SLM-318
//   318 devices  / SLC / FlashScan
//   10 SLC       / FACP  / FlashScan / N16x
//   3,180 addressable devices / FACP / FlashScan / N16x
//
// and, in CLIP (LEGACY / EXCEPTION ONLY -- never substituted for FlashScan):
//
//   99 detectors / SLC / CLIP / SLM-318
//   990 detectors / FACP / CLIP / N16
//
// `isSameEngineeringFact` is the only correct way to compare two capacity
// facts: every scope dimension must match. A consumer that needs
// "detectors on this SLC" must ASK for that, and must fail closed when the
// fact it holds is scoped to modules or to CLIP.
//
// EVIDENCE PROVENANCE IS MANDATORY. A capacity without a source document,
// revision and authority is not usable and is rejected by `validateCapacityFact`.
//
// This module is pure. It holds no database access and no product-selection
// logic; it is the shared vocabulary that enrichment, matching and sizing all
// speak.

export const SCOPED_CAPACITY_VERSION = "scoped-product-capacity-1.0.0";

// The scope dimensions that make a capacity fact identifiable. Two capacity
// facts are interchangeable only when ALL of these are equal.
export const CAPACITY_SCOPE_DIMENSIONS = Object.freeze([
  "resourceClass",  // detector | module | device | loop | address | output | node | point
  "scopeType",      // SLC | FACP | NETWORK | LOOP_MODULE | POWER_SUPPLY | ISOLATOR_SEGMENT
  "scopeEntity",    // exact model the fact is about, e.g. "SLM-318"
  "protocolMode",   // FlashScan | CLIP | MIXED | N_A
  "qualifier",      // e.g. "with self-test detectors installed" | null
]);

export const RESOURCE_CLASSES = Object.freeze([
  "detector", "module", "device", "loop", "address", "output", "node", "point", "power",
]);

export const SCOPE_TYPES = Object.freeze([
  "SLC", "FACP", "NETWORK", "LOOP_MODULE", "POWER_SUPPLY", "ISOLATOR_SEGMENT", "BOM",
]);

// The approved protocol modes. CLIP is explicitly legacy/exception: it exists in
// the vocabulary so that a CLIP-scoped fact can never be silently compared with
// a FlashScan-scoped one.
export const PROTOCOL_MODES = Object.freeze(["FlashScan", "CLIP", "MIXED", "N_A"]);

export const LEGACY_PROTOCOL_MODES = Object.freeze(["CLIP"]);

export class CapacityScopeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CapacityScopeError";
    this.code = code;
  }
}

const isBlank = (value) => value === null || value === undefined || String(value).trim() === "";

// ---------------------------------------------------------------------------
// BUILD + VALIDATE. A fact is only usable when fully scoped and evidenced.
// ---------------------------------------------------------------------------
export const buildCapacityFact = ({
  value,
  unit,
  resourceClass,
  scopeType,
  scopeEntity,
  protocolMode = "N_A",
  qualifier = null,
  evidence = null,
  authority = null,
  reviewState = "UNREVIEWED",
  reviewNote = null,
} = {}) => {
  const missing = CAPACITY_SCOPE_DIMENSIONS.filter((d) => d !== "qualifier" && isBlank({ resourceClass, scopeType, scopeEntity, protocolMode }[d]));
  if (missing.length) {
    throw new CapacityScopeError("CAPACITY_SCOPE_INCOMPLETE", `A capacity fact requires every scope dimension; missing: ${missing.join(", ")}.`);
  }
  if (!RESOURCE_CLASSES.includes(resourceClass)) {
    throw new CapacityScopeError("CAPACITY_RESOURCE_CLASS_UNKNOWN", `Unknown resource class "${resourceClass}". Known: ${RESOURCE_CLASSES.join(", ")}.`);
  }
  if (!SCOPE_TYPES.includes(scopeType)) {
    throw new CapacityScopeError("CAPACITY_SCOPE_TYPE_UNKNOWN", `Unknown scope type "${scopeType}". Known: ${SCOPE_TYPES.join(", ")}.`);
  }
  if (!PROTOCOL_MODES.includes(protocolMode)) {
    throw new CapacityScopeError("CAPACITY_PROTOCOL_MODE_UNKNOWN", `Unknown protocol mode "${protocolMode}". Known: ${PROTOCOL_MODES.join(", ")}.`);
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new CapacityScopeError("CAPACITY_VALUE_INVALID", `Capacity value must be a finite non-negative number, got ${JSON.stringify(value)}.`);
  }
  if (isBlank(unit)) {
    throw new CapacityScopeError("CAPACITY_UNIT_REQUIRED", "A capacity fact requires an explicit unit.");
  }
  if (isBlank(evidence) || isBlank(authority)) {
    throw new CapacityScopeError("CAPACITY_EVIDENCE_REQUIRED", "A capacity fact requires a source document and an authority; an unsourced capacity is not usable.");
  }

  return Object.freeze({
    capacityVersion: SCOPED_CAPACITY_VERSION,
    value: numeric,
    unit: String(unit).trim(),
    resourceClass,
    scopeType,
    scopeEntity: String(scopeEntity).trim(),
    protocolMode,
    qualifier: isBlank(qualifier) ? null : String(qualifier).trim(),
    evidence,
    authority,
    reviewState,
    reviewNote,
    // Legacy protocols are labelled at the fact level so a downstream consumer
    // cannot present a CLIP capacity as a design basis without noticing.
    legacyProtocol: LEGACY_PROTOCOL_MODES.includes(protocolMode),
  });
};

// ---------------------------------------------------------------------------
// COMPARISON. The only correct equality test.
// ---------------------------------------------------------------------------
export const isSameEngineeringFact = (left, right) => {
  if (!left || !right) return false;
  if (Number(left.value) !== Number(right.value)) return false;
  return CAPACITY_SCOPE_DIMENSIONS.every((d) => (left[d] ?? null) === (right[d] ?? null));
};

// Resolve the capacity a consumer actually asked for, or fail closed. This is
// the guard that stops a "159 modules/SLC" fact being used as a detector
// capacity, and stops a CLIP capacity being used for a FlashScan design.
export const resolveCapacity = (facts, { resourceClass, scopeType, scopeEntity, protocolMode = null, qualifier = null } = {}) => {
  const candidates = (Array.isArray(facts) ? facts : []).filter((fact) => {
    if (fact.resourceClass !== resourceClass) return false;
    if (scopeType && fact.scopeType !== scopeType) return false;
    if (scopeEntity && fact.scopeEntity !== scopeEntity) return false;
    if (protocolMode && fact.protocolMode !== protocolMode) return false;
    if ((fact.qualifier ?? null) !== (qualifier ?? null)) return false;
    return true;
  });
  const distinct = [...new Set(candidates.map((fact) => Number(fact.value)))];
  if (distinct.length === 0) {
    throw new CapacityScopeError(
      "CAPACITY_NOT_EVIDENCED",
      `No evidenced capacity for ${resourceClass} on ${scopeEntity || "any entity"}${protocolMode ? ` (${protocolMode})` : ""}. Unknown stays unknown.`,
    );
  }
  if (distinct.length > 1) {
    // Conflicting evidence is recorded, never silently resolved.
    throw new CapacityScopeError(
      "CAPACITY_EVIDENCE_CONFLICT",
      `Conflicting evidenced capacities for ${resourceClass} on ${scopeEntity}: ${distinct.join(" vs ")}. The conflict must be resolved against the source documents, not by choosing a value.`,
    );
  }
  return candidates[0];
};

// Explicitly report an unsatisfied request instead of throwing, for call sites
// that must stay fail-closed but continue.
export const capacityOrUnresolved = (facts, request) => {
  try {
    const fact = resolveCapacity(facts, request);
    return { resolved: true, fact, code: null };
  } catch (error) {
    return { resolved: false, fact: null, code: error.code, message: error.message };
  }
};

// ---------------------------------------------------------------------------
// PROTOCOL SAFETY. CLIP is legacy/exception only, per the approved design basis.
// ---------------------------------------------------------------------------
export const isLegacyProtocolFact = (fact) => Boolean(fact?.legacyProtocol);

// A design may only be built on a non-legacy protocol unless an explicit,
// evidence-bearing exception is recorded.
export const assertDesignProtocol = ({ protocolMode, exception = null } = {}) => {
  if (!LEGACY_PROTOCOL_MODES.includes(protocolMode)) return { allowed: true, protocolMode, exception: null };
  if (!exception || !exception.evidence) {
    return {
      allowed: false,
      protocolMode,
      code: "LEGACY_PROTOCOL_REQUIRES_EVIDENCE_BEARING_EXCEPTION",
      message: `${protocolMode} is a legacy/exception protocol. It may be used only where a specific device, installed legacy condition or project requirement demands it AND exact manufacturer compatibility evidence exists. No such exception was recorded.`,
    };
  }
  return { allowed: true, protocolMode, exception };
};
