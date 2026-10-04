# Migration baseline execution and adoption runbook

## Scope

The active migration chain is `drizzle-active/`. The frozen canonical cutoff is `0082_canonical_classifications.sql`.

The legacy chain in `drizzle/` is historical evidence and must not be replayed to adopt or repair an existing database.

## Schema authority (DB-001)

`drizzle-active/` SQL is the authoritative schema source. `db/schema.ts` is a
partial, non-authoritative representation and must not be treated as the schema:

- the active baseline declares 442 `CREATE INDEX` statements; `db/schema.ts`
  declares 152 `index()` constructs;
- the knowledge tables are barely represented in `db/schema.ts` (14 mentions).

Consequences for agents and developers:

- reason about indexes, constraints, and table definitions from
  `drizzle-active/*.sql`, never from `db/schema.ts` alone;
- do not add or remove schema objects based on what `db/schema.ts` appears to
  contain or omit;
- do not attempt to reconcile the two files for symmetry; the migration SQL
  wins by definition.

## Repository-only preparation

The static baseline verifier is:

```bash
node scripts/verify-migration-baseline.mjs <sqlite-path>
```

The verifier opens SQLite with `readOnly: true` and checks:

- `PRAGMA quick_check`;
- `PRAGMA foreign_key_check`;
- exact business table set;
- table column-name parity;
- named-index parity;
- trigger set and normalized SQL;
- view set and normalized SQL;
- frozen manifest identity.

It does not apply DDL, write rows, or write a migration ledger.

## Future disposable bootstrap verification

Requires separate authorization to execute SQL. The command must use a disposable database path outside all configured project bindings:

```bash
node scripts/verify-migration-baseline.mjs /path/to/disposable.sqlite
```

The disposable database must be created by an approved execution harness from `drizzle-active/0000_baseline_schema_0082.sql`. It must never be a Golden, local project, staging, production, or configured D1 path.

## Existing-database adoption

An existing database may be adopted only after the verifier passes against the exact frozen manifest. Adoption must additionally verify:

- no unexpected business objects;
- exact column types, nullability, and defaults;
- PK/FK/UNIQUE/CHECK parity;
- exact trigger SQL;
- exact view definitions and output columns;
- duplicate preflight for `boq_revision_pair_idx`;
- duplicate preflight for `product_attributes_active_protocol_singleton_idx`;
- data-preservation fingerprints;
- a verified migration-ledger contract;
- quiescent writers;
- an approved backup or disposable clone.

A mismatched database must not receive a baseline marker.

## Forbidden operations

Do not use this runbook to:

- replay `drizzle/0000`–`drizzle/0082`;
- run `wrangler d1 migrations apply`;
- write `d1_migrations` rows;
- mutate Golden;
- reset or recreate a database;
- use a project-configured D1 binding as a disposable target.

## Current status

- Static repository baseline: available.
- Filesystem-only generation probes: available.
- Disposable bootstrap execution: deferred pending explicit authorization.
- Existing-database adoption marker: deferred pending ledger verification and authorization.
- Golden: unchanged and not an adoption target.
