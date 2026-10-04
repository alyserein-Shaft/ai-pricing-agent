# Deferred patch packets — stale-read audit (2026-10-03)

**Status: NOT APPLIED. Deliberately deferred to avoid overlap with active lanes.**

Source: read-only currentness / stale-read architecture audit.
Accepted conclusion: `NEW_FRESHNESS_FRAMEWORK_REQUIRED = NO`. The dominant defect
is **inconsistent consumption of mechanisms that already exist**
(`worker/current-evidence-scope.mjs`).

The one shared piece these packets need already exists as of this slice:
`documentVersionGoverningPredicate(versionAlias, documentAlias)` in
`worker/current-evidence-scope.mjs`. Every item below should reuse it rather than
re-derive the clause.

---

## Packet A — Drawing derived-state selectors (DEFERRED: Agent 1 owns drawing lane)

**Defect.** The *bytes* load is head-anchored (`JOIN document_versions v ON
v.id=d.current_version_id`), but the *derived* selectors choose "current" by
`document_id + superseded_at IS NULL + max(version_number)` only. If a document
gains a new version, the OLD intake / recognition / extraction stays "current"
until something supersedes that derived row.

| FILE | FUNCTION | CURRENT SELECTOR (verbatim shape) | MISSING | REUSE |
|---|---|---|---|---|
| `worker/drawing-intake-api.mjs` | `current` (line 19) | `WHERE document_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1` | `dv.document_version_id = d.current_version_id` | `documentVersionGoverningPredicate` |
| `worker/drawing-symbol-recognition-api.mjs` | `current` (46-52), exported `currentSymbolRecognitionVersion` (57) | same shape | same | same |
| `worker/drawing-symbol-recognition-api.mjs` | `currentIntake` (58-64) | same + `status='Completed'` | same | same |
| `worker/drawing-extraction-api.mjs` | `currentIntakeVersion` (60-61) | same shape | same | same |
| `worker/drawing-structural-parser-api.mjs` | `current`, `intake` (line 4) | same shape | same | same |
| `worker/drawing-architecture-review-api.mjs` | `currentIntakeForDocument` (158-159) | same shape | same (note: lines 97-102 and 143 ALREADY pin it — apply the same shape here) | same |
| `worker/drawing-candidate-comparison.mjs` | intake lookups (42-43) | two `document_id + superseded` lookups | same | same |
| `worker/drawing-legend-geometry-api.mjs` | structure/intake selectors (72,120,352,411,521,539) | `document_id + superseded` | same | same |
| `worker/symbol-cell-segmentation-api.mjs` | (72,119) | same | same | same |
| `worker/symbol-signature-matching-api.mjs` | (111,178,345) | same | same | same |
| `worker/drawing-quantity-evidence-api.mjs` | (174) | same | same | same |
| `worker/quantity-source-decision-api.mjs` | (119) | same | same | same |
| **`worker/specification-extraction-api.mjs`** | `currentExtraction` (36) | `WHERE document_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1` | same | same |

**Already correct — use as the in-repo reference implementation:**
`worker/drawing-architecture-review-api.mjs:97-102,143`
(`iv.document_version_id = d.current_version_id`).

**Known dead comparison.** `worker/fire-alarm-panel-sizing-api.mjs:409` sets
`documentCurrentVersionId: row.document_version_id` — the row's own value, so
`DOCUMENT_VERSION_CHANGED` can never fire from that input.

**Risk when applied.** Rows currently treated as current will begin reporting
stale. That is the intended correction, but it changes outputs, so it needs its
own slice with the drawing evidence re-baselined.

---

## Packet B — Duplicate currentness implementations (DEFERRED: active lanes)

Do **not** consolidate until the owning lanes finish. These are recorded so the
duplication is not rediscovered from scratch.

| FRAMEWORK A | FRAMEWORK B | DOMAIN | OVERLAP / INCONSISTENCY | SUGGESTED RESOLUTION |
|---|---|---|---|---|
| `matchRunStaleness` (`worker/product-matching-api.mjs:105`) | `candidateStaleness` (`worker/confidence-safety-api.mjs`) | matching vs safety | Same requirement-profile relationship, separate exports | One `profileScopedStaleness`; keep both call sites |
| `resolveUnderstandingCurrentness` (`app/domain/boq-understanding-currentness.mjs:149`) | `resolveEffectiveUnderstandingInterpretation` (`worker/effective-understanding-interpretation.mjs:53-71`) | understanding | Two independent implementations; the parallel one never calls the canonical resolver | Delete the parallel impl, route to the canonical resolver |
| `currentRequirementProfile` (`worker/requirement-profile-currency.mjs:14`) | local re-declaration (`worker/boq-line-decision-api.mjs:30`) | profiles | Re-declared locally with a narrower column subset | Import the shared helper |
| `CURRENT_PRICING_PREDICATE` (`worker/pricing-authority.mjs:3-12`) | `cost-buildup-model.mjs:19` (`=== "Costing"`) **and** `pricing-engine.mjs:21` (`!== "Discovery Only"`) | price eligibility | **Two different gates for the same price population** | One exported `isPriceEligibleForCosting` |
| `currentIntake` re-declared in ≥6 drawing modules | — | drawings | Identical SQL, no shared helper | One `currentDrawingIntake` — merge into Packet A |

**Advisory (fail-open) paths that should be reviewed, not merged:**
`ai-quotation-api.mjs:9` (`stale` never blocks) ·
`engineering-dossier-engine.mjs:590-593` (`invalidationImplemented: false`) ·
`engineering-fact-freshness.mjs` (advisory strings) ·
`commercial-line-presentation.mjs:29` (presentation-only).

**Suspected dead code, needs a runtime check (not done — read-only audit):**
`candidateStaleness` has no production importer found; `approvalIsStale`
(`worker/estimator-understanding-api.mjs:398`) is recorded in lore as a no-op.

**Also needs reconciliation:** `docs/DOC-R3-current-version-id-authority-audit.md`
and `tests/current-version-id-authority.test.mjs:56` reference
`documentVersionGoverningPredicate` in `boq-extraction-api.mjs`, and
`worker/specification-candidate-review.mjs:55` imports
`currentSpecificationExtractionFrom` — symbols that did not exist before this
slice. Verify the test's assertions now resolve against the real module.