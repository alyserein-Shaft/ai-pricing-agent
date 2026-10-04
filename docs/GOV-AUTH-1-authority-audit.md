# GOV-AUTH-1 — Downstream Authority Audit & Closure Report

## Scope reconstruction

No canonical GOV-AUTH-1 definition exists in the repository (no markdown, no
report, no roadmap entry; web search returns only unrelated external products).
Scope is therefore reconstructed from the program directive and verified against
code: **ensure downstream engineering decisions consume only evidence that has
the required governance authority**, keeping exists / reviewed / approved /
governing / fresh / authorized-for-use distinct, without duplicating the DOC-R3
currency predicates. Four parallel read-only audit slices (BOQ+requirements,
facts+drawing, product+matching+compat, quantity+pricing+review surfaces)
reported; the primary agent verified every claimed gap against production code
before closing.

## Closed gaps (behavior changes, all with focused tests)

### M-1 — Rejected candidates could price (REAL, closed)
`product_match_candidates.review_status='Rejected'` / `'Auto-Rejected
Technical'` was recorded as audit only: neither the Technical-approval gate
(`confidence-safety-api.mjs` approve route checks role/staleness/version/
eligibility/blocks — never candidate status) nor the pricing candidate query
(`pricing-runtime.mjs:74-79`) nor the primary-selection resolver read it. A
rejected candidate with a Technical approval (before OR after rejection) priced
and resolved. Closed at the two consumption chokes with
`AND c.review_status NOT IN ('Rejected','Auto-Rejected Technical')`
(`worker/pricing-runtime.mjs`, `worker/primary-selection-authority.mjs`):
rejection revokes resolvability; approval rows stay untouched as history.
Live DB check: zero Rejected candidates, zero rejected+approved pairs — the
hole was structural, proven by fixture, no live mispricing found.
Tests: `tests/governance-authority-gaps.test.mjs` (4).

### Facts channel — Pending Review/Rejected facts reached profiles (REAL, closed)
`loadInputs` (`worker/technical-requirement-api.mjs`) read
`status<>'Superseded'`, admitting Pending Review and Rejected non-Source-Fact
rows into `buildTechnicalRequirementProfile` input — while the profile model
itself assumes reviewed facts ("Approved facts promoted", "an Active row").
Closed to `status IN ('Active','Approved')`. Review surfaces that must SHOW
pending items (knowledge-profile GET, review lists) query explicitly elsewhere
and are untouched. Live check: 13 Pending Review facts newly excluded from
profile input (correct per policy); 70 Active + 14 Approved still flow.
Tests: same file (1).

### BOQ compare — cross-document previous extraction (REAL, closed)
`POST .../boq-extraction/compare` read any caller-supplied
`previousExtractionVersionId` with no document scoping, then stored the result
under the current document's project: cross-project read plus misattributed
write. Closed by joining the previous rows to the owning document
(`worker/boq-extraction-api.mjs`); same-document v1-vs-v2 history still
compares. Tests: same file (1).

## Pinned policy (no behavior change — change would be wrong)

### C-1 — compat/attribute sub-rows flow on link authority
`loadInputs` reads requirement_attributes/standards/manufacturers/
compatibility/accessories with no per-row review filter. There is NO per-row
review anywhere to gate on instead: gating would silently drop ALL compat
content (no writer mints approved sub-rows). The Confirmed link + Approved
requirement IS the approval of the extracted set as a whole — documented at
the query site and pinned by test ("compat sub-rows flow with their Confirmed
link"). A future per-row review lifecycle must start gating at that test.

## Recorded, deliberately unchanged

- **M-2 (multi-approval):** pricing per-candidate with own approval is legitimate
  compare-then-pick workflow; the explicit pick happens at per-line commercial
  quotation approval. Ambiguity is surfaced, not silent. No change.
- **C-2 (system-Approved compat):** gates are real (exact identity, no
  inference); no consumer requires HUMAN compat approval specifically (pricing
  requires human Technical/Price approvals, never compat status). Latent only.
- **C-3 / family ranking signals:** ranking, not assertions; no provenance gate
  needed for a signal that asserts nothing.
- **B-FLAG1 (`resolveBoqCandidateMembers`):** bounded — sole caller passes the
  governed extraction id; review-only use. Helper documented.
- **B-FLAG2 / spec flag-only gates:** coupled CAS writes make flag/status
  divergence unproducible by any writer; defense-in-depth note only.
- **B-FLAG4 (route-scoped ownership reads):** display/mutation pre-reads, not
  selection; governed `currentSelectedQuantity` remains the single read site.
- **'Accepted' BOQ class:** zero writers, zero live rows; predicate
  permissiveness is inert. If a writer ever mints it, it must go through
  governed review.
- **F1/F3 (validity relaxation), F10/F11, F4:** documented user policy / UX /
  single-party-FX notes; no silent bypass found (F5/F6/F2 verified absent).
- **F7/F8/F9 (review payloads):** display enrichment deferred — review
  `decision` gates separately via validateDecision; swapping `currentPricing`
  for the canonical projection would change payload shape (frontend contract).
  Recommended as follow-up, not a bypass.
- **Drawing lineage:** R4-owned inventory confirmed (zero drawing readers use
  governing predicates; no consumer treats drawing evidence as cross-version
  governing). Audit only, no implementation.

## What was verified absent (positive findings)

- No pricing/consuming path takes `Needs Review`/`Discovery Only` prices.
- No missing→zero quantity or price paths in governed code.
- No over-grant in review assign/decision, pricing approve, quotation
  approve/issue, supplier approve, understanding approve.
- No duplicate currency predicates introduced (all fixes reuse R3 authority or
  existing status columns).
- Product `review_status`/`approved_for_discovery` correctly absent from
  pricing (Technical + price-record gates carry the decision).
- Discovery-vs-costing separation explicit (`costingEligible: false`).
- Deprecated `product_compatibility` table receives no writes.

## Authority-class reference (established, unchanged)

BOQ row: review_status × approved_for_downstream (eligible = Approved-family +
flag 1 + governing + current). Requirement: Approved + flag 1, CAS-coupled.
Fact: Active/Approved (+freshness lineage); Pending Review proposes, Rejected
refuses, Superseded retires. Candidate: Needs Review → Rejected/Advisory;
selection = Technical Approved + current version (rejection now revokes
resolvability at consumption). Price: (Approved, Costing) + validity truthfully
reported. Compat: extractor set under Confirmed link; system auto-confirm gated
to exact identity (latent indistinguishability noted).
