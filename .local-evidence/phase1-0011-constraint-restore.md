# Phase 1 — Forward schema repair `0011` (constraint restore) — EVIDENCE RECORD

Date: 2026-09-27
Scope: repair the two constraints that migration `0010`'s rebuild lost.
Status: APPLIED LIVE + VERIFIED. No commit/push/deploy.

## 1. Defect class

`0010_requirement_intelligence_source_authority.sql` rebuilt
`requirement_intelligence_facts` and dropped two column contracts relative to
`db/schema.ts` and the pre-0010 table:

| column | intended contract (`db/schema.ts`) | post-0010 / live (before) | after `0011` |
|---|---|---|---|
| `evidence_snippet` | `text("evidence_snippet").notNull()` | `notnull=0` | `notnull=1` |
| `review_status` | `.notNull().default("Needs Review")` | `notnull=1`, `dflt=(none)` | `notnull=1`, `dflt='Needs Review'` |

The 0010 snapshot (derived from `db/schema.ts`) and the manifest always declared
the correct contract — only the applied chain SQL and the live D1 drifted.

## 2. Data safety proof

- Live rows at apply time: **1053** (`evidence_snippet` NULL = 0, `review_status`
  NULL = 0) — a `NOT NULL` restore cannot fail on data.
- No table references `requirement_intelligence_facts` (no inbound FK; verified in
  `db/schema.ts`) — DROP/rebuild safe under `foreign_keys=ON`.
- Production writes always supply both columns explicitly
  (`worker/technical-requirement-api.mjs` lines ~346 INSERT and ~492 UPDATE).

## 3. Migration content (`drizzle-active/0011_requirement_intelligence_constraint_restore.sql`)

Table rebuild (mirrors 0010's shape):
- all 23 columns preserved; the two changed are
  `evidence_snippet text NOT NULL` and `review_status text NOT NULL DEFAULT 'Needs Review'`
- both FKs preserved (`profile_version_id` → `requirement_profile_versions`,
  `requirement_id` → `technical_requirements`)
- both 0010 CHECK constraints preserved verbatim:
  `requirement_intelligence_authority_class_ck`,
  `requirement_intelligence_exactly_one_source_ck`
- both indexes recreated: `requirement_intelligence_profile_key_idx` (unique),
  `requirement_intelligence_review_idx`

## 4. Metadata

- `meta/0011_snapshot.json`: content identical to 0010 snapshot under drizzle's
  model (the post-0011 schema state); `id = c84b50e9-7023-45bb-9659-dbdf6ff41c35`
  (freshly minted UUID), `prevId = 06a26707-b603-4f9b-8ae6-f93bedcc89bc` (real
  0010 id). Content is schema-truthful: `evidence_snippet notNull:true`,
  `review_status notNull:true default:"'Needs Review'"`.
- `meta/_journal.json`: appended `{idx:11, version:"11", tag:"0011_requirement_intelligence_constraint_restore", breakpoints:true}`.
- `manifest.json`: `target.cutoffMigration` moved `0010_…` → `0011_…` (Lane A R1
  convention); no object counts changed (constraint-only migration).

## 5. Verification (independent re-runs, all PASS)

- Disposable chain `0000→0011` (12 files): 314 tables / 809 indexes / 43 triggers
  / 2 views; `integrity_check=ok`; `foreign_key_check=0`; CHECK count=2; FK
  count=2; pragmas `evidence_snippet notnull=1`,
  `review_status notnull=1 dflt='Needs Review'`.
- LIVE apply (backup `.wrangler/backups/local-d1-pre-0011-20260927-162525.sqlite`,
  integrity ok pre-apply): rows 1053 → 1053 (distinct 1053); re-apply
  outcome-idempotent (1053 → 1053, 0 FK, 0 NULL evidence_snippet);
  integrity ok; FK 0; both CHECK constraint names present.
- Suites: `database-authority` 4/4, `review-workflow-atomic` 28/28,
  `profile-applicability-source-authority` 20/20.
- `npm run db:generate` → "No schema changes, nothing to migrate"; chain triple
  12 SQL ↔ 12 journal ↔ 12 snapshots; no `0012`.
- ESLint: 0 errors on touched `.mjs`.

## 6. Test updates required by the restored contract

| file | change | why |
|---|---|---|
| `tests/database-authority.test.mjs` | pinned migration list extended with `0011_…sql` | exact-inventory assertion; 0011 is now part of the chain |
| `tests/profile-applicability-source-authority.test.mjs` | `insFact` INSERT now supplies `evidence_snippet` | fixture was valid only under the constraint-LOSS regime; the intended contract requires the snippet |

Neither weakens an assertion; both conform the fixtures to the accepted contract.

## 7. Phase 2 — the three `migration-baseline-safety` failures

Classified: **STALE/FROZEN REPOSITORY-METADATA EXPECTATION** (0007-era), NOT
product/schema defects. Not fixed (would require deleting/renumbering accepted
migrations or weakening the manifest — forbidden):

1. `:59-65` — pins `cutoffMigration:"0007_project_calendar_evidence_repair.sql"`
   and `namedIndexes:456`; accepted chain is at `0011` / `457` (0009's partial
   index). The manifest correctly reflects the live chain.
2. `:157` — `activeFiles.filter(n => n.startsWith("0008_"))` must be `[]`; the
   accepted authority repairs are `0008`/`0009`/`0010`/`0011`.
3. `:204-213` — journal entries pinned to exactly `0000..0007`; the chain is 12
   entries, all 1:1 with files, `prevId` chain verified end-to-end.

Evidence for the classification: the pending assertions about snapshot/manifest
agreement (`:199-223`) are LAST-TAG-DYNAMIC and PASS for the 0011 head; the
frozen pins are the only failures, and they contradict migrations that the R10
certification and live D1 accepted.

## 8. Files changed (Phase 1+2)

- `drizzle-active/0011_requirement_intelligence_constraint_restore.sql` (new)
- `drizzle-active/meta/0011_snapshot.json` (new)
- `drizzle-active/meta/_journal.json` (appended entry)
- `drizzle-active/manifest.json` (cutoffMigration)
- `tests/database-authority.test.mjs` (pinned list)
- `tests/profile-applicability-source-authority.test.mjs` (fixture contract)

## 9. Freshness/idempotency

- `0011` is outcome-idempotent (re-apply yields identical state; verified live).
- Next `db:generate` run produces nothing; no drift.