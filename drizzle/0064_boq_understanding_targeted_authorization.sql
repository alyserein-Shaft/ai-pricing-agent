-- Targeted BOQ Understanding authorization.
--
-- The ordinary controlled pilot selects one row per taxonomy family
-- (selectPrimaryByDistinctFamily), capped at BOQ_UNDERSTANDING_PILOT_MAX_ITEMS,
-- after removing rows already interpreted at the current config fingerprint. An
-- eligible row can therefore be unselected purely because a sibling holds its
-- family slot, and reaching 12 already-authorized rows by rotation alone would
-- interpret up to ~90 unrelated rows first. CONTROLLED_RETRY cannot serve as the
-- escape hatch: it requires exactly 6 items taken from one historical run's own
-- quality recommendations.
--
-- This table records the narrow, human-authorized alternative. It is deliberately
-- NOT a general override:
--   * item_ids is the EXACT authorized set, bound to one project_id;
--   * authorized_by is the resolved human actor (never the synthetic session
--     user) and authorized_by_name records who was quoted;
--   * intended_action is fixed to targeted BOQ Understanding so the row cannot
--     be replayed as any other governed act;
--   * authorization_fingerprint binds action + project + sorted item set +
--     actor + reason + every item's eligibility fingerprint, so changing the
--     set, the actor, the reason or the underlying evidence yields a different
--     value and a stored fingerprint can never be replayed;
--   * superseded_at makes the authorization currentness-scoped exactly like the
--     pilot/rotation/retry paths already are.
--
-- Ordinary pilot behaviour is untouched: nothing consults this table unless a
-- caller explicitly requests run_mode 'TARGETED_AUTHORIZED'.
CREATE TABLE IF NOT EXISTS boq_understanding_targeted_authorizations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  organization_id TEXT,
  item_ids TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  intended_action TEXT NOT NULL,
  authorization_reason TEXT NOT NULL,
  authorized_by TEXT NOT NULL,
  authorized_by_name TEXT,
  authorized_by_role TEXT,
  authorization_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TEXT,
  supersede_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS boq_understanding_targeted_authorization_fingerprint_idx
  ON boq_understanding_targeted_authorizations(authorization_fingerprint);
CREATE INDEX IF NOT EXISTS boq_understanding_targeted_authorization_project_idx
  ON boq_understanding_targeted_authorizations(project_id, superseded_at, created_at);

-- A targeted authorization is a live instrument, not a log line: its SCOPE is
-- immutable. Only the currentness columns (superseded_at / supersede_reason) may
-- change; widening the item set, re-pointing the project, swapping the human or
-- editing the reason/fingerprint in place is refused. A superseding decision is a
-- NEW row that sets the old one superseded.
CREATE TRIGGER boq_understanding_targeted_authorization_scope_immutable
BEFORE UPDATE ON boq_understanding_targeted_authorizations
WHEN OLD.project_id IS NOT NEW.project_id
  OR OLD.item_ids IS NOT NEW.item_ids
  OR OLD.item_count IS NOT NEW.item_count
  OR OLD.intended_action IS NOT NEW.intended_action
  OR OLD.authorization_reason IS NOT NEW.authorization_reason
  OR OLD.authorized_by IS NOT NEW.authorized_by
  OR OLD.authorized_by_name IS NOT NEW.authorized_by_name
  OR OLD.authorization_fingerprint IS NOT NEW.authorization_fingerprint
BEGIN
  SELECT RAISE(ABORT, 'targeted authorization scope is immutable');
END;