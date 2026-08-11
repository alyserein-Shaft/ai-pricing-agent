export const ENGINEERING_GRAPH_ENGINE_VERSION = "engineering-graph-1.0.0";

export const RELATIONSHIP_TYPES = ["REQUIRES", "COMPATIBLE_WITH", "OPTIONAL_WITH", "INCOMPATIBLE_WITH", "REPLACES", "SUPERSEDES", "DEPENDS_ON", "CONNECTS_TO", "ALLOWS", "PROHIBITS", "BELONGS_TO", "DERIVED_FROM", "EVIDENCED_BY"];

const TYPE_MAP = {
  "Equipment Category": "Equipment Category", "Product Family": "Product Family", "Device Type": "Device Type",
  "Functional Classification": "Functional Role", "System Architecture": "Fire Alarm System Type",
  "Addressable / Conventional": "Addressability", "Protocol Classification": "Protocol",
  "Standards Readiness": "Standard", "Certification Readiness": "Certification",
  "Environmental Classification": "Environmental Rating", "Electrical Classification": "Electrical Characteristic",
  "Network Classification": "Network Characteristic", "Installation Classification": "Installation Context",
  "Compatibility Readiness": "Technical Constraint", "Accessories Readiness": "Accessory Constraint",
};
const FACT_NODE_TYPES = {
  "Mounting Method": "Mounting Type", "Loop Requirements": "Loop Characteristic", "Required Accessories": "Required Accessory",
  "Optional Features": "Optional Accessory", "Compatible Accessories": "Optional Accessory", "Compatible Base": "Compatible Base",
  "Compatible Module": "Compatible Module", "Compatible Panel": "Compatible Panel", "Manufacturer Constraints": "Manufacturer Constraint",
  "Brand Restrictions": "Brand Constraint", "Technical Dependencies": "Technical Constraint", "Conflicting Requirements": "Conflict",
};
const array = (value) => Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
const scalarKey = (value) => JSON.stringify(value, Object.keys(value || {}).sort());
const evidenceFor = (source) => array(source.evidence).map((entry) => ({ factId: entry.factId, requirementId: entry.requirementId, page: entry.page, clause: entry.clause, section: entry.section, evidenceSnippet: entry.evidenceSnippet })).filter((entry) => entry.factId || entry.evidenceSnippet);
const stable = (items) => items.sort((a, b) => scalarKey(a).localeCompare(scalarKey(b)));

export const buildEngineeringKnowledgeGraph = ({ profile, decisions, facts = [], previousVersion = 0 }) => {
  const approved = decisions.filter((entry) => entry.reviewStatus === "Approved");
  const approvedFacts = facts.filter((entry) => entry.reviewStatus === "Approved");
  const nodes = new Map(); const relationships = new Map();
  const addNode = (nodeType, label, source = null) => {
    const normalized = String(label ?? "").trim(); if (!normalized) return null;
    const key = `${nodeType}|${normalized.toLowerCase()}`;
    if (!nodes.has(key)) nodes.set(key, { key, nodeType, label: normalized, properties: {}, provenance: source ? evidenceFor(source) : [], reviewStatus: "Needs Review" });
    else if (source) nodes.get(key).provenance = stable([...nodes.get(key).provenance, ...evidenceFor(source)].filter((entry, index, all) => all.findIndex((candidate) => scalarKey(candidate) === scalarKey(entry)) === index));
    return key;
  };
  const profileKey = addNode("Requirement Profile", `Requirement Profile ${profile.boqItemId}`);
  const addRelationship = (fromKey, toKey, relationshipType, source, basis) => {
    if (!fromKey || !toKey || !RELATIONSHIP_TYPES.includes(relationshipType)) return;
    const evidence = evidenceFor(source); if (!evidence.length) return;
    const key = `${fromKey}|${relationshipType}|${toKey}`;
    relationships.set(key, { key, fromKey, toKey, relationshipType, confidence: Number(source.confidence || 0), provenance: evidence, basis, reviewStatus: "Needs Review" });
  };
  for (const entry of approved) for (const value of array(entry.value)) {
    if (typeof value === "object") continue;
    const nodeKey = addNode(TYPE_MAP[entry.classificationType] || "Technical Constraint", value, entry);
    addRelationship(profileKey, nodeKey, "BELONGS_TO", entry, `Approved ${entry.classificationType} decision`);
  }
  for (const entry of approvedFacts) {
    const nodeType = FACT_NODE_TYPES[entry.factType]; if (!nodeType) continue;
    for (const value of array(entry.value)) {
      if (typeof value === "object") continue;
      const nodeKey = addNode(nodeType, value, { ...entry, evidence: [{ factId: entry.id, requirementId: entry.requirementId, page: entry.sourcePage, clause: entry.sourceClause, section: entry.sourceSection, evidenceSnippet: entry.evidenceSnippet }] });
      const relationshipType = entry.factType === "Required Accessories" ? "REQUIRES" : entry.factType === "Optional Features" || entry.factType === "Compatible Accessories" ? "OPTIONAL_WITH" : entry.factType === "Technical Dependencies" ? "DEPENDS_ON" : entry.factType === "Conflicting Requirements" ? "INCOMPATIBLE_WITH" : "BELONGS_TO";
      addRelationship(profileKey, nodeKey, relationshipType, { ...entry, evidence: [{ factId: entry.id, requirementId: entry.requirementId, page: entry.sourcePage, clause: entry.sourceClause, section: entry.sourceSection, evidenceSnippet: entry.evidenceSnippet }] }, `Approved ${entry.factType} fact`);
    }
  }
  const missingRelationships = [];
  for (const type of ["COMPATIBLE_WITH", "REQUIRES", "CONNECTS_TO", "EVIDENCED_BY"]) if (![...relationships.values()].some((entry) => entry.relationshipType === type)) missingRelationships.push({ relationshipType: type, reason: "No approved explicit evidence supports this relationship." });
  const conflicts = [...nodes.values()].filter((entry) => entry.nodeType === "Conflict").map((entry) => ({ nodeKey: entry.key, label: entry.label }));
  const engineeringRisks = missingRelationships.filter((entry) => ["COMPATIBLE_WITH", "REQUIRES"].includes(entry.relationshipType)).map((entry) => ({ area: entry.relationshipType, severity: "High", risk: entry.reason }));
  return { engineVersion: ENGINEERING_GRAPH_ENGINE_VERSION, versionNumber: previousVersion + 1, nodes: stable([...nodes.values()]), relationships: stable([...relationships.values()]), missingRelationships, conflicts, engineeringRisks, sourceDecisionCount: approved.length, sourceFactCount: approvedFacts.length };
};
