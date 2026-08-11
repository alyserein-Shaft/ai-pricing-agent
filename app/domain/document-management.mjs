import { unzipSync } from "fflate";

export const DOCUMENT_EXTENSIONS = Object.freeze([
  "pdf", "dwg", "xlsx", "xls", "docx", "doc", "csv", "msg", "eml", "jpg", "jpeg", "png", "tif", "tiff", "zip",
]);

export const DOCUMENT_TYPES = Object.freeze([
  "Auto Detection", "BOQ", "Technical Specification", "Drawing", "Catalogue", "Datasheet", "Price List",
  "Supplier Quotation", "Cost Sheet", "RFQ", "Clarification", "Compliance Document", "Previous Project", "Email", "Other",
]);

export const PROCESSING_STATUSES = Object.freeze([
  "Uploaded", "Queued", "Validating", "Waiting", "Processing", "Completed", "Needs Review", "Failed", "Cancelled", "Retrying",
]);

export const DUPLICATE_ACTIONS = Object.freeze(["replace", "keep_both", "new_version", "cancel"]);
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const MIME_BY_EXTENSION = Object.freeze({
  pdf: ["application/pdf"],
  dwg: ["application/acad", "application/x-acad", "application/autocad_dwg", "application/dwg", "image/vnd.dwg", "application/octet-stream"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip", "application/octet-stream"],
  xls: ["application/vnd.ms-excel", "application/octet-stream"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip", "application/octet-stream"],
  doc: ["application/msword", "application/octet-stream"],
  csv: ["text/csv", "text/plain", "application/vnd.ms-excel", "application/octet-stream"],
  msg: ["application/vnd.ms-outlook", "application/octet-stream"],
  eml: ["message/rfc822", "text/plain", "application/octet-stream"],
  jpg: ["image/jpeg"], jpeg: ["image/jpeg"], png: ["image/png"],
  tif: ["image/tiff", "application/octet-stream"], tiff: ["image/tiff", "application/octet-stream"],
  zip: ["application/zip", "application/x-zip-compressed", "application/octet-stream"],
});

export class DocumentValidationError extends Error {
  constructor(code, message, suggestedAction, technicalDetails = "") {
    super(message);
    this.name = "DocumentValidationError";
    this.code = code;
    this.suggestedAction = suggestedAction;
    this.technicalDetails = technicalDetails;
  }
}

export const extensionOf = (fileName = "") => {
  const clean = String(fileName).trim();
  const dot = clean.lastIndexOf(".");
  return dot > -1 ? clean.slice(dot + 1).toLowerCase() : "";
};

export const secureDisplayName = (fileName = "document") => {
  const leaf = String(fileName).replaceAll("\\", "/").split("/").pop() || "document";
  return leaf.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255) || "document";
};

export const secureObjectKey = ({ projectId, documentId, versionId, extension }) => {
  const safe = (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 96);
  return `projects/${safe(projectId)}/documents/${safe(documentId)}/versions/${safe(versionId)}.${safe(extension)}`;
};

const startsWith = (bytes, signature) => signature.every((value, index) => bytes[index] === value);
const textSample = (bytes) => new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 2_000_000)));

const validateMagic = (extension, mimeType, bytes) => {
  if (extension === "pdf" && !startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "The file does not have a valid PDF signature.";
  if (extension === "dwg" && !/^AC10\d{2}/.test(textSample(bytes).slice(0, 6))) return "The file does not have a valid DWG signature.";
  if (["jpg", "jpeg"].includes(extension) && !startsWith(bytes, [0xff, 0xd8, 0xff])) return "The file does not have a valid JPEG signature.";
  if (extension === "png" && !startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "The file does not have a valid PNG signature.";
  if (["tif", "tiff"].includes(extension) && !(startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a]))) return "The file does not have a valid TIFF signature.";
  if (["xls", "doc", "msg"].includes(extension) && !startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return `The .${extension} file does not have a valid legacy Office signature.`;
  if (["xlsx", "docx", "zip"].includes(extension) && !(startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) || startsWith(bytes, [0x50, 0x4b, 0x07, 0x08]))) return `The .${extension} file does not have a valid ZIP container signature.`;
  if (mimeType && !MIME_BY_EXTENSION[extension]?.includes(mimeType.toLowerCase())) return `MIME type ${mimeType} does not match .${extension}.`;
  return "";
};

export const validateDocumentBytes = ({ fileName, mimeType = "application/octet-stream", bytes, maxBytes = MAX_UPLOAD_BYTES }) => {
  const originalFilename = secureDisplayName(fileName);
  const extension = extensionOf(originalFilename);
  if (!DOCUMENT_EXTENSIONS.includes(extension)) throw new DocumentValidationError("UNSUPPORTED_FORMAT", `.${extension || "unknown"} files are not supported.`, `Use one of: ${DOCUMENT_EXTENSIONS.join(", ")}.`);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new DocumentValidationError("EMPTY_FILE", "The selected file is empty.", "Select a non-empty source document.");
  if (bytes.byteLength > maxBytes) throw new DocumentValidationError("FILE_TOO_LARGE", `The file exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`, "Split or compress the document and upload it again.");
  const magicError = validateMagic(extension, mimeType, bytes);
  if (magicError) throw new DocumentValidationError("CONTENT_TYPE_MISMATCH", magicError, "Export the source again in its original format; do not only rename its extension.");
  if (extension === "pdf" && /\/Encrypt\b/.test(textSample(bytes))) throw new DocumentValidationError("PASSWORD_PROTECTED_PDF", "Password-protected PDFs cannot enter processing.", "Upload an authorized unprotected copy.");
  if (["xlsx", "docx", "zip"].includes(extension)) {
    let entries;
    try { entries = unzipSync(bytes); } catch (error) { throw new DocumentValidationError("INVALID_ZIP", `The .${extension} container is corrupt.`, "Repair or re-export the file.", error instanceof Error ? error.message : String(error)); }
    const names = Object.keys(entries);
    if (!names.length) throw new DocumentValidationError("INVALID_ZIP", "The archive has no entries.", "Upload a valid non-empty archive.");
    if (names.some((name) => name.startsWith("/") || name.includes("../") || name.includes("..\\"))) throw new DocumentValidationError("UNSAFE_ARCHIVE_PATH", "The archive contains an unsafe path.", "Remove traversal paths and recreate the archive.");
    if (extension === "xlsx" && !names.includes("xl/workbook.xml")) throw new DocumentValidationError("CORRUPT_XLSX", "The workbook structure is incomplete.", "Open and re-save the workbook before uploading.");
    if (extension === "docx" && !names.includes("word/document.xml")) throw new DocumentValidationError("CORRUPT_DOCX", "The Word document structure is incomplete.", "Open and re-save the document before uploading.");
  }
  return { originalFilename, extension, mimeType: mimeType || "application/octet-stream", byteSize: bytes.byteLength };
};

export const sha256Hex = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((value) => value.toString(16).padStart(2, "0")).join("");

export const documentError = (error) => error instanceof DocumentValidationError
  ? { code: error.code, message: error.message, technicalDetails: error.technicalDetails, suggestedAction: error.suggestedAction, retryable: false }
  : { code: "UNEXPECTED_UPLOAD_ERROR", message: "The document could not be stored.", technicalDetails: error instanceof Error ? error.message : String(error), suggestedAction: "Retry. If the problem continues, contact support with the error code.", retryable: true };
