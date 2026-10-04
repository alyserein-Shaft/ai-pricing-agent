CREATE TABLE `specification_document_map_details` (
  `entry_id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL,
  `document_version_id` text NOT NULL,
  `source_page` integer,
  `printed_page_reference` text,
  `section_number` text,
  `section_title` text,
  `discipline` text NOT NULL DEFAULT 'Unknown/Mixed',
  `start_page` integer,
  `end_page` integer,
  `evidence_text` text,
  `review_status` text NOT NULL DEFAULT 'Needs Review',
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`entry_id`) REFERENCES `specification_document_map_entries`(`id`),
  FOREIGN KEY (`job_id`) REFERENCES `specification_extraction_jobs`(`id`),
  FOREIGN KEY (`document_version_id`) REFERENCES `document_versions`(`id`)
);
CREATE INDEX `spec_document_map_detail_range_idx` ON `specification_document_map_details` (`job_id`,`start_page`,`end_page`);

CREATE TABLE `specification_chunk_metrics` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL,
  `chunk_id` text NOT NULL,
  `source_load_ms` integer,
  `parser_ms` integer,
  `segmentation_ms` integer,
  `persistence_ms` integer,
  `checkpoint_ms` integer,
  `total_ms` integer NOT NULL,
  `source_bytes` integer,
  `source_access_method` text,
  `source_read_count` integer NOT NULL DEFAULT 0,
  `source_read_bytes` integer NOT NULL DEFAULT 0,
  `rss_before` integer,
  `rss_after_load` integer,
  `rss_peak` integer,
  `rss_after` integer,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`job_id`) REFERENCES `specification_extraction_jobs`(`id`),
  FOREIGN KEY (`chunk_id`) REFERENCES `specification_extraction_chunks`(`id`)
);
CREATE UNIQUE INDEX `spec_chunk_metric_chunk_idx` ON `specification_chunk_metrics` (`chunk_id`);
