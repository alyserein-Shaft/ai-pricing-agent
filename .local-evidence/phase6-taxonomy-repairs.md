# Phase 6 — Taxonomy repairs (Golden R11) — EVIDENCE RECORD

Date: 2026-09-27
Scope: repair the two Golden Al Mousa classifier/alias defects through the
canonical governed taxonomy (app/domain/fire-alarm-taxonomy.mjs). No Golden
special cases; both fixes are reusable canonical changes.

## 1. Defect A — "Loop powered strobes with sounder (weatherproof)" contradiction

Two classifiers disagreed on the SAME governed phrase:

| classifier | before | after |
|---|---|---|
| `classifyFireAlarmFamilyFromText` (taxonomy context) | `Strobe` | `Sounder/Strobe` |
| `analyzeRequirementFamilyPhrase` (R5 requirement analyzer) | `Sounder/Strobe` | `Sounder/Strobe` (unchanged) |

Root cause: `familyPhrases["Sounder/Strobe"]` owned only the
"sounder (with) strobe/flasher/beacon" conjunction direction — never the
inverted "strobe with sounder" form — so the taxonomy context fell through to
the bare "strobe" family phrase. The requirement vocabulary already had the
conjunction (`strobes? with sounders?`, r5-family-resolver.test.mjs:115).

Fix: added the four inverted conjunction phrases to the governed
`familyPhrases["Sounder/Strobe"]` alias list: "strobe with sounder",
"strobe with sounders", "strobes with sounder", "strobes with sounders".

Safety proof: bare Strobe (`Flasher`, `Red Wall Strobe`, `STROBE WHITE WALL`,
`Loop powered strobes`) and bare `Sounder` are unchanged; the Sprint 1.0 "with
…" exclusion targets only the `Sounder`/`Strobe` single families, never
`Sounder/Strobe`; all 4 pre-existing siren/flasher "Sounder/Strobe" pins and
the bare-not-widened pins in fire-alarm-taxonomy-integration remain green.

Downstream importance: `understanding-system-auto-approval.mjs:105` ratifies
classifications through `classifyFireAlarmFamilyFromText` — before this fix the
policy could ratify "Strobe" for a strobe-with-sounder device.

## 2. Defect B — "Fireman telephone jack" resolves to NO family

| classifier | before | after |
|---|---|---|
| `classifyFireAlarmFamilyFromText` | `null` | `Firefighter Telephone` |
| `analyzeRequirementFamilyPhrase` | `RELATED_NOT_EQUIVALENT` | `Firefighter Telephone` |
| `looseFireAlarmEquipmentMatch` | `null` | `Firefighter Telephone` |

The modern form "fire fighter telephone jack" already resolved; "fireman" was
missing from the governed Firefox Telephone alias list and the requirement
vocabulary. "Fireman telephone jack" is the established synonym for a
firefighter telephone jack (4 Golden rows; product FFT-FPJ exists).

Fixes (all canonical, additive):
1. `familyPhrases["Firefighter Telephone"]` gained the fireman/firemen forms:
   telephone jack, telephone handset, telephone, phone, handset.
2. Requirement vocabulary `firefighter-telephone` explicit branch extended from
   `fire ?fighters?(?: s)?` to `fire ?(?:fighters?(?: s)?|mans?|men)`.
3. `FIRE_SERVICE_CONTEXT` now also recognizes `fireman|firemen` — so
   context-requiring phrases like "remote handsets for the fireman's lift"
   resolve (real phrasing: "fireman's lift lobbies").

## 3. Verification

- Probe: both defect strings now resolve identically on all three surfacers;
  "Fire fighter telephone jack" unchanged.
- New regression tests: 2 tests added to
  `tests/fire-alarm-taxonomy-integration.test.mjs` (agreement + alias + bare
  no-widening + context) → suite 37/37.
- No-pin-drift re-runs (all PASS, 0 fails):
  fire-alarm-taxonomy-integration 35→37, r5-family-resolver 25,
  p5-device-noun-family 11, materialize-fire-alarm-families 23,
  r6-p1-routing-precedence 18, understanding-system-auto-approval 17,
  engineering-knowledge-api 10, engineering-knowledge-graph-engine 4,
  product-price-library-api 11, product-price-library-costing-currency 7,
  system-knowledge-registry 24, requirement-intelligence-engine 10,
  requirement-profile-authority 6, boq-understanding-pilot 56,
  boq-understanding-closure-pass 16, boq-understanding-governed-aware-quality
  20, ai-understanding-eligibility 10.
- **`scripts/fire-alarm-golden-evaluation-gate.mjs`: GATE PASSED** (26/26
  coverage, 0 true matching errors, 0 false resolves, 12/12 engineer-review).
- ESLint clean on both changed files.

## 4. Files changed

- `app/domain/fire-alarm-taxonomy.mjs` (4 edits: Sounder/Strobe phrases,
  Firefighter Telephone aliases, FIRE_SERVICE_CONTEXT, vocabulary branch)
- `tests/fire-alarm-taxonomy-integration.test.mjs` (+2 regression tests)
- `.local-evidence/scratch/probe-taxonomy.mjs`, `probe-r11.mjs` (scratch probes)