ALTER TABLE `organizations` ADD COLUMN `owner_user_id` text;

CREATE TABLE `organization_membership_roles` (
  `id` text PRIMARY KEY NOT NULL,
  `membership_id` text NOT NULL,
  `role` text NOT NULL CHECK (`role` IN ('Organization Owner','Organization Administrator','Organization Member')),
  `status` text NOT NULL DEFAULT 'Active' CHECK (`status` IN ('Active','Revoked')),
  `granted_by` text NOT NULL,
  `granted_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `revoked_at` text,
  FOREIGN KEY (`membership_id`) REFERENCES `organization_memberships`(`id`)
);
CREATE UNIQUE INDEX `organization_membership_roles_active_idx` ON `organization_membership_roles` (`membership_id`,`role`);
CREATE INDEX `organization_membership_roles_membership_status_idx` ON `organization_membership_roles` (`membership_id`,`status`);

CREATE TABLE `organization_audit_events` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `membership_id` text,
  `action` text NOT NULL,
  `actor_user_id` text NOT NULL,
  `actor_authentication_source` text NOT NULL,
  `reason` text NOT NULL,
  `previous_value_json` text,
  `new_value_json` text NOT NULL,
  `request_id` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`),
  FOREIGN KEY (`membership_id`) REFERENCES `organization_memberships`(`id`)
);
CREATE INDEX `organization_audit_events_org_created_idx` ON `organization_audit_events` (`organization_id`,`created_at`);
CREATE TRIGGER `organization_audit_events_no_update` BEFORE UPDATE ON `organization_audit_events`
BEGIN SELECT RAISE(ABORT, 'ORGANIZATION_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER `organization_audit_events_no_delete` BEFORE DELETE ON `organization_audit_events`
BEGIN SELECT RAISE(ABORT, 'ORGANIZATION_AUDIT_IMMUTABLE'); END;

