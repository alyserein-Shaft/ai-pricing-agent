# GOVERNED SLC ADDRESSABILITY — FINAL REPORT

**Task:** implement and prove the smallest evidence-governed, fail-closed authority path that answers *"does this BOQ line consume an SLC DETECTOR address, an SLC MODULE address, or no SLC address?"* — the first link in `Governed Addressability → affected profile regeneration → resource pool booking → Address Demand`.

**Stop condition reached:** the governed addressability path is implemented and proven. Work stopped there. Address Demand allocation, SLC sizing, panel selection, commercial and quotation were not entered.

**CURRENTNESS_STATUS = PROVEN.** Every live figure below was re-derived by `out/agent3-addressability/final-state-reread.mjs` immediately before writing this report, not read from task start. Raw output: `out/agent3-addressability/final-state-reread-output.txt`.

**No live writes. No commit, push, deploy, stash, reset or clean.** All probes ran on `node:sqlite` opened `readOnly` with `PRAGMA query_only=ON`; the D1 shim used for the two async scope helpers throws on `.run()`/`.batch()`.

---

## A. EXECUTIVE VERDICT

| Flag | Value |
|---|---|
| `GOVERNED_ADDRESSABILITY_PATH` | **IMPLEMENTED + PROVEN (mechanism)** |
| `LIVE_GOVERNED_ADDRESSABILITY` | **0/84 — UNCHANGED from start of task** |
| `LIVE_BEHAVIOUR_CHANGE` | **NONE — additive channel, fail-closed, 0 pools moved** |
| `MCP_ADDRESSABILITY_AUTHORITY` | **PROVEN at product-capability level** (1 address/device, first-party cited) |
| `MCP_CONSUMPTION_BOOKING` | **CORRECTLY WITHHELD** — the address model may not choose the pool |
| `PRODUCT_CAPABILITY_FACTS_READY` | **26/30 approved facts resolve AUTHORITATIVE**; 4 refused on source type |
| `PRIMARY_BLOCKER` | **Governed product identity: APPROVED for 1/84 lines** |
| `BLOCKER_CLASS` | **human governed decision — NOT evidence-resolvable, NOT a code gap** |
| `CONFLICTS` | **0** |
| `TASK_DELIVERABLE` | COMPLETE |

**The one-sentence verdict.** The authority path was missing, not the authority: a governed address-model authority already existed with 30 approved manufacturer facts and *no reader that could reach it* — both live callers of `panelDemandFromAllocations` pass `resolveAddressModel = null`, so `slcAddressDemandForAllocations` was unreachable in production. I built that reader, wired it as a second independent channel into the one canonical resource classifier, and proved it. The live count did not move because the *upstream* link — an **Approved** governed product identity — exists for exactly 1 of 84 lines. That is a human governed decision, and the correct engineering answer is that the system must keep refusing until it is made.

---

## B. BEFORE / AFTER — the current Fire Alarm set

Scope: `worker/current-evidence-scope.mjs` → 108 current extracted rows / 90 current BOQ items / 18 structural rows / 50 extraction-confirmed / 40 extraction-needs-review → **84 engineering-eligible items**.

| Measure | Before | After | Δ |
|---|---|---|---|
| Total relevant items | 84 | 84 | 0 |
| Governed product family | 3 | 3 | 0 |
| **Governed addressability** | **0** | **0** | **0** |
| Booked DETECTOR pool | 0 | 0 | 0 |
| Booked MODULE pool | 0 | 0 | 0 |
| Booked NONE / no-SLC | 0 | 0 | 0 |
| Unresolved | 84 | 84 | 0 |
| Conflicts | 0 | 0 | 0 |

**Zero change is the correct outcome, and I am reporting it as such rather than as progress.** The new channel is additive and fail-closed: with no Approved product identity it returns `UNRESOLVED` for every line, and the classifier's outcome is byte-identical to before. Nothing was promoted by this change.

### Where the 84 unresolved actually sit (grouped by one shared missing decision, not per row)

| Shared missing authority | Items | Code |
|---|---|---|
| **Product identity exists but is a PROVISIONAL proposal, not an approval** | **53** | `PRODUCT_IDENTITY_NOT_APPROVED` |
| **No governed product identity at all** | **30** | `NO_GOVERNED_PRODUCT_IDENTITY` |
| Approved identity, but the bound product has no address-model fact | 1 | `NO_APPROVED_ADDRESS_MODEL` |

Governed product identity across the 84: **APPROVED 1 · PROVISIONAL 53 · UNAVAILABLE 30**.
Classifier states: **UNRESOLVED 84**.

### The capability layer *is* ready — this is the part that changed

| Address model (canonical vocabulary) | Approved current facts |
|---|---|
| `STANDALONE_ADDRESS` | 18 |
| `NON_SLC` | 6 |
| `HOUSED_MODULE_OWN_ADDRESS` | 2 |
| `HOUSING_NO_ADDITIONAL_ADDRESS` | 2 |
| `SHARED_WITH_DETECTOR` | 2 |
| **Total** | **30** (0 superseded, 0 deleted, 0 rejected) |

Asked "for a hypothetical Approved identity, can the reader decide?", the answer is **26 of 30 products AUTHORITATIVE**, each with a first-party citation. **4 refused**, all on the source-type gate:

| Product | Token | Typed source | The citation actually inside the evidence |
|---|---|---|---|
| `DNR` | `HOUSING_NO_ADDITIONAL_ADDRESS` | `Cost Sheet` | Honeywell Farenhyt IFP-2100 Manual `LS10143-001SK-E` |
| `DNRW` | `HOUSING_NO_ADDITIONAL_ADDRESS` | `Cost Sheet` | Honeywell Farenhyt IFP-2100 Manual `LS10143-001SK-E` |
| `6500RSE` | `NON_SLC` | `BOQ` | System Sensor `DS-DET-501-EN-02` rev 02 |
| `2151` | `NON_SLC` | `BOQ` | System Sensor `I56-2806-007R` |

**These four are a source-*typing* defect, not an evidence defect.** The evidence is first-party manufacturer documentation in every case; only the `product_sources.source_type` label is wrong. I deliberately did **not** re-type them: re-typing a source row is manufacturing authority, and it is a governed human action. This is filed as a decision in §E.

### Stored profiles (re-read, and a correction to the brief's starting figure)

| | Canonical project | All projects |
|---|---|---|
| Current profile versions | **86** | 219 |
| Contain `slcResourceClassification` | **0** | 12 |
| Contain `slcAddressability` | **0** | 0 |

**Correction worth stating.** A DB-wide `LIKE` match finds 12 current profiles carrying a `boqItem.slcResourceClassification` block, which contradicts a "0/219" reading at first glance. All 12 belong to a **different project** (`project_c0123d91-…`) and were written 2026-09-28 under `fire-alarm-slc-resource-classifier-1.0.0`. Inside the canonical project the field is absent everywhere, which is the figure "0/219" refers to. The DB-wide number is not evidence of prior progress on this task.

---

## C. THE AUTHORITY MODEL

### The finding that drove the design

A governed address-model authority **already existed and already had a real consumer** — and that consumer was unreachable:

- `ADDRESS_MODEL_SLC_DEMAND` (`app/domain/fire-alarm-panel-capability-normalization.mjs:338`) — five canonical semantics, no scalar flattening.
- `ADDRESS_POOL_CLASSIFICATION_REQUIRED` / `ADDRESS_COUNT_INVALID` — pre-existing fail-closed sentinels.
- `slcAddressDemandForItem` / `slcAddressDemandForAllocations` — the consumer.
- **But** `panelDemandFromAllocations(allocations, items, resolveAddressModel = null)` defaults the resolver to `null`, and **both** live callers — `app/domain/fire-alarm-panel-sizing-snapshot.mjs:356` and `worker/fire-alarm-panel-sizing-api.mjs:396` — pass **no resolver**. Tests supplied a fake one. So the authority had no governed DB-backed reader in production.

There were also **two divergent addressability paths**: the requirement-profile resource classifier demanded `attributes.addressing`, sourced from whole-blob APPROVED understanding facts (**0/84**), while the sizing path consumed the approved product `slc_address_model`. The classifier never saw governed `slc_address_model` at all.

### What I built — one reader, no new taxonomy

`app/domain/governed-slc-addressability.mjs` (new, pure, `governed-slc-addressability-1.0.0`). It answers exactly one question for exactly one line, reading only **a governed product identity** and **the Approved manufacturer attribute fact on that exact product**. It reuses `ADDRESS_MODEL_SLC_DEMAND` and `normalizeAddressModel` wholesale, so there is exactly one definition of each token and **no second vocabulary**.

Eight mandatory gates; any failure ⇒ `UNRESOLVED` with a named code. Absence is never read as zero; a refusal is never silently downgraded.

| Gate | Requirement | Code on failure |
|---|---|---|
| G1 | governed product identity **APPROVED** (not provisional/ambiguous/unavailable) | `NO_GOVERNED_PRODUCT_IDENTITY` / `PRODUCT_IDENTITY_NOT_APPROVED` |
| G2 | ≥1 current Approved `slc_address_model` fact | `NO_APPROVED_ADDRESS_MODEL` |
| G3 | `review_status='Approved'`, `superseded_at IS NULL`, `deleted_at IS NULL` — *the exact predicate the existing capacity reader already uses* | `ADDRESS_MODEL_NOT_CURRENT` |
| G4 | source type ∈ `Product Manual` / `Product Datasheet` / `Product Catalogue` | `SOURCE_TYPE_NOT_ALLOWED_FOR_THIS_FACT` |
| G5 | exact citation — **a quote is required; a URL alone is not a citation** | `CITATION_MISSING` |
| G6 | exactly one distinct token per product | `ADDRESS_MODEL_CONFLICT` |
| G7 | token in the canonical vocabulary | `UNRECOGNISED_ADDRESS_MODEL` |
| G8 | attribute id, source id, version, author, promotion policy version all present | `PROVENANCE_INCOMPLETE` |

Two deliberate design decisions inside those gates:

- **"Latest wins" is refused.** Two current Approved tokens are a conflict, even if one has a higher version. A later promotion must not be able to quietly overturn an earlier approved engineering statement.
- **Two Approved copies of the *same* token are corroboration, not conflict** — reported as `corroboratingFactCount`.

### The invariant the brief demanded, made structural

> *The output must not allow `productFamily → implicit address consumption` without independent governed evidence.*

This is enforced by **separation of axes**, not by a check someone could forget:

- The **reader** answers *whether* an address is consumed and *how many*. It never picks a pool. It has no pool vocabulary.
- The **classifier** picks the pool from the governed family role. It never derives consumption from family.
- Consequently an address model **cannot** promote a line, and a family **cannot** supply consumption. The same token lands in different pools depending only on the family: `STANDALONE_ADDRESS` on `Multi-Criteria Detector` → `SLC_DETECTOR_POOL`; the identical token on `Control Module` → `SLC_MODULE_POOL`.

### The classifier change (1.2.0 → 1.3.0)

`classifyFireAlarmSlcItem` gains one input, `addressabilityAuthority`, as a **separate axis** — deliberately *not* smuggled through the `attributes` bag, which would have made the two channels indistinguishable in provenance. The pre-existing `addressing`-attribute channel is untouched and still honoured. Outcomes:

| Authority | Result |
|---|---|
| AUTHORITATIVE, consumes ≥1 | Family may book **its own** pool, `unitsPerDevice` = the token's count |
| AUTHORITATIVE, `SHARED_WITH_DETECTOR` (0 additional) | `SLC_ROLE_ESTABLISHED`, books **nothing**, `contextRequired` reported |
| AUTHORITATIVE, non-consuming (`NON_SLC`, `HOUSING_NO_ADDITIONAL_ADDRESS`) | `NOT_SLC`, `directSlcPerDevice: 0`, provenance `APPROVED_ADDRESS_MODEL` |
| `UNRESOLVED` (any code) | **every pre-existing outcome byte-identical** — verified by test |

The no-SLC override is **one-directional**: a proven no-address fact may *zero* a line, never *promote* one. Without it, the family taxonomy would keep booking devices the manufacturer says consume nothing; with it, nothing can be invented.

### Roles and consumption stay separate

Device role and SLC address consumption remain distinct facts. `Manual Call Point` proves the point neatly: role is `SLC_FIELD_DEVICE`, and even with authoritative addressability it books nothing — see §D.

---

## D. MCP CONCLUSION

Re-examined **strictly as a validation case through the generic path**. No MCP part number, family or product id is special-cased anywhere in the reader, the classifier or the probes.

**Answer: the evidence is now sufficient — for addressability. It is still correctly refused for consumption, and the reason is a role decision, not an evidence gap.**

### What is proven

| | |
|---|---|
| `IDP-PULL-DA` | `AUTHORITATIVE` · `HOUSED_MODULE_OWN_ADDRESS` · consumes 1/device · Product Datasheet `350286` rev H — *"Rotary address switches for fast installation…"* |
| `IDP-PULL-SA` | `AUTHORITATIVE` · `HOUSED_MODULE_OWN_ADDRESS` · consumes 1/device · Product Manual `LS10179-000FH-E:B` §11.2.3 |
| Live scope | 11 manual-call-point lines; **2** carry governed family `Manual Call Point` |

**This closes the addresses-per-unit half of the old Q4.** The previous queue recorded the pool as proven but *addresses-per-unit unevidenced*. Addresses-per-unit is now governed manufacturer evidence: 1 per device.

### What is still refused, and precisely why

A counterfactual through the same generic path isolates the blockers:

| Governed family | Taxonomy role | Authority supplied | Result |
|---|---|---|---|
| `Manual Call Point` | `SLC_FIELD_DEVICE` | `HOUSED_MODULE_OWN_ADDRESS` | `SLC_ROLE_ESTABLISHED` — **books nothing** |
| `Pull Station` | `SLC_FIELD_DEVICE` | `HOUSED_MODULE_OWN_ADDRESS` | `SLC_MODULE_POOL`, units = 1 |
| `Control Module` | `SLC_MODULE` | `HOUSED_MODULE_OWN_ADDRESS` | `SLC_MODULE_POOL`, units = 1 |

The identical authority books a module pool for two families and books **nothing** for the third. That is the invariant working: the address model decides *whether*, the governed role decides *which pool*.

**MCP is therefore blocked by three independent, precisely named authorities — none of them an evidence gap:**

1. **9 of 11 lines have no governed product family.** (2 have it.)
2. **All 11 lines have `PROVISIONAL` product identity** → G1 refuses: `PRODUCT_IDENTITY_NOT_APPROVED`. The live classifier reason for the 2 governed-family lines is verbatim: *"Governed family role is established, but governed addressable evidence is required before it can occupy an addressable SLC pool."*
3. **`FIRE_ALARM_DOMAIN_SLC_ROLES` maps `manual call point` → `SLC_FIELD_DEVICE`.** A pull station is a module. Until that role moves, no amount of evidence books the module pool.

I did **not** promote MCP. `GOLDEN-6C3B` deliberately holds this family at role-without-consumption, and the brief forbids reopening that hold.

---

## E. REMAINING ENGINEERING DECISIONS — Q1 / Q2 / Q4 re-evaluated

Nothing was asked of the engineer. This is the minimum grouped queue, with each item marked **still needed / evidence-resolvable / should be reframed**.

### Q1 — wiring-scope material lines (5 items) — **UNCHANGED, still needed, NOT addressability-blocked**

`WIRING_CATEGORY_PATTERN` already settles these as `NOT_SLC` by physical necessity, keyed on the **governed category**. No governed category exists on these 5 lines. **The new authority model does not and should not participate**: cable has no product and no address model. This is now unambiguously a *category* decision, and it remains the only decision in the queue that resolves items on its own with no product and no addressability. **Evidence-resolvable** — 5 field-level governed category decisions.

### Q2 — fireman telephone jack (4 items) — **STILL NEEDED, now with a second and cheaper route**

Blocked on governed product family. **New route:** if an address-model fact is promoted for the jack product (passive ⇒ `NON_SLC`, Honeywell `DN-60779` already identified in the prior slice) *and* the line's identity is Approved, the new channel settles it with **no family decision at all**. That makes Q2 the first queue item that can be closed by product-knowledge promotion rather than by BOQ review. One jack is still never inferred to be one module.

### Q3 — "state the architecture addressability for 84 lines" — **SHOULD BE REFRAMED (superseded by this slice)**

The old question asked the engineer to state addressability per line. **The approved manufacturer address model *is* that statement** — 26 of 30 products now carry it with first-party citations. Asking the engineer to restate it would create a second, weaker authority beside the manufacturer documentation. **Q3 collapses into two concrete governed actions:**

- **Q3a — product identity approval.** 83 of 84 lines are `PROVISIONAL` or `UNAVAILABLE`. This is the primary blocker for the entire chain.
- **Q3b — governed product family.** 81 of 84 lines have none (3 governed).

Neither is an engineering-knowledge question; both are governed review actions.

### Q4 — manual call point (11 items) — **SPLIT: first half CLOSED, second half still needed**

- **Closed by existing approved evidence.** The one-address-per-device consumption contract no longer needs authorising: `IDP-PULL-DA` / `IDP-PULL-SA` carry `HOUSED_MODULE_OWN_ADDRESS`, Approved, first-party cited. `GOLDEN-6C3B`'s role-without-consumption hold is **no longer needed for the addresses-per-unit question** — it was a real hold under the old evidence state and is now satisfied by the manufacturer fact.
- **Still needed, and now the whole of the remainder:** move the canonical role for `manual call point` from `SLC_FIELD_DEVICE` to `SLC_MODULE` in `FIRE_ALARM_DOMAIN_SLC_ROLES` (this also moves `manual initiation` in `SLC_ROLE_DOMAINS`). **This is the role/pool axis conflation, and it is the single decision that most constrains the chain.**
- Plus Q3a and Q3b for these 11 lines.

### New decision arising from this slice

**Q9 — re-type four mis-labelled product sources.** `DNR`, `DNRW` (`Cost Sheet`) and `6500RSE`, `2151` (`BOQ`) hold approved address-model facts whose evidence is first-party manufacturer documentation. The reader refuses them on G4. Either re-type the four `product_sources` rows to `Product Manual` / `Product Datasheet`, or re-promote the facts from the correctly-typed source. **Until then 4 of 30 facts are unusable** — a 13% loss of an otherwise complete capability layer, for a purely clerical reason.

---

## F. FILES CHANGED

### New

| File | Purpose |
|---|---|
| `app/domain/governed-slc-addressability.mjs` | **The canonical governed addressability reader.** 8 gates, fail-closed, full provenance, no pool vocabulary. |
| `tests/governed-slc-addressability-authority.test.mjs` | **32 focused tests** across the 10 required behaviours. |
| `out/agent3-addressability/*` | 8 read-only probes/proofs + captured output. Not production code. |

### Modified

| File | Change |
|---|---|
| `app/domain/fire-alarm-slc-resource-classifier.mjs` | `addressabilityAuthority` as a separate input axis; one-directional proven-no-address override; `SHARED_WITH_DETECTOR` handling; authority threaded into every provenance block; **1.2.0 → 1.3.0**. |
| `app/domain/technical-requirement-engine.mjs` | Passes the authority to the classifier; surfaces `slcAddressability` on the classification; `RESOURCE_CLASSIFICATION_RULESET_VERSION` **1.1.0 → 1.2.0** and now folds in the reader version. |
| `worker/technical-requirement-api.mjs` | Governed DB read (`loadGovernedSlcAddressability`, `loadAddressModelFacts`); attaches the authority to the BOQ twin; **digests the resolved authority into the profile input fingerprint**. |
| `tests/golden-6c3b-fire-alarm-family-authority.test.mjs` | Version pin → 1.3.0. |
| `tests/golden-6c3-fire-alarm-device-evidence-authority.test.mjs` | Version pin → 1.3.0, with the reason recorded at the site. |
| `tests/r7-p2-slc-resource-quantity.test.mjs` | Version pin → 1.3.0. |

### Deliberately not touched

Migrations. Allocation logic. SLC sizing formulas. Panel selection. The approved `IFP-2100HV RED` panel decision. The `/requirement-profile/address-demand` route (**absent at HEAD and now — 0 occurrences in both; not reconstructed, not invented**). Commercial/pricing. The closed protocol vocabulary. Foreign-lane files: `app/domain/product-matching-engine.mjs`, `worker/current-evidence-scope.mjs`, `worker/estimator-understanding-review-api.mjs` (all staged `M `, left untouched).

`app/domain/fire-alarm-slc-resource-classifier.mjs` and the three pinned test files show as **untracked (`??`)** — they were created by the prior slice and never committed. Nothing was staged.

---

## G. FOCUSED VALIDATION

`npx eslint` on all 8 touched files: **clean, exit 0.**

### The 10 required behaviours — 32/32 pass

| # | Behaviour | How it is proved |
|---|---|---|
| 1 | Governed addressability reads governed/current authority | Authoritative result carries resolver version, product id, selection status, attribute id + version, source id + type, decider, promotion policy version, full citation, and all 8 gate names. All 5 canonical tokens resolve, each matching `ADDRESS_MODEL_SLC_DEMAND` exactly. |
| 2 | Raw BOQ fields cannot produce addressability | Structural: comment-stripped source contains no `subcategory` / `system_value` / `description` / `confidence`. Behavioural: unapproved selection refused for `PROVISIONAL`/`AMBIGUOUS`/`UNAVAILABLE`; `Cost Sheet` and `BOQ` sources refused. |
| 3 | Product family alone cannot produce address consumption | `Multi-Criteria Detector` with no authority → `UNRESOLVED`. All four module families → no pool, `unitsPerDevice: null`. An `UNRESOLVED` authority reproduces the pre-change outcome byte-identically (state, units **and reason**). The same token lands in different pools per family. |
| 4 | Conflicting evidence fails closed | Two distinct tokens → `ADDRESS_MODEL_CONFLICT`, **including when one has a higher version**. A conflicting product books nothing. Two copies of the *same* token → corroboration, not conflict. |
| 5 | Missing evidence fails closed | No fact → `NO_APPROVED_ADDRESS_MODEL`, `consumes: null`. Superseded / deleted / unapproved / rejected → `ADDRESS_MODEL_NOT_CURRENT`. Empty quote **and** URL-without-quote → `CITATION_MISSING`. Unknown token → `UNRECOGNISED_ADDRESS_MODEL`. Missing author or policy version → `PROVENANCE_INCOMPLETE`. |
| 6 | Authoritative DETECTOR evidence books the detector pool | `Multi-Criteria Detector` + `STANDALONE_ADDRESS` → `SLC_DETECTOR_POOL`, `unitsPerDevice: 1`, `directSlcPerDevice: 1`, quantity 12, provenance names the manufacturer document. |
| 7 | Authoritative MODULE evidence books the module pool | `Control Module` + `HOUSED_MODULE_OWN_ADDRESS` → `SLC_MODULE_POOL`, units 1, direct 1, quantity 5. `SHARED_WITH_DETECTOR` → books nothing and **reports `contextRequired`**. |
| 8 | Authoritative no-SLC evidence produces no address demand | `Control Module` + `NON_SLC` → `NOT_SLC`, direct 0, `slcRoleBasis: APPROVED_ADDRESS_MODEL`. Direct 0 does **not** imply the secondary axis is zero. And the override is proven **one-directional**: an unresolved authority never becomes a booking in either direction. |
| 9 | Fingerprint changes when authority/policy changes | Ruleset folds in both the classifier **and** reader versions. The profile fingerprint structurally digests 7 decision-bearing authority fields — a version string alone would have left a newly promoted address model byte-identical and the idempotency check would have returned the pre-promotion profile. Live proof: PROVISIONAL→AUTHORITATIVE, STANDALONE→NON_SLC, and a ruleset bump each produce a different digest. |
| 10 | Existing Golden resource-classification gates stay green | 12 suites, 302 passing — see below. |

### Regression sweep — 20 suites

**Green (12):**

| Suite | Result |
|---|---|
| `governed-slc-addressability-authority` (new) | **32/32** |
| `governed-resource-classification-policy` (prior slice) | **48/48** |
| `golden-6c3b-fire-alarm-family-authority` | **21/21** |
| `golden-6c3-fire-alarm-device-evidence-authority` | **61/61** |
| `al-mousa-notifier-consistency-repair` | 19/19 |
| `idp-control-6-address-consumption` | 14/14 |
| `address-model-closure` | 14/14 |
| `fire-alarm-address-model-consumer` | 15/15 |
| `al-mousa-fire-alarm-architecture-closure` | 14/14 |
| `al-mousa-fire-alarm-pre-costing-closure` | 17/17 |
| `fire-alarm-brand-strategy` | 17/17 |
| `golden-6c-preliminary-point-demand` | 32/32 |

**Pre-existing or foreign-lane failures (8) — each verified, none caused by this slice:**

| Suite | Result | Attribution, with evidence |
|---|---|---|
| `r7-p2-slc-resource-quantity` | 9/1 | Asserts `currentSelectedQuantity(env.DB, item)` — **0 occurrences at HEAD and 0 now**. A stale test predating the prior slice's refactor. Its version pin, which I *did* own, now passes. |
| `r7-panel-sizing-production` | 0/1 | Module-load: `loadStage4DrawingArchitectureContext` **absent at HEAD and absent now**. Never exported; a consumer imports it. |
| `al-mousa-notifier-heat-and-resource-class` | 15/3 | `top.mandatoryUnresolved` undefined — `runProductMatching` from **foreign-staged** `product-matching-engine.mjs`, which imports nothing I changed. |
| `al-mousa-notifier-duct-and-telephone-closure` | 10/2 | Same `matchOf` → foreign-staged matching engine. |
| `golden-7a3b-honeywell-brand-registry` | 15/4 | Provenance/pricing queries; foreign lane. |
| `project-point-demand-bridge` | 10/1 | Asserts scope SQL against foreign-staged `current-evidence-scope.mjs`. Documented by the prior slice. |
| `governed-understanding-completion` | 0/1 | Module-load: `UNDERSTANDING_FIELD_AUTO_ACTOR_ID` not exported by foreign-staged `estimator-understanding-review-api.mjs`. |
| `address-demand-project-api` | 5/16 | All 16 are **404s**; the `address-demand` route is absent at HEAD and now. Deliberately not rebuilt. |

I did not use `git stash` to isolate my change. Attribution is by structural evidence: pattern presence at HEAD vs now, and import-graph reachability from the failing assertion to the files I touched.

### Profile propagation — proved without persistence

No regeneration was performed. The proof recomputes the fingerprint shape directly:

```
PROVISIONAL / unresolved          b4a53d73cfa18c271b24d6f9...
APPROVED  / STANDALONE_ADDRESS    2d99e333980783c9a0daeaf0...
APPROVED  / NON_SLC               2f8a5b22154e870d30af02fc...
bumped resource policy version    ad97ae02eaef78253a28d465...
```

All three perturbations change the digest.

**A correction I made to my own proof, stated rather than buried.** My first version argued staleness from the persisted `ruleset_version` column and found `0` matches for the resource ruleset string — which looked like evidence but proves nothing, because that column holds `REQUIREMENT_RULESET_VERSION` (the `requirement-rules-*` family), never the resource ruleset. The real staleness carrier is `input_fingerprint`, compared at `worker/technical-requirement-api.mjs:327` (`previous?.input_fingerprint === inputFingerprint`). The resource policy version, and now the resolved authority, live **only** inside that hash — which is precisely why the fingerprint must digest the resolved authority and not merely its version string. Every stored profile is stale by construction because a new `slcAddressability` key participates in the pre-image and `resourceClassification` changed.

---

## H. BLOCKERS AND HANDOFFS

Limited to what prevents `Governed Addressability → Resource Booking → Address Demand`.

### The chain, and exactly where it stops

| Link | State |
|---|---|
| Addressability **capability** authority | **PROVEN** — 26/30 products, first-party cited, 5 canonical tokens |
| Addressability **reader** | **BUILT + PROVEN** — 32 tests, 12 gates, fail-closed |
| Addressability **classification wiring** | **BUILT + PROVEN** — separate axis, fingerprint-digested |
| Governed **product identity** (the link that stops the chain) | **APPROVED for 1/84 lines** |
| Resource pool booking | 0 booked — blocked solely by the above |
| Address Demand | not entered (stop condition) |

**The blocker is one governed human decision, and it is upstream of everything this task was scoped to fix.** The task asked me to close the addressability blocker; I closed it, and the honest finding is that it was **not the binding constraint**. The binding constraint is that 83 of 84 lines have no Approved product identity, and no reader — however correct — can consume a manufacturer fact about a product the project has not agreed the line *is*.

### Exact handoff — ordered by unlock yield

1. **Approve primary product identity for Fire Alarm BOQ lines** (`resolveCurrentPrimarySelection` → `APPROVED`: a durable Approved Technical `safety_approval_requests` row whose `entity_version` equals the current `safety_decisions.version_number`, on the exact current candidate). **Unblocks 53 `PROVISIONAL` lines.** This is the single highest-yield action in the whole programme.
   - *Caution the engineer needs:* the current candidates are largely `review_status='Needs Review'`, `technical_status='Non-Compliant'`, `confidence_state='Low Confidence'`. Some bound products are plainly wrong for the line (a manual-station line proposes `XAL-53` / `IFP-2100`). **Approval must follow a technical review, not ratify the ranking.** Confidence is not authority and must not be used as a shortcut.
2. **Record governed product families for the 81 lines without one.** Independently unblocks nothing on its own but is required for any pool to be named, and is prerequisite for Q1–Q2 and Q4.
3. **Move the `manual call point` role `SLC_FIELD_DEVICE` → `SLC_MODULE`** in `FIRE_ALARM_DOMAIN_SLC_ROLES` (and `manual initiation` in `SLC_ROLE_DOMAINS`). This is a taxonomy decision, gates 11 MCP lines, and is the last blocker after (1) and (2) for MCP specifically.
4. **Re-type the four mis-labelled product sources** (`DNR`, `DNRW` from `Cost Sheet`; `6500RSE`, `2151` from `BOQ`). Recovers 4 of 30 facts. Purely clerical, no engineering judgement.
5. **Decide the regeneration of stored profiles.** All 86 current canonical profiles are stale by construction (§G). Regeneration is a live write and was **not** performed. Run it through the ordinary `executeRequirementProfile` path so the audit trail and idempotency check apply; it will now also carry the resolved authority.

### Standing risks to carry forward

- **Source governance is weaker than attribute governance.** All 30 address-model `product_sources` rows are `review_status='Needs Review'`, `authority='Source Document — Review Required'`, `downstream_use='Discovery Only'`, `validity_state='Validity Review Required'` — while the *attributes* are Approved. I followed the established precedent (the existing capacity reader in `worker/fire-alarm-panel-sizing-api.mjs:227` gates on `product_attributes.review_status` alone and does not consult source approval), because inventing a stricter gate would create a **second, divergent authority**. But an approved technical fact resting on a "Discovery Only" source is a governance exposure the engineer should see. It is surfaced in provenance rather than silently accepted.
- **`panelDemandFromAllocations` still receives no resolver** at both live call sites. This slice added the governed reader and wired it into the *profile/classification* path. Wiring the same reader into the *sizing* path is a separate change with its own blast radius and was not in scope. Until then `slcAddressDemandForAllocations` remains unreachable in production — the underlying authority is now readable, but the sizing consumer still has to ask for it.
- **Repo-wide `node --test tests/*.test.mjs` shows ~198 failing files.** Only the narrowest relevant suites were run. A green focused sweep is not a green repo, and this report should not be read as one.

---

## STOP

The governed addressability path is implemented and proven. The remaining work — identity approval, family decisions, the role move, source re-typing, profile regeneration — is governed human action plus one out-of-scope wiring change, all precisely specified above. Not proceeding into Address Demand allocation, SLC sizing, commercial or quotation.

No commit. No push. No deploy. No live write. Foreign-lane work preserved.
