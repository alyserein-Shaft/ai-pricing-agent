import { FIRE_ALARM_TAXONOMY, FIRE_ALARM_TAXONOMY_VERSION, buildFireAlarmTaxonomyContext } from "./fire-alarm-taxonomy.mjs";
export { FIRE_ALARM_TAXONOMY, FIRE_ALARM_TAXONOMY_VERSION } from "./fire-alarm-taxonomy.mjs";

export const REQUIREMENT_INTELLIGENCE_VERSION = "requirement-intelligence-1.0.2";

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

export const extractRequirementIntelligence = (requirement) => {
  const original = clean(requirement.originalText);
  const normalized = clean(requirement.normalizedRequirement || original);
  const combined = `${original} ${normalized}`;
  const text = lower(combined);
  const facts = [];
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

export const buildRequirementIntelligence = (requirements) => {
  const rawFacts = requirements.flatMap(extractRequirementIntelligence);

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
