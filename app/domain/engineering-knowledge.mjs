export const KNOWLEDGE_MODEL_VERSION = "engineering-knowledge-1.0.0";
export const FACT_TYPES = ["Source Fact", "Normalized Fact", "Derived Fact", "Inferred Fact", "Assumption", "Human Decision", "AI Suggestion", "Global Rule", "Project Rule", "Manufacturer Rule", "Supplier Claim"];
export const SCOPE_TYPES = ["Global", "Organization", "Business Unit", "Engineering Domain", "Manufacturer", "Product Family", "Product", "Supplier", "Project", "Project Package", "BOQ Item", "Document Revision"];
export const LINK_STATUSES = ["Suggested", "Confirmed", "Rejected", "Needs Review", "Removed", "Superseded"];
export const COMPARISON_OPERATORS = ["Equal", "Not Equal", "Minimum", "Maximum", "Greater Than", "Greater Than or Equal", "Less Than", "Less Than or Equal", "Between", "Includes", "Excludes", "Supports", "Compatible With", "Certified By", "One Of", "All Of", "Conditional"];

export class KnowledgeIntegrityError extends Error { constructor(code, message) { super(message); this.name = "KnowledgeIntegrityError"; this.code = code; } }
const required = (value, code, message) => { if (value === null || value === undefined || value === "") throw new KnowledgeIntegrityError(code, message); return value; };
const clamp = (value) => Math.max(0, Math.min(100, Number(value || 0)));

export const validateProvenance = (provenance, factType) => {
  required(provenance?.sourceType, "PROVENANCE_SOURCE_REQUIRED", "Every knowledge fact requires a source type.");
  required(provenance?.sourceId, "PROVENANCE_ID_REQUIRED", "Every knowledge fact requires a stable source identifier.");
  required(provenance?.createdAt, "PROVENANCE_TIME_REQUIRED", "Every knowledge fact requires a creation time.");
  if (["Source Fact", "Normalized Fact", "AI Suggestion", "Supplier Claim", "Manufacturer Rule"].includes(factType)) {
    required(provenance.documentId || provenance.evidenceId, "PROVENANCE_EVIDENCE_REQUIRED", "Source-backed knowledge requires document or evidence provenance.");
    required(provenance.extractionMethod || provenance.humanReason, "PROVENANCE_METHOD_REQUIRED", "Source-backed knowledge requires an extraction method or human reason.");
  }
  if (["Human Decision", "Assumption", "Project Rule", "Global Rule"].includes(factType)) {
    required(provenance.userId, "HUMAN_IDENTITY_REQUIRED", "Human-created knowledge requires a user.");
    required(provenance.humanReason, "HUMAN_REASON_REQUIRED", "Human-created knowledge requires a reason.");
  }
  return { ...provenance, confidence: clamp(provenance.confidence) };
};

export const createKnowledgeFact = (input) => {
  if (!FACT_TYPES.includes(input.factType)) throw new KnowledgeIntegrityError("INVALID_FACT_TYPE", "Choose a controlled fact type.");
  if (!SCOPE_TYPES.includes(input.scopeType)) throw new KnowledgeIntegrityError("INVALID_SCOPE_TYPE", "Choose a controlled scope.");
  if (input.scopeType !== "Global") required(input.scopeId, "SCOPE_ID_REQUIRED", "Non-global knowledge requires a scope identifier.");
  if (input.factType === "Normalized Fact") required(input.sourceFactId, "SOURCE_FACT_REQUIRED", "A normalized fact must reference its source fact.");
  if (["Derived Fact", "Inferred Fact"].includes(input.factType)) required(input.derivation, "DERIVATION_REQUIRED", "Derived or inferred knowledge requires a derivation record.");
  if (input.factType === "AI Suggestion" && input.status === "Approved") throw new KnowledgeIntegrityError("AI_APPROVAL_FORBIDDEN", "An AI suggestion cannot approve itself.");
  if (input.factType === "Global Rule" && input.scopeType !== "Global") throw new KnowledgeIntegrityError("GLOBAL_SCOPE_REQUIRED", "A global rule must use global scope.");
  if (input.factType === "Project Rule" && !["Project", "Project Package", "BOQ Item"].includes(input.scopeType)) throw new KnowledgeIntegrityError("PROJECT_SCOPE_REQUIRED", "A project rule must remain within project scope.");
  return { id: input.id, projectId: input.projectId || null, entityType: required(input.entityType, "ENTITY_TYPE_REQUIRED", "A fact requires an entity type."), entityId: required(input.entityId, "ENTITY_ID_REQUIRED", "A fact requires an entity."), predicate: required(input.predicate, "PREDICATE_REQUIRED", "A fact requires a predicate."), value: input.value, dataType: input.dataType || "Text", operator: input.operator || "Equal", factType: input.factType, scopeType: input.scopeType, scopeId: input.scopeId || null, sourceFactId: input.sourceFactId || null, derivation: input.derivation || null, status: input.status || "Pending Review", confidence: clamp(input.confidence), provenance: validateProvenance(input.provenance, input.factType), modelVersion: KNOWLEDGE_MODEL_VERSION };
};

export const UNIT_DEFINITIONS = [
  { code: "V", family: "Voltage", factor: 1 }, { code: "kV", family: "Voltage", factor: 1000 },
  { code: "A", family: "Current", factor: 1 }, { code: "mA", family: "Current", factor: 0.001 },
  { code: "W", family: "Power", factor: 1 }, { code: "kW", family: "Power", factor: 1000 },
  { code: "VA", family: "Apparent Power", factor: 1 }, { code: "kVA", family: "Apparent Power", factor: 1000 },
  { code: "mm", family: "Length", factor: 0.001 }, { code: "cm", family: "Length", factor: 0.01 }, { code: "m", family: "Length", factor: 1 },
  { code: "Mbps", family: "Bandwidth", factor: 1 }, { code: "Gbps", family: "Bandwidth", factor: 1000 },
  { code: "hours", family: "Duration", factor: 1 }, { code: "days", family: "Duration", factor: 24 }, { code: "months", family: "Calendar Duration", factor: 1 },
  { code: "%", family: "Percentage", factor: 1 }, { code: "dB", family: "Sound Level", factor: 1 }, { code: "lux", family: "Illuminance", factor: 1 }, { code: "MP", family: "Resolution", factor: 1 },
];
const unitAliases = new Map([["volt", "V"], ["volts", "V"], ["vdc", "V"], ["vac", "V"], ["amp", "A"], ["amps", "A"], ["megapixels", "MP"], ["percent", "%"], ...UNIT_DEFINITIONS.map((unit) => [unit.code.toLowerCase(), unit.code])]);
export const resolveUnit = (value) => UNIT_DEFINITIONS.find((unit) => unit.code === unitAliases.get(String(value || "").trim().toLowerCase())) || null;
export const normalizeMeasurement = ({ value, unit, targetUnit = null, precision = 6 }) => { const source = resolveUnit(unit); if (!source) return { originalValue: value, originalUnit: unit, normalizedValue: null, normalizedUnit: null, status: "Invalid Unit" }; const target = targetUnit ? resolveUnit(targetUnit) : UNIT_DEFINITIONS.find((entry) => entry.family === source.family && entry.factor === 1) || source; if (!target || target.family !== source.family || source.family === "Calendar Duration") return { originalValue: value, originalUnit: unit, normalizedValue: null, normalizedUnit: null, status: "Invalid Conversion" }; const numeric = Number(value); if (!Number.isFinite(numeric)) return { originalValue: value, originalUnit: unit, normalizedValue: null, normalizedUnit: null, status: "Invalid Value" }; return { originalValue: value, originalUnit: unit, normalizedValue: Number(((numeric * source.factor) / target.factor).toFixed(precision)), normalizedUnit: target.code, status: "Normalized" }; };

export const resolveEffectiveVersion = (versions, at = new Date()) => versions.filter((version) => !version.deletedAt && new Date(version.effectiveFrom || 0) <= at && (!version.effectiveTo || new Date(version.effectiveTo) > at)).sort((left, right) => new Date(right.effectiveFrom || 0) - new Date(left.effectiveFrom || 0))[0] || null;
export const resolveScopedFacts = (facts, context) => { const precedence = { Global: 1, Project: 2, "Project Package": 3, "BOQ Item": 4 }; return facts.filter((fact) => fact.status !== "Superseded" && (fact.scopeType === "Global" || (fact.scopeType === "Project" && fact.scopeId === context.projectId) || (fact.scopeType === "Project Package" && fact.scopeId === context.packageId) || (fact.scopeType === "BOQ Item" && fact.scopeId === context.boqItemId))).sort((left, right) => (precedence[right.scopeType] || 0) - (precedence[left.scopeType] || 0)); };

const genericLinkTerms = new Set(["alarm", "fire", "detector", "monitor", "panel", "system", "provide", "install", "shall", "required", "including", "control"]);
const equipmentType = (text = "") => { const value = String(text).toLowerCase(); if (/\bptz\s+cameras?/.test(value)) return "PTZ Camera"; if (/(?:fixed|dome)\s+(?:network\s+ip\s+|ip\s+|megapixel\s+)?cameras?/.test(value)) return "Fixed Camera"; if (/card\s+reader|door\s+contact|door\s+(?:control|controller|hardware|interface)/.test(value)) return "Access Control Door Assembly"; if (/monitor(?:ing)?\s+(?:or\s+control\s+)?module|interface\s+module/.test(value)) return "Monitor Module"; if (/sounder/.test(value) && /strobe/.test(value)) return "Sounder Strobe"; if (/fire\s+alarm\s+(?:control\s+)?panel|building\s+fire\s+alarm\s+panel|repeater\s+panel/.test(value)) return "Fire Alarm Panel"; if (/duct\s+smoke\s+detector/.test(value)) return "Duct Smoke Detector"; if (/smoke\s+detector|photoelectric\s+(?:smoke\s+)?detector/.test(value)) return "Smoke Detector"; if (/sounder/.test(value)) return "Sounder"; if (/strobe/.test(value)) return "Strobe"; return "Unknown"; };
const functionalRoles = (text = "") => { const value = String(text).toLowerCase(); return [["Network", /network|online printer|event printer/], ["Alarm Verification", /alarm verification|confirm potential alarms/], ["Detection", /detect|smoke|photoelectric/], ["Monitoring", /monitor|input module/], ["Notification", /sounder|strobe|audible|visual alert/], ["Installation", /install|mount|wiring|connected/]].filter(([, pattern]) => pattern.test(value)).map(([role]) => role); };
export const scoreRequirementLink = ({ boqItem, requirement }) => {
  const evidence = []; let score = 0;
  const itemText = `${boqItem.description || ""} ${boqItem.system || ""} ${boqItem.category || ""}`.toLowerCase();
  const requirementText = `${requirement.originalText || ""} ${requirement.system || ""} ${requirement.category || ""}`.toLowerCase();
  const itemEquipment = equipmentType(itemText); const requirementEquipment = equipmentType(requirementText);
  if (boqItem.system && requirement.system && boqItem.system === requirement.system) { score += 8; evidence.push("Same engineering system (+8)"); }
  if (itemEquipment !== "Unknown" && requirementEquipment !== "Unknown") {
    if (itemEquipment === requirementEquipment || (itemEquipment === "Sounder Strobe" && ["Sounder", "Strobe"].includes(requirementEquipment))) { score += 48; evidence.push(`Equipment type: ${itemEquipment} (+48)`); }
    else { score -= 60; evidence.push(`Cross-equipment conflict: ${itemEquipment} vs ${requirementEquipment} (-60)`); }
  } else { evidence.push("Equipment type unresolved (+0)"); }
  const itemRoles = functionalRoles(itemText); const requirementRoles = functionalRoles(requirementText); const sharedRoles = itemRoles.filter((role) => requirementRoles.includes(role));
  if (sharedRoles.length) { score += Math.min(18, sharedRoles.length * 9); evidence.push(`Functional role: ${sharedRoles.join(", ")} (+${Math.min(18, sharedRoles.length * 9)})`); }
  if (boqItem.specificationReference && requirement.source?.clausePath?.join(" ").includes(boqItem.specificationReference)) { score += 30; evidence.push("Explicit section/clause reference (+30)"); }
  if (boqItem.category && requirement.category && boqItem.category === requirement.category && !["Other", "Unknown"].includes(boqItem.category)) { score += 10; evidence.push("Same technical category (+10)"); }
  const itemTerms = [...new Set(itemText.split(/[^a-z0-9]+/).filter((term) => term.length > 4 && !genericLinkTerms.has(term)))]; const technicalMatches = itemTerms.filter((term) => requirementText.includes(term));
  if (technicalMatches.length) { score += Math.min(12, technicalMatches.length * 4); evidence.push(`Technical attributes/context: ${technicalMatches.join(", ")} (+${Math.min(12, technicalMatches.length * 4)})`); }
  const confidence = clamp(score); const status = confidence >= 70 ? "Needs Review" : "Suggested";
  return { method: "Technical Applicability v2", confidence, evidence, status, assessment: confidence >= 70 ? "Applicable Candidate" : "Uncertain", itemEquipment, requirementEquipment };
};

export const validateRequirementLink = (link) => { if (!LINK_STATUSES.includes(link.status)) throw new KnowledgeIntegrityError("INVALID_LINK_STATUS", "Choose a controlled link status."); required(link.projectId, "LINK_PROJECT_REQUIRED", "A requirement link requires project scope."); required(link.boqItemId, "LINK_BOQ_REQUIRED", "A requirement link requires a BOQ item."); required(link.requirementId, "LINK_REQUIREMENT_REQUIRED", "A requirement link requires a requirement."); if (link.status === "Confirmed") { required(link.reviewedBy, "LINK_REVIEWER_REQUIRED", "A confirmed link requires a reviewer."); required(link.reviewReason, "LINK_REASON_REQUIRED", "A confirmed link requires a reason."); } return { ...link, confidence: clamp(link.confidence), evidence: Array.isArray(link.evidence) ? link.evidence : [] } };

export const assembleKnowledgeProfile = ({ boqItem, links, requirements, facts = [], conflicts = [], accessories = [], compatibility = [], decisions = [] }) => { const confirmedIds = new Set(links.filter((link) => link.status === "Confirmed").map((link) => link.requirementId)); const applicable = requirements.filter((requirement) => confirmedIds.has(requirement.id)); const applicableFacts = resolveScopedFacts(facts, { projectId: boqItem.projectId, boqItemId: boqItem.id }); return { boqItem, requirements: applicable, suggestedLinks: links.filter((link) => ["Suggested", "Needs Review"].includes(link.status)), standards: [...new Map(applicable.flatMap((requirement) => requirement.standards || []).map((standard) => [`${standard.body}|${standard.number}|${standard.part}`, standard])).values()], attributes: applicable.flatMap((requirement) => requirement.attributes || []), approvedManufacturers: applicable.flatMap((requirement) => requirement.manufacturers || []).filter((manufacturer) => manufacturer.status === "Approved"), accessories: accessories.filter((entry) => !entry.boqItemId || entry.boqItemId === boqItem.id), compatibility: compatibility.filter((entry) => !entry.boqItemId || entry.boqItemId === boqItem.id), facts: applicableFacts, conflicts: conflicts.filter((conflict) => !conflict.boqItemId || conflict.boqItemId === boqItem.id), decisions: decisions.filter((decision) => decision.entityId === boqItem.id || confirmedIds.has(decision.entityId)), readiness: { confirmedRequirements: applicable.length, suggestedRequirements: links.filter((link) => ["Suggested", "Needs Review"].includes(link.status)).length, blockingConflicts: conflicts.filter((conflict) => conflict.blocking && (!conflict.boqItemId || conflict.boqItemId === boqItem.id)).length, approvedForTask8: applicable.length > 0 && !conflicts.some((conflict) => conflict.blocking && (!conflict.boqItemId || conflict.boqItemId === boqItem.id)) } }; };
