-- R8: atomic review decision persistence.
--
-- Adds the canonical request fingerprint and the replay, uniqueness and
-- append-only protection that make a review decision an immutable, replayable
-- governance record. review_audit_log is never rebuilt or mutated.
--
-- Apply safety. This migration is additive only. It previously rebuilt
-- `review_decisions` with CREATE __new -> INSERT..SELECT -> DROP -> RENAME,
-- wrapped in `PRAGMA foreign_keys=OFF`. That could never work in production:
-- `PRAGMA foreign_keys` is a no-op inside a transaction, a migrator runs a
-- migration as one transaction, and `review_approval_conditions` and
-- `review_attachments` both carry a foreign key to `review_decisions(id)`. Once
-- either held a row, DROP aborted, the whole migration rolled back, and the
-- review write path -- which selects `request_fingerprint` -- failed outright.
-- An empty-database replay passed, which is exactly why it shipped.
--
-- A single ADD COLUMN gives the same schema: existing rows receive the default
-- empty fingerprint, so they are not retroactively enrolled in replay
-- protection, and every column, row, foreign key and index the baseline already
-- created is left exactly as it was. The `review_decisions_item_idx` and
-- `review_decisions_project_idx` indexes are deliberately not recreated: they
-- already exist on the table and rebuilding was the only reason they were.
ALTER TABLE `review_decisions` ADD COLUMN `request_fingerprint` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS review_decisions_request_idx
  ON review_decisions(project_id, request_id)
  WHERE request_fingerprint <> '';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS review_decisions_version_unique_idx
  ON review_decisions(review_item_id, review_version)
  WHERE request_fingerprint <> '';--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS review_decisions_immutable_update
BEFORE UPDATE ON review_decisions
BEGIN
  SELECT RAISE(ABORT, 'REVIEW_DECISIONS_IMMUTABLE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS review_decisions_immutable_delete
BEFORE DELETE ON review_decisions
BEGIN
  SELECT RAISE(ABORT, 'REVIEW_DECISIONS_IMMUTABLE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS review_decisions_version_cas_guard
BEFORE INSERT ON review_decisions
WHEN
     NEW.request_fingerprint <> ''
 AND NEW.review_version <>
     (SELECT q.version_number FROM review_queue_items q WHERE q.id = NEW.review_item_id) + 1
BEGIN
  SELECT RAISE(ABORT, 'REVIEW_VERSION_CAS_CONFLICT');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS review_audit_log_immutable_update
BEFORE UPDATE ON review_audit_log
BEGIN
  SELECT RAISE(ABORT, 'REVIEW_AUDIT_LOG_IMMUTABLE');
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS review_audit_log_immutable_delete
BEFORE DELETE ON review_audit_log
BEGIN
  SELECT RAISE(ABORT, 'REVIEW_AUDIT_LOG_IMMUTABLE');
END;
