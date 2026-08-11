export const ENGINEERING_CLASSIFICATION_VERSION = "engineering-classification-1.0.0";

export const CLASSIFICATION_TYPES = [
  "Equipment Category", "Product Family", "Device Type", "System Architecture", "Addressable / Conventional",
  "Functional Classification", "Installation Classification", "Electrical Classification", "Network Classification",
  "Protocol Classification", "Environmental Classification", "Certification Readiness", "Standards Readiness",
  "Compatibility Readiness", "Accessories Readiness",
];

const values = (facts, type) => facts.filter((fact) => fact.factType === type).map((fact) => fact.value);
const supports = (facts, types) => facts.filter((fact) => types.includes(fact.factType));
const unique = (items) => [...new Set(items.filter((item) => item !== null && item !== undefined && item !== ""))];
const evidence = (facts) => facts.map((fact) => ({ factId: fact.id, requirementId: fact.requirementId, factType: fact.factType, value: fact.value, confidence: fact.confidence, page: fact.sourcePage, clause: fact.sourceClause, section: fact.sourceSection, evidenceSnippet: fact.evidenceSnippet }));

const decision = (classificationType, value, facts, basis) => ({ classificationType, value: value ?? null, status: value === null || (Array.isArray(value) && !value.length) ? "Missing Evidence" : "Proposed", supportingFactIds: facts.map((fact) => fact.id), evidence: evidence(facts), basis, confidence: facts.length ? Math.round(facts.reduce((sum, fact) => sum + fact.confidence, 0) / facts.length) : 0, reviewStatus: "Needs Review" });

export const buildEngineeringClassification = ({ facts, previousVersion = 0 }) => {
  const approved = facts.filter((fact) => fact.reviewStatus === "Approved");
  const equipmentFacts = supports(approved, ["Equipment Type", "Device Category"]);
  const equipment = values(approved, "Equipment Type")[0] || null;
  const explicitDeviceCategory = values(approved, "Device Category")[0] || null;
  const taxonomyCategory = explicitDeviceCategory || (equipment === "Fire Alarm Panel" ? "Control Equipment" : /Detector/.test(equipment || "") ? "Detection Device" : equipment === "Monitor Module" ? "Interface Module" : equipment === "Sounder/Strobe" ? "Notification Appliance" : null);
  const productFamilyFacts = supports(approved, ["Product Family"]);
  const addressFacts = supports(approved, ["Addressability"]);
  const functionalFacts = supports(approved, ["Functional Role", "Mandatory Features"]);
  const installationFacts = supports(approved, ["Installation Context", "Mounting Method"]);
  const electricalFacts = supports(approved, ["Voltage / Current", "Power Requirements", "Wiring Requirements", "Loop Requirements"]);
  const networkFacts = supports(approved, ["Technical Dependencies", "Functional Role"] ).filter((fact) => /network|connected|communication/i.test(String(fact.value)));
  const protocolFacts = supports(approved, ["Protocol"]);
  const environmentFacts = supports(approved, ["Indoor / Outdoor", "Environmental Rating"]);
  const certificationFacts = supports(approved, ["Required Certifications"]);
  const standardsFacts = supports(approved, ["Required Standards"]);
  const compatibilityFacts = supports(approved, ["Compatible Accessories", "Compatible Base", "Compatible Module", "Compatible Panel"]);
  const accessoryFacts = supports(approved, ["Required Accessories", "Compatible Accessories", "Compatible Base", "Compatible Module"]);
  const architectureFacts = [...addressFacts, ...networkFacts, ...protocolFacts];

  const evaluated = [
    decision("Equipment Category", taxonomyCategory, equipmentFacts, taxonomyCategory && !explicitDeviceCategory ? "Controlled taxonomy mapping from approved Equipment Type" : "Approved explicit category evidence"),
    decision("Product Family", values(approved, "Product Family")[0] || null, productFamilyFacts, "Approved Product Family fact required"),
    decision("Device Type", equipment, equipmentFacts, "Approved Equipment Type fact"),
    decision("System Architecture", unique([...values(approved, "Addressability"), ...networkFacts.map((fact) => fact.value), ...protocolFacts.map((fact) => fact.value)]), architectureFacts, "Approved architecture facts only"),
    decision("Addressable / Conventional", values(approved, "Addressability")[0] || null, addressFacts, "Approved addressability fact required"),
    decision("Functional Classification", unique(functionalFacts.map((fact) => fact.value)), functionalFacts, "Approved functional facts only"),
    decision("Installation Classification", unique(installationFacts.map((fact) => fact.value)), installationFacts, "Approved installation facts only"),
    decision("Electrical Classification", unique(electricalFacts.map((fact) => fact.value)), electricalFacts, "Approved electrical facts only"),
    decision("Network Classification", unique(networkFacts.map((fact) => fact.value)), networkFacts, "Approved network evidence only"),
    decision("Protocol Classification", unique(protocolFacts.map((fact) => fact.value)), protocolFacts, "Approved protocol facts only"),
    decision("Environmental Classification", unique(environmentFacts.map((fact) => fact.value)), environmentFacts, "Approved environmental facts only"),
    decision("Certification Readiness", certificationFacts.length ? "Evidence Available — Review Required" : null, certificationFacts, "No certification readiness without approved certification evidence"),
    decision("Standards Readiness", standardsFacts.length ? "Evidence Available — Review Required" : null, standardsFacts, "No standards readiness without approved standards evidence"),
    decision("Compatibility Readiness", compatibilityFacts.length ? "Evidence Available — Review Required" : null, compatibilityFacts, "No compatibility readiness without approved compatibility evidence"),
    decision("Accessories Readiness", accessoryFacts.length ? "Evidence Available — Review Required" : null, accessoryFacts, "No accessory readiness without approved accessory evidence"),
  ];

  const decisions = evaluated.filter((entry) => entry.status !== "Missing Evidence" && entry.supportingFactIds.length > 0);
  const complete = decisions.length;
  const completeness = Math.round((complete / CLASSIFICATION_TYPES.length) * 100);
  const critical = ["Equipment Category", "Product Family", "Device Type", "Addressable / Conventional", "Protocol Classification", "Certification Readiness", "Standards Readiness", "Compatibility Readiness"];
  const blockingMissingInformation = evaluated.filter((entry) => critical.includes(entry.classificationType) && entry.status === "Missing Evidence").map((entry) => ({ classificationType: entry.classificationType, reason: `No approved engineering fact supports ${entry.classificationType.toLowerCase()}.`, requiredHumanDecision: `Review and approve explicit source evidence for ${entry.classificationType.toLowerCase()}.` }));
  const missingEvidence = evaluated.filter((entry) => entry.status === "Missing Evidence").map((entry) => entry.classificationType);
  const technicalRisks = blockingMissingInformation.map((entry) => ({ area: entry.classificationType, risk: `${entry.classificationType} cannot safely constrain product selection.`, severity: "High" }));
  const engineeringQuestions = blockingMissingInformation.map((entry) => ({ question: `What approved source evidence establishes ${entry.classificationType.toLowerCase()}?`, classificationType: entry.classificationType, status: "Open" }));
  const requiredHumanDecisions = decisions.filter((entry) => entry.status === "Proposed").map((entry) => ({ decision: `Approve or reject ${entry.classificationType}`, supportingFactIds: entry.supportingFactIds }));
  const readiness = blockingMissingInformation.length ? "Not Ready" : completeness === 100 ? "Ready" : completeness >= 75 ? "Conditionally Ready" : "Not Ready";
  return { engineVersion: ENGINEERING_CLASSIFICATION_VERSION, versionNumber: previousVersion + 1, decisions, completeness, readiness, blockingMissingInformation, missingEvidence, technicalRisks, engineeringQuestions, requiredHumanDecisions, approvedFactCount: approved.length, totalFactCount: facts.length, autoApproved: false };
};
