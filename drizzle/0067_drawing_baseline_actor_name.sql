-- Baseline confirmation must name a real human (APP_HUMAN_NAME), not just an id.
ALTER TABLE drawing_baseline_confirmations ADD COLUMN confirmed_by_name TEXT;
