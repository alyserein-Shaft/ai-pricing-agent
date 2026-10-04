# R11 — FINAL HUMAN-GATE VERIFICATION MISSION — CONSOLIDATED REPORT

**Project:** Al Mousa School — Clean Golden Run (`project_ae501b85-9c12-4332-bf8e-787c90f2d388`)
**Date:** 2026-09-27 · **Runtime:** http://localhost:4183 (not restarted) · **Repo:** dirty tree preserved, no commit/push/deploy

---

## 1. EXECUTIVE VERDICT

🔵 **The terminal label "GOVERNED HOLD — HUMAN DECISION REQUIRED" is CORRECT but the packet that justified it was NOT.**

Two of the previous report's central claims do not survive verification:

| Prior claim | Verdict | Correction |
|---|---|---|
| "22 system approvals" | 🔴 **Undercount** | **31 approval events / 27 unique items**; 15 invalidated; **12** current. Math reconciles exactly. |
| "14 Ready with Warnings" = progress | 🔴 **Invalid artifact** | **All 14 have ZERO approved understanding.** They are "ready" only because an ungoverned raw-extractor category (`"Detector"`, `"Module"`, `"Control Panel"`) **silently defeats the panel-compatibility safety gate**. |

And two escalations were made **without exhausting Project Evidence**:

| Prior escalation | Verdict | Reality |
|---|---|---|
| `standard` → human | 🟢 **Project evidence resolves it** | 10 family-scoped `applicable_standard` facts **already promoted** from the Al Mousa spec (Heat Detector→**UL 521**, FACP→**UL 864**, Manual Call Point→**NFPA 72**), sitting in *Pending Review*. |
| `compatibilityTarget` → human | 🟡 **Partly resolvable, partly an architecture finding** | Project mandates a *single-manufacturer UL-listed ecosystem* + approved-vendor list — a **constraint, not a named panel**. The gate is deliberately unsatisfiable before selection (documented, intentional). |

**Terminal condition stands: 🟡 GOVERNED HOLD — HUMAN DECISION REQUIRED** — but the human packet is now smaller, more precise, and evidence-backed, and it rests on a **newly discovered safety-relevant defect** that must be fixed before matching.

---

## 2. APPROVAL RECONCILIATION — 22 vs 12 🟢 CLOSED (no bug)

**Evidence level: RUNTIME-PROVEN + SOURCE-PROVEN**

`estimator_understanding_review_events` is the authoritative audit table. Full ledger: `.local-evidence/golden-r11/m1-approval-ledger.json`

| Measure | Count |
|---|---|
| `TOTAL_APPROVAL_ACTIONS` (events, all actors) | **31** |
| — of which first approval (`AWAITING_REVIEW→APPROVED`) | 27 |
| — of which re-approval (`APPROVED→APPROVED`) | 4 |
| Idempotency 409s counted as approvals | **0** (correctly excluded) |
| `UNIQUE_ITEMS_EVER_AUTO_APPROVED` | **27** |
| `INVALIDATED_AFTER_LINKING` | **15** |
| `REAPPROVED` | **4** |
| `CURRENT_APPROVED` (authority) | **12** |
| `CURRENT_AWAITING_REVIEW` | 58 (15 stale-approved + 43 never-approved) |
| `CURRENT_NOT_ANALYZED` | 12 |

**Math:** `27 ever-approved − 15 invalidated = 12 current` → **RECONCILES**.

**Why the 15 were invalidated (SOURCE-PROVEN):** `confirmedSpecifications()` (`worker/estimator-understanding-api.mjs:707-720`) feeds **Confirmed requirement links** into the Understanding input fingerprint. Creating 68 Confirmed links shifted the fingerprint, so those approvals no longer match current authority.

**Runtime proof** (Duct detector `boqitem_2f29f080…`):
```
interpretation v1  fp=72c7d90b8d   ← approved (review v1, same fp)
interpretation v2  fp=f900fa80dc   ← post-link re-analysis → approval STALE
```

**Verdict:** This is **correct fail-safe governance**, not a lifecycle bug. `safeUnderstandingReviewItem` downgrades a non-matching approval to `AWAITING_REVIEW` when a fresher interpretation exists. The prior report's "22" was an undercount of its own actions (9 pre-existing + 18 first-pass = 27).

**Architecture note (already reported):** canonical order is **link → analyse → approve → profile**. Reverse order is *safe* but wasteful. State converged: `revalidationRequired=0`, `selectableNew=0`.

---

## 3. LUMP SUM / NON-PRODUCT COMMERCIAL AUDIT 🟡 REAL DEFECT (documented, not repaired)

**Evidence level: SOURCE-PROVEN (exhaustive subagent trace) + RUNTIME-PROVEN**

### The 12 (17 in denominator) rows, by semantic function
| Group | Rows | Canonical type |
|---|---|---|
| "Control and monitor element … interfacing" | 9 | **B. Service / integration scope** (door, firefighting, HVAC interfaces) |
| "Control of HVAC equipment, smoke exhaust fans, duct heaters and BMS interface" | ~4 | **B. Service / engineering scope** |
| "Signals to elevators with all required accessories" | 4 | **A/D. Installation-integration allowance, LS** |

All are `unit = Lump Sum`, functionally obligations with no device identity. **NONE is a purchasable product line.** No product SKU should be invented (confirmed — none exists in the catalog).

### Answers to the six questions
1. **Can a non-product/service BOQ row be quoted today?** 🔴 **NO.** `worker/quotation-line-authority.mjs:269` — `ready: blockers.length===0 && lines.length===boqItems.length`. A 12-row shortfall makes the **whole project** `ready:false`. `worker/presales-workflow-api.mjs:62-67` → 409 `QUOTATION_LINE_AUTHORITY_BLOCKED`.
2. **Does costing support service/scope lines?** 🔴 **NO.** `app/domain/cost-buildup-model.mjs:82-88` — `COST_READY` requires material cost. Service components exist in *shape* (`pricing-engine.mjs:6-15`: `SERVICE_LABOUR`, `INSTALLATION`, `TESTING_COMMISSIONING`) but their parent `pricing_lines.product_id` is **`NOT NULL`** (`db/schema.ts:656`).
3. **Does pricing require product identity unnecessarily?** 🔴 **YES** — `worker/pricing-runtime.mjs:77-84,110-112` joins every price lookup through `candidate.product_id`. `pricing-engine.mjs:143` `LUMP_SUM_RULE_REQUIRED` shows `unit:"LS"` is a *multiplier on a product price*, **not** a lump-sum line.
4. **Does quotation filter exclude all `NO_PRODUCT_FAMILY` rows?** 🔵 **No filter exists — the string is dead knowledge.** `KNOWN_REQUIREMENT_FAMILY_GAPS` (`fire-alarm-taxonomy.mjs:515-521`) has **zero production consumers** (tests only). The real filter is presence-of-pricing.
5. **Is there a separate service-cost/commercial path?** 🔴 **NOT FOUND** at every layer. `Not Applicable` readiness is an **unreachable enum member** (`technical-requirement-engine.mjs:64`). `resolveRequirementRoute` is self-documented "NO runtime consumer today" (`requirement-scope-role-routing.mjs:10-11`).
6. **Do historical quotations contain service lines?** 🔵 **NOT FOUND.** Every quotation/pricing fixture is product-bearing. No service-line precedent exists in any artifact.

### Verdict
🟡 **Real commercial-workflow defect, correctly diagnosed but NOT repaired here.**

- The conflation is **emergent, not encoded**: there is no `NOT_QUOTABLE` constant anywhere. It arises because `product_id`/`candidate_id` are `NOT NULL` on `pricing_lines` **and** `project_quotation_lines` (`db/schema.ts:656, 978`) with **no `line_type` discriminator**.
- **The fail-closed behaviour itself is CORRECT** — the rows are *retained* and *truthfully block* the project rather than being silently dropped. That is the one thing the architecture gets right.
- **Repair requires an atomic 4-part slice** (schema root + BOM/costing root + matching exemption + denominator) with a **new migration**. Per `AGENTS.md` scope discipline and the mission's "smallest correct layer", this is **out of scope for a verification mission** and is escalated as a decision (§11 item 6), not silently implemented.
- Guardrail: any future implementation **must not** use `NO_PRODUCT_FAMILY`/`DATA_QUALITY_EXCLUDED` as the qualifying predicate — both are shared with genuine products (door contact carries `NO_PRODUCT_FAMILY` and is real).

---

## 4. STANDARD — PROJECT-EVIDENCE EXHAUSTION 🟢 RESOLVED

**Evidence level: RUNTIME-PROVEN (project evidence) — state is `PROJECT EXPLICIT`**

The Al Mousa specification (**Pace 2401232, "III-2/28 46 00 Fire Detection and Alarm System Rev 1"**) names, verbatim:

| Family | Standard (project-stated) |
|---|---|
| Heat Detector | **UL 521** · "Comply with UL 521." (req_357, Mandatory) · UL 217 |
| Smoke / Conventional | **UL 268**, **UL 268A** (duct) |
| Duct Detector | **UL 268A** · NFPA 72 |
| Sounder / Strobe | **UL 464** (audible) · **UL 1638** (visual) · NFPA 72 |
| Manual Call Point | **UL 38** · NFPA 72 |
| Fire Alarm Control Panel | **UL 864** · NFPA 72 Styles 4/6/7 |
| Power supply | **UL 1481** · Waterflow **UL 346** |
| Whole system | **NFPA 70 (Art. 760)**, **NFPA 72**, **NFPA 101**, BS EN 54 series, BS 5839/6387, IEC |
| AHJ | **Saudi Civil Defense** (named repeatedly; GDCD submission duties) |

### The governed path already exists and was already run
`worker/spec-source-fact-promotion.mjs` promotes requirement standards into `engineering_facts` with predicate **`applicable_standard`**, scoped **Product Family** — consumed by `technical-requirement-engine.mjs:307` (`sourceFactStandards`) which satisfies the `standard` gate at `:212` **without any requirement link**.

**10 such facts exist, `Pending Review`:**

| Scope (Product Family) | Value | Conf. |
|---|---|---|
| **Heat Detector** | **UL 521** | 94 |
| **Fire Alarm Control Panel** | **UL 864** | 94 |
| **Manual Call Point** | **NFPA 72** | 94 |
| Duct Detector | NFPA 72 | 94 |
| Conventional Detector | UL 268A | 94 |
| Control Module | UL 864 | 94 |
| Sounder | UL 464 | 94 |
| Strobe / Speaker-Strobe | NFPA 72 / BS 6387 | 94 |
| Detector Base | UL 217 | 94 |

`resolveScopedFacts` (`engineering-knowledge.mjs:68`) precedence = **BOQ Item > Product Family > Project**, so these reach every item of the family.

**Verdict:** 🔵 **`standard` is PROJECT EXPLICIT and machine-derivable.** It was escalated to a human prematurely. The remaining step is a *verification* of a deterministic extraction, not an engineering judgment — 10 facts, values already displayed.

**Secondary finding 🔵:** the governed `specification-requirements/auto-confirm` 12-gate policy yields **0 eligible of 457** (173× "System unknown", 93× no normative modal, 87× Informational…). The standards *glossary* rows are correctly `Informational` (not mandatory) — so the glossary is not the right source; the **mandatory** "Comply with UL 521"-style clauses are, and they are family-scoped via the source-fact path above.

---

## 5. compatibilityTarget — PROJECT-EVIDENCE EXHAUSTION + ARCHITECTURE 🟡

**Evidence level: RUNTIME-PROVEN (project) + SOURCE-PROVEN (architecture)**

### What the project actually says
- "All components must be sourced from a **single manufacturer**, who will assume responsibility for ensuring **compatibility among all system elements**."
- "Every component … shall be listed under a **single manufacturer**, approved by **UL**."
- "The fire-fighter's telephone system must be integrated with the fire alarm system and made by the **same manufacturer**."
- Approved-vendor list: **Simplex (USA) · Honeywell (USA) · Siemens (Germany)**
- Topology: SLC, **Class A**, bi-directional full-duplex, **ring topology**, NFPA 72 Styles 4/6/7, EIA-485/232.

**Classification: `GENERIC-ECOSYSTEM` + `PROJECT-REFERENCED` (approved-vendor list) — NOT a named panel.**

### Architecture determination (the mission's key question)
🟢 **It is genuinely a downstream property.** This is **intentional, documented governance**, not a data-entry omission:

- `technical-requirement-engine.mjs:300-306`: `protocol_compatibility` source facts are *"deliberately"* added to compatibility **evidence** but *"deliberately carry neither `targetItem` nor `rightEntityId`"* because the gate *"specifically requires a named compatible PRODUCT/PANEL, not merely 'supports this protocol'"*.
- Sprint 1.14 (`:196-205`) already narrowed the gate from universally-blocking to **family-conditional** via `fireAlarmRequiresPanelCompatibility` (`fire-alarm-taxonomy.mjs:638-639`: Detection Devices / Manual Initiation / Modules and Interfaces / Control Equipment).

**Verdict:** 🔵 **Not over-gating by design.** But a concrete `compatibilityTarget` cannot logically exist until panel selection → asking a human to "fill the field" now is the wrong question. The right question is §11 item 5.

---

## 6. 🔴 CRITICAL DEFECT — PANEL-COMPATIBILITY GATE FAILS OPEN

**Evidence level: RUNTIME-PROVEN + SOURCE-PROVEN — this is the mission's principal finding**

### The defect
`worker/technical-requirement-api.mjs` `executeRequirementProfile` builds the profile identity as:
```js
category:     approvedCategory     || item.category
productFamily: approvedProductFamily || item.subcategory || item.category
classificationProvenance: { productFamily: approvedProductFamily ? "Approved AI Understanding" : "BOQ Extraction" }
```
When **no approved Understanding exists**, the profile uses the **raw, ungoverned BOQ-extractor noun**. That value then drives a **safety gate**:

```js
fireAlarmRequiresPanelCompatibility = (category, family) =>
  PANEL_COMPATIBILITY_REQUIRED_CATEGORIES.has(fireAlarmCategoryForFamily(family) || category)
```

**Runtime proof (`fireAlarmCategoryForFamily` returns `null` for non-governed nouns):**
```
cat=Detector        fam=Detector        catForFam=null                requires=false  ← FAIL-OPEN
cat=Module          fam=Module          catForFam=null                requires=false  ← FAIL-OPEN
cat=Control Panel   fam=Control Panel   catForFam=null                requires=false  ← FAIL-OPEN
cat=Detection Devices  fam=Heat Detector     catForFam=Detection Devices  requires=true   ← correct
cat=Control Equipment  fam=Fire Alarm Control Panel  requires=true                ← correct
```

### Consequence — the "14 Ready with Warnings" are artifacts
| Profile `productFamily` | Provenance | `classificationProvenance` |
|---|---|---|
| `Module` (8) | `BOQ Extraction` | **BOQ Extraction** |
| `Control Panel` (3) | `BOQ Extraction` | **BOQ Extraction** |
| `Detector` (3) | `BOQ Extraction` | **BOQ Extraction** |

Versus the 6 MCI items, which correctly carry `Heat Detector` / `Fire Alarm Control Panel` / `Manual Call Point` with provenance **"Approved AI Understanding"**.

**Production-resolver verdict: `Ready-with-Warnings total=14 · VALID approved understanding=0 · STALE/unapproved=14`.**

So every one of the 14:
1. has **no approved classification**,
2. passes the `productFamily` gate purely because the raw extractor emitted a **non-null generic noun**,
3. **escapes the panel-compatibility safety gate** that its true family (Duct Detector / Interface Module / FACP — all panel-locked categories) should trigger,
4. and lands at "Ready with Warnings" purely because confidence < 80 %.

The system **records** that the value is `BOQ Extraction` — i.e. it knows it is unapproved — and still lets it disable a governed safety gate. This is the previously-flagged **D4 risk** ("ungoverned boq-extractor values 'Sounder', 'Detector'") now **proven consequential**.

### Status: documented, NOT repaired — and why
Repairing requires a readiness-policy decision that **increases** blocking for every project carrying ungoverned extractor values. Per `AGENTS.md` ("smallest sufficient fix wins") and the mission's "do not weaken policy blindly / do not bypass a legitimate human gate", I am **not** unilaterally changing cross-project readiness semantics at the end of a verification mission. Escalated as §11 item 1.

**Minimal correct repair (identified, for the owning task):** the panel-compatibility gate must fail **closed** when neither `productFamily` nor `category` resolves to a governed taxonomy value — one predicate in `fireAlarmRequiresPanelCompatibility` / `blockingFields`, plus a regression test.

---

## 7. CLASSIFICATION-REQUIRED ROOT-CAUSE GROUPS 🔵

**Evidence level: RUNTIME-PROVEN** (`.local-evidence/golden-r11/m56-rootcause.json`)

44 items in `Classification Required`:

| Group | Count | Composition | Nature |
|---|---|---|---|
| **No interpretation at all** | 29 | 12× LS interface functions; 12× "Loop powered strobes…" (excluded, no selection); 5 other | Not a classification problem — governed exclusion / no evidence |
| **B — Family not reproducible** | 15 | 13 no-det; 1 Manual Call Point; 1 Sounder/Strobe | Genuine: raw text does not uniquely determine a governed family |
| **E — AI proposal too rich** | 12 | **6× Manual Call Point, 4× Strobe, 2× Sounder/Strobe — family IS deterministic and matches the proposal** | Blocked **solely** by unsupported extra attributes (`indoor_outdoor`) |
| **F — Other** | 4 | Firefighter Telephone (already approved) | Resolved |
| **C — System unconfirmed** | 1 | Heat Detector | Section-derived system absent |

**🔴 The "E" group (12 items) is real over-gating** — see §8.

---

## 8. UNDERSTANDING QUEUE + PARTIAL FACT-LEVEL AUTHORITY 🔵 / 🟡

### 8a. The all-or-nothing policy is **INTENTIONAL, DOCUMENTED AND TEST-PINNED** — not a defect 🔵
`understanding-system-auto-approval.mjs:18-27`: *"Any other attribute name reaching this policy with a non-null value was asserted beyond what this policy can independently verify, and disqualifies auto-approval — **this is intentionally not a judgment call**."* Pinned by `tests/understanding-system-auto-approval.test.mjs:60, 69-99` (protocol/manufacturer/compatibility all must block). The policy is **versioned** (`:16`) — widening it is a governed version bump, **not** a silent edit.

**Do not weaken it.** The correct reading: gates 4/5 (family+category+system) **pass** for those 12 items; the symptom is the **absence of anywhere to record a partial verdict**.

### 8b. Partial fact-level authority does **NOT** exist for Understanding 🔴
Hard structural proof — `drizzle-active/0000_baseline_schema_0082.sql:2235-2243`:
```sql
review_status TEXT NOT NULL CHECK (review_status IN ('AWAITING_REVIEW','APPROVED','REJECTED')),
canonical_interpretation TEXT NOT NULL,   -- ONE opaque JSON blob, ONE status
```
**One row, one status, one blob.** No per-field state is representable. Origins are only `EXTRACTED|INFERRED|MISSING|NOT_APPLICABLE` — there is **no `CONFIRMED` origin** (`boq-understanding-engine.mjs:187`).

**Four working partial-confirmation precedents exist one layer down:**
| Precedent | Location | Granularity |
|---|---|---|
| `engineering_classification_decisions` | `db/schema.ts:420-422`; route `engineering-classification-api.mjs:46` | per `classification_type` ✅ |
| `requirement_intelligence_facts` | `db/schema.ts:384-386`; route `technical-requirement-api.mjs:441` | per `fact_key` ✅ |
| `profile_requirement_applicability` | `technical-requirement-api.mjs:496` | per requirement ✅ |
| `drawing_title_block_field_reviews` | `db/schema.ts:834` | **per `field_key`** ✅ (exact needed shape) |

**Verdict:** 🟡 **Documented authority-model gap.** The smallest correct repair is a new per-field review dimension modelled on `drawing_title_block_field_reviews`, plus widening the single authority resolver `currentApprovedUnderstandingFacts` consumed by **6 downstream engines**. That is a migration + new governed write/read path — **outside "smallest correct layer"** for this mission. Recorded as §11 item 2.

**Available today without structural change:** `EDIT_AND_APPROVE` (`estimator-understanding-review.mjs:212-219`) lets a human approve the classification while setting unsupported attributes to `MISSING` — i.e. *family confirmed, attributes unresolved* — **as one human action**. This is the correct interim path and requires **no** code change.

### 8c. Queue grouping (58 awaiting)
| Reason class | Items | Human can accept reproducible subset? |
|---|---|---|
| `ATTRIBUTE_EXCEEDS_EVIDENCE` only (family deterministic) | 12 | **Yes, via `EDIT_AND_APPROVE`** — drop the unsupported attribute |
| `FAMILY_NOT_DETERMINISTICALLY_REPRODUCIBLE` | ~15 | No — genuine ambiguity (e.g. bare "Smoke detectors" has no governed family by design, Sprint 1.37 revert) |
| `SYSTEM_NOT_CONFIRMED_BY_SECTION_CONTEXT` | ~6 | No — needs BOQ section/system review |
| `UNVERIFIED_CLAIM_PRESENT` (manufacturer/standards/compat) | ~5 | No — genuine |
| No current proposal / excluded | 20 | Not a review item |

---

## 9. READY-WITH-WARNINGS GATE ASSESSMENT 🔵 / 🔴

**Evidence level: SOURCE-PROVEN + RUNTIME-PROVEN**

| Question | Answer |
|---|---|
| What is being approved? | `approve-readiness` sets `approved_for_matching=1` — an **engineering decision that this item's requirement set is a safe basis for product search**. |
| Technical decision or workflow ack? | **Genuinely technical** — it asserts the consolidated mandatory baseline is complete and correct. |
| Unresolved fields (all 14) | `standard` (blocking=0) and `compatibilityTarget` (blocking=0) — **non-blocking only because of the §6 defect**; plus overall confidence 0. |
| Warnings informational or risk-bearing? | 28 Assumption + 28 Clarification + 28 Missing Information, **all `blocking=0`** — informational *in form*, but two of them are risk-bearing in substance (defect above). |
| Does every R-W profile truly need Technical Reviewer approval? | **Yes — and more than the label implies**, since none has an approved classification. |
| **Could candidate generation safely proceed without implying approval?** | 🟢 **YES — and it already does.** `worker/product-matching-api.mjs:243` gates product matching on `understandingAttempt.available` **only**; it does **not** gate on `readiness_status` or `approved_for_matching`. The comment at `:244-246` confirms only APPROVED canonical facts feed classification search. `approved_for_matching` is read solely by `dashboard-api.mjs:171` and `excel-export-api.mjs:27`. **The authority boundary is correctly drawn — preserve it.** |

**Verdict:** 🔵 The candidate-generation / product-selection / engineering-approval boundary is **correctly separated**. No repair needed. The defect is upstream (§6), in classification provenance.

---

## 10. DOWNSTREAM WORK COMPLETED 🔵

| Stage | Status |
|---|---|
| Product Identity / Matching | **Not started** — correctly blocked (no approved classification; §6 defect) |
| Compatibility | Not started — depends on matching |
| Technical Decision / Price Evidence / Quantity / BOM | Not started |
| Costing | Not started — 17 LS rows have no commercial path (§3) |
| Quotation Readiness / Quotation | **0 ready, 0 approved_for_matching** — correct |
| Non-product commercial path | **Does not exist** — escalated as decision (§11 item 6) |

**Nothing was bypassed to force progress.** Mission 9's precondition ("if this audit resolves additional profiles") was **not** met — and the audit instead *invalidated* 14 previously-counted profiles.

---

## 11. GENUINE HUMAN DECISIONS (the true, evidence-backed set)

Each satisfies all six Mission-8 tests.

| # | Decision | Why it is genuinely human | Evidence to review |
|---|---|---|---|
| **1** | 🔴 **Repair the fail-open panel-compatibility gate** (cross-project readiness policy) | Changes blocking semantics for all projects; safety-direction but broad | §6; `fire-alarm-taxonomy.mjs:638`, `technical-requirement-engine.mjs:206-209` |
| **2** | 🟡 **Decide whether to add per-field Understanding confirmation** | New governance capability + migration; affects 6 engines | §8b |
| **3** | 🟢 **Confirm the 10 promoted `applicable_standard` source facts** | Verifies a deterministic extraction from the project's own spec — the *value* is not an engineering judgment, the *verification* is a governed human act | §4; 10 facts with values displayed |
| **4** | 🟡 **Approve the 58-item Understanding queue** — but only **12** need `EDIT_AND_APPROVE` (family deterministic, drop unsupported attribute); the rest are genuine | Per §8c | Review queue UI |
| **5** | 🟡 **Decide the compatibility architecture**: name the panel/system now, or defer `compatibilityTarget` to post-selection | It cannot logically exist before selection; the choice is a policy decision | §5; SLC/Class A/ring topology + approved-vendor list |
| **6** | 🟡 **Decide the commercial treatment of the 12–17 LS interface/scope lines** | Requires the atomic 4-part schema slice + business intent: do these LS lines belong in the quotation as service/allowance lines? | §3; Al Mousa BOQ + spec |
| **7** | 🟡 **Confirm combined smoke+heat device intent** (2 items) | Genuine specification ambiguity — a combined multi-sensor device vs separate smoke+heat | `Combined smoke and heat detector` rows |
| **8** | 🟡 **Substantive readiness approval** for any profile that legitimately reaches it | Business policy intentionally requires it | — |

**Explicitly EXCLUDED (machine-resolvable, must not appear):**
- ❌ "Confirm Smoke Detector is a Smoke Detector" / bare family taxonomy work
- ❌ "Confirm the standard per item" — project evidence resolves it (§4)
- ❌ Any re-typing of a value the system already derives deterministically

---

## 12. BEFORE / AFTER COUNTS

| Measure | Prior report | **Verified now** | Delta |
|---|---|---|---|
| Approval **actions** | 22 | **31** | 🔴 +9 (undercount) |
| Unique items **ever** approved | (unstated) | **27** | — |
| Invalidated after linking | (unstated) | **15** | new |
| Current **approved** | 12 | **12** | 🟢 reconciles |
| Awaiting review | 58 | 58 | 🟢 |
| Active links | 630 | 630 | 🟢 |
| Profiles `Ready with Warnings` | 14 *(claimed as progress)* | **14 — but 14/14 INVALID** | 🔴 reinterpreted |
| …with approved understanding | (assumed) | **0** | 🔴 |
| `Missing Critical Information` | 6 | 6 | 🟢 |
| `approved_for_matching` | 0 | **0** | 🟢 |
| Product rows (analysed) | 70 | 70 | 🟢 |
| Service/scope rows | 12 | 12 (**17** in engineering denominator) | 🔵 +5 |
| Quotation-ready rows | 0 | **0** | 🟢 |
| Quotation-excluded rows | 0 | 0 explicit (17 **block** the project) | 🔵 |
| `standard` resolved by project evidence | 0 (escalated) | **10 family-scoped facts ready** | 🟢 |
| `standard` unresolved | 6 items | resolvable by #3 | 🟢 |
| Compatibility targets resolved | 0 | 0 (**architecture** blocker, not data) | 🔵 |
| Human decision groups | ~6 vague | **8 precise** | 🟢 |

---

## 13. TESTS

**Repairs made this mission: NONE** (audit + verification; no source edits, no migrations, no data mutation beyond the read-only probes).

| Suite | Result |
|---|---|
| `fire-alarm-golden-evaluation-gate.mjs` | **GATE PASSED** (26/26 coverage, 0 true matching errors, 0 false resolves, 12/12 engineer-review) |
| `fire-alarm-taxonomy-integration` | 37/37 |
| `r5-family-resolver` · `p5-device-noun-family` · `materialize-fire-alarm-families` | 25 · 11 · 23 — all pass |
| `understanding-system-auto-approval` | 17/17 |
| `engineering-knowledge-api` · `-graph-engine` | 10 · 4 — pass |
| `boq-understanding-pilot` | 56/56 |
| `boq-understanding-closure-pass` · `-governed-aware-quality` · `ai-understanding-eligibility` | 16 · 20 · 10 — pass |
| `product-price-library-api` · `-costing-currency` · `system-knowledge-registry` | 11 · 7 · 24 — pass |
| `requirement-intelligence-engine` · `requirement-profile-authority` | 10 · 6 — pass |
| ESLint (changed files from prior phase) | clean |
| Tree | 721 pre-existing dirty entries preserved; **no commit / push / deploy** |

**Pre-existing, not chased (per mission):** `migration-baseline-safety` 6/9 (3 STALE/FROZEN pins, documented not fixed); `discovery-semantics-contract` unrelated; 3 knowledge suites environmental (green via `npm run test:knowledge`).

---

## 14. REMAINING RISKS

| Risk | Severity | Note |
|---|---|---|
| 🔴 Panel-compatibility gate fails open on ungoverned extractor values | **High** | Safety-relevant; affects every project; §6 |
| 🔴 Understanding cannot express partial confirmation | **High** | Forces 12 items into full human review; §8b |
| 🟡 17 LS rows permanently block quotation | **High** | No commercial path exists; §3 |
| 🟡 `compatibilityTarget` unsatisfiable pre-selection | Medium | Intentional, but leaves a permanent label gap |
| 🔵 173 requirements "System unknown" | Medium | Largest single auto-confirm blocker; not Golden-blocking |
| 🔵 29 Classification-Required items are actually *exclusions* | Low | Mis-bucketed counts mislead operators |

---

## 15. EXACT HUMAN ACTIONS (ordered)

1. 🔴 **Decide + authorize the fail-open gate repair** (§6) — *blocks all matching*.
2. 🟢 **Confirm the 10 `applicable_standard` source facts** (§4) — values already derived from the Al Mousa spec; resolves `standard` for every Fire Alarm family.
3. 🟡 **Approve the Understanding queue**, using `EDIT_AND_APPROVE` for the **12** items whose family is deterministic (clearing only the unsupported attribute), and genuine review for the rest.
4. 🟡 **Decide the compatibility architecture** (§5) — name the panel now, or formally defer `compatibilityTarget` to post-selection.
5. 🟡 **Confirm combined smoke+heat intent** (2 items).
6. 🟡 **Decide the commercial treatment of the LS interface/scope lines** (§3) — requires the atomic schema slice; do not invent product SKUs.
7. 🟡 **Decide whether to fund per-field Understanding confirmation** (§8b).
8. 🟡 **Substantive readiness approval** only for profiles that legitimately reach it after 1–3.

**Do not** re-derive standards, re-type deterministically derivable values, or approve readiness to unblock the pipeline.

---

## 16. STATUS

# R11 STATUS: 🟡 GOVERNED HOLD — HUMAN DECISION REQUIRED

**Justified — but for materially different reasons than previously reported.**

The hold is genuine and machine-resolvable work is exhausted. However the *basis* changed:
- The approval ledger **reconciles** (27 − 15 = 12) — no lifecycle bug.
- `standard` is **project-explicit** and no longer a human unknown.
- The 14 "Ready with Warnings" are **withdrawn** as progress — they rest on a **fail-open safety gate**, which is now the single highest-priority item.
- The non-product commercial gap is a **confirmed architectural defect** requiring an atomic schema slice, not a data-entry task.

**Evidence ledger:** `.local-evidence/golden-r11/`
`m1-approval-ledger.json` · `m56-rootcause.json` · `system-auto-approval-run-1.json` · `phase1-0011-constraint-restore.md` · `phase6-taxonomy-repairs.md` · `R11-FINAL-REPORT.md` (prior) · scripts in `scratch/`

**Markers:** 🟢 CLOSED/VERIFIED · 🔵 VALID/INFORMATIONAL · 🟡 TRUE HUMAN DECISION · 🔴 TRUE BLOCKER
**Evidence levels:** GRAPH-PROVEN · SOURCE-PROVEN · RUNTIME-PROVEN · WEB/ENGINEERING-EVIDENCE · INFERENCE
