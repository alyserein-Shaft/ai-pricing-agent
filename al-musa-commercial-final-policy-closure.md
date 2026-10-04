# Al Musa — Commercial Authority Final Policy Closure

**Project**: `project_ae501b85-9c12-4332-bf8e-787c90f2d388` — *Al Mousa School — Clean Golden Run*
**Panel**: `product_ec9dcbb1-39fe-4d24-b369-8b3d271604a7` — IFP-2100HV RED
**Task scope**: closes only (1) project FX authority, (2) commercial price-validity policy.
**Final-state re-read**: `2026-10-03T19:42:10Z` → `CURRENTNESS_STATUS = PROVEN`

Evidence labels: `[PROJECT]` canonical D1 · `[CODE]` runtime source · `[TEST]` repo test, executed · `[INFERENCE]`

---

## HEADLINE

The FX defect is a **persistence** defect, not an arithmetic or authority defect — but it still cannot be closed by me, because the governed route requires a field nobody has supplied.

The validity question produced a genuinely new finding: **this repository contains three mutually contradictory committed answers to the same commercial policy question**, and the contradiction is provable by running a test that ships in the repo.

**Neither item was persisted. Nothing was promoted. No date was invented.**

---

## A. AL MUSA FX AUTHORITY

### A1. The rate is established and non-engineering ✅

`USD 1 = SAR 3.75` is stated project/company policy. It is a **commercial/finance** fact, correctly outside the engineer's remit. Corroborating governed precedent `[PROJECT]`:

| Field | Value |
|---|---|
| id | `fxrate_8b8e52b5-f062-4f08-94ba-9bf1e97e9425` |
| project_id | `project_62553bdf-a06f-4951-8503-d058ac2d1a94` (**a different project**) |
| from → to | `USD` → `SAR` |
| rate | `3.75` |
| rate_type | `Engineer Confirmed` |
| source | *"SAMA pegged USD/SAR rate, company-standard costing rate per finance department memo dated 2026-01-01."* |
| effective_from / valid_until | `2026-08-29T16:33:13.654Z` / **`2027-06-30`** |
| approval_status / approved_by | `Approved` / `local-development-user` |
| superseded_at | `NULL` |

Also hard-coded as the company standard for presentation: `app/domain/commercial-line-presentation.mjs:107` → `export const USD_TO_SAR = 3.75;`

### A2. The defect is per-project scoping ✅

`worker/pricing-runtime.mjs:86`, `worker/boq-line-cost-api.mjs:126`, `worker/pricing-api.mjs:398` — all resolve FX identically:

```sql
SELECT * FROM pricing_exchange_rates
WHERE project_id=? AND approval_status='Approved' AND superseded_at IS NULL
ORDER BY version_number DESC LIMIT 1
```

| Project | FX rows |
|---|--:|
| `project_62553bdf` | **1** |
| **`project_ae501b85` (Al Musa)** | **0** |

There is **no global/organization-level fallback**. Al Musa's USD→SAR conversion is therefore impossible today. The arithmetic was never the problem — you were right.

> **`AL_MUSA_FX_3_75_AUTHORITY_CURRENT = YES`** — the policy is established, human-owned, commercially correct, and already has a governed sibling implementation.

---

## B. FX PERSISTENCE RESULT

### B1. Traced route and full governance lifecycle `[CODE]`

`worker/pricing-api.mjs:353` · `worker/pricing-api.mjs:371-460`

```
POST /api/pricing/projects/{projectId}/exchange-rates
```

| Step | Code | Behaviour |
|---|---|---|
| Project ownership | `:357` | `ownedProject(env.DB, projectId, userId)` → 404 `PROJECT_NOT_FOUND` if not owner |
| Required fields | `:372-380` | `fromCurrency`, `toCurrency`, `rate`, `source`, `effectiveFrom`, **`validUntil`** — all six, else 422 `INVALID_EXCHANGE_RATE` with `missing[]` |
| Rate sanity | `:383` | `Number(body.rate) <= 0` → 422 |
| **Future-dated guard** | `:384` | `new Date(body.validUntil) < new Date()` → 422 |
| Supersede prior | `:397-399`, `:424` | finds current `(project, from, to)`; on re-post, **supersedes** it — versioned, never overwritten |
| Insert | `:406-417` | `approval_status='Approved'`, `approved_by=userId`, `created_by=userId`, `version_number = prior+1`, `rate_type` default `Project Fixed Rate` |
| Audit | `:429-441` | `pricing_audit_events` action `'Exchange Rate Approved'`, with `previous_value` / `new_value` / `reason` / `request_id` |

**Lifecycle**: create → (supersede+recreate on change) → never mutated in place. Append-only by `superseded_at`. Fully versioned. Good design — no change requested.

### B2. Result: **NOT PERSISTED.** Three independent reasons.

| # | Blocker | Detail |
|---|---|---|
| **B2-a** | **Missing field I will not invent** | The route hard-requires `validUntil` and rejects a past date (`:379`, `:384`). Al Musa has **no FX validity period**. The sibling row's `2027-06-30` was approved for **`project_62553bdf` by `local-development-user`** — it is *that project's* commercial evidence. Copying it to Al Musa would transfer a validity determination across projects without authority, i.e. invent a date. **Declined.** |
| **B2-b** | **No authenticated actor** | The route stamps `approved_by = userId` and `created_by = userId`. It **self-approves** — there is no separate approver. Only Al Musa's owner `local-development-user` (or a delegate) may call it. I hold no such session, and the identity used would be **mine, not a human's**. That would manufacture commercial approval. **Declined.** |
| **B2-c** | **Runtime not available** | `GET http://localhost:4183/` → **HTTP 500**. Per skill §11 I must not start or restart services during a READ-ONLY task. Even with authority I could not execute. |

### B3. Exact missing field / decision

> **One field, one owner.**
>
> - **Field**: `validUntil` (ISO date) — *the FX validity period applicable to Al Musa*.
> - **Also needed**: a `source` string for this project (the sibling cites finance memo 2026-01-01; re-citing it for Al Musa is a reasonable default but is the owner's to make).
> - **Owner**: **Project Owner / Commercial–Procurement** (Al Musa's `owner_user_id` = `local-development-user`). Not an engineer.
> - **Once supplied**, one `POST` closes it. No code change, no schema, no SQL.

### B4. Recommended exact call (for the owner, not executed)

```http
POST /api/pricing/projects/project_ae501b85-9c12-4332-bf8e-787c90f2d388/exchange-rates
Content-Type: application/json

{
  "fromCurrency": "USD",
  "toCurrency":  "SAR",
  "rate":        3.75,
  "rateType":    "Project Fixed Rate",
  "source":      "SAMA pegged USD/SAR rate, company-standard costing rate per finance department memo dated 2026-01-01.",
  "effectiveFrom": "<owner-supplied>",
  "validUntil":  "<OWNER-SUPPLIED — the one missing field>",
  "reason":      "Al Musa commercial closure: company USD→SAR costing policy 3.75."
}
```

> **`AL_MUSA_FX_ROW_PERSISTED = NO`**

---

## C. CURRENT PRICE-VALIDITY MODEL

### C1. The domain vocabulary `[CODE]` — `app/domain/pricing-engine.mjs:9-16`

```js
export const priceValidity = (source, at = new Date().toISOString()) => {
  if (source.status === "Rejected" || source.supersededAt) return "Rejected";
  if (!source.validUntil) return "No Validity Provided";
  if (source.effectiveFrom && new Date(source.effectiveFrom) > new Date(at)) return "Future";
  if (new Date(source.validUntil) < new Date(at)) return "Expired";
  const days = (new Date(source.validUntil) - new Date(at)) / 86400000;
  return days <= 14 ? "Expiring Soon" : "Valid";
};
```

Six states: `Rejected` · `No Validity Provided` · `Future` · `Expired` · `Expiring Soon` · `Valid`.

**Two things are already true and under-used:**
1. `supersededAt` **is already a first-class input** — the model already understands "until replaced".
2. `"No Validity Provided"` is a **named, non-error state** — the domain already anticipates undated prices as legitimate-but-distinct.

### C2. The eligibility gate `[CODE]` — `pricing-engine.mjs:21`

```js
const eligible = projectMatch && quantityMatch && regionMatch && approved
  && ["Valid", "Expiring Soon"].includes(validity)
  && source.downstreamUse !== "Discovery Only";
```

`"No Validity Provided"` is **not** in the eligible set ⇒ undated ⇒ ineligible. **This is the single line that blocks all 503 undated rows.**

### C3. Layered persistence `[PROJECT]` — and the asymmetry that matters

| Layer | Table | Validity columns | Open-ended? | Governed state |
|---|---|---|---|---|
| **L1** | `price_records` | `effective_from`, `valid_until`, `validity_state` | ❌ requires `valid_until` | 503/504 `valid_until` NULL |
| **L2** | `product_sources` | `effective_from`, `valid_until`, `validity_state` | ❌ requires `valid_until` | Farenhyt source `valid_until` NULL |
| **L3** | `price_source_versions` | `effective_from`, **`effective_to`** | ✅ **`effective_to` NULL** | **`Approved` / `Costing` / `Current Internal Reference`** |
| **L4** | `discount_rules` | `effective_from`, **`effective_to`** | ✅ **`effective_to` NULL** | **`Approved` by omair-primary** |

`price_records` has **no `superseded_at` column at all** — `worker/scope-pricing-input.mjs` hard-codes `supersededAt: null` when mapping a row. Supersession is instead expressed as `approval_status='Superseded'` + `validity_state='Superseded'` via the per-record route (`product-price-library-api.mjs:389`). Note `Superseded` is in `PRICE_STATES` (`app/domain/product-price-library.mjs:11`) but `priceValidity` never returns it — minor vocabulary drift.

---

## D. SOURCE-VERSION vs PRICE-ROW GOVERNANCE RECONCILIATION

### D1. The three layers of the *same* source `[PROJECT]`

| Layer | Row | Review/Approval | Downstream use | Validity |
|---|---|---|---|---|
| L2 source document | `productsource_0d87f6ca` | `review_status = 'Needs Review'` | `Discovery Only` | `valid_until` **NULL** → `Historical — Validity End Missing` |
| L3 source version | `pricesourceversion_b8367c21` | **`approval_state = 'Approved'`** | **`Costing`** | `effective_to` **NULL** · `reliability = 'Current Internal Reference'` · `approved_by = omair-primary` |
| L1 price rows | 504 rows | 503 `Needs Review` | `Discovery Only` | `valid_until` **NULL** |

### D2. Your question, answered directly

> *How can something be "Current Internal Reference / Approved for Costing" while every undated price derived from it is structurally unable to become current costing authority?*

**Because L3 asserts a fact about the *catalogue* ("this 2023 list is the current internal reference for Farenhyt pricing"), while L1 requires a fact about *each individual price's temporal validity* ("this specific line was good until date X"). Omair approved the first. Nobody ever supplied the second — because the 2023 XLSX contains no expiry column.**

That is not a contradiction *in the data*. It is a contradiction *in the model*: **L3 and L4 are open-ended; L1 and L2 demand fixed expiry.** The layers that carry commercial authority permit "until superseded"; the layers that enforce it forbid it.

### D3. Verdict: **COMMERCIAL VALIDITY MODEL GAP** — not intentional layer separation

Evidence that it is a **gap**, not deliberate separation:

1. **L3 says `reliability = 'Current Internal Reference'`** — that is an explicit assertion of currentness. If undated prices were *meant* to be permanently ineligible, the source version would not be stamped "Current Internal Reference" nor promoted to `Costing`. `[PROJECT]`
2. **L4 `effective_to` is NULL** — omair-primary approved a 65% discount rule with **no end date**. Company commercial policy is already modelled open-ended. `[PROJECT]`
3. **The domain already models the alternative** — `priceValidity` returns `"No Validity Provided"` as a distinct state, and accepts `supersededAt`. `[CODE]`
4. **A repo test asserts the fixed-expiry requirement must not exist** — and fails today (see §E).

Intentional separation would show consistent, documented policy across layers. It does not.

---

## E. VALID-UNTIL-SUPERSEDED SUPPORT

### E1. ⚠️ A shipped repo test already declares the intended policy — and it FAILS `[TEST]`

`tests/knowledge-banner-copy-truth.test.mjs:7-13`, verbatim header comment:

> *"R5 — BANNER COPY TRUTH. Two safety banners made claims that no longer match backend truth: 1. Product Library 'Costing safety is enforced': asserted historical and Discovery Only prices stay blocked 'unless separately approved with a current validity end date' — **but PRICE_VALIDITY_REQUIRED was removed; missing/expired valid_until must NOT by itself block an otherwise-authorized Costing approval, and validity is never inferred.**"*

Its first assertion (`:34-41`):

```js
assert.doesNotMatch(worker, /PRICE_VALIDITY_REQUIRED/);
assert.match(worker, /missing or expired valid_until must/);
assert.match(worker, /not, by itself, block this otherwise-authorized governed Costing/);
```

**Executed result: 4 tests, 0 pass, 4 fail.**

```
✖ R5 the backend no longer requires a validity date for costing approval (truth the banners must match)
✖ R5 the Product Library banner no longer claims a validity-date prerequisite
✖ R5 the Knowledge banner states the learning/promotion boundary truthfully
✖ R5 product approval, price approval and reusable knowledge are described as separate governed surfaces
```

The test asserts the removal of a rule that **is still present, twice**, at `product-price-library-api.mjs:364` (source route) and `:398` (per-record route). **The intended R5 change was specified and never implemented.**

### E2. A governed "relaxed validity" mechanism exists and is proven green `[TEST]`

`tests/pricing-costing-expiry-policy.test.mjs` — parameter **`allowExpiredOrMissingValidity`**, default `false` (strict), `true` (relaxed):

| Test | Expectation |
|---|---|
| `Gate 1 default` (missing `valid_until`) | `Price Approval Disabled` — strict default preserved |
| `Gate 1 relaxed` (missing) | **`Eligible for Price Approval`** |
| `Gate 1 relaxed` (expired `2020-01-01`) | **`Eligible for Price Approval`**, evidence still truthfully `Expired` |
| relaxed + `approvalStatus='Pending'` | still `Price Approval Disabled` — **approval governance untouched** |
| relaxed + `downstreamUse='Discovery Only'` | still `Price Approval Disabled` — **scope governance untouched** |
| `D.` future-dated | still blocked **even when relaxed** |
| `E.` rejected | still blocked **even when relaxed** |

This is precisely "**valid until superseded**" semantics, correctly built: it relaxes *only* the temporal gate and provably leaves approval, downstream scope, rejection and future-dating gates intact.

### E3. ⚠️ But it is unreachable in production

```
$ grep -rn "allowExpiredOrMissingValidity" app worker scripts
worker/scope-pricing-input.mjs:139:    allowExpiredOrMissingValidity = false,   ← parameter default
worker/scope-pricing-input.mjs:219:    allowExpiredOrMissingValidity,          ← forwarded to domain
```

**No production caller ever passes `true`.** `worker/pricing-runtime.mjs`, `worker/pricing-api.mjs`, `worker/boq-line-cost-api.mjs` never set it. The capability exists in the domain, is fully tested, and is **dead code from the application's point of view**.

### E4. The until-superseded pattern *does* exist elsewhere — for documents

| Mechanism | Location | Status |
|---|---|---|
| `documentVersionGoverningPredicate` — `d.current_version_id = v.id`, a pointer, not a date | `worker/current-evidence-scope.mjs:139-140` | in production |
| `document_supersessions` — append-only, trigger-guarded, `scope_type` × `supersession_type`, optional `effective_to` | schema | 0 rows, mechanism present |

`document_supersessions.effective_to` is **nullable** and `documents.current_version_id` is a **pointer** — the codebase's mature answer to "which version is current" is **supersession-based, not date-based**. The price model is the outlier.

> **`VALID_UNTIL_SUPERSEDED_SUPPORTED = YES`**
> The mechanism exists three times over: `priceValidity`'s `supersededAt` input, the tested-and-green `allowExpiredOrMissingValidity` flag, and the document supersession pattern.
>
> **But it is unreachable for prices.** No governed surface sets it. Turning it on is a code change, not a data change.

### E5. `commercial_conditions` — an unused hook `[PROJECT]`

`commercial_conditions(source_version_id, condition_type, value_json, scope_json, review_status, created_by)` — **0 rows**. Its schema is *exactly* the right shape to carry a per-source-version commercial condition such as `{"validityPolicy":"VALID_UNTIL_SUPERSEDED"}`. It is unused. `[INFERENCE]` It may have been the intended home; nothing proves it.

---

## F. CORRECT COMMERCIAL VALIDITY POLICY

### F1. The four candidates

| Option | Verdict |
|---|---|
| `FIXED_EXPIRY_REQUIRED` | **Rejected as a *business* rule** — the 2023 Farenhyt XLSX has no expiry column, and the company discount rule (L4) and source version (L3) are both open-ended. Fixed expiry on L1 alone is indefensible. |
| `VALID_UNTIL_SUPERSEDED_SUPPORTED` | **True as a capability** (§E) — but it is not *reachable*, so it is not the current *policy*. |
| `VALID_UNTIL_SUPERSEDED_MISSING_FROM_MODEL` | **Not quite.** It is not missing from the **model** (`priceValidity`, `allowExpiredOrMissingValidity`, `document_supersessions`, `commercial_conditions` all exist). It is missing from the **governed surface** — nothing exposes or sets it. |
| **`UNRESOLVED_REQUIRES_COMMERCIAL_DECISION`** | ✅ **This one.** |

### F2. Why I am not deciding this myself

Three committed intents conflict inside the repository:

| # | Source | Intent | Status |
|---|---|---|---|
| 1 | `product-price-library-api.mjs:364,398` | Costing **requires** a fixed `validUntil` → 409 | **live code** |
| 2 | `tests/knowledge-banner-copy-truth.test.mjs` (R5) | That requirement **must be removed**; missing/expired must not block | **failing test — specified, not implemented** |
| 3 | `tests/pricing-costing-expiry-policy.test.mjs` + `pricing-engine.mjs` | Both modes supported; strict is default | **green, but opt-in unreachable** |

Choosing between them means choosing **company pricing policy**: whether a price without an expiry date may become Costing authority. That is a commercial risk decision — it determines whether a 2023 catalogue can price a 2026 project. It is **not mine, and not an engineer's**, to make. Declaring it unilaterally would be exactly the "invented policy" this task forbids.

### F3. The decision, precisely stated for the owner

> **Commercial question**: May a price whose source document states **no validity end date** become Costing authority for a current project, provided that (a) its source version is `Approved` + `Current Internal Reference`, and (b) the governing commercial discount rule for that brand is `Approved` and open-ended?
>
> - **YES** → IFP-2100HV promotes with `valid_until = NULL` and a truthful `validity_state` that is not "expired". The runtime gate needs one change: honour `allowExpiredOrMissingValidity` from a governed decision surface (e.g. `commercial_conditions` per source version, or a source-level flag). **No invented date. No schema change strictly required** — `commercial_conditions` already exists.
> - **NO** → someone must obtain a real validity date per price or per source (supplier confirmation, manufacturer confirmation, or a written internal pricing policy with a review-by date). The 2023 XLSX cannot supply it.

**Either answer is defensible. The evidence in §D3 (L3/L4 open-ended, L1/L2 fixed) leans YES. I am flagging the lean, not asserting the decision.**

---

## G. IFP-2100HV PROMOTION READINESS

`price_6980c523-856a-4621-ac51-404de322c96e` · final re-read `2026-10-03T19:42:10Z`

| Gate | Value | Verdict |
|---|---|:-:|
| `IDENTITY_CURRENT` | `product_ec9dcbb1`, `identity_status='Active'`, no `superseded_by_product_id` | ✅ **YES** |
| `SOURCE_CURRENT` | `productsource_0d87f6ca` — `review_status='Needs Review'`, `valid_until` NULL | ❌ **NO** |
| `SOURCE_VERSION_CURRENT` | `pricesourceversion_b8367c21` — `Approved`/`Costing`/`Current Internal Reference`, `effective_to` NULL, `superseded_at` NULL | ✅ **YES** |
| `TECHNICAL_APPROVAL_CURRENT` | `approval_625e5fbe` `Approved`, safety decision not superseded, rank-1 candidate | ✅ **YES** |
| `DISCOUNT_RULE_CURRENT` | `discountrule_784cec95` `Approved`, `superseded_at` NULL, brand-matched, `Material Only` | ✅ **YES** |
| `FX_AUTHORITY_CURRENT` | rate `3.75` established; **Al Musa row absent** (0 rows) | ❌ **NO** |
| `VALIDITY_POLICY_RESOLVED` | §F — two committed intents in conflict | ❌ **NO** |
| `PRICE_RECORD_READY_FOR_HUMAN_PROMOTION` | `Needs Review`/`Discovery Only`/`valid_until` NULL/0 review history | ❌ **NO** |

**6 of 8 gates pass. The two that fail are both commercial and both resolve from §H decisions 1 and 2 — not from any engineering work.**

### G1. Not promoted — and precisely why

Promotion requires `POST /api/price-records/{id}/review` with `decision:'Approve'`, `downstreamUse:'Costing'` and a real `validUntil`. Three independent reasons I did not:

1. **No commercial validity authority exists** (§F). Supplying `validUntil` now would *manufacture* the policy that §F is asking a human to decide — choosing fixed expiry by the back door.
2. **Role gate** — `canGovernGlobal` requires `Administrator` / `Library Manager` (`product-price-library-api.mjs:9,380`); the record is Global (`project_id` NULL). I hold no such session.
3. **Attribution** — the route stamps `reviewed_by = user.id`. Calling it would record **my** identity as the commercial approver.

---

## H. MINIMUM REMAINING HUMAN COMMERCIAL DECISION

### H1. Role separation — no engineer is asked anything `[CODE]`

| Decision type | Correct role | This task's items |
|---|---|---|
| **ENGINEERING DECISION** | Engineer / Senior Technical Reviewer | — **none.** Technical approval is already current and closed. |
| **COMMERCIAL DECISION** | Commercial / Procurement (policy & supplier terms) | ① price-validity policy · ② FX validity period |
| **LIBRARY / ADMIN DECISION** | Library Manager / Administrator | ③ execution of the two promotions (role-gated, mechanical once ①② answered) |
| **ROUTINE SYSTEM PERSISTENCE** | **Automated — no human** | FX application, discount derivation, money-minor conversion, eligibility re-evaluation, supersession bookkeeping |

**FX, price validity, discount and supplier pricing are all commercial. No engineer is required for any part of this closure.**

### H2. The decision set

| # | Decision | Owner | Blocks | Reuse? |
|:-:|---|---|---|---|
| **1** | **Price-validity policy** — may an undated price become Costing authority? (§F3) | **Commercial / Procurement** | IFP-2100HV + all 73 Farenhyt candidates | **One policy ⇒ reusable across every future project and brand.** Highest leverage decision in the entire commercial lane. |
| **2** | **Al Musa FX validity period** — the `validUntil` value for §B3 | **Project Owner / Commercial** | All Al Musa USD→SAR conversion | One date per project |
| 3 | *Execution only:* run the two governed POSTs | Library Manager / Administrator | — | Mechanical once ①② land |

> **`MINIMUM_REMAINING_COMMERCIAL_HUMAN_DECISIONS = 2`** (down from 2 in the prior audit, but now **one of them is a reusable policy rather than a per-product chore**).
>
> **`ENGINEER_INPUT_REQUIRED_FOR_COMMERCIAL_CLOSURE = NO`** ✅

---

## I. SIZED-BOM FAST PATH

### I1. Exact workflow when the sized BOM arrives

```
[1] SIZED BOM SELECTION arrives (technical lane, owned elsewhere)
      ↓
[2] For each SELECTED product ONLY — never the catalogue:
      SELECT p.*, pr.*, s.*, psv.*
      FROM library_products p
      LEFT JOIN price_records pr        ON pr.product_id = p.id
      LEFT JOIN product_sources s       ON s.id = pr.source_id
      LEFT JOIN price_source_versions psv ON psv.source_id = s.id
      WHERE p.id = :selectedProductId
      ↓
[3] CURRENTNESS CHECK — all automated, no human:
      • p.identity_status = 'Active' AND superseded_by_product_id IS NULL
      • safety_approval_requests.status='Approved' (Technical) AND not superseded
      • pr.approval_status='Approved' AND pr.downstream_use='Costing'
      • pr.valid_until >= today          ← relaxed only if §H decision 1 says so
      • pr.currency IN ('SAR','USD')
      ↓
[4] SURFACE ONLY genuine exceptions:
      • no price row            → commercial queue (supplier evidence needed)
      • not Costing             → queue: [Library Mgr] per-record approval
      • no project FX row       → queue: [Project Owner] one POST
      • brand outside rule scope→ queue: [Commercial] discount determination
      Everything else proceeds with ZERO human input
      ↓
[5] DISCOUNT — automatic, deterministic:
      discount_rules WHERE brand_id = p.brand_id
                        AND approval_state='Approved'
                        AND superseded_at IS NULL
      → 65% off list, netMultiplier 0.35, component_scope='Material Only'
        NEVER NOTIFIER / GAMEWELL / GENT / generic HONEYWELL
      ↓
[6] FX — automatic once a row exists:
      pricing_exchange_rates WHERE project_id=:projectId AND Approved AND not superseded
      → USD 2,375.45 × 3.75 = SAR 8,907.9375
      ↓
[7] MONEY-MINOR — automatic:
      Math.round(8907.9375 × 100) = 890794   [pricing-runtime.mjs:133]
      ↓
[8] persistRun → pricing_line → approval_ready
      ↓
[9] Commercial Price approval packet  ← the ONLY human gate at this point
```

### I2. The design property that makes this work

Every step in `[3]`–`[7]` is **deterministic and re-evaluated per line at pricing time** (`pricing-runtime.mjs:117-124`, `confidence-safety-engine.mjs:71`, `scope-pricing-input.mjs:308`). No step trusts a cached batch decision. Therefore:

> **A catalogue-wide review is not merely wasteful — it is structurally unnecessary.** The gate re-runs per selected line regardless of how much was pre-approved. Promoting 504 unused rows would create 504 governance events and **zero** pricing benefit.

This is §6 satisfied structurally, not just by restraint.

---

## FINAL FLAGS

| Flag | Value |
|---|---|
| `AL_MUSA_FX_3_75_AUTHORITY_CURRENT` | **YES** |
| `AL_MUSA_FX_ROW_PERSISTED` | **NO** |
| `FIXED_PRICE_EXPIRY_REQUIRED` | **UNRESOLVED** |
| `VALID_UNTIL_SUPERSEDED_SUPPORTED` | **YES** |
| `COMMERCIAL_VALIDITY_MODEL_GAP` | **YES** |
| `IFP2100HV_PRICE_RECORD_READY_FOR_PROMOTION` | **NO** |
| `IFP2100HV_COSTING_AUTHORITY_CURRENT` | **NO** |
| `CATALOGUE_WIDE_REVIEW_REQUIRED` | **NO** |
| `ENGINEER_INPUT_REQUIRED_FOR_COMMERCIAL_CLOSURE` | **NO** |
| `MINIMUM_REMAINING_COMMERCIAL_HUMAN_DECISIONS` | **2** |
| `READY_TO_PRICE_SIZED_BOM_WHEN_AVAILABLE` | **NO** |

`CURRENTNESS_STATUS = PROVEN` — canonical re-read at `2026-10-03T19:42:10Z`.

---

## SEPARATE HANDOFF RECOMMENDED (not performed)

A **proven validity-model gap** exists, so per your instruction I raise it rather than fix it — schema/code change is out of scope here.

**Smallest sufficient slice** (offered for authorisation, not executed):

1. Expose the already-tested, already-green `allowExpiredOrMissingValidity` through **one governed surface** — most naturally `commercial_conditions` (already exists, currently 0 rows) keyed by `source_version_id`, e.g. `condition_type='PRICE_VALIDITY_POLICY'`, `value_json={"policy":"VALID_UNTIL_SUPERSEDED"}`, with its existing `review_status` acting as the approval.
2. Read it in `pricing-runtime.mjs:117-124` / `confidence-safety-engine.mjs:71` / `scope-pricing-input.mjs:308` and pass the flag through — **the domain already does the rest**.
3. Bring `product-price-library-api.mjs:364,398` into line with the R5 intent asserted by `tests/knowledge-banner-copy-truth.test.mjs` (remove `PRICE_VALIDITY_REQUIRED`, or replace it with a policy-aware equivalent).
4. Keep `validity_state` **truthful**: undated ⇒ `No Validity Provided`, never silently `Valid`.

**No schema migration is strictly required** — `commercial_conditions` already has the shape. Estimated blast radius: 3 runtime predicate sites + 2 API gates + the 4 currently-failing R5 assertions.

---

## PROHIBITIONS OBSERVED

- ✅ No catalogue-wide approval — 503 unused candidate prices left unreviewed
- ✅ **No invented validity date** — for the price, for the source, or for FX
- ✅ No final pricing · Al Musa still **0 runs / 0 lines**
- ✅ No `pricing_lines` created
- ✅ No quotation, no margin, no selling price
- ✅ No technical selection change (read-only on `safety_approval_requests` / `safety_decisions`)
- ✅ **No schema change** — gap raised as a separate handoff
- ✅ **No direct SQL writes** — every read was `SELECT`; all state changes described are existing HTTP routes
- ✅ No approval fabricated — declined to persist FX or promote the price precisely because doing so would have manufactured human authority
- ✅ No commit / push / deploy
- ✅ No polling; no web research (correctly irrelevant — this is supplier/internal pricing)

**STOP after this report.**