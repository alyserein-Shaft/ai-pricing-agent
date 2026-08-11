import { unzipSync } from "fflate";
import { detectBoqTable, parseXlsxWorkbook } from "../document-parsers/xlsx.mjs";
import { parseXlsWorkbook } from "../document-parsers/xls.mjs";
import { inspectPdfReadiness } from "../document-parsers/pdf-readiness.mjs";

export const CLASSIFICATION_TAXONOMY = Object.freeze([
  "BOQ", "Technical Specification", "Drawing", "Product Catalogue", "Product Datasheet", "Price List",
  "Supplier Quotation", "Cost Sheet", "RFQ", "Tender Document", "Compliance Document", "Clarification",
  "Approved Vendor List", "Previous Project Reference", "Project Email", "Commercial Offer", "Technical Offer",
  "Contract", "Other", "Unknown",
]);

export const CLASSIFICATION_STATUSES = Object.freeze([
  "Not Classified", "Classification Queued", "Classifying", "Classified", "Needs Review", "Manually Confirmed", "Classification Failed", "Unknown",
]);

export const CLASSIFIER_VERSION = "hybrid-engine-1.0.2";
export const RULESET_VERSION = "construction-taxonomy-2026-08-04.2";
export const PROMPT_VERSION = "classification-escalation-v1";

export const DOWNSTREAM_ROUTES = Object.freeze({
  BOQ: "BOQ Extraction", "Technical Specification": "Specification Extraction", Drawing: "Drawing Analysis",
  "Price List": "Price Library Import", "Supplier Quotation": "Supplier Quote Extraction", "Product Catalogue": "Product Library Extraction",
  "Product Datasheet": "Product Attribute Extraction", "Project Email": "Email and Attachment Parsing", "Cost Sheet": "Cost Sheet Extraction",
  "Compliance Document": "Compliance Matrix Extraction", RFQ: "RFQ Intake", Clarification: "Clarification Intake",
  "Approved Vendor List": "Approved Vendor Intake", "Commercial Offer": "Commercial Offer Extraction", "Technical Offer": "Technical Offer Extraction",
  "Tender Document": "Tender Package Review", Contract: "Contract Review", "Previous Project Reference": "Historical Reference Review",
  Other: "Manual Routing", Unknown: "Manual Classification",
});

const CATEGORY_PROFILES = Object.freeze({
  BOQ: "bill item item no description unit quantity qty uom section boq reference material equipment",
  "Technical Specification": "section part general products execution standards submittals installation testing commissioning approved manufacturers shall specification",
  Drawing: "drawing number revision scale title block floor plan legend symbols zones layout riser schematic detail",
  "Product Catalogue": "product family models features benefits applications portfolio catalogue manufacturer selection guide",
  "Product Datasheet": "technical specifications dimensions ratings certification ordering information model environmental operating temperature datasheet",
  "Price List": "part number product description list price currency discount effective date price list multiple models",
  "Supplier Quotation": "quotation number quote supplier customer validity payment terms delivery unit price discount subtotal vat grand total signature",
  "Cost Sheet": "internal cost list price discount net cost quantity margin selling price installation freight overhead profit cost sheet",
  RFQ: "request for quotation requested items response date quantity delivery location commercial instructions supplier recipient rfq",
  "Tender Document": "invitation to tender instructions to bidders tender submission bid deadline scope conditions employer consultant",
  "Compliance Document": "comply not comply deviation requirement reference offered model remarks compliance statement clause response",
  Clarification: "question response rfi clarification consultant reply contractor query addendum technical interpretation",
  "Approved Vendor List": "approved vendor manufacturer list approved makes suppliers brands avl",
  "Previous Project Reference": "previous project reference historical project completed project client location contract value experience",
  "Project Email": "from to cc subject sent date message attachments reply forwarded email",
  "Commercial Offer": "commercial offer price schedule terms conditions validity payment delivery total vat offer",
  "Technical Offer": "technical offer proposed solution compliance architecture methodology equipment schedule technical submission",
  Contract: "agreement contract parties terms obligations effective date termination governing law signatures",
  Other: "document information project general attachment",
});

const STRONG_PATTERNS = Object.freeze({
  BOQ: [[/\b(item\s*(?:no|number|#)|bill\s*item)\b/i, 14, "Bill-item identifier"], [/\b(quantity|qty)\b/i, 12, "Quantity field"], [/\b(unit|uom)\b/i, 10, "Unit field"], [/\bdescription\b/i, 8, "Description field"]],
  "Technical Specification": [[/\bpart\s*1\s*[-–:]?\s*general\b/i, 20, "Part 1 General hierarchy"], [/\bpart\s*2\s*[-–:]?\s*products\b/i, 20, "Part 2 Products hierarchy"], [/\bpart\s*3\s*[-–:]?\s*execution\b/i, 20, "Part 3 Execution hierarchy"], [/\bsubmittals?|testing and commissioning|approved manufacturers?\b/i, 9, "Specification obligation language"]],
  Drawing: [[/\bdrawing\s*(?:no|number)\b/i, 16, "Drawing number field"], [/\bscale\s*[:=]/i, 14, "Drawing scale"], [/\b(title block|floor plan|riser diagram|schematic|legend)\b/i, 12, "Drawing layout terminology"], [/\bcause\s*(?:and|&)\s*effect\s*matrix\b/i, 26, "Cause-and-effect drawing matrix"]],
  "Product Catalogue": [[/\b(product range|product family|selection guide|our products|applications)\b/i, 12, "Broad product-family language"], [/\bfeatures\s*(?:and|&)\s*benefits\b/i, 10, "Catalogue marketing structure"]],
  "Product Datasheet": [[/\btechnical specifications?\b/i, 12, "Technical specification table"], [/\b(ordering information|dimensions|operating temperature|rated voltage|certifications?)\b/i, 10, "Product attribute field"]],
  "Price List": [[/\b(list price|unit price)\b/i, 16, "Price column"], [/\b(part|model|catalog)\s*(?:no|number|#)\b/i, 12, "Product identifier column"], [/\b(currency|effective date|discount)\b/i, 8, "Commercial price-list field"]],
  "Supplier Quotation": [[/\b(quotation|quote)\s*(?:no|number|#)\b/i, 22, "Quotation reference"], [/\b(validity|valid until|payment terms|delivery)\b/i, 9, "Quotation terms"], [/\b(subtotal|grand total|vat|total amount)\b/i, 12, "Quotation totals"]],
  "Cost Sheet": [[/\b(net cost|internal cost|selling price|gross margin|profit margin|overheads?)\b/i, 15, "Internal costing field"], [/\bfreight|installation|commissioning\b/i, 6, "Cost build-up component"]],
  RFQ: [[/\brequest for quotation\b/i, 28, "RFQ title"], [/\b(required response|quotation due|response date|please quote)\b/i, 12, "RFQ response instruction"]],
  "Tender Document": [[/\b(invitation to tender|instructions to bidders?|tender submission|bid deadline)\b/i, 18, "Tender instruction"]],
  "Compliance Document": [[/\b(not comply|complies?|deviation)\b/i, 14, "Compliance decision"], [/\b(requirement reference|offered model|remarks)\b/i, 9, "Compliance matrix field"]],
  Clarification: [[/\b(rfi|clarification)\s*(?:no|number|#)\b/i, 20, "Clarification reference"], [/\b(contractor query|consultant reply|question|response)\b/i, 8, "Question/response structure"]],
  "Approved Vendor List": [[/\bapproved\s*(?:vendor|manufacturer|make|brand)s?\b/i, 24, "Approved vendor heading"]],
  "Previous Project Reference": [[/\b(previous|completed|reference)\s*projects?\b/i, 18, "Previous-project heading"], [/\bcontract value|completion date|client reference\b/i, 8, "Project reference field"]],
  "Project Email": [[/^from:\s*.+$/im, 12, "Email From header"], [/^to:\s*.+$/im, 12, "Email To header"], [/^subject:\s*.+$/im, 12, "Email Subject header"], [/^(sent|date):\s*.+$/im, 8, "Email date header"]],
  "Commercial Offer": [[/\bcommercial offer\b/i, 24, "Commercial offer title"], [/\b(price schedule|commercial terms)\b/i, 10, "Commercial-offer structure"]],
  "Technical Offer": [[/\btechnical offer|technical proposal\b/i, 24, "Technical offer title"], [/\b(proposed solution|methodology|system architecture)\b/i, 10, "Technical-offer structure"]],
  Contract: [[/\b(this agreement|contract between|parties agree|governing law|termination)\b/i, 16, "Contract clause language"]],
});

const normalize = (value = "") => String(value).toLowerCase().replace(/[^a-z0-9@._%+\-]+/g, " ").replace(/\s+/g, " ").trim();
const tokens = (value) => normalize(value).split(" ").filter((token) => token.length > 2);
const cosine = (left, right) => {
  const counts = (value) => tokens(value).reduce((map, token) => map.set(token, (map.get(token) || 0) + 1), new Map());
  const a = counts(left);
  const b = counts(right);
  const vocabulary = new Set([...a.keys(), ...b.keys()]);
  let dot = 0; let aa = 0; let bb = 0;
  for (const token of vocabulary) { const av = a.get(token) || 0; const bv = b.get(token) || 0; dot += av * bv; aa += av * av; bb += bv * bv; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
};

const xmlText = (source) => String(source).replace(/<[^>]+>/g, " ").replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replace(/\s+/g, " ").trim();
const latin = (bytes) => new TextDecoder("latin1").decode(bytes);
const utf8 = (bytes) => new TextDecoder("utf-8", { fatal: false }).decode(bytes);

const pdfLiteralText = (source) => [...source.matchAll(/\(((?:\\.|[^\\)])*)\)\s*(?:Tj|['"])/g)].map((match) => match[1].replace(/\\([()\\])/g, "$1")).join(" ");

export const sampleDocumentContent = (bytes, { extension, fileName = "document" } = {}) => {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (["xls", "xlsx"].includes(extension)) {
    const workbook = extension === "xls" ? parseXlsWorkbook(data, { fileName }) : parseXlsxWorkbook(data, { fileName });
    const segments = workbook.sheets.map((sheet) => ({ kind: "sheet", label: sheet.name, sheetName: sheet.name, text: sheet.rows.flatMap((row) => row.cells.map((cell) => String(cell.value ?? ""))).join(" ").slice(0, 200_000), structure: { rowCount: sheet.rows.length, columnCount: sheet.maxColumn, mergedRanges: sheet.mergedRanges.length, tableDensity: sheet.rows.length ? sheet.rows.filter((row) => row.cells.length >= 3).length / sheet.rows.length : 0 } }));
    return { readable: segments.some((segment) => segment.text.trim()), extractionMethod: workbook.provenance.parser, extractionQuality: segments.length ? (extension === "xls" ? 0.9 : 0.98) : 0, text: segments.map((segment) => `${segment.label} ${segment.text}`).join(" "), segments, structure: { sheetCount: segments.length, pageCount: 0 }, warnings: workbook.warnings };
  }
  if (extension === "docx") {
    const archive = unzipSync(data);
    const body = archive["word/document.xml"];
    if (!body) throw Object.assign(new Error("DOCX package has no document body."), { code: "MISSING_DOCUMENT_BODY" });
    const text = xmlText(utf8(body)).slice(0, 500_000);
    return { readable: Boolean(text), extractionMethod: "native-openxml", extractionQuality: text ? 0.95 : 0, text, segments: [{ kind: "section", label: "Document body", section: "body", text, structure: {} }], structure: { pageCount: 0, sheetCount: 0 } };
  }
  if (extension === "pdf") {
    const readiness = inspectPdfReadiness(data, { fileName });
    if (!readiness.valid) throw Object.assign(new Error(readiness.error.message), { code: readiness.error.code });
    if (readiness.requiresOcr) return { readable: false, requiresOcr: true, extractionMethod: "pdf-readiness", extractionQuality: 0, text: "", segments: [], structure: { pageCount: readiness.pageCount, imageObjects: readiness.imageObjects }, warnings: ["Image-only PDF requires OCR before classification."] };
    const source = latin(data);
    const rawPages = source.split(/(?=\/Type\s*\/Page\b)/g).slice(1);
    const segments = rawPages.map((page, index) => { const text = pdfLiteralText(page).slice(0, 100_000); return { kind: "page", label: `Page ${index + 1}`, pageFrom: index + 1, pageTo: index + 1, text, structure: { imageObjects: (page.match(/\/Subtype\s*\/Image\b/g) || []).length, textOperators: (page.match(/\bTj\b|\bTJ\b/g) || []).length } }; });
    const text = (segments.length ? segments.map((segment) => segment.text).join(" ") : pdfLiteralText(source)).slice(0, 500_000);
    return { readable: Boolean(text.trim()), extractionMethod: "native-pdf-literal-sampler", extractionQuality: text.trim() ? 0.68 : 0.1, text, segments, structure: { pageCount: readiness.pageCount, imageObjects: readiness.imageObjects }, warnings: readiness.warnings };
  }
  if (["csv", "eml"].includes(extension)) {
    const text = utf8(data).slice(0, 500_000);
    const rows = text.split(/\r?\n/);
    return { readable: Boolean(text.trim()), extractionMethod: extension === "eml" ? "rfc822-text" : "native-text", extractionQuality: 0.96, text, segments: [{ kind: extension === "eml" ? "section" : "sheet", label: extension === "eml" ? "Email message" : "CSV", sheetName: extension === "csv" ? "CSV" : undefined, text, structure: { rowCount: rows.length, columnCount: Math.max(0, ...rows.slice(0, 100).map((row) => row.split(",").length)), tableDensity: rows.length ? rows.filter((row) => row.split(",").length >= 3).length / rows.length : 0 } }], structure: { pageCount: 0, sheetCount: extension === "csv" ? 1 : 0 } };
  }
  if (extension === "zip") {
    const archive = unzipSync(data);
    const segments = Object.entries(archive).filter(([name, content]) => !name.endsWith("/") && content.length <= 2_000_000 && /\.(txt|csv|eml|xml|md)$/i.test(name)).slice(0, 50).map(([name, content]) => ({ kind: "section", label: name, section: name, text: utf8(content).slice(0, 100_000), structure: {} }));
    const text = segments.map((segment) => `${segment.label} ${segment.text}`).join(" ");
    return { readable: Boolean(text.trim()), extractionMethod: "safe-archive-sampler", extractionQuality: text ? 0.75 : 0, text, segments, structure: { archiveEntries: Object.keys(archive).length }, warnings: text ? [] : ["Archive contains no directly readable text entries."] };
  }
  if (["jpg", "jpeg", "png", "tif", "tiff"].includes(extension)) return { readable: false, requiresOcr: true, extractionMethod: "image-metadata", extractionQuality: 0, text: "", segments: [], structure: { imageCount: 1 }, warnings: ["Image requires OCR before content classification."] };
  if (["doc", "msg"].includes(extension)) return { readable: false, extractionMethod: "legacy-container-readiness", extractionQuality: 0, text: "", segments: [], structure: {}, warnings: [`Legacy .${extension} content requires a sandboxed converter.`] };
  const text = utf8(data).slice(0, 500_000);
  return { readable: Boolean(text.trim()), extractionMethod: "native-text", extractionQuality: text ? 0.8 : 0, text, segments: [{ kind: "section", label: "Content", text, structure: {} }], structure: {} };
};

const structureBonuses = (sample) => {
  const bonuses = {};
  for (const segment of sample.segments || []) {
    const { rowCount = 0, columnCount = 0, tableDensity = 0, imageObjects = 0, textOperators = 0 } = segment.structure || {};
    if (rowCount >= 3 && columnCount >= 3 && tableDensity > 0.4) { bonuses.BOQ = (bonuses.BOQ || 0) + 5; bonuses["Price List"] = (bonuses["Price List"] || 0) + 5; bonuses["Cost Sheet"] = (bonuses["Cost Sheet"] || 0) + 4; }
    if (imageObjects >= 2 && textOperators <= 2) bonuses.Drawing = (bonuses.Drawing || 0) + 10;
  }
  return bonuses;
};

const evidenceForCategory = (category, text, segment, method) => (STRONG_PATTERNS[category] || []).flatMap(([pattern, weight, label]) => {
  const match = text.match(pattern);
  return match ? [{ category, kind: "Pattern", label, excerpt: match[0].slice(0, 180), weight, method: `${method}:${RULESET_VERSION}`, pageFrom: segment?.pageFrom || null, pageTo: segment?.pageTo || null, sheetName: segment?.sheetName || null, section: segment?.section || null }] : [];
});

export const hasDwgFilenameMarker = (fileName = "") =>
  String(fileName).toLowerCase().includes("dwg");

const classifyDwgFilename = (sample, fileName) => ({
  primaryType: "Drawing",
  secondaryTypes: [],
  confidence: 100,
  confidenceState: "Verified",
  status: "Classified",
  manualReviewRequired: false,
  method: "Deterministic filename convention",
  classifierVersion: CLASSIFIER_VERSION,
  rulesetVersion: RULESET_VERSION,
  promptVersion: PROMPT_VERSION,
  evidence: [
    {
      category: "Drawing",
      kind: "Filename Convention",
      label: "DWG filename token",
      excerpt: String(fileName),
      weight: 100,
      method: `filename-convention:${RULESET_VERSION}`,
      pageFrom: null,
      pageTo: null,
      sheetName: null,
      section: null,
    },
  ],
  alternatives: [],
  segments: [],
  mixed: false,
  extractionQuality: sample.extractionQuality || 0,
  extractionMethod: sample.extractionMethod || "filename-only",
  downstreamRoute: DOWNSTREAM_ROUTES.Drawing,
  error: null,
});

export const classifySample = (sample, { fileName = "", declaredType = "Auto Detection", projectContext = "" } = {}) => {
  if (hasDwgFilenameMarker(fileName)) {
    return classifyDwgFilename(sample, fileName);
  }
  if (!sample.readable) {
    const requiresOcr = Boolean(sample.requiresOcr);
    return { primaryType: "Unknown", secondaryTypes: [], confidence: 0, confidenceState: "Unknown", status: "Needs Review", manualReviewRequired: true, method: "Readiness only", classifierVersion: CLASSIFIER_VERSION, rulesetVersion: RULESET_VERSION, promptVersion: PROMPT_VERSION, evidence: [], alternatives: [], segments: [], downstreamRoute: DOWNSTREAM_ROUTES.Unknown, error: { code: requiresOcr ? "OCR_REQUIRED" : "UNREADABLE_CONTENT", userMessage: requiresOcr ? "Content requires OCR before it can be classified." : "The file format is valid but its content could not be read.", technicalDetails: (sample.warnings || []).join(" "), suggestedAction: requiresOcr ? "Run OCR when an approved OCR provider is configured, or classify manually." : "Upload a modern readable format or classify manually.", retryable: requiresOcr } };
  }
  const content = sample.text.slice(0, 500_000);
  const bonuses = structureBonuses(sample);
  if (/(?:^|[-_])DR[-_][A-Z][-_]\d{2}(?:[-_]|$)/i.test(fileName)) bonuses.Drawing = (bonuses.Drawing || 0) + 18;
  const candidates = Object.entries(CATEGORY_PROFILES).map(([category, profile]) => {
    const evidence = evidenceForCategory(category, content, null, "document");
    const rulePoints = evidence.reduce((sum, item) => sum + item.weight, 0);
    const lexicalSimilarity = cosine(content.slice(0, 120_000), profile);
    const contextSimilarity = projectContext ? cosine(projectContext, profile) : 0;
    const declaredAgreement = declaredType && declaredType !== "Auto Detection" && ({ Catalogue: "Product Catalogue", Datasheet: "Product Datasheet", "Price List": "Price List", "Supplier quotation": "Supplier Quotation", BOQ: "BOQ", Specification: "Technical Specification", Drawing: "Drawing" }[declaredType] || declaredType) === category ? 2 : 0;
    const filenameSimilarity = cosine(fileName, profile);
    const rawScore = rulePoints + lexicalSimilarity * 32 + contextSimilarity * 4 + filenameSimilarity * 2 + (bonuses[category] || 0) + declaredAgreement;
    return { type: category, rawScore, rulePoints, lexicalSimilarity, contextSimilarity, filenameSimilarity, evidence };
  }).sort((a, b) => b.rawScore - a.rawScore);
  const positive = candidates.filter((candidate) => candidate.rawScore > 0);
  const total = positive.reduce((sum, candidate) => sum + Math.exp(candidate.rawScore / 12), 0) || 1;
  const ranked = candidates.map((candidate) => ({ ...candidate, probability: Math.exp(candidate.rawScore / 12) / total }));
  const best = ranked[0]; const second = ranked[1];
  const contentSupport = best.rulePoints > 0 || best.lexicalSimilarity >= 0.08;
  const filenameOnly = !contentSupport && best.filenameSimilarity > 0;
  const gap = best.probability - (second?.probability || 0);
  let confidence = Math.round(Math.min(0.98, Math.max(0, best.probability * 0.65 + Math.min(best.rulePoints, 50) / 100 + sample.extractionQuality * 0.15)) * 100);
  if (filenameOnly) confidence = Math.min(confidence, 39);
  if (sample.extractionQuality < 0.5) confidence = Math.min(confidence, 49);
  if (gap < 0.12) confidence = Math.min(confidence, 64);
  const segmentResults = (sample.segments || []).map((segment) => {
    const local = Object.keys(CATEGORY_PROFILES).map((category) => { const evidence = evidenceForCategory(category, segment.text, segment, "segment"); const score = evidence.reduce((sum, item) => sum + item.weight, 0) + cosine(segment.text, CATEGORY_PROFILES[category]) * 32; return { type: category, score, evidence }; }).sort((a, b) => b.score - a.score);
    return { kind: segment.kind, label: segment.label, pageFrom: segment.pageFrom || null, pageTo: segment.pageTo || null, sheetName: segment.sheetName || null, section: segment.section || null, primaryType: local[0]?.score > 2 ? local[0].type : "Unknown", confidence: Math.round(Math.min(95, (local[0]?.score || 0) * 2.5)), evidence: local[0]?.evidence || [] };
  });
  const segmentTypes = [...new Set(segmentResults.map((segment) => segment.primaryType).filter((type) => type !== "Unknown"))];
  const mixed = segmentTypes.length > 1;
  if (mixed) confidence = Math.min(confidence, 64);
  const unknown = !contentSupport || best.rawScore < 4;
  const primaryType = unknown ? "Unknown" : best.type;
  const manualReviewRequired = unknown || confidence < 80 || mixed || gap < 0.12 || sample.extractionQuality < 0.7;
  const confidenceState = unknown ? "Unknown" : confidence >= 95 && !manualReviewRequired ? "Verified" : confidence >= 80 ? "High Confidence" : confidence >= 60 ? "Medium Confidence" : confidence >= 40 ? "Low Confidence" : "Needs Review";
  const alternatives = ranked.slice(1, 6).map((candidate) => ({ type: candidate.type, confidence: Math.round(candidate.probability * 100), score: Number(candidate.rawScore.toFixed(3)) }));
  const secondaryTypes = [...new Set([...segmentTypes.filter((type) => type !== primaryType), ...alternatives.filter((candidate) => candidate.confidence >= 25).map((candidate) => candidate.type)])].slice(0, 6);
  const evidence = [...best.evidence, { category: primaryType, kind: "Statistical", label: "Content-profile similarity", excerpt: "", weight: Math.round(best.lexicalSimilarity * 100), method: `lexical-centroid:${CLASSIFIER_VERSION}`, pageFrom: null, pageTo: null, sheetName: null, section: null }, ...(bonuses[best.type] ? [{ category: primaryType, kind: "Structure", label: "Document structure supports this category", excerpt: "", weight: bonuses[best.type], method: `structure:${RULESET_VERSION}`, pageFrom: null, pageTo: null, sheetName: null, section: null }] : [])].filter((item) => item.weight > 0);
  return { primaryType, secondaryTypes, confidence, confidenceState, status: unknown ? "Unknown" : manualReviewRequired ? "Needs Review" : "Classified", manualReviewRequired, method: "Hybrid deterministic + lexical statistical", classifierVersion: CLASSIFIER_VERSION, rulesetVersion: RULESET_VERSION, promptVersion: PROMPT_VERSION, evidence, alternatives, segments: segmentResults, mixed, extractionQuality: sample.extractionQuality, extractionMethod: sample.extractionMethod, downstreamRoute: DOWNSTREAM_ROUTES[primaryType] || DOWNSTREAM_ROUTES.Unknown, error: null };
};

export const classifyDocumentBytes = (bytes, input = {}) => {
  const sample = sampleDocumentContent(bytes, input);
  const result = classifySample(sample, input);
  if (["xls", "xlsx"].includes(input.extension)) {
    const workbook = input.extension === "xls" ? parseXlsWorkbook(bytes, input) : parseXlsxWorkbook(bytes, input);
    const boqTables = workbook.sheets.map((sheet) => ({ sheet, table: detectBoqTable(sheet) })).filter((entry) => entry.table);
    const substantiveOtherType = result.segments.some((segment) => segment.primaryType !== "BOQ" && segment.primaryType !== "Unknown" && segment.confidence >= 40);
    if (boqTables.length && !substantiveOtherType && (result.primaryType === "BOQ" || boqTables.length >= Math.ceil(workbook.sheets.length * 0.6))) {
      const confidence = Math.min(96, 82 + Math.min(10, boqTables.length * 2));
      return { ...result, primaryType: "BOQ", secondaryTypes: result.primaryType === "BOQ" ? result.secondaryTypes : [...new Set([result.primaryType, ...result.secondaryTypes].filter((type) => type !== "Unknown" && type !== "BOQ"))].slice(0, 6), confidence, confidenceState: "High Confidence", status: "Classified", manualReviewRequired: false, mixed: false, downstreamRoute: DOWNSTREAM_ROUTES.BOQ, evidence: [...result.evidence, ...boqTables.slice(0, 10).map(({ sheet, table }) => ({ category: "BOQ", kind: "Structure", label: "Verified BOQ column mapping", excerpt: "Description, unit and quantity columns detected", weight: 24, method: `boq-table:${RULESET_VERSION}`, pageFrom: null, pageTo: null, sheetName: sheet.name, section: `Header row ${table.headerRow}` }))] };
    }
  }
  return result;
};

export const validateAiClassification = (candidate) => {
  const errors = [];
  if (!CLASSIFICATION_TAXONOMY.includes(candidate?.primaryType)) errors.push("Unsupported primary type");
  if (!Number.isFinite(candidate?.confidence) || candidate.confidence < 0 || candidate.confidence > 100) errors.push("Confidence must be 0-100");
  if (!Array.isArray(candidate?.evidence) || !candidate.evidence.length) errors.push("AI classification requires evidence");
  if (!Array.isArray(candidate?.alternatives)) errors.push("AI alternatives are required");
  if (!candidate?.modelVersion || !candidate?.promptVersion) errors.push("AI model and prompt versions are required");
  return { valid: errors.length === 0, errors };
};
