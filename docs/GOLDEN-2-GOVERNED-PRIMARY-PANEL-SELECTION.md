# GOLDEN-2 — Governed Primary Panel Selection Prerequisite

**Mode:** read-only investigation + isolated-fixture implementation. No live mutation.
**Continues:** `docs/GOLDEN-1-PANEL-SIZING-SNAPSHOT-REQUIRED-AUDIT.md` (quotation-gate investigation not reopened)
**Tree baseline:** HEAD `029b42637ac117f810e726b40c2e888c484c173b`, 783 porcelain lines, treehash `5d69730ee626` (recorded 2026-09-28T18:56:08Z)
**Canonical D1:** WAL-safe read-only throughout

---

## 1. Executive verdict

🟢 **`YES — EXISTING GOVERNED PATH`.** The governed writer exists and works. `POST /api/match-candidates/:id/safety/approve` (`worker/confidence-safety-api.mjs:138`) is the **single** production writer of `safety_approval_requests`, and driving it in an isolated real-schema fixture produces exactly the approved primary panel selection the sizing guard requires — **with no direct row fabrication**. 22/22 new tests green; 44/44 adjacent R7/selection tests unregressed.

🔴 **But the acceptance project still cannot use it today, and the reason is upstream of technical selection.** All 7 control-panel requirement profiles carry `readiness.status = "Missing Critical Information"` with the single blocking reason *"compatibilityTarget is required to define a safe Fire Alarm product search boundary."* That forces the matching engine into discovery-only mode, which emits the **non-overridable** `DISCOVERY_ONLY` block, which makes `technical_eligibility = "Blocked"` — a state the governed approval route correctly refuses and which the override path deliberately cannot rescue.

🔴 **The hermetic Golden E2E fixture is blocked even earlier: it contains no control-panel BOQ item at all.** Its `golden-boq.xlsx` has 3 rows — an addressable detector, an interface module, and an annunciator. The selection guard is structurally unreachable there.

---

## 2. Exact sizing guard

`worker/fire-alarm-panel-sizing-api.mjs:361`, verbatim:

```js
if (selection.status !== "APPROVED" || selection.selection?.productId !== panel.productId)
  fail("CURRENT_APPROVED_PANEL_SELECTION_REQUIRED",
       `Panel ${panel.panelId} must use the exact current Approved primary product selection.`);
```

Its sole input is `resolveCurrentPrimarySelection(db, item.id)` (`:357-360`).

---

## 3. Approval / selection schema

No dedicated "selection" table exists. The primary selection is **derived**, not stored. The four conjuncts, all required for `APPROVED` (`worker/primary-selection-authority.mjs:43-141`):

| # | Requirement | Query evidence |
|---|---|---|
| 1 | Exactly one contributing non-superseded match run | `:126` `run.superseded_at IS NULL`; `:127-134` `matchRunIds.length !== 1` → `CURRENT_MATCH_RUN_AMBIGUOUS` |
| 2 | ≥1 candidate, none rejected | `:41` `c.review_status NOT IN ('Rejected','Auto-Rejected Technical')` |
| 3 | A non-superseded safety decision for that candidate | `:90` `d.superseded_at IS NULL ORDER BY version_number DESC LIMIT 1` |
| 4 | An `Approved` `Technical` approval whose `entity_version` **equals** that decision's `version_number` | `:105-112` + `:117-120` |

**Exact row shape that satisfies the guard:**

```jsonc
// product_match_runs
{ "id": "<run>", "boq_item_id": "<panel item>", "superseded_at": null, "requirement_profile_version_id": "<CURRENT profile id>" }
// product_match_candidates
{ "id": "<cand>", "match_run_id": "<run>", "product_id": "<product>", "review_status": "Needs Review" }  // not Rejected
// safety_decisions
{ "id": "<decision>", "candidate_id": "<cand>", "superseded_at": null, "version_number": 7,
  "technical_eligibility": "Eligible" }   // or all blocks Overridden with "Technical Approval Disabled"
// safety_approval_requests  ← the row GOLDEN-2 proves is route-produced
{ "safety_decision_id": "<decision>", "approval_type": "Technical", "status": "Approved", "entity_version": 7 }
```

---

## 4. Production writer

🟢 **Exactly one.** `worker/confidence-safety-api.mjs:138`:

```js
INSERT INTO safety_approval_requests
  (id, project_id, safety_decision_id, approval_type, approval_level, status, requested_by,
   requested_role, request_reason, evidence, entity_version, ruleset_version,
   decided_by, decided_role, decision_reason, decided_at)
VALUES (?,?,?,?,?, 'Approved', ?,?,?,?,?,?,?,?,?,?)
```

**Route:** `POST /api/match-candidates/:candidateId/safety/approve` (matcher `:117`).

**Guards, in evaluation order:**

| Order | Guard | HTTP | Code |
|---|---|---|---|
| 1 | project authority | 403 | `PROJECT_AUTHORITY_REQUIRED` |
| 2 | technical role (for `approvalType: Technical`) | 403 | `TECHNICAL_APPROVAL_ROLE_REQUIRED` |
| 3 | commercial role (for `Price`) | 403 | `PRICE_APPROVAL_ROLE_REQUIRED` |
| 4 | requirement-profile staleness | 409 | `REQUIREMENT_PROFILE_CHANGED` |
| 5 | **CAS**: `body.entityVersion === current.version_number` | 409 | `STALE_SAFETY_VERSION` |
| 6 | eligibility ∧ no Open blocks ∧ no unacked required warnings | 409 | `APPROVAL_BLOCKED` |
| 7 | `reason.length >= 5` | 422 | `APPROVAL_REASON_REQUIRED` |

**Request body:** `{ approvalType: "Technical", entityVersion: <current safety decision version_number>, reason: ">= 5 chars", evidence: {...}, approvalLevel: 1 }`.

**Audit:** the row itself is the durable record — `requested_by`/`decided_by` = actor, `requested_role`/`decided_role` = authority role, `request_reason`/`decision_reason` = governed reason, `entity_version` + `ruleset_version` pin the exact decision approved. There is no separate audit table for this write.

**Supersession:** rows are never updated. `currentDecision` picks the newest non-superseded `safety_decisions` row, and the approval must match its `version_number` — so a later recalculation automatically invalidates prior approvals rather than silently keeping them. Proven by test.

---

## 5. Permission model

`resolveProjectAuthority` → `canApproveTechnicalSafety(role)`. Roles (`app/domain/project-roles.mjs:39-50`): `Engineering Reviewer`, `Technical Reviewer`, `Senior Technical Reviewer`, `Technical Manager`, `Project Manager`, `Management`, `Administrator`. Ownership is enforced by `ownedCandidate` (`:14`): project owner, active member, or application Administrator.

🟢 **No permission change is required or proposed.** The governance is already correct and is proven intact by `GOLDEN-2-5`.

---

## 6. Acceptance-project reachability matrix

`project_c0123d91-c30b-4956-87cb-e473ef53f89d` — **7 control-panel lines evaluated.**

| Item | BOQ item id | Profile | Current match run | Candidates | Safety decisions | Approvals | Legally selectable today? |
|---|---|---|---|---|---|---|---|
| D | `boqitem_4be2bb26-84df-45d1-87fa-11e3125b938f` | Control Panel, `Missing Critical Information` | 🔴 0 | 🔴 0 | 🔴 0 | 0 | 🔴 No — no candidates |
| D | `boqitem_92ed49c3-c758-49fc-9c36-fb06ff944866` | Control Panel, `Missing Critical Information` | 🔴 0 | 🔴 0 | 🔴 0 | 0 | 🔴 No — no candidates |
| G | `boqitem_e613397f-ddaf-4a18-85ef-dd7791d8aac4` | Control Panel, `Missing Critical Information` | 🟢 1 | 🟢 10 | 🟢 10 | 0 | 🔴 No — see below |
| K | `boqitem_1f44b7de-a329-4ad4-aa06-0f9e9fa07002` | Control Panel, `Missing Critical Information` | 🔴 0 | 🔴 0 | 🔴 0 | 0 | 🔴 No |
| K | `boqitem_5fe70cc4-e736-45aa-9601-d8c38d7cd85f` | Control Panel, `Missing Critical Information` | 🔴 0 | 🔴 0 | 🔴 0 | 0 | 🔴 No |
| K | `boqitem_6af90650-0e91-474b-bf19-362e2a3e5876` | Control Panel, `Missing Critical Information` | 🔴 0 | 🔴 0 | 🔴 0 | 0 | 🔴 No |
| K | `boqitem_eb69f1a1-22fb-4dc4-aa76-5c8c3da5d95a` | Control Panel, `Missing Critical Information` | 🔴 0 | 🔴 0 | 🔴 0 | 0 | 🔴 No |

**0 of 7** could legally become the primary panel selection today.

**Item G is the only line with any candidate evidence at all.** All 10 of its candidates are uniformly blocked:

| Attribute | Value (all 10 candidates) |
|---|---|
| `review_status` | `Needs Review` (passes the rejection filter) |
| `technical_status` | `Discovery Only` |
| `recommendation_tier` | `Discovery Candidate` |
| match run `status` | `Discovery Only` |
| `safety_state` | `Missing Critical Information` |
| `technical_eligibility` | **`Blocked`** |
| `price_eligibility` | `Price Approval Disabled` |
| Open blocks | 5 each |
| Approvals | 0 |

**Its 5 open blocks:**

| Code | Severity | `overridable` | Overridable in practice? |
|---|---|---|---|
| `CRITICAL_ASSUMPTION_UNAPPROVED` | Critical | 1 | yes |
| **`DISCOVERY_ONLY`** | Critical | **0** | 🔴 **never** |
| `MISSING_CATEGORY` | Critical | 1 | yes |
| `MISSING_PRODUCT_FAMILY` | Critical | 1 | yes |
| `UNRESOLVED_PROJECT_REQUIREMENT` | Critical | 1 | yes |

**Why the governed route refuses it, and why overrides cannot help.** The eligibility expression is:

```js
const overriddenBlocksAllResolved =
  current.technical_eligibility === "Technical Approval Disabled"
  && full.blocks.length > 0
  && full.blocks.every((entry) => entry.status === "Overridden");
```

Item G's eligibility is `"Blocked"`, **not** `"Technical Approval Disabled"`, so `overriddenBlocksAllResolved` is `false` regardless of overrides. Independently, `DISCOVERY_ONLY` has `overridable = 0`, so the override-decision route (`UPDATE safety_blocks SET status='Overridden' … WHERE … AND overridable=1`) can never flip it. The writer's own comment is explicit: *"'Blocked' … and 'Human Review Required' are deliberately NOT accepted."*

**Root of the root, from `app/domain/product-matching-engine.mjs:585`:**

```js
const profileBlocked = !["Ready for Matching", "Ready with Warnings"].includes(profile.readiness?.status);
const discovery = generated.discoveryOnly || profileBlocked;
```

```js
// :667
const valid = evaluated.filter((c) => !c.mandatoryFailures.length && !c.mandatoryUnresolved.length
                                     && c.recommendationTier !== "Discovery Candidate");
const status = valid.length ? "Needs Review" : evaluated.length ? "Discovery Only" : "No Match";
```

**Readiness distribution across the 39 current profiles:**

| `readiness.status` | Count |
|---|---|
| `Missing Critical Information` | 31 |
| `Classification Required` | 4 |
| `Needs Technical Review` | 3 |
| `Ready with Warnings` | **1** — and it is item **C (Heat Detector)**, *not* a panel |

**All 7 control-panel profiles have `compatibilityTarget = NULL`** (verified individually). That is the single named blocking reason, and it is what forces discovery-only matching.

**Conclusion:** the missing artifact is a **requirement profile with `compatibilityTarget` populated** (R11-5 Requirements), *not* a technical-selection artifact. Technical selection cannot manufacture it.

---

## 7. Golden-fixture gaps

`tests/e2e/fixtures/golden-boq.xlsx` — read directly from the XLSX XML. **3 data rows:**

| Item | Description | Expected Outcome |
|---|---|---|
| 1 | Golden addressable detector | Valid Match |
| 2 | Addressable interface module — model to be confirmed | Blocked — missing exact model |
| 3 | Specialized unsupported annunciator | No Match |

**Absent before an approved primary panel selection could exist, in order:**

| # | Missing | Consequence |
|---|---|---|
| 1 | 🔴 **A control-panel BOQ item** | The selection guard is structurally unreachable |
| 2 | 🔴 `canonical_library_products` row (seed has none) | `CURRENT_PRODUCT_IDENTITY_REQUIRED` |
| 3 | 🔴 `product_attributes` (seed has none) | `APPROVED_CAPACITY_EVIDENCE_REQUIRED` |
| 4 | 🔴 `product_accessories` (seed has none) | expansion chain unsatisfiable |
| 5 | 🔴 Approved safety decision for a panel candidate | `CURRENT_SAFETY_DECISION_REQUIRED` |
| 6 | 🔴 A technical (non-discovery) match run | `DISCOVERY_ONLY`, non-overridable |
| 7 | 🔴 A governed approval request | the guard itself |
| 8 | 🔴 Drawing → approved architecture | `CURRENT_APPROVED_ARCHITECTURE_REQUIRED` (fires *first*, see §11) |

`tests/e2e/seed-golden-catalog.sql` seeds only: `product_manufacturers`, `product_brands`, `product_families`, `product_sources`, `library_products` (1 row), `product_source_evidence`, `engineering_relationships`.

**The fixture remains self-contained and is not mixed with acceptance-project evidence anywhere in this report or in the new tests.**

---

## 8. Runtime red reproduction

Isolated real-schema fixture, real production handlers, no mocks of the authority.

```
✔ RED: no approval row => resolveCurrentPrimarySelection is PROVISIONAL, so the sizing guard fires
✔ RED: the sizing guard's own predicate rejects a PROVISIONAL selection
```

Precondition asserted before the governed route is driven:

```js
assert.equal(raw.prepare("SELECT COUNT(*) c FROM safety_approval_requests").get().c, 0,
  "no approval row may exist before the governed route is driven");
```

**Contrast with the existing suite:** `tests/r7-panel-sizing-production.test.mjs:254` seeds the approval with a direct `INSERT INTO safety_approval_requests VALUES (...)`. That proves the **guard** but not that a governed path can produce the row. GOLDEN-2 closes that gap.

---

## 9. Governed green proof

```
✔ GREEN: driving POST /api/match-candidates/:id/safety/approve creates the row and clears the guard
```

Sequence, all real code:

1. `handleConfidenceSafetyApi(POST …/safety/approve)` → `200`, `{ approved: true, type: "Technical" }`
2. Row exists, written by the production route: `status='Approved'`, `approval_type='Technical'`, `entity_version=7`
3. `resolveCurrentPrimarySelection` → `APPROVED`, `selection.productId === 'product-panel'`, `technicalApproval.status === 'Approved'`
4. The sizing guard's predicate `status !== "APPROVED" || productId !== panel.productId` is now **false** → the guard is cleared

**No direct DB fabrication was used to reach green.** The fixture seeds the *inputs* (BOQ item, profile, match run, candidate, canonical product, eligible safety decision); the *approval* — the thing GOLDEN-2 is about — is produced solely by the governed route.

---

## 10. Currentness / revocation

All nine proven against the real resolver:

| # | Case | Result |
|---|---|---|
| 1 | `Rejected` approval | 🔴 not `APPROVED` |
| 2 | `Pending` approval | 🔴 not `APPROVED` |
| 3 | Approval `entity_version` ≠ decision `version_number` | 🔴 ignored |
| 4 | Candidate `review_status = 'Rejected'` | 🔴 not `APPROVED` |
| 5 | Candidate `review_status = 'Auto-Rejected Technical'` | 🔴 not `APPROVED` |
| 6 | Superseded match run | 🔴 not `APPROVED` |
| 7 | Superseded safety decision | 🔴 not `APPROVED` |
| 8 | Two contributing current match runs | 🔴 not `APPROVED` (ambiguous / unavailable) |
| 9 | Approval naming a different item's decision | 🔴 does not resolve that item |

Plus the route's own refusals: `APPROVAL_BLOCKED` (ineligible + Open non-overridable block), `STALE_SAFETY_VERSION` (CAS), `APPROVAL_REASON_REQUIRED`, `REQUIREMENT_PROFILE_CHANGED` — each asserted to leave `safety_approval_requests` at **0 rows**.

**A historical approval cannot satisfy current selection authority.** It is invalidated by re-derivation, not by deletion: a newer safety decision changes `version_number`, so the old approval no longer matches the CAS conjunct.

---

## 11. Next producer blocker

Gate order proven from source, not inferred:

`loadDependencies` (`:429-431`) runs **`loadArchitecture` first** — *before* the selection guard is ever reached. So:

| Project | Next blocker after the selection guard is cleared |
|---|---|
| **Acceptance `c0123d91`** | `CURRENT_PRODUCT_IDENTITY_REQUIRED` (`:383`) — the profile classification gate at `:370` already **passes** (7 lines classified `Fire Alarm Control Panel`). It is preceded in the causal chain by the *upstream* R11-5 profile-readiness gap in §6. |
| **Hermetic E2E fixture** | `CURRENT_APPROVED_ARCHITECTURE_REQUIRED` (`:75-79`) — it has no drawing at all, so this fires **first**, before the selection guard. |

Full ordering inside `loadPanelDependency`: `:361` selection → `:363` `STALE_PANEL_PRODUCT_SELECTION` → `:370` classification → `:383` product identity → `:245` `APPROVED_CAPACITY_EVIDENCE_REQUIRED`.

🔴 **Not solved in this slice**, as instructed.

---

## 12. Files changed

| File | Change |
|---|---|
| `tests/golden-2-governed-primary-panel-selection.test.mjs` | **new**, 477 lines, 22 tests — the only file written |

**No production source changed.** No migration, schema, fixture, or config change. BOM-5 pricing/currentness files untouched. CLOSE candidate-review state untouched. `drizzle-active/*` and `_journal.json` untouched.

---

## 13. Business-state writes

**None, live.** No live safety approval, selection, matching decision, sizing snapshot, pricing, or quotation. All write-path verification used in-memory `node:sqlite` fixtures. Live D1 was read with WAL-safe read-only access only; `safety_approval_requests` remains **0 rows** globally.

---

## 14. Recommended next Golden slice

**GOLDEN-3 — close the requirement-profile readiness gap for Fire Alarm control panels: populate `compatibilityTarget` so the 7 panel profiles can reach `Ready for Matching` / `Ready with Warnings`.**

Why this and not something else:
- It is the **first missing upstream artifact** (§6). Nothing in technical selection can substitute for it.
- It is a genuine **Requirements (R11-5)** concern, not a sizing or commercial one, and is therefore correctly outside both this lane and the technical lane.
- It is the change that makes the governed approval route *usable* — which GOLDEN-2 has now proven already works end-to-end.

Explicitly **not** recommended: inserting an approval row directly, relaxing the selection guard, or widening `technical_eligibility`. All three would fabricate authority.

---

## Appendix — evidence limitations

- The hermetic E2E fixture project (`project_fd1b5418-…`) is ephemeral and absent from live D1; §7 is derived from `golden-boq.xlsx` XML and the two seed files, which were read in full.
- The end-to-end producer reproduction for `CURRENT_APPROVED_PANEL_SELECTION_REQUIRED` requires the full approved-architecture chain to be reachable. That is owned and already green in `tests/r7-panel-sizing-production.test.mjs`; this suite pins the linkage by source assertion and proves the guard at its own predicate rather than duplicating that fixture. Stated plainly so "green" is not over-read.
- `compatibilityTarget` was read from the persisted profile JSON. Whether populating it is a data edit, an engine change, or a spec-evidence extraction is deliberately **not** decided here — that is GOLDEN-3's first question.
- Concurrent lanes were active throughout; findings are timestamped to the baseline above.
