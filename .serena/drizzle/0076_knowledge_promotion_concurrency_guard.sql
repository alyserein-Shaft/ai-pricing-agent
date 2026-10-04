-- Knowledge Promotion Phase 1 concurrency guard.
-- Protocol is a scalar canonical discriminator: at most one active,
-- non-rejected base-product protocol may exist at a time.

CREATE UNIQUE INDEX IF NOT EXISTS product_attributes_active_protocol_singleton_idx
ON product_attributes (product_id, attribute_name)
WHERE attribute_name='protocol'
  AND variant_id IS NULL
  AND deleted_at IS NULL
  AND superseded_at IS NULL
  AND review_status<>'Rejected';
