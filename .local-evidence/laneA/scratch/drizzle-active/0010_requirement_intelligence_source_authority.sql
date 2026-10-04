PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_requirement_intelligence_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_version_id` text NOT NULL,
	`requirement_source` text DEFAULT 'Specification' NOT NULL,
	`requirement_id` text,
	`device_identity_ref` text,
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
	FOREIGN KEY (`profile_version_id`) REFERENCES `requirement_profile_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requirement_id`) REFERENCES `technical_requirements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_requirement_intelligence_facts`("id", "profile_version_id", "requirement_source", "requirement_id", "device_identity_ref", "fact_key", "fact_type", "original_value", "current_value", "modality", "confidence", "source_page", "source_page_to", "source_clause", "source_section", "evidence_snippet", "extraction_basis", "engine_version", "review_status", "reviewed_by", "reviewed_at", "review_reason", "created_at") SELECT "id", "profile_version_id", "requirement_source", "requirement_id", "device_identity_ref", "fact_key", "fact_type", "original_value", "current_value", "modality", "confidence", "source_page", "source_page_to", "source_clause", "source_section", "evidence_snippet", "extraction_basis", "engine_version", "review_status", "reviewed_by", "reviewed_at", "review_reason", "created_at" FROM `requirement_intelligence_facts`;--> statement-breakpoint
DROP TABLE `requirement_intelligence_facts`;--> statement-breakpoint
ALTER TABLE `__new_requirement_intelligence_facts` RENAME TO `requirement_intelligence_facts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `requirement_intelligence_profile_key_idx` ON `requirement_intelligence_facts` (`profile_version_id`,`fact_key`);--> statement-breakpoint
CREATE INDEX `requirement_intelligence_review_idx` ON `requirement_intelligence_facts` (`profile_version_id`,`review_status`,`fact_type`);