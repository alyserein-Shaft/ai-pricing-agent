// PERSISTED PROJECT FIRE ALARM ECOSYSTEM DECISION (domain model + policy).
//
// WHY THIS EXISTS. `fire-alarm-ecosystem-policy.mjs` already contains a
// correct, fully specified four-rule ecosystem-selection policy, and
// `technical-requirement-engine` requires a `compatibilityTarget` for every
// Fire Alarm item. But the policy had no production caller, no persisted
// input, and no route: 107 of 108 BOQ items on a real project sat at
// `Missing Critical Information` purely because there was nowhere for an
// approved human ecosystem decision to live.
//
// This module defines the CANONICAL REPRESENTATION of that decision and the
// PURE decisions built on it. It performs NO database access -- every SQL
// query lives in `worker/`. The read side is one resolver
// (`resolveProjectFireAlarmEcosystemDecision` in
// worker/fire-alarm-ecosystem-decision-api.mjs); the write side is one
// planner (`planEcosystemDecisionWrite`) plus one governed writer.
//
// ---------------------------------------------------------------------------
// SIX HARD INVARIANTS
//
// 1. THE ECOSYSTEM IS NOT COMPLIANCE. Deciding NOTIFIER does not and must not
//    establish a UL 864 contract edition, FM, an LPCB regime, EN 54 product
//    listing, or any AHJ substantive basis. Those stay explicitly unresolved.
//
// 2. TECHNICAL ELIGIBILITY IS NOT CONTRACTUAL ACCEPTANCE. NOTIFIER is the
//    resolved TECHNICAL DESIGN BASIS. That is a different state from
//    "the Consultant has approved NOTIFIER as a named manufacturer", which is
//    CONSULTANT_APPROVAL_REQUIRED and is carried as its own field. Honeywell
//    appearing in the project manufacturer list does NOT automatically approve
//    every Honeywell brand, and is never encoded as if it did.
//
// 3. A PROJECT ECOSYSTEM TARGET IS NOT A PRODUCT COMPATIBILITY PROOF.
//    A decision states what the project REQUIRES. It never asserts any product
//    satisfies it, never grants a match, and never selects anything. Product
//    evaluation stays `Evidence Missing` until real product evidence exists.
//
// 4. A HUMAN DECISION IS THE ONLY AUTHORITY. The ecosystem is never inferred
//    from a parent manufacturer, from FlashScan-like descriptive text at
//    runtime, or from current library contents. With no decision, every
//    consumer fails closed exactly as before.
//
// 5. NO SILENT OVERWRITE. A new decision always appends a new governed record
//    and links `reverses_decision_id` to its predecessor. History is never
//    mutated or deleted. "Approved Equivalent" is never granted here: any
//    proposed substitution is PROPOSED_EQUIVALENT and its authority is
//    HUMAN_APPROVAL_REQUIRED.
//
// 6. NO UNSCOPED CAPACITY. This record carries NO capacity numbers at all, and
//    the structures below deliberately keep protocol and scope as first-class
//    dimensions so a future capacity fact can always be scoped. 159 detectors
//    / SLC / FlashScan is not 99 detectors / SLC / CLIP, and neither is 3180
//    /FACP, 200 /network, or 99 project nodes. The current generic-capacity
//    representations that violate this are listed at the end of this file.
// ---------------------------------------------------------------------------

import { FIRE_ALARM_ECOSYSTEM_POLICY_VERSION, resolveFireAlarmEcosystem } from "./fire-alarm-ecosystem-policy.mjs";

export const FIRE_ALARM_ECOSYSTEM_DECISION_VERSION = "fire-alarm-ecosystem-decision-1.0.0";

// The one governed entity this slice persists. It reuses the existing
// engineering_knowledge_decisions table verbatim -- no new table, no column.
export const ECOSYSTEM_DECISION_ENTITY_TYPE = "Project Fire Alarm Ecosystem";

export const ECOSYSTEM_DECISION_ACTIONS = Object.freeze({
  DECIDE: "decide-fire-alarm-ecosystem",
  SUPERSEDE: "supersede-fire-alarm-ecosystem",
});

// ---------------------------------------------------------------------------
// PROTOCOL MODEL
//
// The specification names BOTH FlashScan and CLIP. That is NOT permission to
// design in CLIP, and it is NOT a statement that the two are interchangeable.
// CLIP is a legacy/exception path: usable only where a specific device, an
// installed legacy condition, or a project requirement demands it AND exact
// manufacturer compatibility evidence exists. Protocol mode is therefore part
// of the identity of any capacity fact, never an afterthought.
// ---------------------------------------------------------------------------
export const PROTOCOL_ROLES = Object.freeze({
  PRIMARY_DESIGN: "PRIMARY_DESIGN",
  LEGACY_OR_EXCEPTION: "LEGACY_OR_EXCEPTION_PATH",
});

export const PROTOCOL_STATUS = Object.freeze({
  FLASHSCAN_BASELINE: "RESOLVED_FLASHSCAN_BASELINE",
  LEGACY_OR_EXCEPTION: "LEGACY_OR_EXCEPTION_PATH",
});

// Only protocols that actually exist in a governed ecosystem may be named.
export const ECOSYSTEM_PROTOCOLS = Object.freeze({
  FLASHSCAN: "FlashScan",
  CLIP: "CLIP",
  IDP_SK: "IDP/SK",
  VELOCITI: "VELOCITI",
  IDP: "IDP",
});

// ---------------------------------------------------------------------------
// ECOSYSTEM VOCABULARY
//
// Narrow on purpose: ecosystems with a defined protocol basis and a real
// manufacturer-ecosystem identity. NOT generalized into a universal MEP
// framework. NOTIFIER carries a protocol basis the others do not, which is
// exactly why the project required it.
// ---------------------------------------------------------------------------
export const PROJECT_ECOSYSTEM_VOCABULARY = Object.freeze({
  NOTIFIER: {
    ecosystem: "NOTIFIER",
    compatibilityTarget: "Notifier Fire Alarm ecosystem (FlashScan / CLIP)",
    protocols: [ECOSYSTEM_PROTOCOLS.FLASHSCAN, ECOSYSTEM_PROTOCOLS.CLIP],
  },
  FARENHYT: {
    ecosystem: "FARENHYT",
    compatibilityTarget: "Honeywell Farenhyt Fire Alarm ecosystem",
    protocols: [ECOSYSTEM_PROTOCOLS.IDP_SK],
  },
  GENT: {
    ecosystem: "GENT",
    compatibilityTarget: "Gent by Honeywell Fire Alarm ecosystem",
    protocols: [ECOSYSTEM_PROTOCOLS.IDP_SK],
  },
  GAMEWELL_FCI: {
    ecosystem: "GAMEWELL_FCI",
    compatibilityTarget: "Honeywell Gamewell-FCI Fire Alarm ecosystem",
    protocols: [ECOSYSTEM_PROTOCOLS.VELOCITI, ECOSYSTEM_PROTOCOLS.CLIP],
  },
  SIMPLEX: {
    ecosystem: "SIMPLEX",
    compatibilityTarget: "Simplex Fire Alarm ecosystem",
    protocols: [ECOSYSTEM_PROTOCOLS.IDP],
  },
});

export const PROJECT_ECOSYSTEM_KEYS = Object.freeze(Object.keys(PROJECT_ECOSYSTEM_VOCABULARY));

// ---------------------------------------------------------------------------
// PRELIMINARY PANEL FAMILY
//
// TECHNICALLY_ACCEPTABLE_CANDIDATE is a technical-eligibility state only. It
// is explicitly NOT "Consultant Approved", NOT "Contractually Approved
// Manufacturer", and NOT "Final Selected Panel". The candidate list is a
// research and preliminary-engineering basis, never a selection.
// ---------------------------------------------------------------------------
export const PANEL_FAMILY_ELIGIBILITY = Object.freeze({
  TECHNICALLY_ACCEPTABLE_CANDIDATE: "TECHNICALLY_ACCEPTABLE_CANDIDATE",
});

export const PRELIMINARY_PANEL_FAMILIES = Object.freeze({
  INSPIRE_N16: {
    family: "NOTIFIER INSPIRE N16 Series",
    manufacturer: "NOTIFIER",
    candidates: ["N16e", "N16x"],
    // RESEARCH CORRECTION (Phase D, Honeywell DN-62112 Rev M): N16X is not a
    // purchasable model. It is a licensed PERSONA on N16E hardware (3 SLC
    // loops) upgraded to 10 loops by a one-time N16-XUPG licence. The
    // selectable identity is the CPU part number plus a persona state, so a
    // consumer must never attempt to order an "N16x". Both names are retained
    // because the approved human decision names them; the distinction is
    // recorded rather than silently corrected.
    candidateKinds: {
      N16e: "MODEL",
      N16x: "LICENSED_PERSONA_ON_N16E",
    },
    personaUpgrade: { from: "N16e", to: "N16x", licence: "N16-XUPG", loops: { N16e: 3, N16x: 10 } },
    eligibility: PANEL_FAMILY_ELIGIBILITY.TECHNICALLY_ACCEPTABLE_CANDIDATE,
    // The qualification is a downstream, separate fact, not a selection.
    finalModelSelection: "PENDING_LATER_ENGINEERING_DECISION",
    isSelected: false,
    isConsultantApproved: false,
  },
});

export const PRELIMINARY_PANEL_FAMILY_KEYS = Object.freeze(Object.keys(PRELIMINARY_PANEL_FAMILIES));

// ---------------------------------------------------------------------------
// SEPARATE DOWNSTREAM STATES -- these are deliberately distinct fields, never
// collapsed into the ecosystem, and never inferred by it.
// ---------------------------------------------------------------------------
export const CONTRACTUAL_MANUFACTURER_ACCEPTANCE = Object.freeze({
  CONSULTANT_APPROVAL_REQUIRED: "CONSULTANT_APPROVAL_REQUIRED",
  APPROVED: "APPROVED",
});

export const SUBSTITUTION_AUTHORITY = Object.freeze({
  HUMAN_APPROVAL_REQUIRED: "HUMAN_APPROVAL_REQUIRED",
  APPROVED_EQUIVALENT: "APPROVED_EQUIVALENT",
});

// The only substitution state the system may ever PROPOSE. It may never
// record APPROVED_EQUIVALENT without a human decision recorded elsewhere.
export const PROPOSED_SUBSTITUTION_STATE = "PROPOSED_EQUIVALENT";

// Equivalence dimensions a future dossier must compare. Recorded so the
// required comparison is explicit, and so no future code can quietly reduce
// equivalence to a protocol string or a manufacturer name.
export const EQUIVALENCE_COMPARISON_DIMENSIONS = Object.freeze([
  "protocol",
  "exactDevicePanelCompatibility",
  "listings",
  "capacity",
  "networkArchitecture",
  "interfaces",
  "causeAndEffectFunctionality",
  "power",
  "batteries",
  "environmentalRatings",
  "softwareLicensing",
  "bases",
  "cards",
  "accessories",
  "projectSpecificAuthorityRequirements",
]);

export const COMPLIANCE_BASIS_STATES = Object.freeze(["UNRESOLVED", "PARTIALLY_RESOLVED"]);

// Compliance findings established by PROJECT EVIDENCE (Slice 2A). The only
// ones a decision may acknowledge.
export const ESTABLISHED_COMPLIANCE_EVIDENCE = Object.freeze({
  saudiCivilDefenseEquipmentAcceptance: "ESTABLISHED",
  ul217EighthEditionSmokeDetectors: "ESTABLISHED",
  ul268SeventhEditionSmokeDetectors: "ESTABLISHED",
  nfpaInstallationObligations: "ESTABLISHED",
  en54InstallationObligations: "ESTABLISHED",
  bsInstallationObligations: "ESTABLISHED",
});

// Per-field states for items that are NOT established. Each carries its own
// state so progress can be recorded without ever being asserted by a decision.
export const UNRESOLVED_COMPLIANCE_FIELDS = Object.freeze({
  ul864GoverningEdition: "CONTRACT_REQUIREMENT_NEEDS_SOURCE_REVIEW",
  fmApprovalRequirement: "UNRESOLVED",
  lpcbRegime: "UNRESOLVED",
  en54ProductListing: "UNRESOLVED",
  ahjSubstantiveBasis: "UNRESOLVED",
});

export const MUST_REMAIN_UNRESOLVED = Object.freeze(Object.keys(UNRESOLVED_COMPLIANCE_FIELDS));

// ---------------------------------------------------------------------------
// NETWORK / CAPACITY FACTS
//
// Three separate facts that must never be reconciled automatically:
//   3180   -> per-FACP addressable device capacity (N16x), NOT a node count
//   200    -> N16 Series product capability, nodes per network (manufacturer)
//   99     -> an unresolved PROJECT requirement clause, original scope and
//             intended topology not yet established
// They are carried as descriptors with explicit scope and NO numeric value, so
// nothing here can be compared or substituted downstream. The numeric value is
// deliberately absent from this record entirely.
// ---------------------------------------------------------------------------
export const NETWORK_CAPACITY_FACT_STATES = Object.freeze({
  PARTIALLY_RESOLVED: "PARTIALLY_RESOLVED",
  UNRESOLVED_PROJECT_CLAUSE: "UNRESOLVED_PROJECT_CLAUSE",
});

export const NETWORK_CAPACITY_FACTS = Object.freeze([
  {
    key: "addressableDevicesPerFacp",
    scopeType: "FACP",
    scopeEntity: "NOTIFIER INSPIRE N16x (preliminary panel family)",
    resourceClass: "addressableDevices",
    protocolMode: "FlashScan",
    state: NETWORK_CAPACITY_FACT_STATES.PARTIALLY_RESOLVED,
    authority: "MANUFACTURER_DOCUMENT",
    valueCarried: false,
    note: "A per-FACP addressable-device capacity. Not a network-node count. Value intentionally not carried in the ecosystem decision.",
  },
  {
    key: "networkNodesPerNetwork",
    scopeType: "NETWORK",
    scopeEntity: "NOTIFIER INSPIRE N16 Series",
    resourceClass: "networkNodes",
    protocolMode: "FlashScan",
    state: NETWORK_CAPACITY_FACT_STATES.PARTIALLY_RESOLVED,
    authority: "MANUFACTURER_DOCUMENT",
    valueCarried: false,
    note: "Manufacturer product capability for nodes per network. Not a project requirement and not to be reconciled with the 99-node clause.",
  },
  {
    key: "additionalNodesProjectClause",
    scopeType: "PROJECT_CLAUSE",
    scopeEntity: "28 46 00 Fire Detection and Alarm System, network capacity clause",
    resourceClass: "networkNodes",
    protocolMode: "UNSPECIFIED_BY_CLAUSE",
    state: NETWORK_CAPACITY_FACT_STATES.UNRESOLVED_PROJECT_CLAUSE,
    authority: "PROJECT_REQUIREMENT",
    valueCarried: false,
    note: "The project clause referencing a distinct additional-node figure. Its original scope and intended topology are not yet established. Retained as an open project requirement, never auto-reconciled.",
  },
]);

// ---------------------------------------------------------------------------
// CONTRACT AUTHORITY ITEMS -- open questions that this record PRESERVES.
// They do not block the technical design basis. They DO block declaring any
// final contractual product match fully approved.
// ---------------------------------------------------------------------------
export const CONTRACT_AUTHORITY_ITEMS = Object.freeze([
  {
    key: "manufacturerListIncludesNotifier",
    question: "Does the manufacturer list's use of \"Honeywell\" contractually include the NOTIFIER brand?",
    state: "OPEN",
  },
  {
    key: "approvedEquivalentAuthority",
    question: "What is the governing approval mechanism and authority for an \"Approved Equivalent\"?",
    state: "OPEN",
  },
  {
    key: "ul864EditionObligationalStructure",
    question: "Does the original specification make UL 864 10th Edition mandatory through a parent-clause / list structure, or is it a reference-standards list?",
    state: "OPEN",
  },
  {
    key: "additionalNodesClauseScope",
    question: "What is the original scope and intended topology behind the project's additional-node requirement?",
    state: "OPEN",
  },
]);

export class EcosystemDecisionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EcosystemDecisionError";
    this.code = code;
  }
}

const required = (value, code, message) => {
  if (value === null || value === undefined || String(value).trim() === "") {
    throw new EcosystemDecisionError(code, message);
  }
  return String(value).trim();
};

// ---------------------------------------------------------------------------
// VALIDATION -- deterministic, narrow, fail-closed.
// ---------------------------------------------------------------------------
export const validateProjectFireAlarmEcosystemDecision = (input = {}) => {
  const ecosystem = required(input.ecosystem, "ECOSYSTEM_REQUIRED", "A Fire Alarm ecosystem decision requires an ecosystem.");
  if (!PROJECT_ECOSYSTEM_KEYS.includes(ecosystem)) {
    throw new EcosystemDecisionError(
      "ECOSYSTEM_NOT_SUPPORTED",
      `Ecosystem "${ecosystem}" is not in the governed Fire Alarm ecosystem vocabulary: ${PROJECT_ECOSYSTEM_KEYS.join(", ")}.`,
    );
  }
  const known = PROJECT_ECOSYSTEM_VOCABULARY[ecosystem];

  // ---- PROTOCOL MODEL -------------------------------------------------
  // The primary design protocol and the legacy/exception protocols are
  // distinct. A record that names a legacy protocol as the design basis is
  // refused outright.
  const primaryProtocol = required(
    input.primaryProtocol,
    "ECOSYSTEM_PRIMARY_PROTOCOL_REQUIRED",
    "A Fire Alarm ecosystem decision requires an explicit primary design protocol.",
  );
  if (!known.protocols.includes(primaryProtocol)) {
    throw new EcosystemDecisionError(
      "ECOSYSTEM_PROTOCOL_NOT_SUPPORTED",
      `Primary protocol "${primaryProtocol}" is not part of the ${ecosystem} ecosystem. Governed protocols: ${known.protocols.join(", ")}.`,
    );
  }
  const allowedLegacyProtocols = (Array.isArray(input.allowedLegacyProtocols) ? input.allowedLegacyProtocols : [])
    .map((p) => String(p).trim())
    .filter(Boolean);
  const unknownLegacy = allowedLegacyProtocols.filter((p) => !known.protocols.includes(p));
  if (unknownLegacy.length) {
    throw new EcosystemDecisionError(
      "ECOSYSTEM_PROTOCOL_NOT_SUPPORTED",
      `Legacy/exception protocol(s) ${unknownLegacy.join(", ")} are not part of the ${ecosystem} ecosystem.`,
    );
  }
  if (allowedLegacyProtocols.includes(primaryProtocol)) {
    throw new EcosystemDecisionError(
      "ECOSYSTEM_PROTOCOL_CONTRADICTION",
      `A protocol may not be both the primary design basis and a legacy/exception path: ${primaryProtocol}.`,
    );
  }

  // ---- PRELIMINARY PANEL FAMILY --------------------------------------
  // Eligibility is technical only. The validator can never accept a record
  // that claims the family is selected or Consultant-approved.
  const familyInput = input.preliminaryPanelFamily || {};
  const familyKey = required(
    familyInput.key,
    "ECOSYSTEM_PANEL_FAMILY_REQUIRED",
    "A Fire Alarm ecosystem decision must record the preliminary panel family used as the technical design basis.",
  );
  if (!PRELIMINARY_PANEL_FAMILY_KEYS.includes(familyKey)) {
    throw new EcosystemDecisionError(
      "ECOSYSTEM_PANEL_FAMILY_NOT_SUPPORTED",
      `Preliminary panel family "${familyKey}" is not in the governed vocabulary: ${PRELIMINARY_PANEL_FAMILY_KEYS.join(", ")}.`,
    );
  }
  const family = PRELIMINARY_PANEL_FAMILIES[familyKey];
  if (family.manufacturer !== ecosystem) {
    throw new EcosystemDecisionError(
      "ECOSYSTEM_PANEL_FAMILY_MANUFACTURER_MISMATCH",
      `Preliminary panel family ${family.family} is a ${family.manufacturer} platform and cannot be the technical design basis for the ${ecosystem} ecosystem.`,
    );
  }
  if (familyInput.isSelected === true || familyInput.isConsultantApproved === true) {
    throw new EcosystemDecisionError(
      "ECOSYSTEM_PANEL_SELECTION_NOT_PERMITTED",
      "A technical design basis may not record a final selected panel or Consultant approval. Final model selection is a later, separate engineering decision.",
    );
  }
  if (familyInput.eligibility && familyInput.eligibility !== PANEL_FAMILY_ELIGIBILITY.TECHNICALLY_ACCEPTABLE_CANDIDATE) {
    throw new EcosystemDecisionError(
      "ECOSYSTEM_PANEL_ELIGIBILITY_NOT_PERMITTED",
      `Panel family eligibility may only be ${PANEL_FAMILY_ELIGIBILITY.TECHNICALLY_ACCEPTABLE_CANDIDATE} at the technical-design-basis stage.`,
    );
  }

  // ---- COMPLIANCE (invariant 1) --------------------------------------
  const complianceBasisState = required(
    input.complianceBasisState,
    "ECOSYSTEM_COMPLIANCE_STATE_REQUIRED",
    "A Fire Alarm ecosystem decision must state its compliance basis state.",
  );
  if (!COMPLIANCE_BASIS_STATES.includes(complianceBasisState)) {
    throw new EcosystemDecisionError(
      "ECOSYSTEM_COMPLIANCE_STATE_NOT_SUPPORTED",
      `Compliance basis state "${complianceBasisState}" is not admissible. Admissible states: ${COMPLIANCE_BASIS_STATES.join(", ")}.`,
    );
  }
  const established = input.establishedComplianceEvidence || {};
  for (const [field, expected] of Object.entries(ESTABLISHED_COMPLIANCE_EVIDENCE)) {
    if (established[field] !== undefined && established[field] !== expected) {
      throw new EcosystemDecisionError(
        "ECOSYSTEM_COMPLIANCE_EVIDENCE_CONFLICT",
        `${field} is already ${expected} by project evidence and may not be re-stated as "${established[field]}".`,
      );
    }
  }
  for (const [field, expectedState] of Object.entries(UNRESOLVED_COMPLIANCE_FIELDS)) {
    const claimed = established[field];
    if (claimed !== undefined && claimed !== expectedState) {
      throw new EcosystemDecisionError(
        "ECOSYSTEM_COMPLIANCE_NOT_ESTABLISHED",
        `${field} is ${expectedState} and may not be asserted by an ecosystem decision. It remains ${expectedState}.`,
      );
    }
  }

  // ---- CONTRACTUAL ACCEPTANCE (invariant 2) --------------------------
  const contractualManufacturerAcceptance = required(
    input.contractualManufacturerAcceptance,
    "ECOSYSTEM_CONTRACTUAL_ACCEPTANCE_REQUIRED",
    "A Fire Alarm ecosystem decision must state its contractual manufacturer acceptance state.",
  );
  if (!Object.values(CONTRACTUAL_MANUFACTURER_ACCEPTANCE).includes(contractualManufacturerAcceptance)) {
    throw new EcosystemDecisionError(
      "ECOSYSTEM_CONTRACTUAL_ACCEPTANCE_NOT_SUPPORTED",
      `Contractual manufacturer acceptance "${contractualManufacturerAcceptance}" is not in the governed vocabulary.`,
    );
  }

  // ---- SUBSTITUTION AUTHORITY (invariant 5) --------------------------
  const substitutionAuthority = required(
    input.substitutionAuthority,
    "ECOSYSTEM_SUBSTITUTION_AUTHORITY_REQUIRED",
    "A Fire Alarm ecosystem decision must state who holds substitution authority.",
  );
  if (!Object.values(SUBSTITUTION_AUTHORITY).includes(substitutionAuthority)) {
    throw new EcosystemDecisionError(
      "ECOSYSTEM_SUBSTITUTION_AUTHORITY_NOT_SUPPORTED",
      `Substitution authority "${substitutionAuthority}" is not in the governed vocabulary.`,
    );
  }
  const directMatchPolicy = required(
    input.directMatchPolicy,
    "ECOSYSTEM_DIRECT_MATCH_POLICY_REQUIRED",
    "A Fire Alarm ecosystem decision requires a direct-match policy.",
  );
  const nonDirect = (Array.isArray(input.notDirectMatchEcosystems) ? input.notDirectMatchEcosystems : [])
    .map((e) => String(e).trim())
    .filter(Boolean);
  const unknownNonDirect = nonDirect.filter((e) => !PROJECT_ECOSYSTEM_KEYS.includes(e));
  if (unknownNonDirect.length) {
    throw new EcosystemDecisionError(
      "ECOSYSTEM_NON_DIRECT_NOT_SUPPORTED",
      `Non-direct-match ecosystem(s) ${unknownNonDirect.join(", ")} are outside the governed vocabulary.`,
    );
  }
  if (nonDirect.includes(ecosystem)) {
    throw new EcosystemDecisionError(
      "ECOSYSTEM_SELF_CONTRADICTION",
      "The decided ecosystem may not also be listed as not approved as a direct match.",
    );
  }

  // ---- EVIDENCE / AUTHORITY ------------------------------------------
  const appliesWhile = required(
    input.appliesWhile,
    "ECOSYSTEM_APPLIES_WHILE_REQUIRED",
    "A Fire Alarm ecosystem decision must state the conditions under which it applies.",
  );
  const evidence = (Array.isArray(input.evidence) ? input.evidence : []).filter((e) => e !== null && e !== undefined && e !== "");
  if (!evidence.length) {
    throw new EcosystemDecisionError(
      "ECOSYSTEM_EVIDENCE_REQUIRED",
      "A Fire Alarm ecosystem decision requires at least one project clause, specification version, or human decision reference.",
    );
  }
  const reason = required(input.reason, "ECOSYSTEM_REASON_REQUIRED", "A Fire Alarm ecosystem decision requires a substantive engineering reason.");
  if (reason.length < 20) {
    throw new EcosystemDecisionError("ECOSYSTEM_REASON_TOO_SHORT", "The ecosystem decision reason must state the engineering basis in substance (at least 20 characters).");
  }
  const decidedBy = required(input.decidedBy, "ECOSYSTEM_DECIDED_BY_REQUIRED", "A Fire Alarm ecosystem decision requires an identified human actor.");
  const decidedRole = required(input.decidedRole, "ECOSYSTEM_DECIDED_ROLE_REQUIRED", "A Fire Alarm ecosystem decision requires the deciding role.");
  const specificationVersion = required(
    input.specificationVersion,
    "ECOSYSTEM_SPECIFICATION_VERSION_REQUIRED",
    "A Fire Alarm ecosystem decision must reference the exact current specification version it was made against.",
  );

  return {
    // ---- WHAT THE SYSTEM MAY TRUTHFULLY SAY -------------------------
    ecosystem,
    ecosystemState: "RESOLVED_TECHNICAL_DESIGN_BASIS",
    compatibilityTarget: known.compatibilityTarget,
    primaryProtocol,
    primaryProtocolState: primaryProtocol === ECOSYSTEM_PROTOCOLS.FLASHSCAN ? PROTOCOL_STATUS.FLASHSCAN_BASELINE : PROTOCOL_STATUS.LEGACY_OR_EXCEPTION,
    selectedProtocolMode: primaryProtocol,
    allowedLegacyProtocols: allowedLegacyProtocols.map((protocol) => ({ protocol, role: PROTOCOL_ROLES.LEGACY_OR_EXCEPTION, state: PROTOCOL_STATUS.LEGACY_OR_EXCEPTION })),
    protocolExceptions: (Array.isArray(input.protocolExceptions) ? input.protocolExceptions : []).filter(Boolean),
    preliminaryPanelFamily: { key: familyKey, ...family, candidates: [...family.candidates] },
    directMatchPolicy,
    notDirectMatchEcosystems: nonDirect,
    complianceBasisState,
    complianceBasis: {
      state: complianceBasisState,
      established: { ...ESTABLISHED_COMPLIANCE_EVIDENCE },
      unresolved: Object.entries(UNRESOLVED_COMPLIANCE_FIELDS).map(([field, state]) => ({ field, state })),
    },
    contractualManufacturerAcceptance,
    substitutionAuthority,
    proposedSubstitutionState: PROPOSED_SUBSTITUTION_STATE,
    equivalenceComparisonDimensions: [...EQUIVALENCE_COMPARISON_DIMENSIONS],
    networkCapacityFacts: NETWORK_CAPACITY_FACTS.map((fact) => ({ ...fact })),
    appliesWhile,
    evidence,
    reason,
    decidedBy,
    decidedRole,
    specificationVersion,
    policyVersion: FIRE_ALARM_ECOSYSTEM_POLICY_VERSION,
    decisionModelVersion: FIRE_ALARM_ECOSYSTEM_DECISION_VERSION,
    // Contract questions are PRESERVED, never resolved, and never used to
    // block recording the technical design basis.
    contractAuthorityItems: CONTRACT_AUTHORITY_ITEMS.map((item) => ({ ...item })),
  };
};

// ---------------------------------------------------------------------------
// WRITE PLANNING -- pure.
// ---------------------------------------------------------------------------
const decisionDigest = (decision) =>
  JSON.stringify({
    ecosystem: decision.ecosystem,
    primaryProtocol: decision.primaryProtocol,
    allowedLegacyProtocols: decision.allowedLegacyProtocols.map((entry) => entry.protocol).sort(),
    complianceBasisState: decision.complianceBasisState,
    contractualManufacturerAcceptance: decision.contractualManufacturerAcceptance,
    substitutionAuthority: decision.substitutionAuthority,
    directMatchPolicy: decision.directMatchPolicy,
    notDirectMatchEcosystems: [...decision.notDirectMatchEcosystems].sort(),
    appliesWhile: decision.appliesWhile,
    specificationVersion: decision.specificationVersion,
    preliminaryPanelFamily: decision.preliminaryPanelFamily?.key,
  });

export const planEcosystemDecisionWrite = ({ current, candidate }) => {
  if (current && decisionDigest(current.decision) === decisionDigest(candidate)) {
    return { mode: "idempotent", decisionId: current.id, reason: "An identical current decision already governs this project; no new record was written." };
  }
  if (!current) {
    return { mode: "create", action: ECOSYSTEM_DECISION_ACTIONS.DECIDE, reversesDecisionId: null, previousValue: null };
  }
  return {
    mode: "supersede",
    action: ECOSYSTEM_DECISION_ACTIONS.SUPERSEDE,
    reversesDecisionId: current.id,
    previousValue: { decisionId: current.id, ecosystem: current.decision.ecosystem, decidedAt: current.decidedAt, decidedBy: current.decision.decidedBy },
  };
};

// ---------------------------------------------------------------------------
// READ SIDE.
// ---------------------------------------------------------------------------
export const normalizePersistedEcosystemDecision = (row) => {
  if (!row) return null;
  let payload;
  try {
    payload = typeof row.new_value === "string" ? JSON.parse(row.new_value) : row.new_value;
  } catch {
    throw new EcosystemDecisionError("ECOSYSTEM_DECISION_MALFORMED", "The current project Fire Alarm ecosystem decision could not be read and is treated as absent.");
  }
  if (!payload || typeof payload !== "object" || !payload.ecosystem) {
    throw new EcosystemDecisionError("ECOSYSTEM_DECISION_MALFORMED", "The current project Fire Alarm ecosystem decision is incomplete and is treated as absent.");
  }
  if (!PROJECT_ECOSYSTEM_KEYS.includes(payload.ecosystem)) {
    throw new EcosystemDecisionError(
      "ECOSYSTEM_DECISION_UNSUPPORTED",
      `The current project Fire Alarm ecosystem decision names "${payload.ecosystem}", which is outside the governed vocabulary. It is treated as absent rather than honoured.`,
    );
  }
  let evidence = [];
  try {
    evidence = typeof row.evidence === "string" ? JSON.parse(row.evidence) : row.evidence || [];
  } catch {
    evidence = [];
  }
  return {
    id: row.id,
    action: row.action,
    projectId: row.project_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    reversesDecisionId: row.reverses_decision_id || null,
    reversible: row.reversible !== 0,
    decidedAt: row.decided_at,
    evidence,
    decision: payload,
  };
};

export const selectCurrentEcosystemDecision = (rows = []) => {
  if (!rows.length) return null;
  if (rows.length > 1) {
    throw new EcosystemDecisionError(
      "ECOSYSTEM_DECISION_AMBIGUOUS",
      `The project has ${rows.length} simultaneous current Fire Alarm ecosystem decisions (${rows.map((r) => r.id).join(", ")}). The governed state is ambiguous and is treated as absent; supersede all but one.`,
    );
  }
  return normalizePersistedEcosystemDecision(rows[0]);
};

// ---------------------------------------------------------------------------
// CONSUMPTION -- project-level requirement basis. NEVER a product claim.
// ---------------------------------------------------------------------------
export const projectEcosystemCompatibilityEntry = (current) => {
  if (!current) return null;
  const decision = current.decision;
  return {
    id: `project-ecosystem:${current.id}`,
    requirement_id: null,
    source_item: `Project Fire Alarm technical design basis ${current.id} (${decision.specificationVersion})`,
    target_item: decision.compatibilityTarget,
    targetItem: decision.compatibilityTarget,
    relationship_type: "Compatible With",
    relationshipType: "Compatible With",
    conditions: decision.appliesWhile,
    exceptions: null,
    mandatory: 1,
    confidence: 100,
    review_status: "Approved",
    reviewStatus: "Approved",
    // PROVENANCE. Any downstream reader can see this came from a governed
    // project decision, decided by whom, and that it states a REQUIREMENT
    // BASIS rather than a verified product capability.
    ecosystem: decision.ecosystem,
    ecosystemState: decision.ecosystemState,
    primaryProtocol: decision.primaryProtocol || null,
    selectedProtocolMode: decision.selectedProtocolMode || null,
    allowedLegacyProtocols: (decision.allowedLegacyProtocols || []).map((entry) => entry.protocol || entry),
    directMatchPolicy: decision.directMatchPolicy,
    notDirectMatchEcosystems: decision.notDirectMatchEcosystems || [],
    complianceBasisState: decision.complianceBasisState,
    contractualManufacturerAcceptance: decision.contractualManufacturerAcceptance,
    basis: "HUMAN_ENGINEERING_DECISION",
    authority: "PROJECT_ECO_SYSTEM_DECISION",
    scope: "PROJECT_REQUIREMENT",
    decisionId: current.id,
    decidedBy: decision.decidedBy,
    decidedRole: decision.decidedRole,
    decidedAt: current.decidedAt,
    // The single most important pair of flags in this record.
    productCompatibilityClaimed: false,
    productCompatibilityState: "NOT_EVALUATED_NO_PRODUCT_EVIDENCE",
  };
};

// Feed the persisted decision into the EXISTING pure policy. This is what
// makes resolveFireAlarmEcosystem reachable. No policy rule is modified,
// added, or bypassed.
export const evaluateProjectEcosystemPolicy = (current, { protocolReferences = [] } = {}) => {
  if (!current) return resolveFireAlarmEcosystem({ protocolReferences });
  return resolveFireAlarmEcosystem({ explicitProjectEcosystem: current.decision.compatibilityTarget, protocolReferences });
};

// ---------------------------------------------------------------------------
// CAPACITY-SCOPE INVARIANT -- current violations, recorded for the sizing
// slice. Nothing is changed here; the point is that the decisions above keep
// protocol and scope as first-class dimensions so this can be fixed without
// another representational break.
//
// VIOLATIONS FOUND (generic capacity already in the repository):
//
//  1. app/domain/fire-alarm-ecosystem-policy.mjs
//     FARENHYT_PRELIMINARY_POINT_THRESHOLD = 2000 and the Rule C text
//     "within the internal 2,000-point selection threshold" carry a bare
//     number with NO scope, NO resource class, NO protocol mode, NO panel
//     model, and authority "internal engineering/business selection
//     threshold" that is explicitly NOT a manufacturer maximum. It is compared
//     against preliminary point counts. UNSCOPED.
//
//  2. app/domain/fire-alarm-slc-resource-classifier.mjs
//     `quantity` carries a single flat `unitsPerDevice` and `total` with no
//     resource class (detector vs module vs loop) and no protocol mode. 159
//     detectors/SLC, 159 modules/SLC and 318 devices/SLC are three different
//     facts that this shape cannot distinguish. UNSCOPED.
//
//  3. app/domain/fire-alarm-panel-capability-normalization.mjs
//     `max_system_points` -> SYSTEM_NAMEDPLATE_POINTS is correctly NOT treated
//     as a governed ceiling, but the record still carries a bare `value` with
//     no protocol mode and no panel model binding. PARTIALLY SCOPED.
//
//  4. The project's own clause 3,180 is extracted as
//     requirement_category = Capacity, requirement_type = Informational, with
//     no scope field: it is per-FACP addressable devices under a 10-SLC
//     FlashScan configuration, and the extraction does not say so. UNSCOPED at
//     the evidence layer.
//
// NONE of these are repaired in this slice. They are recorded so the sizing
// slice starts from a known list rather than rediscovering it.
export const KNOWN_UNSCOPED_CAPACITY_REPRESENTATIONS = Object.freeze([
  { id: "ecosystem-policy-farenhyt-threshold", layer: "domain", value: 2000, missing: ["scopeType", "scopeEntity", "resourceClass", "protocolMode", "exactModel", "authority"] },
  { id: "slc-classifier-units-per-device", layer: "domain", missing: ["resourceClass", "protocolMode", "scopeEntity"] },
  { id: "panel-capability-max-system-points", layer: "domain", missing: ["protocolMode", "exactModel"] },
  { id: "spec-clause-3180-points", layer: "evidence", missing: ["scopeType", "scopeEntity", "resourceClass", "protocolMode"] },
  { id: "spec-clause-99-additional-nodes", layer: "evidence", missing: ["scopeType", "scopeEntity", "protocolMode", "intendedTopology"] },
]);
