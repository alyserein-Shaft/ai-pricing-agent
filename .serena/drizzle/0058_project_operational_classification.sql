ALTER TABLE `projects`
ADD COLUMN `operational_classification` text NOT NULL DEFAULT 'Operational'
CHECK (`operational_classification` IN ('Operational','Internal Validation','Fixture'));
--> statement-breakpoint
CREATE INDEX `projects_operational_scope_idx`
ON `projects` (`organization_id`,`operational_classification`,`archived_at`,`updated_at`);
