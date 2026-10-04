# Post-Landing Delta — Preliminary Classification (READ-ONLY, provisional)

Basis: the captured broad run **Run C** (4260 → 4024 tests, 64 failures across
32 files), analysed against the canonical chain. This is **provisional** — the
concurrent writer was still landing. It must be re-reproduced on the FINAL
landed bytes before any test is modified. No tests were patched to produce it.

## Headline: the 64 failures are NOT 64 problems

**27 of 64 share a single schema cause.**

```
25 ×  Error: no such column: c.review_status
 2 ×  PANEL_SIZING_COMMAND_FAILED {"message":"no such column: c.review_status"}
```

**30 of the 32 failing files use hand-rolled `:memory:` schemas** rather than the
canonical fixture authority (`tests/fixtures/active-chain-fixture.mjs`).

### Class A — legitimate new production contract + stale fixture (27/64)

`product_match_candidates.review_status` **does exist in the canonical chain**
(verified against the applied chain: `id match_run_id product_id rank
search_stage score score_components technical_status recommendation_tier
confidence_state confidence_score matching_basis commercial_availability
explanation mandatory_failures lifecycle_result review_status manually_added
added_reason added_by created_at`).

Four production files now read it as an enforced consumption predicate:

- `worker/primary-selection-authority.mjs:53` — `c.review_status NOT IN ('Rejected','Auto-Rejected Technical')`
- `worker/pricing-runtime.mjs:76` — same conjunct, with the inline rationale
  *"GOV-AUTH-1: rejection is recorded as audit on the candidate row; it is
  ENFORCED here, at consumption … without this conjunct a rejected candidate
  with an approval (before or after the rejection) still prices."*
- `worker/estimator-readiness-api.mjs:14,27`
- `worker/ai-presales-agent-tools.mjs:144`

Verdict: **not a production regression.** `review_status` is a long-standing
canonical column; these predicates are new reads of an existing column. The
hand-rolled fixtures simply never declared it. Correct repair is to move those
suites onto `activeChainDatabase()` — explicitly *not* to weaken the predicate.

**Note on ownership:** the `GOV-AUTH-1` comment shows the concurrent writer is
landing the governance slice concurrently. Do not duplicate or pre-empt it.

### Not a regression either: `canonical_library_products`

`worker/pricing-runtime.mjs:76` joins `canonical_library_products`, which does
**not** exist as a table. It is `CREATE VIEW canonical_library_products` over
`library_products` (baseline line 6684; confirmed `type=view` in the applied
chain). The join is legitimate. A hand-rolled fixture that creates only
`library_products` and omits the view will fail — again Class A.

## Remaining ~37 failures — not yet classified

Assertion-level, one assertion message per cluster, requiring per-cluster
triage on final bytes:

- 9 × bare `Expected values to be strictly equal` — clusters
  `pricing-costing-expiry-policy` (13), `pricing-input-authority` (4),
  `primary-selection-authority` (4)
- 2 × `The validation function is expected to return "true". Received false`
- 1 × `only non-Source-Fact rows reach the knowledge channel, whatever their status`
- 1 × `expected to not match /Auto-Rejected Techni…`
- 3 × the flag-dependent Knowledge suites (verdict D, environmental — green 43/43
  via `npm run test:knowledge`)
- 1 × `knowledge-sources-register-contract.test.mjs` — new untracked
  concurrent-writer file, created 02:53 between Run A and Run B

These must be re-triaged as A–F on the landed bytes. No mechanical patching.

## Repair strategy for the landed delta

Per the course correction: repair **shared fixture authority** where failures
share one schema cause, and do not patch 64 tests individually. 30 of 32 failing
files being hand-rolled is itself the finding — the canonical-fixture migration
is the fix, and it is the same recipe already proven 12 times this session.
