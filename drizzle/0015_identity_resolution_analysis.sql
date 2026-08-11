CREATE TABLE `identity_ruleset_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `semantic_version` text NOT NULL,
  `checksum` text NOT NULL,
  `status` text NOT NULL,
  `rules_json` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX `identity_ruleset_semver_idx` ON `identity_ruleset_versions` (`semantic_version`,`checksum`);

CREATE TABLE `identity_resolution_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `ruleset_version_id` text NOT NULL,
  `mode` text NOT NULL CHECK (`mode` IN ('Analysis')),
  `input_fingerprint` text NOT NULL,
  `status` text NOT NULL,
  `started_by` text NOT NULL,
  `started_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` text,
  `summary_json` text NOT NULL DEFAULT '{}',
  FOREIGN KEY (`ruleset_version_id`) REFERENCES `identity_ruleset_versions`(`id`)
);
CREATE UNIQUE INDEX `identity_resolution_run_idempotency_idx` ON `identity_resolution_runs` (`ruleset_version_id`,`mode`,`input_fingerprint`);

CREATE TABLE `identity_resolution_cases` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `conflict_id` text NOT NULL,
  `input_snapshot_json` text NOT NULL,
  `status` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`run_id`) REFERENCES `identity_resolution_runs`(`id`),
  FOREIGN KEY (`conflict_id`) REFERENCES `product_conflicts`(`id`)
);
CREATE UNIQUE INDEX `identity_resolution_case_run_conflict_idx` ON `identity_resolution_cases` (`run_id`,`conflict_id`);
CREATE INDEX `identity_resolution_case_status_idx` ON `identity_resolution_cases` (`status`,`created_at`);

CREATE TABLE `identity_resolution_candidates` (
  `id` text PRIMARY KEY NOT NULL,
  `case_id` text NOT NULL,
  `product_id` text NOT NULL,
  `retrieval_method` text NOT NULL,
  `snapshot_json` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`case_id`) REFERENCES `identity_resolution_cases`(`id`),
  FOREIGN KEY (`product_id`) REFERENCES `library_products`(`id`)
);
CREATE UNIQUE INDEX `identity_resolution_candidate_case_product_idx` ON `identity_resolution_candidates` (`case_id`,`product_id`);

CREATE TABLE `identity_resolution_proposals` (
  `id` text PRIMARY KEY NOT NULL,
  `case_id` text NOT NULL,
  `outcome` text NOT NULL,
  `classification` text NOT NULL,
  `relationship_type` text,
  `confidence` integer NOT NULL,
  `terminal_rule_id` text NOT NULL,
  `reason_code` text,
  `explanation_json` text NOT NULL,
  `required_evidence_json` text NOT NULL DEFAULT '[]',
  `blockers_json` text NOT NULL DEFAULT '[]',
  `proposal_fingerprint` text NOT NULL,
  `status` text NOT NULL DEFAULT 'Proposed' CHECK (`status` IN ('Proposed')),
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`case_id`) REFERENCES `identity_resolution_cases`(`id`)
);
CREATE UNIQUE INDEX `identity_resolution_proposal_case_idx` ON `identity_resolution_proposals` (`case_id`);
CREATE UNIQUE INDEX `identity_resolution_proposal_fingerprint_idx` ON `identity_resolution_proposals` (`proposal_fingerprint`);

CREATE TABLE `identity_resolution_rule_traces` (
  `id` text PRIMARY KEY NOT NULL,
  `proposal_id` text NOT NULL,
  `sequence_no` integer NOT NULL,
  `rule_id` text NOT NULL,
  `rule_version` text NOT NULL,
  `matched` integer NOT NULL DEFAULT 0,
  `terminal` integer NOT NULL DEFAULT 0,
  `confidence` integer NOT NULL DEFAULT 0,
  `decision` text,
  `relationship_type` text,
  `failure_reason` text,
  `human_explanation` text NOT NULL,
  `machine_explanation_json` text NOT NULL DEFAULT '{}',
  `evidence_json` text NOT NULL DEFAULT '[]',
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`proposal_id`) REFERENCES `identity_resolution_proposals`(`id`)
);
CREATE UNIQUE INDEX `identity_resolution_trace_sequence_idx` ON `identity_resolution_rule_traces` (`proposal_id`,`sequence_no`);
CREATE INDEX `identity_resolution_trace_rule_idx` ON `identity_resolution_rule_traces` (`rule_id`,`matched`,`terminal`);
