# Local D1 Operations Runbook (Agent 2 — Commercial, Quotation, Export, Delivery)

Scope: the **local development** Cloudflare D1 database and the R2 export bucket.
This runbook describes only what has actually been exercised. It is not a disaster
recovery plan and does not claim to be one.

## 1. Identify the active local D1

The canonical dev server (`:4183`, started via `npm run dev`) persists D1 through the
Cloudflare Vite plugin. Its state lives under the project:

```
.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite
.wrangler/state/v3/d1/miniflare-D1DatabaseObject/metadata.sqlite   # miniflare bookkeeping, NOT the app DB
```

Confirm the live process and its state path:

```bash
lsof -nP -iTCP:4183 -sTCP:LISTEN -t
ps -o command= -p <pid>
```

> The hash in the filename is the D1 database id from `.openai/hosting.json`. Do not
> assume it; locate the non-`metadata` sqlite file.

## 2. Back up safely

The dev server holds this file open, so **copy, never mutate**:

```bash
LIVE=.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p .wrangler/backups
cp "$LIVE" ".wrangler/backups/dev-d1-$STAMP.sqlite"
```

`cp` of an open SQLite file can capture a torn write if a transaction is in flight.
For a quiesced copy, stop the dev server first. The file is ~450 MB, so a copy takes
a moment. This is the procedure that was actually used before the G-6 migration
repair (`.wrangler/backups/dev-d1-pre-g6-*.sqlite`).

## 3. Restore into an isolated environment (exercised)

Verified: copying the live file to a scratch path and opening it read-only yields
`PRAGMA integrity_check = ok`, **0** foreign-key violations, and readiness satisfied.

```bash
RESTORE=/tmp/restore-test.sqlite
cp "$LIVE" "$RESTORE"
sqlite3 "$RESTORE" "PRAGMA integrity_check; PRAGMA foreign_key_check;"
```

To run the *app* against a restored copy without touching the shared DB, give the
server its own state directory. `vite.config.ts` feeds the Cloudflare plugin's
`persistState` from `GOLDEN_E2E_STATE_DIR`; without it the plugin falls back to
`persistState: true`, which is the **shared** `.wrangler/state`. That fallback is the
single most dangerous thing in this runbook — an "isolated" server will silently
read and write the shared database.

```bash
GOLDEN_E2E_STATE_DIR=/tmp/hermetic-state npm run dev -- --port 4199
```

## 4. Verify schema and readiness after a restore

Readiness is derived from **real schema introspection**, not from a migration version
string. `/api/health/ready` verifies 36 required tables and 130 required columns for
the R1 commercial chain, plus the authentication configuration.

```bash
curl -s http://localhost:4183/api/health/ready | jq '.dependencies'
```

A restored copy can be checked offline against the same contract without a server:

```bash
node --input-type=module -e '
import { DatabaseSync } from "node:sqlite";
const m = await import("./app/domain/production-readiness.mjs");
const db = new DatabaseSync(process.argv[1], { readOnly: true });
const objs = new Set(db.prepare("SELECT name FROM sqlite_master").all().map(r => r.name));
const req = [...new Set([...m.READINESS_REQUIRED_TABLES, ...m.READINESS_REQUIRED_COMMERCIAL_TABLES])];
const missingT = req.filter(t => !objs.has(t));
const missingC = [];
for (const [t, cols] of Object.entries(m.READINESS_REQUIRED_COLUMNS)) {
  if (!objs.has(t)) { missingC.push(...cols.map(c => `${t}.${c}`)); continue; }
  const have = new Set(db.prepare(`PRAGMA table_info("${t}")`).all().map(r => r.name));
  for (const c of cols) if (!have.has(c)) missingC.push(`${t}.${c}`);
}
console.log({ missingTables: missingT, missingColumns: missingC });
' "$RESTORE"
```

## 5. Verify pricing and quotation records survive

```bash
sqlite3 "$RESTORE" "SELECT COUNT(*) FROM projects;
                   SELECT COUNT(*) FROM pricing_scenarios;
                   SELECT COUNT(*) FROM pricing_lines;
                   SELECT COUNT(*) FROM project_quotation_revisions;
                   SELECT COUNT(*) FROM excel_export_jobs;"
```

Then confirm the commercial numbers still price identically, using the executed
authority tests (they do not need a server):

```bash
node --test tests/commercial-pricing-authority.test.mjs \
          tests/commercial-policy-persistence.test.mjs \
          tests/production-readiness-schema.test.mjs
```

## 6. R2 / export artifact considerations

Customer workbooks are written to R2 under
`excel-exports/{projectId}/{exportJobId}/{filename}` and recorded in
`excel_export_files` with `sha256` and `byte_size`. **Restoring D1 does not restore
R2.** After a D1 restore, export rows will reference R2 objects that may not exist.
Treat a D1 restore as incomplete until the referenced R2 keys are confirmed present
and their `sha256` re-verified. A database-only backup is therefore *not* a complete
backup of commercial deliverables.

## 7. Rollback conditions

Roll back (restore the backup over the live file) only when, after a schema change,
readiness fails, `integrity_check` is not `ok`, foreign keys are violated, or
commercial reads throw. Rollback is a file replacement plus a dev-server restart,
because the running process holds the old file handle and the new code may expect the
new schema.

## 8. What must never be done on the shared D1

- Never `git reset`, `git clean`, `git checkout .`, or `git restore .` — the working
  tree carries other agents' uncommitted work.
- Never DROP a table on the shared development database. Migrations are applied to a
  **fresh** state directory for verification, not to the shared one.
- Never fabricate `d1_migrations` rows. See the migration-state note below.
- Never point an "isolated" dev server at the shared state by forgetting
  `GOLDEN_E2E_STATE_DIR`.
- Never expose `APP_R1_ACCESS_TOKEN` / `APP_SESSION_SECRET` outside the gitignored
  `.dev.vars` (local) or `wrangler secret put` (deployed).

## 9. Migration state of the local database (recorded reality)

The local D1 has **no `d1_migrations` table**. `wrangler d1 migrations list` therefore
reports all 18 active migrations as pending, which is *not* a statement that they are
absent — it is the absence of bookkeeping.

What is true now, established by direct schema introspection:

- Migrations `0000`–`0012`, `0014` were already present in the local database.
- `0013`, `0015`, `0016`, `0017` were **not** applied and were applied on
  2026-09-30 (backup taken first). `0015` was the one breaking the dashboard.
- `0008` remains intentionally **unapplied**: it would rebuild Agent 1's
  `profile_requirement_applicability` table to add `drawing_requirement_ref`, a
  column no code reads. This is recorded technical migration debt, not an oversight.
- Two indexes from already-applied migrations (`0008`, `0013`) are missing; the
  `0008` one cannot be created without that column.

**Schema truth is now established by introspection, not by bookkeeping.** Readiness
verifies 36 tables / 130 columns directly, so a fresh database built purely from the
active chain and this repaired local database satisfy the same contract — both were
verified. Historical migration rows were deliberately **not** backfilled: writing
"applied" records for a partially applied database would destroy the only honest
signal available. The safe forward procedure is to compare real schema against the
active chain (as the readiness contract does) and apply only genuinely missing DDL.

## 10. Fresh environment procedure (deterministic)

```bash
STATE=$(mktemp -d)
node node_modules/wrangler/bin/wrangler.js d1 migrations apply site-creator-d1 \
  --local --persist-to "$STATE" --config tests/e2e/wrangler.golden.jsonc
node node_modules/wrangler/bin/wrangler.js d1 execute site-creator-d1 \
  --local --persist-to "$STATE" --config tests/e2e/wrangler.golden.jsonc \
  --file tests/e2e/seed-golden-context.sql
```

Then run the server with `GOLDEN_E2E_STATE_DIR=$STATE` (see §3). This is the path the
Golden E2E harness uses, and `tests/production-readiness-schema.test.mjs` proves a
chain-built database satisfies the readiness contract.

## 11. R1 authentication note (local access)

Local development authenticates with a real credential, not the bypass:

```bash
TOKEN=$(grep '^APP_R1_ACCESS_TOKEN=' .dev.vars | cut -d= -f2-)
curl -H "Authorization: Bearer $TOKEN" http://localhost:4183/api/projects
```

In a browser, load `http://localhost:4183` and enter the token in the **R1 access
credential** field; the server sets an HttpOnly session cookie that survives reload.
`APP_R1_DEV_AUTH_BYPASS=1` exists only for the hermetic Golden E2E harness; readiness
**fails** while it is enabled, so it can never be silently live in a real deployment.
