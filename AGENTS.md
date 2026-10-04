# AGENTS.md

This repository is the AI Pricing Agent prototype: document intake, BOQ/specification extraction, engineering knowledge, product matching, pricing/costing, workflow review, and quotation.

## Environment

- Use Node.js `>=22.13.0`.
- This is an ESM project (`"type": "module"`).
- Prefer the locked dependency install for CI-like setup:
  - `npm run install:ci`
- Local development:
  - `npm run dev`
- Production-style local run:
  - `npm run start`

## Build, test, and validation

- Build and validate the deployable artifact:
  - `npm run build`
- Full default test suite:
  - `npm test`
- Useful focused suites:
  - `npm run test:phase2`
  - `npm run test:phase3`
  - `npm run test:phase5c`
  - `npm run test:phase6a`
  - `npm run test:identity`
  - `npm run test:due`
- Knowledge library authority suites (require `--experimental-test-module-mocks`):
  - `npm run test:knowledge`
- Golden evaluation gates:
  - `npm run test:fire-alarm-golden`
  - `npm run test:cctv-golden`
- End-to-end tests:
  - `npm run test:e2e`
  - `npm run test:e2e:golden`
  - `npm run test:e2e:golden:smoke`
  - `npm run test:e2e:golden:full`
- Lint:
  - `npm run lint`
- Validate an existing artifact:
  - `npm run validate:artifact`

Do not treat these scripts as interchangeable. Run the narrowest relevant suite first, then expand when behavior, contracts, or shared modules change.

## Repository map

- `app/`: web application, workspaces, domain logic, document parsers, libraries.
- `app/domain/`: deterministic extraction, matching, pricing, workflow, and safety engines.
- `worker/`: API handlers and runtime integrations.
- `db/`, `drizzle/`: Drizzle schema and migrations.
- `docs/`: system packs, gap matrices, architecture decisions.
- `scripts/`: evaluation gates, benchmarks, fixtures, maintenance utilities.
- `tests/`: Node tests, fixtures, golden cases, Playwright specs.
- `graphify-out/`: generated knowledge-graph artifacts; do not hand-edit generated outputs.
- Root `TASK_*.md`, audit reports, and delivery documents describe intended behavior and verification history. Treat them as context, not as executable truth.

## Database and migrations

- After changing Drizzle schema:
  - `npm run db:generate`
- Keep migrations reviewable and preserve existing production-like data semantics.
- Do not mutate historical fixtures or golden evidence unless the task explicitly requires it.

## Working rules for agents

- Inspect the workspace before changing behavior.
- Prefer editing existing modules over creating parallel implementations.
- Preserve governance invariants:
  - Deterministic extraction and matching behavior.
  - Approval, review, audit, provenance, and evidence trails.
  - Separation between detected evidence, approved evidence, pricing inputs, and quotation outputs.
- Do not invent API shapes, product identities, prices, quantities, compatibility claims, or workflow states.
- Verify fixes with the relevant tests. Report exact failures instead of describing them as pre-existing without evidence.
- Do not commit, push, deploy, stash, reset, revert, or clean unless explicitly requested.
- Keep generated files, local runtime directories, caches, screenshots, and temporary outputs out of unrelated changes.

## Final-state re-read (before reporting live state)

- A read taken at task start is a **planning snapshot**, never a reportable result. Another lane may change canonical authority while you work.
- Before a FINAL REPORT states live counts, readiness, current approvals, the current selected candidate, current blocker totals, or pricing/quotation state, **re-read the relevant canonical authority immediately before reporting**:
  - BOQ counts -> `currentBoqEvidenceCounts` / `diagnoseBoqEvidence` in `worker/current-evidence-scope.mjs`
  - technical eligibility -> the current technical authority for that item
  - pricing state -> `CURRENT_PRICING_PREDICATE` consumers in `worker/pricing-authority.mjs`
  - drawing state -> the governed drawing authority for that document version
- If that final read cannot be completed, report `CURRENTNESS_STATUS = UNPROVEN` and label the figures as a start-of-task snapshot. Never present a stale count as current.

## Lore authority boundary

- `.lore/` is **history, continuity, and an evidence index**. It is NOT live project authority.
- A lore fact may be reused to locate evidence or understand a prior decision.
- Before citing a **mutable live-state fact** (counts, status, current approval, current selected candidate, current document version, pricing run state, readiness), re-read the live authority.
- **LORE NEVER OVERRIDES CURRENT CANONICAL AUTHORITY.**
- Never delete or rewrite superseded lore history; superseding entries coexist and the newer entry wins.

## Project continuity (fresh sessions)

- For any non-trivial task, follow `.agents/skills/ai-pricing-agent-workflow/`.
- At session start, perform its once-per-session Lore bootstrap (workflow §21): read `.lore/SUMMARY.md`, query the relevant entries, inspect tree state, work only the smallest delta.
- Before repeating a substantial test, oracle, audit, runtime check, Playwright validation, benchmark, or investigation, check `.lore/EVIDENCE.md`; reuse VALID covering evidence instead of rerunning.
- **Lore write ownership:** bootstrap READS shared continuity; a task agent then writes ONLY its own shard under `.lore/runs/<run-id>/*.delta.md`. Never replace a shared `.lore` ledger from an in-memory snapshot. Merge only via `node scripts/lore-consolidate.mjs --run <run-id> [--apply]`, which re-reads, preserves foreign additions, fails closed on conflict, and verifies nothing disappeared. Full rule: workflow §21.4.1.
