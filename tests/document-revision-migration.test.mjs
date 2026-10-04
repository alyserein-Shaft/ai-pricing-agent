// DOC-R3A.1 -- active revision / addendum / supersession migration authority.
//
// Every other migration gate in this repository is a static source check, and
// the baseline gate explicitly refuses to touch a database. That left the
// active chain unproven as *executable*. This suite is the missing evidence: it
// applies the real active chain, in order, each migration inside its own
// transaction with foreign-key enforcement switched on -- the same shape a
// production migrator uses -- and then proves that the revision authority
// actually refuses the states the architecture study forbids.
//
// It is read-only with respect to every persistent artifact: the database is a
// throwaway file in the OS temp directory and the Golden D1 database is never
// opened.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ACTIVE_ROOT = join(ROOT, "drizzle-active");
const REVISION_TAG = "0005_document_revision_addendum";
const REVISION_FILE = join(ACTIVE_ROOT, `${REVISION_TAG}.sql`);

const statementsOf = (sql) => sql
  .split("--> statement-breakpoint")
  .map((statement) => statement.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim())
  .filter(Boolean);

const activeTags = () => JSON.parse(readFileSync(join(ACTIVE_ROOT, "meta", "_journal.json"), "utf8"))
  .entries.map((entry) => entry.tag);

const openAppliedChain = () => {
  const dir = mkdtempSync(join(tmpdir(), "drizzle-active-"));
  const db = new DatabaseSync(join(dir, "chain.sqlite"));
  db.exec("PRAGMA foreign_keys=ON");
  return { db, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
};

const applyTag = (db, tag) => {
  const file = join(ACTIVE_ROOT, `${tag}.sql`);
  assert.ok(existsSync(file), `active migration ${tag} must exist`);
  db.exec("BEGIN");
  try {
    for (const statement of statementsOf(readFileSync(file, "utf8"))) db.exec(statement);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw new Error(`active migration ${tag} failed to apply: ${error.message}`);
  }
};

const applyActiveChain = (db) => { for (const tag of activeTags()) applyTag(db, tag); };

// Everything the revision migration has to survive on a live database.
const seedPreRevisionData = (db, count) => {
  db.exec(`
    INSERT INTO projects (id, name, owner_user_id, organization_id, system_domain, initial_status, created_at, updated_at)
      VALUES ('p1', 'Revision Project', 'u1', NULL, 'Fire Alarm', 'Draft', '2024-01-01', '2024-01-01');
    INSERT INTO projects (id, name, owner_user_id, organization_id, system_domain, initial_status, created_at, updated_at)
      VALUES ('p2', 'Other Project', 'u2', NULL, 'Fire Alarm', 'Draft', '2024-01-01', '2024-01-01');
  `);
  for (let index = 1; index <= count; index += 1) {
    db.exec(`
      INSERT INTO documents (id, project_id, logical_name, document_type, classification_source, created_by)
        VALUES ('d${index}', 'p1', 'Doc ${index}.pdf', 'BOQ', 'Manual', 'u1');
      INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by)
        VALUES ('v${index}', 'd${index}', 1, 'Doc ${index}.pdf', 'v${index}.pdf', 'pdf', 'application/pdf', 10, 'sha${index}', 'key/${index}.pdf', 'u1');
      UPDATE documents SET current_version_id = 'v${index}' WHERE id = 'd${index}';
    `);
  }
};

// Bring a real pre-revision database forward, then let the revision migration
// run against it exactly as production would.
const openChainWithPreRevisionData = (count) => {
  const opened = openAppliedChain();
  for (const tag of activeTags()) {
    if (tag === REVISION_TAG) continue;
    applyTag(opened.db, tag);
  }
  seedPreRevisionData(opened.db, count);
  applyTag(opened.db, REVISION_TAG);
  return opened;
};

const expectReject = (label, run) => {
  assert.throws(run, undefined, `${label} must be rejected by the revision authority`);
};

test("DOC-R3A.1 the whole active chain applies in order inside transactions with foreign keys enforced", () => {
  const { db, cleanup } = openAppliedChain();
  try {
    applyActiveChain(db);
    // 317 business tables: the 314 canonical set plus
    // estimator_understanding_field_reviews (active 0012, R11 Phase 6),
    // specification_clause_candidate_decisions (active 0016, MVP-CLOSE-16) and
    // fire_alarm_preliminary_sizing_snapshots (active 0017, GOLDEN-6C2).
    assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().count, 317);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0, "the applied chain must leave no dangling foreign key");
  } finally {
    cleanup();
  }
});

test("DOC-R3A.1 the backfill gives every pre-existing document exactly one self-family and no document is invented", () => {
  const { db, cleanup } = openChainWithPreRevisionData(5);
  try {
    const families = db.prepare("SELECT id, project_id, base_document_id, name FROM document_families ORDER BY base_document_id").all();
    assert.equal(families.length, 5, "one family per pre-existing document, and no others");
    assert.deepEqual(families.map((family) => family.id), ["docfam_d1", "docfam_d2", "docfam_d3", "docfam_d4", "docfam_d5"]);
    for (const family of families) {
      assert.equal(family.project_id, "p1");
      assert.equal(family.name, `Doc ${family.base_document_id.slice(1)}.pdf`);
    }
    for (const document of db.prepare("SELECT id, document_family_id FROM documents ORDER BY id").all()) {
      assert.equal(document.document_family_id, `docfam_${document.id}`);
    }

    // The backfill must not fabricate documents, versions or any other history.
    assert.equal(db.prepare("SELECT count(*) AS count FROM documents").get().count, 5);
    assert.equal(db.prepare("SELECT count(*) AS count FROM document_versions").get().count, 5);
    assert.equal(db.prepare("SELECT count(*) AS count FROM document_supersessions").get().count, 0);
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally {
    cleanup();
  }
});

test("DOC-R3A.1 a family may not cross a project and may not be anchored twice", () => {
  const { db, cleanup } = openChainWithPreRevisionData(1);
  try {
    // The backfill has already anchored one family on d1, so a second family there
    // would prove nothing about the project rule. A document created after the
    // migration has a free base-document slot, which isolates the two rules.
    db.prepare("INSERT INTO documents (id, project_id, logical_name, document_type, classification_source, created_by) VALUES ('d-new', 'p1', 'New.pdf', 'BOQ', 'Manual', 'u1')").run();

    expectReject("a family anchored on a document from another project", () => {
      db.prepare("INSERT INTO document_families (id, project_id, base_document_id) VALUES ('bad', 'p2', 'd-new')").run();
    });
    db.prepare("INSERT INTO document_families (id, project_id, base_document_id) VALUES ('good', 'p1', 'd-new')").run();
    expectReject("a second family anchored on the same base document", () => {
      db.prepare("INSERT INTO document_families (id, project_id, base_document_id) VALUES ('again', 'p1', 'd-new')").run();
    });
    expectReject("a family anchored on a document that does not exist", () => {
      db.prepare("INSERT INTO document_families (id, project_id, base_document_id) VALUES ('orphan', 'p1', 'missing')").run();
    });
    assert.equal(db.prepare("SELECT count(*) AS count FROM document_families WHERE base_document_id='d-new'").get().count, 1);
  } finally {
    cleanup();
  }
});

test("DOC-R3A.1 a supersession history row is append-only", () => {
  const { db, cleanup } = openChainWithPreRevisionData(1);
  try {
    db.prepare("INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by) VALUES ('v2', 'd1', 2, 'x.pdf', 'v2.pdf', 'pdf', 'application/pdf', 10, 'sha2', 'k2.pdf', 'u1')").run();
    db.prepare("INSERT INTO document_supersessions (id, superseding_version_id, superseded_version_id, scope_type, supersession_type, created_by) VALUES ('s1', 'v2', 'v1', 'FULL_DOCUMENT', 'REVISION', 'u1')").run();

    expectReject("rewriting a recorded supersession", () => {
      db.prepare("UPDATE document_supersessions SET supersession_type='CORRECTION' WHERE id='s1'").run();
    });
    expectReject("deleting a recorded supersession", () => {
      db.prepare("DELETE FROM document_supersessions WHERE id='s1'").run();
    });
    assert.deepEqual({ ...db.prepare("SELECT id, supersession_type FROM document_supersessions WHERE id='s1'").get() }, { id: "s1", supersession_type: "REVISION" });
  } finally {
    cleanup();
  }
});

test("DOC-R3A.1 a supersession may not fuse two independent revision chains", () => {
  const { db, cleanup } = openChainWithPreRevisionData(2);
  try {
    db.prepare("INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by) VALUES ('v3', 'd1', 2, 'x.pdf', 'v3.pdf', 'pdf', 'application/pdf', 10, 'sha3', 'k3.pdf', 'u1')").run();
    expectReject("a supersession from one document's version to another's", () => {
      db.prepare("INSERT INTO document_supersessions (id, superseding_version_id, superseded_version_id, scope_type, supersession_type, created_by) VALUES ('cross', 'v3', 'v2', 'FULL_DOCUMENT', 'REVISION', 'u1')").run();
    });
  } finally {
    cleanup();
  }
});

test("DOC-R3A.1 an impossible calendar date is refused, not just a malformed one", () => {
  const { db, cleanup } = openChainWithPreRevisionData(1);
  try {
    const insert = (id, effectiveFrom) => db.prepare(`
      INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by, effective_from)
      VALUES (?, 'd1', ?, 'x.pdf', ?, 'pdf', 'application/pdf', 10, ?, 'k.pdf', 'u1', ?)
    `).run(id, Number(id.slice(1)), `${id}.pdf`, `sha-${id}`, effectiveFrom);

    // A bare calendar date and a full ISO-8601 instant are both legitimate.
    insert("v2", "2026-09-25");
    insert("v3", "2026-09-25T12:00:00.000Z");
    // Shape-valid but not a real date, and not a date at all.
    expectReject("February 31st", () => insert("v4", "2026-02-31"));
    expectReject("a month of 13", () => insert("v5", "2026-13-01"));
    expectReject("a non-date string", () => insert("v6", "not-a-date"));
  } finally {
    cleanup();
  }
});

test("DOC-R3A.1 effective time is separate from recorded time and an inverted window is refused", () => {
  const { db, cleanup } = openChainWithPreRevisionData(1);
  try {
    const insert = (id, effectiveFrom, effectiveTo) => db.prepare(`
      INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by, effective_from, effective_to)
      VALUES (?, 'd1', ?, 'x.pdf', ?, 'pdf', 'application/pdf', 10, ?, 'k.pdf', 'u1', ?, ?)
    `).run(id, Number(id.slice(1)), `${id}.pdf`, `sha-${id}`, effectiveFrom, effectiveTo);

    // A revision may be recorded now and only become governing later.
    insert("v2", "2099-01-01", null);
    assert.equal(db.prepare("SELECT effective_from FROM document_versions WHERE id='v2'").get().effective_from, "2099-01-01");
    // An open or a closed but ordered window is accepted.
    insert("v3", "2024-01-01", null);
    insert("v4", "2024-01-01", "2024-06-01");
    expectReject("an effective window that ends before it starts", () => insert("v5", "2024-06-01", "2024-01-01"));

    // A closed window is historical, not deleted: recorded time is untouched.
    const historical = db.prepare("SELECT uploaded_at, effective_from, effective_to FROM document_versions WHERE id='v4'").get();
    assert.equal(historical.effective_to, "2024-06-01");
    assert.ok(historical.uploaded_at, "recorded time must survive effective-time governance");
  } finally {
    cleanup();
  }
});

test("DOC-R3A.1 supersession is append-only history that must name a real, distinct, scoped target", () => {
  const { db, cleanup } = openChainWithPreRevisionData(1);
  try {
    db.prepare("INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by) VALUES ('v2', 'd1', 2, 'x.pdf', 'v2.pdf', 'pdf', 'application/pdf', 10, 'sha2', 'k2.pdf', 'u1')").run();

    const supersede = ({ id, superseding, superseded, scope, scopeId, type, from, to = null }) => db.prepare(`
      INSERT INTO document_supersessions (id, superseding_version_id, superseded_version_id, scope_type, scope_id, supersession_type, effective_from, effective_to, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'u1')
    `).run(id, superseding, superseded, scope, scopeId, type, from, to);

    supersede({ id: "s1", superseding: "v2", superseded: "v1", scope: "FULL_DOCUMENT", scopeId: null, type: "REVISION", from: "2024-02-01" });
    supersede({ id: "s2", superseding: "v2", superseded: "v1", scope: "BOQ_ROW", scopeId: "boq-item-7", type: "ADDENDUM", from: "2024-02-01" });

    expectReject("a version superseding itself", () => supersede({ id: "s3", superseding: "v2", superseded: "v2", scope: "FULL_DOCUMENT", scopeId: null, type: "REVISION", from: null }));
    expectReject("a partial supersession with no scope target", () => supersede({ id: "s4", superseding: "v2", superseded: "v1", scope: "CLAUSE", scopeId: null, type: "ADDENDUM", from: null }));
    expectReject("a partial supersession with a blank scope target", () => supersede({ id: "s5", superseding: "v2", superseded: "v1", scope: "SECTION", scopeId: "   ", type: "ADDENDUM", from: null }));
    expectReject("a full-document supersession carrying a scope target", () => supersede({ id: "s6", superseding: "v2", superseded: "v1", scope: "FULL_DOCUMENT", scopeId: "4.2", type: "ADDENDUM", from: null }));
    expectReject("an unknown supersession scope", () => supersede({ id: "s7", superseding: "v2", superseded: "v1", scope: "PARAGRAPH", scopeId: "x", type: "ADDENDUM", from: null }));
    expectReject("an unknown supersession type", () => supersede({ id: "s8", superseding: "v2", superseded: "v1", scope: "SECTION", scopeId: "4.2", type: "ERRATUM", from: null }));
    expectReject("an inverted supersession effective window", () => supersede({ id: "s9", superseding: "v2", superseded: "v1", scope: "SECTION", scopeId: "4.2", type: "ADDENDUM", from: "2024-06-01", to: "2024-01-01" }));
    expectReject("a supersession of a version that does not exist", () => supersede({ id: "s10", superseding: "v2", superseded: "missing", scope: "FULL_DOCUMENT", scopeId: null, type: "REVISION", from: null }));
    expectReject("a duplicate supersession of the same scope", () => supersede({ id: "s11", superseding: "v2", superseded: "v1", scope: "FULL_DOCUMENT", scopeId: null, type: "REVISION", from: "2024-03-01" }));
    expectReject("a duplicate partial supersession of the same scope", () => supersede({ id: "s12", superseding: "v2", superseded: "v1", scope: "BOQ_ROW", scopeId: "boq-item-7", type: "ADDENDUM", from: "2024-04-01" }));
    expectReject("an impossible supersession effective date", () => supersede({ id: "s13", superseding: "v2", superseded: "v1", scope: "SECTION", scopeId: "4.3", type: "ADDENDUM", from: "2024-02-31" }));

    // The rejected writes left the governed history exactly as it was.
    assert.deepEqual(db.prepare("SELECT id, scope_type, scope_id, supersession_type FROM document_supersessions ORDER BY id").all().map((row) => ({ ...row })), [
      { id: "s1", scope_type: "FULL_DOCUMENT", scope_id: null, supersession_type: "REVISION" },
      { id: "s2", scope_type: "BOQ_ROW", scope_id: "boq-item-7", supersession_type: "ADDENDUM" },
    ]);
  } finally {
    cleanup();
  }
});

test("DOC-R3A.1 the revision migration is additive and never rewrites existing evidence", () => {
  const statements = statementsOf(readFileSync(REVISION_FILE, "utf8"));
  const sql = statements.join(";\n");

  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i, "the revision migration must never delete rows");
  assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i, "dropping a table cannot apply while foreign keys are enforced");
  assert.doesNotMatch(sql, /\bALTER\s+TABLE\s+`?\w+`?\s+RENAME\b/i, "renaming a rebuilt parent table cannot apply inside a transaction");

  const dataStatements = statements.filter((statement) => /^(?:INSERT|UPDATE)\b/i.test(statement));
  assert.equal(dataStatements.length, 2, "the backfill must be exactly one family insert and one family link");
  assert.match(dataStatements[0], /^INSERT INTO `document_families`/);
  assert.match(dataStatements[1], /^UPDATE `documents` SET `document_family_id` = 'docfam_' \|\| `id` WHERE `document_family_id` IS NULL;$/);

  for (const table of ["document_versions", "document_classifications", "document_audit_events", "boq_extraction_versions", "review_decisions", "document_processing_runs"]) {
    assert.doesNotMatch(sql, new RegExp(`^(?:UPDATE|DELETE\\s+FROM)\\s+\`?${table}\`?`, "im"), `${table} history must never be rewritten by the revision migration`);
  }
});
