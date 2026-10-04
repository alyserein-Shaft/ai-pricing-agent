import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { qualifyBoqRow } from "../app/domain/boq-row-qualification.mjs";

const databasePath = process.argv[2];
const projectId = process.argv[3];
if (!databasePath || !projectId) throw new Error("Usage: node scripts/qualify-hotel-boq.mjs <database> <project-id>");
const db = new DatabaseSync(databasePath);
db.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
try {
  const rows = db.prepare("SELECT * FROM boq_items WHERE project_id=? ORDER BY sequence").all(projectId);
  const update = db.prepare("UPDATE boq_items SET row_type=?, review_status='Needs Review', approved_for_downstream=0, updated_at=CURRENT_TIMESTAMP WHERE id=?");
  const audit = db.prepare("INSERT INTO boq_review_decisions (id,extraction_version_id,item_id,action,previous_value,new_value,reason,decided_by) VALUES (?,?,?,?,?,?,?,?)");
  const counts = {};
  for (const row of rows) {
    const result = qualifyBoqRow(row);
    counts[result.rowType] = (counts[result.rowType] || 0) + 1;
    if (row.row_type === result.rowType) continue;
    update.run(result.rowType, row.id);
    audit.run(`boqdecision_${randomUUID()}`, row.extraction_version_id, row.id, "Row Qualified", JSON.stringify({ rowType: row.row_type }), JSON.stringify({ rowType: result.rowType, certain: result.certain }), result.reason, "local-development-user");
  }
  db.exec("COMMIT");
  console.log(JSON.stringify({ projectId, classifiedRows: rows.length, counts }, null, 2));
} catch (error) { db.exec("ROLLBACK"); throw error; }
finally { db.close(); }
