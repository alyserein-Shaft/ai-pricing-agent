-- NPQ Project Onboarding Authority
-- User-declared project estimation context captured before BOQ/document processing.
-- This authority declares scope and strategy only; it never approves products or prices.

CREATE TABLE IF NOT EXISTS project_npq_profile_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,

  -- Project context
  country TEXT,
  city TEXT,
  location TEXT,
  inquiry_subject TEXT,
  inquiry_received TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,

  -- Estimation scope
  primary_system TEXT NOT NULL,
  additional_systems_json TEXT NOT NULL DEFAULT '[]',
  delivery_scope TEXT NOT NULL,
  scope_notes TEXT,

  -- Manufacturer / brand strategy
  manufacturer_strategy TEXT NOT NULL DEFAULT 'Detect from Specification',
  preferred_manufacturer TEXT,
  approved_manufacturers_json TEXT NOT NULL DEFAULT '[]',
  manufacturer_notes TEXT,

  -- Pricing strategy
  pricing_strategy TEXT NOT NULL DEFAULT 'Price List',
  primary_pricing_source_type TEXT,
  primary_pricing_source_id TEXT,
  fallback_pricing_sources_json TEXT NOT NULL DEFAULT '[]',
  project_currency TEXT NOT NULL DEFAULT 'SAR',
  pricing_notes TEXT,

  -- Expected evidence declared during onboarding
  expected_evidence_json TEXT NOT NULL DEFAULT '[]',

  -- Existing intake availability signals
  boq_availability TEXT NOT NULL DEFAULT 'Unknown',
  drawing_availability TEXT NOT NULL DEFAULT 'Unknown',

  -- Governance
  status TEXT NOT NULL DEFAULT 'Draft',
  input_fingerprint TEXT NOT NULL,
  confirmation_reason TEXT,
  confirmed_by TEXT,
  confirmed_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TEXT,

  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS project_npq_profile_version_idx
  ON project_npq_profile_versions(project_id, version_number);

CREATE UNIQUE INDEX IF NOT EXISTS project_npq_profile_fingerprint_idx
  ON project_npq_profile_versions(project_id, input_fingerprint);

CREATE INDEX IF NOT EXISTS project_npq_profile_current_idx
  ON project_npq_profile_versions(project_id, superseded_at, status);

CREATE INDEX IF NOT EXISTS project_npq_profile_system_idx
  ON project_npq_profile_versions(primary_system, status);


CREATE TABLE IF NOT EXISTS project_npq_profile_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  profile_version_id TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(profile_version_id) REFERENCES project_npq_profile_versions(id)
);

CREATE INDEX IF NOT EXISTS project_npq_profile_event_project_idx
  ON project_npq_profile_events(project_id, created_at);

CREATE INDEX IF NOT EXISTS project_npq_profile_event_version_idx
  ON project_npq_profile_events(profile_version_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS project_npq_profile_event_request_idx
  ON project_npq_profile_events(project_id, request_id);


-- Confirmed NPQ versions are immutable business authority.
CREATE TRIGGER IF NOT EXISTS project_npq_confirmed_update_guard
BEFORE UPDATE ON project_npq_profile_versions
WHEN OLD.status = 'Confirmed'
  AND (
    NEW.project_id <> OLD.project_id
    OR NEW.version_number <> OLD.version_number
    OR COALESCE(NEW.country,'') <> COALESCE(OLD.country,'')
    OR COALESCE(NEW.city,'') <> COALESCE(OLD.city,'')
    OR COALESCE(NEW.location,'') <> COALESCE(OLD.location,'')
    OR NEW.primary_system <> OLD.primary_system
    OR NEW.additional_systems_json <> OLD.additional_systems_json
    OR NEW.delivery_scope <> OLD.delivery_scope
    OR NEW.manufacturer_strategy <> OLD.manufacturer_strategy
    OR COALESCE(NEW.preferred_manufacturer,'') <> COALESCE(OLD.preferred_manufacturer,'')
    OR NEW.approved_manufacturers_json <> OLD.approved_manufacturers_json
    OR NEW.pricing_strategy <> OLD.pricing_strategy
    OR COALESCE(NEW.primary_pricing_source_type,'') <> COALESCE(OLD.primary_pricing_source_type,'')
    OR COALESCE(NEW.primary_pricing_source_id,'') <> COALESCE(OLD.primary_pricing_source_id,'')
    OR NEW.fallback_pricing_sources_json <> OLD.fallback_pricing_sources_json
    OR NEW.project_currency <> OLD.project_currency
    OR NEW.expected_evidence_json <> OLD.expected_evidence_json
    OR NEW.input_fingerprint <> OLD.input_fingerprint
  )
BEGIN
  SELECT RAISE(ABORT, 'CONFIRMED_NPQ_PROFILE_IMMUTABLE');
END;


-- Audit events are append-only.
CREATE TRIGGER IF NOT EXISTS project_npq_event_update_guard
BEFORE UPDATE ON project_npq_profile_events
BEGIN
  SELECT RAISE(ABORT, 'NPQ_PROFILE_EVENT_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS project_npq_event_delete_guard
BEFORE DELETE ON project_npq_profile_events
BEGIN
  SELECT RAISE(ABORT, 'NPQ_PROFILE_EVENT_IMMUTABLE');
END;
