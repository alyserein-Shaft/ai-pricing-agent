CREATE TABLE `library_security_principals` (
  `user_id` text PRIMARY KEY NOT NULL,
  `email` text,
  `account_status` text NOT NULL DEFAULT 'Active' CHECK (`account_status` IN ('Active','Disabled')),
  `session_status` text NOT NULL DEFAULT 'Active' CHECK (`session_status` IN ('Active','Revoked')),
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE `library_permission_grants` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `permission` text NOT NULL CHECK (`permission` IN ('Library Viewer','Library Reviewer','Library Manager','Administrator')),
  `status` text NOT NULL DEFAULT 'Active' CHECK (`status` IN ('Active','Revoked')),
  `granted_by` text NOT NULL,
  `granted_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `revoked_by` text,
  `revoked_at` text,
  FOREIGN KEY (`user_id`) REFERENCES `library_security_principals`(`user_id`)
);

CREATE UNIQUE INDEX `library_permission_grants_active_user_idx`
  ON `library_permission_grants` (`user_id`) WHERE `status`='Active';
CREATE INDEX `library_permission_grants_permission_status_idx`
  ON `library_permission_grants` (`permission`,`status`);

-- This principal is unreachable unless the Worker is explicitly configured in
-- local-development auth mode and the request host is local.
INSERT INTO `library_security_principals` (`user_id`,`email`,`account_status`,`session_status`)
VALUES ('local-development-user','local@development.invalid','Active','Active');
INSERT INTO `library_permission_grants` (`id`,`user_id`,`permission`,`status`,`granted_by`)
VALUES ('librarygrant_local_development','local-development-user','Library Manager','Active','migration-0018');
