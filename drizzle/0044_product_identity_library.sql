-- Product Identity Library: evidence-backed identities derived only from Knowledge Library observations.
CREATE TABLE IF NOT EXISTS product_identity_rulesets (
  id TEXT PRIMARY KEY, version TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
  rules_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_identity_runs (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, ruleset_id TEXT NOT NULL REFERENCES product_identity_rulesets(id),
  input_fingerprint TEXT NOT NULL, status TEXT NOT NULL, observation_count INTEGER NOT NULL,
  identity_count INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT,
  UNIQUE(organization_id,input_fingerprint)
);
CREATE INDEX IF NOT EXISTS product_identity_runs_org_idx ON product_identity_runs(organization_id,created_at);

CREATE TABLE IF NOT EXISTS product_identities (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, identity_key TEXT NOT NULL,
  manufacturer TEXT, brand TEXT, family TEXT, series TEXT, model TEXT,
  official_product_code TEXT NOT NULL, normalized_product_code TEXT NOT NULL,
  description TEXT, category TEXT, sub_category TEXT, system TEXT, unit TEXT,
  lifecycle_status TEXT NOT NULL DEFAULT 'Unknown', confidence INTEGER NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'Needs Review', version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, superseded_at TEXT,
  UNIQUE(organization_id,identity_key)
);
CREATE INDEX IF NOT EXISTS product_identities_search_idx ON product_identities(organization_id,normalized_product_code,manufacturer,family,series,model);
CREATE INDEX IF NOT EXISTS product_identities_status_idx ON product_identities(organization_id,review_status,lifecycle_status);

CREATE TABLE IF NOT EXISTS product_identity_observations (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, product_identity_id TEXT NOT NULL REFERENCES product_identities(id),
  knowledge_file_id TEXT NOT NULL REFERENCES knowledge_files(id), knowledge_fact_id TEXT NOT NULL REFERENCES knowledge_facts(id),
  observation_key TEXT NOT NULL, observation_type TEXT NOT NULL, original_value TEXT NOT NULL,
  normalized_value TEXT NOT NULL, attributes TEXT NOT NULL DEFAULT '{}', source_location TEXT NOT NULL DEFAULT '{}',
  confidence INTEGER NOT NULL, observed_date TEXT, region TEXT, source_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_identity_id,knowledge_fact_id)
);
CREATE INDEX IF NOT EXISTS product_identity_observations_identity_idx ON product_identity_observations(product_identity_id,observation_type);
CREATE INDEX IF NOT EXISTS product_identity_observations_source_idx ON product_identity_observations(knowledge_file_id,knowledge_fact_id);

CREATE TABLE IF NOT EXISTS product_identity_aliases (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, product_identity_id TEXT NOT NULL REFERENCES product_identities(id),
  alias TEXT NOT NULL, normalized_alias TEXT NOT NULL, alias_type TEXT NOT NULL,
  knowledge_fact_id TEXT NOT NULL REFERENCES knowledge_facts(id), confidence INTEGER NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'Needs Review', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_identity_id,normalized_alias,knowledge_fact_id)
);
CREATE INDEX IF NOT EXISTS product_identity_aliases_search_idx ON product_identity_aliases(organization_id,normalized_alias);

CREATE TABLE IF NOT EXISTS product_identity_prices (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, product_identity_id TEXT NOT NULL REFERENCES product_identities(id),
  knowledge_fact_id TEXT NOT NULL REFERENCES knowledge_facts(id), price_amount TEXT NOT NULL,
  currency TEXT NOT NULL, region TEXT, effective_date TEXT, validity TEXT,
  price_type TEXT NOT NULL DEFAULT 'Historical Catalogue Price', discovery_status TEXT NOT NULL DEFAULT 'Discovery Only',
  costing_eligible INTEGER NOT NULL DEFAULT 0, source_location TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_identity_id,knowledge_fact_id)
);
CREATE INDEX IF NOT EXISTS product_identity_prices_identity_idx ON product_identity_prices(product_identity_id,currency,effective_date);

CREATE TABLE IF NOT EXISTS product_identity_relationships (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, source_identity_id TEXT NOT NULL REFERENCES product_identities(id),
  target_identity_id TEXT REFERENCES product_identities(id), target_code TEXT NOT NULL,
  relationship_type TEXT NOT NULL, knowledge_fact_id TEXT NOT NULL REFERENCES knowledge_facts(id),
  evidence TEXT NOT NULL, confidence INTEGER NOT NULL, review_status TEXT NOT NULL DEFAULT 'Needs Review',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_identity_id,relationship_type,target_code,knowledge_fact_id)
);
CREATE INDEX IF NOT EXISTS product_identity_relationships_source_idx ON product_identity_relationships(source_identity_id,relationship_type);

CREATE TABLE IF NOT EXISTS product_identity_events (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, product_identity_id TEXT,
  run_id TEXT REFERENCES product_identity_runs(id), event_type TEXT NOT NULL,
  details TEXT NOT NULL, actor_user_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS product_identity_events_org_idx ON product_identity_events(organization_id,created_at);
