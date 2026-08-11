const decoder = new TextDecoder("latin1");

export const inspectPdfReadiness = (bytes, { fileName = "document.pdf" } = {}) => {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const header = decoder.decode(data.slice(0, Math.min(data.length, 1024)));
  if (!header.startsWith("%PDF-")) return { valid: false, fileName, error: { code: "UNREADABLE_PDF", message: "File does not contain a valid PDF header." } };
  const source = decoder.decode(data);
  if (/\/Encrypt\b/.test(source)) return { valid: false, fileName, encrypted: true, error: { code: "PASSWORD_PROTECTED", message: "Password-protected PDFs require an authorized decrypted source before processing." } };
  const pageCount = (source.match(/\/Type\s*\/Page\b/g) || []).length;
  const textOperators = (source.match(/\bBT\b|\bTj\b|\bTJ\b/g) || []).length;
  const imageObjects = (source.match(/\/Subtype\s*\/Image\b/g) || []).length;
  const hasNativeText = textOperators > 0;
  const requiresOcr = !hasNativeText && imageObjects > 0;
  const warnings = [];
  if (!pageCount) warnings.push("PDF page objects could not be counted; parser validation is required.");
  if (!hasNativeText && !imageObjects) warnings.push("No native text operators or image objects were detected; the PDF may be malformed or use unsupported compression.");
  return { valid: true, fileName, encrypted: false, pageCount, hasNativeText, imageObjects, requiresOcr, route: requiresOcr ? "Selective OCR" : hasNativeText ? "Native PDF layout parser" : "Needs Review", warnings };
};
