# Fire Alarm Engineer-Assisted MVP v1 -- Frozen Baseline

**Status:** Frozen and protected by the Golden Evaluation Gate.
**Frozen:** 2026-08-28, branch `phase-5-ai-quotation-engineer`.

## What "v1" means

This is the first frozen, protected snapshot of Fire Alarm candidate-discovery
and matching behavior. It closes a multi-stage fix arc that started from a
blind end-to-end evaluation against a genuinely unseen project (Central
Kitchen - Makkah) and worked through: BOQ description-column detection,
Fire Alarm vocabulary gaps, requirement extraction/applicability robustness,
family-aware derived-requirement logic, evidence/config-aware pilot fairness,
an evidence-guard database trigger correction, and a generic family-tier
ranking fix. Every fix in that arc is regression-tested; none is re-litigated
by this freeze. This document records what is now considered *correct,
protected behavior* going forward -- not a description of the fix history
(see git log on this branch for that).

## Frozen behavioral principles

These are the properties the Fire Alarm matching pipeline is now expected to
uphold permanently, independent of any single project's data:

1. **No false resolve.** The system never presents a single, confident answer
   for a BOQ line whose evidence genuinely supports more than one valid
   product. Genuine ambiguity must surface as Engineer Review, not be
   silently collapsed into a Top-1 pick.
2. **Correct-family candidates outrank different governed families when a
   confident family exists.** A candidate from the BOQ item's exact governed
   family (or a registered synonym family) always ranks above a candidate
   from a genuinely different governed family, regardless of how much
   incidental requirement evidence the wrong-family candidate happens to
   satisfy (`familyMatchTier` in `app/domain/product-matching-engine.mjs`).
3. **Mandatory technical failures still reject candidates within the correct
   family.** Family-tier priority never launders a candidate that violates a
   confirmed mandatory project requirement into "compliant" -- it can still
   outrank a wrong-family candidate (visible as a technically rejected
   alternative), but it is never marked compliant.
4. **Genuine ambiguity remains Engineer Review.** A BOQ line whose text does
   not name a discriminating fact (action type, sensing combination,
   candela/model, channel count, panel capacity, ...) is never forced to a
   single historical-sounding answer. It stays open, with the exact missing
   decision named.
5. **Historical quotation is evaluation evidence, not matching truth.** A
   real, issued historical quotation (Opera Block) proves one engineer's
   choice was valid *for that project*; it is never treated as proof that no
   other choice could ever be correct, and the matching engine is never
   tuned to reproduce one specific historical part number.
6. **Missing evidence is never fabricated.** Neither the agent nor its
   fixtures invent a historical part number, a technical fact, or a resolved
   answer where none is actually backed by evidence. An open gap is recorded
   as an open gap.

These principles cover: Fire Alarm taxonomy/governed families, Product
Knowledge readiness, requirement extraction/applicability, candidate
discovery, family-tier ranking, compatibility/accessory/BOM logic, and
engineer-review/escalation behavior.

## Golden Evaluation Set

Two permanent Golden projects, each playing a different, deliberate role:

### Opera Block Townhouses (Diriyah) -- `tests/golden/opera-block.fixture.mjs`

Graded against a **real, external, independently-issued ground truth**: the
final client quotation (Al Mespar Contracting Corp, Q1039-426-LCU, Rev00,
22-Apr-26, SAR 695,984.00). 26 material line items. This project answers "did
we reproduce what a real engineer, under real commercial pressure, actually
shipped" -- the harder, external check.

### Central Kitchen - Makkah -- `tests/golden/central-kitchen.fixture.mjs`

The project that was genuinely unseen at the start of the fix arc, never used
to train or tune any rule. 17 classifiable Fire Alarm lines (an 18th
Fire-Alarm-tagged row is a non-product line, excluded). Graded against the
agent's own evidence-aware framework (governed family, acceptable candidate
set, mandatory-requirement correctness, honest escalation) rather than a
single historical part number, because several of its lines genuinely cannot
be resolved to one PN from BOQ text alone -- see the six accepted ambiguity
categories below.

**Frozen Central Kitchen baseline:** 17/17 classifiable lines reach candidate
discovery, 17/17 acceptable candidate sets, 0 true matching errors, 0 false
resolves.

**Accepted genuine ambiguity (never forced to a single historical PN):**

| Category | Lines | Open question |
|---|---|---|
| Manual Call Point action type | 28.22 | Single vs Dual Action |
| Multi detector sensing combination | 28.30, 28.31 | Which sensing criteria; also carries an accepted family-classification gap (see backlog) |
| Flasher model/candela/environment | 28.26 | Candela, mounting, indoor/outdoor |
| Sounder/Strobe variant ambiguity | 28.27, 28.33 | Candela/sound-output model (28.33's IP-65 evidence narrows the set more than 28.27's) |
| Monitor Module channel-count ambiguity | 28.24, 28.28 | Single/dual/10-point channel count |
| Above-Ceiling Smoke Detector evidence gap | 28.25 | Whether "above ceiling" implies a distinct mounting/orientation accessory |

Two additional, freshly-observed items are reported honestly rather than
silently marked resolved (see backlog): 28.35 (FARP/Annunciator) has an open
Product Knowledge gap (no recorded `addressing` attribute for its own correct
family), and 28.36 (FACP) has a genuine 5-way panel-capacity tie the BOQ text
does not resolve.

## Evaluation metrics

Computed automatically by `scripts/fire-alarm-golden-evaluation-gate.mjs` for
both Golden projects on every run:

- **BOQ extraction coverage** -- lines whose evidence loaded successfully.
- **Family classification accuracy** -- computed governed family vs. the
  fixture's frozen expected family.
- **Candidate discovery coverage** -- lines that returned at least one
  candidate.
- **Acceptable candidate set rate** -- lines where nothing invalid outranks
  every candidate in the fixture's acceptable set.
- **True matching error count** -- lines where a wrong-family or otherwise
  invalid candidate outranks every acceptable candidate.
- **False resolve count** -- lines the fixture marks as genuine ambiguity
  (`ENGINEER_REVIEW_REQUIRED` / `NO_MATCH_OR_MISSING_EVIDENCE`) where the
  engine nonetheless presents one uniquely-scored, mandatory-clean top
  candidate as if resolved.
- **Cross-family ranking errors** -- lines where a genuinely different
  governed family (tier 2) outranks an available, acceptable same-family
  candidate.
- **Mandatory-requirement validation correctness** -- fixture-declared
  must-fail assertions (e.g. "conventional Beam Detector must fail
  addressing") that the live computed result actually confirms.
- **Correct engineer-review rate** -- genuine-ambiguity lines where the
  engine correctly leaves the ambiguity visible rather than false-resolving
  it.

**Historical exact Top-1/Top-3** is reported for both projects but is
**secondary and informational only** -- it is never a gate condition, per the
"historical quotation is evidence, not truth" principle.

## Fire Alarm release gate

**Command:**

```
npm run test:fire-alarm-golden
# or directly:
node scripts/fire-alarm-golden-evaluation-gate.mjs [--db <path-to-d1-sqlite>] [--json]
```

Exits non-zero (fails the release) if, against either Golden project:

1. A new true matching error appears.
2. Any false resolve appears.
3. A previously-correct family becomes incorrect (family classification
   regression on any golden line).
4. A correct-family candidate is displaced by an unrelated governed family
   (a cross-family ranking error).
5. A known genuine ambiguity becomes silently auto-resolved (a false resolve
   specifically on a fixture-marked ambiguity line).
6. Candidate discovery materially regresses against the frozen baseline
   (17/17 for Central Kitchen) without an explicitly approved fixture change.

**This gate is separate from `node --test tests/*.test.mjs`.** That suite
currently reports 51 pre-existing `✖` failures across unrelated,
already-known infrastructure/test-scaffolding gaps (established as a stable
baseline across this entire fix arc -- re-verified unchanged after every
change in this session). Those are tracked there, not here, and a Golden
Evaluation Gate failure must never be confused with one of them. Run both:
the golden gate for Fire Alarm matching-quality regressions, the test suite
for everything else.

The gate reads the live, machine-local Miniflare D1 snapshot (gitignored,
recreated per machine by `npm run dev`) by default. Point `--db` at a
CI-provided snapshot when running outside this environment; a missing/
unreadable snapshot fails closed (exit 1), never a silent pass.

## Known residual backlog (accepted, not blockers)

None of the following block the v1 freeze -- each is either genuine
engineering ambiguity the product correctly escalates, or an honestly-scoped
Product Knowledge/taxonomy gap explicitly out of this freeze's authorized
scope (no Product Library enrichment, no taxonomy expansion):

- **28.30/28.31 family-classification gap** -- BOQ Understanding classifies
  "Multi detector" as Addressable Smoke Detector rather than Multi-Criteria
  Detector. Real gap, frozen as current behavior (not silently hidden).
- **28.35 (FARP) Product Knowledge gap** -- RA-2000/RA-2000GRAY (Annunciator)
  have never had an `addressing` attribute recorded; the correct family still
  correctly outranks wrong-family panel candidates, but the top candidate has
  an open evidence item.
- **28.36 (FACP) panel-capacity tie** -- five Fire Alarm Control Panel SKUs
  (75-series and 2100-series, genuinely different capacities) tie when the
  BOQ text does not state loop/zone count.
- **Opera-only taxonomy coverage gap** -- several accessory/hardware line
  types (battery backboxes, SLC expander cards, phone jacks) have no governed
  Fire Alarm family entry at all under the current taxonomy; they are matched
  by part-number/semantic retrieval, not family classification. Tracked in
  `tests/golden/opera-block.fixture.mjs`.
- **Opera per-line variant misses** -- several Opera lines resolve to an
  acceptable same-family variant but not the exact historical SKU (e.g. panel
  ECS variant, sounder low-frequency variant, relay channel count). Consistent
  with the "historical PN is evidence, not truth" principle -- reported as
  informational Top-1/Top-3, not gated.

## What counts as a blocker vs. accepted ambiguity

- **Blocker:** a wrong-family or otherwise invalid candidate outranks a valid
  one (a true matching error); a false resolve; a mandatory-requirement
  check that should fail a candidate but doesn't (or vice versa); candidate
  discovery regressing without an approved fixture change.
- **Accepted:** a BOQ line whose text genuinely does not name a
  discriminating fact, correctly escalated as Engineer Review with the exact
  missing decision named; an honestly-reported Product Knowledge/taxonomy
  coverage gap that does not cause an invalid candidate to outrank a valid
  one.

## How to run the Golden Evaluation Gate

1. Start the app once so the local D1 snapshot exists and is current:
   `npm run dev` (leave running, or stop it after the snapshot is written --
   the gate itself only reads the sqlite file, no live server needed).
2. Run the gate: `npm run test:fire-alarm-golden`.
3. Review the printed per-project metrics and `GATE PASSED` / `GATE FAILED`
   line. On failure, the specific failing lines are named directly in the
   output.
4. Separately, run `node --test tests/*.test.mjs` for the full unrelated test
   suite -- compare its `✖` count/list against the last known-stable 51 to
   confirm no *new* infrastructure regressions, independent of the golden
   gate's own result.

Any intentional change to Golden project data, taxonomy, or matching logic
that legitimately changes an expected outcome must update the corresponding
fixture file (`tests/golden/*.fixture.mjs`) in the SAME commit as the code
change, with a comment explaining why -- never silently.
