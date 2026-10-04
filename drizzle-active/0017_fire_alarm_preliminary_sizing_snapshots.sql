-- GOLDEN-6C2: governed PRELIMINARY Fire Alarm sizing snapshot (migration 0017).
--
-- WHY A SEPARATE TABLE, AND WHY IT IS NOT fire_alarm_panel_sizing_snapshots.
--
-- fire_alarm_panel_sizing_snapshots (0004) is FINAL, PRODUCT-SPECIFIC sizing.
-- Its writer (createFireAlarmPanelSizingSnapshot) refuses a command that lacks
-- a selected product identity, an APPROVED primary panel selection, exact
-- per-product capacity and explicit per-panel BOQ allocations. That dependency
-- is DOWNSTREAM of ecosystem selection, which is why it cannot carry the
-- preliminary point count GOLDEN-5 needs: the cycle is
--
--   GOLDEN-5 needs preliminaryTotalPoints
--     -> the only sizing table needs an approved exact panel product
--       -> an approved product needs a resolved ecosystem
--         -> GOLDEN-5 has not resolved one.
--
-- Reusing or widening 0004 would require inventing a product id or a capacity,
-- or would weaken a final-sizing invariant whose consumers read
-- `sizing.projectTotal` as an EXPANSION QUANTITY.
--
-- WHAT THIS TABLE IS.
--
-- Governed SYSTEM DEMAND: how much Fire Alarm point demand the project
-- currently requires, known and unknown demand kept apart, the threshold state
-- preserved, and no product, ecosystem, panel, loop, capacity, battery or PSU
-- input of any kind. It is vendor-neutral by construction. Demand is not
-- capacity: a row may record knownPointDemand = 1500 while panel capacity
-- remains unknown; that is a valid, complete statement.
--
-- The schema is the 12-column mirror of 0004 minus product identity
-- (delivery doc GOLDEN-6C2 §19.5/§20). The persisted `calculation_json` holds
-- the project-level point-count evidence (engineVersion, projectTotalPoints,
-- preliminaryTotalPoints, thresholdStatus, completeness, confidence,
-- knownPointDemand, unknownPointDemand, scopeTotals, missingKnownScopes,
-- conflicts); `dossier_json` holds the governed evidence record of why that
-- number holds. Immutability triggers make the table append-only: a correction
-- is a NEW version, never an UPDATE.
CREATE TABLE `fire_alarm_preliminary_sizing_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`input_fingerprint` text NOT NULL,
	`engine_version` text NOT NULL,
	`status` text NOT NULL,
	`input_json` text NOT NULL,
	`calculation_json` text NOT NULL,
	`dossier_json` text NOT NULL,
	`reason` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fire_alarm_preliminary_sizing_project_version_idx` ON `fire_alarm_preliminary_sizing_snapshots` (`project_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `fire_alarm_preliminary_sizing_project_current_idx` ON `fire_alarm_preliminary_sizing_snapshots` (`project_id`,`version_number`);--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS fire_alarm_preliminary_sizing_snapshots_immutable_update
BEFORE UPDATE ON `fire_alarm_preliminary_sizing_snapshots`
BEGIN
  SELECT RAISE(ABORT, 'FIRE_ALARM_PRELIMINARY_SIZING_SNAPSHOTS_IMMUTABLE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS fire_alarm_preliminary_sizing_snapshots_immutable_delete
BEFORE DELETE ON `fire_alarm_preliminary_sizing_snapshots`
BEGIN
  SELECT RAISE(ABORT, 'FIRE_ALARM_PRELIMINARY_SIZING_SNAPSHOTS_IMMUTABLE');
END;