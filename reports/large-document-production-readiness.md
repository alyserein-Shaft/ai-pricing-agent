# Large Document Processing — Production Readiness Report

Generated: 2026-08-04

## 1. Executive Summary

The existing chunked architecture remains functionally sound and the 2,340-page Hotel workload still completes deterministically. This sprint fixed the empty document-map result for bookmark-free PDFs and added durable, phase-specific runtime metrics. Production certification is **not granted** because the authoritative repository suite still has 129 explained but unresolved failures, live browser scenarios could not run while the local server was unavailable, and full-file loading per chunk presents a production memory risk.

## 2. Document Map Fix Summary

- Retained PDF bookmarks as the first evidence source.
- Added a configurable early-page scan: 30 pages by default, bounded to 100.
- Detects visible contents rows, dotted leaders, divisions, sections, structural headings, printed references when explicit, and discipline terms.
- Persists source document version, source page, printed reference, section identity, discipline, bounded range, confidence, method, evidence, and review status.
- Explicitly persists unmapped ranges as `Unknown/Mixed` and `Unresolved`.
- Mapping changes priority only. Every physical page remains in the processing plan.

## 3. Hotel Document Map Results

- Source: `COMPILED SPECIFICATIONS - LA PORTA AL AKARIA.pdf`
- PDF size: 28,397,340 bytes
- Physical pages: 2,340
- Preflight scan: first 30 pages
- Duration in isolated 15-page confirmation: 256 ms
- Durable entries: 19
- Detection methods: 9 Visible TOC, 8 Heading Detection, 2 Unmapped Range
- Disciplines: 10 distinct values
- Mapped pages: 27
- Unknown pages: 2,313
- Confidence: 8 High, 9 Medium, 2 Unresolved
- Invalid ranges: 0
- Gaps: visible and retained as unmapped ranges
- Overlaps: none detected by the bounded pass
- Unresolved ambiguity: the visible top-level TOC has no explicit page references, so no printed-to-physical offset was invented.

## 4. Regression Failure Triage Summary

- Authoritative suite: 444 total, 315 passed, 129 failed, 0 skipped.
- Category B — outdated source-contract assertion: 123.
- Category D — intentional presentation/API contract change: 5.
- Category G — test/build infrastructure contract: 1.
- Category A/H — confirmed product or new architecture regression: 0 in this run.
- Every failure is recorded in `reports/regression-triage.json` and `reports/regression-triage.md`.

The 123 failures are concentrated in a legacy suite that searches `app/page.tsx` for exact implementation strings from the retired monolithic/local-demo UI. Restoring that code would conflict with the current server-backed architecture. These tests remain failing until their safety claims are replaced with behavioral API/UI tests; they were not skipped, deleted, or weakened.

## 5. Real Product Bugs Fixed

- Bookmark-free PDFs no longer produce an empty document map.
- Unknown/unscanned pages are now represented explicitly instead of being absent from the map.
- Map records now retain source version and evidence provenance.
- Chunk execution now exposes source-load, parser, segmentation, persistence, checkpoint, total, byte-size, and RSS measurements.
- Source byte-size measurement is captured before PDF parsing can transfer/detach an input buffer.

## 6. Tests Updated and Why

- Added deterministic document-map coverage for visible TOC detection, heading detection, valid ranges, and retained unknown pages.
- Extended orchestration source-contract coverage to verify durable map details and chunk metrics exist.
- No business-safety assertion was weakened.

## 7. Tests Removed and Replacement Coverage

No tests were removed or skipped. Legacy assertions remain visible failures because replacement behavioral coverage has not yet been completed.

## 8. Browser Validation Results

Live browser validation: **Blocked**.

The in-app browser was connected successfully, but every existing localhost tab reported that the site could not be reached. Starting the app from the secured workspace failed with `listen EPERM` on `127.0.0.1`. Therefore scenarios A–F were not represented as browser passes, and no screenshots/network evidence was fabricated.

## 9. Server Restart Recovery Results

Browser-driven restart recovery was not executed. The real Hotel integration test did verify persisted lease recovery: an expired running lease was reclaimed, the abandoned chunk completed once, and previously completed chunks were not duplicated.

## 10. Concurrency Results

- Two concurrent create requests returned the same authoritative job.
- Two concurrent retry requests enqueued one retry only.
- Duplicate page count: 0.
- Duplicate entity fingerprint count: 0.
- Two-browser concurrency remains blocked pending a host-started local server.

## 11. Performance Timing Breakdown

Real full-run averages across 47 chunks:

- Source loading: 3 ms
- PDF parser: 326 ms
- Engineering segmentation: 39 ms
- Persistence: 177 ms
- Checkpoint: 1 ms
- Instrumented total: 554 ms
- Existing chunk duration: 537 ms average, 281 ms fastest, 915 ms slowest
- Full deterministic validation including rerun: 52.49 seconds

Extraction output fingerprints remained deterministic after instrumentation.

## 12. Memory Findings

- Source PDF: 28,397,340 bytes.
- First-chunk RSS increase: 66,715,648 bytes.
- Observed long-run RSS before sampled rerun: 766,230,528 bytes.
- Observed RSS after source load / peak: 828,669,952 bytes.
- Source object bytes are loaded again for each chunk; they are not range-backed or reused across chunk claims.

Recommendation: **range-backed loading is required before production certification**. The current functional result is correct, but repeatedly materializing an entire large PDF for each chunk and the observed high process RSS are not a safe production baseline.

## 13. Files Modified

- `app/domain/specification-extraction-jobs.mjs`
- `app/domain/specification-extractor.mjs`
- `worker/specification-extraction-background.mjs`
- `drizzle/0047_large_specification_readiness.sql`
- `tests/specification-extraction-jobs.test.mjs`
- `scripts/triage-regression-output.mjs`
- `reports/regression-triage.json`
- `reports/regression-triage.md`
- `reports/large-document-production-readiness.md`

## 14. Database or Migration Changes

Migration `0047_large_specification_readiness.sql` adds:

- `specification_document_map_details`
- `specification_chunk_metrics`
- Range and unique chunk-metric indexes

Migration application to a copy of the current local database succeeded. `PRAGMA foreign_key_check` returned no violations.

## 15. Full Test Results

- Real Hotel full workload: 1/1 passed; no skip.
- Focused document/extraction suite: 18 passed, 0 failed; the real workload test is configuration-gated in the ordinary focused command and was run separately with its real fixture.
- Authoritative repository suite: 315 passed, 129 failed, 0 skipped.
- Syntax validation: passed for all changed modules and the triage script.
- Browser tests: blocked by unavailable localhost server.

## 16. Production Build Result

Passed. The verified Vinext/Sites artifact contains the required ESM worker `default.fetch` and hosting manifest.

## 17. Remaining Risks

1. The 129 repository failures require safe conversion from brittle implementation-text assertions to behavioral coverage.
2. Browser refresh, close/reopen, two-context concurrency, pause/resume, server restart, and cancellation require a host-started server and evidence capture.
3. Full-file loading per chunk should be replaced with a verified range-backed or shared immutable source strategy before production.
4. PDF.js emitted optional-canvas and embedded-font warnings; extraction remained successful, but production packaging should resolve or formally accept them.
5. Visible TOC top-level page offsets remain unresolved where the source supplies no explicit printed references.

## 18. Production Readiness Score

**64 / 100**

The architecture is functionally passed and now better instrumented, but the test, browser-evidence, and memory exit criteria are not satisfied.

## 19. Final Go / No-Go Verdict

**NO-GO for Production Certified.**

The large-document engine remains safe for controlled local validation. Certification requires: (1) green behavioral replacement coverage for all 129 failures, (2) completed live browser scenarios with evidence, and (3) range-backed/shared source loading with an acceptable production memory envelope.
