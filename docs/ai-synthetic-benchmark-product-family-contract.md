# BOQ Benchmark — Product Family Contract Closure (T2)

Status: **VERIFIED** · Date: 2026-10-02 · Lane: synthetic benchmark harness only
Scope: `productFamily` scoring made production-authoritative; existing Lightning
36-case checkpoint re-scored with **no new provider calls**.

> Continuity note: this file exists because `.lore/EVIDENCE.md` was overwritten
> mid-session by another lane with an unrelated document (schema: snapshot
> validation), destroying the prior index and the T1 record. The authoritative
> home for this evidence is therefore `docs/`, per workflow §21.6. The index entry
> must be re-added by the continuity owner once the file is stable again.

---

## 1. Production productFamily contract

`productFamily` is a **closed, governed taxonomy field**, not free text.

- `app/domain/fire-alarm-taxonomy.mjs` → `FIRE_ALARM_TAXONOMY`: **52 families**
  across 7 categories (Detection Devices, Notification Devices, Modules and
  Interfaces, Control Equipment, Manual Initiation, Power and Batteries,
  Accessories).
- The engine prompt states: *"For Fire Alarm rows, use only a supplied governed
  category/family pair"* and requires `taxonomyCandidateKey` be returned exactly
  as supplied.
- Downstream resolution is `normalizeFireAlarmFamily` (exact alias) →
  `classifyFireAlarmFamilyFromText` (governed phrase match) →
  `isFireAlarmFamilySynonym` (declared synonym groups).
- `normalizeCategoryFamily` is applied to every model response before persistence.

Consequence: the benchmark's free-text `productFamily` measured something
production does not accept.

## 2. Benchmark contract decision

**Closed governed vocabulary, read live from production** — plus a deterministic,
production-backed equivalence layer for scoring.

- `PRODUCT_FAMILY_VOCABULARY` is derived from `governFamilyVocabulary()` at import
  time, never hand-copied. `verifyBenchmarkContract()` fails if the prompt's
  disclosed list and production's list ever disagree.
- Equivalence uses **only** production resolvers. No fuzzy threshold, no
  embeddings, no LLM judge, no benchmark-only alias table.

### Production's resolver is lossy — and that is the crux

| Input | `normalizeFireAlarmFamily` |
|---|---|
| `conventional smoke detector` | `Conventional Detector` |
| `conventional heat detector` | `Conventional Detector` |
| `Snd/Strobe assy.` | `null` (phrase match yields plain **`Strobe`**) |
| `optical smoke detector` | `null` (no optical family is governed) |
| `addressable optical smoke detector` | `Addressable Smoke Detector` |

So canonical form alone is **not** sufficient to decide equivalence. A
`DISTINGUISHING_TOKENS` veto blocks equivalence whenever the two raw forms
disagree on an engineering-meaningful token, applied *before* same-canonical
comparison. `optical` is deliberately **excluded** from that list because
production governs no optical family.

### The motivating case is REFUTED by production

`"Sounder Strobe"` vs `"Snd/Strobe assy."` **remains a real error.**
`normalizeFireAlarmFamily` returns `null`, the phrase match resolves to `Strobe`
— dropping the sounder — and `snd` appears in **no** governed phrase list. An
audible+visual appliance is not a visual-only one. The task suggested this "may"
be equivalent; production does not establish it, so no equivalence is granted.

## 3. Changes

| File | Change |
|---|---|
| `tests/fixtures/ai-synthetic/boq-family-equivalence.mjs` | **NEW** — `canonicalizeFamily`, `familyEquivalence`, `familyScoringVerdict`, `DISTINGUISHING_TOKENS`, `governedFamilyVocabulary` |
| `tests/fixtures/ai-synthetic/boq-benchmark-contract.mjs` | `PRODUCT_FAMILY_VOCABULARY` (read from production); 52 families disclosed in the prompt; `KNOWN_UNGOVERNED_GROUND_TRUTH_FAMILIES`; `lastProductFamilyAudit`; pre-flight check 5A |
| `tests/fixtures/ai-synthetic/boq-understanding-scorer.mjs` | `productFamily` scored via `familyScoringVerdict` instead of string equality |
| `tests/boq-family-equivalence.test.mjs` | **NEW** — 15 tests (A–F) |

**Production code was not modified.** `fire-alarm-taxonomy.mjs` and
`boq-extractor.mjs` are clean; `fire-alarm-family-taxonomy.mjs` is untracked
(pre-existing, not this slice).

### Three bugs I introduced and caught before shipping

1. **`"optical"` in the distinguishing list** — would have re-created the very
   over-strictness being removed.
2. **Synonym check ordering** — must run on *canonical* forms before the raw-token
   veto, or `call/point` vs `pull/station` fired the veto and separated a pair
   production explicitly equates.
3. **`familyEquivalence` reused for field scoring** — when *both* sides are
   UNKNOWN (the **correct** answer on 6 cases) it returned `equivalent:false` and
   scored correct unknown-preservation as a wrong field, breaking 36/36
   winnability. `familyScoringVerdict` now separates the two questions:
   *equivalence* = "same family?" (no, for two unknowns); *scoring* = "field
   right?" (yes). The `mustRemainUnknown`/`fabricatedFields` axis is what
   penalises a fabrication — conflating them double-counted one event.

## 4. Contract tests

`tests/boq-family-equivalence.test.mjs` — **15/15 pass**

- **A** alias/presentation variants are the same family (4 pairs + 4 presentation
  variants); `"Snd/Strobe assy."` explicitly asserted **not** equivalent
- **B** 8 materially different families stay distinct; scorer verdict matches the
  equivalence layer
- **C** UNKNOWN never equals a known family (7 unknown-ish forms); a model
  returning UNKNOWN for a stated family still loses the field
- **D** null/UNKNOWN equivalence is a *declared* contract decision living in one
  place (`isUnknown`)
- **E** addressing mode never normalised; 10 distinguishing tokens each proven to
  discriminate a real pair; `optical` proven **not** load-bearing
- **F** scored vocabulary **equals** production's, read not copied; ungoverned
  strings get no credit; synonym groups limited to production's declared ones; the
  known corpus gap is pinned; the prompt offers no invented family

## 5. Lightning re-score (before → after)

Existing checkpoint only. Semantic n = 33. Operational classes **unchanged**
(MODEL_RESULT 33, TIMEOUT 3). Latency/throughput/failure metrics untouched.

| Metric | Before | After |
|---|---|---|
| MODEL_RESULT | 33 | 33 |
| Timeouts | 3 | 3 |
| caseFullyCorrect | 3/33 | 3/33 |
| productFamily correct | 7/33 | 7/33 |
| fieldAccuracy (19 fields) | 0.8306 | 0.8306 |
| attributeAccuracy (excl. productFamily) | 0.9053 | 0.9053 |

**No metric moved.** The contract is now correct, but it was not the cause of the
low score. **The T1 hypothesis is refuted.**

## 6. ProductFamily error decomposition (26 previously wrong)

| Class | Count |
|---|---|
| `EXPECTED_UNKNOWN_ERROR` | **18** |
| `BENCHMARK_CONTRACT_ERROR` | **6** |
| `TRUE_CLASSIFICATION_ERROR` | **2** |
| `SEMANTIC_ALIAS_EQUIVALENT` | **0** |
| `ADDRESSING_MODE_ERROR` | **0** |

Genuine misclassifications are only SYN-U-011 (`"Snd/Strobe assy."` drops the
sounder) and SYN-U-021 (`"Sounder"` for a Sounder/Strobe).

**Lightning's real weakness is under-extraction** — UNKNOWN returned for a plainly
stated family in 18 of 33 cases. `attributeAccuracy` is low *solely* because
`productFamily` is inside it; excluding it the model scores **0.9053**.

## 7. NEW BLOCKER — 8 of 36 cases (22.2%) are unwinnable

Six ground-truth families name equipment production does **not** govern
(8 case-instances): `Addressable Detector`, `Multi Sensor Detector`,
`Loop Expander`, `Mounting Bracket`, `Door Holder`, `Fire Alarm Cable`.

The corrected contract is right to disclose only governed families, so it does not
offer these. A model cannot return `Loop Expander` as a family without inventing
it. Pinned in `KNOWN_UNGOVERNED_GROUND_TRUTH_FAMILIES`; the gate fails if the set
changes, so the gap cannot widen silently.

Not auto-corrected: rewriting ground truth to fit the taxonomy would be benchmark
gaming without human confirmation per mapping, and `Addressable Detector` has no
defensible canonical target because the vagueness *is* the case's point.

**T3 must not start as planned** — it would spend 10 calls producing ~2 more
unfair cases.

## 8. Test results

| Suite | Result |
|---|---|
| T2 focused (family + predicates + contract) | **47/47** |
| `tests/ai-synthetic-benchmark.test.mjs` | 33/34 (1 pre-existing) |
| `npm test` | **365/370**, 5 failures |

**`17d` proven independent**: merged-cell description inheritance yields
`description: null`. Reproduces with **no T2 module loaded** — only
`synthetic-xlsx-writer.mjs` + `boq-extractor.mjs`. Not this slice's.

**`npm test` 5 failures** are in `excel-export-review-scope` (2),
`pricing-scenario-authority` (1), `product-matching-engine` (2). Those files are
unmodified, import nothing from `fixtures/ai-synthetic`, and **zero of the 33
npm-test suites import any module changed in T2**. They belong to other lanes.
The previously recorded **520/520 no longer holds in the shared tree** — that
regression is not attributable to this slice.

## 9. Recommendations

1. **Human decision on the 6 ungoverned ground-truth families.** Either map each
   to a governed family with engineering justification, or drop `productFamily`
   from those cases. Do not guess: `Addressable Detector` is genuinely vague.
2. **Re-run Lightning after that decision.** Its current figures are trustworthy
   but 22% of the corpus is unfair to every model equally.
3. **Then** T3 (Super's remaining 10 cases) and T4 (Ultra).
