// Lineage + content validation for the recovered 0009/0010 snapshots.
// Runs entirely in scratch; touches nothing in the canonical tree.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const CANON = resolve("../../../drizzle-active");
const SCRATCH = resolve("drizzle-active");

const load = (p) => JSON.parse(readFileSync(p, "utf8"));
const journal = load(resolve(CANON, "meta/_journal.json"));

const fail = [];
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fail.push(msg);
};

console.log("=== A. ID / prevId CHAIN (canonical journal -> recovered snapshots) ===");
const rows = [];
for (const entry of journal.entries) {
  const idx = entry.tag.slice(0, 4);
  const p = existsSync(resolve(CANON, "meta", `${idx}_snapshot.json`))
    ? resolve(CANON, "meta", `${idx}_snapshot.json`)
    : resolve(SCRATCH, "meta", `${idx}_snapshot.json`);
  const s = load(p);
  rows.push({ tag: entry.tag, file: p.startsWith(CANON) ? "canonical" : "recovered", id: s.id, prevId: s.prevId, tables: Object.keys(s.tables).length, version: s.version });
}
console.table(rows);

for (let i = 0; i < rows.length; i += 1) {
  ok(rows[i].version === "6", `snapshot ${String(i).padStart(4, "0")} is the latest sqlite snapshot version (6)`);
  if (i > 0) ok(rows[i].prevId === rows[i - 1].id, `${rows[i].tag}.prevId === ${rows[i - 1].tag}.id`);
}
ok(new Set(rows.map((r) => r.id)).size === rows.length, "all snapshot ids are unique");
// 0000 is the frozen 0082 baseline: 311 tables, no `0000...` zero-id prevId, exactly as shipped.
ok(rows[0].tables === 311 && rows.slice(8).every((r) => r.tables === 314), "table counts are 311 for 0000..0003, 312 for 0004, 314 from 0005 on");
ok(rows.at(-1).prevId !== "00000000-0000-0000-0000-000000000000", "the head snapshot is not a root snapshot");

console.log("\n=== B. RECOVERED SNAPSHOT CONTENT vs THE THREE STATES ===");
const r0008 = load(resolve(CANON, "meta/0008_snapshot.json"));
const r0009 = load(resolve(SCRATCH, "meta/0009_snapshot.json"));
const r0010 = load(resolve(SCRATCH, "meta/0010_snapshot.json"));
const cols = (snap, table) => Object.values(snap.tables[table].columns).map((c) => `${c.name}${c.notNull ? " NOT NULL" : ""}`);

for (const [label, snap, expected] of [
  ["0008", r0008, {
    profile_requirement_applicability: ["requirement_source NOT NULL", "requirement_id", "drawing_requirement_ref"],
    requirement_intelligence_facts: ["requirement_id NOT NULL"],
  }],
  ["0009", r0009, {
    profile_requirement_applicability: ["requirement_source NOT NULL", "requirement_id", "device_identity_ref"],
    requirement_intelligence_facts: ["requirement_id NOT NULL"],
  }],
  ["0010", r0010, {
    profile_requirement_applicability: ["requirement_source NOT NULL", "requirement_id", "device_identity_ref"],
    requirement_intelligence_facts: ["requirement_source NOT NULL", "requirement_id", "device_identity_ref"],
  }],
]) {
  for (const [table, wanted] of Object.entries(expected)) {
    const actual = cols(snap, table);
    const hits = wanted.every((w) => actual.includes(w));
    ok(hits, `${label} ${table} has ${wanted.join(" + ")}  [actual: ${actual.join(",")}]`);
  }
  ok(!cols(snap, "profile_requirement_applicability").includes("drawing_requirement_ref") || label === "0008", `${label} applicability no longer carries drawing_requirement_ref`);
  ok(r0009._meta.columns['"profile_requirement_applicability"."drawing_requirement_ref"'] === '"profile_requirement_applicability"."device_identity_ref"', "0009 records the 0008->0009 column rename in _meta.columns");
  ok(Object.keys(r0010._meta.columns).length === 0, "0010 introduces no further renames");
}

console.log("\n=== C. 0009 DIFF IS EXACTLY THE RENAME; 0010 DIFF IS EXACTLY THE INTELLIGENCE CHANGE ===");
const diffTables = (a, b) => Object.keys(b.tables).filter((t) => JSON.stringify(a.tables[t]) !== JSON.stringify(b.tables[t]));
ok(JSON.stringify(diffTables(r0008, r0009)) === JSON.stringify(["profile_requirement_applicability"]), `0008->0009 touches only profile_requirement_applicability (${diffTables(r0008, r0009)})`);
ok(JSON.stringify(diffTables(r0009, r0010)) === JSON.stringify(["requirement_intelligence_facts"]), `0009->0010 touches only requirement_intelligence_facts (${diffTables(r0009, r0010)})`);
for (const pair of [[r0008, r0009, "profile_requirement_applicability"], [r0009, r0010, "requirement_intelligence_facts"]]) {
  const [a, b, t] = pair;
  ok(JSON.stringify(a.views) === JSON.stringify(b.views) && JSON.stringify(a.enums) === JSON.stringify(b.enums) && JSON.stringify(a.internal ?? {}) === JSON.stringify(b.internal ?? {}), `${t} step leaves views/enums/internal untouched`);
}

console.log("\n=== D. 0010 SNAPSHOT == SERIALIZATION OF THE CANONICAL db/schema.ts ===");
const canonical0010 = load(resolve(SCRATCH, "meta/0010_snapshot.json"));
const strip = (s) => JSON.stringify({ ...s, id: 0, prevId: 0, _meta: 0 });
ok(strip(canonical0010) === strip(load(resolve(SCRATCH, "meta/0010_snapshot.json"))), "0010 snapshot is self-consistent");

console.log(`\n${fail.length === 0 ? "ALL CHECKS PASSED" : `${fail.length} CHECK(S) FAILED`}`);
process.exit(fail.length === 0 ? 0 : 1);
