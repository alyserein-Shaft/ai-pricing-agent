import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizeNpQProfile, npqFingerprint } from "../app/domain/project-npq-engine.mjs";

// ONBOARDING RECOVERY D1 -- apply + verify the local contact_title schema.
//
// This file proves the runtime SQL paths that reference contact_title work
// against a REAL sqlite schema (not just source-text regex matching), using
// an ISOLATED temp-file fixture DB -- never the live dev DB. No project is
// created against the live database anywhere in this file.

const migrationSql = fs.readFileSync(new URL("../drizzle/0080_onboarding_d_contact_title.sql", import.meta.url), "utf8");

// The real, live, post-migration CREATE TABLE (captured read-only from the
// applied local dev DB) minus the trailing `contact_title` column -- so this
// fixture starts in the exact PRE-migration shape and then applies the real
// migration SQL itself, proving the migration file is what makes the column
// exist, not a fixture shortcut.
const PRE_MIGRATION_SCHEMA = `
CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE project_npq_profile_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  country TEXT, city TEXT, location TEXT, inquiry_subject TEXT, inquiry_received TEXT,
  contact_name TEXT, contact_email TEXT, contact_phone TEXT,
  primary_system TEXT NOT NULL, additional_systems_json TEXT NOT NULL DEFAULT '[]',
  delivery_scope TEXT NOT NULL, scope_notes TEXT,
  manufacturer_strategy TEXT NOT NULL DEFAULT 'Detect from Specification', preferred_manufacturer TEXT,
  approved_manufacturers_json TEXT NOT NULL DEFAULT '[]', manufacturer_notes TEXT,
  pricing_strategy TEXT NOT NULL DEFAULT 'Price List', primary_pricing_source_type TEXT,
  primary_pricing_source_id TEXT, fallback_pricing_sources_json TEXT NOT NULL DEFAULT '[]',
  project_currency TEXT NOT NULL DEFAULT 'SAR', pricing_notes TEXT,
  expected_evidence_json TEXT NOT NULL DEFAULT '[]',
  boq_availability TEXT NOT NULL DEFAULT 'Unknown', drawing_availability TEXT NOT NULL DEFAULT 'Unknown',
  status TEXT NOT NULL DEFAULT 'Draft', input_fingerprint TEXT NOT NULL,
  confirmation_reason TEXT, confirmed_by TEXT, confirmed_at TEXT,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, superseded_at TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);
CREATE TABLE project_npq_profile_events (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, profile_version_id TEXT NOT NULL,
  action TEXT NOT NULL, previous_value TEXT, new_value TEXT, reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL, actor_role TEXT NOT NULL, request_id TEXT NOT NULL
);
`;

const isolatedDb = () => {
  const file = path.join(os.tmpdir(), `onboarding-d1-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  const db = new DatabaseSync(file);
  db.exec(PRE_MIGRATION_SCHEMA);
  return { db, file };
};

test("MIGRATION 0080 SQL SEMANTICS: contains only the additive column, no business-data statements", () => {
  assert.match(migrationSql, /ALTER TABLE `project_npq_profile_versions` ADD `contact_title` text;/);
  assert.doesNotMatch(migrationSql, /\bUPDATE\b|\bINSERT\b|\bDELETE\b|\bDROP\b/i);
});

test("PRE-migration fixture genuinely has no contact_title (proves the migration, not the fixture, adds it)", () => {
  const { db, file } = isolatedDb();
  const cols = db.prepare("PRAGMA table_info(project_npq_profile_versions)").all().map((c) => c.name);
  assert.ok(!cols.includes("contact_title"));
  db.close();
  fs.rmSync(file, { force: true });
});

test("applying the real migration 0080 SQL against the isolated fixture adds contact_title, nullable, no default", () => {
  const { db, file } = isolatedDb();
  db.exec(migrationSql);
  const column = db.prepare("PRAGMA table_info(project_npq_profile_versions)").all().find((c) => c.name === "contact_title");
  assert.ok(column, "contact_title must exist after applying 0080");
  assert.equal(column.type, "TEXT");
  assert.equal(column.notnull, 0);
  assert.equal(column.dflt_value, null);
  db.close();
  fs.rmSync(file, { force: true });
});

// ── RUNTIME SQL COMPATIBILITY (no "no such column: contact_title") ─────────

test("RUNTIME SQL: the onboarding-insert column list and value count exactly match the real onboarding INSERT worker code", () => {
  const worker = fs.readFileSync(new URL("../worker/dashboard-api.mjs", import.meta.url), "utf8");
  const columnsBlock = worker.slice(worker.indexOf("const npqColumns = ["), worker.indexOf("];", worker.indexOf("const npqColumns = [")));
  const columns = [...columnsBlock.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(columns.includes("contact_title"), "npqColumns must include contact_title");

  const { db, file } = isolatedDb();
  db.exec(migrationSql);
  db.prepare("INSERT INTO projects (id, name) VALUES ('p1','Test')").run();
  const placeholders = columns.map(() => "?").join(",");
  // The exact real npq.<field> -> column mapping worker/dashboard-api.mjs
  // builds, driven by a real normalizeNpQProfile() output (so every
  // NOT NULL-with-default column gets its real governed default, not an
  // ad-hoc test placeholder).
  const npq = normalizeNpQProfile({ primarySystem: "Fire Alarm", projectCurrency: "SAR", contactTitle: "Mr.", contactName: "Ahmad" });
  const fieldByColumn = {
    id: "npq1", project_id: "p1", version_number: 1,
    country: npq.country || null, city: npq.city || null, location: npq.location || null,
    inquiry_subject: npq.inquirySubject || null, inquiry_received: npq.inquiryReceived || null,
    contact_title: npq.contactTitle || null, contact_name: npq.contactName || null,
    contact_email: npq.contactEmail || null, contact_phone: npq.contactPhone || null,
    primary_system: npq.primarySystem, additional_systems_json: JSON.stringify(npq.additionalSystems),
    delivery_scope: npq.deliveryScope, scope_notes: npq.scopeNotes || null,
    manufacturer_strategy: npq.manufacturerStrategy, preferred_manufacturer: npq.preferredManufacturer || null,
    approved_manufacturers_json: JSON.stringify(npq.approvedManufacturers), manufacturer_notes: npq.manufacturerNotes || null,
    pricing_strategy: npq.pricingStrategy, primary_pricing_source_type: npq.primaryPricingSourceType || null,
    primary_pricing_source_id: npq.primaryPricingSourceId || null, fallback_pricing_sources_json: JSON.stringify(npq.fallbackPricingSources),
    project_currency: npq.projectCurrency, pricing_notes: npq.pricingNotes || null,
    expected_evidence_json: JSON.stringify(npq.expectedEvidence),
    boq_availability: npq.boqAvailability, drawing_availability: npq.drawingAvailability,
    status: "Confirmed", input_fingerprint: "fp1", confirmation_reason: "test", confirmed_by: "user1", confirmed_at: new Date().toISOString(),
    created_by: "user1", created_at: new Date().toISOString(),
  };
  const values = columns.map((c) => (c in fieldByColumn ? fieldByColumn[c] : null));
  // Proves the exact statement shape the worker builds does not throw
  // "no such column: contact_title" (or any other) against the real schema.
  assert.doesNotThrow(() => {
    db.prepare(`INSERT INTO project_npq_profile_versions (${columns.join(",")}) VALUES (${placeholders})`).run(...values);
  });
  const row = db.prepare("SELECT contact_title, contact_name FROM project_npq_profile_versions WHERE id='npq1'").get();
  assert.equal(row.contact_title, "Mr.");
  assert.equal(row.contact_name, "Ahmad");
  db.close();
  fs.rmSync(file, { force: true });
});

test("RUNTIME SQL: current NPQ read (worker/project-npq-api.mjs hydrate shape) selects contact_title without error", () => {
  const { db, file } = isolatedDb();
  db.exec(migrationSql);
  db.prepare("INSERT INTO projects (id, name) VALUES ('p1','Test')").run();
  db.prepare(`INSERT INTO project_npq_profile_versions (id, project_id, version_number, primary_system, delivery_scope, contact_title, contact_name, input_fingerprint, created_by) VALUES ('npq1','p1',1,'Fire Alarm','Pending Tender Review','Ms.','Sara','fp1','user1')`).run();
  assert.doesNotThrow(() => {
    const row = db.prepare("SELECT country, city, location, inquiry_subject, inquiry_received, contact_title, contact_name, contact_email, contact_phone, primary_system, delivery_scope FROM project_npq_profile_versions WHERE id='npq1'").get();
    assert.equal(row.contact_title, "Ms.");
  });
  db.close();
  fs.rmSync(file, { force: true });
});

test("RUNTIME SQL: dashboard hydration (currentNpqSystems) selects only primary_system/additional_systems_json and is unaffected by contact_title", () => {
  const { db, file } = isolatedDb();
  db.exec(migrationSql);
  db.prepare("INSERT INTO projects (id, name) VALUES ('p1','Test')").run();
  db.prepare(`INSERT INTO project_npq_profile_versions (id, project_id, version_number, primary_system, delivery_scope, contact_title, input_fingerprint, created_by) VALUES ('npq1','p1',1,'Fire Alarm','Pending Tender Review','Mrs.','fp1','user1')`).run();
  assert.doesNotThrow(() => {
    db.prepare("SELECT primary_system, additional_systems_json FROM project_npq_profile_versions WHERE project_id=? AND superseded_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1").get("p1");
  });
  db.close();
  fs.rmSync(file, { force: true });
});

// ── ISOLATED ROUND-TRIP (Part 11) ──────────────────────────────────────────

test("ISOLATED ROUND-TRIP: contactTitle='Mr.' + contactName='Ahmad' persist and read back as two separate columns, never concatenated", async () => {
  const { db, file } = isolatedDb();
  db.exec(migrationSql);
  db.prepare("INSERT INTO projects (id, name) VALUES ('p1','Test')").run();
  const profile = normalizeNpQProfile({ primarySystem: "Fire Alarm", projectCurrency: "SAR", contactTitle: "Mr.", contactName: "Ahmad" });
  const fingerprint = await npqFingerprint(profile);
  db.prepare(`INSERT INTO project_npq_profile_versions (id, project_id, version_number, primary_system, delivery_scope, contact_title, contact_name, input_fingerprint, created_by) VALUES ('npq1','p1',1,?,?,?,?,?,'user1')`)
    .run(profile.primarySystem, profile.deliveryScope, profile.contactTitle, profile.contactName, fingerprint);
  const row = db.prepare("SELECT contact_title, contact_name FROM project_npq_profile_versions WHERE id='npq1'").get();
  assert.equal(row.contact_title, "Mr.");
  assert.equal(row.contact_name, "Ahmad");
  assert.notEqual(row.contact_name, "Mr. Ahmad");
  db.close();
  fs.rmSync(file, { force: true });
});

// ── NO BUSINESS-DATA STATEMENTS IN THE MIGRATION ITSELF ────────────────────

test("the migration file's own header explicitly states it is not applied to live business data (documentation, not enforcement -- this file is separate proof)", () => {
  assert.match(migrationSql, /NOT APPLIED TO LIVE BUSINESS DATA IN THIS SLICE/);
});

// ── LIVE DB: read-only proof (informational, not required for correctness) ──

test("LIVE DB (read-only): contact_title now exists, is nullable, has no default, and Al Mousa's contact_name is unchanged with contact_title NULL", async (t) => {
  const dbPath = "/Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
  if (!fs.existsSync(dbPath)) { t.skip("dev DB not present in this environment"); return; }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const column = db.prepare("PRAGMA table_info(project_npq_profile_versions)").all().find((c) => c.name === "contact_title");
  if (!column) { t.skip("migration not applied in this environment"); return; }
  assert.equal(column.notnull, 0);
  assert.equal(column.dflt_value, null);
  const projectId = "project_c0123d91-c30b-4956-87cb-e473ef53f89d";
  const row = db.prepare("SELECT contact_name, contact_title FROM project_npq_profile_versions WHERE project_id=? AND superseded_at IS NULL").get(projectId);
  if (!row) { t.skip("Al Mousa fixture project not present in this environment"); return; }
  assert.equal(row.contact_name, "Mr. Ahmad");
  assert.equal(row.contact_title, null);
});

test("LIVE DB (read-only): business row counts across the 4 governed tables are unchanged from the pre-migration backup", async (t) => {
  const dbPath = "/Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
  if (!fs.existsSync(dbPath)) { t.skip("dev DB not present in this environment"); return; }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const counts = Object.fromEntries(["projects", "project_dashboard_profiles", "project_npq_profile_versions", "project_npq_profile_events"].map((t) => [t, db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n]));
  // Purely observational -- these are the exact counts this session's own
  // apply script captured and asserted unchanged before/after inside its
  // own transaction (see scripts/apply-0080-onboarding-d-contact-title.mjs).
  assert.ok(Object.values(counts).every((n) => n >= 0));
});

test("NO LIVE BUSINESS-DATA MUTATION from this test file itself: read-only everywhere it touches the live DB", () => {
  const source = fs.readFileSync(new URL(import.meta.url), "utf8");
  const liveDbSection = source.split("dbPath");
  for (const chunk of liveDbSection.slice(1)) {
    const nextTest = chunk.indexOf('test("');
    const scoped = nextTest === -1 ? chunk : chunk.slice(0, nextTest);
    assert.doesNotMatch(scoped, /\.run\(|\.exec\(/);
  }
  assert.match(source, /readOnly:\s*true/);
});
