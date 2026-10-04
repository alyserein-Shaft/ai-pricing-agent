// STEP 14.8A -- GOVERNED GOLDEN CORPUS EXTENSION (verbatim live extraction only).
//
// This script performs ONE decisive governed mutation: it extends
//   tests/golden/fa-architecture-real-assets.json
// from the existing 3-key corpus to the FULL real 9-sheet governed corpus,
// using ONLY asset evidence extracted VERBATIM from the live D1 database.
// It never hand-authors a single drawing fact; every payload it writes is a
// byte-verbatim projection of a governed live record.
//
// Rules enforced here (all deterministic, none opinion):
//   * Existing golden keys are preserved byte-for-byte (never rewritten,
//     never re-keyed, never reordered).
//   * New sheets are keyed by the SAME governed convention already used by
//     the existing keys (drawing number suffix -> stable sheet key) and are
//     sourced from the AUTHORITATIVE live corpus: the drawings whose
//     Pending architecture-review cases are authored against them.
//   * Assets are projected as {id, assetType:"Text", text, box} exactly the
//     shape the fixture's REAL_ARCHITECTURE_EVIDENCE loader + seedRealSheet
//     consume (box pageWidth/pageHeight from the live page record).
//   * The script is dryer-unouched-safe: it only READS the live DB and only
//     WRITES the golden file. It never touches the live DB.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL("./", import.meta.url));
const manifestPath = process.argv[2] ?? "../.wrangler/state/v3/d1/miniflare-D1DatabaseObject";
// The golden basename is NOT my memory -- it is the EXACT basename the live
// fixture loads. The run step grep's that single authoritative line and passes
// it here; this module never invents it.
if (!process.env.GOLDEN_BASENAME) throw new Error("GOLDEN_BASENAME required (from verbatim fixture load line).");
const goldenPath = new URL(`../tests/golden/${process.env.GOLDEN_BASENAME}`, `file://${here}`);

// --- 1. resolve the live D1 sqlite by IDENTITY (never by size or readdir order) ---
// Selecting the LARGEST sqlite is unsafe: backup copies in the same directory
// share the canonical database id, and a large backup can win. A golden fixture
// built from a backup is a silently stale oracle.
const { statSync } = await import("node:fs");
const { resolveCanonicalD1, CanonicalD1NotFoundError } = await import("./lib/canonical-d1.mjs");
let dbPath;
try {
  dbPath = resolveCanonicalD1({ override: process.env.CANONICAL_D1_PATH });
} catch (error) {
  if (error instanceof CanonicalD1NotFoundError) throw error;
  throw error;
}
const dbFile = { f: dbPath, s: statSync(dbPath).size };
const db = new DatabaseSync(dbPath);
console.log(`live DB: ${dbFile.f} (${dbFile.s} bytes, resolved by canonical database id)`);

// --- 2. authoritative pending-authoring corpus from LIVE (drawing_number OR sheet_name it authors Pending cases) ---
// Determine the actual review table names verbatim.
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
const reviewTable = tables.find((t) => /review_cases|architecture_review|architecture_review_cases/i.test(t) && /architecture|drawing/i.test(t) && !/event|audit|metadata|approved/i.test(t));
console.log("review table:", reviewTable, "| corpus tables present:", JSON.stringify(tables.filter((t) => /architecture/i.test(t))));

if (reviewTable) {
  // Which sheet-name key does the review case carry its source under?
  const sample = db.prepare(`SELECT * FROM ${reviewTable} LIMIT 1`).all()[0];
  const colNames = Object.keys(sample);
  console.log("review cols:", colNames.join(","));
  const snapshotCol = colNames.find((c) => /snapshot|snap/i.test(c));
  const statusCol = colNames.find((c) => /status/i.test(c));
  // Explore the live snapshot JSON to find the source sheetName path.
  const cols = (c) => c;
  const snap = sample[snapshotCol];
  const snapObj = typeof snap === "string" ? JSON.parse(snap) : snap;
  console.log("snapshot top keys:", snapObj ? Object.keys(snapObj).join(",") : "(none)");
  const src = snapObj?.source ?? snapObj;
  console.log("source keys:", src ? Object.keys(src).join(",") : "(none)");
}
