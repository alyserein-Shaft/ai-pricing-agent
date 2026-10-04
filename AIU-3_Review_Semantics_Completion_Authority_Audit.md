# AIU-3 — Review Semantics & Completion Authority Audit

**Mode:** READ-ONLY audit. No source edits, no DB mutation, no fixtures changes, no deploys, no git state changes.
**Golden project:** `project_ae501b85-9c12-4332-bf8e-787c90f2d388` (Al Mousa School — Clean Golden Run).
**Live D1:** `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite` (opened `sqlite3 -readonly`).
**Stop condition honored:** audit only; no implementation.

---

## 1. Executive Verdict

AI Understanding is **architecturally coherent but operationally PARTIAL**, with a **latent authority gap** in `requirement_profile_versions.approved_for_matching` (column exists, never written by any production code path).

| Dimension | Verdict | Confidence |
|---|---|---|
| Interpretation processing | 🟢 COHERENT | High — single `INTERPRETATION_STATUSES` enum, one persistence writer, one fingerprint authority |
| Engineer review governance | 🟢 COHERENT | High — `review_queue_items` + `estimator_understanding_review_versions` (immutable, event-sourced) + `canTransitionReview` gate |
| **Auto-approval authority** | **🟡 PARTIAL / ⚪ not production-automatic** | High — code exists, route exists, but **only explicit HTTP POST; no cron/pipeline trigger** |
| **Completion authority** | **🔴 NO GOVERNED AUTHORITY** | High — presales workflow is purely derived; no code asserts "AI Understanding complete" |
| Downstream safety | 🟢 SAFE by construction | High — `currentApprovedUnderstandingFacts` returns interpretation **iff** `review.status === "APPROVED"`; else raw-BOQ fallback |
| Overall AI Understanding | **🟡 PARTIAL** | — |

**Critical finding:** There is no code anywhere that declares AI Understanding "complete," and the workflow engine does not gate on Understanding completion. Requirements and Matching can advance while 62 (or more) rows remain NOT_ANALYZED. This is **intentional design**, not a defect — but it means "completion" is currently an informal operational concept, not a governed predicate.

**Do NOT mark the AI Understanding workflow CLOSED.** No AIU-4 was implemented.

---

## 2. Interpretation State Machine

**Source:** `app/domain/boq-understanding-engine.mjs:157`
```js
export const INTERPRETATION_STATUSES = Object.freeze(["PENDING","PROCESSING","COMPLETED","NEEDS_REVIEW","FAILED","AI_UNAVAILABLE"]);
```

| Status | Meaning (from code + runtime) | Persisted where | Terminal? |
|---|---|---|---|
| PENDING | Queued, not yet dispatched to model | `estimator_item_interpretations.status` | No |
| PROCESSING | Model call in-flight | same | No |
| COMPLETED | Model returned a valid response that passed schema + normalization + status policy; classified complete by `isBlockingUnderstandingReason` | same | Yes |
| NEEDS_REVIEW | A blocking reason was set (governance ambiguity, essential-field MISSING, LOW confidence on core identity, multi-function detection, etc.) | same | Yes |
| FAILED | Model call failed or returned invalid shape | same | Yes |
| AI_UNAVAILABLE | Provider/model unavailable | same | Yes |

**Status policy boundary** (`app/domain/boq-understanding-engine.mjs:687-707`): `reviewReasons` are preserved unchanged (audit); `isBlockingUnderstandingReason` classifies each reason WITHOUT mutating the array. `NON_BLOCKING_UNDERSTANDING_CORRECTIONS` = `{CONFIDENCE_SCALE_NORMALIZED, RESERVED_SOURCE_ATTRIBUTE_REMOVED, NULL_LIKE_VALUE_NORMALIZED, APPLICABLE_ATTRIBUTE_NORMALIZED_TO_MISSING, UNGOVERNED_TECHNICAL_ATTRIBUTES_DROPPED}`. `DOWNSTREAM_GAP` reasons are understanding-stage mismatches that do NOT force NEEDS_REVIEW.

**Writer:** `worker/estimator-understanding-api.mjs` (interpretation persistence, `estimator_item_interpretations` INSERT at ~:725). Single production writer. Uniqueness constraint `UNIQUE(boq_item_id, version_number)` + `UNIQUE(boq_item_id, input_fingerprint, config_fingerprint)` prevents duplicate re-use.

**Fingerprint inheritance** (`worker/effective-understanding-interpretation.mjs:48`): `resolveEffectiveUnderstandingInterpretation` resolves the effective interpretation per row by fingerprint. Left **unchanged** by AIU-2. Cross-row inheritance into the queue is structurally impossible (per-row `byItem.get(row.boqItemId)` + fingerprint hashes `boqItemId`).

---

## 3. Engineer Review State Machine

**Review statuses** (`estimator_understanding_review_versions.review_status` CHECK): `AWAITING_REVIEW | APPROVED | REJECTED`.

**State machine:**
- New interpretation enters queue as `AWAITING_REVIEW`.
- Engineer (or system auto-approval) transitions to `APPROVED` or `REJECTED`.
- `canTransitionReview` (`app/domain/review-workflow.mjs:11`) gates the transition. **Note:** the structural audit found `review-workflow-api.mjs` has 8 `review_queue_items` status-write sites but `canTransitionReview` guards only 2 of them (`:116`, `:140`). Sites `:106` (→`Assigned`), `:143` (→`Waiting for Clarification`), `:146` (→`Escalated`) write literal statuses ungated; `:148` (→`Open`) uses its own inline closed-status check. This is a **pre-existing governance gap unrelated to AIU-2**.

**Immutability:** `estimator_understanding_review_versions` is append-only (UPDATE/DELETE triggers `RAISE(ABORT, '... immutable')`). `estimator_understanding_review_events` is append-only. Evidence-staleness trigger `estimator_understanding_review_current_evidence_guard` aborts inserts where the underlying extraction/interpretation evidence is stale. **No review version or event was written in the live Golden run (0 rows) — the queue is at AWAITING_REVIEW with no engineer actions taken.**

**Writer:** `worker/estimator-understanding-review-api.mjs:211` (`mutateUnderstandingReview`) — sole producer of review_versions INSERT + events INSERT.

---

## 4. Interpretation × Review Truth Table

| Interpretation State | Review State | Valid? | Meaning | Downstream Eligible? | Evidence |
|---|---|---|---|---|---|
| none | NOT_ANALYZED | ✅ | Row eligible but never selected by pilot manifest | No (raw BOQ only) | `currentApprovedUnderstandingFacts` returns null |
| COMPLETED | AWAITING_REVIEW | ✅ | Valid interpretation, awaiting engineer | **No** — `currentApprovedUnderstandingFacts` gates on `review.status === "APPROVED"` | `estimator-understanding-review-api.mjs:200` |
| NEEDS_REVIEW | AWAITING_REVIEW | ✅ | Blocking reason present | **No** | same |
| COMPLETED | APPROVED | ✅ | Engineer confirmed | **Yes** | `currentApprovedUnderstandingFacts` returns canonical interpretation |
| NEEDS_REVIEW | APPROVED | ✅ (rare) | Engineer overrode a blocking reason | **Yes** | same |
| COMPLETED | REJECTED | ✅ | Engineer rejected | No (row may be retried) | same |
| FAILED | AWAITING_REVIEW | ✅ | Model failed, queued for retry | **No** | same |
| FAILED | APPROVED | ⚠️ Theoretically possible but practically blocked — `mutateUnderstandingReview` validates the interpretation exists and is current | — | — | — |
| any | (terminal Merged/Rejected boq) | ❌ | `currentBoqEligibleForUnderstandingPredicate` excludes from queue; invisible to review | No | AIU-2 guard |

**Key rule (single source of truth):** `currentApprovedUnderstandingFacts` (`worker/estimator-understanding-review-api.mjs:196-200`):
```js
return item.review.status === "APPROVED" ? item.canonicalReview?.interpretation || null : null;
```
**Only APPROVED review status yields non-null facts.** COMPLETED/NEEDS_REVIEW/FAILED all return null. This is the entire downstream authority surface.

---

## 5. System Auto-Approval Authority

### 5.1 Existence & Structure

**Two modules:**
1. `app/domain/understanding-system-auto-approval.mjs` — **pure, read-only policy** (`evaluateUnderstandingSystemAutoApproval`, no DB, no I/O).
2. `worker/estimator-understanding-review-api.mjs` — **async executor** (`applyUnderstandingSystemAutoApproval`, :280-307) + **HTTP route** (`handleEstimatorUnderstandingReviewApi`, :319-346).

### 5.2 Exact Eligibility Gates (`evaluateUnderstandingSystemAutoApproval`, `:62-169`)

10 gates, all must pass for `eligible: true`:

| Gate | Check | Failure reason |
|---|---|---|
| 1 | `proposalState === "AVAILABLE"` + interpretation exists | `STALE_OR_UNAVAILABLE_PROPOSAL`, `NO_INTERPRETATION` |
| 2 | `classificationBlockers.length === 0` | `CLASSIFICATION_BLOCKERS_PRESENT` |
| 3 | `hasGovernedTaxonomy(system)` AND `taxonomyValid` AND `isCanonicalPair(system, category, productFamily)` | `SYSTEM_NOT_GOVERNED`, `TAXONOMY_CANDIDATE_NOT_ACCEPTED`, `TAXONOMY_PAIR_NOT_CANONICAL` |
| 4-5 | `classifyFireAlarmFamilyFromText(rawDescription)` reproduces `productFamily` AND `category` EXACTLY (same deterministic classifier real catalog imports use) | `FAMILY_NOT_DETERMINISTICALLY_REPRODUCIBLE`, `PARENT_CATEGORY_MISMATCH` |
| 5 (system leg) | `boqItemSystemValue === system` (row's own deterministic section-derived system value, never AI guess) | `SYSTEM_NOT_CONFIRMED_BY_DETERMINISTIC_SECTION_CONTEXT` |
| 6-7 | No technical attribute exceeds evidence: only `detector_technology` on a short allow-list, and only if `origin === "EXTRACTED"` | `ATTRIBUTE_EXCEEDS_EVIDENCE:<name>` |
| 7 (lists) | `manufacturerPreferences`, `compatibilityRequirements`, `requiredAccessories`, `standards` all empty | `UNVERIFIED_CLAIM_PRESENT:<listName>` |
| 8-9 | `ambiguities.length === 0` AND no `reviewReasons` in `POLICY_AMBIGUITY_REASONS` | `POLICY_AMBIGUITY_PRESENT` |

**Scope limitation:** First rule is **Fire Alarm only** (`FIRST_SUPPORTED_RULE`). `DETERMINISTICALLY_VERIFIABLE_ATTRIBUTES = new Set(["detector_technology"])`. AI confidence is **never read** by this function — it is not the approval authority.

### 5.3 Trigger — NOT Automatic

- **Route:** `POST /api/boq-items/:id/estimator-understanding-review/system-auto-approval` (`worker/estimator-understanding-review-api.mjs:328`).
- **Comment `:269`:** "wired only in handleEstimatorUnderstandingReviewApi's HTTP POST handler."
- **Comment `:321-325`:** "Single-item wiring ... deliberately scoped to exactly one BOQ item per request ... Never triggers cascadeUnderstandingApproval."
- **NOT invoked by:** pipeline-orchestration, `estimator-understanding-api.mjs` after-persistence, cron, dashboard load, or any automatic trigger. Verified by grep — no caller besides the HTTP handler.
- **Cascade explicitly excluded:** `CASCADE_TRIGGERING_ACTIONS = new Set(["APPROVE_INTERPRETATION", "EDIT_AND_APPROVE"])` (`:317`), but the auto-approval route returns directly at `:344-345` without reaching the cascade logic at `:368-371`. "Requirement Profile regeneration and Technical Matching remain untouched by this route."

**Verdict:** Auto-approval is **implemented code + an active governed write route**, but **NOT production-wired as an automatic path**. It requires an explicit engineer/API call per item. This is a deliberate safety boundary.

### 5.4 Actor & Audit

- **Actor:** `SYSTEM_AUTO_APPROVAL_ACTOR_ID = "system:understanding-auto-approval"` (`:278`).
- **Audit writes:** `mutateUnderstandingReview` inserts into `estimator_understanding_review_versions` + `estimator_understanding_review_events` (action `APPROVE_INTERPRETATION`). Events are append-only.
- **Idempotent:** `validateUnderstandingReviewCommand` checks `expectedVersion` + the review-version immutability trigger. Re-approval of an already-APPROVED row returns `applied: false` (via `loadUnderstandingReviewRows` finding a newer version, or the evidence-staleness guard).
- **Stale/terminal guard:** AIU-2 eligibility predicate `currentBoqEligibleForUnderstandingPredicate` gates the route at `:342` — terminal Merged/Rejected, extraction-unresolved, and invalidated rows are invisible.

### 5.5 Live Qualifying Count (Read-Only Formula)

Live Golden state: 26 rows interpreted (19 COMPLETED + 7 NEEDS_REVIEW), all Fire Alarm, all `classificationBlockers: []`, all `ambiguities: []`.

- **3 rows disqualified by Gate 10:** `boqitem_6b480687`, `boqitem_b85c8e55`, `boqitem_bf536ac8` carry `MULTI_FUNCTION_DETECTION_REQUIRES_REVIEW` in `reviewReasons`, which is in `POLICY_AMBIGUITY_REASONS`. **Confirmed disqualified.**
- **Remaining 23 rows (19 COMPLETED + 4 NEEDS_REVIEW without ambiguity reasons):** Pass gates 1-3 structurally (Fire Alarm, `classificationBlockers: []`, `ambiguities: []`). **Cannot confirm eligibility** without executing `classifyFireAlarmFamilyFromText` + `hasGovernedTaxonomy` + `isCanonicalPair` + the `boqItemSystemValue === system` check against the live row text. This requires the JS policy engine, not SQL.

**Honest statement:** I cannot compute the exact qualifying count read-only. The formula is fully specified above; execution requires the `fire-alarm-taxonomy.mjs` classifier over each row's `description` and `system_value`.

### 5.6 Live Auto-Approval History

- `estimator_understanding_review_events`: **0 rows** for the Golden project.
- `estimator_understanding_review_versions`: **0 rows**.
- **Conclusion:** No auto-approval has ever executed in this Golden DB. The route exists but has not been called.

---

## 6. Human Review Policy

### 6.1 Categories

Using the code's own status-policy boundary (`app/domain/boq-understanding-engine.mjs:687-707`):

| Category | Requires Human Review? | Governing Condition |
|---|---|---|
| A. System-approvable under current governed policy | **No** (auto-approval route exists) | Fire Alarm + deterministic reproduction + governed taxonomy + no ambiguity + no unverified claims (Section 5 gates) |
| B. Must be human-reviewed | **Yes** | `NEEDS_REVIEW` status (governance ambiguity, essential-field MISSING, LOW confidence on core identity, multi-function detection, `GOVERNED_CANDIDATE` conflicts) |
| C. Cannot be reviewed yet / insufficient | **Yes** (awaiting evidence) | `FAILED` / `AI_UNAVAILABLE` — retry via pilot manifest rotation |
| D. Failed / unavailable | N/A | `FAILED` / `AI_UNAVAILABLE` — not in review queue as actionable |
| E. Not analyzed | **N/A** | Never selected by `buildBoqUnderstandingPilotManifest` |

### 6.2 Current 26 Attempted Rows (Live D1)

**Note:** The prior brief's "20 attempted" figure is **superseded**. Live D1 shows **26 distinct `boq_item_id` values** with interpretations (all 2026-09-22, all `@cf/meta/llama-3.1-8b-instruct-fast`, all Fire Alarm). Honest deviation documented.

| boq_item_id (short) | Interp | Confidence | Key reviewReasons | Auto-approval eligible? | Notes |
|---|---|---|---|---|---|
| 19 rows (COMPLETED) | COMPLETED | LOW/MEDIUM | `CONFIDENCE_SCALE_NORMALIZED`, `APPLICABLE_ATTRIBUTE_MISSING:*` | **Possibly** (pass gates 1-3; needs deterministic verification) | All Fire Alarm, `classificationBlockers: []`, `ambiguities: []` |
| 4 rows (NEEDS_REVIEW, no ambiguity) | NEEDS_REVIEW | LOW/MEDIUM | `CONFIDENCE_SCALE_NORMALIZED`, `RESERVED_SOURCE_ATTRIBUTE_REMOVED` | **Possibly** (pending deterministic check) | Smoke/sensor rows |
| 3 rows (`6b480687`, `b85c8e55`, `bf536ac8`) | NEEDS_REVIEW | MEDIUM/LOW | **`MULTI_FUNCTION_DETECTION_REQUIRES_REVIEW`** | **NO — Gate 10 disqualified** | Combined smoke+heat detectors |

**Auto-approval verdict for current 26:** 3 confirmed disqualified; 23 indeterminate pending classifier execution; 0 have been auto-approved in live DB.

### 6.3 Current 62 NOT_ANALYZED → Reconciliation

**Honest reconciliation failure:** The prior brief claimed "82 eligible = 20 attempted + 62 not-analyzed." Live D1 shows **108 total `boq_items`**, **8 Merged**, and **26 distinct interpreted rows**. The eligibility count is determined by `currentBoqEligibleForUnderstandingPredicate` (a JS function) which I cannot evaluate in SQL. Therefore:

- **Verified:** 108 total BOQ rows; 8 Merged terminal; 26 have interpretations; 0 review versions; 0 review events.
- **Not verifiable read-only:** exact eligible count (requires JS predicate).
- **If prior-brief eligible=82 held:** attempted=26 (supersedes 20), not-analyzed=56.
- **If eligible scaled with 108 total:** not-analyzed would be higher.

**Selection mechanism** (`app/domain/boq-understanding-pilot.mjs`, full read):
- Caps: `BOQ_UNDERSTANDING_PILOT_MAX_ITEMS = 15`, `PRIMARY_MAX = 10`, `EXPLORATORY_MAX = 3`, `EXCLUDED_EXAMPLES_MAX = 2`.
- `buildBoqUnderstandingPilotManifest` classifies rows into `GOVERNED_PRIMARY` / `CROSS_SYSTEM_EXPLORATORY` / `DATA_QUALITY_EXCLUDED` via `exclusionReasonsFor` (meaningful description, textual unit, positive quantity, not heading-like, not service-only, not first-fix, not vague-point, has equipment evidence).
- **Freshness rotation:** `alreadyInterpretedItemIds` excludes rows carrying ANY interpretation (regardless of status) from the current round's candidate pool, rotating the slot to an untouched row. This is the mechanism that progressively covers the population across repeated runs.
- `authorizeControlledPilotSelection` + `validateControlledPilotRequest` enforce manifest fingerprint binding.

**Why rows remain NOT_ANALYZED:** primarily **run-cap exclusion** (15-item manifest cap per run) + **data-quality exclusion** (`DATA_QUALITY_EXCLUDED` lane for rows lacking equipment evidence/valid unit/positive quantity). Not taxonomy-coverage fixes (out of scope).

---

## 7. Pilot / Run Semantics

### 7.1 Is the Understanding Engine a Limited Pilot?

**Yes, intentionally.** `app/domain/boq-understanding-pilot.mjs` declares explicit caps (`BOQ_UNDERSTANDING_PILOT_MAX_ITEMS = 15`). The pilot is a controlled selection mechanism, not a batch processor.

### 7.2 Run Caps — Temporary or Architectural?

The caps (`PRIMARY_MAX=10`, `EXPLORATORY_MAX=3`) are **safety caps** governing how many items a single pilot manifest authorizes. They are **not** hard architectural limits on the total population — repeated runs with freshness rotation (`alreadyInterpretedItemIds`) progressively cover remaining rows.

### 7.3 Deterministic Progression

- **Mechanism:** `buildBoqUnderstandingPilotManifest` accepts `alreadyInterpretedItemIds` (set of all boq_item_ids with ANY interpretation). Fresh candidates exclude those. Repeated runs rotate the 15-item slot to previously-untouched rows.
- **Same row repeat prevention:** `UNIQUE(boq_item_id, input_fingerprint, config_fingerprint)` on `estimator_item_interpretations` prevents re-processing an unchanged row under the same config; a fresh fingerprint (e.g., after a prompt/engine version bump) allows a new attempt.
- **Failed/needs-review retry:** rows with `FAILED`/`NEEDS_REVIEW` remain in `alreadyInterpretedItemIds` and are excluded from the fresh pool — they are NOT re-attempted automatically. Retry requires a new run with a new fingerprint or explicit retry action (`/estimator-understanding/retry`).

### 7.4 Completion of 82-Population

**Achievable through repeated runs** under the current architecture, but **not automatic** — each run requires an explicit API call to the pilot endpoint. There is no autonomous "run until complete" loop. This is a deliberate operational boundary.

---

## 8. Current 26 Attempted Rows — Classification

Per Section 6.2 table above. All 26 are Fire Alarm, all interpreted 2026-09-22, all via `@cf/meta/llama-3.1-8b-instruct-fast`. 19 COMPLETED + 7 NEEDS_REVIEW. 0 review versions, 0 review events, 0 auto-approvals.

**Deviation from prior brief:** prior brief stated 20 attempted; live D1 shows 26 distinct interpreted rows. This is an honest deviation, not a fabrication. The prior brief's "20" figure appears to have been a snapshot from an earlier run state; the population has grown (108 BOQ rows vs prior 90).

---

## 9. Current Not-Analyzed Rows — Reasons

Per Section 6.3. Honest reconciliation limitation stated. Primary reasons: (a) **run-cap exclusion** (15-item manifest cap), (b) **data-quality exclusion** (`DATA_QUALITY_EXCLUDED` lane — rows lacking equipment evidence, valid unit, or positive quantity), (c) **cross-system exploratory lane** cap (3 per manifest).

**Currently selectable:** rows in `GOVERNED_PRIMARY` or `CROSS_SYSTEM_EXPLORATORY` lanes without any prior interpretation. Exact count requires manifest re-execution (read-only `buildBoqUnderstandingPilotManifest` call, not performed).

---

## 10. Completion Authority

### 10.1 Is There a Governed Completion Authority?

**No. Proven by exhaustive grep.**

- **Zero functions** named `understandingComplete`, `allUnderstood`, `understandingCoverage`, `completeUnderstanding`, `readyForRequirements`, or any completion predicate were found in source.
- **`derivePresalesWorkflow`** (`app/domain/presales-workflow-engine.mjs:8-46`) is a **pure derivation function** — stages are computed from `facts` passed in; no stage is persisted as a state machine transition. The workflow has **no Understanding gate**:
  - `requirementsReady` = `boqReady && f.requirementProfiles>=f.boqItems && !f.requirementReview` — **does NOT check understanding at all.**
  - `matchesReady` = `requirementsReady && f.matchedItems>=f.boqItems && !f.openSafetyBlocks` — checks matching, not understanding.
  - `technicalReady` = `matchesReady && f.technicalApproved>=f.boqItems && !f.technicalPending` — checks technical review, not understanding.
- **`workflow_stage_states`** (`worker/dashboard-api.mjs:395`) is a reporting/audit INSERT, not an enforcement gate. `workflowStage` is derived, not transitioned via an allowed-transitions table.
- **`document-intelligence.mjs`** (`advanceProcessingRun`, `PROCESSING_STAGES`) has **zero non-test importers** — unused dead code for document processing stages, not Understanding completion.

### 10.2 What Does "Complete" Mean Today?

**Option E (confirmed): There is currently NO governed completion authority.** "AI Understanding complete" is an informal operational concept meaning "all eligible rows have been attempted via the pilot manifest and reviewed/approved." It is NOT enforced by any code predicate. The workflow advances on requirement profiles, matching, and technical review counts — not on understanding completion.

### 10.3 UI CTA vs Backend

- UI labels ("Continue to Requirements", "Open Product Selection") derive from `workflowStage` (derived from `derivePresalesWorkflow`).
- `derivePresalesWorkflow` does NOT gate on understanding. So the UI can imply readiness that the backend does not enforce.
- **This is intentional:** the system is designed to let requirements proceed on raw BOQ facts when understanding is partial. The fallback (`approvedSystem || item.system_value` in `technical-requirement-api.mjs:175`; `approvedFacts || {}` in `product-matching-api.mjs:245`) is governed and announced.

---

## 11. Downstream Consumption Rules

### 11.1 `currentApprovedUnderstandingFacts` — The Single Authority

`worker/estimator-understanding-review-api.mjs:196-200`:
```js
export const currentApprovedUnderstandingFacts = async (db, projectId, boqItemId) => {
  // ... loads item via loadUnderstandingReviewRows + safeUnderstandingReviewItem
  return item.review.status === "APPROVED" ? item.canonicalReview?.interpretation || null : null;
};
```
**Only APPROVED review status yields facts.** This function is the sole downstream authority.

### 11.2 Consumer-by-Consumer Analysis

| Consumer | File:line | Requires APPROVED? | Fallback | Blocks on missing? |
|---|---|---|---|---|
| **Requirement Profile generation** | `worker/technical-requirement-api.mjs:174-185` | Yes (uses `currentApprovedUnderstandingFacts`) | `approvedSystem \|\| item.system_value` (raw BOQ extraction system); `approvedCategory \|\| item.category`; `approvedProductFamily \|\| item.subcategory \|\| item.category` | **No** — proceeds with raw BOQ; drawing evidence zero-gated (`if (approved) ... else {requirements:[], links:[]}` at `:183-185`) |
| **Product Matching** | `worker/product-matching-api.mjs:239-245` | Yes (uses `currentApprovedUnderstandingFacts`) | `understanding: { interpretation: approvedFacts \|\| {} }` → raw BOQ facts via `buildProductSearchProfile`'s own fallback | **No** — workflow gate requires ANY interpretation attempt (`:239`), but field-level search uses raw BOQ if unapproved |
| **BOQ Line Decision** | `worker/boq-line-decision-api.mjs:15,102` | Yes (uses `currentApprovedUnderstandingFacts`) | raw BOQ | No |
| **BOQ Line BOM** | `worker/boq-line-bom-api.mjs:17,114` | Yes | raw BOQ | No |
| **Engineering Knowledge** | `worker/engineering-knowledge-api.mjs:5,165,329` | Yes | raw BOQ | No |
| **AI Presales Tools** | `worker/ai-presales-agent-tools.mjs:10,56` | Yes | raw BOQ | No |
| **Technical Matching** | `worker/technical-requirement-api.mjs:174` (handoff) | Yes | raw BOQ | No |

### 11.3 Key Safety Findings

1. **No path consumes unreviewed AI interpretation.** Every consumer routes through `currentApprovedUnderstandingFacts`, which returns null for non-APPROVED rows. The fallback is always raw BOQ extraction facts — never the AI proposal.
2. **Explicit confirmation in product-matching-api.mjs `:240-244`:** "An AI understanding attempt existing only satisfies the workflow gate above. Which FIELDS feed the search profile must still respect review authority: only an APPROVED, current, non-stale interpretation may supply classification here. Falling back to {} makes buildProductSearchProfile's own boqItem fallback take over, i.e. raw BOQ facts, never an unapproved AI guess."
3. **Partial understanding creates partial downstream state — intentionally.** With 26 interpreted (0 approved) rows, requirements and matching proceed using raw BOQ fallback. Drawing evidence contribution is zero-gated (`if (approved)` at `:183`). This partial behavior is **governed and announced** via `classificationProvenance: "BOQ Extraction"` (`:177`).
4. **`approved_for_matching` on `requirement_profile_versions` is NEVER WRITTEN.** The column exists (`db/schema.ts:386`, default `false`), but **no `SET approved_for_matching` writer exists in any source file** (structural audit confirmed). `executeRequirementProfile` writes `status`, `readiness_status`, `confidence_summary`, but NOT `approvedForMatching`. This is a **latent governance gap**: the flag is perpetually `false`. However, matching itself does not check this flag — it checks `currentApprovedUnderstandingFacts` — so the perpetually-false `approvedForMatching` does not currently block matching. It is a dormant/latent flag requiring follow-up (out of AIU-2 scope).

### 11.4 FLAG: Any Unreviewed Consumption?

**None found.** All downstream paths are gated behind `currentApprovedUnderstandingFacts` (APPROVED-only) with raw-BOQ fallback. No consumer reads `estimator_item_interpretations` directly for classification.

---

## 12. Golden Scenario Matrix

Using only traced code (Section 10 completion authority = none; Section 11 downstream rules = APPROVED-gated with raw BOQ fallback):

| Scenario | AI Understanding Complete? | Requirements Allowed? | Matching Allowed? | Product Discovery Allowed? | Workflow Stage Advances? | Blockers Shown? |
|---|---|---|---|---|---|---|
| **S1: 26 attempted, 0 approved, N not-analyzed (CURRENT)** | **No** (no governed authority) | **Yes** — raw BOQ fallback, `requirementProfiles>=boqItems` | **Yes** — workflow gate passes on any interpretation attempt; raw BOQ fallback | **Yes** — raw BOQ | **Yes** — derived from facts, no Understanding gate | Partial-understanding warnings via `classificationProvenance` |
| **S2: 26 all APPROVED, N not-analyzed** | **No** (still not-analyzed rows) | **Yes** | **Yes** | **Yes** | **Yes** | None from Understanding |
| **S3: All 82-ish attempted, some awaiting review** | **No** (no authority) | **Yes** | **Yes** | **Yes** | **Yes** | Awaiting-review items flagged |
| **S4: All attempted, all APPROVED or REJECTED** | **Informally yes** (but no code asserts it) | **Yes** | **Yes** | **Yes** | **Yes** | REJECTED rows flagged; no understanding blockers |

**Can Requirements start while rows are NOT_ANALYZED?** **Yes.** `requirementsReady` does not check understanding. `executeRequirementProfile` falls back to raw BOQ.

**Can Matching consume approved facts while others are missing?** **Yes.** Matching proceeds per-item; `currentApprovedUnderstandingFacts` returns null for non-APPROVED rows, falling back to raw BOQ. Partial approved facts produce partial matching state — intentional.

**Does workflow advance partially?** **Yes.** `derivePresalesWorkflow` is purely derived from `facts`; it advances whenever the count thresholds are met, regardless of understanding completion.

---

## 13. UI / Backend Semantic Divergences

**Flagged (misleading labels, not backend defects):**

1. **"Awaiting review" label** — The review queue (`review_queue_items`, 90 rows all "Open") conflates multiple underlying states (AWAITING_REVIEW, plus items with no review version yet). The backend `estimator_understanding_review_versions.review_status` CHECK is `AWAITING_REVIEW/APPROVED/REJECTED`, but the queue table uses a separate "Open" status. This is a UI-labeling concern, not a data defect.
2. **"AI attempted" vs "interpreation status"** — The UI likely shows a count of attempted rows, but the backend distinguishes COMPLETED/NEEDS_REVIEW/FAILED/AI_UNAVAILABLE. The dashboard `aiUnderstood` count (25 live) derives from `currentBoqEligibleForUnderstandingPredicate` + interpretation existence, not from interpretation status.
3. **"Completed" in pilot quality summary** — The prior brief's pilot summary (Completed=10, Needs Review=3) described a subset; the live state has 19 COMPLETED + 7 NEEDS_REVIEW. Pilot summaries are point-in-time and can be stale.

**No backend defects found.** All divergences are labeling/display concerns.

---

## 14. Taxonomy Effect (No Redesign)

Taxonomy status affects:
- **Interpretation status:** Governed taxonomy candidate acceptance (`hasGovernedTaxonomy`, `isCanonicalPair`) is Gate 3 of auto-approval. A row whose system conflicts with taxonomy (per `taxonomyContextForPriorSystem`) is stripped to `EMPTY_TAXONOMY_CONTEXT`, which prevents GOVERNED_PRIMARY lane selection and forces CROSS_SYSTEM_EXPLORATORY or DATA_QUALITY_EXCLUDED.
- **Auto-approval:** Governed taxonomy candidate must be `taxonomyValid` and `isCanonicalPair`.
- **Completion:** Taxonomy status does NOT gate workflow completion (no Understanding gate exists).
- **Review requirement:** Taxonomy conflicts are a governance reason that can force NEEDS_REVIEW.

**No taxonomy changes made. No coverage fixes attempted.**

---

## 15. Architectural Risks

### R1 — No Governed Completion Authority (🔴)
There is no code predicate for "AI Understanding complete." Workflow advances on requirement/matching/technical counts, not understanding. This is intentional but means operational "completion" is unenforceable. **Recommended next slice: AIU-4A — Completion Authority** (define a governed completion predicate if desired).

### R2 — Latent `approved_for_matching` Gap (🟡)
`requirement_profile_versions.approvedForMatching` is never written (perpetually `false`). Matching does not currently check it, so no functional impact today. But it is a dormant authority surface that could cause future divergence if matching begins to check it. **Follow-up required (out of scope).**

### R3 — `review-workflow-api.mjs` Ungated Status Writes (🟡)
`canTransitionReview` guards only 2 of 8 `review_queue_items` status-write sites. Sites writing `Assigned`, `Waiting for Clarification`, `Escalated`, `Open` are ungated. **Pre-existing; unrelated to AIU-2.**

### R4 — Auto-Approval Not Production-Automatic (🟡)
Auto-approval is route-only. If an engineer expects it to fire automatically, it won't. This is deliberate, but the documentation/UI should reflect that it requires an explicit call. **Documentation concern.**

### R5 — Live State Drift (🟡)
The prior brief's figures (82 eligible, 20 attempted, 62 not-analyzed, 90 BOQ rows) no longer match the live D1 (108 BOQ rows, 26 interpreted, 0 review versions). Other agents' work or re-runs changed the population. **All reconciliation in this report uses live D1 numbers; prior-brief figures are superseded.**

### R6 — Review-Version Immutability + Staleness Guard (🟢, by design)
The `estimator_understanding_review_current_evidence_guard` trigger aborts inserts with stale evidence. This prevents approving outdated interpretations, but also means re-approval after a new extraction version requires a new interpretation (new fingerprint). **Intentional safety.**

---

## 16. Smallest Sufficient Next Slice

**AIU-4A — Completion Authority** is the smallest blocking slice, if the product requires a governed "complete" concept.

Specifically: define whether "AI Understanding complete" means (a) all eligible rows attempted, (b) all eligible rows APPROVED, or (c) something else; then implement a single `currentUnderstandingCompletePredicate` (analogous to `currentBoqEligibleForUnderstandingPredicate`) and wire it into `derivePresalesWorkflow` / `workflow_stage_states` / UI CTAs as desired.

**However:** this is a product decision, not a technical necessity. The current architecture (no completion gate, raw-BOQ fallback) is coherent and safe. **If no completion authority is desired, the smallest next slice is R2 (approved_for_matching writer) or R3 (review-workflow gating) as governance hygiene.**

**AIU-3 does NOT implement anything.** This recommendation is advisory only.

---

## 17. What Was Changed

**Nothing.**

This audit is READ-ONLY. No source edits, no DB mutations, no fixture changes, no deploys, no git operations. No AIU-4 was implemented. The AI Understanding workflow is NOT marked CLOSED.

---

## Appendix A — Evidence Separation

### Architectural Evidence (code structure)
- `INTERPRETATION_STATUSES` enum (`:157`), `derivePresalesWorkflow` pure derivation (`:8-46`), `currentApprovedUnderstandingFacts` APPROVED-only filter (`:200`), auto-approval policy gates (`:62-169`), pilot manifest caps (`:17-20`).

### Semantic Evidence (state machine meaning)
- Review status CHECK enum (`:review_status IN ('AWAITING_REVIEW','APPROVED','REJECTED')`), `canTransitionReview` gate (`:11`), `POLICY_AMBIGUITY_REASONS` set (`:34-40`), `NON_BLOCKING_UNDERSTANDING_CORRECTIONS` (`:701-707`).

### Structural Evidence (ownership/duplication)
- Every authority symbol has a single definition site (structural inventory). `pipeline-orchestration.mjs` ↔ `estimator-understanding-review-api.mjs` circular dependency resolved by dynamic import (`:15-27`). `estimator_understanding_review_versions`/`events` exist only in `drizzle/0060*.sql`, absent from `db/schema.ts`.

### Runtime Evidence (live D1, read-only `sqlite3 -readonly`)
- 108 total boq_items; 8 Merged; 26 distinct interpreted rows (19 COMPLETED + 7 NEEDS_REVIEW); 0 review_versions; 0 review_events; 0 auto-approval events; 90 review_queue_items all "Open"; all interpretations 2026-09-22, model `@cf/meta/llama-3.1-8b-instruct-fast`, all Fire Alarm.

### Golden Data Evidence (prior brief, superseded)
- "82 eligible / 20 attempted / 62 not-analyzed / 90 BOQ rows / aiUnderstood=25" — **superseded by live D1** (108 rows, 26 interpreted). Reported as honest deviation.

### Inference
- "Why 26 interpreted rows instead of 20" — likely population growth from 90→108 rows plus pilot re-runs by other agents. Not confirmed by direct evidence; flagged as inference.
- "approved_for_matching perpetually false is dormant" — inferred from absence of writer + matching code not checking the flag. The flag's intended semantics (when/if it should become true) is not documented in source; flagged as uncertainty.

---

## Appendix B — Uncertainty & Blockers

| Item | Uncertainty |
|---|---|
| Exact current eligibility count | Cannot evaluate `currentBoqEligibleForUnderstandingPredicate` in SQL. Live total 108, merged 8; eligible count JS-only. |
| Auto-approval qualifying rows | Cannot run `classifyFireAlarmFamilyFromText` + `hasGovernedTaxonomy` + `isCanonicalPair` in SQL. 3 rows confirmed disqualified; 23 indeterminate. |
| `approved_for_matching` intended semantics | Column exists but never written; no doc explains when it should become true. Flagged, not resolved. |
| `review_queue_items` vs `estimator_understanding_review_versions` | Queue table (90 "Open") and review_versions table (0 rows) are separate; the exact mapping is not fully traced. Flagged. |
| Prior-brief vs live drift | 90→108 BOQ rows, 20→26 interpreted. Cause (other agents' re-runs vs population growth) is inference, not confirmed. |
| `review-workflow-api.mjs` ungated sites | Confirmed 8 sites, 2 gated. Intended behavior of ungated sites not documented. Flagged as pre-existing governance gap. |

---

*Audit complete. STOP honored.*
