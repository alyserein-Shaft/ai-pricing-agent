# GOLDEN-6 — Governed FACP Requirement Linkage Completion

**Slice scope:** Close the governed technical-requirement linkage gap across the seven main Fire Alarm Control Panel (FACP) BOQ items of the acceptance project (`project_c0123d91` — "Al Mousa School", 108 BOQ items): make requirement applicability **explicit, governed, auditable, and sufficient for downstream profile generation**, without fabricating completeness.

**Slice type:** Pure-domain policy + replica acceptance suite (GOLDEN-5 house style). No worker/API wiring, no live mutation.

**Closure verdict:** `CLOSED — GOVERNED FACP REQUIREMENT LINKAGE COMPLETION PROVEN` — see §15 for the exact live-application prerequisites and §14 for the questions that remain *application* decisions, not policy gaps.

---

## 1. Verification context and data provenance

- All live facts below were read from the local read-only D1 snapshot
  (`.wrangler/state/v3/d1/.../faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite`)
  opened with `DatabaseSync(..., { readOnly: true })`. **No write was issued to any live or replica database for this slice.**
- **Snapshot drift — concurrent lane, attributed, not repaired.** During this slice the concurrent 0016 spec-clause lane re-ran specification extraction and **superseded the v2 extraction** (`specextract_b6f37214-…`, previously current) with a **v3 extraction** (`specextract_b4b03333-…`, now current). All "approved current requirements" facts below are stated against the **canonical current view at write time** (see §3). This drift is *itself* a live demonstration of currency rule RULE-3.
- The replica fixture models item G truthfully as the live item (not the simplified GOLDEN-4/5 fixture shape): two **superseded Suggested** traces, **zero active Confirmed links**.

| Authority | Where |
|---|---|
| Canonical currency join | `worker/current-evidence-scope.mjs` `currentTechnicalRequirementSql` (:331; `version_number`/`id` NOT EXISTS, no `created_at`) |
| Eligibility predicate | `currentTechnicalRequirementEligibleForEngineeringPredicate` (:412) |
| Profile persist / supersede / idempotency | `worker/technical-requirement-api.mjs` `persistProfile` |
| Inputs (links as requirements) | `loadInputs` — consumed only when `status='Confirmed'` AND `superseded_at IS NULL` AND eligible |
| Readiness gating | `app/domain/technical-requirement-engine.mjs` `calculateReadiness` (:247) |
| Ecosystem decision machinery (reused, not duplicated) | `app/domain/fire-alarm-ecosystem-policy.mjs` — `ecosystemIsResolved`, `resolveFireAlarmEcosystem`, `RESOLVED_ECOSYSTEM_TARGETS`, `ECOSYSTEM_DECISION_STATES` |
| New governed applicability policy (this slice) | `app/domain/facp-requirement-applicability-policy.mjs` |
| Acceptance suite (this slice) | `tests/golden-6-facp-requirement-linkage.test.mjs` |

---

## 2. Deliverable 1 — Seven-item pre-GOLDEN-6 inventory (live, read-only)

One row per item, no aggregate collapse. Profile fields come from `requirement_profile_versions` (`profile` JSON, `readiness_status`, `input_fingerprint`); links come from `boq_requirement_links`.

| Seq | Item | BOQ Item ID | Description | Profile versions | Readiness (current) | `missingInformation` | `applicableRequirements` | Active Confirmed links | Historical links |
|---|---|---|---|---|---|---|---|---|---|
| 9 | G | `boqitem_e613397f-…` | "Main Fire alarm control panel with all required hardware, interfaces, cabling, and accessories, for connectivity to the FACP panels installed in the individual school buildings and Welcome center" | v1 (Classification Required, superseded 2026-09-20T19:56Z), **v2 current** | **Missing Critical Information** | `standard`, `compatibilityTarget` | 0 | **0** | 2 × **Suggested + superseded** (`req_314` SLC, `req_442` wiring — the only traces on the item) |
| 31 | K | `boqitem_6af90650-…` | "Fire alarm control panel with all accessories" | v1 current | **Missing Critical Information** | `standard`, `compatibilityTarget` | 0 | **0** | 0 |
| 53 | K | `boqitem_eb69f1a1-…` | "Fire alarm control panel with all accessories" | v1 current | **Missing Critical Information** | `standard`, `compatibilityTarget` | 0 | **0** | 0 |
| 74 | K | `boqitem_1f44b7de-…` | "Fire alarm control panel with all accessories" | v1 current | **Missing Critical Information** | `standard`, `compatibilityTarget` | 0 | **0** | 0 |
| 93 | D | `boqitem_4be2bb26-…` | "Fire alarm control panel with all accessories" | v1 current | **Missing Critical Information** | `standard`, `compatibilityTarget` | 0 | **0** | 0 |
| 100 | K | `boqitem_5fe70cc4-…` | "Fire alarm control panel with all accessories" | v1 current | **Missing Critical Information** | `standard`, `compatibilityTarget` | 0 | **0** | 0 |
| 107 | D | `boqitem_92ed49c3-…` | "Fire alarm control panel with all accessories" | v1 current | **Missing Critical Information** | `standard`, `compatibilityTarget` | 0 | **0** | 0 |

**Engine-governed per-item scope (from the current profile `boqItem`):** `system = "Fire Alarm"`, `category = "Control Equipment"`, `productFamily = "Fire Alarm Control Panel"` — identical for all seven items (raw `boq_items.category` is NULL in the snapshot; the governed classification lives in the approved understanding/engine view, which the fixture models).

**Pre-state finding (the gap):** across all 2+5+6×1 = 7 items there is **exactly one trace each only for item G, and both are superseded Suggested**. Zero governed Confirmed links exist; every profile's `applicableRequirements` is empty; `compatibilityTarget` and `standard` are missing on every current profile. There is nothing for downstream profile generation to consume.

---

## 3. Deliverable 2 — Applicability analysis over actual records

### 3.1 Live approved-requirement reality (canonical current view, write-time snapshot)

| Set | Count | Status |
|---|---|---|
| `technical_requirements` approved + `approved_for_downstream=1` in project | 60 | rows exist |
| …of which on the **current (v3)** extraction `specextract_b4b03333-…` | **1** (`requirement_197`, Electrical/Compliance clause) | **current eligible** |
| …of which on the **superseded (v2)** extraction `specextract_b6f37214-…` | 59 (the pre-drift "60 approved current" set) | **NOT current per canonical contract → cannot drive links** |
| v3 extraction rows by review state | 488 Needs Review, 24 Pending Approval, 1 Approved | mid-flight concurrent extraction |
| FACP-relevant clauses present in v3 (req_1, 59, 62–64, 70–71, 75, 82, 88, 91, 96–97, 107, 111, 113, 115, 118, 122, 133, 137–139, 154, 156–157, 160, 293, 295, 296, …) | present but **not yet `approved_for_downstream`** | not eligible today |
| `requirement_compatibility` rows for the project | **12, all `Needs Review`** (0 Approved) | **live ecosystem UNRESOLVED** |

**Consequences (all read-only observations, then policy statements):**

1. **Currency executes live (RULE-3).** The 59 approved rows on the superseded v2 extraction are *not* current evidence under the canonical `version_number`/`id` NOT EXISTS join. Plan-able requirements are exactly the current, eligible, approved rows — today **1**. The replica fixture mirrors this exact corner with `req-superseded` (v1 on a superseded extraction) → `NOT_APPLICABLE` (see §4).
2. **Ecosystem gate executes live.** With 12/12 compatibility rows in `Needs Review` and no governing decision recorded, `ecosystemIsResolved(...)` is false → the compatibility obligation may **not** propagate to any FACP item, and no synthetic/temporary compatibility target may be authored. This is precisely why all seven live profiles miss `compatibilityTarget`.
3. **Live policy execution result.** Running the real `planApplicabilityLinks` against the write-time eligible set (1 row, scope Electrical/Compliance, ecosystem unresolved, no governed evidence recorded):
   - classification for that pair across all seven items: **`INSUFFICIENT_EVIDENCE`** (no evidence base; explicit-scope fallback fails because govern-able scope is not `Fire Alarm`/`Control Equipment`), never a link;
   - the FACP clause set is **awaiting governed eligibility + governed evidence capture** (an application prerequisite, §14/#1–#3), so no further live pairs can honestly be classified today.

### 3.2 Replica applicability matrix (the proven decision surface)

The fixture carries 13 requirement rows across two extraction versions (12 in the current `sx1`, `req-superseded` in the superseded `sx-old`) in the base/unresolved shape, plus the ecosystem carrier `req-ecosystem` (current `sx1`) when seeded for the resolved shape — mirroring the live clause substance (see suite header). For each (requirement × item) pair the policy returns one of the four statuses; every `CONFIRMED_APPLICABLE` carries exactly one of the six governed evidence bases.

| Fixture requirement | Mirrors live clause | Governing evidence base | Result (resolved-ecosystem fixture) |
|---|---|---|---|
| `req-ecosystem` (carrier, child `rc-ecosystem`, fact `fact-ecosystem-basis`) | `req_296` peer-to-peer / require-compatible-family | `GOVERNED_ECOSYSTEM_DECISION` (only when resolved) | resolved → **CONFIRMED** × 7 (one requirement, seven links); unresolved → **NOT_APPLICABLE** + `propagationForbidden` (RULE_1B) |
| `req-facp-display` | `req_59` FACP switches/LCD | `SAME_EXPLICIT_SYSTEM_SCOPE` (governed extraction scope = Fire Alarm / Control Equipment) | **CONFIRMED** × 7 |
| `req-panel-software` | `req_82/84/380/381` panel software | `SAME_EXPLICIT_SYSTEM_SCOPE` | **CONFIRMED** × 7 |
| `req-network-panels` | `req_75` panels networked | `APPROVED_PROJECT_WIDE_REQUIREMENT` | **CONFIRMED** × 7 |
| `req-active` | `req_79` NFPA-72/75 + EN54 compliance | `APPROVED_PROJECT_WIDE_REQUIREMENT` | **CONFIRMED** × 7 (superseded twin never links) |
| `req-main-gui` | `req_337` color graphic terminal | `SAME_DRAWING_SYSTEM_REFERENCE`, `scopeItemIds=[panel-1]` | **CONFIRMED** on panel-1 only; **NOT_APPLICABLE** on 2–7 (RULE_9 subset excluded) |
| `req-slc` | `req_314` SLC, category Modules and Interfaces (CAS refused) | none (refusal retained) | **INSUFFICIENT_EVIDENCE** × 7 |
| `req-wiring` | `req_442` wiring, category Network | none | **INSUFFICIENT_EVIDENCE** × 7 |
| `req-voice` | voice-evacuation obligation | `EXPLICIT_BOQ_RELATIONSHIP`, `scopeItemIds=[]` (explicitly outside FACP) | **NOT_APPLICABLE** × 7 (same-system membership is never applicability) |
| `req-similar` | — (identical text to panels 2–7) | none | **INSUFFICIENT_EVIDENCE** × 7 — description similarity can never elevate status |
| `req-draft` | — | — (eligibility) | **NOT_APPLICABLE** × 7; also excluded even if wrongly linked |
| `req-rejected` | — | — | **NOT_APPLICABLE** × 7 |
| `req-superseded` | v2-extraction rows | — (currency) | **NOT_APPLICABLE** × 7 (RULE_3) |
| `req-ambiguous` | system/building Cause & Effect matrix (panel-wise) | none initially → `HUMAN_ENGINEERING_DECISION` (authority, why, scope) | **REQUIRES_ENGINEERING_REVIEW** × 7 → after recorded decision **CONFIRMED** × 7 |

**Classification coverage of "one requirement + six links vs six copies":** the six under-linked panels 2–7 each receive the same five shared links plus, only where evidence says so, item-specific ones; the same requirement row is never cloned — test-asserted (`COUNT(*)` on `technical_requirements` stays 1 per requirement after propagation, T4/T10/T13).

---

## 4. Deliverable 3 — Implementation (files)

| File | Shape |
|---|---|
| `app/domain/facp-requirement-applicability-policy.mjs` | Pure-domain, no DB. `FACP_APPLICABILITY_POLICY_VERSION = "facp-requirement-applicability-policy-1.0.0"`; `FACP_APPLICABILITY_STATUSES` (4); `APPLICABILITY_EVIDENCE_BASES` (6: `GOVERNED_ECOSYSTEM_DECISION`, `SAME_EXPLICIT_SYSTEM_SCOPE`, `SAME_DRAWING_SYSTEM_REFERENCE`, `APPROVED_PROJECT_WIDE_REQUIREMENT`, `HUMAN_ENGINEERING_DECISION`, `EXPLICIT_BOQ_RELATIONSHIP`); `APPLICABILITY_RULES` (RULE_1/1B/2…11); `ECOSYSTEM_RESOLVED_STATES` / `ECOSYSTEM_UNRESOLVED_STATES` (GOLDEN-5 mirrors); `ecosystemPropagationPermitted` (delegates to `ecosystemIsResolved`); `classifyRequirementApplicability`; `planApplicabilityLinks` (existing-link dedupe by `requirementId|itemId|versionNumber`). |
| `tests/golden-6-facp-requirement-linkage.test.mjs` | Replica suite, 13 `test()` blocks (T1–T13), full lifecycle proof, idempotency, lineage, blocker-specific honesty. |
| `scripts/test-classification-baseline.json` | Extended to **424 entries**; adds `tests/golden-6-facp-requirement-linkage.test.mjs|SAFE` (423 → 424). |

**Rule order (fail closed):** RULE_2 eligibility (Approved + `approved_for_downstream=1`) → RULE_3 `extractionIsCurrent` → ecosystem-carrier gate (resolved → CONFIRMED; unresolved → NOT_APPLICABLE + `propagationForbidden`, checked before any scope fallback) → RULE_10 ambiguity (REQUIRES_ENGINEERING_REVIEW, **unless a governed `HUMAN_ENGINEERING_DECISION` was recorded** — the decision is the instrument that resolves ambiguity) → evidence bases (drawing-ref / explicit BOQ relationship / human decision require non-empty `scopeItemIds`; `APPROVED_PROJECT_WIDE_REQUIREMENT` → all FACP items; `SAME_EXPLICIT_SYSTEM_SCOPE` → system+category match) → RULE_11 no-evidence fallback: `system===item.system && category===item.category` → CONFIRMED, else **INSUFFICIENT_EVIDENCE** (description similarity can never elevate).

**Governance mapping (decided layer, documented in the module header):** the four mission statuses are the *decision* layer that precedes link creation. Link creation then asserts the engine's existing `APPLICABILITY_STATUSES` conventions (`Confirmed` links + `status='Confirmed'`), which `loadInputs` consumes. The mapping is documented, not duplicated.

---

## 5. Deliverable 4 — Acceptance scenarios (§16) and negative assertions (§18)

All 16 acceptance scenarios and all 8 negative assertions are proven by the 13 green test blocks (mapping by content; §16/§18 indices are the mission's, reproduced by content here).

| # | Acceptance scenario (content) | Test(s) |
|---|---|---|
| 1 | Applicability derives from explicit drawing/system relationship only | T5, T3 |
| 2 | Genuine project-wide requirement confirmed across panel items | T7, T12 |
| 3 | Requirement attached to one panel only (drawing reference names a subset) | T5 |
| 4 | Identical description → no link | T1, T2 |
| 5 | Same-system membership → no link | T2 |
| 6 | Draft requirement → no link (+ excluded even when wrongly linked) | T2 |
| 7 | Rejected requirement → no link | T2 |
| 8 | Superseded version → no link | T2 |
| 9 | Re-planning idempotent (no duplicate links) | T8 |
| 10 | Resolved ecosystem propagates the single canonical compatibility requirement to all applicable items | T4 |
| 11 | Unresolved ecosystem → no propagation, blocked profile | T9 |
| 12 | Profile lifecycle: links appear in inputs, fingerprint moves, prior version superseded | T6 |
| 13 | Regeneration without input change is idempotent (fingerprint stable) | T8 |
| 14 | A linkage clears only the blocker it satisfies | T7 |
| 15 | Readiness is never forced (link count ≠ readiness) | T7, T13 |
| 16 | An old matching run stays pinned to its historical profile version | T11 |

| # | Negative assertion | Test(s) |
|---|---|---|
| 1 | No link from similar BOQ description | T1, T2, T3 |
| 2 | No link from same-system membership | T2 |
| 3 | No temporary/synthetic compatibility target (unresolved ecosystem) | T9 |
| 4 | Link count ≠ readiness; no "Ready for Matching" from links alone | T7, T13 |
| 5 | Old matching runs are never re-pointed after regeneration | T11 |
| 6 | No invented standard (no `requirement_standards` child exists; `standards: []` honestly reported) | T7 |
| 7 | No invented panel capacity/sizing (no capacity/loop/point/sizing attribute; compatibility target is the ecosystem *family*, never a panel model; zero sizing snapshots) | T7 |
| 8 | Engine excludes ineligible requirements even if wrongly linked; propagated requirements never cloned | T2, T4, T10, T13 |

**Result:** `node --test tests/golden-6-facp-requirement-linkage.test.mjs` → **13/13 pass** (see §10).

---

## 6. Deliverable 5 — Ecosystem propagation proof

- **Vocabulary and gate (T3):** the four statuses, the six evidence bases, and `ecosystemPropagationPermitted` over 4 unresolved + 5 resolved decision states, including the GOLDEN-5 Gamewell-FCI / Simplex routes (`RESOLVED_GAMEWELL_FCI`/`RESOLVED_SIMPLEX` carried via `EXPLICIT_PROJECT_ECOSYSTEM` + `compatibilityTarget` — never separate states). Resolved states always carry `compatibilityTarget`; unresolved states never do.
- **Propagation (T4, resolved Farenhyt fixture):** the single carrier requirement (`req-ecosystem`, with seeded parent row + child `rc-ecosystem` + `fact-ecosystem-basis`) plans **7 links, 1 requirement row** — never clustered/cloned. `technical_requirements` `COUNT(*)` for the id stays 1.
- **Profile effect (T6/T7):** after regeneration, `parsed.compatibility` carries the resolved family target (`compatibilityTarget` cleared from `missingInformation`), target is the **family** (`decision.compatibilityTarget`), never a model number; fingerprint moves; v2 supersedes v1.
- **No-propagation (T9, unresolved fixture):** 4 unresolved decision states → carrier classification `NOT_APPLICABLE`, `propagationForbidden: true`, `RULE_1B_UNRESOLVED_ECOSYSTEM_NO_PROPAGATION`, zero links, readiness stays **Missing Critical Information**. A synthetic carrier inserted anyway yields the same refusal and is never consumed (`loadInputs` requirements stay empty).
- **Live:** 12/12 `requirement_compatibility` rows are `Needs Review` (no governing decision) → the gate forbids propagation live. No compatibility target may be authored (§3.1/#2).

---

## 7. Deliverable 6 — Regeneration / fingerprint proof

Proven in T6 and T8 against the resolved fixture:

1. Pre-plan regeneration writes v1 for all seven panels (fingerprint `F1`).
2. Plan applies governed links; regeneration recomputes: `applicableRequirements` now populated from the Confirmed links; `input_fingerprint` changes (`F1 → F2`); `persistProfile` **supersedes** the v1 row (`superseded_at` set, verified by a fresh re-query of the historical row — never an in-place mutation) and writes v2 (`version_number = MAX+1`); the v2 row carries `superseded_at = NULL` and becomes the current profile.
3. A no-change regeneration (T8) returns `idempotent: true` with the same id, version, and fingerprint — no duplicate profile, no false profile change.
4. A re-plan (T8) plans **0 new links** (dedupe on the unique `(boq_item_id, requirement_id, version_number)` + `superseded_at IS NULL` active check).
5. In T10 the lifecycle is extended: v1 → v2 (auto-governed plan) → **v3** (recorded `HUMAN_ENGINEERING_DECISION`), each step superseding the prior.

---

## 8. Deliverable 7 — Old-run lineage proof

T11: an old `product_match_runs` row (`run-panel-1-old`) is seeded pinned to the pre-link profile (its `requirement_profile_version_id` and captured `input_fingerprint`). After governing links and regeneration (panel-1 v1 → v2):

- the old run **still** references the historical v1 id and the historical fingerprint — never re-pointed, never mutated;
- the historical v1 profile row still exists and carries `superseded_at` (verified by re-query);
- the new fingerprint differs from the historical one, so a **fresh matching run against the new profile is required** — old runs do not silently inherit new inputs.

---

## 9. Deliverable 8 — Final blocker matrix

Post-state (resolved-ecosystem governed plan applied to the replica; per item):

| Item | Blocker `compatibilityTarget` | Blocker `standard` | Resulting readiness | Link count (active Confirmed) |
|---|---|---|---|---|
| panel-1 (G) | **cleared** — arrived via the linked ecosystem requirement (family target) | **stays missing** — `standards: []`, no `requirement_standards` child exists, no capacity inference | **Ready with Warnings** | 6 (ecosystem, facpDisplay, panelSoftware, networkPanels, active, mainGui) |
| panels 2–7 (×6) | **cleared** | **stays missing** | **Ready with Warnings** | 5 each (ecosystem, facpDisplay, panelSoftware, networkPanels, active) |

- **Blocker-specific clearing (negative 6):** the compliance requirement (`req-active`, `APPROVED_PROJECT_WIDE_REQUIREMENT`) links yet does **not** clear `standard` — a link satisfies only the blocker it carries; linkage ≠ generic completeness.
- **Readiness honesty (negatives 4/7):** with `standard` missing and `standards` empty, `calculateReadiness` yields `overall < 80` → **Ready with Warnings**, deterministically **never** "Ready for Matching" with 36+ links in place. (T7/T13). "Ready for Matching" additionally requires an approved *standard fact* input — a governed input, not a link; intentionally not fabricated.
- **Unblockable rows:** SLC/wiring/voice/similar/draft/rejected/superseded remain **zero active Confirmed links** on every item (T12), exactly as the requirements demand.
- **No manual override, no suppressed blockers, link count ≠ readiness, ecosystem resolution alone ≠ readiness** (T1 asserts pre-state blocked even with a resolved ecosystem already recorded; T13 asserts ≥36 links yet no Ready-for-Matching).

---

## 10. Deliverable 9 — Files changed (this slice only)

| File | Change | State |
|---|---|---|
| `app/domain/facp-requirement-applicability-policy.mjs` | **new** — governed applicability policy (module §4) | untracked (worktree), no commit |
| `tests/golden-6-facp-requirement-linkage.test.mjs` | **new** — 13-block acceptance suite | untracked (worktree), no commit |
| `scripts/test-classification-baseline.json` | extended 423 → 424 (adds `…golden-6…|SAFE`) | worktree |
| `docs/GOLDEN-6-GOVERNED-FACP-REQUIREMENT-LINKAGE.md` | **new** — this document | untracked (worktree), no commit |

No other repository files were touched by this slice. (The many other modified files in `git status` belong to concurrent lanes — 0016 spec-clause, sizing, and pre-existing open work — attributed, not repaired.) Scratch read-only query scripts live outside the repo in the OpenCode temp dir.

---

## 11. Deliverable 10 — Full test results (this slice)

| Run | Result |
|---|---|
| `node --test tests/golden-6-facp-requirement-linkage.test.mjs` | **13/13 pass** (0 fail, 0 skip) |
| `node --test tests/golden-4-… tests/golden-5-… tests/golden-6-…` (trio) | **42/42 pass** — no interference with the closed GOLDEN-4/5 suites |
| `npx eslint app/domain/facp-requirement-applicability-policy.mjs tests/golden-6-facp-requirement-linkage.test.mjs` | **0 errors, 0 warnings** |
| Classification baseline registration | 424 entries; new test classified **SAFE** (no REAL_STATE / SPAWNS_PROCESS / MODULE_MOCKS flags) |

**Honest note on the drift gate:** the full `npm run test:all` drift gate was last run during the GOLDEN-5 slice: **classification PASS + 4114 tests / 4097 pass / 3 pre-existing failures** (boq-line-bom-summary ×2, review-workflow-atomic R8 ×1 — existing, unrelated to this slice) — it was not re-run in full here; the classification contribution of this slice (a new SAFE test + baseline entry) was validated directly via the authoritative inventory tool, which reports **424** entries including the new one. `npm run test:fire-alarm-golden` is a separate matching-engine release gate and is not coupled to new golden test files.

---

## 12. Deliverable 11 — Business-state write declaration

- **No live writes of any kind:** no D1 writes, approvals, links, profile regeneration, matching runs, deployments, or restarts were performed against the acceptance project, the `.wrangler` D1 snapshot, or any shared database. The snapshot was opened `readOnly: true` only.
- **All mutations in this slice are in-memory / temp-file replica fixtures** (`better-sqlite3`-style `:memory:` DBs built by the test suite, and scratch `.sqlite` files under the OpenCode temp dir).
- Because no profile/link state changed anywhere, **no business-state reconciliation or rollback is required** — the live tables are exactly as found (§2).
- No commit, push, deploy, or restart was requested or performed (working rules).

---

## 13. Deliverable 12 — Unresolved applicability questions (application decisions required, not policy gaps)

These are the governed inputs the process is designed to receive; none can be auto-invented, and none block the *mechanics*:

1. **Live eligibility of the FACP clause set.** The concurrent 0016 re-extraction superseded v2 and left the current v3 FACP clauses (req_1, 59, 62–64, 70–71, 75, 82, 88, 91, 96–97, 107, 111, 113, 115, 118, 122, 133, 137–139, 154, 156–157, 160, 293, 295, 296, …) in Needs Review / Pending Approval. Their governed review must complete before any live link can be planned from them (currency + eligibility are prerequisites by design).
2. **Governed evidence bases for the live rows.** For each live FACP requirement that will be linked, record on which of the six bases it applies to which of the seven items (drawing refs naming the main FACP only vs project-wide network/display/software obligations vs recorded human decision). None exists today.
3. **The live ecosystem decision.** 12/12 `requirement_compatibility` rows are Needs Review; the Farenhyt/Gent/Gamewell-FCI/Simplex decision route (GOLDEN-5) has not been taken. Until a governed decision exists, no compatibility target may be propagated — by design.
4. **Panel-wise vs building-wise Cause & Effect matrix scope.** The matrix obligation (`req-ambiguous` behavior) plausibly governs all seven panels; the governing evidence (drawing/system references, building scope) must be captured as a `HUMAN_ENGINEERING_DECISION` (or drawing/system basis) before confirmation.
5. **Standards fact.** `standard` is missing live on all seven items and is **not** a link-able input; an approved standard fact (governed input) is needed to move readiness past Ready-with-Warnings — this is a separate governed input lane, out of scope for linkage.

---

## 14. Deliverable 13 — Recommended next slice

1. **Live evidence capture fixture → live application run.** Once the concurrent extraction review completes, capture the six governed evidence bases against the real rows (a read-only "what would the plan be" dry-run artifact, then a governed apply), and re-run the seven-item inventory to show the real post-state.
2. **Standards fact lane.** Wire the approved-standard governed input so Ready-with-Warnings can legitimately advance to Ready-for-Matching without any link being treated as completeness.
3. **Authority/provenance surfacing.** Present `HUMAN_ENGINEERING_DECISION` requests (T10's `reviewPairs`) in the Engineer Decision workspace so the governed decision flow has a UI home; no worker changes required by the policy itself.
4. **Ecosystem decision execution.** Take the GOLDEN-5 decision for the acceptance project (or explicitly keep the unresolved posture) and record it, then let RULE_1 propagate.

---

## 15. Closure verdict

**`CLOSED — GOVERNED FACP REQUIREMENT LINKAGE COMPLETION PROVEN`**

The governed linkage mechanism for the seven FACP items is complete and proven end-to-end on a faithful replica: applicability is explicit (four statuses × six evidence bases), governed (eligibility + currency + ecosystem gate, fail-closed, similarity never a basis), auditable (evidence base + rule id + reason on every classification/link; links carry the canonical `(boq_item_id, requirement_id, version_number)` identity), and sufficient for downstream profile generation (inputs consumed, fingerprint moves, prior superseded, idempotent re-runs, old matching runs pinned, readiness honest). All 16 acceptance scenarios and 8 negative assertions are proven green (42/42 with GOLDEN-4/5, 13/13 slice suite, lint clean, baseline registered).

The six-item applicability gap is closed **as a governed capability with an established decision surface**; the live rows' applicability is deliberately deferred to governed evidence capture and the ecosystem decision (§13) — application prerequisites that mirror the GOLDEN-4/5 closure shape, not policy gaps. Nothing in the mechanism is open.