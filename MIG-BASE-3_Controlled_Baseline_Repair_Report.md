# MIG-BASE-3 — Controlled Baseline Repair Report

## 1. Executive Verdict

**Repository baseline: 🔴 NOT REPAIRED — BASELINE DRIFT STOP**

**Database execution verification: ⚪ NOT RUN / NOT VERIFIED**

MIG-BASE-2's pre-0061 reference is no longer the current repository source boundary. The current migration source and the current Golden D1 have a fully reconciled business-table set, but Golden is missing source-defined non-table objects. Creating a new active baseline before deciding the canonical cutoff and object dispositions would risk canonicalizing an unsettled target.

No baseline, schema completion, metadata repair, collision normalization, generation probe, or database adoption was implemented.

## 2. Authorization Boundaries Observed

Observed boundaries:

- No database mutation.
- No migration execution against any database.
- No Wrangler/D1 migration apply.
- No baseline application.
- No D1 migration-ledger write.
- No Golden data or schema mutation.
- No database reset or recreation.
- No deploy, commit, push, or runtime restart.
- No destructive Git operation.
- No legacy migration rename, move, deletion, or semantic edit.
- No `db/schema.ts` edit.
- No `drizzle.config.ts` or Wrangler migration-directory edit.

The Golden D1 was inspected only through SQLite's immutable read-only URI. Its file mtime and size were not changed by the inspection.

## 3. Refreshed Pre-Repair State

Repository state at pre-flight:

- HEAD: `029b42637ac117f810e726b40c2e888c484c173b`
- `db/schema.ts` SHA-256: `2f2961f325debc489df8df3675b69abb0358c12e8cac5afed224e147e0e2033b`
- `drizzle/meta/_journal.json` SHA-256: `1243944b377f96c1e754ddced00347a4a51483a3a3b4d5aab181537721de35ca`
- Physical migration SQL files: **85**
- Unique numeric prefixes: **83**
- Journal entries: **14**, ending at `0013_smart_cable`
- Journal snapshots: **14**, ending at `0013_snapshot.json`
- `db/schema.ts` table declarations: **198**
- Legacy collision files still present and unchanged: all four `0019`/`0020` files.

The shared tree remains heavily dirty. No write handle was observed on the migration-critical paths during the stability checks. However, migrations `0064`–`0082` are untracked and the schema source is modified, so there is no demonstrated migration-owner lock.

## 4. 0019 / 0020 Collision Treatment

No treatment was implemented.

The four files remain preserved as historical artifacts:

- `drizzle/0019_identity_library_scope_isolation.sql`
- `drizzle/0019_requirement_review_immutability.sql`
- `drizzle/0020_applicability_decision_immutability.sql`
- `drizzle/0020_identity_mutation_compare_and_swap.sql`

The evidence confirms that each pair is complementary and historically applied. They must not be deduplicated. A future active baseline must isolate them from active migration enumeration; this slice did not alter their paths or contents.

## 5. `db/schema.ts` Completion

Current static comparison against the source-defined current business-table set:

- Source-final business tables: **311**
- `db/schema.ts` declarations: **198**
- Missing business-table declarations: **113**
- Live-only business tables: **0**
- Completion performed: **none**

The historical pre-0061 result of 95 missing tables remains valid only for that snapshot. It is not the current target.

The completion is not purely append-only. Existing declarations also require later-column/FK reconciliation, and the missing set includes composite primary keys, non-`id` keys, partial indexes, descending indexes, and checks. No fields or modes were invented.

## 6. Non-Table Schema Objects

Exact normalized source-versus-live reconciliation:

| Object | Source-final | Live normalized | Source-only | Live-only |
|---|---:|---:|---:|---:|
| Business tables | 311 | 311 | 0 | 0 |
| Named indexes | 442 | 420 | 22 | 0 |
| Triggers | 30 | 29 | 1 | 0 |
| Views | 2 | 1 | 1 | 0 |

The 22 source-defined indexes absent from Golden are:

```text
boq_decisions_item_idx
boq_decisions_version_idx
boq_evidence_item_idx
boq_extraction_status_idx
boq_items_downstream_idx
boq_revision_pair_idx
boq_sections_version_idx
boq_sources_version_idx
boq_warnings_item_idx
boq_warnings_version_idx
classifications_status_idx
document_audit_document_idx
document_versions_document_idx
knowledge_facts_file_idx
knowledge_file_events_idx
knowledge_files_org_name_idx
knowledge_product_links_part_idx
processing_document_idx
processing_logs_run_idx
product_attributes_active_protocol_singleton_idx
spec_job_document_idx
upload_sessions_project_idx
```

The missing trigger is:

```text
quotation_revision_payload_update_guard
```

The missing view is:

```text
canonical_classifications
```

Migration `0081` is represented in Golden: its table, index, and all three added columns are present:

- `drawing_recognition_legend_contexts`
- `drawing_legend_context_current_idx`
- `drawing_symbol_recognition_versions.source_document_id`
- `drawing_symbol_recognition_versions.source_legend_geometry_version_id`
- `drawing_symbol_definitions.source_document_id`

The one live view is `canonical_library_products`. The missing `canonical_classifications` view is defined by `0082` and is not present in Golden.

Triggers, exact unnamed checks, and views require explicit baseline SQL ownership. They cannot be silently assumed to be preserved by `schema.ts` or a Drizzle snapshot.

## 7. New Squashed Baseline

**Not created.**

No `drizzle-baseline/`, active baseline SQL, baseline journal, or baseline snapshot was created.

A future baseline must use a separate active chain and preserve the legacy chain byte-for-byte. That design remains a plan, not an implemented artifact.

## 8. Metadata / Snapshot Repair

**Not performed.**

- `drizzle/meta/_journal.json` remains unchanged.
- All legacy snapshots remain unchanged.
- No new snapshot was generated.
- No journal entry was fabricated.
- No D1 migration-ledger record was written.

The stale 0013 metadata therefore remains the existing generation authority. This is intentional under the drift stop; it must not be used for AIU-4H generation until the canonical target is explicitly frozen and repaired.

## 9. Legacy History Preservation

Legacy history was not edited.

The 85 SQL files and the 14 legacy journal/snapshot artifacts remain in place. No duplicate migration was removed. No historical DDL or DML was rewritten.

The current source projection is not execution verification. The legacy chain has not been declared replay-safe, and replay remains forbidden for already-applied environments.

## 10. No-Change Generation Probe

**Not run.**

Reason: the canonical target is not settled, and `db/schema.ts` is missing 113 source-defined business tables. Running a no-change probe before creating a coherent active snapshot would only test an incomplete ORM projection.

## 11. Additive Generation Probe

**Not run.**

Reason: same as above. No artificial probe change was made. No generated SQL was created or inspected.

## 12. Static Schema Reconciliation

The static reconciliation established:

```text
source-final business tables = Golden business tables = 311
Golden raw tables = 312, including _cf_METADATA
```

This proves there is no unknown live-only business table. It does not prove the non-table layers are synchronized.

Current source and Golden agree on the business-table name set, but Golden lacks 22 named indexes, one trigger, and one view. Therefore the current Golden database is behind the current migration source but is not an unknown competing schema.

The stale `tests/database-authority.test.mjs` expectation of 310 is not updated in this slice. It is a symptom of the source-boundary drift, not authority for changing the expected count.

## 13. Tests Added / Changed

No tests were added or changed.

Read-only investigations produced proposed test designs, including:

- `tests/migration-baseline-safety.test.mjs`
- `tests/migration-generation-safety.test.mjs`

Those files were not created because the target baseline is not yet authorized by the reconciled source state.

## 14. Test / Lint / Build Results

No project tests, lint, build, or migration-generation command was run.

A read-only `drizzle-kit check` was inspected by a delegated lane; it is not a completeness proof and reported metadata-chain consistency only. It did not apply a migration.

No database-authority replay test was run because it executes root-level migrations.

## 15. Existing-DB Adoption Plan

Not executed and not implemented.

Future adoption must be conditional on an exact schema fingerprint and an explicit per-environment decision for the 22 missing indexes, one missing trigger, and one missing view. A metadata-only marker must never mark a baseline applied over an un-reconciled database.

No adoption script, marker, or database connection was created.

## 16. Fresh-DB Bootstrap Plan

Not executed.

A future empty-database bootstrap must use only the new active baseline directory. It must not replay the ambiguous legacy chain. The baseline SQL must be statically complete for:

- all 311 business tables;
- final named indexes;
- constraints and foreign keys;
- final trigger set;
- both current source views;
- any other migration-only SQLite objects.

No empty database was created and no baseline was applied.

## 17. AIU-4H Readiness

- Safe to design a new migration: **NO — target baseline is not frozen**
- Safe to generate a new migration: **NO — active metadata still points to stale 0013-era state**
- Safe to apply a migration: **NO — execution is not authorized and remains unverified**

AIU-4H must not begin.

## 18. Remaining Risks

1. The intended canonical cutoff is not formally frozen between the current migration source through 0082 and the current Golden state.
2. Migrations `0064`–`0082` are untracked and lack demonstrated ownership/stabilization.
3. `db/schema.ts` is materially incomplete and cannot be used as a generation baseline.
4. The 22 missing indexes, one trigger, and one view require explicit environment disposition.
5. Existing tests and D1 tooling still enumerate the legacy root; no active/legacy authority separation exists yet.
6. Golden is not a universal schema authority for all local, E2E, hosted, or test databases.
7. D1 adoption metadata format and semantics have not been verified.
8. The shared dirty tree can change underneath a future implementation.
9. The historical 0019/0020 collisions remain enumerable in the current legacy root.
10. A static object-name projection is not proof that a baseline can be applied to an empty SQLite/D1 database.

## 19. Exact Next Slice

**MIG-BASE-3A — Canonical Cutoff and Migration Stability Reconciliation** (read-only planning only).

It must, before any further implementation:

1. Freeze and document the intended target cutoff, explicitly including or excluding migration 0082.
2. Classify the 22 missing indexes, `quotation_revision_payload_update_guard`, and `canonical_classifications` as intended-current, pending, obsolete, or Golden-only drift.
3. Confirm ownership and stabilization for `db/schema.ts` and migrations `0064`–`0082`.
4. Produce a complete static object manifest for the chosen target, including columns, constraints, indexes, triggers, and views.
5. Define the active/legacy directory topology and all consumers that must be redirected.
6. Identify the exact existing-database adoption gate without writing any ledger or applying DDL.

Do not implement the baseline until MIG-BASE-3A is accepted.

## 20. What Was Not Changed

Nothing in the migration/schema baseline was changed.

Specifically not changed:

- `db/schema.ts`
- `drizzle.config.ts`
- `tests/e2e/wrangler.golden.jsonc`
- any file under `drizzle/`
- `drizzle/meta/_journal.json`
- any migration snapshot
- any legacy migration filename or SQL content
- any database or Golden data
- any D1 migration ledger
- any test file
- any application/runtime file

The only repository artifact created by this slice is this report:

`MIG-BASE-3_Controlled_Baseline_Repair_Report.md`

**STOP.**
