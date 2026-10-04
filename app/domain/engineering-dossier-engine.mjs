// STAGE 4C -- ENGINEERING DOSSIER / DESIGN-BASIS READINESS.
//
// Raises the demo-wired engineering-assurance.mjs r1-r6 dossier into governed
// pipeline semantics. The r1-r6 requirement classes are normalized into the
// canonical dossier requirement TYPES below (SYSTEM_ARCHITECTURE, ...), each
// typed dossier requirement has a governed template per system pack, a
// deterministic status model (MISSING / PRESENT_UNVERIFIED / VERIFIED /
// CONFLICTING / STALE / ...), and evidence must bind to a Stage 4A authority
// class -- never a bare string. Unknown systems and ungoverned packs are
// NEVER blocked by a dossier item that does not apply to them.
//
// Readiness rules are deterministic, so a complete, verified dossier needs no
// manual checkbox approval: the engine VERIFIES it. Engineer exceptions exist
// ONLY for CONFLICTING / STALE / unverified-critical evidence.
//
// Pure domain logic: no DOM, no fetch, no DB, no Math.random.
import { calculateSlcExpansion } from "./fire-alarm-slc-capacity-calculator.mjs";
import { isAuthorityClass, isEvidenceKind, GLOBAL_NUMERIC_AUTHORITY_RANK } from "./evidence-authority-policy.mjs";

export const DOSSIER_ENGINE_VERSION = "engineering-dossier-engine-1.0.0";

// ---------------------------------------------------------------------------
// 4C-1 -- canonical dossier requirement types + the r1-r6 normalization.
// ---------------------------------------------------------------------------
export const DOSSIER_REQUIREMENT_TYPES = Object.freeze([
  "SYSTEM_ARCHITECTURE",
  "AUTHORITY_APPROVAL",
  "CODE_STANDARD_BASIS",
  "CAPACITY_CALCULATION",
  "ENGINEERING_CALCULATION",
  "TECHNICAL_WARRANTY_OR_SUPPORT",
]);

export const DOSSIER_TYPE_LABELS = Object.freeze({
  SYSTEM_ARCHITECTURE: "System architecture",
  AUTHORITY_APPROVAL: "Authority approval",
  CODE_STANDARD_BASIS: "Codes and standards basis",
  CAPACITY_CALCULATION: "Capacity calculation",
  ENGINEERING_CALCULATION: "Engineering calculation",
  TECHNICAL_WARRANTY_OR_SUPPORT: "Technical warranty / support commitment",
});

// Normalization of engineering-assurance.mjs's ENGINEERING_REQUIREMENT_CLASSES
// (r1..r6) into the canonical types. The legacy demo classes are not blindly
// wired into production; they are CONVERTED here, with r1..r6 mapping as
// documented in engineering-assurance.mjs's FIRE_ALARM_REQUIREMENT_POLICY:
//   r1 SYSTEM            -> SYSTEM_ARCHITECTURE
//   r2 AUTHORITY         -> AUTHORITY_APPROVAL
//   r3 STANDARD          -> CODE_STANDARD_BASIS
//   r4 CAPACITY          -> CAPACITY_CALCULATION
//   r5 CALCULATION       -> ENGINEERING_CALCULATION
//   r6 COMMERCIAL_TECHNICAL -> TECHNICAL_WARRANTY_OR_SUPPORT
export const LEGACY_CLASS_TO_DOSSIER_TYPE = Object.freeze({
  "System architecture": "SYSTEM_ARCHITECTURE",
  "Authority approval": "AUTHORITY_APPROVAL",
  "Codes and standards": "CODE_STANDARD_BASIS",
  "Capacity calculation": "CAPACITY_CALCULATION",
  "Engineering calculation": "ENGINEERING_CALCULATION",
  "Technical warranty": "TECHNICAL_WARRANTY_OR_SUPPORT",
});

export const dossierTypeForLegacyClass = (legacyClassName) => LEGACY_CLASS_TO_DOSSIER_TYPE[legacyClassName] || null;

// ---------------------------------------------------------------------------
// 4C-3 -- deterministic status model.
// ---------------------------------------------------------------------------
export const DOSSIER_STATUSES = Object.freeze([
  "NOT_REQUIRED",
  "MISSING",
  "PRESENT_UNVERIFIED",
  "VERIFIED",
  "CONFLICTING",
  "STALE",
  "BLOCKING",
  "WARNING",
]);

export const isDossierStatus = (value) => DOSSIER_STATUSES.includes(value);

// ---------------------------------------------------------------------------
// 4C-2 -- per-system-pack dossier templates (DATA). `required` may be a
// boolean or a predicate over the evaluation context (e.g. AUTHORITY_APPROVAL
// only applies when the jurisdiction demands AHJ/Civil Defense approval).
// criticality governs blocking: CRITICAL missing/conflicting/stale evidence
// blocks technical acceptance; WARNING-typed items only ever warn.
// ---------------------------------------------------------------------------
export const DOSSIER_TEMPLATES = Object.freeze({
  "Fire Alarm": Object.freeze([
    { type: "SYSTEM_ARCHITECTURE", criticality: "CRITICAL", required: true },
    { type: "AUTHORITY_APPROVAL", criticality: "CRITICAL", required: (context) => context?.jurisdiction?.regulatoryApproval === "Civil Defense" || context?.requiresAuthorityApproval === true },
    { type: "CODE_STANDARD_BASIS", criticality: "CRITICAL", required: true },
    { type: "CAPACITY_CALCULATION", criticality: "CRITICAL", required: true },
    { type: "ENGINEERING_CALCULATION", criticality: "CRITICAL", required: true },
    { type: "TECHNICAL_WARRANTY_OR_SUPPORT", criticality: "WARNING", required: false },
  ]),
  CCTV: Object.freeze([
    { type: "SYSTEM_ARCHITECTURE", criticality: "CRITICAL", required: true },
    { type: "CAPACITY_CALCULATION", criticality: "CRITICAL", required: true },
    { type: "ENGINEERING_CALCULATION", criticality: "CRITICAL", required: true },
    { type: "TECHNICAL_WARRANTY_OR_SUPPORT", criticality: "WARNING", required: false },
  ]),
  UPS: Object.freeze([
    { type: "SYSTEM_ARCHITECTURE", criticality: "CRITICAL", required: true },
    { type: "CAPACITY_CALCULATION", criticality: "CRITICAL", required: true },
    { type: "ENGINEERING_CALCULATION", criticality: "CRITICAL", required: true },
    { type: "TECHNICAL_WARRANTY_OR_SUPPORT", criticality: "WARNING", required: false },
  ]),
});

export const dossierTemplateFor = (system) => (system && DOSSIER_TEMPLATES[system]) || [];

const requiredForRow = (row, context) => (typeof row.required === "function" ? row.required(context || {}) : row.required);

// ---------------------------------------------------------------------------
// 4C-4 -- evidence must bind to a Stage 4A authority class.
// ---------------------------------------------------------------------------
export const authorityCheckForDossierEvidence = ({ authorityClass, evidenceKind } = {}) => {
  if (!isAuthorityClass(authorityClass)) {
    return { acceptable: false, reason: "Dossier evidence must bind to a governed Stage 4A authority class; none recognized -- failing closed." };
  }
  if (!isEvidenceKind(evidenceKind)) {
    return { acceptable: false, reason: `Dossier evidence kind "${evidenceKind}" is not governed; failing closed.` };
  }
  if (evidenceKind === "INFERRED") {
    return { acceptable: false, reason: "Inferred evidence can never VERIFY a dossier item; it is a suggestion only." };
  }
  if (authorityClass === "COMMERCIAL" && evidenceKind === "EXPLICIT") {
    // Commercial evidence is acceptable ONLY as technical warranty/support
    // commitment corroboration; the dossier layer enforces that scope.
    return { acceptable: true, commercial: true };
  }
  return { acceptable: true, commercial: false };
};

// ---------------------------------------------------------------------------
// evaluateDossier -- deterministic per-type status resolution.
// ---------------------------------------------------------------------------
const evidenceStatus = ({ row, evidenceEntries, context }) => {
  const entries = Array.isArray(evidenceEntries) ? evidenceEntries : [];
  if (!entries.length) {
    // Required without evidence is MISSING; optional-without-evidence is
    // NOT_REQUIRED (a warranty may simply not apply).
    return row.criticality === "CRITICAL" ? "MISSING" : row.required === true ? "MISSING" : "NOT_REQUIRED";
  }
  const conflictStates = entries.filter((entry) => entry?.state === "conflict" || /conflict/i.test(entry?.reviewStatus || ""));
  const staleStates = entries.filter((entry) => entry?.stale === true || /stale/i.test(entry?.reviewStatus || ""));
  const missingStates = entries.filter((entry) => entry?.state === "missing" || /missing|insufficient/i.test(entry?.reviewStatus || ""));
  // Commercial evidence can corroborate a warranty commitment and nothing
  // else; it is never allowed to VERIFY a technical dossier item.
  const commercialMismatch = entries.some((entry) => entry?.authorityClass === "COMMERCIAL" && row.type !== "TECHNICAL_WARRANTY_OR_SUPPORT");
  if (conflictStates.length) return "CONFLICTING";
  if (staleStates.length) return "STALE";
  if (missingStates.length) return "MISSING";
  if (commercialMismatch) return "PRESENT_UNVERIFIED";
  const verifiedStates = entries.filter((entry) => entry?.state === "verified" || /^(approved|verified)$/i.test(entry?.reviewStatus || ""));
  if (verifiedStates.length) return "VERIFIED";
  return "PRESENT_UNVERIFIED";
};

export const evaluateDossier = ({ system, scope = null, context = null, dossierEvidence = {} } = {}) => {
  const template = dossierTemplateFor(system);
  const items = template.map((row) => {
    const required = requiredForRow(row, context);
    const evidenceEntries = (dossierEvidence && dossierEvidence[row.type]) || [];
    const status = required ? evidenceStatus({ row, evidenceEntries, context }) : "NOT_REQUIRED";
    const critical = row.criticality === "CRITICAL";
    let blocking = false;
    let reviewRequired = false;
    if (required) {
      if (status === "MISSING" && critical) blocking = true;
      if (status === "CONFLICTING") blocking = true;
      if (status === "STALE" && critical) blocking = true;
      if (status === "PRESENT_UNVERIFIED") reviewRequired = true; // deterministic-verify point; non-blocking on its own
    }
    return {
      type: row.type,
      label: DOSSIER_TYPE_LABELS[row.type],
      required,
      critical,
      status,
      blocking,
      reviewRequired,
      evidenceCount: evidenceEntries.length,
      missingInputsOrGaps: status === "MISSING" ? [`${DOSSIER_TYPE_LABELS[row.type]} carries no verified evidence.`] : [],
      evidence: evidenceEntries.map((entry) => ({
        claim: entry?.claim || entry?.deliverable || null,
        authorityClass: entry?.authorityClass || null,
        evidenceKind: entry?.evidenceKind || "EXPLICIT",
        review: entry?.reviewStatus || entry?.state || "unverified",
        performedAt: entry?.performedAt || null,
        stale: Boolean(entry?.stale),
        // 4D-2 -- forward calculation-derived provenance additively so DERIVED
        // evidence keeps its identity + fingerprint for Stage 4D-3 staleness
        // evaluation. Never present for non-calculation evidence rows.
        ...(entry?.calculationType
          ? {
              calculationType: entry.calculationType,
              calculationState: entry.calculationState ?? null,
              ruleId: entry.ruleId ?? null,
              ruleVersion: entry.ruleVersion ?? null,
              fingerprint: entry.fingerprint ?? null,
              provenance: entry.provenance ?? null,
            }
          : {}),
        // R1 -- forward approved-architecture identity + provenance additively
        // so SYSTEM_ARCHITECTURE evidence stays traceable to the governed
        // architecture version/channel it came from. Never present for rows
        // that are not architecture evidence.
        ...(entry?.architectureEvidence
          ? {
              architectureEvidence: true,
              architectureChannel: entry.architectureChannel ?? null,
              architectureVersion: entry.architectureVersion ?? null,
              fingerprint: entry.fingerprint ?? null,
              provenance: entry.provenance ?? null,
            }
          : {}),
      })),
    };
  });

  // Fail-closed rows for a system pack we do not govern: unknown system =>
  // everything NOT_REQUIRED (a never-blocked-by-nothing contract).
  const leftoverTypes = DOSSIER_REQUIREMENT_TYPES.filter((type) => !items.some((entry) => entry.type === type));
  for (const type of leftoverTypes) {
    items.push({ type, label: DOSSIER_TYPE_LABELS[type], required: false, critical: false, status: "NOT_REQUIRED", blocking: false, reviewRequired: false, evidenceCount: 0, missingInputsOrGaps: [], evidence: [] });
  }

  const blockers = items.filter((entry) => entry.blocking).map((entry) => `${entry.label}: ${entry.status}.`);
  const warnings = items.filter((entry) => entry.status === "PRESENT_UNVERIFIED" || !entry.blocking && entry.status === "STALE");
  const warningsText = warnings.map((entry) => `${entry.label}: ${entry.status}.`);

  const blocked = blockers.length > 0;
  const withWarnings = !blocked && warningsText.length > 0;
  return {
    system,
    scope,
    engineVersion: DOSSIER_ENGINE_VERSION,
    items,
    status: blocked ? "BLOCKED" : withWarnings ? "READY_WITH_WARNINGS" : "READY",
    blockers,
    warnings: warningsText,
    deterministicVerification: !blocked && !items.some((entry) => entry.reviewRequired),
    // 4C-5 -- readiness impact: critical gaps route to technical review.
    technicalReviewRequired: items.filter((entry) => entry.reviewRequired || entry.blocking).map((entry) => entry.label),
  };
};

// ---------------------------------------------------------------------------
// Evidence derivation from Stage 4B calculations (CAPACITY_CALCULATION /
// ENGINEERING_CALCULATION dossier items).
// ---------------------------------------------------------------------------
export const evidenceFromCalculation = (calculation) => {
  if (!calculation) return null;
  const type = calculation.calculationType === "cctv.storage-retention" ? "CAPACITY_CALCULATION" : "ENGINEERING_CALCULATION";
  if (calculation.state === "NOT_REQUIRED" || calculation.state === "REQUIRED") return null; // nothing to certify
  const completedPass = calculation.state === "CALCULATED_PASS";
  const completedFail = calculation.state === "CALCULATED_FAIL";
  const conflict = calculation.state === "CALCULATION_CONFLICT";
  const missing = calculation.state === "REQUIRED_BUT_INPUTS_MISSING";
  // A calculated FAIL or a capacity conflict is a design-basis failure, and a
  // refused calculation (inputs missing) is MISSING evidence -- both must
  // surface as dossier problems, never as a silent pass or a soft unverified.
  const failed = conflict || completedFail;
  // R1 -- evidence contract. The governed calculation rule declares its own
  // `dimension`; that declaration is the single authority for which dossier
  // requirement roles a calculation legitimately serves. A capacity-dimension
  // calculation (SLC/loop sizing, storage retention, battery/NAC/node/runtime
  // sizing) proves BOTH that capacity is adequate AND that an engineering
  // design-basis calculation was performed, so it serves both requirement
  // roles. It remains ONE calculation: identity, provenance and fingerprint
  // are projected unchanged onto each role, never duplicated into a second
  // independent authority. A calculation with any other (or no) declared
  // dimension may serve the engineering role only -- an engineering
  // calculation never becomes capacity evidence merely by being engineering.
  const dimension = calculation.dimension ?? calculation.evidence?.dimension ?? null;
  const satisfiedDossierTypes = dimension === "capacity" ? ["CAPACITY_CALCULATION", "ENGINEERING_CALCULATION"] : ["ENGINEERING_CALCULATION"];
  return {
    dossierType: type,
    satisfiedDossierTypes,
    dimension,
    claim: null,
    deliverable: describeDeliverable(type),
    authorityClass: "ENGINEERING_DESIGN",
    evidenceKind: calculation.evidence ? "DERIVED" : "EXPLICIT",
    state: failed ? "conflict" : missing ? "missing" : "verified",
    reviewStatus: failed ? "Conflict" : missing ? "Missing" : "Verified",
    performedAt: calculation.performedAt || null,
    stale: false,
    calculationSummary: (calculation.trace || []).join(" "),
    // 4D-2 -- forward the calculation identity + staleness fingerprint so a
    // later Stage 4D-3 staleness pass can re-evaluate this DERIVED evidence
    // without re-deriving it. Calculation identity is NOT converted into
    // explicit project evidence; it rides as provenance on DERIVED evidence.
    calculationType: calculation.calculationType || null,
    calculationState: calculation.state || null,
    ruleId: calculation.ruleId || calculation.evidence?.ruleId || null,
    ruleVersion: calculation.ruleVersion || calculation.evidence?.ruleVersion || null,
    fingerprint: calculation.inputFingerprint?.candidateSpecific || calculation.candidateSpecific || null,
    provenance: calculation.inputFingerprint
      ? {
          requirementProfileVersion: calculation.inputFingerprint.requirementProfileVersion ?? null,
          productEvidenceVersion: calculation.inputFingerprint.productEvidenceVersion ?? null,
          itemBasis: calculation.inputFingerprint.itemBasis ?? null,
          stale: calculation.stale ?? null,
        }
      : null,
  };
};

const describeDeliverable = (type) => (type === "CAPACITY_CALCULATION" ? "Capacity calculation" : "Engineering calculation");

// ---------------------------------------------------------------------------
// 4C-6 -- cross-item / project-level engineering checks.
// ---------------------------------------------------------------------------
export const evaluateProjectLevelEngineering = ({ items, projectConstraints = {} } = {}) => {
  const violations = [];
  const list = Array.isArray(items) ? items : [];

  // Manufacturer consistency: when the project mandates a single manufacturer.
  if (projectConstraints.singleManufacturer === true) {
    const recommended = list.filter((entry) => entry?.recommendedProduct?.manufacturer);
    const manufacturers = [...new Set(recommended.map((entry) => entry.recommendedProduct.manufacturer))];
    if (manufacturers.length > 1) violations.push({ scope: "PROJECT", type: "MANUFACTURER_CONSISTENCY", severity: "BLOCKING", itemsAffected: list.filter((entry) => entry?.recommendedProduct?.manufacturer && entry.recommendedProduct.manufacturer !== manufacturers[0]).map((entry) => entry.itemId || entry.boqItemId).filter(Boolean), reason: `The project mandates a single manufacturer but recommendations span: ${manufacturers.join(", ")}.` });
  }

  // Approved manufacturer list.
  const approved = projectConstraints.approvedManufacturers;
  if (Array.isArray(approved) && approved.length) {
    for (const entry of list) {
      const manufacturer = entry?.recommendedProduct?.manufacturer;
      if (manufacturer && !approved.some((name) => String(name).toLowerCase() === String(manufacturer).toLowerCase())) {
        violations.push({ scope: "PROJECT", type: "APPROVED_MANUFACTURER_VIOLATION", severity: "BLOCKING", itemsAffected: [entry.itemId || entry.boqItemId].filter(Boolean), reason: `Recommended manufacturer ${manufacturer} is not on the project's approved vendor list.` });
      }
    }
  }

  // Common protocol / architecture consistency.
  const commonProtocol = projectConstraints.commonProtocol;
  if (commonProtocol) {
    const protocolItems = list.filter((entry) => entry?.recommendedProduct?.protocol || entry?.recommendedProtocol);
    const offProtocol = protocolItems.filter((entry) => {
      const value = entry?.recommendedProduct?.protocol || entry?.recommendedProtocol;
      return String(value).toLowerCase() !== String(commonProtocol).toLowerCase();
    });
    if (offProtocol.length) violations.push({ scope: "SYSTEM", type: "COMMON_PROTOCOL_VIOLATION", severity: "BLOCKING", itemsAffected: offProtocol.map((entry) => entry.itemId || entry.boqItemId).filter(Boolean), reason: `The project requires a common ${commonProtocol} architecture; ${offProtocol.length} recommendation(s) carry a different protocol.` });
  }

  // Total panel capacity at project scope -- reuses the verified SLC
  // calculator, exactly like 4B. NEVER invents capacity figures.
  const capacityGroups = projectConstraints.panelCapacityByPanel;
  if (capacityGroups && typeof capacityGroups === "object") {
    for (const [panelId, group] of Object.entries(capacityGroups)) {
      const calc = calculateSlcExpansion({ demand: group.demand, panelCapacity: group.panelCapacity, expansionOptions: group.expansionOptions || null });
      if (calc.status === "CAPACITY_EXCEEDED") {
        violations.push({ scope: "PROJECT", type: "TOTAL_PANEL_CAPACITY", severity: "BLOCKING", itemsAffected: [panelId], reason: `Total addressable demand on panel ${panelId} exceeds its verified system-wide ceiling. ` + (calc.calculationTrace || []).join(" ") });
      } else if (calc.status === "EXPANSION_REQUIRED") {
        violations.push({ scope: "PROJECT", type: "TOTAL_PANEL_CAPACITY", severity: "WARNING", itemsAffected: [panelId], reason: `Panel ${panelId} requires ${calc.requiredExpansionQuantity} x ${calc.selectedExpansionType} expansion to satisfy demand.` });
      } else if (calc.status === "INSUFFICIENT_EVIDENCE") {
        violations.push({ scope: "PROJECT", type: "PANEL_CAPACITY_EVIDENCE", severity: "WARNING", itemsAffected: [panelId], reason: `Panel ${panelId} capacity cannot be verified: ${(calc.missingInputs || []).join(", ")}.` });
      }
    }
  }

  return { violations };
};

// ---------------------------------------------------------------------------
// 4C-8 -- technical readiness input (workflow-facing, never commercial).
// Merges per-item readiness with the dossier and project-level checks.
// Quotation/commercial behavior is intentionally untouched here.
// ---------------------------------------------------------------------------
export const evaluateTechnicalReadiness = ({ system, itemReadiness = {}, dossier = null, projectViolations = [] } = {}) => {
  const blockers = [];
  const warnings = [];
  const violations = Array.isArray(projectViolations) ? projectViolations : [];

  const blockReasons = itemReadiness.blockingReasons || [];
  if (blockReasons.length) blockers.push(...blockReasons.map((reason) => `Item readiness: ${reason}`));

  if (dossier?.status === "BLOCKED") blockers.push(...(dossier.blockers || []));
  else if (dossier?.status === "READY_WITH_WARNINGS") warnings.push(...(dossier.warnings || []));

  for (const violation of violations) {
    if (violation.severity === "BLOCKING") blockers.push(`Project-level: ${violation.reason}`);
    else warnings.push(`Project-level: ${violation.reason}`);
  }

  const blocked = blockers.length > 0;
  const withWarnings = !blocked && warnings.length > 0;
  return {
    system,
    status: blocked ? "Blocked" : withWarnings ? "Ready with Warnings" : "Technically Ready",
    blockers,
    warnings,
    // Deterministic evidence verification means no manual checkbox approval is
    // needed for a routine complete dossier; exceptions already surfaced.
    deterministicVerification: Boolean(dossier?.deterministicVerification === true && itemReadiness.status === "Ready for Matching"),
    // 4C-5 / 4C-7 -- engineer exceptions only where the dossier is
    // CONFLICTING / STALE / unverified-critical.
    engineerReviewRequired: (dossier?.technicalReviewRequired || []).filter(Boolean),
  };
};

// ---------------------------------------------------------------------------
// 4D-2 -- LIVE DOSSIER WIRING.
// ---------------------------------------------------------------------------
// The ONLY path by which the Stage 4C dossier engine enters the live matching
// pipeline. Everything here is pure domain logic over governed inputs already
// present in the live flow (requirement profile, approved requirement
// standards, live Stage 4D-1 engineeringCalculations, evaluated candidates).
// It never reads prices, never fabricates completeness, never interprets
// absence as verified, and never converts a DERIVED calculation into EXPLICIT
// project evidence. Dossier is SYSTEM/PROJECT scoped, so it is computed once
// per matching run -- never duplicated per candidate.
export const DOSSIER_WIRING_VERSION = "engineering-dossier-live-wiring-4d-2.0.0";

export const DOSSIER_PROJECT_CONSTRAINT_KEYS = Object.freeze([
  "singleManufacturer",
  "approvedManufacturers",
  "commonProtocol",
  "panelCapacityByPanel",
]);

// AUTHORITY_APPROVAL conditioning: the live requirement profile carries no
// jurisdiction fields today, so the item stays NOT_REQUIRED -- but the mapping
// is ready the moment a governed profile carries them.
export const dossierContextFromProfile = (profile) => {
  const context = {};
  if (profile?.jurisdiction && typeof profile.jurisdiction === "object") context.jurisdiction = profile.jurisdiction;
  if (profile?.requiresAuthorityApproval !== undefined) context.requiresAuthorityApproval = profile.requiresAuthorityApproval;
  return context;
};

// Project constraints that ARE available live: approved manufacturers from the
// requirement profile, using the same /approved|required|basis/ predicate the
// matching engine's own buildSearchScope already applies. singleManufacturer,
// commonProtocol and panelCapacityByPanel need cross-item/project-wide context
// that a per-BOQ-item run does not have -- they are intentionally left absent
// and reported as unavailable, never assumed.
export const projectConstraintsFromLiveProfile = (profile) => {
  const constraints = {};
  const approved = (profile?.manufacturers || [])
    .filter((entry) => /approved|required|basis/i.test(String(entry?.status || entry?.type || "")))
    .map((entry) => entry?.manufacturer || entry?.name)
    .filter(Boolean);
  if (approved.length) constraints.approvedManufacturers = approved;
  return constraints;
};

// CODE_STANDARD_BASIS: standards enforced in the approved requirement profile
// are EXPLICIT REGULATORY basis evidence. Absence is simply presence of
// nothing -- the dossier treats the item as MISSING, exactly as the engine's
// status model demands.
const standardBasisEvidence = (profile) =>
  (profile?.standards || []).map((standard) => ({
    claim: [standard?.body, standard?.number, standard?.part].filter(Boolean).join(" ") || "Approved code/standard basis",
    authorityClass: "REGULATORY",
    evidenceKind: "EXPLICIT",
    state: "verified",
    reviewStatus: "Verified",
    performedAt: null,
    stale: false,
  }));

// SYSTEM_ARCHITECTURE: approved, consumable project-architecture evidence. The
// governed standing is decided upstream by the Stage 4 bridge consumer
// (stage4-drawing-architecture-context.mjs): `available === true` already means
// a non-superseded approved architecture version, an integer architecture
// version, and readiness READY_FOR_STAGE4_BRIDGE. This adapter therefore trusts
// `available` and re-checks only the presence of governed (non-inferred) facts;
// an absent/unconsumable context yields NO evidence and the dossier item stays
// MISSING. Architecture is bound to ENGINEERING_DESIGN (the Stage 4A class that
// owns system architecture) and is NEVER flattened into compatibility,
// certification, capacity, product or commercial evidence. The bridge's own
// drawing roles (PRIMARY/SECONDARY) are preserved as provenance only; they are
// not Stage 4A authority classes and are never promoted.
const architectureDossierEvidence = (profile) => {
  const context = profile?.drawingArchitectureContext;
  if (!context || context.available !== true) return [];
  if (!Number.isInteger(context.architectureVersion)) return [];
  const channels = context.channels && typeof context.channels === "object" ? context.channels : {};
  const rows = [];
  for (const [channel, bucket] of Object.entries(channels)) {
    const facts = Array.isArray(bucket?.evidence) ? bucket.evidence : [];
    // Inferred architecture can never verify a dossier item (Stage 4A).
    const governed = facts.filter((fact) => fact?.evidenceKind !== "INFERRED");
    if (!governed.length) continue;
    rows.push({
      claim: `Approved system architecture: ${channel} (${governed.length} governed fact${governed.length === 1 ? "" : "s"})`,
      deliverable: "Approved system architecture",
      dossierType: "SYSTEM_ARCHITECTURE",
      authorityClass: "ENGINEERING_DESIGN",
      evidenceKind: "EXPLICIT",
      state: "verified",
      reviewStatus: "Verified",
      performedAt: null,
      stale: false,
      // R1 -- architecture stays architecture.
      architectureEvidence: true,
      architectureChannel: channel,
      architectureVersion: context.architectureVersion ?? null,
      architectureSourceRole: governed[0]?.authorityClass ?? null,
      productCompatibility: false,
      protocol: false,
      matchingRole: "project-architecture-context",
      fingerprint: context.fingerprint || null,
      subjects: governed.map((fact) => fact?.subject).filter(Boolean),
      provenance: {
        contextVersion: context.version ?? null,
        readFromVersionId: context.provenance?.readFromVersionId ?? null,
        approvedFactCount: context.provenance?.approvedFactCount ?? governed.length,
        evidenceFingerprint: governed[0]?.provenance?.evidenceFingerprint ?? null,
        reviewActorId: governed[0]?.provenance?.reviewActorId ?? null,
        reviewReason: governed[0]?.provenance?.reviewReason ?? null,
        sourceDocumentId: governed[0]?.provenance?.documentId ?? null,
      },
    });
  }
  return rows;
};

// Live input -> dossier evidence map. SYSTEM_ARCHITECTURE comes from the
// approved, consumable Stage 4 drawing-architecture context carried on the
// requirement profile. CAPACITY_CALCULATION / ENGINEERING_CALCULATION come from
// the live Stage 4D-1 calculation results via the 4C bridge
// (evidenceFromCalculation), retaining calculation identity + fingerprints.
// One calculation legitimately serves every requirement role it actually
// proves (see evidenceFromCalculation), so a capacity-dimension calculation
// satisfies both calculation requirements without being counted twice as an
// independent authority.
export const buildLiveDossierEvidence = ({ profile = null, calculationResults = [] } = {}) => {
  const evidence = {};
  const standards = standardBasisEvidence(profile);
  if (standards.length) evidence.CODE_STANDARD_BASIS = standards;
  const architecture = architectureDossierEvidence(profile);
  if (architecture.length) evidence.SYSTEM_ARCHITECTURE = architecture;
  for (const entry of (calculationResults || []).map((result) => evidenceFromCalculation(result)).filter(Boolean)) {
    const roles = Array.isArray(entry.satisfiedDossierTypes) && entry.satisfiedDossierTypes.length ? entry.satisfiedDossierTypes : [entry.dossierType];
    for (const role of roles) {
      // Same calculation identity and provenance on every role it serves.
      (evidence[role] = evidence[role] || []).push({ ...entry, dossierType: role });
    }
  }
  return evidence;
};

// The complete run-level live engineering evaluation: dossier + project-level
// checks + technical readiness, attached additively to the matching run.
// Defensive by contract -- a failure here can never take down matching.
export const evaluateLiveSystemEngineering = ({ profile = null, calculationResults = [], projectItems = [] } = {}) => {
  const system = profile?.boqItem?.system || null;
  const scope = "PROJECT_SYSTEM";
  const context = dossierContextFromProfile(profile);
  const dossierEvidence = buildLiveDossierEvidence({ profile, calculationResults });
  const dossier = evaluateDossier({ system, scope, context, dossierEvidence });

  const projectConstraints = projectConstraintsFromLiveProfile(profile);
  const constraintsUnavailable = DOSSIER_PROJECT_CONSTRAINT_KEYS.filter(
    (key) => projectConstraints[key] === undefined || (Array.isArray(projectConstraints[key]) && projectConstraints[key].length === 0),
  );
  const projectCheck = evaluateProjectLevelEngineering({ items: projectItems, projectConstraints });
  const projectEngineeringChecks = {
    scope: "PROJECT",
    engineVersion: DOSSIER_ENGINE_VERSION,
    constraintsAvailable: Object.keys(projectConstraints),
    constraintsUnavailable,
    contextStatus: constraintsUnavailable.length ? "PROJECT_CONTEXT_INCOMPLETE" : "PROJECT_CONTEXT_AVAILABLE",
    // Cross-item inputs are explicitly NOT assumed for a per-BOQ-item run.
    contextNote: "The live matching execution is per-BOQ-item; cross-item project inputs (single-manufacturer mandate, common protocol, aggregated panel capacity) are not present in this execution context and were NOT assumed.",
    violations: projectCheck.violations,
    violationCount: projectCheck.violations.length,
  };

  const engineeringReadiness = evaluateTechnicalReadiness({
    system,
    itemReadiness: profile?.readiness || { status: null, blockingReasons: [] },
    dossier,
    projectViolations: projectCheck.violations,
  });

  const derivation = {
    engineVersion: DOSSIER_ENGINE_VERSION,
    wiringVersion: DOSSIER_WIRING_VERSION,
    system,
    scope,
    performedAt: null,
    // Stage 4D staleness contract: metadata is attached for Stage 4D-3+
    // evaluation; invalidation is NOT implemented in this stage.
    staleness: {
      stale: null,
      basis: "ITEM/GOVERNING-BASIS",
      invalidationImplemented: false,
      requirementProfileVersion: profile?.versionNumber ?? null,
      itemId: profile?.boqItem?.id ?? null,
    },
    inputSummary: {
      requirementProfileVersion: profile?.versionNumber ?? null,
      standardBasisCount: (profile?.standards || []).length,
      calculationEvidenceCount: (calculationResults || []).length,
    },
  };

  return {
    ...derivation,
    dossier,
    projectEngineeringChecks,
    engineeringReadiness,
  };
};