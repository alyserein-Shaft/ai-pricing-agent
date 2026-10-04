# KN-PRODUCT-CLOSE — Consolidated Delivery Report

**Status:** 🟢 COMPLETE — R1 → R2 → R3 → R4 → R5 → R6 → R7 all CLOSED.
**Canonical repo HEAD:** `029b426` (main) · **Runtime:** :4183 · **No commits made.**
**Scope:** Repair the Knowledge product surface in smallest-sufficient slices;
each slice re-verified at a RE-EVALUATION GATE against live code before landing.

Per-slice checkpoints: `.local-evidence/r1-checkpoint.md` … `r7-checkpoint.md` (+ screenshots).

---

## What was broken and what each slice fixed

| # | Slice | Defect (proven before fix) | Fix |
|---|-------|----------------------------|-----|
| R1 | **Search default + count truth** | A too-short search query returned an empty results list (implying knowledge was absent) and the UI showed a fabricated entity count. | `worker/knowledge-library-api.mjs` adds explicit `list-all=1` bounded listing (one representative row per distinct `(fact_type, normalized_value)`) with truthful `total` = distinct-entity COUNT; `q<2` without listing is a neutral `mode:"empty"`. `app/page.tsx` + workspace consume `total`/`resultsTotal` truthfully. |
| R2 | **Identities total/pagination/provenance + review/promote wiring** | Product Identities had no honest total, no load-more, no per-row `source_file` provenance, and Review/Promote were unwired. | `worker/product-identity-api.mjs` returns `total` (same-WHERE COUNT, superseded excluded), `limit/offset/hasMore`, per-row `source_file` (earliest observation) + `,i.id` tiebreaker. Frontend appends pages (offset>0 → append, 0 → replace), pagination reset on section/search change, review/promote POSTs with idempotency keys + ≥10-char reason + evidence `{source_file, observation_count, document_count}`; identity metric = real total. |
| R3 | **Product Discovery Approval UI** | The backend `POST /api/products/:id/approve-discovery` existed but had no UI; discovery approval for a product was impossible. | `app/page.tsx` wire-up: `canGovernLibrary` gate (Administrator / Library Manager), reason ≥5 (`MIN_GOVERNED_REASON_LENGTH`), posts to the governed route with `requested_product_id`, spot-updates `approvedForDiscovery: true` + `review_status: "Reviewed"`, bumps `libraryProductRefresh`, honest toast + "Discovery approval" detail panel copy ("Never grants costing eligibility"). |
| R4 | **Prices truth** | The Knowledge Prices section showed only a "FILES" count of price-list source files and no truthful price figure. | `KnowledgeLibraryWorkspace.tsx` Prices/Price Lists sections now present a **PRICES metric from `summary.prices_discovered`** (1503 at runtime) and honest heading copy ("Price evidence discovered from N price-list source files — M discovered prices stay Discovery-Only until governed approval"). Non-price file sections keep `FILES`. |
| R5 | **Banner copy truth** | Two safety banners contradicted backend truth: (a) Product Library claimed prices stay blocked "unless separately approved **with a current validity end date**" — `PRICE_VALIDITY_REQUIRED` was removed; (b) Knowledge banner "No automatic promotion" was stale from the Phase 2.5 baseline, ignoring that learning IS automatic while approved use requires human review. | (a) Banner now: "…remain blocked from project costing unless separately approved. **Validity is never inferred.**" (b) Banner now: "Learning is automatic · promotion is governed — …require explicit human review." Verified inert: `downstream_use` fallbacks mirror `NOT NULL DEFAULT 'Discovery Only'` columns. |
| R6 | **Fire Alarm/CCTV URL-restore** | **0/4 probe**: `?workspace=Knowledge&section=Fire+Alarm`, `section=CCTV`, `?workspace=Fire+Alarm+Knowledge`, `?workspace=CCTV+Knowledge` all fell through `globalWorkspacePresentation` → Dashboard Overview. Plus `globalNavigationSelection` mis-highlighted Standards/Search/Product Identities/Review as "Files", and a stale test asserted a superseded 7-child nav. | `project-navigation.mjs`: `globalWorkspacePresentation` maps `Fire Alarm Knowledge`/`CCTV Knowledge` → Dashboard + own active module (render branches already existed in page.tsx). `application-navigation.mjs`: uniform `Knowledge ${section}` child selection (no mis-highlight). `page.tsx`: AppShell `globalSection` derived from active module. `tests/release-1-app-shell.test.mjs`: 7→**11-child** real IA contract. |
| R7 | **Files source drill-down (no fabricated `Unclassified`)** | All 29 knowledge-file rows rendered **"Unclassified"** and **"Permitted use: Discovery Only"** from keys that do not exist in the files API payload (`document_type`/`source_type`/`downstream_use`); the payload really carries `detected_type`, `classification_status/confidence`, `secondary_types`, per-file `summary` counts. | Files rows render real `detected_type` (+ secondary types), classification evidence incl. confidence, "Permitted use" only from real payload values, and a per-file evidence drill-down (`N products learned · M prices discovered · K items requiring review`, else honest "Source registered"). Review-item fallback → neutral "Not classified". |

---

## Governance invariants preserved throughout

- **Authority boundaries untouched:** Learned ≠ Human Reviewed ≠ Identity Confirmed ≠ Discovery Approved ≠ Costing Approved ≠ Project Decision. R3's approve-discovery explicitly returns `costingEligible: false`; UI copy states "Never grants costing eligibility."
- **No auto-promotion trigger:** all promotion/approval stays explicit, reason-gated, human-reviewed.
- **No Web Knowledge expansion** (Fire Alarm/CCTV restore only surfaces existing governed workspaces).
- **No fabricated data:** every removed/added string now derives from a real API field or DB default; "Document type not classified", "Source registered", "Validity is never inferred" are honest statements.
- **No Golden mutation, no fixture mutation, no live data mutation:** all mutation validation ran in isolated `node:sqlite` harnesses.

## Change surface (this engagement only)

**Backend:** `worker/knowledge-library-api.mjs` (R1), `worker/product-identity-api.mjs` (R2).
**Frontend:** `app/page.tsx` (R1–R3, R5, R6), `app/components/workspaces/KnowledgeLibraryWorkspace.tsx` (R1–R2, R4–R5, R7).
**Navigation:** `app/lib/project-navigation.mjs` (R6), `app/lib/application-navigation.mjs` (R6).
**Tests added (7):** `tests/knowledge-search-list-contract.test.mjs` (R1), `tests/product-identity-list-contract.test.mjs` (R2), `tests/product-approve-discovery-contract.test.mjs` (R3), `tests/knowledge-prices-truth-contract.test.mjs` (R4), `tests/knowledge-banner-copy-truth.test.mjs` (R5), `tests/knowledge-fire-alarm-cctv-restore-contract.test.mjs` (R6), `tests/knowledge-files-source-truth-contract.test.mjs` (R7).
**Test updated (1):** `tests/release-1-app-shell.test.mjs` (7→11-child nav contract; now the truthful IA contract).
**Evidence:** `.local-evidence/r1..r7-checkpoint.md` + screenshots incl. `kn-r4-prices.png`, `kn-r7-files.png`.

## Validation summary (final)

- **Contract suites (all KN + nav + R1–R7): 92/92 PASS** — was **41/42** (1 pre-existing red) at the R3 gate.
- **`npm test`: 508/508 PASS** (re-run after each slice).
- **ESLint:** same 6 pre-existing errors (page.tsx `no-assign-module-variable`, 5 × `no-unescaped-entities`) — zero in R1–R7 regions.
- **`tsc --noEmit`:** exactly 18 pre-existing errors, unchanged — zero in R1–R7 regions.
- **Runtime Playwright probes:** R1 12/13 → R2 7/7 → R3 23/23 → R4 5/5 → R5 6/6 → **R6 14/14** (all 4 URL forms restore + exact sidebar highlight, no mis-highlights) → **R7 7/7** (real detected types + evidence drill-downs; no fabricated "Unclassified"/"Permitted use").
- Live data truth spot-checked at runtime: identities total 1881 (682 for `q=honeywell`), prices_discovered 1503, FILES=29, all 29 file rows carry truthful classification fields.

## Known pre-existing items (NOT part of this close — reported, unchanged)

- `.vinext/fonts/` 404 console noise (pre-existing asset 404s).
- 18 tsc / 6 eslint pre-existing errors in `app/page.tsx` outside KN regions.
- Review-queue item types "Unknown" are real DB values (detected_type null), displayed honestly as such.
- Existing case-study/identity surfaces that were not defects under the slice definitions were left byte-identical unless a slice owned them.

## Repository safety

Nothing committed, pushed, stashed, reset, or deployed. No live-database mutations. All changes remain in the working tree; checkpoints document each slice's exact byte-level scope. STOP — engagement complete.