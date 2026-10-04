# Legacy schema boundary (added 2026-10-03, P0 0019 reconciliation)

## The intentional divergence

The live D1 database contains tables that `db/schema.ts` does not declare and that
`drizzle-active/meta/*_snapshot.json` deliberately does not track. This is a known,
accepted boundary. It is NOT drift to be cleaned up.

Live D1 holds 318 tables. `db/schema.ts` declares 199. The gap is real and is
preserved on purpose.

### Why the legacy tables are excluded from Drizzle ownership

`drizzle-kit generate` diffs `db/schema.ts` against the **last snapshot**. A table
that appears in the snapshot but not in `db/schema.ts` is treated as a deletion
and re-emitted as `DROP TABLE`.

That was measured directly. Restoring the 27 legacy tables into
`meta/0019_snapshot.json` — the obvious-looking fix — produced
`DROP_TABLE_RISK = 27` on the very next generation. It reintroduced the exact
hazard the P0 reconciliation removed, one generation later.

So the legacy tables are left **unmanaged by Drizzle**: invisible to generation,
and therefore safe. Verify with:

```
node scripts/check-future-generation-safety.mjs
```

which must report `DROP_TABLE_RISK = 0` and `DROP_COLUMN_RISK = 0`.

### What enforces preservation instead

Because the snapshot cannot protect them, protection is enforced at apply time:

- `scripts/check-migration-destructive-ddl.mjs` refuses any candidate migration
  that drops a table holding live rows, tightens a nullable column to NOT NULL,
  drops a column that holds data, or drops a CHECK constraint the live database
  enforces.
- `scripts/live-reconciliation-runbook.sh` runs that guard as a hard gate before
  the first mutating statement, and applies migrations through
  `scripts/apply-migration-atomic.mjs`, which is all-or-nothing.

### The 27 unmanaged legacy tables

`case_learning_evaluations`, `commercial_conditions`,
`drawing_architecture_review_events`, `drawing_recognition_legend_contexts`,
`drawing_title_block_field_reviews`, `estimator_understanding_field_reviews`,
`historical_boq_alignments`, `historical_boq_audit_log`,
`historical_boq_decisions`, `historical_boq_files`, `historical_boq_final_rows`,
`historical_boq_pattern_sources`, `historical_boq_patterns`,
`historical_boq_projects`, `historical_boq_rows`,
`historical_boq_validation_runs`, `library_permission_grants`,
`library_scope_backfill_decisions`, `library_security_principals`,
`price_record_versions`, `pricing_memory_relationships`,
`product_identity_decisions`, `product_package_components`, `product_packages`,
`product_reference_registry`, `supplier_branches`, `supplier_contacts`.

18 hold live rows (3,502 in total). 11 are seeded or asserted by `tests/`,
including `library_security_principals` and `library_permission_grants`, which
carry identity and authorization fixtures.

None of the 27 is read or written by any module under `app/` or `worker/`. They
are not dead by that evidence alone, and no runtime reference does not prove
obsolescence. `historical_boq_*` has a live successor feature
(`case_studies`, read by `worker/historical-learning-pack-import.mjs`), and
`product_reference_registry` is superseded by `product_reference_registry_v2`
(40 live rows, read by `worker/identity-production-governance.mjs`).

**Rule: unproven safe to delete = preserve.** Removing any of these requires its
own evidence and its own authorization as a separate task. Schema reconciliation
is not schema cleanup.

## Columns preserved but not declared in db/schema.ts

33 columns were dropped by the original 0019 and are now preserved. Two are worth
naming because they are dense with governed identity:

- `product_attributes.source_id` — 651 populated rows of `productsource_*`
  provenance pointers. There is no duplicate column; dropping it destroys
  attribute provenance.
- `documents.document_family_id` — 266 populated rows of `docfam_*` document
  family links. No replacement column exists.

Both are preserved. Their absence from `db/schema.ts` is the same unmanaged-legacy
boundary described above.

## The XOR source-authority model is NOT part of that boundary

`profile_requirement_applicability` and `requirement_intelligence_facts` **are**
Drizzle-managed, and `db/schema.ts` now declares the canonical model correctly:

- `requirement_source` NOT NULL
- `requirement_id` NULLABLE
- `device_identity_ref` NULLABLE
- exactly one of `requirement_id` / `device_identity_ref` populated

This was the root cause of the destructive 0019: `db/schema.ts` declared
`requirement_id NOT NULL` and omitted both authority columns, so Drizzle
generated a rebuild that aborted against 520 valid rows.

The 520 rows with a NULL `requirement_id` are correct by design — a
device-identity observation is represented by `requirement_id IS NULL` plus a
populated `device_identity_ref`. **Backfilling them would fabricate a
`technical_requirements` foreign key out of a drawing or BOQ identity. Blind
`requirement_id` backfill is permanently prohibited.**

## CHECK constraints are hand-authored, not generated

Drizzle snapshots in this project record `checkConstraints: {}`. The XOR CHECK
constraints on both tables are written directly into migration SQL
(`0009`, `0010`, `0011`, and the repaired `0019`). Drizzle will not regenerate or
preserve them, so any rebuild of those tables must re-declare them explicitly —
`scripts/check-migration-destructive-ddl.mjs` fails closed when one is dropped.
