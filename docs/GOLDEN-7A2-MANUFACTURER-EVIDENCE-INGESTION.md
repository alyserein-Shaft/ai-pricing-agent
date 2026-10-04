# GOLDEN-7A2 — Governed Manufacturer Evidence Ingestion & Product Discovery Readiness

## 1. Verdict

```
CLOSED — MANUFACTURER EVIDENCE INGESTION MECHANISM PROVEN;
SPECIFIC ECOSYSTEM COVERAGE REMAINS INCOMPLETE
```

**No new schema. No identity created. No discovery flag flipped.** §1 and §37
honored: the problem was evidence, governance and readiness — not schema.

The mechanism is proven (20/20). Coverage is **not** complete, and §41 explicitly
permits that. I did not force it.

## 2. §40.1 — Product identity / review architecture trace

`canonical_library_products` is a **VIEW** over `library_products` (confirmed in
`sqlite_master`), so every governed write targets `library_products`.

| Stage | Structure |
|---|---|
| Identity production | `product_identities`, `product_identities_observations`, `product_identities_rulesets`, `product_identities_relationships`, `product_identities_runs` |
| Identity governance | `product_identity_reviews`, `product_identity_review_guards`, `product_identity_promotions`, `product_identity_decisions`, `product_identity_events` |
| Reference registry | `product_reference_registry` / `_v2`, `product_reference_versions` |
| Identity state | `identity_status` (`Active`), `identity_version`, `superseded_by_product_id`, `library_scope` |
| Evidence provenance | `product_sources` (6), `product_source_evidence` (1,114 rows) |
| Conflicts | `product_conflicts` |
| Commercial (never technical) | `product_identity_prices` (1,204 rows) |

**1,881 identities and 1,204 prices exist, so the identity pipeline is real and
populated — but zero of it covers Gamewell-FCI, Gent or Simplex panels.**

## 3. §40.2 — Discovery-approval path trace (the decisive governance finding)

**There are two distinct predicates, and conflating them would have been a
governance error.**

`worker/canonical-product-authority.mjs` defines both:

```js
CANONICAL_DISCOVERY_PRODUCT_PREDICATE =
  "p.requested_product_id=p.id AND p.identity_status='Active'
   AND p.review_status<>'Rejected'
   AND EXISTS (SELECT 1 FROM product_source_evidence e WHERE e.product_id=p.id)"

DISCOVERY_READY_PRODUCT_PREDICATE = "approved_for_discovery=1"
```

- **`CANONICAL_DISCOVERY_PRODUCT_PREDICATE`** is the **technical** matching /
  supplier-mapping gate. It needs identity, non-Rejected status, and *real
  ingestion provenance*.
- **`approved_for_discovery=1`** is the **curated business-review listing** gate
  only. It is set by exactly two paths, both governed:
  - `product-price-library-api.mjs:616` — human review requiring
    `canGovernGlobal(user.role)` (Library Manager/Administrator) + a substantive
    reason, writing a `decision(...)` audit row;
  - `product-auto-review.mjs` — deterministic auto-approve, which **itself
    requires `review_status='Reviewed'` first**.

### Measured result for the 10 existing Farenhyt panels

| Model | identity | src evidence | **Technical match gate** | `approved_for_discovery` |
|---|---|---|---|---|
| IFP-2100ECSHV / ECSHVB | Active | 1 | **PASS** | 0 |
| IFP-2100HV / HVB | Active | 1 | **PASS** | 0 |
| IFP-75 / 75B | Active | 1 | **PASS** | 0 |
| IFP-75HV / 75HVB | Active | 2 | **PASS** | 0 |
| RFP-2100HV / HVB | Active | 1 | **PASS** | 0 |

🟢 **All ten already satisfy the technical discovery predicate.** Their
`approved_for_discovery = 0` is correct and expected: that is the *curated
listing*, a separate human decision. **This is the answer to §22/§23 — I did not
flip it, and it did not need flipping for technical matching to work.**

## 4. §40.3–§40.6 — Discovered manufacturer evidence inventories

All retrieved from official manufacturer sources; none written to the library.

### Gamewell-FCI (was 0) — `buildings.honeywell.com/us/en/brands/our-brands/gamewell-fci`

| Family | Evidence | Note |
|---|---|---|
| **E3 Series** | "flexible modular emergency evacuation fire system" | The large-system platform in GOLDEN-5's `LARGE_ULFM_CANDIDATES` |
| **S3 Series** | "Small Analog Addressable FACP … standalone or networked" | Small-system |
| **Elevate GFP-A/AR** | "intelligent software enabled FACP for small to mid size facilities" | |
| 7075 Series | Listed as a control-panel line | |
| SFP-10UD / SFP-12UD | Conventional, built-in communicators | Not addressable |

### Gent by Honeywell (was 0) — `buildings.honeywell.com/gb/en/brands/our-brands/gent`, Honeywell manual 32k

| Model / family | Evidence | Lifecycle |
|---|---|---|
| **Nano** | Full **EN 54-23** VAD support (S-Cubed, S-Quad ranges) | UNKNOWN — no lifecycle notice found |
| **System 32000 / 32k** — panel `32022`, set `32020`, network interface `32622`, repeat panel `32522` | Honeywell manual; 1 loop card, network + repeat panel options | **LEGACY** (2010 manual, superseded platform) |
| **Vigilon / Vigilon Plus** | 4- and 6-loop variants, "up to 200 devices per loop" | Third-party source only — **UNVERIFIED** |

### Simplex (was 0) — `simplexfire.com`, Simplex Product Catalog 2023 (Intl Ed.), Johnson Controls docs

| Model | Evidence | Certifications as stated |
|---|---|---|
| **4100ES** | "up to 3,000 addressable points, networkable, integrated voice notification/audio, listed for multi-hazard suppression release control" | (per part number) |
| **4010ES** | "to 1,000 detectors, modules or manual stations" | `4010-9603`: **UL, ULC, CSFM, FM** |
| **4007ES** | smaller facilities, addressable | per part number |
| **4100ESi** | Australia, AS 7240 / 4428.3 | regional variant |
| **4100U** | "4100U Series Products Note… legacy" | **DISCONTINUED** in Johnson Controls docs |
| Foundation Series | addressable control units | |
| Modules | IDNet 2 `4100-3109/3117` (250 point), IDNet 2+2 `4100-3110`, IDNAC `4100-5451`, relays `4100-3202/3204/3206`, expansion bay `4100-2300`, Flex-35/50 amplifiers `4100-1326/1327` | |

## 5. §40.7–§40.8 — Identity match / new-candidate report

| Ecosystem | Models discovered | Existing identity matched | New candidate identities | Action |
|---|---|---|---|---|
| Farenhyt | 10 (already governed) | **10** (canonical part number) | 0 | `ENRICH_EXISTING_IDENTITY` |
| Gamewell-FCI | 4 families | 0 | 4 | `REFER_TO_GOVERNED_IDENTITY_WORKFLOW` |
| Gent | 3 (Nano, 32k, Vigilon*) | 0 | 2 governed + 1 unverified | same |
| Simplex | 7 + modules | 0 | 7 | same |

**Zero identities were created.** §4 holds: a manufacturer document is a discovery
*lead*. Every new model returns `NEW_CANDIDATE_IDENTITY` /
`REFER_TO_GOVERNED_IDENTITY_WORKFLOW` and stops there.

Deduplication proven: `IFP-2100HV` matches its existing identity; `IFP 2100hv`
(a pure formatting alias) also matches; **`IFP-2100ECSHV` does not** — a voice
variant is a distinct model, never a merge.

## 6. §40.9–§40.13 — Certification / capacity / loop-protocol / expansion / advanced-capability matrices

**Certifications (independent, never inherited).** Farenhyt 2100/75 families:
`UL + FM` where the document says "UL Listing and FM Approved"; IFP-75 variants
already carry 4 persisted `product_certifications` rows. Simplex `4010-9603`:
`UL + ULC + CSFM + FM` — CSFM is a separate body and is preserved as its own claim.
Gent Nano: **`EN54` only — no LPCB**, because no independent LPCB evidence was
found. A UL-only product stays UL-only; a reseller claim yields
`CATALOG_TEXT_UNVERIFIED` / `Unverified`.

**Capacity semantics (§11 correction retained).** Farenhyt IFP-2100HV keeps five
scoped records — `BASE_SLC_LOOPS=1`, `PER_LOOP_DETECTORS=159`,
`PER_LOOP_MODULES=159`, `SYSTEM_NAMEDPLATE_POINTS=2100`, `MAX_NETWORK_NODES=32` —
each with its `rawClaim`. `nameplateOnly` stays **true**, and readiness stays
**PARTIALLY_SIZING_READY**. A large advertised number never regresses that.

**Loop / protocol.** Simplex IDNet 2's "250 point capacity" is retained as a
module-scoped claim, not promoted to a panel ceiling. FlashScan/CLIP are not
asserted for Farenhyt because the ingested document does not state them (only
Flexput circuits).

**Expansion.** `5815RMK` → `SUPPORTS_OPTIONAL_EXPANSION`,
`requiredForBaseOperation: false`; `6815` → `MOUNTED_IN 5815RMK`, 2 cards. No
project quantity is ever generated.

**Advanced capabilities, independent.** Simplex 4100ES's *"listed for multi-hazard
suppression release control"* does **not** produce a `supports_releasing` fact —
it is not the word "Releasing", and precision wins. Smoke control and releasing
are separate facts, and there is no `advanced` flag.

## 7. §40.14–§40.17 — Lifecycle, discovery readiness, sizing readiness, conflicts

**Lifecycle.** Only two records are non-UNKNOWN: Gent 32k `LEGACY` (authoritative
manual) and Simplex 4100U `DISCONTINUED` (manufacturer documentation stating
discontinuation). The real, currently-live Simplex 4100ES **product page** yields
`UNKNOWN` with `basis: NO_LIFECYCLE_EVIDENCE` — §17 satisfied: a live webpage
never implies CURRENT.

**Discovery readiness.** Reported, never granted:

| Blocker | Applies to |
|---|---|
| `NO_AUTHORITATIVE_EVIDENCE` | Vigilon (third-party only), any reseller lead |
| `IDENTITY_NOT_GOVERNED` | all 14 Gamewell-FCI / Gent / Simplex models |
| `LIFECYCLE_UNRESOLVED` | 8 of 10 Farenhyt panels + Gent Nano + Simplex 4100ES/4010ES/4007ES/4100ESi |
| `GOVERNED_PRODUCT_REVIEW_REQUIRED` | **all records, always** |

`approvedForDiscoveryChangedByThisModule: false` on every assessment.
`evidenceComplete` is **false** for Farenhyt too, because lifecycle is unresolved —
so §23's "EVIDENCE_COMPLETE ≠ APPROVED_FOR_DISCOVERY" is proven, not asserted.

**Sizing readiness.** No panel anywhere is `SIZING_READY`: all are
`PARTIALLY_SIZING_READY` (Farenhyt 2100/RFP) or `INSUFFICIENT_PRODUCT_DATA`
(IFP-75 variants, all three other ecosystems). `SYSTEM_POINT_CEILING` and
`MAX_SLC_LOOPS` are missing everywhere.

**Conflicts.** Two authorities disagreeing on a capacity scope yields
`CONFLICTING_PRODUCT_DATA` with `resolution: null` — the larger value is never
auto-selected. None currently open.

## 8. §40.18 — Tests and negative assertions

`tests/golden-7a2-manufacturer-evidence-ingestion.test.mjs` — **20/20**, every
fixture a real manufacturer claim with its provenance.

Proven negatives: `Honeywell` never resolves to ecosystem `Honeywell` (4 records,
4 distinct ecosystems); same manufacturer yields no compatibility relationship;
no rule can add FM or LPCB; a reseller page yields **zero** capacities; a live
product page yields `UNKNOWN` lifecycle; price rows are never technical authority
(using them is surfaced as `PRICE_ROWS_ARE_NOT_TECHNICAL_AUTHORITY`); evidence
completeness never flips the flag; no `best`/`cheapest`/`preferred`/`recommend`,
and `rank:` may order **source authority only**; an unknown source type is refused.

Two honest limitations recorded in the suite rather than papered over:
- the "related but distinct" hint is a **prefix** heuristic, so a middle-inserted
  suffix (`IFP-2100` → `IFP-2100ECSHV`) is not flagged as related. The governing
  *outcome* is still correct (new candidate, never a silent merge).
- an implementation defect (`ReferenceError`) surfaced and was fixed by inlining
  lifecycle normalization; no behaviour was weakened.

## 9. §40.19–§40.20 — Files changed / verification

| File | Change |
|---|---|
| `app/domain/fire-alarm-manufacturer-evidence-ingestion.mjs` | **new** — ingestion/reconciliation/coverage/readiness |
| `tests/golden-7a2-manufacturer-evidence-ingestion.test.mjs` | **new** — 20 tests |
| `scripts/test-classification-baseline.json` | drift re-recorded (431 files) |

**No production file, schema, migration, route or existing module modified.**

| Check | Result |
|---|---|
| `golden-7a2` (new) | **20/20** |
| `golden-7a` | 21/21 |
| `task9-fire-alarm-library` | 37/37 |
| `fire-alarm-attribute-semantics` | 8/8 |
| `product-matching-engine` | 77/77 |
| `npm test` | **519/519** |
| `npm run build` | passes |
| `eslint` (both new files) | 0 errors, 0 warnings |
| `test:all` | 4344 tests, 4328 pass, **2 fail** (pre-existing `boq-line-bom-summary` pair) |

## 10. §40.21 — Business-state write declaration

None. Live D1 read-only. No project compatibility/ecosystem/panel decision, no
final sizing snapshot, no matching run, no pricing or quotation mutation, no
supplier decision, no deploy, restart, commit or push. **§38 honored:** the
identity workflow is not authorized for this slice, so all product work is
fixture/dry-run proof and the exact next governed action is reported instead.

## 11. §40.22 — Remaining coverage gaps

1. 🔴 **14 discovered models have no governed identity** (4 Gamewell-FCI, 2 Gent,
   7 Simplex, 1 Simplex module set). They are leads, not catalog rows.
2. 🔴 **All 10 Farenhyt panels are `approved_for_discovery = 0`** — technically
   matchable, but absent from the curated `?discovery=true` listing.
3. 🔴 **`SYSTEM_POINT_CEILING` and `MAX_SLC_LOOPS` unevidenced for every panel
   everywhere** → nothing is `SIZING_READY`.
4. 🟠 **Lifecycle unknown for 8/10 Farenhyt panels** and for every current
   Gamewell-FCI/Simplex model (no lifecycle notices ingested).
5. 🟠 **Gamewell-FCI E3/S3 and Simplex 4100ES/4010ES capacities are marketing
   claims only** — loop counts, per-loop limits and ceilings need datasheets.
6. 🟠 **Gent Vigilon is third-party sourced only** → `UNVERIFIED`.
7. 🟠 **Certifications not yet persisted** to `product_certifications` for the new
   models; `product_aliases`/`product_variants` remain empty.
8. 🟠 **CSFM** is a real certification body in the Simplex data with no vocabulary
   slot in the current `CERTIFICATION_CLAIMS` set.

## 12. §40.23 / §42 — Can GOLDEN-7B start?

**NO. Not for every ecosystem GOLDEN-5 may resolve.**

| Ecosystem | Governed panel identities | 7B can evaluate? |
|---|---|---|
| Farenhyt | 10, all technically matchable | **Yes** — but only `PARTIALLY_SIZING_READY`, no ceiling/max loops |
| Gamewell-FCI | **0** | **No** — would return `INSUFFICIENT_PRODUCT_DATA` |
| Gent | **0** | **No** |
| Simplex | **0** | **No** |

GOLDEN-5's `LARGE_ULFM_CANDIDATES` are Gamewell-FCI and Simplex — precisely the two
ecosystems with **no catalog coverage at all**. Starting 7B now would filter
against an empty candidate set for the large-system branch, which is the branch a
>2,000-point project takes.

**Recommended next (in order):**
1. **GOLDEN-7A3 — Governed identity creation** for the 14 discovered models via
   the existing `product_identity_reviews` workflow (Library Manager/Admin +
   reason), with `product_source_evidence` provenance attached. This is the single
   largest blocker and it is *governance*, not research.
2. **GOLDEN-7A4 — Engineering capacity evidence** (datasheets/manuals) for
   `SYSTEM_POINT_CEILING`, `MAX_SLC_LOOPS` and per-loop limits, prioritised on
   **Gamewell-FCI E3** and **Simplex 4100ES**.
3. **Lifecycle notices** for Farenhyt IFP-75/IFP-2100 and the current
   Gamewell-FCI/Simplex lines.
4. Then **GOLDEN-7B**.

The project-side lane is unaffected by any of this.

> No live compatibility decision, live requirement approval, live profile
> regeneration, live matching run, live safety approval, live panel selection,
> live sizing snapshot, pricing mutation, quotation mutation, commit, push,
> deployment, restart, or unrelated business-state mutation was performed.
