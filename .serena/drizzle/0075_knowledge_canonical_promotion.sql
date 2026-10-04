CREATE TABLE IF NOT EXISTS knowledge_promotions (
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

CREATE INDEX IF NOT EXISTS knowledge_promotions_product_idx
ON knowledge_promotions(canonical_product_id,created_at);

CREATE INDEX IF NOT EXISTS knowledge_promotions_entity_idx
ON knowledge_promotions(canonical_entity_type,canonical_entity_id,created_at);
