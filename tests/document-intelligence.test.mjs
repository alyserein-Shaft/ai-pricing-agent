import assert from "node:assert/strict";
import test from "node:test";
import {
  PROCESSING_STAGES, advanceProcessingRun, classifyDocument, createEngineeringExtractionEnvelope,
  createProcessingRun, failProcessingRun, requestProcessingCancellation, validateExtractionEnvelope, validateUploadEnvelope,
} from "../app/domain/document-intelligence.mjs";

const sha = "a".repeat(64);

test("declared document intent takes precedence without pretending it was inferred", () => {
  assert.deepEqual(classifyDocument({ fileName: "anything.pdf", declaredType: "BOQ" }), { type: "BOQ", confidence: 1, basis: "Human-declared upload intent", needsReview: false });
});

test("classifies common engineering evidence conservatively", () => {
  assert.equal(classifyDocument({ fileName: "Project BOQ.xlsx" }).type, "BOQ");
  assert.equal(classifyDocument({ fileName: "Panel UL Compliance Certificate.pdf" }).type, "Compliance");
  const unknown = classifyDocument({ fileName: "attachment.pdf" });
  assert.equal(unknown.type, "Unknown");
  assert.equal(unknown.needsReview, true);
});

test("validates upload integrity and gives actionable errors", () => {
  assert.equal(validateUploadEnvelope({ fileName: "BOQ.xlsx", byteSize: 100, sha256: sha }).valid, true);
  const invalid = validateUploadEnvelope({ fileName: "malware.exe", byteSize: 0, sha256: "bad" });
  assert.deepEqual(invalid.errors.map((error) => error.code), ["UNSUPPORTED_FORMAT", "EMPTY_FILE", "INTEGRITY_MISMATCH"]);
});

test("processing run exposes every stage and skips OCR when native content is usable", () => {
  let run = createProcessingRun({ id: "run-1", documentVersionId: "version-1", now: "t0" });
  run = advanceProcessingRun(run, { now: "t1" });
  run = advanceProcessingRun(run, { now: "t2" });
  run = advanceProcessingRun(run, { now: "t3", skipOcr: true });
  assert.equal(run.stage, "Layout Analysis");
  assert.equal(run.status, "Parsing");
  assert.ok(PROCESSING_STAGES.includes("AI Matching Index"));
});

test("retry policy queues transient failures and eventually fails closed", () => {
  let run = createProcessingRun({ id: "run-1", documentVersionId: "version-1", now: "t0", maxAttempts: 2 });
  run = failProcessingRun(run, { code: "OCR_FAILED", message: "provider timeout", retryable: true, now: "t1" });
  assert.equal(run.status, "Queued");
  run = failProcessingRun(run, { code: "OCR_FAILED", message: "provider timeout", retryable: true, now: "t2" });
  assert.equal(run.status, "Failed");
  assert.equal(run.error.retryable, false);
});

test("cancellation is cooperative and terminal", () => {
  let run = createProcessingRun({ id: "run-1", documentVersionId: "version-1", now: "t0" });
  run = requestProcessingCancellation(run, "t1");
  run = advanceProcessingRun(run, { now: "t2" });
  assert.equal(run.status, "Cancelled");
  assert.equal(advanceProcessingRun(run, { now: "t3" }), run);
});

test("engineering extraction envelope preserves structured tables and citations", () => {
  const envelope = createEngineeringExtractionEnvelope({ runId: "run-1", documentVersionId: "version-1", documentType: "BOQ", processor: "xlsx-native", processorVersion: "1" });
  envelope.tables.push({ columns: ["Description", "Qty"], rows: [["Detector", 10]], sourceRegion: { sheet: "BOQ", range: "A1:B2" } });
  envelope.citations.push({ documentVersionId: "version-1", pageNumber: 1, sourceRegion: { sheet: "BOQ", range: "A2:B2" } });
  assert.equal(validateExtractionEnvelope(envelope).valid, true);
});

test("rejects flattened or untraceable extraction artifacts", () => {
  const envelope = createEngineeringExtractionEnvelope({ runId: "run-1", documentVersionId: "version-1", documentType: "BOQ", processor: "test", processorVersion: "1" });
  envelope.tables.push({ rows: "flattened text", columns: [] });
  envelope.citations.push({ documentVersionId: "", pageNumber: 0 });
  const result = validateExtractionEnvelope(envelope);
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 2);
});
