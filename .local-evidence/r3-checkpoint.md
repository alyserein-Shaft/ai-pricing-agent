# R3 CHECKPOINT — Product Discovery Approval UI — 🟢 CLOSED

Canonical repo HEAD `029b426...` · runtime :4183 (single-user Administrator) · no commits made.

## Defect proven

- `POST /api/products/:id/approve-discovery` existed and was fully governed (role gate,
  reason >= 5, decision event, never grants costing) but was ORPHANED — zero callers in the UI
  (grep: only the worker route + a type + a passive label). 943 of 951 library_products sat
  un-approvable: the UI showed "Discovery listing: Not approved" with no path to approval.

## Implementation (smallest sufficient — backend untouched)

The governed route already existed; R3 wired it truthfully into the Product Library detail.

### `app/page.tsx`
- State: `libraryApprovalTarget` (id | null), `libraryApprovalReason`, `libraryProductRefresh`.
- `canGovernLibrary = effectiveLibraryPermission ∈ {Administrator, Library Manager}` — mirrors
  the backend `canGovernGlobal` exactly.
- `approveDiscoveryProduct()`: posts `{ reason }` (>= 5 chars, matching
  MIN_GOVERNED_REASON_LENGTH=5) to `/api/products/:id/approve-discovery`, using the honest
  `requested_product_id` lookup (so superseded observations resolve to the correct record),
  surfaces backend errors truthfully, updates the record from the honest
  `approvedForDiscovery: true` response, bumps `libraryProductRefresh` to re-fetch the list,
  toast "Product approved for discovery · discovery only".
- Detail panel "Discovery approval" section (after the evidence grid):
  - Honest state line: "Discovery listing: Approved — usable for discovery matching. Never
    grants costing eligibility." / "Discovery listing: Not approved — restricted to
    discovery-only use until a governed approval is recorded."
  - Not-approved + canGovernLibrary → reason-gated "Approve for discovery" box (5+ chars,
    disabled otherwise, "Approving…" while in flight).
  - Not-approved + insufficient permission → "Requires Library Manager or Administrator
    permission." (no dead button).
  - Approved → no action, state only.
- `LibraryProduct` type gains optional `requested_product_id` (what `mapProduct` truly returns).

## Evidence

- Focused contract test `tests/product-approve-discovery-contract.test.mjs` (isolated
  node:sqlite harness: organizations/memberships, product_manufacturers/brands/families,
  library_products with identity_status/superseded columns, the real
  canonical_library_products recursive view, product_library_decisions): 5/5 PASS —
  governed approval flips review_status='Reviewed' + approved_for_discovery=1 and writes a
  decision event (action "Approved for Discovery", before/after {approved:false→true}, actor,
  reason); costingEligible always false; short reason 422 + zero writes; unknown product 404 +
  zero writes; role-gate + reason-gate source contracts; UI wiring contract (route, reason gate,
  canGovernLibrary, honest response handling, refresh).
- Regressions: product-price-library suites 57/57 PASS; knowledge + R1/R2 contract suites
  28/28 PASS; `npm test` 508/508 PASS (unchanged from baseline).
- ESLint: page.tsx still exactly 6 pre-existing errors (no-assign-module-variable +
  unescaped entities), same natures, shifted lines only.
- `tsc --noEmit`: still 18 page.tsx errors, all pre-existing; ZERO in R3 regions
  (state ~2838, canGovernLibrary ~3353, handler ~9344, detail section ~16360).

## Runtime :4183 (no live mutation)

- Playwright 23/23 PASS:
  - List renders 50 rows, "Discovery listing: Not approved" labels.
  - Detail: "Discovery approval" section, honest not-approved copy (never claims costing),
    "Approve for discovery" button (Administrator can govern), reason box opens, disabled
    < 5 chars, enabled with reason — NO submit performed on live data.
  - Search "2151" (real approved product): list "Discovery listing: Approved"; detail shows
    Approved state and NO approve action; approved copy still "Never grants costing eligibility".
- Screenshot: `.local-evidence/kn-r3-discovery-approval.png`.
- Only console noise: pre-existing `.vinext/fonts/` 404s.

## Repo safety

R3 changed: `M app/page.tsx`, `?? tests/product-approve-discovery-contract.test.mjs`.
Nothing committed; no live data mutated; no fixture/golden mutation.

## Exit decision

R3 CLOSED 🟢 → RE-EVALUATION GATE (next): re-verify each remaining slice
(R4 Prices truth, R5 banner copy truth, R6 Fire Alarm/CCTV URL-restore, R7 Files source
drill-down) against current code before continuing.