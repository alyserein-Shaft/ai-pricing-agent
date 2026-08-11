# Task 11 — Confidence and Safety Engine

Status: Complete. The deterministic core, durable evaluation service, protected decision APIs, durable project-role authorization, override decisions, history and matching UI are implemented.

## Implementation checklist

- [x] Audit the active confidence, matching and approval behavior.
- [x] Separate confidence, compliance and approval eligibility.
- [x] Implement base BOQ completeness rules.
- [x] Implement category-specific requirements for smoke detectors, CCTV cameras, UPS and access-control readers.
- [x] Implement weakest-critical-component confidence calculation.
- [x] Implement deterministic discovery-only and high-confidence caps.
- [x] Implement blocks for mandatory failures, standards, compatibility, conflicts, assumptions, provenance, product identity, prohibited manufacturers and lifecycle.
- [x] Implement warnings for lifecycle and commercial evidence conditions.
- [x] Define technical and price approval gates separately.
- [x] Define role and approval-level policies.
- [x] Define non-overridable critical block classes.
- [x] Implement manual override validation.
- [x] Implement manual-price safety validation for Task 12 consumption.
- [x] Add immutable safety decisions, blocks, warnings, approval requests, overrides and comparisons.
- [x] Generate and validate migration `0009_robust_zarek.sql`.
- [x] Implement the 15 mandatory safety regression scenarios plus weakest-component and separation tests.
- [x] Add persistent safety evaluation and recalculation service.
- [x] Add server-side technical/price approval endpoints with fresh version revalidation.
- [x] Add warning acknowledgment and controlled override-request endpoints.
- [x] Add safety history and decision-comparison APIs.
- [x] Connect the matching UI to server-computed confidence breakdown, blocks, warnings and approval eligibility.
- [x] Add technical approval and warning-acknowledgment UI; price approval remains a separate Task 12 control.
- [x] Replace the temporary request-header role fallback with durable project membership.
- [x] Add the controlled override decision endpoint.
- [x] Run the complete regression and build release gate.

## Implemented safety model

The overall confidence is capped by the weakest critical component. A high average cannot conceal weak standards, compatibility, provenance or extraction evidence. Compliance remains the matching engine's technical result. Approval eligibility is computed separately using completeness, evidence, user role, conflicts, assumptions, lifecycle and current approval state.

Non-overridable conditions currently include missing project ownership, unauthenticated access, corrupted source, invalid quantity, product identity contradiction, known incompatibility and prohibited manufacturer. Other exceptions require a scoped, expiring, evidence-backed request at the correct approval level.

Manual price validation requires product and candidate identity, positive price, currency, source, validity, reason, project scope, authorized role, an existing technical approval and an audit record. It does not calculate or approve final pricing.

## Verification

- 16 focused safety-engine tests and 3 API/UI integration tests pass.
- The complete local suite passes: 319 tests, zero failures.
- The verified Sites production build passes.
- All ten migrations apply cleanly to a fresh database.
- Current schema: 81 tables and 209 indexes.

## Key files

- `app/domain/confidence-safety-engine.mjs`
- `worker/confidence-safety-api.mjs`
- `worker/index.ts`
- `app/page.tsx`
- `tests/confidence-safety-engine.test.mjs`
- `tests/confidence-safety-api.test.mjs`
- `db/schema.ts`
- `drizzle/0009_robust_zarek.sql`

## Known limitations

Safety decisions are persisted and versioned; the UI displays their real blocks, warnings, confidence and eligibility. Approval controls derive roles from durable project membership, warning acknowledgment requires a reason, and override decisions are role-controlled. Task 12 consumes these decisions without changing the Task 11 evidence model.
