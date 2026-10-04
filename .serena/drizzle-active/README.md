# Active migration chain

This directory is the sole Drizzle generation and future D1 migration authority.

- Baseline cutoff: `0082_canonical_classifications.sql`
- Baseline migration: `0000_baseline_schema_0082.sql`
- Canonical active chain continues through `0006_project_effective_time_calendar.sql` (source cutoff `0084_price_record_intake_lineage.sql`)
- `0006_project_effective_time_calendar.sql` records each project's DECLARED effective-time calendar (`declared_timezone` / `declared_utc_offset_minutes`) and adds the `projects_declared_calendar_guard*` triggers. Effective time is project-scoped, so the calendar that resolves a bare `YYYY-MM-DD` effective bound is a property of the project row. The columns are nullable and carry no default on purpose: an undeclared project fails closed rather than silently inheriting a global anchor.
- Future generated migrations begin at `0007`
- Legacy `drizzle/0085_document_revision_addendum.sql` is preserved as immutable history and is **never executed**. `0005_document_revision_addendum.sql` is not a wrapper that integrates it: it independently carries the same intended document revision/addendum/supersession schema with the integrity and apply-safety gaps closed (additive-only, real foreign keys, and append-only triggers). Where the two differ, the active migration is the authority.
- The canonical ORM input is `db/schema.ts`
- `drizzle/` is immutable legacy history and must not be enumerated by active runners

The baseline SQL owns the complete SQLite target, including migration-only triggers, views, exact checks, and named indexes that are not fully represented by the Drizzle schema snapshot.

`manifest.json` is the static target-object acceptance manifest. It is not a database migration ledger and does not mark any database as adopted.

The historical `scripts/apply-0080-onboarding-d-contact-title.mjs` direct-apply path is not an active migration authority. It is retained as legacy operational evidence only and must not be used as the normal migration runner.
