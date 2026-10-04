# MVP-CLOSE-6 — Connect the Approved Duct-Detector Requirement to Item F

**Lane:** MVP-CLOSE-6 (bounded requirement-applicability slice)
**Date:** 2026-09-28
**Target project:** `project_c0123d91-c30b-4956-87cb-e473ef53f89d` — Al Mousa School (Fire Alarm)
**Target item:** `boqitem_ea12a5ee-866f-45db-91a1-621119569551` — "F", *Duct detector*, qty 13
**Candidate:** `specjob_76af1f32-58f6-45da-a16c-233e4c753d9b_chunk_000001_requirement_207`

**Outcome: 🔴 NO WRITE PERFORMED — the requirement applies on substance but is not usable
evidence, and no governed write would be either permissible or effective.**

Boundaries honoured: no requirement linking, no approval, no profile regeneration, no retry, no restart,
commit, push or deployment; no schema/configuration change; no work on the other 11 items, matching,
prices, sizing, R11 or permissions. **No live approval route was called.** All write-capable work was done
against a **scratch copy** of the database; the live database was opened read-only and is verified
unchanged.

---

## 1. Applicability verdict and source evidence

### 1.1 Item identity and source context — verified

| Field | Value |
|---|---|
| Item | `boqitem_ea12a5ee-866f-45db-91a1-621119569551`, item_number `F`, sequence 8, `row_type='BOQ Item'` |
| Text | **"Duct detector"**, qty **13**, unit `Each` (raw `No`) |
| Section | "Supply, install and connect fire alarm detection and alarm system complete including wiring, conduits, accessories, complete as required for proper operation, all as specified and as shown on the drawings" |
| Source | `BOQ.xlsx`, sheet **"MECH RFQ"**, **row 21** ✓ (matches "previously reported row 21") |
| Manufacturer / model / part no. | **none** |
| Extraction | `boqextract_a96e9363…` v1, not superseded; `review_status=Approved`, `approved_for_downstream=1` |
| Governed classification | Fire Alarm / Detection Devices / **Duct Detector** (field-confirmed, whole-blob `AWAITING_REVIEW`) |

### 1.2 What the requirement actually establishes

> *"The air duct smoke detector shall be an intelligent, non-relay photoelectric type with either an indoor
> or NEMA4 watertight enclosure for outdoor use."*

* Source: `doc_ab1cb6b5` (spec **"28 46 00 - Fire Detection and Alarm System - Rev 1.pdf"**), **page 14**,
  §`28 46 00` → `2 PRODUCTS` → article `1` → clause `1`, seq 100207.
* `requirement_type=Mandatory`, domain/system `Fire Alarm`, category **`Environmental`**, confidence 83
  (Medium), `review_status=Approved`, `approved_for_downstream=1`.
* Extracted payloads are **empty**: `attributes: []`, `standards: []`, **`compatibility: []`**,
  `accessories: []`.

It establishes **detector technology and construction only**: sensing principle (photoelectric),
architecture (intelligent / non-relay), and enclosure (indoor or NEMA4 for outdoor).

### 1.3 Why it applies — on substance

The clause names *"the air duct smoke detector"*; F is a **Duct detector** in the same governed system.
The clausePath shows it sits under the detector products article, and F's own governed classification is
`Duct Detector` in `Detection Devices`. **There is no factual conflict**: nothing in the clause excludes a
duct detector, and the BOQ row asserts no contrary type.

### 1.4 Exclusions, conflicts and missing context

1. **The requirement carries no equipment identity, and its category does not match the item's.** Its
   category is `Environmental` and it has no extracted `equipmentType`. (Precision: the policy's
   "generic" test is `genericCategories = {"", "Other", "Unknown"}` — `Environmental` is *not* in it. The
   refusal fires on the **category-mismatch** leg, `item.category !== requirement.category`
   (Detection Devices ≠ Environmental), not on a generic-category test.)
2. **The deterministic applicability policy would refuse it.** The recorded policy is
   *"same-system + same-non-generic-category + exact-equipment + approved-downstream requirement"*
   (`engineering-knowledge-api.mjs:212`). F's three earlier links recorded exactly these refusals for
   sibling requirements: `category-mismatch-or-generic`, `equipment-type-not-exact`,
   `not-applicable-candidate`. So even in principle this pair fails two of the four conditions.
3. **No compatibility target — explicitly not inferred.** `compatibilityTarget` is satisfied only by
   `profile.compatibility.some(e => e.targetItem || e.target || e.rightEntityId)`
   (`confidence-safety-engine.mjs:79`). This requirement's `compatibility` array is **empty**. F's single
   **blocking** profile issue is exactly `compatibilityTarget`
   (*"compatibilityTarget is required to define a safe Fire Alarm product search boundary"*), plus a
   non-blocking `standard` gap. **This requirement could not clear either one.**

### 1.5 🔴 The decisive finding — the requirement is not current evidence

`requirement_207` lives on specification extraction **v2** (`specextract_b6f37214`), which was
**superseded on 2026-09-20T14:01:22.752Z** by a re-extraction to **v3** (`specextract_b4b03333`,
`superseded_at IS NULL` = the current lineage).

Run through the codebase's own currency authority, `currentTechnicalRequirementsFrom`:

* current requirements in the project: **513**
* **`requirement_207` is current? NO**
* current + `Approved` + `approved_for_downstream=1`: **1** (a *heat*-detector clause, seq 100197 — not a
  duct detector)
* **59 approved requirements are orphaned** on superseded lineages — all from that single spec PDF.

The current-lineage counterpart carries **identical text and confidence 83** but a different id and a reset
review state:

| | id | seq | review_status | approved_for_downstream |
|---|---|---|---|---|
| nominated (retired) | `specjob_76af1f32…_requirement_207` | 100207 | Approved | 1 |
| **current** | `specjob_2ee1d387…_requirement_207` | 100207 | **Needs Review** | **0** |

The v2 → v3 re-extraction of that specification reset the review state of every requirement it contained.

---

## 2. Authority used — none, because none is effective

### 2.1 Every consumer filters this requirement out

| Consumer | Scoping | Effect on 207 |
|---|---|---|
| Applicability engine's candidate pool | `currentTechnicalRequirementsFrom(...) AND approved_for_downstream=1 AND review_status='Approved'` (`engineering-knowledge-api.mjs:125`) | **not a candidate** — cannot even be shortlisted |
| Profile generation `loadInputs` | `JOIN currentTechnicalRequirementsFrom("r") … l.status='Confirmed' AND r.approved_for_downstream=1` (`technical-requirement-api.mjs:88`) | a Confirmed link admits **nothing** |
| Understanding input `confirmedSpecifications` | joins through `currentTechnicalRequirementsFrom` — stated in its own comment (`estimator-understanding-api.mjs:724-726`) | contributes **nothing** |

### 2.2 Empirically proven inert (scratch copy of live data, never live)

| Measurement | Result |
|---|---|
| `confirmedSpecifications` for F, before | **0** |
| Simulated `Confirmed` link to requirement_207 → `confirmedSpecifications` | **0** |
| Understanding input fingerprint before → after | `5e781f0cc001c41f` → **unchanged** |
| Confirmed requirements `loadInputs` would admit | **0** |
| *Control:* link the **current** counterpart instead | **0** — blocked by `approved_for_downstream=0`, not by currency |

**A Confirmed link to this requirement would be recorded and then do nothing at all.**

### 2.3 The governed routes, and why none was used

| Route | Nature | Why not used |
|---|---|---|
| `POST /api/projects/:id/engineering-knowledge/suggest-links` | the **only** creator of `Suggested` links; project-**wide** bulk over all 90 current items | out of scope for a single-pair slice, and it could never emit 207 (not in its pool) |
| `POST /api/requirement-links/:id/(confirm\|reject\|remove)` | **human owner-only** (`p.owner_user_id = user.id`), substantive reason, writes a knowledge decision + audit, auto-regenerates the profile | impersonation forbidden; and it would be **inert** — `validateRequirementLink` (`engineering-knowledge.mjs:254`) does **not** check currency, so a human *could* stamp it, but that would assert authority over retired evidence and change nothing |
| `POST /api/requirements/:id/propagate-system-wide` | creates a `Confirmed` link, confidence 100, whole-domain scope | **`404` — it selects the requirement through `currentTechnicalRequirementsFrom` (`engineering-knowledge-api.mjs:295`), so a retired requirement is not found at all.** Had currency passed, its per-item gate (`:338`) *would* have matched F (F's field facts give `Fire Alarm` / `Detection Devices`), but the route is category-wide, not per-pair |
| `POST /api/boq-items/:id/requirement-profile/(generate\|recalculate)` | canonical single-item regeneration, idempotent via the `input_fingerprint` short-circuit | nothing valid to regenerate |

There is **no narrow, per-pair, non-bulk route** to create a `Suggested` link for exactly this pair.

### 2.4 The decision I am *not* asking for

The brief said to prepare a human applicability confirmation and stop. **I am deliberately not asking for
it**, because §2.2 proves that confirmation is a no-op: it would add a link row asserting authority over
evidence the system has retired, change no fingerprint, admit no requirement, and clear neither blocker.
Asking for it would be asking someone to perform a governance action that does nothing.

The real blocker is an **evidence-lineage** problem owned by specification review, not an applicability
judgement.

### 2.5 A structural constraint worth recording

If the **current** counterpart (`specjob_2ee1d387…_requirement_207`) were approved, the only governed ways
to attach it to F would be `suggest-links` (project-wide) or `propagate-system-wide` (governed-category
wide). **Neither is bounded to a single item.** So any slice that legitimately attaches a current approved
requirement to F necessarily exceeds a single-item scope and must say so explicitly rather than pretending
a per-pair route exists.

Also noted by the delegated review and **not triggered here**: `propagate-system-wide` inserts a
`Confirmed` row without stamping `superseded_at` on a pre-existing `Suggested` row for the same pair,
leaving both visible to readers that filter on that column. F currently has **0 active links**, so this
slice neither caused nor exercised it. Recorded as a latent risk only.

---

## 3. Writes performed and before/after state

**None.** No link, decision, approval, profile version, interpretation, run, or audit row was created.
No live route was invoked.

| Check (live DB) | Value |
|---|---|
| Scratch rows leaked into live DB | **0** |
| Link rows for F | **3 — all superseded, unchanged** (and they point at requirements **314/442/53**, *not* 207) |
| Active links for F | **0** |
| `requirement_207` row | `Approved / adv 1` — **untouched** |
| F profile versions | **2**, newest `2026-09-28 10:45:10` — untouched |
| F interpretations | **3** — untouched |
| Project totals | 3195 links / 1963 active / 115 knowledge decisions |

**Idempotency:** moot — no operation was executed, so there is nothing to repeat.

---

## 4. Input-currentness / invalidation consequences

Because no confirmed specification context was added, the Understanding input fingerprint is unchanged
(`5e781f0c…`) and **no invalidation occurred**: F's interpretations and its whole-blob/field authority
remain exactly as MVP-CLOSE-4 left them (field-confirmed, `AWAITING_REVIEW`). Nothing was re-run to force
progress, and no stale authority was preserved.

Had a *valid* Confirmed link been added, the honest consequence would have been the opposite of progress:
`confirmedSpecifications` would gain a clause, shifting the input fingerprint, invalidating the current
interpretation and pushing the item to `REVALIDATION_REQUIRED` — while contributing no compatibility
target. That is precisely the trade this slice avoided by not acting on inert evidence.

---

## 5. Profile and readiness outcome — not overstated

F's current profile (v2, `2026-09-28 10:45:10`) is unchanged:

* `readiness.status` = **"Missing Critical Information"**
* **0** `profile_requirement_applicability` rows — the requirement has never been applied to F
* Blocking: `compatibilityTarget` (blocking = 1)
* Non-blocking: `standard` missing, plus a clarification question and a working assumption for `standard`
* One derived requirement: a compatible **detector base** per detector
* Classification provenance: `system: "Approved AI Understanding"` (from the field confirmations)

**Progress made: none, and none was available.** The requirement that would move F is not merely unlinked —
it is unapproved on the current lineage, and no *approved current* requirement establishes a panel or
protocol target for a duct detector. Clearing `compatibilityTarget` needs specification evidence this
project currently does not have in approved, current form.

---

## 6. Coordination — delegated review reconciled

A read-only subagent independently verified the link routes, the auto-confirm policy, the
currency/compatibility effect and profile-regeneration idempotency. **It never touched the database**; all
of its claims are source-derived, and it marked three items `UNVERIFIED` (live state, whether
`propagate-system-wide` actually leaves a stale Suggested row, and whether auto-confirm would fire at
runtime). Every finding below was therefore checked against source or live data by the primary agent
before being accepted.

**Corroborated:**
* No per-pair `Suggested` creator exists; `suggest-links` is project-wide.
* The five `shouldAutoConfirmRequirementLink` conditions match exactly, including
  `requirement-not-approved-for-downstream`, `category-mismatch-or-generic`, `equipment-type-not-exact`,
  `not-applicable-candidate`.
* `validateRequirementLink` never checks currency — a human *could* stamp a retired requirement.
* An empty `compatibility` array supplies no `compatibilityTarget`; that field requires `targetItem` or
  `rightEntityId`, and protocol-only Source Fact evidence is deliberately non-qualifying.
* `Duct Detector` → `Detection Devices` → in `PANEL_COMPATIBILITY_REQUIRED_CATEGORIES` → the
  `compatibilityTarget` gap is **blocking** for F.
* Profile regeneration is automatic on both Confirmed-creating routes, and idempotent via the
  `input_fingerprint` short-circuit.
* `link_method` is never read from a request body; there are **no** human-supplied values, so none could
  have been fabricated.

**Corrected by this reconciliation:**
* My §1.4 originally called `Environmental` a "generic" category. It is not in
  `genericCategories`; the refusal is a plain category **mismatch**. Corrected above.
* The delegated review correctly noted that
  `estimator_understanding_review_current_evidence_guard` is **not** the detector of a fingerprint change
  (it only guards same-fingerprint staleness). This report never made that claim; the detector named in
  §4 is `reviewMatchesEffective` → `REVALIDATION_REQUIRED` / `AWAITING_REVIEW`, plus
  `mutateUnderstandingReview`'s `selectionAuthority`/`expectedVersion` CAS.

**Rejected on evidence:** the review predicted that confirming a link would move F's readiness to
"Ready with Warnings" via a confidence cap. That is a source-derived prediction from a run that never read
the database, and it conflicts with the **observed** current profile (`readiness.status = "Missing Critical
Information"`, one blocking `compatibilityTarget` issue). The observed value is reported in §5.

---

## 7. One next slice (proposed — NOT executed)

**Bounded specification-review slice for the current-lineage duct-detector clause, then re-shortlist F.**

1. Review and, if the reviewer agrees it is correctly extracted, **approve the current requirement**
   `specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_207` (seq 100207) through the
   existing requirement-review route — the same clause text, currently `Needs Review` /
   `approved_for_downstream=0`.
2. Only then, re-run the applicability shortlist so F can receive a real `Suggested`/`Confirmed` link to
   **current approved** evidence, and let the automatic profile regeneration on confirmation run.
3. Explicit expectation to record up front: this will supply **technical** requirements for F
   (photoelectric, intelligent/non-relay, enclosure) and may resolve the `standard` gap, but it **will not
   clear `compatibilityTarget`** — no approved current clause establishes a panel/protocol target for a
   duct detector. The honest end state may still be Missing Critical Information.

Scope guard for that slice: approval of the single named requirement only — **not** the 59 orphaned
approvals, which are a separate, larger specification-currency decision that deserves its own slice and
its own owner.

---

STOPPED — MVP-CLOSE-6 complete, no applicability confirmation required: the candidate requirement is
retired evidence and any link to it would be provably inert.
