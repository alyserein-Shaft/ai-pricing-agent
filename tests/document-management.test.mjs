import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { zipSync } from "fflate";
import {
  DOCUMENT_EXTENSIONS, DOCUMENT_TYPES, DocumentValidationError, extensionOf, secureDisplayName,
  secureObjectKey, sha256Hex, validateDocumentBytes,
} from "../app/domain/document-management.mjs";

const bytes = (...values) => new Uint8Array(values);

test("publishes every Task 3 format and engineering category", () => {
  for (const extension of ["pdf", "dwg", "xlsx", "xls", "docx", "doc", "csv", "msg", "eml", "jpg", "png", "tiff", "zip"]) assert.ok(DOCUMENT_EXTENSIONS.includes(extension));
  for (const type of ["BOQ", "Technical Specification", "Drawing", "Catalogue", "Datasheet", "Price List", "Supplier Quotation", "Cost Sheet", "RFQ", "Clarification", "Compliance Document", "Previous Project", "Email", "Other"]) assert.ok(DOCUMENT_TYPES.includes(type));
});

test("removes paths and control characters from original display names", () => {
  assert.equal(secureDisplayName("../../secret/BOQ\u0000.xlsx"), "BOQ.xlsx");
  assert.equal(extensionOf("BOQ.Final.XLSX"), "xlsx");
});

test("creates tenant-independent project-isolated object keys", () => {
  assert.equal(secureObjectKey({ projectId: "p/1", documentId: "d:2", versionId: "v 3", extension: "pdf" }), "projects/p_1/documents/d_2/versions/v_3.pdf");
});

test("accepts real signatures and rejects renamed content", () => {
  assert.equal(validateDocumentBytes({ fileName: "drawing.pdf", mimeType: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.7\n1 0 obj") }).extension, "pdf");
  assert.equal(validateDocumentBytes({ fileName: "drawing.dwg", mimeType: "application/octet-stream", bytes: new TextEncoder().encode("AC1024\0\0\0source") }).extension, "dwg");
  assert.throws(() => validateDocumentBytes({ fileName: "drawing.pdf", mimeType: "application/pdf", bytes: new TextEncoder().encode("not a pdf") }), (error) => error instanceof DocumentValidationError && error.code === "CONTENT_TYPE_MISMATCH");
  assert.throws(() => validateDocumentBytes({ fileName: "drawing.dwg", mimeType: "application/octet-stream", bytes: new TextEncoder().encode("not a dwg") }), (error) => error instanceof DocumentValidationError && error.code === "CONTENT_TYPE_MISMATCH");
});

test("blocks empty, oversized and protected PDF files with actionable codes", () => {
  assert.throws(() => validateDocumentBytes({ fileName: "empty.csv", mimeType: "text/csv", bytes: new Uint8Array() }), (error) => error.code === "EMPTY_FILE");
  assert.throws(() => validateDocumentBytes({ fileName: "large.csv", mimeType: "text/csv", bytes: bytes(1, 2), maxBytes: 1 }), (error) => error.code === "FILE_TOO_LARGE");
  assert.throws(() => validateDocumentBytes({ fileName: "locked.pdf", mimeType: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.7 /Encrypt true") }), (error) => error.code === "PASSWORD_PROTECTED_PDF");
});

test("validates OOXML structure and unsafe ZIP paths", () => {
  const workbook = zipSync({ "xl/workbook.xml": new TextEncoder().encode("<workbook/>") });
  assert.equal(validateDocumentBytes({ fileName: "boq.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: workbook }).extension, "xlsx");
  const fakeWorkbook = zipSync({ "readme.txt": new TextEncoder().encode("missing workbook") });
  assert.throws(() => validateDocumentBytes({ fileName: "boq.xlsx", mimeType: "application/octet-stream", bytes: fakeWorkbook }), (error) => error.code === "CORRUPT_XLSX");
  const unsafe = zipSync({ "../secret.txt": new TextEncoder().encode("x") });
  assert.throws(() => validateDocumentBytes({ fileName: "files.zip", mimeType: "application/zip", bytes: unsafe }), (error) => error.code === "UNSAFE_ARCHIVE_PATH");
});

test("generates stable SHA-256 content fingerprints", async () => {
  assert.equal(await sha256Hex(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("connects durable document APIs before the framework handler", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  const api = await readFile(new URL("../worker/document-api.mjs", import.meta.url), "utf8");
  assert.match(worker, /handleDocumentApi\(request, env, ctx\)/);
  assert.ok(worker.indexOf("handleDocumentApi(request, env, ctx)") < worker.indexOf("handler.fetch(request, env, ctx)"));
  for (const path of ["documents", "download|preview", "history|status", "archive|restore|retry|cancel", "restoreDocumentVersion"]) assert.match(api, new RegExp(path));
  assert.match(api, /env\.FILES\.put\(objectKey, bytes/);
  assert.match(api, /scheduleAutomaticClassification\(env, ctx/);
});

test("declares D1 and R2 bindings and authoritative document entities", async () => {
  const hosting = JSON.parse(await readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"));
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  assert.deepEqual({ d1: hosting.d1, r2: hosting.r2 }, { d1: "DB", r2: "FILES" });
  for (const entity of ["projects", "uploadSessions", "documents", "documentVersions", "documentProcessingRuns", "processingHistory", "documentAuditEvents"]) assert.match(schema, new RegExp(`export const ${entity}`));
});
