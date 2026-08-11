# Task 10 — Product Matching Engine

Status: Complete for the local Task 10 boundary. Task 11 has not started.

## Implementation checklist

- [x] Audit the current matching flow and identify hard-coded candidates, substring matching and coupled price approval.
- [x] Define versioned engine, ruleset, search and model identifiers.
- [x] Build controlled search scopes from Requirement Profiles.
- [x] Implement exact identity, structured family/category and semantic discovery stages.
- [x] Implement unit-aware attribute comparison.
- [x] Implement mandatory technical failure override.
- [x] Implement standards-evidence, manufacturer, compatibility, lifecycle and accessory gates.
- [x] Keep commercial availability as a non-authoritative signal.
- [x] Separate technical compliance from evaluation confidence.
- [x] Produce decomposable scoring, matching bases, explanations and structured no-match results.
- [x] Prevent the Task 10 engine from approving candidates.
- [x] Add initial deterministic regression tests.
- [x] Add immutable match-run, candidate, comparison, evidence, feedback and decision tables.
- [x] Add migration and persistent matching worker.
- [x] Add queue stages, idempotency and incremental recalculation fingerprints using the existing processing service.
- [x] Add authenticated, project-isolated matching APIs.
- [x] Connect matching to persistent Requirement Profiles and reviewed Product Library records.
- [x] Add match history, run comparison, alternatives comparison and reviewer feedback.
- [x] Replace the current hard-coded Technical Matching drawer with persistent results.
- [x] Remove product and price approval from technical matching.
- [x] Add real status, no-match, manual-candidate validation and source-based explanation surfaces.
- [x] Expand integration/regression coverage and run the full release gate.

## Current safety guarantees

- Semantic discovery cannot produce a recommended candidate.
- Mandatory failures override scores and price availability.
- Missing standards or compatibility evidence cannot produce high confidence.
- Discontinued products are blocked by deterministic lifecycle rules.
- Compliance and confidence are separate outputs.
- The engine always returns `approvalReady: false`; final approval controls belong to Task 11.
- An unready Requirement Profile returns a structured Not Ready result and no candidates.

## Implemented files

- `app/domain/product-matching-engine.mjs`
- `worker/product-matching-api.mjs`
- `db/schema.ts`
- `drizzle/0008_dark_korg.sql`
- `app/page.tsx`
- `tests/product-matching-engine.test.mjs`
- `tests/product-matching-api.test.mjs`

## Initial verification

The complete suite passes with 300 tests. Task 10 has 12 focused engine/API tests covering unit conversion, exact matching, mandatory exclusion, evidence gaps, unstructured mandatory fail-closed behavior, decomposable ranking, no-match handling, semantic discovery safety, authentication, persistence and UI separation. Nine migrations apply cleanly to a fresh database, producing 75 tables and 192 indexes. Build and lint pass.

## Architecture and implementation summary

The engine uses a controlled Requirement Profile to build a bounded search scope. Candidate generation proceeds through exact identity, structured family/category and semantic discovery stages. Semantic results are discovery-only. Deterministic checks evaluate attributes, units, standards evidence, manufacturer rules, compatibility, accessories and lifecycle. Mandatory failures override every score component and commercial signal.

Every recalculation receives an input fingerprint containing the BOQ state, Requirement Profile, reviewed Product Library state, price-availability metadata and matching ruleset. Unchanged runs are idempotent; changed inputs create a new immutable version and supersede the previous current run without deleting history.

Stored candidates retain decomposed scores, technical status, recommendation tier, separate confidence, matching bases, comparisons, lifecycle state, commercial availability, explanation and mandatory failures. Reviewer rejection and feedback are stored separately. Manual candidates are not inserted unchecked: they trigger the same matching evaluation and remain discovery-only when manually introduced outside the controlled search scope.

## Known Task 10 boundaries

- Commercial availability is a signal only; no cost, selling price, margin, VAT or quotation calculation occurs.
- `approvalReady` is always false. Approval safety and final engineering authorization belong to Task 11.
- Semantic discovery currently uses deterministic token discovery rather than an external vector service. Structured filters remain authoritative and the architecture records a search-version identifier for a future reviewed index.
- The local UI provides status, candidate ranking, confidence, matching basis, explanation and commercial signal. Detailed comparison, feedback and history operations are available through the persistent APIs; further presentation refinement can occur without changing the Task 10 domain model.
