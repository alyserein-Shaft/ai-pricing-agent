# AIU-4C-R — UnAnalysable & Final-Drain Reconciliation

**Mode:** READ-ONLY. Nothing implemented, no AI run, no approve/reject, no detection-rule change, no Golden mutation.
**Golden project:** Al Mousa School — Clean Golden Run (`project_ae501b85-9c12-4332-bf8e-787c90f2d388`)

---

## 1. Executive Verdict

**AIU-4C's "~83 review debt" was wrong. The correct figure is 63.** It was a double-count, now traced to its exact arithmetic. No prior count was assumed; everything below was recomputed from live source/runtime.

Two findings change the picture materially:

1. **The 19 `unAnalysable` rows are NOT one category.** They split 12 legitimate non-product/interface functions and **7 real physical products excluded only by a detection-regex gap**.
2. **`unAnalysable` is not governed.** It is an in-memory derived count with no persisted status, no human decision, and no audit evidence. My AIU-4C report described it as a "governed category"; **that wording was overstated and is hereby corrected.**

| Question | Verdict |
|---|---|
| Q1 final-drain arithmetic | max attempted **63**, final review debt **63**, final notAnalyzed **19** |
| Q2 unAnalysable composition | **12 non-product functions + 7 detection-gap products + 0 ambiguous** |
| Q3 completion interaction | 19 remain `NOT_ANALYZED`; **completion permanently impossible** until resolved |
| Q4 one category? | **No.** Operational selection state, not a governed terminal decision |
| R1 concurrency | Still true → **pre-scale reliability debt**, not a production blocker |

---

## 2. Refreshed Golden Counts

Recomputed read-only from live D1 + production selection code.

| Metric | Value |
|---|---|
| AI-eligible | 82 |
| attempted (current interpretations) | 20 |
| notAnalyzed | 62 |
| reviewDebt | 20 |
| analysisDebt | 0 |
| terminalReviewed | 0 |
| completion | **false** |

**Lane totals across all 82 eligible rows** (per-row classification through the real `buildBoqUnderstandingPilotManifest`):

| Lane | Count |
|---|---|
| GOVERNED_PRIMARY | 46 |
| CROSS_SYSTEM_EXPLORATORY | 17 |
| **DATA_QUALITY_EXCLUDED** | **19** |
| **executable-lane total** | **63** |

**Key measurement:** all 25 rows carrying any interpretation record sit **inside the 63 executable-lane rows**; **0** are in DATA_QUALITY_EXCLUDED. No excluded row has ever been attempted.

---

## 3. Final-Drain Arithmetic

**Equation before drain (current state):**
```
eligible 82 = selectableNew 43 + unAnalysable 19 + reviewDebt 20 + analysisDebt 0 + terminalReviewed 0
             43            + 19            + 20            + 0             + 0                  = 82  ✓
```

**Equation after draining all 43 selectable-new rows (no engineer decisions):**
```
attempted      20 + 43 = 63   (all executable-lane rows)
notAnalyzed    62 - 43 = 19   (the unAnalysable remainder — never reachable by any run)
reviewDebt     20 + 43 = 63   (every attempt awaits engineer review)
analysisDebt     0
terminalReviewed 0
completion     false          (blocked by notAnalyzed 19)
                19 + 63 = 82 ✓
```

1. **Maximum attempted population after full drain: 63.**
2. **Expected review-debt population after full drain: 63.**

---

## 4. "~83 Review Debt" Reconciliation

**Exact root cause: a double-count of the already-attempted rows.**

```
current reviewDebt (20) + executable-lane total (63) = 83
```

The 20 already-attempted rows **are themselves members of the 63 executable-lane rows** (measured: 25 interpretation-carrying rows, all 25 inside the 63, 0 in the excluded set). Adding current review debt to the *full* lane population therefore counts those 20 twice.

**Classification of the error: arithmetic/counting error** — specifically "counting attempts on top of a population that already contains them." It is **not** a typo, **not** ineligible/historical row inclusion, and **not** a future-population assumption.

**Correct increment:** `20 + 43 (selectableNew) = 63`.

| | value |
|---|---|
| Claimed in AIU-4C report | ~83 |
| **Correct** | **63** |
| Overstatement | +20 (exactly the pre-existing review debt) |

---

## 5. The 19 UnAnalysable Rows

Grouped by identical description and exact rule; all 19 are current, `approved_for_downstream=1`, with valid textual units, positive quantities and meaningful descriptions.

### Group A1 — Access/sliding-door/firefighting/HVAC control-and-monitor interface (4 rows)
- Description: `Control and monitor element as required for interfacing with access doors, sliding door, fire fighting and HVAC system for proper operation`
- Unit `LS`, qty 1 · system `Fire Alarm`
- Reason: `No product, equipment, or material evidence`
- Rule: final `!hasEquipmentEvidence` branch of `exclusionReasonsFor` — `genericProductEvidence` produced no signal

### Group A2 — HVAC / smoke-exhaust / duct-heater / BMS control interface (4 rows)
- Description: `Control of HVAC equipment, smoke exhaust fans, duct heaters and interfacing with BMS system`
- Unit `LS`, qty 1
- Reason: `Heading-like row`
- Rule: `genericHeading` alternative `.+\s+system` matches the trailing "system"; with an exclusion reason present the later evidence rule does not fire

### Group A3 — Elevator signal/interface function (4 rows)
- Description: `Signals to elevators with all required accessories`
- Unit `LS`, qty 1
- Reason: `No product, equipment, or material evidence`
- Corroboration: the taxonomy itself classifies elevator interfaces as **"function without hardware identity"** (`app/domain/fire-alarm-taxonomy.mjs:498-500, 515`)

### Group B1 — Fireman telephone jack (4 rows)
- Description: `Fireman telephone jack` · Unit `No`, qty 24-26 · system `Fire Alarm`
- Reason: `No product, equipment, or material evidence`
- Missing signal: `Recognizable equipment noun` — `equipmentNoun` contains neither `telephone` nor `jack`
- Notable: the taxonomy pack **does** register `fire fighter telephone jack` / `fire fighters telephone jack` (`fire-alarm-taxonomy.mjs:158-169`) but not the source phrase `fireman telephone jack`, so even the taxonomy-evidence fallback fails to rescue the row

### Group B2 — Door contact (3 rows)
- Description: `Door contact` (one persisted as `Door contact Door contact`) · Unit `No`
- Reason: `No product, equipment, or material evidence`
- Missing signal: `Recognizable equipment noun` — `equipmentNoun` contains neither `contact` nor `door contact`
- Notable: the taxonomy explicitly records `door contact / supervised input` as a **known family gap** with `NO_PRODUCT_FAMILY` (`fire-alarm-taxonomy.mjs:501-502, 518`)

---

## 6. Safe Non-Product vs Product Detection Gaps

| Class | Count | Evidence |
|---|---|---|
| **A — legitimate non-product/interface/function** | **12** | All `unit=LS`, qty 1, functional obligations. Taxonomy independently calls elevator interfaces "function without hardware identity". |
| **B — likely physical product missed by detection** | **7** | "Fireman telephone jack" ×4 and "Door contact" ×3 — named purchasable devices. Exclusion is caused **solely** by absent terms in `genericProductEvidence`/`equipmentNoun`. |
| **C — genuinely ambiguous** | **0** | — |

**The 7 B rows are not a judgment call about wording.** They name specific purchasable devices; the only reason they are excluded is that a detection vocabulary has no term for them. Two of the three groups are *already documented gaps* in the taxonomy pack itself, which is strong corroboration that these are real products the pipeline cannot currently recognise.

---

## 7. Completion Authority Interaction

**Post-AIU-4C population equation (verified):**
```
eligible = selectableNew + unAnalysable + reviewDebt + analysisDebt + terminalReviewed
    82   =     43       +     19       +    20      +      0       +       0
```

Answers:

1. **Are the 19 still counted as NOT_ANALYZED?** **Yes.** They pass the eligibility predicate, so `loadUnderstandingReviewRows` includes them, and `safeUnderstandingReviewItem` assigns `review.status = "NOT_ANALYZED"` (`worker/estimator-understanding-review-api.mjs:75-80`).
2. **Excluded from analysis debt?** **Yes** — analysis debt is FAILED-only. They are not debt; they are simply never attempted.
3. **Can Understanding ever become complete while they remain?** **No.** `currentUnderstandingCompletion` requires `notAnalyzed === 0`; the 19 sit inside `notAnalyzed` forever.
4. **Did AIU-4C add a governed terminal category for them?** **No.** This is the corrected finding. AIU-4C added only a **derived reporting count**.
5. **What is the category / what makes it terminal?** **There is none.** `unAnalysable: Number(manifest.excludedDataQualityCount || 0)` (`worker/estimator-understanding-api.mjs:672`) is a pure read of the in-memory lane count. `DATA_QUALITY_EXCLUDED` appears **nowhere** in any schema, migration, review status, or audit action. `buildBoqUnderstandingPilotManifest` performs no DB write. The only review statuses that exist are `AWAITING_REVIEW / APPROVED / REJECTED` (`drizzle/0060`). **No evidence or decision makes these rows terminal — nothing does.**
6. **Is completion permanently impossible once selectableNew reaches 0?** **Yes**, and this is now proven rather than assumed. After a full drain: `notAnalyzed 19`, `completion false`, permanently, with no governed path to change it.

**Which buckets prevent completion:** `notAnalyzed` (19 unAnalysable) blocks it absolutely; `reviewDebt` (63 after drain) blocks it until engineers decide.

---

## 8. Downstream Stranding Risk

| Stage | Disposition for a never-attempted excluded row | Evidence |
|---|---|---|
| Requirement Profile | **INCLUDED**, raw-BOQ fallback; drawing evidence omitted | `worker/technical-requirement-api.mjs:174-185` |
| Product Matching | **HARD-FAILED** `BOQ_UNDERSTANDING_REQUIRED` | `worker/product-matching-api.mjs:239` |
| — raw-BOQ matching fallback | **Exists but is unreachable** (the hard gate fires first) | `:240-246`; `app/domain/ai-product-ranking-engine.mjs:14-47` |
| Product Discovery / identity | **EXCLUDED** — no approved facts, no candidate | `estimator-understanding-review.mjs:100-140` |
| BOM expansion | **EXCLUDED** — no primary selection | `worker/boq-line-bom-api.mjs:100-114` |
| Pricing | **EXCLUDED** — requires a match candidate + safety decision | `worker/pricing-runtime.mjs:66-95` |
| Quotation | **FAIL-CLOSED, not silently omitted** — the row stays in the evidence manifest with null downstream records, and missing pricing for any current item blocks draft creation | `worker/quotation-evidence.mjs:12-30`; `worker/quotation-line-authority.mjs:146-154`; `worker/presales-workflow-api.mjs:51-66` |

**Decisive answer:** these rows are **hard-stranded in commercial scope, not silently dropped**. The safety property holds — the system will never quietly issue a reduced quotation that omits them, because every current BOQ item must have canonical pricing and the workflow requires full coverage. The cost of that safety is that the project **cannot become quotation-ready** while they are stranded.

**Visibility:** the 19 are individually visible in the AI Understanding review queue, but **mislabelled "Not analyzed"** — not "un-analysable" or "data-quality excluded". Only the pilot panel shows a data-quality count, capped at **2** examples (`boq-understanding-pilot.mjs:20`). The presales workflow does **not** surface them as stage blockers — Understanding blockers live only in the nested domain summary and never enter `workflow.blockers` (`presales-workflow-engine.mjs:20-37, 41-76`). So commercially they are effectively invisible, merely reducing coverage denominators.

---

## 9. R1 Concurrency Classification

**R1 remains true.** No single-flight lock exists: no `BEGIN IMMEDIATE` in the run path, no advisory lock, no leased item claim, no "non-terminal run exists" guard. The only reference to a single-flight lock in the run module is my own explanatory comment (`worker/estimator-understanding-api.mjs:806`).

**Classification: pre-scale reliability debt (non-blocking for correctness).** Evidence:

- **Not a data-integrity blocker** — `UNIQUE(boq_item_id, input_fingerprint, config_fingerprint)` makes duplicate interpretations impossible; the AIU-4C collision fix prevents the loser from stranding a run in `PROCESSING`.
- **Not a correctness blocker for the actual progression workflow** — sequential continuation is safe: the manifest is recomputed per request, attempted rows are excluded, and a stale fingerprint is rejected.
- **It is a cost/efficiency risk only** — two *simultaneous* submissions can each invoke the model for the same row before either persists, wasting provider spend on work whose result is then discarded. No incorrect data is stored.

**Escalation trigger:** becomes a production blocker only if concurrent continuation is expected (e.g. multiple operators, or an automated scheduler firing batches in parallel). At current single-operator, explicitly-confirmed batch size, it is acceptable deferred debt.

---

## 10. Decision Gate — the 19 rows

| Class | Count | Rationale |
|---|---|---|
| 🟢 **SAFE TERMINAL EXCLUSIONS** | **12** | `LS` interface/control **functions** (access/firefighting/HVAC interface ×4, HVAC/BMS control ×4, elevator signals ×4). Not purchasable products; correctly outside product Understanding. |
| 🟡 **DETECTION GAP** | **7** | "Fireman telephone jack" ×4, "Door contact" ×3 — real devices missed by `equipmentNoun`; two groups are already documented taxonomy gaps. |
| 🔴 **UNSAFE STRANDING** | **7** | *Same 7 rows.* Because matching hard-fails `BOQ_UNDERSTANDING_REQUIRED`, these real products can **never** reach matching, pricing, or quotation, and they permanently block quotation readiness — with no governed way to change that status. |

The 🟡 and 🔴 sets overlap: the detection gap is precisely what causes the stranding. The 12 function rows are safe because nothing purchasable is lost.

---

## 11. Exact Next Slice

# → B. AIU-4E — Product-Evidence Detection Gap

**AIU-4D (Golden Engineer Review Closure) is not yet the right next slice.** Its own precondition — "no real product rows are stranded" — is **false**: 7 real products are stranded and unresolvable through any governed path.

- Reviewing the current 20 (and later 63) rows would still leave 7 real products permanently unable to reach matching/pricing/quotation, and would produce a `completion: false` that no amount of review can ever clear.
- The detection gap is the **root cause** and is the smallest sufficient blocker to fix: it is a bounded, evidence-backed vocabulary question (7 rows, 2 distinct device terms) that has already been independently flagged in the taxonomy pack.
- AIU-4E should decide, on evidence, whether these rows are correctly non-products or correctly products requiring detection coverage — and if the latter, close the gap through a governed, reviewable change rather than a silent regex widening.

**Not implemented.** No repair performed in this slice.

---

## 12. What Was Changed

**Nothing.**

This reconciliation was strictly READ-ONLY: no source edits, no detection-rule or classification changes, no AI runs, no approve/reject, no Golden data mutation, no commits, pushes, deploys, or restarts. All counts were recomputed from live source and read-only runtime evidence; the prior "~83" figure was discarded rather than adjusted.

**STOP.**
