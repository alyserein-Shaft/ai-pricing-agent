// RUNNER: project the CURRENT approved Al Mousa drawing architecture into the
// governed engineering fact graph, then reconstruct the per-building panel
// inventory. Idempotent; safe to re-run.
import { DatabaseSync } from "node:sqlite";
import {
  planProjection, foldProjection, currentApprovedVersion, rowsForVersion,
} from "./lib/al-mousa-drawing-architecture-projection.mjs";

const DB = process.argv[2];
const flags = process.argv.slice(3).filter((a) => a.startsWith("--"));
const positional = process.argv.slice(3).filter((a) => !a.startsWith("--"));
const PROJECT = positional[0] || "project_ae501b85-9c12-4332-bf8e-787c90f2d388";
const APPLY = flags.includes("--apply");
const db = new DatabaseSync(DB);

const versions = db.prepare("SELECT * FROM drawing_architecture_approved_versions WHERE project_id=?").all(PROJECT);
const version = currentApprovedVersion(versions);
if (!version) throw new Error("no current approved architecture version");
// approved_rows carries no project_id; it is reached only through its version.
const allVersionIds = versions.map((v) => v.id);
const allRows = db.prepare(
  `SELECT a.* FROM drawing_architecture_approved_rows a
   WHERE a.approved_version_id IN (${allVersionIds.map(() => "?").join(",")})`,
).all(...allVersionIds);
const rows = rowsForVersion(allRows, version.id);
console.log(`CURRENT approved architecture: v${version.version_number} (${version.status}) ${version.id}`);
console.log(`  approved rows in this version: ${rows.length} (of ${allRows.length} across all versions, incl. superseded)\n`);

// Rebuild the bridge evidence shape from the raw rows so the planner is a pure
// function of approved data (the bridge itself is proven by its own suite).
const adjudications = db.prepare("SELECT * FROM drawing_architecture_exception_adjudications WHERE project_id=? AND superseded_at IS NULL").all(PROJECT);
const adjFor = (row) => {
  const sheet = String(row.source_drawing_number ?? "").replace(/\s+/g, " ").trim();
  const byCase = adjudications.find((a) => String(a.review_case_ids ?? "").includes(row.review_case_id));
  if (byCase) return byCase;
  if (row.fact_type === "PANEL_EXISTS" && row.subject === "FACP") {
    return adjudications.find((a) => a.exception_type === "GENERIC_FACP_IDENTITY"
      && String(a.source_drawing_number ?? "").replace(/\s+/g, " ").trim() === sheet) || null;
  }
  return null;
};

const evidence = rows.map((r) => {
  const a = adjFor(r);
  return {
    id: r.id,
    factType: r.fact_type,
    subject: r.subject,
    relation: r.relation,
    object: r.object,
    evidenceKind: r.evidence_kind,
    authorityClass: r.authority_class,
    provenance: { documentId: r.document_id, documentVersionId: r.document_version_id, sourceDrawingNumber: r.source_drawing_number, sourcePage: r.source_page, evidenceFingerprint: r.evidence_fingerprint },
    adjudication: a ? { exceptionKey: a.exception_key, decisionState: a.decision_state, canonicalPanelIdentity: a.canonical_panel_identity, stage4BlockingClass: a.stage4_blocking_class } : null,
  };
});

const plan = planProjection({ projectId: PROJECT, approvedVersion: versions, approvedRows: allRows, evidence });

console.log("=== PROJECTED PANEL IDENTITIES ===");
for (const i of plan.identities) console.log(`  ${i.identity.padEnd(22)} role=${i.role.padEnd(5)} ${i.resolutionState.padEnd(26)} sheets=${i.sheets.join("; ")}`);
console.log("\n=== IDENTITIES REFUSED (not invented) ===");
for (const u of plan.unresolved) console.log(`  ${u.subject} @ ${u.sheet}  -> ${u.resolutionState}: ${u.reason}`);
console.log(`\nfacts=${plan.facts.length} relationships=${plan.relationships.length} provenance=${plan.provenance.length}`);

const existing = {
  facts: db.prepare("SELECT id FROM engineering_facts WHERE project_id=? AND fact_type='DRAWING_ARCHITECTURE_PROJECTION'").all(PROJECT),
  relationships: db.prepare("SELECT id FROM engineering_relationships WHERE project_id=? AND fact_type='DRAWING_ARCHITECTURE_PROJECTION'").all(PROJECT),
};
const folded = foldProjection({ projectId: PROJECT, plan, existingFacts: existing.facts, existingRelationships: existing.relationships });
console.log(`\nIDEMPOTENCY: new facts=${folded.factsToWrite.length} unchanged=${folded.unchangedFactCount} | new rels=${folded.relationshipsToWrite.length} unchanged=${folded.unchangedRelationshipCount}`);

if (APPLY) {
  const insFact = db.prepare(`INSERT OR IGNORE INTO engineering_facts
    (id, project_id, entity_type, entity_id, predicate, value, data_type, operator, fact_type, scope_type, scope_id, status, confidence, version_number, effective_from, model_version)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP,?)`);
  const insProv = db.prepare(`INSERT OR IGNORE INTO engineering_fact_provenance
    (id, fact_id, source_type, source_id, evidence_id, document_id, document_version_id, page, sheet, section, original_text, extraction_method, rule_version, confidence, user_role, human_reason)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insRel = db.prepare(`INSERT OR IGNORE INTO engineering_relationships
    (id, project_id, left_entity_type, left_entity_id, relationship_type, right_entity_type, right_entity_id, conditions, exceptions, quantity_rule, fact_type, scope_type, scope_id, confidence, status, version_number, effective_from, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP,?)`);
  for (const f of folded.factsToWrite) insFact.run(f.id, f.projectId, f.entityType, f.entityId, f.predicate, JSON.stringify(f.value), f.dataType, f.operator, f.factType, f.scopeType, f.scopeId, f.status, f.confidence, f.modelVersion);
  for (const p of plan.provenance) {
    if (!db.prepare("SELECT id FROM engineering_facts WHERE id=?").get(p.factId)) continue;
    insProv.run(p.id, p.factId, p.sourceType, p.sourceId, p.evidenceId, p.documentId, p.documentVersionId, p.page, p.sheet, p.section, p.originalText, p.extractionMethod, p.ruleVersion, p.confidence, p.userRole, p.humanReason);
  }
  for (const r of folded.relationshipsToWrite) insRel.run(r.id, r.projectId, r.leftEntityType, r.leftEntityId, r.relationshipType, r.rightEntityType, r.rightEntityId, JSON.stringify(r.conditions), JSON.stringify(r.exceptions), r.quantityRule ? JSON.stringify(r.quantityRule) : null, r.factType, r.scopeType, r.scopeId, r.confidence, r.status, r.createdBy);
  console.log(`APPLIED: wrote ${folded.factsToWrite.length} facts, ${folded.relationshipsToWrite.length} relationships`);
} else {
  console.log("(dry run -- pass --apply to write)");
}
console.log("\n=== RELATIONSHIPS BY TYPE ===");
const byType = new Map();
for (const r of plan.relationships) {
  const k = r.relationshipType;
  if (!byType.has(k)) byType.set(k, []);
  byType.get(k).push(r);
}
for (const [k, list] of byType) {
  console.log(`  ${k} (${list.length})`);
  const per = new Map();
  for (const r of list) per.set(r.leftEntityId, (per.get(r.leftEntityId) || 0) + 1);
  for (const [p, n] of per) console.log(`      ${p.padEnd(22)} ${n}`);
}
console.log("\n=== FACTS ===");
for (const f of plan.facts) console.log(`  ${f.entityType.padEnd(16)} ${f.entityId.padEnd(22)} ${f.predicate}  conf=${f.confidence}`);
