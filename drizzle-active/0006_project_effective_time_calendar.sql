-- DOC-R3 -- the project's DECLARED effective-time calendar.
--
-- Why this migration exists
-- -------------------------
-- Effective time is PROJECT-SCOPED. A bare `YYYY-MM-DD` effective bound is a
-- date in the project's own calendar, and evaluating it as midnight UTC silently
-- shifts every declared date by the project's offset. For the current Al Mousa /
-- Saudi project context that is +03:00, so an addendum declared to take effect on
-- 1 February would have been treated as in force from 21:00 UTC on 31 January --
-- the evening before, on a tender whose addenda are dated by the calendar day.
--
-- The calendar therefore has to be a recorded, per-project fact. It cannot live
-- in code, because then it would be global; it cannot be inferred from the
-- organization, because sibling projects may sit in different jurisdictions; and
-- it must never be inferred from the host, because the same document would then
-- govern differently in a Riyadh deployment and a UTC CI runner.
--
-- Two columns, because they are two different things:
--
--   * `declared_timezone`           -- the IANA identity. This is the semantic
--                                      truth and the only thing a future DST
--                                      rule, a zone rebase or a UI has to know.
--   * `declared_utc_offset_minutes` -- the fixed offset SQLite can actually
--                                      apply, because SQLite has no IANA zone
--                                      support. This is an EVALUATION detail
--                                      and is deliberately not authoritative:
--                                      `resolveProjectCalendar` re-derives it
--                                      from the identity and reports a project
--                                      whose two disagree, rather than
--                                      preferring whichever is convenient.
--
-- Both columns are nullable and carry NO DEFAULT. A default would be precisely
-- the silent global fallback the policy forbids, and it would also be
-- indistinguishable from a value a human actually chose. A project without a
-- declaration has no evaluable calendar and the resolver fails closed with
-- PROJECT_CALENDAR_UNDECLARED, which is a state an operator can see and fix.
--
-- The backfill below is evidence-scoped, and deliberately so. An earlier revision
-- of this migration stamped `Asia/Riyadh` on EVERY project row without a
-- declaration; DOC-R3 CHECK A proved that fabricated timezone meaning for
-- projects with no jurisdiction evidence (scratch names like "dfg"/"Test", test
-- journeys, validation fixtures). A comment claiming "this is not a default"
-- cannot make a universal stamp selective, so the stamp is gone.
--
-- What remains is the only backfill the evidence supports: a project whose
-- CURRENT (non-superseded), CONFIRMED NPQ profile declares country
-- 'Saudi Arabia' has proven Saudi jurisdiction, and Saudi Arabia is wholly
-- inside the `Asia/Riyadh` zone. City detail (Riyadh, Jubail, ...) corroborates
-- where present but is not required. Everything else stays NULL (undeclared):
-- name tokens, contractor names, currency alone, UI defaults, organization or
-- host location are not jurisdiction proof, and an undeclared project fails
-- closed with PROJECT_CALENDAR_UNDECLARED rather than inheriting a neighbor's
-- zone. Rows that already declare a value are left alone.
--
-- Databases on which the blanket revision already ran are repaired forward by
-- 0007, which NULLs exactly the fabricated rows. This file is the corrected
-- authority for fresh databases.
--
-- Apply safety: additive only. `projects` is a parent table referenced throughout
-- the baseline, so it is added to as columns and never rebuilt; a rebuild would
-- require a drop, which cannot happen inside a transaction with foreign keys on.
ALTER TABLE `projects` ADD COLUMN `declared_timezone` text;
--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `declared_utc_offset_minutes` integer;
--> statement-breakpoint
-- 1. A declared zone must be a plausible IANA identifier and its recorded offset
--    must be a real UTC offset, so an obviously wrong pair is rejected at the
--    database rather than surfacing later as a silently mis-evaluated date.
--    The `IS NOT NULL` conjuncts are load-bearing: a CHECK that evaluates to
--    NULL passes, so `CHECK(declared_timezone <> '')` alone would accept a row
--    where the zone is absent and the offset is set.
CREATE TRIGGER `projects_declared_calendar_guard` BEFORE INSERT ON `projects` FOR EACH ROW
WHEN NEW.`declared_timezone` IS NOT NULL OR NEW.`declared_utc_offset_minutes` IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NEW.`declared_timezone` IS NULL THEN RAISE(ABORT, 'PROJECT_CALENDAR_ZONE_REQUIRED')
    WHEN length(trim(NEW.`declared_timezone`)) = 0 THEN RAISE(ABORT, 'PROJECT_CALENDAR_ZONE_REQUIRED')
    WHEN NEW.`declared_timezone` NOT GLOB '*/*' THEN RAISE(ABORT, 'PROJECT_CALENDAR_ZONE_NOT_IANA')
    WHEN NEW.`declared_utc_offset_minutes` IS NULL THEN RAISE(ABORT, 'PROJECT_CALENDAR_OFFSET_REQUIRED')
    WHEN abs(NEW.`declared_utc_offset_minutes`) > 840 THEN RAISE(ABORT, 'PROJECT_CALENDAR_OFFSET_OUT_OF_RANGE')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER `projects_declared_calendar_guard_update` BEFORE UPDATE ON `projects` FOR EACH ROW
WHEN NEW.`declared_timezone` IS NOT NULL OR NEW.`declared_utc_offset_minutes` IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NEW.`declared_timezone` IS NULL THEN RAISE(ABORT, 'PROJECT_CALENDAR_ZONE_REQUIRED')
    WHEN length(trim(NEW.`declared_timezone`)) = 0 THEN RAISE(ABORT, 'PROJECT_CALENDAR_ZONE_REQUIRED')
    WHEN NEW.`declared_timezone` NOT GLOB '*/*' THEN RAISE(ABORT, 'PROJECT_CALENDAR_ZONE_NOT_IANA')
    WHEN NEW.`declared_utc_offset_minutes` IS NULL THEN RAISE(ABORT, 'PROJECT_CALENDAR_OFFSET_REQUIRED')
    WHEN abs(NEW.`declared_utc_offset_minutes`) > 840 THEN RAISE(ABORT, 'PROJECT_CALENDAR_OFFSET_OUT_OF_RANGE')
  END;
END;
--> statement-breakpoint
-- 2. The declared backfill. Asia/Riyadh observes no DST, so +03:00 is the zone's
--    offset at every instant; a project in a DST zone would need its recorded
--    offset re-derived per evaluation instant, which is what
--    `resolveProjectCalendar` does and why it does not trust this column.
UPDATE `projects` SET `declared_timezone` = 'Asia/Riyadh', `declared_utc_offset_minutes` = 180 WHERE `declared_timezone` IS NULL AND EXISTS (
  SELECT 1 FROM `project_npq_profile_versions` `npq`
   WHERE `npq`.`project_id` = `projects`.`id`
     AND `npq`.`superseded_at` IS NULL
     AND `npq`.`status` = 'Confirmed'
     AND `npq`.`country` = 'Saudi Arabia'
);
