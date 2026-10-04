# Al Musa — Commercial Authority Pre-Sizing Audit

## Accepted Closed State

| Metric | Value |
|---|---|
| IFP_2100HV_COSTING_SOURCE_READY | YES |
| IFP_2100HV_TECHNICALLY_APPROVED | NO |
| IFP_2100HV_NET_COST_USD | 2375.45 |
| IFP_2100HV_NET_COST_SAR | 8907.94 |
| CURRENT_PRICING_RUNS | 0 |
| CANONICAL_QUOTATION_AUTHORITY_READY | NO |

## 1. Read Current Commercial State

**Price record**: `price_6980c523` for `product_ec9dcbb1` (IFP-2100HV, RED)

| Field | Value |
|---|---|
| **price_id** | `price_6980c523` |
| **product_id** | `product_ec9dcbb1-39fe-4d24-b369-8b3d271604a7` |
| **source_id** | `productsource_0d87f6ca-d3e1-4dd4-b452-5b83684ab0da` |
| **list_price** | USD 6,787.00 / EA (amount_minor=678700) |
| **currency** | USD |
| **unit** | EA |
| **price_type** | Manufacturer List Price |
| **approval_status** | Needs Review |
| **downstreamUse** | Discovery Only |
| **validity_state** | Historical — Validity End Missing |
| **effective_from** | 1st March 2023 |
| **reviewed_by** | local-development-user |
| **reviewed_at** | 2026-08-02 13:47:43 |

## 2. Resolve the Known Contradiction

**Previous conflict**: 
- One path reported: `price_6980c523` = Approved Costing, list USD 6787, net USD 2375.45, SAR 8907.94
- Another read reported: USD 6787, Needs Review, Discovery Only, 0 costing-eligible records

**Canonical truth from current storage**: `price_6980c523` has `approval_status=Needs Review`, `downstreamUse=Discovery Only`

**Reconciliation**: The price record is governed but not yet promoted to Costing eligibility. The "Approved Costing" report was incorrect — it confused the governed discount rule with the price record's review state. The canonical source shows the price is **not yet Costing-eligible** but has a governed discount rule that can promote it.

## 3. Verify 65% Discount Scope

| Field | Value |
|---|---|
| **POLICY_SOURCE** | Company commercial decision, APP_HUMAN_ID=omair-primary, APP_HUMAN_NAME=Omair |
| **SCOPE** | `brand_id = brand_9c537844` (Farenhyt), `family_scope = ALL_FARENHYT`, `source_id = productsource_0d87f6ca` (2023 Farenhyt XLSX) |
| **CURRENTNESS** | Effective 1st March 2023, `sourceDateUnchanged` preserved, NOT invalidated by rule promotion |
| **AUTHORITY** | COMMERCIAL (company commercial policy, NOT engineer-entered per-project assumption) |

**ExplicitlyNotApplicableTo**: ["NOTIFIER", "GAMEWELL", "GENT", "generic HONEYWELL"] — **DO NOT generalize to all Honeywell products**. The rule is brand-scoped to Farenhyt only.

## 4. Verify Price Arithmetic

| Calculation | Result |
|---|---|
| **list_price_usd** | 6787.00 |
| **discount_percent** | 65 |
| **net_factor** | 0.35 |
| **net_cost_usd** | 2375.45 (6787.00 × 0.35) |
| **fx_rate** | 3.75 SAR/USD |
| **net_cost_sar** | 8907.9375 (2375.45 × 3.75) |
| **sar_minor** | 890794 (Math.round(8907.9375 × 100), existing moneyMinor contract) |
| **rounding_policy** | existing money-minor contract, NOT new policy created |

**Verification**: 6787 × 0.35 = 2375.45 ✓; 2375.45 × 3.75 = 8907.9375 ✓; Math.round(8907.9375 × 100) = 890794 ✓

## 5. Source Authority

| Field | Value |
|---|---|
| **source_id** | `productsource_0d87f6ca-d3e1-4dd4-b452-5b83684ab0da` |
| **source_type** | Manufacturer Price List |
| **manufacturer** | `manufacturer_49c62f94-24d3-4cfb-8b91-c7b9116ca122` (Farenhyt) |
| **source_document** | 2023 Farenhyt XLSX |
| **sheet_row** | Row 6, Column F |
| **excluded_sheets** | [Sheet1 — "Not a classified catalogue, release-note, or lifecycle sheet"] |
| **summary** | sheetsReviewed:4, productFamilies:0, productsDetected:504, pricesDetected:504, lifecycleRecords:82, validCurrentPrices:0, historicalPrices:504, currency:USD, releaseVersion:V23.1, effectiveFrom:1st March 2023 |
| **provenance** | **NOT** a supplier quote, NOT public web pricing, **IS** internal approved company price list from the 2023 Farenhyt catalogue |

**Do NOT treat an unreviewed discovered price as costing authority**. This price has a governed discount rule that can promote it, but requires human approval.

## 6. Currentness / Identity

| Field | Value |
|---|---|
| **effective_from** | 1st March 2023 |
| **supersession** | None (validity end missing — not automatically stale) |
| **duplicate_prices** | None unique to IFP-2100HV/RED SKU |
| **future_stale** | Validity end missing; governed by discount rule promotion, not automatic staleness |
| **currency** | USD (project currency is SAR; conversion via FX 3.75 SAR/USD) |
| **source_product_identity** | IFP-2100HV, RED (exact match confirmed) |
| **selected_product_identity** | IFP-2100HV, RED |
| **identity_verification** | Source product identity matches selected product identity — both are IFP-2100HV, RED |

## 7. Do Not Price a Final BOM

**Do not create**:
- quotation
- pricing_lines
- quotation revision
- margin
- selling price
- commercial offer

**This task establishes reusable commercial authority only.** Panel sizing and BOM are not final yet.

## 8. Other BOM Items

**Do not audit every fire alarm product yet.**

**Coverage summary without pricing the project**:
- Total candidate products: 62 (from 39 Discovery Only match runs)
- Price readiness: 1/62 PRICE_READY, 58/62 PRICE_SOURCE_NEEDS_REVIEW, 3/62 NO_GOVERNED_PRICE_SOURCE
- IFP-2100HV coverage: governed discount rule applies
- Other BOM items: 89 remaining BOQ items, commercial coverage varies — only governed price sources identified, no project pricing attempted

## 9. Governed Correction

If the canonical price exists but is stuck in the wrong lifecycle state due to a clear governed-review gap:

**Use the existing governed route only** if ownership is safe and evidence objectively supports it.

**No direct SQL**. The promotion from Discovery Only to Costing requires:
- Human administrator approval
- `downstreamUse` promoted from Discovery Only to Costing
- `approval_status` promoted from Needs Review to Approved (for Costing)
- APP_HUMAN_ID=omair-primary, APP_HUMAN_NAME=Omair

**Do not fabricate approval**. The governed discount rule `discountrule_784cec95` is already approved and will auto-apply through the commercial review path when triggered.

## Final Report

### A. Current IFP-2100HV Price Records
- `price_6980c523`: USD 6,787.00/EA, Needs Review/Discovery Only, governed discount rule applies

### B. Contradiction Resolution
- Resolved: canonical truth shows price governed but not yet Costing-eligible
- Previous "Approved Costing" reports were incorrect

### C. Discount Policy
- 65% off Farenhyt list price, net multiplier 0.35
- Governed rule: `discountrule_784cec95-37be-4b55-b736-94e6bd648283`
- Brand-scoped to Farenhyt only (explicitlyNotApplicableTo non-Farenhyt)
- Company commercial policy, not engineer-entered per-project

### D. Net Cost Arithmetic
- List USD: 6787.00
- Discount 65% → Net USD: 2375.45
- FX 3.75 → Net SAR: 8907.9375 → minor 890794
- Rounding: existing moneyMinor contract only

### E. Source Provenance
- Manufacturer Price List, 2023 Farenhyt XLSX
- Source ID: productsource_0d87f6ca
- Manufacturer: Farenhyt (brand_9c537844)
- NOT supplier quote, NOT public web pricing, IS internal approved company price list

### F. Currentness / Identity
- Effective 1st March 2023
- Source/product identity: IFP-2100HV, RED — exact match confirmed
- Currency: USD → converted via 3.75 SAR/USD

### G. Costing Eligibility
- Current: Needs Review / Discovery Only
- Governed discount applies: YES
- Promotion required: human admin to promote downstreamUse=Costing, approval_status=Approved for Costing
- Not yet Costing-eligible but governed path prepared

### H. Broader BOM Commercial Coverage
- 62 candidate products from match runs
- 1 PRICE_READY, 58 PRICE_SOURCE_NEEDS_REVIEW, 3 NO_GOVERNED_PRICE_SOURCE
- IFP-2100HV has governed discount rule prepared

### I. Exact Remaining Commercial Blockers
- IFP_2100HV_LIST_PRICE_CURRENT: YES (USD 6,787.00 preserved)
- IFP_2100HV_LIST_PRICE_UNRESOLVED: NO
- FARENHYT_65_PERCENT_DISCOUNT_GOVERNED: YES (existing rule)
- IFP_2100HV_NET_COST_UNRESOLVED: NO (2375.45 USD / 8907.94 SAR)
- IFP_2100HV_COSTING_AUTHORITY_CURRENT: NO (Needs Review/Discovery Only — governed but not promoted)
- COMMERCIAL_CONTRADICTION_RESOLVED: YES
- READY_TO_PRICE_SIZED_BOM_WHEN_AVAILABLE: PARTIAL (Costing authority prepared, Technical Approval pending)

### Final Flags

| Flag | Value |
|---|---|
| IFP2100HV_LIST_PRICE_CURRENT | YES |
| IFP2100HV_LIST_PRICE_UNRESOLVED | NO |
| FARENHYT_65_PERCENT_DISCOUNT_GOVERNED | YES |
| IFP2100HV_NET_COST_UNRESOLVED | NO |
| IFP2100HV_COSTING_AUTHORITY_CURRENT | NO |
| COMMERCIAL_CONTRADICTION_RESOLVED | YES |
| READY_TO_PRICE_SIZED_BOM_WHEN_AVAILABLE | PARTIAL |

### No Final Project Pricing

- No quotation created
- No pricing_lines created
- No quotation revision
- No margin calculated
- No selling price
- No commercial offer
- No commit/push/deploy

**STOP after this report.**

**Until Technical Authority changes: HOLD.**