# Fast Close — Separate Reusable Sizing Knowledge from Legacy Al Mousa Data

**Legacy Project**: `project_ae501b85-9c12-4332-bf8e-787c90f2d388`
**New Project State**: `LEGACY_REFERENCE_ONLY`
**Date**: Sun Oct 04 2026

## 1. Reusable IFP-2100HV Capacity Facts (7)

| # | Attribute Name | Value | Unit | Source Document | Source Revision/Version | Exact Evidence Location | Review Status |
|---|---|---|---|---|---|---|---|
| 1 | `native_slc_loops` | 1 | loop | Honeywell IFP-2100 DS | 351602 Rev C (04-2022) | `"original":"Intelligent Signaling Line Circuits: 1 (expandable)"` | Needs Review |
| 2 | `max_detectors_per_loop` | 159 | detectors per loop | Honeywell IFP-2100 DS | 351602 Rev C (04-2022) | `"original":"159 System Sensor IDP/SK sensors ... per loop"` | Needs Review |
| 3 | `max_modules_per_loop` | 159 | modules per loop | Honeywell IFP-2100 DS | 351602 Rev C (04-2022) | `"original":"159 IDP/SK modules ... per loop"` | Needs Review |
| 4 | `max_system_points` | 2100 | points | Honeywell IFP-2100 DS | 351602 Rev C (04-2022) | `"original":"Addressable device capacity: 2100 (IDP/SK)"` | Needs Review |
| 5 | `slc_expansion_state` | EXPANSION_SUPPORTED | enum | Honeywell IFP-2100 DS | 351602 Rev C (04-2022) | `"original":"6815: SLC Expander for IDP and SK devices -- listed under SYSTEM EXPANDERS"` | Needs Review |
| 6 | `slc_expansion_max_count` | 63 | count | 6815 DS + LS10143-001SK-E | Rev E Sec 4.12 | `"original":"CORRECTED 2026-10-01 from 12... Corroborated by LS10143-001SK-E Rev E Sec 4.12"` | Needs Review |
| 7 | `sbus_device_limit` | 63 | count | LS10143-001SK-E | Rev E Sec 4.12 | `"original":"The system supports a maximum of 63 SBUS devices in any combination"` | Needs Review |

All 7 facts are **product-library reusable** — they are ingested `product_attribute` rows with `review_status='Needs Review'`, governed for Omair approval. These are the *only* reusable product-level sizing knowledge from the legacy project.

---

## 2. Reusable 6815 Expansion Relationship (1)

| Field | Value |
|---|---|
| `parent product` | `product_ec9dcbb1-39fe-4d24-b369-8b3d271604a7` (IFP-2100HV) |
| `accessory product` | `product_d03ba56e-a8c2-4e5b-8c9d-47c683b012c8` (6815) |
| `relationship type` | Expansion Module |
| `added_slc_loops` | 1 (CAPACITY_DEPENDENT — governed project sizing) |
| `expansion limit / relevant attributes` | quantity_parameter=1; scope=system; condition_json cites 6815 Data Sheet LS10143-001SK-E Rev E |
| `first-party source` | Honeywell 6815 Signaling Line Circuit Expander Data Sheet |
| `current review_status` | Needs Review |

This single `product_accessories` row is the *only* reusable expansion relationship from the legacy project. It is ingested with `review_status='Needs Review'`, governed for Omair approval.

---

## 3. Legacy Stage-4 Data

**Status**: `LEGACY_REFERENCE_ONLY`

The 10 `drawing_architecture_approved_rows` and Stage-4 bridge context created for the old Al Mousa project are **not** approved, promoted, generalized, or migrated. They remain as historical reference only.

The future clean project must regenerate its own:
- architecture facts
- approved rows
- Stage-4 readiness

from fresh source ingestion.

**`LEGACY_STAGE4_ROWS_TO_MIGRATE = 0`**

---

## 4. Human Approval Packet — 8 Reusable Sizing Facts

| # | Fact Group | Attribute/Fact | Value | Source | Proposed Action |
|---|---|---|---|---|---|
| 1 | Capacity | `native_slc_loops` | 1 | Honeywell IFP-2100 DS 351602 Rev C | Approve |
| 2 | Capacity | `max_detectors_per_loop` | 159 | Honeywell IFP-2100 DS 351602 Rev C | Approve |
| 3 | Capacity | `max_modules_per_loop` | 159 | Honeywell IFP-2100 DS 351602 Rev C | Approve |
| 4 | Capacity | `max_system_points` | 2100 | Honeywell IFP-2100 DS 351602 Rev C | Approve |
| 5 | Capacity | `slc_expansion_state` | EXPANSION_SUPPORTED | Honeywell IFP-2100 DS 351602 Rev C | Approve |
| 6 | Capacity | `slc_expansion_max_count` | 63 | 6815 DS + LS10143-001SK-E Rev E | Approve |
| 7 | Capacity | `sbus_device_limit` | 63 | LS10143-001SK-E Rev E Sec 4.12 | Approve |
| 8 | Expansion | `IFP-2100HV → 6815` | Expansion Module relationship | Honeywell 6815 DS + project extraction | Approve |

**Total reusable decisions: 8**

These 8 facts are the *only* product-level sizing knowledge approved for reuse from the legacy Al Mousa project. They are all governed `Needs Review` → `Approved` via POST `/api/products/:productId/documents/:documentId/review`. No legacy architecture, quantities, product identity, or commercial data is included.

---

## Final State

```
REUSABLE_CAPACITY_FACTS = 7
REUSABLE_EXPANSION_RELATIONSHIPS = 1
LEGACY_STAGE4_ROWS_TO_MIGRATE = 0

NEXT = OMAIR_APPROVE_8_REUSABLE_SIZING_FACTS
```

**No sizing run.** No legacy project cleanup. No Product Identity work. No quantity work. No broad tests. No commit, push, deploy, reset, stash, or unrelated cleanup.