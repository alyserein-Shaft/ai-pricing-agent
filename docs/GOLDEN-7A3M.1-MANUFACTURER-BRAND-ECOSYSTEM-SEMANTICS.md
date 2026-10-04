# GOLDEN-7A3M.1 — Manufacturer / Brand / Ecosystem Canonical Semantics Reconciliation

## 1. Verdict

```
CLOSED — MANUFACTURER / BRAND / ECOSYSTEM CANONICAL SEMANTICS RECONCILED
+ ONE CONCRETE ARCHITECTURE GAP REPORTED (missing brand rows for 2 of 3 ecosystems)
```

The contradiction is resolved. **My own GOLDEN-7A3M Gent example was semantically
wrong**, and I say so explicitly in §7 rather than quietly rewriting history.

## 2. The contradiction, stated plainly

GOLDEN-7A3M's report said conceptually `Gamewell-FCI / Gent / Farenhyt →
manufacturer = Honeywell`, while its runtime proof resolved Gent's `COMPACT-24-N` to
`manufacturer = "Gent"`. Both cannot be the repository convention.

## 3. §40.1–§40.3 — Answer: **A. The legal/corporate parent**

Determined from repository data, **not** corporate-ownership knowledge.

### 3.1 Field semantics traced from production consumers

`worker/canonical-product-resolver.mjs:10` is the canonical product read:

```sql
SELECT p.*, m.name manufacturer, b.name brand, f.name family
FROM library_products p
JOIN product_manufacturers m ON m.id = p.manufacturer_id   -- INNER
LEFT JOIN product_brands b   ON b.id = p.brand_id          -- LEFT, optional
LEFT JOIN product_families f ON f.id = p.family_id         -- LEFT
```

`worker/boq-line-bom-api.mjs:61`, `boq-line-decision-api.mjs:40`,
`ai-presales-agent-tools.mjs:148` and `cctv-knowledge-api.mjs:74` all read or filter
through the same `manufacturer_id → product_manufacturers.name` join;
`cctv-knowledge-api.mjs:39,58` **filter by `p.manufacturer_id`**, so manufacturer is
a real filter dimension and its value is load-bearing.

### 3.2 The established convention, measured

| Measurement | Result |
|---|---|
| `product_manufacturers` rows | 17 (incl. `Honeywell`; **no** Gent / Gamewell-FCI / Simplex / Johnson Controls) |
| `product_brands` rows | **1** — `Farenhyt` under `Honeywell` |
| Products with `brand_id` | **503** |
| …of those, `manufacturer` | **503 = `Honeywell`** (100%) |
| Products with `brand_id IS NULL` | 448 (Cisco, Huawei, CCTV, network domains) |
| Fire Alarm *families* carrying `brand_id` | 10+, all bound to the `Farenhyt` brand |

All ten governed Fire Alarm panels encode:

```
IFP-2100HV  →  manufacturer = Honeywell | brand = Farenhyt | family = Fire Alarm Control Panel | role = Primary Equipment
```

**A product library in which 503 of 503 branded products are `manufacturer =
Honeywell, brand = Farenhyt` has one convention, and it is A.** `product_families.brand_id`
independently confirms the brand concept exists to partition *within* a manufacturer.

## 4. §40.4 — Existing canonical product census (§40.5)

| Entity | In `product_manufacturers`? | In `product_brands`? | Convention |
|---|---|---|---|
| Honeywell | ✅ | — | parent manufacturer |
| Farenhyt | ❌ | ✅ under Honeywell | **brand** |
| Gamewell-FCI | ❌ | ❌ | **no representation at all** |
| Gent | ❌ | ❌ | **no representation at all** |
| Simplex | ❌ | ❌ | no representation |
| Johnson Controls | ❌ | ❌ | no representation |
| Notifier / System Sensor | ❌ | ❌ | no representation |

There is **no ecosystem field anywhere** in the product library — the only
brand-related columns are `library_products.brand_id`, `product_families.brand_id`
and `product_identities.brand`.

## 5. §40.6 — Canonicalizer behaviour is not field semantics (§6)

Reconfirmed at runtime: `canonicalManufacturerName("Honeywell Fire Systems")` →
`{ canonical: "Honeywell", matchedAlias: true }`, while `Gamewell-FCI`, `Gent` and
`Farenhyt` each return `matchedAlias: false`.

Exactly as the mission states, this proves **nothing** about what
`library_products.manufacturer` must contain. The canonicalizer only answers "are
these two strings the same legal entity?" — it is not a brand/division table, and
`Gent → canonical Gent` does not make `Gent` a valid manufacturer field value.

## 6. §40.19 — Review-value validation: mechanically valid ≠ semantically governed

`reviewProductIdentity` accepts **any string** for `manufacturer`. There is **no
validation against `product_manufacturers`** at review time — the value is stored
verbatim in `resolved_manufacturer` and only canonicalized at promotion.

The consequence is proven from `promoteProductIdentity:82-84,106`:

```js
manufacturerName = canonicalManufacturerName(identity.manufacturer).canonical
existingManufacturer = SELECT … FROM product_manufacturers WHERE normalized_name=?
if (!existingManufacturer)
  INSERT INTO product_manufacturers (…, status='Needs Review')
```

**A review resolving `manufacturer = "Gent"` would silently create a NEW
`product_manufacturers` row for "Gent"** and fork it away from Honeywell — and
product dedup keys on `manufacturer_id + normalized_part_number` (`:84`), so the
same physical part could then exist under two manufacturers.

🔴 **Recommended future guard (not implemented — no authorization):** validate
`resolved_manufacturer` against the canonical `product_manufacturers` registry at
review time, or at minimum refuse a manufacturer absent from the registry when a
registry row for a parent already covers the division. Reported as an architecture
finding per §27.

## 7. §40.13 / §40.14 / §40.15 — Resolving the three runtime examples

| Example | Was it semantically correct? | Resolution |
|---|---|---|
| `COMPACT-24-N` → `Gent` | **NO.** I proved the *review mechanics* correctly but used a manufacturer value with **no canonical registry row**. | Under the repository convention this should resolve to `manufacturer = Honeywell` with `brand = Gent`. My 7A3M test asserted review-mechanics behaviour, not semantic validity — and I did not claim the latter, but the choice of value was still wrong. |
| `1100-0450` → `Honeywell` | **YES.** Matches the established convention. | Correct. |
| `5815RMK` → `Honeywell` | **YES.** Matches all 503 existing products and the `Farenhyt` brand. | Correct. |

So the 7A3M suite proved the mechanism for Gent and Gamewell-FCI while using an
inconsistent manufacturer value for Gent. The mechanics transfer; the value does not.

## 8. §40.16 — Final outcome matrix (no row left ambiguous)

| Ecosystem | Canonical manufacturer | Canonical brand | Ecosystem | Reason |
|---|---|---|---|---|
| **Farenhyt** | `Honeywell` | `Farenhyt` | Farenhyt | 503 existing products + existing brand row + brand-bound families |
| **Gamewell-FCI** | `Honeywell` | **row missing** — requires a new `product_brands` row under Honeywell | Gamewell-FCI | same convention; **not yet representable** |
| **Gent** | `Honeywell` | **row missing** — requires a new `product_brands` row under Honeywell | Gent | same convention; **not yet representable** |

**Ecosystem is not a product-library field.** For Farenhyt it is carried implicitly
by `brand = Farenhyt`. For Gamewell-FCI and Gent it is currently **unrepresentable**,
because their brand rows do not exist. GOLDEN-5's ecosystem values
(`Farenhyt` / `Gamewell-FCI` / `Gent`) live in the ecosystem policy, not the catalog.

## 9. §40.8 / §40.10 / §40.26 — Compatibility boundaries are not at risk

`manufacturer = Honeywell` is a **catalog** attribute. Ecosystem/compatibility is
resolved by the GOLDEN-5 policy and by `technical_requirements` /
`requirement_compatibility`, which are project-side and never read
`product_manufacturers`. Setting manufacturer to Honeywell therefore cannot merge
Farenhyt, Gamewell-FCI and Gent into one compatibility family, and nothing in this
slice touches the matching or compatibility policy (§40.18 honored — no special-case
matching added).

## 10. §40.11 — Pricing impact

Promotion keys `product_id` on `digest(org:manufacturerKey:partKey)`. Because
`manufacturerKey` participates in the digest, promoting a Gent product as
`Gent` would mint a **different product id** than promoting the same part as
`Honeywell` — i.e. the wrong value does not merely mislabel, it **duplicates the
product** and splits any future pricing. This is the concrete reason
reconciliation must precede promotion. No pricing was read for ranking and none
was mutated.

## 11. §40.21 — Correction before promotion is versioned and auditable

The review model is cumulative and versioned: each review snapshots
`previous_snapshot_json`, records `identity_version_before/after`, and
`PRODUCT_IDENTITY_REVIEW_OVERLAY_SQL` takes the **latest `Active` review ordered by
`created_at DESC`**. So `review v1: manufacturer = X` followed by a governed
`review v2: manufacturer = Y` is fully supported, auditable, and leaves both rows
in place. Correcting a wrong value **before** promotion therefore needs no special
mechanism. I did not mutate any live review.

## 12. §40.22 / §40.23 / §40.24 — Runtime and scope

The review execution mechanics are already proven green in GOLDEN-7A3M (6/6,
real-schema, three ecosystems) and are unchanged by this slice, which is semantic
reconciliation. **No promotion was run. No live identity was modified. No schema
change was made** — no `parent_manufacturer`, `corporate_owner` or `brand_owner`
field was added; the gap is reported rather than papered over with a new column.

## 13. Files changed

**None.** This slice produced a semantic determination from a read-only census and
source tracing. No production file, test file, schema or migration was added or
modified, and no existing test was touched.

## 14. Tests / lint / build

| Check | Result |
|---|---|
| `npm test` | **519/519** (unchanged) |
| `npm run build` | passes |
| lint | no changed files |
| `test:all` | unchanged from the previous slice's baseline (5 failures, all in other lanes' files) |

No new test was landed because the mission's deliverable is a semantic
determination, and the runtime mechanics it depends on are already covered by
`tests/golden-7a3m-manufacturer-attribution-review.test.mjs` (6/6).

## 15. Business-state no-write declaration

None. Live D1 read-only. No live identity review, no promotion, no
`library_products`, `product_manufacturers`, `product_brands` or
`approved_for_discovery` mutation; no pricing, matching, selection or quotation
mutation; no deploy, restart, commit or push.

## 16. Architecture finding (§27)

**The product library cannot currently represent Gamewell-FCI or Gent as a brand.**
`product_brands` contains exactly one row. Promoting a Gamewell-FCI or Gent product
under the correct `manufacturer = Honeywell` would leave `brand = NULL`, and with no
ecosystem field the compatibility family would be unrepresentable in the catalog.

**Minimal, convention-consistent remedy (requires authorization — not implemented):**
add two `product_brands` rows under the existing `Honeywell` manufacturer —
`Gamewell-FCI` and `Gent` — mirroring the existing `Farenhyt` row exactly. This adds
no schema and invents no convention; it populates an existing table the model
already anticipates. Setting `library_products.brand_id` at promotion would then
need the same governed treatment manufacturer review has.

## 17. §40.30 — Gate recommendation for GOLDEN-7A3P

**NO — stop promotion until the brand gap is closed.**

Manufacturer attribution is now settled and deterministic (`Honeywell` for all
three), and correcting a wrong value pre-promotion is versioned and auditable. But
promoting Gamewell-FCI or Gent **today** would create products with
`brand = NULL` and no representable ecosystem, and promoting Gent as
`manufacturer = "Gent"` would fork the manufacturer registry and mint duplicate
product ids.

**Order:**
1. **GOLDEN-7A3B — brand registry** (small, additive): add `Gamewell-FCI` and
   `Gent` rows to `product_brands` under `Honeywell`, mirroring `Farenhyt`. No schema
   change. Requires authorization since it mutates governed catalog reference data.
2. **GOLDEN-7A3P — review + promotion**, with `manufacturer = Honeywell` and
   `brand` set to the division. Re-review any identity already resolved to
   `manufacturer = "Gent"` first — supported by the versioning evidence in §11.
3. **GOLDEN-7A4** capacity evidence, then **GOLDEN-7B**.

Simplex remains an upstream dependency (no knowledge document, §45 of 7A3M).

> No live compatibility decision, live requirement approval, live profile
> regeneration, live matching run, live safety approval, live panel selection,
> live sizing snapshot, pricing mutation, quotation mutation, commit, push,
> deployment, restart, or unrelated business-state mutation was performed.
