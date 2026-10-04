# DOC-R3 CHECK A — Timezone backfill audit: `0006_project_effective_time_calendar.sql`

**Verdict: REPAIR REQUIRED. The migration fabricated timezone meaning for 16 of 23 projects.**

## What the migration did

`drizzle-active/0006_project_effective_time_calendar.sql:87` (pre-repair):

```sql
UPDATE `projects` SET `declared_timezone` = 'Asia/Riyadh', `declared_utc_offset_minutes` = 180 WHERE `declared_timezone` IS NULL;
```

Its comment claimed "The backfill below is NOT a default." That claim is false in
effect: applied to any database, it stamps `Asia/Riyadh` on every project row
that does not already declare — including rows for which no jurisdiction evidence
exists anywhere. A comment cannot make a universal stamp selective. This is
precisely the universal legacy default the program forbids.

## Evidence standard applied

A project is VERIFIED_RIYADH only on **structured, confirmed, in-database
jurisdiction evidence**: a current (non-superseded) NPQ profile with
`status='Confirmed'` and `country='Saudi Arabia'`. Saudi Arabia is wholly inside
the `Asia/Riyadh` zone, so country-level proof suffices for the zone (city-level
detail, where present, corroborates).

Deliberately NOT accepted as proof: project-name tokens ("Makkah", "Test"),
contractor names, currency alone, UI defaults, organization location, host
machine, developer location. A name is not a declaration.

## Classification (Golden copy, 23 projects; sole country value in DB is 'Saudi Arabia', 7 rows, all Confirmed)

### VERIFIED_RIYADH → keep `Asia/Riyadh` / 180 (7)

| Project | Evidence |
|---|---|
| Al Mousa School | Confirmed NPQ, country Saudi Arabia, city/location JUBAIL, SAR |
| Al Mousa School — Clean Golden Run | Confirmed NPQ, country Saudi Arabia, SAR |
| JAK | Confirmed NPQ, country Saudi Arabia, SAR (name is scratch-like; NPQ evidence governs over name) |
| NPQ Local Verification 20260816-185608 | Confirmed NPQ, country Saudi Arabia, city Riyadh, SAR |
| Opera Block Townhouses - FAS Walkthrough | Confirmed NPQ, country Saudi Arabia, SAR |
| TesT | Confirmed NPQ, country Saudi Arabia, SAR (ditto: evidence over name) |
| Test (8f85…) | Confirmed NPQ, country Saudi Arabia, SAR (ditto) |

### UNKNOWN → NULL / NULL (16)

Btam · CCTV & Access Control Validation — August 2026 · Central Kitchen - Makkah ·
Fire Alarm · Fire Alarm Product Validation — August 2026 · Golden Full Journey ×2 ·
La Porta Al Akaria — Hotel BOQ Validation · Phase 6 Real Tender Validation ·
Serein · Technical Intake Test · Test (1bfc…, no NPQ row) · dfg ×2 · hh ·
NUPCO - Pharmaceutical Logistics Center.

No NPQ row exists for any of them. Effective-time evaluation for these projects
fails closed with `PROJECT_CALENDAR_UNDECLARED` where a timezone is required —
that is the policy working, not an outage: nothing in production resolves a
project calendar today (no production callers of `loadProjectCalendar` /
`assertEffectiveTimeCalendarConformance`), and Golden holds zero effective bounds
and zero supersessions, so the calendar is fully latent there.

### VERIFIED_OTHER_ZONE → actual zone (0)

None. The sole non-Saudi token in the repo ("Stanly Egypt") is a deliberately
untouched external file reference, not a project. No branch needed; the repair
preserves any non-Riyadh declaration it finds (it only touches the
blanket-stamp signature).

## Noted but not proven: Central Kitchen - Makkah

Name-embedded Makkah plus MCC/SAR/location-fixture corroboration is real
circumstantial evidence, but it is not a confirmed jurisdiction record, so the
project stays NULL under the strict standard. Its Makkah evidence is the fast
path for its future declaration via project configuration when a path actually
needs its calendar. NULLing it changes no current behavior (see above).

## Repair (applied)

1. `0006`: blanket UPDATE replaced with evidence-scoped UPDATE (Confirmed NPQ,
   `country='Saudi Arabia'`, current row only). Fresh databases never fabricate.
2. `0007_project_calendar_evidence_repair.sql` (new): on databases where blanket
   0006 already ran, NULLs exactly the fabricated rows — signature
   `Asia/Riyadh`+180 **without** Tier-1 evidence. Human declarations with
   evidence are kept; deliberate non-Riyadh declarations are untouched (different
   signature); deliberate Riyadh declarations backed by evidence are kept
   (evidence EXISTS). A deliberate Riyadh declaration *without* evidence is
   nulled, which is correct: without evidence it is indistinguishable from the
   fabrication.
3. Journal + `0007_snapshot.json` (schema-identical to 0006, chained ids) +
   manifest cutoff → 0007. Counts unchanged (no objects added).
4. `scripts/golden-r3-behavioral-validation.mjs` check 3 corrected to the
   evidence expectation (7 declared / 16 NULL / fail-closed demo); its prior
   "23/23 declare" PASS was built on the fabrication and is retracted.
