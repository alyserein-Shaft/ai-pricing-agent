# MVP-BOM-5 — Governed Scope Commercial Flow

**Lane:** MVP-BOM-5 (implementation: Sizing → BOM CALCULATED_REQUIREMENT → SCOPE Commercial Source → Pricing → Commercial Approval → Quotation → Export)
**Date:** 2026-09-28
**Status:** 🔶 **IN PROGRESS — Phases 0 and 1 complete; Phases 2–13 pending.**
**Phase 1 verdict (this slice):** `safety_decision_id` for SCOPE = **NOT APPLICABLE** (matching-derived provenance). Genuine SCOPE engineering authority exists and is proven: the immutable **COMPLETED panel-sizing snapshot** created by human technical-approval actors from Approved evidence. No fabrication required. Implementation proceeds to Phase 2 (failing-before tests on the real schema) in a subsequent slice; no schema change has been made.

---

## 1. Mission obligations

Implement MVP-BOM-5 end-to-end — sizing-derived expansion hardware flows through
`Sizing → BOM CALCULATED_REQUIREMENT → SCOPE Commercial Source → Pricing → Commercial Approval → Quotation → Export` without fake BOQ items, fake candidate matches, fabricated safety decisions, prices, or auto-approval — while preserving every existing PRODUCT behavior.

Mandated phase order (verbatim, not renegotiated):
**P0** exact pre-migration schema (isolated fixtures) → **P1** safety contract (`REQUIRED`/`NOT APPLICABLE` with source evidence; STOP at the report if `REQUIRED` with no governed path) → **P2** failing-before tests on real schema → **P3** coordinated migration (`pricing_lines` first, then `project_quotation_lines`) → **P4** quotation rebuild → **P5** migration verification → **P6** normalized pricing input → **P7** `buildLineCostModel` refactor → **P8** SCOPE pricing → **P9** SCOPE quotations → **P10** approval gates → **P11** coverage gate → **P12** double-count review (deterministic blocker, never silent merge) → **P13** quote snapshot/export.

Hard rules carried into every phase:
- No product substitution: SCOPE rows use `source_product_id = product_id`; `candidate_id = NULL`; **no dummy candidates, BOQ items, or safety decisions**.
- SCOPE uniqueness is schema-level via a **partial UNIQUE index** `(pricing_run_id, engineering_scope_kind, system, source_product_id, source_role)` — no timestamps, no app-code-only enforcement.
- Currency policy exact: SAR→SAR 1:1, USD→SAR fixed 3.75, everything else fail-closed. No generic FX engine.
- No live-D1 migration; isolated fixtures only; zero live SCOPE/pricing/approvals/quotation/snapshot creation; runtime verification stays read-only.
- Preserve governance invariants: detected vs approved evidence, pricing inputs vs quotation outputs separation, audit/provenance trails.
- Do not absorb the Golden E2E blocker `PANEL_SIZING_SNAPSHOT_REQUIRED` (another lane) unless BOM-5 is directly proven to cause it.

---

## 2. Dirty-tree guard (recorded before any work)

| Item | Value |
|---|---|
| Repo root | `/Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an` |
| HEAD | `029b42637ac117f810e726b40c2e888c484c173b` |
| Dirty entries | 768 total — 563 `??` (untracked), 204 `M` (modified), 1 `D` (deleted) |
| Untracked dirs (top-level) | `app` (92), `tests` (266), `scripts` (61), `docs` (44), `worker` (34), `drizzle` (23), `drizzle-active`, `graphify-out`, `knarch1`, plus root-level `*.md` reports and `.agents/.claude/.serena/.local-evidence` |
| Concurrent-agent ownership | `worker/boq-line-bom-api.mjs`, `worker/quotation-line-authority.mjs`, `worker/fire-alarm-panel-sizing-api.mjs`, `app/domain/fire-alarm-panel-sizing-snapshot.mjs`, `app/domain/fire-alarm-slc-capacity-calculator.mjs`, `tests/mvp-bom-{2,4d,-sizing-1}*.mjs`, `docs/MVP-BOM-{2,3,4B,4D}-*.md` are other lanes' — read/reconcile, never overwrite or reformat. |
| Dev server | PID 66503 running; live D1 stated byte-identical (19,893 reqs / 23,622 clauses / 3,195 links / 139 approved). Never restart; never apply BOM-5 migrations to live. |

No commit, push, deploy, restart, reset, clean, stash, or checkout-over has occurred in this slice.

---

## 3. Phase 0 — exact pre-migration schema record

Sources: `drizzle-active/0000_baseline_schema_0082.sql` (the deployed baseline). Verified that **no** active migration `0001–0014` alters either table (exhaustive grep of the chain), so the deployed shape of both tables equals the baseline — identical in live D1 and in every fresh-chain isolated fixture.

### 3.1 `pricing_lines` (baseline L3362–3400)

29 columns. There are **no CHECK constraints and no triggers** on this table.

| Column | Nullability | FK / notes |
|---|---|---|
| `id` | NOT NULL | PRIMARY KEY |
| `pricing_run_id` | NOT NULL | → `pricing_runs(id)` |
| `project_id` | NOT NULL | → `projects(id)` |
| `boq_item_id` | NOT NULL | → `boq_items(id)` |
| `candidate_id` | NOT NULL | → `product_match_candidates(id)` |
| `product_id` | NOT NULL | → `library_products(id)` |
| `safety_decision_id` | NOT NULL | → `safety_decisions(id)` |
| `selected_price_record_id` | nullable | → `price_records(id)` |
| `version_number`, `status`, `quantity`, `unit`, `project_currency`, `output`, `explanation` | NOT NULL | status/quantity/unit/output are TEXT; version_number INTEGER |
| `source_currency` | nullable | — |
| monetary columns | nullable | original_list/ net_material_unit/ material_total/ direct_cost/ total_cost/ gross_selling/ customer_discount/ net_selling/ vat/ final_value (INTEGER minor), margin_basis_points/ markup_basis_points |
| `approval_ready` | NOT NULL DEFAULT false | integer boolean |
| `created_at` | NOT NULL DEFAULT CURRENT_TIMESTAMP | — |

Indexes:
- `pricing_lines_candidate_idx` — `(candidate_id, created_at)`
- `pricing_lines_project_status_idx` — `(project_id, status)`
- `pricing_lines_run_item_idx` — **UNIQUE `(pricing_run_id, boq_item_id)`** (the current SCOPE blocker: a single commercial price per BOQ item per run; inapplicable to BOQ-less rows)

Writer (single production INSERT): `worker/pricing-runtime.mjs:287` (29 placeholders). Binds `boqItemId`, `candidateId`, and **`input.safetyDecision?.id || ""` at L296 — an empty-string fallback, a third semantic state distinct from NULL and a real id**. The SCOPE writer must not inherit it (Phase 8). No UPDATE path touches the identity columns; rows are superseded via run versioning.

### 3.2 `project_quotation_lines` (baseline L4431–4467)

24 columns, `UNIQUE(quotation_revision_id, boq_item_id)` table constraint, **no CHECK constraints**.

| Column | Nullability | FK / notes |
|---|---|---|
| `id` | NOT NULL | PRIMARY KEY |
| `quotation_revision_id` | NOT NULL | → `project_quotation_revisions(id)` |
| `project_id` | NOT NULL | → `projects(id)` |
| `boq_item_id` | NOT NULL | → `boq_items(id)` |
| `sequence` | NOT NULL | INTEGER; default ordering key with `id` |
| `item_number`, `description` | nullable | — |
| `unit`, `quantity` | NOT NULL | TEXT (quantity is a string, per governed quantity decision) |
| `candidate_id` | NOT NULL | → `product_match_candidates(id)` |
| `product_id` | NOT NULL | → `library_products(id)` |
| `manufacturer_name`, `part_number`, `product_description` | NOT NULL | TEXT |
| `pricing_run_id`, `pricing_line_id`, `commercial_approval_id` | NOT NULL | → `pricing_runs` / `pricing_lines` / `pricing_approvals` |
| `pricing_run_version`, `pricing_line_version`, `commercial_approval_version` | NOT NULL | INTEGER |
| `pricing_input_fingerprint` | NOT NULL | TEXT |
| `currency`, `total_cost_minor`, `net_selling_minor` | NOT NULL | — |
| `source_snapshot_json` | NOT NULL | TEXT provenance annex; write-only, client-invisible (pinned by `tests/quotation-presenter.test.mjs:127-151`, `tests/quotation-api.test.mjs:183-193`) |
| `created_at` | NOT NULL DEFAULT CURRENT_TIMESTAMP | — |

Indexes (4):
- `quotation_lines_pricing_idx` — `(pricing_run_id, pricing_line_id)`
- `quotation_lines_product_idx` — `(product_id)`
- `quotation_lines_project_idx` — `(project_id, quotation_revision_id)`
- `quotation_lines_revision_idx` — `(quotation_revision_id, sequence)`

Triggers (immutability, unconditional):
- `quotation_line_snapshot_delete_guard` — BEFORE DELETE → `QUOTATION_LINE_SNAPSHOT_IMMUTABLE`
- `quotation_line_snapshot_update_guard` — BEFORE UPDATE → `QUOTATION_LINE_SNAPSHOT_IMMUTABLE`

Writer (single production INSERT): `worker/presales-workflow-api.mjs:124` (draft creation batch, L123–158). Binds `line.boqItemId` (L135), `line.candidateId` (L141), `line.productId` (L142). Revision writes: `presales-workflow-api.mjs:167` (INSERT), L166 (supersede prior Draft), L240 approve / L241 issue. No other production writer exists for either table (all other INSERT hits are in `tests/`).

**SQLite NULL caveat (load-bearing):** SQLite UNIQUE treats NULLs as distinct. Both `UNIQUE(quotation_revision_id, boq_item_id)` and `pricing_lines_run_item_idx` would silently stop applying to NULL-`boq_item_id` rows. Combined with the quotation-line immutability triggers (a wrongly-inserted SCOPE duplicate is permanently unfixable in place), the migration **must** use partial UNIQUE indexes (`WHERE boq_item_id IS NULL`) plus real NOT-NULL scope identity for SCOPE rows. This matches BOM-4B §5–§6 and the mission's schema-level mandate.

### 3.3 Chain head and pinned integrity counts

| Item | Value | Source |
|---|---|---|
| Active chain | `0000_baseline_schema_0082` … `0014_specification_clause_candidate_mechanism` (15 files, 15 journal entries) | `drizzle-active/meta/_journal.json` |
| `MIGRATION_VERSION` | `"0014_specification_clause_candidate_mechanism"` | `app/domain/production-readiness.mjs:24` |
| Manifest counts | 315 business tables / 461 named indexes / 43 triggers / 2 views (`canonical_classifications`, `canonical_library_products`) | `drizzle-active/manifest.json` |
| Baseline SQL object pins | 311 tables / 442 indexes / 30 triggers / 2 views in `0000_baseline_schema_0082.sql`; 315 tables in `db/schema.ts` | `tests/migration-baseline-safety.test.mjs:150-183, 168-178` |
| Legacy chain | 85 frozen `drizzle/` migrations, all ≤ 0082 cutoff, byte-preserved | `manifest.json.legacyMigrations` |

BOM-5 extends the chain with the coordinated migration (0015) and must advance `MIGRATION_VERSION` and any pinned counts in lockstep — Phase 5 verification gates.

### 3.4 Isolated-fixture row-count evidence (pre-migration)

Existing real-chain / schema-fixture tests that seed these tables (used as the row-count anchor for Phase 5 legacy preservation):

| Fixture | Table seeded | Rows |
|---|---|---|
| `tests/quotation-api.test.mjs:128-148` | `project_quotation_lines` | 2 (`ql1`,`ql2`; 25-column fixture) |
| `tests/quotation-line-authority.test.mjs:180` | `pricing_lines` | 1 (real chain) |
| `tests/r7-topology-concurrency.test.mjs:526` | `pricing_lines` | 1 (`pl1`) |
| `tests/excel-export-commercial-approval-authority.test.mjs:325` | `pricing_lines` (+ quotation snapshot rows) | 1 per case |
| `tests/mvp-bom-4d-expansion-pricing-currentness.test.mjs:267-…` | `pricing_lines` | N per test via `seedPricing(lines)` (real chain) |
| `tests/quotation-snapshot-export.test.mjs` | `project_quotation_lines` | dynamic per case |

All historical rows have valid `boq_item_id` + `product_id` (NOT NULL FKs), so the deterministic `'PRODUCT'` backfill (`source_type='PRODUCT'`, `source_product_id = product_id`) migrates every legacy row losslessly — proven at BOM-4B §10 and re-confirmed by the schema record above. Zero inference required.

---

## 4. Phase 1 — `safety_decision_id` contract

### 4.1 What the column is

`safety_decisions` (baseline L5101–5130) is **matching-derived**: `boq_item_id` NOT NULL → `boq_items`, `candidate_id` → `product_match_candidates`, plus `requirement_profile_version_id`, `match_run_id`, `version_number`, `input_fingerprint`, `safety_state`, `compliance_state`, `technical_eligibility`, `price_eligibility`, `provenance_status`, `superseded_at`. Its purpose is per-(boq_item, candidate) engineering-safety provenance produced by product matching / confidence-safety. `pricing_lines.safety_decision_id` (NOT NULL) is the pricing line's record of which safety decision the matched candidate had at pricing time.

### 4.2 Writer trace

Single production writer: `worker/pricing-runtime.mjs:287`, bind at L296 = `input.safetyDecision?.id || ""` (empty-string fallback). The value is always derived from the candidate safety decision that `loadPricingInput` (`pricing-runtime.mjs:42`, gates at L67–101) requires for the PRODUCT path (`SAFETY_DECISION_REQUIRED`). **There is no path that creates a safety decision for a BOQ-less, candidate-less SCOPE requirement, and there should not be one** — that would be fabricated provenance.

### 4.3 Consumer trace — classification (reconciled with read-only consumer inventory, Subagent A)

Every consumer of `pricing_lines.safety_decision_id`:

| Consumer | Behavior | Class |
|---|---|---|
| `worker/pricing-authority.mjs:45` (`loadCanonicalPricingLine`) | returns `safetyDecisionId`; `CURRENT_PRICING_PREDICATE` (L3–12) never gates on it | carry-through (NULL-safe) |
| `worker/quotation-line-authority.mjs` (via `loadCanonicalPricingLine`) | placed only in `sourceSnapshot.safetyDecisionId`, a write-only annex | carry-through |
| `worker/excel-export-api.mjs:173,178` | `LEFT JOIN safety_decisions sd ON sd.id=l.safety_decision_id`; NULL ⇒ blank safety/technical-approval fields, no row loss | LEFT JOIN — NULL-safe, semantically lossy surface → Phase 13 must add a "Scope Engineering Authority" affordance |
| `worker/pricing-engine.mjs:259` (domain) | `approval_ready` blockers `TECHNICAL_APPROVAL_REQUIRED` / `SAFETY_PRICE_ELIGIBILITY_REQUIRED` consume **normalized input**, not the column | Input-side gate → Phase 6/7 generalization point |
| `worker/pricing-api.mjs:839-850` | reads `safety_decisions`/`product_match_runs` via candidate, not the pricing-line column | not a column consumer |

**No WHERE / equality / grouping consumer of `pricing_lines.safety_decision_id` exists.** Zero hard gates are keyed on it. Commercial Price approval (`pricing-api.mjs:1262`) is **run-level and safety-independent** (requires `approval_ready=1`, human decision, reason length; no candidate/safety read).

### 4.4 Genuine SCOPE engineering-authority successor (proven, not invented)

The SCOPE counterpart of the matching/safety decision is the **immutable COMPLETED panel-sizing snapshot**:

- Created only by actors with `canApproveTechnicalSafety(project.project_role)` — `worker/fire-alarm-panel-sizing-api.mjs:554` (403 otherwise: `PANEL_SIZING_TECHNICAL_AUTHORITY_REQUIRED`).
- Built exclusively from **Approved evidence** chains: `CURRENT_APPROVED_BOQ_ITEM_REQUIRED`, `CURRENT_APPROVED_ARCHITECTURE_REQUIRED` (approved architecture version), `APPROVED_CAPACITY_EVIDENCE_REQUIRED`, `CURRENT_APPROVED_PANEL_SELECTION_REQUIRED`, `APPROVED_EXPANSION_EVIDENCE_REQUIRED` (API L71–158 region).
- Persisted append-only with `version_number`, `input_fingerprint`, `status='COMPLETED'`, `engine_version`, `created_by`, and **immutability triggers** (`0004_fire_alarm_panel_sizing_snapshots.sql`: BEFORE UPDATE/DELETE → ABORT; UNIQUE `(project_id, version_number)`).
- The BOM reader (`worker/boq-line-bom-api.mjs:139-152`, `loadExpansionRequirement`) resolves the exact `CALCULATED_REQUIREMENT` (product identities + calculated quantity) from this snapshot — the evidence BOM-5 consumes.

This is the real, human-approved engineering-decision chain that `source_snapshot_id` + `source_fingerprint` must pin on SCOPE commercial lines (per BOM-3 §5 and the mission). A `product_id`-keyed coverage predicate already exists for it in `quotation-line-authority.mjs:153-166` (`expansionCoverageBlockers`), and the snapshot identity already participates in the quotation-evidence fingerprint (`quotation-evidence.mjs` `panelSizingAuthority.current` — Subagent C §8), so currentness for SCOPE reuses the existing model exactly.

### 4.5 Phase 1 verdict

> **SCOPE `safety_decision_id`: NOT APPLICABLE** (as candidate/matching safety provenance).
> The genuine successor authority is the COMPLETED panel-sizing snapshot (human technical-approval role, Approved-evidence chain, fingerprint/version/immutability). `pricing_lines.safety_decision_id` therefore becomes **nullable** for SCOPE, enforced by a source-type CHECK — PRODUCT ⇒ NOT NULL (exactly preserved); SCOPE ⇒ NULL (never fabricated, and never carrying a matching-derived id — that would itself be false provenance). Commercial approval remains run-level and safety-independent; nothing automates or fabricates a safety decision.

Implementation consequence (Phase 3 mechanics, not re-opened): the CHECK must be source-type-conditional, and the `approval_ready` blockers at `pricing-engine.mjs:259` become **input-side** generalization work in Phase 6/7 — a SCOPE line whose normalized input lacks the snapshot-based engineering approval must fail closed with `approval_ready=false`, so it cannot reach Commercial approval unpriced/unapproved. That keeps the fail-closed direction without fabricating a safety decision identity.

### 4.6 Caveats carried to later phases (recorded now, not repaired early)

1. **Export surface (Phase 13):** the governed snapshot export reads `project_quotation_lines` directly (`excel-export-api.mjs:71`, `buildQuotationSnapshotRows`) — SCOPE lines flow through once present; but the SOD/BOQ-keyed export (`excel-export-api.mjs:132-165`) and the per-row `Missing Technical Approval` warning (`engine L94…`) need a SCOPE affordance, and `loadCurrentExportPricingVersion`/`loadCurrentPricingComponents` need the scope-identity generalization of the currentness predicate.
2. **Empty-string trap (Phase 8):** the SCOPE writer must write SQL NULL, never `"..."` (the `pricing-runtime.mjs:296` pattern).
3. **Input-side blockers (Phase 6/7):** `TECHNICAL_APPROVAL_REQUIRED` / `SAFETY_PRICE_ELIGIBILITY_REQUIRED` are PRODUCT-shaped; the normalized SCOPE input supplies the snapshot engineering authority instead, preserving fail-closed.
4. **Quotation-evidence manifest (Phase 9/10):** the manifest is per-BOQ-item; SCOPE coverage needs an explicit section (follow the `tests/quotation-panel-authority-fingerprint.test.mjs` precedent) or SCOPE quotations would be unrepresentable in the evidence fingerprint.

---

## 5. Consumer-risk inventory for SCOPE provenance (reconciled, Subagent A)

Highest-risk consumers with NULL `boq_item_id`/`candidate_id` for SCOPE rows — mapped to the phase that must address them (record now; fix in-phase):

| Tier | Consumer | Why | Phase |
|---|---|---|---|
| 1 | `pricing-authority.mjs:11,18,47,49` — `CURRENT_PRICING_PREDICATE` uses `l2.boq_item_id=l.boq_item_id` (NULL= NULL false) + inner `JOIN currentBoqEvidenceFrom ON b.id=l.boq_item_id` | every canonical pricing read drops SCOPE; `QUOTATION_TOTAL_RECONCILIATION_FAILED` (`presales-workflow-api.mjs:69-84`) fires on any quotation containing SCOPE | P6/P8/P9/P10 |
| 1 | `quotation-line-authority.mjs:349` — `ready = blockers.length===0 && lines.length===boqItems.length`; `presales-workflow-api.mjs:62-67` → 409 | structural; must define BOQ coverage **plus** SCOPE coverage, not relax | P9 |
| 1 | `pricing_lines_run_item_idx` + `UNIQUE(quotation_revision_id, boq_item_id)` | become no-ops under SQLite NULL-distinct; partial UNIQUE + real scope key required | P3/P4 |
| 1 | `pricing-runtime.mjs:243` idempotency lookup `AND l.boq_item_id=?` | SCOPE replay re-inserts every time; also breaks stale-run check `pricing-api.mjs:1131-1147` | P6/P8 |
| 2 | `excel-export-api.mjs:30,33,36` `COALESCE(MAX(version),0)` → 0; L153 LEFT JOIN drops SCOPE rows | bogus "Approved snapshot v0" stamp; silent omission | P13 |
| 2 | `excel-export-api.mjs:173,178` LEFT JOIN safety | blank safety provenance, no warning | P13 |
| 2 | `dashboard-api.mjs:209-253` `COUNT(DISTINCT boq_item_id)` inner-joined | SCOPE coverage uncountable | P10 (counters) |
| 2 | `pricing-api.mjs:1208` `itemId: runLines[0].boq_item_id` | undefined approval target if first line is SCOPE (order-sensitive) | P10 |
| 2 | Fingerprints `presales-workflow-api.mjs:93-114` + `excel-export-api.mjs:38-65` | both must carry scope identity in lockstep or every export fails `QUOTATION_FINGERPRINT_MISMATCH` | P9/P13 |
| 3 | `quotation-evidence.mjs:49` per-BOQ loop | SCOPE needs manifest section | P9/P10 |
| 3 | `pricing-runtime.mjs:296` empty-string fallback | must become NULL for SCOPE | P8 |
| 3 | `quotation-line-authority.mjs:300` sequence copy | scope lines need explicit sequence policy / `(source_type, sequence, id)` sort | P9 |
| (safe) | `quotation-line-authority.mjs:153-166` coverage (product-keyed), `identity-production-governance.mjs:87`, `quotation-presenter.mjs`, `excel-export-engine.mjs:117-146` | already carry the SCOPE shape or are id-free | — |

---

## 6. Architecture alignment (carried verbatim; deviations recorded, not silent)

Carried from earlier lanes without re-litigating, per the mission mandate:
- **BOM-3** (`docs/MVP-BOM-3-COMMERCIAL-SCOPE-REPRESENTATION.md`): Candidate B — generalize the existing commercial line (`source_type`, nullable `boq_item_id`, `source_snapshot_id`, `source_fingerprint`, `source_product_id`, source-type CHECK). Stop-condition boundary accepted; BOM-5 implements the migration it scheduled.
- **BOM-4B** (`docs/MVP-BOM-4B-COMMERCIAL-SOURCE-CONTRACT.md`): logical identity `(project_id, source_type, engineering_scope_kind, system, source_product_id, source_role)` with snapshot ID as provenance, not identity; price-vs-quantity authority split; double-counting policy (flag, never silent merge) = Phase 12; currentness = `source_fingerprint == current snapshot input_fingerprint`; reconstruction inventory (4 indexes + 2 triggers + partial UNIQUE). All adopted.

**Recorded deviations from BOM-4B drafts (mission-mandated, not re-opened):**
1. **Migration order:** BOM-4B §16 listed quotation rebuild first, then pricing. The mission mandates **`pricing_lines` first, then `project_quotation_lines`** — still one coordinated migration contract, never half-generalized. Order recorded as a deliberate mission-level override.
2. **`candidate_id` nullability:** BOM-4B §14's draft kept `candidate_id TEXT NOT NULL`. The mission requires `candidate_id = NULL` for SCOPE (no dummy candidates) — enforced by the same source-type CHECK pattern as `safety_decision_id` (PRODUCT NOT NULL, SCOPE NULL).
3. **Safety contract:** BOM-4B did not address pricing-line `safety_decision_id`; Phase 1 of this mission answers it (NOT APPLICABLE, §4.5).
4. **No timestamps** in the SCOPE uniqueness key (mission), vs BOM-4B's partial-index sketch which listed no timestamps either — consistent.
5. **Scope uniqueness key:** mission lists `(pricing_run_id, engineering_scope_kind, system, source_product_id, source_role)`; BOM-4B adds a redundant `source_type` prefix. Under the `WHERE boq_item_id IS NULL` partial clause both are equivalent; final column list is a Phase 3 mechanics decision, recorded now.

---

## 7. Verification state and non-goals

- **Tests run this slice:** none executed (read-only phase). Baseline targets for Phase 2/11 are the existing real-chain gates that must keep passing: `tests/mvp-bom-4d-expansion-pricing-currentness.test.mjs` (8/8 coverage gate), `tests/mvp-bom-2-expansion-identity.test.mjs`, `tests/mvp-sizing-1-expansion-evidence-laziness.test.mjs`, plus `tests/migration-baseline-safety.test.mjs` and `tests/migration-chain-verification.test.mjs` (chain integrity).
- **Known unrelated** `test:all` residue (BOM-4D baseline): `boq-line-bom-summary`, `review-workflow-atomic`, `document-governing-version.integration` — not repaired opportunistically; re-baselined at the start of the next slice per BOM-4D protocol.
- **Non-goals (unchanged):** no specification CLOSE work, no 59-approval recovery, no matching or sizing-math changes, no service/labor scope, no substitution, no fabricated provenance, no unrelated test fixes.

---

## 8. Interim end statements (Phase 0 + Phase 1 slice)

- **Best Agent:** Big Pickle (primary; owns coordinated migration, shared commercial files, final evidence). **Why:** only agent with the full BOM-5 phase chain and dirty-tree/ownership map; subagents A (consumer inventory) and C (quotation path) completed read-only and are reconciled above. **Fallback:** Nemotron 3 Ultra (bounded read-only corroboration; no migration authority).
- **Verdict (this slice):** Phase 1 = **NOT APPLICABLE** for SCOPE `safety_decision_id`; mission proceeds to Phase 2 (failing-before tests on the real schema) in the next slice. Overall mission still IN PROGRESS.
- No live migration was applied. No live pricing was created or altered. No live approval was created or altered. No live quotation or snapshot was created or altered. No export ran. No commit/push/deploy was made. No dev server was restarted. No business-state mutation occurred. The only write in this slice is this report.

> Next slice: Phase 2 — failing-before tests on the real schema using `tests/helpers/active-chain.mjs` (open in-memory DB from the actual chain; assert SCOPE-row creation is rejected today by the NOT NULL constraint surface, per subagent A's write-path inventory), then P3 coordinated migration.

---

## 9. Phase 2 — failing-before schema tests (RED evidence, pre-journal)

**Contract.** `tests/mvp-bom-5-scope-schema.test.mjs` (13 tests) builds a throwaway in-memory database from the **actual** pre-0015 chain (`openEmptyDatabase` + `applyActiveChain` + `seedProductGraph`), then exercises the generalized source model through the shared real-chain seed helpers (`tests/fixtures/mvp-bom-5-seed.mjs`). The fixture helpers unconditionally write the 7 new source-identity columns, because the failing-before proof is that **none of the generalized model is representable before 0015** — even a valid PRODUCT row cannot be written.

**RED result** (captured before the journal entry landed; artifact `mvp-bom5-phase2-red.txt`):

```
ℹ pass 1   ℹ fail 12
```

| Outcome | Tests |
|---|---|
| **12 failing** | all SCOPE-acceptance, PRODUCT-acceptance, mismatch/incomplete/duplicate rejections, quotation acceptance and immutability tests |
| **1 passing** | `legacy-shaped SCOPE pricing row (omitting the source columns) is rejected` — a stability contract: a legacy-shaped row must be rejected on **both** sides of the migration |

**Representative failure** (occurs 17× across the 12 tests):

```
Error: table pricing_lines has no column named source_type
    at insertProductPricingLine (.../tests/fixtures/mvp-bom-5-seed.mjs:79:7)
```

The single passing test proves the rejection contract is stable pre-migration: the generalized model is *entirely* unrepresentable until 0015 lands, and the rejection tests (`assert.throws(..., /constraint/i)`, deliberately message-loose) are designed to pass on both sides so they can never be "red because the safety net broke."

---

## 10. Phase 3 — coordinated migration `0015_pricing_quotation_scope_source_model`

**File:** `drizzle-active/0015_pricing_quotation_scope_source_model.sql` (journal idx 15, per-entry version `9`).

**Contract preserved (mission):** `boq_item_id`/`candidate_id`/`safety_decision_id` become nullable **only** for the SCOPE branch; PRODUCT provenance stays NOT NULL by CHECK; `source_product_id = product_id` both branches; schema-level partial UNIQUEs (no application-level enforcement); no FKs on the new SCOPE text columns; every legacy row (all have full PRODUCT provenance pre-migration) backfills to `source_type='PRODUCT'`, scope identity `NULL`, `source_product_id=product_id`.

**Mechanics.** Both execution shapes a migrator actually uses are supported, after the validated discovery that `defer_foreign_keys` does **not** defer a `DROP TABLE`'s implicit DELETE and `PRAGMA foreign_keys=OFF` is a no-op inside a transaction:

- **Transactional shape** (applyTag): inside the migration's transaction — `PRAGMA defer_foreign_keys=ON` → `CREATE <table>_new` → `INSERT…SELECT` copy+backfill → `DELETE FROM <table>` (deferred, succeeds) → `DROP TABLE <table>` (now empty, succeeds) → `ALTER TABLE <table>_new RENAME TO <table>` → recreate all indexes and triggers → `COMMIT` (deferred FK re-check proves every child still resolves against the renamed table; a dropped id correctly aborts and rolls back atomically).
- **Autocommit shape** (fixtures, D1/Drizzle runner): `PRAGMA foreign_keys=OFF/ON` is effective per statement, so the same rebuild applies with FK off and the final `PRAGMA foreign_keys=ON` restores enforcement.

Both pragma sets appear in the file in order: `defer ON` + `FK OFF` at top, `FK ON` + `defer OFF` as the final two statements — each is a no-op in the shape where the other governs. Published gate output: `drizzle-active/0000`..`0014` + `0015` verified to apply in all three shapes (below).

**Bug found by validation.** The quotation table's immutability guards would abort the `DELETE` that precedes the rebuild (triggers are never FK-deferrable). The migration drops `quotation_line_snapshot_delete_guard`/`_update_guard` immediately before the DELETE and recreates them (`CREATE TRIGGER IF NOT EXISTS`) after the RENAME — the table is empty and unreachable in between.

**Reconstruction shape counts (validated pre-journal, `validate-0015.mjs`):** Channel A (fresh chain, transactional): integrity ok, `foreign_key_check` clean, named indexes 461→463, both scope UNIQUEs present and partial, 2 quotation triggers recreated. Channel B (upgrade with live legacy rows + children): preservation, backfill determinism, `PRAGMA foreign_key_check` clean, SCOPE accepted, duplicate/mismatch/incomplete rejected, PRODUCT strictness retained. Channel C (autocommit, verifier shape): clean, probe table proves FK enforcement restored ON.

---

## 11. Phase 4 — reconstruction verification

`tests/mvp-bom-5-migration-proof.test.mjs` (3 tests) proves the rebuilt tables on a fresh chain:

- **pricing_lines** (37 columns): `boq_item_id`/`candidate_id`/`safety_decision_id` nullable; `source_type`/`source_product_id` NOT NULL; the 7 FK pairs intact (`PRAGMA foreign_key_list`); index set = 3 historical + `pricing_lines_scope_uniq` (unique=1, partial=1) + PK autoindex (origin `pk`); CHECK text present in `sqlite_master` and behaviorally live (mismatch → rejected, PRODUCT-without-boq → rejected, SCOPE-incomplete → rejected).
- **project_quotation_lines** (33 columns): nullable boq/candidate; NOT NULL `source_type`/`source_product_id`; 8 FK pairs intact (including `pricing_line_id → pricing_lines.id` and `commercial_approval_id → pricing_approvals.id`); 4 historical indexes + `quotation_lines_scope_uniq` (unique=1, partial=1) + PK autoindex + table-level `UNIQUE(revision, boq)` autoindex (origin `u`) — the table-level UNIQUE still rejects a duplicate revision+boq; both immutability triggers recreated, UPDATE/DELETE rejected, INSERT allowed.

---

## 12. Phase 5 — migration proof (upgrade fixture + negative controls)

The 14th contract item — **legacy preservation** — lives here because it is the only place pre-migration rows exist. `applyChainAround("0015_pricing_quotation_scope_source_model", legacySeed)` holds 0015 back, seeds a pre-migration database with legacy-shaped rows (30-column pricing line, 26-column quotation line) **and** child rows referencing `pricing_lines(id)` — `pricing_cost_components` (NOT NULL FK) and `pricing_approvals` (nullable FK) — then applies 0015 and asserts:

- `PRAGMA integrity_check` ok and `PRAGMA foreign_key_check` empty; FK enforcement still ON;
- the legacy pricing line survives under its original id with the deterministic PRODUCT backfill (`source_type='PRODUCT'`, `source_product_id=product_id`, scope identity all NULL);
- the legacy quotation line survives with the same backfill; counts unchanged (copy, neither drop nor duplicate);
- both child rows still resolve against the **renamed** table (the deferred-COMMIT re-check did its job);
- the generalized model is usable on the *same upgraded database* (SCOPE pricing + quotation accepted; duplicate SCOPE rejected; SCOPE mismatch and PRODUCT-without-boq rejected);
- immutability guards were recreated on the renamed quotation table (UPDATE/DELETE rejected post-upgrade).

**R8 gate alignment.** `tests/review-migration-apply-safety.test.mjs` "no active migration drops a table that another table points at" was written when the *only* known drop mechanism — `PRAGMA foreign_keys=OFF` — was a transaction no-op, so it flatly forbade drops with inbound FKs. 0015 is the first migration that legitimately rebuilds a referenced table, so the gate now encodes the proven safe-rebuild discipline instead: a drop with inbound references is allowed **only** when the same migration performs `CREATE <table>_new` → `INSERT…SELECT` copy → `PRAGMA defer_foreign_keys=ON` → `DELETE` (empty) → `DROP` → `RENAME`, and re-creates indexes/triggers. Verified both ways: the full discipline passes; removing any one step — including the old C1 shape (`FK OFF` only, no DELETE) — is still rejected. `safeRebuildEvidence` mirrors exactly what `tests/mvp-bom-5-migration-proof.test.mjs` proves against live rows.

---

## 13. Lockstep pin advancement (truthful values only)

| Pin | Before | After |
|---|---|---|
| `drizzle-active/meta/_journal.json` | head 0014 / version `8` | idx 15, tag `0015_pricing_quotation_scope_source_model`, version `9`, breakpoints true |
| `drizzle-active/manifest.json` | `namedIndexes` 461, cutoff `0014_…` | `463`; cutoff `0015_…`; +2 index entries (both partial UNIQUEs, `tail: WHERE boq_item_id IS NULL`); pricing_lines/quotation_lines table sources → `drizzle-active/0015_…`, columns +7 each, boq/candidate(/safety) loose |
| `drizzle-active/meta/0015_snapshot.json` | — | clone of `0014_snapshot.json` patched for exactly the two tables; new id `cd133051-b894-4798-93b3-b4057ec666fe`; `prevId` = 0014's `233aff8a-…` (chain intact) |
| `db/schema.ts` | `check` not imported; strict columns | `check` imported; `pricingLines` + `projectQuotationLines` generalized, `check()` branch-CHECK + partial `uniqueIndex(…).where(sql`boq_item_id IS NULL`)` |
| `app/domain/production-readiness.mjs` | `MIGRATION_VERSION` 0014 | `0015_pricing_quotation_scope_source_model` |
| `tests/migration-baseline-safety.test.mjs` | chain 0014-head, 461/461 | chain +0015 entry, `namedIndexes`/`sourceIndexes` 463 with derivation comment (+2 = the two scope UNIQUEs) |
| `tests/mvp-bom-4d-expansion-pricing-currentness.test.mjs` | 30-col pricing_lines INSERT | +7 columns (PRODUCT backfill shape) — the only real-chain pricing line seeder |
| `scripts/test-classification-baseline.json` | — | +`tests/mvp-bom-5-migration-proof.test.mjs|SAFE` (CHAIN_FIXTURE class; throwaway temp DB, no persistent D1) via `--write-baseline` |

No historical migration and no `docs/MVP-CLOSE-13` content were edited.

## Verification results after 0015 landed

- `tests/mvp-bom-5-scope-schema.test.mjs` — **12/13 → 13/13 green** (the failing-before contract flipped).
- `tests/mvp-bom-5-migration-proof.test.mjs` — 3/3 green (new).
- `tests/migration-baseline-safety.test.mjs`, `tests/migration-chain-verification.test.mjs`, `tests/review-migration-apply-safety.test.mjs` (R8), `tests/mvp-bom-4d-expansion-pricing-currentness.test.mjs` — green.
- `npm run test:all` — **3967 pass / 3 fail**, and all three are the documented pre-existing residues of other lanes: `boq-line-bom-summary` ×2 (un-mocked `fire_alarm_panel_sizing_snapshots` fixture-double gap, the `PANEL_SIZING_SNAPSHOT_REQUIRED` blocker) and `review-workflow-atomic` (MVP-CLOSE-11-era unsorted `spec_clauses_admission_status_idx` manifest entry, position 431 — untouched by this slice; this slice's two new index entries are in sorted position). REL-003 drift gate passes.
- Targeted suites — `test:phase2` 73/73, `test:phase3` 110/110, `test:phase5c` 66/66, `test:phase6a` 25/25, `test:identity` 27 pass/0 fail (13 skipped), `test:due` 24/24.
- Golden gates — `test:fire-alarm-golden` and `test:cctv-golden` both **PASSED**.
- `npm run build` succeeds; `eslint` on every file this slice touched: 0 problems (the 112 repo-wide errors are pre-existing, all outside this slice's files).

## Position and remaining phases

**STOP per mandate after Phase 5.** Phases 6–13 remain deferred: normalized pricing input, `buildLineCostModel`, SCOPE pricing/quotation/approval/export flow, and the generalization of the PRODUCT writers (`worker/pricing-runtime.mjs` etc., which today fail-closed against the migrated schema until Phase 6 — the designated generalization point recorded in Phase 1 at `pricing-engine.mjs:259`). No competing report was written; `worker/quotation-line-authority.mjs` remains concurrent-agent-owned and untouched.

**Interim end statements (Phases 2–5 slice):**
- **Verdict (this slice):** Phases 2–5 complete and green; failing-before evidence (12/13 red) captured truthfully, migration `0015` validated in all three execution shapes, reconstruction + upgrade-with-rows proof green, all pins advanced to truthful new values.
- **No live migration was applied. No live pricing was created or altered. No live approval was created or altered. No live quotation or snapshot was created or altered. No export ran. No commit/push/deploy was made. No dev server was restarted (PID 66503 untouched). No business-state mutation occurred. The only writes in this slice are the migration file, the evaluated tests, the advanced pins, the re-recorded classification baseline, and this report.**

**Post-verification observation (concurrent lane, not this slice):** after the green-after evidence above was captured (journal verified at head `0015`), the concurrent specification-clause lane advanced `drizzle-active/meta/_journal.json` to idx 16 (`0016_specification_clause_candidate_decisions`) and landed their migration SQL — but had not yet landed `meta/0016_snapshot.json` or the matching manifest head/count pins at the time of this final review. Consequence, attributed with evidence and deliberately untouched:

- `tests/migration-baseline-safety.test.mjs` — `active Drizzle metadata is a fresh baseline…` fails `ENOENT …/meta/0016_snapshot.json`; `active manifest freezes the canonical 0084 target…` fails on the manifest head entry it expects vs. the lane's in-flight head.
- `tests/migration-chain-verification.test.mjs` — applied chain now produces **316** business tables while the lane's not-yet-advanced manifest still records **315**.

This slice re-verified its own gates against the current (0016-included) chain after that lane activity: `mvp-bom-5-scope-schema` 13/13, `mvp-bom-5-migration-proof` 3/3, `review-migration-apply-safety` (R8) 5/5, `mvp-bom-4d` 8/8 — all green. No file owned by the concurrent lane was modified by this slice.

---

## 14. Phases 6–8 — SCOPE pricing end-to-end on the single cost model

The SCOPE pricing slice lands on top of the migrated 0015 schema exactly where Phase 1 designated (`pricing-engine.mjs:259`). A pricing requirement derived entirely from the current **COMPLETED** panel-sizing snapshot (no BOQ item, no match candidate, no safety decision — all persisted as SQL NULL) is normalized into the *identical* `calculatePricingLine` input shape PRODUCT pricing uses, priced by the *same* engine and cost model, persisted by logical identity, re-verified for currentness at approval, and shown alongside PRODUCT lines in the read surfaces. Every PRODUCT gate stays byte-identical.

### Failing-before evidence (captured before any Phase 6–8 edit)

| # | Probe | Pre-implementation result |
|---|---|---|
| 1 | Test-suite collection | `ERR_MODULE_NOT_FOUND` — `worker/scope-pricing-input.mjs` does not exist |
| 2 | SCOPE-shape `persistRun` write (real 0015 chain) | `NOT NULL constraint failed: pricing_lines.source_type` (the 29-column INSERT omits the 0015 NOT NULL source columns) |
| 3 | `persistRun` idempotency lookup for a NULL-`boq_item_id` SCOPE line | `null` — `l.boq_item_id=?` can never match a NULL-boq line, so an identical replay would duplicate the line |
| 4 | `loadCanonicalPricingTotals` with an approved current SCOPE line | `{"costMinor":0,"subtotalMinor":0,"lineCount":0}` — the boq INNER JOIN silently drops SCOPE lines |
| 5 | Approving a SCOPE run | `409 STALE_PRICING_COST` ("Current Cost Build-Up is no longer complete") — the approval path rebuilds the cost from `runLines[0].boq_item_id` (NULL) and can never reach a decision |

### Phase 6 — normalized SCOPE pricing input (`worker/scope-pricing-input.mjs`, new)

- Exports: `SCOPE_KIND_PANEL_SIZING="PANEL_SIZING_EXPANSION"`, `SCOPE_ROLE_LOOP_EXPANSION_UNIT`, `SCOPE_ROLE_MOUNTING_UNIT`, `resolveScopePricingRequirements`, `loadScopePricingInput`, `assertScopePricingFreshness`, `buildScopeAuthoritativeCost`.
- Requirement resolution: latest panel-sizing snapshot must exist **and** be `COMPLETED` (missing vs. non-COMPLETED are distinct codes); the sizing payload must carry an `AUTHORITATIVE_PANEL_SIZING` result. Loop quantities come from each panel's `requiredExpansionQuantity` summed per `(source_role, source_product_id)`; mounting quantities from `mountingUnit.quantity` (defaulting to `requiredExpansionQuantity`). A no-expansion proof fails closed with `NO_EXPANSION_REQUIRED`.
- Identity key: `engineering_scope_kind` + `system` + `source_product_id` + `source_role`. If the current snapshot no longer resolves the requested identity (or the product for a role changed), it fails closed with `SCOPE_REQUIREMENT_NOT_CURRENT` / `NO_REQUIREMENT_FOUND` / `SCOPE_IDENTITY_REQUIRED`.
- Price evidence is **not** a new source: the adapter loads the same governed `price_records` (`Approved` + `Costing`, exact `product_id`, validity via the exported `priceValidity`) the PRODUCT path costs from.
- The normalized input carries `technicalAuthority.validated: true` keyed to the snapshot id/fingerprint, `source.type="SCOPE"` with the identity + provenance (`snapshotId`, `snapshotVersionNumber`, `snapshotFingerprint`), and `safetyDecision: null`. Failure codes: `SCOPE_SNAPSHOT_REQUIRED`, `SCOPE_SNAPSHOT_NOT_COMPLETED`, `SCOPE_SYSTEM_REQUIRED`, `SCOPE_CALCULATION_UNREADABLE`, `NO_EXPANSION_REQUIRED`, `NO_REQUIREMENT_FOUND`, `SCOPE_IDENTITY_REQUIRED`, `SCOPE_REQUIREMENT_NOT_CURRENT`.

### Phase 7 — single cost model (engine gate, `pricing-engine.mjs:259`)

- The `calculatePricingLine` gate is source-aware but the model is one: a SCOPE input (`input.source?.type === "SCOPE"`) gates only on `SCOPE_SIZING_AUTHORITY_REQUIRED` when `technicalAuthority.validated !== true`; PRODUCT inputs keep the two existing gates (`TECHNICAL_APPROVAL_REQUIRED`, `SAFETY_PRICE_ELIGIBILITY_REQUIRED`) verbatim. Every other engine path (price-source selection, discounts, conversions, cost build-up, selling/VAT math) is unchanged and shared.
- Currency: SAR→SAR stays 1:1; USD→SAR uses the governed fixed 3.75 rate; any other source currency fails closed via the engine's unwrapped `convertCurrency` throw (`UNSUPPORTED_CURRENCY`), asserted with `assert.throws`.
- Identical commercial inputs (same product, quantity, price source, currency) produce byte-identical math on the SCOPE and PRODUCT paths — asserted field-by-field in the suite.

### Phase 8 — persistence, currentness, approval, display

- `worker/pricing-runtime.mjs` `persistRun`: source-aware idempotency. PRODUCT keeps `l.boq_item_id=?` byte-identical; SCOPE keys on the engineering identity + `source_type='SCOPE'` with MAX version. Both branches keep the run/line/output column shapes the API contract asserts. The INSERT grows 29→36 columns — the 7 source columns sit between `explanation` and `approval_ready`, `approval_ready` stays last, the first 28 binds are unchanged, the safety bind becomes `?? null`, and `source_product_id` always equals `input.productId`. SCOPE runs write NULL `boq_item_id`/`candidate_id`/`safety_decision_id` plus the snapshot id/fingerprint on the line.
- `worker/pricing-authority.mjs`: `CURRENT_PRICING_PREDICATE` and `loadCanonicalPricingLine` are untouched. `loadCanonicalPricingTotals` runs the existing PRODUCT query unchanged **plus** a summed SCOPE query keyed on `(kind, system, source_product_id, source_role)` with MAX-version currentness, `approval_ready=1`, no supersession, and the same excluded statuses.
- `worker/pricing-api.mjs`: all three display routes (commercial-summary, summary, compare) `LEFT JOIN` the boq evidence and add a source-aware OR-branch keying the MAX-version subquery per source; `staleLine` EXISTS becomes a source-aware OR (each branch filters `l2.source_type=`); the approval `runLines[0]` read determines SCOPE vs PRODUCT. Approval keeps the lock gate **first** (missing lock → `409 STALE_PRICING_COST`; SCOPE additionally requires a SCOPE-tagged lock), then branches freshness: PRODUCT keeps `buildLineCostModel` + `assertCommercialCostFreshness` byte-identical; SCOPE uses `assertScopePricingFreshness` (latest snapshot id+fingerprint match, requirement identity + quantity match against the current snapshot, selected price record still governed), yielding `SCOPE_SNAPSHOT_NOT_CURRENT`, `SCOPE_REQUIREMENT_NOT_CURRENT`, or `STALE_PRICING_COST`.
- Mock-DDL alignment (SQLite compiles whole statements, so the executing mocks needed the 5 source columns — `source_type TEXT NOT NULL DEFAULT 'PRODUCT'` + 4 nullable identity columns; their SQL never touches `source_snapshot_id`/`source_fingerprint`): `pricing-scenario-authority.test.mjs:120`, `quotation-authority.test.mjs:114` (+ its positional 14→19 value insert with the deterministic PRODUCT backfill), `pricing-input-authority.test.mjs:165`. Totals/display/stale-line/approval behavior in those suites is unchanged (PRODUCT-only rows).

### Verification results after Phases 6–8

- `tests/mvp-bom-5-scope-pricing-commercial-flow.test.mjs` (new, real chain, 25 tests): **RED (module-not-found) → GREEN 25/25**. Covers Phase 6 (6), Phase 7 (5, incl. PRODUCT-equivalence, USD 3.75, EUR fail-closed, revoked authority), Phase 8 persistence/idempotency/currentness/approval/display (11), and PRODUCT regressions (3: PRODUCT load fails closed without a BOQ item, PRODUCT gates preserved, PRODUCT persist backfills source identity).
- Regression ladder: `test:phase2` 73/73, `test:phase3` 110/110, `test:phase5c` 66/66, `test:phase6a` 25/25; pricing core + authority + commercial + library + quotation-line-authority + bom-001-r7 + mvp-bom-2 + 4d + scope-schema + migration-proof all green (single-surface totals: pricing-engine/api/scenario-authority/input-authority 52, commercial-authority/freshness/model/cost-lock/dashboard-commercial 13, quotation-authority/quotation-line-authority/product-price-library(+api,costing-currency) 53, bom-2/4d/scope-schema/migration-proof/001-r7/stage4d1 51).
- `npm test` (build + 33-file suite): **519/519 green**; `npm run build` succeeds (the verified vinext build inside `npm test`).
- `npm run test:all` (authoritative inventory): **4039 tests / 4016 pass / 9 fail**. All 9 failures are attributed to other lanes, none to this slice: `boq-line-bom-summary` ×2 (documented pre-existing residue), `mvp-bom-5-p9a-product-quotation-regression` ×7 (concurrent quotation-creation lane, mid-flight, Phases 9–13 outside this slice — file untracked and intentionally unregistered/untouched), `review-workflow-atomic` ×1 (`R8` journal/manifest pin against the 0016 lane's in-flight state; the earlier documented position 431). This slice's 25 tests are all present and passing in the inventory. The `--verify-drift` gate currently reports the *concurrent lane's* unregistered `mvp-bom-5-p9a…` file; that boundary belongs to the quotation lane, so it is attributed and not re-recorded here.
- Scoped lint: **0 errors** on every file this slice touched (the two in-slice warnings were fixed; the remaining `quotation-authority` unused-import warning is pre-existing).
- `scripts/test-classification-baseline.json`: + `tests/mvp-bom-5-scope-pricing-commercial-flow.test.mjs|SAFE`.

## Position and remaining phases

**STOP per mandate after Phase 8.** Phases 9–13 remain deferred: quotation creation for SCOPE (`worker/quotation-line-authority.mjs` remains concurrent-agent-owned and read-only here), quotation-line/project-scope generalization, approval waterfalls, export generalization, and the live end-to-end flow. No competing report was written.

**Interim end statements (Phases 6–8 slice):**
- **Verdict:** Phases 6–8 complete and green. The SCOPE path is a true lane-change: the SCOPE pricing input goes through the *single* `calculatePricingLine` cost model (no duplicated engine), PRODUCT gates/columns/binds/fingerprints/display semantics are byte-identical, currency behavior is unchanged (SAR→SAR 1:1, USD→SAR 3.75, others fail closed), SCOPE runs persist with NULL provenance + source-locked identity and are re-verified for currentness at approval before any decision, and current SCOPE lines join PRODUCT lines in canonical totals and display surfaces. New suite is RED→GREEN (25/25) and registered SAFE in the classification baseline.
- **No SCOPE quotation line was created, changed, or removed; no live migration was applied; no live SCOPE pricing run, price lock, or approval was created or altered against any persistent store; no export ran; no commit/push/deploy was made; no dev server was restarted (PID 66503 untouched); and no business-state mutation was performed.**

**Post-verification observation (concurrent lanes, not this slice):** the concurrent 0016 lane's journal/manifest pins remain in-flight, and the quotation-creation lane's `tests/mvp-bom-5-p9a-product-quotation-regression.test.mjs` exists on disk without a baseline classification — both attributed with evidence and deliberately untouched by this slice.
---

# P9a — PRODUCT Quotation Regression Repair

**Verdict: `CLOSED — PRODUCT QUOTATION CREATION RESTORED AFTER 0015`**

## Red-before failure

Migration 0015 made `source_type text NOT NULL` and `source_product_id text NOT
NULL` on `project_quotation_lines` **with no DEFAULT**, and left the PRODUCT
writer naming neither column. Executed through the **real exported route
handler** (`handlePresalesWorkflowApi`, `operation === "quotation/draft"`)
against the **real applied migration chain**, with a fully-ready PRODUCT project
whose every prerequisite fact was asserted satisfied first:

```
Error: NOT NULL constraint failed: project_quotation_lines.source_type
```

So every PRODUCT quotation draft in the product failed. The failure occurs at the
real INSERT — zero revisions and zero lines are created, and the transaction
rolls back.

**Why it survived 0015:** no Node test drives `quotation/draft`. The only
coverage is `tests/e2e/golden-full-journey.spec.ts` (Playwright, live server),
and Golden E2E is itself blocked upstream at Quotation by
`PANEL_SIZING_SNAPSHOT_REQUIRED`. The path had therefore never been executed by
any automated run. The same mock-boundary blind spot that hid the CLOSE-13
authority leaks.

## Exact writer repair

`worker/presales-workflow-api.mjs`, the `lineStatements` INSERT only:

- added `source_type` and `source_product_id` to the column list;
- bound `source_type` to the literal `'PRODUCT'`;
- bound `source_product_id` to `line.productId` — the product identity already
  **selected** by the canonical pricing authority, never re-derived, never
  guessed;
- 25 → 27 placeholders.

**Why the `'PRODUCT'` literal is truthful, not a placeholder:** `lines` in
`loadCanonicalQuotationLines` is populated *exclusively* from the current
engineering-eligible BOQ set, so every line this writer can emit is BOQ-backed by
construction. The literal states a fact about the writer's current output. It is
replaced by the real per-line source type in the SCOPE population slice.

**Nothing else changed.** No SCOPE-only column (`engineering_scope_kind`,
`system`, `source_role`, `source_snapshot_id`, `source_fingerprint`) is named —
the 0015 CHECK *requires* them NULL for PRODUCT, so leaving them unnamed is what
satisfies it. Revision creation, sequencing, fingerprinting, totals, approval
authority, pricing selection and export are untouched.

## Inserted generalized PRODUCT identity

Read back from the real row, not inferred from a 200:

| Field | Value |
|---|---|
| `source_type` | `PRODUCT` |
| `source_product_id` | `prod1` |
| `source_product_id` = `product_id` | true |
| `boq_item_id` | `boq1` (populated) |
| `candidate_id` | `pmc1` (populated) |
| `pricing_line_id` / `pricing_run_id` | `plin1` / `prun1` (unchanged) |
| `commercial_approval_id` | `pa1` (unchanged) |
| `pricing_input_fingerprint` | `run-fp1` (unchanged) |
| all five SCOPE-only columns | `NULL` |
| quantity / unit / currency / cost / selling | `4` / `EA` / `SAR` / `4000` / `10000` |

Totals unchanged: subtotal `10000`, VAT `1500` at 1500 bp, total `11500`; both
`quotation_fingerprint` and `evidence_fingerprint` still produced.

## Regression results

New suite `tests/mvp-bom-5-p9a-product-quotation-regression.test.mjs`, **6/6**,
built on the real chain with no SQL mock:

1. writer names both generalized columns (defect-class guard)
2. draft succeeds (201) with truthful generalized identity
3. totals and quotation fingerprint unchanged
4. repeated draft stays idempotent under the existing contract
5. 0015 CHECK still rejects a PRODUCT row without BOQ provenance, a PRODUCT row
   whose `source_product_id` disagrees with `product_id`, and an incomplete
   SCOPE row
6. no SCOPE line and no SCOPE pricing created

**Red/green proven:** with the repair reverted, **6/6 fail** (including the
runtime `NOT NULL` failure); restored, **6/6 pass**.

| Suite | Result |
|---|---|
| `mvp-bom-5-p9a-product-quotation-regression` (new) | 6/6 |
| `quotation-api` / `-authority` / `-line-authority` / `-snapshot-export` / `-presenter` | 4/4, 18/18, 6/6, 6/6, 6/6 |
| `quotation-workspace-refresh` / `-panel-authority-fingerprint` | 1/1, 6/6 |
| `mvp-bom-5-migration-proof` / `mvp-bom-5-scope-schema` | 3/3, 13/13 |
| `migration-chain-verification` / `-baseline-safety` / `production-readiness` | 3/3, 9/9, 10/10 |
| `workflow-reconciliation` | 11/11 |
| `npm test` | **519/519** |
| `npm run build` | passes |
| `npm run lint` (touched files) | 0 errors, 0 warnings |
| `test:all` | 4039 tests, 4022 pass, **3 fail** |

The 3 `test:all` failures (`boq-line-bom-summary` ×2, `review-workflow-atomic`
R8 ×1) were proven pre-existing by A/B with this repair reverted: identical
0/2 and 27/1. Also of note, the 12 MVP-BOM-5 `scope-schema` failures that were
present in the previous slice are now resolved by the concurrent lane.

## Files changed

| File | Change |
|---|---|
| `worker/presales-workflow-api.mjs` | the two generalized columns added to the quotation-line INSERT and its bind list |
| `tests/mvp-bom-5-p9a-product-quotation-regression.test.mjs` | **new**, 6 tests, real chain |
| `scripts/test-classification-baseline.json` | drift re-recorded (419 files) |

No migration, schema, pricing-currentness, fingerprint, totals, export or test
fixture file was touched. No concurrent-lane file was modified.

## Business-state writes

None. No live quotation creation, no live D1 access, no migration, no commit,
push, deployment or restart. Every write in the new suite goes to a throwaway
`:memory:` database.

## Remaining P9b prerequisite

1. **P9b may now start** — the PRODUCT branch of the quotation source model
   works, which it did not before this slice.
2. **Still required before SCOPE quotation lines can be created:** the
   prerequisites recorded in the P9–P13 preflight — the
   `l2.boq_item_id = l.boq_item_id` currentness correlation (six sites) which
   silently never matches for SCOPE, `loadCanonicalPricingTotals` and
   `loadCanonicalPricingLine` inner-joining the BOQ set,
   `buildLineCostModel({ itemId: runLines[0].boq_item_id })`, and the BOQ-driven
   `loadCanonicalQuotationLines` population and `ready` rule.
3. **A known, unrelated robustness note:** the draft route has no try/catch
   around its write batch, so a constraint violation propagates rather than
   becoming a governed JSON error. That is pre-existing behaviour and is
   fail-closed, so it was deliberately not changed here.
