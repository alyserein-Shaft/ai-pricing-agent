# GOLDEN-3 — Compatibility Target Authority & Control-Panel Readiness

**Mode:** read-only audit + fail-closed regression tests. No repair implemented.
**Continues:** `docs/GOLDEN-1-…`, `docs/GOLDEN-2-…` (neither reopened)
**Tree baseline:** HEAD `029b42637ac117f810e726b40c2e888c484c173b`, 785 porcelain lines, treehash `42739f03b894` (2026-09-28T19:06:52Z)

---

## 1. Executive verdict

🔴 **`BLOCKED — COMPATIBILITY TARGET REQUIRES HUMAN ENGINEERING INPUT`**

The blocking rule is **correct and must not be weakened**. The target is **genuinely absent** from the project. Nothing may lawfully back-fill it.

The decisive evidence is the project's own confirmed NPQ profile:

| Field | Value |
|---|---|
| `manufacturer_strategy` | **`"Detect from Specification"`** |
| `approved_manufacturers_json` | **`[]`** (empty) |
| `preferred_manufacturer` | `""` (empty) |
| `manufacturer_notes` | `""` (empty) |
| `status` | `Confirmed` |

The client explicitly declined to name a manufacturer and delegated the decision to the specification. The specification, when read, contains a **five-manufacturer reference list** — Simplex (15), Siemens (8), Honeywell (7), Cisco (4), Bosch (1), all extracted from bare lines such as `"Honeywell – U.S.A."` — which is a reference/approved-products listing, **not a mandate of a single panel ecosystem**. A specification that describes a Honeywell detector and a Simplex panel will legitimately name both.

**Therefore: `NO AUTHORITATIVE COMPATIBILITY TARGET EXISTS` for the Fire Alarm Control Panels.**

🟢 GOLDEN-2's conclusion is confirmed and unchanged: the governed approval writer works. The system is behaving correctly by refusing.

---

## 2. `compatibilityTarget` semantic definition

Not inferred from the name. From the gate itself (`app/domain/technical-requirement-engine.mjs:218`):

```js
compatibilityTarget: compatibility.some((item) => item.targetItem || item.rightEntityId) ? true : null
```

**It means: "a named compatible product, panel, or controller entity that this BOQ line must interoperate with."**

It is **not** a protocol, **not** a manufacturer name, and **not** a generic standard reference. The engine says so explicitly (`:306-316`): a `protocol_compatibility` Source Fact is added to the compatibility array for visibility but *deliberately carries neither `targetItem` nor `rightEntityId`*, because "a named compatible PRODUCT/PANEL, not merely 'supports this protocol'".

**The reference instance in this very project** — item C (Heat Detector), the only profile that ever cleared the gate — carries:

```json
{ "relationship_type": "Compatible With",
  "target_item": "Flash Scan® and CLIP protocol systems",
  "review_status": "Needs Review",
  "source_item": "… Individually addressable devices f)" }
```

Note it names a **system/protocol family**, not a SKU, and it came from **specification extraction** (`specjob_2ee1d387…requirement_197`). That is the established lifecycle.

---

## 3. Producer / consumer dataflow

```
technical_requirements (spec extraction)          requirement_relationships (project)        engineering_facts (Source Facts)
            │                                                  │                                       │
   consolidated[].compatibility                    relationshipType ~ /compatible|interface|protocol/i/    predicate = protocol_compatibility
            └──────────────────────┬───────────────────────────────┘                                       │
                                   ▼                                                                        │
                    compatibility = [ ...consolidated.compatibility,                            sourceFactCompatibility ──┘
                                        ...requirementRelationships-filtered,               (NO targetItem / rightEntityId — by design)
                                        ...sourceFactCompatibility ]
                                   │
                                   ▼
        detectMissingInformation: compatibilityTarget = compatibility.some(t => t.targetItem || t.rightEntityId)
                                   │
                    blockingFields(): fireAlarmRequiresPanelCompatibility(system, category, family)
                                   │
                                   ▼
              profile.readiness.status  ──►  Missing Critical Information
                                   │
                                   ▼
        product-matching-engine.mjs:585  profileBlocked = !["Ready for Matching","Ready with Warnings"].includes(status)
                                   │
                                   ▼
                         discovery = true  ──►  all candidates "Discovery Only" / "Discovery Candidate"
                                   │
                                   ▼
              confidence-safety-engine.mjs:127  block("DISCOVERY_ONLY", …, overridable = false)
                                   │
                                   ▼
                     approvalEligibility.technical = "Blocked"   ──►  governed approval route refuses
```

**Producers:** specification extraction → `technical_requirements` + `requirement_compatibility`; `boq_requirement_links` binds them to a BOQ item.
**Consumers:** `detectMissingInformation` (readiness) → `runProductMatching` (discovery mode) → `evaluateSafety` (block) → approval route.

---

## 4. Authority hierarchy

| Source | Status for this gate | Why |
|---|---|---|
| **Approved requirement carrying a compatibility relationship with a named target** | 🟢 **Authoritative** | It is the only shape the gate accepts |
| **Specification-extracted compatibility clause naming a system/panel family** | 🟢 **Authoritative once extracted and linked** | The proven lifecycle (item C) |
| **Project engineering decision (human)** | 🟢 **Authoritative** — the decision this slice needs | `clarificationQuestion` / `recommendedOwner: "Technical Reviewer"` already exist |
| Confirmed NPQ `approved_manufacturers` | 🟡 **Advisory for this gate** | Empty here; and a manufacturer string is not a compatibility relationship |
| `protocol_compatibility` Source Fact | 🟡 **Advisory** — deliberately excluded | `technical-requirement-engine.mjs:306-316` |
| BOQ `manufacturer` / `model` / `part_number` | 🟡 **Advisory** | All NULL for all 7 panels; a model is not a compatibility *relationship* |
| Product library / catalog | 🔴 **Prohibited** | Gate signature has no product or price parameter |
| Price records | 🔴 **Prohibited** | Same |
| AI inference | 🔴 **Prohibited** | `SOURCE_PRECEDENCE` ranks `AI Inference: 10`, lowest |

---

## 5. Seven-panel evidence matrix

`project_c0123d91-c30b-4956-87cb-e473ef53f89d` — inspected individually, not grouped.

| # | BOQ item | Profile v. | `readiness.status` | `compatibility[]` | Linked reqs | Mfr rows | Compat rows | BOQ mfr/model/pn/specRef | Why `compatibilityTarget` is NULL |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `boqitem_e613397f…` (G) | current | Missing Critical Information | `[]` (0) | 2 | 0 | 0 | all NULL | Its 2 requirements are about **SLC wiring style** and **network topology** — neither names a compatible panel |
| 2 | `boqitem_4be2bb26…` (D) | current | Missing Critical Information | `[]` (0) | **0** | 0 | 0 | all NULL | 🔴 No linked technical requirements at all |
| 3 | `boqitem_92ed49c3…` (D) | current | Missing Critical Information | `[]` (0) | **0** | 0 | 0 | all NULL | 🔴 No linked technical requirements at all |
| 4 | `boqitem_1f44b7de…` (K) | current | Missing Critical Information | `[]` (0) | **0** | 0 | 0 | all NULL | 🔴 No linked technical requirements at all |
| 5 | `boqitem_5fe70cc4…` (K) | current | Missing Critical Information | `[]` (0) | **0** | 0 | 0 | all NULL | 🔴 No linked technical requirements at all |
| 6 | `boqitem_6af90650…` (K) | current | Missing Critical Information | `[]` (0) | **0** | 0 | 0 | all NULL | 🔴 No linked technical requirements at all |
| 7 | `boqitem_eb69f1a1…` (K) | current | Missing Critical Information | `[]` (0) | **0** | 0 | 0 | all NULL | 🔴 No linked technical requirements at all |

**Common blocker reason** (identical for all 7, from `profile.readiness.blockingReasons`):
> `"compatibilityTarget is required to define a safe Fire Alarm product search boundary."`

**Project-wide context:** 39 current profiles — `Missing Critical Information` 31, `Classification Required` 4, `Needs Technical Review` 3, `Ready with Warnings` **1** (item C, Heat Detector — the only profile in the entire project carrying a `targetItem`).

---

## 6. Existing authoritative evidence

**Searched:** specification `original_text` for protocol / manufacturer / panel-family / loop statements; `requirement_compatibility` (project-wide); `requirement_manufacturers`; `requirement_intelligence_facts`; `engineering_relationships`; NPQ profile; BOQ columns.

**What exists:**

| Evidence | Content | Currentness | Verdict |
|---|---|---|---|
| Manufacturer reference list | Simplex 15, Siemens 8, Honeywell 7, Cisco 4, Bosch 1 — from bare lines `"Honeywell – U.S.A."` | extracted, `Named`, unapproved | 🔴 A **list**, not a mandate |
| Protocol statements | *"Flash Scan® (Patent 5,539,389) is a communication protocol…"*, *"Flash Scan® is a communication protocol designed to…"* | in the **detector** clause only | 🔴 Detector-scoped; used by item C, not by any panel |
| Generic FACP requirements | *"peer-to-peer, regenerative format and protocol across both LAN and WAN"*, *"manufacturer must specify the communication types and protocols used"* | generic | 🔴 Names no family; the second explicitly **delegates the decision to the manufacturer** |
| `requirement_intelligence_facts` | 60+ facts (Addressability, Functional Role, Mandatory Features, System Type) | all `Needs Review` | 🟡 Qualitative only; no target entity |
| `engineering_relationships` | 14 rows, all `Approved` | — | 🟡 None is a panel-ecosystem statement for this project |

**Verdict: `NO AUTHORITATIVE COMPATIBILITY TARGET EXISTS`.**

**Explicitly rejected shortcuts:**
- 🔴 **Honeywell is not a mandate.** It appears once, in a five-manufacturer list. Note the specification also names Simplex, Siemens, Cisco and Bosch.
- 🔴 **"Flash Scan®" is not the answer for a panel.** It is a *detector* protocol statement, and it is a protocol — precisely the class the engine refuses to accept.
- 🔴 **The prior Golden decision "9 × IDP-HEAT-ROR-IV / 0 × IDP-HEAT-HT-IV" is not transferable authority.** IDP is a Honeywell family, but that decision belongs to the **Clean Golden Run** (`project_ae501b85`), a *different project*, and this project's NPQ declares `manufacturer_strategy = "Detect from Specification"`. Cross-project transfer of an approved engineering decision is not a governed mechanism, and adopting it would silently contradict this project's own declared strategy.

---

## 7. Root-cause classification

# `E — EVIDENCE ABSENT`

The project genuinely does not state a Fire Alarm panel ecosystem. The client's confirmed NPQ delegates the decision to the specification; the specification declines to name a single ecosystem; the BOQ columns are empty; and the panel BOQ items carry no linked requirements that could carry a compatibility relationship.

**Explicitly not:**
- ❌ `A — EXTRACTION GAP`: the target text does not exist to extract.
- ❌ `B — UNDERSTANDING GAP`: there is no extracted target to fail to map.
- ❌ `C — PROFILE ASSEMBLY GAP`: assembly is correct — `compatibility: []` faithfully reflects absent evidence.
- ❌ `D — REVIEW/AUTHORITY GAP`: there is no candidate compatibility fact awaiting review for any panel.
- ❌ `F — WRONG REQUIREMENT`: the rule is correct (§8).

---

## 8. Blocking-rule audit

**Function:** `fireAlarmRequiresPanelCompatibility(category, family)` — `app/domain/fire-alarm-taxonomy.mjs:666-674`.

**Required set** (`:638`):
```js
const PANEL_COMPATIBILITY_REQUIRED_CATEGORIES =
  new Set(["Detection Devices", "Manual Initiation", "Modules and Interfaces", "Control Equipment"]);
```

**Verified behaviour:**

| Family | Resolved category | Requires target? |
|---|---|---|
| Fire Alarm Control Panel | **Control Equipment** | 🟢 `true` — **correct** |
| Heat Detector / Duct Detector / Detector Base / Isolator Base | Detection Devices | `true` |
| Manual Call Point | Manual Initiation | `true` |
| Interface Module | Modules and Interfaces | `true` |
| **Strobe / Sounder** | **Notification Devices** | `false` — correctly exempt |
| **Battery** | **Power and Batteries** | `false` — correctly exempt |
| Smoke Detector, Notification Appliance, Strobe/Sounder (unregistered) | `null` | `true` — **fails closed** |

**Why Control Panel triggers it:** the taxonomy's own reasoning (`:624-625`): *"Control Equipment (the panel itself) defines that compatibility boundary for the rest of the system."* The panel **is** the ecosystem boundary, so requiring a target for it is exactly right.

**Is it unconditional?** No — it is **per-family, contextual, and deliberately fail-closed**. Unregistered families fail closed rather than gaining an exemption (`:670-673`), per the R11 safety repair: *"an UNGOVERNED classification must never CREATE A SAFETY EXEMPTION."* The current ruleset is `requirement-rules-2026-09-27-fail-closed-panel-compat`.

🟢 **The rule is correct and must not be weakened.** Relaxing it would let a panel be matched and priced with no known ecosystem — exactly what BOM-001/R7 exist to prevent.

---

## 9. Successful-profile comparison

Exactly one profile in the project is `Ready with Warnings` and carries a target — **item C, Heat Detector** (`boqitem_5af0a8eb…`).

**Its lifecycle:**
1. Specification extraction produced `specjob_2ee1d387…_requirement_197` with a compatibility relationship.
2. `target_item = "Flash Scan® and CLIP protocol systems"`, `relationship_type = "Compatible With"`, sourced from clause text *"…Individually addressable devices f)"*.
3. `boq_requirement_links` bound the requirement to the BOQ item.
4. Profile assembly carried `targetItem` into `profile.compatibility`.
5. `detectMissingInformation` found a named target → no `compatibilityTarget` gap.
6. Readiness reached `Ready with Warnings`; matching ran in **normal technical mode**.

**No second path was created for control panels, because none is needed** — the *same* path works; there is simply no such clause for the panels. Its `review_status` is `Needs Review`, which shows the target itself does not need to be pre-approved to satisfy the gate; it needs to **exist and be governed**.

---

## 10. Smallest legitimate repair

🔴 **There is no code repair. Phase 9/E mandates STOP.**

The smallest legitimate next step is a **governed human engineering decision**, recorded through an existing surface — not a new model:

**Required decision:** for the 7 Fire Alarm Control Panel BOQ items, name the **panel ecosystem / protocol family** the project shall use, citing the governing document.

**Existing surface that already supports it.** `detectMissingInformation` emits, for this exact field:

```js
clarificationQuestion: "Please confirm the compatibility target for BOQ item G, citing the governing document.",
recommendedOwner: "Technical Reviewer",
status: "Open",
```

This is the existing `requirement_ambiguities` / requirement-review workflow. The decision should be recorded as an **approved compatibility requirement on the panel line** (the item-C shape), which then flows through the unchanged lifecycle in §3.

**Explicitly prohibited, and not done:**
- ❌ editing `profile.compatibility` or `compatibilityTarget` directly
- ❌ setting the value in any test or live DB row
- ❌ hardcoding a manufacturer or protocol
- ❴ copying from a matched product or deriving from a candidate
- ❌ deriving from price data
- ❌ relaxing `DISCOVERY_ONLY` or the panel-compatibility rule
- ❌ transferring the Clean Golden Run's IDP decision across projects

---

## 11. Fingerprint / currentness behaviour

🟢 **Already correct — no repair needed.** Verified in source:

- `REQUIREMENT_RULESET_VERSION = "requirement-rules-2026-09-27-fail-closed-panel-compat"` participates in the profile `input_fingerprint` (`worker/technical-requirement-api.mjs`), so a code-interpretation change forces recomputation.
- `executeRequirementProfile`'s idempotency check compares `input_fingerprint`, which folds in BOQ item + links + requirements + facts + relationships + ruleset version. A new approved compatibility requirement changes that fingerprint.
- `requirement_profile_versions.superseded_at` retires the old version; the match run pins `requirement_profile_version_id`.
- Stale detection already exists at two layers and is proven: `REQUIREMENT_PROFILE_CHANGED` (approval route) and `STALE_PANEL_PRODUCT_SELECTION` (sizing producer), via `matchRunStaleness` (`worker/product-matching-api.mjs:50-58`).
- GOLDEN-2's suite already proves a stale profile invalidates the selection.

🔴 **The one real risk** — a profile regenerated to a new version would leave the existing `Discovery Only` match run (`matchrun_bd41090c…`, version 1) in place. `runProductMatching` writes a **new** `version_number`; a new run is required, and the old run must not be reused. This must be verified when the decision is made, and is deliberately **not** pre-empted here.

---

## 12. Matching transition

**Before** (proven, live): `compatibilityTarget=NULL` → `Missing Critical Information` → `profileBlocked` → `discovery=true` → `DISCOVERY_ONLY (overridable:false)` → `approvalEligibility.technical = "Blocked"`.

**After a legitimate governed target** — **not simulated**, because producing one would require inventing the decision. What *is* proven:

- A profile whose readiness is `Ready for Matching` / `Ready with Warnings` yields `profileBlocked === false` (`GOLDEN-3-3`).
- With `profileBlocked === false`, `discovery` depends only on `generated.discoveryOnly`, so `DISCOVERY_ONLY` disappears **if and only if** the missing target was its sole cause.
- The `compatibility` gate accepts `targetItem` **or** `rightEntityId` (`GOLDEN-3-1`).

🔴 **Honest statement of what remains unknown:** whether `DISCOVERY_ONLY` disappears *in practice* for these 7 items cannot be proven without the decision. Independent blockers may remain — the panel items have almost no linked requirements, so **no candidate can be generated at all** for the 6 items with zero links. The next blocker after a target is very likely `NO_CURRENT_CANDIDATE` / empty product population, **not** something GOLDEN-3 can or should resolve.

---

## 13. Acceptance-project dry run (read-only)

| Outcome | Items | Detail |
|---|---|---|
| 🟢 Target recoverable automatically from governed evidence | **0 of 7** | No panel has a compatibility clause, a manufacturer, or a model |
| 🟡 Target recoverable after review of existing evidence | **0 of 7** | There is no ambiguous candidate to review — the evidence is simply a 5-manufacturer list |
| 🔴 Target absent — human input required | **7 of 7** | All blocked at `Missing Critical Information` |

Even with a target, **6 of 7 would still be blocked** afterwards, because they have **no linked technical requirements** and therefore no candidate population. Item G is the only one that could conceivably proceed to matching.

---

## 14. Golden-fixture consequence

🔴 **None in this task, by instruction.** Stated for the record:

The hermetic E2E fixture has **no Fire Alarm Control Panel BOQ item at all** (`golden-boq.xlsx` = 3 rows: detector, interface module, annunciator). Therefore, **even a fully repaired compatibilityTarget path would not change the Golden E2E fixture's behaviour at all.**

A separate **Golden-fixture expansion slice** is required to add a control-panel line. That is explicitly out of scope here and must not be conflated with this slice.

---

## 15. Tests

`tests/golden-3-compatibility-target-authority.test.mjs` — **24/24 pass**, real domain modules, no mocks of the authority.

| # | Required behaviour | Test |
|---|---|---|
| 1 | NULL target reproduces `Missing Critical Information` | `GOLDEN-3-1` |
| 2 | NULL target forces Discovery Only | `GOLDEN-3-3` (real `product-matching-engine` predicate) |
| 3 | `DISCOVERY_ONLY` non-overridable | `GOLDEN-3-3` (real `evaluateSafety`) |
| 4 | governed target source is current | `GOLDEN-3-5` (fingerprint/ruleset pin) |
| 5 | unapproved/stale source cannot populate | `GOLDEN-3-2` (protocol facts, bare types, empty strings) |
| 6 | valid target changes the outcome | `GOLDEN-3-1` (`targetItem` / `rightEntityId`) |
| 7 | no product candidate can back-fill | `GOLDEN-3-2` (gate signature has no product parameter) |
| 8 | no price/catalog data can back-fill | `GOLDEN-3-2` (same) |
| 9 | old profile becomes non-current | §11 source proof + GOLDEN-2 staleness tests |
| 10 | matching uses the new profile | §11 source proof |
| 11 | Discovery Only disappears when only cause | `GOLDEN-3-3` (predicate-level; practical case needs the decision) |
| 12 | no product-derived target | `GOLDEN-3-2` |
| 13 | unrelated families retain behaviour | `GOLDEN-3-4` (Strobe/Sounder/Battery exempt; unregistered fails closed) |
| 14 | all 7 panel items covered | `GOLDEN-3-6` |

**No-regression:** 140/140 across `golden-2`, `r7-panel-sizing-production`, `technical-requirement-engine`, `product-matching-engine`.

---

## 16. Files changed

| File | Change |
|---|---|
| `tests/golden-3-compatibility-target-authority.test.mjs` | **new** — 24 tests |
| `docs/GOLDEN-3-COMPATIBILITY-TARGET-AUTHORITY.md` | **new** — this report |

**No production source, migration, schema, fixture, or configuration change.** BOM-5 pricing untouched. Golden E2E fixture untouched. CLOSE candidate-review state untouched.

---

## 17. Business-state writes

**None, live.** Live D1 was read WAL-safe read-only. No compatibility decision, requirement approval, profile regeneration, matching run, safety decision, approval, sizing snapshot, pricing or quotation change was made. All behavioural verification used in-process domain functions and in-memory fixtures.

---

## 18. Next Golden slice

**GOLDEN-4 — record the governed Fire Alarm Control Panel ecosystem decision for the acceptance project.**

**Required human decision (one, consolidated):**
> For the 7 Fire Alarm Control Panel BOQ items in `project_c0123d91-c30b-4956-87cb-e473ef53f89d`, what panel ecosystem / protocol family shall the project use, and which document governs that choice?

Supporting facts to decide with:
- Confirmed NPQ: `manufacturer_strategy = "Detect from Specification"`, `approved_manufacturers_json = []`
- Specification names **five** manufacturers (Simplex, Siemens, Honeywell, Cisco, Bosch) as a reference list — **not** a mandate
- `Flash Scan®` / `CLIP` appear only in **detector** clauses and are protocols, which the engine deliberately refuses as a panel target
- The specification's own FACP clause says *"The manufacturer must specify the communication types and protocols used"* — i.e. the spec itself delegates the decision

**After that decision, in order:** record it as an approved compatibility requirement on the panel lines → regenerate profiles (new fingerprint) → run a **new** match run (do not reuse `matchrun_bd41090c…`) → re-evaluate safety → GOLDEN-2's governed approval route becomes usable → sizing producer advances.

**Still required and out of scope here:** a separate **Golden-fixture expansion** to add a control-panel BOQ line, and the 6 panel items with no linked requirements will need specification linking before they can match at all.

---

## Appendix — evidence limitations

- The confirmed NPQ profile was read directly; `manufacturer_strategy`/`approved_manufacturers_json` are first-class governed columns, not inferred.
- The five-manufacturer list is characterised as a *reference list* because it consists of bare country-suffixed lines (`"Honeywell – U.S.A."`) with no mandate language, and because a single-family mandate would not name four other manufacturers. This is an **inference from evidence shape**, and it is the judgement on which the STOP rests — a reviewer who can point to a specific governing clause mandating one ecosystem should overrule it and proceed.
- The specification's *"The manufacturer must specify the communication types and protocols used"* clause is quoted from extracted `original_text`; the surrounding clause context was not re-parsed clause-by-clause.
- Whether populating the target is best recorded as a compatibility requirement, a manufacturer constraint, or an NPQ update is deliberately **not** decided here — that is GOLDEN-4's first design question.
- Concurrent lanes were active throughout; findings are timestamped to the baseline above.
