CREATE TABLE estimator_understanding_review_versions (
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

CREATE INDEX estimator_understanding_review_current_idx
ON estimator_understanding_review_versions(project_id, boq_item_id, version_number DESC);

CREATE TABLE estimator_understanding_review_events (
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

CREATE INDEX estimator_understanding_review_event_item_idx
ON estimator_understanding_review_events(boq_item_id, created_at DESC);

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
      AND NOT EXISTS (SELECT 1 FROM estimator_item_interpretations newer_i WHERE newer_i.boq_item_id=i.boq_item_id AND newer_i.version_number>i.version_number)
  ) THEN RAISE(ABORT, 'understanding review evidence is stale') END;
END;

CREATE TRIGGER estimator_understanding_review_versions_immutable_update
BEFORE UPDATE ON estimator_understanding_review_versions
BEGIN
  SELECT RAISE(ABORT, 'estimator understanding review versions are immutable');
END;

CREATE TRIGGER estimator_understanding_review_versions_immutable_delete
BEFORE DELETE ON estimator_understanding_review_versions
BEGIN
  SELECT RAISE(ABORT, 'estimator understanding review versions are immutable');
END;

CREATE TRIGGER estimator_understanding_review_events_immutable_update
BEFORE UPDATE ON estimator_understanding_review_events
BEGIN
  SELECT RAISE(ABORT, 'estimator understanding review events are append only');
END;

CREATE TRIGGER estimator_understanding_review_events_immutable_delete
BEFORE DELETE ON estimator_understanding_review_events
BEGIN
  SELECT RAISE(ABORT, 'estimator understanding review events are append only');
END;
