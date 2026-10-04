# Al Mousa — Commercial Supersession Fail-Open Repair

**Scope**: domain-safety repair only. Code + isolated tests. **No live project writes.**
**Final verification**: `2026-10-04 00:44` → `CURRENTNESS_STATUS = PROVEN`

---

## A. EXECUTIVE VERDICT

```
COMMERCIAL_SUPERSESSION_MODEL = PROVEN
VALIDITY_STATE_SUPERSEDED_IS_AUTHORITY = YES
SUPERSEDED_PRICE_CAN_REACH_COSTING = NO
SUPERSEDED_SOURCE_CAN_REACH_COSTING = NO
CONFLICTING_SUPERSESSION_SIGNALS_FAIL_CLOSED = YES
VALID_UNTIL_SUPERSEDED_CAN_REVIVE_SUPERSEDED = NO
POLICY_SEMANTICS_CHANGED = NO
LIVE_PROJECT_WRITES = 0
FX_CHANGED = NO
```

The previously reported `validity_state='Superseded'` case was **not** decorative and **not** derived. It was a **reachable fail-open through an existing governed route**. It is now closed, together with a second gap found during the trace: a price record could outlive a **superseded governed price-source version**, because no pricing read joined `price_source_versions` at all.

---

## B. CANONICAL FIELD SEMANTICS

Evidence classes: **[PROJECT]** project schema/code/data · **[EXT]** external Honeywell terms · **[INF]** inference.

### `approval_status` — **AUTHORITATIVE**

| | |
|---|---|
| **Writers** | per-record review route `product-price-library-api.mjs:457` (`Rejected`/`Superseded`), `:481` (`Approved`); source-level bulk review sets it for every row under a source; supplier intake insert `:139` writes `'Approved'` |
| **Readers** | `selectPriceSources` requires `approvalStatus === 'Approved'`; `pricing-runtime` priceEligibility; `scope-pricing-input` re-validation |
| **Role** | independent governed approval gate |
| **Meaning** | the record's governed approval state |

### `validity_state` — **AUTHORITATIVE** (the key finding)

| | |
|---|---|
| **Writers** | (a) per-record route `:457` — sets it **equal to** `approvalStatus`, so there it is *redundant*; (b) **`worker/supplier-price-intake-api.mjs:134`** — `UPDATE price_records SET validity_state='Superseded', downstream_use='Discovery Only' …` and **deliberately does NOT touch `approval_status`**; (c) ingest writes descriptive labels (`'Historical — Validity End Missing'`, `'Current'`) |
| **Readers** | `pricing-runtime:134` `status: entry.status \|\| entry.validity_state`; `scope-pricing-input` two sites |
| **Role** | **carries supersession authority on its own** in path (b) |
| **Meaning** | temporal/commercial state of the record |

**Why this is not "derived":** in the supplier-intake supersession path it is the **only** supersession signal written. A row there reads `approval_status='Approved'`, `validity_state='Superseded'`.

### `superseded_at` — **NOT AVAILABLE for price records**

`PRAGMA table_info(price_records)` returns **no `superseded_at` and no `superseded_by`** column. Verified columns: `id product_id source_id supplier_id project_id amount_minor currency price_type unit minimum_quantity discount_basis_points effective_from valid_until validity_state approval_status downstream_use terms source_location reviewed_by reviewed_at created_at source_intake_row_id`.

So the `source.supersededAt` branch inside `priceValidity` is **dead for price records in production**. It is meaningful for tables that do carry one (`safety_decisions`, `pricing_exchange_rates`, `pricing_scenarios`, `document_versions`). The resolver still honours it, so a mapped source carrying one stays safe.

### Source-version supersession — **AUTHORITATIVE, previously unenforced**

`price_source_versions.superseded_at` exists. **`price_records` has no `source_version_id`**, so a price's governed lineage is its `source_id`. Before this slice, `grep price_source_versions` across `pricing-runtime.mjs`, `scope-pricing-input.mjs` and `pricing-api.mjs` returned **nothing** — no eligibility read ever consulted it.

### External evidence, kept separate

**[EXT]** Current first-party Honeywell sales terms state that current price books govern pricing at the relevant order stage, that prices/terms can change, and that newer terms supersede prior versions. This **supports the general principle** "superseded commercial evidence must not remain current".

**[PROJECT]** It does **not** define the internal meaning of `approval_status`, `validity_state` or `superseded_at`. Those were determined solely from schema, writers, readers and measured data above. No external term was used to justify any code behaviour.

---

## C. REAL-DATA MATRIX (read-only, unmutated)

`price_records` — `approval_status × validity_state`, all 518 rows:

| approval_status | validity_state | n |
|---|---|--:|
| Needs Review | Historical — Validity End Missing | 496 |
| Needs Review | Historical | 14 |
| Approved | Historical — Validity End Missing | 7 |
| Approved | Current Approved | 1 |

| Combination | Count |
|---|--:|
| `approval_status='Superseded'` | **0** |
| `validity_state='Superseded'` | **0** |
| current approval + `validity_state='Superseded'` (contradictory) | **0** |
| any contradictory combination | **0** |

`price_source_versions`: 1 row — `Approved` / `Costing` / `Current Internal Reference` / `superseded_at = NULL`.

Source-version coverage (this shaped the design):

| | |
|---|--:|
| `product_sources` | 27 |
| sources **having** `price_source_versions` | **1** |
| `price_records` | 518 |
| price rows whose source **has** version rows | **504** |

**Interpretation:** there are **no contradictory or drifted rows today**. The fail-open was **latent in code and reachable through a route**, not currently materialised in data. Hence: **no data remediation is required**, and none was performed.

---

## D. ROOT CAUSE

`validity_state='Superseded'` was **unsafe — a genuine fail-open**.

The pre-repair chain for the exact row shape written by `supplier-price-intake-api.mjs:134`:

```
approval_status = 'Approved'          → selectPriceSources approval gate PASSES
validity_state  = 'Superseded'       → priceValidity checked only 'Rejected'  → PASSES
valid_until     = NULL               → "No Validity Provided"
governed VALID_UNTIL_SUPERSEDED      → relaxation applies
                                       → row becomes Costing-eligible  ← FAIL-OPEN
```

Superseded commercial evidence was revivable by the very policy meant to handle *undated* evidence. Reachable by an existing governed route, in a live codebase.

A secondary gap: because no pricing read consulted `price_source_versions`, a price under a **superseded** source version could also reach Costing — including on the strict path with a future `valid_until`.

---

## E. REPAIR — smallest code/domain change

### 1. Canonical resolver in the domain — `app/domain/pricing-engine.mjs`

```js
export const isCommercialRecordSuperseded = (source) =>
  Boolean(source?.supersededAt)
  || source?.status === "Superseded"
  || source?.sourceVersionSuperseded === true;
```

`priceValidity` now returns a **distinct** `"Superseded"` state, decided **before any date reasoning**:

```js
if (source.status === "Rejected") return "Rejected";
if (isCommercialRecordSuperseded(source)) return "Superseded";
```

Plus `TERMINAL_VALIDITY_STATES = ["Rejected","Superseded","Unparseable","Future"]`, documented as never eligible, and asserted by test `14b` so a future edit cannot add them to the strict or relaxed sets.

Because every eligibility path funnels through `priceValidity`, this **one** change covers `selectPriceSources`, `calculatePricingLine`, `isTemporallyUsable`, `pricing-runtime` and `scope-pricing-input` — no duplicated checks.

### 2. Source-version supersession — new `worker/commercial-supersession.mjs`

```js
export const loadSupersededPriceSourceIds = async (db) => { /* ONE tolerant query */ };
export const isSourceVersionSuperseded = (row, set) => set.has(row.source_id);
```

Superseded **only** when the source HAS version rows and **all** are superseded — required because 26 of 27 sources have no version rows at all; treating "no rows" as superseded would have wrongly blocked 14 price rows.

Wired into `pricing-runtime.mjs` (eligibility gate + `priceSources` mapper) and `scope-pricing-input.mjs` (both the primary mapper and the persisted-cost re-validation).

**Deliberate scope boundary:** `pricing-api.mjs:783` (`operation === "sources"`, GET) is a **display/evidence read**, not an eligibility gate, so it was left unchanged.

### 3. A regression in my own earlier test, corrected

My previous slice's `19b` exercised a `superseded_at` column on `price_records` that **does not exist in production** — an unfaithful fixture. It now mirrors the canonical schema and covers the real supplier-intake shape (`Approved` + `validity_state='Superseded'`).

### What was deliberately **not** changed

No new state taxonomy (`Superseded` already existed in `PRICE_STATES`), no eligibility re-ordering beyond putting supersession first, no writer changes, no schema.

---

## F. ELIGIBILITY ORDERING (final, relevant gates)

```
1. Rejected / Superseded / source-version superseded   → BLOCK   (terminal, never relaxable)
2. Malformed effective_from or valid_until            → BLOCK   ("Unparseable", never relaxable)
3. valid_until absent                                  → "No Validity Provided"
4. future-effective                                    → BLOCK
5. explicit expiry in the past                        → BLOCK
6. valid / expiring soon                              → eligible
   … then independent of all the above:
7. approval_status === 'Approved'                      → required
8. downstream_use !== 'Discovery Only'                → required
9. VALID_UNTIL_SUPERSEDED may admit ONLY state 3
```

Steps **1–2 precede 3**, so a relaxation can never execute first and revive superseded or defective evidence. Verified by tests 4, 7, 10, 15.

---

## G. IFP-2100HV REGRESSION (read-only)

Live record, re-read `00:44` — **untouched**:

```
price_6980c523   Needs Review / Discovery Only / valid_until NULL
                 validity_state 'Historical — Validity End Missing'
commercial_conditions = 0      product_library_decisions = 629
Al Mousa FX rows  = 0         Al Mousa pricing runs = 0
D1 PRAGMA quick_check = ok
```

Test `16` mirrors those exact values and proves this repair does **not** make it Approved, Costing-ready, expired, or superseded:

| Assertion | Result |
|---|---|
| `isCommercialRecordSuperseded(ifp)` | `false` — must **not** be superseded |
| `priceValidity(ifp)` | `"No Validity Provided"` — not Expired, not Superseded |
| eligible under policy | `false` — Needs Review + Discovery Only still block |

Its live approval remains a separate task, pending runtime recovery.

---

## H. FOLLOW-UPS (nothing cleaned in this task)

### CODE SAFETY — fixed here
- `validity_state='Superseded'` fail-open → closed (domain).
- Source-version supersession ignored by pricing → closed (worker).

### DATA REMEDIATION — **none required**
Zero affected rows (§C). No historical data touched.

### SCHEMA HARDENING — future, migration owner only (**not implemented**)

| Pri | Item | Rationale |
|---|---|---|
| **P1** | Consider a `price_records.superseded_at` column | Supersession meaning is currently split across three fields, one of which does not exist on the table. A single column would remove the ambiguity permanently. |
| **P1** | Writer consistency: `supplier-price-intake-api.mjs:134` should also set `approval_status` when it supersedes | Today it leaves `approval_status='Approved'` on a superseded row. The resolver now blocks it correctly, so this is defence-in-depth, not a live defect. |
| **P2** | CHECK constraint: `validity_state <> 'Superseded' OR approval_status <> 'Approved'` | Makes the contradictory combination unrepresentable. Requires a migration. |
| **P3** | Index on `price_source_versions(source_id, superseded_at)` | The new lookup groups by `source_id`; tiny table today (1 row) but scales with catalogue size. |

No migration was created or edited. `git status --short drizzle` = **0 changed**.

---

## I. FILES CHANGED

| File | Reason |
|---|---|
| `app/domain/pricing-engine.mjs` | Canonical `isCommercialRecordSuperseded` resolver; `priceValidity` returns a distinct terminal `"Superseded"`, decided before date reasoning; `TERMINAL_VALIDITY_STATES`; `isTemporallyUsable` forwards the whole source. |
| `worker/commercial-supersession.mjs` | **New.** Shared worker-side source-version supersession lookup + per-row test. |
| `worker/pricing-runtime.mjs` | Load superseded-source ids; feed `sourceVersionSuperseded` into the eligibility gate and the `priceSources` mapper. |
| `worker/scope-pricing-input.mjs` | Same wiring for the primary mapper and the persisted-cost re-validation. |
| `tests/commercial-supersession.test.mjs` | **New.** 21 focused tests. |
| `tests/commercial-conditions-writer.test.mjs` | Corrected my own unfaithful fixture (no `superseded_at` column) and replaced the stale "KNOWN GAP" test with the now-authoritative behaviour. |

Not touched: FX, `convertCurrency`, discount rules, panel selection, technical approval, product identity, drawing/quantity lanes, migrations, schema, runtime processes.

---

## J. FOCUSED VALIDATION

```
node --test tests/commercial-supersession.test.mjs            → 21 tests, 21 pass, 0 fail
node --test tests/commercial-validity-policy.test.mjs          → 26/26
node --test tests/pricing-costing-expiry-policy.test.mjs       → 25/25
node --test tests/pricing-engine.test.mjs                     → 20/20
node --test tests/pricing-api.test.mjs                        → 13/13
node --test tests/commercial-conditions-writer.test.mjs       → 27/27
node --test tests/knowledge-banner-copy-truth.test.mjs         →  4/4
node --test tests/confidence-safety-engine.test.mjs           → 16/16
node --test tests/match-selection-status.test.mjs             →  8/8
node --test tests/product-price-library-api.test.mjs           →  9/10 (foreign lane)
```

All 16 required cases covered: normal current unchanged (1), `approval_status='Superseded'` blocked (2), `superseded_at` honoured (3), `validity_state='Superseded'` authoritative (4), conflicts fail closed (5 + 5b), superseded source version blocked (6 + 6c + 6d), policy cannot revive (7), missing validity still eligible (8), expired (9), malformed (10), future (11), Rejected (12), Discovery Only (13), Needs Review (14), no override reintroduced (15), IFP regression (16).

### Failures caused by this slice: **0** — after fixing one I caused mid-task

I initially embedded a correlated subquery in the pricing SELECT. That broke `commercial-policy-fail-closed-runtime` (4→6 failures) with `no such table: price_source_versions`, because its fixture lacks that table. I replaced it with the tolerant single-query Set approach, which restored that suite to its exact baseline. Final full 48-suite sweep: **empty diff, clean=22 / failing=26, identical to the pre-slice record.**

### Pre-existing / foreign-lane failures (not fixed, not mine)

26 suites unchanged, including `product-price-library-api` 9/10 (other lane's `INGESTIBLE_DOCUMENT_TYPES` ingestion refactor), `r5-supplier-price-contract` 1/6, `mvp-bom-5` 8/25, `product-price-library-costing-currency` 1/7, `fx-single-truth` / `r6-fixed-usd-sar-normalization` (expect an unbuilt `FIXED_USD_SAR_POLICY` export), `price-effective-date-validity` (G-5).

Lint: **0 errors**; 3 warnings, all pre-existing unused symbols in `worker/pricing-api.mjs`, which my diff does not touch. My own files lint clean.

---

## K. NEXT STEP

```
NEXT_COMMERCIAL_STEP = RESUME_IFP_LIVE_APPROVAL_AFTER_RUNTIME_RECOVERY
```

Not executed. It remains blocked by the runtime/build failure owned by another technical lane (`loadStage4DrawingArchitectureContext` missing export), reported in the previous slice.

---

## PROHIBITIONS OBSERVED

- ✅ No live project writes — `commercial_conditions` 0, price record untouched, decisions 629, D1 `quick_check = ok`
- ✅ **No runtime restart** — Vite/Wrangler untouched this task; shared build blocker not fixed
- ✅ **No FX**, no `convertCurrency` change, no USD→SAR behaviour change
- ✅ IFP validity condition not persisted; IFP price not approved; no other price approved
- ✅ 65% Farenhyt discount unchanged; not applied to any other in-house brand
- ✅ No pricing lines, quotation revisions, margins, exports
- ✅ No panel-selection or technical-approval change; no Product Identity / Drawing / Quantity / Addressability touched
- ✅ No migration or schema change; no direct D1 edits (reads only)
- ✅ No commit / push / deploy / stash / reset / checkout / restore / clean; `stash@{0}` retained
- ✅ No unrelated cleanup