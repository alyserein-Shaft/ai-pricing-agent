// Pre-migration live D1 snapshot for the authorized 0006 application.
// STRICTLY READ-ONLY. Opens the live D1 with readOnly:true and never writes.
//
// Records the BEFORE state required before 0006 may be applied database-wide:
//   DB identity + fingerprint, project count, Golden identity,
//   declared_timezone / declared_utc_offset_minutes presence,
//   trigger count and the two 0006 guard trigger names,
//   current NPQ evidence population, the exact evidenced project list,
//   and proof the remaining projects lack that evidence.

import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

const DB =
  ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
const GOLDEN = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";

const bytes = readFileSync(DB);
const db = new DatabaseSync(DB, { readOnly: true });

const out = {};
out.dbPath = DB;
out.dbBytes = bytes.length;
out.dbSha256 = createHash("sha256").update(bytes).digest("hex");
out.dbMtime = statSync(DB).mtime.toISOString();

// --- object inventory -------------------------------------------------------
const objects = db
  .prepare("SELECT type, COUNT(*) n FROM sqlite_master GROUP BY type ORDER BY type")
  .all();
out.objects = Object.fromEntries(objects.map((r) => [r.type, r.n]));

const triggers = db
  .prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name")
  .all()
  .map((r) => r.name);
out.triggerCount = triggers.length;
out.guardTriggers = {
  projects_declared_calendar_guard: triggers.includes("projects_declared_calendar_guard"),
  projects_declared_calendar_guard_update: triggers.includes("projects_declared_calendar_guard_update"),
};

// --- 0006 column presence ---------------------------------------------------
const projectCols = db.prepare("PRAGMA table_info(projects)").all().map((r) => r.name);
out.declared_timezone_present = projectCols.includes("declared_timezone");
out.declared_utc_offset_minutes_present = projectCols.includes("declared_utc_offset_minutes");

// --- projects ---------------------------------------------------------------
const projects = db.prepare("SELECT id, name FROM projects ORDER BY name").all();
out.projectCount = projects.length;
out.golden = projects.find((p) => p.id === GOLDEN) ?? null;

// --- the evidence predicate 0006's backfill uses ----------------------------
const EVIDENCE = `EXISTS (
  SELECT 1 FROM project_npq_profile_versions npq
   WHERE npq.project_id = p.id
     AND npq.superseded_at IS NULL
     AND npq.status = 'Confirmed'
     AND npq.country = 'Saudi Arabia'
)`;
const evidenced = db
  .prepare(`SELECT p.id, p.name FROM projects p WHERE ${EVIDENCE} ORDER BY p.name`)
  .all();
const unevidenced = db
  .prepare(`SELECT p.id, p.name FROM projects p WHERE NOT ${EVIDENCE} ORDER BY p.name`)
  .all();

out.evidencedCount = evidenced.length;
out.evidenced = evidenced;
out.unevidencedCount = unevidenced.length;
out.unevidenced = unevidenced;
out.goldenIsEvidenced = evidenced.some((p) => p.id === GOLDEN);

// --- NPQ population ---------------------------------------------------------
out.npqTotal = db.prepare("SELECT COUNT(*) n FROM project_npq_profile_versions").get().n;
out.npqCurrentConfirmedSaudi = db
  .prepare(
    `SELECT COUNT(*) n FROM project_npq_profile_versions
      WHERE superseded_at IS NULL AND status='Confirmed' AND country='Saudi Arabia'`,
  )
  .get().n;

// --- integrity --------------------------------------------------------------
out.integrityCheck = db.prepare("PRAGMA integrity_check").all();
out.foreignKeyViolations = db.prepare("PRAGMA foreign_key_check").all().length;

console.log(JSON.stringify(out, null, 2));
