export const DOCUMENT_TYPES = Object.freeze([
  "Project Context", "BOQ", "Specification", "Drawing", "Price List", "Catalogue", "Supplier Quote",
  "Cost Sheet", "Compliance", "Email", "Clarification", "Datasheet", "Tender Document", "Unknown",
]);

export const PROCESSING_STAGES = Object.freeze([
  "Upload", "Integrity Validation", "Classification", "OCR", "Layout Analysis", "Table Detection",
  "Engineering Section Detection", "Metadata Extraction", "Entity Extraction", "Relationship Extraction",
  "Engineering Validation", "Storage", "AI Matching Index",
]);

export const PROCESSING_STATUSES = Object.freeze([
  "Uploaded", "Queued", "Processing", "OCR Running", "Parsing", "Extracting", "Validating",
  "Completed", "Needs Review", "Failed", "Cancelled",
]);

export const PROCESSING_ERROR_CODES = Object.freeze([
  "UNSUPPORTED_FORMAT", "FILE_TOO_LARGE", "EMPTY_FILE", "INTEGRITY_MISMATCH", "DUPLICATE_CONTENT",
  "CORRUPTED_FILE", "PASSWORD_PROTECTED", "UNREADABLE_PDF", "MISSING_PAGES", "MISSING_TABLES",
  "OCR_FAILED", "PARSING_FAILED", "EXTRACTION_FAILED", "VALIDATION_FAILED", "PROCESSOR_UNAVAILABLE",
]);

const extensionOf = (name = "") => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
const normalizedName = (name = "") => name.toLowerCase().replace(/[_-]+/g, " ");

export const classifyDocument = ({ fileName = "", declaredType = "", mimeType = "" } = {}) => {
  if (DOCUMENT_TYPES.includes(declaredType) && declaredType !== "Unknown") return { type: declaredType, confidence: 1, basis: "Human-declared upload intent", needsReview: false };
  const name = normalizedName(fileName);
  if (name.includes("dwg")) return { type: "Drawing", confidence: 1, basis: "DWG filename convention", needsReview: false };
  const rules = [
    ["BOQ", /\bboq\b|bill of quantities/],
    ["Supplier Quote", /supplier.*quot|quotation|quote|rfq response/],
    ["Price List", /price list|pricelist|pricing/],
    ["Cost Sheet", /cost sheet|costing/],
    ["Compliance", /compliance|certificate|civil defense|ul listing|en54/],
    ["Specification", /specification|\bspec\b|\b28 46 00\b/],
    ["Clarification", /clarification|rfi|addendum/],
    ["Datasheet", /datasheet|data sheet/],
    ["Catalogue", /catalogue|catalog/],
    ["Email", /email|message|\.eml$|\.msg$/],
    ["Drawing", /drawing|schematic|layout|riser|cause and effect|-[edt]-\d{2}-/],
    ["Tender Document", /tender|invitation to tender|\bitt\b/],
  ];
  const match = rules.find(([, pattern]) => pattern.test(name));
  if (match) return { type: match[0], confidence: 0.72, basis: "Filename classification rule", needsReview: true };
  if (mimeType.startsWith("image/") || ["dwg", "dxf"].includes(extensionOf(fileName))) return { type: "Drawing", confidence: 0.45, basis: "Format heuristic", needsReview: true };
  return { type: "Unknown", confidence: 0, basis: "No supported classification evidence", needsReview: true };
};

export const validateUploadEnvelope = ({ fileName, byteSize, mimeType, sha256, maxBytes = 100 * 1024 * 1024 } = {}) => {
  const errors = [];
  const extension = extensionOf(fileName);
  const supported = new Set(["pdf", "xlsx", "xls", "csv", "docx", "doc", "png", "jpg", "jpeg", "tif", "tiff", "zip", "eml", "msg"]);
  if (!fileName || !extension || !supported.has(extension)) errors.push({ code: "UNSUPPORTED_FORMAT", message: "Use PDF, Excel, CSV, Word, image, email, or ZIP project evidence." });
  if (!Number.isFinite(byteSize) || byteSize <= 0) errors.push({ code: "EMPTY_FILE", message: "The uploaded file is empty or its size is unavailable." });
  if (Number.isFinite(byteSize) && byteSize > maxBytes) errors.push({ code: "FILE_TOO_LARGE", message: `File exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB synchronous upload limit; use multipart object storage.` });
  if (!/^[a-f0-9]{64}$/i.test(sha256 || "")) errors.push({ code: "INTEGRITY_MISMATCH", message: "A valid SHA-256 content fingerprint is required." });
  return { valid: errors.length === 0, errors, normalized: { fileName, byteSize, mimeType: mimeType || "application/octet-stream", extension, sha256: (sha256 || "").toLowerCase() } };
};

export const createProcessingRun = ({ id, documentVersionId, now, maxAttempts = 3 }) => ({
  id, documentVersionId, stage: PROCESSING_STAGES[0], status: "Uploaded", progress: 0,
  attempt: 0, maxAttempts, cancelRequested: false, error: null, startedAt: null, completedAt: null,
  createdAt: now, updatedAt: now, stageHistory: [{ stage: PROCESSING_STAGES[0], status: "Uploaded", at: now }],
});

const stageStatus = (stage) => stage === "OCR" ? "OCR Running"
  : ["Layout Analysis", "Table Detection"].includes(stage) ? "Parsing"
  : ["Engineering Section Detection", "Metadata Extraction", "Entity Extraction", "Relationship Extraction"].includes(stage) ? "Extracting"
  : stage === "Engineering Validation" ? "Validating" : "Processing";

export const advanceProcessingRun = (run, { now, skipOcr = false } = {}) => {
  if (run.status === "Cancelled" || run.status === "Completed" || run.status === "Failed") return run;
  if (run.cancelRequested) return { ...run, status: "Cancelled", completedAt: now, updatedAt: now, stageHistory: [...run.stageHistory, { stage: run.stage, status: "Cancelled", at: now }] };
  let nextIndex = PROCESSING_STAGES.indexOf(run.stage) + 1;
  if (skipOcr && PROCESSING_STAGES[nextIndex] === "OCR") nextIndex += 1;
  if (nextIndex >= PROCESSING_STAGES.length) return { ...run, status: "Completed", progress: 100, completedAt: now, updatedAt: now, stageHistory: [...run.stageHistory, { stage: run.stage, status: "Completed", at: now }] };
  const stage = PROCESSING_STAGES[nextIndex];
  const status = stageStatus(stage);
  return { ...run, stage, status, progress: Math.round(nextIndex / (PROCESSING_STAGES.length - 1) * 100), startedAt: run.startedAt || now, updatedAt: now, stageHistory: [...run.stageHistory, { stage, status, at: now }] };
};

export const failProcessingRun = (run, { code, message, retryable = false, now }) => {
  if (!PROCESSING_ERROR_CODES.includes(code)) throw new Error(`Unknown processing error code: ${code}`);
  const attempt = run.attempt + 1;
  const canRetry = retryable && attempt < run.maxAttempts;
  return { ...run, attempt, status: canRetry ? "Queued" : "Failed", error: { code, message, retryable: canRetry, at: now }, updatedAt: now, completedAt: canRetry ? null : now, stageHistory: [...run.stageHistory, { stage: run.stage, status: canRetry ? "Queued" : "Failed", at: now, code }] };
};

export const requestProcessingCancellation = (run, now) => ["Completed", "Failed", "Cancelled"].includes(run.status) ? run : { ...run, cancelRequested: true, updatedAt: now };

export const createEngineeringExtractionEnvelope = ({ runId, documentVersionId, documentType, processor, processorVersion }) => ({
  schemaVersion: 1, runId, documentVersionId, documentType, processor, processorVersion,
  pages: [], blocks: [], tables: [], sections: [], entities: [], relationships: [], requirements: [],
  metadata: {}, validationFindings: [], citations: [], warnings: [], createdAt: null,
});

export const validateExtractionEnvelope = (envelope) => {
  const errors = [];
  if (envelope?.schemaVersion !== 1) errors.push("Unsupported extraction schema version");
  for (const field of ["pages", "blocks", "tables", "sections", "entities", "relationships", "requirements", "citations"]) if (!Array.isArray(envelope?.[field])) errors.push(`${field} must be an array`);
  for (const citation of envelope?.citations || []) if (!citation.documentVersionId || !Number.isInteger(citation.pageNumber) || citation.pageNumber < 1) errors.push("Every citation requires a document version and positive page number");
  for (const table of envelope?.tables || []) if (!Array.isArray(table.rows) || !Array.isArray(table.columns) || !table.sourceRegion) errors.push("Engineering tables require rows, columns, and a source region");
  return { valid: errors.length === 0, errors };
};

export const planDocumentProcessing = ({ fileName, pdfInspection, classification } = {}) => {
  const extension = extensionOf(fileName);
  const adapters = extension === "xlsx" ? ["native-openxml", "engineering-table", "engineering-validation"]
    : extension === "xls" ? ["native-biff-ole-readonly", "engineering-table", "engineering-validation"]
    : extension === "csv" ? ["native-csv", "engineering-table", "engineering-validation"]
    : extension === "pdf" ? pdfInspection?.requiresOcr ? ["selective-ocr", "pdf-layout", "engineering-extraction", "engineering-validation"] : ["pdf-layout", "engineering-extraction", "engineering-validation"]
    : ["processor-unavailable"];
  return { documentType: classification?.type || "Unknown", adapters, publishToMatching: false, needsReview: true };
};

export const assessMatchingPublication = ({ run, assertions = [], documentVersionStatus = "", superseded = false } = {}) => {
  const blockers = [];
  if (run?.status !== "Completed") blockers.push("Processing run is not completed");
  if (documentVersionStatus !== "Accepted") blockers.push("Document version has not passed integrity validation");
  if (superseded) blockers.push("Document version is superseded");
  if (!assertions.length) blockers.push("No engineering assertions are available");
  if (assertions.some((assertion) => assertion.reviewStatus !== "Accepted")) blockers.push("All assertions require accepted human review");
  if (assertions.some((assertion) => !assertion.documentVersionId || !assertion.sourceRegion)) blockers.push("Every assertion requires version and source-region provenance");
  return { publishable: blockers.length === 0, blockers };
};
