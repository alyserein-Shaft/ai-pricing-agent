ALTER TABLE `projects` ADD `system_domain` text NOT NULL DEFAULT 'Unspecified';
--> statement-breakpoint
ALTER TABLE `projects` ADD `initial_status` text NOT NULL DEFAULT 'Draft';
--> statement-breakpoint
UPDATE `projects`
SET `system_domain` = 'Fire Alarm', `initial_status` = 'Draft', `updated_at` = CURRENT_TIMESTAMP
WHERE `id` = 'project_0a49e924-1c3d-4cfb-b48a-02a66c00200c';
