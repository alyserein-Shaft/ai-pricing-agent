// R11 continuation -- CORRECT exhaustive literal scan of the live D1 for the
// historical service-line evidence cited in the continuation mission.
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(process.argv[2], { readOnly: true });
const NEEDLES = ["serv-01", "professional service", "14,463", "14,715", "14463", "14715", "testing & commissioning", "testing and commissioning", "commissioning"];

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
console.log(`scanning ${tables.length} tables for ${NEEDLES.length} needles\n`);

let totalHits = 0;
for (const t of tables) {
  let cols;
  try { cols = db.prepare(`PRAGMA table_info("${t}")`).all().filter((c) => /TEXT/i.test(c.type || "")).map((c) => c.name); } catch { continue; }
  if (!cols.length) continue;
  // Use instr() on a concatenated projection; cap read size per table for safety.
  const expr = cols.map((c) => `COALESCE("${c}",'')`).join(" || ' ' || ");
  for (const needle of NEEDLES) {
    let n = 0;
    try { n = db.prepare(`SELECT COUNT(*) c FROM "${t}" WHERE lower(${expr}) LIKE ?`).get(`%${needle}%`).c; } catch { continue; }
    if (n > 0) {
      totalHits += n;
      console.log(`  HIT ${t} :: "${needle}" = ${n}`);
      try {
        const rows = db.prepare(`SELECT * FROM "${t}" WHERE lower(${expr}) LIKE ? LIMIT 2`).all(`%${needle}%`);
        for (const r of rows) {
          const brief = {};
          for (const [k, v] of Object.entries(r)) {
            if (typeof v === "string" && v && v.length < 400 && new RegExp(needle.replace(/[&]/g, "&"), "i").test(v)) brief[k] = v.slice(0, 160);
            else if (["amount_minor", "currency", "price_type", "approval_status", "unit", "part_number", "quantity", "project_id", "title", "description", "status", "review_status", "scope", "classification"].includes(k)) brief[k] = String(v).slice(0, 90);
          }
          console.log(`      ${JSON.stringify(brief).slice(0, 460)}`);
        }
      } catch {}
    }
  }
}
console.log(`\nTOTAL HITS: ${totalHits}`);
