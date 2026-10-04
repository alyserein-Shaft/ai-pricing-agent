# GOLDEN-1 — PANEL_SIZING_SNAPSHOT_REQUIRED Root-Cause Audit

**Mode:** READ-ONLY AUDIT. No fix implemented.
**Tree baseline:** HEAD `029b42637ac117f810e726b40c2e888c484c173b`, branch `main`, 778 porcelain lines, treehash `877927b5f461`
**Runtime:** PID 66503 on :4183 (observed 2026-09-28T18:20:23Z)
**Canonical D1:** `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite` (WAL-safe read-only, no writes)

---

## 1. Executive verdict

🟢 **The quotation gate is correct and is not defective.** It is a deliberate fail-closed project-level gate, and its 9/9 isolated regression guard passes unchanged. It has never been bypassed, special-cased, or weakened.

🔴 **`PANEL_SIZING_SNAPSHOT_REQUIRED` fires because `fire_alarm_panel_sizing_snapshots` contains 0 rows — for every project in the environment.** The governed panel-sizing step has never been performed, anywhere.

🔴 **The step cannot be performed through the product today: there is no UI for panel sizing at all.** The only writer is a hand-authored `POST` with no frontend surface.

**Primary root-cause class: `FIXTURE / GOLDEN SETUP GAP`.**
Production contract is correct; the Golden E2E path omits a required governed step and seeds none of the evidence that step consumes.

---

## 2. Error origin

Two distinct emitters produce the same code:

| Emitter | file:line | Condition |
|---|---|---|
| **Quotation gate (the observed failure)** | `worker/quotation-line-authority.mjs:59` | `if (!snapshot) return ["PANEL_SIZING_SNAPSHOT_REQUIRED"];` |
| Table-absent fail-closed | `worker/quotation-line-authority.mjs:56` | `if (String(error).includes("no such table")) return [...]` |
| Panel-sizing GET (unrelated surface) | `worker/fire-alarm-panel-sizing-api.mjs:559` | `if (!current) return json({...}, 409)` |

The observed Golden failure is emitted by **`worker/quotation-line-authority.mjs:59`**.

Verified the table-absent path is **not** what fired — the table exists in live D1:
```
sqlite> SELECT name FROM sqlite_master WHERE name='fire_alarm_panel_sizing_snapshots';
fire_alarm_panel_sizing_snapshots
```

---

## 3. Call graph

```
POST /api/projects/:id/presales-workflow/quotation/draft        (test call site: tests/e2e/golden-full-journey.spec.ts:464)
  └─ worker/index.ts                    dispatch handlePresalesWorkflowApi
      └─ worker/presales-workflow-api.mjs:52    if (operation === "quotation/draft")
          ├─ :53  first gate  → QUOTATION_READINESS_BLOCKED  (workflow.readyForQuotation)
          └─ :56  second gate → loadCanonicalQuotationLines(env.DB, {...})     ← SEQUENTIAL, strictly additional
              └─ worker/quotation-line-authority.mjs:191  loadCanonicalQuotationLines
                  └─ :232  blockers.push(...await projectPanelSizingBlockers(db, projectId))
                      └─ worker/quotation-line-authority.mjs:38  projectPanelSizingBlockers
                          ├─ :42  SELECT * FROM projects WHERE id=?
                          ├─ :43  if (!/fire\s*alarm/i.test(project.system_domain)) return []     ← domain gate
                          ├─ :50  SELECT id,version_number,status,input_fingerprint,calculation_json
                          │         FROM fire_alarm_panel_sizing_snapshots
                          │         WHERE project_id=? ORDER BY version_number DESC LIMIT 1
                          ├─ :59  if (!snapshot) return ["PANEL_SIZING_SNAPSHOT_REQUIRED"]   ← *** FAILS HERE ***
                          ├─ :60  if (status !== "COMPLETED") return ["PANEL_SIZING_EVIDENCE_STALE"]
                          ├─ :64  if (!expansionRequirementBlockers(...).length) return []
                          └─ :65  return expansionCoverageBlockers(...)
```

Reaching the second gate **proves the first gate passed**. Per `scripts/ledger-golden001.mjs:39`, the two are sequential, not conflicting: the presales workflow and the line authority agree; the line authority is strictly additional. The pricing chain was not the problem at the point of failure.

---

## 4. Valid snapshot contract (implementation evidence, not error wording)

From `worker/quotation-line-authority.mjs:38-66` verbatim:

| Contract element | Required? | Evidence |
|---|---|---|
| Project `system_domain` matches `/fire\s*alarm/i` | **Yes** | `:42-43` — otherwise no blocker at all |
| Exactly one current snapshot per project | **Yes** | `:19-20` comment; query is project-scoped |
| **Latest** snapshot, not latest-COMPLETED | **Latest by `version_number DESC LIMIT 1`** | `:51` |
| Non-superseded | **No `superseded_at` filter exists** | table is append-only/immutable; there is no supersession column |
| Exact BOQ item / panel / product match | **No** — project-level only | `:19-20` |
| `input_fingerprint` match against recomputed evidence | **No** | `:28-37` honest-limitation comment: recomputation lives in the sizing GET path, not here |
| Current architecture version | **No** (not read by the consumer) | — |
| Current capacity / expansion / selected panel | **No** (not read by the consumer) | — |
| `status === "COMPLETED"` | **Yes** | `:60` |

**Consequence:** the consumer's contract is deliberately *thin* — presence + `COMPLETED`. A `COMPLETED` row that is fingerprint-stale still clears this gate. That is a documented, intentional limitation (`worker/quotation-line-authority.mjs:28-37`), not a defect, and it is not the cause here.

---

## 5. Snapshot producer lifecycle

**Single production writer** — `worker/fire-alarm-panel-sizing-api.mjs:603-611`:

```js
await env.DB.prepare(`
  INSERT INTO fire_alarm_panel_sizing_snapshots
    (id,project_id,version_number,input_fingerprint,engine_version,status,input_json,calculation_json,dossier_json,reason,created_by,created_at)
  VALUES (?,?,(SELECT COALESCE(MAX(version_number),0)+1 FROM fire_alarm_panel_sizing_snapshots WHERE project_id=?),?,?,?,?,?,?,?,?,?)
`).bind(snapshotId, projectId, projectId, snapshot.inputFingerprint, snapshot.engineVersion, snapshot.status, ...).run();
```

**Route:** `POST /api/projects/{projectId}/fire-alarm/panel-sizing` (matcher `:545`, method check `:571`).

**Automatic or explicit?** 🔵 **Explicit.** `worker/fire-alarm-panel-sizing-api.mjs:1-7`:
> *"The POST command is an explicit governed allocation. The server resolves no topology and selects no product..."*

**Status:** 🔵 **Always `COMPLETED`.** The only assignment is `app/domain/fire-alarm-panel-sizing-snapshot.mjs:371`. `"STALE"` is never persisted — it is a GET read-model projection only (`:473`, `:483-489`). So the consumer's `status !== "COMPLETED"` branch (`:60`) is unreachable via the production writer.

**Immutability:** `drizzle-active/0004_fire_alarm_panel_sizing_snapshots.sql:19-28` — `BEFORE UPDATE` and `BEFORE DELETE` triggers both `RAISE(ABORT, 'FIRE_ALARM_PANEL_SIZING_SNAPSHOTS_IMMUTABLE')`. Append-only; correction requires superseding with a new version.

**`input_fingerprint`:** `SHA-256(canonicalJSON({ engineVersion, command, dependencies }))` — `app/domain/fire-alarm-panel-sizing-snapshot.mjs:46-57, 352-357`. Keys sorted recursively; arrays order-preserving; deterministic for fixed DB state + fixed command. `dependencies` = `{ architecture, items, panels }`.

**Authority:** `canApproveTechnicalSafety(project.project_role)` — `worker/fire-alarm-panel-sizing-api.mjs:554`, roles at `app/domain/project-roles.mjs:39-50`.

### Preconditions that must ALL pass before the INSERT

| # | Guard code | file:line |
|---|---|---|
| 0 | `PANEL_SIZING_TECHNICAL_AUTHORITY_REQUIRED` | `worker/fire-alarm-panel-sizing-api.mjs:554` |
| 1 | **`CURRENT_APPROVED_ARCHITECTURE_REQUIRED`** | `:75-79` |
| 2 | `PANEL_BOQ_ITEM_REQUIRED` / `CURRENT_SELECTED_QUANTITY_REQUIRED` / `PANEL_PANEL_QUANTITY_CONFLICT` | `:332-349` |
| 3 | `CURRENT_APPROVED_BOQ_ITEM_REQUIRED` | `:65-72` |
| 4 | `CURRENT_REQUIREMENT_PROFILE_REQUIRED` | `:131` |
| 5 | `CURRENT_SLC_CLASSIFICATION_REQUIRED` | `:134, 141` |
| 6 | `SLC_POOL_ITEM_UNALLOCATED` | `:201-217` |
| 7 | `CURRENT_APPROVED_PANEL_SELECTION_REQUIRED` | `:361` |
| 8 | `STALE_PANEL_PRODUCT_SELECTION` | `:363` |
| 9 | **`CURRENT_PANEL_BOQ_CLASSIFICATION_REQUIRED`** | `:365-371` |
| 10 | **`CURRENT_PRODUCT_IDENTITY_REQUIRED`** | `:379-383` |
| 11 | `APPROVED_CAPACITY_EVIDENCE_REQUIRED` / `_CONFLICT` | `:219-259` |
| 12 | *(conditional)* `APPROVED_EXPANSION_EVIDENCE_REQUIRED` / `AMBIGUOUS_EXPANSION_RELATIONSHIP` | `:261-296` |
| 13 | **`PHYSICAL_PANELS_REQUIRED`** | `app/domain/fire-alarm-panel-sizing-snapshot.mjs:105` |
| 14 | **`PANEL_TOPOLOGY_INCOMPLETE`** | `app/domain/fire-alarm-panel-sizing-snapshot.mjs:191-201` |
| 15 | `PHYSICAL_PANEL_TOPOLOGY_REQUIRED` | `app/domain/fire-alarm-panel-sizing-snapshot.mjs:345` |

**What prevents creation today in the Golden path:** every one of the above is un-driven. The route is never called by any journey, script, or UI.

### 🔴 Verified product gap: there is NO UI

Confirmed independently, not from documentation:

```
grep -c "panel-sizing|panelSizing" app/page.tsx                → 0
grep -rl "panel-sizing|panelSizing" app/components/            → 0 files
grep -rn "fire-alarm/panel-sizing" app/                        → no matches
grep -n "panel-sizing" app/lib/api-client.ts                   → no matches
```

Only two domain modules mention it, in comments. The sole non-test caller of the path is the worker dispatch at `worker/index.ts:136-137`. **An engineer cannot create a sizing snapshot through the product at all** — it requires a hand-authored API call.

---

## 6. Current Golden state

### The project that actually produces the blocker is NOT either named project

`Golden_E2E_Result_v1.json:4` records:
```
POST /api/projects/project_fd1b5418-c1e3-449e-b559-ea494d22fa3e/presales-workflow/quotation/draft
```

🔴 **`project_fd1b5418-c1e3-449e-b559-ea494d22fa3e` does not exist in live D1.** It is the **hermetic E2E fixture project**, created per-run at `tests/e2e/golden-full-journey.spec.ts:97` as `"Golden Full Journey"` and never deleted (`afterAll` at `:90-96` only writes the report).

Distinction confirmed:
- `project_c0123d91-c30b-4956-87cb-e473ef53f89d` — "Al Mousa School" (acceptance project) — **exists**, Fire Alarm
- `project_ae501b85-9c12-4332-bf8e-787c90f2d388` — "Al Mousa School — Clean Golden Run" — **exists**, Fire Alarm
- `project_fd1b5418-…` — the observed failure — **does not exist**; ephemeral E2E fixture

### Snapshot inventory — the decisive measurement

| Scope | `fire_alarm_panel_sizing_snapshots` rows |
|---|---|
| **All 23 live projects** | 🔴 **0** |
| Acceptance project `c0123d91` | 🔴 0 |
| Clean Golden Run `ae501b85` | 🔴 0 |
| E2E fixture `fd1b5418` | 🔴 0 (project gone) |

**Case A — No snapshot exists. Confirmed for every project in the environment.** Not Case B (not-COMPLETED), not Case C (stale), not Case D (valid-but-missed).

### Producer prerequisites in live D1 (global)

| Evidence | Rows | Verdict |
|---|---|---|
| `fire_alarm_panel_sizing_snapshots` | 0 | 🔴 absent |
| `drawing_architecture_approved_versions` | 4 | 🟢 present |
| `drawing_architecture_stage4_readiness` | 2 | 🟢 present |
| `product_attributes` (total) | 68 | 🟢 present |
| `product_attributes` capacity set | 16 | 🟡 partial |
| `product_attributes` `added_slc_loops` | 0 | 🔴 absent (conditional only) |
| `product_accessories` | 211 | 🟢 present |
| `canonical_library_products` | 951 | 🟢 present |
| `product_match_runs` | 261 | 🟢 present |
| **`safety_approval_requests`** | **0** | 🔴 **absent — producer hard stop** |

### Per-project reachability — acceptance project vs E2E fixture

| Precondition | Acceptance `c0123d91` | Hermetic E2E fixture |
|---|---|---|
| 1. Approved architecture | 🟢 2 versions, `READY_FOR_STAGE4_BRIDGE` | 🔴 none (no drawing) |
| 2. `PANEL_EXISTS` topology | 🟢 **11** EXPLICIT approved rows | 🔴 none |
| 9. Control-panel BOQ classification | 🟢 **7** lines `productFamily = "Fire Alarm Control Panel"` | 🔴 none |
| 7. Approved primary selection | 🔴 **0** `safety_approval_requests` globally | 🔴 none |
| 11. Capacity evidence on exact product | 🟡 16 attrs, not bound to a selected panel | 🔴 seed has **no** `product_attributes` |
| 10. Canonical product identity | 🟡 951 exist, none selected for a panel | 🔴 seed has **no** `canonical_library_products` |
| 14. Topology completeness (11 identities) | 🔴 not driven | 🔴 n/a |
| Downstream `pricing_lines` | 🔴 **0** | 🔴 0 |

`tests/e2e/seed-golden-catalog.sql` seeds only: `product_manufacturers`, `product_brands`, `product_families`, `product_sources`, `library_products` (1 row), `product_source_evidence`, `engineering_relationships`. **No** `product_attributes`, **no** `product_accessories`, **no** `canonical_library_products`, **no** `added_slc_loops`.

The E2E journey calls panel-sizing, drawing, or architecture **zero times** (grep: only one prose comment at `:264`).

### Note on a stale repository claim

`docs/MVP-AUDIT-TECH-REPORT.md:18,138` and `docs/MVP-CLOSE-0-…md:41,134,151` state `added_slc_loops` is "required unconditionally" by the sizing gate. 🔴 **That is stale.** `worker/fire-alarm-panel-sizing-api.mjs:395-405` loads the expansion chain only when `expansionNeed.requiredAdditionalLoops > 0`, pinned by `tests/mvp-sizing-1-expansion-evidence-laziness.test.mjs:391-392`. `added_slc_loops` is **not** on the critical path for a panel that fits natively. Treating it as a blocker would be an error.

---

## 7. Runtime reproduction

Existing isolated regression guard, real schema, no shared data, no mocks of the gate:

```
$ node --test tests/r7-topology-concurrency.test.mjs
✔ a Fire Alarm project with no panel-sizing snapshot carries PANEL_SIZING_SNAPSHOT_REQUIRED and is not ready
✔ a non-COMPLETED panel-sizing snapshot blocks as PANEL_SIZING_EVIDENCE_STALE
ℹ tests 9  ℹ pass 9  ℹ fail 0
```

Pinned at `tests/r7-topology-concurrency.test.mjs:535-542`:
```js
test("a Fire Alarm project with no panel-sizing snapshot carries PANEL_SIZING_SNAPSHOT_REQUIRED and is not ready", async () => {
  const db = quotationDb({ systemDomain: "Fire Alarm" });
  const result = await loadCanonicalQuotationLines(db, { projectId: "p1", scenarioId: "s1", currency: "SAR" });
  assert.equal(result.lineCount, 1, "the commercial line itself is unaffected by the project-level panel blocker");
  assert.ok(result.blockers.includes("PANEL_SIZING_SNAPSHOT_REQUIRED"));
  assert.equal(result.ready, false);
  assert.deepEqual(await projectPanelSizingBlockers(db, "p1"), ["PANEL_SIZING_SNAPSHOT_REQUIRED"]);
});
```

**Exact missing predicate and responsible database state:**
- Predicate: `worker/quotation-line-authority.mjs:50-52` returning no row → `:59` fires.
- Responsible state: `SELECT COUNT(*) FROM fire_alarm_panel_sizing_snapshots` = **0**.
- **Confirmed consumer reads the table correctly.** `tests/r7-topology-concurrency.test.mjs:571-574` proves that when a `COMPLETED` row *is* present, the same function returns `[]`. The lookup is not broken; there is simply nothing to find.

---

## 8. Producer vs consumer classification

## `FIXTURE / GOLDEN SETUP GAP` — primary

Evidence:
1. The gate is correct and regression-guarded (9/9 pass, §7).
2. The consumer's SQL is correct — proven by the same function returning `[]` when a row exists (§7).
3. The table is present; 0 rows exist (§6).
4. The producer is explicit, API-only, and has no UI (§5).
5. The hermetic E2E fixture seeds none of the evidence the producer consumes, and its journey never invokes it (§6).
6. The live acceptance project has the *hard* prerequisites (architecture, `PANEL_EXISTS`, control-panel classification) but still 0 snapshots, because the step was never driven and `safety_approval_requests` is globally 0.

This is **not** `CONSUMER LOOKUP DEFECT` (§7 disproves it) and **not** `CONTRACT MISMATCH` (§9 disproves it).

**Secondary, distinct condition — `PRODUCER MISSING` for the live acceptance project:** there, the evidence largely exists, so the producer could in principle run — but it would currently stop at `CURRENT_APPROVED_PANEL_SELECTION_REQUIRED` (`:361`) because `safety_approval_requests` = 0, and later at `PANEL_TOPOLOGY_INCOMPLETE` (11 identities unallocated). Technical approval is owned by the technical lane; treated here as an upstream contract, not a defect.

---

## 9. Fingerprint / currentness comparison

🔴 **No mismatch. Producer and consumer cannot disagree about currentness.**

| Dimension | Producer (sizing GET recompute) | Consumer (quotation gate) |
|---|---|---|
| Row selection | newest `version_number`, project-scoped | newest `version_number`, project-scoped — **identical** |
| Recomputes `input_fingerprint` | **Yes** | **No** — documented limitation `worker/quotation-line-authority.mjs:28-37` |
| `status` source | persisted `COMPLETED` / projected `STALE` | persisted, must equal `COMPLETED` |

**Answer to the phase-7 question — can the same snapshot be current for sizing but stale/missing for quotation?**

- **Stale vs missing: no.** Both readers select the same row. A row cannot be found by one and not the other.
- **Fresh vs stale: yes, by design and only in one direction.** A snapshot can be *stale* per the sizing GET recompute while the quotation gate still clears it, because the gate deliberately does not recompute the fingerprint. This is an intentional, documented narrowing (`:28-37`) that avoids coupling the quotation read path to the whole engineering authority chain.
- 🔵 **This asymmetry is not the cause here**, and it is not a defect. It cannot produce `PANEL_SIZING_SNAPSHOT_REQUIRED`; it can only fail to *block*, never to block. Making it stricter is out of scope and would be a governance change requiring its own authority.

---

## 10. BOM reader vs quotation reader

🔴 **The two readers are byte-identical in SQL.** The hypothesized "BOM sees it, quotation doesn't" asymmetry **does not exist**.

| | BOM reader | Quotation reader |
|---|---|---|
| Function | `loadExpansionRequirement` — `worker/boq-line-bom-api.mjs:139-141` | `projectPanelSizingBlockers` — `worker/quotation-line-authority.mjs:50-52` |
| SQL | `SELECT id,version_number,status,input_fingerprint,calculation_json FROM fire_alarm_panel_sizing_snapshots WHERE project_id=? ORDER BY version_number DESC LIMIT 1` | **identical** |
| No row ⇒ | `{ status: "SNAPSHOT_REQUIRED", requiredExpansionQuantity: null, products: [] }` — informational | `["PANEL_SIZING_SNAPSHOT_REQUIRED"]` — **fail-closed blocker** |
| Non-`COMPLETED` ⇒ | `SNAPSHOT_NOT_COMPLETED` | `PANEL_SIZING_EVIDENCE_STALE` |

**Semantic difference is one of consequence, not of visibility.** BOM reports the absence as advisory scope information; quotation reports it as a hard gate. Both observe the same zero rows.

Consequence for BOM-5: the SCOPE requirement that BOM-5 depends on is **equally unavailable**. `loadExpansionRequirement` returns `requiredExpansionQuantity: null`, so there is no sizing-derived scope for generalized SCOPE pricing to price.

---

## 11. BOM-5 dependency

## `INDEPENDENT`

Reasoning:
1. BOM-5 P6–P13 implements generalized **SCOPE pricing**. Scope pricing consumes an existing priced line. It does not create panel-sizing authority.
2. The sizing gate is a **project-level fail-closed prerequisite** evaluated at quotation-draft creation, upstream of nothing BOM-5 writes and downstream of everything it does.
3. Both readers use identical SQL and both see 0 rows (§10). No BOM-5 change can alter the snapshot table or the quotation gate's query.
4. A valid `COMPLETED` snapshot with `requiredExpansionQuantity = 0` clears the gate at `worker/quotation-line-authority.mjs:64`. BOM-5 does not write snapshots, so it cannot produce that row.

Consistent with `docs/MVP-BOM-5-GOVERNED-SCOPE-COMMERCIAL-FLOW.md:24`, which instructs that BOM-5 must not absorb this blocker. **BOM-5 will not clear it, and it should not try.**

---

## 12. Smallest repair design (design only — nothing implemented)

The blocker must **not** be removed in code. Prohibited and not proposed: bypassing the gate, treating an absent snapshot as zero requirement, inserting a synthetic snapshot, ignoring fingerprints, weakening technical approval.

The smallest *correct* repair is to make the governed sizing step performable and then perform it. It decomposes into three prerequisite slices, in strict order:

**Slice 1 — Product surface for the governed sizing step (the genuine code gap).**
Add an engineer-facing surface for `POST /api/projects/:id/fire-alarm/panel-sizing`, wired through `app/lib/api-client.ts`, with explicit command construction (reason, provenance, panel allocations) and the full blocker list surfaced. Exit test: an engineer can reach and submit a governed sizing command from the UI, and every server error code from §5 is rendered rather than swallowed.
*Rationale: without this, the step is unreachable by any human, which is the mechanical reason it has never run.*

**Slice 2 — Product-evidence seeding for the Golden path.**
`tests/e2e/seed-golden-catalog.sql` must gain: `canonical_library_products` for a panel, Approved current `product_attributes` for `native_slc_loops` / `max_detectors_per_loop` / `max_modules_per_loop` / `max_system_points` on that exact product, and — only if arithmetic requires it — the two-hop Approved `Expansion Module` chain with positive `quantity_parameter` and `added_slc_loops`. Capacity aliases (`slc_loop_count`, `detector_capacity`, `module_capacity`, `panel_capacity`) are accepted (`app/domain/fire-alarm-taxonomy.mjs:586-589`).
Exit test: with a governed sizing command issued, the producer passes guards 10 and 11 and fails no later than guard 14 for a documented reason.

**Slice 3 — Drive the governed step in the Golden journey.**
Add a sizing step to `tests/e2e/golden-full-journey.spec.ts` before the quotation draft: satisfy guard 1 (drawing → intake → architecture review → approved version + `READY_FOR_STAGE4_BRIDGE`), guard 7 (Approved primary selection — owned by the technical lane), guards 13–15 (size or governed-exclude every one of the 11 `PANEL_EXISTS` identities).
Exit test: the journey reaches `POST …/quotation/draft` and receives 201, with `fire_alarm_panel_sizing_snapshots` holding exactly one `COMPLETED` row for the fixture project whose `requiredExpansionQuantity` is recorded.

🔴 **Sequencing constraint:** Slice 3 cannot complete until the technical lane records Approved `safety_approval_requests` (currently 0 globally). That is an upstream contract, not a Golden-1 defect.

🟡 **MVP boundary option, if the panel-sizing step is formally out of MVP scope for Fire Alarm:** that is a *product-scope decision requiring human authority*, not an engineering finding. It would change what "commercial MVP complete" means and must not be inferred from this audit. If taken, the correct consequence is that Fire Alarm quotation is declared out of MVP scope — not that the gate is relaxed.

---

## 13. File ownership / collision map

| File | Eventual role | Ownership status |
|---|---|---|
| `worker/quotation-line-authority.mjs` | **consumer — must NOT change** | 🟢 free (mtime 2026-09-28T19:58) |
| `worker/fire-alarm-panel-sizing-api.mjs` | producer | 🟢 free (mtime 2026-09-28T16:36) |
| `worker/boq-line-bom-api.mjs` | BOM reader | 🟡 **BOM-5 adjacent** (mtime 2026-09-28T17:12) |
| `app/lib/api-client.ts` | Slice 1 wiring | 🟡 possible BOM-5 overlap |
| new `app/components/**` sizing surface | Slice 1 | 🟢 free (new files) |
| `tests/e2e/seed-golden-catalog.sql` | Slice 2 | 🟢 free (untouched since 2026-08-10) |
| `tests/e2e/golden-full-journey.spec.ts` | Slice 3 | 🟢 free (mtime 2026-09-27T17:55) |
| `drizzle-active/*`, `_journal.json`, `manifest.json` | **must not be touched** | 🔴 **CLOSE-16 in-flight (0015/0016)** |

🔴 **No migration is required for any slice.** 0015/0016 and the journal/manifest are exclusively CLOSE-16's; this audit touched none of them.

---

## 14. Business-state writes

**None.** No INSERT, UPDATE, DELETE, approval, override, export, issue, pricing run, or regeneration was performed. All database access was WAL-safe read-only. No snapshot was created or faked. No permission check was modified. No restart, commit, push, or deployment.

---

## 15. Recommended implementation slice

**Slice 1 only — provide an engineer-facing surface for the governed panel-sizing step.**

Chosen because it is the single genuinely missing *code* artifact, it is isolated from both active lanes (new files plus one additive `api-client` line), it introduces no migration, and it is the mechanical precondition for every other slice. Slices 2 and 3 are fixture/journey work that cannot even be attempted until Slice 1 exists and the technical lane records approved selections.

Explicitly **not** recommended as the next slice: touching `worker/quotation-line-authority.mjs` (the gate is correct), or any BOM-5 file (independent, §11).

---

## Appendix — evidence limitations

- The hermetic E2E fixture project `project_fd1b5418-…` no longer exists, so the failing state was characterised from the recorded failure artifact, the spec source, the seed files, and live schema — not from its rows.
- `tests/e2e/seed-golden-catalog.sql` is 78 lines and was read in full; its omission of sizing evidence is a direct observation, not an inference.
- Producer precondition *ordering* is taken from source control flow; the specific code that would have fired first for the E2E fixture was not executed (that would require a mutating run).
- 🔵 `docs/MVP-AUDIT-TECH-REPORT.md` and `docs/MVP-CLOSE-0-…md` contain a **stale claim** that `added_slc_loops` is an unconditional gate requirement (§6). Current code and its regression test contradict it. Treat those documents as inaccurate on this point.
- Concurrent lanes were active throughout (778 porcelain lines, treehash drifted during the audit). Findings are timestamped to the baselines recorded at the top of this report.
