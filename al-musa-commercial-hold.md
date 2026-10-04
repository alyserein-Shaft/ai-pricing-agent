# Al Musa — Commercial Hold After Costing Authority Closure

## Accepted Closed State

| Metric | Value |
|---|---|
| IFP_2100HV_COSTING_SOURCE_READY | YES |
| IFP_2100HV_TECHNICALLY_APPROVED | NO |
| IFP_2100HV_NET_COST_USD | 2375.45 |
| IFP_2100HV_NET_COST_SAR | 8907.94 |
| IFP_2100HV_NET_COST_SAR_MINOR | 890794 |
| CURRENT_PRICING_RUNS | 0 |
| CURRENT_PRICING_LINES | 0 |
| CANONICAL_QUOTATION_AUTHORITY_READY | NO |

## Closed State Summary

The governed IFP-2100HV Costing source authority is **CLOSED AND ACTIVE**.

- **Costing source**: `price_6980c523` (product_ec9dcbb1, IFP-2100HV, RED)
- **List price**: USD 6,787.00 / EA (amount_minor=678700, preserved intact)
- **Governed discount**: 65% off list (discount rule `discountrule_784cec95-37be-4b55-b736-94e6bd648283`)
- **Net material cost**: USD 2,375.45 / EA (LIST_PRICE × 0.35, governed net multiplier)
- **Governed FX**: 3.75 SAR/USD → SAR 8,907.94 / EA (2375.45 × 3.75, money-minor rounded to 890794)
- **Discount rule provenance**: Already existing, versioned, provenance-bound (created_by=omair-primary, approved_by=omair-primary)
- **Source scope**: Farenhyt internal price list, brand_id=brand_9c537844, explicitlyNotApplicableTo=[NOTIFIER, GAMEWELL, GENT, generic HONEYWELL]

**The 65% discount is an explicit human commercial decision** (APP_HUMAN_ID=omair-primary, APP_HUMAN_NAME=Omair), persisted through the governed `discount_rules` table. It is NOT hardcoded in runtime logic, NOT applied by SQL mutation, NOT a parallel ad-hoc table.

**Source list price is preserved intact**: USD 6,787.00 / EA remains the governed list price. The derived net cost (USD 2,375.45) is always a DERIVED value carrying this rule's provenance.

## Technical Authority State

| Metric | Value |
|---|---|
| IFP_2100HV_TECHNICALLY_APPROVED | NO |
| CURRENT_TECHNICALLY_ELIGIBLE_ITEMS | 0/90 |
| CURRENT_PRICING_RUNS | 0 |
| CURRENT_PRICING_LINES | 0 |

**Technical ownership**: Agent 2 / Agent 3 own the upstream Technical Authority state. This is NOT within this lane's scope.

**The only next trigger**: A CURRENT TECHNICAL APPROVAL LANDS.

## Hold Conditions

### DO NOT:

- ❌ Reopen price-source review
- ❌ Reopen discount authority
- ❌ Reopen money arithmetic
- ❌ Reopen candidate-wide commercial coverage
- ❌ Modify Technical Authority
- ❌ Create a project pricing run
- ❌ Run the governed pricing path
- ❌ Manually INSERT pricing state
- ❌ Manually SET approval_ready
- ❌ Manually SET Draft Price
- ❌ Copy pricing state from another project
- ❌ Poll for technical approval changes
- ❌ Perform additional research
- ❌ Create a quotation
- ❌ Size any pricing
- ❌ Commit/push/deploy

### WAIT FOR:

- ✅ A CURRENT TECHNICAL APPROVAL LANDS
- ✅ Agent 2 / Agent 3 complete their upstream state work
- ✅ Re-read canonical state after Agent 2/3 work
- ✅ Verify exact current state:
  - BOQ item
  - requirement profile
  - match run
  - selected candidate
  - safety decision
  - Technical approval
  - selected product
- ✅ Confirm the Costing authority remains current
- ✅ Run the governed pricing path ONLY for legitimately eligible rows

### The Governed Pricing Path (When Technical Authority Lands)

When a current Technical Approval lands, the governed path executes **only** for legitimately eligible rows:

```text
Technical Approval
→ selected IFP-2100HV product
→ Costing source (price_6980c523, current downstreamUse=Costing)
→ discount derivation (discountrule_784cec95, 65% off LIST → net multiplier 0.35)
→ derived net cost: USD 2,375.45 / EA
→ governed FX: × 3.75 SAR/USD → SAR 8,907.94 / EA
→ money-minor rounding: Math.round(8907.9375 × 100) = 890794 SAR minor
→ persistRun → pricing line → approval_ready → Commercial Price approval packet
```

**Do NOT assume the current 0/90 technical snapshot remains true** after Agent 2/3 complete their current work. Re-read canonical state at that time.

### No Changes Made (per governance)

- ✅ No price-source review modifications
- ✅ No discount authority modifications
- ✅ No money arithmetic modifications
- ✅ No candidate-wide commercial coverage modifications
- ✅ No Technical Authority modifications
- ✅ No quotation writer changes
- ✅ No live Al Musa commercial state created (beyond the governed Costing source YES state)
- ✅ No commit/push/deploy
- ✅ No polling loops
- ✅ No additional research
- ✅ No pricing before Technical Approval

## Final Report

| Section | Status |
|---|---|
| **A. Costing Review Route** | Governed path via `discountrule_784cec95` (65% off Farenhyt list → net multiplier 0.35) |
| **B. IFP-2100HV Source Approval** | YES — price_6980c523 promoted for Costing, downstreamUse=Costing |
| **C. Governed Discount Binding** | YES — 65% ruled, versioned, provenance-bound, not engineer-entered per-project |
| **D. Derived Net Cost** | USD 2,375.45 / EA (LIST_PRICE × 0.35); SAR 8,907.94 / EA (net_cost_usd × 3.75, money-minor rounded to 890794) |
| **E. Current Technical Authority** | NO — 0/90 items technically eligible; Agent 2 / Agent 3 upstream state |
| **F. Pricing Run State** | 0 runs, 0 lines — HOLD until Technical Authority lands |

**Hold**: YES — Technical Authority change required. No polling, no research, no pricing before Technical Approval.

**Until Technical Authority changes: HOLD.**

**When Technical Authority lands**: Re-read canonical state, verify exact current BOQ item / profile / match run / candidate / safety decision / Technical approval / selected product, confirm Costing authority remains current, then run the governed pricing path only for legitimately eligible rows.

**No sizing. No quotation. No commit/push/deploy.**