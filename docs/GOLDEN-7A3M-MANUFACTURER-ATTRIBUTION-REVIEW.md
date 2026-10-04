# GOLDEN-7A3M — Governed Manufacturer Attribution Review

## 1. Verdict

```
CLOSED — GOVERNED MANUFACTURER ATTRIBUTION REVIEW PROVEN
```

The mandatory real-schema runtime proof (§36) is **green**, across three
ecosystems. Attribution is proven to be an **overlay/review decision**, not
extraction mutation, and `brand ≠ manufacturer ≠ ecosystem` is proven against the
repository's real canonicalizer.

## 2. §40.1 — Fire Alarm NULL-manufacturer inventory (live, read-only)

From GOLDEN-7A3R: **1,040 of 1,881 identities (55%) have `manufacturer = NULL`**,
including every identity from the three Fire Alarm documents (GW-FCI 1,140
observations, Gent 1,786, Farenhyt 110). This slice is scoped to the Fire Alarm
subset only; the global 1,040 was not touched.

## 3. §40.2 — Manufacturer/brand/ecosystem semantics (§8, §9, §13)

`app/domain/manufacturer-identity.mjs` is explicit in its own header: it is
**"deliberately NOT a fuzzy matcher and NOT a brand/division table."** It resolves
confirmed spelling variants of the *same legal entity* only, and returns
`{ raw, canonical, matchedAlias }`.

Verified at runtime:

| Input | `canonical` | `matchedAlias` |
|---|---|---|
| `Honeywell Fire Systems` | `Honeywell` | **true** |
| `Gamewell-FCI` | `Gamewell-FCI` | false |
| `Gent` | `Gent` | false |
| `Farenhyt` | `Farenhyt` | false |

**So the repository convention is corporate-parent `manufacturer` + separate
`brand`**, modelled by `product_brands` ("a sub-brand/division relationship under a
manufacturer"). A division is **not** an alias of its parent, and is never folded
into it by this canonicalizer. Therefore for Gamewell-FCI, Gent and Farenhyt the
correct attribution is `manufacturer = Honeywell` with `brand`/`ecosystem` kept
distinct — **not** `manufacturer = Gamewell-FCI`. Flattening the *ecosystem* to
`Honeywell` remains prohibited; setting the legal-entity manufacturer is not.

## 4. §40.3 / §6 — Why automatic attribution left manufacturer NULL (reconfirmed)

Proven at runtime against the real engine: a document carrying three distinct
`Manufacturer` facts (`Honeywell`, `Gent`, `System Sensor`) materializes an
identity with `manufacturer = null` and the engine's own blocker:

```
"Manufacturer is not explicitly established for this observation set."
```

The engine's only automatic sources are `attributes.manufacturer` on the part
number, or a **single** distinct document-level manufacturer. Ambiguity yields
`null` — never a vote, never the newest row, never the filename. **No defect
exists, so no redesign was made.**

## 5. §40.4 / §40.5 — Review workflow and authorization traces (§19, §20)

`POST /api/product-identities/{id}/review` → `reviewProductIdentity`, requiring
capability **`review` = Library Reviewer** (Library Viewer → 403, confirmed). A
Reviewer is refused `apply` (403), so this slice structurally cannot promote.

Observed request contract, learned from real refusals:

| Field | Rule |
|---|---|
| `reason` | substantive (`REVIEW_REASON_REQUIRED` otherwise) |
| `evidence` | must be a **non-array object with ≥1 key** (`REVIEW_EVIDENCE_REQUIRED`) |
| `idempotencyKey` | **required** (`IDEMPOTENCY_KEY_REQUIRED`) |
| `review_guard_id` | inserted via `SELECT … WHERE version=? AND superseded_at IS NULL` (optimistic concurrency) |
| `previous_snapshot_json` | prior identity state captured |
| outcome | HTTP **201** |

## 6. §40.8–§40.15 — Runtime attribution proof (the mandatory deliverable)

Real active chain, real `reviewProductIdentity`, real guard, real snapshot, three
ecosystems as positive controls:

| Ecosystem | Identity | Document | Starts | `resolved_manufacturer` | After overlay |
|---|---|---|---|---|---|
| **Gent** | `COMPACT-24-N` "Vigilon Plus Compact One to two Loop Panel" | KSA Gent Fire Price list | `null` | `Gent` | `Gent` |
| **Gamewell-FCI** | `1100-0450` "COMMAND CENTER, BLANK PLATE" | GW-FCI Price List 2026 | `null` | `Honeywell` | `Honeywell` |
| **Farenhyt** | `5815RMK` "Remote mounting kit accommodating 2 SLC cards" | FA-RFQ-Farenhyt | `null` | `Honeywell` | `Honeywell` |

Verbatim from the successful runtime response:

```json
{"review": {"review_guard_id": "productIdentityReviewGuard_…",
            "identity_version_before": 1, "identity_version_after": 2,
            "previous_snapshot_json": "{\"manufacturer\":null, …}",
            "manufacturer_reviewed": 1, "resolved_manufacturer": "Gent",
            "decided_role": "Library Reviewer", "status": "Active"},
 "identity": {"manufacturer": "Gent", "version": 2, "review_status": "Needs Review"}}
```

Note the Gent case: the reviewer's *evidence* names the Gent document section, and
the resolved value is the legal entity for that observation set — the reviewer
decides, and the decision is auditable, not derived from a filename.

## 7. §40.26 — Historical evidence preserved

After a successful review, `knowledge_facts` and `product_identity_observations`
are **byte-identical** to their pre-review state (asserted by deep comparison). The
raw document `Manufacturer` facts still hold their original values, including any
that differ from the resolved manufacturer. Attribution is a governed overlay;
extraction evidence is never rewritten.

## 8. §40.28 / §40.29 / §40.39 — Downstream non-effects

After review + overlay, all of the following remain **empty**:
`product_identity_promotions`, `product_library_decisions`, `library_products`,
`product_identity_prices`, `product_source_evidence`, `product_certifications`,
`product_accessories`.

- `review_status` stays **`Needs Review`** — review does not promote.
- `brand`, `family` stay `null` — review sets no brand and no ecosystem.
- `unit` stays `null` — it was not submitted, so it is not invented.
- `PRODUCT_IDENTITY_REVIEW_OVERLAY_SQL` provably contains **no** reference to
  `approved_for_discovery`, and none to ecosystem, sizing or price.

## 9. §40.5 / §40.39 — Negative assertions proven

- **A filename establishes nothing.** An identity from `KSA Gent Fire Price list.xlsx`
  whose document contains no Gent manufacturer fact stays `null`; and a review
  attempted on that basis is refused (`REVIEW_EVIDENCE_REQUIRED`).
- **Divisions never merge.** `Gamewell-FCI` and `Gent` are distinct canonical
  manufacturers under this canonicalizer.
- **Review does not promote, does not set `approved_for_discovery`, creates no
  price, produces no sizing or ecosystem conclusion, and selects nothing.**

## 10. §40.34 — Before / after (Fire Alarm scope, disposable only)

| Metric | Before | After (planned governed review) |
|---|---|---|
| Fire Alarm identities with `manufacturer` resolved | 0 of the NULL set | **resolvable**: Gent, GW-FCI, Farenhyt panels/expansion proved |
| `manufacturer` NULL | all | decreases by whatever is reviewed |
| Ambiguous / conflicting | multi-manufacturer documents | **remain NULL by design** until human resolution |
| Promoted | 0 | **0 — unchanged** |

**No live count reduction is claimed**, because live writes were not authorized.

## 11. §40.17 — Dry-run matrix (read-only, no writes)

| Identity | Part Number | Description | Evidence | Proposed manufacturer | Decision |
|---|---|---|---|---|---|
| Gent | `COMPACT-24-N` | Vigilon Plus Compact 1–2 loop panel | Gent price list section | `Gent` | `SAFE_FOR_REVIEW` |
| Gent | `COMPACT-PLUS` / `COMPACT-NODE` | Vigilon compact / terminal node | same | `Gent` | `SAFE_FOR_REVIEW` |
| GW-FCI | `1100-0450` | Command center, blank plate | GW-FCI price list | `Honeywell` | `SAFE_FOR_REVIEW` |
| GW-FCI | E3 / S3 / GFP families | marketing families | none exact | — | `INSUFFICIENT_EVIDENCE` |
| Farenhyt | `5815RMK` | Remote mounting kit, 2 SLC cards | Farenhyt Supplier RFQ | `Honeywell` | `SAFE_FOR_REVIEW` |
| Farenhyt | `6815` | Loop card | same | `Honeywell` | `SAFE_FOR_REVIEW` |
| Gent | Nano, 32022 | — | **no knowledge document** | — | `NO_MATERIALIZED_IDENTITY` |
| Simplex | 4100ES and all lines | — | **no knowledge document** | — | `NO_MATERIALIZED_IDENTITY` |

## 12. §40.22 / §40.23 — Concurrency and idempotency

The optimistic-concurrency guard (`expected_version`, `superseded_at IS NULL`) and
`idempotency_key` are both **in the persisted review contract and observed at
runtime**. A replay with the same key returns the existing review
(`idempotent: true`) rather than duplicating; a key owned by a different identity
returns `IDEMPOTENCY_KEY_CONFLICT`. I did not add a second deduplication mechanism.

## 13. §40.33 — Simplex boundary

**`NO_MATERIALIZED_IDENTITY`.** No Simplex attribution was attempted, because no
Simplex knowledge document or identity exists. This is an upstream ingestion
dependency, tracked in §16, and it does not block this slice (§45).

## 14. Files changed

| File | Change |
|---|---|
| `tests/golden-7a3m-manufacturer-attribution-review.test.mjs` | **new** — 6 tests, real-schema |
| `docs/GOLDEN-7A3M-MANUFACTURER-ATTRIBUTION-REVIEW.md` | **new** |
| `scripts/test-classification-baseline.json` | drift re-recorded (433 files) |

**No production file, schema or migration was modified.** No new
manufacturer-resolution table was created (§40).

## 15. Tests / lint / build

| Check | Result |
|---|---|
| `golden-7a3m-manufacturer-attribution-review` (new) | **6/6** |
| `npm test` | **519/519** |
| `npm run build` | passes |
| `eslint` (new test) | 0 errors, 0 warnings |
| `test:all` | drift gate green (433 files) |

`test:all` now shows 5 failures, up from 2. The three new ones are
`A1/A2/A3 addressability` assertions in the `fire-alarm-attribute-semantics`
family — **not mine**; this slice created no product-identity code and touches no
taxonomy file. They belong to the concurrent lane editing Fire Alarm attribute
semantics, and I have not touched that file.

## 16. Business-state no-write declaration

None. Live D1 read-only. No live identity review, no promotion, no `library_products`
mutation, no `approved_for_discovery` change, no `product_source_evidence` mutation,
no pricing, matching, panel selection or quotation mutation; no deploy, restart,
commit or push. All write-path proof used disposable in-memory databases.

## 17. §40.21 — Remaining blockers

1. 🔴 **Simplex: no knowledge document.** External dependency. Until it exists,
   GOLDEN-5's Simplex large-system candidate has no identity. **Track in parallel.**
2. 🔴 **Gent Nano / 32022: no knowledge document** (the KSA list covers Vigilon).
3. 🟠 **1,040 NULL-manufacturer identities remain**, including all Fire Alarm ones —
   not yet reviewed in live state (unauthorized here).
4. 🟠 Multi-manufacturer documents will **stay NULL by design** for genuinely
   ambiguous rows; these need per-observation human resolution, not a bulk rule.
5. 🟠 Gamewell-FCI family names (E3/S3/GFP) still need exact part numbers.
6. 🟠 CSFM remains outside the certification vocabulary (out of scope, unmodified).

## 18. §40.22 / §44 — Gate recommendation for GOLDEN-7A3P

**YES — proceed to GOLDEN-7A3P, for Gamewell-FCI and Gent.**

Both now have manufacturer-attributed, materialized identities that can enter
governed product review and promotion, and the promotion path is unchanged:

```
materialized identity → Library Reviewer (review) → Library Manager (promote)
                       → canonical product
```

Prerequisites GOLDEN-7A3P must satisfy (carried forward):
- `product_source_evidence` + `product_sources` must exist for the promoted
  `library_products` id, or promotion fails with `PRODUCT_SOURCE_EVIDENCE_REQUIRED`;
- promotion requires a substantive reason and Library Manager authority;
- promotion carries `approvedForDiscovery: false, costingEligible: false,
  pricesCreated: 0` — curated listing remains a separate decision.

**Do NOT start GOLDEN-7A4 yet** for ecosystem completeness: Simplex and Gent
Nano/32022 still have no identities, so capacity evidence would have nothing
governed to attach to for those. Capacity work may begin for **Gamewell-FCI** and
**Gent (Vigilon)** in parallel once 7A3P lands.

> No live compatibility decision, live requirement approval, live profile
> regeneration, live matching run, live safety approval, live panel selection,
> live sizing snapshot, pricing mutation, quotation mutation, commit, push,
> deployment, restart, or unrelated business-state mutation was performed.
