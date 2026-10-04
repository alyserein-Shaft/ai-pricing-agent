# Lane A — canonical migration metadata recovery

Isolated scratch workspace + regenerators used to recover
`drizzle-active/meta/0009_snapshot.json`, `drizzle-active/meta/0010_snapshot.json`
and `drizzle-active/manifest.json`. Nothing in this directory is part of the
build; nothing outside `drizzle-active/` was modified.

## Layout

| path | role |
| --- | --- |
| `scratch/` | self-contained drizzle-kit workspace (own `db/`, own `drizzle.config.ts`, own `drizzle-active/`, `node_modules` symlink to the repo) |
| `scratch/db/state0008.ts`, `state0009.ts`, `state0010.ts` | the three historical schema states derived from `db/schema.ts` |
| `scratch/drizzle-active/meta/0009_snapshot.json`, `0010_snapshot.json` | the recovered snapshots, before copy-back |
| `scratch/drizzle-active/0009_*.sql`, `0010_*.sql` | drizzle's own SQL for those steps — **deliberately NOT copied back** |
| `scratch/make-schema-states.mjs` | derives the three schema states |
| `scratch/verify-lineage.mjs` | id/prevId chain + per-state content + diff-scope assertions |
| `scratch/verify-against-db.mjs` | cross-checks the 0010 snapshot against a disposable chain and the live D1 (readOnly) |
| `scratch/manifest-delta.mjs` | computes the exact manifest-vs-chain delta |
| `regenerate-manifest.py` | deterministic manifest regeneration, self-verifying |
| `manifest.regenerated.json` | the regenerated manifest, before copy-back |
| `backup/manifest.json.before` | byte copy of the pre-existing manifest |
| `replay-metadata-gate.mjs` | replays the metadata gate's assertions that sit after its frozen 0007-era tag list |

## Why the scratch SQL was thrown away

`scratch/drizzle-active/0009_profile_applicability_device_identity_authority.sql`
contains **0** `CHECK` constraints; the accepted canonical
`drizzle-active/0009_profile_applicability_device_identity_authority.sql` contains
**3**. `db/schema.ts` declares no `check()` constraints, so any table rebuild
drizzle-kit generates strips them. Only the snapshots were taken from the scratch
tree; the SQL stayed there.

## Re-run

```bash
cd .local-evidence/laneA/scratch
node make-schema-states.mjs
cp db/state0008.ts db/schema.ts && node ../../../node_modules/drizzle-kit/bin.cjs generate --name=probe_0008   # must print "No schema changes"
cp db/state0009.ts db/schema.ts
( sleep 3; printf '\033[B'; sleep 1; printf '\r'; sleep 3 ) | script -q /dev/null node ../../../node_modules/drizzle-kit/bin.cjs generate --name=profile_applicability_device_identity_authority
cp db/state0010.ts db/schema.ts && node ../../../node_modules/drizzle-kit/bin.cjs generate --name=requirement_intelligence_source_authority
node verify-lineage.mjs && node verify-against-db.mjs
cd ../.. && python3 .local-evidence/laneA/regenerate-manifest.py
```

The snapshot `id` / `prevId` UUIDs are minted by drizzle-kit on every run, so a
re-run produces different (equally valid) lineage ids.
