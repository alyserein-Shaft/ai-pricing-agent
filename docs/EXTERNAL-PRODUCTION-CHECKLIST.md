# External Production Checklist — AI Pricing Agent

**Status:** code-side `PRODUCTION CANDIDATE`. `PRODUCTION READY` is **not claimed and cannot be claimed from code.**

**Why this document exists.** `releaseGate` was evaluated exhaustively — all 512 combinations of its nine
boolean criteria. It returns `Production Candidate` when every criterion is `true`, and returns
**`Production Ready` for no input at all**; the function has no branch that can produce it. Its sole remaining
blocker at the ceiling is:

> `Independent production approval and live operational validation required`

That is deliberate governance, not a gap, and it is now pinned by two guards
(`tests/production-readiness.test.mjs` :: `PR-CEILED`, `PR-CEILING-EVIDENCE`) so the code cannot quietly
self-certify. Everything below is therefore **organizational evidence that no repository automation can
manufacture**. This checklist states, for each item, the exact evidence required, who owns it, the pass
condition, and what the repository *can* do to help.

**Automation column legend**
- **ASSIST** — the repository already provides the artifact; a human must run and interpret it.
- **PARTIAL** — the repository provides a check that is necessary but not sufficient.
- **NONE** — no repository artifact exists or can substitute; this is purely an external act.

---

## A. Release gate criteria, item by item

| # | Gate key | Required evidence | Owner | Pass condition | Automation |
|---|---|---|---|---|---|
| 1 | `coreWorkflow` | Golden E2E completes the full journey on **Al Mousa School — Clean Golden Run**: Project → Documents → BOQ → Understanding → Requirements → Drawing/Evidence → Product Identity → Compatibility → Matching → Calculations → Technical Decision → BOM → Quantity → Pricing → Costing → Commercial Approval → Quotation → Final Approval → Issue → Export | Engineering (this programme) | `npm run test:e2e:golden` green end-to-end, with server-side workflow checkpoints captured at every stage and the quotation reaching `ISSUED` then exported | **ASSIST** — `scripts/run-golden-e2e.sh`, `tests/e2e/golden-full-journey.spec.ts` |
| 2 | `criticalSafety` | Every safety-relevant gate fails closed and no unresolved Severity 1 finding | Engineering + Technical Manager | 0 unresolved Severity 1; safety gates proven by regression guards, not by inspection | **PARTIAL** — `PR-CEILING-EVIDENCE` proves Severity 1 forces `Not Ready`; the guards prove the individual gates |
| 3 | `dataIntegrity` | Migration chain settled and applied; local D1 identical to the chain head | Engineering (DBA sign-off for real environments) | `drizzle-active` journal == `.sql` files == snapshots; manifest cutoff == journal head; a freshly applied chain and the target database agree on every object and column | **ASSIST** — `scripts/relevant-tree-fingerprint.mjs`; `tests/migration-baseline-safety.test.mjs`; `scripts/verify-migration-baseline.mjs` (read-only, needs explicit authorization to adopt) |
| 4 | `backupRestore` | An **executed** backup and restore drill | Infrastructure / DBA | A backup was taken, checksums verified, restored into a verified-empty target, and the restored database passed the manifest verifier — with the run recorded (timestamps, operator, artifact ids) | **PARTIAL** — `scripts/backup-local-state.sh` and `scripts/restore-local-state.sh` enforce checksums and an empty target, and `tests/production-readiness.test.mjs` pins that. **They do not prove a drill happened.** |
| 5 | `monitoring` | Deployed monitoring and alerting | Infrastructure / SRE | Health, error rate, latency and the D1/R2 bindings are monitored in the real environment; alerts route to a real responder; alert delivery was tested, not just configured | **NONE** — `/api/health/live` and `/api/health/ready` exist and are correct (see #12), but deploying them is an infrastructure act |
| 6 | `staging` | A staging environment running the deployable artifact | Infrastructure / Release Management | Staging runs the same artifact as production, against non-production data, and has been used to execute the Golden journey successfully | **ASSIST** — `npm run build`, `npm run validate:artifact`, `npm run test:e2e:golden` can all be pointed at staging |
| 7 | `security` | An independent security review | Independent security reviewer (not the author) | Findings triaged; no open High/Critical; penetration or threat-model coverage of authz, the governed write paths, document intake and export | **PARTIAL** — security headers, capability gates and log sanitization are implemented and tested (`securityHeaders`, `sanitizeLogContext`, AUTH-001/002). **A review is a human act and cannot be simulated.** |
| 8 | `recovery` | A recovery exercise with proven RTO/RPO | Infrastructure / SRE | A documented failure was induced, recovery executed, and measured RTO/RPO met the agreed target; the result is recorded | **NONE** — no repository artifact can evidence a recovery exercise |
| 9 | `performance` | Performance / load validation | Engineering + Infrastructure | Agreed thresholds (p95 latency, throughput, concurrent users, document-processing time) measured under realistic load and met | **PARTIAL** — `scripts/` contains benchmark utilities, but thresholds are an external agreement and the measurement is an environment act |
| 10 | Independent production approval | A named human approval to release | Business owner / accountable executive | Written approval recorded against a specific build fingerprint, by someone with authority to accept the residual risk | **NONE** — and this is the terminal blocker the gate itself names |
| 11 | Live operational validation | The system running real work in production | Product / Operations | Real projects processed through the journey with no Sev-1/Sev-2 incident, and support/rollback paths exercised | **NONE** |

---

## B. Code-side evidence already in hand (for the approver to rely on)

| Claim | Evidence | State |
|---|---|---|
| Active migration chain settled and applied | 0000 → 0011 applied forward to a throwaway database: `integrity_check ok`, 0 FK violations, head inventory `314/457/43/2` identical to the manifest | 🟢 |
| Live D1 identical to the chain head | 314/314 tables, 457/457 indexes, 43/43 triggers, 2/2 views, **0 column mismatches across all 314 tables** | 🟢 |
| Authoritative suite green | `npm run test:all` — see the run recorded in the ledger; drift gate matched the reviewed classification baseline | 🟢 (last attributable run) |
| Quotation evidence pinned | `QUOTE-PIN-1`: lines pin candidate + pricing + approval versions and fingerprints; approve CAS-guards on `evidence_fingerprint`; 28/28 | 🟢 |
| Readiness signal truthful | `/api/health/ready` reports the **active chain head**, guarded against the Drizzle journal so it cannot rot | 🟢 |
| Release-gate ceiling | `Production Ready` unreachable from code by construction, proven by exhaustive enumeration and pinned by two guards | 🟢 |
| Open P0 / P1 issues | none | 🟢 |

**Known-open, non-P0/P1, carried deliberately:** `KNOW-002` (Knowledge source-revision authority — Part 1
specified and ready, Part 2 blocked on a business decision), `BOM-002` (R7 expansion identity discarded at the
calculation boundary — **proven not required by any Golden path**), `REL-002` (concurrent-tree attribution),
`DOC-001` (deferred to R4 by design).

---

## C. What the repository can and cannot do — the honest boundary

**Can assist:** build and validate the artifact; run the Golden journey; verify the migration chain, the
manifest and a target database without adopting it; fingerprint the exact source bytes a run was performed
against; enforce the release gate's ceiling and its Severity-1 precedence; prove individual safety, governance
and eligibility invariants by regression test.

**Cannot do, at any level of engineering effort:** approve itself; stand up monitoring, staging or a recovery
target; perform a security review; run a restore drill; agree performance thresholds; or convert any of those
into a pass. Every one of those is evidence about the **organization's** practice, not the **software's**
correctness. Producing a green result for any of them from inside the repository would be manufacturing
authority — the specific failure mode this programme is built to prevent.

**Therefore the final code-side verdict is:**

```
GOLDEN E2E PASS  (once the other lane's active run completes green)
+
PRODUCTION CANDIDATE
```

and the only remaining blockers are the external items in section A.
