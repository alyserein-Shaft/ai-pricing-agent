# KN-PRODUCT-CLOSE — R1 Checkpoint (SEARCH DEFAULT + COUNT TRUTH)

**Slice:** R1 — Search default + count truth
**Status:** 🟢 CLOSED
**Date:** 2026-09-24
**Baseline:** HEAD `029b426`, branch main, runtime :4183, dirty tree (R1 modifies 3 files + adds 1 test)
**Authority boundaries:** unchanged — read-only GET work; no approvals, promotions, or mutation of live data.

## Defect verified (before)
- `/api/knowledge/search` with `q="  "` (whitespace) returned an empty results set; UI sent `"  "` for untyped Manufacturers/Standards/Search, so sections claimed "No manufacturers / no standards / no search results found" while real data existed (29 distinct manufacturers, 12 distinct standards among 6660 facts).
- Metrics block always labeled the count `FILES` (e.g. `FILES 0`) even on fact/identity sections, and used the fetched-page length as the "total".

## Implementation (proven defects only)
1. **Backend** `worker/knowledge-library-api.mjs` (search handler, ~441):
   - New explicit `list-all=1` mode: bounded (default 200) listing of **one representative row per distinct `(fact_type, normalized_value)`**, with `total` = distinct-entity count (COUNT subquery), `hasMore = offset + results.length < total`, limit clamped 1–200, offset ≥ 0.
   - Typed search (q ≥ 2) unchanged path, now returns `total`/`limit`/`offset`/`hasMore`.
   - q < 2 without `list-all=1` → neutral `mode:"empty"` (never claims knowledge absent).
   - Zero mutation: all paths are SELECT-only.
2. **Frontend** `app/page.tsx` (data effect ~8877–9011): sends `list-all=1&type=...&limit=200&offset=0` when trimmed search < 2 chars; captures `dataPayload.total` into new `knowledgeResultsTotal` state (passed as `resultsTotal` to workspace).
3. **Workspace** `app/components/workspaces/KnowledgeLibraryWorkspace.tsx`:
   - Metrics block is section-aware: `RESULTS`=API total (never page length) / `QUEUE`=review queue length / `IDENTITIES LOADED`=page length (honest until R2 real total) / `FILES` only on file sections.
   - Search empty-state copy → neutral `No knowledge matches. Try a different search term.`
   - Removed now-unused `summary` destructure (kept in Props for compatibility; zero lint impact).

## Granularity decision (documented, summary semantics unchanged)
- `Manufacturers`: summary `manufacturers = 29` (COUNT DISTINCT) **exactly reconciles** with list-all total 29.
- `Standards`: summary `standards = 19` is COUNT(*) of Standard facts; list-all Standards = **12 distinct values**. Distinct-entity listing is the correct knowledge-surface semantic (duplicates across files collapse). Both numbers are truthful at their own granularity; documented, not changed.

## Validation
### Focused regression test (new)
`tests/knowledge-search-list-contract.test.mjs` — 6/6 PASS:
- list-all real listing + truthful distinct total, no mutation
- type-scoped list-all totals
- limit/offset pagination + hasMore transitions
- typed search still works + truthful total
- too-short query without list-all → neutral empty
- whitespace-query UI pattern replaced by list-all (regression guard)

### Existing suites
- KN-UX-3 / KN-UX-4 / release-1-app-shell: all pass except the **documented pre-existing** nav-children deepEqual failure (zero navigation files touched).
- knowledge promotion/link/resolver/repair suites: 50/53 (3 failures are the **pre-existing** `mock.module` Node v26.9 requirement; 43/43 pass with `--experimental-test-module-mocks`).
- `npm run test:phase5c`: 66/66 PASS.
- `npm test` (core): 508/508 PASS.

### Static checks
- `tsc --noEmit`: 18 page.tsx errors — all at pre-existing lines (5061–5064, 11679, 15662, 16210–16212, 16305, 17002, 17028, 19375–19444); **zero in R1 edit regions** (2861, 8895–8958, 17966–18020).
- `eslint page.tsx`: 6 errors (exact pre-existing baseline: 12857, 20063, 23213, 23333–23334); zero new.
- `eslint KnowledgeLibraryWorkspace.tsx`: clean (0 errors, 0 warnings after removing unused `summary`).

### Runtime (:4183, Playwright + curl)
- `GET /api/knowledge/search?list-all=1&type=Manufacturer` → `mode:list-all total:29` ✓
- `list-all=1&type=Standard` → `total:12` ✓
- `list-all=1` (all types) → `total:6135, hasMore:true, limit:200` ✓ bounded
- Typed `q=ho` → `mode:search total:261` ✓
- Summary unchanged: manufacturers 29, standards 19, products_learned 1855, prices_discovered 1503 ✓
- UI probe (Playwright, 12/13 PASS; the 1 FAIL is `Unnamed source` on Identities = **R2 defect, correctly deferred**):
  - Manufacturers: RESULTS 29, no "No manufacturers", no `FILES 0`, real rows render
  - Standards: RESULTS 12, no false-empty
  - Search default: RESULTS 6135 (truthful total, not page length), not false-empty
  - Typed search "honeywell": returns rows + RESULTS total
  - No-match: neutral "No knowledge matches" (no "No knowledge exists/found")
  - Identities: `IDENTITIES LOADED` (honest page-length; R2 adds real total)
  - Review: renders
- Evidence PNGs: `.local-evidence/kn-r1-manufacturers.png`, `kn-r1-standards.png`, `kn-r1-search.png`, `kn-r1-identities.png`

## Constraints honored
- No reset/restore/stash/clean/commit/push/deploy/restart of canonical runtime.
- No mutation of live data, no mass-review/approve, no Golden mutation.
- Authority boundaries preserved (Learning ≠ Review ≠ Identity Confirm ≠ Discovery Approval…).
- No Web Knowledge expansion, no auto-promotion trigger.

## R1 verdict
**🟢 CLOSED.** Search default is now a truthful, bounded, paginated listing with real totals; false-empty claims eliminated; FILES label removed from fact sections; typed search preserved; summary semantics untouched. Zero new TS/lint failures; focused + full suites green modulo documented pre-existing baselines.

## Next
R2 — Identities total/pagination/provenance + wire existing review/promote routes (kill silent 100-row truncation and `Unnamed source`).