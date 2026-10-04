# AIU-4E — Product-Evidence Detection Gap Report

**Mode:** IMPLEMENTATION AUTHORIZED — NARROW DETECTION REPAIR
**Golden project:** Al Mousa School — Clean Golden Run (`project_ae501b85-9c12-4332-bf8e-787c90f2d388`)
**No commits, pushes, deploys, migrations, schema changes, restarts, AI runs, or engineer decisions.** AI Understanding is **not** declared CLOSED.

---

## 1. Executive Verdict

**AIU-4E is 🟢 CLOSED against all 10 completion criteria.** The 7 proven physical products are recognized, enter normal Understanding selection, and the 12 legitimate function obligations remain excluded. The fix is grounded in the Fire Alarm taxonomy's own governed vocabulary, not in arbitrary keyword expansion.

| Criterion | Status | Evidence |
|---|---|---|
| 1. 7 physical-product rows recognized | 🟢 | Golden: 7 found, **0 still data-quality excluded** |
| 2. They enter normal Understanding selection | 🟢 | all 7 → `CROSS_SYSTEM_EXPLORATORY`; `selectableNew 43→50` |
| 3. Grounded in canonical project/taxonomy evidence | 🟢 | `Firefighter Telephone` family + FFT-FPJ catalog product; `door contact` device context-noun |
| 4. False-positive protection proven | 🟢 | old-vs-new regex diff: **only the 3 intended phrases changed** |
| 5. 12 legitimate function rows remain excluded | 🟢 | residual excluded = exactly 12 (4+4+4) |
| 6. Merged/Rejected eligibility unchanged | 🟢 | B-7 |
| 7. No review/AI decisions fabricated | 🟢 | D-14; probe `run()` refused |
| 8. `BOQ_UNDERSTANDING_REQUIRED` no longer permanently unreachable for the 7 | 🟢 | they now obtain interpretations → satisfy `currentUnderstanding` |
| 9. Focused + adjacent regressions pass | 🟢 | 11 + 251 + 126 + 36 pass |
| 10. Golden validation non-mutating | 🟢 | read-only probe; 0 interpretations/reviews created |

---

## 2. Refreshed Baseline

Re-read before editing. **No baseline drift.**

The 7 target rows (all `system_value: Fire Alarm`, `unit: No`):

| BOQ item id (prefix) | ref | description | qty |
|---|---|---|---|
| `boqitem_b2113663…` | A | Fireman telephone jack | 24 |
| `boqitem_77cf1f90…` | N | Fireman telephone jack | 24 |
| `boqitem_9ead7b88…` | K | Fireman telephone jack | 19 |
| `boqitem_8df981dc…` | A | Fireman telephone jack | 6 |
| `boqitem_6ba1ade9…` | E | Door contact | 26 |
| `boqitem_90cd5824…` | H | Door contact Door contact | 24 |
| `boqitem_c91a2d1d…` | H | Door contact | 8 |

Baseline: eligible 82, attempted 20, notAnalyzed 62, unAnalysable 19, interpretations 26, review versions 0.

---

## 3. Root Cause

`genericProductEvidence` (`app/domain/boq-understanding-pilot.mjs`) only recognizes a row as product-bearing via four signals, one of which is `equipmentNoun` (`:47` before, `:84` after). The row had valid text, valid unit, positive quantity and a governed system, but **no evidence signal**, so `exclusionReasonsFor` pushed `No product, equipment, or material evidence` → `selectionLane = "DATA_QUALITY_EXCLUDED"` (`:357`) → never in `executable` (`:389`) → no interpretation → `currentUnderstanding` returns nothing → `executeProductMatching` throws `BOQ_UNDERSTANDING_REQUIRED` (`worker/product-matching-api.mjs:239`).

This is a **vocabulary gap, not a classification defect**: the governed family for one device already existed, and the other is already a registered device noun.

---

## 4. Fireman Telephone Jack Evidence

**It is physical equipment, and its canonical family already exists.**

- Canonical family: **`Control Equipment` → `Firefighter Telephone`** — `"Control Equipment": freezeList([... "Firefighter Telephone"])` (`app/domain/fire-alarm-taxonomy.mjs:20`).
- Governed aliases: `"fire fighter phone", "fire fighters handset", "remote handset", "telephone station", "fire telephone handset", "fire fighters telephone jack", "fire fighter telephone jack"` (`:169`).
- Backed by **four real catalog products**, explicitly including **FFT-FPJ "Fire Fighter Phone Jack"**, plus FFT-HSC, FFT-RHS, FFT-STSS (`:6-13`; real Opera line item at `scripts/regression-opera-block-fas.mjs:77-79`; expected family in `tests/golden/opera-block.fixture.mjs:67`).
- The real BOQ oracle records the line at `unit: "No"` (`tests/fixtures/clean-golden-boq-oracle.mjs:20`); the real Fire Alarm drawing legend reads **"FIREMAN TELEPHONE JACK"** (`tests/golden/ams-elv-legend-notes.fixture.mjs:3069`, `t00-review-proposals.fixture.mjs:591-614`).

**The gap is a spelling gap, not an identity gap:** the exact alias list covers `fire fighter(s)` and `fire telephone`, but not the real `fireman` spelling. Note the pack **deliberately rejects** bare `telephone` / `telephone jack` (office-phone collision, KX-AT7730; `:503-505`, `:519`) — which is why the fix is fire-qualified.

---

## 5. Door Contact Evidence

**It is physical equipment — but with deliberately no canonical family.**

- The pack separates it from interface functions explicitly: *elevator/HVAC/AHU/BMS interface* is **"function without hardware identity"** (`:498-500`, structured at `:515-517`), while *door contact / supervised input* is a **separate** bullet: **"no family; must not become Monitor Module without explicit device/function wording. Zero catalog presence."** (`:501-502`, structured `NO_PRODUCT_FAMILY` at `:518`).
- Registered as the **device context noun** `related("door-contact", "door contacts?|supervised inputs?")` (`:1187`) — i.e. the resolver already knows this noun, as distinct from the interface entries (`:1183-1186`).
- Project evidence treats it as a discrete device: a real Fire Alarm legend symbol **"DC" / "DOOR CONTACT"** (`tests/fixtures/drawing-architecture-fixture.mjs:186-199`, `ams-elv-legend-notes.fixture.mjs:3168`), at `unit: "No"` (`clean-golden-boq-oracle.mjs:15`).

**Consequence, and it is the correct one:** because it has no governed family, admitting it must yield **CROSS_SYSTEM_EXPLORATORY**, not GOVERNED_PRIMARY — so the AI can attempt it while the taxonomy's "must not become Monitor Module" guard continues to hold. That is exactly what Golden shows.

---

## 6. Exact Detection Change

**One file, one constant, one line of actual logic.**

`app/domain/boq-understanding-pilot.mjs` — `equipmentNoun` gained three bounded alternatives (plus an evidence-citing comment):

```
| fire ?(?:man|fighters?(?: s)?) telephones? (?:jacks?|handsets?)?
| fire telephones? (?:jacks?|handsets?)?
| telephone station
| door contacts?
```

**Why this over the alternatives:**

- **vs. "make the regex broader"** — it is not a generic widening. Both additions are fire-qualified or require the full device phrase, so bare `telephone` and bare `contact` are still not evidence.
- **vs. wiring `REQUIREMENT_FAMILY_VOCABULARY` into detection (option B)** — rejected: that vocabulary mixes `related()` CONTEXT_NOUN entries (`cables?`, `interface`, `telephones?`) and `ambiguous()` entries into the product-evidence signal, which would change lane behaviour for many unrelated rows (e.g. every cable row). That is a redesign, not a narrow repair.
- **vs. system-aware detection (option C)** — unnecessary: both rows are already `Fire Alarm`, and the added phrases are already fire-scoped, so no new system logic is needed.
- **vs. a taxonomy alias edit for `fireman`** — tempting, but it would only fix 4 of the 7 rows and would not fix Door contact, which has no family to alias into. Fixing detection fixes both device classes at the layer that actually excluded them.

**Not changed:** `genericProductEvidence`'s other three signals, `exclusionReasonsFor`, lane assignment, caps, fingerprints, the taxonomy pack, or any downstream gate.

---

## 7. False-Positive Protection

Rather than assert, I diffed the **old vs new regex** over every adversarial phrase:

| Phrase | old | new | verdict |
|---|---|---|---|
| Fireman telephone jack | ✗ | ✓ | **intended** |
| Door contact | ✗ | ✓ | **intended** |
| Door contact Door contact | ✗ | ✓ | **intended** |
| Telephone communication functionality | ✗ | ✗ | unchanged |
| Master telephone | ✗ | ✗ | **collision guard preserved** |
| Bare telephone jack | ✗ | ✗ | **collision guard preserved** |
| Isolated sets of form C contacts | ✗ | ✗ | unchanged |
| Integration with door system | ✗ | ✗ | unchanged |
| Contact client / contact person | ✗ | ✗ | unchanged |
| Signals to elevators with all required accessories | ✗ | ✗ | unchanged |
| Control of HVAC … interfacing with BMS system | ✗ | ✗ | unchanged |
| Control and monitor element … interfacing with access doors | ✗ | ✗ | unchanged |

**Exactly three phrases changed, and they are the three intended device lines.** No other input in the corpus changes behaviour.

**Two honest findings I did not paper over:**

1. `"Contact interface signal for integration"` and `"Door interface/control function"` are product evidence **both before and after** this slice, via the **pre-existing** `interfaces?` term. That is a separate, unrelated pre-existing detection question, deliberately not changed here. My initial test wrongly assumed these were caused by this slice.
2. `"Remote handsets for the intercom"` is admitted by the **taxonomy** (`buildTaxonomyContext` → `Firefighter Telephone`, `taxonomyFamilies=1`), pre-existing and independent of this change. Pinned by test C-11b so it is never later mistaken for AIU-4E work.

The authoritative taxonomy guards remain green: `p5-device-noun-family` ("door contact never becomes Monitor Module") and `r5-family-resolver` ("interface nouns never become Interface Module") — 36/36 pass, unchanged.

---

## 8. Manifest Before vs After

Read-only, live Golden:

| Metric | Before | After |
|---|---|---|
| eligible | 82 | 82 |
| GOVERNED_PRIMARY | 46 | 46 |
| CROSS_SYSTEM_EXPLORATORY | 17 | **24** (+7) |
| DATA_QUALITY_EXCLUDED | 19 | **12** (−7) |
| selectableNew | 43 | **50** |
| unAnalysable | 19 | **12** |
| next batch | 13 | 13 |
| runsRemaining | 5 | 7 (exploratory lane is now the bottleneck) |
| reviewDebt / analysisDebt | 20 / 0 | 20 / 0 (unchanged — no runs executed) |
| understandingComplete | false | **false** |

Invariant holds: `50 + 12 = 62 = notAnalyzed`.

**Affected 7 rows:** all moved `DATA_QUALITY_EXCLUDED` → `CROSS_SYSTEM_EXPLORATORY`. Lane assignment was **not forced**; the existing rules produced this.

**Residual legitimate non-product population = 12** — exactly the three interface/control groups, 4 each:
- `Control and monitor element … interfacing with access doors …` ×4
- `Control of HVAC equipment, smoke exhaust fans … BMS system` ×4
- `Signals to elevators with all required accessories` ×4

No unrelated excluded row changed.

---

## 9. Downstream Reachability

Not executed — proven statically only, at the detection/eligibility level.

The previous dead-end was: no interpretation → `currentUnderstanding` returns nothing (`worker/product-matching-api.mjs:58`) → `executeProductMatching` throws `BOQ_UNDERSTANDING_REQUIRED` (`:239`) → no candidate → no price → quotation-line blocker.

With these 7 now selectable, an ordinary governed run will persist an interpretation for each, which satisfies `currentUnderstanding` and removes that specific dead-end. The **APPROVED** requirement is untouched: `currentApprovedUnderstandingFacts` still returns facts only for `review.status === "APPROVED"` (`worker/estimator-understanding-review-api.mjs:196-200`), and no raw-BOQ matching bypass was introduced. A door contact may still legitimately resolve to no family — that is correct, and the row would then require engineer judgement rather than silently defaulting to `Monitor Module`.

---

## 10. Exact Files Changed

| File | Change |
|---|---|
| `app/domain/boq-understanding-pilot.mjs` | `equipmentNoun` += 4 bounded alternatives + evidence-citing comment. No other logic touched. |
| `tests/product-evidence-detection-gap.test.mjs` | **New** — 11 tests (A positives, B progression/eligibility, C false-positive, D regression). |

---

## 11. Tests Added / Changed

- **A (1–4):** all 4 "Fireman telephone jack" and all 3 "Door contact" variants (incl. the duplicated-description row) recognized.
- **B (5–7):** executable-lane membership equals exactly the 7 devices; `unAnalysable` equals exactly the function population; Merged/Rejected/`downstream=0` remain outside the AI-eligible population.
- **C (8–11, 11b):** all 7 function rows still excluded; contact-only prose, interface prose, and bare/master telephone wording all still non-evidence; `remote handset` pinned as taxonomy-resolved and pre-existing.
- **D (12–16):** six previously-recognized equipment types still recognized; `Form C contacts` still non-evidence; zero interpretations/review versions/events created.

---

## 12. Test Results

| Suite | Result |
|---|---|
| `product-evidence-detection-gap.test.mjs` (new) | **11/11** |
| Progression + completion + eligibility + pilot + boq-understanding battery | **251/251** |
| Status-policy, combined-detector, missing-contract, zero-confidence, review, auto-approval, revalidation, effective-interpretation, dashboard, presales, requirement-handoff, matching-authority | **126/126** |
| **Taxonomy device-noun / family-resolver guards** | **36/36** |
| Lint (`boq-understanding-pilot.mjs`, new test) | **0 problems** |
| Build | **Pass** — validated Sites artifact |

Two early failures were **my own test bugs** (a Set of id strings spread into the manifest instead of row objects; and two adversarial phrases that pre-existing `interfaces?` already matched), both diagnosed against the old-vs-new regex and corrected rather than papered over.

---

## 13. Golden Read-Only Validation

Probe opened the D1 with `{ readOnly: true }` and **refused `run()` and `batch()`**. No manifest preview endpoint was invoked, so no state could be written.

- 7/7 target rows found and reclassified out of exclusion; **0 still excluded**
- Residual excluded = 12 (4+4+4) legitimate function rows
- `selectableNew 50`, `unAnalysable 12`, `nextBatchSize 13`, `runsRemaining 7`
- No interpretations, runs, or review decisions created (interp count and review counts unchanged from baseline)

---

## 14. Graphify / Serena Verification

- **One product-evidence authority:** the added terms exist in exactly one `equipmentNoun` definition. Structural search finds the new phrases only there (plus comments); the taxonomy's `door contacts?` / `telephone station` entries are untouched and remain in the separate family-resolution layer.
- **No parallel workaround:** `buildBoqUnderstandingPilotManifest` still has exactly its three canonical consumers — `loadPilotManifest`, `loadUnderstandingProgression`, `handleEstimatorUnderstandingApi` (all `worker/estimator-understanding-api.mjs`). No new caller, no bypass.
- **Canonical path consumed:** the admitted rows flow through the same `genericProductEvidence → exclusionReasonsFor → selectionLane → executable` path as every other row, so no special-casing was introduced.
- **No downstream bypass:** `BOQ_UNDERSTANDING_REQUIRED` and the APPROVED-only facts gate are unmodified.

---

## 15. Remaining Blocker

**The residual 12 legitimate non-product/function rows still prevent completion, and this slice deliberately did not touch them.**

They remain inside the AIU-4A completion authority's `notAnalyzed` bucket (their `review.status` is `NOT_ANALYZED`; analysis debt is FAILED-only). Because `currentUnderstandingCompletion` requires `notAnalyzed === 0`, **Understanding cannot become complete while those 12 remain** — and they are not a bug to be "fixed" by admitting them to the AI, because they are lump-sum interface/control obligations, not products. Inventing an interpretation for them would fabricate engineering data.

They therefore need a **governed terminal outcome** (an explicit, audited, non-product / not-applicable disposition) rather than a detection change. This is exactly the separation AIU-4C-R identified and it is now the sole remaining blocker to truthful completion.

---

## 16. Exact Next Smallest Slice

# → AIU-4F — Governed Non-Product / Not-Applicable Understanding Outcome

Chosen from actual post-fix evidence, not by default:

- The 7 product rows are no longer stranded (AIU-4E closed).
- The 12 function rows **still keep `notAnalyzed > 0`**, so `currentUnderstandingCompletion` can never return true — proven, not assumed. Therefore **AIU-4D is not yet appropriate**: closing engineer review on the other rows would still leave a permanently-false completion.
- AIU-4F is the narrow slice that gives those 12 a governed, auditable terminal disposition so completion can become truthfully achievable — **without** fabricating an AI interpretation and **without** touching AIU-4A semantics beyond consuming a real terminal state.

**Not implemented.**

---

## 17. What Was Not Changed

- The 12 legitimate non-product/function rows: not made analyzable, not auto-rejected, not removed from eligibility, no terminal N/A status created, no completion semantics altered.
- No AIU-4A completion change, no NOT_APPLICABLE status, no full Golden progression, no engineer review, no auto-approval, no AIU-4B/4D.
- No broad taxonomy redesign: the Fire Alarm pack, its families, aliases, `NO_PRODUCT_FAMILY` records and family resolver are all byte-unchanged. No prompt/model/provider change, no matching-rule change, no `BOQ_UNDERSTANDING_REQUIRED` bypass, no pricing/quotation change, no R1 single-flight lock.
- No commits, pushes, deploys, migrations, schema changes, or restarts. Golden data verified unmutated.
- **AI Understanding is NOT declared CLOSED.**

**STOP.**
