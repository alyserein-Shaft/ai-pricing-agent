-- Governed human resolution of learned Product Identities and safe canonical promotion.
-- Pending-first review rows use a required guard inserted only by a matching version SELECT.
CREATE TABLE IF NOT EXISTS product_identity_review_guards (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  product_identity_id TEXT NOT NULL REFERENCES product_identities(id),
  expected_version INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_identity_reviews (
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
CREATE UNIQUE INDEX IF NOT EXISTS product_identity_reviews_active_idx
ON product_identity_reviews(organization_id,product_identity_id) WHERE status='Active';
CREATE INDEX IF NOT EXISTS product_identity_reviews_identity_idx
ON product_identity_reviews(product_identity_id,created_at);

CREATE TABLE IF NOT EXISTS product_identity_promotions (
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
CREATE INDEX IF NOT EXISTS product_identity_promotions_product_idx
ON product_identity_promotions(library_product_id,created_at);
