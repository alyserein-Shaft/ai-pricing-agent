// Cross-check the recovered 0010 snapshot against reality:
//   (1) a DISPOSABLE sqlite built by applying the canonical drizzle-active/*.sql 0000..0010
//   (2) the LIVE D1 at .wrangler/state/... opened readOnly:true (never written)
// The disposable DB lives in the sandbox TMPDIR, not in the repo.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const CANON = resolve("../../../drizzle-active");
const SCRATCH = resolve("drizzle-active");
const TMP = process.env.TMPDIR || "/tmp";
const CHAIN = resolve(TMP, "laneA-chain.sqlite");

const fail = [];
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fail.push(msg);
};
const load = (p) => JSON.parse(readFileSync(p, "utf8"));
const snapCols = (snap, table) => Object.values(snap.tables[table].columns).map((c) => c.name).sort();
const dbCols = (db, table) => db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all().map((c) => c.name).sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const r0009 = load(resolve(SCRATCH, "meta/0009_snapshot.json"));
const r0010 = load(resolve(SCRATCH, "meta/0010_snapshot.json"));

console.log("=== 1. DISPOSABLE CHAIN FROM THE CANONICAL .sql FILES (0000..0010) ===");
if (existsSync(CHAIN)) rmSync(CHAIN);
const files = readdirSync(CANON).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort();
ok(files.length === 11, `canonical active chain has 11 SQL files (${files.length})`);
for (const f of files) execFileSync("/usr/bin/sqlite3", [CHAIN], { input: readFileSync(resolve(CANON, f), "utf8") });
const chain = new DatabaseSync(CHAIN, { readOnly: true });
ok(chain.prepare("PRAGMA integrity_check").get().integrity_check === "ok", "disposable chain integrity_check is ok");
ok(chain.prepare("PRAGMA foreign_key_check").all().length === 0, "disposable chain foreign_key_check is clean");
for (const t of ["profile_requirement_applicability", "requirement_intelligence_facts"]) {
  ok(same(snapCols(r0010, t), dbCols(chain, t)), `0010 snapshot columns == disposable-chain columns for ${t}`);
}
// state 0008 (rename source) must NOT survive, and the 3-class vocabulary must be present.
ok(!dbCols(chain, "profile_requirement_applicability").includes("drawing_requirement_ref"), "disposable chain no longer has drawing_requirement_ref");
for (const t of ["profile_requirement_applicability", "requirement_intelligence_facts"]) {
  const ddl = chain.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(t).sql;
  ok(/requirement_source` IN \('Specification', 'DrawingDeviceIdentity', 'BOQDeviceIdentity'\)/.test(ddl), `${t} carries the 3-class authority CHECK`);
  ok(/exactly_one_source_ck/.test(ddl), `${t} carries the exactly-one-source CHECK`);
}
const idx = chain.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='profile_requirement_applicability' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
ok(same(idx, ["profile_applicability_device_identity_idx", "profile_applicability_requirement_idx", "profile_applicability_status_idx"]), `disposable chain indexes on profile_requirement_applicability: ${idx.join(", ")}`);
chain.close();
rmSync(CHAIN, { force: true });

console.log("\n=== 2. LIVE D1 (readOnly, never written) ===");
const LIVE = resolve("../../../.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite");
if (existsSync(LIVE)) {
  const live = new DatabaseSync(LIVE, { readOnly: true });
  for (const t of ["profile_requirement_applicability", "requirement_intelligence_facts"]) {
    ok(same(snapCols(r0010, t), dbCols(live, t)), `0010 snapshot columns == LIVE D1 columns for ${t}`);
    const ddl = live.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(t)?.sql ?? "";
    ok(/BOQDeviceIdentity/.test(ddl), `LIVE D1 ${t} carries the 3-class authority CHECK`);
  }
  const liveIdx = live.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='profile_requirement_applicability' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
  ok(liveIdx.includes("profile_applicability_device_identity_idx"), `LIVE D1 has profile_applicability_device_identity_idx (${liveIdx.join(", ")})`);
  ok(live.prepare("PRAGMA integrity_check").get().integrity_check === "ok", "LIVE D1 integrity_check is ok (read-only inspection)");
  live.close();
} else {
  console.log(`SKIP  live D1 not found at ${LIVE}`);
}

console.log(`\n${fail.length === 0 ? "ALL CROSS-CHECKS PASSED" : `${fail.length} CROSS-CHECK(S) FAILED`}`);
process.exit(fail.length === 0 ? 0 : 1);
