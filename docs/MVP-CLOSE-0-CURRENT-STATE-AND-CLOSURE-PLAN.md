# MVP-CLOSE-0 — Current-State Reconciliation and MVP Closure Plan

Status: **AUDIT / PLANNING ONLY — no implementation or business-state mutations.**
Date: 2026-09-28 · Repo: `main` @ `029b426` (dirty tree preserved, 736 modified files) · Runtime: `http://localhost:4183`, PID 66503, single listener (verified live).
Method: read-only DB queries (`.timeout 30000` / read-only / copied to `/tmp` when WAL contention), read-only HTTP GETs, source inspection, plus three delegated read-only investigations (Scopes A/B/C). Every headline finding was re-probed by the primary agent; corrections are noted inline.

Status markers: 🟢 verified · 🟡 partial / needs review · 🔴 blocked · 🔵 unverified.

---

## 0. Acceptance target verified

Two distinct projects exist; they are **not** the same entity:

| Project | Name | Created | BoQ | approved_for_downstream | Req. profiles (current) | Readiness (current) |
|---|---|---|---|---|---|---|
| `project_c0123d91-c30b-4956-87cb-e473ef53f89d` | **Al Mousa School** ← **ACCEPTANCE** | 2026-09-14 | 108 | 90 | 30 | MCI 22 · CR 7 · RWW 1 |
| `project_ae501b85-9c12-4332-bf8e-787c90f2d388` | Al Mousa School — Clean Golden Run (R11 work) | 2026-09-22 | 108 | 82 | 82 | MCI 37 · CR 30 · NTR 15 |

R11's Phase 6B field authority (51 `estimator_understanding_field_reviews`) was applied to `ae501b85` **only**. The acceptance project has **0** field reviews. All MVP closure analysis below is scoped to the acceptance project unless stated.

---

## 1. Executive verdict

**The journey is 3 of 13 stages green and 2 partial; everything beyond Understanding is blocked by a single dominant root cause chain, and the current "Ready with Warnings" on the acceptance project is a stale false pass.**

🟢 **Works (verified live / in source):**
- Project setup, document intake, BOQ extraction, drawing architecture (v2 Active, `READY_FOR_STAGE4_BRIDGE`, 128 approved facts over 11 documents).
- Understanding **authority machinery** (whole-blob precedence, field-level confirmation bound to interpretation+fingerprint, closed field set) — hermetic-tested 12/12, golden gate passed earlier.

🟡 **Partial:**
- Understanding completes for 22/90 accepted items (whole-blob approved); **12 items are straight deterministic closures that were never run** (pure zero-human debt).
- Drawing estate processed (3,363 assets) but the geometry→quantity chain is absent **by design**; drawings never contribute device quantities.

🔴 **Blocked (reconciled root causes):**
1. **Understanding debt** — 23 awaiting review, 42 not-analyzed, 3 failed attempts; 60/90 items have no current requirement profile.
2. **Compatibility evidence gap (the real MCI blocker)** — all 22 MCI profiles and all 7 panel lines are blocked on `compatibilityTarget` under fail-closed `fireAlarmRequiresPanelCompatibility`; only 12 `requirement_compatibility` rows exist (5 distinct pairs triplicated across 3 extraction runs), 11 with unapproved owner requirements.
3. **Technical approval path is empty** — `safety_approval_requests` = **0 rows database-wide**; `resolveCurrentPrimarySelection` can therefore never return `APPROVED`. Every panel has `UNAVAILABLE`/`PROVISIONAL` selection.
4. **Product/price evidence never promotes** — all 10 match runs `Discovery Only`, 100 candidates all `Needs Review`, 0 `product_match_reviews`, 0 technical approvals; 74 price records linked to acceptance products are unreachable by the pipeline.
5. **Sizing is unsatisfiable** — 0 `fire_alarm_panel_sizing_snapshots`; SLC pool is empty (0 of 90 classifiable); capacity names (`native_slc_loops`, `max_detectors_per_loop`, `max_modules_per_loop`, `max_system_points`) never authored (0 Approved `product_attributes`); `added_slc_loops` demanded universally by the sizing gate while the calculator only needs it when expansion is actually required (contract contradiction).
6. **Commercial tail is structurally unreachable today** — BOM blocked (no approved selection); service line is **impossible by schema** (`project_quotation_lines` requires NOT NULL `product_id`/`candidate_id`/`manufacturer_name`/`part_number`/pricing+approval FK rows); 0 pricing lines, 0 cost components, 0 quotation revisions, 0 governed exports.

🔵 **Unverified / not run:** no snapshot/handler/E2E executed during this audit (read-only by instruction); `drizzle.__drizzle_migrations` table is absent from the live DB (migration tracking mechanism not investigated — flagged, not asserted as a defect).

**Headline corrections to delegated findings (primary-agent re-probes):**
- `approved_for_matching` **has a writer** (`technical-requirement-api.mjs` `approve-readiness` route, `UPDATE … approved_for_matching=1`); the real defect is that it requires `readiness_status === "Ready for Matching"` which the readiness cascade has never produced (0 rows across all versions), and `excel-export-api` requires `approved_for_matching=1` rows. It is a **dangling downstream gate**, not a "no writer" defect.
- Quotation **issue is not circular with export**: the order Draft → Approve → governed Export → Issue is linear (`quotation-authority.mjs:55-64`; `presales-workflow-api.mjs` `quotation/approve`+`quotation/issue`). The blocker is that "Approved" is itself unreachable (no pricing/commercial authority upstream).
- Compatibility debt is **not** 12 independent rows: it is **5 distinct pairs**, triplicated by 3 extraction runs.

---

## 2. Current-state matrix — complete BOQ→Quotation journey

| # | Stage | State | Evidence | Primary blocker | Accept gate |
|---|---|---|---|---|---|
| 1 | Project setup | 🟢 | `projects` row exists; API 200 | — | — |
| 2 | Document intake | 🟢 | 15 documents, 3,363 drawing assets, 57 classifications (acceptance) | — | — |
| 3 | BOQ extraction | 🟢 | 108 items; 90 `approved_for_downstream`; `extractionConfirmed=90` | — | extraction review |
| 4 | BOQ understanding | 🔴 | 22 approved / 23 awaiting / 42 not-analyzed / 3 failed; **0 field reviews**; 12 deterministic closures never run | human review + deterministic run gap | Understanding completion → |
| 5 | Governed requirements | 🔴 | 1,484 requirements; 30 current profiles (22 MCI, 7 CR, 1 **false RWW**); 60 items unprofiled | understanding debt + compatibility evidence | profile coverage |
| 6 | Product identity & evidence | 🔴 | 63 candidate products; 100 candidates all `Needs Review`; 0 reviews | `compatibilityTarget`/`standard`/`category` demand; candidates never promoted | approve candidate + identity |
| 7 | Matching & technical approval | 🔴 | 10 runs all `Discovery Only`; `safety_approval_requests` = 0 ⇒ `APPROVED` selection unreachable | empty technical-approval path | 1st APPROVED primary selection |
| 8 | Architecture & sizing | 🟡 | Architecture v2 Active/`READY_FOR_STAGE4_BRIDGE` (both projects); **0 sizing snapshots**; SLC pool empty | capacity attributes absent; `added_slc_loops` universal gate; selection unapproved | 1 sizing snapshot |
| 9 | BOM & services | 🔴 | no BOM; `project_quotation_lines` NOT NULL product/service identity unreachable | no approved selection; service schema gap | BOM row + service path |
| 10 | Costing | 🔴 | 0 `pricing_cost_components`, 0 `pricing_lines` | no approved match/price owner | costing snapshot |
| 11 | Quotation | 🔴 | 0 revisions, 0 lines, 0 issues | upstream (matches→prices) | Draft quotation |
| 12 | Final approval & issue | 🔴 | approve unreachable (no commercial inputs); issue requires approved quotation **then** governed export (linear, verified) | upstream | Issued quotation |
| 13 | Excel export | 🔴 | 0 exports; requires Approved quotation + `approved_for_matching=1` profiles | upstream | governed export file |

---

## 3. Reconciled human-decision packet (acceptance project, current evidence)

Recomputed from live data; **historical "9 decisions / 11 debt / 3 reviews" not reused and not reproduced**. Understanding/requirement debt is grouped by root cause to avoid double counting consequence debt.

### 3.1 DETERMINISTIC SYSTEM ACTION — zero human required (12 items) 🟢
All 12 satisfy every guard of `applyUnderstandingSystemFieldAutoApproval` (source system = proposal system; family/category reproduced by the governed classifier); **0 field reviews recorded**; items are downstream-approved.

`boqitem_ea12a5ee` (F, Duct detector) · `889d28ef` (J, MCP) · `610420bb` (N, strobes) · `ac4b0997` (M, MCP) · `9ecdc2c1` (D, strobes) · `b4d74b26` (L, MCP) · `c31a3ca0` (M, MCP) · `409d7c57` (C, strobes) · `1a9b54b8` (M, MCP) · `5662e049` (B, MCP) · `4d2c8102` (H, MCP) · `cee9b4f8` (B, MCP) — all `system_value=Fire Alarm`, `approved_for_downstream=1`.

**Decision needed:** none. Run the existing field-auto-approval route, then regenerate their profiles. Unblocks 3 CR profiles + 9 currently-unprofiled items.

### 3.2 GENUINE HUMAN DECISION — 22 items + re-approval of 1 (23 items)
| Group | Items | Field | Current value | Evidence | Blocks | Class |
|---|---|---|---|---|---|---|
| Understanding whole-blob awaiting review | 22 | classification facts | AI proposal complete, never approved | `estimator_understanding_review_versions` AWAITING_REVIEW | understanding → profile | GENUINE HUMAN DECISION (review each) |
| `boqitem_5af0a8eb` (C, "Heat detector") — **false RWW** | 1 | whole-blob | profile v10 "Ready with Warnings"; payload `approved:false`; approval v2 stale vs interpretation v6 (fp `c7b7f249…` → `bbf27764…`); all 15 intelligence facts unapproved | reqprofile `bf292acd-3bbe-4b81-9e9c-2d69fec747b2` | unlocks readiness gate incorrectly; must be re-approved/re-profiles | GENUINE HUMAN DECISION + stale-artifact repair |

### 3.3 EVIDENCE RETRIEVAL (no decision needed — content must be produced)
| Group | Count | Detail | Blocks |
|---|---|---|---|
| Not-analyzed understanding | 42 | no interpretation row | understanding → profile |
| Failed attempts | 3 | `FAILED` analysis (retryable) | understanding |
| Capacity attributes (library) | ~16 aliases, **0 Approved** | `native_slc_loops`, `max_detectors_per_loop`, `max_modules_per_loop`, `max_system_points` never authored; `slc_loop_count` etc. all `Needs Review` | sizing gate 5e |
| Expansion evidence | 0 | `added_slc_loops` never authored (see §5) | sizing gate 5f |

### 3.4 Requirement review debt — 12 compatibility rows = **5 distinct pairs**
Owners all `Needs Review`/`Pending Approval` except 1 (`…requirement_197` job 2ee1d387, FlashScan/CLIP — `Approved`, `approved_for_downstream=1`); every compatibility row itself `Needs Review`.

| Pair (target) | Type | Owner status | Class |
|---|---|---|---|
| any detector mounting base | Compatible With | Needs Review ×3 | DETERMINISTICALLY REVIEWABLE (scope-specific; confirm + approve) |
| fire-fighter's telephone jack | Compatible With | Needs Review ×3 | DETERMINISTICALLY REVIEWABLE |
| mechanical fire protection equipment | Interface | Needs Review ×3 | HUMAN ENGINEERING REVIEW |
| FlashScan® and CLIP protocol systems | Compatible With | Needs Review (2 runs) | DETERMINISTICALLY REVIEWABLE |
| FlashScan and CLIP protocols | Compatible With | **Approved** (1 run) | INFORMATIONAL (dedupe/consolidate) |

Plus 300 `requirement_standards` rows (≈8 mandatory approved; ≈86 mandatory pending review) and 4 `requirement_intelligence_facts` standard facts (`Needs Review`) — human engineering review.

### 3.5 TECHNICAL DEFECT / OPERATIONAL (no decision):
- `approved_for_matching` **writer exists** but gate requires literal `Ready for Matching`; cascade emits it only when `confidence.overall ≥ 80` + mandatory baseline — never yet (0 rows). Downstream export requires `approved_for_matching=1`. → Dangling gate (fix: align gate with `Ready with Warnings`+approval, or produce the state).
- 6 of 10 match runs link to **superseded** profiles; 3 target the false-RWW item.
- `worker/product-matching-api.mjs:293` exposes **raw unapproved** interpretation on the read-only list endpoint (display gap; no engine impact).
- 1 profile `confidence.overall = 0` parked at RWW — one rung from the chain-unlocking gate while the same missing field is reported non-blocking.

### 3.6 NON-ACTIONABLE (derived): 60 unprofiled items — unblock automatically as 3.2/3.3 close; not separate debt.

**Explained current count:** the acceptance project's actionable core is **12 deterministic closures + 23 genuine human reviews (22 understanding + 1 re-approval) + 42 evidence retrievals + requirement review of 5 compatibility pairs / 4 standard facts**, everything else being consequence debt.

---

## 4. Closure backlog (deduplicated by root cause)

| ID | Root cause | Evidence level | Blocks stage | Type | Dependencies | Smallest action | Exit test | MVP? |
|---|---|---|---|---|---|---|---|---|
| M-1 | Field authority never applied | Project + source | Understanding→profile | Code run (no change) | none | Run `field-auto-approval` for the 12 items; regenerate | 12 rows CONFIRMED; readiness recomputed; field suite still green | **Yes** |
| M-2 | Understanding debt | Project | Understanding→profile | Human + evidence | M-1 | Review 22; re-analyze 42; retry 3 | all eligible items resolved | Yes |
| M-3 | `compatibilityTarget` evidence absent; owners unapproved | Project | MCI (22) + panels (7) | Human engineering | M-2 | Review 5 pairs + approve owners | `requirement_compatibility` approved rows ≥5; MCI count drops | Yes |
| M-4 | Profile coverage 60/90 | Project | requirements→matching | Derived | M-2 | (auto after M-2) | 90/90 current profiles | Yes |
| M-5 | Technical approval path empty (`safety_approval_requests`=0) | Project | matching Approval | Human/code | M-3, M-4 | engineer approves 1 selection via governed route | 1 `APPROVED` primary selection | Yes |
| M-6 | Candidates never promoted (100 `Needs Review`) | Project | matching | Evidence/human | M-3 | approve/reject candidates; promote | ≥1 `product_match_review` Approved | Yes |
| M-7 | Capacity attributes never authored | Project/library | sizing 5e | External evidence authoring | — | author Approved capacity rows from FireLite literature | gate 5e satisfiable for ≥1 product | Yes |
| M-8 | `added_slc_loops` universal vs conditional | Source | sizing 5f | Code defect | M-7 | align sizing gate parity with calculator (`requiredAdditionalLoops>0`) | gate demands expansion only when needed | Yes |
| M-9 | BOM + service line impossible by schema | Source | BOM/costing | Code/schema | M-5 | service commercial identity path (smallest governed model; do NOT null product_id) | service line row created | **Deferrable** (MVP hardware-only) |
| M-10 | Commercial tail (pricing→quotation→export) | Project | 11–13 | Derived + linear chain | M-5, M-6, M-9 | (auto after upstream) | Draft→Approve→Export→Issue | Yes (after upstream) |
| M-11 | Dangling `approved_for_matching` gate | Source | export | Code | M-4 | align gate label / produce state | export no longer blocked on fortune | Yes |
| D-1 | Stale artifacts (false RWW, stale match runs, raw interpretation display) | Project+source | readiness accuracy | Code/human | — | re-approve item C; regenerate runs; scope display fix | no stale RWW / runs | Yes (accuracy) |

Estimate discipline: no deadlines; effort only where scope inspected ⇒ M-1 is <1 h. M-7/M-8 need a manufacturer-capacity authoring pass (uncertain ±50%). Others sized qualitatively.

**Safe parallel work:** M-1 (code run) ∥ M-7 (library authoring) ∥ requirement-pair review (M-3) — independent. M-2/M-4/M-5/M-6 serial. M-9/M-10/M-11 depend on the above.

---

## 5. Sizing specific findings (Scope B reconciled)

- Architecture v2: 🟢 Active/current/usable in **both** projects (acceptance: `approvedArchitecture_795440e2…`, 128/9 facts, `COMPLETE`/`READY_FOR_STAGE4_BRIDGE`, 0 remaining engineer review).
- Physical panels: 7 Approved panel BOQ lines (qty 1), all `Missing Critical Information` on `compatibilityTarget`; selection `PROVISIONAL`×1 / `UNAVAILABLE`×6; **capacity evidence entirely absent** (0 Approved `product_attributes`; the 4 required names occur 0×; 0 sizing snapshots anywhere).
- Sizing prereq chain (read-only gate replay): architecture gate **passes**; allocation gate blocks (0/90 SLC-classifiable — SLC pool empty because 23 unresolved + 7 familyless + 60 unprofiled); panel gate blocks (`APPROVED` selection impossible by construction with 0 `safety_approval_requests`); capacity gate unsatisfiable for every product; expansion gate unsatisfiable (`added_slc_loops`=0).
- **Expansion:** `added_slc_loops` is **unconditionally demanded** by the sizing gate (`loadExpansionPath`/`validatePanelDependency`) while the calculator only needs it when `requiredAdditionalLoops > 0` — **contradictory contracts**. Whether expansion is actually required is **UNDETERMINED** (needs a capacity ceiling + device→loop allocation; neither exists). Architecture already records 24 loops vs ~271 classified device units (~11/loop) — could go either way.
- Hermetic Drawing→Architecture: hermetic tests faithfully cover the implemented journey (review→v1→adjudicate→v2→bridge→stage4); they are **not** "ahead of production" — the real project executes the same journey at larger scale. The genuine missing link is **geometry→cluster→quantity coverage→BOQ allocation**, which is unbuilt *in the system by design* (drawings never produce device quantities) and untested. 128 approved architecture rows carry `structure_version_id=''` (by design; text-token legend binding, 16 governed abbreviations from one AMS T-00 document anchor all 11 documents).

---

## 6. Recommended next execution slice (exactly one — NOT started)

**Scope/owner/change/verification/stop condition:**
- **Slice:** M-1 — run the existing deterministic field auto-approval on the 12 eligible acceptance items (`field-auto-approval` route), then regenerate the affected requirement profiles via the canonical route.
- **Owner:** single primary agent (permissioned runner) executing the existing governed route; no new code.
- **Expected change:** 12 `estimator_understanding_field_reviews` rows (system/category/productFamily), ~10–20 min later 12 regenerated profiles; 3 CR profiles and 9 unprofiled items advance; measure readiness delta (expect MCI 22→≥22, CR 7→≤7, RWW stays 1).
- **Verification:** field-review suite still 12/12; golden gate passes; DB integrity + FK check stay clean; per-item pair-check (`system=Fire Alarm`, family governed, provenance `Approved AI Understanding`).
- **Stop condition:** all 12 applied and 0 new false passes — then report and wait (do not cascade into M-2/M-3 without instruction).

---

## 7. Acceptance gates (proposed, not executed)

1. **Hermetic Golden E2E** — full pipeline in isolated env (no real project): commitment only on existing `test:e2e:golden` + `fire-alarm-golden` + `cctv-golden` + `understanding-field-review-authority` (12/12) suites, on a clean checkout (current dirty tree means suite success ≠ current-tree proof).
2. **Real Al Mousa journey** — project `c0123d91`: 90/90 items resolved → 90/90 current profiles → ≥5 compatibility pairs approved → ≥1 APPROVED primary selection → 1 sizing snapshot → BOM row → pricing snapshot → **Draft quotation** → Governed export → Issued. Human decisions via supported UI only; zero direct SQL.
3. **Engineer-facing UI usability** — Playwright walkthrough of the same journey through UI only (both projects), capturing the 3 flagged display/permission gaps (`product-matching-api:293` raw interpretation, requirement-approval roles, audit `Administrator` hardcode, export role gate).
4. **Operational readiness** — DB integrity + FK clean after each run; migration chain complete and applied; single listener; audit trail actor fields correct; `approved_for_matching` no longer a fortune-telling gate.

---

## 8. MVP exclusions & deferred improvements

- **Service commercial lines** (Testing/Commissioning class) — schema-cannot-represent today; defer to a smallest governed service identity (never null `product_id` with no replacement).
- **Drawing-derived device quantities** — geometry→cluster→quantity chain unbuilt by design; deferred; BOQ remains quantity authority (no R4-style inference).
- **Multi-discipline** — audit intentionally restricted to Fire Alarm journey.
- **Export issuance UX polish, per-scope margin presets, FX engine** — FX policy stays SAR passthrough / USD ×3.75 / other→review (no generic engine; price-expiry is informational, not a blocker — preserved).

---

## 9. Evidence limitations

- All DB facts are read-only snapshots (some from `/tmp` copies due to WAL contention); live server PID 66503 verified on `:4183`; no state changed.
- Three subagent scopes (A/B/C) supplied findings; primary agent re-probed headline claims (approved_for_matching writer, compatibility row triplication, quotation-issue linearity, field-eligible item set, false-RWW payload) — each correction is marked.
- No tests, snapshots, or E2E executed during this audit (mutating endpoints prohibited).
- If concurrent work changed Understanding/requirement/scoring state after this snapshot, the affected scope is the readiness + `estimator_understanding_*` tables on `c0123d91`; recheck before executing M-1.
- `drizzle.__drizzle_migrations` absent — migration-tracking mechanism not investigated 🔵.

---

STOPPED — MVP-CLOSE-0 complete; no implementation or business-state mutations performed.