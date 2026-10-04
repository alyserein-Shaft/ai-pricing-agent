# GOLDEN-7A3B1 — Governed Brand Registry Mutation Path

## 1. Verdict

```
CLOSED — GOVERNED CANONICAL BRAND REGISTRY MUTATION PATH PROVEN;
LIVE GAMEWELL-FCI / GENT REGISTRATION NOT EXECUTED
```

A real, authorized, reusable operation now exists for registering canonical product
brands as reference data in their own right — no supplier document, no source
object, no manual document classification, no raw SQL, no schema change. **12/12,
real active chain, green on the first run.**

## 2. §40.1 — Existing mutation architecture trace

`product_brands` had exactly three writers, all side effects of document ingestion in
`worker/product-price-library-api.mjs`:

| Site | Behaviour |
|---|---|
| `:177` | `INSERT … 'Farenhyt', 'FARENHYT'` — **hardcoded**, only on the `persistHoneywellLibrary` path |
| `:206` | General XLSX path: lookup by `(manufacturer_id, normalized_name)`, reuse, else insert |
| `:286` | Datasheet path, same pattern |

No standalone brand API existed. §4's search found no generic governed
reference-data abstraction to reuse for brands (`cctv-taxonomy`, `fire-alarm-taxonomy`,
`product-datasheet-registry`, `system-knowledge-registry`, `reason-governance` — none
covers canonical brands), so a focused service was justified per §40.

## 3. §40.2 / §40.3 — New standalone governed path

### `worker/canonical-product-brand.mjs` (new)

- `normalizeBrandName(value)` — the canonical rule, **extracted verbatim**.
- `validateBrandRequest(...)` — pure, runs authorization *before* any lookup.
- `ensureCanonicalBrand({ db, manufacturerId, brandName, actor, reason, provenance, organizationId, idempotencyKey })`

### `worker/product-brand-registry-api.mjs` (new)

- `POST /api/product-brands/ensure` — registers/reuses a canonical brand
- `GET  /api/product-brands/ensure?manufacturerId=…` — read-only inspection

Returns `null` on a non-matching path so the router chain continues. Wired into
`worker/index.ts` (which another lane also edits; the change is an import plus a
4-line dispatch block).

**§21 honored:** no `POST /api/product-brands` with arbitrary columns. The route
resolves the acting organization and shapes the response; authorization,
normalization, uniqueness, reason, provenance, idempotency and audit all live in the
service.

## 4. §40.6 — Semantic duplication removed, not duplicated

The single inline expression

```js
String(product.brand).toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim()
```

is now `normalizeBrandName(product.brand)`, imported by the ingestion route.
**Normalization semantics are unchanged** — verified by a test that asserts the
ingestion file calls the shared function, plus the 37/37 ingestion regression.

## 5. §40.32 — The actual normalization result (reported, not assumed)

`Gamewell-FCI`, `GAMEWELL-FCI` and `Gamewell FCI` **all normalize to
`GAMEWELL FCI`** — punctuation collapses to a single space, so all three are the *same*
canonical brand. `Gent` → `GENT`. Proven at runtime; the rule was not changed.

## 6. §40.7 — Canonical manufacturer required, never created

`MANUFACTURER_NOT_FOUND` when the `manufacturer_id` is unknown or empty. Proven: two
rejected requests created neither a manufacturer nor a brand.

## 7. §40.9 — Manufacturer-scoped uniqueness preserved

The existing `UNIQUE(manufacturer_id, normalized_name)` index is used; no global-name
uniqueness was introduced. Proven by creating `GENT` under **both** Honeywell and Cisco
as two distinct canonical rows, and by a direct insert that correctly raises
`UNIQUE constraint failed`.

## 8. §40.10 / §40.11 — Lookup-first reuse and idempotency

Explicit lookup before any write — never catching a UNIQUE exception. Proven:

- replaying the same request returns the **same row**, `created:false, idempotent:true`;
- a *differently-keyed* request for the same brand reuses the same row;
- a differently-spelled request (`gent` vs `Gent`) reuses the same row;
- reuse writes **nothing** — Farenhyt's row is byte-identical before and after, with
  no status reset or timestamp rewrite, and **no decision row is created** for reuse.

## 9. §40.33 — Concurrency

`Promise.allSettled` on two simultaneous `Gent` registrations yields exactly **one**
`GENT` row and **one** decision row. The write path catches a race failure, re-reads,
and converges on the winner rather than erroring.

## 10. §40.12–§40.15 — Governance contract

| Gate | Rule | Proof |
|---|---|---|
| Authorization | `requireLibraryCapability(actor, "apply")` = **Library Manager** | Viewer → 403, Reviewer → 403, Manager → created, Administrator → created |
| Reason | `MIN_GOVERNED_REASON_LENGTH` | `""`, `"ok"`, `"x"` all refused |
| Provenance | ≥1 source reference required | `null`, `""`, `[]`, `[{}]`, `{}` all refused |
| Manufacturer | must pre-exist | `MANUFACTURER_NOT_FOUND` |
| Brand name | must normalize to something | `"---"` refused |

This is the **same bar** the ingestion path enforces through its own
`canGovernGlobal()` (Administrator/Library Manager). It is not weakened.

**§40.15 audit:** writes through the existing generic `product_library_decisions`
table (`entity_type='Product Brand'`, `action='Canonical Product Brand Created'`),
capturing actor, role, reason, the requested and normalized names, the manufacturer,
and the new status. **No new audit table was created.**

## 11. §40.17 — Brand status and §40.18 — status is not usability

New rows are created with `status = 'Needs Review'`, exactly matching the existing
ingestion writers. Manager authorization does **not** make a brand "Active" or
"Approved" — that would be a separate governance action, and none was invented.
`product_brands.status` is not consulted by `canonical-product-resolver.mjs` (a
`LEFT JOIN`), which is consistent with Farenhyt's own `Needs Review` row already
backing 503 products. Not changed.

## 12. §40.16 — Organization semantics

`product_brands` is **global** (no `organization_id` column) — correctly so, and no
scoping was invented. The acting organization and user are still captured in the
audit row, matching repository convention.

## 13. §40.26 / §40.39 — No downstream side effects

Proven by a before/after count across 13 tables. Creating both brands changed
**only** `product_brands` (+2) and added one decision row. Verified untouched:
`product_manufacturers`, `product_identities`, `product_identity_reviews`,
`library_products`, `product_source_evidence`, `product_identity_prices`,
`product_certifications`, `product_accessories`, `product_compatibility`,
`technical_requirements`, `requirement_compatibility`,
`fire_alarm_preliminary_sizing_snapshots`.

No promotion was run. No identity mutated. No product created. No compatibility or
ecosystem decision. §22 (no alias subsystem) and §23 (no ecosystem field) honored.

## 14. A real defect I introduced and fixed

My first placement of the service in `app/domain/` imported `../worker/library-auth.mjs`,
which resolved to a non-existent `app/worker/`. Beyond the broken path, it was a
**layering violation**: I checked all 26 other `app/domain` references to `worker/`
and every one is a *comment*, never an import — the domain layer is pure. I moved the
service to `worker/canonical-product-brand.mjs`, where importing the library
authorization model is legitimate. This was caught by an explicit import check, not
left to surface later; `npm run build` had genuinely failed because of it.

## 15. Files changed

| File | Change |
|---|---|
| `worker/canonical-product-brand.mjs` | **new** — governed brand service |
| `worker/product-brand-registry-api.mjs` | **new** — `POST/GET /api/product-brands/ensure` |
| `worker/product-price-library-api.mjs` | **1 line** — ingestion now calls the shared `normalizeBrandName` |
| `worker/index.ts` | +import, +4-line dispatch (alongside another lane's edits) |
| `tests/golden-7a3b1-canonical-brand-registry.test.mjs` | **new** — 12 tests |
| `scripts/test-classification-baseline.json` | drift re-recorded (435 files) |

**No schema change. No new table, no new column, no ecosystem field.** No Fire Alarm
engineering policy touched. Promotion untouched (that is 7A3B2).

## 16. Tests / lint / build

| Check | Result |
|---|---|
| `golden-7a3b1-canonical-brand-registry` (new) | **12/12** (first run) |
| `task9-fire-alarm-library` (ingestion regression) | 37/37 |
| `golden-7a3m` (attribution) | 6/6 |
| `quotation-authority` | 18/18 |
| `product-matching-engine` | 77/77 |
| `npm test` | **519/519** |
| `npm run build` | passes |
| `eslint` (3 new/changed files) | 0 errors, 0 warnings |
| `test:all` | 4409 tests, 4393 pass, **2 fail**; drift gate green (435 files) |

The 2 `test:all` failures are the long-standing pre-existing
`boq-line-bom-summary` pair. The addressability trio seen in the previous slice has
since been fixed by its owning lane.

## 17. Business-state write declaration

None. Live D1 remained **read-only**. **The `Gamewell-FCI` and `Gent` brand rows were
NOT inserted into live state** — the whole proof ran on disposable in-memory databases
built from the real active chain. No live identity review, promotion,
`library_products`, `product_manufacturers` or `approved_for_discovery` mutation; no
matching, pricing or quotation mutation; no deploy, restart, commit or push.

## 18. §40.41 — Executing the live registration

The next action, **if authorized**, is exactly two `POST /api/product-brands/ensure`
calls as a Library Manager:

```
manufacturerId = <Honeywell id>
brandName      = "Gamewell-FCI"   reason = <substantive>   provenance = { fileId: <GW-FCI price list> }
manufacturerId = <Honeywell id>
brandName      = "Gent"           reason = <substantive>   provenance = { fileId: <KSA Gent price list> }
```

Both are idempotent, and the source documents already exist in the knowledge base, so
provenance references are real.

## 19. §40.45 — Gate recommendation for GOLDEN-7A3B2

**YES — proceed to GOLDEN-7A3B2 — Governed Promotion Brand / Family Resolution.**

The registry can now represent `Honeywell / Farenhyt`, `Honeywell / Gamewell-FCI` and
`Honeywell / Gent` as three distinct canonical rows through a governed operation.

**But the blocker I found in 7A3B is NOT resolved by this slice**, and 7A3B2 must
address it: `promoteProductIdentity` still contains **zero** references to `brand_id`
and `family_id`, so a promoted product would still land with `brand = NULL` even for
a perfectly governed Gamewell-FCI identity. Registering the brands is necessary but
not sufficient.

7A3B2 must therefore:
1. resolve `brand_id` from `product_identities.brand` against the (now complete)
   registry, under the resolved manufacturer;
2. resolve `family_id` from the identity's `category`/`family` where a governed family
   exists;
3. **fail closed** when required brand/family semantics cannot be resolved, rather
   than silently writing NULL;
4. preserve the promotion safety contract: `approvedForDiscovery = false`,
   `costingEligible = false`, `pricesCreated = 0`.

Live brand registration and 7A3B2 both require authorization; neither was performed
here.

> No live compatibility decision, live requirement approval, live profile
> regeneration, live matching run, live safety approval, live panel selection,
> live sizing snapshot, pricing mutation, quotation mutation, commit, push,
> deployment, restart, or unrelated business-state mutation was performed.
