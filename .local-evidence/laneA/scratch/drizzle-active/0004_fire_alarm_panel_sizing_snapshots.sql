CREATE TABLE `fire_alarm_panel_sizing_snapshots` (
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
CREATE UNIQUE INDEX `fire_alarm_panel_sizing_project_version_idx` ON `fire_alarm_panel_sizing_snapshots` (`project_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `fire_alarm_panel_sizing_project_current_idx` ON `fire_alarm_panel_sizing_snapshots` (`project_id`,`version_number`);--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS fire_alarm_panel_sizing_snapshots_immutable_update
BEFORE UPDATE ON `fire_alarm_panel_sizing_snapshots`
BEGIN
  SELECT RAISE(ABORT, 'FIRE_ALARM_PANEL_SIZING_SNAPSHOTS_IMMUTABLE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS fire_alarm_panel_sizing_snapshots_immutable_delete
BEFORE DELETE ON `fire_alarm_panel_sizing_snapshots`
BEGIN
  SELECT RAISE(ABORT, 'FIRE_ALARM_PANEL_SIZING_SNAPSHOTS_IMMUTABLE');
END;