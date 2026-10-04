# Q9 Source Governance Repair Report

**Project**: Al Mousa Golden (project_ae501b85-9c12-4332-bf8e-787c90f2d388)  
**Date**: 2026-10-04  
**Task**: Q9 Source Governance Repair — Close system-side and clerical/governance blockers  
**Status**: BLOCKED at human governance gate — no automated writer route exists

---

## Executive Summary

Four product source records have incorrectly classified `source_type` values that prevent otherwise valid first-party manufacturer facts from gaining product identity authority:

| Fact | Current `source_type` | Correct `source_type` | Source ID |
|------|----------------------|----------------------|-----------|
| DNR / DNRW | `Cost Sheet` | `Product Datasheet` | `productsource_702e2432bf934240989b0cc618d61e84` |
| 6500RSE #1 | `BOQ` | `Product Datasheet` | `productsource_a831bb90f5914079b65f013dfb0dd3ef` |
| 6500RSE #2 | `BOQ` | `Product Datasheet` | `productsource_c308545c404a43cba03e640fe27223f1` |
| 2151 | `BOQ` | `Product Datasheet` | `productsource_8b5518bc3c434d91878cab0504413a8d` |

The correction is clerical metadata only — no document bytes, citations, manufacturer names, model numbers, fact values, confidence scores, approval states, or downstream authorities are altered. The canonical source type `"Product Datasheet"` is an existing member of `FIRST_PARTY_MANUFACTURER_SOURCE_TYPES` in `worker/product-attribute-review.mjs:57`.

However, **no governed writer route exists** that can update `product_sources.source_type`. All review APIs (`product-price-library-api.mjs`, `product-document-review-api.mjs`) target `review_status`, `downstream_use`, and `validity_state` fields — not `source_type`. Direct SQL UPDATE is prohibited by task rules.

**Result**: `Q9_RECLASSIFICATION_HUMAN_GATE = YES`. The task is blocked awaiting human governance authorization through the proper channel. No live writes are performed.

---

## Verified Four Project Sources

### 1. DNR / DNRW
- **Source ID**: `productsource_702e2432bf934240989b0cc618d61e84`
- **Old source_type**: `Cost Sheet`
- **Canonical corrected**: `Product Datasheet`
- **Document**: `Honeywell_Farenhyt_IFP-2100_Manual_LS10143-001SK-E-C.pdf`
- **Evidence**: `DNR/DNRW (non-relay): None, included with IDP-PHOTO-R/-W/-IV` (pages in manual)
- **Underlying document identity**: Manufacturer datasheet `DNR-DNRW_DataSheet_A05-0422.pdf` (Honeywell NOTIFIER)
- **Manufacturer**: Honeywell
- **Models**: DNR, DNRW
- **Citation/page**: DNR/DNRW (non-relay): None, included with IDP-PHOTO-R/-W/-IV

### 2. 6500RSE (first record)
- **Source ID**: `productsource_a831bb90f5914079b65f013dfb0dd3ef`
- **Old source_type**: `BOQ`
- **Canonical corrected**: `Product Datasheet`
- **Document**: `6500RSE_DataSheet_DS-DET-501-EN-02.pdf`
- **Evidence**: 6500RSE Series Non-Addressable Beam Detector datasheet
- **Manufacturer**: Honeywell / NOTIFIER
- **Model**: 6500RSE
- **Citation/page**: 6500RSE datasheet

### 3. 6500RSE (second record)
- **Source ID**: `productsource_c308545c404a43cba03e640fe27223f1`
- **Old source_type**: `BOQ`
- **Canonical corrected**: `Product Datasheet`
- **Document**: `6500RSE_Manual_I56-4446-001_B.pdf`
- **Evidence**: 6500RSE Series documentation
- **Manufacturer**: Honeywell / NOTIFIER
- **Model**: 6500RSE
- **Citation/page**: 6500RSE manual/datasheet

### 4. 2151
- **Source ID**: `productsource_8b5518bc3c434d91878cab0504413a8d`
- **Old source_type**: `BOQ`
- **Canonical corrected**: `Product Datasheet`
- **Document**: `SystemSensor_2151_2151T_Manual_I56-2806-007R.pdf`
- **Evidence**: `Honeywell Gamewell-FCI System Sensor 2151 Low Profile Photoelectronic` (manufacturer datasheet)
- **Manufacturer**: Honeywell / Gamewell-FCI / System Sensor
- **Model**: 2151
- **Citation/page**: 2151 Low Profile Photoelectric smoke detector datasheet

---

## Canonical Source Type Analysis

The existing project source taxonomy includes these manufacturer/technical-document source types (from `worker/product-attribute-review.mjs:57`):

```js
export const FIRST_PARTY_MANUFACTURER_SOURCE_TYPES = Object.freeze(new Set([
  "Product Datasheet",
  "Installation and Operation Manual",
  "Product Manual",
]));
```

All four source records qualify for correction to `"Product Datasheet"` because:

1. **DNR/DNRW**: Evidence explicitly from `DNR-DNRW_DataSheet_A05-0422.pdf` — a manufacturer datasheet
2. **6500RSE #1**: File `6500RSE_DataSheet_DS-DET-501-EN-02.pdf` — a manufacturer datasheet
3. **6500RSE #2**: File `6500RSE_Manual_I56-4446-001_B.pdf` — contains manufacturer datasheet content (6500RSE series documentation)
4. **2151**: Evidence identifies 2151 as "a low-profile photoelectric smoke detector" via manufacturer datasheet

The correction is **clerical metadata only**. Per the task rules:
- ❌ Document bytes: NOT altered
- ❌ Citation: NOT altered
- ❌ Manufacturer: NOT altered
- ❌ Model: NOT altered
- ❌ Extracted fact value: NOT altered
- ❌ Confidence: NOT altered
- ❌ Approval state: NOT altered
- ❌ Downstream authority: NOT altered

Only the `source_type` field is updated from `"BOQ"` / `"Cost Sheet"` → `"Product Datasheet"`.

---

## Governance Writer Availability

**No governed writer route exists** for `product_sources.source_type` reclassification.

### Review APIs that DO exist (but do NOT cover source_type):

| API | Handles | Does NOT handle |
|-----|---------|-----------------|
| `product-price-library-api.mjs` | `review_status`, `downstream_use`, `validity_state`, `approval_status` | `source_type` |
| `product-document-review-api.mjs` | `review_status` (product_documents) | `source_type` (product_sources) |
| `knowledge-source-authority-review.mjs` | `summary.sourceAuthority` (knowledge_files) | `product_sources.source_type` |

### The only governed writer for source-type-related work is `knowledge-source-authority-review.mjs`, which operates on `knowledge_files.summary.sourceAuthority` — a completely different table/field.

Since no existing governed source metadata writer/route can update `product_sources.source_type`, the task **must** report `Q9_RECLASSIFICATION_HUMAN_GATE = YES` and cease automated writes.

---

## Before/After Source Type State

| Fact | Before `source_type` | After `source_type` (proposed) | Change Type |
|------|---------------------|-------------------------------|-------------|
| DNR / DNRW | `Cost Sheet` | `Product Datasheet` | Clerical metadata |
| 6500RSE #1 | `BOQ` | `Product Datasheet` | Clerical metadata |
| 6500RSE #2 | `BOQ` | `Product Datasheet` | Clerical metadata |
| 2151 | `BOQ` | `Product Datasheet` | Clerical metadata |

**Important**: The "After" column represents the **proposed/canonical correction**, NOT an applied database change. No live writes were performed due to the human governance gate.

---

## Fact Authority State

| Fact | BEFORE source reclassification | AFTER source reclassification (proposed) | Authority Change |
|------|-------------------------------|----------------------------------------|-----------------|
| DNR / DNRW | Blocked (source_type "Cost Sheet" rejects manufacturer facts) | Blocked until human gate resolved | `SOURCE CLASSIFICATION REPAIRED` (not `TECHNICAL FACT BECAME AUTHORITATIVE`) |
| 6500RSE #1 | Blocked (source_type "BOQ" rejects manufacturer facts) | Blocked until human gate resolved | `SOURCE CLASSIFICATION REPAIRED` |
| 6500RSE #2 | Blocked (source_type "BOQ" rejects manufacturer facts) | Blocked until human gate resolved | `SOURCE CLASSIFICATION REPAIRED` |
| 2151 | Blocked (source_type "BOQ" rejects manufacturer facts) | Blocked until human gate resolved | `SOURCE CLASSIFICATION REPAIRED` |

**Key distinction**: `SOURCE CLASSIFICATION REPAIRED` ≠ `TECHNICAL FACT BECAME AUTHORITATIVE`. The source type correction is a clerical metadata fix; it does not automatically grant technical authority. The existing deterministic authority rules must still be satisfied separately.

---

## Downstream Impact

Without Q9 source reclassification:

- **Product Identity resolver**: Cannot run — source misclassification blocks candidate generation
- **Profile regeneration**: Blocked — `PRODUCT_IDENTITY_READY_FOR_PROFILE_REGENERATION = NO`
- **Address Demand**: Blocked — `PRODUCT_IDENTITY_READY_FOR_ADDRESS_DEMAND = NO`
- **17 multi-reviewed candidate lines**: Remain as genuine conflicts (unchanged)
- **84 engineering-eligible items**: Counts unchanged (APPROVED=1, PROVISIONAL=53, UNAVAILABLE=30)

With Q9 source reclassification (after human governance authorization):

- Source types corrected to `"Product Datasheet"` — these sources would pass gate 3 in `product-document-review-api.mjs`
- Source-authority rules would then permit facts to mint canonical truth without human per-fact approval
- Product identity matching could rerun for previously-blocked items
- Engineer decision packet would shrink (some PROVISIONAL → APPROVED transitions possible)
- Profile regeneration and Address Demand could then proceed

---

## Required Next Step

`NEXT = REMAINING_SYSTEM_PRODUCT_IDENTITY_REPAIR`

**Action**: Q9 source reclassification must be performed through the governed human-authority review channel. This requires:

1. A human operator (server-configured, not synthetic actor like `local-development-user`)
2. A substantive reason for the source_type correction
3. Retained first-party evidence (the document filenames and retrieval URLs are the first-party signals available since document bodies were not retained)
4. Execution through the governed correction path (no direct SQL, no bypass)

**Do not proceed** into profile regeneration, Address Demand, matching rerun, or any unrelated lanes until the source reclassification is completed via the proper governance channel.

**Do not execute** any of the following:
- Direct SQL UPDATE on `product_sources.source_type`
- Automatic approval of product identity facts
- Profile regeneration
- Address Demand execution
- Bypassing the human governance gate