export const CASE_STUDY_ENGINE_VERSION = "case-study-foundation-v2";
export const HISTORICAL_COMPLETENESS_VERSION = "historical-completeness-v1";
export const KNOWLEDGE_LAYERS = ["Project Evidence", "Reviewed Project Knowledge", "Reusable Company Knowledge"];
export const KNOWLEDGE_CLASSIFICATIONS = ["Project-specific fact","Historical observation","Engineering rule","Manufacturer rule","Supplier observation","Pricing precedent","Matching precedent","Clarification pattern","Error pattern","Approved reusable knowledge","Non-reusable project exception"];

const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
export const stableStringify = (value) => JSON.stringify(stable(value));
export const normalizedSignal = (value) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g," ").trim();

export function computeCompleteness(inventory = [], groundTruth = []) {
  const required = ["BOQ","Specification","Drawing","Supplier Quotation","Final Quotation","Approval Record","Final Product Selection"];
  const present = new Set(inventory.filter((source) => source.completenessState === "Available").map((source) => source.sourceType));
  const sourceCompleteness = Math.round(required.filter((type) => present.has(type)).length / required.length * 100);
  const truthFields = ["Selected Product","Quantity","Technical Approval","Final Cost","Final Selling Price","Supplier Source"];
  const supported = new Set(groundTruth.filter((record) => record.provenance?.sourceDocumentId && record.originalValue !== null && record.originalValue !== "").map((record) => record.recordType));
  return { sourceCompleteness, groundTruthCompleteness: Math.round(truthFields.filter((type) => supported.has(type)).length / truthFields.length * 100) };
}

const asObject = (value) => {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(value || "{}"); } catch { return {}; }
};
const hasValue = (value) => value !== null && value !== undefined && value !== "";
const normalizedType = (value) => normalizedSignal(value);
const percent = (checks) => {
  const applicable = checks.filter((check) => check.applicable !== false);
  return applicable.length
    ? Math.round(applicable.filter((check) => check.present).length / applicable.length * 100)
    : null;
};
const dimension = (name, checks) => ({
  name,
  score: percent(checks),
  present: checks.filter((check) => check.applicable !== false && check.present).map((check) => check.label),
  missing: checks.filter((check) => check.applicable !== false && !check.present).map((check) => check.label),
  nonApplicable: checks.filter((check) => check.applicable === false).map((check) => check.label),
});

export function deriveLearningReadiness({ sources = [], groundTruth = [], knowledge = [], reusableReviewRequested = false } = {}) {
  if (!sources.length && !groundTruth.length && !knowledge.length) return "Insufficient Evidence";
  if (!knowledge.length) return "Evidence Captured";
  const active = knowledge.filter((item) => !item.superseded_at && !item.supersededAt);
  const approved = active.filter((item) => (item.review_state || item.reviewState) === "Approved").length;
  const pending = active.filter((item) => (item.review_state || item.reviewState) === "Needs Review").length;
  if (pending === active.length) return "Needs Engineering Review";
  if (approved > 0 && pending > 0) return "Partially Reviewed";
  if (pending > 0) return "Needs Engineering Review";
  if (reusableReviewRequested && approved === active.length && active.length > 0) return "Eligible for Reusable Knowledge Review";
  return "Reviewed for Learning";
}

export function computeHistoricalCompleteness({ snapshot = {}, sources = [], groundTruth = [], knowledge = [] } = {}) {
  const sourceRows = sources.map((source) => ({ ...source, provenanceObject: asObject(source.provenance) }));
  const truthRows = groundTruth.map((record) => ({
    ...record,
    type: normalizedType(record.record_type || record.recordType),
    original: asObject(record.original_value ?? record.originalValue),
    provenanceObject: asObject(record.provenance),
  }));
  const knowledgeRows = knowledge.map((item) => ({
    ...item,
    classificationValue: item.classification || "",
    evidenceObject: asObject(item.evidence),
  }));
  const sourceTypes = sourceRows.map((source) => normalizedType(source.source_type || source.sourceType));
  const truthTypes = new Set(truthRows.map((record) => record.type));
  const classifications = new Set(knowledgeRows.map((item) => normalizedType(item.classificationValue)));
  const availableSources = sourceRows.filter((source) => (source.completeness_state || source.completenessState) === "Available");
  const historicalScope = snapshot?.governance?.historicalOnly === true || sourceRows.some((source) => source.provenanceObject.historicalOnly === true);
  const hasComponentRecords = ["passive component", "active huawei addition", "rack or service", "selected product"].some((type) => truthTypes.has(type));
  const hasQuantityRelationships = truthTypes.has("quantity relationship") || truthTypes.has("quantity");
  const hasRfqFinal = truthTypes.has("rfq to final change");
  const hasTechnicalRecords = hasComponentRecords || hasQuantityRelationships || hasRfqFinal;
  const commercialApplicable = sourceTypes.some((type) => /quotation|supplier|commercial|rfq/.test(type)) || truthRows.some((record) => /price|cost|selling|supplier|commercial/.test(record.type));
  const hasSupplier = truthRows.some((record) => /supplier source|supplier price/.test(record.type)) || classifications.has("supplier observation");
  const hasCost = truthRows.some((record) => /final cost|purchase cost|supplier price/.test(record.type));
  const hasSelling = truthRows.some((record) => /final selling price|selling price/.test(record.type));
  const hasCommercialChange = truthRows.some((record) => /commercial/.test(record.type) || (record.type === "rfq to final change" && /price|cost|discount|margin|commercial/.test(JSON.stringify(record.original).toLowerCase())));
  const hasRules = knowledgeRows.some((item) => /rule/.test(normalizedType(item.classificationValue)));
  const hasExceptions = classifications.has("non reusable project exception") || classifications.has("error pattern");
  const hasReviewQueue = classifications.has("clarification pattern");
  const dimensions = {
    evidenceCoverage: dimension("Evidence Coverage", [
      { label: "Available historical evidence sources", present: availableSources.length > 0 },
      { label: "Identified source types", present: sourceRows.length > 0 && sourceRows.every((source) => normalizedType(source.source_type || source.sourceType).length > 0) },
      { label: "Source checksums retained", present: sourceRows.length > 0 && sourceRows.every((source) => hasValue(source.checksum) || hasValue(source.provenanceObject.sha256)) },
      { label: "Source context retained", present: sourceRows.length > 0 && sourceRows.every((source) => hasValue(source.provenanceObject.fileName) && hasValue(source.provenanceObject.sheet) && hasValue(source.provenanceObject.row)) },
      { label: "Historical evidence scope declared", present: historicalScope },
    ]),
    technicalGroundTruthCoverage: dimension("Technical Ground Truth Coverage", [
      { label: "Historical component or product identities", present: hasComponentRecords },
      { label: "Quantity evidence or quantity relationships", present: hasQuantityRelationships, applicable: hasTechnicalRecords },
      { label: "RFQ-to-final decisions", present: hasRfqFinal, applicable: hasRfqFinal || sourceTypes.some((type) => type.includes("rfq")) },
      { label: "Historical component or service records", present: truthTypes.has("rack or service") || truthTypes.has("passive component") || truthTypes.has("active huawei addition"), applicable: hasTechnicalRecords },
    ]),
    commercialEvidenceCoverage: dimension("Commercial Evidence Coverage", [
      { label: "Supplier source", present: hasSupplier, applicable: commercialApplicable },
      { label: "Purchase or final cost evidence", present: hasCost, applicable: commercialApplicable },
      { label: "Final selling-price evidence", present: hasSelling, applicable: commercialApplicable },
      { label: "Commercial RFQ-to-final change evidence", present: hasCommercialChange, applicable: commercialApplicable },
    ]),
    reviewCoverage: dimension("Decision and Review Coverage", [
      { label: "Candidate rules captured", present: hasRules },
      { label: "Exceptions captured", present: hasExceptions },
      { label: "Unresolved engineering questions captured", present: hasReviewQueue },
      { label: "Review state recorded for all knowledge", present: knowledgeRows.length > 0 && knowledgeRows.every((item) => hasValue(item.review_state || item.reviewState)) },
    ]),
    provenanceQuality: dimension("Provenance Quality", [
      { label: "Ground-truth source linkage", present: truthRows.length > 0 && truthRows.every((record) => hasValue(record.provenanceObject.fileName) && hasValue(record.provenanceObject.sheet) && hasValue(record.provenanceObject.row)) },
      { label: "Knowledge source linkage", present: knowledgeRows.length > 0 && knowledgeRows.every((item) => hasValue(item.evidenceObject.fileName) && hasValue(item.evidenceObject.sheet) && hasValue(item.evidenceObject.row)) },
      { label: "Confidence recorded", present: truthRows.length + knowledgeRows.length > 0 && [...truthRows, ...knowledgeRows].every((item) => Number.isFinite(Number(item.confidence))) },
      { label: "Review state retained", present: truthRows.length + knowledgeRows.length > 0 && [...truthRows, ...knowledgeRows].every((item) => hasValue(item.review_state || item.reviewState)) },
      { label: "Historical project scope retained", present: historicalScope && hasValue(snapshot.projectId) && hasValue(snapshot.systemDomain) },
    ]),
  };
  const scored = Object.values(dimensions).filter((entry) => entry.score !== null);
  const score = scored.length ? Math.round(scored.reduce((sum, entry) => sum + entry.score, 0) / scored.length) : 0;
  const state = score >= 85 ? "Substantial Historical Evidence" : score >= 65 ? "Moderate Historical Evidence" : score >= 40 ? "Limited Historical Evidence" : "Insufficient Historical Evidence";
  const learningReadiness = deriveLearningReadiness({ sources, groundTruth, knowledge });
  const missing = scored.flatMap((entry) => entry.missing.map((label) => `${entry.name}: ${label}`));
  const nonApplicable = Object.values(dimensions).flatMap((entry) => entry.nonApplicable.map((label) => `${entry.name}: ${label}`));
  const blockers = [];
  if (!availableSources.length) blockers.push("No available historical evidence source is retained");
  if (!truthRows.length) blockers.push("No historical ground-truth observations are retained");
  if (learningReadiness === "Needs Engineering Review") blockers.push("Governed knowledge remains pending engineering review");
  const warnings = [];
  if (dimensions.commercialEvidenceCoverage.score !== null && dimensions.commercialEvidenceCoverage.score < 100) warnings.push("Commercial evidence is incomplete and cannot support current costing");
  if (knowledgeRows.some((item) => (item.publication_state || item.publicationState) === "Not Published")) warnings.push("Knowledge remains unpublished");
  return { version: HISTORICAL_COMPLETENESS_VERSION, score, state, dimensions, present: scored.flatMap((entry) => entry.present.map((label) => `${entry.name}: ${label}`)), missing, nonApplicable, blockers, warnings, learningReadiness };
}

export function classifyKnowledge(record) {
  if (record.recordType === "Historical Price" || record.recordType === "Final Cost" || record.recordType === "Final Selling Price") return "Pricing precedent";
  if (record.recordType === "Supplier Source") return "Supplier observation";
  if (record.recordType === "Clarification") return "Clarification pattern";
  if (record.recordType === "Rejected Alternative") return "Error pattern";
  if (["Compatibility","Certification","Engineering Rule"].includes(record.recordType)) return "Project-specific fact";
  return "Historical observation";
}

export function reusableEligibility(item) {
  const blockers = [];
  if (item.reviewState !== "Approved") blockers.push("Project knowledge has not been reviewed");
  if (!item.provenance?.sourceDocumentId) blockers.push("Source document provenance is missing");
  if (["Pricing precedent","Supplier observation"].includes(item.classification)) blockers.push("Commercial observations require explicit scope and date controls");
  if (["Compatibility","Certification"].includes(item.recordType) && item.provenance?.evidenceLevel !== "Manufacturer Evidence") blockers.push("Technical claim lacks manufacturer evidence");
  if (item.projectSpecific || item.clientSpecific) blockers.push("Project or client-specific scope cannot be generalized");
  return { eligible: blockers.length === 0, blockers };
}

export function buildSimilaritySignals(snapshot = {}) {
  const entries = [
    ["System", snapshot.systemDomain, 4], ["Project Type", snapshot.projectType, 3], ["Region", snapshot.region || snapshot.location, 2],
    ...((snapshot.productFamilies || []).map((v) => ["Product Family",v,3])), ...((snapshot.manufacturers || []).map((v) => ["Manufacturer",v,2])),
    ...((snapshot.standards || []).map((v) => ["Standard",v,3])), ...((snapshot.boqComposition || []).map((v) => ["BOQ Composition",v,2])),
  ];
  return entries.filter(([,value]) => normalizedSignal(value)).map(([type,value,weight]) => ({ signalType:type, signalValue:String(value), normalizedValue:normalizedSignal(value), weight }));
}

export function similarityScore(left = [], right = []) {
  const rightKeys = new Set(right.map((s) => `${s.signalType}:${s.normalizedValue}`));
  const denominator = left.reduce((sum,s) => sum + Number(s.weight || 0), 0) || 1;
  const matches = left.filter((s) => rightKeys.has(`${s.signalType}:${s.normalizedValue}`));
  return { score: Math.round(matches.reduce((sum,s) => sum + Number(s.weight || 0),0) / denominator * 100), basis: matches.map((s) => ({ type:s.signalType, value:s.signalValue, weight:s.weight })) };
}

export function assertPublicationAllowed({ item, caseStudy, releaseId }) {
  if (caseStudy.benchmarkState === "Holdout" && caseStudy.benchmarkRelease === releaseId) return { allowed:false, reason:"Holdout cases cannot influence the release being evaluated" };
  const eligibility = reusableEligibility(item);
  if (!eligibility.eligible) return { allowed:false, reason:eligibility.blockers.join("; ") };
  return { allowed:true };
}
