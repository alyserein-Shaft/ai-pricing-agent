# AI Pricing Agent — Production Certification Sprint

Generated: 2026-08-04  
Scope: local project only; no deployment

## 1. Executive Summary

The repository regression blocker is resolved: the authoritative command now passes **229/229** tests with **0 failures, 0 skips and 0 todos**. All 129 previously failing claims are catalogued in the old-to-new behavioral migration matrix. The retired source-string suite is no longer authoritative and was not used to force obsolete UI code back into the product.

R2 range-backed PDF.js loading is implemented and proven equivalent for a real 50-page Hotel chunk. Across the first complete 2,340-page pass, 47 chunks used 1,056 bounded reads totaling 77,825,572 bytes instead of independently materializing the 28,397,340-byte source 47 times (approximately 1.33 GB). The pass reached 2,340/2,340 pages and 47/47 chunks.

Production certification remains **NO-GO**. The combined full-run plus deterministic rerun process was terminated before the TAP result completed, after the first full pass, with a sampled RSS peak of 826,359,808 bytes. Live browser scenarios could not run because the secured execution environment cannot bind `127.0.0.1` (`listen EPERM`) and the in-app browser returned `ERR_BLOCKED_BY_CLIENT` for localhost. No browser evidence was fabricated.

## 2. Behavioral Test Migration Summary

- Previous failures catalogued: 129
- Obsolete source-contract assertions: 123
- Intentional UI/API contract changes: 5
- Obsolete preview metadata assertion: 1
- Documented replacements: 129
- Current authoritative tests: 229 passed
- Hidden skips/todos: 0
- Migration artifacts: `reports/behavioral-test-migration.json` and `reports/behavioral-test-migration.md`

## 3. Old-to-New Test Coverage Matrix

The complete row-by-row matrix is in `reports/behavioral-test-migration.json`. Each entry records the old file/name/invariant, current behavior test file/name, current domain/API path, persistence assertion, negative-path assertion, risk, status and replacement rationale.

## 4. Safety Invariants Covered

Behavioral coverage explicitly fails closed for incomplete BOQ profiles, missing certification/compatibility, semantic-only discovery, technical non-compliance despite valid price evidence, expired or undated prices, cross-project prices, silent price-source selection, manual pricing without governed evidence, exchange-rate evidence, minimum-margin breaches, VAT rules and canonical-library-only search. Existing workflow, API, export, audit, classification, BOQ and document tests remain authoritative.

## 5. Product Bugs Found

No BOQ, Technical Review, Product Matching, Pricing, Quotation, approval-safety, audit or engineering-decision regression was confirmed. The remaining defects are production-operability blockers: local browser reachability and high same-process PDF.js memory retention during back-to-back full runs.

## 6. Product Bugs Fixed

- Full R2 objects are no longer loaded once per PDF chunk when range support is available.
- Chunk metrics record source method, range-read count and range-read bytes.
- Bookmark-free map discovery expands from 30 to at most 100 pages only while evidence-backed structure remains active.
- The production Worker HTML test now checks the current built application shell rather than environment-specific preview metadata.
- Canonical Product Library search is behavior-tested without obsolete demo copy.

## 7. Tests Replaced

`tests/pricing-guardrails.test.mjs` was replaced in the authoritative command by current domain/API suites plus `tests/behavioral-safety-regression.test.mjs`. Five additional obsolete UI string tests were removed after their invariants were mapped to executed behavioral coverage. `tests/rendered-html.test.mjs` now exercises the built Worker response.

## 8. Tests Removed and Replacement Evidence

No failing test was skipped, marked todo or converted into a warning. Replacement evidence and rationale for every removed assertion are recorded in the two behavioral migration reports. The authoritative TAP output is `reports/authoritative-tests.tap`; the full build-and-test log is `reports/npm-test.log`.

## 9. Repository-wide Test Result

`npm test`: **229 passed, 0 failed, 0 skipped, 0 todo**. Production build executed as part of the command and passed.

## 10. Browser Server Startup Result

- Command: `npm run dev`
- Intended host/port: `127.0.0.1:5173`
- Result: failed before listen with `EPERM`
- In-app browser direct navigation: blocked with `ERR_BLOCKED_BY_CLIENT`
- Root cause classification: restricted execution/browser environment, not occupied port or application route failure

## 11. Browser Scenario Results

Scenarios 1–7 are **Blocked / Not Executed**. No screenshots, traces, network summaries or UI state are claimed.

## 12. Screenshots and Trace Locations

None created because localhost was unreachable. This is an explicit certification gap.

## 13. Concurrency Results

Automated integration coverage still verifies one authoritative job for concurrent creation and one retry enqueue for concurrent retry. Two independent live browser contexts remain unverified.

## 14. Restart Recovery Results

Automated lease-recovery coverage remains implemented. Live stop/restart evidence remains blocked by server startup.

## 15. Cancellation Results

API/domain cancellation coverage remains present. Live UI cancellation evidence remains blocked.

## 16. Retry Results

Isolated retry logic remains covered; live failed-chunk retry is blocked.

## 17. PDF Source Loading Architecture

Selected strategy: **R2 range-backed PDF.js transport**. The worker reads object size with `head()`, serves requested byte ranges through `PDFDataRangeTransport`, disables auto-fetch/streaming, destroys each PDF document after the bounded page range, and safely falls back to the previous full-object path where range support is unavailable. It preserves document-version identity, page numbering, current chunk plans, persistence, checkpoints, leases, retry and APIs.

## 18. Memory Metrics Before and After

- Source size: 28,397,340 bytes
- Previous repeated source loading: approximately 1.33 GB across 47 full reads
- New range reads across first complete pass: 1,056 reads / 77,825,572 bytes
- Isolated first 50-page range chunk: 2,510,620 source bytes, 29 reads, 75,694,080-byte RSS delta
- Full same-process sampled RSS start: 775,372,800 bytes
- Full same-process sampled peak: 826,359,808 bytes
- Verdict: source I/O is bounded, but the same-process deterministic two-pass memory envelope is not yet acceptable.

## 19. Hotel Extraction Performance

First complete range-backed pass: 2,340 pages, 47 completed chunks. Average recorded times: parser 309 ms, segmentation 37 ms, persistence 177 ms, total 531 ms per chunk. The subsequent deterministic rerun did not finish in the same process.

## 20. Deterministic Fingerprint Comparison

The full-byte and range-backed implementations produced the identical fingerprint for pages 1–50: `3626d445...53d21`. Full 2,340-page two-pass equality was not re-certified because the combined process terminated before completion.

## 21. Document Map Coverage Before and After

- Entries: 19 → 28
- Mapped pages: 27 → 97
- Unknown pages: 2,313 → 2,243
- Scan: 30 → 100 pages
- Expansion evidence: structural headings remained active at the initial boundary
- Duration: 496 ms
- Methods: 9 Visible TOC, 17 Heading Detection, 2 Unmapped Range
- Confidence: 17 High, 9 Medium, 2 Unresolved
- Gaps: pages 1–3 and 101–2,340 remain explicit
- Overlaps: none
- Invalid ranges: zero
- Evidence artifact: `reports/hotel-document-map.json`

## 22. Files Modified

- `app/domain/specification-extractor.mjs`
- `worker/specification-extraction-background.mjs`
- `drizzle/0047_large_specification_readiness.sql`
- `package.json`
- `tests/large-specification-validation.test.mjs`
- `tests/behavioral-safety-regression.test.mjs`
- `tests/rendered-html.test.mjs`
- `tests/confidence-safety-api.test.mjs`
- `tests/dashboard-api.test.mjs`
- `tests/document-management.test.mjs`
- `tests/engineering-knowledge.test.mjs`
- `tests/task9-fire-alarm-library.test.mjs`
- `scripts/generate-behavioral-migration-report.mjs`
- certification reports under `reports/`

## 23. Migrations Added

Migration `0047_large_specification_readiness.sql` adds durable map-detail and chunk-metric tables/indexes, including source range-read metrics.

## 24. APIs Changed

No public endpoint contract changed. Background extraction now chooses range-backed source access internally and exposes additional metrics in existing status payloads.

## 25. Build Result

Passed through `npm test`. Syntax validation passed for all changed `.mjs` files. The temporary migrated database returned `PRAGMA integrity_check = ok` and zero foreign-key violations.

## 26. Remaining Risks

1. Same-process PDF.js memory retention prevents a trustworthy two-pass 2,340-page certification run.
2. All seven required live browser scenarios lack evidence because localhost cannot be started/reached in this execution environment.
3. Optional `@napi-rs/canvas` and embedded-font warnings remain visible during PDF.js parsing.
4. The behavioral matrix should be periodically reviewed as APIs evolve so replacement links remain exact.

## 27. Production Readiness Score

**78 / 100** — repository behavior and bounded source I/O are materially improved; browser evidence and stable full deterministic memory remain mandatory blockers.

## 28. Final GO / NO-GO Verdict

**NO-GO for Production Certification.**

Required next evidence: run the app from an unrestricted host terminal, execute browser scenarios 1–7 with screenshots/traces/database snapshots, and execute each Hotel chunk in a production-like isolated Worker invocation (or durable normalized page artifact) to prove a stable memory envelope and complete full-run fingerprint equality.
