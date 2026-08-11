CREATE TRIGGER IF NOT EXISTS requirement_review_decisions_immutable_update
BEFORE UPDATE ON requirement_review_decisions
BEGIN
  SELECT RAISE(ABORT, 'requirement review decisions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS requirement_review_decisions_immutable_delete
BEFORE DELETE ON requirement_review_decisions
BEGIN
  SELECT RAISE(ABORT, 'requirement review decisions are immutable');
END;
