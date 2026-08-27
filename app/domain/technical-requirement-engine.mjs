import { normalizeMeasurement } from "./engineering-knowledge.mjs";
import { buildRequirementIntelligence, REQUIREMENT_INTELLIGENCE_VERSION } from "./requirement-intelligence-engine.mjs";
import { requiresDetectorBase, requiresPanelCompatibility } from "./system-knowledge-registry.mjs";

export const REQUIREMENT_ENGINE_VERSION = "technical-requirement-engine-1.1.0";
// Sprint 1.14 -- bumped because detectMissingInformation's compatibilityTarget
// blocking rule changed (per-family now, not blanket for every Fire Alarm
// item). executeRequirementProfile's own idempotency check compares only
// input_fingerprint (boqItem+links+requirements+facts+relationships+this
// ruleset version), which does not otherwise change when the CODE's
// interpretation of unchanged input data changes -- a cached profile from
// before this fix would silently keep reporting the stale readiness
// forever without this bump forcing recomputation.
// Fire Alarm E2E fix (family-aware derived detector-base requirement) --
// bumped because generateDerivedRequirements' detector-base derivation
// changed (family/evidence-aware instead of a bare "detector" text match --
// see fireAlarmRequiresDetectorBase). executeRequirementProfile's own
// idempotency check compares only input_fingerprint (which folds in this
// version string), not the CODE'S interpretation of otherwise-unchanged
// input data -- a cached profile from before this fix would otherwise keep
// reporting the old, over-broad derived requirement forever. Matches the
// same reasoning as the prior Sprint 1.14 bump of this same constant.
export const REQUIREMENT_RULESET_VERSION = "requirement-rules-2026-08-27-detector-base";
export const REQUIREMENT_MODEL_VERSION = "deterministic-applicability-1.1.0";
export const APPLICABILITY_STATUSES = ["Confirmed Applicable", "Suggested Applicable", "Conditionally Applicable", "Not Applicable", "Rejected", "Needs Review", "Unknown", "Superseded"];
export const READINESS_STATUSES = ["Ready for Matching", "Ready with Warnings", "Needs Technical Review", "Missing Critical Information", "Conflict Blocking", "Classification Required", "Not Applicable", "Rejected"];
export const SOURCE_PRECEDENCE = { "Approved Clarification": 100, Addendum: 95, Specification: 90, Drawing: 80, BOQ: 70, "Approved Vendor List": 65, Manufacturer: 55, "Previous Project": 35, "Organization Rule": 30, "AI Inference": 10 };

const text = (value) => String(value ?? "").trim();
const normalized = (value) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const clamp = (value) => Math.max(0, Math.min(100, Math.round(Number(value || 0))));
const mean = (values) => values.length ? Math.round(values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length) : 0;
const keyOf = (requirement) => `${requirement.requirementCategory || requirement.category || "Other"}|${requirement.attributeName || normalized(requirement.normalizedRequirement || requirement.originalText)}`;

// Fire Alarm E2E fix (requirement applicability) -- real Central Kitchen -
// Makkah gap: "the entire fire detection system shall be analogue
// addressable type" is genuinely system-wide (it governs every device in
// the system, not one specific family), but the existing engineer-driven
// propagation path (worker/engineering-knowledge-api.mjs's
// /propagate-system-wide) requires the reviewer to hand-enumerate every
// governed category it applies to -- reasonable for a requirement that
// genuinely only concerns a few named categories, but a real, silent gap
// for wording that already states its own system-wide scope: nobody had
// reason to type out every Fire Alarm category by hand, so the requirement
// never reached Beam Detector, or any other family, at all.
//
// This is a narrow, structural, system-agnostic detector for that one
// wording shape -- "entire ... system" -- never a semantic judgement about
// WHICH categories are affected (that stays a human, governed decision
// downstream). It only ever WIDENS what a reviewer may explicitly opt into
// for an already-Approved requirement -- it never itself creates a link,
// confirms anything, or infers scope for a requirement that does not use
// this wording (a family-specific clause like "heat detector heads shall
// be..." never matches, so it still requires the existing explicit
// per-category selection, unchanged).
const SYSTEM_WIDE_REQUIREMENT_PATTERN = /\bentire\s+(?:\w+\s+){0,4}system\b/i;
export const isSystemWideRequirementText = (value) => SYSTEM_WIDE_REQUIREMENT_PATTERN.test(String(value || ""));

// Fire Alarm E2E fix (requirement applicability, follow-up) -- real Central
// Kitchen - Makkah gap: propagating "the entire fire detection system shall
// be analogue addressable type" to every governed category (via
// isSystemWideRequirementText above) correctly reached Beam Detector, but
// also reached Notification Devices (Sounder/Strobe/Flasher) -- and every
// single Notification Devices product in the catalog lacks any recorded
// `addressing` value, so the requirement blocked every candidate in that
// category outright. Notification appliances are wired on a conventional
// Notification Appliance Circuit even in a fully addressable/analog Fire
// Alarm system; they are never individually addressed the way an SLC-loop
// initiating/detection device is -- exactly the same real distinction
// system-knowledge-registry.mjs's requiresPanelCompatibility already
// encodes (Detection Devices / Manual Initiation / Modules and Interfaces /
// Control Equipment are addressable-loop, panel-protocol-locked categories;
// Notification Devices, Power and Batteries and Accessories are not). This
// reuses that same existing, already-governed classification -- it adds no
// new taxonomy and names no specific family -- to recognize when a
// system-wide requirement's OWN structured attributes concern addressable-
// loop participation, so allSystemCategories can be narrowed to the
// categories where that concept genuinely applies, the same way an
// explicit, hand-picked categories list already would be.
const LOOP_PARTICIPATION_ATTRIBUTES = new Set(["addressing", "protocol", "compatible_panel_family", "loop_compatibility"]);
export const requirementConstrainsLoopParticipation = (attributeNames) => (Array.isArray(attributeNames) ? attributeNames : []).some((name) => LOOP_PARTICIPATION_ATTRIBUTES.has(String(name || "").trim()));
export const loopParticipationCategories = (system, categories) => (Array.isArray(categories) ? categories : []).filter((category) => requiresPanelCompatibility(system, category, null));

export const requirementPriority = (requirement) => {
  if (requirement.ambiguities?.length) return "Clarification Required";
  if (requirement.requirementType === "Prohibited") return "Prohibited";
  if (requirement.factType === "Derived Fact") return "Derived";
  if (requirement.factType === "Assumption") return "Assumed";
  if (requirement.requirementType === "Conditional") return "Conditional Mandatory";
  if (requirement.requirementType === "Preferred") return "Preferred";
  if (requirement.requirementType === "Optional") return "Optional";
  if (requirement.requirementType === "Mandatory" && (requirement.safetyCritical || ["Voltage", "Compatibility", "Standards", "Capacity"].includes(requirement.requirementCategory))) return "Critical Mandatory";
  return requirement.requirementType === "Mandatory" ? "Mandatory" : "Informational";
};

export const resolveApplicability = ({ boqItem, link, requirement }) => {
  if (link?.status === "Confirmed") return { status: "Confirmed Applicable", method: "Human-confirmed knowledge link", confidence: 100, evidence: link.evidence || [], reviewStatus: "Confirmed" };
  if (["Rejected", "Removed"].includes(link?.status)) return { status: "Rejected", method: "Human review", confidence: 100, evidence: link.evidence || [], reviewStatus: "Reviewed" };
  let confidence = Number(link?.confidence || 0); const evidence = [...(link?.evidence || [])];
  if (boqItem.system && requirement.system && boqItem.system === requirement.system) { confidence += 20; evidence.push("System matches"); }
  if (boqItem.category && requirement.category && boqItem.category === requirement.category) { confidence += 20; evidence.push("Category matches"); }
  if (boqItem.specificationReference && requirement.source?.clausePath?.join(" ").includes(boqItem.specificationReference)) { confidence += 30; evidence.push("Explicit specification reference"); }
  confidence = clamp(confidence);
  const conditional = requirement.requirementType === "Conditional" || Boolean(requirement.condition);
  return { status: conditional ? "Conditionally Applicable" : confidence >= 70 ? "Suggested Applicable" : confidence >= 40 ? "Needs Review" : "Unknown", method: link?.linkMethod || "Deterministic structured signals", confidence, evidence: [...new Set(evidence)], reviewStatus: "Needs Review" };
};

export const consolidateRequirements = (requirements, precedence = SOURCE_PRECEDENCE) => {
  const groups = new Map();
  for (const requirement of requirements) { const key = keyOf(requirement); const current = groups.get(key) || []; current.push(requirement); groups.set(key, current); }
  return [...groups.entries()].map(([key, sources]) => { const ordered = [...sources].sort((left, right) => (precedence[right.sourceType] || 0) - (precedence[left.sourceType] || 0)); const governing = ordered[0]; return { id: `consolidated:${key}`, key, normalizedRequirement: governing.normalizedRequirement || governing.originalText, requirementCategory: governing.requirementCategory || governing.category, requirementType: governing.requirementType, priority: requirementPriority(governing), governingSourceId: governing.id, sources: ordered.map((entry) => ({ requirementId: entry.id, sourceType: entry.sourceType, source: entry.source, confidence: entry.confidence })), attributes: ordered.flatMap((entry) => entry.attributes || []), standards: ordered.flatMap((entry) => entry.standards || []), manufacturers: ordered.flatMap((entry) => entry.manufacturers || []), compatibility: ordered.flatMap((entry) => entry.compatibility || []), accessories: ordered.flatMap((entry) => entry.accessories || []), confidence: mean(ordered.map((entry) => entry.confidence)) }; });
};

// detectRequirementConflicts only compares attributes WITHIN one consolidated
// group (one governing requirement text). Approved facts promoted from
// different specification clauses/requirements for the same BOQ item land in
// different groups, so a same-name/different-value collision across sources
// must be caught separately -- never silently resolved by picking one.
export const detectAttributeValueConflicts = (consolidated) => {
  const byName = new Map();
  for (const group of consolidated) for (const attribute of group.attributes) { const list = byName.get(attribute.name) || []; list.push({ attribute, groupId: group.id }); byName.set(attribute.name, list); }
  const conflicts = [];
  for (const [name, entries] of byName) {
    if (new Set(entries.map((entry) => entry.groupId)).size < 2) continue;
    const distinctValues = new Map();
    for (const entry of entries) { const key = JSON.stringify(entry.attribute.normalizedValue); if (!distinctValues.has(key)) distinctValues.set(key, entry.attribute); }
    if (distinctValues.size < 2) continue;
    const values = [...distinctValues.values()];
    conflicts.push({ id: `attribute-conflict:${name}`, type: "Cross-Requirement Attribute Conflict", requirementId: null, attribute: name, values: values.map((attribute) => ({ value: attribute.normalizedValue, unit: attribute.normalizedUnit, source: attribute.source })), severity: "High", technicalImpact: `${name} has conflicting approved values from different specification sources; it cannot be used to discriminate products until the governing source is confirmed.`, commercialImpact: "Product scope or supplier price may change.", blocking: true, recommendedAction: "Review the conflicting sources and record which requirement governs.", resolutionStatus: "Open" });
  }
  return conflicts;
};

export const detectRequirementConflicts = (consolidated) => {
  const conflicts = [];
  for (const group of consolidated) {
    const byName = new Map();
    for (const attribute of group.attributes) { const list = byName.get(attribute.name) || []; list.push(attribute); byName.set(attribute.name, list); }
    for (const [name, attributes] of byName) { const values = [...new Set(attributes.map((attribute) => JSON.stringify(attribute.normalizedValue)))]; if (values.length < 2) continue; const critical = ["Voltage", "Capacity"].includes(name); conflicts.push({ id: `conflict:${group.id}:${name}`, type: "Required Value Conflict", requirementId: group.id, attribute: name, values: attributes.map((attribute) => ({ value: attribute.normalizedValue, unit: attribute.normalizedUnit, source: attribute.source })), severity: critical ? "Critical" : "High", technicalImpact: `${name} cannot be used safely for product matching until the governing source is confirmed.`, commercialImpact: "Product scope or supplier price may change.", blocking: true, recommendedAction: "Review source precedence and obtain an approved clarification.", resolutionStatus: "Open" }); }
  }
  return conflicts;
};

const categoryMinimums = { "Fire Alarm": ["system", "category", "description", "unit", "quantity", "productFamily", "standard", "compatibilityTarget"], CCTV: ["system", "category", "description", "unit", "quantity", "productFamily", "ipRating", "voltage"], UPS: ["system", "category", "description", "unit", "quantity", "productFamily", "power", "runtime"] };
// Sprint 1.14 -- compatibilityTarget was blocking for every Fire Alarm item
// uniformly, regardless of family -- see fire-alarm-taxonomy.mjs's
// fireAlarmRequiresPanelCompatibility for the real manufacturer/system-
// selection reasoning (addressable-loop devices are panel-protocol-locked;
// conventional notification appliances generally are not). Its absence is
// still reported for every Fire Alarm item (it remains useful context), but
// it only BLOCKS readiness for a family where the system pack says panel/
// loop compatibility is a genuine selection constraint. A system with no
// registered pack, or one with no opinion, keeps the prior behavior exactly
// (blocking, via the static list) rather than silently becoming lenient.
const blockingFields = (boqItem, field) => {
  if (field !== "compatibilityTarget") return ["system", "category", "description", "productFamily"].includes(field);
  return requiresPanelCompatibility(boqItem.system, boqItem.category, boqItem.productFamily);
};
export const detectMissingInformation = ({ boqItem, consolidated, standards, compatibility }) => {
  const system = boqItem.system || "Unknown"; const fields = categoryMinimums[system] || ["system", "category", "description", "unit", "quantity", "productFamily"];
  const context = { system: boqItem.system, category: boqItem.category, description: boqItem.description, unit: boqItem.unit, quantity: boqItem.quantity, productFamily: boqItem.productFamily, standard: standards.length ? true : null, compatibilityTarget: compatibility.some((item) => item.targetItem || item.rightEntityId) ? true : null, ipRating: consolidated.some((item) => item.attributes.some((attribute) => attribute.name === "IP Rating")), voltage: consolidated.some((item) => item.attributes.some((attribute) => attribute.name === "Voltage")), power: consolidated.some((item) => item.attributes.some((attribute) => attribute.name === "Power")), runtime: consolidated.some((item) => item.attributes.some((attribute) => /runtime/i.test(attribute.name))) };
  return fields.filter((field) => context[field] === null || context[field] === undefined || context[field] === "" || context[field] === false).map((field) => ({ field, whyNeeded: `${field} is required to define a safe ${system} product search boundary.`, technicalImpact: "Compliance or compatibility cannot be evaluated deterministically.", commercialImpact: "Supplier scope and cost may vary.", blocking: blockingFields(boqItem, field), clarificationQuestion: `Please confirm the ${field.replace(/([A-Z])/g, " $1").toLowerCase()} for BOQ item ${boqItem.itemNumber || boqItem.id}, citing the governing document.`, recommendedOwner: field === "quantity" ? "Estimator" : "Technical Reviewer", status: "Open" }));
};

export const generateDerivedRequirements = ({ boqItem, consolidated }) => {
  const derived = [];
  // Fire Alarm E2E fix (family-aware derived detector-base requirement) --
  // real Central Kitchen - Makkah gap: this used to derive a mandatory
  // "compatible detector base" purely from the word "detector" appearing in
  // the BOQ description text, wrongly penalizing Beam Detector (a
  // bracket-mounted, line-of-sight optical device with no plug-in base --
  // see fire-alarm-taxonomy.mjs's fireAlarmRequiresDetectorBase for the real
  // catalog evidence this is grounded in). The requirement now derives only
  // when EITHER the item's own governed family is proven (by real Product
  // Library accessory evidence) to use base-mount architecture, OR a real,
  // confirmed project requirement for this specific item explicitly states
  // a base is needed regardless of family default -- an opt-in, evidence-led
  // check, never a text-only assumption. A family with no governed opinion
  // (an unregistered system, or a Fire Alarm family not in the proven list)
  // never gets this derived requirement by default.
  const familyRequiresBase = requiresDetectorBase(boqItem.system, boqItem.productFamily);
  const explicitProjectBaseEvidence = consolidated.some((item) => /\bbase\b/i.test(item.normalizedRequirement || ""));
  if ((familyRequiresBase || explicitProjectBaseEvidence) && !consolidated.some((item) => item.accessories.some((accessory) => /base/i.test(accessory.accessory)))) derived.push({ id: `derived:${boqItem.id}:detector-base`, statement: "A compatible detector base is required for each detector unless the approved product includes one.", ruleId: "accessory.detector-base", inputs: [{ boqItemId: boqItem.id, description: boqItem.description }], logic: familyRequiresBase ? "This detector family's governed product architecture uses a separate plug-in mounting base." : "A confirmed project requirement for this item explicitly states a compatible base is needed.", output: { accessory: "Compatible detector base", quantityRule: "One per detector" }, factType: "Derived Fact", confidence: 75, reviewStatus: "Needs Review" });
  if (/outdoor/i.test(boqItem.description || "") && !consolidated.some((item) => item.attributes.some((attribute) => attribute.name === "IP Rating"))) derived.push({ id: `derived:${boqItem.id}:weather`, statement: "Outdoor equipment requires a project-confirmed environmental protection rating.", ruleId: "environment.outdoor-protection", inputs: [{ boqItemId: boqItem.id, environment: "Outdoor" }], logic: "Outdoor location requires measurable weather protection; no rating is invented.", output: { missingAttribute: "IP Rating" }, factType: "Derived Fact", confidence: 85, reviewStatus: "Needs Review" });
  return derived;
};

export const createAssumptions = (missing, boqItem) => missing.filter((item) => !item.blocking).map((item) => ({ id: `assumption:${boqItem.id}:${item.field}`, statement: `Proposed working assumption required for ${item.field}; no value has been selected.`, reason: item.whyNeeded, sourceGap: item.field, technicalRisk: item.technicalImpact, commercialRisk: item.commercialImpact, confidence: 0, approvalRequired: true, reviewCondition: "Expires when source evidence or an approved clarification is recorded.", status: "Proposed" }));

export const calculateReadiness = ({ boqItem, requirements, missing, conflicts, confidence }) => {
  if (!boqItem.system || !boqItem.category) return { status: "Classification Required", blockingReasons: ["System and category must be confirmed."], approved: false };
  if (conflicts.some((item) => item.blocking)) return { status: "Conflict Blocking", blockingReasons: conflicts.filter((item) => item.blocking).map((item) => item.technicalImpact), approved: false };
  if (missing.some((item) => item.blocking)) return { status: "Missing Critical Information", blockingReasons: missing.filter((item) => item.blocking).map((item) => item.whyNeeded), approved: false };
  if (!requirements.some((item) => ["Critical Mandatory", "Mandatory"].includes(item.priority))) return { status: "Needs Technical Review", blockingReasons: ["No confirmed mandatory technical baseline exists."], approved: false };
  if (confidence.overall < 80) return { status: "Ready with Warnings", blockingReasons: ["Requirement profile confidence is below 80%."], approved: false };
  return { status: "Ready for Matching", blockingReasons: [], approved: false, approvalRequired: true };
};

export const buildTechnicalRequirementProfile = ({ boqItem, links = [], requirements = [], knowledgeFacts = [], relationships = [], projectPrecedence = SOURCE_PRECEDENCE, previousVersion = 0 }) => {
  const applicable = requirements.map((requirement) => { const link = links.find((entry) => entry.requirementId === requirement.id); const applicability = resolveApplicability({ boqItem, link, requirement }); return { ...requirement, applicability, priority: requirementPriority(requirement) }; }).filter((requirement) => !["Rejected", "Not Applicable", "Unknown"].includes(requirement.applicability.status));
  const confirmed = applicable.filter((requirement) => requirement.applicability.status === "Confirmed Applicable"); const suggested = applicable.filter((requirement) => requirement.applicability.status !== "Confirmed Applicable");
  const intelligence = buildRequirementIntelligence(confirmed);
  const requirementRelationships = relationships.filter((item) => {
    const scopeType = item.scopeType || item.scope_type || null;
    const scopeId = item.scopeId || item.scope_id || null;
    if (scopeType === "Product") return false;
    if (scopeType === "BOQ Item") return scopeId === boqItem.id;
    return scopeType === "Project" || scopeType === "Global" || !scopeType;
  });
  const consolidated = consolidateRequirements(confirmed, projectPrecedence); const conflicts = [...detectRequirementConflicts(consolidated), ...detectAttributeValueConflicts(consolidated)]; const standards = consolidated.flatMap((item) => item.standards); const manufacturers = consolidated.flatMap((item) => item.manufacturers); const compatibility = [...consolidated.flatMap((item) => item.compatibility), ...requirementRelationships.filter((item) => /compatible|interface|protocol/i.test(item.relationshipType || ""))]; const accessories = [...consolidated.flatMap((item) => item.accessories), ...requirementRelationships.filter((item) => /requires|includes|mounted|installed/i.test(item.relationshipType || ""))]; const missing = detectMissingInformation({ boqItem, consolidated, standards, compatibility }); const derived = generateDerivedRequirements({ boqItem, consolidated }); const assumptions = createAssumptions(missing, boqItem);
  const confidence = { itemClassification: clamp(boqItem.classificationConfidence), requirementExtraction: mean(confirmed.map((item) => item.confidence)), applicability: mean(confirmed.map((item) => item.applicability.confidence)), attributeCompleteness: clamp(100 - missing.length * 12), standards: standards.length ? mean(standards.map((item) => item.confidence || 70)) : 0, compatibility: compatibility.length ? mean(compatibility.map((item) => item.confidence || 70)) : 0, accessories: accessories.length ? mean(accessories.map((item) => item.confidence || 70)) : 0 }; confidence.overall = Math.min(...Object.values(confidence));
  const readiness = calculateReadiness({ boqItem, requirements: consolidated, missing, conflicts, confidence });
  return { engineVersion: REQUIREMENT_ENGINE_VERSION, rulesetVersion: REQUIREMENT_RULESET_VERSION, modelVersion: REQUIREMENT_MODEL_VERSION, intelligenceVersion: REQUIREMENT_INTELLIGENCE_VERSION, versionNumber: previousVersion + 1, boqItem, applicableRequirements: confirmed, suggestedRequirements: suggested, consolidatedRequirements: consolidated, intelligence, standards, manufacturers, compatibility, accessories, derivedRequirements: derived, assumptions, missingInformation: missing, conflicts, clarifications: [...missing.map((item) => ({ question: item.clarificationQuestion, reason: item.whyNeeded, impact: `${item.technicalImpact} ${item.commercialImpact}`, priority: item.blocking ? "High" : "Medium", suggestedRecipient: item.recommendedOwner, status: "Open", relatedField: item.field })), ...conflicts.map((item) => ({ question: `Please confirm the governing ${item.attribute} requirement and applicable source revision.`, reason: item.type, impact: `${item.technicalImpact} ${item.commercialImpact}`, priority: item.severity, suggestedRecipient: "Consultant / Technical Authority", status: "Open", conflictId: item.id }))], knowledgeFacts, confidence, readiness, explanation: `This BOQ item is classified as ${boqItem.category || "an unconfirmed category"} under ${boqItem.system || "an unconfirmed system"}. ${confirmed.length} requirement source${confirmed.length === 1 ? " is" : "s are"} confirmed applicable. Matching readiness is ${readiness.status.toLowerCase()}${readiness.blockingReasons.length ? ` because ${readiness.blockingReasons[0]}` : "."}`, generatedAt: new Date().toISOString() };
};

export const normalizeProfileAttribute = (attribute) => attribute.originalUnit ? { ...attribute, normalization: normalizeMeasurement({ value: attribute.parsedValue, unit: attribute.originalUnit, targetUnit: attribute.normalizedUnit || undefined }) } : attribute;
