export const DISCOVERY_ENGINE_VERSION = "engineering-discovery-1.0.0";

export const ENGINEERING_FACT_TYPES = [
  "Equipment Category", "Device Type", "Product Family", "Manufacturer", "Model", "Series", "Voltage", "Current", "Battery", "Power Supply", "Load", "Cable",
  "Addressability", "Protocol", "Loop", "Node", "Network", "Topology", "Certification", "Standard", "Price", "Currency", "Supplier", "Lead Time", "Warranty",
  "Environment", "Mounting", "Environmental Rating", "Temperature", "Dependency", "Interface", "Accessory", "Compatibility", "Required Module",
];

const norm = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const keyValue = (value) => norm(typeof value === "string" ? value : JSON.stringify(value)).toLowerCase();
const stable = (items) => items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const unique = (items) => items.filter((item, index, all) => all.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(item)) === index);

export const buildEngineeringDiscovery = ({ projectId, sources, observations, requiredFacts = ENGINEERING_FACT_TYPES, previousVersion = 0 }) => {
  const indexedSources = stable(sources.map((source) => ({ sourceId: source.sourceId, sourceType: source.sourceType, sourceFile: source.sourceFile || null, documentId: source.documentId || null, checksum: source.checksum || null, status: source.status || "Indexed Only" })));
  const exhaustive = indexedSources.length > 0 && indexedSources.every((source) => ["Searched", "Search Completed"].includes(source.status));
  const valid = observations.filter((item) => item.value !== null && item.value !== undefined && norm(item.value) && item.evidence && item.sourceId);
  const groups = new Map();
  for (const item of valid) { const key = item.factType; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item); }
  const facts = []; const conflicts = [];
  for (const [factType, entries] of groups) {
    const values = new Map(); for (const entry of entries) { const valueKey = keyValue(entry.value); if (!values.has(valueKey)) values.set(valueKey, []); values.get(valueKey).push(entry); }
    if (values.size > 1) conflicts.push({ conflictType: "Contradictory Engineering Fact", factType, evidenceSets: stable([...values.entries()].map(([value, evidence]) => ({ value, evidence: evidence.map((entry) => ({ sourceId: entry.sourceId, sourceFile: entry.sourceFile, documentId: entry.documentId, page: entry.page, paragraph: entry.paragraph, drawingReference: entry.drawingReference, supportingText: entry.supportingText })) }))), confidence: Math.max(...entries.map((entry) => Number(entry.confidence || 0))), requiredClarification: `Resolve conflicting evidence for ${factType}.`, reviewStatus: "Needs Review" });
    for (const [valueKey, evidenceEntries] of values) {
      const sourceCount = new Set(evidenceEntries.map((entry) => entry.sourceId)).size;
      const average = Math.round(evidenceEntries.reduce((sum, entry) => sum + Number(entry.confidence || 0), 0) / evidenceEntries.length);
      const confidence = Math.min(99, average + Math.min(15, Math.max(0, sourceCount - 1) * 5));
      facts.push({ factType, value: evidenceEntries[0].value, confidence, supportingSources: sourceCount, conflictingSources: values.size > 1 ? entries.length - evidenceEntries.length : 0, evidenceStrength: sourceCount >= 3 ? "Strong" : sourceCount === 2 ? "Corroborated" : "Single Source", evidence: stable(evidenceEntries.map((entry) => ({ sourceId: entry.sourceId, sourceFile: entry.sourceFile || null, documentId: entry.documentId || null, page: entry.page || null, paragraph: entry.paragraph || null, drawingReference: entry.drawingReference || null, extractionMethod: entry.extractionMethod, supportingText: entry.supportingText }))), reviewStatus: values.size > 1 ? "Conflicted" : "Unknown", normalizedValue: valueKey });
    }
  }
  const discoveredTypes = new Set(facts.filter((fact) => fact.reviewStatus !== "Conflicted").map((fact) => fact.factType));
  const gaps = requiredFacts.filter((factType) => !discoveredTypes.has(factType)).map((factType) => ({ factType, confidence: 0, reason: `No supporting evidence found after searching ${indexedSources.length} indexed sources.`, evidenceSearched: indexedSources.map((source) => source.sourceId), matchingImpact: ["Price", "Currency", "Supplier", "Lead Time", "Warranty"].includes(factType) ? "No direct technical matching impact." : `${factType} cannot constrain product selection.`, pricingImpact: ["Price", "Currency", "Supplier", "Lead Time", "Warranty", "Accessory", "Required Module", "Battery", "Power Supply"].includes(factType) ? `${factType} is required for complete, current costing.` : "May change product scope and cost.", approvalImpact: `${factType} remains unsupported and cannot be technically approved.`, status: "Open" }));
  const clarifications = exhaustive ? gaps.map((gap) => ({ question: `Provide governing evidence for ${gap.factType}.`, reason: gap.reason, evidenceSearched: gap.evidenceSearched, missingEngineeringFact: gap.factType, matchingImpact: gap.matchingImpact, pricingImpact: gap.pricingImpact, technicalApprovalImpact: gap.approvalImpact, status: "Proposed After Exhaustive Search" })) : [];
  return { projectId, engineVersion: DISCOVERY_ENGINE_VERSION, versionNumber: previousVersion + 1, indexedSources, facts: stable(facts), conflicts: stable(conflicts), gaps: stable(gaps), clarifications: stable(clarifications), sourceCount: indexedSources.length, observationCount: valid.length, exhaustive, pendingSourceSearches: indexedSources.filter((source) => !["Searched", "Search Completed"].includes(source.status)), autoApproved: false };
};
