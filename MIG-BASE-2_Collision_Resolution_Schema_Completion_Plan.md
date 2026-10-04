# MIG-BASE-2 — Collision Resolution & Schema Source Completion Plan

**Mode:** READ-ONLY / PLANNING ONLY. No rename, no schema edit, no journal/snapshot edit, no generation, no migration run, no DB mutation, no baseline, no Golden change, no commit/push/deploy/restart.
**Everything below is a plan. Nothing was implemented.**

---

## 1. Executive Verdict

The collisions are **not duplicates** — all four files were **independently applied** and are **complementary**. The only true defect is **filename ambiguity under lexical ordering**, and `db/schema.ts` is **strictly incomplete (95 missing tables, 0 phantom objects)** — which makes completion mechanical and low-risk.

| Finding | Result |
|---|---|
| 0019 collision | **Class A — both applied, complementary.** Safe to disambiguate by rename. |
| 0020 collision | **Class A — both applied, complementary.** Safe to disambiguate by rename. |
| Ordering authority | **Lexical filename sort** (not numeric prefix, not journal) |
| `db/schema.ts` gap | **95 live tables missing, 0 phantom tables** |
| Replay risk | None from collisions; replay remains forbidden regardless |
| Recommended path | Rename collisions → complete schema.ts → squashed baseline |

**Nothing blocks the plan.** The blockers are authorization and tree stabilization, not analysis.

---

## 2. 0019 Collision

### `0019_identity_library_scope_isolation.sql` (86 lines)
Multi-system library scoping: `CREATE TABLE organizations`, `organization_memberships` (no `IF NOT EXISTS`); `ALTER TABLE` adds `organization_id` to `projects`, `product_sources`; adds `library_scope`, `organization_id`, `library_project_id` to `library_products` and `product_conflicts`; extends identity resolution tables.

### `0019_requirement_review_immutability.sql` (11 lines)
`CREATE TRIGGER IF NOT EXISTS requirement_review_decisions_immutable_update/_delete` on `requirement_review_decisions`.

### Live verification (pre-0061 snapshot, read-only)

| Object | Present |
|---|---|
| `organizations` | ✅ |
| `organization_memberships` | ✅ |
| `projects.organization_id` | ✅ |
| `library_products.library_scope` / `.organization_id` / `.library_project_id` | ✅ ✅ ✅ |
| `product_conflicts.library_scope` | ✅ |
| `requirement_review_decisions_immutable_update` | ✅ |
| `requirement_review_decisions_immutable_delete` | ✅ |

**Classification: A — both independently applied, complementary, neither supersedes the other.** They touch disjoint object sets (schema/columns vs. triggers on a different table). Neither references the other.

**Normalization plan (future, requires authorization):** rename to unambiguous unique IDs preserving relative order, e.g. `0019a_identity_library_scope_isolation.sql` and `0019b_requirement_review_immutability.sql` (identity first is already the lexical order). **Renames only — no DDL change.**

---

## 3. 0020 Collision

### `0020_applicability_decision_immutability.sql` (13 lines)
`CREATE TRIGGER IF NOT EXISTS applicability_decisions_immutable_update/_delete` on `engineering_knowledge_decisions` `WHEN OLD.entity_type = 'BOQ Requirement Link'`.

### `0020_identity_mutation_compare_and_swap.sql` (94 lines)
`ALTER TABLE` adds `request_fingerprint` to `identity_proposal_reviews` and `governed_identity_decisions`; `CREATE TABLE identity_mutation_guards` / `identity_mutation_failures` with compare-and-swap fields.

### Live verification

| Object | Present |
|---|---|
| `applicability_decisions_immutable_update` / `_delete` | ✅ ✅ |
| `identity_mutation_guards` / `identity_mutation_failures` | ✅ ✅ |
| `identity_proposal_reviews.request_fingerprint` | ✅ |
| `governed_identity_decisions.request_fingerprint` | ✅ |

**Classification: A — both independently applied, complementary, disjoint object sets.** Analyzed separately per instruction; the same conclusion is *earned independently*, not assumed.

**Normalization plan:** `0020a_applicability_decision_immutability.sql`, `0020b_identity_mutation_compare_and_swap.sql` (preserving current lexical order). **Renames only.**

### Dependency proof that lexical order is real
`0024_organization_membership_governance.sql` opens with `ALTER TABLE organizations ADD COLUMN owner_user_id` — it **builds on** `0019_identity_library_scope_isolation.sql`. The chain only executes correctly in filename order, confirming the real applied order was lexical.

---

## 4. Actual Migration Ordering Authority

| Layer | Ordering mechanism | Evidence |
|---|---|---|
| **Test replay (what actually built the DBs)** | **Lexical filename `.sort()`** | `tests/database-authority.test.mjs:28` — `readdirSync(...).filter(...).sort()` |
| Golden E2E / D1 | `wrangler d1 migrations apply` over `/drizzle` | `scripts/setup-golden-e2e.sh:12-15` |
| Runtime | **Does not migrate** — read-only preflight, fails closed | `worker/schema-requirements.mjs:1-18` |
| Drizzle Kit generation | Journal index + snapshots | `drizzle.config.ts` |

**Conclusion:** duplicate numeric IDs are a **real runtime hazard for any runner keyed on the numeric prefix**, but in this repository they were harmless in practice because the operative path is **lexical filename order** — and that order is deterministic and already proven by the live DB.

**Risk if a numeric-prefix runner were ever used:** `0019` would be seen twice and likely rejected or collapsed. Since `0024` depends on `0019-identity`, a collapse would break the chain. **This is the concrete reason to rename.**

---

## 5. Complete Schema Gap Inventory

Measured deterministically against the readable `pre-npq-0061` snapshot (293 live tables, 1 view, 24 triggers).

| Metric | Value |
|---|---|
| Live tables (excl. `sqlite_*`, `_cf_*`) | **293** |
| `db/schema.ts` `sqliteTable(...)` declarations | **198** |
| **Live tables absent from `db/schema.ts`** | **95** |
| **`db/schema.ts` tables absent from live DB (phantom)** | **0** |

Representative missing tables (alphabetical sample):
`ai_quotation_advisories`, `canonical_evidence_integrity`, `canonical_product_resolution_audit`, `case_learning_evaluations`, `commercial_conditions`, `drawing_legend_geometry_{approved_links,approved_versions,candidates,review_events,versions}`, `drawing_occurrence_cluster_*`, `drawing_symbol_{cluster,segmentation,signature,occurrence_match}_*`, `engineering_discovery_*` (7), `estimator_understanding_review_{events,versions}`, `historical_boq_*` (9), `identity_{dependency_providers,mutation_failures,mutation_guards,reference_guards,schema_compatibility}`, `knowledge_{facts,file_events,…}`, and the remainder.

**Additionally missing from `db/schema.ts` (non-table objects):**
- View `canonical_classifications` (0082)
- 24 triggers incl. all immutability/evidence-guard triggers (0019, 0020, 0062, 0063, 0065, …)
- Most indexes/unique constraints/FKs/CHECKs added after 0013

**Interpretation:** `db/schema.ts` is a **strict subset** of reality. It is *incomplete*, never *wrong*. This is the most favorable possible drift shape: completion is additive and verifiable.

---

## 6. Canonical Target Schema

**Rule: the verified live schema is the canonical target**, subject to source-level obsolescence checks.

| Class | Definition | Count |
|---|---|---|
| 🟢 **Include** | Present in live DB **and** referenced by current production code/migrations | 293 tables + 1 view + 24 triggers |
| 🔴 **Obsolete** | In `db/schema.ts` but not live | **0** |
| 🟡 **Uncertain** | Live but no current consumer — needs per-object decision | drawing segmentation/clustering tables, `pricing_shared_costs`/`pricing_cost_allocations` (zero runtime references), `identity_mutation_failures` |

**Caution (do not blindly copy):** per MIG-BASE-1, `pricing_shared_costs` and `pricing_cost_allocations` exist in schema and DB but have **zero runtime consumers**. They may be planned-but-unwired rather than obsolete. The 🟡 class must be resolved by explicit decision, not by automated import.

---

## 7. Future Source-of-Truth Rules

| Concern | Authoritative source | Rule |
|---|---|---|
| **A. Desired current schema** | `db/schema.ts` (post-completion) | Must be complete and match verified live schema. Sole input to `drizzle-kit generate`. |
| **B. Historical change record** | `drizzle/*.sql` files | **Read-only archive.** Never edited, never replayed. |
| **C. Applied-state tracking** | **The database itself** (+ D1 ledger where it exists) | The journal must never be used for this. |
| **D. Generation baseline** | A single current `drizzle/meta/*_snapshot.json` + journal entry marking the baseline | Drizzle metadata describes **only** post-baseline migrations. |

**Non-negotiables:**
1. `/drizzle/*.sql` before the baseline is **immutable historical record**.
2. No out-of-band DDL. If a fix is needed, it is a new migration file.
3. `db/schema.ts` is the **only** generator input; if it is wrong, generation is wrong.
4. Filenames are the execution order for anything replayed; **IDs must be unique**.

---

## 8. Exact `db/schema.ts` Completion Plan

For each of the **95 missing tables** plus the view, triggers, indexes, and constraints:

| Field | Value |
|---|---|
| **Object name** | From live `sqlite_master` / `pragma_table_info` |
| **Source proving membership** | Migration DDL + verified live schema (two independent sources must agree) |
| **Representation** | `sqliteTable("<name>", { … })` in `db/schema.ts` |
| **Dependencies** | FK targets must be declared in dependency order |
| **Generated vs manual** | **Manual** — Drizzle cannot import existing DDL |
| **SQLite/D1 specifics** | `integer({mode:'boolean'})`, `text({mode:'json'})`, `text({mode:'timestamp'})`; CHECK constraints are **not expressible** in Drizzle schema — they must be preserved in migration SQL only |
| **Risk** | **Low** — additive; 0 phantom objects means no removals |

**Sequencing:** declare in FK-dependency order; group by domain (identity, drawing, knowledge, pricing, quotation, understanding, historical). **Triggers and the view cannot be modeled in `db/schema.ts`** — they must live only in migration SQL, and the completion plan must record that `drizzle-kit generate` will not manage them.

**Critical caveat:** adding these tables to `db/schema.ts` makes `generate` aware of them, but **triggers/CHECKs remain invisible to Drizzle**. A baseline migration must therefore be authored to carry them.

---

## 9. Squashed Baseline Design

**Answers to the 8 posed questions:**

1. **What becomes the baseline?** A single migration representing the **complete verified current schema** (293 tables, 1 view, 24 triggers, all indexes/constraints).
2. **Old migration files?** **Retained, unchanged, moved to an archive directory** (e.g. `drizzle/archive/`) or simply left in place and excluded from the baseline. **Never deleted** — they are the historical record.
3. **Old journal/snapshots?** Archived with the legacy files. The new journal begins at the baseline.
4. **How is the baseline marked applied on existing DBs?** Via the runner's own applied-migrations record, or — for DBs with **no ledger** — a **metadata-only adoption** that records the baseline as applied **without executing baseline DDL** (§11).
5. **How does a fresh DB get created?** Apply **the baseline only**, then subsequent migrations.
6. **How do future migrations begin?** After the baseline entry, as `0001_…`, `0002_…` (renumbered, clearly post-baseline).
7. **How is replay of 0014–0060 prevented?** By **archiving** legacy files out of the applied directory so no runner can enumerate them, and by **never** re-running them.
8. **How is auditability preserved?** Legacy files remain byte-identical in the archive; the baseline records the schema state they produced; a manifest documents the mapping.

---

## 10. Fresh DB Bootstrap Strategy

```
empty DB  →  apply baseline migration  →  current schema (293 tables)
          →  apply post-baseline migrations (none yet)
```

**Required proof tests:**
1. Apply baseline to an empty in-memory SQLite → assert all 293 tables + 1 view + 24 triggers exist.
2. Assert **zero** legacy files are read during bootstrap.
3. Assert `db/schema.ts` table set **equals** the bootstrapped table set (no missing, no extra).
4. Idempotency: re-running bootstrap against an already-baselined DB is a no-op.

---

## 11. Existing DB Adoption Strategy

**The constraint:** the Golden DB has **no migration ledger** and may already contain everything the baseline creates. Executing baseline DDL against it would fail (`table already exists`) or, for bare `ALTER TABLE`, fail with `duplicate column name`.

**Framework-supported mechanisms considered:**

| Mechanism | Supported here? | Verdict |
|---|---|---|
| `drizzle-kit push` (diff-and-apply, no ledger needed) | Tooling present (`drizzle-kit` 0.31.10) but **stale baseline makes its diff wrong** | ❌ unsafe now |
| `wrangler d1 migrations apply` (uses `d1_migrations` ledger) | Used in Golden E2E | ✅ **for fresh DBs** |
| **Metadata-only adoption** | ⚠️ **Not supported by current tooling** | see below |

**Honest finding:** current tooling offers **no supported "mark baseline as applied without executing DDL"** operation for a ledger-less database. The realistic paths are:

- **(a) Isolated clone first** — copy the DB, run the baseline against the clone to *validate* it, then adopt by **inserting a `d1_migrations` marker row** (the same table `wrangler d1 migrations apply` uses). This is a **metadata write**, not DDL, and is the only mechanism consistent with existing tooling. **Requires authorization and verification of the exact ledger schema first.**
- **(b) Fresh-DB-only baseline** — declare the baseline applies only to new databases, and keep existing DBs on the legacy out-of-band path. **Lowest risk, but leaves two divergent worlds.**

**Recommendation: (a), with (b) as fallback.** Both require explicit authorization; neither is performed now.

---

## 12. Future `db:generate` Safety Test

**Acceptance procedure (isolated, not run now):**

1. Create an **isolated worktree/branch** — never generate in the shared dirty tree.
2. Establish baseline: complete `db/schema.ts`, create baseline snapshot + journal entry.
3. In the isolated tree, apply a **tiny known additive change** to `db/schema.ts` — e.g. add one nullable column to one table.
4. Run `npm run db:generate`.
5. **Assert the generated migration contains ONLY:**
   - one `ALTER TABLE … ADD COLUMN` for that column, and
   - **nothing else**.
6. **Assert absence of:** any `DROP TABLE`, `DROP COLUMN`, `RENAME`, table re-creation, or references to legacy 0014–0082 objects.
7. Apply the generated migration to a **baseline-bootstrapped scratch DB**; assert it succeeds and changes nothing else.
8. Re-run `generate` with no schema change; assert it produces **no** migration (idempotent).

**Pass criteria: 100% additive, zero destructive statements, zero legacy noise.** Any DROP ⇒ fail and halt.

---

## 13. Tree Stabilization Requirements

**Minimal migration lock scope** — only these paths must stop changing:

| Path | Why |
|---|---|
| `db/schema.ts` | Generator input; concurrent edits corrupt the baseline |
| `drizzle/*.sql` | Migration content and ordering |
| `drizzle/meta/**` | Journal + snapshots |
| Any process writing the Golden D1 | Concurrent writer corrupts adoption verification |

**Explicitly NOT required:** a repository-wide freeze. Application code, UI, and unrelated domains may continue.

**Observed current state:** `db/schema.ts` modified (mtime 18:42); migrations `0067`–`0082` uncommitted; **Golden D1 actively written (mtime 23:29)**. All four are currently **violating** the lock.

---

## 14. Golden DB Safety Policy

| Rule | Requirement |
|---|---|
| **Never migrate Golden in place first** | Always target an **isolated clone** |
| **Clone method** | Filesystem copy of a **quiesced** DB (no `-wal`/`-shm` divergence) |
| **Writer stop** | The concurrent writer **must** be stopped before copying — a hot copy can be inconsistent |
| **Verification before touching Golden** | 1) checksum/integrity check; 2) table+view+trigger count matches expectation; 3) baseline applied cleanly to the clone; 4) explicit user approval |
| **Rollback** | Verified pre-change backup retained; restore path tested on the clone first |
| **Current state** | Golden is **locked and actively written** — no interaction is possible now |

**No clone was created. Golden was not touched.**

---

## 15. AIU-4H Readiness Gate

**MIGRATION BASELINE READY FOR AIU-4H** requires **all** of:

| # | Condition | Status |
|---|---|---|
| 1 | Duplicate IDs 0019/0020 resolved (renamed) | ❌ not done |
| 2 | `db/schema.ts` complete (95 tables + view + constraints) | ❌ not done |
| 3 | 🟡 live-but-unconsumed objects decided (shared costs, mutation failures, drawing cluster tables) | ❌ not done |
| 4 | Squashed baseline created and validated against a fresh DB | ❌ not done |
| 5 | Existing-DB adoption path proven on an isolated clone | ❌ not done |
| 6 | Fresh-DB bootstrap proven (293 tables + view + 24 triggers) | ❌ not done |
| 7 | `db:generate` safety test passed (additive-only) | ❌ not done |
| 8 | Migration lock established on the 4 paths in §13 | ❌ violated |
| 9 | Golden quiesced + backed up + verified | ❌ violated |
| 10 | Explicit user authorization for schema + migration execution | ❌ not granted |

**AIU-4H must not begin.** 0 of 10 conditions met.

---

## 16. Exact Future Execution Order

1. **Establish the migration lock** on the four paths (§13) — nothing else can safely start.
2. **Quiesce the Golden writer**; take a verified backup; make an isolated clone.
3. **Validate the clone** — confirm it reflects the intended baseline state.
4. **Normalize collision IDs** — rename `0019_*`, `0020_*` (renames only; no DDL).
5. **Inventory + decide** all 293 live objects (resolve the 🟡 unconsumed class explicitly).
6. **Complete `db/schema.ts`** — add the 95 missing tables (+ document that triggers/CHECKs remain migration-only).
7. **Author the baseline migration** carrying tables **and** triggers/CHECKs the ORM cannot express.
8. **Bootstrap a fresh scratch DB** from the baseline; assert 293/1/24.
9. **Adopt the baseline on the isolated clone** via the §11 metadata mechanism; verify no DDL executed.
10. **Run the generation safety test** (§12) in an isolated worktree; require 100% additive.
11. **Publish the archive + new journal/snapshots**; mark legacy files read-only.
12. **Re-verify Golden** against the adopted baseline (read-only).
13. **Only then** present AIU-4H for authorization.

Steps 4–7 are the substantive work; 1–3 and 8–13 are verification gates that must not be skipped.

---

## 17. Explicit User Authorizations Required

| # | Action | Status |
|---|---|---|
| 1 | Renaming migration files (0019/0020) | ❌ |
| 2 | Editing `db/schema.ts` | ❌ |
| 3 | Creating the baseline migration | ❌ |
| 4 | Replacing/archiving journal + snapshots | ❌ |
| 5 | Archiving or relocating legacy migration files | ❌ |
| 6 | Creating an isolated DB clone | ❌ |
| 7 | Writing a `d1_migrations` adoption marker | ❌ |
| 8 | Quiescing / stopping the Golden writer | ❌ |
| 9 | Touching the Golden D1 at all | ❌ |
| 10 | Creating an isolated git worktree/branch | ❌ |
| 11 | Running `db:generate` (even in isolation) | ❌ |
| 12 | Applying any migration to any database | ❌ |
| 13 | Commit / push / deploy / restart | ❌ |

**None assumed. None taken.**

---

## 18. Exact Next Slice

**MIG-BASE-3 — Controlled Baseline Repair** (the first *mutating* slice in this chain), scoped to steps 1–4 of §16 only:

- establish the migration lock,
- quiesce and back up Golden,
- rename the 0019/0020 collisions,
- produce the complete object inventory with explicit 🟢/🟡 decisions.

**It must not** create the baseline, edit `db/schema.ts`, or run generation — those remain separately authorized follow-ons.

**MIG-BASE-3 was not implemented.**

---

## 19. What Was Changed

**Nothing.**

Read-only planning. No migration file renamed, created, edited, or deleted. `db/schema.ts` untouched. `_journal.json` and all snapshots untouched. No `drizzle-kit generate`. No migration executed. No database mutated — all DB access was `sqlite3 -readonly` against a readable snapshot after the live Golden DB proved locked. No Golden interaction. No baseline created. No git state changed. No commit, push, deploy, or restart.

**Collision files confirmed still in place, unrenamed:**
`0019_identity_library_scope_isolation.sql`, `0019_requirement_review_immutability.sql`, `0020_applicability_decision_immutability.sql`, `0020_identity_mutation_compare_and_swap.sql`

**STOP.**
