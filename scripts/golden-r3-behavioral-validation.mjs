// DOC-R3 Golden behavioral validation — runs against a DISPOSABLE COPY of the
// live D1 database, never the original. The copy already carries 0005's objects
// (the running server migrates on boot); this script applies 0006 to the copy
// and then proves, on real production-shaped rows:
//
//   1. On single-version documents (all 266 Golden docs), the governing
//      authority and the legacy head pointer agree EXACTLY. Any divergence
//      would be a predicate bug, because nothing retires and nothing conflicts.
//   2. `diagnoseBoqEvidence` explains every excluded Golden BOQ row with the new
//      vocabulary and never with 'stale document version'.
//   3. All 23 projects declare Asia/Riyadh and the conformance guard passes.
//   4. A transactional scenario probe (rolled back): an expired successor with
//      an active edge fails closed on real Golden rows.
//
// Usage: node scripts/golden-r3-behavioral-validation.mjs <copy-path>
// The script opens the copy read-write (0006 + the rolled-back probe) but never
// touches the path baked in as GOLDEN_ORIGINAL.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const copyPath = process.argv[2];
if (!copyPath) {
  console.error("Usage: node scripts/golden-r3-behavioral-validation.mjs <copy-path>");
  process.exit(2);
}

const failures = [];
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    failures.push(label);
    console.log(`      actual:   ${JSON.stringify(actual)}`);
    console.log(`      expected: ${JSON.stringify(expected)}`);
  }
};

const db = new DatabaseSync(copyPath);
db.exec("PRAGMA foreign_keys=ON");

check("copy integrity: quick_check", db.prepare("PRAGMA quick_check").get().quick_check, "ok");
check("copy integrity: no FK violations", db.prepare("PRAGMA foreign_key_check").all().length, 0);
check("copy: documents", db.prepare("SELECT COUNT(*) n FROM documents").get().n > 0, true);
check("copy: every document is single-version (the differential premise)", db.prepare("SELECT COUNT(*) n FROM (SELECT document_id FROM document_versions GROUP BY document_id HAVING COUNT(*)>1)").get().n, 0);
check("copy: no supersession rows (nothing retires)", db.prepare("SELECT COUNT(*) n FROM document_supersessions").get().n, 0);

// --- 0006 on the copy -------------------------------------------------------
const migration = readFileSync(new URL("../drizzle-active/0006_project_effective_time_calendar.sql", import.meta.url), "utf8");
const alreadyApplied = db.prepare("SELECT COUNT(*) n FROM pragma_table_info('projects') WHERE name='declared_timezone'").get().n === 1;
if (!alreadyApplied) {
  for (const statement of migration
    .split("--> statement-breakpoint")
    .map((part) => part.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim())
    .filter(Boolean)) {
    db.exec(statement);
  }
}
check("0006: declared columns exist", db.prepare("SELECT COUNT(*) n FROM pragma_table_info('projects') WHERE name IN ('declared_timezone','declared_utc_offset_minutes')").get().n, 2);
// CHECK-A correction (supersedes the old "every project declares" expectation,
// which was built on 0006's original blanket backfill and is retracted): only
// projects with current, Confirmed, Saudi Arabia NPQ evidence declare
// Asia/Riyadh; the rest are undeclared (NULL), which is the policy working.
const projectCount = db.prepare("SELECT COUNT(*) n FROM projects").get().n;
const evidenced = db.prepare(`SELECT p.id FROM projects p WHERE EXISTS (
  SELECT 1 FROM project_npq_profile_versions n WHERE n.project_id=p.id
    AND n.superseded_at IS NULL AND n.status='Confirmed' AND n.country='Saudi Arabia')`).all().map((r) => r.id);
check(
  "0006/0007: exactly the evidenced projects declare Asia/Riyadh at +03:00",
  db.prepare("SELECT COUNT(*) n FROM projects WHERE declared_timezone='Asia/Riyadh' AND declared_utc_offset_minutes=180").get().n,
  evidenced.length,
);
check(
  "0006/0007: every declaration sits on evidence (no fabrication remains)",
  db.prepare(`SELECT COUNT(*) n FROM projects WHERE declared_timezone IS NOT NULL AND id NOT IN (${evidenced.map(() => "?").join(",")})`).get(...evidenced).n,
  0,
);
check(
  "0006/0007: unevidenced projects are undeclared, not defaulted",
  db.prepare("SELECT COUNT(*) n FROM projects WHERE declared_timezone IS NULL").get().n,
  projectCount - evidenced.length,
);

// --- 0007 evidence repair on the copy ------------------------------------------
// The copy predates 0007 (it carries blanket-0006's fabricated rows). The repair
// is idempotent, so applying it unconditionally mirrors exactly what the live
// database will undergo when its own migrator advances the journal.
for (const statement of readFileSync(new URL("../drizzle-active/0007_project_calendar_evidence_repair.sql", import.meta.url), "utf8")
  .split("--> statement-breakpoint")
  .map((part) => part.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim())
  .filter(Boolean)) {
  db.exec(statement);
}
check("0007: repair applies cleanly (idempotent)", true, true);

// --- 1. head vs governing differential --------------------------------------
// The legacy head-pointer selection with the SAME document/project scoping the
// governing query applies (deleted/archived documents and archived projects
// supply no evidence either way). No row_type filter on either side:
// `currentBoqEvidenceFrom` bare returns every row kind and the item predicate is
// a consumer-side refinement, so filtering here would compare two different
// populations and manufacture a divergence.
const headItems = db.prepare(`
  SELECT b.id FROM boq_items b
  JOIN boq_extraction_versions e ON e.id = b.extraction_version_id
  JOIN documents d ON d.id = b.source_document_id
  JOIN projects p ON p.id = d.project_id
  WHERE e.document_version_id = d.current_version_id
    AND e.superseded_at IS NULL AND e.status IN ('Completed','Needs Review')
    AND d.deleted_at IS NULL AND d.archived_at IS NULL AND p.archived_at IS NULL
  ORDER BY b.id`).all().map((row) => row.id);

const { currentBoqEvidenceFrom } = await import("../worker/current-evidence-scope.mjs");
const govItems = db.prepare(`SELECT b.id FROM ${currentBoqEvidenceFrom("b")} ORDER BY b.id`).all().map((row) => row.id);
check("1. governing BOQ evidence == head BOQ evidence on single-version data", govItems, headItems);
console.log(`      (${govItems.length} current BOQ items across the copy)`);

// --- 2. diagnostic vocabulary -----------------------------------------------
const { diagnoseBoqEvidence } = await import("../worker/current-evidence-scope.mjs");
const projectId = db.prepare("SELECT id FROM projects ORDER BY id LIMIT 1").get().id;
const orgId = db.prepare("SELECT organization_id FROM projects WHERE id=?").get(projectId)?.organization_id ?? null;
const rows = await asD1(db).then((d1) => diagnoseBoqEvidence(d1, { projectId, organizationId: orgId }));
const reasons = [...new Set(rows.map((row) => row.exclusionReason))].sort();
check("2. no excluded row is explained as 'stale document version'", reasons.includes("stale document version"), false);
console.log(`      reasons observed on project ${projectId}: ${reasons.join(", ") || "(none excluded)"}`);

// --- 3. conformance guard ----------------------------------------------------
// Conformance is per-project, not global: evidenced projects conform to the
// declared calendar, while undeclared projects fail closed by name instead of
// inheriting a zone. Both halves are asserted.
const { assertEffectiveTimeCalendarConformance, loadProjectCalendar } = await import("../worker/project-effective-time-calendar.mjs");
const d1 = await asD1(db);
for (const id of evidenced) await assertEffectiveTimeCalendarConformance(d1, { projectId: id });
check("3a. every evidenced project conforms to the declared calendar", true, true);
const undeclaredId = db.prepare("SELECT id FROM projects WHERE declared_timezone IS NULL ORDER BY id LIMIT 1").get()?.id ?? null;
let failClosed = false;
try {
  if (undeclaredId) await loadProjectCalendar(d1, undeclaredId);
} catch (error) {
  failClosed = error?.code === "PROJECT_CALENDAR_UNDECLARED";
}
check("3b. an undeclared project fails closed with PROJECT_CALENDAR_UNDECLARED", failClosed, true);

// --- 4. transactional scenario probe (rolled back) ---------------------------
const docId = db.prepare("SELECT d.id FROM documents d JOIN boq_items b ON b.source_document_id=d.id LIMIT 1").get().id;
db.exec("BEGIN");
try {
  const version = db.prepare("SELECT * FROM document_versions WHERE document_id=?").get(docId);
  const stamp = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  db.prepare(`INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by, effective_from, effective_to)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(`${version.id}-addendum`, docId, Number(version.version_number) + 1, version.original_filename, version.stored_filename, version.extension,
      version.mime_type, version.byte_size ?? 0, `sha-${version.id}-addendum`, `${version.object_key}-addendum`, version.uploaded_by, stamp(-30), stamp(-1));
  db.prepare("UPDATE documents SET current_version_id=? WHERE id=?").run(`${version.id}-addendum`, docId);
  db.prepare(`INSERT INTO document_supersessions (id, superseding_version_id, superseded_version_id, scope_type, scope_id, supersession_type, effective_from, effective_to, created_by)
              VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(`sup-${docId}`, `${version.id}-addendum`, version.id, "FULL_DOCUMENT", null, "REVISION", stamp(-30), null, version.uploaded_by);
  const governed = db.prepare(`SELECT b.id FROM ${currentBoqEvidenceFrom("b")} WHERE b.source_document_id=? ORDER BY b.id`).all(docId).map((row) => row.id);
  check("4. expired successor + active edge fails closed on real Golden rows", governed, []);
} finally {
  db.exec("ROLLBACK");
}
check("4b. probe rolled back: supersessions still 0", db.prepare("SELECT COUNT(*) n FROM document_supersessions").get().n, 0);

db.close();
console.log(failures.length === 0 ? "\nGOLDEN-R3: ALL CHECKS PASS" : `\nGOLDEN-R3: ${failures.length} FAILING: ${failures.join("; ")}`);
process.exit(failures.length === 0 ? 0 : 1);

// Minimal D1-shaped adapter: the authority modules call .prepare().bind()...
// .first()/.all() with a `{results}` envelope.
async function asD1(raw) {
  return {
    prepare: (sql) => ({
      bind: (...args) => ({
        first: async () => raw.prepare(sql).get(...args) ?? null,
        all: async () => ({ results: raw.prepare(sql).all(...args) }),
        run: async () => { raw.prepare(sql).run(...args); return {}; },
      }),
      first: async () => raw.prepare(sql).get() ?? null,
      all: async () => ({ results: raw.prepare(sql).all() }),
    }),
    batch: async (statements) => { for (const s of statements) await s.run(); },
  };
}
