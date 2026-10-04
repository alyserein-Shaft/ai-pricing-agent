// R11-1: does Golden's LIVE row resolve through the canonical calendar service?
// Read-only. Opens the live D1 with readOnly:true and never writes.
import { DatabaseSync } from "node:sqlite";
import { resolveProjectCalendar } from "../app/domain/effective-time-policy.mjs";

const DB =
  ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
const GOLDEN = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";

const db = new DatabaseSync(DB, { readOnly: true });

let row;
try {
  row = db
    .prepare("SELECT id, declared_timezone, declared_utc_offset_minutes FROM projects WHERE id=?")
    .get(GOLDEN);
  console.log("live calendar query: OK", JSON.stringify(row));
} catch (err) {
  console.log("live calendar query FAILS:", err.message);
  row = { id: GOLDEN };
  console.log("=> 0006 is PENDING: the declared_* columns do not exist on the live D1");
}

console.log("\nrow handed to resolveProjectCalendar:", JSON.stringify(row));

try {
  const calendar = resolveProjectCalendar(row, { projectId: GOLDEN });
  console.log("RESOLVED:", JSON.stringify(calendar));
} catch (err) {
  console.log("THROWS:", err.code ?? err.name);
  console.log("  ", String(err.message).slice(0, 200));
}

// What the evidence says, independent of the columns.
const npq = db
  .prepare(
    `SELECT id, country, status, superseded_at FROM project_npq_profile_versions
      WHERE project_id=? AND superseded_at IS NULL AND status='Confirmed' AND country='Saudi Arabia'`,
  )
  .all(GOLDEN);
console.log("\nevidence backing (0006 backfill EXISTS / 0007 guard NOT EXISTS):");
console.log("  matching Confirmed Saudi Arabia NPQ rows:", npq.length, JSON.stringify(npq));
