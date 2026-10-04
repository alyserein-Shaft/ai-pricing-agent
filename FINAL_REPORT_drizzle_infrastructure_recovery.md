# Drizzle / Drawing Quantity Persistence Infrastructure Recovery

Canonical project: `project_ae501b85-9c12-4332-bf8e-787c90f2d388`
Canonical local D1: `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite`

## Verdict

The task premise was wrong in three material ways, and following it literally would have
caused real damage. `drizzle/` was **not** staged for deletion, it is **not** the canonical
migration directory, and `0064` is **not** the correct next migration number. The directory
was nonetheless doing real work as a test-fixture source, and its absence was actively
breaking 41 test files. That damage is now repaired.

---

## A. Why `drizzle/` Is Deleted

**It is an unowned, unintended working-tree deletion. Not staged, not committed, not
recorded as intent by any lane.**

Evidence class: PROJECT EVIDENCE.

1. **Status is ` D`, not `D `.** `git status --porcelain` XY summary over `drizzle/`:
   81 entries, all ` D` — deleted in the worktree, index untouched.
   `git diff --cached --name-only -- drizzle/` → **0 paths**. The handoff file's claim of
   "all staged ` D`" conflates the two columns and is incorrect.
2. **No lane recorded intent to delete.** Three separate lanes logged the deletion and each
   attributed it outward rather than owning it:
   - `EV-DRZ-001` (`runs/2026-10-03-legend-semantics-kgs`): "81 tracked files at HEAD, all
     81 staged as DELETED" — same column misreading.
   - `EV-QA-009` (`runs/2026-10-03-qty-authority`): "deleted by another lane, owner UNKNOWN".
   - `EV-20261003-DRAWING-QUANTITY-PERSISTENCE-BLOCKED`: "blocked solely by the deleted
     `drizzle/` directory, which is another lane's".
   - `EV-DIA-018` (`runs/2026-10-03-intake-atomicity`): "81 migrations deleted by another lane".
   No run note, handoff or commit states an intention to remove the directory.
3. **The project's own documents require it to be retained.**
   - `drizzle-active/README.md`: "Legacy `drizzle/0085_…sql` is **preserved** as immutable
     history"; "`drizzle/` is immutable legacy history and **must not be enumerated by active
     runners**".
   - `drizzle-active/manifest.json`: `"legacyDirectory": "drizzle"` with **75 distinct
     provenance `source` references** into `drizzle/*.sql`.
   The prohibition is on *executing* the legacy chain, not on *retaining* the files.
4. **It causes active, measurable damage.** 41 test files read `../drizzle/*.sql` as live
   fixtures. Two of them are inside the default `npm test` gate. Before the restore:

   ```
   tests/task9-fire-alarm-library.test.mjs → ENOENT drizzle/0007_…, drizzle/0014_task9_fire_alarm_library.sql
   tests/boq-extractor.test.mjs            → ENOENT drizzle/0027_restore_engineering_knowledge_conflicts.sql
   tests/organization-dashboard-scope.test.mjs → ENOENT drizzle/0018_verified_library_authorization.sql
   ```

**Conclusion: accidental/stale, ownerless, and harmful. Restoring it is the correct repair.**

---

## B. Current Git Ownership State

| Fact | Value |
|---|---|
| Branch / HEAD | `main` / `292bb86` |
| Total dirty entries before | 1056 (`??` 902, ` M` 54, `A ` 19, ` D` 81) |
| `drizzle/` tracked in HEAD | yes, 81 files (66 SQL + 15 meta) |
| `drizzle/` staged | **no** — 0 staged paths |
| Deletion committed anywhere | **no** — `git log -- drizzle/` last touched in `5af70ac` |
| Any lane claiming ownership | **no** — three lanes each assumed another owned it |
| `drizzle-active/` tracked | **no** — entirely `??` untracked |

`drizzle/` and `drizzle-active/` are disjoint: the canonical chain is **not tracked in git at
all**. That is the real durability risk, and it is a separate finding from this lane.

---

## C. Canonical Migration State

**The canonical chain is `drizzle-active/`, not `drizzle/`.** Three independent authorities agree:

1. `drizzle.config.ts` → `out: "./drizzle-active"`.
2. `drizzle-active/manifest.json` → `activeDirectory: "drizzle-active"`,
   `legacyDirectory: "drizzle"`, `cutoffMigration: "0018_…sql"`.
3. `docs/migration-baseline-adoption.md` → "The active migration chain is `drizzle-active/`.
   The legacy chain in `drizzle/` is historical evidence and **must not be replayed**"
   (DB-001: reason from `drizzle-active/*.sql`, never from `db/schema.ts`).

| Question | Answer |
|---|---|
| Latest migration in HEAD (`drizzle/`) | `0063_understanding_review_evidence_guard_ignore_failed_newer.sql` |
| Latest in canonical chain | `drizzle-active/0019_fixed_angel.sql` (journal: 20 entries, idx 0–19) |
| Correct next migration number | **`drizzle-active/0020_*`** — not 0064 |
| Migration metadata exists? | Journal + 20 snapshots exist **in the working tree only** (`??`) |
| Was D1 built from drizzle migrations? | **No.** D1 has **0** `__drizzle*` bookkeeping objects |
| HEAD's `drizzle/meta/_journal.json` | registers only **14** of 66 SQL files (0000–0013) — already stale in HEAD |

**Live D1 lineage is non-linear**, independently re-verified against the canonical file:

- has `specification_clause_candidate_decisions` (0016) ✔
- has `fire_alarm_preliminary_sizing_snapshots` (0017) ✔
- **lacks** `specification_clauses.candidate_mechanism` (0014) ✘
- no migration ledger at all

So a blind replay is wrong and "apply the head only" is also wrong. This matches
`EV-20261002-QUOTATION-UPGRADE-SAFE`, which records: *"the canonical live dev D1 is NOT in the
drizzle-active lineage … 0019 must not be applied to it directly."*

---

## D. `0064` Handoff Audit — `out/qty-authority/INFRASTRUCTURE-HANDOFF-0064.sql`

The domain model it targets is real and complete: `app/domain/drawing-quantity-authority.mjs`
(24.6 KB), exporting `DRAWING_QUANTITY_AUTHORITY_VERSION = "drawing-quantity-authority-1.0.0"`,
`computeQuantityAuthorityFingerprint`, `isFingerprintCurrent`, `QUANTITY_FINGERPRINT_KEYS`.

### What is valid

- **Column set faithfully mirrors the domain claim.** Verified field-by-field against the
  `buildQuantityClaim` return (lines 193–228). No quantity-semantics redesign needed.
- **Fingerprint is genuinely re-checkable from the row.** All 16 keys of
  `QUANTITY_FINGERPRINT_KEYS` are persisted columns. Proven by direct set comparison — the
  handoff's claim that `isFingerprintCurrent()` works post-persist is **correct**.
- **No downstream contamination.** No SLC pool, address, allocation, sizing, selection, price
  or quotation column. Matches the engine's own documented exclusion list.
- **`quantity` NULL-never-0** is carried as intent, consistent with the domain.
- FK targets `projects` and `document_versions` both exist in live D1.
- Table does not already exist (`drawing_quantity_claims` count = 0).

### Two blocking defects

**D1 — The numbering premise is invalid.** "NEXT MIGRATION NUMBER: 0064 (HEAD's highest is
0063)" reasons from the **legacy** chain. `drizzle/` is frozen history that must never be
executed; the live chain is `drizzle-active/` at 0019. Authoring `0064` into `drizzle/` would
create a migration in a directory the runbook forbids as a runner, and would collide with
future `drizzle-active/0020`. **The correct target is `drizzle-active/0020_drawing_quantity_claims.sql`.**

**D2 — The "current" unique index does not enforce uniqueness.** Proposed:

```sql
CREATE UNIQUE INDEX drawing_quantity_claims_current_idx
  ON drawing_quantity_claims(project_id, document_version_id, sheet, floor_or_area,
                             device_class, device_variant)
  WHERE superseded_at IS NULL;
```

`sheet`, `page` and `floor_or_area` are all nullable. SQLite treats NULLs as distinct in
UNIQUE indexes, so the constraint silently no-ops for exactly the common case where no sheet
or floor is known. Proven in an isolated scratch DB:

```
-- as proposed (sheet/floor NULL):  2 duplicate CURRENT rows ACCEPTED
-- control, same index, NOT NULL:   UNIQUE constraint failed  ✔
```

This matters because the table's whole purpose is to be the single current authority per
project/version/class/variant. It would permit two conflicting current claims.

### Review notes (not blocking)

- `document_id` carries no FK, though it is inside the fingerprint allowlist.
  `drawing_symbol_recognition_versions` FKs both `document_id` and `project_id`.
- `previous_version_id` has no FK.
- `state` and `coverage_state` are both `NOT NULL`, but `coverage_state` is a pure function of
  `state` in the domain (`Complete|Partial|Unresolved`). Persisting both independently
  permits drift.
- No immutability trigger, unlike `review_decisions_immutable_*` / `review_audit_log_immutable_*`.
  Convention for this project is append-only + `superseded_at`.
- `source_asset_ids` is stored as TEXT; the writer must round-trip it to an **array** before
  hashing, or the fingerprint differs from the in-memory value.

---

## E. Safe Recovery Decision

**Path C — restore `drizzle/` from HEAD (proven safe), and use `drizzle-active/` as the
migration mechanism for anything new.**

Not A, because A's "add migration to `drizzle/`" is invalid (defect D1).
Not B, because there is no *intended* staged deletion to reconcile — the index was never touched.
Not "restore then add 0064", for the same reason as A.

Restore preconditions, all verified before acting:

| Precondition | Evidence |
|---|---|
| HEAD content unmodified | `git diff --cached --stat -- drizzle` → empty |
| Nothing on disk to lose | `ls drizzle` → No such file or directory |
| Path-scoped, no collateral | `git checkout HEAD -- drizzle/` (not `git checkout .`) |
| Ownership unowned + unintended | §A items 1–4 |

After restore: 66 SQL + 15 meta on disk, **0 dirty entries under `drizzle/`**, total dirty
entries 1056 → **975** (exactly −81, no new drift). `drizzle-active/` untouched (still `??`,
20 SQL). Staged paths unchanged at 19 (all pre-existing `A `).

---

## F. Changes Made

One command, path-scoped:

```
git checkout HEAD -- drizzle/
```

Nothing else. No schema file authored, no migration generated, no D1 write, no business
logic touched, no commit/push/deploy.

---

## G. Schema Verification

**Migration verification: N/A — no migration was landed.** Live D1 re-read immediately before
this report: 318 tables, `drawing_quantity_claims` = 0, drizzle bookkeeping = 0.

**Restore verification — ENOENT eliminated:**

| Test | Before restore | After restore |
|---|---|---|
| `tests/boq-extractor.test.mjs` | ENOENT | **16/16 pass** |
| `tests/task9-fire-alarm-library.test.mjs` | ENOENT | 37 tests, 36 pass, **1 fail** |
| `tests/organization-dashboard-scope.test.mjs` | ENOENT | 6 tests, 2 pass, **4 fail** |

The 5 residual failures are **not** caused by the restore, and each is attributed with
evidence rather than asserted as pre-existing:

1. **`organization-dashboard-scope` × 4 — `no such table: boq_items`.**
   Stack: `currentBoqEvidenceCounts` (`worker/current-evidence-scope.mjs:152`) →
   `collectProjectFacts` (`worker/dashboard-api.mjs:67`). The test's inline fixture creates
   ~25 tables but **not** `boq_items`, and neither does `drizzle/0018`. HEAD's
   `current-evidence-scope.mjs` also reads `boq_items` (lines 14, 133). So the
   fixture/code mismatch exists at HEAD; the ENOENT was **masking** it. The restore revealed
   a latent failure rather than creating one. Repairing it means editing the test fixture —
   another lane's test, out of this scope.

2. **`task9-fire-alarm-library` × 1 — `55 !== 52`.**
   Line 47 asserts `Object.values(FIRE_ALARM_TAXONOMY).flat().length === 52`; it is now 55.
   `app/domain/fire-alarm-taxonomy.mjs` is foreign-modified (` M`) in the shared tree. A
   foreign lane added 3 taxonomy entries without updating this count. Unrelated to `drizzle/`.

---

## H. Exact Remaining Blocker

**Landing `drawing_quantity_claims` requires an owner decision on three points, plus an
approved apply path that does not currently exist.**

1. **Renumber/relocate** `0064` → `drizzle-active/0020_drawing_quantity_claims.sql`. The
   handoff author must confirm, since the handoff is their artifact.
2. **Fix defect D2** — make the current-uniqueness constraint actually enforce uniqueness
   (`COALESCE` expression index, or `NOT NULL` with a sentinel, or drop `sheet`/`floor_or_area`
   from the identity). This is a design decision, not a mechanical edit.
3. **Choose an apply path.** `docs/migration-baseline-adoption.md` forbids
   `wrangler d1 migrations apply`, forbids writing `d1_migrations` rows, and forbids replaying
   `drizzle/0000`–`0082`. Live D1 has no ledger and a non-linear lineage, and
   `EV-20261002-QUOTATION-UPGRADE-SAFE` states 0019 must not be applied to it directly. The
   proven delta is `0014 + 0019`, and `scripts/live-reconciliation-runbook.sh` requires typed
   confirmation before the canonical file is touched — **not executed**.

Until then, persistence stays blocked and `out/qty-authority/INFRASTRUCTURE-HANDOFF-0064.sql`
must not be applied as written.

---

## Final Flags

```
DRIZZLE_DELETION_INTENT_RESOLVED = YES      # unowned + unintended (unstaged, no recorded intent, contradicts README/manifest)
SAFE_TO_RESTORE_DRIZZLE = YES               # HEAD content unmodified, nothing on disk, path-scoped restore
CANONICAL_MIGRATION_PATH_PROVEN = YES       # drizzle-active/ per drizzle.config.ts + manifest.json + migration-baseline-adoption.md; head 0019; next = 0020
DRAWING_QUANTITY_SCHEMA_HANDOFF_VALID = NO  # D1: 0064 is a legacy-chain number, must be drizzle-active/0020. D2: current-unique index no-ops on NULL sheet/floor (proven)
DRAWING_QUANTITY_SCHEMA_LANDED = NO         # blocked on 2 owner decisions + no approved apply path; runbook forbids the obvious one
DRAWING_QUANTITY_PERSISTENCE_INFRASTRUCTURE_READY = NO
```

Also recorded, and outside this lane's mandate:

```
CANONICAL_MIGRATION_CHAIN_IS_UNTRACKED_IN_GIT = YES   # drizzle-active/ is ?? — the real durability risk
DRIZZLE_RESTORE_CAUSED_NEW_TEST_FAILURES = NO         # 41 ENOENT cleared; 5 residual failures attributed with evidence
CURRENTNESS_STATUS = PROVEN                          # all live figures re-read immediately before this report
```

No business-logic changes. No direct ad-hoc D1 SQL. No commit/push/deploy. No schema, drizzle
or `db/schema.ts` modification. No pricing, sizing, allocation, address demand or quotation
touched.
