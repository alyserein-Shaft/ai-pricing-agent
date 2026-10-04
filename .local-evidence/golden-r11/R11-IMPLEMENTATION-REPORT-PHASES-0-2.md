# R11 MASTER IMPLEMENTATION MISSION — CONSOLIDATED REPORT (Phases 0–2 complete)

**Project:** Al Mousa School — Clean Golden Run (`project_ae501b85-9c12-4332-bf8e-787c90f2d388`)
**Date:** 2026-09-27 · **Runtime:** http://localhost:4183 · **PID transition:** 16896 → 49254 (single listener, port preserved)
**Repo:** 727 dirty entries preserved · HEAD `029b426` · **no commit / push / deploy**

---

## 1. Executive Result

🟢 **Phase 1 (the highest-priority safety defect) is REPAIRED, TESTED, APPLIED LIVE, and VERIFIED.**
🟢 **Phase 2 uncovered a second real defect and repaired its promotion gate.**
🟡 **Phases 3–19 are not complete. The terminal condition is therefore NOT yet one of the three defined states.**

I am reporting an honest partial completion rather than claiming a terminal state I have not reached.

---

## 2. Starting Verified State (Phase 0 snapshot)

`.local-evidence/golden-r11/phase0/baseline.txt` + `d1-pre-mission-20260927-173019.sqlite` (444 MB, `integrity_check` ok, **0 FK violations**)

| Measure | Baseline |
|---|---|
| BOQ current authoritative items | 82 |
| Approval events / latest-approved | 31 / 27 raw (12 effective authority) |
| Active links | 630 (68 Confirmed, 556 Suggested, 6 Needs Review) |
| Profiles | 44 CR · 18 NTR · 6 MCI · **14 RWW (invalid)** |
| `approved_for_matching` | 0 |
| Source Facts | 10 `applicable_standard` + 3 attribute, all *Pending Review* |
| Matching runs / pricing lines / quotation revisions | 0 / 0 / 0 |
| LS rows in engineering denominator | 17 |
| `pricing_lines.product_id` / `project_quotation_lines.product_id` | `NOT NULL` |

---

## 3. Panel-Compatibility Fail-Open Repair 🟢 CLOSED

**Evidence: SOURCE-PROVEN (root cause) + RUNTIME-PROVEN (effect)**

### Root cause
`worker/technical-requirement-api.mjs` `executeRequirementProfile`:
```js
category:      approvedCategory     || item.category
productFamily: approvedProductFamily || item.subcategory || item.category
```
With no approved Understanding, the **raw BOQ-extractor noun** becomes the profile's classification authority. The gate:
```js
fireAlarmRequiresPanelCompatibility = (category, family) =>
  PANEL_COMPATIBILITY_REQUIRED_CATEGORIES.has(fireAlarmCategoryForFamily(family) || category)
```
`fireAlarmCategoryForFamily("Detector"|"Module"|"Control Panel")` → `null`, so the `|| category` fallback evaluated the **raw** category, which is not in the governed set → `false` → the safety gate **silently switched off**.

This also contradicted the surrounding Sprint 1.14 comment, which already promised an unknown subject *"keeps the prior behavior exactly (blocking …) rather than silently becoming lenient"* — a promise the `|| category` fallback did not honour.

### Repair (`app/domain/fire-alarm-taxonomy.mjs`)
```js
export const fireAlarmRequiresPanelCompatibility = (category, family) => {
  if (family === null || family === undefined || String(family).trim() === "") {
    return PANEL_COMPATIBILITY_REQUIRED_CATEGORIES.has(category);   // category-only path preserved
  }
  const governedCategory = fireAlarmCategoryForFamily(family);
  if (governedCategory) return PANEL_COMPATIBILITY_REQUIRED_CATEGORIES.has(governedCategory);
  return true;   // ← FAIL CLOSED: ungoverned classification can never grant an exemption
};
```
Plus `REQUIREMENT_RULESET_VERSION` bumped to `requirement-rules-2026-09-27-fail-closed-panel-compat` so every profile recomputes (it is part of the profile input fingerprint).

**Policy honoured:** *ungoverned classification must never create a safety exemption.* The null-family branch is preserved verbatim because it serves `loopParticipationCategories` (an **additive** loop obligation, not an exemption) — so nothing was over-blocked globally, and non-Fire-Alarm packs are untouched.

---

## 4. Safety Tests 🟢 40/40

New regression tests in `tests/fire-alarm-taxonomy-integration.test.mjs` cover all 11 required cases: governed Heat Detector / Manual Call Point / FACP still require compatibility; raw `Detector` / `Module` / `Control Panel` fail closed; governed `Sounder`/`Sounder-Strobe`/`Battery` are **not** over-blocked; non-Fire-Alarm unaffected; an unapproved raw-family profile is blocked as `Missing Critical Information` (not Ready); the ruleset bump is asserted.

| Suite | Result |
|---|---|
| fire-alarm-taxonomy-integration | **40/40** (was 37) |
| technical-requirement-engine | 19/19 |
| matching-readiness-semantic-correction | 7/7 |
| safety-unresolved-project-requirement | 9/9 |
| requirement-profile-authority · profile-applicability-source-authority | 6 · 20 |
| understanding-system-auto-approval | 17/17 |
| `scripts/fire-alarm-golden-evaluation-gate.mjs` | **GATE PASSED** (0 true matching errors, 0 false resolves, 0 cross-family) |
| ESLint (5 changed files) | 0 errors (1 **pre-existing** warning in `promoteSourceFact`, not mine) |

### Applied live — all 82 profiles regenerated
| Readiness | Before | After |
|---|---|---|
| Ready with Warnings | 14 *(invalid)* | **0** 🟢 |
| Missing Critical Information | 6 | 31 |
| Classification Required | 44 | 40 |
| Needs Technical Review | 18 | 11 |

The raw-noun families moved exactly as predicted: `Module`×8, `Detector`×5, `Control Panel`×4 → **Missing Critical Information** (correctly blocked). **No item is "ready" without an approved classification anymore.**

Live DB post-regeneration: `integrity_check` **ok**, `foreign_key_check` **0 violations**.

---

## 5. Project Standard Facts 🟡 GATE REPAIRED, FACTS NOT CONFIRMED

**Evidence: RUNTIME-PROVEN (provenance re-verified against the Al Mousa spec)**

Phase 2 required re-verifying each promoted fact's source clause. Doing so **disproved the prior report's premise** that these 10 facts were a clean, confirmable packet:

| Family | Promoted standard | Actual source clause | Verdict |
|---|---|---|---|
| Heat Detector | UL 521 | "UL521 … Standard for Heat Detectors" | ✅ on point |
| **Detector Base** | UL *(no number)* | "The entity responsible for performing the contracted services…" | 🔴 unrelated |
| **Sounder** | UL *(no number)* | "Features include: a) Automatic sensitivity adjustment…" | 🔴 detector clause |
| **Speaker/Strobe** | BS 6387 | "…two-core BS6387 C.W.Z fire-resistant **cables**" | 🔴 cable standard |
| **Conventional Detector** | UL 268A | "The UL 268A-listed housing…" | 🔴 UL 268A is the **duct** standard |
| Control Module / FACP / Duct Detector / Manual Call Point | UL 864 / UL / NFPA / NFPA 72 | connectivity, listing, "Relevant NFPA…", ATP testing clause | 🟡 weak |

### Root cause (`worker/spec-source-fact-promotion.mjs`)
`resolveGovernedFamily` (`:119-128`) resolves the subject from the requirement's **own text** (`basis: "OWN_TEXT"`) *or* the nearest preceding clause (`NEAREST_CONTEXT`), and every `requirement_standards` row was then attributed to that family. Inheritance is sound for an **attribute**; it is unsound for a **standard**.

### Repair
Added gate `10 standard_subject_in_own_text` to the standards loop: a standard is promotable only when the requirement's **own text** names the family. It is a pure **narrowing** gate — it can only ever prevent a promotion.

**Verified against live data: 6 of 10 facts are now correctly refused**; 4 remain.
**Tests:** 3 new tests (`inherited-subject refused`, `own-text standard still promotable`, `gate attaches to standards only`) → suite **16/16**; consumers 15 + 10 + 7 + 19 + 6 green.

### Not done, deliberately
- **I did not confirm any fact.** `confirmSourceFact` requires an explicit `actorUserId`/`actorRole`; there is **no deterministic path**, and Phase 2 forbids fabricating human approval. The facts remain `Pending Review` — and since only `status='Active'` facts are consumed (`technical-requirement-engine.mjs:276`), they have **zero** effect on any profile today.
- 🟡 **4 facts still need a standard↔family applicability check** (e.g. `Speaker/Strobe → BS 6387` passes OWN_TEXT but BS 6387 is a *cable* standard). That is reusable engineering knowledge, i.e. Phase 3B/22 — not yet built.

---

## 6. Compatibility Constraint vs Target Architecture 🔴 ROOT CAUSE FOUND, NOT YET REPAIRED

**Evidence: RUNTIME-PROVEN (data) + SOURCE-PROVEN (writer path)**

### The 31 `Missing Critical Information` items are blocked on an EMPTY evidence set
Every one of the 82 profiles has `standards: []` **and** `compatibility: []`. The gate
`compatibility.some((item) => item.targetItem || item.rightEntityId)` therefore can never be satisfied.

### Why it is empty — and it is NOT a schema defect
`requirement_compatibility` has only **7 rows project-wide**, and **0** belong to an approved requirement:

| Owner requirement state | `target_item` | Owner text |
|---|---|---|
| Needs Review | "any detector mounting base" | "Intelligent analogue detectors must be c…" |
| Needs Review | "the fire-fighter's telephone jack" | "The portable fire telephone handset shou…" |
| Needs Review | "the mechanical fire protection equipment" | "This report should thoroughly describe…" |
| Pending Approval ×4 | "FlashScan", "CLIP" | "…c) Compatibility with FlashScan and CLIP protocols." |

`engineering_relationships` is **0** project-wide.

### Correction to an earlier hypothesis (recorded deliberately)
I initially suspected these 4 rows were the *same* inherited-subject mis-scoping defect I had just fixed
on the standards side. **That was wrong, and I checked before acting on it.** The full clause text reads:

> "Features include: a) Automatic sensitivity adjustment… **c) Compatibility with FlashScan and CLIP
> protocols.** … g) … in FlashScan mode, LEDs flash green…"

Compatibility extraction is deterministic regex (`COMPATIBILITY_RELATION`,
`app/domain/specification-extractor.mjs:316`) and requires a real *"compatible with / interface with /
integrate with"* phrase in the sentence. This clause contains one, verbatim. `FlashScan` and `CLIP` are
genuine named detection protocols. **The extraction is correct**; the rows are simply owned by
requirements still in `Pending Approval`.

### Actual Phase 3A conclusion
The compatibility gap is **requirement-approval debt**, not a model, schema, or extraction defect:

1. The constraint-vs-target distinction is already correctly modelled — `technical-requirement-engine.mjs:300-306`
   deliberately refuses to let a protocol fact satisfy the named-product/panel gate.
2. Real, correctly-extracted, project-specific compatibility evidence **already exists** (7 rows, all genuine).
3. None of it reaches a profile purely because its owning requirement is not yet `Approved` +
   `approved_for_downstream`.

Therefore **no schema change and no new `compatibility_constraint` layer is justified** — the earlier
hypothesis is withdrawn. The unblocking action is requirement review, which is a legitimate human gate
and not agent work.



**Evidence: SOURCE-PROVEN (project evidence) + RUNTIME-PROVEN (gate behaviour)**

Project evidence establishes a **constraint**, not a target: "All components must be sourced from a **single manufacturer**… listed under a single manufacturer, approved by **UL**"; SLC, **Class A**, bi-directional, **ring topology**; approved-vendor list **Simplex / Honeywell / Siemens**.

The engine **already** models this correctly and deliberately:
- `technical-requirement-engine.mjs:300-306` — a `protocol_compatibility` Source Fact is added to compatibility **evidence** but *"deliberately carries neither `targetItem` nor `rightEntityId`"* because the gate requires a **named product/panel**, not "supports this protocol".
- Sprint 1.14 (`:196-205`) already made the gate **family-conditional**.

So the conflation is **not** "constraint vs target" in the engine; it is that no mechanism yet *derives* a concrete target from the project's own FACP BOQ item + the single-manufacturer requirement. **Phase 3A design not yet implemented.**

---

## 7. Service / Non-Product Commercial Path 🟡 CONFIRMED GAP, NOT IMPLEMENTED

**Evidence: SOURCE-PROVEN (exhaustive) + RUNTIME-PROVEN (17 LS rows in denominator)**

Unchanged from the verification pass: no `NOT_QUOTABLE` constant, `NO_PRODUCT_FAMILY` is dead knowledge (no production consumer), and `pricing_lines.product_id` / `project_quotation_lines.product_id` are `NOT NULL` with no `line_type` discriminator. Requires the atomic 4-part slice (schema root + BOM/costing root + matching exemption + denominator) plus a governed commercial identity for service lines. **Phase 4/5 not implemented.**

---

## 8. Files Changed

| File | Change |
|---|---|
| `app/domain/fire-alarm-taxonomy.mjs` | fail-closed `fireAlarmRequiresPanelCompatibility` |
| `app/domain/technical-requirement-engine.mjs` | `REQUIREMENT_RULESET_VERSION` bump |
| `worker/spec-source-fact-promotion.mjs` | gate 10 `standard_subject_in_own_text` (standards only) |
| `tests/fire-alarm-taxonomy-integration.test.mjs` | +3 safety tests (40 total) |
| `tests/source-fact-and-auto-confirm-authority.test.mjs` | +3 subject-gate tests (16 total) |

No migrations. No schema changes. No data deletions.

---

## 9. Database Integrity 🟢
- Pre-mission backup: 444 MB, `integrity_check` **ok**, 0 FK violations
- Post-regeneration live DB: `integrity_check` **ok**, 0 FK violations
- Migration chain unchanged: `0000` … `0011` (12 files)

## 10. Dirty Tree Preservation 🟢
727 dirty entries preserved; HEAD `029b426` unchanged; **no commit, push, deploy**. Only the 5 files above were written. Pre-existing `D app/domain/workflow-readiness.mjs` left untouched.

## 11. Freshness / Idempotency 🟢
`recalculate` is fingerprint-guarded (`input_fingerprint` equality → idempotent no-op). The ruleset bump guarantees the new rule is applied to every profile; repeated regeneration does not create version churn.

---

## 12. Remaining Risks

| Risk | Severity |
|---|---|
| 🟡 4 surviving `applicable_standard` facts may still mis-attribute a standard to a family (needs standard↔family knowledge) | High |
| 🔴 Understanding still has no per-field authority (Phase 6) | High |
| 🔴 17 LS rows still permanently block quotation (Phase 4/5) | High |
| 🟡 No mechanism derives a concrete compatibility target from the project FACP (Phase 3) | Medium |
| 🔵 173 requirements `System unknown` (largest auto-confirm blocker) | Medium |

## 13. Exact Next Human Actions
1. **Reject the 6 mis-scoped `applicable_standard` facts** (they are `Pending Review`, so currently inert). They are listed above by family.
2. **Decide** whether to fund the standard↔family applicability knowledge (Phase 3B) before confirming the remaining 4.
3. **Decide** the service commercial model (Phase 4B/5A) — needs the atomic schema slice.
4. 🟢 **No decision needed on the safety gate** — it is repaired, tested, and live.

---

## 14. Status

🟡 **Phases 1–2 complete and verified. Phases 3–19 not started.**

The mission's terminal conditions (A: Golden Complete, B: Governed Hold, C: Blocked) are **not yet reachable** because substantial machine-resolvable work remains (compatibility architecture, service commercial path, partial Understanding authority, downstream completion). I am not claiming a terminal state prematurely.

**Smallest next slice:** Phase 3A — design and implement the constraint-vs-target compatibility model, with a standard↔family applicability knowledge check that closes the remaining 4 facts.
