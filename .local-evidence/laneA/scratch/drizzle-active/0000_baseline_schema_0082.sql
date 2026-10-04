CREATE TABLE IF NOT EXISTS `ai_quotation_advisories` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  quotation_revision_id TEXT REFERENCES project_quotation_revisions(id),
  evidence_fingerprint TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  config_fingerprint TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  model_version TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  status TEXT NOT NULL,
  advisory_json TEXT NOT NULL,
  validation_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TEXT,
  UNIQUE(project_id,input_fingerprint,config_fingerprint)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `boq_extraction_evidence` (
  `id` text PRIMARY KEY NOT NULL,
  `extraction_version_id` text NOT NULL,
  `item_id` text,
  `field_name` text NOT NULL,
  `source_kind` text NOT NULL,
  `source_location` text NOT NULL,
  `raw_value` text,
  `normalized_value` text,
  `confidence` integer NOT NULL,
  `method` text NOT NULL,
  FOREIGN KEY (`extraction_version_id`) REFERENCES `boq_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`item_id`) REFERENCES `boq_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `boq_extraction_sources` (
  `id` text PRIMARY KEY NOT NULL,
  `extraction_version_id` text NOT NULL,
  `source_kind` text NOT NULL,
  `label` text NOT NULL,
  `sheet_name` text,
  `page_number` integer,
  `classification` text NOT NULL,
  `hidden` integer DEFAULT false NOT NULL,
  `header_rows` text,
  `column_mapping` text,
  `merged_ranges` text,
  `metadata` text DEFAULT '{}' NOT NULL,
  FOREIGN KEY (`extraction_version_id`) REFERENCES `boq_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `boq_extraction_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `document_id` text NOT NULL,
  `document_version_id` text NOT NULL,
  `classification_id` text,
  `processing_run_id` text,
  `version_number` integer NOT NULL,
  `status` text NOT NULL,
  `parser_version` text NOT NULL,
  `ruleset_version` text NOT NULL,
  `ocr_version` text NOT NULL,
  `extraction_method` text,
  `summary` text DEFAULT '{}' NOT NULL,
  `error_code` text,
  `error_message` text,
  `technical_details` text,
  `suggested_action` text,
  `superseded_at` text,
  `started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `completed_at` text,
  `created_by` text NOT NULL,
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`document_version_id`) REFERENCES `document_versions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`classification_id`) REFERENCES `document_classifications`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`processing_run_id`) REFERENCES `document_processing_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `boq_extraction_warnings` (
  `id` text PRIMARY KEY NOT NULL,
  `extraction_version_id` text NOT NULL,
  `item_id` text,
  `code` text NOT NULL,
  `severity` text NOT NULL,
  `message` text NOT NULL,
  `source_location` text,
  `resolved_at` text,
  `resolved_by` text,
  `resolution` text,
  FOREIGN KEY (`extraction_version_id`) REFERENCES `boq_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`item_id`) REFERENCES `boq_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `boq_items` (
  `id` text PRIMARY KEY NOT NULL,
  `extraction_version_id` text NOT NULL,
  `project_id` text NOT NULL,
  `source_document_id` text NOT NULL,
  `section_id` text,
  `duplicate_of_item_id` text,
  `sequence` integer NOT NULL,
  `item_number` text,
  `parent_item_number` text,
  `section` text,
  `subsection` text,
  `hierarchy_depth` integer DEFAULT 0 NOT NULL,
  `section_path` text NOT NULL,
  `system_value` text,
  `system_source_type` text,
  `system_confidence` integer,
  `category` text,
  `subcategory` text,
  `description` text,
  `normalized_description` text,
  `original_unit` text,
  `normalized_unit` text,
  `unit_rule` text,
  `unit_confidence` integer,
  `original_quantity` text,
  `numeric_quantity` text,
  `quantity_type` text,
  `quantity_formula` text,
  `quantity_confidence` integer,
  `manufacturer` text,
  `brand` text,
  `model` text,
  `part_number` text,
  `specification_reference` text,
  `drawing_reference` text,
  `notes` text,
  `alternates` text,
  `included_accessories` text,
  `excluded_scope` text,
  `row_type` text NOT NULL,
  `extraction_confidence` integer NOT NULL,
  `confidence_state` text NOT NULL,
  `review_status` text NOT NULL,
  `source_location` text NOT NULL,
  `original_raw_values` text NOT NULL,
  `current_values` text NOT NULL,
  `approved_for_downstream` integer DEFAULT false NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`extraction_version_id`) REFERENCES `boq_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`source_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`section_id`) REFERENCES `boq_sections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `boq_quantity_source_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `boq_item_id` text NOT NULL,
  `source` text NOT NULL,
  `selected_quantity` real NOT NULL,
  `boq_quantity` real,
  `drawing_quantity` real,
  `recognition_version_id` text,
  `definition_key` text,
  `reason` text NOT NULL,
  `decided_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`),
  FOREIGN KEY (`boq_item_id`) REFERENCES `boq_items`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `boq_requirement_links` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `boq_item_id` text NOT NULL,
  `requirement_id` text NOT NULL,
  `link_method` text NOT NULL,
  `confidence` integer NOT NULL,
  `evidence` text NOT NULL,
  `status` text NOT NULL,
  `scope_type` text DEFAULT 'BOQ Item' NOT NULL,
  `scope_id` text NOT NULL,
  `reviewed_by` text,
  `reviewed_at` text,
  `review_reason` text,
  `version_number` integer DEFAULT 1 NOT NULL,
  `previous_version_id` text,
  `superseded_at` text,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`boq_item_id`) REFERENCES `boq_items`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `boq_review_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `extraction_version_id` text NOT NULL,
  `item_id` text,
  `action` text NOT NULL,
  `previous_value` text,
  `new_value` text,
  `reason` text NOT NULL,
  `decided_by` text NOT NULL,
  `decided_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`extraction_version_id`) REFERENCES `boq_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`item_id`) REFERENCES `boq_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `boq_revision_comparisons` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `previous_extraction_version_id` text NOT NULL,
  `current_extraction_version_id` text NOT NULL,
  `added_count` integer NOT NULL,
  `removed_count` integer NOT NULL,
  `changed_count` integer NOT NULL,
  `changes` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`previous_extraction_version_id`) REFERENCES `boq_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`current_extraction_version_id`) REFERENCES `boq_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `boq_sections` (
  `id` text PRIMARY KEY NOT NULL,
  `extraction_version_id` text NOT NULL,
  `parent_section_id` text,
  `item_number` text,
  `title` text NOT NULL,
  `depth` integer NOT NULL,
  `path` text NOT NULL,
  `sequence` integer NOT NULL,
  `source_location` text NOT NULL,
  FOREIGN KEY (`extraction_version_id`) REFERENCES `boq_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `canonical_evidence_integrity` (
  `evidence_id` text PRIMARY KEY NOT NULL,
  `row_checksum` text NOT NULL,
  `source_checksum` text NOT NULL,
  `evidence_fingerprint` text NOT NULL,
  `sealed_by` text NOT NULL,
  `sealed_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `original_product_id` text,
  FOREIGN KEY (`evidence_id`) REFERENCES `product_source_evidence`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `canonical_product_resolution_audit` (
  `id` text PRIMARY KEY NOT NULL,
  `requested_product_id` text NOT NULL,
  `canonical_product_id` text NOT NULL,
  `resolution_path_json` text NOT NULL,
  `resolved_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `case_ground_truth_records` (
  id TEXT PRIMARY KEY,
  case_study_id TEXT NOT NULL REFERENCES case_studies(id),
  record_key TEXT NOT NULL,
  boq_item_id TEXT,
  record_type TEXT NOT NULL,
  original_value TEXT NOT NULL,
  normalized_value TEXT,
  confidence INTEGER NOT NULL,
  review_state TEXT NOT NULL DEFAULT 'Needs Review',
  evidence_scope TEXT NOT NULL,
  provenance TEXT NOT NULL,
  effective_date TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  superseded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(case_study_id,record_key,version)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `case_knowledge_decisions` (
  id TEXT PRIMARY KEY,
  case_study_id TEXT NOT NULL REFERENCES case_studies(id),
  knowledge_item_id TEXT NOT NULL REFERENCES case_knowledge_items(id),
  action TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  actor_permission TEXT NOT NULL,
  decision_version INTEGER NOT NULL,
  reversed_by_decision_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `case_knowledge_items` (
  id TEXT PRIMARY KEY,
  case_study_id TEXT NOT NULL REFERENCES case_studies(id),
  ground_truth_record_id TEXT REFERENCES case_ground_truth_records(id),
  classification TEXT NOT NULL,
  layer TEXT NOT NULL,
  title TEXT NOT NULL,
  original_value TEXT NOT NULL,
  normalized_value TEXT,
  confidence INTEGER NOT NULL,
  scope TEXT NOT NULL,
  review_state TEXT NOT NULL DEFAULT 'Needs Review',
  publication_state TEXT NOT NULL DEFAULT 'Not Published',
  reusable INTEGER NOT NULL DEFAULT 0,
  evidence TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  superseded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `case_learning_evaluations` (
  id TEXT PRIMARY KEY,
  case_study_id TEXT NOT NULL REFERENCES case_studies(id),
  release_id TEXT NOT NULL,
  suggestion_type TEXT NOT NULL,
  suggestion_id TEXT,
  outcome TEXT NOT NULL,
  evidence TEXT NOT NULL,
  explanation TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `case_similarity_signals` (
  id TEXT PRIMARY KEY,
  case_study_id TEXT NOT NULL REFERENCES case_studies(id),
  signal_type TEXT NOT NULL,
  signal_value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  weight REAL NOT NULL,
  provenance TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(case_study_id,signal_type,normalized_value)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `case_studies` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  case_version INTEGER NOT NULL,
  snapshot_fingerprint TEXT NOT NULL,
  project_snapshot TEXT NOT NULL,
  system_domain TEXT,
  client TEXT,
  location TEXT,
  currency TEXT,
  project_outcome TEXT,
  source_completeness INTEGER NOT NULL DEFAULT 0,
  ground_truth_completeness INTEGER NOT NULL DEFAULT 0,
  review_state TEXT NOT NULL DEFAULT 'Needs Review',
  publication_state TEXT NOT NULL DEFAULT 'Not Published',
  benchmark_state TEXT NOT NULL DEFAULT 'Learning',
  benchmark_release TEXT,
  frozen_at TEXT NOT NULL,
  frozen_by TEXT NOT NULL,
  superseded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  historical_completeness_assessment TEXT,
  learning_readiness TEXT,
  UNIQUE(project_id, case_version),
  UNIQUE(project_id, snapshot_fingerprint)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `case_study_audit_log` (
  id TEXT PRIMARY KEY,
  case_study_id TEXT NOT NULL REFERENCES case_studies(id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  actor_permission TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `case_study_sources` (
  id TEXT PRIMARY KEY,
  case_study_id TEXT NOT NULL REFERENCES case_studies(id),
  document_id TEXT,
  document_version_id TEXT,
  source_type TEXT NOT NULL,
  name TEXT NOT NULL,
  revision TEXT,
  issue_date TEXT,
  authority TEXT,
  scope TEXT,
  completeness_state TEXT NOT NULL,
  provenance TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checksum TEXT,
  UNIQUE(case_study_id,document_version_id,source_type)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `classification_candidates` (
  `id` text PRIMARY KEY NOT NULL,
  `classification_id` text NOT NULL,
  `document_type` text NOT NULL,
  `rank` integer NOT NULL,
  `confidence` integer NOT NULL,
  `score_basis_points` integer NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`classification_id`) REFERENCES `document_classifications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `classification_evidence` (
  `id` text PRIMARY KEY NOT NULL,
  `classification_id` text NOT NULL,
  `category` text NOT NULL,
  `evidence_kind` text NOT NULL,
  `label` text NOT NULL,
  `excerpt` text,
  `weight` integer NOT NULL,
  `method` text NOT NULL,
  `page_from` integer,
  `page_to` integer,
  `sheet_name` text,
  `section` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`classification_id`) REFERENCES `document_classifications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `classification_model_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `classifier_version` text NOT NULL,
  `ruleset_version` text NOT NULL,
  `prompt_version` text NOT NULL,
  `ai_model_version` text,
  `configuration` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `classification_overrides` (
  `id` text PRIMARY KEY NOT NULL,
  `classification_id` text NOT NULL,
  `document_id` text NOT NULL,
  `previous_type` text NOT NULL,
  `selected_type` text NOT NULL,
  `secondary_types` text NOT NULL,
  `reason` text,
  `overridden_by` text NOT NULL,
  `overridden_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`classification_id`) REFERENCES `document_classifications`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `classification_segments` (
  `id` text PRIMARY KEY NOT NULL,
  `classification_id` text NOT NULL,
  `segment_kind` text NOT NULL,
  `label` text NOT NULL,
  `page_from` integer,
  `page_to` integer,
  `sheet_name` text,
  `section` text,
  `primary_type` text NOT NULL,
  `confidence` integer NOT NULL,
  `evidence` text NOT NULL,
  `manually_set` integer DEFAULT false NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`classification_id`) REFERENCES `document_classifications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `commercial_conditions` (
  `id` text PRIMARY KEY NOT NULL,
  `source_version_id` text NOT NULL,
  `condition_type` text NOT NULL,
  `value_json` text NOT NULL,
  `scope_json` text NOT NULL,
  `review_status` text NOT NULL DEFAULT 'Needs Review',
  `created_by` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `consolidated_profile_requirements` (
  `id` text PRIMARY KEY NOT NULL,
  `profile_version_id` text NOT NULL,
  `canonical_key` text NOT NULL,
  `normalized_requirement` text NOT NULL,
  `requirement_category` text NOT NULL,
  `requirement_type` text NOT NULL,
  `priority` text NOT NULL,
  `governing_source_id` text NOT NULL,
  `sources` text NOT NULL,
  `attributes` text NOT NULL,
  `standards` text NOT NULL,
  `manufacturers` text NOT NULL,
  `confidence` integer NOT NULL,
  `review_status` text DEFAULT 'Needs Review' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`profile_version_id`) REFERENCES `requirement_profile_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `dashboard_audit_log` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text,
  `action` text NOT NULL,
  `previous_value` text,
  `new_value` text,
  `reason` text NOT NULL,
  `actor_user_id` text NOT NULL,
  `actor_role` text NOT NULL,
  `request_id` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `dashboard_metric_definitions` (
  `id` text NOT NULL,
  `version` text NOT NULL,
  `name` text NOT NULL,
  `description` text NOT NULL,
  `scope` text NOT NULL,
  `data_source` text NOT NULL,
  `formula` text NOT NULL,
  `filters` text NOT NULL,
  `exclusions` text NOT NULL,
  `refresh_strategy` text NOT NULL,
  `permission` text NOT NULL,
  `drill_down_route` text NOT NULL,
  `owner` text NOT NULL,
  `test_cases` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `dashboard_metric_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `metric_id` text NOT NULL,
  `metric_version` text NOT NULL,
  `project_id` text,
  `scope_key` text NOT NULL,
  `value` text NOT NULL,
  `source_version` text NOT NULL,
  `calculated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `expires_at` text,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `discount_rules` (
  `id` text PRIMARY KEY NOT NULL,
  `manufacturer_id` text NOT NULL,
  `source_id` text NOT NULL,
  `source_version_id` text NOT NULL,
  `family_scope` text NOT NULL,
  `component_scope` text NOT NULL,
  `discount_basis_points` integer NOT NULL,
  `calculation_method` text NOT NULL,
  `calculation_order` integer NOT NULL,
  `effective_from` text,
  `effective_to` text,
  `project_id` text,
  `approval_state` text NOT NULL DEFAULT 'Needs Review',
  `evidence_json` text NOT NULL,
  `version_number` integer NOT NULL DEFAULT 1,
  `created_by` text NOT NULL,
  `approved_by` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `superseded_at` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `document_artifacts` (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES document_processing_runs(id),
  artifact_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  page_from INTEGER,
  page_to INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checksum TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `document_assertions` (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES document_processing_runs(id),
  assertion_type TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  confidence_basis_points INTEGER NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  source_page INTEGER,
  source_region TEXT,
  source_text TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `document_audit_events` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `document_id` text,
  `version_id` text,
  `actor_user_id` text NOT NULL,
  `action` text NOT NULL,
  `old_value` text,
  `new_value` text,
  `reason` text DEFAULT '' NOT NULL,
  `request_id` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `document_classifications` (
  `id` text PRIMARY KEY NOT NULL,
  `document_id` text NOT NULL,
  `document_version_id` text NOT NULL,
  `processing_run_id` text,
  `model_version_id` text NOT NULL,
  `primary_type` text NOT NULL,
  `secondary_types` text NOT NULL,
  `confidence` integer NOT NULL,
  `confidence_state` text NOT NULL,
  `status` text NOT NULL,
  `method` text NOT NULL,
  `extraction_method` text,
  `extraction_quality_basis_points` integer,
  `mixed` integer DEFAULT false NOT NULL,
  `manual_review_required` integer DEFAULT true NOT NULL,
  `downstream_route` text NOT NULL,
  `error_code` text,
  `error_message` text,
  `technical_details` text,
  `suggested_action` text,
  `confirmed_by` text,
  `confirmed_at` text,
  `classified_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `superseded_at` text,
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`document_version_id`) REFERENCES `document_versions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`processing_run_id`) REFERENCES `document_processing_runs`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`model_version_id`) REFERENCES `classification_model_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `document_processing_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `document_version_id` text NOT NULL,
  `stage` text NOT NULL,
  `status` text NOT NULL,
  `progress` integer DEFAULT 0 NOT NULL,
  `attempt` integer DEFAULT 0 NOT NULL,
  `max_attempts` integer DEFAULT 3 NOT NULL,
  `cancel_requested` integer DEFAULT false NOT NULL,
  `error_code` text,
  `error_message` text,
  `processor_version` text,
  `started_at` text,
  `completed_at` text,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `priority` integer DEFAULT 100 NOT NULL,
  `technical_details` text,
  `suggested_action` text,
  `available_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `lease_owner` text,
  `lease_expires_at` text,
  `last_retry_at` text,
  FOREIGN KEY (`document_version_id`) REFERENCES `document_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `document_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `document_id` text NOT NULL,
  `upload_session_id` text,
  `version_number` integer NOT NULL,
  `original_filename` text NOT NULL,
  `stored_filename` text NOT NULL,
  `extension` text NOT NULL,
  `mime_type` text NOT NULL,
  `byte_size` integer NOT NULL,
  `sha256` text NOT NULL,
  `object_key` text NOT NULL,
  `revision` text,
  `issue_date` text,
  `issue_purpose` text,
  `transmittal` text,
  `source` text DEFAULT 'User Upload' NOT NULL,
  `uploaded_by` text NOT NULL,
  `uploaded_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `last_modified` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `supersedes_version_id` text,
  `restored_from_version_id` text,
  `quarantine_status` text DEFAULT 'Pending Scan' NOT NULL,
  `drawing_status` text DEFAULT 'UNKNOWN' NOT NULL,
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`upload_session_id`) REFERENCES `upload_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `documents` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `logical_name` text NOT NULL,
  `document_type` text DEFAULT 'Auto Detection' NOT NULL,
  `classification_source` text DEFAULT 'Manual/Unclassified' NOT NULL,
  `notes` text DEFAULT '' NOT NULL,
  `tags` text DEFAULT '[]' NOT NULL,
  `current_version_id` text,
  `archived_at` text,
  `deleted_at` text,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `downstream_routing_handoffs` (
  `id` text PRIMARY KEY NOT NULL,
  `classification_id` text NOT NULL,
  `document_version_id` text NOT NULL,
  `route` text NOT NULL,
  `status` text DEFAULT 'Decision Only' NOT NULL,
  `eligible` integer DEFAULT false NOT NULL,
  `blocker` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`classification_id`) REFERENCES `document_classifications`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`document_version_id`) REFERENCES `document_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_architecture_approved_audit_events` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT,
  approved_version_id TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(approved_version_id) REFERENCES drawing_architecture_approved_versions(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_architecture_approved_rows` (
  id TEXT PRIMARY KEY,
  approved_version_id TEXT NOT NULL,
  review_case_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  document_version_id TEXT NOT NULL,
  drawing_intake_version_id TEXT NOT NULL,
  structure_version_id TEXT,
  fact_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  relation TEXT,
  object TEXT,
  scope TEXT NOT NULL,
  evidence_kind TEXT NOT NULL,
  authority_class TEXT,
  source_drawing_number TEXT,
  source_page INTEGER,
  source_region TEXT,
  source_fragment_ids TEXT NOT NULL DEFAULT '[]',
  parser_version TEXT NOT NULL,
  evidence_fingerprint TEXT NOT NULL,
  review_actor_id TEXT NOT NULL,
  review_reason TEXT NOT NULL,
  source_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(approved_version_id) REFERENCES drawing_architecture_approved_versions(id),
  FOREIGN KEY(review_case_id) REFERENCES drawing_architecture_review_cases(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_architecture_approved_versions` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  input_fingerprint TEXT NOT NULL,
  output_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  approved_fact_count INTEGER NOT NULL,
  excluded_fact_count INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  superseded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_architecture_exception_adjudications` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  exception_key TEXT NOT NULL,
  exception_type TEXT NOT NULL,
  raw_subject TEXT NOT NULL,
  raw_relation TEXT,
  raw_object TEXT,
  raw_drawing_number TEXT NOT NULL,
  building_code TEXT NOT NULL,
  source_drawing_number TEXT NOT NULL,
  source_drawing_name TEXT,
  decision_state TEXT NOT NULL,
  decision_reasons TEXT NOT NULL DEFAULT '[]',
  decision_policy_version TEXT NOT NULL,
  decision_actor TEXT NOT NULL,
  decision_fingerprint TEXT NOT NULL,
  canonical_target_drawing_number TEXT,
  canonical_target_document_id TEXT,
  canonical_target_drawing_number_raw TEXT,
  canonical_building_asset_code TEXT,
  canonical_building_name TEXT,
  canonical_panel_identity TEXT,
  stage4_blocking_class TEXT NOT NULL DEFAULT 'NONBLOCKING_DRAWING_REVIEW',
  evidence_observations_count INTEGER,
  evidence_fingerprint TEXT,
  evidence_summary TEXT NOT NULL DEFAULT '{}',
  review_case_ids TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TEXT,
  superseding_adjudication_id TEXT
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_architecture_review_cases` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  document_version_id TEXT NOT NULL,
  drawing_intake_version_id TEXT NOT NULL,
  structure_version_id TEXT,
  fact_key TEXT NOT NULL,
  fact_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  relation TEXT,
  object TEXT,
  scope TEXT NOT NULL,
  evidence_kind TEXT NOT NULL,
  authority_class TEXT,
  source_drawing_number TEXT,
  source_page INTEGER,
  source_region TEXT,
  source_fragment_ids TEXT NOT NULL DEFAULT '[]',
  parser_version TEXT NOT NULL,
  evidence_fingerprint TEXT NOT NULL,
  decision_state TEXT NOT NULL DEFAULT 'Pending',
  decision_reason TEXT NOT NULL DEFAULT '[]',
  decision_policy_version TEXT,
  case_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'Needs Review',
  original_snapshot TEXT NOT NULL,
  current_snapshot TEXT NOT NULL,
  adjustments TEXT NOT NULL DEFAULT '[]',
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_reason TEXT,
  superseded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(drawing_intake_version_id) REFERENCES drawing_intake_versions(id),
  FOREIGN KEY(structure_version_id) REFERENCES drawing_structure_versions(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_architecture_review_events` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  drawing_intake_version_id TEXT NOT NULL,
  review_case_id TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_snapshot TEXT NOT NULL,
  new_snapshot TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  actor_permission TEXT NOT NULL,
  request_id TEXT NOT NULL,
  case_version INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(review_case_id) REFERENCES drawing_architecture_review_cases(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_architecture_stage4_readiness` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version_number INTEGER NOT NULL DEFAULT 1,
  architecture_status TEXT NOT NULL,
  stage4_readiness TEXT NOT NULL,
  stage4_blocking_class_summary TEXT NOT NULL DEFAULT 'NONBLOCKING_DRAWING_REVIEW',
  cross_sheet_reference_count INTEGER NOT NULL DEFAULT 0,
  generic_facp_count INTEGER NOT NULL DEFAULT 0,
  remaining_engineer_review_required INTEGER NOT NULL DEFAULT 0,
  remaining_confirm_project_reference INTEGER NOT NULL DEFAULT 0,
  remaining_confirm_same_panel INTEGER NOT NULL DEFAULT 0,
  resolved_count INTEGER NOT NULL DEFAULT 0,
  mirrored_discrepancy_resolved INTEGER NOT NULL DEFAULT 0,
  stale_count INTEGER NOT NULL DEFAULT 0,
  real_architecture_conflict_remaining INTEGER NOT NULL DEFAULT 0,
  approved_prior_row_count INTEGER NOT NULL DEFAULT 0,
  approved_next_row_count INTEGER NOT NULL,
  approved_next_version_number INTEGER NOT NULL,
  policy_version TEXT NOT NULL,
  computed_by TEXT NOT NULL,
  evidence_fingerprint TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TEXT,
  superseding_readiness_id TEXT,
  unique_exception_count INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_assets` (
  `id` text PRIMARY KEY NOT NULL,
  `intake_version_id` text NOT NULL,
  `page_id` text NOT NULL,
  `asset_type` text NOT NULL,
  `text_content` text,
  `bounding_box` text,
  `coordinates_available` integer NOT NULL,
  `detection_confidence` integer NOT NULL,
  `detection_method` text NOT NULL,
  `review_status` text DEFAULT 'Needs Review' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`intake_version_id`) REFERENCES `drawing_intake_versions`(`id`),
  FOREIGN KEY (`page_id`) REFERENCES `drawing_pages`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_document_classifications` (
  `id` text PRIMARY KEY NOT NULL,
  `intake_version_id` text NOT NULL,
  `classification_type` text NOT NULL,
  `confidence` integer NOT NULL,
  `extraction_method` text NOT NULL,
  `review_status` text DEFAULT 'Needs Review' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`intake_version_id`) REFERENCES `drawing_intake_versions`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_extraction_proposals` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  intake_version_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  proposal_key TEXT NOT NULL,
  proposal_type TEXT NOT NULL,
  raw_label TEXT,
  normalized_value TEXT,
  bounding_box TEXT,
  confidence INTEGER,
  authority_role TEXT NOT NULL,
  governed_status TEXT NOT NULL,
  hard_review_reasons TEXT NOT NULL,
  evidence TEXT NOT NULL,
  source_references TEXT NOT NULL,
  extraction_method TEXT NOT NULL,
  extraction_version TEXT NOT NULL,
  review_status TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_reason TEXT,
  corrected_value TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  visual_run_id TEXT,
  superseded_at TEXT,
  superseded_by_run_id TEXT,
  history_warning TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (document_id) REFERENCES documents(id),
  FOREIGN KEY (intake_version_id) REFERENCES drawing_intake_versions(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_extraction_review_events` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_value TEXT NOT NULL,
  new_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (proposal_id) REFERENCES drawing_extraction_proposals(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_intake_audit_events` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `document_id` text NOT NULL,
  `intake_version_id` text NOT NULL,
  `action` text NOT NULL,
  `previous_value` text,
  `new_value` text NOT NULL,
  `reason` text NOT NULL,
  `actor_user_id` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`),
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`),
  FOREIGN KEY (`intake_version_id`) REFERENCES `drawing_intake_versions`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_intake_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `document_id` text NOT NULL,
  `document_version_id` text NOT NULL,
  `version_number` integer NOT NULL,
  `input_fingerprint` text NOT NULL,
  `output_fingerprint` text NOT NULL,
  `parser_version` text NOT NULL,
  `status` text NOT NULL,
  `summary` text NOT NULL,
  `review_status` text DEFAULT 'Needs Review' NOT NULL,
  `superseded_at` text,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`),
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`),
  FOREIGN KEY (`document_version_id`) REFERENCES `document_versions`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_legend_entries` (
  `id` text PRIMARY KEY NOT NULL,
  `legend_id` text NOT NULL,
  `sequence` integer NOT NULL,
  `entry_type` text NOT NULL,
  `label` text NOT NULL,
  `description` text,
  `confidence` integer NOT NULL,
  `review_status` text DEFAULT 'Needs Review' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`legend_id`) REFERENCES `drawing_legends`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_legend_geometry_approved_links` (
  id TEXT PRIMARY KEY,
  approved_geometry_version_id TEXT NOT NULL,
  approved_row_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  source_page INTEGER NOT NULL,
  source_row TEXT NOT NULL,
  symbol_cell_bbox TEXT NOT NULL,
  geometry TEXT NOT NULL,
  geometry_signature TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  review_actor_id TEXT NOT NULL,
  review_reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(approved_geometry_version_id) REFERENCES drawing_legend_geometry_approved_versions(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_legend_geometry_approved_versions` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  source_geometry_version_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  input_fingerprint TEXT NOT NULL,
  output_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  approved_link_count INTEGER NOT NULL,
  missing_row_count INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  superseded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(source_geometry_version_id) REFERENCES drawing_legend_geometry_versions(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_legend_geometry_candidates` (
  id TEXT PRIMARY KEY,
  geometry_version_id TEXT NOT NULL,
  approved_row_id TEXT NOT NULL,
  source_page INTEGER NOT NULL,
  source_row TEXT NOT NULL,
  symbol_cell_id TEXT,
  symbol_cell_bbox TEXT,
  geometry TEXT NOT NULL,
  geometry_signature TEXT,
  detection_confidence INTEGER NOT NULL,
  detection_method TEXT NOT NULL,
  alignment_status TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  original_geometry TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_reason TEXT,
  reassigned_row_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(geometry_version_id) REFERENCES drawing_legend_geometry_versions(id),
  FOREIGN KEY(approved_row_id) REFERENCES drawing_structure_approved_rows(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_legend_geometry_review_events` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  geometry_version_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_value TEXT NOT NULL,
  new_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(candidate_id) REFERENCES drawing_legend_geometry_candidates(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_legend_geometry_versions` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  approved_structure_version_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  input_fingerprint TEXT NOT NULL,
  output_fingerprint TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_by TEXT NOT NULL,
  superseded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(approved_structure_version_id) REFERENCES drawing_structure_approved_versions(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_legends` (
  `id` text PRIMARY KEY NOT NULL,
  `intake_version_id` text NOT NULL,
  `page_id` text NOT NULL,
  `legend_version` text,
  `confidence` integer NOT NULL,
  `detection_method` text NOT NULL,
  `review_status` text DEFAULT 'Needs Review' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`intake_version_id`) REFERENCES `drawing_intake_versions`(`id`),
  FOREIGN KEY (`page_id`) REFERENCES `drawing_pages`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_metadata` (
  `id` text PRIMARY KEY NOT NULL,
  `intake_version_id` text NOT NULL,
  `drawing_number` text,
  `revision` text,
  `sheet_name` text,
  `discipline` text,
  `scale` text,
  `issue_date` text,
  `consultant` text,
  `contractor` text,
  `client` text,
  `project_name` text,
  `sheet_size` text,
  `confidence` integer NOT NULL,
  `extraction_method` text NOT NULL,
  `review_status` text DEFAULT 'Needs Review' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`intake_version_id`) REFERENCES `drawing_intake_versions`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_occurrence_cluster_events` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  cluster_version_id TEXT NOT NULL,
  cluster_id TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_value TEXT NOT NULL,
  new_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_occurrence_cluster_versions` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  approved_geometry_version_id TEXT NOT NULL,
  source_recognition_version_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  input_fingerprint TEXT NOT NULL,
  output_fingerprint TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_by TEXT NOT NULL,
  superseded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_occurrence_spatial_clusters` (
  id TEXT PRIMARY KEY,
  cluster_version_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  bounding_box TEXT NOT NULL,
  source_occurrence_ids TEXT NOT NULL,
  fragments TEXT NOT NULL,
  fragment_count INTEGER NOT NULL,
  raw_signature TEXT NOT NULL,
  normalized_signature TEXT NOT NULL,
  topology TEXT NOT NULL,
  hole_count INTEGER NOT NULL,
  detection_confidence INTEGER NOT NULL,
  detection_basis TEXT NOT NULL,
  exclusion_reasons TEXT NOT NULL,
  match_similarity INTEGER NOT NULL DEFAULT 0,
  match_basis TEXT,
  geometry_differences TEXT NOT NULL DEFAULT '[]',
  review_status TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_pages` (
  `id` text PRIMARY KEY NOT NULL,
  `intake_version_id` text NOT NULL,
  `page_number` integer NOT NULL,
  `width` real,
  `height` real,
  `coordinate_mode` text NOT NULL,
  `classifications` text NOT NULL,
  `text_count` integer NOT NULL,
  `source_review_status` text NOT NULL,
  `review_status` text DEFAULT 'Needs Review' NOT NULL,
  `extraction_method` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `rotation` integer DEFAULT 0 NOT NULL,
  FOREIGN KEY (`intake_version_id`) REFERENCES `drawing_intake_versions`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_quantity_evidence_coverage` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `recognition_version_id` text NOT NULL,
  `coverage_state` text NOT NULL,
  `reason` text NOT NULL,
  `set_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`),
  FOREIGN KEY (`recognition_version_id`) REFERENCES `drawing_symbol_recognition_versions`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_recognition_legend_contexts` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`id`),
  `target_document_id` text NOT NULL REFERENCES `documents`(`id`),
  `source_document_id` text NOT NULL REFERENCES `documents`(`id`),
  `source_document_version_id` text,
  `approved_geometry_version_id` text NOT NULL REFERENCES `drawing_legend_geometry_approved_versions`(`id`),
  `reason` text NOT NULL,
  `created_by` text NOT NULL,
  `superseded_at` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_search_entries` (
  `id` text PRIMARY KEY NOT NULL,
  `intake_version_id` text NOT NULL,
  `page_id` text NOT NULL,
  `page_number` integer NOT NULL,
  `text_content` text NOT NULL,
  `drawing_number` text,
  `sheet_name` text,
  `tags` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`intake_version_id`) REFERENCES `drawing_intake_versions`(`id`),
  FOREIGN KEY (`page_id`) REFERENCES `drawing_pages`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_structure_approved_audit_events` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  approved_version_id TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(approved_version_id) REFERENCES drawing_structure_approved_versions(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_structure_approved_rows` (
  id TEXT PRIMARY KEY,
  approved_version_id TEXT NOT NULL,
  review_case_id TEXT NOT NULL,
  source_legend_row_id TEXT NOT NULL,
  source_page INTEGER NOT NULL,
  source_row INTEGER NOT NULL,
  symbol_geometry TEXT NOT NULL,
  abbreviation TEXT,
  description TEXT,
  notes TEXT,
  bounding_box TEXT,
  structural_confidence INTEGER NOT NULL,
  review_actor_id TEXT NOT NULL,
  review_reason TEXT NOT NULL,
  source_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(approved_version_id) REFERENCES drawing_structure_approved_versions(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_structure_approved_versions` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  source_structure_version_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  input_fingerprint TEXT NOT NULL,
  output_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  approved_row_count INTEGER NOT NULL,
  excluded_row_count INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  superseded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(source_structure_version_id) REFERENCES drawing_structure_versions(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_structure_audit_events` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  structure_version_id TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(structure_version_id) REFERENCES drawing_structure_versions(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_structure_cells` (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL,
  row_id TEXT NOT NULL,
  column_id TEXT NOT NULL,
  row_number INTEGER NOT NULL,
  column_number INTEGER NOT NULL,
  bounding_box TEXT NOT NULL,
  raw_content TEXT NOT NULL,
  reconstructed_content TEXT NOT NULL,
  original_fragments TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(table_id) REFERENCES drawing_structure_tables(id),
  FOREIGN KEY(row_id) REFERENCES drawing_structure_rows(id),
  FOREIGN KEY(column_id) REFERENCES drawing_structure_columns(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_structure_columns` (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL,
  column_number INTEGER NOT NULL,
  bounding_box TEXT NOT NULL,
  width REAL NOT NULL,
  header_candidate TEXT,
  confidence INTEGER NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(table_id) REFERENCES drawing_structure_tables(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_structure_headers` (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL,
  column_id TEXT NOT NULL,
  header_type TEXT NOT NULL,
  raw_content TEXT NOT NULL,
  bounding_box TEXT NOT NULL,
  source_fragment_ids TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(table_id) REFERENCES drawing_structure_tables(id),
  FOREIGN KEY(column_id) REFERENCES drawing_structure_columns(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_structure_legend_rows` (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL,
  row_id TEXT NOT NULL,
  source_page INTEGER NOT NULL,
  source_row INTEGER NOT NULL,
  symbol_geometry TEXT NOT NULL,
  abbreviation TEXT,
  description TEXT,
  notes TEXT,
  bounding_box TEXT,
  structural_confidence INTEGER NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_fragment_ids TEXT,
  FOREIGN KEY(table_id) REFERENCES drawing_structure_tables(id),
  FOREIGN KEY(row_id) REFERENCES drawing_structure_rows(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_structure_regions` (
  id TEXT PRIMARY KEY,
  structure_version_id TEXT NOT NULL,
  region_key TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  region_type TEXT NOT NULL,
  bounding_box TEXT NOT NULL,
  raw_content TEXT NOT NULL,
  source_fragments TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  detection_method TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(structure_version_id) REFERENCES drawing_structure_versions(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_structure_review_cases` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  structure_version_id TEXT NOT NULL,
  legend_row_id TEXT NOT NULL,
  parent_case_id TEXT,
  case_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'Needs Review',
  original_snapshot TEXT NOT NULL,
  current_snapshot TEXT NOT NULL,
  adjustments TEXT NOT NULL DEFAULT '[]',
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(structure_version_id) REFERENCES drawing_structure_versions(id),
  FOREIGN KEY(legend_row_id) REFERENCES drawing_structure_legend_rows(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_structure_review_events` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  structure_version_id TEXT NOT NULL,
  review_case_id TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_snapshot TEXT NOT NULL,
  new_snapshot TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  actor_permission TEXT NOT NULL,
  request_id TEXT NOT NULL,
  case_version INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(review_case_id) REFERENCES drawing_structure_review_cases(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_structure_rows` (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL,
  row_number INTEGER NOT NULL,
  bounding_box TEXT,
  structural_confidence INTEGER NOT NULL,
  structural_status TEXT NOT NULL,
  physical_row_count INTEGER NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(table_id) REFERENCES drawing_structure_tables(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_structure_tables` (
  id TEXT PRIMARY KEY,
  structure_version_id TEXT NOT NULL,
  table_key TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  table_type TEXT NOT NULL,
  bounding_box TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  column_count INTEGER NOT NULL,
  detection_confidence INTEGER NOT NULL,
  detection_method TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_region_key TEXT,
  section_title TEXT,
  FOREIGN KEY(structure_version_id) REFERENCES drawing_structure_versions(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_structure_validation_issues` (
  id TEXT PRIMARY KEY,
  structure_version_id TEXT NOT NULL,
  table_id TEXT NOT NULL,
  row_id TEXT,
  column_id TEXT,
  page_number INTEGER NOT NULL,
  issue_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  bounding_box TEXT,
  detail TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Open',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(structure_version_id) REFERENCES drawing_structure_versions(id),
  FOREIGN KEY(table_id) REFERENCES drawing_structure_tables(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_structure_versions` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  document_version_id TEXT NOT NULL,
  drawing_intake_version_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  input_fingerprint TEXT NOT NULL,
  output_fingerprint TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  superseded_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(document_id) REFERENCES documents(id),
  FOREIGN KEY(document_version_id) REFERENCES document_versions(id),
  FOREIGN KEY(drawing_intake_version_id) REFERENCES drawing_intake_versions(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_symbol_cluster_candidates` (
  id TEXT PRIMARY KEY,
  segmentation_version_id TEXT NOT NULL,
  geometry_candidate_id TEXT NOT NULL,
  approved_row_id TEXT NOT NULL,
  cluster_number INTEGER NOT NULL,
  bounding_box TEXT NOT NULL,
  fragments TEXT NOT NULL,
  original_fragments TEXT NOT NULL,
  fragment_count INTEGER NOT NULL,
  geometry_signature TEXT NOT NULL,
  detection_basis TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  exclusion_reason TEXT,
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_symbol_cluster_events` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  segmentation_version_id TEXT NOT NULL,
  cluster_id TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_value TEXT NOT NULL,
  new_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_symbol_definitions` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `recognition_version_id` text NOT NULL,
  `definition_key` text NOT NULL,
  `abbreviation` text,
  `explicit_label` text,
  `description` text,
  `original_abbreviation` text,
  `original_explicit_label` text,
  `original_description` text,
  `source_page` integer NOT NULL,
  `bounding_box` text,
  `shape_signatures` text NOT NULL,
  `confidence` integer NOT NULL,
  `evidence_text` text NOT NULL,
  `extraction_method` text NOT NULL,
  `review_status` text DEFAULT 'Needs Review' NOT NULL,
  `reviewed_by` text,
  `reviewed_at` text,
  `review_reason` text,
  `merged_into_definition_id` text,
  `derived_from_definition_id` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `source_document_id` text,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`),
  FOREIGN KEY (`recognition_version_id`) REFERENCES `drawing_symbol_recognition_versions`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_symbol_occurrence_match_candidates` (
  id TEXT PRIMARY KEY,
  signature_version_id TEXT NOT NULL,
  approved_geometry_link_id TEXT NOT NULL,
  occurrence_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  bounding_box TEXT NOT NULL,
  coordinates TEXT,
  similarity_score INTEGER NOT NULL,
  matching_basis TEXT NOT NULL,
  geometry_differences TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  normalized_signature TEXT NOT NULL,
  raw_signature TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_symbol_occurrence_match_events` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  signature_version_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_value TEXT NOT NULL,
  new_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_symbol_occurrences` (
  `id` text PRIMARY KEY NOT NULL,
  `recognition_version_id` text NOT NULL,
  `definition_id` text,
  `original_definition_id` text,
  `occurrence_key` text NOT NULL,
  `page_number` integer NOT NULL,
  `bounding_box` text NOT NULL,
  `shape_signature` text NOT NULL,
  `nearby_text` text,
  `match_basis` text NOT NULL,
  `confidence` integer NOT NULL,
  `review_status` text DEFAULT 'Needs Review' NOT NULL,
  `source_geometry` text,
  `reviewed_by` text,
  `reviewed_at` text,
  `review_reason` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `score_components` text,
  FOREIGN KEY (`recognition_version_id`) REFERENCES `drawing_symbol_recognition_versions`(`id`),
  FOREIGN KEY (`definition_id`) REFERENCES `drawing_symbol_definitions`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_symbol_recognition_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `document_id` text NOT NULL,
  `document_version_id` text NOT NULL,
  `drawing_intake_version_id` text NOT NULL,
  `version_number` integer NOT NULL,
  `input_fingerprint` text NOT NULL,
  `output_fingerprint` text NOT NULL,
  `engine_version` text NOT NULL,
  `status` text NOT NULL,
  `summary` text NOT NULL,
  `superseded_at` text,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `source_document_id` text,
  `source_legend_geometry_version_id` text,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`),
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`),
  FOREIGN KEY (`document_version_id`) REFERENCES `document_versions`(`id`),
  FOREIGN KEY (`drawing_intake_version_id`) REFERENCES `drawing_intake_versions`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_symbol_review_events` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `recognition_version_id` text NOT NULL,
  `entity_type` text NOT NULL,
  `entity_id` text NOT NULL,
  `action` text NOT NULL,
  `previous_value` text,
  `new_value` text NOT NULL,
  `reason` text NOT NULL,
  `actor_user_id` text NOT NULL,
  `request_id` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`),
  FOREIGN KEY (`recognition_version_id`) REFERENCES `drawing_symbol_recognition_versions`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_symbol_segmentation_versions` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  geometry_version_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  input_fingerprint TEXT NOT NULL,
  output_fingerprint TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_by TEXT NOT NULL,
  superseded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_symbol_signature_versions` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  approved_geometry_version_id TEXT NOT NULL,
  symbol_recognition_version_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  input_fingerprint TEXT NOT NULL,
  output_fingerprint TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  approved_normalized_signature TEXT NOT NULL,
  approved_raw_signature TEXT NOT NULL,
  created_by TEXT NOT NULL,
  superseded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_symbol_source_geometries` (
  `id` text PRIMARY KEY NOT NULL,
  `definition_id` text NOT NULL,
  `shape_signature` text NOT NULL,
  `source_page` integer NOT NULL,
  `bounding_box` text NOT NULL,
  `geometry` text NOT NULL,
  `geometry_fingerprint` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`definition_id`) REFERENCES `drawing_symbol_definitions`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_title_block_field_reviews` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `structure_version_id` text NOT NULL,
  `page_number` integer NOT NULL,
  `field_key` text NOT NULL,
  `value` text,
  `status` text NOT NULL,
  `reason` text NOT NULL,
  `reviewed_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`),
  FOREIGN KEY (`structure_version_id`) REFERENCES `drawing_structure_versions`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `drawing_visual_runs` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  document_version_id TEXT NOT NULL,
  intake_version_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  input_manifest TEXT NOT NULL,
  model_info TEXT NOT NULL DEFAULT '{}',
  raw_responses TEXT NOT NULL DEFAULT '[]',
  result TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  superseded_at TEXT,
  FOREIGN KEY(document_id) REFERENCES documents(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `engineering_attribute_definitions` (
  `id` text PRIMARY KEY NOT NULL,
  `taxonomy_term_id` text,
  `canonical_name` text NOT NULL,
  `display_name` text NOT NULL,
  `engineering_domain` text,
  `applicable_categories` text DEFAULT '[]' NOT NULL,
  `data_type` text NOT NULL,
  `unit_family` text,
  `allowed_units` text DEFAULT '[]' NOT NULL,
  `allowed_values` text DEFAULT '[]' NOT NULL,
  `comparison_method` text NOT NULL,
  `normalization_rules` text DEFAULT '{}' NOT NULL,
  `synonyms` text DEFAULT '[]' NOT NULL,
  `validation_rules` text DEFAULT '{}' NOT NULL,
  `version_number` integer DEFAULT 1 NOT NULL,
  `status` text DEFAULT 'Active' NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`taxonomy_term_id`) REFERENCES `engineering_taxonomy_terms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `engineering_classification_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `classification_version_id` text NOT NULL,
  `classification_type` text NOT NULL,
  `value` text,
  `classification_status` text NOT NULL,
  `supporting_fact_ids` text NOT NULL,
  `evidence` text NOT NULL,
  `basis` text NOT NULL,
  `confidence` integer NOT NULL,
  `review_status` text DEFAULT 'Needs Review' NOT NULL,
  `reviewed_by` text,
  `reviewed_at` text,
  `review_reason` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`classification_version_id`) REFERENCES `engineering_classification_versions`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `engineering_classification_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `boq_item_id` text NOT NULL,
  `requirement_profile_version_id` text NOT NULL,
  `version_number` integer NOT NULL,
  `input_fingerprint` text NOT NULL,
  `output_fingerprint` text NOT NULL,
  `engine_version` text NOT NULL,
  `completeness` integer NOT NULL,
  `matching_readiness` text NOT NULL,
  `blocking_missing_information` text NOT NULL,
  `missing_evidence` text NOT NULL,
  `technical_risks` text NOT NULL,
  `engineering_questions` text NOT NULL,
  `required_human_decisions` text NOT NULL,
  `review_status` text DEFAULT 'Needs Review' NOT NULL,
  `approved_for_matching` integer DEFAULT 0 NOT NULL,
  `superseded_at` text,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`),
  FOREIGN KEY (`boq_item_id`) REFERENCES `boq_items`(`id`),
  FOREIGN KEY (`requirement_profile_version_id`) REFERENCES `requirement_profile_versions`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `engineering_discovery_audit_events` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `run_id` text NOT NULL,
  `action` text NOT NULL,
  `previous_value` text,
  `new_value` text NOT NULL,
  `reason` text NOT NULL,
  `actor_user_id` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`),
  FOREIGN KEY (`run_id`) REFERENCES `engineering_discovery_runs`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `engineering_discovery_clarifications` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `question` text NOT NULL,
  `reason` text NOT NULL,
  `evidence_searched` text NOT NULL,
  `missing_engineering_fact` text NOT NULL,
  `matching_impact` text NOT NULL,
  `pricing_impact` text NOT NULL,
  `technical_approval_impact` text NOT NULL,
  `status` text NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `engineering_discovery_runs`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `engineering_discovery_conflicts` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `conflict_type` text NOT NULL,
  `fact_type` text NOT NULL,
  `evidence_sets` text NOT NULL,
  `confidence` integer NOT NULL,
  `required_clarification` text NOT NULL,
  `review_status` text NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `engineering_discovery_runs`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `engineering_discovery_facts` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `fact_type` text NOT NULL,
  `value` text NOT NULL,
  `normalized_value` text NOT NULL,
  `confidence` integer NOT NULL,
  `supporting_sources` integer NOT NULL,
  `conflicting_sources` integer NOT NULL,
  `evidence_strength` text NOT NULL,
  `evidence` text NOT NULL,
  `review_status` text NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `engineering_discovery_runs`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `engineering_discovery_gaps` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `fact_type` text NOT NULL,
  `confidence` integer NOT NULL,
  `reason` text NOT NULL,
  `evidence_searched` text NOT NULL,
  `matching_impact` text NOT NULL,
  `pricing_impact` text NOT NULL,
  `approval_impact` text NOT NULL,
  `status` text NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `engineering_discovery_runs`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `engineering_discovery_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `version_number` integer NOT NULL,
  `input_fingerprint` text NOT NULL,
  `output_fingerprint` text NOT NULL,
  `engine_version` text NOT NULL,
  `source_count` integer NOT NULL,
  `observation_count` integer NOT NULL,
  `status` text NOT NULL,
  `exhaustive` integer DEFAULT 0 NOT NULL,
  `superseded_at` text,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `engineering_discovery_sources` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `source_id` text NOT NULL,
  `source_type` text NOT NULL,
  `source_file` text,
  `document_id` text,
  `checksum` text,
  `status` text NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `engineering_discovery_runs`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `engineering_fact_provenance` (
  `id` text PRIMARY KEY NOT NULL,
  `fact_id` text NOT NULL,
  `source_type` text NOT NULL,
  `source_id` text NOT NULL,
  `evidence_id` text,
  `document_id` text,
  `document_version_id` text,
  `extraction_version_id` text,
  `page` integer,
  `page_to` integer,
  `sheet` text,
  `section` text,
  `clause` text,
  `row_number` integer,
  `cell` text,
  `bounding_box` text,
  `original_text` text,
  `extraction_method` text,
  `parser_version` text,
  `model_version` text,
  `prompt_version` text,
  `rule_version` text,
  `confidence` integer NOT NULL,
  `user_id` text,
  `user_role` text,
  `human_reason` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`fact_id`) REFERENCES `engineering_facts`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`document_version_id`) REFERENCES `document_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `engineering_facts` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text,
  `entity_type` text NOT NULL,
  `entity_id` text NOT NULL,
  `predicate` text NOT NULL,
  `value` text NOT NULL,
  `data_type` text NOT NULL,
  `operator` text NOT NULL,
  `fact_type` text NOT NULL,
  `scope_type` text NOT NULL,
  `scope_id` text,
  `source_fact_id` text,
  `derivation` text,
  `status` text NOT NULL,
  `confidence` integer NOT NULL,
  `version_number` integer DEFAULT 1 NOT NULL,
  `effective_from` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `effective_to` text,
  `previous_version_id` text,
  `superseded_by_id` text,
  `change_reason` text,
  `changed_by` text,
  `model_version` text NOT NULL,
  `deleted_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `engineering_graph_audit_events` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `graph_version_id` text NOT NULL,
  `entity_type` text NOT NULL,
  `entity_id` text NOT NULL,
  `action` text NOT NULL,
  `previous_value` text,
  `new_value` text NOT NULL,
  `reason` text NOT NULL,
  `evidence` text NOT NULL,
  `actor_user_id` text NOT NULL,
  `actor_role` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`),
  FOREIGN KEY (`graph_version_id`) REFERENCES `engineering_graph_versions`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `engineering_graph_nodes` (
  `id` text PRIMARY KEY NOT NULL,
  `graph_version_id` text NOT NULL,
  `node_key` text NOT NULL,
  `node_type` text NOT NULL,
  `label` text NOT NULL,
  `properties` text NOT NULL,
  `provenance` text NOT NULL,
  `review_status` text DEFAULT 'Needs Review' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`graph_version_id`) REFERENCES `engineering_graph_versions`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `engineering_graph_relationships` (
  `id` text PRIMARY KEY NOT NULL,
  `graph_version_id` text NOT NULL,
  `from_node_id` text NOT NULL,
  `to_node_id` text NOT NULL,
  `relationship_type` text NOT NULL,
  `confidence` integer NOT NULL,
  `provenance` text NOT NULL,
  `basis` text NOT NULL,
  `review_status` text DEFAULT 'Needs Review' NOT NULL,
  `reviewed_by` text,
  `reviewed_at` text,
  `review_reason` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`graph_version_id`) REFERENCES `engineering_graph_versions`(`id`),
  FOREIGN KEY (`from_node_id`) REFERENCES `engineering_graph_nodes`(`id`),
  FOREIGN KEY (`to_node_id`) REFERENCES `engineering_graph_nodes`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `engineering_graph_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `boq_item_id` text NOT NULL,
  `requirement_profile_version_id` text NOT NULL,
  `classification_version_id` text NOT NULL,
  `version_number` integer NOT NULL,
  `input_fingerprint` text NOT NULL,
  `output_fingerprint` text NOT NULL,
  `engine_version` text NOT NULL,
  `missing_relationships` text NOT NULL,
  `conflicts` text NOT NULL,
  `engineering_risks` text NOT NULL,
  `superseded_at` text,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`),
  FOREIGN KEY (`boq_item_id`) REFERENCES `boq_items`(`id`),
  FOREIGN KEY (`requirement_profile_version_id`) REFERENCES `requirement_profile_versions`(`id`),
  FOREIGN KEY (`classification_version_id`) REFERENCES `engineering_classification_versions`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `engineering_knowledge_conflicts` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text,
  `conflict_type` text NOT NULL,
  `left_entity_type` text NOT NULL,
  `left_entity_id` text NOT NULL,
  `right_entity_type` text NOT NULL,
  `right_entity_id` text NOT NULL,
  `left_value` text,
  `right_value` text,
  `severity` text NOT NULL,
  `impact` text NOT NULL,
  `blocking` integer DEFAULT true NOT NULL,
  `resolution_status` text DEFAULT 'Open' NOT NULL,
  `resolution_decision_id` text,
  `evidence` text DEFAULT '[]' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `resolved_at` text,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`resolution_decision_id`) REFERENCES `engineering_knowledge_decisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `engineering_knowledge_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text,
  `entity_type` text NOT NULL,
  `entity_id` text NOT NULL,
  `action` text NOT NULL,
  `previous_value` text,
  `new_value` text,
  `reason` text NOT NULL,
  `evidence` text,
  `scope_type` text NOT NULL,
  `scope_id` text,
  `reversible` integer DEFAULT true NOT NULL,
  `reverses_decision_id` text,
  `decided_by` text NOT NULL,
  `decided_role` text NOT NULL,
  `decided_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `engineering_relationships` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text,
  `left_entity_type` text NOT NULL,
  `left_entity_id` text NOT NULL,
  `relationship_type` text NOT NULL,
  `right_entity_type` text NOT NULL,
  `right_entity_id` text NOT NULL,
  `conditions` text DEFAULT '[]' NOT NULL,
  `exceptions` text DEFAULT '[]' NOT NULL,
  `quantity_rule` text,
  `fact_type` text NOT NULL,
  `scope_type` text NOT NULL,
  `scope_id` text,
  `provenance_fact_id` text,
  `confidence` integer NOT NULL,
  `status` text NOT NULL,
  `version_number` integer DEFAULT 1 NOT NULL,
  `effective_from` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `effective_to` text,
  `reviewed_by` text,
  `reviewed_at` text,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`provenance_fact_id`) REFERENCES `engineering_facts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `engineering_standard_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `standard_id` text NOT NULL,
  `edition` text,
  `year` text,
  `effective_from` text,
  `effective_to` text,
  `previous_version_id` text,
  `status` text DEFAULT 'Active' NOT NULL,
  `source_evidence_id` text,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`standard_id`) REFERENCES `engineering_standards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `engineering_standards` (
  `id` text PRIMARY KEY NOT NULL,
  `body_id` text NOT NULL,
  `number` text NOT NULL,
  `title` text,
  `current_version_id` text,
  `status` text DEFAULT 'Active' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`body_id`) REFERENCES `standards_bodies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `engineering_taxonomy_terms` (
  `id` text PRIMARY KEY NOT NULL,
  `parent_id` text,
  `term_type` text NOT NULL,
  `canonical_name` text NOT NULL,
  `display_name` text NOT NULL,
  `code` text,
  `synonyms` text DEFAULT '[]' NOT NULL,
  `scope_type` text DEFAULT 'Global' NOT NULL,
  `scope_id` text,
  `version_number` integer DEFAULT 1 NOT NULL,
  `status` text DEFAULT 'Active' NOT NULL,
  `effective_from` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `effective_to` text,
  `previous_version_id` text,
  `superseded_by_id` text,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `deleted_at` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `engineering_unit_definitions` (
  `id` text PRIMARY KEY NOT NULL,
  `code` text NOT NULL,
  `display_name` text NOT NULL,
  `family` text NOT NULL,
  `canonical_unit_id` text,
  `conversion_factor` text DEFAULT '1' NOT NULL,
  `conversion_offset` text DEFAULT '0' NOT NULL,
  `precision` integer DEFAULT 6 NOT NULL,
  `aliases` text DEFAULT '[]' NOT NULL,
  `status` text DEFAULT 'Active' NOT NULL,
  `version_number` integer DEFAULT 1 NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `estimator_item_interpretations` (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES estimator_understanding_runs(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  boq_item_id TEXT NOT NULL REFERENCES boq_items(id),
  version_number INTEGER NOT NULL,
  input_fingerprint TEXT NOT NULL,
  config_fingerprint TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  model_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  status TEXT NOT NULL,
  raw_response TEXT,
  validated_interpretation TEXT,
  error_code TEXT,
  error_message TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(boq_item_id, version_number),
  UNIQUE(boq_item_id, input_fingerprint, config_fingerprint)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `estimator_understanding_review_events` (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  boq_item_id TEXT NOT NULL REFERENCES boq_items(id),
  interpretation_id TEXT NOT NULL REFERENCES estimator_item_interpretations(id),
  review_version_id TEXT NOT NULL REFERENCES estimator_understanding_review_versions(id),
  action TEXT NOT NULL CHECK (action IN ('APPROVE_INTERPRETATION','EDIT_AND_APPROVE','REJECT_INTERPRETATION','RETURN_TO_REVIEW')),
  previous_status TEXT,
  new_status TEXT NOT NULL,
  reason TEXT,
  actor_user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, request_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `estimator_understanding_review_versions` (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  boq_item_id TEXT NOT NULL REFERENCES boq_items(id),
  interpretation_id TEXT NOT NULL REFERENCES estimator_item_interpretations(id),
  version_number INTEGER NOT NULL,
  review_status TEXT NOT NULL CHECK (review_status IN ('AWAITING_REVIEW','APPROVED','REJECTED')),
  canonical_interpretation TEXT NOT NULL,
  source_input_fingerprint TEXT NOT NULL,
  source_document_version_id TEXT NOT NULL REFERENCES document_versions(id),
  source_extraction_version INTEGER NOT NULL,
  review_reason TEXT,
  reviewed_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (boq_item_id, version_number)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `estimator_understanding_runs` (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  model_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  config_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  total_items INTEGER NOT NULL DEFAULT 0,
  processed_items INTEGER NOT NULL DEFAULT 0,
  successful_items INTEGER NOT NULL DEFAULT 0,
  review_items INTEGER NOT NULL DEFAULT 0,
  failed_items INTEGER NOT NULL DEFAULT 0,
  requested_by TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  run_mode TEXT NOT NULL DEFAULT 'CONTROLLED_PILOT',
  parent_run_id TEXT REFERENCES estimator_understanding_runs(id),
  authorization_fingerprint TEXT
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `excel_export_audit_log` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `export_job_id` text,
  `action` text NOT NULL,
  `stage` text NOT NULL,
  `previous_value` text,
  `new_value` text,
  `reason` text NOT NULL,
  `actor_user_id` text NOT NULL,
  `actor_role` text NOT NULL,
  `request_id` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`export_job_id`) REFERENCES `excel_export_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `excel_export_files` (
  `id` text PRIMARY KEY NOT NULL,
  `export_job_id` text NOT NULL,
  `project_id` text NOT NULL,
  `object_key` text NOT NULL,
  `filename` text NOT NULL,
  `mime_type` text NOT NULL,
  `byte_size` integer NOT NULL,
  `sha256` text NOT NULL,
  `download_count` integer DEFAULT 0 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `last_downloaded_at` text,
  `deleted_at` text,
  FOREIGN KEY (`export_job_id`) REFERENCES `excel_export_jobs`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `excel_export_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `template_id` text NOT NULL,
  `export_mode` text NOT NULL,
  `revision` integer NOT NULL,
  `filename` text NOT NULL,
  `status` text NOT NULL,
  `stage` text NOT NULL,
  `progress` integer DEFAULT 0 NOT NULL,
  `locked_versions` text NOT NULL,
  `sheet_set` text NOT NULL,
  `configuration` text NOT NULL,
  `warning_count` integer DEFAULT 0 NOT NULL,
  `blocking_issue_count` integer DEFAULT 0 NOT NULL,
  `data_hash` text,
  `idempotency_key` text NOT NULL,
  `requested_by` text NOT NULL,
  `requested_role` text NOT NULL,
  `requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `started_at` text,
  `completed_at` text,
  `failed_at` text,
  `error_code` text,
  `error_message` text,
  `technical_details` text,
  `suggested_action` text,
  `superseded_by_id` text,
  `cancelled_at` text,
  `expires_at` text,
  quotation_revision_id TEXT REFERENCES project_quotation_revisions(id),
  quotation_fingerprint TEXT,
  evidence_fingerprint TEXT,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`template_id`) REFERENCES `export_templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `excel_export_reconciliations` (
  `id` text PRIMARY KEY NOT NULL,
  `export_job_id` text NOT NULL,
  `server_totals` text NOT NULL,
  `workbook_totals` text NOT NULL,
  `differences` text NOT NULL,
  `tolerance` text NOT NULL,
  `status` text NOT NULL,
  `failed_fields` text NOT NULL,
  `reconciled_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`export_job_id`) REFERENCES `excel_export_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `export_template_mappings` (
  `id` text PRIMARY KEY NOT NULL,
  `template_id` text NOT NULL,
  `sheet_name` text NOT NULL,
  `target` text NOT NULL,
  `canonical_field` text NOT NULL,
  `format` text,
  `formula` text,
  `required` integer DEFAULT false NOT NULL,
  `default_value` text,
  `visibility_rule` text,
  `export_modes` text NOT NULL,
  `validation` text NOT NULL,
  `sequence` integer NOT NULL,
  FOREIGN KEY (`template_id`) REFERENCES `export_templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `export_templates` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text,
  `name` text NOT NULL,
  `version` text NOT NULL,
  `status` text NOT NULL,
  `supported_modes` text NOT NULL,
  `sheet_configuration` text NOT NULL,
  `branding` text NOT NULL,
  `formula_strategy` text NOT NULL,
  `mapping_version` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `superseded_at` text,
  `deleted_at` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `governed_identity_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `decision_type` text NOT NULL CHECK (`decision_type` IN ('Apply','Reverse')),
  `proposal_id` text NOT NULL,
  `review_id` text,
  `conflict_id` text NOT NULL,
  `canonical_product_id` text NOT NULL,
  `non_target_product_id` text NOT NULL,
  `status` text NOT NULL CHECK (`status` IN ('Applied','Reversed')),
  `reversal_of_id` text,
  `ruleset_version_id` text NOT NULL,
  `ruleset_checksum` text NOT NULL,
  `proposal_fingerprint` text NOT NULL,
  `proposal_version` integer NOT NULL,
  `conflict_version_before` integer NOT NULL,
  `target_version_before` integer NOT NULL,
  `non_target_version_before` integer NOT NULL,
  `previous_snapshot_json` text NOT NULL,
  `new_snapshot_json` text NOT NULL,
  `reference_move_manifest_json` text NOT NULL,
  `reason` text NOT NULL,
  `actor_id` text NOT NULL,
  `actor_role` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  application_cycle integer,
  `library_scope` text NOT NULL DEFAULT 'Global Library',
  `organization_id` text REFERENCES `organizations`(`id`),
  `library_project_id` text REFERENCES `projects`(`id`),
  `request_fingerprint` text,
  `manifest_checksum` text,
  `manifest_row_count` integer,
  `manifest_ownership_checksum` text,
  `manifest_table_checksum` text,
  FOREIGN KEY (`proposal_id`) REFERENCES `identity_resolution_proposals`(`id`),
  FOREIGN KEY (`review_id`) REFERENCES `identity_proposal_reviews`(`id`),
  FOREIGN KEY (`conflict_id`) REFERENCES `product_conflicts`(`id`),
  FOREIGN KEY (`canonical_product_id`) REFERENCES `library_products`(`id`),
  FOREIGN KEY (`non_target_product_id`) REFERENCES `library_products`(`id`),
  FOREIGN KEY (`reversal_of_id`) REFERENCES `governed_identity_decisions`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `historical_boq_alignments` (
  id TEXT PRIMARY KEY,
  historical_project_id TEXT NOT NULL REFERENCES historical_boq_projects(id),
  source_row_id TEXT REFERENCES historical_boq_rows(id),
  final_row_id TEXT REFERENCES historical_boq_final_rows(id),
  outcome TEXT NOT NULL,
  alignment_method TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  evidence TEXT NOT NULL,
  eligible_for_learning INTEGER NOT NULL DEFAULT 0,
  reviewer_status TEXT NOT NULL DEFAULT 'Needs Review',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `historical_boq_audit_log` (
  id TEXT PRIMARY KEY,
  historical_project_id TEXT NOT NULL REFERENCES historical_boq_projects(id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `historical_boq_decisions` (
  id TEXT PRIMARY KEY,
  historical_project_id TEXT NOT NULL REFERENCES historical_boq_projects(id),
  alignment_id TEXT NOT NULL REFERENCES historical_boq_alignments(id),
  source_state TEXT NOT NULL,
  final_state TEXT NOT NULL,
  governance TEXT NOT NULL,
  eligible_for_boq_learning INTEGER NOT NULL DEFAULT 0,
  eligible_for_product_learning INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  audit_history TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `historical_boq_files` (
  id TEXT PRIMARY KEY,
  historical_project_id TEXT NOT NULL REFERENCES historical_boq_projects(id),
  path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  extension TEXT,
  sheet_names TEXT NOT NULL,
  file_role TEXT NOT NULL,
  source_or_output TEXT NOT NULL,
  revision TEXT,
  role_evidence TEXT NOT NULL,
  role_confidence INTEGER NOT NULL,
  human_review_required INTEGER NOT NULL DEFAULT 1,
  readability TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checksum TEXT NOT NULL,
  UNIQUE(historical_project_id, checksum, path)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `historical_boq_final_rows` (
  id TEXT PRIMARY KEY,
  historical_project_id TEXT NOT NULL REFERENCES historical_boq_projects(id),
  file_id TEXT NOT NULL REFERENCES historical_boq_files(id),
  page_number INTEGER,
  final_row_reference TEXT,
  final_row_type TEXT NOT NULL,
  final_description TEXT,
  final_unit TEXT,
  final_quantity TEXT,
  final_discipline TEXT,
  final_system TEXT,
  final_category TEXT,
  assembly_component TEXT,
  split_merge_decision TEXT,
  exclusion_decision TEXT,
  manufacturer TEXT,
  part_number TEXT,
  accessories TEXT,
  engineer_notes TEXT,
  approval_status TEXT,
  source_provenance TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `historical_boq_pattern_sources` (
  id TEXT PRIMARY KEY,
  pattern_id TEXT NOT NULL REFERENCES historical_boq_patterns(id),
  historical_project_id TEXT NOT NULL REFERENCES historical_boq_projects(id),
  source_row_id TEXT REFERENCES historical_boq_rows(id),
  evidence TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `historical_boq_patterns` (
  id TEXT PRIMARY KEY,
  pattern_type TEXT NOT NULL,
  discipline_scope TEXT NOT NULL,
  layout_signature TEXT NOT NULL,
  trigger_conditions TEXT NOT NULL,
  example_source_rows TEXT NOT NULL,
  expected_behavior TEXT NOT NULL,
  supporting_evidence_count INTEGER NOT NULL,
  confidence INTEGER NOT NULL,
  human_review_status TEXT NOT NULL DEFAULT 'Needs Review',
  scope_status TEXT NOT NULL,
  active_status TEXT NOT NULL DEFAULT 'Inactive',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_validation_date TEXT
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `historical_boq_projects` (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  name TEXT NOT NULL,
  client TEXT,
  disciplines TEXT NOT NULL,
  project_date TEXT,
  project_status TEXT NOT NULL,
  learning_pair_status TEXT NOT NULL,
  completion_evidence TEXT NOT NULL,
  source_root TEXT NOT NULL,
  dataset_version INTEGER NOT NULL DEFAULT 1,
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `historical_boq_rows` (
  id TEXT PRIMARY KEY,
  historical_project_id TEXT NOT NULL REFERENCES historical_boq_projects(id),
  file_id TEXT NOT NULL REFERENCES historical_boq_files(id),
  sheet_name TEXT NOT NULL,
  row_number INTEGER NOT NULL,
  item_number TEXT,
  section_path TEXT,
  original_cells TEXT NOT NULL,
  original_description TEXT,
  original_unit TEXT,
  original_quantity TEXT,
  formulae TEXT NOT NULL,
  discipline TEXT,
  system TEXT,
  location TEXT,
  row_formatting TEXT NOT NULL,
  merged_context TEXT NOT NULL,
  hidden_row INTEGER NOT NULL DEFAULT 0,
  row_type TEXT NOT NULL,
  classification_reason TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  source_provenance TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(file_id,sheet_name,row_number)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `historical_boq_validation_runs` (
  id TEXT PRIMARY KEY,
  historical_project_id TEXT NOT NULL REFERENCES historical_boq_projects(id),
  validation_type TEXT NOT NULL,
  status TEXT NOT NULL,
  metrics TEXT NOT NULL,
  ground_truth_basis TEXT NOT NULL,
  blockers TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `identity_decision_audit` (
  `id` text PRIMARY KEY NOT NULL,
  `entity_type` text NOT NULL,
  `entity_id` text NOT NULL,
  `action` text NOT NULL,
  `actor_id` text NOT NULL,
  `actor_role` text NOT NULL,
  `reason` text NOT NULL,
  `previous_snapshot_json` text NOT NULL,
  `new_snapshot_json` text NOT NULL,
  `ruleset_checksum` text,
  `proposal_fingerprint` text,
  `idempotency_key` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `library_scope` text NOT NULL DEFAULT 'Global Library',
  `organization_id` text REFERENCES `organizations`(`id`),
  `library_project_id` text REFERENCES `projects`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `identity_dependency_providers` (
  `provider_id` text PRIMARY KEY NOT NULL,
  `module_name` text NOT NULL,
  `table_name` text NOT NULL,
  `product_column` text,
  `candidate_table` text,
  `candidate_column` text,
  `strategy` text NOT NULL CHECK (`strategy` IN ('DIRECT','VIA_CANDIDATE','VIA_PRICING_LINE')),
  `enabled` integer NOT NULL DEFAULT 1,
  `registry_version` integer NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `identity_mutation_failures` (
  `id` text PRIMARY KEY NOT NULL,
  `operation` text NOT NULL,
  `entity_id` text NOT NULL,
  `error_code` text NOT NULL,
  `expected_lock_json` text NOT NULL,
  `actual_lock_json` text NOT NULL,
  `actor_id` text NOT NULL,
  `request_fingerprint` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `identity_mutation_guards` (
  `id` text PRIMARY KEY NOT NULL,
  `operation` text NOT NULL CHECK (`operation` IN ('Review','Apply','Reverse')),
  `proposal_id` text NOT NULL,
  `proposal_version` integer NOT NULL,
  `proposal_fingerprint` text NOT NULL,
  `ruleset_version_id` text NOT NULL,
  `ruleset_checksum` text NOT NULL,
  `review_id` text,
  `conflict_id` text NOT NULL,
  `conflict_version` integer NOT NULL,
  `conflict_status` text NOT NULL,
  `target_product_id` text NOT NULL,
  `target_version` integer NOT NULL,
  `target_status` text NOT NULL,
  `non_target_product_id` text NOT NULL,
  `non_target_version` integer NOT NULL,
  `non_target_status` text NOT NULL,
  `library_scope` text NOT NULL,
  `organization_id` text,
  `library_project_id` text,
  `reference_owner_product_id` text NOT NULL,
  `expected_evidence_count` integer NOT NULL,
  `expected_price_count` integer NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `identity_proposal_reviews` (
  `id` text PRIMARY KEY NOT NULL,
  `proposal_id` text NOT NULL,
  `decision` text NOT NULL CHECK (`decision` IN ('Approve for Application','Reject','Request Evidence')),
  `reason` text NOT NULL,
  `proposal_version` integer NOT NULL,
  `proposal_fingerprint` text NOT NULL,
  `ruleset_version_id` text NOT NULL,
  `ruleset_checksum` text NOT NULL,
  `conflict_id` text NOT NULL,
  `conflict_version` integer NOT NULL,
  `product_versions_json` text NOT NULL,
  `canonical_product_id` text NOT NULL,
  `revalidation_fingerprint` text NOT NULL,
  `reviewed_by` text NOT NULL,
  `reviewed_role` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `library_scope` text NOT NULL DEFAULT 'Global Library',
  `organization_id` text REFERENCES `organizations`(`id`),
  `library_project_id` text REFERENCES `projects`(`id`),
  `request_fingerprint` text,
  FOREIGN KEY (`proposal_id`) REFERENCES `identity_resolution_proposals`(`id`),
  FOREIGN KEY (`ruleset_version_id`) REFERENCES `identity_ruleset_versions`(`id`),
  FOREIGN KEY (`conflict_id`) REFERENCES `product_conflicts`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `identity_reference_guards` (
  `guard_id` text NOT NULL,
  `table_name` text NOT NULL,
  `record_id` text NOT NULL,
  `expected_owner_product_id` text NOT NULL,
  `expected_version` integer NOT NULL,
  PRIMARY KEY (`guard_id`,`table_name`,`record_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `identity_reference_moves` (
  `id` text PRIMARY KEY NOT NULL,
  `decision_id` text NOT NULL,
  `table_name` text NOT NULL CHECK (`table_name` IN ('product_source_evidence','price_records')),
  `record_id` text NOT NULL,
  `from_product_id` text NOT NULL,
  `to_product_id` text NOT NULL,
  `record_snapshot_json` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `library_scope` text NOT NULL DEFAULT 'Global Library',
  `organization_id` text REFERENCES `organizations`(`id`),
  `library_project_id` text REFERENCES `projects`(`id`),
  FOREIGN KEY (`decision_id`) REFERENCES `governed_identity_decisions`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `identity_resolution_candidates` (
  `id` text PRIMARY KEY NOT NULL,
  `case_id` text NOT NULL,
  `product_id` text NOT NULL,
  `retrieval_method` text NOT NULL,
  `snapshot_json` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `library_scope` text NOT NULL DEFAULT 'Global Library',
  `organization_id` text REFERENCES `organizations`(`id`),
  `library_project_id` text REFERENCES `projects`(`id`),
  FOREIGN KEY (`case_id`) REFERENCES `identity_resolution_cases`(`id`),
  FOREIGN KEY (`product_id`) REFERENCES `library_products`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `identity_resolution_cases` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `conflict_id` text NOT NULL,
  `input_snapshot_json` text NOT NULL,
  `status` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `library_scope` text NOT NULL DEFAULT 'Global Library',
  `organization_id` text REFERENCES `organizations`(`id`),
  `library_project_id` text REFERENCES `projects`(`id`),
  FOREIGN KEY (`run_id`) REFERENCES `identity_resolution_runs`(`id`),
  FOREIGN KEY (`conflict_id`) REFERENCES `product_conflicts`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `identity_resolution_proposals` (
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
  `version_number` integer NOT NULL DEFAULT 1,
  `library_scope` text NOT NULL DEFAULT 'Global Library',
  `organization_id` text REFERENCES `organizations`(`id`),
  `library_project_id` text REFERENCES `projects`(`id`),
  `executable_ruleset_checksum` text,
  FOREIGN KEY (`case_id`) REFERENCES `identity_resolution_cases`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `identity_resolution_rule_traces` (
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `identity_resolution_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `ruleset_version_id` text NOT NULL,
  `mode` text NOT NULL CHECK (`mode` IN ('Analysis')),
  `input_fingerprint` text NOT NULL,
  `status` text NOT NULL,
  `started_by` text NOT NULL,
  `started_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` text,
  `summary_json` text NOT NULL DEFAULT '{}',
  `library_scope` text NOT NULL DEFAULT 'Global Library',
  `organization_id` text REFERENCES `organizations`(`id`),
  `library_project_id` text REFERENCES `projects`(`id`),
  FOREIGN KEY (`ruleset_version_id`) REFERENCES `identity_ruleset_versions`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `identity_ruleset_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `semantic_version` text NOT NULL,
  `checksum` text NOT NULL,
  `status` text NOT NULL,
  `rules_json` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `behavior_version` text,
  `executable_checksum` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `identity_schema_compatibility` (
  `component` text PRIMARY KEY NOT NULL,
  `schema_version` integer NOT NULL,
  `minimum_worker_version` integer NOT NULL,
  `maximum_worker_version` integer NOT NULL,
  `environment` text NOT NULL DEFAULT 'Any',
  `migration_checksum` text NOT NULL,
  `rollback_verification` text NOT NULL,
  `installed_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `knowledge_facts` (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  knowledge_file_id TEXT NOT NULL REFERENCES knowledge_files(id),
  fact_type TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  original_value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  attributes TEXT NOT NULL DEFAULT '{}',
  confidence INTEGER NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'Learned',
  source_location TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(knowledge_file_id,fact_type,fact_key,normalized_value)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `knowledge_file_events` (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  knowledge_file_id TEXT NOT NULL REFERENCES knowledge_files(id),
  event_type TEXT NOT NULL,
  details TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `knowledge_files` (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  extension TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  object_key TEXT NOT NULL,
  detected_type TEXT NOT NULL,
  secondary_types TEXT NOT NULL DEFAULT '[]',
  classification_confidence INTEGER NOT NULL,
  classification_status TEXT NOT NULL,
  processing_status TEXT NOT NULL,
  extraction_method TEXT,
  extraction_version TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '{}',
  uploaded_by TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  UNIQUE(organization_id,sha256)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `knowledge_product_links` (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  knowledge_fact_id TEXT NOT NULL REFERENCES knowledge_facts(id),
  part_number TEXT NOT NULL,
  existing_product_id TEXT,
  link_state TEXT NOT NULL,
  new_information TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(knowledge_fact_id,part_number)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `knowledge_promotions` (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  knowledge_fact_id TEXT NOT NULL REFERENCES knowledge_facts(id),
  knowledge_file_id TEXT NOT NULL REFERENCES knowledge_files(id),
  canonical_product_id TEXT NOT NULL REFERENCES library_products(id),
  canonical_entity_type TEXT NOT NULL,
  canonical_entity_id TEXT NOT NULL,
  product_source_id TEXT NOT NULL REFERENCES product_sources(id),
  action TEXT NOT NULL CHECK(action IN ('Promoted','Evidence Only')),
  policy_version TEXT NOT NULL,
  source_checksum TEXT NOT NULL,
  previous_snapshot_json TEXT NOT NULL,
  new_snapshot_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  decided_by TEXT NOT NULL,
  decided_role TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,idempotency_key),
  UNIQUE(organization_id,knowledge_fact_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `library_permission_grants` (
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `library_processing_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `source_id` text,
  `kind` text NOT NULL,
  `stage` text NOT NULL,
  `status` text NOT NULL,
  `progress` integer NOT NULL DEFAULT 0,
  `attempt` integer NOT NULL DEFAULT 0,
  `max_attempts` integer NOT NULL DEFAULT 3,
  `timeout_ms` integer NOT NULL,
  `cancel_requested` integer NOT NULL DEFAULT 0,
  `parser_version` text NOT NULL,
  `model_version` text NOT NULL,
  `prompt_version` text NOT NULL,
  `rule_version` text NOT NULL,
  `input_fingerprint` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `logs_json` text NOT NULL DEFAULT '[]',
  `error_json` text,
  `created_by` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `started_at` text,
  `completed_at` text,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `library_products` (
  `id` text PRIMARY KEY NOT NULL,
  `manufacturer_id` text NOT NULL,
  `brand_id` text,
  `family_id` text,
  `part_number` text NOT NULL,
  `normalized_part_number` text NOT NULL,
  `description` text NOT NULL,
  `lifecycle_status` text DEFAULT 'Unknown — Review Required' NOT NULL,
  `country_of_origin` text,
  `attributes` text DEFAULT '[]' NOT NULL,
  `standards` text DEFAULT '[]' NOT NULL,
  `review_status` text DEFAULT 'Needs Review' NOT NULL,
  `approved_for_discovery` integer DEFAULT false NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `identity_status` text NOT NULL DEFAULT 'Active',
  `superseded_by_product_id` text,
  `identity_version` integer NOT NULL DEFAULT 1,
  `library_scope` text NOT NULL DEFAULT 'Global Library',
  `organization_id` text REFERENCES `organizations`(`id`),
  `library_project_id` text REFERENCES `projects`(`id`),
  product_role TEXT NOT NULL DEFAULT 'Unclassified',
  FOREIGN KEY (`manufacturer_id`) REFERENCES `product_manufacturers`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`brand_id`) REFERENCES `product_brands`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`family_id`) REFERENCES `product_families`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `library_scope_backfill_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `scope` text NOT NULL,
  `organization_id` text,
  `project_id` text,
  `reason` text NOT NULL,
  `evidence_json` text NOT NULL,
  `product_count` integer NOT NULL,
  `decided_by` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `library_security_principals` (
  `user_id` text PRIMARY KEY NOT NULL,
  `email` text,
  `account_status` text NOT NULL DEFAULT 'Active' CHECK (`account_status` IN ('Active','Disabled')),
  `session_status` text NOT NULL DEFAULT 'Active' CHECK (`session_status` IN ('Active','Revoked')),
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `manufacturer_order_code_observations` (
  `id` text PRIMARY KEY NOT NULL,
  `canonical_product_id` text NOT NULL,
  `original_product_id` text NOT NULL,
  `manufacturer_id` text NOT NULL,
  `original_order_code` text NOT NULL,
  `source_id` text,
  `source_row` integer,
  `observation_fingerprint` text NOT NULL,
  `review_status` text NOT NULL DEFAULT 'Reviewed',
  `decision_id` text NOT NULL,
  `status` text NOT NULL DEFAULT 'Active' CHECK (`status` IN ('Active','Reversed')),
  `created_by` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `reversed_at` text,
  `library_scope` text NOT NULL DEFAULT 'Global Library',
  `organization_id` text REFERENCES `organizations`(`id`),
  `library_project_id` text REFERENCES `projects`(`id`),
  FOREIGN KEY (`canonical_product_id`) REFERENCES `library_products`(`id`),
  FOREIGN KEY (`original_product_id`) REFERENCES `library_products`(`id`),
  FOREIGN KEY (`manufacturer_id`) REFERENCES `product_manufacturers`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organization_audit_events` (
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organization_membership_roles` (
  `id` text PRIMARY KEY NOT NULL,
  `membership_id` text NOT NULL,
  `role` text NOT NULL CHECK (`role` IN ('Organization Owner','Organization Administrator','Organization Member')),
  `status` text NOT NULL DEFAULT 'Active' CHECK (`status` IN ('Active','Revoked')),
  `granted_by` text NOT NULL,
  `granted_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `revoked_at` text,
  FOREIGN KEY (`membership_id`) REFERENCES `organization_memberships`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organization_memberships` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL,
  `user_id` text NOT NULL,
  `status` text NOT NULL DEFAULT 'Active' CHECK (`status` IN ('Active','Revoked')),
  `granted_by` text NOT NULL,
  `granted_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `revoked_at` text,
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `organizations` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `status` text NOT NULL DEFAULT 'Active' CHECK (`status` IN ('Active','Disabled')),
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `owner_user_id` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `presales_workflow_snapshots` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  model_version TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL,
  current_stage_id TEXT NOT NULL,
  ready_for_quotation INTEGER NOT NULL DEFAULT 0,
  ready_for_issue INTEGER NOT NULL DEFAULT 0,
  stages_json TEXT NOT NULL,
  blockers_json TEXT NOT NULL,
  warnings_json TEXT NOT NULL,
  calculated_by TEXT NOT NULL,
  calculated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id,input_fingerprint)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `price_conflicts` (
  `id` text PRIMARY KEY NOT NULL,
  `product_id` text NOT NULL,
  `price_record_ids` text NOT NULL,
  `conflict_type` text NOT NULL,
  `status` text NOT NULL DEFAULT 'Open',
  `resolution` text,
  `resolved_by` text,
  `resolved_at` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `price_record_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `price_record_id` text NOT NULL,
  `version_number` integer NOT NULL,
  `previous_version_id` text,
  `values_json` text NOT NULL,
  `review_status` text NOT NULL DEFAULT 'Needs Review',
  `created_by` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `superseded_at` text,
  FOREIGN KEY (`price_record_id`) REFERENCES `price_records`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `price_records` (
  `id` text PRIMARY KEY NOT NULL,
  `product_id` text NOT NULL,
  `source_id` text NOT NULL,
  `supplier_id` text,
  `project_id` text,
  `amount_minor` integer NOT NULL,
  `currency` text NOT NULL,
  `price_type` text NOT NULL,
  `unit` text DEFAULT 'EA' NOT NULL,
  `minimum_quantity` integer,
  `discount_basis_points` integer,
  `effective_from` text,
  `valid_until` text,
  `validity_state` text NOT NULL,
  `approval_status` text DEFAULT 'Needs Review' NOT NULL,
  `downstream_use` text DEFAULT 'Discovery Only' NOT NULL,
  `terms` text DEFAULT '{}' NOT NULL,
  `source_location` text NOT NULL,
  `reviewed_by` text,
  `reviewed_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`product_id`) REFERENCES `library_products`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`source_id`) REFERENCES `product_sources`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `price_source_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `source_id` text NOT NULL,
  `version_number` integer NOT NULL,
  `previous_version_id` text,
  `source_type` text NOT NULL,
  `manufacturer_id` text,
  `supplier_id` text,
  `currency` text,
  `effective_from` text,
  `effective_to` text,
  `project_id` text,
  `region` text,
  `quantity_range` text,
  `reliability` text NOT NULL,
  `approval_state` text NOT NULL DEFAULT 'Needs Review',
  `downstream_use` text NOT NULL DEFAULT 'Discovery Only',
  `document_id` text NOT NULL,
  `document_version_id` text NOT NULL,
  `input_fingerprint` text NOT NULL,
  `uploaded_by` text NOT NULL,
  `approved_by` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `superseded_at` text,
  FOREIGN KEY (`source_id`) REFERENCES `product_sources`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pricing_approvals` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `pricing_run_id` text NOT NULL,
  `pricing_line_id` text,
  `approval_type` text NOT NULL,
  `status` text NOT NULL,
  `entity_version` integer NOT NULL,
  `request_reason` text NOT NULL,
  `evidence` text NOT NULL,
  `requested_by` text NOT NULL,
  `decided_by` text,
  `decided_role` text,
  `decision_reason` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `decided_at` text,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`pricing_run_id`) REFERENCES `pricing_runs`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`pricing_line_id`) REFERENCES `pricing_lines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pricing_audit_events` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `pricing_run_id` text,
  `pricing_line_id` text,
  `action` text NOT NULL,
  `previous_value` text,
  `new_value` text,
  `reason` text NOT NULL,
  `actor_user_id` text NOT NULL,
  `actor_role` text NOT NULL,
  `request_id` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`pricing_run_id`) REFERENCES `pricing_runs`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`pricing_line_id`) REFERENCES `pricing_lines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pricing_cost_allocations` (
  `id` text PRIMARY KEY NOT NULL,
  `shared_cost_id` text NOT NULL,
  `pricing_line_id` text NOT NULL,
  `weight` text NOT NULL,
  `amount_minor` integer NOT NULL,
  `method` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`shared_cost_id`) REFERENCES `pricing_shared_costs`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`pricing_line_id`) REFERENCES `pricing_lines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pricing_cost_components` (
  `id` text PRIMARY KEY NOT NULL,
  `pricing_line_id` text NOT NULL,
  `component_type` text NOT NULL,
  `description` text NOT NULL,
  `method` text NOT NULL,
  `formula` text NOT NULL,
  `rate` text,
  `quantity` text,
  `amount_minor` integer NOT NULL,
  `source` text NOT NULL,
  `scope` text NOT NULL,
  `assumptions` text NOT NULL,
  `approval_status` text NOT NULL,
  `rule_version` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`pricing_line_id`) REFERENCES `pricing_lines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pricing_discount_applications` (
  `id` text PRIMARY KEY NOT NULL,
  `pricing_line_id` text NOT NULL,
  `discount_type` text NOT NULL,
  `mode` text NOT NULL,
  `order_number` integer NOT NULL,
  `percentage_basis_points` integer NOT NULL,
  `calculation_base_minor` integer NOT NULL,
  `amount_minor` integer NOT NULL,
  `balance_minor` integer NOT NULL,
  `source` text NOT NULL,
  `scope` text NOT NULL,
  `valid_until` text NOT NULL,
  `approved_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`pricing_line_id`) REFERENCES `pricing_lines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pricing_exceptions` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `pricing_line_id` text,
  `exception_type` text NOT NULL,
  `reason` text NOT NULL,
  `evidence` text NOT NULL,
  `scope` text NOT NULL,
  `expires_at` text NOT NULL,
  `status` text NOT NULL,
  `requested_by` text NOT NULL,
  `decided_by` text,
  `decided_role` text,
  `decision_reason` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `decided_at` text,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`pricing_line_id`) REFERENCES `pricing_lines`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pricing_exchange_rates` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `from_currency` text NOT NULL,
  `to_currency` text NOT NULL,
  `rate` text NOT NULL,
  `rate_type` text NOT NULL,
  `source` text NOT NULL,
  `effective_from` text NOT NULL,
  `valid_until` text NOT NULL,
  `version_number` integer NOT NULL,
  `approval_status` text NOT NULL,
  `approved_by` text,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `superseded_at` text,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pricing_journey_sources` (
  id TEXT PRIMARY KEY,
  learning_run_id TEXT NOT NULL REFERENCES pricing_learning_runs(id),
  project_id TEXT NOT NULL,
  document_id TEXT,
  document_version_id TEXT,
  journey_stage TEXT NOT NULL,
  source_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  sha256 TEXT,
  revision TEXT,
  source_date TEXT,
  evidence_quality TEXT NOT NULL,
  provenance TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(learning_run_id,document_version_id,journey_stage)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pricing_learning_events` (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  learning_run_id TEXT NOT NULL REFERENCES pricing_learning_runs(id),
  event_type TEXT NOT NULL,
  details TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pricing_learning_runs` (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  project_snapshot TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '{}',
  started_by TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  error_message TEXT,
  UNIQUE(project_id,input_fingerprint)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pricing_learning_stage_results` (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  learning_run_id TEXT NOT NULL REFERENCES pricing_learning_runs(id),
  project_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK(stage IN ('Understand','Learn','Remember')),
  stage_order INTEGER NOT NULL,
  status TEXT NOT NULL,
  result TEXT NOT NULL,
  safety_boundary TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(learning_run_id,stage)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pricing_lines` (
  `id` text PRIMARY KEY NOT NULL,
  `pricing_run_id` text NOT NULL,
  `project_id` text NOT NULL,
  `boq_item_id` text NOT NULL,
  `candidate_id` text NOT NULL,
  `product_id` text NOT NULL,
  `safety_decision_id` text NOT NULL,
  `selected_price_record_id` text,
  `version_number` integer NOT NULL,
  `status` text NOT NULL,
  `quantity` text NOT NULL,
  `unit` text NOT NULL,
  `source_currency` text,
  `project_currency` text NOT NULL,
  `original_list_price_minor` integer,
  `net_material_unit_minor` integer,
  `material_total_minor` integer,
  `direct_cost_minor` integer,
  `total_cost_minor` integer,
  `gross_selling_minor` integer,
  `customer_discount_minor` integer,
  `net_selling_minor` integer,
  `vat_minor` integer,
  `final_value_minor` integer,
  `margin_basis_points` integer,
  `markup_basis_points` integer,
  `output` text NOT NULL,
  `explanation` text NOT NULL,
  `approval_ready` integer DEFAULT false NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`pricing_run_id`) REFERENCES `pricing_runs`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`boq_item_id`) REFERENCES `boq_items`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`candidate_id`) REFERENCES `product_match_candidates`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`product_id`) REFERENCES `library_products`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`safety_decision_id`) REFERENCES `safety_decisions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`selected_price_record_id`) REFERENCES `price_records`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pricing_memory_observations` (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  learning_run_id TEXT NOT NULL REFERENCES pricing_learning_runs(id),
  project_id TEXT NOT NULL,
  boq_item_id TEXT,
  observation_type TEXT NOT NULL,
  observation_key TEXT NOT NULL,
  manufacturer TEXT,
  part_number TEXT,
  product_family TEXT,
  supplier TEXT,
  currency TEXT,
  amount_minor INTEGER,
  percentage_basis_points INTEGER,
  quantity TEXT,
  unit TEXT,
  original_value TEXT NOT NULL,
  normalized_value TEXT,
  attributes TEXT NOT NULL DEFAULT '{}',
  evidence_document_id TEXT,
  evidence_document_version_id TEXT,
  evidence_location TEXT NOT NULL DEFAULT '{}',
  evidence_quality TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  historical_only INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(learning_run_id,observation_type,observation_key,evidence_document_version_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pricing_memory_relationships` (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  learning_run_id TEXT NOT NULL REFERENCES pricing_learning_runs(id),
  project_id TEXT NOT NULL,
  from_observation_id TEXT NOT NULL REFERENCES pricing_memory_observations(id),
  to_observation_id TEXT NOT NULL REFERENCES pricing_memory_observations(id),
  relationship_type TEXT NOT NULL,
  basis TEXT NOT NULL,
  evidence TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(learning_run_id,from_observation_id,to_observation_id,relationship_type)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pricing_project_similarity_signals` (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  learning_run_id TEXT NOT NULL REFERENCES pricing_learning_runs(id),
  project_id TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  signal_value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  weight REAL NOT NULL,
  evidence TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(learning_run_id,signal_type,normalized_value)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pricing_run_comparisons` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `previous_run_id` text NOT NULL,
  `current_run_id` text NOT NULL,
  `changes` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`previous_run_id`) REFERENCES `pricing_runs`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`current_run_id`) REFERENCES `pricing_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pricing_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `scenario_id` text NOT NULL,
  `version_number` integer NOT NULL,
  `status` text NOT NULL,
  `input_fingerprint` text NOT NULL,
  `engine_version` text NOT NULL,
  `ruleset_version` text NOT NULL,
  `reason` text NOT NULL,
  `locked_versions` text NOT NULL,
  `summary` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `completed_at` text,
  `superseded_at` text,
  `error_code` text,
  `error_message` text,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`scenario_id`) REFERENCES `pricing_scenarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pricing_scenarios` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `name` text NOT NULL,
  `mode` text NOT NULL,
  `version_number` integer NOT NULL,
  `project_currency` text NOT NULL,
  `status` text NOT NULL,
  `assumptions` text NOT NULL,
  `settings` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `superseded_at` text,
  `deleted_at` text,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pricing_shared_costs` (
  `id` text PRIMARY KEY NOT NULL,
  `pricing_run_id` text NOT NULL,
  `component_type` text NOT NULL,
  `description` text NOT NULL,
  `amount_minor` integer NOT NULL,
  `allocation_method` text NOT NULL,
  `source` text NOT NULL,
  `approval_status` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`pricing_run_id`) REFERENCES `pricing_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `processing_history` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `from_status` text,
  `to_status` text NOT NULL,
  `progress` integer NOT NULL,
  `actor` text NOT NULL,
  `error_code` text,
  `message` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `document_processing_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `processing_logs` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `level` text NOT NULL,
  `stage` text NOT NULL,
  `message` text NOT NULL,
  `details` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `document_processing_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_accessories` (
  `id` text PRIMARY KEY NOT NULL,
  `product_id` text NOT NULL,
  `accessory_product_id` text NOT NULL,
  `relationship_type` text NOT NULL,
  `quantity_rule` text NOT NULL,
  `quantity_parameter` integer,
  `scope` text,
  `condition_json` text NOT NULL,
  `included` integer NOT NULL DEFAULT 0,
  `separately_priced` integer NOT NULL DEFAULT 1,
  `source_id` text,
  `evidence_json` text NOT NULL,
  `confidence` integer NOT NULL DEFAULT 0,
  `review_status` text NOT NULL DEFAULT 'Needs Review',
  `version_number` integer NOT NULL DEFAULT 1,
  `created_by` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `superseded_at` text,
  `deleted_at` text,
  FOREIGN KEY (`product_id`) REFERENCES `library_products`(`id`),
  FOREIGN KEY (`accessory_product_id`) REFERENCES `library_products`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_aliases` (
  `id` text PRIMARY KEY NOT NULL,
  `product_id` text NOT NULL,
  `alias` text NOT NULL,
  `normalized_alias` text NOT NULL,
  `alias_type` text NOT NULL,
  `region` text,
  `source_id` text,
  `evidence_json` text NOT NULL,
  `review_status` text NOT NULL DEFAULT 'Needs Review',
  `created_by` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` text,
  FOREIGN KEY (`product_id`) REFERENCES `library_products`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_attributes` (
  `id` text PRIMARY KEY NOT NULL,
  `product_id` text NOT NULL,
  `variant_id` text,
  `attribute_definition_id` text,
  `attribute_name` text NOT NULL,
  `value_json` text,
  `original_value` text,
  `normalized_value` text,
  `unit` text,
  `source_id` text,
  `evidence_json` text NOT NULL,
  `confidence` integer NOT NULL DEFAULT 0,
  `review_status` text NOT NULL DEFAULT 'Needs Review',
  `version_number` integer NOT NULL DEFAULT 1,
  `created_by` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `superseded_at` text,
  `deleted_at` text,
  FOREIGN KEY (`product_id`) REFERENCES `library_products`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_brands` (
  `id` text PRIMARY KEY NOT NULL,
  `manufacturer_id` text NOT NULL,
  `name` text NOT NULL,
  `normalized_name` text NOT NULL,
  `status` text DEFAULT 'Needs Review' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`manufacturer_id`) REFERENCES `product_manufacturers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_certifications` (
  `id` text PRIMARY KEY NOT NULL,
  `product_id` text NOT NULL,
  `variant_id` text,
  `certification_type` text NOT NULL,
  `standard_body` text NOT NULL,
  `standard_number` text NOT NULL,
  `part` text,
  `revision_year` text,
  `scope` text,
  `region` text,
  `document_id` text,
  `evidence_location` text,
  `status` text NOT NULL DEFAULT 'Unverified',
  `confidence` integer NOT NULL DEFAULT 0,
  `review_status` text NOT NULL DEFAULT 'Needs Review',
  `version_number` integer NOT NULL DEFAULT 1,
  `created_by` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `superseded_at` text,
  `deleted_at` text,
  FOREIGN KEY (`product_id`) REFERENCES `library_products`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_compatibility` (
  `id` text PRIMARY KEY NOT NULL,
  `source_product_id` text NOT NULL,
  `target_product_id` text,
  `target_family_id` text,
  `relationship_type` text NOT NULL,
  `conditions_json` text NOT NULL,
  `exceptions_json` text NOT NULL,
  `required_firmware` text,
  `required_protocol` text,
  `source_id` text,
  `evidence_json` text NOT NULL,
  `confidence` integer NOT NULL DEFAULT 0,
  `review_status` text NOT NULL DEFAULT 'Needs Review',
  `version_number` integer NOT NULL DEFAULT 1,
  `effective_from` text,
  `effective_to` text,
  `created_by` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `superseded_at` text,
  `deleted_at` text,
  FOREIGN KEY (`source_product_id`) REFERENCES `library_products`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_conflicts` (
  `id` text PRIMARY KEY NOT NULL,
  `product_id` text,
  `conflict_type` text NOT NULL,
  `left_value` text NOT NULL,
  `right_value` text NOT NULL,
  `source_ids` text NOT NULL,
  `status` text NOT NULL DEFAULT 'Open',
  `resolution` text,
  `resolved_by` text,
  `resolved_at` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` text,
  `conflict_version` integer NOT NULL DEFAULT 1,
  `library_scope` text NOT NULL DEFAULT 'Global Library',
  `organization_id` text REFERENCES `organizations`(`id`),
  `library_project_id` text REFERENCES `projects`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_documents` (
  `id` text PRIMARY KEY NOT NULL,
  `product_id` text NOT NULL,
  `variant_id` text,
  `document_id` text NOT NULL,
  `document_version_id` text NOT NULL,
  `document_type` text NOT NULL,
  `source_location` text NOT NULL,
  `source_reliability` text NOT NULL,
  `review_status` text NOT NULL DEFAULT 'Needs Review',
  `created_by` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` text,
  FOREIGN KEY (`product_id`) REFERENCES `library_products`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_families` (
  `id` text PRIMARY KEY NOT NULL,
  `brand_id` text,
  `parent_family_id` text,
  `name` text NOT NULL,
  `normalized_name` text NOT NULL,
  `engineering_domain` text,
  `review_status` text DEFAULT 'Needs Review' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`brand_id`) REFERENCES `product_brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_identities` (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  identity_key TEXT NOT NULL,
  manufacturer TEXT,
  brand TEXT,
  family TEXT,
  series TEXT,
  model TEXT,
  official_product_code TEXT NOT NULL,
  normalized_product_code TEXT NOT NULL,
  description TEXT,
  category TEXT,
  sub_category TEXT,
  system TEXT,
  unit TEXT,
  lifecycle_status TEXT NOT NULL DEFAULT 'Unknown',
  confidence INTEGER NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TEXT,
  UNIQUE(organization_id,identity_key)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_identity_aliases` (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  product_identity_id TEXT NOT NULL REFERENCES product_identities(id),
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  alias_type TEXT NOT NULL,
  knowledge_fact_id TEXT NOT NULL REFERENCES knowledge_facts(id),
  confidence INTEGER NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_identity_id,normalized_alias,knowledge_fact_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_identity_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `left_product_id` text NOT NULL,
  `right_product_id` text NOT NULL,
  `relationship_type` text NOT NULL,
  `action` text NOT NULL,
  `reason` text NOT NULL,
  `evidence_json` text NOT NULL,
  `reversal_of_id` text,
  `decided_by` text NOT NULL,
  `decided_role` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_identity_events` (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  product_identity_id TEXT,
  run_id TEXT REFERENCES product_identity_runs(id),
  event_type TEXT NOT NULL,
  details TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_identity_observations` (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  product_identity_id TEXT NOT NULL REFERENCES product_identities(id),
  knowledge_file_id TEXT NOT NULL REFERENCES knowledge_files(id),
  knowledge_fact_id TEXT NOT NULL REFERENCES knowledge_facts(id),
  observation_key TEXT NOT NULL,
  observation_type TEXT NOT NULL,
  original_value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  attributes TEXT NOT NULL DEFAULT '{}',
  source_location TEXT NOT NULL DEFAULT '{}',
  confidence INTEGER NOT NULL,
  observed_date TEXT,
  region TEXT,
  source_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_identity_id,knowledge_fact_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_identity_prices` (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  product_identity_id TEXT NOT NULL REFERENCES product_identities(id),
  knowledge_fact_id TEXT NOT NULL REFERENCES knowledge_facts(id),
  price_amount TEXT NOT NULL,
  currency TEXT NOT NULL,
  region TEXT,
  effective_date TEXT,
  validity TEXT,
  price_type TEXT NOT NULL DEFAULT 'Historical Catalogue Price',
  discovery_status TEXT NOT NULL DEFAULT 'Discovery Only',
  costing_eligible INTEGER NOT NULL DEFAULT 0,
  source_location TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_identity_id,knowledge_fact_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_identity_promotions` (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  product_identity_id TEXT NOT NULL REFERENCES product_identities(id),
  identity_version INTEGER NOT NULL,
  review_id TEXT NOT NULL REFERENCES product_identity_reviews(id),
  manufacturer_id TEXT NOT NULL REFERENCES product_manufacturers(id),
  library_product_id TEXT NOT NULL REFERENCES library_products(id),
  product_source_id TEXT NOT NULL REFERENCES product_sources(id),
  reason TEXT NOT NULL,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  linked_knowledge_count INTEGER NOT NULL DEFAULT 0,
  previous_snapshot_json TEXT NOT NULL,
  new_snapshot_json TEXT NOT NULL,
  decided_by TEXT NOT NULL,
  decided_role TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,idempotency_key),
  UNIQUE(organization_id,product_identity_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_identity_relationships` (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  source_identity_id TEXT NOT NULL REFERENCES product_identities(id),
  target_identity_id TEXT REFERENCES product_identities(id),
  target_code TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  knowledge_fact_id TEXT NOT NULL REFERENCES knowledge_facts(id),
  evidence TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_identity_id,relationship_type,target_code,knowledge_fact_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_identity_review_guards` (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  product_identity_id TEXT NOT NULL REFERENCES product_identities(id),
  expected_version INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_identity_reviews` (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  product_identity_id TEXT NOT NULL REFERENCES product_identities(id),
  review_guard_id TEXT NOT NULL UNIQUE REFERENCES product_identity_review_guards(id),
  identity_version_before INTEGER NOT NULL,
  identity_version_after INTEGER NOT NULL,
  previous_snapshot_json TEXT NOT NULL,
  manufacturer_reviewed INTEGER NOT NULL DEFAULT 0 CHECK(manufacturer_reviewed IN (0,1)),
  unit_reviewed INTEGER NOT NULL DEFAULT 0 CHECK(unit_reviewed IN (0,1)),
  resolved_manufacturer TEXT,
  resolved_unit TEXT,
  reason TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  decided_by TEXT NOT NULL,
  decided_role TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Active','Superseded')),
  superseded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id,idempotency_key)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_identity_rulesets` (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  fingerprint TEXT NOT NULL,
  rules_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_identity_runs` (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  ruleset_id TEXT NOT NULL REFERENCES product_identity_rulesets(id),
  input_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  observation_count INTEGER NOT NULL,
  identity_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  UNIQUE(organization_id,input_fingerprint)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_library_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text,
  `entity_type` text NOT NULL,
  `entity_id` text NOT NULL,
  `action` text NOT NULL,
  `previous_value` text,
  `new_value` text,
  `reason` text NOT NULL,
  `decided_by` text NOT NULL,
  `decided_role` text NOT NULL,
  `decided_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_lifecycle_events` (
  `id` text PRIMARY KEY NOT NULL,
  `source_id` text NOT NULL,
  `product_id` text,
  `obsolete_part_number` text NOT NULL,
  `lifecycle_status` text NOT NULL,
  `replacement_candidates` text DEFAULT '[]' NOT NULL,
  `review_status` text DEFAULT 'Needs Review' NOT NULL,
  `source_location` text NOT NULL,
  `reviewed_by` text,
  `reviewed_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`source_id`) REFERENCES `product_sources`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`product_id`) REFERENCES `library_products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_manufacturers` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `normalized_name` text NOT NULL,
  `status` text DEFAULT 'Needs Review' NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_match_candidates` (
  `id` text PRIMARY KEY NOT NULL,
  `match_run_id` text NOT NULL,
  `product_id` text NOT NULL,
  `rank` integer NOT NULL,
  `search_stage` text NOT NULL,
  `score` integer NOT NULL,
  `score_components` text NOT NULL,
  `technical_status` text NOT NULL,
  `recommendation_tier` text NOT NULL,
  `confidence_state` text NOT NULL,
  `confidence_score` integer NOT NULL,
  `matching_basis` text NOT NULL,
  `commercial_availability` text NOT NULL,
  `explanation` text NOT NULL,
  `mandatory_failures` text NOT NULL,
  `lifecycle_result` text NOT NULL,
  `review_status` text DEFAULT 'Needs Review' NOT NULL,
  `manually_added` integer DEFAULT false NOT NULL,
  `added_reason` text,
  `added_by` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`match_run_id`) REFERENCES `product_match_runs`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`product_id`) REFERENCES `library_products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_match_comparisons` (
  `id` text PRIMARY KEY NOT NULL,
  `candidate_id` text NOT NULL,
  `comparison_type` text NOT NULL,
  `requirement_id` text,
  `requirement_type` text,
  `requirement_text` text,
  `required_value` text,
  `product_value` text,
  `result` text NOT NULL,
  `severity` text NOT NULL,
  `blocking` integer DEFAULT false NOT NULL,
  `source_evidence` text,
  `conversion` text,
  `notes` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`candidate_id`) REFERENCES `product_match_candidates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_match_reviews` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `match_run_id` text NOT NULL,
  `candidate_id` text,
  `action` text NOT NULL,
  `reason_code` text NOT NULL,
  `notes` text NOT NULL,
  `evidence` text,
  `decided_by` text NOT NULL,
  `decided_role` text NOT NULL,
  `decided_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`match_run_id`) REFERENCES `product_match_runs`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`candidate_id`) REFERENCES `product_match_candidates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_match_run_comparisons` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `previous_run_id` text NOT NULL,
  `current_run_id` text NOT NULL,
  `changes` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`previous_run_id`) REFERENCES `product_match_runs`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`current_run_id`) REFERENCES `product_match_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_match_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `boq_item_id` text NOT NULL,
  `requirement_profile_version_id` text NOT NULL,
  `processing_run_id` text,
  `version_number` integer NOT NULL,
  `status` text NOT NULL,
  `input_fingerprint` text NOT NULL,
  `engine_version` text NOT NULL,
  `ruleset_version` text NOT NULL,
  `search_version` text NOT NULL,
  `model_version` text NOT NULL,
  `search_scope` text NOT NULL,
  `summary` text NOT NULL,
  `no_match` text,
  `candidate_count` integer DEFAULT 0 NOT NULL,
  `created_by` text NOT NULL,
  `started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `completed_at` text,
  `superseded_at` text,
  `error_code` text,
  `error_message` text,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`boq_item_id`) REFERENCES `boq_items`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`requirement_profile_version_id`) REFERENCES `requirement_profile_versions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`processing_run_id`) REFERENCES `document_processing_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_package_components` (
  `id` text PRIMARY KEY NOT NULL,
  `package_id` text NOT NULL,
  `component_product_id` text NOT NULL,
  `quantity_rule` text NOT NULL,
  `quantity` integer,
  `included` integer NOT NULL DEFAULT 1,
  `source_id` text,
  `evidence_json` text NOT NULL,
  `review_status` text NOT NULL DEFAULT 'Needs Review',
  FOREIGN KEY (`package_id`) REFERENCES `product_packages`(`id`),
  FOREIGN KEY (`component_product_id`) REFERENCES `library_products`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_packages` (
  `id` text PRIMARY KEY NOT NULL,
  `product_id` text NOT NULL,
  `package_code` text NOT NULL,
  `name` text NOT NULL,
  `source_id` text,
  `review_status` text NOT NULL DEFAULT 'Needs Review',
  `version_number` integer NOT NULL DEFAULT 1,
  `created_by` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `superseded_at` text,
  `deleted_at` text,
  FOREIGN KEY (`product_id`) REFERENCES `library_products`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_reference_registry` (
  `table_name` text PRIMARY KEY NOT NULL,
  `product_column` text NOT NULL,
  `strategy` text NOT NULL CHECK (`strategy` IN ('MOVE','RESOLVE','BLOCK','KEEP')),
  `module_name` text NOT NULL,
  `enabled` integer NOT NULL DEFAULT 1,
  `registry_version` integer NOT NULL DEFAULT 1,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_reference_registry_v2` (
  `table_name` text NOT NULL,
  `product_column` text NOT NULL,
  `strategy` text NOT NULL CHECK (`strategy` IN ('MOVE','RESOLVE','BLOCK','KEEP')),
  `module_name` text NOT NULL,
  `enabled` integer NOT NULL DEFAULT 1,
  `registry_version` integer NOT NULL DEFAULT 2,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`table_name`,`product_column`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_reference_versions` (
  `table_name` text NOT NULL,
  `record_id` text NOT NULL,
  `version_number` integer NOT NULL DEFAULT 1,
  PRIMARY KEY (`table_name`,`record_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_source_evidence` (
  `id` text PRIMARY KEY NOT NULL,
  `product_id` text NOT NULL,
  `source_id` text NOT NULL,
  `sheet` text,
  `row_number` integer,
  `page` integer,
  `cells` text DEFAULT '[]' NOT NULL,
  `original_text` text,
  `parser_version` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`product_id`) REFERENCES `library_products`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`source_id`) REFERENCES `product_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_sources` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text,
  `document_id` text,
  `document_version_id` text,
  `checksum` text NOT NULL,
  `source_type` text NOT NULL,
  `authority` text NOT NULL,
  `scope_type` text NOT NULL,
  `file_name` text NOT NULL,
  `release_version` text,
  `effective_from` text,
  `valid_until` text,
  `currency` text,
  `validity_state` text NOT NULL,
  `review_status` text DEFAULT 'Needs Review' NOT NULL,
  `downstream_use` text DEFAULT 'Discovery Only' NOT NULL,
  `metadata` text DEFAULT '{}' NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `organization_id` text REFERENCES `organizations`(`id`),
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`document_version_id`) REFERENCES `document_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_variants` (
  `id` text PRIMARY KEY NOT NULL,
  `base_product_id` text NOT NULL,
  `variant_type` text NOT NULL,
  `variant_key` text NOT NULL,
  `values_json` text NOT NULL,
  `source_id` text,
  `evidence_json` text NOT NULL,
  `review_status` text NOT NULL DEFAULT 'Needs Review',
  `version_number` integer NOT NULL DEFAULT 1,
  `created_by` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `superseded_at` text,
  `deleted_at` text,
  FOREIGN KEY (`base_product_id`) REFERENCES `library_products`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `product_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `product_id` text NOT NULL,
  `version_number` integer NOT NULL,
  `previous_version_id` text,
  `effective_from` text,
  `effective_to` text,
  `values_json` text NOT NULL,
  `source_id` text,
  `confidence` integer,
  `review_status` text NOT NULL DEFAULT 'Needs Review',
  `created_by` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `superseded_at` text,
  `deleted_at` text,
  FOREIGN KEY (`product_id`) REFERENCES `library_products`(`id`),
  FOREIGN KEY (`source_id`) REFERENCES `product_sources`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `profile_issues` (
  `id` text PRIMARY KEY NOT NULL,
  `profile_version_id` text NOT NULL,
  `issue_type` text NOT NULL,
  `related_requirement_id` text,
  `related_field` text,
  `payload` text NOT NULL,
  `severity` text NOT NULL,
  `blocking` integer DEFAULT false NOT NULL,
  `status` text DEFAULT 'Open' NOT NULL,
  `resolution_decision_id` text,
  `resolved_by` text,
  `resolved_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`profile_version_id`) REFERENCES `requirement_profile_versions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`resolution_decision_id`) REFERENCES `engineering_knowledge_decisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `profile_requirement_applicability` (
  `id` text PRIMARY KEY NOT NULL,
  `profile_version_id` text NOT NULL,
  `requirement_id` text NOT NULL,
  `status` text NOT NULL,
  `method` text NOT NULL,
  `confidence` integer NOT NULL,
  `evidence` text NOT NULL,
  `priority` text NOT NULL,
  `review_status` text NOT NULL,
  `reviewed_by` text,
  `reviewed_at` text,
  `review_reason` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`profile_version_id`) REFERENCES `requirement_profile_versions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_context_extraction_versions` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  document_version_id TEXT NOT NULL,
  classification_id TEXT,
  version_number INTEGER NOT NULL,
  source_checksum TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  summary_json TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  superseded_at TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(document_id) REFERENCES documents(id),
  FOREIGN KEY(document_version_id) REFERENCES document_versions(id),
  FOREIGN KEY(classification_id) REFERENCES document_classifications(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_context_facts` (
  id TEXT PRIMARY KEY,
  extraction_version_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  document_version_id TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  label TEXT NOT NULL,
  extracted_value TEXT NOT NULL,
  normalized_value TEXT,
  value_origin TEXT NOT NULL DEFAULT 'Deterministic Extraction',
  confidence INTEGER NOT NULL DEFAULT 100,
  source_sheet TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  source_cell TEXT NOT NULL,
  source_label_cell TEXT,
  requires_ai_interpretation INTEGER NOT NULL DEFAULT 0,
  ai_interpretation_json TEXT,
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  reviewed_value TEXT,
  review_reason TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(extraction_version_id) REFERENCES project_context_extraction_versions(id),
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(document_id) REFERENCES documents(id),
  FOREIGN KEY(document_version_id) REFERENCES document_versions(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_context_review_events` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  extraction_version_id TEXT NOT NULL,
  fact_id TEXT,
  action TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(extraction_version_id) REFERENCES project_context_extraction_versions(id),
  FOREIGN KEY(fact_id) REFERENCES project_context_facts(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_dashboard_profiles` (
  `project_id` text PRIMARY KEY NOT NULL,
  `client` text,
  `consultant` text,
  `contractor` text,
  `location` text,
  `tender_number` text,
  `package_name` text,
  `due_date` text,
  `currency` text DEFAULT 'SAR' NOT NULL,
  `manual_status` text,
  `status_reason` text,
  `status_version` integer DEFAULT 1 NOT NULL,
  `updated_by` text NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `deleted_at` text,
  `selected_pricing_scenario_id` text REFERENCES `pricing_scenarios`(`id`),
  `selected_pricing_scenario_at` text,
  `selected_pricing_scenario_by` text,
  `selected_pricing_scenario_reason` text,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_members` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `user_id` text NOT NULL,
  `role` text NOT NULL,
  `status` text DEFAULT 'Active' NOT NULL,
  `granted_by` text NOT NULL,
  `granted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `revoked_at` text,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_npq_profile_events` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  profile_version_id TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(profile_version_id) REFERENCES project_npq_profile_versions(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_npq_profile_versions` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  country TEXT,
  city TEXT,
  location TEXT,
  inquiry_subject TEXT,
  inquiry_received TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  primary_system TEXT NOT NULL,
  additional_systems_json TEXT NOT NULL DEFAULT '[]',
  delivery_scope TEXT NOT NULL,
  scope_notes TEXT,
  manufacturer_strategy TEXT NOT NULL DEFAULT 'Detect from Specification',
  preferred_manufacturer TEXT,
  approved_manufacturers_json TEXT NOT NULL DEFAULT '[]',
  manufacturer_notes TEXT,
  pricing_strategy TEXT NOT NULL DEFAULT 'Price List',
  primary_pricing_source_type TEXT,
  primary_pricing_source_id TEXT,
  fallback_pricing_sources_json TEXT NOT NULL DEFAULT '[]',
  project_currency TEXT NOT NULL DEFAULT 'SAR',
  pricing_notes TEXT,
  expected_evidence_json TEXT NOT NULL DEFAULT '[]',
  boq_availability TEXT NOT NULL DEFAULT 'Unknown',
  drawing_availability TEXT NOT NULL DEFAULT 'Unknown',
  status TEXT NOT NULL DEFAULT 'Draft',
  input_fingerprint TEXT NOT NULL,
  confirmation_reason TEXT,
  confirmed_by TEXT,
  confirmed_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TEXT,
  `contact_title` text,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_progress_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `model_version` text NOT NULL,
  `progress` integer NOT NULL,
  `derived_status` text NOT NULL,
  `ready_for_quotation` integer DEFAULT false NOT NULL,
  `facts` text NOT NULL,
  `source_version` text NOT NULL,
  `calculated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_quotation_decisions` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  quotation_revision_id TEXT NOT NULL REFERENCES project_quotation_revisions(id),
  action TEXT NOT NULL,
  previous_status TEXT,
  next_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  quotation_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_quotation_issues` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  quotation_revision_id TEXT NOT NULL REFERENCES project_quotation_revisions(id),
  export_job_id TEXT REFERENCES excel_export_jobs(id),
  issue_reference TEXT NOT NULL,
  recipient TEXT,
  transmission_method TEXT,
  issued_by TEXT NOT NULL,
  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  UNIQUE(quotation_revision_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_quotation_lines` (
  id TEXT PRIMARY KEY,
  quotation_revision_id TEXT NOT NULL
    REFERENCES project_quotation_revisions(id),
  project_id TEXT NOT NULL
    REFERENCES projects(id),
  boq_item_id TEXT NOT NULL
    REFERENCES boq_items(id),
  sequence INTEGER NOT NULL,
  item_number TEXT,
  description TEXT,
  unit TEXT NOT NULL,
  quantity TEXT NOT NULL,
  candidate_id TEXT NOT NULL
    REFERENCES product_match_candidates(id),
  product_id TEXT NOT NULL
    REFERENCES library_products(id),
  manufacturer_name TEXT NOT NULL,
  part_number TEXT NOT NULL,
  product_description TEXT NOT NULL,
  pricing_run_id TEXT NOT NULL
    REFERENCES pricing_runs(id),
  pricing_run_version INTEGER NOT NULL,
  pricing_line_id TEXT NOT NULL
    REFERENCES pricing_lines(id),
  pricing_line_version INTEGER NOT NULL,
  pricing_input_fingerprint TEXT NOT NULL,
  commercial_approval_id TEXT NOT NULL
    REFERENCES pricing_approvals(id),
  commercial_approval_version INTEGER NOT NULL,
  currency TEXT NOT NULL,
  total_cost_minor INTEGER NOT NULL,
  net_selling_minor INTEGER NOT NULL,
  source_snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(quotation_revision_id, boq_item_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_quotation_revisions` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  revision_number INTEGER NOT NULL,
  quotation_fingerprint TEXT NOT NULL,
  workflow_snapshot_id TEXT NOT NULL REFERENCES presales_workflow_snapshots(id),
  currency TEXT NOT NULL,
  subtotal_minor INTEGER NOT NULL,
  vat_basis_points INTEGER NOT NULL,
  vat_minor INTEGER NOT NULL,
  total_minor INTEGER NOT NULL,
  terms_json TEXT NOT NULL,
  source_summary_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Draft',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at TEXT,
  issued_at TEXT,
  superseded_at TEXT,
  evidence_fingerprint TEXT,
  evidence_manifest_json TEXT,
  terms_provenance_json TEXT,
  UNIQUE(project_id,revision_number),
  UNIQUE(project_id,quotation_fingerprint)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_risks` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `risk_type` text NOT NULL,
  `severity` text NOT NULL,
  `trigger` text NOT NULL,
  `impact` text NOT NULL,
  `affected_module` text NOT NULL,
  `recommended_action` text NOT NULL,
  `owner` text NOT NULL,
  `due_date` text,
  `source` text NOT NULL,
  `status` text DEFAULT 'Open' NOT NULL,
  `source_version` text NOT NULL,
  `acknowledged_by` text,
  `acknowledged_at` text,
  `calculated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_status_history` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `previous_status` text,
  `next_status` text NOT NULL,
  `status_type` text NOT NULL,
  `reason` text NOT NULL,
  `model_version` text NOT NULL,
  `source_version` text NOT NULL,
  `actor_user_id` text NOT NULL,
  `actor_role` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `projects` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `owner_user_id` text NOT NULL,
  `archived_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `organization_id` text REFERENCES `organizations`(`id`),
  `system_domain` text NOT NULL DEFAULT 'Unspecified',
  `initial_status` text NOT NULL DEFAULT 'Draft',
  `operational_classification` text NOT NULL DEFAULT 'Operational'
CHECK (`operational_classification` IN ('Operational','Internal Validation','Fixture')),
  `project_type` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `regional_part_numbers` (
  `id` text PRIMARY KEY NOT NULL,
  `product_id` text NOT NULL,
  `region` text NOT NULL,
  `part_number` text NOT NULL,
  `normalized_part_number` text NOT NULL,
  `source_id` text,
  `evidence_json` text NOT NULL,
  `review_status` text NOT NULL DEFAULT 'Needs Review',
  `created_by` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` text,
  FOREIGN KEY (`product_id`) REFERENCES `library_products`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `requirement_accessories` (
  `id` text PRIMARY KEY NOT NULL,
  `requirement_id` text NOT NULL,
  `accessory` text NOT NULL,
  `source_type` text NOT NULL,
  `quantity_rule` text,
  `confidence` integer NOT NULL,
  `review_status` text DEFAULT 'Needs Review' NOT NULL,
  FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `requirement_ambiguities` (
  `id` text PRIMARY KEY NOT NULL,
  `extraction_version_id` text NOT NULL,
  `requirement_id` text,
  `original_text` text NOT NULL,
  `reason` text NOT NULL,
  `technical_impact` text NOT NULL,
  `commercial_impact` text NOT NULL,
  `clarification_question` text NOT NULL,
  `blocking` integer NOT NULL,
  `status` text DEFAULT 'Open' NOT NULL,
  FOREIGN KEY (`extraction_version_id`) REFERENCES `specification_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `requirement_attributes` (
  `id` text PRIMARY KEY NOT NULL,
  `requirement_id` text NOT NULL,
  `name` text NOT NULL,
  `operator` text NOT NULL,
  `original_value` text NOT NULL,
  `parsed_value` text,
  `original_unit` text,
  `normalized_value` text,
  `normalized_unit` text,
  `confidence` integer NOT NULL,
  `source_location` text NOT NULL,
  FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `requirement_compatibility` (
  `id` text PRIMARY KEY NOT NULL,
  `requirement_id` text NOT NULL,
  `source_item` text NOT NULL,
  `target_item` text NOT NULL,
  `relationship_type` text NOT NULL,
  `conditions` text,
  `exceptions` text,
  `mandatory` integer NOT NULL,
  `confidence` integer NOT NULL,
  `review_status` text DEFAULT 'Needs Review' NOT NULL,
  FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `requirement_conflicts` (
  `id` text PRIMARY KEY NOT NULL,
  `extraction_version_id` text NOT NULL,
  `left_requirement_id` text,
  `right_requirement_id` text,
  `conflict_type` text NOT NULL,
  `attribute` text,
  `left_value` text,
  `right_value` text,
  `severity` text NOT NULL,
  `impact` text NOT NULL,
  `blocking` integer DEFAULT true NOT NULL,
  `recommended_resolution` text NOT NULL,
  `resolution_status` text DEFAULT 'Open' NOT NULL,
  `resolution_decision` text,
  `resolved_by` text,
  `resolved_at` text,
  FOREIGN KEY (`extraction_version_id`) REFERENCES `specification_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`left_requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`right_requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `requirement_evidence` (
  `id` text PRIMARY KEY NOT NULL,
  `extraction_version_id` text NOT NULL,
  `requirement_id` text,
  `evidence_type` text NOT NULL,
  `source_location` text NOT NULL,
  `original_text` text NOT NULL,
  `extraction_method` text NOT NULL,
  `confidence` integer NOT NULL,
  FOREIGN KEY (`extraction_version_id`) REFERENCES `specification_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `requirement_intelligence_facts` (
  `id` text PRIMARY KEY NOT NULL,
  `profile_version_id` text NOT NULL,
  `requirement_id` text NOT NULL,
  `fact_key` text NOT NULL,
  `fact_type` text NOT NULL,
  `original_value` text NOT NULL,
  `current_value` text NOT NULL,
  `modality` text NOT NULL,
  `confidence` integer NOT NULL,
  `source_page` integer,
  `source_page_to` integer,
  `source_clause` text,
  `source_section` text,
  `evidence_snippet` text NOT NULL,
  `extraction_basis` text NOT NULL,
  `engine_version` text NOT NULL,
  `review_status` text DEFAULT 'Needs Review' NOT NULL,
  `reviewed_by` text,
  `reviewed_at` text,
  `review_reason` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`profile_version_id`) REFERENCES `requirement_profile_versions`(`id`),
  FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `requirement_manufacturers` (
  `id` text PRIMARY KEY NOT NULL,
  `requirement_id` text NOT NULL,
  `manufacturer` text NOT NULL,
  `status` text NOT NULL,
  `scope` text,
  `conditions` text,
  `product_family` text,
  `confidence` integer NOT NULL,
  FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `requirement_missing_information` (
  `id` text PRIMARY KEY NOT NULL,
  `extraction_version_id` text NOT NULL,
  `requirement_id` text,
  `field` text NOT NULL,
  `reason_required` text NOT NULL,
  `technical_impact` text NOT NULL,
  `commercial_impact` text NOT NULL,
  `blocking` integer NOT NULL,
  `clarification_question` text NOT NULL,
  `status` text DEFAULT 'Open' NOT NULL,
  FOREIGN KEY (`extraction_version_id`) REFERENCES `specification_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `requirement_profile_comparisons` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `previous_profile_version_id` text NOT NULL,
  `current_profile_version_id` text NOT NULL,
  `changes` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`previous_profile_version_id`) REFERENCES `requirement_profile_versions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`current_profile_version_id`) REFERENCES `requirement_profile_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `requirement_profile_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `profile_version_id` text NOT NULL,
  `entity_type` text NOT NULL,
  `entity_id` text NOT NULL,
  `action` text NOT NULL,
  `previous_value` text,
  `new_value` text,
  `reason` text NOT NULL,
  `evidence` text,
  `reversible` integer DEFAULT true NOT NULL,
  `reverses_decision_id` text,
  `decided_by` text NOT NULL,
  `decided_role` text NOT NULL,
  `decided_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`profile_version_id`) REFERENCES `requirement_profile_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `requirement_profile_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `boq_item_id` text NOT NULL,
  `processing_run_id` text,
  `version_number` integer NOT NULL,
  `status` text NOT NULL,
  `engine_version` text NOT NULL,
  `ruleset_version` text NOT NULL,
  `model_version` text NOT NULL,
  `input_fingerprint` text NOT NULL,
  `profile` text NOT NULL,
  `explanation` text NOT NULL,
  `readiness_status` text NOT NULL,
  `confidence_summary` text NOT NULL,
  `approved_for_matching` integer DEFAULT false NOT NULL,
  `approved_by` text,
  `approved_at` text,
  `approval_reason` text,
  `superseded_at` text,
  `error_code` text,
  `error_message` text,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `completed_at` text,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`boq_item_id`) REFERENCES `boq_items`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`processing_run_id`) REFERENCES `document_processing_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `requirement_review_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `extraction_version_id` text NOT NULL,
  `requirement_id` text,
  `action` text NOT NULL,
  `previous_value` text,
  `new_value` text,
  `reason` text NOT NULL,
  `evidence` text,
  `decided_by` text NOT NULL,
  `decided_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`extraction_version_id`) REFERENCES `specification_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `requirement_rule_executions` (
  `id` text PRIMARY KEY NOT NULL,
  `profile_version_id` text NOT NULL,
  `rule_id` text NOT NULL,
  `rule_version` integer NOT NULL,
  `input` text NOT NULL,
  `output` text NOT NULL,
  `status` text NOT NULL,
  `duration_ms` integer NOT NULL,
  `error_code` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`profile_version_id`) REFERENCES `requirement_profile_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `requirement_rules` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `description` text NOT NULL,
  `rule_type` text NOT NULL,
  `scope_type` text NOT NULL,
  `scope_id` text,
  `condition` text NOT NULL,
  `action` text NOT NULL,
  `priority` integer NOT NULL,
  `version_number` integer NOT NULL,
  `effective_from` text NOT NULL,
  `effective_to` text,
  `source_fact_id` text,
  `approved_by` text,
  `status` text NOT NULL,
  `test_cases` text DEFAULT '[]' NOT NULL,
  `previous_version_id` text,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`source_fact_id`) REFERENCES `engineering_facts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `requirement_standards` (
  `id` text PRIMARY KEY NOT NULL,
  `requirement_id` text NOT NULL,
  `body` text NOT NULL,
  `number` text,
  `part` text,
  `year` text,
  `original_text` text NOT NULL,
  `status` text NOT NULL,
  `confidence` integer NOT NULL,
  FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `review_approval_conditions` (
  `id` text PRIMARY KEY NOT NULL,
  `review_item_id` text NOT NULL,
  `decision_id` text NOT NULL,
  `description` text NOT NULL,
  `risk` text NOT NULL,
  `owner_id` text NOT NULL,
  `due_date` text NOT NULL,
  `verification_method` text NOT NULL,
  `status` text DEFAULT 'Open' NOT NULL,
  `closed_by` text,
  `closed_at` text,
  FOREIGN KEY (`review_item_id`) REFERENCES `review_queue_items`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`decision_id`) REFERENCES `review_decisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `review_approval_steps` (
  `id` text PRIMARY KEY NOT NULL,
  `review_item_id` text NOT NULL,
  `group_key` text NOT NULL,
  `step_order` integer NOT NULL,
  `mode` text NOT NULL,
  `required_role` text NOT NULL,
  `required_approvals` integer DEFAULT 1 NOT NULL,
  `status` text NOT NULL,
  `decided_by` text,
  `decided_at` text,
  `expires_at` text,
  FOREIGN KEY (`review_item_id`) REFERENCES `review_queue_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `review_assignments` (
  `id` text PRIMARY KEY NOT NULL,
  `review_item_id` text NOT NULL,
  `assignee_id` text NOT NULL,
  `role` text NOT NULL,
  `assignment_type` text NOT NULL,
  `team` text,
  `due_date` text,
  `sla_hours` integer,
  `assigned_by` text NOT NULL,
  `assigned_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `ended_at` text,
  FOREIGN KEY (`review_item_id`) REFERENCES `review_queue_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `review_attachments` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `review_item_id` text NOT NULL,
  `decision_id` text,
  `document_id` text,
  `attachment_type` text NOT NULL,
  `label` text NOT NULL,
  `access_level` text NOT NULL,
  `added_by` text NOT NULL,
  `added_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `deleted_at` text,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`review_item_id`) REFERENCES `review_queue_items`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`decision_id`) REFERENCES `review_decisions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `review_audit_log` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `review_item_id` text,
  `action` text NOT NULL,
  `previous_value` text,
  `new_value` text,
  `reason` text NOT NULL,
  `actor_user_id` text NOT NULL,
  `actor_role` text NOT NULL,
  `request_id` text NOT NULL,
  `entity_version` integer NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`review_item_id`) REFERENCES `review_queue_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `review_clarifications` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `review_item_id` text NOT NULL,
  `question` text NOT NULL,
  `recipient` text,
  `priority` text NOT NULL,
  `due_date` text,
  `status` text NOT NULL,
  `response` text,
  `affected_entities` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `responded_at` text,
  `resolved_by` text,
  `resolved_at` text,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`review_item_id`) REFERENCES `review_queue_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `review_comments` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `review_item_id` text NOT NULL,
  `parent_comment_id` text,
  `body` text NOT NULL,
  `mentions` text NOT NULL,
  `visibility` text NOT NULL,
  `resolution_status` text DEFAULT 'Open' NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `edited_at` text,
  `deleted_at` text,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`review_item_id`) REFERENCES `review_queue_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `review_conflict_resolutions` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `review_item_id` text NOT NULL,
  `conflict_type` text NOT NULL,
  `source_a` text NOT NULL,
  `source_b` text NOT NULL,
  `resolution` text NOT NULL,
  `reason` text NOT NULL,
  `exception_scope` text,
  `resolved_by` text NOT NULL,
  `resolved_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`review_item_id`) REFERENCES `review_queue_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `review_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `review_item_id` text NOT NULL,
  `project_id` text NOT NULL,
  `decision_type` text NOT NULL,
  `outcome` text NOT NULL,
  `previous_state` text NOT NULL,
  `new_state` text NOT NULL,
  `entity_version` integer NOT NULL,
  `review_version` integer NOT NULL,
  `safety_state` text NOT NULL,
  `reason` text NOT NULL,
  `notes` text,
  `evidence` text NOT NULL,
  `scope` text NOT NULL,
  `conditions` text NOT NULL,
  `expires_at` text,
  `approval_level` integer NOT NULL,
  `decided_by` text NOT NULL,
  `decided_role` text NOT NULL,
  `request_id` text NOT NULL,
  `decided_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`review_item_id`) REFERENCES `review_queue_items`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `review_dependencies` (
  `id` text PRIMARY KEY NOT NULL,
  `review_item_id` text NOT NULL,
  `dependency_type` text NOT NULL,
  `dependent_entity_id` text NOT NULL,
  `blocking` integer DEFAULT true NOT NULL,
  `status` text NOT NULL,
  `resolved_by` text,
  `resolved_at` text,
  FOREIGN KEY (`review_item_id`) REFERENCES `review_queue_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `review_notifications` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `review_item_id` text NOT NULL,
  `event_type` text NOT NULL,
  `recipient_id` text NOT NULL,
  `payload` text NOT NULL,
  `status` text DEFAULT 'Pending' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `delivered_at` text,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`review_item_id`) REFERENCES `review_queue_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `review_queue_items` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `boq_item_id` text,
  `review_type` text NOT NULL,
  `priority` text NOT NULL,
  `priority_score` integer NOT NULL,
  `severity` text NOT NULL,
  `status` text NOT NULL,
  `assigned_reviewer_id` text,
  `required_role` text NOT NULL,
  `due_date` text,
  `blocking` integer DEFAULT false NOT NULL,
  `source_module` text NOT NULL,
  `reason_for_review` text NOT NULL,
  `required_decision` text NOT NULL,
  `approval_level` integer DEFAULT 1 NOT NULL,
  `safety_state` text NOT NULL,
  `entity_version` integer NOT NULL,
  `version_number` integer DEFAULT 1 NOT NULL,
  `escalation_status` text DEFAULT 'None' NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `closed_at` text,
  `deleted_at` text,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`boq_item_id`) REFERENCES `boq_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `safety_approval_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `safety_decision_id` text NOT NULL,
  `approval_type` text NOT NULL,
  `approval_level` integer NOT NULL,
  `status` text NOT NULL,
  `requested_by` text NOT NULL,
  `requested_role` text NOT NULL,
  `request_reason` text NOT NULL,
  `evidence` text NOT NULL,
  `entity_version` integer NOT NULL,
  `ruleset_version` text NOT NULL,
  `decided_by` text,
  `decided_role` text,
  `decision_reason` text,
  `decided_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`safety_decision_id`) REFERENCES `safety_decisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `safety_blocks` (
  `id` text PRIMARY KEY NOT NULL,
  `safety_decision_id` text NOT NULL,
  `code` text NOT NULL,
  `severity` text NOT NULL,
  `scope` text NOT NULL,
  `user_message` text NOT NULL,
  `technical_message` text NOT NULL,
  `resolution_action` text NOT NULL,
  `owner` text NOT NULL,
  `source` text,
  `rule_version` text NOT NULL,
  `overridable` integer DEFAULT false NOT NULL,
  `status` text DEFAULT 'Open' NOT NULL,
  `resolution_decision_id` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`safety_decision_id`) REFERENCES `safety_decisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `safety_decision_comparisons` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `previous_decision_id` text NOT NULL,
  `current_decision_id` text NOT NULL,
  `changes` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`previous_decision_id`) REFERENCES `safety_decisions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`current_decision_id`) REFERENCES `safety_decisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `safety_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `boq_item_id` text NOT NULL,
  `candidate_id` text,
  `requirement_profile_version_id` text NOT NULL,
  `match_run_id` text NOT NULL,
  `version_number` integer NOT NULL,
  `input_fingerprint` text NOT NULL,
  `safety_state` text NOT NULL,
  `compliance_state` text NOT NULL,
  `confidence_level` text NOT NULL,
  `overall_confidence` integer NOT NULL,
  `confidence_components` text NOT NULL,
  `technical_eligibility` text NOT NULL,
  `price_eligibility` text NOT NULL,
  `missing_information` text NOT NULL,
  `provenance_status` text NOT NULL,
  `explanation` text NOT NULL,
  `engine_version` text NOT NULL,
  `ruleset_version` text NOT NULL,
  `model_version` text NOT NULL,
  `recalculation_reason` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `superseded_at` text,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`boq_item_id`) REFERENCES `boq_items`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`candidate_id`) REFERENCES `product_match_candidates`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`requirement_profile_version_id`) REFERENCES `requirement_profile_versions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`match_run_id`) REFERENCES `product_match_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `safety_overrides` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `safety_decision_id` text NOT NULL,
  `approval_level` integer NOT NULL,
  `block_codes` text NOT NULL,
  `override_type` text NOT NULL,
  `reason` text NOT NULL,
  `technical_justification` text NOT NULL,
  `commercial_justification` text,
  `evidence` text NOT NULL,
  `scope` text NOT NULL,
  `expires_at` text NOT NULL,
  `status` text NOT NULL,
  `requested_by` text NOT NULL,
  `requested_role` text NOT NULL,
  `decided_by` text,
  `decided_role` text,
  `decision_reason` text,
  `decided_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`safety_decision_id`) REFERENCES `safety_decisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `safety_warnings` (
  `id` text PRIMARY KEY NOT NULL,
  `safety_decision_id` text NOT NULL,
  `code` text NOT NULL,
  `severity` text NOT NULL,
  `scope` text NOT NULL,
  `message` text NOT NULL,
  `resolution_action` text NOT NULL,
  `owner` text NOT NULL,
  `source` text,
  `rule_version` text NOT NULL,
  `acknowledgment_required` integer DEFAULT true NOT NULL,
  `acknowledged_by` text,
  `acknowledged_at` text,
  `acknowledgment_reason` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`safety_decision_id`) REFERENCES `safety_decisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `specification_chunk_entities` (
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `specification_chunk_metrics` (
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `specification_clauses` (
  `id` text PRIMARY KEY NOT NULL,
  `extraction_version_id` text NOT NULL,
  `sequence` integer NOT NULL,
  `kind` text NOT NULL,
  `number` text,
  `title` text,
  `page_from` integer,
  `page_to` integer,
  `path` text NOT NULL,
  `original_text` text NOT NULL,
  FOREIGN KEY (`extraction_version_id`) REFERENCES `specification_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `specification_document_map_details` (
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `specification_document_map_entries` (
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `specification_extraction_checkpoints` (
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `specification_extraction_chunks` (
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `specification_extraction_failures` (
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `specification_extraction_jobs` (
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `specification_extraction_pages` (
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
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `specification_extraction_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `document_id` text NOT NULL,
  `document_version_id` text NOT NULL,
  `classification_id` text,
  `processing_run_id` text,
  `version_number` integer NOT NULL,
  `status` text NOT NULL,
  `parser_version` text NOT NULL,
  `ruleset_version` text NOT NULL,
  `model_version` text NOT NULL,
  `prompt_version` text NOT NULL,
  `ocr_version` text NOT NULL,
  `extraction_method` text,
  `summary` text DEFAULT '{}' NOT NULL,
  `error_code` text,
  `error_message` text,
  `technical_details` text,
  `suggested_action` text,
  `superseded_at` text,
  `started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `completed_at` text,
  `created_by` text NOT NULL,
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`document_version_id`) REFERENCES `document_versions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`classification_id`) REFERENCES `document_classifications`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`processing_run_id`) REFERENCES `document_processing_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `specification_revision_comparisons` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `previous_extraction_version_id` text NOT NULL,
  `current_extraction_version_id` text NOT NULL,
  `added_count` integer NOT NULL,
  `removed_count` integer NOT NULL,
  `changed_count` integer NOT NULL,
  `changes` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`previous_extraction_version_id`) REFERENCES `specification_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`current_extraction_version_id`) REFERENCES `specification_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `specification_sections` (
  `id` text PRIMARY KEY NOT NULL,
  `extraction_version_id` text NOT NULL,
  `sequence` integer NOT NULL,
  `kind` text NOT NULL,
  `number` text,
  `title` text NOT NULL,
  `level` integer NOT NULL,
  `page` integer,
  `path` text NOT NULL,
  `source_text` text NOT NULL,
  FOREIGN KEY (`extraction_version_id`) REFERENCES `specification_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `standards_bodies` (
  `id` text PRIMARY KEY NOT NULL,
  `code` text NOT NULL,
  `name` text NOT NULL,
  `authority_type` text DEFAULT 'Standards Body' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `supplier_branches` (
  `id` text PRIMARY KEY NOT NULL,
  `supplier_id` text NOT NULL,
  `name` text NOT NULL,
  `region` text,
  `address_json` text NOT NULL,
  `status` text NOT NULL DEFAULT 'Active',
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` text,
  FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `supplier_contacts` (
  `id` text PRIMARY KEY NOT NULL,
  `supplier_id` text NOT NULL,
  `branch_id` text,
  `name` text NOT NULL,
  `role` text,
  `email` text,
  `phone` text,
  `status` text NOT NULL DEFAULT 'Active',
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` text,
  FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `supplier_products` (
  `id` text PRIMARY KEY NOT NULL,
  `supplier_id` text NOT NULL,
  `product_id` text,
  `supplier_product_code` text NOT NULL,
  `manufacturer_part_number` text,
  `mapping_confidence` integer NOT NULL DEFAULT 0,
  `review_status` text NOT NULL DEFAULT 'Needs Review',
  `source_id` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` text,
  FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`),
  FOREIGN KEY (`product_id`) REFERENCES `library_products`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `supplier_quote_intake_events` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  intake_run_id TEXT NOT NULL,
  row_id TEXT,
  action TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(intake_run_id) REFERENCES supplier_quote_intake_runs(id),
  FOREIGN KEY(row_id) REFERENCES supplier_quote_intake_rows(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `supplier_quote_intake_rows` (
  id TEXT PRIMARY KEY,
  intake_run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  document_version_id TEXT NOT NULL,
  row_type TEXT NOT NULL,
  sheet_name TEXT,
  page_number INTEGER,
  row_number INTEGER NOT NULL,
  item_number TEXT,
  supplier_name TEXT,
  quotation_reference TEXT,
  manufacturer TEXT,
  part_number TEXT,
  description TEXT,
  unit TEXT,
  quantity REAL,
  currency TEXT,
  list_price_minor INTEGER,
  unit_price_minor INTEGER,
  discount_basis_points INTEGER,
  net_price_minor INTEGER,
  issue_date TEXT,
  valid_until TEXT,
  raw_values TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  product_id TEXT,
  mapping_basis TEXT,
  mapped_by TEXT,
  mapped_at TEXT,
  review_reason TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  promoted_supplier_quote_id TEXT,
  promoted_price_record_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(intake_run_id) REFERENCES supplier_quote_intake_runs(id),
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(document_id) REFERENCES documents(id),
  FOREIGN KEY(document_version_id) REFERENCES document_versions(id),
  FOREIGN KEY(product_id) REFERENCES library_products(id),
  FOREIGN KEY(promoted_supplier_quote_id) REFERENCES supplier_quotes(id),
  FOREIGN KEY(promoted_price_record_id) REFERENCES price_records(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `supplier_quote_intake_runs` (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  document_version_id TEXT NOT NULL,
  processing_run_id TEXT,
  source_checksum TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  supplier_name TEXT,
  quotation_reference TEXT,
  issue_date TEXT,
  valid_until TEXT,
  currency TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  superseded_at TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(document_id) REFERENCES documents(id),
  FOREIGN KEY(document_version_id) REFERENCES document_versions(id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `supplier_quote_lines` (
  `id` text PRIMARY KEY NOT NULL,
  `supplier_quote_id` text NOT NULL,
  `line_number` integer NOT NULL,
  `product_id` text,
  `supplier_product_code` text,
  `manufacturer` text,
  `part_number` text,
  `description` text NOT NULL,
  `quantity` text,
  `unit_price_minor` integer,
  `discount_basis_points` integer,
  `net_price_minor` integer,
  `currency` text NOT NULL,
  `availability` text,
  `delivery` text,
  `source_location` text NOT NULL,
  `mapping_confidence` integer NOT NULL DEFAULT 0,
  `review_status` text NOT NULL DEFAULT 'Needs Review',
  `original_values` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_intake_row_id TEXT REFERENCES supplier_quote_intake_rows(id),
  FOREIGN KEY (`supplier_quote_id`) REFERENCES `supplier_quotes`(`id`),
  FOREIGN KEY (`product_id`) REFERENCES `library_products`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `supplier_quotes` (
  `id` text PRIMARY KEY NOT NULL,
  `supplier_id` text NOT NULL,
  `project_id` text,
  `quote_number` text NOT NULL,
  `quote_version` integer NOT NULL DEFAULT 1,
  `quote_date` text NOT NULL,
  `valid_until` text,
  `currency` text NOT NULL,
  `delivery_terms` text,
  `payment_terms` text,
  `warranty_terms` text,
  `source_document_id` text NOT NULL,
  `review_status` text NOT NULL DEFAULT 'Needs Review',
  `created_by` text NOT NULL,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `superseded_at` text,
  `deleted_at` text,
  source_document_version_id TEXT REFERENCES document_versions(id),
  FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`),
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `suppliers` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `normalized_name` text NOT NULL,
  `country` text,
  `status` text DEFAULT 'Needs Review' NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `technical_requirements` (
  `id` text PRIMARY KEY NOT NULL,
  `extraction_version_id` text NOT NULL,
  `project_id` text NOT NULL,
  `source_document_id` text NOT NULL,
  `clause_id` text,
  `sequence` integer NOT NULL,
  `source_revision` text,
  `original_text` text NOT NULL,
  `normalized_requirement` text NOT NULL,
  `engineering_domain` text NOT NULL,
  `domain_source_type` text NOT NULL,
  `system` text,
  `category` text,
  `subcategory` text,
  `requirement_type` text NOT NULL,
  `requirement_category` text NOT NULL,
  `condition` text,
  `exception` text,
  `confidence` integer NOT NULL,
  `confidence_state` text NOT NULL,
  `review_status` text NOT NULL,
  `extraction_method` text NOT NULL,
  `parser_version` text NOT NULL,
  `model_version` text NOT NULL,
  `source_location` text NOT NULL,
  `original_values` text NOT NULL,
  `current_values` text NOT NULL,
  `approved_for_downstream` integer DEFAULT false NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`extraction_version_id`) REFERENCES `specification_extraction_versions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`source_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`clause_id`) REFERENCES `specification_clauses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `upload_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `uploaded_by` text NOT NULL,
  `status` text NOT NULL,
  `file_count` integer DEFAULT 1 NOT NULL,
  `total_bytes` integer DEFAULT 0 NOT NULL,
  `error_code` text,
  `error_message` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `completed_at` text,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `workflow_stage_states` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `stage_id` text NOT NULL,
  `model_version` text NOT NULL,
  `status` text NOT NULL,
  `progress` integer NOT NULL,
  `blocking_issue_count` integer DEFAULT 0 NOT NULL,
  `warning_count` integer DEFAULT 0 NOT NULL,
  `owner_role` text NOT NULL,
  `next_action` text,
  `drill_down_route` text NOT NULL,
  `source_version` text NOT NULL,
  `calculated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `started_at` text,
  `completed_at` text,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ai_quotation_advisory_current_idx ON ai_quotation_advisories(project_id,evidence_fingerprint,created_at) WHERE superseded_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS artifacts_run_idx ON document_artifacts(run_id,artifact_type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assertions_review_idx ON document_assertions(review_status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assertions_run_type_idx ON document_assertions(run_id,assertion_type);
--> statement-breakpoint
CREATE INDEX `boq_decisions_item_idx` ON `boq_review_decisions` (`item_id`,`decided_at`);
--> statement-breakpoint
CREATE INDEX `boq_decisions_version_idx` ON `boq_review_decisions` (`extraction_version_id`,`decided_at`);
--> statement-breakpoint
CREATE INDEX `boq_evidence_item_idx` ON `boq_extraction_evidence` (`item_id`,`field_name`);
--> statement-breakpoint
CREATE INDEX `boq_extraction_document_idx` ON `boq_extraction_versions` (`document_id`,`started_at`);
--> statement-breakpoint
CREATE INDEX `boq_extraction_status_idx` ON `boq_extraction_versions` (`status`,`started_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `boq_extraction_version_number_idx` ON `boq_extraction_versions` (`document_id`,`version_number`);
--> statement-breakpoint
CREATE INDEX `boq_items_downstream_idx` ON `boq_items` (`project_id`,`approved_for_downstream`,`row_type`);
--> statement-breakpoint
CREATE INDEX `boq_items_project_review_idx` ON `boq_items` (`project_id`,`review_status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `boq_items_version_sequence_idx` ON `boq_items` (`extraction_version_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `boq_quantity_source_decisions_item_idx` ON `boq_quantity_source_decisions` (`boq_item_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `boq_requirement_link_project_status_idx` ON `boq_requirement_links` (`project_id`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `boq_requirement_link_version_idx` ON `boq_requirement_links` (`boq_item_id`,`requirement_id`,`version_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `boq_revision_pair_idx` ON `boq_revision_comparisons` (`previous_extraction_version_id`,`current_extraction_version_id`);
--> statement-breakpoint
CREATE INDEX `boq_sections_version_idx` ON `boq_sections` (`extraction_version_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `boq_sources_version_idx` ON `boq_extraction_sources` (`extraction_version_id`,`source_kind`);
--> statement-breakpoint
CREATE INDEX `boq_warnings_item_idx` ON `boq_extraction_warnings` (`item_id`);
--> statement-breakpoint
CREATE INDEX `boq_warnings_version_idx` ON `boq_extraction_warnings` (`extraction_version_id`,`code`);
--> statement-breakpoint
CREATE UNIQUE INDEX `canonical_evidence_fingerprint_idx` ON `canonical_evidence_integrity` (`evidence_fingerprint`);
--> statement-breakpoint
CREATE INDEX `canonical_evidence_original_owner_idx` ON `canonical_evidence_integrity` (`original_product_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS case_audit_case_idx ON case_study_audit_log(case_study_id,created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS case_ground_truth_case_idx ON case_ground_truth_records(case_study_id,record_type,review_state);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS case_knowledge_case_idx ON case_knowledge_items(case_study_id,classification);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS case_knowledge_decision_item_idx ON case_knowledge_decisions(knowledge_item_id,created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS case_knowledge_queue_idx ON case_knowledge_items(layer,review_state,publication_state);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS case_learning_eval_release_idx ON case_learning_evaluations(release_id,case_study_id,outcome);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS case_similarity_lookup_idx ON case_similarity_signals(signal_type,normalized_value,case_study_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS case_sources_case_type_idx ON case_study_sources(case_study_id,source_type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS case_studies_benchmark_idx ON case_studies(benchmark_state,benchmark_release,superseded_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS case_studies_learning_readiness_idx
  ON case_studies(organization_id,learning_readiness,superseded_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS case_studies_org_state_idx ON case_studies(organization_id,review_state,publication_state);
--> statement-breakpoint
CREATE UNIQUE INDEX `classification_candidate_rank_idx` ON `classification_candidates` (`classification_id`,`rank`);
--> statement-breakpoint
CREATE INDEX `classification_evidence_idx` ON `classification_evidence` (`classification_id`,`category`);
--> statement-breakpoint
CREATE UNIQUE INDEX `classification_model_version_idx` ON `classification_model_versions` (`classifier_version`,`ruleset_version`,`prompt_version`);
--> statement-breakpoint
CREATE INDEX `classification_overrides_document_idx` ON `classification_overrides` (`document_id`,`overridden_at`);
--> statement-breakpoint
CREATE INDEX `classification_segments_idx` ON `classification_segments` (`classification_id`,`segment_kind`);
--> statement-breakpoint
CREATE INDEX `classifications_document_idx` ON `document_classifications` (`document_id`,`classified_at`);
--> statement-breakpoint
CREATE INDEX `classifications_status_idx` ON `document_classifications` (`status`,`classified_at`);
--> statement-breakpoint
CREATE INDEX `classifications_version_idx` ON `document_classifications` (`document_version_id`,`classified_at`);
--> statement-breakpoint
CREATE INDEX `dashboard_audit_action_idx` ON `dashboard_audit_log` (`action`,`created_at`);
--> statement-breakpoint
CREATE INDEX `dashboard_audit_project_idx` ON `dashboard_audit_log` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `dashboard_metric_definition_version_idx` ON `dashboard_metric_definitions` (`id`,`version`);
--> statement-breakpoint
CREATE INDEX `dashboard_metric_snapshot_scope_idx` ON `dashboard_metric_snapshots` (`scope_key`,`calculated_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `dashboard_metric_snapshot_source_idx` ON `dashboard_metric_snapshots` (`metric_id`,`scope_key`,`source_version`);
--> statement-breakpoint
CREATE INDEX `document_audit_document_idx` ON `document_audit_events` (`document_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `document_audit_project_idx` ON `document_audit_events` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `document_versions_document_idx` ON `document_versions` (`document_id`,`version_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_versions_document_number_idx` ON `document_versions` (`document_id`,`version_number`);
--> statement-breakpoint
CREATE INDEX `document_versions_sha_idx` ON `document_versions` (`sha256`);
--> statement-breakpoint
CREATE INDEX `documents_project_idx` ON `documents` (`project_id`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `documents_project_type_idx` ON `documents` (`project_id`,`document_type`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS drawing_architecture_approved_audit_idx ON drawing_architecture_approved_audit_events(approved_version_id,created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drawing_architecture_approved_row_idx ON drawing_architecture_approved_rows(approved_version_id,review_case_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drawing_architecture_approved_version_idx ON drawing_architecture_approved_versions(project_id,version_number);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS drawing_architecture_case_status_idx ON drawing_architecture_review_cases(project_id,status,updated_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS drawing_architecture_case_type_idx ON drawing_architecture_review_cases(document_id,fact_type);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drawing_architecture_case_unique_idx ON drawing_architecture_review_cases(document_id,drawing_intake_version_id,fact_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS drawing_architecture_event_idx ON drawing_architecture_review_events(review_case_id,created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drawing_architecture_exception_adj_project_key_idx
  ON drawing_architecture_exception_adjudications (project_id, exception_key)
  WHERE superseded_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS drawing_architecture_exception_adj_project_type_idx
  ON drawing_architecture_exception_adjudications (project_id, exception_type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS drawing_architecture_exception_adj_source_idx
  ON drawing_architecture_exception_adjudications (source_drawing_number);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS drawing_architecture_stage4_readiness_project_idx
  ON drawing_architecture_stage4_readiness (project_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drawing_architecture_stage4_readiness_project_version_idx
  ON drawing_architecture_stage4_readiness (project_id, version_number);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `drawing_assets_page_type_idx` ON `drawing_assets` (`page_id`,`asset_type`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `drawing_document_classification_idx` ON `drawing_document_classifications` (`intake_version_id`,`classification_type`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS drawing_extraction_proposal_document_idx ON drawing_extraction_proposals (document_id, page_number);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drawing_extraction_proposal_key_idx ON drawing_extraction_proposals (intake_version_id, proposal_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS drawing_extraction_proposal_status_idx ON drawing_extraction_proposals (document_id, review_status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS drawing_extraction_review_event_idx ON drawing_extraction_review_events (proposal_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `drawing_intake_audit_idx` ON `drawing_intake_audit_events` (`document_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `drawing_intake_current_idx` ON `drawing_intake_versions` (`document_id`,`superseded_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `drawing_intake_document_version_idx` ON `drawing_intake_versions` (`document_id`,`version_number`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `drawing_legend_context_current_idx` ON `drawing_recognition_legend_contexts` (`target_document_id`, `superseded_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `drawing_legend_entry_search_idx` ON `drawing_legend_entries` (`legend_id`,`label`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drawing_legend_geometry_approved_link_idx ON drawing_legend_geometry_approved_links(approved_geometry_version_id,approved_row_id,candidate_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drawing_legend_geometry_approved_version_idx ON drawing_legend_geometry_approved_versions(document_id,version_number);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drawing_legend_geometry_candidate_idx ON drawing_legend_geometry_candidates(geometry_version_id,approved_row_id,id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS drawing_legend_geometry_candidate_status_idx ON drawing_legend_geometry_candidates(geometry_version_id,review_status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS drawing_legend_geometry_current_idx ON drawing_legend_geometry_versions(document_id,superseded_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS drawing_legend_geometry_review_event_idx ON drawing_legend_geometry_review_events(candidate_id,created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drawing_legend_geometry_version_idx ON drawing_legend_geometry_versions(document_id,version_number);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `drawing_legend_page_idx` ON `drawing_legends` (`intake_version_id`,`page_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `drawing_metadata_number_idx` ON `drawing_metadata` (`drawing_number`,`sheet_name`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS drawing_occurrence_cluster_event_idx ON drawing_occurrence_cluster_events(cluster_id,created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drawing_occurrence_cluster_version_idx ON drawing_occurrence_cluster_versions(document_id,version_number);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drawing_occurrence_spatial_cluster_idx ON drawing_occurrence_spatial_clusters(cluster_version_id,page_number,raw_signature);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `drawing_page_number_idx` ON `drawing_pages` (`intake_version_id`,`page_number`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `drawing_quantity_evidence_coverage_version_idx` ON `drawing_quantity_evidence_coverage` (`recognition_version_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `drawing_search_number_idx` ON `drawing_search_entries` (`drawing_number`,`sheet_name`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `drawing_search_page_idx` ON `drawing_search_entries` (`intake_version_id`,`page_number`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS drawing_structure_approved_audit_idx ON drawing_structure_approved_audit_events(document_id,created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS drawing_structure_approved_current_idx ON drawing_structure_approved_versions(document_id,superseded_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drawing_structure_approved_row_idx ON drawing_structure_approved_rows(approved_version_id,review_case_id,source_row);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drawing_structure_approved_version_idx ON drawing_structure_approved_versions(document_id,version_number);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS drawing_structure_audit_idx ON drawing_structure_audit_events(document_id,created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drawing_structure_cell_idx ON drawing_structure_cells(table_id,row_number,column_number);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drawing_structure_column_idx ON drawing_structure_columns(table_id,column_number);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS drawing_structure_current_idx ON drawing_structure_versions(document_id,superseded_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drawing_structure_document_version_idx ON drawing_structure_versions(document_id,version_number);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS drawing_structure_header_idx ON drawing_structure_headers(table_id,header_type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS drawing_structure_issue_idx ON drawing_structure_validation_issues(structure_version_id,status,severity);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drawing_structure_legend_row_idx ON drawing_structure_legend_rows(table_id,source_row);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drawing_structure_region_key_idx ON drawing_structure_regions(structure_version_id,region_key);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drawing_structure_review_case_row_idx ON drawing_structure_review_cases(structure_version_id,legend_row_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS drawing_structure_review_case_status_idx ON drawing_structure_review_cases(document_id,status,updated_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS drawing_structure_review_event_idx ON drawing_structure_review_events(review_case_id,created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drawing_structure_row_idx ON drawing_structure_rows(table_id,row_number);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drawing_structure_table_key_idx ON drawing_structure_tables(structure_version_id,table_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS drawing_symbol_cluster_event_idx ON drawing_symbol_cluster_events(cluster_id,created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drawing_symbol_cluster_number_idx ON drawing_symbol_cluster_candidates(segmentation_version_id,geometry_candidate_id,cluster_number);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `drawing_symbol_current_idx` ON `drawing_symbol_recognition_versions` (`document_id`,`superseded_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `drawing_symbol_definition_key_idx` ON `drawing_symbol_definitions` (`recognition_version_id`,`definition_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `drawing_symbol_definition_project_idx` ON `drawing_symbol_definitions` (`project_id`,`review_status`,`explicit_label`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `drawing_symbol_document_version_idx` ON `drawing_symbol_recognition_versions` (`document_id`,`version_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `drawing_symbol_geometry_fingerprint_idx` ON `drawing_symbol_source_geometries` (`definition_id`,`geometry_fingerprint`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `drawing_symbol_occurrence_definition_idx` ON `drawing_symbol_occurrences` (`recognition_version_id`,`definition_id`,`page_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `drawing_symbol_occurrence_key_idx` ON `drawing_symbol_occurrences` (`recognition_version_id`,`occurrence_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS drawing_symbol_occurrence_match_event_idx ON drawing_symbol_occurrence_match_events(candidate_id,created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drawing_symbol_occurrence_match_idx ON drawing_symbol_occurrence_match_candidates(signature_version_id,occurrence_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `drawing_symbol_review_entity_idx` ON `drawing_symbol_review_events` (`entity_type`,`entity_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drawing_symbol_segmentation_version_idx ON drawing_symbol_segmentation_versions(document_id,version_number);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drawing_symbol_signature_version_idx ON drawing_symbol_signature_versions(document_id,version_number);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `drawing_symbol_unknown_idx` ON `drawing_symbol_occurrences` (`recognition_version_id`,`page_number`) WHERE `definition_id` IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `drawing_title_block_field_review_idx` ON `drawing_title_block_field_reviews` (`structure_version_id`,`page_number`,`field_key`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS drawing_visual_document_idx ON drawing_visual_runs(document_id,created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS drawing_visual_running_idx ON drawing_visual_runs(intake_version_id,page_number) WHERE status='Running';
--> statement-breakpoint
CREATE INDEX `engineering_attributes_domain_idx` ON `engineering_attribute_definitions` (`engineering_domain`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `engineering_attributes_name_version_idx` ON `engineering_attribute_definitions` (`canonical_name`,`version_number`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `engineering_classification_current_idx` ON `engineering_classification_versions` (`boq_item_id`,`superseded_at`,`matching_readiness`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `engineering_classification_decision_review_idx` ON `engineering_classification_decisions` (`classification_version_id`,`review_status`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `engineering_classification_decision_type_idx` ON `engineering_classification_decisions` (`classification_version_id`,`classification_type`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `engineering_classification_item_version_idx` ON `engineering_classification_versions` (`boq_item_id`,`version_number`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `engineering_conflicts_project_status_idx` ON `engineering_knowledge_conflicts` (`project_id`,`resolution_status`,`blocking`);
--> statement-breakpoint
CREATE INDEX `engineering_decisions_entity_idx` ON `engineering_knowledge_decisions` (`entity_type`,`entity_id`,`decided_at`);
--> statement-breakpoint
CREATE INDEX `engineering_decisions_project_idx` ON `engineering_knowledge_decisions` (`project_id`,`decided_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `engineering_discovery_audit_idx` ON `engineering_discovery_audit_events` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `engineering_discovery_current_idx` ON `engineering_discovery_runs` (`project_id`,`superseded_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `engineering_discovery_fact_idx` ON `engineering_discovery_facts` (`run_id`,`fact_type`,`review_status`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `engineering_discovery_project_version_idx` ON `engineering_discovery_runs` (`project_id`,`version_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `engineering_discovery_source_idx` ON `engineering_discovery_sources` (`run_id`,`source_id`);
--> statement-breakpoint
CREATE INDEX `engineering_facts_entity_idx` ON `engineering_facts` (`entity_type`,`entity_id`,`status`);
--> statement-breakpoint
CREATE INDEX `engineering_facts_predicate_idx` ON `engineering_facts` (`predicate`,`fact_type`);
--> statement-breakpoint
CREATE INDEX `engineering_facts_project_scope_idx` ON `engineering_facts` (`project_id`,`scope_type`,`scope_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `engineering_graph_audit_entity_idx` ON `engineering_graph_audit_events` (`entity_type`,`entity_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `engineering_graph_current_idx` ON `engineering_graph_versions` (`boq_item_id`,`superseded_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `engineering_graph_item_version_idx` ON `engineering_graph_versions` (`boq_item_id`,`version_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `engineering_graph_node_key_idx` ON `engineering_graph_nodes` (`graph_version_id`,`node_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `engineering_graph_relationship_key_idx` ON `engineering_graph_relationships` (`graph_version_id`,`from_node_id`,`relationship_type`,`to_node_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `engineering_graph_relationship_review_idx` ON `engineering_graph_relationships` (`graph_version_id`,`review_status`,`relationship_type`);
--> statement-breakpoint
CREATE INDEX `engineering_provenance_document_idx` ON `engineering_fact_provenance` (`document_id`,`document_version_id`);
--> statement-breakpoint
CREATE INDEX `engineering_provenance_fact_idx` ON `engineering_fact_provenance` (`fact_id`,`source_type`);
--> statement-breakpoint
CREATE INDEX `engineering_relationship_left_idx` ON `engineering_relationships` (`left_entity_type`,`left_entity_id`,`relationship_type`);
--> statement-breakpoint
CREATE INDEX `engineering_relationship_project_idx` ON `engineering_relationships` (`project_id`,`status`);
--> statement-breakpoint
CREATE INDEX `engineering_relationship_right_idx` ON `engineering_relationships` (`right_entity_type`,`right_entity_id`,`relationship_type`);
--> statement-breakpoint
CREATE UNIQUE INDEX `engineering_standard_version_idx` ON `engineering_standard_versions` (`standard_id`,`edition`,`year`);
--> statement-breakpoint
CREATE UNIQUE INDEX `engineering_standards_body_number_idx` ON `engineering_standards` (`body_id`,`number`);
--> statement-breakpoint
CREATE INDEX `engineering_taxonomy_parent_idx` ON `engineering_taxonomy_terms` (`parent_id`,`term_type`);
--> statement-breakpoint
CREATE UNIQUE INDEX `engineering_taxonomy_scope_name_idx` ON `engineering_taxonomy_terms` (`term_type`,`canonical_name`,`scope_type`,`scope_id`,`version_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `engineering_units_code_version_idx` ON `engineering_unit_definitions` (`code`,`version_number`);
--> statement-breakpoint
CREATE INDEX `engineering_units_family_idx` ON `engineering_unit_definitions` (`family`,`status`);
--> statement-breakpoint
CREATE INDEX estimator_item_interpretations_latest_idx ON estimator_item_interpretations(boq_item_id, version_number DESC);
--> statement-breakpoint
CREATE INDEX estimator_item_interpretations_project_status_idx ON estimator_item_interpretations(project_id, status, created_at);
--> statement-breakpoint
CREATE INDEX estimator_understanding_parent_run_idx
ON estimator_understanding_runs(parent_run_id, started_at);
--> statement-breakpoint
CREATE INDEX estimator_understanding_review_current_idx
ON estimator_understanding_review_versions(project_id, boq_item_id, version_number DESC);
--> statement-breakpoint
CREATE INDEX estimator_understanding_review_event_item_idx
ON estimator_understanding_review_events(boq_item_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX estimator_understanding_runs_project_idx ON estimator_understanding_runs(project_id, started_at);
--> statement-breakpoint
CREATE UNIQUE INDEX estimator_understanding_single_controlled_retry_idx
ON estimator_understanding_runs(parent_run_id, authorization_fingerprint)
WHERE run_mode='CONTROLLED_RETRY';
--> statement-breakpoint
CREATE INDEX `excel_export_audit_job_idx` ON `excel_export_audit_log` (`export_job_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `excel_export_audit_project_idx` ON `excel_export_audit_log` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `excel_export_file_job_idx` ON `excel_export_files` (`export_job_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `excel_export_file_object_idx` ON `excel_export_files` (`object_key`);
--> statement-breakpoint
CREATE INDEX `excel_export_file_project_idx` ON `excel_export_files` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `excel_export_idempotency_idx` ON `excel_export_jobs` (`project_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `excel_export_project_status_idx` ON `excel_export_jobs` (`project_id`,`status`,`requested_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `excel_export_reconciliation_job_idx` ON `excel_export_reconciliations` (`export_job_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `excel_export_revision_idx` ON `excel_export_jobs` (`project_id`,`revision`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS export_quotation_binding_idx ON excel_export_jobs(quotation_revision_id,quotation_fingerprint,evidence_fingerprint);
--> statement-breakpoint
CREATE INDEX `export_template_mapping_field_idx` ON `export_template_mappings` (`canonical_field`,`template_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `export_template_mapping_target_idx` ON `export_template_mappings` (`template_id`,`sheet_name`,`target`);
--> statement-breakpoint
CREATE UNIQUE INDEX `export_templates_name_version_idx` ON `export_templates` (`name`,`version`);
--> statement-breakpoint
CREATE INDEX `export_templates_status_idx` ON `export_templates` (`status`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `governed_identity_idempotency_idx` ON `governed_identity_decisions` (`decision_type`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `governed_identity_products_idx` ON `governed_identity_decisions` (`canonical_product_id`,`non_target_product_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX governed_identity_proposal_cycle_idx ON governed_identity_decisions (proposal_id, decision_type, application_cycle);
--> statement-breakpoint
CREATE UNIQUE INDEX `governed_identity_reversal_once_idx` ON `governed_identity_decisions` (`reversal_of_id`) WHERE `reversal_of_id` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS historical_boq_alignments_project_outcome_idx ON historical_boq_alignments(historical_project_id,outcome);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS historical_boq_files_project_role_idx ON historical_boq_files(historical_project_id,file_role);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS historical_boq_rows_project_type_idx ON historical_boq_rows(historical_project_id,row_type);
--> statement-breakpoint
CREATE INDEX `identity_cases_scope_idx` ON `identity_resolution_cases` (`library_scope`,`organization_id`,`library_project_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `identity_decision_audit_entity_idx` ON `identity_decision_audit` (`entity_type`,`entity_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_decision_audit_idempotency_idx` ON `identity_decision_audit` (`action`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `identity_decisions_scope_idx` ON `governed_identity_decisions` (`library_scope`,`organization_id`,`library_project_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `identity_mutation_failures_entity_idx` ON `identity_mutation_failures` (`operation`,`entity_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_proposal_review_idempotency_idx` ON `identity_proposal_reviews` (`proposal_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `identity_proposal_review_latest_idx` ON `identity_proposal_reviews` (`proposal_id`,`created_at`,`id`);
--> statement-breakpoint
CREATE INDEX `identity_proposals_scope_idx` ON `identity_resolution_proposals` (`library_scope`,`organization_id`,`library_project_id`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_reference_move_record_idx` ON `identity_reference_moves` (`decision_id`,`table_name`,`record_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_resolution_candidate_case_product_idx` ON `identity_resolution_candidates` (`case_id`,`product_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_resolution_case_run_conflict_idx` ON `identity_resolution_cases` (`run_id`,`conflict_id`);
--> statement-breakpoint
CREATE INDEX `identity_resolution_case_status_idx` ON `identity_resolution_cases` (`status`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_resolution_proposal_case_idx` ON `identity_resolution_proposals` (`case_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_resolution_proposal_fingerprint_idx` ON `identity_resolution_proposals` (`proposal_fingerprint`);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_resolution_run_idempotency_idx` ON `identity_resolution_runs` (`ruleset_version_id`,`mode`,`input_fingerprint`);
--> statement-breakpoint
CREATE INDEX `identity_resolution_trace_rule_idx` ON `identity_resolution_rule_traces` (`rule_id`,`matched`,`terminal`);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_resolution_trace_sequence_idx` ON `identity_resolution_rule_traces` (`proposal_id`,`sequence_no`);
--> statement-breakpoint
CREATE INDEX `identity_reviews_scope_idx` ON `identity_proposal_reviews` (`library_scope`,`organization_id`,`library_project_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_ruleset_semver_idx` ON `identity_ruleset_versions` (`semantic_version`,`checksum`);
--> statement-breakpoint
CREATE INDEX `identity_runs_scope_idx` ON `identity_resolution_runs` (`library_scope`,`organization_id`,`library_project_id`,`started_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS knowledge_facts_file_idx ON knowledge_facts(knowledge_file_id,fact_type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS knowledge_facts_search_idx ON knowledge_facts(organization_id,fact_type,normalized_value);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS knowledge_file_events_idx ON knowledge_file_events(knowledge_file_id,created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS knowledge_files_org_name_idx ON knowledge_files(organization_id,file_name);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS knowledge_files_org_type_idx ON knowledge_files(organization_id,detected_type,uploaded_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS knowledge_product_links_part_idx ON knowledge_product_links(organization_id,part_number,link_state);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS knowledge_promotions_entity_idx
ON knowledge_promotions(canonical_entity_type,canonical_entity_id,created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS knowledge_promotions_product_idx
ON knowledge_promotions(canonical_product_id,created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_permission_grants_active_user_idx`
  ON `library_permission_grants` (`user_id`) WHERE `status`='Active';
--> statement-breakpoint
CREATE INDEX `library_permission_grants_permission_status_idx`
  ON `library_permission_grants` (`permission`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_processing_idempotency_idx` ON `library_processing_jobs` (`kind`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `library_products_discovery_idx` ON `library_products` (`approved_for_discovery`,`lifecycle_status`);
--> statement-breakpoint
CREATE INDEX `library_products_family_idx` ON `library_products` (`family_id`,`review_status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_products_identity_idx` ON `library_products` (`manufacturer_id`,`normalized_part_number`);
--> statement-breakpoint
CREATE INDEX library_products_product_role_idx
ON library_products (
  product_role,
  identity_status,
  review_status
);
--> statement-breakpoint
CREATE INDEX `library_products_scope_idx` ON `library_products` (`library_scope`,`organization_id`,`library_project_id`,`identity_status`);
--> statement-breakpoint
CREATE UNIQUE INDEX manufacturer_order_code_observation_cycle_idx ON manufacturer_order_code_observations (observation_fingerprint, decision_id);
--> statement-breakpoint
CREATE INDEX `manufacturer_order_code_observation_product_idx` ON `manufacturer_order_code_observations` (`canonical_product_id`,`status`);
--> statement-breakpoint
CREATE INDEX `organization_audit_events_org_created_idx` ON `organization_audit_events` (`organization_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_membership_roles_active_idx` ON `organization_membership_roles` (`membership_id`,`role`);
--> statement-breakpoint
CREATE INDEX `organization_membership_roles_membership_status_idx` ON `organization_membership_roles` (`membership_id`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_memberships_org_user_idx` ON `organization_memberships` (`organization_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `organization_memberships_user_status_idx` ON `organization_memberships` (`user_id`,`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS presales_workflow_project_idx ON presales_workflow_snapshots(project_id,calculated_at);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_record_versions_idx` ON `price_record_versions` (`price_record_id`,`version_number`);
--> statement-breakpoint
CREATE INDEX `price_records_product_validity_idx` ON `price_records` (`product_id`,`approval_status`,`valid_until`);
--> statement-breakpoint
CREATE INDEX `price_records_project_idx` ON `price_records` (`project_id`,`approval_status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_records_source_product_location_idx` ON `price_records` (`source_id`,`product_id`,`source_location`);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_source_versions_idx` ON `price_source_versions` (`source_id`,`version_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `pricing_allocations_shared_line_idx` ON `pricing_cost_allocations` (`shared_cost_id`,`pricing_line_id`);
--> statement-breakpoint
CREATE INDEX `pricing_approvals_project_status_idx` ON `pricing_approvals` (`project_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `pricing_approvals_run_idx` ON `pricing_approvals` (`pricing_run_id`,`status`);
--> statement-breakpoint
CREATE INDEX `pricing_audit_project_idx` ON `pricing_audit_events` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `pricing_audit_run_idx` ON `pricing_audit_events` (`pricing_run_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `pricing_components_line_type_idx` ON `pricing_cost_components` (`pricing_line_id`,`component_type`);
--> statement-breakpoint
CREATE UNIQUE INDEX `pricing_discounts_line_order_idx` ON `pricing_discount_applications` (`pricing_line_id`,`order_number`);
--> statement-breakpoint
CREATE INDEX `pricing_exceptions_project_status_idx` ON `pricing_exceptions` (`project_id`,`status`,`expires_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pricing_journey_stage_idx ON pricing_journey_sources(learning_run_id,journey_stage);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pricing_learning_event_idx ON pricing_learning_events(learning_run_id,created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pricing_learning_runs_org_idx ON pricing_learning_runs(organization_id,completed_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pricing_learning_stage_project_idx ON pricing_learning_stage_results(organization_id,project_id,stage_order);
--> statement-breakpoint
CREATE INDEX `pricing_lines_candidate_idx` ON `pricing_lines` (`candidate_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `pricing_lines_project_status_idx` ON `pricing_lines` (`project_id`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `pricing_lines_run_item_idx` ON `pricing_lines` (`pricing_run_id`,`boq_item_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pricing_memory_product_idx ON pricing_memory_observations(organization_id,part_number,observation_type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pricing_memory_project_idx ON pricing_memory_observations(project_id,observation_type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pricing_memory_relationship_product_idx ON pricing_memory_relationships(organization_id,relationship_type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pricing_memory_supplier_idx ON pricing_memory_observations(organization_id,supplier,observation_type);
--> statement-breakpoint
CREATE UNIQUE INDEX `pricing_rates_project_pair_version_idx` ON `pricing_exchange_rates` (`project_id`,`from_currency`,`to_currency`,`version_number`);
--> statement-breakpoint
CREATE INDEX `pricing_rates_project_validity_idx` ON `pricing_exchange_rates` (`project_id`,`approval_status`,`valid_until`);
--> statement-breakpoint
CREATE UNIQUE INDEX `pricing_run_comparisons_pair_idx` ON `pricing_run_comparisons` (`previous_run_id`,`current_run_id`);
--> statement-breakpoint
CREATE INDEX `pricing_runs_fingerprint_idx` ON `pricing_runs` (`project_id`,`input_fingerprint`);
--> statement-breakpoint
CREATE INDEX `pricing_runs_project_status_idx` ON `pricing_runs` (`project_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `pricing_runs_scenario_version_idx` ON `pricing_runs` (`scenario_id`,`version_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `pricing_scenarios_project_name_version_idx` ON `pricing_scenarios` (`project_id`,`name`,`version_number`);
--> statement-breakpoint
CREATE INDEX `pricing_scenarios_project_status_idx` ON `pricing_scenarios` (`project_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `pricing_shared_costs_run_idx` ON `pricing_shared_costs` (`pricing_run_id`,`component_type`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pricing_similarity_lookup_idx ON pricing_project_similarity_signals(organization_id,signal_type,normalized_value);
--> statement-breakpoint
CREATE INDEX `processing_document_idx` ON `document_processing_runs` (`document_version_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `processing_history_run_idx` ON `processing_history` (`run_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `processing_logs_run_idx` ON `processing_logs` (`run_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `processing_status_idx` ON `document_processing_runs` (`status`,`available_at`,`priority`);
--> statement-breakpoint
CREATE INDEX `product_accessories_product_idx` ON `product_accessories` (`product_id`,`relationship_type`,`review_status`);
--> statement-breakpoint
CREATE INDEX `product_aliases_search_idx` ON `product_aliases` (`normalized_alias`,`review_status`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS product_attributes_active_protocol_singleton_idx
ON product_attributes (product_id, attribute_name)
WHERE attribute_name='protocol'
  AND variant_id IS NULL
  AND deleted_at IS NULL
  AND superseded_at IS NULL
  AND review_status<>'Rejected';
--> statement-breakpoint
CREATE INDEX `product_attributes_search_idx` ON `product_attributes` (`attribute_name`,`normalized_value`,`unit`,`review_status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_brands_manufacturer_name_idx` ON `product_brands` (`manufacturer_id`,`normalized_name`);
--> statement-breakpoint
CREATE INDEX `product_certifications_search_idx` ON `product_certifications` (`standard_body`,`standard_number`,`part`,`region`,`status`);
--> statement-breakpoint
CREATE INDEX `product_compatibility_source_idx` ON `product_compatibility` (`source_product_id`,`relationship_type`,`review_status`);
--> statement-breakpoint
CREATE INDEX `product_conflicts_scope_status_idx` ON `product_conflicts` (`library_scope`,`organization_id`,`library_project_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `product_documents_product_idx` ON `product_documents` (`product_id`,`document_type`,`review_status`);
--> statement-breakpoint
CREATE INDEX `product_families_brand_idx` ON `product_families` (`brand_id`,`normalized_name`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS product_identities_search_idx ON product_identities(organization_id,normalized_product_code,manufacturer,family,series,model);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS product_identities_status_idx ON product_identities(organization_id,review_status,lifecycle_status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS product_identity_aliases_search_idx ON product_identity_aliases(organization_id,normalized_alias);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS product_identity_events_org_idx ON product_identity_events(organization_id,created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS product_identity_observations_identity_idx ON product_identity_observations(product_identity_id,observation_type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS product_identity_observations_source_idx ON product_identity_observations(knowledge_file_id,knowledge_fact_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS product_identity_prices_identity_idx ON product_identity_prices(product_identity_id,currency,effective_date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS product_identity_promotions_product_idx
ON product_identity_promotions(library_product_id,created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS product_identity_relationships_source_idx ON product_identity_relationships(source_identity_id,relationship_type);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS product_identity_reviews_active_idx
ON product_identity_reviews(organization_id,product_identity_id) WHERE status='Active';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS product_identity_reviews_identity_idx
ON product_identity_reviews(product_identity_id,created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS product_identity_runs_org_idx ON product_identity_runs(organization_id,created_at);
--> statement-breakpoint
CREATE INDEX `product_library_decisions_entity_idx` ON `product_library_decisions` (`entity_type`,`entity_id`,`decided_at`);
--> statement-breakpoint
CREATE INDEX `product_lifecycle_part_idx` ON `product_lifecycle_events` (`obsolete_part_number`,`review_status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_manufacturers_name_idx` ON `product_manufacturers` (`normalized_name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_match_candidate_product_idx` ON `product_match_candidates` (`match_run_id`,`product_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_match_candidate_rank_idx` ON `product_match_candidates` (`match_run_id`,`rank`);
--> statement-breakpoint
CREATE INDEX `product_match_candidate_status_idx` ON `product_match_candidates` (`match_run_id`,`technical_status`,`review_status`);
--> statement-breakpoint
CREATE INDEX `product_match_comparisons_candidate_idx` ON `product_match_comparisons` (`candidate_id`,`comparison_type`,`result`);
--> statement-breakpoint
CREATE INDEX `product_match_reviews_candidate_idx` ON `product_match_reviews` (`candidate_id`,`decided_at`);
--> statement-breakpoint
CREATE INDEX `product_match_reviews_run_idx` ON `product_match_reviews` (`match_run_id`,`decided_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_match_run_comparison_pair_idx` ON `product_match_run_comparisons` (`previous_run_id`,`current_run_id`);
--> statement-breakpoint
CREATE INDEX `product_match_runs_fingerprint_idx` ON `product_match_runs` (`boq_item_id`,`input_fingerprint`);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_match_runs_item_version_idx` ON `product_match_runs` (`boq_item_id`,`version_number`);
--> statement-breakpoint
CREATE INDEX `product_match_runs_project_status_idx` ON `product_match_runs` (`project_id`,`status`,`started_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_source_evidence_idx` ON `product_source_evidence` (`product_id`,`source_id`,`sheet`,`row_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_sources_checksum_scope_idx` ON `product_sources` (`checksum`,`scope_type`,`project_id`);
--> statement-breakpoint
CREATE INDEX `product_sources_project_idx` ON `product_sources` (`project_id`,`source_type`,`review_status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_variants_key_idx` ON `product_variants` (`base_product_id`,`variant_type`,`variant_key`,`version_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_versions_identity_idx` ON `product_versions` (`product_id`,`version_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_applicability_requirement_idx` ON `profile_requirement_applicability` (`profile_version_id`,`requirement_id`);
--> statement-breakpoint
CREATE INDEX `profile_applicability_status_idx` ON `profile_requirement_applicability` (`profile_version_id`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_consolidated_key_idx` ON `consolidated_profile_requirements` (`profile_version_id`,`canonical_key`);
--> statement-breakpoint
CREATE INDEX `profile_decisions_profile_idx` ON `requirement_profile_decisions` (`profile_version_id`,`decided_at`);
--> statement-breakpoint
CREATE INDEX `profile_issues_type_status_idx` ON `profile_issues` (`profile_version_id`,`issue_type`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX project_context_extraction_fingerprint_idx
  ON project_context_extraction_versions(project_id, document_version_id, input_fingerprint);
--> statement-breakpoint
CREATE INDEX project_context_extraction_project_idx
  ON project_context_extraction_versions(project_id, status, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX project_context_extraction_version_idx
  ON project_context_extraction_versions(document_id, version_number);
--> statement-breakpoint
CREATE UNIQUE INDEX project_context_fact_key_idx
  ON project_context_facts(extraction_version_id, fact_key);
--> statement-breakpoint
CREATE INDEX project_context_fact_review_idx
  ON project_context_facts(project_id, review_status, requires_ai_interpretation);
--> statement-breakpoint
CREATE INDEX project_context_review_event_fact_idx
  ON project_context_review_events(fact_id, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX project_context_review_event_request_idx
  ON project_context_review_events(project_id, request_id);
--> statement-breakpoint
CREATE INDEX `project_dashboard_due_idx` ON `project_dashboard_profiles` (`due_date`,`manual_status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_dashboard_selected_pricing_scenario_idx`
  ON `project_dashboard_profiles` (`selected_pricing_scenario_id`);
--> statement-breakpoint
CREATE INDEX `project_dashboard_tender_idx` ON `project_dashboard_profiles` (`tender_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_members_project_user_idx` ON `project_members` (`project_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `project_members_user_status_idx` ON `project_members` (`user_id`,`status`);
--> statement-breakpoint
CREATE INDEX `project_members_user_status_project_idx` ON `project_members` (`user_id`,`status`,`project_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_npq_profile_current_idx
  ON project_npq_profile_versions(project_id, superseded_at, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_npq_profile_event_project_idx
  ON project_npq_profile_events(project_id, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS project_npq_profile_event_request_idx
  ON project_npq_profile_events(project_id, request_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_npq_profile_event_version_idx
  ON project_npq_profile_events(profile_version_id, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS project_npq_profile_fingerprint_idx
  ON project_npq_profile_versions(project_id, input_fingerprint);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_npq_profile_system_idx
  ON project_npq_profile_versions(primary_system, status);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS project_npq_profile_version_idx
  ON project_npq_profile_versions(project_id, version_number);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_progress_source_idx` ON `project_progress_snapshots` (`project_id`,`source_version`);
--> statement-breakpoint
CREATE INDEX `project_progress_status_idx` ON `project_progress_snapshots` (`derived_status`,`calculated_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_quotation_decisions_idx ON project_quotation_decisions(quotation_revision_id,created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_quotation_issues_project_idx ON project_quotation_issues(project_id,issued_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_quotation_status_idx ON project_quotation_revisions(project_id,status,revision_number);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_risk_source_idx` ON `project_risks` (`project_id`,`risk_type`,`source_version`);
--> statement-breakpoint
CREATE INDEX `project_risk_status_idx` ON `project_risks` (`project_id`,`status`,`severity`);
--> statement-breakpoint
CREATE INDEX `project_status_history_idx` ON `project_status_history` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `projects_operational_scope_idx`
ON `projects` (`organization_id`,`operational_classification`,`archived_at`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `projects_organization_active_idx` ON `projects` (`organization_id`,`archived_at`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `projects_owner_idx` ON `projects` (`owner_user_id`,`updated_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quotation_evidence_fingerprint_idx ON project_quotation_revisions(project_id,evidence_fingerprint,status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quotation_lines_pricing_idx
  ON project_quotation_lines(pricing_run_id, pricing_line_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quotation_lines_product_idx
  ON project_quotation_lines(product_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quotation_lines_project_idx
  ON project_quotation_lines(project_id, quotation_revision_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quotation_lines_revision_idx
  ON project_quotation_lines(quotation_revision_id, sequence);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS quotation_single_approval_decision_idx ON project_quotation_decisions(quotation_revision_id,action) WHERE action='Approve';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS quotation_single_issue_idx ON project_quotation_issues(quotation_revision_id);
--> statement-breakpoint
CREATE UNIQUE INDEX `regional_part_numbers_identity_idx` ON `regional_part_numbers` (`region`,`normalized_part_number`);
--> statement-breakpoint
CREATE INDEX `requirement_accessories_idx` ON `requirement_accessories` (`requirement_id`,`accessory`);
--> statement-breakpoint
CREATE INDEX `requirement_ambiguities_version_idx` ON `requirement_ambiguities` (`extraction_version_id`,`status`);
--> statement-breakpoint
CREATE INDEX `requirement_attributes_name_idx` ON `requirement_attributes` (`requirement_id`,`name`);
--> statement-breakpoint
CREATE INDEX `requirement_compatibility_idx` ON `requirement_compatibility` (`requirement_id`,`relationship_type`);
--> statement-breakpoint
CREATE INDEX `requirement_conflicts_version_idx` ON `requirement_conflicts` (`extraction_version_id`,`resolution_status`);
--> statement-breakpoint
CREATE INDEX `requirement_evidence_idx` ON `requirement_evidence` (`requirement_id`,`evidence_type`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `requirement_intelligence_profile_key_idx` ON `requirement_intelligence_facts` (`profile_version_id`,`fact_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `requirement_intelligence_review_idx` ON `requirement_intelligence_facts` (`profile_version_id`,`review_status`,`fact_type`);
--> statement-breakpoint
CREATE INDEX `requirement_manufacturers_idx` ON `requirement_manufacturers` (`requirement_id`,`manufacturer`);
--> statement-breakpoint
CREATE INDEX `requirement_missing_version_idx` ON `requirement_missing_information` (`extraction_version_id`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `requirement_profile_comparison_pair_idx` ON `requirement_profile_comparisons` (`previous_profile_version_id`,`current_profile_version_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `requirement_profile_item_version_idx` ON `requirement_profile_versions` (`boq_item_id`,`version_number`);
--> statement-breakpoint
CREATE INDEX `requirement_profile_project_status_idx` ON `requirement_profile_versions` (`project_id`,`status`,`readiness_status`);
--> statement-breakpoint
CREATE INDEX `requirement_review_decisions_idx` ON `requirement_review_decisions` (`requirement_id`,`decided_at`);
--> statement-breakpoint
CREATE INDEX `requirement_rule_scope_idx` ON `requirement_rules` (`rule_type`,`scope_type`,`scope_id`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `requirement_rule_version_idx` ON `requirement_rules` (`name`,`scope_type`,`scope_id`,`version_number`);
--> statement-breakpoint
CREATE INDEX `requirement_standards_body_idx` ON `requirement_standards` (`body`,`number`);
--> statement-breakpoint
CREATE INDEX `requirement_standards_requirement_idx` ON `requirement_standards` (`requirement_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_approval_step_order_idx` ON `review_approval_steps` (`review_item_id`,`group_key`,`step_order`);
--> statement-breakpoint
CREATE INDEX `review_approval_step_status_idx` ON `review_approval_steps` (`review_item_id`,`status`);
--> statement-breakpoint
CREATE INDEX `review_assignments_item_active_idx` ON `review_assignments` (`review_item_id`,`ended_at`);
--> statement-breakpoint
CREATE INDEX `review_attachments_item_idx` ON `review_attachments` (`review_item_id`,`added_at`);
--> statement-breakpoint
CREATE INDEX `review_audit_item_idx` ON `review_audit_log` (`review_item_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `review_audit_project_idx` ON `review_audit_log` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `review_clarifications_project_status_idx` ON `review_clarifications` (`project_id`,`status`,`due_date`);
--> statement-breakpoint
CREATE INDEX `review_comments_item_idx` ON `review_comments` (`review_item_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `review_conditions_item_status_idx` ON `review_approval_conditions` (`review_item_id`,`status`,`due_date`);
--> statement-breakpoint
CREATE INDEX `review_conflicts_item_idx` ON `review_conflict_resolutions` (`review_item_id`,`resolved_at`);
--> statement-breakpoint
CREATE INDEX `review_decisions_item_idx` ON `review_decisions` (`review_item_id`,`decided_at`);
--> statement-breakpoint
CREATE INDEX `review_decisions_project_idx` ON `review_decisions` (`project_id`,`decided_at`);
--> statement-breakpoint
CREATE INDEX `review_dependencies_item_status_idx` ON `review_dependencies` (`review_item_id`,`status`);
--> statement-breakpoint
CREATE INDEX `review_notifications_recipient_idx` ON `review_notifications` (`recipient_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `review_queue_assignee_due_idx` ON `review_queue_items` (`assigned_reviewer_id`,`due_date`);
--> statement-breakpoint
CREATE INDEX `review_queue_boq_idx` ON `review_queue_items` (`boq_item_id`,`review_type`);
--> statement-breakpoint
CREATE INDEX `review_queue_project_status_idx` ON `review_queue_items` (`project_id`,`status`,`priority`);
--> statement-breakpoint
CREATE INDEX `routing_handoffs_version_idx` ON `downstream_routing_handoffs` (`document_version_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `rule_execution_profile_idx` ON `requirement_rule_executions` (`profile_version_id`,`status`);
--> statement-breakpoint
CREATE INDEX `safety_approval_decision_idx` ON `safety_approval_requests` (`safety_decision_id`,`status`);
--> statement-breakpoint
CREATE INDEX `safety_approval_project_status_idx` ON `safety_approval_requests` (`project_id`,`status`,`approval_type`);
--> statement-breakpoint
CREATE INDEX `safety_blocks_code_idx` ON `safety_blocks` (`code`,`status`);
--> statement-breakpoint
CREATE INDEX `safety_blocks_decision_status_idx` ON `safety_blocks` (`safety_decision_id`,`status`,`severity`);
--> statement-breakpoint
CREATE UNIQUE INDEX `safety_decision_comparison_pair_idx` ON `safety_decision_comparisons` (`previous_decision_id`,`current_decision_id`);
--> statement-breakpoint
CREATE INDEX `safety_decisions_fingerprint_idx` ON `safety_decisions` (`boq_item_id`,`candidate_id`,`input_fingerprint`);
--> statement-breakpoint
CREATE INDEX `safety_decisions_project_state_idx` ON `safety_decisions` (`project_id`,`safety_state`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `safety_decisions_scope_version_idx` ON `safety_decisions` (`boq_item_id`,`candidate_id`,`version_number`);
--> statement-breakpoint
CREATE INDEX `safety_overrides_decision_status_idx` ON `safety_overrides` (`safety_decision_id`,`status`);
--> statement-breakpoint
CREATE INDEX `safety_overrides_project_expiry_idx` ON `safety_overrides` (`project_id`,`expires_at`,`status`);
--> statement-breakpoint
CREATE INDEX `safety_warnings_decision_idx` ON `safety_warnings` (`safety_decision_id`,`acknowledgment_required`,`acknowledged_at`);
--> statement-breakpoint
CREATE INDEX `spec_checkpoint_job_idx` ON `specification_extraction_checkpoints` (`job_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `spec_chunk_claim_idx` ON `specification_extraction_chunks` (`job_id`,`status`,`priority`,`chunk_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `spec_chunk_entity_fingerprint_idx` ON `specification_chunk_entities` (`job_id`,`fingerprint`);
--> statement-breakpoint
CREATE INDEX `spec_chunk_entity_type_idx` ON `specification_chunk_entities` (`job_id`,`entity_type`,`page_from`);
--> statement-breakpoint
CREATE UNIQUE INDEX `spec_chunk_metric_chunk_idx` ON `specification_chunk_metrics` (`chunk_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `spec_chunk_number_idx` ON `specification_extraction_chunks` (`job_id`,`chunk_number`);
--> statement-breakpoint
CREATE INDEX `spec_clauses_number_idx` ON `specification_clauses` (`extraction_version_id`,`number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `spec_clauses_sequence_idx` ON `specification_clauses` (`extraction_version_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `spec_document_map_detail_range_idx` ON `specification_document_map_details` (`job_id`,`start_page`,`end_page`);
--> statement-breakpoint
CREATE INDEX `spec_document_map_job_idx` ON `specification_document_map_entries` (`job_id`,`page_number`);
--> statement-breakpoint
CREATE INDEX `spec_extraction_document_idx` ON `specification_extraction_versions` (`document_id`,`started_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `spec_extraction_version_number_idx` ON `specification_extraction_versions` (`document_id`,`version_number`);
--> statement-breakpoint
CREATE INDEX `spec_failure_job_idx` ON `specification_extraction_failures` (`job_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `spec_job_document_idx` ON `specification_extraction_jobs` (`document_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `spec_job_extraction_idx` ON `specification_extraction_jobs` (`extraction_version_id`);
--> statement-breakpoint
CREATE INDEX `spec_job_status_checkpoint_idx` ON `specification_extraction_jobs` (`status`,`last_checkpoint_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `spec_page_job_number_idx` ON `specification_extraction_pages` (`job_id`,`page_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `spec_revision_pair_idx` ON `specification_revision_comparisons` (`previous_extraction_version_id`,`current_extraction_version_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `spec_sections_sequence_idx` ON `specification_sections` (`extraction_version_id`,`sequence`);
--> statement-breakpoint
CREATE UNIQUE INDEX `standards_bodies_code_unique` ON `standards_bodies` (`code`);
--> statement-breakpoint
CREATE INDEX supplier_quote_intake_events_row_idx ON supplier_quote_intake_events(row_id, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX supplier_quote_intake_fingerprint_idx ON supplier_quote_intake_runs(project_id, document_version_id, input_fingerprint);
--> statement-breakpoint
CREATE INDEX supplier_quote_intake_product_idx ON supplier_quote_intake_rows(product_id, review_status);
--> statement-breakpoint
CREATE INDEX supplier_quote_intake_project_idx ON supplier_quote_intake_runs(project_id, status, created_at);
--> statement-breakpoint
CREATE INDEX supplier_quote_intake_review_idx ON supplier_quote_intake_rows(project_id, review_status, row_type);
--> statement-breakpoint
CREATE UNIQUE INDEX supplier_quote_intake_row_idx ON supplier_quote_intake_rows(intake_run_id, sheet_name, row_number);
--> statement-breakpoint
CREATE UNIQUE INDEX `supplier_quote_lines_identity_idx` ON `supplier_quote_lines` (`supplier_quote_id`,`line_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX supplier_quote_lines_intake_row_idx ON supplier_quote_lines(source_intake_row_id);
--> statement-breakpoint
CREATE UNIQUE INDEX supplier_quotes_document_version_idx ON supplier_quotes(project_id, supplier_id, quote_number, source_document_version_id);
--> statement-breakpoint
CREATE UNIQUE INDEX `supplier_quotes_version_idx` ON `supplier_quotes` (`supplier_id`,`quote_number`,`quote_version`);
--> statement-breakpoint
CREATE UNIQUE INDEX `suppliers_name_idx` ON `suppliers` (`normalized_name`);
--> statement-breakpoint
CREATE INDEX `technical_requirements_downstream_idx` ON `technical_requirements` (`project_id`,`approved_for_downstream`);
--> statement-breakpoint
CREATE INDEX `technical_requirements_project_review_idx` ON `technical_requirements` (`project_id`,`review_status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `technical_requirements_sequence_idx` ON `technical_requirements` (`extraction_version_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `upload_sessions_project_idx` ON `upload_sessions` (`project_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `workflow_stage_project_status_idx` ON `workflow_stage_states` (`project_id`,`status`,`calculated_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_stage_project_version_idx` ON `workflow_stage_states` (`project_id`,`stage_id`,`source_version`);
--> statement-breakpoint
CREATE VIEW `canonical_classifications` AS
SELECT
  dc.`id`,
  dc.`document_id`,
  dc.`document_version_id`,
  dc.`processing_run_id`,
  dc.`model_version_id`,
  dc.`primary_type`,
  dc.`secondary_types`,
  dc.`confidence`,
  dc.`confidence_state`,
  dc.`status`,
  dc.`method`,
  dc.`extraction_method`,
  dc.`extraction_quality_basis_points`,
  dc.`mixed`,
  dc.`manual_review_required`,
  dc.`downstream_route`,
  dc.`error_code`,
  dc.`error_message`,
  dc.`technical_details`,
  dc.`suggested_action`,
  dc.`confirmed_by`,
  dc.`confirmed_at`,
  dc.`classified_at`,
  dc.`superseded_at`,
  CASE
    WHEN dc.primary_type IS NULL OR TRIM(dc.primary_type) = '' THEN 'Unknown'
    WHEN TRIM(dc.primary_type) = 'Specification' THEN 'Technical Specification'
    WHEN TRIM(dc.primary_type) = 'Catalogue' THEN 'Product Catalogue'
    WHEN TRIM(dc.primary_type) = 'Datasheet' THEN 'Product Datasheet'
    WHEN TRIM(dc.primary_type) = 'Supplier Quote' THEN 'Supplier Quotation'
    WHEN TRIM(dc.primary_type) = 'Compliance' THEN 'Compliance Document'
    WHEN TRIM(dc.primary_type) = 'Email' THEN 'Project Email'
    WHEN TRIM(dc.primary_type) = 'Previous Project' THEN 'Previous Project Reference'
    ELSE TRIM(dc.primary_type)
  END AS `canonical_type`
FROM `document_classifications` dc;
--> statement-breakpoint
CREATE VIEW `canonical_library_products` AS
WITH RECURSIVE product_chain(requested_product_id,current_product_id,depth,path) AS (
  SELECT id,id,0,'|'||id||'|' FROM library_products
  UNION ALL
  SELECT chain.requested_product_id,p.superseded_by_product_id,chain.depth+1,chain.path||p.superseded_by_product_id||'|'
  FROM product_chain chain JOIN library_products p ON p.id=chain.current_product_id
  WHERE p.identity_status='Superseded' AND p.superseded_by_product_id IS NOT NULL
    AND chain.depth<32 AND instr(chain.path,'|'||p.superseded_by_product_id||'|')=0
)
SELECT chain.requested_product_id,p.* FROM product_chain chain JOIN library_products p ON p.id=chain.current_product_id
WHERE p.identity_status<>'Superseded';
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS applicability_decisions_immutable_delete
BEFORE DELETE ON engineering_knowledge_decisions
WHEN OLD.entity_type = 'BOQ Requirement Link'
BEGIN
  SELECT RAISE(ABORT, 'applicability decisions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS applicability_decisions_immutable_update
BEFORE UPDATE ON engineering_knowledge_decisions
WHEN OLD.entity_type = 'BOQ Requirement Link'
BEGIN
  SELECT RAISE(ABORT, 'applicability decisions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `canonical_evidence_immutable_delete`
BEFORE DELETE ON `product_source_evidence`
WHEN EXISTS (SELECT 1 FROM canonical_evidence_integrity i WHERE i.evidence_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'IDENTITY_EVIDENCE_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `canonical_evidence_immutable_update`
BEFORE UPDATE OF `source_id`,`sheet`,`row_number`,`page`,`cells`,`original_text`,`parser_version` ON `product_source_evidence`
BEGIN SELECT RAISE(ABORT,'IDENTITY_EVIDENCE_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER estimator_understanding_review_current_evidence_guard
BEFORE INSERT ON estimator_understanding_review_versions
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM boq_items b
    JOIN boq_extraction_versions e ON e.id=b.extraction_version_id AND e.document_id=b.source_document_id
    JOIN documents d ON d.id=e.document_id AND d.project_id=b.project_id AND d.deleted_at IS NULL AND d.archived_at IS NULL
    JOIN document_versions dv ON dv.id=e.document_version_id AND dv.document_id=d.id AND d.current_version_id=dv.id
    JOIN estimator_item_interpretations i ON i.id=NEW.interpretation_id AND i.boq_item_id=b.id AND i.input_fingerprint=NEW.source_input_fingerprint
    WHERE b.id=NEW.boq_item_id
      AND b.project_id=NEW.project_id
      AND b.row_type IN ('Item','BOQ Item')
      AND e.document_version_id=NEW.source_document_version_id
      AND e.version_number=NEW.source_extraction_version
      AND e.superseded_at IS NULL
      AND e.status IN ('Completed','Needs Review')
      AND NOT EXISTS (SELECT 1 FROM boq_extraction_versions newer WHERE newer.document_id=e.document_id AND newer.document_version_id=e.document_version_id AND newer.superseded_at IS NULL AND newer.status IN ('Completed','Needs Review') AND (newer.version_number>e.version_number OR (newer.version_number=e.version_number AND newer.id>e.id)))
      AND NOT EXISTS (SELECT 1 FROM estimator_item_interpretations newer_i WHERE newer_i.boq_item_id=i.boq_item_id AND newer_i.version_number>i.version_number AND newer_i.input_fingerprint=i.input_fingerprint AND newer_i.status IN ('COMPLETED','NEEDS_REVIEW'))
  ) THEN RAISE(ABORT, 'understanding review evidence is stale') END;
END;
--> statement-breakpoint
CREATE TRIGGER estimator_understanding_review_events_immutable_delete
BEFORE DELETE ON estimator_understanding_review_events
BEGIN
  SELECT RAISE(ABORT, 'estimator understanding review events are append only');
END;
--> statement-breakpoint
CREATE TRIGGER estimator_understanding_review_events_immutable_update
BEFORE UPDATE ON estimator_understanding_review_events
BEGIN
  SELECT RAISE(ABORT, 'estimator understanding review events are append only');
END;
--> statement-breakpoint
CREATE TRIGGER estimator_understanding_review_versions_immutable_delete
BEFORE DELETE ON estimator_understanding_review_versions
BEGIN
  SELECT RAISE(ABORT, 'estimator understanding review versions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER estimator_understanding_review_versions_immutable_update
BEFORE UPDATE ON estimator_understanding_review_versions
BEGIN
  SELECT RAISE(ABORT, 'estimator understanding review versions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `identity_mutation_guard_validate`
BEFORE INSERT ON `identity_mutation_guards`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM identity_resolution_proposals p
    JOIN identity_resolution_cases c ON c.id=p.case_id
    JOIN identity_resolution_runs r ON r.id=c.run_id
    JOIN identity_ruleset_versions v ON v.id=r.ruleset_version_id
    WHERE p.id=NEW.proposal_id AND p.version_number=NEW.proposal_version
      AND p.proposal_fingerprint=NEW.proposal_fingerprint
      AND r.ruleset_version_id=NEW.ruleset_version_id AND v.checksum=NEW.ruleset_checksum
      AND p.library_scope=NEW.library_scope
      AND COALESCE(p.organization_id,'')=COALESCE(NEW.organization_id,'')
      AND COALESCE(p.library_project_id,'')=COALESCE(NEW.library_project_id,'')
  ) THEN RAISE(ABORT,'IDENTITY_MUTATION_STALE') END;
END;
--> statement-breakpoint
CREATE TRIGGER `identity_reference_guard_validate` BEFORE INSERT ON `identity_reference_guards`
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM product_reference_versions v WHERE v.table_name=NEW.table_name AND v.record_id=NEW.record_id AND v.version_number=NEW.expected_version)
    THEN RAISE(ABORT,'IDENTITY_MUTATION_STALE') END;
END;
--> statement-breakpoint
CREATE TRIGGER `organization_audit_events_no_delete` BEFORE DELETE ON `organization_audit_events`
BEGIN SELECT RAISE(ABORT, 'ORGANIZATION_AUDIT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `organization_audit_events_no_update` BEFORE UPDATE ON `organization_audit_events`
BEGIN SELECT RAISE(ABORT, 'ORGANIZATION_AUDIT_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `price_records_reference_version_delete` BEFORE DELETE ON `price_records`
BEGIN UPDATE product_reference_versions SET version_number=version_number+1 WHERE table_name='price_records' AND record_id=OLD.id; END;
--> statement-breakpoint
CREATE TRIGGER `price_records_reference_version_insert` AFTER INSERT ON `price_records`
BEGIN INSERT OR IGNORE INTO product_reference_versions(table_name,record_id,version_number) VALUES ('price_records',NEW.id,1); END;
--> statement-breakpoint
CREATE TRIGGER `price_records_reference_version_update` AFTER UPDATE ON `price_records`
BEGIN UPDATE product_reference_versions SET version_number=version_number+1 WHERE table_name='price_records' AND record_id=NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER `product_source_evidence_reference_version_insert` AFTER INSERT ON `product_source_evidence`
BEGIN INSERT OR IGNORE INTO product_reference_versions(table_name,record_id,version_number) VALUES ('product_source_evidence',NEW.id,1); END;
--> statement-breakpoint
CREATE TRIGGER `product_source_evidence_reference_version_update` AFTER UPDATE ON `product_source_evidence`
BEGIN UPDATE product_reference_versions SET version_number=version_number+1 WHERE table_name='product_source_evidence' AND record_id=NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS project_npq_confirmed_update_guard
BEFORE UPDATE ON project_npq_profile_versions
WHEN OLD.status = 'Confirmed'
  AND (
    NEW.project_id <> OLD.project_id
    OR NEW.version_number <> OLD.version_number
    OR COALESCE(NEW.country,'') <> COALESCE(OLD.country,'')
    OR COALESCE(NEW.city,'') <> COALESCE(OLD.city,'')
    OR COALESCE(NEW.location,'') <> COALESCE(OLD.location,'')
    OR NEW.primary_system <> OLD.primary_system
    OR NEW.additional_systems_json <> OLD.additional_systems_json
    OR NEW.delivery_scope <> OLD.delivery_scope
    OR NEW.manufacturer_strategy <> OLD.manufacturer_strategy
    OR COALESCE(NEW.preferred_manufacturer,'') <> COALESCE(OLD.preferred_manufacturer,'')
    OR NEW.approved_manufacturers_json <> OLD.approved_manufacturers_json
    OR NEW.pricing_strategy <> OLD.pricing_strategy
    OR COALESCE(NEW.primary_pricing_source_type,'') <> COALESCE(OLD.primary_pricing_source_type,'')
    OR COALESCE(NEW.primary_pricing_source_id,'') <> COALESCE(OLD.primary_pricing_source_id,'')
    OR NEW.fallback_pricing_sources_json <> OLD.fallback_pricing_sources_json
    OR NEW.project_currency <> OLD.project_currency
    OR NEW.expected_evidence_json <> OLD.expected_evidence_json
    OR NEW.input_fingerprint <> OLD.input_fingerprint
  )
BEGIN
  SELECT RAISE(ABORT, 'CONFIRMED_NPQ_PROFILE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS project_npq_event_delete_guard
BEFORE DELETE ON project_npq_profile_events
BEGIN
  SELECT RAISE(ABORT, 'NPQ_PROFILE_EVENT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS project_npq_event_update_guard
BEFORE UPDATE ON project_npq_profile_events
BEGIN
  SELECT RAISE(ABORT, 'NPQ_PROFILE_EVENT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS quotation_approval_transition_guard
BEFORE INSERT ON project_quotation_decisions WHEN NEW.action='Approve'
BEGIN
  SELECT CASE WHEN COALESCE((SELECT status FROM project_quotation_revisions WHERE id=NEW.quotation_revision_id),'Missing')<>'Draft'
    THEN RAISE(ABORT,'QUOTATION_APPROVAL_STALE') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS quotation_issue_transition_guard
BEFORE INSERT ON project_quotation_issues
BEGIN
  SELECT CASE WHEN COALESCE((SELECT status FROM project_quotation_revisions WHERE id=NEW.quotation_revision_id),'Missing')<>'Approved'
    THEN RAISE(ABORT,'QUOTATION_ISSUE_STALE') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS quotation_line_snapshot_delete_guard
BEFORE DELETE ON project_quotation_lines
BEGIN
  SELECT RAISE(ABORT, 'QUOTATION_LINE_SNAPSHOT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS quotation_line_snapshot_update_guard
BEFORE UPDATE ON project_quotation_lines
BEGIN
  SELECT RAISE(ABORT, 'QUOTATION_LINE_SNAPSHOT_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS quotation_revision_payload_update_guard
BEFORE UPDATE ON project_quotation_revisions
WHEN
     NEW.id                    IS NOT OLD.id
  OR NEW.project_id            IS NOT OLD.project_id
  OR NEW.revision_number       IS NOT OLD.revision_number
  OR NEW.quotation_fingerprint IS NOT OLD.quotation_fingerprint
  OR NEW.workflow_snapshot_id  IS NOT OLD.workflow_snapshot_id
  OR NEW.currency              IS NOT OLD.currency
  OR NEW.subtotal_minor        IS NOT OLD.subtotal_minor
  OR NEW.vat_basis_points      IS NOT OLD.vat_basis_points
  OR NEW.vat_minor             IS NOT OLD.vat_minor
  OR NEW.total_minor           IS NOT OLD.total_minor
  OR NEW.terms_json            IS NOT OLD.terms_json
  OR NEW.source_summary_json   IS NOT OLD.source_summary_json
  OR NEW.created_by            IS NOT OLD.created_by
  OR NEW.created_at            IS NOT OLD.created_at
  OR NEW.evidence_fingerprint  IS NOT OLD.evidence_fingerprint
  OR NEW.evidence_manifest_json IS NOT OLD.evidence_manifest_json
  OR NEW.terms_provenance_json IS NOT OLD.terms_provenance_json
BEGIN
  SELECT RAISE(ABORT, 'QUOTATION_REVISION_PAYLOAD_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `requirement_profile_decisions_immutable_delete`
BEFORE DELETE ON `requirement_profile_decisions`
BEGIN SELECT RAISE(ABORT, 'requirement profile decisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `requirement_profile_decisions_immutable_update`
BEFORE UPDATE ON `requirement_profile_decisions`
BEGIN SELECT RAISE(ABORT, 'requirement profile decisions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS requirement_review_decisions_immutable_delete
BEFORE DELETE ON requirement_review_decisions
BEGIN
  SELECT RAISE(ABORT, 'requirement review decisions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS requirement_review_decisions_immutable_update
BEFORE UPDATE ON requirement_review_decisions
BEGIN
  SELECT RAISE(ABORT, 'requirement review decisions are immutable');
END;
