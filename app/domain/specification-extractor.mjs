import { unzipSync, unzlibSync } from "fflate";
import { inspectPdfReadiness } from "../document-parsers/pdf-readiness.mjs";
import { buildSpecificationDocumentMap } from "./specification-extraction-jobs.mjs";

export const SPEC_PARSER_VERSION = "spec-engine-1.0.1";
export const SPEC_RULESET_VERSION = "engineering-requirements-2026-08-01";
export const SPEC_MODEL_VERSION = "deterministic-semantic-1.0.0";
export const SPEC_PROMPT_VERSION = "spec-ai-escalation-v1";
export const SPEC_OCR_VERSION = "not-configured";
export const REQUIREMENT_TYPES = ["Mandatory", "Optional", "Preferred", "Informational", "Conditional", "Prohibited", "Derived", "Assumed", "Missing", "Conflicting", "Clarification Required", "Exception", "Alternate", "Approved Equivalent Allowed"];
export const REQUIREMENT_CATEGORIES = ["Functional", "Performance", "Capacity", "Compliance", "Standards", "Compatibility", "Environmental", "Electrical", "Mechanical", "Network", "Software", "Cybersecurity", "Installation", "Testing", "Commissioning", "Warranty", "Documentation", "Training", "Maintenance", "Spare Parts", "Manufacturer", "Approved Brand", "Accessories", "Licensing", "Commercial Constraint", "Other"];

const text = (value) => String(value ?? "").replace(/[\t ]+/g, " ").trim();
const decodeXml = (value) => value.replace(/<w:tab\s*\/>/g, "\t").replace(/<w:br[^>]*\/>/g, "\n").replace(/<[^>]+>/g, "").replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'");
const normalized = (value) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const clamp = (value, min = 0, max = 99) => Math.max(min, Math.min(max, value));

export class SpecificationExtractionError extends Error {
  constructor(code, userMessage, technicalDetails, suggestedAction, source = {}) { super(userMessage); this.name = "SpecificationExtractionError"; this.code = code; this.userMessage = userMessage; this.technicalDetails = technicalDetails; this.suggestedAction = suggestedAction; this.source = source; }
}

const domainRules = [[/fire alarm|fire detection|smoke detector|nfpa\s*72/i, "Fire Alarm"], [/cctv|camera|nvr|onvif/i, "CCTV"], [/access control|card reader|door controller/i, "Access Control"], [/structured cabling|cat(?:egory)?\s*6|fiber optic/i, "Structured Cabling"], [/public address|voice evacuation/i, "Public Address"], [/audio visual|\bav\b/i, "Audio Visual"], [/building management|\bbms\b/i, "BMS"], [/\bups\b|uninterruptible/i, "UPS"], [/network switch|ethernet|ieee\s*802/i, "Networking"], [/electrical|switchgear|circuit breaker/i, "Electrical"], [/hvac|mechanical|plumbing/i, "MEP"], [/security/i, "Security"]];
export const detectEngineeringDomain = (value) => { const found = domainRules.find(([pattern]) => pattern.test(value)); return found ? { value: found[1], sourceType: "Inferred", confidence: 82, explicitlyStated: false } : { value: "Unknown", sourceType: "Unknown", confidence: 0, explicitlyStated: false }; };

const heading = (line) => {
  const value = text(line); let match;
  if ((match = value.match(/^DIVISION\s+(\d+)\b(?:\s*[-–—:]\s*)?(.*)$/i))) return { kind: "Division", number: match[1], title: text(match[2]) || value, level: 1 };
  if ((match = value.match(/^SECTION\s+([\d ]{2,}(?:\s\d{2}){1,}|\d+(?:\.\d+)*)\b(?:\s*[-–—:]\s*)?(.*)$/i))) return { kind: "Section", number: text(match[1]), title: text(match[2]) || value, level: 2 };
  if ((match = value.match(/^PART\s+(\d+)\s*[-–—:]?\s*(.*)$/i))) return { kind: "Part", number: match[1], title: text(match[2]) || value, level: 3 };
  if ((match = value.match(/^(\d+(?:\.\d+){1,5}|[A-Z]\.|\d+\.)\s+(.{3,})$/))) { const dots = (match[1].match(/\./g) || []).length; return { kind: dots >= 2 ? "Clause" : "Article", number: match[1].replace(/\.$/, ""), title: text(match[2]), level: Math.min(8, 3 + dots) }; }
  if (/^[A-Z][A-Z\s/&-]{5,80}$/.test(value) && value.split(/\s+/).length <= 10) return { kind: "Heading", number: null, title: value, level: 4 };
  return null;
};

const sentenceSplit = (value) => text(value).split(/(?<=[.;!?])\s+(?=[A-Z0-9“"(])|\n+/).map(text).filter((part) => part.length >= 8);
export const classifyRequirementType = (value) => {
  const source = text(value);
  if (/\bshall not\b|\bmust not\b|\bprohibited\b|\bnot be permitted\b/i.test(source)) return "Prohibited";
  if (/\bapproved (?:equal|equivalent)\b|\bor equal\b/i.test(source)) return "Approved Equivalent Allowed";
  if (/\bwhere required\b|\bif required\b|\bwhen (?:required|applicable)\b|\bsubject to\b/i.test(source)) return "Conditional";
  if (/\bshall\b|\bmust\b|\brequired\b|\bprovide\b|\bcomply\b/i.test(source)) return "Mandatory";
  if (/\bshould\b|\bpreferred\b/i.test(source)) return "Preferred";
  if (/\bmay\b|\boptional\b/i.test(source)) return "Optional";
  return "Informational";
};

export const classifyRequirementCategory = (value) => {
  const rules = [[/standard|comply|certif|listed|approved by|civil defense/i, "Compliance"], [/manufacturer|approved make|approved brand|basis of design/i, "Manufacturer"], [/compatible|interface|interoperate|protocol/i, "Compatibility"], [/accessor|base|bracket|junction box|battery|power supply|license/i, "Accessories"], [/install|mount|cabl|termination|label|ground/i, "Installation"], [/test|inspection|acceptance/i, "Testing"], [/commission/i, "Commissioning"], [/warrant|defects liability/i, "Warranty"], [/submittal|shop drawing|manual|as-built|document|certificate/i, "Documentation"], [/train/i, "Training"], [/maintenan|spare part|service visit/i, "Maintenance"], [/temperature|humidity|\bip\s*\d|\bik\s*\d|outdoor|indoor/i, "Environmental"], [/voltage|current|power|battery|\bvdc\b|\bvac\b/i, "Electrical"], [/capacity|minimum of|maximum of|not exceeding|at least|at most|per loop/i, "Capacity"], [/network|ethernet|bandwidth|firmware|software/i, "Network"], [/function|operation|shall support|shall provide/i, "Functional"]];
  return rules.find(([pattern]) => pattern.test(value))?.[1] || "Other";
};

const operatorFor = (value) => /not exceeding|at most|maximum(?: of)?/i.test(value) ? "Maximum" : /at least|minimum(?: of)?|not less than/i.test(value) ? "Minimum" : /greater than/i.test(value) ? "Greater Than" : /less than/i.test(value) ? "Less Than" : /between/i.test(value) ? "Between" : /shall not|must not|exclude/i.test(value) ? "Excludes" : "Equals";

const attributeOperatorContext = (value, match) => {
  const start = Math.max(
    0,
    value.lastIndexOf(";", match.index) + 1,
    value.lastIndexOf(".", match.index) + 1,
    value.lastIndexOf(",", match.index) + 1,
  );
  return value.slice(start, match.index + match[0].length);
};
const attributePatterns = [
  ["IP Rating", /\bIP\s*([0-6X][0-9X])\b/gi, null], ["IK Rating", /\bIK\s*(\d{2})\b/gi, null],
  ["Voltage", /\b(\d+(?:\.\d+)?)\s*(VDC|VAC|V\s*DC|V\s*AC|VOLT(?:S)?)\b/gi, "V"], ["Current", /\b(\d+(?:\.\d+)?)\s*(mA|A)\b/g, null],
  ["Power", /\b(\d+(?:\.\d+)?)\s*(kW|W|kVA|VA)\b/gi, null], ["Capacity", /\b(\d+(?:,\d{3})*)\s*(devices?|detectors?|points?|nodes?|loops?|channels?)\b/gi, null],
  ["Temperature", /(-?\d+(?:\.\d+)?)\s*°?\s*C\s*(?:to|[-–])\s*(-?\d+(?:\.\d+)?)\s*°?\s*C/gi, "°C"],
  ["Warranty Duration", /\b(\d+)\s*(months?|years?)\b(?=[^.]{0,35}\bwarrant)/gi, null], ["Bandwidth", /\b(\d+(?:\.\d+)?)\s*(Gbps|Mbps)\b/gi, null],
];
export const extractAttributes = (value) => attributePatterns.flatMap(([name, pattern, fixedUnit]) => {
  const matches = [...value.matchAll(new RegExp(pattern.source, pattern.flags))];
  return matches.map((match) => {
    const range = Boolean(match[2]) && name === "Temperature"; const originalValue = match[0]; const unit = fixedUnit || (range ? match[3] : match[2]) || null;
    const parsedValue = range ? [Number(match[1]), Number(match[2])] : name.endsWith("Rating") ? match[1] : Number(String(match[1]).replaceAll(",", ""));
    const normalizedValue = name === "IP Rating" ? `IP${match[1]}` : name === "IK Rating" ? `IK${match[1]}` : parsedValue;
    return { name, operator: range ? "Between" : operatorFor(attributeOperatorContext(value, match)), originalValue, parsedValue, originalUnit: unit, normalizedValue, normalizedUnit: unit?.toUpperCase().replace("VOLT", "V") || null, confidence: 94 };
  });
});

const standardPattern = /\b(NFPA|UL|FM|EN\s*54|EN54|IEC|BS|ISO|TIA|BICSI|ONVIF|IEEE|NEC)\s*[-:]?\s*([A-Z0-9.-]+)?(?:\s*[:/-]\s*([A-Z0-9.-]+))?(?:\s*\(?((?:19|20)\d{2})\)?)?/gi;
export const extractStandards = (value) => [...value.matchAll(standardPattern)].map((match) => ({ body: match[1].replace(/\s+/g, "").toUpperCase(), number: match[2] || null, part: match[3] || null, year: match[4] || null, originalText: match[0], status: classifyRequirementType(value), confidence: 94 }));

const manufacturerNames = ["Honeywell", "Siemens", "Bosch", "Johnson Controls", "Notifier", "Edwards", "Simplex", "Farenhyt", "Hanwha", "Cisco", "Schneider Electric", "ABB", "Eaton"];
export const extractManufacturers = (value) => manufacturerNames.filter((name) => new RegExp(`\\b${name.replace(" ", "\\s+")}\\b`, "i").test(value)).map((name) => ({ manufacturer: name, status: /prohibit|not acceptable|exclude/i.test(value) ? "Prohibited" : /preferred/i.test(value) ? "Preferred" : /basis of design/i.test(value) ? "Basis of Design" : /equivalent|approved equal/i.test(value) ? "Equivalent Subject to Approval" : /approved manufacturer|approved make|manufacturer/i.test(value) ? "Approved" : "Named", confidence: 90 }));

const ambiguityPatterns = [[/\bas required\b/i, "Scope or quantity is not defined"], [/\bsuitable\b/i, "Suitability criteria are not stated"], [/\badequate\b/i, "Performance threshold is not stated"], [/\blatest standard\b/i, "Standard revision is not identified"], [/\bapproved equal\b/i, "Equivalence approval criteria are not defined"], [/\bwhere necessary\b/i, "Trigger condition is not defined"], [/\bcomplete system\b/i, "System boundary and included components are not enumerated"], [/\ball required accessories\b/i, "Accessory identities and quantities are not enumerated"], [/\bas recommended by (?:the )?manufacturer\b/i, "The controlling manufacturer document is not identified"]];
export const detectAmbiguities = (value) => ambiguityPatterns.filter(([pattern]) => pattern.test(value)).map(([, why]) => ({ originalText: value, why, technicalImpact: "Product compliance or scope cannot be validated deterministically.", commercialImpact: "Unspecified scope may change product quantity or cost.", clarificationQuestion: `Please define the measurable requirement intended by: “${text(value).slice(0, 180)}”`, blocking: true }));

const parseAccessory = (value) => ["detector base", "isolator", "mounting bracket", "junction box", "battery", "power supply", "license", "SFP", "patch cord", "rack accessory", "interface module", "cable gland", "termination kit", "software module"].filter((name) => new RegExp(`\\b${name.replace(" ", "\\s+")}s?\\b`, "i").test(value)).map((name) => ({ accessory: name, sourceType: /shall|must|required|provide/i.test(value) ? "Explicit" : "Derived", confidence: /shall|must|required|provide/i.test(value) ? 90 : 60 }));
const parseCompatibility = (value) => {
  const match = value.match(
    /(.{3,80}?)\s+(?:shall be compatible with|compatible with|shall interface with|integrate with)\s+(.{3,100}?)(?=\s*,?\s*(?:and\s+)?(?:shall|must|will|required\b)|[.;]|$)/i,
  );
  return match ? [{
    sourceItem: text(match[1]),
    targetItem: text(match[2]),
    type: /integrate|interface/i.test(match[0]) ? "Interface" : "Compatible With",
    mandatory: /shall|must/i.test(value),
    confidence: 84,
  }] : [];
};
const crossReferences = (value) => [...value.matchAll(/(?:refer to|comply with|as (?:specified|indicated) in)\s+(Section\s+[\d ]+(?:\.\d+)*|paragraph\s+[\d.A-Z]+|drawings?|equipment schedule)/gi)].map((match) => ({ referenceText: match[0], target: match[1], status: "Unresolved Reference", confidence: 86 }));

export const segmentSpecification = (pages) => {
  const hierarchy = []; const sections = []; const clauses = []; let current = null;
  const flush = () => { if (current && text(current.text)) clauses.push(current); current = null; };
  for (const page of pages) for (const rawLine of page.lines) {
    const line = text(rawLine); if (!line) continue; const found = heading(line);
    if (found) { flush(); hierarchy.splice(found.level - 1); hierarchy[found.level - 1] = `${found.number ? `${found.number} ` : ""}${found.title}`; const section = { ...found, page: page.page, path: hierarchy.filter(Boolean), sourceText: line, sequence: sections.length + 1 }; sections.push(section); const titleCarriesRequirement = ["Article", "Clause"].includes(found.kind) && (/[a-z]{3}/.test(found.title) || /\bshall|must|required|provide|comply|may|should\b/i.test(found.title)); current = { number: found.number, title: found.title, kind: found.kind, pageFrom: page.page, pageTo: page.page, path: section.path, text: titleCarriesRequirement ? found.title : "", sequence: clauses.length + 1 }; }
    else if (!current) current = { number: null, title: null, kind: "Preamble", pageFrom: page.page, pageTo: page.page, path: hierarchy.filter(Boolean), text: line, sequence: clauses.length + 1 };
    else { current.text = `${current.text}${current.text ? " " : ""}${line}`; current.pageTo = page.page; }
  }
  flush(); return { sections, clauses };
};

export const extractSpecificationPages = (pages, metadata = {}) => {
  const structure = segmentSpecification(pages); const requirements = [];
  for (const clause of structure.clauses) for (const sentence of sentenceSplit(clause.text)) {
    const type = classifyRequirementType(sentence); const attributes = extractAttributes(sentence); const standards = extractStandards(sentence); const manufacturers = extractManufacturers(sentence); const compatibility = parseCompatibility(sentence); const accessories = parseAccessory(sentence); const ambiguities = detectAmbiguities(sentence); const category = classifyRequirementCategory(sentence);
    const requirementLike = type !== "Informational" || attributes.length || standards.length || manufacturers.length || compatibility.length || accessories.length;
    if (!requirementLike || /copyright|table of contents|index of sections/i.test(sentence)) continue;
    const domain = detectEngineeringDomain(`${clause.path.join(" ")} ${sentence}`); let confidence = clamp(55 + (type === "Mandatory" || type === "Prohibited" ? 18 : 8) + (clause.number ? 10 : 0) + (attributes.length || standards.length ? 8 : 0) - ambiguities.length * 25);
    if (!clause.number || ambiguities.length || type === "Informational") confidence = Math.min(confidence, 79);
    requirements.push({ sequence: requirements.length + 1, originalText: sentence, normalizedRequirement: normalized(sentence), domain, system: domain.value, category, subcategory: null, requirementType: ambiguities.length ? "Clarification Required" : type, requirementCategory: category, attributes, standards, manufacturers, compatibility, accessories, crossReferences: crossReferences(sentence), condition: type === "Conditional" ? sentence : null, exception: type === "Exception" ? sentence : null, installation: category === "Installation", testing: category === "Testing", commissioning: category === "Commissioning", warranty: category === "Warranty", documentation: category === "Documentation", ambiguities, confidence, confidenceState: confidence >= 90 ? "High Confidence" : confidence >= 70 ? "Medium Confidence" : "Needs Review", reviewStatus: confidence >= 90 && !ambiguities.length ? "Pending Approval" : "Needs Review", source: { pageFrom: clause.pageFrom, pageTo: clause.pageTo, section: clause.path.find((entry) => /section/i.test(entry)) || null, part: clause.path.find((entry) => /part/i.test(entry)) || null, article: clause.kind === "Article" ? clause.number : null, clause: clause.number, clausePath: clause.path, originalClauseText: clause.text } });
  }
  const conflicts = [];
  const attributeIndex = new Map();
  for (const requirement of requirements) for (const attribute of requirement.attributes) { const key = `${requirement.domain.value}|${attribute.name}`; const previous = attributeIndex.get(key); if (previous && JSON.stringify(previous.attribute.normalizedValue) !== JSON.stringify(attribute.normalizedValue) && previous.attribute.operator === attribute.operator) conflicts.push({ type: "Technical Value Conflict", leftRequirementSequence: previous.requirement.sequence, rightRequirementSequence: requirement.sequence, attribute: attribute.name, leftValue: previous.attribute.normalizedValue, rightValue: attribute.normalizedValue, severity: ["Voltage", "Capacity"].includes(attribute.name) ? "Critical" : "High", impact: "Product compliance cannot be determined until the governing source is confirmed.", recommendedResolution: "Review revision precedence and issue a project clarification.", clarificationRequired: true, status: "Open" }); else attributeIndex.set(key, { requirement, attribute }); }
  const domain = detectEngineeringDomain(requirements.map((item) => `${item.source.clausePath.join(" ")} ${item.originalText}`).join(" "));
  const missing = [];
  const presentAttributes = new Set(requirements.flatMap((item) => item.attributes.map((attribute) => attribute.name)));
  const requiredByDomain = { "Fire Alarm": ["Voltage", "Capacity", "Warranty Duration"], CCTV: ["IP Rating", "Voltage"], UPS: ["Power", "Warranty Duration"] }[domain.value] || [];
  for (const field of requiredByDomain) if (!presentAttributes.has(field)) missing.push({ field, reasonRequired: `${field} is needed for safe ${domain.value} product selection.`, technicalImpact: "Compatibility or compliance cannot be validated.", commercialImpact: "Supplier scope and price may vary.", blocking: true, clarificationQuestion: `Please confirm the required ${field.toLowerCase()} and its governing clause.` });
  const allAmbiguities = requirements.flatMap((requirement) => requirement.ambiguities.map((ambiguity) => ({ ...ambiguity, requirementSequence: requirement.sequence, source: requirement.source })));
  const summary = { totalPagesReviewed: pages.length, totalSectionsDetected: structure.sections.length, totalClausesDetected: structure.clauses.length, totalRequirementsExtracted: requirements.length, mandatoryRequirements: requirements.filter((item) => item.requirementType === "Mandatory").length, optionalRequirements: requirements.filter((item) => item.requirementType === "Optional").length, standardsDetected: requirements.reduce((sum, item) => sum + item.standards.length, 0), approvedManufacturers: requirements.reduce((sum, item) => sum + item.manufacturers.filter((entry) => entry.status === "Approved").length, 0), compatibilityRules: requirements.reduce((sum, item) => sum + item.compatibility.length, 0), requiredAccessories: requirements.reduce((sum, item) => sum + item.accessories.length, 0), installationRequirements: requirements.filter((item) => item.installation).length, testingRequirements: requirements.filter((item) => item.testing).length, warrantyRequirements: requirements.filter((item) => item.warranty).length, ambiguities: allAmbiguities.length, conflicts: conflicts.length, missingInformation: missing.length, itemsNeedingReview: requirements.filter((item) => item.reviewStatus === "Needs Review").length, averageConfidence: requirements.length ? Math.round(requirements.reduce((sum, item) => sum + item.confidence, 0) / requirements.length) : 0, parserVersion: SPEC_PARSER_VERSION, modelVersion: SPEC_MODEL_VERSION };
  return { parserVersion: SPEC_PARSER_VERSION, rulesetVersion: SPEC_RULESET_VERSION, modelVersion: SPEC_MODEL_VERSION, promptVersion: SPEC_PROMPT_VERSION, ocrVersion: SPEC_OCR_VERSION, extractionMethod: metadata.extractionMethod || "structured-text", metadata, pages, sections: structure.sections, clauses: structure.clauses, requirements, conflicts, ambiguities: allAmbiguities, missingInformation: missing, summary };
};

const docxPages = (bytes) => { let archive; try { archive = unzipSync(bytes); } catch { throw new SpecificationExtractionError("CORRUPT_DOCX", "The DOCX specification is unreadable.", "The OOXML ZIP container could not be opened.", "Upload an unprotected DOCX copy."); } const xmlBytes = archive["word/document.xml"]; if (!xmlBytes) throw new SpecificationExtractionError("CORRUPT_DOCX", "The DOCX specification has no readable document body.", "word/document.xml is missing.", "Repair or export the document again."); const xml = new TextDecoder().decode(xmlBytes); const pages = [[]]; for (const paragraph of xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) { const value = text(decodeXml(paragraph[0])); if (value) pages.at(-1).push(value); if (/<w:lastRenderedPageBreak\b|<w:br\b[^>]*w:type="page"/.test(paragraph[0])) pages.push([]); } return pages.filter((lines) => lines.length).map((lines, index) => ({ page: index + 1, lines, extractionQuality: 0.95 })); };
const pdfLiteralStrings = (value) => [...value.matchAll(/\(([^()]*(?:\\.[^()]*)*)\)\s*Tj|\[((?:.|\n)*?)\]\s*TJ/g)].flatMap((match) => match[1] ? [match[1]] : [...(match[2] || "").matchAll(/\(([^()]*)\)/g)].map((part) => part[1])).map((entry) => entry.replace(/\\([()\\])/g, "$1").replace(/\\[nr]/g, " "));
export const isUsablePdfTextPages = (pages) => {
  const value = pages.flatMap((page) => page.lines || []).join(" ").trim();
  if (value.length < 32) return false;
  const controls = (value.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g) || []).length;
  const words = value.match(/[A-Za-z]{3,}/g) || [];
  const readableCharacters = (value.match(/[A-Za-z0-9\s.,;:()'"/\-&]/g) || []).length;
  return controls / value.length <= 0.01 && readableCharacters / value.length >= 0.72 && words.length >= Math.max(4, Math.floor(value.length / 180));
};
const pdfPages = (bytes, metadata) => { const readiness = inspectPdfReadiness(bytes, metadata); if (!readiness.valid) throw new SpecificationExtractionError(readiness.error.code, readiness.error.message, readiness.error.message, "Upload an authorized readable PDF."); if (readiness.requiresOcr) throw new SpecificationExtractionError("OCR_REQUIRED", "This scanned specification requires OCR.", "No approved OCR provider is configured; no clauses or requirements were invented.", "Configure OCR or upload a text-searchable specification."); const source = new TextDecoder("latin1").decode(bytes); const objects = [...source.matchAll(/(\d+)\s+\d+\s+obj\b([\s\S]*?)endobj/g)].map((match) => match[2]); const decodedStreams = objects.flatMap((object) => { const stream = object.match(/stream\r?\n([\s\S]*?)\r?\nendstream/); if (!stream) return []; if (!/\/FlateDecode/.test(object)) return [stream[1]]; try { const raw = Uint8Array.from(stream[1], (character) => character.charCodeAt(0) & 255); return [new TextDecoder("latin1").decode(unzlibSync(raw))]; } catch { return []; } }); const directPages = source.split(/(?=\/Type\s*\/Page\b)/g).slice(1).map((page, index) => ({ page: index + 1, lines: pdfLiteralStrings(page).flatMap((entry) => entry.split(/\r?\n/)).map(text).filter(Boolean), extractionQuality: 0.7 })); if (directPages.some((page) => page.lines.length)) { if (isUsablePdfTextPages(directPages)) return directPages; throw new SpecificationExtractionError("PDF_TEXT_LAYOUT_UNAVAILABLE", "The specification text layer could not be reconstructed safely.", "The lightweight PDF stream parser returned unreadable or binary-looking text.", "Use the coordinate-aware PDF parser."); } const lines = decodedStreams.flatMap(pdfLiteralStrings).map(text).filter(Boolean); if (!lines.length) throw new SpecificationExtractionError("PDF_TEXT_LAYOUT_UNAVAILABLE", "The specification text layer could not be reconstructed safely.", "Compressed text or font encoding is unsupported by the lightweight worker parser.", "Use the DOCX source or configure a production PDF layout service."); const streamPages = Array.from({ length: readiness.pageCount || 1 }, (_, index) => ({ page: index + 1, lines: index === 0 ? lines : [], extractionQuality: 0.55 })); if (!isUsablePdfTextPages(streamPages)) throw new SpecificationExtractionError("PDF_TEXT_LAYOUT_UNAVAILABLE", "The specification text layer could not be reconstructed safely.", "Decoded PDF streams returned unreadable or binary-looking text.", "Use the coordinate-aware PDF parser."); return streamPages; };

export const extractSpecificationBytes = (bytes, metadata = {}) => {
  const extension = String(metadata.extension || metadata.fileName?.split(".").pop() || "").toLowerCase(); let pages;
  if (extension === "docx") pages = docxPages(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  else if (extension === "pdf") pages = pdfPages(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), metadata);
  else if (["txt", "csv"].includes(extension)) pages = [{ page: 1, lines: new TextDecoder().decode(bytes).split(/\r?\n/), extractionQuality: 0.9 }];
  else if (extension === "doc") throw new SpecificationExtractionError("LEGACY_DOCUMENT_CONVERTER_REQUIRED", "This legacy DOC specification requires safe conversion.", "No sandboxed OLE converter is configured.", "Save an authorized copy as DOCX or PDF.");
  else throw new SpecificationExtractionError("UNSUPPORTED_SPECIFICATION_FORMAT", "This specification format is not supported.", `Unsupported extension: ${extension || "unknown"}.`, "Upload PDF or DOCX.");
  return extractSpecificationPages(pages, { ...metadata, extractionMethod: extension === "docx" ? "native-docx-structure" : extension === "pdf" ? "native-pdf-stream" : "plain-text" });
};

const ensurePdfJsGlobals = () => {
  if (!globalThis.DOMMatrix) globalThis.DOMMatrix = class DOMMatrix { constructor(values = [1, 0, 0, 1, 0, 0]) { [this.a, this.b, this.c, this.d, this.e, this.f] = values; } multiplySelf() { return this; } preMultiplySelf() { return this; } translate() { return this; } scale() { return this; } invertSelf() { return this; } };
  if (!globalThis.ImageData) globalThis.ImageData = class ImageData { constructor(data, width, height) { this.data = data; this.width = width; this.height = height; } };
  if (!globalThis.Path2D) globalThis.Path2D = class Path2D { addPath() {} };
};

const openPdfJsDocument = async ({ bytes, rangeSource }) => {
  ensurePdfJsGlobals();
  const { getDocument, PDFDataRangeTransport } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!rangeSource) return getDocument({ data: bytes, disableWorker: true, useSystemFonts: true, isEvalSupported: false }).promise;
  class BoundedRangeTransport extends PDFDataRangeTransport {
    requestDataRange(begin, end) {
      Promise.resolve(rangeSource.readRange(begin, end)).then((chunk) => this.onDataRange(begin, chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk))).catch((error) => this.abort(error));
    }
  }
  const transport = new BoundedRangeTransport(Number(rangeSource.length), null, false, rangeSource.fileName || null);
  return getDocument({ range: transport, length: Number(rangeSource.length), disableAutoFetch: true, disableStream: true, disableWorker: true, useSystemFonts: true, isEvalSupported: false }).promise;
};

const pdfJsPages = async (bytes, metadata, range = {}, rangeSource = null) => {
  if (!rangeSource) {
    const readiness = inspectPdfReadiness(bytes, metadata);
    if (!readiness.valid) throw new SpecificationExtractionError(readiness.error.code, readiness.error.message, readiness.error.message, "Upload an authorized readable PDF.");
    if (readiness.requiresOcr) throw new SpecificationExtractionError("OCR_REQUIRED", "This scanned specification requires OCR.", "No approved OCR provider is configured; no clauses or requirements were invented.", "Configure OCR or upload a text-searchable specification.");
  }
  try {
    const document = await openPdfJsDocument({ bytes, rangeSource });
    const pages = [];
    const pageFrom = Math.max(1, Number(range.pageFrom || 1));
    const pageTo = Math.min(document.numPages, Number(range.pageTo || document.numPages));
    for (let pageNumber = pageFrom; pageNumber <= pageTo; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({ disableNormalization: false });
      const rows = new Map();
      for (const item of content.items) {
        if (!("str" in item) || !text(item.str)) continue;
        const y = Math.round(Number(item.transform?.[5] || 0) * 2) / 2;
        const row = rows.get(y) || [];
        row.push({ x: Number(item.transform?.[4] || 0), value: text(item.str) });
        rows.set(y, row);
      }
      const lines = [...rows.entries()].sort(([left], [right]) => right - left).map(([, row]) => row.sort((left, right) => left.x - right.x).map((entry) => entry.value).join(" ").replace(/\s+([,.;:])/g, "$1").trim()).filter(Boolean);
      pages.push({ page: pageNumber, lines, extractionQuality: lines.length ? 0.95 : 0 });
      page.cleanup();
    }
    await document.destroy();
    if (!pages.some((page) => page.lines.length)) throw new SpecificationExtractionError("PDF_TEXT_LAYOUT_UNAVAILABLE", "The specification text layer could not be reconstructed safely.", "The PDF layout parser returned no readable text.", "Configure OCR or upload a text-searchable specification.");
    return pages;
  } catch (error) {
    if (error instanceof SpecificationExtractionError) throw error;
    throw new SpecificationExtractionError("PDF_LAYOUT_PARSER_FAILED", "The specification text layer could not be reconstructed safely.", error instanceof Error ? error.message : String(error), "Retry, configure OCR, or upload the DOCX source.");
  }
};

export const extractSpecificationPdfPages = async (bytes, metadata = {}, range = {}) => {
  const normalizedBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return pdfJsPages(normalizedBytes, metadata, range);
};

export const extractSpecificationPdfPagesFromRangeSource = async (rangeSource, metadata = {}, range = {}) => pdfJsPages(null, metadata, range, rangeSource);

export const inspectSpecificationDocumentMap = async (bytes, metadata = {}) => {
  const readiness = inspectPdfReadiness(bytes, metadata);
  if (!readiness.valid) throw new SpecificationExtractionError(readiness.error.code, readiness.error.message, readiness.error.message, "Upload an authorized readable PDF.");
  if (!globalThis.DOMMatrix) globalThis.DOMMatrix = class DOMMatrix { constructor(values = [1, 0, 0, 1, 0, 0]) { [this.a, this.b, this.c, this.d, this.e, this.f] = values; } multiplySelf() { return this; } preMultiplySelf() { return this; } translate() { return this; } scale() { return this; } invertSelf() { return this; } };
  if (!globalThis.ImageData) globalThis.ImageData = class ImageData { constructor(data, width, height) { this.data = data; this.width = width; this.height = height; } };
  if (!globalThis.Path2D) globalThis.Path2D = class Path2D { addPath() {} };
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), disableWorker: true, useSystemFonts: true, isEvalSupported: false });
  const document = await task.promise;
  try {
    const outline = await document.getOutline();
    const bookmarkEntries = [];
    const visit = async (items, depth = 0) => {
      for (const item of items || []) {
        let page = null;
        try {
          const destination = typeof item.dest === "string" ? await document.getDestination(item.dest) : item.dest;
          if (Array.isArray(destination) && destination[0]) page = (await document.getPageIndex(destination[0])) + 1;
        } catch { page = null; }
        bookmarkEntries.push({ title: String(item.title || "").trim() || null, page, depth, method: "PDF Bookmark", confidence: page ? 95 : 70 });
        await visit(item.items, depth + 1);
      }
    };
    await visit(outline);
    const configuredLimit = Number(metadata.documentMapPageLimit || 30);
    const configuredMaximum = Number(metadata.documentMapMaxPages || 100);
    const initialLimit = Math.min(document.numPages, Math.max(1, Math.min(100, Number.isFinite(configuredLimit) ? configuredLimit : 30)));
    const maximumLimit = Math.min(document.numPages, Math.max(initialLimit, Math.min(100, Number.isFinite(configuredMaximum) ? configuredMaximum : 100)));
    let scanLimit = initialLimit;
    let expansionReason = null;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= scanLimit; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({ disableNormalization: false });
      const rows = new Map();
      for (const item of content.items) {
        if (!("str" in item) || !text(item.str)) continue;
        const y = Math.round(Number(item.transform?.[5] || 0) * 2) / 2;
        const row = rows.get(y) || [];
        row.push({ x: Number(item.transform?.[4] || 0), value: text(item.str) });
        rows.set(y, row);
      }
      pages.push({ page: pageNumber, lines: [...rows.entries()].sort(([left], [right]) => right - left).map(([, row]) => row.sort((left, right) => left.x - right.x).map((entry) => entry.value).join(" ").replace(/\s+([,.;:])/g, "$1").trim()).filter(Boolean) });
      page.cleanup();
      if (pageNumber === initialLimit && initialLimit < maximumLimit) {
        const recentLines = pages.slice(-5).flatMap((entry) => entry.lines || []);
        const tocContinues = recentLines.some((line) => /(?:table of contents|contents continued|continued)$/i.test(line));
        const activeHeadings = recentLines.filter((line) => /^(?:SECTION\s+[\d ]{4,}|DIVISION\s+\d{1,2})\b/i.test(line)).length >= 2;
        if (tocContinues || activeHeadings) { scanLimit = maximumLimit; expansionReason = tocContinues ? "TOC continuation" : "Structural headings active at initial boundary"; }
      }
    }
    const mapped = buildSpecificationDocumentMap({ pages, totalPages: document.numPages, bookmarkEntries });
    return { totalPages: document.numPages, initialLimit, scanLimit, expansionReason, ...mapped };
  } finally { await document.destroy(); }
};

export const extractSpecificationDocumentChunk = async (bytes, metadata = {}, range = {}) => {
  const extension = String(metadata.extension || metadata.fileName?.split(".").pop() || "").toLowerCase();
  if (extension !== "pdf") {
    if (Number(range.pageFrom || 1) !== 1) throw new SpecificationExtractionError("CHUNK_RANGE_UNSUPPORTED", "This non-PDF source has no additional page chunk.", "Chunked ranges are supported for PDF specifications.", "Process the source as one bounded document.");
    return extractSpecificationBytes(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), metadata);
  }
  const parserStarted = Date.now();
  const pages = await extractSpecificationPdfPages(bytes, metadata, range);
  const parserMs = Date.now() - parserStarted;
  const segmentationStarted = Date.now();
  const result = extractSpecificationPages(pages, { ...metadata, pageFrom: range.pageFrom, pageTo: range.pageTo, extractionMethod: "pdfjs-coordinate-layout-chunk" });
  return { ...result, timing: { parserMs, segmentationMs: Date.now() - segmentationStarted } };
};

export const extractSpecificationDocumentChunkFromRangeSource = async (rangeSource, metadata = {}, range = {}) => {
  const parserStarted = Date.now();
  const pages = await extractSpecificationPdfPagesFromRangeSource(rangeSource, metadata, range);
  const parserMs = Date.now() - parserStarted;
  const segmentationStarted = Date.now();
  const result = extractSpecificationPages(pages, { ...metadata, pageFrom: range.pageFrom, pageTo: range.pageTo, extractionMethod: "pdfjs-r2-range-layout-chunk" });
  return { ...result, timing: { parserMs, segmentationMs: Date.now() - segmentationStarted } };
};

export const extractSpecificationDocument = async (bytes, metadata = {}) => {
  const extension = String(metadata.extension || metadata.fileName?.split(".").pop() || "").toLowerCase();
  const normalizedBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (extension !== "pdf") return extractSpecificationBytes(normalizedBytes, metadata);
  try { return extractSpecificationBytes(normalizedBytes, metadata); }
  catch (error) {
    if (!['PDF_TEXT_LAYOUT_UNAVAILABLE'].includes(error?.code)) throw error;
    const pages = await pdfJsPages(normalizedBytes, metadata);
    return extractSpecificationPages(pages, { ...metadata, extractionMethod: "pdfjs-coordinate-layout" });
  }
};

export const compareSpecificationRevisions = (previous, current) => { const key = (item) => `${item.sequence}|${item.source?.clause || "unclausified"}`; const before = new Map(previous.map((item) => [key(item), item])); const after = new Map(current.map((item) => [key(item), item])); const changes = []; for (const [identity, item] of after) { const old = before.get(identity); if (!old) changes.push({ type: "Added", identity, current: item }); else if (old.normalizedRequirement !== item.normalizedRequirement || JSON.stringify(old.attributes) !== JSON.stringify(item.attributes) || JSON.stringify(old.standards) !== JSON.stringify(item.standards) || JSON.stringify(old.manufacturers) !== JSON.stringify(item.manufacturers)) changes.push({ type: "Changed", identity, previous: old, current: item }); } for (const [identity, item] of before) if (!after.has(identity)) changes.push({ type: "Removed", identity, previous: item }); return { added: changes.filter((item) => item.type === "Added").length, removed: changes.filter((item) => item.type === "Removed").length, changed: changes.filter((item) => item.type === "Changed").length, changes }; };
