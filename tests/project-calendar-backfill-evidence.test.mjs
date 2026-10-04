/**
 * DOC-R3 CHECK A — the calendar backfill is evidence-scoped, never universal.
 *
 * The first revision of 0006 stamped Asia/Riyadh on EVERY undeclared project
 * row. CHECK A proved that fabricated timezone meaning (scratch names, test
 * journeys, validation fixtures). This suite pins the repair through the actual
 * shipped migration statements on disposable databases, using the chain
 * harness's hold-back helper so seed rows exist BEFORE the migration under
 * test runs — the only order in which a backfill can be observed:
 *
 *   * 0006 stamps ONLY projects with current, Confirmed, Saudi Arabia NPQ rows;
 *   * pre-declared rows (any zone) are untouched;
 *   * Draft-Saudi, superseded-Saudi, non-Saudi, and NPQ-less projects stay
 *     NULL (undeclared);
 *   * 0007 NULLs exactly the fabricated rows on databases where blanket 0006
 *     already ran, and is idempotent;
 *   * the 0006 file itself no longer contains a blanket UPDATE (static guard).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { openEmptyDatabase, activeTags, applyTag, statementsOf, migrationPath } from "./helpers/active-chain.mjs";

// Apply the chain up to (excluding) `stopTag`, hand the live database to
// `seed`, then apply `stopTag`. `applyChainAround` cannot express this: it
// holds back exactly one tag, so holding back 0006 would still run 0007 ahead
// of it against columns 0006 has not created yet.
const applyThroughSeedThen = (stopTag, seed) => {
  const opened = openEmptyDatabase();
  try {
    for (const tag of activeTags()) {
      if (tag === stopTag) break;
      applyTag(opened.db, tag);
    }
    seed?.(opened.db);
    applyTag(opened.db, stopTag);
  } catch (error) {
    opened.close();
    throw error;
  }
  return opened;
};

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

const seedBase = (db, { declareLondon = true } = {}) => {
  db.exec(`INSERT INTO organizations (id, name) VALUES ('org-a', 'Org A')`);
  const project = (id, name) =>
    db.prepare(`INSERT INTO projects (id, name, owner_user_id, organization_id) VALUES (?,?,?,?)`)
      .run(id, name, "user-a", "org-a");
  project("p-tier1", "Al Mousa School");
  project("p-draft", "Draft Onboarding");
  project("p-other", "Abu Dhabi Tower");
  project("p-none", "dfg");
  project("p-london", "London Office");
  // A pre-declared row must survive every migration below untouched. It can
  // only be set AFTER 0006 creates the columns, so seeds that run before 0006
  // pass declareLondon:false and declare it after (see the idempotency test).
  if (declareLondon) {
    db.prepare(`UPDATE projects SET declared_timezone=?, declared_utc_offset_minutes=? WHERE id=?`)
      .run("Europe/London", 0, "p-london");
  }
  const npq = (id, projectId, country, status) =>
    db.prepare(`INSERT INTO project_npq_profile_versions
      (id, project_id, version_number, country, city, location, primary_system, delivery_scope, input_fingerprint, status, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, projectId, 1, country, null, null, "Fire Alarm", "Supply and Installation", `fp-${id}`, status, "user-a");
  npq("n-tier1", "p-tier1", "Saudi Arabia", "Confirmed");
  npq("n-draft", "p-draft", "Saudi Arabia", "Draft");
  npq("n-other", "p-other", "United Arab Emirates", "Confirmed");
};

const declared = (db) =>
  Object.fromEntries(
    db.prepare(`SELECT id, declared_timezone, declared_utc_offset_minutes FROM projects ORDER BY id`).all()
      .map((r) => [r.id, [r.declared_timezone, r.declared_utc_offset_minutes]]),
  );

test("CHECK-A 0006 stamps only Confirmed-Saudi projects and leaves the rest undeclared", () => {
  const opened = applyThroughSeedThen("0006_project_effective_time_calendar", (db) => seedBase(db, { declareLondon: false }));
  try {
    assert.deepEqual(declared(opened.db), {
      "p-tier1": ["Asia/Riyadh", 180],
      "p-draft": [null, null],
      "p-other": [null, null],
      "p-none": [null, null],
      "p-london": [null, null],
    });
    // Idempotency + pre-declared-untouched: declare London now, re-run 0006's
    // UPDATE alone, and prove nothing moves.
    opened.db.prepare(`UPDATE projects SET declared_timezone=?, declared_utc_offset_minutes=? WHERE id=?`)
      .run("Europe/London", 0, "p-london");
    const update = statementsOf(readFileSync(migrationPath("0006_project_effective_time_calendar"), "utf8"))
      .find((statement) => /^UPDATE\s+`projects`/i.test(statement));
    assert.ok(update, "0006 must contain its scoped projects UPDATE");
    opened.db.exec(update);
    assert.deepEqual(declared(opened.db)["p-london"], ["Europe/London", 0]);
    assert.deepEqual(declared(opened.db)["p-tier1"], ["Asia/Riyadh", 180]);
  } finally {
    opened.close();
  }
});

test("CHECK-A a superseded Saudi NPQ is not evidence", () => {
  const opened = applyThroughSeedThen("0006_project_effective_time_calendar", (db) => {
    seedBase(db, { declareLondon: false });
    // The project's only Saudi NPQ is superseded; its current row says nothing.
    db.exec(`UPDATE project_npq_profile_versions SET superseded_at='2026-01-02T00:00:00Z' WHERE id='n-tier1'`);
    db.prepare(`INSERT INTO project_npq_profile_versions
      (id, project_id, version_number, country, city, location, primary_system, delivery_scope, input_fingerprint, status, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      "n-tier1-v2", "p-tier1", 2, null, null, null, "Fire Alarm", "Supply and Installation", "fp-v2", "Draft", "user-a");
  });
  try {
    assert.deepEqual(declared(opened.db)["p-tier1"], [null, null]);
  } finally {
    opened.close();
  }
});

test("CHECK-A 0007 repairs blanket-stamped rows and keeps evidenced and deliberate declarations", () => {
  const opened = applyThroughSeedThen("0007_project_calendar_evidence_repair", (db) => {
    seedBase(db);
    // Simulate the world where blanket 0006 already ran: every row stamped.
    db.exec(`UPDATE projects SET declared_timezone='Asia/Riyadh', declared_utc_offset_minutes=180 WHERE declared_timezone IS NULL`);
    // A deliberate non-Riyadh declaration (different signature) must survive.
    db.prepare(`UPDATE projects SET declared_timezone=?, declared_utc_offset_minutes=? WHERE id=?`)
      .run("Asia/Dubai", 240, "p-other");
  });
  try {
    assert.deepEqual(declared(opened.db), {
      "p-tier1": ["Asia/Riyadh", 180],
      "p-draft": [null, null],
      "p-other": ["Asia/Dubai", 240],
      "p-none": [null, null],
      "p-london": ["Europe/London", 0],
    });
  } finally {
    opened.close();
  }
});

test("CHECK-A the 0006 file contains no blanket backfill", () => {
  const sql = readFileSync(join(ROOT, "drizzle-active", "0006_project_effective_time_calendar.sql"), "utf8");
  assert.doesNotMatch(
    sql,
    /UPDATE\s+`projects`\s+SET[^;]*WHERE\s+`declared_timezone`\s+IS\s+NULL\s*;/i,
    "a bare WHERE-declared_timezone-IS-NULL stamp is the fabrication signature and must never return",
  );
  assert.match(sql, /project_npq_profile_versions/, "the scoped backfill must key on NPQ evidence");
});
