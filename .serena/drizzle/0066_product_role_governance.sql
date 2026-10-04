ALTER TABLE library_products
ADD COLUMN product_role TEXT NOT NULL DEFAULT 'Unclassified';

CREATE INDEX library_products_product_role_idx
ON library_products (
  product_role,
  identity_status,
  review_status
);
