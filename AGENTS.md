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

## Project continuity (fresh sessions)

- For any non-trivial task, follow `.agents/skills/ai-pricing-agent-workflow/`.
- At session start, perform its once-per-session Lore bootstrap (workflow §21): read `.lore/SUMMARY.md`, query the relevant entries, inspect tree state, work only the smallest delta.
- Before repeating a substantial test, oracle, audit, runtime check, Playwright validation, benchmark, or investigation, check `.lore/EVIDENCE.md`; reuse VALID covering evidence instead of rerunning.
