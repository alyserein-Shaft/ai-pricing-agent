# FINAL REPORT — GOVERNED PRODUCT FAMILY → RESOURCE CLASSIFICATION → ADDRESSES-PER-UNIT / DIRECT-SLC SEMANTICS

Slice: second independent blocker closure · project `project_ae501b85-9c12-4332-bf8e-787c90f2d388`
Read-only on live D1. No live write, no reprofile, no allocation, no sizing, no pricing, no quotation, no commit/push/deploy.

```
CURRENTNESS_STATUS = PROVEN (canonical authority re-read immediately before this report)
```

---

## A. HEADLINE

The "0/84 governed product family" claim was **right in its conclusion and wrong in its basis.**

- The real count of engineering-eligible items with a governed, field-level product family is **3**, not 0 — and all 3 were being *ignored*, because the profile generator read a raw column the governed value lived next to.
- Removing that raw fallback was not enough. A second raw path survived in the **engine**, and it is fixed.
- The two divergent resource maps are reconciled: the dead one is **deleted**, the live one is deleted too, and the profile is routed through the **one policy that already existed** — no second taxonomy was created.
- After all fixes, **0 of 84** items reach a booked resource pool. That is not a regression; it is the honest answer, and it was 0 before only for the wrong reasons.

| | |
|---|---|
| Governed product family before | **0/84 claimed** → **actually 3/84**, all ignored by the consumer |
| Governed product family after | 3/84 consumed correctly |
| Items reaching a booked pool | **0/84** (unchanged — but now for provable reasons) |
| Parallel resource maps | 2 → **1** (the survivor was already canonical) |
| Raw paths into resource authority | 2 → **0** |
| Focused tests | **48/48 pass** |
| Golden gates owning the classifier | **82/82 pass** (2 version pins moved) |
| Live writes | **0** |

---

## B. §1 — RE-AUDIT OF THE "0/84 GOVERNED PRODUCT FAMILY" CLAIM

Counted separately, exactly as required, against the canonical scope
(`worker/current-evidence-scope.mjs` → `currentBoqEvidenceFrom` + `currentBoqItemPredicate` + `currentBoqEligibleForEngineeringPredicate`):

| COUNT | VALUE | BASIS |
|---|---|---|
| `WHOLE_INTERPRETATION_APPROVED_COUNT` | **0** | `currentApprovedUnderstandingFacts` (the REAL resolver) returns null for all 84 |
| `FIELD_LEVEL_PRODUCT_FAMILY_CONFIRMED_COUNT` | **3** | `Manual Call Point` ×2, `Multi-Criteria Detector` ×1 |
| `FIELD_LEVEL_CATEGORY_CONFIRMED_COUNT` | **43** | |
| `FIELD_LEVEL_SYSTEM_CONFIRMED_COUNT` | **10** | |
| `NO_GOVERNED_PRODUCT_FAMILY_COUNT` | **81** | |

Findings that matter more than the numbers:

1. **A hand-reconstruction of the whole-blob count said 14. It is 0.** The real resolver is authoritative; the 14 was wrong and is recorded here as disproven rather than quietly dropped.
2. **Governed field-level authority lives in `boq_review_decisions`, not in `boq_items`.** `boq_items` has **no `product_family` column** — the governed value can only ever exist inside the `current_values` JSON payload. Both stores agree on all 3 rows (0 disagreements, 0 one-sided).
3. **`current_values` differs from `original_raw_values` on 84/84 rows, so presence is not governance.** The *decision trail* is the only proof that a human set a value, and it is what the new reader keys on.
4. **Machine actions are excluded from authority.** `GOVERNED_HUMAN_DECISION_ACTIONS` = `update`, `approve`, `Project-wide BOQ Qualification`, `edit`, `restore`. `auto-verify` (436), `merge` (16), `not-duplicate` (1), `reject` (1) are structural/machine and create **no** authority. Total decision rows: 896.
5. **Currency is real and holds.** 0 rows are `STALE` — the 3 governed rows' deciding `extraction_version_id` matches the current `boq_items.extraction_version_id`.
6. **`FIELD_AUTHORITY_CLASSIFICATION_KEYS` does not exist anywhere in the repository.** The claim at `app/domain/governed-classification-authority.mjs:45-54` that it does is **falsely documented**. It was not used as a basis for anything here.

---

## C. §2 / §3 — THE CONSUMER FIX, AND A SECOND RAW PATH FOUND

**Root cause (§2 = option C, stale/incorrect consumer).** `worker/technical-requirement-api.mjs` resolved:

```js
productFamily = approvedProductFamily || item.subcategory || item.category
```

It never read `current_values`, so the 3 real governed values were invisible while raw extraction labels won. Fixed by **consuming existing governed authority** through a new reader (`app/domain/governed-boq-field-authority.mjs`) — a *reader*, not new authority. It fails closed: `STALE → value: null`, and `ABSENT` when only machine decisions exist.

**Second raw path found and fixed (§3).** After the worker fix, `buildGovernedResourceClassification` in the engine still had:

```js
system:  boqItem.governedSystem  ?? boqItem.system,
category:boqItem.governedCategory ?? boqItem.category,
```

`boqItem.system` is `approvedSystem || item.system_value` and `boqItem.category` is `approvedCategory || item.category` — **both still carry raw extraction labels**. A raw label could therefore still select the Fire Alarm domain and still fire the wiring material-scope rule. Both are now `?? null`. Governed inputs only.

Raw `subcategory` / `category` / `description` **remain on the profile object for display and explanation** (asserted by test B3c) and are read by **nothing** in the resource path.

**Declared exception.** The classifier's `WIRING_CATEGORY_PATTERN` on the *governed* category is retained. It is a pre-existing encoded governed engineering rule, can only yield `NOT_SLC` for material scope (the most conservative outcome), and is not fuzzy description matching.

---

## D. §4 / §5 / §13 — ONE EXECUTABLE POLICY, NO SECOND TAXONOMY

`app/domain/technical-requirement-engine.mjs` previously held **two** resource maps:

| Map | Status found | Action |
|---|---|---|
| `resourcePoolMap` | **DEAD** — referenced by no executor, yet cited as canonical by three finished reports | **deleted** |
| `familyMap` / `familyUnitMap` | **LIVE** — but a parallel taxonomy: nine lowercase keys (`detector`, `smoke`, `heat`, `module`, `manual call`, `pull station`, `fireman`, `door`, `telephone`) matching no governed family name, plus four state names of its own | **deleted** |

Both deletions (≈4.2 KB) are guarded by tests B4/B5 so neither can return silently. The profile now routes through the policy that **already existed**: `classifyFireAlarmSlcItem` — keyed on the governed family taxonomy, carrying the manufacturer citations, already the input to `fire-alarm-preliminary-point-demand.mjs`, and already the vocabulary the demand consumers expect (`SLC_DETECTOR_POOL` / `SLC_MODULE_POOL` / `SLC_ROLE_ESTABLISHED` / `NOT_SLC` / `UNRESOLVED`, `unitsPerDevice`, `demandUnits`, `classifierVersion`, `provenance`, `reason`).

**§5 — no substring/fuzzy matching.** Proven by test D3: every near-miss that *contains* a governed key (`Manual`, `Call Point`, `Pull`, `Manual Call`, `Manual Call Points`, `Manual Call Point Extra`, `Manual Call Point (weatherproof)`, `Addressable`, `Door`, `Relay`, `Control Panel Subassembly`) returns `UNRESOLVED`. Every real raw BOQ label returns `UNRESOLVED` (test B2). Case variants resolve a **ROLE** but never book an address count (test D4) — normalisation, not absorption.

**§13 — version ownership.** `RESOURCE_CLASSIFICATION_RULESET_VERSION` is now bound to the classifier:

```
slc-resource-classification-1.1.0+fire-alarm-slc-resource-classifier-1.2.0
```

so bumping the one executable policy necessarily moves the resource identity (test E4).

**Both fingerprints verified — and one was missing and is now fixed:**

| Fingerprint | Location | Consumes the version |
|---|---|---|
| Address Demand input fingerprint + currentness | `technical-requirement-engine.mjs:984`, `:1018` | **YES** (verified) |
| Derived address-demand input fingerprint | `technical-requirement-engine.mjs:727` | **fixed this slice** |
| **Profile idempotency fingerprint** | `worker/technical-requirement-api.mjs` | **WAS ABSENT → fixed this slice** |

The profile idempotency fingerprint is now `RESOURCE_CLASSIFICATION_RULESET_VERSION`-bearing. Without it, bumping the resource policy left every cached profile's fingerprint byte-identical, the idempotency check returned the **pre-bump** profile, and the change was a silent no-op on exactly the artefacts it governs. Test E2 asserts it is a *value inside the fingerprint payload*, not a comment; E3 proves a version change alters the hash.

---

## E. §6 / §7 — THE DIRECT-SLC vs SECONDARY-INTERFACE AXIS

A structural **secondary interface** axis was added, so `DIRECT_SLC = 0` can never imply `TOTAL DOWNSTREAM RESOURCE DEMAND = 0`. Closed vocabulary of three states: `PROVEN_ZERO`, `SEPARATE_DEVICE_REQUIRED`, `UNRESOLVED` (test J1).

| Family | Direct SLC | Secondary interface | Reading |
|---|---|---|---|
| Fireman Telephone Jack | **0 (proven)** | **`SEPARATE_DEVICE_REQUIRED` → `Firephone Control Module`** | Direct 0 ≠ complete. One jack is never one module (tests G1–G3) |
| Duct Detector Housing | **0 (proven)** | **`SEPARATE_DEVICE_REQUIRED` → detector head** | Same shape (test G4) |
| Wiring / cable / conduit scope | **0 (proven)** | **`PROVEN_ZERO`** | The *only* place a proven secondary zero is allowed (test G5) |
| Door Contact | **null** | **`UNRESOLVED`** | No monitor-module demand manufactured, ever (tests F1–F3) |
| Sounder / Strobe / Sounder-Strobe | **null** | **`UNRESOLVED`** | Architecture conflict stays open (tests H1–H4) |
| Manual Call Point | **null** | **`UNRESOLVED`** | Pool proven, consumption unevidenced |
| Multi-Criteria Detector | `1` proven | `UNRESOLVED` | Single address only when the governed address model says so |

§8: the old 1,615-detector / 234-module census was **not** reused. The live truth restated here is the two-pool fact — **159 detectors AND 159 modules are two separate resources** on the same panel — which is exactly why conflating the pools is dangerous.

§9: governed Product Knowledge was used only as *product capability evidence*. No capacity figure, no SLC sizing fact, and no project quantity was copied into the resource profile. Physical quantity stays the Drawing Quantity Authority's; the classifier receives `selectedQuantity: null` by design.

---

## F. §10 — MANUAL CALL POINT: PROVEN POOL, WITHHELD CONSUMPTION

**Proved on governed evidence, then deliberately not enacted as a count.**

Evidence: `IDP-PULL-DA` and `IDP-PULL-SA` both carry `product_attributes.slc_address_model = HOUSED_MODULE_OWN_ADDRESS`, `review_status = Approved`, each bound to a first-party product source; `LS10179-000FH-E:B` §11.2.1 cross-references *"Setting the SLC Address for a Single Point IDP/SK Module"* / *"module addresses 01 - 159"*. `product_families` files `Manual Call Point` and `Pull Station` under the same `engineering_domain` and brand — one class, two labels.

**Conclusion: the POOL is the MODULE pool, not the detector pool.**

I first promoted `Manual Call Point` into `MODULE_FAMILIES`. That **broke `GOLDEN-6C3B`** (4 failures), whose own comment reads *"Manual Call Point and Heat Detector remain genuinely unevidenced"* and asserts `SLC_ROLE_ESTABLISHED` — role established, **consumption still unevidenced**. The promotion is a golden-gated contract violation, so it was reverted. The evidence is recorded in place, in the `UNRESOLVED_FAMILIES` comment, and the finding is raised as **decision Q4**.

The proof that the pool finding is not silently contradicted: the sibling canonical family that *does* carry a consumption contract, `Pull Station`, books `SLC_MODULE_POOL` at 1 address/device on `NOTIFIER NBG-12LX` (test C1).

---

## G. §11 / §12 — CHANNEL-DEPENDENT AND ARCHITECTURE-DEPENDENT CASES STAY UNRESOLVED

- **§11 combined smoke+heat / multi-channel.** Every governed multi-channel signal (`slc_addressing: multi-channel`, `addressing_mode: multi-address`, `point_behavior: dual-address`, `address_count`, `slc_point_count`, `points_per_device`) returns `UNRESOLVED` with `unitsPerDevice: null` (tests I1–I2). One device = one address is booked **only** when the governed per-product address model says `STANDALONE_ADDRESS` (test I3). The dynamic part stays unresolved and the required authority is named in Q6.
- **§12 Sounder/Strobe.** A generic notification label is **never** booked `NOT_SLC`. The canonical *role* is `NOT_SLC` while the *booking* stays `UNRESOLVED`, with `directSlcPerDevice: null` (test H3). This is not academic: the BOQ says **loop powered** while `DEC-2026-10-02-5f2a` substituted **conventional NAC**. The conflict is live for all 15 notification lines, which is why they are `UNRESOLVED_PRODUCT_FAMILY` in the first place — exactly what §12 demands when the architecture is not sufficiently current.

---

## H. §14 — ZERO-WRITE DRY RUN OF ALL 84 ITEMS

`node out/agent3-resource-policy/dry-run-84.mjs` — `node:sqlite` opened `readOnly` with `PRAGMA query_only=ON`; `executeRequirementProfile` is **not** called; nothing is persisted.

```
TOTAL                                  84
GOVERNED_PRODUCT_FAMILY_AVAILABLE       3
DETECTOR                                0
MODULE                                  0
NOT_SLC                                 0
UNRESOLVED_PRODUCT_FAMILY              81
UNRESOLVED_RESOURCE_CLASSIFICATION      3
UNRESOLVED_ADDRESSES_PER_UNIT           0
UNRESOLVED_SECONDARY_INTERFACE          0
```

Secondary blocker frequency (every applicable blocker is listed per item, none suppressed):

```
NO_GOVERNED_ADDRESSABILITY_EVIDENCE      84
UNRESOLVED_ADDRESSES_PER_UNIT            84
NO_PHYSICAL_QUANTITY_AUTHORITY           84
NO_GOVERNED_PRODUCT_FAMILY               81
NO_GOVERNED_SYSTEM                       74
UNRESOLVED_SECONDARY_INTERFACE            3
```

The 3 governed-family items resolve their **family role** and are then refused for a specific, named reason — *"Module family requires governed addressable evidence."* / *"Detector family requires governed addressable evidence."* — which is the fail-closed behaviour the architecture is for. `NOT_SLC = 0` is also correct rather than an oversight: the 5 cable lines are the only items that could settle from a governed **category** alone, and none has one.

Full per-item output: `out/agent3-resource-policy/dry-run-84-output.txt`.

---

## I. §15 — MINIMUM HUMAN ENGINEERING DECISION QUEUE

Full queue with per-decision evidence and exact questions: **`out/agent3-resource-policy/DECISION_QUEUE.md`**. Grouped by ONE underlying engineering decision:

| # | Decision | Items | Unlocks |
|---|---|---|---|
| **Q1** | Confirm wiring-scope cable lines are not SLC-consuming | 5 | **5, fully resolved** — needs no family, no addressability |
| **Q2** | Confirm fireman telephone jack consumes no SLC address | 4 | **4, fully resolved** |
| **Q3** | State the addressability of the accepted architecture | 84 | 0 — **prerequisite for Q4–Q8** |
| **Q4** | Authorise the manual call point consumption contract | 11 | 11 pool / 0 addresses-per-unit |
| **Q5** | Resolve the notification architecture conflict (BOQ says loop powered; decision says NAC) | 15 | 15 |
| **Q6** | Detection device family + multi-criteria channel consumption | 20 | 20 |
| **Q7** | Module vs interface role + enabled-channel consumption | 20 | 20 |
| **Q8** | Door contact interface topology | 3 | 3 |

**The smallest set that resolves anything at all is 2 decisions — Q1 + Q2 = 9 items — and neither needs Q3.** Everything else is gated behind addressability authority that the architecture decision exists but has never been recorded against these lines.

---

## J. §16 — IS REGENERATION READY?

**The code is READY. The artefacts are NOT, and regeneration is a separate authorised step that was not performed.**

| | |
|---|---|
| Producer (`buildGovernedResourceClassification`) | ready |
| Writer (`persistProfile`) | ready |
| Governed field authority available on live data | 3/84 product family, 43/84 category, 10/84 system, **0/84 `addressing`** |
| Live profiles carrying `slcResourceClassification` | **0 of 219** |
| Live profiles carrying `boqItem.governedProductFamily` | **0 of 219** |
| Profile `completed_at` range | 2026-08-02T17:56:41Z → **2026-10-02T22:32:22Z** |
| Newest profile predates the field | **yes** |

A regeneration run today would stamp all 84 items `UNRESOLVED` with named missing authorities. That is honest but strictly less informative than what is stored now (nothing). It is worth running **after** Q1/Q2/Q3, not before.

---

## K. §17 — FOCUSED TESTS

`tests/governed-resource-classification-policy.test.mjs` — **48 tests, 48 pass, 0 fail.** Hermetic: no project database is read or mutated; the only file reads are the sources of three modules, for structural assertions that a fingerprint really contains the version and that removed patterns really are gone.

| Group | Proves |
|---|---|
| A1–A6 | field-level `productFamily` consumed when current; all three fields independent; a machine decision creates **no** authority; a superseded extraction version is `STALE` → `null`; an ungoverned later edit cannot inherit an old value; the reader takes no raw text at all |
| B1–B5 | raw category wording classifies nothing; **every real raw BOQ label** fails to resolve; the removed raw fallback is gone; the raw twins survive for display; the dead parallel maps and `classifyAddressability` cannot return |
| **B3b** | **the resource policy reads governed inputs only, with no raw twin fallback** (the second raw path found and fixed) |
| C1–C5 | MCP's pool is **proven module** with consumption withheld; MCP never mistaken for detector-pool; deterministic; detector pool; two pools never conflated; no addressability evidence means no pool |
| D1–D4 | unknown governed family stays `UNRESOLVED`; exact-key only, no prefix/substring/near-miss; conventional keys establish role and book nothing; case variants never book a count |
| E1–E5 | Address Demand fingerprint consumes the version; **profile idempotency fingerprint consumes it**; a bump changes the hash; a classifier bump necessarily moves both; resource policy not conflated with the requirement ruleset |
| F1–F3 | Door Contact direct 0 ≠ complete; no monitor-module demand manufactured; no wording reaches a proven secondary zero |
| G1–G5 | Fireman Telephone direct 0 proven **with a named separate interface**; one jack never one module; duct housing same shape; wiring scope is the only proven secondary zero |
| H1–H4 | a generic notification label is never booked `NOT_SLC`; the refusal names missing evidence; the canonical role is `NOT_SLC` while booking stays unresolved; the open architecture question is inherited, never answered |
| I1–I3 | multi-channel refuses; every governed channel signal refuses; combined smoke+heat is not assumed to be one address |
| J1–J4 | the secondary vocabulary is closed; unresolved items never report null-as-zero; an absent authority never reads as demand 0; the version rides every classification |

### Regression sweep

| Suite | Result |
|---|---|
| `governed-resource-classification-policy.test.mjs` (new) | **48/48** |
| `golden-6c3b-fire-alarm-family-authority.test.mjs` | **21/21** |
| `golden-6c3-fire-alarm-device-evidence-authority.test.mjs` | **61/61** |
| `al-mousa-notifier-consistency-repair.test.mjs` | **19/19** |
| `idp-control-6-address-consumption.test.mjs` | **14/14** |
| `address-model-closure.test.mjs` | **14/14** |
| `r7-p2-slc-resource-quantity.test.mjs` | 9/10 — 1 **pre-existing** |
| `project-point-demand-bridge.test.mjs` | 10/11 — 1 **pre-existing** |
| `governed-understanding-completion.test.mjs` | 0/1 — **pre-existing module-load failure** |
| `address-demand-project-api.test.mjs` | 5/21 — **pre-existing, see note** |

**Pre-existing failures, each attributed with evidence (none are mine):**

1. `r7-p2:31` asserts the worker source matches `/currentSelectedQuantity\(env\.DB, item\)/`. `git show HEAD:worker/technical-requirement-api.mjs | grep -c currentSelectedQuantity` → **0**. Absent at HEAD and now; my edits did not remove it.
2. `project-point-demand-bridge:288` asserts the scope SQL matches `/documentVersionGoverningPredicate|document_supersessions|governing/i`. `worker/current-evidence-scope.mjs` is **staged-modified by a foreign lane** (`M `) and I did not touch it.
3. `governed-understanding-completion.test.mjs` fails at **module load**: `worker/estimator-understanding-review-api.mjs` does not export `UNDERSTANDING_FIELD_AUTO_ACTOR_ID` — the identifier is absent from the whole `worker/` tree. That file is **staged-modified by a foreign lane** (`M `) and I did not touch it. Part of the known set of files failing on missing exports.

### Changes I made to other lanes' files, and why

Three **version pins** moved from `fire-alarm-slc-resource-classifier-1.1.0` → `1.2.0`, because adding the direct/secondary axes *is* an executable policy change and a version bump is required:
`r7-p2:31`, `golden-6c3b:650`, `golden-6c3-device-evidence:412`. The pool/demand contracts those tests assert are unchanged.

### Note on the missing Address Demand route

`tests/address-demand-project-api.test.mjs` (untracked, prior slice) drives `POST .../requirement-profile/address-demand` and gets **404**. That route is **absent from `worker/technical-requirement-api.mjs`**, and `git diff` shows the file's only changes are mine — so it was never in HEAD. Reported, not rebuilt: the project API shape is in the accepted-closed list and inventing a route would be out of scope. The **canonical reader and both of its fingerprints are present and verified**.

### Lint

`npx eslint` clean on all five files this slice touched.

---

## L. WORKSPACE STATE, AND WHAT WAS DELIBERATELY NOT DONE

**Files changed this slice**

| File | Change |
|---|---|
| `app/domain/technical-requirement-engine.mjs` | `resourcePoolMap`/`familyMap`/`familyUnitMap`/`classifyAddressability` deleted; `buildGovernedResourceClassification` now governed-only; `deriveAddressDemand` head rewritten onto canonical state names; `RELAYMON ? 16` capacity branch removed; direct/secondary axes wired; derived fingerprint takes the version |
| `app/domain/fire-alarm-slc-resource-classifier.mjs` | **v1.1.0 → v1.2.0**; secondary-interface axis + `directSlcPerDevice` added to all five return shapes; MCP evidence recorded in place |
| `app/domain/governed-boq-field-authority.mjs` | **new** — governed field reader, fails closed |
| `worker/technical-requirement-api.mjs` | raw product-family fallback removed; governed twin + authority + provenance added; `loadBoqReviewDecisions` helper; **profile idempotency fingerprint now takes the resource rule version** |
| `tests/governed-resource-classification-policy.test.mjs` | **new** — 48 tests |
| 3 test files | version pins moved |
| `out/agent3-resource-policy/` | **new, untracked** — 4 read-only probes, dry run, decision queue, final-state re-read |

**Preserved untouched:** `app/domain/product-matching-engine.mjs` (foreign lane), `worker/current-evidence-scope.mjs` and `worker/estimator-understanding-review-api.mjs` (foreign lane, staged). Nothing committed, pushed, deployed, stashed, reset or cleaned. `git status` still shows `MM` on the engine — a pre-existing staged state I did not create and did not touch.

**Not done, by instruction:** no live D1 write · no Drawing Quantity schema or apply · no Quantity→BOQ schema or apply · **no profile regeneration** · no allocation · no sizing · no pricing · no quotation · no commit/push/deploy. The old 1,615/234 census was not reused as authority. Description matching was never used as authority.

---

## FLAG BLOCK

```
CURRENTNESS_STATUS = PROVEN
CANONICAL_PROJECT = project_ae501b85-9c12-4332-bf8e-787c90f2d388
CANONICAL_DB = .wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite
LIVE_WRITES = 0
REPROFILED = NO
DRAWING_QUANTITY_APPLIED = NO
QUANTITY_TO_BOQ_APPLIED = NO
ALLOCATION = NO
SIZING = NO
PRICING = NO
QUOTATION = NO
COMMIT_PUSH_DEPLOY = NO

TOTAL_EVIDENCE_ROWS = 108
CURRENT_BOQ_ITEMS = 90
ENGINEERING_ELIGIBLE = 84

WHOLE_INTERPRETATION_APPROVED_COUNT = 0
FIELD_LEVEL_PRODUCT_FAMILY_CONFIRMED_COUNT = 3
FIELD_LEVEL_CATEGORY_CONFIRMED_COUNT = 43
FIELD_LEVEL_SYSTEM_CONFIRMED_COUNT = 10
NO_GOVERNED_PRODUCT_FAMILY_COUNT = 81
STALE_GOVERNED_PRODUCT_FAMILY_COUNT = 0
GOVERNED_ADDRESSABILITY_COUNT = 0

DRYRUN_TOTAL = 84
DRYRUN_GOVERNED_PRODUCT_FAMILY_AVAILABLE = 3
DRYRUN_DETECTOR = 0
DRYRUN_MODULE = 0
DRYRUN_NOT_SLC = 0
DRYRUN_UNRESOLVED_PRODUCT_FAMILY = 81
DRYRUN_UNRESOLVED_RESOURCE_CLASSIFICATION = 3
DRYRUN_UNRESOLVED_ADDRESSES_PER_UNIT = 0
DRYRUN_UNRESOLVED_SECONDARY_INTERFACE = 0

RESOURCE_MAPS_BEFORE = 2
RESOURCE_MAPS_AFTER = 1
CANONICAL_RESOURCE_POLICY = app/domain/fire-alarm-slc-resource-classifier.mjs
SLC_RESOURCE_CLASSIFIER_VERSION = fire-alarm-slc-resource-classifier-1.2.0
RESOURCE_CLASSIFICATION_RULESET_VERSION = slc-resource-classification-1.1.0+fire-alarm-slc-resource-classifier-1.2.0
PROFILE_IDEMPOTENCY_FINGERPRINT_CONSUMES_RESOURCE_VERSION = YES (fixed this slice)
ADDRESS_DEMAND_FINGERPRINT_CONSUMES_RESOURCE_VERSION = YES (verified)

RAW_PATHS_INTO_RESOURCE_AUTHORITY_BEFORE = 2
RAW_PATHS_INTO_RESOURCE_AUTHORITY_AFTER = 0

CURRENT_PROFILE_VERSIONS = 219
PROFILES_WITH_SLC_RESOURCE_CLASSIFICATION = 0
PROFILES_WITH_GOVERNED_PRODUCT_FAMILY = 0
REGENERATION_READY_CODE = YES
REGENERATION_PERFORMED = NO
REGENERATION_RECOMMENDED_AFTER = Q1, Q2, Q3

FOCUSED_TESTS = 48
FOCUSED_TESTS_PASS = 48
FOCUSED_TESTS_FAIL = 0
GOLDEN_GATES_ON_CLASSIFIER_PASS = 82
PREEXISTING_FAILURES_NOT_MINE = 4

HUMAN_DECISION_QUEUE_SIZE = 8
HUMAN_DECISIONS_UNLOCKING_ANYTHING = 2
ITEMS_UNLOCKED_BY_THOSE_TWO = 9

STOP = after this report
```