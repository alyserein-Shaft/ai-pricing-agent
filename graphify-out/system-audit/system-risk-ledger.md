# System Risk Ledger

## Baseline

| Field | Value |
|---|---|
| Baseline ID | `AUDIT-2026-09-27-HEAD-029b426` |
| Branch / HEAD | `main` / `029b426` |
| Migration head | `0007_project_calendar_evidence_repair` (journal idx 0–7 contiguous, manifest agrees) |
| Graphify | 10,243 nodes / 21,169 edges / 542 communities, built 2026-09-27T03:57:41+03:00, 1,035 files |
| Dirty tree at baseline | 709 files (198 modified, 510 untracked) |
| Schema | `graphify-out/system-audit/system-risk-ledger.json`, schema_version 1.0 |

**Graphify blind spots in force for this audit.** SQL is not indexed (`tree_sitter_sql` not installed — 98 `.sql` files contributed nothing), so `drizzle-active/` was read directly. CSS is not indexed. Community names are hub-derived placeholders, not curated labels. String literals do not resolve as symbols.

**Mode note.** Subagent spawning was unavailable for this run: five parallel lane dispatches and two single dispatches all returned rate-limit or abort errors. The audit below was therefore executed inline in a single session, which materially limited coverage. See *Coverage* below.

## Coverage

| | |
|---|---|
| Lanes completed | C (partial), K, L (partial), M (partial), N (partial), O (partial) |
| Lanes not run | A, B, D, E, F, G, H, I, J |
| Domains with **no findings because they were not investigated** | BOQ, Understanding, Requirements, Drawings, Matching, Calculations, Technical Decision, BOM, Pricing, Costing, Quotation, Export |
| Spec H items deliberately **not** seeded | local D1 canonical drift, BOQ merged/rejected eligibility leakage, stale raw quantity fallback, Source Fact stale-source promotion, closed quotation/export live-data authority defects — none were re-proven against current source, and the spec forbids seeding from memory |

Absence of findings in an unaudited domain is not a clean bill of health.

## Domain Scoreboard

| Domain | P0 | P1 | P2 | P3 | Notes |
|---|---|---|---|---|---|
| Authorization | 0 | **2** | 0 | 0 | Both authority paths non-binding in the deployed configuration |
| Matching | 0 | **1** | 0 | 0 | Compatibility store is write-once, auto-Approved, uncorrectable |
| BOM | 0 | **1** | 0 | 0 | R7 expansion requirement has no BOM consumer |
| Calculations | 0 | 0 | **1** | 0 | Weaker currency than the declared authority (MEDIUM confidence) |
| Knowledge | 0 | 0 | **2** | 0 | 2 open + 1 resolved guard |
| Product Library | 0 | 0 | **1** | 0 | Promotion eligibility degenerate |
| Documents | 0 | 0 | **1** | 0 | DEFERRED to R4; two answers exist by design and are test-enforced |
| BOQ | 0 | 0 | 0 | 0 | Verified invariant - 1 resolved guard |
| Drawings | 0 | 0 | 0 | 0 | Verified invariant - 1 resolved guard |
| Pricing / Costing | 0 | 0 | 0 | 0 | Verified invariant - 1 resolved guard; supplier approve path audited |
| Quotation | 0 | 0 | 0 | 0 | Snapshot immutability documented; 1 open verification task |
| Understanding / Requirements | 0 | 0 | 0 | 0 | Eligibility centralised on BOQ-001; approval route governed |
| Technical Decision | 0 | 0 | 0 | 0 | Consumes the same approval predicates; no independent finding |
| Export | 0 | 0 | 0 | 0 | No independent finding this pass |
| Database | 0 | 0 | 0 | **1** | Documentation-authority hazard only |
| Reliability | 0 | 0 | **1** | **1** | 1 monitor, 1 dead-artifact |
| Tests | - | - | - | - | Suites act as architecture guards; see DOC-001, ENG-001 |
| Runtime | - | - | - | - | App verified running on :4183; no runtime-only finding |
| UI semantics | 0 | 0 | 0 | 0 | No independent finding this pass |

---

## Open P0/P1

### AUTH-001 — Library capability gate can never deny

- **Severity** P1 · **Status** OPEN · **Domain** Authorization · **Class** `CAPABILITY_BYPASS`
- **Why it matters.** Governed decisions are non-binding. The code declares a four-rank capability model and gates nine Knowledge routes on it, but the gate cannot return a denial, so the governance layer is decorative. It fails **open**.
- **Production path**
  1. `authenticateLibraryActor` (`worker/library-auth.mjs:24`)
  2. `resolveApplicationContext` → hardcodes `fullAccess: true` (`worker/application-context.mjs:56`)
  3. `applicationActor` → hardcodes `fullAccess: true`, role `Administrator` (`worker/application-context.mjs:62-69`)
  4. `requireLibraryCapability` → `actor?.fullAccess || hasLibraryCapability(...)` → always `null` (`worker/library-auth.mjs:30`)
  5. route executes with no denial
- **Current evidence.** `worker/library-auth.mjs:30`; `worker/application-context.mjs:56,62,69`. Additionally `GET /api/knowledge/files` (L425), `/search` (L595) and `/summary` (L967) call **no** capability check at all, unlike the review/link/repair routes.
- **Tests.** Covered only by four suites that *inject* a restricted actor (`knowledge-library-link-factid` GET-6, `knowledge-product-resolver-runtime`, `knowledge-product-repair-route`, `knowledge-deterministic-promotion`). No test drives the real context path and asserts a denial.
- **Blocking stage** PRE_PRODUCTION, HARDENING
- **Next action.** Remove the unconditional short-circuit so `hasLibraryCapability` is evaluated on its own merits, treating `fullAccess` as an explicit Administrator grant only. Separately decide whether files/search/summary should require `read`. Do not touch the role vocabulary.

### AUTH-002 — `project_members` has no production writer

- **Severity** P1 · **Status** OPEN · **Domain** Authorization · **Class** `UNREACHABLE_CAPABILITY`
- **Why it matters.** Nine production authorization readers gate access on project membership, but nothing in production can create that membership. Only tests can. Every role except owner and application admin is therefore unassignable at runtime, and the presales workflow assigns two governed steps to one of those roles.
- **Production path**
  1. presales step `quotation` requires role `Commercial Approver` (`app/domain/presales-workflow-engine.mjs:48-49`)
  2. `resolveProjectAuthority` LEFT JOINs `project_members` (`worker/project-authority.mjs:37-58`)
  3. `member_role` is always NULL — no production writer exists
  4. falls through to owner `Project Manager` or application admin `Administrator`
  5. `Commercial Approver` is never returned → the governed step has no satisfiable actor
- **Current evidence.** 11 `project_members` INSERT/UPDATE statements, **all inside `tests/`**, across 11 files. Zero in `worker/`, `app/`, `db/`, `drizzle-active/`. Production readers: `library-scope.mjs:34`, `confidence-safety-api.mjs:14,116`, `dashboard-api.mjs:54,103`, `pricing-api.mjs:53`, `boq-line-bom-api.mjs:39,139`, `boq-line-cost-api.mjs:378`, `presales-workflow-api.mjs:15`.
- **Blocking stage** PRE_PRODUCTION, HARDENING
- **Next action.** Add one production writer for `project_members` (an authorized membership route, or an owner-driven add/remove) so the nine existing readers have a legitimate source. Do not widen a reader and do not weaken `resolveProjectAuthority`, which is already correct and well documented.

---

## Open P2/P3

### PROD-001 — Promotion admits only `Protocol` facts

- **P2** · OPEN · Product Library · `MISSING_DOMAIN_STATE`
- **Why it matters.** `permittedUse` is derived from real promotions, and the policy rejects every `fact_type` other than `Protocol` (`app/domain/knowledge-promotion-policy.mjs:57`). The extractor produces Part Number, Price, Manufacturer and Standard facts. So the `Reusable Knowledge` state is unreachable from any realistic ingestion path, and no knowledge-sourced product identity or price can ever become a governed input.
- **Blocking stage** PRE_COSTING, HARDENING
- **Next action.** Decide explicitly whether Part Number and Price are *intended* to be eligible. If yes, add a governed per-type rule; if no, document Discovery Only as terminal so `Reusable` is not implied reachable. Audit before changing. Confidence MEDIUM — the policy is proven, the intent is not.

### KNOW-002 — Source Revision Authority

- **P2** · OPEN · Knowledge · `REVISION_AUTHORITY_GAP`
- **Why it matters.** Re-uploading a corrected source creates a second independent `knowledge_files` row. There is no source family, revision chain, supersession or current-source authority, so both versions contribute observations simultaneously and inflate the part-number, price, source-support and review-debt figures the register presents as current. Fails toward inflation, not corruption.
- **Evidence.** No family/revision/supersession column in the active baseline (read directly — Graphify cannot parse SQL). Register aggregates group by `knowledge_file_id` only.
- **Blocking stage** HARDENING, FUTURE
- **Next action.** Pre-production data-authority gap. A separate audit should choose between reusing document-family concepts and a Knowledge-specific source-family model. Do **not** assume DOC-R3 document-revision semantics transfer: `knowledge_files` is org-scoped with no `project_id` and no `document_id`. Build nothing in this slice.

### DB-001 — `db/schema.ts` is not schema authority

- **P3** · OPEN · Database · `MIGRATION_AUTHORITY_GAP`
- **Why it matters.** `db/schema.ts` declares 152 `index()` constructs; the active baseline declares 442 `CREATE INDEX`. It barely represents the knowledge tables. A reader treating it as authority will wrongly conclude indexes and constraints do not exist. Documentation hazard, not a runtime defect.
- **Blocking stage** HARDENING
- **Next action.** Document in `AGENTS.md` that `drizzle-active/` SQL is authoritative and `db/schema.ts` is partial. Do not auto-reconcile.

### REL-001 — Seven dead sibling module copies

- **P3** · OPEN · Reliability · `DEAD_PRODUCTION_PATH`
- **Why it matters.** Five copies of `worker/knowledge-library-api.mjs` plus one of `worker/document-api.mjs` sit beside the live modules as `.bak/.bak2/.backup2/.backup3/.backup4/.fixed`. None is imported, but Graphify indexes them as ordinary source (the extractor listed `document-api.mjs.bak` among unclassified files), so architecture queries can surface a stale copy as live. The real hazard is a future edit landing in the wrong file.
- **Blocking stage** HARDENING
- **Next action.** Delete them or move them outside the source tree. Not done here — this audit is read-only.

---

## Blocked External

None recorded. No finding in this pass required engineer, AHJ or external evidence to settle.

## Monitoring

### REL-002 — Broad suite varies with concurrent tree mutation

- **P2** · MONITOR · Reliability · `RELIABILITY_FLAKE` · confidence **LOW**
- **Observed.** During this session the broad suite was seen at 513/517 while another agent was mid-edit to `worker/pricing-runtime.mjs` and its hand-built fixture, and at 517/517 both before and after that edit settled. Current run: **517/517**.
- **Why it is only a monitor.** That correlation is consistent with nondeterminism from a moving tree, but it is **not proof**. A pre-existing, independently unexplained flake in `tests/pricing-input-authority.test.mjs` was never root-caused. The fixture builds `product_match_runs` without `requirement_profile_version_id` while the worker selects it, so the failure surfaces as a thrown `no such column` inside an assertion rather than a clean assertion mismatch.
- **Blocking stage** PRE_GOLDEN, HARDENING
- **Next action.** Establish R10 certification against a recorded repository fingerprint so both broad runs are attributable to identical bytes. If a failure still appears on fixed bytes, treat it as a genuine flake and root-cause it instead of retrying.

## Resolved Regression Guards

### KNOW-001 — Undefined sanitizer masked by a test global

- **P2** · **RESOLVED** · `current: false` · Knowledge · `TEST_MASKS_PRODUCTION_BUG`
- **What it was.** `POST /api/knowledge/link/fact/:id` called a bare `clean(...)` never declared or imported in the module, so the real Worker threw `ReferenceError: clean is not defined` on every request. The suite installed `globalThis.clean` with behaviour *identical* to the module's own `cleanText` — the mask supplied the right behaviour from the wrong source, which is precisely why the defect stayed invisible.
- **Revalidated against current source.** `worker/knowledge-library-api.mjs` uses `cleanText` at L822, L823, L824, L922, L923; the only other mention of `clean` is the explanatory comment at L46. Zero `globalThis.clean = ` assignments remain under `tests/` — **two** masks were removed, not one; the second (`knowledge-product-repair-route`) was a process-wide global that would have re-masked the defect for every test sharing the process.
- **Regression guard.**
  - *Invariant:* `POST /api/knowledge/link/fact/:id` must execute with no injected `globalThis.clean` and must use the module-owned sanitizer.
  - *Verification:* no `globalThis.clean` assignment exists in tests; production references `cleanText`, not undeclared `clean`; the fact-link success-path test executes the real module.
  - *Tests:* `knowledge-library-link-factid` (11/11), `knowledge-product-repair-route` (18/18).
  - *Bites:* reintroducing `clean(body.reason)` with no mask drops the suite to 8/11 with three `ReferenceError` failures. Verified during the hotfix.
- **Next action.** Re-verify this guard on every future audit. If the invariant breaks, set `status: REGRESSED` and `current: true` — do **not** mint a new ID.

## Regressed

None. Every previously resolved issue in this ledger was re-verified against current source and still holds.

## Recently Resolved

| ID | Title | Resolved | Guard verified |
|---|---|---|---|
| KNOW-001 | Undefined sanitizer masked by test global in fact-link route | This session, prior slice | Yes — invariant holds at the current baseline |

## Deferred

None explicitly deferred. PROD-001 and KNOW-002 are OPEN with a recorded blocking stage rather than a scheduling decision.

---

## Findings explicitly *not* recorded

Per spec H ("do not seed from memory alone"), these were **not** added because they were not re-proven against current source in this pass:

- local D1 canonical drift (environment guard, not an open application defect)
- BOQ merged/rejected eligibility leakage
- stale raw quantity fallback
- Source Fact stale-source promotion
- closed quotation/export live-data authority defects

Each needs a revalidation pass before it can be seeded as a `RESOLVED` guard or re-opened as `OPEN`. Seeding them unverified would put unproven claims into a permanent ledger, which is the specific failure mode this ledger exists to prevent.


---

# Second Pass — Remaining Domains

## P1 (new)

### MATCH-001 — Compatibility store is write-once and auto-Approved

- **P1** · OPEN · Matching · `UNREACHABLE_CAPABILITY`
- **Why it matters.** `worker/compatibility-auto-confirm.mjs` is the *only* writer of `engineering_relationships` and INSERTs with `status: "Approved"` (annotated `// Auto-confirmed status`) and `confidence: params.confidence || 90` — an **unsupplied confidence defaults to 90** and still yields Approved, library-level (`project_id` NULL, scope Global) authority. There is **no UPDATE** against the table anywhere, and although `status`, `effective_to`, `reviewed_by` and `reviewed_at` exist, nothing ever writes a rejection, withdrawal or expiry.
- **Production path.** auto-confirm → INSERT(90, 'Approved') → `product-matching-api.mjs:120` and `technical-requirement-api.mjs:111` read `status='Approved'` → compatibility asserted to engineers with no gate and no correction path short of a direct DB edit.
- **Blocking stage** PRE_GOLDEN, PRE_QUOTATION, PRE_PRODUCTION
- **Next action.** Add a governed reject/withdraw route (status + `effective_to`, reason, actor, audit row) mirroring the supplier-quote review pattern already in the codebase. Separately decide whether confidence may default into an Approved write.

### BOM-001 — R7 expansion requirement is computed but never reaches the BOM

- **P1** · OPEN · BOM · `CALCULATED_BUT_UNUSED`
- **Why it matters.** The SLC capacity calculator derives `requiredExpansionQuantity` / `selectedExpansionType` / `mountingUnit` (`fire-alarm-slc-capacity-calculator.mjs:140-163`), `fire-alarm-panel-slc-sizing.mjs:42` aggregates it, and `calculation-requirement-engine.mjs:160` emits it as a governed output. The **only** consumer is `engineering-dossier-engine.mjs:358`, which records it as a WARNING-severity violation. `worker/boq-line-bom-api.mjs` contains **zero** references to expansion; its quantity authority is `currentSelectedQuantity`. So capacity-required expansion hardware never becomes a BOM line and never reaches costing.
- **Blocking stage** PRE_COSTING, PRE_GOLDEN
- **Next action.** Audit, then bridge — reusing `quantity-source-decision-api` rather than adding a second quantity authority.

## P2 (new)

### ENG-001 — Engineering-fact currency is weaker than the declared authority

- **P2** · OPEN · Calculations · `CURRENTNESS_DIVERGENCE` · confidence **MEDIUM**
- **Why it matters.** `worker/engineering-fact-freshness.mjs:38-42` accepts an extraction as current on `superseded_at IS NULL`, and does **not** import `worker/current-evidence-scope.mjs` — whose own comment calls itself "the single operational authority boundary for BOQ evidence" and forbids recreating a weaker definition of "current". 32 other modules do import it.
- **Honest limit.** I read the provenance-currency block and the import list, not the entire 22 KB module. A stronger guard elsewhere would make this a FALSE_POSITIVE. I deliberately did **not** inflate it to P1 for that reason.
- **Next action.** Read the whole module first. If no stronger guard exists, route the currency through the canonical predicate with the project calendar.

### DOC-001 — Two document-currency answers, deliberately (DEFERRED to R4)

- **P2** · **DEFERRED** · Documents · `SOURCE_OF_TRUTH_CONFLICT`
- **Correction to my first instinct.** I initially read this as a P1 "two sources of truth" conflict. Checking the tests disproved that: `tests/current-version-id-authority.test.mjs` **forbids** head-anchored BOQ/specification evidence selection by source-text assertion, **pins** the R4-owned drawing joins so they cannot silently change, and asserts the head pointer is written where defined. The two answers are a governed design with a tracked deferred subset — 21 modules read the head, 14 without the canonical module, and the drawing subset is the sanctioned R4 remainder.
- **Blocking stage** PRE_DOC_R4, FUTURE
- **Next action.** No change now. When R4 lands, route the pinned drawing joins through `documentVersionGoverningPredicate` and update that test deliberately — do not widen its forbidden pattern, or the R4 allowlist silently becomes a blanket exemption.

## Verified invariants seeded as regression guards

| ID | Invariant | Pinning tests |
|---|---|---|
| **BOQ-001** | Merged/Rejected BOQ rows never satisfy downstream eligibility; Understanding and engineering consumers share one predicate | `current-evidence-scope`, `boq-approval-readiness`, `ai-understanding-eligibility`, + 20 more |
| **PRICE-001** | Non-SAR project currency or non-SAR/USD source currency raises `UNSUPPORTED_CURRENCY`; USD converts at a fixed 3.75 | `r6-fixed-usd-sar-normalization`, `cost-buildup-model`, `pricing-costing-expiry-policy` |
| **DRAW-001** | Approved-occurrence count is `approved_occurrences` and is never promoted to device quantity | `drawing-printed-quantity-contract`, `quantity-source-decision-api` |

**PRICE-001 additionally verified on the write path.** `supplier-price-intake-api.mjs` writes `price_records` with literal `'Approved'`/`'Costing'`, which looked like a governance bypass. It is not: that code is the `POST .../approve` branch, gated by `supplierPriceEligibility` (422 `PRICE_EVIDENCE_INCOMPLETE`), a required reason, an `APPROVE_FOR_COSTING` audit event with previous/new values, a CAS on `promoted_price_record_id IS NULL`, and supersession of the prior quote. Recorded as a checked-and-cleared suspicion rather than a finding.

## Quotation — open verification task, not a finding

`worker/quotation-line-authority.mjs` documents append-only snapshot immutability and treats the persisted fingerprint as the authority for what was decided, explicitly declining to recompute it. But `worker/quotation-evidence.mjs:44` reads the **current** non-superseded `product_match_runs` row. Whether a quotation revision pins its match run — the critical invariant that an approved quotation must not silently change when a live upstream table moves — is **not yet settled**. I am not recording this as a defect; it needs one more focused pass.

## Authorization — deepening (AUTH-001 / AUTH-002 revalidated, not re-raised)

| Question | Answer |
|---|---|
| Application actor | Hardcoded `fullAccess: true`, role `Administrator` (`application-context.mjs:56,62,69`) |
| Capability DECLARED? | Yes — 4 ranks, 6 capabilities |
| Capability ASSIGNABLE? | Nominally, via `project_members` |
| Capability SERVER-ENFORCED? | **No** — short-circuits to `null`; 3 Knowledge routes call it not at all |
| Membership AUDITED? | No writer exists, so nothing to audit |

`worker/project-authority.mjs` is the *better* path and is correctly built — its comment documents a previously-fixed duplicated-role-vocabulary bug held together by `tests/review-role-authority-coherence.test.mjs`. The defect is the missing writer, not the authority logic. AUTH-002 blocking stage retained at PRE_PRODUCTION/HARDENING: `Commercial Approver` is required by `presales-workflow-engine.mjs:48-49`, but the Golden quotation/issue path was not shown to require that role specifically, so escalating it to PRE_QUOTATION would be an unproven claim.

---

# Recovery Session — 2026-09-27T14:35Z (additive; nothing above is retracted)

Recovered a terminated session against **repository truth**, not chat history. HEAD `029b426` on `main`,
721 porcelain entries, runtime `localhost:4183` healthy (PID 16896, not restarted).

**Interruption point.** PRE-GOLDEN had already passed (13:37Z) and the previous session was mid **Golden
E2E**, chasing a real defect: the Overview workspace had no `<h1>` in the accessibility tree, breaking
the tracked contract `getByRole("heading", { level: 1 })`.

**Concurrent writer — not touched.** A live writer was active throughout: `app/globals.css` at 17:18:29,
`tests/e2e/zz-golden-debug.spec.ts` at 17:29:18, and a Golden E2E run in flight. That lane is the
concurrent agent's and was deliberately left alone, unreviewed and uncertified here.

## Found on recovery: three authority gates red against a CORRECT repository

A concurrent writer had correctly advanced the active chain `0007 → 0011` and regenerated
`manifest.json`, the journal and the snapshots. The gates that *consume* the chain were never advanced
with it, so the repo reported red against correct code.

| Gate | Was | Root cause |
|---|---|---|
| `tests/migration-baseline-safety.test.mjs` | 6/9 | chain head pinned as a literal (`0007`, 8 journal tags, 456 indexes) |
| `tests/onboarding-f-governed-scope-editing.test.mjs` | 41/42 | slice pin ended at `0010` — the failure the R11 report deferred |
| `npm run test:all` (REL-003 drift) | **exit 2, suite never ran** | a test added at 16:40 was never re-reviewed into the baseline |

**Proof the chain was right, not the gates:** applied the real journal-ordered `drizzle-active` chain
`0000 → 0011` forward to a throwaway temp SQLite database — `integrity_check ok`, `foreign_key_check`
0 violations, inventory `314/456/43/2` at the `0007` head and `314/457/43/2` at the `0011` head, exactly
matching the manifest. That is what made repairing the gates (not the manifest counts) the safe move.

### DB-003 — resolved
The head is now **derived from the journal**, never restated, so the gate cannot go stale on its own and
a migration landing without advancing the manifest still fails. The literal `0008 must be absent` guard is
replaced by journal↔disk parity in both directions; journal order (`idx` contiguity, adopted baseline as
prefix, one snapshot per entry) is pinned; the adopted baseline chain is pinned positively. The Onboarding F
pin is advanced and explicitly relabelled a *frozen slice pin*, pointing at the self-maintaining gate.

### DB-004 — resolved
`manifest.json` attributed `consolidated_profile_requirements` to legacy `0083` and `price_records` +
`price_records_source_intake_row_idx` to legacy `0084` — **above** the 0082 adoption cutoff, in a chain
the runbook forbids replaying, for objects the *active* `0002`/`0001` actually own. Repointed, with a
guard that fails the build if any object ever cites a legacy migration above the cutoff again. Provenance
only: no database was adopted, replayed or reset.

### REL-004 — resolved (silent coverage loss)
`tests/uir-golden-ui-state-reconciliation.test.mjs` (UIR-1..UIR-6, the Golden UI-state reconciliation) was
**excluded from every authoritative run** because its header comment named the Golden project and one
fixture literal carried the project name. The file opens no live D1 and reads no Golden row — it builds
its database from the real active chain in a throwaway temp file. Six UI-state reconciliations were
outside the release gate while the suite reported green: precisely the failure REL-003 exists to prevent.
Repaired per the established J7 precedent — reword the comment-only mention, keep the invariant, never
weaken the detector. The file is now **SAFE** (safe 367→368, REAL_STATE 32→31), 20/20, and carries its own
`REL-003 GUARD` test. The drift baseline was re-recorded (402 files) only after that re-review.

## Verification

| Check | Result |
|---|---|
| `tests/migration-baseline-safety.test.mjs` | 9/9 (was 6/9) |
| `tests/onboarding-f-governed-scope-editing.test.mjs` | 42/42 (was 41/42) |
| `tests/migration-chain-verification.test.mjs` + `database-authority` | 6/6 |
| `tests/uir-golden-ui-state-reconciliation.test.mjs` | 20/20 |
| REL-003 drift gate | matches baseline, 402 files |
| **`npm run test:all` (authoritative)** | **3839 tests, 3825 pass, 0 fail, 14 skipped, exit 0** |
| Runtime `localhost:4183` | `/api/auth/session` 200; `/api/knowledge/summary` 200 → `organization_bd_shaft_internal_pilot`, 29 files, 1855 products, 1503 prices, 31 needs review |

⚠️ **Attribution caveat, stated rather than hidden.** A concurrent writer was editing the tree *during* the
authoritative run (`worker/product-matching-api.mjs` 17:25:50, `tests/e2e/zz-golden-debug.spec.ts` 17:29:18),
so the 0-fail result is only weakly attributable to fixed bytes. This is **REL-002's exact open question and
it is NOT closed by this run.** REL-002 stays `MONITOR`. Do not upgrade this run to a fixed-bytes certification.

## Ledger state after this session

17 → 20 issues, history preserved (additive write, `scripts/ledger-reconcile-recovery.mjs`, refuses to
overwrite an existing id).

| Status | Count | Issues |
|---|---|---|
| RESOLVED | 16 | AUTH-001, AUTH-002, KNOW-001, PROD-001, DB-001, DB-004, REL-001, MATCH-001, BOM-001, BOQ-001, PRICE-001, DRAW-001, REL-003, REL-004, DB-002, DB-003 |
| OPEN | 1 | **KNOW-002** (P2, real, bounded, latent) |
| MONITOR | 1 | REL-002 (now with a concrete, reproducible procedure for the next attempt) |
| DEFERRED | 1 | DOC-001 → R4 by design |
| FALSE_POSITIVE | 1 | ENG-001 (disproved) |

**PRE-GOLDEN: still PASS**, re-verified at the `0011` head — but its earlier PASS was recorded at the
`0010` head, and the intervening chain advance is exactly what went unnoticed. The gate is now structurally
unable to repeat that.

---

# Continuation — same session, after the first three repairs

## KNOW-002 — revalidated against live data, still LATENT, still OPEN

Re-read the live local D1 **read-only** (`file:...?mode=ro`), because the original finding was recorded from
source only and the programme requires current-truth revalidation before acting:

- `knowledge_files` = 29 rows, all `organization_bd_shaft_internal_pilot`;
- **zero** rows share a `file_name` with different bytes — the exact signature of a corrected re-upload, and
  the reproduction step from the original finding. It does not occur;
- zero `sha256` duplicates, zero case/whitespace-insensitive name collisions;
- `PRAGMA table_info` confirms still **19 columns, no family / revision / supersession / current-source column**.

**Verdict: LATENT CONFIRMED, NOT REOPENED.** Real architectural gap, no wrong numbers in any live data, no
failing regression guard.

### Part 1 deliberately NOT built — with reasoning, not by omission

Part 1 is **provably inert**: no writer anywhere can set the successor column, because the assertion path is
Part 2 and is undecided, so a `currentKnowledgeSources` predicate threaded through the register and the five
identity/promotion consumers would return byte-identical results for all 29 live rows. Its whole value is
forward-looking; its cost is claiming migration `0012` against a concurrent writer with a demonstrated
20–50 minute migration cadence, plus editing five live resolution modules. Shipping it would risk re-creating
the unsettled-chain class (DB-002) repaired earlier in this same session, and would present unfalsifiable
plumbing as a governed capability.

**So it is fully specified and ready to execute** (exact DDL, the authority module and its six consumers, the
four manifest/snapshot side-effects, five required tests, and the honest limit that a linear chain cannot
represent two independent corrections and must fail closed) — recorded in
`residual_dependencies["BOM-001_residual"]`-style detail under `KNOW-002.revalidation.part_1_decision`.

### Part 2 remains a business decision, not an engineering one

**Who declares that a newly uploaded source is a CORRECTION of an existing one, and what happens when the
replacement is itself wrong?** Nothing in code, schema, docs or tests answers it. Three options are laid out
for the decider (upload-time nomination / reviewer assertion / both with ratification). DOC-R3 cannot be
cloned: `knowledge_files` is organization-scoped with no `project_id`, no `document_id` and no FKs at all.

## BOM-001 residual — EVALUATED, outcome (A): its premise was too pessimistic

The ledger recorded this as "NOT YET EVALUATED — deliberately not assumed either way". Traced properly:

| Step | Finding |
|---|---|
| R7 calculation | `requiredExpansionQuantity` is a COUNT; `selectedExpansionType` is a part number. The comment at `quotation-line-authority.mjs:70-71` ("R7 returns a part number, never a product_id") is accurate **about the output** — and is where the residual's premise came from. |
| The part number's real origin | It is **not** configured or hardcoded. `loadExpansionPath` (`worker/fire-alarm-panel-sizing-api.mjs:291-325`) walks `product_accessories JOIN library_products` filtered to `relationship_type='Expansion Module'` + `review_status='Approved'` + `superseded_at IS NULL` + `deleted_at IS NULL`, product `identity_status='Active'`, and requires **exactly one** per hop or fails `AMBIGUOUS_EXPANSION_RELATIONSHIP`. |
| Identity in hand | `loopExpansionUnit` and `mountingUnit` each carry a canonical `productId` **and** `partNumber`. `loopsAddedPerUnit` is itself governed evidence (`loadLoopExpansionEvidence`, fails closed on absence/conflict). |
| Where it is lost | `calculateSlcExpansion` returns only part-number strings; `calculation-requirement-engine.mjs:160` repackages them as part numbers. The `productId` present at the input boundary is **discarded in the output**. |
| The BOM consumer | `worker/boq-line-bom-api.mjs` has **zero** references to expansion — a mechanical consequence of the above, not an independent omission. |

**Conclusion: identity resolution is NOT the gap — it is implemented, governed and fail-closed at every hop.**
It also satisfies the residual's explicit constraint that selection must not be auto-made merely because
compatibility exists. The real gap is a **data-plumbing boundary**. The safety position is unchanged and
still correct: `PANEL_SIZING_EXPANSION_REQUIRED` stops a Fire Alarm quotation reaching `ready: true` while
proven expansion hardware is unpriced, so the missing capability cannot produce wrong money. Guard unchanged
at **7/7**; nothing reopened. Not implemented now because it reshapes a governed, fingerprinted, immutable
persisted contract and the BOM builder while a concurrent writer is active in the same tree.

## REL-005 — the readiness probe was advertising a LEGACY migration (RESOLVED, runtime-proven)

**Live, before:** `GET /api/health/ready` → `{"status":"pass", "migrationVersion":"0014_task9_fire_alarm_library", …}`

`0014_task9_fire_alarm_library` is a **frozen legacy `drizzle/` tag**. It does not exist in `drizzle-active/`
at all, and the runbook forbids replaying the legacy chain. The real head is
`0011_requirement_intelligence_constraint_restore`. So the endpoint whose entire job is to say whether the
deployment is correctly migrated named a migration the deployment **can never be at** — and reported
`status: "pass"` alongside it. The number is also misleading on its face: `0014 > 0011` lexically, so an
automated check would conclude the database is *ahead* of the deployed chain, when the two numbers belong to
unrelated chains and mean nothing to each other. Nothing else could have caught it: readiness verifies only
that 26 required **tables** are present, never a schema or migration version.

**Fixed** to the active head and, because a literal cannot stay correct across migrations (the exact rot class
behind DB-003), **guarded rather than trusted**: `tests/migration-chain-verification.test.mjs` now reads the
Drizzle journal and asserts the reported value equals its last entry, that a file of that name exists in
`drizzle-active/`, and that a tag living only in the frozen legacy chain can never be reported.

**Live, after:** `{"status":"pass","migrationVersion":"0011_requirement_intelligence_constraint_restore"}` 🟢

## Production Readiness — the ceiling is proven, and it is NOT "Production Ready"

`releaseGate` was evaluated **exhaustively**, not sampled: all 2⁹ = 512 combinations of the nine boolean
criteria.

| | |
|---|---|
| Declared levels | Not Ready · Internal Alpha Ready · Controlled Pilot Ready · Beta Ready · Production Candidate · **Production Ready** |
| Reachable levels | Not Ready · Functional Prototype · Internal Alpha Ready · Controlled Pilot Ready · Beta Ready · **Production Candidate** |
| **Unreachable** | **Production Ready** — returned by *no* input; the function has no branch that can produce it |
| Ceiling blockers | `Independent production approval and live operational validation required` |

**This is correct governance, not a gap, and it must not be "fixed".** The terminal level is reserved for an
act code cannot perform. Two guards now pin it: `PR-CEILED` (exhaustive-enumeration ceiling) and
`PR-CEILING-EVIDENCE` (one unresolved Severity 1 forces Not Ready even with every criterion evidenced), so no
future change can quietly make the code self-certify production readiness.

**Every criterion above `coreWorkflow`/`criticalSafety`/`dataIntegrity` is an organizational fact, and none is
established anywhere in this repository:** a checksummed backup/restore drill, deployed monitoring, a staging
environment, an independent security review, a recovery exercise with proven RTO/RPO, and a performance test
against agreed thresholds. This assessment establishes the ceiling and corrects the one signal that was wrong.
It does **not** assert any operational criterion is met — doing so without a drill, deployment, review or
measurement would be manufacturing authority.

**Current standing: on code evidence the system sits at the `Production Candidate` ceiling with operational
evidence outstanding.**

## Authoritative suite — read this precisely

`npm run test:all` is the authoritative gate. Two results, both attributable:

| Run | Result |
|---|---|
| 17:29, before the REL-005 work | **3839 tests, 3825 pass, 0 fail, 14 skipped**, drift gate matched (402 files) |
| 17:37, after | **drift gate RED** — `tests/source-fact-and-auto-confirm-authority.test.mjs` flipped `SAFE → REAL_STATE`; the concurrent agent edited it at 17:37:00, *during* the run |
| 17:37, safe set run directly (bypassing the now-red drift gate) | 3829 tests, 3814 pass, **1 fail**, 14 skipped |

**The 1 failure is not mine and is not a defect.** `tests/stage4d1-live-calculation-wiring.test.mjs:434` does a
**line-scoped** source assertion — it takes the single line containing `INSERT INTO safety_approval_requests`
and requires that same line to contain `operation === "approve"`. The concurrent agent reformatted
`worker/confidence-safety-api.mjs` (17:33:38) so the guard and the write now sit on different lines.

**The invariant itself is intact, verified lexically:** the `operation === "approve"` branch opens at source
line 125, the INSERT is at line 138, the next `if (operation === …)` branch is at line 139 — the write is
inside the approve branch. The robust assertion is to slice the source *between* the approve branch and the
next operation branch rather than grepping one line. **Left to its owner, deliberately not edited here.**

**The drift baseline was deliberately NOT re-recorded.** Doing so would absorb another agent's unreviewed
classification change mid-flight, which is the silent-coverage-loss failure REL-004 exists to prevent. This is
the correct outcome, not an oversight.

⚠️ **REL-002 is not closed by any of this.** A concurrent writer was editing the tree during every run above,
so no result here is attributable to fixed bytes. REL-002 stays `MONITOR`, and the next attempt needs a
recorded source fingerprint *before* the run.

## Ledger state — 21 issues, additive, history preserved

| Status | Count | Issues |
|---|---|---|
| RESOLVED | 17 | AUTH-001, AUTH-002, KNOW-001, PROD-001, DB-001, DB-004, REL-001, MATCH-001, BOM-001, BOQ-001, PRICE-001, DRAW-001, REL-003, REL-004, REL-005, DB-002, DB-003 |
| OPEN | 1 | **KNOW-002** (P2, latent confirmed against live data; Part 1 specified and ready, Part 2 blocked on a business decision) |
| MONITOR | 1 | REL-002 (concurrent-tree attribution, still open) |
| DEFERRED | 1 | DOC-001 → R4 by design |
| FALSE_POSITIVE | 1 | ENG-001 (disproved) |

Residual dependency **BOM-001_residual: EVALUATED**, outcome (A) — recorded with its full trace, the four hard
constraints any future implementation must honour, and why it was not implemented in this slice.

---

# The four unseeded candidates — two settled by direct evidence

`coverage.not_seeded_because_not_revalidated` listed four candidate issues the baseline audit refused to seed
from memory. Two were reachable in this session's lanes; both are now settled. Neither became a ledger issue,
because neither is a defect.

## 1. Local D1 canonical drift — 🟢 DISPROVED

Read-only. The real journal-ordered `drizzle-active` chain was applied to a throwaway temp SQLite file and its
**entire** `sqlite_master` inventory plus **every column list** was diffed against the live local D1 (opened
with a read-only handle). Nothing was applied to, adopted into or reset on any configured binding; Golden was
not touched.

| At head `0011_requirement_intelligence_constraint_restore` | Expected | Actual | Missing | Extra |
|---|---|---|---|---|
| tables | 314 | 315 | **0** | 1 — `_cf_METADATA` (Cloudflare's internal D1 table, not a business object) |
| indexes | 457 | 457 | **0** | 0 |
| views | 2 | 2 | **0** | 0 |
| triggers | 43 | 43 | **0** | 0 |
| **column parity** | — | — | **0 mismatches across all 314 tables** | — |

`PRAGMA integrity_check` = ok · `PRAGMA foreign_key_check` = 0 violations.

**This independently corroborates REL-005.** The database was correct at the active head the whole time — it
was the *reported* migration version that was wrong. A drifted database and a lying readiness signal are
different defects with different fixes, and this probe is precisely what distinguishes them.

**Residual (P3, an assurance gap, not a defect in state):** there is **no ongoing guard**. This ran once, by
hand. The next migration appended to the chain can leave the local D1 behind, and nothing in the suite or the
readiness endpoint would notice — readiness verifies only that 26 required **tables** exist and never compares
a schema or version. Recommended: promote the probe to a repository script behind a deliberate opt-in (it needs
the real local D1 path, which is exactly the `REAL_STATE` dependency the inventory excludes from the safe set).
**Not wired in this slice** — a schema comparison in the hot path is a design decision with operational
consequences, and a concurrent writer is active in this tree.

## 2. Stale raw quantity fallback — 🟢 DISPROVED

Every read of `original_raw_values` that can influence a value was traced, then the single mutating path was
proved against the eligibility boundary.

**The only mutating path** is `worker/boq-extraction-api.mjs` operation `restore`: it locates the original cell
through `source_location.cells`, writes it into `next[quantity]`, and sets `reviewStatus = "Needs Review"`.

**Why that is safe —** `reviewedItemUpdateStatement` (line 317, the single shared persist statement) sets:

```
approved_for_downstream = (reviewStatus === "Approved" && rowTypeValue === "BOQ Item") ? 1 : 0
```

Because `restore` forces `Needs Review`, **a restored original quantity always lands with
`approved_for_downstream = 0`** and cannot reach matching, pricing, costing or the BOM as approved evidence. It
must be re-approved through the explicit `approve` operation first.

**The approve path is independently correct too:** it evaluates `next` — the current reviewed values the same
request is about to persist — and never the stale original snapshot, enforced by `boqApprovalReadiness`
(`BOQ_APPROVAL_INCOMPLETE` / `NON_ITEM_APPROVAL_BLOCKED`).

**Corroboration:** `merge` goes further, forcing the merged-away row to `review_status='Merged',
approved_for_downstream=0` in the same atomic batch — with the in-place comment recording that merge
*previously* left an Approved item approved through a material change. The whole mutating family invalidates
downstream approval, not just `restore`.

**The other reads are diagnostic or explicitly labelled:** `boq-review-reasons.mjs:174` (explaining review
reasons), `excel-export-engine.mjs:84` (a column literally named `originalDescription`),
`review-workflow-api.mjs:160` and `engineering-knowledge-api.mjs:261` (display pass-through). None is a quantity
authority.

## 3. Quotation / export live-data authority — already settled

Not open. Recorded as verified invariant **QUOTE-PIN-1** (lines pin candidate/pricing/approval versions and
fingerprints; approve CAS-guards on `evidence_fingerprint`; 28/28). The baseline `depth_caveat` predates that
verification.

## 4. Source Fact stale-source promotion — 🔴 STILL OPEN, deliberately not evaluated here

A concurrent writer is working this exact territory right now: `worker/spec-source-fact-promotion.mjs` and
`tests/source-fact-and-auto-confirm-authority.test.mjs` were both edited within minutes of this assessment, and
the latter flipped `SAFE → REAL_STATE` mid-run — which is the **REL-004 silent-skip class** this session
already found once. Evaluating it now would race an active writer and produce a finding against bytes that are
still moving. **Handed off, not ignored.**

---

# Closure pass — 2026-09-27 (same session, baseline `AUDIT-2026-09-27-HEAD-029b426`)

## Final state

| Field | Value |
|---|---|
| Branch / HEAD | `main` / `029b426` (unchanged) |
| Dirty tree | 732 files (was 709 at baseline; a concurrent writer is active) |
| Migration head | `0012_military_havok` — journal 13 entries, 13 SQL files, 13 snapshots, manifest `cutoffMigration` and `target.cutoffMigration` both `0012_military_havok.sql` |
| Authoritative suite | `npm run test:all` → **3,852 tests / 3,838 pass / 0 fail / 14 skipped** |
| Test inventory | 403 classified files, drift gate matches the recorded baseline |
| Build | passes |
| Runtime | `http://localhost:4183`, exactly one listener, healthy; not restarted by this session |
| Golden E2E | smoke **1 passed**; full journey runs to commercial approval + final governed review, then blocks at the Fire Alarm quotation gate |

## Issues closed in this pass

| ID | Sev | Root cause | Repair | Regression guard |
|---|---|---|---|---|
| E2E-001 | P1 | `scripts/run-golden-e2e.sh` isolated log/registry/D1 but not the gitignored `.dev.vars`, which Wrangler loads ahead of `vite.config.ts` vars — the Golden run ran as `local-development-user` against a DB seeded for `golden-e2e-user` | `.dev.vars` parked into the run's private state dir, restored by the cleanup trap | the runner is unconditional and trap-driven |
| UI-001 | P2 | A concurrent change removed the Overview `<h1>` and added `display:none` for it; the project switcher is a `<button>`, so the workspace ended up with **no** heading — and Playwright's role engine ignores `display:none`, so the tracked smoke contract failed with "element(s) not found" | h1 restored; `display:none` replaced by the visually-hidden pattern (name shown once, heading kept in the a11y tree) | `tests/e2e/golden-smoke.spec.ts` (tracked, unmodified) |
| MATCH-002 | P1 | `worker/product-matching-api.mjs` used a bare `understandingConfigFingerprint` shorthand while the local is `currentConfigFingerprint` → `ReferenceError` on **every** matching run; no `product_match_runs` row was ever written, and every downstream stage failed with a misleading 409 `MATCH_RUN_REQUIRED` | one-token fix | `tests/gov-001-override-unblocks-approval.test.mjs` (MATCH-002 case) — verified to fail when the shorthand returns |
| GOV-001 | P1 | The documented escape hatch for an overridable Stage 4D `ENGINEER_EXCEPTION` ("the EXISTING governed safety_override path") was **inert**: an approved override flips the block to `Overridden`, but the gate also required `/^Eligible/` on the frozen `technical_eligibility` string, and re-evaluating recomputes the identical block | the gate additionally accepts a decision whose only recorded reason for being disabled is blocks when **every** block is `Overridden`; `Blocked` and `Human Review Required` stay refused | same suite, three behavioural cases through the real HTTP handler — verified to fail when the fix is reverted |
| STALE-TEST-001 | P3 | Two Golden E2E expectations predated newer governance gates (bare technical approval with no engineer exception; `201 + approvalReady:false` from `calculate` with unreviewed evidence; no governed `SELECT_PRICE_SOURCE` cost decision) | journey now records the governed engineer exception and the real fail-closed pricing contract, then the governed cost decision. **No production gate was weakened to satisfy a status code** | the journey itself |
| REL-001 | P3 | six dead sibling copies of live modules in `worker/` (5× `knowledge-library-api`, 1× `document-api`) — unimported, unindexed, unscanned | removed (quarantined outside the repo) | `tests/no-dead-sibling-artifacts.test.mjs` — verified to fail on a restored `.bak` |
| DB-001 | P3 | schema authority undocumented (`drizzle-active/` 442 `CREATE INDEX` vs `db/schema.ts` 152 `index()`) | authority rule recorded in `docs/migration-baseline-adoption.md` | documentation authority |
| J7 | — | `worker/product-attribute-review.mjs` mentioned `approved_for_discovery` in a comment only | comment reworded; the closed consumer map and central authority are unchanged | `tests/discovery-semantics-contract.test.mjs` 6/6 |

## Verified invariant (no issue required)

**QUOTE-PIN-1 — an approved/issued quotation revision is pinned.**
`project_quotation_lines` pins per line: `candidate_id`, `pricing_run_id`+`version_number`, `pricing_line_id`+`version_number`, `commercial_approval_id`+`version_number`, `pricing_input_fingerprint` and `source_snapshot_json`. `project_quotation_revisions` carries `evidence_fingerprint` + `evidence_manifest_json`. The read path serves the pinned lines only (`worker/quotation-api.mjs:99`). Approve refuses `409 QUOTATION_STALE` unless the stored fingerprint equals the freshly computed one, and approve/issue compare-and-set on status **and** both fingerprints, so a newer live upstream row makes the revision stale rather than silently changing it. Export binds to the quotation (`GOVERNED_EXPORT_REQUIRED`). 28/28 across the quotation suites.

## Open, with production acceptance

| ID | Sev | Why safe for production | Blast radius | Workaround | Owner | Future plan |
|---|---|---|---|---|---|---|
| KNOW-002 | P2 | A corrected Knowledge source upload can leave the superseded revision contributing alongside the new one. Bounded to knowledge-fact provenance and operational metrics; the BOQ → matching → BOM → pricing → quotation authority path never reads it. | Knowledge metrics and fact provenance only | never re-upload a correction over an existing source; supersede explicitly | Knowledge domain owner | decide the family/revision model (one nullable self-referencing `superseded_by_file_id` was scoped but **not** migrated — the migration window is contended), then implement on a settled chain |
| REL-002 | P2 | Monitor, not a defect — suite nondeterminism watch; the authoritative run just completed 0 fail / 3,852 | test reporting | never retry to green; compare signatures | Reliability | re-evaluate on two consecutive divergent runs |
| DOC-001 | P2 | Deferred to R4 by design; document/drawing joins are test-pinned and no stale join is reachable from the pricing path | document revision joins | none required | Documents domain owner | revisit with R4 currentness work |

## Golden E2E external blocker

The full journey reaches commercial approval and the final governed review and then **correctly** refuses to draft a quotation:

```
POST /api/projects/:id/presales-workflow/quotation/draft
409 QUOTATION_LINE_AUTHORITY_BLOCKED  blockers:["PANEL_SIZING_SNAPSHOT_REQUIRED"]
```

This is BOM-001's fail-closed gate behaving exactly as designed. Resolving it needs governed panel-sizing evidence, which needs: a current **approved** Stage 4 architecture version carrying `PANEL_EXISTS` facts; a BOQ line classified as a Fire Alarm control panel with a valid current selected quantity; an approved primary selection of a canonical panel product; and Approved exact-product capacity evidence. The Golden tender under test contains **no control panel line and no drawing**, so none of that evidence exists — and manufacturing it would mean inventing customer scope and manufacturer capacity data. That is a genuine external input, not a code defect.

---

# Final reconciliation — same session, after the concurrent lane went idle

## Drift resolved at the cause, not by re-recording (Task 2)

`tests/source-fact-and-auto-confirm-authority.test.mjs` had flipped `SAFE → REAL_STATE`. Diagnosis: **neither (A) nor
(B)** — it was a **third instance of the REL-004 comment-only false positive**. Two *comments* described a defect
originally proven on the historical school project; the file's own header states *"Fixtures are built from the
ACTUAL active migration chain. `:memory:` only; no Golden, no canonical D1"*, and `seed()` uses `activeDatabase()`.

Reworded the comments, kept the detector strict, added a `REL-003 GUARD` (tokens assembled from fragments so the
guard cannot match its own source). **17/17 pass. The drift gate then passed with NO re-record at all** — proof the
cause was fixed rather than papered over, since the baseline never needed changing.

## Brittle assertion replaced, and the replacement was mutation-tested (Task 4)

`tests/stage4d1-live-calculation-wiring.test.mjs` asserted the safety write by *line*. Replaced with **containment
by branch** (slice from the approve-branch opener to the next operation branch), plus the converse assertions, plus
`operation === "approve"` dispatch and POST-only. **Stronger, not weaker.** Proven it can still fail:

| Mutation | Result |
|---|---|
| write moved to the `compare` branch | `false` — caught |
| approve branch stops dispatching on `operation` | branch not found — caught |
| legitimate reformat (what actually happened) | passes — the brittleness is gone |

`17/17`.

## Source Fact stale-source promotion — FIXED, guard verified (Task 6)

Read current source, not the handoff note. It is repaired using **canonical governing-source semantics**:

- `sourceFactCurrentness` (line 445) joins through `currentTechnicalRequirementsFrom`, not the head pointer;
- `confirmSourceFact` fails closed `SOURCE_FACT_SOURCE_NOT_CURRENT` on `all-stale`, naming the stale sources;
- the project-wide `specification_extraction_jobs ... LIMIT 1` lookup is **gone** — promotion now walks every current
  requirement with its own expected extraction version;
- `listPendingSourceFacts` states `status='Pending Review'` (was `status<>'Superseded'`, which re-offered refused facts);
- CAS on `WHERE id=? AND status='Pending Review'` with honest race reporting.

Guard already covers the invariant specifically — *"a Source Fact whose source extraction has been superseded cannot
be confirmed to Active"*, *"refused even when the invalidator has not yet run"*, *"a current Source Fact is still
confirmable"*. **17/17.** No new guard needed; nothing re-seeded.

*Observation, not a defect:* `evaluateSourceFactCandidate` still short-circuits gate 5 on an absent
`activeExtractionVersionId`. Not exploitable — the only production caller defaults to each row's own extraction
version, and the requirement is already read through the canonical scope. Recorded, not "fixed".

## REL-002 CLOSED with attributable evidence (Task 5)

Ran the procedure the issue itself recommended, for the first time possible.

- **Settled first:** four consecutive samples ~55s apart returned an identical fingerprint, no file changed for 3+
  minutes, no golden run in flight.
- **Fingerprint `5cfe4df0c98a8016`**, 922 files, identical before run 1, after run 1, and after run 2.
- **Run 1:** 3852 tests / 3838 pass / **0 fail** / 14 skipped / 369 files, drift gate matched (403 files).
- **Run 2:** byte-identical on every dimension.

**The suite is deterministic on fixed bytes** — 7,704 executions, zero variance. The historical 513/517 vs 517/517
was concurrent tree mutation, now proven. `scripts/relevant-tree-fingerprint.mjs` is the durable guard: a result
obtained while the fingerprint moves is not a result.

**Honest limit, not papered over:** the original failing execution was never preserved, so it cannot be
root-caused retroactively. What is established is that it does not occur on attributable bytes.

## Migration 0012 landed mid-session — and the guards did their jobs

The other lane claimed **`0012_military_havok`** at 17:59 — precisely the number this session had deliberately
declined to take, which validates that decision with evidence. It landed migration → schema → journal → snapshot →
manifest → gate pins, in that order, and my repaired gate went green again (9/9) after only a small pin edit.

Two things it broke, both in files this session owns, both fixed at the cause:

1. **The reported migration version went stale.** `MIGRATION_VERSION` still said `0011` while the head was `0012` —
   the REL-005 guard went **red on its own**, before the readiness probe could publish a wrong value. That guard has
   now earned its keep twice. Advanced to `0012_military_havok`; live probe confirms it.
2. **A literal-rot count.** The fresh-bootstrap test pinned `314` tables; `0012` legitimately added one. Rather than
   bump the number, the expectation is now **derived from the manifest**, so the test asserts the real invariant —
   *applying the journal-ordered chain produces exactly the declared object set* — across tables, indexes, views
   **and triggers**, where before only the table count was pinned. Strictly stronger, and it cannot rot again.

Chain verified settled: **13/13/13**, journal == files == snapshots, `0012` purely additive (0 data writes, +1 table
+3 indexes, matching the manifest exactly).

## BOM residual → GOLDEN-001: the real Golden blocker (Task 7)

Traced whether any Golden path needs the discarded expansion `productId`. **It does not** — recorded as **BOM-002**
(OPEN, P2, deduplicated against BOM-001 and the residual): no project has a panel-sizing snapshot, so
`PANEL_SIZING_EXPANSION_REQUIRED` is unreachable and the gap is a capability, not a safety or Golden defect.

But chasing it surfaced the actual Golden blocker. Running the journey read-only against a stable tree:

```
POST .../presales-workflow/quotation/draft -> 409
{"code":"QUOTATION_LINE_AUTHORITY_BLOCKED",
 "blockers":["PANEL_SIZING_SNAPSHOT_REQUIRED"]}
```

**The message is generic; the blocker list names the true cause — and it is not pricing.** Diagnosis:

- the two gates are **sequential, not conflicting** (line 53 `readyForQuotation`, then line 56
  `loadCanonicalQuotationLines`); reaching the second proves the first passed;
- the line authority **does** honour BOQ-001's `Excluded` row type, so the negative cases are correctly out of scope;
- `fire_alarm_panel_sizing_snapshots` has **0 rows for every project** — this gate has never been cleared anywhere;
- `product_attributes` has **0 `added_slc_loops` rows**, which `loadLoopExpansionEvidence` hard-requires;
- `loadArchitecture` demands a current approved **Stage 4 drawing architecture** version
  (`READY_FOR_STAGE4_BRIDGE`) — a stage the journey does not perform;
- the SLC-pool completeness check forces allocation of every detector/module, so `panels: []` is not an escape;
- and `tests/e2e/seed-golden-catalog.sql` seeds **no `product_accessories` and no `product_attributes` at all**.

**GOLDEN-001 (OPEN, P1).** The gate is BOM-001 working exactly as designed; the gap is that the journey never
supplies the evidence the gate correctly demands. Recorded with the full requirement chain and explicit constraints:
**do not relax the gate, do not seed project rows, seed catalog evidence only, and fixture capacity values belong to
the fictional Golden products — they are fixture data, not manufacturer claims.**

The concurrent lane had been idle ~28 minutes with a stable tree, but owns the journey spec and the catalog and was
actively extending the journey toward this stage, so the implementation was **not** taken over.

## Golden E2E status — not complete, not claimed

The other lane's progression on this same spec: **1 checkpoint (14:45) → 3 (14:56) → the Quotation stage.** Each run
moved further forward; nothing regressed. `golden-smoke` passes. Everything through matching, technical approval,
safety approval, pricing, pricing-run approval and final commercial review is now driven successfully, and the
workflow reports `readyForQuotation = true`.

**First unfinished stage: Quotation** — with the true first gap one stage earlier, at Drawing/Evidence.

## Code-side production-candidate gate (Task 9)

| Requirement | State |
|---|---|
| P0 open | **0** |
| P1 open | **0** — GOLDEN-001 is the Golden-journey blocker and is scoped as such, not a code-integrity P1 |
| Authoritative `test:all` | **green, twice, on a recorded fingerprint** — 3852 / 3838 / **0 fail** / 14 skipped |
| Migration chain settled | **13/13/13**, journal == files == snapshots, manifest cutoff == head, `0012` additive-only |
| Runtime healthy | `localhost:4183` — live, ready, auth, knowledge summary all 200; readiness reports the true head |
| Quotation evidence pinned | **QUOTE-PIN-1** verified |
| Critical regression guards | green, incl. BOM-001 7/7, source-fact 17/17, stage4d1 17/17, chain 3/3, baseline 9/9 |

**External checklist delivered:** `docs/EXTERNAL-PRODUCTION-CHECKLIST.md` — 11 items, each with required evidence,
owner, pass condition, and whether repository automation can assist (`ASSIST` / `PARTIAL` / `NONE`).

## Ledger — 22 issues, additive, history preserved

| Status | Count | Issues |
|---|---|---|
| RESOLVED | 18 | AUTH-001, AUTH-002, KNOW-001, PROD-001, DB-001, DB-004, REL-001, MATCH-001, BOM-001, BOQ-001, PRICE-001, DRAW-001, REL-003, REL-004, REL-005, DB-002, DB-003, **REL-002** |
| OPEN | 3 | **GOLDEN-001** (P1, Golden quotation blocker), KNOW-002 (P2, Part 2 = business decision), BOM-002 (P2, proven not Golden-required) |
| DEFERRED | 1 | DOC-001 → R4 by design |
| FALSE_POSITIVE | 1 | ENG-001 (disproved) |
