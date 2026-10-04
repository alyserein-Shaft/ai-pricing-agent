# MVP-CLOSE-9 — Duct-Detector Current Requirement + Bounded Item-F Applicability Re-evaluation

**Date:** 2026-09-28
**Slice:** MVP-CLOSE-9
**Project:** `project_c0123d91-c30b-4956-87cb-e473ef53f89d` (Al Mousa School acceptance)
**Requirement under review:** `specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_207` (seq 100207)
**BOQ item under re-evaluation:** `boqitem_ea12a5ee-866f-45db-91a1-621119569551` ("F", Duct detector, qty 13)
**Predecessors:** MVP-CLOSE-6, MVP-CLOSE-7, MVP-CLOSE-8
**HEAD at slice start:** `029b426`

---

## 1. Executive verdict

# `BLOCKED — EXTRACTION DEFECT`

No business-state write was performed. Requirement 100207 was **not** approved, and no Item-F link was created or confirmed.

Two independent, first-hand-proven facts each make the approval in Phase 2 illegitimate or pointless:

1. **The requirement is not a valid standalone approval unit.** It is sub-clause `C.1` of a four-sub-clause specification article `C. Duct Smoke Detector:`. The current extraction captures `C.1` (this row) and `C.2` (a separate, mis-scoped row), and **drops `C.3` and `C.4` entirely** — they exist nowhere in the database, in any of the three extraction versions. The row's recorded source address (`article: "1"`, `clause: "1"`, a `clause_id` belonging to a page-1 clause) does not resolve to its true address, `2 PRODUCTS > C. Duct Smoke Detector > 1`.

2. **Approving it would change nothing about Item F — provably.** `compatibilityTarget` is satisfied only when some element of the profile's `compatibility` array carries `targetItem` or `rightEntityId` (`app/domain/technical-requirement-engine.mjs:218`). Requirement 100207 has **0 rows in `requirement_compatibility` and 0 in `requirement_standards`**, and the only two other inputs to that array — `engineering_relationships` and `engineering_facts` — are **both empty in this project**. A Confirmed link to 100207 therefore contributes nothing, Item F stays `Missing Critical Information`, and the blocking reason is unchanged.

A third, independent finding reinforces that stopping was correct rather than merely cautious: **Phase 3 was not executable as specified even had Phase 2 succeeded.** There is no bounded per-pair link-creation path (§5.2), *and* a Confirmed link would invalidate Item F's currently-approved understanding and break its matching gate, requiring a fresh Understanding run and re-review (§5.3). The phase was unreachable twice over.

The verdict is deliberately **not** green. Item F is already in the correct, governed, current-lineage-backed state. This slice's job was to make that state *explainable*; it is now explained, and the honest answer is that the blocker is real and must not be cleared.

---

## 2. Current requirement truth

### 2.1 Identity and lineage

| Property | Value |
|---|---|
| Requirement ID | `specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_207` |
| Sequence | `100207` |
| Extraction version | `specextract_b4b03333-f24e-4b35-976e-2e2f9e681f89` (**v3, current**) |
| Source document | `doc_ab1cb6b5-cd0f-441e-b28b-c48786e859d8` — `28 46 00 - Fire Detection and Alarm System - Rev 1.pdf` |
| Document version | `ver_87621949-ef98-489c-8eb6-762c8956fc9c` (single version, `effective_from`/`effective_to` both NULL → **in force / governing**) |
| Parser / model | `spec-engine-1.0.1` / `deterministic-semantic-1.0.0` |
| Extraction method | `pdfjs-r2-range-layout-chunk` |
| Status **before** | `Needs Review`, `approved_for_downstream = 0` |
| Untouched? | **Yes** — `updated_at = created_at = 2026-09-20 14:01:22`; 0 rows in `requirement_review_decisions` |
| In canonical current set? | **Yes** — returned by `currentTechnicalRequirementsFrom('r')` |

Extraction chain for the document:

| Version | ID | Status | Superseded at | Requirement rows |
|---|---|---|---|---|
| 1 | `specextract_38ffdb04-…` | Completed | `2026-09-19T14:44:47Z` | 458 |
| 2 | `specextract_b6f37214-…` | Completed | `2026-09-20T14:01:22Z` | 513 |
| 3 | `specextract_b4b03333-…` | Completed | **null (current)** | 513 |

The retired counterpart is `specjob_76af1f32-58f6-45da-a16c-233e4c753d9b_chunk_000001_requirement_207` on v2 — `Approved`, `approved_for_downstream = 1`, and therefore **one of the 59 approvals stranded on a superseded lineage**. It is **not** in the current set (its extraction's `superseded_at` is non-NULL).

**Column-by-column diff, current vs retired:** 23 of 30 columns are byte-identical, including `original_text`, `normalized_requirement`, `source_location`, `original_values`, `current_values`, `confidence` (83) and `confidence_state`. The 7 that differ are `id`, `extraction_version_id`, `clause_id` (job-id prefix only), `review_status`, `approved_for_downstream`, `created_at`, `updated_at`. **Nothing technical differs.** The current row is a faithful re-emission of the same extraction output.

### 2.2 Exact technical content

Verbatim source clause (from `source_location.originalClauseText`, corroborated against the page-14 ground truth in `specification_extraction_pages`):

> The air duct smoke detector shall be an intelligent, non-relay photoelectric type with either an indoor or NEMA4 watertight enclosure for outdoor use.

| Field | Value |
|---|---|
| `original_text` / `normalized_requirement` | as quoted above |
| `engineering_domain` / `system` | `Fire Alarm` / `Fire Alarm` (`domain_source_type: Inferred`, `explicitlyStated: false`) |
| `category` / `subcategory` | `Environmental` / **empty** |
| `requirement_type` / `requirement_category` | `Mandatory` / `Environmental` |
| `condition` / `exception` | **empty** / **empty** |
| `confidence` / `confidence_state` | `83` / `Medium Confidence` |
| `attributes` | **EMPTY `[]`** |
| `standards` | **EMPTY `[]`** |
| `manufacturers` | **EMPTY `[]`** |
| `compatibility` | **EMPTY `[]`** |
| `accessories` / `crossReferences` / `ambiguities` | **EMPTY `[]`** / `[]` / `[]` |
| `installation`/`testing`/`commissioning`/`warranty`/`documentation` | all `false` |
| `source_location` | page 14, `section: "28 46 00 SECTION 28 46 00"`, `article: "1"`, `clause: "1"` |
| `requirement_evidence` | 1 row, `evidence_type: "Source Clause"`, full location + verbatim text, confidence 83 — **provenance is present and correct** |

The technical content (photoelectric type, intelligent/non-relay, indoor-or-NEMA4 enclosure) lives in the requirement **text** only. Every structured array is empty.

**And there are no sub-rows either.** This is the sharper form of the finding, because `loadInputs` does not read `original_values` — it reads dedicated child tables. For requirement 100207:

| Sub-table | Rows |
|---|---|
| `requirement_standards` | **0** |
| `requirement_compatibility` | **0** |
| `requirement_attributes` | **0** |
| `requirement_manufacturers` | **0** |
| `requirement_accessories` | **0** |

So the missing technical evidence is not a JSON-population oversight that could be patched later; it was never extracted. Populating those tables would mean **authoring** a compatibility target and a standard from a clause that states neither — i.e. fabricating the exact technical evidence this slice was told not to invent.

### 2.3 Is the extraction correct?

**Split verdict: the single sentence is faithful; the article is not, and the address is wrong.**

**Faithful.** The row's text is a complete, self-contained, mandatory source sentence, correctly transcribed and correctly evidenced in `requirement_evidence`.

**Not complete.** The ground-truth page-14 text (`specification_extraction_pages`, `status = Completed`, `confidence = 95`) reads:

```
C. Duct Smoke Detector:
1. The air duct smoke detector shall be an intelligent, non-relay photoelectric type with either
an indoor or NEMA4 watertight enclosure for outdoor use.
2. The UL 268A-listed housing fits square or rectangular footprints and has a twist-lock base
for plug-in detectors.
3. It operates from 100 to 4000 ft/min air velocities and signals trouble if the sensor cover is
removed or improperly installed.
4. Testing can be done locally via magnetic switch or remotely. Sampling tubes are available
in 3, 5, or 10 feet. Strip and clamp terminals support 12 – 18 AWG wiring.
D. Addressable Manual Alarm Call Points:
```

| Sub-clause | Extracted? | Where |
|---|---|---|
| C.1 | Yes | seq 100207 (this row) — `Mandatory` / `Environmental`, `system = Fire Alarm` |
| C.2 | Yes, but **disconnected and mis-scoped** | seq 100208 — `Informational` / `Compliance`, **`system = Unknown`**, same device |
| **C.3** | **No** | absent from v1, v2 **and** v3 (`%4000 ft%` and `%sensor cover%` → 0 rows DB-wide) |
| **C.4** | **No** | absent from v1, v2 **and** v3 (`%magnetic switch%` → 0 rows DB-wide) |

The two rows that do contain the phrase "sampling tubes" (`seq 100348`, `100351`) belong to a **different extraction** (`specextract_be26e1d7-0aa`) and are different sentences, not page-14 C.4.

**Wrong address.** The stored `source_location.article = "1"` and `clause = "1"` are positional artefacts, not a specification address; the true address is `2 PRODUCTS > C. Duct Smoke Detector > 1`. The `clausePath`'s final element is a truncated copy of the clause text itself, and the article header `C. Duct Smoke Detector:` is absent from the path. The `clause_id` (`…chunk_000001_clause_3`) resolves to a **page-1, `1 GENERAL`, article-1** clause shared by **104 requirement rows** — it provides no article-level scoping at all, so the audit trail cannot navigate from this requirement to its true place in the specification.

**Classification:** *extraction defect at the article level (source segmentation + clause addressing), stable across all three extraction versions.* It is therefore a deterministic-parser defect, not a v2→v3 regression. It is **not** a defect specific to this requirement.

### 2.4 Approval decision

**WITHHELD** — Phase 2 Case B (*extraction is wrong or incomplete*). The brief's stop condition *"source evidence contradicts the extraction"* and *"approval would require inventing technical meaning"* both apply: approving 100207 as "the duct-detector requirement" would present a lossy one-quarter of a four-clause device specification as complete governed technical evidence, under an audit trail that points at the wrong clause.

---

## 3. Governed action

**None. No governed action was executed, because no precondition for one was met.**

The canonical governed path was located and verified as usable, so that the *non*-execution is a deliberate, evidence-based choice and not an oversight:

**`POST /api/requirements/:id/approve`** — `worker/specification-extraction-api.mjs:255`, handled by `handleSpecificationExtractionApi` (`:200`), dispatched at `worker/index.ts:265`.

Verified properties (first-hand + corroborated by read-only subagent C):

- **Bounded, per-requirement.** Not bulk.
- **Currency enforced twice** — a `currentRequirement()` gate returning 409 `REQUIREMENT_NOT_CURRENT` (`:255`), and a write-boundary `EXISTS (… currentTechnicalRequirementsFrom('cur') …)` inside the UPDATE itself (`:262`) closing the read→write race. 100207 would have passed both.
- **CAS** on `review_status` (`:262`); `approved_for_downstream` is *derived* (`status === "Approved" ? 1 : 0`), never an input.
- **Audit** — `requirement_review_decisions` + `document_audit_events` inserted in the same batch (`:139-143`), both CAS-guarded so a refused CAS writes no audit row.
- **Actor is server-derived and cannot be impersonated** — `resolveApplicationContext` reads no header, cookie or JWT; it resolves `local-development-user` from the localhost hostname (`worker/application-context.mjs:1-30`). *Caveat recorded:* the product UI does write a client-asserted `reviewedBy` into the free-text `evidence` blob (`app/page.tsx:8462`); it does not touch `decided_by` or `actor_user_id`.
- **Reason required**, `>= MIN_GOVERNED_REASON_LENGTH` (5), else 422 `REVIEW_REASON_REQUIRED`.
- **Cascade** — on a genuine transition, profiles of all Confirmed-linked items are superseded in the same batch, then `refreshRequirementApprovalProfiles` regenerates them inline and awaited (`:286-295`). 100207 has **0 links**, so this cascade would be a no-op.

The route would have worked. It was not used, because the requirement should not have been approved.

**A second structural blocker was also established (see §5.2):** even had the extraction been sound, no bounded single-pair link-creation path exists, so Phase 3 could not have been executed as specified.

---

## 4. Item-F before / after

Item F is `boqitem_ea12a5ee-866f-45db-91a1-621119569551`, "F", description "Duct detector", qty 13, BOQ.xlsx sheet `MECH RFQ` row 21.

| Dimension | Before | Evidence from 100207 | After | Resolved? |
|---|---|---|---|---|
| system | `Fire Alarm` (Approved AI Understanding) | `Fire Alarm` — same | `Fire Alarm` | n/a (already) |
| category | `Detection Devices` | `Environmental` (requirement's own category — a different axis) | `Detection Devices` | No |
| productFamily | `Duct Detector` | not addressed by the clause | `Duct Detector` | n/a (already) |
| manufacturer | none (0) | `manufacturers: []` | none | **No** |
| standard | missing (non-blocking: Clarification + Assumption + Missing Info) | `standards: []` | still missing | **No** |
| compatibility | 0 entries | `compatibility: []` | 0 entries | **No** |
| **compatibilityTarget** | **missing — BLOCKING** | **none; structurally incapable** | **missing — BLOCKING** | **No** |
| environmental | no `IP Rating` attribute | clause states "indoor or NEMA4 watertight enclosure for outdoor use" but `attributes: []` — no structured attribute extracted | still absent | **No** |
| confirmedRequirements | 0 | would become 1 if confirmed (Mandatory) | 0 | n/a — not attempted |
| consolidatedRequirements | 0 | — | 0 | — |
| readiness_status | `Missing Critical Information` | — | `Missing Critical Information` | unchanged |
| blockingReasons | `["compatibilityTarget is required to define a safe Fire Alarm product search boundary."]` | — | identical | unchanged |
| links (active) | 0 | 0 links to 100207 | 0 | unchanged |

**Before and after are byte-identical because nothing was written.**

Current profile (v2, `reqprofile_caaf761e-89fd-479c-89b7-d9eacdf17f53`, `input_fingerprint d1a0cbcebc4e`):
- `consolidatedRequirements: 0`, `standards: []`, `manufacturers: []`, `compatibility: []`, `accessories: []`
- `derivedRequirements`: 1 — *"A compatible detector base is required for each detector unless the approved product includes one."* (non-blocking)
- `confidence_summary`: `itemClassification 78`, `standards 0`, `compatibility 0`, `applicability 0`, `overall 0`
- `profile_issues`: 1 blocking (`compatibilityTarget`), 5 non-blocking
- `profile_requirement_applicability`: **0 rows**
- Links: 3 historical `Suggested` links (to requirements 314, 442, `…1_requirement_53`), **all superseded**; 0 active.

---

## 5. Applicability decision

### 5.1 Decision: not attempted, and not warranted

No applicability confirmation was made. Two reasons, either of which alone is sufficient:

1. **Phase 2 did not produce an approved current requirement.** The brief gates Phase 3 on Phase 2 legitimately producing one. It did not.
2. **The requirement is not a valid applicability unit.** Confirming sub-clause C.1 as "the requirement applying to Item F", while C.2 (the UL 268A listing and plug-in base) sits disconnected under a different system and C.3/C.4 (air-velocity range, sampling-tube lengths, wire gauge) are absent, would encode a knowingly incomplete device specification into Item F's governed baseline. That is `Outcome 3` — the requirement as extracted is not fit to be confirmed against Item F.

### 5.2 Structural finding: no bounded single-pair link path exists

Independently of the extraction defect, MVP-CLOSE-9 Phase 3 was **structurally unreachable**. There are exactly three `INSERT INTO boq_requirement_links` sites, and none creates a link for one specific (item, requirement) pair:

| Site | Route | Scope | Usable here? |
|---|---|---|---|
| `engineering-knowledge-api.mjs:218` | `POST /api/projects/:id/engineering-knowledge/suggest-links` | **project-wide** | No — explicitly out of scope |
| `engineering-knowledge-api.mjs:345` | `POST /api/requirements/:id/propagate-system-wide` | **category-wide by construction** (`:304` iterates `validCategories` over the requirement's system taxonomy) | No — would create Confirmed links for every item in the chosen Fire Alarm categories |
| `engineering-knowledge-api.mjs:386` | `POST /api/requirement-links/:id/(confirm\|reject\|remove)` | transitions an **existing** link (MVP-CLOSE-8 conditional unit) | No — no link exists to transition |

So there is no in-product way to create *one* link for *one* pair. This is a real capability gap, recorded here rather than worked around.

### 5.3 A Confirmed link is not a single bounded action either

Independently established during this slice: adding a Confirmed link changes the BOQ item's **understanding input fingerprint**. For Item F the fingerprint would move from `5e781f0c…1480a` to `5d6ca5e7…f723`, which has three automatic, immediate consequences:

1. `resolveEffectiveUnderstandingInterpretation` returns `state: "UNAVAILABLE_OR_STALE"`, `selected: null`, `classification: null` — interpretation v3 becomes stale.
2. The three `estimator_understanding_field_reviews` rows (`system` / `category` / `productFamily`, all `CONFIRMED`, bound to the *old* fingerprint) stop being current authority, because `currentFieldLevelUnderstandingFacts` filters on `source_input_fingerprint`. The item's review status degrades from `AWAITING_REVIEW` to `NOT_ANALYZED`.
3. `executeProductMatching` gates on `currentUnderstandingAttempt.available` (`worker/product-matching-api.mjs:219-243`) and would now throw `BOQ_UNDERSTANDING_REQUIRED` — **the matching gate breaks**.

So a Confirmed link does not merely add evidence: it **invalidates the currently-approved understanding** and requires a fresh Understanding run plus engineer re-review to restore authority. That is a second, further, and multi-step consequence, meaning Phase 3 could not have been executed as "the minimum confirmation required" even had a bounded per-pair link path existed. Recording this because it is the non-obvious cost of a superficially-small applicability action, and it was not visible from the requirement side.

**Verification note (positive finding).** The MVP-CLOSE-4/5 config-fingerprint repairs **hold for Item F**: the stored fingerprint `1ac6a0bb…f2c` equals `authorizationScopedConfigFingerprint(interpretationConfigFingerprint({…live `.dev.vars` provider/model…}) = 6fb54e06…c5ae8, authorization_fingerprint = a588e49d…6526f3)` exactly, and `interpretationConfigFingerprintIsCurrent(stored, …)` returns `true` via the retry-authorization branch. `currentUnderstandingAttempt.available` is `true` today. An omitted `currentConfigFingerprint` and an explicit `null` are equivalent (the `== null` short-circuit at `worker/effective-understanding-interpretation.mjs:53`); divergence appears only on a non-null mismatch, which correctly collapses the row to `NOT_ANALYZED` / `null` facts.

---

## 6. Compatibility conclusion

## No. Requirement 100207 contains **no** authoritative evidence capable of satisfying Item F's `compatibilityTarget`.

Proven three ways, first-hand:

**(a) The requirement carries no satisfying evidence at all.** `compatibility: []`, `standards: []`, `attributes: []` — and, decisively, **0 rows** in `requirement_compatibility` and `requirement_standards` (§2.2). The profile builder reads those child tables, not the JSON (`worker/technical-requirement-api.mjs:127`), so there is nothing for a link to contribute. The same read is gated on the requirement being downstream-eligible (`technical-requirement-api.mjs:88`: link `status='Confirmed'`, `superseded_at IS NULL`, **and** `r.approved_for_downstream=1`, in current lineage) — a requirement that is merely linked but unapproved contributes nothing either.

**(b) The gate demands a named product or panel.** `app/domain/technical-requirement-engine.mjs:218`:

```js
compatibilityTarget: compatibility.some((item) => item.targetItem || item.rightEntityId) ? true : null
```

with the in-code rationale at `:306-312`: *"detectMissingInformation's `compatibilityTarget` gate specifically requires one of those fields (a named compatible PRODUCT/PANEL, not merely 'supports this protocol')."*

**(c) Every other input to `compatibility` is empty in this project.** The array is built at `:320` from three sources. `engineering_relationships` → **0 rows**. `engineering_facts` (Source Facts) → **0 rows**. Only Confirmed-link requirement arrays remain, and 100207's is `[]`.

**Even if 100207 were approved and Confirmed, `compatibilityTarget` would remain unsatisfied and Item F would stay `Missing Critical Information` with the identical blocking reason.** This was confirmed by executing the real `buildTechnicalRequirementProfile` against a synthetic Confirmed link to 100207 as persisted: `standards = 0`, `compatibility = 0`, missing = `standard` (non-blocking) + `compatibilityTarget` (**blocking**), readiness = `Missing Critical Information`. A Confirmed link is a **necessary but not sufficient** condition.

**How far the ladder would actually have to climb.** `calculateReadiness` (`technical-requirement-engine.mjs:247-254`) is a first-match-wins ladder, so Item F is blocked at rung 3 (`:250`, any blocking missing field) and has three further rungs behind it:

| Rung | Requirement | Item F today |
|---|---|---|
| `:250` | no blocking missing field | ❌ `compatibilityTarget` |
| `:251` | ≥1 consolidated requirement at `Mandatory`/`Critical Mandatory` | ❌ 0 requirements |
| `:252` | `confidence.overall >= 80` | ❌ `overall: 0` |
| `:253` | `Ready for Matching` | — |

Clearing only `compatibilityTarget` therefore lands Item F at `:251` → `Needs Technical Review`, **not** green. Populating a standards and a compatibility sub-row does reach `Ready with Warnings` — but **not** `Ready for Matching`, because `confidence.overall` is the minimum across the required confidence dimensions and `accessories` is still 0, holding it at 0 against the `< 80` gate. And `Ready for Matching` is still not sufficient operationally: `approved_for_matching` is a **separate human step** (`POST .../approve-readiness`, `technical-requirement-api.mjs:495`), which refuses with 409 `READINESS_BLOCKED` unless `readiness_status === "Ready for Matching"` **exactly** — `Ready with Warnings` is rejected. Item F is currently `approved_for_matching = 0` with `approved_by`, `approved_at` and `approval_reason` all empty.

This is why the brief's framing — that `Missing Critical Information` may be the correct final state — is right for a reason deeper than "one field is missing".

**Nothing was synthesised.** Compatibility was not inferred from shared system, shared category, shared product family, the clause's mention of a "twist-lock base", the UL 268A listing, or the existence of a `Flash Scan®/CLIP` clause elsewhere in the document. Per the brief, those are not evidence accepted by the project's technical-authority policy.

### 6.1 Wider observation: no duct-detector compatibility target exists anywhere

Across all 513 current requirements in this project, only **4** carry a `compatibility` entry with `targetItem`/`rightEntityId` — and **none is a duct-detector requirement**:

| Seq | Target named | Approved? |
|---|---|---|
| 100160 | *"any detector mounting base"* (intelligent analogue detectors) | No |
| 100197 | *"Flash Scan® and CLIP protocol systems"* (the single Approved current requirement) | **Yes** |
| 100268 | *"the fire-fighters' telephone jack"* | No |
| 100433 | *"the mechanical fire protection equipment"* | No |

**The specification contains no clause naming a panel, protocol or control unit as the duct detector's compatibility target.** Page 14 article C constrains *type, intelligence, enclosure, air-velocity range and mounting* — it never states what the duct detector must be compatible *with*. This is a genuine, permanent evidence gap, not a pending review. `100197`'s `Flash Scan®/CLIP` target attaches to a different device class and must not be transferred to a duct detector by analogy.

Item F's blocker is therefore **correctly** open.

---

## 7. Tests and runtime evidence

No source code was changed by this slice, so no regression was introduced and no targeted suite was warranted. The following read-only checks were run.

| Check | Result |
|---|---|
| Live `GET /api/requirements/specjob_2ee1d387-…_requirement_207` on `localhost:4183` | **HTTP 200**; `review_status: Needs Review`, `approved_for_downstream: 0` — route live, before-state confirmed |
| Currency predicate (`currentTechnicalRequirementsFrom('r')`) | 100207 **in** current set; retired 76af1f32 **absent** |
| Ground-truth page text (`specification_extraction_pages`, page 14) | `Completed`, confidence 95 — 4-sub-clause article C verified verbatim |
| Sub-clause C.3 / C.4 presence | 0 rows DB-wide, across v1/v2/v3 |
| Blocker authority read | `technical-requirement-engine.mjs:212-219`, readiness ladder `:247-254` |
| Link-creation writer inventory | 3 sites, none bounded per-pair (`engineering-knowledge-api.mjs:218/345/386`) |
| `engineering_relationships` / `engineering_facts` in project | **0 / 0 rows** |
| Dev server | PID 66503, started 2026-09-27 18:36:56 — **never restarted** |

**Live DB unchanged after the slice** (identical to the MVP-CLOSE-8 baseline):

```
boq_requirement_links            3195   (active 1963)
engineering_knowledge_decisions    115
requirement_profile_versions       575
technical_requirements           19893
requirement 100207   Needs Review / adv=0     review decisions: 0
```

Three read-only subagents were dispatched with non-overlapping scopes (specification lineage / Item-F downstream / governed review path). **All three returned and all findings were reconciled against first-hand verification; no finding was relied on unverified.** The extraction-completeness claim was re-derived independently from `specification_extraction_pages` before being acted upon.

The headline conclusion was reached **independently, twice, by different routes**:

- **Primary, from data + code:** requirement 100207 has `compatibility: []` and 0 rows in `requirement_compatibility`; the gate at `technical-requirement-engine.mjs:218` requires `targetItem`/`rightEntityId`; `engineering_relationships` and `engineering_facts` are both empty project-wide. → contributes nothing.
- **Subagent B, by execution:** it built a synthetic Confirmed link to 100207 as persisted and ran the real `buildTechnicalRequirementProfile`, obtaining `standards = 0`, `compatibility = 0`, `standard` (non-blocking) + `compatibilityTarget` (**blocking**), readiness `Missing Critical Information` — the unchanged state.

Two subagent findings corrected or extended the primary analysis and have been incorporated: the **0 sub-row** fact (§2.2, the sharper form of the empty-array finding), and the **understanding-invalidation** consequence of a Confirmed link (§5.3). One primary claim was **refined**: `Ready with Warnings` — not `Ready for Matching` — is the ceiling reachable with satisfying sub-rows, because `confidence.overall` remains 0 while `accessories` is 0 (§6). A finding that the product UI writes a client-asserted `reviewedBy` into the free-text `evidence` blob was recorded but is not a defect introduced or worsened by this slice.

Additional runtime-verified items: Item F's understanding config fingerprint **is** current (MVP-CLOSE-4/5 repairs hold, §5.3); `loadInputs` sub-row counts for requirement 100207 are all 0; the three dead links' `autoConfirmation.eligible = false` reasons; and the staleness of the existing `matchrun_57e4220f…` (bound to superseded profile v1).

---

## 8. Files changed

**By this slice:**

| Path | Change |
|---|---|
| `docs/MVP-CLOSE-9-DUCT-DETECTOR-CURRENT-REQUIREMENT-ITEM-F.md` | **new** (this report) |

That is the entire footprint. All analysis scripts were written outside the repository, under the session scratchpad.

**Pre-existing dirty files:** 755 (unchanged from the slice start; shared work belonging to other agents). The two MVP-CLOSE-7/8 source files (`worker/engineering-knowledge-api.mjs`, `app/domain/engineering-knowledge.mjs`) remain modified exactly as that chain left them; this slice did not touch them.

**Business-state records intentionally changed:** **none.** No requirement approval, no link creation, no link transition, no profile regeneration, no understanding invalidation, no audit row, no direct SQL write.

---

## 9. Remaining limitations

1. **The duct detector's specification is only one quarter extracted.** C.3 (100–4000 ft/min air velocity; sensor-cover supervision) and C.4 (local/remote test method; 3/5/10 ft sampling tubes; 12–18 AWG strip-and-clamp terminals) are absent from all three extraction versions. Until this is understood, **no** duct-detector requirement can be treated as a complete device specification.
2. **`source_location.article`/`clause` and `clause_id` are not specification addresses.** A page-14 requirement carries `article: "1"`, `clause: "1"` and a `clause_id` resolving to a page-1 clause shared by 104 rows. This degrades every audit trail that depends on locating a requirement in its source document, and it is generic rather than local to 100207.
3. **Sibling `system` inference is inconsistent for the same device** — 100207 is `Fire Alarm`, 100208 (same duct detector) is `Unknown`.
4. **Category assignment is lossy, and it demonstrably suppresses auto-confirm.** 100207's `requirement_category` is `Environmental`; the clause is about detector type and enclosure. All three of Item F's dead links record the refusal directly in their `evidence` JSON: `autoConfirmation.eligible = false`, `reasons: ["category-mismatch-or-generic", "equipment-type-not-exact", "not-applicable-candidate"]`, with `effectiveContext.boq = {system:"RAW_BOQ", category:"RAW_BOQ", equipmentType:"RAW_BOQ"}` (they were generated before the item had an approved Understanding). The classifier is working as designed — the extraction is feeding it the wrong category.
5. **`compatibilityTarget` for Item F is unresolvable from the specification** (§6.1). It cannot be cleared by approving more requirements. It requires either an engineering determination against the approved control-panel item, or a recorded permanent gap.
6. **No bounded per-pair link-creation path exists** (§5.2). Every link a project acquires today arrives via a project-wide or category-wide operation. This is the single biggest obstacle to governed, per-item specification work in this project.
7. **59 approvals remain stranded** on superseded lineages, and exactly **1** current requirement is `Approved` + `approved_for_downstream = 1` (seq 100197). Untouched by this slice, by design.
8. **Unverified at runtime** (source-derived only, from read-only subagent C, not executed here): the `approve` route's profile cascade is gated on `operation === "approve"`, so `reject`/`restore`/`update` revoke `approved_for_downstream` **without** superseding or regenerating profiles; and the route never inspects `meta.changes` on its UPDATE, so a lost CAS can still return 200 with a payload reflecting another actor's decision.
9. **A Confirmed link silently invalidates the item's approved understanding** (§5.3), degrading it to `NOT_ANALYZED` and breaking the matching gate until a fresh Understanding run and re-review. Any future applicability work must sequence this deliberately, or it will trade one blocker for a worse one.
10. **The matching gate does not consult readiness at all.** `executeProductMatching` (`worker/product-matching-api.mjs:219-243`) requires only a resolvable item, a current profile (**auto-generated if absent**, explicitly not gated on readiness) and `currentUnderstandingAttempt.available`. Neither `readiness_status` nor `approved_for_matching` is read anywhere in that module. Item F would therefore **pass the matching gate today**, while its own profile reads `Missing Critical Information` and its `consolidatedRequirements` is empty — so a run would not enforce `compatibilityTarget` as a mandatory failure. One such run already exists (`matchrun_57e4220f…`, status `Discovery Only`, 10 candidates), and it is already **stale**: it is bound to profile v1, superseded by v2. *Recorded as an observation, not repaired — out of scope for this slice, and no match run was started or altered.*

---

## 10. Test-inventory state

**`npm run test:all` is RED — on the drift gate, not on a test failure.**

```
REL-003 DRIFT GATE FAILED: the safe/excluded boundary changed (2 added, 0 removed).
  + tests/mvp-bom-2-expansion-identity.test.mjs|SAFE
  + tests/mvp-sizing-1-expansion-evidence-laziness.test.mjs|SAFE
```

Two unclassified files, **both owned by other agents**:

- `tests/mvp-sizing-1-expansion-evidence-laziness.test.mjs` — MVP-SIZING-1 (technical agent). Unchanged since MVP-CLOSE-8.
- `tests/mvp-bom-2-expansion-identity.test.mjs` — **new since MVP-CLOSE-8**; another agent's slice landed during this one.

Neither was recorded, modified, or classified by this slice. `--write-baseline` was deliberately **not** run: it would silently classify both other agents' files and destroy the ownership signal this gate exists to provide. Resolving this requires those agents to classify their own tests, or an explicit, separately authorized baseline record.

---

## 11. Next smallest project-progress step

**One bounded, read-only slice: a specification-extraction completeness audit of the page-11–14 detector articles in `28 46 00`, scoped to measuring clause loss — no writes, no approvals, no re-extraction.**

For each detector article on pages 11–14 (`Multi-Sensor Smoke/CO`, `Fixed Temperature/Rate of Rise`, `Photoelectric Smoke Detectors`, `C. Duct Smoke Detector`, `D. Addressable Manual Alarm Call Points`): count source sub-clauses against extracted `technical_requirements` rows, and report the per-article loss rate with verbatim quotes for each dropped sub-clause.

**Why this and not the 59 orphan approvals:** the 59 stranded approvals are a *bookkeeping* problem whose repair is already well understood. This is a *correctness* problem that gates it. Page 14 article C lost two of four sub-clauses with no error, no ambiguity flag and no audit event; if that is systemic rather than local, then migrating or re-issuing approvals across the current lineage would manufacture technical evidence that does not exist in the document — converting a recoverable lineage defect into permanent, approved, wrong evidence. The audit is read-only, costs one slice, and its answer determines whether any approval work downstream is legitimate.

**Explicitly not recommended now:** bulk approval, orphan-lineage repair, the C.3/C.4 extraction fix itself (generic — affects many requirements, and is a stop condition for this slice's scope), and any attempt to clear Item F's `compatibilityTarget`, which no requirement in the project can satisfy.

---

## 12. Final statement

> No commit, push, deployment, restart, bulk approval, orphan-lineage repair, sizing change, or unrelated business-state mutation was performed.

The canonical dev server (PID 66503, `:4183`) was never restarted. The live D1 database is byte-for-byte unchanged at 3195 links / 1963 active / 115 knowledge decisions / 575 profile versions, and requirement 100207 remains `Needs Review` with `approved_for_downstream = 0` and zero review decisions. No human reviewer was impersonated and no fabricated `link_method` or reviewer metadata was written, because no review was recorded at all.

Specifically **not** done: no missing sub-clause C.3/C.4 was authored into the extraction; no `requirement_compatibility` or `requirement_standards` row was created; the stale `matchrun_57e4220f…` was observed and reported but **not** started, superseded, or altered; and no re-extraction was triggered. The live database was opened read-only throughout — one subagent worked from a scratch copy of it.
