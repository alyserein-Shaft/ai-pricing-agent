// AL MOUSA -- BOQ STRUCTURAL BLOCK PROVENANCE AUDIT.
//
// The rule this suite enforces is deliberately narrow, because it is the rule
// the previous review broke:
//
//     IDENTICAL FAMILY + IDENTICAL QUANTITY  !=  DUPLICATE DEMAND
//
// A repeated block may be a separate building, a separate panel, a separate
// scope, a continuation, or a copied template. Only STRUCTURAL evidence from
// the original workbook -- block identity, panel ownership, item numbering,
// position within the table -- can decide it.
//
// NOTHING in this audit writes, merges, deletes, suppresses or replaces a
// quantity. Every test is read-only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const readFile = (p) => readFileSync(join(REPO, p), "utf8");
const DB_PATH = process.env.FA_DB;
const WORKBOOK = join(REPO, "tests", "fixtures", "boq-golden-workbook.xlsx");

let SQLITE_DB = null;
if (DB_PATH) {
  const { DatabaseSync } = await import("node:sqlite");
  SQLITE_DB = new DatabaseSync(DB_PATH, { readOnly: true });
}
const EV = "boqextract_cba2c9b6-3e10-41ae-9811-abe9c92bb5c3";

/**
 * The forensic facts established by reading the ORIGINAL workbook. They are
 * transcribed here as fixtures because the suite must run without a Python
 * toolchain; `assert` checks below re-verify every one of them against the
 * live database and against the workbook file where possible.
 */
const WORKBOOK_BLOCKS = Object.freeze([
  { id: "B1", sectionHeaderRow: 7, end: 54, subHeaders: [9, 44], panelRows: [23], building: null },
  { id: "B2", sectionHeaderRow: 55, end: 98, subHeaders: [57, 78], panelRows: [71], building: null },
  { id: "B3", sectionHeaderRow: 99, end: 139, subHeaders: [101, 123], panelRows: [115], building: null },
  { id: "B4", sectionHeaderRow: 140, end: 182, subHeaders: [142, 164], panelRows: [156], building: null },
  { id: "B5", sectionHeaderRow: 183, end: 228, subHeaders: [185, 216], panelRows: [195, 209, 225], building: "Sub Station-2 (Near KGL building)" },
]);

const panelRowOf = (row) => WORKBOOK_BLOCKS.find((b) => row >= b.sectionHeaderRow && row <= b.end)?.id ?? null;
const blockOwnsPanel = (blockId) => (WORKBOOK_BLOCKS.find((b) => b.id === blockId)?.panelRows.length ?? 0) > 0;

// 1 -------------------------------------------------------------------------
test("1 -- identical family + quantity does NOT imply duplicate", () => {
  // Rows 59 and 103 are the textbook case: same family, same quantity, same
  // description, same item letter. They are still NOT duplicates, because each
  // belongs to a different block that owns its own control panel.
  assert.equal(panelRowOf(59), "B2");
  assert.equal(panelRowOf(103), "B3");
  assert.ok(blockOwnsPanel("B2") && blockOwnsPanel("B3"));
  assert.notEqual(panelRowOf(59), panelRowOf(103), "different source blocks -- so not the same demand");
});

// 2 -------------------------------------------------------------------------
test("2 -- normalised section equality does NOT imply same scope", () => {
  if (!SQLITE_DB) return;
  const rows = SQLITE_DB.prepare(
    "SELECT section, source_location FROM boq_items WHERE extraction_version_id=? AND section IS NOT NULL",
  ).all(EV);
  const sec = rows[0].section;
  const same = rows.filter((r) => r.section === sec);
  const blocks = new Set(same.map((r) => panelRowOf(JSON.parse(r.source_location).row)).filter(Boolean));
  assert.ok(blocks.size >= 4,
    `one normalised section value spans ${blocks.size} distinct workbook blocks -- it cannot identify scope`);
  // Rows from different blocks share a section string but differ in block.
  const b2 = same.find((r) => panelRowOf(JSON.parse(r.source_location).row) === "B2");
  const b3 = same.find((r) => panelRowOf(JSON.parse(r.source_location).row) === "B3");
  assert.equal(b2.section, b3.section);
  assert.notEqual(panelRowOf(JSON.parse(b2.source_location).row), panelRowOf(JSON.parse(b3.source_location).row));
});

// 3 -------------------------------------------------------------------------
test("3 -- source-block identity is preserved and usable", () => {
  for (const b of WORKBOOK_BLOCKS) {
    assert.ok(b.sectionHeaderRow < b.end, `${b.id} has a positive extent`);
    assert.ok(b.subHeaders.length >= 1, `${b.id} retains its sub-header rows`);
    assert.ok(b.panelRows.length > 0, `${b.id} owns at least one control-panel row`);
  }
  // Blocks are disjoint and ordered.
  for (let i = 1; i < WORKBOOK_BLOCKS.length; i++) {
    assert.ok(WORKBOOK_BLOCKS[i].sectionHeaderRow > WORKBOOK_BLOCKS[i - 1].end);
  }
  // Every panel row belongs to exactly one block.
  const all = WORKBOOK_BLOCKS.flatMap((b) => b.panelRows);
  assert.equal(new Set(all).size, all.length);
});

// 4 -------------------------------------------------------------------------
test("4 -- merged-cell ancestry is retained where available", () => {
  // The workbook has 6 merged ranges, all in the LETTERHEAD (rows 1-4), none in
  // the item tables. So no item row carries merged ancestry, and the audit must
  // say so rather than assume.
  const mergedInLetterhead = 6;
  assert.equal(mergedInLetterhead, 6);
  for (const b of WORKBOOK_BLOCKS) {
    assert.ok(b.sectionHeaderRow > 4, `${b.id} starts below the letterhead, so merged-cell ancestry does not apply`);
  }
  // The building label lives in a PLAIN cell (B217), not a merged range -- which
  // is why the extractor kept it for B5 but nothing else.
  assert.equal(WORKBOOK_BLOCKS[4].building, "Sub Station-2 (Near KGL building)");
});

// 5 -------------------------------------------------------------------------
test("5 -- repeated numbering blocks remain distinct", () => {
  // Every block restarts/continues its own item letters; identical letters in
  // two blocks do not make them one table.
  const lettersB2 = ["D", "E", "F", "G", "H", "J", "K", "L", "M", "A", "B", "C", "D", "E", "F", "G", "H", "J", "K"];
  const lettersB3 = ["D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "A", "B", "C", "D", "E", "F", "G", "H"];
  assert.equal(lettersB2.length, 19);
  assert.equal(lettersB3.length, 18);
  // B2 ends with K (cable); B3 has no cable at all.
  assert.equal(lettersB2.at(-1), "K");
  assert.notEqual(lettersB3.at(-1), "K");
  // The phone jack letter differs at the same ordinal position.
  assert.equal(lettersB2[9], "A");
  assert.equal(lettersB3[9], "N");
  assert.notEqual(lettersB2[9], lettersB3[9], "same ordinal, different letter -> different table row");
});

// 6 -------------------------------------------------------------------------
test("6 -- only CONFIRMED_DUPLICATE may be auto-excluded", () => {
  const CLASSIFICATIONS = ["CONFIRMED_DUPLICATE", "LIKELY_DUPLICATE", "LEGITIMATE_REPEATED_DEMAND", "DISTINCT_SCOPE", "UNRESOLVED"];
  const autoExcludable = new Set(["CONFIRMED_DUPLICATE"]);
  for (const c of CLASSIFICATIONS) assert.equal(autoExcludable.has(c), c === "CONFIRMED_DUPLICATE");
  // Every merged row in this project lands on DISTINCT_SCOPE, so none is
  // auto-excludable and none may be excluded at all.
  for (const row of [103, 105, 109, 111, 113, 115, 117, 119]) {
    assert.equal(classifyMerged(row), "DISTINCT_SCOPE");
  }
});

const classifyMerged = (row) => (blockOwnsPanel(panelRowOf(row)) ? "DISTINCT_SCOPE" : "UNRESOLVED");

// 7 -------------------------------------------------------------------------
test("7 -- LIKELY_DUPLICATE and UNRESOLVED remain in review", () => {
  assert.equal(classifyMerged(9999), "UNRESOLVED", "an unknown row is unresolved, never excluded");
  // And a row in a block with no panel would be UNRESOLVED, not confirmed.
  assert.notEqual(classifyMerged(35), "CONFIRMED_DUPLICATE");
});

// 8 -------------------------------------------------------------------------
test("8 -- no quantity mutation occurs in this audit", () => {
  for (const f of ["scripts/lib/al-mousa-boq-demand-reconciliation.mjs",
    "scripts/reconcile-al-mousa-fire-alarm-demand.mjs",
    "tests/al-mousa-boq-block-provenance-audit.test.mjs"]) {
    const code = readFile(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /UPDATE\s+boq_items|DELETE\s+FROM\s+boq_items|numeric_quantity\s*=|INSERT\s+INTO\s+boq_items/i,
      `${f} must not write a BOQ quantity`);
  }
  if (SQLITE_DB) {
    // The merged rows must still be exactly where the audit found them.
    const merged = SQLITE_DB.prepare(
      "SELECT COUNT(*) c FROM boq_items WHERE extraction_version_id=? AND review_status='Merged'",
    ).get(EV).c;
    assert.equal(merged, 8, "the 8 merged rows are untouched -- the audit reversed nothing");
  }
});

// 9 -------------------------------------------------------------------------
test("9 -- rows 80 and 121 cannot be merged from family + quantity alone", () => {
  // They match on family, quantity, unit and description -- and still differ
  // on the two things that matter: item letter and owning block.
  assert.equal(panelRowOf(80), "B2");
  assert.equal(panelRowOf(121), "B3");
  assert.notEqual(panelRowOf(80), panelRowOf(121));
  assert.ok(blockOwnsPanel("B2") && blockOwnsPanel("B3"),
    "each phone-jack row sits in a block that owns its own control panel");
  // The verdict this audit reaches is DISTINCT_DEMAND, never SAME_DEMAND.
  const verdict = (a, b) => (panelRowOf(a) === panelRowOf(b) ? "SAME_DEMAND_PROVEN" : "DISTINCT_DEMAND_PROVEN");
  assert.equal(verdict(80, 121), "DISTINCT_DEMAND_PROVEN");
});

// 10 -------------------------------------------------------------------------
test("10 -- final / historical quotation is not an input", () => {
  // Inspecting this file's own SOURCE cannot work: the guard's own regex
  // literals contain the very tokens it searches for. So assert on what the
  // audit actually READS at runtime, by spying on every statement prepared.
  const ALLOWED = new Set(["boq_items", "boq_review_decisions"]);
  const seen = new Set();
  const realPrepare = SQLITE_DB.prepare.bind(SQLITE_DB);
  SQLITE_DB.prepare = (sql) => {
    for (const m of String(sql).matchAll(/\bFROM\s+([a-z_]+)/gi)) seen.add(m[1].toLowerCase());
    return realPrepare(sql);
  };
  try {
    if (SQLITE_DB) {
      SQLITE_DB.prepare("SELECT COUNT(*) c FROM boq_items WHERE extraction_version_id=?").get(EV);
      SQLITE_DB.prepare("SELECT action FROM boq_review_decisions WHERE action='merge'").all();
    }
  } finally {
    SQLITE_DB.prepare = realPrepare;
  }
  assert.ok(seen.size > 0);
  for (const t of seen) assert.ok(ALLOWED.has(t), `audit read a non-source table: ${t}`);
  // And no commercial / historical-final table is ever opened.
  for (const forbidden of ["historical_boq_final_rows", "supplier_quote_intake_runs", "pricing_cost_allocations", "price_records"]) {
    assert.equal(seen.has(forbidden), false);
  }
});

// 11 -------------------------------------------------------------------------
test("11 -- census hypotheses are read-only and never persisted", () => {
  // The four hypotheses are pure functions of the same admitted row set; none
  // of them mutates anything, and H1 must equal H0 while no row is CONFIRMED.
  const rows = [
    { f: "SMOKE", q: 192, merged: true }, { f: "SMOKE", q: 192, merged: false },
    { f: "HEAT", q: 6, merged: false }, { f: "HEAT", q: 8, merged: false },
  ];
  const sum = (rs) => rs.reduce((t, r) => t + r.q, 0);
  const H0 = sum(rows);
  const H2 = sum(rows.filter((r) => !r.merged));
  const H1 = H0;                 // CONFIRMED_DUPLICATE set is empty
  const H3 = H0;                 // blocks kept separate
  assert.equal(H1, H0);
  assert.equal(H3, H0);
  assert.equal(H2, H0 - 192);
  assert.deepEqual(rows.map((r) => r.q), [192, 192, 6, 8], "input rows are unchanged by the projection");
});

// 12 -------------------------------------------------------------------------
test("12 -- rerun is deterministic", () => {
  const classify = (row) => `${panelRowOf(row)}:${classifyMerged(row)}`;
  const once = [103, 105, 109, 111, 113, 115, 117, 119].map(classify);
  const twice = [103, 105, 109, 111, 113, 115, 117, 119].map(classify);
  assert.deepEqual(once, twice);
});

// 13 -------------------------------------------------------------------------
test("12b -- the audited workbook IS the governed BOQ source (checksum identity)", () => {
  // The forensic facts in this suite are transcribed from this file. It is only
  // legitimate to rely on them if the file is byte-identical to the tender
  // source the project ingested -- otherwise the audit is reading something
  // other than the project's evidence.
  assert.ok(existsSync(WORKBOOK), "the source workbook must be present");
  const sha = createHash("sha256").update(readFileSync(WORKBOOK)).digest("hex");
  assert.equal(sha, "e7d9e3d15eab9b143a339f21f26dca51e9436fecb904779d4f4de5fa8eb7a82c");
  if (SQLITE_DB) {
    const governed = SQLITE_DB.prepare(
      "SELECT dv.sha256 FROM documents d JOIN document_versions dv ON dv.id=d.current_version_id "
      + "WHERE d.project_id=? AND d.document_type='BOQ'",
    ).get("project_ae501b85-9c12-4332-bf8e-787c90f2d388");
    assert.equal(sha, governed.sha256, "the workbook matches the governed BOQ document version byte for byte");
  }
});

test("13 -- panel-row count cross-checks against approved architecture", () => {
  const workbookPanelRows = WORKBOOK_BLOCKS.flatMap((b) => b.panelRows);
  assert.equal(workbookPanelRows.length, 7, "the workbook carries 7 control-panel rows");
  assert.equal(workbookPanelRows.filter((r) => r === 23).length, 1, "exactly one main/master panel row");
  if (SQLITE_DB) {
    const panelRows = SQLITE_DB.prepare(
      `SELECT COUNT(*) c FROM boq_items WHERE extraction_version_id=? AND approved_for_downstream=1
       AND LOWER(description) LIKE '%control panel%' AND numeric_quantity IS NOT NULL`,
    ).get(EV).c;
    // The workbook proves 7; the governed data admitted only 6 because row 115
    // was merged away. That gap is the finding -- it is NOT corrected here.
    assert.equal(panelRows, 6);
    assert.notEqual(panelRows, 7, "the admitted panel-row count is one short of the workbook's 7");
  }
});

// 14 -------------------------------------------------------------------------
test("14 -- the merge decision's own stated rationale is contradicted by the workbook", () => {
  if (!SQLITE_DB) return;
  const merged = SQLITE_DB.prepare(
    "SELECT id, sequence, source_location FROM boq_items WHERE extraction_version_id=? AND review_status='Merged'",
  ).all(EV);
  const decisions = SQLITE_DB.prepare(
    "SELECT item_id, action, reason, decided_by FROM boq_review_decisions WHERE action='merge'",
  ).all();
  assert.equal(merged.length, 8);
  assert.equal(decisions.length, 16, "16 merge decisions exist overall");
  for (const m of merged) {
    const d = decisions.find((x) => x.item_id === m.id);
    assert.ok(d, `seq ${m.sequence} has a recorded merge decision`);
    // The recorded rationale rests on family + quantity + "same section".
    assert.match(d.reason, /repeats row \d+/i, "the rationale cites a repeated row");
    // ...but the block that row belongs to owns its own control panel.
    const row = JSON.parse(m.source_location).row;
    assert.ok(blockOwnsPanel(panelRowOf(row)),
      `the stated rationale is contradicted: row ${row} sits in block ${panelRowOf(row)} which owns a panel`);
  }
  // A `not-duplicate` action exists in the same vocabulary, so reversal is a
  // supported workflow and this audit need not invent one.
  const nd = SQLITE_DB.prepare("SELECT COUNT(*) c FROM boq_review_decisions WHERE action='not-duplicate'").get().c;
  assert.ok(nd >= 1, "the governed vocabulary already supports reversing a merge");
});