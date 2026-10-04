# Al Musa — Commercial Source Governance Pre-Closure

**Canonical project**: `project_ae501b85-9c12-4332-bf8e-787c90f2d388` — *Al Mousa School — Clean Golden Run*
**Selected panel**: `product_ec9dcbb1-39fe-4d24-b369-8b3d271604a7` — IFP-2100HV, Red cabinet
**Read type**: READ-ONLY audit. No mutation, no SQL write, no commit/push/deploy.
**Final-state re-read**: `2026-10-03T19:30:52Z` — `CURRENTNESS_STATUS = PROVEN` (re-read immediately before reporting).

Evidence labels: `[PROJECT]` = canonical D1 storage · `[CODE]` = runtime source · `[INFERENCE]` = reasoning, not observed.

---

## ⚠️ TWO CORRECTIONS TO PRIOR REPORTS

**Correction 1 — "Technical Approval pending" is STALE.**

The prior audit reported technical approval pending / 0 of 90 eligible. That is no longer true. A Technical approval landed at **2026-10-02T23:08:25.840Z**, i.e. before this audit. The prior report was a start-of-task snapshot presented as current.

**Correction 2 — the coverage figure is 77, not 62.**

Canonical storage holds **77 distinct candidate products** across 93 match runs (57 distinct BOQ items, 861 candidate rows). The prior "62" is not reproducible from any status filter I could construct.

**Correction 3 — a second, previously unreported blocker exists: Al Musa has no governed FX rate.** See §B4.

---

## 1. CORRECT THE TECHNICAL-APPROVAL ASSUMPTION

`approval_625e5fbe-19ee-40e5-affe-a2c61a8fd956` **exists and is current.** It is not in a `technical_approvals` table (none exists) nor in `pricing_approvals` (0 rows). The governed home for a technical approval is **`safety_approval_requests` where `approval_type='Technical'`**, consumed by `worker/primary-selection-authority.mjs:116-117` (`technicalApproval?.status === "Approved"`) and surfaced by `worker/confidence-safety-api.mjs:44`. `[PROJECT][CODE]`

| Field | Value `[PROJECT]` |
|---|---|
| id | `approval_625e5fbe-19ee-40e5-affe-a2c61a8fd956` |
| project_id | `project_ae501b85-9c12-4332-bf8e-787c90f2d388` |
| approval_type | `Technical` |
| **status** | **`Approved`** |
| decided_by / decided_role | `omair-primary` / Project User |
| decided_at | `2026-10-02T23:08:25.840Z` |
| safety_decision_id | `safety_ababb5f6-428b-4f98-bf1f-6055c721099e` |

### Chain of custody (each link verified, none superseded)

| Link | Value | Verified |
|---|---|---|
| Safety decision | `safety_ababb5f6` — `superseded_at` = **NULL**, version 1 | ✅ current |
| BOQ item | `boqitem_534f049e` — seq 93, item `D`, "Sub Station-1 (Near BOS building)", *Fire alarm control panel with all accessories*, qty **1 Each**, `review_status='Auto Verified'`, `approved_for_downstream=1` | ✅ |
| Match run | `matchrun_cb537b3f` | ✅ |
| Candidate | `candidate_8ac8969e` — **rank 1**, `technical_status='Compliant with Warnings'` | ✅ |
| **Product** | **`product_ec9dcbb1-39fe-4d24-b369-8b3d271604a7`** = IFP-2100HV, Red cabinet | ✅ **exact match** |

### Safety decision detail `[PROJECT]`

- `safety_state` = `Approval Ready with Warnings`
- `compliance_state` = `Compliant with Warnings`
- `technical_eligibility` = **`Eligible with Required Warning Acknowledgment`**
- `price_eligibility` = **`Price Approval Disabled`**
- confidence 99 (`confidence_level='Verified'`), `provenance_status='Complete'`, `missing_information='[]'`
- `confidence_components.priceSource` = **30** — the sole weak dimension

### Does it make the panel technically eligible? YES.

`app/domain/confidence-safety-engine.mjs:71` computes price eligibility as:

```js
const currentPrice = prices.some(p => p.approvalStatus === "Approved"
  && p.validUntil && new Date(p.validUntil) >= new Date()
  && present(p.currency) && present(p.sourceId));
const technicalApproved = technicalApproval?.status === "Approved"
  && technicalApproval?.candidateId === candidate?.id;
const priceBlocks = [];
if (!authenticatedUser) priceBlocks.push("AUTHENTICATED_USER_REQUIRED");
if (!technicalApproved) priceBlocks.push("TECHNICAL_APPROVAL_REQUIRED");
if (!currentPrice)     priceBlocks.push("CURRENT_PRICE_SOURCE_REQUIRED");
```

`technicalApproved` is now **true** (status Approved + candidateId matches). The only surviving block is `CURRENT_PRICE_SOURCE_REQUIRED` — purely commercial.

> **`TECHNICAL_APPROVAL_CURRENT = YES`**
> **`IFP2100HV_TECHNICAL_APPROVAL_IS_COMMERCIAL_BLOCKER = NO`** — removed from the commercial blocker list.
>
> Scope note: the approval text states it is *internal technical approval only*, asserting no consultant, AHJ or manufacturer acceptance. That is the correct boundary and does not affect the commercial lane.

**Do NOT reopen technical selection.** ✅

---

## 2. RE-PROVE THE IFP-2100HV COMMERCIAL BLOCKER

### 2.1 CURRENT_STATE `[PROJECT]`

`price_6980c523-856a-4621-ac51-404de322c96e` — exactly **one** price record exists for this product.

| Field | Value |
|---|---|
| amount_minor / amount | `678700` / **USD 6,787.00** |
| currency / unit | `USD` / `EA` |
| price_type | `Manufacturer List Price` |
| effective_from | `1st March 2023` |
| **valid_until** | **`NULL`** ← the gate |
| validity_state | `Historical — Validity End Missing` |
| **approval_status** | **`Needs Review`** |
| **downstream_use** | **`Discovery Only`** |
| reviewed_by / reviewed_at | `NULL` / `NULL` |
| `price_record_versions` rows | **0** → never reviewed |
| source_location | `{"sheet":"2023 Farenhyt","row":6,"cells":["F6"],"extractionMethod":"native-xlsx-structure"}` |
| source_id | `productsource_0d87f6ca-d3e1-4dd4-b452-5b83684ab0da` |

### 2.2 REQUIRED_REVIEW_ACTION

Promote this record to **`approval_status='Approved'` + `downstream_use='Costing'` + a real `valid_until`**. Both gates must clear together; the runtime requires all of:

```
approval_status === 'Approved'   ✓ needed
downstream_use  === 'Costing'     ✓ needed
valid_until && valid_until >= today  ✓ needed  ← currently NULL
currency present ✓ (USD)
source_id present ✓
```

Sources: `worker/pricing-runtime.mjs:117-124`, `app/domain/confidence-safety-engine.mjs:71`, `worker/scope-pricing-input.mjs:308`.

**The `valid_until` is the real blocker.** The 2023 Farenhyt list has **no validity end date** (503 of its 504 price rows have `valid_until IS NULL`). No code path infers, defaults or back-fills it — `product-price-library-api.mjs:399-402` is explicit:

> *"A validUntil supplied here is only ever what the reviewer's own reason/evidence asserts — never derived or defaulted, so the historical catalogue rows this route was built for stay Historical unless a reviewer supplies real evidence."*

This date therefore requires **real commercial evidence** (a supplier validity confirmation, or a finance/commercial policy statement of how long the 2023 list remains usable). It **cannot** be automated and must not be invented.

### 2.3 REQUIRED_ROLE

`product-price-library-api.mjs:9` → `canGovernGlobal = role => ["Administrator","Library Manager"].includes(role)`

`product-price-library-api.mjs:380` → if `!record.project_id && !canGovernGlobal(user.role)` → 403 `LIBRARY_ROLE_REQUIRED`.

`price_6980c523.project_id` is **NULL** and `productsource_0d87f6ca.scope_type = 'Global'` ⇒ **Administrator or Library Manager required.** A Project User cannot promote this record.

### 2.4 REQUIRED_HUMAN_AUTHORITY

**`APP_HUMAN_ID=omair-primary` / `APP_HUMAN_NAME=Omair`**, acting in a role that satisfies `canGovernGlobal`. Omair has already exercised exactly this authority twice on this same source — `discountrule_784cec95` (`approved_by=omair-primary`) and `pricesourceversion_b8367c21` (`approved_by=omair-primary`).

**I am not fabricating approval.** No prior explicit human decision authorises *this specific* promotion (0 `price_record_versions`, `reviewed_by` NULL). **Not promoted in this task.**

### 2.5 DOWNSTREAM_USE_AFTER_APPROVAL

`Costing`

### 2.6 EXACT EXISTING ROUTE / API `[CODE]`

**Primary (per-record, minimum blast radius):**

```
POST /api/price-records/price_6980c523-856a-4621-ac51-404de322c96e/review
{
  "decision": "Approve",              // "Approve" | "Reject" | "Supersede"
  "downstreamUse": "Costing",
  "validUntil": "YYYY-MM-DD",         // real evidence; must be >= today
  "reason": ">= 10 characters"
}
```
`worker/product-price-library-api.mjs:375-407`. Writes `approval_status='Approved'`, `downstream_use`, `valid_until`, `validity_state='Current Approved'` (global scope), `reviewed_by`, `reviewed_at=CURRENT_TIMESTAMP`, plus a governed `decision(...)` audit record.

**Alternative (source-level, batchable — see §4/§10):**

```
POST /api/price-sources/productsource_0d87f6ca-d3e1-4dd4-b452-5b83684ab0da/review
{ "downstreamUse": "Costing", "reason": ">= 10 characters" }
```
`worker/product-price-library-api.mjs:361-364`. Bulk-updates **every** price row under the source.

> ⚠️ **This route cannot currently reach Costing.** Line 364: `const validityCurrent = Boolean(source.valid_until) && source.valid_until >= today; if (requestedUse === "Costing" && !validityCurrent) return 409 PRICE_VALIDITY_REQUIRED;` — and `product_sources.valid_until` is **NULL**. No discovered route writes `product_sources.valid_until`. So the source route can currently only reach `Discovery Only`. It is **not** a substitute for §2.6 primary.

### 2.7 Derived money chain (unchanged, re-verified)

| Step | Value |
|---|---|
| List | `678700` minor = **USD 6,787.00** |
| × net multiplier 0.35 (`discountrule_784cec95`, 6500 bp) | **USD 2,375.45** |
| × FX 3.75 | SAR 8,907.9375 → **SAR 8,907.94** |
| money-minor (existing contract, `pricing-runtime.mjs:133`) | **890794** |

---

## 3. AUDIT THE 62-PRODUCT COMMERCIAL COVERAGE

### 3.1 Population — re-derived from canonical storage `[PROJECT]`

```
product_match_runs (project_ae501b85)          93 runs / 57 distinct BOQ items
product_match_candidates (all those runs)   861 rows
DISTINCT candidate products                   77   ← not 62
```
Match-run status: `Discovery Only` 80 · `Needs Review` 10 · `No Match` 3.

> The earlier report treated *match-run status* as if it were *price-record status*. It is not. `Discovery Only` on a run says nothing about a price's `approval_status`. This is the origin of the miscount.

### 3.2 Classification of all 77 candidates

| Class | Count | Definition applied |
|---|--:|---|
| `PRICE_READY` | **1** | has ≥1 price with `approval_status='Approved'` **and** `downstream_use='Costing'` |
| `PRICE_RECORD_NEEDS_REVIEW` | **71** | has price row(s), none Approved+Costing |
| `PRICE_APPROVED_not_Costing` | **2** | Approved but still `Discovery Only` |
| `NO_PRICE_SOURCE` | **3** | zero price rows |
| `PRICE_SOURCE_DOCUMENT_NEEDS_REVIEW` | *(subsumed)* | every sourced row traces to one unreviewed source — folded into the 71 + 2, see §5 |
| `PRICE_IDENTITY_CONFLICT` | **0** | no candidate has >1 distinct `part_number`; no price/product mismatch found |
| `STALE_PRICE` | **0** | no row is superseded or future-dated; 503 rows are undated, which is a *missing*-validity class, not a *stale* class |
| `WRONG_CURRENCY` | **0** | all 74 sourced candidates resolve to USD or SAR; `scope-pricing-input`/`pricing-runtime` accept only these |
| `OTHER` | **0** | — |
| **TOTAL** | **77** | |

### 3.3 The one PRICE_READY product

`product_0c4c8db3-674b-4564-8249-463c00885317`, price `price_1c248b3e`, `amount_minor=6500` (USD 65.00), `Approved` / `Costing`, `valid_until=2027-06-30`, `validity_state='Current Approved'`, source `productsource_0d87f6ca`.

This is the **only** record in the entire 518-row table that satisfies the costing predicate — and it is the one with a real validity end date. It is **not** the IFP-2100HV panel.

*(`amount_minor=6500` = USD 65.00 major. The money-unit contract is `amount = amount_minor / 100` — `pricing-runtime.mjs:133`.)*

### 3.4 Source attribution of the 77

| Price source | Products | Source state |
|---|--:|---|
| `productsource_0d87f6ca` — *KSA Honeywell Farenhyt Series Price List -2023.xlsx* | **73** | `Needs Review` / `Discovery Only`, `valid_until` NULL |
| `productsource_0fb65297` — *Q1067-626-LCU Central Kitchen Makkah (CCTV material list)* | 1 | `Needs Review` / `Discovery Only` — **CCTV, out of Fire Alarm scope** |
| *(none)* | 3 | — |

**Brand distribution**: Farenhyt **75** · Notifier **1** · *(unbranded)* **1**.

---

## 4. GROUP THE REVIEW BLOCKERS BY ROOT CAUSE

**The 71 are not 71 decisions. They are effectively 1.**

| # | Root cause | Affected products | Records | Independent per-product decision needed? |
|---|---|--:|--:|---|
| **R1** | Source document `productsource_0d87f6ca` never reviewed (`Needs Review`/`Discovery Only`) | **73** | 504 | **No** — one source-level decision |
| **R2** | `valid_until` absent on 503 of 504 rows ⇒ `PRICE_VALIDITY_REQUIRED` 409 on every Costing promotion | **73** | 503 | **No** — one commercial validity determination, applied uniformly |
| **R3** | Brand scope — Notifier / unbranded excluded from `discountrule_784cec95` | **2** | — | **Yes**, but only once a price exists |
| **R4** | No price source at all | **3** | 0 | **Yes** — genuine missing evidence |
| **R5** | CCTV historical quote, wrong system domain | **1** | 1 | **Yes** — should not be priced in Fire Alarm at all |

R1 and R2 are **the same 73 products** and resolve together. One governed source-level decision plus one validity determination unlocks **73 of 77 (95%)** of the candidate population.

### Can one source-level review safely unlock many exact product prices? — YES, with a caveat.

The governance model **already answers this**. `worker/product-price-library-api.mjs:366-374` states the design intent verbatim:

> *"the source-level review above always approves every price_records row under a source identically. When two records under the same source genuinely disagree (e.g. a conflict) or only one of several records is ready, an engineer needs to act on a single row ... this route [`/api/price-records/{id}/review`] is the missing single-record entry point onto those same columns."*

So batchable-by-design, with per-record escape. **The caveat**: R2 is *not* weakened by batching, and per-product identity/currentness is untouched by it — because:

1. The source route applies one identical `downstream_use` to every row under the source; it does **not** invent per-row identity, quantity or currency. `[CODE]`
2. `pricing-runtime.mjs:117-124` and `confidence-safety-engine.mjs:71` re-verify each **individual** record's `approval_status`, `downstream_use`, `valid_until`, `currency`, `source_id` at pricing time. A bulk approval cannot make an ineligible row eligible. `[CODE]`
3. `price_conflicts` + `POST /api/price-conflicts/...` exist precisely to handle rows under one source that genuinely disagree. `[CODE]`

**Recommendation**: do **not** batch. Batch is currently *unavailable* anyway (§2.6 — source `valid_until` NULL ⇒ 409), and once a real validity date exists it would approve all 504 rows of a 2023 catalogue when only a handful will enter the BOM. **Use the per-record route; batch only when the sized BOM justifies it.** This satisfies §8 (do not review unused products blindly).

---

## 5. AUDIT THE 2023 FARENHYT PRICE LIST AS A SOURCE

### 5.1 Exact source identity `[PROJECT]`

| Field | Value |
|---|---|
| id | `productsource_0d87f6ca-d3e1-4dd4-b452-5b83684ab0da` |
| file_name | `KSA Honeywell Farenhyt Series Price List -2023.xlsx` |
| checksum | `88df340663209e15b3e7b7bca0f8c2ee2cb00b0e5ffb8aee0c1018a825574391` |
| source_type | `Manufacturer Price List` |
| authority | `Manufacturer` |
| **scope_type** | **`Global`** ⇒ `canGovernGlobal` required |
| currency | `USD` |
| release_version | `V23.1` |
| effective_from | `1st March 2023` |
| **valid_until** | **`NULL`** |
| validity_state | `Historical — Validity End Missing` |
| review_status | `Needs Review` |
| downstream_use | `Discovery Only` |
| document / version | `doc_93ec065a` / `ver_3f4a3e69` |
| ingest metadata | 4 sheets reviewed, 504 products/prices detected, 504 historical, **0 valid current** |
| derived rows | **504 price records / 483 distinct products** |

### 5.2 ⚠️ Governance split — source VERSION is governed, source DOCUMENT is not

`price_source_versions` row `pricesourceversion_b8367c21`:

| Field | Value |
|---|---|
| approval_state | **`Approved`** |
| downstream_use | **`Costing`** |
| approved_by | **`omair-primary`** |
| reliability | `Current Internal Reference` |
| currency / effective_from | `USD` / `1st March 2023` |

So the **source version** is Approved/Costing while the **source document** row is `Needs Review`/`Discovery Only` and the **price rows** are `Needs Review`/`Discovery Only`. Three layers, three different states. `[PROJECT]`

This is not necessarily a defect — the discount rule's own `evidence_json` says it *"supplies the missing Manufacturer List → Internal Net Cost transformation only"*. But it does mean **"the source is governed" cannot be asserted** at the document layer.

### 5.3 Is source review independent from price-row review? — YES `[CODE]`

- Source review: `POST /api/price-sources/{id}/review` → sets source `review_status` + `downstream_use`, **and** bulk-writes price rows.
- Per-record review: `POST /api/price-records/{id}/review` → writes only `price_records`. **It never reads or requires `product_sources.review_status`.**

⇒ A price row can be promoted to Costing while its source document remains `Needs Review`. That is exactly why IFP-2100HV can be unblocked **today** without touching the 2023 catalogue review.

### 5.4 PRICE SOURCE TRUST vs INDIVIDUAL PRICE RECORD APPROVAL — the distinction that matters

| Concept | Lives in | Current Farenhyt state |
|---|---|---|
| **Source trust** | `product_sources.review_status` / `.downstream_use` / `.valid_until` | `Needs Review` / `Discovery Only` / **NULL** |
| **Source version trust** | `price_source_versions.approval_state` / `.downstream_use` | `Approved` / `Costing` |
| **Individual price approval** | `price_records.approval_status` / `.downstream_use` / `.valid_until` | 1 of 504 rows `Approved`/`Costing`; **503 undated** |

**Does one source approval materially reduce the 58-row (in fact 71-row) queue?** — It *would* address R1 entirely, and R1+R2 together are the whole 73-product blocker. But R2 is gated on `valid_until`, and the source route currently 409s into Costing. So **a single source approval alone does not clear the queue today**; the missing piece is a *validity determination*, not a source approval.

### 5.5 FARENHYT_PRICE_LIST_SOURCE_GOVERNED = **NO**

---

## 6. DISCOUNT RULE REUSE

`discountrule_784cec95-37be-4b55-b736-94e6bd648283` `[PROJECT]` — the **only** row in `discount_rules`.

| Field | Value |
|---|---|
| brand_id | `brand_9c537844` = **Farenhyt** |
| manufacturer_id | `manufacturer_49c62f94` = Honeywell (in-house brand) |
| source_id | `productsource_0d87f6ca` (the 2023 Farenhyt list) |
| source_version_id | `pricesourceversion_b8367c21` |
| family_scope | `ALL_FARENHYT` |
| component_scope | **`Material Only`** |
| discount_basis_points | `6500` (65%) |
| calculation_method | `LIST_PRICE_MINUS_PERCENTAGE` |
| calculation_order | `10` |
| effective_from | `2026-10-01T13:56:48.998Z` |
| approval_state | **`Approved`**, `approved_by = omair-primary`, `version_number = 1`, `superseded_at = NULL` |

`explicitlyNotApplicableTo`: **`["NOTIFIER","GAMEWELL","GENT","generic HONEYWELL"]`** — machine-readable, not prose-only. `[PROJECT]`

> **Scope discipline confirmed.** The rule is bound by `brand_id` in the indexed column `discount_rules_brand_scope_idx(brand_id, approval_state, superseded_at)`. Matching is by **brand**, not by manufacturer — so "Honeywell" the manufacturer does **not** drag NOTIFIER / GAMEWELL / GENT in. `[CODE][PROJECT]`

### Eligibility across the 77 candidates

| | Count | Basis |
|---|--:|---|
| **`ELIGIBLE_PRODUCT_COUNT`** | **75** | brand = Farenhyt ⇒ matches `brand_id` `brand_9c537844` |
| **`INELIGIBLE_PRODUCT_COUNT`** | **1** | brand = **Notifier** ⇒ `explicitlyNotApplicableTo` |
| **`UNRESOLVED_SCOPE_COUNT`** | **1** | `brand_id IS NULL` ⇒ cannot be matched or excluded without a review decision |

**Condition**: "once their price record/source is governed". All 75 are blocked behind §2.2's `valid_until` gate, not behind the discount rule. The rule itself is ready and needs nothing.

⚠️ `component_scope = 'Material Only'` — the 65% applies to **material**, not labour, freight, installation or margin. Any priced line must respect that.

---

## 7. THE THREE NO-SOURCE PRODUCTS

All three have **zero** rows in `price_records` and therefore **no ungoverned or historical price evidence of any kind inside the system**. `[PROJECT]`

### 7.1 `product_5f027f0b-9690-4902-8b80-577014808665` — IFP-75B
| | |
|---|---|
| Identity | Farenhyt IFP-75B fire panel; `product_role='Primary Equipment'`, `identity_status='Active'` |
| Why it may be needed | Legacy/alternative Farenhyt control panel. Could surface if sizing later favours a smaller panel than IFP-2100HV's 2100-point capacity, or as an alternate bid option. |
| Technical status | `lifecycle_status='Unknown — Review Required'`, `review_status='Needs Review'` |
| Ungoverned/historical price evidence | **None.** 0 price records; not present in the 2023 Farenhyt price list ingest. |
| **Exact missing commercial evidence** | A Farenhyt-governed price row: net unit price, currency, unit, basis (list vs net), and **an explicit validity end date** |
| Research / supplier action | **Supplier quotation, or a supplier-confirmed internal net price + validity.** Web research is **not** applicable — this is in-house supplier pricing, not public list pricing. |

### 7.2 `product_d21d8928-74d4-4f40-8681-ab4e99c4c843` — IFP-75
| | |
|---|---|
| Identity | Farenhyt IFP-75 fire panel; `product_role='Primary Equipment'`, `identity_status='Active'` |
| Why it may be needed | As 7.1 — smaller-capacity legacy panel. |
| Technical status | `lifecycle_status='Unknown — Review Required'`, `review_status='Needs Review'` |
| Ungoverned/historical price evidence | **None.** 0 price records. |
| **Exact missing commercial evidence** | Same as 7.1 |
| Research / supplier action | Same as 7.1 — supplier-side, not web |

### 7.3 `product_31abda75-f33d-4eb3-a3d0-5eec89f51489` — IFP-2100
| | |
|---|---|
| Identity | Farenhyt IFP-2100; `product_role='Unclassified'`, `identity_status='Active'` |
| Why it may be needed | **Probably not.** IFP-2100 is the *base* model. The governing technical approval explicitly separated the orderable variants: *"datasheet 351602:C:04-22 p.1 names IFP-2100HV in the RED orderable group and IFP-2100HVB in the black group"*. Bare `IFP-2100` is a family root, **not** an orderable part — hence `product_role='Unclassified'`. |
| Technical status | `lifecycle_status='Unknown — Review Required'`, `review_status='Needs Review'` |
| Ungoverned/historical price evidence | **None.** 0 price records. |
| **Exact missing commercial evidence** | Probably **a decision not to price it** — identity/lifecycle resolution, then either a supersession-to-IFP-2100HV mapping or exclusion from the BOM |
| Research / supplier action | No price research. Needs **identity review first**, then commercial only if it survives as orderable. |

> **No price was invented for any of the three.** `[CODE]`

**Web research is irrelevant here.** All three are in-house supplier/internal commercial pricing. The missing evidence is a **supplier-issued commercial commitment**, not a public data point.

---

## 8. DO NOT REVIEW UNUSED PRODUCTS BLINDLY

- The likely/current technical candidate is **one product**: `product_ec9dcbb1` (IFP-2100HV), already at match rank 1 under a current Technical approval.
- The other 76 came from **80 `Discovery Only` + 10 `Needs Review` + 3 `No Match`** runs across 57 BOQ items — i.e. catalogue sweeps, not selections.
- Promoting all 73 Farenhyt rows would review **504 price rows of a 2023 catalogue** to serve at most a few BOM lines. That is exactly the "unnecessary human review work" §9 prohibits.
- **Therefore: prepare source governance; promote per-record at selection time.** The per-record route `/api/price-records/{id}/review` exists precisely for this and needs no source-level batch.

---

## 9. MINIMIZE HUMAN WORK

Project principle applied: *automate the normal, surface the exception.*

| Layer | Automated already? | Evidence |
|---|---|---|
| Exact product identity binding | ✅ deterministic | `library_products` normalized PN + `price_records.product_id` FK |
| Money-unit contract | ✅ deterministic | `amount_minor / 100`, `pricing-runtime.mjs:133` |
| Discount derivation | ✅ deterministic | `discount_rules` applied by brand/source, not re-asked |
| FX arithmetic | ✅ deterministic once a rate row exists | `pricing-runtime.mjs:86` |
| Costing eligibility predicate | ✅ deterministic, re-evaluated per row at pricing time | `pricing-runtime.mjs:117-124` |
| **Validity end date** | ❌ **requires human evidence** | `product-price-library-api.mjs:399-402` forbids defaulting |
| **Promotion authorisation** | ❌ **requires role + reason** | `canGovernGlobal`, `REVIEW_REASON_REQUIRED` |

**Governance is not bypassed.** The two human steps are the only two where authority genuinely lies with a person: (a) *is this 2023 price still usable, and until when?* (b) *who authorises promoting it to costing authority?* Everything else is already deterministic.

**Smallest legitimate human decision set = 2** (see §10).

---

## 10. COMMERCIAL REVIEW QUEUE

Prioritised by share of likely BOM unlocked. No technical ranking.

| Pri | DECISION | AFFECTED | SOURCE | WHY HUMAN ACTION IS REQUIRED | DOWNSTREAM IMPACT | BATCHABLE |
|:-:|---|---|---|---|---|:-:|
| **1** | **Set Al Musa FX rate** `USD→SAR = 3.75` for `project_ae501b85` | **Every priced line** | Company FX policy (SAMA peg; identical rate already Approved for `project_62553bdf`, valid to 2027-06-30) | FX is resolved **per project**: `WHERE project_id=? AND approval_status='Approved' AND superseded_at IS NULL` (`pricing-runtime.mjs:86`). Al Musa has **0** rate rows. Requires sourced, current, human-confirmed rate + validity. | **Blocks all SAR conversion.** No USD→SAR conversion is possible for Al Musa today. | **NO** — 1 row, one project. Not batchable. |
| **2** | **Promote `price_6980c523`** → `Approved` / `Costing`, supplying a real `valid_until` | **IFP-2100HV panel** | `productsource_0d87f6ca` (row 6, cell F6) | Two human-only gates: role authority (`Administrator`/`Library Manager`, record is Global) **and** a validity end date that must come from real evidence and may not be defaulted | Clears `CURRENT_PRICE_SOURCE_REQUIRED` → flips `price_eligibility` to `Eligible for Price Approval` for the panel, unlocking the governed pricing path | **NO** — deliberately per-record, per §8 |
| **3** | *(conditional)* Farenhyt **source-level** validity determination | up to 73 candidates / 504 rows | `productsource_0d87f6ca` | Same validity-evidence question, applied at catalogue level | Pre-stages the rest of the Farenhyt catalogue so selection-time promotion is one click | **YES** — but **blocked today**: source `valid_until` NULL ⇒ 409 `PRICE_VALIDITY_REQUIRED`; no route writes `product_sources.valid_until`. Only worth doing once the size of the real BOM justifies it. |
| **4** | Notifier / unbranded scope decision | 2 products | brand governance | `discountrule_784cec95` excludes them; needs a commercial determination | Correctness of discount application | **YES**, 1 decision |
| **5** | Supplier quotes for IFP-75B / IFP-75 | 2 products | *none exists* | No price evidence of any kind; only a supplier can supply it | Only if sizing later selects a smaller panel | **NO** |
| **6** | Identity/lifecycle resolution for IFP-2100 | 1 product | — | Base model, not orderable; likely a supersession target | Likely **exclusion** — avoids wasted commercial work | **NO**, but cheap and worth doing early |
| **—** | CCTV `productsource_0fb65297` | 1 product | CCTV material list | Wrong system domain for a Fire Alarm project | Should be **excluded**, not priced | n/a |

> **Note**: decision 1 is *new*. It was absent from every prior report and is currently an unlisted hard blocker on Al Musa costing.

---

## 11. READY-FOR-SIZED-BOM CONTRACT

Agent 5 may price a sized BOM line **only when all eight conditions hold simultaneously** for that line's selected product. Each is a machine check, not a judgement call.

| # | Condition | Predicate | Al Musa today |
|:-:|---|---|:-:|
| 1 | **Selected product identity current** | `library_products.identity_status='Active'`, no `superseded_by_product_id` | ✅ `product_ec9dcbb1` Active |
| 2 | **Technical approval current** | `safety_approval_requests.status='Approved'` ∧ `approval_type='Technical'` ∧ candidateId matches ∧ `safety_decisions.superseded_at IS NULL` | ✅ `approval_625e5fbe` |
| 3 | **Price record current** | `price_records.approval_status='Approved'` ∧ `valid_until >= today` | ❌ `Needs Review`, `valid_until` NULL |
| 4 | **Price source governed** | `product_sources.review_status='Reviewed'` (or per-record route used, which does not require it — §5.3) | ⚠️ `Needs Review` — **bypassable via per-record route** |
| 5 | **Discount / policy governed** | `discount_rules.approval_state='Approved'` ∧ `superseded_at IS NULL` ∧ brand matches | ✅ `discountrule_784cec95` |
| 6 | **Currency accepted** | price currency ∈ {SAR, USD}; FX row exists for this project | ❌ price ✅ USD · **FX row missing** |
| 7 | **Effective / supersession state valid** | `validity_state` current; no superseding record | ❌ `Historical — Validity End Missing` |
| 8 | **Costing downstreamUse allowed** | `downstream_use='Costing'` | ❌ `Discovery Only` |

**Contract**: *Conditions 1, 2, 5 hold today. Conditions 3, 6, 7, 8 do not.*
Conditions 3+7+8 are one decision (queue #2). Condition 6 is one decision (queue #1).

**Then, and only then:**
```
Technical Approval (current)
  → Costing source price_6980c523 (Approved / Costing / dated)
  → discount derivation discountrule_784cec95 (65% off list → ×0.35)  [Material Only]
  → USD 2,375.45
  → governed FX 3.75 (project rate) → SAR 8,907.94
  → money-minor 890794
  → persistRun → pricing line → approval_ready
  → Commercial Price approval packet
```

**No quotation is authorised.** No margin, selling price or commercial offer at this stage.

---

## FINAL FLAGS

| Flag | Value |
|---|---|
| `IFP2100HV_TECHNICAL_APPROVAL_CURRENT` | **YES** |
| `IFP2100HV_TECHNICAL_APPROVAL_IS_COMMERCIAL_BLOCKER` | **NO** |
| `IFP2100HV_LIST_PRICE_USD` | **6787.00** |
| `IFP2100HV_NET_COST_USD` | **2375.45** |
| `IFP2100HV_NET_COST_SAR` | **8907.94** |
| `IFP2100HV_COSTING_AUTHORITY_CURRENT` | **NO** |
| `COMMERCIAL_PRICE_READY_COUNT` | **1** |
| `COMMERCIAL_REVIEW_REQUIRED_COUNT` | **73** |
| `NO_GOVERNED_PRICE_SOURCE_COUNT` | **3** |
| `FARENHYT_PRICE_LIST_SOURCE_GOVERNED` | **NO** |
| `COMMERCIAL_REVIEW_CAN_BE_BATCHED` | **YES** |
| `MINIMUM_HUMAN_COMMERCIAL_DECISIONS` | **2** |
| `READY_TO_PRICE_SIZED_BOM_WHEN_AVAILABLE` | **NO** |

`CURRENTNESS_STATUS = PROVEN` — final canonical re-read at `2026-10-03T19:30:52Z`.

---

## EXACT REMAINING COMMERCIAL BLOCKERS

1. **`price_6980c523` is `Needs Review` / `Discovery Only`, and `valid_until` is NULL.** Needs an Administrator/Library Manager to supply a real validity date + promote to `Costing`. *(§2)*
2. **Al Musa has zero governed FX rate rows.** FX resolves per project, so USD→SAR is impossible for this project today. Needs `POST /api/pricing/projects/{projectId}/exchange-rates`. *(§10.1)*
3. **Panel `price_eligibility` is `Price Approval Disabled`** — solely because of #1. Flips automatically once #1 clears; nothing else is required. *(§1, §11)*
4. **Farenhyt source document is `Needs Review`** — does **not** block the panel (per-record route bypasses it) but leaves the wider catalogue unready. *(§5.3)*

---

## PROHIBITIONS OBSERVED

- ✅ No final pricing · no `pricing_lines` created · Al Musa still has **0 runs / 0 lines**
- ✅ No quotation, quotation revision, margin or selling price
- ✅ No technical selection change — read-only on `safety_approval_requests` / `safety_decisions`
- ✅ No schema change
- ✅ No direct SQL write — every read was `SELECT`; all state changes described are existing HTTP routes
- ✅ No commit / push / deploy
- ✅ No price invented; no approval fabricated; no validity date invented
- ✅ No polling loop, no web research

**STOP after this report.**