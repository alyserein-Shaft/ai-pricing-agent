# Concurrent-unrelated regression note — `test:authority` 68/70 (2026-09-27 ~02:30 UTC)

## Failing tests (2)

- `document intake duplicate and revision contract is authoritative end to end`
  (`tests/document-duplicate-revision.integration.test.mjs:380`)
- `restoring a previous document version creates a new governed current version
  without mutating history`
  (`tests/document-management-actions.integration.test.mjs:472`)

## Error (identical in both)

`Error: no such table: engineering_fact_provenance`

## Stack (duplicate-revision case)

- `tests/document-duplicate-revision.integration.test.mjs:263`
  (`assessEngineeringFactImpact` caller site in test helper — actually the throw
  surfaces at the fixture's `.all`)
- `worker/engineering-fact-freshness.mjs:370` (`assessEngineeringFactImpact`
  queries `FROM engineering_fact_provenance` unconditionally)
- via `invalidateEngineeringFactsForSupersession` (`:460`)
- via `worker/document-api.mjs:260` (`upload`, after batch commit)

## Why it is NOT attributable to the DOC-R3 changes in this session

1. Neither `worker/document-api.mjs` nor `worker/engineering-fact-freshness.mjs`
   was edited in this session (mtimes 01:50 and 01:55 predate/parallel it; the
   session's production edits are `effective-time-policy.mjs`,
   `sqlite-offset-modifier.mjs`, `current-evidence-scope.mjs`,
   `boq-extraction-api.mjs`, `dashboard-api.mjs`,
   `project-effective-time-calendar.mjs`, `db/schema.ts`, `drizzle-active/*`).
2. `engineering-fact-freshness.mjs` contains zero `import` statements, so no
   changed module is in its causal chain.
3. Both failing tests use hand-rolled `new DatabaseSync(":memory:")` fixtures
   that contain no `engineering_fact_provenance` table (grep count 0), while the
   upload path now unconditionally assesses supersession impact on every
   revision upload.

## Required owner action (NOT taken here, per the concurrency policy)

The file is shared (task-owned, concurrently edited at 01:55). The fix belongs
to its owner: either `assessEngineeringFactImpact` must tolerate a schema
without provenance tables, or the upload path must, or the two hand-rolled
fixtures must gain the table. Editing it here would risk overwriting the
concurrent writer's in-flight work.

## Resolution (2026-09-26 ~23:42 UTC, no action taken here)

Both tests pass unmodified now (`npm run test:authority` 70/70, verified
individually and in-suite). The failure was transient mid-edit state: the
concurrent writer edited both test files at ~02:40-02:41 (after the failure was
observed) and the suite is green since. No production change on either side was
needed. Classification: CONCURRENT_UNRELATED, resolved by owner, no R3 action.
