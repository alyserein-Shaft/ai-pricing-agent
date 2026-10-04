# MVP-BOM-5 PREP — Read-Only Preflight for Phases 9–13

**Mode: READ ONLY.** No production source, schema, migration, test fixture, or
business state was modified. Only this report was written.

---

## 1. Executive verdict

### `BLOCKED — QUOTATION SOURCE MODEL INCOMPLETE`

Not because SCOPE is hard. **SCOPE is the easy half.** It is blocked because
the **PRODUCT** half of the quotation source model is *already broken at
runtime* by the landed migration 0015, before any SCOPE work begins.

**The finding that must be acted on first:**

Migration 0015 added `source_type text NOT NULL` and `source_product_id text
NOT NULL` to `project_quotation_lines` **with no DEFAULT**. The existing
PRODUCT quotation draft INSERT at `worker/presales-workflow-api.mjs:124`
supplies neither. Executed against the real applied chain:

```
*** PRODUCT draft INSERT FAILS against landed 0015 ***
    NOT NULL constraint failed: project_quotation_lines.source_type
```

So **quotation draft creation is broken today for every product.** This is a
regression already introduced by 0015, not something P9–P13 causes.

**Why nobody noticed.** The draft INSERT is reached only by
`tests/e2e/golden-full-journey.spec.ts` (Playwright, live server + live D1). No
Node test drives `quotation/draft`, and Golden E2E is itself blocked upstream at
Quotation by `PANEL_SIZING_SNAPSHOT_REQUIRED`. The path has therefore never been
executed in any automated run. This is the same mock-boundary blind spot that
let the CLOSE-13 authority leaks survive.

P9 must fix the PRODUCT insert before it may add anything.

### Three further blocking findings, ranked

1. **Silent SCOPE line loss (§10).** The quotation fingerprint hashes
   `productId`/`quantity`/`netSellingMinor` but **no scope column**. Two SCOPE
   lines differing only in `engineering_scope_kind`/`system`/`source_role`/
   `source_fingerprint` produce an *identical* fingerprint, so the idempotency
   check at `presales-workflow-api.mjs:115` answers the second draft call with the
   first revision and **drops the line with no error**. Worse than a mismatch,
   because it loses a priced commercial line quietly.

2. **Silent pricing staleness hole, Agent 1's file (§9).** The currentness
   correlation `l2.boq_item_id = l.boq_item_id` appears in six places
   (`pricing-authority.mjs:11`, `pricing-api.mjs:298, 472, 620, 1141`, and the
   runtime idempotency lookup at `pricing-runtime.mjs:243`). In SQL
   `NULL = NULL` is `NULL`, never true — so for a SCOPE line the predicate
   **never matches** and a superseded SCOPE price is never detected as stale.
   Fails silently, in the pricing authority, before P9 ever runs.

3. **`source_fingerprint` has zero production readers (§11).** The BOM-4B
   currentness rule is documented and schematised but implemented nowhere. The
   per-line staleness definition in §11 is therefore currently unreachable.

**Good news, and it is the majority of the work:** the snapshot/export
*presentation* layer is largely source-agnostic already — `buildQuotationSnapshotRows`
does no BOQ join, `ORDER BY sequence,id` is source-neutral, the client presenter
needs no BOQ id, and the snapshot reconciliation is pure minor-unit arithmetic.
The export change set is genuinely small.

---

## 2. Current quotation call graph

```
POST /api/projects/:id/presales-workflow/quotation/draft
  worker/presales-workflow-api.mjs:48  handlePresalesWorkflowApi
    ├─ authenticateLibraryActor → resolveProjectAuthority → access()      [authority]
    ├─ loadPresalesWorkflowContext(db, project)                           :45
    │    ├─ collectProjectFacts
    │    ├─ pricingTotals()  → loadCanonicalPricingTotals()               :20
    │    │     worker/pricing-authority.mjs — CURRENT_PRICING_PREDICATE
    │    │     *** INNER-JOINS currentBoqEvidenceFrom("b") → PRODUCT ONLY ***
    │    ├─ buildQuotationEvidenceManifest(db, projectId)                worker/quotation-evidence.mjs:8
    │    │     ├─ currentBoqEvidenceFrom + currentBoqItemPredicate       → items[] BOQ-KEYED
    │    │     ├─ per BOQ: currentSelectedQuantity, requirement_profile_versions,
    │    │     │          product_match_runs, safety_decisions,
    │    │     │          safety_approval_requests, loadCanonicalPricingLine,
    │    │     │          pricing_approvals, review_queue_items
    │    │     └─ fire_alarm_panel_sizing_snapshots head
    │    │     → quotationEvidenceFingerprint(manifest)  app/domain/quotation-authority.mjs
    │    ├─ latestQuotation → quote = (latest.evidence_fingerprint === sourceFingerprint)
    │    └─ derivePresalesWorkflow → { readyForQuotation, readyForIssue, … }
    ├─ loadCanonicalQuotationLines(db, {projectId, scenarioId, currency})  :56
    │    worker/quotation-line-authority.mjs:191
    │    ├─ currentBoqEvidenceFrom + currentBoqEligibleForEngineeringPredicate → boqItems[]
    │    ├─ projectPanelSizingBlockers(db, projectId)                       :38
    │    │    └─ expansionCoverageBlockers  (BOM-4D; queries pricing_lines)
    │    └─ for (const boq of boqItems)  ← *** BOQ-DRIVEN LOOP ***
    │         ├─ loadCanonicalPricingLine({boqItemId})                     [currentness]
    │         ├─ pricing_approvals WHERE approval_type='Commercial Price'
    │         │    && entity_version === pricing.runVersion
    │         ├─ library_products + product_manufacturers
    │         ├─ currentSelectedQuantity(boq)                               [Stage 9 §5]
    │         └─ lines.push({boqItemId, sequence, itemNumber, description, unit, quantity,
    │                          candidateId, productId, manufacturerName, partNumber,
    │                          pricingRunId/Version, pricingLineId/Version,
    │                          pricingInputFingerprint, commercialApprovalId/Version,
    │                          currency, totalCostMinor, netSellingMinor, sourceSnapshot})
    │    ready = blockers.length === 0 && lines.length === boqItems.length   :349  ← *** PHASE F ***
    ├─ if (!ready) 409 QUOTATION_LINE_AUTHORITY_BLOCKED                      :62
    ├─ if (lineCount !== totals.lineCount || subtotal !== totals.subtotalMinor)
    │      409 QUOTATION_TOTAL_RECONCILIATION_FAILED                          :69
    ├─ quotationFingerprint = digest({ evidenceFingerprint, totals,
    │     quotationLineAuthority{ lines[{boqItemId, pricingRunId, …}] }, vat, terms })  :93
    ├─ quotationState(db, projectId, quotationFingerprint) → existing ⇒ 200 idempotent   :115
    ├─ persistSnapshot()  → presales_workflow_snapshots                      :119
    ├─ revision_number = MAX(revision_number)+1                               :120
    ├─ UPDATE project_quotation_revisions SET superseded_at WHERE status='Draft' AND superseded_at IS NULL
    ├─ INSERT project_quotation_revisions (status='Draft', …)                 :168
    ├─ INSERT project_quotation_lines × N   *** BROKEN AGAINST 0015 ***      :124
    └─ INSERT document_audit_events
```

Downstream: `quotation/approve` (`:240`) and `quotation/issue` (`:241`) both
CAS on `evidence_fingerprint = context.sourceFingerprint AND quotation_fingerprint
= payload.quotationFingerprint`, and issue additionally requires
`exportEligibleForQuotationIssue` against an `excel_export_jobs` row.

**Changed-vs-unchanged is decided by fingerprint identity alone — there is no
line diff.** `presales-workflow-api.mjs:43,115-117`:

```js
const quotationState = async (db, projectId, fingerprint) => hydrateQuotation(
  await db.prepare("SELECT * FROM project_quotation_revisions WHERE project_id=? AND quotation_fingerprint=? AND superseded_at IS NULL ORDER BY revision_number DESC LIMIT 1").bind(projectId, fingerprint).first());
…
if (existing) return json({ quotation: existing, idempotent: true });
```

A repo-wide search for `compareQuotation` / `quotationDiff` / `compareRevision` /
`lineDiff` returns nothing. **The fingerprint is the change detector**, which is
why §10 is load-bearing rather than cosmetic.

`worker/excel-export-api.mjs:70-89` re-derives the snapshot independently:
`project_quotation_lines` → `buildQuotationSnapshotRows` →
`reconcileQuotationSnapshotExport` → `quotationSnapshotFingerprintInput`
re-digest → `QUOTATION_FINGERPRINT_MISMATCH`.

---

## 3. BOQ-only assumption inventory

| # | Site | Assumption | Class |
|---|---|---|---|
| 1 | `quotation-line-authority.mjs:207-223` | Candidate population is `currentBoqEvidenceFrom` ∩ engineering-eligible. A SCOPE source can never enter. | **blocks SCOPE** |
| 2 | `quotation-line-authority.mjs:234` | `for (const boq of boqItems)` — the line set is BOQ-driven. | **blocks SCOPE** |
| 3 | `quotation-line-authority.mjs:235` | `loadCanonicalPricingLine({boqItemId})` — pricing currentness keyed only on BOQ. | **must become source-aware** |
| 4 | `quotation-line-authority.mjs:287-296` | `currentSelectedQuantity` on the BOQ row. No SCOPE analogue. | **must become source-aware** |
| 5 | `quotation-line-authority.mjs:349` | `ready: lines.length === boqItems.length` | **blocks SCOPE** — see §7 |
| 6 | `presales-workflow-api.mjs:99-110` | `quotationFingerprint` hashes `boqItemId` only; no scope identity. | **must become source-aware** |
| 7 | `presales-workflow-api.mjs:124-131` | 25-column INSERT; omits `source_type`, `source_product_id` and all six scope columns. | **ALREADY BROKEN** |
| 8 | `presales-workflow-api.mjs:70-84` | Reconciles line count/subtotal against BOQ-only pricing totals. | **blocks SCOPE** |
| 9 | `pricing-authority.mjs:3-17` | `CURRENT_PRICING_PREDICATE` inner-joins `currentBoqEvidenceFrom("b")`; `MAX(version_number)` correlates on `l2.boq_item_id = l.boq_item_id`. | **blocks SCOPE** — see §8 |
| 10 | `pricing-api.mjs:1132-1141` | Stale-line probe correlates `l2.boq_item_id = l.boq_item_id`. | **SILENT HOLE** — see §9 |
| 11 | `pricing-api.mjs:1208` | `buildLineCostModel({ itemId: runLines[0].boq_item_id })` | **blocks SCOPE** — see §9 |
| 12 | `quotation-evidence.mjs:32-34, 36` | Manifest `items[]` is built by iterating BOQ rows. | **blocks SCOPE** |
| 13 | `excel-export-api.mjs:50-51` | `quotationSnapshotFingerprintInput` maps `boqItemId: line.boq_item_id`. | **must become source-aware** |
| 14 | `excel-export-api.mjs:76` | `sourceSummary.pricingLineCount !== lines.length` — `pricingLineCount` is the BOQ-only pricing total. | **blocks SCOPE** |
| 15 | `quotation-line-authority.mjs:300` | `sequence: Number(boq.sequence)` | **must become source-aware** — see §5 |
| 16 | `excel-export-engine.mjs:117-131` | `buildQuotationSnapshotRows` | **SAFE ALREADY** — reads only line-snapshot columns, no BOQ join |
| 17 | `excel-export-api.mjs:72` | `ORDER BY sequence,id` | **SAFE ALREADY** — source-agnostic |
| 18 | `excel-export-engine.mjs:124` | `technicalApprovalStatus: "Approved"`, `safetyState: "Approved Quotation Snapshot"`, `approvalEligibility: "Eligible"` hardcoded for **every** snapshot row | **must become source-aware** — see §16 |
| 19 | `excel-export-engine.mjs:121-124` | `system` exists in `DETAILED_COLUMNS` but the row builder never sets it; `item_number`/`description` are nullable for SCOPE | **must become source-aware (presentation)** |
| 20 | `quotation-presenter.mjs:75` | client line `itemNumber: line.item_number \|\| null` — no fallback | **presentation-only** |
| 21 | `excel-export-api.mjs:24-36` | `loadCurrentExport*Version` / components / discounts all join on `b.id=l.boq_item_id` | **presentation-only** (non-governed modes) |

---

## 4. SCOPE quotation-line contract

Authoritative source for every field. **No field may be a placeholder or a
guessed BOQ value.**

| Field | Source for SCOPE |
|---|---|
| `project_id` | the sizing/engineering requirement's project |
| `source_type` | `'SCOPE'` (literal; CHECK-enforced) |
| `boq_item_id`, `candidate_id` | `NULL` by contract |
| `safety_decision_id` | `NULL` by design — **not** an omission |
| `engineering_scope_kind` | the sizing requirement's governed kind |
| `system` | the sizing requirement's governed system (CLOSE-15: only current governed requirements may drive it) |
| `source_role` | the expansion chain's role (e.g. loop expansion vs mounting unit) |
| `source_snapshot_id` | `fire_alarm_panel_sizing_snapshots.id` |
| `source_fingerprint` | that snapshot's `input_fingerprint` |
| `source_product_id` | the resolved expansion product, `= product_id` (substitution prohibited) |
| `product_id` | same; enforced by the table CHECK |
| `quantity` | the sizing requirement's `requiredExpansionQuantity` — **must be read from the snapshot, never the BOQ** |
| `unit` | snapshot/unit authority; **not** `boq_items.normalized_unit` |
| `description` | product description, or the snapshot's requirement text — an authoritative one of the two, chosen once and recorded |
| `manufacturer_name`, `part_number`, `product_description` | `library_products` + `product_manufacturers` join, exactly as the PRODUCT branch does |
| `item_number` | `NULL` — SCOPE has no BOQ item number. Presentation may render blank or a generated scope identifier (§14) |
| `sequence` | §5 |
| `pricing_run_id`/`_version`, `pricing_line_id`/`_version`, `pricing_input_fingerprint` | the current approved SCOPE `pricing_lines` row |
| `commercial_approval_id`/`_version` | `pricing_approvals` `Commercial Price`, `entity_version = runVersion` |
| `currency`, `total_cost_minor`, `net_selling_minor` | the SCOPE pricing line |
| `source_snapshot_json` | the sizing evidence: snapshot id/fingerprint, scope kind, role, per-panel derivation, the `requiredExpansionQuantity` that produced this quantity |

`safety_decision_id` is **not** in `project_quotation_lines` at all (it lives on
`pricing_lines`), so nothing here fabricates a safety decision.

---

## 5. Sequence policy

**Chosen: source-aware sequence allocation — PRODUCT lines in BOQ order, then
SCOPE lines in a deterministic scope order. Not timestamps, not insertion order.**

Evidence for the choice:

- `project_quotation_lines` has `UNIQUE(quotation_revision_id, boq_item_id)` and
  0015 added `quotation_lines_scope_uniq` on
  `(quotation_revision_id, engineering_scope_kind, system, source_product_id, source_role)`
  `WHERE boq_item_id IS NULL`. **The schema already encodes the grouping**: one
  row per scope identity per revision, several rows per product.
- `excel-export-api.mjs:72` reads `ORDER BY sequence,id` — already
  source-agnostic, so ordering is presentation-only downstream.
- `buildQuotationSnapshotRows` uses `line.sequence` purely as `lineNumber`.

Therefore:

- **PRODUCT first, SCOPE second.** Preserves every existing quotation byte-for-byte
  (PRODUCT sequences are unchanged), so P9 cannot regress any historical or
  golden output.
- **SCOPE ordering key**, in strict precedence, all deterministic and none
  wall-clock: `(engineering_scope_kind, system, source_role, source_product_id)`.
  This is exactly the 0015 unique-index tuple, so ordering is consistent with
  the schema's own notion of scope identity and can never reorder between runs.
- **Stable across retries:** a pure function of the scope-identity tuple, which is
  a function of current evidence. Same evidence ⇒ same sequence, so
  `quotationFingerprint` is unchanged and the existing idempotency check at
  `presales-workflow-api.mjs:115` still short-circuits.
- **Historically reproducible:** an old revision keeps its stored `sequence`
  values; the immedability triggers forbid rewriting them.

Rejected: timestamps/unstable sort (breaks fingerprint stability); interleaving
(perturbs PRODUCT sequences); a global re-allocation (needlessly invalidates
every existing quotation fingerprint).

---

## 6. Revision reconciliation

Current mechanism, verified: there is **no diff/reconciliation engine**. A draft
is created when `quotationFingerprint` differs from the stored one
(`quotationState` at `:115`); identical evidence returns the existing revision
`idempotent:true`. Superseding is a blanket
`WHERE status='Draft' AND superseded_at IS NULL`. Approved/Issued revisions are
immutable (guards + `quotation_line_snapshot_*_guard` triggers recreated after
the 0015 rebuild).

| State | New Draft? | Existing Draft | Approved/Issued | SCOPE line | Idempotency proof |
|---|---|---|---|---|---|
| **2×X → 3×X** (sizing quantity change) | Yes — snapshot fingerprint changes, so `source_fingerprint` changes, so `quotationFingerprint` changes | superseded | untouched | quantity re-derived from the **new** snapshot | fingerprint differs ⇒ not idempotent; retry at 3×X is |
| **3×X → 0** (requirement withdrawn) | Yes | superseded | untouched | line **disappears**; `quotation_lines_scope_uniq` no longer violated | same |
| **X → Y** (product changed by the sizing chain) | Yes | superseded | untouched | new `source_product_id`; old identity gone | same |
| **Provenance-only refresh** (same X, same qty, new snapshot fingerprint) | **Yes, by design** | superseded | untouched | same identity, new `source_snapshot_id`/`source_fingerprint` | the *snapshot* fingerprint is part of the quotation fingerprint, so a genuine re-sizing is a real change. **If** the snapshot `input_fingerprint` is stable, nothing changes and the retry is idempotent. **This is the key correctness property: the snapshot fingerprint, not the row id, decides.** |
| **Retry, identical state** | **No** | untouched | untouched | unchanged | `quotationFingerprint` equal ⇒ `quotationState` hit ⇒ `200 {idempotent:true}` |

**Historical quotation lines are never mutated.** Every revision is a new
immutable snapshot; the supersede only affects non-terminal `Draft` rows.

Open point for implementation: the blanket
`WHERE status='Draft' AND superseded_at IS NULL` is correct but coarse. It does
**not** need changing for P9 — it already behaves correctly in all five states.

---

## 7. Readiness / completeness

**Current behaviour, exactly:** `ready: blockers.length === 0 && lines.length === boqItems.length`
(`quotation-line-authority.mjs:349`), where `boqItems` is the engineering-eligible
current BOQ set. A single combined count cannot express PRODUCT + SCOPE.

**New semantics — conjunctive, never one combined count:**

```
ready = blockers.length === 0
     && productCoverage.complete      // every required PRODUCT source represented
     && scopeCoverage.complete       // every required SCOPE source represented
```

- **PRODUCT coverage is NOT weakened.** `productCoverage` is exactly today's
  rule: every `currentBoqEvidenceFrom` ∩ `currentBoqEligibleForEngineeringPredicate`
  item must have a canonical commercially approved line. Same blocker codes
  (`CANONICAL_PRICING_REQUIRED:<boqItemId>`, `COMMERCIAL_APPROVAL_REQUIRED:<boqItemId>`,
  `PRODUCT_SNAPSHOT_REQUIRED:<boqItemId>`, `CURRENT_SELECTED_QUANTITY_REQUIRED:<boqItemId>`).
- **SCOPE coverage** requires every current sizing requirement that
  `expansionCoverageBlockers` treats as needing commercial coverage
  (i.e. the exact product set already derived there) to have a current approved
  SCOPE pricing line. If a required scope product has no line →
  `CANONICAL_SCOPE_PRICING_REQUIRED:<scopeIdentity>`.
- The two sets are disjoint by construction (`boq_item_id IS NULL` vs not), so
  the counts cannot be conflated, and **neither count is allowed to compensate
  for the other** — that is the entire point of separating them.

Conjunctive, and each proved by its own set difference, so a project cannot pass
by over-covering one branch while under-covering the other.

---

## 8. Totals reconciliation

**Current:** `context.totals` = `loadCanonicalPricingTotals` (Phase G, §9 of
that module). `CURRENT_PRICING_PREDICATE` inner-joins
`currentBoqEvidenceFrom("b")`, so **SCOPE lines are invisible to it** — proven,
not assumed: the join is `b.id = l.boq_item_id` and a SCOPE line has
`boq_item_id = NULL`.

`presales-workflow-api.mjs:70-84` then requires
`lineAuthority.lineCount === totals.lineCount` and
`lineAuthority.subtotalMinor === totals.subtotalMinor`.

**Answers:**

- **Grouping:** by project + scenario, as today. Not by run, not by source, not
  by revision. Adding a source dimension would change the *meaning* of a number
  that is already persisted on every revision.
- **Duplicate inclusion?** No. A SCOPE pricing line is one `pricing_lines` row
  and, once the predicate admits it, contributes exactly once. There is no join
  fan-out: `pricing_lines l JOIN pricing_runs r` is many-to-one.
- **Can pricing totals contain lines not selected for quotation?** **Yes, and
  that is already true today and already reconciled.** The current rule is the
  strict equality above, which means *every* canonical approved pricing line
  must be in the quotation. That is a deliberate completeness property, not an
  accident. SCOPE must preserve it: a required scope product priced but not
  quoted is `QUOTATION_TOTAL_RECONCILIATION_FAILED` / a SCOPE coverage blocker,
  which is correct.

**Exact reconciliation formula (P10):**

```
productTotals = Σ net_selling_minor over current+approved PRODUCT pricing lines
scopeTotals   = Σ net_selling_minor over current+approved SCOPE   pricing lines
canonical     = { product: productTotals, scope: scopeTotals,
                   combined: productTotals + scopeTotals,
                   productLineCount, scopeLineCount, combinedLineCount }

quotation = { product: Σ PRODUCT quotation lines, scope: Σ SCOPE quotation lines,
              combined: … }

reconciled ⇔ quotation.product === canonical.product
          ∧ quotation.scope   === canonical.scope
          ∧ quotation.productLineCount === canonical.productLineCount
          ∧ quotation.scopeLineCount   === canonical.scopeLineCount
```

Branch-exact equality, so a mis-mapped branch cannot be masked by a compensating
error in the other. This requires the canonical totals function to become
source-aware (Agent 1's file) **or** a source-aware sibling to be added; it must
not be "fixing" the reconciliation by loosening it.

---

## 9. Commercial approval

**Run-level, confirmed.** `pricing_approvals` is keyed on `pricing_run_id NOT
NULL` with an **optional** `pricing_line_id`. The route inserts with
`approval_type='Commercial Price'` and no line id (`pricing-api.mjs:1262`).
`quotation-line-authority.mjs:246-264` matches on `pricing_run_id` and requires
`entity_version === pricing.runVersion`.

**Quotation approval is revision-level** (`project_quotation_revisions.status`,
`project_quotation_decisions`), gated on role by `canApproveQuotation(actorRole)`.

**No new approval type is required.** A SCOPE line needs the same run-level
Commercial Price approval; it is a *line* in an approved *run*.

**Can one commercially approved run containing PRODUCT + SCOPE feed a quotation
revision safely?** **Yes — with one required correction**, which is the reported
assumption:

```js
// worker/pricing-api.mjs:1208
const currentCostModel = await buildLineCostModel(env, {
  itemId: runLines[0].boq_item_id,   // <-- NULL for a SCOPE-only run
  userId,
});
```

For a run whose first line is SCOPE, `runLines[0].boq_item_id` is `null`, so the
cost-freshness assertion compares against a null cost model — a **false
success/failure**, not a crash, which is the dangerous shape. Correction: resolve
the cost model per line and aggregate, or scope the assertion to the PRODUCT
subset and treat SCOPE lines under the sizing-derived cost authority. **This file
is Agent 1's; it must be corrected in P6–P8 or handed over explicitly.**

**Second, subtler and higher risk — a silent hole Agent 1 must fix:**

```sql
-- worker/pricing-api.mjs:1132-1141  (stale-line probe)
AND l2.boq_item_id = l.boq_item_id
```

In SQL, `NULL = NULL` is `NULL`, never `TRUE`. For a SCOPE line
(`boq_item_id IS NULL`) the correlated subquery **never matches**, so a superseded
SCOPE pricing line is never detected as stale. The same `l2.boq_item_id = l.boq_item_id`
correlation exists in `CURRENT_PRICING_PREDICATE` (`pricing-authority.mjs:11`)
and at `pricing-api.mjs:298, 472, 620, 1141`. Every one of them must become
source-aware — e.g. correlate on the 0015 scope-identity tuple when
`boq_item_id IS NULL`. This is the highest-risk item in the whole wave because it
fails *silently*.

---

## 10. Evidence fingerprint

**Three independent fingerprints must change in lockstep** (§17).

**A. `quotationFingerprint`** — `presales-workflow-api.mjs:93-114`. Currently
hashes `boqItemId` per line. **SCOPE contribution required:** `sourceType`,
`engineeringScopeKind`, `system`, `sourceRole`, `sourceSnapshotId`,
`sourceSnapshotFingerprint`, `sourceProductId`, `productId`, `quantity`,
`unit`, `pricingInputFingerprint`, `pricingLineVersion`,
`commercialApprovalVersion`, plus the existing run/line ids and `netSellingMinor`.
`boqItemId` stays for PRODUCT and is `null` for SCOPE. **Deliberately excluded
as unstable presentation:** `description`, `manufacturerName`, `partNumber`,
`itemNumber` — a re-worded description must not invalidate a quotation, and
`buildQuotationSnapshotRows` already treats them as display fields.

**B. `quotationEvidenceFingerprint`** — over `buildQuotationEvidenceManifest`'s
manifest. The manifest is `{ authorityVersion, project, selectedPricingScenario,
currency, panelSizingAuthority, items[] }`, and `items[]` is BOQ-iterated. SCOPE
has **no representation at all**, so a sizing change that alters only SCOPE
scope would not move this fingerprint. Add a sibling `scopes[]` array built from
the same snapshot/requirement authority, carrying the same seven per-source
fields as `items[]` carries for a product, plus the scope identity and snapshot
fingerprint. `panelSizingAuthority.current` already carries the snapshot's
`input_fingerprint`, which gives partial cover — **but only if the snapshot id is
also compared**, since a new snapshot row for identical inputs must not silently
re-point the evidence.

**C. `quotationSnapshotFingerprintInput`** — `excel-export-api.mjs:38-62`. Reads
`line.boq_item_id` at `:51`. Must hash the same SCOPE fields as (A) so the
independent re-derivation at `:80` reproduces byte-identical input.

**D. The TEST ORACLE — a third, independent copy.**
`tests/quotation-snapshot-export.test.mjs:15-42` re-declares the *same payload
shape* with hardcoded `selectedScenarioId: "scenario-snapshot"` and hardcoded
`version: "quotation-line-authority-1.0.0"`. It must change in the same slice, or
the export suite passes while production is broken (or worse, the reverse).

**Two ordering hazards that make §5's policy mandatory, not cosmetic:**

- **Producer order** = `lineAuthority.lines` order = BOQ `sequence,id` only
  (`quotation-line-authority.mjs:221`, and `:300` copies `boq.sequence` verbatim).
  SCOPE has no BOQ sequence, so it needs an explicit policy.
- **Recomputer order** = DB read order `ORDER BY sequence,id`
  (`excel-export-api.mjs:71`). If a SCOPE `sequence` ever **collides** with a
  PRODUCT sequence, the tie is broken by `id` — a random UUID — which is
  **non-deterministic relative to producer order** and would fire
  `QUOTATION_FINGERPRINT_MISMATCH` on a perfectly correct quotation.
  §5's "PRODUCT first, then SCOPE in a disjoint block" eliminates collision
  entirely; a naive "assign sequence by row order" implementation would not.

**⚠ Silent data-loss interaction (highest-severity consequence of §10).**
Because the fingerprint hashes `productId`, `quantity` and `netSellingMinor` but
**none of the scope columns**, two SCOPE lines that differ only in
`engineering_scope_kind` / `system` / `source_role` / `source_fingerprint` would
produce an **identical** `quotationFingerprint`. The 0015 partial index
`quotation_lines_scope_uniq` would happily store both rows, but the second
draft-creation call hits `quotationState` at `:115`, is answered
`{ idempotent: true }` with the *first* revision, and the second SCOPE line is
**silently dropped** — no error, no warning, no blocker. This is worse than the
fingerprint mismatch, because it loses a priced commercial line without saying so.

---

## 11. SCOPE currentness

**Historical validity** and **current authority** must stay separate, exactly as
CLOSE-14 established for requirements.

An existing SCOPE quotation line becomes **stale** when any of:
- `source_snapshot_fingerprint` ≠ the current sizing snapshot's `input_fingerprint`;
- the requirement's `requiredExpansionQuantity` changed ⇒ derived quantity ≠ stored;
- `source_product_id` changed ⇒ the sizing chain now resolves a different product;
- `pricing_line_version` or `pricing_run_version` advanced for that source;
- `commercial_approval_version` ≠ the current run's approved entity version, or
  the approval is no longer `Approved`;
- the pricing line is no longer current under the source-aware currentness
  predicate (which must include the NULL-`boq_item_id` fix of §9).

**Historical approved/issued quotations stay reproducible** because the revision
is an immutable snapshot: `QUOTATION_EVIDENCE_STALE` (`excel-export-api.mjs:70`)
already refuses a *re-export* of a quotation whose evidence moved, and
`QUOTATION_STALE` (`presales-workflow-api.mjs:240`) already refuses *approval* of
a draft whose fingerprints moved. Both are correct and must be preserved. The
historical revision is never rewritten; a new Draft is created instead.

**There is no per-line staleness check anywhere.** A `project_quotation_lines` row
is never individually re-validated; staleness is a single project-level
`evidence_fingerprint` boolean (`presales-workflow-api.mjs:45`,
`quotationStale: Boolean(latest && !quote)`).

**⚠ The `source_fingerprint` currentness rule is not implemented at all.**
`l.source_fingerprint` / `pricing_lines.source_fingerprint` has **zero production
readers** — the only reference in the repository is
`tests/mvp-bom-5-migration-proof.test.mjs:273`, asserting it is null. The
BOM-4B rule (`source_fingerprint == current snapshot input_fingerprint`) exists
in the documentation and the schema but has **no enforcement anywhere**. The
manifest does carry the live panel-sizing head row
(`quotation-evidence.mjs:76-80`), so a superseded snapshot *does* move the
evidence fingerprint — but only project-wide, and **a SCOPE line's own
`source_fingerprint` is never compared against it**. P10 must implement that
comparison, or the per-line staleness definition above is unreachable.

Immutability already in place and safe (source-agnostic):
`quotation_line_snapshot_update_guard` / `_delete_guard` (dropped and recreated
around the 0015 rebuild) and `quotation_revision_payload_update_guard`, which
aborts any change to `quotation_fingerprint`, `evidence_fingerprint`,
`subtotal_minor`, `terms_json`, `source_summary_json`, `evidence_manifest_json`
or `terms_provenance_json`.

---

## 12. Expansion coverage

**There is no circularity, and the evidence is decisive.**
`expansionCoverageBlockers` (`quotation-line-authority.mjs:143-…`, repaired in
BOM-4D) queries **`pricing_lines`**, not `project_quotation_lines`. Its only
caller is `projectPanelSizingBlockers` (`:232`), whose only caller is
`loadCanonicalQuotationLines` (`:191`), whose only caller is the quotation draft
route (`presales-workflow-api.mjs:56`). So the chain is:

```
sizing snapshot ──> SCOPE pricing_lines ──(coverage satisfied)──> quotation line
```

Coverage is satisfied by **pricing**, and the quotation line is a strictly
downstream consequence. The feared cycle does not exist.

**Final coverage rule — option 1 only:**

> Expansion coverage requires **valid current approved SCOPE pricing lines for
> every required expansion product**. It does **not** require a current
> quotation SCOPE line.

Requiring a quotation line would recreate exactly the cycle the brief feared.
Note this also means coverage is already satisfied *before* the quotation exists,
which is the correct stage distinction: pricing establishes commercial
representation; the quotation is the commercial instrument.

---

## 13. Double-count handling

**Finding: no existing mechanism exists.** A repo-wide search for
`OVERLAP` / `DUPLICATE_PRODUCT` / `DOUBLE_COUNT` returns only BOQ-item duplicates
and drawing-legend spatial overlap — both unrelated. The nearest commercial
neighbour is `boq_requirement_links`, keyed `(boq_item_id, requirement_id)`, which
is per-item and so cannot express "same product on two different sources".

| Case | Behaviour | Rationale |
|---|---|---|
| 1. Expansion X only | **separate**, one line per scope identity | 0015 `quotation_lines_scope_uniq` |
| 2. X required across multiple panels | **aggregate into one line** | 0015's unique key has no panel, so multiple panels resolving to X collapse to one identity; the quantity sums. This is *enforced by the schema*, not by convention |
| 3. BOQ PRODUCT X + sizing SCOPE X | **REVIEW — never merge** | different source branches; merging would hide a genuine double-supply and destroy PRODUCT completeness accounting |
| 4. Accessory X + expansion X | **separate** | different `source_role` ⇒ different 0015 identity |
| 5. Two independent engineering SCOPE sources require X | **separate** unless the identity tuple is identical | different `engineering_scope_kind`/`source_role` ⇒ distinct identities by construction |
| 6. One product legitimately serving two roles | **separate** | exactly what `source_role` exists to express |

**Smallest deterministic review blocker for case 3.** Reuse the existing
`boq_requirement_links` + `engineering_knowledge_conflicts` precedent rather than
inventing a system, and — critically — **do not block**: emit a review blocker.

```
SCOPE_PRODUCT_OVERLAP_REVIEW:<scopeIdentity>:<boqItemId>
```

- Severity/reason modelled on the existing `sourceFactConflictEntries` pattern in
  `technical-requirement-api.mjs` (`resolutionStatus: "Open"`, `blocking`).
- **Non-blocking.** PRODUCT completeness and SCOPE coverage are each still
  satisfied independently; the overlap is surfaced for a human, because
  auto-deciding "these are the same physical item" is a commercial judgement with
  no governed evidence behind it.
- Deterministic and stable: derived from the quotation line set itself, so it
  recomputes identically on retry and cannot oscillate.

---

## 14. Snapshot behaviour

`buildQuotationSnapshotRows` (`excel-export-engine.mjs:117-131`) is **already
source-agnostic** — it reads only `line.sequence, item_number, description, unit,
quantity, manufacturer_name, part_number, product_description, currency,
total_cost_minor, net_selling_minor, pricing_run_version`. **No BOQ join, no
`boq_item_id`.**

SCOPE therefore renders correctly **provided the line carries correct values**:
description, part number, manufacturer, unit, quantity, currency,
`totalUnitCost`/`totalLineCost`, `netSellingUnitPrice`/`netSellingTotal`, VAT
allocation, `finalLineValue`. All of these already come from the immutable line
snapshot. **No change is required to the row builder.**

`item_number` will be `null` for SCOPE → `safeExcelText(null)` → blank cell.
Acceptable, because the line is already identified by
`part_number` + `description` + `lineNumber`. If a visible scope identifier is
wanted, generate a deterministic one at draft time (e.g. `SCOPE-<kind>-<n>`) and
store it in `item_number` — presentation-intent, not a fabricated BOQ number.

VAT allocation uses `allocateMinor(revision.vat_minor, lines.map(net_selling_minor))`
— order-dependent but deterministic given `sequence`, which §5 makes stable.

---

## 15. Excel / export behaviour

**Governed quotation export** (`GOVERNED_EXPORT_MODES` →
`loadQuotationSnapshotExportData`): **must and will include SCOPE** once the lines
exist, because it selects `FROM project_quotation_lines WHERE quotation_revision_id=?`
with no source filter. Required change: the `pricingLineCount` equality at
`excel-export-api.mjs:76`, and the fingerprint of §10C.

**BOQ/SOD engineering worksheet** (`loadExportData` non-governed branch): may
legitimately remain BOQ-only **provided** it is clearly labelled as a
technical/engineering worksheet and its totals do not silently omit commercial
scope. Today it is BOQ-joined (e.g. `pricing-api.mjs:287`), so it already is such
a worksheet; the requirement is a label, not a code change.

**No approval warning is emitted for the governed quotation export** —
`technicalApprovalStatus: "Approved"`, `commercialApprovalStatus: "Approved"`,
`safetyState: "Approved Quotation Snapshot"` are all hardcoded from the fact that
the revision is approved (`excel-export-engine.mjs:124`). So a SCOPE line with
`safety_decision_id IS NULL` will **not** display a misleading
"Missing Technical Approval" there. See §16 for the one place that *does* need
attention.

---

## 16. Engineering provenance representation

**Corrected on deeper trace.** An initial reading graded
`buildQuotationSnapshotRows`' hardcoded approval literals as safe. They are not.
This is the highest-risk single item for P12–P13.

```js
// app/domain/excel-export-engine.mjs:124 — applied to EVERY snapshot row,
// regardless of source_type:
technicalApprovalStatus: "Approved",
commercialApprovalStatus: "Approved",
safetyState: "Approved Quotation Snapshot",
technicalStatus: "Approved Quotation Snapshot",
complianceStatus: "Approved Quotation Snapshot",
approvalEligibility: "Eligible",
```

A SCOPE line has `safety_decision_id IS NULL` **by design** and never had a
safety decision or a Technical approval. The governed export would therefore
assert, silently and without error, that a SCOPE line has
`Technical Approval Status = Approved`, `Approval Eligibility = Eligible`, and
`Safety State = Approved Quotation Snapshot` — **approvals that never happened**.
It propagates to the `Technical Compliance` sheet
(`worker/xlsx-cost-sheet.mjs:35`), which renders `technicalStatus`,
`complianceStatus`, `safetyState` and `technicalApprovalStatus` verbatim.

This is the exact failure mode the brief warns about: not a crash, but a
**governed export that is silently wrong rather than fail-closed**. The reader
tolerates `boq_item_id IS NULL` structurally (`SELECT *`, no BOQ join) and
emits no warning, because `warningForRow` only fires when
`technicalApprovalStatus !== "Approved"` — and it is always `"Approved"`.

**Required, source-aware:**

- **PRODUCT rows:** unchanged literals. A PRODUCT line genuinely did pass
  Technical approval.
- **SCOPE rows:** must not claim a safety or Technical approval. The truthful
  authority is the **completed sizing snapshot** pinned by `source_snapshot_id`
  + `source_fingerprint`, which is already carried on the line but is **read
  nowhere in the export path**. Render sizing provenance, e.g.
  `Scope Engineering Authority — Sizing Snapshot <id> (<fingerprint prefix>)`,
  and set `safetyState` / `technicalStatus` to a scope-specific value that
  names that authority rather than implying a safety decision.
- **Never fabricate** a `safety_decision_id`, a `safety_approval_requests` row,
  or an "Approved" safety state for a SCOPE line.
- **Never leave it blank either** — a blank technical-approval cell reads as
  *missing* authority, which is equally untrue. The cell must state the real
  authority.
- `warningForRow` must not fire for SCOPE rows on the governed path (it will not,
  provided the value is not `"Approved"` only if the check is also made
  source-aware — **check this explicitly**, because naively changing the literal
  to a scope value would trip `Missing Technical Approval` and hard-block the
  approved sheet via `validateExportReadiness` → `APPROVED_EXPORT_WARNINGS_BLOCKED`).
  This is the trap: the obvious fix breaks the export, and the naive fix lies.

Also confirmed in the same trace, lower severity:

- `system` is a `DETAILED_COLUMNS` column that the row builder **never sets** for
  any row. SCOPE carries `system` authoritatively, so the export should populate
  it (PRODUCT can fall back to blank as today).
- `item_number` is `NULL` for SCOPE → blank cell. Acceptable only if `part_number`
  + `description` identify the line; otherwise generate a deterministic scope
  identifier at draft time.
- The **non-governed** modes (`Draft Cost Sheet`, `Technical Review Cost Sheet`,
  `Commercial Review Cost Sheet`) are BOQ-driven and **may legitimately remain
  BOQ-only** — they carry no quotation authority. But `buildDetailedRow`
  defaults `technicalApprovalStatus` to `"Pending"`, which *would* emit
  `Missing Technical Approval`; unreachable today because the driving table is
  `boq_items`, and must stay unreachable. Assert that in a test.
- The **pricing run CSV** (`pricing-api.mjs:987`) emits an empty "BOQ Item" cell
  for SCOPE and has no source-type column. It is a pricing-library artefact, not
  a quotation, so this is presentation-only — but worth a `source_type` column
  so an exported pricing run is not silently ambiguous.

---

## 17. Fingerprint implementation inventory (lockstep)

| # | Fingerprint | File / function | Feeds | SCOPE change |
|---|---|---|---|---|
| 1 | `CURRENT_PRICING_PREDICATE` | `worker/pricing-authority.mjs:3-17` | `loadCanonicalPricingTotals` (quotation totals) | **Agent 1** — source-aware correlation; NULL-`boq_item_id` hole |
| 2 | `loadCanonicalPricingLine` | `worker/pricing-authority.mjs` | per-item price authority | **Agent 1** — needs a scope sibling |
| 3 | `loadCanonicalPricingTotals` | `worker/pricing-authority.mjs:13` | `context.totals` → draft + export | **Agent 1** — source-aware |
| 4 | stale-line probe | `worker/pricing-api.mjs:1132-1141` | commercial approval staleness | **Agent 1** — silent NULL hole |
| 5 | `buildLineCostModel({itemId})` | `worker/pricing-api.mjs:1208` | cost freshness at approval | **Agent 1** — `runLines[0].boq_item_id` |
| 6 | `quotationFingerprint` | `worker/presales-workflow-api.mjs:93-114` | draft idempotency, approve CAS, decision rows | **P9** — add scope fields |
| 7 | `buildQuotationEvidenceManifest` | `worker/quotation-evidence.mjs:8-82` | `context.sourceFingerprint` | **P9** — add `scopes[]` |
| 8 | `quotationEvidenceFingerprint` | `app/domain/quotation-authority.mjs` | over the manifest | **P9** — follows (7) |
| 9 | `quotationSnapshotFingerprintInput` | `worker/excel-export-api.mjs:38-62` | `QUOTATION_FINGERPRINT_MISMATCH` guard | **P10** — must mirror (6) exactly |
| 10 | `pricing_line.input_fingerprint` | `worker/pricing-runtime.mjs` | per-line input identity | **Agent 1** — SCOPE inputs |
| 11 | `pricing_runs.input_fingerprint` | `worker/pricing-runtime.mjs` | run currency | **Agent 1** |
| 12 | `fire_alarm_panel_sizing_snapshots.input_fingerprint` | `app/domain/fire-alarm-panel-sizing-snapshot.mjs` | sizing authority | none — already source-agnostic; consumed as-is |
| 13 | `presales_workflow_snapshots.input_fingerprint` | `worker/presales-workflow-api.mjs:46` | workflow snapshot id | **P9** if scope affects stage readiness |
| 14 | `QUOTATION_AUTHORITY_VERSION` | `app/domain/quotation-authority.mjs` | manifest authority version | **bump in P9** — the manifest shape changes |
| 15 | **test oracle** — third copy of the payload | `tests/quotation-snapshot-export.test.mjs:15-42` | hardcoded `selectedScenarioId`, hardcoded `version` | **P10, same slice as 6/9** |
| 16 | `pricing_runs` idempotency lookup | `worker/pricing-runtime.mjs:243-245` — `WHERE scenario_id=? AND l.boq_item_id=? AND r.input_fingerprint=?` | run reuse | **Agent 1** — `l.boq_item_id=?` never matches NULL |
| 17 | `aiQuotationInputFingerprint` | `app/domain/ai-quotation-engineer.mjs:65`, input built at `:15-21` | advisory drift; embeds `evidenceFingerprint` + the whole manifest | **P10, advisory-only** — inherits 7/8 transitively |
| 18 | `aiQuotationConfigFingerprint` | `app/domain/ai-quotation-engineer.mjs:66` | config drift | **safe** — source-agnostic |
| 19 | `createQuotationFingerprint` (FNV-1a) | `app/domain/quotation-fingerprint.mjs:1-9` | **client-only** UI workspace seal, sole caller `app/page.tsx:13411` | **out of scope** — different algorithm, different domain. Do **not** conflate with the server `quotation_fingerprint`. |
| 20 | `exportEligibleForQuotationIssue` | `app/domain/quotation-authority.mjs:55-65` | proves issue-readiness by comparing fingerprints | **P10** — comparison semantics only, but meaningless until both sides carry SCOPE identity |

**Lockstep rule — two independent chains, both required:**

- **Chain 1 (quotation fingerprint):** rows 6, 9, **15**, plus
  `quotation-line-authority.mjs:298-334` (the `lines[]` shape feeding 6). All
  must change in the *same slice*, or `QUOTATION_FINGERPRINT_MISMATCH` fires at
  export even when the quotation is correct — and, worse, a SCOPE line can be
  silently dropped by the idempotency check (§10).
- **Chain 2 (evidence fingerprint):** rows 7 → 8 → `excel-export-api.mjs:70`
  (`QUOTATION_EVIDENCE_STALE`) → `quotation-authority.mjs:63`
  (`EXPORT_EVIDENCE_STALE`), plus row 17 transitively.

Rows 1–5 and 16 are Agent 1's and must land before P9 reads SCOPE pricing.

---

## 18. Golden dependencies

| Requirement | Status |
|---|---|
| Current sizing snapshot | exists (`fire_alarm_panel_sizing_snapshots`); **`PANEL_SIZING_SNAPSHOT_REQUIRED` still blocks it for Al Mousa — Agent 3** |
| Current approved SCOPE pricing | **Agent 1 P6–P8** (pricing creation + source-aware currentness) |
| Commercial Price approval | exists, run-level; **Agent 1** must fix the `runLines[0]` and NULL-correlation assumptions |
| PRODUCT pricing | exists and working |
| Technical/matching readiness | exists (`safety_decisions`, `safety_approval_requests`) |
| Quotation draft revision | **BROKEN by 0015** — P9 must fix the INSERT first |
| Quotation approve / issue | exists; role-gated; depends on draft |
| Governed export bound to the revision | exists (`exportEligibleForQuotationIssue`) |
| PRODUCT completeness | exists — **must not be weakened** |
| SCOPE completeness | **P9/P10** |
| Double-count review | **P12** — no mechanism exists |

**Agent 3's `PANEL_SIZING_SNAPSHOT_REQUIRED` directly gates P9's first SCOPE
test**: a SCOPE quotation line cannot be exercised without a current snapshot,
and the Golden E2E Quotation stage is where that would first be proven. Not
duplicating that investigation; recording only this dependency.

---

## 19. File ownership map

| File | Owner | Needed by |
|---|---|---|
| `worker/presales-workflow-api.mjs` | free | **P9** — draft INSERT, fingerprint, totals reconciliation |
| `worker/quotation-line-authority.mjs` | free | **P9/P10** — readiness, SCOPE population, totals |
| `worker/quotation-evidence.mjs` | free | **P9** — manifest `scopes[]` |
| `app/domain/quotation-authority.mjs` | free | **P9** — evidence fingerprint, authority version |
| `app/domain/excel-export-engine.mjs` | **shared/hot** — already being modified by Agent 1 in this tree | **P12** — the §16 provenance fix lands here; coordinate, do not edit concurrently |
| `worker/excel-export-api.mjs` | free | **P10/P12** — `pricingLineCount`, snapshot fingerprint |
| `worker/pricing-authority.mjs` | **Agent 1 (P6–P8)** | P9 *depends* on it |
| `worker/pricing-api.mjs` | **Agent 1 (P6–P8)** | `runLines[0]`, stale-line correlation |
| `worker/pricing-runtime.mjs` | **Agent 1 (P6–P8)** | SCOPE line creation |
| `worker/boq-line-cost-api.mjs` | **Agent 1 (P6–P8)** | `buildLineCostModel` scope input |
| `worker/current-evidence-scope.mjs` | shared/hot | only if a scope currentness helper is added; coordinate |
| `drizzle-active/*`, `db/schema.ts`, `manifest.json`, `_journal.json` | shared/hot | **avoid** — schema is complete; if the §1 NOT NULL issue is fixed it needs no migration (it is a missing column in the INSERT, not a schema defect) |
| `app/domain/fire-alarm-panel-sizing-snapshot.mjs` | read-only | source of scope quantity/identity |
| new test files | free | P9–P13 |

**Agent 1 must retain ownership of `pricing-authority.mjs`, `pricing-api.mjs`,
`pricing-runtime.mjs`, `boq-line-cost-api.mjs` after P8** — P9 reads them and
cannot safely edit them in the same session.

---

## 20. Recommended implementation slices

**Not** the suggested P9 / P10–11 / P12–13 grouping. The suggested grouping
mixes a *schema-consumption* change with a *totals/authority* change and puts
the two export-coupled fingerprints in the last slice — which is exactly how
`QUOTATION_FINGERPRINT_MISMATCH` gets shipped.

**Slice 1 — P9a: repair the PRODUCT quotation source model (smallest possible).**
Fix only the broken INSERT (supply `source_type='PRODUCT'` and
`source_product_id=product_id`). No SCOPE. Red/green: a real-chain test that
creates a PRODUCT draft. **This must ship first and alone**, because nothing
downstream can be proven while draft creation is broken.

**Slice 2 — P9b: source-aware quotation population.** `quotation-line-authority.mjs`
adds the SCOPE branch, §5 sequencing, §7 conjunctive readiness. Red/green: SCOPE
line created; PRODUCT byte-identical; missing SCOPE coverage blocked.

**Slice 3 — P10: fingerprints + totals, together.** Manifest `scopes[]`,
`quotationFingerprint`, `quotationSnapshotFingerprintInput`, and the §8 totals
formula — **one slice, because these four are lockstep (§17)**.

**Slice 4 — P12: double-count review blocker.** Isolated, additive, non-blocking.

**Slice 5 — P13: export verification.** Proves governed export includes SCOPE and
provenance renders correctly; likely smallest.

Optimisation: Slice 1 is a genuine hotfix; Slices 2–5 each touch disjoint files,
so the blast radius per slice is one to two modules with meaningful red/green at
every boundary and no temporary authority bypass anywhere.

---

## 21. Test plan

Real-chain fixtures throughout. None implemented here (read-only task).

**Repair (Slice 1)**
1. Red: PRODUCT draft INSERT against the real chain fails on `source_type` NOT NULL. Green: succeeds with `source_type='PRODUCT'`, `source_product_id=product_id`, and the 0015 CHECK satisfied.
2. PRODUCT quotation content byte-identical before/after the repair.

**Population (Slice 2)**
3. Red: a current approved SCOPE pricing line produces no quotation line. Green: exactly one, with correct `source_type='SCOPE'`, all six scope columns, `source_product_id = product_id`, verbatim snapshot id/fingerprint, quantity from the snapshot.
4. Retry idempotency: same state ⇒ `200 {idempotent:true}`, still one line.
5. PRODUCT unchanged: every existing PRODUCT sequence and fingerprint component identical.
6. PRODUCT completeness still enforced: a missing PRODUCT price still blocks.
7. SCOPE completeness enforced: a required expansion product priced but unquoted blocks.
8. Stale snapshot blocked: a superseded snapshot ⇒ no SCOPE line.
9. Stale pricing blocked; 10. unapproved pricing blocked.
11. 2×3 ⇒ 3×X: new Draft, quantity 3, old Draft superseded, Approved untouched.
12. 3×X ⇒ 0: SCOPE line disappears, fingerprint changes, Approved untouched.
13. X ⇒ Y: new `source_product_id`, old identity gone.
14. Historical Approved revision byte-identical after all of the above.
15. Sequencing: PRODUCT sequences unchanged; SCOPE ordered by the §5 tuple; stable across two runs.

**Totals + fingerprint (Slice 3)**
16. Totals include SCOPE exactly once; branch-exact reconciliation; a compensating PRODUCT error cannot mask a SCOPE error.
17. `quotationFingerprint` includes scope identity and changes when the snapshot fingerprint changes.
18. `quotationSnapshotFingerprintInput` reproduces the same digest ⇒ **no** `QUOTATION_FINGERPRINT_MISMATCH`.
19. Export/import round trip: evidence manifest with `scopes[]` re-derives the same `quotationEvidenceFingerprint`.

**Double count (Slice 4)**
20. PRODUCT X + SCOPE X ⇒ `SCOPE_PRODUCT_OVERLAP_REVIEW` raised, **not** merged, **not** blocking.
21. One product, two `source_role`s ⇒ two lines, no blocker.
22. Two panels requiring X ⇒ one aggregated line (schema-enforced).

**Export (Slice 5)**
23. Governed quotation export includes SCOPE rows with description, part number, manufacturer, unit, quantity, currency, cost, selling, total.
24. SCOPE engineering provenance renders as sizing-snapshot authority; **no** "Missing Technical Approval"; **no** fabricated safety id.
25. PRODUCT export regression unchanged; worksheet labelled.

**Cross-cutting**
26. A real-chain end-to-end: sizing → SCOPE pricing → approval → draft → approve → export, with every historical revision reproducible.
27. Negative: no SCOPE line may appear in any authority set before approval (CLOSE-14/15 contracts hold).

---

## 22. Business-state writes

**None.** Read-only investigation. No production source, migration, schema,
pricing state, quotation state, approval state, export state, commit, push,
deployment, or restart. The only artefacts written were throwaway `:memory:`
SQLite databases, used to *prove* the §1 `NOT NULL` failure and the §8/§9
NULL-correlation facts, and discarded.
