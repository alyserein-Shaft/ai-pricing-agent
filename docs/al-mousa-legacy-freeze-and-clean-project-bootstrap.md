# Al Mousa — Legacy Freeze and Clean-Project Bootstrap

## Status

`project_ae501b85-9c12-4332-bf8e-787c90f2d388` (`Al Mousa School — Clean Golden Run`) is
**`LEGACY_REFERENCE_ONLY`**.

Its requirement-link and profile-readiness governance packet (17 Omair actions) is
**`LEGACY_FORENSIC_REFERENCE`** — it is not current acceptance work and must not be
executed. No requirement confirmation, requirement approval, system stamp, profile
regeneration, `approve-readiness`, matching run, Product Identity selection or safety
decision was taken on it.

The next Al Mousa acceptance run is a **new clean project built from original source
files**.

## What is preserved, and what is deliberately not

**Preserved — reusable system capability (portable to any project):**

- `POST /api/requirement-links/propose-exact` — a human-governed exact
  `(boq_item_id, requirement_id)` link proposal.
- Global link scoring is **unchanged**.

**Not preserved — project-specific rows.** No BOQ classification, quantity,
interpretation, profile, candidate or decision row from the legacy project is carried
forward as truth. `PROJECT_SPECIFIC_ROWS_TO_MIGRATE_TO_NEW_PROJECT = 0`. The next
project derives everything from its own source files.

## Why the exact-link path exists (reusable finding)

`buildLinkShortlist` reaches candidate requirements **only** through
`scoreRequirementLink`, an equipment-type + technical-term heuristic gated at
`confidence >= 25 || (mandatory && >= 15)`.

A **valid, approved, downstream-eligible, Mandatory** clause can score below that gate
when it names no equipment type and shares no distinctive term with its BOQ row — so it
can never be proposed, **at any score**. This is a structural property of the scorer,
not a project defect, and it is the same class already recorded for the panel/UL-listing
blocker.

Three reusable lessons:

1. **Valid approved requirements may legitimately fall below automatic shortlist
   thresholds.** "Not suggested" must never be read as "not applicable".
2. **The global scorer must not be weakened to solve one project's case.** Lowering the
   25/15 gate or making more terms distinctive changes behaviour for every item in every
   project and needs its own governance review plus a non-regression baseline. The
   threshold was left untouched.
3. **A project-specific exact human proposal is the correct governed fallback.** It
   widens nothing: it lowers no threshold, changes no other item's behaviour, and still
   writes `Suggested` only — confirmation remains a second, separate human decision.

Two further lessons carried forward:

4. **False requirement links must stay rejectable.** Applicability is a human judgement,
   so a wrong suggestion needs a governed `REJECT` path — not just a way to add.
5. **Requirement readiness must rest on correct applicable evidence, not on a generic
   clause chosen to satisfy a score.** A generic clause can satisfy the readiness gate
   while proving nothing about the device. Where the genuinely applicable clauses are
   missing or unapproved, the honest state is *not ready*, and the fix is to approve the
   real clauses — not to substitute a generic one.

## Exact-link path — capability contract

| Property | Behaviour |
|---|---|
| Route | `POST /api/requirement-links/propose-exact` |
| Body | `{ boqItemId, requirementId, reason }` (reason ≥ 10 chars) |
| Attribution | Human actor via `requireHumanActor`; recorded in `boq_requirement_links.created_by`, `engineering_knowledge_decisions.decided_by`, `document_audit_events.actor_user_id` |
| Audit | One `propose-exact` decision row + one audit event per proposal |
| Status written | `Suggested` **only** — never `Confirmed` |
| `confidence` | The scorer's **real** sub-threshold score, never inflated |
| Scope guards | same project; current BOQ item via `ownedBoqItem` (current-evidence scope + `currentBoqItemPredicate`); requirement `Approved` **and** `approved_for_downstream=1` |
| Duplicate guard | Refuses if a current link of **any** status exists |
| Global scorer | Untouched |

Refusal codes, each covered by a test: `EXACT_LINK_PAIR_REQUIRED`,
`EXACT_LINK_REASON_REQUIRED`, `BOQ_ITEM_NOT_FOUND`,
`EXACT_LINK_REQUIREMENT_NOT_IN_PROJECT`, `EXACT_LINK_REQUIREMENT_NOT_ELIGIBLE`,
`EXACT_LINK_DUPLICATE`, `HUMAN_ACTOR_NOT_CONFIGURED`.

Tests: `tests/requirement-link-exact-proposal.test.mjs` (7/7). The route is additive —
`worker/engineering-knowledge-api.mjs` is **+75 insertions, 0 deletions**.

> **Driver caveat worth keeping:** `node:sqlite` does **not** raise on a short bind list —
> a missing argument is silently bound as `NULL`. A governed INSERT must be covered by an
> assertion on its **attribution** columns, not merely on row existence, or a write can
> be attributed to nobody while every layer reports success.

## Clean-project bootstrap checklist

1. **Upload original source files only.** No legacy rows, no legacy fingerprints.
2. **Run fresh BOQ Understanding** for the project's own items.
3. **Generate requirement links from the fresh classifications** via the ordinary
   `suggest-links` route.
4. **Use the exact-link path only when automatic retrieval misses a known applicable,
   already-approved requirement.** Nominate one exact pair at a time, with a reason.
   Confirm through the ordinary `/confirm` route. Reject anything that does not apply.
5. **Make human governance decisions only on the new project.**
6. **Run profile regeneration and matching only after fresh governance closes.**

Steps 4–6 are ordering constraints, not optional extras: readiness is *computed* from
confirmed links, so links must be resolved before profiles regenerate, and profiles must
close before matching means anything.
