CREATE TABLE `specification_extraction_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `extraction_version_id` text NOT NULL,
  `document_id` text NOT NULL,
  `document_version_id` text NOT NULL,
  `project_id` text NOT NULL,
  `status` text NOT NULL,
  `total_pages` integer NOT NULL,
  `processed_pages` integer NOT NULL DEFAULT 0,
  `current_page` integer,
  `current_chunk` integer,
  `completed_chunks` integer NOT NULL DEFAULT 0,
  `remaining_chunks` integer NOT NULL,
  `chunk_size` integer NOT NULL,
  `extracted_clauses` integer NOT NULL DEFAULT 0,
  `extracted_requirements` integer NOT NULL DEFAULT 0,
  `elapsed_seconds` integer NOT NULL DEFAULT 0,
  `estimated_remaining_seconds` integer,
  `worker_version` text NOT NULL,
  `source_fingerprint` text NOT NULL,
  `resume_token` text NOT NULL,
  `scope_mode` text NOT NULL DEFAULT 'Prioritize Relevant',
  `project_system` text,
  `requested_by` text NOT NULL,
  `started_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_checkpoint_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` text,
  `failed_at` text,
  `cancelled_at` text,
  `error_code` text,
  `error_message` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`extraction_version_id`) REFERENCES `specification_extraction_versions`(`id`),
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`),
  FOREIGN KEY (`document_version_id`) REFERENCES `document_versions`(`id`),
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`)
);
CREATE UNIQUE INDEX `spec_job_extraction_idx` ON `specification_extraction_jobs` (`extraction_version_id`);
CREATE INDEX `spec_job_status_checkpoint_idx` ON `specification_extraction_jobs` (`status`,`last_checkpoint_at`);
CREATE INDEX `spec_job_document_idx` ON `specification_extraction_jobs` (`document_id`,`created_at`);

CREATE TABLE `specification_extraction_chunks` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL,
  `chunk_number` integer NOT NULL,
  `page_from` integer NOT NULL,
  `page_to` integer NOT NULL,
  `page_count` integer NOT NULL,
  `priority` integer NOT NULL DEFAULT 100,
  `relevance` text NOT NULL DEFAULT 'Deferred',
  `status` text NOT NULL DEFAULT 'Queued',
  `attempt` integer NOT NULL DEFAULT 0,
  `max_attempts` integer NOT NULL DEFAULT 3,
  `lease_owner` text,
  `lease_expires_at` text,
  `input_fingerprint` text NOT NULL,
  `output_fingerprint` text,
  `extraction_method` text,
  `clause_count` integer NOT NULL DEFAULT 0,
  `requirement_count` integer NOT NULL DEFAULT 0,
  `warning_count` integer NOT NULL DEFAULT 0,
  `duration_ms` integer,
  `error_code` text,
  `error_message` text,
  `technical_details` text,
  `started_at` text,
  `completed_at` text,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`job_id`) REFERENCES `specification_extraction_jobs`(`id`)
);
CREATE UNIQUE INDEX `spec_chunk_number_idx` ON `specification_extraction_chunks` (`job_id`,`chunk_number`);
CREATE INDEX `spec_chunk_claim_idx` ON `specification_extraction_chunks` (`job_id`,`status`,`priority`,`chunk_number`);

CREATE TABLE `specification_extraction_pages` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL,
  `chunk_id` text NOT NULL,
  `page_number` integer NOT NULL,
  `status` text NOT NULL,
  `title` text,
  `disciplines` text NOT NULL DEFAULT '[]',
  `relevant` integer NOT NULL DEFAULT 1,
  `text_content` text,
  `ocr_text` text,
  `extraction_method` text NOT NULL,
  `confidence` integer NOT NULL,
  `error_code` text,
  `error_message` text,
  `processed_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`job_id`) REFERENCES `specification_extraction_jobs`(`id`),
  FOREIGN KEY (`chunk_id`) REFERENCES `specification_extraction_chunks`(`id`)
);
CREATE UNIQUE INDEX `spec_page_job_number_idx` ON `specification_extraction_pages` (`job_id`,`page_number`);

CREATE TABLE `specification_chunk_entities` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL,
  `chunk_id` text NOT NULL,
  `entity_type` text NOT NULL,
  `entity_key` text NOT NULL,
  `page_from` integer,
  `page_to` integer,
  `payload` text NOT NULL,
  `fingerprint` text NOT NULL,
  `review_status` text NOT NULL DEFAULT 'Needs Review',
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`job_id`) REFERENCES `specification_extraction_jobs`(`id`),
  FOREIGN KEY (`chunk_id`) REFERENCES `specification_extraction_chunks`(`id`)
);
CREATE UNIQUE INDEX `spec_chunk_entity_fingerprint_idx` ON `specification_chunk_entities` (`job_id`,`fingerprint`);
CREATE INDEX `spec_chunk_entity_type_idx` ON `specification_chunk_entities` (`job_id`,`entity_type`,`page_from`);

CREATE TABLE `specification_extraction_failures` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL,
  `chunk_id` text,
  `page_number` integer,
  `error_code` text NOT NULL,
  `error_message` text NOT NULL,
  `technical_details` text,
  `attempt` integer NOT NULL,
  `retryable` integer NOT NULL DEFAULT 1,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`job_id`) REFERENCES `specification_extraction_jobs`(`id`),
  FOREIGN KEY (`chunk_id`) REFERENCES `specification_extraction_chunks`(`id`)
);
CREATE INDEX `spec_failure_job_idx` ON `specification_extraction_failures` (`job_id`,`created_at`);

CREATE TABLE `specification_extraction_checkpoints` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL,
  `chunk_id` text,
  `processed_pages` integer NOT NULL,
  `completed_chunks` integer NOT NULL,
  `current_page` integer,
  `current_chunk` integer,
  `resume_token` text NOT NULL,
  `worker_version` text NOT NULL,
  `metrics` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`job_id`) REFERENCES `specification_extraction_jobs`(`id`),
  FOREIGN KEY (`chunk_id`) REFERENCES `specification_extraction_chunks`(`id`)
);
CREATE INDEX `spec_checkpoint_job_idx` ON `specification_extraction_checkpoints` (`job_id`,`created_at`);

CREATE TABLE `specification_document_map_entries` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL,
  `title` text,
  `page_number` integer,
  `depth` integer NOT NULL DEFAULT 0,
  `disciplines` text NOT NULL DEFAULT '[]',
  `relevant` integer NOT NULL DEFAULT 1,
  `method` text NOT NULL,
  `confidence` integer NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`job_id`) REFERENCES `specification_extraction_jobs`(`id`)
);
CREATE INDEX `spec_document_map_job_idx` ON `specification_document_map_entries` (`job_id`,`page_number`);
