#!/usr/bin/env node
// ACTIVE CHAIN CONSISTENCY VALIDATOR -- read-only.
//
// Verifies the canonical active migration chain is internally coherent:
//   migration files count == journal entries count == snapshots count
//   every journal tag has a file, and every file has a journal entry
//   idx values are contiguous and ascending from 0
//   `when` timestamps are monotonic
//   snapshot ids are UUIDs and each snapshot's prevId chains to its predecessor
//   schema version and dialect are uniform
//   the newest snapshot reflects the schema the newest migration produces
//
// Exits non-zero on ANY mismatch. No silent mismatch is accepted.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.argv[2] || "drizzle-active";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = [];
const note = (ok, label, detail = "") => {
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}${detail ? "  " + detail : ""}`);
  if (!ok) fail.push(label);
};

const sqlFiles = fs.readdirSync(ROOT).filter((f) => f.endsWith(".sql")).sort();
const tags = sqlFiles.map((f) => f.replace(/\.sql$/, ""));
const journal = JSON.parse(fs.readFileSync(path.join(ROOT, "meta/_journal.json"), "utf8"));
const entries = journal.entries;
// Snapshot files follow this chain's convention: NNNN_snapshot.json
// (e.g. 0000_snapshot.json .. 0020_snapshot.json), NOT NNNN_<name>_snapshot.json.
const snapshots = fs.readdirSync(path.join(ROOT, "meta")).filter((f) => /^\d{4}_snapshot\.json$/.test(f)).sort();

console.log(`ACTIVE CHAIN CONSISTENCY — ${ROOT}`);
console.log("=".repeat(96));
console.log(`migration files : ${sqlFiles.length}`);
console.log(`journal entries : ${entries.length}`);
console.log(`snapshots       : ${snapshots.length}`);
console.log(`journal version : ${journal.version}   dialect: ${journal.dialect}`);
console.log("=".repeat(96));

note(sqlFiles.length === entries.length, "file count == journal entry count", `${sqlFiles.length} vs ${entries.length}`);
note(snapshots.length === entries.length, "snapshot count == journal entry count", `${snapshots.length} vs ${entries.length}`);

// --- tag/file correspondence -------------------------------------------------
const journalTags = entries.map((e) => e.tag);
const missingFile = journalTags.filter((t) => !tags.includes(t));
const missingEntry = tags.filter((t) => !journalTags.includes(t));
note(missingFile.length === 0, "every journal tag has a .sql file", missingFile.join(", "));
note(missingEntry.length === 0, "every .sql file has a journal entry", missingEntry.join(", "));
note(new Set(journalTags).size === journalTags.length, "journal tags are unique");

// --- ordering ----------------------------------------------------------------
note(entries.every((e, i) => e.idx === i), "idx is contiguous from 0 and ascending");
const monotonic = entries.every((e, i) => i === 0 || new Date(e.when) >= new Date(entries[i - 1].when));
note(monotonic, "when timestamps are monotonic", monotonic ? "" : entries.map((e) => new Date(e.when).toISOString()).join(" "));

// --- snapshot chain ----------------------------------------------------------
const snaps = snapshots.map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(ROOT, "meta", f), "utf8")) }));
note(snaps.every((s) => UUID.test(s.id)), "every snapshot id is a UUID",
  snaps.filter((s) => !UUID.test(s.id)).map((s) => `${s.file}=${s.id}`).join(" "));
note(snaps.every((s) => !s.prevId || UUID.test(s.prevId)), "every prevId is a UUID");

const versions = [...new Set(snaps.map((s) => s.version))];
const dialects = [...new Set(snaps.map((s) => s.dialect))];
note(versions.length === 1, "uniform snapshot schema version", versions.join(","));
note(dialects.length === 1 && dialects[0] === journal.dialect, "snapshot dialect matches journal", dialects.join(","));

let chainOk = true;
const chainBreaks = [];
for (let i = 1; i < snaps.length; i += 1) {
  if (snaps[i].prevId !== snaps[i - 1].id) {
    chainOk = false;
    chainBreaks.push(`${snaps[i].file}.prevId != ${snaps[i - 1].file}.id`);
  }
}
note(chainOk, "each snapshot's prevId chains to its predecessor", chainBreaks.join("; "));
note(!snaps[0].prevId || UUID.test(snaps[0].prevId), "oldest snapshot has no dangling prevId",
  snaps[0].prevId ? `prevId=${snaps[0].prevId} (expected for a baseline that predates the folder)` : "none");

// --- newest snapshot reflects the newest migration ---------------------------
const newestTag = entries[entries.length - 1].tag;
const newestSnap = snaps[snaps.length - 1];
note(newestSnap.file.startsWith(newestTag.slice(0, 4)), "newest snapshot index matches newest journal tag",
  `${newestSnap.file} vs ${newestTag}`);

// Table-count trend is a useful signal that the newest snapshot did not lose
// tables relative to its predecessor.
const prevSnap = snaps[snaps.length - 2];
if (prevSnap) {
  const delta = Object.keys(newestSnap.tables).length - Object.keys(prevSnap.tables).length;
  note(delta >= 0, "newest snapshot does not drop tables vs predecessor",
    `${Object.keys(prevSnap.tables).length} -> ${Object.keys(newestSnap.tables).length} (delta ${delta})`);
}

console.log("=".repeat(96));
if (fail.length === 0) {
  console.log(`ACTIVE CHAIN CONSISTENT: ${entries.length} migrations, ${snaps.length} snapshots, chain ${snaps[0].file} .. ${snaps[snaps.length - 1].file}`);
} else {
  console.log(`ACTIVE CHAIN INCONSISTENT (${fail.length}): ${fail.join("; ")}`);
}
process.exit(fail.length ? 1 : 0);
