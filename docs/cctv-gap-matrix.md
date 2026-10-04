# CCTV System Pack — Gap Matrix (v1)

Updated 2026-08-30 against the local D1 database, branch
`phase-5-ai-quotation-engineer`, at the end of the closure continuation
cycle. Companion to
[`cctv-system-pack-v1-release.md`](./cctv-system-pack-v1-release.md), the
authoritative release statement (status: **CLOSED**). Sections below carry
both the original audit findings (unchanged, historical) and this cycle's
closure updates, marked inline.

## 1. Audit baseline (before any mutation)

| Area | Finding |
|---|---|
| CCTV in the system-knowledge-registry | Not registered (comment explicitly named it as a "future system"). |
| CCTV catalog products | **Zero.** No CCTV manufacturer, no CCTV products, in the DB at session start. |
| Historical CCTV project evidence | Substantial and real: `inputs/central-kitchen/` (source BOQ, engineer RFQ, real final quotation PDF) plus a full, already-validated engineering comparison (`outputs/central-kitchen-approved/Central_Kitchen_CCTV_Comparison_v8.xlsx`) with a "Validation" sheet where all 9 cross-checks PASS. |
| Live DB projects with real CCTV BOQ text | "CCTV & Access Control Validation" (`project_66d9c212-45ee-45ec-82c6-6e5a71146acd`) — 33 real CCTV lines (dome/PTZ cameras) mixed with many Access Control lines (out of this scope). |
| Generic platform support | `boq-understanding-engine.mjs` already had generic `megapixels`/`PoE` extraction (unused by Fire Alarm, ready for camera-style systems); `system-knowledge-registry.mjs`'s plug-in architecture was designed exactly for this expansion. |
| Real, latent bug found | `boq-understanding-engine.mjs`'s "prior system" guard was hardcoded to the literal text "fire alarm", which would have silently blocked CCTV's own governance from ever activating on correctly-tagged CCTV rows. Generalized via the registry (fixed this cycle, Fire Alarm behavior unchanged). |

## 2. Taxonomy (v1 scope, evidence-only)

50 → still 50 for Fire Alarm; **CCTV is a new, separate 9-family / 6-category taxonomy**, registered alongside Fire Alarm in `system-knowledge-registry.mjs`.

| Category | Families |
|---|---|
| Cameras | Dome Camera, Bullet Camera, PTZ Camera |
| Recording | NVR |
| Storage | Surveillance HDD |
| Video Management | VMS License |
| Monitoring | Monitor, Workstation |
| Accessories | Junction Box, Pole Mount |

**Deliberately excluded from v1** (zero real evidence found): Turret, Fisheye/360, Multi-Sensor, Box Camera, Thermal Camera, DVR, Recording Server (a real product — PER4502A, a Dell server — exists in the seed but is *generic IT hardware*, not a CCTV-manufacturer product, and was left correctly Unclassified rather than forcing a family for it), Storage Expansion/RAID appliance (separate from NVR), Decoder, Video Wall Controller, PoE Switch/Injector, Media Converter, Housing/Sunshield/Wall-Pendant-Corner-Ceiling Mount (only Pole Mount is evidenced), SFP, separate Lens, Microphone, Camera/Recording/Analytics License (only VMS Base/Channel License is evidenced).

## 3. Product identity / catalog (v1 scope)

14 real Hikvision products seeded from Central Kitchen - Makkah's own real, issued final quotation (Q1067-626-LCU). 13/14 correctly classified into a governed family; 1 (PER4502A, generic Dell server) correctly left Unclassified.

| Tier | Products | Evidence |
|---|---|---|
| Official manufacturer datasheet | DS-2CD3161G2-LIUF (Dome), DS-2CD3061G2-LIUF (Bullet), DS-96256NI-I16 (NVR), DS100HKAI-VX1 (Surveillance HDD) | Hikvision's own published datasheets, verified via web search during this audit, cited by URL. |
| Historical supplier quotation | DS-1280ZJ-DM46, DS-1280ZJ-XS (Junction Box), DS-2CD3T66G2-4IS (anti-fog Bullet), DS-1275ZJ-SUS (Pole Mount), DS-2CD3166G2-ISU-H (anti-fog Dome), PER4502A (server), DS-VE41-T-HW7-B (Workstation), DS-D5024F2-AV2 (Monitor), HikCentral-P-VSS-Base-0Ch / HikCentral-P-VSS-1Ch (VMS License) | Real, issued quotation text kept verbatim (historical quotation is evidence, not truth — never rewritten, never promoted to "manufacturer-verified"). |

**Not seeded**: "634-BYKR Dell Windows Server 2022" license and "Serv-01" Testing & Commissioning (a labor/service line, correctly out of Product Knowledge scope entirely, not a product).

## 4. Selection-critical attributes (v1 scope)

| Family | Attributes governed | Note |
|---|---|---|
| Dome/Bullet/PTZ Camera | `camera_type`, `megapixels`, `indoor_outdoor`, `ip_rating`, `ik_rating`, `focal_length`, `wdr` | `megapixels` reuses the SAME generic deterministic BOQ extraction rule Fire Alarm never needed (`resolutionMegapixels`); extended to also parse the real "6.0 M.P." dotted format found in Central Kitchen's own BOQ text. `wdr` is declared but **not yet wired** to any extraction rule (see §7, known open gap). |
| NVR | `channel_count`, `storage_bay_count` | Real evidence: DS-96256NI-I16's own official datasheet (256 channels, 16 SATA bays). Neither is yet wired to a BOQ/catalog extraction rule this cycle. |
| Surveillance HDD | `capacity_tb` | Declared; not yet wired to an extraction rule. |
| VMS License | `license_scope` (Base/Channel) | Declared; not yet wired. |
| Monitor | `screen_size` | Declared; not yet wired. |

**CLOSED this cycle**: the plain-vs-anti-fog/WDR camera variant discriminator. Real evidence: Hikvision's own official "Digital Defog Technology" terminology (confirmed via web search of Hikvision's own white paper) is the true discriminating attribute — not "WDR" (both plain and anti-fog cameras carry WDR; only the anti-fog variants carry Defog). Added `defog` to `CAMERA_ATTRIBUTES` in `cctv-taxonomy.mjs` with a validator; added a BOQ-side extraction rule to `boq-understanding-engine.mjs` (positive-evidence-only, never inferring a negative on the plain sibling); added a catalog-side extraction rule (`app/domain/cctv-product-attribute-extraction.mjs`) applied via `scripts/extract-cctv-product-attributes.mjs` (`productsChanged: 2, attributesAppended: 2`, idempotent). No SKU was ever hardcoded into ranking logic — the discriminator is purely attribute-based, exactly like every other governed attribute in this platform.

One real-world text bug was found and fixed during this closure: the real Central Kitchen BOQ text glues "mounted" directly onto "anti fog" with no space ("mountedanti fog"), so the initial regex (which required a word boundary before "anti") never matched; fixed by removing that leading boundary requirement.

## 5. Golden dataset & gate

`tests/golden/cctv-central-kitchen.fixture.mjs` — 7 real lines from Central Kitchen - Makkah's own validated quotation. `npm run test:cctv-golden` (`scripts/cctv-golden-evaluation-gate.mjs`) — **GATE PASSED**: 0 true matching errors, 0 false resolves, 0 cross-family ranking errors, family classification 7/7, candidate discovery 7/7, acceptable candidate set 7/7, correct engineer-review 4/4, Historical Top-1 **5/6 (83.3%, up from 4/6 before this cycle's Defog closure)**.

The two anti-fog lines (`anti-fog-bullet`, `anti-fog-dome`) now correctly RESOLVE to their single true historical SKU instead of tying, per the newly-governed Defog evidence — a genuinely justified fixture update (new technical evidence), not a silenced failure. The three plain-camera lines still correctly require engineer review, because those specific BOQ lines' own text never states "anti fog"/"defog" either way — a real, remaining text-level ambiguity, distinct from (and no longer caused by) an ungoverned attribute.

**Second project anchor — investigated this cycle, none found.** Searched exhaustively for a second graded validation anchor (Hanwha RFQ, LOW CURRENT BOQ, "Project 4") — none exist in local evidence. The only other live project with real CCTV BOQ text ("CCTV & Access Control Validation", `project_66d9c212-45ee-45ec-82c6-6e5a71146acd`) was used for an informal, ungraded classification check only: its real dome/PTZ lines correctly classify via `buildCctvTaxonomyContext`, but it has no historical part number to grade a match against, so it cannot become a second graded Golden anchor. Documented honestly as a single-anchor limitation rather than fabricating a second one — unlike Fire Alarm's two anchors (Central Kitchen + Opera), which reflects Fire Alarm's greater maturity, not a CCTV v1 defect.

## 6. Raw regression

`scripts/regression-cctv-central-kitchen.mjs` — informational only. Catalog coverage 6/6 (100%); Top-1 given coverage **5/6 (83.3%, up from 4/6)** — the Defog closure removed two of the three prior ties; the remaining plain-camera lines correctly still tie (their own BOQ text never states the discriminator either way); Top-3 6/6 (100%); price-evidence linkage among correct matches 6/6 (100%). Uses the **same** 7-line dataset as the Golden gate (see release doc for why this is an honest v1 limitation, not a second independent check).

## 7. Compatibility / Accessories (audited and modeled this cycle)

4 real relationships seeded from Central Kitchen's own validated "Relationships" sheet:

| Class | Relationship | Evidence |
|---|---|---|
| GLOBAL_PRODUCT_RELATIONSHIP | Dome/Bullet Camera → Junction Box (1:1) | 132:132, 47:47, 14:14 — every real camera in the quotation had exactly one junction box. |
| PROJECT-SPECIFIC_REQUIREMENT | Anti-fog Bullet Camera → Pole Mount | Only 5 of 20 real anti-fog bullet cameras needed a pole mount — `quantity_parameter` deliberately left NULL so the BOM layer reports this as genuinely unresolved, never a fabricated 1:1 ratio. |

Live-verified via `app/domain/bom-component-model.mjs`'s real `classifyBomComponents`: both relationships surface correctly, neither with a fabricated quantity (see release doc's BOQ→BOM proof).

**Not modeled** (no real evidence found): NVR → compatible HDD, recorder/server → compatible storage, switch → compatible SFP (v1 has no switch products at all). PTZ → mounting bracket (no real PTZ product exists in the seeded catalog yet).

## 8. Capacity / Storage

`app/domain/cctv-storage-calculator.mjs` — a pure, deterministic storage sizing function (camera count × bitrate × hours/day × 3600 × retention days ÷ RAID overhead, ceiling-divided by HDD capacity). Fails closed (returns `INSUFFICIENT_EVIDENCE` + exact missing inputs) if any required input is absent — never guesses a bitrate, retention period, or activity factor. **Validated against real evidence**: reproduces Central Kitchen's own historical "213 cameras, 90 days, 18 hrs/day → 149TB → 15×10TB HDD" result exactly (5 passing tests, `tests/cctv-storage-calculator.test.mjs`).

**Not built this cycle**: a PoE power-budget calculator (section 23) — no real project evidence for camera PoE wattage/switch PoE budget was found during this audit (v1 has no PoE switch products seeded at all); deferred, not fabricated.

## 9. BOQ → Matching → BOM proof

Live-verified two ways:
1. Direct domain-function proof (`app/domain/bom-component-model.mjs`'s `classifyBomComponents`) against the real seeded catalog + real accessory relationships — see §7.
2. Live API proof: a real "Fixed dome camera" BOQ line in the "CCTV & Access Control Validation" project currently returns `primaryProduct: null` because that project's product-matching was last run before this cycle's catalog existed. Re-matching through the full live pipeline requires an approved BOQ Understanding step (an AI-provider call not available in this offline session).

**Investigated this cycle to its exact root cause** (rather than assumed): checked `worker/boq-understanding-provider.mjs` for a test/mock/local provider path — none exists in production code. Checked `worker/estimator-understanding-review-api.mjs`'s `EDIT_AND_APPROVE` action — it is a legitimate human-override path, but requires a pre-existing `estimator_item_interpretations` row tied to an `estimator_understanding_runs` row. Inspected that table's schema directly: `provider TEXT NOT NULL, model TEXT NOT NULL`, and `SELECT DISTINCT run_mode` returns only `CONTROLLED_PILOT`, `CONTROLLED_RETRY`, `PER_ITEM_RETRY` — confirming there is no manual/human-only run-mode path in the schema. This is a genuine, structural, platform-wide limitation (would apply identically to Fire Alarm or any future system in this offline session), not a CCTV-specific gap — documented as such, not worked around or fabricated.

## 10. Price evidence

14/14 seeded CCTV products have a `price_records` row, every one `validity_state='Historical'`, `approval_status='Needs Review'`, `downstream_use='Discovery Only'` — never promoted to "Current". No live BOM→cost API proof was run for a CCTV line this cycle (blocked by the same live-rematch gap as §9).

## 11. Knowledge UI

**Built this cycle.** `worker/cctv-knowledge-api.mjs` (`GET /api/knowledge/cctv/overview`, read-only aggregation mirroring Fire Alarm's exact shape) + `app/components/workspaces/CctvKnowledgeWorkspace.tsx` (Overview/Families/Products/Gaps primary tabs, Attributes/Evidence/Pricing/Governance under an Advanced/Governance disclosure — identical CSS classes and IA to Fire Alarm's build). Wired into `app/lib/application-navigation.mjs` (Knowledge children array, legacy workspace map, `resolveGlobalDestination`, and `globalNavigationSelection` — the last one replicating the exact sidebar-nesting fix already found necessary for Fire Alarm Knowledge, so CCTV Knowledge nests correctly under "Knowledge" rather than becoming an orphaned top-level parent) and `app/page.tsx` (6 points: `ModuleName` union, `isGlobalWorkspace`, `navigate`'s global-location branch, the render ternary, the import, and the sidebar heading condition). Verified live in the browser (`localhost:5173`) across all 8 tabs: Overview shows the "Validated · Ready for use (narrow scope)" badge and at-a-glance counts; Families correctly shows PTZ Camera as "Not yet available"; Products shows the two Defog-attribute products as "Available" technical detail vs "Limited" for the rest; Gaps shows the 4 known limitations with no project-specific text; Governance correctly surfaces the Central Kitchen project name, Golden pass state, and the 4 real accessory relationships; Pricing correctly shows 0 Current / 14 Historical. No console errors observed.

## 12. Test suite impact

**Prior cycle** (unchanged): 8 pre-existing tests across 4 files needed intentional, reviewed fixture updates because CCTV registration made their "unregistered system" example rows genuinely governed: `tests/system-knowledge-registry.test.mjs` (4), `tests/boq-understanding.test.mjs` (1), `tests/boq-understanding-pilot.test.mjs` (2), `tests/engineering-knowledge-api.test.mjs` (1, shared fixture across 2 tests), `tests/estimator-understanding-review.test.mjs` (1, plus 1 new test added), `tests/product-matching-attribute-bridge.test.mjs` (1).

**This cycle**: 2 additional pre-existing tests needed the same kind of intentional, reviewed update because adding CCTV Knowledge as a genuine seventh Knowledge sibling made their literal "six children" / fixed-array assertions stale — not a defect, the same pattern as above: `tests/release-1-app-shell.test.mjs` ("all six Knowledge children..." → "all seven...", array updated to include `"CCTV"` and `"Fire Alarm"` in the `resolveGlobalDestination` branch check), `tests/release-0-1-product-truth-ui.test.mjs` (the `isGlobalWorkspace` array-literal regex updated to include `"CCTV Knowledge"`). Both re-verified passing after the fix.

Full test suite (`node --test tests/*.test.mjs`): 1266 tests, 24 failing — all 24 are pre-existing and unrelated to CCTV (ordered-migration foreign keys, IR-040 synthetic apply engine, organization scope, ProjectShell status-color styling, ProjectContextWorkspace, MatchingWorkspace, `FIRE_ALARM_TAXONOMY` length in `product-price-library.mjs` — a different Fire Alarm taxonomy than `fire-alarm-taxonomy.mjs`, untouched this session). None reference CCTV, Knowledge navigation, or Cctv by name. Fire Alarm's own Golden gate remains unregressed throughout.
