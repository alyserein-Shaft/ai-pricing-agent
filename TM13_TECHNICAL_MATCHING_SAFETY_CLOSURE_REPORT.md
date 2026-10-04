# TM13 — TECHNICAL MATCHING SAFETY CLOSURE VALIDATION REPORT

Status: **TM13_BLOCKED** (not CLOSED)
DATA_MUTATIONS: **NONE** (proven — see item 16)
Validation scope: read-only only; no DB writes, no live match persistence, no profile regeneration, no PL1/Drawing/Pricing/Quotation edits, no COMMIT/PUSH/DEPLOY/STANLY.
Files changed: NONE except this report (single deliverable artifact; no source or data files touched).
Validated real case: Al Mousa Golden item `boqitem_5af0a8eb-7233-4dcb-bf46-8b7a28ffc5bf` (Golden requirement `specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_197`; incumbent `IDP-HEAT-ROR-IV` = `product_161c27bf-70d9-4e3e-b1c9-ad7783dc3dac`). Central Kitchen used only in existing isolated tests.

---

## Verdict (one line)

The TM1–TM12 safety stack is internally consistent and all focused/full regressions are clean of new TM-caused failures, **but the real Al Mousa Golden case does not behave as mandated** (it is rejected-as-incompatible instead of surfacing as Technical Review Required / Pending Evidence), so the closure rule is not met → **TM13_BLOCKED** with exactly one concrete blocker (below).

## Exactly ONE concrete blocker

> **Real Golden re-proof fails the mandate.** A fresh, read-only, in-memory matcher run against the persisted real Golden profile (version 10, non-superseded) and the real 930-product D1 catalog classifies the incumbent `IDP-HEAT-ROR-IV` as:
> `technicalStatus = "Non-Compliant"`, `recommendationTier = "Rejected Candidate"`, `mandatoryFailures = 1` (`Accessory isolator — Missing Accessory, blocking: true`), `mandatoryUnresolved = 0`, `approvalReady = false`.
> The mandated Golden outcome is `mandatoryFailures = 0`, `mandatoryUnresolved = 1` (FlashScan+CLIP = Evidence Missing), `technicalStatus = Technical Review Required`, `recommendationTier = Pending Evidence`, `approvalReady = false`, and the case **must NOT be rejected-as-incompatible** — which the real engine currently does. This is confirmed by the already-persisted `safety_decisions` row for the Golden item (`compliance_state: "Non-Compliant"`, `technical_eligibility: "Blocked"`) and by the contract's own OPEN downstream finding `MISSING_EVIDENCE_LABELLED_NON_COMPLIANT` (matchrun `ad500e07`, candidate IDP-HEAT-ROR-IV).

Root cause chain (two linked mechanisms, both invisible to the green synthetic suites):

1. **Accessory "isolator" enforced as blocking (PRE_EXISTING engine policy + real profile content).** The persisted profile versions 8–10 carry `accessories: [{ accessory: "isolator", review_status: "Needs Review", confidence: 90 }]` extracted from the spec clause *"x) Optional sounder, relay, and isolator bases available."* `evaluateAccessories` (unchanged vs HEAD) sets `blocking: !offered`, so a Needs-Review, spec-optional accessory with no product evidence becomes a **blocking mandatory failure → Non-Compliant / Rejected Candidate**. The synthetic closure tests (`golden-heat-detector-4w-closure.test.mjs`, 13/13 green) use `accessories: []`, so they never exercise this path. This is exactly the "missing evidence fabricated as contradiction / as incompatibility" that TM4/TM12 exist to prevent.

2. **TM12 `mandatoryUnresolved` priority resolution is camelCase-only vs the real persisted shape (CAUSED_BY_TM1_TM12 real-shape gap).** The real persisted compatibility entry stores its governing requirement as snake_case `requirement_id` (`specjob_…_197_compatibility_1`). The TM12 gate in `evaluateCandidate` resolves priority only via `entry.requirement?.requirementId` (camelCase); the real entry has no camelCase key, so the resolved priority is `null` and **FlashScan/CLIP Evidence Missing never enters `mandatoryUnresolved`** under the real shape. Synthetic tests pass because they supply camelCase `requirementId: REQ_197`, which resolves through `governingSourceId`. The live worker feeds the stored profile verbatim (`projectSearchProfileToRequirementProfile` spreads `existingProfile`, overriding only `boqItem`), so the runtime shape matches what this probe used.

Both mechanisms violate the closure rule ("FlashScan+CLIP must surface as mandatory unresolved; mandatoryFailures must be 0; must not be rejected-as-incompatible"). This is the single concrete blocker; fixing it requires the TM12 aggregation + accessory-evidence handling described in the single next step.

---

## The 16 verification items

1. **TM1 — Standards safety (body-only citations never defect).** PASS. Fresh focused run green on `TM1: body-only IEEE/UL/NFPA citation is NOT_COMPARABLE and non-blocking`, malformed/unresolved citation NOT_COMPARABLE, missing product evidence for a *genuinely comparable* standard preserves blocking, UL 268 verified-compliant behavior preserved (`tests/product-matching-engine.test.mjs` 170–215).

2. **TM2 — Standard normalization equivalence.** PASS. `norm()` + `standardKey = norm(body number part)` collapse `UL 268 ≡ UL-268 ≡ UL268`, `EN54-7 ≡ EN 54 7`, `NFPA 72 ≡ NFPA-72` while keeping `UL 268 ≠ UL 864`, `EN54-7 ≠ EN54-5`, `NFPA 72 ≠ NFPA 70`; body normalization in `standards-citations.mjs` (`normalizeStandardBody`) exercised by focused green suites incl. `p3-standards-semantics`.

3. **TM3 — Standard role safety (product-listing bodies only gate).** PASS. Focused green on `TM3: NFPA 72 code-body standard is non-blocking when product evidence is missing`, `UL 268 product-listing standard IS blocking when missing`, NFPA-72 with evidence → Verified Compliant, EN54-7 product-listing blocking (`tests/product-matching-engine.test.mjs` 472–505; `standards-semantics.mjs` body classification).

4. **TM4 — Missing evidence must not fabricate contradiction (attribute/unstructured).** PASS at engine level (missing product data on mandatory unstructured statements is non-blocking `Missing Product Data`; populated `mandatoryUnresolved`). **FAILS for the real Golden case at the accessory level** (see blocker: Needs-Review optional accessory → blocking failure). This is the substance of the blocker, counted once.

5. **TM5 — Operator safety (unknown/unsupported never FAIL).** PASS. Focused green on `TM5: unknown operator produces Not Comparable, not Fail`, `null operator defaults to Equal`, `Equal works`, `Between → Not Comparable` (`tests/product-matching-engine.test.mjs` 503–561).

6. **TM5/TM6 — Range/unsupported-operator fail-safe across the whole stack.** PASS. Both engine tests and `attribute-comparison-contract` (24 green) confirm unknown/null/Between and unsupported range operators never default to FAIL in any consumed path.

7. **TM7 — Contract v2 gating (READY-states only for PASS/FAIL).** PASS. Focused green on `TM7: fixed_temperature_setpoint (READY) with unsupported operator is Not Comparable` and Equal normal evaluation (`561–585`); `attribute-comparison-contract-test` + `READY_STATES`/`allowedOutcomes` verified in code review.

8. **TM8 — Compatibility fail-safe.** PASS. Focused green on `TM8: missing compatibility evidence is non-blocking (fail-safe)`, `explicit incompatibility IS blocking`, collapsed protocol non-blocking (`590–635`). (Note: the real Golden compat surface failing is not this mechanism — see blocker #2.)

9. **TM9 — Protocol non-READY handling (`UNKNOWN_PRODUCT`).** PASS. Focused green on `TM9: protocol (non-READY) comparison produces UNKNOWN_PRODUCT` (`635`). SLC/drawing-bridge evidence stays circuit-level and never becomes FlashScan/CLIP/IDP protocol compatibility (item 14).

10. **TM10 — Matcher core.** PASS. Focused green `TM10: matcher core — all…` (`683`); entire engine suite 71/71 except the documented pre-existing stale test (item 12).

11. **TM12 — Three-way aggregation distinctness (mandatoryFailures / mandatoryUnresolved / non-mandatory evidence) in sorting, ranking, serialization, approval gating.** PASS at engine level: sort is `familyMatchTier → mandatoryFailures>0 → mandatoryUnresolved>0 → evidenceStrength → searchScore → score`; `mandatoryUnresolved` candidates get `Technical Review Required` / `Pending Evidence`, `approvalReady` hardcoded `false`, and `compareCandidates` serializes the three lanes as distinct counts. **Real-shape defect**: the gate resolves priority only via camelCase `requirementId` while the persisted profile stores snake_case `requirement_id` → FlashScan/CLIP never surfaced as unresolved in the real Golden run (folded into the single blocker).

12. **Focused regression re-run (fresh, no reliance on prior runs).** 11 focused files, **161 tests: 160 pass / 1 fail**. The single failure `tests/product-matching-combined-detector-fix.test.mjs:75` ("missing mandatory evidence cannot become a confirmed match") is classified **PRE_EXISTING**: it is an untracked stale test pinning pre-TM12 semantics (expects `blocking=true` + `Non-Compliant` for missing product data); the actual engine state is the TM12-correct `blocking=false` + populated `mandatoryUnresolved` + Discovery Only + `approvalReady=false`. Not fixed (no code changes allowed unless a literal regression prevents validation). Golden-heat suite 13/13 green.

13. **Real Al Mousa Golden re-proof (read-only, in-memory, persisted profile v10 + real catalog).** **FAIL vs mandate → the blocker.** Attributes PASS ×3 (addressing, 135°F, 15°F/min); FlashScan+CLIP = `Evidence Missing, blocking=false`; but `mandatoryFailures=[{Accessory isolator, Missing Accessory, blocking:true}]`, `mandatoryUnresolved=[]`, `technicalStatus=Non-Compliant`, `recommendationTier=Rejected Candidate`, `approvalReady=false`, rank 1 score 45. Matches persisted `safety_decisions` (`Non-Compliant`) and persisted live runs and the contract's OPEN `MISSING_EVIDENCE_LABELLED_NON_COMPLIANT` entry. Not a TM1–TM12 code regression per se (accessory blocking is pre-existing HEAD policy), but the mission closure rule is unconditional on the real case behaving as mandated — it does not.

14. **Golden application safety.** PASS. Real decision records confirm the engineering decision: all 9 Golden units serve standard locations → **9× IDP-HEAT-ROR-IV (135°F + 15°F/min) and 0× IDP-HEAT-HT-IV**, with the 190°F high-temp model reserved for special locations — i.e., **190°F stays outside the Golden 9** (Golden suite test 7: 190°F absence never fails a standard ROR product; a 190°F HT variant fails only on the genuine 135°F mismatch). **SLC stays circuit-level**: Golden suite test 6 asserts no SLC comparison is fabricated without product evidence; real run confirms two-wire SLC/drawing-bridge evidence never becomes FlashScan/CLIP/IDP protocol compatibility (those remain separate Evidence Missing compat items).

15. **Approval-consumer trace.** PASS. `approvalReady` is hardcoded `false` in `evaluateCandidate`; no consumer ever flips it true; `technical-decision-authority.mjs` is an explicitly pure, fail-closed state machine that "never … touches candidate.approvalReady"; pricing aggregation only sums `approvalReady` lines. Persisted Golden safety decision (`technical_eligibility: "Blocked"`, `price_eligibility: "Price Approval Disabled"`) confirms no approval can currently flow. A `mandatoryUnresolved`/`Pending Evidence` candidate can never reach approval in any traced consumer.

16. **Ranking safety + wider/full regression + DATA_MUTATIONS = NONE.**
    - Ranking safety: PASS (see item 11 sort key; no candidate with mandatoryFailures/mandatoryUnresolved can outrank a proven candidate within its family tier).
    - Wider regression + full workspace suite (fresh `node --test tests/`): **3192 tests → 3165 pass / 13 fail / 14 skip**. All 13 failures classified **PRE_EXISTING / UNRELATED** (none `CAUSED_BY_TM1_TM12`): drawing-extraction-intelligence-integration ×3 (2 API-proposal-family + 1 GOLDEN SET INTEGRATION), engineering-knowledge-api "Exception-based review foundation", knowledge-library ×3 (link-factid, product-repair-route, product-resolver-runtime), organization-dashboard-scope ×2, pricing-scenario-currency-authority ×2, stage4-workflow-recovery ×1, plus the stale combined-detector-fix test from item 12. This matches the historical pre-existing 16-failure set minus the 3 golden-heat failures TM12 fixed (16 − 3 = 13). No new failure introduced by TM1–TM12.
    - **DATA_MUTATIONS = NONE**: Golden D1 file mtime is `2026-09-21T21:09:14.344Z` (no writes during this session; every probe opened the DB read-only); `product_match_candidates` newest row `created_at 2026-09-20 13:46:11`; no new match runs or profile versions; `git status` shows no commits (HEAD unchanged), empty index, no staged changes; engine/contract diff fingerprint unchanged since session start (+167/−22, contract diff stable); no probe files left in the repo. This session changed no source and wrote only this report.

## Single next step (exactly one — NOT implemented, per TM13 rules)

**In the TM12 matching lane, reconcile the real persisted Golden profile shape with the mandated outcome**, concretely: (a) make `evaluateAccessories` treat a Needs-Review / spec-optional accessory with no product evidence as non-blocking evidence surfacing through `mandatoryUnresolved` (mirroring TM4/TM12 missing-data semantics — "optional unresolved ≠ mandatory failure"), and (b) make the `mandatoryUnresolved` priority resolution in `evaluateCandidate` resolve the governing requirement through **both** camelCase `requirementId` and snake_case `requirement_id` (matching the persisted profile), so FlashScan+CLIP Evidence Missing becomes mandatory unresolved under the real shape; then re-run the real Golden re-proof read-only and assert the mandated outcome (`mandatoryFailures=0`, `mandatoryUnresolved=1`, `Technical Review Required` / `Pending Evidence`, `approvalReady=false`, not rejected-as-incompatible) plus the focused (161-test) and full-suite regressions.

STOPPED — awaiting owner review of this TM13_BLOCKED finding; the next step is not being implemented in this lane.