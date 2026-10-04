# MVP-AUDIT-TECH — Technical Approval and Panel Sizing Audit

**Lane:** MVP-AUDIT-TECH (independent, read-only, supporting MVP closure)
**Date:** 2026-09-28
**Audited project:** `project_c0123d91-c30b-4956-87cb-e473ef53f89d` — Al Mousa School (Fire Alarm)
**Explicitly NOT the audit target:** Al Mousa School — Clean Golden Run (`project_ae5011b85…`) — a different entity, untouched.
**Canonical runtime observed:** `http://localhost:4183`
**Boundaries honoured:** no source, fixture, schema, configuration or business-state change; no POST/PUT/PATCH/DELETE; no state-mutating GET; no initialization, regeneration, approval, matching run or sizing creation; no restart, commit, push or deploy.

---

## 1. Verdict on the three disputed claims

| # | Claim | Verdict |
|---|---|---|
| 1 | Empty `safety_approval_requests` means the workflow was never executed, vs. the creation/approval path is broken | **PROVEN: the path is NOT broken. 0 rows is correct behaviour — the approval action is currently mandatorily refused for all 100 current decisions.** |
| 2 | `approved_for_matching` is genuinely unreachable due to contradictory contracts, vs. merely unsatisfied by current inputs | **DISPROVED as stated: it is reachable; no circular dependency exists; 0/39 is input starvation.** ⚠️ **But a real, separate writer/reader contract mismatch was found** (§4, D-A) that makes `Ready with Warnings` permanently unapprovable. |
| 3 | Expansion evidence is incorrectly required when no expansion is needed | **PROVEN: it is required unconditionally.** `worker/fire-alarm-panel-sizing-api.mjs:381` demands the two-hop expansion chain and `added_slc_loops` for **every** panel before any capacity arithmetic runs. |

**Additional finding not in the disputed set, and the most operationally significant:** there is **no UI at all** for `POST /api/projects/:id/fire-alarm/panel-sizing`. The stage is API-only and unreachable by any user through the product (§6).

---

## 2. Route and state table

| Concern | Route / symbol | file:line | Guard that must pass first |
|---|---|---|---|
| Safety approval (only writer of `safety_approval_requests`) | `POST /api/match-candidates/:id/safety/approve` | `worker/confidence-safety-api.mjs:117,125,138` | `SAFETY_DECISION_REQUIRED` (`:121`) → `PROJECT_AUTHORITY_REQUIRED` (`:125`) → `TECHNICAL_APPROVAL_ROLE_REQUIRED` / `PRICE_APPROVAL_ROLE_REQUIRED` (`:125`) → `REQUIREMENT_PROFILE_CHANGED` (`:125`) → `STALE_SAFETY_VERSION` (`:125`) → `APPROVAL_BLOCKED` (`:138`) → `APPROVAL_REASON_REQUIRED` (`:138`) |
| Route registration | `worker/index.ts:32,203-204` | registered **before** matching API (`:206`) — order pinned by `tests/confidence-safety-api.test.mjs:7-13` |
| Safety UI caller | `MatchingWorkspace.tsx:31` → `app/page.tsx:5833` → `app/lib/api-client.ts:90-91` | present |
| Requirement profile approval (only writer of `approved_for_matching`) | `POST /api/boq-items/:id/requirement-profile/approve-readiness` | `BOQ_ITEM_NOT_FOUND` (`technical-requirement-api.mjs:17`) → `REQUIREMENT_PROFILE_REQUIRED` (`:18`) → reason ≥ 5 (`:495`) → **`readiness_status !== "Ready for Matching"` ⇒ `READINESS_BLOCKED`** (`:495`) |
| Requirement profile approval UI | — | **none** — no `app/` reference to `approve-readiness` (verified by independent grep) |
| Primary selection authority | `resolveCurrentPrimarySelection` | `worker/primary-selection-authority.mjs:104-119,174-185` |
| Panel sizing (snapshot writer) | `GET/POST /api/projects/:id/fire-alarm/panel-sizing` | `worker/fire-alarm-panel-sizing-api.mjs:520,529,546,548-549` |
| Panel sizing UI | — | **none** — no component, no button, no workspace (verified) |
| Quotation gate consumer | `projectPanelSizingBlockers` | `worker/quotation-line-authority.mjs:38-62,106-108` |

**Tables:** `safety_approval_requests` (`drizzle-active/0000_baseline_schema_0082.sql:5047-5067`) — 18 columns, **no CHECK, no UNIQUE, no immutability trigger**, and **no UPDATE/DELETE anywhere in `worker/`**. Insert-only by application convention only, unlike `review_decisions`, `quotation_*` and `requirement_*_decisions`, which are trigger-protected.

---

## 3. Prerequisites for a first APPROVED primary selection — data vs. defect

**Ordered chain (no circularity):**
```
current engineering-eligible BOQ item
  → approved classification (system + category)            engine:248
  → ≥1 consolidated requirement, priority Mandatory/Critical  engine:251
  → confidence.overall ≥ 80                                engine:252,331-355
  → readiness_status = "Ready for Matching"                 engine:253
  → profile row persisted with approved_for_matching = 0    worker:303
  → POST approve-readiness (human, reason ≥ 5)             worker:495
  → approved_for_matching = 1                               worker:495
  → (matching itself does NOT read the flag)               product-matching-api.mjs:219-249
  → safety evaluation → safety_decision                     (automatic)
  → POST safety/approve (human) → safety_approval_requests confidence-safety-api.mjs:138
  → resolveCurrentPrimarySelection sees status "Approved"  primary-selection-authority.mjs:104-119
```

**Separated by category:**

| Category | Finding | Status |
|---|---|---|
| Missing execution | No human has yet run `approve-readiness` or `safety/approve` on this project. | **Data/execution, not a defect** |
| Missing evidence | 0 `boq_quantity_source_decisions`; 0 `added_slc_loops` rows library-wide | **Data, not a defect** |
| Human authority | Approval is deliberately a human act with a governed reason. `canApproveTechnicalSafety` accepts 7 roles, `canApproveCommercialPrice` 6; in the single-user MVP every actor resolves to `Project Manager` or `Administrator`, both in both sets — so the role guards are **satisfiable by construction**. | **Not a defect** |
| Permission defects | None found. Route registered, correctly ordered, reachable by a normal actor. | **None** |
| Code defects | D-A (readiness contract mismatch), D-B (silent invalidation), D-C (no UI), D-D (mischaracterised export gate) — §4 | **See §4** |

---

## 4. Defects found

### D-A — `Ready with Warnings` is permanently unapprovable (writer/reader contract mismatch) — **highest impact**

- Writer accepts **only** the literal `"Ready for Matching"`: `readiness_status !== "Ready for Matching"` ⇒ `READINESS_BLOCKED` (`worker/technical-requirement-api.mjs:495`).
- Reader treats it as **satisfied**: `p.readiness_status NOT IN ('Ready for Matching','Ready with Warnings','Approved') OR p.approved_for_matching=0` (`worker/dashboard-api.mjs:171`).
- `"Ready with Warnings"` is a legitimate engine output (`app/domain/technical-requirement-engine.mjs:252`, `confidence.overall < 80`).
- **Live instance:** the target project has **exactly 1** current profile in `Ready with Warnings`. That item is counted as readiness-satisfied by the dashboard yet can never be approved, so it is permanently outstanding — the two contracts cannot both be satisfied.
- Also dead: nothing ever writes `readiness_status='Approved'`, so the `'Approved'` arm of the dashboard predicate is unreachable.
- **Smallest repair (one of two, not both):** narrow the reader to `'Ready for Matching'`, **or** widen the writer to accept `Ready with Warnings` with a mandatory governed reason. Narrowing the reader is the smaller, safer change.
- **Exit test:** seed a `Ready with Warnings` profile and assert the dashboard outstanding count and the writer's accept/reject behaviour agree.

### D-B — `approve-readiness` has no operator affordance and is silently invalidated
No `app/` reference to `approve-readiness`: the action is reachable only by raw API. Separately, `POST /api/requirements/:id/approve` supersedes the current profile and regenerates it (`worker/specification-extraction-api.mjs:291,295`), resetting `approved_for_matching` to the DDL default `0` with no warning to the operator.
- **Exit test:** assert that a regenerated profile reports `approved_for_matching = 0` and that the UI surfaces the action.

### D-C — No UI for panel sizing
`POST /api/projects/:id/fire-alarm/panel-sizing` has no component, no button, no workspace entry point. Dispatched only at `worker/index.ts:136-137`. Independently verified: `app/` contains no reference outside three domain-module comments. **This alone means a real user can never reach the stage**, whatever the evidence situation.

### D-D — Export gate mischaracterised in prior docs
`worker/excel-export-api.mjs:27` filters `approved_for_matching=1` but the result only populates `lockedVersions.requirements` (`:216`) / `metadata.requirementProfileVersion` (`:224`). It is **not** an export permission gate. Prior documents describing export as "blocked by `approved_for_matching=1`" overstate its enforcement.

### D-E — Dead column
`engineering_classification_versions.approved_for_matching` (`db/schema.ts:417`): no writer, no reader — permanently `0`.

### D-F — Unconditional expansion evidence — the disputed defect (§5)
### D-G — Unallocatable expansion hardware
`worker/fire-alarm-panel-sizing-api.mjs:204` rejects allocation of a `Loop Card` / `Enclosure` line as `SLC_POOL_ITEM_UNALLOCATED` (classifier marks them `NOT_SLC`). An engineer who genuinely needs expansion has no way to declare the expansion line in the command. Consistent with the BOM-001 note that R7 returns a part number, never a product id.

---

## 5. Evidence-backed sizing contract comparison (claim 3)

**Ordered validation chain before a snapshot is written** — all DB dependency loads complete **before** the command is even shape-validated:

1. `loadArchitecture` → `CURRENT_APPROVED_ARCHITECTURE_REQUIRED` (`:405`, guard `:76`)
2. `assertPanelCountMatchesSelectedQuantity` → `PANEL_BOQ_ITEM_REQUIRED` / `CURRENT_SELECTED_QUANTITY_REQUIRED` / `PANEL_PANEL_QUANTITY_CONFLICT` (`:406`, `:331-348`)
3. `loadAllocationDependencies` per allocation → `CURRENT_APPROVED_BOQ_ITEM_REQUIRED` / `CURRENT_SELECTED_QUANTITY_REQUIRED` / `CURRENT_REQUIREMENT_PROFILE_REQUIRED` / `CURRENT_SLC_CLASSIFICATION_REQUIRED` (`:408-410`, `:123-151`)
4. SLC-pool completeness → `SLC_POOL_ITEM_UNALLOCATED` (`:416`, `:200-216`)
5. `loadPanelDependency` per panel → `CURRENT_APPROVED_PANEL_SELECTION_REQUIRED` → `STALE_PANEL_PRODUCT_SELECTION` → `CURRENT_PANEL_BOQ_CLASSIFICATION_REQUIRED` → `CURRENT_PRODUCT_IDENTITY_REQUIRED` → **`APPROVED_CAPACITY_EVIDENCE_REQUIRED` + `APPROVED_EXPANSION_EVIDENCE_REQUIRED` together** (`:419-431`, `:350-402`, esp. **`:379-382`**)
6. Panel quantity checks (`:421-430`)
7. Engine `validateCommand` → `PHYSICAL_PANELS_REQUIRED`, `EXPLICIT_BOQ_ALLOCATIONS_REQUIRED`, … (`app/domain/fire-alarm-panel-sizing-snapshot.mjs:102-146`)
8. `assertArchitectureIdentity` (`:157-203`), `validateAllocations` (`:205-218`), `validatePanelDependency` (`:220-232`)
9. `calculateSlcExpansion` per panel, then `CONFLICT` / `INSUFFICIENT_TOPOLOGY_EVIDENCE` checks
10. Read-back + post-write dependency revalidation → `PANEL_SIZING_SNAPSHOT_READBACK_FAILED` / `PANEL_SIZING_DEPENDENCIES_CHANGED_DURING_WRITE`

**The unconditional line:**

```js
// worker/fire-alarm-panel-sizing-api.mjs:379-382
const [{ panelCapacity, evidence: capacityEvidence }, expansion] = await Promise.all([
  loadCapacityEvidence(db, product.id, panel.panelId),
  loadExpansionPath(db, product.id, panel.panelId),   // <-- :381, no condition
]);
```

`loadExpansionPath` has **exactly one** call site (`:381`), is invoked **per panel** (`:420`), receives **no demand, no capacity and no allocation argument** (`:291`), and is constructed eagerly. It therefore *structurally cannot* know whether expansion is needed.

**Ordering proof:** `requiredAdditionalLoops` is computed **only** at `app/domain/fire-alarm-slc-capacity-calculator.mjs:106`; the branch that avoids expansion evidence is `:115` (`if (requiredAdditionalLoops === 0)`) — and that branch is reachable only *after* the chain has already been demanded and supplied. `loadDependencies` performs **zero** capacity arithmetic and is fully awaited at `:548` before the engine runs at `:549`.

**Independent second gate:** `app/domain/fire-alarm-panel-sizing-snapshot.mjs:229-231` raises `APPROVED_EXPANSION_EVIDENCE_REQUIRED` again when the path is incomplete — so a worker-only fix would still be rejected by the engine.

**Exactly-one accessory resolution is correct and must be preserved:** `exactExpansionRelationships` (`:275-289`) requires exactly one current Approved `Expansion Module` relationship per hop and fails `AMBIGUOUS_EXPANSION_RELATIONSHIP` otherwise. ✅

**Attribute names and aliases:** `native_slc_loops`, `max_detectors_per_loop`, `max_modules_per_loop`, `max_system_points` (`:219-224`); expansion reads `added_slc_loops` (`:268`). Aliases (`app/domain/fire-alarm-taxonomy.mjs:586-589,716-717`): `slc_loop_count`→`native_slc_loops`, `detector_capacity`→`max_detectors_per_loop`, `module_capacity`→`max_modules_per_loop`, **`panel_capacity`→`max_system_points`** (a system point ceiling, *not* a loop count). `capacityPerMountingUnit` is **not** an attribute — it is `product_accessories.quantity_parameter` on the mounting→loop hop (`:306`), while the domain resolver keys on the panel→mounting hop's `quantity_rule` containing `CAPACITY_DEPENDENT` (`fire-alarm-slc-expansion-resolver.mjs:23-24`) — the worker never reads `quantity_rule` (asymmetry, D-H). No unit conversion or unit check on the read path; unit discipline exists only on write (`fire-alarm-taxonomy.mjs:798-820`).

**Verdict: PROVEN — expansion evidence is required even when no expansion is needed.** A panel whose native capacity already satisfies demand still cannot produce a snapshot without a two-hop expansion chain and an Approved `added_slc_loops` attribute on the second-hop product.

---

## 6. Test vs. hermetic journey, and UI coverage

| Suite | Schema | Architecture / attributes | No-expansion verdict tested? |
|---|---|---|---|
| `tests/r7-panel-sizing-production.test.mjs` | hand-written `CREATE TABLE` (`:40-300`) | hand-seeded `added_slc_loops` (`:275`), both hops (`:277-279`), architecture (`:283-286`) | yes, but with **hand-written dependencies**, engine called directly (`:377`) — never through the route |
| `tests/r7-panel-topology-completeness.test.mjs` | **real active chain** (`applyActiveChain` `:34-43`) | hand-seeded architecture (`:267-293`), `added_slc_loops` (`:203`), both hops (`:211-212`) | yes, via the **real route** (`:345-352`) — but the expansion chain is still pre-seeded |
| `tests/r7-topology-concurrency.test.mjs` | real chain (sizing half) + hand-written (quotation half) | hand-seeded (`:245-271`, `:198-211`) | blocker cleared by a **literal JSON** `requiredExpansionQuantity: 0` (`:559`) — never computed |

**Coverage holes proven:**
1. **No test anywhere removes the expansion chain and asserts the no-expansion command still succeeds.** `added_slc_loops` appears in only 4 seeding sites and never in a removal. This is precisely why D-F survived.
2. **No test joins the production drawing→architecture route to the panel-sizing route.** Every sizing test hand-seeds architecture. The producing code is real (`drawing-architecture-intelligence.mjs:370` mints `PANEL_EXISTS`; `drawing-architecture-bridge.mjs:103` maps it to the `PANEL_INVENTORY` channel `loadArchitecture` reads), but the join is unproven in-repo.
3. The only behavioural test of the `approved_for_matching` writer is a Playwright spec **outside** the default suite (`tests/e2e/golden-full-journey.spec.ts:196`); the in-suite test is a regex string-presence check (`tests/technical-requirement-engine.test.mjs:180`).

**UI coverage verdict: NONE.** No component, no button, no workspace entry point for panel sizing, and none for `approve-readiness`.

---

## 7. Runtime observations (read-only, timestamped)

Observed 2026-09-28 against `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b04….sqlite`, opened `mode=ro` with a live `-wal` (16 KB) — **WAL-aware read-only access, not a bare file copy**.

**Target project — claim 1 decisive:**
- 100 current safety decisions: **90** `technical_eligibility='Blocked'`, **10** `'Technical Approval Disabled'`; all 100 `price_eligibility='Price Approval Disabled'`.
- **447 `Open` safety blocks**; **0 `safety_overrides`**.
- Against the guard at `confidence-safety-api.mjs:138`: `/^Eligible/` is false for both eligibility values, `overriddenBlocksAllResolved` is false (requires all blocks `Overridden`), and `blocks.some(status='Open')` is true. **All 100 decisions are mandatorily refused with `APPROVAL_BLOCKED`.** 0 approval rows is therefore the *correct* outcome, not a broken path.

**Target project — claim 2 decisive:** 39 current requirement profiles — 31 `Missing Critical Information`, 4 `Classification Required`, 3 `Needs Technical Review`, **1 `Ready with Warnings`**; **`approved_for_matching = 1` count: 0**. The single `Ready with Warnings` profile is the live instance of D-A.

**Sizing prerequisites:** `boq_quantity_source_decisions` = **0**; `added_slc_loops` rows library-wide = **0**; 23 current profiles contain a control-panel family string (so panel classification exists), but no quantity authority, no expansion evidence and no UI to submit a command.

**Concurrency note:** MVP-CLOSE-1 is regenerating profiles on this project during this audit. Runtime state above is a point-in-time observation; it is not called a regression, and no conclusion here depends on a row count staying fixed.

---

## 8. Smallest proposed repair / execution slice per confirmed blocker (none implemented)

| Blocker | Smallest slice | Exit test |
|---|---|---|
| **D-F** unconditional expansion evidence | Make expansion loading lazy: move `loadExpansionPath` out of the `Promise.all` at `:379-382` into a post-`calculateSlcExpansion` branch that runs only when `requiredAdditionalLoops > 0`; relax the duplicate gate at `snapshot:229-231` to accept a null expansion path when the calculator returned `NO_EXPANSION_REQUIRED`. Preserve `AMBIGUOUS_EXPANSION_RELATIONSHIP` exactly-one behaviour. | Given native capacity satisfying demand and **no** expansion chain seeded, the real route returns 201 with `status='NO_EXPANSION_REQUIRED'`; with demand exceeding native capacity and no chain, it fails closed. |
| **D-A** readiness contract mismatch | Narrow the dashboard predicate at `:171` to `'Ready for Matching'`, **or** widen the writer to accept `Ready with Warnings` with a mandatory reason. | A `Ready with Warnings` profile is either approvable or counted outstanding — asserted explicitly for both. |
| **D-C** no panel-sizing UI | Add a panel-sizing action to the Fire Alarm workspace calling the existing route. | UI action reaches the route; blocked cases surface the governed error code. |
| **D-B** no `approve-readiness` affordance + silent invalidation | Expose the existing endpoint in the Requirements workspace; surface regeneration resetting the flag. | Approved profile survives a no-op refetch; a regenerated profile visibly reports `approved_for_matching = 0`. |
| **G-J** unproven architecture→sizing join | One hermetic test that drives `review/initialize` → `deterministic-confirm` → `adjudication/apply` and then the panel-sizing route on the same project. | `CURRENT_APPROVED_ARCHITECTURE_REQUIRED` no longer raised. |
| **D-G** unallocatable expansion hardware | Decide policy: allow `NOT_SLC` expansion lines in `allocations`, or document that expansion enters BOM via the (still-open) BOM-002 path. | Policy decision recorded; test matches it. |
| **D-H** `quantity_rule` asymmetry | Read `quantity_rule` on the panel→mounting hop, or align the worker with the domain resolver. | A non-capacity-dependent relationship is refused. |
| **D-E** dead column | Remove, or wire. | Schema test agrees. |

**Prerequisite order for any execution slice:** D-F (makes sizing reachable at all) → G-J (proves the architecture precondition) → D-C (makes it reachable by a user). D-A / D-B are independent of sizing.

---

## 9. Dependencies and lane interactions

- **MVP-CLOSE-1** (regenerating profiles on `project_c0123d91`): my runtime observations are point-in-time and are not regression claims. D-A and D-B touch the same profile authority; whoever implements must expect regeneration to reset `approved_for_matching`.
- **GOLDEN-001 lane** (Clean Golden Run): unaffected — different project. Note the shared root cause: D-F is the same unconditional `loadExpansionPath` that blocks `PANEL_SIZING_SNAPSHOT_REQUIRED` on the Golden path. **Fixing D-F is likely a prerequisite for Golden E2E too.**
- **BOM-002** (expansion `productId` discarded at the calculation boundary) remains open and is *distinct* from D-F: D-F is about requiring evidence too early; BOM-002 is about dropping a resolved identity too late.
- No commercial services, pricing or quotation schema was examined, per scope.

---

## 10. Report path and evidence limitations

**Report:** `docs/MVP-AUDIT-TECH-REPORT.md`

**Limitations:**
1. `worker/technical-requirement-api.mjs:495` is a single minified line exceeding the reader's display cap; its sub-branch details were verified by per-line string-presence oracles (grep hit → line number) rather than verbatim reading. The `readiness_status !== "Ready for Matching"` gate was independently re-confirmed by direct grep in this session.
2. `0 safety_approval_requests` cannot, from the table alone, distinguish *never attempted* from *attempted and refused* — the route records no refusal row. The runtime eligibility data resolves this for the current state (all 100 are mandatorily refused), but a historical "was it ever clicked" question is unanswerable from persisted state.
3. Runtime counts are a 2026-09-28 snapshot on a live database with a concurrent lane writing; they are evidence of current state, not a stable fixture.
4. I did not execute any test suite: all candidate suites build their own temp databases, but proving isolation from the shared runtime/data per lane instructions was not established to my satisfaction, so execution was skipped in favour of source reading. No claim here rests on an executed test.
5. Engineering/manufacturer research was **not** performed: no concrete technical uncertainty required it, and no fact was approved or persisted.

---

**STOPPED — MVP-AUDIT-TECH complete; read-only audit.**
