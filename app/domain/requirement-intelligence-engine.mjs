import { FIRE_ALARM_TAXONOMY, FIRE_ALARM_TAXONOMY_VERSION, buildFireAlarmTaxonomyContext, isGovernedBooleanCapability } from "./fire-alarm-taxonomy.mjs";
import { findProductListingBodyInText } from "./standards-citations.mjs";
export { FIRE_ALARM_TAXONOMY, FIRE_ALARM_TAXONOMY_VERSION } from "./fire-alarm-taxonomy.mjs";

export const REQUIREMENT_INTELLIGENCE_VERSION = "requirement-intelligence-1.2.0";

// The governed fact type carrying a LISTING AUTHORITY requirement. Its value is
// `{ authority, required }`, so the requirement stays generic ("UL listed") and
// never acquires a standard number it did not state.
export const LISTING_FACT_TYPE = "Listing Authority";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lower = (value) => clean(value).toLowerCase();
const unique = (values) => [...new Set(values.filter(Boolean))];
const modality = (requirement) => requirement.requirementType === "Optional" || /\b(?:may|optional)\b/i.test(requirement.originalText || "") ? "Optional" : requirement.requirementType === "Preferred" || /\bpreferred\b/i.test(requirement.originalText || "") ? "Preferred" : "Mandatory";

const equipment = (value) => {
  const family = buildFireAlarmTaxonomyContext({ description: value }, { allowMultipleExplicitEntities: true }).families[0]?.family || null;
  return family === "Fire Alarm Control Panel" ? "Fire Alarm Panel" : family;
};

const add = (facts, requirement, type, value, options = {}) => {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) return;
  const source = requirement.source || {};
  facts.push({
    key: `${requirement.id}:${type}:${clean(Array.isArray(value) ? value.join("|") : value).toLowerCase()}`,
    requirementId: requirement.id,
    factType: type,
    value,
    modality: options.modality || modality(requirement),
    confidence: Math.max(0, Math.min(100, Number(options.confidence ?? requirement.confidence ?? 70))),
    reviewStatus: "Needs Review",
    source: { page: source.pageFrom || source.page || null, pageTo: source.pageTo || null, clause: source.clause || null, section: source.section || null },
    evidenceSnippet: clean(options.evidence || requirement.originalText),
    extractionBasis: options.basis || "Explicit specification wording",
  });
};

const explicitList = (text, pattern) => unique([...text.matchAll(pattern)].map((match) => clean(match[1] || match[0])));

// GOVERNED COLON-INTRODUCED LIST MEMBERSHIP (compound capability derivation)
//
// A specification lead-in that ends in a colon introduces a list whose members
// are noun phrases that carry NO modal of their own:
//   "FACP Shall be provided with the following for basic operation:"
//     "1. Communication Ports: Offer data communication interfaces..."
//     "2. Integrated On-Line Diagnostics: The control panel will..."
//     "3. Surge and Transient Protection: Isolation will be provided..."
// The governing modal belongs to the LEAD-IN; each member is governed by it.
// That is the same modal inheritance app/domain/specification-extractor.mjs
// applies when it admits such a member as a requirement clause.
//
// A list like this demands SEVERAL INDEPENDENT capabilities, so it is modelled
// exactly the way sequence 100058 already is: ONE source requirement producing
// several structured capability claims, each compared on its own. A compound
// boolean would let one member pass while another failed, which is exactly the
// false-assurance the per-key model exists to prevent.
//
// This derives from the requirement's OWN source page text, supplied explicitly
// by the governed loader as `sourcePageTexts.get(requirement.id)` (see
// loadColonListPageTexts in worker/technical-requirement-api.mjs). It never
// re-extracts the specification, never invents member text, and never edits a
// historical extraction record: it reads the stored page and binds every derived
// fact to that member's verbatim text.
//
// The page text is a DERIVATION INPUT, passed separately and deliberately NOT
// hung off the requirement object, for two reasons: a requirement is copied by
// spread wherever it is projected into a profile, so a hidden property would be
// silently dropped; and a requirement is stored verbatim inside
// `requirement_profile_versions.profile`, so the page text must never become
// profile state. The immutable per-member text it yields IS persisted, verbatim
// and alone, in each capability fact's `evidence_snippet`.
const MEMBER_START = /^\s*\d{1,2}[.)]\s+\S/;
const CLAUSE_START = /^\s*[A-Z][.)]\s+\S/;

// Strip a leading structural clause number ("I. ", "1.2 ", "(a) ") so a stored
// requirement's own text can be matched against the source page line that
// carries it. Only a leading marker is removed; the sentence itself is never
// rewritten, so a partial or wrapped page line can never match.
const structuralPrefix = (line) => String(line).replace(/^\s*(?:(?:\(?[A-Z0-9]{1,4}[.)]\s*){1,3})/, "").trim();

// Every gate below fails closed to an EMPTY list, so a requirement with no
// colon lead-in, no governing modal of its own, no supplied page text, or no
// verbatim match for its own lead-in derives nothing at all.
export const governedColonListMembers = (requirement, sourcePageText = null) => {
  const leadIn = clean(requirement?.originalText);
  // The lead-in must itself state the governing modal. A bare noun phrase that
  // merely ends in a colon governs nothing and inherits nothing.
  if (!/:\s*$/.test(leadIn) || !/\b(?:shall|must)\b/i.test(leadIn)) return [];
  const pageText = String(sourcePageText || "");
  if (!pageText) return [];
  const lines = pageText.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => lower(structuralPrefix(line)) === lower(leadIn));
  if (startIndex < 0) return [];

  const members = [];
  let current = null;
  for (const line of lines.slice(startIndex + 1)) {
    if (!line.trim()) {
      // A blank line closes the list once a member has started; before any
      // member it is only spacing and is skipped.
      if (current) break;
      continue;
    }
    if (CLAUSE_START.test(line)) break; // a new clause/article terminates the list
    if (MEMBER_START.test(line)) {
      if (current) members.push(current);
      current = [line.trim()];
      continue;
    }
    // The list may not be skipped: the line after the lead-in must itself be a
    // numbered member, so a requirement can never reach across unrelated prose.
    if (!current) break;
    current.push(line.trim());
  }
  if (current) members.push(current);
  return members.map((entry) => clean(entry.join(" "))).filter(Boolean);
};

// Capability triggers that are reachable ONLY through a colon-introduced list
// member, and deliberately NOT through CAPABILITY_RULES above: a list member
// carries no modal of its own, so it can only ever be governed by an inherited
// modal. Adding these to CAPABILITY_RULES would let them fire on any unrelated
// text that merely contains the phrase.
//
// Each pattern matches the member's own capability label. No key is added here:
// all three already exist in the closed governed vocabulary for exactly these
// Al Mousa clauses (1 GENERAL / I.1, I.2 and I.3).
const COLON_LIST_CAPABILITY_RULES = [
  ["panel_communication_ports", /\bcommunication\s+ports?\b/],
  ["panel_online_diagnostics", /\bon[-\s]?line\s+diagnostics?\b/],
  ["panel_transient_protection", /\bsurge\s+and\s+transient\s+protection\b/],
];

export const extractRequirementIntelligence = (requirement, sourcePageText = null) => {
  const original = clean(requirement.originalText);
  const normalized = clean(requirement.normalizedRequirement || original);
  const combined = `${original} ${normalized}`;
  const text = lower(combined);
  // A requirement's own clause text is sometimes only half of the governing
  // spec passage (e.g. "Manual pull stations shall be individually
  // addressable..." and "Stations shall include a single action operating
  // mechanism..." are separate extracted requirements from the same clause
  // block). source.originalClauseText already captures the full block with
  // provenance; scan it too, but only for rules proven against real evidence
  // to need it (Action Type below), so unrelated rules keep prior behavior.
  const clauseText = lower(clean(requirement.source?.originalClauseText || ""));
  const facts = [];

  // CANONICAL CAPABILITY DERIVATION
  //
  // Al Mousa 28 46 00 states its control-panel requirements as qualitative
  // capabilities ("shall feature switches and an LCD/LED display", "Key presses
  // shall be recorded in the history log", "shall feature alarm
  // verification"). None of them carries a numeric or free-text comparison
  // dimension, so each previously reached Product Matching with NO dimension at
  // all and could only ever be reported as unstructured missing evidence.
  //
  // Each rule below is a closed, deterministic pattern over the requirement's OWN
  // wording that names the capability and the governing modal explicitly. It adds
  // NOTHING the requirement does not already say, it invents no value, and it
  // never derives a capability for text that does not unambiguously demand one:
  // a requirement with no modal, or whose trigger phrase is absent, yields no
  // fact at all and therefore keeps failing closed in matching.
  //
  // Each fact is created at "Needs Review" like every other intelligence fact, so
  // an engineer must approve it before it can reach Product Matching.
  const CAPABILITY_RULES = [
    // 1 GENERAL / G -- "shall feature switches and an LCD/LED display"
    ["local_operator_display", /\b(?:shall|must)\b[^.]*\b(?:lcd|led|display)\b/],
    ["panel_operator_switches", /\b(?:shall|must)\b[^.]*\b(?:switches|keypad|entry keypad|function keys?)\b/],
    // 1 GENERAL / H.7 -- "Key presses shall be recorded in the history log."
    ["operator_event_logging", /\bkey\s*press(?:es)?\b[^.]*\b(?:shall|must)\b[^.]*\b(?:history|event)\s*log\b/],
    // 1 GENERAL / H.7 -- "sufficient memory to support its operating system and databases"
    ["panel_database_support", /\boperating system\b[^.]*\bdatabases?\b|\bdatabases?\b[^.]*\boperating system\b/],
    // 1 GENERAL / X -- "...all signaling devices shall reactivate."
    //
    // Stem patterns deliberately carry NO trailing \b: `reactivat` and `resound`
    // are word STEMS ("reactivate", "resounds"), and a trailing \b after a stem
    // can never match inside the inflected word because two word characters do
    // not form a boundary. That bug silently made this rule never fire.
    ["signal_reactivation_control", /\bsignal(?:l|s)?ing\b[^.]*\breactivat\w*|\bsignal(?:l|s)?ing\b[^.]*\bresound\w*|\breactivat\w*[^.]*\bsignal(?:l|s)?ing\b|\bresound\w*[^.]*\bsignal(?:l|s)?ing\b/],
    // 1 GENERAL / X -- "shall feature alarm verification, allowing re-setting and
    // monitoring of activated detectors to confirm potential alarms"
    ["alarm_verification_support", /\b(?:shall|must)\b[^.]*\balarm verification\b/],
    // 2 PRODUCTS / 5a and 6 -- "peer-to-peer, regenerative format and protocol"
    ["peer_to_peer_network", /\bpeer[\s-]*to[\s-]*peer\b/],
    // 2 PRODUCTS / D -- "shall be software-integrated with the main fire alarm
    // control unit"
    ["panel_software_integration", /\bsoftware[\s-]*integrated\b/],
  ];
  for (const [capabilityKey, pattern] of CAPABILITY_RULES) {
    // Only ever derive a capability the governed vocabulary actually defines.
    if (!isGovernedBooleanCapability(capabilityKey)) continue;
    if (!pattern.test(text)) continue;
    add(facts, requirement, `Capability: ${capabilityKey}`, "true", {
      confidence: 90,
      basis: "Explicit capability wording in the requirement's own text",
      evidence: original,
    });
  }
  // COMPOUND REQUIREMENT -- one governing colon-introduced lead-in whose numbered
  // list members each name an INDEPENDENT capability. Each member is compared on
  // its own, so one member's evidence can never satisfy another's.
  for (const member of governedColonListMembers(requirement, sourcePageText)) {
    const memberText = lower(member);
    for (const [capabilityKey, pattern] of COLON_LIST_CAPABILITY_RULES) {
      if (!isGovernedBooleanCapability(capabilityKey)) continue;
      if (!pattern.test(memberText)) continue;
      add(facts, requirement, `Capability: ${capabilityKey}`, "true", {
        confidence: 90,
        basis: "Named by a numbered list member of this requirement's own colon-introduced governing lead-in; the member states no modal of its own and inherits the lead-in's",
        evidence: member,
      });
    }
  }
  // 1 GENERAL / E -- "If a separate enclosure is used, it must match the FACP
  // enclosure's color exactly." This is RELATIONAL: it names no absolute colour,
  // so it is derived as a relational constraint and NEVER as cabinet_color=<value>.
  if (/\bseparate\s+enclosure\b[^.]*\bmatch\b[^.]*\bcolou?r\b|\bmatch\b[^.]*\benclosure\b[^.]*\bcolou?r\b/.test(text)) {
    add(facts, requirement, "Capability: related_enclosure_colour_match", "required", {
      confidence: 90,
      basis: "Explicit relational constraint in the requirement's own text; no absolute colour is stated",
      evidence: original,
    });
  }
  // GOVERNED LISTING / CERTIFICATION AUTHORITY REQUIREMENT
  //
  // A specification sometimes demands that equipment be LISTED or CERTIFIED by a
  // NAMED certification body while citing NO standard number for it. The real
  // clause is 28 46 00 / 1 GENERAL / P (sequence 100075):
  //
  //   "Every component of the fire alarm system shall be listed under a single
  //    manufacturer, approved by Underwriters Laboratories (UL), and clearly bear
  //    the UL certification. All control equipment must be certified accordingly."
  //
  // THAT is a listing-authority requirement and it is genuinely mandatory. It is
  // NOT "UL 864 required": the clause names no number, and none may ever be
  // inferred for it. The product's own verified UL 864 evidence stays PRODUCT
  // evidence; the project requirement stays generic UL listing.
  //
  // WHY A SEPARATE PATH RATHER THAN A NUMBERED STANDARD. A numbered citation is
  // satisfiable only by that exact number, and an unnumbered one is unfalsifiable
  // as a numbered citation -- product-matching-engine.mjs correctly refuses it,
  // and that refusal is left untouched here. Routing this assertion through the
  // numbered gate could therefore only ever manufacture a false failure against a
  // product that IS listed. It gets its own governed representation instead.
  //
  // WHAT MAKES THE DERIVATION HONEST, AND WHY IT IS NOT A TEXT SEARCH FOR "UL".
  // The authority must be named inside a sentence that ASSERTS a listing demand
  // under a project modal. That single condition is what separates the genuine
  // requirement from the shape a bare listing word takes when it merely qualifies
  // some other noun. Sequence 100313 (the panel's EIA-232/EIA-485 connectivity
  // clause) reads:
  //
  //   "...linking the fire alarm control panel with UL Listed Electronic Data
  //    Processing (EDP) peripherals..."
  //
  // There, "UL Listed" modifies the PERIPHERALS that may be attached to the
  // port. It carries no modal of its own and asserts nothing about the panel, so
  // deriving "the panel must be UL listed" from it would invent a requirement the
  // project never made. Sequence 100075 is the opposite: "shall be listed",
  // "must be certified" and "bear the UL certification" all assert the listing OF
  // the equipment. Scanning per sentence, and requiring the modal, keeps the two
  // apart deterministically.
  //
  // Naming no body at all ("listed or labeled by an approved testing laboratory",
  // 28 46 00 / 1 GENERAL clause 2) derives NOTHING: without an authority there is
  // no listing requirement to compare, so it keeps failing closed rather than
  // matching arbitrary free text. The recognised set is the canonical
  // `productListingBody` set (app/domain/standards-citations.mjs), never a second
  // list maintained here.
  //
  // The modal gate admits only an explicit OBLIGATION ("shall", "must", "is
  // required to", "needs to"). A hedged demand deliberately derives nothing:
  // "Detectors should be listed by UL where available" is not an obligation, and
  // `modality()` above classifies a sentence carrying no recognised soft modal as
  // Mandatory, so admitting it here would let the project's own hedge come back as
  // a BLOCKING listing gate on a product. Deriving nothing keeps both errors away
  // -- it neither blocks nor silently passes.
  const LISTING_DEMAND_UNDER_A_MODAL = /\b(?:shall|must|is required to|are required to|needs to|need to)\b[^.]*?\b(?:listed|labell?ed|certified|approved|rated|marked)\b/;
  for (const sentence of combined.split(/(?<=[.;:])\s+/)) {
    const claim = lower(sentence).trim();
    if (!claim || !LISTING_DEMAND_UNDER_A_MODAL.test(claim)) continue;
    const authority = findProductListingBodyInText(claim);
    if (!authority) continue;
    if (facts.some((fact) => fact.factType === LISTING_FACT_TYPE && String(clean(fact.value?.authority)).toUpperCase() === authority)) continue;
    add(facts, requirement, LISTING_FACT_TYPE, { authority, required: true }, {
      confidence: 88,
      basis: "The requirement's own text asserts under a project modal that equipment must be listed or certified by the named authority, and cites no standard number for it; the authority is recorded as a listing requirement, never as a numbered standard",
      evidence: clean(sentence),
    });
  }
  const equipmentType = equipment(combined);
  add(facts, requirement, "Equipment Type", equipmentType, { confidence: equipmentType ? 92 : 0 });
  add(facts, requirement, "System Type", requirement.system || (/fire alarm|smoke detector|repeater panel/.test(text) ? "Fire Alarm" : null), { confidence: requirement.system ? 100 : 85 });
  if (equipmentType) add(facts, requirement, "Product Family", equipmentType, { confidence: 82, basis: "Explicit equipment noun; family remains reviewable" });
  if (equipmentType) add(facts, requirement, "Device Category", /detector/.test(equipmentType) ? "Detection Device" : /module/.test(equipmentType) ? "Interface Module" : /panel/.test(equipmentType) ? "Control Equipment" : /sounder|strobe/.test(equipmentType) ? "Notification Appliance" : null);

  const roles = unique([/network|connected to|communicat/.test(text) ? "Network Communication" : null, /monitor/.test(text) ? "Monitoring" : null, /detect|detector/.test(text) ? "Detection" : null, /sounder|strobe|audible|visual alarm/.test(text) ? "Notification" : null, /control/.test(text) ? "Control" : null]);
  for (const role of roles) add(facts, requirement, "Functional Role", role);
  if (/ceiling/.test(text)) add(facts, requirement, "Installation Context", "Ceiling");
  if (/building|facility/.test(text)) add(facts, requirement, "Installation Context", "Building / Facility");
  if (/wall[- ]mounted|wall mounted/.test(text)) add(facts, requirement, "Mounting Method", "Wall Mounted");
  if (/ceiling[- ]mounted|ceiling mounted/.test(text)) add(facts, requirement, "Mounting Method", "Ceiling Mounted");
  if (/outdoor|weatherproof|external/.test(text)) add(facts, requirement, "Indoor / Outdoor", "Outdoor");
  else if (/indoor|interior/.test(text)) add(facts, requirement, "Indoor / Outdoor", "Indoor");

  for (const rating of explicitList(combined, /\b((?:IP|NEMA)\s*[- ]?\d+[A-Z]?)\b/gi)) add(facts, requirement, "Environmental Rating", rating.toUpperCase());
  for (const protocol of explicitList(combined, /\b(BACnet|Modbus|Ethernet|TCP\/IP|RS[- ]?485|SLC|IDNet|CLIP|FlashScan)\b/gi)) add(facts, requirement, "Protocol", protocol);
  for (const wiring of explicitList(combined, /\b((?:Class\s+[ABX]|(?:two|three|four|2|3|4)[- ]wire|shielded|unshielded|twisted pair)(?:\s+(?:circuit|wiring|cable))?)\b/gi)) add(facts, requirement, "Wiring Requirements", wiring);
  for (const loop of explicitList(combined, /\b((?:SLC|signaling line|addressable)\s+(?:loop|circuit)[^.;,]{0,45})/gi)) add(facts, requirement, "Loop Requirements", loop);
  for (const voltage of explicitList(combined, /\b(\d+(?:\.\d+)?\s*(?:VDC|VAC|V))\b/gi)) add(facts, requirement, "Voltage / Current", voltage);
  for (const current of explicitList(combined, /\b(\d+(?:\.\d+)?\s*(?:mA|A))\b/gi)) add(facts, requirement, "Voltage / Current", current);
  for (const power of explicitList(combined, /\b(\d+(?:\.\d+)?\s*(?:W|kW|VA|kVA))\b/gi)) add(facts, requirement, "Power Requirements", power);
  if (/addressable/.test(text)) add(facts, requirement, "Addressability", "Addressable");
  else if (/conventional/.test(text)) add(facts, requirement, "Addressability", "Conventional");

  // Governed vocabulary matches fire-alarm-taxonomy.mjs ATTRIBUTE_VALUE_VALIDATORS.action_type.
  if (/\bsingle action\b/.test(text) || /\bsingle action\b/.test(clauseText)) add(facts, requirement, "Action Type", "Single Action");
  else if (/\bdual action\b/.test(text) || /\bdual action\b/.test(clauseText)) add(facts, requirement, "Action Type", "Dual Action");

  for (const standard of explicitList(combined, /\b((?:NFPA|UL|EN|IEC|ISO|BS)\s*\d+(?:[-:]\d+)*)\b/gi)) add(facts, requirement, "Required Standards", standard.toUpperCase());
  for (const certification of explicitList(combined, /\b((?:UL|FM|LPCB|VdS|CE)\s*(?:listed|approved|certified|mark(?:ed)?)?)\b/gi).filter((entry) => /listed|approved|certified|mark/i.test(entry))) add(facts, requirement, "Required Certifications", certification);

  if (/\bshall\b|\bmust\b|\brequired\b/.test(text)) add(facts, requirement, "Mandatory Features", normalized, { modality: "Mandatory" });
  if (/\bmay\b|\boptional\b/.test(text)) add(facts, requirement, "Optional Features", normalized, { modality: "Optional" });
  for (const accessory of explicitList(combined, /\b(?:shall include|including|required with|provided with)\s+(?:an?\s+|the\s+)?([^.;]{3,80})/gi)) add(facts, requirement, "Required Accessories", accessory);
  for (const base of explicitList(combined, /\bcompatible (?:detector )?base\s*[:\-]?\s*([^.;,]{2,50})/gi)) add(facts, requirement, "Compatible Base", base);
  for (const compatibleModule of explicitList(combined, /\bcompatible (?:interface |monitor |control )?module\s*[:\-]?\s*([^.;,]{2,50})/gi)) add(facts, requirement, "Compatible Module", compatibleModule);
  for (const panel of explicitList(combined, /\bcompatible (?:fire alarm )?(?:control )?panel\s*[:\-]?\s*([^.;,]{2,60})/gi)) add(facts, requirement, "Compatible Panel", panel);
  if (/\b(?:networked together|connected to)\b/.test(text) && /panel/.test(text)) add(facts, requirement, "Technical Dependencies", original, { basis: "Explicit inter-panel dependency" });

  for (const manufacturer of explicitList(combined, /\b(?:manufacturer|manufactured by|make)\s*[:\-]?\s*([A-Z][A-Za-z0-9& .-]{2,45})/g)) add(facts, requirement, "Manufacturer Constraints", manufacturer, { basis: "Explicit manufacturer wording" });
  for (const brand of explicitList(combined, /\b(?:brand|basis of design)\s*[:\-]?\s*([A-Z][A-Za-z0-9& .-]{2,45})/g)) add(facts, requirement, "Brand Restrictions", brand, { basis: "Explicit brand wording" });
  for (const quantity of explicitList(combined, /\b((?:one|two|three|\d+)\s+(?:per|for each)\s+[^.;,]{2,50})/gi)) add(facts, requirement, "Required Quantity Rules", quantity);

  return facts;
};

// `sourcePageTexts` maps requirementId -> that requirement's own verbatim
// extracted source page. It is optional, so every existing caller and test that
// has no page text keeps working and simply derives no compound capability.
//
// The lookup is done in an explicit callback rather than by passing the function
// straight to `flatMap`: `flatMap` would supply the array INDEX as this
// function's second argument, so an index of 1 would be read as page text.
export const buildRequirementIntelligence = (requirements, sourcePageTexts = null) => {
  const pageFor = (requirement) =>
    typeof sourcePageTexts?.get === "function" ? sourcePageTexts.get(requirement.id) ?? null : null;
  const rawFacts = requirements.flatMap((requirement) =>
    extractRequirementIntelligence(requirement, pageFor(requirement)),
  );

  // fact.key is the canonical identity of an intelligence observation:
  // requirement + fact type + normalized value.
  //
  // Multiple deterministic extraction rules may observe the same semantic fact
  // from the same requirement. Persist exactly one canonical fact per key while
  // preserving the strongest confidence/evidence.
  const factsByKey = new Map();

  for (const fact of rawFacts) {
    const existing = factsByKey.get(fact.key);

    if (!existing) {
      factsByKey.set(fact.key, fact);
      continue;
    }

    factsByKey.set(fact.key, {
      ...existing,
      confidence: Math.max(
        Number(existing.confidence || 0),
        Number(fact.confidence || 0),
      ),
      evidenceSnippet:
        existing.evidenceSnippet?.length >= fact.evidenceSnippet?.length
          ? existing.evidenceSnippet
          : fact.evidenceSnippet,
    });
  }

  const facts = [...factsByKey.values()];

  const byType = Object.fromEntries([...new Set(facts.map((fact) => fact.factType))].sort().map((type) => [type, facts.filter((fact) => fact.factType === type).length]));
  const present = new Set(facts.map((fact) => fact.factType));
  const critical = ["Equipment Type", "Product Family", "System Type", "Protocol", "Required Standards", "Required Certifications", "Compatible Panel"];
  const missingInformation = critical.filter((type) => !present.has(type)).map((type) => ({ field: type, blocking: ["Equipment Type", "Product Family"].includes(type), status: "Open", reason: `No explicit, confirmed specification evidence establishes ${type.toLowerCase()}.`, clarification: `Confirm ${type.toLowerCase()} with page, clause and exact source evidence.` }));
  return { version: REQUIREMENT_INTELLIGENCE_VERSION, facts, counts: { total: facts.length, byType, needsReview: facts.length, approved: 0, rejected: 0 }, missingInformation, conflicts: [], clarifications: missingInformation.map((entry) => ({ question: entry.clarification, relatedField: entry.field, status: "Open", blocking: entry.blocking })), confidence: facts.length ? Math.round(facts.reduce((sum, fact) => sum + fact.confidence, 0) / facts.length) : 0 };
};
