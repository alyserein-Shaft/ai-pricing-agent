# AIU-4H — Understanding Consumption Audit & Closure Report

## Recovered canonical scope

`AIU-4H-PRE_Atomic_Non_Product_Commercial_Architecture_Plan.md` (design-only,
nothing implemented): non-product BOQ rows (service, labour, allowances) have
no governed commercial path — every commercial stage requires product identity
from Product Matching onward. It proposes Option B (generalized
commercial-scope root) as future architecture. The program directive for this
phase scopes execution to auditing the understanding layer's consumption and
repairing only validated scope — NOT building Option B.

## Consumption audit (verified against production code)

1. **Canonical governing evidence:** understanding readers
   (`loadUnderstandingReviewRows`, `activeRows`, `currentApprovedUnderstanding-
   Facts`, `confirmedSpecifications`) all scope through `currentBoqEvidenceFrom`
   + eligible-for-understanding + `currentTechnicalRequirementsFrom` (EVIDENCE-
   CURRENCY-1 inventory: all ALREADY_CANONICAL).
2. **Current requirement facts:** `confirmedSpecifications` requires Confirmed
   links + current requirements + Approved downstream; `loadInputs` facts
   gated to Active/Approved (GOV-AUTH-1).
3. **Unresolved semantics:** the attempt-vs-approved split is enforced where it
   matters — `currentUnderstandingAttempt` (COMPLETED|NEEDS_REVIEW proposal
   satisfies the matching workflow gate) vs `currentApprovedUnderstandingFacts`
   (APPROVED-only feeds search; fallback is raw BOQ facts, never an unapproved
   proposal — `product-matching-api.mjs:243-248`). REVALIDATION_REQUIRED
   renames stale approvals instead of hiding them.
4. **Compatibility governance:** understanding consumes compat only as ranking
   input via governed profiles; no compat assertion originates in the
   understanding layer.

## Non-product rows (AIU-4H-specific question)

Current behavior is fail-closed: service rows that reach BOQ-Item status with
approval enter understanding/matching, but `productFamily` readiness blocks
them at Missing Critical Information (never a positive state), and matching
requires interpretation without manufacturing product identity. No path turns
a service row into a priced product silently. Building the positive
(non-product commercial root) path is the deferred Option-B architecture —
explicitly NOT started here; starting it pre-Golden would absorb an unscoped
build into the critical path.

## Verdict

Audit-complete, no repair indicated, no regression evidence: 186/186 across
the understanding suites plus 43/43 knowledge and the R3/phase batteries.
**AIU-4H: CLOSED** with Option B recorded as future architecture.
