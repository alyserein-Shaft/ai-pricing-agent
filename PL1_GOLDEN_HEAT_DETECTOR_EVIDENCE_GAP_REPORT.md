# PL1_GOLDEN_HEAT_DETECTOR_EVIDENCE_GAP_REPORT

**Lane:** Product Library (PL1)
**Scope:** Heat Detector family + Golden Heat Detector requirement + product-side evidence only
**Golden project:** `project_c0123d91-c30b-4956-87cb-e473ef53f89d` (Al Mousa School)
**Golden requirement:** `specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_197` (28 46 00, clause 5, ROR heat detector)
**Engineering decision:** 9 × standard-ambient ROR heat detector, 0 × high-temperature
**Current candidate:** `IDP-HEAT-ROR-IV` (`product_161c27bf-70d9-4e3e-b1c9-ad7783dc3dac`)
**Status:** INVESTIGATION COMPLETE — evidence-backed plan only. **Zero business-data mutations applied.**
**Date:** 2026-09-22 (today)

---

## 1. Heat Detector library census

Family: `Addressable Heat Detector` (`family_a51e96a0-4ced-4941-92a1-9d9f67dfc2e5`) — **13 products, single manufacturer: Honeywell (Farenhyt line)**. No other manufacturer in the family.

| product id | mfr | part number | review | discovery | lifecycle (stored) | fixed 135°F | ROR 15°F/min | addressing | protocol | listings (standards JSON) | compatibility evidence | provenance |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `product_161c27bf…` | Honeywell | **IDP-HEAT-ROR-IV** | Reviewed | 1 | Unknown — Review Required | ✅ PROVEN | ✅ PROVEN | ✅ Addressable | IDP | UL S2101, CSFM 7270-0559:0511 (Verified, conf 95) | 9× Approved `COMPATIBLE_WITH_BASE` → Farenhyt IDP bases (B501-IV, B501-WHITE, B501-BL, B300-6, B200S-IV, B200S-WH, B200S-LF-IV, B224BI-IV, B224RB-IV); `required_protocol = null` | Datasheet 350285 Rev H 12/17; 351630 Rev A 04/18; 2023 Farenhyt price-library rows 94/116 |
| `product_abe27b67…` | Honeywell | IDP-HEAT-IV | Reviewed | 1 | Unknown — Review Required | ✅ 135°F only | ❌ none | ✅ Addressable | IDP | UL S2101, CSFM (same) | 9× Approved base rows | same |
| `product_c03f06ea…` | Honeywell | IDP-HEAT-HT-IV | Reviewed | 1 | Unknown — Review Required | ⚠️ 135–190°F high-temp | ❌ none | ✅ Addressable | IDP | UL S2101, CSFM (same) | 9× Approved base rows | same |
| `product_9f8bb967…` | Honeywell | IDP-HEAT-HT-W | Needs Review | 0 | Unknown | ⚠️ high-temp | ❌ | ✅ | IDP | UL S2101, CSFM | none approved | same |
| `product_287af2b5…` | Honeywell | IDP-HEAT-ROR-W | Needs Review | 0 | Unknown | ✅ | ✅ | ✅ | IDP | UL S2101, CSFM | none approved | same |
| `product_a8ffb097…` | Honeywell | IDP-HEAT-W | Needs Review | 0 | Unknown | ✅ 135°F only | ❌ | ✅ | IDP | UL S2101, CSFM | none approved | same |
| `product_1bfb95d1…` | Honeywell | WIDP-HEAT | Needs Review | 0 | Unknown | ✅ 135°F | ❌ | wireless | SWIFT | UL S6173/S6228, CSFM | none | datasheet 350615 Rev B |
| + 6 trailing-dot duplicates (`*.`) | Honeywell | `IDP-HEAT-HT-IV.` etc. | Needs Review | 0 | Unknown | — (empty rows) | — | — | — | none | none | dedupe artifact of price-library import |

**Broad identifier sweep (whole library):** `IDP-HEAT%` / `FST-951%` / `FST-851%` / `FST-%` / `FDOT%` → no FST-series product exists anywhere; no part number, description, attribute, standard, compatibility row, or identity mentions **FlashScan**, **CLIP**, or **Notifier**. Also found in other family: conventional System-Sensor 5151 / 5151-CH / 5351E / 2351TEM (conventional, not addressable FlashScan/CLIP), and wireless WIDP-HEAT-ROR — none addressable FlashScan/CLIP on two-wire SLC.

**Manufacturer store:** 17 manufacturers in `library_products`; **NOTIFIER present in 0 products, 0 brands, 0 identities.**

---

## 2. Golden evidence matrix (product-side readiness only — no matcher scoring)

Compare IDP-HEAT-ROR-IV against the five Golden dimensions from requirement 197 (clause 5: ROR 15°F/min; fixed 135°F; individually addressable; compatible with FlashScan® and CLIP; two-wire SLC):

| Golden dimension | Classification | Basis (stored, governed evidence) |
|---|---|---|
| 135°F fixed temperature | **PROVEN** | `fixed_temperature_setpoint` = 135°F (conf 90) from Honeywell Farenhyt datasheet 350285 Rev H / 351630 Rev A |
| 15°F/min rate-of-rise | **PROVEN** | `rate_of_rise_sensitivity` = 15°F/min (conf 90/94) from datasheet 350285 |
| Addressable | **PROVEN** | `addressing` = Addressable (conf 90) |
| FlashScan | **MISSING_PRODUCT_EVIDENCE** | No governed product evidence claims FlashScan. Recorded protocol = **IDP** (Farenhyt). IDP ≠ FlashScan; no bridging is permitted. |
| CLIP | **MISSING_PRODUCT_EVIDENCE** | No governed product evidence claims CLIP. Same protocol boundary as above. |
| Two-wire SLC | (project-architecture dimension) | Not a product-capability claim; handled by the Stage 4 Drawing Bridge (SLC=CIRCUIT_BUS project architecture evidence), not the Product Library lane. |

No dimension is CONTRADICTED by stored evidence; two are genuinely missing as product evidence.

---

## 3. IDP-HEAT-ROR-IV audit (separated concerns)

| Concern | What is known | What it does NOT prove |
|---|---|---|
| **PRODUCT IDENTITY** | Honeywell, Farenhyt line, part `IDP-HEAT-ROR-IV`, ivory, base not included; canonical + approved for discovery | Not a Notifier product |
| **PRODUCT CAPABILITY** | Fixed 135°F + ROR 15°F/min, thermistor sensing, addressable, 15–32 VDC, UL S2101 / CSFM listings verified | Does not prove any protocol beyond the product's own line |
| **PRODUCT PROTOCOL** | Protocol = **IDP** (Farenhyt); datasheet: “For use with Honeywell Farenhyt series fire alarm control panels (FACPs)… IDP series bases” (conf 92) | **IDP does NOT mean FlashScan or CLIP.** Neither is claimed anywhere in evidence |
| **PRODUCT COMPATIBILITY** | 9× Approved `COMPATIBLE_WITH_BASE` relationships, **only** against Farenhyt IDP bases (B501-IV/B501-WHITE/B501-BL/B300-6/B200S-IV/B200S-WH/B200S-LF-IV/B224BI-IV/B224RB-IV); auto-confirm gates passed; `required_protocol = null` | No panel/FACP compatibility rows; no FlashScan/CLIP compatibility anywhere |
| **CERTIFICATION / LISTING** | UL S2101 + CSFM 7270-0559:0511 stored in `library_products.standards` JSON (Verified, conf 95) sourced from IDP-HEAT-W datasheet; `product_certifications` table holds **0 rows** for the family | Listings are thermal/electrical listings, not protocol interoperability |
| **LIFECYCLE** | Stored `Unknown — Review Required`. One un-reviewed XLSX obsolete entry (`IDP-HEAT-ROR → IDP-HEAT-ROR-W/-IV`) indicates the **-IV is the replacement line** of base IDP-HEAT-ROR — i.e., no authoritative discontinuation of -IV itself | The XLSX note is a distributor price-library sheet pending review, not an authoritative manufacturer lifecycle notice |

**Conclusion:** Honeywell parent-company ≠ Notifier FlashScan/CLIP interoperability. IDP ≠ FlashScan. IDP-HEAT-ROR-IV's own identity/capability/protocol evidence affirm it is a **Farenhyt IDP device**, nothing more. It must not be made technically compliant by assumption.

---

## 4. Authoritative external evidence (evidence hierarchy: manufacturer datasheets/manuals > lifecycle notices > listings > distributors)

### 4a. Notifier FST-851 / FST-851R — capability source
- **Source:** Notifier (Honeywell) FST-851 Series datasheet DN-6936 (©2009) / FST-851(A) series datasheet; installation manual I56-3518 (©2008, Rev 001R)
- **What it proves:** FST-851R = fixed 135°F + **ROR >15°F/min**; addressable by device; **“Compatible with FlashScan® and CLIP protocol systems”**; **two-wire SLC connection**; rotary addressing 1–99 CLIP / 1–159 FlashScan; UL 521 50-ft spacing; FM approved; UL S747 (1949-derived catalog), CSFM 7270-0028:0196
- **What it does NOT prove:** current (2026) production status — see lifecycle below.

### 4b. Notifier FST-951 Series (the “current”-era line, incl. FST-951R-IV)
- **Source:** Notifier FST-951 Series datasheet DN-60975 (Honeywell securityandfire.com, official); Honeywell SLC Wiring Manual doc 51253-U9
- **What it proves:** FST-951R = ROR **15°F (8.3°C) per minute**, factory preset 135°F; addressable; **“-IV suffix indicates CLIP and FlashScan device”** — **FST-951R-IV: FlashScan AND CLIP**, two-wire SLC; UL 521 7th Ed design
- **What it does NOT prove:** availability after end-2024 — see lifecycle below.

### 4c. Lifecycle notices (authoritative)
- **Honeywell Building Automation product pages** (buildings.honeywell.com, US/AU/IN): FST-851 Series page — **“This product has been discontinued”**; FST-951 Intelligent Addressable Heat Detector page — **“Discontinued” / “This product has been discontinued”**
- **Notifier (Honeywell) M23.18 — Ivory Detector Discontinuation Notice:** ALL NOTIFIER **ivory** detectors (explicitly incl. **FST-951R-IV**, FST-951-IV, FST-951H-IV, and Fire Warden NH-200R-IV, FST-851R-era ivory equivalents) **fully discontinued as of 2024-12-31**; final orders by 2024-12-01. Notice directs legacy CLIP support toward FlashScan: *“we strongly recommend using the newer and more capable FlashScan protocol devices on all new NOTIFIER installations.”*
- **Notifier FST-951-ISO Series datasheet (Honeywell India, pub. 2025-11-26):** current-generation isolator heat detector — **FlashScan® ONLY**, explicitly “Compatible with only FlashScan® protocol systems” (no CLIP).

### 4d. What the combined external evidence proves about the Golden dimensions
135°F ✅, 15°F/min ✅, addressable ✅, FlashScan ✅, CLIP ✅ are ALL manufacturer-proven **only for legacy Notifier FST-851/951-series devices that have since been discontinued by Honeywell**. The current Notifier line (951-ISO) is FlashScan-only. No authoritative source proves a **current, in-production Notifier 135°F + ROR + FlashScan + CLIP** heat detector as of 2026.

---

## 5. Candidate lifecycle status (2026-09-22)

| Candidate | Lifecycle (authoritative) | Supportable as current Golden solution? |
|---|---|---|
| IDP-HEAT-ROR-IV (in library) | Stored `Unknown — Review Required`; family line active in 2023 price library; XLSX shows -ROR→-ROR-IV as replacement | **No** — protocol channel is IDP (Farenhyt), no FlashScan/CLIP evidence |
| FST-951R-IV (foreign knowledge) | **DISCONTINUED** — Honeywell product page + M23.18 (full discontinuation 2024-12-31; foreword to CLIP) | No — disconnected product; must not be recommended |
| FST-851R (foreign knowledge) | **DISCONTINUED** — Honeywell FST-851 Series product page banner | No — not current per manufacturer's own site |
| FST-951-ISO (foreign knowledge) | Current (2025-11-26 datasheet) | **No for Golden** — FlashScan only, no CLIP |
| 5151 / 5351E / 2351TEM / WIDP-HEAT-ROR (in library, other families) | Conventional / wireless | No — not addressable FlashScan/CLIP on two-wire SLC |

---

## 6. Current compliant candidate

# **A. NO**

The CURRENT Product Library does **not** contain a technically supportable Golden Heat Detector candidate.

**B. n/a** — there is no qualifying current product in the library. The nearest existing product (IDP-HEAT-ROR-IV) proves 3 of 5 dimensions but cannot prove FlashScan/CLIP because its governed protocol is Farenhyt IDP.

**C. Exact gap:** a governed **Notifier (FlashScan + CLIP, two-wire SLC, 135°F fixed, 15°F/min ROR, addressable) heat-detector product** with (i) capability evidence, (ii) explicit protocol/compatibility evidence (FlashScan AND CLIP), and (iii) an authoritative current lifecycle status — currently absent from the library. The externally known devices that would satisfy the capability+protocol dimensions (FST-951R-IV / FST-851R) are discontinued by Honeywell; the current 951-ISO line is FlashScan-only.

**D. Gap type (primary):** **missing current product** — the library has no Notifier/FlashScan/CLIP family product at all. Secondary contributing factors:
- **wrong/insufficient product** — the incumbent Farenhyt IDP-HEAT-ROR-IV cannot be corrected by adding evidence (protocol channel is IDP);
- **discontinued product** — both candidate Notifier families that would carry the required evidence are discontinued per manufacturer lifecycle;
- NOT a “missing evidence on an existing product” case (no enrichable existing product can truthfully carry FlashScan/CLIP);
- NOT a schema gap (see §9).

---

## 7. Exact evidence gap (Golden, product-side)

For the Golden ROR heat detector, the Product Library lacks product-side governed evidence for:
1. **FlashScan protocol compatibility** — zero tokens in the entire library;
2. **CLIP protocol compatibility** — zero tokens in the entire library;
3. **A current, in-production manufacturer product** that carries both protocol facts (the only products that prove both are discontinued; current line is FlashScan-only).

Thermal/addressing dimensions (135°F, 15°F/min, addressable) are **fully proven** on IDP-HEAT-ROR-IV but on the wrong protocol channel.

---

## 8. Proposed Product Library enrichment (evidence-backed plan — NOT applied)

| Fact | Proposed fact | Classification | Proposed surface | Evidence |
|---|---|---|---|---|
| 135°F / 15°F/min / Addressable on IDP-HEAT-ROR-IV | already correctly governed | **SAFE_TO_ENRICH** (already present) | no change needed | 350285 Rev H |
| FlashScan / CLIP on IDP-HEAT-ROR-IV | **must NOT be added** — would arbitrarily bridge Farenhyt IDP semantics onto a Notifier protocol claim | **INSUFFICIENT_EVIDENCE / DO NOT ENRICH** | n/a | n/a |
| Notifier FST-951R-IV entry (capability + FlashScan + CLIP + lifecycle) | add governed product record (identity, capability, protocol, listing UL S747, lifecycle=DISCONTINUED w/ 2024-12-31) with full provenance | **DISCONTINUED_PRODUCT** — catalog as discontinued reference only; never as current Golden candidate | `library_products` + `product_attributes` + `product_compatibility` + `product_lifecycle_events` | DN-60975; M23.18; SLC manual 51253; honeywell.com pages |
| Notifier FST-851R entry | add governed record ONLY after confirming whether the series is still orderable; datasheet-era evidence conflicts with 2026 honeywell.com discontinuation banner | **NEEDS_HUMAN_REVIEW** (lifecycle conflict) | same surfaces | DN-6936 / I56-3518 vs current product page |
| FST-951-ISO (current, FlashScan-only) | candidates on FlashScan-only panel segments; does NOT satisfy Golden CLIP dimension | **NEEDS_HUMAN_REVIEW** (protocol mismatch vs requirement) | `library_products` + attributes | 2025-11-26 datasheet |
| Any “Notifier FlashScan+CLIP current product” claim | none exists per authoritative evidence | **INSUFFICIENT_EVIDENCE** | n/a | M23.18 direction: new installs → FlashScan |

No inference. No manufacturer-family shortcut. Honeywell parentage never implies Notifier interoperability.

---

## 9. Schema gap

**NO schema gap.** The existing Product Library accommodates every required dimension without migration:
- `fixed_temperature_setpoint`, `rate_of_rise_sensitivity`, `addressing`, `protocol` → `product_attributes.attribute_name` (pattern already in use);
- product compatibility / required protocol → `product_compatibility` (`relationship_type`, `required_protocol`, `conditions_json`, `evidence_json`) — table already exists;
- listing/certification → `product_certifications` (exists; currently 0 rows for this family — enrichment would populate it) and `library_products.standards` JSON;
- lifecycle → `library_products.lifecycle_status` + `product_lifecycle_events` (exists).

---

## 10. Data mutations

**NONE.** Investigation was strictly read-only against the live D1 (opened `readOnly: true`). No product rows, attributes, compatibility, certifications, lifecycle, identity, or price data were written. No migration, no schema change. Probe scripts under `scripts/` are additive, untracked, read-only tooling (census / satellite / golden-requirement / provenance probes).

---

## 11. Exactly ONE next step (owner decision; NOT implemented here)

> Owner approves creating a **governed Notifier heat-detector reference record for FST-951R-IV as a DISCONTINUED product** (capability 135°F + 15°F/min ROR + addressable, protocol FlashScan + CLIP with DN-60975 provenance, lifecycle DISCONTINUED with M23.18 2024-12-31 notice), plus an **open NEEDS_HUMAN_REVIEW follow-up** confirming whether any current Notifier CLIP-capable ROR heat detector remains orderable for the FlashScan+CLIP Golden requirement — the enrichment mutation spec to be prepared and applied **only after this owner review**, and kept strictly inside the Product Library lane.

The Golden candidate cannot be closed by enriching the incumbent Farenhyt product and must not be closed by assumption of FlashScan/CLIP.

---

*STOPPED — awaiting owner review. No implementation performed.*