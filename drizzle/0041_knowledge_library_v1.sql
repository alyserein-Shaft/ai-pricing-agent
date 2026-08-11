-- Simple company Knowledge Library V1: Upload -> Learn -> Organize -> Use.
CREATE TABLE IF NOT EXISTS knowledge_files (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, file_name TEXT NOT NULL,
  extension TEXT NOT NULL, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL, object_key TEXT NOT NULL, detected_type TEXT NOT NULL,
  secondary_types TEXT NOT NULL DEFAULT '[]', classification_confidence INTEGER NOT NULL,
  classification_status TEXT NOT NULL, processing_status TEXT NOT NULL,
  extraction_method TEXT, extraction_version TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '{}', uploaded_by TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, processed_at TEXT,
  UNIQUE(organization_id,sha256)
);
CREATE INDEX IF NOT EXISTS knowledge_files_org_type_idx ON knowledge_files(organization_id,detected_type,uploaded_at);
CREATE INDEX IF NOT EXISTS knowledge_files_org_name_idx ON knowledge_files(organization_id,file_name);

CREATE TABLE IF NOT EXISTS knowledge_facts (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, knowledge_file_id TEXT NOT NULL REFERENCES knowledge_files(id),
  fact_type TEXT NOT NULL, fact_key TEXT NOT NULL, original_value TEXT NOT NULL,
  normalized_value TEXT NOT NULL, attributes TEXT NOT NULL DEFAULT '{}',
  confidence INTEGER NOT NULL, review_status TEXT NOT NULL DEFAULT 'Learned',
  source_location TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(knowledge_file_id,fact_type,fact_key,normalized_value)
);
CREATE INDEX IF NOT EXISTS knowledge_facts_search_idx ON knowledge_facts(organization_id,fact_type,normalized_value);
CREATE INDEX IF NOT EXISTS knowledge_facts_file_idx ON knowledge_facts(knowledge_file_id,fact_type);

CREATE TABLE IF NOT EXISTS knowledge_product_links (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, knowledge_fact_id TEXT NOT NULL REFERENCES knowledge_facts(id),
  part_number TEXT NOT NULL, existing_product_id TEXT, link_state TEXT NOT NULL,
  new_information TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(knowledge_fact_id,part_number)
);
CREATE INDEX IF NOT EXISTS knowledge_product_links_part_idx ON knowledge_product_links(organization_id,part_number,link_state);

CREATE TABLE IF NOT EXISTS knowledge_file_events (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, knowledge_file_id TEXT NOT NULL REFERENCES knowledge_files(id),
  event_type TEXT NOT NULL, details TEXT NOT NULL, actor_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS knowledge_file_events_idx ON knowledge_file_events(knowledge_file_id,created_at);

