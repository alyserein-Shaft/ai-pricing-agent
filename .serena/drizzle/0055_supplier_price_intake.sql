CREATE TABLE supplier_quote_intake_runs (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, document_id TEXT NOT NULL, document_version_id TEXT NOT NULL,
  processing_run_id TEXT, source_checksum TEXT NOT NULL, parser_version TEXT NOT NULL, input_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL, supplier_name TEXT, quotation_reference TEXT, issue_date TEXT, valid_until TEXT, currency TEXT,
  row_count INTEGER NOT NULL DEFAULT 0, candidate_count INTEGER NOT NULL DEFAULT 0, error_code TEXT, error_message TEXT,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT, superseded_at TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id), FOREIGN KEY(document_id) REFERENCES documents(id), FOREIGN KEY(document_version_id) REFERENCES document_versions(id)
);
CREATE UNIQUE INDEX supplier_quote_intake_fingerprint_idx ON supplier_quote_intake_runs(project_id, document_version_id, input_fingerprint);
CREATE INDEX supplier_quote_intake_project_idx ON supplier_quote_intake_runs(project_id, status, created_at);

CREATE TABLE supplier_quote_intake_rows (
  id TEXT PRIMARY KEY, intake_run_id TEXT NOT NULL, project_id TEXT NOT NULL, document_id TEXT NOT NULL, document_version_id TEXT NOT NULL,
  row_type TEXT NOT NULL, sheet_name TEXT, page_number INTEGER, row_number INTEGER NOT NULL, item_number TEXT, supplier_name TEXT,
  quotation_reference TEXT, manufacturer TEXT, part_number TEXT, description TEXT, unit TEXT, quantity REAL, currency TEXT,
  list_price_minor INTEGER, unit_price_minor INTEGER, discount_basis_points INTEGER, net_price_minor INTEGER,
  issue_date TEXT, valid_until TEXT, raw_values TEXT NOT NULL, review_status TEXT NOT NULL DEFAULT 'Needs Review',
  product_id TEXT, mapping_basis TEXT, mapped_by TEXT, mapped_at TEXT, review_reason TEXT, reviewed_by TEXT, reviewed_at TEXT,
  promoted_supplier_quote_id TEXT, promoted_price_record_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(intake_run_id) REFERENCES supplier_quote_intake_runs(id), FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(document_id) REFERENCES documents(id), FOREIGN KEY(document_version_id) REFERENCES document_versions(id), FOREIGN KEY(product_id) REFERENCES library_products(id),
  FOREIGN KEY(promoted_supplier_quote_id) REFERENCES supplier_quotes(id), FOREIGN KEY(promoted_price_record_id) REFERENCES price_records(id)
);
CREATE UNIQUE INDEX supplier_quote_intake_row_idx ON supplier_quote_intake_rows(intake_run_id, sheet_name, row_number);
CREATE INDEX supplier_quote_intake_review_idx ON supplier_quote_intake_rows(project_id, review_status, row_type);
CREATE INDEX supplier_quote_intake_product_idx ON supplier_quote_intake_rows(product_id, review_status);

CREATE TABLE supplier_quote_intake_events (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, intake_run_id TEXT NOT NULL, row_id TEXT, action TEXT NOT NULL,
  previous_value TEXT, new_value TEXT NOT NULL, reason TEXT NOT NULL, actor_user_id TEXT NOT NULL, request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id), FOREIGN KEY(intake_run_id) REFERENCES supplier_quote_intake_runs(id), FOREIGN KEY(row_id) REFERENCES supplier_quote_intake_rows(id)
);
CREATE INDEX supplier_quote_intake_events_row_idx ON supplier_quote_intake_events(row_id, created_at);

ALTER TABLE supplier_quotes ADD COLUMN source_document_version_id TEXT REFERENCES document_versions(id);
CREATE UNIQUE INDEX supplier_quotes_document_version_idx ON supplier_quotes(project_id, supplier_id, quote_number, source_document_version_id);
ALTER TABLE supplier_quote_lines ADD COLUMN source_intake_row_id TEXT REFERENCES supplier_quote_intake_rows(id);
CREATE UNIQUE INDEX supplier_quote_lines_intake_row_idx ON supplier_quote_lines(source_intake_row_id);
