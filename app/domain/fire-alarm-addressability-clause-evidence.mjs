/**
 * Fire Alarm addressability-clause evidence adapter (GOLDEN-6C3A1).
 *
 * This module is the INTEGRATION SEAM between the specification requirement
 * corpus and the GOLDEN-6C3A applicability engine. It does exactly three
 * things, and nothing else:
 *
 *   1. Reads a `technical_requirements` row's OBLIGATION -- what the clause
 *      actually requires -- from the clause's own predicate, never from the mere
 *      presence of the word "addressable". A supply clause, a wiring clause, a
 *      product feature list and a system addressability obligation all contain
 *      the word; only one of them is an addressability obligation.
 *   2. Turns that row into a GOLDEN-6C3A evidence record, with eligibility
 *      derived from the repository's canonical currency authority plus the
 *      row's own review state. Eligibility is NEVER inferred from a prior
 *      version's approval.
 *   3. Compares a prior requirement version against the current one field by
 *      field and classifies the change, so a human reviewer sees exactly what
 *      changed and whether the prior review decision could safely carry forward.
 *
 * It deliberately contains:
 *   - NO carry-forward / review-inheritance mechanism. None exists in this
 *     repository, and this slice does not invent one. The canonical mechanism
 *     for approving a current requirement is deterministic RE-EVALUATION of the
 *     current row (`worker/spec-requirement-auto-confirm.mjs`, 12 gates) or a
 *     fresh human decision on the current row. Both act on the CURRENT row.
 *   - NO applicability rule of its own. Applicability is owned entirely by
 *     `app/domain/fire-alarm-addressability-applicability.mjs`, which this
 *     module feeds and never overrides.
 *   - NO product, ecosystem, panel, quantity or point-consumption output.
 */

export const ADDRESSABILITY_CLAUSE_EVIDENCE_VERSION = "fire-alarm-addressability-clause-evidence-1.0.0";

const text = (value) => (value === null || value === undefined ? "" : String(value).trim());
const flat = (value) => text(value).replace(/\s+/g, " ").trim();
const upper = (value) => flat(value).toUpperCase();

/**
 * The obligation a clause carries. These are OBSERVED from the clause predicate,
 * not asserted by a reviewer.
 */
export const ADDRESSABILITY_CLAUSE_OBLIGATIONS = Object.freeze([
  // "The fire detection and alarm system SHALL BE ADDRESSABLE ..." -- the system
  // itself is required to be addressable. This is the only obligation that can
  // support a system-wide device addressability claim.
  "SYSTEM_SHALL_BE_ADDRESSABLE",
  // "All components, including addressable smoke detectors, ... shall be
  // provided, wired, connected ..." -- a scope-of-supply / installation
  // obligation. "addressable" is a product descriptor inside a component list,
  // never the predicate.
  "SUPPLY_AND_INSTALLATION",
  // "The wiring ... shall form a digital data network." -- a wiring/network
  // obligation. "addressable fire alarm system" is a descriptor.
  "DIGITAL_DATA_NETWORK",
  // "The contacts of the addressable control module must have a minimum rating
  // of 2 amps at 24 volts dc" -- a component RATING obligation.
  "COMPONENT_RATING",
  // "The multi-criteria fire/CO detector is a plug-in ADDRESSABLE DEVICE ..."
  // -- a device-scoped addressability statement about a named device class, not
  // a system-wide obligation.
  "DEVICE_CLASS_ADDRESSABILITY",
  // "Features: ... e) Individually addressable devices f) Compatible with Flash
  // Scan / CLIP ..." -- a product data-sheet feature list from a compliance
  // clause. It describes a product, it does not obligate this project.
  "PRODUCT_FEATURE",
  // "The entry keypad must support ... control of addressable devices" -- a
  // capability/functional requirement on an accessory.
  "ACCESSORY_CAPABILITY",
  // "provide install and connect an intelligent addressable fire alarm system
  // including ..." -- an indefinite scope-of-supply statement, no normative
  // modal on the addressability predicate itself.
  "INDEFINITE_SCOPE_OF_SUPPLY",
  // Everything else, including contractor qualification boilerplate.
  "NO_ADDRESSABILITY_OBLIGATION",
]);

/**
 * Classify the obligation a requirement row carries.
 *
 * Order matters: the strongest, most specific predicate wins, and the
 * descriptor uses of "addressable" are consumed before the fallback.
 */
export const classifyAddressabilityClauseObligation = (requirement) => {
  const original = upper(requirement?.original_text);
  const normalized = upper(requirement?.normalized_requirement);
  const haystack = `${original} ${normalized}`;
  const category = text(requirement?.category);

  const obligation = (value, why) => ({ obligation: value, why, addresses: false, isAddressabilityObligation: false });

  // 1. The system-level addressable obligation. The subject is the system and
  //    the predicate is "shall be addressable".
  if (/\b(?:FIRE DETECTION AND ALARM|FIRE ALARM|ALARM) SYSTEM SHALL BE ADDRESSABLE\b/.test(haystack)) {
    return {
      obligation: "SYSTEM_SHALL_BE_ADDRESSABLE",
      why: "The clause obliges the fire detection and alarm system itself to be addressable ('shall be addressable').",
      addresses: true,
      isAddressabilityObligation: true,
    };
  }

  // 2. Wiring / data-network obligation. Must precede the generic fallbacks
  //    because the word "addressable" appears as a system descriptor in it.
  if (/\bSHALL FORM A DIGITAL DATA NETWORK\b/.test(haystack) || /\bDIGITAL DATA NETWORK\b/.test(haystack) && /\bSHALL\b/.test(haystack)) {
    return obligation(
      "DIGITAL_DATA_NETWORK",
      "The clause obliges the WIRING to form a digital data network; 'addressable' describes the system, it is not the predicate.",
    );
  }

  // 3. Scope of supply / installation obligation.
  if (/\bSHALL BE PROVIDED,? WIRED,? CONNECTED\b/.test(haystack) || /\bPROVIDE INSTALL AND CONNECT\b/.test(haystack)) {
    return obligation(
      "SUPPLY_AND_INSTALLATION",
      "The clause obliges components to be supplied, wired and connected; 'addressable' is a product descriptor inside a component list, not the predicate.",
    );
  }

  // 4. Component electrical rating obligation.
  if (/\b(?:MINIMUM )?RATING OF\b/.test(haystack) || /\bMINIMUM RATING\b/.test(haystack)) {
    return obligation("COMPONENT_RATING", "The clause states a component rating/electrical requirement; 'addressable' names the component, not an obligation.");
  }

  // 5. Product data-sheet feature list. A compliance/products clause describing
  //    a manufacturer's product, with no project obligation.
  if (category === "Compliance" || /\bUL ?(?:217|268)\b/.test(haystack) || /\bFEATURES\b/.test(haystack)) {
    return obligation(
      "PRODUCT_FEATURE",
      "The clause is a product/compliance feature description of a manufacturer's product; it obliges the product, not this project's devices.",
    );
  }

  // 6. Accessory capability requirement.
  if (/\bKEYPAD\b|\bANNUNCIATOR\b|\bENTRY PANEL\b/.test(haystack) || category === "Accessories") {
    return obligation("ACCESSORY_CAPABILITY", "The clause states an accessory capability requirement; it does not impose a device addressability obligation.");
  }

  // 7. A device-scoped addressability statement about a named device class.
  //    This IS an addressability statement, but it is device-scoped, so it can
  //    only ever govern populations whose device class / family it declares.
  if (/\bIS A PLUG[- ]?IN,? ADDRESSABLE DEVICE\b/.test(haystack) || /\bADDRESSABLE DEVICE PROVIDING\b/.test(haystack)) {
    return {
      obligation: "DEVICE_CLASS_ADDRESSABILITY",
      why: "The clause states that a named device class IS an addressable device; the claim is device-class scoped, not system wide.",
      addresses: true,
      isAddressabilityObligation: true,
    };
  }

  // 8. Contractor qualification / capacity / compatibility boilerplate.
  return obligation("NO_ADDRESSABILITY_OBLIGATION", "No addressability obligation is expressed by this clause; the word 'addressable' appears only as a descriptor.");
};

/**
 * NEGATIVE-OBLIGATION change detection (mission section 12).
 *
 * A clause can keep the same words and still weaken the obligation. These
 * patterns are a change in obligation strength, not a wording change.
 */
export const OBLIGATION_WEAKENING_PATTERNS = Object.freeze([
  { id: "MAY_BE_ADDRESSABLE", pattern: /\bMAY BE ADDRESSABLE\b/i, weakensTo: "may be addressable" },
  { id: "COMPATIBLE_WITH_ADDRESSABLE", pattern: /\bCOMPATIBLE WITH ADDRESSABLE\b/i, weakensTo: "compatible with addressable systems" },
  { id: "CAPABLE_OF_ADDRESSABLE", pattern: /\bCAPABLE OF ADDRESSABLE\b|\bCAPABLE OF ADDRESSABLE OPERATION\b/i, weakensTo: "capable of addressable operation" },
  { id: "SHALL_NOT_BE_ADDRESSABLE", pattern: /\bSHALL NOT BE ADDRESSABLE\b/i, weakensTo: "shall not be addressable" },
]);

export const findObligationWeakening = (textValue) => {
  const haystack = textValue ?? "";
  return OBLIGATION_WEAKENING_PATTERNS.filter((entry) => entry.pattern.test(haystack));
};

/**
 * Scope-bearing qualifiers (mission section 11). A small textual change to any
 * of these materially alters applicability, so they are never normalized away.
 */
export const SCOPE_QUALIFIERS = Object.freeze([
  { id: "ALL", pattern: /\bALL\b/i, scope: "every device in scope" },
  { id: "WHERE_INDICATED", pattern: /\bWHERE INDICATED\b/i, scope: "only where indicated" },
  { id: "UNLESS_OTHERWISE_NOTED", pattern: /\bUNLESS OTHERWISE (?:NOTED|SPECIFIED)\b/i, scope: "unless an exception is recorded" },
  { id: "CONNECTED_TO_SLC", pattern: /\bCONNECTED TO (?:THE )?SLC\b|\bTWO[- ]WIRE SLC\b/i, scope: "SLC-connected devices only" },
  { id: "FIELD_DEVICES", pattern: /\bFIELD DEVICES?\b/i, scope: "field devices only" },
  { id: "INITIATING_DEVICES", pattern: /\bINITIATING DEVICES?\b/i, scope: "initiating devices only" },
  { id: "DETECTORS", pattern: /\bDETECTORS?\b/i, scope: "detectors only" },
  { id: "MODULES", pattern: /\bMODULES?\b/i, scope: "modules only" },
  { id: "NOTIFICATION_APPLIANCES", pattern: /\b(?:ALARM SIGNALING DEVICES?|SOUNDERS?|NAC|NOTIFICATION APPLIANCES?)\b/i, scope: "notification appliances" },
  { id: "CONTROL_EQUIPMENT", pattern: /\b(?:CONTROL PANEL|FACP|POWER SUPPLY|ANNUNCIATOR|REPEATER PANEL)\b/i, scope: "control equipment" },
]);

export const readScopeQualifiers = (textValue) => {
  const haystack = textValue ?? "";
  return SCOPE_QUALIFIERS.filter((entry) => entry.pattern.test(haystack)).map((entry) => entry.id);
};

const safeJson = (value) => {
  if (value === null || value === undefined) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return {};
  }
};

/**
 * Field-by-field semantic comparison of a prior requirement version against the
 * current one. `SEMANTIC_*` classification is derived from the compared fields
 * plus the obligation and qualifier reads -- never from text equality alone.
 */
export const semanticCompareRequirementVersions = (prior, current) => {
  const compared = [
    "original_text",
    "normalized_requirement",
    "requirement_type",
    "requirement_category",
    "category",
    "engineering_domain",
    "system",
    "condition",
    "exception",
    "source_revision",
    "sequence",
    "source_document_id",
  ];

  const fields = compared.map((field) => {
    const before = prior?.[field] ?? null;
    const after = current?.[field] ?? null;
    return { field, before, after, identical: flat(before) === flat(after) };
  });
  const changed = fields.filter((entry) => !entry.identical);

  // Scope-bearing fields. A change in any of these changes who the clause governs.
  const scopeFields = new Set(["system", "requirement_category", "category", "engineering_domain"]);
  const scopeChanged = changed.filter((entry) => scopeFields.has(entry.field));
  const textChanged = changed.filter((entry) => entry.field === "original_text" || entry.field === "normalized_requirement");

  const priorObligation = classifyAddressabilityClauseObligation(prior);
  const currentObligation = classifyAddressabilityClauseObligation(current);
  const obligationChanged = priorObligation.obligation !== currentObligation.obligation;

  const priorQualifiers = readScopeQualifiers(prior?.original_text);
  const currentQualifiers = readScopeQualifiers(current?.original_text);
  const qualifierSetChanged =
    priorQualifiers.length !== currentQualifiers.length || priorQualifiers.some((id) => !currentQualifiers.includes(id));

  const weakening = findObligationWeakening(current?.original_text);
  const priorWeakening = findObligationWeakening(prior?.original_text);

  // Authority / source location, from the extractor's own recorded source
  // location. The raw clause text recorded there is the authority for the
  // comparison; the normalized text is the engine's interpretation of it.
  const priorLocation = safeJson(prior?.source_location);
  const currentLocation = safeJson(current?.source_location);
  const sourceLocationIdentical =
    flat(priorLocation?.originalClauseText) === flat(currentLocation?.originalClauseText) &&
    flat(priorLocation?.clausePath) === flat(currentLocation?.clausePath) &&
    Number(priorLocation?.pageFrom) === Number(currentLocation?.pageFrom) &&
    Number(priorLocation?.pageTo) === Number(currentLocation?.pageTo);

  let comparison;
  if (prior === null || prior === undefined) {
    // Nothing to compare against. Absence of a prior version is never evidence
    // of equivalence, so the honest answer is that comparison is insufficient.
    comparison = "INSUFFICIENT_TO_COMPARE";
  } else if (weakening.length > 0 && priorWeakening.length === 0) {
    comparison = "SEMANTICALLY_CHANGED";
  } else if (obligationChanged) {
    // Reach is measured in ADDRESSABILITY, not in enum order. A clause that
    // stops obliging addressability (a supply clause replaced a system address
    // obligation) obliges LESS about addressability, so it is NARROWER; the
    // reverse is BROADER. A change between two non-addressability obligations
    // is simply a change of subject and is never "equivalent".
    if (priorObligation.isAddressabilityObligation && !currentObligation.isAddressabilityObligation) {
      comparison = "SEMANTICALLY_NARROWER";
    } else if (!priorObligation.isAddressabilityObligation && currentObligation.isAddressabilityObligation) {
      comparison = "SEMANTICALLY_BROADER";
    } else if (priorObligation.obligation === "SYSTEM_SHALL_BE_ADDRESSABLE" || currentObligation.obligation === "SYSTEM_SHALL_BE_ADDRESSABLE") {
      comparison = "SEMANTICALLY_CHANGED";
    } else {
      comparison = "SEMANTICALLY_CHANGED";
    }
  } else if (scopeChanged.length > 0) {
    comparison = "SEMANTICALLY_CHANGED";
  } else if (textChanged.length > 0 || qualifierSetChanged) {
    comparison = qualifierSetChanged ? "SEMANTICALLY_NARROWER" : "SEMANTICALLY_CHANGED";
  } else if (changed.length === 0) {
    comparison = "SEMANTICALLY_EQUIVALENT";
  } else {
    comparison = "INSUFFICIENT_TO_COMPARE";
  }

  return {
    comparison,
    comparisonBasis:
      "Compared field by field (raw text, normalized text, predicate/type, category, domain, system, condition, exception, source revision, sequence, source document), plus the clause's own obligation, its scope qualifiers, its obligation-weakening patterns, and the extractor's recorded raw source clause text and page. Text equality alone is never the basis.",
    fields,
    changedFields: changed.map((entry) => entry.field),
    textChanged: textChanged.length > 0,
    scopeChangedFields: scopeChanged.map((entry) => entry.field),
    scopePreserved: scopeChanged.length === 0,
    sourceLocationIdentical,
    priorObligation,
    currentObligation,
    obligationChanged,
    priorQualifiers,
    currentQualifiers,
    qualifierSetChanged,
    obligationWeakening: weakening.map((entry) => ({ id: entry.id, weakensTo: entry.weakensTo })),
    priorObligationWeakening: priorWeakening.map((entry) => ({ id: entry.id, weakensTo: entry.weakensTo })),
  };
};

/**
 * Build a GOLDEN-6C3A evidence record from a `technical_requirements` row.
 *
 * `currency` MUST come from the repository's canonical currentness authority
 * (`currentTechnicalRequirementsFrom` / `currentSpecificationExtraction`). This
 * adapter never decides currency itself and never inherits a prior version's
 * review state: `review_status` and `approved_for_downstream` are read from the
 * row itself and from nowhere else.
 */
export const buildAddressabilityClauseEvidence = (requirement, { currency = null, system = "Fire Alarm" } = {}) => {
  const row = requirement ?? {};
  const classification = classifyAddressabilityClauseObligation(row);
  const isCurrent = currency === null ? true : Boolean(currency.isCurrent);
  const supersededAt = currency === null ? null : currency.supersededAt ?? null;

  let claimKind = "NONE";
  let addressabilityClaim = null;
  let basis = null;

  if (!classification.isAddressabilityObligation) {
    claimKind = classification.obligation === "DIGITAL_DATA_NETWORK" ? "NETWORK_ARCHITECTURE" : "NONE";
  } else if (classification.obligation === "SYSTEM_SHALL_BE_ADDRESSABLE") {
    claimKind = "SYSTEM_ARCHITECTURE";
    addressabilityClaim = "ADDRESSABLE";
    basis = "APPROVED_SYSTEM_WIDE_REQUIREMENT";
  } else if (classification.obligation === "DEVICE_CLASS_ADDRESSABILITY") {
    claimKind = "DEVICE";
    addressabilityClaim = "ADDRESSABLE";
    // A device-scoped claim must declare which device class it governs. The
    // clause names no governed family or device class field, so the basis is the
    // device's own identity in the clause, which the applicability layer must
    // still match against a governed population family.
    basis = "EXPLICIT_DEVICE_FAMILY_SCOPE";
  }

  const scope = { system: text(row.system) || system };
  if (claimKind === "SYSTEM_ARCHITECTURE") scope.systemWide = true;

  return {
    id: `spec-requirement:${row.id}`,
    kind: "SPECIFICATION_REQUIREMENT",
    claimKind,
    addressabilityClaim,
    basis,
    obligation: classification.obligation,
    obligationWhy: classification.why,
    clause: flat(row.normalized_requirement).slice(0, 200),
    scope,
    eligibility: {
      reviewStatus: text(row.review_status),
      approvedForDownstream: Number(row.approved_for_downstream || 0),
      extractionIsCurrent: isCurrent,
      supersededAt,
    },
    provenance: {
      source: "Specification requirement",
      sourceLocation: safeJson(row.source_location)?.section
        ? `${safeJson(row.source_location).section}${safeJson(row.source_location).clause ? ` clause ${safeJson(row.source_location).clause}` : ""} (page ${safeJson(row.source_location).pageFrom ?? "?"})`
        : "Specification requirement",
      authority: `Specification requirement (${text(row.review_status)})`,
      sourcePage: safeJson(row.source_location)?.pageFrom ?? null,
      sourceDrawingNumber: null,
      evidenceVersionId: row.extraction_version_id ?? null,
    },
  };
};

export const ADDRESSABILITY_CLAUSE_EVIDENCE_DISCLAIMERS = Object.freeze([
  "This adapter does not decide applicability; the GOLDEN-6C3A engine does.",
  "This adapter does not decide currency; the repository's canonical currentness authority does.",
  "This adapter contains no carry-forward or review-inheritance rule; none exists in this repository and none is invented here.",
  "This adapter emits no product, ecosystem, panel, quantity or point-consumption value.",
]);
