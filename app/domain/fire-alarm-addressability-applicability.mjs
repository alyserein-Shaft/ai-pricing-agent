// GOLDEN-6C3A -- GOVERNED ADDRESSABILITY EVIDENCE APPLICABILITY & ATTACHMENT.
//
// This module owns exactly ONE step of the GOLDEN-6C3 evidence flow:
//
//   Existing Legend / Specification / Drawing / System Evidence
//        ->  EVIDENCE ELIGIBILITY + SCOPE + APPLICABILITY  (THIS MODULE)
//        ->  GOLDEN-6C3 Device Evidence Resolver
//        ->  classifyFireAlarmSlcItem
//        ->  GOLDEN-6C Point Demand
//
// It decides whether an evidence record legitimately governs a device
// population's ADDRESSABILITY dimension. It does NOT:
//   - classify device identity or family          (GOLDEN-6C3 / 6C3B)
//   - decide point consumption                    (downstream classifier)
//   - reconcile quantities                        (GOLDEN-6C)
//   - select an ecosystem or a panel              (GOLDEN-5)
//
// CORE INVARIANT (mission section 3):
//   evidence exists  +  evidence scope is known  +  population falls within
//   that scope  =  applicable evidence.
//   "Evidence exists somewhere in the project" NEVER equals
//   "applies to every Fire Alarm device".
//
// CORE PRINCIPLE (mission sections 6-9, 20): scope is never guessed.
//   - A legend governs only the sheet that defines it plus sheets the
//     GOVERNED cross-sheet reference model explicitly binds (section 9).
//   - A specification requirement governs only what its approved extraction
//     declares (device families, device classes, named populations, or an
//     explicit system-wide obligation); same-system / same-manufacturer /
//     product-family-guess / same-description are PROHIBITED bases.
//   - Protocol and network-architecture mentions (FlashScan, CLIP, IDP, SLC,
//     "the wiring shall form a data network") never create a per-population
//     addressability attachment by themselves (section 20).
//
// FAIL-CLOSED GOVERNANCE (reuses the GOLDEN-6/6A posture):
//   - Only current, approved, approved-for-downstream evidence may attach.
//   - Superseded and pending/rejected evidence NEVER governs.
//   - A family-scoped requirement cannot attach to a population whose governed
//     family is UNKNOWN (family prerequisite, section 14 -- coordination point
//     with GOLDEN-6C3B).
//   - A system-wide requirement reaches field-device populations but NEVER
//     control equipment, accessories, or NAC notification appliances
//     (sections 11, 13).
//   - Conflicting applicable evidence -> ADDRESSABILITY_CONFLICT; no winner is
//     chosen by mention count, source recency, preferred system, or highest
//     confidence number (section 18).
//   - Resolving "ADDRESSABLE" NEVER fabricates "pointConsumption = 1"; the
//     downstream canonical classifier retains sole ownership (section 33).

const text = (value) => String(value ?? "").trim();

export const ADDRESSABILITY_APPLICABILITY_POLICY_VERSION =
  "fire-alarm-addressability-applicability-policy-1.0.0";

// ---------------------------------------------------------------------------
// Status vocabulary. Deliberately mirrors the GOLDEN-6/6A applicability policy
// (FACP_APPLICABILITY_STATUSES) -- one governance language, not a second copy.
// ---------------------------------------------------------------------------
export const ADDRESSABILITY_APPLICABILITY_STATUSES = Object.freeze([
  "CONFIRMED_APPLICABLE",
  "NOT_APPLICABLE",
  "INSUFFICIENT_EVIDENCE",
  "REQUIRES_ENGINEERING_REVIEW",
]);

// ---------------------------------------------------------------------------
// The ONLY governed evidence bases that may justify a confirmed attachment
// (mission section 7). Every base is asserted by the CALLER as governed
// evidence; the classifier never invents scope from text similarity.
// ---------------------------------------------------------------------------
export const ADDRESSABILITY_EVIDENCE_BASES = Object.freeze([
  "SAME_DRAWING_SYMBOL_SCOPE",
  "SAME_DRAWING_SHEET_SCOPE",
  "EXPLICIT_LEGEND_REFERENCE",
  "EXPLICIT_SCHEDULE_REFERENCE",
  "APPROVED_SYSTEM_WIDE_REQUIREMENT",
  "EXPLICIT_DEVICE_FAMILY_SCOPE",
  "EXPLICIT_BOQ_RELATIONSHIP",
  "HUMAN_ENGINEERING_DECISION",
]);

// Mission section 7 "do not use" list. These establish NOTHING on their own.
export const PROHIBITED_APPLICABILITY_BASES = Object.freeze([
  "SAME_FIRE_ALARM_SYSTEM",
  "SAME_MANUFACTURER",
  "PRODUCT_FAMILY_GUESS",
  "SAME_DESCRIPTION",
]);

// What KIND of claim an evidence record makes. Only DEVICE claims carry a
// per-population addressability assertion; SYSTEM_ARCHITECTURE claims are
// evaluated through the system-wide gate; NETWORK_ARCHITECTURE and PROTOCOL
// claims never attach to individual populations (mission sections 13, 20).
export const ADDRESSABILITY_CLAIM_KINDS = Object.freeze([
  "DEVICE",
  "SYSTEM_ARCHITECTURE",
  "NETWORK_ARCHITECTURE",
  "PROTOCOL",
  "NONE",
]);

// Population-level resolution states (mission section 24).
export const ADDRESSABILITY_RESOLUTION_STATES = Object.freeze([
  "ADDRESSABILITY_RESOLVED_ADDRESSABLE",
  "ADDRESSABILITY_RESOLVED_NON_ADDRESSABLE",
  "ADDRESSABILITY_CONFLICT",
  "ADDRESSABILITY_INSUFFICIENT_EVIDENCE",
  "ADDRESSABILITY_REQUIRES_REVIEW",
]);

// Canonical device classes used ONLY by the system-wide scope gate. The
// caller may supply a governed class via `population.deviceClass`; when the
// caller did not, the class is derived from the population's governed family
// through the family sets below -- which mirror the canonical equipment list
// already used by GOLDEN-6C3's own review-question engine, not a new
// taxonomy. Unknown family/class stays UNKNOWN (never a guess).
export const FIRE_ALARM_DEVICE_CLASSES = Object.freeze([
  "FIELD_DEVICE",
  "CONTROL_EQUIPMENT",
  "NOTIFICATION_APPLIANCE",
  "ACCESSORY",
]);

// Families that system-wide addressability evidence must never reach
// (mission sections 11, 13): control equipment and accessories.
const CONTROL_EQUIPMENT_FAMILIES = new Set([
  "Fire Alarm Control Panel",
  "Power Supply",
  "Battery",
  "Loop Card",
  "Detector Base",
  "Enclosure",
  "Back Box",
  "GUI",
  "Network Card",
]);

// NAC notification appliances ride a notification appliance circuit; a
// system-wide "the system shall be addressable" assertion does not make them
// addressable SLC points (mission section 11).
const NOTIFICATION_APPLIANCE_FAMILIES = new Set([
  "Strobe",
  "Horn",
  "Horn/Strobe",
  "Notification Appliance",
  "Speaker",
]);

export const ADDRESSABILITY_APPLICABILITY_RULES = Object.freeze({
  EVIDENCE_NOT_ELIGIBLE: "RULE_1_EVIDENCE_NOT_ELIGIBLE",
  EVIDENCE_NOT_CURRENT: "RULE_2_EVIDENCE_NOT_CURRENT",
  NO_DEVICE_ADDRESSABILITY_CLAIM: "RULE_3_NO_DEVICE_ADDRESSABILITY_CLAIM",
  PROTOCOL_MENTION_NOT_POPULATION_EVIDENCE: "RULE_4_PROTOCOL_MENTION_NOT_POPULATION_EVIDENCE",
  NETWORK_ARCHITECTURE_NOT_DEVICE_EVIDENCE: "RULE_5_NETWORK_ARCHITECTURE_NOT_DEVICE_EVIDENCE",
  UNKNOWN_BASIS: "RULE_6_UNKNOWN_APPLICABILITY_BASIS",
  PROHIBITED_BASIS: "RULE_7_PROHIBITED_APPLICABILITY_BASIS",
  IMPLICIT_SCOPE_USED_AS_EVIDENCE: "RULE_8_IMPLICIT_SCOPE_IS_NOT_EVIDENCE",
  DRAWING_SCOPE_COVERED: "RULE_9A_DRAWING_SCOPE_COVERED",
  DRAWING_SCOPE_MISMATCH: "RULE_9B_DRAWING_SCOPE_MISMATCH",
  DRAWING_SCOPE_UNKNOWN: "RULE_10_DRAWING_SCOPE_UNKNOWN",
  LEGEND_REFERENCE_OUT_OF_SCOPE: "RULE_11_LEGEND_REFERENCE_OUT_OF_SCOPE",
  SCHEDULE_SCOPE_COVERED: "RULE_12A_SCHEDULE_SCOPE_COVERED",
  SCHEDULE_SCOPE_MISMATCH: "RULE_12B_SCHEDULE_SCOPE_MISMATCH",
  FAMILY_SCOPE_COVERED: "RULE_13A_FAMILY_SCOPE_COVERED",
  FAMILY_SCOPE_MISMATCH: "RULE_13B_FAMILY_SCOPE_MISMATCH",
  FAMILY_PREREQUISITE_UNKNOWN: "RULE_14_FAMILY_PREREQUISITE_UNKNOWN",
  DEVICE_CLASS_NOT_COVERED: "RULE_15_DEVICE_CLASS_NOT_COVERED",
  DEVICE_CLASS_UNKNOWN: "RULE_16_DEVICE_CLASS_UNKNOWN",
  SYSTEM_WIDE_CONFIRMED: "RULE_17_APPROVED_SYSTEM_WIDE_REQUIREMENT",
  EXPLICIT_BOQ_NAMES_POPULATION: "RULE_18_EXPLICIT_BOQ_RELATIONSHIP",
  EXPLICIT_BOQ_EXCLUDES_POPULATION: "RULE_19_EXPLICIT_BOQ_SCOPE_EXCLUDES",
  EXPLICIT_BOQ_NAMES_NONE: "RULE_20_EXPLICIT_BOQ_NAMES_NO_POPULATION",
  HUMAN_DECISION_NAMES_POPULATION: "RULE_21_HUMAN_ENGINEERING_DECISION",
  HUMAN_DECISION_EXCLUDES_POPULATION: "RULE_22_HUMAN_DECISION_SCOPE_EXCLUDES",
  AMBIGUOUS_REQUIRES_REVIEW: "RULE_23_AMBIGUITY_REQUIRES_ENGINEERING_REVIEW",
  NO_GOVERNED_ATTACHMENT_EVIDENCE: "RULE_24_NO_GOVERNED_ATTACHMENT_EVIDENCE",
  CONFLICTING_ATTACHMENTS: "RULE_25_CONFLICTING_ATTACHMENTS_FAIL_CLOSED",
  SCOPE_UNDECLARED_FAIL_CLOSED: "RULE_26_SCOPE_UNDECLARED_FAILS_CLOSED",
});

export const ADDRESSABILITY_APPLICABILITY_FAILURE_CODES = Object.freeze([
  "ADDRESSABILITY_APPLICABILITY_EVIDENCE_REQUIRED",
  "ADDRESSABILITY_APPLICABILITY_POPULATION_REQUIRED",
  "ADDRESSABILITY_APPLICABILITY_CLAIM_KIND_INVALID",
  "ADDRESSABILITY_APPLICABILITY_BASIS_INVALID",
]);

export function addressabilityApplicabilityFailure(code, message, status = 422, details = null) {
  const error = new Error(message);
  Object.setPrototypeOf(error, addressabilityApplicabilityFailure.prototype);
  error.name = "addressabilityApplicabilityFailure";
  error.code = code;
  error.status = status;
  if (details !== undefined && details !== null) error.details = details;
  return error;
}

addressabilityApplicabilityFailure.prototype = Object.create(Error.prototype);

// ---------------------------------------------------------------------------
// Evidence eligibility -- the GOLDEN-6/6A contract applied to addressability
// evidence: current extraction, approved review, approved for downstream.
// Nothing else may ever create an attachment.
// ---------------------------------------------------------------------------
export function isEligibleAddressabilityEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") return false;
  const eligibility = evidence.eligibility || {};
  if (text(eligibility.supercededAt) !== "" || text(eligibility.supersededAt) !== "") return false;
  if (eligibility.extractionIsCurrent === false) return false;
  if (eligibility.rejected === true || eligibility.rejected === 1) return false;
  const status = text(eligibility.reviewStatus);
  if (!/^approved$/i.test(status) && eligibility.approvedForDownstream !== true && eligibility.approvedForDownstream !== 1) {
    return false;
  }
  // An evidence record that asserts an addressability dimension at all must be
  // approved for downstream use, exactly like a requirement needing a link.
  if (Number(eligibility.approvedForDownstream ?? 0) !== 1) return false;
  return true;
}

// A scope counts as DECLARED only when the declaring field actually carries a
// value: an absent key (undefined) is not a declaration. Getting this wrong
// would let a scope-less claim slip through the fail-closed guard below.
const hasExplicitPopulationScope = (scope) => {
  if (!scope || typeof scope !== "object") return false;
  const declaredList = (value) => Array.isArray(value) && value.length > 0;
  const declaredValue = (value) => text(value) !== "";
  return (
    declaredList(scope.populationIds) ||
    declaredList(scope.families) ||
    declaredList(scope.deviceClasses) ||
    scope.systemWide === true ||
    declaredValue(scope.symbol) ||
    declaredValue(scope.sheet) ||
    declaredValue(scope.schedule) ||
    declaredValue(scope.applicableSheets)
  );
};

// Derive the population's governed device class. A caller-provided governed
// class wins; otherwise we derive from the governed family, staying null when
// family is UNKNOWN. Control equipment and NAC notification appliances are
// explicit -- the system-wide gate must never touch them.
export const inferDeviceClass = (family) => {
  if (family === null || family === undefined || text(family) === "") return null;
  if (CONTROL_EQUIPMENT_FAMILIES.has(text(family))) return "CONTROL_EQUIPMENT";
  if (NOTIFICATION_APPLIANCE_FAMILIES.has(text(family))) return "NOTIFICATION_APPLIANCE";
  return "FIELD_DEVICE";
};

// ---------------------------------------------------------------------------
// Pair classification. Pure and deterministic; never touches the database and
// never consults mention counts, source recency, preferred system, or
// confidence numbers as a decision input.
//
//   evidence (governed, caller-asserted):
//     {
//       id, kind,
//       claimKind: 'DEVICE'|'SYSTEM_ARCHITECTURE'|'NETWORK_ARCHITECTURE'
//                  |'PROTOCOL'|'NONE',
//       addressabilityClaim: 'ADDRESSABLE'|'CONVENTIONAL'|'NON_LOOP'|null,
//       basis,                              // one of ADDRESSABILITY_EVIDENCE_BASES
//       scope: {
//         system, sheet, symbol, applicableSheets: [], families: [],
//         deviceClasses: [], populationIds: [], schedule, systemWide
//       },
//       eligibility: { reviewStatus, approvedForDownstream,
//                      extractionIsCurrent, supersededAt, rejected },
//       ambiguous: boolean,                  // contested applicability evidence
//       provenance: { source, sourceLocation, authority, sourcePage,
//                     sourceDrawingNumber, evidenceVersionId }
//     }
//   population:
//     {
//       id, family, deviceClass, system,
//       drawingScope: { sheets: [], symbols: [] }
//     }
// ---------------------------------------------------------------------------
export function classifyAddressabilityApplicability({ evidence, population } = {}) {
  if (!evidence || typeof evidence !== "object") {
    throw addressabilityApplicabilityFailure("ADDRESSABILITY_APPLICABILITY_EVIDENCE_REQUIRED", "An evidence record is required.");
  }
  if (!population || typeof population !== "object" || text(population.id) === "") {
    throw addressabilityApplicabilityFailure("ADDRESSABILITY_APPLICABILITY_POPULATION_REQUIRED", "A device population with a governed identity is required.");
  }
  if (!ADDRESSABILITY_CLAIM_KINDS.includes(evidence.claimKind)) {
    throw addressabilityApplicabilityFailure(
      "ADDRESSABILITY_APPLICABILITY_CLAIM_KIND_INVALID",
      `Unknown addressability claim kind '${evidence.claimKind}'.`,
    );
  }
  if (evidence.addressabilityClaim !== null && evidence.addressabilityClaim !== undefined &&
      !["ADDRESSABLE", "CONVENTIONAL", "NON_LOOP"].includes(text(evidence.addressabilityClaim))) {
    throw addressabilityApplicabilityFailure(
      "ADDRESSABILITY_APPLICABILITY_CLAIM_KIND_INVALID",
      `Unknown addressability claim value '${evidence.addressabilityClaim}'.`,
    );
  }

  const claim = text(evidence.addressabilityClaim ?? "") || null;

  const notApplicable = (ruleId, reason, extra = {}) =>
    ({ status: "NOT_APPLICABLE", basis: evidence.basis ?? null, ruleId, reason, addressabilityClaim: claim, ...extra });
  const insufficient = (ruleId, reason, extra = {}) =>
    ({ status: "INSUFFICIENT_EVIDENCE", basis: evidence.basis ?? null, ruleId, reason, addressabilityClaim: claim, ...extra });
  const review = (reason) =>
    ({ status: "REQUIRES_ENGINEERING_REVIEW", basis: evidence.basis ?? null, ruleId: ADDRESSABILITY_APPLICABILITY_RULES.AMBIGUOUS_REQUIRES_REVIEW, reason, addressabilityClaim: claim });
  const confirmed = (ruleId, reason, extra = {}) =>
    ({ status: "CONFIRMED_APPLICABLE", basis: evidence.basis, ruleId, reason, addressabilityClaim: claim, ...extra });

  // RULE-1/RULE-2 -- eligibility and currency are pre-conditions for ANY
  // attachment. Pending, rejected, unapproved, and superseded evidence never
  // governs (mission sections 5, 36).
  if (!isEligibleAddressabilityEvidence(evidence)) {
    const current = evidence.eligibility?.extractionIsCurrent !== false &&
      text(evidence.eligibility?.supersededAt) === "" && text(evidence.eligibility?.supercededAt) === "" &&
      evidence.eligibility?.rejected !== true && evidence.eligibility?.rejected !== 1;
    if (current) {
      return notApplicable(
        ADDRESSABILITY_APPLICABILITY_RULES.EVIDENCE_NOT_ELIGIBLE,
        "Evidence that is not both review_status='Approved' and approved_for_downstream=1 can never create a governed addressability attachment.",
      );
    }
    return notApplicable(
      ADDRESSABILITY_APPLICABILITY_RULES.EVIDENCE_NOT_CURRENT,
      "Evidence is superseded, rejected, or belongs to a non-current extraction; it is not current evidence and cannot govern.",
    );
  }

  // RULE-3 -- the evidence must actually make a device-level addressability
  // claim of a kind that can reach a population.
  const claimKind = evidence.claimKind ?? "NONE";
  if (claimKind === "NETWORK_ARCHITECTURE") {
    return notApplicable(
      ADDRESSABILITY_APPLICABILITY_RULES.NETWORK_ARCHITECTURE_NOT_DEVICE_EVIDENCE,
      "This is network/system-architecture evidence (e.g. wiring of the addressable system shall form a data network); it makes no per-device addressability assertion and cannot attach to a population.",
    );
  }
  if (claimKind === "PROTOCOL") {
    // Mission section 20: a protocol mention never attaches "to every
    // population", but it MAY attach when the evidence carries an explicit
    // governed population relationship (EXPLICIT_BOQ_RELATIONSHIP /
    // HUMAN_ENGINEERING_DECISION naming concrete populations). Without such a
    // relationship the mention is not population evidence at all.
    const explicitlyNamedRelationship = (evidence.basis === "EXPLICIT_BOQ_RELATIONSHIP" || evidence.basis === "HUMAN_ENGINEERING_DECISION") &&
      Array.isArray(evidence.scope?.populationIds) && evidence.scope.populationIds.length > 0;
    if (!explicitlyNamedRelationship) {
      return notApplicable(
        ADDRESSABILITY_APPLICABILITY_RULES.PROTOCOL_MENTION_NOT_POPULATION_EVIDENCE,
        "A protocol mention (FlashScan/CLIP/IDP/SLC) without a governed population relationship never creates an addressability attachment.",
      );
    }
  }
  if (claimKind === "NONE" || text(evidence.addressabilityClaim ?? "") === "") {
    return notApplicable(
      ADDRESSABILITY_APPLICABILITY_RULES.NO_DEVICE_ADDRESSABILITY_CLAIM,
      "The evidence record carries no device addressability claim (positive or negative); it offers bindings for other dimensions (e.g. identity/family) and cannot govern addressability.",
    );
  }

  // RULE-6/7 -- the basis must be a governed basis, never a prohibited one.
  const basis = evidence.basis ?? null;
  if (basis === null) {
    return insufficient(ADDRESSABILITY_APPLICABILITY_RULES.UNKNOWN_BASIS, "No governed applicability basis was declared.");
  }
  if (!ADDRESSABILITY_EVIDENCE_BASES.includes(basis)) {
    if (PROHIBITED_APPLICABILITY_BASES.includes(basis)) {
      return notApplicable(
        ADDRESSABILITY_APPLICABILITY_RULES.PROHIBITED_BASIS,
        `'${basis}' is a prohibited evidence basis (mission section 7); similarity/membership attributes can never establish applicability.`,
      );
    }
    return insufficient(ADDRESSABILITY_APPLICABILITY_RULES.UNKNOWN_BASIS, `Unknown governed applicability basis '${basis}'; fail closed.`);
  }

  const scope = evidence.scope || {};
  const systemScope = text(scope.system || "") === "" ? null : text(scope.system);
  if (systemScope && text(population.system || "") !== "" && systemScope !== text(population.system)) {
    return notApplicable(
      ADDRESSABILITY_APPLICABILITY_RULES.IMPLICIT_SCOPE_USED_AS_EVIDENCE,
      "The evidence declares a different system scope; it does not govern this population. Same-project membership never replaces a declared scope.",
    );
  }

  const populationSheets = Array.isArray(population.drawingScope?.sheets) ? population.drawingScope.sheets.map(text).filter(Boolean) : [];
  const populationSymbols = Array.isArray(population.drawingScope?.symbols) ? population.drawingScope.symbols.map(text).filter(Boolean) : [];
  const scopeSheets = [...new Set([...(Array.isArray(scope.applicableSheets) ? scope.applicableSheets : []), ...(scope.sheet ? [scope.sheet] : [])].map(text).filter(Boolean))];

  // RULE-23 -- ambiguous / contested evidence never auto-attaches; surfaced
  // for a governed human applicability decision, exactly like GOLDEN-6A. A
  // RECORDED human decision (which names populations) resolves ambiguity.
  if (evidence.ambiguous === true && basis !== "HUMAN_ENGINEERING_DECISION") {
    return review("Applicability evidence is ambiguous or contested (e.g. conflicting legend vs specification semantics); a governed human addressability applicability decision is required before any attachment may be planned.");
  }

  const populationNamed = (ids) => Array.isArray(ids) && ids.includes(population.id);

  // RULE-26 -- fail closed on a scope-less claim. A governed device
  // addressability claim that declares no scope of any kind (no population,
  // family, device class, sheet, symbol, schedule, and not system-wide) cannot
  // be proven applicable to anything; it must never be allowed to attach by
  // default. This is the structural guard behind "evidence exists + evidence
  // scope known + population within scope".
  if (!hasExplicitPopulationScope(scope) && basis !== "APPROVED_SYSTEM_WIDE_REQUIREMENT") {
    return insufficient(
      ADDRESSABILITY_APPLICABILITY_RULES.SCOPE_UNDECLARED_FAIL_CLOSED,
      "The evidence declares no governed scope (no population, family, device class, sheet, symbol or schedule); without a declared scope it cannot be proven applicable to any population.",
    );
  }

  // Drawing-scoped bases (missions sections 8, 9, 22): the population must
  // fall inside the legend/schedule's declared sheet scope.
  if (basis === "SAME_DRAWING_SYMBOL_SCOPE" || basis === "SAME_DRAWING_SHEET_SCOPE" || basis === "EXPLICIT_LEGEND_REFERENCE") {
    if (scopeSheets.length === 0) {
      return insufficient(ADDRESSABILITY_APPLICABILITY_RULES.DRAWING_SCOPE_UNKNOWN, "The drawing-scoped evidence declares no sheet scope; without a governed scope it cannot be proven applicable and must not leak.");
    }
    if (populationSheets.length === 0 && populationSymbols.length === 0) {
      return insufficient(
        ADDRESSABILITY_APPLICABILITY_RULES.DRAWING_SCOPE_UNKNOWN,
        "The population carries no governed drawing scope; a drawing-scoped legend cannot be proven applicable to a BOQ population without a canonical relationship to that drawing scope (mission section 21).",
      );
    }
    if (basis === "SAME_DRAWING_SYMBOL_SCOPE") {
      const symbol = text(scope.symbol ?? "");
      if (symbol === "") {
        return insufficient(ADDRESSABILITY_APPLICABILITY_RULES.DRAWING_SCOPE_UNKNOWN, "Symbol-scope evidence declares no symbol; a legend attachment must preserve symbol identity (mission section 10).");
      }
      if (!populationSymbols.includes(symbol)) {
        return notApplicable(
          ADDRESSABILITY_APPLICABILITY_RULES.DRAWING_SCOPE_MISMATCH,
          "The population's governed symbols do not include this legend entry's symbol; the legend does not govern this population on this sheet.",
        );
      }
    }
    if (populationSheets.length === 0) {
      return insufficient(ADDRESSABILITY_APPLICABILITY_RULES.DRAWING_SCOPE_UNKNOWN, "The population carries no governed sheet scope; drawing-scoped evidence cannot be proven applicable to it.");
    }
    const sheetCovered = populationSheets.some((sheet) => scopeSheets.includes(sheet));
    if (!sheetCovered) {
      return notApplicable(
        basis === "EXPLICIT_LEGEND_REFERENCE"
          ? ADDRESSABILITY_APPLICABILITY_RULES.LEGEND_REFERENCE_OUT_OF_SCOPE
          : ADDRESSABILITY_APPLICABILITY_RULES.DRAWING_SCOPE_MISMATCH,
        `${basis}: the population's sheets (${populationSheets.join(", ")}) are outside the governed legend/drawing scope (${scopeSheets.join(", ")}). Cross-sheet applicability is never implied.`,
      );
    }
    return confirmed(
      ADDRESSABILITY_APPLICABILITY_RULES.DRAWING_SCOPE_COVERED,
      `The governed legend evidence covers this population's drawing scope (sheets ${scopeSheets.join(", ")})${basis === "SAME_DRAWING_SYMBOL_SCOPE" ? ` and symbol ${scope.symbol}` : ""}.`,
      { evidenceScope: { sheets: scopeSheets, symbol: scope.symbol ?? null } },
    );
  }

  if (basis === "EXPLICIT_SCHEDULE_REFERENCE") {
    if (!scope.schedule) {
      return insufficient(ADDRESSABILITY_APPLICABILITY_RULES.SCHEDULE_SCOPE_MISMATCH, "Schedule-scope evidence declares no schedule identity; fuzzy name matching is never a basis (mission section 23).");
    }
    const populationSchedules = Array.isArray(population.schedules) ? population.schedules.map(text).filter(Boolean) : [];
    if (!populationSchedules.includes(text(scope.schedule))) {
      return notApplicable(
        ADDRESSABILITY_APPLICABILITY_RULES.SCHEDULE_SCOPE_MISMATCH,
        "The population is not linked to this exact schedule identity; schedule rows are never matched to populations by fuzzy name only.",
      );
    }
    return confirmed(
      ADDRESSABILITY_APPLICABILITY_RULES.SCHEDULE_SCOPE_COVERED,
      "The governed schedule reference links this population's schedule row to an addressability property.",
      { evidenceScope: { schedule: text(scope.schedule) } },
    );
  }

  if (basis === "EXPLICIT_BOQ_RELATIONSHIP") {
    if (populationNamed(scope.populationIds)) {
      return confirmed(ADDRESSABILITY_APPLICABILITY_RULES.EXPLICIT_BOQ_NAMES_POPULATION, "The governed relationship connects this evidence to this BOQ population explicitly.");
    }
    if (Array.isArray(scope.populationIds)) {
      return notApplicable(ADDRESSABILITY_APPLICABILITY_RULES.EXPLICIT_BOQ_EXCLUDES_POPULATION, "The governed relationship names other populations; this population is explicitly outside its scope.");
    }
    return insufficient(ADDRESSABILITY_APPLICABILITY_RULES.EXPLICIT_BOQ_NAMES_NONE, "An explicit BOQ relationship must name the populations it covers; none were recorded.");
  }

  if (basis === "HUMAN_ENGINEERING_DECISION") {
    if (populationNamed(scope.populationIds)) {
      return confirmed(ADDRESSABILITY_APPLICABILITY_RULES.HUMAN_DECISION_NAMES_POPULATION, "A governed human engineering decision recorded this evidence as applicable to this population.");
    }
    if (Array.isArray(scope.populationIds)) {
      return notApplicable(ADDRESSABILITY_APPLICABILITY_RULES.HUMAN_DECISION_EXCLUDES_POPULATION, "The human decision names other populations; this population is outside its decided scope.");
    }
    return insufficient(ADDRESSABILITY_APPLICABILITY_RULES.HUMAN_DECISION_EXCLUDES_POPULATION, "A governed human applicability decision must name the populations it covers; none were recorded.");
  }

  if (basis === "EXPLICIT_DEVICE_FAMILY_SCOPE" || basis === "APPROVED_SYSTEM_WIDE_REQUIREMENT") {
    const families = Array.isArray(scope.families) ? scope.families.map(text).filter(Boolean) : [];
    const deviceClasses = Array.isArray(scope.deviceClasses) ? scope.deviceClasses : [];
    const populationFamily = text(population.family ?? "");
    const populationClass = population.deviceClass ?? inferDeviceClass(population.family ?? null);

    if (basis === "EXPLICIT_DEVICE_FAMILY_SCOPE") {
      if (families.length === 0) {
        return insufficient(ADDRESSABILITY_APPLICABILITY_RULES.FAMILY_SCOPE_MISMATCH, "A device-family-scoped requirement must declare the device families it governs; none were recorded (mission section 12).");
      }
      if (populationFamily === "") {
        return insufficient(
          ADDRESSABILITY_APPLICABILITY_RULES.FAMILY_PREREQUISITE_UNKNOWN,
          "This requirement is scoped to declared device families and the population's governed family is UNKNOWN; applicability cannot be confirmed and stays INSUFFICIENT_EVIDENCE until the family is governed (GOLDEN-6C3B).",
        );
      }
      if (!families.includes(populationFamily)) {
        return notApplicable(
          ADDRESSABILITY_APPLICABILITY_RULES.FAMILY_SCOPE_MISMATCH,
          `The requirement governs families [${families.join(", ")}], not the governed family '${populationFamily}'; explicit scope is never broadened.`,
        );
      }
      return confirmed(ADDRESSABILITY_APPLICABILITY_RULES.FAMILY_SCOPE_COVERED, "The population's governed family falls within the requirement's declared device-family scope.", { evidenceScope: { families } });
    }

    // APPROVED_SYSTEM_WIDE_REQUIREMENT (missions sections 11, 13, 15).
    // The requirement may reach field-device populations but NEVER control
    // equipment, accessories, or NAC notification appliances.
    if (populationClass === "CONTROL_EQUIPMENT" || populationClass === "ACCESSORY" || populationClass === "NOTIFICATION_APPLIANCE") {
      return notApplicable(
        ADDRESSABILITY_APPLICABILITY_RULES.DEVICE_CLASS_NOT_COVERED,
        `A system-wide addressability requirement never makes ${populationClass.toLowerCase()} addressable; this population is outside its governed reach (mission section 13).`,
      );
    }
    if (deviceClasses.length > 0 && populationClass !== null && !deviceClasses.includes(populationClass)) {
      return notApplicable(ADDRESSABILITY_APPLICABILITY_RULES.DEVICE_CLASS_NOT_COVERED, "The requirement's declared device-class scope does not include this population's class.");
    }
    if (families.length > 0) {
      if (populationFamily === "") {
        return insufficient(ADDRESSABILITY_APPLICABILITY_RULES.FAMILY_PREREQUISITE_UNKNOWN, "The system-wide requirement further declares governed families and this population's governed family is UNKNOWN; it stays INSUFFICIENT_EVIDENCE until the family is governed.");
      }
      if (!families.includes(populationFamily)) {
        return notApplicable(ADDRESSABILITY_APPLICABILITY_RULES.FAMILY_SCOPE_MISMATCH, "The requirement's declared families exclude this population's governed family.");
      }
      return confirmed(ADDRESSABILITY_APPLICABILITY_RULES.SYSTEM_WIDE_CONFIRMED, "The approved system-wide addressability requirement governs this population's declared family.", { evidenceScope: { families } });
    }
    if (populationClass === null) {
      return insufficient(
        ADDRESSABILITY_APPLICABILITY_RULES.DEVICE_CLASS_UNKNOWN,
        "The approved system-wide requirement could cover field-device populations, but this population's governed family/device class is UNKNOWN; applicability is not confirmable and stays INSUFFICIENT_EVIDENCE.",
      );
    }
    return confirmed(
      ADDRESSABILITY_APPLICABILITY_RULES.SYSTEM_WIDE_CONFIRMED,
      "The approved system-wide addressability requirement genuinely establishes this population (a governed field device) as addressable.",
      { evidenceScope: { systemWide: true } },
    );
  }

  // RULE-24 -- no path reached. Fail closed.
  return insufficient(
    ADDRESSABILITY_APPLICABILITY_RULES.NO_GOVERNED_ATTACHMENT_EVIDENCE,
    "No governed applicability basis produced a decision under the scope gate; the pair stays fail-closed.",
  );
}

// ---------------------------------------------------------------------------
// Planner. Pure and deterministic; idempotent against the canonical attachment
// identity `evidenceId|populationId` (mission section 37). One evidence row
// may govern many population relationships (mission section 15) -- the loop
// below is exactly that; no evidence is duplicated per population.
// ---------------------------------------------------------------------------
export function planAddressabilityAttachments({
  evidences = [],
  populations = [],
  existingAttachments = [],
} = {}) {
  const attachmentKey = (ev, population) => `${text(ev.id)}|${text(population.id)}`;
  const existingKeys = new Set(
    (Array.isArray(existingAttachments) ? existingAttachments : [])
      .map((a) =>
        a?.key ||
        (a?.evidenceId !== undefined && a?.populationId !== undefined
          ? `${text(a.evidenceId)}|${text(a.populationId)}`
          : attachmentKey(a?.evidence ?? {}, a?.population ?? {})),
      )
      .filter(Boolean),
  );

  const classifications = [];
  const attachments = [];
  for (const evidence of evidences) {
    for (const population of populations) {
      const classification = classifyAddressabilityApplicability({ evidence, population });
      classifications.push({ evidenceId: text(evidence.id), populationId: text(population.id), ...classification });
      if (classification.status !== "CONFIRMED_APPLICABLE") continue;
      const attachment = buildAddressabilityAttachment({ evidence, population, classification });
      if (!existingKeys.has(attachmentKey(evidence, population))) {
        attachments.push(attachment);
        existingKeys.add(attachmentKey(evidence, population));
      }
    }
  }

  return {
    policyVersion: ADDRESSABILITY_APPLICABILITY_POLICY_VERSION,
    classifications,
    attachmentsToCreate: attachments,
    confirmedPairs: classifications.filter((entry) => entry.status === "CONFIRMED_APPLICABLE").length,
    reviewPairs: classifications
      .filter((entry) => entry.status === "REQUIRES_ENGINEERING_REVIEW")
      .map((entry) => ({ evidenceId: entry.evidenceId, populationId: entry.populationId, reason: entry.reason })),
    rejectedPairs: classifications.filter((entry) => entry.status === "NOT_APPLICABLE"),
  };
}

// ---------------------------------------------------------------------------
// Attachment: provenance-complete (mission sections 16, 17). The downstream
// resolver never receives a naked `addressable = true`: every attachment
// retains which evidence, which population, why applicable, which rule, which
// scope, which authority, which source, and which source location.
// ---------------------------------------------------------------------------
export function buildAddressabilityAttachment({ evidence, population, classification }) {
  const provenance = evidence.provenance || {};
  return {
    key: `${text(evidence.id)}|${text(population.id)}`,
    evidenceId: text(evidence.id),
    populationId: text(population.id),
    basis: classification.basis,
    ruleId: classification.ruleId,
    reason: classification.reason,
    policyVersion: ADDRESSABILITY_APPLICABILITY_POLICY_VERSION,
    addressabilityClaim: text(evidence.addressabilityClaim ?? "") || null,
    negative: evidence.negative === true || ["CONVENTIONAL", "NON_LOOP"].includes(text(evidence.addressabilityClaim ?? "")),
    scope: {
      system: evidence.scope?.system ?? null,
      sheets: [...new Set([
        ...(Array.isArray(evidence.scope?.applicableSheets) ? evidence.scope.applicableSheets : []),
        ...(evidence.scope?.sheet ? [evidence.scope.sheet] : []),
      ])],
      symbol: evidence.scope?.symbol ?? null,
      families: evidence.scope?.families ?? [],
      systemWide: evidence.scope?.systemWide ?? false,
      schedule: evidence.scope?.schedule ?? null,
      populationIds: evidence.scope?.populationIds ?? [],
    },
    provenance: {
      source: provenance.source ?? null,
      sourceLocation: provenance.sourceLocation ?? null,
      authority: provenance.authority ?? null,
      sourcePage: provenance.sourcePage ?? null,
      sourceDrawingNumber: provenance.sourceDrawingNumber ?? null,
      evidenceVersionId: provenance.evidenceVersionId ?? null,
    },
    // One evidence row may govern many relationships; the key preserves that
    // without cloning the evidence (mission section 15).
    evidenceKey: text(evidence.id),
  };
}

// ---------------------------------------------------------------------------
// Population-level output (mission section 24): applicable / rejected /
// review-required evidence lists plus the single resolved addressability and
// resolution state. Conflicts fail closed; a pending review question wins
// over an apparent resolution; no value is ever guessed.
// ---------------------------------------------------------------------------
export function derivePopulationAddressability({ population, classifications = [] } = {}) {
  const populationId = text(population?.id ?? "");
  const forPopulation = classifications.filter((entry) => text(entry.populationId) === populationId);

  const applicable = forPopulation
    .filter((entry) => entry.status === "CONFIRMED_APPLICABLE")
    .map((entry) => ({
      evidenceId: entry.evidenceId,
      basis: entry.basis,
      ruleId: entry.ruleId,
      reason: entry.reason,
      addressabilityClaim: text(entry.addressabilityClaim ?? ""),
    }));
  const rejected = forPopulation
    .filter((entry) => entry.status === "NOT_APPLICABLE")
    .map((entry) => ({ evidenceId: entry.evidenceId, basis: entry.basis, ruleId: entry.ruleId, reason: entry.reason }));
  const reviewRequired = forPopulation
    .filter((entry) => entry.status === "REQUIRES_ENGINEERING_REVIEW")
    .map((entry) => ({ evidenceId: entry.evidenceId, basis: entry.basis, ruleId: entry.ruleId, reason: entry.reason }));

  const applicableClaims = [...new Set(applicable.map((a) => a.addressabilityClaim).filter(Boolean))];

  const conflicting = applicableClaims.length > 1;

  let resolvedAddressability = null;
  let resolutionState;
  if (conflicting) {
    resolutionState = "ADDRESSABILITY_CONFLICT";
    resolvedAddressability = null;
  } else if (reviewRequired.length > 0) {
    // A governed review question could overturn the resolution; fail closed.
    resolutionState = "ADDRESSABILITY_REQUIRES_REVIEW";
    resolvedAddressability = applicableClaims.length === 1 ? applicableClaims[0] : null;
  } else if (applicableClaims.length === 1) {
    resolvedAddressability = applicableClaims[0];
    resolutionState = appliedResolutionState(applicableClaims[0]);
  } else {
    resolutionState = "ADDRESSABILITY_INSUFFICIENT_EVIDENCE";
    resolvedAddressability = null;
  }

  return {
    populationId,
    applicableAddressabilityEvidence: applicable,
    rejectedEvidence: rejected,
    reviewRequiredEvidence: reviewRequired,
    resolvedAddressability,
    resolutionState,
    conflictingClaims: [...new Set(applicableClaims)].length > 1 ? [...new Set(applicableClaims)] : [],
  };
}

const appliedResolutionState = (claim) =>
  claim === "ADDRESSABLE"
    ? "ADDRESSABILITY_RESOLVED_ADDRESSABLE"
    : ["CONVENTIONAL", "NON_LOOP"].includes(claim)
      ? "ADDRESSABILITY_RESOLVED_NON_ADDRESSABLE"
      : "ADDRESSABILITY_INSUFFICIENT_EVIDENCE";

// ---------------------------------------------------------------------------
// Downstream handoff (missions sections 25, 35). Builds the governed
// observation the GOLDEN-6C3 resolver consumes natively. Point consumption is
// deliberately NOT asserted here: the canonical classifier owns it.
// ---------------------------------------------------------------------------
export function buildResolverObservation(attachment, population) {
  if (!attachment || !population || !text(attachment.evidenceId) || !text(attachment.populationId) || !text(attachment.addressabilityClaim ?? "")) {
    throw addressabilityApplicabilityFailure(
      "ADDRESSABILITY_APPLICABILITY_EVIDENCE_REQUIRED",
      "A governed addressability attachment (evidenceId, populationId, addressabilityClaim) and its population are required to build a resolver observation.",
    );
  }
  const scope = attachment.scope || {};
  const provenance = attachment.provenance || {};
  return {
    id: `addressability-attachment:${attachment.evidenceId}:${attachment.populationId}`,
    source: provenance.source ?? null,
    sourceLocation: provenance.sourceLocation ?? null,
    authority: provenance.authority ?? null,
    reviewStatus: "Approved",
    applicableTo: attachment.populationId,
    // The applicability layer already validated drawing scope with full
    // provenance on the attachment (scope.sheets). The resolver observation is
    // population-scoped; re-declaring `scope.sheet` here would trip the
    // resolver's own cross-sheet guard on callers that pass no drawing context.
    // Sheets remain traceable in `meta.sheets`.
    scope: {
      population: attachment.populationId,
    },
    claims: {
      addressability: text(attachment.addressabilityClaim) || undefined,
    },
    meta: {
      policyVersion: ADDRESSABILITY_APPLICABILITY_POLICY_VERSION,
      basis: attachment.basis,
      ruleId: attachment.ruleId,
      evidenceId: attachment.evidenceId,
      reason: attachment.reason,
      sheets: scope.sheets ?? [],
    },
  };
}

// ---------------------------------------------------------------------------
// Specific human review questions (mission section 34). Never generic: every
// question names the evidence, the population, the governed family, and the
// exact applicability question that blocks the attachment.
// ---------------------------------------------------------------------------
export function addressabilityReviewQuestions({ evidence, population }) {
  const p = population || {};
  const e = evidence || {};
  const provenance = e.provenance || {};
  const learnable = {
    evidence: e.id ?? null,
    population: p.id ?? null,
    family: text(p.family) !== "" ? p.family : null,
  };
  const familyScope = Array.isArray(e.scope?.families) && e.scope.families.length > 0
    ? e.scope.families.join(", ")
    : null;
  return [
    {
      evidenceId: learnable.evidence,
      populationId: learnable.population,
      question: familyScope
        ? `Evidence "${e.id ?? "?"}" declares an addressability requirement scoped to device families [${familyScope}]; population ${p.id ?? "?"} has ${learnable.family ? `governed family '${learnable.family}'` : "no governed family"}. Is this population within the requirement's declared family scope, and what governed evidence confirms it?`
        : `Evidence "${e.id ?? "?"}" (${provenance.source ?? "source unknown"}) makes an addressability assertion; population ${p.id ?? "?"} must be confirmed within the evidence's governed scope before any attachment is planned. Which governed scope applies, and is the population inside it?`,
      state: "ADDRESSABILITY_APPLICABILITY_REQUIRED",
      known: learnable,
    },
  ];
}