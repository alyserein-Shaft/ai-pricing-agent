# R2 CHECKPOINT — Product Identities: total / pagination / provenance + review/promote wiring — 🟢 CLOSED

Canonical repo HEAD `029b426...` · runtime :4183 (single-user Administrator) · no commits made.

## Defect proven

- `GET /api/product-identities` returned at most 100 rows (clamped ≤200) with NO `total`,
  `hasMore`, or `offset` — the UI silently displayed page length as completeness while
  1881 active identities existed (1040 with NULL manufacturer → `Unnamed source` triggers).
- List rows carried no file provenance; the identity section had no review/promote actions.

## Implementation (smallest sufficient)

### `worker/product-identity-api.mjs` (GET list handler)
- Added `offset` param (clamped ≥0), `limit` unchanged (1..200).
- `COUNT(*)` subquery mirrors the exact same WHERE as the row query → truthful `total`.
- Rows now include `source_file` = file_name of the earliest observation
  (`ORDER BY o.created_at,o.id LIMIT 1`, JOIN `knowledge_files`), plus the existing
  observation/document/price/relationship counts.
- ORDER BY gains `,i.id` tiebreaker. Response adds `{total, limit, offset, hasMore}`.
- Review (`POST /:id/review`) and promote (`POST /:id/promote`) routes untouched — UI now wires them.

### `app/page.tsx`
- State: `knowledgeIdentitiesOffset` (0), `knowledgeIdentitiesHasMore` (false),
  `knowledgeIdentityRefresh` (counter).
- Identity fetch sends `limit=200&offset=${offset}`; captures `dataPayload.total`
  (into `knowledgeResultsTotal`) and `dataPayload.hasMore`.
- Append-on-load-more when offset > 0 (functional updater), replace when offset = 0.
- Pagination reset effect on `[knowledgeSection, knowledgeSearch]` change; offset in effect deps.
- `loadMoreIdentities`, `reviewProductIdentity` (POST review with idempotencyKey, reason ≥10,
  evidence {source_file, observation_count, document_count}, manufacturer/unit explicit),
  `promoteProductIdentity` (POST promote with idempotencyKey + reason). Refresh counter bumps
  on success; errors surfaced in `knowledgeError`.
- Workspace invocation wired `identitiesHasMore`, `onLoadMoreIdentities`,
  `onReviewIdentity`, `onPromoteIdentity`.

### `app/components/workspaces/KnowledgeLibraryWorkspace.tsx`
- Identity metric: label `IDENTITIES` with real `resultsTotal` (page-length fallback only when total 0).
- Identity rows: label chain `manufacturer || official_product_code || identity_key ||
  normalized_product_code` — never `Unnamed source`; `<p>` falls back to `Source available`
  (never `Unclassified` for identity rows); small line now includes lifecycle (real value,
  `Unknown` fallback), counts, and `Source: <real file>` from `source_file`.
- Per-row `Review / promote identity` action → reason-gated box (10+ chars) with
  `Review identity` + `Promote` buttons.
- `Load more identities` button while `identitiesHasMore`.
- Files-branch strong fallback `Unnamed source` → `Source available` (inert; files always carry file_name).

## Evidence

- Backend contract test `tests/product-identity-list-contract.test.mjs` (node:sqlite d1 harness,
  schema from 0019/0044/0056): 5/5 PASS
  (truthful total incl. bounded page, limit/offset pagination + hasMore transitions incl.
  beyond-total, q-scoped total, limit/offset clamping, source_file provenance + zero mutation).
- Identity review/promotion suites 15/15 PASS; KN-UX-3/KN-UX-4/release-1-app-shell + R1
  contract: 41/42 (sole failure = pre-existing nav-children-URL alignment, R6-owned, byte-identical
  to baseline — asserts GLOBAL nav children are Files/Products/Manufacturers/Prices/Case
  Studies/Fire Alarm/CCTV while app exposes Standards/Search/Product Identities).
- ESLint: workspace/worker/test clean; page.tsx exactly 6 errors (pre-existing
  no-assign-module-variable + unescaped entities, lines shifted only).
- `tsc --noEmit`: 18 page.tsx errors, all pre-existing lines; ZERO in R2 regions
  (state ~2870, data effect ~8896-9065, invocation ~18096-18125).
- `npm test`: 508/508 PASS (identical to R1 baseline).

## Runtime :4183

- curl: total 1881 (NOT page length); page 200 rows hasMore true; bounded limit=3 → total 1881,
  len 3, hasMore true; last page offset=1878 → len 3, hasMore false; q=honeywell → total 682.
  200/200 rows carry real `source_file` (e.g. `KSA Gent Fire Price list Ver 22.3 Oct 2022 (1).xlsx`).
- Playwright UI: metric IDENTITIES = 1881; 198+ rows show `Source: <file>.xlsx`; no `Unnamed source`;
  `Review / promote identity` buttons render; `Load more identities` renders. Load-more appends
  200→400→600 with total pinned at 1881; review box opens, buttons disabled until 10+ char reason,
  enabled after. NO review/promote submitted on live data. Only console noise: pre-existing Geist
  font 404s (`/.vinext/fonts/`), unrelated.
- Screenshots: `.local-evidence/kn-r2-identities.png`, `.local-evidence/kn-r2-pagination.png`
  (temp probe copies in opencode temp dir).

## Repo safety

R2 changed: `M worker/product-identity-api.mjs`, `M app/page.tsx`,
`M app/components/workspaces/KnowledgeLibraryWorkspace.tsx`, `?? tests/product-identity-list-contract.test.mjs`.
No commits, no live mutation, no fixture/golden mutation.

## Exit decision

R2 CLOSED 🟢. Next: R3 — Product Discovery Approval UI via existing
`/api/products/:id/approve-discovery` routes in `worker/product-price-library-api.mjs`,
then RE-EVALUATION gate.