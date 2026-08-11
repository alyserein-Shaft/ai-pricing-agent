-- Canonical project-level pricing scenario authority.
-- Selection is a governed commercial decision; UI/navigation state is not authority.

ALTER TABLE `project_dashboard_profiles`
  ADD COLUMN `selected_pricing_scenario_id` text REFERENCES `pricing_scenarios`(`id`);

ALTER TABLE `project_dashboard_profiles`
  ADD COLUMN `selected_pricing_scenario_at` text;

ALTER TABLE `project_dashboard_profiles`
  ADD COLUMN `selected_pricing_scenario_by` text;

ALTER TABLE `project_dashboard_profiles`
  ADD COLUMN `selected_pricing_scenario_reason` text;

CREATE INDEX IF NOT EXISTS `project_dashboard_selected_pricing_scenario_idx`
  ON `project_dashboard_profiles` (`selected_pricing_scenario_id`);
