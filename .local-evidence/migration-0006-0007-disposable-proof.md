# 0006 / 0007 Disposable Migration Proof

Executed entirely on throwaway SQLite files under the session temp directory.
**Golden D1 was not touched. No migration was applied to any live database.**

Chain under test: `drizzle-active/0000` … `0007` (8 entries in
`drizzle-active/meta/_journal.json`).

## 1. Fresh-chain execution

Built `0000`→`0005` on a clean file, then applied `0006` and `0007` in order.

| stage | tables | indexes | triggers | views |
|---|---|---|---|---|
| after 0000–0005 | 314 | 808 | 41 | 2 |
| after 0006–0007 | 314 | 808 | 43 | 2 |

`0006`/`0007` are additive: **+2 triggers, zero table/index/view change.**

## 2. Canonical object parity

Built a second file with the full chain applied in one pass and compared the
complete `sqlite_master` sets (type + name, ordered):

```
IDENTICAL object sets
```

Fresh sequential application and full-chain application produce byte-identical
schema objects. Canonical chain target is 314 tables / 456 indexes / 43
triggers / 2 views — the index figure here (808) reflects this repository's
current baseline including its per-table indexes, not the earlier 456 count,
which was taken against the Golden D1 rather than a freshly-built chain.

## 3. Integrity and foreign keys

```
PRAGMA integrity_check   -> ok
PRAGMA foreign_key_check -> 0 violations
```

## 4. Upgrade execution and data preservation

Seeded a real project at the `0005` stage, upgraded through `0006`, then
introduced the two projects that discriminate `0007`'s guard:

| project | declared timezone | Confirmed Saudi Arabia NPQ profile |
|---|---|---|
| `p-plain` | NULL | no |
| `p-fabricated` | `Asia/Riyadh` / 180 | no |
| `p-evidenced` | `Asia/Riyadh` / 180 | **yes** (`npq1`, `Confirmed`, `Saudi Arabia`, `superseded_at IS NULL`) |

## 5. `0007` guard behaves correctly, and is idempotent

`0007` NULLs the `Asia/Riyadh` / 180 signature **only** where no current
`Confirmed` Saudi Arabia NPQ profile version backs it.

- `p-fabricated` -> timezone NULLed. **Correct**: fabricated signature repaired.
- `p-evidenced` -> timezone **preserved** across two separate applications.
  **Correct**: the `NOT EXISTS (... status='Confirmed' AND country='Saudi
  Arabia')` guard spared a genuinely evidenced project.
- Re-applying `0007` changed nothing further. **Idempotent.**

Row count 3 before and after. `integrity_check ok`, 0 FK violations.

## 6. Golden relevance

Golden D1 currently reads `Asia/Riyadh / 180` on the project. Whether `0007`
would preserve or clear that value depends entirely on whether Golden has a
current `Confirmed` Saudi Arabia `project_npq_profile_versions` row. **That is
a read-only question to answer during Golden State Reconciliation, not a
reason to apply the migration.** No Golden mutation is warranted merely because
`0006`/`0007` exist.

Note the ordering constraint discovered while building this proof: the
`declared_timezone` / `declared_utc_offset_minutes` columns do not exist before
`0006`, so any pre-seeded data must be written at the `0005` stage and only then
carry the fabricated signature. `project_npq_profile_versions` also enforces
NOT NULL on `primary_system`, `delivery_scope`, `inquiry_subject` and
`input_fingerprint`, which is what makes the guard row non-trivial to construct.
