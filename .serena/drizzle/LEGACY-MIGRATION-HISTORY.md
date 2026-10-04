# Legacy migration history

This directory preserves the historical SQL migration chain and Drizzle metadata through the pre-baseline state.

- The SQL files, duplicate `0019`/`0020` artifacts, journal, and snapshots are historical evidence.
- They are not the active generation or execution chain.
- The files must not be replayed to create or repair a current database.
- The active chain is `drizzle-active/`.
- `scripts/apply-0080-onboarding-d-contact-title.mjs` is a legacy out-of-band operational script, not the canonical migration runner.

The canonical target is the frozen source through migration `0082`, as recorded in `drizzle-active/manifest.json`.
