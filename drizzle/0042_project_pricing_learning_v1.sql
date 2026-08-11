-- Project Pricing Learning Engine V1. Historical evidence only.
CREATE TABLE IF NOT EXISTS pricing_learning_runs (
 id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,project_id TEXT NOT NULL,
 project_snapshot TEXT NOT NULL,input_fingerprint TEXT NOT NULL,engine_version TEXT NOT NULL,
 status TEXT NOT NULL,summary TEXT NOT NULL DEFAULT '{}',started_by TEXT NOT NULL,
 started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,completed_at TEXT,error_message TEXT,
 UNIQUE(project_id,input_fingerprint)
);
CREATE INDEX IF NOT EXISTS pricing_learning_runs_org_idx ON pricing_learning_runs(organization_id,completed_at);

CREATE TABLE IF NOT EXISTS pricing_journey_sources (
 id TEXT PRIMARY KEY,learning_run_id TEXT NOT NULL REFERENCES pricing_learning_runs(id),
 project_id TEXT NOT NULL,document_id TEXT,document_version_id TEXT,journey_stage TEXT NOT NULL,
 source_type TEXT NOT NULL,file_name TEXT NOT NULL,sha256 TEXT,revision TEXT,source_date TEXT,
 evidence_quality TEXT NOT NULL,provenance TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(learning_run_id,document_version_id,journey_stage)
);
CREATE INDEX IF NOT EXISTS pricing_journey_stage_idx ON pricing_journey_sources(learning_run_id,journey_stage);

CREATE TABLE IF NOT EXISTS pricing_memory_observations (
 id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,learning_run_id TEXT NOT NULL REFERENCES pricing_learning_runs(id),
 project_id TEXT NOT NULL,boq_item_id TEXT,observation_type TEXT NOT NULL,observation_key TEXT NOT NULL,
 manufacturer TEXT,part_number TEXT,product_family TEXT,supplier TEXT,currency TEXT,
 amount_minor INTEGER,percentage_basis_points INTEGER,quantity TEXT,unit TEXT,
 original_value TEXT NOT NULL,normalized_value TEXT,attributes TEXT NOT NULL DEFAULT '{}',
 evidence_document_id TEXT,evidence_document_version_id TEXT,evidence_location TEXT NOT NULL DEFAULT '{}',
 evidence_quality TEXT NOT NULL,confidence INTEGER NOT NULL,historical_only INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(learning_run_id,observation_type,observation_key,evidence_document_version_id)
);
CREATE INDEX IF NOT EXISTS pricing_memory_product_idx ON pricing_memory_observations(organization_id,part_number,observation_type);
CREATE INDEX IF NOT EXISTS pricing_memory_project_idx ON pricing_memory_observations(project_id,observation_type);
CREATE INDEX IF NOT EXISTS pricing_memory_supplier_idx ON pricing_memory_observations(organization_id,supplier,observation_type);

CREATE TABLE IF NOT EXISTS pricing_memory_relationships (
 id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,learning_run_id TEXT NOT NULL REFERENCES pricing_learning_runs(id),
 project_id TEXT NOT NULL,from_observation_id TEXT NOT NULL REFERENCES pricing_memory_observations(id),
 to_observation_id TEXT NOT NULL REFERENCES pricing_memory_observations(id),relationship_type TEXT NOT NULL,
 basis TEXT NOT NULL,evidence TEXT NOT NULL,confidence INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(learning_run_id,from_observation_id,to_observation_id,relationship_type)
);
CREATE INDEX IF NOT EXISTS pricing_memory_relationship_product_idx ON pricing_memory_relationships(organization_id,relationship_type);

CREATE TABLE IF NOT EXISTS pricing_project_similarity_signals (
 id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,learning_run_id TEXT NOT NULL REFERENCES pricing_learning_runs(id),
 project_id TEXT NOT NULL,signal_type TEXT NOT NULL,signal_value TEXT NOT NULL,
 normalized_value TEXT NOT NULL,weight REAL NOT NULL,evidence TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(learning_run_id,signal_type,normalized_value)
);
CREATE INDEX IF NOT EXISTS pricing_similarity_lookup_idx ON pricing_project_similarity_signals(organization_id,signal_type,normalized_value);

CREATE TABLE IF NOT EXISTS pricing_learning_events (
 id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,learning_run_id TEXT NOT NULL REFERENCES pricing_learning_runs(id),
 event_type TEXT NOT NULL,details TEXT NOT NULL,actor_user_id TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS pricing_learning_event_idx ON pricing_learning_events(learning_run_id,created_at);

