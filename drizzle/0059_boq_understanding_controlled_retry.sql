ALTER TABLE estimator_understanding_runs ADD COLUMN run_mode TEXT NOT NULL DEFAULT 'CONTROLLED_PILOT';
ALTER TABLE estimator_understanding_runs ADD COLUMN parent_run_id TEXT REFERENCES estimator_understanding_runs(id);
ALTER TABLE estimator_understanding_runs ADD COLUMN authorization_fingerprint TEXT;

CREATE UNIQUE INDEX estimator_understanding_single_controlled_retry_idx
ON estimator_understanding_runs(parent_run_id, authorization_fingerprint)
WHERE run_mode='CONTROLLED_RETRY';

CREATE INDEX estimator_understanding_parent_run_idx
ON estimator_understanding_runs(parent_run_id, started_at);
