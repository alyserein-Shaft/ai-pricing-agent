# MVP-CLOSE-2 — Read-Only Evidence Packet for the 12 Newly Classified Items

**Slice:** Produce a read-only evidence packet for the 12 BOQ items reclassified in the acceptance project `project_c0123d91-c30b-4956-87cb-e473ef53f89d` (Al Mousa School, 2026-09-14). Per-item blocker/evidence/action table, grouped root causes, report corrections, and exactly one recommended next slice. **No source/schema/config changes, no approvals, no fact insertion, no linking, no regeneration, no analysis retries, no business-state mutations, no direct SQL writes.** Shared dirty tree preserved; only this report is written.

---

## 1. Identity, time, evidence base

- Repository: `main` (unchanged throughout; no commits made). Dev runtime: single node listener PID **66503** on `:4183` — observed only, not restarted.
- Observation window: 2026-09-28 (today), read-only evidence sweep over the live DB `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/…/*.sqlite` (`PRAGMA query_only=ON;` + `.timeout 30000`) and the canonical live summary `GET :4183/api/projects/…/estimator-understanding-review`.
- Frozen inputs (verified): interpretations `MAX(created_at)=2026-09-20 19:54:16`, review versions `MAX=19:54:41`, requirement links `MAX=19:16:29`; `0` interpretations created on/after 2026-09-27; `0` understanding-analysis runs on 09-28.
- Prior slices referenced: `docs/MVP-CLOSE-0-CURRENT-STATE-AND-CLOSURE-PLAN.md`, `docs/MVP-CLOSE-1-FIELD-AUTHORITY-ACCEPTANCE-RUN.md`. No technical/commercial audit-agent reports were found on disk to reference (see §6); `docs/MVP-AUDIT-TECH-REPORT.md` is a pre-existing, unrelated audit.
- Severity labels follow the project's separation: **Project Evidence** (rows in the acceptance DB), **External Evidence** (authoritative standards only — none researched here; not needed), **Inference** (derivation reasoning, labeled as such).

## 2. Canonical queue state (live)

| Metric | Value | Evidence |
|---|---|---|
| awaitingReview | **20** | live summary `summarizeUnderstandingReviewItems` (derived, never stored) |
| approved | **18** | derived `reviewMatchesEffective` on stored versions |
| rejected | 0 | derived |
| failed | **10** | derived (latest current-config attempt FAILED) |
| aiUnavailable | 0 | derived |
| notAnalyzed | 42 | derived (no interpretation row) |
| revalidationRequired | 0 | derived |
| aiAttempted / aiAnalyzed | 48 / 48 | derived |
| extractionConfirmed | 90 | extracted BOQ rows, all `approved_for_downstream=1` |
| currentRun | CONTROLLED_PILOT COMPLETED 2026-09-20 19:54:16, config `6fb54e06…` | `estimator_understanding_runs` |

Sum check: 20 + 18 + 10 + 42 = 90 items. ✓

## 3. Per-item table (all 12)

Profiles cited: current (`superseded_at IS NULL`) `requirement_profile_versions` for each item. All 12 items: extraction `review_status=Approved`, `approved_for_downstream=1`, system Fire Alarm, source `doc_624df96f` (BOQ.xlsx). All 12 profiles: `status=Needs Review`, `applicableRequirements=0`, `suggestedRequirements=0`.

| # | Item | Row | Qty | Profile ver | Readiness (profile engine) | Canonical review status | Blocker evidence (Profile/Project Evidence) | Yield |
|---|---|---|---|---|---|---|---|---|
| 1 | F — Duct detector | 21 | 13 | v2 | MCI — *Missing Critical Information* | **FAILED** | `readiness.blockingReasons=["compatibilityTarget is required to define a safe Fire Alarm product search boundary."]`; 0 Confirmed links; 3 Suggested links **superseded** `2026-09-20T14:44:35Z` (`Technical Applicability v2 · bounded shortlist`, evidence `basis: ["Same engineering system (+8)","Equipment type unresolved (+0)",…]`) | Approved requirement `…_requirement_207` ("air duct smoke detector shall be an intelligent, non-relay photoelectric type…") exists, **Approved, adv=1, zero links to any BOQ item** |
| 2 | J — Fire alarm manual station (weather proof) | 27 | 10 | v2 | MCI — *Missing Critical Information* | **FAILED** | same `compatibilityTarget` blocker; 0 Confirmed links; 0 links total | Approved FA reqs: **0 mention MCP**; MCP requirement text exists in spec as Needs Review only |
| 3 | N — Loop powered strobes | 35 | 97 | v2 | NTR — *Needs Technical Review* | **FAILED** | `readiness.blockingReasons=["No confirmed mandatory technical baseline exists."]`; 0 links | Approved FA reqs: **0 mention strobe/notification appliances**; strobe compatibility/sync needs external baseline (UL 1971 / NFPA 72 §18) — not approved in project |
| 4 | M — Fire alarm manual station (weather proof) | 75 | 8 | v1 | MCI — *Missing Critical Information* | **AWAITING_REVIEW** | `compatibilityTarget` blocker; 0 links/facts/applicability | MCP requirement text (break-glass, electrical compatibility) exists as Needs Review only |
| 5 | D — Loop powered strobes | 86 | 101 | v1 | NTR — *Needs Technical Review* | **AWAITING_REVIEW** | no confirmed mandatory baseline; 0 links | No approved strobe requirement text |
| 6 | L — Fire alarm manual station | 117 | 33 | v1 | MCI — *Missing Critical Information* | **AWAITING_REVIEW** | `compatibilityTarget` blocker; 0 links | MCP requirement text unapproved; contrast: L row73 manual station **approved** (ver 1, match true) |
| 7 | M — Fire alarm manual station (weather proof) | 119 | 8 | v1 | MCI — *Missing Critical Information* | **AWAITING_REVIEW** | `compatibilityTarget` blocker; 0 links | MCP requirement text unapproved |
| 8 | C — Loop powered strobes | 129 | 101 | v1 | NTR — *Needs Technical Review* | **AWAITING_REVIEW** | no confirmed mandatory baseline; 0 links | No approved strobe requirement text |
| 9 | M — Fire alarm manual station (weather proof) | 160 | 2 | v1 | MCI — *Missing Critical Information* | **AWAITING_REVIEW** | `compatibilityTarget` blocker; 0 links | MCP requirement text unapproved |
| 10 | B — Fire alarm manual station (weather proof) | 191 | 5 | v1 | MCI — *Missing Critical Information* | **AWAITING_REVIEW** | `compatibilityTarget` blocker; 0 links | MCP requirement text unapproved |
| 11 | H — Fire alarm manual station (weather proof) | 205 | 2 | v1 | MCI — *Missing Critical Information* | **AWAITING_REVIEW** | `compatibilityTarget` blocker; 0 links | MCP requirement text unapproved |
| 12 | B — Fire alarm manual station (weather proof) | 221 | 4 | v1 | MCI — *Missing Critical Information* | **AWAITING_REVIEW** | `compatibilityTarget` blocker; 0 links | MCP requirement text unapproved |

Queue membership of the 12 (exact, canonical derived summary): **9 in awaiting-20** — B191, B221, C129, D86, H205, L117, M75, M119, M160; **3 FAILED (not awaiting)** — F21, J27, N35.

Per-item corroborating evidence (all 12, Project Evidence):
- `requirement_intelligence_facts` rows for the 12 current profiles: **0**. Project-wide only 8 profiles hold facts, and all 8 are versions of the stale item C row15 (`boqitem_5af0a8eb`) — not the 12.
- `engineering_facts` scoped to acceptance: **0 rows** (table empty for this project).
- `profile_requirement_applicability`: all **15** acceptance rows belong to `5af0a8eb` versions (v3–v10); **0** for the 12.
- `boq_requirement_links`: project-wide `Confirmed=4` (all on `5af0a8eb`), `Needs Review=8`, `Suggested=92`; the 12 have **zero** Confirmed links; only F has 3 superseded Suggested rows (above).
- `requirement_missing_information`: **0 rows** scoped to this project (62 rows global, other projects). The MCI blocker is therefore **not** a stored clarification row — it is computed per-item by `detectMissingInformation` / `fireAlarmRequiresPanelCompatibility` in the profile engine (Inference: blocker origin = profile readiness computation, not `requirement_missing_information`).
- Field-authority history (MVP-CLOSE-1): 36 field rows, 3 per item (`category`, `productFamily`, `system`), all `CONFIRMED` by `system:deterministic-understanding-policy`, `reviewed_by=local-development-user`, 09-28 10:44:47–49Z. These are **field-level** confirmations; they do not create whole-blob review versions and did not change the derived queue status.

## 4. Grouped root causes (with traceability)

### G1 — Zero confirmed-requirement sources (all 12)
`worker/technical-requirement-api.mjs` `loadInputs` (:86–88) admits requirement sources **only** via `boq_requirement_links` rows that are `superseded_at IS NULL AND status='Confirmed'`, joined to **current** requirements with `approved_for_downstream=1`. None of the 12 has a Confirmed link →
`applicableRequirements=0` for all 12 → profile explanation "0 requirement sources are confirmed applicable" on every one of the 12 current profiles.
Evidence: links census (0 Confirmed on the 12; 4 project-wide, all on `5af0a8eb`); per-profile JSON `applicableRequirements:0`.

### G2 — Approved requirement text exists but was never linked (F strongest; MCP/strobe weaker)
- **F**: the exact requirement `specjob_76af1f32-58f6-45da-a16c-233e4c753d9b_chunk_000001_requirement_207` ("air duct smoke detector shall be an intelligent, non-relay photoelectric type…") is **Approved, `approved_for_downstream=1`** and the only approved requirement in the project specifically covering duct smoke detection — yet it has **zero** links to any BOQ item. The bounded shortlist only ever minted Suggested links (`Equipment type unresolved (+0)` → never eligible for auto-confirmation) and superseded them 09-20.
- **MCP family (B×2, H, J, L, M×3)**: approved FA requirements mentioning MCP/manual call points: **0** (only 5 approved FA reqs mention "detector"; none mention MCP/strobe/notification). The manual-call-point text present in the master spec ("break glass type…", "electrically compatible with the standard range of automatic detectors…") is **Needs Review / Pending Approval** only → nothing to Confirmed-link even if the shortlist ran.
- **Strobes (C, D, N)**: approved FA requirements containing strobe/notification-appliance keywords: **0**. NTR status "No confirmed mandatory technical baseline exists" is accurate under the canonical gate.

### G3 — Compatibility evidence exists but its owner requirements are unapproved (MCI `compatibilityTarget`)
`requirement_compatibility` scoped to acceptance: **12 rows / 5 distinct pairs**, of which **11 owner requirements are Needs Review/Pending Approval** and only 1 is Approved (`specjob_2ee1d387…` "high-temperature model… Compatible With Flash Scan® and CLIP protocol systems", adv=1). The "any detector mounting base" pair is triplicated (3 owner requirements from 3 extraction jobs). Because `loadInputs` pulls compatibility content only under a Confirmed link + Approved owner, the MCI items cannot resolve `compatibilityTarget` → the `fireAlarmRequiresPanelCompatibility` fail-closed gate (Missing Critical Information) holds for all 9 MCI items.
(Inference, not resolved here: the single Approved compatibility owner row itself is `Needs Review` at the row level (`c.review_status=Needs Review`), while the load path treats "Confirmed link + Approved requirement" as the whole approval — see comment at `technical-requirement-api.mjs:116–124`. This is by documented design, not flagged as a defect in this slice.)

### G4 — F/J/N canonical FAILED is a config-currency artifact (observed, not fully resolved)
F/J/N have profile v2 (MCI/NTR) yet canonical review status **FAILED**. Interpretation histories (Project Evidence):
- v1 09-14 COMPLETED/NEEDS_REVIEW; v2 09-20 13:36:21 **FAILED** (`AI_PROVIDER_ERROR`, input fp e.g. `5e781f0c`, **config `6fb54e06`** = current config); v3 09-20 13:45 PER_ITEM_RETRY COMPLETED/NEEDS_REVIEW with **different config fingerprints** (`1ac6a0bb` / `4f90aea1` / `cd9b755a`).
- `resolveEffectiveUnderstandingInterpretation` (`worker/effective-understanding-interpretation.mjs:48`, filter at :51–53) selects only interpretations matching the **current** config fingerprint; for all three items the only current-config attempt is the FAILED v2 → state `UNAVAILABLE_OR_STALE` → canonical FAILED.
- MVP-CLOSE-1's field-auto-approval nevertheless bound field rows to those interpretations (input fingerprints match the non-current v3 rows). **Inference:** field-authority eligibility and the canonical review summary measure effective availability differently (config-currency). This is a observed derivation nuance, flagged; **not** asserted as a defect (§6).

### Contrast (pipeline works elsewhere)
J row69 Duct detector, L row73 manual station, K row71 etc. are canonical **approved** (ver 1, `match=true`) — the approve→profile→match path functions; the 12 are blocked at requirement-source/linkage + (MCI) compatibility evidence, not at the approval pipeline itself.

## 5. Report corrections (evidence-based)

1. **Historical "22 (or 23) awaiting review" vs current 20.** MVP-CLOSE-0 reported 22 approved / 23 awaiting / 42 not-analyzed / 3 failed (§3.2 "22 items + re-approval of 1 (23 items)"). Canonical derived summary today = **20 awaiting / 18 approved / 10 failed / 42 not-analyzed** (90 ✓ both ways). Because all derivation inputs are frozen since 09-20 19:54 (interpretations, review versions, links; config `6fb54e06`), the canonical function at MVP-CLOSE-0 time would have produced the same 20/18/10/42. The historical 22/23/3 therefore came from a **non-canonical counting definition** — most plausibly treating the stale C row15 heat-detector re-approval separately ("22 + 1") and a narrower "3 failed" bucket. **Exact historical membership is unreconstructable** (only aggregates were recorded) → marked **unresolved**. Current membership is exact (§2, §3). Note the "re-approval of 1" item (`boqitem_5af0a8eb`, C row15 heat detector, stored ver 2, `match=false`) **is inside** the current awaiting-20 — counted once, not twice.
2. **Item counts vs review-version counts.** 90 extracted items vs **24 stored review-version rows across 23 distinct items** (item C row15 has 2 stored versions), all `APPROVED`, of which **18 currently match** the effective interpretation (derived approved=18). "Awaiting review" is a **derived** status (`effective.state=AVAILABLE` and not `reviewMatchesEffective`), never a stored row — counting stored versions yields 24 rows/23 items, not 20 awaiting.
3. **"No new runs."** MVP-CLOSE-1's "no new interpretations or runs" holds for **understanding analysis** (0 interpretation rows ≥09-27; 0 understanding runs on 09-28) but is **incorrect as stated** for requirement-profile processing: `document_processing_runs` shows **13 runs created 09-28 10:45:09–10:46:06** — 12 runs producing the 12 current profiles (stage=Completed, status=Needs Review) + 1 idempotent retry-recalc probe `job_fc42ea99` 10:46:06 (stage=Completed, status=Completed, no new version). Correction: 0 new understanding/interpretation activity; 13 new requirement-profile processing runs (12 + 1 idempotent).
4. **"Zero human-review overlap" is wrong.** MVP-CLOSE-1 claimed the 12 items do not overlap the 20-item awaiting queue because they have no stored review versions. Awaiting is **derived**, and exact membership shows **9 of the 12 ARE members of the awaiting-20** (B191, B221, C129, D86, H205, L117, M75, M119, M160). F/J/N are the 3 not in awaiting — they are FAILED, not absent. Corrected statement: 9/12 in awaiting-20, 3/12 in failed-10.
5. **`requirement_compatibility` counts.** MVP-CLOSE-0's "12 compatibility rows (5 distinct pairs)" is **correct for the project scope** (verified: 12 rows, 5 pairs, 11 unapproved owners + 1 approved). Table-wide the table holds **183 rows / 181 distinct owners / only 3 approved owners** — the "only 12 rows" phrasing was project-scoped; any later table-wide reading must use the global numbers.

## 6. Evidence limitations

- **Historical queue membership (22/23/3): unreconstructable** — only aggregates were recorded; canonical derivation (frozen inputs) yields 20/18/10/42 for both 09-27 and today. Marked unresolved, not asserted.
- **F/J/N FAILED vs field-approval binding**: config-currency artifact observed at the resolver level; the exact eligibility decision path used by the MVP-CLOSE-1 field-authority route (which accepted non-current-config interpretations) vs the canonical summary's current-config filter has **not** been fully traced in code. Candidate for a future **E** (suspected-defect) case only after reproduction — **not proven here**.
- **External evidence**: none researched. No unresolved question in this packet mandated authoritative external sourcing; strobe sync (UL 1971 / NFPA 72 §18) and panel-protocol compatibility (Flash Scan/CLIP names appear in the project's own compatibility rows) are named as **candidates** only.
- **Parallel audits**: no technical/commercial audit reports for this project exist on disk in `docs/` to reference; only MVP-CLOSE-0/1 and pre-existing historical documents.
- **`requirement_missing_information`** is unrelated to the 12 (0 rows project-wide); MCI blockers are computed by the profile engine, not read from that table.

## 7. Recommended next slice (exactly one — NOT executed)

**Slice: "Confirmed-link + profile regeneration for item F (Duct detector, row 21, `boqitem_ea12a5ee…`)"**

- **Rationale**: the only one of the 12 with an **already-Approved, downstream-approved** requirement that directly covers its item text (`…_requirement_207`, adv=1); the blocker is pure linkage (`0 Confirmed links; shortlist produced only superseded Suggests`). Smallest complete loop that converts a blocked item into evidence-driven, with no requirement-approval decision required.
- **Named items**: F → `boqitem_ea12a5ee-866f-45db-91a1-621119569551` (row 21, qty 13).
- **Permitted writes** (and nothing else):
  1. Create a `boq_requirement_links` row `boqreqlink_*` F(generated) → `…_requirement_207`, `status='Confirmed'`, `link_method='Technical Applicability v2 · bounded shortlist'` (or the governed route the engine already uses), `reviewed_by=local-development-user`, `version_number=1`, via the existing governed link route (same authority path exercised in MVP-CLOSE-1; PID 66503, all owner/org gates pass).
  2. Regenerate F's requirement profile → v3 via the canonical profile route (identical to the 12 regenerations at 10:45:09–11Z).
- **Forbidden in this slice**: any change to interpretations, review versions, other 11 items, facts, approvals, matching, pricing, or any table beyond the two writes above. No restarts/commits/pushes.
- **Authority basis**: existing governed link + profile-regeneration routes (owner org `organization_bd_shaft_internal_pilot`, resolving to `local-development-user`); requirement `…_requirement_207` already Approved with `approved_for_downstream=1`; no new human decision required. This is class **B** (evidence exists, linkage missing) with the shortlist's `Equipment type unresolved (+0)` gate noted as a possible **E**-flagged candidate (needs proof; not claimed).
- **Exit checks** (all must pass):
  - F's v3 profile shows `applicableRequirements ≥ 1` containing `…_requirement_207` text.
  - F readiness leaves `Missing Critical Information` (no `compatibilityTarget` blocking reason pressed when a Detection-Devices requirement source is confirmed).
  - No new interpretations/runs; no other items' profiles or statuses change; derived queue totals unchanged except F's blocker reason.
  - `git status` shows only this report + F's link/profile writes (no schema/config/source changes).
- **Class**: **B** (recommend execution); **E** flag recorded for the shortlist's failure to ever Confirmed-link an obviously applicable Approved requirement (proof deferred).
- NOT executed in this slice. Decision-gated follow-ups (approving MCP/strobe requirement sources for the other 11) are deliberately out of scope for this recommendation.

---

STOPPED — MVP-CLOSE-2 evidence packet complete; no business-state changes.