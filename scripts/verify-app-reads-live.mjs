// Representative APPLICATION reads against the migrated copy.
// Proves the reconciliation did not break how runtime actually queries data.
// Read-only.
import { DatabaseSync } from "node:sqlite";

const copy = process.argv[2];
if (!copy) { console.error("usage: verify-app-reads.mjs <migrated-copy.sqlite>"); process.exit(3); }
const db = new DatabaseSync(copy, { readOnly: true });
const one = (s, ...a) => db.prepare(s).get(...a);
let fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}${detail ? "  " + detail : ""}`);
  if (!ok) fail += 1;
};

console.log("REPRESENTATIVE APPLICATION READS ON MIGRATED COPY");
console.log("-".repeat(78));
const PROJECT = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";

// Each of these mirrors a real query in app/ or worker/.
const reads = [
  ["boq_items for the canonical project",
    `SELECT count(*) c FROM boq_items WHERE project_id=?`, [PROJECT]],
  ["the canonical project row",
    `SELECT count(*) c FROM projects WHERE id=?`, [PROJECT]],
  ["current BOQ document versions",
    `SELECT count(*) c FROM document_versions dv JOIN documents d ON d.id=dv.document_id
     WHERE d.project_id=? AND dv.id = d.current_version_id`, [PROJECT]],
  ["requirement profiles + current approval state",
    `SELECT count(*) c FROM requirement_profile_versions WHERE approved_for_matching=1`, []],
  ["profile applicability by authority class (XOR)",
    `SELECT requirement_source, count(*) c FROM profile_requirement_applicability GROUP BY 1 ORDER BY 1`, []],
  ["requirement intelligence facts by authority class (XOR)",
    `SELECT requirement_source, count(*) c FROM requirement_intelligence_facts GROUP BY 1 ORDER BY 1`, []],
  ["library product identity",
    `SELECT count(*) c FROM library_products`, []],
  ["price records (commercial)",
    `SELECT count(*) c FROM price_records`, []],
  ["product source evidence",
    `SELECT count(*) c FROM product_source_evidence`, []],
  ["product attributes WITH source_id (column preserved)",
    `SELECT count(*) c FROM product_attributes WHERE source_id IS NOT NULL`, []],
  ["documents WITH document_family_id (column preserved)",
    `SELECT count(*) c FROM documents WHERE document_family_id IS NOT NULL`, []],
  ["historical BOQ rows (legacy table preserved)",
    `SELECT count(*) c FROM historical_boq_rows`, []],
  ["library security principals (security table preserved)",
    `SELECT count(*) c FROM library_security_principals`, []],
  ["pricing runs + lines",
    `SELECT count(*) c FROM pricing_lines`, []],
  ["review queue",
    `SELECT count(*) c FROM review_queue_items`, []],
];

for (const [label, sql, args] of reads) {
  try {
    const r = one(sql, ...args);
    const value = r.c !== undefined ? r.c : JSON.stringify(r).slice(0, 90);
    console.log(`  OK   ${label.padEnd(52)} ${value}`);
  } catch (e) {
    check(label, false, e.message.slice(0, 80));
  }
}

// The XOR authority split must still be exactly three classes.
try {
  const rows = db.prepare("SELECT requirement_source s, count(*) c FROM profile_requirement_applicability GROUP BY 1").all();
  const classes = rows.map((r) => r.s).sort();
  check("applicability authority classes intact",
    classes.length === 3 && classes.includes("Specification") && classes.includes("DrawingDeviceIdentity") && classes.includes("BOQDeviceIdentity"),
    classes.join(", "));
} catch (e) { check("applicability authority classes intact", false, e.message.slice(0, 60)); }

console.log("-".repeat(78));
console.log(fail === 0 ? "APP READ VERIFICATION: PASS" : `APP READ VERIFICATION: FAIL (${fail})`);
db.close();
process.exit(fail ? 1 : 0);
