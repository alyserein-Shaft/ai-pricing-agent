## DEC-20261004-ELECTRICAL-CORE-CALCULATORS

Added two governed electrical calculators as a NEW domain module
`app/domain/electrical-core-calculators.mjs`, reusing the existing platform
contract (`calculation-requirement-engine.mjs`: input-source types, authority /
currentness / result states, `buildDerivedCalculationEvidence`,
`isCalculationStale`) rather than introducing a second provenance or staleness
system. The one genuinely new primitive is the CAPABILITY EVIDENCE RECORD, which
binds a number to manufacturer + model + document + revision so cross-family
leakage is structurally impossible.

**Live Al Mousa authority is FARENHYT / IFP-2100, NOT NOTIFIER / N16.**
`engineering_knowledge_decisions.ecosystemDecision_1e636450` (action
`supersede-fire-alarm-ecosystem`, 2026-10-01T20:57:43.805Z, decided_by
`authoritative-engineer-decision`) set `ecosystem = FARENHYT`,
`preliminaryPanelFamily = FARENHYT_IFP_2100`, and listed NOTIFIER among
`notDirectMatchEcosystems`. The earlier NOTIFIER decision
(`ecosystemDecision_acfdc49f`, 2026-09-30T09:38:06Z) is SUPERSEDED. Any prior
report or brief that treats NOTIFIER INSPIRE N16 as the Al Mousa design basis is
working from superseded state.

Independently, N16 battery sizing was already self-recorded as blocked:
`app/domain/notifier-product-corpus.mjs` carries `NOTIFIER-C7`
(BLOCKING_FOR_BATTERY_SIZING; DN-62112 Rev M says 7-210 AH / 2.0 A aux while
DN-62116 Rev B still says 7-100 AH / 1.5 A aux, resolution UNRESOLVED) and
`GAP-05` (no model-level battery amp-hour evidence). The new calculators therefore
fail closed on N16 by design, on both grounds.

**P0 DEFECT FOUND, NOT PATCHED IN THIS SLICE.**
`calculation-requirement-engine.mjs` `battery.standby-alarm` computes
`requiredAh = MAX(standbyAh, alarmAh) * deratingFactor`. The manufacturer's own
worksheet (LS10143-001SK-E Rev E, Sec 3.5.2, Table 3.2 (Continued)) line J reads
"Add lines G and I", i.e. the SUM, which
`scripts/lib/al-mousa-nac-power-sizing.mjs` `batteryAhForEnclosure` and
`tests/al-mousa-battery-audit.test.mjs` already implement and assert. Measured on
a governed example: platform rule 15 Ah vs worksheet 15.156 Ah. The platform rule
UNDERSTATES the battery. It is left unchanged because it is shared governed
behaviour asserted by `tests/calculation-requirement-engine.test.mjs` and
`tests/stage4d1-live-calculation-wiring.test.mjs`; correcting it is a separate
governed slice. Until then TWO battery formulas exist in this repository and the
SUM in `electrical-core-calculators.mjs` is the evidence-backed one.

Also noted: the derating factor is family-specific. IFP-2100 states 1.25;
Honeywell's FCPS-24 worksheet states 1.2. Neither may substitute for the other.

Status: VERIFIED, 33/33 focused tests, lint 0 errors. No DB writes, no migration,
no runtime restart, no commit/push/deploy.

## DEC-20261004-BATTERY-FORMULA-AUTHORITY-REPAIR (supersedes the P0 above)

`app/domain/calculation-requirement-engine.mjs` `battery.standby-alarm` repaired:
`MAX(standbyAh, alarmAh) * deratingFactor` -> `totalAhBeforeDerating * deratingFactor`
where `totalAhBeforeDerating = standbyAh + alarmAh`. `ruleVersion` 1.0.0 -> **1.1.0**
so a stored 1.0.0 figure is detectably not comparable. Added output field
`totalAhBeforeDerating`; retained `requiredAh` / `standbyAh` / `alarmAh` /
`governingDuration` (the last is now purely informational -- it names the larger of
two cumulative demands and no longer selects the result). `describeCalculation` no
longer narrates a single "governing" demand. Fail-closed semantics, evidence
requirements, fingerprints and currentness untouched. Parity with
`BatterySizingCalculator` verified on three independent input sets; they agree
exactly at the canonical 2dp publication contract (the calculator carries 3dp
internally, a pure rounding difference of <=0.003 Ah, not a numerical disagreement).

Unrelated pre-existing failures found while verifying, NOT caused by this repair:
`tests/calculation-requirement-engine.test.mjs` (2) and
`tests/stage4d1-live-calculation-wiring.test.mjs` (8) call `runProductMatching` and
then read `candidate.evidenceEnvelope`, but **zero** assignments of
`evidenceEnvelope:` exist anywhere in `app/domain`, so the key is never populated.
Foreign-lane product-matching contract gap; no battery assertion is involved.

Status: VERIFIED. Battery tests 3/3 pass incl. two new regressions; electrical
calculator suite 33/33; lint 0 errors (2 pre-existing warnings). No DB writes, no
migration, no build, no runtime restart, no commit/push/deploy.

## DEC-20261004-FARENHYT-NAC-AND-VOLTAGE-DROP

**HV APPLICABILITY WAS PROVEN, NOT ASSUMED.** The IFP-2100/IFP-2100ECS
installation manual P/N LS10143-001SK-E Rev E (8/29/2022, 178 pp) carries an explicit
scope note in its Introduction: "All references to the IFP-2100 within this manual are
applicable to the IFP-2100, IFP-2100B, IFP-2100ECS, IFP-2100ECSB, IFP-2100HV,
IFP-2100HVB, IFP-2100ECSHV, IFP-2100ECSHVB, RFP-2100, and RFP-2100B unless otherwise
indicated." So every figure below is EXACT-MODEL CURRENT for Al Mousa's IFP-2100HV.
METHOD NOTE: a `\\bHV\\b` search returns ZERO hits because HV is glued to the model
number; the correct probes are `IFP-2100HV` (7 hits) and `2100HV` (10 hits). A
false-negative on this pattern would have wrongly failed the evidence closed.

CLOSED (MANUFACTURER_EVIDENCE, prod-edam.honeywell.com):
- per-circuit NAC rating 3 A -- "All Circuits are Regulated. Rated at 24VDC @ 3A max
  per circuit, 9A max total."; terminal table "Flexput Circuits 24 VDC 3.0 A"
- panel total 9 A -- Doc 351602 Rev C
- max voltage drop 3 V for BOTH Class B ("Maximum voltage drop is 3V per Class B
  notification. See Table 4.6.") and Class A ("...3V per Class A circuit. See Table 4.7.")
- max impedance envelope (Tables 4.6/4.7): 1.0A->3R, 1.5A->2R, 2.0A->1.5R, 2.5A->1.2R,
  3.0A->1.0R; plus Class A "Maximum Impedance per circuit is 50 ohm."
- AC input 2.8 A at 240 VAC for IFP-2100HV/ECSHV (confirms the HV identity)

IMPLEMENTED in `app/domain/electrical-governed-core.mjs`: `calculateNacCircuitCapacity`
(governing = MAX(standby, alarm), per-circuit ceiling ONLY, deficit returned, NO
derived hardware) and `calculateVoltageDrop` (R_loop = 2 x oneWayLength x conductor
resistance; arithmetic always computed when inputs exist, but the VERDICT requires a
proven model-bound threshold and is UNKNOWN without one). The 2018 Silent Knight
BatteryCalc figures (20.4 V start / 16 V EOL / 10 % warning) are deliberately NOT used;
this panel's NACs are documented REGULATED 24 VDC so a nominal-start model would not
describe them. Conductor resistance is caller-supplied WITH evidence and never defaulted
from a built-in table, so an unknown conductor fails closed.

CANONICAL: `power.nac-load` was EXTENDED to delegate to NacCircuitCalculator
(ruleVersion 1.0.0 -> 1.1.0), not duplicated. 1.0.0 tested the ALARM condition only;
the governed requirement is the GOVERNING condition. Legacy output names
`totalAlarmCurrent` / `nacAmpacity` are retained so nothing downstream breaks.

TWO REAL DEFECTS FOUND AND FIXED IN THIS SLICE'S OWN CODE:
1. `nacLoadDefect` validated numeric ranges but never checked for a current-evidence
   reference, so a bare `{standbyAmps, alarmAmps}` object was accepted -- the exact
   fail-open `power.capacity` already guarded against. Now identical to power.capacity.
2. The canonical fingerprint hashed `source.documentId` but NOT `source.revision`, so
   a re-issued manual did not invalidate currentness at an unchanged value. Both are
   now captured.

AL MOUSA DATA READINESS (read-only): 16 PRIMARY `NAC_CIRCUIT_EXISTS` rows exist but ALL
carry subject="NAC LOOP", relation=NULL, object=NULL -- they prove a circuit exists with
NO circuit identity, NO device count and NO panel binding. PANEL_LABEL has only 2
subjects (FACP, MFACP). A search for length/route/conductor/AWG/gauge across
fact_type, subject, object and scope returns 0 rows everywhere. Therefore real Al Mousa
NAC sizing must remain BLOCKED_BY_MISSING_INPUTS on circuit allocation, and voltage drop
must remain blocked on route length AND conductor.

Status: VERIFIED, 26/26 new focused tests, existing suites at baseline, lint clean. No
DB writes, no migration, no build, no runtime restart, no commit/push/deploy.
