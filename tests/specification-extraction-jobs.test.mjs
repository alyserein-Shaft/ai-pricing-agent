import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildSpecificationChunks, buildSpecificationDocumentMap, mapSpecificationPages, progressSnapshot } from "../app/domain/specification-extraction-jobs.mjs";

for (const [pages, expected] of [[100, 2], [500, 10], [1000, 20], [2500, 50]]) {
  test(`plans ${pages} pages as bounded restart-safe chunks`, () => {
    const chunks = buildSpecificationChunks({ totalPages: pages, chunkSize: 50 });
    assert.equal(chunks.length, expected);
    assert.ok(chunks.every((chunk) => chunk.pageCount <= 50));
    assert.deepEqual(new Set(chunks.flatMap((chunk) => Array.from({ length: chunk.pageCount }, (_, index) => chunk.pageFrom + index))).size, pages);
  });
}

test("prioritizes relevant chunks without removing deferred pages", () => {
  const chunks = buildSpecificationChunks({ totalPages: 250, chunkSize: 50, relevantPages: [151, 152] });
  assert.equal(chunks[0].pageFrom, 151);
  assert.equal(chunks.length, 5);
  assert.equal(chunks.reduce((sum, chunk) => sum + chunk.pageCount, 0), 250);
});

test("computes persisted progress from terminal chunks only", () => {
  const chunks = buildSpecificationChunks({ totalPages: 1000, chunkSize: 50 }).map((chunk, index) => ({ ...chunk, page_count: chunk.pageCount, status: index < 7 ? "Completed" : index === 7 ? "Running" : "Queued" }));
  const result = progressSnapshot({ totalPages: 1000, chunks, startedAt: new Date(Date.now() - 70_000).toISOString() });
  assert.equal(result.processedPages, 350);
  assert.equal(result.completedChunks, 7);
  assert.equal(result.progress, 35);
  assert.equal(result.remainingPages, 650);
  assert.ok(result.estimatedRemainingSeconds > 0);
});

test("explicit headings create an evidence-only discipline map", () => {
  const map = mapSpecificationPages([
    { page: 1, lines: ["SECTION 28 46 00 - FIRE DETECTION AND ALARM"] },
    { page: 2, lines: ["SECTION 23 00 00 - MECHANICAL"] },
    { page: 3, lines: ["Untitled content"] },
  ], "Fire Alarm");
  assert.deepEqual(map[0].disciplines, ["Fire Alarm"]);
  assert.equal(map[0].relevant, true);
  assert.equal(map[1].relevant, false);
  assert.equal(map[2].relevant, true, "unknown pages fail open and remain processable");
});

test("chunk planning is deterministic and idempotent", () => {
  const input = { totalPages: 2340, chunkSize: 50, relevantPages: [1, 501, 1200] };
  assert.deepEqual(buildSpecificationChunks(input), buildSpecificationChunks(input));
});

test("visible TOC fallback is bounded, traceable, and never drops unknown pages", () => {
  const result = buildSpecificationDocumentMap({
    totalPages: 2340,
    pages: [
      { page: 1, lines: ["COVER"] },
      { page: 2, lines: ["TABLE OF CONTENTS", "1 GENERAL REQUIREMENTS", "8 ELECTRICAL SPECIFICATION"] },
      { page: 4, lines: ["Division 01", "SECTION 011000 - SUMMARY"] },
    ],
  });
  assert.ok(result.entries.some((entry) => entry.method === "Visible TOC" && entry.sectionTitle === "GENERAL REQUIREMENTS"));
  assert.ok(result.entries.some((entry) => entry.method === "Heading Detection" && entry.sectionNumber === "011000"));
  assert.ok(result.entries.some((entry) => entry.method === "Unmapped Range" && entry.endPage === 2340));
  assert.equal(result.coverage.mappedPages + result.coverage.unknownPages, 2340);
  assert.ok(result.entries.every((entry) => !entry.startPage || (entry.startPage >= 1 && entry.endPage <= 2340)));
});

test("background orchestration persists restart, map, retry, and idempotency controls", async () => {
  const source = await readFile(new URL("../worker/specification-extraction-background.mjs", import.meta.url), "utf8");
  const api = await readFile(new URL("../worker/specification-extraction-api.mjs", import.meta.url), "utf8");
  assert.match(source, /lease_expires_at < datetime\('now'\)/);
  assert.match(source, /status='Retrying'/);
  assert.match(source, /specification_extraction_checkpoints/);
  assert.match(source, /specification_document_map_entries/);
  assert.match(source, /specification_document_map_details/);
  assert.match(source, /specification_chunk_metrics/);
  assert.match(source, /INSERT OR IGNORE INTO specification_chunk_entities/);
  assert.match(api, /LEGACY_SYNCHRONOUS_EXTRACTION_DISABLED/);
  assert.match(api, /specification-extraction.*map/);
});
