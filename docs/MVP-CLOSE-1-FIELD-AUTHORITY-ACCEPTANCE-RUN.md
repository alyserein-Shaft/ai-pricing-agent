# MVP-CLOSE-1 — Deterministic Field Authority Applied to the Acceptance Project

**Slice:** Execute the existing governed deterministic field-auto-approval on the 12 eligible BOQ items in the acceptance project `project_c0123d91-c30b-4956-87cb-e473ef53f89d` (Al Mousa School, 2026-09-14), then regenerate their affected requirement profiles through the canonical supported route. Verify, retry-idempotency-probe, and report.

---

## 1. Identity, time, and evidence base

- Repository: `main` @ `029b426` (unchanged throughout this slice).
- Dev runtime: single node listener PID **66503** on `:4183` (verified before, during, and after; not restarted). Local single-user context resolves to `local-development-user` / `organization_bd_shaft_internal_pilot` — identical to the acceptance project's owner/org, so the governed routes' ownership gates passed for every write.
- Observation window: field decisions written `2026-09-28T10:44:47Z`–`10:44:49Z`; profile regeneration committed `10:45:09Z`–`10:45:11Z`; final verification `10:46:46Z`.
- Evidence base: live SQLite at `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/…/*.sqlite`, read with `PRAGMA query_only=ON` and `.timeout 30000`; read-only snapshot `/tmp/mvpclose1-snapshot.sqlite` (`quick_check: ok`) used for the pre-write eligibility dry-run.
- Plan/authorization backing: `docs/MVP-CLOSE-0-CURRENT-STATE-AND-CLOSURE-PLAN.md` (M-1 as the single next slice, executed as MVP-CLOSE-1).

## 2. Eligibility recheck before writing (read-only)

- The 12 abbreviated item prefixes were resolved to exactly 12 exact `boqitem_*` IDs in `c0123d91` only (0 rows elsewhere in the DB).
- A write-blocking dry-run (`/tmp/mvpclose1-dryrun.mjs`) executed the real modules — `loadUnderstandingReviewRows` + `classifyFireAlarmFamilyFromText` — with the exact policy guards. **All 12 were ELIGIBLE**; each item's effective interpretation resolves to a proposal whose `system=Fire Alarm`, `category`, and `productFamily` match the deterministic fire-alarm classifier and the section-derived `system_value`; no item has a whole-blob `APPROVED` review version; all are current evidence rows (`Approved`, `approved_for_downstream=1`, `row_type='BOQ Item'`).
- Live re-read immediately before the first write confirmed identical interpretation IDs + `input_fingerprint`s (no concurrent re-analysis changed evidence between snapshot and write):
  - e.g. B `understanding_4ac25a55…`/fp `a61d14e1…`, F `understanding_6535d479…`/fp `5e781f0c…`, N `understanding_…`/fp `70041277…`.
- Concurrency/ownership: single listener; the route re-verified ownership + currentness on every POST; all 12 returned `200 applied`.

## 3. Writes executed (governed routes only, primary agent)

### 3.1 Field-auto-approval (36 decisions)

Sequential `POST /api/boq-items/{id}/estimator-understanding-review/field-auto-approval` for the 12 items:

| # | item | letter | HTTP | applied | system | category | productFamily |
|---|------|--------|------|---------|--------|----------|---------------|
| 1 | `boqitem_5662e049-c0aa-4db7-8592-c10cecef6530` | B | 200 | ✅ | Fire Alarm | Manual Initiation | Manual Call Point |
| 2 | `boqitem_cee9b4f8-4940-4dad-9d04-7b7531a5c5f5` | B | 200 | ✅ | Fire Alarm | Manual Initiation | Manual Call Point |
| 3 | `boqitem_409d7c57-6fad-4318-97ce-378ac63a5293` | C | 200 | ✅ | Fire Alarm | Notification Devices | Strobe |
| 4 | `boqitem_9ecdc2c1-8a64-4ac2-b7e9-61196d16ef64` | D | 200 | ✅ | Fire Alarm | Notification Devices | Strobe |
| 5 | `boqitem_ea12a5ee-866f-45db-91a1-621119569551` | F | 200 | ✅ | Fire Alarm | Detection Devices | Duct Detector |
| 6 | `boqitem_4d2c8102-b7bc-4fef-a67e-282045d8910f` | H | 200 | ✅ | Fire Alarm | Manual Initiation | Manual Call Point |
| 7 | `boqitem_889d28ef-4b42-47b9-ad5b-d698787f9120` | J | 200 | ✅ | Fire Alarm | Manual Initiation | Manual Call Point |
| 8 | `boqitem_b4d74b26-c777-436b-9230-e1830b7cdeb0` | L | 200 | ✅ | Fire Alarm | Manual Initiation | Manual Call Point |
| 9 | `boqitem_ac4b0997-0b50-4512-bbf0-92aee3dae38d` | M | 200 | ✅ | Fire Alarm | Manual Initiation | Manual Call Point |
| 10 | `boqitem_c31a3ca0-81b3-4e78-97fa-ab696ea301ef` | M | 200 | ✅ | Fire Alarm | Manual Initiation | Manual Call Point |
| 11 | `boqitem_1a9b54b8-5feb-4051-8838-a4ee200d81e2` | M | 200 | ✅ | Fire Alarm | Manual Initiation | Manual Call Point |
| 12 | `boqitem_610420bb-5b06-47df-ac79-3e60c40901c3` | N | 200 | ✅ | Fire Alarm | Notification Devices | Strobe |

**Results:** `applied=12/12`, `confirmedFields=36` (3 per item). **Decisions: 36 inserted, 0 reused, 0 refused.** No skips — all 12 remained eligible at write time. All 36 rows are:
- `decision='CONFIRMED'`, `origin='INFERRED'` only for the three classification keys (`system`, `category`, `productFamily`);
- bound to the exact current interpretation id + `source_input_fingerprint` (verified equal to the interpretation's `input_fingerprint`);
- recorded by the governed non-human actor `system:deterministic-understanding-field-confirmation`, `policy_version=understanding-field-auto-confirm-1.0.0`.

No whole-blob interpretation approval, no manufacturer/standard/compatibility/environmental/technical facts, and no `approved_for_matching` were written.

### 3.2 Requirement-profile regeneration (canonical route, 12 items)

`POST /api/boq-items/{id}/requirement-profile/generate|recalculate` (202 Queued → engine completes asynchronously; the route does **not** auto-regenerate — verified in source before issuing). 3 items with an existing current profile (`F`, `J`, `N`) were `recalculate`d; the 9 without a profile (`B,B,C,D,H,L,M,M,M`) were `generate`d through the same governed engine (`executeRequirementProfile`, `REQUIREMENT_RULESET_VERSION`).

All 12 runs completed (stage `Completed`, progress 100; `document_processing_runs` ids `job_193570ef…`, `job_8df3ef27…`, `job_51c2ab4c…`, `job_e2f4e751…`, `job_6c9806ce…`, `job_ff90b1e8…`, `job_e92aec8d…`, `job_1ed7773c…`, `job_b585327b…`, `job_5446972d…`, `job_b10e8d6e…`, `job_4e9b057c…`).

## 4. Before / after per item

| item | letter | before profile | before field rows | after profile (v) | after readiness | after field rows |
|------|--------|----------------|-------------------|-------------------|-----------------|------------------|
| `5662e049…` | B | (none) | 0 | v1 | Missing Critical Information | 3 |
| `cee9b4f8…` | B | (none) | 0 | v1 | Missing Critical Information | 3 |
| `409d7c57…` | C | (none) | 0 | v1 | Needs Technical Review | 3 |
| `9ecdc2c1…` | D | (none) | 0 | v1 | Needs Technical Review | 3 |
| `ea12a5ee…` | F | Classification Required v1 | 0 | **v2** (v1 superseded) | Missing Critical Information | 3 |
| `4d2c8102…` | H | (none) | 0 | v1 | Missing Critical Information | 3 |
| `889d28ef…` | J | Classification Required v1 | 0 | **v2** (v1 superseded) | Missing Critical Information | 3 |
| `b4d74b26…` | L | (none) | 0 | v1 | Missing Critical Information | 3 |
| `ac4b0997…` | M | (none) | 0 | v1 | Missing Critical Information | 3 |
| `c31a3ca0…` | M | (none) | 0 | v1 | Missing Critical Information | 3 |
| `1a9b54b8…` | M | (none) | 0 | v1 | Missing Critical Information | 3 |
| `610420bb…` | N | Classification Required v1 | 0 | **v2** (v1 superseded) | Needs Technical Review | 3 |

## 5. Profile / readiness deltas (project-wide, acceptance)

| metric | before | after | delta |
|--------|--------|-------|-------|
| profiled current items | 30 | 39 | +9 |
| Missing Critical Information | 22 | 31 | +9 |
| Classification Required | 7 | 4 | −3 |
| Needs Technical Review | 0 | 3 | +3 |
| Ready with Warnings | 1 | 1 | 0 |
| approved_for_matching | 0 | 0 | 0 |

All 12 now have current profiles; the 3 previously stuck at Classification Required advanced to real readiness (F, J → MCI; N → NTR). The additional 9 MCI and exposure of 3 NTR profiles surface **existing** missing/requiring-review facts — this is the correct, expected exposure, not a regression. Profile input fingerprints changed (e.g. F: `66cab2a4…`→`d1a0cbce…`), confirming the confirmed classification flowed into the profile.

## 6. Retry-idempotency probe (one successful item)

Re-ran `field-auto-approval` on item F (`ea12a5ee…`): returned `applied:true`, all 3 results `idempotent:true`, same `factId`s. DB confirmed **field rows still 36** (no duplicates) and no new interpretation/runs. Re-ran `requirement-profile/recalculate` on F: queued a new run (idempotent engine) and **no new profile version** — F still has exactly v1 (superseded CR) + v2 (current MCI). No redundant versions.

## 7. Tests, integrity, isolation, concurrency

- `node --test tests/understanding-field-review-authority.test.mjs` (in isolation, no live DB): **12/12 pass, 0 fail**, duration ~884 ms — on the current source snapshot.
- Live `PRAGMA integrity_check` → `ok`; `PRAGMA foreign_key_check` → 0 rows; field-review orphans (no interpretation / no item) → 0, 0.
- **False-RWW item `boqitem_5af0a8eb…722` observed only, untouched:** still `Approved`, profile v10 `Ready with Warnings` current. No false pass introduced anywhere.
- **Clean Golden Run `project_ae501b85…` untouched:** field reviews 51, current profiles 82, understanding review versions 31 (all unchanged); no writes targeted it.
- Acceptance whole-blob review versions still 24 (`APPROVED`), `approved_for_matching` = 0 project-wide and 0 for the 12; `approved_for_downstream` maintained on all 12.
- No new interpretations or runs were created by this slice (interpretation table rows with today's timestamp: 0).
- Human-review overlap: **zero**. The 12 items have no understanding review versions at all (they were never whole-blob reviewed), so they do not overlap the reported awaiting-review queue (20 awaiting per the review summary) or the 1 re-approval item (`5af0a8eb`). The remaining 20 awaiting whole-blob reviews were not touched.

## 8. Blockers exposed (not resolved) and remaining scope

- 9 of the 12 now show **MCI** and 3 show **Needs Technical Review** — the specific missing facts are exposed per profile and remain for the governed technical-review paths.
- Matching eligibility is still **not** granted anywhere (`approved_for_matching` = 0; readiness gate never produced the literal `Ready for Matching` status).
- The stale `Ready with Warnings` on `boqitem_5af0a8eb` remains (observed only, per authorization).
- SAR passthrough / USD×3.75 / other-currency review / informational price-expiry policy: untouched and unaffected by this slice.
- Full acceptance still requires all in-scope quotation items to be covered; services remain in scope per the retained planning corrections (no scope redefinition here).

## 9. Governance statements

- **No source code, schema, migration, policy, or configuration changes.**
- **No human approvals were created or performed.**
- **No direct SQL writes** — every mutation went through the governed HTTP routes with their ownership + CAS/currentness guards.
- **No commits, pushes, deploys, stashes, resets, or cleans.**
- Working tree remains exactly at the pre-existing dirty state (737 entries, 736 pre-existing + the MVP-CLOSE-0 report from the prior slice; nothing new tracked by this session).
- Server PID 66503 not restarted.

## Recommended next slice (not executed)

**M-2 — Mechanical profile-requirement completion for the 9 newly-MCI acceptance items:** for each item whose current profile reports MCI, enumerate the missing facts grouped by origin (source without requirement vs. unresolvable knowledge), then run the existing governed spec-resolution / fact-entry path on the source-backed subset only, leaving genuinely unresolvable facts as review items. Bounded to the acceptance project; keeps the same review/readiness transparency model. (M-2 closes only the MCI on items whose facts are derivable; it must not re-open the matching gate.)

---

STOPPED — MVP-CLOSE-1 complete.