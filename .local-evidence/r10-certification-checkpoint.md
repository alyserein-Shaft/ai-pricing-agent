# R10 CERTIFICATION CHECKPOINT — VALID FOR PRE-LANDING SNAPSHOT

Status: **SUPERSEDED FOR CURRENT EXECUTION** by later concurrent-writer
production changes. **Not invalid.** This remains valid evidence for the exact
quiescent snapshot on which it was obtained.

Do not merge these test counts with the post-landing re-certification.

## Snapshot identity

- HEAD: `029b42637ac117f810e726b40c2e888c484c173b`
- 13-file critical digest at certification: `5598e5f5ee9b8cdc`
  (pre-run digest == post-run digest, so both runs observed identical bytes)
- Tree was proven quiescent immediately before both runs: the same 13 files were
  byte-identical across a 60s window, and the digest was unchanged from before
  Run A through after Run B.

## Results

| Gate | Result |
|---|---|
| Broad Run A | 4249 tests / 4232 pass / 3 fail / 14 skipped |
| Broad Run B | 4260 tests / 4242 pass / 4 fail / 14 skipped |
| `npm run test:knowledge` | 43/43 green |
| `npm test` | 517/517 green |
| `npm run build` | green, artifact validated |
| `npm run db:generate` | no drift |
| ESLint (slice-owned files) | 0 errors |

## Remaining failures at the checkpoint — all accounted for

- **3 × flag-dependent Knowledge suites** (`knowledge-library-link-factid`,
  `knowledge-product-repair-route`, `knowledge-product-resolver-runtime`).
  Verdict **D — environment/configuration**: they require
  `--experimental-test-module-mocks`, which cannot be supplied through
  `NODE_OPTIONS`. Fixed at the canonical supply point instead:
  `npm run test:knowledge` (added this session) and documented in `AGENTS.md`.
  Green 43/43.
- **1 × `knowledge-sources-register-contract.test.mjs`** — a brand-new
  untracked file created by the concurrent writer at 02:53, i.e. *between* Run A
  and Run B. Concurrent-writer-owned. Its failure
  (`table product_sources has no column named name`) is a stale hand-rolled
  fixture in that new file.

Zero slice-owned relevant failures at this checkpoint.

## What changed after this checkpoint

The concurrent writer resumed landing a large change set. Observed deltas:

- total broad test count **4260 → 4024** (−236)
- fresh broad run: **64 failures across 32 files** (was 3–4)
- `r7-panel-sizing-production` became deterministically red in isolation,
  7 pass / 13 fail, `no such column: c.review_status`
- traced cause: `worker/primary-selection-authority.mjs` modified at 02:54:11
  (after Run B) now selects `c.review_status`, which that suite's hand-written
  `:memory:` fixture does not declare
- similar clusters: `pricing-costing-expiry-policy` (13),
  `pricing-input-authority` (4), `primary-selection-authority` (4)

Per §3 of the course correction, the current tree is a **new delta**, not an R10
restart. The post-landing artifact requires its own certification.

## Evidence-handling defect disclosed

The first quiescence attempt in this session used a shell `shasum` pipeline that
failed silently and emitted the SHA256 of **empty input**
(`e3b0c44298fc1c14…`). That was briefly mis-read as a valid stable digest. It was
caught only because a later real digest (`5598e5f5…`) contradicted it.

Consequently quiescence evidence in this program now **fails closed** via
`.local-evidence/fingerprint.mjs` (verifies every file exists / is a regular
non-empty readable file, records per-file hashes, computes the aggregate only
after all individual hashes succeed, and rejects the empty-input digest), driven
by `.local-evidence/wait-quiescent.mjs` over the explicit set in
`.local-evidence/critical-files.txt`. The empty-list, missing-file,
directory-as-file and valid cases were each probed.
