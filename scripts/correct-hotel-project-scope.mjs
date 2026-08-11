import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { classifyAlMesparScope } from "../app/domain/al-mespar-scope-classifier.mjs";

const [databasePath, projectId] = process.argv.slice(2);
if (!databasePath || !projectId) throw new Error("database and project required");

const db = new DatabaseSync(databasePath);
try {
  const project = db.prepare("SELECT * FROM projects WHERE id=?").get(projectId);
  if (!project) throw new Error("Hotel project not found");
  const items = db.prepare("SELECT * FROM boq_items WHERE project_id=? AND row_type='BOQ Item' ORDER BY sequence").all(projectId);
  const counts = new Map();

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE projects SET system_domain='Multi-Discipline', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(projectId);
    for (const item of items) {
      const result = classifyAlMesparScope(item);
      counts.set(result.discipline, (counts.get(result.discipline) || 0) + 1);
      db.prepare("UPDATE boq_items SET system_value=?, system_source_type='Deterministic Division Classification', system_confidence=100, category=?, approved_for_downstream=0, review_status='Needs Review', updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(result.discipline, result.category, item.id);
      db.prepare("INSERT INTO boq_review_decisions (id, extraction_version_id, item_id, action, previous_value, new_value, reason, decided_by) VALUES (?, ?, ?, 'Excluded from Al Mespar Work Queue', ?, ?, ?, 'local-development-user')")
        .run(`boqdecision_${randomUUID()}`, item.extraction_version_id, item.id,
          JSON.stringify({ system: item.system_value, category: item.category, approvedForDownstream: item.approved_for_downstream, reviewStatus: item.review_status }),
          JSON.stringify({ system: result.discipline, category: result.category, approvedForDownstream: false, reviewStatus: "Needs Review", inAlMesparScope: false }),
          result.reason);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  console.log(JSON.stringify({
    projectId,
    previousDomain: project.system_domain,
    currentDomain: "Multi-Discipline",
    classified: items.length,
    inAlMesparScope: 0,
    excludedFromWorkQueue: items.length,
    disciplineCounts: Object.fromEntries([...counts.entries()].sort()),
  }, null, 2));
} finally {
  db.close();
}

