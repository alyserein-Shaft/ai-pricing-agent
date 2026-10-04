// MIG — migration 0017 (fire_alarm_preliminary_sizing_snapshots) integration.
//
// MIG-1  0017 is the declared migration version, present in the drizzle-active
//        journal, and its table exists in the active chain.
// MIG-2  The live table schema matches the migration definition column set.
// MIG-3  The read route returns a governed empty state (404
//        PRELIMINARY_SIZING_REQUIRED), never a 500, when no snapshot exists.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import { MIGRATION_VERSION } from "../app/domain/production-readiness.mjs";
import { handleFireAlarmPreliminarySizingApi } from "../worker/fire-alarm-preliminary-sizing-api.mjs";

const ROOT = new URL("..", import.meta.url).pathname;

test("MIG-1. 0017 is declared, journaled, and present in the active chain", async () => {
  assert.equal(MIGRATION_VERSION, "0017_fire_alarm_preliminary_sizing_snapshots");
  const journal = JSON.parse(readFileSync(`${ROOT}/drizzle-active/meta/_journal.json`, "utf8"));
  const tags = journal.entries.map((e) => e.tag);
  assert.ok(tags.includes("0017_fire_alarm_preliminary_sizing_snapshots"), "journal must contain 0017");
  assert.ok(readdirSync(`${ROOT}/drizzle-active`).includes("0017_fire_alarm_preliminary_sizing_snapshots.sql"), "migration file must exist");
  const raw = await activeChainDatabase();
  try {
    const row = raw.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='fire_alarm_preliminary_sizing_snapshots'").get();
    assert.equal(row.c, 1, "the active chain must carry the snapshots table");
  } finally { raw.close(); }
});

test("MIG-2. live table columns match the migration definition", async () => {
  const sql = readFileSync(`${ROOT}/drizzle-active/0017_fire_alarm_preliminary_sizing_snapshots.sql`, "utf8");
  const defined = [...sql.matchAll(/`([a-z_]+)`\s+(?:text|integer)/g)].map((m) => m[1]);
  assert.ok(defined.includes("input_fingerprint"), "definition must carry the fingerprint column");
  const raw = await activeChainDatabase();
  try {
    const live = raw.prepare("PRAGMA table_info(fire_alarm_preliminary_sizing_snapshots)").all().map((c) => c.name);
    for (const col of defined) assert.ok(live.includes(col), "live table missing column " + col);
  } finally { raw.close(); }
});

test("MIG-3. empty sizing read is a governed 404, never a 500", async () => {
  const raw = await activeChainDatabase();
  try {
    raw.exec(`
      INSERT INTO organizations (id, name) VALUES ('organization_bd_shaft_internal_pilot','Pilot Org');
      INSERT INTO projects (id, name, owner_user_id, organization_id) VALUES ('p1','Mig Fixture','local-development-user','organization_bd_shaft_internal_pilot');
    `);
    const env = { DB: d1(raw) };
    const res = await handleFireAlarmPreliminarySizingApi(
      new Request("http://localhost/api/projects/p1/fire-alarm/preliminary-sizing/current"),
      env,
    );
    assert.ok(res, "route must answer, not fall through");
    assert.equal(res.status, 404, "empty snapshot set is 404, not 500");
    const body = await res.json();
    assert.equal(body.error.code, "PRELIMINARY_SIZING_REQUIRED");
  } finally { raw.close(); }
});
