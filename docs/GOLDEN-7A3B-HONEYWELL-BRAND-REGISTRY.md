# GOLDEN-7A3B — Governed Honeywell Fire Alarm Brand Registry

- Lane: GOLDEN-7A3M.1 → **7A3B (this lane)**. This document supersedes the
  earlier read-only 7A3B pass, which reached the same verdict but from source
  tracing only. Everything asserted here is now backed by an executable,
  real-schema runtime proof, and three of its claims are corrected below.
- Verdict: **PARTIAL — BRAND SEMANTICS PROVEN; TWO UPSTREAM DEFECTS BLOCK
  PROMOTION.** See §40.17.
- Write declaration: **no live business state was written.** No `product_brands`
  row, no `product_manufacturers` row, no identity review, no promotion, no
  `library_products` or `approved_for_discovery` mutation, no matching run, no
  pricing or quotation mutation, no commit, push, deploy or restart. Live D1 was
  opened read-only for census queries only.

---

## 1. Verdict

The brand registry is **correct as a model** and **complete-able safely**, but
closing the two missing brand rows would change **nothing** about the outcome
this lane exists to enable. Two defects sit upstream of the registry, and the
bigger one makes promotion unable to run at all.

| # | Finding | Severity |
|---|---|---|
| 1 | `promoteProductIdentity` selects `v.file_name`; the real `document_versions` has no such column. **Promotion throws and cannot complete.** | 🔴 blocker |
| 2 | `promoteProductIdentity` never writes `brand_id` or `family_id`. Even when it runs, every promoted product lands with `brand = NULL`. | 🔴 blocker for brand identity |
| 3 | `Gamewell-FCI` and `Gent` brand rows are absent, and there was no authorized mutation path. | 🟡 real, but not binding |
| 4 | `product_brands` records no actor or reason. Brand creation is unaudited. | 🟡 governance gap |
| 5 | `Honeywell International` is not aliased to `Honeywell`; it would create a duplicate legal entity. | 🟡 manufacturer gap |
| 6 | `GamewellFCI` does not normalize onto `Gamewell-FCI`; no alias table can catch it. | 🟡 normalization gap |

I did **not** create the two brand rows. The write path did not exist when this
lane started; a concurrent GOLDEN-7A3B1 lane has since added
`POST /api/product-brands/ensure` (§40.4), so finding 3 is now addressable. But
findings 1 and 2 are untouched by that work, and **neither is the brand
registry**.

---

## 2. 🔴 Finding 1 — promotion is unrunnable against the real schema

`worker/product-identity-api.mjs:95` verifies provenance with:

```sql
SELECT d.id, d.project_id, v.id version_id, v.file_name, v.sha256
  FROM documents d JOIN document_versions v ON v.document_id = d.id
 WHERE d.id = ? AND v.id = ? AND v.sha256 = ?
```

The real table has **no `file_name` column**:

| Column | Present |
|---|---|
| `original_filename` | ✅ |
| `stored_filename` | ✅ |
| `file_name` | ❌ |

**Runtime proof** (`tests/golden-7a3b-honeywell-brand-registry.test.mjs` C1, real
`drizzle-active/` schema, real `promoteProductIdentity`):

- the verbatim query throws `no such column: v.file_name`;
- `reviewProductIdentity` on the same fixture returns **201** — so the failure is
  specific to promotion, not to the fixture;
- `promoteProductIdentity` **rejects** with the same error, and is an unhandled
  throw rather than a governed 4xx;
- nothing is written: 0 `product_identity_promotions`, 0 Organization-Library
  products, 0 decisions.

**This had been hidden by a stale fixture.** `tests/product-identity-review-promotion.test.mjs`
declares its own `document_versions(id, document_id, file_name, sha256)`, which
makes the column exist. That test passes 15/15 and asserts promotion is
functional. Building the fixture from the real migration chain is what exposed
it — which is the entire reason this lane uses `drizzle-active/` rather than a
hand-written schema.

**Consistent with live state:** `product_identity_promotions` has **0 rows**,
`library_products` has **0** rows scoped `Organization Library`, while
`product_identity_reviews` has 3. Reviews ran; no promotion ever completed.

---

## 3. 🔴 Finding 2 — promotion is brand-blind

With only the missing column repaired **in the disposable database**, promotion
runs — and the registry still makes no difference (C2/C3/C4):

| Scenario | Status | `brand_id` | `family_id` |
|---|---|---|---|
| Brand row **absent** | 201 | `NULL` | `NULL` |
| Brand row **present** | 201 | `NULL` | `NULL` |

`assert.deepEqual(withBrands, withoutBrands)` — the promoted product state is
**byte-identical**. The `library_products` insert names 15 columns and
`brand_id` / `family_id` are not among them; the module contains **zero**
occurrences of either string. `product_identities.brand` *is* materialized
(`brand=COALESCE(product_identities.brand, …)`) and then never read.

This holds for `Gamewell-FCI`, for `Gent`, and for `Farenhyt` — the brand whose
row has existed all along.

**§40.14 — documented behavior with a missing brand row.** None of the four
options the mission offered:

| Question | Actual answer |
|---|---|
| Does promotion fail? | Not because of the brand. It fails earlier, on the missing column. |
| Does it create the brand dynamically? | No — it never looks for a brand. |
| Does it drop brand to NULL? | Yes — `brand_id` is never written. |
| Does it ignore brand? | Yes — the identity's brand is carried and discarded. |

**§40.15 conclusion:** dynamic brand creation does not exist and must not be
relied on. Governed pre-registration is right, and is what 7A3B1 built.

---

## 4. §40.1 — `product_brands` schema and constraints

```sql
CREATE TABLE `product_brands` (
  `id`              text PRIMARY KEY NOT NULL,
  `manufacturer_id` text NOT NULL REFERENCES `product_manufacturers`(`id`),
  `name`            text NOT NULL,
  `normalized_name` text NOT NULL,
  `status`          text NOT NULL DEFAULT 'Needs Review',
  `created_at`      text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX `product_brands_manufacturer_name_idx`
  ON `product_brands` (`manufacturer_id`,`normalized_name`);
```

**§40.8 — uniqueness is manufacturer-scoped**, so `Gamewell-FCI` under Honeywell
cannot collide with the same name elsewhere. Proven by execution (A1): the same
brand under a second manufacturer inserts fine, while a repeat under Honeywell is
refused by the database itself.

**§40.16 / §40.9 — no alias mechanism and no provenance.** The table has no alias
table, no `created_by`, no `reason`, no `source` (A2). Consequences, both
reported rather than worked around:

- brand registration cannot record who added a brand or why;
- `product_library_decisions` holds **0** rows for any Brand or Manufacturer
  entity across all 56 rows, while promotion *does* audit (C5). The comparison
  is unflattering and intentional to state.

**§40.17 — no ecosystem field** exists in any table, and none was added (A2).
`library_products.brand_id`, `product_families.brand_id` and
`product_identities.brand` all already exist, so the model needs no change.

---

## 5. §40.2 / §40.3 / §40.29 — the Farenhyt template and Honeywell anchor

`product_brands` contains **exactly one row**, and it is the template:

| Field | Value |
|---|---|
| `id` | `brand_9c537844-7f03-41e4-a863-8730028b254f` |
| `manufacturer_id` | `manufacturer_49c62f94-24d3-4cfb-8b91-c7b9116ca122` |
| `name` / `normalized_name` | `Farenhyt` / `FARENHYT` |
| `status` | `Needs Review` |

`product_manufacturers` holds 17 rows with a single `HONEYWELL`, whose
`normalized_name` is globally unique. 503 `library_products` carry it; 503
products carry a `brand_id` and **all** point at Farenhyt; 35 of 44
`product_families` are bound to it. So Farenhyt is the live precedent for the
exact structural pattern (A4), and reuse leaves it byte-identical.

**§40.13 Farenhyt non-regression:** nothing was written; the row, its 503
products and its 35 families are untouched (A4).

**§40.5 — the manufacturer anchor negative assertion is only half true** (A3):

| Input | Canonical | Aliased? |
|---|---|---|
| `Honeywell` | `Honeywell` | — |
| `Honeywell Fire Systems` | `Honeywell` | ✅ yes |
| `Honeywell International` | `Honeywell International` | ❌ **no** |

So a promotion carrying `Honeywell International` would create a **second legal
entity** for the same corporate parent. Separately, `canonicalManufacturerName("Gent")`
returns `Gent` and `canonicalManufacturerName("Gamewell-FCI")` returns
`Gamewell-FCI` — which is exactly the 7A3M.1 failure mode: a brand value
flowing into the manufacturer position would become a manufacturer. A3 pins
both.

---

## 6. §40.6 / §40.7 — canonical brand decisions

Normalization is the repository's own convention, verified byte-identical to both
the ingest path and the concurrent 7A3B1 module:
`toUpperCase().replace(/[^A-Z0-9]+/g," ").trim()`.

| Ecosystem | Manufacturer | Brand `name` | Brand `normalized_name` | Action |
|---|---|---|---|---|
| Farenhyt | `Honeywell` | `Farenhyt` | `FARENHYT` | `EXISTING_BRAND_REUSED` |
| Gamewell-FCI | `Honeywell` | `Gamewell-FCI` | **`GAMEWELL FCI`** | `NEW_BRAND_REQUIRED` |
| Gent | `Honeywell` | `Gent` | `GENT` | `NEW_BRAND_REQUIRED` |

**Correction to the earlier pass:** the canonical key is `GAMEWELL FCI`, not
`GAMEWELL-FCI` — the convention collapses the hyphen to a space. The display
`name` keeps it. Asserting `GAMEWELL-FCI` would have been wrong (B1).

**§40.11 / §40.13 / §40.9 — normalization is partial, and that is a real gap.**
Collapsed onto the canonical row: `gamewell-fci`, `Gamewell FCI`, `GAMEWELL-FCI`,
`  Gamewell-FCI  `, `Gamewell  -  FCI`, `gent`, `GENT`, ` Gent ` (B2). **Not**
collapsed: `GamewellFCI` → `GAMEWELLFCI`, a different key, which would create a
**second** brand row — and with no alias table, the registry cannot detect it.
The unique index still refuses an exact-key duplicate, so the failure mode is a
near-duplicate, not a double insert.

**§40.6 / §40.9:** no `Gamewell FCI`, `GAMEWELLFCI`, `Gent by Honeywell`,
`Honeywell Gent` or `Honeywell` brand was created as a separate canonical row.

---

## 7. §40.4 / §40.5 — mutation path and authorization

**As of this lane's start: there was no brand-creation API.** `product_brands` was
written at exactly three call sites, all inside document ingestion, and all as a
side effect (B4):

| Site | Behavior |
|---|---|
| `product-price-library-api.mjs:177` | Hardcodes `'Farenhyt'` — a brand-specific special case in a general path. |
| `:206` | General XLSX: lookup by `(manufacturer_id, normalized_name)`, reuse else insert. |
| `:286` | Datasheet: same reuse-then-insert. |

The only governed route that reached any of them was
`POST /api/library/document-versions/:id/ingest`, requiring
`canGovernGlobal` (**Administrator \| Library Manager**, else
`LIBRARY_ROLE_REQUIRED` 403), a **manually confirmed** document classification of
`Price List` / `Product Catalogue` / `Product Datasheet` (else
`SOURCE_CLASSIFICATION_REQUIRED` 409), and a readable source object.

**§40.18 write-mode decision: (C) architecture gap** — no authorized standalone
brand mutation path existed. Raw SQL was rejected, because it would bypass both
`canGovernGlobal` and the source-classification requirement.

**A concurrent GOLDEN-7A3B1 lane has since supplied one:**
`POST /api/product-brands/ensure`, via `worker/canonical-product-brand.mjs` +
`worker/product-brand-registry-api.mjs`, wired at `worker/index.ts:144-145`,
gated by `requireLibraryCapability(actor, "apply")`, with
`canonicalBrandId(manufacturerId, normalizedName)` making the id content-derived
and therefore idempotent by construction, `status = 'Needs Review'`, and
reuse-on-hit. Its 12 tests pass. Its normalization is byte-identical to the
ingest path, so the two writers converge on one canonical key and cannot
diverge. **Finding 3 is therefore now addressable; findings 1 and 2 are not
addressed by it.**

---

## 8. §40.19 / §40.20 — idempotency and referential integrity

Idempotency (B2): three consecutive re-registrations of each brand are all
`EXISTING_BRAND_REUSED`; the registry is byte-identical afterwards. Reuse does
not reset `status` or rewrite `created_at`.

Referential integrity (B3): an orphan brand is refused by the foreign key
(`FOREIGN KEY constraint failed`), zero orphans remain, and
`PRAGMA foreign_key_check` returns empty.

---

## 9. §40.10 / §40.11 / §40.12 / §40.25 — boundaries

Three distinct brands, no implication between them (D1): three rows under one
`manufacturer_id`, and no table exists in which a brand-to-brand compatibility
relationship could be written.

| Consumer | Key | Boundary |
|---|---|---|
| `canonical-product-resolver.mjs:10` | `LEFT JOIN product_brands` | Resolves the correct brand; `NULL` until promotion sets one. |
| `product-identity-api.mjs:84` | `manufacturer_id + normalized_part_number` | Commercial identity — **not** brand. |
| `product-matching-api.mjs:120` | `LEFT JOIN product_brands` | Display only. |
| Pricing | `digest(org:manufacturerKey:partKey)` | Manufacturer + part number. |

So a brand row cannot split or merge a priced product, and cannot make two
brands match. Three engines that must never consult the registry —
`fire-alarm-slc-resource-classifier.mjs`,
`fire-alarm-addressability-applicability.mjs`, `knowledge-promotion-policy.mjs` —
contain no `product_brands` or `brand_id` reference (D2). **§40.11:** the same
corporate parent implies nothing; compatibility lives in
`requirement_compatibility` and the GOLDEN-5 policy, which never read brands.

**Supplier mappings** are keyed on `product_id` / manufacturer and are untouched:
brand registration writes no product, and E1 asserts every downstream count is
unchanged.

---

## 10. §40.35 / §40.36 — acceptance and negative coverage

19 executable assertions across five parts. Highlights:

| Scenario | Result | Test |
|---|---|---|
| Existing Honeywell manufacturer reused | ✅ no duplicate | B1 |
| Existing Farenhyt reused unchanged | ✅ byte-identical | A4 |
| Missing Gamewell-FCI / Gent create | ✅ `NEW_BRAND_REQUIRED` | B1 |
| Duplicate requests idempotent | ✅ no duplicate | B2 |
| Formatting variant, no duplicate | 🟡 **partial** (`GamewellFCI` not caught) | B2 |
| Wrong manufacturer parent rejected | ✅ FK | B3 |
| Three Honeywell brands distinct | ✅ | D1, D3 |
| Same manufacturer ⇒ no compatibility | ✅ no such table | D1 |
| Canonical resolver resolves brand | ✅ | D1, D2 |
| Matching / pricing boundary preserved | ✅ | D2 |
| Farenhyt unchanged | ✅ | A4 |
| No ecosystem field, no schema added | ✅ | A2 |
| No promotion creates a product | ✅ | C1 |
| **Promotion is runnable** | 🔴 **no** | C1 |
| **Registration changes promotion** | 🔴 **no** | C2 |

All ten §36 negatives are asserted: `Honeywell` ≠ brand `Honeywell`; no
ecosystem implication; no `Gamewell-FCI`↔`Gent` or `Gent`↔`Farenhyt` aliasing;
shared parent implies no compatibility; and brand creation creates no product
identity, no promotion, no `approved_for_discovery`, no pricing, and no change to
GOLDEN-5 (D1–D3, E1, E2).

---

## 11. §40.14 — Files changed

**One new file:**

- `tests/golden-7a3b-honeywell-brand-registry.test.mjs` — the §38 real-schema
  runtime proof, 19 tests.

No production file, schema, migration or route was added or modified. No
`product_brands` row was created. No live database was written. The one
`ALTER TABLE` in this lane adds a column to a **disposable** database only, as
the minimal repair that lets finding 2 be measured at all; it is never applied to
any configured database.

---

## 12. §40.15 — Tests / lint / build

| Check | Result |
|---|---|
| `tests/golden-7a3b-honeywell-brand-registry.test.mjs` | **19/19** |
| Identity & library regressions (9 suites) | **57 pass, 0 fail**, 11 pre-existing documented skips |
| `npx eslint` on the new file | **0 problems** |
| `npm run build` | **passes** |
| `authoritative-test-inventory.mjs --list` | includes the new file |

The 11 skips are explicit, reason-stated retirements in
`tests/identity-resolution-governance.test.mjs` from a concurrent lane, not
failures and not mine.

---

## 13. §40.17 — Gate result for GOLDEN-7A3P

**NO — stop promotion.**

> Can Gamewell-FCI and Gent identities be promoted as `manufacturer = Honeywell,
> brand = <division>` without registry duplication or brand loss?

- **Registry duplication:** no — impossible. Manufacturer-scoped unique index,
  content-derived ids, reuse-on-hit, and 7A3B1's `ensure` endpoint.
- **Brand loss:** **guaranteed** — `brand_id` is never written.
- **Promotion at all:** **currently impossible** — `no such column: v.file_name`.

Closing the brand registry, on its own, changes **nothing** measurable. Proving
that was the point of this lane.

### Required before 7A3P, in order

1. **Fix the provenance query** — select `original_filename` (or alias it) in
   `product-identity-api.mjs:95`. Without this, promotion cannot run at all.
2. **Give promotion brand/family resolution** — map `product_identities.brand` to
   a `product_brands` row under the resolved manufacturer, reusing 7A3B1's
   `ensureCanonicalBrand` and refusing on conflict; set `brand_id` and
   `family_id` on the product insert. No schema change needed.
3. **Register the two brands** through `POST /api/product-brands/ensure` as a
   Library Manager, with a reason. 7A3B1 makes this authorized.
4. **Then** re-review any identity whose manufacturer was recorded as a brand
   (`Gent`, `Gamewell-FCI`) to `Honeywell`, attach `product_source_evidence`, and
   promote with `approvedForDiscovery = false`, `costingEligible = false`,
   `pricesCreated = 0`.

### Also worth fixing, not blocking

- `product_brands` records no actor or reason (§16). Reference data with no
  provenance is a governance gap even if the values are right.
- `Honeywell International` is not aliased to `Honeywell`; it would duplicate the
  legal entity.
- `GamewellFCI` vs `Gamewell-FCI` produce two brand rows, undetectable without an
  alias table.

> No live compatibility decision, requirement approval, profile regeneration,
> matching run, safety approval, panel selection, sizing snapshot, pricing or
> quotation mutation, commit, push, deployment or restart was performed.
