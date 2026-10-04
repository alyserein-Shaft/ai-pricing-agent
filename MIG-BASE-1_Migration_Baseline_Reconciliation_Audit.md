# MIG-BASE-1 — Drizzle Migration Baseline Reconciliation Audit

**Mode:** READ-ONLY. No migration generated, run, edited, renamed, or deleted. No journal/schema edit. No DB mutation. No git mutation.
**Classification: 🟡 RECOVERABLE DRIFT** — with one 🔴 hard blocker (duplicate migration IDs) that must be resolved first.

---

## 1. Executive Verdict

The repository has **one physical artifact directory (`/drizzle`) carrying two incompatible tracking models**, and a **third independent reality** in the databases.

| Layer | Range | Count |
|---|---|---|
| Drizzle journal + snapshots | `0000`–`0013` | 14 |
| Physical SQL files | `0000`–`0082` | 85 files / 83 unique IDs |
| Untracked by Drizzle | `0014`–`0082` | **71 files / 69 unique IDs** |

**Correction to AIU-4H-PRE:** the earlier "~68 untracked" was approximate. The exact divergence is **71 files / 69 unique IDs**, because **`0019` and `0020` each exist twice** (a numbering collision that is itself a hard blocker).

**The untracked migrations are not "pending."** I proved by direct read-only inspection of the `pre-npq-0061` snapshot that migrations **0014–0060 were genuinely applied out-of-band** (294 tables, 1 view, 24 triggers), with no migration ledger present. The journal simply stopped being maintained.

**Verdict: 🟡 RECOVERABLE DRIFT.** A non-destructive path exists, but **duplicate IDs 0019/0020 must be resolved first**, and the live Golden DB is **actively being written by another agent**, so no verification of the live baseline is currently possible.

---

## 2. Migration Artifact Inventory

- **Authoritative artifact directory:** `/drizzle` (85 `*.sql`)
- **Snapshots:** `/drizzle/meta/0000..0013_snapshot.json` (14, complete unbroken UUID chain, no orphans)
- **Journal:** `/drizzle/meta/_journal.json` (14 entries)
- **Other SQL:** `tests/e2e/seed-golden-context.sql`, `seed-golden-catalog.sql` (data fixtures, not schema)
- `/drizzle/migrations/` exists and is **empty**
- `drizzle.config.ts`: `out: "./drizzle"`, `schema: "./db/schema.ts"`, `dialect: "sqlite"`
- `db/schema.ts` — Drizzle ORM projection; **198 tables but materially incomplete**

**Structure:** `0000`–`0013` are generated-looking (random adjective/noun tags, journal + snapshot each). `0014`+ are descriptive/manual (`0014_task9_fire_alarm_library.sql`, …) with **no journal entry and no snapshot**.

**Anomalies detected:**

| Check | Result |
|---|---|
| Missing IDs in 0000–0082 | **None** (numbering is non-unique, not gapped) |
| **Duplicate IDs** | **`0019` ×2, `0020` ×2** — 🔴 blocker |
| Orphan snapshots | None |
| Files not in journal | 71 (all of 0014+) |
| Snapshots for 0014+ | **Zero** |

Duplicate pairs:
- `0019_identity_library_scope_isolation.sql` / `0019_requirement_review_immutability.sql`
- `0020_applicability_decision_immutability.sql` / `0020_identity_mutation_compare_and_swap.sql`

`tests/database-authority.test.mjs:17-23` deliberately permits duplicate prefixes before 0021 — a **test convention, not runner safety**.

---

## 3. Journal State

- Entries: **14** (idx 0–13, contiguous), all `version: 6`, `breakpoints: true`
- First: `0000_tranquil_korg` · Last: `0013_smart_cable`
- Dialect `sqlite`, format version `7`
- **First divergence: `0014_task9_fire_alarm_library.sql`** — file exists, no journal entry, no snapshot.

**Exact untracked set:** `0014`–`0082` (69 unique IDs / 71 files).

---

## 4. Migration Execution Architecture

| Question | Answer | Evidence |
|---|---|---|
| How generated? | `db:generate` → `drizzle-kit generate` | `package.json:30` |
| How applied (general)? | **No general runner.** No `db:migrate`, no `db:push`, no startup auto-apply | `package.json` (only db:generate) |
| How applied (explicit)? | `wrangler d1 migrations apply` in Golden E2E setup and Stage 3E | `scripts/setup-golden-e2e.sh:12-15`; `scripts/stage3e-…:80-103` |
| How applied (out-of-band)? | **Direct SQL / dedicated scripts** — e.g. `scripts/apply-0080-onboarding-d-contact-title.mjs` embeds its own `ALTER TABLE` | `scripts/apply-0080-…:71-91` |
| Runtime behavior? | Read-only preflight only; fails closed with `DATABASE_SCHEMA_MISSING` | `worker/schema-requirements.mjs:1-18` |
| Authoritative dir? | `/drizzle` for both generation and Golden D1 | `drizzle.config.ts:4`; `tests/e2e/wrangler.golden.jsonc:11` |
| Journal used for? | **Generation only** — execution is by D1 ledger or direct SQL | — |
| Multiple environments? | **Yes (≥5):** normal local D1, isolated Golden E2E D1, existing local Golden D1, hosted Sites D1, test SQLite | `vite.config.ts`, `tests/e2e/wrangler.golden.jsonc`, `examples/d1` |
| Does Golden share the chain? | **Unknown** — no ledger to compare | — |

**Key consequence:** the journal is **not** an execution authority anywhere. Applied state is only knowable by inspecting the live schema.

---

## 5. Schema Source of Truth

| Source | Class | Finding |
|---|---|---|
| `drizzle/*.sql` | 🟢 **practical authority** | The real ordered chain through `0082` |
| `db/schema.ts` | 🟡 **incomplete projection** | 198 tables; omits `project_quotation_lines`, `estimator_understanding_review_versions/events`, `supplier_quote_intake_rows`, `pricing_memory_observations`, `ai_quotation_advisories`, `project_npq_*`, `boq_quantity_source_decisions`, and much more |
| `drizzle/meta/_journal.json` | 🔴 **stale** | Stops at 0013 |
| `drizzle/meta/*_snapshot.json` | 🟡 derived | 0000–0013 only |
| `scripts/apply-0080-…` | 🔴 **competing mutation path** | Duplicates migration 0080 as hand-embedded DDL |
| `examples/d1/db/schema.ts` | 🔴 non-production template | Unrelated `notes` table |
| `tests/**` inline DDL | 🔵 fixture | >100 files, independent minimal schemas |
| `worker/schema-requirements.mjs` | 🟢 guard | Checks only; never creates |

**There is no single complete schema source of truth.** `db/schema.ts` cannot regenerate the current schema, and the journal cannot describe it.

---

## 6. Live DB Schema Evidence

**Live Golden DB is currently unreadable** — `sqlite3 -readonly` returns `unable to open database file (14)`; its mtime advanced to `Sep 24 23:29` during this audit. **A concurrent agent is actively writing it.** Current live state is therefore **UNVERIFIED by me**.

I used the most recent **readable** snapshot instead, clearly labeled:

**`…pre-npq-0061.sqlite` (Aug 16) — 294 tables, 1 view, 24 triggers, NO migration ledger.**

### Decisive reconciliation against that snapshot

| Migration | Marker object | Live (snapshot) | Class |
|---|---|---|---|
| 0010 | `pricing_lines`, `pricing_scenarios`, `pricing_shared_costs`, `pricing_cost_allocations` | **PRESENT** | **A** applied |
| 0014 | `product_packages` | **PRESENT** | **A** applied |
| 0042 | `pricing_memory_observations` | **PRESENT** | **A** applied |
| 0044 | `product_identity_rulesets` | **PRESENT** | **A** applied |
| 0045 | `project_quotation_revisions` | **PRESENT** | **A** applied |
| 0054 | `ai_quotation_advisories` | **PRESENT** | **A** applied |
| 0055 | `supplier_quote_intake_rows` | **PRESENT** | **A** applied |
| 0031 | `engineering_discovery_runs` | **PRESENT** | **A** applied |
| 0036 | `drawing_legend_geometry_versions` | **PRESENT** | **A** applied |
| 0041 | `knowledge_files` | **PRESENT** | **A** applied |
| 0052 | `estimator_understanding_runs` | **PRESENT** | **A** applied |
| 0060 | `estimator_understanding_review_versions`, `_events` | **PRESENT** | **A** applied |
| **0061** | `project_npq_profile_versions/_events` | **ABSENT** | **B** not applied (snapshot is pre-0061 by name) |
| **0064** | `project_quotation_lines` | **ABSENT** | **B** not applied at snapshot |
| **0070** | `boq_quantity_source_decisions` | **ABSENT** | **B** not applied at snapshot |
| **0074** | `drawing_visual_runs` | **ABSENT** | **B** not applied at snapshot |
| **0075** | `knowledge_promotions` | **ABSENT** | **B** not applied at snapshot |
| **0078** | `drawing_architecture_review_cases` | **ABSENT** | **B** not applied at snapshot |
| **0082** | `canonical_classifications` (view) | **ABSENT** | **B** not applied at snapshot |

**The snapshot is exactly the pre-0061 cut: 0014–0060 applied, 0061+ not.** This is a clean, provable boundary and confirms the migrations were genuinely executed out-of-band, in lexical order, without any ledger.

> **Caveat, stated plainly:** the *current* live DB is ahead of this snapshot — repository reports indicate 0064, 0066, 0075, 0076, 0078, 0079, 0080 were applied later — but I could **not verify the live state** because it is locked. Live classification for 0061+ is therefore **UNKNOWN**, not "B".

---

## 7. Migration-to-Live Reconciliation Matrix (condensed)

| Range | Journal | File | Live (pre-0061 snapshot) | Class |
|---|---|---|---|---|
| 0000–0013 | ✅ tracked | ✅ | present | coherent |
| 0014–0060 | ❌ untracked | ✅ | **present** | **A — applied, untracked** |
| 0061 | ❌ untracked | ✅ | absent at snapshot | applied later (UNVERIFIED live) |
| 0062–0079 | ❌ untracked | ✅ | mixed; later ones absent at snapshot | **UNKNOWN live** |
| 0080–0082 | ❌ untracked | ✅ | absent at snapshot | **UNKNOWN live** |

The **core finding is not a pending/applied split — it is a tracking split**. 47 migrations are applied but untracked. The journal is not merely behind; it is structurally irrelevant to applied state.

---

## 8. Provenance of Drift

### FACT
- Journal content is byte-identical to pushed commit `8ff22c5` ("Baseline: … through Phase 2.5", 2026-08-11).
- **`0014` and the 14-entry journal were committed together in `8ff22c5`** — the journal was *already* stale at baseline commit.
- Local HEAD `029b426` (2026-08-29) advanced well past it.
- Migrations `0067`–`0082` postdate HEAD and are **uncommitted** (mtimes Sept 2026; `0078`/`0079` explicitly recorded as untracked in `DRAWING_INTELLIGENCE_INDEPENDENT_AUDIT_REPORT.md:6,23-24`).
- No migration ledger (`d1_migrations`) exists in the snapshot; `scripts/apply-0080-…:7-17` documents this.
- `drizzle/migrations/` is empty and no root `wrangler.toml/json(c)` exists.
- `db/schema.ts` and `_journal.json` are both concurrently modified (mtime 18:42; journal 2026-09-15 per index).

### INFERENCE
- The journal stopped being semantically maintained **before** the baseline was committed; from 0014 onward the project authored descriptive SQL and applied it out-of-band rather than through Drizzle Kit. (Strong: `0014` shipped alongside an unchanged journal.)
- The journal's September mtime reflects a no-op touch, not added entries.
- The `pre-npq-0061` snapshot name and contents indicate migrations were applied as a **lexical ordered replay** at least through 0060.

### UNKNOWN
- Whether D1's `migrations apply` created a ledger in the isolated Golden E2E environment (fresh D1 likely does; existing local DBs provably do not).
- Whether any hosted/production D1 exists and at what schema level — **not inspected, by design**.
- Exact per-file Git tracked/untracked status (this subagent lacked `git ls-files`; I did not fabricate it).

---

## 9. Why New Migration Generation Is Unsafe

`db:generate` runs `drizzle-kit generate`, which diffs **`db/schema.ts`** against the **last journal snapshot (`0013`)**. That is the wrong baseline on two independent counts:

1. **Wrong target schema.** `db/schema.ts` omits ~dozens of live tables (`project_quotation_lines`, `estimator_understanding_review_versions`, `supplier_quote_intake_rows`, `project_npq_*`, …). Drizzle would interpret their absence as **intentional drops** and emit `DROP TABLE` for each.
2. **Wrong baseline.** Snapshot 0013 predates 47 already-applied migrations, so every real difference between `db/schema.ts` and the live schema would be re-emitted as a new migration — duplicating DDL for tables that already exist.

Likely output if run now: a large generated migration containing **DROP TABLE** for all schema-post-0013 objects and/or redundant `CREATE TABLE` for already-applied ones. Applying it would be destructive.

**I did not run generation.** Drizzle Kit has no verified write-free dry-run mode here, so it was not invoked.

---

## 10. Repair Options Compared

| Option | Safety | Drizzle compat | Replay risk | Future `db:generate` | Verdict |
|---|---|---|---|---|---|
| **A. Reconstruct journal + snapshots 0014–0082** | Medium — snapshots must be *derived*, not invented | Native | **HIGH** — fabricated snapshots can misrepresent history | Good if accurate | ⚠️ Risky: 69 hand-authored migrations have no true snapshots to recover |
| **B. New squashed baseline at current schema** | **High** if the baseline is derived from a *verified live* schema | Native (`baseline` marker) | **None** for existing DBs; baseline only for new ones | **Good** — clean, single source | ✅ **Best for generation** |
| **C. Explicit baseline marker + archive stale metadata** | High | Supported | None | Good | ✅ Complementary to B |
| **D. Recover canonical journal from git history** | **Fails** — history shows the journal *was already stale* at baseline | — | — | — | ❌ No recovery source exists |
| **E. Continue without Drizzle metadata (current practice)** | Low long-term | Degraded | Continues | ❌ Broken | ❌ Not viable |

**Duplicate IDs 0019/0020 must be resolved regardless of option** — they are ambiguous for any runner keyed on the numeric prefix.

---

## 11. Recommended Baseline Strategy

A two-part, non-destructive strategy (**B + C**):

**Part 1 — Resolve collisions (prerequisite).** Rename `0019_*`/`0020_*` to unambiguous unique IDs. This is a **file-rename only**; no DDL changes. Requires authorization and must not disturb a concurrent agent's files.

**Part 2 — Establish a squashed baseline (B+C).**
1. Take a **verified backup** of each environment; confirm no concurrent writer.
2. Derive the authoritative current schema from a **verified live schema dump**, not from `db/schema.ts`.
3. Complete `db/schema.ts` so it matches that schema (it is currently incomplete).
4. Archive the stale `0000–0013` metadata and create a **single baseline** representing "current schema as of <date>".
5. From then on, `db:generate` diffs against a correct baseline.

**Explicitly rejected:** replaying 0014–0082 anywhere. Those DDL statements are already applied in existing databases.

---

## 12. Replay / Data Safety

**Invariant preserved:** schema reconciliation ≠ rerunning 0014–0082.

| Option | Avoids replay? |
|---|---|
| A (reconstruct metadata) | **Partially** — if a reconstructed journal were ever used with `d1 migrations apply`, it **would** attempt replay. Must be generation-only. |
| **B (squashed baseline)** | ✅ **Yes** — baseline is declarative; existing DBs are untouched. |
| **C (archive + marker)** | ✅ Yes |
| D | n/a — infeasible |
| E | ❌ Continues out-of-band drift |

Additional safety: several migrations contain **data backfills and trigger rebuilds** (e.g. `0017`, `0018`, `0021`, `0024`, `0050`) and `0064`/`0065` add **immutability triggers**. Replaying these against an already-migrated DB risks duplicate rows, trigger conflicts, or aborted DDL.

**A destructive DB reset is NOT proposed as the default.** It is a last resort requiring explicit, separate approval, and would destroy Golden project data.

---

## 13. Dirty-Tree / Concurrent Work Risk

# 🔴 HIGH — reconciliation cannot safely start yet

- **594+ changed files** (was 578 during AIU-4C — the tree is still actively changing).
- `db/schema.ts` is **modified** (mtime 18:42) by another agent.
- Migrations **`0067`–`0082` are uncommitted** and belong to other agents.
- **The Golden D1 is being actively written right now** (mtime 23:29); read-only opens fail with lock errors. This is direct proof of a live concurrent writer.

**Must stop changing before reconciliation:**
1. `db/schema.ts` — all agents
2. `drizzle/*.sql`, especially `0067`–`0082` — their owning agents
3. Any process writing the Golden D1

**Untouched by this audit.** I did not modify, rename, or delete any of the above.

---

## 14. AIU-4H Dependency

AIU-4H (per AIU-4H-PRE §14) will require:
- **New tables:** `boq_scope_dispositions`, `boq_scope_disposition_events`, `commercial_scope_lines`, `commercial_scope_line_costs`
- **Rebuild:** `project_quotation_lines` → add `line_type` + `scope_line_id`, relax product NOT NULLs, add a **line-type CHECK**
- **Backfill:** all existing quotation lines to `line_type='PRODUCT'`

**Why generation cannot begin:** `db:generate` would diff against snapshot 0013 and emit destructive DDL (§9). Additionally, `project_quotation_lines` **does not exist in `db/schema.ts` at all** — so the very table AIU-4H must rebuild is invisible to the generator.

**"Migration safe" must mean, before AIU-4H starts:**
1. Duplicate IDs 0019/0020 resolved.
2. A verified, backed-up, **non-concurrently-written** schema source for every environment.
3. `db/schema.ts` **complete** and matching that verified schema.
4. A current Drizzle baseline (option B) established.
5. `db:generate` proven to produce a **correct, non-destructive, additive-only** diff (verified in an isolated worktree).
6. Golden writer stopped; backup taken and verified.
7. Explicit user authorization for schema + migration execution.

---

## 15. Exact Next Slice

**MIG-BASE-2 — Migration Collision Resolution & Schema Source Completion** (read-only *planning* first, then authorized execution).

It must, in order:
1. Determine the canonical lexical order and correct IDs for the duplicate `0019`/`0020` files.
2. Produce a **complete table/column inventory** of the verified live schema (tables, views, triggers, indexes) to serve as the baseline source.
3. Enumerate exactly which tables/columns `db/schema.ts` is missing versus that inventory.
4. Define the baseline-migration shape — **without** creating it.

Only after MIG-BASE-2 produces a verified, complete schema inventory can MIG-BASE-3 (baseline creation) and then AIU-4H be considered.

**MIG-BASE-2 was not implemented.**

---

## 16. What Was Changed

**Nothing.**

Read-only audit. No migration, journal, snapshot, or schema file was created, edited, renamed, or deleted. No migration was generated or run. No database was mutated — all DB access was `sqlite3 -readonly` against a readable snapshot after the live DB proved locked. No git state changed. No Golden data altered. No commit, push, deploy, or restart.

**Explicit non-actions:** `drizzle-kit generate` was **not** run. The journal was **not** repaired. The duplicate-ID files were **not** renamed. The live Golden DB was **not** touched, and its current state is reported as **unverified** rather than assumed.

**STOP.**
