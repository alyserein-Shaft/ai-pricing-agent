-- Additive historical-case evidence assessment.
-- Existing live-oriented completeness columns retain their original semantics.
-- Values remain NULL until calculated from persisted governed evidence.
ALTER TABLE case_studies ADD COLUMN historical_completeness_assessment TEXT;
ALTER TABLE case_studies ADD COLUMN learning_readiness TEXT;

CREATE INDEX IF NOT EXISTS case_studies_learning_readiness_idx
  ON case_studies(organization_id,learning_readiness,superseded_at);
