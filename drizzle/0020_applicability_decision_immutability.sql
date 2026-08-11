CREATE TRIGGER IF NOT EXISTS applicability_decisions_immutable_update
BEFORE UPDATE ON engineering_knowledge_decisions
WHEN OLD.entity_type = 'BOQ Requirement Link'
BEGIN
  SELECT RAISE(ABORT, 'applicability decisions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS applicability_decisions_immutable_delete
BEFORE DELETE ON engineering_knowledge_decisions
WHEN OLD.entity_type = 'BOQ Requirement Link'
BEGIN
  SELECT RAISE(ABORT, 'applicability decisions are immutable');
END;
