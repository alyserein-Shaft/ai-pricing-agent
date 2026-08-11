CREATE INDEX `projects_organization_active_idx` ON `projects` (`organization_id`,`archived_at`,`updated_at`);
CREATE INDEX `project_members_user_status_project_idx` ON `project_members` (`user_id`,`status`,`project_id`);

