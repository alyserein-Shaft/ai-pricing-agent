# Evidence Index

INDEX, not a log. Each record points to authoritative evidence; it never duplicates
raw logs, chain-of-thought, or full outputs. Main agent checks this file before
repeating a substantial test, oracle, audit, runtime check, Playwright validation,
benchmark, or investigation (workflow §21.3). Only the main continuity owner adds or
updates records; subagents READ only. Do not fabricate records: if the authoritative
evidence cannot be identified precisely, leave the item out.

Schema per record: Evidence ID | Scope | Type | Assertion/coverage | Result |
Last verified | Authoritative location | Invalidation trigger | Freshness
(VALID / STALE / SUPERSEDED / DISPUTED / UNKNOWN).

## Records

- EV-AUDIT-20260922-TM13 | Technical Matching (TM1–TM12 stack, Al Mousa Golden item `boqitem_5af0a8eb…`, incumbent `IDP-HEAT-ROR-IV`) | audit/validation | Closure rule: real Golden case must surface as Technical Review Required / Pending Evidence with `mandatoryFailures = 0`, never rejected-as-incompatible | **TM13_BLOCKED** — one concrete blocker (spec-optional isolator accessory enforced as blocking failure + TM12 priority resolution misses snake_case `requirement_id`); DATA_MUTATIONS: NONE; report-only session | 2026-09-22 | `TM13_TECHNICAL_MATCHING_SAFETY_CLOSURE_REPORT.md` (repo root; in-report DB evidence dated 2026-09-20/21) | Invalidated by changes to matching/accessory-evidence policy, TM12 aggregation, persisted Golden profile versions, or the 930-product D1 catalog | UNKNOWN — re-proof required after fix; do not treat as current engine behavior
- EV-AUDIT-20260929-SYSINV | Whole system (315 tables, ~180 domain modules, 435 test files per report) | audit/inventory | Inventory + pipeline blockers via read-only live-DB snapshot (463 MB, SHA-256 `2e432933…cec7`): 0/39 requirement profiles approved, 102/102 safety decisions blocked, 1/518 price_records Approved+Costing+current | **COMPLETED** — verdict: data-and-approval problem, not a code problem (quotation machinery complete and heavily tested; price/approval/identity evidence missing) | 2026-09-29 | `docs/SYSTEM_INVENTORY_AUDIT_2026-09-29.md` | Invalidated by DB writes, profile approvals, price ingestion, engine changes, or schema/dirty-tree changes since snapshot | UNKNOWN — live DB and dirty tree may have moved; inspect report before relying on counts
- EV-AUDIT-20260929-FULLSTACK | Whole system (317 tables, ~60 API route groups, 166 domain modules, 435 test files per report) | audit | READ-ONLY full-stack audit at `main` @ `029b426` + shared dirty tree; no runtime started, no live D1 read, no suites executed by auditor | **COMPLETED** — verdict: system cannot produce a technically reliable Fire Alarm quotation today (missing wired data + 3 production defects); labels: VERIFIED FROM CODE / TEST (assertion text read, not executed) / DATABASE (schema shape) / REPORTED (taken from `docs/*.md`, not re-verified) | 2026-09-29 | `docs/FULL-STACK-AUDIT-2026-09-29.md` | Invalidated by source changes, defect fixes, data wiring, or anything after HEAD `029b426` + that day's dirty tree | UNKNOWN — re-measure before citing verdicts as current
