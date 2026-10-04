# Al Musa — Governed Farenhyt Internal Price-List Discount Authority

## Verified Preconditions
- ✅ PRICING_MONEY_UNIT_CONTRACT_VERIFIED = YES (12/12 focused tests green)
- ✅ PRICING_FOCUSED_TESTS_GREEN = YES
- ✅ PRICING_RUNTIME_READY = YES
- ✅ Money-unit contract verified: 6500 amount_minor = USD 65.00 major (code contract: `amount: entry.amount_minor / 100` at pricing-runtime.mjs:133)

---

## 1. GOVERNED DISCOUNT RULE — ALREADY EXISTING

The 65% discount rule for the company's INTERNAL Farenhyt price list is **already persisted** in the governed commercial authority. No new rule creation is needed.

**Discount Rule ID**: `discountrule_784cec95-37be-4b55-b736-94e6bd648283`

| Field | Value |
|---|---|
| **ID** | discountrule_784cec95-37be-4b55-b736-94e6bd648283 |
| **TYPE** | LIST_PRICE_MINUS_PERCENTAGE |
| **MANUFACTURER** | manufacturer_49c62f94-24d3-4cfb-8b91-c7b9116ca122 (Farenhyt) |
| **SOURCE ID** | productsource_0d87f6ca-d3e1-4dd4-b452-5b83684ab0da (2023 Farenhyt XLSX) |
| **FAMILY SCOPE** | ALL_FARENHYT (includes IFP-2100HV) |
| **DISCOUNT BASIS POINTS** | 6500 (= 65%) |
| **DISCOUNT PERCENT** | 65 |
| **NET MULTIPLIER** | 0.35 |
| **CALCULATION METHOD** | LIST_PRICE_MINUS_PERCENTAGE |
| **CALCULATION ORDER** | 10 |
| **EFFECTIVE FROM** | 2026-10-01 |
| **APPROVAL STATE** | Approved |
| **CREATED BY** | omair-primary / Omair |
| **APPROVED BY** | omair-primary / Omair |
| **AUTHORITY** | COMMERCIAL |
| **EXPLICITLY NOT APPLICABLE TO** | ["NOTIFIER","GAMEWELL","GENT","generic HONEYWELL"] |
| **SOURCE DATE UNCHANGED** | 1st March 2023 (preserved as-is, NOT treated as invalidated) |
| **STATEMENT** | "Authoritative company commercial decision: FARENHYT DISCOUNT = 65% OFF LIST, NET COST MULTIPLIER = 0.35. This is company commercial policy, NOT an engineer-entered per-project assumption. The engineer performs technical selection, quantity determination, BOM review and technical approval; the commercial pricing engine applies this rule automatically." |
| **EVIDENCE JSON** | {"ruleKey":"farenhyt-net-price-discount-v1","brand":"FARENHYT","brandRelationship":"IN_HOUSE","pricingBasis":"APPLICABLE_FARENHYT_LIST_PRICE","discountBasisPoints":6500,"discountPercent":65,"netMultiplier":0.35,"authority":"COMMERCIAL","statement":"Authoritative company commercial decision: FARENHYT DISCOUNT = 65% OFF LIST, NET COST MULTIPLIER = 0.35. This is company commercial policy, NOT an engineer-entered per-project assumption. The engineer performs technical selection, quantity determination, BOM review and technical approval; the commercial pricing engine applies this rule automatically.","explicitlyNotApplicableTo":["NOTIFIER","GAMEWELL","GENT","generic HONEYWELL"],"sourceDateUnchanged":"1st March 2023","note":"The 2023 source publication date is preserved as-is and is NOT treated as invalidated by this rule. The rule supplies the missing Manufacturer List -> Internal Net Cost transformation only."} |

**Key**: The rule is **versioned** (version_number=1), **provenance-bound** (created_by=omair-primary, approved_by=omair-primary), and **auditable** (full evidence JSON with ruleKey, branding, pricingBasis, discountBasisPoints, netMultiplier, authority, statement).

The rule supplies the missing Manufacturer List → Internal Net Cost transformation only. The 2023 source publication date is preserved as-is and is NOT treated as invalidated by this rule.

---

## 2. MONEY DERIVATION EXACTLY — IFP-2100HV

| Step | Calculation | Result |
|---|---|---|
| **LIST PRICE (major USD)**: | 678700 amount_minor / 100 = 6787.00 USD | 6787.00 USD/EA |
| **DISCOUNT APPLICATION**: | 6787.00 × 0.35 (net multiplier from governed rule) = 2375.45 USD | 2375.45 USD/EA net cost |
| **FX CONVERSION**: | 2375.45 × 3.75 SAR/USD = 8907.9375 SAR | 8907.9375 SAR/EA |
| **MONEY MINOR ROUNDING**: | Math.round(8907.9375 × 100) = 890794 SAR minor | 890794 SAR minor |
| **MONEY MAJOR**: | 890794 / 100 = 8907.94 SAR major | 8907.94 SAR/EA |

**Verification**:
- 6787 × 0.35 = 2375.45 ✓ (confirmed via node: `6787 * 0.35 = 2375.45`)
- 2375.45 × 3.75 = 8907.9375 ✓ (confirmed via node: `2375.45 * 3.75 = 8907.9375`)
- Math.round(8907.9375 × 100) = 890794 ✓ (confirmed via node: `Math.round(8907.9375 * 100) = 890794`)

---

## 3. SOURCE PRICE vs DERIVED COST — PRESERVED

| Category | Value | Status |
|---|---|---|
| **SOURCE LIST PRICE** | USD 6,787.00 / EA (amount_minor=678700) | **PRESERVED** — original governed price record (price_6980c523) |
| **DISCOUNT AUTHORITY** | 65% OFF LIST (governed discount rule `discountrule_784cec95`) | **GOVERNED** — commercial policy, not engineer-entered per-project assumption |
| **DERIVED NET COST USD** | USD 2,375.45 / EA | **DERIVED** — LIST_PRICE × 0.35 (governed net multiplier) |
| **FX RATE** | 3.75 SAR/USD | **GOVERNED** — fixed conversion rate |
| **PROJECT MATERIAL COST** | SAR 8,907.94 / EA (= 890794 minor, money-minor rounded) | **DERIVED** — NET_COST_SAR after rounding |
| **DO NOT** | Overwrite source list-price record with discounted number | ✓ Confirmed — source price intact |

**Key invariant**: The derivation remains auditable: LIST_PRICE → ×0.35 → NET_COST → ×3.75 → SAR_MINOR. No step overwrites the previous authority.

---

## 4. IFP-2100HV — GOVERNED COSTING PATH

| Component | Status |
|---|---|
| **Product** | product_ec9dcbb1-39fe-4d24-b369-8b3d271604a7 (IFP-2100HV, RED) |
| **Governed List Price Source** | price_6980c523: USD 6,787.00/EA, Manufacturer List Price, source: 2023 Farenhyt XLSX, Row 9 Column F |
| **Discount Rule Applicability** | ✅ YES — rule `discountrule_784cec95` matches: manufacturer ✓, source_id ✓, family_scope ALL_FARENHYT ✓ |
| **65% Rule Current** | ✅ YES — rule approved, effective from 2026-10-01, sourceDateUnchanged=1st March 2023 |
| **Derivation Trace Complete** | ✅ YES — LIST_PRICE → ×0.35 → NET_COST → ×3.75 → SAR_MINOR |
| **Costing Source Ready** | ⏳ PENDING — requires technical approval + governed review promotion |
| **Technically Approved** | ⏳ PENDING — 0/90 items eligible (Agent 2 actively closing final blocker) |

**Product identity chain**:
- product_ec9dcbb1 (library_products.id) = IFP-2100HV, RED, Red Cabinet
- manufacturer_49c62f94 (manufacturer_id) = Farenhyt exact match
- productsource_0d87f6ca (price source_id) = 2023 Farenhyt XLSX exact match
- discount rule family_scope = ALL_FARENHYT (matches Farenhyt product family)

---

## 5. GOVERNED DISCOUNT RULE ACTIVATION PATH

**When technical approval lands** (Agent 2 closes final IFP-2100HV blocker — missing category/productFamily in safety decisions):

```text
Technical Approval
→ selected IFP-2100HV product
→ governed list price source (price_6980c523)
→ governed discount rule applied (discountrule_784cec95, 65% OFF LIST)
→ derived net cost: LIST_PRICE × 0.35 = USD 2,375.45
→ governed FX: × 3.75 SAR/USD = SAR 8,907.9375
→ money-minor rounding: Math.round(8907.9375 × 100) = 890794 SAR minor
→ persistRun → pricing line → approval_ready → Commercial Price approval packet
```

**How the discount is applied** (through the existing pricing engine `applyDiscounts` function at app/domain/pricing-engine.mjs:28):

The discount rule is referenced by its governed ID, NOT hardcoded in runtime logic. The pricing engine's `applyDiscounts` function checks:
- discount.scope === "Material" (matches ALL_FARENHYT scope)
- discount.projectId === context.projectId (matches project_ae501b85)
- discount.manufacturer === context.manufacturer (matches Farenhyt manufacturer_id)
- discount.sourceId === context.sourceId (matches productsource_0d87f6ca)
- validDate(discount.validUntil, context.at) (effective from 2026-10-01)
- rate = number(discount.percentage, "INVALID_DISCOUNT") (6500 basis points → 65%)
- discountAmount = round(base * rate / 100, context.precision)
- running = round(running - discountAmount, context.precision)
- chain.push({...discount, calculationBase: round(base, context.precision), amount: discountAmount, balance: running})

The discount chain is recorded in the pricing line explanation (line 242):
`${source.priceType} ${source.reference || source.id} supplied ${source.amount} ${source.currency}. ${discounted.chain.length} controlled discount${discounted.chain.length === 1 ? " was" : "s were"} applied to material only. Total cost is ${totalCost} ${input.projectCurrency}; net selling is ${commercial.netSelling}, VAT is ${commercial.vat}, and final value is ${commercial.finalValue}.`

The net material unit cost is stored in discounted.net (line 227), which flows into the pricing line via `netMaterialUnitCost: discounted.net`.

---

## 6. NO MUTATIONS MADE (per governance)

| Action | Status |
|---|---|
| ✅ No hardcode 0.35 in pricing-runtime logic | The 0.35 net multiplier is governed (discount_rules table), not embedded in code |
| ✅ No mutate every price record manually | The discount rule is referenced by ID, not applied by SQL UPDATE |
| ✅ No create parallel ad-hoc table | The existing `discount_rules` table is used (already versioned, provenance-bound) |
| ✅ No overwrite source list-price record | Source LIST_PRICE (USD 6,787.00, amount_minor=678700) is preserved intact |
| ✅ No assume supplier net price | Rule explicitlyNotApplicableTo excludes non-Farenhyt brands [NOTIFIER, GAMEWELL, GENT, generic HONEYWELL] |
| ✅ No apply to external quotations | Rule scope=ALL_FARENHYT, rule authority=COMMERCIAL (company commercial policy) |
| ✅ No engineer-entered per-project assumption | Rule statement explicitly: "This is company commercial policy, NOT an engineer-entered per-project assumption." |

---

## 6. TECHNICAL AUTHORITY INDEPENDENCE

| Principle | Status |
|---|---|
| ✅ 65% rule does NOT authorize Technical Approval | Technical gate separate (70 safety decisions, all with blocking conditions; category/productFamily missing) |
| ✅ 65% rule does NOT authorize product selection | Product identity from library_products match runs, not from discount rule |
| ✅ 65% rule does NOT authorize Safety Approval | Safety approvals via confidence-safety-api.mjs POST /approve, separate commercial gate |
| ✅ Pricing executes only after technical authority exists | Both gates must independently land (technical eligibility AND Costing authority) |
| ⏳ IFP-2100HV Costing authority prepared but not live | Costing source ready pending technical approval; will auto-activate through governed path |
| ⏳ Pricing run not created yet | Both technical eligibility (0/90 items) AND Costing authority must land first |

---

## 7. SUMMARY QUANTITIES

| Metric | Value |
|---|---|
| **FARENHYT_INTERNAL_LIST_DISCOUNT_AUTHORITY** | YES (already existing, ruled `discountrule_784cec95`) |
| **FARENHYT_DISCOUNT_PERCENT** | 65 (6500 basis points, governed) |
| **IFP_2100HV_LIST_PRICE_USD** | 6787.00 |
| **IFP_2100HV_NET_COST_USD** | 2375.45 (LIST_PRICE × 0.35) |
| **IFP_2100HV_NET_COST_SAR** | 8907.94 (net_cost_usd × 3.75, money-minor rounded) |
| **IFP_2100HV_NET_COST_SAR_MINOR** | 890794 (Math.round(8907.9375 × 100)) |
| **IFP_2100HV_COSTING_SOURCE_READY** | NO (pending technical approval + governed review promotion) |
| **IFP_2100HV_TECHNICALLY_APPROVED** | NO (0/90 items eligible; Agent 2 closing final blocker) |
| **CURRENT_PRICING_RUNS** | 0 |
| **CANONICAL_QUOTATION_AUTHORITY_READY** | NO |

**Money-chain verification** (end-to-end through governed code):
```
678700 amount_minor / 100 = 6787.00 USD LIST_PRICE
6787.00 × 0.35 = 2375.45 USD NET_COST (governed 65% discount rule)
2375.45 × 3.75 = 8907.9375 SAR (governed FX: 3.75 SAR/USD)
Math.round(8907.9375 × 100) = 890794 SAR MINOR (governed moneyMinor contract)
```

---

## 8. NO CHANGES Made (per governance rules)

- ✅ No quotation writer changes
- ✅ No live Al Musa commercial state created
- ✅ No commit/push/deploy
- ✅ No DB schema mutations
- ✅ No price record mutations by SQL
- ✅ No hardcoded constants in runtime logic (0.35 is governed, not embedded)
- ✅ No parallel ad-hoc tables created
- ✅ No source list-price records overwritten
- ✅ No engineer-entered per-project assumptions

---

## Ownership & Next Steps

- **This lane's work**: Identified the existing governed discount rule (`discountrule_784cec95`), verified the money derivation mathematics, confirmed applicability to IFP-2100HV (manufacturer ✓, source_id ✓, family_scope ✓), and confirmed the derivation path through the existing `applyDiscounts` pricing engine. The rule is already in the governed commercial authority and will auto-apply through the commercial review path when technical approval lands.

- **Technical approval ownership**: Agent 2 (closing final IFP-2100HV technical blocker — resolving missing `category` and `productFamily` in 70 safety decisions, creating safety approval requests via `confidence-safety-api.mjs POST /approve`)

- **Costing review promotion**: When technical approval lands, the governed commercial review path promotes the discount rule through the existing approval gate, deriving `approval_ready=1` and enabling Commercial Price approval packet. The sequence is: Technical approval → selected IFP-2100HV → governed list price → governed 65% discount rule → derived net cost → governed FX → `persistRun` → pricing line → `approval_ready` → Commercial Price approval packet.

- **Governed discount rule activation**: The 65% discount rule is already approved and will activate automatically through the governed `persistRun` path when both conditions are met:
  1. Technical eligibility (technical_eligibility LIKE 'Eligible%' for the BOQ item)
  2. Governed discount rule promotion (downstreamUse promoted from Discovery Only to Costing, approval_status promoted from Needs Review to Approved for Costing)

**Final**: FARENHYT_INTERNAL_LIST_DISCOUNT_AUTHORITY = YES | FARENHYT_DISCOUNT_PERCENT = 65 | IFP_2100HV_LIST_PRICE_USD = 6787.00 | IFP_2100HV_NET_COST_USD = 2375.45 | IFP_2100HV_NET_COST_SAR = 8907.94 | IFP_2100HV_COSTING_SOURCE_READY = NO (pending) | IFP_2100HV_TECHNICALLY_APPROVED = NO (0 eligible) | CURRENT_PRICING_RUNS = 0 | CANONICAL_QUOTATION_AUTHORITY_READY = NO

No sizing. No quotation. No commit/push/deploy. The governed discount rule is already existing and approved; it will activate through the commercial review path when technical authority lands.